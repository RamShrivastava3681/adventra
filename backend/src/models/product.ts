import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export interface Product {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  gsi2pk: string;
  gsi2sk: string;
  entityType: "Product";
  id: string;
  clientId: string;
  sku: string;
  name: string;
  description: string | null;
  category: string | null;
  subcategory: string | null;
  gender: string | null;
  size: string | null;
  color: string | null;
  season: string;
  unitPrice: number;
  unitCost: number;
  reorderLevel: number;
  maxStock: number;
  leadTimeDays: number;
  supplierId: string | null;
  barcode: string | null;
  imageUrl: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export async function list(clientId?: string) {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, { entityType: "Product" });
    return items as Product[];
  }
  return db.scanByType("Product") as Promise<Product[]>;
}

export async function get(id: string) {
  return db.getItem(`PRODUCT#${id}`) as Promise<Product | null>;
}

export async function create(data: Partial<Product> & { clientId: string; name: string }) {
  const id = uuid();
  const now = db.nowISO();
  const sku = data.sku || `SKU-${id.slice(0, 8).toUpperCase()}`;
  const item: Product = {
    pk: `PRODUCT#${id}`,
    sk: `PRODUCT#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`,
    gsi1sk: `Product#${now}`,
    gsi2pk: "Product",
    gsi2sk: `Product#${id}`,
    entityType: "Product",
    id,
    clientId: data.clientId,
    sku,
    name: data.name,
    description: data.description || null,
    category: data.category || null,
    subcategory: data.subcategory || null,
    gender: data.gender || null,
    size: data.size || null,
    color: data.color || null,
    season: data.season || "all",
    unitPrice: data.unitPrice || 0,
    unitCost: data.unitCost || 0,
    reorderLevel: data.reorderLevel || 0,
    maxStock: data.maxStock || 0,
    leadTimeDays: data.leadTimeDays || 30,
    supplierId: data.supplierId || null,
    barcode: data.barcode || null,
    imageUrl: data.imageUrl || null,
    status: data.status || "active",
    createdAt: now,
    updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<Product>) {
  const allowed = ["name","description","category","subcategory","gender","size","color","season","unitPrice","unitCost","reorderLevel","maxStock","leadTimeDays","supplierId","barcode","imageUrl","status","sku"];
  const patch: Record<string, any> = {};
  for (const key of allowed) {
    if ((updates as any)[key] !== undefined) patch[key] = (updates as any)[key];
  }
  patch.updatedAt = db.nowISO();
  return db.updateItem(`PRODUCT#${id}`, `PRODUCT#${id}`, patch);
}

export async function remove(id: string) {
  return db.deleteItem(`PRODUCT#${id}`);
}
