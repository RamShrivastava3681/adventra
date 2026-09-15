import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api-client";
import { Card, fmtMoney, fmtDate, StatusPill } from "@/components/ledger-ui";
import { TableSkeleton } from "@/components/skeletons";
import { RecordEwbModal } from "@/components/dispatch-workflow";
import { Truck, FileCheck, Printer } from "lucide-react";
import { toast } from "sonner";

/**
 * Finance → Dispatch Orders tab.
 * Read-only register over the existing dispatches + invoices endpoints.
 * Transporter/upload details saved on the Awaiting Pickup handoff and the
 * E-Way Bill recorded from the IRN invoice flow are both visible here.
 */
export function FinanceDispatchOrdersPanel() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [ewbFor, setEwbFor] = useState<any | null>(null);

  const dispatchesQ = useQuery({
    queryKey: ["finance-dispatch-orders"],
    queryFn: () => api.goodsDispatches.list(),
  });
  const invoicesQ = useQuery({
    queryKey: ["finance-dispatch-orders-invoices"],
    queryFn: () => api.invoices.list(),
  });

  const invoiceById = useMemo(() => {
    const m = new Map<string, any>();
    for (const inv of (invoicesQ.data ?? []) as any[]) m.set(inv.id, inv);
    return m;
  }, [invoicesQ.data]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ((dispatchesQ.data ?? []) as any[])
      .map((d) => ({
        ...d,
        invoice:
          invoiceById.get(d.final_invoice_id ?? d.linked_sales_invoice_id ?? "") ?? null,
      }))
      .filter((d) => (statusFilter === "all" ? true : d.status === statusFilter))
      .filter((d) => {
        if (!needle) return true;
        return [
          d.dispatch_number,
          d.so_number,
          d.customer_name,
          d.transporter_name,
          d.transporter_id,
          d.vehicle_number,
          d.transport_doc_number,
          d.eway_bill_number,
          d.final_invoice_number,
          d.linked_sales_invoice_number,
          d.invoice?.invoice_number,
          d.invoice?.irn,
        ]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(needle));
      })
      .sort((a, b) =>
        String(b.created_at ?? b.dispatch_date ?? "").localeCompare(
          String(a.created_at ?? a.dispatch_date ?? ""),
        ),
      );
  }, [dispatchesQ.data, invoiceById, q, statusFilter]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["finance-dispatch-orders"] });
    qc.invalidateQueries({ queryKey: ["finance-dispatch-orders-invoices"] });
    qc.invalidateQueries({ queryKey: ["goods-dispatches"] });
    qc.invalidateQueries({ queryKey: ["wh_dispatches"] });
  };

  const awaitingEwb = rows.filter(
    (d) => d.status === "details_submitted" && !d.eway_bill_number && !d.ewb_not_required,
  ).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-sm">
          <Truck className="h-4 w-4 text-primary" />
          <span className="font-medium">{rows.length} dispatch orders</span>
          {awaitingEwb > 0 && (
            <span className="rounded-full border border-sem-attention/30 bg-sem-attention/10 px-2 py-0.5 text-[11px] text-sem-attention">
              {awaitingEwb} awaiting E-Way Bill
            </span>
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search dispatch, SO, invoice, IRN, transporter, EWB…"
            className="h-8 w-72 rounded-md border border-border bg-card px-2.5 text-xs focus:border-primary focus:outline-none"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-8 rounded-md border border-border bg-card px-2 text-xs focus:border-primary focus:outline-none"
          >
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="details_submitted">Details submitted</option>
            <option value="ready_for_dispatch">Ready for dispatch</option>
            <option value="confirmed">Confirmed</option>
            <option value="partially_delivered">Partially delivered</option>
            <option value="delivered">Delivered</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      <Card>
        {dispatchesQ.isLoading ? (
          <TableSkeleton rows={6} cols={8} />
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <Truck className="mx-auto mb-2 h-8 w-8 opacity-40" />
            No dispatch orders yet. They appear here once the warehouse submits packing + transport.
          </div>
        ) : (
          <div className="-mx-5 overflow-x-auto table-wrap">
            <table className="table-premium w-full text-sm">
              <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-5 py-2 text-left font-normal">Dispatch</th>
                  <th className="px-5 py-2 text-left font-normal">Invoice / IRN</th>
                  <th className="px-5 py-2 text-left font-normal">Transporter (from Awaiting Pickup)</th>
                  <th className="px-5 py-2 text-left font-normal">Vehicle / Doc</th>
                  <th className="px-5 py-2 text-right font-normal">Value</th>
                  <th className="px-5 py-2 text-left font-normal">E-Way Bill</th>
                  <th className="px-5 py-2 text-left font-normal">Status</th>
                  <th className="px-5 py-2 text-right font-normal">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id} className="border-b border-border/60 hover:bg-muted/30">
                    <td className="px-5 py-3">
                      <div className="font-mono text-xs font-medium">{d.dispatch_number}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {d.so_number ?? "—"} · {d.customer_name ?? "—"} · {fmtDate(d.dispatch_date)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {(d.shipping_status ?? "awaiting_pick").replace(/_/g, " ")}
                        {d.distance_km ? ` · ${d.distance_km} km` : ""}
                        {d.transport_mode ? ` · ${d.transport_mode}` : ""}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="font-mono text-xs">
                        {d.invoice?.invoice_number ?? d.final_invoice_number ?? d.linked_sales_invoice_number ?? "—"}
                      </div>
                      {d.invoice?.irn || d.irn_snapshot ? (
                        <div
                          className="max-w-[180px] truncate font-mono text-[10px] text-muted-foreground"
                          title={String(d.invoice?.irn ?? d.irn_snapshot)}
                        >
                          IRN {String(d.invoice?.irn ?? d.irn_snapshot).slice(0, 12)}…
                        </div>
                      ) : (
                        <div className="text-[10px] text-muted-foreground">IRN pending</div>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="text-xs font-medium">{d.transporter_name ?? "—"}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">
                        {d.transporter_id ?? "—"}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-xs">
                      <div>{d.vehicle_number || d.transport_doc_number || "—"}</div>
                      {d.transport_doc_type && (
                        <div className="text-[10px] text-muted-foreground">
                          {d.transport_doc_type}
                          {d.transport_doc_date ? ` · ${fmtDate(d.transport_doc_date)}` : ""}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right num">
                      {fmtMoney(d.invoiced_value ?? d.invoice?.grand_total ?? 0)}
                    </td>
                    <td className="px-5 py-3">
                      {d.eway_bill_number ? (
                        <div>
                          <div className="font-mono text-xs">{d.eway_bill_number}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {d.eway_bill_valid_until ? `valid to ${fmtDate(d.eway_bill_valid_until)}` : d.eway_bill_status ?? "generated"}
                          </div>
                        </div>
                      ) : d.ewb_not_required ? (
                        <span className="text-[11px] text-muted-foreground">Not required</span>
                      ) : (
                        <span className="rounded-full border border-sem-attention/30 bg-sem-attention/10 px-2 py-0.5 text-[10px] text-sem-attention">
                          Pending
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <StatusPill status={d.status} />
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex justify-end gap-1.5">
                        {d.status === "details_submitted" && (
                          <button
                            onClick={() => setEwbFor(d)}
                            className="inline-flex items-center gap-1 rounded-md border border-primary/50 px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/10"
                          >
                            <FileCheck className="h-3 w-3" /> EWB
                          </button>
                        )}
                        <a
                          href={`/app/invoice-preview/${d.final_invoice_id ?? d.linked_sales_invoice_id ?? ""}`}
                          onClick={(e) => {
                            if (!d.final_invoice_id && !d.linked_sales_invoice_id) {
                              e.preventDefault();
                              toast.message("No invoice linked to this dispatch yet");
                            }
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary"
                        >
                          <Printer className="h-3 w-3" /> Invoice
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {ewbFor && (
        <RecordEwbModal
          dispatch={ewbFor}
          onClose={() => setEwbFor(null)}
          onDone={refresh}
        />
      )}
    </div>
  );
}
