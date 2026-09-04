import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api-client";
import { ArrowLeft, Printer } from "lucide-react";
import { fmtMoney, fmtDate } from "@/components/ledger-ui";

export const Route = createFileRoute("/app/challan/$dispatchId")({
  component: ChallanPage,
});

function ChallanPage() {
  const { dispatchId } = Route.useParams();
  const q = useQuery({
    queryKey: ["dispatch", dispatchId],
    queryFn: async () => api.goodsDispatches.get(dispatchId),
  });
  const d = q.data as any;

  const totalQty = (d?.lines ?? []).reduce((s: number, l: any) => s + l.dispatched_qty, 0);
  const totalValue = (d?.lines ?? []).reduce((s: number, l: any) => s + (l.line_value ?? 0), 0);

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Toolbar — hidden on print */}
      <div className="no-print sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <Link
            to="/app/dispatches"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back to dispatch
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
            Dispatch not found
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
                <div className="text-2xl font-bold tracking-tight">DELIVERY CHALLAN</div>
                <div className="mt-1 text-sm text-slate-600">
                  Sales order <span className="font-mono">{d.so_number ?? "—"}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-sm font-semibold">{d.dispatch_number}</div>
                <div className="text-xs text-slate-600">{fmtDate(d.dispatch_date)}</div>
                {d.warehouse && <div className="text-xs text-slate-600">From {d.warehouse}</div>}
              </div>
            </div>

            {/* Parties + logistics */}
            <div className="mt-6 grid grid-cols-2 gap-8 text-sm">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  Deliver to
                </div>
                <div className="mt-1 font-medium">{d.customer_name ?? "—"}</div>
                {d.contact_person && <div className="text-slate-600">{d.contact_person}</div>}
                <div className="mt-1 whitespace-pre-line text-slate-600">
                  {d.delivery_address ?? "—"}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  Dispatch details
                </div>
                <div className="mt-1 space-y-0.5 text-slate-600">
                  <div>Transporter: {d.transporter_name ?? "—"}</div>
                  <div>Tracking / AWB: {d.tracking_number ?? "—"}</div>
                  <div>Challan no: {d.delivery_challan_number ?? "—"}</div>
                  <div>Linked proforma: {d.linked_customer_proforma_number ?? "—"}</div>
                  <div>Linked invoice: {d.linked_sales_invoice_number ?? "—"}</div>
                </div>
              </div>
            </div>

            {/* Lines */}
            <table className="mt-8 w-full text-sm">
              <thead>
                <tr className="border-b-2 border-slate-900 text-left text-[10px] uppercase tracking-widest text-slate-500">
                  <th className="py-2 pr-2">SKU</th>
                  <th className="py-2 pr-2">Product</th>
                  <th className="py-2 pr-2 text-right">Unit</th>
                  <th className="py-2 pr-2 text-right">Qty</th>
                  <th className="py-2 pr-2 text-right">Unit price</th>
                  <th className="py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {(d.lines ?? []).map((l: any) => (
                  <tr key={l.product_id} className="border-b border-slate-200">
                    <td className="py-2 pr-2 font-mono text-xs">{l.sku ?? "—"}</td>
                    <td className="py-2 pr-2">
                      {l.name}
                      {(l.color || l.size) && (
                        <div className="text-xs text-slate-500">
                          {[l.color, l.size].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-2 text-right">{l.unit}</td>
                    <td className="py-2 pr-2 text-right">{l.dispatched_qty.toLocaleString()}</td>
                    <td className="py-2 pr-2 text-right">{fmtMoney(l.unit_price)}</td>
                    <td className="py-2 text-right">{fmtMoney(l.line_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-6 flex items-start justify-between gap-8 text-sm">
              <div className="flex-1">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  Remarks
                </div>
                <div className="mt-1 whitespace-pre-line text-slate-600">{d.notes ?? "—"}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  Total quantity
                </div>
                <div className="mt-1 text-lg font-semibold">{totalQty.toLocaleString()}</div>
                <div className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  Total value
                </div>
                <div className="text-sm">{fmtMoney(totalValue)}</div>
              </div>
            </div>

            {/* Signatures */}
            <div className="mt-16 grid grid-cols-2 gap-16 text-sm">
              <div>
                <div className="border-t border-slate-400 pt-2 text-xs text-slate-600">
                  Prepared by: {d.dispatched_by ?? "—"}
                </div>
              </div>
              <div>
                <div className="border-t border-slate-400 pt-2 text-xs text-slate-600">
                  Received by (signature)
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
