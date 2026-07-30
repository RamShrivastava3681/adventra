import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api-client";
import { PageHeader } from "@/components/ledger-ui";
import { MapPin, Plane, Receipt, CalendarDays, Plus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/workspace")({
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

function WorkspacePage() {
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
    <div>
      <PageHeader eyebrow="My Workspace" title="Submit & track your requests" />
      <div className="p-6 md:p-10">
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
        {showForm && (
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
        {!showForm && (
          <button onClick={() => setShowForm(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary w-full justify-center">
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
                {s.status === "pending" && (
                  <button onClick={() => deleteSub.mutate(s.id)} className="shrink-0 rounded-md p-2 text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
      <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem;outline:none}.inp:focus{border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}textarea.inp{resize:vertical}`}</style>
    </div>
  );
}
