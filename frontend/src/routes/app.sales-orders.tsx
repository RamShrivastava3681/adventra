import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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
  Ban,
  Trash2,
  Pencil,
  Truck,
  FileDown,
  Mail,
  Send,
  CheckCircle2,
  CircleDollarSign,
  ShoppingBag,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { DocumentUploader, type DocMeta } from "@/components/document-uploader";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { TableSkeleton } from "@/components/skeletons";

export const Route = createFileRoute("/app/sales-orders")({
  component: SalesOrdersPage,
});

// ─── Types (snake_case — the API transform middleware shapes responses) ───
type SOLine = {
  product_id: string;
  sku: string | null;
  name: string;
  unit: string;
  ordered_qty: number;
  dispatched_qty: number;
  unit_price: number;
  discount_pct: number | null;
  gst_rate: number | null;
  line_total: number;
  notes: string | null;
};

type SO = {
  id: string;
  so_number: string;
  order_date: string;
  customer_id: string | null;
  customer_name: string | null;
  contact_person: string | null;
  billing_address: string | null;
  delivery_address: string | null;
  salesperson_id: string | null;
  salesperson_name: string | null;
  linked_quotation_id: string | null;
  linked_quotation_number: string | null;
  payment_terms: string | null;
  expected_dispatch_date: string | null;
  expected_delivery_date: string | null;
  notes: string | null;
  documents: DocMeta[];
  status: string;
  debtor_approval_status: "pending" | "approved" | "rejected" | null;
  debtor_approval_sent_at: string | null;
  debtor_approval_responded_at: string | null;
  debtor_approval_comments: string | null;
  debtor_approval_email: string | null;
  lines: SOLine[];
  total_qty: number;
  subtotal: number;
  total_discount: number;
  gst_total: number;
  freight: number;
  grand_total: number;
};

type CatalogueProduct = {
  id: string;
  sku: string | null;
  name: string;
  unit_of_measure: string;
  gst_rate: number | null;
  unit_price: number | null;
  unit_cost: number | null;
  status: string;
};

type Customer = {
  id: string;
  name: string;
  contact_name: string | null;
  address_line: string | null;
  city: string | null;
  country: string | null;
  postal_code: string | null;
};

type QuotationLine = {
  product_id: string;
  sku: string | null;
  name: string;
  unit: string;
  quantity: number;
  unit_price: number;
  updated_unit_price: number | null;
  discount_type: "pct" | "amount" | null;
  discount_value: number | null;
  gst_rate: number | null;
  line_total: number;
  notes: string | null;
};

type Quotation = {
  id: string;
  status: string;
  quotation_number: string;
  customer_id: string | null;
  customer_name: string | null;
  contact_person: string | null;
  billing_address: string | null;
  delivery_address: string | null;
  payment_terms: string | null;
  expected_delivery_date: string | null;
  freight: number;
  lines: QuotationLine[];
};

const SO_STATUSES = [
  "draft",
  "pending_review",
  "confirmed",
  "partially_dispatched",
  "fully_dispatched",
  "cancelled",
] as const;

const SO_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_review: "Awaiting checker",
  confirmed: "Confirmed",
  partially_dispatched: "Partially dispatched",
  fully_dispatched: "Fully dispatched",
  cancelled: "Cancelled",
};

const SO_STATUS_TONES: Record<string, string> = {
  draft: "bg-muted/60 text-muted-foreground border-border",
  pending_review:
    "bg-amber-500/10 text-amber-600 border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/40",
  confirmed:
    "bg-blue-500/10 text-blue-600 border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-400 dark:border-blue-500/40",
  partially_dispatched: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  fully_dispatched: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  cancelled: "bg-destructive/10 text-destructive border-destructive/30",
};

// Debtor approval (PDF sent by email — Approve/Reject from the email link).
const SO_DEBTOR_LABELS: Record<string, string> = {
  pending: "Awaiting debtor",
  approved: "Approved by debtor",
  rejected: "Rejected by debtor",
};

const SO_DEBTOR_TONES: Record<string, string> = {
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function SalesOrdersPage() {
  const { user, isSalesRep, isAdmin, isChecker } = useAuth();
  const canWrite = !isSalesRep && !!user;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SO | null>(null);
  const [filter, setFilter] = useState("all");

  const sosQ = useQuery({
    queryKey: ["goods-sos"],
    queryFn: async () => {
      const data = (await api.goodsSalesOrders.list()) as SO[];
      return data.sort((a, b) => (b.order_date || "").localeCompare(a.order_date || ""));
    },
  });

  // Catalogue + customers (debtor master).
  const productsQ = useQuery({
    queryKey: ["products-for-so"],
    queryFn: async () => {
      const data = (await api.products.list()) as CatalogueProduct[];
      return data.filter((p) => p.status === "active");
    },
  });
  const customersQ = useQuery({
    queryKey: ["customers-for-so"],
    queryFn: async () => {
      const data = (await api.debtors.list()) as any[];
      return data
        .map((d) => ({
          id: d.id,
          name: d.name ?? d.id,
          contact_name: d.contact_name ?? null,
          address_line: d.address_line ?? null,
          city: d.city ?? null,
          country: d.country ?? null,
          postal_code: d.postal_code ?? null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)) as Customer[];
    },
  });
  const quotationsQ = useQuery({
    queryKey: ["quotations-for-so"],
    queryFn: async () => {
      const data = (await api.quotations.list()) as Quotation[];
      return data.filter((q) => ["draft", "sent", "accepted"].includes(q.status));
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      await api.goodsSalesOrders.delete(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goods-sos"] });
      toast.success("Sales order deleted");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // Email the sales order PDF to the debtor for their approval.
  const sendToDebtor = useMutation({
    mutationFn: async (id: string) => {
      const res = (await api.goodsSalesOrders.sendToDebtor(id)) as any;
      return res?.sentTo ?? "the debtor";
    },
    onSuccess: (sentTo) => {
      qc.invalidateQueries({ queryKey: ["goods-sos"] });
      toast.success(`Sales order PDF sent to ${sentTo}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const filtered = (sosQ.data ?? []).filter((s) => filter === "all" || s.status === filter);

  const stats = useMemo(() => {
    const sos = sosQ.data ?? [];
    const open = sos.filter((s) => ["draft", "pending_review", "confirmed"].includes(s.status));
    const orderBook = open.reduce((sum, s) => sum + Number(s.grand_total || 0), 0);
    let dispatchedValue = 0;
    for (const s of sos) {
      if (s.status === "cancelled") continue;
      for (const l of s.lines ?? []) dispatchedValue += (l.dispatched_qty ?? 0) * l.unit_price;
    }
    return {
      open: open.length,
      orderBook,
      dispatchedValue,
      fullyDispatched: sos.filter((s) => s.status === "fully_dispatched").length,
    };
  }, [sosQ.data]);

  const customerName = (id: string | null) =>
    (customersQ.data ?? []).find((c: Customer) => c.id === id)?.name ?? null;

  return (
    <div>
      <PageHeader
        eyebrow="Sales"
        title="Sales orders"
        description="A sales order records the customer's confirmed order. It never debits inventory — stock reduces only after a confirmed dispatch."
        icon={<ShoppingBag className="h-5 w-5" />}
        actions={
          canWrite ? (
            <button
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              <Plus className="h-4 w-4" /> New sales order
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
          <StatTile label="Open orders" value={stats.open} icon={ClipboardList} />
          <StatTile
            label="Order book value"
            value={fmtMoney(stats.orderBook)}
            icon={CircleDollarSign}
          />
          <StatTile
            label="Dispatched value"
            value={fmtMoney(stats.dispatchedValue)}
            icon={PackageOpen}
          />
          <StatTile label="Fully dispatched" value={stats.fullyDispatched} icon={PackageCheck} />
        </div>

        <div className="flex flex-wrap gap-2">
          {["all", ...SO_STATUSES].map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`rounded-full border px-3 py-1 text-xs uppercase tracking-widest transition ${
                filter === s
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {s === "all" ? "All" : SO_STATUS_LABELS[s]}
            </button>
          ))}
        </div>

        <Card>
          {sosQ.isLoading ? (
            <TableSkeleton rows={6} cols={8} />
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              <ClipboardList className="mx-auto mb-2 h-8 w-8 opacity-40" />
              No sales orders yet.
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">SO</th>
                    <th className="px-5 py-2 text-left font-normal">Customer</th>
                    <th className="px-5 py-2 text-left font-normal">Dispatch</th>
                    <th className="px-5 py-2 text-right font-normal">Qty</th>
                    <th className="px-5 py-2 text-right font-normal">Grand total</th>
                    <th className="px-5 py-2 text-left font-normal">Dispatched</th>
                    <th className="px-5 py-2 text-left font-normal">Status</th>
                    <th className="px-5 py-2 text-right font-normal">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => {
                    const totalQty = (s.lines ?? []).reduce((sum, l) => sum + l.ordered_qty, 0);
                    const dispatchedQty = (s.lines ?? []).reduce(
                      (sum, l) => sum + (l.dispatched_qty ?? 0),
                      0,
                    );
                    const pct =
                      totalQty > 0
                        ? Math.min(100, Math.round((dispatchedQty / totalQty) * 100))
                        : 0;
                    return (
                      <tr key={s.id} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-3 font-mono text-xs">
                          {s.so_number}
                          <div className="text-[10px] text-muted-foreground">
                            {fmtDate(s.order_date)}
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          {s.customer_name ?? customerName(s.customer_id) ?? "—"}
                          {s.contact_person ? (
                            <div className="text-[10px] text-muted-foreground">
                              {s.contact_person}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-5 py-3 text-xs text-muted-foreground">
                          {s.expected_dispatch_date ? (
                            <>
                              from {fmtDate(s.expected_dispatch_date)}
                              {s.expected_delivery_date ? (
                                <div className="text-[10px]">
                                  to {fmtDate(s.expected_delivery_date)}
                                </div>
                              ) : null}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-5 py-3 text-right num">{totalQty.toLocaleString()}</td>
                        <td className="px-5 py-3 text-right num font-medium">
                          {fmtMoney(s.grand_total)}
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
                              {dispatchedQty}/{totalQty}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <StatusPill
                            status={s.status}
                            label={SO_STATUS_LABELS[s.status] ?? s.status}
                            tone={SO_STATUS_TONES[s.status]}
                          />
                          {s.debtor_approval_status && (
                            <div className="mt-1">
                              <StatusPill
                                status={s.debtor_approval_status}
                                label={
                                  SO_DEBTOR_LABELS[s.debtor_approval_status] ??
                                  s.debtor_approval_status
                                }
                                tone={SO_DEBTOR_TONES[s.debtor_approval_status]}
                              />
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex justify-end gap-1">
                            <button
                              onClick={() => {
                                setEditing(s);
                                setOpen(true);
                              }}
                              className="rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary"
                            >
                              View
                            </button>
                            {canWrite && ["draft", "confirmed"].includes(s.status) && (
                              <button
                                onClick={() => {
                                  setEditing(s);
                                  setOpen(true);
                                }}
                                className="rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary"
                                title="Edit"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                            )}
                            {canWrite &&
                              ["confirmed", "partially_dispatched"].includes(s.status) && (
                                <button
                                  onClick={() =>
                                    navigate({ to: "/app/dispatches", search: { soId: s.id } })
                                  }
                                  className="inline-flex items-center gap-1 rounded-md border border-success/50 px-2 py-1 text-[10px] text-success hover:bg-success/10"
                                >
                                  <Truck className="h-3 w-3" /> Dispatch
                                </button>
                              )}
                            {(s.lines ?? []).some((l) => l.dispatched_qty > 0) && (
                              <button
                                onClick={() =>
                                  navigate({ to: "/app/dispatches", search: { soFilter: s.id } })
                                }
                                className="rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary"
                                title="View dispatches"
                              >
                                <FileDown className="h-3 w-3" />
                              </button>
                            )}
                            {canWrite && s.status === "draft" && (
                              <button
                                onClick={() => del.mutate(s.id)}
                                className="rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:border-destructive hover:text-destructive"
                                title="Delete"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {canWrite && s.status === "confirmed" && (
                              <button
                                onClick={() => sendToDebtor.mutate(s.id)}
                                disabled={sendToDebtor.isPending}
                                className="inline-flex items-center gap-1 rounded-md border border-violet-500/40 px-2 py-1 text-[10px] text-violet-600 hover:bg-violet-500/10 disabled:opacity-50"
                                title="Email the sales order PDF to the debtor for approval"
                              >
                                {sendToDebtor.isPending ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Mail className="h-3 w-3" />
                                )}
                                Send to debtor
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
        <SOModal
          userId={user.id}
          so={editing}
          products={productsQ.data ?? []}
          customers={customersQ.data ?? []}
          quotations={quotationsQ.data ?? []}
          canWrite={canWrite}
          canApprove={isAdmin || isChecker}
          onClose={() => setOpen(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["goods-sos"] });
          }}
        />
      )}
    </div>
  );
}

// ─── SO create/edit modal ────────────────────────────────────────────────
type LineDraft = {
  product_id: string;
  sku: string | null;
  name: string;
  unit: string;
  ordered_qty: string;
  unit_price: string;
  discount_pct: string;
  gst_rate: string;
  notes: string;
  dispatched_qty: number;
};

function SOModal({
  userId,
  so,
  products,
  customers,
  quotations,
  canWrite,
  canApprove,
  onClose,
  onSaved,
}: {
  userId: string;
  so: SO | null;
  products: CatalogueProduct[];
  customers: Customer[];
  quotations: Quotation[];
  canWrite: boolean;
  canApprove: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!so;
  const status = so?.status ?? "draft";
  // Lines can only be edited while the SO is still a draft or confirmed
  // (before anything has been dispatched).
  const editable = !isEdit || status === "draft" || status === "confirmed";

  const [f, setF] = useState({
    order_date: (so?.order_date ?? new Date().toISOString().slice(0, 10)).slice(0, 10),
    customer_id: so?.customer_id ?? "",
    contact_person: so?.contact_person ?? "",
    billing_address: so?.billing_address ?? "",
    delivery_address: so?.delivery_address ?? "",
    linked_quotation_id: so?.linked_quotation_id ?? "",
    linked_quotation_number: so?.linked_quotation_number ?? "",
    payment_terms: so?.payment_terms ?? "",
    expected_dispatch_date: (so?.expected_dispatch_date ?? "")?.slice(0, 10) ?? "",
    expected_delivery_date: (so?.expected_delivery_date ?? "")?.slice(0, 10) ?? "",
    notes: so?.notes ?? "",
    freight: so?.freight != null ? String(so.freight) : "",
  });
  const [lines, setLines] = useState<LineDraft[]>(
    (so?.lines ?? []).map((l) => ({
      product_id: l.product_id,
      sku: l.sku,
      name: l.name,
      unit: l.unit,
      ordered_qty: String(l.ordered_qty),
      unit_price: String(l.unit_price),
      discount_pct: l.discount_pct != null ? String(l.discount_pct) : "",
      gst_rate: l.gst_rate != null ? String(l.gst_rate) : "",
      notes: l.notes ?? "",
      dispatched_qty: l.dispatched_qty ?? 0,
    })),
  );
  const [docs, setDocs] = useState<DocMeta[]>(so?.documents ?? []);

  const setLine = (i: number, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const pickCustomer = (id: string) => {
    const c = customers.find((x) => x.id === id);
    setF((prev) => ({
      ...prev,
      customer_id: id,
      contact_person: c?.contact_name ?? prev.contact_person,
      billing_address: c
        ? [c.address_line, c.city, c.country, c.postal_code].filter(Boolean).join(", ")
        : prev.billing_address,
      delivery_address: c
        ? [c.address_line, c.city, c.country, c.postal_code].filter(Boolean).join(", ")
        : prev.delivery_address,
    }));
  };

  const pickProduct = (i: number, id: string) => {
    const p = products.find((x) => x.id === id);
    setLine(i, {
      product_id: id,
      name: p?.name ?? "",
      sku: p?.sku ?? null,
      unit: p?.unit_of_measure ?? "piece",
      unit_price: p?.unit_price != null ? String(p.unit_price) : "",
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
        discount_pct: "",
        gst_rate: "",
        notes: "",
        dispatched_qty: 0,
      },
    ]);

  const removeLine = (i: number) => {
    const l = lines[i];
    if (l && l.dispatched_qty > 0) {
      toast.error("Cannot remove a line that already has dispatched quantities");
      return;
    }
    setLines((ls) => ls.filter((_, idx) => idx !== i));
  };

  const totals = useMemo(() => {
    const subtotal = round2(
      lines.reduce(
        (s, l) =>
          s +
          (Number(l.ordered_qty) || 0) *
            (Number(l.unit_price) || 0) *
            (1 - (Number(l.discount_pct) || 0) / 100),
        0,
      ),
    );
    const totalDiscount = round2(
      lines.reduce(
        (s, l) =>
          s +
          (Number(l.ordered_qty) || 0) *
            (Number(l.unit_price) || 0) *
            ((Number(l.discount_pct) || 0) / 100),
        0,
      ),
    );
    const gstTotal = round2(
      lines.reduce(
        (s, l) =>
          s +
          (Number(l.ordered_qty) || 0) *
            (Number(l.unit_price) || 0) *
            (1 - (Number(l.discount_pct) || 0) / 100) *
            ((Number(l.gst_rate) || 0) / 100),
        0,
      ),
    );
    const freight = Number(f.freight) || 0;
    return {
      subtotal,
      totalDiscount,
      gstTotal,
      freight,
      grandTotal: round2(subtotal + gstTotal + freight),
    };
  }, [lines, f.freight]);

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
        discount_pct: l.discount_pct ? Number(l.discount_pct) : null,
        gst_rate: l.gst_rate ? Number(l.gst_rate) : null,
        notes: l.notes.trim() || null,
      }));
      for (const l of payloadLines) {
        if (!l.product_id) throw new Error("Every line must select a product from the catalogue");
        if (!(l.ordered_qty > 0)) throw new Error("Ordered quantity must be greater than zero");
        if (l.unit_price < 0)
          throw new Error("Unit selling price must be greater than or equal to zero");
        if (l.discount_pct != null && (l.discount_pct < 0 || l.discount_pct > 100)) {
          throw new Error("Discount must be a percentage between 0 and 100");
        }
      }
      const payload = {
        order_date: f.order_date,
        customer_id: f.customer_id || null,
        customer_name: f.customer_id
          ? (customers.find((c) => c.id === f.customer_id)?.name ?? null)
          : null,
        contact_person: f.contact_person.trim() || null,
        billing_address: f.billing_address.trim() || null,
        delivery_address: f.delivery_address.trim() || null,
        linked_quotation_id: f.linked_quotation_id || null,
        linked_quotation_number: f.linked_quotation_number || null,
        payment_terms: f.payment_terms || null,
        expected_dispatch_date: f.expected_dispatch_date || null,
        expected_delivery_date: f.expected_delivery_date || null,
        notes: f.notes.trim() || null,
        freight: Number(f.freight) || 0,
        documents: docs,
        lines: payloadLines,
      };
      if (isEdit && so) {
        await api.goodsSalesOrders.update(so.id, payload);
      } else {
        await api.goodsSalesOrders.create({ ...payload, client_id: userId });
      }
    },
    onSuccess: () => {
      onSaved();
      toast.success(isEdit ? "Sales order updated" : "Sales order created");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const changeStatus = async (next: string) => {
    if (!so) return;
    try {
      await api.goodsSalesOrders.update(so.id, { status: next });
      onSaved();
      const msg: Record<string, string> = {
        pending_review: "SO submitted for checker review",
        draft: "SO returned to draft",
        confirmed: "SO confirmed",
      };
      toast.success(msg[next] ?? `SO ${SO_STATUS_LABELS[next] ?? next}`);
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
              {isEdit ? `Sales order ${so.so_number}` : "New sales order"}
            </h3>
            {isEdit && (
              <div className="mt-0.5">
                <StatusPill
                  status={status}
                  label={SO_STATUS_LABELS[status] ?? status}
                  tone={SO_STATUS_TONES[status]}
                />
                {so?.debtor_approval_status && (
                  <StatusPill
                    status={so.debtor_approval_status}
                    label={SO_DEBTOR_LABELS[so.debtor_approval_status] ?? so.debtor_approval_status}
                    tone={SO_DEBTOR_TONES[so.debtor_approval_status]}
                  />
                )}
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
              Sales order header
            </legend>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <L label="SO number">
                <input
                  className="inp"
                  value={isEdit ? so.so_number : ""}
                  disabled
                  placeholder="System-generated"
                />
              </L>
              <L label="Order date">
                <input
                  type="date"
                  className="inp"
                  value={f.order_date}
                  onChange={(e) => setF({ ...f, order_date: e.target.value })}
                  disabled={!editable}
                />
              </L>
              <L label="Customer">
                <SearchableSelect
                  value={f.customer_id}
                  onChange={pickCustomer}
                  placeholder="Select customer…"
                  disabled={!editable}
                  options={customers.map((c) => ({ value: c.id, label: c.name }))}
                />
              </L>
              <L label="Contact person">
                <input
                  className="inp"
                  value={f.contact_person}
                  onChange={(e) => setF({ ...f, contact_person: e.target.value })}
                  placeholder="Auto-filled from customer"
                  disabled={!editable}
                />
              </L>
              <L label="Billing address">
                <textarea
                  rows={2}
                  className="inp resize-y"
                  value={f.billing_address}
                  onChange={(e) => setF({ ...f, billing_address: e.target.value })}
                  placeholder="Auto-filled from customer"
                  disabled={!editable}
                />
              </L>
              <L label="Delivery address">
                <textarea
                  rows={2}
                  className="inp resize-y"
                  value={f.delivery_address}
                  onChange={(e) => setF({ ...f, delivery_address: e.target.value })}
                  placeholder="Auto-filled from customer"
                  disabled={!editable}
                />
              </L>
              <L label="Salesperson / owner">
                <input className="inp" value={so?.salesperson_name ?? "You"} disabled />
              </L>
              <L label="Linked quotation">
                <SearchableSelect
                  value={f.linked_quotation_id}
                  onChange={(id) => {
                    const qt = quotations.find((x) => x.id === id);
                    if (!qt) {
                      setF({ ...f, linked_quotation_id: id, linked_quotation_number: "" });
                      return;
                    }
                    // Fetch the quotation's details into the sales order: the
                    // header (customer, addresses, payment terms, freight) and
                    // the line items with the maker's revised price — the
                    // updated unit price wins when the checker approved one.
                    setF((prev) => ({
                      ...prev,
                      linked_quotation_id: id,
                      linked_quotation_number: qt.quotation_number,
                      customer_id: qt.customer_id ?? prev.customer_id,
                      contact_person: qt.contact_person ?? prev.contact_person,
                      billing_address: qt.billing_address ?? prev.billing_address,
                      delivery_address: qt.delivery_address ?? prev.delivery_address,
                      payment_terms: qt.payment_terms ?? prev.payment_terms,
                      expected_delivery_date:
                        qt.expected_delivery_date?.slice(0, 10) ?? prev.expected_delivery_date,
                      freight: qt.freight != null ? String(qt.freight) : prev.freight,
                    }));
                    setLines((existing) =>
                      (qt.lines ?? []).map((l) => {
                        const unitPrice =
                          l.updated_unit_price != null ? l.updated_unit_price : l.unit_price;
                        // SO lines only carry a percentage discount — convert a
                        // flat quotation discount the same way convert does.
                        let discountPct = "";
                        if (l.discount_type === "pct" && l.discount_value != null) {
                          discountPct = String(l.discount_value);
                        } else if (l.discount_type === "amount" && l.discount_value != null) {
                          const gross = (Number(l.quantity) || 0) * unitPrice;
                          if (gross > 0) {
                            discountPct = String(
                              Math.round((l.discount_value / gross) * 100 * 100) / 100,
                            );
                          }
                        }
                        return {
                          product_id: l.product_id,
                          sku: l.sku,
                          name: l.name,
                          unit: l.unit || "piece",
                          ordered_qty: String(l.quantity),
                          unit_price: String(unitPrice),
                          discount_pct: discountPct,
                          gst_rate: l.gst_rate != null ? String(l.gst_rate) : "",
                          notes: l.notes ?? "",
                          // Keep any quantities already dispatched on this line.
                          dispatched_qty:
                            existing.find((x) => x.product_id === l.product_id)?.dispatched_qty ??
                            0,
                        };
                      }),
                    );
                    toast.info(
                      `Copied ${(qt.lines ?? []).length} item${(qt.lines ?? []).length === 1 ? "" : "s"} from ${qt.quotation_number} — prices use the approved quotation price`,
                    );
                  }}
                  placeholder="None"
                  disabled={!editable}
                  options={[
                    { value: "", label: "None" },
                    ...quotations.map((qt) => ({
                      value: qt.id,
                      label: qt.quotation_number,
                      hint: qt.customer_name ?? undefined,
                    })),
                  ]}
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
              <L label="Expected dispatch date">
                <input
                  type="date"
                  className="inp"
                  value={f.expected_dispatch_date}
                  onChange={(e) => setF({ ...f, expected_dispatch_date: e.target.value })}
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
                scope="sales_orders"
                docs={docs}
                onChange={setDocs}
                hint="Attach the customer purchase order or quotation."
              />
            </div>
          </fieldset>

          {/* Line items */}
          <fieldset className="rounded-lg border border-border/60 p-4">
            <legend className="px-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Sales order item lines
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
                  <div className="col-span-1">Ordered qty</div>
                  <div className="col-span-2">Unit price</div>
                  <div className="col-span-1">Disc %</div>
                  <div className="col-span-1">GST %</div>
                  <div className="col-span-1 text-right">Line total</div>
                  <div className="col-span-1"></div>
                </div>
                {lines.map((l, i) => {
                  const gross = (Number(l.ordered_qty) || 0) * (Number(l.unit_price) || 0);
                  const lineTotal = round2(gross * (1 - (Number(l.discount_pct) || 0) / 100));
                  const overDispatched =
                    editable && l.dispatched_qty > 0 && Number(l.ordered_qty) < l.dispatched_qty;
                  return (
                    <div key={i} className="space-y-2 rounded-md border border-border/50 p-2">
                      <div className="grid grid-cols-2 items-end gap-2 md:grid-cols-12">
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
                        <div className="md:col-span-1">
                          <L label="Ordered qty">
                            <input
                              type="number"
                              min="1"
                              step="0.001"
                              className={`inp ${overDispatched ? "!border-warning" : ""}`}
                              value={l.ordered_qty}
                              onChange={(e) => setLine(i, { ordered_qty: e.target.value })}
                              disabled={!editable}
                            />
                          </L>
                          {overDispatched && (
                            <div className="mt-0.5 text-[9px] text-warning">
                              Cannot go below dispatched ({l.dispatched_qty})
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
                              placeholder="Selling price"
                            />
                          </L>
                        </div>
                        <div>
                          <L label="Disc %">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="0.01"
                              className="inp"
                              value={l.discount_pct}
                              onChange={(e) => setLine(i, { discount_pct: e.target.value })}
                              disabled={!editable}
                              placeholder="0"
                            />
                          </L>
                        </div>
                        <div>
                          <L label="GST %">
                            <input
                              list="so-gst-rates"
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
                          {l.dispatched_qty > 0 && (
                            <>
                              <span className="rounded bg-success/10 px-1.5 py-0.5 text-[9px] text-success">
                                dispatched {l.dispatched_qty}
                              </span>
                              <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
                                pending{" "}
                                {Math.max(0, (Number(l.ordered_qty) || 0) - l.dispatched_qty)}
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
                      {editable && (
                        <L label="Line notes">
                          <input
                            className="inp !py-1.5 text-xs"
                            value={l.notes}
                            onChange={(e) => setLine(i, { notes: e.target.value })}
                            placeholder="Optional line note…"
                          />
                        </L>
                      )}
                      {!editable && l.notes ? (
                        <div className="text-[10px] text-muted-foreground">Note: {l.notes}</div>
                      ) : null}
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
            <Row label="Total discount" value={fmtMoney(totals.totalDiscount)} />
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
                    onClick={() => changeStatus("confirmed")}
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
              {isEdit &&
                canWrite &&
                status === "confirmed" &&
                so?.debtor_approval_status !== "rejected" && (
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-violet-600">
                    <Mail className="h-3 w-3" /> The customer confirms via the emailed link
                    {so?.debtor_approval_email ? ` (sent to ${so.debtor_approval_email})` : ""}
                  </span>
                )}
              {isEdit && !["cancelled", "fully_dispatched"].includes(status) && (
                <button
                  type="button"
                  onClick={() => changeStatus("cancelled")}
                  className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
                >
                  <Ban className="h-3.5 w-3.5" /> Cancel order
                </button>
              )}
              <p className="w-full text-[10px] text-muted-foreground md:w-auto md:self-center">
                Dispatched quantities and the partially/fully dispatched status are updated
                automatically from dispatch notes.
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
                  {isEdit ? "Save changes" : "Create SO"}
                </button>
              )}
            </div>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:disabled{opacity:.55}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
        <datalist id="so-gst-rates">
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

// ─── Small helpers (mirror app.purchase-orders.tsx) ─────────────────────
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}

function StatusPill({ status, label, tone }: { status: string; label: string; tone?: string }) {
  const cls = tone ?? SO_STATUS_TONES[status] ?? "bg-muted/60 text-muted-foreground border-border";
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
