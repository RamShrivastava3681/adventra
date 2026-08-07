import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import { Plus, Trash2, X, Loader2, Link2, Paperclip } from "lucide-react";
import { TableSkeleton } from "@/components/skeletons";
import { toast } from "sonner";
import { DocumentUploader, DocumentList, type DocMeta } from "@/components/document-uploader";
import { SearchableSelect } from "@/components/ui/searchable-select";

export const Route = createFileRoute("/app/expenses")({
  component: ExpensesPage,
});

const CATS = [
  { id: "logistics", label: "Logistics" },
  { id: "insurance", label: "Insurance" },
  { id: "interest", label: "Interest" },
  { id: "administrative", label: "Administrative" },
  { id: "other", label: "Other" },
];

function catLabel(id: string) {
  return CATS.find((c) => c.id === id)?.label ?? id;
}

function ExpensesPage() {
  const { user, isAdmin, isClient, isChecker, isTreasury } = useAuth();
  const canCreate = isAdmin || (isClient && !isChecker && !isTreasury);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<any | null>(null);

  const expensesQ = useQuery({
    queryKey: ["expenses"],
    queryFn: async () => {
      const data = await api.expenses.list();
      return data.reverse();
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await api.expenses.delete(id);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["expenses"] }); toast.success("Removed"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const rows = expensesQ.data ?? [];
  const byCat = CATS.map((c) => ({
    ...c,
    total: rows.filter((r: any) => r.category === c.id).reduce((s: number, r: any) => s + Number(r.amount), 0),
  }));
  const total = rows.reduce((s: number, r: any) => s + Number(r.amount), 0);

  return (
    <div>
      <PageHeader
        eyebrow="Operating costs"
        title="Expenses"
        description="Log logistics, insurance, interest, and other operating costs — link each to a sales or purchase invoice for true per-deal economics."
        actions={
          canCreate ? (
            <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              <Plus className="h-4 w-4" /> Log expense
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
              Read-only · {isChecker ? "Checker" : isTreasury ? "Treasury" : "View"}
            </span>
          )
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
          <Card title="Total expenses">
            <div className="num text-2xl">{fmtMoney(total)}</div>
            <div className="mt-1 text-xs text-muted-foreground">{rows.length} entries</div>
          </Card>
          {byCat.map((c) => (
            <Card key={c.id} title={c.label}>
              <div className="num text-2xl">{fmtMoney(c.total)}</div>
            </Card>
          ))}
        </div>

        <Card>
          {expensesQ.isLoading ? (
            <TableSkeleton rows={5} cols={7} />
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No expenses logged yet.</div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Date</th>
                    <th className="px-5 py-2 text-left font-normal">Category</th>
                    <th className="px-5 py-2 text-left font-normal">Linked transaction</th>
                    <th className="px-5 py-2 text-left font-normal">Description</th>
                    <th className="px-5 py-2 text-right font-normal">Docs</th>
                    <th className="px-5 py-2 text-right font-normal">Amount</th>
                    <th className="px-5 py-2 text-right font-normal" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any) => {
                    const link = r.invoice?.invoice_number
                      ? { kind: "Sale", num: r.invoice.invoice_number }
                      : r.purchase?.invoice_number
                        ? { kind: "Purchase", num: r.purchase.invoice_number }
                        : null;
                    const docs: DocMeta[] = Array.isArray(r.documents) ? r.documents : [];
                    return (
                      <tr key={r.id} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-3">{fmtDate(r.expense_date)}</td>
                        <td className="px-5 py-3">{catLabel(r.category)}</td>
                        <td className="px-5 py-3">
                          {link ? (
                            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background/40 px-2 py-0.5 text-xs">
                              <Link2 className="h-3 w-3 text-primary" />
                              <span className="text-muted-foreground">{link.kind}</span>
                              <span className="font-mono">{link.num}</span>
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Unlinked</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-muted-foreground">{r.description ?? "—"}</td>
                        <td className="px-5 py-3 text-right">
                          {docs.length > 0 ? (
                            <button
                              onClick={() => setViewing(r)}
                              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[10px] hover:border-primary hover:text-primary"
                            >
                              <Paperclip className="h-3 w-3" />{docs.length}
                            </button>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right num">{fmtMoney(r.amount)}</td>
                        <td className="px-5 py-3 text-right">
                          <button onClick={() => { if (confirm("Delete this expense?")) remove.mutate(r.id); }}
                            className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:border-destructive hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
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

      {open && user && (
        <NewExpenseModal
          userId={user.id}
          onClose={() => setOpen(false)}
          onCreated={() => qc.invalidateQueries({ queryKey: ["expenses"] })}
        />
      )}

      {viewing && (
        <ExpenseDetailModal expense={viewing} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}

function ExpenseDetailModal({ expense, onClose }: { expense: any; onClose: () => void }) {
  const link = expense.invoice?.invoice_number
    ? { kind: "Sales invoice", num: expense.invoice.invoice_number }
    : expense.purchase?.invoice_number
      ? { kind: "Purchase invoice", num: expense.purchase.invoice_number }
      : null;
  const docs: DocMeta[] = Array.isArray(expense.documents) ? expense.documents : [];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-vault" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="font-display text-lg">Expense detail</h3>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 p-5 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <Detail label="Date" value={fmtDate(expense.expense_date)} />
            <Detail label="Category" value={catLabel(expense.category)} />
            <Detail label="Amount" value={fmtMoney(expense.amount)} />
            <Detail label="Linked" value={link ? `${link.kind} · ${link.num}` : "Unlinked"} />
          </div>
          {expense.description && (
            <div>
              <div className="mb-1 text-xs uppercase tracking-widest text-muted-foreground">Description</div>
              <p className="text-muted-foreground">{expense.description}</p>
            </div>
          )}
          <div>
            <div className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Attachments</div>
            <DocumentList docs={docs} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}

function NewExpenseModal({ userId, onClose, onCreated }: { userId: string; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    category: "logistics",
    description: "",
    amount: "",
    expense_date: new Date().toISOString().slice(0, 10),
    link_kind: "none" as "none" | "sale" | "purchase",
    link_id: "",
  });
  const [docs, setDocs] = useState<DocMeta[]>([]);

  const salesQ = useQuery({
    queryKey: ["expense-link-sales"],
    queryFn: async () => {
      const data = await api.invoices.list();
      return data.map((i: any) => ({ id: i.id, invoice_number: i.invoiceNumber ?? i.invoice_number, amount: i.amount })).reverse().slice(0, 200);
    },
  });
  const purchQ = useQuery({
    queryKey: ["expense-link-purchases"],
    queryFn: async () => {
      const data = await api.purchaseInvoices.list();
      return data.map((i: any) => ({ id: i.id, invoice_number: i.invoiceNumber ?? i.invoice_number, amount: i.amount })).reverse().slice(0, 200);
    },
  });

  const linkOptions = useMemo(() => {
    if (form.link_kind === "sale") return salesQ.data ?? [];
    if (form.link_kind === "purchase") return purchQ.data ?? [];
    return [];
  }, [form.link_kind, salesQ.data, purchQ.data]);

  const create = useMutation({
    mutationFn: async () => {
      if (!form.amount || Number(form.amount) <= 0) throw new Error("Amount must be > 0");
      if (form.link_kind !== "none" && !form.link_id) throw new Error("Select the linked invoice");
      const payload: any = {
        client_id: userId,
        category: form.category,
        description: form.description || null,
        amount: Number(form.amount),
        expense_date: form.expense_date,
        invoice_id: form.link_kind === "sale" && form.link_id ? form.link_id : null,
        purchase_invoice_id: form.link_kind === "purchase" && form.link_id ? form.link_id : null,
        documents: docs,
      };
      await api.expenses.create(payload);
    },
    onSuccess: () => { onCreated(); toast.success("Expense logged"); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-vault" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="font-display text-lg">Log expense</h3>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-4 p-5">
          <L label="Category">
            <select className="inp" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </L>
          <div className="grid grid-cols-2 gap-3">
            <L label="Amount (USD) *">
              <input required type="number" step="0.01" min="0" className="inp" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </L>
            <L label="Date">
              <input required type="date" className="inp" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} />
            </L>
          </div>
          <L label="Link to transaction">
            <select
              className="inp"
              value={form.link_kind}
              onChange={(e) => setForm({ ...form, link_kind: e.target.value as "none" | "sale" | "purchase", link_id: "" })}
            >
              <option value="none">Not linked</option>
              <option value="sale">Sales invoice</option>
              <option value="purchase">Purchase invoice</option>
            </select>
          </L>
          {form.link_kind !== "none" && (
            <L label={form.link_kind === "sale" ? "Sales invoice" : "Purchase invoice"}>
              <SearchableSelect
                value={form.link_id}
                onChange={(v) => setForm({ ...form, link_id: v })}
                placeholder="Select…"
                options={linkOptions.map((o: any) => ({
                  value: o.id,
                  label: o.invoice_number,
                  hint: fmtMoney(Number(o.amount)),
                }))}
              />
            </L>
          )}
          <L label="Description">
            <textarea rows={2} className="inp" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </L>
          <DocumentUploader userId={userId} scope="expenses" docs={docs} onChange={setDocs}
            hint="Attach receipts, invoices, or any supporting paperwork." />

          <div className="flex justify-end gap-2 pt-1">
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
