import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import api from "@/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  EmptyState,
  StatusPill,
  fmtMoney,
  fmtDate,
  daysBetween,
} from "@/components/ledger-ui";
import {
  ArrowRight,
  Wallet,
  Receipt,
  CreditCard,
  ClipboardList,
  CheckCircle2,
  TrendingUp,
  PackageCheck,
  Hourglass,
} from "lucide-react";
import { useCommandData, num, pick } from "@/components/command-overview/useCommandData";
import {
  KpiCard,
  KpiSkeleton,
  SectionCard,
  CardError,
  TabBar,
  type CommandTab,
  fmtCompact,
  fmtFull,
} from "@/components/command-overview/cards";
import { CashPositionCard } from "@/components/command-overview/CashPositionCard";
import { PriorityTable } from "@/components/command-overview/PriorityTable";
import { InventoryAlerts, OperationalAlertsList } from "@/components/command-overview/Alerts";

export const Route = createFileRoute("/app/dashboard")({
  component: Dashboard,
});

/**
 * Command Overview — the executive command centre.
 * UI/UX layer only: every number comes from existing backend endpoints,
 * every action links to an existing route. No business-logic changes.
 */
function Dashboard() {
  const [tab, setTab] = useState<CommandTab>("summary");
  const { isAdmin, isSuperAdmin, isTreasury, isOperations, isSalesRep, isChecker } = useAuth();
  const admin = isAdmin || isSuperAdmin;

  const canFinance = admin || isTreasury || isOperations;
  const canSales = admin || isOperations || isSalesRep;
  const canWarehouse = admin || isOperations;
  const canChecker = admin || isChecker;
  const canProcurement = admin || isOperations;

  const d = useCommandData();
  const initialLoading = d.loading;

  const cashHealth =
    d.cashForecast?.cashStatus === "GREEN"
      ? {
          label: "Healthy",
          cls: "border-sem-success/25 bg-sem-success/10 text-sem-success",
          dot: "bg-sem-success",
        }
      : d.cashForecast?.cashStatus === "AMBER"
        ? {
            label: "Attention",
            cls: "border-sem-attention/30 bg-sem-attention/10 text-sem-attention",
            dot: "bg-sem-attention",
          }
        : d.cashForecast?.cashStatus === "RED"
          ? {
              label: "At risk",
              cls: "border-sem-critical/30 bg-sem-critical/10 text-sem-critical",
              dot: "bg-sem-critical",
            }
          : {
              label: "Live",
              cls: "border-border bg-muted/40 text-muted-foreground",
              dot: "bg-sem-info",
            };

  return (
    <div>
      {/* ── Command Overview header ── */}
      <div className="border-b border-border bg-background/80 px-6 py-6 backdrop-blur supports-[backdrop-filter]:bg-background/70 md:px-10">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-end justify-between gap-4">
          <div>
            <p className="inline-flex items-center rounded-full border border-primary/20 bg-primary-soft/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
              Command centre
            </p>
            <h1 className="mt-2 text-[24px] font-semibold tracking-tight text-foreground">
              Command Overview
            </h1>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
              Real-time view of your business, sales, procurement, finance and operations.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${cashHealth.cls}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${cashHealth.dot}`} />
              {cashHealth.label}
            </span>
            <Link
              to="/app/tasks"
              className="btn-primary shadow-card-hover"
              aria-label="Open Action Centre"
            >
              Open Action Centre
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
        <div className="mx-auto mt-4 max-w-[1440px]">
          <TabBar active={tab} onChange={setTab} />
        </div>
      </div>

      <div className="mx-auto max-w-[1440px] space-y-6 px-6 py-6 md:px-10 md:py-8">
        {tab === "summary" && (
          <>
            {/* ── KPI cards (dynamic, never hard-coded) ── */}
            <section
              aria-label="Key performance indicators"
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
            >
              {initialLoading ? (
                <>
                  <KpiSkeleton />
                  <KpiSkeleton />
                  <KpiSkeleton />
                  <KpiSkeleton />
                </>
              ) : (
                <>
                  {canFinance && (
                    <KpiCard
                      title="Available Cash"
                      value={fmtFull(d.availableCash)}
                      icon={<Wallet className="h-[18px] w-[18px]" />}
                      iconTone="green"
                      to="/app/cash-flow"
                      lines={
                        <>
                          <span>
                            Projected 7d:{" "}
                            <span className="num font-semibold text-foreground">
                              {fmtCompact(
                                num(
                                  pick(
                                    d.cashSummary,
                                    "projectedClosingCashNext7Days",
                                    "projected_closing_cash_next_7_days",
                                  ) || d.availableCash,
                                ),
                              )}
                            </span>
                          </span>
                          <span className="block">
                            {num(pick(d.cashSummary, "activeAccounts", "active_accounts")) || ""}{" "}
                            Across live bank &amp; cash accounts
                          </span>
                        </>
                      }
                    />
                  )}
                  {canFinance && (
                    <KpiCard
                      title="Receivables Due"
                      value={fmtFull(d.receivables.total)}
                      icon={<Receipt className="h-[18px] w-[18px]" />}
                      iconTone={d.receivables.overdueCount > 0 ? "red" : "amber"}
                      to="/app/finance-invoices"
                      lines={
                        <>
                          <span>{d.receivables.count} invoices · Due in next 30 days</span>
                          {d.receivables.overdueCount > 0 && (
                            <span className="block font-semibold text-sem-critical">
                              {d.receivables.overdueCount} overdue ·{" "}
                              {fmtCompact(d.receivables.overdueTotal)}
                            </span>
                          )}
                        </>
                      }
                      alert={
                        d.receivables.overdueCount > 0
                          ? `${d.receivables.overdueCount} invoices overdue`
                          : undefined
                      }
                    />
                  )}
                  {canFinance && (
                    <KpiCard
                      title="Payables Due"
                      value={fmtFull(d.payables.total)}
                      icon={<CreditCard className="h-[18px] w-[18px]" />}
                      iconTone={d.payables.overdueCount > 0 ? "red" : "amber"}
                      to="/app/finance-purchases"
                      lines={
                        <>
                          <span>{d.payables.count} invoices · Due in next 30 days</span>
                          {d.payables.overdueCount > 0 && (
                            <span className="block font-semibold text-sem-critical">
                              {d.payables.overdueCount} overdue ·{" "}
                              {fmtCompact(d.payables.overdueTotal)}
                            </span>
                          )}
                        </>
                      }
                      alert={
                        d.payables.overdueCount > 0
                          ? `${d.payables.overdueCount} invoices overdue`
                          : undefined
                      }
                    />
                  )}
                  <KpiCard
                    title="Orders Requiring Attention"
                    value={String(d.attentionCount)}
                    icon={<ClipboardList className="h-[18px] w-[18px]" />}
                    iconTone="amber"
                    to="/app/tasks"
                    lines={<span>Requires review across sales, procurement and warehouse</span>}
                  />
                </>
              )}
            </section>

            {/* ── Cash chart + Inventory alerts ── */}
            <div className="grid gap-6 lg:grid-cols-3">
              {canFinance && (
                <div className="lg:col-span-2">
                  <SectionCard
                    title="Cash Position: Actual vs Projected"
                    subtitle="Where is our cash position heading?"
                    actionLabel="Cash Command"
                    actionTo="/app/cash-flow"
                  >
                    <CashPositionCard compact />
                  </SectionCard>
                </div>
              )}
              {canWarehouse && (
                <div>
                  <SectionCard
                    title="Inventory & Forecast Alerts"
                    subtitle="SKUs requiring attention"
                    actionLabel="View all"
                    actionTo="/app/forecast"
                  >
                    <InventoryAlerts
                      alerts={d.inventory.all}
                      loading={d.inventoryLoading}
                      limit={5}
                    />
                  </SectionCard>
                </div>
              )}
            </div>

            {/* ── Cross-functional priorities ── */}
            <SectionCard
              title="Cross-functional priorities"
              subtitle="Tasks that need attention across the business."
              actionLabel="View all"
              actionTo="/app/tasks"
            >
              <PriorityTable
                rows={visiblePriorities(d.priorities, {
                  canSales,
                  canProcurement,
                  canWarehouse,
                  canFinance,
                  canChecker,
                })}
                loading={d.prioritiesLoading}
                limit={7}
              />
            </SectionCard>

            {/* ── Operational alerts ── */}
            <SectionCard
              title="Operational Alerts"
              subtitle="Overdue, delayed and pending-approval items across the platform."
              actionLabel="View all"
              actionTo="/app/alerts"
            >
              <OperationalAlertsList
                alerts={d.operationalAlerts}
                loading={d.alertsLoading}
                limit={6}
              />
            </SectionCard>
          </>
        )}

        {tab === "sales" && <SalesTab />}
        {tab === "cash" && <CashTab />}
        {tab === "receivables" && <ReceivablesTab />}
        {tab === "payables" && <PayablesTab />}
        {tab === "inventory" && <InventoryTab />}
        {tab === "alerts" && <AlertsTab />}
      </div>
    </div>
  );
}

/** Filter priority rows to modules the viewer may see. */
function visiblePriorities(
  rows: ReturnType<typeof useCommandData>["priorities"],
  vis: {
    canSales: boolean;
    canProcurement: boolean;
    canWarehouse: boolean;
    canFinance: boolean;
    canChecker: boolean;
  },
) {
  return rows.filter((r) => {
    if (r.area === "Sales" && !vis.canSales) return false;
    if (r.area === "Procurement" && !vis.canProcurement) return false;
    if (r.area === "Warehouse" && !vis.canWarehouse) return false;
    if (r.area === "Finance" && !vis.canFinance) return false;
    if (r.area === "Checker" && !vis.canChecker) return false;
    return true;
  });
}

/* ── Contextual tab views (same shell, same data) ── */

function SalesTab() {
  const d = useCommandData();
  if (d.loading) return <TabSkeleton />;
  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="Sales Order Value"
          value={fmtFull(d.sales.totalValue)}
          icon={<TrendingUp className="h-[18px] w-[18px]" />}
          to="/app/sales-workbench"
          lines={<span>{d.sales.count} orders</span>}
        />
        <KpiCard
          title="Accepted Orders"
          value={String(d.sales.acceptedCount)}
          icon={<CheckCircle2 className="h-[18px] w-[18px]" />}
          iconTone="green"
          to="/app/sales-workbench"
          lines={<span className="num">{fmtCompact(d.sales.acceptedValue)} accepted value</span>}
        />
        <KpiCard
          title="Awaiting Acceptance"
          value={String(d.sales.awaitingCount)}
          icon={<Hourglass className="h-[18px] w-[18px]" />}
          iconTone="amber"
          to="/app/sales-workbench"
          lines={<span className="num">{fmtCompact(d.sales.awaitingValue)} awaiting value</span>}
        />
        <KpiCard
          title="Dispatch-Ready"
          value={String(d.sales.dispatchReadyCount)}
          icon={<PackageCheck className="h-[18px] w-[18px]" />}
          to="/app/dispatches"
          lines={<span>Confirmed &amp; warehouse-approved</span>}
        />
      </section>
      <SectionCard
        title="Orders awaiting acceptance"
        actionLabel="Sales Workbench"
        actionTo="/app/sales-workbench"
      >
        {d.sales.awaiting.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 className="h-5 w-5" />}
            title="No orders awaiting acceptance"
            description="New customer orders will appear here."
          />
        ) : (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="table-premium w-full min-w-[640px]">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th className="text-right">Value</th>
                  <th>Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {d.sales.awaiting.slice(0, 8).map((o: any) => (
                  <tr key={o.id}>
                    <td className="font-mono text-xs">{pick(o, "soNumber", "so_number") ?? "—"}</td>
                    <td>{pick(o, "customerName", "customer_name") ?? "—"}</td>
                    <td className="num text-right font-medium">
                      {fmtMoney(num(pick(o, "grandTotal", "grand_total", "amount")))}
                    </td>
                    <td className="text-muted-foreground">
                      {fmtDate(pick(o, "orderDate", "order_date"))}
                    </td>
                    <td>
                      <StatusPill status={o.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function CashTab() {
  const d = useCommandData();
  const s: any = d.cashSummary ?? {};
  const v = (a: string, b: string) => num(pick(s, a, b));
  if (d.loading) return <TabSkeleton />;
  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="Available Cash"
          value={fmtFull(d.availableCash)}
          icon={<Wallet className="h-[18px] w-[18px]" />}
          iconTone="green"
          to="/app/cash-flow"
          lines={<span>Live bank &amp; cash accounts</span>}
        />
        <KpiCard
          title="Inflows (7d)"
          value={fmtCompact(v("expectedInflowsNext7Days", "expected_inflows_next_7_days"))}
          icon={<TrendingUp className="h-[18px] w-[18px]" />}
          to="/app/cash-flow"
          lines={<span>Direct + marketplace</span>}
        />
        <KpiCard
          title="Outflows (7d)"
          value={fmtCompact(v("expectedOutflowsNext7Days", "expected_outflows_next_7_days"))}
          icon={<CreditCard className="h-[18px] w-[18px]" />}
          to="/app/cash-flow"
          lines={<span>Bills + POs + recurring</span>}
        />
        <KpiCard
          title="Projected (30d)"
          value={fmtCompact(
            v("projectedClosingCashNext30Days", "projected_closing_cash_next_30_days") ||
              d.availableCash,
          )}
          icon={<Wallet className="h-[18px] w-[18px]" />}
          to="/app/cash-flow"
          lines={<span>Monthly closing runway</span>}
        />
      </section>
      <SectionCard
        title="Cash Position: Actual vs Projected"
        actionLabel="Cash Command"
        actionTo="/app/cash-flow"
      >
        <CashPositionCard />
      </SectionCard>
    </div>
  );
}

function ReceivablesTab() {
  const d = useCommandData();
  const debtorsQ = useQuery({
    queryKey: ["cmd-debtors-tab"],
    queryFn: () => api.debtors.list(),
    staleTime: 60_000,
  });
  if (d.loading) return <TabSkeleton />;
  const byDebtor = new Map<string, { total: number; overdue: number; count: number }>();
  for (const i of d.receivables.open as any[]) {
    const k = String(i.debtor_id ?? "?");
    const cur = byDebtor.get(k) ?? { total: 0, overdue: 0, count: 0 };
    cur.total += num(i.amount);
    cur.count += 1;
    if (i.due_date && daysBetween(i.due_date) > 0) cur.overdue += num(i.amount);
    byDebtor.set(k, cur);
  }
  const rows = [...byDebtor.entries()]
    .map(([id, v]) => ({ id, name: d.debtorName(id), ...v }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);
  void debtorsQ.data;
  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="Total Receivables"
          value={fmtFull(d.receivables.total)}
          icon={<Receipt className="h-[18px] w-[18px]" />}
          to="/app/finance-invoices"
          lines={<span>{d.receivables.count} open invoices</span>}
        />
        <KpiCard
          title="Due Soon"
          value={fmtFull(d.receivables.dueSoonTotal)}
          icon={<Hourglass className="h-[18px] w-[18px]" />}
          iconTone="amber"
          to="/app/finance-invoices"
          lines={<span>{d.receivables.dueSoonCount} invoices · next 30 days</span>}
        />
        <KpiCard
          title="Overdue"
          value={fmtFull(d.receivables.overdueTotal)}
          icon={<Receipt className="h-[18px] w-[18px]" />}
          iconTone={d.receivables.overdueCount > 0 ? "red" : "green"}
          to="/app/finance-invoices"
          lines={<span>{d.receivables.overdueCount} invoices overdue</span>}
        />
        <KpiCard
          title="Expected Receipts (7d)"
          value={fmtCompact(
            num(pick(d.cashSummary, "expectedInflowsNext7Days", "expected_inflows_next_7_days")),
          )}
          icon={<TrendingUp className="h-[18px] w-[18px]" />}
          iconTone="green"
          to="/app/cash-flow"
          lines={<span>Per treasury forecast</span>}
        />
      </section>
      <Card title="Customer-level receivables">
        {rows.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 className="h-5 w-5" />}
            title="No open receivables"
            description="All customer invoices are settled."
          />
        ) : (
          <div className="-mx-5 overflow-x-auto table-wrap">
            <table className="table-premium w-full min-w-[560px]">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th className="text-right">Open</th>
                  <th className="text-right">Overdue</th>
                  <th className="text-right">Invoices</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="text-foreground">{r.name}</td>
                    <td className="num text-right font-medium">{fmtMoney(r.total)}</td>
                    <td
                      className={`num text-right ${r.overdue > 0 ? "text-sem-critical font-semibold" : "text-muted-foreground"}`}
                    >
                      {r.overdue > 0 ? fmtMoney(r.overdue) : "—"}
                    </td>
                    <td className="num text-right text-muted-foreground">{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function PayablesTab() {
  const d = useCommandData();
  if (d.loading) return <TabSkeleton />;
  const bySupplier = new Map<string, { total: number; overdue: number; count: number }>();
  for (const p of d.payables.open as any[]) {
    const k = String(p.supplier_id ?? p.vendor_id ?? "?");
    const cur = bySupplier.get(k) ?? { total: 0, overdue: 0, count: 0 };
    cur.total += num(p.amount);
    cur.count += 1;
    if (p.due_date && daysBetween(p.due_date) > 0) cur.overdue += num(p.amount);
    bySupplier.set(k, cur);
  }
  const rows = [...bySupplier.entries()]
    .map(([id, v]) => ({ id, name: d.supplierName(id), ...v }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);
  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="Total Payables"
          value={fmtFull(d.payables.total)}
          icon={<CreditCard className="h-[18px] w-[18px]" />}
          to="/app/finance-purchases"
          lines={<span>{d.payables.count} open invoices</span>}
        />
        <KpiCard
          title="Due Soon"
          value={fmtFull(d.payables.dueSoonTotal)}
          icon={<Hourglass className="h-[18px] w-[18px]" />}
          iconTone="amber"
          to="/app/finance-purchases"
          lines={<span>{d.payables.dueSoonCount} invoices · next 30 days</span>}
        />
        <KpiCard
          title="Overdue"
          value={fmtFull(d.payables.overdueTotal)}
          icon={<CreditCard className="h-[18px] w-[18px]" />}
          iconTone={d.payables.overdueCount > 0 ? "red" : "green"}
          to="/app/finance-purchases"
          lines={<span>{d.payables.overdueCount} invoices overdue</span>}
        />
        <KpiCard
          title="PO Commitments"
          value={fmtCompact(num(pick(d.cashSummary, "poCommitments", "po_commitments")))}
          icon={<ClipboardList className="h-[18px] w-[18px]" />}
          to="/app/purchase-orders"
          lines={<span>Upcoming supplier payments</span>}
        />
      </section>
      <Card title="Supplier-level payables">
        {rows.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 className="h-5 w-5" />}
            title="No open payables"
            description="All supplier invoices are settled."
          />
        ) : (
          <div className="-mx-5 overflow-x-auto table-wrap">
            <table className="table-premium w-full min-w-[560px]">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th className="text-right">Open</th>
                  <th className="text-right">Overdue</th>
                  <th className="text-right">Invoices</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="text-foreground">{r.name}</td>
                    <td className="num text-right font-medium">{fmtMoney(r.total)}</td>
                    <td
                      className={`num text-right ${r.overdue > 0 ? "text-sem-critical font-semibold" : "text-muted-foreground"}`}
                    >
                      {r.overdue > 0 ? fmtMoney(r.overdue) : "—"}
                    </td>
                    <td className="num text-right text-muted-foreground">{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function InventoryTab() {
  const d = useCommandData();
  if (d.loading || d.inventoryLoading) return <TabSkeleton />;
  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="SKUs Tracked"
          value={String(d.inventory.total)}
          icon={<PackageCheck className="h-[18px] w-[18px]" />}
          to="/app/products"
          lines={<span>{d.inventory.healthy} healthy</span>}
        />
        <KpiCard
          title="Out of Stock"
          value={String(d.inventory.out)}
          icon={<PackageCheck className="h-[18px] w-[18px]" />}
          iconTone={d.inventory.out > 0 ? "red" : "green"}
          to="/app/forecast"
          lines={<span>Critical — needs immediate action</span>}
        />
        <KpiCard
          title="Low / Reorder"
          value={String(d.inventory.low)}
          icon={<Hourglass className="h-[18px] w-[18px]" />}
          iconTone="amber"
          to="/app/forecast"
          lines={<span>Reorder attention</span>}
        />
        <KpiCard
          title="Pending GRNs"
          value={String(d.procurement.delayedGrn)}
          icon={<ClipboardList className="h-[18px] w-[18px]" />}
          to="/app/grn"
          lines={<span>Inbound delayed or pending</span>}
        />
      </section>
      <SectionCard
        title="Inventory health"
        subtitle="Sellable-SKU level · reorder levels from catalogue · forecast hints where available."
        actionLabel="Forecast"
        actionTo="/app/forecast"
      >
        {d.errors.inventory ? (
          <CardError
            title="Inventory unavailable"
            message="Unable to load inventory data right now."
          />
        ) : (
          <InventoryAlerts alerts={d.inventory.all} limit={12} />
        )}
      </SectionCard>
    </div>
  );
}

function AlertsTab() {
  const d = useCommandData();
  if (d.loading) return <TabSkeleton />;
  return (
    <div className="space-y-6">
      <SectionCard
        title="Operational Alerts"
        subtitle="Ordered by importance: overdue first, then approaching, then informational."
        actionLabel="Alert centre"
        actionTo="/app/alerts"
      >
        <OperationalAlertsList alerts={d.operationalAlerts} loading={d.alertsLoading} />
      </SectionCard>
      <SectionCard
        title="Cross-functional priorities"
        subtitle="Every open item with an owner and next step."
        actionLabel="Action Centre"
        actionTo="/app/tasks"
      >
        <PriorityTable rows={d.priorities} loading={d.prioritiesLoading} />
      </SectionCard>
    </div>
  );
}

function TabSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading view">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiSkeleton />
        <KpiSkeleton />
        <KpiSkeleton />
        <KpiSkeleton />
      </div>
      <div className="h-64 animate-pulse rounded-2xl border border-border bg-card" />
    </div>
  );
}
