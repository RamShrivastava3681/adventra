export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function gstRateOf(rate: number | string | null | undefined): number {
  const r = Number(rate);
  if (!Number.isFinite(r) || r < 0) return 0;
  return Math.min(100, r);
}

export interface GstSplit {
  /** Amount excluding GST — the taxable value. */
  taxableValue: number;
  /** GST already contained in the amount (never added on top). */
  gstAmount: number;
  /** The GST-inclusive amount itself. */
  total: number;
}

/**
 * Split a GST-inclusive amount into taxable value + GST.
 * Catalogue prices already include GST, so `splitGstInclusive(118, 18)` is
 * `{ taxableValue: 100, gstAmount: 18, total: 118 }`.
 */
export function splitGstInclusive(
  inclusiveAmount: number,
  gstRate: number | string | null | undefined,
): GstSplit {
  const total = round2(inclusiveAmount);
  const rate = gstRateOf(gstRate);
  if (rate <= 0) return { taxableValue: total, gstAmount: 0, total };
  const taxableValue = round2(total / (1 + rate / 100));
  return { taxableValue, gstAmount: round2(total - taxableValue), total };
}

/** Per-piece value without GST, e.g. `exGstPrice(118, 18)` → 100. */
export function exGstPrice(
  inclusivePrice: number,
  gstRate: number | string | null | undefined,
): number {
  return splitGstInclusive(inclusivePrice, gstRate).taxableValue;
}

/** Document totals for GST-inclusive lines: the total is the amount as entered. */
export function inclusiveTotals(
  lines: Array<{ amount: number; gstRate?: number | string | null }>,
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
