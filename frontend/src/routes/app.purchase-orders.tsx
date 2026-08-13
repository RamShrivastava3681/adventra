import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import {
  Plus,
  X,
  Loader2,
  ClipboardList,
  PackageCheck,
  PackageOpen,
  Send,
  CheckCircle2,
  Ban,
  Trash2,
  Pencil,
  Truck,
  FileDown,
  CircleDollarSign,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { DocumentUploader, type DocMeta } from "@/components/document-uploader";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { TableSkeleton } from "@/components/skeletons";

export const Route = createFileRoute("/app/purchase-orders")({
  component: PurchaseOrdersPage,
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

type PO = {
  id: string;
  po_number: string;
  po_date: string;
  supplier_id: string | null;
  supplier_name: string | null;
  warehouse: string | null;
  expected_delivery_date: string | null;
  payment_terms: string | null;
  buyer_id: string | null;
  buyer_name: string | null;
  notes: string | null;
  documents: DocMeta[];
  status: string;
  supplier_approval_status: "pending" | "approved" | "rejected" | null;
  supplier_approval_sent_at: string | null;
  supplier_approval_responded_at: string | null;
  supplier_approval_comments: string | null;
  supplier_approval_email: string | null;
  lines: POLine[];
  total_qty: number;
  subtotal: number;
  gst_total: number;
  freight: number;
  grand_total: number;
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
  supplier_name: string | null;
  warehouse: string | null;
  received_date: string;
  challan_number: string | null;
  notes: string | null;
  status: string;
  stock_credited: boolean;
  lines: GRNLine[];
};

type CatalogueProduct = {
  id: string;
  sku: string | null;
  name: string;
  unit_of_measure: string;
  gst_rate: number | null;
  unit_cost: number | null;
  status: string;
};

const PO_STATUSES = [
  "draft",
  "pending_review",
  "approved",
  "sent",
  "partially_received",
  "fully_received",
  "cancelled",
] as const;

const PO_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_review: "Awaiting checker",
  approved: "Approved",
  sent: "Sent",
  partially_received: "Partially received",
  fully_received: "Fully received",
  cancelled: "Cancelled",
};

const PO_STATUS_TONES: Record<string, string> = {
  draft: "bg-muted/60 text-muted-foreground border-border",
  pending_review:
    "bg-amber-500/10 text-amber-600 border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/40",
  approved:
    "bg-blue-500/10 text-blue-600 border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-400 dark:border-blue-500/40",
  sent: "bg-indigo-500/10 text-indigo-600 border-indigo-500/30",
  partially_received: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  fully_received: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  cancelled: "bg-destructive/10 text-destructive border-destructive/30",
};

// Supplier approval (PO PDF sent by email — Approve/Reject from the email link).
const PO_SUPPLIER_LABELS: Record<string, string> = {
  pending: "Awaiting supplier",
  approved: "Approved by supplier",
  rejected: "Rejected by supplier",
};

const PO_SUPPLIER_TONES: Record<string, string> = {
  pending: "bg-violet-500/10 text-violet-600 border-violet-500/30",
  approved: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  rejected: "bg-destructive/10 text-destructive border-destructive/30",
};

const PAYMENT_TERMS = [
  "",
  "Net 15",
  "Net 30",
  "Net 60",
  "Advance payment",
  "Cash on delivery",
  "Letter of credit",
];

const PF_CURRENCIES = ["USD", "INR", "EUR", "GBP", "AED"];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function PurchaseOrdersPage() {
  const { user, isSalesRep, isAdmin, isChecker } = useAuth();
  const canWrite = !isSalesRep && !!user;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PO | null>(null);
  const [receiving, setReceiving] = useState<PO | null>(null);
  const [grnView, setGrnView] = useState<PO | null>(null);
  const [filter, setFilter] = useState("all");

  const posQ = useQuery({
    queryKey: ["goods-pos"],
    queryFn: async () => {
      const data = (await api.goodsPurchaseOrders.list()) as PO[];
      return data.sort((a, b) => (b.po_date || "").localeCompare(a.po_date || ""));
    },
  });
  const grnsQ = useQuery({
    queryKey: ["goods-receipts"],
    queryFn: async () => api.goodsReceipts.list(),
  });

  // Catalogue + suppliers (suppliers and legacy vendors merged, like Purchases).
  const productsQ = useQuery({
    queryKey: ["products-for-po"],
    queryFn: async () => {
      const data = (await api.products.list()) as CatalogueProduct[];
      return data.filter((p) => p.status === "active");
    },
  });
  const suppliersQ = useQuery({
    queryKey: ["suppliers-for-po"],
    queryFn: async () => {
      const [suppliers, vendors] = await Promise.all([api.suppliers.list(), api.vendors.list()]);
      const merged = [
        ...suppliers.map(
          (s: { id: string; company_name?: string; companyName?: string; name?: string }) => ({
            id: s.id,
            name: s.company_name ?? s.companyName ?? s.name ?? s.id,
          }),
        ),
        ...vendors.map((v: { id: string; name?: string }) => ({ id: v.id, name: v.name ?? v.id })),
      ];
      return merged.sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  // Last supplier price per product — most recent PO line price or GRN unit cost.
  const lastPrices = useMemo(() => {
    const map = new Map<string, number>();
    const entries: Array<{ date: string; productId: string; price: number }> = [];
    for (const po of (posQ.data ?? []) as PO[]) {
      for (const l of po.lines ?? []) {
        entries.push({ date: po.po_date || "", productId: l.product_id, price: l.unit_price });
      }
    }
    for (const g of (grnsQ.data ?? []) as GRN[]) {
      for (const l of g.lines ?? []) {
        entries.push({ date: g.received_date || "", productId: l.product_id, price: l.unit_cost });
      }
    }
    entries
      .sort((a, b) => b.date.localeCompare(a.date))
      .forEach((e) => {
        if (!map.has(e.productId) && e.price >= 0) map.set(e.productId, e.price);
      });
    return map;
  }, [posQ.data, grnsQ.data]);

  const del = useMutation({
    mutationFn: async (id: string) => {
      await api.goodsPurchaseOrders.delete(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goods-pos"] });
      toast.success("Purchase order deleted");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // Email the purchase order PDF to the supplier for their approval.
  const sendToSupplier = useMutation({
    mutationFn: async (id: string) => {
      const res = (await api.goodsPurchaseOrders.sendToSupplier(id)) as any;
      return res?.sentTo ?? "the supplier";
    },
    onSuccess: (sentTo) => {
      qc.invalidateQueries({ queryKey: ["goods-pos"] });
      toast.success(`Purchase order PDF sent to ${sentTo} for approval`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const filtered = (posQ.data ?? []).filter((p) => filter === "all" || p.status === filter);

  const stats = useMemo(() => {
    const pos = posQ.data ?? [];
    const open = pos.filter((p) =>
      ["draft", "pending_review", "approved", "sent"].includes(p.status),
    );
    const commitment = open.reduce((s, p) => s + Number(p.grand_total || 0), 0);
    let receivedValue = 0;
    for (const p of pos) {
      if (p.status === "cancelled") continue;
      for (const l of p.lines ?? []) receivedValue += (l.received_qty ?? 0) * l.unit_price;
    }
    return {
      open: open.length,
      commitment,
      receivedValue,
      fullyReceived: pos.filter((p) => p.status === "fully_received").length,
    };
  }, [posQ.data]);

  const supplierName = (id: string | null) =>
    (suppliersQ.data ?? []).find((s: { id: string }) => s.id === id)?.name ?? null;

  return (
    <div>
      <PageHeader
        eyebrow="Procurement"
        title="Purchase orders"
        description="Purchase requests/commitments against the product catalogue. A PO never creates inventory — goods are credited to stock when a GRN is recorded."
        icon={<ClipboardList className="h-5 w-5" />}
        actions={
          canWrite ? (
            <button
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              <Plus className="h-4 w-4" /> New purchase order
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
          <StatTile label="Open POs" value={stats.open} icon={ClipboardList} />
          <StatTile
            label="Commitment value"
            value={fmtMoney(stats.commitment)}
            icon={CircleDollarSign}
          />
          <StatTile
            label="Received value"
            value={fmtMoney(stats.receivedValue)}
            icon={PackageCheck}
          />
          <StatTile label="Fully received" value={stats.fullyReceived} icon={PackageOpen} />
        </div>

        <div className="flex flex-wrap gap-2">
          {["all", ...PO_STATUSES].map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`rounded-full border px-3 py-1 text-xs uppercase tracking-widest transition ${
                filter === s
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {s === "all" ? "All" : PO_STATUS_LABELS[s]}
            </button>
          ))}
        </div>

        <Card>
          {posQ.isLoading ? (
            <TableSkeleton rows={6} cols={8} />
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              <ClipboardList className="mx-auto mb-2 h-8 w-8 opacity-40" />
              No purchase orders yet.
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">PO</th>
                    <th className="px-5 py-2 text-left font-normal">Supplier</th>
                    <th className="px-5 py-2 text-left font-normal">Delivery</th>
                    <th className="px-5 py-2 text-right font-normal">Qty</th>
                    <th className="px-5 py-2 text-right font-normal">Grand total</th>
                    <th className="px-5 py-2 text-left font-normal">Received</th>
                    <th className="px-5 py-2 text-left font-normal">Status</th>
                    <th className="px-5 py-2 text-right font-normal">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => {
                    const totalQty = (p.lines ?? []).reduce((s, l) => s + l.ordered_qty, 0);
                    const recQty = (p.lines ?? []).reduce((s, l) => s + (l.received_qty ?? 0), 0);
                    const pct =
                      totalQty > 0 ? Math.min(100, Math.round((recQty / totalQty) * 100)) : 0;
                    return (
                      <tr key={p.id} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-3 font-mono text-xs">
                          {p.po_number}
                          <div className="text-[10px] text-muted-foreground">
                            {fmtDate(p.po_date)}
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          {p.supplier_name ?? supplierName(p.supplier_id) ?? "—"}
                        </td>
                        <td className="px-5 py-3 text-xs text-muted-foreground">
                          {p.warehouse || "—"}
                          {p.expected_delivery_date ? (
                            <div className="text-[10px]">
                              by {fmtDate(p.expected_delivery_date)}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-5 py-3 text-right num">{totalQty.toLocaleString()}</td>
                        <td className="px-5 py-3 text-right num font-medium">
                          {fmtMoney(p.grand_total)}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                              <div
                                className={`h-full rounded-full ${pct >= 100 ? "bg-success" : "bg-primary"}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-[10px] tabular-nums text-muted-foreground">
                              {recQty}/{totalQty}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <StatusPill
                            status={p.status}
                            label={PO_STATUS_LABELS[p.status] ?? p.status}
                            tone={PO_STATUS_TONES[p.status]}
                          />
                          {p.supplier_approval_status && (
                            <div className="mt-1">
                              <StatusPill
                                status={p.supplier_approval_status}
                                label={
                                  PO_SUPPLIER_LABELS[p.supplier_approval_status] ??
                                  p.supplier_approval_status
                                }
                                tone={PO_SUPPLIER_TONES[p.supplier_approval_status]}
                              />
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex justify-end gap-1">
                            <button
                              onClick={() => {
                                setEditing(p);
                                setOpen(true);
                              }}
                              className="rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary"
                            >
                              View
                            </button>
                            {canWrite && ["draft", "approved"].includes(p.status) && (
                              <button
                                onClick={() => {
                                  setEditing(p);
                                  setOpen(true);
                                }}
                                className="rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary"
                                title="Edit"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                            )}
                            {canWrite &&
                              ["approved", "sent", "partially_received"].includes(p.status) && (
                                <button
                                  onClick={() => setReceiving(p)}
                                  className="inline-flex items-center gap-1 rounded-md border border-success/50 px-2 py-1 text-[10px] text-success hover:bg-success/10"
                                >
                                  <Truck className="h-3 w-3" /> Receive
                                </button>
                              )}
                            {(p.lines ?? []).some((l) => l.received_qty > 0) && (
                              <button
                                onClick={() => setGrnView(p)}
                                className="rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary"
                                title="View GRNs"
                              >
                                <FileDown className="h-3 w-3" />
                              </button>
                            )}
                            {canWrite && p.status === "draft" && (
                              <button
                                onClick={() => del.mutate(p.id)}
                                className="rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:border-destructive hover:text-destructive"
                                title="Delete"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {canWrite && p.status === "approved" && (
                              <button
                                onClick={() => sendToSupplier.mutate(p.id)}
                                disabled={sendToSupplier.isPending}
                                className="inline-flex items-center gap-1 rounded-md border border-violet-500/40 px-2 py-1 text-[10px] text-violet-600 hover:bg-violet-500/10 disabled:opacity-50"
                                title="Email the purchase order PDF to the supplier for approval"
                              >
                                {sendToSupplier.isPending ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Send className="h-3 w-3" />
                                )}
                                Send to supplier
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
      </div>

      {open && user && (
        <POModal
          userId={user.id}
          email={user.email}
          po={editing}
          products={productsQ.data ?? []}
          suppliers={suppliersQ.data ?? []}
          lastPrices={lastPrices}
          canWrite={canWrite}
          canApprove={isAdmin || isChecker}
          onClose={() => setOpen(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["goods-pos"] });
            qc.invalidateQueries({ queryKey: ["proformas"] });
          }}
        />
      )}
      {receiving && user && (
        <GRNModal
          po={receiving}
          onClose={() => setReceiving(null)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ["goods-pos"] });
            qc.invalidateQueries({ queryKey: ["goods-receipts"] });
            qc.invalidateQueries({ queryKey: ["grns"] });
            qc.invalidateQueries({ queryKey: ["products"] });
            qc.invalidateQueries({ queryKey: ["stock_movements_all"] });
          }}
        />
      )}
      {grnView && (
        <GRNsModal
          po={grnView}
          grns={(grnsQ.data ?? []).filter((g) => g.goods_purchase_order_id === grnView.id)}
          canWrite={canWrite}
          canApproveOverReceipt={isAdmin || isChecker}
          onClose={() => setGrnView(null)}
          onDeleted={() => {
            qc.invalidateQueries({ queryKey: ["goods-pos"] });
            qc.invalidateQueries({ queryKey: ["goods-receipts"] });
            qc.invalidateQueries({ queryKey: ["grns"] });
            qc.invalidateQueries({ queryKey: ["stock_movements_all"] });
          }}
        />
      )}
    </div>
  );
}

// ─── PO create/edit modal ────────────────────────────────────────────────
type LineDraft = {
  product_id: string;
  sku: string | null;
  name: string;
  unit: string;
  ordered_qty: string;
  unit_price: string;
  gst_rate: string;
  received_qty: number;
};

type PiLineDraft = {
  product_id: string;
  name: string;
  sku: string | null;
  ordered_qty: number;
  invoice_qty: string;
  unit_price: string;
  gst_rate: string;
};

function POModal({
  userId,
  email,
  po,
  products,
  suppliers,
  lastPrices,
  canWrite,
  canApprove,
  onClose,
  onSaved,
}: {
  userId: string;
  email: string;
  po: PO | null;
  products: CatalogueProduct[];
  suppliers: Array<{ id: string; name: string }>;
  lastPrices: Map<string, number>;
  canWrite: boolean;
  canApprove: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!po;
  const status = po?.status ?? "draft";
  // Lines can only be edited while the PO is still a draft or approved (before
  // any goods have been received / sent to the supplier).
  const editable = !isEdit || status === "draft" || status === "approved";

  const [f, setF] = useState({
    po_date: (po?.po_date ?? new Date().toISOString().slice(0, 10)).slice(0, 10),
    supplier_id: po?.supplier_id ?? "",
    warehouse: po?.warehouse ?? "",
    expected_delivery_date: (po?.expected_delivery_date ?? "")?.slice(0, 10) ?? "",
    payment_terms: po?.payment_terms ?? "",
    // Free-text "Buyer / created by" — new POs default to the signed-in
    // user's email (what the backend used to store); the user can type anything.
    buyer_name: po ? (po.buyer_name ?? "") : email,
    notes: po?.notes ?? "",
    freight: po?.freight != null ? String(po.freight) : "",
  });
  const [lines, setLines] = useState<LineDraft[]>(
    (po?.lines ?? []).map((l) => ({
      product_id: l.product_id,
      sku: l.sku,
      name: l.name,
      unit: l.unit,
      ordered_qty: String(l.ordered_qty),
      unit_price: String(l.unit_price),
      gst_rate: l.gst_rate != null ? String(l.gst_rate) : "",
      received_qty: l.received_qty ?? 0,
    })),
  );
  const [docs, setDocs] = useState<DocMeta[]>(po?.documents ?? []);

  // ── "Create document from this PO" section ──
  // Exactly ONE of {none, proforma, purchase_invoice} can be selected — the
  // proforma and the purchase invoice are mutually exclusive. All entries
  // (supplier, lines, terms) are copied from the PO; only the document header
  // fields are asked for here.
  const [docChoice, setDocChoice] = useState<"none" | "proforma" | "purchase_invoice">("none");
  const [pfForm, setPfForm] = useState({
    proforma_number: "",
    proforma_date: new Date().toISOString().slice(0, 10),
    supplier_id: po?.supplier_id ?? "",
    supplier_contact: "",
    supplier_gstin: "",
    valid_until: "",
    currency: "USD",
    payment_terms: po?.payment_terms ?? "",
    expected_delivery_date: po?.expected_delivery_date ?? "",
    advance_pct: "",
  });
  const [piForm, setPiForm] = useState({
    invoice_number: "",
    invoice_date: new Date().toISOString().slice(0, 10),
    received_date: "",
    due_date: "",
    freight: po?.freight != null ? String(po.freight) : "",
    notes: "",
  });
  // Purchase-invoice lines follow the PO lines until the user edits them.
  const [piLines, setPiLines] = useState<PiLineDraft[]>([]);

  // Select the document to create (radio — mutually exclusive). When picking
  // the purchase invoice, seed its freight from the PO header unless the user
  // has already typed one.
  const chooseDoc = (value: "none" | "proforma" | "purchase_invoice") => {
    setDocChoice(value);
    if (value === "purchase_invoice") {
      setPiForm((p) => (p.freight === "" ? { ...p, freight: f.freight } : p));
    }
  };

  const setLine = (i: number, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const pickProduct = (i: number, id: string) => {
    const p = products.find((x) => x.id === id);
    setLine(i, {
      product_id: id,
      name: p?.name ?? "",
      sku: p?.sku ?? null,
      unit: p?.unit_of_measure ?? "piece",
      unit_price: lastPrices.has(id)
        ? String(lastPrices.get(id))
        : p?.unit_cost != null
          ? String(p.unit_cost)
          : "",
      gst_rate: p?.gst_rate != null ? String(p.gst_rate) : "",
    });
  };

  const addLine = () =>
    setLines((ls) => [
      ...ls,
      {
        product_id: "",
        sku: null,
        name: "",
        unit: "piece",
        ordered_qty: "",
        unit_price: "",
        gst_rate: "",
        received_qty: 0,
      },
    ]);

  const removeLine = (i: number) => {
    const l = lines[i];
    if (l && l.received_qty > 0) {
      toast.error("Cannot remove a line that already has received quantities");
      return;
    }
    setLines((ls) => ls.filter((_, idx) => idx !== i));
  };

  const totals = useMemo(() => {
    const subtotal = round2(
      lines.reduce((s, l) => s + (Number(l.ordered_qty) || 0) * (Number(l.unit_price) || 0), 0),
    );
    const gstTotal = round2(
      lines.reduce(
        (s, l) =>
          s +
          ((Number(l.ordered_qty) || 0) * (Number(l.unit_price) || 0) * (Number(l.gst_rate) || 0)) /
            100,
        0,
      ),
    );
    const freight = Number(f.freight) || 0;
    return { subtotal, gstTotal, freight, grandTotal: round2(subtotal + gstTotal + freight) };
  }, [lines, f.freight]);

  // Advance to be paid on the proforma = proforma total × advance %.
  const advancePctN = Number(pfForm.advance_pct) || 0;
  const advanceAmount = advancePctN > 0 ? round2((totals.grandTotal * advancePctN) / 100) : 0;

  // Purchase-invoice lines follow the PO lines until the user edits them.
  useEffect(() => {
    if (docChoice !== "purchase_invoice") return;
    const poIds = lines.map((l) => l.product_id);
    const needsSync =
      poIds.length !== piLines.length || poIds.some((pid, i) => piLines[i]?.product_id !== pid);
    if (!needsSync) return;
    setPiLines(
      lines.map((l) => ({
        product_id: l.product_id,
        name: l.name,
        sku: l.sku,
        ordered_qty: Number(l.ordered_qty) || 0,
        invoice_qty: String(Number(l.ordered_qty) || 0),
        unit_price: String(Number(l.unit_price) || 0),
        gst_rate: l.gst_rate != null ? String(l.gst_rate) : "",
      })),
    );
  }, [docChoice, lines, piLines]);

  // Invoice totals (billed qty × price from the supplier invoice + freight).
  const piTotals = useMemo(() => {
    let subtotal = 0;
    let gst = 0;
    for (const l of piLines) {
      const qty = Number(l.invoice_qty) || 0;
      const price = Number(l.unit_price) || 0;
      const rate = Number(l.gst_rate) || 0;
      const lt = round2(qty * price);
      subtotal += lt;
      gst += round2((lt * rate) / 100);
    }
    const freight = Number(piForm.freight) || 0;
    return {
      subtotal: round2(subtotal),
      gst: round2(gst),
      freight: round2(freight),
      grandTotal: round2(subtotal + gst + freight),
    };
  }, [piLines, piForm.freight]);

  const save = useMutation({
    mutationFn: async () => {
      if (lines.length === 0) throw new Error("Add at least one product line");
      const payloadLines = lines.map((l) => ({
        product_id: l.product_id,
        sku: l.sku,
        name: l.name,
        unit: l.unit || "piece",
        ordered_qty: Number(l.ordered_qty) || 0,
        unit_price: Number(l.unit_price) || 0,
        gst_rate: l.gst_rate ? Number(l.gst_rate) : null,
      }));
      for (const l of payloadLines) {
        if (!l.product_id) throw new Error("Every line must select a product from the catalogue");
        if (!(l.ordered_qty > 0)) throw new Error("Ordered quantity must be greater than zero");
        if (l.unit_price < 0) throw new Error("Unit price must be greater than or equal to zero");
      }
      // Validate the document step up front so the PO isn't saved only for the
      // document step to fail afterwards.
      if (docChoice === "proforma") {
        if (!pfForm.supplier_id) throw new Error("Select a supplier for the proforma");
        if (!pfForm.proforma_number.trim()) throw new Error("Proforma invoice number is required");
      }
      if (docChoice === "purchase_invoice") {
        if (!f.supplier_id)
          throw new Error("Select a supplier on the PO — it is used for the purchase invoice");
        if (piLines.length === 0)
          throw new Error("Add at least one line from the linked purchase order");
        if (!piForm.invoice_number.trim()) throw new Error("Supplier invoice number is required");
        for (const l of piLines) {
          if (!(Number(l.invoice_qty) > 0)) {
            throw new Error(
              `Invoice quantity must be greater than zero for ${l.name || l.product_id}`,
            );
          }
          if ((Number(l.unit_price) || 0) < 0) {
            throw new Error(
              `Unit price must be greater than or equal to zero for ${l.name || l.product_id}`,
            );
          }
        }
      }
      const payload = {
        po_date: f.po_date,
        supplier_id: f.supplier_id || null,
        supplier_name: f.supplier_id
          ? (suppliers.find((s) => s.id === f.supplier_id)?.name ?? null)
          : null,
        warehouse: f.warehouse.trim() || null,
        expected_delivery_date: f.expected_delivery_date || null,
        payment_terms: f.payment_terms || null,
        buyer_name: f.buyer_name.trim() || null,
        notes: f.notes.trim() || null,
        freight: Number(f.freight) || 0,
        documents: docs,
        lines: payloadLines,
      };
      let savedPo: any;
      if (isEdit && po) {
        await api.goodsPurchaseOrders.update(po.id, payload);
        savedPo = po;
      } else {
        savedPo = await api.goodsPurchaseOrders.create({ ...payload, client_id: userId });
      }

      // Create the selected document from this PO — either a purchase proforma
      // (saved in the Proforma invoices tab, submitted to the checker) or a
      // purchase invoice (recorded in the Purchase invoices tab as a draft).
      // The PO is already saved by this point, so a document failure must not
      // look like the whole save failed (that would tempt a retry and
      // duplicate the PO) — it is surfaced as a distinct warning instead.
      let docError = "";
      if (docChoice === "proforma") {
        try {
          await api.purchaseOrders.create({
            clientId: userId,
            side: "purchase",
            status: "received",
            proformaStatus: "pending_review",
            proformaNumber: pfForm.proforma_number.trim(),
            proformaDate: pfForm.proforma_date,
            vendorId: pfForm.supplier_id,
            supplierContact: pfForm.supplier_contact.trim() || null,
            supplierGstin: pfForm.supplier_gstin.trim() || null,
            validUntil: pfForm.valid_until || null,
            currency: pfForm.currency,
            paymentTerms: pfForm.payment_terms.trim() || null,
            expectedDeliveryDate: pfForm.expected_delivery_date || null,
            poNumber: savedPo?.po_number ?? null,
            amount: totals.grandTotal,
            poAmount: totals.grandTotal,
            advancePct: advancePctN > 0 ? advancePctN : null,
            freight: Number(f.freight) || 0,
            lines: payloadLines.map((l) => ({
              product_id: l.product_id,
              sku: l.sku,
              name: l.name,
              unit: l.unit || "piece",
              quantity: Number(l.ordered_qty) || 0,
              unit_price: Number(l.unit_price) || 0,
              gst_rate: l.gst_rate ? Number(l.gst_rate) : null,
            })),
          });
        } catch (e) {
          docError = e instanceof Error ? e.message : "unknown error";
        }
      } else if (docChoice === "purchase_invoice" && status !== "draft") {
        // The backend only allows invoicing an approved & sent PO — for a
        // draft PO the invoice step is skipped (the inline warning says so).
        try {
          await api.purchaseInvoices.create({
            clientId: userId,
            vendorId: f.supplier_id,
            supplierName: suppliers.find((s) => s.id === f.supplier_id)?.name ?? null,
            invoiceNumber: piForm.invoice_number.trim(),
            issueDate: piForm.invoice_date,
            receivedDate: piForm.received_date || null,
            dueDate: piForm.due_date || null,
            goodsPurchaseOrderId: savedPo.id,
            goodsPoNumber: savedPo?.po_number ?? null,
            // PO reference lets the backend auto-link an existing purchase
            // proforma for this PO and deduct its agreed advance.
            poNumber: savedPo?.po_number ?? null,
            freight: Number(piForm.freight) || 0,
            notes: piForm.notes.trim() || null,
            lines: piLines.map((l) => ({
              productId: l.product_id,
              invoiceQty: Number(l.invoice_qty) || 0,
              unitPrice: Number(l.unit_price) || 0,
              gstRate: l.gst_rate !== "" ? Number(l.gst_rate) : null,
              grnReceivedQty: 0,
            })),
            status: "draft",
          });
        } catch (e) {
          docError = e instanceof Error ? e.message : "unknown error";
        }
      }
      return docError;
    },
    onSuccess: (docError: string) => {
      onSaved();
      qc.invalidateQueries({ queryKey: ["goods-receipts"] }); // last-price lookup
      qc.invalidateQueries({ queryKey: ["proformas"] });
      qc.invalidateQueries({ queryKey: ["purchase_invoices"] });
      if (docError) {
        toast.warning(
          `Purchase order ${isEdit ? "updated" : "created"} — but the ${
            docChoice === "purchase_invoice" ? "purchase invoice" : "proforma"
          } could not be created: ${docError}`,
        );
      } else if (docChoice === "purchase_invoice" && status === "draft") {
        toast.success(
          `${isEdit ? "Purchase order updated" : "Purchase order created"} — approve & send the PO to create the purchase invoice`,
        );
      } else {
        toast.success(
          docChoice === "proforma"
            ? isEdit
              ? "Purchase order updated — proforma created & sent to checker"
              : "Purchase order created — proforma created & sent to checker"
            : docChoice === "purchase_invoice"
              ? isEdit
                ? "Purchase order updated — purchase invoice recorded"
                : "Purchase order created — purchase invoice recorded"
              : isEdit
                ? "Purchase order updated"
                : "Purchase order created",
        );
      }
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const changeStatus = async (next: string) => {
    if (!po) return;
    try {
      await api.goodsPurchaseOrders.update(po.id, { status: next });
      onSaved();
      const msg: Record<string, string> = {
        pending_review: "PO submitted for checker review",
        draft: "PO returned to draft",
      };
      toast.success(msg[next] ?? `PO ${PO_STATUS_LABELS[next] ?? next}`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
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
          <div>
            <h3 className="font-display text-lg">
              {isEdit ? `Purchase order ${po.po_number}` : "New purchase order"}
            </h3>
            {isEdit && (
              <div className="mt-0.5">
                <StatusPill
                  status={status}
                  label={PO_STATUS_LABELS[status] ?? status}
                  tone={PO_STATUS_TONES[status]}
                />
              </div>
            )}
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
              Purchase order header
            </legend>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <L label="PO number">
                <input
                  className="inp"
                  value={isEdit ? po.po_number : ""}
                  disabled
                  placeholder="System-generated"
                />
              </L>
              <L label="PO date">
                <input
                  type="date"
                  className="inp"
                  value={f.po_date}
                  onChange={(e) => setF({ ...f, po_date: e.target.value })}
                  disabled={!editable}
                />
              </L>
              <L label="Supplier">
                <SearchableSelect
                  value={f.supplier_id}
                  onChange={(v) => {
                    setF({ ...f, supplier_id: v });
                    // Keep the proforma supplier in sync with the PO supplier.
                    if (docChoice === "proforma") setPfForm((p) => ({ ...p, supplier_id: v }));
                  }}
                  placeholder="Select supplier…"
                  disabled={!editable}
                  options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                />
              </L>
              <L label="Delivery warehouse / store">
                <input
                  className="inp"
                  value={f.warehouse}
                  onChange={(e) => setF({ ...f, warehouse: e.target.value })}
                  placeholder="e.g. Main store"
                  disabled={!editable}
                />
              </L>
              <L label="Expected delivery date">
                <input
                  type="date"
                  className="inp"
                  value={f.expected_delivery_date}
                  onChange={(e) => setF({ ...f, expected_delivery_date: e.target.value })}
                  disabled={!editable}
                />
              </L>
              <L label="Payment terms">
                <input
                  list="payment-terms"
                  className="inp"
                  value={f.payment_terms}
                  onChange={(e) => setF({ ...f, payment_terms: e.target.value })}
                  placeholder="Net 30"
                  disabled={!editable}
                />
                <datalist id="payment-terms">
                  {PAYMENT_TERMS.filter(Boolean).map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </L>
              <L label="Buyer / created by">
                <input
                  className="inp"
                  value={f.buyer_name}
                  onChange={(e) => setF({ ...f, buyer_name: e.target.value })}
                  placeholder="You"
                  disabled={!editable}
                />
              </L>
            </div>
            <div className="mt-3">
              <L label="Notes">
                <textarea
                  rows={2}
                  className="inp resize-y"
                  value={f.notes}
                  onChange={(e) => setF({ ...f, notes: e.target.value })}
                  placeholder="Delivery instructions, pricing notes…"
                  disabled={!editable}
                />
              </L>
            </div>
            <div className="mt-3">
              <DocumentUploader
                userId={userId}
                scope="purchase_orders"
                docs={docs}
                onChange={setDocs}
                hint="Attach the supplier quotation or proforma invoice."
              />
            </div>
          </fieldset>

          {/* Line items */}
          <fieldset className="rounded-lg border border-border/60 p-4">
            <legend className="px-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Purchase order item lines
            </legend>
            {products.length === 0 ? (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
                No active products in the catalogue yet — add products in the Product catalogue tab
                first.
              </div>
            ) : (
              <div className="space-y-2">
                <div className="hidden grid-cols-12 gap-2 text-[9px] uppercase tracking-widest text-muted-foreground md:grid">
                  <div className="col-span-4">SKU / Product</div>
                  <div className="col-span-1">Unit</div>
                  <div className="col-span-2">Ordered qty</div>
                  <div className="col-span-2">Unit price</div>
                  <div className="col-span-1">GST %</div>
                  <div className="col-span-1 text-right">Line total</div>
                  <div className="col-span-1"></div>
                </div>
                {lines.map((l, i) => {
                  const lineTotal = round2(
                    (Number(l.ordered_qty) || 0) * (Number(l.unit_price) || 0),
                  );
                  const overReceived =
                    editable && l.received_qty > 0 && Number(l.ordered_qty) < l.received_qty;
                  return (
                    <div
                      key={i}
                      className="grid grid-cols-2 items-end gap-2 rounded-md border border-border/50 p-2 md:grid-cols-12"
                    >
                      <div className="col-span-2 md:col-span-4">
                        <L label="Product">
                          <SearchableSelect
                            value={l.product_id}
                            onChange={(v) => pickProduct(i, v)}
                            placeholder="Select product…"
                            disabled={!editable}
                            options={products.map((p) => ({
                              value: p.id,
                              label: p.sku ? `${p.sku} · ${p.name}` : p.name,
                            }))}
                          />
                        </L>
                        {l.name && (
                          <div className="mt-0.5 text-[10px] text-muted-foreground">{l.name}</div>
                        )}
                      </div>
                      <div>
                        <L label="Unit">
                          <input
                            className="inp"
                            value={l.unit}
                            onChange={(e) => setLine(i, { unit: e.target.value })}
                            disabled={!editable}
                          />
                        </L>
                      </div>
                      <div className="md:col-span-2">
                        <L label="Ordered qty">
                          <input
                            type="number"
                            min="1"
                            step="0.001"
                            className={`inp ${overReceived ? "!border-warning" : ""}`}
                            value={l.ordered_qty}
                            onChange={(e) => setLine(i, { ordered_qty: e.target.value })}
                            disabled={!editable}
                          />
                        </L>
                        {overReceived && (
                          <div className="mt-0.5 text-[9px] text-warning">
                            Cannot go below received ({l.received_qty})
                          </div>
                        )}
                      </div>
                      <div className="md:col-span-2">
                        <L label="Unit price">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="inp"
                            value={l.unit_price}
                            onChange={(e) => setLine(i, { unit_price: e.target.value })}
                            disabled={!editable}
                            placeholder={
                              lastPrices.has(l.product_id)
                                ? `Last: ${lastPrices.get(l.product_id)}`
                                : ""
                            }
                          />
                        </L>
                      </div>
                      <div>
                        <L label="GST %">
                          <input
                            list="po-gst-rates"
                            type="number"
                            min="0"
                            step="0.01"
                            className="inp"
                            value={l.gst_rate}
                            onChange={(e) => setLine(i, { gst_rate: e.target.value })}
                            disabled={!editable}
                          />
                        </L>
                      </div>
                      <div className="text-right">
                        <L label="Line total">
                          <div className="inp text-right font-mono tabular-nums">
                            {fmtMoney(lineTotal)}
                          </div>
                        </L>
                      </div>
                      <div className="flex items-end justify-end gap-1 pb-1">
                        {l.received_qty > 0 && (
                          <>
                            <span className="rounded bg-success/10 px-1.5 py-0.5 text-[9px] text-success">
                              recv {l.received_qty}
                            </span>
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
                              pending {Math.max(0, (Number(l.ordered_qty) || 0) - l.received_qty)}
                            </span>
                          </>
                        )}
                        {editable && (
                          <button
                            type="button"
                            onClick={() => removeLine(i)}
                            className="rounded p-1 text-muted-foreground hover:text-destructive"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {editable && (
                  <button
                    type="button"
                    onClick={addLine}
                    className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add line
                  </button>
                )}
              </div>
            )}
          </fieldset>

          {/* Totals */}
          <div className="ml-auto max-w-xs space-y-1 rounded-lg border border-border/60 bg-muted/20 p-4 text-sm">
            <Row
              label="Total quantity"
              value={lines.reduce((s, l) => s + (Number(l.ordered_qty) || 0), 0).toLocaleString()}
            />
            <Row label="Subtotal" value={fmtMoney(totals.subtotal)} />
            <Row label="GST total" value={fmtMoney(totals.gstTotal)} />
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">
                Freight / charges
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                className="inp !w-28 !py-1 text-right"
                value={f.freight}
                onChange={(e) => setF({ ...f, freight: e.target.value })}
                disabled={!editable}
              />
            </div>
            <div className="flex items-center justify-between border-t border-border pt-1.5 font-medium">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">
                Grand total
              </span>
              <span className="num text-base">{fmtMoney(totals.grandTotal)}</span>
            </div>
          </div>

          {/* Create proforma / purchase invoice from this PO — mutually exclusive */}
          <fieldset className="rounded-lg border border-dashed border-primary/40 p-4">
            <legend className="px-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Create document from this PO
            </legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {(
                [
                  {
                    value: "none",
                    title: "Save the PO only",
                    desc: "No proforma or invoice is created.",
                  },
                  {
                    value: "proforma",
                    title: "Purchase proforma",
                    desc: "Saved in the Proforma invoices tab and sent to the checker.",
                  },
                  {
                    value: "purchase_invoice",
                    title: "Purchase invoice",
                    desc: "Recorded in the Purchase invoices tab — never touches stock.",
                  },
                ] as const
              ).map((opt) => (
                <label
                  key={opt.value}
                  className={`flex cursor-pointer items-start gap-2 rounded-md border p-3 text-xs transition ${
                    docChoice === opt.value
                      ? "border-primary bg-primary/10"
                      : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  <input
                    type="radio"
                    name="po-doc-choice"
                    checked={docChoice === opt.value}
                    onChange={() => chooseDoc(opt.value)}
                    disabled={!editable}
                    className="mt-0.5 h-3.5 w-3.5 accent-primary"
                  />
                  <span>
                    <span className="block font-medium">{opt.title}</span>
                    <span className="block text-[10px] leading-snug">{opt.desc}</span>
                  </span>
                </label>
              ))}
            </div>

            {docChoice === "proforma" && (
              <div className="mt-4 space-y-3">
                <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
                  Supplier and line items are copied from this PO.{" "}
                  {advancePctN > 0 ? (
                    <>
                      Calculated advance:{" "}
                      <span className="font-medium text-primary">{fmtMoney(advanceAmount)}</span> (
                      {advancePctN}% of {fmtMoney(totals.grandTotal)}).
                    </>
                  ) : (
                    "Enter an advance % to calculate the advance amount."
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  <L label="Proforma invoice number *">
                    <input
                      className="inp"
                      value={pfForm.proforma_number}
                      onChange={(e) => setPfForm({ ...pfForm, proforma_number: e.target.value })}
                      placeholder="PF-2026-001"
                      disabled={!editable}
                    />
                  </L>
                  <L label="Proforma invoice date">
                    <input
                      type="date"
                      className="inp"
                      value={pfForm.proforma_date}
                      onChange={(e) => setPfForm({ ...pfForm, proforma_date: e.target.value })}
                      disabled={!editable}
                    />
                  </L>
                  <L label="Supplier *">
                    <SearchableSelect
                      value={pfForm.supplier_id}
                      onChange={(v) => setPfForm({ ...pfForm, supplier_id: v })}
                      placeholder="Select supplier…"
                      disabled={!editable}
                      options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                    />
                  </L>
                  <L label="Supplier contact">
                    <input
                      className="inp"
                      value={pfForm.supplier_contact}
                      onChange={(e) => setPfForm({ ...pfForm, supplier_contact: e.target.value })}
                      placeholder="Name · email · phone"
                      disabled={!editable}
                    />
                  </L>
                  <L label="Supplier GSTIN (optional)">
                    <input
                      className="inp"
                      value={pfForm.supplier_gstin}
                      onChange={(e) => setPfForm({ ...pfForm, supplier_gstin: e.target.value })}
                      placeholder="e.g. 27ABCDE1234F1Z5"
                      disabled={!editable}
                    />
                  </L>
                  <L label="Valid until">
                    <input
                      type="date"
                      className="inp"
                      value={pfForm.valid_until}
                      onChange={(e) => setPfForm({ ...pfForm, valid_until: e.target.value })}
                      disabled={!editable}
                    />
                  </L>
                  <L label="Currency">
                    <select
                      className="inp"
                      value={pfForm.currency}
                      onChange={(e) => setPfForm({ ...pfForm, currency: e.target.value })}
                      disabled={!editable}
                    >
                      {PF_CURRENCIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </L>
                  <L label="Payment terms">
                    <input
                      className="inp"
                      value={pfForm.payment_terms}
                      onChange={(e) => setPfForm({ ...pfForm, payment_terms: e.target.value })}
                      placeholder="Net 30"
                      disabled={!editable}
                    />
                  </L>
                  <L label="Expected delivery date">
                    <input
                      type="date"
                      className="inp"
                      value={pfForm.expected_delivery_date}
                      onChange={(e) =>
                        setPfForm({ ...pfForm, expected_delivery_date: e.target.value })
                      }
                      disabled={!editable}
                    />
                  </L>
                </div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  <L label="Advance amount %">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      className="inp"
                      value={pfForm.advance_pct}
                      onChange={(e) => setPfForm({ ...pfForm, advance_pct: e.target.value })}
                      placeholder="e.g. 30"
                      disabled={!editable}
                    />
                  </L>
                  <L label="Proforma total (from PO)">
                    <div className="inp font-mono tabular-nums">{fmtMoney(totals.grandTotal)}</div>
                  </L>
                  <L label="Calculated advance">
                    <div className="inp font-mono tabular-nums text-primary">
                      {fmtMoney(advanceAmount)}
                    </div>
                  </L>
                </div>
              </div>
            )}

            {docChoice === "purchase_invoice" && (
              <div className="mt-4 space-y-3">
                <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
                  Supplier and line items are copied from this PO. The invoice is recorded as a{" "}
                  <span className="font-medium text-foreground">draft</span> in the{" "}
                  <span className="font-medium">Purchase invoices</span> tab — it never creates
                  stock (only a confirmed GRN does).
                </div>
                {status === "draft" && (
                  <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
                    This PO is still a <b>draft</b> — an invoice can only be created once the PO is
                    approved &amp; sent. If it stays a draft, only the PO is saved and you can
                    create the invoice later from the Purchase invoices tab.
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  <L label="Supplier invoice number *">
                    <input
                      className="inp"
                      value={piForm.invoice_number}
                      onChange={(e) => setPiForm({ ...piForm, invoice_number: e.target.value })}
                      placeholder="INV-2026-0142"
                      disabled={!editable}
                    />
                  </L>
                  <L label="Invoice date *">
                    <input
                      type="date"
                      className="inp"
                      value={piForm.invoice_date}
                      onChange={(e) => setPiForm({ ...piForm, invoice_date: e.target.value })}
                      disabled={!editable}
                    />
                  </L>
                  <L label="Invoice received date">
                    <input
                      type="date"
                      className="inp"
                      value={piForm.received_date}
                      onChange={(e) => setPiForm({ ...piForm, received_date: e.target.value })}
                      disabled={!editable}
                    />
                  </L>
                  <L label="Payment due date">
                    <input
                      type="date"
                      className="inp"
                      value={piForm.due_date}
                      onChange={(e) => setPiForm({ ...piForm, due_date: e.target.value })}
                      disabled={!editable}
                    />
                  </L>
                  <L label="Supplier (from PO)">
                    <div className="inp truncate">
                      {f.supplier_id
                        ? (suppliers.find((s) => s.id === f.supplier_id)?.name ?? f.supplier_id)
                        : "Select a supplier on the PO first"}
                    </div>
                  </L>
                  <L label="Freight / charges">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="inp"
                      value={piForm.freight}
                      onChange={(e) => setPiForm({ ...piForm, freight: e.target.value })}
                      disabled={!editable}
                    />
                  </L>
                </div>

                <div className="rounded-md border border-border/60 p-3">
                  <div className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                    Invoice lines — billed qty &amp; price from the supplier invoice (editable)
                  </div>
                  {piLines.length === 0 ? (
                    <div className="text-xs text-muted-foreground">
                      Add at least one product line to the PO above.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="hidden grid-cols-12 gap-2 text-[9px] uppercase tracking-widest text-muted-foreground md:grid">
                        <div className="col-span-5">Product</div>
                        <div className="col-span-2">Invoice qty</div>
                        <div className="col-span-2">Unit price</div>
                        <div className="col-span-1">GST %</div>
                        <div className="col-span-2 text-right">Line total</div>
                      </div>
                      {piLines.map((l, i) => {
                        const qty = Number(l.invoice_qty) || 0;
                        const price = Number(l.unit_price) || 0;
                        const lineTotal = round2(qty * price);
                        return (
                          <div
                            key={i}
                            className="grid grid-cols-2 items-end gap-2 rounded-md border border-border/50 p-2 md:grid-cols-12"
                          >
                            <div className="col-span-2 md:col-span-5">
                              <div className="text-xs font-medium">{l.name}</div>
                              {l.sku && (
                                <div className="font-mono text-[10px] text-muted-foreground">
                                  {l.sku}
                                </div>
                              )}
                            </div>
                            <div className="md:col-span-2">
                              <L label="Qty">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.001"
                                  className="inp"
                                  value={l.invoice_qty}
                                  onChange={(e) =>
                                    setPiLines((ls) =>
                                      ls.map((x, idx) =>
                                        idx === i ? { ...x, invoice_qty: e.target.value } : x,
                                      ),
                                    )
                                  }
                                  disabled={!editable}
                                />
                              </L>
                            </div>
                            <div className="md:col-span-2">
                              <L label="Price">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  className="inp"
                                  value={l.unit_price}
                                  onChange={(e) =>
                                    setPiLines((ls) =>
                                      ls.map((x, idx) =>
                                        idx === i ? { ...x, unit_price: e.target.value } : x,
                                      ),
                                    )
                                  }
                                  disabled={!editable}
                                />
                              </L>
                            </div>
                            <div className="md:col-span-1">
                              <L label="GST">
                                <input
                                  className="inp"
                                  value={l.gst_rate ? `${l.gst_rate}%` : "0%"}
                                  disabled
                                />
                              </L>
                            </div>
                            <div className="text-right md:col-span-2">
                              <L label="Line total">
                                <div className="inp text-right font-mono tabular-nums">
                                  {fmtMoney(lineTotal)}
                                </div>
                              </L>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="ml-auto max-w-xs space-y-1 rounded-lg border border-border/60 bg-muted/20 p-4 text-sm">
                  <Row label="Subtotal" value={fmtMoney(piTotals.subtotal)} />
                  <Row label="GST total" value={fmtMoney(piTotals.gst)} />
                  <Row label="Freight / charges" value={fmtMoney(piTotals.freight)} />
                  <div className="flex items-center justify-between border-t border-border pt-1.5 font-medium">
                    <span className="text-xs uppercase tracking-widest text-muted-foreground">
                      Grand total
                    </span>
                    <span className="num text-base">{fmtMoney(piTotals.grandTotal)}</span>
                  </div>
                </div>

                <div>
                  <L label="Notes">
                    <textarea
                      rows={2}
                      className="inp resize-y"
                      value={piForm.notes}
                      onChange={(e) => setPiForm({ ...piForm, notes: e.target.value })}
                      placeholder="Payment terms, delivery remarks…"
                      disabled={!editable}
                    />
                  </L>
                </div>
              </div>
            )}
          </fieldset>

          {/* Status actions + save */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <div className="flex flex-wrap gap-2">
              {isEdit && canWrite && status === "draft" && (
                <button
                  type="button"
                  onClick={() => changeStatus("pending_review")}
                  className="inline-flex items-center gap-1.5 rounded-md border border-primary/50 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
                >
                  <Send className="h-3.5 w-3.5" /> Submit for review
                </button>
              )}
              {isEdit && status === "pending_review" && canApprove && (
                <>
                  <button
                    type="button"
                    onClick={() => changeStatus("approved")}
                    className="inline-flex items-center gap-1.5 rounded-md border border-success/50 px-3 py-1.5 text-xs font-medium text-success hover:bg-success/10"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => changeStatus("draft")}
                    className="inline-flex items-center gap-1.5 rounded-md border border-destructive/50 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
                  >
                    <X className="h-3.5 w-3.5" /> Reject
                  </button>
                </>
              )}
              {isEdit && status === "approved" && (
                <button
                  type="button"
                  onClick={() => changeStatus("sent")}
                  className="inline-flex items-center gap-1.5 rounded-md border border-primary/50 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
                >
                  <Send className="h-3.5 w-3.5" /> Mark sent
                </button>
              )}
              {isEdit && !["cancelled", "fully_received"].includes(status) && (
                <button
                  type="button"
                  onClick={() => changeStatus("cancelled")}
                  className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
                >
                  <Ban className="h-3.5 w-3.5" /> Cancel PO
                </button>
              )}
              <p className="w-full text-[10px] text-muted-foreground md:w-auto md:self-center">
                Received quantities and the partially/fully received status are updated
                automatically from GRNs.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-border px-4 py-2 text-sm"
              >
                Close
              </button>
              {editable && (
                <button
                  disabled={save.isPending}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
                >
                  {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isEdit ? "Save changes" : "Create PO"}
                </button>
              )}
            </div>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:disabled{opacity:.55}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
        <datalist id="po-gst-rates">
          <option value="0" />
          <option value="5" />
          <option value="12" />
          <option value="18" />
          <option value="28" />
        </datalist>
      </div>
    </div>
  );
}

// ─── GRN modal (receive goods against a PO — creates a DRAFT GRN) ────────
// Per the GRN lifecycle, recording goods creates a draft: inventory is only
// credited when the draft is CONFIRMED (from the Goods received tab or here).
function GRNModal({ po, onClose, onDone }: { po: PO; onClose: () => void; onDone: () => void }) {
  const [received, setReceived] = useState<Record<string, string>>({});
  const [accepted, setAccepted] = useState<Record<string, string>>({});
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [confirming, setConfirming] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      const lines = (po.lines ?? [])
        .map((l) => {
          const qty = received[l.product_id] !== undefined ? Number(received[l.product_id]) : NaN;
          const acc = accepted[l.product_id] !== undefined ? Number(accepted[l.product_id]) : NaN;
          return { l, qty, acc: Number.isFinite(acc) ? acc : Number.isFinite(qty) ? qty : 0 };
        })
        .filter((x) => Number.isFinite(x.qty) && x.qty > 0);
      if (lines.length === 0) throw new Error("Enter a received quantity for at least one line");
      for (const { l, qty, acc } of lines) {
        if (acc > qty) throw new Error(`Accepted cannot exceed received for ${l.name}`);
      }
      await api.goodsReceipts.create({
        goods_purchase_order_id: po.id,
        received_date: receivedDate,
        notes: notes.trim() || null,
        lines: lines.map(({ l, qty, acc }) => ({
          product_id: l.product_id,
          received_qty: qty,
          accepted_qty: acc,
          rejected_qty: Math.max(0, qty - acc),
          unit_cost: l.unit_price,
        })),
      });
    },
    onSuccess: () => {
      toast.success("Draft GRN recorded — confirm it to credit inventory");
      onDone();
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
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <div>
            <h3 className="font-display text-lg">Receive goods — {po.po_number}</h3>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              This creates a draft GRN. Inventory is credited only when the GRN is confirmed (Goods
              received tab).
            </div>
          </div>
          <button onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!confirming) {
              setConfirming(true);
              return;
            }
            save.mutate();
          }}
          className="space-y-4 p-5"
        >
          <div className="grid grid-cols-2 gap-3">
            <L label="Received date">
              <input
                type="date"
                className="inp"
                value={receivedDate}
                onChange={(e) => setReceivedDate(e.target.value)}
              />
            </L>
            <L label="Warehouse / store">
              <input className="inp" value={po.warehouse ?? ""} disabled />
            </L>
          </div>

          <div className="overflow-x-auto rounded-md border border-border/60">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-normal">Product</th>
                  <th className="px-3 py-2 text-right font-normal">Ordered</th>
                  <th className="px-3 py-2 text-right font-normal">Received</th>
                  <th className="px-3 py-2 text-right font-normal">Accepted</th>
                </tr>
              </thead>
              <tbody>
                {(po.lines ?? []).map((l) => {
                  const qty = Number(received[l.product_id] ?? 0) || 0;
                  const acc = Number(accepted[l.product_id] ?? received[l.product_id] ?? 0) || 0;
                  return (
                    <tr key={l.product_id} className="border-b border-border/50">
                      <td className="px-3 py-2">
                        <div className="font-medium">{l.name}</div>
                        {l.sku && (
                          <div className="text-[10px] font-mono text-muted-foreground">{l.sku}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right num">{l.ordered_qty.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          className="inp !w-24 text-right"
                          placeholder="0"
                          value={received[l.product_id] ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            setReceived((r) => ({ ...r, [l.product_id]: v }));
                            // Accepted follows received unless already overridden
                            if (!(l.product_id in accepted)) {
                              setAccepted((a) => ({ ...a, [l.product_id]: v }));
                            }
                          }}
                        />
                        {qty > 0 && acc > qty && (
                          <div className="mt-0.5 text-[9px] text-warning">
                            Accepted exceeds received
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          className="inp !w-24 text-right"
                          placeholder="0"
                          value={accepted[l.product_id] ?? ""}
                          onChange={(e) =>
                            setAccepted((a) => ({ ...a, [l.product_id]: e.target.value }))
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <L label="Notes">
            <textarea
              rows={2}
              className="inp resize-y"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Damages, short-supply remarks…"
            />
          </L>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              disabled={save.isPending}
              className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60 ${
                confirming ? "bg-success" : "bg-primary"
              }`}
            >
              {save.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Truck className="h-4 w-4" />
              )}
              {confirming ? "Save draft GRN" : "Record receipt"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── GRN history modal ────────────────────────────────────────────────────
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

function GRNsModal({
  po,
  grns,
  canWrite,
  canApproveOverReceipt,
  onClose,
  onDeleted,
}: {
  po: PO;
  grns: GRN[];
  canWrite: boolean;
  canApproveOverReceipt: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const qc = useQueryClient();
  const [pendingAction, setPendingAction] = useState<{ id: string; action: string } | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["goods-receipts"] });
    qc.invalidateQueries({ queryKey: ["goods-pos"] });
    qc.invalidateQueries({ queryKey: ["grns"] });
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["stock_movements_all"] });
    onDeleted();
  };

  const confirm = useMutation({
    mutationFn: async (id: string) => {
      await api.goodsReceipts.confirm(id, {
        allow_over_receipt: canApproveOverReceipt,
      });
    },
    onSuccess: () => {
      invalidate();
      setPendingAction(null);
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
      setPendingAction(null);
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
      setPendingAction(null);
      toast.success("Draft GRN deleted");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">Goods received — {po.po_number}</h3>
          <button onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          {grns.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No GRNs recorded for this PO yet.
            </div>
          ) : (
            grns.map((g) => {
              const accValue = (g.lines ?? []).reduce(
                (s, l) => s + (l.accepted_qty ?? l.received_qty) * l.unit_cost,
                0,
              );
              const acc = (g.lines ?? []).reduce(
                (s, l) => s + (l.accepted_qty ?? l.received_qty),
                0,
              );
              const pending = pendingAction?.id === g.id ? pendingAction.action : null;
              return (
                <div key={g.id} className="rounded-lg border border-border/60 p-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold">{g.receipt_number}</span>
                      <span className="text-xs text-muted-foreground">
                        {fmtDate(g.received_date)}
                      </span>
                      <StatusPill
                        status={g.status}
                        label={GRN_STATUS_LABELS[g.status] ?? g.status}
                        tone={GRN_STATUS_TONES[g.status]}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">{fmtMoney(accValue)}</span>
                      {canWrite && g.status === "draft" && (
                        <>
                          <button
                            onClick={() =>
                              pending === "confirm"
                                ? confirm.mutate(g.id)
                                : setPendingAction({ id: g.id, action: "confirm" })
                            }
                            disabled={confirm.isPending}
                            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] ${
                              pending === "confirm"
                                ? "border-success/50 bg-success/10 text-success"
                                : "border-success/50 text-success hover:bg-success/10"
                            }`}
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            {pending === "confirm" ? "Confirm?" : "Confirm"}
                          </button>
                          <button
                            onClick={() =>
                              pending === "cancel"
                                ? cancel.mutate(g.id)
                                : setPendingAction({ id: g.id, action: "cancel" })
                            }
                            disabled={cancel.isPending}
                            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] ${
                              pending === "cancel"
                                ? "border-destructive/50 bg-destructive/10 text-destructive"
                                : "border-border text-muted-foreground hover:border-destructive hover:text-destructive"
                            }`}
                          >
                            <Ban className="h-3 w-3" />
                            {pending === "cancel" ? "Cancel?" : "Cancel"}
                          </button>
                        </>
                      )}
                      {canWrite && g.status === "confirmed" && (
                        <button
                          onClick={() =>
                            pending === "cancel"
                              ? cancel.mutate(g.id)
                              : setPendingAction({ id: g.id, action: "cancel" })
                          }
                          disabled={cancel.isPending}
                          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] ${
                            pending === "cancel"
                              ? "border-destructive/50 bg-destructive/10 text-destructive"
                              : "border-border text-muted-foreground hover:border-destructive hover:text-destructive"
                          }`}
                        >
                          <Ban className="h-3 w-3" />
                          {pending === "cancel" ? "Reverse?" : "Cancel"}
                        </button>
                      )}
                      {canWrite && g.status === "draft" && (
                        <button
                          onClick={() =>
                            pending === "delete"
                              ? del.mutate(g.id)
                              : setPendingAction({ id: g.id, action: "delete" })
                          }
                          disabled={del.isPending}
                          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] ${
                            pending === "delete"
                              ? "border-destructive/50 bg-destructive/10 text-destructive"
                              : "border-border text-muted-foreground hover:border-destructive hover:text-destructive"
                          }`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {pending === "delete" ? "Delete?" : ""}
                        </button>
                      )}
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="py-1 text-left font-normal">Product</th>
                        <th className="py-1 text-right font-normal">Received</th>
                        <th className="py-1 text-right font-normal">Accepted</th>
                        <th className="py-1 text-right font-normal">Unit cost</th>
                        <th className="py-1 text-right font-normal">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(g.lines ?? []).map((l) => (
                        <tr key={l.product_id} className="border-b border-border/40">
                          <td className="py-1.5">
                            {l.name}
                            {l.sku && (
                              <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                                {l.sku}
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 text-right num">
                            {(l.received_qty ?? 0).toLocaleString()}
                          </td>
                          <td className="py-1.5 text-right num text-success">
                            {(l.accepted_qty ?? l.received_qty).toLocaleString()}
                          </td>
                          <td className="py-1.5 text-right num text-muted-foreground">
                            {fmtMoney(l.unit_cost)}
                          </td>
                          <td className="py-1.5 text-right num">
                            {fmtMoney((l.accepted_qty ?? l.received_qty) * l.unit_cost)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {acc > 0 && g.notes && (
                    <div className="mt-2 text-[11px] text-muted-foreground">Note: {g.notes}</div>
                  )}
                </div>
              );
            })
          )}
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

function StatusPill({ status, label, tone }: { status: string; label: string; tone?: string }) {
  const cls = tone ?? PO_STATUS_TONES[status] ?? "bg-muted/60 text-muted-foreground border-border";
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
