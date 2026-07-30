import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, StatusPill, fmtMoney } from "@/components/ledger-ui";
import { Plus, Loader2, Save, Trash2, X } from "lucide-react";
import { TableSkeleton } from "@/components/skeletons";
import { toast } from "sonner";

export const Route = createFileRoute("/app/suppliers")({
  component: SuppliersPage,
});

type SupplierStatus = "prospect" | "active" | "suspended" | "offboarded";

type Supplier = {
  id: string;
  company_name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  industry: string | null;
  advance_rate: number;
  fee_rate: number;
  credit_limit: number;
  status: SupplierStatus;
  notes: string | null;
  created_at: string;
};

const emptyForm = {
  company_name: "",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  industry: "",
  advance_rate: 0.8,
  fee_rate: 0.025,
  credit_limit: 0,
  status: "prospect" as SupplierStatus,
  notes: "",
};

function SuppliersPage() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState(emptyForm);

  const suppliersQ = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const data = await api.suppliers.list();
      return (data ?? []).reverse() as Supplier[];
    },
  });

  const invoicesQ = useQuery({
    queryKey: ["invoices-by-supplier"],
    queryFn: async () => {
      const data = await api.invoices.list();
      return data.map((i: any) => ({ supplier_id: i.supplierId ?? i.supplier_id, amount: i.amount, status: i.status }));
    },
    enabled: isAdmin,
  });

  const exposureBy = (id: string) =>
    (invoicesQ.data ?? [])
      .filter((i: any) => i.supplier_id === id && i.status !== "paid" && i.status !== "rejected")
      .reduce((s: number, i: any) => s + Number(i.amount), 0);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.company_name.trim()) throw new Error("Company name is required");
      const payload = {
        company_name: form.company_name.trim(),
        contact_name: form.contact_name || null,
        contact_email: form.contact_email || null,
        contact_phone: form.contact_phone || null,
        industry: form.industry || null,
        advance_rate: Number(form.advance_rate),
        fee_rate: Number(form.fee_rate),
        credit_limit: Number(form.credit_limit),
        status: form.status,
        notes: form.notes || null,
      };
      if (editing) {
        await api.suppliers.update(editing.id, payload);
      } else {
        await api.suppliers.create(payload);
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Supplier updated" : "Supplier onboarded");
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      setOpen(false);
      setEditing(null);
      setForm(emptyForm);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await api.suppliers.delete(id);
    },
    onSuccess: () => {
      toast.success("Supplier removed");
      qc.invalidateQueries({ queryKey: ["suppliers"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (s: Supplier) => {
    setEditing(s);
    setForm({
      company_name: s.company_name,
      contact_name: s.contact_name ?? "",
      contact_email: s.contact_email ?? "",
      contact_phone: s.contact_phone ?? "",
      industry: s.industry ?? "",
      advance_rate: Number(s.advance_rate),
      fee_rate: Number(s.fee_rate),
      credit_limit: Number(s.credit_limit),
      status: s.status,
      notes: s.notes ?? "",
    });
    setOpen(true);
  };

  if (!isAdmin) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <div className="text-center text-sm text-muted-foreground">Factor admin only.</div>
      </div>
    );
  }

  const suppliers = suppliersQ.data ?? [];
  const totalLimit = suppliers.reduce((s, x) => s + Number(x.credit_limit), 0);
  const activeCount = suppliers.filter((s) => s.status === "active").length;

  return (
    <div>
      <PageHeader
        eyebrow="Onboarding"
        title="Suppliers"
        description="The companies whose invoices you finance. Set terms, credit lines, and lifecycle status."
        actions={
          <button
            onClick={openNew}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            <Plus className="h-4 w-4" /> Onboard supplier
          </button>
        }
      />

      <div className="grid gap-4 p-6 md:grid-cols-3 md:p-10">
        <Card title="Total suppliers">
          <div className="num text-3xl">{suppliers.length}</div>
          <div className="mt-1 text-xs text-muted-foreground">{activeCount} active</div>
        </Card>
        <Card title="Aggregate credit line">
          <div className="num text-3xl text-primary">{fmtMoney(totalLimit)}</div>
        </Card>
        <Card title="Open exposure">
          <div className="num text-3xl">
            {fmtMoney(
              (invoicesQ.data ?? [])
                .filter((i: any) => i.status !== "paid" && i.status !== "rejected")
                .reduce((s: number, i: any) => s + Number(i.amount), 0),
            )}
          </div>
        </Card>
      </div>

      <div className="px-6 pb-10 md:px-10">
        <Card>
          {suppliersQ.isLoading ? (
            <TableSkeleton rows={5} cols={8} />
          ) : suppliers.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No suppliers yet. Click <span className="text-foreground">Onboard supplier</span> to add the first one.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-3 py-3 text-left">Company</th>
                    <th className="px-3 py-3 text-left">Contact</th>
                    <th className="px-3 py-3 text-right">Advance</th>
                    <th className="px-3 py-3 text-right">Fee</th>
                    <th className="px-3 py-3 text-right">Credit limit</th>
                    <th className="px-3 py-3 text-right">Exposure</th>
                    <th className="px-3 py-3 text-left">Status</th>
                    <th className="px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((s) => {
                    const exposure = exposureBy(s.id);
                    const util = Number(s.credit_limit) > 0 ? exposure / Number(s.credit_limit) : 0;
                    return (
                      <tr key={s.id} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-3 py-3">
                          <div className="font-medium">{s.company_name}</div>
                          <div className="text-xs text-muted-foreground">{s.industry ?? "—"}</div>
                        </td>
                        <td className="px-3 py-3">
                          <div>{s.contact_name ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{s.contact_email ?? ""}</div>
                        </td>
                        <td className="px-3 py-3 text-right num">{(Number(s.advance_rate) * 100).toFixed(1)}%</td>
                        <td className="px-3 py-3 text-right num">{(Number(s.fee_rate) * 100).toFixed(2)}%</td>
                        <td className="px-3 py-3 text-right num">{fmtMoney(s.credit_limit)}</td>
                        <td className="px-3 py-3 text-right num">
                          <div className={util > 0.85 ? "text-destructive" : util > 0.6 ? "text-warning" : ""}>{fmtMoney(exposure)}</div>
                          {Number(s.credit_limit) > 0 && (
                            <div className="text-xs text-muted-foreground">{(util * 100).toFixed(0)}%</div>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <StatusPill status={s.status} />
                        </td>
                        <td className="px-3 py-3 text-right">
                          <button
                            onClick={() => openEdit(s)}
                            className="rounded-md border border-border px-3 py-1 text-xs hover:border-primary hover:text-primary"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => {
                              if (confirm(`Remove ${s.company_name}?`)) remove.mutate(s.id);
                            }}
                            className="ml-2 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:border-destructive hover:text-destructive"
                            aria-label="Remove"
                          >
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

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-2xl rounded-xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h3 className="font-display text-lg">{editing ? "Edit supplier" : "Onboard new supplier"}</h3>
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-4 p-5 md:grid-cols-2">
              <F label="Company name *">
                <input className="inp" value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} />
              </F>
              <F label="Industry">
                <input className="inp" value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
              </F>
              <F label="Contact name">
                <input className="inp" value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
              </F>
              <F label="Contact email">
                <input type="email" className="inp" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} />
              </F>
              <F label="Contact phone">
                <input className="inp" value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} />
              </F>
              <F label="Status">
                <select className="inp" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as SupplierStatus })}>
                  <option value="prospect">Prospect</option>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                  <option value="offboarded">Offboarded</option>
                </select>
              </F>
              <F label="Advance rate (0–1)">
                <input type="number" step="0.01" min="0" max="1" className="inp" value={form.advance_rate}
                  onChange={(e) => setForm({ ...form, advance_rate: Number(e.target.value) })} />
              </F>
              <F label="Fee rate (0–1)">
                <input type="number" step="0.001" min="0" max="1" className="inp" value={form.fee_rate}
                  onChange={(e) => setForm({ ...form, fee_rate: Number(e.target.value) })} />
              </F>
              <F label="Credit limit (USD)">
                <input type="number" step="1000" min="0" className="inp" value={form.credit_limit}
                  onChange={(e) => setForm({ ...form, credit_limit: Number(e.target.value) })} />
              </F>
              <F label="Notes" full>
                <textarea rows={3} className="inp" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </F>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
              <button onClick={() => setOpen(false)} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
              <button
                onClick={() => save.mutate()}
                disabled={save.isPending}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {editing ? "Save changes" : "Onboard"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
    </div>
  );
}

function F({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block ${full ? "md:col-span-2" : ""}`}>
      <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
