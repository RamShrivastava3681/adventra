import { amazonSpApi, generateTraceId, spApiBody, spApiNextToken } from "./amazon-spapi.service.js";
import { AmazonDebugLogger } from "./amazon-spapi.service.js";
import * as OrderModel from "../models/marketplace-amazon-order.js";
import * as SyncStatusModel from "../models/marketplace-amazon-sync-status.js";
import * as InventoryModel from "../models/marketplace-amazon-inventory.js";
import * as ListingModel from "../models/marketplace-amazon-listing.js";
import * as ReturnModel from "../models/marketplace-amazon-return.js";
import * as RefundModel from "../models/marketplace-amazon-refund.js";
import * as InvoiceModel from "../models/marketplace-amazon-invoice-record.js";
import { parseAmazonReportTable, normalizeInvoiceReportRows, type ParsedAmazonInvoice } from "../lib/amazon-report-parser.js";
import { config } from "../config.js";
import * as db from "../dynamodb.js";
import { amazonApplicationStatus, type DashboardStatus } from "../lib/amazon-application-status.js";

type Module = SyncStatusModel.MarketplaceAmazonSyncStatus["module"];

export interface SyncResult {
  module: Module;
  status: SyncStatusModel.SyncStatus;
  recordsReceived: number;
  recordsParsed: number;
  recordsInserted: number;
  recordsUpdated: number;
  recordsSkipped: number;
  recordsRejected: number;
  recordsSynced: number;
  lastCursor: string | null;
  error: string | null;
  errorCode: string | null;
  startTime: string;
  endTime: string | null;
  durationMs: number;
  paginationCount: number;
}

type SyncStatus = SyncStatusModel.SyncStatus;

/** Map an Amazon API error to a sync status + code. */
function classifyError(err: any): { status: SyncStatus; code: string | null; message: string } {
  const msg = err?.message || String(err);
  if (msg.includes("not configured")) return { status: "NotConfigured", code: "NotConfigured", message: msg };
  if (msg.includes("401") || msg.includes("Authentication") || msg.includes("token")) {
    return { status: "AuthenticationError", code: "AuthError", message: msg };
  }
  if (msg.includes("429") || msg.includes("503") || msg.includes("throttl")) {
    return { status: "RateLimited", code: "RateLimited", message: msg };
  }
  if (msg.includes("403") || msg.includes("Access") || msg.includes("restricted") || msg.includes("unauthorized")) {
    return { status: "AccessRestricted", code: "AccessRestricted", message: msg };
  }
  return { status: "Failed", code: "SyncFailed", message: msg };
}

function nowISO() {
  return db.nowISO();
}

/** Look back window for incremental orders sync. */
function defaultLookback(): string {
  const days = config.amazon.syncLookbackDays || 30;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

/** Normalize an Amazon order into the stored schema. */
function normalizeOrder(clientId: string, order: any): Partial<OrderModel.MarketplaceAmazonOrder> & {
  clientId: string;
  amazonOrderId: string;
  amazonSku: string;
  productName: string;
  quantity: number;
  sellingPrice: number;
  shippingMethod: string;
  fulfilmentType: string;
} {
  const items = Array.isArray(order.OrderItems) ? order.OrderItems : [];
  const firstItem = items[0] ?? {};
  // Orders v0 getOrders returns no items, so the SKU is usually filled in later by
  // the order-items sync. (PurchaseOrderNumber is the buyer's PO, never a SKU.)
  const sku = firstItem.SellerSKU || "";
  const productName = firstItem.Title || "";
  // Orders v0 getOrders has no OrderItems: units come from NumberOfItemsShipped + NumberOfItemsUnshipped
  // and the value from OrderTotal. ItemPrice (when items are present) is the line total.
  const quantity =
    items.reduce((sum: number, it: any) => sum + Number(it.QuantityOrdered ?? it.Quantity ?? 0), 0) ||
    Number(order.NumberOfItemsShipped || 0) + Number(order.NumberOfItemsUnshipped || 0) ||
    Number(order.NumberOfItems || 1);
  const firstItemQty = Number(firstItem.QuantityOrdered ?? firstItem.Quantity ?? 0);
  const orderTotal = Number(order.OrderTotal?.Amount);
  const price = firstItem.ItemPrice?.Amount && firstItemQty > 0
    ? Number(firstItem.ItemPrice.Amount) / firstItemQty
    : Number.isFinite(orderTotal) && quantity > 0
      ? orderTotal / quantity
      : Number(firstItem.UnitPrice?.Amount || 0);
  const currency = firstItem.ItemPrice?.CurrencyCode || order.OrderTotal?.CurrencyCode || order.MarketplaceTaxInfo?.[0]?.CurrencyCode || "INR";
  const fulfilment = order.FulfillmentChannel || "FBM";
  const fulfilmentType = fulfilment === "AFN" ? "FBA" : fulfilment === "MFN" ? "SellerFlex" : "FBM";

  return {
    clientId,
    amazonOrderId: order.AmazonOrderId,
    orderDate: order.PurchaseDate || order.LastUpdatedDate || nowISO(),
    amazonSku: sku,
    productName,
    colour: firstItem.Colour ?? null,
    size: firstItem.Size ?? null,
    quantity,
    sellingPrice: price,
    discount: 0,
    taxInformation: {
      taxableAmount: 0,
      taxAmount: Number(order.TaxInfo?.Amount || 0),
      taxRate: 0,
    },
    deliveryAddress: order.ShippingAddress
      ? {
          addressLine1: order.ShippingAddress.AddressLine1 || "",
          addressLine2: order.ShippingAddress.AddressLine2 || null,
          city: order.ShippingAddress.City || "",
          state: order.ShippingAddress.StateOrRegion || "",
          postalCode: order.ShippingAddress.PostalCode || "",
          country: order.ShippingAddress.CountryCode || "",
        }
      : {
          addressLine1: "",
          addressLine2: null,
          city: "",
          state: "",
          postalCode: "",
          country: "",
        },
    shippingMethod: order.ShippingMethod || "",
    fulfilmentType: fulfilmentType as any,
    expectedDispatchDate: null,
    amazonOrderStatus: mapAmazonOrderStatus(order.OrderStatus) as any,
    invoiceStatus: "Pending",
    amazonLastUpdatedAt: order.LastUpdateDate ?? null,
  };
}

function mapAmazonOrderStatus(status: string): OrderModel.MarketplaceAmazonOrder["amazonOrderStatus"] {
  const s = (status || "").toLowerCase();
  if (s === "pending") return "Pending";
  if (s === "unshipped") return "Pending";
  if (s === "partiallyshipped") return "PartiallyShipped";
  if (s === "shipped") return "Shipped";
  if (s === "delivered") return "Delivered";
  if (s === "canceled" || s === "cancelled") return "Cancelled";
  if (s === "returned") return "Returned";
  if (s === "refunded") return "Refunded";
  if (s === "pendingconfirmation") return "PendingConfirmation";
  return "Pending";
}

/** Normalize an Amazon order item into the stored schema (linked to an order). */
function normalizeOrderItem(clientId: string, amazonOrderId: string, item: any) {
  return {
    clientId,
    amazonOrderId,
    sellerSku: item.SellerSKU || "",
    asin: item.ASIN || null,
    productName: item.Title || null,
    // Orders v0: QuantityOrdered; ItemPrice is the line total (unit price × quantity).
    quantity: Number(item.QuantityOrdered ?? item.Quantity ?? 0),
    unitPrice:
      Number(item.QuantityOrdered ?? item.Quantity ?? 0) > 0
        ? Number(item.ItemPrice?.Amount || 0) / Number(item.QuantityOrdered ?? item.Quantity)
        : Number(item.ItemPrice?.Amount || 0),
    currency: item.ItemPrice?.CurrencyCode || "INR",
    productTax: Number(item.ItemTax?.Amount || 0),
    shippingTax: Number(item.ShippingTax?.Amount || 0),
    promotionDiscount: Number(item.PromotionDiscount?.Amount || 0),
    condition: item.Condition?.ConditionNote ?? null,
  };
}

/** Normalize an FBA inventory summary into the stored schema. */
function normalizeInventory(clientId: string, marketplaceId: string, item: any) {
  const sku = item.SellerSKU || item.sellerSku || "";
  const asin = item.ASIN || item.asin || null;
  const fnsku = item.FNSKU || item.fnSku || item.fnsku || null;
  // FBA Inventory v1 summaries are always Amazon-fulfilled.
  const fulfilment = item.FulfilmentChannel || item.fulfilmentChannel || (item.inventoryDetails || item.fnSku ? "AFN" : null);
  const fulfilmentChannel = fulfilment === "AFN" ? "FBA" : fulfilment === "MFN" ? "FBM" : null;
  // FBA Inventory v1 (details=true): inventoryDetails.{fulfillableQuantity, inbound*Quantity,
  // reservedQuantity.totalReservedQuantity, unfulfillableQuantity.totalUnfulfillableQuantity}.
  const d = item.inventoryDetails;
  const available = Number(d?.fulfillableQuantity ?? item.Quantity?.AvailableQuantity ?? item.Quantity?.availableQuantity ?? 0);
  const reserved = Number(d?.reservedQuantity?.totalReservedQuantity ?? item.Quantity?.ReservedQuantity ?? item.Quantity?.reservedQuantity ?? 0);
  const inbound = d
    ? Number(d.inboundWorkingQuantity ?? 0) + Number(d.inboundShippedQuantity ?? 0) + Number(d.inboundReceivingQuantity ?? 0)
    : Number(item.Quantity?.InboundQuantity ?? item.Quantity?.inboundQuantity ?? 0);
  const unfulfillable = Number(d?.unfulfillableQuantity?.totalUnfulfillableQuantity ?? item.Quantity?.UnfulfillableQuantity ?? item.Quantity?.unfulfillableQuantity ?? 0);
  const total = available + reserved + inbound + unfulfillable;
  let stockStatus: InventoryModel.StockStatus = "InStock";
  if (total === 0) stockStatus = "OutOfStock";
  else if (available <= 0 && total > 0) stockStatus = "LowStock";

  return {
    clientId,
    marketplaceId,
    sellerSku: sku,
    asin,
    fnsku,
    productName: item.productName ?? null,
    productImage: null,
    fulfilmentChannel: fulfilmentChannel as any,
    availableQuantity: available,
    reservedQuantity: reserved,
    inboundQuantity: inbound,
    unfulfillableQuantity: unfulfillable,
    totalQuantity: total,
    stockStatus,
    lastUpdated: nowISO(),
  };
}

const syncInFlight = new Map<string, Promise<SyncResult>>();

export class AmazonSyncService {
  private readonly log: AmazonDebugLogger;

  constructor() {
    this.log = new AmazonDebugLogger({ module: "sync-service" });
  }

  /** Enqueue a sync and return when complete. */
  async sync(module: Module, clientId: string, traceId?: string): Promise<SyncResult> {
    const key = `${clientId}:${module}`;
    const existing = syncInFlight.get(key);
    if (existing) return existing;

    const promise = new Promise<SyncResult>((resolve, reject) => {
      const log = new AmazonDebugLogger({ traceId, clientId }).child({ module });
      log.info({ operation: "sync.enqueue", stage: "before", config: { module } });
      const entry = { module, clientId, traceId, resolve, reject, log };
      syncQueue.push(entry);
      void processQueue();
    });
    syncInFlight.set(key, promise);
    void promise.then(
      () => syncInFlight.delete(key),
      () => syncInFlight.delete(key),
    );
    return promise;
  }

  /** Sync all modules for a client. */
  async syncAll(clientId: string, traceId?: string): Promise<Record<Module, SyncResult>> {
    const log = new AmazonDebugLogger({ traceId, clientId }).child({ module: "all" });
    log.info({ operation: "syncAll.enqueue", stage: "before", config: { modules: ["orders", "order-items", "inventory", "listings", "returns", "invoices"] } });

    const modules: Module[] = ["orders", "order-items", "inventory", "listings", "returns", "invoices"];
    const results: Record<Module, SyncResult> = {} as any;
    for (const module of modules) {
      // Order Items depends on Orders - if Orders failed/empty, mark Order Items accordingly
      if (module === "order-items") {
        const ordersResult = results["orders"];
        if (ordersResult) {
          if (ordersResult.status === "Failed" || ordersResult.status === "AuthenticationError" || ordersResult.status === "AccessRestricted" || ordersResult.status === "NotConfigured") {
            log.warn({
              operation: "syncAll",
              stage: "dependency-blocked",
              config: { module: "order-items", dependency: "orders", dependencyStatus: ordersResult.status, dependencyError: ordersResult.error },
            });
            results["order-items"] = this._result(
              "order-items", "Blocked",
              0, 0, 0, 0, 0, 0, 0, null, `Orders dependency failed: ${ordersResult.error || "unknown error"}`, "DependencyFailed",
              nowISO(), nowISO(), 0, 0,
            );
            continue;
          }
          if (ordersResult.status === "EMPTY" && ordersResult.recordsReceived === 0) {
            log.warn({
              operation: "syncAll",
              stage: "dependency-empty",
              config: { module: "order-items", dependency: "orders", dependencyStatus: ordersResult.status },
            });
            results["order-items"] = this._result(
              "order-items", "EMPTY",
              0, 0, 0, 0, 0, 0, 0, null, "No orders available to sync items for", "NoOrders",
              nowISO(), nowISO(), 0, 0,
            );
            continue;
          }
        }
      }

      const result = await this.sync(module, clientId, traceId);
      results[module] = result;
      if (result.status === "Failed" || result.status === "AuthenticationError" || result.status === "AccessRestricted") {
        log.warn({ operation: "syncAll", stage: "after", config: { failedModule: module, status: result.status, error: result.error } });
      }
    }
    log.info({ operation: "syncAll", stage: "after", config: { modulesCompleted: modules.length } });
    return results;
  }

  /** Sync status snapshot for the health-monitoring panel. */
  async statusSnapshot(clientId: string) {
    const statuses = await SyncStatusModel.list(clientId);
    return statuses.map((s) => ({
      module: s.module,
      status: s.status,
      lastSync: s.lastSyncAt,
      lastAttemptedAt: s.lastAttemptedAt,
      lastSuccessfulAt: s.lastSuccessfulAt,
      records: s.recordsSynced,
      recordsReceived: s.recordsReceived,
      recordsProcessed: s.recordsProcessed,
      recordsInserted: s.recordsInserted,
      recordsUpdated: s.recordsUpdated,
      recordsSkipped: s.recordsSkipped,
      recordsRejected: s.recordsRejected,
      error: s.error,
      errorCode: s.errorCode,
      errorClassification: s.errorClassification,
      httpStatus: s.httpStatus,
      amazonRequestId: s.amazonRequestId,
      durationMs: s.durationMs,
      paginationCount: s.paginationCount,
      retries: s.retries,
      cursor: s.lastCursor,
    }));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Module syncs (instrumented)
  // ──────────────────────────────────────────────────────────────────────────

  private async syncOrders(clientId: string, traceId?: string): Promise<SyncResult> {
    const log = new AmazonDebugLogger({ traceId, clientId }).child({ module: "orders" });
    const startTime = nowISO();
    const startMs = Date.now();
    const lastAttemptedAt = startTime;

    await SyncStatusModel.markSyncing({ clientId, module: "orders" });
    log.info({ operation: "syncOrders", stage: "before", config: { startTime } });

    if (!config.amazon.isConfigured) {
      const err = new Error("Amazon SP-API is not configured");
      log.error({ operation: "syncOrders", stage: "error", errorCode: "NotConfigured", errorMessage: err.message });
      await SyncStatusModel.upsert({
        clientId, module: "orders", status: "NotConfigured",
        lastAttemptedAt, lastSyncAt: nowISO(),
        error: err.message, errorCode: "NotConfigured",
        errorClassification: "CONFIGURATION_ERROR",
      });
      return this._result("orders", "NotConfigured", 0, 0, 0, 0, 0, 0, 0, null, err.message, "NotConfigured", startTime, nowISO(), Date.now() - startMs, 0);
    }

    let totalReceived = 0;
    let totalParsed = 0;
    let totalInserted = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    let totalRejected = 0;
    let nextToken: string | null = null;
    let lastUpdatedAfter = null;
    let pages = 0;
    let lastHttpStatus: number | null = null;

    const existing = await SyncStatusModel.findByClientAndModule(clientId, "orders");
    if (existing?.lastCursor) lastUpdatedAfter = existing.lastCursor;
    else lastUpdatedAfter = defaultLookback();

    log.info({
      operation: "syncOrders",
      stage: "before",
      config: {
        lookback: lastUpdatedAfter,
        pageSize: 100,
        resumeFromCursor: Boolean(existing?.lastCursor),
      },
    });

    try {
      do {
        pages += 1;
        log.debug({
          operation: "syncOrders",
          stage: "pagination",
          config: { page: pages, nextToken: nextToken ? "[present]" : null, lastUpdatedAfter },
        });

        const resp = await amazonSpApi.getOrders({
          lastUpdatedAfter,
          maxResults: 100,
          nextToken: nextToken || undefined,
          traceId,
          clientId,
          sellerId: config.amazon.sellerId,
        });

        // Orders API v0 returns { payload: { Orders, NextToken } }.
        const body = spApiBody(resp);
        const orders = Array.isArray(body.Orders) ? body.Orders : [];
        nextToken = spApiNextToken(resp);
        totalReceived += orders.length;
        log.info({
          operation: "syncOrders",
          stage: "pagination.after",
          config: { page: pages, recordsReceived: orders.length, nextPage: Boolean(nextToken), totalReceived },
        });

        let inserted = 0;
        let updated = 0;
        let skipped = 0;
        let failed = 0;

        for (const order of orders) {
          try {
            totalParsed += 1;
            const normalized = normalizeOrder(clientId, order);
            const existingOrder = await OrderModel.findByAmazonOrderId(clientId, normalized.amazonOrderId);
            if (existingOrder) {
              await OrderModel.update(existingOrder.id, {
                orderDate: normalized.orderDate,
                amazonOrderStatus: normalized.amazonOrderStatus,
                amazonLastUpdatedAt: normalized.amazonLastUpdatedAt,
                // Once the item sync has run, its per-item quantity and price are more exact.
                ...(existingOrder.itemsSyncedAt
                  ? {}
                  : { sellingPrice: normalized.sellingPrice, quantity: normalized.quantity }),
                updatedAt: nowISO(),
              });
              updated += 1;
            } else {
              await OrderModel.create(normalized as any);
              inserted += 1;
            }
          } catch (err: any) {
            totalRejected += 1;
            failed += 1;
            log.error({
              operation: "syncOrders",
              stage: "db-write",
              config: { amazonOrderId: order.AmazonOrderId },
              errorCode: err?.code ?? "DbWriteError",
              errorMessage: err?.message ?? String(err),
            });
          }
        }

        totalInserted += inserted;
        totalUpdated += updated;
        totalSkipped += skipped;
        log.info({
          operation: "syncOrders",
          stage: "db-write.summary",
          config: { page: pages, inserted, updated, skipped, failed, totalReceived: orders.length },
        });
      } while (nextToken);

      const endMs = Date.now();
      // Determine status: EMPTY if 0 records received from Amazon, SUCCESS otherwise
      const status = totalReceived === 0 ? "EMPTY" : "Synchronized";
      const lastCursor = lastUpdatedAfter || defaultLookback();
      const dashboardStatus = totalReceived === 0 ? "EMPTY" : "SUCCESS";
      await SyncStatusModel.upsert({
        clientId,
        module: "orders",
        status,
        lastSyncAt: nowISO(),
        lastAttemptedAt,
        lastSuccessfulAt: totalReceived > 0 ? nowISO() : null,
        recordsSynced: totalInserted + totalUpdated,
        recordsReceived: totalReceived,
        recordsProcessed: totalParsed,
        recordsInserted: totalInserted,
        recordsUpdated: totalUpdated,
        recordsSkipped: totalSkipped,
        recordsRejected: totalRejected,
        lastCursor,
        httpStatus: lastHttpStatus,
        errorClassification: totalReceived === 0 ? "EMPTY_RESPONSE" : "SYNC_SUCCESS",
        durationMs: endMs - startMs,
        paginationCount: pages,
      });
      log.info({
        operation: "syncOrders",
        stage: "after",
        durationMs: endMs - startMs,
        recordsReceived: totalReceived,
        recordsParsed: totalParsed,
        recordsInserted: totalInserted,
        recordsUpdated: totalUpdated,
        recordsRejected: totalRejected,
        config: { pages, lastCursor, status, dashboardStatus },
      });
      return this._result("orders", status, totalReceived, totalParsed, totalInserted, totalUpdated, totalSkipped, totalRejected, totalInserted + totalUpdated, lastCursor, null, null, startTime, nowISO(), endMs - startMs, pages);
    } catch (err: any) {
      const endMs = Date.now();
      const { status, code, message } = classifyError(err);
      const { classification, dashboardStatus: ds } = amazonApplicationStatus.classifyAmazonError(err, undefined, message);
      log.error({
        operation: "syncOrders",
        stage: "error",
        durationMs: endMs - startMs,
        errorCode: code,
        errorMessage: message,
        recordsReceived: totalReceived,
        errorClassification: classification,
      });
      await SyncStatusModel.upsert({
        clientId,
        module: "orders",
        status,
        lastSyncAt: nowISO(),
        lastAttemptedAt,
        recordsSynced: totalInserted + totalUpdated,
        recordsReceived: totalReceived,
        recordsProcessed: totalParsed,
        recordsInserted: totalInserted,
        recordsUpdated: totalUpdated,
        recordsSkipped: totalSkipped,
        recordsRejected: totalRejected,
        error: message,
        errorCode: code,
        errorClassification: classification,
        durationMs: endMs - startMs,
        paginationCount: pages,
      });
      return this._result("orders", status, totalReceived, totalParsed, totalInserted, totalUpdated, totalSkipped, totalRejected, totalInserted + totalUpdated, null, message, code, startTime, nowISO(), endMs - startMs, pages);
    }
  }

  private async syncOrderItems(clientId: string, traceId?: string): Promise<SyncResult> {
    const log = new AmazonDebugLogger({ traceId, clientId }).child({ module: "order-items" });
    const startTime = nowISO();
    const startMs = Date.now();
    const lastAttemptedAt = startTime;

    await SyncStatusModel.markSyncing({ clientId, module: "order-items" });
    log.info({ operation: "syncOrderItems", stage: "before", config: { startTime } });

    // One record per real Amazon order (through the lookup records); fall back to
    // the order list for clients whose orders predate the lookup records.
    const refs = await OrderModel.listOrderRefs(clientId);
    const orders = refs.length
      ? ((await Promise.all(refs.map((r) => OrderModel.get(r.orderId)))).filter(Boolean) as OrderModel.MarketplaceAmazonOrder[])
      : await OrderModel.list(clientId);
    log.info({
      operation: "syncOrderItems",
      stage: "before",
      config: { sourceOrders: orders.length, fromLookupRecords: refs.length > 0 },
    });

    if (orders.length === 0) {
      const endMs = Date.now();
      await SyncStatusModel.upsert({
        clientId,
        module: "order-items",
        status: "EMPTY",
        lastSyncAt: nowISO(),
        lastAttemptedAt,
        recordsSynced: 0,
        error: "No orders available to sync items for",
        errorCode: "NoOrders",
        errorClassification: "EMPTY_RESPONSE",
        durationMs: endMs - startMs,
        paginationCount: 0,
      });
      log.info({
        operation: "syncOrderItems",
        stage: "after",
        durationMs: endMs - startMs,
        recordsReceived: 0,
        config: { reason: "no local orders", status: "EMPTY" },
      });
      return this._result("order-items", "EMPTY", 0, 0, 0, 0, 0, 0, 0, null, "No orders available to sync items for", "NoOrders", startTime, nowISO(), endMs - startMs, 0);
    }

    let totalReceived = 0;
    let totalParsed = 0;
    let totalInserted = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    let totalRejected = 0;
    let processedOrders = 0;

    for (const order of orders) {
      processedOrders += 1;
      // Items only change when Amazon changes the order: fetch them for orders never
      // item-synced, missing a SKU, or updated on Amazon since the last item sync.
      const needsItems =
        !order.itemsSyncedAt ||
        !String(order.amazonSku ?? "").trim() ||
        (order.amazonLastUpdatedAt != null && order.amazonLastUpdatedAt > order.itemsSyncedAt);
      if (!needsItems) {
        totalSkipped += 1;
        continue;
      }
      try {
        const resp = await amazonSpApi.getOrderItems({ amazonOrderId: order.amazonOrderId, traceId, clientId, sellerId: config.amazon.sellerId });
        const orderItems = spApiBody(resp).OrderItems;
        const items = Array.isArray(orderItems) ? orderItems : [];
        totalReceived += items.length;
        totalParsed += items.length;
        log.debug({
          operation: "syncOrderItems",
          stage: "pagination.after",
          config: { amazonOrderId: order.amazonOrderId, recordsReceived: items.length },
        });

        let written = 0;
        for (const [index, item] of items.entries()) {
          try {
            const normalized = normalizeOrderItem(clientId, order.amazonOrderId, item);
            // Amazon's OrderItemId makes the record key stable, so a re-sync
            // overwrites the item instead of adding another copy.
            const orderItemId = String(item.OrderItemId ?? item.orderItemId ?? `${normalized.sellerSku || "item"}-${index}`);
            const id = `${order.amazonOrderId}#${orderItemId}`;
            const now = nowISO();
            await db.putItem({
              pk: `MARKETPLACE_AMAZON_ORDER_ITEM#${order.amazonOrderId}`,
              sk: `MARKETPLACE_AMAZON_ORDER_ITEM#${id}`,
              gsi1pk: `CLIENT#${clientId}`,
              gsi1sk: `MarketplaceAmazonOrderItem#${order.orderDate}#${id}`,
              entityType: "MarketplaceAmazonOrderItem",
              id,
              orderItemId,
              orderId: order.id,
              ...normalized,
              createdAt: order.createdAt ?? now,
              updatedAt: now,
            } as any);
            written += 1;
            totalInserted += 1;
          } catch (err: any) {
            totalRejected += 1;
            log.error({
              operation: "syncOrderItems",
              stage: "db-write",
              config: { amazonOrderId: order.amazonOrderId, orderItemId: item.OrderItemId },
              errorCode: err?.code ?? "DbWriteError",
              errorMessage: err?.message ?? String(err),
            });
          }
        }

        // The order list from Amazon has no items, so copy SKU, title, quantity and
        // unit price from the items onto the order the dashboard shows.
        if (items.length) {
          const first = items[0];
          const quantity = items.reduce((sum: number, it: any) => sum + Number(it.QuantityOrdered ?? it.Quantity ?? 0), 0);
          const firstQty = Number(first.QuantityOrdered ?? first.Quantity ?? 0);
          const linePrice = Number(first.ItemPrice?.Amount);
          await OrderModel.update(order.id, {
            amazonSku: String(first.SellerSKU ?? "") || order.amazonSku,
            productName: String(first.Title ?? "") || order.productName,
            ...(quantity > 0 ? { quantity } : {}),
            ...(Number.isFinite(linePrice) && firstQty > 0 ? { sellingPrice: linePrice / firstQty } : {}),
            itemsSyncedAt: nowISO(),
          });
          totalUpdated += 1;
        }

        log.info({
          operation: "syncOrderItems",
          stage: "db-write.summary",
          config: { amazonOrderId: order.amazonOrderId, itemsReceived: items.length, written },
        });
      } catch (err: any) {
        totalRejected += 1;
        log.error({
          operation: "syncOrderItems",
          stage: "error",
          config: { amazonOrderId: order.amazonOrderId },
          errorCode: err?.code ?? "ApiError",
          errorMessage: err?.message ?? String(err),
        });
      }
    }

    const endMs = Date.now();
    const hasFailures = totalRejected > 0;
    // Nothing fetched because every order's items were already current = in sync, not empty.
    const nothingToDo = totalReceived === 0 && totalSkipped > 0 && !hasFailures;
    const status = nothingToDo ? "Synchronized" : totalReceived === 0 ? "EMPTY" : (hasFailures ? "PARTIAL" : "Synchronized");
    const dashboardStatus = nothingToDo ? "SUCCESS" : totalReceived === 0 ? "EMPTY" : (hasFailures ? "PARTIAL" : "SUCCESS");
    await SyncStatusModel.upsert({
      clientId,
      module: "order-items",
      status,
      lastSyncAt: nowISO(),
      lastAttemptedAt,
      lastSuccessfulAt: totalReceived > 0 ? nowISO() : null,
      recordsSynced: totalInserted,
      recordsReceived: totalReceived,
      recordsProcessed: totalParsed,
      recordsInserted: totalInserted,
      recordsUpdated: totalUpdated,
      recordsSkipped: totalSkipped,
      recordsRejected: totalRejected,
      error: totalRejected > 0 ? `${totalRejected} item(s) failed to persist` : null,
      errorCode: totalRejected > 0 ? "PartialFailure" : null,
      errorClassification: totalReceived === 0 ? "EMPTY_RESPONSE" : (hasFailures ? "SYNC_PARTIAL" : "SYNC_SUCCESS"),
      durationMs: endMs - startMs,
      paginationCount: 1,
    });
    log.info({
      operation: "syncOrderItems",
      stage: "after",
      durationMs: endMs - startMs,
      recordsReceived: totalReceived,
      recordsParsed: totalParsed,
      recordsInserted: totalInserted,
      recordsRejected: totalRejected,
      config: { processedOrders, failedOrders: totalRejected, status, dashboardStatus },
    });
    return this._result("order-items", status, totalReceived, totalParsed, totalInserted, totalUpdated, totalSkipped, totalRejected, totalInserted, null, totalRejected > 0 ? `${totalRejected} item(s) failed` : null, totalRejected > 0 ? "PartialFailure" : null, startTime, nowISO(), endMs - startMs, 1);
  }

  private async syncInventory(clientId: string, traceId?: string): Promise<SyncResult> {
    const log = new AmazonDebugLogger({ traceId, clientId }).child({ module: "inventory" });
    const startTime = nowISO();
    const startMs = Date.now();
    const lastAttemptedAt = startTime;

    await SyncStatusModel.markSyncing({ clientId, module: "inventory" });
    log.info({ operation: "syncInventory", stage: "before", config: { startTime } });

    const marketplaceId = config.amazon.marketplaceId || "";
    let totalReceived = 0;
    let totalParsed = 0;
    let totalInserted = 0;
    let totalUpdated = 0;
    let nextToken: string | null = null;
    let pages = 0;

    log.info({
      operation: "syncInventory",
      stage: "before",
      config: { marketplaceId, pageSize: 100 },
    });

    try {
      do {
        pages += 1;
        log.debug({
          operation: "syncInventory",
          stage: "pagination",
          config: { page: pages, nextToken: nextToken ? "[present]" : null },
        });

        const resp = await amazonSpApi.getInventorySummaries({
          marketplaceIds: marketplaceId ? [marketplaceId] : [],
          maxResults: 100,
          nextToken: nextToken || undefined,
          traceId,
          clientId,
          sellerId: marketplaceId,
        });

        // FBA Inventory v1 returns { payload: { inventorySummaries }, pagination: { nextToken } }.
        const inventoryList = spApiBody(resp).inventorySummaries ?? spApiBody(resp).InventorySummaries;
        const summaries = Array.isArray(inventoryList) ? inventoryList : [];
        nextToken = spApiNextToken(resp);
        totalReceived += summaries.length;
        totalParsed += summaries.length;
        log.info({
          operation: "syncInventory",
          stage: "pagination.after",
          config: { page: pages, recordsReceived: summaries.length, nextPage: Boolean(nextToken), totalReceived },
        });

        for (const item of summaries) {
          const normalized = normalizeInventory(clientId, marketplaceId, item);
          const existing = await InventoryModel.findBySku(clientId, normalized.sellerSku);
          if (existing) {
            await InventoryModel.upsert(normalized as any);
            totalUpdated += 1;
          } else {
            await InventoryModel.upsert(normalized as any);
            totalInserted += 1;
          }
        }
      } while (nextToken);

      const endMs = Date.now();
      // Determine status: EMPTY if 0 records received from Amazon
      const status = totalReceived === 0 ? "EMPTY" : "Synchronized";
      const dashboardStatus = totalReceived === 0 ? "EMPTY" : "SUCCESS";
      await SyncStatusModel.upsert({ clientId, module: "inventory", status, lastSyncAt: nowISO(), lastAttemptedAt, lastSuccessfulAt: totalReceived > 0 ? nowISO() : null, recordsSynced: totalInserted + totalUpdated, recordsReceived: totalReceived, recordsProcessed: totalParsed, recordsInserted: totalInserted, recordsUpdated: totalUpdated, recordsSkipped: 0, recordsRejected: 0, errorClassification: totalReceived === 0 ? "EMPTY_RESPONSE" : "SYNC_SUCCESS", durationMs: endMs - startMs, paginationCount: pages });
      log.info({
        operation: "syncInventory",
        stage: "after",
        durationMs: endMs - startMs,
        recordsReceived: totalReceived,
        recordsParsed: totalParsed,
        recordsInserted: totalInserted,
        recordsUpdated: totalUpdated,
        config: { pages, status, dashboardStatus },
      });
      return this._result("inventory", status, totalReceived, totalParsed, totalInserted, totalUpdated, 0, 0, totalInserted + totalUpdated, null, null, null, startTime, nowISO(), endMs - startMs, pages);
    } catch (err: any) {
      const endMs = Date.now();
      const { status, code, message } = classifyError(err);
      const { classification } = amazonApplicationStatus.classifyAmazonError(err, undefined, message);
      log.error({
        operation: "syncInventory",
        stage: "error",
        durationMs: endMs - startMs,
        errorCode: code,
        errorMessage: message,
        recordsReceived: totalReceived,
        errorClassification: classification,
      });
      await SyncStatusModel.upsert({ clientId, module: "inventory", status, lastSyncAt: nowISO(), lastAttemptedAt, recordsSynced: totalInserted + totalUpdated, recordsReceived: totalReceived, recordsProcessed: totalParsed, recordsInserted: totalInserted, recordsUpdated: totalUpdated, recordsSkipped: 0, recordsRejected: 0, error: message, errorCode: code, errorClassification: classification, durationMs: endMs - startMs, paginationCount: pages });
      return this._result("inventory", status, totalReceived, totalParsed, totalInserted, totalUpdated, 0, 0, totalInserted + totalUpdated, null, message, code, startTime, nowISO(), endMs - startMs, pages);
    }
  }

  private async syncListings(clientId: string, traceId?: string): Promise<SyncResult> {
    const log = new AmazonDebugLogger({ traceId, clientId }).child({ module: "listings" });
    const startTime = nowISO();
    const startMs = Date.now();
    const lastAttemptedAt = startTime;

    await SyncStatusModel.markSyncing({ clientId, module: "listings" });
    log.info({ operation: "syncListings", stage: "before", config: { startTime } });

    const marketplaceId = config.amazon.marketplaceId || "";
    let totalReceived = 0;
    let totalParsed = 0;
    let nextToken: string | null = null;
    let pages = 0;

    log.info({
      operation: "syncListings",
      stage: "before",
      config: { marketplaceId, pageSize: 100 },
    });

    try {
      do {
        pages += 1;
        log.debug({
          operation: "syncListings",
          stage: "pagination",
          config: { page: pages, nextToken: nextToken ? "[present]" : null },
        });

        // searchListingsItems: path needs the Merchant Token (AMAZON_SELLER_ID); max 20 per page.
        const resp = await amazonSpApi.getListingsItems({
          marketplaceIds: marketplaceId ? [marketplaceId] : [],
          maxResults: 20,
          nextToken: nextToken || undefined,
          traceId,
          clientId,
          sellerId: config.amazon.sellerId,
        });

        // Listings Items 2021-08-01 returns { items, pagination: { nextToken } } (no payload wrapper).
        const listingItems = resp?.items ?? spApiBody(resp).Listings;
        const listings = Array.isArray(listingItems) ? listingItems : [];
        nextToken = spApiNextToken(resp);
        totalReceived += listings.length;
        totalParsed += listings.length;
        log.info({
          operation: "syncListings",
          stage: "pagination.after",
          config: { page: pages, recordsReceived: listings.length, nextPage: Boolean(nextToken), totalReceived },
        });

        for (const listing of listings) {
          // Item shape: { sku, summaries[{ marketplaceId, asin, itemName, productType, status[] }],
          // attributes{ name: [{ value }] }, offers[{ price }], fulfillmentAvailability[], issues[] }.
          const summaries: any[] = Array.isArray(listing.summaries) ? listing.summaries : [];
          const summary = summaries.find((x) => x.marketplaceId === marketplaceId) ?? summaries[0] ?? {};
          const sellerSku = listing.sku || listing.SellerSKU || listing.sellerSKU || "";
          const asin = summary.asin || listing.Asin || listing.asin || null;
          const attributes = listing.attributes || listing.Attributes || {};
          const getAttr = (name: string) => {
            const v = attributes[name];
            if (Array.isArray(v)) return v[0]?.value ?? null;
            return v && typeof v === "object" && "values" in v ? v.values?.[0]?.value : null;
          };
          const statuses: string[] = Array.isArray(summary.status) ? summary.status : [];
          const issues: any[] = Array.isArray(listing.issues) ? listing.issues : [];
          const statusRaw = String(listing.ListingStatus || listing.listingStatus || "").toLowerCase();
          let listingStatus: ListingModel.ListingStatus = "Inactive";
          if (statuses.includes("BUYABLE") || statusRaw === "active") listingStatus = "Active";
          else if (statusRaw === "suppressed") listingStatus = "Suppressed";
          else if (statusRaw === "incomplete") listingStatus = "Incomplete";
          else if (statusRaw === "outofstock") listingStatus = "OutOfStock";
          else if (statusRaw === "error" || issues.some((i) => i.severity === "ERROR")) listingStatus = "Error";
          const offer = (Array.isArray(listing.offers) ? listing.offers : []).find((o: any) => o.marketplaceId === marketplaceId) ?? listing.offers?.[0];
          const money = offer?.price ?? listing.Money;
          const availability: any[] = Array.isArray(listing.fulfillmentAvailability) ? listing.fulfillmentAvailability : [];
          const merchantStock = availability.find((f) => f.fulfillmentChannelCode === "DEFAULT");

          await ListingModel.upsert({
            clientId,
            marketplaceId,
            sellerSku,
            asin,
            productTitle: summary.itemName || getAttr("item_name") || null,
            productType: summary.productType || getAttr("product_type") || null,
            brand: getAttr("brand") || null,
            listingStatus,
            fulfilmentChannel: merchantStock ? "FBM" : availability.length > 0 ? "FBA" : null,
            price: money?.amount != null ? Number(money.amount) : null,
            currency: money?.currencyCode || "INR",
            availableInventory: merchantStock?.quantity != null ? Number(merchantStock.quantity) : null,
            lastUpdated: nowISO(),
            listingIssues: issues.length ? issues.map((i) => i.code) : listing.ListingIssues?.map?.((i: any) => i.errorCode) ?? null,
            restrictions: null,
            syncStatus: "Synced",
          } as any);
        }
      } while (nextToken);

      const endMs = Date.now();
      // Determine status: EMPTY if 0 records received from Amazon
      const status = totalReceived === 0 ? "EMPTY" : "Synchronized";
      const dashboardStatus = totalReceived === 0 ? "EMPTY" : "SUCCESS";
      await SyncStatusModel.upsert({ clientId, module: "listings", status, lastSyncAt: nowISO(), lastAttemptedAt, lastSuccessfulAt: totalReceived > 0 ? nowISO() : null, recordsSynced: totalParsed, recordsReceived: totalReceived, recordsProcessed: totalParsed, recordsInserted: totalParsed, recordsUpdated: 0, recordsSkipped: 0, recordsRejected: 0, errorClassification: totalReceived === 0 ? "EMPTY_RESPONSE" : "SYNC_SUCCESS", durationMs: endMs - startMs, paginationCount: pages });
      log.info({
        operation: "syncListings",
        stage: "after",
        durationMs: endMs - startMs,
        recordsReceived: totalReceived,
        recordsParsed: totalParsed,
        config: { pages, status, dashboardStatus },
      });
      return this._result("listings", status, totalReceived, totalParsed, totalParsed, 0, 0, 0, totalParsed, null, null, null, startTime, nowISO(), endMs - startMs, pages);
    } catch (err: any) {
      const endMs = Date.now();
      const { status, code, message } = classifyError(err);
      const { classification } = amazonApplicationStatus.classifyAmazonError(err, undefined, message);
      log.error({
        operation: "syncListings",
        stage: "error",
        durationMs: endMs - startMs,
        errorCode: code,
        errorMessage: message,
        recordsReceived: totalReceived,
        errorClassification: classification,
      });
      await SyncStatusModel.upsert({ clientId, module: "listings", status, lastSyncAt: nowISO(), lastAttemptedAt, recordsSynced: totalParsed, recordsReceived: totalReceived, recordsProcessed: totalParsed, recordsInserted: totalParsed, recordsUpdated: 0, recordsSkipped: 0, recordsRejected: 0, error: message, errorCode: code, errorClassification: classification, durationMs: endMs - startMs, paginationCount: pages });
      return this._result("listings", status, totalReceived, totalParsed, totalParsed, 0, 0, 0, totalParsed, null, message, code, startTime, nowISO(), endMs - startMs, pages);
    }
  }

  private async syncReturns(clientId: string, traceId?: string): Promise<SyncResult> {
    const log = new AmazonDebugLogger({ traceId, clientId }).child({ module: "returns" });
    const startTime = nowISO();
    const startMs = Date.now();
    const lastAttemptedAt = startTime;

    await SyncStatusModel.markSyncing({ clientId, module: "returns" });
    log.info({ operation: "syncReturns", stage: "before", config: { startTime } });

    // Amazon SP-API does not expose a standalone "Get Returns" endpoint for all
    // seller accounts. Returns are surfaced through the Orders API: orders with
    // status Canceled / Unshipped / Pending represent potential customer returns.
    // We fetch those orders live from Amazon, then pull each order's items via the
    // Order Items API to build real return records — never from local/mock data.
    const returnStatuses = ["Canceled", "Unshipped", "Pending"];
    let totalReceived = 0;
    let totalParsed = 0;
    let totalInserted = 0;
    let nextToken: string | null = null;
    let lastUpdatedAfter = null;
    let pages = 0;

    const existing = await SyncStatusModel.findByClientAndModule(clientId, "returns");
    if (existing?.lastCursor) lastUpdatedAfter = existing.lastCursor;
    else lastUpdatedAfter = defaultLookback();

    log.info({
      operation: "syncReturns",
      stage: "before",
      config: { returnStatuses, lookback: lastUpdatedAfter, pageSize: 100 },
      note: "Returns are derived from Orders API. No standalone Get Returns endpoint for all accounts.",
    });

    try {
      do {
        pages += 1;
        log.debug({
          operation: "syncReturns",
          stage: "pagination",
          config: { page: pages, nextToken: nextToken ? "[present]" : null, lastUpdatedAfter },
        });

        const resp = await amazonSpApi.getOrders({
          lastUpdatedAfter,
          orderStatuses: returnStatuses,
          maxResults: 100,
          nextToken: nextToken || undefined,
          traceId,
          clientId,
          sellerId: config.amazon.sellerId,
        });

        // Orders API v0 returns { payload: { Orders, NextToken } }.
        const body = spApiBody(resp);
        const orders = Array.isArray(body.Orders) ? body.Orders : [];
        nextToken = spApiNextToken(resp);
        totalReceived += orders.length;
        log.info({
          operation: "syncReturns",
          stage: "pagination.after",
          config: { page: pages, recordsReceived: orders.length, nextPage: Boolean(nextToken), totalReceived },
        });

        for (const order of orders) {
          const amazonOrderId = order.AmazonOrderId;
          const existingReturn = await ReturnModel.findByAmazonOrderId(clientId, amazonOrderId);
          if (existingReturn) continue;

          totalParsed += 1;
          let quantityReturned = 0;
          let sku = "";
          let asin: string | null = null;
          let productName = "";
          try {
            const itemsResp = await amazonSpApi.getOrderItems({ amazonOrderId, traceId, clientId, sellerId: config.amazon.sellerId });
            const orderItems = spApiBody(itemsResp).OrderItems;
            const items = Array.isArray(orderItems) ? orderItems : [];
            quantityReturned = items.reduce((sum: number, it: any) => sum + Number(it.QuantityOrdered ?? it.Quantity ?? 0), 0);
            const first = items[0] ?? {};
            sku = first.SellerSKU || "";
            asin = first.ASIN || null;
            productName = first.Title || "";
          } catch {
            quantityReturned = Number(order.NumberOfItems || 0);
          }

          await ReturnModel.create({
            clientId,
            amazonOrderId,
            whizunikSalesOrderId: "",
            amazonReturnId: null,
            returnStatus: "ReturnInitiated",
            quantityReturned,
            quantityAccepted: 0,
            quantityDamaged: 0,
            quantityMissing: 0,
            returnReason: null,
            conditionDescription: null,
            refundStatus: order.OrderStatus?.toLowerCase() === "refunded" ? "Processed" : "Pending",
          } as any);
          totalInserted += 1;
        }
      } while (nextToken);

      const endMs = Date.now();
      // Determine status: EMPTY if 0 records received from Amazon
      const status = totalReceived === 0 ? "EMPTY" : "Synchronized";
      const dashboardStatus = totalReceived === 0 ? "EMPTY" : "SUCCESS";
      await SyncStatusModel.upsert({ clientId, module: "returns", status, lastSyncAt: nowISO(), lastAttemptedAt, lastSuccessfulAt: totalReceived > 0 ? nowISO() : null, recordsSynced: totalInserted, recordsReceived: totalReceived, recordsProcessed: totalParsed, recordsInserted: totalInserted, recordsUpdated: 0, recordsSkipped: 0, recordsRejected: 0, errorClassification: totalReceived === 0 ? "EMPTY_RESPONSE" : "SYNC_SUCCESS", durationMs: endMs - startMs, paginationCount: pages });
      log.info({
        operation: "syncReturns",
        stage: "after",
        durationMs: endMs - startMs,
        recordsReceived: totalReceived,
        recordsParsed: totalParsed,
        recordsInserted: totalInserted,
        config: { pages, status, dashboardStatus },
      });
      return this._result("returns", status, totalReceived, totalParsed, totalInserted, 0, 0, 0, totalInserted, null, null, null, startTime, nowISO(), endMs - startMs, pages);
    } catch (err: any) {
      const endMs = Date.now();
      const { status, code, message } = classifyError(err);
      const { classification } = amazonApplicationStatus.classifyAmazonError(err, undefined, message);
      log.error({
        operation: "syncReturns",
        stage: "error",
        durationMs: endMs - startMs,
        errorCode: code,
        errorMessage: message,
        recordsReceived: totalReceived,
        errorClassification: classification,
      });
      await SyncStatusModel.upsert({ clientId, module: "returns", status, lastSyncAt: nowISO(), lastAttemptedAt, recordsSynced: totalInserted, recordsReceived: totalReceived, recordsProcessed: totalParsed, recordsInserted: totalInserted, recordsUpdated: 0, recordsSkipped: 0, recordsRejected: 0, error: message, errorCode: code, errorClassification: classification, durationMs: endMs - startMs, paginationCount: pages });
      return this._result("returns", status, totalReceived, totalParsed, totalInserted, 0, 0, 0, totalInserted, null, message, code, startTime, nowISO(), endMs - startMs, pages);
    }
  }

  private async syncInvoices(clientId: string, traceId?: string): Promise<SyncResult> {
    const log = new AmazonDebugLogger({ traceId, clientId }).child({ module: "invoices" });
    const startTime = nowISO();
    const startMs = Date.now();
    const lastAttemptedAt = startTime;

    await SyncStatusModel.markSyncing({ clientId, module: "invoices" });
    log.info({ operation: "syncInvoices", stage: "before", config: { startTime } });

    if (!config.amazon.isConfigured) {
      const err = new Error("Amazon SP-API is not configured");
      log.error({ operation: "syncInvoices", stage: "error", errorCode: "NotConfigured", errorMessage: err.message });
      await SyncStatusModel.upsert({
        clientId,
        module: "invoices",
        status: "NotConfigured",
        lastAttemptedAt,
        lastSyncAt: nowISO(),
        error: err.message,
        errorCode: "NotConfigured",
        errorClassification: "CONFIGURATION_ERROR",
      });
      return this._result("invoices", "NotConfigured", 0, 0, 0, 0, 0, 0, 0, null, err.message, "NotConfigured", startTime, nowISO(), Date.now() - startMs, 0);
    }

    const marketplaceId = config.amazon.marketplaceId || "";
    const lookbackDays = Math.min(Math.max(1, config.amazon.syncLookbackDays || 30), 30);
    const dataEndTime = new Date(Date.now() - 2 * 60_000).toISOString();
    const minWindowStart = new Date(Date.now() - lookbackDays * 86_400_000);

    const existing = await SyncStatusModel.findByClientAndModule(clientId, "invoices");
    let dataStartTime = minWindowStart.toISOString();
    if (existing?.lastCursor) {
      // Amazon's GST MTR / invoicing reports are populated with a delay, so always re-read a
      // few days before the last cursor. Upserts below are idempotent, so the overlap is safe.
      const overlapMs = 3 * 86_400_000;
      const cursorDate = new Date(new Date(existing.lastCursor).getTime() - overlapMs);
      if (!Number.isNaN(cursorDate.getTime()) && cursorDate >= minWindowStart && cursorDate < new Date(dataEndTime)) {
        dataStartTime = cursorDate.toISOString();
      }
    }

    const isIndia = marketplaceId === "A21TJRUUN4KGV" || String(config.amazon.countryCode || "").toUpperCase() === "IN";
    const reportTypes = isIndia
      ? ["GET_GST_MTR_B2C_CUSTOM", "GET_GST_MTR_B2B_CUSTOM", "GET_FLAT_FILE_ORDER_REPORT_DATA_INVOICING"]
      : ["GET_FLAT_FILE_VAT_INVOICE_DATA_REPORT", "GET_FLAT_FILE_ORDER_REPORT_DATA_INVOICING", "GET_AMAZON_FULFILLED_SHIPMENTS_DATA_INVOICING"];

    let totalReceived = 0;
    let totalParsed = 0;
    let totalInserted = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    let totalRejected = 0;
    let reportsSucceeded = 0;
    let pages = 0;
    let lastError: any = null;
    const failedReports: string[] = [];

    try {
      const collected = new Map<string, ParsedAmazonInvoice>();

      for (const reportType of reportTypes) {
        pages += 1;
        try {
          log.info({
            operation: "syncInvoices",
            stage: "report.request",
            config: { reportType, dataStartTime, dataEndTime, marketplaceId },
          });

          const rep = await amazonSpApi.fetchReportContent({
            reportType,
            marketplaceIds: marketplaceId ? [marketplaceId] : undefined,
            dataStartTime,
            dataEndTime,
            traceId,
            clientId,
            sellerId: config.amazon.sellerId,
          });
          reportsSucceeded += 1;

          if (rep.processingStatus === "DONE_NO_DATA" || !rep.content.trim()) {
            log.info({
              operation: "syncInvoices",
              stage: "report.empty",
              config: { reportType, reportId: rep.reportId, processingStatus: rep.processingStatus },
            });
            continue;
          }

          const tableRows = parseAmazonReportTable(rep.content);
          totalReceived += tableRows.length;
          const parsedInvoices = normalizeInvoiceReportRows(tableRows, reportType);

          log.info({
            operation: "syncInvoices",
            stage: "report.parsed",
            config: { reportType, rawRows: tableRows.length, invoices: parsedInvoices.length },
          });

          for (const inv of parsedInvoices) {
            const key = `${inv.amazonOrderId}::${inv.invoiceNumber || inv.shipmentId || inv.transactionType}`;
            const prev = collected.get(key);
            // Prefer GST MTR reports over generic invoicing report when both contain the same invoice
            if (!prev || (inv.reportType.includes("GST_MTR") && !prev.reportType.includes("GST_MTR"))) {
              collected.set(key, inv);
            }
          }
        } catch (reportErr: any) {
          lastError = reportErr;
          const classified = classifyError(reportErr);
          failedReports.push(`${reportType}: ${classified.message}`.slice(0, 300));
          log.warn({
            operation: "syncInvoices",
            stage: "report.failed",
            config: { reportType, status: classified.status, code: classified.code },
            errorMessage: classified.message,
          });
        }
      }

      if (reportsSucceeded === 0 && lastError) {
        throw lastError;
      }

      const invoicesToPersist = Array.from(collected.values());
      totalParsed = invoicesToPersist.length;

      for (const inv of invoicesToPersist) {
        try {
          const matchingOrder = await OrderModel.findByAmazonOrderId(clientId, inv.amazonOrderId);
          const existingRecord = await InvoiceModel.findByOrderAndInvoiceNumber(
            clientId,
            inv.amazonOrderId,
            inv.invoiceNumber,
          );

          const isCreditOrCancel = /refund|cancel/i.test(inv.transactionType);
          const nextStatus: InvoiceModel.InvoiceRecordStatus = isCreditOrCancel
            ? "Cancelled"
            : inv.invoiceNumber
              ? "InvoiceReceived"
              : "AwaitingAmazonInvoice";

          const recordPayload = {
            whizunikSalesOrderId: matchingOrder?.salesOrderId || existingRecord?.whizunikSalesOrderId || "",
            invoiceNumber: inv.invoiceNumber,
            invoiceIssueDate: inv.invoiceIssueDate,
            issuer: "Amazon" as const,
            amount: inv.grandTotal,
            grandTotal: inv.grandTotal,
            taxableAmount: inv.taxableAmount,
            taxAmount: inv.taxAmount,
            taxRate: inv.taxRate,
            currency: inv.currency,
            status: nextStatus,
            amazonInvoiceId: inv.invoiceNumber || inv.shipmentId || null,
            attachedAt: inv.invoiceNumber ? nowISO() : existingRecord?.attachedAt ?? null,
            notes: `Synced from Amazon SP-API (${inv.reportType}) · ${inv.transactionType}`,
            transactionType: inv.transactionType,
            shipmentId: inv.shipmentId,
            sku: inv.sku,
            asin: inv.asin,
            hsnCode: inv.hsnCode,
            quantity: inv.quantity,
            cgstAmount: inv.cgstAmount,
            sgstAmount: inv.sgstAmount,
            igstAmount: inv.igstAmount,
            utgstAmount: inv.utgstAmount,
            buyerGstin: inv.buyerGstin,
            sellerGstin: inv.sellerGstin,
            placeOfSupply: inv.placeOfSupply,
            irnNumber: inv.irnNumber,
            reportType: inv.reportType,
            isB2B: inv.isB2B,
          };

          let savedId = existingRecord?.id ?? "";
          if (existingRecord) {
            await InvoiceModel.update(existingRecord.id, recordPayload);
            totalUpdated += 1;
          } else {
            const created = await InvoiceModel.create({
              clientId,
              amazonOrderId: inv.amazonOrderId,
              ...recordPayload,
            });
            savedId = created.id;
            totalInserted += 1;
          }

          if (matchingOrder && savedId && inv.invoiceNumber && !isCreditOrCancel) {
            const patch: Partial<OrderModel.MarketplaceAmazonOrder> = {};
            if (!matchingOrder.invoiceRecordId) patch.invoiceRecordId = savedId;
            if (matchingOrder.invoiceStatus === "Pending" || matchingOrder.invoiceStatus === "AwaitingAmazonInvoice") {
              patch.invoiceStatus = "InvoiceReceived";
            }
            if (Object.keys(patch).length > 0) {
              await OrderModel.update(matchingOrder.id, patch);
            }
          }
        } catch (err: any) {
          totalRejected += 1;
          log.error({
            operation: "syncInvoices",
            stage: "db-write",
            config: { amazonOrderId: inv.amazonOrderId, invoiceNumber: inv.invoiceNumber },
            errorCode: err?.code ?? "DbWriteError",
            errorMessage: err?.message ?? String(err),
          });
        }
      }

      const endMs = Date.now();
      // A failed report (e.g. GST MTR denied without the Tax Invoicing role) must not be hidden
      // as EMPTY, and must not move the cursor forward, or that window is never fetched again.
      const anyReportFailed = failedReports.length > 0;
      const status =
        totalRejected > 0 || anyReportFailed
          ? "PARTIAL"
          : totalParsed === 0
            ? "EMPTY"
            : "Synchronized";
      const lastCursor = anyReportFailed ? existing?.lastCursor ?? null : dataEndTime;
      await SyncStatusModel.upsert({
        clientId,
        module: "invoices",
        status,
        lastSyncAt: nowISO(),
        lastAttemptedAt,
        lastSuccessfulAt: totalParsed > 0 ? nowISO() : null,
        recordsSynced: totalInserted + totalUpdated,
        recordsReceived: totalReceived,
        recordsProcessed: totalParsed,
        recordsInserted: totalInserted,
        recordsUpdated: totalUpdated,
        recordsSkipped: totalSkipped,
        recordsRejected: totalRejected,
        lastCursor,
        error: anyReportFailed ? `Some Amazon invoice reports failed: ${failedReports.join(" | ")}` : null,
        errorClassification:
          totalRejected > 0 || anyReportFailed ? "SYNC_PARTIAL" : totalParsed === 0 ? "EMPTY_RESPONSE" : "SYNC_SUCCESS",
        durationMs: endMs - startMs,
        paginationCount: pages,
      });

      log.info({
        operation: "syncInvoices",
        stage: "after",
        durationMs: endMs - startMs,
        recordsReceived: totalReceived,
        recordsParsed: totalParsed,
        recordsInserted: totalInserted,
        recordsUpdated: totalUpdated,
        recordsRejected: totalRejected,
        config: { pages, status },
      });

      return this._result(
        "invoices",
        status,
        totalReceived,
        totalParsed,
        totalInserted,
        totalUpdated,
        totalSkipped,
        totalRejected,
        totalInserted + totalUpdated,
        lastCursor,
        null,
        null,
        startTime,
        nowISO(),
        endMs - startMs,
        pages,
      );
    } catch (err: any) {
      const endMs = Date.now();
      const { status, code, message } = classifyError(err);
      const { classification } = amazonApplicationStatus.classifyAmazonError(err, undefined, message);
      const friendlyMessage =
        status === "AccessRestricted"
          ? `Tax Invoicing (Restricted) permission required in Amazon Seller Central to fetch invoice reports. ${message}`
          : message;

      log.error({
        operation: "syncInvoices",
        stage: "error",
        durationMs: endMs - startMs,
        errorCode: code,
        errorMessage: friendlyMessage,
        recordsReceived: totalReceived,
        errorClassification: classification,
      });

      await SyncStatusModel.upsert({
        clientId,
        module: "invoices",
        status,
        lastSyncAt: nowISO(),
        lastAttemptedAt,
        recordsSynced: totalInserted + totalUpdated,
        recordsReceived: totalReceived,
        recordsProcessed: totalParsed,
        recordsInserted: totalInserted,
        recordsUpdated: totalUpdated,
        recordsSkipped: totalSkipped,
        recordsRejected: totalRejected,
        httpStatus: err?.status ?? (status === "AccessRestricted" ? 403 : null),
        error: friendlyMessage,
        errorCode: code,
        errorClassification: classification,
        durationMs: endMs - startMs,
        paginationCount: pages,
      });

      return this._result(
        "invoices",
        status,
        totalReceived,
        totalParsed,
        totalInserted,
        totalUpdated,
        totalSkipped,
        totalRejected,
        totalInserted + totalUpdated,
        null,
        friendlyMessage,
        code,
        startTime,
        nowISO(),
        endMs - startMs,
        pages,
      );
    }
  }

  private _result(
    module: Module,
    status: SyncStatus,
    recordsReceived: number,
    recordsParsed: number,
    recordsInserted: number,
    recordsUpdated: number,
    recordsSkipped: number,
    recordsRejected: number,
    recordsSynced: number,
    lastCursor: string | null,
    error: string | null,
    errorCode: string | null,
    startTime: string,
    endTime: string,
    durationMs: number,
    paginationCount: number,
  ): SyncResult {
    return {
      module,
      status,
      recordsReceived,
      recordsParsed,
      recordsInserted,
      recordsUpdated,
      recordsSkipped,
      recordsRejected,
      recordsSynced,
      lastCursor,
      error,
      errorCode,
      startTime,
      endTime,
      durationMs,
      paginationCount,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Dispatch
  // ──────────────────────────────────────────────────────────────────────────

  async run(module: Module, clientId: string, traceId?: string): Promise<SyncResult> {
    switch (module) {
      case "orders": return this.syncOrders(clientId, traceId);
      case "order-items": return this.syncOrderItems(clientId, traceId);
      case "inventory": return this.syncInventory(clientId, traceId);
      case "listings": return this.syncListings(clientId, traceId);
      case "returns": return this.syncReturns(clientId, traceId);
      case "invoices": return this.syncInvoices(clientId, traceId);
    }
  }
}

export const amazonSync = new AmazonSyncService();

// ─────────────────────────────────────────────────────────────────────────────
// Queue processor (background) — instrumented
// ─────────────────────────────────────────────────────────────────────────────

interface SyncQueueEntry {
  module: Module;
  clientId: string;
  traceId?: string;
  resolve: (v: any) => void;
  reject: (e: any) => void;
  log: AmazonDebugLogger;
  retryCount?: number;
}

const syncQueue: SyncQueueEntry[] = [];
let queueProcessing = false;

async function processQueue() {
  if (queueProcessing) return;
  queueProcessing = true;
  let item: SyncQueueEntry | undefined;
  while ((item = syncQueue.shift())) {
    const log = item.log;
    log.info({ operation: "sync.queue.process", stage: "before", config: { module: item.module, queueRemaining: syncQueue.length } });
    try {
      const result = await amazonSync.run(item.module, item.clientId, item.traceId);
      log.info({ operation: "sync.queue.process", stage: "after", config: { module: item.module, status: result.status, records: result.recordsSynced, recordsReceived: result.recordsReceived } });
      item.resolve(result);
    } catch (err) {
      const e = err as any;
      log.error({ operation: "sync.queue.process", stage: "error", config: { module: item.module }, errorMessage: e?.message ?? String(e) });
      const retryable = /(429|503|timeout|throttl|temporar)/i.test(`${e?.message ?? ""}${e?.code ?? ""}`);
      if (retryable && (item.retryCount ?? 0) < 1) {
        log.warn({ operation: "sync.queue.retry", stage: "scheduled", config: { module: item.module, retryCount: 1 } });
        const retryEntry: SyncQueueEntry = { ...item, retryCount: 1 };
        setTimeout(() => {
          syncQueue.push(retryEntry);
          void processQueue();
        }, 1000);
        continue;
      }
      item.reject(err);
    }
  }
  queueProcessing = false;
}

/** Start the scheduled background sync (runs every sync interval). */
let scheduledSyncRunning = false;

export function startScheduledSync(intervalMs = 15 * 60 * 1000) {
  setInterval(async () => {
    if (scheduledSyncRunning) {
      console.warn("[amazon-sync] Skipping scheduled cycle because the previous cycle is still running");
      return;
    }
    scheduledSyncRunning = true;
    try {
      const { scanByType } = await import("../dynamodb.js");
      const clients = await scanByType("User", { limit: 1000 });
      const clientIds = Array.from(new Set(clients.map((c: any) => c.id).filter(Boolean)));
      for (const clientId of clientIds) {
        try {
          await amazonSync.syncAll(clientId);
        } catch (err) {
          console.error(`[amazon-sync] scheduled sync failed for client ${clientId}:`, err);
        }
      }
    } catch (err) {
      console.error("[amazon-sync] scheduled sync cycle error:", err);
    } finally {
      scheduledSyncRunning = false;
    }
  }, intervalMs).unref?.();
}
