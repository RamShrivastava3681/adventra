import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney } from "@/components/ledger-ui";
import { Plus, X, Loader2, Search, Trash2, Pencil, Package } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/products")({
  component: ProductsPage,
});

type Product = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  subcategory: string | null;
  gender: string | null;
  size: string | null;
  color: string | null;
  season: string;
  unit_price: number;
  unit_cost: number;
  reorder_level: number;
  max_stock: number;
  lead_time_days: number;
  safety_stock_days: number;
  status: string;
  supplier_id: string | null;
};

const GENDERS = ["mens", "womens", "kids", "unisex"];
const SEASONS = ["all", "spring", "summer", "fall", "winter"];
const CATEGORIES = ["Footwear", "Apparel", "Accessories", "Equipment", "Nutrition"];

function ProductsPage() {
  const { user, isAdmin, isSalesRep } = useAuth();
  const canWrite = !isSalesRep && !!user;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");

  const productsQ = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const data = await api.products.list();
      return (data ?? []).sort((a: any, b: any) => a.sku?.localeCompare(b.sku ?? "") ?? 0) as Product[];
    },
  });

  // Stock lookup per product
  const movementsQ = useQuery({
    queryKey: ["stock_movements_all"],
    queryFn: async () => {
      const data = await api.stockMovements.list();
      return data.map((m: any) => ({ product_id: m.productId ?? m.product_id, direction: m.direction, quantity: m.quantity }));
    },
  });

  const stockByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of (movementsQ.data ?? []) as any[]) {
      if (!r.product_id) continue;
      const sign = r.direction === "in" ? 1 : -1;
      m.set(r.product_id, (m.get(r.product_id) ?? 0) + sign * Number(r.quantity));
    }
    return m;
  }, [movementsQ.data]);

  const rows = (productsQ.data ?? []).filter((p) => {
    const matchQ = !q ||
      p.sku.toLowerCase().includes(q.toLowerCase()) ||
      p.name.toLowerCase().includes(q.toLowerCase()) ||
      (p.color ?? "").toLowerCase().includes(q.toLowerCase());
    const matchC = cat === "all" || p.category === cat;
    return matchQ && matchC;
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      await api.products.delete(id);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["products"] }); toast.success("Deleted"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const summary = useMemo(() => {
    const total = productsQ.data?.length ?? 0;
    let active = 0, low = 0, out = 0, inventoryValue = 0;
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
        description="Master catalog of every SKU you sell. Reorder levels drive forecast and low-stock alerts."
        breadcrumbs={[
          { label: "Dashboard", href: "/app/dashboard" },
          { label: "Catalog" },
        ]}
        actions={canWrite ? (
          <button onClick={() => { setEditing(null); setOpen(true); }} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            <Plus className="h-4 w-4" /> New product
          </button>
        ) : <span className="text-xs uppercase tracking-widest text-muted-foreground">Read-only</span>}
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
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SKU, name, color…"
                className="w-full rounded-md border border-border bg-input px-9 py-2 text-sm" />
            </div>
            <select value={cat} onChange={(e) => setCat(e.target.value)} className="rounded-md border border-border bg-input px-3 py-2 text-sm">
              <option value="all">All categories</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <div className="text-xs text-muted-foreground">{rows.length} shown</div>
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
                    <th className="px-5 py-2 text-right font-normal">Price</th>
                    <th className="px-5 py-2 text-right font-normal">Cost</th>
                    <th className="px-5 py-2 text-right font-normal">On hand</th>
                    <th className="px-5 py-2 text-right font-normal">Reorder @</th>
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
                        <td className="px-5 py-3 font-mono text-xs">{p.sku}</td>
                        <td className="px-5 py-3">
                          <div className="font-medium">{p.name}</div>
                          {p.category && <div className="text-[10px] text-muted-foreground">{p.category}{p.subcategory ? ` · ${p.subcategory}` : ""}</div>}
                        </td>
                        <td className="px-5 py-3 text-xs text-muted-foreground">
                          {[p.gender, p.size, p.color, p.season !== "all" ? p.season : null].filter(Boolean).join(" · ") || "—"}
                        </td>
                        <td className="px-5 py-3 text-right num">{fmtMoney(p.unit_price)}</td>
                        <td className="px-5 py-3 text-right num text-muted-foreground">{fmtMoney(p.unit_cost)}</td>
                        <td className={`px-5 py-3 text-right num ${out ? "text-destructive" : low ? "text-warning" : ""}`}>{stock.toLocaleString()}</td>
                        <td className="px-5 py-3 text-right num text-muted-foreground">{p.reorder_level.toLocaleString()}</td>
                        <td className="px-5 py-3 text-right">
                          {out ? <Pill tone="destructive">Out</Pill> : low ? <Pill tone="warning">Low</Pill> : <Pill tone="success">OK</Pill>}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {canWrite && (
                            <div className="flex justify-end gap-2">
                              <button onClick={() => { setEditing(p); setOpen(true); }} className="text-muted-foreground hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>
                              <button onClick={() => del.mutate(p.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
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

      {open && user && <ProductModal userId={user.id} product={editing} onClose={() => setOpen(false)} />}
    </div>
  );
}

function ProductModal({ userId, product, onClose }: { userId: string; product: Product | null; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!product;
  const [f, setF] = useState({
    sku: product?.sku ?? "",
    name: product?.name ?? "",
    description: "",
    category: product?.category ?? "",
    subcategory: product?.subcategory ?? "",
    gender: product?.gender ?? "unisex",
    size: product?.size ?? "",
    color: product?.color ?? "",
    season: product?.season ?? "all",
    unit_price: String(product?.unit_price ?? ""),
    unit_cost: String(product?.unit_cost ?? ""),
    lead_time_days: String(product?.lead_time_days ?? "30"),
    safety_stock_days: String(product?.safety_stock_days ?? "30"),
    status: product?.status ?? "active",
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!f.name.trim()) throw new Error("Name required");
      const payload = {
        client_id: userId,
        sku: f.sku || undefined,
        name: f.name.trim(),
        description: f.description || null,
        category: f.category || null,
        subcategory: f.subcategory || null,
        gender: f.gender || null,
        size: f.size || null,
        color: f.color || null,
        season: f.season,
        unit_price: Number(f.unit_price) || 0,
        unit_cost: Number(f.unit_cost) || 0,
        // Fixed defaults (field hidden from the form) so low-stock indicators keep working.
        reorder_level: 10,
        lead_time_days: Number(f.lead_time_days) || 30,
        safety_stock_days: Number(f.safety_stock_days) || 30,
        status: f.status,
      };
      if (isEdit && product) {
        await api.products.update(product.id, payload);
      } else {
        await api.products.create(payload);
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["products"] }); toast.success(isEdit ? "Updated" : "Created"); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">{isEdit ? "Edit product" : "New product"}</h3>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-3">
            <L label="SKU (auto if blank)"><input className="inp" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} /></L>
            <L label="Product name *"><input required className="inp" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></L>
            <L label="Category">
              <select className="inp" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
                <option value="">—</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </L>
            <L label="Subcategory"><input className="inp" value={f.subcategory} onChange={(e) => setF({ ...f, subcategory: e.target.value })} placeholder="e.g. Running shoes" /></L>
            <L label="Gender">
              <select className="inp" value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })}>
                {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </L>
            <L label="Season">
              <select className="inp" value={f.season} onChange={(e) => setF({ ...f, season: e.target.value })}>
                {SEASONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </L>
            <L label="Size"><input className="inp" value={f.size} onChange={(e) => setF({ ...f, size: e.target.value })} placeholder="e.g. M, 42, XL" /></L>
            <L label="Color"><input className="inp" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} /></L>
            <L label="Unit price"><input type="number" step="0.01" className="inp" value={f.unit_price} onChange={(e) => setF({ ...f, unit_price: e.target.value })} /></L>
            <L label="Unit cost"><input type="number" step="0.01" className="inp" value={f.unit_cost} onChange={(e) => setF({ ...f, unit_cost: e.target.value })} /></L>
            <L label="Lead time (days)"><input type="number" className="inp" value={f.lead_time_days} onChange={(e) => setF({ ...f, lead_time_days: e.target.value })} /></L>
            <L label="Safety stock (days)"><input type="number" className="inp" value={f.safety_stock_days} onChange={(e) => setF({ ...f, safety_stock_days: e.target.value })} /></L>
            <L label="Status">
              <select className="inp" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                <option value="active">Active</option>
                <option value="discontinued">Discontinued</option>
              </select>
            </L>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
            <button disabled={save.isPending} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>{children}</label>;
}

function StatTile({ label, value, tone }: { label: string; value: string | number; tone?: "success" | "warning" | "destructive" }) {
  const t = tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : tone === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-1 font-display text-2xl ${t}`}>{value}</div>
    </div>
  );
}

function Pill({ children, tone }: { children: React.ReactNode; tone: "success" | "warning" | "destructive" }) {
  const s = tone === "success" ? "bg-success/10 text-success border-success/30"
    : tone === "warning" ? "bg-warning/10 text-warning border-warning/30"
    : "bg-destructive/10 text-destructive border-destructive/30";
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${s}`}>{children}</span>;
}
