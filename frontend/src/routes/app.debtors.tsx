import { createFileRoute } from "@tanstack/react-router";
import {
  PaymentTermsFields,
  formatPaymentTerms,
  toFormFields as toTermsFormFields,
  toPayload as toTermsPayload,
} from "@/components/payment-terms";
import {
  Dialog,
  DialogWithStickyFooter,
  Field,
  inputBase,
  textareaBase,
  selectBase,
  TwoFieldGrid,
  InfoPanel,
} from "@/components/dialog";
import { LineHeaders, AddLineButton } from "@/components/dialog/LineRow";
import { CustomerTermsManager } from "@/components/customer-terms";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney } from "@/components/ledger-ui";
import { Plus, X, Loader2, ShieldAlert, Building2 } from "lucide-react";
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
      return data.map((i: any) => ({
        debtor_id: i.debtorId ?? i.debtor_id,
        amount: i.amount,
        status: i.status,
      }));
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
        icon={<Building2 className="h-5 w-5" />}
        actions={
          isAdmin && (
            <button
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
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
              {isAdmin && (
                <div className="mt-3">
                  <button onClick={() => setOpen(true)} className="text-primary">
                    Add one →
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table-premium w-full text-sm">                  <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Name</th>
                    <th className="px-5 py-2 text-left font-normal">Salesman</th>
                    <th className="px-5 py-2 text-left font-normal">Industry</th>
                    <th className="px-5 py-2 text-left font-normal">PAN</th>
                    <th className="px-5 py-2 text-left font-normal">GSTIN</th>
                    <th className="px-5 py-2 text-right font-normal">Exposure</th>
                    <th className="px-5 py-2 text-right font-normal">Terms</th>
                    <th className="px-5 py-2 text-right font-normal" />
                  </tr>
                </thead>
                <tbody>                      {(debtorsQ.data ?? []).map((d) => {
                    const exposure = exposureFor(d.id);
                    return (
                      <tr key={d.id} className="border-b border-border/60">
                        <td className="px-5 py-3 font-medium">{d.name}</td>
                        <td className="px-5 py-3 text-muted-foreground">
                          {(d.salesman_name || d.salesman_phone || d.salesman_email) ? (
                            <div className="text-xs">
                              {d.salesman_name && <div>{d.salesman_name}</div>}
                              {(d.salesman_phone || d.salesman_email) && (
                                <div className="text-muted-foreground">
                                  {d.salesman_phone && <span>{d.salesman_phone} </span>}
                                  {d.salesman_email && <span>{d.salesman_email}</span>}
                                </div>
                              )}
                            </div>
                          ) : ("\u2014")}
                        </td>
                        <td className="px-5 py-3 text-muted-foreground">{d.industry ?? "—"}</td>
                        <td className="px-5 py-3 text-xs font-mono text-muted-foreground">{d.panCardNo ?? d.pan_card_no ?? "—"}</td>
                        <td className="px-5 py-3 text-xs font-mono text-muted-foreground">{d.gstin ?? "—"}</td>
                        <td className="px-5 py-3 text-right num">{fmtMoney(exposure)}</td>
                        <td className="px-5 py-3 text-right text-muted-foreground">
                          {formatPaymentTerms({
                            paymentTermsType: d.paymentTermsType ?? d.payment_terms_type,
                            advancePct: d.advancePct ?? d.advance_pct,
                            paymentTermsDays: d.payment_terms_days ?? d.paymentTermsDays,
                            paymentTerms: d.payment_terms ?? d.paymentTerms,
                          })}
                        </td>
                        <td className="px-5 py-3 text-right whitespace-nowrap">
                          <button
                            onClick={() => setViewing(d)}
                            className="rounded-md border border-border px-3 py-1 text-xs hover:border-primary hover:text-primary"
                          >
                            View
                          </button>
                          {isAdmin && (
                            <button
                              onClick={() => setEditing(d)}
                              className="ml-2 rounded-md border border-border px-3 py-1 text-xs hover:border-primary hover:text-primary"
                            >
                              Edit
                            </button>
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

      {open && (
        <DebtorModal
          onClose={() => setOpen(false)}
          onSaved={() => qc.invalidateQueries({ queryKey: ["debtors-full"] })}
        />
      )}
      {editing && (
        <DebtorModal
          debtor={editing}
          onClose={() => setEditing(null)}
          onSaved={() => qc.invalidateQueries({ queryKey: ["debtors-full"] })}
        />
      )}
      {viewing && (
        <DebtorDetailModal
          debtor={viewing}
          exposure={exposureFor(viewing.id)}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

function toAddressList(v: any): { label: string; address: string }[] {
  if (!v) return [];
  const arr = Array.isArray(v) ? v : [v];
  const out: { label: string; address: string }[] = [];
  for (const e of arr) {
    if (typeof e === "string") {
      if (e.trim()) out.push({ label: "", address: e.trim() });
    } else if (e && typeof e === "object") {
      const addr = e.address ?? e.address_line ?? "";
      if (typeof addr === "string" && addr.trim())
        out.push({ label: e.label ?? "", address: addr.trim() });
    }
  }
  return out;
}

function addressesFromDebtor(debtor: any, kind: "billing" | "shipping"): { label: string; address: string }[] {
  if (!debtor) return [{ label: "", address: "" }];
  const list =
    kind === "billing"
      ? (debtor.billing_addresses ?? debtor.billingAddresses ?? null)
      : (debtor.shipping_addresses ?? debtor.shippingAddresses ?? null);
  const norm = toAddressList(list);
  if (norm.length) return norm;
  // Legacy single-address fallback
  const single =
    kind === "billing"
      ? (debtor.billing_address ?? debtor.address_line ?? "")
      : (debtor.shipping_address ?? "");
  return [{ label: "", address: single ?? "" }];
}

function DebtorModal({
  debtor,
  onClose,
  onSaved,
}: {
  debtor?: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!debtor;
  const [form, setForm] = useState({
    name: debtor?.name ?? "",
    industry: debtor?.industry ?? "",
    ...toTermsFormFields(debtor),
    gstin: debtor?.gstin ?? "",
    panCardNo: debtor?.panCardNo ?? debtor?.pan_card_no ?? "",
    billing_addresses: addressesFromDebtor(debtor, "billing"),
    shipping_addresses: addressesFromDebtor(debtor, "shipping"),
    city: debtor?.city ?? "",
    country: debtor?.country ?? "",
    postal_code: debtor?.postal_code ?? "",
    phone: debtor?.phone ?? "",
    website: debtor?.website ?? "",
    contact_name: debtor?.contact_name ?? "",
    contact_email: debtor?.contact_email ?? "",
    contact_designation: debtor?.contact_designation ?? "",
    contact_phone: debtor?.contact_phone ?? "",
    salesman_name: debtor?.salesman_name ?? "",
    salesman_phone: debtor?.salesman_phone ?? "",
    salesman_email: debtor?.salesman_email ?? "",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });
  // Approved terms for this debtor (edit mode only). When terms exist, they
  // own the payment configuration and the legacy single-term fields hide.
  const termsQ = useQuery({
    queryKey: ["debtor-terms", (debtor as any)?.id ?? "new"],
    queryFn: () => api.debtors.terms.list((debtor as any).id),
    enabled: isEdit && !!(debtor as any)?.id,
  });
  const hasTerms = (termsQ.data ?? []).length > 0;
  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Name is required");
      if (form.contact_email && !/^\S+@\S+\.\S+$/.test(form.contact_email))
        throw new Error("Invalid contact email");
      if (form.website && form.website.length > 255) throw new Error("Website too long");
      const cleanBilling = form.billing_addresses
        .map((a) => ({ label: a.label.trim() || null, address: a.address.trim() }))
        .filter((a) => a.address);
      const cleanShipping = form.shipping_addresses
        .map((a) => ({ label: a.label.trim() || null, address: a.address.trim() }))
        .filter((a) => a.address);
      const payload = {
        name: form.name.trim(),
        industry: form.industry || null,
        ...toTermsPayload(form),
        gstin: form.gstin || null,
        panCardNo: form.panCardNo || null,
        billingAddress: cleanBilling[0]?.address || null,
        shippingAddress: cleanShipping[0]?.address || null,
        billingAddresses: cleanBilling.length ? cleanBilling : null,
        shippingAddresses: cleanShipping.length ? cleanShipping : null,
        city: form.city || null,
        country: form.country || null,
        postalCode: form.postal_code || null,
        phone: form.phone || null,
        website: form.website || null,
        contactName: form.contact_name || null,
        contactEmail: form.contact_email || null,
        contactDesignation: form.contact_designation || null,
        contactPhone: form.contact_phone || null,
        salesmanName: form.salesman_name || null,
        salesmanPhone: form.salesman_phone || null,
        salesmanEmail: form.salesman_email || null,
      };
      if (isEdit && debtor) {
        await api.debtors.update(debtor.id, payload);
      } else {
        await api.debtors.create(payload);
      }
    },
    onSuccess: () => {
      onSaved();
      toast.success(isEdit ? "Debtor updated" : "Debtor added");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card shadow-vault"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">{isEdit ? "Edit debtor" : "Add debtor"}</h3>
          <button onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-5 p-5"
        >
          <Section title="Company">
            <div className="grid gap-3 md:grid-cols-2">
              <L label="Name *">
                <input
                  required
                  maxLength={200}
                  className={inputBase}
                  value={form.name}
                  onChange={set("name")}
                />
              </L>
              <L label="Industry">
                <input
                  maxLength={100}
                  className={inputBase}
                  value={form.industry}
                  onChange={set("industry")}
                />
              </L>
              <L label="Website">
                <input
                  type="url"
                  maxLength={255}
                  placeholder="https://"
                  className={inputBase}
                  value={form.website}
                  onChange={set("website")}
                />
              </L>
              <L label="Phone">
                <input maxLength={40} className={inputBase} value={form.phone} onChange={set("phone")} />
              </L>
              <L label="GSTIN (for E-Way Bill)">
                <input
                  maxLength={15}
                  className={inputBase}
                  placeholder="15-digit GSTIN"
                  value={form.gstin}
                  onChange={set("gstin")}
                />
              </L>
              <L label="PAN Card No">
                <input
                  maxLength={10}
                  className={inputBase}
                  placeholder="10-character PAN"
                  value={form.panCardNo}
                  onChange={set("panCardNo")}
                />
              </L>
            </div>
          </Section>

          <Section
            title="Billing addresses"
            action={
              <button
                type="button"
                title="Add billing address"
                onClick={() =>
                  setForm({
                    ...form,
                    billing_addresses: [...form.billing_addresses, { label: "", address: "" }],
                  })
                }
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary hover:text-primary"
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            }
          >
            <div className="grid gap-3">
              {form.billing_addresses.map((a, i) => (
                <div key={i} className="rounded-md border border-border/60 p-2">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      Billing address {i + 1}
                      {i === 0 && <span className="ml-1 text-primary">(primary)</span>}
                    </span>
                    {form.billing_addresses.length > 1 && (
                      <button
                        type="button"
                        title="Remove"
                        onClick={() =>
                          setForm({
                            ...form,
                            billing_addresses: form.billing_addresses.filter((_, j) => j !== i),
                          })
                        }
                        className="rounded p-1 text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="grid gap-2">
                    <input
                      maxLength={60}
                      className={inputBase}
                      value={a.label}
                      onChange={(e) => {
                        const next = [...form.billing_addresses];
                        next[i] = { ...next[i], label: e.target.value };
                        setForm({ ...form, billing_addresses: next });
                      }}
                      placeholder="Label — e.g. HQ, Branch, Warehouse 1"
                    />
                    <textarea
                      rows={2}
                      maxLength={500}
                      className={textareaBase}
                      value={a.address}
                      onChange={(e) => {
                        const next = [...form.billing_addresses];
                        next[i] = { ...next[i], address: e.target.value };
                        setForm({ ...form, billing_addresses: next });
                      }}
                      placeholder="Street, building, landmarks…"
                    />
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section
            title="Shipping addresses"
            action={
              <button
                type="button"
                title="Add shipping address"
                onClick={() =>
                  setForm({
                    ...form,
                    shipping_addresses: [...form.shipping_addresses, { label: "", address: "" }],
                  })
                }
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary hover:text-primary"
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            }
          >
            <div className="grid gap-3">
              {form.shipping_addresses.map((a, i) => (
                <div key={i} className="rounded-md border border-border/60 p-2">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      Shipping address {i + 1}
                      {i === 0 && <span className="ml-1 text-primary">(primary)</span>}
                    </span>
                    {form.shipping_addresses.length > 1 && (
                      <button
                        type="button"
                        title="Remove"
                        onClick={() =>
                          setForm({
                            ...form,
                            shipping_addresses: form.shipping_addresses.filter((_, j) => j !== i),
                          })
                        }
                        className="rounded p-1 text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="grid gap-2">
                    <input
                      maxLength={60}
                      className={inputBase}
                      value={a.label}
                      onChange={(e) => {
                        const next = [...form.shipping_addresses];
                        next[i] = { ...next[i], label: e.target.value };
                        setForm({ ...form, shipping_addresses: next });
                      }}
                      placeholder="Label — e.g. Godown, Site, Store 2"
                    />
                    <textarea
                      rows={2}
                      maxLength={500}
                      className={textareaBase}
                      value={a.address}
                      onChange={(e) => {
                        const next = [...form.shipping_addresses];
                        next[i] = { ...next[i], address: e.target.value };
                        setForm({ ...form, shipping_addresses: next });
                      }}
                      placeholder="Separate delivery address — leave blank to use billing address"
                    />
                  </div>
                </div>
              ))}
              {form.shipping_addresses.length === 1 && !form.shipping_addresses[0].address && (
                <p className="text-[11px] text-muted-foreground">
                  Leave blank to use the billing address. Use <Plus className="inline h-3 w-3" /> Add to save multiple delivery locations.
                </p>
              )}
            </div>
          </Section>

          <Section title="City / State / ZIP">
            <div className="grid gap-3 md:grid-cols-3">
              <L label="City">
                <input maxLength={100} className={inputBase} value={form.city} onChange={set("city")} />
              </L>
              <L label="State / Country">
                <input
                  maxLength={100}
                  className={inputBase}
                  value={form.country}
                  onChange={set("country")}
                />
              </L>
              <L label="PIN / Postal code">
                <input
                  maxLength={20}
                  className={inputBase}
                  value={form.postal_code}
                  onChange={set("postal_code")}
                />
              </L>
            </div>
          </Section>

          <Section title="Primary contact">
            <div className="grid gap-3 md:grid-cols-2">
              <L label="Contact name">
                <input
                  maxLength={120}
                  className={inputBase}
                  value={form.contact_name}
                  onChange={set("contact_name")}
                />
              </L>
              <L label="Designation">
                <input
                  maxLength={120}
                  className={inputBase}
                  value={form.contact_designation}
                  onChange={set("contact_designation")}
                />
              </L>
              <L label="Email">
                <input
                  type="email"
                  maxLength={255}
                  className={inputBase}
                  value={form.contact_email}
                  onChange={set("contact_email")}
                />
              </L>
              <L label="Phone">
                <input
                  maxLength={40}
                  className={inputBase}
                  value={form.contact_phone}
                  onChange={set("contact_phone")}
                />
              </L>
            </div>
          </Section>

          <Section title="Assigned salesman">
            <div className="grid gap-3 md:grid-cols-2">
              <L label="Salesman name">
                <input
                  maxLength={120}
                  className={inputBase}
                  value={form.salesman_name}
                  onChange={set("salesman_name")}
                />
              </L>
              <L label="Salesman phone">
                <input
                  maxLength={40}
                  className={inputBase}
                  value={form.salesman_phone}
                  onChange={set("salesman_phone")}
                />
              </L>
              <L label="Salesman email">
                <input
                  type="email"
                  maxLength={255}
                  className={inputBase}
                  value={form.salesman_email}
                  onChange={set("salesman_email")}
                />
              </L>
            </div>
          </Section>

<Section title="Payment terms">
             {isEdit && (debtor as any)?.id ? (
               <div className="space-y-3">
                 <CustomerTermsManager debtorId={(debtor as any).id} />
                 {!hasTerms && (
                   <div className="grid gap-3 md:grid-cols-2">
                     <L label="Terms type (legacy — used until first approved term is added)" full>
                       <PaymentTermsFields
                         type={form.payment_terms_type}
                         advancePct={form.payment_terms_advance_pct}
                         paymentTermsDays={form.payment_terms_days}
                         daysLabel="Net days"
                         onChange={(patch) => setForm({ ...form, ...patch })}
                       />
                     </L>
                   </div>
                 )}
                 {hasTerms && (
                   <p className="text-[11px] text-muted-foreground">
                     Historic sales orders keep the term snapshot taken at order time.
                   </p>
                 )}
               </div>
             ) : (
               <div className="grid gap-3 md:grid-cols-2">
                 <L label="Terms type (becomes the default approved term)" full>
                   <PaymentTermsFields
                     type={form.payment_terms_type}
                     advancePct={form.payment_terms_advance_pct}
                     paymentTermsDays={form.payment_terms_days}
                     daysLabel="Net days"
                     onChange={(patch) => setForm({ ...form, ...patch })}
                   />
                 </L>
               </div>
             )}
           </Section>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              disabled={save.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{" "}
              {isEdit ? "Save changes" : "Create"}
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

function DebtorDetailModal({
  debtor,
  exposure,
  onClose,
}: {
  debtor: any;
  exposure: number;
  onClose: () => void;
}) {  const billingList = (() => {
    const l = toAddressList(debtor.billing_addresses ?? debtor.billingAddresses);
    if (l.length) return l.map((a) => a);
    const single = [debtor.billing_address, debtor.city, debtor.country, debtor.postal_code]
      .filter(Boolean)
      .join(", ");
    return single ? [{ label: "", address: single }] : [];
  })();
  const shippingList = (() => {
    const l = toAddressList(debtor.shipping_addresses ?? debtor.shippingAddresses);
    if (l.length) return l.map((a) => a);
    const single = [debtor.shipping_address, debtor.city, debtor.country, debtor.postal_code]
      .filter(Boolean)
      .join(", ");
    return single ? [{ label: "", address: single }] : [];
  })();
  const termsQ = useQuery({
    queryKey: ["debtor-terms", debtor?.id ?? "none"],
    queryFn: () => api.debtors.terms.list(debtor.id),
    enabled: !!debtor?.id,
  });
  const terms: any[] = termsQ.data ?? [];
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
          <h3 className="font-display text-lg">{debtor.name}</h3>
          <button onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 p-5 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <D label="Industry" value={debtor.industry ?? "—"} />
            <D
              label="Payment terms"
              value={formatPaymentTerms({
                paymentTermsType: debtor.paymentTermsType ?? debtor.payment_terms_type,
                advancePct: debtor.advancePct ?? debtor.advance_pct,
                paymentTermsDays: debtor.payment_terms_days ?? debtor.paymentTermsDays,
                paymentTerms: debtor.payment_terms ?? debtor.paymentTerms,
              })}
            />
            <D label="Open exposure" value={<span className="num">{fmtMoney(exposure)}</span>} />
            <D label="PAN" value={debtor.panCardNo ?? debtor.pan_card_no ?? "—"} />
            <D label="GSTIN" value={debtor.gstin ?? "—"} />
            <D label="Website" value={debtor.website ?? "—"} />
            <D label="Phone" value={debtor.phone ?? "—"} />
          </div>
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
              Approved terms ({terms.filter((t) => t.isActive !== false).length})
            </div>
            {termsQ.isLoading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : terms.length === 0 ? (
              <div className="text-sm">
                {formatPaymentTerms({
                  paymentTermsType: debtor.paymentTermsType ?? debtor.payment_terms_type,
                  advancePct: debtor.advancePct ?? debtor.advance_pct,
                  paymentTermsDays: debtor.payment_terms_days ?? debtor.paymentTermsDays,
                  paymentTerms: debtor.payment_terms ?? debtor.paymentTerms,
                })}
              </div>
            ) : (
              <div className="space-y-1.5">
                {terms.map((t) => (
                  <div key={t.id} className="rounded-md border border-border/60 px-2.5 py-1.5 text-sm">
                    <div>
                      {t.name}
                      {t.isDefault && (
                        <span className="ml-1 text-[10px] uppercase tracking-widest text-primary">
                          · default
                        </span>
                      )}
                      {t.isActive === false && (
                        <span className="ml-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                          · inactive
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {(() => {
                        const adv = Number(t.advancePct ?? 0) || 0;
                        const days = Number(t.balanceDueDays ?? 0) || 0;
                        const base =
                          adv >= 100
                            ? "100% Advance"
                            : adv > 0
                              ? `${adv}% Advance + Balance ${days > 0 ? `Net ${days}` : "before dispatch"}`
                              : days > 0
                                ? `Net ${days}`
                                : "No advance";
                        return base;
                      })()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Billing addresses ({billingList.length || 0})</div>
            {billingList.length === 0 ? (
              <div className="text-sm">—</div>
            ) : (
              <div className="space-y-1.5">
                {billingList.map((a, i) => (
                  <div key={i} className="rounded-md border border-border/60 px-2.5 py-1.5 text-sm">
                    {a.label && <div className="text-[10px] uppercase tracking-widest text-primary">{a.label}{i === 0 ? " · primary" : ""}</div>}
                    <div>{a.address}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Shipping addresses ({shippingList.length || 0})</div>
            {shippingList.length === 0 ? (
              <div className="text-sm">—</div>
            ) : (
              <div className="space-y-1.5">
                {shippingList.map((a, i) => (
                  <div key={i} className="rounded-md border border-border/60 px-2.5 py-1.5 text-sm">
                    {a.label && <div className="text-[10px] uppercase tracking-widest text-primary">{a.label}{i === 0 ? " · primary" : ""}</div>}
                    <div>{a.address}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <D label="Contact name" value={debtor.contact_name ?? "—"} />
            <D label="Designation" value={debtor.contact_designation ?? "—"} />
            <D label="Contact email" value={debtor.contact_email ?? "—"} />
            <D label="Contact phone" value={debtor.contact_phone ?? "—"} />
          </div>
          {(debtor.salesman_name || debtor.salesman_phone || debtor.salesman_email) && (
            <div className="grid grid-cols-2 gap-3">
              <D label="Salesman name" value={debtor.salesman_name ?? "—"} />
              <D label="Salesman phone" value={debtor.salesman_phone ?? "—"} />
              <D label="Salesman email" value={debtor.salesman_email ?? "—"} />
            </div>
          )}
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

function D({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-widest text-primary">
        <span>{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

function L({
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
