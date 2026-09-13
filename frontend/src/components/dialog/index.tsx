import { X, Plus } from "lucide-react";
import type { ReactNode } from "react";

/* ----------------------------------------------------------------------------
 * Shared modal shell — Whizunik Command style (matches ui/ New Sales Order)
 *
 * Every modal in the app should use this so header, body, and footer share
 * the same sizing, spacing, and sticky behaviour. Wide forms get section
 * cards with pale blue title bars; footers are Cancel / secondary / primary.
 * -------------------------------------------------------------------------- */

export interface DialogProps {
  open?: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  maxHeight?: string;
}

function Shell({
  onClose,
  title,
  subtitle,
  children,
  footer,
  wide = false,
  maxHeight = "max-h-[92vh]",
  stickyFooter = false,
}: DialogProps & { stickyFooter?: boolean }) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#0a2239]/55 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`w-full overflow-y-auto rounded-2xl border border-border bg-[#f4f7fb] shadow-modal dark:bg-card ${wide ? "max-w-5xl" : "max-w-lg"} ${maxHeight}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {/* ── Header: 20px title + helper subtitle + X ── */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 rounded-t-2xl border-b border-border bg-white px-6 py-4 dark:bg-card">
          <div className="min-w-0 flex-1">
            <h3 className="text-xl font-semibold leading-tight tracking-tight text-[#0f2c4d] dark:text-foreground">
              {title}
            </h3>
            {subtitle && <p className="mt-1 text-[13px] text-muted-foreground">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="space-y-4 px-6 py-5 text-sm">{children}</div>

        {/* ── Footer ── */}
        {footer && (
          <div
            className={`rounded-b-2xl border-t border-border bg-white px-6 py-4 dark:bg-card ${stickyFooter ? "sticky bottom-0" : ""}`}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function Dialog(props: DialogProps) {
  return <Shell {...props} />;
}

/* Sticky-footer variant: header + footer pinned, body scrolls between them.
   Use for long create/edit forms where the action buttons must stay visible. */
export function DialogWithStickyFooter(props: DialogProps) {
  return <Shell {...props} stickyFooter />;
}

/* ----------------------------------------------------------------------------
 * Field system — sentence-case 13px semibold navy labels + optional helper.
 * -------------------------------------------------------------------------- */

export interface FieldProps {
  label: string;
  children: ReactNode;
  hint?: string;
  /** When true, the field spans the full body width (breaks out of any grid). */
  full?: boolean;
  className?: string;
}

export function Field({ label, children, hint, full = false, className = "" }: FieldProps) {
  return (
    <label
      className={`block text-[13px] font-semibold text-[#24425f] dark:text-foreground ${full ? "col-span-full" : ""} ${className}`}
    >
      <span className="mb-1.5 block">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs font-normal text-muted-foreground">{hint}</span>}
    </label>
  );
}

/* Section card — pale blue title bar like ui/ Order details / Order terms. */
export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[10px] border border-border bg-white dark:bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-[#e8f0f8] px-4 py-2.5 dark:bg-surface-active">
        <h4 className="text-[15px] font-bold text-[#0f2c4d] dark:text-foreground">{title}</h4>
        {action}
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </section>
  );
}

/* Order summary rail — sits beside Order lines, like the mockup. */
export function OrderSummary({ children }: { children: ReactNode }) {
  return (
    <aside className="h-fit rounded-[10px] border border-border bg-[#eef4fa] p-4 dark:bg-surface-active">
      <h4 className="text-[15px] font-bold text-[#0f2c4d] dark:text-foreground">Order summary</h4>
      <div className="mt-3 space-y-2 text-[13px]">{children}</div>
    </aside>
  );
}

/* Footer buttons — Cancel (ghost) / secondary (outline) / primary (blue). */
export function FooterButtons({
  onClose,
  secondary,
  primary,
  pending = false,
}: {
  onClose: () => void;
  secondary?: { label: string; onClick?: () => void; type?: "button" | "submit"; form?: string };
  primary: { label: string; onClick?: () => void; type?: "button" | "submit"; form?: string };
  pending?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <button
        type="button"
        onClick={onClose}
        className="btn-secondary"
      >
        Cancel
      </button>
      {secondary && (
        <button
          type={secondary.type ?? "button"}
          form={secondary.form}
          onClick={secondary.onClick}
          disabled={pending}
          className="btn-secondary disabled:opacity-60"
        >
          {secondary.label}
        </button>
      )}
      <button
        type={primary.type ?? "submit"}
        form={primary.form}
        onClick={primary.onClick}
        disabled={pending}
        className="btn-primary min-w-[180px] disabled:opacity-60"
      >
        {primary.label}
      </button>
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Standard input styles — used by every modal so field height/border/radius
 * are identical app-wide.
 * -------------------------------------------------------------------------- */

export const inputBase =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 dark:bg-input";

export const selectBase = `${inputBase} appearance-none bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22%236b7280%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M5.23%207.21a.75.75%200%20011.06.02L10%2011.168l3.71-3.938a.75.75%200%20111.08%201.04l-4.25%204.5a.75.75%200%2001-1.08%200l-4.25-4.5a.75.75%200%2001.02-1.06z%22%20clip-rule%3D%22evenodd%22%2F%3E%3C%2Fsvg%3E")] bg-[length:1.25rem_1.25rem] bg-[right_0.6rem_center] bg-no-repeat pr-9`;

export const textareaBase = `${inputBase} resize-y min-h-[2.5rem]`;

export const numberBase = `${inputBase} -moz-appearance:textfield`;

/* ----------------------------------------------------------------------------
 * Inline helper for two short fields side by side (e.g. ack no + ack date).
 * -------------------------------------------------------------------------- */

export function TwoFieldGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

/* ----------------------------------------------------------------------------
 * ModalShell — drop-in replacement for the homegrown shells in
 * dispatch-workflow.tsx and app.crm.tsx. Same API, Whizunik styling.
 * -------------------------------------------------------------------------- */

export function ModalShell({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Shell title={title} subtitle={subtitle} onClose={onClose} wide>
      {children}
    </Shell>
  );
}

/* ----------------------------------------------------------------------------
 * InfoPanelProps */
export interface InfoPanelProps {
  title?: string;
  children: ReactNode;
  tone?: "default" | "primary" | "success";
}
export function InfoPanel({ title, children, tone = "default" }: InfoPanelProps) {
  const base = "rounded-[10px] border p-3 text-xs space-y-1";
  const toneClass = {
    default: "border-border bg-white text-muted-foreground dark:bg-card",
    primary: "border-primary/30 bg-primary/5 text-foreground",
    success: "border-sem-success/30 bg-sem-success/5 text-foreground",
  }[tone];

  return (
    <div className={`${base} ${toneClass}`}>
      {title && <div className="uppercase tracking-widest text-muted-foreground">{title}</div>}
      {children}
    </div>
  );
}

export function AddLineTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-primary/50 px-3 py-1.5 text-[13px] font-semibold text-primary transition-colors hover:bg-primary-soft"
    >
      <Plus className="h-4 w-4" /> Add Line
    </button>
  );
}
