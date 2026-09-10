import { X } from "lucide-react";
import type { ReactNode } from "react";

/* ----------------------------------------------------------------------------
 * Shared modal shell
 *
 * Every modal in the app should use this so header, body, and footer share
 * the same sizing, spacing, and sticky behaviour. The body scrolls when
 * content is long while the header and (optional) footer stay visible.
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

export function Dialog({
  onClose,
  title,
  subtitle,
  children,
  footer,
  wide = false,
  maxHeight = "max-h-[92vh]",
}: DialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`[&_fieldset]:m-0 [&_fieldset_p]:-mt-0 w-full overflow-y-auto rounded-xl border border-border bg-card shadow-vault ${wide ? "max-w-3xl" : "max-w-lg"} ${maxHeight}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Sticky header ──────────────────────────────────────────── */}
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-border bg-card px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-lg leading-tight">{title}</h3>
            {subtitle && (
              <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Scrollable body ────────────────────────────────────────── */}
        <div className="p-5 text-sm">{children}</div>

        {/* ── Footer (kept at the bottom when body is short; otherwise
            it sits after the body. Use stickyFooter when the form is long.) ── */}
        {footer && (
          <div className="border-t border-border px-5 py-3">{footer}</div>
        )}
      </div>
    </div>
  );
}

/* Sticky-footer variant: header + footer pinned, body scrolls between them.
   Use for long create/edit forms where the action buttons must stay visible. */
export function DialogWithStickyFooter({
  onClose,
  title,
  subtitle,
  children,
  footer,
  wide = false,
}: DialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`[&_fieldset]:m-0 [&_fieldset_p]:-mt-0 w-full overflow-y-auto rounded-xl border border-border bg-card shadow-vault ${wide ? "max-w-3xl" : "max-w-lg"} max-h-[92vh]`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header */}
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-border bg-card px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-lg leading-tight">{title}</h3>
            {subtitle && (
              <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable body — padded so content doesn't run under the footer */}
        <div className="p-5 text-sm">{children}</div>

        {/* Sticky footer */}
        <div className="sticky bottom-0 border-t border-border bg-card px-5 py-3">
          {footer}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Field system
 *
 * One label + one control per field, consistent vertical rhythm. Use the
 * `grid` props on the parent to lay fields out in columns; the field itself
 * always occupies a full grid column.
 * -------------------------------------------------------------------------- */

export interface FieldProps {
  label: string;
  children: ReactNode;
  /** When true, the field spans the full body width (breaks out of any grid). */
  full?: boolean;
  className?: string;
}

export function Field({ label, children, full = false, className = "" }: FieldProps) {
  return (
    <label
      className={`block text-xs uppercase tracking-widest text-muted-foreground ${full ? "col-span-full" : ""} ${className}`}
    >
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

/* ----------------------------------------------------------------------------
 * Standard input styles — used by every modal so field height/border/radius
 * are identical app-wide. The existing `.inp` global rule is kept as a
 * fallback; these classes mirror it so we can phase the global rule out
 * later without changing any modal.
 * -------------------------------------------------------------------------- */

export const inputBase =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25";

export const selectBase = `${inputBase} appearance-none bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22%236b7280%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M5.23%207.21a.75.75%200%20011.06.02L10%2011.168l3.71-3.938a.75.75%200%20111.08%201.04l-4.25%204.5a.75.75%200%2001-1.08%200l-4.25-4.5a.75.75%200%2001.02-1.06z%22%20clip-rule%3D%22evenodd%22%2F%3E%3C%2Fsvg%3E")] bg-[length:1.25rem_1.25rem] bg-[right_0.6rem_center] bg-no-repeat pr-9`;

export const textareaBase = `${inputBase} resize-y min-h-[2.5rem]`;

export const numberBase = `${inputBase} -moz-appearance:textfield`;

/* ----------------------------------------------------------------------------
 * Inline helper for two short fields side by side (e.g. ack no + ack date).
 * Both fields get equal width and consistent height.
 * -------------------------------------------------------------------------- */

export function TwoFieldGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {children}
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Small helper: a flush "info" block used by the invoice/purchase advance
 * panels so those panels render with the same padding rhythm as the rest.
 * -------------------------------------------------------------------------- */

/* ----------------------------------------------------------------------------
 * ModalShell — drop-in replacement for the homegrown shells in
 * dispatch-workflow.tsx and app.crm.tsx. Same API (title, subtitle, onClose,
 * children) but consistent max-width, header padding, and body padding.
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
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card shadow-vault"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 border-b border-border bg-card px-5 py-3.5">
          <h3 className="font-display text-lg">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="p-5 text-sm">{children}</div>
      </div>
    </div>
  );
}/* ----------------------------------------------------------------------------
 * InfoPanelProps */
export interface InfoPanelProps {
  title?: string;
  children: ReactNode;
  tone?: "default" | "primary" | "success";
}
export function InfoPanel({ title, children, tone = "default" }: InfoPanelProps) {
  const base =
    "rounded-md border p-3 text-xs space-y-1";
  const toneClass = {
    default: "border-border bg-background/40 text-muted-foreground",
    primary: "border-primary/30 bg-primary/5 text-foreground",
    success: "border-sem-success/30 bg-sem-success/5 text-foreground",
  }[tone];

  return (
    <div className={`${base} ${toneClass}`}>
      {title && (
        <div className="uppercase tracking-widest text-muted-foreground">{title}</div>
      )}
      {children}
    </div>
  );
}
