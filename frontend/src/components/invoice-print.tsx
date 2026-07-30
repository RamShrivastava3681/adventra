import { useEffect } from "react";
import { Printer, ArrowLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";

export type PreviewLine = {
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
};

export type PreviewTemplate = {
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
  bank_details: string;
  terms: string;
  footer_text: string;
  signature_label: string;
};

export type PreviewDoc = {
  kind: "invoice" | "credit" | "debit";
  number: string;
  date: string;
  due_date?: string | null;
  party_name: string;
  party_address?: string;
  party_email?: string;
  party_phone?: string;
  po_number?: string | null;
  po_date?: string | null;
  reference?: string | null;
  line_items: PreviewLine[];
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  notes?: string | null;
};

export function PrintShell({
  template,
  doc,
  backTo,
}: {
  template: PreviewTemplate;
  doc: PreviewDoc;
  backTo: string;
}) {
  useEffect(() => {
    const prev = document.title;
    document.title = `${labelFor(doc.kind)} ${doc.number}`;
    return () => { document.title = prev; };
  }, [doc.kind, doc.number]);

  const fmt = (n: number) => `${template.currency_symbol}${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const docLabel = labelFor(doc.kind);

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Toolbar — hidden on print */}
      <div className="no-print sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <Link to={backTo} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            {docLabel} preview · {doc.number}
          </div>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            <Printer className="h-4 w-4" /> Print / Save PDF
          </button>
        </div>
      </div>

      {/* Printable sheet */}
      <div className="mx-auto my-8 max-w-4xl">
        <div
          id="print-sheet"
          className="mx-4 rounded-lg bg-white p-10 text-slate-900 shadow-2xl print:m-0 print:rounded-none print:p-8 print:shadow-none"
          style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-8 border-b-4 pb-5" style={{ borderColor: template.primary_color }}>
            <div>
              <div className="text-2xl font-bold" style={{ color: template.accent_color }}>{template.company_name || "Your company"}</div>
              {template.company_address && <div className="mt-1 whitespace-pre-line text-sm text-slate-600">{template.company_address}</div>}
              <div className="text-sm text-slate-600">{[template.company_email, template.company_phone].filter(Boolean).join(" · ")}</div>
              {template.tax_id && <div className="text-xs uppercase tracking-widest text-slate-500">Tax ID: {template.tax_id}</div>}
            </div>
            {template.logo_url ? (
              <img src={template.logo_url} alt="logo" className="h-16 max-w-[180px] object-contain" />
            ) : null}
          </div>

          {/* Title bar */}
          <div className="mt-6 flex items-end justify-between">
            <div>
              <div className="text-3xl font-bold uppercase tracking-wide" style={{ color: template.primary_color }}>{docLabel}</div>
              <div className="mt-1 text-sm text-slate-500">No. <span className="font-mono text-slate-900">{doc.number}</span></div>
            </div>
            <div className="text-right text-sm text-slate-600">
              <div><span className="text-slate-500">Date: </span>{fmtDate(doc.date)}</div>
              {doc.due_date && <div><span className="text-slate-500">Due: </span>{fmtDate(doc.due_date)}</div>}
              {doc.po_number && <div><span className="text-slate-500">PO: </span><span className="font-mono">{doc.po_number}</span></div>}
              {doc.reference && <div><span className="text-slate-500">Ref: </span>{doc.reference}</div>}
            </div>
          </div>

          {/* Bill-to */}
          <div className="mt-6 grid grid-cols-2 gap-6 text-sm">
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-slate-500">{doc.kind === "invoice" ? "Bill to" : "Counterparty"}</div>
              <div className="font-semibold">{doc.party_name}</div>
              {doc.party_address && <div className="whitespace-pre-line text-slate-600">{doc.party_address}</div>}
              <div className="text-slate-600">{[doc.party_email, doc.party_phone].filter(Boolean).join(" · ")}</div>
            </div>
            {template.bank_details && (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-slate-500">Remittance</div>
                <div className="whitespace-pre-line text-xs text-slate-700">{template.bank_details}</div>
              </div>
            )}
          </div>

          {/* Line items */}
          <table className="mt-6 w-full border-collapse text-sm">
            <thead>
              <tr style={{ background: template.primary_color, color: "white" }}>
                <th className="px-3 py-2 text-left">Description</th>
                <th className="w-20 px-3 py-2 text-right">Qty</th>
                <th className="w-32 px-3 py-2 text-right">Rate</th>
                <th className="w-32 px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(doc.line_items.length ? doc.line_items : [{ description: doc.notes || (doc.kind === "invoice" ? "Goods/services supplied" : "Adjustment"), quantity: 1, unit_price: doc.subtotal, line_total: doc.subtotal }]).map((li, idx) => (
                <tr key={idx} className="border-b border-slate-100">
                  <td className="px-3 py-2 align-top whitespace-pre-line">{li.description || "—"}</td>
                  <td className="px-3 py-2 text-right align-top">{Number(li.quantity).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right align-top">{fmt(li.unit_price)}</td>
                  <td className="px-3 py-2 text-right align-top">{fmt(li.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="mt-4 flex justify-end">
            <div className="w-72 text-sm">
              <div className="flex justify-between py-1"><span className="text-slate-600">Subtotal</span><span>{fmt(doc.subtotal)}</span></div>
              {doc.tax_rate > 0 && (
                <div className="flex justify-between py-1 text-slate-600"><span>Tax ({doc.tax_rate}%)</span><span>{fmt(doc.tax_amount)}</span></div>
              )}
              <div className="mt-1 flex justify-between border-t-2 pt-2 text-lg font-bold" style={{ borderColor: template.accent_color, color: template.accent_color }}>
                <span>Total {template.currency}</span><span>{fmt(doc.total)}</span>
              </div>
            </div>
          </div>

          {/* Notes & terms */}
          {doc.notes && (
            <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-slate-500">Notes</div>
              <div className="whitespace-pre-line text-slate-700">{doc.notes}</div>
            </div>
          )}

          {template.terms && (
            <div className="mt-4 text-xs text-slate-500">
              <div className="font-semibold uppercase tracking-widest text-slate-600">Terms</div>
              <div className="whitespace-pre-line">{template.terms}</div>
            </div>
          )}

          {/* Signature */}
          <div className="mt-12 flex justify-end">
            <div className="w-60 text-center text-xs text-slate-500">
              <div className="h-12 border-b border-slate-400" />
              <div className="mt-1 uppercase tracking-widest">{template.signature_label}</div>
              <div className="text-slate-700">{template.company_name}</div>
            </div>
          </div>

          {template.footer_text && (
            <div className="mt-8 border-t border-dashed border-slate-300 pt-3 text-center text-xs text-slate-500">{template.footer_text}</div>
          )}
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          body { background: white !important; }
          .no-print { display: none !important; }
          #print-sheet { box-shadow: none !important; }
        }
      `}</style>
    </div>
  );
}

function labelFor(k: "invoice" | "credit" | "debit") {
  if (k === "credit") return "Credit Note";
  if (k === "debit") return "Debit Note";
  return "Tax Invoice";
}

function fmtDate(s: string) {
  if (!s) return "";
  try { return new Date(s).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }); } catch { return s; }
}
