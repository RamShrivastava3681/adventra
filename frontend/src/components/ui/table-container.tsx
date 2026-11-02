import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Horizontal scroll wrapper used by the marketplace data tables. */
export function TableContainer({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900",
        className,
      )}
    >
      {children}
    </div>
  );
}
