import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney } from "@/components/ledger-ui";
import { Plus, X, Loader2, Building2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/vendors")({
  component: VendorsPage,
});

function VendorsPage() {
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const vendorsQ = useQuery({
    queryKey: ["vendors"],
    queryFn: async () => {
      const data = await api.vendors.list();
      return data.sort((a: any, b: any) => a.name?.localeCompare(b.name ?? "") ?? 0);
    },
  });

  const piQ = useQuery({
    queryKey: ["pi-for-vendors"],
    queryFn: async () => {
      const data = await api.purchaseInvoices.list();
      return data.map((p: any) => ({ vendor_id: p.vendorId ?? p.vendor_id, amount: p.amount, status: p.status }));
    },
  });

  const openFor = (id: string) =>
    (piQ.data ?? [])
      .filter((p: any) => p.vendor_id === id && p.status !== "paid")
      .reduce((s: number, p: any) => s + Number(p.amount), 0);

  return (
    <div>
      <PageHeader
        eyebrow="Procurement"
        title="Suppliers"
        description="The vendors you buy from. Track contacts, terms, and open payables."
        actions={
          <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            <Plus className="h-4 w-4" /> Add supplier
          </button>
        }
      />

      <div className="p-6 md:p-10">
        <Card>
          {(vendorsQ.data ?? []).length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <Building2 className="mx-auto mb-3 h-6 w-6" />
              No suppliers yet.
              <div className="mt-3"><button onClick={() => setOpen(true)} className="text-primary">Add one →</button></div>
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Supplier</th>
                    <th className="px-5 py-2 text-left font-normal">Contact</th>
                    <th className="px-5 py-2 text-left font-normal">Location</th>
                    <th className="px-5 py-2 text-right font-normal">Terms</th>
                    <th className="px-5 py-2 text-right font-normal">Open AP</th>
                  </tr>
                </thead>
                <tbody>
                  {(vendorsQ.data ?? []).map((v: any) => (
                    <tr key={v.id} className="border-b border-border/60">
                      <td className="px-5 py-3">
                        <div className="font-medium">{v.name}</div>
                        <div className="text-xs text-muted-foreground">{v.industry ?? "—"}</div>
                      </td>
                      <td className="px-5 py-3">
                        <div>{v.contact_name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{v.contact_email ?? ""}</div>
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {[v.city, v.country].filter(Boolean).join(", ") || "—"}
                      </td>
                      <td className="px-5 py-3 text-right text-muted-foreground">Net {v.payment_terms_days}</td>
                      <td className="px-5 py-3 text-right num">{fmtMoney(openFor(v.id))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {open && user && (
        <AddVendorModal
          userId={user.id}
          onClose={() => setOpen(false)}
          onCreated={() => qc.invalidateQueries({ queryKey: ["vendors"] })}
        />
      )}
    </div>
  );
}

function AddVendorModal({ userId, onClose, onCreated }: { userId: string; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    name: "", industry: "", payment_terms_days: "30",
    address_line: "", city: "", country: "", postal_code: "", phone: "", website: "",
    contact_name: "", contact_email: "", contact_designation: "", contact_phone: "",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const create = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Name is required");
      if (form.contact_email && !/^\S+@\S+\.\S+$/.test(form.contact_email)) throw new Error("Invalid contact email");
      await api.vendors.create({
        clientId: userId,
        name: form.name.trim(),
        industry: form.industry || null,
        payment_terms_days: Number(form.payment_terms_days) || 30,
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
      });
    },
    onSuccess: () => { onCreated(); toast.success("Supplier added"); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card shadow-vault" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">Add supplier</h3>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-5 p-5">
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

          <Section title="Terms">
            <div className="grid gap-3 md:grid-cols-3">
              <L label="Payment terms (days)"><input required type="number" min="0" className="inp" value={form.payment_terms_days} onChange={set("payment_terms_days")} /></L>
            </div>
          </Section>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
            <button disabled={create.isPending} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Create
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
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
