import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, EmptyState, fmtDate } from "@/components/ledger-ui";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { TableSkeleton } from "@/components/skeletons";
import { Gift, Plus, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/sample-distribution")({
  component: SampleDistributionPage,
});

type CatalogueProduct = {
  id: string;
  sku: string | null;
  name: string;
  unit_of_measure?: string;
  unitOfMeasure?: string;
  unit_cost?: number | null;
  unitCost?: number | null;
  status?: string;
};

type SampleMovement = {
  id: string;
  movement_number: string;
  product_id: string | null;
  direction: "in" | "out";
  item_name: string;
  sku: string | null;
  quantity: number;
  unit: string;
  unit_cost: number | null;
  reason: string | null;
  linked_document_type: string | null;
  customer_name: string | null;
  status: string;
  movement_date: string;
  notes: string | null;
  created_by_name: string | null;
  created_at: string;
};

function isSample(m: any): boolean {
  return (
    m.reason === "Samples / internal use" ||
    m.linked_document_type === "Sample"
  );
}

function salesmanLabel(u: any): string {
  return (
    u.contact_name ??
    u.contactName ??
    u.company_name ??
    u.companyName ??
    u.email ??
    "Salesman"
  );
}

function SampleDistributionPage() {
  const { user, isAdmin, isOperations } = useAuth();
  const canWrite = isAdmin || isOperations;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const productsQ = useQuery({
    queryKey: ["products-samples"],
    queryFn: async () => {
      const data = (await api.products.list()) as CatalogueProduct[];
      return data
        .filter((p) => !p.status || p.status === "active")
        .sort((a, b) => (a.sku ?? "").localeCompare(b.sku ?? "") || a.name.localeCompare(b.name));
    },
  });

  // Sample issue log — only sample debits are recorded here.
  const samplesQ = useQuery({
    queryKey: ["stock_movements_samples"],
    queryFn: async () => {
      const data = (await api.stockMovements.list()) as SampleMovement[];
      return data.filter(isSample).reverse();
    },
  });

  // Live balances (confirmed credits − confirmed debits) for availability check.
  const balancesQ = useQuery({
    queryKey: ["stock_movements"],
    queryFn: async () => api.stockMovements.list(),
  });

  // Salesman roster — admin-only endpoint; operations users type the name manually.
  const salesmenQ = useQuery({
    queryKey: ["salesmen"],
    queryFn: async () => {
      const data = await api.admin.users();
      return (data as any[]).filter((u) => (u.roles ?? []).includes("sales_rep"));
    },
    enabled: isAdmin,
    retry: false,
  });

  const balances = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of (balancesQ.data ?? []) as any[]) {
      if (r.status !== "confirmed") continue;
      const key = r.product_id ?? r.sku ?? r.item_name;
      const sign = r.direction === "in" ? 1 : -1;
      m.set(key, (m.get(key) ?? 0) + sign * Number(r.quantity));
    }
    return m;
  }, [balancesQ.data]);

  const totalQty = (samplesQ.data ?? [])
    .filter((s) => s.status === "confirmed")
    .reduce((sum, s) => sum + Number(s.quantity), 0);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["stock_movements"] });
    qc.invalidateQueries({ queryKey: ["stock_movements_samples"] });
    qc.invalidateQueries({ queryKey: ["stock_movements_all"] });
    qc.invalidateQueries({ queryKey: ["stock-summary"] });
    qc.invalidateQueries({ queryKey: ["movements-forecast"] });
    qc.invalidateQueries({ queryKey: ["forecast-variables"] });
  };

  return (
    <div>
      <PageHeader
        eyebrow="Warehouse Control"
        title="Sample Distribution"
        description="Issue sample products to salesmen. Each issue creates a confirmed debit entry in stock and is recorded in this log."
        icon={<Gift className="h-5 w-5" />}
        actions={
          canWrite ? (
            <button
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" /> Issue sample
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
              Read-only
            </span>
          )
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Sample units issued
            </div>
            <div className="num mt-1 text-2xl">{totalQty.toLocaleString()}</div>
          </Card>
          <Card>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Issue entries
            </div>
            <div className="num mt-1 text-2xl">{(samplesQ.data ?? []).length}</div>
          </Card>
          <Card>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Salesmen served
            </div>
            <div className="num mt-1 text-2xl">
              {new Set((samplesQ.data ?? []).map((s) => s.customer_name ?? "—")).size}
            </div>
          </Card>
        </div>

        <Card title="Sample issue log">
          {samplesQ.isLoading ? (
            <TableSkeleton rows={5} cols={6} />
          ) : (samplesQ.data ?? []).length === 0 ? (
            <EmptyState
              icon={<Gift className="h-5 w-5" />}
              title="No samples issued yet"
              description="Use “Issue sample” to give a sample product to a salesman — stock is debited immediately."
            />
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Date</th>
                    <th className="px-5 py-2 text-left font-normal">SKU / Product</th>
                    <th className="px-5 py-2 text-right font-normal">Qty</th>
                    <th className="px-5 py-2 text-left font-normal">Salesman</th>
                    <th className="px-5 py-2 text-left font-normal">Issued by</th>
                    <th className="px-5 py-2 text-left font-normal">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {(samplesQ.data ?? []).map((s) => (
                    <tr key={s.id} className="border-b border-border/60 hover:bg-muted/30">
                      <td className="px-5 py-3 text-muted-foreground">{fmtDate(s.movement_date)}</td>
                      <td className="px-5 py-3">
                        <div>{s.item_name}</div>
                        {s.sku && (
                          <div className="font-mono text-[10px] text-muted-foreground">{s.sku}</div>
                        )}
                      </td>
                      <td className="num px-5 py-3 text-right">
                        {Number(s.quantity).toLocaleString()}{" "}
                        <span className="text-[10px] text-muted-foreground">{s.unit}</span>
                      </td>
                      <td className="px-5 py-3">{s.customer_name ?? "—"}</td>
                      <td className="px-5 py-3 text-muted-foreground">{s.created_by_name ?? "—"}</td>
                      <td className="px-5 py-3 text-muted-foreground">{s.notes ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {open && user && (
        <IssueSampleModal
          userId={user.id}
          products={(productsQ.data ?? []) as CatalogueProduct[]}
          balances={balances}
          salesmen={(salesmenQ.data ?? []) as any[]}
          salesmenFailed={salesmenQ.isError}
          onClose={() => setOpen(false)}
          onIssued={() => {
            invalidate();
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function IssueSampleModal({
  userId,
  products,
  balances,
  salesmen,
  salesmenFailed,
  onClose,
  onIssued,
}: {
  userId: string;
  products: CatalogueProduct[];
  balances: Map<string, number>;
  salesmen: any[];
  salesmenFailed: boolean;
  onClose: () => void;
  onIssued: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    productId: "",
    quantity: "1",
    salesman: "",
    salesmanName: "",
    movementDate: today,
    notes: "",
  });

  const selected = products.find((p) => p.id === form.productId);
  const available = selected
    ? (balances.get(selected.id) ?? balances.get(selected.sku ?? "") ?? 0)
    : 0;

  const issue = useMutation({
    mutationFn: async () => {
      if (!form.productId || !selected) throw new Error("Select a product (SKU) from the catalogue");
      const qty = Number(form.quantity);
      if (!(qty > 0)) throw new Error("Quantity must be greater than zero");
      if (qty > available)
        throw new Error(`Only ${available.toLocaleString()} units in stock — cannot issue ${qty.toLocaleString()}`);
      const useRoster = salesmen.length > 0 && !salesmenFailed;
      const salesmanName = useRoster
        ? (salesmen.find((u) => u.id === form.salesman)
            ? salesmanLabel(salesmen.find((u) => u.id === form.salesman))
            : "")
        : form.salesmanName.trim();
      if (!salesmanName) throw new Error("Select a salesman");
      await api.stockMovements.create({
        product_id: selected.id,
        direction: "out",
        quantity: qty,
        unit_cost: selected.unitCost ?? selected.unit_cost ?? 0,
        reason: "Samples / internal use",
        linked_document_type: "Sample",
        customer_name: salesmanName,
        notes: form.notes.trim() || `Sample issued to ${salesmanName}`,
        movement_date: form.movementDate,
        status: "confirmed",
        clientId: userId,
      });
    },
    onSuccess: () => {
      toast.success("Sample issued — stock debited");
      onIssued();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">Issue sample</h3>
          <button onClick={onClose} className="text-muted-foreground transition hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            issue.mutate();
          }}
          className="space-y-4 p-5"
        >
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Product (SKU · name) *
            </label>
            <SearchableSelect
              value={form.productId}
              onChange={(v) => setForm({ ...form, productId: v })}
              placeholder="— Select product —"
              options={products.map((p) => ({
                value: p.id,
                label: p.sku ? `${p.sku} · ${p.name}` : p.name,
              }))}
            />
            {selected && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Available in stock:{" "}
                <span className={`num font-medium ${available <= 0 ? "text-destructive" : ""}`}>
                  {available.toLocaleString()}
                </span>
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Quantity *
              </label>
              <input
                required
                type="number"
                step="1"
                min="1"
                className="inp"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Date *</label>
              <input
                required
                type="date"
                className="inp"
                value={form.movementDate}
                onChange={(e) => setForm({ ...form, movementDate: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Salesman *
            </label>
            {salesmen.length > 0 && !salesmenFailed ? (
              <SearchableSelect
                value={form.salesman}
                onChange={(v) => setForm({ ...form, salesman: v })}
                placeholder="— Select salesman —"
                options={salesmen.map((u) => ({
                  value: u.id,
                  label: salesmanLabel(u),
                  hint: u.email,
                }))}
              />
            ) : (
              <input
                required
                className="inp"
                value={form.salesmanName}
                onChange={(e) => setForm({ ...form, salesmanName: e.target.value })}
                placeholder="Salesman name"
              />
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Notes (purpose, campaign…)
            </label>
            <textarea
              rows={2}
              className="inp"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="e.g. Diwali sampling drive"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm transition hover:bg-muted/40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={issue.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
            >
              {issue.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Issue & debit stock
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
