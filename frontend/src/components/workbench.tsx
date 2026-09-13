import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

/* Shared Whizunik Command workbench primitives (matches ui/ mockups).
   Pure presentation — no data fetching, no business logic. */

export function WorkbenchHeader({
  icon,
  title,
  subtitle,
  context,
  actions,
}: {
  icon?: ReactNode;
  title: string;
  subtitle: string;
  context?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="border-b border-border bg-background px-6 py-5 md:px-10">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {icon && (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
              {icon}
            </div>
          )}
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
            <p className="mt-0.5 text-[13px] text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {context}
          {actions}
        </div>
      </div>
    </div>
  );
}

export function WorkbenchTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: string[];
  active: string;
  onChange: (t: string) => void;
}) {
  return (
    <div className="border-b border-border bg-background px-6 md:px-10">
      <div className="mx-auto max-w-[1440px]">
        <div className="whiz-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t}
              role="tab"
              data-active={t === active}
              className="whiz-tab"
              onClick={() => onChange(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function KpiTint({
  label,
  value,
  hint,
  tint = "blue",
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  tint?: "blue" | "amber" | "red" | "green";
  icon?: ReactNode;
}) {
  return (
    <div className={`rounded-xl border p-4 whiz-kpi-${tint}`}>
      <div className="flex items-center gap-2 text-[13px] font-medium text-[#24425f] dark:text-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="num mt-1 text-[28px] font-semibold leading-none tracking-tight text-[#0f2c4d] dark:text-foreground">
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function SectionCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="whiz-section overflow-hidden">
      <div className="whiz-section-title">
        <span>{title}</span>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function FooterBanner({ left, right }: { left: string; right?: string }) {
  return (
    <div className="whiz-footerbar flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
      <span className="font-medium">{left}</span>
      {right && <span>{right}</span>}
    </div>
  );
}

export function DocAction({
  to,
  label = "Open",
  onClick,
}: {
  to?: string;
  label?: string;
  onClick?: () => void;
}) {
  if (to) {
    return (
      <Link to={to as any} className="whiz-docbtn">
        {label}
      </Link>
    );
  }
  return (
    <button className="whiz-docbtn" onClick={onClick}>
      {label}
    </button>
  );
}
