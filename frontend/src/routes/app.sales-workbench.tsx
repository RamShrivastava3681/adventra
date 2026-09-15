import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  ShoppingBag,
  FileText,
  Wallet,
  Truck,
  ClipboardList,
  Info,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  ExternalLink,
} from "lucide-react";
import api from "@/lib/api-client";
import { PageHeader, Card, EmptyState, StatusPill, fmtMoney, fmtDate } from "@/components/ledger-ui";
import { TableSkeleton, StatSkeleton } from "@/components/skeletons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/app/sales-workbench")({
  component: SalesWorkbenchPage,
});

/* ────────────────────────────────────────────────────────────────────────────
 * Sales Workbench — an operational view over the existing unified workflow
 * engine (PDF-3). Every row is a real open WorkflowTask created by the
 * backend at each handoff; Current Status / Next Step / Owner come straight
 * from the task record (docStatus / requiredAction / ownerRole). No new
 * statuses, stages or actions are invented here — the underlying document
 * pages remain the place where work is performed.
 *
 * Data sources (all existing, read-only):
 *  - /workflow-tasks?status=open   → work table + KPIs 1/2/4
 *  - /invoices                     → KPI 3 (invoices pending checker approval)
 *  - /purchase-orders (proformas)  → overdue advance receipts panel
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

/** Sales family only — excludes purchase-side / GRN workflows. */
const SALES_WF_TYPES = new Set(["sales_order", "sales_invoice", "proforma", "dispatch", "payment"]);

const WF_TYPE_LABEL: Record<string, string> = {
  sales_order: "Sales Order",
  sales_invoice: "Sales Invoice",
  proforma: "Proforma Invoice",
  dispatch: "Dispatch Order",
  payment: "Advance Payment",
};

/** owner_role → the team currently responsible for the next step. */
const OWNER_LABEL: Record<string, string> = {
  sales: "Sales",
  client: "Customer",
  operations: "Warehouse",
  checker: "Checker",
  treasury: "Treasury",
  finance: "Finance",
};

/** Where does this document live? Same mapping the unified queue uses. */
function docAppPath(t: Task): string {
  switch (t.doc_type) {
    case "sales_order":
      return "/app/sales-orders";
    case "sales_invoice":
      return "/app/invoices";
    case "proforma":
      return "/app/proformas";
    case "dispatch":
      return "/app/dispatches";
    case "payment":
      return "/app/queue";
    default:
      return "/app/dashboard";
  }
}

function todayYMD(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysOverdue(due: string | null | undefined): number {
  if (!due) return 0;
  const dueDay = String(due).slice(0, 10);
  if (dueDay >= todayYMD()) return 0;
  const diff = Math.floor(
    (new Date(todayYMD()).getTime() - new Date(dueDay).getTime()) / 86400000,
  );
  return Math.max(0, diff);
}

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

type FilterKey = "all" | "sales_orders" | "proforma" | "invoices" | "dispatch";

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "sales_orders", label: "Sales Orders" },
  { key: "proforma", label: "Proforma" },
  { key: "invoices", label: "Invoices" },
  { key: "dispatch", label: "Dispatch Ready" },
];

const PAGE_SIZE = 15;

/* ── Same-page sections — tab clicks switch content below, never navigate ── */
type SalesSection =
  | "workbench"
  | "customers"
  | "sales-orders"
  | "proformas"
  | "invoices"
  | "notes"
  | "tasks";

const DebtorsPanel = lazy(() =>
  import("@/routes/app.debtors").then((m) => ({ default: m.DebtorsPage })),
);
const SalesOrdersPanel = lazy(() =>
  import("@/routes/app.sales-orders").then((m) => ({ default: m.SalesOrdersPage })),
);
const ProformasPanel = lazy(() =>
  import("@/routes/app.proformas").then((m) => ({ default: m.ProformasPage })),
);
const InvoicesPanel = lazy(() =>
  import("@/routes/app.invoices").then((m) => ({
    default: () => <m.InvoicesPage viewOnly />,
  })),
);
const NotesPanel = lazy(() =>
  import("@/routes/app.notes").then((m) => ({ default: m.NotesPage })),
);
const TasksPanel = lazy(() =>
  import("@/routes/app.tasks").then((m) => ({ default: m.TasksPage })),
);

function SectionFallback() {
  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-6 md:px-8 md:py-8">
      <TableSkeleton rows={6} cols={8} />
    </div>
  );
}

function SalesWorkbenchPage() {
  const navigate = useNavigate();
  const [section, setSection] = useState<SalesSection>("workbench");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [page, setPage] = useState(1);

  /* Row-level open: stay in-page when the doc has its own tab, else deep-link. */
  function openDoc(t: Task) {
    switch (t.doc_type) {
      case "sales_order":
        setSection("sales-orders");
        return;
      case "proforma":
        setSection("proformas");
        return;
      case "sales_invoice":
        setSection("invoices");
        return;
      default:
        navigate({ to: docAppPath(t) as any });
    }
  }

  /* ── Open workflow tasks (engine data — same endpoint as My Queue) ── */
  const tasksQ = useQuery({
    queryKey: ["sales-workbench-tasks"],
    queryFn: () => api.workflowTasks.list({ status: "open" }),
    refetchInterval: 60_000,
  });

  /* ── Sales invoices (KPI 3: pending checker approval) ── */
  const invoicesQ = useQuery({
    queryKey: ["sales-workbench-invoices"],
    queryFn: () => api.invoices.list(),
  });

  /* ── Proformas — overdue advance receipts (sales side) ── */
  const proformasQ = useQuery({
    queryKey: ["sales-workbench-proformas"],
    queryFn: () => api.purchaseOrders.list(),
  });

  const tasks: Task[] = ((tasksQ.data ?? []) as Task[]).filter((t) =>
    SALES_WF_TYPES.has(t.workflow_type),
  );

  /* ── KPIs — computed from live engine/document data ── */
  const kpis = useMemo(() => {
    const byStage = (stages: string[]) => tasks.filter((t) => stages.includes(t.stage));
    const invoicesAwaiting = (invoicesQ.data ?? []).filter((i: any) => i.status === "pending");
    return {
      customerAcceptance: byStage(["client_acceptance"]).length,
      advancePending: byStage(["await_payment", "payment_confirmation"]).length,
      invoicesAwaiting: invoicesAwaiting.length,
      readyForDispatch: byStage(["prepare_dispatch"]).length,
    };
  }, [tasks, invoicesQ.data]);

  /* ── Filter tabs over the task list ── */
  const filtered = useMemo(() => {
    let list = tasks;
    if (filter === "sales_orders") list = list.filter((t) => t.workflow_type === "sales_order");
    else if (filter === "proforma")
      list = list.filter((t) => t.workflow_type === "proforma" || t.workflow_type === "payment");
    else if (filter === "invoices") list = list.filter((t) => t.workflow_type === "sales_invoice");
    else if (filter === "dispatch")
      list = list.filter(
        (t) =>
          t.workflow_type === "dispatch" ||
          ["prepare_dispatch", "generate_ewb", "confirm_dispatch"].includes(t.stage),
      );
    // Priority order: overdue → priority → due date → newest
    return [...list].sort(
      (a, b) =>
        Number(!!b.overdue) - Number(!!a.overdue) ||
        (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2) ||
        (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") ||
        String(b.created_at).localeCompare(String(a.created_at)),
    );
  }, [tasks, filter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => setPage(1), [filter]);
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  /* ── Overdue advance receipts (proformas awaiting customer payment) ── */
  const overdueReceipts = useMemo(() => {
    return ((proformasQ.data ?? []) as any[])
      .filter(
        (p) =>
          p.side === "sales" &&
          p.proforma_status === "approved" && // checker-approved, not yet funded
          p.advance_due_date &&
          daysOverdue(p.advance_due_date) > 0,
      )
      .map((p) => ({
        docNumber: p.proforma_number ?? p.po_number ?? "—",
        customer: p.debtor_name ?? p.customer_name ?? "—",
        days: daysOverdue(p.advance_due_date),
      }))
      .sort((a, b) => b.days - a.days)
      .slice(0, 6);
  }, [proformasQ.data]);

  const loading = tasksQ.isLoading || invoicesQ.isLoading;

  return (
    <div>
      <PageHeader
        eyebrow="Sales"
        title="Sales Workbench"
        icon={<ShoppingBag className="h-5 w-5" />}
        description="Track your sales documents, see what needs action, and take the next step."
      />

      {/* ── Sales navigation — same-page sections, no route change ── */}
      <div className="border-b border-border bg-background">
        <div className="mx-auto w-full max-w-[1440px] overflow-x-auto px-4 md:px-8">
          <nav className="flex min-w-max gap-1" aria-label="Sales sections">
            <NavTab
              label="Workbench"
              active={section === "workbench"}
              onClick={() => setSection("workbench")}
            />
            <NavTab
              label="Customers"
              active={section === "customers"}
              onClick={() => setSection("customers")}
            />
            <NavTab
              label="Sales Orders"
              active={section === "sales-orders"}
              onClick={() => setSection("sales-orders")}
            />
            <NavTab
              label="Sales Proforma"
              active={section === "proformas"}
              onClick={() => setSection("proformas")}
            />
            <NavTab
              label="Sales Invoices"
              active={section === "invoices"}
              onClick={() => setSection("invoices")}
            />
            <NavTab
              label="Credit Notes"
              active={section === "notes"}
              onClick={() => setSection("notes")}
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
                label="Awaiting Customer Acceptance"
                value={kpis.customerAcceptance}
                sub="Customer action required"
                icon={<FileText className="h-[18px] w-[18px]" />}
                tone="amber"
                onClick={() => setFilter("sales_orders")}
              />
              <KpiCard
                label="Advance Payments Pending"
                value={kpis.advancePending}
                sub="Payment confirmation required"
                icon={<Wallet className="h-[18px] w-[18px]" />}
                tone="blue"
                onClick={() => setFilter("proforma")}
              />
              <KpiCard
                label="Invoices Awaiting Approval"
                value={kpis.invoicesAwaiting}
                sub="Finance action required"
                icon={<ClipboardList className="h-[18px] w-[18px]" />}
                tone="amber"
                onClick={() => setFilter("invoices")}
              />
              <KpiCard
                label="Ready for Dispatch"
                value={kpis.readyForDispatch}
                sub="Ready for warehouse"
                icon={<Truck className="h-[18px] w-[18px]" />}
                tone="green"
                onClick={() => setFilter("dispatch")}
              />
            </>
          )}
        </div>

        {/* ── Workbench filter tabs ── */}
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
        </div>

        {/* ── Main content: work items (70%) + overdue receipts (30%) ── */}
        <div className="grid gap-6 lg:grid-cols-10">
          {/* LEFT — Work requiring attention */}
          <Card
            className="lg:col-span-7"
            title="Work requiring attention"
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
                icon={<ShoppingBag className="h-6 w-6" />}
                title="You're all caught up"
                description="No sales documents currently require your attention."
              />
            ) : (
              <>
                <p className="mb-3 text-xs text-muted-foreground">
                  Sales documents that need action before the next step.
                </p>
                <div className="-mx-5 overflow-x-auto table-wrap">
                  <table className="table-premium w-full text-sm">
                    <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr className="border-b border-border bg-muted/40">
                        <th className="px-4 py-2 text-left font-medium">Document</th>
                        <th className="px-4 py-2 text-left font-medium">Customer</th>
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

                          {/* Customer */}
                          <td className="px-4 py-2.5 text-[13px]">
                            {t.counterparty ?? "—"}
                          </td>

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
                          <td className="px-4 py-2.5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                onClick={() => openDoc(t)}
                                className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-sm transition-all hover:-translate-y-px hover:shadow-md"
                              >
                                Open
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
                      <span className="px-1 font-medium">
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

          {/* RIGHT — Overdue receipts */}
          <Card
            className="lg:col-span-3"
            title="Overdue receipts"
            action={
              <button
                onClick={() => setSection("proformas")}
                className="text-xs font-medium text-muted-foreground hover:text-primary"
              >
                View all
              </button>
            }
          >
            {proformasQ.isLoading ? (
              <TableSkeleton rows={4} cols={1} />
            ) : overdueReceipts.length === 0 ? (
              <EmptyState
                icon={<Wallet className="h-6 w-6" />}
                title="No overdue receipts"
                description="All customer receipts are currently on track."
              />
            ) : (
              <>
                <div className="divide-y divide-border/70">
                  {overdueReceipts.map((r, idx) => (
                    <div key={idx} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <div className="font-mono text-[13px] font-semibold text-foreground">
                          {r.docNumber}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{r.customer}</div>
                      </div>
                      <span className="shrink-0 text-[13px] font-semibold text-destructive">
                        {r.days} {r.days === 1 ? "day" : "days"}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-primary/15 bg-primary-soft/50 p-3">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    These are proforma invoices awaiting advance receipts from customers.
                  </p>
                </div>
              </>
            )}
          </Card>
        </div>
        </div>
      ) : (
        <Suspense fallback={<SectionFallback />}>
          {section === "customers" && <DebtorsPanel />}
          {section === "sales-orders" && <SalesOrdersPanel />}
          {section === "proformas" && <ProformasPanel />}
          {section === "invoices" && <InvoicesPanel />}
          {section === "notes" && <NotesPanel />}
          {section === "tasks" && <TasksPanel />}
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
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
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
  const toneCls = {
    neutral: "border-primary/20 bg-primary-soft text-primary",
    amber: "border-sem-attention/25 bg-sem-attention/10 text-sem-attention",
    blue: "border-primary/20 bg-primary-soft text-primary",
    green: "border-sem-success/25 bg-sem-success/10 text-sem-success",
  }[tone];
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
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${toneCls}`}>
          {icon}
        </div>
      </div>
      <div className="num mt-2 text-3xl font-semibold tracking-tight text-foreground">{value}</div>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </button>
  );
}
