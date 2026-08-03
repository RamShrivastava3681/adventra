import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import { Plus, X, Loader2, Trash2 } from "lucide-react";
import { TableSkeleton } from "@/components/skeletons";
import { toast } from "sonner";

export const Route = createFileRoute("/app/proformas")({
  component: ProformasPage,
});

type PF = {
  id: string;
  client_id: string;
  side: "sales" | "purchase";
  debtor_id: string | null;
  vendor_id: string | null;
  po_number: string;
  proforma_number: string | null;
  proforma_date: string | null;
  amount: number;
  currency: string;
  issue_date: string;
  status: "open" | "proforma" | "invoiced" | "cancelled";
  proforma_status: "none" | "pending_review" | "approved" | "rejected" | "funded";
  proforma_review_comments: string | null;
  proforma_funded_amount: number | null;
  notes: string | null;
};

function ProformasPage() {
  const { user, isAdmin, isClient, isChecker, isTreasury } = useAuth();
  const canCreate = isAdmin || (isClient && !isChecker && !isTreasury);
  const qc = useQueryClient();
  const [open, setOpen] = useState<null | "sales" | "purchase">(null);
  const [tab, setTab] = useState<"all" | "sales" | "purchase">("all");
  const [queue, setQueue] = useState<"all" | "pending_review" | "approved" | "funded" | "rejected">("all");
  const [reviewFor, setReviewFor] = useState<PF | null>(null);
  const [fundFor, setFundFor] = useState<PF | null>(null);

  const listQ = useQuery({
    queryKey: ["proformas"],
    queryFn: async () => {
      const data = await api.purchaseOrders.list();
      return (data as any[]).reverse().map((p) => ({
        ...p,
        // Rescue proformas created before proformaStatus was persisted by the
        // backend — they were stored as "draft" but are actually pending review.
        proforma_status: p.proforma_status === "draft" && p.status === "proforma" ? "pending_review" : p.proforma_status,
      }));
    },
  });

  const rows = ((listQ.data ?? []) as PF[])
    .filter((p) => tab === "all" || p.side === tab)
    .filter((p) => {
      if (queue === "all") return true;
      // Cancelled proformas are closed — never count them in a workflow stage
      if (p.status === "cancelled") return false;
      if (queue === "approved") return p.proforma_status === "approved";
      return p.proforma_status === queue;
    });

  const counts = useMemo(() => {
    const arr = ((listQ.data ?? []) as PF[]).filter((p) => p.status !== "cancelled");
    return {
      pending_review: arr.filter((p) => p.proforma_status === "pending_review").length,
      approved: arr.filter((p) => p.proforma_status === "approved").length,
      funded: arr.filter((p) => p.proforma_status === "funded").length,
      rejected: arr.filter((p) => p.proforma_status === "rejected").length,
    };
  }, [listQ.data]);

  const cancel = useMutation({
    mutationFn: async (id: string) => {
      await api.purchaseOrders.update(id, { status: "cancelled" });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["proformas"] }); toast.success("Cancelled"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      await api.purchaseOrders.delete(id);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["proformas"] }); toast.success("Removed"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div>
      <PageHeader
        eyebrow="Proforma invoices"
        title="Proformas & advances"
        description="Raise a proforma invoice against a PO number to take or release an advance. Once approved by the checker and paid/received by treasury, an advance is recorded and applied to the final invoice that uses the same PO number."
        actions={
          canCreate ? (
            <div className="flex gap-2">
              <button onClick={() => setOpen("sales")} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                <Plus className="h-4 w-4" /> Sales proforma
              </button>
              <button onClick={() => setOpen("purchase")} className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm">
                <Plus className="h-4 w-4" /> Purchase proforma
              </button>
            </div>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Read-only</span>
          )
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        <div className="flex flex-wrap gap-2">
          {(["all", "sales", "purchase"] as const).map((s) => (
            <button key={s} onClick={() => setTab(s)}
              className={`rounded-full border px-3 py-1 text-xs uppercase tracking-widest transition ${
                tab === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}>{s === "all" ? "All" : s === "sales" ? "Sales" : "Purchase"}</button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {([
            ["all", "All stages", null],
            ["pending_review", "Pending review", counts.pending_review],
            ["approved", "Funding queue", counts.approved],
            ["funded", "Funded", counts.funded],
            ["rejected", "Rejected", counts.rejected],
          ] as const).map(([k, label, n]) => (
            <button key={k} onClick={() => setQueue(k as typeof queue)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1 text-[11px] transition ${
                queue === k ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}>
              {label}
              {n != null && n > 0 && (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground">{n}</span>
              )}
            </button>
          ))}
        </div>

        <Card>
          {listQ.isLoading ? (
            <TableSkeleton rows={5} cols={7} />
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No proformas yet.</div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Proforma</th>
                    <th className="px-5 py-2 text-left font-normal">PO #</th>
                    <th className="px-5 py-2 text-left font-normal">Counterparty</th>
                    <th className="px-5 py-2 text-left font-normal">Side</th>
                    <th className="px-5 py-2 text-right font-normal">Advance amount</th>
                    <th className="px-5 py-2 text-left font-normal">Status</th>
                    <th className="px-5 py-2 text-right font-normal"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p: any) => {
                    const cp = p.side === "sales" ? p.debtor?.name : p.vendor?.name;
                    return (
                      <tr key={p.id} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-3">
                          <div className="font-mono text-xs">{p.proforma_number ?? "—"}</div>
                          <div className="text-[10px] text-muted-foreground">{p.proforma_date ? fmtDate(p.proforma_date) : fmtDate(p.issue_date)}</div>
                          {p.proforma_review_comments && (
                            <div className="text-[10px] text-warning mt-0.5" title={p.proforma_review_comments}>“{p.proforma_review_comments}”</div>
                          )}
                        </td>
                        <td className="px-5 py-3 font-mono text-xs">{p.po_number}</td>
                        <td className="px-5 py-3">{cp ?? "—"}</td>
                        <td className="px-5 py-3 text-[10px] uppercase tracking-widest text-muted-foreground">{p.side}</td>
                        <td className="px-5 py-3 text-right num">{fmtMoney(p.amount)}</td>
                        <td className="px-5 py-3">
                          <StatusPill status={p.status} pStatus={p.proforma_status} />
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="inline-flex flex-wrap items-center justify-end gap-1">
                            {(isChecker || isAdmin) && p.proforma_status === "pending_review" && (
                              <button onClick={() => setReviewFor(p)} className="rounded-md border border-warning/50 px-2 py-0.5 text-[10px] text-warning hover:bg-warning/10">Review</button>
                            )}
                            {(isTreasury || isAdmin) && p.proforma_status === "approved" && (
                              <button onClick={() => setFundFor(p)} className="rounded-md border border-success/50 px-2 py-0.5 text-[10px] text-success hover:bg-success/10">
                                {p.side === "sales" ? "Mark received" : "Mark paid"}
                              </button>
                            )}
                            {canCreate && p.status !== "invoiced" && p.status !== "cancelled" && p.proforma_status !== "funded" && (
                              <button onClick={() => cancel.mutate(p.id)} className="rounded-md border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted">Cancel</button>
                            )}
                            {canCreate && (p.status === "cancelled" || p.proforma_status === "rejected") && (
                              <button onClick={() => del.mutate(p.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="How this works">
          <ol className="ml-4 list-decimal space-y-1 text-xs text-muted-foreground">
            <li>Operator raises a proforma against a PO number with the advance amount required.</li>
            <li>Checker reviews and approves (or rejects with comments).</li>
            <li>Treasury marks it paid (purchase) or received (sales) — this records an advance entry linked to the PO number.</li>
            <li>When the final invoice is later raised with the same PO number, advances are auto-deducted and the balance is shown as due or outstanding.</li>
          </ol>
        </Card>
      </div>

      {open && user && <NewProformaModal side={open} userId={user.id} onClose={() => setOpen(null)} />}
      {reviewFor && user && <ReviewModal pf={reviewFor} userId={user.id} onClose={() => setReviewFor(null)} />}
      {fundFor && user && <FundModal pf={fundFor} userId={user.id} onClose={() => setFundFor(null)} />}
    </div>
  );
}

function StatusPill({ status, pStatus }: { status: string; pStatus: string }) {
  const label = pStatus && pStatus !== "none" ? pStatus.replace("_", " ") : status;
  const cls =
    pStatus === "funded" || status === "invoiced" ? "border-success/50 text-success"
    : pStatus === "approved" ? "border-primary/50 text-primary"
    : pStatus === "rejected" || status === "cancelled" ? "border-destructive/50 text-destructive"
    : "border-warning/50 text-warning";
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${cls}`}>{label}</span>;
}

function NewProformaModal({ side, userId, onClose }: { side: "sales" | "purchase"; userId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    po_number: "",
    proforma_number: "",
    proforma_date: new Date().toISOString().slice(0, 10),
    party_id: "",
    amount: "",
    currency: "USD",
    notes: "",
  });

  const partiesQ = useQuery({
    queryKey: ["pf-parties", side],
    queryFn: async () => {
      if (side === "sales") {
        const data = await api.debtors.list();
        return data.map((d: any) => ({ id: d.id, name: d.name })).sort((a: any, b: any) => a.name?.localeCompare(b.name ?? "") ?? 0);
      }
      // Purchase side — suppliers are created via the visible "Suppliers" page
      // (/app/suppliers → Supplier model), so list those first and also merge
      // any legacy procurement vendors so nothing is missed.
      const [suppliers, vendors] = await Promise.all([api.suppliers.list(), api.vendors.list()]);
      return [
        ...suppliers.map((s: any) => ({ id: s.id, name: s.company_name ?? s.companyName ?? s.name })),
        ...vendors.map((v: any) => ({ id: v.id, name: v.name })),
      ].sort((a: any, b: any) => a.name?.localeCompare(b.name ?? "") ?? 0);
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!form.po_number.trim()) throw new Error("PO number is required");
      if (!form.proforma_number.trim()) throw new Error("Proforma number is required");
      if (!form.party_id) throw new Error(side === "sales" ? "Pick a debtor" : "Pick a supplier");
      const amt = Number(form.amount);
      if (!amt || amt <= 0) throw new Error("Advance amount must be > 0");
      await api.purchaseOrders.create({
        clientId: userId,
        side,
        debtorId: side === "sales" ? form.party_id : null,
        vendorId: side === "purchase" ? form.party_id : null,
        poNumber: form.po_number.trim(),
        proformaNumber: form.proforma_number.trim(),
        proformaDate: form.proforma_date,
        amount: amt,
        currency: form.currency,
        issueDate: form.proforma_date,
        status: "proforma",
        proformaStatus: "pending_review",
        notes: form.notes || null,
      });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["proformas"] }); toast.success("Proforma submitted for review"); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Modal title={`New ${side} proforma`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-4 p-5">
        <L label="PO number *"><input required className="inp" value={form.po_number} onChange={(e) => setForm({ ...form, po_number: e.target.value })} placeholder="PO-2026-001" /></L>
        <L label="Proforma number *"><input required className="inp" value={form.proforma_number} onChange={(e) => setForm({ ...form, proforma_number: e.target.value })} placeholder="PF-2026-001" /></L>
        <L label={side === "sales" ? "Debtor *" : "Supplier *"}>
          <select required className="inp" value={form.party_id} onChange={(e) => setForm({ ...form, party_id: e.target.value })}>
            <option value="">Select…</option>
            {(partiesQ.data ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </L>
        <div className="grid grid-cols-2 gap-3">
          <L label={`Advance amount * (${form.currency})`}>
            <input required type="number" step="0.01" min="0" className="inp" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </L>
          <L label="Proforma date *"><input required type="date" className="inp" value={form.proforma_date} onChange={(e) => setForm({ ...form, proforma_date: e.target.value })} /></L>
        </div>
        <L label="Notes"><textarea rows={2} className="inp" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></L>
        <p className="text-[11px] text-muted-foreground">{side === "sales" ? "Once funded, this advance is recorded as money received from the debtor against this PO." : "Once funded, this advance is recorded as money paid to the supplier against this PO."}</p>
        <Actions onClose={onClose} pending={create.isPending} label="Submit" />
      </form>
    </Modal>
  );
}

function ReviewModal({ pf, userId, onClose }: { pf: PF; userId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [comments, setComments] = useState("");
  const decide = useMutation({
    mutationFn: async (decision: "approved" | "rejected") => {
      if (decision === "rejected" && !comments.trim()) throw new Error("Comments required to reject");
      await api.purchaseOrders.update(pf.id, {
        proforma_status: decision,
        proforma_reviewed_by: userId,
        proforma_reviewed_at: new Date().toISOString(),
        proforma_review_comments: comments.trim() || null,
      });
    },
    onSuccess: (_d, decision) => {
      qc.invalidateQueries({ queryKey: ["proformas"] });
      toast.success(decision === "approved" ? "Approved — sent to treasury" : "Rejected");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Modal title={`Review · ${pf.proforma_number ?? pf.po_number}`} onClose={onClose}>
      <div className="space-y-3 p-5 text-sm">
        <Summary pf={pf} />
        <L label="Comments (required to reject)"><textarea rows={3} className="inp" value={comments} onChange={(e) => setComments(e.target.value)} /></L>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
          <button disabled={decide.isPending} onClick={() => decide.mutate("rejected")} className="rounded-md border border-destructive/50 px-4 py-2 text-sm text-destructive hover:bg-destructive/10">Reject</button>
          <button disabled={decide.isPending} onClick={() => decide.mutate("approved")} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {decide.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Approve
          </button>
        </div>
      </div>
    </Modal>
  );
}

function FundModal({ pf, userId, onClose }: { pf: PF; userId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    amount: String(pf.amount ?? ""),
    reference: "",
    advance_date: new Date().toISOString().slice(0, 10),
  });
  const fund = useMutation({
    mutationFn: async () => {
      const amt = Number(form.amount);
      if (!amt || amt <= 0) throw new Error("Amount must be > 0");
      await api.purchaseOrders.update(pf.id, {
        proforma_status: "funded",
        proforma_funded_by: userId,
        proforma_funded_at: new Date().toISOString(),
        proforma_funded_amount: amt,
        proforma_funding_reference: form.reference || null,
      });
      await api.advances.create({
        clientId: pf.client_id,
        side: pf.side,
        purchaseOrderId: pf.id,
        amount: amt,
        advanceDate: form.advance_date,
        reference: form.reference || `${pf.proforma_number ?? pf.po_number}`,
        status: "open",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["proformas"] });
      qc.invalidateQueries({ queryKey: ["advances"] });
      toast.success(pf.side === "sales" ? "Advance received & recorded" : "Advance paid & recorded");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Modal title={`${pf.side === "sales" ? "Mark advance received" : "Mark advance paid"} · ${pf.proforma_number ?? pf.po_number}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); fund.mutate(); }} className="space-y-4 p-5">
        <Summary pf={pf} />
        <L label={`Amount (${pf.currency}) *`}>
          <input required type="number" step="0.01" min="0" className="inp" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </L>
        <L label="Date *"><input required type="date" className="inp" value={form.advance_date} onChange={(e) => setForm({ ...form, advance_date: e.target.value })} /></L>
        <L label="Reference"><input className="inp" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Wire ref / transaction id" /></L>
        <Actions onClose={onClose} pending={fund.isPending} label="Confirm" />
      </form>
    </Modal>
  );
}

function Summary({ pf }: { pf: PF }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs space-y-1">
      <div className="flex justify-between"><span className="text-muted-foreground">PO #</span><span className="font-mono">{pf.po_number}</span></div>
      <div className="flex justify-between"><span className="text-muted-foreground">Proforma #</span><span className="font-mono">{pf.proforma_number ?? "—"}</span></div>
      <div className="flex justify-between"><span className="text-muted-foreground">Side</span><span>{pf.side}</span></div>
      <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><span className="num">{fmtMoney(pf.amount)}</span></div>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-border bg-card" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-base">{title}</h3>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        {children}
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

function Actions({ onClose, pending, label }: { onClose: () => void; pending: boolean; label: string }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
      <button disabled={pending} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
        {pending && <Loader2 className="h-4 w-4 animate-spin" />} {label}
      </button>
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>{children}</label>;
}
