import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export type StockStatus = "InStock" | "LowStock" | "OutOfStock" | "Overstocked";

export interface MarketplaceAmazonInventory {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "MarketplaceAmazonInventory";
  id: string;
  clientId: string;
  marketplaceId: string;
  sellerSku: string;
  asin: string | null;
  fnsku: string | null;
  productName: string | null;
  productImage: string | null;
  fulfilmentChannel: "FBA" | "FBM" | null;
  availableQuantity: number;
  reservedQuantity: number;
  inboundQuantity: number;
  unfulfillableQuantity: number;
  totalQuantity: number;
  stockStatus: StockStatus;
  lastUpdated: string;
  createdAt: string;
  updatedAt: string;
}

function key(id: string) {
  return { pk: `MARKETPLACE_AMAZON_INVENTORY#${id}`, sk: `MARKETPLACE_AMAZON_INVENTORY#${id}` };
}

export async function list(clientId?: string, options?: { limit?: number; exclusiveStartKey?: Record<string, any> }) {
  if (clientId) {
    const { items, lastKey } = await db.queryByGSI1(clientId, {
      entityType: "MarketplaceAmazonInventory",
      limit: options?.limit || 100,
      reverse: true,
      exclusiveStartKey: options?.exclusiveStartKey,
    });
    return { items: items as MarketplaceAmazonInventory[], lastKey };
  }
  const items = await db.scanByType("MarketplaceAmazonInventory", { limit: 2000 });
  return { items: items as MarketplaceAmazonInventory[], lastKey: undefined };
}

export async function get(id: string) {
  const { pk, sk } = key(id);
  return db.getItem(pk, sk) as Promise<MarketplaceAmazonInventory | null>;
}

export async function findBySku(clientId: string, sellerSku: string): Promise<MarketplaceAmazonInventory | null> {
  const { items } = await list(clientId, { limit: 1000 });
  return items.find((i) => i.sellerSku === sellerSku) || null;
}

export async function upsert(data: Partial<MarketplaceAmazonInventory> & {
  clientId: string;
  marketplaceId: string;
  sellerSku: string;
}) {
  const existing = await findBySku(data.clientId, data.sellerSku);
  const now = db.nowISO();
  const id = existing?.id ?? uuid();
  const total = Number(data.availableQuantity || 0) + Number(data.reservedQuantity || 0) + Number(data.inboundQuantity || 0) + Number(data.unfulfillableQuantity || 0);

  const item: MarketplaceAmazonInventory = {
    ...key(id),
    gsi1pk: `CLIENT#${data.clientId}`,
    gsi1sk: `MarketplaceAmazonInventory#${now}`,
    entityType: "MarketplaceAmazonInventory",
    id,
    clientId: data.clientId,
    marketplaceId: data.marketplaceId,
    sellerSku: data.sellerSku,
    asin: data.asin ?? null,
    fnsku: data.fnsku ?? null,
    productName: data.productName ?? null,
    productImage: data.productImage ?? null,
    fulfilmentChannel: data.fulfilmentChannel ?? null,
    availableQuantity: Number(data.availableQuantity || 0),
    reservedQuantity: Number(data.reservedQuantity || 0),
    inboundQuantity: Number(data.inboundQuantity || 0),
    unfulfillableQuantity: Number(data.unfulfillableQuantity || 0),
    totalQuantity: total,
    stockStatus: data.stockStatus ?? (total === 0 ? "OutOfStock" : "InStock"),
    lastUpdated: data.lastUpdated ?? now,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await db.putItem(item);
  return item;
}

export async function remove(clientId: string, sellerSku: string) {
  const existing = await findBySku(clientId, sellerSku);
  if (!existing) return null;
  const { pk, sk } = key(existing.id);
  await db.deleteItem(pk, sk);
  return existing;
}

export async function aggregate(clientId: string) {
  const { items } = await list(clientId, { limit: 10000 });
  const totalUnits = items.reduce((sum, i) => sum + i.totalQuantity, 0);
  const availableUnits = items.reduce((sum, i) => sum + i.availableQuantity, 0);
  const reservedUnits = items.reduce((sum, i) => sum + i.reservedQuantity, 0);
  const inboundUnits = items.reduce((sum, i) => sum + i.inboundQuantity, 0);
  const unfulfillableUnits = items.reduce((sum, i) => sum + i.unfulfillableQuantity, 0);
  const lowStock = items.filter((i) => i.stockStatus === "LowStock").length;
  const outOfStock = items.filter((i) => i.stockStatus === "OutOfStock").length;
  const overstocked = items.filter((i) => i.stockStatus === "Overstocked").length;
  const fba = items.reduce((sum, i) => sum + (i.fulfilmentChannel === "FBA" ? i.totalQuantity : 0), 0);
  const fbm = items.reduce((sum, i) => sum + (i.fulfilmentChannel === "FBM" ? i.totalQuantity : 0), 0);

  return {
    totalUnits,
    availableUnits,
    reservedUnits,
    inboundUnits,
    unfulfillableUnits,
    totalProducts: items.length,
    lowStock,
    outOfStock,
    overstocked,
    fba,
    fbm,
    byStockStatus: items.reduce(
      (acc, i) => { acc[i.stockStatus] = (acc[i.stockStatus] || 0) + 1; return acc; },
      {} as Record<string, number>,
    ),
    byFulfillmentChannel: { FBA: fba, FBM: fbm },
  };
}
