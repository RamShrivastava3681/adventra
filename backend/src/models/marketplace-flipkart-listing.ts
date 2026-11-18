import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export interface MarketplaceFlipkartListing {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "MarketplaceFlipkartListing";
  id: string;
  clientId: string;
  fsn: string;
  sku: string;
  title: string;
  listingStatus: "ACTIVE" | "INACTIVE" | "BLOCKED";
  mrp: number;
  sellingPrice: number;
  stockCount: number;
  flipkartAssured: boolean;
  procurementType: "REGULAR" | "EXPRESS" | "DOMESTIC";
  rating?: number;
  createdAt: string;
  updatedAt: string;
}

function key(id: string) {
  return { pk: `MARKETPLACE_FLIPKART_LISTING#${id}`, sk: `MARKETPLACE_FLIPKART_LISTING#${id}` };
}

export async function list(clientId?: string): Promise<MarketplaceFlipkartListing[]> {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, {
      entityType: "MarketplaceFlipkartListing",
      limit: 1000,
    });
    return items as MarketplaceFlipkartListing[];
  }
  return db.scanByType("MarketplaceFlipkartListing", { limit: 1000 }) as Promise<MarketplaceFlipkartListing[]>;
}

export async function aggregate(clientId?: string) {
  const items = await list(clientId);
  let active = 0;
  let inactive = 0;
  let blocked = 0;
  let assuredCount = 0;

  for (const item of items) {
    if (item.listingStatus === "ACTIVE") active++;
    else if (item.listingStatus === "INACTIVE") inactive++;
    else if (item.listingStatus === "BLOCKED") blocked++;
    if (item.flipkartAssured) assuredCount++;
  }

  return {
    total: items.length,
    active,
    inactive,
    blocked,
    assuredCount,
  };
}

export async function create(
  data: Partial<MarketplaceFlipkartListing> & {
    clientId: string;
    fsn: string;
    sku: string;
    title: string;
    mrp: number;
    sellingPrice: number;
  }
): Promise<MarketplaceFlipkartListing> {
  const id = uuid();
  const now = db.nowISO();

  const item: MarketplaceFlipkartListing = {
    ...key(id),
    gsi1pk: `CLIENT#${data.clientId}`,
    gsi1sk: `MarketplaceFlipkartListing#${now}`,
    entityType: "MarketplaceFlipkartListing",
    id,
    clientId: data.clientId,
    fsn: data.fsn,
    sku: data.sku,
    title: data.title,
    listingStatus: data.listingStatus || "ACTIVE",
    mrp: Number(data.mrp),
    sellingPrice: Number(data.sellingPrice),
    stockCount: Number(data.stockCount || 50),
    flipkartAssured: data.flipkartAssured ?? true,
    procurementType: data.procurementType || "REGULAR",
    rating: data.rating || 4.4,
    createdAt: now,
    updatedAt: now,
  };

  await db.putItem(item);
  return item;
}
