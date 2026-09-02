import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ProductThumb } from "@/components/product-thumb";
import {
  Plus,
  X,
  Loader2,
  ArrowDownToLine,
  ArrowUpFromLine,
  Trash2,
  ScanBarcode,
  Check,
  Ban,
  Package,
  Pencil,
  Boxes,
  Upload,
  FileSpreadsheet,
  AlertTriangle,
} from "lucide-react";
import { TableSkeleton } from "@/components/skeletons";
import { toast } from "sonner";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/app/inventory")({
  component: InventoryPage,
});

type Movement = {
  id: string;
  movement_number: string;
  product_id: string | null;
  direction: "in" | "out";
  item_name: string;
  sku: string | null;
  quantity: number;
  unit: string;
  unit_cost: number | null;
  warehouse: string | null;
  reason: string | null;
  linked_document_type: string | null;
  linked_document_number: string | null;
  status: "draft" | "confirmed" | "cancelled";
  created_by_id: string | null;
  created_by_name: string | null;
  confirmed_by_id: string | null;
  confirmed_by_name: string | null;
  confirmed_at: string | null;
  notes: string | null;
  movement_date: string;
  invoice_id: string | null;
  purchase_invoice_id: string | null;
  goods_receipt_id: string | null;
  goods_dispatch_id: string | null;
  purchase_order_id: string | null;
  created_at: string;
};

// Reasons a user may pick on a MANUAL entry. Goods receipt & Dispatch are
// system-generated (confirmed GRNs / dispatched invoices).
const MANUAL_REASONS: { label: string; direction: "in" | "out"; docType: string }[] = [
  { label: "Opening stock", direction: "in", docType: "Adjustment" },
  { label: "Stock adjustment", direction: "in", docType: "Adjustment" },
  { label: "Damage", direction: "out", docType: "Adjustment" },
  { label: "Samples / internal use", direction: "out", docType: "Adjustment" },
  { label: "Customer return", direction: "in", docType: "Return" },
  { label: "Supplier return", direction: "out", docType: "Return" },
];

const LINKED_DOC_TYPES = [
  "GRN",
  "Dispatch",
  "PO",
  "Purchase Invoice",
  "Sales Invoice",
  "Return",
  "Adjustment",
];

function invalidateStock(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["stock_movements"] });
  qc.invalidateQueries({ queryKey: ["stock_movements_all"] });
  qc.invalidateQueries({ queryKey: ["movements-forecast"] });
  qc.invalidateQueries({ queryKey: ["forecast-variables"] });
  qc.invalidateQueries({ queryKey: ["products-forecast"] });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: "Draft", cls: "border-warning/40 bg-warning/10 text-warning" },
    confirmed: { label: "Confirmed", cls: "border-success/40 bg-success/10 text-success" },
    cancelled: { label: "Cancelled", cls: "border-border bg-muted/40 text-muted-foreground" },
  };
  const s = map[status] ?? { label: status, cls: "border-border text-muted-foreground" };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

function DirBadge({ direction }: { direction: "in" | "out" }) {
  return direction === "in" ? (
    <span className="inline-flex items-center gap-1 text-success">
      <ArrowDownToLine className="h-3.5 w-3.5" /> Credit
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-warning">
      <ArrowUpFromLine className="h-3.5 w-3.5" /> Debit
    </span>
  );
}

function InventoryPage() {
  const { user, isAdmin, isClient, isChecker, isTreasury } = useAuth();
  const canWrite = isAdmin || (isClient && !isChecker && !isTreasury);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [dirFilter, setDirFilter] = useState<"all" | "in" | "out">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "confirmed" | "cancelled">(
    "all",
  );
  const [pendingAction, setPendingAction] = useState<{
    kind: "cancel" | "delete";
    movement: Movement;
  } | null>(null);
  const [editing, setEditing] = useState<Movement | null>(null);

  const movementsQ = useQuery({
    queryKey: ["stock_movements"],
    queryFn: async () => {
      const data = await api.stockMovements.list();
      return data.reverse();
    },
  });

  // Product images — joined onto movement rows via product_id so the catalogue
  // thumbnails show up next to each item. Keyed separately from the modal's
  // "products-mini" query so the two shapes never collide.
  const productsQ = useQuery({
    queryKey: ["products-inventory"],
    queryFn: async () => {
      const data = await api.products.list();
      return data.map((p: any) => ({
        id: p.id,
        image_url: p.imageUrl ?? p.image_url ?? null,
      }));
    },
  });

  const productImages = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of productsQ.data ?? []) {
      if (p.image_url) m.set(p.id, p.image_url);
    }
    return m;
  }, [productsQ.data]);

  // Location-wise stock summary
  const stockSummaryQ = useQuery({
    queryKey: ["stock-summary"],
    queryFn: async () => api.stockSummary.list(),
  });
  const [showLocationBreakdown, setShowLocationBreakdown] = useState(false);

  const rows = (movementsQ.data ?? []).filter(
    (m: Movement) =>
      (dirFilter === "all" || m.direction === dirFilter) &&
      (statusFilter === "all" || m.status === statusFilter) &&
      m.sku !== "EH-500",
  );

  // Live balances — confirmed credits − confirmed debits ONLY (drafts never move stock)
  const balances = useMemo(() => {
    const m = new Map<
      string,
      {
        item: string;
        unit: string;
        sku: string | null;
        productId: string | null;
        qty: number;
        value: number;
      }
    >();
    for (const r of (movementsQ.data ?? []) as Movement[]) {
      if (r.status !== "confirmed") continue;
      if (r.sku === "EH-500") continue;
      const key = r.sku ?? r.product_id ?? `${r.item_name}|${r.unit}`;
      const sign = r.direction === "in" ? 1 : -1;
      const cur = m.get(key) ?? {
        item: r.item_name,
        unit: r.unit,
        sku: r.sku,
        productId: r.product_id,
        qty: 0,
        value: 0,
      };
      cur.qty += sign * Number(r.quantity);
      cur.value += sign * Number(r.quantity) * Number(r.unit_cost ?? 0);
      m.set(key, cur);
    }
    return [...m.values()].sort((a, b) => a.item.localeCompare(b.item));
  }, [movementsQ.data]);

  const monthlySalesBreakdown = useMemo(() => {
    const monthKeys: string[] = [];
    const d = new Date();
    for (let i = 11; i >= 0; i--) {
      const month = new Date(d.getFullYear(), d.getMonth() - i, 1);
      monthKeys.push(`${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`);
    }

    const bySku = new Map<
      string,
      {
        item: string;
        sku: string | null;
        productId: string | null;
        totalStock: number;
        monthly: Record<string, number>;
      }
    >();

    for (const r of (movementsQ.data ?? []) as Movement[]) {
      if (r.status !== "confirmed") continue;
      const key = r.product_id ?? r.sku ?? `${r.item_name}|${r.unit}`;
      const row = bySku.get(key) ?? {
        item: r.item_name,
        sku: r.sku,
        productId: r.product_id,
        totalStock: 0,
        monthly: {},
      };
      const sign = r.direction === "in" ? 1 : -1;
      row.totalStock += sign * Number(r.quantity);
      const monthKey = (r.movement_date ?? "").slice(0, 7);
      if (monthKey && monthKeys.includes(monthKey)) {
        row.monthly[monthKey] = (row.monthly[monthKey] ?? 0) + (r.direction === "out" ? Number(r.quantity) : 0);
      }
      bySku.set(key, row);
    }

    return {
      monthKeys,
      rows: [...bySku.values()].sort((a, b) => (a.item || "").localeCompare(b.item || "")),
    };
  }, [movementsQ.data]);

  const confirmMut = useMutation({
    mutationFn: async (id: string) => api.stockMovements.confirm(id),
    onSuccess: () => {
      invalidateStock(qc);
      toast.success("Movement confirmed — stock updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const actMut = useMutation({
    mutationFn: async ({ kind, id }: { kind: "cancel" | "delete"; id: string }) => {
      if (kind === "cancel") await api.stockMovements.cancel(id);
      else await api.stockMovements.delete(id);
    },
    onSuccess: (_d, vars) => {
      invalidateStock(qc);
      toast.success(vars.kind === "cancel" ? "Movement cancelled" : "Movement deleted");
      setPendingAction(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div>
      <PageHeader
        eyebrow="Inventory"
        title="Inventory"
        description="Live stock is confirmed credit entries minus confirmed debit entries. Goods receipts credit stock automatically and dispatched invoices debit it; manual entries (opening stock, adjustments, damage, samples, returns) start as drafts and confirm when verified."
        icon={<Boxes className="h-5 w-5" />}
        actions={
          canWrite ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setBulkOpen(true)}
                className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium transition hover:bg-muted/40"
              >
                <FileSpreadsheet className="h-4 w-4" /> Bulk import
              </button>
              <button
                onClick={() => setOpen(true)}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" /> New movement
              </button>
            </div>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
              Read-only
            </span>
          )
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        {/* Location-wise Stock Breakdown */}
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-display text-sm font-medium">Location-wise Stock Breakdown</h3>
              <p className="text-[10px] text-muted-foreground">
                Stock by location. Total Company Stock = sum of all locations.
              </p>
            </div>
            <button
              onClick={() => setShowLocationBreakdown(!showLocationBreakdown)}
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary hover:text-primary"
            >
              {showLocationBreakdown ? "Hide" : "Show"} breakdown
            </button>
          </div>
          {showLocationBreakdown && (
            <div className="mt-4">
              {(stockSummaryQ.data ?? []).length === 0 ? (
                <div className="py-4 text-center text-xs text-muted-foreground">
                  No stock data. Create stock locations and record GRNs to see the breakdown.
                </div>
              ) : (
                <div className="space-y-3">
                  {(stockSummaryQ.data ?? []).map((summary: any) => (
                    <div key={summary.product_id} className="rounded-md border border-border/50 p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-xs font-medium">{summary.name}</div>
                          <div className="text-[10px] text-muted-foreground">{summary.sku ?? "—"}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-bold num">{(summary.total_company_stock ?? 0).toLocaleString()}</div>
                          <div className="text-[10px] text-muted-foreground">Total</div>
                        </div>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-1 md:grid-cols-3 lg:grid-cols-4">
                        {(summary.location_breakdown ?? []).map((lb: any) => (
                          <div key={lb.location_id} className="flex items-center justify-between rounded bg-muted/30 px-2 py-1 text-[10px]">
                            <span className="text-muted-foreground">{lb.location_name}</span>
                            <span className={`num ${lb.quantity < 0 ? "text-destructive" : ""}`}>{lb.quantity.toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>

        <Card title="Stock Breakdown">
          <p className="-mt-2 mb-4 text-xs text-muted-foreground">
            Monthly sales per SKU over the last 12 months.
          </p>
          {monthlySalesBreakdown.rows.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No SKU sales yet — confirm debits to see the monthly sales breakdown.
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Item</th>
                    <th className="px-5 py-2 text-left font-normal">SKU</th>
                    <th className="px-5 py-2 text-right font-normal">Stock</th>
                    {monthlySalesBreakdown.monthKeys.map((monthKey) => (
                      <th key={monthKey} className="px-2 py-2 text-right font-normal">
                        {new Date(`${monthKey}-01T00:00:00`).toLocaleDateString("en-US", {
                          month: "short",
                          year: "2-digit",
                        })}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {monthlySalesBreakdown.rows.map((row) => (
                    <tr key={`${row.productId ?? row.sku ?? row.item}`} className="border-b border-border/60">
                      <td className="px-5 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <ProductThumb
                            imageUrl={row.productId ? productImages.get(row.productId) : null}
                            name={row.item}
                            size="sm"
                            rounded="md"
                          />
                          <span>{row.item}</span>
                        </div>
                      </td>
                      <td className="px-5 py-2.5 text-muted-foreground">{row.sku ?? "—"}</td>
                      <td className="px-5 py-2.5 text-right num">{row.totalStock.toLocaleString()}</td>
                      {monthlySalesBreakdown.monthKeys.map((monthKey) => (
                        <td key={`${row.productId ?? row.sku ?? row.item}-${monthKey}`} className="px-2 py-2 text-right num">
                          {Number(row.monthly[monthKey] ?? 0).toLocaleString()}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Live stock">
          <p className="-mt-2 mb-4 text-xs text-muted-foreground">
            Confirmed credits − confirmed debits per SKU.
          </p>
          {balances.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No stock yet — confirm a goods receipt or record an opening stock entry.
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Item</th>
                    <th className="px-5 py-2 text-left font-normal">SKU</th>
                    <th className="px-5 py-2 text-right font-normal">In stock</th>
                    <th className="px-5 py-2 text-left font-normal">Unit</th>
                    <th className="px-5 py-2 text-right font-normal">Inventory value</th>
                  </tr>
                </thead>
                <tbody>
                  {balances.map((b) => (
                    <tr key={`${b.sku ?? b.item}`} className="border-b border-border/60">
                      <td className="px-5 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <ProductThumb
                            imageUrl={b.productId ? productImages.get(b.productId) : null}
                            name={b.item}
                            size="sm"
                            rounded="md"
                          />
                          <span>{b.item}</span>
                        </div>
                      </td>
                      <td className="px-5 py-2.5 text-muted-foreground">{b.sku ?? "—"}</td>
                      <td
                        className={`px-5 py-2.5 text-right num ${b.qty < 0 ? "text-destructive" : ""}`}
                      >
                        {b.qty.toLocaleString()}
                      </td>
                      <td className="px-5 py-2.5 text-muted-foreground">{b.unit}</td>
                      <td className="px-5 py-2.5 text-right num">{fmtMoney(b.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[10px] uppercase tracking-widest text-muted-foreground">
              Direction
            </span>
            {(["all", "in", "out"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setDirFilter(s)}
                className={`rounded-full border px-3 py-1 text-xs uppercase tracking-widest transition ${
                  dirFilter === s
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {s === "in" ? "Credit" : s === "out" ? "Debit" : "All"}
              </button>
            ))}
          </div>
          <span className="h-4 w-px bg-border" />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[10px] uppercase tracking-widest text-muted-foreground">
              Status
            </span>
            {(["all", "draft", "confirmed", "cancelled"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-full border px-3 py-1 text-xs uppercase tracking-widest transition ${
                  statusFilter === s
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {s === "all" ? "All" : s}
              </button>
            ))}
          </div>
        </div>

        <Card title="Movements">
          {movementsQ.isLoading ? (
            <TableSkeleton rows={5} cols={8} />
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No movements match the filters.
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Movement no.</th>
                    <th className="px-5 py-2 text-left font-normal">Date</th>
                    <th className="px-5 py-2 text-left font-normal">Direction</th>
                    <th className="px-5 py-2 text-left font-normal">Item</th>
                    <th className="px-5 py-2 text-right font-normal">Qty</th>
                    <th className="px-5 py-2 text-right font-normal">Unit cost</th>
                    <th className="px-5 py-2 text-right font-normal">Total</th>
                    <th className="px-5 py-2 text-left font-normal">Reason</th>
                    <th className="px-5 py-2 text-left font-normal">Warehouse</th>
                    <th className="px-5 py-2 text-left font-normal">Linked doc</th>
                    <th className="px-5 py-2 text-left font-normal">Status</th>
                    <th className="px-5 py-2 text-right font-normal"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m: Movement) => (
                    <tr key={m.id} className="border-b border-border/60 hover:bg-muted/30">
                      <td className="px-5 py-3">
                        <div className="font-mono text-xs">{m.movement_number}</div>
                        {m.created_by_name && (
                          <div className="text-[10px] text-muted-foreground">
                            by {m.created_by_name}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {fmtDate(m.movement_date)}
                      </td>
                      <td className="px-5 py-3">
                        <DirBadge direction={m.direction} />
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <ProductThumb
                            imageUrl={m.product_id ? productImages.get(m.product_id) : null}
                            name={m.item_name}
                            rounded="md"
                          />
                          <div>
                            <div>{m.item_name}</div>
                            {m.sku && (
                              <div className="text-[10px] text-muted-foreground">SKU {m.sku}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right num">
                        {Number(m.quantity).toLocaleString()}{" "}
                        <span className="text-[10px] text-muted-foreground">{m.unit}</span>
                      </td>
                      <td className="px-5 py-3 text-right num">
                        {m.unit_cost != null ? fmtMoney(m.unit_cost) : "—"}
                      </td>
                      <td className="px-5 py-3 text-right num">
                        {fmtMoney(Number(m.quantity) * Number(m.unit_cost ?? 0))}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{m.reason ?? "—"}</td>
                      <td className="px-5 py-3 text-muted-foreground">{m.warehouse ?? "—"}</td>
                      <td className="px-5 py-3">
                        {m.linked_document_type ? (
                          <div>
                            <div className="text-xs">{m.linked_document_type}</div>
                            {m.linked_document_number && (
                              <div className="text-[10px] text-muted-foreground">
                                {m.linked_document_number}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={m.status} />
                        {m.status === "confirmed" && m.confirmed_by_name && (
                          <div className="mt-0.5 text-[10px] text-muted-foreground">
                            by {m.confirmed_by_name}
                          </div>
                        )}
                      </td>{" "}
                      <td className="px-5 py-3 text-right">
                        {canWrite && (
                          <div className="flex justify-end gap-0.5">
                            {/* Movements created by a source document (GRN / invoice) are managed there */}
                            {!m.goods_receipt_id &&
                              !m.invoice_id &&
                              !m.purchase_invoice_id &&
                              !m.goods_dispatch_id && (
                                <>
                                  {m.status !== "cancelled" && (
                                    <button
                                      onClick={() => setEditing(m)}
                                      title="Edit movement"
                                      className="rounded-md p-1.5 text-muted-foreground transition hover:bg-primary/10 hover:text-primary"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                  {m.status === "draft" && (
                                    <button
                                      onClick={() => confirmMut.mutate(m.id)}
                                      title="Confirm movement"
                                      className="rounded-md p-1.5 text-muted-foreground transition hover:bg-success/10 hover:text-success"
                                    >
                                      <Check className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                  {m.status !== "cancelled" && (
                                    <button
                                      onClick={() =>
                                        setPendingAction({ kind: "cancel", movement: m })
                                      }
                                      title="Cancel movement"
                                      className="rounded-md p-1.5 text-muted-foreground transition hover:bg-warning/10 hover:text-warning"
                                    >
                                      <Ban className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                  {m.status !== "confirmed" && (
                                    <button
                                      onClick={() =>
                                        setPendingAction({ kind: "delete", movement: m })
                                      }
                                      title="Delete"
                                      className="rounded-md p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </>
                              )}
                          </div>
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

      {open && user && <MovementModal userId={user.id} onClose={() => setOpen(false)} />}
      {bulkOpen && user && <BulkImportModal userId={user.id} onClose={() => setBulkOpen(false)} />}
      {editing && user && (
        <MovementModal userId={user.id} movement={editing} onClose={() => setEditing(null)} />
      )}
      {pendingAction && (
        <ConfirmAction
          action={pendingAction}
          onClose={() => setPendingAction(null)}
          onSubmit={(kind) => actMut.mutate({ kind, id: pendingAction.movement.id })}
          pending={actMut.isPending}
        />
      )}
    </div>
  );
}

function ConfirmAction({
  action,
  onClose,
  onSubmit,
  pending,
}: {
  action: { kind: "cancel" | "delete"; movement: Movement };
  onClose: () => void;
  onSubmit: (kind: "cancel" | "delete") => void;
  pending: boolean;
}) {
  const isConfirmed = action.movement.status === "confirmed";
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-card p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-lg">
          {action.kind === "cancel" ? "Cancel movement?" : "Delete movement?"}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {action.kind === "cancel"
            ? isConfirmed
              ? `${action.movement.movement_number} is confirmed and already moved stock — cancelling removes it from live stock. No reversal entry is created.`
              : `${action.movement.movement_number} is still a draft and never touched stock — cancelling just closes it.`
            : `${action.movement.movement_number} will be permanently removed.`}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-border px-4 py-2 text-sm transition hover:bg-muted/40"
          >
            Keep
          </button>
          <button
            onClick={() => onSubmit(action.kind)}
            disabled={pending}
            className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white transition disabled:opacity-60 ${action.kind === "cancel" ? "bg-warning hover:bg-warning/90" : "bg-destructive hover:bg-destructive/90"}`}
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {action.kind === "cancel" ? "Cancel movement" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MovementModal({
  userId,
  movement,
  onClose,
}: {
  userId: string;
  movement?: Movement | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    movementDate: movement?.movement_date ?? today,
    warehouse: movement?.warehouse ?? "",
    reason: movement?.reason ?? "",
    direction: (movement?.direction ?? "in") as "in" | "out",
    linkedDocumentType: movement?.linked_document_type ?? "",
    linkedDocumentNumber: movement?.linked_document_number ?? "",
    notes: movement?.notes ?? "",
    productId: movement?.product_id ?? "",
    quantity: movement ? String(movement.quantity) : "1",
    unitCost: movement?.unit_cost != null ? String(movement.unit_cost) : "",
    scan: "",
  });

  const productsQ = useQuery({
    queryKey: ["products-mini"],
    queryFn: async () => {
      const data = await api.products.list();
      return data
        .map((p: any) => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          unit: p.unitOfMeasure ?? p.unit_of_measure ?? "unit",
          unitCost: p.unitCost ?? p.unit_cost ?? 0,
          mrp: p.mrp ?? null,
          barcode: p.barcode ?? "",
        }))
        .sort(
          (a: any, b: any) =>
            (a.sku ?? "").localeCompare(b.sku ?? "") || (a.name ?? "").localeCompare(b.name ?? ""),
        );
    },
  });

  // Suggest existing document numbers for the linked-doc pickers
  const linkedDocsQ = useQuery({
    queryKey: ["linked-docs", form.linkedDocumentType],
    queryFn: async () => {
      switch (form.linkedDocumentType) {
        case "GRN":
          return (await api.goodsReceipts.list()).map(
            (d: any) => d.receiptNumber ?? d.receipt_number,
          );
        case "PO":
          return (await api.goodsPurchaseOrders.list()).map((d: any) => d.poNumber ?? d.po_number);
        case "Purchase Invoice":
          return (await api.purchaseInvoices.list()).map(
            (d: any) => d.invoiceNumber ?? d.invoice_number,
          );
        case "Sales Invoice":
          return (await api.invoices.list()).map((d: any) => d.invoiceNumber ?? d.invoice_number);
        default:
          return [];
      }
    },
    enabled: ["GRN", "PO", "Purchase Invoice", "Sales Invoice"].includes(form.linkedDocumentType),
  });

  const selected = (productsQ.data ?? []).find((p: any) => p.id === form.productId);

  // Auto-filled unit value: debit (out) fetches MRP, credit (in) fetches unit cost.
  const autoValue = (p: any, direction: "in" | "out") =>
    String(direction === "out" ? (p.mrp ?? p.unitCost ?? "") : (p.unitCost ?? ""));

  const pickProduct = (pid: string) => {
    const p = (productsQ.data ?? []).find((x: any) => x.id === pid);
    setForm((f) => ({
      ...f,
      productId: pid,
      unitCost: p ? autoValue(p, f.direction) : f.unitCost,
    }));
  };

  const handleReason = (reason: string) => {
    const meta = MANUAL_REASONS.find((r) => r.label === reason);
    setForm((f) => {
      const dir = meta?.direction ?? f.direction;
      return {
        ...f,
        reason,
        direction: dir,
        linkedDocumentType: meta?.docType ?? f.linkedDocumentType,
        unitCost: selected && dir !== f.direction ? autoValue(selected, dir) : f.unitCost,
      };
    });
  };

  // Scan a barcode (or type an exact SKU) → select the product & bump quantity
  const scanProduct = () => {
    const q = form.scan.trim().toLowerCase();
    if (!q) return;
    const p = (productsQ.data ?? []).find(
      (x: any) =>
        String(x.barcode ?? "").toLowerCase() === q || String(x.sku ?? "").toLowerCase() === q,
    );
    if (!p) {
      toast.error(`No product found for “${form.scan.trim()}” — check the barcode or SKU`);
      return;
    }
    const next = (Number(form.quantity) || 0) + 1;
    if (form.productId === p.id) {
      setForm((f) => ({ ...f, quantity: String(next), scan: "" }));
    } else {
      setForm((f) => ({
        ...f,
        productId: p.id,
        unitCost: autoValue(p, f.direction),
        quantity: String(next),
        scan: "",
      }));
    }
    toast.success(`${p.sku} scanned — quantity ${next}`);
  };

  const totalValue = (Number(form.quantity) || 0) * (Number(form.unitCost) || 0);

  const save = useMutation({
    mutationFn: async (confirmNow: boolean) => {
      if (!form.productId) throw new Error("Select or scan a product from the catalogue");
      if (!form.reason) throw new Error("Movement reason is required");
      if (!form.notes.trim()) throw new Error("Notes are required for manual inventory entries");
      const qty = Number(form.quantity);
      if (!(qty > 0)) throw new Error("Quantity must be greater than zero");
      const payload = {
        product_id: form.productId,
        direction: form.direction,
        quantity: qty,
        unit_cost: form.unitCost !== "" ? Number(form.unitCost) : null,
        warehouse: form.warehouse.trim() || null,
        reason: form.reason,
        linked_document_type: form.linkedDocumentType || null,
        linked_document_number: form.linkedDocumentNumber.trim() || null,
        notes: form.notes.trim(),
        movement_date: form.movementDate,
      };
      if (movement) {
        await api.stockMovements.update(movement.id, payload);
        // "Save & confirm" on a draft: update first, then flip it confirmed.
        if (confirmNow && movement.status === "draft") {
          await api.stockMovements.confirm(movement.id);
        }
      } else {
        await api.stockMovements.create({
          ...payload,
          clientId: userId,
          status: confirmNow ? "confirmed" : "draft",
        });
      }
    },
    onSuccess: (_d, confirmNow) => {
      invalidateStock(qc);
      toast.success(
        confirmNow
          ? "Movement confirmed — stock updated"
          : movement
            ? "Movement updated"
            : "Draft movement saved",
      );
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">{movement ? "Edit movement" : "New movement"}</h3>
          <button
            onClick={onClose}
            className="text-muted-foreground transition hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(false);
          }}
          className="space-y-5 p-5"
        >
          {/* ── Movement details ── */}
          <section className="space-y-3 rounded-lg border border-border/70 p-4">
            <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Movement details
            </h4>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <L label="Movement number">
                  <div className="flex h-[38px] items-center rounded-md border border-dashed border-border bg-muted/30 px-3 text-xs text-muted-foreground">
                    <span className="font-mono">{movement?.movement_number ?? "MOV-XXXXXXXX"}</span>
                  </div>
                </L>
              </div>
              <L label="Movement date *">
                <input
                  required
                  type="date"
                  className="inp"
                  value={form.movementDate}
                  onChange={(e) => setForm({ ...form, movementDate: e.target.value })}
                />
              </L>
              <L label="Warehouse / store">
                <input
                  className="inp"
                  value={form.warehouse}
                  onChange={(e) => setForm({ ...form, warehouse: e.target.value })}
                  placeholder="e.g. Main store"
                />
              </L>
            </div>

            <L label="Movement reason *">
              <select
                required
                className="inp"
                value={form.reason}
                onChange={(e) => handleReason(e.target.value)}
              >
                <option value="">— Select reason —</option>
                {MANUAL_REASONS.map((r) => (
                  <option key={r.label} value={r.label}>
                    {r.label}
                  </option>
                ))}
              </select>
            </L>

            <L label="Direction">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      direction: "in",
                      unitCost:
                        f.direction !== "in" && selected ? autoValue(selected, "in") : f.unitCost,
                    }))
                  }
                  className={`rounded-md border px-3 py-2 text-sm transition ${form.direction === "in" ? "border-success bg-success/10 text-success" : "border-border text-muted-foreground hover:text-foreground"}`}
                >
                  <ArrowDownToLine className="mr-2 inline h-4 w-4" /> Credit{" "}
                  <span className="text-[10px] opacity-70">stock in</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      direction: "out",
                      unitCost:
                        f.direction !== "out" && selected ? autoValue(selected, "out") : f.unitCost,
                    }))
                  }
                  className={`rounded-md border px-3 py-2 text-sm transition ${form.direction === "out" ? "border-warning bg-warning/10 text-warning" : "border-border text-muted-foreground hover:text-foreground"}`}
                >
                  <ArrowUpFromLine className="mr-2 inline h-4 w-4" /> Debit{" "}
                  <span className="text-[10px] opacity-70">stock out</span>
                </button>
              </div>
            </L>
          </section>

          {/* ── Inventory item ── */}
          <section className="space-y-3 rounded-lg border border-border/70 p-4">
            <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Inventory item
            </h4>

            <div className="flex gap-2">
              <div className="flex-1">
                <L label="Scan barcode or search SKU">
                  <input
                    className="inp"
                    value={form.scan}
                    onChange={(e) => setForm({ ...form, scan: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        scanProduct();
                      }
                    }}
                    placeholder="Scan barcode or type SKU, then Enter"
                  />
                </L>
              </div>
              <button
                type="button"
                onClick={scanProduct}
                className="mt-[22px] inline-flex h-[38px] items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
              >
                <ScanBarcode className="h-4 w-4" /> Scan
              </button>
            </div>

            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-border/70" />
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                or pick from catalogue
              </span>
              <span className="h-px flex-1 bg-border/70" />
            </div>

            <L label="Product (SKU · name)">
              <SearchableSelect
                value={form.productId}
                onChange={pickProduct}
                placeholder="— Select product —"
                options={(productsQ.data ?? []).map((p: any) => ({
                  value: p.id,
                  label: p.sku ? `${p.sku} · ${p.name}` : p.name,
                }))}
              />
            </L>

            {selected ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <L label="SKU (catalogue)">
                    <div className="flex h-[38px] items-center rounded-md border border-border/70 bg-muted/30 px-3 font-mono text-xs">
                      {selected.sku}
                    </div>
                  </L>
                </div>
                <div>
                  <L label="Product name (catalogue)">
                    <div className="flex h-[38px] items-center truncate rounded-md border border-border/70 bg-muted/30 px-3 text-xs">
                      {selected.name}
                    </div>
                  </L>
                </div>
                <div>
                  <L label="Unit (catalogue)">
                    <div className="flex h-[38px] items-center rounded-md border border-border/70 bg-muted/30 px-3 text-xs">
                      {selected.unit}
                    </div>
                  </L>
                </div>
                <div>
                  <L label="Quantity *">
                    <input
                      required
                      type="number"
                      step="0.001"
                      min="0"
                      className="inp"
                      value={form.quantity}
                      onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                    />
                  </L>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
                <Package className="mx-auto mb-3 h-6 w-6 opacity-50" />
                Select or scan a product — SKU, name and unit are auto-filled from the catalogue.
              </div>
            )}

            {selected && (
              <div className="grid grid-cols-3 gap-3">
                <L label={`${form.direction === "out" ? "MRP" : "Unit cost"} (auto-filled)`}>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="inp"
                    value={form.unitCost}
                    onChange={(e) => setForm({ ...form, unitCost: e.target.value })}
                  />
                  {form.direction === "out" && (
                    <span className="mt-1 block text-[10px] text-muted-foreground">
                      Debit entries value stock-out at MRP.
                    </span>
                  )}
                </L>
                <div>
                  <L label="Total value (calculated)">
                    <div className="flex h-[38px] items-center rounded-md border border-primary/30 bg-primary/5 px-3 font-display text-sm font-semibold text-primary">
                      {fmtMoney(totalValue)}
                    </div>
                  </L>
                </div>
                <div>
                  <L label="Status">
                    {movement ? (
                      <div
                        className={`flex h-[38px] items-center rounded-md border px-3 text-xs font-medium ${
                          movement.status === "confirmed"
                            ? "border-success/40 bg-success/10 text-success"
                            : "border-warning/40 bg-warning/10 text-warning"
                        }`}
                      >
                        {movement.status === "confirmed" ? "Confirmed" : "Draft"}
                      </div>
                    ) : (
                      <div className="flex h-[38px] items-center rounded-md border border-warning/40 bg-warning/10 px-3 text-xs font-medium text-warning">
                        Draft on save
                      </div>
                    )}
                  </L>
                </div>
              </div>
            )}
          </section>

          {/* ── Linked document ── */}
          <section className="space-y-3 rounded-lg border border-border/70 p-4">
            <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Linked document
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <L label="Linked document type">
                <select
                  className="inp"
                  value={form.linkedDocumentType}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      linkedDocumentType: e.target.value,
                      linkedDocumentNumber: "",
                    })
                  }
                >
                  <option value="">— None —</option>
                  {LINKED_DOC_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </L>
              <L label="Linked document number">
                <input
                  className="inp"
                  list="linked-doc-suggestions"
                  value={form.linkedDocumentNumber}
                  onChange={(e) => setForm({ ...form, linkedDocumentNumber: e.target.value })}
                  placeholder={
                    ["GRN", "PO", "Purchase Invoice", "Sales Invoice"].includes(
                      form.linkedDocumentType,
                    )
                      ? "Type or pick a number…"
                      : "e.g. RET-001"
                  }
                />
                <datalist id="linked-doc-suggestions">
                  {(linkedDocsQ.data ?? []).map((n: string) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </L>
            </div>
          </section>

          <L label="Notes *">
            <textarea
              required
              rows={2}
              className="inp"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Required — e.g. opening stock count, damaged batch ref, sample purpose…"
            />
          </L>

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm transition hover:bg-muted/40"
            >
              Cancel
            </button>
            {movement && movement.status !== "draft" ? (
              /* Confirmed movement — only save the corrected entry */
              <button
                type="submit"
                disabled={save.isPending}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
              >
                {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Save changes
              </button>
            ) : (
              <>
                <button
                  type="submit"
                  disabled={save.isPending}
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-muted/40 disabled:opacity-60"
                >
                  {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {movement ? "Save changes" : "Save draft"}
                </button>
                <button
                  type="button"
                  disabled={save.isPending}
                  onClick={() => save.mutate(true)}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
                >
                  {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  <Check className="h-4 w-4" /> Save & confirm
                </button>
              </>
            )}
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

type ParsedRow = {
  row: number;
  date: string;
  stockIn: number;
  stockOut: number;
  direction: "in" | "out" | null;
  quantity: number;
  error?: string;
};

function BulkImportModal({
  userId,
  onClose,
}: {
  userId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [productId, setProductId] = useState("");
  const [reason, setReason] = useState("Stock adjustment");
  const [warehouse, setWarehouse] = useState("");
  const [notes, setNotes] = useState("Bulk import from Excel");
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");

  const productsQ = useQuery({
    queryKey: ["products-mini"],
    queryFn: async () => {
      const data = await api.products.list();
      return data
        .map((p: any) => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
        }))
        .sort((a: any, b: any) => (a.sku ?? "").localeCompare(b.sku ?? ""));
    },
  });

  const selectedProduct = (productsQ.data ?? []).find((p: any) => p.id === productId);

  const validRows = parsedRows.filter((r) => !r.error);
  const errorRows = parsedRows.filter((r) => r.error);

  const monthlySummary = useMemo(() => {
    const buckets = new Map<string, { month: string; stockIn: number; stockOut: number }>();

    for (const row of validRows) {
      if (!row.date) continue;
      const month = row.date.slice(0, 7);
      const bucket = buckets.get(month) ?? { month, stockIn: 0, stockOut: 0 };
      if (row.direction === "in") bucket.stockIn += row.quantity;
      if (row.direction === "out") bucket.stockOut += row.quantity;
      buckets.set(month, bucket);
    }

    return [...buckets.values()].sort((a, b) => a.month.localeCompare(b.month));
  }, [validRows]);

  const handleFile = (file: File) => {
    setFileName(file.name);
    setParseError("");
    setParsedRows([]);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

        if (rows.length < 2) {
          setParseError("Excel file is empty or has no data rows.");
          return;
        }

        // Find header row — look for columns named date, stock_in/stock_out/in/out/quantity
        const headerRow = rows[0].map((h: any) => String(h).trim().toLowerCase());
        const dateCol = headerRow.findIndex((h: string) => h === "date" || h === "movement_date" || h === "mov_date");
        const inCol = headerRow.findIndex((h: string) => h === "stock_in" || h === "in" || h === "credit" || h === "stock_in_qty");
        const outCol = headerRow.findIndex((h: string) => h === "stock_out" || h === "out" || h === "debit" || h === "stock_out_qty");

        if (dateCol === -1) {
          setParseError('Could not find a "date" column. Headers found: ' + headerRow.join(", "));
          return;
        }
        if (inCol === -1 && outCol === -1) {
          setParseError('Could not find "stock_in" or "stock_out" columns. Headers found: ' + headerRow.join(", "));
          return;
        }

        const parsed: ParsedRow[] = [];
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.every((c: any) => c === "" || c === null || c === undefined)) continue;

          const rawDate = String(row[dateCol] ?? "").trim();
          const stockIn = inCol >= 0 ? Number(row[inCol]) || 0 : 0;
          const stockOut = outCol >= 0 ? Number(row[outCol]) || 0 : 0;

          // Negative stock_out is treated as a customer return (stock_in)
          // Negative stock_in is treated as a dispatch (stock_out)
          let effectiveIn = stockIn;
          let effectiveOut = stockOut;
          if (stockOut < 0) {
            effectiveIn = 0;
            effectiveOut = Math.abs(stockOut);
          } else if (stockIn < 0) {
            effectiveIn = Math.abs(stockIn);
            effectiveOut = 0;
          }

          // Normalize date
          let dateStr = rawDate;
          // Handle Excel serial dates (numbers)
          if (typeof row[dateCol] === "number" && row[dateCol] > 30000) {
            const excelDate = XLSX.SSF.parse_date_code(row[dateCol]);
            if (excelDate) {
              dateStr = `${excelDate.y}-${String(excelDate.m).padStart(2, "0")}-${String(excelDate.d).padStart(2, "0")}`;
            }
          }
          // Try to parse date strings
          if (dateStr && !/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
            const d = new Date(dateStr);
            if (!isNaN(d.getTime())) {
              dateStr = d.toISOString().slice(0, 10);
            }
          }

          let direction: "in" | "out" | null = null;
          let quantity = 0;
          let error: string | undefined;
          if (!dateStr || !/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
            error = `Invalid date: "${rawDate}"`;
          } else if (effectiveIn === 0 && effectiveOut === 0) {
            error = "Both stock_in and stock_out are zero — skipping empty row";
          }

          // When both stock_in and stock_out are set in the same row,
          // create two separate movements (one credit, one debit).
          if (effectiveIn > 0 && effectiveOut > 0 && !error) {
            parsed.push({
              row: i + 1,
              date: dateStr,
              stockIn,
              stockOut,
              direction: "in",
              quantity: effectiveIn,
            });
            parsed.push({
              row: i + 1,
              date: dateStr,
              stockIn,
              stockOut,
              direction: "out",
              quantity: effectiveOut,
            });
          } else {
            let direction: "in" | "out" | null = null;
            let quantity = 0;
            if (effectiveIn > 0) {
              direction = "in";
              quantity = effectiveIn;
            } else if (effectiveOut > 0) {
              direction = "out";
              quantity = effectiveOut;
            }
            parsed.push({
              row: i + 1,
              date: dateStr,
              stockIn,
              stockOut,
              direction,
              quantity,
              error,
            });
          }
        }

        if (parsed.length === 0) {
          setParseError("No data rows found in the Excel file.");
          return;
        }

        setParsedRows(parsed);
      } catch (err: any) {
        setParseError("Failed to parse Excel file: " + (err?.message ?? err));
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const importMut = useMutation({
    mutationFn: async () => {
      if (!productId) throw new Error("Please select a product (SKU)");
      if (validRows.length === 0) throw new Error("No valid rows to import");

      return api.stockMovements.bulkCreate({
        productId,
        reason,
        warehouse: warehouse.trim() || undefined,
        notes: notes.trim() || undefined,
        status: "confirmed",
        movements: validRows.map((r) => ({
          date: r.date,
          direction: r.direction!,
          quantity: r.quantity,
        })),
      });
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["stock_movements"] });
      qc.invalidateQueries({ queryKey: ["stock_movements_all"] });
      qc.invalidateQueries({ queryKey: ["movements-forecast"] });
      toast.success(`Imported ${data.created} movement(s) successfully`);
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Import failed"),
  });

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-border bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">Bulk Import Movements</h3>
          <button
            onClick={onClose}
            className="text-muted-foreground transition hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          {/* Step 1: Select product */}
          <section className="space-y-3 rounded-lg border border-border/70 p-4">
            <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              1. Select product
            </h4>
            <L label="Product (SKU)">
              <SearchableSelect
                value={productId}
                onChange={setProductId}
                placeholder="— Select product —"
                options={(productsQ.data ?? []).map((p: any) => ({
                  value: p.id,
                  label: p.sku ? `${p.sku} · ${p.name}` : p.name,
                }))}
              />
            </L>
            {selectedProduct && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Package className="h-3.5 w-3.5" />
                <span>
                  <span className="font-mono">{selectedProduct.sku}</span> — {selectedProduct.name}
                </span>
              </div>
            )}
          </section>

          {/* Step 2: Upload Excel */}
          <section className="space-y-3 rounded-lg border border-border/70 p-4">
            <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              2. Upload Excel file
            </h4>
            <p className="text-xs text-muted-foreground">
              Expected columns: <code className="rounded bg-muted/50 px-1 py-0.5">date</code> (YYYY-MM-DD),
              <code className="rounded bg-muted/50 px-1 py-0.5"> stock_in</code>,
              <code className="rounded bg-muted/50 px-1 py-0.5"> stock_out</code>.
              If both stock_in and stock_out are set in the same row, two movements are created (one credit, one debit).
              Negative values are treated as returns (e.g. negative stock_out → stock_in).
            </p>

            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border/70 bg-muted/10 px-6 py-8 transition hover:border-primary/40 hover:bg-primary/5"
            >
              <FileSpreadsheet className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                Drag & drop an Excel file here, or
              </p>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-muted/40">
                <Upload className="h-4 w-4" /> Browse files
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                  }}
                />
              </label>
              {fileName && (
                <p className="text-xs text-muted-foreground">
                  Selected: <span className="font-medium text-foreground">{fileName}</span>
                </p>
              )}
            </div>

            {parseError && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>{parseError}</span>
              </div>
            )}
          </section>

          {/* Step 3: Preview */}
          {parsedRows.length > 0 && (
            <section className="space-y-3 rounded-lg border border-border/70 p-4">
              <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                3. Preview ({validRows.length} valid, {errorRows.length} errors)
              </h4>

              {/* Movement settings */}
              <div className="grid grid-cols-3 gap-3">
                <L label="Reason">
                  <select
                    className="inp"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  >
                    {MANUAL_REASONS.map((r) => (
                      <option key={r.label} value={r.label}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </L>
                <L label="Warehouse">
                  <input
                    className="inp"
                    value={warehouse}
                    onChange={(e) => setWarehouse(e.target.value)}
                    placeholder="Optional"
                  />
                </L>
                <L label="Notes">
                  <input
                    className="inp"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Notes for all rows"
                  />
                </L>
              </div>

              <div className="-mx-2 max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b border-border text-left uppercase tracking-widest text-muted-foreground">
                      <th className="px-2 py-1.5 font-normal">Row</th>
                      <th className="px-2 py-1.5 font-normal">Date</th>
                      <th className="px-2 py-1.5 font-normal">Direction</th>
                      <th className="px-2 py-1.5 text-right font-normal">Quantity</th>
                      <th className="px-2 py-1.5 font-normal">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.map((r, i) => (
                      <tr
                        key={i}
                        className={`border-b border-border/40 ${
                          r.error
                            ? "bg-destructive/5"
                            : ""
                        }`}
                      >
                        <td className="px-2 py-1.5 font-mono text-muted-foreground">{r.row}</td>
                        <td className="px-2 py-1.5">{r.date}</td>
                        <td className="px-2 py-1.5">
                          {r.direction === "in" ? (
                            <span className="text-success">Credit (In)</span>
                          ) : r.direction === "out" ? (
                            <span className="text-warning">Debit (Out)</span>
                          ) : (
                            <span className="text-destructive">—</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right num">
                          {r.quantity > 0 ? r.quantity.toLocaleString() : "—"}
                        </td>
                        <td className="px-2 py-1.5">
                          {r.error ? (
                            <span className="text-destructive">{r.error}</span>
                          ) : (
                            <span className="text-success flex items-center gap-1">
                              <Check className="h-3 w-3" /> OK
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {monthlySummary.length > 0 && (
                <div className="space-y-2 pt-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h5 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      Month-wise summary
                    </h5>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                      <span>Total stock in: <span className="font-medium text-success">{monthlySummary.reduce((sum, row) => sum + row.stockIn, 0).toLocaleString()}</span></span>
                      <span>Total stock out: <span className="font-medium text-warning">{monthlySummary.reduce((sum, row) => sum + row.stockOut, 0).toLocaleString()}</span></span>
                    </div>
                  </div>

                  <div className="-mx-2 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border text-left uppercase tracking-widest text-muted-foreground">
                          <th className="px-2 py-1.5 font-normal">Month</th>
                          <th className="px-2 py-1.5 text-right font-normal">Stock in</th>
                          <th className="px-2 py-1.5 text-right font-normal">Stock out</th>
                          <th className="px-2 py-1.5 text-right font-normal">Net</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthlySummary.map((row) => (
                          <tr key={row.month} className="border-b border-border/40">
                            <td className="px-2 py-1.5 font-medium">{new Date(`${row.month}-01T00:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" })}</td>
                            <td className="px-2 py-1.5 text-right num text-success">{row.stockIn.toLocaleString()}</td>
                            <td className="px-2 py-1.5 text-right num text-warning">{row.stockOut.toLocaleString()}</td>
                            <td className={`px-2 py-1.5 text-right num ${row.stockIn - row.stockOut >= 0 ? "text-success" : "text-warning"}`}>
                              {(row.stockIn - row.stockOut).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm transition hover:bg-muted/40"
            >
              Cancel
            </button>
            <button
              disabled={
                !productId ||
                validRows.length === 0 ||
                importMut.isPending
              }
              onClick={() => importMut.mutate()}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
            >
              {importMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              <Upload className="h-4 w-4" /> Import {validRows.length} movement(s)
            </button>
          </div>
        </div>

        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
