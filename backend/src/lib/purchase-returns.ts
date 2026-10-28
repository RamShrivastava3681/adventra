/**
 * Purchase-return maths — kept pure so the quantity rules and credit
 * allocation can be unit-tested without DynamoDB.
 *
 * A purchase return can never exceed the invoice line's unreturned quantity,
 * and a supplier debit note can never be applied beyond its remaining value or
 * the invoice's outstanding balance.
 */

import { exGstPrice, inclusiveTotals, splitGstInclusive } from "./gst.js";

export interface InvoiceLineLike {
  productId: string;
  sku: string | null;
  name: string;
  unit?: string | null;
  invoiceQty: number;
  unitPrice: number;
  gstRate?: number | null;
}

export interface ReturnLineInput {
  productId: string;
  returnQty: number;
}

export interface ComputedReturnLine {
  productId: string;
  sku: string | null;
  name: string;
  unit: string;
  invoiceQty: number;
  previouslyReturnedQty: number;
  eligibleQty: number;
  returnQty: number;
  /** Invoice unit price — GST-inclusive, as entered. */
  unitPrice: number;
  /** Per-unit value without GST (unitPrice ÷ (1 + rate)). */
  unitPriceExGst: number;
  gstRate: number | null;
  /** Returned amount as billed (qty × GST-inclusive unitPrice). */
  lineTotal: number;
  /** Taxable part of lineTotal. */
  taxableValue: number;
  /** GST contained in lineTotal. */
  gstAmount: number;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Unreturned quantity available on an invoice line (never negative). */
export function computeEligibleQty(invoiceQty: number, previouslyReturnedQty: number): number {
  return Math.max(0, (Number(invoiceQty) || 0) - (Number(previouslyReturnedQty) || 0));
}

/**
 * Validate and normalise the requested return quantities against the invoice.
 * Throws a user-facing error on unknown products, non-positive quantities, or
 * quantities above the eligible amount.
 */
export function normalizeReturnLines(
  invoiceLines: InvoiceLineLike[],
  requested: ReturnLineInput[],
  previouslyReturnedByProduct: Record<string, number> = {},
): ComputedReturnLine[] {
  if (!Array.isArray(requested) || requested.length === 0) {
    throw new Error("Select at least one product to return");
  }
  const byProduct = new Map<string, number>();
  for (const row of requested) {
    const productId = String(row?.productId ?? "").trim();
    const qty = Number(row?.returnQty);
    if (!productId) throw new Error("A return line is missing its product");
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error("Return quantity must be greater than zero");
    }
    byProduct.set(productId, (byProduct.get(productId) ?? 0) + qty);
  }

  const invoiceByProduct = new Map(invoiceLines.map((l) => [l.productId, l]));
  const out: ComputedReturnLine[] = [];
  for (const [productId, qty] of byProduct) {
    const line = invoiceByProduct.get(productId);
    if (!line) {
      throw new Error("A return line does not belong to this purchase invoice");
    }
    const previouslyReturnedQty = Number(previouslyReturnedByProduct[productId]) || 0;
    const eligibleQty = computeEligibleQty(line.invoiceQty, previouslyReturnedQty);
    if (qty > eligibleQty + 1e-9) {
      throw new Error(
        `${line.name}: cannot return ${qty} — only ${eligibleQty} unreturned unit(s) remain on the invoice`,
      );
    }
    const unitPrice = Number(line.unitPrice) || 0;
    const gstRate =
      line.gstRate != null && Number.isFinite(Number(line.gstRate))
        ? Number(line.gstRate)
        : null;
    const lineTotal = round2(qty * unitPrice);
    const split = splitGstInclusive(lineTotal, gstRate);
    out.push({
      productId,
      sku: line.sku ?? null,
      name: line.name,
      unit: line.unit || "unit",
      invoiceQty: Number(line.invoiceQty) || 0,
      previouslyReturnedQty,
      eligibleQty,
      returnQty: round2(qty),
      unitPrice,
      unitPriceExGst: exGstPrice(unitPrice, gstRate),
      gstRate,
      lineTotal,
      taxableValue: split.taxableValue,
      gstAmount: split.gstAmount,
    });
  }
  return out;
}

/**
 * Subtotal / GST / total for a validated return. Invoice prices are
 * GST-inclusive, so the debit note total is the returned amount as billed and
 * subtotal/GST are the split inside it.
 */
export function computeReturnTotals(lines: ComputedReturnLine[]) {
  const totals = inclusiveTotals(
    lines.map((l) => ({ amount: l.lineTotal, gstRate: l.gstRate })),
    0,
  );
  return {
    subtotal: totals.subtotal,
    gstTotal: totals.gstTotal,
    totalAmount: totals.grandTotal,
  };
}

/**
 * How much of a debit note can be applied to an invoice.
 * `requestedAmount` undefined means "apply as much as possible".
 * Returns 0 when there is nothing to apply.
 */
export function computeCreditApplication(params: {
  noteRemaining: number;
  invoiceOutstanding: number;
  requestedAmount?: number | null;
}): number {
  const remaining = Math.max(0, Number(params.noteRemaining) || 0);
  const outstanding = Math.max(0, Number(params.invoiceOutstanding) || 0);
  const cap = round2(Math.min(remaining, outstanding));
  if (cap <= 0) return 0;
  if (params.requestedAmount === undefined || params.requestedAmount === null || params.requestedAmount === ("" as any)) {
    return cap;
  }
  const requested = Number(params.requestedAmount);
  if (!Number.isFinite(requested) || requested <= 0) {
    throw new Error("Credit amount must be greater than zero");
  }
  if (requested > cap + 1e-9) {
    throw new Error(
      `Cannot apply ${requested} — at most ${cap} is available (note remaining ${remaining}, invoice outstanding ${outstanding})`,
    );
  }
  return round2(requested);
}

/** Outstanding on a purchase invoice after payments and applied credit. */
export function computeInvoiceOutstanding(invoice: {
  amount: number;
  amountPaid?: number | null;
  creditAdjusted?: number | null;
}): number {
  return round2(
    Math.max(
      0,
      (Number(invoice.amount) || 0) -
        (Number(invoice.amountPaid) || 0) -
        (Number(invoice.creditAdjusted) || 0),
    ),
  );
}

/** Remaining (unapplied) value of a supplier debit note. */
export function computeNoteRemaining(note: {
  amount: number;
  appliedAmount?: number | null;
}): number {
  return round2(
    Math.max(0, (Number(note.amount) || 0) - (Number(note.appliedAmount) || 0)),
  );
}
