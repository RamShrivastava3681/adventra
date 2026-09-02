import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

/**
 * Line on a purchase invoice — snapshotted from the linked goods PO, with
 * quantities and prices taken from the supplier's invoice.
 *
 * IMPORTANT: a purchase invoice NEVER creates stock. Only a confirmed GRN
 * (goods receipt) credits inventory. The GRN is created AFTER the invoice and
 * linked back to it; the GRN received quantity is back-filled onto each line
 * once that link exists.
 */
export interface PurchaseInvoiceLine {
  productId: string;
  sku: string | null;
  name: string;
  /** Unit of measure from the catalogue (piece, pair, carton…). */
  unit: string;
  /** Ordered quantity on the linked goods PO (snapshot). */
  orderedQty: number;
  /** Accepted quantity on the linked GRN — auto-filled once a GRN is linked. */
  grnReceivedQty: number;
  /** Quantity billed on the supplier invoice (entered). */
  invoiceQty: number;
  /** Unit price billed on the supplier invoice (entered). */
  unitPrice: number;
  /** PO unit price snapshot — used for the price-difference check. */
  poUnitPrice: number | null;
  /** GST rate as a percentage (0–99), from the PO or overridden. */
  gstRate: number | null;
  /** System-calculated: invoiceQty × unitPrice (before GST). */
  lineTotal: number;
}

export interface PurchaseInvoice {
  pk: string; sk: string; gsi1pk: string; gsi1sk: string;
  entityType: "PurchaseInvoice";
  id: string; clientId: string; vendorId: string;
  /** Denormalized supplier/vendor name for display. */
  supplierName: string | null;
  /** Supplier invoice number. */
  invoiceNumber: string;
  /**
   * Current payable amount. For a new invoice this equals grandTotal. It may
   * diverge when a credit/debit note adjustment is applied (legacy flow).
   */
  amount: number;
  poNumber: string | null; poDate: string | null; poAmount: number | null;
  /** Invoice date (date on the supplier's invoice). */
  issueDate: string;
  /** Invoice received date — when the invoice arrived at the business. */
  receivedDate: string | null;
  dueDate: string | null; expectedDate?: string | null;
  agreedPaymentDate?: string | null;
  paidDate: string | null;
  status: string; notes: string | null;
  /** Linked goods PO (catalogue-backed purchase order). */
  goodsPurchaseOrderId: string | null;
  goodsPoNumber: string | null;
  /** Linked supplier proforma (purchase side) — optional. */
  linkedSupplierProformaId: string | null;
  linkedSupplierProformaNumber: string | null;
  /** Linked GRN — created after the invoice; back-filled by the GRN routes. */
  linkedGoodsReceiptId: string | null;
  linkedGoodsReceiptNumber: string | null;
  /** Catalogue lines (from the linked PO). */
  lines: PurchaseInvoiceLine[];
  subtotal: number; gstTotal: number; freight: number; grandTotal: number;
  /**
   * System-calculated: advances already paid to the supplier against the
   * linked proforma, deducted from the document total. The invoice `amount`
   * (net payable to the supplier) is grandTotal − advanceDeducted, never
   * negative.
   */
  advanceDeducted: number;
  amountPaid: number; balanceDue: number;
  /** Explanations for quantity/price differences vs GRN/PO. */
  differenceNotes: string | null;
  advanceRate: number; advancePaidDate: string | null;
  fundedDate: string | null; purchaseOrderId: string | null;
  documents: any[];
  /** Tracks the last date an overdue reminder email was sent (YYYY-MM-DD). Used by the daily reminder cron. */
  lastOverdueReminderDate: string | null;
  createdAt: string; updatedAt: string;
}

export const PI_STATUSES = [
  "draft",
  "verified",
  "approved_for_payment",
  "partially_paid",
  "paid",
  "cancelled",
] as const;

export const PI_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  verified: "Verified",
  approved_for_payment: "Approved for Payment",
  partially_paid: "Partially Paid",
  paid: "Paid",
  cancelled: "Cancelled",
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeLineTotals(lines: PurchaseInvoiceLine[]): PurchaseInvoiceLine[] {
  return (lines ?? []).map((l) => {
    const invoiceQty = Number(l.invoiceQty) || 0;
    const unitPrice = Number(l.unitPrice) || 0;
    const gst = Number(l.gstRate);
    return {
      ...l,
      unit: l.unit || "unit",
      orderedQty: Number(l.orderedQty) || 0,
      grnReceivedQty: Number(l.grnReceivedQty) || 0,
      invoiceQty,
      unitPrice,
      lineTotal: round2(invoiceQty * unitPrice),
      gstRate:
        l.gstRate != null && Number.isFinite(gst) && gst >= 0 && gst <= 100 ? gst : null,
    };
  });
}

export function computeTotals(lines: PurchaseInvoiceLine[], freight: number) {
  const normalized = computeLineTotals(lines);
  const subtotal = round2(normalized.reduce((s, l) => s + l.lineTotal, 0));
  const gstTotal = round2(
    normalized.reduce((s, l) => s + (l.invoiceQty * l.unitPrice * (l.gstRate ?? 0)) / 100, 0),
  );
  const f = Number(freight) || 0;
  return { subtotal, gstTotal, freight: round2(f), grandTotal: round2(subtotal + gstTotal + f) };
}

/**
 * Quantity/price differences vs the GRN received quantity and the PO unit
 * price — surfaced in the UI and echoed on the invoice for the checker.
 */
export function computeDifferences(lines: PurchaseInvoiceLine[]) {
  const diffs: Array<{
    productId: string;
    name: string;
    type: "qty" | "price";
    invoiceValue: number;
    referenceValue: number;
  }> = [];
  for (const l of computeLineTotals(lines)) {
    const qty = l.invoiceQty;
    const grn = l.grnReceivedQty;
    if (grn > 0 && Math.abs(qty - grn) > 1e-9) {
      diffs.push({ productId: l.productId, name: l.name, type: "qty", invoiceValue: qty, referenceValue: grn });
    }
    const price = l.unitPrice;
    const poPrice = Number(l.poUnitPrice);
    if (Number.isFinite(poPrice) && poPrice >= 0 && Math.abs(price - poPrice) > 1e-9) {
      diffs.push({ productId: l.productId, name: l.name, type: "price", invoiceValue: price, referenceValue: poPrice });
    }
  }
  return diffs;
}

export async function list(clientId?: string) {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, { entityType: "PurchaseInvoice", limit: 500, reverse: true });
    return items as PurchaseInvoice[];
  }
  return db.scanByType("PurchaseInvoice", { limit: 2000 }) as Promise<PurchaseInvoice[]>;
}

export async function get(id: string) { return db.getItem(`PURCHASE_INVOICE#${id}`) as Promise<PurchaseInvoice | null>; }

export async function create(data: Partial<PurchaseInvoice> & { clientId: string; vendorId: string; invoiceNumber: string }) {
  const id = uuid(); const now = db.nowISO();
  const lines = computeLineTotals((data.lines ?? []) as PurchaseInvoiceLine[]);
  const totals = computeTotals(lines, data.freight ?? 0);
  const grandTotal = totals.grandTotal;
  // Advances already paid to the supplier against the linked proforma reduce
  // the net payable — the `amount` the funding pipeline reads.
  const advanceDeducted = Math.min(grandTotal, Math.max(0, round2(Number(data.advanceDeducted) || 0)));
  const amount = round2(Math.max(0, grandTotal - advanceDeducted));
  const amountPaid = Number(data.amountPaid) || 0;
  const item: PurchaseInvoice = {
    pk: `PURCHASE_INVOICE#${id}`, sk: `PURCHASE_INVOICE#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`, gsi1sk: `PurchaseInvoice#${now}`,
    entityType: "PurchaseInvoice", id, clientId: data.clientId, vendorId: data.vendorId,
    supplierName: data.supplierName || null,
    invoiceNumber: data.invoiceNumber,
    amount,
    poNumber: data.poNumber || null, poDate: data.poDate || null, poAmount: data.poAmount || null,
    issueDate: data.issueDate || db.todayDate(), receivedDate: data.receivedDate || null,
    dueDate: data.dueDate || null, expectedDate: data.expectedDate || data.dueDate || null, paidDate: null,
    status: data.status && PI_STATUSES.includes(data.status as any) ? data.status : "draft",
    notes: data.notes || null,
    goodsPurchaseOrderId: data.goodsPurchaseOrderId || null,
    goodsPoNumber: data.goodsPoNumber || null,
    linkedSupplierProformaId: data.linkedSupplierProformaId || null,
    linkedSupplierProformaNumber: data.linkedSupplierProformaNumber || null,
    linkedGoodsReceiptId: data.linkedGoodsReceiptId || null,
    linkedGoodsReceiptNumber: data.linkedGoodsReceiptNumber || null,
    lines,
    ...totals,
    advanceDeducted,
    amountPaid,
    balanceDue: round2(Math.max(0, amount - amountPaid)),
    differenceNotes: data.differenceNotes || null,
    lastOverdueReminderDate: null,
    advanceRate: data.advanceRate ?? 0.80, advancePaidDate: null,
    fundedDate: null, purchaseOrderId: data.purchaseOrderId || null,
    documents: data.documents || [], createdAt: now, updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<PurchaseInvoice>) {
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  const allowed = [
    "amount", "status", "paidDate", "dueDate", "expectedDate", "issueDate", "receivedDate",
    "invoiceNumber", "vendorId", "supplierName", "poNumber", "poDate", "poAmount",
    "notes", "advanceRate", "advancePaidDate", "fundedDate", "purchaseOrderId",
    "documents", "lastOverdueReminderDate",
    "goodsPurchaseOrderId", "goodsPoNumber",
    "linkedGoodsReceiptId", "linkedGoodsReceiptNumber",
    "lines", "subtotal", "gstTotal", "freight", "grandTotal",
    "amountPaid", "balanceDue", "differenceNotes",
    "linkedSupplierProformaId", "linkedSupplierProformaNumber", "advanceDeducted",
  ];
  for (const k of allowed) { if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k]; }

  const needsTotals =
    updates.lines !== undefined ||
    updates.freight !== undefined ||
    updates.advanceDeducted !== undefined ||
    updates.linkedSupplierProformaId !== undefined;
  const needsPayment = updates.amountPaid !== undefined || updates.amount !== undefined;
  const current = needsTotals || needsPayment ? await get(id) : null;

  // Recompute line totals + document totals whenever lines/freight change.
  if (needsTotals) {
    const lines = computeLineTotals(
      updates.lines !== undefined
        ? (updates.lines as PurchaseInvoiceLine[])
        : ((current?.lines ?? []) as PurchaseInvoiceLine[]),
    );
    patch.lines = lines;
    const freight =
      updates.freight !== undefined ? Number(updates.freight) || 0 : current?.freight ?? 0;
    Object.assign(patch, computeTotals(lines, freight));
    // Recompute the advance deduction and keep the payable `amount` in sync
    // with the NET total (grand total − advances) UNLESS a manual adjustment
    // exists (e.g. a credit/debit note reduced the payable). Otherwise the
    // GRN sync (which rewrites lines to back-fill received quantities) would
    // silently wipe note adjustments.
    const grand = Number(patch.grandTotal) || 0;
    const advance = Math.min(
      grand,
      Math.max(0, round2(Number(updates.advanceDeducted ?? current?.advanceDeducted ?? 0))),
    );
    patch.advanceDeducted = round2(advance);
    const expectedNet = round2(Math.max(0, grand - advance));
    if (updates.amount === undefined && current) {
      const prevGrand = Number(current.grandTotal) || 0;
      const prevAdvance = Math.max(0, Number(current.advanceDeducted) || 0);
      const prevExpected = round2(Math.max(0, prevGrand - prevAdvance));
      const storedAmount = Number(current.amount) || 0;
      patch.amount =
        prevExpected > 0 && Math.abs(storedAmount - prevExpected) > 1e-9
          ? storedAmount
          : expectedNet;
    } else if (updates.amount === undefined) {
      patch.amount = expectedNet;
    }
  }

  // Payment tracking: amountPaid drives the balance and (when no explicit
  // status was supplied) the Partially Paid / Paid status.
  if (needsPayment) {
    const grandTotal = Number(patch.grandTotal ?? current?.grandTotal) || 0;
    const payable =
      updates.amount !== undefined
        ? Number(updates.amount) || 0
        : Number(patch.amount ?? current?.amount) || grandTotal;
    const paid =
      updates.amountPaid !== undefined
        ? Number(updates.amountPaid) || 0
        : Number(current?.amountPaid) || 0;
    if (updates.amount !== undefined) patch.amount = payable;
    if (updates.amountPaid !== undefined) patch.amountPaid = paid;
    patch.balanceDue = round2(Math.max(0, payable - paid));
    if (updates.amountPaid !== undefined && updates.status === undefined) {
      if (payable > 0 && paid >= payable - 1e-9) {
        patch.status = "paid";
        if (!patch.paidDate) patch.paidDate = db.todayDate();
      } else if (paid > 0) {
        patch.status = "partially_paid";
      } else if (current?.status === "paid" || current?.status === "partially_paid") {
        // Payment fully reversed — send the invoice back to the funding queue.
        patch.status = "approved_for_payment";
        patch.paidDate = null;
      }
    }
  }

  return db.updateItem(`PURCHASE_INVOICE#${id}`, `PURCHASE_INVOICE#${id}`, patch);
}

export async function remove(id: string) { return db.deleteItem(`PURCHASE_INVOICE#${id}`); }
