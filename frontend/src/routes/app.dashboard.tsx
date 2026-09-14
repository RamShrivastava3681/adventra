import { createFileRoute, Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import {
  ArrowRight,
  Wallet,
  Receipt,
  CreditCard,
  ClipboardList,
} from "lucide-react";
import { useCommandData, num, pick } from "@/components/command-overview/useCommandData";
import {
  KpiCard,
  KpiSkeleton,
  SectionCard,
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
      </div>

      <div className="mx-auto max-w-[1440px] space-y-6 px-6 py-6 md:px-10 md:py-8">
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
