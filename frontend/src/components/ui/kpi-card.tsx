import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Clickable KPI tile used by the marketplace dashboards. */
export function KpiCard({
  id,
  title,
  subtitle,
  value,
  icon,
  color = "#6366f1",
  onClick,
  className,
}: {
  id?: string;
  title: string;
  subtitle?: string;
  value: ReactNode;
  icon?: ReactNode;
  color?: string;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      id={id}
      onClick={onClick}
      className={cn(
        "flex w-full items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-xs transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900",
        className,
      )}
    >
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-slate-500 dark:text-slate-400">
          {title}
        </span>
        <span className="mt-1 block text-2xl font-bold text-slate-900 dark:text-slate-100">
          {value}
        </span>
        {subtitle ? (
          <span className="mt-0.5 block truncate text-[11px] text-slate-400">{subtitle}</span>
        ) : null}
      </span>
      {icon ? (
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{ color, backgroundColor: `${color}1a` }}
        >
          {icon}
        </span>
      ) : null}
    </button>
  );
}
