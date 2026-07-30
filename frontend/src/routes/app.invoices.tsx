import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, StatusPill, fmtMoney, fmtDate, daysBetween } from "@/components/ledger-ui";
import { Plus, X, Loader2, Link2, Send, Copy, Eye, Trash2, Mail } from "lucide-react";
import { TableSkeleton } from "@/components/skeletons";
import { toast } from "sonner";
import { DocumentUploader, type DocMeta } from "@/components/document-uploader";

export const Route = createFileRoute("/app/invoices")({
  component: InvoicesPage,
});

function InvoicesPage() {
  const { isAdmin, isChecker, isClient, isTreasury, user } = useAuth();
  const canReview = isAdmin || isChecker;
  const canCreate = isAdmin || (isClient && !isChecker && !isTreasury);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<string>("all");

  const invoicesQ = useQuery({
    queryKey: ["invoices", "list"],
    queryFn: async () => {
      const data = await api.invoices.list();
      return data.reverse();
    },
  });

  const debtorsQ = useQuery({
    queryKey: ["debtors"],
    queryFn: async () => {
      const data = await api.debtors.list();
      return data.map((d: any) => ({ id: d.id, name: d.name, credit_limit: d.creditLimit ?? d.credit_limit, risk_score: d.riskScore ?? d.risk_score, payment_terms_days: d.paymentTermsDays ?? d.payment_terms_days }));
    },
  });


  const purchasesQ = useQuery({
    queryKey: ["purchases-for-link"],
    queryFn: async () => {
      const data = await api.purchaseInvoices.list();
      return data.reverse();
    },
  });

  const sendNoa = useMutation({
    mutationFn: async (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const patch: any = { noa_status: "sent", noa_sent_at: new Date().toISOString() };
      await api.invoices.update(id, patch);
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      const inv = (invoicesQ.data ?? []).find((x: any) => x.id === id);
      const link = `${window.location.origin}/noa/${inv?.noa_token}`;
      navigator.clipboard?.writeText(link).catch(() => {});
      toast.success(`NOA link copied — share with ${inv?.debtor?.contact_email || "debtor"}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const copyNoa = (i: any) => {
    const link = `${window.location.origin}/noa/${i.noa_token}`;
    navigator.clipboard?.writeText(link).catch(() => {});
    toast.success("NOA link copied");
  };

  // Send reminder mutation
  const sendReminder = useMutation({
    mutationFn: async (invoiceId: string) => {
      return api.reminders.send(invoiceId);
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["reminder-logs"] });
      toast.success(data.message || "Reminder sent successfully");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to send reminder"),
  });

  const filtered = (invoicesQ.data ?? []).filter((i) => filter === "all" || i.status === filter);

  return (
    <div>
      <PageHeader
        eyebrow="Invoices"
        title={isAdmin ? "Invoice queue" : "Your invoices"}
        description={isAdmin ? "Submitted invoices route to the checker for approval before reaching treasury." : "Submit invoices; the checker reviews them before they enter the funding queue."}
        breadcrumbs={[
          { label: "Dashboard", href: "/app/dashboard" },
          { label: "Invoices" },
        ]}
        actions={
          canCreate ? (
            <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              <Plus className="h-4 w-4" /> New invoice
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
              Read-only · {isChecker ? "Checker" : isTreasury ? "Treasury" : "View"}
            </span>
          )
        }
      />

      <div className="p-6 md:p-10 space-y-6">
        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          {["all", "pending", "approved", "advanced", "paid", "overdue", "rejected"].map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              className={`rounded-full border px-3 py-1 text-xs uppercase tracking-widest transition ${
                filter === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}>{s}</button>
          ))}
        </div>

        <Card>
          {invoicesQ.isLoading ? (
            <TableSkeleton rows={7} cols={10} />
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No invoices.</div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Invoice</th>
                    {isAdmin && <th className="px-5 py-2 text-left font-normal">Client</th>}
                    <th className="px-5 py-2 text-left font-normal">Debtor</th>
                    <th className="px-5 py-2 text-right font-normal">Amount</th>
                    <th className="px-5 py-2 text-right font-normal">Advance</th>
                    <th className="px-5 py-2 text-left font-normal">Due</th>
                    <th className="px-5 py-2 text-right font-normal">Late days</th>
                    <th className="px-5 py-2 text-left font-normal">Status</th>
                    <th className="px-5 py-2 text-left font-normal">NOA</th>
                    <th className="px-5 py-2 text-right font-normal">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((i: any) => {
                    const adv = (Number(i.amount) * Number(i.advance_rate)) / 100;
                    const dpd = i.due_date && i.status !== "paid" ? daysBetween(i.due_date) : 0;
                    const lateDays = i.status === "paid"
                      ? (i.late_days != null ? Number(i.late_days) : 0)
                      : Math.max(0, dpd);
                    return (
                      <tr key={i.id} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-3">
                          <div className="font-mono text-xs">{i.invoice_number}</div>
                          {i.po_number && <div className="text-[10px] text-muted-foreground">PO {i.po_number}{i.po_date ? ` · ${fmtDate(i.po_date)}` : ""}</div>}
                          {i.purchase && (
                            <Link to="/app/purchases" className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-primary hover:underline">
                              <Link2 className="h-2.5 w-2.5" /> {i.purchase.invoice_number} · {i.purchase.vendor?.name ?? ""}
                            </Link>
                          )}
                        </td>
                        {isAdmin && <td className="px-5 py-3 text-muted-foreground">{i.client?.company_name ?? "—"}</td>}
                        <td className="px-5 py-3">{i.debtor?.name ?? "—"}</td>
                        <td className="px-5 py-3 text-right num">{fmtMoney(i.amount)}</td>
                        <td className="px-5 py-3 text-right num text-primary">{fmtMoney(adv)}</td>
                        <td className="px-5 py-3 text-sm">{fmtDate(i.due_date)}</td>
                        <td className={`px-5 py-3 text-right num ${lateDays > 0 ? "text-destructive" : "text-muted-foreground"}`}>{lateDays}</td>
                        <td className="px-5 py-3"><StatusPill status={i.status} /></td>
                        <td className="px-5 py-3">
                          <NoaBadge status={i.noa_status} />
                          {i.noa_comments && <div className="mt-1 max-w-[160px] truncate text-[10px] text-muted-foreground" title={i.noa_comments}>“{i.noa_comments}”</div>}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="inline-flex flex-wrap justify-end gap-1">
                            <Link
                              to="/app/invoice-preview/$id"
                              params={{ id: i.id }}
                              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary"
                              title="Preview & download PDF"
                            >
                              <Eye className="h-3 w-3" /> Preview
                            </Link>
                            {/* Send reminder button for unpaid invoices */}
                            {isAdmin && i.status !== "paid" && i.status !== "rejected" && i.status !== "cancelled" && i.due_date && (
                              <button
                                onClick={() => sendReminder.mutate(i.id)}
                                disabled={sendReminder.isPending}
                                className="inline-flex items-center gap-1 rounded-md border border-amber-400/50 px-2 py-1 text-[10px] text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/20 disabled:opacity-50"
                                title="Send reminder email for this invoice"
                              >
                                <Mail className="h-3 w-3" /> Remind
                              </button>
                            )}
                            {(i.noa_status === "not_sent") && (
                              <button onClick={() => sendNoa.mutate(i.id)} className="inline-flex items-center gap-1 rounded-md border border-primary/50 px-2 py-1 text-[10px] text-primary hover:bg-primary/10">
                                <Send className="h-3 w-3" /> Send NOA
                              </button>
                            )}
                            {i.noa_status !== "not_sent" && (
                              <button onClick={() => copyNoa(i)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] hover:bg-muted">
                                <Copy className="h-3 w-3" /> Copy NOA link
                              </button>
                            )}
                            {isAdmin && i.status === "pending" && (
                              canReview ? (
                                <Link to="/app/checker" className="text-[10px] uppercase tracking-widest text-primary hover:underline">Review →</Link>
                              ) : (
                                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Awaiting checker</span>
                              )
                            )}
                            {isAdmin && (i.status === "approved" || i.status === "advanced" || i.status === "funded") && (
                              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">In funding queue</span>
                            )}
                            {isAdmin && i.status === "paid" && (
                              <span className="text-[10px] uppercase tracking-widest text-success">Closed</span>
                            )}
                          </div>
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

      {open && <NewInvoiceModal onClose={() => setOpen(false)} debtors={debtorsQ.data ?? []} purchases={purchasesQ.data ?? []} userId={user!.id} />}
    </div>
  );
}

function NoaBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    not_sent: { label: "Not sent", cls: "border-border text-muted-foreground" },
    sent: { label: "Awaiting reply", cls: "border-warning/50 text-warning" },
    accepted: { label: "Accepted", cls: "border-success/50 text-success" },
    rejected: { label: "Rejected", cls: "border-destructive/50 text-destructive" },
    commented: { label: "Commented", cls: "border-primary/50 text-primary" },
  };
  const v = map[status] ?? map.not_sent;
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${v.cls}`}>{v.label}</span>;
}

function ActionBtn({ children, onClick, tone = "default" }: { children: React.ReactNode; onClick: () => void; tone?: "default" | "primary" | "success" | "destructive" }) {
  const cls = {
    default: "border-border hover:bg-muted",
    primary: "border-primary/50 text-primary hover:bg-primary/10",
    success: "border-success/50 text-success hover:bg-success/10",
    destructive: "border-destructive/50 text-destructive hover:bg-destructive/10",
  }[tone];
  return (
    <button onClick={onClick} className={`rounded-md border px-2.5 py-1 text-xs ${cls}`}>{children}</button>
  );
}

function NewInvoiceModal({ onClose, debtors, purchases, userId }: { onClose: () => void; debtors: any[]; purchases: any[]; userId: string }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"generated" | "manual">("generated");
  const [form, setForm] = useState({
    invoice_number: "",
    debtor_id: debtors[0]?.id ?? "",
    amount: "",
    advance_rate: "80",
    issue_date: new Date().toISOString().slice(0, 10),
    due_date: "",
    po_number: "",
    po_date: "",
    po_amount: "",
    purchase_invoice_id: "",
    tax_rate: "0",
    notes: "",
  });
  type Line = { description: string; quantity: number; unit_price: number };
  const [lines, setLines] = useState<Line[]>([{ description: "", quantity: 1, unit_price: 0 }]);
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [inv, setInv] = useState({ enabled: false, item_name: "", sku: "", quantity: "", unit: "unit", unit_cost: "" });

  // Pull the template once to seed currency symbol / default tax
  const tplQ = useQuery({
    queryKey: ["invoice-template", userId],
    queryFn: async () => {
      const data = await api.invoiceTemplates.get();
      return data;
    },
  });
  const currencySym = (tplQ.data?.currency_symbol as string) || "$";
  useEffect(() => {
    if (tplQ.data && form.tax_rate === "0") {
      setForm((f) => ({ ...f, tax_rate: String(tplQ.data!.default_tax_rate ?? 0) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tplQ.data?.default_tax_rate]);

  // When generating, auto-compute amount from lines + tax
  const subtotal = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unit_price || 0), 0);
  const taxAmount = (subtotal * Number(form.tax_rate || 0)) / 100;
  const generatedTotal = subtotal + taxAmount;
  useEffect(() => {
    if (mode === "generated") {
      setForm((f) => (Number(f.amount) === generatedTotal ? f : { ...f, amount: generatedTotal ? generatedTotal.toFixed(2) : "" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, subtotal, taxAmount]);

  // Lookup proformas/advances by PO number (sales side) once user enters a PO #
  const poLookupQ = useQuery({
    queryKey: ["po-lookup-sales", form.po_number],
    enabled: !!form.po_number.trim(),
    queryFn: async () => {
      const po = form.po_number.trim();
      const orders = await api.purchaseOrders.list();
      const pfs = orders.filter((o: any) => o.side === "sales" && o.po_number === po);
      const pfIds = pfs.map((p: any) => p.id);
      let advances: any[] = [];
      if (pfIds.length) {
        const allAdvances = await api.advances.list();
        advances = allAdvances.filter((a: any) => a.side === "sales" && pfIds.includes(a.purchaseOrderId ?? a.purchase_order_id) && a.status !== "refunded");
      }
      return { proformas: pfs, advances };
    },
  });

  const advancesTotal = ((poLookupQ.data?.advances ?? []) as any[])
    .filter((a) => a.status !== "refunded")
    .reduce((s, a) => s + Number(a.amount), 0);
  const balanceDue = Math.max(0, Number(form.amount || 0) - advancesTotal);

  // Auto-derive due date from selected debtor's payment terms whenever debtor or issue date changes
  const selectedDebtor = debtors.find((d: any) => d.id === form.debtor_id);
  const termsDays = Number(selectedDebtor?.payment_terms_days ?? 30) || 30;
  const computedDue = (() => {
    if (!form.issue_date) return "";
    const d = new Date(form.issue_date);
    d.setDate(d.getDate() + termsDays);
    return d.toISOString().slice(0, 10);
  })();
  const effectiveDue = form.due_date || computedDue;


  const create = useMutation({
    mutationFn: async () => {
      if (!form.debtor_id) throw new Error("Please add a debtor first.");
      const cleanLines = lines
        .filter((l) => l.description.trim() && Number(l.quantity) > 0)
        .map((l) => ({
          description: l.description.trim(),
          quantity: Number(l.quantity),
          unit_price: Number(l.unit_price),
          line_total: Number(l.quantity) * Number(l.unit_price),
        }));
      if (mode === "generated" && cleanLines.length === 0) throw new Error("Add at least one line item to generate an invoice.");
      const subTotal = mode === "generated" ? cleanLines.reduce((s, l) => s + l.line_total, 0) : Number(form.amount);
      const taxRateN = Number(form.tax_rate || 0);
      const taxAmtN = mode === "generated" ? (subTotal * taxRateN) / 100 : 0;
      const totalAmt = mode === "generated" ? subTotal + taxAmtN : Number(form.amount);

      const created = await api.invoices.create({
        clientId: userId,
        debtor_id: form.debtor_id,
        invoice_number: form.invoice_number,
        amount: totalAmt,
        advance_rate: Number(form.advance_rate),
        fee_rate: 0,
        issue_date: form.issue_date,
        due_date: effectiveDue,
        source: mode,
        line_items: cleanLines,
        subtotal: subTotal,
        tax_rate: taxRateN,
        tax_amount: taxAmtN,
        notes: form.notes || null,
        po_number: form.po_number || null,
        po_date: form.po_date || null,
        po_amount: form.po_amount ? Number(form.po_amount) : null,
        purchase_invoice_id: form.purchase_invoice_id || null,
        documents: docs,
        status: "pending",
      });
      // Apply any open advances linked to proformas with matching PO number (sales side)
      const pfIds = (poLookupQ.data?.proformas ?? []).map((p: any) => p.id);
      if (form.po_number.trim() && pfIds.length) {
        for (const pfId of pfIds) {
          try { await api.advances.update(pfId, { status: "applied" }); } catch {}
        }
      }
      if (inv.enabled && inv.item_name.trim() && Number(inv.quantity) > 0) {
        await api.stockMovements.create({
          clientId: userId,
          direction: "out",
          itemName: inv.item_name.trim(),
          sku: inv.sku || null,
          quantity: Number(inv.quantity),
          unit: inv.unit || "unit",
          unitCost: inv.unit_cost ? Number(inv.unit_cost) : null,
          invoiceId: created.id,
          movementDate: form.issue_date,
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["purchase_orders"] });
      qc.invalidateQueries({ queryKey: ["advances"] });
      toast.success("Invoice submitted for review.");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card shadow-vault" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">Submit invoice</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-4 p-5">
          {debtors.length === 0 && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
              No debtors exist yet. Ask your factor admin to add one in the Debtors tab.
            </div>
          )}

          {/* Mode toggle */}
          <div className="rounded-md border border-border bg-background/40 p-1 grid grid-cols-2 gap-1">
            {(["generated", "manual"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-md px-3 py-2 text-xs uppercase tracking-widest transition ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {m === "generated" ? "Generate invoice" : "Manual entry (external invoice)"}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">
            {mode === "generated"
              ? "Build the invoice from line items using your saved template — preview and download as PDF."
              : "Record an invoice that was raised outside this platform. Attach the original PDF below."}
          </p>
          <div>
            <div className="mb-2 text-xs uppercase tracking-widest text-primary">Purchase order</div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="PO number"><input maxLength={80} className="inp" value={form.po_number} onChange={(e) => setForm({ ...form, po_number: e.target.value })} placeholder="PO-2026-001" /></Field>
              <Field label="PO date"><input type="date" className="inp" value={form.po_date} onChange={(e) => setForm({ ...form, po_date: e.target.value })} /></Field>
              <Field label="PO amount"><input type="number" step="0.01" min="0" className="inp" value={form.po_amount} onChange={(e) => setForm({ ...form, po_amount: e.target.value })} /></Field>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">Enter the PO number to auto-deduct any advances received against it.</p>
          </div>

          {form.po_number.trim() && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
              <div className="mb-1 uppercase tracking-widest text-primary">Advances received against PO {form.po_number}</div>
              {poLookupQ.isFetching ? (
                <div className="text-muted-foreground">Looking up…</div>
              ) : (poLookupQ.data?.advances ?? []).length === 0 ? (
                <div className="text-muted-foreground">No advances recorded for this PO number on the sales side.</div>
              ) : (
                <ul className="space-y-0.5">
                  {((poLookupQ.data?.advances ?? []) as any[]).map((a) => (
                    <li key={a.id} className="flex justify-between"><span className="text-muted-foreground">{fmtDate(a.advance_date)} {a.reference ? `· ${a.reference}` : ""}</span><span className="num text-primary">{fmtMoney(a.amount)}</span></li>
                  ))}
                </ul>
              )}
              <div className="mt-2 flex justify-between border-t border-border pt-2">
                <span>Total invoice amount</span><span className="num">{fmtMoney(Number(form.amount || 0))}</span>
              </div>
              <div className="flex justify-between">
                <span>Advance received</span><span className="num text-primary">{fmtMoney(advancesTotal)}</span>
              </div>
              <div className="flex justify-between font-medium border-t border-border pt-1 mt-1">
                <span>Balance outstanding</span><span className="num">{fmtMoney(balanceDue)}</span>
              </div>
            </div>
          )}

          <Field label="Invoice number"><input required value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} className="inp" placeholder="INV-00123" /></Field>
          <Field label="Debtor">
            <select required value={form.debtor_id} onChange={(e) => setForm({ ...form, debtor_id: e.target.value })} className="inp">
              <option value="">Select debtor</option>
              {debtors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>

          {mode === "generated" && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-widest text-primary">Line items</div>
                <button type="button" onClick={() => setLines([...lines, { description: "", quantity: 1, unit_price: 0 }])} className="text-[10px] uppercase tracking-widest text-primary hover:underline">+ Add line</button>
              </div>
              <table className="table-premium w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr><th className="text-left font-normal">Description</th><th className="w-20 text-right font-normal">Qty</th><th className="w-28 text-right font-normal">Rate</th><th className="w-28 text-right font-normal">Total</th><th className="w-6" /></tr>
                </thead>
                <tbody>
                  {lines.map((l, idx) => (
                    <tr key={idx}>
                      <td className="py-1 pr-2"><input className="inp" placeholder="Item description" value={l.description} onChange={(e) => setLines(lines.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))} /></td>
                      <td className="py-1 pr-2"><input type="number" step="0.001" min="0" className="inp text-right" value={l.quantity} onChange={(e) => setLines(lines.map((x, i) => i === idx ? { ...x, quantity: Number(e.target.value) } : x))} /></td>
                      <td className="py-1 pr-2"><input type="number" step="0.01" min="0" className="inp text-right" value={l.unit_price} onChange={(e) => setLines(lines.map((x, i) => i === idx ? { ...x, unit_price: Number(e.target.value) } : x))} /></td>
                      <td className="py-1 pr-2 text-right num text-muted-foreground">{currencySym}{(Number(l.quantity || 0) * Number(l.unit_price || 0)).toFixed(2)}</td>
                      <td className="py-1 text-right"><button type="button" onClick={() => setLines(lines.length > 1 ? lines.filter((_, i) => i !== idx) : lines)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="ml-auto w-56 space-y-1 border-t border-border pt-2 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="num">{currencySym}{subtotal.toFixed(2)}</span></div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Tax %</span>
                  <input type="number" step="0.01" min="0" className="inp h-7 w-20 text-right" value={form.tax_rate} onChange={(e) => setForm({ ...form, tax_rate: e.target.value })} />
                </div>
                <div className="flex justify-between text-muted-foreground"><span>Tax amount</span><span className="num">{currencySym}{taxAmount.toFixed(2)}</span></div>
                <div className="flex justify-between border-t border-border pt-1 font-medium"><span>Total</span><span className="num text-primary">{currencySym}{generatedTotal.toFixed(2)}</span></div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label={mode === "generated" ? "Total (auto from line items)" : "Total invoice amount"}>
              <input required type="number" step="0.01" value={form.amount} readOnly={mode === "generated"} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={`inp ${mode === "generated" ? "opacity-70" : ""}`} />
            </Field>
            <Field label="Advance % (0–100)"><input required type="number" step="0.1" min="0" max="100" value={form.advance_rate} onChange={(e) => setForm({ ...form, advance_rate: e.target.value })} className="inp" /></Field>
          </div>
          <p className="text-[10px] text-muted-foreground">Fee is built into the invoice as margin — no separate fee field.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Issue date"><input required type="date" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} className="inp" /></Field>
            <Field label={`Due date${selectedDebtor ? ` (auto: ${termsDays}d net)` : ""}`}>
              <input type="date" value={effectiveDue} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className="inp" />
            </Field>
          </div>

          <Field label="Link to purchase invoice (optional)">
            <select className="inp" value={form.purchase_invoice_id} onChange={(e) => setForm({ ...form, purchase_invoice_id: e.target.value })}>
              <option value="">— No link —</option>
              {purchases.map((p: any) => (
                <option key={p.id} value={p.id}>{p.invoice_number} · {p.vendor?.name ?? "?"} · {fmtMoney(p.amount)}</option>
              ))}
            </select>
          </Field>
          <div className="rounded-md border border-border bg-background/40 p-3 text-xs text-muted-foreground">
            Advance preview: <span className="num text-primary">{fmtMoney((Number(form.amount || 0) * Number(form.advance_rate || 0)) / 100)}</span>
          </div>
          <div className="rounded-md border border-border p-3">
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={inv.enabled} onChange={(e) => setInv({ ...inv, enabled: e.target.checked })} />
              <span className="uppercase tracking-widest text-muted-foreground">Track inventory (stock-out / debit)</span>
            </label>
            {inv.enabled && (
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
                <Field label="Item *"><input className="inp" value={inv.item_name} onChange={(e) => setInv({ ...inv, item_name: e.target.value })} /></Field>
                <Field label="SKU"><input className="inp" value={inv.sku} onChange={(e) => setInv({ ...inv, sku: e.target.value })} /></Field>
                <Field label="Quantity *"><input type="number" step="0.001" min="0" className="inp" value={inv.quantity} onChange={(e) => setInv({ ...inv, quantity: e.target.value })} /></Field>
                <Field label="Unit"><input className="inp" value={inv.unit} onChange={(e) => setInv({ ...inv, unit: e.target.value })} /></Field>
                <Field label="Unit cost"><input type="number" step="0.01" min="0" className="inp" value={inv.unit_cost} onChange={(e) => setInv({ ...inv, unit_cost: e.target.value })} /></Field>
              </div>
            )}
          </div>
          <Field label="Notes (optional — shown on the printed invoice)">
            <textarea rows={2} className="inp" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Delivery instructions, reference, etc." />
          </Field>
          <DocumentUploader userId={userId} scope="invoices" docs={docs} onChange={setDocs}
            hint={mode === "manual" ? "Attach the original invoice PDF and any supporting paperwork." : "Optional — attach any supporting paperwork (BL, packing list, etc.)."} />
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
            <button disabled={create.isPending} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Submit
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>{children}</label>;
}
