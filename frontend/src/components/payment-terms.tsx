/**
 * Shared payment-terms model — mirrors backend/src/lib/payment-terms.ts.
 *
 * Four structured types used by debtors, suppliers and every trading document
 * (sales orders, purchase orders, proformas, invoices):
 *
 *  - credit:          Net N days (paymentTermsDays).
 *  - advance_full:    100% advance before dispatch/delivery.
 *  - advance_partial: user-entered % advance; remainder due N days after invoice.
 *  - on_delivery:     100% payment due N days after invoice (0 = on delivery).
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
  { value: "advance_partial", label: "Partial advance — % + balance Net days" },
  { value: "on_delivery", label: "Payment on delivery + Net days" },
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
  const daysRaw =
    row?.paymentTermsDays ??
    row?.payment_terms_days ??
    row?.balanceDueDays ??
    row?.balance_due_days;
  return {
    paymentTermsType: normalizePaymentTermsType(
      row?.paymentTermsType ?? row?.payment_terms_type,
    ),
    advancePct: normalizeAdvancePct(row?.advancePct ?? row?.advance_pct),
    paymentTermsDays: daysRaw === undefined || daysRaw === null || daysRaw === "" ? null : Number(daysRaw) || 0,
  };
}

/** Balance/net days driving the invoice due date (invoice date + N). */
export function balanceDaysFor(t: Partial<PaymentTermsValue>): number {
  const type = normalizePaymentTermsType(t.paymentTermsType);
  if (!type || type === "advance_full") return 0;
  const raw = t.paymentTermsDays as unknown;
  if (raw === undefined || raw === null || raw === "") {
    // No days stored anywhere: credit defaults to Net 30, delivery-based
    // terms default to due on delivery/invoice date.
    return type === "credit" ? 30 : 0;
  }
  const n = Number(t.paymentTermsDays);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : type === "credit" ? 30 : 0;
}

/**
 * Add N days to a YYYY-MM-DD date, returning YYYY-MM-DD.
 * Pure calendar math (UTC) — unlike `new Date(s)` + `toISOString()`, this
 * never shifts the day across timezones. 0 days returns the same date.
 */
export function addDaysISO(yyyyMmDd: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(yyyyMmDd.trim());
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + (Number(days) || 0));
  return d.toISOString().slice(0, 10);
}

/** Invoice due date = invoice date + balance/net days (0 → same as invoice date). */
export function dueDateFor(issueDate: string, t: Partial<PaymentTermsValue>): string {
  if (!issueDate) return "";
  return addDaysISO(issueDate, balanceDaysFor(t));
}

/**
 * The printable label for a master/document, e.g. "Net 30",
 * "100% advance", "50% advance + 50% Net 15", "On delivery Net 7".
 */
export function formatPaymentTerms(
  t: Partial<PaymentTermsValue> & { paymentTerms?: string | null; payment_terms?: string | null },
): string {
  const type = normalizePaymentTermsType(t.paymentTermsType);
  if (!type) return (t.paymentTerms ?? t.payment_terms ?? "").trim() || "—";
  const days = Number(t.paymentTermsDays) || 0;
  if (type === "advance_full") return "100% advance";
  if (type === "on_delivery") return days > 0 ? `On delivery Net ${days}` : "Payment on delivery";
  if (type === "advance_partial") {
    const pct = normalizeAdvancePct(t.advancePct);
    const rest = pct != null ? Math.round((100 - pct) * 100) / 100 : null;
    if (pct == null || rest == null) return days > 0 ? `Advance + balance Net ${days}` : "Advance payment";
    return days > 0
      ? `${pct}% advance + ${rest}% Net ${days}`
      : `${pct}% advance + ${rest}% on delivery`;
  }
  return days > 0 ? `Net ${days}` : "—";
}

/**
 * Form fields for structured payment terms.
 *
 * Controlled via `payment_terms_type` + `payment_terms_advance_pct` +
 * `payment_terms_days` (snake_case form fields, matching the pages' form
 * conventions). `payment_terms_days` doubles as the balance-due days for
 * on-delivery / partial-advance terms and drives the invoice due date
 * (invoice date + N; 0 = due on delivery/invoice date).
 */
export function PaymentTermsFields({
  type,
  advancePct,
  paymentTermsDays,
  onChange,
  disabled = false,
  daysLabel = "Net days",
  hideBalanceDays = false,
}: {
  /** Selected structured type. */
  type: PaymentTermsType;
  advancePct: string;
  paymentTermsDays: string;
  onChange: (patch: {
    payment_terms_type?: PaymentTermsType;
    payment_terms_advance_pct?: string;
    payment_terms_days?: string;
  }) => void;
  disabled?: boolean;
  /** Label for the Net-days input (e.g. "Customer net days"). */
  daysLabel?: string;
  /** Hide the balance-due-days input for on-delivery / partial terms (days stay 0). */
  hideBalanceDays?: boolean;
}) {
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
          const nextType = e.target.value as PaymentTermsType;
          onChange({ payment_terms_type: nextType });
        }}
      >
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
            % advance
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

      {!hideBalanceDays && (type === "on_delivery" || type === "advance_partial") && (
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            className={smallCls}
            value={paymentTermsDays}
            placeholder="0"
            disabled={disabled}
            onChange={(e) => onChange({ payment_terms_days: e.target.value })}
          />
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            Balance due days · 0 = on delivery
          </span>
        </div>
      )}

      {type === "advance_full" && (
        <p className="text-xs text-muted-foreground">
          Full amount due before dispatch — no balance days.
        </p>
      )}
    </div>
  );
}

/** Derive the form-field values for the component from a row. */
export function toFormFields(row: any): {
  payment_terms_type: PaymentTermsType;
  payment_terms_advance_pct: string;
  payment_terms_days: string;
} {
  const t = pickTerms(row);
  const type = t.paymentTermsType ?? "credit";
  return {
    payment_terms_type: type,
    payment_terms_advance_pct:
      type === "advance_partial" && t.advancePct != null
        ? String(t.advancePct)
        : "",
    payment_terms_days:
      t.paymentTermsDays != null
        ? String(t.paymentTermsDays)
        : type === "credit"
          ? "30"
          : "0",
  };
}

/** Build the API payload for the structured fields (null clears). */
export function toPayload(f: {
  payment_terms_type: PaymentTermsType;
  payment_terms_advance_pct: string;
  payment_terms_days: string;
}) {
  const type = f.payment_terms_type;
  const days = Number(f.payment_terms_days);
  const finiteDays = Number.isFinite(days) && days >= 0 ? Math.floor(days) : null;
  return {
    paymentTermsType: type,
    advancePct: type === "advance_partial" ? normalizeAdvancePct(f.payment_terms_advance_pct) : null,
    paymentTermsDays:
      type === "advance_full"
        ? 0
        : finiteDays ?? (type === "credit" ? 30 : 0),
  };
}
