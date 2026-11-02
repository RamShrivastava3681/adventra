import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const TONES: Record<string, string> = {
  critical:
    "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950 dark:text-rose-300",
  attention:
    "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950 dark:text-amber-300",
  success:
    "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300",
  info: "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950 dark:text-sky-300",
  neutral:
    "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300",
};

/** Status pill accepting either a severity tone or free-form children. */
export function StatusPill({
  severity,
  status,
  label,
  tone,
  className,
  children,
}: {
  severity?: string;
  status?: string;
  label?: string;
  tone?: string;
  className?: string;
  children?: ReactNode;
}) {
  const key = severity ?? tone ?? status ?? "neutral";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
        TONES[key] ?? TONES.neutral,
        className,
      )}
    >
      {children ?? label ?? status}
    </span>
  );
}
