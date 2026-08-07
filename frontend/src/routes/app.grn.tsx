import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import {
  Plus,
  X,
  Loader2,
  ClipboardCheck,
  PackageCheck,
  Trash2,
  Pencil,
  Truck,
  Ban,
  CheckCircle2,
  ScanLine,
  FileText,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { DocumentUploader, DocumentList, type DocMeta } from "@/components/document-uploader";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { TableSkeleton } from "@/components/skeletons";

export const Route = createFileRoute("/app/grn")({
  component: GrnPage,
});

// ─── Types (snake_case — the API transform middleware shapes responses) ───
type POLine = {
  product_id: string;
  sku: string | null;
  name: string;
  unit: string;
  ordered_qty: number;
  unit_price: number;
  gst_rate: number | null;
  line_total: number;
  received_qty: number;
};

type GoodsPO = {
  id: string;
  po_number: string;
  po_date: string;
  supplier_id: string | null;
  supplier_name: string | null;
  warehouse: string | null;
  status: string;
  lines: POLine[];
};

type GRNLine = {
  product_id: string;
  sku: string | null;
  name: string;
  unit: string;
  ordered_qty: number;
  received_qty: number;
  accepted_qty: number;
  rejected_qty: number;
  unit_cost: number;
  gst_rate: number | null;
  line_value: number;
  notes: string | null;
};

type GRN = {
  id: string;
  receipt_number: string;
  goods_purchase_order_id: string;
  po_number: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  warehouse: string | null;
  received_date: string;
  purchase_invoice_id: string | null;
  challan_number: string | null;
  received_by_id: string | null;
  received_by: string | null;
  notes: string | null;
  documents: DocMeta[];
  status: string;
  stock_credited: boolean;
  credited_at: string | null;
  credited_by: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  lines: GRNLine[];
};

type CatalogueProduct = {
  id: string;
  sku: string | null;
  name: string;
  barcode: string | null;
};

type PurchaseInvoice = {
  id: string;
  invoice_number: string;
  vendor_name?: string | null;
  vendor_id?: string | null;
  supplier_name?: string | null;
  goods_po_number?: string | null;
  status?: string;
};

const GRN_STATUSES = ["draft", "confirmed", "cancelled"] as const;
const GRN_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  received: "Confirmed", // legacy pre-lifecycle status — was credited on creation
};
const GRN_STATUS_TONES: Record<string, string> = {
  draft: "bg-muted/60 text-muted-foreground border-border",
  confirmed: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  cancelled: "bg-destructive/10 text-destructive border-destructive/30",
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function GrnPage() {
  const { user, isSalesRep, isReportingManager, isAdmin, isChecker } = useAuth();
  const canWrite = !!user && !isSalesRep && !isReportingManager;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<GRN | null>(null);
  const [viewing, setViewing] = useState<GRN | null>(null);
  const [filter, setFilter] = useState("all");
  const [pendingCancel, setPendingCancel] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const grnsQ = useQuery({
    queryKey: ["grns"],
    queryFn: async () => {
      const data = (await api.goodsReceipts.list()) as GRN[];
      return data.sort((a, b) => (b.received_date || "").localeCompare(a.received_date || ""));
    },
  });
  const posQ = useQuery({
    queryKey: ["goods-pos-for-grn"],
    queryFn: async () => api.goodsPurchaseOrders.list(),
  });
  const productsQ = useQuery({
    queryKey: ["products-for-grn"],
    queryFn: async () => api.products.list(),
  });
  const purchaseInvoicesQ = useQuery({
    queryKey: ["purchase-invoices-for-grn"],
    queryFn: async () => api.purchaseInvoices.list(),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["grns"] });
    qc.invalidateQueries({ queryKey: ["goods-pos-for-grn"] });
    qc.invalidateQueries({ queryKey: ["goods-pos"] });
    qc.invalidateQueries({ queryKey: ["goods-receipts"] });
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["stock_movements_all"] });
    qc.invalidateQueries({ queryKey: ["inventory"] });
  };

  const confirm = useMutation({
    mutationFn: async ({ id, allowOverReceipt }: { id: string; allowOverReceipt: boolean }) => {
      await api.goodsReceipts.confirm(id, {
        allow_over_receipt: allowOverReceipt,
      });
    },
    onSuccess: () => {
      invalidate();
      toast.success("GRN confirmed — inventory credited");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const cancel = useMutation({
    mutationFn: async (id: string) => {
      await api.goodsReceipts.cancel(id);
    },
    onSuccess: () => {
      invalidate();
      toast.success("GRN cancelled — inventory reversed");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      await api.goodsReceipts.delete(id);
    },
    onSuccess: () => {
      invalidate();
      toast.success("Draft GRN deleted");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const filtered = (grnsQ.data ?? []).filter((g) => filter === "all" || g.status === filter);

  const stats = useMemo(() => {
    const grns = grnsQ.data ?? [];
    return {
      drafts: grns.filter((g) => g.status === "draft").length,
      confirmed: grns.filter((g) => g.status === "confirmed").length,
      stockValue: grns
        .filter((g) => g.status === "confirmed")
        .reduce((s, g) => s + (g.lines ?? []).reduce((x, l) => x + (l.line_value || 0), 0), 0),
      receivedQty: grns
        .filter((g) => g.status === "confirmed")
        .reduce((s, g) => s + (g.lines ?? []).reduce((x, l) => x + (l.accepted_qty || 0), 0), 0),
    };
  }, [grnsQ.data]);

  return (
    <div>
      <PageHeader
        eyebrow="Procurement"
        title="Goods received (GRN)"
        description="The GRN is the only document that credits inventory. Record a draft when goods arrive, then confirm it — accepted quantities enter stock and the linked PO's received quantity updates. Cancelling a confirmed GRN reverses the stock with a debit entry."
        actions={
          canWrite ? (
            <button
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              <Plus className="h-4 w-4" /> New GRN
            </button>
          ) : (
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              Read-only
            </span>
          )
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Draft GRNs" value={stats.drafts} icon={FileText} />
          <StatTile label="Confirmed" value={stats.confirmed} icon={PackageCheck} />
          <StatTile
            label="Units received"
            value={stats.receivedQty.toLocaleString()}
            icon={Truck}
          />
          <StatTile
            label="Stock value received"
            value={fmtMoney(stats.stockValue)}
            icon={ClipboardCheck}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {["all", ...GRN_STATUSES].map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`rounded-full border px-3 py-1 text-xs uppercase tracking-widest transition ${
                filter === s
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {s === "all" ? "All" : GRN_STATUS_LABELS[s]}
            </button>
          ))}
        </div>

        <Card>
          {grnsQ.isLoading ? (
            <TableSkeleton rows={6} cols={8} />
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              <PackageCheck className="mx-auto mb-2 h-8 w-8 opacity-40" />
              No GRNs yet.
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">GRN</th>
                    <th className="px-5 py-2 text-left font-normal">Supplier</th>
                    <th className="px-5 py-2 text-left font-normal">Linked PO</th>
                    <th className="px-5 py-2 text-left font-normal">Delivery</th>
                    <th className="px-5 py-2 text-right font-normal">Recv / Acc / Rej</th>
                    <th className="px-5 py-2 text-right font-normal">Stock value</th>
                    <th className="px-5 py-2 text-left font-normal">Status</th>
                    <th className="px-5 py-2 text-right font-normal">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((g) => {
                    const lines = g.lines ?? [];
                    const recv = lines.reduce((s, l) => s + (l.received_qty || 0), 0);
                    const acc = lines.reduce((s, l) => s + (l.accepted_qty || 0), 0);
                    const rej = lines.reduce((s, l) => s + (l.rejected_qty || 0), 0);
                    const value = lines.reduce((s, l) => s + (l.line_value || 0), 0);
                    return (
                      <tr key={g.id} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-3">
                          <div className="font-mono text-xs font-medium">{g.receipt_number}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {fmtDate(g.received_date)}
                          </div>
                          {g.challan_number && (
                            <div className="text-[10px] text-muted-foreground">
                              Challan {g.challan_number}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3">{g.supplier_name ?? "—"}</td>
                        <td className="px-5 py-3 font-mono text-xs">{g.po_number ?? "—"}</td>
                        <td className="px-5 py-3 text-xs text-muted-foreground">
                          {g.warehouse || "—"}
                        </td>
                        <td className="px-5 py-3 text-right num">
                          <div>{recv.toLocaleString()}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {acc.toLocaleString()} acc · {rej.toLocaleString()} rej
                          </div>
                        </td>
                        <td className="px-5 py-3 text-right num">{fmtMoney(value)}</td>
                        <td className="px-5 py-3">
                          <StatusPill
                            status={g.status}
                            label={GRN_STATUS_LABELS[g.status] ?? g.status}
                            tone={GRN_STATUS_TONES[g.status]}
                          />
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex justify-end gap-1">
                            <button
                              onClick={() => setViewing(g)}
                              className="rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary"
                            >
                              View
                            </button>
                            {canWrite && g.status === "draft" && (
                              <>
                                <button
                                  onClick={() => {
                                    setEditing(g);
                                    setOpen(true);
                                  }}
                                  className="rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary"
                                  title="Edit draft"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                                <button
                                  onClick={() =>
                                    confirm.mutate({
                                      id: g.id,
                                      allowOverReceipt: isAdmin || isChecker,
                                    })
                                  }
                                  disabled={confirm.isPending}
                                  className="inline-flex items-center gap-1 rounded-md border border-success/50 px-2 py-1 text-[10px] text-success hover:bg-success/10 disabled:opacity-60"
                                >
                                  <CheckCircle2 className="h-3 w-3" /> Confirm
                                </button>
                              </>
                            )}
                            {canWrite && g.status === "draft" && (
                              <button
                                onClick={() =>
                                  pendingCancel === g.id
                                    ? cancel.mutate(g.id)
                                    : setPendingCancel(g.id)
                                }
                                disabled={cancel.isPending}
                                className={`rounded-md border px-2 py-1 text-[10px] ${
                                  pendingCancel === g.id
                                    ? "border-destructive/50 text-destructive hover:bg-destructive/10"
                                    : "border-border text-muted-foreground hover:border-destructive hover:text-destructive"
                                }`}
                              >
                                {pendingCancel === g.id ? "Cancel?" : <Ban className="h-3 w-3" />}
                              </button>
                            )}
                            {canWrite && g.status === "confirmed" && (
                              <button
                                onClick={() =>
                                  pendingCancel === g.id
                                    ? cancel.mutate(g.id)
                                    : setPendingCancel(g.id)
                                }
                                disabled={cancel.isPending}
                                className={`rounded-md border px-2 py-1 text-[10px] ${
                                  pendingCancel === g.id
                                    ? "border-destructive/50 text-destructive hover:bg-destructive/10"
                                    : "border-border text-muted-foreground hover:border-destructive hover:text-destructive"
                                }`}
                              >
                                {pendingCancel === g.id ? "Reverse?" : <Ban className="h-3 w-3" />}
                              </button>
                            )}
                            {canWrite && g.status === "draft" && (
                              <button
                                onClick={() =>
                                  pendingDelete === g.id ? del.mutate(g.id) : setPendingDelete(g.id)
                                }
                                disabled={del.isPending}
                                className={`rounded-md border px-2 py-1 text-[10px] ${
                                  pendingDelete === g.id
                                    ? "border-destructive/50 text-destructive hover:bg-destructive/10"
                                    : "border-border text-muted-foreground hover:border-destructive hover:text-destructive"
                                }`}
                              >
                                {pendingDelete === g.id ? (
                                  "Delete?"
                                ) : (
                                  <Trash2 className="h-3.5 w-3.5" />
                                )}
                              </button>
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

        <Card title="How this works">
          <ol className="ml-4 list-decimal space-y-1 text-xs text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Record a draft GRN</span> when goods
              arrive — pick the linked PO and enter received / accepted / rejected quantities
              (barcode scan supported). No stock impact yet.
            </li>
            <li>
              <span className="font-medium text-foreground">Confirm the GRN</span> — accepted
              quantities are credited to inventory and the PO's received quantity (and
              Partially/Fully received status) updates automatically. Confirm is safe to click again
              — it never credits twice.
            </li>
            <li>
              <span className="font-medium text-foreground">Cancel</span> — a confirmed GRN is
              reversed with debit (stock-out) entries; a draft is simply closed. Purchase orders,
              proformas and purchase invoices never create stock entries — only the GRN does.
            </li>
          </ol>
        </Card>
      </div>

      {open && user && (
        <GrnModal
          userId={user.id}
          grn={editing}
          pos={(posQ.data ?? []).filter(
            (p) =>
              p.status === "approved" || p.status === "sent" || p.status === "partially_received",
          )}
          products={productsQ.data ?? []}
          purchaseInvoices={purchaseInvoicesQ.data ?? []}
          canApproveOverReceipt={isAdmin || isChecker}
          onClose={() => setOpen(false)}
          onSaved={invalidate}
        />
      )}
      {viewing && <GrnDetailModal grn={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

// ─── GRN create/edit modal ────────────────────────────────────────────────
type LineDraft = {
  product_id: string;
  sku: string | null;
  name: string;
  unit: string;
  ordered_qty: string;
  unit_cost: string;
  gst_rate: string;
  received_qty: string;
  accepted_qty: string;
  rejected_qty: string;
  notes: string;
};

function GrnModal({
  userId,
  grn,
  pos,
  products,
  purchaseInvoices,
  canApproveOverReceipt,
  onClose,
  onSaved,
}: {
  userId: string;
  grn: GRN | null;
  pos: GoodsPO[];
  products: CatalogueProduct[];
  purchaseInvoices: PurchaseInvoice[];
  canApproveOverReceipt: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!grn;
  const [f, setF] = useState({
    po_id: grn?.goods_purchase_order_id ?? "",
    received_date: (grn?.received_date ?? new Date().toISOString().slice(0, 10)).slice(0, 10),
    warehouse: grn?.warehouse ?? "",
    challan_number: grn?.challan_number ?? "",
    purchase_invoice_id: grn?.purchase_invoice_id ?? "",
    notes: grn?.notes ?? "",
  });
  const [lines, setLines] = useState<LineDraft[]>(
    (grn?.lines ?? []).map((l) => ({
      product_id: l.product_id,
      sku: l.sku,
      name: l.name,
      unit: l.unit,
      ordered_qty: String(l.ordered_qty),
      unit_cost: String(l.unit_cost),
      gst_rate: l.gst_rate != null ? String(l.gst_rate) : "",
      received_qty: String(l.received_qty),
      accepted_qty: String(l.accepted_qty),
      rejected_qty: String(l.rejected_qty),
      notes: l.notes ?? "",
    })),
  );
  const [docs, setDocs] = useState<DocMeta[]>(grn?.documents ?? []);
  const [scan, setScan] = useState("");
  const [overReceipt, setOverReceipt] = useState(false);
  const [mode, setMode] = useState<"draft" | "confirm">("draft");

  const selectedPo = pos.find((p) => p.id === f.po_id);

  // Purchase invoices for the selected PO take priority — the GRN is created
  // AFTER the purchase invoice, which already references the PO.
  const linkedPiCandidates = useMemo(() => {
    if (!f.po_id) return purchaseInvoices;
    const po = pos.find((p) => p.id === f.po_id);
    if (!po) return purchaseInvoices;
    const samePo = purchaseInvoices.filter((pi) => (pi.goods_po_number ?? "") === po.po_number);
    return samePo.length > 0 ? samePo : purchaseInvoices;
  }, [purchaseInvoices, pos, f.po_id]);

  // When the linked PO changes, auto-fill supplier/warehouse + lines from the PO.
  const pickPo = (id: string) => {
    const po = pos.find((p) => p.id === id);
    if (!po) {
      setF((prev) => ({ ...prev, po_id: id, warehouse: "" }));
      setLines([]);
      return;
    }
    setF((prev) => ({
      ...prev,
      po_id: id,
      warehouse: po.warehouse ?? prev.warehouse,
    }));
    setLines(
      (po.lines ?? []).map((l) => ({
        product_id: l.product_id,
        sku: l.sku,
        name: l.name,
        unit: l.unit,
        ordered_qty: String(l.ordered_qty),
        unit_cost: String(l.unit_price),
        gst_rate: l.gst_rate != null ? String(l.gst_rate) : "",
        received_qty: "",
        accepted_qty: "",
        rejected_qty: "",
        notes: "",
      })),
    );
    setScan("");
  };

  const setLine = (i: number, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  // Barcode scan: match catalogue barcode or SKU, bump that line's received qty
  // by 1. Accepted follows unless the user deliberately set it differently.
  const handleScan = () => {
    const q = scan.trim().toLowerCase();
    if (!q) return;
    const product = (products ?? []).find(
      (p) =>
        (p.barcode ?? "").toLowerCase() === q ||
        (p.sku ?? "").toLowerCase() === q ||
        (p.id ?? "").toLowerCase() === q,
    );
    if (!product) {
      toast.error("No catalogue product matches that barcode/SKU");
      return;
    }
    const idx = lines.findIndex((l) => l.product_id === product.id);
    if (idx === -1) {
      toast.error(`${product.name} is not on this GRN`);
      return;
    }
    const cur = Number(lines[idx].received_qty) || 0;
    const acc = lines[idx].accepted_qty;
    const next = String(cur + 1);
    setLine(idx, {
      received_qty: next,
      // Preserve a deliberately lower accepted value (e.g. damaged stock)
      accepted_qty: acc === "" || Number(acc) === cur ? next : acc,
    });
    setScan("");
  };

  const setReceived = (i: number, v: string) => {
    // Accepted defaults to received unless the user already set a different value.
    setLine(i, {
      received_qty: v,
      accepted_qty: lines[i].accepted_qty === "" ? v : lines[i].accepted_qty,
    });
  };

  const totals = useMemo(() => {
    let received = 0;
    let accepted = 0;
    let rejected = 0;
    let value = 0;
    for (const l of lines) {
      const r = Number(l.received_qty) || 0;
      const a = Number(l.accepted_qty) || 0;
      const rej = Number(l.rejected_qty) || 0;
      const cost = Number(l.unit_cost) || 0;
      received += r;
      accepted += a;
      rejected += rej;
      value += a * cost;
    }
    return { received, accepted, rejected, value: round2(value) };
  }, [lines]);

  const save = useMutation({
    mutationFn: async () => {
      if (!f.po_id) throw new Error("Pick a linked purchase order");
      if (lines.length === 0) throw new Error("Add at least one received line");
      const payloadLines = lines.map((l) => ({
        product_id: l.product_id,
        received_qty: Number(l.received_qty) || 0,
        accepted_qty: Number(l.accepted_qty) || 0,
        rejected_qty: Number(l.rejected_qty) || 0,
        unit_cost: Number(l.unit_cost) || 0,
        notes: l.notes.trim() || null,
      }));
      for (const l of payloadLines) {
        if (!(l.received_qty > 0))
          throw new Error("Received quantity must be greater than zero on every line");
        if (l.accepted_qty > l.received_qty)
          throw new Error("Accepted quantity cannot exceed received quantity");
        if (l.rejected_qty > l.received_qty)
          throw new Error("Rejected quantity cannot exceed received quantity");
      }
      const payload = {
        goods_purchase_order_id: f.po_id,
        received_date: f.received_date,
        warehouse: f.warehouse.trim() || null,
        challan_number: f.challan_number.trim() || null,
        purchase_invoice_id: f.purchase_invoice_id || null,
        notes: f.notes.trim() || null,
        documents: docs,
        lines: payloadLines,
      };
      let id = grn?.id;
      if (isEdit && grn) {
        await api.goodsReceipts.update(grn.id, payload);
      } else {
        const created = await api.goodsReceipts.create(payload);
        id = created.id;
      }
      if (mode === "confirm" && id) {
        await api.goodsReceipts.confirm(id, {
          allow_over_receipt: overReceipt && canApproveOverReceipt,
        });
      }
    },
    onSuccess: () => {
      onSaved();
      toast.success(mode === "confirm" ? "GRN confirmed — inventory credited" : "Draft GRN saved");
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
        className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-border bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <div>
            <h3 className="font-display text-lg">
              {isEdit ? `Edit ${grn.receipt_number}` : "New goods received note"}
            </h3>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Draft GRNs do not touch stock — confirming credits the accepted quantities
            </div>
          </div>
          <button onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-5 p-5"
        >
          {/* Header */}
          <fieldset className="rounded-lg border border-border/60 p-4">
            <legend className="px-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              GRN header
            </legend>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <L label="GRN number">
                <input
                  className="inp"
                  value={isEdit ? grn.receipt_number : "System-generated"}
                  disabled
                />
              </L>
              <L label="GRN date">
                <input
                  type="date"
                  className="inp"
                  value={f.received_date}
                  onChange={(e) => setF({ ...f, received_date: e.target.value })}
                />
              </L>
              <L label="Linked purchase order *">
                <SearchableSelect
                  value={f.po_id}
                  onChange={pickPo}
                  placeholder="Select PO…"
                  disabled={isEdit}
                  options={[
                    { value: "", label: "Select PO…" },
                    ...pos.map((p: any) => ({
                      value: p.id,
                      label: p.po_number,
                      hint: p.supplier_name ?? undefined,
                    })),
                  ]}
                />
              </L>
              <L label="Supplier">
                <input
                  className="inp"
                  value={selectedPo?.supplier_name ?? grn?.supplier_name ?? ""}
                  disabled
                />
              </L>
              <L label="Delivery warehouse / store">
                <input
                  className="inp"
                  value={f.warehouse}
                  onChange={(e) => setF({ ...f, warehouse: e.target.value })}
                  placeholder="e.g. Main store"
                />
              </L>
              <L label="Supplier delivery challan #">
                <input
                  className="inp"
                  value={f.challan_number}
                  onChange={(e) => setF({ ...f, challan_number: e.target.value })}
                  placeholder="Optional"
                />
              </L>
              <L label="Linked purchase invoice">
                <SearchableSelect
                  value={f.purchase_invoice_id}
                  onChange={(v) => setF({ ...f, purchase_invoice_id: v })}
                  placeholder="None (optional)"
                  options={[
                    { value: "", label: "None (optional)" },
                    ...linkedPiCandidates.map((pi: any) => ({
                      value: pi.id,
                      label: pi.invoice_number,
                      hint:
                        [
                          pi.supplier_name ?? pi.vendor_name,
                          pi.goods_po_number ? `PO ${pi.goods_po_number}` : "",
                        ]
                          .filter(Boolean)
                          .join(" · ") || undefined,
                    })),
                  ]}
                />
              </L>
              <L label="Received by">
                <input className="inp" value={userId} disabled />
              </L>
            </div>
            <div className="mt-3">
              <L label="Notes">
                <textarea
                  rows={2}
                  className="inp resize-y"
                  value={f.notes}
                  onChange={(e) => setF({ ...f, notes: e.target.value })}
                  placeholder="Delivery remarks…"
                />
              </L>
            </div>
            <div className="mt-3">
              <DocumentUploader
                userId={userId}
                scope="grns"
                docs={docs}
                onChange={setDocs}
                hint="Attach the delivery challan / photo (optional)."
              />
            </div>
          </fieldset>

          {/* Barcode scan */}
          {f.po_id && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
              <L label="Barcode scan">
                <div className="flex items-center gap-2">
                  <ScanLine className="h-4 w-4 shrink-0 text-primary" />
                  <input
                    className="inp"
                    value={scan}
                    onChange={(e) => setScan(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleScan();
                      }
                    }}
                    placeholder="Scan a product barcode or type a SKU and press Enter — received qty +1"
                  />
                </div>
              </L>
            </div>
          )}

          {/* Lines */}
          <fieldset className="rounded-lg border border-border/60 p-4">
            <legend className="px-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              GRN item lines
            </legend>
            {!f.po_id ? (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
                Pick a linked purchase order first — product lines, units and unit costs are
                auto-filled from the PO.
              </div>
            ) : lines.length === 0 ? (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
                This PO has no lines.
              </div>
            ) : (
              <div className="space-y-2">
                <div className="hidden grid-cols-12 gap-2 text-[9px] uppercase tracking-widest text-muted-foreground md:grid">
                  <div className="col-span-3">SKU / Product</div>
                  <div className="col-span-1">Unit</div>
                  <div className="col-span-1">Ordered</div>
                  <div className="col-span-2">Received</div>
                  <div className="col-span-1">Accepted</div>
                  <div className="col-span-1">Rejected</div>
                  <div className="col-span-1">Unit cost</div>
                  <div className="col-span-1 text-right">Line value</div>
                  <div className="col-span-1"></div>
                </div>
                {lines.map((l, i) => {
                  const accepted = Number(l.accepted_qty) || 0;
                  const cost = Number(l.unit_cost) || 0;
                  const lineValue = round2(accepted * cost);
                  const overAccepted =
                    accepted > Number(l.ordered_qty) - 0 && Number(l.ordered_qty) > 0
                      ? accepted > Number(l.ordered_qty)
                      : false;
                  return (
                    <div
                      key={i}
                      className="grid grid-cols-2 items-end gap-2 rounded-md border border-border/50 p-2 md:grid-cols-12"
                    >
                      <div className="col-span-2 md:col-span-3">
                        <div className="text-xs font-medium">
                          {l.name}
                          {l.sku && (
                            <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                              {l.sku}
                            </span>
                          )}
                        </div>
                        <input
                          className="inp mt-1"
                          value={l.notes}
                          onChange={(e) => setLine(i, { notes: e.target.value })}
                          placeholder="Line note (optional)"
                        />
                      </div>
                      <div>
                        <L label="Unit">
                          <input className="inp" value={l.unit} disabled />
                        </L>
                      </div>
                      <div>
                        <L label="Ordered">
                          <input className="inp" value={l.ordered_qty} disabled />
                        </L>
                      </div>
                      <div className="md:col-span-2">
                        <L label="Received">
                          <input
                            type="number"
                            min="0"
                            step="0.001"
                            className={`inp ${overAccepted ? "!border-warning" : ""}`}
                            value={l.received_qty}
                            onChange={(e) => setReceived(i, e.target.value)}
                          />
                        </L>
                      </div>
                      <div>
                        <L label="Accepted">
                          <input
                            type="number"
                            min="0"
                            step="0.001"
                            className="inp"
                            value={l.accepted_qty}
                            onChange={(e) => setLine(i, { accepted_qty: e.target.value })}
                          />
                        </L>
                        {overAccepted && (
                          <div className="mt-0.5 text-[9px] text-warning">
                            Above ordered — needs approval
                          </div>
                        )}
                      </div>
                      <div>
                        <L label="Rejected">
                          <input
                            type="number"
                            min="0"
                            step="0.001"
                            className="inp"
                            value={l.rejected_qty}
                            onChange={(e) => setLine(i, { rejected_qty: e.target.value })}
                            placeholder="0"
                          />
                        </L>
                      </div>
                      <div>
                        <L label="Unit cost">
                          <input className="inp" value={l.unit_cost} disabled />
                        </L>
                      </div>
                      <div className="text-right">
                        <L label="Line value">
                          <div className="inp text-right font-mono tabular-nums">
                            {fmtMoney(lineValue)}
                          </div>
                        </L>
                      </div>
                      <div className="flex items-end justify-end pb-1">
                        <button
                          type="button"
                          onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                          className="rounded p-1 text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </fieldset>

          {/* Totals */}
          <div className="ml-auto max-w-xs space-y-1 rounded-lg border border-border/60 bg-muted/20 p-4 text-sm">
            <Row label="Total received qty" value={totals.received.toLocaleString()} />
            <Row label="Total accepted qty" value={totals.accepted.toLocaleString()} />
            <Row label="Total rejected qty" value={totals.rejected.toLocaleString()} />
            <div className="flex items-center justify-between border-t border-border pt-1.5 font-medium">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">
                Stock value received
              </span>
              <span className="num text-base">{fmtMoney(totals.value)}</span>
            </div>
          </div>

          {canApproveOverReceipt && f.po_id && (
            <label className="flex cursor-pointer items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={overReceipt}
                onChange={(e) => setOverReceipt(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium text-foreground">Allow over-receipt (approved)</span>
                <span className="block text-[10px] text-muted-foreground">
                  Permits accepting more than the ordered quantity on a line at confirm time.
                </span>
              </span>
            </label>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <p className="text-[10px] text-muted-foreground">
              Confirm credits the accepted quantities to inventory and updates the PO. Cancel
              reverses a confirmed GRN with debit entries.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-border px-4 py-2 text-sm"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("draft");
                  save.mutate();
                }}
                disabled={save.isPending}
                className="rounded-md border border-border px-4 py-2 text-sm"
              >
                {save.isPending && mode === "draft" ? (
                  <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />
                ) : null}
                {isEdit ? "Save draft" : "Save draft"}
              </button>
              <button
                type="submit"
                onClick={() => setMode("confirm")}
                disabled={save.isPending || !f.po_id}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {save.isPending && mode === "confirm" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                {isEdit ? "Save & confirm" : "Save & confirm"}
              </button>
            </div>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:disabled{opacity:.55}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

// ─── GRN detail modal ─────────────────────────────────────────────────────
function GrnDetailModal({ grn, onClose }: { grn: GRN; onClose: () => void }) {
  const lines = grn.lines ?? [];
  const recv = lines.reduce((s, l) => s + (l.received_qty || 0), 0);
  const acc = lines.reduce((s, l) => s + (l.accepted_qty || 0), 0);
  const rej = lines.reduce((s, l) => s + (l.rejected_qty || 0), 0);
  const value = lines.reduce((s, l) => s + (l.line_value || 0), 0);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <div>
            <h3 className="font-display text-lg">{grn.receipt_number}</h3>
            <div className="mt-0.5">
              <StatusPill
                status={grn.status}
                label={GRN_STATUS_LABELS[grn.status] ?? grn.status}
                tone={GRN_STATUS_TONES[grn.status]}
              />
            </div>
          </div>
          <button onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <Info label="GRN date" value={fmtDate(grn.received_date)} />
            <Info label="Supplier" value={grn.supplier_name ?? "—"} />
            <Info label="Linked PO" value={grn.po_number ?? "—"} />
            <Info label="Warehouse" value={grn.warehouse ?? "—"} />
            <Info label="Challan #" value={grn.challan_number ?? "—"} />
            <Info label="Received by" value={grn.received_by ?? "—"} />
            <Info label="Confirmed by" value={grn.credited_by ?? "—"} />
            <Info label="Cancelled by" value={grn.cancelled_by ?? "—"} />
          </div>

          <div className="overflow-x-auto rounded-md border border-border/60">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-normal">Product</th>
                  <th className="px-3 py-2 text-right font-normal">Ordered</th>
                  <th className="px-3 py-2 text-right font-normal">Received</th>
                  <th className="px-3 py-2 text-right font-normal">Accepted</th>
                  <th className="px-3 py-2 text-right font-normal">Rejected</th>
                  <th className="px-3 py-2 text-right font-normal">Unit cost</th>
                  <th className="px-3 py-2 text-right font-normal">Value</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.product_id} className="border-b border-border/40">
                    <td className="px-3 py-2">
                      <div className="font-medium">{l.name}</div>
                      {l.sku && (
                        <div className="text-[10px] font-mono text-muted-foreground">{l.sku}</div>
                      )}
                      {l.notes && (
                        <div className="text-[10px] text-muted-foreground">Note: {l.notes}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right num">{l.ordered_qty.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right num">
                      {(l.received_qty || 0).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right num text-success">
                      {(l.accepted_qty ?? l.received_qty ?? 0).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right num text-warning">
                      {(l.rejected_qty || 0).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right num text-muted-foreground">
                      {fmtMoney(l.unit_cost)}
                    </td>
                    <td className="px-3 py-2 text-right num">{fmtMoney(l.line_value ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ml-auto max-w-xs space-y-1 rounded-lg border border-border/60 bg-muted/20 p-4 text-sm">
            <Row label="Total received qty" value={recv.toLocaleString()} />
            <Row label="Total accepted qty" value={acc.toLocaleString()} />
            <Row label="Total rejected qty" value={rej.toLocaleString()} />
            <div className="flex items-center justify-between border-t border-border pt-1.5 font-medium">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">
                Stock value received
              </span>
              <span className="num text-base">{fmtMoney(value)}</span>
            </div>
          </div>

          {grn.notes && (
            <div className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Notes: </span>
              {grn.notes}
            </div>
          )}

          <div>
            <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">
              Attachments
            </span>
            <DocumentList docs={grn.documents ?? []} />
          </div>

          <div className="flex justify-end border-t border-border pt-3">
            <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Small shared bits ────────────────────────────────────────────────────
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-medium">{value}</div>
    </div>
  );
}

function StatusPill({ status, label, tone }: { status: string; label: string; tone?: string }) {
  const cls = tone ?? GRN_STATUS_TONES[status] ?? "bg-muted/60 text-muted-foreground border-border";
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${cls}`}
    >
      {label}
    </span>
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

function StatTile({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
        <Icon className="h-4 w-4 text-muted-foreground/60" />
      </div>
      <div className="mt-1 font-display text-2xl">{value}</div>
    </div>
  );
}
