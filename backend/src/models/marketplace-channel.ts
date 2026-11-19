/**
 * Shared records for marketplace channels that use the common channel
 * dashboard (Shopify, AJIO). Each channel's sync normalises its own API data
 * into these shapes; nothing here is seeded or simulated.
 *
 * Every record of a channel shares gsi1pk CLIENT#CHANNEL_<CHANNEL>, so each
 * list is one GSI1 query.
 */
import * as db from "../dynamodb.js";

export type Channel = "shopify" | "ajio";

/** Order stages shown on the dashboard, in flow order. */
export type ChannelStage = "New" | "Processing" | "Shipped" | "Delivered" | "Cancelled" | "Returned";

const owner = (channel: Channel) => `CHANNEL_${channel.toUpperCase()}`;
const gsi1pk = (channel: Channel) => `CLIENT#${owner(channel)}`;

async function listType<T>(channel: Channel, entityType: string, limit: number): Promise<T[]> {
  const out: T[] = [];
  let startKey: Record<string, any> | undefined;
  do {
    const { items, lastKey } = await db.queryByGSI1(owner(channel), {
      entityType,
      limit: Math.min(1000, limit - out.length),
      reverse: true,
      exclusiveStartKey: startKey,
    });
    out.push(...(items as T[]));
    startKey = lastKey;
  } while (startKey && out.length < limit);
  return out;
}

// ── Orders ───────────────────────────────────────────────────────────────────

export interface ChannelOrderItem {
  sku: string;
  title: string;
  quantity: number;
  amount: number;
}

export interface ChannelOrder {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "MarketplaceChannelOrder";
  channel: Channel;
  /** The marketplace's own id. */
  orderId: string;
  /** Number shown to people, e.g. Shopify "#1001". */
  orderNumber: string;
  orderDate: string;
  stage: ChannelStage;
  /** Status text as the marketplace reports it. */
  rawStatus: string;
  paymentStatus?: string | null;
  paymentMethod?: string | null;
  currency: string;
  value: number;
  refundedAmount: number;
  items: ChannelOrderItem[];
  city?: string | null;
  state?: string | null;
  courier?: string | null;
  trackingNumber?: string | null;
  updatedAt: string;
}

export async function saveOrder(
  channel: Channel,
  data: Omit<ChannelOrder, "pk" | "sk" | "gsi1pk" | "gsi1sk" | "entityType" | "channel" | "updatedAt">,
): Promise<void> {
  const key = `MARKETPLACE_CHANNEL_ORDER#${channel}#${data.orderId}`;
  await db.putItem({
    ...data,
    pk: key,
    sk: key,
    gsi1pk: gsi1pk(channel),
    gsi1sk: `MarketplaceChannelOrder#${data.orderDate}#${data.orderId}`,
    entityType: "MarketplaceChannelOrder",
    channel,
    updatedAt: db.nowISO(),
  });
}

export const listOrders = (channel: Channel, limit = 5000) =>
  listType<ChannelOrder>(channel, "MarketplaceChannelOrder", limit);

// ── Inventory ────────────────────────────────────────────────────────────────

export interface ChannelInventory {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "MarketplaceChannelInventory";
  channel: Channel;
  /** Marketplace id of the variant / listing. */
  itemId: string;
  sku: string;
  title: string;
  location: string;
  quantity: number | null;
  price?: number | null;
  active: boolean;
  updatedAt: string;
}

export async function saveInventory(
  channel: Channel,
  data: Omit<ChannelInventory, "pk" | "sk" | "gsi1pk" | "gsi1sk" | "entityType" | "channel" | "updatedAt">,
): Promise<void> {
  const key = `MARKETPLACE_CHANNEL_INVENTORY#${channel}#${data.itemId}#${data.location}`;
  await db.putItem({
    ...data,
    pk: key,
    sk: key,
    gsi1pk: gsi1pk(channel),
    gsi1sk: `MarketplaceChannelInventory#${data.sku || data.itemId}#${data.location}`,
    entityType: "MarketplaceChannelInventory",
    channel,
    updatedAt: db.nowISO(),
  });
}

export const listInventory = (channel: Channel, limit = 5000) =>
  listType<ChannelInventory>(channel, "MarketplaceChannelInventory", limit);

// ── Returns / refunds ────────────────────────────────────────────────────────

export interface ChannelReturn {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "MarketplaceChannelReturn";
  channel: Channel;
  returnId: string;
  orderId: string;
  orderNumber: string;
  /** e.g. "Refund", "Return", "RTO". */
  type: string;
  status: string;
  reason?: string | null;
  amount: number;
  createdAt: string;
  updatedAt: string;
}

export async function saveReturn(
  channel: Channel,
  data: Omit<ChannelReturn, "pk" | "sk" | "gsi1pk" | "gsi1sk" | "entityType" | "channel" | "updatedAt">,
): Promise<void> {
  const key = `MARKETPLACE_CHANNEL_RETURN#${channel}#${data.returnId}`;
  await db.putItem({
    ...data,
    pk: key,
    sk: key,
    gsi1pk: gsi1pk(channel),
    gsi1sk: `MarketplaceChannelReturn#${data.createdAt}#${data.returnId}`,
    entityType: "MarketplaceChannelReturn",
    channel,
    updatedAt: db.nowISO(),
  });
}

export const listReturns = (channel: Channel, limit = 5000) =>
  listType<ChannelReturn>(channel, "MarketplaceChannelReturn", limit);

// ── Sync state ───────────────────────────────────────────────────────────────

export interface ChannelSyncState {
  lastSyncAt: string | null;
  lastSyncOk: boolean | null;
  lastSyncMessage: string | null;
  counts: { orders: number; inventory: number; returns: number } | null;
}

const syncKey = (channel: Channel) => `MARKETPLACE_CHANNEL_SYNC#${channel}`;

export async function getSyncState(channel: Channel): Promise<ChannelSyncState> {
  const item = (await db.getItem(syncKey(channel))) as any;
  return {
    lastSyncAt: item?.lastSyncAt ?? null,
    lastSyncOk: item?.lastSyncOk ?? null,
    lastSyncMessage: item?.lastSyncMessage ?? null,
    counts: item?.counts ?? null,
  };
}

export async function saveSyncState(channel: Channel, state: ChannelSyncState): Promise<void> {
  await db.putItem({
    pk: syncKey(channel),
    sk: syncKey(channel),
    entityType: "MarketplaceChannelSync",
    channel,
    ...state,
  });
}
