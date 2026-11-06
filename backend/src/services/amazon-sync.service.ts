import { amazonSpApi, generateTraceId } from "./amazon-spapi.service.js";
import { AmazonDebugLogger } from "./amazon-spapi.service.js";
import * as OrderModel from "../models/marketplace-amazon-order.js";
import * as SyncStatusModel from "../models/marketplace-amazon-sync-status.js";
import * as InventoryModel from "../models/marketplace-amazon-inventory.js";
import * as ListingModel from "../models/marketplace-amazon-listing.js";
import * as ReturnModel from "../models/marketplace-amazon-return.js";
import * as RefundModel from "../models/marketplace-amazon-refund.js";
import { config } from "../config.js";
import * as db from "../dynamodb.js";

type Module = SyncStatusModel.MarketplaceAmazonSyncStatus["module"];

export interface SyncResult {
  module: Module;
  status: SyncStatusModel.SyncStatus;
  recordsSynced: number;
  lastCursor: string | null;
  error: string | null;
  errorCode: string | null;
  startTime: string;
  endTime: string | null;
  durationMs: number;
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
  const sku = firstItem.SellerSKU || order.PurchaseOrderNumber || "";
  const productName = firstItem.Title || "";
  const quantity = items.reduce((sum: number, it: any) => sum + Number(it.Quantity || 0), 0) || Number(order.NumberOfItems || 1);
  const price = Number(firstItem.ItemPrice?.Amount || firstItem.UnitPrice?.Amount || 0);
  const currency = firstItem.ItemPrice?.CurrencyCode || order.MarketplaceTaxInfo?.[0]?.CurrencyCode || "INR";
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
    quantity: Number(item.Quantity || 0),
    unitPrice: Number(item.ItemPrice?.Amount || 0),
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
  const fnsku = item.FNSKU || item.fnsku || null;
  const fulfilment = item.FulfilmentChannel || item.fulfilmentChannel || null;
  const fulfilmentChannel = fulfilment === "AFN" ? "FBA" : fulfilment === "MFN" ? "FBM" : null;
  const available = Number(item.Quantity?.AvailableQuantity ?? item.Quantity?.availableQuantity ?? 0);
  const reserved = Number(item.Quantity?.ReservedQuantity ?? item.Quantity?.reservedQuantity ?? 0);
  const inbound = Number(item.Quantity?.InboundQuantity ?? item.Quantity?.inboundQuantity ?? 0);
  const unfulfillable = Number(item.Quantity?.UnfulfillableQuantity ?? item.Quantity?.unfulfillableQuantity ?? 0);
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

export class AmazonSyncService {
  private readonly log: AmazonDebugLogger;

  constructor() {
    this.log = new AmazonDebugLogger({ module: "sync-service" });
  }

  /** Enqueue a sync and return when complete. */
  async sync(module: Module, clientId: string, traceId?: string): Promise<SyncResult> {
    return new Promise((resolve, reject) => {
      const log = new AmazonDebugLogger({ traceId, clientId }).child({ module });
      log.info({ operation: "sync.enqueue", stage: "before", config: { module } });
      const entry = { module, clientId, traceId, resolve, reject, log };
      syncQueue.push(entry);
      void processQueue();
    });
  }

  /** Sync all modules for a client. */
  async syncAll(clientId: string, traceId?: string): Promise<Record<Module, SyncResult>> {
    const log = new AmazonDebugLogger({ traceId, clientId }).child({ module: "all" });
    log.info({ operation: "syncAll.enqueue", stage: "before", config: { modules: ["orders", "order-items", "inventory", "listings", "returns"] } });

    const modules: Module[] = ["orders", "order-items", "inventory", "listings", "returns"];
    const results: Record<Module, SyncResult> = {} as any;
    for (const module of modules) {
      // Order Items depends on Orders - if Orders failed, mark Order Items as BLOCKED
      if (module === "order-items") {
        const ordersResult = results["orders"];
        if (ordersResult && (ordersResult.status === "Failed" || ordersResult.status === "AuthenticationError" || ordersResult.status === "AccessRestricted" || ordersResult.status === "NotConfigured")) {
          log.warn({
            operation: "syncAll",
            stage: "dependency-blocked",
            config: { module: "order-items", dependency: "orders", dependencyStatus: ordersResult.status, dependencyError: ordersResult.error },
          });
          results["order-items"] = this._result("order-items", "Blocked", 0, null, `Orders dependency failed: ${ordersResult.error || "unknown error"}`, "DependencyFailed", nowISO(), nowISO(), 0);
          continue;
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
      records: s.recordsSynced,
      error: s.error,
      errorCode: s.errorCode,
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

    await SyncStatusModel.markSyncing({ clientId, module: "orders" });
    log.info({ operation: "syncOrders", stage: "before", config: { startTime } });

    if (!config.amazon.isConfigured) {
      const err = new Error("Amazon SP-API is not configured");
      log.error({ operation: "syncOrders", stage: "error", errorCode: "NotConfigured", errorMessage: err.message });
      await SyncStatusModel.upsert({ clientId, module: "orders", status: "NotConfigured", error: err.message, errorCode: "NotConfigured" });
      return this._result("orders", "NotConfigured", 0, null, err.message, "NotConfigured", startTime, nowISO(), Date.now() - startMs);
    }

    let total = 0;
    let nextToken: string | null = null;
    let lastUpdatedAfter = null;
    let pages = 0;

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

        const orders = Array.isArray(resp.Orders) ? resp.Orders : [];
        nextToken = resp.NextToken || null;
        log.info({
          operation: "syncOrders",
          stage: "pagination.after",
          config: { page: pages, recordsReceived: orders.length, nextPage: Boolean(nextToken) },
        });

        let inserted = 0;
        let updated = 0;
        let skipped = 0;
        let failed = 0;

        for (const order of orders) {
          try {
            const normalized = normalizeOrder(clientId, order);
            const existingOrder = await OrderModel.findByAmazonOrderId(clientId, normalized.amazonOrderId);
            if (existingOrder) {
              await OrderModel.update(existingOrder.id, {
                orderDate: normalized.orderDate,
                amazonOrderStatus: normalized.amazonOrderStatus,
                sellingPrice: normalized.sellingPrice,
                quantity: normalized.quantity,
                updatedAt: nowISO(),
              });
              updated += 1;
            } else {
              await OrderModel.create(normalized as any);
              inserted += 1;
            }
            total += 1;
          } catch (err: any) {
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

        log.info({
          operation: "syncOrders",
          stage: "db-write.summary",
          config: { page: pages, inserted, updated, skipped, failed, total },
        });
      } while (nextToken);

      const lastCursor = lastUpdatedAfter || defaultLookback();
      const endMs = Date.now();
      await SyncStatusModel.upsert({
        clientId,
        module: "orders",
        status: "Synchronized",
        lastSyncAt: nowISO(),
        recordsSynced: total,
        lastCursor: lastCursor,
      });
      log.info({
        operation: "syncOrders",
        stage: "after",
        durationMs: endMs - startMs,
        recordsReceived: total,
        recordsSaved: total,
        config: { pages, lastCursor },
      });
      return this._result("orders", "Synchronized", total, lastCursor, null, null, startTime, nowISO(), endMs - startMs);
    } catch (err: any) {
      const endMs = Date.now();
      const { status, code, message } = classifyError(err);
      log.error({
        operation: "syncOrders",
        stage: "error",
        durationMs: endMs - startMs,
        errorCode: code,
        errorMessage: message,
        recordsReceived: total,
      });
      await SyncStatusModel.upsert({
        clientId,
        module: "orders",
        status,
        lastSyncAt: nowISO(),
        recordsSynced: total,
        error: message,
        errorCode: code,
      });
      return this._result("orders", status, total, null, message, code, startTime, nowISO(), endMs - startMs);
    }
  }

  private async syncOrderItems(clientId: string, traceId?: string): Promise<SyncResult> {
    const log = new AmazonDebugLogger({ traceId, clientId }).child({ module: "order-items" });
    const startTime = nowISO();
    const startMs = Date.now();

    await SyncStatusModel.markSyncing({ clientId, module: "order-items" });
    log.info({ operation: "syncOrderItems", stage: "before", config: { startTime } });

    const orders = await OrderModel.list(clientId);
    log.info({
      operation: "syncOrderItems",
      stage: "before",
      config: { sourceOrders: orders.length },
    });

    let total = 0;
    let failed = 0;
    let processedOrders = 0;

    for (const order of orders) {
      processedOrders += 1;
      try {
        const resp = await amazonSpApi.getOrderItems({ amazonOrderId: order.amazonOrderId, traceId, clientId, sellerId: config.amazon.sellerId });
        const items = Array.isArray(resp.OrderItems) ? resp.OrderItems : [];
        log.debug({
          operation: "syncOrderItems",
          stage: "pagination.after",
          config: { amazonOrderId: order.amazonOrderId, recordsReceived: items.length },
        });

        let inserted = 0;
        for (const item of items) {
          try {
            const normalized = normalizeOrderItem(clientId, order.amazonOrderId, item);
            const id = `${order.amazonOrderId}#${item.LineNumber || item.lineNumber || total}`;
            await db.putItem({
              pk: `MARKETPLACE_AMAZON_ORDER_ITEM#${order.amazonOrderId}`,
              sk: `MARKETPLACE_AMAZON_ORDER_ITEM#${id}`,
              gsi1pk: `CLIENT#${clientId}`,
              gsi1sk: `MarketplaceAmazonOrderItem#${nowISO()}`,
              entityType: "MarketplaceAmazonOrderItem",
              id,
              orderId: order.id,
              ...normalized,
              createdAt: nowISO(),
              updatedAt: nowISO(),
            } as any);
            inserted += 1;
            total += 1;
          } catch (err: any) {
            failed += 1;
            log.error({
              operation: "syncOrderItems",
              stage: "db-write",
              config: { amazonOrderId: order.amazonOrderId, lineNumber: item.LineNumber },
              errorCode: err?.code ?? "DbWriteError",
              errorMessage: err?.message ?? String(err),
            });
          }
        }

        log.info({
          operation: "syncOrderItems",
          stage: "db-write.summary",
          config: { amazonOrderId: order.amazonOrderId, itemsReceived: items.length, inserted },
        });
      } catch (err: any) {
        failed += 1;
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
    const status = failed > 0 && total === 0 ? "Failed" : "Synchronized";
    await SyncStatusModel.upsert({
      clientId,
      module: "order-items",
      status,
      lastSyncAt: nowISO(),
      recordsSynced: total,
      error: failed > 0 ? `${failed} order(s) failed to fetch items` : null,
      errorCode: failed > 0 ? "PartialFailure" : null,
    });
    log.info({
      operation: "syncOrderItems",
      stage: "after",
      durationMs: endMs - startMs,
      recordsReceived: total,
      recordsSaved: total,
      recordsFailed: failed,
      config: { processedOrders, failedOrders: failed },
    });
    return this._result("order-items", status, total, null, failed > 0 ? `${failed} order(s) failed` : null, failed > 0 ? "PartialFailure" : null, startTime, nowISO(), endMs - startMs);
  }

  private async syncInventory(clientId: string, traceId?: string): Promise<SyncResult> {
    const log = new AmazonDebugLogger({ traceId, clientId }).child({ module: "inventory" });
    const startTime = nowISO();
    const startMs = Date.now();

    await SyncStatusModel.markSyncing({ clientId, module: "inventory" });
    log.info({ operation: "syncInventory", stage: "before", config: { startTime } });

    const marketplaceId = config.amazon.marketplaceId || "";
    let total = 0;
    let nextToken: string | null = null;
    let pages = 0;
    let inserted = 0;
    let updated = 0;

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

        const summaries = Array.isArray(resp.InventorySummaries) ? resp.InventorySummaries : [];
        nextToken = resp.NextToken || null;
        log.info({
          operation: "syncInventory",
          stage: "pagination.after",
          config: { page: pages, recordsReceived: summaries.length, nextPage: Boolean(nextToken) },
        });

        for (const item of summaries) {
          const normalized = normalizeInventory(clientId, marketplaceId, item);
          const existing = await InventoryModel.findBySku(clientId, normalized.sellerSku);
          if (existing) {
            await InventoryModel.upsert(normalized as any);
            updated += 1;
          } else {
            await InventoryModel.upsert(normalized as any);
            inserted += 1;
          }
          total += 1;
        }
      } while (nextToken);

      const endMs = Date.now();
      await SyncStatusModel.upsert({ clientId, module: "inventory", status: "Synchronized", lastSyncAt: nowISO(), recordsSynced: total });
      log.info({
        operation: "syncInventory",
        stage: "after",
        durationMs: endMs - startMs,
        recordsReceived: total,
        recordsSaved: total,
        config: { pages, inserted, updated },
      });
      return this._result("inventory", "Synchronized", total, null, null, null, startTime, nowISO(), endMs - startMs);
    } catch (err: any) {
      const endMs = Date.now();
      const { status, code, message } = classifyError(err);
      log.error({
        operation: "syncInventory",
        stage: "error",
        durationMs: endMs - startMs,
        errorCode: code,
        errorMessage: message,
        recordsReceived: total,
      });
      await SyncStatusModel.upsert({ clientId, module: "inventory", status, lastSyncAt: nowISO(), recordsSynced: total, error: message, errorCode: code });
      return this._result("inventory", status, total, null, message, code, startTime, nowISO(), endMs - startMs);
    }
  }

  private async syncListings(clientId: string, traceId?: string): Promise<SyncResult> {
    const log = new AmazonDebugLogger({ traceId, clientId }).child({ module: "listings" });
    const startTime = nowISO();
    const startMs = Date.now();

    await SyncStatusModel.markSyncing({ clientId, module: "listings" });
    log.info({ operation: "syncListings", stage: "before", config: { startTime } });

    const marketplaceId = config.amazon.marketplaceId || "";
    let total = 0;
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

        const resp = await amazonSpApi.getListingsItems({
          marketplaceIds: marketplaceId ? [marketplaceId] : [],
          maxResults: 100,
          nextToken: nextToken || undefined,
          traceId,
          clientId,
          sellerId: marketplaceId,
        });

        const listings = Array.isArray(resp.Listings) ? resp.Listings : [];
        nextToken = resp.NextToken || null;
        log.info({
          operation: "syncListings",
          stage: "pagination.after",
          config: { page: pages, recordsReceived: listings.length, nextPage: Boolean(nextToken) },
        });

        for (const listing of listings) {
          const sellerSku = listing.SellerSKU || listing.sellerSKU || "";
          const asin = listing.Asin || listing.asin || null;
          const attributes = listing.Attributes || {};
          const getAttr = (name: string) => {
            const v = attributes[name];
            return v && typeof v === "object" && "values" in v ? v.values?.[0]?.value : null;
          };
          const statusRaw = String(listing.ListingStatus || listing.listingStatus || "").toLowerCase();
          let listingStatus: ListingModel.ListingStatus = "Inactive";
          if (statusRaw === "active") listingStatus = "Active";
          else if (statusRaw === "suppressed") listingStatus = "Suppressed";
          else if (statusRaw === "incomplete") listingStatus = "Incomplete";
          else if (statusRaw === "outofstock") listingStatus = "OutOfStock";
          else if (statusRaw === "error") listingStatus = "Error";

          await ListingModel.upsert({
            clientId,
            marketplaceId,
            sellerSku,
            asin,
            productTitle: getAttr("item_name") || null,
            productType: getAttr("product_type") || null,
            brand: getAttr("brand") || null,
            listingStatus,
            fulfilmentChannel: null,
            price: listing.Money?.amount ? Number(listing.Money.amount) : null,
            currency: listing.Money?.currencyCode || "INR",
            availableInventory: null,
            lastUpdated: nowISO(),
            listingIssues: listing.ListingIssues?.map?.((i: any) => i.errorCode) ?? null,
            restrictions: null,
            syncStatus: "Synced",
          } as any);
          total += 1;
        }
      } while (nextToken);

      const endMs = Date.now();
      await SyncStatusModel.upsert({ clientId, module: "listings", status: "Synchronized", lastSyncAt: nowISO(), recordsSynced: total });
      log.info({
        operation: "syncListings",
        stage: "after",
        durationMs: endMs - startMs,
        recordsReceived: total,
        recordsSaved: total,
        config: { pages },
      });
      return this._result("listings", "Synchronized", total, null, null, null, startTime, nowISO(), endMs - startMs);
    } catch (err: any) {
      const endMs = Date.now();
      const { status, code, message } = classifyError(err);
      log.error({
        operation: "syncListings",
        stage: "error",
        durationMs: endMs - startMs,
        errorCode: code,
        errorMessage: message,
        recordsReceived: total,
      });
      await SyncStatusModel.upsert({ clientId, module: "listings", status, lastSyncAt: nowISO(), recordsSynced: total, error: message, errorCode: code });
      return this._result("listings", status, total, null, message, code, startTime, nowISO(), endMs - startMs);
    }
  }

  private async syncReturns(clientId: string, traceId?: string): Promise<SyncResult> {
    const log = new AmazonDebugLogger({ traceId, clientId }).child({ module: "returns" });
    const startTime = nowISO();
    const startMs = Date.now();

    await SyncStatusModel.markSyncing({ clientId, module: "returns" });
    log.info({ operation: "syncReturns", stage: "before", config: { startTime } });

    // Amazon SP-API does not expose a standalone "Get Returns" endpoint for all
    // seller accounts. Returns are surfaced through the Orders API: orders with
    // status Refunded / Returned / Cancelled represent customer returns. We fetch
    // those orders live from Amazon, then pull each order's items via the Order
    // Items API to build real return records — never from local/mock data.
    const returnStatuses = ["Refunded", "Returned", "Cancelled"];
    let total = 0;
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
      note: "Returns are derived from Orders API (Refunded/Returned/Cancelled). No standalone Get Returns endpoint for all accounts.",
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

        const orders = Array.isArray(resp.Orders) ? resp.Orders : [];
        nextToken = resp.NextToken || null;
        log.info({
          operation: "syncReturns",
          stage: "pagination.after",
          config: { page: pages, recordsReceived: orders.length, nextPage: Boolean(nextToken) },
        });

        for (const order of orders) {
          const amazonOrderId = order.AmazonOrderId;
          const existingReturn = await ReturnModel.findByAmazonOrderId(clientId, amazonOrderId);
          if (existingReturn) continue;

          let quantityReturned = 0;
          let sku = "";
          let asin: string | null = null;
          let productName = "";
          try {
            const itemsResp = await amazonSpApi.getOrderItems({ amazonOrderId, traceId, clientId, sellerId: config.amazon.sellerId });
            const items = Array.isArray(itemsResp.OrderItems) ? itemsResp.OrderItems : [];
            quantityReturned = items.reduce((sum: number, it: any) => sum + Number(it.Quantity || 0), 0);
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
          total += 1;
        }
      } while (nextToken);

      const endMs = Date.now();
      await SyncStatusModel.upsert({ clientId, module: "returns", status: "Synchronized", lastSyncAt: nowISO(), recordsSynced: total });
      log.info({
        operation: "syncReturns",
        stage: "after",
        durationMs: endMs - startMs,
        recordsReceived: total,
        recordsSaved: total,
        config: { pages },
      });
      return this._result("returns", "Synchronized", total, null, null, null, startTime, nowISO(), endMs - startMs);
    } catch (err: any) {
      const endMs = Date.now();
      const { status, code, message } = classifyError(err);
      log.error({
        operation: "syncReturns",
        stage: "error",
        durationMs: endMs - startMs,
        errorCode: code,
        errorMessage: message,
        recordsReceived: total,
      });
      await SyncStatusModel.upsert({ clientId, module: "returns", status, lastSyncAt: nowISO(), recordsSynced: total, error: message, errorCode: code });
      return this._result("returns", status, total, null, message, code, startTime, nowISO(), endMs - startMs);
    }
  }

  private _result(
    module: Module,
    status: SyncStatus,
    recordsSynced: number,
    lastCursor: string | null,
    error: string | null,
    errorCode: string | null,
    startTime: string,
    endTime: string,
    durationMs: number,
  ): SyncResult {
    return { module, status, recordsSynced, lastCursor, error, errorCode, startTime, endTime, durationMs };
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
      log.info({ operation: "sync.queue.process", stage: "after", config: { module: item.module, status: result.status, records: result.recordsSynced } });
      item.resolve(result);
    } catch (err) {
      const e = err as any;
      log.error({ operation: "sync.queue.process", stage: "error", config: { module: item.module }, errorMessage: e?.message ?? String(e) });
      item.reject(err);
    }
  }
  queueProcessing = false;
}

/** Start the scheduled background sync (runs every sync interval). */
export function startScheduledSync(intervalMs = 15 * 60 * 1000) {
  setInterval(async () => {
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
    }
  }, intervalMs).unref?.();
}
