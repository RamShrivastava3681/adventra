import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
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

/** Where does this document live in the app? Used by the Open Task button. */
function docAppPath(t: Task): string {
  switch (t.doc_type) {
    case "sales_order":
      return "/app/sales-orders";
    case "sales_invoice":
      return "/app/invoices";
    case "proforma":
      return "/app/proformas";
    case "purchase_order":
      return "/app/purchase-orders";
    case "purchase_invoice":
      return "/app/purchases";
    case "grn":
      return "/app/grn";
    case "dispatch":
      return "/app/dispatches";
    case "payment":
      return "/app/queue";
    default:
      return "/app/dashboard";
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

function TasksPage() {
  const { user, isAdmin, isTreasury, isOperations, isChecker, roles } = useAuth();
  const [filter, setFilter] = useState<FilterKey>("pending");
  const [search, setSearch] = useState("");
  const [wfType, setWfType] = useState<string>("all");
  const [roleQueue, setRoleQueue] = useState<string>("all");

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
      mine: allTasks.filter((t) => t.assigned_user === myEmail || t.assigned_user === user?.id).length,
      pending: allTasks.length,
      due_today: allTasks.filter((t) => (t.due_date ?? "").slice(0, 10) === today).length,
      overdue: allTasks.filter((t) => t.overdue || ((t.due_date ?? "") && (t.due_date ?? "") < today)).length,
      rejected: allTasks.filter(
        (t) =>
          t.doc_status === "rejected" ||
          (t.latest_update ?? "").toLowerCase().includes("reject") ||
          t.stage === "stock_check" && (t.latest_update ?? "").toLowerCase().includes("re-check"),
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
          t.stage === "stock_check" && (t.latest_update ?? "").toLowerCase().includes("re-check"),
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
            <Loader2 className={openQ.isFetching ? "h-3.5 w-3.5 animate-spin" : "hidden h-3.5 w-3.5"} />
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
                <option key={k} value={k}>{v}</option>
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
                className="w-56 rounded-md border border-border bg-card py-1.5 pl-7 pr-2 text-xs outline-none focus:border-primary"
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
              <TaskRow key={t.id} task={t} done={filter === "completed"} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskRow({ task: t, done }: { task: Task; done: boolean }) {
  const overdue = t.overdue || (!!t.due_date && t.due_date < todayYMD());
  const dueToday = (t.due_date ?? "").slice(0, 10) === todayYMD();
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
            <span className="font-mono text-sm font-semibold">{t.doc_number ?? t.doc_id.slice(0, 8)}</span>
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
            {done && (
              <StatusPill status="approved" label="Completed" />
            )}
          </div>

          <div className="mt-1.5">
            <p className="text-sm font-medium">{t.required_action}</p>
            <p className="text-xs text-muted-foreground">
              {t.counterparty ? `${t.counterparty} · ` : ""}
              {t.owner_role.charAt(0).toUpperCase() + t.owner_role.slice(1)} queue
              {t.next_action ? ` → next: ${t.next_action}` : ""}
            </p>
          </div>

          {t.latest_update && (
            <p className="mt-1.5 truncate text-xs italic text-muted-foreground">
              Latest: {t.latest_update}
            </p>
          )}
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
            <span className={`text-xs ${overdue ? "font-medium text-destructive" : "text-muted-foreground"}`}>
              Due {fmtDate(t.due_date)}
            </span>
          )}
          <Link
            to={docAppPath(t)}
            className="inline-flex items-center gap-1 rounded-md border border-primary/50 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10"
          >
            <ExternalLink className="h-3 w-3" /> Open task
          </Link>
        </div>
      </div>
    </div>
  );
}
