/**
 * Myntra marketplace records (Seller API V4 / Pretr OMS).
 *
 * Every record is written from a real source: an outbound call Myntra makes to
 * us (order, order update, return, failed inventory) or a response from a call
 * we make to Myntra. Nothing here is seeded or simulated.
 *
 * All records share gsi1pk CLIENT#MYNTRA so each list is one GSI1 query.
 */
import * as db from "../dynamodb.js";

const GSI_OWNER = "MYNTRA";
const gsi1pk = `CLIENT#${GSI_OWNER}`;

async function listType<T>(entityType: string, limit = 500): Promise<T[]> {
  const { items } = await db.queryByGSI1(GSI_OWNER, { entityType, limit, reverse: true });
  return items as T[];
}

// ── Orders ───────────────────────────────────────────────────────────────────

export interface MyntraOrderLine {
  orderLineId: string;
  sku: string;
  quantity: number;
  status?: string | null;
  mrp?: number | null;
  lineFinalAmount?: number | null;
  invoiceNumber?: string | null;
}

export interface MyntraOrder {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "MarketplaceMyntraOrder";
  sellerOrderId: string;
  orderId?: string | null;
  packetId?: string | null;
  warehouse?: string | null;
  status: string;
  onHold?: boolean;
  orderDate?: string | null;
  paymentMethod?: string | null;
  amountDue?: number | null;
  courierCode?: string | null;
  trackingNumber?: string | null;
  receiverCity?: string | null;
  receiverState?: string | null;
  receiverZipcode?: string | null;
  orderLines: MyntraOrderLine[];
  lastEvent?: string | null;
  /** Latest payload from Myntra, exactly as received. */
  rawPayload: string;
  createdAt: string;
  updatedAt: string;
}

const orderKey = (sellerOrderId: string) => ({
  pk: `MARKETPLACE_MYNTRA_ORDER#${sellerOrderId}`,
  sk: `MARKETPLACE_MYNTRA_ORDER#${sellerOrderId}`,
});

export async function getOrder(sellerOrderId: string): Promise<MyntraOrder | null> {
  const k = orderKey(sellerOrderId);
  return (await db.getItem(k.pk, k.sk)) as MyntraOrder | null;
}

export async function listOrders(): Promise<MyntraOrder[]> {
  return listType<MyntraOrder>("MarketplaceMyntraOrder");
}

export async function findOrderByPacket(packetId: string): Promise<MyntraOrder | null> {
  const orders = await listOrders();
  return orders.find((o) => o.packetId === packetId) ?? null;
}

export async function saveOrder(
  data: Omit<MyntraOrder, "pk" | "sk" | "gsi1pk" | "gsi1sk" | "entityType" | "createdAt" | "updatedAt"> & {
    createdAt?: string;
  },
): Promise<MyntraOrder> {
  const now = db.nowISO();
  const createdAt = data.createdAt ?? now;
  const item: MyntraOrder = {
    ...data,
    ...orderKey(data.sellerOrderId),
    gsi1pk,
    gsi1sk: `MarketplaceMyntraOrder#${createdAt}`,
    entityType: "MarketplaceMyntraOrder",
    createdAt,
    updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

// ── Returns ──────────────────────────────────────────────────────────────────

export interface MyntraReturn {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "MarketplaceMyntraReturn";
  /** Path id Myntra used: packetId for RTO / courier returns, returnId for customer returns. */
  returnKey: string;
  returnId?: string | null;
  returnReferenceId?: string | null;
  type?: string | null;
  status?: string | null;
  sellerOrderId?: string | null;
  orderId?: string | null;
  trackingNumber?: string | null;
  reason?: string | null;
  returnWarehouseCode?: string | null;
  orderLineIds: string[];
  rawPayload: string;
  createdAt: string;
  updatedAt: string;
}

const returnKeyOf = (key: string) => ({
  pk: `MARKETPLACE_MYNTRA_RETURN#${key}`,
  sk: `MARKETPLACE_MYNTRA_RETURN#${key}`,
});

export async function getReturn(key: string): Promise<MyntraReturn | null> {
  const k = returnKeyOf(key);
  return (await db.getItem(k.pk, k.sk)) as MyntraReturn | null;
}

export async function listReturns(): Promise<MyntraReturn[]> {
  return listType<MyntraReturn>("MarketplaceMyntraReturn");
}

export async function saveReturn(
  data: Omit<MyntraReturn, "pk" | "sk" | "gsi1pk" | "gsi1sk" | "entityType" | "createdAt" | "updatedAt"> & {
    createdAt?: string;
  },
): Promise<MyntraReturn> {
  const now = db.nowISO();
  const createdAt = data.createdAt ?? now;
  const item: MyntraReturn = {
    ...data,
    ...returnKeyOf(data.returnKey),
    gsi1pk,
    gsi1sk: `MarketplaceMyntraReturn#${createdAt}`,
    entityType: "MarketplaceMyntraReturn",
    createdAt,
    updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

// ── Inventory (what we last pushed to Myntra, and what Myntra reported) ─────

export interface MyntraInventory {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "MarketplaceMyntraInventory";
  sku: string;
  storeCode: string;
  quantity: number | null;
  processingSla: number | null;
  /** "pushed" = we sent it; "myntra" = read back from Search Inventory. */
  source: "pushed" | "myntra";
  pushStatus?: "SUCCESS" | "FAILED" | null;
  remarks?: string | null;
  updatedAt: string;
}

const inventoryKey = (sku: string, storeCode: string) => ({
  pk: `MARKETPLACE_MYNTRA_INVENTORY#${sku}#${storeCode}`,
  sk: `MARKETPLACE_MYNTRA_INVENTORY#${sku}#${storeCode}`,
});

export async function listInventory(): Promise<MyntraInventory[]> {
  return listType<MyntraInventory>("MarketplaceMyntraInventory", 1000);
}

export async function saveInventory(
  data: Omit<MyntraInventory, "pk" | "sk" | "gsi1pk" | "gsi1sk" | "entityType" | "updatedAt">,
): Promise<MyntraInventory> {
  const now = db.nowISO();
  const item: MyntraInventory = {
    ...data,
    ...inventoryKey(data.sku, data.storeCode),
    gsi1pk,
    gsi1sk: `MarketplaceMyntraInventory#${data.sku}#${data.storeCode}`,
    entityType: "MarketplaceMyntraInventory",
    updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

// ── Outbound events (every call Myntra makes to us) ──────────────────────────

export interface MyntraEvent {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "MarketplaceMyntraEvent";
  id: string;
  /** e.g. CREATE_ORDER, ORDER_SHIPPED, CREATE_RETURN, UPDATE_RETURN, FAILURE_INVENTORY, DOWNLOAD_INVOICE */
  event: string;
  method: string;
  path: string;
  authorized: boolean;
  responseStatus: number;
  responseBody: string;
  rawPayload: string;
  receivedAt: string;
}

export async function logEvent(
  data: Omit<MyntraEvent, "pk" | "sk" | "gsi1pk" | "gsi1sk" | "entityType" | "id" | "receivedAt">,
): Promise<MyntraEvent> {
  const id = db.generateId();
  const now = db.nowISO();
  const item: MyntraEvent = {
    ...data,
    pk: `MARKETPLACE_MYNTRA_EVENT#${id}`,
    sk: `MARKETPLACE_MYNTRA_EVENT#${id}`,
    gsi1pk,
    gsi1sk: `MarketplaceMyntraEvent#${now}`,
    entityType: "MarketplaceMyntraEvent",
    id,
    receivedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function listEvents(limit = 200): Promise<MyntraEvent[]> {
  return listType<MyntraEvent>("MarketplaceMyntraEvent", limit);
}

// ── API calls we make to Myntra (latest result per Mockify sheet row) ────────

export interface MyntraApiCall {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "MarketplaceMyntraApiCall";
  /** Name exactly as in column A of Myntra's Mockify contract sheet. */
  api: string;
  method: string;
  url: string;
  /** Request body sent (secrets are never stored). */
  requestBody: string;
  httpStatus: number | null;
  ok: boolean;
  /** Response body exactly as received (binary bodies are summarised). */
  responseBody: string;
  /** Selected response headers (tokens masked). */
  responseHeaders: string;
  error?: string | null;
  durationMs: number;
  calledAt: string;
}

/**
 * Two records per API: LATEST (every call) and LAST_OK (last successful call),
 * so a later failure never hides a good response we can send Myntra.
 */
export async function saveApiCall(
  data: Omit<MyntraApiCall, "pk" | "sk" | "gsi1pk" | "gsi1sk" | "entityType">,
): Promise<MyntraApiCall> {
  const base = {
    ...data,
    pk: `MARKETPLACE_MYNTRA_API_CALL#${data.api}`,
    gsi1pk,
    entityType: "MarketplaceMyntraApiCall" as const,
  };
  const latest: MyntraApiCall = { ...base, sk: "LATEST", gsi1sk: `MarketplaceMyntraApiCall#LATEST#${data.api}` };
  await db.putItem(latest);
  if (data.ok) {
    await db.putItem({ ...base, sk: "LAST_OK", gsi1sk: `MarketplaceMyntraApiCall#LAST_OK#${data.api}` });
  }
  return latest;
}

export async function listApiCalls(): Promise<{ latest: MyntraApiCall[]; lastOk: MyntraApiCall[] }> {
  const all = await listType<MyntraApiCall>("MarketplaceMyntraApiCall", 400);
  return {
    latest: all.filter((c) => c.sk === "LATEST"),
    lastOk: all.filter((c) => c.sk === "LAST_OK"),
  };
}
