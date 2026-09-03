// ===========================================================================
// Dedicated report views — Portfolio Summary (metric cards + summary table),
// the Balance Sheet statement and the Profit & Loss statement (with period
// presets and manual FX depreciation adjustments). Each ships its own Excel
// and PDF exporters so exports always reflect the on-screen numbers.
// ===========================================================================

import { useMemo, useState, type CSSProperties } from "react";
import { Pencil, Plus } from "lucide-react";
import { fmtMoney } from "@/components/ledger-ui";
import {
  buildPrintPage,
  exportExcelAoa,
  fmtAccountingText,
  printPdfHtml,
  type ExportHeading,
} from "@/lib/reports-export";
import { fmtNum } from "@/lib/reports-registry";

const inputCls =
  "w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition-all focus:border-primary/50 focus:ring-2 focus:ring-primary/10";
const labelCls =
  "mb-1 block text-[10px] font-medium uppercase tracking-widest text-muted-foreground";

const rup = (n: number) => `₹${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const acct = (n: number) => fmtAccountingText(n);
const DATE_FMT: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
const dFmt = (s?: string | null) => (s ? new Date(s).toLocaleDateString("en-US", DATE_FMT) : "—");

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio Summary
// ─────────────────────────────────────────────────────────────────────────────

const METRIC_CARDS: Array<{ key: string; label: string; tone: string; bar: string }> = [
  {
    key: "total_buyers",
    label: "Total buyers",
    tone: "text-sky-600 dark:text-sky-300",
    bar: "bg-sky-500",
  },
  {
    key: "total_invoices",
    label: "Total invoices",
    tone: "text-indigo-600 dark:text-indigo-300",
    bar: "bg-indigo-500",
  },
  {
    key: "total_invoice_value",
    label: "Total invoice value",
    tone: "text-emerald-600 dark:text-emerald-300",
    bar: "bg-emerald-500",
  },
  {
    key: "total_collections",
    label: "Total collections",
    tone: "text-teal-600 dark:text-teal-300",
    bar: "bg-teal-500",
  },
  {
    key: "total_outstanding",
    label: "Total outstanding",
    tone: "text-amber-600 dark:text-amber-300",
    bar: "bg-amber-500",
  },
  {
    key: "open_invoices",
    label: "Open invoices",
    tone: "text-blue-600 dark:text-blue-300",
    bar: "bg-blue-500",
  },
  {
    key: "closed_invoices",
    label: "Closed invoices",
    tone: "text-slate-600 dark:text-slate-300",
    bar: "bg-slate-400",
  },
  {
    key: "avg_payment_days",
    label: "Avg payment days",
    tone: "text-violet-600 dark:text-violet-300",
    bar: "bg-violet-500",
  },
  {
    key: "median_payment_days",
    label: "Median payment days",
    tone: "text-fuchsia-600 dark:text-fuchsia-300",
    bar: "bg-fuchsia-500",
  },
];

export function PortfolioView({ data }: { data: any }) {
  const m = data?.metrics ?? {};
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {METRIC_CARDS.map((c) => {
          const raw = m[c.key];
          const value =
            c.key === "total_invoice_value" ||
            c.key === "total_collections" ||
            c.key === "total_outstanding"
              ? rup(Number(raw) || 0)
              : fmtNum(raw);
          return (
            <div
              key={c.key}
              className="relative overflow-hidden rounded-xl border border-border bg-card p-4"
            >
              <div className={`absolute inset-x-0 top-0 h-[3px] ${c.bar}`} />
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {c.label}
              </div>
              <div className={`mt-1.5 font-display text-xl font-semibold ${c.tone}`}>{value}</div>
            </div>
          );
        })}
      </div>
      {m.as_of && <p className="text-xs text-muted-foreground">As of {dFmt(m.as_of)}</p>}
    </div>
  );
}

export function PortfolioSummaryTable({ rows }: { rows: any[] }) {
  return (
    <div className="mt-5 overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-3.5 text-[15px] font-semibold tracking-tight text-foreground">
        Summary by buyer
      </div>
      <div className="overflow-x-auto">
        <table className="table-premium w-full text-sm">
          <thead className="bg-muted/30 text-xs uppercase tracking-widest text-muted-foreground">
            <tr>
              {["Buyer", "Invoices", "Invoice value", "Collections", "Outstanding"].map((h, i) => (
                <th
                  key={h}
                  className={`px-3 py-2.5 font-normal ${i === 0 ? "text-left" : "text-right"}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any, i: number) => (
              <tr key={r.buyer_id ?? i} className="border-b border-border/60 hover:bg-muted/30">
                <td className="px-3 py-2.5 text-left font-medium">{r.buyer}</td>
                <td className="px-3 py-2.5 text-right num">{r.invoices}</td>
                <td className="px-3 py-2.5 text-right num">{fmtMoney(r.value)}</td>
                <td className="px-3 py-2.5 text-right num text-success">
                  {fmtMoney(r.collections)}
                </td>
                <td className="px-3 py-2.5 text-right num text-warning">
                  {fmtMoney(r.outstanding)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function exportPortfolioExcel(heading: ExportHeading, data: any) {
  const m = data?.metrics ?? {};
  const metricRows = METRIC_CARDS.map((c) => [c.label, m[c.key] ?? 0]);
  const aoa: any[][] = [];
  if (heading.companyName) aoa.push([heading.companyName]);
  aoa.push([heading.title]);
  if (heading.period) aoa.push([heading.period]);
  aoa.push([]);
  aoa.push(["Portfolio summary"]);
  aoa.push(["Metric", "Value"], ...metricRows);
  aoa.push([]);
  aoa.push(["Summary by buyer"]);
  aoa.push(["Buyer", "Invoices", "Invoice value", "Collections", "Outstanding"]);
  for (const r of data?.rows ?? [])
    aoa.push([r.buyer, r.invoices, r.value, r.collections, r.outstanding]);
  exportExcelAoa("portfolio-summary", "Portfolio Summary", aoa, 5);
}

export async function exportPortfolioPdf(heading: ExportHeading, data: any) {
  const m = data?.metrics ?? {};
  const cards = METRIC_CARDS.map((c) => {
    const value =
      c.key === "total_invoice_value" ||
      c.key === "total_collections" ||
      c.key === "total_outstanding"
        ? rup(Number(m[c.key]) || 0)
        : fmtNum(m[c.key]);
    return `<div style="border:1px solid #e2e8f0;border-top:4px solid #3b82f6;border-radius:10px;padding:10px 12px;display:inline-block;min-width:150px;background:#fff;">
      <div style="font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:.06em;">${c.label}</div>
      <div style="font-size:16px;font-weight:700;margin-top:4px;">${value}</div></div>`;
  });
  const rowsHtml = (data?.rows ?? [])
    .map(
      (r: any) =>
        `<tr><td>${r.buyer}</td><td style="text-align:right">${r.invoices}</td><td style="text-align:right">${rup(r.value)}</td><td style="text-align:right">${rup(r.collections)}</td><td style="text-align:right;font-weight:600">${rup(r.outstanding)}</td></tr>`,
    )
    .join("");
  const body = `
    <div style="margin: 4px 0 14px;">${cards.join("")}</div>
    <div style="font-weight:800;text-transform:uppercase;letter-spacing:.06em;font-size:10px;margin-bottom:6px;">Summary by buyer</div>
    <table class="data"><thead><tr><th>Buyer</th><th class="num">Invoices</th><th class="num">Invoice value</th><th class="num">Collections</th><th class="num">Outstanding</th></tr></thead>
    <tbody>${rowsHtml || `<tr><td colspan="5">No buyers yet</td></tr>`}</tbody></table>`;
  const html = buildPrintPage({
    heading,
    orientation: "portrait",
    body,
    footerNote: "Portfolio summary",
  });
  await printPdfHtml(html);
}

// ─────────────────────────────────────────────────────────────────────────────
// Balance Sheet — statement view + exporters
// ─────────────────────────────────────────────────────────────────────────────

interface StmtSection {
  label: string;
  items: Array<{ label: string; amount: number }>;
  total: number;
}

function SectionBlock({
  title,
  section,
  tone,
}: {
  title: string;
  section: StmtSection;
  tone?: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between border-b border-border pb-1.5">
        <span className={`text-sm font-semibold ${tone ?? "text-foreground"}`}>{title}</span>
        <span className={`text-sm font-semibold ${tone ?? "text-foreground"}`}>
          {acct(section.total)}
        </span>
      </div>
      <div className="space-y-1">
        {section.items.length === 0 && (
          <div className="py-2 text-xs text-muted-foreground/60">Nothing recorded</div>
        )}
        {section.items.map((it) => (
          <div
            key={`${title}-${it.label}`}
            className="flex items-center justify-between gap-4 py-1 text-sm"
          >
            <span className="min-w-0 truncate text-muted-foreground">{it.label}</span>
            <span className="shrink-0 font-mono text-xs">{acct(it.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BalanceSheetView({ data }: { data: any }) {
  if (!data) return null;
  const assets: StmtSection[] = data.assets ?? [];
  const liabilities: StmtSection[] = data.liabilities ?? [];
  const equity: StmtSection | undefined = data.equity;
  const diff = Math.abs(
    (data.total_assets ?? 0) - ((data.total_liabilities ?? 0) + (data.total_equity ?? 0)),
  );
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        As of <span className="font-medium text-foreground">{dFmt(data.as_of)}</span> · Assets{" "}
        <span className="font-mono text-xs">{acct(data.total_assets)}</span> = Liabilities{" "}
        <span className="font-mono text-xs">{acct(data.total_liabilities)}</span> + Equity{" "}
        <span className="font-mono text-xs">{acct(data.total_equity)}</span>
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-5 rounded-xl border border-border bg-card p-5">
          <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-primary">Assets</h3>
          {assets.map((s) => (
            <SectionBlock key={s.label} title={s.label} section={s} />
          ))}
          <div className="flex items-center justify-between border-t-2 border-border pt-3">
            <span className="font-semibold">Total assets</span>
            <span className="font-semibold">{acct(data.total_assets ?? 0)}</span>
          </div>
        </div>
        <div className="space-y-5 rounded-xl border border-border bg-card p-5">
          <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-primary">
            Liabilities &amp; equity
          </h3>
          {liabilities.map((s) => (
            <SectionBlock key={s.label} title={s.label} section={s} />
          ))}
          {equity && <SectionBlock title={equity.label} section={equity} />}
          <div className="flex items-center justify-between border-t-2 border-border pt-3">
            <span className="font-semibold">Total liabilities &amp; equity</span>
            <span className="font-semibold">
              {acct((data.total_liabilities ?? 0) + (data.total_equity ?? 0))}
            </span>
          </div>
          {diff > 0.005 && (
            <p className="text-xs text-warning">
              Differs from total assets by {fmtAccountingText(diff)} — the retained-earnings
              balancing figure is included in equity.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function bsRowsForExport(
  data: any,
): Array<{
  label: string;
  value: string | number;
  section?: boolean;
  bold?: boolean;
  indent?: number;
}> {
  const rows: Array<{
    label: string;
    value: string | number;
    section?: boolean;
    bold?: boolean;
    indent?: number;
  }> = [];
  const push = (
    label: string,
    amount?: number | string,
    opts?: { section?: boolean; bold?: boolean; indent?: number },
  ) => {
    rows.push({
      label,
      value: amount === undefined ? "" : typeof amount === "string" ? amount : amount,
      ...opts,
    });
  };
  push("Assets", undefined, { section: true });
  for (const s of data?.assets ?? []) {
    for (const it of s.items) push(it.label, it.amount, { indent: 1 });
    push(s.label, s.total, { bold: true, indent: 1 });
  }
  push("Total assets", data?.total_assets ?? 0, { bold: true });
  push("Liabilities", undefined, { section: true });
  for (const s of data?.liabilities ?? []) {
    for (const it of s.items) push(it.label, it.amount, { indent: 1 });
    push(s.label, s.total, { bold: true, indent: 1 });
  }
  push("Equity", undefined, { section: true });
  const eq = data?.equity;
  if (eq) {
    for (const it of eq.items ?? []) push(it.label, it.amount, { indent: 1 });
    push(eq.label, eq.total, { bold: true, indent: 1 });
  }
  push("Total liabilities & equity", (data?.total_liabilities ?? 0) + (data?.total_equity ?? 0), {
    bold: true,
  });
  return rows;
}

export function exportBalanceSheetExcel(heading: ExportHeading, data: any) {
  const aoa: any[][] = [];
  if (heading.companyName) aoa.push([heading.companyName]);
  aoa.push([heading.title]);
  if (heading.period) aoa.push([heading.period]);
  aoa.push([]);
  aoa.push(["Balance sheet"]);
  for (const r of bsRowsForExport(data)) {
    if (r.section) aoa.push([r.label.toUpperCase()]);
    else if (typeof r.value === "string") aoa.push([r.label, r.value]);
    else aoa.push([`${"  ".repeat(r.indent ?? 0)}${r.label}`, r.value]);
  }
  exportExcelAoa("balance-sheet", "Balance Sheet", aoa, 2);
}

export async function exportBalanceSheetPdf(heading: ExportHeading, data: any) {
  const stmtHtml = bsRowsForExport(data)
    .map((r) => {
      const style: string[] = [];
      if (r.section)
        style.push(
          "font-weight:800;text-transform:uppercase;letter-spacing:.06em;border-top:2px solid #334155;background:#f1f5f9",
        );
      if (r.indent) style.push(`padding-left:${16 + (r.indent ?? 0) * 20}px`);
      if (r.bold) style.push("font-weight:700");
      const hasVal = r.value !== "";
      return `<tr><td style="${style.join(";")}">${r.label.replace(/\s+/g, " ")}</td><td style="${hasVal ? "text-align:right;font-variant-numeric:tabular-nums;" : ""}${r.bold ? "font-weight:700;" : ""}">${hasVal ? acct(Number(r.value)) : ""}</td></tr>`;
    })
    .join("");
  const html = buildPrintPage({
    heading,
    orientation: "portrait",
    body: `<table class="data" style="width:70%"><tbody>${stmtHtml}</tbody></table>`,
    footerNote: "Balance sheet",
  });
  await printPdfHtml(html);
}

// ─────────────────────────────────────────────────────────────────────────────
// Profit & Loss — period bar, FX adjustments, statement + exporters
// ─────────────────────────────────────────────────────────────────────────────

export interface PlFx {
  turnover: number;
  costOfSales: number;
}

export interface PlPeriod {
  preset: string; // this_month | previous_month | this_quarter | custom
  from: string;
  to: string;
  year: number;
  quarter: number; // 0 = all quarters
  month: number; // 0 = all months
}

export function defaultPlPeriod(): PlPeriod {
  const now = new Date();
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const to = todayIso();
  return {
    preset: "this_month",
    from,
    to,
    year: now.getFullYear(),
    quarter: Math.floor(now.getMonth() / 3) + 1,
    month: 0,
  };
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const lastDayOf = (y: number, m: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;

export function rangeForPreset(preset: string): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  if (preset === "previous_month") {
    const pm = m === 1 ? 12 : m - 1;
    const py = m === 1 ? y - 1 : y;
    return { from: `${py}-${String(pm).padStart(2, "0")}-01`, to: lastDayOf(py, pm) };
  }
  if (preset === "this_quarter") {
    const q = Math.floor((m - 1) / 3);
    const from = `${y}-${String(q * 3 + 1).padStart(2, "0")}-01`;
    return { from, to: lastDayOf(y, q * 3 + 3) };
  }
  // this_month
  return { from: `${y}-${String(m).padStart(2, "0")}-01`, to: lastDayOf(y, m) };
}

export function rangeForSelects(
  year: number,
  quarter: number,
  month: number,
): { from: string; to: string } {
  if (month > 0)
    return { from: `${year}-${String(month).padStart(2, "0")}-01`, to: lastDayOf(year, month) };
  if (quarter > 0) {
    const from = `${year}-${String((quarter - 1) * 3 + 1).padStart(2, "0")}-01`;
    return { from, to: lastDayOf(year, quarter * 3) };
  }
  return { from: `${year}-01-01`, to: lastDayOf(year, 12) };
}

export function inferSelects(
  from: string,
  to: string,
): { year: number; quarter: number; month: number } {
  const f = from || "";
  const t = to || "";
  const year = Number(f.slice(0, 4)) || new Date().getFullYear();
  if (f.slice(0, 7) === t.slice(0, 7) && f && t) {
    return { year, quarter: 0, month: Number(f.slice(5, 7)) || 0 };
  }
  // Whole year?
  if (f === `${year}-01-01` && (t === lastDayOf(year, 12) || !t))
    return { year, quarter: 0, month: 0 };
  // Quarter-aligned?
  for (let q = 1; q <= 4; q++) {
    if (
      f === `${year}-${String((q - 1) * 3 + 1).padStart(2, "0")}-01` &&
      t === lastDayOf(year, q * 3)
    ) {
      return { year, quarter: q, month: 0 };
    }
  }
  return { year, quarter: 0, month: 0 };
}

export function PlPeriodBar({
  period,
  onChange,
}: {
  period: PlPeriod;
  onChange: (p: PlPeriod) => void;
}) {
  const yearOptions = useMemo(() => {
    const y = new Date().getFullYear();
    return [y - 3, y - 2, y - 1, y, y + 1];
  }, []);

  const applyRange = (range: { from: string; to: string }) => onChange({ ...period, ...range });
  const presetLabel = (p: string) =>
    ({
      this_month: "This Month",
      previous_month: "Previous Month",
      this_quarter: "This Quarter",
      custom: "Custom",
    })[p] ?? "Custom";

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        {["this_month", "previous_month", "this_quarter", "custom"].map((p) => (
          <button
            key={p}
            onClick={() => {
              const r = rangeForPreset(p);
              const sel = inferSelects(r.from, r.to);
              onChange({
                preset: p,
                from: r.from,
                to: r.to,
                year: sel.year,
                quarter: sel.quarter,
                month: sel.month,
              });
            }}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              period.preset === p
                ? "border-primary bg-primary-soft text-primary"
                : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"
            }`}
          >
            {presetLabel(p)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-28">
          <span className={labelCls}>Year</span>
          <select
            className={inputCls}
            value={period.year}
            onChange={(e) => {
              const range = rangeForSelects(Number(e.target.value), period.quarter, period.month);
              onChange({ ...period, year: Number(e.target.value), preset: "custom", ...range });
            }}
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div className="w-32">
          <span className={labelCls}>Quarter</span>
          <select
            className={inputCls}
            value={period.quarter}
            onChange={(e) => {
              const q = Number(e.target.value);
              const range = rangeForSelects(period.year, q, period.month);
              onChange({ ...period, quarter: q, month: 0, preset: "custom", ...range });
            }}
          >
            <option value={0}>All</option>
            {[1, 2, 3, 4].map((q) => (
              <option key={q} value={q}>
                Q{q}
              </option>
            ))}
          </select>
        </div>
        <div className="w-32">
          <span className={labelCls}>Month</span>
          <select
            className={inputCls}
            value={period.month}
            onChange={(e) => {
              const month = Number(e.target.value);
              const range = rangeForSelects(period.year, month ? 0 : period.quarter, month);
              onChange({ ...period, month, preset: "custom", ...range });
            }}
          >
            <option value={0}>All</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((mm) => (
              <option key={mm} value={mm}>
                {new Date(period.year, mm - 1, 1).toLocaleDateString("en-US", { month: "long" })}
              </option>
            ))}
          </select>
        </div>
        <div className="w-40">
          <span className={labelCls}>From</span>
          <input
            type="date"
            className={inputCls}
            value={period.from}
            onChange={(e) => onChange({ ...period, preset: "custom", from: e.target.value })}
          />
        </div>
        <div className="w-40">
          <span className={labelCls}>To</span>
          <input
            type="date"
            className={inputCls}
            value={period.to}
            onChange={(e) => onChange({ ...period, preset: "custom", to: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}

// ── FX adjustment popover ──────────────────────────────────────────────────

export function FxAdjust({
  label,
  value,
  onSave,
}: {
  label: string;
  value: number;
  onSave: (v: number) => void;
}) {
  const tone = value < 0 ? "rose" : "emerald";
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("0");
  const colors =
    tone === "rose"
      ? "border-rose-500/30 text-rose-600 hover:bg-rose-500/10 dark:text-rose-300"
      : "border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-300";
  return (
    <div className="relative inline-flex">
      <button
        onClick={() => {
          setDraft(value ? String(value) : "");
          setOpen((o) => !o);
        }}
        title={`Edit ${label}`}
        className={`inline-flex items-center gap-1 rounded-md border bg-transparent px-1.5 py-0.5 font-mono text-[11px] transition ${colors}`}
      >
        {value !== 0 ? acct(value) : "0"}
        {value === 0 ? <Plus className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute left-1/2 top-full z-30 mt-1.5 w-56 -translate-x-1/2 rounded-xl border border-border bg-popover p-3 shadow-lg animate-in fade-in slide-in-from-top-1">
            <div className="text-xs font-semibold text-foreground">{label}</div>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Enter the FX depreciation adjustment (negative reduces the section total). Applied to
              all totals &amp; exports.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                step="any"
                className={`${inputCls} font-mono text-sm`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoFocus
              />
              <button
                onClick={() => {
                  onSave(Number(draft) || 0);
                  setOpen(false);
                }}
                className="rounded-md bg-primary px-2.5 py-2 text-xs font-medium text-primary-foreground"
              >
                Apply
              </button>
            </div>
            <div className="mt-1.5 flex justify-end">
              <button
                onClick={() => setOpen(false)}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── P&L statement rows (screen + exports share this) ───────────────────────

export interface PlExportRow {
  label: string;
  amount: string | number;
  section?: boolean;
  bold?: boolean;
  indent?: number;
  fx?: boolean;
  /** Which FX dimension this adjustment row edits. */
  fxKey?: "turnover" | "costOfSales";
}

/**
 * Build the full statement row list for the P&L — with the manual FX
 * adjustments folded into every subtotal. Used by the on-screen view and by
 * the Excel / PDF exporters so all three always agree.
 */
export function plStatementRows(data: any, fx: PlFx): PlExportRow[] {
  const rows: PlExportRow[] = [];
  const sec = (label: string) => rows.push({ label, amount: "", section: true });
  const line = (label: string, amount: number | string, opts: Partial<PlExportRow> = {}) =>
    rows.push({ label, amount: typeof amount === "string" ? amount : amount, ...opts });

  const to = data?.turnover ?? { lines: [], total: 0 };
  sec("Turnover");
  for (const l of to.lines ?? []) line(l.label, l.amount, { indent: 1 });
  line("FX depreciation adjustment", fx.turnover, { indent: 1, fx: true, fxKey: "turnover" });
  const turnoverTotal = (to.total ?? 0) + fx.turnover;
  line("Total turnover", turnoverTotal, { bold: true, indent: 1 });

  const cos = data?.cost_of_sales ?? { lines: [], total: 0 };
  sec("Cost of sales");
  for (const l of cos.lines ?? []) line(l.label, l.amount, { indent: 1 });
  line("FX depreciation adjustment", fx.costOfSales, { indent: 1, fx: true, fxKey: "costOfSales" });
  const costTotal = (cos.total ?? 0) + fx.costOfSales;
  line("Total cost of sales", costTotal, { bold: true, indent: 1 });

  // Everything below is recomputed here so the FX adjustments flow through
  // every subtotal, not just the two sections they were entered in.
  const grossProfit = turnoverTotal - costTotal;
  line("Gross profit", grossProfit, { bold: true });

  const admin = data?.admin ?? { lines: [], total: 0 };
  sec("Administrative costs");
  for (const l of admin.lines ?? []) line(l.label, l.amount, { indent: 1 });
  const adminTotal = admin.total ?? 0;
  line("Total administrative costs", adminTotal, { bold: true, indent: 1 });

  const other = data?.other_net ?? 0;
  const operating = grossProfit - adminTotal;
  line("Operating profit", operating, { bold: true });
  if (Math.abs(other) > 0.005) line("Other income / (expenses)", other, { indent: 1 });
  const pbt = operating + other;
  line("Profit before tax", pbt, { bold: true });

  const tax = data?.tax ?? { lines: [], total: 0 };
  sec("Taxation");
  for (const l of tax.lines ?? []) line(l.label, l.amount, { indent: 1 });
  const taxTotal = tax.total ?? 0;
  line("Total tax", taxTotal, { bold: true, indent: 1 });

  line("Profit after tax", pbt - taxTotal, { bold: true });
  return rows;
}

export function ProfitLossView({
  data,
  fx,
  onFx,
}: {
  data: any;
  fx: PlFx;
  onFx: (f: PlFx) => void;
}) {
  const rows = useMemo(() => (data ? plStatementRows(data, fx) : []), [data, fx]);
  const patRow = rows.find((r) => r.label === "Profit after tax");
  const pat = Number(patRow?.amount ?? 0);

  if (!data) {
    return (
      <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
        Loading statement…
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
          <div>
            <div className="text-base font-semibold text-foreground">Profit &amp; Loss</div>
            <div className="text-xs text-muted-foreground">
              {dFmt(data.from)} – {dFmt(data.to)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Profit after tax
            </div>
            <div
              className={`text-xl font-semibold ${pat < 0 ? "text-destructive" : "text-success"}`}
            >
              {acct(pat)}
            </div>
          </div>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r, i) => {
              const style: CSSProperties = {};
              if (r.indent) style.paddingLeft = `${18 + (r.indent ?? 0) * 22}px`;
              return (
                <tr
                  key={`${r.label}-${i}`}
                  className={r.section ? "border-t-2 border-border" : "border-b border-border/40"}
                >
                  <td
                    className={`py-1.5 pr-4 ${
                      r.section
                        ? "bg-muted/40 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground"
                        : r.bold
                          ? "font-semibold"
                          : "text-muted-foreground"
                    }`}
                    style={style}
                  >
                    {r.label}
                    {r.fx && (
                      <span className="ml-2 align-middle">
                        <FxAdjust
                          label={r.label}
                          value={Number(r.amount) || 0}
                          onSave={(v) =>
                            onFx(
                              r.fxKey === "costOfSales"
                                ? { ...fx, costOfSales: v }
                                : { ...fx, turnover: v },
                            )
                          }
                        />
                      </span>
                    )}
                  </td>
                  <td
                    className={`whitespace-nowrap py-1.5 text-right font-mono text-xs ${r.bold ? "font-semibold" : ""} ${
                      r.fx
                        ? Number(r.amount) < 0
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-emerald-600 dark:text-emerald-400"
                        : ""
                    }`}
                  >
                    {typeof r.amount === "number" ? acct(r.amount) : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Manual adjustments
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            FX depreciation adjustments shift the turnover and cost-of-sales totals. They flow
            through every subtotal on this statement and are included in the Excel / PDF exports.
          </p>
          <div className="mt-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-foreground">FX on turnover</span>
              <FxAdjust
                label="FX on turnover"
                value={fx.turnover}
                onSave={(v) => onFx({ ...fx, turnover: v })}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-foreground">FX on cost of sales</span>
              <FxAdjust
                label="FX on cost of sales"
                value={fx.costOfSales}
                onSave={(v) => onFx({ ...fx, costOfSales: v })}
              />
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Gross profit
          </div>
          <div className="mt-1 font-display text-2xl font-semibold">
            {rup(Number(grossProfitOf(rows)))}
          </div>
          <div className="mt-4 text-[10px] uppercase tracking-widest text-muted-foreground">
            Profit after tax
          </div>
          <div
            className={`mt-1 font-display text-2xl font-semibold ${pat < 0 ? "text-destructive" : "text-success"}`}
          >
            {rup(pat)}
          </div>
        </div>
      </div>
    </div>
  );
}

function grossProfitOf(rows: PlExportRow[]) {
  const row = rows.find((r) => r.label === "Gross profit");
  return row ? Number(row.amount) || 0 : 0;
}

export function exportPlExcel(heading: ExportHeading, data: any, fx: PlFx) {
  const rows = plStatementRows(data, fx);
  const aoa: any[][] = [];
  if (heading.companyName) aoa.push([heading.companyName]);
  aoa.push([heading.title]);
  if (heading.period) aoa.push([heading.period]);
  aoa.push([]);
  aoa.push(["Profit & loss statement"]);
  for (const r of rows) {
    if (r.section) aoa.push([r.label.toUpperCase()]);
    else
      aoa.push([
        `${"  ".repeat(r.indent ?? 0)}${r.label}`,
        typeof r.amount === "number" ? r.amount : r.amount,
      ]);
  }
  exportExcelAoa("profit-and-loss", "Profit & Loss", aoa, 2);
}

export async function exportPlPdf(heading: ExportHeading, data: any, fx: PlFx) {
  const rows = plStatementRows(data, fx);
  const stmtHtml = rows
    .map((r) => {
      const style: string[] = [];
      if (r.section)
        style.push(
          "font-weight:800;text-transform:uppercase;letter-spacing:.06em;font-size:9.5px;border-top:2px solid #334155;background:#f1f5f9",
        );
      if (r.indent) style.push(`padding-left:${16 + (r.indent ?? 0) * 22}px`);
      if (r.bold) style.push("font-weight:700");
      const hasVal = r.amount !== "";
      const fxStyle = r.fx ? (Number(r.amount) < 0 ? "color:#b91c1c;" : "color:#047857;") : "";
      return `<tr><td style="${style.join(";")}">${r.label.replace(/\s+/g, " ")}</td><td style="${hasVal ? "text-align:right;font-variant-numeric:tabular-nums;" : ""}${r.bold ? "font-weight:700;" : ""}${fxStyle}">${hasVal ? acct(Number(r.amount)) : ""}</td></tr>`;
    })
    .join("");
  const html = buildPrintPage({
    heading,
    orientation: "portrait",
    body: `<table class="data" style="width:62%"><tbody>${stmtHtml}</tbody></table>`,
    footerNote: "Profit & loss statement",
  });
  await printPdfHtml(html);
}
