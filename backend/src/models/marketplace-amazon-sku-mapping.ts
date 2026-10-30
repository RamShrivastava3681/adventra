import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export type MappingStatus = "Mapped" | "Pending" | "Error" | "Active";

export interface MarketplaceAmazonSkuMapping {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "MarketplaceAmazonSkuMapping";
  id: string;
  clientId: string;
  channelSku: string; // Amazon SKU/ASIN
  listingId: string; // Amazon ASIN
  whizunikSku: string; // Internal WhizUnik Master SKU
  colour: string | null;
  size: string | null;
  productName: string;
  variant: string; // e.g. "Black / M"
  warehouse: string; // Fulfilment warehouse
  mrp: number;
  sellingPrice: number;
  hsn: string;
  gstRate: number;
  status: MappingStatus;
  safetyStock: number;
  createdAt: string;
  updatedAt: string;
}

function key(id: string) {
  return { pk: `MARKETPLACE_AMAZON_SKU_MAPPING#${id}`, sk: `MARKETPLACE_AMAZON_SKU_MAPPING#${id}` };
}

export async function list(clientId?: string) {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, {
      entityType: "MarketplaceAmazonSkuMapping",
      limit: 500,
      reverse: true,
    });
    return items as MarketplaceAmazonSkuMapping[];
  }
  return db.scanByType("MarketplaceAmazonSkuMapping", { limit: 2000 }) as Promise<MarketplaceAmazonSkuMapping[]>;
}

export async function get(id: string) {
  const { pk, sk } = key(id);
  return db.getItem(pk, sk) as Promise<MarketplaceAmazonSkuMapping | null>;
}

export async function create(
  data: Partial<MarketplaceAmazonSkuMapping> & {
    clientId: string;
    channelSku: string;
    listingId: string;
    whizunikSku: string;
    colour: string | null;
    size: string | null;
    productName: string;
    variant: string;
    warehouse: string;
    mrp: number;
    sellingPrice: number;
    hsn: string;
    gstRate: number;
  }
) {
  const id = uuid();
  const now = db.nowISO();
  const item: MarketplaceAmazonSkuMapping = {
    ...key(id),
    gsi1pk: `CLIENT#${data.clientId}`,
    gsi1sk: `MarketplaceAmazonSkuMapping#${now}`,
    entityType: "MarketplaceAmazonSkuMapping",
    id,
    clientId: data.clientId,
    channelSku: data.channelSku,
    listingId: data.listingId,
    whizunikSku: data.whizunikSku,
    colour: data.colour ?? null,
    size: data.size ?? null,
    productName: data.productName,
    variant: data.variant,
    warehouse: data.warehouse,
    mrp: data.mrp,
    sellingPrice: data.sellingPrice,
    hsn: data.hsn,
    gstRate: data.gstRate,
    status: data.status ?? "Pending",
    safetyStock: data.safetyStock ?? 0,
    createdAt: now,
    updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<MarketplaceAmazonSkuMapping>) {
  const { pk, sk } = key(id);
  return db.updateItem(pk, sk, {
    ...updates,
    updatedAt: db.nowISO(),
  }) as Promise<MarketplaceAmazonSkuMapping | null>;
}

export async function findByChannelSku(clientId: string, channelSku: string): Promise<MarketplaceAmazonSkuMapping | null> {
  const items = await list(clientId);
  return items.find((m) => m.channelSku === channelSku) || null;
}

export async function findByWhizunikSku(clientId: string, whizunikSku: string): Promise<MarketplaceAmazonSkuMapping | null> {
  const items = await list(clientId);
  return items.find((m) => m.whizunikSku === whizunikSku) || null;
}

export async function updateMappingStatus(id: string, status: MappingStatus) {
  const { pk, sk } = key(id);
  return db.updateItem(pk, sk, {
    status,
    updatedAt: db.nowISO(),
  }) as Promise<MarketplaceAmazonSkuMapping | null>;
}