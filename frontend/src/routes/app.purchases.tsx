import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, StatusPill, fmtMoney, fmtDate, daysBetween } from "@/components/ledger-ui";
import { Plus, X, Loader2, Link2, Mail } from "lucide-react";
import { TableSkeleton } from "@/components/skeletons";
import { toast } from "sonner";
import { DocumentUploader, type DocMeta } from "@/components/document-uploader";

export const Route = createFileRoute("/app/purchases")({
  component: PurchasesPage,
});

function PurchasesPage() {
  const { user, isAdmin, isChecker, isClient, isTreasury } = useAuth();
  const canCreate = isAdmin || (isClient && !isChecker && !isTreasury);
  const canReview = isAdmin || isChecker;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("all");

  const piQ = useQuery({
    queryKey: ["purchase_invoices"],
    queryFn: async () => {
      const data = await api.purchaseInvoices.list();
      return data.reverse();
    },
  });

  const vendorsQ = useQuery({
    queryKey: ["vendors-min"],
    queryFn: async () => {
      const data = await api.vendors.list();
      return data.map((v: any) => ({ id: v.id, name: v.name, payment_terms_days: v.paymentTermsDays ?? v.payment_terms_days })).sort((a: any, b: any) => a.name?.localeCompare(b.name ?? "") ?? 0);
    },
  });

  // Linked sales invoices (the trail)
  const salesQ = useQuery({
    queryKey: ["invoices-by-pi"],
    queryFn: async () => {
      const data = await api.invoices.list();
      return data.map((s: any) => ({ id: s.id, invoice_number: s.invoiceNumber ?? s.invoice_number, amount: s.amount, status: s.status, purchase_invoice_id: s.purchaseInvoiceId ?? s.purchase_invoice_id }));
    },
  });

  const linkedSales = (piId: string) => (salesQ.data ?? []).filter((s: any) => s.purchase_invoice_id === piId);

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const patch: any = { status };
      if (status === "paid") patch.paid_date = new Date().toISOString().slice(0, 10);
      await api.purchaseInvoices.update(id, patch);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["purchase_invoices"] }); toast.success("Updated"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // Send reminder mutation for purchase invoices
  const sendReminder = useMutation({
    mutationFn: async (invoiceId: string) => {
      return api.reminders.sendPurchase(invoiceId);
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["reminder-logs"] });
      toast.success(data.message || "Reminder sent successfully");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to send reminder"),
  });

  const filtered = (piQ.data ?? []).filter((p: any) => filter === "all" || p.status === filter);

  const totals = (piQ.data ?? []).reduce(
    (a: any, p: any) => {
      a.all += Number(p.amount);
      if (p.status !== "paid") a.open += Number(p.amount);
      return a;
    },
    { all: 0, open: 0 },
  );

  return (
    <div>
      <PageHeader
        eyebrow="Procurement"
        title="Purchase invoices"
        description="Invoices you receive from suppliers, with PO details and links to the sales they support."
        actions={
          canCreate ? (
            <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              <Plus className="h-4 w-4" /> New purchase invoice
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
              Read-only · {isChecker ? "Checker" : isTreasury ? "Treasury" : "View"}
            </span>
          )
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        <div className="grid gap-4 md:grid-cols-3">
          <Card title="Total purchases"><div className="num text-3xl">{fmtMoney(totals.all)}</div></Card>
          <Card title="Open payables"><div className="num text-3xl text-warning">{fmtMoney(totals.open)}</div></Card>
          <Card title="Suppliers used"><div className="num text-3xl">{new Set((piQ.data ?? []).map((p: any) => p.vendor_id)).size}</div></Card>
        </div>

        <div className="flex flex-wrap gap-2">
          {["all", "pending", "approved", "paid", "overdue", "disputed"].map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              className={`rounded-full border px-3 py-1 text-xs uppercase tracking-widest transition ${
                filter === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}>{s}</button>
          ))}
        </div>

        <Card>
          {piQ.isLoading ? (
            <TableSkeleton rows={6} cols={9} />
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No purchase invoices.</div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Invoice</th>
                    <th className="px-5 py-2 text-left font-normal">Supplier</th>
                    <th className="px-5 py-2 text-left font-normal">PO</th>
                    <th className="px-5 py-2 text-right font-normal">Amount</th>
                    <th className="px-5 py-2 text-left font-normal">Due</th>
                    <th className="px-5 py-2 text-right font-normal">Late days</th>
                    <th className="px-5 py-2 text-left font-normal">Status</th>
                    <th className="px-5 py-2 text-left font-normal">Linked sales</th>
                    <th className="px-5 py-2 text-right font-normal">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p: any) => {
                    const dpd = p.due_date && p.status !== "paid" ? daysBetween(p.due_date) : 0;
                    let lateDays = Math.max(0, dpd);
                    if (p.status === "paid" && p.due_date && p.paid_date) {
                      const ms = new Date(p.paid_date).getTime() - new Date(p.due_date).getTime();
                      lateDays = Math.max(0, Math.round(ms / 86400000));
                    }
                    const links = linkedSales(p.id);
                    return (
                      <tr key={p.id} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-3 font-mono text-xs">{p.invoice_number}</td>
                        <td className="px-5 py-3">{p.vendor?.name ?? "—"}</td>
                        <td className="px-5 py-3">
                          {p.po_number ? (
                            <div>
                              <div className="font-mono text-xs">{p.po_number}</div>
                              <div className="text-[10px] text-muted-foreground">{p.po_date ? fmtDate(p.po_date) : ""}{p.po_amount ? ` · ${fmtMoney(p.po_amount)}` : ""}</div>
                            </div>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-5 py-3 text-right num">{fmtMoney(p.amount)}</td>
                        <td className="px-5 py-3 text-sm">{fmtDate(p.due_date)}</td>
                        <td className={`px-5 py-3 text-right num ${lateDays > 0 ? "text-destructive" : "text-muted-foreground"}`}>{lateDays}</td>
                        <td className="px-5 py-3"><StatusPill status={p.status} /></td>
                        <td className="px-5 py-3">
                          {links.length === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <div className="space-y-0.5">
                              {links.map((s: any) => (
                                <Link key={s.id} to="/app/invoices" className="flex items-center gap-1 text-xs text-primary hover:underline">
                                  <Link2 className="h-3 w-3" />{s.invoice_number}
                                  <span className="text-muted-foreground">→ {s.debtor?.name ?? "?"}</span>
                                </Link>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="inline-flex gap-1">
                            {/* Send reminder button for unpaid purchase invoices */}
                            {isAdmin && p.status !== "paid" && p.status !== "rejected" && p.status !== "cancelled" && p.due_date && (
                              <button
                                onClick={() => sendReminder.mutate(p.id)}
                                disabled={sendReminder.isPending}
                                className="inline-flex items-center gap-1 rounded-md border border-amber-400/50 px-2 py-1 text-[10px] text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/20 disabled:opacity-50"
                                title="Send reminder email for this purchase invoice"
                              >
                                <Mail className="h-3 w-3" /> Remind
                              </button>
                            )}
                            {p.status === "pending" && (
                              canReview ? (
                                <Link to="/app/checker" className="text-[10px] uppercase tracking-widest text-primary hover:underline">Review →</Link>
                              ) : (
                                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Awaiting checker</span>
                              )
                            )}
                            {(p.status === "approved" || p.status === "advanced") && (
                              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">In funding queue</span>
                            )}
                            {p.status === "paid" && (
                              <span className="text-[10px] uppercase tracking-widest text-success">Closed</span>
                            )}
                            {p.status === "overdue" && (
                              <span className="text-[10px] uppercase tracking-widest text-destructive">Overdue</span>
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

      {open && user && (
        <NewPurchaseModal
          userId={user.id}
          vendors={vendorsQ.data ?? []}
          onClose={() => setOpen(false)}
          onCreated={() => qc.invalidateQueries({ queryKey: ["purchase_invoices"] })}
        />
      )}
    </div>
  );
}

function ActionBtn({ children, onClick, tone = "default" }: { children: React.ReactNode; onClick: () => void; tone?: "default" | "primary" | "success" | "destructive" }) {
  const cls = {
    default: "border-border hover:bg-muted",
    primary: "border-primary/50 text-primary hover:bg-primary/10",
    success: "border-success/50 text-success hover:bg-success/10",
    destructive: "border-destructive/50 text-destructive hover:bg-destructive/10",
  }[tone];
  return <button onClick={onClick} className={`rounded-md border px-2.5 py-1 text-xs ${cls}`}>{children}</button>;
}

function NewPurchaseModal({ userId, vendors, onClose, onCreated }: { userId: string; vendors: any[]; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    invoice_number: "",
    vendor_id: vendors[0]?.id ?? "",
    amount: "",
    po_number: "",
    po_date: "",
    po_amount: "",
    issue_date: new Date().toISOString().slice(0, 10),
    due_date: "",
    notes: "",
  });
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [inv, setInv] = useState({ enabled: false, item_name: "", sku: "", quantity: "", unit: "unit", unit_cost: "" });

  // Lookup proformas/advances by PO number (purchase side)
  const poLookupQ = useQuery({
    queryKey: ["po-lookup-purchase", form.po_number],
    enabled: !!form.po_number.trim(),
    queryFn: async () => {
      const po = form.po_number.trim();
      const orders = await api.purchaseOrders.list();
      const pfs = orders.filter((o: any) => o.side === "purchase" && o.po_number === po);
      const pfIds = pfs.map((p: any) => p.id);
      let advances: any[] = [];
      if (pfIds.length) {
        const allAdvances = await api.advances.list();
        advances = allAdvances.filter((a: any) => a.side === "purchase" && pfIds.includes(a.purchaseOrderId ?? a.purchase_order_id) && a.status !== "refunded");
      }
      return { proformas: pfs, advances };
    },
  });

  const advancesTotal = ((poLookupQ.data?.advances ?? []) as any[])
    .filter((a) => a.status !== "refunded")
    .reduce((s, a) => s + Number(a.amount), 0);
  const balanceDue = Math.max(0, Number(form.amount || 0) - advancesTotal);

  const selectedVendor = vendors.find((v: any) => v.id === form.vendor_id);
  const termsDays = Number(selectedVendor?.payment_terms_days ?? 30) || 30;
  const computedDue = (() => {
    if (!form.issue_date) return "";
    const d = new Date(form.issue_date);
    d.setDate(d.getDate() + termsDays);
    return d.toISOString().slice(0, 10);
  })();
  const effectiveDue = form.due_date || computedDue;


  const create = useMutation({
    mutationFn: async () => {
      if (!form.vendor_id) throw new Error("Add a supplier first.");
      if (!form.invoice_number.trim()) throw new Error("Invoice number required");
      if (!form.amount || Number(form.amount) <= 0) throw new Error("Amount must be > 0");
      const created = await api.purchaseInvoices.create({
        clientId: userId,
        vendor_id: form.vendor_id,
        invoice_number: form.invoice_number.trim(),
        amount: Number(form.amount),
        po_number: form.po_number || null,
        po_date: form.po_date || null,
        po_amount: form.po_amount ? Number(form.po_amount) : null,
        issue_date: form.issue_date,
        due_date: effectiveDue || null,
        notes: form.notes || null,
        documents: docs,
        status: "pending",
      });
      // Apply any open advances linked to proformas with matching PO number (purchase side)
      const pfIds = (poLookupQ.data?.proformas ?? []).map((p: any) => p.id);
      if (form.po_number.trim() && pfIds.length) {
        for (const pfId of pfIds) {
          try { await api.advances.update(pfId, { status: "applied" }); } catch {}
        }
      }
      if (inv.enabled && inv.item_name.trim() && Number(inv.quantity) > 0) {
        await api.stockMovements.create({
          clientId: userId,
          direction: "in",
          itemName: inv.item_name.trim(),
          sku: inv.sku || null,
          quantity: Number(inv.quantity),
          unit: inv.unit || "unit",
          unitCost: inv.unit_cost ? Number(inv.unit_cost) : null,
          purchaseInvoiceId: created?.id,
          movementDate: form.issue_date,
        });
      }
    },
    onSuccess: () => { onCreated(); toast.success("Purchase invoice recorded"); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card shadow-vault" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">New purchase invoice</h3>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-5 p-5">
          {vendors.length === 0 && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
              Add a supplier first in the Suppliers tab.
            </div>
          )}

          <div>
            <div className="mb-2 text-xs uppercase tracking-widest text-primary">Purchase order</div>
            <div className="grid gap-3 md:grid-cols-3">
              <L label="PO number"><input maxLength={80} className="inp" value={form.po_number} onChange={(e) => setForm({ ...form, po_number: e.target.value })} placeholder="PO-2026-001" /></L>
              <L label="PO date"><input type="date" className="inp" value={form.po_date} onChange={(e) => setForm({ ...form, po_date: e.target.value })} /></L>
              <L label="PO amount"><input type="number" step="0.01" min="0" className="inp" value={form.po_amount} onChange={(e) => setForm({ ...form, po_amount: e.target.value })} /></L>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">Enter the PO number to auto-deduct any advances paid against it.</p>
          </div>

          {form.po_number.trim() && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
              <div className="mb-1 uppercase tracking-widest text-primary">Advances paid against PO {form.po_number}</div>
              {poLookupQ.isFetching ? (
                <div className="text-muted-foreground">Looking up…</div>
              ) : (poLookupQ.data?.advances ?? []).length === 0 ? (
                <div className="text-muted-foreground">No advances recorded for this PO number on the purchase side.</div>
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
                <span>Advance paid</span><span className="num text-primary">{fmtMoney(advancesTotal)}</span>
              </div>
              <div className="flex justify-between font-medium border-t border-border pt-1 mt-1">
                <span>Balance due to supplier</span><span className="num">{fmtMoney(balanceDue)}</span>
              </div>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <L label="Invoice number *"><input required maxLength={80} className="inp" value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} /></L>
            <L label="Supplier *">
              <select required className="inp" value={form.vendor_id} onChange={(e) => setForm({ ...form, vendor_id: e.target.value })}>
                <option value="">Select supplier</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </L>
            <L label="Total invoice amount *"><input required type="number" step="0.01" min="0" className="inp" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></L>
            <L label="Issue date"><input required type="date" className="inp" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} /></L>
            <L label={`Due date${selectedVendor ? ` (auto: ${termsDays}d net)` : ""}`}><input type="date" className="inp" value={effectiveDue} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></L>
          </div>

          <L label="Notes"><textarea rows={2} className="inp" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></L>

          <DocumentUploader userId={userId} scope="purchase_invoices" docs={docs} onChange={setDocs}
            hint="Attach the supplier invoice, BL, packing list, or other supporting paperwork." />

          <div className="rounded-md border border-border p-3">
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={inv.enabled} onChange={(e) => setInv({ ...inv, enabled: e.target.checked })} />
              <span className="uppercase tracking-widest text-muted-foreground">Track inventory (stock-in / credit)</span>
            </label>
            {inv.enabled && (
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <L label="Item *"><input className="inp" value={inv.item_name} onChange={(e) => setInv({ ...inv, item_name: e.target.value })} /></L>
                <L label="SKU"><input className="inp" value={inv.sku} onChange={(e) => setInv({ ...inv, sku: e.target.value })} /></L>
                <L label="Quantity *"><input type="number" step="0.001" min="0" className="inp" value={inv.quantity} onChange={(e) => setInv({ ...inv, quantity: e.target.value })} /></L>
                <L label="Unit"><input className="inp" value={inv.unit} onChange={(e) => setInv({ ...inv, unit: e.target.value })} /></L>
                <L label="Unit cost"><input type="number" step="0.01" min="0" className="inp" value={inv.unit_cost} onChange={(e) => setInv({ ...inv, unit_cost: e.target.value })} /></L>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
            <button disabled={create.isPending} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>{children}</label>;
}
