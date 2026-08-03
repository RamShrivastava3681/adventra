import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api-client";
import { PageHeader } from "@/components/ledger-ui";
import { toast } from "sonner";
import {
  MapPin, Plane, Receipt, CalendarDays, Plus, Loader2, Trash2,
  Users, UserCircle, TrendingUp, Target, Activity,
  FileText, ShoppingCart, ClipboardCheck, Banknote, Shield,
  AlertCircle, CheckCircle2, XCircle, Building2,
  Mail, Briefcase, DollarSign, BarChart3, Phone
} from "lucide-react";

export const Route = createFileRoute("/app/workspace")({
  validateSearch: (search: Record<string, unknown>) => ({
    viewAsUserId: search.viewAsUserId as string | undefined,
  }),
  component: WorkspacePage,
});

const TABS = [
  { key: "visit", label: "Visits", icon: MapPin },
  { key: "travel", label: "Travel", icon: Plane },
  { key: "expense", label: "Expenses", icon: Receipt },
  { key: "leave", label: "Leave", icon: CalendarDays },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

const ROLE_ICONS: Record<string, any> = {
  sales_rep: Users,
  operations: FileText,
  checker: ClipboardCheck,
  treasury: Banknote,
  reporting_manager: Users,
  factor_admin: Shield,
};

const ROLE_COLORS: Record<string, string> = {
  sales_rep: "bg-blue-100 text-blue-700 border-blue-200",
  operations: "bg-purple-100 text-purple-700 border-purple-200",
  checker: "bg-amber-100 text-amber-700 border-amber-200",
  treasury: "bg-emerald-100 text-emerald-700 border-emerald-200",
  reporting_manager: "bg-rose-100 text-rose-700 border-rose-200",
  factor_admin: "bg-red-100 text-red-700 border-red-200",
};

const ROLE_LABELS: Record<string, string> = {
  sales_rep: "Salesman",
  operations: "Operations",
  checker: "Checker",
  treasury: "Treasury",
  reporting_manager: "Reporting Manager",
  factor_admin: "Admin",
  client: "Client",
};

const STATUS_ICONS: Record<string, any> = {
  pending: AlertCircle,
  approved: CheckCircle2,
  rejected: XCircle,
  new: Target,
  contacted: Phone,
  qualified: TrendingUp,
  won: CheckCircle2,
  lost: XCircle,
};

// ─── Stat Card ──────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, sub, color = "blue" }: {
  icon: any; label: string; value: string | number; sub?: string; color?: string;
}) {
  const colorMap: Record<string, string> = {
    blue: "from-blue-500/10 to-blue-500/5 border-blue-200/50 text-blue-700",
    purple: "from-purple-500/10 to-purple-500/5 border-purple-200/50 text-purple-700",
    amber: "from-amber-500/10 to-amber-500/5 border-amber-200/50 text-amber-700",
    emerald: "from-emerald-500/10 to-emerald-500/5 border-emerald-200/50 text-emerald-700",
    rose: "from-rose-500/10 to-rose-500/5 border-rose-200/50 text-rose-700",
    slate: "from-slate-500/10 to-slate-500/5 border-slate-200/50 text-slate-700",
  };
  const iconBgMap: Record<string, string> = {
    blue: "bg-blue-100 text-blue-600",
    purple: "bg-purple-100 text-purple-600",
    amber: "bg-amber-100 text-amber-600",
    emerald: "bg-emerald-100 text-emerald-600",
    rose: "bg-rose-100 text-rose-600",
    slate: "bg-slate-100 text-slate-600",
  };

  return (
    <div className={`rounded-xl border bg-gradient-to-br p-5 shadow-sm transition-all duration-200 hover:shadow-md ${colorMap[color]}`}>
      <div className="flex items-start justify-between">
        <div className={`rounded-lg p-2.5 ${iconBgMap[color]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div className="mt-4">
        <div className="text-2xl font-bold tracking-tight">{value}</div>
        <div className="mt-0.5 text-xs font-medium opacity-80">{label}</div>
        {sub && <div className="mt-1 text-[10px] opacity-60">{sub}</div>}
      </div>
    </div>
  );
}

// ─── Status Distribution ───────────────────────────────────────
function StatusDist({ data, colorMap }: { data: Record<string, number>; colorMap: Record<string, string> }) {
  const total = Object.values(data).reduce((s, v) => s + v, 0);
  if (total === 0) return <div className="text-[11px] text-muted-foreground/60 italic">No data</div>;

  return (
    <div className="space-y-1.5">
      {Object.entries(data).map(([key, count]) => {
        const pct = ((count / total) * 100).toFixed(0);
        const c = colorMap[key] || "bg-slate-100 text-slate-600";
        const StatusIcon = STATUS_ICONS[key] || AlertCircle;
        return (
          <div key={key} className="flex items-center gap-2">
            <div className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${c}`}>
              <StatusIcon className="h-2.5 w-2.5" />
              <span className="capitalize">{key}</span>
            </div>
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-current opacity-40 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[11px] font-medium tabular-nums text-muted-foreground">{count}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Section Card ──────────────────────────────────────────────
function SectionCard({ title, icon: Icon, color = "blue", children }: {
  title: string; icon: any; color?: string; children: React.ReactNode;
}) {
  const borderMap: Record<string, string> = {
    blue: "border-blue-200/50",
    purple: "border-purple-200/50",
    amber: "border-amber-200/50",
    emerald: "border-emerald-200/50",
    rose: "border-rose-200/50",
  };
  const headerMap: Record<string, string> = {
    blue: "text-blue-700 bg-blue-50/50",
    purple: "text-purple-700 bg-purple-50/50",
    amber: "text-amber-700 bg-amber-50/50",
    emerald: "text-emerald-700 bg-emerald-50/50",
    rose: "text-rose-700 bg-rose-50/50",
  };

  return (
    <div className={`rounded-xl border ${borderMap[color]} bg-white shadow-sm overflow-hidden`}>
      <div className={`flex items-center gap-2 border-b ${borderMap[color]} px-5 py-3.5 ${headerMap[color]}`}>
        <Icon className="h-4 w-4" />
        <span className="text-xs font-semibold uppercase tracking-wider">{title}</span>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ─── User Progress View ────────────────────────────────────────
function UserProgressView({ onExit: _onExit }: { onExit?: () => void }) {
  const { data: progress, isLoading, error } = useQuery({
    queryKey: ["user-progress"],
    queryFn: () => api.userProgress(),
  });

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/40" />
      </div>
    );
  }

  if (error || !progress) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-destructive/60" />
          <div className="mt-2 text-sm text-destructive">Failed to load progress data</div>
        </div>
      </div>
    );
  }

  const { user, stats } = progress;
  const primaryRole = (user.roles ?? []).find((r: string) => r !== "client") || "client";
  const RoleIcon = ROLE_ICONS[primaryRole] || Users;
  const roleColor = ROLE_COLORS[primaryRole] || "bg-muted text-muted-foreground border-border";
  const userName = user.contact_name || user.contactName || user.company_name || user.companyName || user.email;

  const isSalesRep = user.roles.includes("sales_rep");
  const isOperations = user.roles.includes("operations");
  const isChecker = user.roles.includes("checker");
  const isTreasury = user.roles.includes("treasury");

  const statusColorMap: Record<string, string> = {
    pending: "bg-amber-100 text-amber-700",
    approved: "bg-emerald-100 text-emerald-700",
    rejected: "bg-red-100 text-red-700",
    new: "bg-blue-100 text-blue-700",
    contacted: "bg-purple-100 text-purple-700",
    qualified: "bg-cyan-100 text-cyan-700",
    proposal: "bg-indigo-100 text-indigo-700",
    negotiation: "bg-rose-100 text-rose-700",
    won: "bg-emerald-100 text-emerald-700",
    lost: "bg-red-100 text-red-700",
    paid: "bg-emerald-100 text-emerald-700",
    overdue: "bg-red-100 text-red-700",
    advanced: "bg-blue-100 text-blue-700",
  };

  return (
    <div className="space-y-6">
      {/* User Profile Card */}
      <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
        <div className="flex items-start gap-5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/5">
            <UserCircle className="h-8 w-8 text-primary/60" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-foreground">{userName}</h2>
              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${roleColor}`}>
                <RoleIcon className="h-3 w-3" />
                {ROLE_LABELS[primaryRole] || primaryRole}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Mail className="h-3 w-3" /> {user.email}
              </span>
              {(user.company_name || user.companyName) && (
                <span className="inline-flex items-center gap-1">
                  <Building2 className="h-3 w-3" /> {user.company_name || user.companyName}
                </span>
              )}
            </div>
            {/* All roles */}
            {user.roles.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {user.roles.map((r: string) => (
                  <span key={r} className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                    {ROLE_LABELS[r] || r}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Sales Rep Metrics */}
        {isSalesRep && (
          <>
            <StatCard icon={Target} label="Total Leads" value={stats.leads.total} color="blue"
              sub={`$${((stats.leads.total_estimated_value ?? stats.leads.totalEstimatedValue) || 0).toLocaleString()} estimated value`} />
            <StatCard icon={TrendingUp} label="Opportunities" value={stats.opportunities.total} color="purple"
              sub={`$${((stats.opportunities.total_amount ?? stats.opportunities.totalAmount) || 0).toLocaleString()} total pipeline`} />
            <StatCard icon={Activity} label="Activities" value={stats.activities.total} color="emerald" />
          </>
        )}

        {/* Operations Metrics */}
        {isOperations && (
          <>
            <StatCard icon={FileText} label="Sales Invoices" value={stats.invoices.total} color="blue"
              sub={`$${((stats.invoices.total_amount ?? stats.invoices.totalAmount) || 0).toLocaleString()} total`} />
            <StatCard icon={ShoppingCart} label="Purchase Invoices" value={stats.purchaseInvoices.total} color="purple" />
            <StatCard icon={ClipboardCheck} label="Purchase Orders" value={stats.purchaseOrders.total} color="amber" />
          </>
        )}

        {/* Checker Metrics */}
        {isChecker && (
          <>
            <StatCard icon={FileText} label="Invoices" value={stats.invoices.total} color="blue"
              sub={`$${((stats.invoices.total_amount ?? stats.invoices.totalAmount) || 0).toLocaleString()} total`} />
            <StatCard icon={Banknote} label="Advances" value={stats.advances.total} color="emerald"
              sub={`$${((stats.advances.total_amount ?? stats.advances.totalAmount) || 0).toLocaleString()}`} />
          </>
        )}

        {/* Treasury Metrics */}
        {isTreasury && (
          <>
            <StatCard icon={Banknote} label="Advances" value={stats.advances.total} color="emerald"
              sub={`$${((stats.advances.total_amount ?? stats.advances.totalAmount) || 0).toLocaleString()}`} />
            <StatCard icon={FileText} label="Invoices" value={stats.invoices.total} color="blue"
              sub={`$${((stats.invoices.total_amount ?? stats.invoices.totalAmount) || 0).toLocaleString()} total`} />
          </>
        )}

        {/* Shared Metrics */}
        <StatCard icon={DollarSign} label="Expenses" value={stats.expenses.total} color="rose"
          sub={`$${((stats.expenses.total_amount ?? stats.expenses.totalAmount) || 0).toLocaleString()}`} />
        <StatCard icon={Briefcase} label="Submissions" value={stats.submissions.total} color="slate" />
      </div>

      {/* Detailed Sections */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Sales Rep: Leads by Status */}
        {isSalesRep && (stats.leads.by_status ?? stats.leads.byStatus) && Object.keys(stats.leads.by_status ?? stats.leads.byStatus).length > 0 && (
          <SectionCard title="Leads by Status" icon={Target} color="blue">
            <StatusDist data={stats.leads.by_status ?? stats.leads.byStatus} colorMap={statusColorMap} />
          </SectionCard>
        )}

        {/* Sales Rep: Opportunities by Stage */}
        {isSalesRep && (stats.opportunities.by_stage ?? stats.opportunities.byStage) && Object.keys(stats.opportunities.by_stage ?? stats.opportunities.byStage).length > 0 && (
          <SectionCard title="Opportunities by Stage" icon={TrendingUp} color="purple">
            <StatusDist data={stats.opportunities.by_stage ?? stats.opportunities.byStage} colorMap={statusColorMap} />
          </SectionCard>
        )}

        {/* Operations / Checker: Invoices by Status */}
        {(isOperations || isChecker) && (stats.invoices.by_status ?? stats.invoices.byStatus) && Object.keys(stats.invoices.by_status ?? stats.invoices.byStatus).length > 0 && (
          <SectionCard title="Invoices by Status" icon={FileText} color="blue">
            <StatusDist data={stats.invoices.by_status ?? stats.invoices.byStatus} colorMap={statusColorMap} />
          </SectionCard>
        )}

        {/* Operations: Purchase Invoices by Status */}
        {isOperations && (stats.purchaseInvoices.by_status ?? stats.purchaseInvoices.byStatus) && Object.keys(stats.purchaseInvoices.by_status ?? stats.purchaseInvoices.byStatus).length > 0 && (
          <SectionCard title="Purchase Invoices by Status" icon={ShoppingCart} color="purple">
            <StatusDist data={stats.purchaseInvoices.by_status ?? stats.purchaseInvoices.byStatus} colorMap={statusColorMap} />
          </SectionCard>
        )}

        {/* Submissions by Status */}
        {(stats.submissions.by_status ?? stats.submissions.byStatus) && Object.keys(stats.submissions.by_status ?? stats.submissions.byStatus).length > 0 && (
          <SectionCard title="Submissions by Status" icon={Briefcase} color="slate">
            <StatusDist data={stats.submissions.by_status ?? stats.submissions.byStatus} colorMap={statusColorMap} />
          </SectionCard>
        )}

        {/* Submissions by Type */}
        {(stats.submissions.by_type ?? stats.submissions.byType) && Object.keys(stats.submissions.by_type ?? stats.submissions.byType).length > 0 && (
          <SectionCard title="Submissions by Type" icon={BarChart3} color="amber">
            <div className="space-y-1.5">
              {Object.entries(stats.submissions.by_type ?? stats.submissions.byType).map(([key, count]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-xs font-medium capitalize text-muted-foreground">{key}</span>
                  <span className="text-sm font-bold">{count as number}</span>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* Recent Activities (Sales Rep) */}
        {isSalesRep && stats.activities.recent && stats.activities.recent.length > 0 && (
          <SectionCard title="Recent Activities" icon={Activity} color="emerald">
            <div className="space-y-2">
              {stats.activities.recent.map((act: any, i: number) => (
                <div key={act.id || i} className="flex items-start gap-2 border-b border-border/40 pb-2 last:border-0 last:pb-0">
                  <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                    <div className="h-2 w-2 rounded-full bg-emerald-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{act.subject}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {act.activity_type || act.activityType}{act.due_date || act.dueDate ? ` · ${new Date(act.due_date || act.dueDate).toLocaleDateString()}` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        )}
      </div>
    </div>
  );
}

// ─── Regular Workspace (Submissions) ───────────────────────────
function WorkspaceSubmissions({ readOnly = false }: { readOnly?: boolean }) {
  const [activeTab, setActiveTab] = useState<TabKey>("visit");
  const qc = useQueryClient();

  const { data: submissions = [] } = useQuery({
    queryKey: ["submissions", activeTab],
    queryFn: () => api.submissions.list(activeTab),
  });

  const createSub = useMutation({
    mutationFn: (data: { type: string; data: any }) => api.submissions.create(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["submissions"] }); toast.success("Submitted"); setShowForm(false); resetForm(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const deleteSub = useMutation({
    mutationFn: (id: string) => api.submissions.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["submissions"] }); toast.success("Deleted"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});

  const resetForm = () => { setForm({}); setShowForm(false); };

  const renderForm = () => {
    switch (activeTab) {
      case "visit":
        return (
          <div className="grid gap-3">
            <input className="inp" placeholder="Date" type="date" value={form.date || ""} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            <input className="inp" placeholder="Location / client" value={form.location || ""} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            <input className="inp" placeholder="Contact person" value={form.contactPerson || ""} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} />
            <input className="inp" placeholder="Purpose" value={form.purpose || ""} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
            <textarea className="inp min-h-[60px]" placeholder="Notes (optional)" value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        );
      case "travel":
        return (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <input className="inp" placeholder="From date" type="date" value={form.fromDate || ""} onChange={(e) => setForm({ ...form, fromDate: e.target.value })} />
              <input className="inp" placeholder="To date" type="date" value={form.toDate || ""} onChange={(e) => setForm({ ...form, toDate: e.target.value })} />
            </div>
            <input className="inp" placeholder="From location" value={form.fromLocation || ""} onChange={(e) => setForm({ ...form, fromLocation: e.target.value })} />
            <input className="inp" placeholder="To location" value={form.toLocation || ""} onChange={(e) => setForm({ ...form, toLocation: e.target.value })} />
            <input className="inp" placeholder="Purpose" value={form.purpose || ""} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
            <input className="inp" placeholder="Estimated amount" type="number" value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>
        );
      case "expense":
        return (
          <div className="grid gap-3">
            <input className="inp" placeholder="Date" type="date" value={form.date || ""} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            <input className="inp" placeholder="Category (e.g. Fuel, Meals, Supplies)" value={form.category || ""} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            <input className="inp" placeholder="Amount" type="number" value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            <textarea className="inp min-h-[60px]" placeholder="Description" value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
        );
      case "leave":
        return (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <input className="inp" placeholder="From date" type="date" value={form.fromDate || ""} onChange={(e) => setForm({ ...form, fromDate: e.target.value })} />
              <input className="inp" placeholder="To date" type="date" value={form.toDate || ""} onChange={(e) => setForm({ ...form, toDate: e.target.value })} />
            </div>
            <select className="inp" value={form.type || "vacation"} onChange={(e) => setForm({ ...form, leaveType: e.target.value })}>
              <option value="vacation">Vacation</option>
              <option value="sick">Sick Leave</option>
              <option value="personal">Personal Leave</option>
            </select>
            <textarea className="inp min-h-[60px]" placeholder="Reason" value={form.reason || ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </div>
        );
    }
  };

  return (
    <>
      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl border border-border bg-muted/20 p-1">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button key={tab.key} onClick={() => { setActiveTab(tab.key); setShowForm(false); }}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-medium transition-all ${
                isActive ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}>
              <Icon className="h-3.5 w-3.5" /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* New submission form */}
      {!readOnly && showForm && (
        <div className="mt-4 rounded-xl border border-border bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm font-medium">New {activeTab}</span>
            <button onClick={() => createSub.mutate({ type: activeTab, data: form })} disabled={createSub.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground disabled:opacity-60">
              {createSub.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Submit
            </button>
          </div>
          {renderForm()}
        </div>
      )}

      {/* Action + list */}
      {!readOnly && !showForm && (
        <button onClick={() => setShowForm(true)}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary">
          <Plus className="h-4 w-4" /> New {activeTab}
        </button>
      )}

      {/* History */}
      <div className="mt-6 space-y-2">
        {submissions.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">No {activeTab} submissions yet.</div>
        ) : (
          submissions.map((s: any) => (
            <div key={s.id} className="flex items-center justify-between rounded-xl border border-border bg-white p-4 shadow-sm">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[s.status] || "bg-muted text-muted-foreground"}`}>
                    {STATUS_LABELS[s.status] || s.status}
                  </span>
                  <span className="text-xs text-muted-foreground">{new Date(s.submittedAt).toLocaleDateString()}</span>
                </div>
                <div className="mt-1.5 text-sm font-medium truncate">
                  {s.data?.purpose || s.data?.reason || s.data?.description || s.data?.location || `${activeTab} submission`}
                </div>
                {s.data?.amount && <div className="text-xs text-muted-foreground mt-0.5">Amount: ${Number(s.data.amount).toLocaleString()}</div>}
              </div>
              {s.status === "pending" && !readOnly && (
                <button onClick={() => deleteSub.mutate(s.id)} className="shrink-0 rounded-md p-2 text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </>
  );
}

// ─── Team Member View (view-as mode) ───────────────────────────
function TeamMemberWorkspaceView() {
  const [view, setView] = useState<"workspace" | "overview">("workspace");
  return (
    <div className="space-y-5">
      <div className="flex gap-1 rounded-xl border border-border bg-muted/20 p-1">
        <button
          onClick={() => setView("workspace")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-medium transition-all ${
            view === "workspace" ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Briefcase className="h-3.5 w-3.5" /> Their workspace
        </button>
        <button
          onClick={() => setView("overview")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-medium transition-all ${
            view === "overview" ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <BarChart3 className="h-3.5 w-3.5" /> Activity overview
        </button>
      </div>

      {view === "workspace" ? <WorkspaceSubmissions readOnly /> : <UserProgressView />}
    </div>
  );
}

const INP_STYLES = `.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem;outline:none}.inp:focus{border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}textarea.inp{resize:vertical}`;

// ─── Main Page ─────────────────────────────────────────────────
function WorkspacePage() {
  const { viewAsUserId } = Route.useSearch();

  // When view-as is active, show the team member's own workspace + tabs
  if (viewAsUserId) {
    return (
      <div>
        <PageHeader
          eyebrow="Reporting Manager"
          title="Team Member Workspace"
          description="Everything this team member has entered — use the sidebar tabs to browse their pages"
          backTo="/app/reports"
        />
        <div className="p-6 md:p-10">
          <TeamMemberWorkspaceView />
        </div>
        <style>{INP_STYLES}</style>
      </div>
    );
  }

  // Regular workspace view (submissions)
  return (
    <div>
      <PageHeader eyebrow="My Workspace" title="Submit & track your requests" />
      <div className="p-6 md:p-10">
        <WorkspaceSubmissions />
      </div>
      <style>{INP_STYLES}</style>
    </div>
  );
}
