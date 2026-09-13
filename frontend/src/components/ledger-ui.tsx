import { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, ArrowLeft, ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";

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
    <div className="sticky top-0 z-30 border-b border-border bg-background/85 px-6 py-6 shadow-[0_1px_12px_-6px_rgba(14,27,44,0.12)] backdrop-blur-xl supports-[backdrop-filter]:bg-background/75 md:px-10">
      {/* Breadcrumbs */}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          {backTo && (
            <Link
              to={backTo as any}
              className="mr-1 inline-flex h-6 w-6 items-center justify-center rounded-md border border-border text-muted-foreground transition-all hover:border-primary/40 hover:text-primary"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </Link>
          )}
          {breadcrumbs.map((b, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/40" />}
              {b.href ? (
                <Link to={b.href as any} className="font-medium hover:text-primary transition-colors">
                  {b.label}
                </Link>
              ) : (
                <span className="rounded-full border border-border bg-muted/50 px-2 py-0.5 font-medium text-muted-foreground">{b.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          {icon && (
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-gradient-to-b from-primary-soft to-primary-soft/40 text-primary shadow-sm">
              {icon}
            </div>
          )}
          <div>
            {eyebrow && (
              <p className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary-soft/60 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-primary font-bold">
                {eyebrow}
              </p>
            )}
            <h1 className="mt-1.5 text-[22px] font-semibold leading-tight tracking-tight text-foreground">
              {title}
            </h1>
            {description && (
              <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">{description}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
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
        <div className="relative mb-4">
          <div className="absolute inset-0 scale-125 rounded-2xl bg-primary/5 blur-md" aria-hidden />
          <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/15 bg-gradient-to-b from-primary-soft to-background text-primary shadow-sm">
            {icon}
          </div>
        </div>
      )}
      <h3 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted-foreground">{description}</p>
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
  tint,
}: {
  label: string;
  value: string;
  delta?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
  tint?: "blue" | "amber" | "red" | "green";
}) {
  const toneCls = {
    neutral: "text-muted-foreground border-border bg-muted/60",
    good: "text-sem-success border-sem-success/25 bg-sem-success/10",
    warn: "text-sem-attention border-sem-attention/25 bg-sem-attention/10",
    bad: "text-sem-critical border-sem-critical/25 bg-sem-critical/10",
  }[tone];
  return (
    <div className={`metric-card card-lift group ${tint ? `whiz-kpi-${tint}` : ""}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {delta && (
        <div className={`metric-delta inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${toneCls}`}>
          {delta}
        </div>
      )}
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
    <div className={`overflow-hidden rounded-2xl border border-border bg-card shadow-card transition-shadow duration-200 hover:shadow-card-hover ${className}`}>
      {title && (
        <div className="flex items-center justify-between gap-3 border-b border-border/80 bg-gradient-to-b from-muted/[0.5] to-muted/[0.15] px-5 py-3.5">
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
  // Semantic pills — PAID/APPROVED green, PARTIALLY PAID/FUNDED blue,
  // PENDING amber, OVERDUE red, IN REVIEW violet, DRAFT slate.
  // Never color alone — pills carry a status dot and explicit wording.
  const neutral = "bg-muted text-muted-foreground border-transparent";
  const slate = "bg-sem-neutral/10 text-sem-neutral border-sem-neutral/25";
  const blue = "bg-primary-soft text-[#0a4a8a] dark:text-[#63baff] border-transparent";
  const info = "bg-sem-info/10 text-sem-info border-sem-info/25";
  const darkBlue = "bg-surface-active text-[#1e4e79] dark:text-[#7fb5e8] border-transparent";
  const green = "bg-sem-success/10 text-sem-success border-sem-success/25";
  const amber = "bg-sem-attention/10 text-sem-attention border-sem-attention/25";
  const violet = "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/25";
  const red = "bg-destructive/10 text-destructive border-destructive/20";
  const critical = "bg-sem-critical/10 text-sem-critical border-sem-critical/25";

  const map: Record<string, string> = {
    pending: amber,
    draft: slate,
    open: info,
    new: slate,
    submitted: info,
    processing: info,
    in_review: violet,
    under_review: violet,
    pending_review: violet,
    pending_approval: violet,
    pending_payment: amber,
    approved: green,
    approved_for_payment: green,
    verified: green,
    accepted: green,
    info,
    active: info,
    confirmed: info,
    sent: info,
    issued: info,
    advanced: info,
    funded: info,
    paid: green,
    settled: green,
    delivered: green,
    received: green,
    fully_received: green,
    fully_dispatched: info,
    fully_paid: green,
    partially_received: info,
    partially_dispatched: info,
    partially_paid: info,
    short_paid: amber,
    converted_to_so: info,
    converted_to_po: info,
    warning: amber,
    attention: amber,
    expired: amber,
    overdue: critical,
    disputed: critical,
    rejected: critical,
    cancelled: critical,
    critical,
    prospect: slate,
  };
  return (
    <span className={`status-pill ${tone ?? map[status] ?? neutral}`}>
      {label ?? status.replace(/_/g, " ")}
    </span>
  );
}

/**
 * Metric-aware trend indicator. Polarity depends on the metric:
 * pass `invert` for metrics where "up" is bad (outstanding AR, overdue
 * counts, costs, collection time). Neutral when the change is ~zero.
 * Always pairs the arrow with an explicit % label — never color alone.
 */
export function Trend({
  value,
  caption,
  invert = false,
  className = "",
}: {
  value: number;
  caption?: string;
  invert?: boolean;
  className?: string;
}) {
  const neutral = Math.abs(value) < 0.05;
  const good = neutral ? null : value > 0 !== invert;
  const Icon = neutral ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  const cls = neutral
    ? "text-sem-neutral border-border bg-muted/60"
    : good
      ? "text-sem-success border-sem-success/25 bg-sem-success/10"
      : "text-sem-critical border-sem-critical/25 bg-sem-critical/10";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold tabular-nums ${cls} ${className}`}>
      <Icon className="h-3 w-3" />
      {Math.abs(value).toFixed(1)}%
      {caption && <span className="font-medium text-muted-foreground">{caption}</span>}
    </span>
  );
}

export type SeverityLevel = "critical" | "action" | "attention" | "info" | "neutral";

/** Map a backend alert severity to the 4-level visual severity system. */
export function alertSeverity(severity?: string | null): SeverityLevel {
  const s = String(severity ?? "").toLowerCase();
  if (s === "critical" || s === "error" || s === "failed") return "critical";
  if (s === "warning" || s === "action" || s === "overdue") return "action";
  if (s === "attention" || s === "pending" || s === "caution") return "attention";
  if (s === "info" || s === "success" || s === "read") return "info";
  return "info";
}

const SEV_LABEL: Record<SeverityLevel, string> = {
  critical: "Critical",
  action: "Action required",
  attention: "Attention",
  info: "Info",
  neutral: "Neutral",
};

/** Severity dot for list rows — always accompanied by adjacent text. */
export function SevDot({ level, className = "" }: { level: SeverityLevel; className?: string }) {
  const cls =
    level === "critical"
      ? "bg-sem-critical"
      : level === "action"
        ? "bg-sem-caution"
        : level === "attention"
          ? "bg-sem-attention"
          : level === "info"
            ? "bg-sem-info"
            : "bg-sem-neutral";
  return <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${cls} ${className}`} />;
}

/** Compact severity badge — dot + uppercase label, never color alone. */
export function SevBadge({ level, label }: { level: SeverityLevel; label?: string }) {
  const cls =
    level === "critical"
      ? "sev-critical"
      : level === "action"
        ? "sev-action"
        : level === "attention"
          ? "sev-attention"
          : level === "info"
            ? "sev-info"
            : "sev-neutral";
  return <span className={`sev-badge ${cls}`}>{label ?? SEV_LABEL[level]}</span>;
}

/** Health meter — subtle horizontal bar + labeled status dot. */
export function HealthMeter({
  level,
}: {
  level: "healthy" | "watch" | "at-risk" | "critical";
}) {
  const cfg = {
    healthy: { label: "Healthy", dot: "bg-sem-success", bar: "bg-sem-success", pct: 100 },
    watch: { label: "Watch", dot: "bg-sem-attention", bar: "bg-sem-attention", pct: 66 },
    "at-risk": { label: "At risk", dot: "bg-sem-caution", bar: "bg-sem-caution", pct: 38 },
    critical: { label: "Critical", dot: "bg-sem-critical", bar: "bg-sem-critical", pct: 15 },
  }[level];
  return (
    <span className="inline-flex min-w-[140px] flex-col gap-1.5">
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
        {cfg.label}
      </span>
      <span className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <span className={`block h-full rounded-full ${cfg.bar}`} style={{ width: `${cfg.pct}%` }} />
      </span>
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
