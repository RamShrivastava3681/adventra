import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import api from "@/lib/api-client";
import { Layers, Loader2, X } from "lucide-react";
import { toast } from "sonner";

/**
 * Shape of a catalogue product as returned by the API (snake_case — the
 * backend transform middleware shapes responses). Only the fields a document
 * line needs to snapshot from a freshly created SKU.
 */
export type QuickCreatedProduct = {
  id: string;
  sku: string | null;
  name: string;
  unit_of_measure: string | null;
  unit_cost: number | null;
  unit_price: number | null;
  gst_rate: number | null;
  parent_id: string | null;
  color: string | null;
  size: string | null;
};

const UNITS_OF_MEASURE = [
  "piece",
  "pair",
  "carton",
  "box",
  "dozen",
  "set",
  "kg",
  "g",
  "litre",
  "ml",
  "metre",
  "bottle",
  "pack",
];

const GST_RATES = ["", "0", "5", "12", "18", "28"];

const INP_STYLES = `.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`;

function numOrNull(s: string): number | null {
  if (s === "" || s === null || s === undefined) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Refresh every catalogue-derived query after a product/variant is created. */
function invalidateCatalogue(qc: ReturnType<typeof useQueryClient>) {
  for (const key of ["products", "products-for-po", "products-inventory", "products-forecast"]) {
    qc.invalidateQueries({ queryKey: [key] });
  }
}

/**
 * QuickCreateProductModal — create a catalogue item from inside a document
 * (e.g. a purchase order's line editor) without visiting the Product
 * catalogue tab. A trimmed-down catalogue form: SKU, name, unit, and the
 * full price/cost set (cost, unit price, MRP, e-commerce, retailer,
 * distributor, flexible) plus GST.
 */
export function QuickCreateProductModal({
  userId,
  onClose,
  onCreated,
}: {
  userId: string;
  onClose: () => void;
  /** Fired with the freshly created catalogue product before the modal closes. */
  onCreated: (product: QuickCreatedProduct) => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    sku: "",
    name: "",
    unit_of_measure: "piece",
    unit_cost: "",
    unit_price: "",
    mrp: "",
    ecommerce_price: "",
    retailer_price: "",
    distributor_price: "",
    flexible_price: "",
    gst_rate: "",
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!f.name.trim()) throw new Error("Product name is required");
      return (await api.products.create({
        client_id: userId,
        sku: f.sku.trim() || undefined,
        name: f.name.trim(),
        unit_of_measure: f.unit_of_measure || "piece",
        unit_cost: numOrNull(f.unit_cost) ?? 0,
        unit_price: numOrNull(f.unit_price) ?? 0,
        mrp: numOrNull(f.mrp),
        ecommerce_price: numOrNull(f.ecommerce_price),
        retailer_price: numOrNull(f.retailer_price),
        distributor_price: numOrNull(f.distributor_price),
        flexible_price: numOrNull(f.flexible_price),
        gst_rate: numOrNull(f.gst_rate),
        status: "active",
      })) as QuickCreatedProduct;
    },
    onSuccess: (created) => {
      invalidateCatalogue(qc);
      toast.success(`${created.sku ?? created.name} added to the catalogue`);
      onCreated(created);
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to create product"),
  });

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div>
            <h3 className="font-display text-lg">New catalogue item</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Create the product here — it is added to the catalogue and selected on this line.
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="mt-4 space-y-4"
        >
          <fieldset className="rounded-lg border border-border/60 p-4">
            <legend className="px-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Item
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <L label="Product name *">
                <input
                  className="inp"
                  value={f.name}
                  onChange={(e) => setF({ ...f, name: e.target.value })}
                  placeholder="e.g. Running Shoe"
                  autoFocus
                />
              </L>
              <L label="SKU (optional — auto-generated if blank)">
                <input
                  className="inp"
                  value={f.sku}
                  onChange={(e) => setF({ ...f, sku: e.target.value })}
                  placeholder="e.g. RUN-100"
                />
              </L>
              <L label="Unit of measure">
                <select
                  className="inp"
                  value={f.unit_of_measure}
                  onChange={(e) => setF({ ...f, unit_of_measure: e.target.value })}
                >
                  {UNITS_OF_MEASURE.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </L>
              <L label="GST %">
                <select
                  className="inp"
                  value={f.gst_rate}
                  onChange={(e) => setF({ ...f, gst_rate: e.target.value })}
                >
                  {GST_RATES.map((r) => (
                    <option key={r} value={r}>
                      {r === "" ? "Not set" : `${r}%`}
                    </option>
                  ))}
                </select>
              </L>
            </div>
          </fieldset>

          <fieldset className="rounded-lg border border-border/60 p-4">
            <legend className="px-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Cost &amp; prices
            </legend>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <L label="Cost (purchase)">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="inp"
                  value={f.unit_cost}
                  onChange={(e) => setF({ ...f, unit_cost: e.target.value })}
                  placeholder="0.00"
                />
              </L>
              <L label="Unit price (default)">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="inp"
                  value={f.unit_price}
                  onChange={(e) => setF({ ...f, unit_price: e.target.value })}
                  placeholder="0.00"
                />
              </L>
              <L label="MRP">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="inp"
                  value={f.mrp}
                  onChange={(e) => setF({ ...f, mrp: e.target.value })}
                  placeholder="0.00"
                />
              </L>
              <L label="E-commerce price">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="inp"
                  value={f.ecommerce_price}
                  onChange={(e) => setF({ ...f, ecommerce_price: e.target.value })}
                  placeholder="0.00"
                />
              </L>
              <L label="Retailer price">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="inp"
                  value={f.retailer_price}
                  onChange={(e) => setF({ ...f, retailer_price: e.target.value })}
                  placeholder="0.00"
                />
              </L>
              <L label="Distributor price">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="inp"
                  value={f.distributor_price}
                  onChange={(e) => setF({ ...f, distributor_price: e.target.value })}
                  placeholder="0.00"
                />
              </L>
              <L label="Flexible price">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="inp"
                  value={f.flexible_price}
                  onChange={(e) => setF({ ...f, flexible_price: e.target.value })}
                  placeholder="0.00"
                />
              </L>
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              Leave any price blank if it isn&apos;t decided yet — you can still override the price
              on the document line.
            </p>
          </fieldset>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              disabled={save.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Create item
            </button>
          </div>
        </form>
        <style>{INP_STYLES}</style>
      </div>
    </div>
  );
}

/**
 * QuickAddVariantModal — add a colour/size variant SKU under a parent product
 * from inside a document. Pricing, cost, tax and supplier are inherited from
 * the parent server-side; only colour, size and an optional SKU are asked for.
 */
export function QuickAddVariantModal({
  parent,
  onClose,
  onCreated,
}: {
  parent: { id: string; sku: string | null; name: string };
  onClose: () => void;
  /** Fired with the freshly created variant before the modal closes. */
  onCreated: (variant: QuickCreatedProduct) => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState({ color: "", size: "", sku: "" });

  const save = useMutation({
    mutationFn: async () => {
      const color = f.color.trim() || null;
      const size = f.size.trim() || null;
      if (!color && !size) throw new Error("Enter a colour or a size for this variant");
      return (await api.products.create({
        parent_id: parent.id,
        color,
        size,
        sku: f.sku.trim() || undefined,
      })) as QuickCreatedProduct;
    },
    onSuccess: (created) => {
      invalidateCatalogue(qc);
      toast.success(`${created.sku ?? created.name} variant added`);
      onCreated(created);
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to create variant"),
  });

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div>
            <h3 className="font-display text-lg">Add colour/size variant</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Parent <span className="font-mono font-medium text-foreground">{parent.sku}</span> ·{" "}
              {parent.name}
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="mt-4 space-y-3"
        >
          <div className="grid grid-cols-2 gap-3">
            <L label="Colour">
              <input
                className="inp"
                value={f.color}
                onChange={(e) => setF({ ...f, color: e.target.value })}
                placeholder="e.g. Black"
                autoFocus
              />
            </L>
            <L label="Size">
              <input
                className="inp"
                value={f.size}
                onChange={(e) => setF({ ...f, size: e.target.value })}
                placeholder="e.g. M, 42, XL"
              />
            </L>
          </div>
          <L label="SKU (optional — auto-generated from parent, colour & size)">
            <input
              className="inp"
              value={f.sku}
              onChange={(e) => setF({ ...f, sku: e.target.value })}
              placeholder={`e.g. ${parent.sku}-BLACK-42`}
            />
          </L>
          <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
            <Layers className="mb-1 h-3.5 w-3.5 text-primary" />
            Prices, cost, GST, supplier and image are inherited from the parent{" "}
            <span className="font-mono">{parent.sku}</span> — only colour and size define this SKU.
            Leave the SKU blank to auto-generate it.
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              disabled={save.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Create variant
            </button>
          </div>
        </form>
        <style>{INP_STYLES}</style>
      </div>
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
