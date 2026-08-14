import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtDate } from "@/components/ledger-ui";
import {
  Activity,
  BellRing,
  Check,
  Clock,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  Landmark,
  Lock,
  Package,
  PackageCheck,
  Receipt,
  Search,
  SearchX,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Truck,
  UserRound,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/alerts")({
  component: AlertsPage,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AuditEntry = {
  id: string;
  action: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_name: string | null;
  actor_roles?: string[];
  target: string | null;
  detail?: Record<string, any>;
  created_at: string | null;
};

type AlertItem = {
  id: string;
  type: string;
  severity: string;
  message: string;
  is_read: boolean;
  created_at: string;
  client_id: string | null;
  debtor_id: string | null;
  invoice_id: string | null;
};

type FeedItem =
  | { kind: "alert"; ts: string; alert: AlertItem }
  | { kind: "activity"; ts: string; entry: AuditEntry };

// ---------------------------------------------------------------------------
// Filter vocabulary
// ---------------------------------------------------------------------------

const DOC_TYPE_OPTIONS = [
  { value: "invoice", label: "Invoices" },
  { value: "purchase_invoice", label: "Purchase invoices" },
  { value: "proforma", label: "Proformas" },
  { value: "quotation", label: "Quotations" },
  { value: "grn", label: "GRNs" },
  { value: "dispatch", label: "Dispatches" },
  { value: "stock", label: "Stock movements" },
  { value: "expense", label: "Expenses" },
  { value: "admin", label: "Admin actions" },
  { value: "alert", label: "Risk signals" },
];

const ACTION_OPTIONS = [
  { value: "created", label: "Created" },
  { value: "submitted", label: "Submitted for review" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "disputed", label: "Disputed" },
  { value: "paid", label: "Paid / funded" },
  { value: "verified", label: "Verified" },
  { value: "confirmed", label: "Confirmed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "delivered", label: "Delivered / returned" },
  { value: "admin", label: "Admin actions" },
  { value: "alert", label: "Risk signals" },
];

/** Which document a workflow entry belongs to (used by the type filter). */
function docType(e: AuditEntry): string {
  const a = e.action;
  if (a.startsWith("invoice.")) return "invoice";
  if (a.startsWith("purchase_invoice.")) return "purchase_invoice";
  if (a.startsWith("proforma.")) return "proforma";
  if (a.startsWith("quotation.")) return "quotation";
  if (a.startsWith("grn.")) return "grn";
  if (a.startsWith("dispatch.")) return "dispatch";
  if (a.startsWith("stock.")) return "stock";
  if (a.startsWith("expense.")) return "expense";
  if (a.startsWith("admin.")) return "admin";
  return "other";
}

/** Canonical action bucket (used by the action filter). */
function actionGroup(e: AuditEntry): string {
  if (e.action.startsWith("admin.")) return "admin";
  const part = e.action.split(".")[1] ?? e.action;
  if (part === "created") return "created";
  if (part === "submitted" || part === "issued") return "submitted";
  if (part === "approved") return "approved";
  if (part === "rejected") return "rejected";
  if (part === "disputed") return "disputed";
  if (part === "paid" || part === "payment" || part === "partially_paid" || part === "funded") return "paid";
  if (part === "verified") return "verified";
  if (part === "confirmed") return "confirmed";
  if (part === "cancelled") return "cancelled";
  if (part === "delivered" || part === "returned") return "delivered";
  return "other";
}

// ---------------------------------------------------------------------------
// Activity rendering helpers
// ---------------------------------------------------------------------------

const ROLE_LABELS: Record<string, string> = {
  factor_admin: "Admin",
  checker: "Checker",
  treasury: "Treasury",
  client: "Client",
  sales_rep: "Sales Rep",
  operations: "Operations",
  reporting_manager: "Manager",
};

const ROLE_BADGE_COLORS: Record<string, string> = {
  checker: "border-warning/40 bg-warning/10 text-warning",
  treasury: "border-primary/40 bg-primary/10 text-primary",
  factor_admin: "border-slate-500/40 bg-slate-500/10 text-slate-600 dark:text-slate-300",
  reporting_manager: "border-primary/40 bg-primary-soft text-[#0a4a8a] dark:text-[#63baff]",
};

function roleBadgeClass(roles: string[] | undefined): string {
  const r = roles ?? [];
  const pick =
    r.find((x) => x === "checker") ??
    r.find((x) => x === "treasury") ??
    r.find((x) => x === "factor_admin") ??
    r.find((x) => x === "reporting_manager");
  return pick ? ROLE_BADGE_COLORS[pick] : "border-border bg-muted text-muted-foreground";
}

function primaryRoleLabel(roles: string[] | undefined): string {
  const r = roles ?? [];
  for (const x of ["factor_admin", "checker", "treasury", "reporting_manager", "sales_rep", "operations", "client"]) {
    if (r.includes(x)) return ROLE_LABELS[x] ?? x;
  }
  return "User";
}

function money(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "";
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function refLabel(e: AuditEntry): string {
  return e.detail?.entity_ref || e.target || "";
}

/** Display name of the actor who performed the entry. */
function actorLabel(e: AuditEntry): string {
  return e.actor_name || e.actor_email || "System";
}

function activityMessage(e: AuditEntry): string {
  const ref = refLabel(e);
  const d = e.detail ?? {};
  const amt = money(d.amount ?? d.amount_paid ?? d.amount_received);
  switch (e.action) {
    case "invoice.created": return `Invoice ${ref} was created`;
    case "invoice.issued": return `Invoice ${ref} was submitted for review`;
    case "invoice.approved": return `Invoice ${ref} was approved`;
    case "invoice.rejected": return `Invoice ${ref} was rejected`;
    case "invoice.disputed": return `Invoice ${ref} was marked as disputed`;
    case "invoice.payment": return `Payment of ${amt || "—"} was recorded on ${ref}`;
    case "invoice.cancelled": return `Invoice ${ref} was cancelled`;
    case "purchase_invoice.created": return `Purchase invoice ${ref} was created`;
    case "purchase_invoice.verified": return `Purchase invoice ${ref} was verified`;
    case "purchase_invoice.approved": return `Purchase invoice ${ref} was approved for payment`;
    case "purchase_invoice.partially_paid": return `Purchase invoice ${ref} was partially paid`;
    case "purchase_invoice.paid": return `Purchase invoice ${ref} was paid`;
    case "purchase_invoice.payment": return `Payment of ${amt || "—"} was recorded on purchase invoice ${ref}`;
    case "purchase_invoice.cancelled": return `Purchase invoice ${ref} was cancelled`;
    case "proforma.created": return `Proforma ${ref} was created`;
    case "proforma.submitted": return `Proforma ${ref} was submitted for review`;
    case "proforma.approved": return `Proforma ${ref} was approved`;
    case "proforma.rejected": return `Proforma ${ref} was rejected`;
    case "proforma.funded": return `Proforma ${ref} was funded`;
    case "quotation.submitted": return `Quotation ${ref} was submitted for approval`;
    case "quotation.approved": return `Quotation ${ref} was approved`;
    case "quotation.rejected": return `Quotation ${ref} was rejected`;
    case "grn.confirmed": return `GRN ${ref} was confirmed — stock credited`;
    case "grn.cancelled": return `GRN ${ref} was cancelled`;
    case "dispatch.confirmed": return `Dispatch ${ref} was confirmed — stock debited`;
    case "dispatch.cancelled": return `Dispatch ${ref} was cancelled`;
    case "dispatch.delivered": return `Dispatch ${ref} was marked delivered`;
    case "dispatch.returned": return `Return was recorded on dispatch ${ref}`;
    case "stock.created": return `Stock movement was created for ${ref}`;
    case "stock.confirmed": return `Stock movement ${ref} was confirmed`;
    case "stock.cancelled": return `Stock movement ${ref} was cancelled`;
    case "expense.created": return `Expense ${ref} was created`;
    default:
      if (e.action.startsWith("admin.")) {
        const parts = e.action.split(".").filter(Boolean).slice(1);
        const verb = parts[parts.length - 1]?.replace(/_/g, " ") || "action";
        const subject = parts[parts.length - 2]?.replace(/_/g, " ");
        return `Admin ${verb}${subject ? ` on ${subject}` : ""}`;
      }
      return e.action.replace(/[._]/g, " ").trim();
  }
}

function activityMeta(e: AuditEntry): { icon: LucideIcon; chip: string } {
  const a = e.action;
  if (["invoice.payment", "purchase_invoice.paid", "purchase_invoice.partially_paid", "purchase_invoice.payment", "proforma.funded"].includes(a))
    return { icon: Landmark, chip: "bg-primary/15 text-primary" };
  if (["invoice.approved", "purchase_invoice.approved", "proforma.approved", "quotation.approved"].includes(a))
    return { icon: ShieldCheck, chip: "bg-primary-soft text-[#0a4a8a] dark:text-[#63baff]" };
  if (["invoice.rejected", "proforma.rejected", "quotation.rejected"].includes(a))
    return { icon: ShieldX, chip: "bg-destructive/15 text-destructive" };
  if (a === "invoice.disputed") return { icon: ShieldAlert, chip: "bg-warning/15 text-warning" };
  if (a.startsWith("invoice.")) return { icon: Receipt, chip: "bg-primary/15 text-primary" };
  if (a.startsWith("purchase_invoice.")) return { icon: FileSpreadsheet, chip: "bg-primary/15 text-primary" };
  if (a.startsWith("proforma.")) return { icon: FileText, chip: "bg-primary/15 text-primary" };
  if (a.startsWith("quotation.")) return { icon: FileCheck2, chip: "bg-primary/15 text-primary" };
  if (a.startsWith("grn.")) return { icon: PackageCheck, chip: "bg-primary/15 text-primary" };
  if (a.startsWith("dispatch.")) return { icon: Truck, chip: "bg-warning/15 text-warning" };
  if (a.startsWith("stock.")) return { icon: Package, chip: "bg-primary/15 text-primary" };
  if (a.startsWith("expense.")) return { icon: Wallet, chip: "bg-muted text-muted-foreground" };
  if (a.startsWith("admin.")) return { icon: Shield, chip: "bg-slate-500/15 text-slate-600 dark:text-slate-400" };
  return { icon: Activity, chip: "bg-muted text-muted-foreground" };
}

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Math.max(0, Date.now() - then);
  if (diff < 60_000) return "just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return fmtDate(iso);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function AlertsPage() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();

  const [search, setSearch] = useState("");
  const [userFilter, setUserFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");

  const alertsQ = useQuery({
    queryKey: ["alerts", "all"],
    queryFn: async () => {
      const data = await api.alerts.list();
      return (data ?? []).reverse();
    },
  });

  const activityQ = useQuery({
    queryKey: ["audit", "activity"],
    queryFn: () => api.audit.activity(),
    enabled: isAdmin,
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await api.alerts.markRead(id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const alerts = (alertsQ.data ?? []) as AlertItem[];
  const activity = (activityQ.data ?? []) as AuditEntry[];

  const feed: FeedItem[] = [
    ...alerts.map((a) => ({ kind: "alert" as const, ts: a.created_at ?? "", alert: a })),
    ...activity.map((e) => ({ kind: "activity" as const, ts: e.created_at ?? "", entry: e })),
  ].sort((a, b) => b.ts.localeCompare(a.ts));

  // Unique actors for the user dropdown (activity entries only).
  const users = useMemo(() => {
    const set = new Set<string>();
    for (const e of activity) set.add(actorLabel(e));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [activity]);

  const filtered = useMemo(() => {
    let list = feed;

    if (search) {
      const s = search.toLowerCase();
      list = list.filter((item) => {
        if (item.kind === "activity") {
          const e = item.entry;
          return (
            activityMessage(e).toLowerCase().includes(s) ||
            actorLabel(e).toLowerCase().includes(s) ||
            refLabel(e).toLowerCase().includes(s)
          );
        }
        return (
          item.alert.message.toLowerCase().includes(s) ||
          item.alert.type.toLowerCase().includes(s)
        );
      });
    }

    if (userFilter !== "all") {
      list = list.filter(
        (item) => item.kind === "activity" && actorLabel(item.entry) === userFilter,
      );
    }

    if (typeFilter !== "all") {
      list = list.filter((item) =>
        item.kind === "activity" ? docType(item.entry) === typeFilter : "alert" === typeFilter,
      );
    }

    if (actionFilter !== "all") {
      list = list.filter((item) =>
        item.kind === "activity" ? actionGroup(item.entry) === actionFilter : "alert" === actionFilter,
      );
    }

    return list;
  }, [feed, search, userFilter, typeFilter, actionFilter]);

  const unread = alerts.filter((a) => !a.is_read).length;
  const loading = alertsQ.isLoading || (isAdmin && activityQ.isLoading);
  const hasFilters = !!(search || userFilter !== "all" || typeFilter !== "all" || actionFilter !== "all");

  const clearFilters = () => {
    setSearch("");
    setUserFilter("all");
    setTypeFilter("all");
    setActionFilter("all");
  };

  const selectClass =
    "rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-foreground/30";

  return (
    <div>
      <PageHeader
        eyebrow="Surveillance"
        title="Alerts"
        description="A live audit trail of every action across the business — who did what, and when — alongside risk signals that need your attention."
        icon={<BellRing className="h-5 w-5" />}
        actions={
          <span className="rounded-full border border-border px-3 py-1 text-xs">
            <span className="num text-primary">{unread}</span> unread
          </span>
        }
      />
      <div className="p-6 md:p-10">
        {!isAdmin && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5 shrink-0" />
            The full workflow audit trail is visible to admins. You're seeing risk signals only.
          </div>
        )}

        {/* ── Filter bar ── */}
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search messages, users, document references…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-8 text-sm outline-none transition-colors focus:border-foreground/30 focus:ring-1 focus:ring-foreground/10"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {isAdmin && (
            <>
              <select
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value)}
                className={selectClass}
                aria-label="Filter by user"
              >
                <option value="all">All users</option>
                {users.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>

              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className={selectClass}
                aria-label="Filter by document type"
              >
                <option value="all">All documents</option>
                {DOC_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>

              <select
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
                className={selectClass}
                aria-label="Filter by action"
              >
                <option value="all">All actions</option>
                {ACTION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>

              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <X className="h-3.5 w-3.5" /> Clear
                </button>
              )}
            </>
          )}
        </div>

        <Card>
          {loading ? (
            <div className="space-y-4 p-6">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex animate-pulse items-center gap-4">
                  <div className="h-8 w-8 rounded-full bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-2/3 rounded bg-muted" />
                    <div className="h-2.5 w-1/3 rounded bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {feed.length === 0 ? (
                <>
                  <BellRing className="mx-auto mb-3 h-6 w-6" />
                  No alerts. The vault is quiet.
                </>
              ) : (
                <>
                  <SearchX className="mx-auto mb-3 h-6 w-6" />
                  <p className="font-medium text-foreground">No events match your filters</p>
                  <button
                    onClick={clearFilters}
                    className="mt-2 text-xs text-primary underline-offset-4 hover:underline"
                  >
                    Clear filters
                  </button>
                </>
              )}
            </div>
          ) : (
            <>
              <ul className="divide-y divide-border">
                {filtered.map((item) =>
                  item.kind === "activity" ? (
                    <ActivityRow key={`a-${item.entry.id}`} entry={item.entry} />
                  ) : (
                    <AlertRow
                      key={`s-${item.alert.id}`}
                      alert={item.alert}
                      onMarkRead={(id) => markRead.mutate(id)}
                    />
                  ),
                )}
              </ul>
              <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
                <span>
                  Showing {filtered.length} of {feed.length} events
                </span>
                {hasFilters && (
                  <button
                    onClick={clearFilters}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    Reset filters
                  </button>
                )}
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function AlertRow({ alert, onMarkRead }: { alert: AlertItem; onMarkRead: (id: string) => void }) {
  return (
    <li className={`flex items-start gap-4 p-4 ${alert.is_read ? "opacity-60" : ""}`}>
      <span
        className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
          alert.severity === "critical"
            ? "bg-destructive"
            : alert.severity === "warning"
              ? "bg-warning"
              : "bg-primary"
        }`}
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm">{alert.message}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] uppercase tracking-widest text-muted-foreground">
          <BellRing className="h-3 w-3" />
          <span>{alert.type}</span>
          <span>·</span>
          <span>{alert.severity}</span>
          <span>·</span>
          <span className="normal-case" title={fmtDate(alert.created_at)}>
            {relativeTime(alert.created_at)}
          </span>
        </div>
      </div>
      {!alert.is_read && (
        <button
          onClick={() => onMarkRead(alert.id)}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted"
        >
          <Check className="h-3 w-3" /> Mark read
        </button>
      )}
    </li>
  );
}

function ActivityRow({ entry }: { entry: AuditEntry }) {
  const { icon: Icon, chip } = activityMeta(entry);
  const roles = entry.actor_roles ?? [];
  return (
    <li className="flex items-start gap-4 p-4">
      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${chip}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm">{activityMessage(entry)}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1 font-medium text-foreground/80">
            <UserRound className="h-3 w-3" />
            {actorLabel(entry)}
          </span>
          {roles.length > 0 && (
            <span className={`rounded-full border px-2 py-px text-[10px] font-medium ${roleBadgeClass(roles)}`}>
              {primaryRoleLabel(roles)}
            </span>
          )}
          <span
            className="inline-flex items-center gap-1"
            title={entry.created_at ? fmtDate(entry.created_at) : undefined}
          >
            <Clock className="h-3 w-3" />
            {relativeTime(entry.created_at)}
          </span>
        </div>
      </div>
    </li>
  );
}
