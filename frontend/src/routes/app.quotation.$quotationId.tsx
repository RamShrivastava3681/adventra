import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api-client";
import { ArrowLeft, Printer } from "lucide-react";
import { fmtMoney, fmtDate } from "@/components/ledger-ui";

export const Route = createFileRoute("/app/quotation/$quotationId")({
  component: QuotationPage,
});

function QuotationPage() {
  const { quotationId } = Route.useParams();
  const q = useQuery({
    queryKey: ["quotation", quotationId],
    queryFn: async () => api.quotations.get(quotationId),
  });
  const d = q.data as any;

  const totalQty = (d?.lines ?? []).reduce((s: number, l: any) => s + l.quantity, 0);

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Toolbar — hidden on print */}
      <div className="no-print sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <Link
            to="/app/quotations"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back to quotations
          </Link>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            <Printer className="h-4 w-4" /> Print / Save PDF
          </button>
        </div>
      </div>

      <div className="mx-auto my-8 max-w-4xl">
        {q.isLoading ? (
          <div className="grid place-items-center py-24 text-sm text-muted-foreground">
            Loading…
          </div>
        ) : !d ? (
          <div className="grid place-items-center py-24 text-sm text-muted-foreground">
            Quotation not found
          </div>
        ) : (
          <div
            id="print-sheet"
            className="mx-4 rounded-lg bg-white p-10 text-slate-900 shadow-2xl print:m-0 print:rounded-none print:p-8 print:shadow-none"
            style={{
              fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
            }}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-8 border-b-2 border-slate-900 pb-5">
              <div>
                <div className="text-2xl font-bold tracking-tight">QUOTATION</div>
                <div className="mt-1 text-sm text-slate-600">
                  Offer to <span className="font-medium">{d.customer_name ?? "customer"}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-sm font-semibold">{d.quotation_number}</div>
                <div className="text-xs text-slate-600">{fmtDate(d.quotation_date)}</div>
                {d.valid_until && (
                  <div className="text-xs text-slate-600">Valid until {fmtDate(d.valid_until)}</div>
                )}
              </div>
            </div>

            {/* Parties */}
            <div className="mt-6 grid grid-cols-2 gap-8 text-sm">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  To
                </div>
                <div className="mt-1 font-medium">{d.customer_name ?? "—"}</div>
                {d.contact_person && <div className="text-slate-600">{d.contact_person}</div>}
                {d.billing_address && (
                  <div className="mt-1 whitespace-pre-line text-slate-600">{d.billing_address}</div>
                )}
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  Terms
                </div>
                <div className="mt-1 space-y-0.5 text-slate-600">
                  <div>Payment terms: {d.payment_terms ?? "—"}</div>
                  {d.expected_delivery_date && (
                    <div>Expected delivery: {fmtDate(d.expected_delivery_date)}</div>
                  )}
                  <div>Salesperson: {d.salesperson_name ?? "—"}</div>
                </div>
              </div>
            </div>

            {/* Lines */}
            <table className="mt-8 w-full text-sm">
              <thead>
                <tr className="border-b-2 border-slate-900 text-left text-[10px] uppercase tracking-widest text-slate-500">
                  <th className="py-2 pr-2">SKU</th>
                  <th className="py-2 pr-2">Product</th>
                  <th className="py-2 pr-2 text-right">Qty</th>
                  <th className="py-2 pr-2 text-right">Unit</th>
                  <th className="py-2 pr-2 text-right">Unit price</th>
                  <th className="py-2 pr-2 text-right">Discount</th>
                  <th className="py-2 pr-2 text-right">GST %</th>
                  <th className="py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {(d.lines ?? []).map((l: any) => {
                  const gross = (Number(l.quantity) || 0) * (Number(l.unit_price) || 0);
                  const discountAmt =
                    l.discount_type === "pct"
                      ? (gross * Math.min(100, Number(l.discount_value) || 0)) / 100
                      : l.discount_type === "amount"
                        ? Math.min(Number(l.discount_value) || 0, gross)
                        : 0;
                  const discountLabel =
                    l.discount_type === "pct"
                      ? `${l.discount_value}%`
                      : l.discount_type === "amount"
                        ? fmtMoney(l.discount_value)
                        : "—";
                  return (
                    <tr key={l.product_id} className="border-b border-slate-200">
                      <td className="py-2 pr-2 font-mono text-xs">{l.sku ?? "—"}</td>
                      <td className="py-2 pr-2">{l.name}</td>
                      <td className="py-2 pr-2 text-right">{l.quantity.toLocaleString()}</td>
                      <td className="py-2 pr-2 text-right">{l.unit}</td>
                      <td className="py-2 pr-2 text-right">
                        {l.updated_unit_price != null ? (
                          <>
                            <span className="text-slate-400 line-through">
                              {fmtMoney(l.unit_price)}
                            </span>{" "}
                            <span className="font-semibold">{fmtMoney(l.updated_unit_price)}</span>
                          </>
                        ) : (
                          fmtMoney(l.unit_price)
                        )}
                      </td>
                      <td className="py-2 pr-2 text-right">{discountLabel}</td>
                      <td className="py-2 pr-2 text-right">{l.gst_rate ?? "—"}</td>
                      <td className="py-2 text-right">{fmtMoney(l.line_total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Totals */}
            <div className="mt-6 flex items-start justify-between gap-8 text-sm">
              <div className="flex-1">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  Remarks
                </div>
                <div className="mt-1 whitespace-pre-line text-slate-600">{d.notes ?? "—"}</div>
              </div>
              <div className="w-64 space-y-1">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal</span>
                  <span>{fmtMoney(d.subtotal)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Total discount</span>
                  <span>-{fmtMoney(d.total_discount)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>GST total</span>
                  <span>{fmtMoney(d.gst_total)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Freight / charges</span>
                  <span>{fmtMoney(d.freight)}</span>
                </div>
                <div className="flex justify-between border-t-2 border-slate-900 pt-1.5 text-base font-semibold">
                  <span>Grand total</span>
                  <span>{fmtMoney(d.grand_total)}</span>
                </div>
                <div className="pt-1 text-[10px] uppercase tracking-widest text-slate-400">
                  Total quantity {totalQty.toLocaleString()}
                </div>
              </div>
            </div>

            {/* Signatures */}
            <div className="mt-16 grid grid-cols-2 gap-16 text-sm">
              <div>
                <div className="border-t border-slate-400 pt-2 text-xs text-slate-600">
                  Prepared by: {d.salesperson_name ?? "—"}
                </div>
              </div>
              <div>
                <div className="border-t border-slate-400 pt-2 text-xs text-slate-600">
                  Customer acceptance (signature)
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          body { background: white !important; }
          .no-print { display: none !important; }
          #print-sheet { box-shadow: none !important; margin: 0 !important; }
        }
      `}</style>
    </div>
  );
}
