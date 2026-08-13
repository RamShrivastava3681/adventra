import { createFileRoute, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import api from "@/lib/api-client";
import { fmtMoney, fmtDate } from "@/components/ledger-ui";
import {
  FileCheck2,
  Check,
  X,
  MessageSquare,
  Loader2,
  Printer,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/approve/$token")({
  component: ApprovePage,
});

type ApproveLine = {
  sku: string | null;
  name: string;
  unit: string;
  quantity: number;
  unit_price: number;
  updated_unit_price: number | null;
  ordered_qty?: number;
  discount_type?: "pct" | "amount" | null;
  discount_value?: number | null;
  discount_pct?: number | null;
  gst_rate: number | null;
  line_total: number;
};

function ApprovePage() {
  const { token } = useParams({ from: "/approve/$token" });
  const qc = useQueryClient();
  const [mode, setMode] = useState<null | "approved" | "rejected">(null);
  const [comments, setComments] = useState("");

  const q = useQuery({
    queryKey: ["approval", token],
    queryFn: async () => {
      const data = await api.approvals.get(token);
      return data as {
        kind: "quotation" | "sales_order" | "purchase_order";
        document: any;
        debtor: { name?: string; contact_email?: string | null } | null;
      };
    },
  });

  const respond = useMutation({
    mutationFn: async ({
      decision,
      comments,
    }: {
      decision: "approved" | "rejected";
      comments: string;
    }) => {
      await api.approvals.respond(token, decision, comments || undefined);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approval", token] });
      toast.success("Response recorded");
      setMode(null);
      setComments("");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (q.isLoading)
    return (
      <div className="grid min-h-screen place-items-center text-muted-foreground">
        Loading…
      </div>
    );

  const data = q.data;
  const doc = data?.document;
  if (!doc)
    return (
      <div className="grid min-h-screen place-items-center text-center text-muted-foreground">
        <div>
          <ShieldCheck className="mx-auto mb-3 h-10 w-10 opacity-40" />
          This approval link is invalid or has already been used.
          <div className="mt-2 text-xs">Please contact the sender for a fresh copy.</div>
        </div>
      </div>
    );

  const isQuotation = data.kind === "quotation";
  const isPurchaseOrder = data.kind === "purchase_order";
  const docLabel = isQuotation
    ? "quotation"
    : isPurchaseOrder
      ? "purchase order"
      : "sales order";
  const number = isQuotation
    ? doc.quotation_number
    : isPurchaseOrder
      ? doc.po_number
      : doc.so_number;
  const dateField = isQuotation
    ? doc.quotation_date
    : isPurchaseOrder
      ? doc.po_date
      : doc.order_date;
  const validUntil = isQuotation ? doc.valid_until : doc.expected_delivery_date;
  const lines: ApproveLine[] = doc.lines ?? [];
  const responded = doc.debtor_approval_status === "approved" || doc.debtor_approval_status === "rejected";
  const statusLabel =
    doc.debtor_approval_status === "approved"
      ? "✅ Approved by you"
      : doc.debtor_approval_status === "rejected"
        ? "❌ Rejected by you"
        : null;

  const effPrice = (l: ApproveLine) =>
    l.updated_unit_price != null ? l.updated_unit_price : l.unit_price;
  const qty = (l: ApproveLine) => l.ordered_qty ?? l.quantity;

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Toolbar — hidden on print */}
      <div className="no-print sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <FileCheck2 className="h-6 w-6 text-primary" />
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {isQuotation ? "Quotation" : isPurchaseOrder ? "Purchase Order" : "Sales Order"}{" "}
                approval
              </div>
              <div className="font-display text-lg leading-tight">{number}</div>
            </div>
          </div>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm hover:border-primary hover:text-primary"
          >
            <Printer className="h-4 w-4" /> Save PDF
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-8">
        {statusLabel ? (
          <div className="rounded-xl border border-border bg-card p-6 shadow-card">
            <div className="text-lg font-semibold">{statusLabel}</div>
            <p className="mt-2 text-sm text-muted-foreground">
              Thank you — your response has been recorded and shared with the sender.
            </p>
            {doc.debtor_approval_comments && (
              <div className="mt-4 rounded-md border border-border bg-muted/30 p-3 text-sm">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Your comments
                </div>
                {doc.debtor_approval_comments}
              </div>
            )}
          </div>
        ) : (
          <div id="approval-sheet" className="rounded-xl border border-border bg-card p-6 shadow-card print:border-0 print:p-0 print:shadow-none">
            <p className="text-sm text-muted-foreground">
              {data.debtor?.name || "Your company"} has sent you this {docLabel}. Please review the
              details below and confirm your acceptance. A PDF copy was attached to the email you
              received.
            </p>

            <dl className="mt-6 grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
              <div>
                <dt className="text-xs uppercase tracking-widest text-muted-foreground">
                  {isQuotation ? "Quotation #" : isPurchaseOrder ? "PO #" : "SO #"}
                </dt>
                <dd className="font-mono">{number}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-widest text-muted-foreground">
                  {isPurchaseOrder ? "Supplier" : "Customer"}
                </dt>
                <dd>{doc.customer_name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-widest text-muted-foreground">Contact</dt>
                <dd>{doc.contact_person ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-widest text-muted-foreground">
                  {isQuotation ? "Date" : isPurchaseOrder ? "PO date" : "Order date"}
                </dt>
                <dd>{fmtDate(dateField)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-widest text-muted-foreground">
                  {isQuotation ? "Valid until" : "Expected delivery"}
                </dt>
                <dd>{fmtDate(validUntil)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-widest text-muted-foreground">
                  Grand total
                </dt>
                <dd className="num font-semibold">{fmtMoney(Number(doc.grand_total))}</dd>
              </div>
            </dl>

            {/* Lines */}
            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-slate-900 text-left text-[10px] uppercase tracking-widest text-muted-foreground">
                    <th className="py-2 pr-2">Item</th>
                    <th className="py-2 pr-2 text-right">Qty</th>
                    <th className="py-2 pr-2 text-right">Unit</th>
                    <th className="py-2 pr-2 text-right">Unit price</th>
                    <th className="py-2 pr-2 text-right">GST %</th>
                    <th className="py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i} className="border-b border-slate-200">
                      <td className="py-2 pr-2">
                        <div className="font-medium">{l.name}</div>
                        {l.sku && <div className="font-mono text-xs text-muted-foreground">{l.sku}</div>}
                      </td>
                      <td className="py-2 pr-2 text-right">{qty(l).toLocaleString()}</td>
                      <td className="py-2 pr-2 text-right">{l.unit}</td>
                      <td className="py-2 pr-2 text-right num">{fmtMoney(effPrice(l))}</td>
                      <td className="py-2 pr-2 text-right">{l.gst_rate != null ? `${l.gst_rate}%` : "—"}</td>
                      <td className="py-2 text-right num">{fmtMoney(Number(l.line_total))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="ml-auto mt-4 w-64 space-y-1 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span className="num">{fmtMoney(Number(doc.subtotal))}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Discount</span>
                <span className="num">-{fmtMoney(Number(doc.total_discount))}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>GST total</span>
                <span className="num">{fmtMoney(Number(doc.gst_total))}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Freight</span>
                <span className="num">{fmtMoney(Number(doc.freight))}</span>
              </div>
              <div className="flex justify-between border-t-2 border-slate-900 pt-1.5 font-semibold">
                <span>Grand total</span>
                <span className="num">{fmtMoney(Number(doc.grand_total))}</span>
              </div>
            </div>

            {doc.notes && (
              <div className="mt-6 rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                <div className="text-[10px] uppercase tracking-widest">Notes</div>
                {doc.notes}
              </div>
            )}

            {!responded && !mode && (
              <div className="mt-8 flex flex-col gap-2 border-t border-border pt-6 sm:flex-row">
                <button
                  onClick={() => setMode("approved")}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-success px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95"
                >
                  <Check className="h-4 w-4" /> Approve {docLabel}
                </button>
                <button
                  onClick={() => setMode("rejected")}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-md border border-destructive/50 px-4 py-3 text-sm font-semibold text-destructive transition hover:bg-destructive/10"
                >
                  <X className="h-4 w-4" /> Reject
                </button>
              </div>
            )}

            {!responded && mode && (
              <div className="mt-8 space-y-3 border-t border-border pt-6">
                {mode === "rejected" && (
                  <textarea
                    value={comments}
                    onChange={(e) => setComments(e.target.value)}
                    rows={4}
                    required
                    placeholder="Reason for rejection…"
                    className="w-full rounded-md border border-border bg-background p-3 text-sm"
                  />
                )}
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => {
                      setMode(null);
                      setComments("");
                    }}
                    className="rounded-md border border-border px-4 py-2 text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={respond.isPending || (mode === "rejected" && !comments.trim())}
                    onClick={() => respond.mutate({ decision: mode, comments: comments.trim() })}
                    className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
                  >
                    {respond.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    Confirm {mode === "approved" ? "approval" : "rejection"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          body { background: white !important; }
          .no-print { display: none !important; }
          #approval-sheet { box-shadow: none !important; }
        }
      `}</style>
    </div>
  );
}
