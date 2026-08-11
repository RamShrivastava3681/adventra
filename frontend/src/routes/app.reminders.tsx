import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import api from "@/lib/api-client";
import {
  BellRing,
  Send,
  Mail,
  Clock,
  CheckCircle,
  XCircle,
  X,
  Filter,
  Search,
  CalendarDays,
  ArrowUpDown,
  FileText,
  Download,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Play,
  Loader2,
} from "lucide-react";
import { PageHeader } from "@/components/ledger-ui";

export const Route = createFileRoute("/app/reminders")({
  component: RemindersPage,
});

interface ReminderLog {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  type: "sales" | "purchase";
  recipient: "admin" | "debtor";
  recipientEmail: string;
  sentAt: string;
  daysUntilDue: number;
  isOverdue: boolean;
  status: "sent" | "failed";
  counterpartyName: string;
}

// ─── Helpers ─────────────────────────────────────────────

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function fmtDateTime(iso: string) {
  return `${fmtDate(iso)} ${fmtTime(iso)}`;
}

function daysAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

// ─── Stat Card ───────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: any;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 transition-all duration-200 hover:shadow-md hover:border-foreground/20">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60 font-medium">
            {label}
          </div>
          <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
          {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
        </div>
        <div className={`rounded-lg p-2.5 ${color}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

// ─── Badge ───────────────────────────────────────────────

function Badge({
  variant,
  children,
}: {
  variant: "sales" | "purchase" | "admin" | "debtor" | "sent" | "failed" | "overdue" | "upcoming";
  children: React.ReactNode;
}) {
  const styles: Record<string, string> = {
    sales:
      "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800/40",
    purchase:
      "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-400 dark:border-purple-800/40",
    admin:
      "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
    debtor:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800/40",
    sent: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800/40",
    failed:
      "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800/40",
    overdue:
      "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800/40",
    upcoming:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800/40",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${styles[variant] || styles.sales}`}
    >
      {children}
    </span>
  );
}

// ─── Run All Reminders Button ────────────────────────────

function RunAllButton() {
  const qc = useQueryClient();
  const runAll = useMutation({
    mutationFn: () => api.reminders.runAll(),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["reminder-logs"] });
      toast.success(`Reminder run complete: ${data.checked} checked, ${data.sent} sent`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to run reminders"),
  });

  return (
    <button
      onClick={() => runAll.mutate()}
      disabled={runAll.isPending}
      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90 disabled:opacity-50"
    >
      {runAll.isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Play className="h-4 w-4" />
      )}
      {runAll.isPending ? "Running…" : "Run All Reminders"}
    </button>
  );
}

// ─── Manual Reminder Section (Button that opens an invoice selector) ─────

function ManualReminderSection() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium transition-all hover:bg-accent hover:text-accent-foreground"
      >
        <Send className="h-4 w-4" />
        Send Reminder
      </button>

      {open && <InvoiceReminderModal onClose={() => setOpen(false)} />}
    </>
  );
}

// ─── Invoice Reminder Modal ──────────────────────────────

function InvoiceReminderModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"sales" | "purchase">("sales");
  const [searchInv, setSearchInv] = useState("");

  // Fetch unpaid invoices that could use reminders
  const invoicesQ = useQuery({
    queryKey: ["invoices", "list"],
    queryFn: () => api.invoices.list(),
  });

  const purchasesQ = useQuery({
    queryKey: ["purchase-invoices", "list"],
    queryFn: () => api.purchaseInvoices.list(),
  });

  const unpaidInvoices = useMemo(() => {
    const data = mode === "sales" ? (invoicesQ.data ?? []) : (purchasesQ.data ?? []);
    const unpaid = data.filter(
      (i: any) =>
        i.status !== "paid" && i.status !== "rejected" && i.status !== "cancelled" && i.due_date,
    );
    // Sort by due date (most urgent first)
    unpaid.sort((a: any, b: any) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));

    if (searchInv) {
      const s = searchInv.toLowerCase();
      return unpaid.filter(
        (i: any) =>
          i.invoice_number?.toLowerCase().includes(s) ||
          (i.debtor?.name ?? "").toLowerCase().includes(s) ||
          (i.vendor?.name ?? "").toLowerCase().includes(s),
      );
    }
    return unpaid;
  }, [invoicesQ.data, purchasesQ.data, mode, searchInv]);

  const sendReminder = useMutation({
    mutationFn: async (invoiceId: string) => {
      if (mode === "sales") {
        return api.reminders.send(invoiceId);
      } else {
        return api.reminders.sendPurchase(invoiceId);
      }
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["reminder-logs"] });
      toast.success(data.message || "Reminder sent successfully");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to send reminder"),
  });

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-xl overflow-y-auto rounded-xl border border-border bg-card shadow-vault"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">Send Reminder Manually</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Mode toggle */}
          <div className="rounded-md border border-border bg-background/40 p-1 grid grid-cols-2 gap-1">
            {(["sales", "purchase"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setSearchInv("");
                }}
                className={`rounded-md px-3 py-2 text-xs uppercase tracking-widest transition ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {m === "sales" ? "Sales Invoices" : "Purchase Invoices"}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder={`Search ${mode === "sales" ? "debtor" : "vendor"} or invoice number…`}
              value={searchInv}
              onChange={(e) => setSearchInv(e.target.value)}
              className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm outline-none focus:border-foreground/30 focus:ring-1 focus:ring-foreground/10 transition-colors"
            />
          </div>

          {/* Invoice list */}
          <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
            {(mode === "sales" ? invoicesQ.isLoading : purchasesQ.isLoading) ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 mx-auto mb-2 animate-spin" />
                Loading {mode === "sales" ? "invoices" : "purchase invoices"}…
              </div>
            ) : unpaidInvoices.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                <CheckCircle className="h-6 w-6 mx-auto mb-3 opacity-30" />
                <p>No unpaid {mode === "sales" ? "invoices" : "purchase invoices"} found.</p>
              </div>
            ) : (
              unpaidInvoices.slice(0, 50).map((inv: any) => {
                const dud = inv.due_date
                  ? Math.round((new Date(inv.due_date).getTime() - Date.now()) / 86400000)
                  : 0;
                const isOverdue = dud < 0;
                const counterpartyName = inv.debtor?.name ?? inv.vendor?.name ?? "—";
                const sending = sendReminder.isPending && sendReminder.variables === inv.id;
                return (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between rounded-lg border border-border p-3 transition-all hover:bg-muted/30"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium">{inv.invoice_number}</span>
                        <span className="text-xs text-muted-foreground">·</span>
                        <span className="text-xs text-muted-foreground truncate">
                          {counterpartyName}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-muted-foreground">
                          Due: {fmtDate(inv.due_date)}
                        </span>
                        <span
                          className={`text-xs font-medium ${isOverdue ? "text-destructive" : "text-amber-600"}`}
                        >
                          {isOverdue
                            ? `${Math.abs(dud)}d overdue`
                            : dud === 0
                              ? "Due today"
                              : `${dud}d left`}
                        </span>
                        <span className="text-xs font-medium num">
                          ${Number(inv.amount || 0).toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => sendReminder.mutate(inv.id)}
                      disabled={sendReminder.isPending}
                      className={`ml-3 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                        sending
                          ? "bg-muted text-muted-foreground"
                          : isOverdue
                            ? "bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/30"
                            : "bg-primary/10 text-primary hover:bg-primary/20 border border-primary/30"
                      }`}
                    >
                      {sending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Send className="h-3 w-3" />
                      )}
                      {sending ? "Sending…" : "Send Reminder"}
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <p className="text-[10px] text-muted-foreground text-center pt-2 border-t border-border">
            Showing up to 50 invoices sorted by urgency (closest due first). Instant reminders are
            also triggered automatically when invoices are created or updated.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────

function RemindersPage() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "sales" | "purchase">("all");
  const [recipientFilter, setRecipientFilter] = useState<"all" | "admin" | "debtor">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "sent" | "failed">("all");
  const [sortField, setSortField] = useState<"sentAt" | "invoiceNumber" | "type" | "daysUntilDue">(
    "sentAt",
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const q = useQuery({
    queryKey: ["reminder-logs"],
    queryFn: () => api.reminderLogs.list(),
    refetchInterval: 60_000, // auto-refresh every 60s
  });

  const logs = useMemo(() => {
    const data = (q.data ?? []) as ReminderLog[];

    // Filter
    let filtered = data;
    if (search) {
      const s = search.toLowerCase();
      filtered = filtered.filter(
        (l) =>
          (l.invoiceNumber ?? "").toLowerCase().includes(s) ||
          (l.counterpartyName ?? "").toLowerCase().includes(s) ||
          (l.recipientEmail ?? "").toLowerCase().includes(s) ||
          (l.invoiceId ?? "").toLowerCase().includes(s),
      );
    }
    if (typeFilter !== "all") filtered = filtered.filter((l) => l.type === typeFilter);
    if (recipientFilter !== "all")
      filtered = filtered.filter((l) => l.recipient === recipientFilter);
    if (statusFilter !== "all") filtered = filtered.filter((l) => l.status === statusFilter);

    // Sort
    filtered.sort((a, b) => {
      let cmp = 0;
      if (sortField === "sentAt") cmp = (a.sentAt ?? "").localeCompare(b.sentAt ?? "");
      else if (sortField === "invoiceNumber")
        cmp = (a.invoiceNumber ?? "").localeCompare(b.invoiceNumber ?? "");
      else if (sortField === "type") cmp = (a.type ?? "").localeCompare(b.type ?? "");
      else if (sortField === "daysUntilDue") cmp = (a.daysUntilDue ?? 0) - (b.daysUntilDue ?? 0);
      return sortDir === "desc" ? -cmp : cmp;
    });

    return filtered;
  }, [q.data, search, typeFilter, recipientFilter, statusFilter, sortField, sortDir]);

  // Summary stats
  const stats = useMemo(() => {
    const data = (q.data ?? []) as ReminderLog[];
    return {
      total: data.length,
      sent: data.filter((l) => l.status === "sent").length,
      failed: data.filter((l) => l.status === "failed").length,
      debtors: data.filter((l) => l.recipient === "debtor" && l.status === "sent").length,
      overdue: data.filter((l) => l.isOverdue).length,
      today: data.filter((l) => (l.sentAt ?? "").startsWith(new Date().toISOString().slice(0, 10)))
        .length,
    };
  }, [q.data]);

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortField(field);
      setSortDir(field === "sentAt" ? "desc" : "asc");
    }
  };

  const SortIcon = ({ field }: { field: typeof sortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 opacity-30" />;
    return (
      <ArrowUpDown className={`h-3 w-3 ${sortDir === "asc" ? "rotate-180" : ""} text-foreground`} />
    );
  };

  return (
    <div>
      {/* ── Page Header ── */}
      <PageHeader
        eyebrow="Invoice Reminders"
        title="Reminder History"
        description="Audit trail of every invoice reminder sent — to admins and debtors. Reminders are also sent instantly when invoices are created or updated."
        icon={<Mail className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <ManualReminderSection />
            <RunAllButton />
          </div>
        }
      />

      {/* ── Stats Grid ── */}
      <div className="px-6 pt-6 md:px-10">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard
            icon={BellRing}
            label="Total Reminders"
            value={stats.total}
            color="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
          />
          <StatCard
            icon={CheckCircle}
            label="Delivered"
            value={stats.sent}
            sub={
              stats.total > 0
                ? `${Math.round((stats.sent / stats.total) * 100)}% success`
                : undefined
            }
            color="bg-emerald-100 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400"
          />
          <StatCard
            icon={XCircle}
            label="Failed"
            value={stats.failed}
            sub={stats.failed > 0 ? "Check SMTP config" : undefined}
            color="bg-red-100 text-red-600 dark:bg-red-950/30 dark:text-red-400"
          />
          <StatCard
            icon={Send}
            label="To Debtors"
            value={stats.debtors}
            color="bg-amber-100 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400"
          />
          <StatCard
            icon={TrendingUp}
            label="Overdue Alerts"
            value={stats.overdue}
            color="bg-orange-100 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400"
          />
          <StatCard
            icon={Clock}
            label="Sent Today"
            value={stats.today}
            color="bg-blue-100 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400"
          />
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="px-6 pt-6 pb-2 md:px-10">
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search invoices, debtors, emails…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm outline-none focus:border-foreground/30 focus:ring-1 focus:ring-foreground/10 transition-colors"
            />
          </div>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as any)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30 transition-colors"
          >
            <option value="all">All types</option>
            <option value="sales">Sales invoices</option>
            <option value="purchase">Purchase invoices</option>
          </select>

          <select
            value={recipientFilter}
            onChange={(e) => setRecipientFilter(e.target.value as any)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30 transition-colors"
          >
            <option value="all">All recipients</option>
            <option value="admin">Admin only</option>
            <option value="debtor">Debtor only</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30 transition-colors"
          >
            <option value="all">All statuses</option>
            <option value="sent">Sent only</option>
            <option value="failed">Failed only</option>
          </select>

          <button
            onClick={() => q.refetch()}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
            title="Refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${q.isFetching ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="px-6 pb-6 pt-3 md:px-10">
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {q.isLoading ? (
            <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Loading reminder history…
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-sm text-muted-foreground">
              <BellRing className="h-6 w-6 mb-3 opacity-20" />
              <p className="font-medium">No reminders found</p>
              <p className="text-xs mt-1">
                Reminders will appear here once the scheduler sends them.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-5 py-3 text-left">
                      <button
                        onClick={() => toggleSort("sentAt")}
                        className="inline-flex items-center gap-1 text-xs uppercase tracking-widest text-muted-foreground font-medium hover:text-foreground transition-colors"
                      >
                        <CalendarDays className="h-3 w-3" /> Date <SortIcon field="sentAt" />
                      </button>
                    </th>
                    <th className="px-5 py-3 text-left">
                      <button
                        onClick={() => toggleSort("invoiceNumber")}
                        className="inline-flex items-center gap-1 text-xs uppercase tracking-widest text-muted-foreground font-medium hover:text-foreground transition-colors"
                      >
                        <FileText className="h-3 w-3" /> Invoice <SortIcon field="invoiceNumber" />
                      </button>
                    </th>
                    <th className="px-5 py-3 text-left">
                      <button
                        onClick={() => toggleSort("type")}
                        className="inline-flex items-center gap-1 text-xs uppercase tracking-widest text-muted-foreground font-medium hover:text-foreground transition-colors"
                      >
                        <Filter className="h-3 w-3" /> Type <SortIcon field="type" />
                      </button>
                    </th>
                    <th className="px-5 py-3 text-left text-xs uppercase tracking-widest text-muted-foreground font-medium">
                      Recipient
                    </th>
                    <th className="px-5 py-3 text-left text-xs uppercase tracking-widest text-muted-foreground font-medium">
                      Counterparty
                    </th>
                    <th className="px-5 py-3 text-center">
                      <button
                        onClick={() => toggleSort("daysUntilDue")}
                        className="inline-flex items-center gap-1 text-xs uppercase tracking-widest text-muted-foreground font-medium hover:text-foreground transition-colors"
                      >
                        <Clock className="h-3 w-3" /> Status <SortIcon field="daysUntilDue" />
                      </button>
                    </th>
                    <th className="px-5 py-3 text-center text-xs uppercase tracking-widest text-muted-foreground font-medium">
                      Result
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {logs.map((log) => (
                    <tr key={log.id} className="transition-colors hover:bg-muted/20">
                      <td className="px-5 py-3 whitespace-nowrap">
                        <div className="text-sm font-medium">{fmtDateTime(log.sentAt)}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {daysAgo(log.sentAt)}
                        </div>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <span className="font-mono text-sm font-medium">{log.invoiceNumber}</span>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <Badge variant={log.type}>
                          {log.type === "sales" ? "Sales" : "Purchase"}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <Badge variant={log.recipient}>
                            {log.recipient === "admin" ? "Admin" : "Debtor"}
                          </Badge>
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5 truncate max-w-[180px]">
                          {log.recipientEmail}
                        </div>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <span className="text-sm">{log.counterpartyName}</span>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {log.isOverdue ? (
                            <>
                              <TrendingUp className="h-3.5 w-3.5 text-red-500" />
                              <Badge variant="overdue">{Math.abs(log.daysUntilDue)}d overdue</Badge>
                            </>
                          ) : (
                            <>
                              <TrendingDown className="h-3.5 w-3.5 text-amber-500" />
                              <Badge variant="upcoming">
                                {log.daysUntilDue === 0 ? "Due today" : `${log.daysUntilDue}d left`}
                              </Badge>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-center">
                        <Badge variant={log.status}>
                          {log.status === "sent" ? (
                            <span className="flex items-center gap-1">
                              <CheckCircle className="h-3 w-3" /> Sent
                            </span>
                          ) : (
                            <span className="flex items-center gap-1">
                              <XCircle className="h-3 w-3" /> Failed
                            </span>
                          )}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <span>
              {logs.length} of {(q.data ?? []).length} reminders
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> Sent
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-red-500" /> Failed
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
