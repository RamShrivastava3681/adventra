import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useViewAsUserId } from "@/lib/view-as";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import {
  Plus,
  X,
  Loader2,
  Users,
  Target,
  PhoneCall,
  Mail,
  Calendar,
  CheckCircle2,
  Trash2,
} from "lucide-react";
import { TableSkeleton } from "@/components/skeletons";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { toast } from "sonner";

export const Route = createFileRoute("/app/crm")({
  component: CRMPage,
});

const LEAD_STATUSES = ["new", "contacted", "qualified", "converted", "lost"];
const LEAD_SOURCES = ["website", "walk-in", "referral", "event", "cold-call", "social", "other"];
const OPP_STAGES = [
  "prospecting",
  "qualification",
  "proposal",
  "negotiation",
  "closed_won",
  "closed_lost",
];
const OPP_STAGE_PROB: Record<string, number> = {
  prospecting: 20,
  qualification: 40,
  proposal: 60,
  negotiation: 80,
  closed_won: 100,
  closed_lost: 0,
};
const ACTIVITY_TYPES = ["call", "email", "meeting", "note", "task"];

type Tab = "pipeline" | "leads" | "opportunities" | "activities";

function CRMPage() {
  const { user, isSalesRep, isAdmin, isClient } = useAuth();
  const readOnly = !!useViewAsUserId(); // reporting manager viewing a team member
  const [tab, setTab] = useState<Tab>("pipeline");
  const [newLead, setNewLead] = useState(false);
  const [newOpp, setNewOpp] = useState(false);
  const [newAct, setNewAct] = useState(false);

  const canWrite = !!user && !readOnly;
  const scopeLabel = readOnly
    ? "Read-only view"
    : isSalesRep && !isAdmin && !isClient
      ? "My records"
      : "Team records";

  return (
    <div>
      <PageHeader
        eyebrow="Sales"
        title="CRM / Salesforce"
        description={`Manage leads, opportunities, and activities. ${scopeLabel}.`}
        actions={
          canWrite ? (
            <div className="flex gap-2">
              <button
                onClick={() => setNewLead(true)}
                className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <Plus className="h-4 w-4" /> Lead
              </button>
              <button
                onClick={() => setNewOpp(true)}
                className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <Plus className="h-4 w-4" /> Opportunity
              </button>
              <button
                onClick={() => setNewAct(true)}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                <Plus className="h-4 w-4" /> Activity
              </button>
            </div>
          ) : null
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        <div className="flex flex-wrap gap-2 border-b border-border pb-3">
          {(["pipeline", "leads", "opportunities", "activities"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-4 py-2 text-sm capitalize transition ${tab === t ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "pipeline" && <PipelineView />}
        {tab === "leads" && <LeadsView readOnly={readOnly} />}
        {tab === "opportunities" && <OpportunitiesView readOnly={readOnly} />}
        {tab === "activities" && <ActivitiesView readOnly={readOnly} />}
      </div>

      {newLead && user && <LeadModal userId={user.id} onClose={() => setNewLead(false)} />}
      {newOpp && user && <OppModal userId={user.id} onClose={() => setNewOpp(false)} />}
      {newAct && user && <ActivityModal userId={user.id} onClose={() => setNewAct(false)} />}
    </div>
  );
}

function PipelineView() {
  const oppsQ = useQuery({
    queryKey: ["opportunities"],
    queryFn: async () => {
      const data = await api.crm.opportunities.list();
      return data.reverse();
    },
  });
  const summary = useMemo(() => {
    const opps = (oppsQ.data ?? []) as any[];
    const byStage = new Map<string, { count: number; value: number; weighted: number }>();
    for (const s of OPP_STAGES) byStage.set(s, { count: 0, value: 0, weighted: 0 });
    let totalOpen = 0,
      weightedOpen = 0,
      won = 0,
      lost = 0;
    for (const o of opps) {
      const b = byStage.get(o.stage) ?? { count: 0, value: 0, weighted: 0 };
      b.count++;
      b.value += Number(o.amount);
      b.weighted += Number(o.amount) * (o.probability / 100);
      byStage.set(o.stage, b);
      if (o.stage === "closed_won") won += Number(o.amount);
      else if (o.stage === "closed_lost") lost += Number(o.amount);
      else {
        totalOpen += Number(o.amount);
        weightedOpen += Number(o.amount) * (o.probability / 100);
      }
    }
    return { byStage, totalOpen, weightedOpen, won, lost };
  }, [oppsQ.data]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Open pipeline" value={fmtMoney(summary.totalOpen)} />
        <StatTile label="Weighted forecast" value={fmtMoney(summary.weightedOpen)} tone="primary" />
        <StatTile label="Won (all time)" value={fmtMoney(summary.won)} tone="success" />
        <StatTile label="Lost (all time)" value={fmtMoney(summary.lost)} tone="destructive" />
      </div>

      <Card title="Sales pipeline by stage">
        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
          {OPP_STAGES.map((s) => {
            const b = summary.byStage.get(s)!;
            return (
              <div key={s} className="rounded-lg border border-border bg-muted/20 p-3">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  {s.replace("_", " ")}
                </div>
                <div className="mt-1 font-display text-lg">{fmtMoney(b.value)}</div>
                <div className="text-[10px] text-muted-foreground">{b.count} deals</div>
                <div className="mt-2 h-1 rounded-full bg-border">
                  <div
                    className="h-1 rounded-full bg-primary"
                    style={{
                      width: `${Math.min(100, (b.value / Math.max(1, summary.totalOpen + summary.won + summary.lost)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="Recent opportunities">
        {oppsQ.isLoading ? (
          <TableSkeleton rows={4} cols={5} />
        ) : (oppsQ.data ?? []).length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            <Target className="mx-auto mb-2 h-8 w-8 opacity-40" />
            No opportunities yet.
          </div>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="table-premium w-full text-sm">
              <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-5 py-2 text-left font-normal">Deal</th>
                  <th className="px-5 py-2 text-left font-normal">Stage</th>
                  <th className="px-5 py-2 text-right font-normal">Amount</th>
                  <th className="px-5 py-2 text-right font-normal">Prob</th>
                  <th className="px-5 py-2 text-right font-normal">Close</th>
                </tr>
              </thead>
              <tbody>
                {(oppsQ.data ?? []).slice(0, 10).map((o: any) => (
                  <tr key={o.id} className="border-b border-border/60">
                    <td className="px-5 py-3">
                      <div className="font-medium">{o.name}</div>
                      <div className="text-xs text-muted-foreground">{o.account_name}</div>
                    </td>
                    <td className="px-5 py-3">
                      <StagePill stage={o.stage} />
                    </td>
                    <td className="px-5 py-3 text-right num">{fmtMoney(o.amount)}</td>
                    <td className="px-5 py-3 text-right num text-muted-foreground">
                      {o.probability}%
                    </td>
                    <td className="px-5 py-3 text-right text-muted-foreground">
                      {o.expected_close_date ? fmtDate(o.expected_close_date) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function LeadsView({ readOnly = false }: { readOnly?: boolean }) {
  const qc = useQueryClient();
  const leadsQ = useQuery({
    queryKey: ["leads"],
    queryFn: async () => {
      const data = await api.crm.leads.list();
      return data.reverse();
    },
  });
  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await api.crm.leads.update(id, { status });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
  const del = useMutation({
    mutationFn: async (id: string) => {
      await api.crm.leads.delete(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      toast.success("Deleted");
    },
  });

  return (
    <Card title={`Leads (${(leadsQ.data ?? []).length})`}>
      {leadsQ.isLoading ? (
        <TableSkeleton rows={4} cols={7} />
      ) : (leadsQ.data ?? []).length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          <Users className="mx-auto mb-2 h-8 w-8 opacity-40" />
          No leads yet.
        </div>
      ) : (
        <div className="-mx-5 overflow-x-auto">
          <table className="table-premium w-full text-sm">
            <thead className="text-xs uppercase tracking-widest text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-5 py-2 text-left font-normal">Name</th>
                <th className="px-5 py-2 text-left font-normal">Company</th>
                <th className="px-5 py-2 text-left font-normal">Contact</th>
                <th className="px-5 py-2 text-left font-normal">Source</th>
                <th className="px-5 py-2 text-right font-normal">Est. value</th>
                <th className="px-5 py-2 text-left font-normal">Status</th>
                {!readOnly && <th className="px-5 py-2"></th>}
              </tr>
            </thead>
            <tbody>
              {(leadsQ.data ?? []).map((l: any) => (
                <tr key={l.id} className="border-b border-border/60 hover:bg-muted/30">
                  <td className="px-5 py-3 font-medium">{l.name}</td>
                  <td className="px-5 py-3">{l.company ?? "—"}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">
                    {l.email && (
                      <div className="flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {l.email}
                      </div>
                    )}
                    {l.phone && (
                      <div className="flex items-center gap-1">
                        <PhoneCall className="h-3 w-3" />
                        {l.phone}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground capitalize">{l.source}</td>
                  <td className="px-5 py-3 text-right num">{fmtMoney(l.estimated_value)}</td>
                  <td className="px-5 py-3">
                    {readOnly ? (
                      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        {l.status}
                      </span>
                    ) : (
                      <select
                        value={l.status}
                        onChange={(e) => updateStatus.mutate({ id: l.id, status: e.target.value })}
                        className="rounded-md border border-border bg-input px-2 py-1 text-xs"
                      >
                        {LEAD_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  {!readOnly && (
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => del.mutate(l.id)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function OpportunitiesView({ readOnly = false }: { readOnly?: boolean }) {
  const qc = useQueryClient();
  const oppsQ = useQuery({
    queryKey: ["opportunities"],
    queryFn: async () => {
      const data = await api.crm.opportunities.list();
      return data.sort((a: any, b: any) => {
        const da = a.expectedCloseDate ?? a.expected_close_date ?? "9999-12-31";
        const db = b.expectedCloseDate ?? b.expected_close_date ?? "9999-12-31";
        return da.localeCompare(db);
      });
    },
  });
  const updateStage = useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: string }) => {
      const patch: any = { stage, probability: OPP_STAGE_PROB[stage] ?? 50 };
      if (stage === "closed_won") patch.won_at = new Date().toISOString();
      await api.crm.opportunities.update(id, patch);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["opportunities"] }),
  });

  return (
    <Card title={`Opportunities (${(oppsQ.data ?? []).length})`}>
      {(oppsQ.data ?? []).length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          <Target className="mx-auto mb-2 h-8 w-8 opacity-40" />
          No opportunities.
        </div>
      ) : (
        <div className="-mx-5 overflow-x-auto">
          <table className="table-premium w-full text-sm">
            <thead className="text-xs uppercase tracking-widest text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-5 py-2 text-left font-normal">Deal</th>
                <th className="px-5 py-2 text-left font-normal">Account</th>
                <th className="px-5 py-2 text-left font-normal">Stage</th>
                <th className="px-5 py-2 text-right font-normal">Amount</th>
                <th className="px-5 py-2 text-right font-normal">Prob</th>
                <th className="px-5 py-2 text-right font-normal">Weighted</th>
                <th className="px-5 py-2 text-right font-normal">Close date</th>
              </tr>
            </thead>
            <tbody>
              {(oppsQ.data ?? []).map((o: any) => (
                <tr key={o.id} className="border-b border-border/60 hover:bg-muted/30">
                  <td className="px-5 py-3 font-medium">{o.name}</td>
                  <td className="px-5 py-3">{o.account_name ?? "—"}</td>
                  <td className="px-5 py-3">
                    {readOnly ? (
                      <StagePill stage={o.stage} />
                    ) : (
                      <select
                        value={o.stage}
                        onChange={(e) => updateStage.mutate({ id: o.id, stage: e.target.value })}
                        className="rounded-md border border-border bg-input px-2 py-1 text-xs"
                      >
                        {OPP_STAGES.map((s) => (
                          <option key={s} value={s}>
                            {s.replace("_", " ")}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right num">{fmtMoney(o.amount)}</td>
                  <td className="px-5 py-3 text-right num text-muted-foreground">
                    {o.probability}%
                  </td>
                  <td className="px-5 py-3 text-right num text-primary">
                    {fmtMoney(Number(o.amount) * (o.probability / 100))}
                  </td>
                  <td className="px-5 py-3 text-right text-muted-foreground">
                    {o.expected_close_date ? fmtDate(o.expected_close_date) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ActivitiesView({ readOnly = false }: { readOnly?: boolean }) {
  const qc = useQueryClient();
  const actsQ = useQuery({
    queryKey: ["crm_activities"],
    queryFn: async () => {
      const data = await api.crm.activities.list();
      return data.sort((a: any, b: any) => {
        const da = a.dueDate ?? a.due_date ?? "9999-12-31";
        const db = b.dueDate ?? b.due_date ?? "9999-12-31";
        return da.localeCompare(db);
      });
    },
  });
  const toggle = useMutation({
    mutationFn: async (a: any) => {
      await api.crm.activities.update(a.id, {
        completed: !a.completed,
        completed_at: !a.completed ? new Date().toISOString() : null,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm_activities"] }),
  });

  return (
    <Card title={`Activities (${(actsQ.data ?? []).length})`}>
      {(actsQ.data ?? []).length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          <Calendar className="mx-auto mb-2 h-8 w-8 opacity-40" />
          No activities.
        </div>
      ) : (
        <div className="space-y-2">
          {(actsQ.data ?? []).map((a: any) => (
            <div
              key={a.id}
              className={`flex items-start gap-3 rounded-lg border border-border p-3 ${a.completed ? "opacity-60" : ""}`}
            >
              {readOnly ? (
                <div className={`mt-0.5 ${a.completed ? "text-success" : "text-muted-foreground"}`}>
                  <CheckCircle2 className="h-4 w-4" />
                </div>
              ) : (
                <button
                  onClick={() => toggle.mutate(a)}
                  className={`mt-0.5 ${a.completed ? "text-success" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <CheckCircle2 className="h-4 w-4" />
                </button>
              )}
              <div className="flex-1">
                <div className={`text-sm ${a.completed ? "line-through" : ""}`}>{a.subject}</div>
                <div className="text-xs text-muted-foreground">
                  <span className="capitalize">{a.activity_type}</span>
                  {a.due_date && <> · Due {fmtDate(a.due_date)}</>}
                </div>
                {a.description && (
                  <div className="mt-1 text-xs text-muted-foreground">{a.description}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// -------- Modals --------

function LeadModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: "",
    company: "",
    email: "",
    phone: "",
    source: "other",
    status: "new",
    estimated_value: "",
    notes: "",
  });
  const create = useMutation({
    mutationFn: async () => {
      if (!f.name.trim()) throw new Error("Name required");
      await api.crm.leads.create({
        client_id: userId,
        assigned_to: userId,
        name: f.name.trim(),
        company: f.company || null,
        email: f.email || null,
        phone: f.phone || null,
        source: f.source,
        status: f.status,
        estimated_value: Number(f.estimated_value) || 0,
        notes: f.notes || null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      toast.success("Lead added");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  return (
    <ModalShell title="New lead" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
        className="space-y-4 p-5"
      >
        <div className="grid grid-cols-2 gap-3">
          <L label="Name *">
            <input
              required
              className="inp"
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          </L>
          <L label="Company">
            <input
              className="inp"
              value={f.company}
              onChange={(e) => setF({ ...f, company: e.target.value })}
            />
          </L>
          <L label="Email">
            <input
              type="email"
              className="inp"
              value={f.email}
              onChange={(e) => setF({ ...f, email: e.target.value })}
            />
          </L>
          <L label="Phone">
            <input
              className="inp"
              value={f.phone}
              onChange={(e) => setF({ ...f, phone: e.target.value })}
            />
          </L>
          <L label="Source">
            <select
              className="inp"
              value={f.source}
              onChange={(e) => setF({ ...f, source: e.target.value })}
            >
              {LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </L>
          <L label="Estimated value">
            <input
              type="number"
              step="0.01"
              className="inp"
              value={f.estimated_value}
              onChange={(e) => setF({ ...f, estimated_value: e.target.value })}
            />
          </L>
        </div>
        <L label="Notes">
          <textarea
            rows={3}
            className="inp"
            value={f.notes}
            onChange={(e) => setF({ ...f, notes: e.target.value })}
          />
        </L>
        <SaveRow onClose={onClose} pending={create.isPending} />
      </form>
    </ModalShell>
  );
}

function OppModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const leadsQ = useQuery({
    queryKey: ["leads-mini"],
    queryFn: async () => {
      const data = await api.crm.leads.list();
      return data.map((l: any) => ({ id: l.id, name: l.name, company: l.company }));
    },
  });
  const [f, setF] = useState({
    name: "",
    account_name: "",
    lead_id: "",
    stage: "prospecting",
    amount: "",
    expected_close_date: "",
    notes: "",
  });
  const create = useMutation({
    mutationFn: async () => {
      if (!f.name.trim()) throw new Error("Name required");
      await api.crm.opportunities.create({
        client_id: userId,
        assigned_to: userId,
        lead_id: f.lead_id || null,
        name: f.name.trim(),
        account_name: f.account_name || null,
        stage: f.stage,
        probability: OPP_STAGE_PROB[f.stage] ?? 50,
        amount: Number(f.amount) || 0,
        expected_close_date: f.expected_close_date || null,
        notes: f.notes || null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["opportunities"] });
      toast.success("Opportunity added");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  return (
    <ModalShell title="New opportunity" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
        className="space-y-4 p-5"
      >
        <div className="grid grid-cols-2 gap-3">
          <L label="Deal name *">
            <input
              required
              className="inp"
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          </L>
          <L label="Account">
            <input
              className="inp"
              value={f.account_name}
              onChange={(e) => setF({ ...f, account_name: e.target.value })}
            />
          </L>
          <L label="Linked lead">
            <SearchableSelect
              value={f.lead_id}
              onChange={(v) => setF({ ...f, lead_id: v })}
              placeholder="— None —"
              options={[
                { value: "", label: "— None —" },
                ...(leadsQ.data ?? []).map((l: any) => ({
                  value: l.id,
                  label: l.name,
                  hint: l.company ?? undefined,
                })),
              ]}
            />
          </L>
          <L label="Stage">
            <select
              className="inp"
              value={f.stage}
              onChange={(e) => setF({ ...f, stage: e.target.value })}
            >
              {OPP_STAGES.map((s) => (
                <option key={s} value={s}>
                  {s.replace("_", " ")}
                </option>
              ))}
            </select>
          </L>
          <L label="Amount">
            <input
              type="number"
              step="0.01"
              className="inp"
              value={f.amount}
              onChange={(e) => setF({ ...f, amount: e.target.value })}
            />
          </L>
          <L label="Expected close">
            <input
              type="date"
              className="inp"
              value={f.expected_close_date}
              onChange={(e) => setF({ ...f, expected_close_date: e.target.value })}
            />
          </L>
        </div>
        <L label="Notes">
          <textarea
            rows={3}
            className="inp"
            value={f.notes}
            onChange={(e) => setF({ ...f, notes: e.target.value })}
          />
        </L>
        <SaveRow onClose={onClose} pending={create.isPending} />
      </form>
    </ModalShell>
  );
}

function ActivityModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const leadsQ = useQuery({
    queryKey: ["leads-mini2"],
    queryFn: async () => {
      const data = await api.crm.leads.list();
      return data.map((l: any) => ({ id: l.id, name: l.name }));
    },
  });
  const oppsQ = useQuery({
    queryKey: ["opps-mini"],
    queryFn: async () => {
      const data = await api.crm.opportunities.list();
      return data.map((o: any) => ({ id: o.id, name: o.name }));
    },
  });
  const [f, setF] = useState({
    activity_type: "call",
    subject: "",
    description: "",
    due_date: "",
    lead_id: "",
    opportunity_id: "",
  });
  const create = useMutation({
    mutationFn: async () => {
      if (!f.subject.trim()) throw new Error("Subject required");
      await api.crm.activities.create({
        client_id: userId,
        assigned_to: userId,
        created_by: userId,
        activity_type: f.activity_type,
        subject: f.subject.trim(),
        description: f.description || null,
        due_date: f.due_date || null,
        lead_id: f.lead_id || null,
        opportunity_id: f.opportunity_id || null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm_activities"] });
      toast.success("Activity added");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  return (
    <ModalShell title="New activity" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
        className="space-y-4 p-5"
      >
        <div className="grid grid-cols-2 gap-3">
          <L label="Type">
            <select
              className="inp"
              value={f.activity_type}
              onChange={(e) => setF({ ...f, activity_type: e.target.value })}
            >
              {ACTIVITY_TYPES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </L>
          <L label="Due date">
            <input
              type="date"
              className="inp"
              value={f.due_date}
              onChange={(e) => setF({ ...f, due_date: e.target.value })}
            />
          </L>
          <div className="col-span-2">
            <L label="Subject *">
              <input
                required
                className="inp"
                value={f.subject}
                onChange={(e) => setF({ ...f, subject: e.target.value })}
              />
            </L>
          </div>
          <L label="Linked lead">
            <SearchableSelect
              value={f.lead_id}
              onChange={(v) => setF({ ...f, lead_id: v })}
              placeholder="— None —"
              options={[
                { value: "", label: "— None —" },
                ...(leadsQ.data ?? []).map((l: any) => ({ value: l.id, label: l.name })),
              ]}
            />
          </L>
          <L label="Linked opportunity">
            <SearchableSelect
              value={f.opportunity_id}
              onChange={(v) => setF({ ...f, opportunity_id: v })}
              placeholder="— None —"
              options={[
                { value: "", label: "— None —" },
                ...(oppsQ.data ?? []).map((o: any) => ({ value: o.id, label: o.name })),
              ]}
            />
          </L>
        </div>
        <L label="Description">
          <textarea
            rows={3}
            className="inp"
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })}
          />
        </L>
        <SaveRow onClose={onClose} pending={create.isPending} />
      </form>
    </ModalShell>
  );
}

// -------- Shared UI --------

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">{title}</h3>
          <button onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}
function SaveRow({ onClose, pending }: { onClose: () => void; pending: boolean }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button
        type="button"
        onClick={onClose}
        className="rounded-md border border-border px-4 py-2 text-sm"
      >
        Cancel
      </button>
      <button
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />} Save
      </button>
    </div>
  );
}
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "success" | "warning" | "destructive" | "primary";
}) {
  const t =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "destructive"
          ? "text-destructive"
          : tone === "primary"
            ? "text-primary"
            : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-1 font-display text-2xl ${t}`}>{value}</div>
    </div>
  );
}
function StagePill({ stage }: { stage: string }) {
  const tone =
    stage === "closed_won"
      ? "success"
      : stage === "closed_lost"
        ? "destructive"
        : stage === "negotiation" || stage === "proposal"
          ? "primary"
          : "warning";
  const s =
    tone === "success"
      ? "bg-success/10 text-success border-success/30"
      : tone === "primary"
        ? "bg-primary/10 text-primary border-primary/30"
        : tone === "warning"
          ? "bg-warning/10 text-warning border-warning/30"
          : "bg-destructive/10 text-destructive border-destructive/30";
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${s}`}
    >
      {stage.replace("_", " ")}
    </span>
  );
}
