import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export interface MarketplaceAmazonOrder {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "MarketplaceAmazonOrder";
  id: string;
  clientId: string;
  amazonOrderId: string;
  orderDate: string;
  amazonSku: string;
  productName: string;
  colour: string | null;
  size: string | null;
  quantity: number;
  sellingPrice: number;
  discount: number;
  taxInformation: {
    taxableAmount: number;
    taxAmount: number;
    taxRate: number;
  };
  deliveryAddress: {
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  shippingMethod: string;
  fulfilmentType: "FBA" | "SellerFlex" | "MCF" | "Dropship" | "Vendor" | "EasyShip" | "SelfShip";
  expectedDispatchDate: string | null;
  amazonOrderStatus: "Pending" | "PartiallyShipped" | "Shipped" | "Delivered" | "Cancelled" | "Returned" | "Refunded" | "PendingConfirmation";
  invoiceStatus: "Pending" | "AwaitingAmazonInvoice" | "InvoiceReceived" | "Fulfilled" | "Cancelled";
  // ── Fulfilment pipeline links (optional; set as the order moves through the
  // WhizUnik Sales Order → Inventory → Warehouse → Dispatch workflow). ──
  /** WhizUnik order status (Pending, Confirmed, Awaiting Stock, SKU Mapping Required, …). */
  whizunikStatus?: string | null;
  internalSku?: string | null;
  productId?: string | null;
  salesOrderId?: string | null;
  salesOrderNumber?: string | null;
  invoiceRecordId?: string | null;
  dispatchId?: string | null;
  dispatchNumber?: string | null;
  warehouseTaskId?: string | null;
  courier?: string | null;
  awbNumber?: string | null;
  trackingStatus?: string | null;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  /** Demo simulator: the Amazon invoice is deliberately held back ("Awaiting Amazon Invoice"). */
  invoiceDelayed?: boolean | null;
  /** Amazon's LastUpdateDate for the order, as of the last orders sync. */
  amazonLastUpdatedAt?: string | null;
  /** When the order's items (SKU, title, quantity, price) were last fetched from Amazon. */
  itemsSyncedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

function key(id: string) {
  return { pk: `MARKETPLACE_AMAZON_ORDER#${id}`, sk: `MARKETPLACE_AMAZON_ORDER#${id}` };
}

// ── Lookup record: one per (client, Amazon Order ID) ─────────────────────────
// Points at the single order record for that Amazon order, so the sync finds it
// with one read instead of listing orders. Without it, the old lookup only saw
// the newest 500 orders and re-created every older order on each sync.

export const ORDER_REF_ENTITY = "MarketplaceAmazonOrderRef";

function refKey(clientId: string, amazonOrderId: string) {
  const k = `MARKETPLACE_AMAZON_ORDER_REF#${clientId}#${amazonOrderId}`;
  return { pk: k, sk: k };
}

export function orderRefItem(clientId: string, amazonOrderId: string, orderId: string) {
  return {
    ...refKey(clientId, amazonOrderId),
    gsi1pk: `CLIENT#${clientId}`,
    gsi1sk: `${ORDER_REF_ENTITY}#${amazonOrderId}`,
    entityType: ORDER_REF_ENTITY,
    clientId,
    amazonOrderId,
    orderId,
  };
}

/** Writes the lookup record unless one exists; returns the order id it points at. */
async function claimOrderRef(clientId: string, amazonOrderId: string, orderId: string): Promise<string> {
  const created = await db.putItemIfAbsent(orderRefItem(clientId, amazonOrderId, orderId));
  if (created) return orderId;
  const ref = (await db.getItem(refKey(clientId, amazonOrderId).pk)) as { orderId?: string } | null;
  return ref?.orderId ?? orderId;
}

/** Every Amazon Order ID → order id pointer for a client (one record per real order). */
export async function listOrderRefs(clientId: string): Promise<{ amazonOrderId: string; orderId: string }[]> {
  const out: { amazonOrderId: string; orderId: string }[] = [];
  let startKey: Record<string, any> | undefined;
  do {
    const { items, lastKey } = await db.queryByGSI1(clientId, {
      entityType: ORDER_REF_ENTITY,
      limit: 1000,
      exclusiveStartKey: startKey,
    });
    for (const r of items as any[]) out.push({ amazonOrderId: r.amazonOrderId, orderId: r.orderId });
    startKey = lastKey;
  } while (startKey);
  return out;
}

/** Newest orders first, paged through GSI1 up to `max` records. */
export async function list(clientId?: string, max = 5000) {
  if (clientId) {
    const out: MarketplaceAmazonOrder[] = [];
    let startKey: Record<string, any> | undefined;
    do {
      const { items, lastKey } = await db.queryByGSI1(clientId, {
        entityType: "MarketplaceAmazonOrder",
        limit: Math.min(1000, max - out.length),
        reverse: true,
        exclusiveStartKey: startKey,
      });
      out.push(...(items as MarketplaceAmazonOrder[]));
      startKey = lastKey;
    } while (startKey && out.length < max);
    return out;
  }
  return db.scanByType("MarketplaceAmazonOrder", { limit: 1000 }) as Promise<MarketplaceAmazonOrder[]>;
}

export async function get(id: string) {
  const { pk, sk } = key(id);
  return db.getItem(pk, sk) as Promise<MarketplaceAmazonOrder | null>;
}

export async function create(
  data: Partial<MarketplaceAmazonOrder> & {
    clientId: string;
    amazonOrderId: string;
    amazonSku: string;
    productName: string;
    colour: string | null;
    size: string | null;
    quantity: number;
    sellingPrice: number;
    discount: number;
    shippingMethod: string;
    fulfilmentType: string;
  }
) {
  const id = uuid();
  const now = db.nowISO();
  const item: MarketplaceAmazonOrder = {
    ...key(id),
    gsi1pk: `CLIENT#${data.clientId}`,
    gsi1sk: `MarketplaceAmazonOrder#${now}`,
    entityType: "MarketplaceAmazonOrder",
    id,
    clientId: data.clientId,
    amazonOrderId: data.amazonOrderId,
    orderDate: data.orderDate || db.todayDate(),
    amazonSku: data.amazonSku,
    productName: data.productName,
    colour: data.colour ?? null,
    size: data.size ?? null,
    quantity: Number(data.quantity),
    sellingPrice: Number(data.sellingPrice),
    discount: Number(data.discount) || 0,
    taxInformation: data.taxInformation || {
      taxableAmount: 0,
      taxAmount: 0,
      taxRate: 0,
    },
    deliveryAddress: data.deliveryAddress || {
      addressLine1: "",
      addressLine2: null,
      city: "",
      state: "",
      postalCode: "",
      country: "",
    },
    shippingMethod: data.shippingMethod,
    fulfilmentType: data.fulfilmentType || "FBA",
    expectedDispatchDate: data.expectedDispatchDate ?? null,
    amazonOrderStatus: data.amazonOrderStatus || "Pending",
    invoiceStatus: data.invoiceStatus || "Pending",
    amazonLastUpdatedAt: data.amazonLastUpdatedAt ?? null,
    itemsSyncedAt: data.itemsSyncedAt ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await db.putItem(item);
  // If another writer registered this Amazon order first, keep theirs and drop ours.
  const ownerId = await claimOrderRef(data.clientId, data.amazonOrderId, id);
  if (ownerId !== id) {
    await db.deleteItem(item.pk, item.sk);
    return (await get(ownerId)) ?? item;
  }
  return item;
}

export async function update(id: string, updates: Partial<MarketplaceAmazonOrder>) {
  const { pk, sk } = key(id);
  return db.updateItem(pk, sk, {
    ...updates,
    updatedAt: db.nowISO(),
  }) as Promise<MarketplaceAmazonOrder | null>;
}

export async function findByAmazonOrderId(clientId: string, amazonOrderId: string): Promise<MarketplaceAmazonOrder | null> {
  const ref = (await db.getItem(refKey(clientId, amazonOrderId).pk)) as { orderId?: string } | null;
  if (ref?.orderId) {
    const order = await get(ref.orderId);
    if (order) return order;
  }
  // Orders written before the lookup record existed: search the newest ones once,
  // then register the match so the next lookup is a single read.
  const items = await list(clientId, 500);
  const found = items.find((o) => o.amazonOrderId === amazonOrderId) || null;
  if (found) await db.putItem(orderRefItem(clientId, amazonOrderId, found.id));
  return found;
}

export async function updateStatus(id: string, status: string, invoiceStatus?: string) {
  const { pk, sk } = key(id);
  const updates: any = {
    amazonOrderStatus: status,
    updatedAt: db.nowISO(),
  };
  if (invoiceStatus !== undefined) {
    updates.invoiceStatus = invoiceStatus;
  }
  return db.updateItem(pk, sk, {
    ...updates,
    updatedAt: db.nowISO(),
  }) as Promise<MarketplaceAmazonOrder | null>;
}