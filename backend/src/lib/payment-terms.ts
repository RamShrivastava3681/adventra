/**
 * payment-terms.ts — shared payment-terms model.
 *
 * Four structured payment-term types used across masters (debtors, suppliers,
 * vendors) and documents (sales orders, purchase orders, proformas, invoices):
 *
 *  - advance_full:   100% advance before dispatch/delivery.
 *  - advance_partial: user-entered % advance; the remainder is due on delivery.
 *  - on_delivery:    100% payment on delivery (COD).
 *  - credit:         Net N days (existing paymentTermsDays).
 */

export type PaymentTermsType =
  | "credit"
  | "advance_full"
  | "advance_partial"
  | "on_delivery";

export const PAYMENT_TERMS_TYPES: PaymentTermsType[] = [
  "credit",
  "advance_full",
  "advance_partial",
  "on_delivery",
];

export type DispatchCondition =
  | "no_check"
  | "advance_required"
  | "full_required";

export const DISPATCH_CONDITIONS: DispatchCondition[] = [
  "no_check",
  "advance_required",
  "full_required",
];

export const DISPATCH_CONDITION_LABELS: Record<DispatchCondition, string> = {
  no_check: "No payment required before dispatch",
  advance_required: "Required advance must be received before dispatch",
  full_required: "Full invoice amount must be received before dispatch",
};

/** Due-date basis values. V1 supports only the two known dates below. */
export type DueBasis = "so_confirmation" | "invoice_date";

export interface PaymentTermsFields {
  /** Structured term type. null/undefined = legacy document (free-text only). */
  paymentTermsType: PaymentTermsType | null;
  /** Advance percentage for advance_partial (1–99). */
  advancePct: number | null;
  /** Balance percentage (0–100). Defaults to 100 − advancePct. */
  balancePct: number | null;
  /** Credit days for the balance portion (0 = due on invoice date). */
  balanceDueDays: number | null;
  /** Which date the balance is due from. V1: always "invoice_date". */
  balanceDueBasis: DueBasis | null;
  /** Which date the advance is due from. V1: always "so_confirmation". */
  advanceDueBasis: DueBasis | null;
  /** Dispatch gate for this term. */
  dispatchCondition: DispatchCondition | null;
}

/** Normalize and validate a payment-terms type string. */
export function normalizePaymentTermsType(v: any): PaymentTermsType | null {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v);
  return PAYMENT_TERMS_TYPES.includes(s as PaymentTermsType)
    ? (s as PaymentTermsType)
    : null;
}

/** Clamp the advance % to a sane 1–99 for partial advances. */
export function normalizeAdvancePct(v: any): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(99, Math.round(n * 100) / 100);
}

/** Extract structured payment-terms fields from an arbitrary payload. */
export function pickPaymentTermsFields(data: any): PaymentTermsFields {
  return {
    paymentTermsType: normalizePaymentTermsType(data?.paymentTermsType),
    advancePct: normalizeAdvancePct(data?.advancePct),
    balancePct: normalizeBalancePct(data?.balancePct),
    balanceDueDays: normalizeBalanceDueDays(data?.balanceDueDays),
    balanceDueBasis: normalizeDueBasis(data?.balanceDueBasis),
    advanceDueBasis: normalizeDueBasis(data?.advanceDueBasis),
    dispatchCondition: normalizeDispatchCondition(data?.dispatchCondition),
  };
}

/**
 * The printable label for a document/master, e.g.:
 *  - "Net 30"
 *  - "100% advance"
 *  - "50% advance + 50% Net 15"
 *  - "On delivery Net 7"
 * Falls back to the legacy free-text `paymentTerms` string when no structured
 * type is set.
 */
export function formatPaymentTerms(data: {
  paymentTermsType?: string | null;
  advancePct?: number | null;
  paymentTermsDays?: number | null;
  paymentTerms?: string | null;
}): string | null {
  const type = normalizePaymentTermsType(data.paymentTermsType);
  if (!type) return data.paymentTerms?.trim() || null;

  const days = Number(data.paymentTermsDays) || 0;
  if (type === "advance_full") return "100% advance";
  if (type === "on_delivery") return days > 0 ? `On delivery Net ${days}` : "Payment on delivery";
  if (type === "advance_partial") {
    const pct = normalizeAdvancePct(data.advancePct);
    if (!pct) return days > 0 ? `Advance + balance Net ${days}` : "Advance payment";
    const rest = Math.round((100 - pct) * 100) / 100;
    return days > 0
      ? `${pct}% advance + ${rest}% Net ${days}`
      : `${pct}% advance + ${rest}% on delivery`;
  }
  // credit
  return days > 0 ? `Net ${days}` : null;
}

/**
 * True when the terms require some payment before delivery (100% advance or a
 * partial advance). Useful for guarding dispatch flows later.
 */
export function requiresAdvance(
  t: Pick<PaymentTermsFields, "paymentTermsType"> | null | undefined,
): boolean {
  return (
    t?.paymentTermsType === "advance_full" || t?.paymentTermsType === "advance_partial"
  );
}

/** Normalize a dispatch-condition string. Unknown → null. */
export function normalizeDispatchCondition(v: any): DispatchCondition | null {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v);
  return DISPATCH_CONDITIONS.includes(s as DispatchCondition)
    ? (s as DispatchCondition)
    : null;
}

/** Normalize a due-basis string. Unknown → null. */
export function normalizeDueBasis(v: any): DueBasis | null {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v);
  return s === "so_confirmation" || s === "invoice_date" ? (s as DueBasis) : null;
}

/** Balance % (0–100). null = not specified (callers default to 100 − advance). */
export function normalizeBalancePct(v: any): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100) / 100;
}

/** Balance due days (0 = due on invoice date). */
export function normalizeBalanceDueDays(v: any): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

/** Balance % implied by an advance %: 100 − advance. */
export function balancePctFor(advancePct: number | null): number {
  const a = Number(advancePct) || 0;
  return Math.round((100 - a) * 100) / 100;
}

/** Default dispatch condition for a legacy term type (used by backfill). */
export function defaultDispatchConditionFor(
  type: PaymentTermsType | null,
  advancePct?: number | null,
): DispatchCondition {
  if (type === "advance_full") return "full_required";
  if (type === "advance_partial") {
    // 50%+ advance with balance due on invoice date behaves like full-required;
    // otherwise only the advance gates dispatch. Callers may override.
    return "advance_required";
  }
  if (type === "on_delivery") return "full_required";
  return "no_check";
}

/** V1: advance due date = SO confirmation date (known date only). */
export function advanceDueDate(soConfirmationDate: string): string {
  return soConfirmationDate.slice(0, 10);
}

/** Add N days to a YYYY-MM-DD date, returning YYYY-MM-DD. */
export function addDays(yyyyMmDd: string, days: number): string {
  const d = new Date(`${yyyyMmDd.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (Number(days) || 0));
  return d.toISOString().slice(0, 10);
}

/**
 * V1: balance due date = invoice date + agreed credit days.
 * Never uses dispatch/delivery dates in V1.
 */
export function balanceDueDate(invoiceDate: string, balanceDueDays: number | null): string {
  return addDays(invoiceDate, Number(balanceDueDays) || 0);
}
