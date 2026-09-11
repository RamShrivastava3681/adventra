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
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney } from "@/components/ledger-ui";
import { Plus, X, Loader2, ShieldAlert, Building2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/debtors")({
  component: DebtorsPage,
});

// Customer master edits (new billing/shipping addresses, terms, contacts)
// feed every order form — invalidate all derived lists, not just this page.
export function invalidateCustomerQueries(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["debtors-full"] });
  qc.invalidateQueries({
    predicate: (q) =>
      q.queryKey.some(
        (k) =>
          typeof k === "string" &&
          /debtor|customer|bill-to|ship-to|sales-order|purchase-order|proforma|invoice/i.test(k),
      ),
  });
}

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
        title="Customer book"
        description="Payment terms and live exposure across every payer."
        icon={<Building2 className="h-5 w-5" />}
        actions={
          isAdmin && (
            <button
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              <Plus className="h-4 w-4" /> Add customer
            </button>
          )
        }
      />

      <div className="p-6 md:p-10">
        <Card>
          {(debtorsQ.data ?? []).length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <ShieldAlert className="mx-auto mb-3 h-6 w-6" />
              No customers yet.
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
          onSaved={() => invalidateCustomerQueries(qc)}
        />
      )}
      {editing && (
        <DebtorModal
          debtor={editing}
          onClose={() => setEditing(null)}
          onSaved={() => invalidateCustomerQueries(qc)}
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

type CustomerAddr = { label: string; address: string; city: string; state: string; pin: string };

function emptyAddr(): CustomerAddr {
  return { label: "", address: "", city: "", state: "", pin: "" };
}

function toAddressList(v: any): CustomerAddr[] {
  if (!v) return [];
  const arr = Array.isArray(v) ? v : [v];
  const out: CustomerAddr[] = [];
  for (const e of arr) {
    if (typeof e === "string") {
      if (e.trim()) out.push({ ...emptyAddr(), address: e.trim() });
    } else if (e && typeof e === "object") {
      const addr = e.address ?? e.address_line ?? "";
      const city = e.city ?? "";
      const state = e.state ?? e.country ?? "";
      const pin = e.postalCode ?? e.postal_code ?? e.pin ?? e.pincode ?? e.zip ?? "";
      const hasAny =
        (typeof addr === "string" && addr.trim()) ||
        (typeof city === "string" && city.trim()) ||
        (typeof state === "string" && String(state).trim()) ||
        String(pin ?? "").trim();
      if (hasAny)
        out.push({
          label: e.label ?? "",
          address: typeof addr === "string" ? addr.trim() : "",
          city: typeof city === "string" ? city.trim() : "",
          state: state != null ? String(state).trim() : "",
          pin: pin != null ? String(pin).trim() : "",
        });
    }
  }
  return out;
}

function formatAddr(a: { address: string; city: string; state: string; pin: string }): string {
  return [a.address, a.city, a.state, a.pin].filter(Boolean).join(", ");
}

function addressesFromDebtor(debtor: any, kind: "billing" | "shipping"): CustomerAddr[] {
  if (!debtor) return [emptyAddr()];
  const list =
    kind === "billing"
      ? (debtor.billing_addresses ?? debtor.billingAddresses ?? null)
      : (debtor.shipping_addresses ?? debtor.shippingAddresses ?? null);
  const norm = toAddressList(list);
  if (norm.length) {
    // Migrate legacy top-level City/State/PIN into the first address for old records
    if (kind === "billing" && !norm[0].city && !norm[0].state && !norm[0].pin) {
      const c = debtor.city ?? "";
      const s = debtor.country ?? "";
      const p = debtor.postal_code ?? debtor.postalCode ?? "";
      if (c || s || p) norm[0] = { ...norm[0], city: String(c ?? ""), state: String(s ?? ""), pin: String(p ?? "") };
    }
    return norm;
  }
  // Legacy single-address fallback
  const single =
    kind === "billing"
      ? (debtor.billing_address ?? debtor.address_line ?? "")
      : (debtor.shipping_address ?? "");
  const city = kind === "billing" ? (debtor.city ?? "") : "";
  const state = kind === "billing" ? (debtor.country ?? "") : "";
  const pin = kind === "billing" ? (debtor.postal_code ?? debtor.postalCode ?? "") : "";
  if (single || city || state || pin)
    return [{ label: "", address: String(single ?? ""), city: String(city ?? ""), state: String(state ?? ""), pin: String(pin ?? "") }];
  return [emptyAddr()];
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
    credit_limit: debtor?.creditLimit ?? debtor?.credit_limit ?? "",
    enforce_credit_limit: (() => {
      const v = debtor?.enforceCreditLimit ?? debtor?.enforce_credit_limit;
      if (v === undefined || v === null || v === "") {
        const lim = Number(debtor?.creditLimit ?? debtor?.credit_limit ?? NaN);
        return Number.isFinite(lim) && lim > 0 ? true : true;
      }
      return v === true || v === "true" || v === 1 || v === "1";
    })(),
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
      let creditLimit: number | null = null;
      if (String(form.credit_limit ?? "").trim() !== "") {
        const n = Number(form.credit_limit);
        if (!Number.isFinite(n) || n < 0) throw new Error("Credit limit must be zero or more");
        creditLimit = n;
      }
      const cleanBilling = form.billing_addresses
        .map((a) => ({
          label: a.label.trim() || null,
          address: a.address.trim(),
          city: a.city.trim() || null,
          state: a.state.trim() || null,
          postalCode: a.pin.trim() || null,
        }))
        .filter((a) => a.address || a.city || a.state || a.postalCode);
      const cleanShipping = form.shipping_addresses
        .map((a) => ({
          label: a.label.trim() || null,
          address: a.address.trim(),
          city: a.city.trim() || null,
          state: a.state.trim() || null,
          postalCode: a.pin.trim() || null,
        }))
        .filter((a) => a.address || a.city || a.state || a.postalCode);
      const termsPayload = toTermsPayload(form);
      // The debtor form has no balance-due-days input: delivery-based terms
      // are always due on delivery/invoice date (0 days) at master level.
      // Per-customer variations live in the approved-terms manager.
      if (
        termsPayload.paymentTermsType === "on_delivery" ||
        termsPayload.paymentTermsType === "advance_partial"
      ) {
        termsPayload.paymentTermsDays = 0;
      }
      const payload = {
        name: form.name.trim(),
        industry: form.industry || null,
        ...termsPayload,
        gstin: form.gstin || null,
        panCardNo: form.panCardNo || null,
        billingAddress: cleanBilling.length
          ? [cleanBilling[0].address, cleanBilling[0].city, cleanBilling[0].state, cleanBilling[0].postalCode].filter(Boolean).join(", ")
          : null,
        shippingAddress: cleanShipping.length
          ? [cleanShipping[0].address, cleanShipping[0].city, cleanShipping[0].state, cleanShipping[0].postalCode].filter(Boolean).join(", ")
          : null,
        billingAddresses: cleanBilling.length ? cleanBilling : null,
        shippingAddresses: cleanShipping.length ? cleanShipping : null,
        city: cleanBilling[0]?.city || null,
        country: cleanBilling[0]?.state || null,
        postalCode: cleanBilling[0]?.postalCode || null,
        creditLimit,
        enforceCreditLimit: !!form.enforce_credit_limit,
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
      toast.success(isEdit ? "Customer updated" : "Customer added");
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
          <h3 className="font-display text-lg">{isEdit ? "Edit customer" : "Add customer"}</h3>
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
                    billing_addresses: [...form.billing_addresses, emptyAddr()],
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
                    <div className="grid gap-2 md:grid-cols-3">
                      <input
                        maxLength={100}
                        className={inputBase}
                        value={a.city}
                        onChange={(e) => {
                          const next = [...form.billing_addresses];
                          next[i] = { ...next[i], city: e.target.value };
                          setForm({ ...form, billing_addresses: next });
                        }}
                        placeholder="City"
                      />
                      <input
                        maxLength={100}
                        className={inputBase}
                        value={a.state}
                        onChange={(e) => {
                          const next = [...form.billing_addresses];
                          next[i] = { ...next[i], state: e.target.value };
                          setForm({ ...form, billing_addresses: next });
                        }}
                        placeholder="State"
                      />
                      <input
                        maxLength={20}
                        className={inputBase}
                        value={a.pin}
                        onChange={(e) => {
                          const next = [...form.billing_addresses];
                          next[i] = { ...next[i], pin: e.target.value };
                          setForm({ ...form, billing_addresses: next });
                        }}
                        placeholder="PIN / Postal code"
                      />
                    </div>
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
                    shipping_addresses: [...form.shipping_addresses, emptyAddr()],
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
                    <div className="grid gap-2 md:grid-cols-3">
                      <input
                        maxLength={100}
                        className={inputBase}
                        value={a.city}
                        onChange={(e) => {
                          const next = [...form.shipping_addresses];
                          next[i] = { ...next[i], city: e.target.value };
                          setForm({ ...form, shipping_addresses: next });
                        }}
                        placeholder="City"
                      />
                      <input
                        maxLength={100}
                        className={inputBase}
                        value={a.state}
                        onChange={(e) => {
                          const next = [...form.shipping_addresses];
                          next[i] = { ...next[i], state: e.target.value };
                          setForm({ ...form, shipping_addresses: next });
                        }}
                        placeholder="State"
                      />
                      <input
                        maxLength={20}
                        className={inputBase}
                        value={a.pin}
                        onChange={(e) => {
                          const next = [...form.shipping_addresses];
                          next[i] = { ...next[i], pin: e.target.value };
                          setForm({ ...form, shipping_addresses: next });
                        }}
                        placeholder="PIN / Postal code"
                      />
                    </div>
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

          <Section title="Credit limit">
            <div className="flex flex-col gap-2 md:flex-row md:items-end">
              <div className="flex-1">
                <L label="Credit limit (₹) — blank = no limit">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={inputBase}
                    value={form.credit_limit as any}
                    onChange={(e) => setForm({ ...form, credit_limit: e.target.value as any })}
                    placeholder="e.g. 500000"
                  />
                </L>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={!!form.enforce_credit_limit}
                  onChange={(e) => setForm({ ...form, enforce_credit_limit: e.target.checked })}
                />
                <span>Enforce — block invoices over limit</span>
              </label>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              When checked, invoices that would push unpaid exposure over the limit are blocked. Uncheck to bypass.
            </p>
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
                          hideBalanceDays
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
                      hideBalanceDays
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
    const singleAddr = String(debtor.billing_address ?? debtor.address_line ?? "");
    const c = String(debtor.city ?? "");
    const s = String(debtor.country ?? "");
    const p = String(debtor.postal_code ?? debtor.postalCode ?? "");
    if (singleAddr || c || s || p)
      return [{ label: "", address: singleAddr, city: c, state: s, pin: p }];
    return [];
  })();
  const shippingList = (() => {
    const l = toAddressList(debtor.shipping_addresses ?? debtor.shippingAddresses);
    if (l.length) return l.map((a) => a);
    const singleAddr = String(debtor.shipping_address ?? "");
    if (singleAddr) return [{ label: "", address: singleAddr, city: "", state: "", pin: "" }];
    return [];
  })();
  const creditLimitVal = debtor.creditLimit ?? debtor.credit_limit ?? null;
  const enforceVal = debtor.enforceCreditLimit ?? debtor.enforce_credit_limit ?? false;
  const enforceOn = enforceVal === true || enforceVal === "true" || enforceVal === 1 || enforceVal === "1";
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
            <D
              label="Credit limit"
              value={
                creditLimitVal == null || creditLimitVal === ""
                  ? "—"
                  : `${fmtMoney(Number(creditLimitVal))}${enforceOn ? "" : " (bypassed)"}`
              }
            />
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
                    {a.label && <div className="text-[10px] uppercase tracking-widest text-primary">{a.label}</div>}
                    <div>{formatAddr(a) || "—"}</div>
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
                    {a.label && <div className="text-[10px] uppercase tracking-widest text-primary">{a.label}</div>}
                    <div>{formatAddr(a) || "—"}</div>
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
