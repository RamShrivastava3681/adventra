import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, RotateCcw, X } from "lucide-react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { inclusiveTotals } from "@/lib/gst";
import { fmtMoney } from "@/components/ledger-ui";
import { inputBase } from "@/components/dialog";

/**
 * Sales return — pick invoice line quantities, submit for checker approval, and
 * raise a customer credit note linked to the source sales invoice.
 *
 * The credit note is created PENDING. On checker approval it is applied to the
 * source invoice if it still has an outstanding balance; any remainder becomes
 * customer credit for a future invoice.
 */
export function SalesReturnModal({
  invoice,
  onClose,
  onCreated,
}: {
  invoice: any;
  onClose: () => void;
  onCreated: () => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [warehouse, setWarehouse] = useState("");
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<{ note: any } | null>(null);

  const notesQ = useQuery({
    queryKey: ["credit-debit-notes", invoice?.id],
    enabled: !!invoice?.id,
    queryFn: () => api.creditDebitNotes.list(),
  });

  const previouslyReturned = useMemo(() => {
    const map: Record<string, number> = {};
    for (const n of notesQ.data ?? []) {
      if (n.kind !== "credit") continue;
      if (n.invoice_id !== invoice.id) continue;
      if (n.status !== "pending" && n.status !== "approved") continue;
      for (const l of n.line_items ?? []) {
        map[l.description] = (map[l.description] ?? 0) + Number(l.quantity || 0);
      }
    }
    return map;
  }, [notesQ.data, invoice.id]);

  const lines = useMemo(
    () =>
      (invoice?.lines ?? []).map((l: any) => {
        const invoiceQty = Number(l.quantity) || 0;
        const already = previouslyReturned[l.name] ?? 0;
        const eligible = Math.max(0, invoiceQty - already);
        return {
          ...l,
          invoiceQty,
          already,
          eligible,
          unitPrice: Number(l.unit_price) || 0,
          gstRate: l.gst_rate == null ? 0 : Number(l.gst_rate) || 0,
        };
      }),
    [invoice, previouslyReturned],
  );

  const chosen = lines.map((l: any) => ({
    ...l,
    qty: Number(qty[l.name ?? l.product_id]) || 0,
  }));

  const billed = inclusiveTotals(
    chosen.map((l: any) => ({ amount: l.qty * l.unitPrice, gstRate: l.gstRate })),
    0,
  );
  const { subtotal, gstTotal } = billed;
  const total = billed.grandTotal;

  const invoiceOutstanding = Math.max(
    0,
    (Number(invoice?.grand_total ?? invoice?.amount) || 0) -
      (Number(invoice?.amount_received ?? invoice?.amount_paid ?? 0) || 0) -
      (Number(invoice?.credit_adjusted ?? 0) || 0),
  );
  const willApply = Math.min(total, invoiceOutstanding);
  const willBecomeCredit = Math.max(0, total - willApply);

  const save = useMutation({
    mutationFn: async () => {
      if (!reason.trim()) throw new Error("A return reason is required");
      const payloadLines = chosen
        .filter((l: any) => l.qty > 0)
        .map((l: any) => ({
          description: l.name,
          quantity: l.qty,
          unit_price: l.unitPrice,
          line_total: l.qty * l.unitPrice,
        }));
      if (payloadLines.length === 0) throw new Error("Enter a quantity to return");
      const now = new Date();
      const noteNumber = `CR-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${Math.floor(
        Math.random() * 10000,
      )
        .toString()
        .padStart(4, "0")}`;
      return await api.creditDebitNotes.create({
        client_id: invoice.client_id,
        kind: "credit",
        note_number: noteNumber,
        note_date: now.toISOString().slice(0, 10),
        amount: total,
        reason: reason.trim(),
        counterparty: invoice.debtor?.name ?? invoice.customer_contact ?? "—",
        invoice_id: invoice.id,
        documents: [],
        source: "sales-return",
        line_items: payloadLines,
        subtotal: subtotal,
        tax_rate: 0,
        tax_amount: gstTotal,
      });
    },
    onSuccess: (data: any) => {
      setResult({ note: data });
      qc.invalidateQueries({ queryKey: ["credit-debit-notes"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      onCreated();
      toast.success("Credit note submitted for checker approval");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-vault"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <div>
            <h3 className="font-display text-lg">Return goods · {invoice?.invoice_number}</h3>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Customer {invoice?.debtor?.name ?? invoice?.customer_contact ?? "—"} · return creates
              a credit note
            </div>
          </div>
          <button onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5 text-sm">
          {result ? (
            <>
              <div className="rounded-lg border border-sem-success/40 bg-sem-success/5 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-sem-success">
                  <RotateCcw className="h-4 w-4" /> Credit note{" "}
                  {result.note.note_number ?? result.note.note_number} submitted
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Customer balance is unchanged until a checker approves it.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border border-border p-3">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Customer credit note
                  </div>
                  <div className="mt-1 font-mono text-sm">
                    {result.note.note_number ?? result.note.note_number}
                  </div>
                  <div className="num mt-1 text-lg font-semibold">
                    {fmtMoney(result.note.amount ?? result.note.amount)}
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    Status: {result.note.status ?? result.note.status}
                  </div>
                </div>
                <div className="rounded-md border border-border p-3">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    On approval
                  </div>
                  <div className="mt-1 text-xs">
                    {willApply > 0 ? (
                      <>
                        Applies <b className="num text-foreground">{fmtMoney(willApply)}</b> to this
                        invoice
                        {willBecomeCredit > 0 ? (
                          <>
                            ; <b className="num text-foreground">{fmtMoney(willBecomeCredit)}</b>{" "}
                            stays as customer credit.
                          </>
                        ) : (
                          "."
                        )}
                      </>
                    ) : (
                      <>
                        The invoice is already settled, so the full{" "}
                        <b className="num text-foreground">{fmtMoney(total)}</b> becomes customer
                        credit for the next invoice.
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex justify-end border-t border-border pt-3">
                <button
                  onClick={onClose}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
                >
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="overflow-x-auto rounded-md border border-border/60">
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-3 py-2 text-left font-normal">Product</th>
                      <th className="px-3 py-2 text-right font-normal">Invoiced</th>
                      <th className="px-3 py-2 text-right font-normal">Returned</th>
                      <th className="px-3 py-2 text-right font-normal">Eligible</th>
                      <th className="px-3 py-2 text-right font-normal">Return qty</th>
                      <th className="px-3 py-2 text-right font-normal">Unit price</th>
                      <th className="px-3 py-2 text-right font-normal">Line total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l: any) => (
                      <tr key={l.name ?? l.product_id} className="border-b border-border/40">
                        <td className="px-3 py-2">
                          <div className="font-medium">{l.name}</div>
                          {l.sku && (
                            <div className="font-mono text-[10px] text-muted-foreground">
                              {l.sku}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right num">{l.invoiceQty}</td>
                        <td className="px-3 py-2 text-right num">{l.already}</td>
                        <td className="px-3 py-2 text-right num">{l.eligible}</td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min="0"
                            max={l.eligible}
                            step="1"
                            disabled={l.eligible <= 0}
                            className="w-24 rounded-md border border-border bg-background px-2 py-1 text-right text-sm disabled:opacity-40"
                            value={qty[l.name ?? l.product_id] ?? ""}
                            onChange={(e) =>
                              setQty({ ...qty, [l.name ?? l.product_id]: e.target.value })
                            }
                            placeholder="0"
                          />
                        </td>
                        <td className="px-3 py-2 text-right num">{fmtMoney(l.unitPrice)}</td>
                        <td className="px-3 py-2 text-right num">
                          {fmtMoney((Number(qty[l.name ?? l.product_id]) || 0) * l.unitPrice)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                    Return reason (required)
                  </span>
                  <textarea
                    rows={3}
                    required
                    className={`${inputBase} resize-y`}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Damaged goods, wrong item, excess quantity…"
                  />
                </label>
                <div className="space-y-3">
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                      Warehouse / pickup location
                    </span>
                    <input
                      className={inputBase}
                      value={warehouse}
                      onChange={(e) => setWarehouse(e.target.value)}
                      placeholder="Optional"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                      Remarks
                    </span>
                    <input
                      className={inputBase}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Optional"
                    />
                  </label>
                </div>
              </div>

              <div className="ml-auto max-w-sm space-y-1 rounded-lg border border-border/60 bg-muted/20 p-4">
                <div className="flex justify-between">
                  <span className="text-xs uppercase tracking-widest text-muted-foreground">
                    Subtotal (ex-GST)
                  </span>
                  <span className="num">{fmtMoney(subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs uppercase tracking-widest text-muted-foreground">
                    GST
                  </span>
                  <span className="num">{fmtMoney(gstTotal)}</span>
                </div>
                <div className="flex justify-between border-t border-border pt-1.5 font-medium">
                  <span className="text-xs uppercase tracking-widest text-muted-foreground">
                    Credit note total
                  </span>
                  <span className="num text-base">{fmtMoney(total)}</span>
                </div>
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>Applies to this invoice on approval</span>
                  <span className="num">{fmtMoney(willApply)}</span>
                </div>
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>Remaining customer credit</span>
                  <span className="num">{fmtMoney(willBecomeCredit)}</span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-border px-4 py-2 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={save.isPending || total <= 0 || !reason.trim()}
                  onClick={() => save.mutate()}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                >
                  {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Submit return for approval
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
