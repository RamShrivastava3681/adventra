import type { InputHTMLAttributes, ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

/* ──────────────────────────────────────────────────────────────────────────
 * Shared line-item table primitives for Purchase Orders and Sales Orders.
 * One design system: compact h-9 controls, table-like rows on desktop,
 * stacked cards on mobile, right-aligned numerics, % suffixes, read-only
 * totals. No business logic lives here — only presentation.
 * ──────────────────────────────────────────────────────────────────────── */

/** Unified single-line control: h-9, subtle 1px border, white, clear focus. */
export const lineInputCls =
  "h-9 w-full rounded-md border border-border bg-white px-2.5 text-sm text-foreground tabular-nums placeholder:font-normal placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60";

/** Desktop column templates (mobile uses grid-cols-6 stacking). */
export const PO_LINE_GRID =
  "md:grid-cols-[minmax(0,2.3fr)_minmax(0,1.5fr)_72px_110px_124px_92px_124px_40px]";
export const SO_LINE_GRID =
  "md:grid-cols-[minmax(0,2fr)_68px_104px_112px_120px_84px_84px_120px_40px]";

/** Tiny label shown above a cell on mobile only (desktop uses the table head). */
export function MiniLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground md:hidden",
        className,
      )}
    >
      {children}
    </span>
  );
}

export type LineHeadCol = {
  label: string;
  align?: "left" | "center" | "right";
};

/** Column header row — desktop only, small uppercase muted text. */
export function LineHead({ grid, cols }: { grid: string; cols: LineHeadCol[] }) {
  return (
    <div className={cn("hidden gap-2 px-1 md:grid", grid)} aria-hidden>
      {cols.map((c) => (
        <div
          key={c.label}
          className={cn(
            "text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground",
            c.align === "right" && "text-right",
            c.align === "center" && "text-center",
          )}
        >
          {c.label}
        </div>
      ))}
    </div>
  );
}

export function LineItemsSection({
  title,
  count,
  onAdd,
  addLabel = "Add line",
  children,
}: {
  title: string;
  count: number;
  onAdd?: () => void;
  addLabel?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border/70 bg-white/70 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border/70 px-1 pb-2.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <h4 className="truncate text-[15px] font-semibold text-foreground">{title}</h4>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {count} {count === 1 ? "item" : "items"}
          </span>
        </div>
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          >
            <Plus className="h-3.5 w-3.5" /> {addLabel}
          </button>
        )}
      </div>
      <div className="pt-1">{children}</div>
    </section>
  );
}

type PctInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & {
  className?: string;
};

/** Numeric input with a trailing % suffix (Disc %, GST %). */
export function PctInput({ className, ...props }: PctInputProps) {
  return (
    <div className="relative">
      <input
        type="number"
        {...props}
        className={cn(lineInputCls, "pr-7 text-center", className)}
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
        %
      </span>
    </div>
  );
}

/** Calculated line total — plain semibold value, not an input box. */
export function LineTotal({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-9 items-center justify-end text-sm font-semibold tabular-nums text-foreground">
      {children}
    </div>
  );
}

/** Compact delete affordance: 36px icon button with tooltip. */
export function RemoveLineButton({ onClick, title = "Remove line" }: { onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-transparent text-muted-foreground/70 transition-colors hover:border-destructive/30 hover:bg-destructive/5 hover:text-destructive"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

export function TotalRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-sm tabular-nums text-foreground">{value}</span>
    </div>
  );
}

/** Compact right-aligned summary panel with a prominent grand total. */
export function TotalsPanel({
  grandTotal,
  children,
}: {
  grandTotal: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="ml-auto w-full max-w-xs rounded-lg border border-border/70 bg-white p-4 text-sm">
      <div className="space-y-1.5">{children}</div>
      <div className="mt-2.5 flex items-baseline justify-between gap-3 border-t border-border pt-2.5">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Grand total
        </span>
        <span className="text-[17px] font-semibold tabular-nums text-foreground">{grandTotal}</span>
      </div>
    </div>
  );
}
