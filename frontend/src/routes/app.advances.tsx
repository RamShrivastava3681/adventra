import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import { Plus, X, Loader2, Link2, Trash2 } from "lucide-react";
import { TableSkeleton } from "@/components/skeletons";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { toast } from "sonner";

export const Route = createFileRoute("/app/advances")({
  component: AdvancesPage,
});

function AdvancesPage() {
  const { user, isAdmin, isClient, isChecker, isTreasury } = useAuth();
  const canWrite = isAdmin || (isClient && !isChecker && !isTreasury);
  const qc = useQueryClient();
  const [open, setOpen] = useState<null | "sales" | "purchase">(null);
  const [tab, setTab] = useState<"sales" | "purchase">("sales");

  const advancesQ = useQuery({
    queryKey: ["advances"],
    queryFn: async () => {
      const data = await api.advances.list();
      return (data ?? []).reverse();
    },
  });

  const rows = (advancesQ.data ?? []).filter((a: any) => a.side === tab);

  const totals = useMemo(() => {
    const r = { sales: 0, purchase: 0 };
    for (const a of (advancesQ.data ?? []) as any[]) {
      if (a.status === "refunded") continue;
      r[a.side as "sales" | "purchase"] += Number(a.amount);
    }
    return r;
  }, [advancesQ.data]);

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await api.advances.update(id, { status });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["advances"] }); toast.success("Updated"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      await api.advances.delete(id);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["advances"] }); toast.success("Removed"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div>
      <PageHeader
        eyebrow="Advances"
        title="Advance payments"
        description="Money received from customers or paid to suppliers ahead of the final invoice. Each advance is tied to a specific invoice."
        actions={
          canWrite ? (
            <div className="flex gap-2">
              <button onClick={() => setOpen("sales")} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                <Plus className="h-4 w-4" /> Sales advance
              </button>
              <button onClick={() => setOpen("purchase")} className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm">
                <Plus className="h-4 w-4" /> Purchase advance
              </button>
            </div>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Read-only</span>
          )
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Open sales advances (received)"><div className="num text-3xl text-success">{fmtMoney(totals.sales)}</div></Card>
          <Card title="Open purchase advances (paid)"><div className="num text-3xl text-warning">{fmtMoney(totals.purchase)}</div></Card>
        </div>

        <div className="flex gap-2">
          {(["sales", "purchase"] as const).map((s) => (
            <button key={s} onClick={() => setTab(s)}
              className={`rounded-full border px-3 py-1 text-xs uppercase tracking-widest transition ${
                tab === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}>{s === "sales" ? "Sales side" : "Purchase side"}</button>
          ))}
        </div>

        <Card>
          {advancesQ.isLoading ? (
            <TableSkeleton rows={5} cols={8} />
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No advances on this side yet.</div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Date</th>
                    <th className="px-5 py-2 text-left font-normal">Linked to</th>
                    <th className="px-5 py-2 text-left font-normal">Counterparty</th>
                    <th className="px-5 py-2 text-right font-normal">Advance</th>
                    <th className="px-5 py-2 text-right font-normal">PO / Inv amt</th>
                    <th className="px-5 py-2 text-left font-normal">Reference</th>
                    <th className="px-5 py-2 text-left font-normal">Status</th>
                    <th className="px-5 py-2 text-right font-normal"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a: any) => {
                    const inv = a.side === "sales" ? a.invoice : a.purchase;
                    const linkedAmount = a.order?.amount ?? inv?.amount ?? null;
                    const cp = a.order
                      ? (a.side === "sales" ? a.order.debtor?.name : a.order.vendor?.name)
                      : (a.side === "sales" ? a.invoice?.debtor?.name : a.purchase?.vendor?.name);
                    return (
                      <tr key={a.id} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-3 text-muted-foreground">{fmtDate(a.advance_date)}</td>
                        <td className="px-5 py-3">
                          {a.order ? (
                            <Link to="/app/proformas" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                              <Link2 className="h-3 w-3" />PO {a.order.po_number}
                            </Link>
                          ) : inv ? (
                            <Link to={a.side === "sales" ? "/app/invoices" : "/app/purchases"} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                              <Link2 className="h-3 w-3" />{inv.invoice_number}
                            </Link>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-5 py-3">{cp ?? "—"}</td>
                        <td className="px-5 py-3 text-right num text-primary">{fmtMoney(a.amount)}</td>
                        <td className="px-5 py-3 text-right num text-muted-foreground">{linkedAmount != null ? fmtMoney(linkedAmount) : "—"}</td>
                        <td className="px-5 py-3 text-xs text-muted-foreground">{a.reference ?? "—"}</td>
                        <td className="px-5 py-3">
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${
                            a.status === "applied" ? "border-success/50 text-success"
                            : a.status === "refunded" ? "border-muted text-muted-foreground"
                            : "border-warning/50 text-warning"
                          }`}>{a.status}</span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="inline-flex gap-1">
                            {canWrite && a.status === "open" && (
                              <button onClick={() => setStatus.mutate({ id: a.id, status: "applied" })} className="rounded-md border border-success/50 px-2 py-0.5 text-[10px] text-success hover:bg-success/10">Mark applied</button>
                            )}
                            {canWrite && a.status !== "refunded" && (
                              <button onClick={() => setStatus.mutate({ id: a.id, status: "refunded" })} className="rounded-md border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted">Refunded</button>
                            )}
                            {canWrite && (
                              <button onClick={() => del.mutate(a.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
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
      </div>

      {open && user && <NewAdvanceModal side={open} userId={user.id} onClose={() => setOpen(null)} />}
    </div>
  );
}

function NewAdvanceModal({ side, userId, onClose }: { side: "sales" | "purchase"; userId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [linkType, setLinkType] = useState<"po" | "invoice">("po");
  const [form, setForm] = useState({
    purchase_order_id: "",
    invoice_id: "",
    purchase_invoice_id: "",
    amount: "",
    advance_date: new Date().toISOString().slice(0, 10),
    reference: "",
    notes: "",
  });

  const ordersQ = useQuery({
    queryKey: ["adv-po", side],
    queryFn: async () => {
      const data = await api.purchaseOrders.list();
      return data.filter((o: any) => o.side === side && o.status !== "cancelled").reverse();
    },
  });

  const invoicesQ = useQuery({
    queryKey: ["adv-inv", side],
    enabled: linkType === "invoice",
    queryFn: async () => {
      if (side === "sales") {
        const data = await api.invoices.list();
        return data.reverse();
      }
      const data = await api.purchaseInvoices.list();
      return data.reverse();
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!form.amount || Number(form.amount) <= 0) throw new Error("Amount must be > 0");
      if (linkType === "po") {
        if (!form.purchase_order_id) throw new Error("Pick the purchase order this advance is against");
      } else {
        const id = side === "sales" ? form.invoice_id : form.purchase_invoice_id;
        if (!id) throw new Error("Pick the invoice this advance relates to");
      }
      const payload = {
        clientId: userId,
        side,
        amount: Number(form.amount),
        advance_date: form.advance_date,
        reference: form.reference || null,
        notes: form.notes || null,
        purchase_order_id: linkType === "po" ? form.purchase_order_id : null,
        invoice_id: linkType === "invoice" && side === "sales" ? form.invoice_id : null,
        purchase_invoice_id: linkType === "invoice" && side === "purchase" ? form.purchase_invoice_id : null,
      };
      await api.advances.create(payload);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["advances"] }); toast.success("Advance recorded"); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">{side === "sales" ? "Sales advance (received)" : "Purchase advance (paid)"}</h3>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-4 p-5">
          <div className="flex gap-2">
            {(["po", "invoice"] as const).map((t) => (
              <button type="button" key={t} onClick={() => setLinkType(t)}
                className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-widest transition ${
                  linkType === t ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                }`}>{t === "po" ? "Against PO" : "Against invoice"}</button>
            ))}
          </div>
          {linkType === "po" ? (
            <L label="Purchase order *">
              <SearchableSelect
                value={form.purchase_order_id}
                onChange={(v) => setForm({ ...form, purchase_order_id: v })}
                placeholder="Select PO…"
                options={(ordersQ.data ?? []).map((o: any) => ({
                  value: o.id,
                  label: o.po_number,
                  hint: `${(o.debtor?.name ?? o.vendor?.name) ?? ""} · ${fmtMoney(o.amount)}`,
                }))}
              />
              {(ordersQ.data ?? []).length === 0 && (
                <p className="mt-1 text-[10px] text-warning">No open {side} proformas yet. Raise one in Proforma invoices first.</p>
              )}
            </L>
          ) : (
            <L label={side === "sales" ? "Sales invoice *" : "Purchase invoice *"}>
              <SearchableSelect
                value={side === "sales" ? form.invoice_id : form.purchase_invoice_id}
                onChange={(v) => setForm({ ...form, [side === "sales" ? "invoice_id" : "purchase_invoice_id"]: v })}
                placeholder="Select…"
                options={(invoicesQ.data ?? []).map((i: any) => ({
                  value: i.id,
                  label: i.invoice_number,
                  hint: `${(i.debtor?.name ?? i.vendor?.name) ?? ""} · ${fmtMoney(i.amount)}`,
                }))}
              />
            </L>
          )}
          <div className="grid grid-cols-2 gap-3">
            <L label="Amount *"><input required type="number" step="0.01" min="0" className="inp" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></L>
            <L label="Date"><input required type="date" className="inp" value={form.advance_date} onChange={(e) => setForm({ ...form, advance_date: e.target.value })} /></L>
          </div>
          <L label="Reference (txn id / cheque #)"><input className="inp" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></L>
          <L label="Notes"><textarea rows={2} className="inp" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></L>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
            <button disabled={create.isPending} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>{children}</label>;
}
