import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";
import { PaymentTermsType, normalizePaymentTermsType, normalizeAdvancePct } from "../lib/payment-terms.js";

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
  /** Catalogue snapshot: variant colour (for the garment PO print). */
  color: string | null;
  /** Catalogue snapshot: variant size (size-breakup columns on the PO print). */
  size: string | null;
  /** Fabric entered per line (no fabric master — free text, e.g. "Rib Stop"). */
  fabric: string | null;
  /** HSN/SAC code snapshot from the catalogue (printed on the PO). */
  hsnCode: string | null;
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
  expectedDate: string | null;
  dueDate: string | null;
  paymentTerms: string | null;
  /** Structured payment terms: credit (Net N), advance_full (100% advance),
   *  advance_partial (X% advance + remainder on delivery) or on_delivery. */
  paymentTermsType: PaymentTermsType | null;
  /** Advance percentage for advance_partial terms (1–99). */
  advancePct: number | null;
  buyerId: string | null;
  buyerName: string | null;
  notes: string | null;
  // ── Garment PO print details (all optional — blank renders blank) ──
  /** Vendor quotation number printed on the PO. */
  quotationNo: string | null;
  /** Vendor quotation date (YYYY-MM-DD). */
  quotationDate: string | null;
  /** Vendor contact person for the PO header. */
  contactPerson: string | null;
  /** Vendor contact phone/email line ("Contact Person Contact"). */
  contactPersonContact: string | null;
  /** Vendor address line printed under the vendor name. */
  vendorAddress: string | null;
  /** Vendor GSTIN/UIN printed on the PO. */
  vendorGstin: string | null;
  /** Vendor PAN/IT No printed on the PO. */
  vendorPan: string | null;
  /** Vendor state name printed on the PO. */
  vendorState: string | null;
  /** Free-text payment-terms line for the print (e.g. "25% Advance, …"). */
  paymentTermsNote: string | null;
  /** Delivery note date (YYYY-MM-DD). */
  deliveryNoteDate: string | null;
  /** How goods are dispatched (e.g. "By Road"). */
  dispatchedThrough: string | null;
  /** Shipment destination city. */
  destination: string | null;
  /** Packaging instructions line. */
  packaging: string | null;
  /** Delivery window (e.g. "9 to 15 May, 2026"). */
  deliveryTime: string | null;
  /** Partial-shipment clause line. */
  partialShip: string | null;
  /** Delivery-standard clause line. */
  deliveryStandard: string | null;
  /** Schedule-change notification clause line. */
  notificationClause: string | null;
  /** Cancellation clause line. */
  cancellationClause: string | null;
  /** Delay / penalty clause line. */
  delayClause: string | null;
  /** Other terms line (e.g. pre-production sample approval). */
  otherTerms: string | null;
  /** Delivery-terms line (e.g. landed prices incl. freight). */
  deliveryTermsLine: string | null;
  /** Place of supply (state name). */
  placeOfSupply: string | null;
  /** Bill-to buyer address (buyer name uses buyerName). */
  buyerAddress: string | null;
  /** Bill-to buyer GSTIN/UIN. */
  buyerGstin: string | null;
  /** Bill-to debtor selection (address fetched from the debtor master). */
  billToDebtorId: string | null;
  /** Bill-to address (defaults to the selected debtor's billing address). */
  billToAddress: string | null;
  /** Ship-to supplier selection (address fetched from the supplier master). */
  shipToSupplierId: string | null;
  /** Ship-to address (defaults to the selected supplier's address). */
  shipToAddress: string | null;
  documents: any[];
  status: string;
  /**
   * The last manually-set status (draft / pending_review / approved / sent /
   * cancelled). Receipt-driven statuses (partially/fully_received) are derived
   * and this field is the fallback when receipts are fully revoked.
   */
  manualStatus: string;
  /** Who reviewed this PO at the maker–checker step (checker/admin id). null = not yet reviewed. */
  reviewedBy: string | null;
  /** When the checker reviewed this PO. null = not yet reviewed. */
  reviewedAt: string | null;
  /** Supplier (vendor) approval via the emailed PDF. null = never sent. */
  supplierApprovalStatus: "pending" | "approved" | "rejected" | null;
  /** One-time secure token embedded in the approval link — nulled on response. */
  supplierApprovalToken: string | null;
  /** When the "send to supplier" email with the PDF was dispatched. */
  supplierApprovalSentAt: string | null;
  /** When the supplier clicked approve/reject. */
  supplierApprovalRespondedAt: string | null;
  /** Optional comments left by the supplier (usually with a rejection). */
  supplierApprovalComments: string | null;
  /** The email address the PDF was sent to. */
  supplierApprovalEmail: string | null;
  lines: GoodsPOLine[];
  totalQty: number;
  subtotal: number;
  gstTotal: number;
  freight: number;
  grandTotal: number;
  createdAt: string;
  updatedAt: string;
}

export const PO_STATUSES = [
  "draft",
  "pending_review",
  "approved",
  "sent",
  "partially_received",
  "fully_received",
  "cancelled",
] as const;
const MANUAL_STATUSES = [
  "draft",
  "pending_review",
  "approved",
  "sent",
  "cancelled",
];

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
  return {
    totalQty,
    subtotal,
    gstTotal,
    freight: round2(f),
    grandTotal: round2(subtotal + gstTotal + f),
  };
}

export function recomputeStatus(
  po: Pick<GoodsPurchaseOrder, "status" | "manualStatus" | "lines">,
): string {
  const lines = po.lines ?? [];
  if (
    lines.length > 0 &&
    lines.every((l) => (l.receivedQty ?? 0) >= l.orderedQty && l.orderedQty > 0)
  ) {
    return "fully_received";
  }
  if (lines.some((l) => (l.receivedQty ?? 0) > 0)) {
    return "partially_received";
  }
  return po.manualStatus || po.status || "sent";
}

export async function list(clientId?: string) {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, {
      entityType: "GoodsPurchaseOrder",
      limit: 500,
      reverse: true,
    });
    return items as GoodsPurchaseOrder[];
  }
  return db.scanByType("GoodsPurchaseOrder", { limit: 2000 }) as Promise<GoodsPurchaseOrder[]>;
}

export async function get(id: string) {
  return db.getItem(`GOODS_PO#${id}`) as Promise<GoodsPurchaseOrder | null>;
}

export async function create(
  data: Partial<GoodsPurchaseOrder> & { clientId: string },
) {
  const id = uuid();
  const now = db.nowISO();
  const lines = computeLineTotals((data.lines ?? []) as GoodsPOLine[]);
  const totals = computeTotals(lines, data.freight ?? 0);
  const status =
    data.status && PO_STATUSES.includes(data.status as any)
      ? data.status
      : "draft";
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
    expectedDate: data.expectedDate || data.dueDate || data.expectedDeliveryDate || data.poDate || null,
    dueDate: data.dueDate || null,
    paymentTerms: data.paymentTerms || null,
    paymentTermsType: normalizePaymentTermsType(data.paymentTermsType),
    advancePct: normalizeAdvancePct(data.advancePct),
    buyerId: data.buyerId || null,
    buyerName: data.buyerName || null,
    notes: data.notes || null,
    quotationNo: data.quotationNo || null,
    quotationDate: data.quotationDate || null,
    contactPerson: data.contactPerson || null,
    contactPersonContact: data.contactPersonContact || null,
    vendorAddress: data.vendorAddress || null,
    vendorGstin: data.vendorGstin || null,
    vendorPan: data.vendorPan || null,
    vendorState: data.vendorState || null,
    paymentTermsNote: data.paymentTermsNote || null,
    deliveryNoteDate: data.deliveryNoteDate || null,
    dispatchedThrough: data.dispatchedThrough || null,
    destination: data.destination || null,
    packaging: data.packaging || null,
    deliveryTime: data.deliveryTime || null,
    partialShip: data.partialShip || null,
    deliveryStandard: data.deliveryStandard || null,
    notificationClause: data.notificationClause || null,
    cancellationClause: data.cancellationClause || null,
    delayClause: data.delayClause || null,
    otherTerms: data.otherTerms || null,
    deliveryTermsLine: data.deliveryTermsLine || null,
    placeOfSupply: data.placeOfSupply || null,
    buyerAddress: data.buyerAddress || null,
    buyerGstin: data.buyerGstin || null,
    billToDebtorId: data.billToDebtorId || null,
    billToAddress: data.billToAddress || null,
    shipToSupplierId: data.shipToSupplierId || null,
    shipToAddress: data.shipToAddress || null,
    documents: data.documents || [],
    status,
    manualStatus: status,
    reviewedBy: data.reviewedBy || null,
    reviewedAt: data.reviewedAt || null,
    supplierApprovalStatus: (data.supplierApprovalStatus as any) || null,
    supplierApprovalToken: data.supplierApprovalToken || null,
    supplierApprovalSentAt: data.supplierApprovalSentAt || null,
    supplierApprovalRespondedAt: data.supplierApprovalRespondedAt || null,
    supplierApprovalComments: data.supplierApprovalComments || null,
    supplierApprovalEmail: data.supplierApprovalEmail || null,
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
    "poNumber",
    "poDate",
    "supplierId",
    "supplierName",
    "warehouse",
    "expectedDeliveryDate",
    "expectedDate",
    "dueDate",
    "paymentTerms",
    "paymentTermsType",
    "advancePct",
    "buyerId",
    "buyerName",
    "notes",
    "quotationNo",
    "quotationDate",
    "contactPerson",
    "contactPersonContact",
    "vendorAddress",
    "vendorGstin",
    "vendorPan",
    "vendorState",
    "paymentTermsNote",
    "deliveryNoteDate",
    "dispatchedThrough",
    "destination",
    "packaging",
    "deliveryTime",
    "partialShip",
    "deliveryStandard",
    "notificationClause",
    "cancellationClause",
    "delayClause",
    "otherTerms",
    "deliveryTermsLine",
    "placeOfSupply",
    "buyerAddress",
    "buyerGstin",
    "billToDebtorId",
    "billToAddress",
    "shipToSupplierId",
    "shipToAddress",
    "documents",
    "status",
    "manualStatus",
    "reviewedBy",
    "reviewedAt",
    "supplierApprovalStatus",
    "supplierApprovalToken",
    "supplierApprovalSentAt",
    "supplierApprovalRespondedAt",
    "supplierApprovalComments",
    "supplierApprovalEmail",
    "lines",
    "totalQty",
    "subtotal",
    "gstTotal",
    "freight",
    "grandTotal",
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
      updates.lines !== undefined
        ? (updates.lines as GoodsPOLine[])
        : ((current?.lines ?? []) as GoodsPOLine[]),
    );
    patch.lines = lines;
    const freight =
      updates.freight !== undefined
        ? Number(updates.freight) || 0
        : (current?.freight ?? 0);
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
export async function recordReceipt(
  poId: string,
  received: Array<{ productId: string; receivedQty: number }>,
) {
  const po = await get(poId);
  if (!po) throw new Error("PO not found");
  if (po.status === "cancelled")
    throw new Error("Cannot receive against a cancelled PO");
  if (po.status === "draft" || po.status === "pending_review")
    throw new Error("Approve and send the PO before receiving goods");
  if (po.status === "fully_received")
    throw new Error("PO is already fully received");
  const lines = (po.lines ?? []).map((l) => {
    const r = received.find((x) => x.productId === l.productId);
    return r ? { ...l, receivedQty: (l.receivedQty ?? 0) + r.receivedQty } : l;
  });
  return update(poId, { lines, status: recomputeStatus({ ...po, lines }) });
}

/** Subtract received quantities (when a GRN is revoked/deleted) and recompute the status. */
export async function revokeReceipt(
  poId: string,
  revoked: Array<{ productId: string; receivedQty: number }>,
) {
  const po = await get(poId);
  if (!po) throw new Error("PO not found");
  const lines = (po.lines ?? []).map((l) => {
    const r = revoked.find((x) => x.productId === l.productId);
    return r
      ? { ...l, receivedQty: Math.max(0, (l.receivedQty ?? 0) - r.receivedQty) }
      : l;
  });
  return update(poId, { lines, status: recomputeStatus({ ...po, lines }) });
}
