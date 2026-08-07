import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney } from "@/components/ledger-ui";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ProductThumb } from "@/components/product-thumb";
import { useSignedImageUrl, s3KeyFromUrl } from "@/lib/s3-image";
import {
  Plus,
  X,
  Loader2,
  Search,
  Trash2,
  Pencil,
  Package,
  ImagePlus,
  Image as ImageIcon,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

const API_URL = import.meta.env.VITE_API_URL || "/api";

export const Route = createFileRoute("/app/products")({
  component: ProductsPage,
});

type Product = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  category: string | null;
  subcategory: string | null;
  gender: string | null;
  brand: string | null;
  size: string | null;
  color: string | null;
  model: string | null;
  unit_of_measure: string;
  season: string;
  barcode: string | null;
  barcode_type: string | null;
  units_per_carton: number | null;
  unit_price: number;
  unit_cost: number;
  mrp: number | null;
  minimum_gross_margin_percentage: number | null;
  reorder_level: number;
  max_stock: number;
  lead_time_days: number;
  safety_stock_days: number;
  supplier_id: string | null;
  supplier_product_code: string | null;
  minimum_order_quantity: number | null;
  order_multiple: number | null;
  hsn_code: string | null;
  gst_rate: number | null;
  image_url: string | null;
  status: string;
};

const GENDERS = ["mens", "womens", "kids", "unisex"];
const SEASONS = ["all", "spring", "summer", "fall", "winter"];
const CATEGORIES = ["Footwear", "Apparel", "Accessories", "Equipment", "Nutrition"];
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
const BARCODE_TYPES = ["", "EAN-13", "UPC-A", "EAN-8", "Code 128", "QR", "ITF-14"];
const GST_RATES = ["", "0", "5", "12", "18", "28"];

function ProductsPage() {
  const { user, isAdmin, isSalesRep } = useAuth();
  const canWrite = !isSalesRep && !!user;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [deleting, setDeleting] = useState<Product | null>(null);

  const productsQ = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const data = (await api.products.list()) as Product[];
      return data.sort((a, b) => a.sku?.localeCompare(b.sku ?? "") ?? 0);
    },
  });

  // Preferred-supplier picker for the catalogue form's Buying details section.
  const suppliersQ = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => api.suppliers.list(),
  });

  // Catalogue-wide default minimum margin — used by products without their own.
  const catalogueSettingsQ = useQuery({
    queryKey: ["catalogue-settings"],
    queryFn: async () => api.catalogueSettings.get(),
  });
  const defaultMargin = catalogueSettingsQ.data?.default_minimum_margin ?? 0.4;

  const [marginInput, setMarginInput] = useState("");
  const marginDirtyRef = useRef(false);
  useEffect(() => {
    // Don't clobber what the user is typing while settings are still loading.
    if (marginDirtyRef.current) return;
    setMarginInput(String(Math.round(defaultMargin * 100)));
  }, [defaultMargin]);

  const saveMargin = useMutation({
    mutationFn: async () => {
      await api.catalogueSettings.update({
        default_minimum_margin: (Number(marginInput) || 40) / 100,
      });
    },
    onSuccess: () => {
      // Margin affects every product's floor price — refresh the catalogue and
      // the forecast page (which recomputes pricing strategy per SKU).
      qc.invalidateQueries({ queryKey: ["catalogue-settings"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["products-forecast"] });
      toast.success("Default margin saved");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to save default margin"),
  });

  // Stock lookup per product (display only — stock itself lives in Inventory,
  // never in the catalogue definition).
  const movementsQ = useQuery({
    queryKey: ["stock_movements_all"],
    queryFn: async () => {
      const data = await api.stockMovements.list();
      // Live stock counts CONFIRMED movements only (drafts/cancelled don't move stock)
      return data
        .filter((m: any) => (m.status ?? "confirmed") === "confirmed")
        .map(
          (m: {
            productId?: string;
            product_id?: string;
            direction?: string;
            quantity?: number;
          }) => ({
            product_id: m.productId ?? m.product_id ?? null,
            direction: m.direction ?? "",
            quantity: m.quantity ?? 0,
          }),
        );
    },
  });

  const stockByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of movementsQ.data ?? []) {
      if (!r.product_id) continue;
      const sign = r.direction === "in" ? 1 : -1;
      m.set(r.product_id, (m.get(r.product_id) ?? 0) + sign * Number(r.quantity));
    }
    return m;
  }, [movementsQ.data]);

  const rows = (productsQ.data ?? []).filter((p) => {
    const matchQ =
      !q ||
      p.sku.toLowerCase().includes(q.toLowerCase()) ||
      p.name.toLowerCase().includes(q.toLowerCase()) ||
      (p.brand ?? "").toLowerCase().includes(q.toLowerCase()) ||
      (p.model ?? "").toLowerCase().includes(q.toLowerCase()) ||
      (p.color ?? "").toLowerCase().includes(q.toLowerCase()) ||
      (p.barcode ?? "").toLowerCase().includes(q.toLowerCase());
    const matchC = cat === "all" || p.category === cat;
    return matchQ && matchC;
  });

  const del = useMutation({
    mutationFn: async (p: Product) => {
      await api.products.delete(p.id);
    },
    onSuccess: () => {
      // The product's stock movements, forecasts and catalogue record are gone
      // too — refresh every surface that shows them.
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["products-forecast"] });
      qc.invalidateQueries({ queryKey: ["products-inventory"] });
      qc.invalidateQueries({ queryKey: ["stock_movements"] });
      qc.invalidateQueries({ queryKey: ["stock_movements_all"] });
      qc.invalidateQueries({ queryKey: ["movements-forecast"] });
      qc.invalidateQueries({ queryKey: ["forecast-variables"] });
      toast.success("Product and its inventory entries deleted");
      setDeleting(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const summary = useMemo(() => {
    const total = productsQ.data?.length ?? 0;
    let active = 0,
      low = 0,
      out = 0,
      inventoryValue = 0;
    for (const p of (productsQ.data ?? []) as Product[]) {
      if (p.status === "active") active++;
      const stock = stockByProduct.get(p.id) ?? 0;
      inventoryValue += stock * Number(p.unit_cost);
      if (stock <= 0) out++;
      else if (stock <= p.reorder_level) low++;
    }
    return { total, active, low, out, inventoryValue };
  }, [productsQ.data, stockByProduct]);

  return (
    <div>
      <PageHeader
        eyebrow="Catalog"
        title="Products & SKUs"
        description="Master catalog of every SKU you sell. The catalogue only defines the product — stock, sales and purchases hang off the SKU elsewhere."
        breadcrumbs={[{ label: "Dashboard", href: "/app/dashboard" }, { label: "Catalog" }]}
        actions={
          canWrite ? (
            <button
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              <Plus className="h-4 w-4" /> New product
            </button>
          ) : (
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              Read-only
            </span>
          )
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatTile label="SKUs" value={summary.total} />
          <StatTile label="Active" value={summary.active} tone="success" />
          <StatTile label="Low stock" value={summary.low} tone="warning" />
          <StatTile label="Out of stock" value={summary.out} tone="destructive" />
          <StatTile label="Inventory value" value={fmtMoney(summary.inventoryValue)} />
        </div>

        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search SKU, name, brand, model, color, barcode…"
                className="w-full rounded-md border border-border bg-input px-9 py-2 text-sm"
              />
            </div>
            <select
              value={cat}
              onChange={(e) => setCat(e.target.value)}
              className="rounded-md border border-border bg-input px-3 py-2 text-sm"
            >
              <option value="all">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <div className="text-xs text-muted-foreground">{rows.length} shown</div>
            <div className="ml-auto flex items-end gap-2">
              {canWrite ? (
                <>
                  <label className="block">
                    <span className="mb-1 block text-[9px] uppercase tracking-widest text-muted-foreground">
                      Default margin (%)
                    </span>
                    <input
                      type="number"
                      step="0.5"
                      min="1"
                      max="99"
                      value={marginInput}
                      onChange={(e) => {
                        marginDirtyRef.current = true;
                        setMarginInput(e.target.value);
                      }}
                      className="w-20 rounded-md border border-border bg-input px-2.5 py-2 text-sm outline-none transition-all focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
                    />
                  </label>
                  <button
                    onClick={() => saveMargin.mutate()}
                    disabled={saveMargin.isPending}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-2 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-border hover:bg-muted/30 transition-all duration-200 disabled:opacity-50"
                  >
                    {saveMargin.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                    {saveMargin.isPending ? "Saving…" : "Save"}
                  </button>
                </>
              ) : (
                <span className="text-[11px] text-muted-foreground">
                  Default margin: {Math.round(defaultMargin * 100)}%
                </span>
              )}
            </div>
          </div>
        </Card>

        <Card title="Catalog">
          {productsQ.isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              <Package className="mx-auto mb-2 h-8 w-8 opacity-40" />
              No products yet.
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">SKU</th>
                    <th className="px-5 py-2 text-left font-normal">Product</th>
                    <th className="px-5 py-2 text-left font-normal">Attrs</th>
                    <th className="px-5 py-2 text-right font-normal">MRP</th>
                    <th className="px-5 py-2 text-right font-normal">Price</th>
                    <th className="px-5 py-2 text-right font-normal">Cost</th>
                    <th className="px-5 py-2 text-right font-normal">On hand</th>
                    <th className="px-5 py-2 text-right font-normal">Status</th>
                    <th className="px-5 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const stock = stockByProduct.get(p.id) ?? 0;
                    const low = stock <= p.reorder_level && stock > 0;
                    const out = stock <= 0;
                    return (
                      <tr key={p.id} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2.5">
                            <ProductThumb imageUrl={p.image_url} name={p.name} />
                            <span className="font-mono text-xs">{p.sku}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <div className="font-medium">{p.name}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {[p.category, p.subcategory, p.brand].filter(Boolean).join(" · ") ||
                              "—"}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-xs text-muted-foreground">
                          {[
                            p.model,
                            p.gender,
                            p.size,
                            p.color,
                            p.season !== "all" ? p.season : null,
                            p.unit_of_measure !== "piece" ? p.unit_of_measure : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </td>
                        <td className="px-5 py-3 text-right num text-muted-foreground">
                          {p.mrp ? fmtMoney(p.mrp) : "—"}
                        </td>
                        <td className="px-5 py-3 text-right num">{fmtMoney(p.unit_price)}</td>
                        <td className="px-5 py-3 text-right num text-muted-foreground">
                          {fmtMoney(p.unit_cost)}
                        </td>
                        <td
                          className={`px-5 py-3 text-right num ${out ? "text-destructive" : low ? "text-warning" : ""}`}
                        >
                          {stock.toLocaleString()}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {out ? (
                            <Pill tone="destructive">Out</Pill>
                          ) : low ? (
                            <Pill tone="warning">Low</Pill>
                          ) : (
                            <Pill tone="success">OK</Pill>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {canWrite && (
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => {
                                  setEditing(p);
                                  setOpen(true);
                                }}
                                className="text-muted-foreground hover:text-foreground"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => setDeleting(p)}
                                title="Delete product & its inventory entries"
                                className="text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {open && user && (
        <ProductModal
          userId={user.id}
          product={editing}
          defaultMargin={defaultMargin}
          suppliers={suppliersQ.data ?? []}
          onClose={() => setOpen(false)}
        />
      )}
      {deleting && (
        <ConfirmProductDelete
          product={deleting}
          movementCount={
            (movementsQ.data ?? []).filter((m: any) => m.product_id === deleting.id).length
          }
          onClose={() => setDeleting(null)}
          onConfirm={() => del.mutate(deleting)}
          pending={del.isPending}
        />
      )}
    </div>
  );
}

function ConfirmProductDelete({
  product,
  movementCount,
  onClose,
  onConfirm,
  pending,
}: {
  product: Product;
  movementCount: number;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-card p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-lg">Delete {product.name}?</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          This permanently removes{" "}
          <span className="font-medium text-foreground">{product.sku}</span> from the catalogue
          {movementCount > 0 ? (
            <>
              , along with its{" "}
              <span className="font-medium text-foreground">
                {movementCount} stock movement{movementCount === 1 ? "" : "s"}
              </span>{" "}
              and forecast entries
            </>
          ) : (
            " and its forecast entries"
          )}
          . Invoices, orders and receipts keep their records.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-border px-4 py-2 text-sm transition hover:bg-muted/40"
          >
            Keep
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-white transition hover:bg-destructive/90 disabled:opacity-60"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Delete product
          </button>
        </div>
      </div>
    </div>
  );
}

// Margin is stored as a decimal (0.4 = 40%) but edited as a percent (40).
// Legacy records may hold a raw percent (e.g. 40) — normalize those too.
function marginStoredToPercent(v: number | null | undefined): string {
  const n = Number(v ?? 0.4) || 0.4;
  const pct = n > 1 ? n : n * 100;
  return String(Math.round(pct * 100) / 100);
}

function numOrNull(s: string): number | null {
  if (s === "" || s === null || s === undefined) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function ProductModal({
  userId,
  product,
  defaultMargin,
  suppliers,
  onClose,
}: {
  userId: string;
  product: Product | null;
  defaultMargin: number;
  suppliers: Array<{ id: string; company_name?: string; companyName?: string }>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!product;
  const legacyStatus =
    product?.status === "discontinued" ? "inactive" : (product?.status ?? "active");
  const [f, setF] = useState({
    sku: product?.sku ?? "",
    name: product?.name ?? "",
    description: product?.description ?? "",
    category: product?.category ?? "",
    subcategory: product?.subcategory ?? "",
    gender: product?.gender ?? "unisex",
    brand: product?.brand ?? "",
    size: product?.size ?? "",
    color: product?.color ?? "",
    model: product?.model ?? "",
    unit_of_measure: product?.unit_of_measure ?? "piece",
    season: product?.season ?? "all",
    barcode: product?.barcode ?? "",
    barcode_type: product?.barcode_type ?? "",
    units_per_carton: product?.units_per_carton != null ? String(product.units_per_carton) : "",
    unit_price: String(product?.unit_price ?? ""),
    unit_cost: String(product?.unit_cost ?? ""),
    mrp: product?.mrp != null ? String(product.mrp) : "",
    minimum_gross_margin_percentage: marginStoredToPercent(
      product?.minimum_gross_margin_percentage ?? defaultMargin,
    ),
    lead_time_days: String(product?.lead_time_days ?? "30"),
    safety_stock_days: String(product?.safety_stock_days ?? "30"),
    supplier_id: product?.supplier_id ?? "",
    supplier_product_code: product?.supplier_product_code ?? "",
    minimum_order_quantity:
      product?.minimum_order_quantity != null ? String(product.minimum_order_quantity) : "",
    order_multiple: product?.order_multiple != null ? String(product.order_multiple) : "",
    hsn_code: product?.hsn_code ?? "",
    gst_rate: product?.gst_rate != null ? String(product.gst_rate) : "",
    image_url: product?.image_url ?? "",
    status: legacyStatus,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!f.name.trim()) throw new Error("Name required");
      const payload = {
        client_id: userId,
        sku: f.sku || undefined,
        name: f.name.trim(),
        description: f.description.trim() || null,
        category: f.category || null,
        subcategory: f.subcategory || null,
        gender: f.gender || null,
        brand: f.brand.trim() || null,
        size: f.size || null,
        color: f.color || null,
        model: f.model.trim() || null,
        unit_of_measure: f.unit_of_measure || "piece",
        season: f.season,
        barcode: f.barcode.trim() || null,
        barcode_type: f.barcode_type || null,
        units_per_carton: numOrNull(f.units_per_carton),
        unit_price: Number(f.unit_price) || 0,
        unit_cost: Number(f.unit_cost) || 0,
        mrp: numOrNull(f.mrp),
        minimum_gross_margin_percentage: Math.min(
          0.99,
          Math.max(0.01, (Number(f.minimum_gross_margin_percentage) || 40) / 100),
        ),
        // Hidden infra field (not part of the catalogue form) — preserved on
        // edit so low-stock indicators keep working without being clobbered.
        reorder_level: product?.reorder_level ?? 10,
        lead_time_days: Number(f.lead_time_days) || 30,
        safety_stock_days: Number(f.safety_stock_days) || 30,
        supplier_id: f.supplier_id || null,
        supplier_product_code: f.supplier_product_code.trim() || null,
        minimum_order_quantity: numOrNull(f.minimum_order_quantity),
        order_multiple: numOrNull(f.order_multiple),
        hsn_code: f.hsn_code.trim() || null,
        gst_rate: numOrNull(f.gst_rate),
        image_url: f.image_url || null,
        status: f.status,
      };
      if (isEdit && product) {
        await api.products.update(product.id, payload);
      } else {
        await api.products.create(payload);
      }
    },
    onSuccess: () => {
      // Invalidate both keys so the Products page AND the forecast page
      // (which recomputes pricing strategy from unit cost / margin) stay in sync.
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["products-forecast"] });
      // Inventory shows product thumbnails — keep those fresh too.
      qc.invalidateQueries({ queryKey: ["products-inventory"] });
      toast.success(isEdit ? "Updated" : "Created");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">{isEdit ? "Edit product" : "New product"}</h3>
          <button onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-5 p-5"
        >
          <Section title="Basic product details" step="1">
            <div className="grid grid-cols-2 gap-3">
              <L label="SKU (auto if blank)">
                <input
                  className="inp"
                  value={f.sku}
                  onChange={(e) => setF({ ...f, sku: e.target.value })}
                  placeholder="Auto-generated if left blank"
                />
              </L>
              <L label="Product name *">
                <input
                  required
                  className="inp"
                  value={f.name}
                  onChange={(e) => setF({ ...f, name: e.target.value })}
                />
              </L>
              <L label="Category">
                <select
                  className="inp"
                  value={f.category}
                  onChange={(e) => setF({ ...f, category: e.target.value })}
                >
                  <option value="">—</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </L>
              <L label="Brand">
                <input
                  className="inp"
                  value={f.brand}
                  onChange={(e) => setF({ ...f, brand: e.target.value })}
                  placeholder="e.g. Nike"
                />
              </L>
              <L label="Status">
                <select
                  className="inp"
                  value={f.status}
                  onChange={(e) => setF({ ...f, status: e.target.value })}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </L>
            </div>
            <L label="Product description">
              <textarea
                rows={2}
                className="inp resize-y"
                value={f.description}
                onChange={(e) => setF({ ...f, description: e.target.value })}
                placeholder="Short description of the product…"
              />
            </L>
            <L label="Product image">
              <ImageField
                userId={userId}
                value={f.image_url}
                onChange={(url) => setF({ ...f, image_url: url })}
              />
            </L>
          </Section>

          <Section title="Variant details" step="2">
            <div className="grid grid-cols-2 gap-3">
              <L label="Size">
                <input
                  className="inp"
                  value={f.size}
                  onChange={(e) => setF({ ...f, size: e.target.value })}
                  placeholder="e.g. M, 42, XL"
                />
              </L>
              <L label="Colour">
                <input
                  className="inp"
                  value={f.color}
                  onChange={(e) => setF({ ...f, color: e.target.value })}
                  placeholder="e.g. Black"
                />
              </L>
              <L label="Model / variant">
                <input
                  className="inp"
                  value={f.model}
                  onChange={(e) => setF({ ...f, model: e.target.value })}
                  placeholder="e.g. Airmax-2024"
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
              <L label="Subcategory">
                <input
                  className="inp"
                  value={f.subcategory}
                  onChange={(e) => setF({ ...f, subcategory: e.target.value })}
                  placeholder="e.g. Running shoes"
                />
              </L>
              <L label="Gender">
                <select
                  className="inp"
                  value={f.gender}
                  onChange={(e) => setF({ ...f, gender: e.target.value })}
                >
                  {GENDERS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </L>
              <L label="Season">
                <select
                  className="inp"
                  value={f.season}
                  onChange={(e) => setF({ ...f, season: e.target.value })}
                >
                  {SEASONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </L>
            </div>
          </Section>

          <Section title="Barcode details" step="3">
            <div className="grid grid-cols-2 gap-3">
              <L label="Barcode number">
                <input
                  className="inp"
                  value={f.barcode}
                  onChange={(e) => setF({ ...f, barcode: e.target.value })}
                  placeholder="EAN / UPC number"
                />
              </L>
              <L label="Barcode type (optional)">
                <select
                  className="inp"
                  value={f.barcode_type}
                  onChange={(e) => setF({ ...f, barcode_type: e.target.value })}
                >
                  {BARCODE_TYPES.map((b) => (
                    <option key={b || "none"} value={b}>
                      {b || "—"}
                    </option>
                  ))}
                </select>
              </L>
              <L label="Units per carton (optional)">
                <input
                  type="number"
                  min="1"
                  className="inp"
                  value={f.units_per_carton}
                  onChange={(e) => setF({ ...f, units_per_carton: e.target.value })}
                  placeholder="e.g. 24"
                />
              </L>
            </div>
          </Section>

          <Section title="Buying details" step="4">
            <div className="grid grid-cols-2 gap-3">
              <L label="Standard unit cost">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="inp"
                  value={f.unit_cost}
                  onChange={(e) => setF({ ...f, unit_cost: e.target.value })}
                />
              </L>
              <L label="Preferred supplier">
                <SearchableSelect
                  value={f.supplier_id}
                  onChange={(v) => setF({ ...f, supplier_id: v })}
                  placeholder="—"
                  options={suppliers.map((s: any) => ({
                    value: s.id,
                    label: s.company_name ?? s.companyName ?? s.id,
                  }))}
                />
              </L>
              <L label="Supplier product code (optional)">
                <input
                  className="inp"
                  value={f.supplier_product_code}
                  onChange={(e) => setF({ ...f, supplier_product_code: e.target.value })}
                  placeholder="Supplier's reference for this SKU"
                />
              </L>
              <L label="Lead time (days)">
                <input
                  type="number"
                  min="0"
                  className="inp"
                  value={f.lead_time_days}
                  onChange={(e) => setF({ ...f, lead_time_days: e.target.value })}
                />
              </L>
              <L label="Minimum order quantity">
                <input
                  type="number"
                  min="1"
                  className="inp"
                  value={f.minimum_order_quantity}
                  onChange={(e) => setF({ ...f, minimum_order_quantity: e.target.value })}
                  placeholder="e.g. 12"
                />
              </L>
              <L label="Order multiple">
                <input
                  type="number"
                  min="1"
                  className="inp"
                  value={f.order_multiple}
                  onChange={(e) => setF({ ...f, order_multiple: e.target.value })}
                  placeholder="e.g. 6"
                />
              </L>
            </div>
          </Section>

          <Section title="Selling details" step="5">
            <div className="grid grid-cols-2 gap-3">
              <L label="MRP">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="inp"
                  value={f.mrp}
                  onChange={(e) => setF({ ...f, mrp: e.target.value })}
                  placeholder="Max retail price"
                />
              </L>
              <L label="Default selling price">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="inp"
                  value={f.unit_price}
                  onChange={(e) => setF({ ...f, unit_price: e.target.value })}
                />
              </L>
              <L label="Minimum gross margin (%)">
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  max="99"
                  className="inp"
                  value={f.minimum_gross_margin_percentage}
                  onChange={(e) => setF({ ...f, minimum_gross_margin_percentage: e.target.value })}
                />
              </L>
            </div>
            <PricingPreview f={f} />
          </Section>

          <Section title="Tax details" step="6">
            <div className="grid grid-cols-2 gap-3">
              <L label="HSN code">
                <input
                  className="inp"
                  value={f.hsn_code}
                  onChange={(e) => setF({ ...f, hsn_code: e.target.value })}
                  placeholder="e.g. 6402"
                />
              </L>
              <L label="GST rate (%)">
                <input
                  list="gst-rates"
                  type="number"
                  step="0.01"
                  min="0"
                  max="99"
                  className="inp"
                  value={f.gst_rate}
                  onChange={(e) => setF({ ...f, gst_rate: e.target.value })}
                  placeholder="0, 5, 12, 18, 28…"
                />
                <datalist id="gst-rates">
                  {GST_RATES.filter(Boolean).map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              </L>
            </div>
          </Section>

          <div className="flex justify-end gap-2 pt-2">
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
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

function Section({
  title,
  step,
  children,
}: {
  title: string;
  step?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="rounded-lg border border-border/60 p-4">
      <legend className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {step && (
          <span className="grid h-4 w-4 place-items-center rounded-full bg-primary/10 text-[9px] font-bold text-primary">
            {step}
          </span>
        )}
        {title}
      </legend>
      <div className="space-y-3">{children}</div>
    </fieldset>
  );
}

// Product image — uploads to S3 via the backend /upload endpoint and stores the
// returned public URL in image_url. Falls back to a plain URL paste.
function ImageField({
  userId,
  value,
  onChange,
}: {
  userId: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const signed = useSignedImageUrl(value);

  const upload = async (files: FileList | null) => {
    if (!files || !files[0]) return;
    const file = files[0];
    if (!file.type.startsWith("image/")) {
      toast.error("Only image files are allowed");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5 MB");
      return;
    }
    setBusy(true);
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
      // S3 keys must live under the user's own folder — the backend rejects any
      // path that doesn't start with the user id — so scope goes INSIDE it.
      const path = `${userId}/products/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
      const formData = new FormData();
      formData.append("file", file);
      formData.append("path", path);
      formData.append("scope", "products");
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`${API_URL}/upload`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Upload failed");
      }
      const data = await res.json();
      onChange(data.url);
      toast.success("Image uploaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    // Best-effort delete of the S3 object (only when it came from our uploader).
    const key = s3KeyFromUrl(value);
    if (key) {
      try {
        const token = localStorage.getItem("auth_token");
        await fetch(`${API_URL}/upload/${encodeURIComponent(key)}`, {
          method: "DELETE",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
      } catch {
        /* ignore */
      }
    }
    onChange("");
  };

  return (
    <div className="flex items-start gap-3">
      {value && signed ? (
        <div className="relative">
          <img
            src={signed}
            alt="Product"
            className="h-20 w-20 rounded-lg border border-border object-cover"
          />
          <button
            type="button"
            onClick={remove}
            title="Remove image"
            className="absolute -right-2 -top-2 grid h-5 w-5 place-items-center rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <div className="grid h-20 w-20 place-items-center rounded-lg border border-dashed border-border bg-muted/20 text-muted-foreground">
          <ImageIcon className="h-6 w-6 opacity-50" />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            upload(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:border-primary hover:text-primary disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ImagePlus className="h-3.5 w-3.5" />
          )}
          {busy ? "Uploading…" : value ? "Replace image" : "Upload image"}
        </button>
        <L label="…or paste an image URL">
          <input
            className="inp !py-1.5 text-xs"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://…"
          />
        </L>
      </div>
    </div>
  );
}

// Minimum selling price is SYSTEM-CALCULATED from the buying + margin data:
//   Min Selling Price = Standard Unit Cost ÷ (1 − Minimum Gross Margin)
function PricingPreview({
  f,
}: {
  f: {
    unit_cost: string;
    unit_price: string;
    mrp: string;
    minimum_gross_margin_percentage: string;
  };
}) {
  const unitCost = Number(f.unit_cost) || 0;
  const unitPrice = Number(f.unit_price) || 0;
  const mrp = Number(f.mrp) || 0;
  // Margin is entered as a percentage (e.g. 40 = 40%) and stored as a decimal (0.4).
  const margin = Math.min(
    0.99,
    Math.max(0.01, (Number(f.minimum_gross_margin_percentage) || 40) / 100),
  );
  // Cost-based floor — the price that preserves the configured gross margin.
  const minSellingPrice = unitCost > 0 ? unitCost / (1 - margin) : 0;
  const belowFloor = unitPrice > 0 && minSellingPrice > 0 && unitPrice < minSellingPrice;
  const aboveMrp = mrp > 0 && unitPrice > mrp;
  const warn = belowFloor || aboveMrp;

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs">
      <div className="mb-1 flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-muted-foreground">
        <RefreshCw className="h-3 w-3" /> Pricing preview — min selling price is system-calculated
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <span className="text-muted-foreground">Standard unit cost</span>
        <span className="text-right font-mono tabular-nums">{fmtMoney(unitCost)}</span>
        <span className="text-muted-foreground">Min gross margin</span>
        <span className="text-right font-mono tabular-nums">{Math.round(margin * 100)}%</span>
        <span className="text-muted-foreground">Min selling price (cost ÷ (1 − margin))</span>
        <span className="text-right font-mono tabular-nums font-semibold">
          {fmtMoney(minSellingPrice)}
        </span>
        {mrp > 0 && (
          <>
            <span className="text-muted-foreground">MRP</span>
            <span className="text-right font-mono tabular-nums">{fmtMoney(mrp)}</span>
          </>
        )}
        <span className="text-muted-foreground">Default selling price</span>
        <span className="text-right font-mono tabular-nums">{fmtMoney(unitPrice)}</span>
        <span className="text-muted-foreground">Status</span>
        <span
          className={`text-right font-medium ${warn ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}
        >
          {unitPrice <= 0
            ? "No selling price set"
            : belowFloor
              ? "Below min — margin at risk"
              : aboveMrp
                ? "Above MRP"
                : "Within margin"}
        </span>
      </div>
      {belowFloor && (
        <div className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
          The default selling price is below the minimum selling price of{" "}
          {fmtMoney(minSellingPrice)} — at {fmtMoney(unitPrice)} the actual gross margin is only{" "}
          {unitPrice > 0 ? Math.round((1 - unitCost / unitPrice) * 100) : 0}%.
        </div>
      )}
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

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "success" | "warning" | "destructive";
}) {
  const t =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "destructive"
          ? "text-destructive"
          : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-1 font-display text-2xl ${t}`}>{value}</div>
    </div>
  );
}

function Pill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "success" | "warning" | "destructive";
}) {
  const s =
    tone === "success"
      ? "bg-success/10 text-success border-success/30"
      : tone === "warning"
        ? "bg-warning/10 text-warning border-warning/30"
        : "bg-destructive/10 text-destructive border-destructive/30";
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${s}`}
    >
      {children}
    </span>
  );
}
