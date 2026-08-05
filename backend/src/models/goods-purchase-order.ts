import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

/**
 * Goods Purchase Order (PO) — a purchase request/commitment against the
 * product catalogue. A PO NEVER creates inventory: only a GRN (goods receipt)
 * credits stock. Received quantities are updated from GRNs via recordReceipt.
 *
 * This is a separate entity from the existing "PurchaseOrder" (proforma /
 * advance-funding) model — goods POs live under GoodsPurchaseOrder.
 */

export interface GoodsPOLine {
  productId: string;
  sku: string | null;
  name: string;
  /** Unit of measure from the catalogue (piece, pair, carton…) */
  unit: string;
  orderedQty: number;
  /** Unit purchase price agreed with the supplier. */
  unitPrice: number;
  /** GST rate as a percentage (0–99), from the catalogue or overridden. */
  gstRate: number | null;
  /** System-calculated: orderedQty × unitPrice (before GST). */
  lineTotal: number;
  /** System-maintained: sum of received quantities from GRNs. */
  receivedQty: number;
}

export interface GoodsPurchaseOrder {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "GoodsPurchaseOrder";
  id: string;
  clientId: string;
  /** System-generated (PO-XXXXXXXX) unless manually supplied. */
  poNumber: string;
  poDate: string;
  supplierId: string | null;
  /** Denormalized supplier name for display. */
  supplierName: string | null;
  /** Delivery warehouse / store (free text — no warehouse master yet). */
  warehouse: string | null;
  expectedDeliveryDate: string | null;
  paymentTerms: string | null;
  buyerId: string | null;
  buyerName: string | null;
  notes: string | null;
  documents: any[];
  status: string;
  /**
   * The last manually-set status (draft / approved / sent / cancelled).
   * Receipt-driven statuses (partially/fully_received) are derived and this
   * field is the fallback when receipts are fully revoked.
   */
  manualStatus: string;
  lines: GoodsPOLine[];
  totalQty: number;
  subtotal: number;
  gstTotal: number;
  freight: number;
  grandTotal: number;
  createdAt: string;
  updatedAt: string;
}

export const PO_STATUSES = ["draft", "approved", "sent", "partially_received", "fully_received", "cancelled"] as const;
const MANUAL_STATUSES = ["draft", "approved", "sent", "cancelled"];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeLineTotals(lines: GoodsPOLine[]): GoodsPOLine[] {
  return lines.map((l) => ({
    ...l,
    orderedQty: Number(l.orderedQty) || 0,
    unitPrice: Number(l.unitPrice) || 0,
    lineTotal: round2((Number(l.orderedQty) || 0) * (Number(l.unitPrice) || 0)),
    receivedQty: l.receivedQty ?? 0,
  }));
}

export function computeTotals(lines: GoodsPOLine[], freight: number) {
  const normalized = computeLineTotals(lines);
  const totalQty = normalized.reduce((s, l) => s + l.orderedQty, 0);
  const subtotal = round2(normalized.reduce((s, l) => s + l.lineTotal, 0));
  const gstTotal = round2(
    normalized.reduce(
      (s, l) => s + (l.orderedQty * l.unitPrice * (l.gstRate ?? 0)) / 100,
      0,
    ),
  );
  const f = Number(freight) || 0;
  return { totalQty, subtotal, gstTotal, freight: round2(f), grandTotal: round2(subtotal + gstTotal + f) };
}

export function recomputeStatus(po: Pick<GoodsPurchaseOrder, "status" | "manualStatus" | "lines">): string {
  const lines = po.lines ?? [];
  if (lines.length > 0 && lines.every((l) => (l.receivedQty ?? 0) >= l.orderedQty && l.orderedQty > 0)) {
    return "fully_received";
  }
  if (lines.some((l) => (l.receivedQty ?? 0) > 0)) {
    return "partially_received";
  }
  return po.manualStatus || po.status || "sent";
}

export async function list(clientId: string) {
  const { items } = await db.queryByGSI1(clientId, { entityType: "GoodsPurchaseOrder", limit: 500, reverse: true });
  return items as GoodsPurchaseOrder[];
}

export async function get(id: string) {
  return db.getItem(`GOODS_PO#${id}`) as Promise<GoodsPurchaseOrder | null>;
}

export async function create(data: Partial<GoodsPurchaseOrder> & { clientId: string }) {
  const id = uuid();
  const now = db.nowISO();
  const lines = computeLineTotals((data.lines ?? []) as GoodsPOLine[]);
  const totals = computeTotals(lines, data.freight ?? 0);
  const status = data.status && PO_STATUSES.includes(data.status as any) ? data.status : "draft";
  const item: GoodsPurchaseOrder = {
    pk: `GOODS_PO#${id}`,
    sk: `GOODS_PO#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`,
    gsi1sk: `GoodsPurchaseOrder#${now}`,
    entityType: "GoodsPurchaseOrder",
    id,
    clientId: data.clientId,
    poNumber: data.poNumber || `PO-${id.slice(0, 8).toUpperCase()}`,
    poDate: data.poDate || db.todayDate(),
    supplierId: data.supplierId || null,
    supplierName: data.supplierName || null,
    warehouse: data.warehouse || null,
    expectedDeliveryDate: data.expectedDeliveryDate || null,
    paymentTerms: data.paymentTerms || null,
    buyerId: data.buyerId || null,
    buyerName: data.buyerName || null,
    notes: data.notes || null,
    documents: data.documents || [],
    status,
    manualStatus: status,
    lines,
    ...totals,
    createdAt: now,
    updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<GoodsPurchaseOrder>) {
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  const allowed = [
    "poNumber", "poDate", "supplierId", "supplierName", "warehouse", "expectedDeliveryDate",
    "paymentTerms", "buyerId", "buyerName", "notes", "documents", "status", "manualStatus",
    "lines", "totalQty", "subtotal", "gstTotal", "freight", "grandTotal",
  ];
  for (const k of allowed) {
    if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k];
  }
  // Recompute line totals + document totals whenever lines/freight change.
  // When only lines change (e.g. a receipt folds in received quantities), keep
  // the stored freight so totals don't silently drop the freight charge.
  if (updates.lines !== undefined || updates.freight !== undefined) {
    const current = await get(id);
    const lines = computeLineTotals(
      updates.lines !== undefined ? (updates.lines as GoodsPOLine[]) : ((current?.lines ?? []) as GoodsPOLine[]),
    );
    patch.lines = lines;
    const freight =
      updates.freight !== undefined ? Number(updates.freight) || 0 : current?.freight ?? 0;
    Object.assign(patch, computeTotals(lines, freight));
  }
  // Track the manual status so receipt-derived statuses can fall back to it.
  if (updates.status && MANUAL_STATUSES.includes(updates.status)) {
    patch.manualStatus = updates.status;
  }
  return db.updateItem(`GOODS_PO#${id}`, `GOODS_PO#${id}`, patch);
}

export async function remove(id: string) {
  return db.deleteItem(`GOODS_PO#${id}`);
}

/** Add received quantities (from a GRN) to PO lines and recompute the status. */
export async function recordReceipt(poId: string, received: Array<{ productId: string; receivedQty: number }>) {
  const po = await get(poId);
  if (!po) throw new Error("PO not found");
  if (po.status === "cancelled") throw new Error("Cannot receive against a cancelled PO");
  if (po.status === "draft") throw new Error("Approve and send the PO before receiving goods");
  if (po.status === "fully_received") throw new Error("PO is already fully received");
  const lines = (po.lines ?? []).map((l) => {
    const r = received.find((x) => x.productId === l.productId);
    return r ? { ...l, receivedQty: (l.receivedQty ?? 0) + r.receivedQty } : l;
  });
  return update(poId, { lines, status: recomputeStatus({ ...po, lines }) });
}

/** Subtract received quantities (when a GRN is revoked/deleted) and recompute the status. */
export async function revokeReceipt(poId: string, revoked: Array<{ productId: string; receivedQty: number }>) {
  const po = await get(poId);
  if (!po) throw new Error("PO not found");
  const lines = (po.lines ?? []).map((l) => {
    const r = revoked.find((x) => x.productId === l.productId);
    return r ? { ...l, receivedQty: Math.max(0, (l.receivedQty ?? 0) - r.receivedQty) } : l;
  });
  return update(poId, { lines, status: recomputeStatus({ ...po, lines }) });
}
