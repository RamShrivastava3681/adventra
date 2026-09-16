import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  ShoppingCart,
  ClipboardList,
  FileText,
  Truck,
  PackageCheck,
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
  fmtDate,
} from "@/components/ledger-ui";
import { TableSkeleton, StatSkeleton } from "@/components/skeletons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/app/procurement-workbench")({
  component: ProcurementWorkbenchPage,
});

/* ────────────────────────────────────────────────────────────────────────────
 * Procurement Workbench — an operational view over the existing unified
 * workflow engine (PDF-3) and the existing procurement documents.
 * Every table row is a real open WorkflowTask created by the backend at each
 * handoff; Current Status / Next Step / Owner come straight from the task
 * record (docStatus / requiredAction / ownerRole). KPI and panel counts are
 * computed from live document data. No new statuses, stages, processes or
 * actions are invented here — the underlying document pages remain the place
 * where work is performed.
 *
 * Data sources (all existing, read-only):
 *  - /workflow-tasks?status=open        → work-items table
 *  - /goods-purchase-orders             → KPI 1 (POs awaiting checker), KPI 3
 *                                          (deliveries due), upcoming/delayed
 *  - /purchase-invoices                 → KPI 2 (invoices pending)
 *  - /goods-receipts                    → KPI 4 (GRNs pending)
 *  - /suppliers                         → supplier filter options
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

/** Procurement family only — excludes sales-side workflows. */
const PROC_WF_TYPES = new Set(["purchase_order", "purchase_invoice", "grn", "payment"]);

const WF_TYPE_LABEL: Record<string, string> = {
  purchase_order: "Purchase Order",
  purchase_invoice: "Purchase Invoice",
  grn: "Goods Receipt Note",
  payment: "Supplier Payment",
};

/** owner_role → the team currently responsible for the next step. */
const OWNER_LABEL: Record<string, string> = {
  procurement: "Procurement",
  operations: "Procurement",
  client: "Procurement",
  checker: "Checker",
  treasury: "Treasury",
  warehouse: "Warehouse",
  finance: "Treasury",
};

/** Where does this document live? Same mapping the unified queue uses. */
function docAppPath(t: Task): string {
  switch (t.doc_type) {
    case "purchase_order":
      return "/app/purchase-orders";
    case "purchase_invoice":
      return "/app/purchases";
    case "grn":
      return "/app/grn";
    case "payment":
      return "/app/queue";
    default:
      return "/app/tasks";
  }
}

/** Compact primary-action label for the engine stage (UI label only —
 *  the button deep-links to the existing document page in every case). */
function actionLabel(t: Task): string {
  const stage = (t.stage ?? "").toLowerCase();
  if (stage.includes("checker") || stage.includes("approv")) return "Review";
  if (stage.includes("send_to_supplier") || stage === "send") return "Send PO";
  if (stage.includes("supplier_invoice") || stage.includes("record_invoice"))
    return "Record Invoice";
  if (stage.includes("treasury") || stage.includes("payment")) return "Request Payment";
  if (stage.includes("grn") || stage.includes("await_goods") || stage.includes("receive"))
    return "Record GRN";
  if (t.overdue) return "Follow Up";
  return "Open";
}

function todayYMD(): string {
  return new Date().toISOString().slice(0, 10);
}

function startOfWeekMonday(d: Date): Date {
  const copy = new Date(d);
  const day = (copy.getDay() + 6) % 7; // Monday = 0
  copy.setDate(copy.getDate() - day);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function daysOverdue(due: string | null | undefined): number {
  if (!due) return 0;
  const dueDay = String(due).slice(0, 10);
  if (dueDay >= todayYMD()) return 0;
  const diff = Math.floor((new Date(todayYMD()).getTime() - new Date(dueDay).getTime()) / 86400000);
  return Math.max(0, diff);
}

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

const PAGE_SIZE = 15;

/* ── Same-page sections — tab clicks switch content below, never navigate ── */
type ProcSection =
  | "workbench"
  | "suppliers"
  | "purchase-orders"
  | "proformas"
  | "purchase-invoices"
  | "tasks";

const SuppliersPanel = lazy(() =>
  import("@/routes/app.suppliers").then((m) => ({ default: m.SuppliersPage })),
);
const PurchaseOrdersPanel = lazy(() =>
  import("@/routes/app.purchase-orders").then((m) => ({ default: m.PurchaseOrdersPage })),
);
const ProformasPanel = lazy(() =>
  import("@/routes/app.proformas").then((m) => ({ default: m.ProformasPage })),
);
const PurchaseInvoicesPanel = lazy(() =>
  import("@/routes/app.purchases").then((m) => ({
    default: m.PurchasesPage,
  })),
);
const ProcTasksPanel = lazy(() =>
  import("@/routes/app.tasks").then((m) => ({ default: m.TasksPage })),
);

function SectionFallback() {
  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-6 md:px-8 md:py-8">
      <TableSkeleton rows={6} cols={8} />
    </div>
  );
}

/* Goods-PO statuses that still need procurement attention (not terminal). */
const OPEN_PO_STATUSES = new Set([
  "draft",
  "pending_review",
  "approved",
  "sent",
  "partially_received",
]);

/* Purchase-invoice statuses awaiting processing/approval (not terminal). */
const PENDING_PI_STATUSES = new Set(["draft", "pending", "verified", "overdue", "disputed"]);

function ProcurementWorkbenchPage() {
  const { isAdmin, isOperations, isClient, isChecker, isTreasury } = useAuth();
  // Procurement (operations) records and owns supplier invoices — same rule
  // as the standalone page; everyone else stays read-only in this tab.
  const invoicesReadOnly = !(isAdmin || isOperations || (isClient && !isChecker && !isTreasury));
  const navigate = useNavigate();
  const [section, setSection] = useState<ProcSection>("workbench");
  const [query, setQuery] = useState("");
  const [supplier, setSupplier] = useState("all");
  const [owner, setOwner] = useState(isOperations ? "procurement" : "all");
  const [page, setPage] = useState(1);

  /* Row-level open: stay in-page when the doc has its own tab, else deep-link. */
  function openDoc(t: { doc_type: string }) {
    switch (t.doc_type) {
      case "purchase_order":
        setSection("purchase-orders");
        return;
      case "proforma":
        setSection("proformas");
        return;
      case "purchase_invoice":
        setSection("purchase-invoices");
        return;
      default:
        navigate({ to: docAppPath(t as any) as any });
    }
  }

  /* ── Open workflow tasks (engine data — same endpoint as My Queue) ── */
  const tasksQ = useQuery({
    queryKey: ["procurement-workbench-tasks"],
    queryFn: () => api.workflowTasks.list({ status: "open" }),
    refetchInterval: 60_000,
  });

  /* ── Goods purchase orders (KPI 1 + KPI 3 + deliveries) ── */
  const posQ = useQuery({
    queryKey: ["procurement-workbench-pos"],
    queryFn: () => api.goodsPurchaseOrders.list(),
  });

  /* ── Purchase invoices (KPI 2) ── */
  const pisQ = useQuery({
    queryKey: ["procurement-workbench-pis"],
    queryFn: () => api.purchaseInvoices.list(),
  });

  /* ── GRNs (KPI 4) ── */
  const grnsQ = useQuery({
    queryKey: ["procurement-workbench-grns"],
    queryFn: () => api.goodsReceipts.list(),
  });

  /* ── Suppliers (filter options) ── */
  const suppliersQ = useQuery({
    queryKey: ["procurement-workbench-suppliers"],
    queryFn: () => api.suppliers.list(),
  });

  const tasks: Task[] = ((tasksQ.data ?? []) as Task[]).filter((t) =>
    PROC_WF_TYPES.has(t.workflow_type),
  );

  const pos: any[] = useMemo(() => posQ.data ?? [], [posQ.data]);
  const pis: any[] = useMemo(() => pisQ.data ?? [], [pisQ.data]);
  const grns: any[] = useMemo(() => grnsQ.data ?? [], [grnsQ.data]);

  /* ── KPIs — computed from live document data ── */
  const kpis = useMemo(() => {
    const posAwaiting = pos.filter((p) =>
      ["pending_review", "pending", "submitted", "awaiting_approval"].includes(
        String(p.status ?? "").toLowerCase(),
      ),
    ).length;
    const invoicesPending = pis.filter((i) =>
      PENDING_PI_STATUSES.has(String(i.status ?? "").toLowerCase()),
    ).length;
    const now = new Date();
    const weekStart = startOfWeekMonday(now);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const deliveriesDue = pos.filter((p) => {
      const raw = p.expected_delivery_date ?? p.expected_date ?? p.due_date;
      if (!raw) return false;
      const d = new Date(String(raw).slice(0, 10));
      if (Number.isNaN(d.getTime())) return false;
      return (
        d >= weekStart && d <= weekEnd && OPEN_PO_STATUSES.has(String(p.status ?? "").toLowerCase())
      );
    }).length;
    const grnsPending = grns.filter((g) =>
      ["draft", "pending"].includes(String(g.status ?? "").toLowerCase()),
    ).length;
    return { posAwaiting, invoicesPending, deliveriesDue, grnsPending };
  }, [pos, pis, grns]);

  /* ── Work-items: compact search/selects (all client-side) ── */
  const filtered = useMemo(() => {
    let list = tasks;
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((t) =>
        [t.doc_number, t.counterparty, t.required_action, t.doc_status]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    if (supplier !== "all") {
      list = list.filter((t) => (t.counterparty ?? "").toLowerCase() === supplier.toLowerCase());
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
  }, [tasks, query, supplier, owner]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => setPage(1), [query, supplier, owner]);
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  /* ── Supplier / owner options derived from live tasks ── */
  const supplierOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const t of tasks) {
      const raw = (t.counterparty ?? "").trim();
      if (raw) names.set(raw.toLowerCase(), raw);
    }
    return [...names.values()].sort((a, b) => a.localeCompare(b));
  }, [tasks]);
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

  /* ── Priority attention — live exceptions only ── */
  const priority = useMemo(() => {
    const delayed = pos
      .filter((p) => {
        const raw = p.expected_delivery_date ?? p.expected_date ?? p.due_date;
        return (
          raw &&
          daysOverdue(String(raw)) > 0 &&
          OPEN_PO_STATUSES.has(String(p.status ?? "").toLowerCase())
        );
      })
      .map((p) => ({
        poNumber: p.po_number ?? "—",
        supplierName: p.supplier_name ?? p.supplierName ?? "—",
        days: daysOverdue(String(p.expected_delivery_date ?? p.expected_date ?? p.due_date)),
      }))
      .sort((a, b) => b.days - a.days);
    const invoicesAwaiting = pis.filter((i) =>
      PENDING_PI_STATUSES.has(String(i.status ?? "").toLowerCase()),
    ).length;
    const grnsPending = grns.filter((g) =>
      ["draft", "pending"].includes(String(g.status ?? "").toLowerCase()),
    ).length;
    return { delayed, invoicesAwaiting, grnsPending };
  }, [pos, pis, grns]);

  /* ── Upcoming deliveries — only when PO data carries expected dates ── */
  const upcoming = useMemo(() => {
    const rows = pos
      .filter((p) => {
        const raw = p.expected_delivery_date ?? p.expected_date ?? p.due_date;
        return raw && OPEN_PO_STATUSES.has(String(p.status ?? "").toLowerCase());
      })
      .map((p) => {
        const raw = String(p.expected_delivery_date ?? p.expected_date ?? p.due_date);
        const overdueDays = daysOverdue(raw);
        const diffDays = Math.ceil(
          (new Date(raw.slice(0, 10)).getTime() - new Date(todayYMD()).getTime()) / 86400000,
        );
        return {
          supplierName: p.supplier_name ?? p.supplierName ?? "—",
          poNumber: p.po_number ?? "—",
          expected: raw.slice(0, 10),
          overdueDays,
          status: overdueDays > 0 ? "Overdue" : diffDays <= 3 ? "Due Soon" : "On Schedule",
        };
      })
      .sort((a, b) => a.expected.localeCompare(b.expected))
      .slice(0, 5);
    return rows;
  }, [pos]);
  const hasDeliveryData = pos.some(
    (p) => p.expected_delivery_date ?? p.expected_date ?? p.due_date,
  );

  const loading = tasksQ.isLoading || posQ.isLoading || pisQ.isLoading || grnsQ.isLoading;

  return (
    <div>
      <PageHeader
        eyebrow="Procurement"
        title="Procurement Workbench"
        icon={<ShoppingCart className="h-5 w-5" />}
        description="Manage purchase orders, supplier invoices, deliveries and GRNs."
      />

      {/* ── Procurement navigation — same-page sections, no route change ── */}
      <div className="border-b border-border bg-background">
        <div className="mx-auto w-full max-w-[1440px] overflow-x-auto px-4 md:px-8">
          <nav className="flex min-w-max gap-1" aria-label="Procurement sections">
            <NavTab
              label="Workbench"
              active={section === "workbench"}
              onClick={() => setSection("workbench")}
            />
            <NavTab
              label="Suppliers"
              active={section === "suppliers"}
              onClick={() => setSection("suppliers")}
            />
            <NavTab
              label="Purchase Orders"
              active={section === "purchase-orders"}
              onClick={() => setSection("purchase-orders")}
            />
            <NavTab
              label="Purchase Proforma"
              active={section === "proformas"}
              onClick={() => setSection("proformas")}
            />
            <NavTab
              label="Purchase Invoices"
              active={section === "purchase-invoices"}
              onClick={() => setSection("purchase-invoices")}
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
                label="POs Awaiting Approval"
                value={kpis.posAwaiting}
                sub="Needs checker review"
                icon={<ClipboardList className="h-[18px] w-[18px]" />}
                tone="amber"
              />
              <KpiCard
                label="Supplier Invoices Pending"
                value={kpis.invoicesPending}
                sub="Awaiting processing"
                icon={<FileText className="h-[18px] w-[18px]" />}
                tone="amber"
              />
              <KpiCard
                label="Deliveries Due This Week"
                value={kpis.deliveriesDue}
                sub="Expected deliveries"
                icon={<Truck className="h-[18px] w-[18px]" />}
                tone="blue"
              />
              <KpiCard
                label="GRNs Pending"
                value={kpis.grnsPending}
                sub="Awaiting receipt"
                icon={<PackageCheck className="h-[18px] w-[18px]" />}
                tone="amber"
              />
            </>
          )}
        </div>

        {/* ── Compact search/selects ── */}
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search document, supplier…"
              aria-label="Search procurement work items"
              className="h-8 w-52 rounded-md border border-border bg-card px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
            <select
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              aria-label="Filter by supplier"
              className="h-8 max-w-48 rounded-md border border-border bg-card px-2 text-xs text-foreground focus:border-primary focus:outline-none"
            >
              <option value="all">All suppliers</option>
              {supplierOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
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

        {/* ── Main content: work items (75%) + priority attention (25%) ── */}
        <div className="grid gap-6 lg:grid-cols-4">
          {/* LEFT — Procurement work items */}
          <Card
            className="lg:col-span-3"
            title="Procurement work items"
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
                icon={<ShoppingCart className="h-6 w-6" />}
                title="You're all caught up"
                description="No procurement work currently requires your attention."
              />
            ) : (
              <>
                <p className="mb-3 text-xs text-muted-foreground">
                  Purchase documents that need action before the next step.
                </p>
                <div className="-mx-5 overflow-x-auto table-wrap">
                  <table className="table-premium w-full text-sm">
                    <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr className="border-b border-border bg-muted/40">
                        <th className="px-4 py-2 text-left font-medium">Document</th>
                        <th className="px-4 py-2 text-left font-medium">Supplier</th>
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

                          {/* Supplier */}
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

          {/* RIGHT — Priority attention */}
          <div className="space-y-6">
            <Card
              title="Priority attention"
              action={
                <button
                  onClick={() => setSection("tasks")}
                  className="text-xs font-medium text-muted-foreground hover:text-primary"
                >
                  View all
                </button>
              }
            >
              {loading ? (
                <TableSkeleton rows={3} cols={1} />
              ) : priority.delayed.length === 0 &&
                priority.invoicesAwaiting === 0 &&
                priority.grnsPending === 0 ? (
                <EmptyState
                  icon={<PackageCheck className="h-6 w-6" />}
                  title="You're all caught up"
                  description="No procurement work currently requires your attention."
                />
              ) : (
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[13px] font-semibold text-foreground">
                        Delayed Deliveries
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {priority.delayed.length === 0
                          ? "No delayed deliveries — all supplier deliveries are currently on schedule."
                          : "Supplier deliveries past expected date"}
                      </div>
                    </div>
                    <span
                      className={`num shrink-0 text-lg font-semibold ${priority.delayed.length > 0 ? "text-destructive" : "text-muted-foreground"}`}
                    >
                      {priority.delayed.length}
                    </span>
                  </div>
                  <div className="flex items-start justify-between gap-3 border-t border-border/60 pt-4">
                    <div>
                      <div className="text-[13px] font-semibold text-foreground">
                        Invoices Awaiting Approval
                      </div>
                      <div className="text-xs text-muted-foreground">Need checker action</div>
                    </div>
                    <span
                      className={`num shrink-0 text-lg font-semibold ${priority.invoicesAwaiting > 0 ? "text-sem-attention" : "text-muted-foreground"}`}
                    >
                      {priority.invoicesAwaiting}
                    </span>
                  </div>
                  <div className="flex items-start justify-between gap-3 border-t border-border/60 pt-4">
                    <div>
                      <div className="text-[13px] font-semibold text-foreground">GRNs Pending</div>
                      <div className="text-xs text-muted-foreground">
                        {priority.grnsPending === 0
                          ? "No GRNs pending — all received goods have been recorded."
                          : "Warehouse confirmation required"}
                      </div>
                    </div>
                    <span
                      className={`num shrink-0 text-lg font-semibold ${priority.grnsPending > 0 ? "text-sem-attention" : "text-muted-foreground"}`}
                    >
                      {priority.grnsPending}
                    </span>
                  </div>
                  {priority.delayed.length > 0 && (
                    <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        {priority.delayed[0].poNumber} from {priority.delayed[0].supplierName} is{" "}
                        {priority.delayed[0].days} {priority.delayed[0].days === 1 ? "day" : "days"}{" "}
                        overdue. Follow up for delivery.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </Card>

            {/* Upcoming deliveries — only when PO data carries expected dates */}
            {hasDeliveryData && (
              <Card
                title="Upcoming deliveries"
                action={
                  <button
            onClick={() => setSection("purchase-orders")}
                    className="text-xs font-medium text-muted-foreground hover:text-primary"
                  >
                    View all
                  </button>
                }
              >
                {posQ.isLoading ? (
                  <TableSkeleton rows={4} cols={1} />
                ) : upcoming.length === 0 ? (
                  <EmptyState
                    icon={<Truck className="h-6 w-6" />}
                    title="No upcoming deliveries"
                    description="No supplier deliveries are currently scheduled."
                  />
                ) : (
                  <div className="divide-y divide-border/70">
                    {upcoming.map((d) => (
                      <div
                        key={d.poNumber}
                        className="flex items-center justify-between gap-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-medium text-foreground">
                            {d.supplierName}
                          </div>
                          <div className="font-mono text-xs text-muted-foreground">
                            {d.poNumber} · {fmtDate(d.expected)}
                          </div>
                        </div>
                        <span
                          className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                            d.status === "Overdue"
                              ? "border-destructive/30 bg-destructive/10 text-destructive"
                              : d.status === "Due Soon"
                                ? "border-sem-attention/30 bg-sem-attention/10 text-sem-attention"
                                : "border-primary/20 bg-primary-soft text-primary"
                          }`}
                        >
                          {d.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )}
          </div>
        </div>

        {/* Supplier directory hint — existing data only */}
        {!suppliersQ.isLoading && (suppliersQ.data ?? []).length > 0 && (
          <p className="text-xs text-muted-foreground">
            {(suppliersQ.data ?? []).length}{" "}
            {(suppliersQ.data ?? []).length === 1 ? "supplier" : "suppliers"} on record.{" "}
            <button
              onClick={() => setSection("suppliers")}
              className="font-medium text-primary hover:underline"
            >
              Manage suppliers
            </button>
          </p>
        )}
        </div>
      ) : (
        <Suspense fallback={<SectionFallback />}>
          {section === "suppliers" && <SuppliersPanel />}
          {section === "purchase-orders" && <PurchaseOrdersPanel />}
          {section === "proformas" && <ProformasPanel side="purchase" />}
          {section === "purchase-invoices" && <PurchaseInvoicesPanel viewOnly={invoicesReadOnly} />}
          {section === "tasks" && <ProcTasksPanel />}
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
