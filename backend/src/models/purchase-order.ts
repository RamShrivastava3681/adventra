import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export interface ProformaLine {
  productId: string;
  sku: string | null;
  name: string;
  /** Unit of measure from the catalogue (piece, pair, carton…). */
  unit: string;
  quantity: number;
  unitPrice: number;
  /** GST rate as a percentage (0–99). */
  gstRate: number | null;
  /** System-calculated: quantity × unitPrice (before GST). */
  lineTotal: number;
}

export interface PurchaseOrder {
  pk: string; sk: string; gsi1pk: string; gsi1sk: string;
  entityType: "PurchaseOrder";
  id: string; clientId: string;
  poNumber: string; amount: number; poAmount: number | null;
  side: "sales" | "purchase";
  status: string; currency: string;
  debtorId: string | null; vendorId: string | null;
  // ── Sales-side (customer proforma) fields ──
  /** Debtor contact person — auto-filled from the debtor master, editable. */
  debtorContact: string | null;
  /** Debtor GSTIN (India) — optional. */
  debtorGstin: string | null;
  issueDate: string; expectedDate: string | null;
  proformaNumber: string | null; proformaStatus: string;
  proformaDate: string | null;
  proformaFundedAmount: number | null; proformaFundedAt: string | null;
  proformaFundedBy: string | null; proformaFundingReference: string | null;
  proformaReviewedAt: string | null; proformaReviewedBy: string | null;
  proformaReviewComments: string | null;
  notes: string | null;
  // ── Supplier-proforma fields (purchase side) ──
  /** Supplier contact name/email — auto-filled from the supplier record, editable. */
  supplierContact: string | null;
  /** Supplier GSTIN (India) — optional. */
  supplierGstin: string | null;
  /** Quotation valid until. */
  validUntil: string | null;
  paymentTerms: string | null;
  /** Expected delivery date. */
  expectedDeliveryDate: string | null;
  /** Advance amount as a % of the proforma total (purchase side) — used to
   *  calculate the advance paid when treasury funds the proforma. */
  advancePct: number | null;
  /** Attached supplier quotation / proforma (PDF/image). */
  documents: any[];
  /** Catalogue product lines (purchase side). */
  lines: ProformaLine[];
  subtotal: number;
  gstTotal: number;
  freight: number;
  grandTotal: number;
  /** The goods Purchase Order this proforma was converted to (if any). */
  linkedGoodsPoId: string | null;
  /** The goods Sales Order this sales proforma was converted to (if any). */
  linkedGoodsSoId: string | null;
  createdAt: string; updatedAt: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeLineTotals(lines: ProformaLine[]): ProformaLine[] {
  return lines.map((l) => ({
    ...l,
    quantity: Number(l.quantity) || 0,
    unitPrice: Number(l.unitPrice) || 0,
    lineTotal: round2((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0)),
  }));
}

export function computeProformaTotals(lines: ProformaLine[], freight: number) {
  const normalized = computeLineTotals(lines);
  const subtotal = round2(normalized.reduce((s, l) => s + l.lineTotal, 0));
  const gstTotal = round2(
    normalized.reduce((s, l) => s + (l.quantity * l.unitPrice * (l.gstRate ?? 0)) / 100, 0),
  );
  const f = Number(freight) || 0;
  return { subtotal, gstTotal, freight: round2(f), grandTotal: round2(subtotal + gstTotal + f) };
}

export async function list(clientId: string) {
  const { items } = await db.queryByGSI1(clientId, { entityType: "PurchaseOrder", limit: 500, reverse: true });
  return items as PurchaseOrder[];
}

export async function get(id: string) { return db.getItem(`PURCHASE_ORDER#${id}`) as Promise<PurchaseOrder | null>; }

export async function create(data: Partial<PurchaseOrder> & { clientId: string; side: "sales" | "purchase"; poNumber?: string }) {
  const id = uuid(); const now = db.nowISO();
  const lines = computeLineTotals((data.lines ?? []) as ProformaLine[]);
  const totals = computeProformaTotals(lines, data.freight ?? 0);
  const item: PurchaseOrder = {
    pk: `PURCHASE_ORDER#${id}`, sk: `PURCHASE_ORDER#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`, gsi1sk: `PurchaseOrder#${now}`,
    entityType: "PurchaseOrder", id, clientId: data.clientId,
    poNumber: data.poNumber || `PF-${id.slice(0, 8).toUpperCase()}`,
    amount: data.amount || 0, poAmount: data.poAmount ?? null,
    side: data.side, status: data.status || "draft", currency: data.currency || "USD",
    debtorId: data.debtorId || null, vendorId: data.vendorId || null,
    debtorContact: data.debtorContact || null, debtorGstin: data.debtorGstin || null,
    issueDate: data.issueDate || db.todayDate(), expectedDate: data.expectedDate || null,
    proformaNumber: data.proformaNumber || null,
    proformaStatus: data.proformaStatus || "draft",
    proformaDate: data.proformaDate || null,
    proformaFundedAmount: data.proformaFundedAmount ?? null, proformaFundedAt: data.proformaFundedAt || null,
    proformaFundedBy: data.proformaFundedBy || null, proformaFundingReference: data.proformaFundingReference || null,
    proformaReviewedAt: data.proformaReviewedAt || null, proformaReviewedBy: data.proformaReviewedBy || null,
    proformaReviewComments: data.proformaReviewComments || null,
    notes: data.notes || null,
    supplierContact: data.supplierContact || null,
    supplierGstin: data.supplierGstin || null,
    validUntil: data.validUntil || null,
    paymentTerms: data.paymentTerms || null,
    expectedDeliveryDate: data.expectedDeliveryDate || null,
    advancePct: data.advancePct ?? null,
    documents: data.documents || [],
    lines,
    ...totals,
    linkedGoodsPoId: data.linkedGoodsPoId || null,
    linkedGoodsSoId: data.linkedGoodsSoId || null,
    createdAt: now, updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<PurchaseOrder>) {
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  const allowed = [
    "amount","poAmount","status","side","poNumber","debtorId","vendorId","issueDate","expectedDate","currency",
    "proformaNumber","proformaStatus","proformaDate","proformaFundedAmount","proformaFundedAt","proformaFundedBy",
    "proformaFundingReference","proformaReviewedAt","proformaReviewedBy","proformaReviewComments","notes",
    "supplierContact","supplierGstin","debtorContact","debtorGstin","validUntil","paymentTerms","expectedDeliveryDate","advancePct","documents",
    "lines","subtotal","gstTotal","freight","grandTotal","linkedGoodsPoId","linkedGoodsSoId",
  ];
  for (const k of allowed) { if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k]; }
  // Recompute line totals + document totals whenever lines/freight change.
  // When only lines change (e.g. a status edit), keep the stored freight.
  if (updates.lines !== undefined || updates.freight !== undefined) {
    const current = await get(id);
    const lines = computeLineTotals(
      updates.lines !== undefined ? (updates.lines as ProformaLine[]) : ((current?.lines ?? []) as ProformaLine[]),
    );
    patch.lines = lines;
    const freight = updates.freight !== undefined ? Number(updates.freight) || 0 : current?.freight ?? 0;
    Object.assign(patch, computeProformaTotals(lines, freight));
  }
  return db.updateItem(`PURCHASE_ORDER#${id}`, `PURCHASE_ORDER#${id}`, patch);
}

export async function remove(id: string) { return db.deleteItem(`PURCHASE_ORDER#${id}`); }
