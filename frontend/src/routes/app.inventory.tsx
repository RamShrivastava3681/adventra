import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import { Plus, X, Loader2, ArrowDownToLine, ArrowUpFromLine, Trash2, Link2, ListPlus, FilePlus2 } from "lucide-react";
import { TableSkeleton } from "@/components/skeletons";
import { toast } from "sonner";

export const Route = createFileRoute("/app/inventory")({
  component: InventoryPage,
});

type Movement = {
  id: string;
  client_id: string;
  direction: "in" | "out";
  item_name: string;
  sku: string | null;
  quantity: number;
  unit: string;
  unit_cost: number | null;
  notes: string | null;
  invoice_id: string | null;
  purchase_invoice_id: string | null;
  movement_date: string;
  created_at: string;
};

function InventoryPage() {
  const { user, isAdmin, isClient, isChecker, isTreasury } = useAuth();
  const canWrite = isAdmin || (isClient && !isChecker && !isTreasury);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [startMode, setStartMode] = useState<"single" | "mass">("single");
  const [filter, setFilter] = useState<"all" | "in" | "out">("all");

  const movementsQ = useQuery({
    queryKey: ["stock_movements"],
    queryFn: async () => {
      const data = await api.stockMovements.list();
      return data.reverse();
    },
  });

  const rows = (movementsQ.data ?? []).filter((m: any) => filter === "all" || m.direction === filter);

  // Aggregate balances per item
  const balances = useMemo(() => {
    const m = new Map<string, { item: string; unit: string; qty: number; value: number }>();
    for (const r of (movementsQ.data ?? []) as Movement[]) {
      const k = `${r.item_name}|${r.unit}`;
      const sign = r.direction === "in" ? 1 : -1;
      const cur = m.get(k) ?? { item: r.item_name, unit: r.unit, qty: 0, value: 0 };
      cur.qty += sign * Number(r.quantity);
      cur.value += sign * Number(r.quantity) * Number(r.unit_cost ?? 0);
      m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => a.item.localeCompare(b.item));
  }, [movementsQ.data]);

  const del = useMutation({
    mutationFn: async (id: string) => {
      await api.stockMovements.delete(id);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["stock_movements"] }); toast.success("Removed"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div>
      <PageHeader
        eyebrow="Inventory"
        title="Stock ledger"
        description="Stock-in from purchase invoices (credit) and stock-out from sales invoices (debit). Not every transaction needs inventory."
        actions={
          canWrite ? (
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => { setStartMode("single"); setOpen(true); }} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                <Plus className="h-4 w-4" /> New movement
              </button>
              <button onClick={() => { setStartMode("mass"); setOpen(true); }} className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-4 py-2 text-sm font-medium text-primary transition hover:bg-primary/10">
                <ListPlus className="h-4 w-4" /> Bulk entry
              </button>
            </div>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Read-only</span>
          )
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        <Card title="Current balances">
          {balances.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">No items tracked yet.</div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Item</th>
                    <th className="px-5 py-2 text-right font-normal">In stock</th>
                    <th className="px-5 py-2 text-left font-normal">Unit</th>
                    <th className="px-5 py-2 text-right font-normal">Inventory value</th>
                  </tr>
                </thead>
                <tbody>
                  {balances.map((b) => (
                    <tr key={`${b.item}|${b.unit}`} className="border-b border-border/60">
                      <td className="px-5 py-2.5">{b.item}</td>
                      <td className={`px-5 py-2.5 text-right num ${b.qty < 0 ? "text-destructive" : ""}`}>{b.qty.toLocaleString()}</td>
                      <td className="px-5 py-2.5 text-muted-foreground">{b.unit}</td>
                      <td className="px-5 py-2.5 text-right num">{fmtMoney(b.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="flex flex-wrap gap-2">
          {(["all", "in", "out"] as const).map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              className={`rounded-full border px-3 py-1 text-xs uppercase tracking-widest transition ${
                filter === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}>{s === "in" ? "Stock-in" : s === "out" ? "Stock-out" : "All"}</button>
          ))}
        </div>

        <Card title="Movements">
          {movementsQ.isLoading ? (
            <TableSkeleton rows={5} cols={7} />
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No movements.</div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Date</th>
                    <th className="px-5 py-2 text-left font-normal">Direction</th>
                    <th className="px-5 py-2 text-left font-normal">Item</th>
                    <th className="px-5 py-2 text-right font-normal">Qty</th>
                    <th className="px-5 py-2 text-right font-normal">Unit cost</th>
                    <th className="px-5 py-2 text-left font-normal">Linked invoice</th>
                    <th className="px-5 py-2 text-right font-normal"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m: any) => (
                    <tr key={m.id} className="border-b border-border/60 hover:bg-muted/30">
                      <td className="px-5 py-3 text-muted-foreground">{fmtDate(m.movement_date)}</td>
                      <td className="px-5 py-3">
                        {m.direction === "in" ? (
                          <span className="inline-flex items-center gap-1 text-success"><ArrowDownToLine className="h-3.5 w-3.5" /> Credit</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-warning"><ArrowUpFromLine className="h-3.5 w-3.5" /> Debit</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <div>{m.item_name}</div>
                        {m.sku && <div className="text-[10px] text-muted-foreground">SKU {m.sku}</div>}
                      </td>
                      <td className="px-5 py-3 text-right num">{Number(m.quantity).toLocaleString()} <span className="text-[10px] text-muted-foreground">{m.unit}</span></td>
                      <td className="px-5 py-3 text-right num">{m.unit_cost != null ? fmtMoney(m.unit_cost) : "—"}</td>
                      <td className="px-5 py-3">
                        {m.invoice ? (
                          <Link to="/app/invoices" className="inline-flex items-center gap-1 text-xs text-primary hover:underline"><Link2 className="h-3 w-3" />{m.invoice.invoice_number}</Link>
                        ) : m.purchase ? (
                          <Link to="/app/purchases" className="inline-flex items-center gap-1 text-xs text-primary hover:underline"><Link2 className="h-3 w-3" />{m.purchase.invoice_number}</Link>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {canWrite && (
                          <button onClick={() => del.mutate(m.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {open && user && <NewMovementModal userId={user.id} onClose={() => setOpen(false)} initialMode={startMode} />}
    </div>
  );
}

function NewMovementModal({ userId, onClose, initialMode = "single" }: { userId: string; onClose: () => void; initialMode?: "single" | "mass" }) {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [mode, setMode] = useState<"single" | "mass">(initialMode);
  const [form, setForm] = useState({
    direction: "in" as "in" | "out",
    product_id: "",
    item_name: "",
    sku: "",
    quantity: "",
    unit: "unit",
    unit_cost: "",
    notes: "",
    invoice_id: "",
    purchase_invoice_id: "",
    movement_date: today,
  });
  const [entries, setEntries] = useState<{ quantity: string; movement_date: string; notes: string }[]>([
    { quantity: "", movement_date: today, notes: "" },
  ]);

  const invoicesQ = useQuery({
    queryKey: ["inv-mini"],
    queryFn: async () => {
      const data = await api.invoices.list();
      return data.map((i: any) => ({ id: i.id, invoice_number: i.invoiceNumber ?? i.invoice_number })).reverse();
    },
  });
  const purchQ = useQuery({
    queryKey: ["pi-mini"],
    queryFn: async () => {
      const data = await api.purchaseInvoices.list();
      return data.map((i: any) => ({ id: i.id, invoice_number: i.invoiceNumber ?? i.invoice_number })).reverse();
    },
  });
  const productsQ = useQuery({
    queryKey: ["products-mini"],
    queryFn: async () => {
      const data = await api.products.list();
      return data.map((p: any) => ({ id: p.id, sku: p.sku, name: p.name, unit_cost: p.unitCost ?? p.unit_cost, unit_price: p.unitPrice ?? p.unit_price })).sort((a: any, b: any) => a.sku?.localeCompare(b.sku ?? "") ?? 0);
    },
  });

  // Inventory value is cost-based: stock-in is valued at the product's unit COST
  // and stock-out subtracts quantity × unit cost (the sale price is irrelevant).
  const unitValueFor = (pid: string) => {
    const p = (productsQ.data ?? []).find((x: any) => x.id === pid) as any;
    if (!p) return "";
    return String(p.unit_cost ?? "");
  };

  // When a product is picked, auto-fill item_name, sku and unit cost
  const pickProduct = (pid: string) => {
    const p = (productsQ.data ?? []).find((x: any) => x.id === pid) as any;
    if (p) setForm((f) => ({ ...f, product_id: pid, item_name: p.name, sku: p.sku, unit_cost: f.unit_cost || unitValueFor(pid) }));
    else setForm((f) => ({ ...f, product_id: "" }));
  };

  // Changing direction keeps the cost basis (unit cost applies to both directions)
  const setDirection = (direction: "in" | "out") => {
    setForm((f) => {
      const unit_cost = f.product_id ? unitValueFor(f.product_id) : f.unit_cost;
      return { ...f, direction, unit_cost };
    });
  };

  // ---- Bulk entry helpers ----
  const addEntry = () => setEntries((es) => [...es, { quantity: "", movement_date: today, notes: "" }]);
  const removeEntry = (i: number) => setEntries((es) => (es.length > 1 ? es.filter((_, idx) => idx !== i) : es));
  const updateEntry = (i: number, patch: Partial<{ quantity: string; movement_date: string; notes: string }>) =>
    setEntries((es) => es.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));

  // Shared fields (item name, sku, unit, unit cost) stay constant across all rows
  const payload = (quantity: number, movement_date: string, notes: string | null) => ({
    clientId: userId,
    product_id: form.product_id || null,
    direction: form.direction,
    item_name: form.item_name.trim(),
    sku: form.sku || null,
    quantity,
    unit: form.unit || "unit",
    unit_cost: form.unit_cost ? Number(form.unit_cost) : null,
    notes: notes?.trim() || form.notes || null,
    invoice_id: form.direction === "out" && form.invoice_id ? form.invoice_id : null,
    purchase_invoice_id: form.direction === "in" && form.purchase_invoice_id ? form.purchase_invoice_id : null,
    movement_date,
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!form.item_name.trim()) throw new Error("Item name required");
      if (!form.quantity || Number(form.quantity) <= 0) throw new Error("Quantity must be > 0");
      await api.stockMovements.create(payload(Number(form.quantity), form.movement_date, form.notes || null));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["stock_movements"] }); qc.invalidateQueries({ queryKey: ["stock_movements_all"] }); toast.success("Movement recorded"); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const createAll = useMutation({
    mutationFn: async () => {
      if (!form.item_name.trim()) throw new Error("Item name required");
      const valid = entries.filter((e) => e.quantity && Number(e.quantity) > 0);
      if (valid.length === 0) throw new Error("Add at least one entry with quantity > 0");
      for (const e of valid) {
        await api.stockMovements.create(payload(Number(e.quantity), e.movement_date, e.notes || null));
      }
      return valid.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ["stock_movements"] });
      qc.invalidateQueries({ queryKey: ["stock_movements_all"] });
      toast.success(`${count} movement${count > 1 ? "s" : ""} recorded`);
      onClose();
    },
    onError: (e) => {
      // Some entries may already be saved — refresh so partial records show up
      qc.invalidateQueries({ queryKey: ["stock_movements"] });
      qc.invalidateQueries({ queryKey: ["stock_movements_all"] });
      toast.error(e instanceof Error ? e.message : "Failed");
    },
  });

  const submitting = create.isPending || createAll.isPending;
  const totalQty = entries.reduce((s, e) => s + (Number(e.quantity) || 0), 0);
  const validCount = entries.filter((e) => e.quantity && Number(e.quantity) > 0).length;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-border bg-card" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">{mode === "mass" ? "Bulk stock entries" : "New stock movement"}</h3>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); if (mode === "mass") createAll.mutate(); else create.mutate(); }} className="space-y-4 p-5">
          {/* Entry mode toggle */}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" aria-pressed={mode === "single"} onClick={() => setMode("single")} className={`rounded-md border px-3 py-2 text-sm transition ${mode === "single" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
              <FilePlus2 className="mr-2 inline h-4 w-4" /> Single entry
            </button>
            <button type="button" aria-pressed={mode === "mass"} onClick={() => setMode("mass")} className={`rounded-md border px-3 py-2 text-sm transition ${mode === "mass" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
              <ListPlus className="mr-2 inline h-4 w-4" /> Bulk entry
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setDirection("in")} className={`rounded-md border px-3 py-2 text-sm ${form.direction === "in" ? "border-success bg-success/10 text-success" : "border-border"}`}>
              <ArrowDownToLine className="mr-2 inline h-4 w-4" /> Stock-in (purchase)
            </button>
            <button type="button" onClick={() => setDirection("out")} className={`rounded-md border px-3 py-2 text-sm ${form.direction === "out" ? "border-warning bg-warning/10 text-warning" : "border-border"}`}>
              <ArrowUpFromLine className="mr-2 inline h-4 w-4" /> Stock-out (sale)
            </button>
          </div>
          <L label="Catalog product (optional — links to forecast)">
            <select className="inp" value={form.product_id} onChange={(e) => pickProduct(e.target.value)}>
              <option value="">— Ad-hoc item —</option>
              {(productsQ.data ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
            </select>
          </L>
          <div className="grid grid-cols-2 gap-3">
            <L label="Item name *"><input required className="inp" value={form.item_name} onChange={(e) => setForm({ ...form, item_name: e.target.value })} /></L>
            <L label="SKU"><input className="inp" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></L>
            <L label="Unit"><input className="inp" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="kg / box / unit" /></L>
            <L label="Unit cost"><input type="number" step="0.01" min="0" className="inp" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} /></L>
          </div>
          {form.direction === "in" ? (
            <L label="Link to purchase invoice (optional)">
              <select className="inp" value={form.purchase_invoice_id} onChange={(e) => setForm({ ...form, purchase_invoice_id: e.target.value })}>
                <option value="">— None —</option>
                {(purchQ.data ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.invoice_number}</option>)}
              </select>
            </L>
          ) : (
            <L label="Link to sales invoice (optional)">
              <select className="inp" value={form.invoice_id} onChange={(e) => setForm({ ...form, invoice_id: e.target.value })}>
                <option value="">— None —</option>
                {(invoicesQ.data ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.invoice_number}</option>)}
              </select>
            </L>
          )}

          {mode === "single" ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <L label="Quantity *"><input required type="number" step="0.001" min="0" className="inp" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></L>
                <L label="Date"><input required type="date" className="inp" value={form.movement_date} onChange={(e) => setForm({ ...form, movement_date: e.target.value })} /></L>
              </div>
              <L label="Notes"><textarea rows={2} className="inp" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></L>
            </>
          ) : (
            <>
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs uppercase tracking-widest text-muted-foreground">Entries — qty & date per row</span>
                  <span className="text-[10px] text-muted-foreground">{entries.length} row{entries.length === 1 ? "" : "s"} · {totalQty.toLocaleString()} total qty</span>
                </div>
                <div className="space-y-2">
                  {entries.map((e, i) => (
                    <div key={i} className="grid grid-cols-2 items-end gap-2 rounded-lg border border-border/70 bg-muted/30 p-2.5 sm:grid-cols-[84px_1fr_1fr_auto]">
                      <L label="Qty *"><input type="number" step="0.001" min="0" className="inp" value={e.quantity} onChange={(ev) => updateEntry(i, { quantity: ev.target.value })} /></L>
                      <L label="Date *"><input type="date" className="inp" value={e.movement_date} onChange={(ev) => updateEntry(i, { movement_date: ev.target.value })} /></L>
                      <L label="Notes"><input className="inp" placeholder="per-entry note (optional)" value={e.notes} onChange={(ev) => updateEntry(i, { notes: ev.target.value })} /></L>
                      <button type="button" onClick={() => removeEntry(i)} title="Remove entry" className="mb-1 rounded-md p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={addEntry} className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-3 py-2 text-xs font-medium text-muted-foreground transition hover:border-primary hover:text-primary">
                  <Plus className="h-3.5 w-3.5" /> Add another entry
                </button>
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
            <button disabled={submitting} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === "mass" && validCount > 0 ? `Save ${validCount} entr${validCount === 1 ? "y" : "ies"}` : "Save"}
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
