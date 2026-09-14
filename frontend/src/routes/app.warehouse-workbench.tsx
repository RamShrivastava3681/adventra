import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  Warehouse,
  PackageCheck,
  Truck,
  ClipboardList,
  FileText,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  ExternalLink,
  TrendingUp,
} from "lucide-react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import {
  PageHeader,
  Card,
  EmptyState,
  StatusPill,
  fmtMoney,
  fmtDate,
} from "@/components/ledger-ui";
import { TableSkeleton, StatSkeleton } from "@/components/skeletons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/app/warehouse-workbench")({
  component: WarehouseWorkbenchPage,
});

/* ────────────────────────────────────────────────────────────────────────────
 * Warehouse Workbench — an operational view over the existing unified
 * workflow engine (PDF-3) and the existing warehouse documents.
 * Every table row is a real open WorkflowTask created by the backend at each
 * handoff; Current Status / Next Step / Owner come straight from the task
 * record (docStatus / requiredAction / ownerRole). KPI and panel counts are
 * computed from live document data. No new statuses, stages, processes or
 * actions are invented here — the underlying document pages remain the place
 * where work is performed. The Warehouse, Forecast, GRN, Dispatch, Stock
 * Allocation and Sample Distribution pages are hosted here as same-page
 * tabs, so the sidebar collapses to one link.
 *
 * Data sources (all existing, read-only):
 *  - /workflow-tasks?status=open        → work-items table
 *  - /goods-sales-orders                → KPI 1 (SOs awaiting warehouse action)
 *  - /goods-receipts                    → KPI 2 (GRNs pending)
 *  - /goods-dispatches                  → KPI 3 (dispatches in pipeline)
 * ──────────────────────────────────────────────────────────────────────── */

type Task = {
  id: string;
  workflow_type: string;
  stage: string;
  doc_type: string;
  doc_id: string;
  doc_number: string | null;
  counterparty: string | null;
  doc_status: string | null;
  owner_role: string;
  assigned_user: string | null;
  required_action: string;
  next_action: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  due_date: string | null;
  amount: number | null;
  latest_update: string | null;
  status: "open" | "done" | "cancelled";
  created_at: string;
  updated_at: string;
  overdue?: boolean;
};

/** Warehouse family only — excludes sales/procurement document flows. */
const WAREHOUSE_WF_TYPES = new Set(["grn", "dispatch"]);

const WF_TYPE_LABEL: Record<string, string> = {
  grn: "Goods Receipt Note",
  dispatch: "Dispatch Order",
};

/** owner_role → the team currently responsible for the next step. */
const OWNER_LABEL: Record<string, string> = {
  warehouse: "Warehouse",
  operations: "Warehouse",
  checker: "Checker",
  treasury: "Treasury",
  finance: "Treasury",
  sales: "Sales",
  procurement: "Procurement",
};

/** Where does this document live? Same mapping the unified queue uses. */
function docAppPath(t: Task): string {
  switch (t.doc_type) {
    case "grn":
      return "/app/grn";
    case "dispatch":
      return "/app/dispatches";
    default:
      return "/app/tasks";
  }
}

/** Compact primary-action label for the engine stage (UI label only —
 *  the button deep-links to the existing document page in every case). */
function actionLabel(t: Task): string {
  const stage = (t.stage ?? "").toLowerCase();
  if (stage.includes("checker") || stage.includes("approv")) return "Review";
  if (stage.includes("grn") || stage.includes("await_goods") || stage.includes("receive"))
    return "Record GRN";
  if (stage.includes("pick") || stage.includes("pack")) return "Pick & Pack";
  if (stage.includes("ewb") || stage.includes("finance")) return "Submit";
  if (stage.includes("dispatch") || stage.includes("ship") || stage.includes("deliver"))
    return "Dispatch";
  if (t.overdue) return "Follow Up";
  return "Open";
}

function todayYMD(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysOverdue(due: string | null | undefined): number {
  if (!due) return 0;
  const dueDay = String(due).slice(0, 10);
  if (dueDay >= todayYMD()) return 0;
  const diff = Math.floor((new Date(todayYMD()).getTime() - new Date(dueDay).getTime()) / 86400000);
  return Math.max(0, diff);
}

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

type FilterKey = "all" | "grns" | "dispatches";

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "grns", label: "GRNs" },
  { key: "dispatches", label: "Dispatches" },
];

const PAGE_SIZE = 15;

/* ── Same-page sections — tab clicks switch content below, never navigate ── */
type WarehouseSection =
  | "workbench"
  | "warehouse"
  | "forecast"
  | "grn"
  | "dispatch"
  | "stock"
  | "samples"
  | "tasks";

const WarehousePanel = lazy(() =>
  import("@/routes/app.warehouse").then((m) => ({ default: m.WarehousePage })),
);
const ForecastPanel = lazy(() =>
  import("@/routes/app.forecast").then((m) => ({ default: m.ForecastPage })),
);
const GrnPanel = lazy(() => import("@/routes/app.grn").then((m) => ({ default: m.GrnPage })));
const DispatchPanel = lazy(() =>
  import("@/routes/app.dispatches").then((m) => ({ default: m.DispatchesPage })),
);
const StockPanel = lazy(() =>
  import("@/routes/app.stock-allocation").then((m) => ({ default: m.StockAllocationPage })),
);
const SamplesPanel = lazy(() =>
  import("@/routes/app.sample-distribution").then((m) => ({
    default: m.SampleDistributionPage,
  })),
);
const WarehouseTasksPanel = lazy(() =>
  import("@/routes/app.tasks").then((m) => ({ default: m.TasksPage })),
);

function SectionFallback() {
  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-6 md:px-8 md:py-8">
      <TableSkeleton rows={6} cols={8} />
    </div>
  );
}

/* Sales orders that still need warehouse attention (not terminal). */
const SO_NEEDS_WAREHOUSE = new Set(["warehouse_pending", "checker_pending", "confirmed"]);

/* GRN statuses awaiting receipt (not terminal). */
const PENDING_GRN_STATUSES = new Set(["draft", "pending"]);

/* Dispatch doc statuses still in the logistics pipeline (not terminal). */
const ACTIVE_DISPATCH_STATUSES = new Set([
  "draft",
  "pending",
  "awaiting_pick",
  "picking",
  "packed",
  "submitted",
  "approved",
  "dispatched",
  "in_transit",
  "partially_dispatched",
]);

function WarehouseWorkbenchPage() {
  const { isAdmin, isOperations } = useAuth();
  void isAdmin;
  void isOperations;
  const navigate = useNavigate();
  const [section, setSection] = useState<WarehouseSection>("workbench");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  /* Row-level open: stay in-page when the doc has its own tab, else deep-link. */
  function openDoc(t: { doc_type: string }) {
    switch (t.doc_type) {
      case "grn":
        setSection("grn");
        return;
      case "dispatch":
        setSection("dispatch");
        return;
      default:
        navigate({ to: docAppPath(t as any) as any });
    }
  }

  /* ── Open workflow tasks (engine data — same endpoint as My Queue) ── */
  const tasksQ = useQuery({
    queryKey: ["warehouse-workbench-tasks"],
    queryFn: () => api.workflowTasks.list({ status: "open" }),
    refetchInterval: 60_000,
  });

  /* ── Sales orders (KPI 1: awaiting warehouse action) ── */
  const sosQ = useQuery({
    queryKey: ["warehouse-workbench-sos"],
    queryFn: () => api.goodsSalesOrders.list(),
  });

  /* ── GRNs (KPI 2) ── */
  const grnsQ = useQuery({
    queryKey: ["warehouse-workbench-grns"],
    queryFn: () => api.goodsReceipts.list(),
  });

  /* ── Dispatches (KPI 3) ── */
  const dispatchesQ = useQuery({
    queryKey: ["warehouse-workbench-dispatches"],
    queryFn: () => api.goodsDispatches.list(),
  });

  const tasks: Task[] = ((tasksQ.data ?? []) as Task[]).filter((t) =>
    WAREHOUSE_WF_TYPES.has(t.workflow_type),
  );

  const sos: any[] = useMemo(() => sosQ.data ?? [], [sosQ.data]);
  const grns: any[] = useMemo(() => grnsQ.data ?? [], [grnsQ.data]);
  const dispatches: any[] = useMemo(() => dispatchesQ.data ?? [], [dispatchesQ.data]);

  /* ── KPIs — computed from live document data ── */
  const kpis = useMemo(() => {
    const sosAwaiting = sos.filter((s) => {
      const st = String(s.status ?? s.warehouse_status ?? "").toLowerCase();
      const wst = String(s.warehouse_status ?? "").toLowerCase();
      return (
        SO_NEEDS_WAREHOUSE.has(st) ||
        ["pending", "on_hold"].includes(st) ||
        ["pending", "on_hold"].includes(wst)
      );
    }).length;
    const grnsPending = grns.filter((g) =>
      PENDING_GRN_STATUSES.has(String(g.status ?? "").toLowerCase()),
    ).length;
    const dispatchesActive = dispatches.filter((d) =>
      ACTIVE_DISPATCH_STATUSES.has(String(d.status ?? "").toLowerCase()),
    ).length;
    return { sosAwaiting, grnsPending, dispatchesActive, openTasks: tasks.length };
  }, [sos, grns, dispatches, tasks]);

  /* ── Work-items: filter tabs + compact search (all client-side) ── */
  const filtered = useMemo(() => {
    let list = tasks;
    if (filter === "grns") list = list.filter((t) => t.workflow_type === "grn");
    else if (filter === "dispatches") list = list.filter((t) => t.workflow_type === "dispatch");
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((t) =>
        [t.doc_number, t.counterparty, t.required_action, t.doc_status]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    // Priority order: overdue → priority → due date → newest
    return [...list].sort(
      (a, b) =>
        Number(!!b.overdue) - Number(!!a.overdue) ||
        (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2) ||
        (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") ||
        String(b.created_at).localeCompare(String(a.created_at)),
    );
  }, [tasks, filter, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => setPage(1), [filter, query]);
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  /* ── Sign-off queue — sales orders waiting on the warehouse (live only) ── */
  const signoffQueue = useMemo(() => {
    return sos
      .filter((s) => {
        const st = String(s.status ?? s.warehouse_status ?? "").toLowerCase();
        const wst = String(s.warehouse_status ?? "").toLowerCase();
        return (
          SO_NEEDS_WAREHOUSE.has(st) ||
          ["pending", "on_hold"].includes(st) ||
          ["pending", "on_hold"].includes(wst)
        );
      })
      .map((s: any) => ({
        id: s.id,
        soNumber: s.so_number ?? s.soNumber ?? "—",
        customer: s.customer_name ?? s.customerName ?? s.debtor_name ?? "—",
        expected: s.expected_dispatch_date ?? s.expectedDispatchDate ?? null,
        overdueDays: daysOverdue(s.expected_dispatch_date ?? s.expectedDispatchDate ?? null),
      }))
      .sort((a, b) => b.overdueDays - a.overdueDays)
      .slice(0, 5);
  }, [sos]);

  const loading = tasksQ.isLoading || sosQ.isLoading || grnsQ.isLoading || dispatchesQ.isLoading;

  return (
    <div>
      <PageHeader
        eyebrow="Warehouse"
        title="Warehouse Control"
        icon={<Warehouse className="h-5 w-5" />}
        description="Monitor inbound receipts, outbound dispatches, stock levels and forecasts."
      />

      {/* ── Warehouse navigation — same-page sections, no route change ── */}
      <div className="border-b border-border bg-background">
        <div className="mx-auto w-full max-w-[1440px] overflow-x-auto px-4 md:px-8">
          <nav className="flex min-w-max gap-1" aria-label="Warehouse sections">
            <NavTab
              label="Workbench"
              active={section === "workbench"}
              onClick={() => setSection("workbench")}
            />
            <NavTab
              label="Warehouse"
              active={section === "warehouse"}
              onClick={() => setSection("warehouse")}
            />
            <NavTab
              label="Forecast"
              active={section === "forecast"}
              onClick={() => setSection("forecast")}
            />
            <NavTab label="GRN" active={section === "grn"} onClick={() => setSection("grn")} />
            <NavTab
              label="Dispatch"
              active={section === "dispatch"}
              onClick={() => setSection("dispatch")}
            />
            <NavTab
              label="Stock Allocation"
              active={section === "stock"}
              onClick={() => setSection("stock")}
            />
            <NavTab
              label="Samples"
              active={section === "samples"}
              onClick={() => setSection("samples")}
            />
            <NavTab
              label="Activity History"
              active={section === "tasks"}
              onClick={() => setSection("tasks")}
            />
          </nav>
        </div>
      </div>

      {section === "workbench" ? (
        <div className="mx-auto w-full max-w-[1440px] space-y-6 px-4 py-6 md:px-8 md:py-8">
        {/* ── KPI cards ── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {loading ? (
            <>
              <StatSkeleton />
              <StatSkeleton />
              <StatSkeleton />
              <StatSkeleton />
            </>
          ) : (
            <>
              <KpiCard
                label="SOs Awaiting Warehouse"
                value={kpis.sosAwaiting}
                sub="Needs sign-off or hold review"
                icon={<ClipboardList className="h-[18px] w-[18px]" />}
                tone="amber"
                onClick={() => setSection("warehouse")}
              />
              <KpiCard
                label="GRNs Pending"
                value={kpis.grnsPending}
                sub="Awaiting goods receipt"
                icon={<PackageCheck className="h-[18px] w-[18px]" />}
                tone="amber"
                onClick={() => setFilter("grns")}
              />
              <KpiCard
                label="Dispatches In Pipeline"
                value={kpis.dispatchesActive}
                sub="Picking through in-transit"
                icon={<Truck className="h-[18px] w-[18px]" />}
                tone="blue"
                onClick={() => setFilter("dispatches")}
              />
              <KpiCard
                label="Open Work Items"
                value={kpis.openTasks}
                sub="GRN + dispatch tasks"
                icon={<FileText className="h-[18px] w-[18px]" />}
                tone="neutral"
                onClick={() => setFilter("all")}
              />
            </>
          )}
        </div>

        {/* ── Workbench filter tabs + compact search ── */}
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                filter === f.key
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search document, customer…"
              aria-label="Search warehouse work items"
              className="h-8 w-52 rounded-md border border-border bg-card px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </div>
        </div>

        {/* ── Main content: work items + sign-off queue ── */}
        <div className="grid gap-6 lg:grid-cols-4">
          {/* LEFT — Warehouse work items */}
          <Card
            className="lg:col-span-3"
            title="Warehouse work items"
            action={
              <button
                onClick={() => setSection("tasks")}
                className="text-xs font-medium text-primary hover:underline"
              >
                View all
              </button>
            }
          >
            {loading ? (
              <TableSkeleton rows={6} cols={7} />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={<Warehouse className="h-6 w-6" />}
                title="You're all caught up"
                description="No warehouse work currently requires your attention."
              />
            ) : (
              <>
                <p className="mb-3 text-xs text-muted-foreground">
                  GRNs and dispatches that need action before the next step.
                </p>
                <div className="-mx-5 overflow-x-auto table-wrap">
                  <table className="table-premium w-full text-sm">
                    <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr className="border-b border-border bg-muted/40">
                        <th className="px-4 py-2 text-left font-medium">Document</th>
                        <th className="px-4 py-2 text-left font-medium">Counterparty</th>
                        <th className="px-4 py-2 text-right font-medium">Value</th>
                        <th className="px-4 py-2 text-left font-medium">Current Status</th>
                        <th className="px-4 py-2 text-left font-medium">Next Step</th>
                        <th className="px-4 py-2 text-left font-medium">Owner</th>
                        <th className="px-4 py-2 text-right font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageItems.map((t) => (
                        <tr
                          key={t.id}
                          className="border-b border-border/60 transition-colors hover:bg-muted/30"
                        >
                          {/* Document */}
                          <td className="px-4 py-2.5">
                            <button
                              onClick={() => openDoc(t)}
                              className="text-left font-mono text-[13px] font-semibold tracking-tight text-foreground hover:text-primary"
                              title={`Open ${WF_TYPE_LABEL[t.workflow_type] ?? t.workflow_type}`}
                            >
                              {t.doc_number ?? "—"}
                            </button>
                            <div className="mt-0.5 flex items-center gap-2">
                              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                {WF_TYPE_LABEL[t.workflow_type] ?? t.workflow_type}
                              </span>
                              {t.overdue && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-destructive">
                                  <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
                                  Overdue
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Counterparty */}
                          <td className="px-4 py-2.5 text-[13px]">{t.counterparty ?? "—"}</td>

                          {/* Value */}
                          <td className="px-4 py-2.5 text-right">
                            <span className="num text-[13px] font-medium">
                              {t.amount != null ? fmtMoney(t.amount) : "—"}
                            </span>
                          </td>

                          {/* Current Status */}
                          <td className="px-4 py-2.5">
                            {t.doc_status ? (
                              <StatusPill status={t.doc_status} />
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>

                          {/* Next Step — the engine's own required action */}
                          <td
                            className="max-w-[220px] truncate px-4 py-2.5 text-[13px] text-muted-foreground"
                            title={t.required_action}
                          >
                            {t.required_action}
                          </td>

                          {/* Owner */}
                          <td className="px-4 py-2.5 text-[13px] text-muted-foreground">
                            {OWNER_LABEL[t.owner_role] ?? t.owner_role}
                          </td>

                          {/* Action */}
                          <td className="whitespace-nowrap px-4 py-2.5 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                onClick={() => openDoc(t)}
                                className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-sm transition-all hover:-translate-y-px hover:shadow-md"
                              >
                                {actionLabel(t)}
                              </button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                                    aria-label="More actions"
                                  >
                                    <MoreHorizontal className="h-4 w-4" />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-48">
                                  <DropdownMenuItem onClick={() => openDoc(t)}>
                                    <ExternalLink className="h-3.5 w-3.5" /> Open document
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => setSection("tasks")}>
                                    View in My Queue
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {totalPages > 1 && (
                  <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      Showing {(safePage - 1) * PAGE_SIZE + 1}–
                      {Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={safePage <= 1}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40"
                        aria-label="Previous page"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                      <span className="min-w-16 text-center">
                        {safePage} / {totalPages}
                      </span>
                      <button
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        disabled={safePage >= totalPages}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40"
                        aria-label="Next page"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </Card>

          {/* RIGHT — Sign-off queue */}
          <div className="space-y-6">
            <Card
              title="Needs warehouse sign-off"
              action={
                <button
                  onClick={() => setSection("warehouse")}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Review
                </button>
              }
            >
              {sosQ.isLoading ? (
                <TableSkeleton rows={4} cols={3} />
              ) : signoffQueue.length === 0 ? (
                <EmptyState
                  icon={<TrendingUp className="h-6 w-6" />}
                  title="No pending sign-offs"
                  description="No sales orders are currently waiting on the warehouse."
                />
              ) : (
                <div className="divide-y divide-border/70">
                  {signoffQueue.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium text-foreground">
                          {s.customer}
                        </div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {s.soNumber}
                          {s.expected ? ` · ${fmtDate(s.expected)}` : ""}
                        </div>
                      </div>
                      {s.overdueDays > 0 && (
                        <span className="shrink-0 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
                          {s.overdueDays}d overdue
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
        </div>
      ) : (
        <Suspense fallback={<SectionFallback />}>
          {section === "warehouse" && <WarehousePanel />}
          {section === "forecast" && <ForecastPanel />}
          {section === "grn" && <GrnPanel />}
          {section === "dispatch" && <DispatchPanel />}
          {section === "stock" && <StockPanel />}
          {section === "samples" && <SamplesPanel />}
          {section === "tasks" && <WarehouseTasksPanel />}
        </Suspense>
      )}
    </div>
  );
}

/* ── Nav tab — same-page button; active = blue text + blue bottom border ── */
function NavTab({
  label,
  active = false,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`whitespace-nowrap border-b-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors ${
        active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

/* ── KPI card — white, thin border, icon tile, big number ── */
function KpiCard({
  label,
  value,
  sub,
  icon,
  tone = "neutral",
  onClick,
}: {
  label: string;
  value: number;
  sub: string;
  icon: React.ReactNode;
  tone?: "neutral" | "amber" | "blue" | "green";
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border bg-card p-5 text-left shadow-card transition-all duration-200 hover:shadow-card-hover ${
        onClick ? "cursor-pointer" : "cursor-default"
      } ${tone === "amber" ? "border-sem-attention/30" : tone === "green" ? "border-sem-success/25" : "border-border"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${toneCls(tone)}`}
        >
          {icon}
        </div>
      </div>
      <div className="num mt-2 text-3xl font-semibold tracking-tight text-foreground">{value}</div>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </button>
  );
}

function toneCls(tone: "neutral" | "amber" | "blue" | "green"): string {
  switch (tone) {
    case "amber":
      return "border-sem-attention/25 bg-sem-attention/10 text-sem-attention";
    case "blue":
      return "border-primary/20 bg-primary-soft text-primary";
    case "green":
      return "border-sem-success/25 bg-sem-success/10 text-sem-success";
    default:
      return "border-primary/20 bg-primary-soft text-primary";
  }
}
