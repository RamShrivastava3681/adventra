import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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
  const [editing, setEditing] = useState<any | null>(null);
  const [viewing, setViewing] = useState<any | null>(null);
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
      // Suppliers live in two places: the visible "Suppliers" page (Supplier
      // model) and legacy procurement vendors (Vendor model). Merge both so
      // the supplier dropdown is never empty when suppliers exist in the platform.
      const [suppliers, vendors] = await Promise.all([api.suppliers.list(), api.vendors.list()]);
      return [
        ...suppliers.map((s: any) => ({ id: s.id, name: s.company_name ?? s.companyName ?? s.name, payment_terms_days: s.paymentTermsDays ?? s.payment_terms_days ?? 30 })),
        ...vendors.map((v: any) => ({ id: v.id, name: v.name, payment_terms_days: v.paymentTermsDays ?? v.payment_terms_days ?? 30 })),
      ].sort((a: any, b: any) => a.name?.localeCompare(b.name ?? "") ?? 0);
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
                            <button onClick={() => setViewing(p)} className="rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary">View</button>
                            {canCreate && p.status !== "paid" && p.status !== "approved" && p.status !== "disputed" && (
                              <button onClick={() => setEditing(p)} className="rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary">Edit</button>
                            )}
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
      {editing && user && (
        <NewPurchaseModal
          invoice={editing}
          userId={user.id}
          vendors={vendorsQ.data ?? []}
          onClose={() => setEditing(null)}
          onCreated={() => qc.invalidateQueries({ queryKey: ["purchase_invoices"] })}
        />
      )}
      {viewing && <PurchaseDetailModal invoice={viewing} onClose={() => setViewing(null)} />}
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

function NewPurchaseModal({ invoice, userId, vendors, onClose, onCreated }: { invoice?: any; userId: string; vendors: any[]; onClose: () => void; onCreated: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!invoice;
  const [form, setForm] = useState({
    invoice_number: invoice?.invoice_number ?? "",
    vendor_id: invoice?.vendor_id ?? vendors[0]?.id ?? "",
    amount: invoice?.amount != null ? String(invoice.amount) : "",
    po_number: invoice?.po_number ?? "",
    po_date: (invoice?.po_date ?? "")?.slice(0, 10) ?? "",
    po_amount: invoice?.po_amount != null ? String(invoice.po_amount) : "",
    issue_date: (invoice?.issue_date ?? new Date().toISOString().slice(0, 10))?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    due_date: (invoice?.due_date ?? "")?.slice(0, 10) ?? "",
    notes: invoice?.notes ?? "",
  });
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [inv, setInv] = useState({ enabled: false, product_id: "", quantity: "", unit: "unit", unit_cost: "" });

  // Product catalogue — inventory items must link to an existing product
  const productsQ = useQuery({
    queryKey: ["products-for-purchase-inv"],
    queryFn: async () => {
      const data = await api.products.list();
      return (data ?? []).filter((p: any) => p.status === "active");
    },
  });

  // Lookup proformas/advances by PO number (purchase side)
  const poLookupQ = useQuery({
    queryKey: ["po-lookup-purchase", form.po_number],
    enabled: !!form.po_number.trim(),
    queryFn: async () => {
      const po = form.po_number.trim();
      const orders = await api.purchaseOrders.list();
      // Match by PO number OR proforma number — either can be typed into the field
      const pfs = orders.filter((o: any) => o.side === "purchase" && (o.po_number === po || o.proforma_number === po));
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

  // Auto-fill the PO amount from the matched proforma once per PO number entry,
  // so linking a proforma carries its PO amount onto the purchase invoice.
  const lastFetchedPo = useRef<string>("");
  useEffect(() => {
    if (!form.po_number.trim()) {
      lastFetchedPo.current = "";
      return;
    }
    const pfs = (poLookupQ.data?.proformas ?? []) as any[];
    const withAmount = pfs.find((p: any) => p.po_amount != null && Number(p.po_amount) > 0);
    if (withAmount && form.po_number.trim() !== lastFetchedPo.current) {
      lastFetchedPo.current = form.po_number.trim();
      setForm((f) => ({ ...f, po_amount: String(withAmount.po_amount) }));
    }
  }, [poLookupQ.data, form.po_number]);

  const selectedVendor = vendors.find((v: any) => v.id === form.vendor_id);
  const termsDays = Number(selectedVendor?.payment_terms_days ?? 30) || 30;
  const computedDue = (() => {
    if (!form.issue_date) return "";
    const d = new Date(form.issue_date);
    d.setDate(d.getDate() + termsDays);
    return d.toISOString().slice(0, 10);
  })();
  const effectiveDue = form.due_date || computedDue;


  const save = useMutation({
    mutationFn: async () => {
      if (!form.vendor_id) throw new Error("Add a supplier first.");
      if (!form.invoice_number.trim()) throw new Error("Invoice number required");
      if (!form.amount || Number(form.amount) <= 0) throw new Error("Amount must be > 0");
      if (inv.enabled && !inv.product_id) throw new Error("Select a product from the catalogue to track inventory");
      const payload = {
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
      };
      const created = isEdit && invoice
        ? await api.purchaseInvoices.update(invoice.id, payload)
        : await api.purchaseInvoices.create({ ...payload, clientId: userId, status: "pending" });
      if (isEdit) return;
      // Mark advances linked to matching proformas as applied (purchase side)
      const advs = (poLookupQ.data?.advances ?? []) as any[];
      if (form.po_number.trim() && advs.length) {
        for (const a of advs) {
          try { await api.advances.update(a.id, { status: "applied" }); } catch {}
        }
      }
      if (inv.enabled && inv.product_id && Number(inv.quantity) > 0) {
        const p = (productsQ.data ?? []).find((x: any) => x.id === inv.product_id);
        await api.stockMovements.create({
          clientId: userId,
          direction: "in",
          productId: inv.product_id,
          itemName: p?.name ?? "",
          sku: p?.sku ?? null,
          quantity: Number(inv.quantity),
          unit: inv.unit || "unit",
          unitCost: inv.unit_cost ? Number(inv.unit_cost) : null,
          purchaseInvoiceId: created?.id,
          movementDate: form.issue_date,
        });
      }
    },
    onSuccess: () => {
      onCreated();
      qc.invalidateQueries({ queryKey: ["proformas"] });
      toast.success(isEdit ? "Purchase invoice updated" : "Purchase invoice recorded");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card shadow-vault" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">{isEdit ? "Edit purchase invoice" : "New purchase invoice"}</h3>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-5 p-5">
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
            <p className="mt-1 text-[10px] text-muted-foreground">Enter the PO or proforma number to auto-deduct any advances paid against it.</p>
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
            {inv.enabled && (productsQ.data ?? []).length === 0 && (
              <div className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
                No products in the catalogue yet — create a product first in the{" "}
                <Link to="/app/products" className="underline">Product catalogue</Link> before tracking inventory.
              </div>
            )}
            {inv.enabled && (productsQ.data ?? []).length > 0 && (
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <L label="Product *">
                  <select className="inp" value={inv.product_id} onChange={(e) => {
                    const p = (productsQ.data ?? []).find((x: any) => x.id === e.target.value);
                    // Inventory value is cost-based: stock-in is valued at the product's unit COST,
                    // not its sale price. (Stock-out later subtracts quantity × unit cost.)
                    setInv({ ...inv, product_id: e.target.value, unit_cost: p ? String(p.unit_cost ?? "") : "" });
                  }}>
                    <option value="">Select product…</option>
                    {(productsQ.data ?? []).map((p: any) => (
                      <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ""}</option>
                    ))}
                  </select>
                </L>
                <L label="Quantity *"><input type="number" step="0.001" min="0" className="inp-qty" value={inv.quantity} onChange={(e) => setInv({ ...inv, quantity: e.target.value })} /></L>
                <L label="Unit"><input className="inp" value={inv.unit} onChange={(e) => setInv({ ...inv, unit: e.target.value })} /></L>
                <L label="Unit cost"><input type="number" step="0.01" min="0" className="inp" value={inv.unit_cost} onChange={(e) => setInv({ ...inv, unit_cost: e.target.value })} /></L>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
            <button disabled={save.isPending} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {isEdit ? "Save changes" : "Save"}
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}.inp-qty{width:100%;min-width:7rem;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.65rem .9rem;font-size:1.05rem;font-weight:600}.inp-qty:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>{children}</label>;
}

function PurchaseDetailModal({ invoice, onClose }: { invoice: any; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-vault" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="font-display text-lg">Purchase invoice {invoice.invoice_number}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 p-5 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <D label="Supplier" value={invoice.vendor?.name ?? "—"} />
            <D label="Status" value={<StatusPill status={invoice.status} />} />
            <D label="Amount" value={<span className="num">{fmtMoney(invoice.amount)}</span>} />
            <D label="Issue date" value={invoice.issue_date ? fmtDate(invoice.issue_date) : "—"} />
            <D label="Due date" value={invoice.due_date ? fmtDate(invoice.due_date) : "—"} />
            {invoice.paid_date && <D label="Paid date" value={fmtDate(invoice.paid_date)} />}
            {invoice.po_number && <D label="PO number" value={invoice.po_number} />}
            {invoice.po_amount != null && invoice.po_amount > 0 && <D label="PO amount" value={<span className="num">{fmtMoney(invoice.po_amount)}</span>} />}
            <div className="col-span-2"><D label="Notes" value={invoice.notes ?? "—"} /></div>
          </div>
          <div className="flex justify-end border-t border-border pt-3">
            <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Close</button>
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
