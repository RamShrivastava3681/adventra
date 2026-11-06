import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export type ListingStatus = "Active" | "Inactive" | "Suppressed" | "Incomplete" | "OutOfStock" | "Error";

export interface MarketplaceAmazonListing {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "MarketplaceAmazonListing";
  id: string;
  clientId: string;
  marketplaceId: string;
  sellerSku: string;
  asin: string | null;
  productTitle: string | null;
  productImage: string | null;
  productType: string | null;
  brand: string | null;
  listingStatus: ListingStatus;
  fulfilmentChannel: "FBA" | "FBM" | null;
  price: number | null;
  currency: string;
  availableInventory: number | null;
  lastUpdated: string;
  listingIssues: string[] | null;
  restrictions: string[] | null;
  syncStatus: "Synced" | "Error" | "NotSynced";
  createdAt: string;
  updatedAt: string;
}

function key(id: string) {
  return { pk: `MARKETPLACE_AMAZON_LISTING#${id}`, sk: `MARKETPLACE_AMAZON_LISTING#${id}` };
}

export async function list(clientId?: string, options?: { limit?: number; exclusiveStartKey?: Record<string, any> }) {
  if (clientId) {
    const { items, lastKey } = await db.queryByGSI1(clientId, {
      entityType: "MarketplaceAmazonListing",
      limit: options?.limit || 100,
      reverse: true,
      exclusiveStartKey: options?.exclusiveStartKey,
    });
    return { items: items as MarketplaceAmazonListing[], lastKey };
  }
  const items = await db.scanByType("MarketplaceAmazonListing", { limit: 2000 });
  return { items: items as MarketplaceAmazonListing[], lastKey: undefined };
}

export async function get(id: string) {
  const { pk, sk } = key(id);
  return db.getItem(pk, sk) as Promise<MarketplaceAmazonListing | null>;
}

export async function findBySku(clientId: string, sellerSku: string): Promise<MarketplaceAmazonListing | null> {
  const { items } = await list(clientId, { limit: 1000 });
  return items.find((l) => l.sellerSku === sellerSku) || null;
}

export async function upsert(data: Partial<MarketplaceAmazonListing> & {
  clientId: string;
  marketplaceId: string;
  sellerSku: string;
}) {
  const existing = await findBySku(data.clientId, data.sellerSku);
  const now = db.nowISO();
  const id = existing?.id ?? uuid();

  const item: MarketplaceAmazonListing = {
    ...key(id),
    gsi1pk: `CLIENT#${data.clientId}`,
    gsi1sk: `MarketplaceAmazonListing#${now}`,
    entityType: "MarketplaceAmazonListing",
    id,
    clientId: data.clientId,
    marketplaceId: data.marketplaceId,
    sellerSku: data.sellerSku,
    asin: data.asin ?? null,
    productImage: data.productImage ?? null,
    productTitle: data.productTitle ?? null,
    productType: data.productType ?? null,
    brand: data.brand ?? null,
    listingStatus: data.listingStatus ?? "Inactive",
    fulfilmentChannel: data.fulfilmentChannel ?? null,
    price: data.price ?? null,
    currency: data.currency ?? "INR",
    availableInventory: data.availableInventory ?? null,
    lastUpdated: data.lastUpdated ?? now,
    listingIssues: data.listingIssues ?? null,
    restrictions: data.restrictions ?? null,
    syncStatus: data.syncStatus ?? "Synced",
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
  const active = items.filter((l) => l.listingStatus === "Active").length;
  const inactive = items.filter((l) => l.listingStatus === "Inactive").length;
  const suppressed = items.filter((l) => l.listingStatus === "Suppressed").length;
  const incomplete = items.filter((l) => l.listingStatus === "Incomplete").length;
  const outOfStock = items.filter((l) => l.listingStatus === "OutOfStock").length;
  const errors = items.filter((l) => l.listingStatus === "Error").length;

  return {
    totalListings: items.length,
    active,
    inactive,
    suppressed,
    incomplete,
    outOfStock,
    errors,
    byStatus: items.reduce(
      (acc, l) => { acc[l.listingStatus] = (acc[l.listingStatus] || 0) + 1; return acc; },
      {} as Record<string, number>,
    ),
  };
}
