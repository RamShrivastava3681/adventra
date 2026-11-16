import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ListTodo,
  Search,
  Inbox,
  Clock,
  AlertTriangle,
  CheckCheck,
  Send,
  ExternalLink,
  Loader2,
  IndianRupee,
  Download,
  CheckCircle2,
  X,
  FileText,
  RefreshCw,
  FileCheck,
} from "lucide-react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import {
  PageHeader,
  Card,
  StatusPill,
  fmtMoney,
  fmtDate,
  EmptyState,
} from "@/components/ledger-ui";
import { toast } from "sonner";

/**
 * Unified Workflow Queue (PDF-3 §7, §8).
 * One screen for every pending workflow task across Sales, Purchase,
 * Invoices, GRNs, Dispatches and payments. Personal queue first (assigned to
 * me), then the department/role queue, then the rest — the backend already
 * returns tasks in that order. Filters: Assigned to me, Pending, Due today,
 * Overdue, Rejected, Completed. Every row shows the required action, the
 * next step after completion, priority, due date, overdue flag and the
 * latest update, with an Open Task button linking to the owning document page.
 */

export const Route = createFileRoute("/app/tasks")({
  component: TasksPage,
});

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
  prev_owner: string | null;
  required_action: string;
  next_action: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  due_date: string | null;
  amount: number | null;
  payment_status: string | null;
  inventory_status: string | null;
  linked_docs?: Array<{ type: string; id: string; number: string | null }>;
  latest_update: string | null;
  status: "open" | "done" | "cancelled";
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  completed_by: string | null;
  overdue?: boolean;
};

const WF_TYPE_LABELS: Record<string, string> = {
  sales_order: "Sales Order",
  purchase_order: "Purchase Order",
  purchase_invoice: "Purchase Invoice",
  sales_invoice: "Sales Invoice",
  proforma: "Proforma",
  payment: "Payment",
  grn: "GRN",
  dispatch: "Dispatch",
};

const PRIORITY_TONE: Record<string, string> = {
  urgent: "bg-destructive/10 text-destructive border-destructive/25",
  high: "bg-sem-attention/10 text-sem-attention border-sem-attention/25",
  normal: "bg-muted/60 text-muted-foreground border-border",
  low: "bg-muted/40 text-muted-foreground border-border",
};

/**
 * Where does the NEXT STEP of this task live? Used by the Open Task button.
 * Returns { to, search } for page links, or { modal, id } to open a popup
 * modal instead of navigating. The link targets the page where the required
 * action is performed — and when that action is "create the next document",
 * the page is opened in create mode pre-filled from this task's document
 * (e.g. a sales order's "Create tax invoice" task opens the sales-invoice
 * creation form with the SO selected), not just the current document's list.
 */
function linkedDocId(t: Task, type: string): string | null {
  const found = (t.linked_docs ?? []).find((d) => d.type === type);
  return found?.id ?? null;
}

type TaskTarget = {
  to?: string;
  search?: Record<string, string>;
  modal?: "tally_create_confirm" | "record_irn_ewb";
  id?: string;
};

function taskTarget(t: Task): TaskTarget {
  const stage = (t.stage ?? "").toLowerCase();
  const id = t.doc_id;
  switch (t.doc_type) {
    case "sales_order":
      // Finance stages on a sales order create the NEXT document from it.
      if (stage === "create_invoice") return { to: "/app/invoices", search: { createFromSo: id } };
      if (stage === "create_proforma")
        return { to: "/app/proformas", search: { createFromSo: id, side: "sales" } };
      // Every other sales-order stage is performed on the sales order itself
      // (checker approval, customer acceptance, stock check, dispatch prep).
      return { to: "/app/sales-orders", search: { soId: id } };
    case "sales_invoice":
      if (stage === "tally_create_invoice") return { modal: "tally_create_confirm", id };
      if (stage === "record_irn_ewb") return { modal: "record_irn_ewb", id };
      if (stage === "record_irn") return { to: "/app/invoices", search: { irnFor: id } };
      if (stage === "record_utr" || stage === "await_payment")
        return { to: "/app/invoices", search: { utrFor: id } };
      if (stage === "prepare_dispatch" || stage === "confirm_dispatch")
        return { to: "/app/dispatches", search: { createFromInvoice: id } };
      // Checker approval / issue / payment stages act on the invoice itself.
      return { to: "/app/invoices", search: { view: id } };
    case "proforma":
      // Open the proforma itself (view/edit) instead of the bare list.
      return { to: "/app/proformas", search: { pfId: id } };
    case "purchase_order":
      // Create-proforma from a PO opens the purchase-proforma form with the
      // PO already linked (mirrors the sales-order create_proforma flow).
      if (stage === "create_proforma")
        return { to: "/app/proformas", search: { createFromPo: id, side: "purchase" } };
      // After approval the next steps are downstream documents, not the PO.
      // Carry the linked purchase proforma (if the backend attached it) so
      // the invoice form opens with PO + proforma already linked.
      if (stage === "record_supplier_invoice") {
        const pfId = linkedDocId(t, "proforma");
        return {
          to: "/app/purchases",
          search: pfId ? { createFromPo: id, createFromPf: pfId } : { createFromPo: id },
        };
      }
      if (stage === "await_goods" || stage === "create_grn")
        return { to: "/app/grn", search: { createFromPo: id } };
      // Draft submission, checker approval and supplier follow-up all happen on
      // the purchase order itself.
      return { to: "/app/purchase-orders", search: { poId: id } };
    case "purchase_invoice": {
      if (stage === "await_goods" || stage === "create_grn")
        return { to: "/app/grn", search: { createFromPo: linkedDocId(t, "purchase_order") ?? "" } };
      // Verify / checker / payment stages re-open the same invoice so the
      // proforma + PO links stay visible instead of a bare list.
      const poId = linkedDocId(t, "purchase_order");
      const pfId = linkedDocId(t, "proforma");
      if (poId || pfId) {
        const search: Record<string, string> = { openInvoice: id };
        if (poId) search.createFromPo = poId;
        if (pfId) search.createFromPf = pfId;
        return { to: "/app/purchases", search };
      }
      return { to: "/app/purchases", search: { openInvoice: id } };
    }
    case "grn":
      // Open the receipt itself so it can be confirmed / over-received.
      return { to: "/app/grn", search: { grnId: id } };
    case "dispatch":
      // Open the dispatch itself (packing, EWB, confirm handoff).
      return { to: "/app/dispatches", search: { dispatchId: id } };
    case "payment":
      return { to: "/app/queue" };
    default:
      return { to: "/app/dashboard" };
  }
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return `${fmtDate(iso)} · ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

type FilterKey = "mine" | "pending" | "due_today" | "overdue" | "rejected" | "completed";

const FILTERS: Array<{ key: FilterKey; label: string; icon: any }> = [
  { key: "mine", label: "Assigned to me", icon: Inbox },
  { key: "pending", label: "Pending", icon: ListTodo },
  { key: "due_today", label: "Due today", icon: Clock },
  { key: "overdue", label: "Overdue", icon: AlertTriangle },
  { key: "rejected", label: "Rejected", icon: Send },
  { key: "completed", label: "Completed", icon: CheckCheck },
];

function todayYMD(): string {
  return new Date().toISOString().slice(0, 10);
}

export function TasksPage() {
  const { user, isAdmin, isTreasury, isOperations, isChecker, roles } = useAuth();
  const [filter, setFilter] = useState<FilterKey>("pending");
  const [search, setSearch] = useState("");
  const [wfType, setWfType] = useState<string>("all");
  const [roleQueue, setRoleQueue] = useState<string>("all");
  // Task-modals opened from the "Open Task" button.
  const [openModal, setOpenModal] = useState<{
    kind: "tally_create_confirm" | "record_irn_ewb";
    id: string;
  } | null>(null);

  const openQ = useQuery({
    queryKey: ["workflow-tasks", "open"],
    queryFn: () => api.workflowTasks.list({ status: "open" }),
    refetchInterval: 60_000,
  });

  // Completed tasks load only when that filter is active.
  const doneQ = useQuery({
    queryKey: ["workflow-tasks", "done"],
    queryFn: () => api.workflowTasks.list({ status: "done" }),
    enabled: filter === "completed",
  });

  // Colleagues for @mentions in the task detail drawer.
  const colleaguesQ = useQuery({
    queryKey: ["admin-users-for-queue"],
    queryFn: () => api.admin.users(),
    staleTime: 5 * 60_000,
  });

  const allTasks: Task[] = (openQ.data ?? []) as Task[];
  const doneTasks: Task[] = (doneQ.data ?? []) as Task[];

  // Department queues present in the data — role filter dropdown.
  const roleOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of allTasks) set.add(t.owner_role);
    return Array.from(set).sort();
  }, [allTasks]);

  const myEmail = user?.email ?? "";
  const myRoles = roles ?? [];

  const counts = useMemo(() => {
    const today = todayYMD();
    return {
      mine: allTasks.filter((t) => t.assigned_user === myEmail || t.assigned_user === user?.id)
        .length,
      pending: allTasks.length,
      due_today: allTasks.filter((t) => (t.due_date ?? "").slice(0, 10) === today).length,
      overdue: allTasks.filter(
        (t) => t.overdue || ((t.due_date ?? "") && (t.due_date ?? "") < today),
      ).length,
      rejected: allTasks.filter(
        (t) =>
          t.doc_status === "rejected" ||
          (t.latest_update ?? "").toLowerCase().includes("reject") ||
          (t.stage === "stock_check" && (t.latest_update ?? "").toLowerCase().includes("re-check")),
      ).length,
      completed: doneTasks.length,
    } as Record<FilterKey, number>;
  }, [allTasks, doneTasks, myEmail, user?.id]);

  const filtered = useMemo(() => {
    const today = todayYMD();
    let list = filter === "completed" ? doneTasks : allTasks;
    if (filter === "mine") {
      list = list.filter((t) => t.assigned_user === myEmail || t.assigned_user === user?.id);
    } else if (filter === "due_today") {
      list = list.filter((t) => (t.due_date ?? "").slice(0, 10) === today);
    } else if (filter === "overdue") {
      list = list.filter((t) => t.overdue || ((t.due_date ?? "") && (t.due_date ?? "") < today));
    } else if (filter === "rejected") {
      list = list.filter(
        (t) =>
          t.doc_status === "rejected" ||
          (t.latest_update ?? "").toLowerCase().includes("reject") ||
          (t.stage === "stock_check" && (t.latest_update ?? "").toLowerCase().includes("re-check")),
      );
    }
    if (wfType !== "all") list = list.filter((t) => t.workflow_type === wfType);
    if (roleQueue !== "all") list = list.filter((t) => t.owner_role === roleQueue);
    const s = search.trim().toLowerCase();
    if (s) {
      list = list.filter(
        (t) =>
          (t.doc_number ?? "").toLowerCase().includes(s) ||
          (t.counterparty ?? "").toLowerCase().includes(s) ||
          t.required_action.toLowerCase().includes(s) ||
          (t.latest_update ?? "").toLowerCase().includes(s),
      );
    }
    return list;
  }, [filter, allTasks, doneTasks, wfType, roleQueue, search, myEmail, user?.id]);

  const isLoading = filter === "completed" ? doneQ.isLoading : openQ.isLoading;

  return (
    <>
      <div>
        <PageHeader
          eyebrow="Workflows"
          title="Workflow Queue"
          description="Every pending task across Sales, Purchase, Finance, Treasury, Warehouse and Dispatch — your tasks first."
          icon={<ListTodo className="h-5 w-5" />}
          actions={
            <button
              onClick={() => {
                openQ.refetch();
                if (filter === "completed") doneQ.refetch();
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:border-primary hover:text-primary"
            >
              <Loader2
                className={openQ.isFetching ? "h-3.5 w-3.5 animate-spin" : "hidden h-3.5 w-3.5"}
              />
              Refresh
            </button>
          }
        />

        <div className="space-y-4 p-6 md:p-10">
          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map((f) => {
              const Icon = f.icon;
              const active = filter === f.key;
              const n = counts[f.key];
              return (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {f.label}
                  <span
                    className={`ml-0.5 rounded-full px-1.5 text-[10px] ${
                      active ? "bg-primary/20" : "bg-muted"
                    }`}
                  >
                    {n}
                  </span>
                </button>
              );
            })}

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <select
                value={wfType}
                onChange={(e) => setWfType(e.target.value)}
                className="rounded-md border border-border bg-card px-2 py-1.5 text-xs"
              >
                <option value="all">All workflows</option>
                {Object.entries(WF_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <select
                value={roleQueue}
                onChange={(e) => setRoleQueue(e.target.value)}
                className="rounded-md border border-border bg-card px-2 py-1.5 text-xs"
              >
                <option value="all">All queues</option>
                {roleOptions.map((r) => (
                  <option key={r} value={r}>
                    {r.charAt(0).toUpperCase() + r.slice(1)} queue
                  </option>
                ))}
              </select>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search doc no., customer, action…"
                  className="w-72 max-w-full rounded-md border border-border bg-card py-2 pl-8 pr-3 text-sm outline-none focus:border-primary"
                />
              </div>
            </div>
          </div>

          {/* Task list */}
          {isLoading ? (
            <Card>
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading queue…
              </div>
            </Card>
          ) : filtered.length === 0 ? (
            <Card>
              <EmptyState
                icon={<CheckCheck className="h-8 w-8" />}
                title="Nothing here"
                description={
                  filter === "completed"
                    ? "No completed tasks yet."
                    : "No tasks match this filter — the queue is clear."
                }
              />
            </Card>
          ) : (
            <div className="space-y-2">
              {filtered.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  done={filter === "completed"}
                  onOpenModal={setOpenModal}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {openModal && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setOpenModal(null)}
        >
          <div
            className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-xl border border-border bg-card shadow-vault"
            onClick={(e) => e.stopPropagation()}
          >
            {openModal.kind === "tally_create_confirm" && (
              <TallyCreateConfirmModal
                id={openModal.id}
                onClose={() => setOpenModal(null)}
                onDone={() => setOpenModal(null)}
              />
            )}
            {openModal.kind === "record_irn_ewb" && (
              <RecordIrnEwbModal
                id={openModal.id}
                onClose={() => setOpenModal(null)}
                onDone={() => setOpenModal(null)}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}

function TaskRow({
  task: t,
  done,
  onOpenModal,
}: {
  task: Task;
  done: boolean;
  onOpenModal: (v: { kind: "tally_create_confirm" | "record_irn_ewb"; id: string }) => void;
}) {
  const overdue = t.overdue || (!!t.due_date && t.due_date < todayYMD());
  const dueToday = (t.due_date ?? "").slice(0, 10) === todayYMD();

  const diffMs = Date.now() - new Date(t.created_at).getTime();
  const diffDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  const ageStr = diffDays === 0 ? "<1d" : `${diffDays}d`;

  const stageLower = (t.stage ?? "").toLowerCase();
  let actionLabel = "Open";
  if (
    stageLower.includes("approve") ||
    stageLower.includes("review") ||
    stageLower.includes("checker")
  )
    actionLabel = "Approve";
  else if (stageLower.includes("record") || stageLower.includes("generate")) actionLabel = "Record";
  else if (stageLower.includes("confirm")) actionLabel = "Confirm";

  const target = taskTarget(t);

  return (
    <div
      className={`rounded-lg border bg-card p-4 transition-colors ${
        overdue ? "border-destructive/40" : "border-border hover:border-primary/40"
      }`}
    >
      <div className="flex flex-wrap items-start gap-3">
        {/* Priority + doc identity */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                PRIORITY_TONE[t.priority] ?? PRIORITY_TONE.normal
              }`}
            >
              {t.priority}
            </span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
              {WF_TYPE_LABELS[t.workflow_type] ?? t.workflow_type}
            </span>
            <span className="font-mono text-sm font-semibold">
              {t.doc_number ?? t.doc_id.slice(0, 8)}
            </span>
            {overdue && (
              <span className="inline-flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                <AlertTriangle className="h-3 w-3" /> Overdue
              </span>
            )}
            {!overdue && dueToday && (
              <span className="rounded bg-sem-attention/10 px-1.5 py-0.5 text-[10px] font-medium text-sem-attention">
                Due today
              </span>
            )}
            {done && <StatusPill status="approved" label="Completed" />}
          </div>

          <div className="mt-1.5">
            <p className="text-sm font-medium">{t.required_action}</p>
            <p className="text-xs text-muted-foreground">
              {t.counterparty ? `${t.counterparty} · ` : ""}
              {t.owner_role.charAt(0).toUpperCase() + t.owner_role.slice(1)} queue
              {t.next_action ? ` → next: ${t.next_action}` : ""}
            </p>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {t.latest_update && <span className="truncate italic">Latest: {t.latest_update}</span>}
            {t.latest_update && <span>&bull;</span>}
            <span className={overdue ? "text-destructive font-medium" : ""}>
              {ageStr} in {t.required_action}
            </span>
          </div>
        </div>

        {/* Amount + due + action */}
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {t.amount != null && t.amount > 0 && (
            <span className="inline-flex items-center gap-1 text-sm font-semibold num">
              <IndianRupee className="h-3.5 w-3.5 text-muted-foreground" />
              {fmtMoney(t.amount)}
            </span>
          )}
          {t.due_date && (
            <span
              className={`text-xs ${overdue ? "font-medium text-destructive" : "text-muted-foreground"}`}
            >
              Due {fmtDate(t.due_date)}
            </span>
          )}
          {target.modal ? (
            <button
              onClick={() => onOpenModal({ kind: target.modal!, id: target.id! })}
              className="inline-flex items-center gap-1 rounded-md border border-primary/50 bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              {actionLabel}
            </button>
          ) : (
            <Link
              to={target.to!}
              search={target.search as any}
              className="inline-flex items-center gap-1 rounded-md border border-primary/50 bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              {actionLabel}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Confirm the invoice was created in Tally ─────────────────────────
function TallyCreateConfirmModal({
  id,
  onClose,
  onDone,
}: {
  id: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const confirm = useMutation({
    mutationFn: () => api.invoices.confirmTally(id),
    onSuccess: () => {
      setBusy(false);
      toast.success("Confirmed — invoice marked as created in Tally");
      onDone();
    },
    onError: (e: Error) => {
      setBusy(false);
      toast.error(e instanceof Error ? e.message : "Confirm failed");
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-w-md overflow-y-auto rounded-xl border border-border bg-card shadow-vault"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">Create Invoice in Tally</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Download the Tally XML import, import it into Tally, then confirm below.
          </p>
        </div>
        <div className="space-y-4 p-5 text-sm">
          <div className="rounded-md border border-border/60 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Step 1 · Download Tally XML
            </div>
            <button
              onClick={() => api.invoices.downloadTallyXml(id, `${id.slice(0, 8)}.xml`)}
              disabled={busy}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-primary/50 bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Download Tally XML
            </button>
            <p className="mt-1 text-[10px] text-muted-foreground">
              The XML follows Tally ERP 9 import format (voucher, inventory entries, accounting
              entries) and can be imported directly into Tally.
            </p>
          </div>

          <div className="rounded-md border border-border/60 p-3 bg-amber-50/50">
            <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-amber-800">
              Step 2 · Confirm
            </div>
            <p className="text-xs text-muted-foreground">
              Once the voucher is imported in Tally, click "Yes, created in Tally" to close this
              task and open the IRN / e-Way Bill task.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-xs">
              Cancel
            </button>
            <button
              onClick={() => {
                setBusy(true);
                confirm.mutate();
              }}
              disabled={busy || confirm.isPending}
              className="inline-flex items-center gap-2 rounded-[10px] bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-60"
            >
              {confirm.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              Yes, created in Tally
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Record IRN and e-Way Bill from Tally ─────────────────────────────
function RecordIrnEwbModal({
  id,
  onClose,
  onDone,
}: {
  id: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [irn, setIrn] = useState("");
  const [ackNo, setAckNo] = useState("");
  const [ackDate, setAckDate] = useState("");
  const [ewbNumber, setEwbNumber] = useState("");
  const [ewbDate, setEwbDate] = useState("");
  const [busy, setBusy] = useState(false);

  const record = useMutation({
    mutationFn: () =>
      api.invoices.recordIrnEwb(id, {
        irn: irn.trim(),
        ackNo: ackNo.trim() || null,
        ackDate: ackDate.trim() || null,
        ewbNumber: ewbNumber.trim(),
        ewbDate: ewbDate.trim() || null,
      }),
    onSuccess: () => {
      setBusy(false);
      toast.success("IRN and e-Way Bill recorded from Tally — dispatch workflow next");
      onDone();
    },
    onError: (e: Error) => {
      setBusy(false);
      toast.error(e instanceof Error ? e.message : "Record failed");
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-w-md overflow-y-auto rounded-xl border border-border bg-card shadow-vault"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">Record IRN &amp; e-Way Bill from Tally</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Enter the 64-char IRN and e-Way Bill number returned by Tally.
          </p>
        </div>
        <div className="space-y-4 p-5 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">
                  IRN from Tally *
                </span>
                <input
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary"
                  value={irn}
                  onChange={(e) => setIrn(e.target.value)}
                  placeholder="64-character hex IRN"
                  maxLength={64}
                />
              </label>
            </div>
            <div>
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">
                  Ack No.
                </span>
                <input
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary"
                  value={ackNo}
                  onChange={(e) => setAckNo(e.target.value)}
                  placeholder="Acknowledgement number"
                />
              </label>
            </div>
            <div className="col-span-2">
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">
                  Ack Date
                </span>
                <input
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary"
                  type="date"
                  value={ackDate}
                  onChange={(e) => setAckDate(e.target.value)}
                />
              </label>
            </div>
            <div>
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">
                  e-Way Bill number *
                </span>
                <input
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary"
                  value={ewbNumber}
                  onChange={(e) => setEwbNumber(e.target.value)}
                  placeholder="Numeric EWB from Tally"
                />
              </label>
            </div>
            <div>
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">
                  EWB date
                </span>
                <input
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary"
                  type="date"
                  value={ewbDate}
                  onChange={(e) => setEwbDate(e.target.value)}
                />
              </label>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-xs">
              Cancel
            </button>
            <button
              onClick={() => {
                setBusy(true);
                record.mutate();
              }}
              disabled={busy || record.isPending || !irn.trim() || !ewbNumber.trim()}
              className="inline-flex items-center gap-2 rounded-[10px] bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-60"
            >
              {record.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileCheck className="h-3.5 w-3.5" />
              )}
              Record IRN &amp; EWB
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
