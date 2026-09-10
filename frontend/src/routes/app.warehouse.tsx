import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import {
  PageHeader,
  Card,
  Stat,
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
  ClipboardList,
  Boxes,
  BarChart3,
  CheckCircle2,
  Ban,
  Pencil,
  X,
  Loader2,
  ArrowDownToLine,
  ArrowUpFromLine,
  FileText,
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

// ─── Shipping pipeline (pure logistics — stock is debited once at confirm) ──
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
  awaiting_pick: "Awaiting pick",
  picking: "Picking",
  packed: "Packed",
  dispatched: "Dispatched",
  in_transit: "In transit",
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
  lines: SOLine[];
};

type GoodsPO = {
  id: string;
  po_number: string;
  po_date: string;
  supplier_name: string | null;
  expected_delivery_date: string | null;
  status: string;
  warehouse: string | null;
  grand_total: number;
  lines: Array<{
    product_id: string;
    name: string;
    ordered_qty: number;
    received_qty: number;
    unit_price: number;
  }>;
};

type WarehouseGRN = {
  id: string;
  receipt_number: string;
  goods_purchase_order_id: string;
  po_number: string | null;
  supplier_name: string | null;
  received_date: string;
  status: string;
  warehouse: string | null;
  lines: Array<{
    product_id: string;
    name: string;
    ordered_qty: number;
    received_qty: number;
    accepted_qty: number;
    unit_cost: number;
  }>;
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
};

type GoodsReceipt = {
  id: string;
  receipt_number: string;
  supplier_name: string | null;
};

type Tab = "overview" | "orders" | "ready" | "pos" | "grns" | "dispatches" | "stock" | "reports";

function WarehousePage() {
  const { user, isAdmin, isOperations } = useAuth();
  const canWrite = isAdmin || isOperations;
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");

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
  const posQ = useQuery({
    queryKey: ["wh_pos"],
    queryFn: () => api.goodsPurchaseOrders.list(),
  });
  const grnsQ = useQuery({
    queryKey: ["wh_grns"],
    queryFn: () => api.goodsReceipts.list(),
  });
  const movementsQ = useQuery({
    queryKey: ["wh_movements"],
    queryFn: () => api.stockMovements.list(),
  });
  const receiptsQ = useQuery({
    queryKey: ["wh_receipts"],
    queryFn: () => api.goodsReceipts.list(),
  });

  const orders = (ordersQ.data ?? []) as SO[];
  const dispatches = (dispatchesQ.data ?? []) as Dispatch[];
  const invoices = (invoicesQ.data ?? []) as any[];
  const pos = (posQ.data ?? []) as GoodsPO[];
  const grns = (grnsQ.data ?? []) as WarehouseGRN[];
  const movements = (movementsQ.data ?? []) as Movement[];
  const receipts = (receiptsQ.data ?? []) as any[];

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

  // ── Stock on hand + valuation (confirmed movements only) ──
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
  const negatives = stock.filter((s) => s.qty < 0).length;

  // ── Order sign-off queue (hard gate: only approved SOs can be dispatched) ──
  const signoffOrders = orders.filter(
    (o) => ["warehouse_pending", "checker_pending", "confirmed", "partially_dispatched"].includes(o.status),
  );
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

  // ── Ready to dispatch from invoices: approved invoices with expected dispatch date ──
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

  // ── Ready POs: approved POs with pending receipt quantity ──
  const readyPOs = useMemo(() => {
    return pos
      .filter((po) => {
        if (po.status === 'cancelled' || po.status === 'draft') return false;
        if (po.status === 'fully_received') return false;
        // Check if any lines have pending quantity (ordered but not fully received)
        const hasPending = (po.lines ?? []).some(
          (l) => l.ordered_qty > (l.received_qty ?? 0)
        );
        if (!hasPending) return false;
        // Skip POs that already have a GRN linked
        const hasGrn = grns.some((g) => g.goods_purchase_order_id === po.id);
        if (hasGrn) return false;
        return true;
      })
      .sort((a, b) => (a.expected_delivery_date ?? '').localeCompare(b.expected_delivery_date ?? ''));
  }, [pos, grns]);

  // ── Pending GRNs: draft GRNs awaiting confirmation (stock credit) ──
  const pendingGrns = useMemo(() => {
    return grns
      .filter((grn) => {
        // Show draft GRNs that haven't been confirmed yet
        if (grn.status === 'confirmed' || grn.status === 'cancelled') return false;
        return true;
      })
      .sort((a, b) => (a.received_date ?? '').localeCompare(b.received_date ?? ''));
  }, [grns]);

  const openDispatches = dispatches.filter(
    (d) => !["delivered", "cancelled", "returned"].includes(d.status),
  );

  

  // ── In / out report grouped by supplier (in) and buyer (out) ──
  const receiptById = useMemo(
    () => new Map(receipts.map((r) => [r.id, r])),
    [receipts],
  );
  const dispatchById = useMemo(
    () => new Map(dispatches.map((d) => [d.id, d])),
    [dispatches],
  );
  const soById = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);

  const partyReport = useMemo(() => {
    const m = new Map<
      string,
      { party: string; side: "Supplier" | "Buyer"; inQty: number; outQty: number; inValue: number; outValue: number }
    >();
    for (const r of movements) {
      if (r.status !== "confirmed") continue;
      const isIn = r.direction === "in";
      let party: string;
      if (isIn) {
        const gr = r.goods_receipt_id ? receiptById.get(r.goods_receipt_id) : null;
        party = gr?.supplier_name ?? "Unattributed supplier";
      } else {
        const dp = r.goods_dispatch_id ? dispatchById.get(r.goods_dispatch_id) : null;
        const so = !dp && r.sales_order_id ? soById.get(r.sales_order_id) : null;
        party = dp?.customer_name ?? so?.customer_name ?? "Unattributed buyer";
      }
      const side: "Supplier" | "Buyer" = isIn ? "Supplier" : "Buyer";
      const k = `${side}|${party}`;
      const cur = m.get(k) ?? { party, side, inQty: 0, outQty: 0, inValue: 0, outValue: 0 };
      const qty = Number(r.quantity);
      const val = qty * Number(r.unit_cost ?? 0);
      if (isIn) {
        cur.inQty += qty;
        cur.inValue += val;
      } else {
        cur.outQty += qty;
        cur.outValue += val;
      }
      m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => b.inValue + b.outValue - (a.inValue + a.outValue));
  }, [movements, receiptById, dispatchById, soById]);

  // ── Mutations ──
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wh_dispatches"] });
      qc.invalidateQueries({ queryKey: ["goods_dispatches"] });
      toast.success("Dispatch updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  const tabs: { id: Tab; label: string; icon: any; count?: number }[] = [
    { id: "overview", label: "Overview", icon: BarChart3 },
    { id: "orders", label: "Order sign-offs", icon: ClipboardCheck, count: pendingSignoffs.length },
    { id: "ready", label: "Ready to dispatch", icon: PackageCheck, count: readyOrders.length },
    { id: "pos", label: "Pending POs", icon: ClipboardList, count: readyPOs.length },
    { id: "grns", label: "GRNs", icon: CheckCircle2, count: pendingGrns.length },
    { id: "dispatches", label: "Dispatches", icon: Truck, count: openDispatches.length },
    { id: "stock", label: "Stock on hand", icon: Boxes },
    { id: "reports", label: "Movement report", icon: BarChart3 },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Warehouse"
        title="Warehouse control"
        icon={<Warehouse className="h-5 w-5" />}
        description="Everything moving through the warehouse: order sign-off, dispatch readiness, live shipment pipeline, stock on hand and in/out reporting by supplier and buyer."
        actions={
          !canWrite ? (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
              Read-only
            </span>
          ) : null
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Total stock value" value={fmtMoney(totalStockValue)} delta={`${stock.length} item lines`} />
          <Stat
            label="Units on hand"
            value={totalUnits.toLocaleString()}
            delta={negatives ? `${negatives} negative balance(s)` : "All balances positive"}
            tone={negatives ? "bad" : "good"}
          />
          <Stat
            label="Awaiting warehouse sign-off"
            value={String(pendingSignoffs.length)}
            delta="Sales orders"
            tone={pendingSignoffs.length ? "warn" : "neutral"}
          />
          <Stat
            label="Open dispatches"
            value={String(openDispatches.length)}
            delta={`${readyOrders.length} order(s) ready to pack`}
          />
        </div>

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

        {tab === "overview" && (
          <div className="grid gap-6 lg:grid-cols-2">
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
                The pipeline is logistics-only — stock is debited once, when a dispatch note is confirmed.
              </p>
            </Card>
            <Card title="Latest activity">
              {movements.length === 0 && dispatches.length === 0 ? (
                <EmptyState
                  icon={<Boxes className="h-5 w-5" />}
                  title="Nothing has moved yet"
                  description="Confirmed GRNs and dispatches will appear here."
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
                        {m.direction === "in" ? "In" : "Out"} · {m.item_name} × {Number(m.quantity).toLocaleString()}
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
                        <td className="px-5 py-3">{inv.debtor?.name ?? "—"}</td>
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
                Every dispatch can be linked to an invoice — the invoice reference is stored on the dispatch record and
                appears in the movement report. Create a dispatch from here to auto-link the invoice.
              </p>
            </Card>
          </div>
        )}

        {tab === "pos" && (
          <Card title="Purchase orders awaiting goods receipt">
            {posQ.isLoading ? (
              <TableSkeleton rows={3} />
            ) : readyPOs.length === 0 ? (
              <EmptyState
                icon={<ClipboardList className="h-5 w-5" />}
                title="No POs waiting"
                description="Approved purchase orders with pending quantity appear here. Create a GRN to receive the goods."
              />
            ) : (
              <Table head={["PO", "Supplier", "Expected delivery", "Pending qty", "Value", ""]}>
                {readyPOs.map((po) => {
                  const pendingQty = (po.lines ?? []).reduce(
                    (s, l) => s + Math.max(0, l.ordered_qty - (l.received_qty ?? 0)),
                    0
                  );
                  const pendingValue = (po.lines ?? []).reduce(
                    (s, l) => s + Math.max(0, l.ordered_qty - (l.received_qty ?? 0)) * (l.unit_price || 0),
                    0
                  );
                  return (
                    <tr key={po.id} className="border-b border-border/60 hover:bg-muted/30">
                      <td className="px-5 py-3">
                        <div className="font-mono text-xs">{po.po_number}</div>
                      </td>
                      <td className="px-5 py-3">{po.supplier_name ?? "—"}</td>
                      <td className="px-5 py-3 text-muted-foreground">{fmtDate(po.expected_delivery_date)}</td>
                      <td className="num px-5 py-3 text-right">{pendingQty.toLocaleString()}</td>
                      <td className="num px-5 py-3 text-right">{fmtMoney(pendingValue)}</td>
                      <td className="px-5 py-3 text-right">
                        <a
                          href="/app/grn?createFromPO=${encodeURIComponent(po.id)}"
                          className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground"
                        >
                          <PackageCheck className="h-3 w-3" /> Create GRN
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </Table>
            )}
            <p className="mt-4 text-xs text-muted-foreground">
              Goods Receipt Notes (GRNs) credit inventory when goods arrive. Create a GRN from here to auto-link the
              purchase order and record the received quantities.
            </p>
          </Card>
        )}

        {tab === "grns" && (
          <Card title="Goods receipts">
            {grnsQ.isLoading ? (
              <TableSkeleton rows={3} />
            ) : grns.length === 0 ? (
              <EmptyState
                icon={<ClipboardCheck className="h-5 w-5" />}
                title="No goods receipts yet"
                description="GRNs are created when goods arrive against a purchase order."
              />
            ) : (
              <Table head={["GRN", "PO", "Supplier", "Received", "Status", ""]}>
                {grns.map((grn) => {
                  const totalReceived = (grn.lines ?? []).reduce(
                    (s, l) => s + (l.accepted_qty ?? l.received_qty ?? 0),
                    0
                  );
                  const totalValue = (grn.lines ?? []).reduce(
                    (s, l) => s + (l.accepted_qty ?? l.received_qty ?? 0) * (l.unit_cost || 0),
                    0
                  );
                  const statusClass =
                    grn.status === "confirmed"
                      ? "bg-sem-success/15 text-sem-success"
                      : grn.status === "cancelled"
                        ? "bg-destructive/15 text-destructive"
                        : "bg-sem-attention/15 text-sem-attention";
                  return (
                    <tr key={grn.id} className="border-b border-border/60 hover:bg-muted/30">
                      <td className="px-5 py-3">
                        <div className="font-mono text-xs">{grn.receipt_number}</div>
                      </td>
                      <td className="px-5 py-3">{grn.po_number ?? "—"}</td>
                      <td className="px-5 py-3">{grn.supplier_name ?? "—"}</td>
                      <td className="num px-5 py-3 text-right">{totalReceived.toLocaleString()}</td>
                      <td className="px-5 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest ${statusClass}`}>
                          {grn.status?.replace("_", " ")}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        {grn.status === "draft" && (
                          <>
                            <a
                              href="/app/grn?edit=${grn.id}"
                              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs mr-1"
                            >
                              <Pencil className="h-3 w-3" /> Edit
                            </a>
                            <button
                              onClick={() => {
                                window.location.href = `/app/grn?id=${grn.id}`;
                              }}
                              className="inline-flex items-center gap-1 rounded-md bg-sem-success/10 px-2.5 py-1 text-xs text-sem-success"
                            >
                              <CheckCircle2 className="h-3 w-3" /> Confirm
                            </button>
                          </>
                        )}
                        {grn.status === "confirmed" && canWrite && (
                          <button
                            onClick={() => {
                              if (confirm("Cancel this GRN? Stock will be reversed.")) {
                                window.location.href = `/app/grn?cancel=${grn.id}`;
                              }
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-destructive"
                          >
                            <X className="h-3 w-3" /> Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </Table>
            )}
            <p className="mt-4 text-xs text-muted-foreground">
              Confirming a GRN credits stock-in movements and updates the purchase order's received quantities.
              Draft GRNs can be edited before confirmation.
            </p>
          </Card>
        )}

        {tab === "dispatches" && (
          <DispatchTable
            dispatches={dispatches}
            loading={dispatchesQ.isLoading}
            canWrite={canWrite}
            onMove={(vars) => shipMove.mutate(vars)}
            moving={shipMove.isPending}
          />
        )}

        {tab === "stock" && (
          <Card title={`Stock on hand — total value ${fmtMoney(totalStockValue)}`}>
            {movementsQ.isLoading ? (
              <TableSkeleton rows={5} />
            ) : stock.length === 0 ? (
              <EmptyState
                icon={<Boxes className="h-5 w-5" />}
                title="No stock recorded yet"
                description="Confirmed GRNs credit stock; confirmed dispatches debit it."
              />
            ) : (
              <Table head={["Item", "SKU", "On hand", "Unit", "Last in-cost", "Stock value"]}>
                {stock.map((s) => (
                  <tr key={`${s.item}|${s.unit}`} className="border-b border-border/60">
                    <td className="px-5 py-2.5">{s.item}</td>
                    <td className="px-5 py-2.5 text-muted-foreground">{s.sku ?? "—"}</td>
                    <td className={`num px-5 py-2.5 text-right ${s.qty < 0 ? "text-destructive" : ""}`}>
                      {s.qty.toLocaleString()}
                    </td>
                    <td className="px-5 py-2.5 text-muted-foreground">{s.unit}</td>
                    <td className="num px-5 py-2.5 text-right">{s.lastCost ? fmtMoney(s.lastCost) : "—"}</td>
                    <td className="num px-5 py-2.5 text-right">{fmtMoney(s.value)}</td>
                  </tr>
                ))}
                <tr className="bg-muted/40 font-medium">
                  <td className="px-5 py-3" colSpan={5}>
                    Total stock value
                  </td>
                  <td className="num px-5 py-3 text-right">{fmtMoney(totalStockValue)}</td>
                </tr>
              </Table>
            )}
          </Card>
        )}

        {tab === "reports" && (
          <div className="space-y-6">
            <Card title="Stock in / out by supplier and buyer">
              {movementsQ.isLoading ? (
                <TableSkeleton rows={4} />
              ) : partyReport.length === 0 ? (
                <EmptyState
                  icon={<BarChart3 className="h-5 w-5" />}
                  title="No movements to report"
                  description="Confirmed stock movements are grouped by supplier (in) and buyer (out)."
                />
              ) : (
                <Table head={["Party", "Type", "Qty in", "Value in", "Qty out", "Value out", "Net qty"]}>
                  {partyReport.map((p) => (
                    <tr key={`${p.side}|${p.party}`} className="border-b border-border/60">
                      <td className="px-5 py-2.5">{p.party}</td>
                      <td className="px-5 py-2.5 text-xs uppercase tracking-widest text-muted-foreground">{p.side}</td>
                      <td className="num px-5 py-2.5 text-right">{p.inQty.toLocaleString()}</td>
                      <td className="num px-5 py-2.5 text-right">{fmtMoney(p.inValue)}</td>
                      <td className="num px-5 py-2.5 text-right">{p.outQty.toLocaleString()}</td>
                      <td className="num px-5 py-2.5 text-right">{fmtMoney(p.outValue)}</td>
                      <td className="num px-5 py-2.5 text-right">{(p.inQty - p.outQty).toLocaleString()}</td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
            <Card title="Movement log">
              {movementsQ.isLoading ? (
                <TableSkeleton rows={6} />
              ) : movements.length === 0 ? (
                <EmptyState
                  icon={<ArrowDownToLine className="h-5 w-5" />}
                  title="No movements recorded"
                />
              ) : (
                <Table head={["Date", "Direction", "Item", "Qty", "Value", "Counterparty", "Document"]}>
                  {movements.slice(0, 200).map((m) => {
                    const isIn = m.direction === "in";
                    let party = "—";
                    if (isIn) {
                      const gr = m.goods_receipt_id ? receiptById.get(m.goods_receipt_id) : null;
                      party = gr?.supplier_name ?? "—";
                    } else {
                      const dp = m.goods_dispatch_id ? dispatchById.get(m.goods_dispatch_id) : null;
                      const so = !dp && m.sales_order_id ? soById.get(m.sales_order_id) : null;
                      party = dp?.customer_name ?? so?.customer_name ?? "—";
                    }
                    return (
                      <tr key={m.id} className="border-b border-border/60">
                        <td className="px-5 py-2.5 text-muted-foreground">{fmtDate(m.movement_date)}</td>
                        <td className={`px-5 py-2.5 ${isIn ? "text-sem-success" : "text-sem-attention"}`}>
                          <span className="inline-flex items-center gap-1">
                            {isIn ? <ArrowDownToLine className="h-3.5 w-3.5" /> : <ArrowUpFromLine className="h-3.5 w-3.5" />}
                            {isIn ? "In" : "Out"}
                          </span>
                        </td>
                        <td className="px-5 py-2.5">{m.item_name}</td>
                        <td className="num px-5 py-2.5 text-right">
                          {Number(m.quantity).toLocaleString()}{" "}
                          <span className="text-[10px] text-muted-foreground">{m.unit}</span>
                        </td>
                        <td className="num px-5 py-2.5 text-right">
                          {fmtMoney(Number(m.quantity) * Number(m.unit_cost ?? 0))}
                        </td>
                        <td className="px-5 py-2.5">{party}</td>
                        <td className="px-5 py-2.5 text-muted-foreground">{m.linked_document_number ?? "—"}</td>
                      </tr>
                    );
                  })}
                </Table>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Dispatches tab — pipeline dropdown + inline carrier/tracking editor ──
function DispatchTable({
  dispatches,
  loading,
  canWrite,
  onMove,
  moving,
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
          canWrite ? "" : "Status",
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
                <div>{d.so_number ?? "—"}</div>
                <div className="text-xs text-muted-foreground">{d.customer_name ?? "—"}</div>
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
        The pipeline moves forward only (awaiting pick → picking → packed → dispatched → in transit → delivered) and
        never touches stock — inventory was already debited when the dispatch note was confirmed. Selecting
        "Delivered" records delivery against the dispatch.
      </p>
    </Card>
  );
}

// ─── Shared table shell (matches the app's list pages) ──
function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="-mx-5 overflow-x-auto">
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
