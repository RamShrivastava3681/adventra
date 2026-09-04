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
  /** Id of the parent product when this is a child SKU (colour/size variant). null = top-level product. Variants are one level deep only. */
  parentId: string | null;
  sku: string;
  name: string;
  description: string | null;
  category: string | null;
  subcategory: string | null;
  gender: string | null;
  /** Brand name, e.g. "Nike", "Puma" */
  brand: string | null;
  size: string | null;
  color: string | null;
  /** Variant / model identifier, e.g. "Airmax-2024" */
  model: string | null;
  /** Unit of measure — piece, pair, carton, box, dozen, kg, etc. */
  unitOfMeasure: string;
  season: string;
  barcode: string | null;
  /** Barcode symbology — EAN-13, UPC-A, QR, etc. Optional. */
  barcodeType: string | null;
  /** Units packed per carton — optional. */
  unitsPerCarton: number | null;
  unitPrice: number;
  unitCost: number;
  /** Max retail price (MRP) — printed list price. */
  mrp: number | null;
  /** E-commerce / online selling price. */
  ecommercePrice: number | null;
  /** Price for retailers. */
  retailerPrice: number | null;
  /** Price for distributors. */
  distributorPrice: number | null;
  /** Negotiable / flexible price. */
  flexiblePrice: number | null;
  /** Minimum gross margin (0.01–0.99) used to derive the floor for recommended prices. null = inherit the catalogue default margin. */
  minimumGrossMarginPercentage: number | null;
  reorderLevel: number;
  maxStock: number;
  leadTimeDays: number;
  /** Days of demand to hold as a buffer (drives reorder safety stock) */
  safetyStockDays: number;
  supplierId: string | null;
  /** The supplier's own code/reference for this product — optional. */
  supplierProductCode: string | null;
  /** Minimum quantity that must be ordered at once. */
  minimumOrderQuantity: number | null;
  /** Quantities must be ordered in multiples of this number. */
  orderMultiple: number | null;
  /** HSN code for taxation (India). */
  hsnCode: string | null;
  /** GST rate as a percentage (0, 5, 12, 18, 28…). null = not set. */
  gstRate: number | null;
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
    parentId: data.parentId || null,
    sku,
    name: data.name,
    description: data.description || null,
    category: data.category || null,
    subcategory: data.subcategory || null,
    gender: data.gender || null,
    brand: data.brand || null,
    size: data.size || null,
    color: data.color || null,
    model: data.model || null,
    unitOfMeasure: data.unitOfMeasure || "piece",
    season: data.season || "all",
    barcode: data.barcode || null,
    barcodeType: data.barcodeType || null,
    unitsPerCarton: data.unitsPerCarton ?? null,
    unitPrice: data.unitPrice || 0,
    unitCost: data.unitCost || 0,
    mrp: data.mrp ?? null,
    ecommercePrice: data.ecommercePrice ?? null,
    retailerPrice: data.retailerPrice ?? null,
    distributorPrice: data.distributorPrice ?? null,
    flexiblePrice: data.flexiblePrice ?? null,
    minimumGrossMarginPercentage: data.minimumGrossMarginPercentage ?? null,
    reorderLevel: data.reorderLevel || 0,
    maxStock: data.maxStock || 0,
    leadTimeDays: data.leadTimeDays || 30,
    safetyStockDays: data.safetyStockDays || 30,
    supplierId: data.supplierId || null,
    supplierProductCode: data.supplierProductCode || null,
    minimumOrderQuantity: data.minimumOrderQuantity ?? null,
    orderMultiple: data.orderMultiple ?? null,
    hsnCode: data.hsnCode || null,
    gstRate: data.gstRate ?? null,
    imageUrl: data.imageUrl || null,
    status: data.status || "active",
    createdAt: now,
    updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<Product>) {
  const allowed = ["name","description","category","subcategory","gender","brand","size","color","model","unitOfMeasure","season","barcode","barcodeType","unitsPerCarton","unitPrice","unitCost","mrp","ecommercePrice","retailerPrice","distributorPrice","flexiblePrice","minimumGrossMarginPercentage","reorderLevel","maxStock","leadTimeDays","safetyStockDays","supplierId","supplierProductCode","minimumOrderQuantity","orderMultiple","hsnCode","gstRate","imageUrl","status","sku","parentId"];
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

/** Slugify a single variant attribute (colour / size) for SKU building. */
export function slugifyVariantPart(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Deterministic child SKU base from the parent SKU + colour/size, e.g.
 * RUN-100 + Black + 42 → "RUN-100-BLACK-42". Parts that are blank are omitted.
 */
export function buildVariantSku(
  parentSku: string,
  color?: string | null,
  size?: string | null,
): string {
  return slugifyVariantPart(
    [slugifyVariantPart(parentSku), slugifyVariantPart(color), slugifyVariantPart(size)]
      .filter(Boolean)
      .join("-"),
  );
}

/**
 * Child SKU with collision avoidance — if the deterministic base is already
 * taken by another product of this client, append -2, -3, … until free.
 */
export async function nextAvailableVariantSku(
  clientId: string,
  parentSku: string,
  color?: string | null,
  size?: string | null,
): Promise<string> {
  const base = buildVariantSku(parentSku, color, size);
  const products = await list(clientId);
  const taken = new Set((products as Product[]).map((p) => (p.sku ?? "").toUpperCase()));
  let candidate = base;
  for (let n = 2; taken.has(candidate.toUpperCase()); n++) {
    candidate = `${base}-${n}`;
  }
  return candidate;
}
