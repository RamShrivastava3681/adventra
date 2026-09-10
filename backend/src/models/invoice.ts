import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";
import { PaymentTermsType, normalizePaymentTermsType, normalizeAdvancePct } from "../lib/payment-terms.js";

/** A catalogue-backed line on a sales invoice (mirrors the SO line shape). */
export interface InvoiceLine {
  productId: string;
  sku: string | null;
  name: string;
  /** Unit of measure from the catalogue (piece, pair, carton…). */
  unit: string;
  /** Quantity billed — normally the same as the sales order. */
  quantity: number;
  /** Unit selling price agreed with the customer. */
  unitPrice: number;
  /** Discount percentage (0–100), optional — GST applies to the discounted value. */
  discountPct: number | null;
  /** GST rate as a percentage (0–99), from the catalogue or overridden. */
  gstRate: number | null;
  /** HSN/SAC code snapshot from the catalogue (printed on Tally-format invoices). */
  hsnCode: string | null;
  /**
   * Tax-inclusive unit rate printed as "Rate (Incl. of Tax)" on Tally-format
   * invoices. Defaults to unitPrice × (1 + gstRate/100); editable per line so
   * the print always matches the Tally books.
   */
  rateInclTax: number | null;
  /** System-calculated: quantity × unitPrice × (1 − discountPct/100). */
  lineTotal: number;
}

export interface Invoice {
  pk: string; sk: string; gsi1pk: string; gsi1sk: string; gsi2pk: string; gsi2sk: string;
  entityType: "Invoice";
  id: string; clientId: string; debtorId: string;
  invoiceNumber: string; amount: number;
  issueDate: string; dueDate: string; expectedDate?: string | null;
  promisedPaymentDate?: string | null;
  expectedDispatchDate?: string | null;
  status: string;
  advanceRate: number; feeRate: number;
  paidDate: string | null; amountReceived: number | null; receiptDate: string | null;
  shortPayment: number | null; lateDays: number | null;
  poNumber: string | null; poDate: string | null; poAmount: number | null;
  purchaseInvoiceId: string | null; purchaseOrderId: string | null;
  supplierId: string | null;
  lineItems: any[];
  subtotal: number | null; taxRate: number; taxAmount: number;
  notes: string | null; documents: any[];
  noaStatus: string; noaToken: string | null; noaSentAt: string | null;
  noaRespondedAt: string | null; noaComments: string | null;
  /** UTR / payment reference captured by the checker at approval time. */
  utr_reference: string | null;
  /** Payment amount captured by the checker at approval time (optional). */
  payment_amount: number | null;
  // ── Manual e-invoice fields (PDF §7, Tally-format print; v1 = manual entry,
  // later written by the Tally integration with irnSource = "tally"). ──
  /** 64-char Invoice Reference Number pasted from Tally / IRP. */
  irn: string | null;
  /** Acknowledgement number returned with the IRN. */
  ackNo: string | null;
  /** Acknowledgement date (YYYY-MM-DD) returned with the IRN. */
  ackDate: string | null;
  /** Where the IRN came from: manual paste (v1) or tally integration. */
  irnSource: "manual" | "tally" | null;
  /** Who recorded the IRN (user id/email). */
  irnEnteredBy: string | null;
  /** When the IRN was recorded (ISO timestamp). */
  irnEnteredAt: string | null;
  /** Signed e-invoice QR payload (base64/text) for the print QR code. */
  signedQr: string | null;
  /** E-Way Bill number (manual paste in v1; NIC service later). */
  ewbNumber: string | null;
  /** E-Way Bill date (YYYY-MM-DD). */
  ewbDate: string | null;
  /** EWB generation + validity timestamps (manual paste or service). */
  ewbGeneratedAt: string | null;
  ewbValidUntil: string | null;
  // ── Tally integration fields (PDF-2 §7; v1 manual, later automatic). ──
  /** Tally voucher reference for this invoice. */
  tallyVoucherRef: string | null;
  /** Final invoice number issued by Tally (e.g. ADV/2026-27/754). */
  tallyInvoiceNumber: string | null;
  /** Transporter / vehicle / LR saved against the invoice per spec. */
  transporter: string | null;
  vehicleNumber: string | null;
  lrRef: string | null;
  /** Place of supply (state name) printed on the invoice. */
  placeOfSupply: string | null;
  /** Consignee (ship-to) snapshot — prefilled from debtor, editable per invoice. */
  consigneeName: string | null;
  consigneeAddress: string | null;
  consigneeGstin: string | null;
  consigneePan: string | null;
  consigneeState: string | null;
  consigneeStateCode: string | null;
  /** Buyer (bill-to) GST snapshot — prefilled from debtor, editable per invoice. */
  buyerGstin: string | null;
  buyerPan: string | null;
  buyerState: string | null;
  buyerStateCode: string | null;
  /** Tally header-grid references (all optional, blank renders blank). */
  deliveryNoteRef: string | null;
  deliveryNoteDate: string | null;
  otherReferences: string | null;
  buyerOrderDate: string | null;
  dispatchDocNumber: string | null;
  destination: string | null;
  termsOfDelivery: string | null;
  source: string;
  /** Tracks the last date an overdue reminder email was sent (YYYY-MM-DD). Used by the daily reminder cron. */
  lastOverdueReminderDate: string | null;
  /** Secure token for one-click debtor reminder forwarding from the admin email. */
  debtorReminderToken: string | null;
  // ── Goods-invoice fields (catalogue-backed) ──
  /** Customer contact person — auto-filled from the debtor master, editable. */
  customerContact: string | null;
  billingAddress: string | null;
  deliveryAddress: string | null;
  /** Linked goods Sales Order this invoice bills against (optional). */
  goodsSalesOrderId: string | null;
  goodsSalesOrderNumber: string | null;
  paymentTerms: string | null;
  /** Structured payment terms: credit (Net N), advance_full (100% advance),
   *  advance_partial (X% advance + remainder on delivery) or on_delivery. */
  paymentTermsType: PaymentTermsType | null;
  /** Advance percentage for advance_partial terms (1–99). */
  advancePct: number | null;
  /** Catalogue product lines (SKUs must come from the catalogue). */
  lines: InvoiceLine[];
  /** System-calculated: sum of discounted line totals. */
  subtotalGoods: number;
  /** System-calculated: sum of (gross − discounted) per line. */
  totalDiscount: number;
  /** System-calculated: GST on the discounted line values. */
  gstTotal: number;
  /** Freight / other charges — optional. */
  freight: number;
  /** System-calculated: subtotalGoods + gstTotal + freight (the document total). */
  grandTotal: number;
  /** Linked customer proforma invoice (sales side) — optional. */
  linkedCustomerProformaId: string | null;
  linkedCustomerProformaNumber: string | null;
  /**
   * System-calculated: advances received against the linked proforma that are
   * deducted from the document total. The invoice `amount` (what the customer
   * actually owes) is grandTotal − advanceDeducted, never negative.
   */
  advanceDeducted: number;
  createdAt: string; updatedAt: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Gross value before discount for a line: quantity × unitPrice. */
function grossValue(l: Pick<InvoiceLine, "quantity" | "unitPrice">): number {
  return (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0);
}

/** Discounted value a line bills for: gross × (1 − discountPct/100). */
function netValue(l: Pick<InvoiceLine, "quantity" | "unitPrice" | "discountPct">): number {
  const g = grossValue(l);
  const disc = Math.min(100, Math.max(0, Number(l.discountPct) || 0));
  return g * (1 - disc / 100);
}

function computeLineTotals(lines: InvoiceLine[]): InvoiceLine[] {
  return lines.map((l) => {
    const quantity = Number(l.quantity) || 0;
    const unitPrice = Number(l.unitPrice) || 0;
    const discountPct =
      l.discountPct === undefined || l.discountPct === null
        ? null
        : Math.min(100, Math.max(0, Number(l.discountPct) || 0));
    const gstRate =
      l.gstRate === undefined || l.gstRate === null ? null : Number(l.gstRate);
    // Tax-inclusive rate for the Tally print; defaults from base + GST so
    // legacy lines without the field still print a sane value.
    const rateInclTax =
      l.rateInclTax === undefined || l.rateInclTax === null
        ? round2(unitPrice * (1 + (gstRate ?? 0) / 100))
        : round2(Number(l.rateInclTax) || 0);
    return {
      ...l,
      quantity,
      unitPrice,
      discountPct,
      gstRate,
      hsnCode:
        typeof l.hsnCode === "string" && l.hsnCode.trim() ? l.hsnCode.trim() : null,
      rateInclTax,
      lineTotal: round2(quantity * unitPrice * (1 - (discountPct ?? 0) / 100)),
    };
  });
}

export function computeTotals(lines: InvoiceLine[], freight: number) {
  const normalized = computeLineTotals(lines);
  const subtotalGoods = round2(normalized.reduce((s, l) => s + l.lineTotal, 0));
  const totalDiscount = round2(normalized.reduce((s, l) => s + (grossValue(l) - netValue(l)), 0));
  const gstTotal = round2(
    normalized.reduce((s, l) => s + (netValue(l) * (l.gstRate ?? 0)) / 100, 0),
  );
  const f = Number(freight) || 0;
  return {
    subtotalGoods,
    totalDiscount,
    gstTotal,
    freight: round2(f),
    grandTotal: round2(subtotalGoods + gstTotal + f),
  };
}

/**
 * What the debtor actually owes: the stored `amount` (net of advance deduction)
 * when present, otherwise grand total − advanceDeducted. Clamped to ≥ 0.
 */
export function netReceivable(
  inv: Pick<Invoice, "amount" | "grandTotal" | "advanceDeducted">,
): number {
  const stored = Number(inv.amount);
  if (Number.isFinite(stored) && stored >= 0) return round2(stored);
  const grand = Number(inv.grandTotal) || 0;
  const adv = Math.max(0, Number(inv.advanceDeducted) || 0);
  return round2(Math.max(0, grand - adv));
}

/** Balance still owed by the debtor: net receivable − amount received (≥ 0). */
export function balanceOutstanding(
  inv: Pick<Invoice, "amount" | "grandTotal" | "advanceDeducted" | "amountReceived">,
): number {
  return Math.max(0, round2(netReceivable(inv) - (Number(inv.amountReceived) || 0)));
}

/** Derive the payment status from the amount received vs the net receivable. */
export function paymentStatus(
  inv: Pick<Invoice, "amount" | "grandTotal" | "advanceDeducted" | "amountReceived" | "status">,
): string {
  const balance = balanceOutstanding(inv);
  if (balance <= 0.005) return "paid";
  if ((Number(inv.amountReceived) || 0) > 0) return "partially_paid";
  return inv.status;
}

export async function list(clientId?: string) {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, { entityType: "Invoice", limit: 500, reverse: true });
    return items as Invoice[];
  }
  return db.scanByType("Invoice", { limit: 2000 }) as Promise<Invoice[]>;
}

export async function get(id: string) { return db.getItem(`INVOICE#${id}`) as Promise<Invoice | null>; }

export async function create(data: Partial<Invoice> & { clientId: string; debtorId: string; invoiceNumber: string; amount: number; dueDate: string }) {
  const id = uuid(); const now = db.nowISO();
  const lines = computeLineTotals((data.lines ?? []) as InvoiceLine[]);
  const totals = computeTotals(lines, data.freight ?? 0);
  // The document total (lines + GST + freight) is what prints on the invoice.
  const grandTotal = totals.grandTotal || Number(data.amount) || 0;
  // Advances received against the linked proforma reduce what the customer owes.
  const advanceDeducted = Math.min(grandTotal, Math.max(0, round2(Number(data.advanceDeducted) || 0)));
  // `amount` is the NET receivable (funding pipeline reads it — we never fund
  // the portion the customer already paid as an advance).
  const amount = round2(Math.max(0, grandTotal - advanceDeducted));
  const item: Invoice = {
    pk: `INVOICE#${id}`, sk: `INVOICE#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`, gsi1sk: `Invoice#${now}`,
    gsi2pk: "Invoice", gsi2sk: `Invoice#${data.invoiceNumber}`,
    entityType: "Invoice", id,
    clientId: data.clientId, debtorId: data.debtorId,
    invoiceNumber: data.invoiceNumber, amount,
    issueDate: data.issueDate || db.todayDate(), dueDate: data.dueDate, expectedDate: data.expectedDate || data.dueDate || null,
    expectedDispatchDate: data.expectedDispatchDate || null,
    status: data.status || "draft",
    advanceRate: data.advanceRate ?? 0.80, feeRate: data.feeRate ?? 0.025,
    paidDate: null, amountReceived: null, receiptDate: null,
    shortPayment: null, lateDays: null,
    poNumber: data.poNumber || null, poDate: data.poDate || null, poAmount: data.poAmount || null,
    purchaseInvoiceId: data.purchaseInvoiceId || null, purchaseOrderId: data.purchaseOrderId || null,
    supplierId: data.supplierId || null,
    lineItems: data.lineItems || [],
    subtotal: data.subtotal ?? (totals.subtotalGoods || null), taxRate: data.taxRate || 0, taxAmount: data.taxAmount || 0,
    notes: data.notes || null, documents: data.documents || [],
    lastOverdueReminderDate: null,
    debtorReminderToken: uuid(),
    noaStatus: "not_sent", noaToken: uuid(), noaSentAt: null,
    noaRespondedAt: null, noaComments: null,
    utr_reference: null, payment_amount: null,
    source: data.source || "manual",
    customerContact: data.customerContact || null,
    billingAddress: data.billingAddress || null,
    deliveryAddress: data.deliveryAddress || null,
    irn: data.irn || null,
    ackNo: data.ackNo || null,
    ackDate: data.ackDate || null,
    irnSource: (data.irnSource as any) || null,
    irnEnteredBy: data.irnEnteredBy || null,
    irnEnteredAt: data.irnEnteredAt || null,
    signedQr: data.signedQr || null,
    ewbNumber: data.ewbNumber || null,
    ewbDate: data.ewbDate || null,
    ewbGeneratedAt: data.ewbGeneratedAt || null,
    ewbValidUntil: data.ewbValidUntil || null,
    tallyVoucherRef: data.tallyVoucherRef || null,
    tallyInvoiceNumber: data.tallyInvoiceNumber || null,
    transporter: data.transporter || null,
    vehicleNumber: data.vehicleNumber || null,
    lrRef: data.lrRef || null,
    placeOfSupply: data.placeOfSupply || null,
    consigneeName: data.consigneeName || null,
    consigneeAddress: data.consigneeAddress || null,
    consigneeGstin: data.consigneeGstin || null,
    consigneePan: data.consigneePan || null,
    consigneeState: data.consigneeState || null,
    consigneeStateCode: data.consigneeStateCode || null,
    buyerGstin: data.buyerGstin || null,
    buyerPan: data.buyerPan || null,
    buyerState: data.buyerState || null,
    buyerStateCode: data.buyerStateCode || null,
    deliveryNoteRef: data.deliveryNoteRef || null,
    deliveryNoteDate: data.deliveryNoteDate || null,
    otherReferences: data.otherReferences || null,
    buyerOrderDate: data.buyerOrderDate || null,
    dispatchDocNumber: data.dispatchDocNumber || null,
    destination: data.destination || null,
    termsOfDelivery: data.termsOfDelivery || null,
    goodsSalesOrderId: data.goodsSalesOrderId || null,
    goodsSalesOrderNumber: data.goodsSalesOrderNumber || null,
    paymentTerms: data.paymentTerms || null,
    paymentTermsType: normalizePaymentTermsType(data.paymentTermsType),
    advancePct: normalizeAdvancePct(data.advancePct),
    linkedCustomerProformaId: data.linkedCustomerProformaId || null,
    linkedCustomerProformaNumber: data.linkedCustomerProformaNumber || null,
    lines,
    ...totals,
    advanceDeducted,
    createdAt: now, updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<Invoice>) {
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  const allowed = ["amount","status","paidDate","amountReceived","receiptDate","shortPayment","lateDays","advanceRate","feeRate","poNumber","poDate","poAmount","purchaseInvoiceId","purchaseOrderId","supplierId","lineItems","subtotal","taxRate","taxAmount","notes","documents","noaStatus","noaSentAt","noaRespondedAt","noaComments","issueDate","dueDate","expectedDate","invoiceNumber","debtorId",      "lastOverdueReminderDate","debtorReminderToken","customerContact","billingAddress","deliveryAddress","goodsSalesOrderId","goodsSalesOrderNumber","paymentTerms","paymentTermsType","advancePct","lines","subtotalGoods","totalDiscount","gstTotal","freight","grandTotal","linkedCustomerProformaId","linkedCustomerProformaNumber","advanceDeducted","expectedDispatchDate","utr_reference","payment_amount",
  // Manual e-invoice fields (IRN set via the dedicated endpoint; the rest editable pre-IRN).
  "ackNo","ackDate","irnSource","irnEnteredBy","irnEnteredAt","signedQr","ewbNumber","ewbDate","placeOfSupply","consigneeName","consigneeAddress","consigneeGstin","consigneePan","consigneeState","consigneeStateCode","buyerGstin","buyerPan","buyerState","buyerStateCode","deliveryNoteRef","deliveryNoteDate","otherReferences","buyerOrderDate","dispatchDocNumber","destination","termsOfDelivery",
  "ewbGeneratedAt","ewbValidUntil","tallyVoucherRef","tallyInvoiceNumber","transporter","vehicleNumber","lrRef"]; /* "irn" intentionally excluded — written only by recordIrn/clearIrn */
  for (const k of allowed) { if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k]; }
  // Recompute line totals + document totals whenever lines/freight/advance change.
  if (
    updates.lines !== undefined ||
    updates.freight !== undefined ||
    updates.advanceDeducted !== undefined ||
    updates.linkedCustomerProformaId !== undefined
  ) {
    const current = await get(id);
    const lines = computeLineTotals(
      updates.lines !== undefined ? (updates.lines as InvoiceLine[]) : ((current?.lines ?? []) as InvoiceLine[]),
    );
    patch.lines = lines;
    const freight = updates.freight !== undefined ? Number(updates.freight) || 0 : current?.freight ?? 0;
    const totals = computeTotals(lines, freight);
    Object.assign(patch, totals);
    // `amount` = net receivable: grand total − advance deducted (never negative).
    const grandTotal = totals.grandTotal || Number(current?.grandTotal) || 0;
    const advance = Math.min(grandTotal, Math.max(0, round2(Number(updates.advanceDeducted ?? current?.advanceDeducted ?? 0))));
    patch.advanceDeducted = round2(advance);
    patch.amount = round2(Math.max(0, grandTotal - advance));
  }
  return db.updateItem(`INVOICE#${id}`, `INVOICE#${id}`, patch);
}

/**
 * Record a customer payment on the invoice. Accumulates amountReceived and
 * derives the status: full balance → paid, partial → partially_paid.
 */
export async function recordPayment(id: string, amountReceived: number, receiptDate: string) {
  const current = await get(id);
  if (!current) throw new Error("Invoice not found");
  if (current.status === "cancelled") throw new Error("Cannot record a payment on a cancelled invoice");
  const amt = Number(amountReceived) || 0;
  if (amt <= 0) throw new Error("Payment amount must be greater than zero");
  const prior = Number(current.amountReceived) || 0;
  // Clamp to the net receivable so the stored received amount never exceeds it.
  const received = round2(Math.min(prior + amt, netReceivable(current)));
  const status = paymentStatus({ ...current, amountReceived: received });
  const patch: Partial<Invoice> = {
    amountReceived: received,
    receiptDate,
    status,
  };
  if (status === "paid") patch.paidDate = new Date().toISOString();
  if (status === "paid" && current.dueDate) {
    patch.lateDays = Math.max(0, Math.round((Date.now() - new Date(current.dueDate).getTime()) / 86_400_000));
  }
  return update(id, patch);
}

export async function remove(id: string) { return db.deleteItem(`INVOICE#${id}`); }

/** IRN must be the 64-char hex string issued by the IRP (dashes stripped). */
export function normalizeIrn(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/-/g, "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(s)) return null;
  return s;
}

/**
 * Record a manually-entered IRN from Tally on an approved invoice.
 * Allowed only before the invoice is paid/cancelled/dispatched-frozen:
 * once `irn` is set, content edits are frozen by the route layer.
 */
export async function recordIrn(
  id: string,
  data: { irn: string; ackNo?: string | null; ackDate?: string | null; enteredBy: string; source?: "manual" | "tally" },
): Promise<Invoice> {
  const current = await get(id);
  if (!current) throw new Error("Invoice not found");
  if (current.irn) throw new Error("IRN is already recorded — clear it first to correct");
  if (["paid", "cancelled", "rejected"].includes(current.status))
    throw new Error(`Cannot record IRN on a ${current.status} invoice`);
  const irn = normalizeIrn(data.irn);
  if (!irn) throw new Error("IRN must be the 64-character hex string from Tally");
  const ackNo =
    data.ackNo !== undefined && data.ackNo !== null && String(data.ackNo).trim()
      ? String(data.ackNo).trim()
      : null;
  if (ackNo && !/^\d{9,20}$/.test(ackNo))
    throw new Error("Ack No. must be the numeric acknowledgement number from Tally");
  const ackDate =
    data.ackDate !== undefined && data.ackDate !== null && String(data.ackDate).trim()
      ? String(data.ackDate).slice(0, 10)
      : null;
  if (ackDate && !/^\d{4}-\d{2}-\d{2}$/.test(ackDate))
    throw new Error("Ack Date must be YYYY-MM-DD");
  const patch: Record<string, any> = {
    irn,
    ackNo,
    ackDate,
    irnSource: data.source || "manual",
    irnEnteredBy: data.enteredBy,
    irnEnteredAt: db.nowISO(),
    updatedAt: db.nowISO(),
  };
  // Advance the workflow past IRN pending when the invoice is approved.
  if (current.status === "approved") patch.status = "approved";
  return db.updateItem(`INVOICE#${id}`, `INVOICE#${id}`, patch) as Promise<Invoice>;
}

/**
 * Clear a manually-entered IRN (same-day correction only — the route layer
 * blocks this once dispatch/ewb activity exists on the invoice).
 */
export async function clearIrn(id: string, reason: string): Promise<Invoice> {
  const current = await get(id);
  if (!current) throw new Error("Invoice not found");
  if (!current.irn) throw new Error("No IRN recorded on this invoice");
  if (!reason || !reason.trim()) throw new Error("A reason is required to clear the IRN");
  if (["paid", "cancelled"].includes(current.status))
    throw new Error(`Cannot clear IRN on a ${current.status} invoice`);
  return db.updateItem(`INVOICE#${id}`, `INVOICE#${id}`, {
    irn: null,
    ackNo: null,
    ackDate: null,
    irnSource: null,
    irnEnteredBy: null,
    irnEnteredAt: null,
    updatedAt: db.nowISO(),
  }) as Promise<Invoice>;
}

export async function getByNOAToken(token: string) {
  const items = await db.scanByType("Invoice");
  return items.find((i: any) => i.noaToken === token) as Invoice | undefined;
}
