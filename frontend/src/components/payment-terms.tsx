import { useId } from "react";

/**
 * Shared payment-terms model — mirrors backend/src/lib/payment-terms.ts.
 *
 * Four structured types used by debtors, suppliers and every trading document
 * (sales orders, purchase orders, proformas, invoices):
 *
 *  - credit:          Net N days (paymentTermsDays).
 *  - advance_full:    100% advance before dispatch/delivery.
 *  - advance_partial: user-entered % advance; the remainder is due on delivery.
 *  - on_delivery:     100% payment on delivery (COD).
 */
export type PaymentTermsType =
  | "credit"
  | "advance_full"
  | "advance_partial"
  | "on_delivery";

export const PAYMENT_TERMS_TYPE_OPTIONS: Array<{
  value: PaymentTermsType;
  label: string;
}> = [
  { value: "credit", label: "Credit — Net days" },
  { value: "advance_full", label: "Advance payment — 100%" },
  { value: "advance_partial", label: "Partial advance — % + balance on delivery" },
  { value: "on_delivery", label: "Payment on delivery" },
];

export interface PaymentTermsValue {
  paymentTermsType: PaymentTermsType | null;
  advancePct: number | null;
  paymentTermsDays: number | null;
}

/** Clamp the advance % to 1–99 (a full advance is its own type). */
export function normalizeAdvancePct(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(99, Math.round(n * 100) / 100);
}

export function normalizePaymentTermsType(v: unknown): PaymentTermsType | null {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v);
  return PAYMENT_TERMS_TYPE_OPTIONS.some((o) => o.value === s)
    ? (s as PaymentTermsType)
    : null;
}

/** Read the structured terms off any master/document row (camel or snake case). */
export function pickTerms(row: any): PaymentTermsValue {
  return {
    paymentTermsType: normalizePaymentTermsType(
      row?.paymentTermsType ?? row?.payment_terms_type,
    ),
    advancePct: normalizeAdvancePct(row?.advancePct ?? row?.advance_pct),
    paymentTermsDays:
      Number(row?.paymentTermsDays ?? row?.payment_terms_days) || null,
  };
}

/**
 * The printable label for a master/document, e.g. "Net 30",
 * "100% advance", "50% advance + 50% on delivery", "Payment on delivery".
 * Falls back to the legacy free-text `payment_terms` string.
 */
export function formatPaymentTerms(
  t: Partial<PaymentTermsValue> & { paymentTerms?: string | null; payment_terms?: string | null },
): string {
  const type = normalizePaymentTermsType(t.paymentTermsType);
  if (!type) return (t.paymentTerms ?? t.payment_terms ?? "").trim() || "—";
  if (type === "advance_full") return "100% advance";
  if (type === "on_delivery") return "Payment on delivery";
  if (type === "advance_partial") {
    const pct = normalizeAdvancePct(t.advancePct);
    return pct
      ? `${pct}% advance + ${Math.round((100 - pct) * 100) / 100}% on delivery`
      : "Advance payment";
  }
  const days = Number(t.paymentTermsDays) || 0;
  return days > 0 ? `Net ${days}` : "—";
}

/**
 * Form fields for structured payment terms. Drop-in replacement for the old
 * free-text "Payment terms" input; keeps a free-text override for odd cases.
 *
 * Controlled via a single `payment_terms_type` + `payment_terms_advance_pct`
 * pair (snake_case form fields, matching the pages' form conventions) plus an
 * optional free-text override. The formatted label is derived, never stored in
 * the free-text field, so terms always render consistently.
 */
export function PaymentTermsFields({
  type,
  advancePct,
  paymentTermsDays,
  freeText,
  onChange,
  disabled = false,
  daysLabel = "Net days",
  idPrefix,
}: {
  /** Selected structured type ("" = custom/free-text). */
  type: PaymentTermsType | "";
  advancePct: string;
  paymentTermsDays: string;
  /** Free-text override shown when no structured type is selected. */
  freeText: string;
  onChange: (patch: {
    payment_terms_type?: PaymentTermsType | "";
    payment_terms_advance_pct?: string;
    payment_terms_days?: string;
    payment_terms?: string;
  }) => void;
  disabled?: boolean;
  /** Label for the Net-days input (e.g. "Customer net days"). */
  daysLabel?: string;
  idPrefix?: string;
}) {
  const autoId = useId();
  const id = idPrefix ?? `pt-${autoId}`;
  const cls =
    "inp w-full rounded border border-border bg-background px-3 py-2 text-sm";
  const smallCls = "inp w-full text-sm";

  return (
    <div className="space-y-1.5">
      <select
        className={cls}
        value={type}
        disabled={disabled}
        onChange={(e) => {
          const nextType = e.target.value as PaymentTermsType | "";
          const patch: Parameters<typeof onChange>[0][0] = {
            payment_terms_type: nextType,
          };
          // Clear the free-text override when a structured type is chosen so
          // the derived label wins on save.
          if (nextType) patch.payment_terms = "";
          onChange(patch);
        }}
      >
        <option value="">Custom / free text…</option>
        {PAYMENT_TERMS_TYPE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {type === "advance_partial" && (
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={99}
            step="0.5"
            className={smallCls}
            value={advancePct}
            placeholder="50"
            disabled={disabled}
            onChange={(e) =>
              onChange({ payment_terms_advance_pct: e.target.value })
            }
          />
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            % advance · balance on delivery
          </span>
        </div>
      )}

      {type === "credit" && (
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            className={smallCls}
            value={paymentTermsDays}
            disabled={disabled}
            onChange={(e) => onChange({ payment_terms_days: e.target.value })}
          />
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {daysLabel}
          </span>
        </div>
      )}

      {!type && (
        <input
          id={`${id}-free`}
          className={cls}
          value={freeText}
          placeholder="e.g. Net 30, 50% PIAA, LC at sight…"
          disabled={disabled}
          onChange={(e) => onChange({ payment_terms: e.target.value })}
        />
      )}
    </div>
  );
}

/** Derive the form-field values for the component from a row. */
export function toFormFields(row: any): {
  payment_terms_type: PaymentTermsType | "";
  payment_terms_advance_pct: string;
  payment_terms_days: string;
  payment_terms: string;
} {
  const t = pickTerms(row);
  return {
    payment_terms_type: t.paymentTermsType ?? "",
    payment_terms_advance_pct:
      t.paymentTermsType === "advance_partial" && t.advancePct != null
        ? String(t.advancePct)
        : "",
    payment_terms_days: t.paymentTermsDays != null ? String(t.paymentTermsDays) : "30",
    payment_terms:
      !t.paymentTermsType ? (row?.paymentTerms ?? row?.payment_terms ?? "") : "",
  };
}

/** Build the API payload for the structured fields (null clears). */
export function toPayload(f: {
  payment_terms_type: PaymentTermsType | "";
  payment_terms_advance_pct: string;
  payment_terms_days: string;
}) {
  const type = f.payment_terms_type || null;
  return {
    paymentTermsType: type,
    advancePct: type === "advance_partial" ? normalizeAdvancePct(f.payment_terms_advance_pct) : null,
    paymentTermsDays:
      type === "credit" ? Number(f.payment_terms_days) || 30 : undefined,
  };
}
