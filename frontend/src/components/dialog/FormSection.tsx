import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * FormSection — labelled expandable section for "Additional details".
 * Built now, NOT wired into any form (per plan). When used later it will
 * only reorder rendering; field names / payloads stay identical.
 * If an optional field becomes mandatory, pass `reason` and set
 * `forceOpen` so the section expands with the explanation.
 */
export function FormSection({
  title,
  children,
  defaultOpen = false,
  forceOpen = false,
  reason,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  reason?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const expanded = forceOpen || open;
  return (
    <section className="overflow-hidden rounded-[10px] border border-border bg-white dark:bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 border-b border-border bg-[#e8f0f8] px-4 py-2.5 text-left dark:bg-surface-active"
      >
        <span className="text-[15px] font-bold text-[#0f2c4d] dark:text-foreground">{title}</span>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {reason && expanded && (
        <p className="border-b border-sem-attention/25 bg-sem-attention/10 px-4 py-2 text-xs font-medium text-sem-attention">
          {reason}
        </p>
      )}
      {expanded && <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div>}
    </section>
  );
}
