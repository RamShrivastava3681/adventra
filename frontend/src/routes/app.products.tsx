import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Layers,
  Check,
  Copy,
} from "lucide-react";
import { toast } from "sonner";

const API_URL = import.meta.env.VITE_API_URL || "/api";

export const Route = createFileRoute("/app/products")({
  component: ProductsPage,
});

type Product = {
  id: string;
  /** Id of the parent product when this SKU is a colour/size variant. */
  parent_id: string | null;
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
  ecommerce_price: number | null;
  retailer_price: number | null;
  distributor_price: number | null;
  flexible_price: number | null;
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
type SkuMaster = { id: string; name: string; code: string; active: boolean; size_system?: string | null };

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
  const [skuWizard, setSkuWizard] = useState(false);
  const [mastersOpen, setMastersOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [variantFor, setVariantFor] = useState<{ parent: Product; child?: Product } | null>(null);
  const [detailFor, setDetailFor] = useState<Product | null>(null);
  // Staged child-SKU creation from the Master SKU drawer: "color" adds a
  // colour-coded SKU under a master, "size" a size-coded SKU under a colour.
  const [stageFor, setStageFor] = useState<{ parent: Product; level: "color" | "size" } | null>(null);
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
  const categoriesQ = useQuery({ queryKey: ["sku-masters", "category"], queryFn: () => api.skuMasters.list("category") });
  const gendersQ = useQuery({ queryKey: ["sku-masters", "gender"], queryFn: () => api.skuMasters.list("gender") });
  const colorsQ = useQuery({ queryKey: ["sku-masters", "color"], queryFn: () => api.skuMasters.list("color") });
  const sizesQ = useQuery({ queryKey: ["sku-masters", "size"], queryFn: () => api.skuMasters.list("size") });

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

  // ── Parent / colour-size variant grouping ─────────────────────────────────
  // Products with a parent_id are variants of the parent SKU. The catalogue
  // renders each parent as a row followed by its variant rows beneath it.
  const childrenByParent = useMemo(() => {
    const m = new Map<string, Product[]>();
    for (const p of productsQ.data ?? []) {
      if (p.parent_id) {
        const list = m.get(p.parent_id) ?? [];
        list.push(p);
        m.set(p.parent_id, list);
      }
    }
    return m;
  }, [productsQ.data]);

  // Flattened display rows — a parent plus its variants. Searching a variant
  // (e.g. "Black") also surfaces its parent row so the family context stays
  // visible.
  const rows = useMemo(() => {
    const out: Array<{ product: Product; depth: number }> = [];
    const match = (p: Product) => {
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
    };
    const parents = (productsQ.data ?? [])
      .filter((p) => !p.parent_id)
      .sort((a, b) => a.sku.localeCompare(b.sku ?? "") || a.name.localeCompare(b.name));
    const hasMatchDeep = (p: Product): boolean =>
      match(p) || (childrenByParent.get(p.id) ?? []).some(hasMatchDeep);
    const append = (p: Product, depth: number, forceVisible = false) => {
      const visible = forceVisible || match(p) || hasMatchDeep(p);
      if (!visible) return;
      out.push({ product: p, depth });
      for (const child of childrenByParent.get(p.id) ?? []) append(child, depth + 1, match(p));
    };
    for (const p of parents) append(p, 0);
    return out;
  }, [productsQ.data, childrenByParent, q, cat]);

  // Live stock for a row — variants carry their own stock (stock hangs off the
  // concrete SKU), while a parent row aggregates its own plus all variants.
  const stockFor = useCallback(
    (p: Product) => {
      let s = stockByProduct.get(p.id) ?? 0;
      if (!p.parent_id) {
        const addDescendants = (parentId: string) => {
          for (const k of childrenByParent.get(parentId) ?? []) {
            s += stockByProduct.get(k.id) ?? 0;
            addDescendants(k.id);
          }
        };
        addDescendants(p.id);
      }
      return s;
    },
    [stockByProduct, childrenByParent],
  );

  const parentOf = useCallback(
    (p: Product) =>
      p.parent_id ? (productsQ.data ?? []).find((x) => x.id === p.parent_id) ?? null : null,
    [productsQ.data],
  );

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
    const all = (productsQ.data ?? []) as Product[];
    const total = all.length; // every SKU, variants included
    let active = 0,
      low = 0,
      out = 0,
      inventoryValue = 0;
    for (const p of all) if (p.status === "active") active++;
    // Stock metrics roll up per parent family — a parent row aggregates its
    // variants' stock, and variant rows are handled by their parent.
    for (const p of all) {
      if (p.parent_id) continue;
      const kids = childrenByParent.get(p.id) ?? [];
      const stock = kids.reduce(
        (s, k) => s + (stockByProduct.get(k.id) ?? 0),
        stockByProduct.get(p.id) ?? 0,
      );
      inventoryValue += stock * Number(p.unit_cost);
      if (stock <= 0) out++;
      else if (stock <= p.reorder_level) low++;
    }
    return { total, active, low, out, inventoryValue };
  }, [productsQ.data, stockByProduct, childrenByParent]);

  return (
    <div>
      <PageHeader
        eyebrow="Catalog"
        title="Products & SKUs"
        description="Master catalog of every SKU you sell. The catalogue only defines the product — stock, sales and purchases hang off the SKU elsewhere."
        icon={<Package className="h-5 w-5" />}
        breadcrumbs={[{ label: "Dashboard", href: "/app/dashboard" }, { label: "Catalog" }]}
        actions={
          canWrite ? (
            <div className="flex gap-2">
            {isAdmin && <button onClick={() => setMastersOpen(true)} className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:border-primary hover:text-primary">SKU Masters</button>}
            <button
              onClick={() => {
                setSkuWizard(true);
              }}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              <Plus className="h-4 w-4" /> Create Master SKU
            </button>
            </div>
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
                    <th className="px-5 py-2 text-right font-normal">E-com</th>
                    <th className="px-5 py-2 text-right font-normal">Retailer</th>
                    <th className="px-5 py-2 text-right font-normal">Distributor</th>
                    <th className="px-5 py-2 text-right font-normal">Flexible</th>
                    <th className="px-5 py-2 text-right font-normal">Cost</th>
                    <th className="px-5 py-2 text-right font-normal">On hand</th>
                    <th className="px-5 py-2 text-right font-normal">Status</th>
                    <th className="px-5 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ product: p, depth }) => {
                    const stock = stockFor(p);
                    const low = stock <= p.reorder_level && stock > 0;
                    const out = stock <= 0;
                    const isVariant = !!p.parent_id;
                    const variantCount = isVariant ? 0 : (childrenByParent.get(p.id) ?? []).length;
                    return (
                      <tr
                        key={p.id}
                        className={`border-b border-border/60 hover:bg-muted/30 ${isVariant ? "bg-muted/10" : ""}`}
                      >
                        <td className="px-5 py-3">
                          <div
                            className={`flex items-center gap-2.5 ${isVariant ? "pl-8" : ""}`}
                            style={isVariant ? { paddingLeft: `${depth * 2}rem` } : undefined}
                          >
                            {isVariant ? (
                              <span className="text-muted-foreground/50">└</span>
                            ) : (
                              <ProductThumb imageUrl={p.image_url} name={p.name} />
                            )}
                            <button onClick={() => setDetailFor(isVariant ? (parentOf(p) ?? p) : p)} title="Open SKU hierarchy" className="font-mono text-xs text-primary hover:underline">{p.sku}</button>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <div className="font-medium">{p.name}</div>
                          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            {isVariant ? (
                              <span className="rounded border border-primary/20 bg-primary/5 px-1 py-px font-medium text-primary">
                                Variant of {parentOf(p)?.sku ?? "parent"}
                              </span>
                            ) : (
                              <>
                                {[p.category, p.subcategory, p.brand]
                                  .filter(Boolean)
                                  .join(" · ") || "—"}
                                {variantCount > 0 && (
                                  <span className="rounded border border-border bg-muted/40 px-1.5 py-px font-medium text-muted-foreground">
                                    {variantCount} colour/size variant{variantCount > 1 ? "s" : ""}
                                  </span>
                                )}
                              </>
                            )}
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
                        <td className="px-5 py-3 text-right num">
                          {p.ecommerce_price ? fmtMoney(p.ecommerce_price) : "—"}
                        </td>
                        <td className="px-5 py-3 text-right num">
                          {p.retailer_price ? fmtMoney(p.retailer_price) : "—"}
                        </td>
                        <td className="px-5 py-3 text-right num">
                          {p.distributor_price ? fmtMoney(p.distributor_price) : "—"}
                        </td>
                        <td className="px-5 py-3 text-right num">
                          {p.flexible_price ? fmtMoney(p.flexible_price) : "—"}
                        </td>
                        <td className="px-5 py-3 text-right num text-muted-foreground">
                          {fmtMoney(p.unit_cost)}
                        </td>
                        <td
                          className={`px-5 py-3 text-right num ${out ? "text-destructive" : low ? "text-sem-attention" : ""}`}
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
                                onClick={() => setDetailFor(isVariant ? (parentOf(p) ?? p) : p)}
                                title={isVariant ? "Open the Master SKU hierarchy" : "Open Master SKU hierarchy"}
                                className="inline-flex max-w-[220px] items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-all duration-200 hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                              >
                                <Layers className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">Colours & sizes</span>
                              </button>
                              {(() => {
                                const parent = isVariant ? parentOf(p) : null;
                                // Master rows add a colour variant; colour rows
                                // (variant of a master) add a size variant.
                                const level = !isVariant
                                  ? ("color" as const)
                                  : parent && !parent.parent_id
                                    ? ("size" as const)
                                    : null;
                                if (!level) return null;
                                return (
                                  <button
                                    onClick={() => setStageFor({ parent: p, level })}
                                    title={
                                      level === "color"
                                        ? `Add colour variant under ${p.sku}`
                                        : `Add size variant under ${p.sku}`
                                    }
                                    className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1.5 text-[11px] font-medium text-muted-foreground transition-all duration-200 hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                                  >
                                    <Plus className="h-3.5 w-3.5" />
                                    <span className="hidden xl:inline">
                                      {level === "color" ? "Colour" : "Size"}
                                    </span>
                                  </button>
                                );
                              })()}
                              <button
                                onClick={() => {
                                  if (isVariant) {
                                    const parent = parentOf(p);
                                    if (parent) setVariantFor({ parent, child: p });
                                  } else {
                                    setEditing(p);
                                    setOpen(true);
                                  }
                                }}
                                className="text-muted-foreground hover:text-foreground"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => setDeleting(p)}
                                title={
                                  isVariant
                                    ? "Delete this variant & its inventory entries"
                                    : "Delete product & its inventory entries"
                                }
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
      {skuWizard && user && (
        <SkuBuilderModal
          categories={(categoriesQ.data ?? []).filter((x: SkuMaster) => x.active)}
          genders={(gendersQ.data ?? []).filter((x: SkuMaster) => x.active)}
          onClose={() => setSkuWizard(false)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ["products"] }); setSkuWizard(false); }}
        />
      )}
      {mastersOpen && (
        <SkuMastersModal
          onClose={() => setMastersOpen(false)}
          onSaved={() => { ["category", "gender", "color", "size"].forEach((type) => qc.invalidateQueries({ queryKey: ["sku-masters", type] })); }}
        />
      )}
      {variantFor && (
        <VariantModal
          parent={variantFor.parent}
          child={variantFor.child}
          onClose={() => setVariantFor(null)}
        />
      )}
      {detailFor && (
        <ProductDetailDrawer
          product={(productsQ.data ?? []).find((p) => p.id === detailFor.id) ?? detailFor}
          all={(productsQ.data ?? []) as Product[]}
          childrenByParent={childrenByParent}
          canWrite={canWrite}
          onAddChild={(parent, level) => setStageFor({ parent, level })}
          onClose={() => setDetailFor(null)}
        />
      )}
      {stageFor && user && (
        <StagedSkuModal
          parent={stageFor.parent}
          level={stageFor.level}
          colors={(colorsQ.data ?? []).filter((x: SkuMaster) => x.active)}
          sizes={(sizesQ.data ?? []).filter((x: SkuMaster) => x.active)}
          takenNames={(childrenByParent.get(stageFor.parent.id) ?? []).map((p) =>
            stageFor.level === "color" ? (p.color ?? "") : (p.size ?? ""),
          )}
          onClose={() => setStageFor(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["products"] });
            qc.invalidateQueries({ queryKey: ["products-forecast"] });
            qc.invalidateQueries({ queryKey: ["products-inventory"] });
            setStageFor(null);
          }}
        />
      )}
      {deleting && (
        <ConfirmProductDelete
          product={deleting}
          variantCount={(childrenByParent.get(deleting.id) ?? []).length}
          movementCount={
            (movementsQ.data ?? []).filter(
              (m: any) =>
                m.product_id === deleting.id ||
                (childrenByParent.get(deleting.id) ?? []).some((k) => k.id === m.product_id),
            ).length
          }
          onClose={() => setDeleting(null)}
          onConfirm={() => del.mutate(deleting)}
          pending={del.isPending}
        />
      )}
    </div>
  );
}

function ProductDetailDrawer({ product, all, childrenByParent, canWrite, onAddChild, onClose }: {
  product: Product;
  all: Product[];
  childrenByParent: Map<string, Product[]>;
  canWrite: boolean;
  onAddChild: (parent: Product, level: "color" | "size") => void;
  onClose: () => void;
}) {
  const byId = new Map(all.map((p) => [p.id, p]));
  // Hierarchy is parent → colour SKUs → size SKUs (two levels under the parent).
  const colourNodes = (childrenByParent.get(product.id) ?? []).slice().sort((a, b) => a.sku.localeCompare(b.sku));
  const totalFinal = colourNodes.reduce((n, c) => n + (childrenByParent.get(c.id) ?? []).length, 0);
  void byId;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-screen w-full max-w-xl flex-col overflow-hidden border-l border-border bg-card" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-border p-5">
          <div><p className="text-[10px] uppercase tracking-widest text-primary">Master SKU detail</p><h3 className="mt-1 font-display text-lg">{product.name}</h3><p className="mt-1 font-mono text-sm font-semibold text-primary">{product.sku}</p><p className="mt-1 text-xs text-muted-foreground">{[product.category, product.gender, product.model].filter(Boolean).join(" · ")}</p></div>
          <button onClick={onClose} className="rounded-md p-2 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-border p-3"><p className="text-[10px] uppercase tracking-widest text-muted-foreground">Colours</p><p className="mt-1 font-display text-xl">{colourNodes.length}</p></div>
            <div className="rounded-lg border border-border p-3"><p className="text-[10px] uppercase tracking-widest text-muted-foreground">Final SKUs</p><p className="mt-1 font-display text-xl">{totalFinal}</p></div>
            <div className="rounded-lg border border-border p-3"><p className="text-[10px] uppercase tracking-widest text-muted-foreground">MRP</p><p className="mt-1 font-display text-xl">{product.mrp ? fmtMoney(product.mrp) : "—"}</p></div>
          </div>
          <div className="rounded-lg border border-border/70 p-4 text-xs">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Pricing (₹)</p>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono"><span className="text-muted-foreground">Cost</span><span className="text-right">{fmtMoney(product.unit_cost)}</span><span className="text-muted-foreground">Selling</span><span className="text-right">{fmtMoney(product.unit_price)}</span><span className="text-muted-foreground">Retailer</span><span className="text-right">{product.retailer_price ? fmtMoney(product.retailer_price) : "—"}</span><span className="text-muted-foreground">Distributor</span><span className="text-right">{product.distributor_price ? fmtMoney(product.distributor_price) : "—"}</span></div>
          </div>
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">SKU hierarchy — Master → Colour → Size</p>
              {canWrite && (
                <button
                  onClick={() => onAddChild(product, "color")}
                  title="Add a colour-coded SKU under this Master SKU"
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:border-primary hover:text-primary"
                >
                  <Plus className="h-3 w-3" /> Add colour
                </button>
              )}
            </div>
            <div className="mt-2 rounded-lg border border-primary/25 bg-primary/5 p-3"><p className="text-[10px] uppercase tracking-widest text-muted-foreground">Master SKU</p><p className="mt-0.5 flex items-center justify-between font-mono text-sm font-semibold text-primary">{product.sku}<button onClick={() => { navigator.clipboard.writeText(product.sku); toast.success("Master SKU copied"); }} className="rounded p-1 hover:bg-primary/10"><Copy className="h-3.5 w-3.5" /></button></p></div>
            <div className="mt-3 space-y-3">
              {colourNodes.length === 0 && <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">No colour SKUs yet — use “＋ Add colour” above.</p>}
              {colourNodes.map((c) => {
                const sizes = (childrenByParent.get(c.id) ?? []).slice().sort((a, b) => a.sku.localeCompare(b.sku));
                return (
                  <div key={c.id} className="rounded-lg border border-border/70">
                    <div className="flex items-center justify-between border-b border-border/60 bg-muted/20 px-3 py-2"><div><span className="font-medium">{c.color ?? c.name}</span><p className="font-mono text-xs text-primary">{c.sku}</p><p className="mt-0.5 text-[10px] text-muted-foreground">Sell {c.unit_price ? fmtMoney(c.unit_price) : "—"}{c.mrp ? ` · MRP ${fmtMoney(c.mrp)}` : ""}</p></div><div className="flex items-center gap-1">{canWrite && <button onClick={() => onAddChild(c, "size")} title={`Add a size-coded SKU under ${c.sku}`} className="rounded p-1.5 text-muted-foreground hover:text-primary"><Plus className="h-3.5 w-3.5" /></button>}<button onClick={() => { navigator.clipboard.writeText(c.sku); toast.success("Colour SKU copied"); }} className="rounded p-1.5 text-muted-foreground hover:text-primary"><Copy className="h-3.5 w-3.5" /></button></div></div>
                    <div className="p-2">{sizes.length === 0 ? <p className="px-2 py-1 text-xs text-muted-foreground">Colour SKU only — no sizes yet. Use ＋ above to add one.</p> : sizes.map((s) => <div key={s.id} className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm"><span className="text-muted-foreground">→ {s.size ?? s.sku.split("-").slice(-1)}</span><span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{s.unit_price ? fmtMoney(s.unit_price) : "—"}</span><span className="flex items-center gap-2 font-mono text-xs">{s.sku}<button onClick={() => { navigator.clipboard.writeText(s.sku); toast.success("Final SKU copied"); }} className="rounded p-1 text-muted-foreground hover:text-primary"><Copy className="h-3 w-3" /></button></span></div>)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfirmProductDelete({
  product,
  variantCount = 0,
  movementCount,
  onClose,
  onConfirm,
  pending,
}: {
  product: Product;
  variantCount?: number;
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
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-xl border border-border bg-card p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-lg">Delete {product.name}?</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          This permanently removes{" "}
          <span className="font-medium text-foreground">{product.sku}</span>
          {variantCount > 0 ? (
            <>
              {" "}plus its{" "}
              <span className="font-medium text-foreground">
                {variantCount} colour/size variant{variantCount === 1 ? "" : "s"}
              </span>
            </>
          ) : null}{" "}
          from the catalogue, along with its{" "}
          <span className="font-medium text-foreground">
            {movementCount} stock movement{movementCount === 1 ? "" : "s"}
          </span>{" "}
          and forecast entries. Invoices, orders and receipts keep their records.
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

// Variant-name builder — mirrors the backend rule so an edited variant keeps
// the same readable name ("Parent name — BLACK / 42").
function variantDisplayName(parentName: string, color?: string | null, size?: string | null): string {
  const attrs = [color, size]
    .map((a) => (a ?? "").toString().trim())
    .filter(Boolean)
    .map((a) => a.toUpperCase())
    .join(" / ");
  return attrs ? `${parentName} — ${attrs}` : parentName;
}

// ─── Staged child-SKU creation ─────────────────────────────────────────────
// Master → colour (level "color"): pick a colour master → colour-coded SKU
//   MASTER-COLOUR, e.g. AD-U-TN-ET1100-AQB.
// Colour → size (level "size"): pick a size master → size-coded SKU
//   COLOUR-SKU-SIZE, e.g. …-AQB-3P.
// Pricing is prefilled from the parent (snapshot model): save as-is to keep
// the parent's prices, or edit any field to set this SKU's own price. Later
// changes to the parent price never rewrite the child.
function StagedSkuModal({
  parent,
  level,
  colors,
  sizes,
  takenNames,
  onClose,
  onSaved,
}: {
  parent: Product;
  level: "color" | "size";
  colors: SkuMaster[];
  sizes: SkuMaster[];
  /** Colour names (level color) or size names (level size) already used under this parent. */
  takenNames: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const isColour = level === "color";
  const [masterId, setMasterId] = useState("");
  const [sku, setSku] = useState("");
  const [quick, setQuick] = useState({ name: "", code: "", system: "International" });
  const [localColors, setLocalColors] = useState<SkuMaster[]>(colors);
  const [localSizes, setLocalSizes] = useState<SkuMaster[]>(sizes);
  useEffect(() => setLocalColors(colors), [colors]);
  useEffect(() => setLocalSizes(sizes), [sizes]);
  const str = (v: number | null | undefined) =>
    v === null || v === undefined ? "" : String(v);
  const [prices, setPrices] = useState({
    unit_cost: str(parent.unit_cost),
    unit_price: str(parent.unit_price),
    mrp: str(parent.mrp),
    ecommerce_price: str(parent.ecommerce_price),
    retailer_price: str(parent.retailer_price),
    distributor_price: str(parent.distributor_price),
    gst_rate: str(parent.gst_rate),
  });
  const setP = (k: keyof typeof prices) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setPrices({ ...prices, [k]: e.target.value });

  const options = isColour ? localColors : localSizes;
  const selected = options.find((x) => x.id === masterId);
  const preview = sku.trim() || (selected ? `${parent.sku}-${selected.code}` : "");
  const dupName =
    !!selected &&
    takenNames.some((n) => !!n && n.toLowerCase() === selected.name.toLowerCase());

  const checkQ = useQuery({
    queryKey: ["check-sku", preview],
    queryFn: () => api.products.checkSku(preview),
    enabled: preview.length > 5,
    staleTime: 15000,
  });
  const skuTaken = !!checkQ.data?.exists;

  const priceError = (() => {
    const entries: Array<[string, string]> = [
      ["Cost", prices.unit_cost],
      ["Selling price", prices.unit_price],
      ["MRP", prices.mrp],
      ["Retailer price", prices.retailer_price],
      ["Distributor price", prices.distributor_price],
      ["E-commerce price", prices.ecommerce_price],
    ];
    for (const [label, v] of entries) {
      if (v !== "" && !(Number(v) >= 0)) return `${label} cannot be negative`;
    }
    if (prices.gst_rate !== "" && !(Number(prices.gst_rate) >= 0))
      return "GST rate cannot be negative";
    if (
      prices.mrp !== "" &&
      prices.unit_price !== "" &&
      Number(prices.mrp) < Number(prices.unit_price)
    )
      return "MRP should not be lower than Selling price";
    return null;
  })();

  const canSave = !!selected && !dupName && !!preview && !skuTaken && !priceError;

  const save = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error(isColour ? "Pick a colour" : "Pick a size");
      if (dupName)
        throw new Error(
          `${isColour ? "This colour already exists" : "This size already exists"} under ${parent.sku}`,
        );
      const pricePayload = {
        unit_cost: numOrNull(prices.unit_cost) ?? 0,
        unit_price: numOrNull(prices.unit_price) ?? 0,
        mrp: numOrNull(prices.mrp),
        ecommerce_price: numOrNull(prices.ecommerce_price),
        retailer_price: numOrNull(prices.retailer_price),
        distributor_price: numOrNull(prices.distributor_price),
        gst_rate: numOrNull(prices.gst_rate),
      };
      if (isColour) {
        await api.products.create({
          parent_id: parent.id,
          sku_level: "color",
          color: selected.name,
          color_master_id: selected.id,
          sku: sku.trim() || undefined,
          ...pricePayload,
        });
      } else {
        await api.products.create({
          parent_id: parent.id,
          sku_level: "variant",
          size: selected.name,
          size_master_id: selected.id,
          color: parent.color,
          color_master_id:
            (parent as any).color_master_id ?? (parent as any).colorMasterId ?? null,
          sku: sku.trim() || undefined,
          ...pricePayload,
        });
      }
      return preview;
    },
    onSuccess: (made) => {
      onSaved();
      toast.success(`${isColour ? "Colour" : "Size"} SKU ${made} created`);
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const quickCreate = useMutation({
    mutationFn: async () => {
      if (isColour) {
        const created: any = await api.skuMasters.create("color", {
          name: quick.name.trim(),
          code: quick.code,
        });
        const entry = {
          id: created.id ?? String(Date.now()),
          name: created.name,
          code: created.code,
          active: true,
        } as SkuMaster;
        setLocalColors((prev) => [...prev, entry]);
        setMasterId(entry.id);
      } else {
        const created: any = await api.skuMasters.create("size", {
          name: quick.name.trim(),
          code: quick.code,
          sizeSystem: quick.system,
        });
        const entry = {
          id: created.id ?? String(Date.now()),
          name: created.name,
          code: created.code,
          active: true,
          size_system: created.sizeSystem ?? quick.system,
        } as SkuMaster;
        setLocalSizes((prev) => [...prev, entry]);
        setMasterId(entry.id);
      }
      setQuick({ name: "", code: "", system: "International" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sku-masters", isColour ? "color" : "size"] });
      toast.success("Master created & selected");
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Could not create master — code may exist"),
  });

  const sizeGroups = (["International", "EU", "UK", "US", "Custom"] as const)
    .map((sys) => ({
      sys,
      list: localSizes.filter(
        (x: any) => (x.size_system ?? x.sizeSystem ?? "Custom") === sys,
      ),
    }))
    .filter((g) => g.list.length > 0);

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
            <h3 className="font-display text-lg">
              {isColour ? "Add colour" : "Add size"} — {parent.sku}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {isColour
                ? `Creates a colour-coded SKU under Master ${parent.sku} (${parent.name})`
                : `Creates a size-coded SKU under Colour ${parent.sku} (${parent.color ?? parent.name})`}
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
          <div>
            <p className="mb-1.5 text-xs uppercase tracking-widest text-muted-foreground">
              {isColour ? "Colour *" : "Size *"}
            </p>
            {isColour ? (
              <div className="flex flex-wrap gap-2">
                {localColors.map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    onClick={() => setMasterId(x.id)}
                    className={`rounded-md border px-3 py-1.5 text-xs ${masterId === x.id ? "border-primary bg-primary/10 text-primary" : "border-border"}`}
                  >
                    {masterId === x.id && <Check className="mr-1 inline h-3 w-3" />}
                    {x.name} <span className="font-mono">({x.code})</span>
                  </button>
                ))}
              </div>
            ) : (
              <div>
                {sizeGroups.map((g) => (
                  <div key={g.sys} className="mb-2">
                    <p className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                      {g.sys}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {g.list.map((x) => (
                        <button
                          key={x.id}
                          type="button"
                          onClick={() => setMasterId(x.id)}
                          className={`rounded-md border px-3 py-1.5 text-xs ${masterId === x.id ? "border-primary bg-primary/10 text-primary" : "border-border"}`}
                        >
                          {masterId === x.id && <Check className="mr-1 inline h-3 w-3" />}
                          {x.name} <span className="font-mono">({x.code})</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div
              className={`mt-3 grid gap-2 rounded-lg border border-dashed border-border p-3 ${isColour ? "md:grid-cols-[1fr_120px_auto]" : "md:grid-cols-[1fr_100px_130px_auto]"}`}
            >
              <input
                className="inp !py-1.5"
                value={quick.name}
                onChange={(e) => setQuick({ ...quick, name: e.target.value })}
                placeholder={isColour ? "New colour — Aqua Blue" : "New size — UK 9"}
              />
              <input
                className="inp !py-1.5 font-mono uppercase"
                value={quick.code}
                onChange={(e) =>
                  setQuick({ ...quick, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })
                }
                placeholder={isColour ? "AQB" : "UK9"}
              />
              {!isColour && (
                <select
                  className="inp !py-1.5"
                  value={quick.system}
                  onChange={(e) => setQuick({ ...quick, system: e.target.value })}
                >
                  {["International", "EU", "UK", "US", "Custom"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              )}
              <button
                type="button"
                disabled={quickCreate.isPending || !quick.name.trim() || !quick.code.trim()}
                onClick={() => quickCreate.mutate()}
                className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary hover:text-primary disabled:opacity-50"
              >
                + Add & select
              </button>
            </div>
            {dupName && selected && (
              <p className="mt-2 text-xs font-medium text-destructive">
                {selected.name} already exists under {parent.sku} — pick another.
              </p>
            )}
          </div>

          <div>
            <L label="SKU (optional — auto-coded from parent + selection)">
              <input
                className="inp font-mono"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder={selected ? `${parent.sku}-${selected.code}` : "Select above first"}
              />
            </L>
            {preview ? (
              <div className="mt-2 rounded-lg border border-primary/25 bg-primary/5 p-2.5">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  {isColour ? "Colour" : "Size"} SKU
                </p>
                <p className="mt-0.5 font-mono text-sm font-semibold text-primary">{preview}</p>
                {checkQ.isFetching ? (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">Checking uniqueness…</p>
                ) : skuTaken ? (
                  <p className="mt-0.5 text-[11px] font-medium text-destructive">
                    Already exists — change the SKU override.
                  </p>
                ) : (
                  <p className="mt-0.5 text-[11px] text-sem-success">Available ✓</p>
                )}
              </div>
            ) : null}
          </div>

          <div>
            <p className="mb-1.5 text-xs uppercase tracking-widest text-muted-foreground">
              Pricing (₹) — prefilled from {parent.sku}
            </p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <L label="Cost">
                <input type="number" min="0" step="0.01" className="inp" value={prices.unit_cost} onChange={setP("unit_cost")} />
              </L>
              <L label="Selling price">
                <input type="number" min="0" step="0.01" className="inp" value={prices.unit_price} onChange={setP("unit_price")} />
              </L>
              <L label="MRP">
                <input type="number" min="0" step="0.01" className="inp" value={prices.mrp} onChange={setP("mrp")} />
              </L>
              <L label="Retailer price">
                <input type="number" min="0" step="0.01" className="inp" value={prices.retailer_price} onChange={setP("retailer_price")} />
              </L>
              <L label="Distributor price">
                <input type="number" min="0" step="0.01" className="inp" value={prices.distributor_price} onChange={setP("distributor_price")} />
              </L>
              <L label="E-commerce price">
                <input type="number" min="0" step="0.01" className="inp" value={prices.ecommerce_price} onChange={setP("ecommerce_price")} />
              </L>
              <L label="GST %">
                <input type="number" min="0" step="0.01" className="inp" value={prices.gst_rate} onChange={setP("gst_rate")} />
              </L>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Save as-is to use {parent.sku}’s prices, or edit any field to set this SKU’s own
              price. Later changes to the parent price won’t rewrite it.
            </p>
            {priceError && <p className="mt-1 text-xs font-medium text-destructive">{priceError}</p>}
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
              disabled={save.isPending || !canSave}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {save.isPending
                ? "Creating…"
                : `Create ${isColour ? "colour" : "size"} SKU`}
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

// Colour/size edit form for an existing child SKU (pencil on a variant row).
// Pricing is this SKU's own snapshot — editable here, never rewritten by the
// parent. Supplier and image stay inherited from the parent record.
function VariantModal({
  parent,
  child,
  onClose,
}: {
  parent: Product;
  child?: Product;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!child;
  // Price source: the record itself when editing, the parent when creating.
  const priced = child ?? parent;
  const str = (v: number | null | undefined) =>
    v === null || v === undefined ? "" : String(v);
  const [f, setF] = useState({
    color: child?.color ?? "",
    size: child?.size ?? "",
    sku: child?.sku ?? "",
    unit_cost: str(priced.unit_cost),
    unit_price: str(priced.unit_price),
    mrp: str(priced.mrp),
    ecommerce_price: str(priced.ecommerce_price),
    retailer_price: str(priced.retailer_price),
    distributor_price: str(priced.distributor_price),
    gst_rate: str(priced.gst_rate),
  });
  const setP = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.value });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["products-forecast"] });
    qc.invalidateQueries({ queryKey: ["products-inventory"] });
  };

  const save = useMutation({
    mutationFn: async () => {
      const color = f.color.trim() || null;
      const size = f.size.trim() || null;
      const sku = f.sku.trim() || undefined;
      const name = variantDisplayName(parent.name, color, size);
      if (!color && !size) throw new Error("Enter a colour or a size for this variant");
      const pricePayload = {
        unit_cost: numOrNull(f.unit_cost) ?? 0,
        unit_price: numOrNull(f.unit_price) ?? 0,
        mrp: numOrNull(f.mrp),
        ecommerce_price: numOrNull(f.ecommerce_price),
        retailer_price: numOrNull(f.retailer_price),
        distributor_price: numOrNull(f.distributor_price),
        gst_rate: numOrNull(f.gst_rate),
      };
      if (isEdit && child) {
        await api.products.update(child.id, { color, size, sku, name, ...pricePayload });
      } else {
        await api.products.create({ parent_id: parent.id, color, size, sku, ...pricePayload });
      }
    },
    onSuccess: () => {
      refresh();
      toast.success(isEdit ? "Variant updated" : "Variant created");
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
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div>
            <h3 className="font-display text-lg">
              {isEdit ? "Edit variant" : "Add colour/size variant"}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Parent{" "}
              <span className="font-mono font-medium text-foreground">{parent.sku}</span> ·{" "}
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
          <div>
            <p className="mb-1.5 text-xs uppercase tracking-widest text-muted-foreground">
              Pricing (₹){isEdit ? " — this SKU's own prices" : ` — prefilled from ${parent.sku}`}
            </p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <L label="Cost">
                <input type="number" min="0" step="0.01" className="inp" value={f.unit_cost} onChange={setP("unit_cost")} />
              </L>
              <L label="Selling price">
                <input type="number" min="0" step="0.01" className="inp" value={f.unit_price} onChange={setP("unit_price")} />
              </L>
              <L label="MRP">
                <input type="number" min="0" step="0.01" className="inp" value={f.mrp} onChange={setP("mrp")} />
              </L>
              <L label="Retailer price">
                <input type="number" min="0" step="0.01" className="inp" value={f.retailer_price} onChange={setP("retailer_price")} />
              </L>
              <L label="Distributor price">
                <input type="number" min="0" step="0.01" className="inp" value={f.distributor_price} onChange={setP("distributor_price")} />
              </L>
              <L label="E-commerce price">
                <input type="number" min="0" step="0.01" className="inp" value={f.ecommerce_price} onChange={setP("ecommerce_price")} />
              </L>
              <L label="GST %">
                <input type="number" min="0" step="0.01" className="inp" value={f.gst_rate} onChange={setP("gst_rate")} />
              </L>
            </div>
          </div>
          <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
            <Layers className="mb-1 h-3.5 w-3.5 text-primary" />
            Supplier and image stay inherited from{" "}
            <span className="font-mono">{parent.sku}</span> — prices above are this SKU's own
            (snapshot, not linked to the parent). Leave the SKU blank to auto-generate it.
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
              {isEdit ? "Save variant" : "Create variant"}
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
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
    ecommerce_price: product?.ecommerce_price != null ? String(product.ecommerce_price) : "",
    retailer_price: product?.retailer_price != null ? String(product.retailer_price) : "",
    distributor_price: product?.distributor_price != null ? String(product.distributor_price) : "",
    flexible_price: product?.flexible_price != null ? String(product.flexible_price) : "",
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
        ecommerce_price: numOrNull(f.ecommerce_price),
        retailer_price: numOrNull(f.retailer_price),
        distributor_price: numOrNull(f.distributor_price),
        flexible_price: numOrNull(f.flexible_price),
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
          <h3 className="font-display text-lg">{isEdit ? "Edit Master SKU" : "New Master SKU"}</h3>
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
          <Section title="Basic Master SKU details" step="1">
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
              <L label="E-commerce selling price">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="inp"
                  value={f.ecommerce_price}
                  onChange={(e) => setF({ ...f, ecommerce_price: e.target.value })}
                  placeholder="Online / e-commerce price"
                />
              </L>
              <L label="Retailer price">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="inp"
                  value={f.retailer_price}
                  onChange={(e) => setF({ ...f, retailer_price: e.target.value })}
                  placeholder="Price for retailers"
                />
              </L>
              <L label="Distributor price">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="inp"
                  value={f.distributor_price}
                  onChange={(e) => setF({ ...f, distributor_price: e.target.value })}
                  placeholder="Price for distributors"
                />
              </L>
              <L label="Flexible price">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="inp"
                  value={f.flexible_price}
                  onChange={(e) => setF({ ...f, flexible_price: e.target.value })}
                  placeholder="Negotiable / flexible price"
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
      // Session auth rides on the httpOnly cookie.
      const res = await fetch(`${API_URL}/upload`, {
        method: "POST",
        credentials: "include",
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
        await fetch(`${API_URL}/upload/${encodeURIComponent(key)}`, {
          method: "DELETE",
          credentials: "include",
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
    ecommerce_price: string;
    retailer_price: string;
    distributor_price: string;
    flexible_price: string;
    minimum_gross_margin_percentage: string;
  };
}) {
  const unitCost = Number(f.unit_cost) || 0;
  const mrp = Number(f.mrp) || 0;
  const ecommercePrice = Number(f.ecommerce_price) || 0;
  const retailerPrice = Number(f.retailer_price) || 0;
  const distributorPrice = Number(f.distributor_price) || 0;
  const flexiblePrice = Number(f.flexible_price) || 0;
  // Margin is entered as a percentage (e.g. 40 = 40%) and stored as a decimal (0.4).
  const margin = Math.min(
    0.99,
    Math.max(0.01, (Number(f.minimum_gross_margin_percentage) || 40) / 100),
  );
  // Cost-based floor — the price that preserves the configured gross margin.
  const minSellingPrice = unitCost > 0 ? unitCost / (1 - margin) : 0;

  const prices = [
    { label: "E-commerce", value: ecommercePrice },
    { label: "Retailer", value: retailerPrice },
    { label: "Distributor", value: distributorPrice },
    { label: "Flexible", value: flexiblePrice },
  ];
  const hasAnyPrice = prices.some((p) => p.value > 0);
  const belowFloor = hasAnyPrice && minSellingPrice > 0 && prices.some((p) => p.value > 0 && p.value < minSellingPrice);
  const aboveMrp = mrp > 0 && prices.some((p) => p.value > 0 && p.value > mrp);
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
        {prices.map((p) =>
          p.value > 0 ? (
            <span key={p.label} className="contents">
              <span className="text-muted-foreground">{p.label} price</span>
              <span className="text-right font-mono tabular-nums">{fmtMoney(p.value)}</span>
            </span>
          ) : null,
        )}
        <span className="text-muted-foreground">Status</span>
        <span
          className={`text-right font-medium ${warn ? "text-sem-attention" : "text-primary"}`}
        >
          {!hasAnyPrice
            ? "No selling price set"
            : belowFloor
              ? "Below min — margin at risk"
              : aboveMrp
                ? "Above MRP"
                : "Within margin"}
        </span>
      </div>
      {belowFloor && (
        <div className="mt-1 text-[10px] text-sem-attention">
          One or more selling prices are below the minimum selling price of{" "}
          {fmtMoney(minSellingPrice)} — margin may be at risk.
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
      ? "text-sem-success"
      : tone === "warning"
        ? "text-sem-attention"
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
      ? "bg-sem-success/10 text-sem-success border-sem-success/30"
      : tone === "warning"
        ? "bg-sem-attention/10 text-sem-attention border-sem-attention/30"
        : "bg-destructive/10 text-destructive border-destructive/30";
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${s}`}
    >
      {children}
    </span>
  );
}

function SkuMastersModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState<"category" | "gender" | "color" | "size">("category");
  const [name, setName] = useState(""); const [code, setCode] = useState(""); const [sizeSystem, setSizeSystem] = useState("International");
  const [search, setSearch] = useState(""); const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState(""); const [editCode, setEditCode] = useState(""); const [editSystem, setEditSystem] = useState("International");
  const [confirmTarget, setConfirmTarget] = useState<SkuMaster | null>(null);
  const mastersQ = useQuery({ queryKey: ["sku-masters", type], queryFn: () => api.skuMasters.list(type) });
  const productsQ = useQuery({ queryKey: ["products"], queryFn: async () => api.products.list() });
  const usageCount = (m: SkuMaster) => {
    const key = type === "category" ? "categoryMasterId" : type === "gender" ? "genderMasterId" : type === "color" ? "colorMasterId" : "sizeMasterId";
    return ((productsQ.data as any[]) ?? []).filter((p) => (p as any)[key] === m.id || (p as any)[key.replace("MasterId", "_master_id")] === m.id).length;
  };
  const save = useMutation({ mutationFn: () => api.skuMasters.create(type, { name: name.trim(), code, sizeSystem }), onSuccess: () => { toast.success("SKU master added"); setName(""); setCode(""); mastersQ.refetch(); onSaved(); }, onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save master — code may already exist") });
  const toggle = useMutation({ mutationFn: (m: any) => api.skuMasters.update(m.id, { active: !((m as any).active ?? (m as any).is_active ?? true) }), onSuccess: () => { setConfirmTarget(null); mastersQ.refetch(); onSaved(); }, onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update master") });
  const startEdit = (m: any) => { setEditingId(m.id); setEditName(m.name); setEditCode(m.code); setEditSystem(m.size_system ?? m.sizeSystem ?? "International"); };
  const saveEdit = useMutation({
    mutationFn: () => api.skuMasters.update(editingId!, { name: editName.trim(), code: editCode, ...(type === "size" ? { sizeSystem: editSystem } : {}) }),
    onSuccess: () => { toast.success("Master updated"); setEditingId(null); mastersQ.refetch(); onSaved(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update — code may be in use or duplicated"),
  });
  const filtered = ((mastersQ.data as any[]) ?? []).filter((m: any) => {
    const active = m.active ?? m.is_active ?? true;
    const q = search.trim().toLowerCase();
    const matchQ = !q || String(m.name ?? "").toLowerCase().includes(q) || String(m.code ?? "").toLowerCase().includes(q);
    const matchS = statusFilter === "all" || (statusFilter === "active" ? active : !active);
    return matchQ && matchS;
  });
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}><div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-border bg-card p-6" onClick={(e) => e.stopPropagation()}>
    <div className="flex items-center justify-between"><div><h3 className="font-display text-xl">SKU Masters</h3><p className="text-xs text-muted-foreground">Codes flow into SKUs as <span className="font-mono">AD-GENDER-CATEGORY-MODEL-COLOUR-SIZE</span>. Deactivating or renaming a code used by products needs confirmation.</p></div><button onClick={onClose}><X className="h-4 w-4" /></button></div>
    <div className="mt-5 flex flex-wrap gap-2">{(["category", "gender", "color", "size"] as const).map((x) => <button key={x} onClick={() => { setType(x); setSearch(""); setEditingId(null); }} className={`rounded-md px-3 py-2 text-xs capitalize ${type === x ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{x === "color" ? "Colours" : `${x}s`}</button>)}</div>
    <div className="mt-5 grid gap-3 md:grid-cols-[1fr_140px_160px_auto]"><input className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder={`${type} name — e.g. ${type === "category" ? "T-Shirts" : type === "gender" ? "Unisex" : type === "color" ? "Aqua Blue" : "EU 38"}`} /><input className="inp font-mono uppercase" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="Code — e.g. TN" />{type === "size" ? <select className="inp" value={sizeSystem} onChange={(e) => setSizeSystem(e.target.value)}>{["International", "EU", "UK", "US", "Custom"].map((x) => <option key={x}>{x}</option>)}</select> : <span className="hidden md:block" />}<button disabled={save.isPending || !name.trim() || !code.trim()} onClick={() => save.mutate()} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{save.isPending ? "Adding…" : `Add ${type}`}</button></div>
    <div className="mt-4 flex flex-wrap items-center gap-2"><div className="relative min-w-[200px] flex-1"><Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or code…" className="w-full rounded-md border border-border bg-input py-2 pl-9 pr-3 text-sm" /></div><div className="flex gap-1.5">{(["all", "active", "inactive"] as const).map((s) => <button key={s} onClick={() => setStatusFilter(s)} className={`rounded-full border px-3 py-1 text-xs capitalize ${statusFilter === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{s}</button>)}</div><span className="ml-auto text-xs text-muted-foreground">{filtered.length} shown</span></div>
    <div className="mt-3 max-h-80 overflow-y-auto rounded-lg border border-border"><table className="w-full text-sm"><thead className="sticky top-0 bg-muted/80 text-left text-xs backdrop-blur"><tr><th className="p-3">Name</th><th>Code</th>{type === "size" && <th>System</th>}<th className="text-right">Used by</th><th>Status</th><th className="text-right">Actions</th></tr></thead><tbody>{mastersQ.isLoading ? <tr><td colSpan={6} className="p-6 text-center text-sm text-muted-foreground">Loading…</td></tr> : filtered.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-sm text-muted-foreground">No masters match. Add one above.</td></tr> : filtered.map((m: any) => {
      const active = m.active ?? true; const used = usageCount(m); const isEditing = editingId === m.id;
      return <tr key={m.id} className="border-t border-border">{isEditing ? (<><td className="p-2"><input className="inp !py-1.5" value={editName} onChange={(e) => setEditName(e.target.value)} /></td><td className="p-2"><input className="inp !py-1.5 font-mono uppercase" value={editCode} onChange={(e) => setEditCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} /></td>{type === "size" && <td className="p-2"><select className="inp !py-1.5" value={editSystem} onChange={(e) => setEditSystem(e.target.value)}>{["International", "EU", "UK", "US", "Custom"].map((x) => <option key={x}>{x}</option>)}</select></td>}<td className="p-2 text-right text-xs text-muted-foreground">{used}</td><td className="p-2"><span className={`rounded-full px-2 py-1 text-xs ${active ? "bg-sem-success/10 text-sem-success" : "bg-muted text-muted-foreground"}`}>{active ? "Active" : "Inactive"}</span></td><td className="p-2"><div className="flex justify-end gap-1"><button disabled={saveEdit.isPending} onClick={() => saveEdit.mutate()} className="rounded-md p-1.5 text-sem-success hover:bg-sem-success/10"><Check className="h-3.5 w-3.5" /></button><button onClick={() => setEditingId(null)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"><X className="h-3.5 w-3.5" /></button></div></td></> ) : (<><td className="p-3 font-medium">{m.name}</td><td className="font-mono text-xs">{m.code}</td>{type === "size" && <td className="text-xs text-muted-foreground">{m.size_system ?? m.sizeSystem ?? "—"}</td>}<td className="p-3 text-right text-xs text-muted-foreground">{used ? `${used} product${used === 1 ? "" : "s"}` : "—"}</td><td><button title={used > 0 && active ? "Used by products — confirmation required" : "Toggle status"} onClick={() => { if (used > 0 && active) setConfirmTarget(m); else toggle.mutate(m); }} className={`rounded-full px-2 py-1 text-xs ${active ? "bg-sem-success/10 text-sem-success" : "bg-muted text-muted-foreground"}`}>{active ? "Active" : "Inactive"}</button></td><td className="p-3"><div className="flex justify-end gap-1"><button onClick={() => startEdit(m)} className="rounded-md p-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary"><Pencil className="h-3.5 w-3.5" /></button></div></td></>)}
      </tr>;
    })}</tbody></table></div>
    {confirmTarget && <div className="mt-4 rounded-lg border border-sem-attention/40 bg-sem-attention/5 p-4 text-sm"><p className="font-medium">Deactivate “{(confirmTarget as any).name} ({(confirmTarget as any).code})”?</p><p className="mt-1 text-xs text-muted-foreground">This code is used by {usageCount(confirmTarget)} product(s). Existing SKUs keep their text, but new variants can no longer use it. History is preserved in the audit log.</p><div className="mt-3 flex justify-end gap-2"><button onClick={() => setConfirmTarget(null)} className="rounded-md border border-border px-3 py-1.5 text-xs">Keep active</button><button disabled={toggle.isPending} onClick={() => toggle.mutate(confirmTarget)} className="rounded-md bg-sem-attention px-3 py-1.5 text-xs font-medium text-white">{toggle.isPending ? "Updating…" : "Deactivate anyway"}</button></div></div>}
    <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
  </div></div>;
}

const WIZARD_STEPS = ["Master SKU details", "Pricing", "Review & create"] as const;

function sanitizeModel(v: string) { return v.trim().toUpperCase().replace(/[^A-Z0-9]+/g, ""); }

function SkuBuilderModal({
  categories, genders, onClose, onSaved,
}: {
  categories: SkuMaster[]; genders: SkuMaster[];
  onClose: () => void; onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ name: "", categoryMasterId: "", genderMasterId: "", model: "", hsnCode: "", unitCost: "", unitPrice: "", mrp: "", retailerPrice: "", distributorPrice: "", ecommercePrice: "", unitOfMeasure: "piece" });
  const category = categories.find((x) => x.id === f.categoryMasterId);
  const gender = genders.find((x) => x.id === f.genderMasterId);
  const model = sanitizeModel(f.model);
  const parentSku = category && gender && model ? `AD-${gender.code}-${category.code}-${model}` : "";
  const skuCheckQ = useQuery({
    queryKey: ["check-sku", parentSku],
    queryFn: () => api.products.checkSku(parentSku),
    enabled: parentSku.length > 5,
    staleTime: 15000,
  });
  const skuTaken = !!skuCheckQ.data?.exists;
  const num = (v: string) => (v === "" ? null : Number(v));
  const priceError = (() => {
    for (const [label, v] of [["Unit price", f.unitCost], ["Selling price", f.unitPrice], ["MRP", f.mrp], ["Retailer price", f.retailerPrice], ["Distributor price", f.distributorPrice]] as const) {
      if (v !== "" && !(Number(v) >= 0)) return `${label} cannot be negative`;
    }
    if (f.mrp !== "" && f.unitPrice !== "" && Number(f.mrp) < Number(f.unitPrice)) return "MRP should not be lower than Selling price";
    return null;
  })();
  const canStep = (s: number): boolean => {
    if (s === 0) return !!(f.name.trim() && category && gender && model && !skuTaken);
    if (s === 1) return !priceError;
    return true;
  };
  const save = useMutation({
    mutationFn: () => api.products.createHierarchy({
      ...f, model,
      hsnCode: f.hsnCode.trim() || null,
      unitCost: Number(f.unitCost || 0), unitPrice: Number(f.unitPrice || 0),
      mrp: f.mrp === "" ? "" : Number(f.mrp), ecommercePrice: f.ecommercePrice === "" ? "" : Number(f.ecommercePrice),
      retailerPrice: f.retailerPrice === "" ? "" : Number(f.retailerPrice), distributorPrice: f.distributorPrice === "" ? "" : Number(f.distributorPrice),
      // Master-only creation: variants are added later from the Master SKU
      // detail drawer ("Add colour" / size), never in this wizard.
      colorMasterIds: [], sizeMasterIds: [], disabledKeys: [],
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["products"] }); toast.success(`Master SKU ${parentSku} created — add colours & sizes from its detail view`); onSaved(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not create Master SKU"),
  });
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
    <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-border bg-card" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between border-b border-border bg-card px-6 py-4">
        <div><h3 className="font-display text-xl">Create Master SKU</h3><p className="text-xs text-muted-foreground">Brand <span className="font-mono font-semibold">AD</span> is fixed · Master SKU = <span className="font-mono font-semibold">AD-GENDER-CATEGORY-MODEL</span> · Step {step + 1} of {WIZARD_STEPS.length} — {WIZARD_STEPS[step]}</p></div>
        <button className="rounded-md p-2 hover:bg-muted" onClick={onClose}><X className="h-4 w-4" /></button>
      </div>
      <div className="flex flex-wrap gap-1.5 border-b border-border bg-muted/20 px-6 py-3">
        {WIZARD_STEPS.map((label, i) => (
          <button key={label} disabled={i > step && !canStep(step)} onClick={() => { if (i <= step || canStep(step)) setStep(i); }} className={`rounded-full border px-3 py-1 text-xs transition ${i === step ? "border-primary bg-primary text-primary-foreground" : i < step ? "border-sem-success/40 bg-sem-success/10 text-sem-success" : "border-border text-muted-foreground"}`}>
            {i + 1}. {label}{i < step ? " ✓" : ""}
          </button>
        ))}
      </div>
      <div className="grid flex-1 gap-6 overflow-y-auto p-6 lg:grid-cols-[1fr_330px]">
        <div className="min-w-0 space-y-6">
          {step === 0 && <Card title="Step 1 — Master SKU details"><div className="grid gap-4 md:grid-cols-2">
            <L label="Master SKU name *"><input className="inp" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Essential T-Shirt" /></L>
            <L label="Model number *"><input className="inp font-mono uppercase" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value.toUpperCase() })} placeholder="ET1100" /><span className="mt-1 block text-[10px] text-muted-foreground">Letters + digits only · becomes the MODEL part of the Master SKU</span></L>
            <L label="Category *"><SearchableSelect value={f.categoryMasterId} onChange={(v) => setF({ ...f, categoryMasterId: v })} placeholder="Select category…" options={categories.map((x) => ({ value: x.id, label: `${x.name} (${x.code})`, hint: x.code }))} /></L>
            <L label="Gender *"><SearchableSelect value={f.genderMasterId} onChange={(v) => setF({ ...f, genderMasterId: v })} placeholder="Select gender…" options={genders.map((x) => ({ value: x.id, label: `${x.name} (${x.code})`, hint: x.code }))} /></L>
            <L label="HSN code"><input className="inp font-mono" value={f.hsnCode} onChange={(e) => setF({ ...f, hsnCode: e.target.value.replace(/[^0-9]/g, "").slice(0, 8) })} placeholder="e.g. 64041990" inputMode="numeric" /><span className="mt-1 block text-[10px] text-muted-foreground">Printed on tax invoices · inherited by every variant</span></L>
          </div>
          {parentSku ? <div className="mt-4 rounded-lg border border-primary/25 bg-primary/5 p-3"><p className="text-[10px] uppercase tracking-widest text-muted-foreground">Generated Master SKU</p><p className="mt-1 font-mono text-lg font-semibold text-primary">{parentSku}</p>{skuCheckQ.isFetching ? <p className="mt-1 text-xs text-muted-foreground">Checking uniqueness…</p> : skuTaken ? <p className="mt-1 text-xs font-medium text-destructive">Master SKU already exists: {parentSku} — change model / category / gender.</p> : <p className="mt-1 text-xs text-sem-success">Available ✓</p>}</div> : <p className="mt-4 text-xs text-muted-foreground">Pick a category, gender and model number to generate your Master SKU, e.g. <span className="font-mono">AD-U-TN-ET1100</span>. Pricing comes next. Colours and sizes are added later from the Master SKU detail view.</p>}
          </Card>}
          {step === 1 && <Card title="Step 2 — Master SKU pricing (₹ INR)"><div className="grid gap-4 md:grid-cols-3">
            {[["Unit Price (cost)", "unitCost"], ["Selling Price", "unitPrice"], ["MRP", "mrp"], ["Retailer Price", "retailerPrice"], ["Distributor Price", "distributorPrice"], ["E-commerce Price", "ecommercePrice"]].map(([label, key]) => (
              <L key={key} label={`₹ ${label}`}><input type="number" min="0" step="0.01" className="inp" value={(f as any)[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} placeholder="0.00" /></L>
            ))}
          </div>{priceError ? <p className="mt-3 text-xs font-medium text-destructive">{priceError}</p> : <p className="mt-3 text-xs text-muted-foreground">Prices cannot be negative. MRP should not be lower than Selling Price. Stored at product level and inherited by every variant.</p>}</Card>}
          {step === 2 && <Card title="Step 3 — Review & create"><div className="grid gap-4 text-sm md:grid-cols-2">
            <div><p className="text-[10px] uppercase tracking-widest text-muted-foreground">Master SKU</p><p className="mt-1 font-medium">{f.name || "—"} <span className="text-muted-foreground">· {model || "—"}</span></p><p className="mt-1 text-xs text-muted-foreground">{category?.name} ({category?.code}) · {gender?.name} ({gender?.code})</p><p className="mt-1 font-mono text-xs text-muted-foreground">HSN {f.hsnCode || "—"}</p><p className="mt-2 font-mono text-sm font-semibold text-primary">{parentSku}</p></div>
            <div><p className="text-[10px] uppercase tracking-widest text-muted-foreground">Pricing (₹)</p><p className="mt-1 font-mono text-xs">Cost {f.unitCost || "0"} · Sell {f.unitPrice || "0"} · MRP {f.mrp || "—"}</p><p className="mt-1 font-mono text-xs text-muted-foreground">Ret {f.retailerPrice || "—"} · Dist {f.distributorPrice || "—"}</p></div>
          </div>
          <p className="mt-4 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">Only the Master SKU is created here. After creation, open its “Colours & sizes” detail view to add colour and size variants one by one.</p>
          </Card>}
        </div>
        <aside className="h-fit rounded-xl border border-primary/25 bg-primary/5 p-5 lg:sticky lg:top-0">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Live SKU Builder</p>
          <div className="mt-3 space-y-1.5 text-sm">
            {[["Brand", "AD"], ["Gender", gender?.code ?? "—"], ["Category", category?.code ?? "—"], ["Model", model || "—"], ["HSN", f.hsnCode || "—"]].map(([k, v]) => <p key={k} className="flex items-center justify-between text-muted-foreground">{k}<span className="font-mono font-medium text-foreground">{v}</span></p>)}
          </div>
          <p className="mt-3 text-[10px] uppercase tracking-widest text-muted-foreground">Master SKU</p>
          <p className="mt-1 break-all font-mono text-base font-semibold text-primary">{parentSku || "AD-…"}</p>
          <div className="mt-3 flex gap-2"><button disabled={!parentSku} onClick={() => { navigator.clipboard.writeText(parentSku); toast.success("SKU copied"); }} className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary hover:text-primary disabled:opacity-50"><Copy className="h-3 w-3" /> Copy SKU</button></div>
          <div className="mt-4 flex gap-2"><button disabled={step === 0} onClick={() => setStep((s) => s - 1)} className="flex-1 rounded-md border border-border px-3 py-2 text-sm disabled:opacity-40">Back</button>{step < WIZARD_STEPS.length - 1 ? <button disabled={!canStep(step)} onClick={() => setStep((s) => s + 1)} className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40">Continue</button> : <button disabled={save.isPending || !canStep(0) || !canStep(1)} onClick={() => save.mutate()} className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40">{save.isPending ? "Creating…" : "Create Master SKU"}</button>}</div>
          {!canStep(step) && <p className="mt-2 text-[11px] text-sem-attention">Complete this step to continue{step === 0 && skuTaken ? " — Master SKU is taken" : ""}.</p>}
        </aside>
      </div>
    </div>
    <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
  </div>;
}
