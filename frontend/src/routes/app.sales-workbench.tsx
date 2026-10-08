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
  Clock,
  ArrowUpDown,
  Search,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  TrendingUp,
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
  | "ageing"
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
              label="Proforma Invoices"
              active={section === "proformas"}
              onClick={() => setSection("proformas")}
            />
            <NavTab
              label="Sales Invoices"
              active={section === "invoices"}
              onClick={() => setSection("invoices")}
            />
            <NavTab
              label="Client Ageing"
              active={section === "ageing"}
              onClick={() => setSection("ageing")}
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

          {/* ── Client Ageing Quick Snapshot ── */}
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Receivables Ageing
                </p>
                <h3 className="mt-1 text-sm font-semibold text-foreground">
                  Client Ageing Overview
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSection("ageing")}
                className="inline-flex items-center gap-1 rounded-lg border border-primary/20 bg-primary-soft/50 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary-soft hover:text-primary transition-colors"
              >
                View Ageing <ArrowRight className="h-3 w-3" />
              </button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Monitor outstanding receivables across 0–30, 31–60, 61–90 and 90+ day ageing buckets.
            </p>
          </Card>
        </div>
        </div>
      ) : (
        <Suspense fallback={<SectionFallback />}>
          {section === "customers" && <DebtorsPanel />}
          {section === "sales-orders" && <SalesOrdersPanel />}
          {section === "proformas" && <ProformasPanel side="sales" />}
          {section === "invoices" && <InvoicesPanel />}
          {section === "ageing" && <ClientAgeingPanel onOpenInvoices={() => setSection("invoices")} />}
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

/* ────────────────────────────────────────────────────────────────────────────
 * Client Ageing Panel — Dedicated sales-side receivables and ageing dashboard
 * ──────────────────────────────────────────────────────────────────────── */
function ClientAgeingPanel({ onOpenInvoices }: { onOpenInvoices: () => void }) {
  const [search, setSearch] = useState("");
  const [bucketFilter, setBucketFilter] = useState<"all" | "overdue" | "critical" | "current">("all");
  const [sortBy, setSortBy] = useState<"total_desc" | "d90_desc" | "name_asc" | "name_desc" | "invoices_desc">("total_desc");
  const [subTab, setSubTab] = useState<"customers" | "overdue_invoices">("customers");

  // Fetch verified ageing buckets from reports API
  const agingQ = useQuery({
    queryKey: ["sales-workbench-aging"],
    queryFn: () => api.reports.aging({ limit: 100 }),
  });

  // Fetch live invoices for invoice-level overdue list
  const invoicesQ = useQuery({
    queryKey: ["sales-workbench-invoices"],
    queryFn: () => api.invoices.list(),
  });

  const agingRows = useMemo(() => {
    return ((agingQ.data?.data ?? []) as any[]).map((r) => ({
      buyer_id: String(r.buyer_id || ""),
      buyer: String(r.buyer || "Unknown Customer"),
      invoices: Number(r.invoices) || 0,
      current: Number(r.current) || 0,
      d1_30: Number(r.d1_30) || 0,
      d31_60: Number(r.d31_60) || 0,
      d61_90: Number(r.d61_90) || 0,
      d91_120: Number(r.d91_120) || 0,
      d120: Number(r.d120) || 0,
      d90Plus: (Number(r.d91_120) || 0) + (Number(r.d120) || 0),
      total: Number(r.total) || 0,
    }));
  }, [agingQ.data]);

  // Aggregate metrics across all clients
  const metrics = useMemo(() => {
    let total = 0;
    let current = 0;
    let d1_30 = 0;
    let d31_60 = 0;
    let d61_90 = 0;
    let d90Plus = 0;

    for (const r of agingRows) {
      total += r.total;
      current += r.current;
      d1_30 += r.d1_30;
      d31_60 += r.d31_60;
      d61_90 += r.d61_90;
      d90Plus += r.d90Plus;
    }

    return {
      total,
      current,
      d1_30,
      d31_60,
      d61_90,
      d90Plus,
      totalOverdue: d1_30 + d31_60 + d61_90 + d90Plus,
      clientCount: agingRows.filter((r) => r.total > 0).length,
    };
  }, [agingRows]);

  // Filtered and sorted customer ageing rows
  const filteredRows = useMemo(() => {
    return agingRows
      .filter((r) => {
        if (search.trim()) {
          const q = search.trim().toLowerCase();
          if (!r.buyer.toLowerCase().includes(q) && !r.buyer_id.toLowerCase().includes(q)) {
            return false;
          }
        }
        const overdueSum = r.d1_30 + r.d31_60 + r.d61_90 + r.d90Plus;
        if (bucketFilter === "overdue" && overdueSum <= 0.01) return false;
        if (bucketFilter === "critical" && (r.d61_90 + r.d90Plus) <= 0.01) return false;
        if (bucketFilter === "current" && r.current <= 0.01) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "total_desc") return b.total - a.total;
        if (sortBy === "d90_desc") return b.d90Plus - a.d90Plus;
        if (sortBy === "name_asc") return a.buyer.localeCompare(b.buyer);
        if (sortBy === "name_desc") return b.buyer.localeCompare(a.buyer);
        if (sortBy === "invoices_desc") return b.invoices - a.invoices;
        return 0;
      });
  }, [agingRows, search, bucketFilter, sortBy]);

  // Live overdue invoices
  const overdueInvoices = useMemo(() => {
    const list = (invoicesQ.data ?? []) as any[];
    return list
      .filter((inv) => {
        const isLive = !["paid", "cancelled", "void"].includes(inv.status);
        const due = inv.due_date ?? inv.dueDate;
        const days = daysOverdue(due);
        const total = Number(inv.grand_total ?? inv.grandTotal ?? inv.amount) || 0;
        const rec = Number(inv.amount_received ?? inv.amountReceived) || 0;
        const balance = Math.max(0, total - rec);
        return isLive && days > 0 && balance > 0.01;
      })
      .map((inv) => {
        const total = Number(inv.grand_total ?? inv.grandTotal ?? inv.amount) || 0;
        const rec = Number(inv.amount_received ?? inv.amountReceived) || 0;
        const due = inv.due_date ?? inv.dueDate;
        return {
          id: String(inv.id),
          invoiceNumber: String(inv.invoice_number ?? inv.invoiceNumber ?? "—"),
          customerName: String(inv.debtor?.name ?? inv.debtor_name ?? inv.customer_name ?? inv.customerName ?? "—"),
          dueDate: due ? String(due).slice(0, 10) : "—",
          daysOverdue: daysOverdue(due),
          balance: Math.max(0, total - rec),
          status: String(inv.status || "open"),
        };
      })
      .sort((a, b) => b.daysOverdue - a.daysOverdue);
  }, [invoicesQ.data]);

  const filteredOverdueInvoices = useMemo(() => {
    if (!search.trim()) return overdueInvoices;
    const q = search.trim().toLowerCase();
    return overdueInvoices.filter(
      (inv) =>
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.customerName.toLowerCase().includes(q),
    );
  }, [overdueInvoices, search]);

  const loading = agingQ.isLoading || invoicesQ.isLoading;

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6 px-4 py-6 md:px-8 md:py-8">
      {/* ── Ageing KPI Cards Grid (6 Buckets) ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {loading ? (
          <>
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
          </>
        ) : (
          <>
            <div className="rounded-xl border border-border bg-card p-4 shadow-card">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Total Outstanding
              </p>
              <div className="num mt-1.5 text-xl font-bold tracking-tight text-foreground">
                {fmtMoney(metrics.total)}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {metrics.clientCount} clients with balance
              </p>
            </div>

            <div className="rounded-xl border border-sem-success/30 bg-sem-success/5 p-4 shadow-card">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-sem-success">
                Current (Not Due)
              </p>
              <div className="num mt-1.5 text-xl font-bold tracking-tight text-sem-success">
                {fmtMoney(metrics.current)}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">Within payment terms</p>
            </div>

            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 shadow-card">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                1–30 Days Overdue
              </p>
              <div className="num mt-1.5 text-xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
                {fmtMoney(metrics.d1_30)}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">Early reminder stage</p>
            </div>

            <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-4 shadow-card">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-orange-600 dark:text-orange-400">
                31–60 Days Overdue
              </p>
              <div className="num mt-1.5 text-xl font-bold tracking-tight text-orange-600 dark:text-orange-400">
                {fmtMoney(metrics.d31_60)}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">Follow-up required</p>
            </div>

            <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 shadow-card">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                61–90 Days Overdue
              </p>
              <div className="num mt-1.5 text-xl font-bold tracking-tight text-rose-600 dark:text-rose-400">
                {fmtMoney(metrics.d61_90)}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">Urgent collection</p>
            </div>

            <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 shadow-card">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-destructive">
                90+ Days Overdue
              </p>
              <div className="num mt-1.5 text-xl font-bold tracking-tight text-destructive">
                {fmtMoney(metrics.d90Plus)}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">Escalated / critical</p>
            </div>
          </>
        )}
      </div>

      {/* ── Sub-view Tabs & Filter Toolbar ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSubTab("customers")}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              subTab === "customers"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "border border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            Customer-wise Ageing ({filteredRows.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab("overdue_invoices")}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              subTab === "overdue_invoices"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "border border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            Overdue Invoices ({overdueInvoices.length})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={subTab === "customers" ? "Search customer name..." : "Search invoice # or client..."}
              className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </div>

          {subTab === "customers" && (
            <>
              <div className="flex items-center gap-1">
                {(
                  [
                    { key: "all", label: "All" },
                    { key: "overdue", label: "Overdue Only" },
                    { key: "critical", label: "60+d Critical" },
                    { key: "current", label: "Not Due" },
                  ] as const
                ).map((b) => (
                  <button
                    key={b.key}
                    type="button"
                    onClick={() => setBucketFilter(b.key)}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      bucketFilter === b.key
                        ? "bg-primary/10 text-primary border border-primary/30"
                        : "border border-transparent text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>

              <select
                aria-label="Sort customer ageing"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:border-primary focus:outline-none"
              >
                <option value="total_desc">Sort: Highest Outstanding</option>
                <option value="d90_desc">Sort: Highest 90+ Days</option>
                <option value="name_asc">Sort: Customer (A → Z)</option>
                <option value="name_desc">Sort: Customer (Z → A)</option>
                <option value="invoices_desc">Sort: Most Invoices</option>
              </select>
            </>
          )}
        </div>
      </div>

      {/* ── Table Content ── */}
      {subTab === "customers" ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-3 py-3 text-center">Invoices</th>
                  <th className="px-3 py-3 text-right">Current (Not Due)</th>
                  <th className="px-3 py-3 text-right">1–30 Days</th>
                  <th className="px-3 py-3 text-right">31–60 Days</th>
                  <th className="px-3 py-3 text-right">61–90 Days</th>
                  <th className="px-3 py-3 text-right">90+ Days</th>
                  <th className="px-4 py-3 text-right">Total Outstanding</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="p-6 text-center text-muted-foreground">
                      <TableSkeleton rows={5} cols={9} />
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-muted-foreground">
                      No customer ageing records matching your filter.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((r) => {
                    const hasCritical = r.d61_90 + r.d90Plus > 0.01;

                    return (
                      <tr key={r.buyer_id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-foreground">{r.buyer}</div>
                          {hasCritical && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-destructive mt-0.5">
                              <AlertTriangle className="h-3 w-3" /> Critical overdue balance
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-center num text-muted-foreground">
                          {r.invoices}
                        </td>
                        <td className="px-3 py-3 text-right num text-muted-foreground">
                          {r.current > 0 ? fmtMoney(r.current) : "—"}
                        </td>
                        <td className="px-3 py-3 text-right num text-amber-600 dark:text-amber-400">
                          {r.d1_30 > 0 ? fmtMoney(r.d1_30) : "—"}
                        </td>
                        <td className="px-3 py-3 text-right num text-orange-600 dark:text-orange-400">
                          {r.d31_60 > 0 ? fmtMoney(r.d31_60) : "—"}
                        </td>
                        <td className="px-3 py-3 text-right num text-rose-600 dark:text-rose-400">
                          {r.d61_90 > 0 ? fmtMoney(r.d61_90) : "—"}
                        </td>
                        <td className="px-3 py-3 text-right num font-semibold text-destructive">
                          {r.d90Plus > 0 ? fmtMoney(r.d90Plus) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right num font-bold text-foreground">
                          {fmtMoney(r.total)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={onOpenInvoices}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                          >
                            Invoices <ArrowRight className="h-3 w-3" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Invoice Number</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-3 py-3">Due Date</th>
                  <th className="px-3 py-3 text-center">Days Overdue</th>
                  <th className="px-4 py-3 text-right">Outstanding Balance</th>
                  <th className="px-3 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-muted-foreground">
                      <TableSkeleton rows={5} cols={7} />
                    </td>
                  </tr>
                ) : filteredOverdueInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      No overdue invoices found. All client balances are up to date!
                    </td>
                  </tr>
                ) : (
                  filteredOverdueInvoices.map((inv) => {
                    const daysBadge =
                      inv.daysOverdue > 60
                        ? "border-destructive/30 bg-destructive/10 text-destructive font-bold"
                        : inv.daysOverdue > 30
                        ? "border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400 font-semibold"
                        : "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium";

                    return (
                      <tr key={inv.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-semibold text-foreground">
                          {inv.invoiceNumber}
                        </td>
                        <td className="px-4 py-3 text-foreground">{inv.customerName}</td>
                        <td className="px-3 py-3 text-muted-foreground">{inv.dueDate}</td>
                        <td className="px-3 py-3 text-center">
                          <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] ${daysBadge}`}>
                            {inv.daysOverdue} {inv.daysOverdue === 1 ? "day" : "days"} overdue
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right num font-semibold text-foreground">
                          {fmtMoney(inv.balance)}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <StatusPill status={inv.status} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={onOpenInvoices}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                          >
                            View <ExternalLink className="h-3 w-3" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

