/**
 * GST-inclusive pricing.
 *
 * Catalogue prices (and therefore every order/invoice line price) are entered
 * as the final amount the buyer pays — GST is already inside that number. So a
 * product priced 118 at 18% is 100 taxable + 18 GST, and a 118 line bills 118,
 * not 139.24.
 *
 * Convention used across documents:
 *   unitPrice        → price as entered (GST-inclusive)
 *   lineTotal        → qty × unitPrice (after discount) — the amount billed
 *   subtotal         → Σ taxable value (lineTotal net of the GST inside it)
 *   gstTotal         → Σ GST component (informational, never added again)
 *   grandTotal       → Σ lineTotal + freight
 *
 * grandTotal is therefore always Σ lineTotal + freight, and subtotal + gstTotal
 * + freight lands on exactly the same number.
 */

export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Sanitised GST rate: a finite number in 0…100, otherwise 0. */
export function normalizeGstRate(rate: number | string | null | undefined): number {
  const r = Number(rate);
  if (!Number.isFinite(r) || r < 0) return 0;
  return Math.min(100, r);
}

export interface GstSplit {
  /** Amount excluding GST (what the line is taxed on). */
  taxableValue: number;
  /** GST contained in the amount (not added on top). */
  gstAmount: number;
  /** The GST-inclusive amount itself. */
  total: number;
}

/**
 * Split a GST-inclusive amount into taxable value + GST.
 * `splitGstInclusive(118, 18)` → { taxableValue: 100, gstAmount: 18, total: 118 }
 */
export function splitGstInclusive(
  inclusiveAmount: number,
  gstRate: number | string | null | undefined,
): GstSplit {
  const total = round2(inclusiveAmount);
  const rate = normalizeGstRate(gstRate);
  if (rate <= 0) return { taxableValue: total, gstAmount: 0, total };
  const taxableValue = round2(total / (1 + rate / 100));
  return { taxableValue, gstAmount: round2(total - taxableValue), total };
}

/**
 * Per-piece value without GST for a GST-inclusive price.
 * `exGstPrice(118, 18)` → 100
 */
export function exGstPrice(
  inclusivePrice: number,
  gstRate: number | string | null | undefined,
): number {
  return splitGstInclusive(inclusivePrice, gstRate).taxableValue;
}

export interface InclusiveTotalLine {
  /** Discounted GST-inclusive line amount (qty × price). */
  amount: number;
  gstRate: number | string | null | undefined;
}

/** Document totals for GST-inclusive lines. */
export function inclusiveTotals(
  lines: InclusiveTotalLine[],
  freight = 0,
): { subtotal: number; gstTotal: number; freight: number; grandTotal: number } {
  let subtotal = 0;
  let gstTotal = 0;
  let total = 0;
  for (const l of lines) {
    const split = splitGstInclusive(l.amount, l.gstRate);
    subtotal += split.taxableValue;
    gstTotal += split.gstAmount;
    total += split.total;
  }
  const f = round2(freight);
  return {
    subtotal: round2(subtotal),
    gstTotal: round2(gstTotal),
    freight: f,
    grandTotal: round2(total + f),
  };
}
