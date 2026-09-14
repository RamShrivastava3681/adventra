import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { fmtDate } from "@/components/ledger-ui";

export function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
  if (abs >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (abs >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export function fmtFull(n: number): string {
  return `₹${Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/* ── KPI card: clickable only when a destination exists ── */
export function KpiCard({
  title,
  value,
  lines,
  alert,
  icon,
  iconTone = "blue",
  to,
}: {
  title: string;
  value: string;
  lines: ReactNode;
  alert?: string;
  icon: ReactNode;
  iconTone?: "blue" | "green" | "amber" | "red";
  to?: string;
}) {
  const tone: Record<string, string> = {
    blue: "border-primary/20 bg-primary-soft/60 text-primary",
    green: "border-sem-success/25 bg-sem-success/10 text-sem-success",
    amber: "border-sem-attention/25 bg-sem-attention/10 text-sem-attention",
    red: "border-sem-critical/25 bg-sem-critical/10 text-sem-critical",
  };
  const body = (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card transition-colors hover:border-border-strong">
      <div className="flex items-start justify-between gap-3">
        <div className="text-[11px] font-bold uppercase tracking-[0.11em] text-muted-foreground">
          {title}
        </div>
        <span
          className={`flex h-9 w-9 items-center justify-center rounded-xl border ${tone[iconTone]}`}
        >
          {icon}
        </span>
      </div>
      <div className="num mt-2 text-[28px] font-semibold leading-none tracking-tight text-foreground">
        {value}
      </div>
      <div className="mt-2.5 space-y-0.5 border-t border-border/60 pt-2.5 text-xs text-muted-foreground">
        {lines}
      </div>
      {alert && <div className="mt-1.5 text-xs font-semibold text-sem-critical">{alert}</div>}
    </div>
  );
  if (!to) return body;
  return (
    <Link to={to as any} aria-label={`${title}: view details`} className="block">
      {body}
    </Link>
  );
}

export function KpiSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-border bg-card p-5">
      <div className="h-3 w-24 rounded bg-muted" />
      <div className="mt-3 h-7 w-28 rounded bg-muted" />
      <div className="mt-3 h-3 w-32 rounded bg-muted" />
    </div>
  );
}

/* ── Section card shell ── */
export function SectionCard({
  title,
  subtitle,
  actionLabel,
  actionTo,
  children,
}: {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  actionTo?: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-2 px-5 pt-5">
        <div>
          <h3 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {actionLabel && actionTo && (
          <Link
            to={actionTo as any}
            className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
          >
            {actionLabel} <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>
      <div className="px-5 pb-5 pt-3">{children}</div>
    </section>
  );
}

export function CardError({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 px-4 py-8 text-center">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-primary hover:border-primary"
        >
          Retry
        </button>
      )}
    </div>
  );
}

/* ── Business summary tabs ── */
export const COMMAND_TABS = [
  { key: "summary", label: "Business Summary" },
  { key: "sales", label: "Sales Performance" },
  { key: "cash", label: "Cash Position" },
  { key: "receivables", label: "Receivables" },
  { key: "payables", label: "Payables" },
  { key: "inventory", label: "Inventory & Forecast" },
  { key: "alerts", label: "Operational Alerts" },
] as const;

export type CommandTab = (typeof COMMAND_TABS)[number]["key"];

export function TabBar({
  active,
  onChange,
}: {
  active: CommandTab;
  onChange: (t: CommandTab) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Command overview views"
      className="flex gap-1 overflow-x-auto border-b border-border"
    >
      {COMMAND_TABS.map((t) => {
        const selected = active === t.key;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(t.key)}
            className={`whitespace-nowrap px-3 py-2.5 text-[13px] font-medium transition-colors ${
              selected
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Small shared bits ── */
const AREA_TONE: Record<string, string> = {
  Sales: "bg-sem-info/10 text-sem-info border-sem-info/25",
  Procurement: "bg-violet-500/10 text-violet-600 border-violet-500/25",
  Warehouse: "bg-slate-500/10 text-slate-600 border-slate-500/25",
  Finance: "bg-sem-success/10 text-sem-success border-sem-success/25",
  Checker: "bg-sem-attention/10 text-sem-attention border-sem-attention/25",
  Treasury: "bg-sem-success/10 text-sem-success border-sem-success/25",
  Cash: "bg-sem-info/10 text-sem-info border-sem-info/25",
  Inventory: "bg-sem-attention/10 text-sem-attention border-sem-attention/25",
};

export function AreaBadge({ area }: { area: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${AREA_TONE[area] ?? "bg-muted/60 text-muted-foreground border-border"}`}
    >
      {area}
    </span>
  );
}

export function TargetDate({
  date,
  overdue,
  approaching,
}: {
  date: string | null;
  overdue?: boolean;
  approaching?: boolean;
}) {
  if (!date) return <span className="text-muted-foreground">—</span>;
  const cls = overdue
    ? "text-sem-critical font-semibold"
    : approaching
      ? "text-sem-attention font-medium"
      : "text-muted-foreground";
  return <span className={`whitespace-nowrap text-[13px] ${cls}`}>{fmtDate(date)}</span>;
}
