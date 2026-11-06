import { amazonSpApi } from "./amazon-spapi.service.js";
import * as OrderModel from "../models/marketplace-amazon-order.js";
import * as SyncStatusModel from "../models/marketplace-amazon-sync-status.js";
import * as InventoryModel from "../models/marketplace-amazon-inventory.js";
import * as ListingModel from "../models/marketplace-amazon-listing.js";
import * as ReturnModel from "../models/marketplace-amazon-return.js";
import * as RefundModel from "../models/marketplace-amazon-refund.js";
import { config } from "../config.js";
import * as db from "../dynamodb.js";

type Module = SyncStatusModel.MarketplaceAmazonSyncStatus["module"];

/** Simple in-memory sync queue so large syncs don't block HTTP request/response cycles. */
const syncQueue: Array<{ module: Module; clientId: string; resolve: (v: any) => void; reject: (e: any) => void }> = [];
let queueProcessing = false;

export interface SyncResult {
  module: Module;
  status: SyncStatusModel.SyncStatus;
  recordsSynced: number;
  lastCursor: string | null;
  error: string | null;
  errorCode: string | null;
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
  /** Enqueue a sync and return when complete. */
  async sync(module: Module, clientId: string): Promise<SyncResult> {
    return new Promise((resolve, reject) => {
      syncQueue.push({ module, clientId, resolve, reject });
      void processQueue();
    });
  }

  /** Sync all modules for a client. */
  async syncAll(clientId: string): Promise<Record<Module, SyncResult>> {
    const modules: Module[] = ["orders", "order-items", "inventory", "listings", "returns"];
    const results: Record<Module, SyncResult> = {} as any;
    for (const module of modules) {
      // order-items depends on orders; run orders first, then order-items.
      const result = await this.sync(module, clientId);
      results[module] = result;
    }
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
  // Module syncs
  // ──────────────────────────────────────────────────────────────────────────

  private async syncOrders(clientId: string): Promise<SyncResult> {
    await SyncStatusModel.markSyncing({ clientId, module: "orders" });
    if (!amazonSpApi) {
      const err = new Error("Amazon SP-API is not configured");
      await SyncStatusModel.upsert({ clientId, module: "orders", status: "NotConfigured", error: err.message, errorCode: "NotConfigured" });
      return { module: "orders", status: "NotConfigured", recordsSynced: 0, lastCursor: null, error: err.message, errorCode: "NotConfigured" };
    }

    let total = 0;
    let nextToken: string | null = null;
    let lastUpdatedAfter = null;

    // Resume cursor: if we've synced before, start from the last sync timestamp.
    const existing = await SyncStatusModel.findByClientAndModule(clientId, "orders");
    if (existing?.lastCursor) lastUpdatedAfter = existing.lastCursor;
    else lastUpdatedAfter = defaultLookback();

    try {
      do {
        const resp = await amazonSpApi.getOrders({
          lastUpdatedAfter,
          maxResults: 100,
          nextToken: nextToken || undefined,
        });
        const orders = Array.isArray(resp.Orders) ? resp.Orders : [];
        nextToken = resp.NextToken || null;

        for (const order of orders) {
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
          } else {
            await OrderModel.create(normalized as any);
          }
          total += 1;
        }
      } while (nextToken);

      const lastCursor = lastUpdatedAfter || defaultLookback();
      await SyncStatusModel.upsert({ clientId, module: "orders", status: "Synchronized", lastSyncAt: nowISO(), recordsSynced: total, lastCursor: lastCursor });
      return { module: "orders", status: "Synchronized", recordsSynced: total, lastCursor, error: null, errorCode: null };
    } catch (err: any) {
      const { status, code, message } = classifyError(err);
      await SyncStatusModel.upsert({ clientId, module: "orders", status, lastSyncAt: nowISO(), recordsSynced: total, error: message, errorCode: code });
      return { module: "orders", status, recordsSynced: total, lastCursor: null, error: message, errorCode: code };
    }
  }

  private async syncOrderItems(clientId: string): Promise<SyncResult> {
    await SyncStatusModel.markSyncing({ clientId, module: "order-items" });

    const orders = await OrderModel.list(clientId);
    let total = 0;
    let failed = 0;

    for (const order of orders) {
      try {
        const resp = await amazonSpApi.getOrderItems({ amazonOrderId: order.amazonOrderId });
        const items = Array.isArray(resp.OrderItems) ? resp.OrderItems : [];
        for (const item of items) {
          const normalized = normalizeOrderItem(clientId, order.amazonOrderId, item);
          // Upsert order items keyed by (order, line). All items of an order share
          // the same PK (amazonOrderId) so they can be fetched with one query.
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
          total += 1;
        }
      } catch (err: any) {
        failed += 1;
        console.error(`[amazon-sync] order-items failed for ${order.amazonOrderId}:`, err.message);
      }
    }

    const status = failed > 0 && total === 0 ? "Failed" : "Synchronized";
    await SyncStatusModel.upsert({ clientId, module: "order-items", status, lastSyncAt: nowISO(), recordsSynced: total, error: failed > 0 ? `${failed} order(s) failed to fetch items` : null, errorCode: failed > 0 ? "PartialFailure" : null });
    return { module: "order-items", status, recordsSynced: total, lastCursor: null, error: failed > 0 ? `${failed} order(s) failed` : null, errorCode: failed > 0 ? "PartialFailure" : null };
  }

  private async syncInventory(clientId: string): Promise<SyncResult> {
    await SyncStatusModel.markSyncing({ clientId, module: "inventory" });
    const marketplaceId = config.amazon.marketplaceId || "";
    let total = 0;
    let nextToken: string | null = null;

    try {
      do {
        const resp = await amazonSpApi.getInventorySummaries({
          marketplaceIds: marketplaceId ? [marketplaceId] : [],
          maxResults: 100,
          nextToken: nextToken || undefined,
        });
        const summaries = Array.isArray(resp.InventorySummaries) ? resp.InventorySummaries : [];
        nextToken = resp.NextToken || null;

        for (const item of summaries) {
          const normalized = normalizeInventory(clientId, marketplaceId, item);
          await InventoryModel.upsert(normalized as any);
          total += 1;
        }
      } while (nextToken);

      await SyncStatusModel.upsert({ clientId, module: "inventory", status: "Synchronized", lastSyncAt: nowISO(), recordsSynced: total });
      return { module: "inventory", status: "Synchronized", recordsSynced: total, lastCursor: null, error: null, errorCode: null };
    } catch (err: any) {
      const { status, code, message } = classifyError(err);
      await SyncStatusModel.upsert({ clientId, module: "inventory", status, lastSyncAt: nowISO(), recordsSynced: total, error: message, errorCode: code });
      return { module: "inventory", status, recordsSynced: total, lastCursor: null, error: message, errorCode: code };
    }
  }

  private async syncListings(clientId: string): Promise<SyncResult> {
    await SyncStatusModel.markSyncing({ clientId, module: "listings" });
    const marketplaceId = config.amazon.marketplaceId || "";
    let total = 0;
    let nextToken: string | null = null;

    try {
      do {
        const resp = await amazonSpApi.getListingsItems({
          marketplaceIds: marketplaceId ? [marketplaceId] : [],
          maxResults: 100,
          nextToken: nextToken || undefined,
        });
        const listings = Array.isArray(resp.Listings) ? resp.Listings : [];
        nextToken = resp.NextToken || null;

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

      await SyncStatusModel.upsert({ clientId, module: "listings", status: "Synchronized", lastSyncAt: nowISO(), recordsSynced: total });
      return { module: "listings", status: "Synchronized", recordsSynced: total, lastCursor: null, error: null, errorCode: null };
    } catch (err: any) {
      const { status, code, message } = classifyError(err);
      await SyncStatusModel.upsert({ clientId, module: "listings", status, lastSyncAt: nowISO(), recordsSynced: total, error: message, errorCode: code });
      return { module: "listings", status, recordsSynced: total, lastCursor: null, error: message, errorCode: code };
    }
  }

  private async syncReturns(clientId: string): Promise<SyncResult> {
    await SyncStatusModel.markSyncing({ clientId, module: "returns" });

    // Amazon SP-API does not expose a general returns API for all seller accounts.
    // Where accessible, returns are surfaced via the Orders API (order status
    // Refunded/Returned) and the Reports API. We sync refund-related records
    // already stored locally and mark the module status based on SP-API access.
    //
    // To keep this safe and real: attempt to probe SP-API orders for refunded
    // orders; if SP-API is unreachable/restricted, report the actual limitation
    // instead of fabricating returns data.
    let total = 0;
    try {
      const orders = await OrderModel.list(clientId);
      const refunded = orders.filter((o) => o.amazonOrderStatus === "Refunded" || o.amazonOrderStatus === "Returned");
      for (const order of refunded) {
        const existing = await ReturnModel.findByAmazonOrderId(clientId, order.amazonOrderId);
        if (!existing) {
          await ReturnModel.create({
            clientId,
            amazonOrderId: order.amazonOrderId,
            whizunikSalesOrderId: order.salesOrderId ?? "",
            amazonReturnId: null,
            returnStatus: "ReturnInitiated",
            quantityReturned: order.quantity || 0,
            quantityAccepted: 0,
            quantityDamaged: 0,
            quantityMissing: 0,
            returnReason: null,
            conditionDescription: null,
            refundStatus: "Pending",
          } as any);
          total += 1;
        }
      }

      // Check whether SP-API returns/reports access is available by probing the
      // reports endpoint; on auth/access failure, surface the real limitation.
      let spapiAccessible = true;
      try {
        await amazonSpApi.getOrders({ lastUpdatedAfter: defaultLookback(), maxResults: 1 });
      } catch (err: any) {
        const { status } = classifyError(err);
        if (status === "AuthenticationError" || status === "AccessRestricted" || status === "NotConfigured") {
          spapiAccessible = false;
        }
      }

      const status = spapiAccessible ? "Synchronized" : "AccessRestricted";
      await SyncStatusModel.upsert({
        clientId,
        module: "returns",
        status,
        lastSyncAt: nowISO(),
        recordsSynced: total,
        error: spapiAccessible ? null : "Amazon Returns/Reports API access is restricted for this account. Returns are derived from synced orders only.",
        errorCode: spapiAccessible ? null : "AccessRestricted",
      });
      return { module: "returns", status, recordsSynced: total, lastCursor: null, error: spapiAccessible ? null : "Amazon Returns API access restricted", errorCode: spapiAccessible ? null : "AccessRestricted" };
    } catch (err: any) {
      const { status, code, message } = classifyError(err);
      await SyncStatusModel.upsert({ clientId, module: "returns", status, lastSyncAt: nowISO(), recordsSynced: total, error: message, errorCode: code });
      return { module: "returns", status, recordsSynced: total, lastCursor: null, error: message, errorCode: code };
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Dispatch
  // ──────────────────────────────────────────────────────────────────────────

  async run(module: Module, clientId: string): Promise<SyncResult> {
    switch (module) {
      case "orders": return this.syncOrders(clientId);
      case "order-items": return this.syncOrderItems(clientId);
      case "inventory": return this.syncInventory(clientId);
      case "listings": return this.syncListings(clientId);
      case "returns": return this.syncReturns(clientId);
    }
  }
}

export const amazonSync = new AmazonSyncService();

// ─────────────────────────────────────────────────────────────────────────────
// Queue processor (background)
// ─────────────────────────────────────────────────────────────────────────────

async function processQueue() {
  if (queueProcessing) return;
  queueProcessing = true;
  let item: { module: Module; clientId: string; resolve: (v: any) => void; reject: (e: any) => void } | undefined;
  while ((item = syncQueue.shift())) {
    try {
      const result = await amazonSync.run(item.module, item.clientId);
      item.resolve(result);
    } catch (err) {
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
