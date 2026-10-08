import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import {
  Card,
  EmptyState,
  StatusPill,
  fmtMoney,
  fmtDate,
} from "@/components/ledger-ui";
import {
  Warehouse,
  Truck,
  PackageCheck,
  ClipboardCheck,
  Boxes,
  BarChart3,
  CheckCircle2,
  Ban,
  Pencil,
  X,
  Loader2,
  FileText,
  Clock3,
  AlertTriangle,
  Search,
  ArrowUpDown,
  PackagePlus,
} from "lucide-react";
import { TableSkeleton } from "@/components/skeletons";
import { toast } from "sonner";
import { AwaitingPickupTransportModal } from "@/components/dispatch-workflow";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { inputBase } from "@/components/dialog";

export const Route = createFileRoute("/app/warehouse")({
  component: WarehousePage,
  head: () => ({
    meta: [
      { title: "Warehouse control | Whizunik Command" },
      {
        name: "description",
        content:
          "Warehouse dashboard: sales-order sign-offs, dispatch readiness, live shipment pipeline, stock on hand and movement reports.",
      },
    ],
  }),
});

// --- Warehouse dispatch pipeline: picking → packing → awaiting pickup → dispatched → … ---
// Stock debits only on Dispatched. Awaiting Pickup is the Finance handoff:
// selecting it pops the transporter form and the details go to Finance.
const SHIPPING_STATUSES = [
  "picking",
  "packed",
  "awaiting_pick",
  "dispatched",
  "in_transit",
  "delivered",
] as const;
type ShippingStatus = (typeof SHIPPING_STATUSES)[number];

const SHIPPING_LABEL: Record<string, string> = {
  awaiting_pick: "Awaiting Pickup",
  picking: "Picking",
  packed: "Packing",
  dispatched: "Dispatched",
  in_transit: "In Transit",
  delivered: "Delivered",
};

function shippingTone(s: string) {
  if (s === "delivered") return "bg-sem-success/15 text-sem-success";
  if (s === "dispatched" || s === "in_transit") return "bg-primary/15 text-primary";
  if (s === "packed") return "bg-sem-attention/15 text-sem-attention";
  return "bg-muted text-muted-foreground";
}

// ─── Types (snake_case — the backend response transform) ──
type SOLine = {
  product_id: string;
  sku: string | null;
  name: string;
  unit: string;
  ordered_qty: number;
  dispatched_qty: number;
  unit_price: number;
  discount_pct: number | null;
};

type SO = {
  id: string;
  so_number: string;
  order_date: string;
  customer_name: string | null;
  expected_dispatch_date: string | null;
  status: string;
  grand_total: number;
  warehouse_status: "pending" | "approved" | "on_hold" | "rejected" | null;
  warehouse_notes: string | null;
  warehouse_approved_at: string | null;
  warehouse: string | null;
  lines: SOLine[];
};

type DispatchLine = {
  product_id: string;
  name: string;
  ordered_qty: number;
  dispatched_qty: number;
  delivered_qty: number;
};

type Dispatch = {
  id: string;
  dispatch_number: string;
  so_number: string | null;
  customer_name: string | null;
  warehouse: string | null;
  dispatch_date: string;
  status: string;
  transporter_name: string | null;
  tracking_number: string | null;
  shipping_status: ShippingStatus | null;
  shipping_status_at: string | null;
  shipping_status_by: string | null;
  shipping_notes: string | null;
  /** Final sales invoice linked at IRN time (used to flag invoiced dispatches). */
  linked_sales_invoice_id: string | null;
  lines: DispatchLine[];
};

type Movement = {
  id: string;
  direction: "in" | "out";
  item_name: string;
  sku: string | null;
  quantity: number;
  unit: string;
  unit_cost: number | null;
  warehouse: string | null;
  status: "draft" | "confirmed" | "cancelled";
  movement_date: string;
  goods_dispatch_id: string | null;
  goods_receipt_id: string | null;
  sales_order_id: string | null;
  invoice_id: string | null;
  purchase_invoice_id: string | null;
  linked_document_number: string | null;
  reason: string | null;
  source_location_id: string | null;
  destination_location_id: string | null;
};

type Tab = "overview" | "orders" | "open" | "ready" | "dispatches" | "movements" | "manual";

type OpenSort = "date_desc" | "date_asc" | "customer_asc" | "customer_desc";

// Reasons a user may pick on a MANUAL stock entry (same set as Inventory).
const MANUAL_REASONS: { label: string; direction: "in" | "out" }[] = [
  { label: "Opening stock", direction: "in" },
  { label: "Stock adjustment", direction: "in" },
  { label: "Damage", direction: "out" },
  { label: "Samples / internal use", direction: "out" },
  { label: "Customer return", direction: "in" },
  { label: "Supplier return", direction: "out" },
];

export function WarehousePage() {
  const { user, isAdmin, isOperations } = useAuth();
  const canWrite = isAdmin || isOperations;
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");
  const [openSearch, setOpenSearch] = useState("");
  const [openSort, setOpenSort] = useState<OpenSort>("date_desc");
  // Workbench-level UI state (presentation only — no workflow change)
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const ordersQ = useQuery({
    queryKey: ["wh_sales_orders"],
    queryFn: () => api.goodsSalesOrders.list(),
  });
  const dispatchesQ = useQuery({
    queryKey: ["wh_dispatches"],
    queryFn: () => api.goodsDispatches.list(),
  });
  const invoicesQ = useQuery({
    queryKey: ["wh_invoices"],
    queryFn: () => api.invoices.list(),
  });
  const movementsQ = useQuery({
    queryKey: ["wh_movements"],
    queryFn: () => api.stockMovements.list(),
  });

  // ── Manual stock entry tab ──
  const [mmProductId, setMmProductId] = useState("");
  const [mmReason, setMmReason] = useState("");
  const [mmDirection, setMmDirection] = useState<"in" | "out">("in");
  const [mmQty, setMmQty] = useState("1");
  const [mmUnitCost, setMmUnitCost] = useState("");
  const [mmWarehouse, setMmWarehouse] = useState("");
  const [mmDate, setMmDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [mmNotes, setMmNotes] = useState("");

  const mmProductsQ = useQuery({
    queryKey: ["wh-products-manual"],
    queryFn: async () => {
      const data = await api.products.list();
      return (data as any[])
        .map((p) => ({
          id: p.id,
          sku: p.sku ?? null,
          name: p.name ?? "",
          unit: p.unitOfMeasure ?? p.unit_of_measure ?? "unit",
          unitCost: p.unitCost ?? p.unit_cost ?? 0,
          mrp: p.mrp ?? null,
        }))
        .sort(
          (a, b) =>
            String(a.sku ?? "").localeCompare(String(b.sku ?? "")) ||
            String(a.name ?? "").localeCompare(String(b.name ?? "")),
        );
    },
    enabled: tab === "manual",
  });
  const mmSelected = (mmProductsQ.data ?? []).find((p) => p.id === mmProductId);
  const mmAutoValue = (p: { unitCost: number; mrp: number | null }, direction: "in" | "out") =>
    String(direction === "out" ? (p.mrp ?? p.unitCost ?? "") : (p.unitCost ?? ""));
  const mmPickProduct = (pid: string) => {
    const p = (mmProductsQ.data ?? []).find((x) => x.id === pid);
    setMmProductId(pid);
    setMmUnitCost(p ? mmAutoValue(p, mmDirection) : mmUnitCost);
  };
  const mmPickReason = (reason: string) => {
    const meta = MANUAL_REASONS.find((r) => r.label === reason);
    const dir = meta?.direction ?? mmDirection;
    setMmReason(reason);
    if (dir !== mmDirection) {
      setMmDirection(dir);
      if (mmSelected) setMmUnitCost(mmAutoValue(mmSelected, dir));
    }
  };
  const mmReset = () => {
    setMmProductId("");
    setMmReason("");
    setMmDirection("in");
    setMmQty("1");
    setMmUnitCost("");
    setMmWarehouse("");
    setMmNotes("");
    setMmDate(new Date().toISOString().slice(0, 10));
  };
  const mmSave = useMutation({
    mutationFn: async (confirmNow: boolean) => {
      if (!mmProductId) throw new Error("Select a product from the catalogue");
      if (!mmReason) throw new Error("Movement reason is required");
      if (!mmNotes.trim()) throw new Error("Notes are required for manual inventory entries");
      const qty = Number(mmQty);
      if (!(qty > 0)) throw new Error("Quantity must be greater than zero");
      await api.stockMovements.create({
        product_id: mmProductId,
        direction: mmDirection,
        quantity: qty,
        unit_cost: mmUnitCost !== "" ? Number(mmUnitCost) : null,
        warehouse: mmWarehouse.trim() || null,
        reason: mmReason,
        notes: mmNotes.trim(),
        movement_date: mmDate,
        clientId: user?.id,
        status: confirmNow ? "confirmed" : "draft",
      });
    },
    onSuccess: (_d, confirmNow) => {
      qc.invalidateQueries({ queryKey: ["wh_movements"] });
      qc.invalidateQueries({ queryKey: ["stock_movements"] });
      qc.invalidateQueries({ queryKey: ["stock_movements_all"] });
      qc.invalidateQueries({ queryKey: ["stock-summary"] });
      qc.invalidateQueries({ queryKey: ["movements-forecast"] });
      toast.success(
        confirmNow ? "Movement confirmed — stock updated" : "Draft movement saved",
      );
      mmReset();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const orders = (ordersQ.data ?? []) as SO[];
  const dispatches = (dispatchesQ.data ?? []) as Dispatch[];
  const invoices = (invoicesQ.data ?? []) as any[];
  const movements = (movementsQ.data ?? []) as Movement[];

  // Get all dispatch IDs that are linked to invoices
  const dispatchedInvoiceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const d of dispatches) {
      if (d.linked_sales_invoice_id) {
        ids.add(d.linked_sales_invoice_id);
      }
    }
    return ids;
  }, [dispatches]);

  // ── Live in-stock quantity per product (confirmed movements only) ──
  // Used by the Pending Sales Order approval check: every SO line is
  // verified against current stock before the order can be approved.
  const stockByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of movements as any[]) {
      if (r.status !== "confirmed") continue;
      const pid = r.product_id ?? r.productId;
      if (!pid) continue;
      const qty = Number(r.quantity) || 0;
      map.set(pid, (map.get(pid) ?? 0) + (r.direction === "in" ? qty : -qty));
    }
    return map;
  }, [movements]);

  // ── Order sign-off queue (hard gate: only approved SOs can be dispatched) ──
  const signoffOrders = orders
    .filter(
      (o) => ["warehouse_pending", "checker_pending", "confirmed", "partially_dispatched"].includes(o.status),
    )
    .sort((a, b) => {
      // Sort by order date descending (newest first)
      const ad = a.order_date ?? "";
      const bd = b.order_date ?? "";
      if (ad !== bd) return bd.localeCompare(ad);
      // Then alphabetically by customer name
      const an = a.customer_name ?? "";
      const bn = b.customer_name ?? "";
      return an.localeCompare(bn);
    });

  // ── Open Sales Orders: SOs awaiting warehouse sign-off or with pending quantity
  // Excludes fully_dispatched and cancelled
  const openOrders = useMemo(() => {
    return signoffOrders.filter(
      (o) => o.status === "warehouse_pending"
        || (o.warehouse_status ?? "pending") === "on_hold"
        || (o.status === "confirmed" || o.status === "partially_dispatched") &&
          o.lines.some((l) => Number(l.ordered_qty) > Number(l.dispatched_qty ?? 0)),
    );
  }, [signoffOrders]);
  // Search and sort within the Open Sales Orders queue (order no. / buyer name, date/alphabetical).
  const filteredOpenOrders = useMemo(() => {
    const q = openSearch.trim().toLowerCase();
    const list = !q
      ? [...openOrders]
      : openOrders.filter(
          (o) =>
            (o.so_number ?? "").toLowerCase().includes(q) ||
            (o.customer_name ?? "").toLowerCase().includes(q),
        );

    return list.sort((a, b) => {
      if (openSort === "date_desc") {
        const ad = a.order_date ?? "";
        const bd = b.order_date ?? "";
        return bd.localeCompare(ad) || (a.customer_name ?? "").localeCompare(b.customer_name ?? "");
      }
      if (openSort === "date_asc") {
        const ad = a.order_date ?? "";
        const bd = b.order_date ?? "";
        return ad.localeCompare(bd) || (a.customer_name ?? "").localeCompare(b.customer_name ?? "");
      }
      if (openSort === "customer_asc") {
        const an = a.customer_name ?? "";
        const bn = b.customer_name ?? "";
        return an.localeCompare(bn) || (b.order_date ?? "").localeCompare(a.order_date ?? "");
      }
      if (openSort === "customer_desc") {
        const an = a.customer_name ?? "";
        const bn = b.customer_name ?? "";
        return bn.localeCompare(an) || (b.order_date ?? "").localeCompare(a.order_date ?? "");
      }
      return 0;
    });
  }, [openOrders, openSearch, openSort]);
  const pendingSignoffs = signoffOrders.filter(
    (o) => o.status === "warehouse_pending",
  );

  // ── Ready to dispatch: warehouse-approved SOs with pending quantity ──
  const readyOrders = useMemo(() => {
    return signoffOrders
      .filter((o) => (o.warehouse_status ?? "pending") === "approved")
      .filter((o) => o.status === "confirmed" || o.status === "partially_dispatched")
      .filter((o) => o.status !== "fully_dispatched")
      .map((o) => {
        const lines = (o.lines ?? []).map((l) => ({
          ...l,
          pending: Math.max(0, Number(l.ordered_qty) - Number(l.dispatched_qty ?? 0)),
        }));
        const pendingQty = lines.reduce((s, l) => s + l.pending, 0);
        const pendingValue = lines.reduce(
          (s, l) => s + l.pending * Number(l.unit_price) * (1 - (Number(l.discount_pct) || 0) / 100),
          0,
        );
        return { ...o, lines, pendingQty, pendingValue };
      })
      .filter((o) => o.pendingQty > 0);
  }, [signoffOrders]);

  // ── Ready to dispatch from invoices: approved invoices with a target date
  // (expected dispatch date, falling back to the invoice due date) ──
  const dispatchableInvoicesBase = useMemo(() => {
    return invoices.filter((inv: any) => {
      if (!(inv.expected_dispatch_date ?? inv.due_date)) return false;
      if (inv.status === 'paid' || inv.status === 'cancelled' || inv.status === 'rejected') return false;
      // Skip invoices that already have a dispatch linked
      if (inv.linked_sales_invoice_id && dispatchedInvoiceIds.has(inv.linked_sales_invoice_id)) return false;
      return true;
    });
  }, [invoices, dispatchedInvoiceIds]);

  const byTargetDate = (a: any, b: any) =>
    ((a.expected_dispatch_date ?? a.due_date ?? '').localeCompare(b.expected_dispatch_date ?? b.due_date ?? ''));

  // IRN gate: an invoice goes for dispatch only after its IRN is uploaded.
  // (Dispatch creation enforces the same rule server-side.)
  const hasIrn = (inv: any) => !!String(inv.irn ?? "").trim();
  const readyInvoices = useMemo(() => {
    return dispatchableInvoicesBase.filter(hasIrn).sort(byTargetDate);
  }, [dispatchableInvoicesBase]);
  const awaitingIrnInvoices = useMemo(() => {
    return dispatchableInvoicesBase.filter((inv: any) => !hasIrn(inv)).sort(byTargetDate);
  }, [dispatchableInvoicesBase]);

  // ── Ready POs: approved POs with pending receipt quantity ──


  const openDispatches = dispatches.filter(
    (d) => !["delivered", "cancelled", "returned"].includes(d.status),
  );

  // Returns + due-today memos removed with the KPI cards.

  // ── Unified operational work items (presentation layer over existing memos) ──
  // Work-items memo removed with the work-items table.

  // Work-items filter removed with the work-items table.

  // Location options: warehouse master only (location card removed).



  // ── Mutations (unchanged business logic) ──
  const signoff = useMutation({
    mutationFn: async ({
      id,
      action,
      notes,
      editedQuantities,
    }: {
      id: string;
      action: "approve" | "reject";
      notes?: string;
      editedQuantities?: Record<string, number>;
    }) => api.goodsSalesOrders.warehouseApprove(id, action, notes),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["wh_sales_orders"] });
      qc.invalidateQueries({ queryKey: ["goods_sales_orders"] });
      toast.success(
        vars.action === "approve"
          ? "Order approved — sent to Checker"
          : "Order rejected — returned to Sales review",
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Sign-off failed"),
  });

  const shipMove = useMutation({
    mutationFn: async ({
      id,
      status,
      carrier,
      trackingNumber,
      notes,
    }: {
      id: string;
      status: ShippingStatus;
      carrier?: string | null;
      trackingNumber?: string | null;
      notes?: string;
    }) => api.goodsDispatches.shippingStatus(id, status, { carrier, trackingNumber, notes }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["wh_dispatches"] });
      qc.invalidateQueries({ queryKey: ["goods_dispatches"] });
      qc.invalidateQueries({ queryKey: ["stock_movements"] });
      qc.invalidateQueries({ queryKey: ["stock-summary"] });
      toast.success(
        vars.status === "dispatched"
          ? "Moved to Dispatched — inventory debited"
          : "Dispatch updated",
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  const [actingId, setActingId] = useState<string | null>(null);
  // Pending Sales Order approval popup: the order being verified line-by-line.
  const [approveFor, setApproveFor] = useState<SO | null>(null);
  const refreshDispatches = () => {
    qc.invalidateQueries({ queryKey: ["wh_dispatches"] });
    qc.invalidateQueries({ queryKey: ["goods_dispatches"] });
    qc.invalidateQueries({ queryKey: ["stock_movements"] });
    qc.invalidateQueries({ queryKey: ["stock-summary"] });
  };
  const cancelDispatch = useMutation({
    mutationFn: async (id: string) => {
      setActingId(id);
      return api.goodsDispatches.cancel(id);
    },
    onSuccess: () => {
      refreshDispatches();
      toast.success("Dispatch cancelled — stock reversed only if it was dispatched");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Cancel failed"),
    onSettled: () => setActingId(null),
  });
  const returnDispatch = useMutation({
    mutationFn: async (id: string) => {
      setActingId(id);
      // No lines → full return of everything not yet returned.
      return api.goodsDispatches.return(id, { lines: [] });
    },
    onSuccess: () => {
      refreshDispatches();
      toast.success("Return recorded — stock credited back");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Return failed"),
    onSettled: () => setActingId(null),
  });

  const tabs: { id: Tab; label: string; icon: any; count?: number }[] = [
    { id: "overview", label: "Overview", icon: BarChart3 },
    { id: "orders", label: "Pending Sales Order", icon: ClipboardCheck, count: pendingSignoffs.length },
    { id: "open", label: "Open Sales Orders", icon: FileText, count: openOrders.length },
    { id: "ready", label: "Ready to dispatch", icon: PackageCheck, count: readyOrders.length + readyInvoices.length },
    { id: "dispatches", label: "Dispatches", icon: Truck, count: openDispatches.length },
    { id: "movements", label: "Inventory movements", icon: Boxes, count: movements.length },
    ...(canWrite
      ? [{ id: "manual", label: "Manual movement", icon: PackagePlus } as const]
      : []),
  ];

  const profileInitial = (user?.contactName ?? user?.email ?? "W").trim().charAt(0).toUpperCase() || "W";
  const dateStr = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  return (
    <div id="top" className="min-h-screen bg-[#f5f7fa]">
      {/* ── 1. Page header ─────────────────────────────── */}
      <div className="border-b border-border bg-white">
        <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-4 px-4 py-5 md:px-8">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <Warehouse className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-[20px] font-semibold leading-tight tracking-tight text-[#0f1f38]">
                Warehouse Workbench
              </h1>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                Manage physical stock flow from receiving to dispatch
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-[12px] tabular-nums text-muted-foreground shadow-sm">
              <Clock3 className="h-3.5 w-3.5" />
              {dateStr} · {timeStr}
            </span>
            {!canWrite ? (
              <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                Read-only
              </span>
            ) : (
              <span
                title={user?.email ?? ""}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary text-[13px] font-semibold text-primary-foreground"
              >
                {profileInitial}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1440px] space-y-6 px-4 py-6 md:px-8 md:py-8">
        {/* ── 3. KPI cards ─────────────────────────────── */}
        {/* Tabs first — Overview, orders, readiness, dispatches, movements */}
        <div className="flex flex-wrap gap-2">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs uppercase tracking-widest transition ${
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" /> {t.label}
                {t.count ? (
                  <span className="rounded-full bg-primary/15 px-1.5 text-[10px] text-primary">{t.count}</span>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* ── 4. Main work area ────────────────────────── */}
        <div className="grid gap-6 lg:grid-cols-4">
          {/* ── 5. Warehouse work items ────────────────── */}
          {/* Work-items table removed — tabs below hold every queue. */}

          {/* ── 6. Stock by location ───────────────────── */}
          {/* Stock-by-location aside removed — stock lives under Inventory and the movements tab. */}
        </div>

        {/* ── 7. Bottom operations strip ───────────────── */}
        {/* Bottom operations strip removed. */}

        {/* ── Detail queues (existing functionality, preserved) ── */}
        {/* Detail queues card unwrapped — tabs render first at the top of the page. */}

        {tab === "overview" && (
          <div className="space-y-6">
            <Card title={`Open sales orders${openOrders.length ? ` (${openOrders.length})` : ""}`}>
              {ordersQ.isLoading ? (
                <TableSkeleton rows={4} />
              ) : openOrders.length === 0 ? (
                <EmptyState
                  icon={<FileText className="h-5 w-5" />}
                  title="No open orders"
                  description="Orders awaiting warehouse sign-off or with pending quantity appear here."
                />
              ) : (
                <>
                  <OpenOrdersToolbar
                    search={openSearch}
                    onSearch={setOpenSearch}
                    sort={openSort}
                    onSort={setOpenSort}
                  />
                  {filteredOpenOrders.length === 0 ? (
                    <EmptyState
                      icon={<Search className="h-5 w-5" />}
                      title="No matches"
                      description={`No open order matches “${openSearch}”.`}
                    />
                  ) : (
                    <Table head={["Order", "Buyer", "Ordered", "Pending qty", "Status"]}>
                      {filteredOpenOrders.slice(0, 8).map((o) => {
                        const { pendingQty } = openOrderPending(o);
                        return (
                          <tr key={o.id} className="border-b border-border/60 hover:bg-muted/30">
                            <td className="px-5 py-3">{o.so_number}</td>
                            <td className="px-5 py-3">{o.customer_name ?? "—"}</td>
                            <td className="px-5 py-3 text-muted-foreground">{fmtDate(o.order_date)}</td>
                            <td className="num px-5 py-3 text-right">{pendingQty.toLocaleString()}</td>
                            <td className="px-5 py-3">
                              <StatusPill status={o.status} />
                            </td>
                          </tr>
                        );
                      })}
                    </Table>
                  )}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      Showing {Math.min(8, filteredOpenOrders.length)} of{" "}
                      {filteredOpenOrders.length} matching · {openOrders.length} open in total.
                    </p>
                    <button
                      onClick={() => setTab("open")}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:border-primary hover:text-primary"
                    >
                      <FileText className="h-3.5 w-3.5" /> View all open orders
                    </button>
                  </div>
                </>
              )}
            </Card>
            <div id="wh-activity" className="grid scroll-mt-6 gap-6 lg:grid-cols-2">
            <Card title="Live dispatch pipeline">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {SHIPPING_STATUSES.map((s) => (
                  <div key={s} className="rounded-lg border border-border p-3">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      {SHIPPING_LABEL[s]}
                    </div>
                    <div className="num mt-1 text-2xl">
                      {dispatches.filter((d) => (d.shipping_status ?? "picking") === s && d.status !== "cancelled")
                        .length}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Picking and packing never touch stock — inventory is debited once, when the status moves to Dispatched.
              </p>
            </Card>
            <Card title="Latest activity">
              {movements.length === 0 && dispatches.length === 0 ? (
                <EmptyState
                  icon={<Boxes className="h-5 w-5" />}
                  title="Nothing has moved yet"
                  description="Confirmed dispatches will appear here."
                />
              ) : (
                <ul className="space-y-2 text-sm">
                  {dispatches.slice(0, 5).map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-3 border-b border-border/60 pb-2">
                      <span className="truncate">
                        {d.dispatch_number} · {d.customer_name ?? d.so_number ?? "—"}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest ${shippingTone(
                          d.shipping_status ?? "picking",
                        )}`}
                      >
                        {SHIPPING_LABEL[d.shipping_status ?? "picking"]}
                      </span>
                    </li>
                  ))}
                  {movements.slice(0, 5).map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-3 text-muted-foreground">
                      <span className="truncate">
                        {m.direction === "in" ? "In" : "Out"} · {m.item_name} × {Number(m.quantity).toLocaleString()}
                      </span>
                      <span className="shrink-0 text-xs">{fmtDate(m.movement_date)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            </div>
          </div>
        )}

        {tab === "open" && (
          <Card title="Open sales orders">
            {ordersQ.isLoading ? (
              <TableSkeleton rows={4} />
            ) : openOrders.length === 0 ? (
              <EmptyState
                icon={<FileText className="h-5 w-5" />}
                title="No open orders"
                description="Orders awaiting warehouse sign-off or with pending quantity appear here."
              />
            ) : (
              <>
                <OpenOrdersToolbar
                  search={openSearch}
                  onSearch={setOpenSearch}
                  sort={openSort}
                  onSort={setOpenSort}
                />
                {filteredOpenOrders.length === 0 ? (
                  <EmptyState
                    icon={<Search className="h-5 w-5" />}
                    title="No matches"
                    description={`No open order matches “${openSearch}”.`}
                  />
                ) : (
                  <Table head={["Order", "Buyer", "Ordered", "Pending qty", "Pending value", "Status", "Warehouse"]}>
                    {filteredOpenOrders.map((o) => {
                      const { pendingQty, pendingValue } = openOrderPending(o);
                      const wh = o.warehouse_status ?? "pending";
                      return (
                        <tr key={o.id} className="border-b border-border/60 hover:bg-muted/30">
                          <td className="px-5 py-3">{o.so_number}</td>
                          <td className="px-5 py-3">{o.customer_name ?? "—"}</td>
                          <td className="px-5 py-3 text-muted-foreground">{fmtDate(o.order_date)}</td>
                          <td className="num px-5 py-3 text-right">{pendingQty.toLocaleString()}</td>
                          <td className="num px-5 py-3 text-right">{fmtMoney(pendingValue)}</td>
                          <td className="px-5 py-3">
                            <StatusPill status={o.status} />
                          </td>
                          <td className="px-5 py-3 capitalize text-muted-foreground">
                            {String(wh).replace("_", " ")}
                          </td>
                        </tr>
                      );
                    })}
                  </Table>
                )}
              </>
            )}
          </Card>
        )}

        {tab === "orders" && (
          <Card title="Pending sales orders">
            {ordersQ.isLoading ? (
              <TableSkeleton rows={4} />
            ) : signoffOrders.length === 0 ? (
              <EmptyState
                icon={<ClipboardCheck className="h-5 w-5" />}
                title="No sales orders yet"
                description="Sales-reviewed orders appear here for warehouse approval."
              />
            ) : (
              <Table head={["Order", "Buyer", "Ordered", "Expected", "Value", "Commercial", "Warehouse", ""]}>
                {signoffOrders.map((o) => {
                  const wh = o.warehouse_status ?? "pending";
                  const canDecide = canWrite && o.status === "warehouse_pending";
                  return (
                    <tr key={o.id} className="border-b border-border/60 hover:bg-muted/30">
                      <td className="px-5 py-3">{o.so_number}</td>
                      <td className="px-5 py-3">{o.customer_name ?? "—"}</td>
                      <td className="px-5 py-3 text-muted-foreground">{fmtDate(o.order_date)}</td>
                      <td className="px-5 py-3 text-muted-foreground">{fmtDate(o.expected_dispatch_date)}</td>
                      <td className="num px-5 py-3 text-right">{fmtMoney(o.grand_total)}</td>
                      <td className="px-5 py-3">
                        <StatusPill status={o.status} />
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest ${
                            wh === "approved"
                              ? "bg-sem-success/15 text-sem-success"
                              : wh === "rejected"
                                ? "bg-destructive/15 text-destructive"
                                : wh === "on_hold"
                                  ? "bg-sem-attention/15 text-sem-attention"
                                  : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {wh.replace("_", " ")}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        {canDecide && (
                          <div className="inline-flex gap-2">
                            <button
                              onClick={() => setApproveFor(o)}
                              disabled={signoff.isPending}
                              title="Verify stock line-by-line before approving"
                              className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground disabled:opacity-60"
                            >
                              <CheckCircle2 className="h-3 w-3" /> Approve
                            </button>
                            <button
                              onClick={() => signoff.mutate({ id: o.id, action: "reject" })}
                              disabled={signoff.isPending}
                              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs disabled:opacity-60"
                            >
                              <Ban className="h-3 w-3" /> Reject
                            </button>
                          </div>
                        )}
                        {wh === "on_hold" && o.warehouse_notes && (
                          <div className="mt-1 max-w-[220px] text-right text-[11px] text-muted-foreground">
                            {o.warehouse_notes}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </Table>
            )}
            <p className="mt-4 text-xs text-muted-foreground">
              Warehouse approval sends the order to the Checker. Dispatch notes cannot be created until both approvals are complete.
              Approval requires verifying every line item against live stock — short lines block approval.
            </p>
          </Card>
        )}

        {approveFor && (
          <SignoffApproveModal
            order={approveFor}
            stockByProduct={stockByProduct}
            approving={signoff.isPending}
            onClose={() => setApproveFor(null)}
            onApprove={(id, notes, editedQuantities) => {
              signoff.mutate(
                { id, action: "approve", notes, editedQuantities },
                { onSuccess: () => setApproveFor(null) },
              );
            }}
            onReject={(id, notes) => {
              signoff.mutate(
                { id, action: "reject", notes },
                { onSuccess: () => setApproveFor(null) },
              );
            }}
          />
        )}

        {tab === "ready" && (
          <div className="space-y-6">
            {/* Orders ready for dispatch */}
            <Card title="Checker-confirmed orders ready for dispatch">
              {ordersQ.isLoading ? (
                <TableSkeleton rows={3} />
              ) : readyOrders.length === 0 ? (
                <EmptyState
                  icon={<PackageCheck className="h-5 w-5" />}
                  title="No orders waiting"
                  description="Approve orders in Pending Sales Order, then wait for Checker approval. Confirmed orders appear here."
                />
              ) : (
                <Table head={["Order", "Buyer", "Expected", "Pending qty", "Pending value", ""]}>
                  {readyOrders.map((o) => (
                    <tr key={o.id} className="border-b border-border/60 hover:bg-muted/30">
                      <td className="px-5 py-3">{o.so_number}</td>
                      <td className="px-5 py-3">{o.customer_name ?? "—"}</td>
                      <td className="px-5 py-3 text-muted-foreground">{fmtDate(o.expected_dispatch_date)}</td>
                      <td className="num px-5 py-3 text-right">{o.pendingQty.toLocaleString()}</td>
                      <td className="num px-5 py-3 text-right">{fmtMoney(o.pendingValue)}</td>
                      <td className="px-5 py-3 text-right">
                        <a
                          href={`/app/dispatches?createFromSO=${encodeURIComponent(o.id)}&initialStatus=picking`}
                          className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground"
                        >
                          <Truck className="h-3 w-3" /> Create & set to picking
                        </a>
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>

            {/* Invoices ready for dispatch */}
            <Card title="Approved invoices awaiting dispatch">
              {invoicesQ.isLoading ? (
                <TableSkeleton rows={3} />
              ) : readyInvoices.length === 0 ? (
                <EmptyState
                  icon={<FileText className="h-5 w-5" />}
                  title="No invoices waiting"
                   description="Approved invoices with a target date (due date) appear here. Create a dispatch to ship the goods."
                />
              ) : (
                <Table head={["Invoice", "Customer", "Amount", "Expected dispatch", "Days left", ""]}>
                  {readyInvoices.map((inv: any) => {
                    const targetDate = inv.expected_dispatch_date ?? inv.due_date;
                    const daysLeft = targetDate
                      ? Math.max(0, Math.round((new Date(targetDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)))
                      : 0;
                    return (
                      <tr key={inv.id} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-3">
                          <div className="font-mono text-xs">{inv.invoice_number}</div>
                          {inv.goods_sales_order_number && (
                            <div className="text-[10px] text-muted-foreground">SO {inv.goods_sales_order_number}</div>
                          )}
                        </td>
                        <td className="px-5 py-3">{inv.debtor?.name ?? "—"}</td>
                        <td className="num px-5 py-3 text-right">{fmtMoney(inv.grand_total ?? inv.amount)}</td>
                        <td className="px-5 py-3 text-muted-foreground">{fmtDate(inv.expected_dispatch_date ?? inv.due_date)}</td>
                        <td className="px-5 py-3 text-center">
                          {daysLeft === 0 ? (
                            <span className="inline-flex items-center rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] text-destructive">
                              Due today
                            </span>
                          ) : daysLeft <= 3 ? (
                            <span className="inline-flex items-center rounded-full bg-sem-attention/10 px-2 py-0.5 text-[10px] text-sem-attention">
                              {daysLeft}d left
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">{daysLeft}d</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button
                            onClick={() => (window.location.href = `/app/dispatches?createFromInvoice=${inv.id}&initialStatus=picking`)}
                            className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground"
                          >
                            <Truck className="h-3 w-3" /> Create dispatch
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </Table>
              )}
              {awaitingIrnInvoices.length > 0 && (
                <div className="mt-3 flex items-start gap-2 rounded-md border border-sem-attention/30 bg-sem-attention/5 p-3 text-xs text-sem-attention">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {awaitingIrnInvoices.length} approved invoice{awaitingIrnInvoices.length === 1 ? " is" : "s are"} awaiting IRN upload — dispatch unlocks only after the IRN is recorded:{" "}
                    {awaitingIrnInvoices.slice(0, 5).map((inv: any) => inv.invoice_number).filter(Boolean).join(", ")}
                    {awaitingIrnInvoices.length > 5 ? ` +${awaitingIrnInvoices.length - 5} more` : ""}.
                  </span>
                </div>
              )}
              <p className="mt-4 text-xs text-muted-foreground">
                An invoice goes for dispatch only after its IRN is uploaded. Every dispatch can be linked to an invoice — the invoice reference is stored on the dispatch record and
                appears in the movement report. Create a dispatch from here to auto-link the invoice.
              </p>
            </Card>
          </div>
        )}

        {tab === "dispatches" && (
          <DispatchTable
            dispatches={dispatches}
            loading={dispatchesQ.isLoading}
            canWrite={canWrite}
            onMove={(vars) => shipMove.mutate(vars)}
            moving={shipMove.isPending}
            onCancel={(id) => cancelDispatch.mutate(id)}
            onReturn={(id) => returnDispatch.mutate(id)}
            acting={actingId}
          />
        )}

        {tab === "movements" && (
          <Card title="Inventory movements">
            {movementsQ.isLoading ? (
              <TableSkeleton rows={5} />
            ) : movements.length === 0 ? (
              <EmptyState
                icon={<Boxes className="h-5 w-5" />}
                title="No movements yet"
                description="Confirmed stock ins and outs will appear here."
              />
            ) : (
              <Table head={["Date", "Item", "Direction", "Qty", "Warehouse", "Status", "Linked doc"]}>
                {[...movements]
                  .sort((a, b) => String(b.movement_date ?? "").localeCompare(String(a.movement_date ?? "")))
                  .slice(0, 100)
                  .map((m) => (
                    <tr key={m.id} className="border-b border-border/60 hover:bg-muted/30">
                      <td className="px-5 py-3 text-muted-foreground">{fmtDate(m.movement_date)}</td>
                      <td className="px-5 py-3">
                        <div>{m.item_name}</div>
                        {m.sku && <div className="text-xs text-muted-foreground">{m.sku}</div>}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest ${
                            m.direction === "in"
                              ? "bg-sem-success/15 text-sem-success"
                              : "bg-primary/15 text-primary"
                          }`}
                        >
                          {m.direction === "in" ? "In" : "Out"}
                        </span>
                      </td>
                      <td className="num px-5 py-3 text-right">
                        {Number(m.quantity).toLocaleString()} {m.unit}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{m.warehouse ?? "—"}</td>
                      <td className="px-5 py-3">
                        <StatusPill status={m.status} />
                      </td>
                      <td className="px-5 py-3 text-xs text-muted-foreground">
                        {m.linked_document_number ?? "—"}
                      </td>
                    </tr>
                  ))}
              </Table>
            )}
            <p className="mt-4 text-xs text-muted-foreground">
              Showing latest 100 movements. Full history lives under Inventory.
            </p>
          </Card>
        )}

        {tab === "manual" && canWrite && (
          <Card title="Manual stock movement">
            <p className="-mt-2 mb-4 text-xs text-muted-foreground">
              Record stock directly — opening stock, adjustments, damage, samples and returns.
              Entries start as drafts unless saved &amp; confirmed.
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
                    Product (SKU · name) *
                  </span>
                  <SearchableSelect
                    value={mmProductId}
                    onChange={mmPickProduct}
                    placeholder="— Select product —"
                    options={(mmProductsQ.data ?? []).map((p) => ({
                      value: p.id,
                      label: p.sku ? `${p.sku} · ${p.name}` : p.name,
                    }))}
                  />
                </label>
                {mmSelected && (
                  <div className="mt-1.5 text-[11px] text-muted-foreground">
                    SKU {mmSelected.sku ?? "—"} · Unit {mmSelected.unit} · {mmSelected.name}
                  </div>
                )}
              </div>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
                  Movement reason *
                </span>
                <select
                  className={inputBase}
                  value={mmReason}
                  onChange={(e) => mmPickReason(e.target.value)}
                >
                  <option value="">— Select reason —</option>
                  {MANUAL_REASONS.map((r) => (
                    <option key={r.label} value={r.label}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
                  Direction
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMmDirection("in");
                      if (mmSelected) setMmUnitCost(mmAutoValue(mmSelected, "in"));
                    }}
                    className={`rounded-md border px-3 py-2 text-sm transition ${mmDirection === "in" ? "border-sem-success bg-sem-success/10 text-sem-success" : "border-border text-muted-foreground hover:text-foreground"}`}
                  >
                    Credit <span className="text-[10px] opacity-70">stock in</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMmDirection("out");
                      if (mmSelected) setMmUnitCost(mmAutoValue(mmSelected, "out"));
                    }}
                    className={`rounded-md border px-3 py-2 text-sm transition ${mmDirection === "out" ? "border-sem-attention bg-sem-attention/10 text-sem-attention" : "border-border text-muted-foreground hover:text-foreground"}`}
                  >
                    Debit <span className="text-[10px] opacity-70">stock out</span>
                  </button>
                </div>
              </div>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
                  Quantity *
                </span>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  className={inputBase}
                  value={mmQty}
                  onChange={(e) => setMmQty(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
                  {mmDirection === "out" ? "MRP (auto-filled)" : "Unit cost (auto-filled)"}
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className={inputBase}
                  value={mmUnitCost}
                  onChange={(e) => setMmUnitCost(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
                  Warehouse / store (optional)
                </span>
                <input
                  className={inputBase}
                  value={mmWarehouse}
                  onChange={(e) => setMmWarehouse(e.target.value)}
                  placeholder="Central Warehouse (default)"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
                  Movement date *
                </span>
                <input
                  type="date"
                  className={inputBase}
                  value={mmDate}
                  onChange={(e) => setMmDate(e.target.value)}
                />
              </label>
              <label className="block md:col-span-2">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
                  Notes *
                </span>
                <textarea
                  rows={2}
                  className={`${inputBase} resize-y`}
                  value={mmNotes}
                  onChange={(e) => setMmNotes(e.target.value)}
                  placeholder="Required — e.g. opening stock count, damaged batch ref, sample purpose…"
                />
              </label>
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={mmReset}
                className="rounded-md border border-border px-4 py-2 text-sm transition hover:bg-muted/40"
              >
                Clear
              </button>
              <button
                type="button"
                disabled={mmSave.isPending}
                onClick={() => mmSave.mutate(false)}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-muted/40 disabled:opacity-60"
              >
                {mmSave.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Save draft
              </button>
              <button
                type="button"
                disabled={mmSave.isPending}
                onClick={() => mmSave.mutate(true)}
                className="inline-flex items-center gap-2 rounded-[10px] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:-translate-y-px hover:shadow-md disabled:opacity-60"
              >
                {mmSave.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Save &amp; confirm
              </button>
            </div>
          </Card>
        )}

        {/* Movement-reports tab removed — Overview, orders, readiness, dispatches and movements only. */}
      </div>
    </div>
  );
}

// ─── Dispatches tab ─ pipeline dropdown + inline carrier/tracking editor ───
function DispatchTable({
  dispatches,
  loading,
  canWrite,
  onMove,
  moving,
  onCancel,
  onReturn,
  acting,
}: {
  dispatches: Dispatch[];
  loading: boolean;
  canWrite: boolean;
  onMove: (vars: {
    id: string;
    status: ShippingStatus;
    carrier?: string | null;
    trackingNumber?: string | null;
    notes?: string;
  }) => void;
  moving: boolean;
  onCancel: (id: string) => void;
  onReturn: (id: string) => void;
  acting: string | null;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [awaitingPickupFor, setAwaitingPickupFor] = useState<Dispatch | null>(null);
  const qc = useQueryClient();
  const refreshAfterTransport = () => {
    qc.invalidateQueries({ queryKey: ["wh_dispatches"] });
    qc.invalidateQueries({ queryKey: ["goods-dispatches"] });
    qc.invalidateQueries({ queryKey: ["goods_dispatches"] });
  };

  const startEdit = (d: Dispatch) => {
    setEditing(d.id);
    setCarrier(d.transporter_name ?? "");
    setTracking(d.tracking_number ?? "");
  };

  const saveMeta = (d: Dispatch) => {
    onMove({
      id: d.id,
      status: (d.shipping_status ?? "picking") as ShippingStatus,
      carrier: carrier || null,
      trackingNumber: tracking || null,
    });
    setEditing(null);
  };

  if (loading) return <TableSkeleton rows={5} />;
  if (dispatches.length === 0)
    return (
      <Card title="Dispatches">
        <EmptyState
          icon={<Truck className="h-5 w-5" />}
          title="No dispatches created yet"
          description="Dispatch notes are created from the Dispatch page against warehouse-approved sales orders."
        />
      </Card>
    );

  return (
    <Card title="Dispatches">
      <Table
        head={[
          "Ref",
          "Order / buyer",
          "Dispatched",
          "Carrier / tracking",
          "Commercial",
          "Pipeline",
          canWrite ? "Cancel / Return" : "Status",
        ]}
      >
        {dispatches.map((d) => {
          const closed = ["cancelled", "returned"].includes(d.status);
          const current = (d.shipping_status ?? "picking") as ShippingStatus;
          const forward = SHIPPING_STATUSES.slice(
            SHIPPING_STATUSES.indexOf(current) + 1,
          ) as ShippingStatus[];
          return (
            <tr key={d.id} className="border-b border-border/60 hover:bg-muted/30">
              <td className="px-5 py-3">{d.dispatch_number}</td>
              <td className="px-5 py-3">
                <div>{d.so_number ?? "—"}</div>
                <div className="text-xs text-muted-foreground">{d.customer_name ?? "—"}</div>
              </td>
              <td className="px-5 py-3 text-muted-foreground">{fmtDate(d.dispatch_date)}</td>
              <td className="px-5 py-3 text-xs">
                {editing === d.id ? (
                  <div className="flex w-72 max-w-full flex-col gap-1.5">
                    <input
                      className="rounded-md border border-border bg-input px-2 py-1 text-xs"
                      placeholder="Carrier"
                      value={carrier}
                      onChange={(e) => setCarrier(e.target.value)}
                    />
                    <input
                      className="rounded-md border border-border bg-input px-2 py-1 text-xs"
                      placeholder="Tracking number"
                      value={tracking}
                      onChange={(e) => setTracking(e.target.value)}
                    />
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => saveMeta(d)}
                        disabled={moving}
                        className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] text-primary-foreground disabled:opacity-60"
                      >
                        {moving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                        Save
                      </button>
                      <button
                        onClick={() => setEditing(null)}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px]"
                      >
                        <X className="h-3 w-3" /> Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-1.5">
                      <span className="truncate">{d.transporter_name ?? "—"}</span>
                      {canWrite && !closed && (
                        <button
                          onClick={() => startEdit(d)}
                          title="Edit carrier / tracking"
                          className="text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    {d.tracking_number && <div className="text-muted-foreground">{d.tracking_number}</div>}
                  </>
                )}
              </td>
              <td className="px-5 py-3">
                <StatusPill status={d.status} />
              </td>
              {canWrite ? (
                <>
                  <td className="px-5 py-3">
                    {closed ? (
                      <span className="text-xs uppercase tracking-widest text-muted-foreground">Closed</span>
                    ) : current === "delivered" ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest ${shippingTone("delivered")}`}
                      >
                        Delivered
                      </span>
                    ) : (
                      <select
                        className="rounded-md border border-border bg-input px-2 py-1 text-xs"
                        value={current}
                        disabled={moving}
                        onChange={(e) => {
                          const next = e.target.value as ShippingStatus;
                          // Awaiting Pickup always collects transporter/upload details first.
                          if (next === "awaiting_pick") {
                            setAwaitingPickupFor(d);
                            return;
                          }
                          onMove({ id: d.id, status: next });
                        }}
                        title="Picking → Packing → Awaiting Pickup (transporter form, sent to Finance) → Dispatched (debits stock) → In Transit → Delivered"
                      >
                        <option value={current}>{SHIPPING_LABEL[current]}</option>
                        {forward.map((s) => (
                          <option key={s} value={s}>
                            {SHIPPING_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {closed ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        {["confirmed", "partially_delivered", "delivered"].includes(d.status) && (
                          <button
                            onClick={() => onReturn(d.id)}
                            disabled={acting === d.id}
                            title="Record return — credits the remaining quantity back to stock"
                            className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition hover:border-primary hover:text-primary disabled:opacity-60"
                          >
                            Return
                          </button>
                        )}
                        <button
                          onClick={() => onCancel(d.id)}
                          disabled={acting === d.id}
                          title="Cancel dispatch — reverses stock only if it was already dispatched"
                          className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition hover:border-destructive hover:text-destructive disabled:opacity-60"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </td>
                </>
              ) : (
                <td className="px-5 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest ${shippingTone(current)}`}
                  >
                    {SHIPPING_LABEL[current]}
                  </span>
                </td>
              )}
            </tr>
          );
        })}
      </Table>
      <p className="mt-4 text-xs text-muted-foreground">
        The pipeline moves forward only (Picking → Packing → Awaiting Pickup → Dispatched → In Transit → Delivered).
        Only the move to Dispatched debits inventory. Selecting
        "Delivered" records delivery against the dispatch. Selecting "Awaiting Pickup"
        opens the transporter/upload form — those details are sent to Finance (Finance Dispatch Orders tab).
      </p>
      {awaitingPickupFor && (
        <AwaitingPickupTransportModal
          dispatch={awaitingPickupFor}
          onClose={() => setAwaitingPickupFor(null)}
          onDone={refreshAfterTransport}
        />
      )}
    </Card>
  );
}

// ─── Shared table shell (matches the app's list pages) ──
// ─── Pending Sales Order approval popup ────────────────────────────────
// Every SO line is fetched with its live in-stock quantity. The user must
// check each line; approval is blocked while any line is short of stock.
function SignoffApproveModal({
  order,
  stockByProduct,
  approving,
  onClose,
  onApprove,
  onReject,
}: {
  order: SO;
  stockByProduct: Map<string, number>;
  approving: boolean;
  onClose: () => void;
  onApprove: (id: string, notes?: string, editedQuantities?: Record<string, number>) => void;
  onReject: (id: string, notes?: string) => void;
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState("");
  const [editedQuantities, setEditedQuantities] = useState<Record<string, number>>({});

  const lines = (order.lines ?? []).map((l) => {
    const pending = Math.max(0, Number(l.ordered_qty) - Number(l.dispatched_qty ?? 0));
    const available = stockByProduct.get(l.product_id) ?? 0;
    const editedQty = editedQuantities[l.product_id] != null ? Number(editedQuantities[l.product_id]) : null;
    return { ...l, pending, available, short: available < (editedQty ?? pending), editedQty };
  });
  const shortLines = lines.filter((l) => l.short);
  const allChecked = lines.length > 0 && lines.every((l) => checked[l.product_id]);
  // A line is "short" if available stock < the effective quantity (edited or original ordered)
  const effectiveQty = (l: typeof lines[0]) => l.editedQty != null ? l.editedQty : l.pending;
  const canApprove = allChecked && shortLines.length === 0 && !approving;

const blockReason =
    lines.length === 0
      ? "This order has no lines to verify."
      : shortLines.length > 0
        ? `${shortLines.length} line${shortLines.length === 1 ? " is" : "s are"} short of stock — approval is blocked until stock arrives or quantity is edited.`
        : allChecked
          ? null
          : `Check all ${lines.length} line${lines.length === 1 ? "" : "s"} to enable approval (${lines.filter((l) => checked[l.product_id]).length}/${lines.length} verified).`;

  const toggleAll = () => {
    if (allChecked) setChecked({});
    else {
      const next: Record<string, boolean> = {};
      for (const l of lines) next[l.product_id] = true;
      setChecked(next);
    }
  };

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
          <div>
            <h3 className="font-display text-lg">Verify stock — {order.so_number}</h3>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              {order.customer_name ?? "—"} · approval needs every line checked and fully in stock
            </div>
          </div>
          <button onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5 text-sm">
          <div className="overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-normal">
                    <button
                      onClick={toggleAll}
                      className="inline-flex items-center gap-1.5 hover:text-foreground"
                      title={allChecked ? "Uncheck all" : "Check all"}
                    >
                      <input
                        type="checkbox"
                        readOnly
                        checked={allChecked}
                        className="h-3.5 w-3.5 accent-primary"
                      />
                      Product
                    </button>
                  </th>
                  <th className="px-3 py-2 text-right font-normal">Ordered</th>
                  <th className="px-3 py-2 text-right font-normal">Pending</th>
                  <th className="px-3 py-2 text-right font-normal">In stock</th>
                  <th className="px-3 py-2 text-right font-normal">Edit qty</th>
                  <th className="px-3 py-2 text-center font-normal">Verified</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr
                    key={l.product_id}
                    className={`border-b border-border/40 ${l.short ? "bg-destructive/5" : ""}`}
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium">{l.name}</div>
                      {l.sku && (
                        <div className="font-mono text-[10px] text-muted-foreground">{l.sku}</div>
                      )}
                      {l.short && (
                        <div className="text-[11px] font-medium text-destructive">
                          Short by {(l.pending - l.available).toLocaleString()} — not available
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right num">{Number(l.ordered_qty).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right num">{l.pending.toLocaleString()}</td>
                    <td className={`px-3 py-2 text-right num ${l.short ? "font-semibold text-destructive" : "text-sem-success"}`}>
                      {l.available.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        value={l.editedQty != null ? String(l.editedQty) : String(l.ordered_qty)}
                        onChange={(e) => {
                          const val = Number(e.target.value) || 0;
                          setEditedQuantities((c) => ({ ...c, [l.product_id]: val }));
                        }}
                        min={0}
                        className="w-full rounded-md border border-border bg-input px-1 py-1 text-xs focus:border-primary focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        aria-label={`Verify ${l.name}`}
                        checked={!!checked[l.product_id]}
                        onChange={(e) =>
                          setChecked((c) => ({ ...c, [l.product_id]: e.target.checked }))
                        }
                        className="h-4 w-4 accent-primary"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {blockReason && (
            <div
              className={`flex items-start gap-2 rounded-md border p-3 text-xs ${
                shortLines.length > 0
                  ? "border-destructive/30 bg-destructive/5 text-destructive"
                  : "border-sem-attention/30 bg-sem-attention/5 text-sem-attention"
              }`}
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{blockReason}</span>
            </div>
          )}

          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">
              Warehouse notes (optional for approve, sent with reject)
            </span>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Rack / batch verification notes…"
              className="w-full resize-y rounded-md border border-border bg-input px-2.5 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </label>

          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
            <button
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm"
            >
              Close
            </button>
            <button
              onClick={() => onReject(order.id, notes.trim() || undefined)}
              disabled={approving}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm disabled:opacity-60"
            >
              <Ban className="h-3.5 w-3.5" /> Reject
            </button>
            <button
              onClick={() => canApprove && onApprove(order.id, notes.trim() || undefined, editedQuantities)}
              disabled={!canApprove}
              title={!canApprove ? (blockReason ?? "Verify all lines to approve") : "Approve — sends the order to the Checker"}
              className="inline-flex items-center gap-1.5 rounded-[10px] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:-translate-y-px hover:shadow-md disabled:opacity-50"
            >
              {approving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Approve all lines
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Pending quantity/value for an open SO row (shared by the Overview dashboard card and the Open tab) ───
function openOrderPending(o: SO) {
  const pendingLines = (o.lines ?? []).filter(
    (l) => Number(l.ordered_qty) > Number(l.dispatched_qty ?? 0),
  );
  const pendingQty = pendingLines.reduce(
    (s, l) => s + (Number(l.ordered_qty) - Number(l.dispatched_qty ?? 0)),
    0,
  );
  const pendingValue = pendingLines.reduce(
    (s, l) =>
      s +
      (Number(l.ordered_qty) - Number(l.dispatched_qty ?? 0)) *
        Number(l.unit_price) *
        (1 - (Number(l.discount_pct) || 0) / 100),
    0,
  );
  return { pendingQty, pendingValue };
}

// ─── Open SO search + sort toolbar (shared by the Overview dashboard card and the Open tab) ───
function OpenOrdersToolbar({
  search,
  onSearch,
  sort,
  onSort,
}: {
  search: string;
  onSearch: (v: string) => void;
  sort: OpenSort;
  onSort: (v: OpenSort) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex w-full max-w-sm items-center gap-2">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search by customer name or order no.…"
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">Sort:</span>
        <select
          value={sort}
          onChange={(e) => onSort(e.target.value as OpenSort)}
          className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground outline-none focus:border-primary"
        >
          <option value="date_desc">Date (Newest first)</option>
          <option value="date_asc">Date (Oldest first)</option>
          <option value="customer_asc">Alphabetical (Buyer A → Z)</option>
          <option value="customer_desc">Alphabetical (Buyer Z → A)</option>
        </select>
      </div>
    </div>
  );
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="-mx-5 overflow-x-auto table-wrap">
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-widest text-muted-foreground">
          <tr className="border-b border-border">
            {head.map((h, i) => (
              <th key={i} className="px-5 py-2 text-left font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
