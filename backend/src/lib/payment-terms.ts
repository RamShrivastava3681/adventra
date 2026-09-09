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

export interface PaymentTermsFields {
  /** Structured term type. null/undefined = legacy document (free-text only). */
  paymentTermsType: PaymentTermsType | null;
  /** Advance percentage for advance_partial (1–99). */
  advancePct: number | null;
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
  };
}

/**
 * The printable label for a document/master, e.g.:
 *  - "Net 30"
 *  - "100% advance"
 *  - "50% advance + 50% on delivery"
 *  - "Payment on delivery"
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

  if (type === "advance_full") return "100% advance";
  if (type === "on_delivery") return "Payment on delivery";
  if (type === "advance_partial") {
    const pct = normalizeAdvancePct(data.advancePct);
    if (!pct) return "Advance payment";
    return `${pct}% advance + ${Math.round((100 - pct) * 100) / 100}% on delivery`;
  }
  // credit
  const days = Number(data.paymentTermsDays) || 0;
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
