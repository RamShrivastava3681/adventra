import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card } from "@/components/ledger-ui";
import { Loader2, Save, FileText } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/template")({
  component: TemplatePage,
});

type Template = {
  company_name: string;
  company_address: string;
  company_email: string;
  company_phone: string;
  tax_id: string;
  logo_url: string;
  primary_color: string;
  accent_color: string;
  currency: string;
  currency_symbol: string;
  default_tax_rate: number;
  bank_details: string;
  terms: string;
  footer_text: string;
  signature_label: string;
};

const empty: Template = {
  company_name: "",
  company_address: "",
  company_email: "",
  company_phone: "",
  tax_id: "",
  logo_url: "",
  primary_color: "#0EA5E9",
  accent_color: "#0F172A",
  currency: "USD",
  currency_symbol: "$",
  default_tax_rate: 0,
  bank_details: "",
  terms: "Payment due within 30 days of invoice date.",
  footer_text: "Thank you for your business.",
  signature_label: "Authorised signatory",
};

function TemplatePage() {
  const { user, isClient, isAdmin } = useAuth();
  const canEdit = isClient || isAdmin;
  const qc = useQueryClient();
  const [form, setForm] = useState<Template>(empty);

  const tplQ = useQuery({
    queryKey: ["invoice-template", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const data = await api.invoiceTemplates.get();
      return data;
    },
  });

  useEffect(() => {
    if (tplQ.data) {
      const d = tplQ.data as Record<string, unknown>;
      setForm({
        company_name: (d.company_name as string) ?? "",
        company_address: (d.company_address as string) ?? "",
        company_email: (d.company_email as string) ?? "",
        company_phone: (d.company_phone as string) ?? "",
        tax_id: (d.tax_id as string) ?? "",
        logo_url: (d.logo_url as string) ?? "",
        primary_color: (d.primary_color as string) ?? "#0EA5E9",
        accent_color: (d.accent_color as string) ?? "#0F172A",
        currency: (d.currency as string) ?? "USD",
        currency_symbol: (d.currency_symbol as string) ?? "$",
        default_tax_rate: Number(d.default_tax_rate ?? 0),
        bank_details: (d.bank_details as string) ?? "",
        terms: (d.terms as string) ?? "",
        footer_text: (d.footer_text as string) ?? "",
        signature_label: (d.signature_label as string) ?? "",
      });
    }
  }, [tplQ.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      await api.invoiceTemplates.update(form);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoice-template"] });
      toast.success("Template saved");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to save"),
  });

  return (
    <div>
      <PageHeader
        eyebrow="Branding"
        title="Invoice template"
        description="Branding and boilerplate used whenever you generate a sales invoice or credit / debit note from inside the platform."
      />

      <div className="grid gap-6 p-6 md:p-10 lg:grid-cols-5">
        {/* Form */}
        <div className="lg:col-span-3 space-y-6">
          <Card title="Your company">
            <div className="grid gap-3 md:grid-cols-2">
              <L label="Company name *">
                <input
                  className="inp"
                  value={form.company_name}
                  onChange={(e) => setForm({ ...form, company_name: e.target.value })}
                  disabled={!canEdit}
                />
              </L>
              <L label="Tax / GST ID">
                <input
                  className="inp"
                  value={form.tax_id}
                  onChange={(e) => setForm({ ...form, tax_id: e.target.value })}
                  disabled={!canEdit}
                />
              </L>
              <L label="Email">
                <input
                  className="inp"
                  type="email"
                  value={form.company_email}
                  onChange={(e) => setForm({ ...form, company_email: e.target.value })}
                  disabled={!canEdit}
                />
              </L>
              <L label="Phone">
                <input
                  className="inp"
                  value={form.company_phone}
                  onChange={(e) => setForm({ ...form, company_phone: e.target.value })}
                  disabled={!canEdit}
                />
              </L>
              <L label="Address" cols={2}>
                <textarea
                  rows={3}
                  className="inp"
                  value={form.company_address}
                  onChange={(e) => setForm({ ...form, company_address: e.target.value })}
                  disabled={!canEdit}
                />
              </L>
              <L label="Logo URL" cols={2}>
                <input
                  className="inp"
                  placeholder="https://…/logo.png"
                  value={form.logo_url}
                  onChange={(e) => setForm({ ...form, logo_url: e.target.value })}
                  disabled={!canEdit}
                />
              </L>
            </div>
          </Card>

          <Card title="Look & currency">
            <div className="grid gap-3 md:grid-cols-4">
              <L label="Primary colour">
                <input
                  className="inp h-10"
                  type="color"
                  value={form.primary_color}
                  onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
                  disabled={!canEdit}
                />
              </L>
              <L label="Accent colour">
                <input
                  className="inp h-10"
                  type="color"
                  value={form.accent_color}
                  onChange={(e) => setForm({ ...form, accent_color: e.target.value })}
                  disabled={!canEdit}
                />
              </L>
              <L label="Currency code">
                <input
                  className="inp"
                  maxLength={5}
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
                  disabled={!canEdit}
                />
              </L>
              <L label="Symbol">
                <input
                  className="inp"
                  maxLength={3}
                  value={form.currency_symbol}
                  onChange={(e) => setForm({ ...form, currency_symbol: e.target.value })}
                  disabled={!canEdit}
                />
              </L>
              <L label="Default tax % (auto-fills new invoices)" cols={2}>
                <input
                  className="inp"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.default_tax_rate}
                  onChange={(e) => setForm({ ...form, default_tax_rate: Number(e.target.value) })}
                  disabled={!canEdit}
                />
              </L>
            </div>
          </Card>

          <Card title="Boilerplate">
            <div className="grid gap-3">
              <L label="Bank details (shown for remittance)">
                <textarea
                  rows={4}
                  className="inp"
                  value={form.bank_details}
                  onChange={(e) => setForm({ ...form, bank_details: e.target.value })}
                  disabled={!canEdit}
                  placeholder="Bank: Acme National&#10;Account: 1234 5678&#10;IFSC / SWIFT: ABCD0123"
                />
              </L>
              <L label="Terms">
                <textarea
                  rows={2}
                  className="inp"
                  value={form.terms}
                  onChange={(e) => setForm({ ...form, terms: e.target.value })}
                  disabled={!canEdit}
                />
              </L>
              <L label="Footer text">
                <input
                  className="inp"
                  value={form.footer_text}
                  onChange={(e) => setForm({ ...form, footer_text: e.target.value })}
                  disabled={!canEdit}
                />
              </L>
              <L label="Signature label">
                <input
                  className="inp"
                  value={form.signature_label}
                  onChange={(e) => setForm({ ...form, signature_label: e.target.value })}
                  disabled={!canEdit}
                />
              </L>
            </div>
          </Card>

          {canEdit && (
            <div className="flex justify-end">
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
                Save template
              </button>
            </div>
          )}
        </div>

        {/* Live preview mini-card */}
        <div className="lg:col-span-2">
          <Card title="Preview">
            <div className="rounded-md border border-border bg-white p-5 text-slate-900 shadow">
              <div
                className="flex items-start justify-between gap-4 border-b-4"
                style={{ borderColor: form.primary_color }}
              >
                <div className="pb-3">
                  <div className="text-xl font-bold" style={{ color: form.accent_color }}>
                    {form.company_name || "Your company"}
                  </div>
                  <div className="whitespace-pre-line text-xs text-slate-600">
                    {form.company_address}
                  </div>
                  <div className="text-xs text-slate-600">
                    {[form.company_email, form.company_phone].filter(Boolean).join(" · ")}
                  </div>
                  {form.tax_id && (
                    <div className="text-[10px] uppercase tracking-widest text-slate-500">
                      Tax ID: {form.tax_id}
                    </div>
                  )}
                </div>
                {form.logo_url ? (
                  <img
                    src={form.logo_url}
                    alt="logo"
                    className="h-12 max-w-[120px] object-contain"
                  />
                ) : (
                  <div
                    className="grid h-12 w-12 place-items-center rounded-md text-white"
                    style={{ background: form.primary_color }}
                  >
                    <FileText className="h-5 w-5" />
                  </div>
                )}
              </div>
              <div
                className="mt-3 text-sm font-bold uppercase tracking-widest"
                style={{ color: form.primary_color }}
              >
                Tax Invoice
              </div>
              <div className="text-xs text-slate-500">
                INV-00123 · {new Date().toLocaleDateString()}
              </div>
              <table className="table-premium mt-3 w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="py-1">Description</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Rate</th>
                    <th className="text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="py-1">Sample item</td>
                    <td className="text-right">2</td>
                    <td className="text-right">{form.currency_symbol}500.00</td>
                    <td className="text-right">{form.currency_symbol}1,000.00</td>
                  </tr>
                </tbody>
              </table>
              <div className="mt-3 ml-auto w-44 text-xs">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>{form.currency_symbol}1,000.00</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>Tax ({form.default_tax_rate}%)</span>
                  <span>
                    {form.currency_symbol}
                    {((1000 * form.default_tax_rate) / 100).toFixed(2)}
                  </span>
                </div>
                <div
                  className="mt-1 flex justify-between border-t border-slate-300 pt-1 font-bold"
                  style={{ color: form.accent_color }}
                >
                  <span>Total</span>
                  <span>
                    {form.currency_symbol}
                    {(1000 + (1000 * form.default_tax_rate) / 100).toFixed(2)}
                  </span>
                </div>
              </div>
              <div className="mt-4 text-[10px] text-slate-500">
                <div className="font-semibold uppercase tracking-widest text-slate-600">Terms</div>
                <div>{form.terms}</div>
              </div>
              <div className="mt-3 border-t border-dashed border-slate-300 pt-2 text-center text-[10px] text-slate-500">
                {form.footer_text}
              </div>
            </div>
          </Card>
        </div>
      </div>

      <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
    </div>
  );
}

function L({
  label,
  children,
  cols = 1,
}: {
  label: string;
  children: React.ReactNode;
  cols?: 1 | 2;
}) {
  return (
    <label className={cols === 2 ? "md:col-span-2 block" : "block"}>
      <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
