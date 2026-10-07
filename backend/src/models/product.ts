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
  /** Id of the parent product when this is a colour or size SKU. */
  parentId: string | null;
  /** parent → colour → variant; legacy records have null. */
  skuLevel: "parent" | "color" | "variant" | null;
  categoryMasterId: string | null;
  genderMasterId: string | null;
  colorMasterId: string | null;
  sizeMasterId: string | null;
  /** Size system for this SKU: EU / UK / US / Custom. Null = not a sized SKU. */
  sizeSystem: string | null;
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
  // Shared database: SKUs must be unique globally, not just within the
  // creator's own records, so every user sees one consistent catalogue.
  const existing = await list();
  if ((existing as Product[]).some((p) => p.sku?.toUpperCase() === sku.toUpperCase())) {
    throw new Error(`SKU already exists: ${sku}`);
  }
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
    skuLevel: data.skuLevel || null,
    categoryMasterId: data.categoryMasterId || null,
    genderMasterId: data.genderMasterId || null,
    colorMasterId: data.colorMasterId || null,
    sizeMasterId: data.sizeMasterId || null,
    sizeSystem: data.sizeSystem || null,
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
  const current = await get(id);
  if (!current) throw new Error("Product not found");
  if (updates.sku !== undefined && String(updates.sku).toUpperCase() !== current.sku.toUpperCase()) {
    // Shared database: uniqueness is checked across the whole catalogue.
    const siblings = await list();
    if ((siblings as Product[]).some((p) => p.id !== id && p.sku?.toUpperCase() === String(updates.sku).toUpperCase())) {
      throw new Error(`SKU already exists: ${updates.sku}`);
    }
  }
  const allowed = ["name","description","category","subcategory","gender","brand","size","color","model","unitOfMeasure","season","barcode","barcodeType","unitsPerCarton","unitPrice","unitCost","mrp","ecommercePrice","retailerPrice","distributorPrice","flexiblePrice","minimumGrossMarginPercentage","reorderLevel","maxStock","leadTimeDays","safetyStockDays","supplierId","supplierProductCode","minimumOrderQuantity","orderMultiple","hsnCode","gstRate","imageUrl","status","sku","parentId","skuLevel","categoryMasterId","genderMasterId","colorMasterId","sizeMasterId","sizeSystem"];
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
  // Shared database: collision check runs against the whole catalogue so two
  // users can never mint the same variant SKU. `clientId` is kept in the
  // signature for back-compat.
  void clientId;
  const products = await list();
  const taken = new Set((products as Product[]).map((p) => (p.sku ?? "").toUpperCase()));
  let candidate = base;
  for (let n = 2; taken.has(candidate.toUpperCase()); n++) {
    candidate = `${base}-${n}`;
  }
  return candidate;
}

// ── Size systems (EU / UK / US / Custom) ─────────────────────────────────────

export const SIZE_SYSTEMS = ["EU", "UK", "US", "Custom"] as const;
export type SizeSystem = (typeof SIZE_SYSTEMS)[number];

/** Reference EU ↔ UK ↔ US footwear size map shown in the variant UI. */
export const FOOTWEAR_SIZE_MAP: Array<{ eu: string; uk: string; us: string }> = [
  { eu: "38", uk: "5", us: "6" },
  { eu: "39", uk: "6", us: "7" },
  { eu: "40", uk: "6.5", us: "7.5" },
  { eu: "41", uk: "7", us: "8" },
  { eu: "42", uk: "8", us: "9" },
  { eu: "43", uk: "9", us: "10" },
  { eu: "44", uk: "9.5", us: "10.5" },
  { eu: "45", uk: "10", us: "11" },
  { eu: "46", uk: "11", us: "12" },
  { eu: "47", uk: "12", us: "13" },
];

export function normalizeSizeSystem(v: unknown): string | null {
  const s = String(v ?? "").trim().toUpperCase();
  if (!s) return null;
  if ((SIZE_SYSTEMS as readonly string[]).includes(s)) return s;
  return "Custom";
}

export interface BulkVariantResult {
  created: Product[];
  skipped: Array<{ size: string; reason: string }>;
}

/**
 * Create multiple size SKUs under one colour SKU in a single call.
 * Sizes that already exist under the colour are skipped (reported, not fatal)
 * so the UI can tick "all sizes" without pre-checking each one.
 */
export async function bulkCreateSizeVariants(
  colourProductId: string,
  data: {
    clientId: string;
    sizes: string[];
    sizeSystem?: string | null;
    sizeMasterId?: string | null;
  },
): Promise<BulkVariantResult> {
  const parent = await get(colourProductId);
  if (!parent) throw new Error("Colour SKU not found");
  const parentIsColour =
    parent.skuLevel === "color" || (!parent.size?.trim() && !!parent.color?.trim());
  if (!parentIsColour && parent.skuLevel === "variant") {
    throw new Error("A size SKU cannot have variants. Add sizes under a colour SKU instead.");
  }
  const sizeSystem = normalizeSizeSystem(data.sizeSystem);
  const siblings = (await list()).filter((p) => p.parentId === colourProductId);
  const takenSizes = new Set(
    siblings.map((p) => (p.size ?? "").trim().toUpperCase()).filter(Boolean),
  );
  const created: Product[] = [];
  const skipped: BulkVariantResult["skipped"] = [];
  for (const raw of data.sizes) {
    const size = String(raw ?? "").trim();
    if (!size) continue;
    if (takenSizes.has(size.toUpperCase())) {
      skipped.push({ size, reason: "Size already exists under this colour" });
      continue;
    }
    takenSizes.add(size.toUpperCase());
    const sku = await nextAvailableVariantSku(data.clientId, parent.sku, parent.color, size);
    const item = await create({
      clientId: data.clientId,
      parentId: parent.id,
      skuLevel: "variant",
      sku,
      name: `${parent.name} — ${[parent.color, size].filter(Boolean).map((a) => String(a).toUpperCase()).join(" / ")}`,
      color: parent.color,
      size,
      colorMasterId: parent.colorMasterId,
      sizeMasterId: data.sizeMasterId || null,
      sizeSystem,
      category: parent.category,
      subcategory: parent.subcategory,
      gender: parent.gender,
      brand: parent.brand,
      model: parent.model,
      unitOfMeasure: parent.unitOfMeasure,
      unitPrice: parent.unitPrice,
      unitCost: parent.unitCost,
      mrp: parent.mrp,
      hsnCode: parent.hsnCode,
      gstRate: parent.gstRate,
      status: "active",
    });
    created.push(item);
  }
  return { created, skipped };
}
