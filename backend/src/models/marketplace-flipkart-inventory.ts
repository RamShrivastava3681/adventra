import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export interface MarketplaceFlipkartInventory {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "MarketplaceFlipkartInventory";
  id: string;
  clientId: string;
  fsn: string;
  sku: string;
  title: string;
  availableStock: number;
  reservedStock: number;
  fulfilmentCenter: string;
  status: "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";
  mrp: number;
  sellingPrice: number;
  updatedAt: string;
  createdAt: string;
}

function key(id: string) {
  return { pk: `MARKETPLACE_FLIPKART_INVENTORY#${id}`, sk: `MARKETPLACE_FLIPKART_INVENTORY#${id}` };
}

export async function list(clientId?: string): Promise<MarketplaceFlipkartInventory[]> {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, {
      entityType: "MarketplaceFlipkartInventory",
      limit: 1000,
    });
    return items as MarketplaceFlipkartInventory[];
  }
  return db.scanByType("MarketplaceFlipkartInventory", { limit: 1000 }) as Promise<MarketplaceFlipkartInventory[]>;
}

export async function aggregate(clientId?: string) {
  const items = await list(clientId);
  let totalStock = 0;
  let inStockCount = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;

  for (const item of items) {
    totalStock += item.availableStock;
    if (item.availableStock === 0) outOfStockCount++;
    else if (item.availableStock < 15) lowStockCount++;
    else inStockCount++;
  }

  return {
    totalSkus: items.length,
    totalStock,
    inStockCount,
    lowStockCount,
    outOfStockCount,
  };
}

export async function create(
  data: Partial<MarketplaceFlipkartInventory> & {
    clientId: string;
    fsn: string;
    sku: string;
    title: string;
    availableStock: number;
    sellingPrice: number;
  }
): Promise<MarketplaceFlipkartInventory> {
  const id = uuid();
  const now = db.nowISO();
  const availableStock = Number(data.availableStock);
  const status: "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK" =
    availableStock === 0 ? "OUT_OF_STOCK" : availableStock < 15 ? "LOW_STOCK" : "IN_STOCK";

  const item: MarketplaceFlipkartInventory = {
    ...key(id),
    gsi1pk: `CLIENT#${data.clientId}`,
    gsi1sk: `MarketplaceFlipkartInventory#${now}`,
    entityType: "MarketplaceFlipkartInventory",
    id,
    clientId: data.clientId,
    fsn: data.fsn,
    sku: data.sku,
    title: data.title,
    availableStock,
    reservedStock: Number(data.reservedStock || 0),
    fulfilmentCenter: data.fulfilmentCenter || "BLR_WHITEFIELD_FC",
    status,
    mrp: Number(data.mrp || Math.round(data.sellingPrice * 1.3)),
    sellingPrice: Number(data.sellingPrice),
    createdAt: now,
    updatedAt: now,
  };

  await db.putItem(item);
  return item;
}
