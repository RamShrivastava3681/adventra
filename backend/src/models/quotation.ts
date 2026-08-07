import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

/**
 * Quotation — an offer to a customer/prospect. It NEVER affects inventory or
 * accounting: stock is only affected after a confirmed dispatch (sales order
 * → dispatch). An accepted quotation can be converted into a GoodsSalesOrder,
 * which carries the linked quotation number.
 */

export type QuotationDiscountType = "pct" | "amount" | null;

export interface QuotationLine {
  productId: string;
  sku: string | null;
  name: string;
  /** Unit of measure from the catalogue (piece, pair, carton…). */
  unit: string;
  quantity: number;
  /** Unit selling price offered to the customer (the original price). */
  unitPrice: number;
  /**
   * Maker's revised unit price — requires checker approval before the
   * quotation can be converted into a sales order. When set (non-null) it
   * becomes the effective price: line totals, document totals and the
   * converted sales order all use it; `unitPrice` is kept for comparison.
   */
  updatedUnitPrice: number | null;
  /** Discount kind — percentage or flat amount (optional). */
  discountType: QuotationDiscountType;
  /** Discount value: percent (0–100) when discountType="pct", amount when "amount". */
  discountValue: number | null;
  /** GST rate as a percentage (0–99), from the catalogue or overridden. */
  gstRate: number | null;
  /** System-calculated: quantity × effectivePrice − discount, before GST. */
  lineTotal: number;
  notes: string | null;
}

export interface Quotation {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "Quotation";
  id: string;
  clientId: string;
  /** System-generated (QT-XXXXXXXX) unless manually supplied. */
  quotationNumber: string;
  quotationDate: string;
  validUntil: string | null;
  customerId: string | null;
  /** Denormalized customer/prospect name for display. */
  customerName: string | null;
  contactPerson: string | null;
  billingAddress: string | null;
  deliveryAddress: string | null;
  /** Salesperson / owner who owns the quote. */
  salespersonId: string | null;
  salespersonName: string | null;
  paymentTerms: string | null;
  expectedDeliveryDate: string | null;
  notes: string | null;
  /** Attachments — optional. */
  documents: any[];
  status: string;
  lines: QuotationLine[];
  subtotal: number;
  totalDiscount: number;
  gstTotal: number;
  freight: number;
  grandTotal: number;
  /** Set when the quotation is converted to a sales order. */
  linkedGoodsSoId: string | null;
  /** Maker–checker price approval. null = not submitted. */
  approvalStatus: string | null;
  approvalRequestedAt: string | null;
  approvalReviewedBy: string | null;
  approvalReviewedAt: string | null;
  approvalComments: string | null;
  createdAt: string;
  updatedAt: string;
}

export const QUOTATION_STATUSES = [
  "draft",
  "sent",
  "accepted",
  "rejected",
  "expired",
  "converted_to_so",
] as const;

export const QUOTATION_APPROVAL_STATUSES = ["pending_review", "approved", "rejected"] as const;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Gross value before discount for a line: quantity × unitPrice. */
function grossValue(l: Pick<QuotationLine, "quantity" | "unitPrice">): number {
  return (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0);
}

/** Absolute discount applied to a line (from % or flat amount). */
function discountAmount(l: Pick<QuotationLine, "quantity" | "unitPrice" | "discountType" | "discountValue">): number {
  const gross = grossValue(l);
  const type = l.discountType === "pct" || l.discountType === "amount" ? l.discountType : null;
  const value = Number(l.discountValue) || 0;
  if (!type || value <= 0) return 0;
  if (type === "pct") return round2((gross * Math.min(100, value)) / 100);
  return round2(Math.min(value, gross));
}

/** Effective unit price — the revised price wins once the maker sets it. */
function effectivePrice(l: Pick<QuotationLine, "unitPrice" | "updatedUnitPrice">): number {
  if (l.updatedUnitPrice !== undefined && l.updatedUnitPrice !== null) {
    const n = Number(l.updatedUnitPrice);
    if (Number.isFinite(n)) return n;
  }
  return Number(l.unitPrice) || 0;
}

function computeLineTotals(lines: QuotationLine[]): QuotationLine[] {
  return lines.map((l) => {
    const quantity = Number(l.quantity) || 0;
    const unitPrice = Number(l.unitPrice) || 0;
    // Empty-string "updated price" is normalized to null by the route
    // validation, so only numbers/null reach the model.
    const updatedUnitPrice =
      l.updatedUnitPrice === undefined || l.updatedUnitPrice === null
        ? null
        : Number(l.updatedUnitPrice);
    const eff = effectivePrice({ unitPrice, updatedUnitPrice });
    const normalized: QuotationLine = {
      ...l,
      quantity,
      unitPrice,
      updatedUnitPrice,
      unit: l.unit || "unit",
      discountType:
        l.discountType === "pct" || l.discountType === "amount" ? l.discountType : null,
      discountValue: l.discountValue === undefined || l.discountValue === null ? null : Number(l.discountValue) || 0,
      lineTotal: round2(grossValue({ quantity, unitPrice: eff }) - discountAmount({ ...l, quantity, unitPrice: eff })),
      notes: l.notes || null,
    };
    return normalized;
  });
}

export function computeTotals(lines: QuotationLine[], freight: number) {
  const normalized = computeLineTotals(lines);
  const subtotal = round2(normalized.reduce((s, l) => s + l.lineTotal, 0));
  const totalDiscount = round2(
    normalized.reduce((s, l) => s + discountAmount({ ...l, unitPrice: effectivePrice(l) }), 0),
  );
  const gstTotal = round2(normalized.reduce((s, l) => s + (l.lineTotal * (l.gstRate ?? 0)) / 100, 0));
  const f = Number(freight) || 0;
  return { subtotal, totalDiscount, gstTotal, freight: round2(f), grandTotal: round2(subtotal + gstTotal + f) };
}

export async function list(clientId: string) {
  const { items } = await db.queryByGSI1(clientId, { entityType: "Quotation", limit: 500, reverse: true });
  return items as Quotation[];
}

export async function get(id: string) {
  return db.getItem(`QUOTATION#${id}`) as Promise<Quotation | null>;
}

export async function create(data: Partial<Quotation> & { clientId: string }) {
  const id = uuid();
  const now = db.nowISO();
  const lines = computeLineTotals((data.lines ?? []) as QuotationLine[]);
  const totals = computeTotals(lines, data.freight ?? 0);
  const status = data.status && QUOTATION_STATUSES.includes(data.status as any) ? data.status : "draft";
  const item: Quotation = {
    pk: `QUOTATION#${id}`,
    sk: `QUOTATION#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`,
    gsi1sk: `Quotation#${now}`,
    entityType: "Quotation",
    id,
    clientId: data.clientId,
    quotationNumber: data.quotationNumber || `QT-${id.slice(0, 8).toUpperCase()}`,
    quotationDate: data.quotationDate || db.todayDate(),
    validUntil: data.validUntil || null,
    customerId: data.customerId || null,
    customerName: data.customerName || null,
    contactPerson: data.contactPerson || null,
    billingAddress: data.billingAddress || null,
    deliveryAddress: data.deliveryAddress || null,
    salespersonId: data.salespersonId || null,
    salespersonName: data.salespersonName || null,
    paymentTerms: data.paymentTerms || null,
    expectedDeliveryDate: data.expectedDeliveryDate || null,
    notes: data.notes || null,
    documents: data.documents || [],
    status,
    lines,
    ...totals,
    linkedGoodsSoId: data.linkedGoodsSoId || null,
    approvalStatus: data.approvalStatus || null,
    approvalRequestedAt: data.approvalRequestedAt || null,
    approvalReviewedBy: data.approvalReviewedBy || null,
    approvalReviewedAt: data.approvalReviewedAt || null,
    approvalComments: data.approvalComments || null,
    createdAt: now,
    updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<Quotation>) {
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  const allowed = [
    "quotationNumber", "quotationDate", "validUntil", "customerId", "customerName",
    "contactPerson", "billingAddress", "deliveryAddress", "salespersonId", "salespersonName",
    "paymentTerms", "expectedDeliveryDate", "notes", "documents", "status",
    "lines", "subtotal", "totalDiscount", "gstTotal", "freight", "grandTotal", "linkedGoodsSoId",
    "approvalStatus", "approvalRequestedAt", "approvalReviewedBy", "approvalReviewedAt",
    "approvalComments",
  ];
  for (const k of allowed) {
    if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k];
  }
  if (updates.lines !== undefined || updates.freight !== undefined) {
    const current = await get(id);
    const lines = computeLineTotals(
      updates.lines !== undefined ? (updates.lines as QuotationLine[]) : ((current?.lines ?? []) as QuotationLine[]),
    );
    patch.lines = lines;
    const freight = updates.freight !== undefined ? Number(updates.freight) || 0 : current?.freight ?? 0;
    Object.assign(patch, computeTotals(lines, freight));
  }
  return db.updateItem(`QUOTATION#${id}`, `QUOTATION#${id}`, patch);
}

export async function remove(id: string) {
  return db.deleteItem(`QUOTATION#${id}`);
}
