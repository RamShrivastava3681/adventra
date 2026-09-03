import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, StatusPill, fmtMoney } from "@/components/ledger-ui";
import { Plus, Loader2, Save, Trash2, X, Truck } from "lucide-react";
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
  address_line: string | null;
  city: string | null;
  country: string | null;
  postal_code: string | null;
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
  address_line: "",
  city: "",
  country: "",
  postal_code: "",
  status: "prospect" as SupplierStatus,
  notes: "",
};

function SuppliersPage() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [viewing, setViewing] = useState<Supplier | null>(null);
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
      return data.map((i: any) => ({
        supplier_id: i.supplierId ?? i.supplier_id,
        amount: i.amount,
        status: i.status,
      }));
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
        address_line: form.address_line || null,
        city: form.city || null,
        country: form.country || null,
        postal_code: form.postal_code || null,
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
      address_line: s.address_line ?? "",
      city: s.city ?? "",
      country: s.country ?? "",
      postal_code: s.postal_code ?? "",
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
  const activeCount = suppliers.filter((s) => s.status === "active").length;

  return (
    <div>
      <PageHeader
        eyebrow="Onboarding"
        title="Suppliers"
        description="The companies whose invoices you finance. Track contacts and lifecycle status."
        icon={<Truck className="h-5 w-5" />}
        actions={
          <button
            onClick={openNew}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            <Plus className="h-4 w-4" /> Onboard supplier
          </button>
        }
      />

      <div className="grid gap-4 p-6 md:grid-cols-2 md:p-10">
        <Card title="Total suppliers">
          <div className="num text-3xl">{suppliers.length}</div>
          <div className="mt-1 text-xs text-muted-foreground">{activeCount} active</div>
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
            <TableSkeleton rows={5} cols={5} />
          ) : suppliers.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No suppliers yet. Click <span className="text-foreground">Onboard supplier</span> to
              add the first one.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-3 py-3 text-left">Company</th>
                    <th className="px-3 py-3 text-left">Contact</th>
                    <th className="px-3 py-3 text-right">Exposure</th>
                    <th className="px-3 py-3 text-left">Status</th>
                    <th className="px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((s) => {
                    const exposure = exposureBy(s.id);
                    return (
                      <tr key={s.id} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-3 py-3">
                          <div className="font-medium">{s.company_name}</div>
                          <div className="text-xs text-muted-foreground">{s.industry ?? "—"}</div>
                          {(s.city || s.country) && (
                            <div className="text-xs text-muted-foreground/70">
                              {[s.city, s.country].filter(Boolean).join(", ")}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <div>{s.contact_name ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">
                            {s.contact_email ?? ""}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right num">{fmtMoney(exposure)}</td>
                        <td className="px-3 py-3">
                          <StatusPill status={s.status} />
                        </td>
                        <td className="px-3 py-3 text-right">
                          <button
                            onClick={() => setViewing(s)}
                            className="rounded-md border border-border px-3 py-1 text-xs hover:border-primary hover:text-primary"
                          >
                            View
                          </button>
                          <button
                            onClick={() => openEdit(s)}
                            className="ml-2 rounded-md border border-border px-3 py-1 text-xs hover:border-primary hover:text-primary"
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

      {viewing && (
        <SupplierDetailModal
          supplier={viewing}
          exposure={exposureBy(viewing.id)}
          onClose={() => setViewing(null)}
        />
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
              <h3 className="font-display text-lg">
                {editing ? "Edit supplier" : "Onboard new supplier"}
              </h3>
              <button
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-4 p-5 md:grid-cols-2">
              <F label="Company name *">
                <input
                  className="inp"
                  value={form.company_name}
                  onChange={(e) => setForm({ ...form, company_name: e.target.value })}
                />
              </F>
              <F label="Industry">
                <input
                  className="inp"
                  value={form.industry}
                  onChange={(e) => setForm({ ...form, industry: e.target.value })}
                />
              </F>
              <F label="Address" full>
                <input
                  maxLength={300}
                  className="inp"
                  value={form.address_line}
                  onChange={(e) => setForm({ ...form, address_line: e.target.value })}
                />
              </F>
              <F label="City">
                <input
                  maxLength={100}
                  className="inp"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                />
              </F>
              <F label="Country">
                <input
                  maxLength={100}
                  className="inp"
                  value={form.country}
                  onChange={(e) => setForm({ ...form, country: e.target.value })}
                />
              </F>
              <F label="PIN / Postal code">
                <input
                  maxLength={20}
                  className="inp"
                  value={form.postal_code}
                  onChange={(e) => setForm({ ...form, postal_code: e.target.value })}
                />
              </F>
              <F label="Contact name">
                <input
                  className="inp"
                  value={form.contact_name}
                  onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
                />
              </F>
              <F label="Contact email">
                <input
                  type="email"
                  className="inp"
                  value={form.contact_email}
                  onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
                />
              </F>
              <F label="Contact phone">
                <input
                  className="inp"
                  value={form.contact_phone}
                  onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
                />
              </F>
              <F label="Status">
                <select
                  className="inp"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as SupplierStatus })}
                >
                  <option value="prospect">Prospect</option>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                  <option value="offboarded">Offboarded</option>
                </select>
              </F>
              <F label="Notes" full>
                <textarea
                  rows={3}
                  className="inp"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </F>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
              <button
                onClick={() => setOpen(false)}
                className="rounded-md border border-border px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => save.mutate()}
                disabled={save.isPending}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {save.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
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

function F({
  label,
  full,
  children,
}: {
  label: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${full ? "md:col-span-2" : ""}`}>
      <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function SupplierDetailModal({
  supplier,
  exposure,
  onClose,
}: {
  supplier: Supplier;
  exposure: number;
  onClose: () => void;
}) {
  const address = [supplier.address_line, supplier.city, supplier.country, supplier.postal_code]
    .filter(Boolean)
    .join(", ");
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card shadow-vault"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">{supplier.company_name}</h3>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 p-5 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <Detail label="Industry" value={supplier.industry ?? "—"} />
            <Detail label="Status" value={<StatusPill status={supplier.status} />} />
            <Detail label="Contact name" value={supplier.contact_name ?? "—"} />
            <Detail label="Contact email" value={supplier.contact_email ?? "—"} />
            <Detail label="Contact phone" value={supplier.contact_phone ?? "—"} />
            <Detail
              label="Open exposure"
              value={<span className="num">{fmtMoney(exposure)}</span>}
            />
            <div className="col-span-2">
              <Detail label="Address" value={address || "—"} />
            </div>
            <div className="col-span-2">
              <Detail label="Notes" value={supplier.notes ?? "—"} />
            </div>
          </div>
          <div className="flex justify-end border-t border-border pt-3">
            <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}
