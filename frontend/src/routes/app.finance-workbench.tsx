import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  Wallet,
  ClipboardList,
  FileText,
  Banknote,
  ArrowRightLeft,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  ExternalLink,
  TriangleAlert,
} from "lucide-react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import {
  PageHeader,
  Card,
  EmptyState,
  StatusPill,
  fmtMoney,
} from "@/components/ledger-ui";
import { TableSkeleton, StatSkeleton } from "@/components/skeletons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/app/finance-workbench")({
  component: FinanceWorkbenchPage,
});

/* ────────────────────────────────────────────────────────────────────────────
 * Finance Workbench — same tab format as the Sales / Procurement / Warehouse
 * workbenches (PageHeader + same-page NavTab bar + workbench overview +
 * lazy panels). Every table row is a real open WorkflowTask created by the
 * backend at each handoff; Current Status / Next Step / Owner come straight
 * from the task record (docStatus / requiredAction / ownerRole). KPI and
 * panel counts are computed from live document data. No new statuses,
 * stages, processes or actions are invented here — the underlying document
 * pages remain the place where work is performed.
 *
 * Data sources (all existing, read-only):
 *  - /workflow-tasks?status=open        → work-items table
 *  - /invoices                           → KPI (sales invoices awaiting action)
 *  - /purchase-invoices                  → KPI (supplier invoices pending)
 *  - /purchase-orders (proformas, sales) → KPI (proformas awaiting funding)
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

/** Finance family only — receivables, payables, treasury handoffs + dispatch EWB tasks. */
const FINANCE_WF_TYPES = new Set([
  "sales_invoice",
  "purchase_invoice",
  "proforma",
  "payment",
  "dispatch",
]);

const WF_TYPE_LABEL: Record<string, string> = {
  sales_invoice: "Sales Invoice",
  purchase_invoice: "Purchase Invoice",
  proforma: "Proforma Invoice",
  payment: "Payment",
  dispatch: "Dispatch Order",
};

/** owner_role → the team currently responsible for the next step. */
const OWNER_LABEL: Record<string, string> = {
  treasury: "Treasury",
  finance: "Treasury",
  checker: "Checker",
  sales: "Sales",
  procurement: "Procurement",
  operations: "Operations",
  warehouse: "Warehouse",
  client: "Customer",
};

/** Where does this document live? Same mapping the unified queue uses. */
function docAppPath(t: Task): string {
  switch (t.doc_type) {
    case "sales_invoice":
      return "/app/invoices";
    case "purchase_invoice":
      return "/app/purchases";
    case "proforma":
      return "/app/proformas";
    case "payment":
      return "/app/queue";
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
  if (stage.includes("treasury") || stage.includes("payment") || stage.includes("fund"))
    return "Fund";
  if (stage.includes("dispatch") || stage.includes("ship")) return "Dispatch";
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

type FilterKey = "all" | "sales_invoices" | "purchase_invoices" | "proforma" | "payments" | "dispatch";

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "sales_invoices", label: "Sales Invoices" },
  { key: "purchase_invoices", label: "Purchase Invoices" },
  { key: "proforma", label: "Proforma" },
  { key: "payments", label: "Payments" },
  { key: "dispatch", label: "Dispatch Orders" },
];

const PAGE_SIZE = 15;

/* ── Same-page sections — tab clicks switch content below, never navigate ── */
type FinanceSection =
  | "workbench"
  | "cash"
  | "treasury"
  | "bulk"
  | "sales-orders"
  | "sales-invoices"
  | "proformas"
  | "purchase-invoices"
  | "dispatch-orders"
  | "tasks";

const CashPanel = lazy(() =>
  import("@/routes/app.cash-flow").then((m) => ({ default: m.CashFlowPage })),
);
const TreasuryPanel = lazy(() =>
  import("@/routes/app.queue").then((m) => ({ default: m.QueuePage })),
);
const BulkPanel = lazy(() =>
  import("@/routes/app.bulk-payments").then((m) => ({ default: m.BulkPaymentsPage })),
);
const SalesOrdersPanel = lazy(() =>
  import("@/routes/app.sales-orders").then((m) => ({ default: m.SalesOrdersPage })),
);
const SalesInvoicesPanel = lazy(() =>
  import("@/routes/app.invoices").then((m) => ({ default: m.InvoicesPage })),
);
const ProformasPanel = lazy(() =>
  import("@/routes/app.proformas").then((m) => ({ default: m.ProformasPage })),
);
const PurchaseInvoicesPanel = lazy(() =>
  import("@/routes/app.purchases").then((m) => ({ default: m.PurchasesPage })),
);
const DispatchOrdersPanel = lazy(() =>
  import("@/routes/app.finance-dispatches").then((m) => ({
    default: m.FinanceDispatchOrdersPanel,
  })),
);
const FinanceTasksPanel = lazy(() =>
  import("@/routes/app.tasks").then((m) => ({ default: m.TasksPage })),
);

function SectionFallback() {
  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-6 md:px-8 md:py-8">
      <TableSkeleton rows={6} cols={8} />
    </div>
  );
}

/* Purchase-invoice statuses awaiting processing/approval (not terminal). */
const PENDING_PI_STATUSES = new Set(["draft", "pending", "verified", "overdue", "disputed"]);

function FinanceWorkbenchPage() {
  const { isAdmin, isOperations, isTreasury } = useAuth();
  void isAdmin;
  void isOperations;
  void isTreasury;
  const navigate = useNavigate();
  const [section, setSection] = useState<FinanceSection>("workbench");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("all");
  const [page, setPage] = useState(1);

  /* Row-level open: stay in-page when the doc has its own tab, else deep-link. */
  function openDoc(t: { doc_type: string }) {
    switch (t.doc_type) {
      case "sales_invoice":
        setSection("sales-invoices");
        return;
      case "purchase_invoice":
        setSection("purchase-invoices");
        return;
      case "proforma":
        setSection("proformas");
        return;
      case "payment":
        setSection("treasury");
        return;
      case "dispatch":
        setSection("dispatch-orders");
        return;
      default:
        navigate({ to: docAppPath(t as any) as any });
    }
  }

  /* ── Open workflow tasks (engine data — same endpoint as My Queue) ── */
  const tasksQ = useQuery({
    queryKey: ["finance-workbench-tasks"],
    queryFn: () => api.workflowTasks.list({ status: "open" }),
    refetchInterval: 60_000,
  });

  /* ── Sales invoices (KPI: awaiting approval / overdue) ── */
  const salesQ = useQuery({
    queryKey: ["finance-workbench-sales-invoices"],
    queryFn: () => api.invoices.list(),
  });

  /* ── Purchase invoices (KPI: pending processing) ── */
  const purchasesQ = useQuery({
    queryKey: ["finance-workbench-purchase-invoices"],
    queryFn: () => api.purchaseInvoices.list(),
  });

  const tasks: Task[] = ((tasksQ.data ?? []) as Task[]).filter((t) =>
    FINANCE_WF_TYPES.has(t.workflow_type),
  );

  const sales: any[] = useMemo(() => (salesQ.data ?? []) as any[], [salesQ.data]);
  const purchaseInvoices: any[] = useMemo(
    () => (purchasesQ.data ?? []) as any[],
    [purchasesQ.data],
  );

  /* ── KPIs — computed from live document data ── */
  const kpis = useMemo(() => {
    const salesAwaiting = sales.filter((i) =>
      ["pending", "submitted", "awaiting_approval"].includes(String(i.status ?? "").toLowerCase()),
    ).length;
    const purchasePending = purchaseInvoices.filter((i) =>
      PENDING_PI_STATUSES.has(String(i.status ?? "").toLowerCase()),
    ).length;
    const paymentsOpen = tasks.filter((t) => t.workflow_type === "payment").length;
    const overdue = [...sales, ...purchaseInvoices].filter(
      (i) =>
        String(i.status ?? "").toLowerCase() === "overdue" ||
        (i.due_date && daysOverdue(String(i.due_date)) > 0),
    ).length;
    return { salesAwaiting, purchasePending, paymentsOpen, overdue };
  }, [sales, purchaseInvoices, tasks]);

  /* ── Work-items: filter tabs + compact search/selects (all client-side) ── */
  const filtered = useMemo(() => {
    let list = tasks;
    if (filter === "sales_invoices")
      list = list.filter((t) => t.workflow_type === "sales_invoice");
    else if (filter === "purchase_invoices")
      list = list.filter((t) => t.workflow_type === "purchase_invoice");
    else if (filter === "proforma") list = list.filter((t) => t.workflow_type === "proforma");
    else if (filter === "payments") list = list.filter((t) => t.workflow_type === "payment");
    else if (filter === "dispatch") list = list.filter((t) => t.workflow_type === "dispatch");
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((t) =>
        [t.doc_number, t.counterparty, t.required_action, t.doc_status]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    if (owner !== "all") {
      list = list.filter((t) => (t.owner_role ?? "").toLowerCase() === owner.toLowerCase());
    }
    // Priority order: overdue → priority → due date → newest
    return [...list].sort(
      (a, b) =>
        Number(!!b.overdue) - Number(!!a.overdue) ||
        (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2) ||
        (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") ||
        String(b.created_at).localeCompare(String(a.created_at)),
    );
  }, [tasks, filter, query, owner]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => setPage(1), [filter, query, owner]);
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  /* ── Owner options derived from live tasks ── */
  const ownerOptions = useMemo(() => {
    const roles = new Map<string, string>();
    for (const t of tasks) {
      const raw = (t.owner_role ?? "").trim();
      if (raw) roles.set(raw.toLowerCase(), OWNER_LABEL[raw] ?? raw);
    }
    return [...roles.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [tasks]);

  /* ── Needs attention — live overdue invoices only ── */
  const attention = useMemo(() => {
    const rows = [...sales, ...purchaseInvoices]
      .filter(
        (i) =>
          String(i.status ?? "").toLowerCase() === "overdue" ||
          (i.due_date && daysOverdue(String(i.due_date)) > 0),
      )
      .map((i: any) => ({
        number: i.invoice_number ?? "—",
        party: i.debtor?.name ?? i.vendor?.name ?? i.counterparty ?? "—",
        days: i.due_date ? daysOverdue(String(i.due_date)) : 0,
        amount: i.amount ?? i.grand_total ?? null,
      }))
      .sort((a, b) => b.days - a.days)
      .slice(0, 5);
    return rows;
  }, [sales, purchaseInvoices]);

  const loading = tasksQ.isLoading || salesQ.isLoading || purchasesQ.isLoading;

  return (
    <div>
      <PageHeader
        eyebrow="Finance"
        title="Finance Workbench"
        icon={<Wallet className="h-5 w-5" />}
        description="Track receivables, payables, cash and treasury actions."
        actions={
          <button
            onClick={() => setSection("bulk")}
            className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:-translate-y-px hover:shadow-md"
          >
            + New Bulk Payment
          </button>
        }
      />

      {/* ── Finance navigation — same-page sections, no route change ── */}
      <div className="border-b border-border bg-background">
        <div className="mx-auto w-full max-w-[1440px] overflow-x-auto px-4 md:px-8">
          <nav className="flex min-w-max gap-1" aria-label="Finance sections">
            <NavTab
              label="Workbench"
              active={section === "workbench"}
              onClick={() => setSection("workbench")}
            />
            <NavTab
              label="Cash Command"
              active={section === "cash"}
              onClick={() => setSection("cash")}
            />
            <NavTab
              label="Treasury"
              active={section === "treasury"}
              onClick={() => setSection("treasury")}
            />
            <NavTab
              label="Bulk Payments"
              active={section === "bulk"}
              onClick={() => setSection("bulk")}
            />
            <NavTab
              label="Sales Orders"
              active={section === "sales-orders"}
              onClick={() => setSection("sales-orders")}
            />
            <NavTab
              label="Sales Invoices"
              active={section === "sales-invoices"}
              onClick={() => setSection("sales-invoices")}
            />
            <NavTab
              label="Sales Proforma"
              active={section === "proformas"}
              onClick={() => setSection("proformas")}
            />
            <NavTab
              label="Purchase Invoices"
              active={section === "purchase-invoices"}
              onClick={() => setSection("purchase-invoices")}
            />
            <NavTab
              label="Dispatch Orders"
              active={section === "dispatch-orders"}
              onClick={() => setSection("dispatch-orders")}
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
                label="Sales Invoices Awaiting Approval"
                value={kpis.salesAwaiting}
                sub="Needs checker review"
                icon={<ClipboardList className="h-[18px] w-[18px]" />}
                tone="amber"
                onClick={() => setFilter("sales_invoices")}
              />
              <KpiCard
                label="Purchase Invoices Pending"
                value={kpis.purchasePending}
                sub="Awaiting processing"
                icon={<FileText className="h-[18px] w-[18px]" />}
                tone="amber"
                onClick={() => setFilter("purchase_invoices")}
              />
              <KpiCard
                label="Open Payments"
                value={kpis.paymentsOpen}
                sub="Treasury handoffs"
                icon={<Banknote className="h-[18px] w-[18px]" />}
                tone="blue"
                onClick={() => setFilter("payments")}
              />
              <KpiCard
                label="Overdue Invoices"
                value={kpis.overdue}
                sub="Past due date"
                icon={<ArrowRightLeft className="h-[18px] w-[18px]" />}
                tone="amber"
                onClick={() => setFilter("all")}
              />
            </>
          )}
        </div>

        {/* ── Workbench filter tabs + compact search/selects ── */}
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
              placeholder="Search document, counterparty…"
              aria-label="Search finance work items"
              className="h-8 w-52 rounded-md border border-border bg-card px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
            <select
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              aria-label="Filter by owner"
              className="h-8 rounded-md border border-border bg-card px-2 text-xs text-foreground focus:border-primary focus:outline-none"
            >
              <option value="all">All owners</option>
              {ownerOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Main content: work items (75%) + needs attention (25%) ── */}
        <div className="grid gap-6 lg:grid-cols-4">
          {/* LEFT — Finance work items */}
          <Card
            className="lg:col-span-3"
            title="Finance work items"
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
                icon={<Wallet className="h-6 w-6" />}
                title="You're all caught up"
                description="No finance work currently requires your attention."
              />
            ) : (
              <>
                <p className="mb-3 text-xs text-muted-foreground">
                  Invoices and payments that need action before the next step.
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

          {/* RIGHT — Needs attention */}
          <div className="space-y-6">
            <Card
              title="Needs attention"
              action={
                <button
                  onClick={() => setSection("sales-invoices")}
                  className="text-xs font-medium text-muted-foreground hover:text-primary"
                >
                  View all
                </button>
              }
            >
              {loading ? (
                <TableSkeleton rows={4} cols={1} />
              ) : attention.length === 0 ? (
                <EmptyState
                  icon={<Banknote className="h-6 w-6" />}
                  title="Nothing overdue"
                  description="No invoices are currently past their due date."
                />
              ) : (
                <div className="divide-y divide-border/70">
                  {attention.map((r) => (
                    <div key={r.number} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <div className="font-mono text-[13px] font-semibold text-foreground">
                          {r.number}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {r.party}
                          {r.amount != null ? ` · ${fmtMoney(r.amount)}` : ""}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {r.days > 0 ? `${r.days}d overdue` : "Due today"}
                        </div>
                      </div>
                      {r.days > 0 && (
                        <span className="shrink-0 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
                          {r.days}d overdue
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card
              title="Treasury queue"
              action={
                <button
                  onClick={() => setSection("treasury")}
                  className="text-xs font-medium text-muted-foreground hover:text-primary"
                >
                  Open
                </button>
              }
            >
              {loading ? (
                <TableSkeleton rows={3} cols={1} />
              ) : (
              <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[13px] font-semibold text-foreground">Open payments</div>
                      <div className="text-xs text-muted-foreground">Awaiting treasury action</div>
                    </div>
                    <span className="num shrink-0 text-lg font-semibold text-foreground">
                      {kpis.paymentsOpen}
                    </span>
                  </div>
                  <div className="flex items-start justify-between gap-3 border-t border-border/60 pt-4">
                    <div>
                      <div className="text-[13px] font-semibold text-foreground">
                        Sales awaiting approval
                      </div>
                      <div className="text-xs text-muted-foreground">Need checker action</div>
                    </div>
                    <span
                      className={`num shrink-0 text-lg font-semibold ${kpis.salesAwaiting > 0 ? "text-sem-attention" : "text-muted-foreground"}`}
                    >
                      {kpis.salesAwaiting}
                    </span>
                  </div>
                  {kpis.overdue > 0 && (
                    <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        {kpis.overdue} invoice{kpis.overdue === 1 ? " is" : "s are"} past due. Follow
                        up for collection or payment.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </Card>
          </div>
        </div>
        </div>
      ) : (
        <Suspense fallback={<SectionFallback />}>
          {section === "cash" && <CashPanel />}
          {section === "treasury" && <TreasuryPanel />}
          {section === "bulk" && <BulkPanel />}
          {section === "sales-orders" && <SalesOrdersPanel />}
          {section === "sales-invoices" && <SalesInvoicesPanel />}
          {section === "proformas" && <ProformasPanel />}
          {section === "purchase-invoices" && <PurchaseInvoicesPanel />}
          {section === "dispatch-orders" && <DispatchOrdersPanel />}
          {section === "tasks" && <FinanceTasksPanel />}
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
