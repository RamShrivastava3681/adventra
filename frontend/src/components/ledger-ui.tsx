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
  icon,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  backTo?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="border-b border-border bg-background px-6 py-6 md:px-10">
      {/* Breadcrumbs */}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          {backTo && (
            <Link
              to={backTo as any}
              className="mr-1 inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </Link>
          )}
          {breadcrumbs.map((b, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/40" />}
              {b.href ? (
                <Link to={b.href as any} className="hover:text-primary transition-colors">
                  {b.label}
                </Link>
              ) : (
                <span className="text-muted-foreground">{b.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          {icon && (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
              {icon}
            </div>
          )}
          <div>
            {eyebrow && (
              <p className="text-[10px] uppercase tracking-[0.18em] text-primary font-semibold">
                {eyebrow}
              </p>
            )}
            <h1 className="mt-0.5 text-[28px] font-semibold leading-tight tracking-tight text-foreground">
              {title}
            </h1>
            {description && (
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/**
 * Shared empty-state block — consistent illustration, title, description and
 * optional call-to-action across every list page.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {icon && (
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary-soft text-primary">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
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
    <div className={`rounded-xl border border-border bg-card shadow-card ${className}`}>
      {title && (
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h3 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h3>
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
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
  // Blue family + neutral by default; restrained red reserved for critical
  // states (overdue, rejected, cancelled, disputed). Never color alone —
  // pills carry a status dot and explicit wording.
  const neutral = "bg-muted text-muted-foreground border-transparent";
  const blue = "bg-primary-soft text-[#0a4a8a] dark:text-[#63baff] border-transparent";
  const darkBlue = "bg-surface-active text-[#1e4e79] dark:text-[#7fb5e8] border-transparent";
  const red = "bg-destructive/10 text-destructive border-destructive/20";

  const map: Record<string, string> = {
    pending: neutral,
    draft: neutral,
    open: neutral,
    new: neutral,
    submitted: blue,
    processing: blue,
    in_review: blue,
    under_review: blue,
    pending_review: darkBlue,
    pending_approval: darkBlue,
    pending_acceptance: darkBlue,
    pending_payment: darkBlue,
    approved: blue,
    approved_for_payment: blue,
    verified: blue,
    accepted: blue,
    info: blue,
    active: blue,
    confirmed: blue,
    sent: blue,
    issued: blue,
    advanced: blue,
    funded: blue,
    paid: blue,
    settled: blue,
    delivered: blue,
    received: blue,
    partially_received: darkBlue,
    fully_received: blue,
    partially_dispatched: darkBlue,
    fully_dispatched: blue,
    partially_paid: darkBlue,
    converted_to_so: blue,
    converted_to_po: blue,
    warning: darkBlue,
    attention: darkBlue,
    short_paid: darkBlue,
    expired: darkBlue,
    disputed: red,
    overdue: red,
    rejected: red,
    cancelled: red,
    critical: red,
  };
  return (
    <span className={`status-pill ${tone ?? map[status] ?? neutral}`}>
      {label ?? status.replace(/_/g, " ")}
    </span>
  );
}

export function fmtMoney(n: number | string | null | undefined) {
  const v = Number(n ?? 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "INR",
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
