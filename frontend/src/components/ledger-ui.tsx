import { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, ArrowLeft } from "lucide-react";

export type BreadcrumbItem = {
  label: string;
  href?: string;
};

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  breadcrumbs,
  backTo,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  backTo?: string;
}) {
  return (
    <div className="border-b border-border bg-white/50 px-6 py-7 md:px-10">
      {/* Breadcrumbs */}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground/70">
          {backTo && (
            <Link
              to={backTo as any}
              className="mr-1 inline-flex items-center gap-1 text-muted-foreground/50 hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3 w-3" />
            </Link>
          )}
          {breadcrumbs.map((b, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/30" />}
              {b.href ? (
                <Link to={b.href as any} className="hover:text-accent transition-colors">
                  {b.label}
                </Link>
              ) : (
                <span className="text-muted-foreground/90">{b.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          {eyebrow && (
            <p className="text-[10px] uppercase tracking-[0.2em] text-accent font-semibold">
              {eyebrow}
            </p>
          )}
          <h1 className="mt-1 font-display text-3xl tracking-tight text-foreground md:text-4xl">
            {title}
          </h1>
          {description && (
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Stat({
  label,
  value,
  delta,
  tone = "neutral",
}: {
  label: string;
  value: string;
  delta?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const toneCls = {
    neutral: "text-muted-foreground",
    good: "text-success",
    warn: "text-warning",
    bad: "text-destructive",
  }[tone];
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {delta && <div className={`metric-delta ${toneCls}`}>{delta}</div>}
    </div>
  );
}

export function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-border bg-card shadow-card ${className}`}>
      {title && (
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h3 className="font-display text-lg text-foreground">{title}</h3>
          {action}
        </div>
      )}
      <div className="p-6">{children}</div>
    </div>
  );
}

export function StatusPill({
  status,
  label,
  tone,
}: {
  status: string;
  label?: string;
  tone?: string;
}) {
  const map: Record<string, string> = {
    pending: "bg-slate-100 text-slate-500",
    approved: "bg-blue-50 text-blue-600",
    advanced: "bg-emerald-50 text-emerald-600",
    paid: "bg-emerald-50 text-emerald-600",
    overdue: "bg-red-50 text-red-600",
    rejected: "bg-red-50 text-red-600",
    critical: "bg-red-50 text-red-600",
    warning: "bg-amber-50 text-amber-600",
    info: "bg-blue-50 text-blue-600",
    draft: "bg-slate-100 text-slate-500",
    verified: "bg-blue-50 text-blue-600",
    approved_for_payment: "bg-violet-50 text-violet-600",
    partially_paid: "bg-amber-50 text-amber-600",
    cancelled: "bg-red-50 text-red-600",
  };
  return (
    <span className={`status-pill ${tone ?? map[status] ?? "bg-slate-100 text-slate-500"}`}>
      {label ?? status}
    </span>
  );
}

export function fmtMoney(n: number | string | null | undefined) {
  const v = Number(n ?? 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(v);
}

// Accounting format: 2 decimals, negatives in parentheses, no currency symbol.
export function fmtAccounting(n: number | string | null | undefined) {
  const v = Number(n ?? 0);
  if (!isFinite(v)) return "—";
  const abs = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(v));
  return v < -0.005 ? `(${abs})` : abs;
}

export function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function daysBetween(a: string, b: string = new Date().toISOString()) {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24));
}
