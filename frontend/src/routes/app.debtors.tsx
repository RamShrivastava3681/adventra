import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney } from "@/components/ledger-ui";
import { Plus, X, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/debtors")({
  component: DebtorsPage,
});

function DebtorsPage() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [viewing, setViewing] = useState<any | null>(null);

  const debtorsQ = useQuery({
    queryKey: ["debtors-full"],
    queryFn: async () => {
      const data = await api.debtors.list();
      return data.sort((a: any, b: any) => a.name?.localeCompare(b.name ?? "") ?? 0);
    },
  });

  const invoicesQ = useQuery({
    queryKey: ["invoices-for-debtors"],
    queryFn: async () => {
      const data = await api.invoices.list();
      return data.map((i: any) => ({ debtor_id: i.debtorId ?? i.debtor_id, amount: i.amount, status: i.status }));
    },
  });

  const exposureFor = (id: string) =>
    (invoicesQ.data ?? [])
      .filter((i) => i.debtor_id === id && i.status !== "paid" && i.status !== "rejected")
      .reduce((s, i) => s + Number(i.amount), 0);

  return (
    <div>
      <PageHeader
        eyebrow="Counterparties"
        title="Debtor book"
        description="Payment terms and live exposure across every payer."
        actions={
          isAdmin && (
            <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              <Plus className="h-4 w-4" /> Add debtor
            </button>
          )
        }
      />

      <div className="p-6 md:p-10">
        <Card>
          {(debtorsQ.data ?? []).length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <ShieldAlert className="mx-auto mb-3 h-6 w-6" />
              No debtors yet.
              {isAdmin && <div className="mt-3"><button onClick={() => setOpen(true)} className="text-primary">Add one →</button></div>}
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Name</th>
                    <th className="px-5 py-2 text-left font-normal">Industry</th>
                    <th className="px-5 py-2 text-right font-normal">Exposure</th>
                    <th className="px-5 py-2 text-right font-normal">Terms</th>
                    <th className="px-5 py-2 text-right font-normal" />
                  </tr>
                </thead>
                <tbody>
                  {(debtorsQ.data ?? []).map((d) => {
                    const exposure = exposureFor(d.id);
                    return (
                      <tr key={d.id} className="border-b border-border/60">
                        <td className="px-5 py-3 font-medium">{d.name}</td>
                        <td className="px-5 py-3 text-muted-foreground">{d.industry ?? "—"}</td>
                        <td className="px-5 py-3 text-right num">{fmtMoney(exposure)}</td>
                        <td className="px-5 py-3 text-right text-muted-foreground">Net {d.payment_terms_days}</td>
                        <td className="px-5 py-3 text-right whitespace-nowrap">
                          <button onClick={() => setViewing(d)} className="rounded-md border border-border px-3 py-1 text-xs hover:border-primary hover:text-primary">View</button>
                          {isAdmin && (
                            <button onClick={() => setEditing(d)} className="ml-2 rounded-md border border-border px-3 py-1 text-xs hover:border-primary hover:text-primary">Edit</button>
                          )}
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

      {open && <DebtorModal onClose={() => setOpen(false)} onSaved={() => qc.invalidateQueries({ queryKey: ["debtors-full"] })} />}
      {editing && <DebtorModal debtor={editing} onClose={() => setEditing(null)} onSaved={() => qc.invalidateQueries({ queryKey: ["debtors-full"] })} />}
      {viewing && <DebtorDetailModal debtor={viewing} exposure={exposureFor(viewing.id)} onClose={() => setViewing(null)} />}
    </div>
  );
}

function DebtorModal({ debtor, onClose, onSaved }: { debtor?: any; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!debtor;
  const [form, setForm] = useState({
    name: debtor?.name ?? "", industry: debtor?.industry ?? "", payment_terms_days: String(debtor?.payment_terms_days ?? debtor?.paymentTermsDays ?? "30"),
    address_line: debtor?.address_line ?? "", city: debtor?.city ?? "", country: debtor?.country ?? "", postal_code: debtor?.postal_code ?? "", phone: debtor?.phone ?? "", website: debtor?.website ?? "",
    contact_name: debtor?.contact_name ?? "", contact_email: debtor?.contact_email ?? "", contact_designation: debtor?.contact_designation ?? "", contact_phone: debtor?.contact_phone ?? "",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Name is required");
      if (form.contact_email && !/^\S+@\S+\.\S+$/.test(form.contact_email)) throw new Error("Invalid contact email");
      if (form.website && form.website.length > 255) throw new Error("Website too long");
      const payload = {
        name: form.name.trim(),
        industry: form.industry || null,
        payment_terms_days: Number(form.payment_terms_days),
        address_line: form.address_line || null,
        city: form.city || null,
        country: form.country || null,
        postal_code: form.postal_code || null,
        phone: form.phone || null,
        website: form.website || null,
        contact_name: form.contact_name || null,
        contact_email: form.contact_email || null,
        contact_designation: form.contact_designation || null,
        contact_phone: form.contact_phone || null,
      };
      if (isEdit && debtor) {
        await api.debtors.update(debtor.id, payload);
      } else {
        await api.debtors.create(payload);
      }
    },
    onSuccess: () => { onSaved(); toast.success(isEdit ? "Debtor updated" : "Debtor added"); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card shadow-vault" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">{isEdit ? "Edit debtor" : "Add debtor"}</h3>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-5 p-5">
          <Section title="Company">
            <div className="grid gap-3 md:grid-cols-2">
              <L label="Name *"><input required maxLength={200} className="inp" value={form.name} onChange={set("name")} /></L>
              <L label="Industry"><input maxLength={100} className="inp" value={form.industry} onChange={set("industry")} /></L>
              <L label="Website"><input type="url" maxLength={255} placeholder="https://" className="inp" value={form.website} onChange={set("website")} /></L>
              <L label="Phone"><input maxLength={40} className="inp" value={form.phone} onChange={set("phone")} /></L>
            </div>
          </Section>

          <Section title="Address">
            <div className="grid gap-3 md:grid-cols-2">
              <L label="Address" full><input maxLength={300} className="inp" value={form.address_line} onChange={set("address_line")} /></L>
              <L label="City"><input maxLength={100} className="inp" value={form.city} onChange={set("city")} /></L>
              <L label="Country"><input maxLength={100} className="inp" value={form.country} onChange={set("country")} /></L>
              <L label="PIN / Postal code"><input maxLength={20} className="inp" value={form.postal_code} onChange={set("postal_code")} /></L>
            </div>
          </Section>

          <Section title="Primary contact">
            <div className="grid gap-3 md:grid-cols-2">
              <L label="Contact name"><input maxLength={120} className="inp" value={form.contact_name} onChange={set("contact_name")} /></L>
              <L label="Designation"><input maxLength={120} className="inp" value={form.contact_designation} onChange={set("contact_designation")} /></L>
              <L label="Email"><input type="email" maxLength={255} className="inp" value={form.contact_email} onChange={set("contact_email")} /></L>
              <L label="Phone"><input maxLength={40} className="inp" value={form.contact_phone} onChange={set("contact_phone")} /></L>
            </div>
          </Section>

          <Section title="Payment terms">
            <div className="grid gap-3 md:grid-cols-3">
              <L label="Payment terms (days)"><input required type="number" min="0" className="inp" value={form.payment_terms_days} onChange={set("payment_terms_days")} /></L>
            </div>
          </Section>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
            <button disabled={save.isPending} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {isEdit ? "Save changes" : "Create"}
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

function DebtorDetailModal({ debtor, exposure, onClose }: { debtor: any; exposure: number; onClose: () => void }) {
  const address = [debtor.address_line, debtor.city, debtor.country, debtor.postal_code].filter(Boolean).join(", ");
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-vault" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="font-display text-lg">{debtor.name}</h3>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 p-5 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <D label="Industry" value={debtor.industry ?? "—"} />
            <D label="Payment terms" value={`Net ${debtor.payment_terms_days ?? debtor.paymentTermsDays ?? "—"}`} />
            <D label="Open exposure" value={<span className="num">{fmtMoney(exposure)}</span>} />
            <D label="Website" value={debtor.website ?? "—"} />
            <D label="Phone" value={debtor.phone ?? "—"} />
            <div className="col-span-2"><D label="Address" value={address || "—"} /></div>
            <D label="Contact name" value={debtor.contact_name ?? "—"} />
            <D label="Designation" value={debtor.contact_designation ?? "—"} />
            <D label="Contact email" value={debtor.contact_email ?? "—"} />
            <D label="Contact phone" value={debtor.contact_phone ?? "—"} />
          </div>
          <div className="flex justify-end border-t border-border pt-3">
            <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function D({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs uppercase tracking-widest text-primary">{title}</div>
      {children}
    </div>
  );
}

function L({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return <label className={`block ${full ? "md:col-span-2" : ""}`}><span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>{children}</label>;
}
