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
  MapPin,
  RotateCcw,
  Package,
  MoreVertical,
  ChevronRight,
  Clock3,
} from "lucide-react";
import { TableSkeleton } from "@/components/skeletons";
import { toast } from "sonner";

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

// --- Warehouse dispatch pipeline: stock debits only on Dispatched ---
const SHIPPING_STATUSES = [
  "awaiting_pick",
  "picking",
  "packed",
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

// â”€â”€â”€ Types (snake_case â€” the backend response transform) â”€â”€
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

type Tab = "overview" | "orders" | "ready" | "dispatches";

// â”€â”€â”€ Warehouse sub-navigation (Workbench + links to existing real surfaces) â”€â”€
// Workbench is the in-page active tab. Every other entry points at an existing
// route or an in-page anchor â€” no mock destinations.
const SUBNAV: { id: string; label: string; href: string; active?: boolean; external?: boolean }[] = [
  { id: "workbench", label: "Workbench", href: "#top", active: true },
  { id: "inventory", label: "Inventory by Location", href: "/app/inventory", external: true },
  { id: "dispatch", label: "Dispatch Orders", href: "/app/dispatches", external: true },
  { id: "packing", label: "Packing & Dispatch", href: "/app/dispatches", external: true },
  { id: "returns", label: "Returns", href: "#wh-work-items", external: false },
  { id: "activity", label: "Activity History", href: "#wh-activity", external: false },
];

type WorkItemTone = "amber" | "blue" | "green" | "red" | "neutral";

type WorkItem = {
  id: string;
  docNumber: string;
  docType: string;
  location: string;
  status: string;
  tone: WorkItemTone;
  nextStep: string;
  owner: string;
  openHref: string;
  openLabel: string;
};

function toneClass(t: WorkItemTone) {
  if (t === "amber") return "bg-sem-attention/12 text-sem-attention border-sem-attention/25";
  if (t === "blue") return "bg-primary/10 text-primary border-primary/20";
  if (t === "green") return "bg-sem-success/12 text-sem-success border-sem-success/25";
  if (t === "red") return "bg-destructive/10 text-destructive border-destructive/25";
  return "bg-muted text-muted-foreground border-border";
}

export function WarehousePage() {
  const { user, isAdmin, isOperations } = useAuth();
  const canWrite = isAdmin || isOperations;
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");
  // Workbench-level UI state (presentation only â€” no workflow change)
  const [locationFilter, setLocationFilter] = useState("");
  const [showAllWorkItems, setShowAllWorkItems] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
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
  // Additive read-only queries for the location card + header selector.
  const locationsQ = useQuery({
    queryKey: ["wh_stock_locations"],
    queryFn: () => api.stockLocations.list(),
  });
  const stockSummaryQ = useQuery({
    queryKey: ["wh_stock_summary"],
    queryFn: () => api.stockSummary.list(),
  });

  const orders = (ordersQ.data ?? []) as SO[];
  const dispatches = (dispatchesQ.data ?? []) as Dispatch[];
  const invoices = (invoicesQ.data ?? []) as any[];
  const movements = (movementsQ.data ?? []) as Movement[];
  const locations = (locationsQ.data ?? []) as any[];
  const stockSummary = (stockSummaryQ.data ?? []) as any[];

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

  // â”€â”€ Stock on hand + valuation (confirmed movements only) â”€â”€
  const stock = useMemo(() => {
    const m = new Map<
      string,
      { item: string; sku: string | null; unit: string; qty: number; value: number; lastCost: number; lastDate: string }
    >();
    for (const r of movements) {
      if (r.status !== "confirmed") continue;
      const k = `${r.item_name}|${r.unit}`;
      const sign = r.direction === "in" ? 1 : -1;
      const cur =
        m.get(k) ??
        { item: r.item_name, sku: r.sku ?? null, unit: r.unit, qty: 0, value: 0, lastCost: 0, lastDate: r.movement_date };
      cur.qty += sign * Number(r.quantity);
      cur.value += sign * Number(r.quantity) * Number(r.unit_cost ?? 0);
      if (r.direction === "in" && r.unit_cost) cur.lastCost = Number(r.unit_cost);
      if (!cur.sku && r.sku) cur.sku = r.sku;
      m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => a.item.localeCompare(b.item));
  }, [movements]);

  const totalStockValue = stock.reduce((s, r) => s + r.value, 0);
  const totalUnits = stock.reduce((s, r) => s + r.qty, 0);

  // â”€â”€ Order sign-off queue (hard gate: only approved SOs can be dispatched) â”€â”€
  const signoffOrders = orders.filter(
    (o) => ["warehouse_pending", "checker_pending", "confirmed", "partially_dispatched"].includes(o.status),
  );
  const pendingSignoffs = signoffOrders.filter(
    (o) => o.status === "warehouse_pending",
  );

  // â”€â”€ Ready to dispatch: warehouse-approved SOs with pending quantity â”€â”€
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

  // â”€â”€ Ready to dispatch from invoices: approved invoices with expected dispatch date â”€â”€
  const readyInvoices = useMemo(() => {
    return invoices
      .filter((inv: any) => {
        if (!inv.expected_dispatch_date) return false;
        if (inv.status === 'paid' || inv.status === 'cancelled' || inv.status === 'rejected') return false;
        // Skip invoices that already have a dispatch linked
        if (inv.linked_sales_invoice_id && dispatchedInvoiceIds.has(inv.linked_sales_invoice_id)) return false;
        return true;
      })
      .sort((a: any, b: any) => (a.expected_dispatch_date ?? '').localeCompare(b.expected_dispatch_date ?? ''));
  }, [invoices, dispatchedInvoiceIds]);

  // â”€â”€ Ready POs: approved POs with pending receipt quantity â”€â”€


  const openDispatches = dispatches.filter(
    (d) => !["delivered", "cancelled", "returned"].includes(d.status),
  );

  // â”€â”€ Returns awaiting inspection (real data only) â”€â”€
  const returnsAwaiting = useMemo(() => {
    const returnedDispatches = dispatches.filter((d) => d.status === "returned");
    const draftCustomerReturns = movements.filter(
      (m) =>
        m.status === "draft" &&
        /customer return/i.test(String((m as any).reason ?? "")),
    );
    return { returnedDispatches, draftCustomerReturns, count: returnedDispatches.length + draftCustomerReturns.length };
  }, [dispatches, movements]);

  // â”€â”€ Dispatches due today (real data: ready orders + invoices due today/overdue) â”€â”€
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const dispatchesDueToday = useMemo(() => {
    const dueInvoices = readyInvoices.filter((inv: any) => {
      const d = String(inv.expected_dispatch_date ?? "").slice(0, 10);
      return d !== "" && d <= todayStr;
    });
    return { dueInvoices, count: readyOrders.length + dueInvoices.length };
  }, [readyInvoices, readyOrders, todayStr]);

  // â”€â”€ Unified operational work items (presentation layer over existing memos) â”€â”€
  const workItems: WorkItem[] = useMemo(() => {
    const items: WorkItem[] = [];
    for (const o of pendingSignoffs.slice(0, 20)) {
      items.push({
        id: `so-${o.id}`,
        docNumber: o.so_number,
        docType: "Sales Order",
        location: (o as any).warehouse ?? "â€”",
        status: "Awaiting warehouse decision",
        tone: "amber",
        nextStep: "Approve or reject sign-off",
        owner: "Warehouse team",
        openHref: "#wh-detail-queues",
        openLabel: "Open",
      });
    }
    for (const o of readyOrders.slice(0, 20)) {
      items.push({
        id: `ready-${o.id}`,
        docNumber: o.so_number,
        docType: "Dispatch Order",
        location: (o as any).warehouse ?? "â€”",
        status: "Ready to dispatch",
        tone: "green",
        nextStep: "Add dispatch details and confirm",
        owner: o.customer_name ?? "Warehouse team",
        openHref: `/app/dispatches?createFromSO=${encodeURIComponent(o.id)}&initialStatus=picking`,
        openLabel: "Open",
      });
    }
    for (const inv of readyInvoices.slice(0, 10) as any[]) {
      items.push({
        id: `inv-${inv.id}`,
        docNumber: String(inv.invoice_number ?? inv.id),
        docType: "Dispatch Order",
        location: "â€”",
        status: "Ready to dispatch",
        tone: "green",
        nextStep: "Add dispatch details and confirm",
        owner: inv.debtor?.name ?? "Warehouse team",
        openHref: `/app/dispatches?createFromInvoice=${encodeURIComponent(inv.id)}&initialStatus=picking`,
        openLabel: "Open",
      });
    }
    for (const d of openDispatches.filter((x) => ["picking", "packed"].includes(String(x.shipping_status ?? ""))).slice(0, 20)) {
      const packed = d.shipping_status === "packed";
      items.push({
        id: `pipe-${d.id}`,
        docNumber: d.dispatch_number,
        docType: "Dispatch Order",
        location: d.warehouse ?? "â€”",
        status: packed ? "Packed" : "In progress",
        tone: packed ? "green" : "blue",
        nextStep: packed ? "Ready to dispatch" : "Pick, pack and update pipeline",
        owner: d.shipping_status_by ?? d.customer_name ?? "Warehouse team",
        openHref: "/app/dispatches",
        openLabel: "Open",
      });
    }
    for (const d of returnsAwaiting.returnedDispatches.slice(0, 20)) {
      items.push({
        id: `ret-${d.id}`,
        docNumber: d.dispatch_number,
        docType: "Customer Return",
        location: d.warehouse ?? "â€”",
        status: "Awaiting inspection",
        tone: "red",
        nextStep: "Inspect and record condition",
        owner: d.shipping_status_by ?? d.customer_name ?? "Inspection area",
        openHref: "/app/dispatches",
        openLabel: "Open",
      });
    }
    for (const m of returnsAwaiting.draftCustomerReturns.slice(0, 10)) {
      items.push({
        id: `retm-${m.id}`,
        docNumber: m.linked_document_number ?? m.item_name,
        docType: "Customer Return",
        location: m.warehouse ?? "â€”",
        status: "Awaiting inspection",
        tone: "red",
        nextStep: "Inspect and record condition",
        owner: "Inspection area",
        openHref: "/app/inventory",
        openLabel: "Open",
      });
    }
    return items;
  }, [pendingSignoffs, readyOrders, readyInvoices, openDispatches, returnsAwaiting]);

  const filteredWorkItems = useMemo(() => {
    if (!locationFilter) return workItems;
    return workItems.filter((w) => w.location === locationFilter || w.location === "â€”");
  }, [workItems, locationFilter]);

  const visibleWorkItems = showAllWorkItems ? filteredWorkItems : filteredWorkItems.slice(0, 8);
  const workItemsLoading =
    ordersQ.isLoading || dispatchesQ.isLoading || invoicesQ.isLoading || movementsQ.isLoading;

  // â”€â”€ Stock by location (real data: stock-summary location breakdown, legacy fallback) â”€â”€
  const locationStock = useMemo(() => {
    const totals = new Map<string, number>();
    for (const s of stockSummary as any[]) {
      const breakdown: any[] = s.location_breakdown ?? s.locationBreakdown ?? [];
      for (const lb of breakdown) {
        const name: string = lb.location_name ?? lb.locationName ?? "â€”";
        const qty = Number(lb.quantity ?? 0);
        totals.set(name, (totals.get(name) ?? 0) + qty);
      }
    }
    if (totals.size > 0) {
      return [...totals.entries()]
        .map(([name, qty]) => ({ name, qty }))
        .sort((a, b) => b.qty - a.qty);
    }
    // Legacy fallback: group confirmed stock by free-text warehouse field.
    const fb = new Map<string, number>();
    for (const r of movements) {
      if (r.status !== "confirmed") continue;
      const name = r.warehouse?.trim() || "Unallocated";
      const sign = r.direction === "in" ? 1 : -1;
      fb.set(name, (fb.get(name) ?? 0) + sign * Number(r.quantity));
    }
    return [...fb.entries()].map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty);
  }, [stockSummary, movements]);

  const locationOptions = useMemo(() => {
    const names = new Set<string>();
    for (const l of locations as any[]) {
      const n = l.name ?? l.location_name;
      if (n) names.add(String(n));
    }
    for (const ls of locationStock) names.add(ls.name);
    for (const w of workItems) if (w.location && w.location !== "â€”") names.add(w.location);
    return [...names].sort();
  }, [locations, locationStock, workItems]);



  // â”€â”€ Mutations (unchanged business logic) â”€â”€
  const signoff = useMutation({
    mutationFn: async ({
      id,
      action,
      notes,
    }: {
      id: string;
      action: "approve" | "reject";
      notes?: string;
    }) => api.goodsSalesOrders.warehouseApprove(id, action, notes),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["wh_sales_orders"] });
      qc.invalidateQueries({ queryKey: ["goods_sales_orders"] });
      toast.success(
        vars.action === "approve"
          ? "Order approved â€” sent to Checker"
          : "Order rejected â€” returned to Sales review",
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
    { id: "orders", label: "Order sign-offs", icon: ClipboardCheck, count: pendingSignoffs.length },
    { id: "ready", label: "Ready to dispatch", icon: PackageCheck, count: readyOrders.length + readyInvoices.length },
    { id: "dispatches", label: "Dispatches", icon: Truck, count: openDispatches.length },
  ];

  const profileInitial = (user?.contactName ?? user?.email ?? "W").trim().charAt(0).toUpperCase() || "W";
  const dateStr = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  const kpiLoading = ordersQ.isLoading || dispatchesQ.isLoading || movementsQ.isLoading || invoicesQ.isLoading;

  return (
    <div id="top" className="min-h-screen bg-[#f5f7fa]">
      {/* â”€â”€ 1. Page header â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
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
            <label className="sr-only" htmlFor="wh-location">Warehouse location</label>
            <div className="relative">
              <MapPin className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <select
                id="wh-location"
                value={locationFilter}
                onChange={(e) => setLocationFilter(e.target.value)}
                className="appearance-none rounded-lg border border-border bg-white py-2 pl-8 pr-8 text-[13px] text-foreground shadow-sm focus:border-primary focus:outline-none"
              >
                <option value="">All warehouses</option>
                {locationOptions.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-[12px] tabular-nums text-muted-foreground shadow-sm">
              <Clock3 className="h-3.5 w-3.5" />
              {dateStr} Â· {timeStr}
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

        {/* â”€â”€ 2. Warehouse navigation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <nav aria-label="Warehouse sections" className="mx-auto w-full max-w-[1440px] px-4 md:px-8">
          <div className="-mb-px flex gap-1 overflow-x-auto">
            {SUBNAV.map((s) =>
              s.active ? (
                <span
                  key={s.id}
                  aria-current="page"
                  className="whitespace-nowrap border-b-2 border-primary px-3 py-2.5 text-[13px] font-semibold text-primary"
                >
                  {s.label}
                </span>
              ) : s.external ? (
                <a
                  key={s.id}
                  href={s.href}
                  className="whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-[13px] text-muted-foreground transition hover:border-border hover:text-foreground"
                >
                  {s.label}
                </a>
              ) : (
                <a
                  key={s.id}
                  href={s.href}
                  className="whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-[13px] text-muted-foreground transition hover:border-border hover:text-foreground"
                >
                  {s.label}
                </a>
              ),
            )}
          </div>
        </nav>
      </div>

      <div className="mx-auto w-full max-w-[1440px] space-y-6 px-4 py-6 md:px-8 md:py-8">
        {/* â”€â”€ 3. KPI cards â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {kpiLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse rounded-xl border border-border bg-white p-5">
                <div className="h-3 w-28 rounded bg-muted" />
                <div className="mt-3 h-8 w-16 rounded bg-muted" />
                <div className="mt-2 h-3 w-24 rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              title="Order Sign-offs Pending"
              value={String(pendingSignoffs.length)}
              hint="Awaiting warehouse decision"
              icon={<ClipboardCheck className="h-5 w-5" />}
              iconBg="bg-sem-attention/15 text-sem-attention"
              accent="amber"
            />
            <KpiCard
              title="Ready to Dispatch"
              value={String(readyOrders.length + readyInvoices.length)}
              hint="Approved orders + invoices"
              icon={<PackageCheck className="h-5 w-5" />}
              iconBg="bg-sem-success/15 text-sem-success"
            />
            <KpiCard
              title="Dispatches Due Today"
              value={String(dispatchesDueToday.count)}
              hint="To pick, pack and dispatch"
              icon={<Package className="h-5 w-5" />}
              iconBg="bg-primary/10 text-primary"
            />
            <KpiCard
              title="Returns Awaiting Inspection"
              value={String(returnsAwaiting.count)}
              hint="In inspection area"
              icon={<RotateCcw className="h-5 w-5" />}
              iconBg="bg-destructive/10 text-destructive"
              accent="red"
            />
          </div>
        )}

        {/* â”€â”€ 4. Main work area â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <div className="grid gap-6 lg:grid-cols-4">
          {/* â”€â”€ 5. Warehouse work items â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
          <div id="wh-work-items" className="overflow-hidden rounded-xl border border-border bg-white shadow-[0_1px_2px_rgba(15,31,56,0.05)] lg:col-span-3">
            <div className="flex items-center justify-between gap-3 border-b border-border/80 px-5 py-3.5">
              <h2 className="text-[15px] font-semibold tracking-tight text-[#0f1f38]">
                Warehouse work items
                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                  {filteredWorkItems.length}
                </span>
              </h2>
              <button
                onClick={() => setShowAllWorkItems((v) => !v)}
                className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline"
              >
                {showAllWorkItems ? "Show less" : "View all"}
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
            {workItemsLoading ? (
              <div className="p-5"><TableSkeleton rows={6} cols={6} /></div>
            ) : visibleWorkItems.length === 0 ? (
              <EmptyState
                icon={<PackageCheck className="h-5 w-5" />}
                title={locationFilter ? `No work items in ${locationFilter}` : "All caught up"}
                description="Approved orders and ready dispatches will appear here as actionable work items."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-[11px] uppercase tracking-widest text-muted-foreground">
                      <th className="px-5 py-2.5 font-medium">Document</th>
                      <th className="px-5 py-2.5 font-medium">Location</th>
                      <th className="px-5 py-2.5 font-medium">Current Status</th>
                      <th className="px-5 py-2.5 font-medium">Next Step</th>
                      <th className="px-5 py-2.5 font-medium">Owner</th>
                      <th className="px-5 py-2.5 text-right font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleWorkItems.map((w) => (
                      <tr key={w.id} className="border-b border-border/60 last:border-0 hover:bg-muted/20">
                        <td className="px-5 py-3">
                          <div className="font-mono text-[13px] font-medium text-foreground">{w.docNumber}</div>
                          <div className="text-[11px] text-muted-foreground">{w.docType}</div>
                        </td>
                        <td className="px-5 py-3 text-[13px] text-muted-foreground">{w.location}</td>
                        <td className="px-5 py-3">
                          <span className={`inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-medium ${toneClass(w.tone)}`}>
                            {w.status}
                          </span>
                        </td>
                        <td className="max-w-[240px] px-5 py-3 text-[13px] text-foreground">{w.nextStep}</td>
                        <td className="max-w-[140px] truncate px-5 py-3 text-[13px] text-muted-foreground">{w.owner}</td>
                        <td className="px-5 py-3">
                          <div className="relative flex items-center justify-end gap-1.5">
                            <a
                              href={w.openHref}
                              className="rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
                            >
                              {w.openLabel}
                            </a>
                            <button
                              aria-label={`More actions for ${w.docNumber}`}
                              onClick={() => setOpenMenuId((v) => (v === w.id ? null : w.id))}
                              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </button>
                            {openMenuId === w.id && (
                              <>
                                <button
                                  aria-label="Close menu"
                                  className="fixed inset-0 z-10 cursor-default"
                                  onClick={() => setOpenMenuId(null)}
                                />
                                <div className="absolute right-0 top-9 z-20 w-52 rounded-lg border border-border bg-white py-1 shadow-lg">
                                  <a href={w.openHref} className="block px-3 py-2 text-[13px] hover:bg-muted/50">
                                    Open document
                                  </a>
                                  {w.id.startsWith("so-") && canWrite && (
                                    <>
                                      <button
                                        onClick={() => {
                                          setOpenMenuId(null);
                                          signoff.mutate({ id: w.id.replace("so-", ""), action: "approve" });
                                        }}
                                        className="block w-full px-3 py-2 text-left text-[13px] hover:bg-muted/50"
                                      >
                                        Approve sign-off
                                      </button>
                                      <button
                                        onClick={() => {
                                          setOpenMenuId(null);
                                          signoff.mutate({ id: w.id.replace("so-", ""), action: "reject" });
                                        }}
                                        className="block w-full px-3 py-2 text-left text-[13px] text-destructive hover:bg-muted/50"
                                      >
                                        Reject sign-off
                                      </button>
                                    </>
                                  )}
                                  {(w.id.startsWith("ready-") || w.id.startsWith("inv-")) && (
                                    <a href={w.openHref} className="block px-3 py-2 text-[13px] hover:bg-muted/50">
                                      Create dispatch
                                    </a>
                                  )}
                                  {(w.id.startsWith("pipe-") || w.id.startsWith("ret-")) && (
                                    <a href="/app/dispatches" className="block px-3 py-2 text-[13px] hover:bg-muted/50">
                                      Go to dispatch register
                                    </a>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* â”€â”€ 6. Stock by location â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
          <aside className="h-fit overflow-hidden rounded-xl border border-border bg-white shadow-[0_1px_2px_rgba(15,31,56,0.05)]">
            <div className="border-b border-border/80 px-5 py-3.5">
              <h2 className="text-[15px] font-semibold tracking-tight text-[#0f1f38]">Stock by location</h2>
            </div>
            <div className="px-5 py-2">
              {stockSummaryQ.isLoading || movementsQ.isLoading ? (
                <div className="space-y-3 py-3" aria-label="Loading stock by location">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div key={i} className="flex animate-pulse items-center justify-between py-1.5">
                      <div className="h-3 w-24 rounded bg-muted" />
                      <div className="h-3 w-14 rounded bg-muted" />
                    </div>
                  ))}
                </div>
              ) : locationStock.length === 0 ? (
                <p className="py-6 text-center text-[13px] text-muted-foreground">
                  No stock recorded yet â€” confirmed stock will appear here by location.
                </p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {locationStock.slice(0, 5).map((l) => (
                    <li key={l.name} className="flex items-baseline justify-between gap-3 py-2.5">
                      <span className="truncate text-[13px] text-foreground">{l.name}</span>
                      <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">
                        {Math.round(l.qty).toLocaleString()} items
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="px-5 pb-4 pt-1">
              <a
                href="/app/inventory"
                className="block rounded-lg border border-border px-3 py-2 text-center text-[13px] font-medium text-primary transition hover:border-primary/50 hover:bg-primary/5"
              >
                View inventory by location â†’
              </a>
            </div>
          </aside>
        </div>

        {/* â”€â”€ 7. Bottom operations strip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-white px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
            <span className="font-semibold text-[#0f1f38]">Keep stock moving</span>
            <span className="mx-1 text-muted-foreground">Â·</span>
            {["Pick", "Pack", "Dispatch"].map((s, i, arr) => (
              <span key={s} className="inline-flex items-center gap-2">
                <span className="text-muted-foreground">{s}</span>
                {i < arr.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />}
              </span>
            ))}
          </div>
          <p className="text-[12px] text-muted-foreground">Accurate stock. On time. Every time.</p>
        </div>

        {/* â”€â”€ Detail queues (existing functionality, preserved) â”€â”€ */}
        <div id="wh-detail-queues" className="scroll-mt-6">
          <Card
            title="Detail queues"
            action={
              <span className="text-[11px] text-muted-foreground">
                {totalUnits.toLocaleString()} units Â· {fmtMoney(totalStockValue)}
              </span>
            }
          >
            <div className="mb-4 flex flex-wrap gap-2">
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

        {tab === "overview" && (
          <div id="wh-activity" className="grid scroll-mt-6 gap-6 lg:grid-cols-2">
            <Card title="Live dispatch pipeline">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {SHIPPING_STATUSES.map((s) => (
                  <div key={s} className="rounded-lg border border-border p-3">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      {SHIPPING_LABEL[s]}
                    </div>
                    <div className="num mt-1 text-2xl">
                      {dispatches.filter((d) => (d.shipping_status ?? "awaiting_pick") === s && d.status !== "cancelled")
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
                        {d.dispatch_number} Â· {d.customer_name ?? d.so_number ?? "â€”"}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest ${shippingTone(
                          d.shipping_status ?? "awaiting_pick",
                        )}`}
                      >
                        {SHIPPING_LABEL[d.shipping_status ?? "awaiting_pick"]}
                      </span>
                    </li>
                  ))}
                  {movements.slice(0, 5).map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-3 text-muted-foreground">
                      <span className="truncate">
                        {m.direction === "in" ? "In" : "Out"} Â· {m.item_name} Ã— {Number(m.quantity).toLocaleString()}
                      </span>
                      <span className="shrink-0 text-xs">{fmtDate(m.movement_date)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}

        {tab === "orders" && (
          <Card title="Sales orders for warehouse sign-off">
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
                      <td className="px-5 py-3">{o.customer_name ?? "â€”"}</td>
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
                              onClick={() => signoff.mutate({ id: o.id, action: "approve" })}
                              disabled={signoff.isPending}
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
            </p>
          </Card>
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
                  description="Approve orders in Order sign-offs, then wait for Checker approval. Confirmed orders appear here."
                />
              ) : (
                <Table head={["Order", "Buyer", "Expected", "Pending qty", "Pending value", ""]}>
                  {readyOrders.map((o) => (
                    <tr key={o.id} className="border-b border-border/60 hover:bg-muted/30">
                      <td className="px-5 py-3">{o.so_number}</td>
                      <td className="px-5 py-3">{o.customer_name ?? "â€”"}</td>
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
                  description="Approved invoices with an expected dispatch date appear here. Create a dispatch to ship the goods."
                />
              ) : (
                <Table head={["Invoice", "Customer", "Amount", "Expected dispatch", "Days left", ""]}>
                  {readyInvoices.map((inv: any) => {
                    const daysLeft = inv.expected_dispatch_date
                      ? Math.max(0, Math.round((new Date(inv.expected_dispatch_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)))
                      : 0;
                    return (
                      <tr key={inv.id} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-3">
                          <div className="font-mono text-xs">{inv.invoice_number}</div>
                          {inv.goods_sales_order_number && (
                            <div className="text-[10px] text-muted-foreground">SO {inv.goods_sales_order_number}</div>
                          )}
                        </td>
                        <td className="px-5 py-3">{inv.debtor?.name ?? "â€”"}</td>
                        <td className="num px-5 py-3 text-right">{fmtMoney(inv.grand_total ?? inv.amount)}</td>
                        <td className="px-5 py-3 text-muted-foreground">{fmtDate(inv.expected_dispatch_date)}</td>
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
              <p className="mt-4 text-xs text-muted-foreground">
                Every dispatch can be linked to an invoice â€” the invoice reference is stored on the dispatch record and
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
          </Card>
        </div>
      </div>
    </div>
  );
}

// â”€â”€â”€ KPI card (spec Â§3 â€” light bg, navy number, tinted icon, amber/red accents) â”€â”€
function KpiCard({
  title,
  value,
  hint,
  icon,
  iconBg,
  accent,
}: {
  title: string;
  value: string;
  hint: string;
  icon: React.ReactNode;
  iconBg: string;
  accent?: "amber" | "red";
}) {
  return (
    <div
      className={`rounded-xl border bg-white p-5 shadow-[0_1px_2px_rgba(15,31,56,0.05)] ${
        accent === "amber" ? "border-sem-attention/30" : accent === "red" ? "border-destructive/25" : "border-border"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-muted-foreground">{title}</p>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>{icon}</span>
      </div>
      <p className="num mt-1 text-[30px] font-semibold leading-none tracking-tight text-[#0f1f38]">{value}</p>
      <p className={`mt-1.5 text-[12px] ${accent === "red" ? "text-destructive" : accent === "amber" ? "text-sem-attention" : "text-muted-foreground"}`}>
        {hint}
      </p>
    </div>
  );
}

// â”€â”€â”€ Dispatches tab â€” pipeline dropdown + inline carrier/tracking editor â”€â”€
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

  const startEdit = (d: Dispatch) => {
    setEditing(d.id);
    setCarrier(d.transporter_name ?? "");
    setTracking(d.tracking_number ?? "");
  };

  const saveMeta = (d: Dispatch) => {
    onMove({
      id: d.id,
      status: (d.shipping_status ?? "awaiting_pick") as ShippingStatus,
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
          const current = (d.shipping_status ?? "awaiting_pick") as ShippingStatus;
          const forward = SHIPPING_STATUSES.slice(
            SHIPPING_STATUSES.indexOf(current) + 1,
          ) as ShippingStatus[];
          return (
            <tr key={d.id} className="border-b border-border/60 hover:bg-muted/30">
              <td className="px-5 py-3">{d.dispatch_number}</td>
              <td className="px-5 py-3">
                <div>{d.so_number ?? "â€”"}</div>
                <div className="text-xs text-muted-foreground">{d.customer_name ?? "â€”"}</div>
              </td>
              <td className="px-5 py-3 text-muted-foreground">{fmtDate(d.dispatch_date)}</td>
              <td className="px-5 py-3 text-xs">
                {editing === d.id ? (
                  <div className="flex w-56 flex-col gap-1.5">
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
                      <span className="truncate">{d.transporter_name ?? "â€”"}</span>
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
                        onChange={(e) => onMove({ id: d.id, status: e.target.value as ShippingStatus })}
                        title="Awaiting Pickup → Picking → Packing → Dispatched (debits stock) → In Transit → Delivered"
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
        The pipeline moves forward only (Awaiting Pickup → Picking → Packing → Dispatched → In Transit → Delivered).
        Only the move to Dispatched debits inventory. Selecting
        "Delivered" records delivery against the dispatch.
      </p>
    </Card>
  );
}

// â”€â”€â”€ Shared table shell (matches the app's list pages) â”€â”€
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
