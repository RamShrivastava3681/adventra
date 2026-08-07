import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import {
  Plus,
  X,
  Loader2,
  Truck,
  PackageCheck,
  PackageOpen,
  Ban,
  Trash2,
  ScanLine,
  CheckCircle2,
  Printer,
  Undo2,
  AlertTriangle,
  FileText,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { TableSkeleton } from "@/components/skeletons";
import { SearchableSelect } from "@/components/ui/searchable-select";

export const Route = createFileRoute("/app/dispatches")({
  component: DispatchesPage,
  validateSearch: (search: Record<string, unknown>): { soId?: string; soFilter?: string } => ({
    soId: typeof search.soId === "string" ? search.soId : undefined,
    soFilter: typeof search.soFilter === "string" ? search.soFilter : undefined,
  }),
});

// ─── Types (snake_case — the API transform middleware shapes responses) ───
type DispatchLine = {
  product_id: string;
  sku: string | null;
  name: string;
  unit: string;
  ordered_qty: number;
  dispatched_qty: number;
  delivered_qty: number;
  returned_qty: number;
  unit_price: number;
  line_value: number;
  notes: string | null;
};

type Dispatch = {
  id: string;
  dispatch_number: string;
  goods_sales_order_id: string;
  so_number: string | null;
  customer_id: string | null;
  customer_name: string | null;
  contact_person: string | null;
  delivery_address: string | null;
  warehouse: string | null;
  dispatch_date: string;
  transporter_name: string | null;
  tracking_number: string | null;
  delivery_challan_number: string | null;
  linked_customer_proforma_id: string | null;
  linked_customer_proforma_number: string | null;
  linked_sales_invoice_id: string | null;
  linked_sales_invoice_number: string | null;
  dispatched_by: string | null;
  delivery_date: string | null;
  delivered_by: string | null;
  returned_by: string | null;
  notes: string | null;
  status: string;
  stock_debited: boolean;
  debited_by: string | null;
  lines: DispatchLine[];
};

type SOLine = {
  product_id: string;
  sku: string | null;
  name: string;
  unit: string;
  ordered_qty: number;
  dispatched_qty: number;
  unit_price: number;
};

type SO = {
  id: string;
  so_number: string;
  order_date: string;
  customer_name: string | null;
  status: string;
  lines: SOLine[];
};

type CatalogueProduct = {
  id: string;
  sku: string | null;
  name: string;
  unit_of_measure: string;
  barcode: string | null;
  status: string;
};

const DISPATCH_STATUSES = [
  "draft",
  "confirmed",
  "partially_delivered",
  "delivered",
  "cancelled",
  "returned",
] as const;

const DISPATCH_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  confirmed: "Confirmed",
  partially_delivered: "Partially delivered",
  delivered: "Delivered",
  cancelled: "Cancelled",
  returned: "Returned",
};

const DISPATCH_STATUS_TONES: Record<string, string> = {
  draft: "bg-muted/60 text-muted-foreground border-border",
  confirmed: "bg-blue-500/10 text-blue-600 border-blue-500/30",
  partially_delivered: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  delivered: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  cancelled: "bg-destructive/10 text-destructive border-destructive/30",
  returned: "bg-fuchsia-500/10 text-fuchsia-600 border-fuchsia-500/30",
};

function DispatchesPage() {
  const { user, isSalesRep, isAdmin, isChecker } = useAuth();
  const canWrite = !isSalesRep && !!user;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { soId, soFilter } = Route.useSearch();
  const [filter, setFilter] = useState("all");
  const [soFilterSel, setSoFilterSel] = useState<string>(soFilter ?? "");
  const [createOpen, setCreateOpen] = useState(false);
  const [preselectSoId, setPreselectSoId] = useState<string | null>(null);
  const [view, setView] = useState<Dispatch | null>(null);

  // Coming from a Sales Order row ("Dispatch" button) — open the create modal
  // with that SO preselected.
  useEffect(() => {
    if (soId) {
      setPreselectSoId(soId);
      setCreateOpen(true);
      navigate({ to: "/app/dispatches", search: {}, replace: true });
    }
  }, [soId, navigate]);

  const dispatchQ = useQuery({
    queryKey: ["goods-dispatches"],
    queryFn: async () => {
      const data = (await api.goodsDispatches.list()) as Dispatch[];
      return data.sort((a, b) => (b.dispatch_date || "").localeCompare(a.dispatch_date || ""));
    },
  });
  const sosQ = useQuery({
    queryKey: ["goods-sos"],
    queryFn: async () => api.goodsSalesOrders.list(),
  });
  const productsQ = useQuery({
    queryKey: ["products-for-dispatch"],
    queryFn: async () => {
      const data = (await api.products.list()) as CatalogueProduct[];
      return data.filter((p) => p.status === "active");
    },
  });
  const stockQ = useQuery({
    queryKey: ["stock-for-dispatch"],
    queryFn: async () => api.stockMovements.list(),
  });
  const proformasQ = useQuery({
    queryKey: ["sales-proformas-for-dispatch"],
    queryFn: async () => {
      const data = (await api.purchaseOrders.list()) as any[];
      return data
        .filter((p) => p.side === "sales")
        .map((p) => ({
          id: p.id,
          number: p.proforma_number ?? p.po_number ?? p.id,
          customer: p.debtor?.name ?? null,
        }));
    },
  });
  const invoicesQ = useQuery({
    queryKey: ["invoices-for-dispatch"],
    queryFn: async () => {
      const data = (await api.invoices.list()) as any[];
      return data.map((i) => ({ id: i.id, number: i.invoice_number ?? i.id }));
    },
  });

  // Live stock balance per product (for the dispatch availability check).
  const stockBalance = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of (stockQ.data ?? []) as any[]) {
      if (!m.product_id || m.status !== "confirmed") continue;
      const qty = Number(m.quantity) || 0;
      map.set(m.product_id, (map.get(m.product_id) ?? 0) + (m.direction === "in" ? qty : -qty));
    }
    return map;
  }, [stockQ.data]);

  const filtered = (dispatchQ.data ?? []).filter(
    (d) =>
      (filter === "all" || d.status === filter) &&
      (!soFilterSel || d.goods_sales_order_id === soFilterSel),
  );

  const stats = useMemo(() => {
    const ds = dispatchQ.data ?? [];
    return {
      drafts: ds.filter((d) => d.status === "draft").length,
      toDeliver: ds.filter((d) => d.status === "confirmed").length,
      delivered: ds.filter((d) => ["delivered", "partially_delivered"].includes(d.status)).length,
      returned: ds.filter((d) => d.status === "returned").length,
    };
  }, [dispatchQ.data]);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["goods-dispatches"] });
    qc.invalidateQueries({ queryKey: ["goods-sos"] });
    qc.invalidateQueries({ queryKey: ["stock-for-dispatch"] });
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["stock_movements_all"] });
  };

  const setSoFilter = (v: string) => {
    setSoFilterSel(v);
    navigate({ to: "/app/dispatches", search: v ? { soFilter: v } : {}, replace: true });
  };

  return (
    <div>
      <PageHeader
        eyebrow="Inventory"
        title="Dispatch"
        description="The most important stock document on the sales side — a confirmed dispatch creates the automatic debit inventory entry."
        actions={
          canWrite ? (
            <button
              onClick={() => {
                setPreselectSoId(null);
                setCreateOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              <Plus className="h-4 w-4" /> Create from sales order
            </button>
          ) : (
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              Read-only
            </span>
          )
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Drafts" value={stats.drafts} icon={PackageOpen} />
          <StatTile label="Awaiting delivery" value={stats.toDeliver} icon={Truck} />
          <StatTile label="Delivered" value={stats.delivered} icon={PackageCheck} />
          <StatTile label="Returned" value={stats.returned} icon={Undo2} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {["all", ...DISPATCH_STATUSES].map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`rounded-full border px-3 py-1 text-xs uppercase tracking-widest transition ${
                filter === s
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {s === "all" ? "All" : DISPATCH_STATUS_LABELS[s]}
            </button>
          ))}
          <div className="ml-auto w-56">
            <SearchableSelect
              value={soFilterSel}
              onChange={setSoFilter}
              placeholder="All sales orders"
              searchPlaceholder="Search orders…"
              options={[
                { value: "", label: "All sales orders" },
                ...(sosQ.data ?? []).map((s: SO) => ({
                  value: s.id,
                  label: s.so_number,
                  hint: s.customer_name ?? undefined,
                })),
              ]}
            />
          </div>
        </div>

        <Card>
          {dispatchQ.isLoading ? (
            <TableSkeleton rows={6} cols={8} />
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              <Truck className="mx-auto mb-2 h-8 w-8 opacity-40" />
              No dispatch notes yet.
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Dispatch</th>
                    <th className="px-5 py-2 text-left font-normal">Customer</th>
                    <th className="px-5 py-2 text-left font-normal">Sales order</th>
                    <th className="px-5 py-2 text-left font-normal">Warehouse</th>
                    <th className="px-5 py-2 text-right font-normal">Qty</th>
                    <th className="px-5 py-2 text-left font-normal">Delivered</th>
                    <th className="px-5 py-2 text-left font-normal">Status</th>
                    <th className="px-5 py-2 text-right font-normal">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((d) => {
                    const qty = (d.lines ?? []).reduce((s, l) => s + l.dispatched_qty, 0);
                    const delivered = (d.lines ?? []).reduce(
                      (s, l) => s + (l.delivered_qty ?? 0),
                      0,
                    );
                    const pct = qty > 0 ? Math.min(100, Math.round((delivered / qty) * 100)) : 0;
                    return (
                      <tr key={d.id} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-3 font-mono text-xs">
                          {d.dispatch_number}
                          <div className="text-[10px] text-muted-foreground">
                            {fmtDate(d.dispatch_date)}
                          </div>
                        </td>
                        <td className="px-5 py-3">{d.customer_name ?? "—"}</td>
                        <td className="px-5 py-3 font-mono text-xs">{d.so_number ?? "—"}</td>
                        <td className="px-5 py-3 text-xs text-muted-foreground">
                          {d.warehouse || "—"}
                        </td>
                        <td className="px-5 py-3 text-right num">{qty.toLocaleString()}</td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                              <div
                                className={`h-full rounded-full ${pct >= 100 ? "bg-success" : "bg-primary"}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-[10px] tabular-nums text-muted-foreground">
                              {delivered}/{qty}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <StatusPill
                            status={d.status}
                            label={DISPATCH_STATUS_LABELS[d.status] ?? d.status}
                            tone={DISPATCH_STATUS_TONES[d.status]}
                          />
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button
                            onClick={() => setView(d)}
                            className="rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary"
                          >
                            View
                          </button>
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

      {createOpen && user && (
        <DispatchCreateModal
          userId={user.id}
          preselectSoId={preselectSoId}
          sos={(sosQ.data ?? []).filter((s: SO) => ["confirmed", "partially_dispatched"].includes(s.status))}
          products={productsQ.data ?? []}
          stockBalance={stockBalance}
          proformas={proformasQ.data ?? []}
          invoices={invoicesQ.data ?? []}
          onClose={() => setCreateOpen(false)}
          onDone={invalidateAll}
        />
      )}
      {view && (
        <DispatchDetailModal
          dispatch={view}
          canWrite={canWrite}
          canApproveOverDispatch={isAdmin || isChecker}
          stockBalance={stockBalance}
          onClose={() => setView(null)}
          onChanged={() => {
            invalidateAll();
            const fresh = (dispatchQ.data ?? []).find((d) => d.id === view.id);
            if (fresh) setView(fresh);
          }}
        />
      )}
    </div>
  );
}

// ─── Create dispatch modal (from a sales order) ──────────────────────────
type DispatchLineDraft = {
  product_id: string;
  sku: string | null;
  name: string;
  unit: string;
  ordered_qty: number;
  dispatched_qty: string;
  unit_price: string;
};

function DispatchCreateModal({
  userId,
  preselectSoId,
  sos,
  products,
  stockBalance,
  proformas,
  invoices,
  onClose,
  onDone,
}: {
  userId: string;
  preselectSoId: string | null;
  sos: SO[];
  products: CatalogueProduct[];
  stockBalance: Map<string, number>;
  proformas: Array<{ id: string; number: string; customer: string | null }>;
  invoices: Array<{ id: string; number: string }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [soId, setSoId] = useState<string>(preselectSoId ?? "");
  const [f, setF] = useState({
    dispatch_date: new Date().toISOString().slice(0, 10),
    warehouse: "",
    transporter_name: "",
    tracking_number: "",
    delivery_challan_number: "",
    linked_customer_proforma_id: "",
    linked_sales_invoice_id: "",
    notes: "",
  });
  const [lines, setLines] = useState<DispatchLineDraft[]>([]);
  const [scan, setScan] = useState("");
  const so = sos.find((s) => s.id === soId) ?? null;

  // When the SO is picked, preload all lines with pending quantity.
  const pickSo = (id: string) => {
    setSoId(id);
    const s = sos.find((x) => x.id === id);
    setLines(
      (s?.lines ?? [])
        .filter((l) => l.ordered_qty - (l.dispatched_qty ?? 0) > 0)
        .map((l) => ({
          product_id: l.product_id,
          sku: l.sku,
          name: l.name,
          unit: l.unit,
          ordered_qty: l.ordered_qty,
          dispatched_qty: "",
          unit_price: String(l.unit_price),
        })),
    );
  };

  // Preload lines when arriving pre-selected from a sales order row.
  useEffect(() => {
    if (preselectSoId) pickSo(preselectSoId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLine = (i: number, patch: Partial<DispatchLineDraft>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const handleScan = () => {
    const q = scan.trim().toLowerCase();
    if (!q) return;
    const product = products.find(
      (p) =>
        (p.barcode ?? "").toLowerCase() === q ||
        (p.sku ?? "").toLowerCase() === q ||
        p.id.toLowerCase() === q,
    );
    if (!product) {
      toast.error("No catalogue product matches that barcode/SKU");
      return;
    }
    const soLine = so?.lines?.find((l) => l.product_id === product.id);
    if (!soLine) {
      toast.error(`${product.name} is not on this sales order`);
      return;
    }
    const pending = soLine.ordered_qty - (soLine.dispatched_qty ?? 0);
    const idx = lines.findIndex((l) => l.product_id === product.id);
    if (idx === -1) {
      setLines((ls) => [
        ...ls,
        {
          product_id: product.id,
          sku: product.sku,
          name: product.name,
          unit: product.unit_of_measure ?? "piece",
          ordered_qty: soLine.ordered_qty,
          dispatched_qty: "1",
          unit_price: String(soLine.unit_price),
        },
      ]);
    } else {
      setLines((ls) =>
        ls.map((l, i) => {
          if (i !== idx) return l;
          const next = Math.min(pending, (Number(l.dispatched_qty) || 0) + 1);
          return { ...l, dispatched_qty: String(next) };
        }),
      );
    }
    setScan("");
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!soId) throw new Error("Select a sales order to dispatch against");
      const payloadLines = lines
        .filter((l) => (Number(l.dispatched_qty) || 0) > 0)
        .map((l) => ({
          product_id: l.product_id,
          dispatched_qty: Number(l.dispatched_qty) || 0,
          unit_price: Number(l.unit_price) || 0,
        }));
      if (payloadLines.length === 0) throw new Error("Enter a dispatched quantity for at least one line");
      for (const l of payloadLines) {
        const soLine = so?.lines?.find((x) => x.product_id === l.product_id);
        const pending = Math.max(0, (soLine?.ordered_qty ?? 0) - (soLine?.dispatched_qty ?? 0));
        if (l.dispatched_qty > pending) {
          throw new Error(`Dispatch cannot exceed pending (${pending}) for ${soLine?.name}`);
        }
      }
      await api.goodsDispatches.create({
        goods_sales_order_id: soId,
        dispatch_date: f.dispatch_date,
        warehouse: f.warehouse.trim() || null,
        transporter_name: f.transporter_name.trim() || null,
        tracking_number: f.tracking_number.trim() || null,
        delivery_challan_number: f.delivery_challan_number.trim() || null,
        linked_customer_proforma_id: f.linked_customer_proforma_id || null,
        linked_sales_invoice_id: f.linked_sales_invoice_id || null,
        notes: f.notes.trim() || null,
        lines: payloadLines,
      });
    },
    onSuccess: () => {
      toast.success("Draft dispatch note recorded — confirm it to debit inventory");
      onDone();
      qc.invalidateQueries({ queryKey: ["sales-proformas-for-dispatch"] });
      qc.invalidateQueries({ queryKey: ["invoices-for-dispatch"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const qtyTotal = lines.reduce((s, l) => s + (Number(l.dispatched_qty) || 0), 0);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-border bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <div>
            <h3 className="font-display text-lg">New dispatch</h3>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Creates a draft — inventory is debited only when the dispatch is confirmed.
            </div>
          </div>
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
          {/* Header */}
          <fieldset className="rounded-lg border border-border/60 p-4">
            <legend className="px-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Dispatch header
            </legend>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <L label="Linked sales order">
                <SearchableSelect
                  value={soId}
                  onChange={pickSo}
                  placeholder="Select sales order…"
                  disabled={!!preselectSoId}
                  options={[
                    { value: "", label: "Select sales order…" },
                    ...sos.map((s) => ({
                      value: s.id,
                      label: s.so_number,
                      hint: s.customer_name ?? undefined,
                    })),
                  ]}
                />
              </L>
              <L label="Dispatch date">
                <input
                  type="date"
                  className="inp"
                  value={f.dispatch_date}
                  onChange={(e) => setF({ ...f, dispatch_date: e.target.value })}
                />
              </L>
              <L label="Warehouse / store">
                <input
                  className="inp"
                  value={f.warehouse}
                  onChange={(e) => setF({ ...f, warehouse: e.target.value })}
                  placeholder="e.g. Main store"
                />
              </L>
              <L label="Transporter / courier">
                <input
                  className="inp"
                  value={f.transporter_name}
                  onChange={(e) => setF({ ...f, transporter_name: e.target.value })}
                  placeholder="Optional"
                />
              </L>
              <L label="Tracking / AWB number">
                <input
                  className="inp"
                  value={f.tracking_number}
                  onChange={(e) => setF({ ...f, tracking_number: e.target.value })}
                  placeholder="Optional"
                />
              </L>
              <L label="Delivery challan number">
                <input
                  className="inp"
                  value={f.delivery_challan_number}
                  onChange={(e) => setF({ ...f, delivery_challan_number: e.target.value })}
                  placeholder="Optional"
                />
              </L>
              <L label="Linked customer proforma">
                <SearchableSelect
                  value={f.linked_customer_proforma_id}
                  onChange={(v) => setF({ ...f, linked_customer_proforma_id: v })}
                  placeholder="None"
                  options={[
                    { value: "", label: "None" },
                    ...proformas.map((p: any) => ({
                      value: p.id,
                      label: p.number,
                      hint: p.customer ?? undefined,
                    })),
                  ]}
                />
              </L>
              <L label="Linked sales invoice">
                <SearchableSelect
                  value={f.linked_sales_invoice_id}
                  onChange={(v) => setF({ ...f, linked_sales_invoice_id: v })}
                  placeholder="None"
                  options={[
                    { value: "", label: "None" },
                    ...invoices.map((i: any) => ({
                      value: i.id,
                      label: i.number,
                    })),
                  ]}
                />
              </L>
              <div className="col-span-2 md:col-span-1">
                <L label="Customer">
                  <input className="inp" value={so?.customer_name ?? ""} disabled />
                </L>
              </div>
            </div>
            <div className="mt-3">
              <L label="Notes">
                <textarea
                  rows={2}
                  className="inp resize-y"
                  value={f.notes}
                  onChange={(e) => setF({ ...f, notes: e.target.value })}
                  placeholder="Packing instructions, courier details…"
                />
              </L>
            </div>
          </fieldset>

          {/* Barcode scan */}
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
            <L label="Barcode scan">
              <div className="flex items-center gap-2">
                <ScanLine className="h-4 w-4 shrink-0 text-primary" />
                <input
                  className="inp"
                  value={scan}
                  onChange={(e) => setScan(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleScan();
                    }
                  }}
                  placeholder={
                    so
                      ? "Scan a product barcode or type a SKU and press Enter — dispatched qty +1"
                      : "Pick a sales order first, then scan barcodes"
                  }
                  disabled={!so}
                />
              </div>
            </L>
          </div>

          {/* Line items */}
          <fieldset className="rounded-lg border border-border/60 p-4">
            <legend className="px-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Dispatch item lines
            </legend>
            {!so ? (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
                Select a sales order to load its item lines.
              </div>
            ) : lines.length === 0 ? (
              <div className="rounded-md border border-border/40 p-3 text-xs text-muted-foreground">
                No pending quantities on this sales order — everything is already dispatched.
              </div>
            ) : (
              <div className="space-y-2">
                <div className="hidden grid-cols-12 gap-2 text-[9px] uppercase tracking-widest text-muted-foreground md:grid">
                  <div className="col-span-4">SKU / Product</div>
                  <div className="col-span-1">Ordered</div>
                  <div className="col-span-2">Available</div>
                  <div className="col-span-1">Pending</div>
                  <div className="col-span-2">Dispatch qty</div>
                  <div className="col-span-2 text-right">Unit price</div>
                </div>
                {lines.map((l, i) => {
                  const pending = Math.max(0, l.ordered_qty - (so.lines.find((x) => x.product_id === l.product_id)?.dispatched_qty ?? 0));
                  const available = stockBalance.get(l.product_id) ?? 0;
                  const q = Number(l.dispatched_qty) || 0;
                  const short = q > 0 && q > available;
                  return (
                    <div
                      key={l.product_id}
                      className="grid grid-cols-2 items-end gap-2 rounded-md border border-border/50 p-2 md:grid-cols-12"
                    >
                      <div className="col-span-2 md:col-span-4">
                        <div className="text-sm font-medium">{l.name}</div>
                        <div className="text-[10px] font-mono text-muted-foreground">
                          {l.sku ?? ""}
                        </div>
                      </div>
                      <div>
                        <L label="Ordered">
                          <div className="inp bg-muted/40 text-right">
                            {l.ordered_qty.toLocaleString()}
                          </div>
                        </L>
                      </div>
                      <div className="md:col-span-2">
                        <L label="Available">
                          <div className={`inp bg-muted/40 text-right ${short ? "!border-warning" : ""}`}>
                            {available.toLocaleString()}
                          </div>
                        </L>
                      </div>
                      <div>
                        <L label="Pending">
                          <div className="inp bg-muted/40 text-right">{pending.toLocaleString()}</div>
                        </L>
                      </div>
                      <div className="md:col-span-2">
                        <L label="Dispatch qty">
                          <input
                            type="number"
                            min="0"
                            max={pending}
                            step="0.001"
                            className="inp text-right"
                            value={l.dispatched_qty}
                            onChange={(e) => setLine(i, { dispatched_qty: e.target.value })}
                          />
                        </L>
                      </div>
                      <div className="text-right md:col-span-2">
                        <L label="Unit price">
                          <div className="inp bg-muted/40 text-right font-mono">
                            {fmtMoney(Number(l.unit_price) || 0)}
                          </div>
                        </L>
                      </div>
                    </div>
                  );
                })}
                {shortLinesCount(lines, stockBalance) > 0 && (
                  <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      Some lines dispatch more than what is currently in stock. You can still
                      proceed — stock availability is only a warning at confirm time.
                    </span>
                  </div>
                )}
              </div>
            )}
          </fieldset>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <p className="text-[10px] text-muted-foreground">
              {qtyTotal > 0 ? `${qtyTotal.toLocaleString()} units to dispatch` : "No quantity entered yet"}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-border px-4 py-2 text-sm"
              >
                Close
              </button>
              <button
                disabled={save.isPending}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Record draft dispatch
              </button>
            </div>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:disabled{opacity:.55}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

function shortLinesCount(lines: DispatchLineDraft[], stockBalance: Map<string, number>): number {
  let n = 0;
  for (const l of lines) {
    const q = Number(l.dispatched_qty) || 0;
    if (q > 0 && q > (stockBalance.get(l.product_id) ?? 0)) n += 1;
  }
  return n;
}

// ─── Dispatch detail modal (view + actions) ─────────────────────────────
function DispatchDetailModal({
  dispatch,
  canWrite,
  canApproveOverDispatch,
  stockBalance,
  onClose,
  onChanged,
}: {
  dispatch: Dispatch;
  canWrite: boolean;
  canApproveOverDispatch: boolean;
  stockBalance: Map<string, number>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const invalidate = () => {
    onChanged();
    qc.invalidateQueries({ queryKey: ["goods-dispatches"] });
    qc.invalidateQueries({ queryKey: ["goods-sos"] });
    qc.invalidateQueries({ queryKey: ["stock-for-dispatch"] });
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["stock_movements_all"] });
  };

  const confirm = useMutation({
    mutationFn: async () => {
      const res = (await api.goodsDispatches.confirm(dispatch.id, {
        allow_over_dispatch: canApproveOverDispatch,
      })) as any;
      return res;
    },
    onSuccess: (res) => {
      invalidate();
      setBusy(null);
      const warnings: string[] = res?.stock_warnings ?? [];
      if (warnings.length > 0) {
        toast.warning("Dispatch confirmed — inventory debited with low-stock warnings");
        warnings.forEach((w) => toast.warning(w));
      } else {
        toast.success("Dispatch confirmed — inventory debited");
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const cancel = useMutation({
    mutationFn: async () => {
      await api.goodsDispatches.cancel(dispatch.id);
    },
    onSuccess: () => {
      invalidate();
      setBusy(null);
      toast.success("Dispatch cancelled — stock reversed");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const del = useMutation({
    mutationFn: async () => {
      await api.goodsDispatches.delete(dispatch.id);
    },
    onSuccess: () => {
      invalidate();
      onClose();
      toast.success("Draft dispatch deleted");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const run = (action: "confirm" | "cancel" | "delete") => {
    if (busy) return;
    setBusy(action);
    if (action === "confirm") confirm.mutate();
    else if (action === "cancel") cancel.mutate();
    else del.mutate();
  };

  const d = dispatch;
  const qty = (d.lines ?? []).reduce((s, l) => s + l.dispatched_qty, 0);
  const delivered = (d.lines ?? []).reduce((s, l) => s + (l.delivered_qty ?? 0), 0);
  const returned = (d.lines ?? []).reduce((s, l) => s + (l.returned_qty ?? 0), 0);

  return (
    <>
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <div>
            <h3 className="font-display text-lg">Dispatch {d.dispatch_number}</h3>
            <div className="mt-0.5">
              <StatusPill
                status={d.status}
                label={DISPATCH_STATUS_LABELS[d.status] ?? d.status}
                tone={DISPATCH_STATUS_TONES[d.status]}
              />
            </div>
          </div>
          <button onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5 text-sm">
          {/* Header info */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-border/60 p-4 md:grid-cols-3">
            <D label="Customer" value={d.customer_name ?? "—"} />
            <D label="Sales order" value={d.so_number ?? "—"} />
            <D label="Dispatch date" value={d.dispatch_date ? fmtDate(d.dispatch_date) : "—"} />
            <D label="Warehouse" value={d.warehouse ?? "—"} />
            <D label="Delivery address" value={d.delivery_address ?? "—"} />
            <D label="Transporter" value={d.transporter_name ?? "—"} />
            <D label="Tracking / AWB" value={d.tracking_number ?? "—"} />
            <D label="Delivery challan" value={d.delivery_challan_number ?? "—"} />
            <D
              label="Linked proforma"
              value={d.linked_customer_proforma_number ?? "—"}
            />
            <D label="Linked sales invoice" value={d.linked_sales_invoice_number ?? "—"} />
            <D label="Created by" value={d.dispatched_by ?? "—"} />
            <D label="Confirmed by" value={d.stock_debited ? (d.debited_by ?? "—") : "—"} />
          </div>

          {/* Lines */}
          <div className="overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-normal">Product</th>
                  <th className="px-3 py-2 text-right font-normal">Dispatched</th>
                  <th className="px-3 py-2 text-right font-normal">Delivered</th>
                  <th className="px-3 py-2 text-right font-normal">Returned</th>
                  <th className="px-3 py-2 text-right font-normal">Unit price</th>
                  <th className="px-3 py-2 text-right font-normal">Value</th>
                </tr>
              </thead>
              <tbody>
                {(d.lines ?? []).map((l) => (
                  <tr key={l.product_id} className="border-b border-border/40">
                    <td className="px-3 py-2">
                      <div className="font-medium">{l.name}</div>
                      {l.sku && (
                        <div className="text-[10px] font-mono text-muted-foreground">{l.sku}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right num">{l.dispatched_qty.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right num">
                      {(l.delivered_qty ?? 0).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {(l.returned_qty ?? 0).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right num">{fmtMoney(l.unit_price)}</td>
                    <td className="px-3 py-2 text-right num">{fmtMoney(l.line_value)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="text-xs">
                  <td className="px-3 py-2 font-medium" colSpan={5}>
                    Totals
                  </td>
                  <td className="px-3 py-2 text-right num">
                    {fmtMoney((d.lines ?? []).reduce((s, l) => s + (l.line_value ?? 0), 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex flex-wrap gap-3 text-[10px] uppercase tracking-widest text-muted-foreground">
            <span className="rounded bg-muted px-2 py-1">Qty {qty.toLocaleString()}</span>
            <span className="rounded bg-success/10 px-2 py-1 text-success">
              Delivered {delivered.toLocaleString()}
            </span>
            <span className="rounded bg-fuchsia-500/10 px-2 py-1 text-fuchsia-600">
              Returned {returned.toLocaleString()}
            </span>
          </div>

          {d.notes && (
            <div className="rounded-md border border-border/40 p-3 text-xs text-muted-foreground">
              Note: {d.notes}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            {canWrite && d.status === "draft" && (
              <button
                onClick={() => run("confirm")}
                disabled={!!busy}
                className="inline-flex items-center gap-1.5 rounded-md border border-success/50 px-3 py-1.5 text-xs font-medium text-success hover:bg-success/10 disabled:opacity-50"
              >
                {busy === "confirm" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <PackageCheck className="h-3.5 w-3.5" />
                )}
                Confirm dispatch (debit stock)
              </button>
            )}
            {canWrite && ["confirmed", "partially_delivered"].includes(d.status) && (
              <button
                onClick={() => setDeliverOpen(true)}
                disabled={!!busy}
                className="inline-flex items-center gap-1.5 rounded-md border border-primary/50 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Mark delivered
              </button>
            )}
            {canWrite &&
              ["confirmed", "partially_delivered", "delivered"].includes(d.status) && (
                <button
                  onClick={() => setReturnOpen(true)}
                  disabled={!!busy}
                  className="inline-flex items-center gap-1.5 rounded-md border border-fuchsia-500/40 px-3 py-1.5 text-xs font-medium text-fuchsia-600 hover:bg-fuchsia-500/10 disabled:opacity-50"
                >
                  <Undo2 className="h-3.5 w-3.5" /> Record return
                </button>
              )}
            <Link
              to="/app/challan/$dispatchId"
              params={{ dispatchId: d.id }}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:border-primary hover:text-primary"
            >
              <Printer className="h-3.5 w-3.5" /> Print delivery challan
            </Link>
            {canWrite && ["draft", "confirmed", "partially_delivered", "delivered"].includes(d.status) && (
              <button
                onClick={() => run("cancel")}
                disabled={!!busy}
                className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                {busy === "cancel" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Ban className="h-3.5 w-3.5" />
                )}
                Cancel dispatch
              </button>
            )}
            {canWrite && d.status === "draft" && (
              <button
                onClick={() => run("delete")}
                disabled={!!busy}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-destructive hover:text-destructive disabled:opacity-50"
              >
                {busy === "delete" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Delete draft
              </button>
            )}
          </div>

          {stockBalance.size > 0 && (d.lines ?? []).some((l) => (stockBalance.get(l.product_id) ?? 0) < l.dispatched_qty && d.status !== "draft") && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Some dispatched lines exceed current available stock — review inventory before
                further action.
              </span>
            </div>
          )}
        </div>

      </div>
    </div>

      {deliverOpen && (
        <DeliverModal
          dispatch={d}
          onClose={() => setDeliverOpen(false)}
          onDone={() => {
            setDeliverOpen(false);
            invalidate();
          }}
        />
      )}
      {returnOpen && (
        <ReturnModal
          dispatch={d}
          onClose={() => setReturnOpen(false)}
          onDone={() => {
            setReturnOpen(false);
            invalidate();
          }}
        />
      )}
    </>
  );
}

// ─── Mark delivered modal ────────────────────────────────────────────────
function DeliverModal({
  dispatch,
  onClose,
  onDone,
}: {
  dispatch: Dispatch;
  onClose: () => void;
  onDone: () => void;
}) {
  const [deliveryDate, setDeliveryDate] = useState(new Date().toISOString().slice(0, 10));
  const [qty, setQty] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const l of dispatch.lines ?? []) {
      const remaining = l.dispatched_qty - (l.delivered_qty ?? 0);
      if (remaining > 0) init[l.product_id] = String(remaining);
    }
    return init;
  });

  const save = useMutation({
    mutationFn: async () => {
      const lines = (dispatch.lines ?? [])
        .map((l) => ({
          product_id: l.product_id,
          delivered_qty: Number(qty[l.product_id]) || 0,
        }))
        .filter((x) => x.delivered_qty > 0);
      if (lines.length === 0) throw new Error("Enter a delivered quantity for at least one line");
      await api.goodsDispatches.deliver(dispatch.id, {
        delivery_date: deliveryDate,
        lines,
      });
    },
    onSuccess: () => {
      toast.success("Delivery recorded");
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-border bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">Mark delivered — {dispatch.dispatch_number}</h3>
          <button onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-4 p-5"
        >
          <L label="Delivery date">
            <input
              type="date"
              className="inp"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
            />
          </L>
          <div className="overflow-x-auto rounded-md border border-border/60">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-normal">Product</th>
                  <th className="px-3 py-2 text-right font-normal">Dispatched</th>
                  <th className="px-3 py-2 text-right font-normal">Already delivered</th>
                  <th className="px-3 py-2 text-right font-normal">Deliver now</th>
                </tr>
              </thead>
              <tbody>
                {(dispatch.lines ?? []).map((l) => {
                  const remaining = l.dispatched_qty - (l.delivered_qty ?? 0);
                  return (
                    <tr key={l.product_id} className="border-b border-border/40">
                      <td className="px-3 py-2">
                        <div className="font-medium">{l.name}</div>
                        {l.sku && (
                          <div className="text-[10px] font-mono text-muted-foreground">{l.sku}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right num">{l.dispatched_qty.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right num">
                        {(l.delivered_qty ?? 0).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min="0"
                          max={remaining}
                          step="0.001"
                          className="inp !w-24 text-right"
                          value={qty[l.product_id] ?? ""}
                          onChange={(e) =>
                            setQty((r) => ({ ...r, [l.product_id]: e.target.value }))
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm"
            >
              Close
            </button>
            <button
              disabled={save.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Record delivery
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Record return modal ─────────────────────────────────────────────────
function ReturnModal({
  dispatch,
  onClose,
  onDone,
}: {
  dispatch: Dispatch;
  onClose: () => void;
  onDone: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [qty, setQty] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const l of dispatch.lines ?? []) {
      const remaining = l.dispatched_qty - (l.returned_qty ?? 0);
      if (remaining > 0) init[l.product_id] = String(remaining);
    }
    return init;
  });

  const save = useMutation({
    mutationFn: async () => {
      const lines = (dispatch.lines ?? [])
        .map((l) => ({
          product_id: l.product_id,
          returned_qty: Number(qty[l.product_id]) || 0,
        }))
        .filter((x) => x.returned_qty > 0);
      if (lines.length === 0) throw new Error("Enter a returned quantity for at least one line");
      await api.goodsDispatches.return(dispatch.id, {
        notes: notes.trim() || null,
        lines,
      });
    },
    onSuccess: () => {
      toast.success("Return recorded — stock credited back, dispatch closed");
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-border bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">Record return — {dispatch.dispatch_number}</h3>
          <button onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-4 p-5"
        >
          <div className="flex items-start gap-2 rounded-md border border-fuchsia-500/30 bg-fuchsia-500/5 p-3 text-xs text-fuchsia-700">
            <Undo2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Returned quantities are credited back into inventory and removed from the sales
              order's dispatched total, so the order can be re-dispatched. The dispatch note is
              then closed as Returned.
            </span>
          </div>
          <div className="overflow-x-auto rounded-md border border-border/60">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-normal">Product</th>
                  <th className="px-3 py-2 text-right font-normal">Dispatched</th>
                  <th className="px-3 py-2 text-right font-normal">Already returned</th>
                  <th className="px-3 py-2 text-right font-normal">Return qty</th>
                </tr>
              </thead>
              <tbody>
                {(dispatch.lines ?? []).map((l) => {
                  const remaining = l.dispatched_qty - (l.returned_qty ?? 0);
                  return (
                    <tr key={l.product_id} className="border-b border-border/40">
                      <td className="px-3 py-2">
                        <div className="font-medium">{l.name}</div>
                        {l.sku && (
                          <div className="text-[10px] font-mono text-muted-foreground">{l.sku}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right num">{l.dispatched_qty.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right num">
                        {(l.returned_qty ?? 0).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min="0"
                          max={remaining}
                          step="0.001"
                          className="inp !w-24 text-right"
                          value={qty[l.product_id] ?? ""}
                          onChange={(e) =>
                            setQty((r) => ({ ...r, [l.product_id]: e.target.value }))
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <L label="Return notes">
            <textarea
              rows={2}
              className="inp resize-y"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason for return, condition of goods…"
            />
          </L>
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm"
            >
              Close
            </button>
            <button
              disabled={save.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Record return
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Small helpers ───────────────────────────────────────────────────────
function D({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm">{value}</div>
    </div>
  );
}

function StatusPill({ status, label, tone }: { status: string; label: string; tone?: string }) {
  const cls =
    tone ?? DISPATCH_STATUS_TONES[status] ?? "bg-muted/60 text-muted-foreground border-border";
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${cls}`}
    >
      {label}
    </span>
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
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
        <Icon className="h-4 w-4 text-muted-foreground/60" />
      </div>
      <div className="mt-1 font-display text-2xl">{value}</div>
    </div>
  );
}
