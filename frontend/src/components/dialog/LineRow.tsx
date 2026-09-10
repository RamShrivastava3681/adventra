import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Field, inputBase, selectBase } from "./index";
import { ProductVariantPicker } from "@/components/product-variant-picker";

/* Column blueprint (matches the 12-col grids already in the app).
   col-span-3  = SKU / Product
   col-span-1  = Unit
   col-span-1  = Qty field(s)
   col-span-2  = Unit price
   col-span-1  = Disc %
   col-span-1  = GST %
   col-span-2  = Line total (right aligned)
   col-span-1  = Remove button */
const COLS =
  "grid grid-cols-12 gap-2 text-[9px] uppercase tracking-widest text-muted-foreground md:grid";

const HEADERS = [
  { span: 3, label: "SKU / Product" },
  { span: 1, label: "Unit" },
  { span: 1, label: "Qty" },
  { span: 2, label: "Unit price" },
  { span: 1, label: "Disc %" },
  { span: 1, label: "GST %" },
  { span: 2, label: "Line total", right: true },
  { span: 1, label: "" },
];

interface LineRowProps {
  i: number;
  name: string | null;
  sku?: string | null;
  children: ReactNode;
  onRemove: () => void;
}

export function LineHeaders() {
  return (
    <div className="hidden grid-cols-12 gap-2 text-[9px] uppercase tracking-widest text-muted-foreground md:grid">
      {HEADERS.map((h) => (
        <div
          key={h.label}
          className={`${h.right ? "text-right" : ""}`}
          style={{ gridColumn: `span ${h.span}` }}
        >
          {h.label}
        </div>
      ))}
    </div>
  );
}

export function LineRow({
  i,
  name,
  sku,
  children,
  onRemove,
}: LineRowProps) {
  return (
    <div className="grid grid-cols-2 items-end gap-2 rounded-md border border-border/50 p-2 md:grid-cols-12">
      {/* Product selector — spans 3 cols on desktop, full width on mobile */}
      <div className="col-span-2 md:col-span-3">
        <Field label="Product">
          <ProductVariantPicker
            products={[] as any}
            value=""
            onChange={() => {}}
            className={inputBase}
          />
        </Field>
        {/* Subtitle line showing name + sku/mrp snapshot */}
        {name && <div className="mt-0.5 text-[10px] text-muted-foreground">{name}</div>}
      </div>

      {/* Unit */}
      <div className="col-span-1">
        <Field label="Unit">
          <input className={inputBase} type="text" />
        </Field>
      </div>

      {/* Quantity */}
      <div className="col-span-1">
        <Field label="Qty">
          <input className={inputBase} type="number" min="0" step="0.001" />
        </Field>
      </div>

      {/* Unit price */}
      <div className="col-span-2">
        <Field label="Unit price">
          <input className={inputBase} type="number" min="0" step="0.01" />
        </Field>
      </div>

      {/* Discount % */}
      <div className="col-span-1">
        <Field label="Disc %">
          <input className={inputBase} type="number" min="0" max="100" step="0.01" />
        </Field>
      </div>

      {/* GST % */}
      <div className="col-span-1">
        <Field label="GST %">
          <input className={inputBase} type="number" min="0" step="0.01" />
        </Field>
      </div>

      {/* Line total */}
      <div className="col-span-2 text-right">
        <Field label="Line total">
          <div className="inp text-right font-mono tabular-nums">₹0.00</div>
        </Field>
      </div>

      {/* Remove */}
      <div className="col-span-1 flex items-end justify-end pb-1">
        <button
          type="button"
          onClick={onRemove}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
          aria-label="Remove line"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Extra children (e.g. variant snapshot chips) are placed inline if provided */}
      {children}
    </div>
  );
}

/* A line edit block that matches the shared grid but lets the caller supply
   the real field contents. Use when a modal's line needs custom fields
   (e.g. invoice lines with invoice_qty/ordered/GRN recv). */
export function LineEditBlock({
  i,
  name,
  sku,
  fields,
  onRemove,
}: {
  i: number;
  name: string | null;
  sku?: string | null;
  fields: ReactNode;
  onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-2 items-end gap-2 rounded-md border border-border/50 p-2 md:grid-cols-12">
      <div className="col-span-2 md:col-span-3">
        <div className="text-xs font-medium">{name ?? "Product"}</div>
        {sku && <div className="font-mono text-[10px] text-muted-foreground">{sku}</div>}
      </div>
      {fields}
      <div className="col-span-1 flex items-end justify-end pb-1">
        <button
          type="button"
          onClick={onRemove}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
          aria-label="Remove line"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/* Add-line button — consistent copy/spacing across every modal. */
export interface AddLineButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

export function AddLineButton({ onClick, disabled = false }: AddLineButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
    >
      <svg
        className="h-3.5 w-3.5"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <path d="M8 3v10M3 8h10" strokeLinecap="round" />
      </svg>
      Add line
    </button>
  );
}
