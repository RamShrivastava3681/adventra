import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
  Ban,
  Trash2,
  Pencil,
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
import {
  formatPaymentTerms,
  toFormFields as toTermsFormFields,
  toPayload as toTermsPayload,
} from "@/components/payment-terms";
import {
  dispatchConditionLabel,
  termSummary,
} from "@/components/customer-terms";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ProductVariantPicker } from "@/components/product-variant-picker";
import { TableSkeleton } from "@/components/skeletons";
import { TransactionFilters, type TxFiltersConfig } from "@/components/transaction-filters";

export const Route = createFileRoute("/app/sales-orders")({
  component: SalesOrdersPage,
});

const API_URL = import.meta.env.VITE_API_URL || "/api";

async function downloadSalesOrderPdf(id: string, fallbackName: string) {
  const res = await fetch(`${API_URL}/goods-sales-orders/${id}/pdf`, { credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || "Could not download PDF");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const disp = res.headers.get("content-disposition") || "";
  const m = disp.match(/filename="?([^"]+)"?/);
  a.download = m?.[1] ?? `${fallbackName}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

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
  color: string | null;
  size: string | null;
  product_code: string | null;
  mrp: number | null;
  line_total: number;
  notes: string | null;
};

type SO = {
  id: string;
  so_number: string;
  order_date: string;
  created_at: string;
  customer_id: string | null;
  customer_name: string | null;
  contact_person: string | null;
  billing_address: string | null;
  delivery_address: string | null;
  buyer_order_no: string | null;
  reference_no: string | null;
  delivery_note: string | null;
  dispatch_doc_no: string | null;
  dispatched_through: string | null;
  ship_gstin: string | null;
  ship_pan: string | null;
  bill_gstin: string | null;
  bill_pan: string | null;
  remarks: string | null;
  salesperson_id: string | null;
  salesperson_name: string | null;
  payment_terms: string | null;
  payment_term_id?: string | null;
  paymentTermId?: string | null;
  payment_term_name?: string | null;
  paymentTermName?: string | null;
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
  color: string | null;
  size: string | null;
  model: string | null;
  gst_rate: number | null;
  unit_price: number | null;
  unit_cost: number | null;
  mrp: number | null;
  ecommerce_price: number | null;
  retailer_price: number | null;
  distributor_price: number | null;
  flexible_price: number | null;
  status: string;
};

type CustomerAddress = { label: string | null; address: string };

type Customer = {
  id: string;
  name: string;
  contact_name: string | null;
  billing_address: string | null;
  shipping_address: string | null;
  billing_addresses: CustomerAddress[];
  shipping_addresses: CustomerAddress[];
  gstin: string | null;
  pan: string | null;
  city: string | null;
  country: string | null;
  postal_code: string | null;
};

function normAddresses(v: any): CustomerAddress[] {
  if (!v) return [];
  const arr = Array.isArray(v) ? v : [v];
  const out: CustomerAddress[] = [];
  for (const e of arr) {
    if (typeof e === "string") {
      if (e.trim()) out.push({ label: null, address: e.trim() });
    } else if (e && typeof e === "object") {
      const addr = e.address ?? e.address_line ?? "";
      if (typeof addr === "string" && addr.trim())
        out.push({ label: e.label ?? null, address: addr.trim() });
    }
  }
  return out;
}

function addrLabel(a: CustomerAddress, i: number): string {
  const short = a.address.length > 60 ? `${a.address.slice(0, 60)}…` : a.address;
  return `${a.label ? `${a.label} — ` : ""}${short}${i === 0 ? " (primary)" : ""}`;
}

const SO_STATUSES = [
  "draft",
  "pending_review",
  "warehouse_pending",
  "warehouse_approved",
  "checker_pending",
  "confirmed",
  "partially_dispatched",
  "fully_dispatched",
  "cancelled",
] as const;

const SO_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_review: "Awaiting sales review",
  warehouse_pending: "Awaiting warehouse",
  warehouse_approved: "Warehouse approved",
  checker_pending: "Awaiting checker",
  confirmed: "Confirmed",
  partially_dispatched: "Partially dispatched",
  fully_dispatched: "Fully dispatched",
  cancelled: "Cancelled",
};

const SO_STATUS_TONES: Record<string, string> = {
  draft: "bg-muted/60 text-muted-foreground border-border",
  pending_review: "bg-sem-attention/10 text-sem-attention border-sem-attention/30 dark:text-sem-attention",
  warehouse_pending: "bg-sem-attention/10 text-sem-attention border-sem-attention/30 dark:text-sem-attention",
  warehouse_approved: "bg-sem-info/10 text-sem-info border-sem-info/30",
  checker_pending: "bg-sem-attention/10 text-sem-attention border-sem-attention/30 dark:text-sem-attention",
  confirmed:
    "bg-sem-info/10 text-sem-info border-sem-info/30",
  partially_dispatched: "bg-sem-attention/10 text-sem-attention border-sem-attention/30",
  fully_dispatched: "bg-primary-soft text-[#0a4a8a] border-primary/20 dark:text-[#63baff]",
  cancelled: "bg-destructive/10 text-destructive border-destructive/30",
};

// Debtor approval (PDF sent by email — Approve/Reject from the email link).
const SO_DEBTOR_LABELS: Record<string, string> = {
  pending: "Awaiting debtor",
  approved: "Approved by debtor",
  rejected: "Rejected by debtor",
};

const SO_DEBTOR_TONES: Record<string, string> = {
  pending: "bg-primary/10 text-primary border-primary/30",
  approved: "bg-primary-soft text-[#0a4a8a] border-primary/20 dark:text-[#63baff]",
  rejected: "bg-destructive/10 text-destructive border-destructive/30",
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const PRICE_TIERS = [
  { value: "", label: "Default" },
  { value: "mrp", label: "MRP" },
  { value: "ecommerce", label: "E-commerce" },
  { value: "retailer", label: "Retailer" },
  { value: "distributor", label: "Distributor" },
  { value: "flexible", label: "Flexible" },
];

function resolveTierPrice(
  p: CatalogueProduct | undefined | null,
  tier: string,
): string | null {
  if (!p) return null;
  switch (tier) {
    case "mrp": return p.mrp != null ? String(p.mrp) : null;
    case "ecommerce": return p.ecommerce_price != null ? String(p.ecommerce_price) : null;
    case "retailer": return p.retailer_price != null ? String(p.retailer_price) : null;
    case "distributor": return p.distributor_price != null ? String(p.distributor_price) : null;
    case "flexible": return p.flexible_price != null ? String(p.flexible_price) : null;
    default: return null;
  }
}

function SalesOrdersPage() {
  const { user, isSalesRep, isAdmin, isReportingManager } = useAuth();
  const canWrite = !isSalesRep && !!user;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SO | null>(null);
  const [pdfId, setPdfId] = useState<string | null>(null);

  const downloadRowPdf = async (s: SO) => {
    setPdfId(s.id);
    try {
      await downloadSalesOrderPdf(s.id, s.so_number);
      toast.success("PDF downloaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not download PDF");
    } finally {
      setPdfId(null);
    }
  };

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
        .map((d) => {
          const billing_address = d.billing_address ?? d.address_line ?? null;
          const shipping_address = d.shipping_address ?? null;
          let billing_addresses = normAddresses(d.billing_addresses ?? d.billingAddresses);
          if (!billing_addresses.length && billing_address) billing_addresses = [{ label: null, address: billing_address }];
          let shipping_addresses = normAddresses(d.shipping_addresses ?? d.shippingAddresses);
          if (!shipping_addresses.length && shipping_address) shipping_addresses = [{ label: null, address: shipping_address }];
          return {
            id: d.id,
            name: d.name ?? d.id,
            contact_name: d.contact_name ?? null,
            billing_address,
            shipping_address,
            billing_addresses,
            shipping_addresses,
            gstin: d.gstin ?? null,
            pan: d.panCardNo ?? d.pan_card_no ?? null,
            city: d.city ?? null,
            country: d.country ?? null,
            postal_code: d.postal_code ?? null,
          paymentTermsType: d.paymentTermsType ?? d.payment_terms_type ?? null,
          advancePct: d.advancePct ?? d.advance_pct ?? null,
          paymentTermsDays: d.paymentTermsDays ?? d.payment_terms_days ?? null,
          paymentTerms: d.paymentTerms ?? d.payment_terms ?? null,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)) as Customer[];
    },
  });
  const cancel = useMutation({
    mutationFn: async (id: string) => {
      await api.goodsSalesOrders.update(id, { status: "cancelled" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goods-sos"] });
      toast.success("Sales order cancelled");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const soConfig: TxFiltersConfig<SO> = {
    searchPlaceholder: "Search by SO number, customer…",
    search: (s) => [
      s.so_number,
      s.customer_name,
      s.salesperson_name,
      s.contact_person,
    ],
    statusField: (s) => s.status,
    statusLabel: SO_STATUS_LABELS,
    statusOrder: [...SO_STATUSES],
    dateField: (s) => s.order_date,
    dateLabel: "Order date",
    sortFields: [
      { value: "created", label: "Created date", get: (s) => s.created_at },
      { value: "order", label: "Order date", get: (s) => s.order_date },
      { value: "delivery", label: "Delivery date", get: (s) => s.expected_delivery_date },
    ],
    defaultSort: "order-desc",
  };

  const stats = useMemo(() => {
    const sos = sosQ.data ?? [];
    const open = sos.filter((s) => ["draft", "pending_review", "warehouse_pending", "checker_pending", "confirmed"].includes(s.status));
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

        <TransactionFilters data={sosQ.data ?? []} config={soConfig}>
          {(filtered) => (
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
                            <td className="px-5 py-3 text-right num">
                              {totalQty.toLocaleString()}
                            </td>
                            <td className="px-5 py-3 text-right num font-medium">
                              {fmtMoney(s.grand_total)}
                            </td>
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                                  <div
                                    className={`h-full rounded-full ${pct >= 100 ? "bg-sem-success" : "bg-primary"}`}
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
                                <button
                                  onClick={() => downloadRowPdf(s)}
                                  disabled={pdfId === s.id}
                                  title="Download sales order PDF"
                                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary disabled:opacity-60"
                                >
                                  {pdfId === s.id ? (
                                    "…"
                                  ) : (
                                    <>
                                      <FileDown className="h-3 w-3" /> PDF
                                    </>
                                  )}
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
                                {canWrite && !["cancelled", "fully_dispatched"].includes(s.status) && (
                                  <button
                                    onClick={() => cancel.mutate(s.id)}
                                    disabled={cancel.isPending}
                                    className="rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:border-destructive hover:text-destructive"
                                    title="Cancel"
                                  >
                                    Cancel
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
          )}
        </TransactionFilters>
      </div>

      {open && user && (
        <SOModal
          userId={user.id}
          so={editing}
          products={productsQ.data ?? []}
          customers={customersQ.data ?? []}
          canWrite={canWrite}
          canApprove={isAdmin || isReportingManager}
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
  color: string;
  size: string;
  product_code: string;
  mrp: string;
  ordered_qty: string;
  unit_price: string;
  discount_pct: string;
  gst_rate: string;
  notes: string;
  dispatched_qty: number;
  price_tier: string;
};

function SOModal({
  userId,
  so,
  products,
  customers,
  canWrite,
  canApprove,
  onClose,
  onSaved,
}: {
  userId: string;
  so: SO | null;
  products: CatalogueProduct[];
  customers: Customer[];
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
    buyer_order_no: so?.buyer_order_no ?? "",
    reference_no: so?.reference_no ?? "",
    delivery_note: so?.delivery_note ?? "",
    dispatch_doc_no: so?.dispatch_doc_no ?? "",
    dispatched_through: so?.dispatched_through ?? "",
    ship_gstin: so?.ship_gstin ?? "",
    ship_pan: so?.ship_pan ?? "",
    bill_gstin: so?.bill_gstin ?? "",
    bill_pan: so?.bill_pan ?? "",
    remarks: so?.remarks ?? "",
    payment_term_id: (so as any)?.payment_term_id ?? (so as any)?.paymentTermId ?? "",
    ...toTermsFormFields(so),
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
      color: (l as any).color ?? "",
      size: (l as any).size != null ? String((l as any).size) : "",
      product_code: (l as any).product_code ?? "",
      mrp: (l as any).mrp != null ? String((l as any).mrp) : "",
      ordered_qty: String(l.ordered_qty),
      unit_price: String(l.unit_price),
      discount_pct: l.discount_pct != null ? String(l.discount_pct) : "",
      gst_rate: l.gst_rate != null ? String(l.gst_rate) : "",
      notes: l.notes ?? "",
      dispatched_qty: l.dispatched_qty ?? 0,
      price_tier: "",
    })),
  );
  const [docs, setDocs] = useState<DocMeta[]>(so?.documents ?? []);
  const [pdfBusy, setPdfBusy] = useState(false);

  // Approved payment terms for the selected customer (PDF §2). The SO copies
  // the chosen term as a permanent snapshot — master edits never change it.
  const soTermsQ = useQuery({
    queryKey: ["so-customer-terms", f.customer_id],
    queryFn: () => api.debtors.terms.list(f.customer_id),
    enabled: !!f.customer_id,
  });
  const soTerms: any[] = soTermsQ.data ?? [];
  const selectedTerm = soTerms.find((t) => t.id === (f as any).payment_term_id) ?? null;

  // Auto-select the customer's default term for new orders once terms load.
  useEffect(() => {
    if (isEdit || !f.customer_id || (f as any).payment_term_id || soTermsQ.isLoading) return;
    const def = soTerms.find((t) => t.isDefault) ?? soTerms[0] ?? null;
    if (def) {
      setF((prev) => ({
        ...prev,
        payment_term_id: def.id,
        payment_terms_type: def.paymentTermsType ?? def.payment_terms_type ?? "",
        payment_terms_advance_pct: String(def.advancePct ?? def.advance_pct ?? ""),
        payment_terms_days: String(def.balanceDueDays ?? def.balance_due_days ?? "30"),
        payment_terms: def.name ?? prev.payment_terms,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.customer_id, soTermsQ.isLoading]);

  const downloadPdf = async () => {
    if (!so) return;
    setPdfBusy(true);
    try {
      await downloadSalesOrderPdf(so.id, so.so_number);
      toast.success("PDF downloaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not download PDF");
    } finally {
      setPdfBusy(false);
    }
  };

  const setLine = (i: number, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const changePriceTier = (i: number, tier: string) => {
    const line = lines[i];
    const p = products.find((x) => x.id === line.product_id);
    const tierPrice = resolveTierPrice(p, tier);
    setLine(i, {
      price_tier: tier,
      unit_price: tierPrice ?? line.unit_price,
    });
  };

  const pickCustomer = (id: string) => {
    const c = customers.find((x) => x.id === id);
    setF((prev) => ({
      ...prev,
      customer_id: id,
      contact_person: c?.contact_name ?? prev.contact_person,
      billing_address: c?.billing_address ?? prev.billing_address,
      delivery_address: c?.shipping_address ?? c?.billing_address ?? prev.delivery_address,
      // Buyer tax snapshots for the PDF (ship-to and bill-to may differ — editable per order).
      ship_gstin: c?.gstin ?? "",
      ship_pan: c?.pan ?? "",
      bill_gstin: c?.gstin ?? "",
      bill_pan: c?.pan ?? "",
      // Reset the approved-term selection; the effect above auto-selects the
      // new customer's default once its terms load.
      payment_term_id: "",
      // Pre-fill legacy display fields from the debtor master (still editable
      // until the approved terms load and override).
      ...(id
        ? toTermsFormFields(c)
        : { payment_terms_type: "" as const, payment_terms_advance_pct: "", payment_terms: "" }),
    }));
  };

  const pickTerm = (termId: string) => {
    const t = soTerms.find((x) => x.id === termId) ?? null;
    setF((prev) => ({
      ...prev,
      payment_term_id: termId,
      ...(t
        ? {
            payment_terms_type: t.paymentTermsType ?? t.payment_terms_type ?? "",
            payment_terms_advance_pct: String(t.advancePct ?? t.advance_pct ?? ""),
            payment_terms_days: String(t.balanceDueDays ?? t.balance_due_days ?? "30"),
            payment_terms: t.name ?? prev.payment_terms,
          }
        : {}),
    }));
  };

  const pickProduct = (i: number, id: string) => {
    const p = products.find((x) => x.id === id);
    setLine(i, {
      product_id: id,
      name: p?.name ?? "",
      sku: p?.sku ?? null,
      unit: p?.unit_of_measure ?? "piece",
      color: (p as any)?.color ?? "",
      size: (p as any)?.size != null ? String((p as any).size) : "",
      product_code: (p as any)?.model || p?.sku || "",
      mrp: (p as any)?.mrp != null ? String((p as any).mrp) : "",
      unit_price: p?.unit_price != null ? String(p.unit_price) : "",
      gst_rate: p?.gst_rate != null ? String(p.gst_rate) : "",
      price_tier: "",
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
        color: "",
        size: "",
        product_code: "",
        mrp: "",
        ordered_qty: "",
        unit_price: "",
        discount_pct: "",
        gst_rate: "",
        notes: "",
        dispatched_qty: 0,
        price_tier: "",
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
        color: l.color.trim() || null,
        size: l.size.trim() || null,
        product_code: l.product_code.trim() || null,
        mrp: l.mrp ? Number(l.mrp) : null,
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
      if (!f.customer_id) throw new Error("Select a customer");
      if (!(f as any).payment_term_id && soTerms.length > 0)
        throw new Error("Select an approved payment term for this order");
      const payload = {
        order_date: f.order_date,
        customer_id: f.customer_id || null,
        customer_name: f.customer_id
          ? (customers.find((c) => c.id === f.customer_id)?.name ?? null)
          : null,
        contact_person: f.contact_person.trim() || null,
        billing_address: f.billing_address.trim() || null,
        delivery_address: f.delivery_address.trim() || null,
        buyer_order_no: f.buyer_order_no.trim() || null,
        reference_no: f.reference_no.trim() || null,
        delivery_note: f.delivery_note.trim() || null,
        dispatch_doc_no: f.dispatch_doc_no.trim() || null,
        dispatched_through: f.dispatched_through.trim() || null,
        ship_gstin: f.ship_gstin.trim() || null,
        ship_pan: f.ship_pan.trim() || null,
        bill_gstin: f.bill_gstin.trim() || null,
        bill_pan: f.bill_pan.trim() || null,
        remarks: f.remarks.trim() || null,
        paymentTermId: (f as any).payment_term_id || null,
        ...toTermsPayload(f),
        payment_terms: f.payment_terms_type ? formatPaymentTerms({ paymentTermsType: f.payment_terms_type as any, advancePct: Number(f.payment_terms_advance_pct) || null, paymentTermsDays: Number(f.payment_terms_days) || null }) : f.payment_terms || null,
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
        const action = next === "pending_review" ? "submit" : next === "warehouse_pending" ? "approve" : "reject";
        await api.goodsSalesOrders.salesReview(so.id, action);
      onSaved();
      const msg: Record<string, string> = {
        pending_review: "SO submitted for Sales review",
        draft: "SO returned to draft",
        warehouse_pending: "Sales review approved — sent to Warehouse sign-off",
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
                {(() => {
                  const c = customers.find((x) => x.id === f.customer_id);
                  const opts = c?.billing_addresses ?? [];
                  return (
                    <>
                      {editable && opts.length > 1 && (
                        <select
                          className="inp mb-1"
                          value={opts.findIndex((a) => a.address === f.billing_address) >= 0 ? String(opts.findIndex((a) => a.address === f.billing_address)) : "custom"}
                          onChange={(e) => {
                            if (e.target.value === "custom") return;
                            const a = opts[Number(e.target.value)];
                            if (a) setF({ ...f, billing_address: a.address });
                          }}
                        >
                          {opts.map((a, i) => (
                            <option key={i} value={String(i)}>{addrLabel(a, i)}</option>
                          ))}
                          <option value="custom">Custom / edited…</option>
                        </select>
                      )}
                      <textarea
                        rows={2}
                        className="inp resize-y"
                        value={f.billing_address}
                        onChange={(e) => setF({ ...f, billing_address: e.target.value })}
                        placeholder="Auto-filled from customer — pick a saved address or type custom"
                        disabled={!editable}
                      />
                    </>
                  );
                })()}
                {editable && f.customer_id && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => setF({ ...f, billing_address: customers.find((c) => c.id === f.customer_id)?.billing_address ?? "" })}
                      className="rounded text-[10px] border border-border px-2 py-0.5 hover:border-primary hover:text-primary"
                    >
                      Use customer billing
                    </button>
                  </div>
                )}
                <div className="mt-1 grid grid-cols-2 gap-1.5">
                  <input
                    className="inp !py-1.5 !text-xs"
                    value={f.bill_gstin}
                    onChange={(e) => setF({ ...f, bill_gstin: e.target.value })}
                    placeholder="Bill-to GSTIN"
                    disabled={!editable}
                  />
                  <input
                    className="inp !py-1.5 !text-xs"
                    value={f.bill_pan}
                    onChange={(e) => setF({ ...f, bill_pan: e.target.value })}
                    placeholder="Bill-to PAN"
                    disabled={!editable}
                  />
                </div>
              </L>
              <L label="Delivery / shipping address">
                {(() => {
                  const c = customers.find((x) => x.id === f.customer_id);
                  const opts = c?.shipping_addresses?.length ? c.shipping_addresses : (c?.billing_addresses ?? []);
                  return (
                    <>
                      {editable && opts.length > 1 && (
                        <select
                          className="inp mb-1"
                          value={opts.findIndex((a) => a.address === f.delivery_address) >= 0 ? String(opts.findIndex((a) => a.address === f.delivery_address)) : "custom"}
                          onChange={(e) => {
                            if (e.target.value === "custom") return;
                            const a = opts[Number(e.target.value)];
                            if (a) setF({ ...f, delivery_address: a.address });
                          }}
                        >
                          {opts.map((a, i) => (
                            <option key={i} value={String(i)}>{addrLabel(a, i)}</option>
                          ))}
                          <option value="custom">Custom / edited…</option>
                        </select>
                      )}
                      <textarea
                        rows={2}
                        className="inp resize-y"
                        value={f.delivery_address}
                        onChange={(e) => setF({ ...f, delivery_address: e.target.value })}
                        placeholder="Auto-filled from customer — pick a saved address or type custom"
                        disabled={!editable}
                      />
                    </>
                  );
                })()}
                {editable && f.customer_id && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => setF({ ...f, delivery_address: customers.find((c) => c.id === f.customer_id)?.shipping_addresses?.[0]?.address ?? customers.find((c) => c.id === f.customer_id)?.shipping_address ?? customers.find((c) => c.id === f.customer_id)?.billing_address ?? "" })}
                      className="rounded text-[10px] border border-border px-2 py-0.5 hover:border-primary hover:text-primary"
                    >
                      Use customer shipping
                    </button>
                    <button
                      type="button"
                      onClick={() => setF({ ...f, delivery_address: customers.find((c) => c.id === f.customer_id)?.billing_address ?? "" })}
                      className="rounded text-[10px] border border-border px-2 py-0.5 hover:border-primary hover:text-primary"
                    >
                      Use customer billing
                    </button>
                  </div>
                )}
                <div className="mt-1 grid grid-cols-2 gap-1.5">
                  <input
                    className="inp !py-1.5 !text-xs"
                    value={f.ship_gstin}
                    onChange={(e) => setF({ ...f, ship_gstin: e.target.value })}
                    placeholder="Ship-to GSTIN"
                    disabled={!editable}
                  />
                  <input
                    className="inp !py-1.5 !text-xs"
                    value={f.ship_pan}
                    onChange={(e) => setF({ ...f, ship_pan: e.target.value })}
                    placeholder="Ship-to PAN"
                    disabled={!editable}
                  />
                </div>
              </L>
              <L label="Salesperson / owner">
                <input className="inp" value={so?.salesperson_name ?? "You"} disabled />
              </L>
              <L label="Payment terms (approved)">
                {!f.customer_id ? (
                  <div className="text-xs text-muted-foreground">
                    Select a customer first — only its approved terms can be used.
                  </div>
                ) : soTermsQ.isLoading ? (
                  <div className="text-xs text-muted-foreground">Loading approved terms…</div>
                ) : soTerms.length === 0 ? (
                  <div className="text-xs text-destructive">
                    No approved terms for this customer. Add one in Debtors → Edit before
                    creating the order.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <select
                      className="inp"
                      value={(f as any).payment_term_id ?? ""}
                      disabled={!editable}
                      onChange={(e) => pickTerm(e.target.value)}
                    >
                      <option value="">Select approved term…</option>
                      {soTerms
                        .filter((t) => t.isActive !== false)
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                            {t.isDefault ? " — Default" : ""}
                          </option>
                        ))}
                    </select>
                    {selectedTerm ? (
                      <div className="rounded-md bg-muted/40 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                        {termSummary(selectedTerm)} ·{" "}
                        {dispatchConditionLabel(
                          selectedTerm.dispatchCondition ?? selectedTerm.dispatch_condition,
                        )}
                        {isEdit && (
                          <span className="ml-1">
                            · snapshot — changing the term re-snapshots from the master.
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="text-[11px] text-muted-foreground">
                        {(so as any)?.paymentTermName ?? (so as any)?.payment_term_name
                          ? `Snapshot: ${(so as any).paymentTermName ?? (so as any).payment_term_name}`
                          : "Choose the term for this order."}
                      </div>
                    )}
                  </div>
                )}
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
                hint="Attach the customer purchase order."
              />
            </div>
          </fieldset>

          {/* Document references (printed on the PDF header grid) */}
          <fieldset className="rounded-lg border border-border/60 p-4">
            <legend className="px-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Document references — for PDF
            </legend>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <L label="Buyer's order no.">
                <input
                  className="inp"
                  value={f.buyer_order_no}
                  onChange={(e) => setF({ ...f, buyer_order_no: e.target.value })}
                  placeholder="Customer PO number"
                  disabled={!editable}
                />
              </L>
              <L label="Reference no. & date">
                <input
                  className="inp"
                  value={f.reference_no}
                  onChange={(e) => setF({ ...f, reference_no: e.target.value })}
                  placeholder="Ref no. & date"
                  disabled={!editable}
                />
              </L>
              <L label="Delivery note">
                <input
                  className="inp"
                  value={f.delivery_note}
                  onChange={(e) => setF({ ...f, delivery_note: e.target.value })}
                  placeholder="Delivery note ref"
                  disabled={!editable}
                />
              </L>
              <L label="Dispatch doc no.">
                <input
                  className="inp"
                  value={f.dispatch_doc_no}
                  onChange={(e) => setF({ ...f, dispatch_doc_no: e.target.value })}
                  placeholder="Dispatch document"
                  disabled={!editable}
                />
              </L>
              <L label="Dispatched through">
                <input
                  className="inp"
                  value={f.dispatched_through}
                  onChange={(e) => setF({ ...f, dispatched_through: e.target.value })}
                  placeholder="Transporter / courier"
                  disabled={!editable}
                />
              </L>
            </div>
            <div className="mt-3">
              <L label="Remarks (printed above bank details)">
                <textarea
                  rows={2}
                  className="inp resize-y"
                  value={f.remarks}
                  onChange={(e) => setF({ ...f, remarks: e.target.value })}
                  placeholder="Optional remarks for the PDF — leave blank to print nothing"
                  disabled={!editable}
                />
              </L>
            </div>
          </fieldset>

          {/* Line items */}
          <fieldset className="rounded-lg border border-border/60 p-4">
            <legend className="px-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Sales order item lines
            </legend>
            {products.length === 0 ? (
              <div className="rounded-md border border-sem-attention/40 bg-sem-attention/10 p-3 text-xs text-sem-attention">
                No active products in the catalogue yet — add products in the Product catalogue tab
                first.
              </div>
            ) : (
              <div className="space-y-2">
                <div className="hidden grid-cols-12 gap-2 text-[9px] uppercase tracking-widest text-muted-foreground md:grid">
                  <div className="col-span-4">SKU / Product</div>
                  <div className="col-span-1">Unit</div>
                  <div className="col-span-1">Ordered qty</div>
                  <div className="col-span-1">Tier</div>
                  <div className="col-span-1">Unit price</div>
                  <div className="col-span-1">Disc %</div>
                  <div className="col-span-1">GST %</div>
                  <div className="col-span-1 text-right">Line total</div>
                  <div className="col-span-1"></div>
                </div>
                {lines.map((l, i) => {
                  const gross = (Number(l.ordered_qty) || 0) * (Number(l.unit_price) || 0);
                  const lineTotal = round2(gross * (1 - (Number(l.discount_pct) || 0) / 100));
                  const offerUnit = round2((Number(l.unit_price) || 0) * (1 - (Number(l.discount_pct) || 0) / 100));
                  // Print snapshots: line values first, catalogue fallback for old lines.
                  const prod = products.find((x) => x.id === l.product_id) as any;
                  const snapColor = l.color || prod?.color || "";
                  const snapSize = l.size || (prod?.size != null ? String(prod.size) : "");
                  const snapCode = l.product_code || prod?.model || l.sku || "";
                  const snapMrp = l.mrp || (prod?.mrp != null ? String(prod.mrp) : "");
                  const overDispatched =
                    editable && l.dispatched_qty > 0 && Number(l.ordered_qty) < l.dispatched_qty;
                  return (
                    <div key={i} className="space-y-2 rounded-md border border-border/50 p-2">
                      <div className="grid grid-cols-2 items-end gap-2 md:grid-cols-12">
                        <div className="col-span-2 md:col-span-4">
                          <L label="Product">
                            <ProductVariantPicker
                              products={products}
                              value={l.product_id}
                              onChange={(v) => pickProduct(i, v)}
                              disabled={!editable}
                            />
                          </L>
                          {l.name && (
                            <div className="mt-0.5 text-[10px] text-muted-foreground">{l.name}</div>
                          )}
                          {(snapColor || snapSize || snapCode || snapMrp) && (
                            <div className="mt-0.5 text-[10px] text-muted-foreground">
                              {[
                                snapColor || null,
                                snapSize ? `Size ${snapSize}` : null,
                                snapCode ? `Code ${snapCode}` : null,
                                snapMrp ? `MRP ₹${snapMrp}` : null,
                                `Offer ₹${offerUnit.toLocaleString("en-IN")}`,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
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
                              className={`inp ${overDispatched ? "!border-sem-attention" : ""}`}
                              value={l.ordered_qty}
                              onChange={(e) => setLine(i, { ordered_qty: e.target.value })}
                              disabled={!editable}
                            />
                          </L>
                          {overDispatched && (
                            <div className="mt-0.5 text-[9px] text-sem-attention">
                              Cannot go below dispatched ({l.dispatched_qty})
                            </div>
                          )}
                        </div>
                        <div className="md:col-span-1">
                          {l.product_id ? (
                            <L label="Price tier">
                              <select
                                className="inp"
                                value={l.price_tier ?? ""}
                                onChange={(e) => changePriceTier(i, e.target.value)}
                                disabled={!editable}
                              >
                                {PRICE_TIERS.map((t) => (
                                  <option key={t.value} value={t.value}>
                                    {t.label}
                                  </option>
                                ))}
                              </select>
                            </L>
                          ) : null}
                        </div>
                        <div className="md:col-span-1">
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
                              <span className="rounded bg-sem-success/10 px-1.5 py-0.5 text-[9px] text-sem-success">
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
                    onClick={() => changeStatus("warehouse_pending")}
                    className="inline-flex items-center gap-1.5 rounded-md border border-sem-success/50 px-3 py-1.5 text-xs font-medium text-sem-success hover:bg-sem-success/10"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Approve and send to Warehouse
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
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-primary">
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
              {isEdit && (
                <button
                  type="button"
                  onClick={downloadPdf}
                  disabled={pdfBusy}
                  title="Download the Tally-style sales order PDF"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm hover:border-primary hover:text-primary disabled:opacity-60"
                >
                  {pdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                  PDF
                </button>
              )}
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
