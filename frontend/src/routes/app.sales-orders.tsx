import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api-client";
import { inclusiveTotals, exGstPrice } from "@/lib/gst";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import { DocumentStatusStripCompact } from "@/components/document-status-strip";
import { statusLabel, ownerLabel, inventoryImpact, cashImpact } from "@/lib/doc-impact";
import {
  Plus,
  X,
  Loader2,
  ClipboardList,
  PackageCheck,
  PackageOpen,
  Trash2,
  Pencil,
  FileDown,
  Mail,
  Send,
  Layers,
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
import { StateSelect, CitySelect } from "@/components/state-city-select";
import { resolveStandardState, stateForCity } from "@/lib/india-city-state";
import { ProductVariantPicker, fullItemName } from "@/components/product-variant-picker";
import { QuickAddVariantModal } from "@/components/product-quick-create";
import {
  MultiSizeLineCard,
  type MultiSizeLineDraft,
  type SizeDraft,
  emptyMultiSizeLineDraft,
  groupLinesToMultiSizeDrafts,
} from "@/components/multi-size-line-card";
import {
  LineItemsSection,
  lineInputCls,
} from "@/components/doc-lines";
import { TableSkeleton } from "@/components/skeletons";
import { TransactionFilters, type TxFiltersConfig } from "@/components/transaction-filters";
import { useFormDraft, DraftResumeBanner } from "@/lib/form-draft";
import {
  Dialog,
  DialogWithStickyFooter,
  Field,
  TwoFieldGrid,
  inputBase,
  selectBase,
  textareaBase,
} from "@/components/dialog";

export const Route = createFileRoute("/app/sales-orders")({
  component: SalesOrdersPageRoute,
  // Deep links: ?new=1 opens the create form (Sales workbench),
  // ?soId=<id> opens one existing sales order (queue / workbench task).
  validateSearch: (search: Record<string, unknown>): { new?: string; soId?: string } => ({
    new: typeof search.new === "string" ? search.new : undefined,
    soId: typeof search.soId === "string" ? search.soId : undefined,
  }),
});

function SalesOrdersPageRoute() {
  const search = Route.useSearch();
  return <SalesOrdersPage openSo={search.soId} />;
}

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
  customer_type?: string | null;
  customerType?: string | null;
  ship_customer_id?: string | null;
  shipCustomerId?: string | null;
  ship_customer_name?: string | null;
  shipCustomerName?: string | null;
  contact_person: string | null;
  billing_address: string | null;
  delivery_address: string | null;
  /** Delivery state (standardized Indian State/UT name via dropdown). */
  state: string | null;
  /** Delivery city (dependent on state via dropdown). */
  city: string | null;
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
  parent_id?: string | null;
  color: string | null;
  size: string | null;
  category?: string | null;
  subcategory?: string | null;
  brand?: string | null;
  gender?: string | null;
  model: string | null;
  hsn_code?: string | null;
  hsnCode?: string | null;
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

type StockSummaryItem = {
  productId: string;
  totalCompanyStock: number | null;
  locationBreakdown?: Array<{ locationId: string; quantity: number; reservedQuantity: number }>;
};

type CustomerAddress = { label: string | null; address: string; city?: string | null; state?: string | null; postalCode?: string | null };

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
  state?: string | null;
  country: string | null;
  postal_code: string | null;
  customerType?: string | null;
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
      const city = e.city ?? null;
      const state = e.state ?? e.country ?? null;
      const postalCode = e.postalCode ?? e.postal_code ?? e.pin ?? e.pincode ?? null;
      const hasAny =
        (typeof addr === "string" && addr.trim()) ||
        (typeof city === "string" && city.trim()) ||
        (state != null && String(state).trim()) ||
        (postalCode != null && String(postalCode).trim());
      if (hasAny)
        out.push({
          label: e.label ?? null,
          address: typeof addr === "string" ? addr.trim() : "",
          city: typeof city === "string" ? city.trim() || null : null,
          state: state != null ? String(state).trim() || null : null,
          postalCode: postalCode != null ? String(postalCode).trim() || null : null,
        });
    }
  }
  return out;
}

function fullAddr(a: CustomerAddress): string {
  return [a.address, a.city, a.state, a.postalCode].filter(Boolean).join(", ");
}

function addrLabel(a: CustomerAddress, i: number): string {
  const full = fullAddr(a);
  const short = full.length > 60 ? `${full.slice(0, 60)}…` : full;
  return `${a.label ? `${a.label} — ` : ""}${short}`;
}

/** Canonical state name from any stored value (legacy free-text safe). */
function canonState(v: any): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  return resolveStandardState(s) ?? s;
}

/** Delivery city/state fetched from the customer master (shipping first). */
function deliveryCityStateOf(c: any): { city: string; state: string } {
  if (!c) return { city: "", state: "" };
  const ship = (c.shipping_addresses ?? [])[0] as CustomerAddress | undefined;
  const bill = (c.billing_addresses ?? [])[0] as CustomerAddress | undefined;
  const picked = ship ?? bill;
  const city = String(picked?.city ?? c.city ?? "").trim();
  const rawState =
    String(picked?.state ?? "").trim() ||
    String((c as any).state ?? "").trim() ||
    String(c.country ?? "").trim();
  let state = canonState(rawState);
  if (!state && city) state = stateForCity(city) || "";
  return { city, state };
}

/** Billing city/state fetched from the customer master. */
function billingCityStateOf(c: any): { city: string; state: string } {
  if (!c) return { city: "", state: "" };
  const bill = (c.billing_addresses ?? [])[0] as CustomerAddress | undefined;
  const city = String(bill?.city ?? c.city ?? "").trim();
  const rawState =
    String(bill?.state ?? "").trim() ||
    String((c as any).state ?? "").trim() ||
    String(c.country ?? "").trim();
  let state = canonState(rawState);
  if (!state && city) state = stateForCity(city) || "";
  return { city, state };
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
  pending: "Awaiting customer",
  approved: "Approved by customer",
  rejected: "Rejected by customer",
};

const SO_DEBTOR_TONES: Record<string, string> = {
  pending: "bg-primary/10 text-primary border-primary/30",
  approved: "bg-primary-soft text-[#0a4a8a] border-primary/20 dark:text-[#63baff]",
  rejected: "bg-destructive/10 text-destructive border-destructive/30",
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const PRICE_TIERS = [
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
  const anyP = p as any;
  switch (tier) {
    case "mrp": {
      const v = p.mrp ?? anyP.mrp;
      return v != null ? String(v) : null;
    }
    case "ecommerce": {
      const v = p.ecommerce_price ?? anyP.ecommercePrice;
      return v != null ? String(v) : null;
    }
    case "retailer": {
      const v = p.retailer_price ?? anyP.retailerPrice;
      return v != null ? String(v) : null;
    }
    case "distributor": {
      const v = p.distributor_price ?? anyP.distributorPrice;
      return v != null ? String(v) : null;
    }
    case "flexible": {
      const v = p.flexible_price ?? anyP.flexiblePrice;
      return v != null ? String(v) : null;
    }
    case "": {
      const v = p.unit_price ?? anyP.unitPrice;
      return v != null ? String(v) : null;
    }
    default: return null;
  }
}

export const SO_CUSTOMER_TYPES = [
  { value: "Retailer", label: "Retailer (Retailer pricing)", tier: "retailer" },
  { value: "Distributor", label: "Distributor (Distributor pricing)", tier: "distributor" },
  { value: "Dealer", label: "Dealer (Distributor pricing)", tier: "distributor" },
  { value: "Defence", label: "Defence (0% Concessional GST)", tier: "" },
  { value: "Others", label: "Others (Standard pricing)", tier: "" },
];

function getTierForCustomerType(customerType?: string | null): string {
  if (!customerType) return "";
  const s = customerType.toLowerCase().trim();
  if (s === "retailer") return "retailer";
  if (s === "distributor" || s === "dealer") return "distributor";
  if (s === "mrp" || s === "ecommerce" || s === "flexible") return s;
  return "";
}

function resolvePriceForCustomerType(
  p: CatalogueProduct | undefined | null,
  customerType?: string | null,
): string {
  if (!p) return "";
  const anyP = p as any;
  const tier = getTierForCustomerType(customerType);
  if (tier) {
    const tierPrice = resolveTierPrice(p, tier);
    if (tierPrice != null && tierPrice !== "") return tierPrice;
  }
  const fallback = p.unit_price ?? anyP.unitPrice;
  return fallback != null ? String(fallback) : "";
}

export function SalesOrdersPage(
  { openSo, onOpenHandled }: { openSo?: string; onOpenHandled?: () => void } = {},
) {
  const { user, isSalesRep } = useAuth();
  const canWrite = !isSalesRep && !!user;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SO | null>(null);
  const [pdfId, setPdfId] = useState<string | null>(null);

  // Deep link from the Sales Workbench ("+ Create Sales Order"): ?new=1
  // auto-opens the existing create dialog once, then the param is stripped
  // so a page refresh doesn't re-trigger it.
  useEffect(() => {
    if (!canWrite) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "1") {
      params.delete("new");
      const qs = params.toString();
      window.history.replaceState(
        {},
        "",
        window.location.pathname + (qs ? `?${qs}` : ""),
      );
      setOpen(true);
    }
  }, [canWrite]);

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

  // Deep link: queue / workbench task → open that sales order's modal
  // (customer acceptance, stock check, dispatch preparation).
  useEffect(() => {
    if (!openSo) return;
    const found = (sosQ.data ?? []).find((s) => s.id === openSo);
    if (!found) return; // list still loading — retries when data arrives
    setEditing(found);
    setOpen(true);
    onOpenHandled?.();
    try {
      if (window.location.pathname.startsWith("/app/sales-orders")) {
        navigate({ to: "/app/sales-orders", search: {}, replace: true });
      }
    } catch {
      // embedded / no router context — nothing to clear
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSo, sosQ.data]);

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
            state: d.state ?? null,
            country: d.country ?? null,
            postal_code: d.postal_code ?? d.postalCode ?? null,
            customerType: d.customerType ?? d.customer_type ?? null,
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
        description="A sales order records the customer's confirmed order. It never debits inventory — stock reduces only after the dispatch status moves to Dispatched."
        icon={<ShoppingBag className="h-5 w-5" />}
        actions={
          canWrite ? (
            <button
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-[10px] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:-translate-y-px hover:shadow-md"
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

      <div className="mx-auto w-full max-w-[1440px] space-y-6 px-4 py-6 md:px-8 md:py-8">
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
                <div className="-mx-5 overflow-x-auto table-wrap">
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
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-foreground">
                                  {s.customer_name ?? customerName(s.customer_id) ?? "—"}
                                </span>
                                {((s as any).customer_type ?? (s as any).customerType) && (
                                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-semibold text-primary">
                                    {(s as any).customer_type ?? (s as any).customerType}
                                  </span>
                                )}
                              </div>
                              {((s as any).ship_customer_name ?? (s as any).shipCustomerName) &&
                              ((s as any).ship_customer_name ?? (s as any).shipCustomerName) !== (s.customer_name ?? customerName(s.customer_id)) ? (
                                <div className="text-[10px] text-muted-foreground">
                                  Ship: {(s as any).ship_customer_name ?? (s as any).shipCustomerName}
                                </div>
                              ) : null}
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
          sos={sosQ.data ?? []}
          products={productsQ.data ?? []}
          customers={customersQ.data ?? []}
          canWrite={canWrite}
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

const emptyLine = emptyMultiSizeLineDraft;

// Per-customer buyer order sequence: a customer's first order is "001", then
// "002", … Existing trailing-digit formats are honoured (prefix + width of
// the highest number seen). Cancelled orders don't consume numbers.
function computeNextBuyerOrderNo(customerId: string, allSos: SO[] = []): string | null {
  if (!customerId) return null;
  const mine = (allSos ?? []).filter(
    (s) => s.customer_id === customerId && (s.status ?? "") !== "cancelled",
  );
  let max = 0;
  let prefix = "";
  let width = 3;
  for (const s of mine) {
    const raw = (s.buyer_order_no ?? "").trim();
    const match = raw.match(/^(.*?)(\d+)\s*$/);
    if (!match) continue;
    const n = parseInt(match[2], 10) || 0;
    if (n > max) {
      max = n;
      prefix = match[1];
      width = Math.max(3, match[2].length);
    }
  }
  return `${prefix}${String(max + 1).padStart(width, "0")}`;
}

function SOModal({
  userId,
  so,
  sos = [],
  products,
  customers,
  canWrite,
  onClose,
  onSaved,
}: {
  userId: string;
  so: SO | null;
  sos?: SO[];
  products: CatalogueProduct[];
  customers: Customer[];
  canWrite: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!so;
  const status = so?.status ?? "draft";
  // Lines can only be edited while the SO is still a draft or confirmed
  // (before anything has been dispatched).
  const editable = !isEdit || status === "draft" || status === "confirmed";

  const stockCheckQ = useQuery({
    queryKey: ["so_stock_check", so?.id],
    queryFn: () => (so?.id ? api.goodsSalesOrders.checkStock(so.id) : null),
    enabled: !!(isEdit && so?.id),
  });

  // Live available stock per product (total company stock), used to block
  // creating/editing a sales order when ordered qty exceeds inventory.
  const stockSummaryQ = useQuery({
    queryKey: ["so_stock_summary"],
    queryFn: async () => api.stockSummary.list(),
  });

  const stockBalance = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of (stockSummaryQ.data ?? []) as StockSummaryItem[]) {
      map.set(s.productId, Number(s.totalCompanyStock ?? 0));
    }
    return map;
  }, [stockSummaryQ.data]);

  const [f, setF] = useState({
    order_date: (so?.order_date ?? new Date().toISOString().slice(0, 10)).slice(0, 10),
    customer_id: so?.customer_id ?? "",
    customer_type:
      (so as any)?.customerType ??
      (so as any)?.customer_type ??
      customers.find((c) => c.id === so?.customer_id)?.customerType ??
      "",
    ship_customer_id: (so as any)?.ship_customer_id ?? (so as any)?.shipCustomerId ?? "",
    same_as_billing: (() => {
      const ship = (so as any)?.ship_customer_id ?? (so as any)?.shipCustomerId ?? null;
      if (!so) return true;
      if (!ship) return true;
      return ship === so.customer_id;
    })(),
    contact_person: so?.contact_person ?? "",
    billing_address: so?.billing_address ?? "",
    delivery_address: so?.delivery_address ?? "",
    state: ((so as any)?.state ?? "").trim(),
    city: ((so as any)?.city ?? "").trim(),
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
  // The buyer order number runs per customer (first order 001, then 002, …)
  // and is filled when the billing customer is picked (see
  // pickBillingCustomer). It stays editable afterwards, and the server
  // auto-assigns one on save when left blank.
  const [lines, setLines] = useState<MultiSizeLineDraft[]>(() =>
    groupLinesToMultiSizeDrafts(so?.lines ?? [], products)
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
        payment_terms_type: def.paymentTermsType ?? def.payment_terms_type ?? "credit",
        payment_terms_advance_pct: String(def.advancePct ?? def.advance_pct ?? ""),
        // Delivery-based terms carry no balance days — the due date is computed
        // from the invoice date entered by the user, never from delivery.
        payment_terms_days:
          (def.paymentTermsType ?? def.payment_terms_type) === "on_delivery" ||
          (def.paymentTermsType ?? def.payment_terms_type) === "advance_partial"
            ? "0"
            : String(def.balanceDueDays ?? def.balance_due_days ?? "30"),
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

  const setLine = (i: number, patch: Partial<MultiSizeLineDraft>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const changePriceTier = (i: number, tier: string) => {
    const line = lines[i];
    const p = products.find((x) => x.id === line.product_id);
    const tierPrice = resolveTierPrice(p, tier);
    const resolved = tierPrice ?? (tier === "" ? (p?.unit_price != null ? String(p.unit_price) : "") : "");
    setLine(i, {
      price_tier: tier,
      sizes: line.sizes.map((s) => ({ ...s, unitPrice: resolved || s.unitPrice })),
    });
  };

  const handleCustomerTypeChange = (newType: string) => {
    setF((prev) => ({ ...prev, customer_type: newType }));
    const isDef = newType?.toLowerCase() === "defence";
    const tier = getTierForCustomerType(newType);

    setLines((prev) =>
      prev.map((l) => {
        if (!l.product_id) return l;
        const p = products.find((x) => x.id === l.product_id);
        const tierPrice = resolvePriceForCustomerType(p, newType);
        return {
          ...l,
          price_tier: tier || l.price_tier,
          sizes: l.sizes.map((s) => ({
            ...s,
            unitPrice: tierPrice || s.unitPrice,
            gstRate: isDef ? "0" : (p?.gst_rate != null ? String(p.gst_rate) : s.gstRate),
          })),
        };
      }),
    );
    if (newType) {
      toast.info(`Pricing updated for ${newType} tier`);
    }
  };

  // Live address books, one per side (see loadSoAddrs below). The billing
  // customer drives contact + billing address + tax + payment terms; the
  // shipping customer drives only the delivery address + ship tax.
  const [billAddrBook, setBillAddrBook] = useState<CustomerAddress[] | null>(null);
  const [billAddrFor, setBillAddrFor] = useState<string>("");
  const [shipAddrBook, setShipAddrBook] = useState<CustomerAddress[] | null>(null);
  const [shipAddrFor, setShipAddrFor] = useState<string>("");

  const pickBillingCustomer = (id: string) => {
    const c = customers.find((x) => x.id === id);
    const nextBuyerNo = computeNextBuyerOrderNo(id, sos);
    const custType = c?.customerType ?? f.customer_type ?? "";
    // Confirm against the server (it sees just-saved drafts the local list
    // may miss) and prefer its number when it disagrees — unless the user
    // has since typed a custom value.
    if (id && !isEdit && nextBuyerNo) {
      api.goodsSalesOrders
        .nextBuyerOrderNo(id)
        .then((r) => {
          const serverNo = r?.buyerOrderNo?.trim();
          if (!serverNo || serverNo === nextBuyerNo) return;
          setF((prev) =>
            prev.customer_id === id && prev.buyer_order_no === nextBuyerNo
              ? { ...prev, buyer_order_no: serverNo }
              : prev,
          );
        })
        .catch(() => {
          /* local suggestion stands; the server assigns on save anyway */
        });
    }
    setBillAddrBook(null);
    setBillAddrFor("");
    const delivery = deliveryCityStateOf(c);
    setF((prev) => {
      const same = (prev as any).same_as_billing !== false;
      return {
        ...prev,
        customer_id: id,
        customer_type: custType,
        buyer_order_no: (!prev.buyer_order_no?.trim() && nextBuyerNo) ? nextBuyerNo : prev.buyer_order_no,
        contact_person: c?.contact_name ?? prev.contact_person,
        billing_address: c?.billing_address ?? prev.billing_address,
        // Buyer tax snapshot for the BILL TO block (editable per order).
        bill_gstin: c?.gstin ?? "",
        bill_pan: c?.pan ?? "",
        // Delivery city/state fetched from the customer master.
        ...(delivery.city || delivery.state
          ? { city: delivery.city || prev.city, state: delivery.state || prev.state }
          : {}),
        // When shipping follows billing, mirror the billing party across.
        ...(same
          ? {
              ship_customer_id: id,
              delivery_address: c?.shipping_address ?? c?.billing_address ?? prev.delivery_address,
              ship_gstin: c?.gstin ?? "",
              ship_pan: c?.pan ?? "",
            }
          : {}),
        // Reset the approved-term selection; the effect above auto-selects the
        // new customer's default once its terms load.
        payment_term_id: "",
        // Pre-fill legacy display fields from the customer master (still editable
        // until the approved terms load and override).
        ...(id
          ? toTermsFormFields(c)
          : { payment_terms_type: "credit" as const, payment_terms_advance_pct: "", payment_terms_days: "30" }),
      };
    });
      if (id) {
      const isDef = custType?.toLowerCase() === "defence";
      const tier = getTierForCustomerType(custType);
      setLines((prev) =>
        prev.map((l) => {
          if (!l.product_id) return l;
          const p = products.find((x) => x.id === l.product_id);
          const tierPrice = resolvePriceForCustomerType(p, custType);
          return {
            ...l,
            price_tier: tier || l.price_tier,
            sizes: l.sizes.map((s) => ({
              ...s,
              unitPrice: tierPrice || s.unitPrice,
              gstRate: isDef ? "0" : (p?.gst_rate != null ? String(p.gst_rate) : s.gstRate),
            })),
          };
        }),
      );
      if (c && (c.billing_addresses?.length ?? 0) > 1) {
        setBillAddrBook(c.billing_addresses ?? []);
        setBillAddrFor(id);
      }
      loadSoAddrs(id, true, "billing");
      if ((f as any).same_as_billing !== false) {
        if (c && (c.shipping_addresses?.length ?? 0) > 1) {
          setShipAddrBook(c.shipping_addresses ?? []);
          setShipAddrFor(id);
        }
        loadSoAddrs(id, true, "shipping");
      }
    }
  };

  const pickShippingCustomer = (id: string) => {
    const c = customers.find((x) => x.id === id);
    setShipAddrBook(null);
    setShipAddrFor("");
    const delivery = deliveryCityStateOf(c);
    setF((prev) => ({
      ...prev,
      ship_customer_id: id,
      delivery_address: c?.shipping_address ?? c?.billing_address ?? prev.delivery_address,
      // Buyer tax snapshot for the SHIP TO block (editable per order).
      ship_gstin: c?.gstin ?? "",
      ship_pan: c?.pan ?? "",
      // Delivery city/state fetched from the shipping customer master.
      ...(delivery.city || delivery.state
        ? { city: delivery.city || prev.city, state: delivery.state || prev.state }
        : {}),
    }));
    if (id) {
      if (c && (c.shipping_addresses?.length ?? 0) > 1) {
        setShipAddrBook(c.shipping_addresses ?? []);
        setShipAddrFor(id);
      }
      loadSoAddrs(id, true, "shipping");
    }
  };

  const toggleSameAsBilling = (on: boolean) => {
    setF((prev) => {
      if (on) {
        const c = customers.find((x) => x.id === prev.customer_id);
        const delivery = deliveryCityStateOf(c);
        return {
          ...prev,
          same_as_billing: true,
          ship_customer_id: prev.customer_id,
          delivery_address:
            c?.shipping_address ?? c?.billing_address ?? prev.delivery_address,
          ship_gstin: c?.gstin ?? (prev as any).bill_gstin ?? prev.ship_gstin,
          ship_pan: c?.pan ?? (prev as any).bill_pan ?? prev.ship_pan,
          ...(delivery.city || delivery.state
            ? { city: delivery.city || prev.city, state: delivery.state || prev.state }
            : {}),
        };
      }
      return { ...prev, same_as_billing: false, ship_customer_id: "" };
    });
    if (on && f.customer_id) loadSoAddrs(f.customer_id, true, "shipping");
    else {
      setShipAddrBook(null);
      setShipAddrFor("");
    }
  };

  // Live address book for a customer side — fetched from the master so
  // newly added billing/shipping addresses are always choosable, even when
  // the cached customer list is stale.
  const loadSoAddrs = async (id: string, overwrite: boolean, side: "billing" | "shipping") => {
    if (!id) return;
    try {
      const d = await api.debtors.get(id);
      let billing = normAddresses(d?.billing_addresses ?? d?.billingAddresses);
      const primaryBilling = d?.billing_address ?? d?.billingAddress ?? d?.address_line ?? d?.addressLine ?? "";
      if (!billing.length && primaryBilling) billing = [{ label: null, address: String(primaryBilling) }];
      let shipping = normAddresses(d?.shipping_addresses ?? d?.shippingAddresses);
      const primaryShipping = d?.shipping_address ?? d?.shippingAddress ?? "";
      if (!shipping.length && primaryShipping) shipping = [{ label: null, address: String(primaryShipping) }];
      if (!billing.length && !shipping.length) return;
      const cid = id;
      if (side === "billing") {
        if (billing.length) {
          setBillAddrBook(billing);
          setBillAddrFor(cid);
        }
        if (overwrite && billing[0]) {
          setF((prev) =>
            prev.customer_id === cid
              ? { ...prev, billing_address: fullAddr(billing[0]) }
              : prev,
          );
        }
      } else {
        const opts = shipping.length ? shipping : billing;
        if (opts.length) {
          setShipAddrBook(opts);
          setShipAddrFor(cid);
        }
        if (overwrite && opts[0]) {
          const first = opts[0] as CustomerAddress;
          const city = String((first as any).city ?? "").trim();
          const rawState = String((first as any).state ?? "").trim();
          const state = canonState(rawState) || (city ? stateForCity(city) || "" : "");
          setF((prev) =>
            (prev as any).ship_customer_id === cid ||
            ((prev as any).same_as_billing !== false && prev.customer_id === cid)
              ? {
                  ...prev,
                  delivery_address: fullAddr(opts[0]),
                  ...(city || state
                    ? { city: city || prev.city, state: state || prev.state }
                    : {}),
                }
              : prev,
          );
        }
      }
      if (overwrite) {
        const n = side === "billing" ? billing.length : Math.max(shipping.length, billing.length);
        if (n > 1) toast.success(`Fetched ${n} addresses from ${d?.name ?? "customer"}`);
      }
    } catch {
      // Fall back to the cached list — dropdowns keep working off it.
    }
  };

  // Edit mode: load address options for both linked customers (no overwrite —
  // the saved addresses on the order win).
  useEffect(() => {
    if (isEdit && f.customer_id && billAddrFor !== f.customer_id) loadSoAddrs(f.customer_id, false, "billing");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, f.customer_id]);
  useEffect(() => {
    const sid = (f as any).ship_customer_id as string;
    if (isEdit && sid && shipAddrFor !== sid) loadSoAddrs(sid, false, "shipping");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, (f as any).ship_customer_id]);

  const pickTerm = (termId: string) => {
    const t = soTerms.find((x) => x.id === termId) ?? null;
    setF((prev) => ({
      ...prev,
      payment_term_id: termId,
      ...(t
        ? {
            payment_terms_type: t.paymentTermsType ?? t.payment_terms_type ?? "credit",
            payment_terms_advance_pct: String(t.advancePct ?? t.advance_pct ?? ""),
            // Delivery-based terms carry no balance days — the due date is
            // computed from the invoice date entered by the user.
            payment_terms_days:
              (t.paymentTermsType ?? t.payment_terms_type) === "on_delivery" ||
              (t.paymentTermsType ?? t.payment_terms_type) === "advance_partial"
                ? "0"
                : String(t.balanceDueDays ?? t.balance_due_days ?? "30"),
          }
        : {}),
    }));
  };

  const addLine = () => {
    const currentCust = customers.find((x) => x.id === f.customer_id);
    const activeType = f.customer_type || currentCust?.customerType || (so as any)?.customerType || "";
    const tier = getTierForCustomerType(activeType);
    setLines((ls) => [
      ...ls,
      {
        ...emptyLine(),
        price_tier: tier,
      },
    ]);
  };

  const removeLine = (i: number) => {
    const l = lines[i];
    if (l && l.dispatched_qty && l.dispatched_qty > 0) {
      toast.error("Cannot remove a line that already has dispatched quantities");
      return;
    }
    setLines((ls) => ls.filter((_, idx) => idx !== i));
  };

  const totals = useMemo(() => {
    // Catalogue prices are GST-inclusive: the line amounts add up to the order
    // total as entered, with GST shown as the part already inside them.
    const totalDiscount = round2(
      lines.reduce(
        (s, l) =>
          s +
          l.sizes.reduce(
            (sz, size) =>
              sz +
              (Number(size.quantity) || 0) *
                (Number(size.unitPrice) || 0) *
                ((Number(size.discountPct) || 0) / 100),
            0,
          ),
        0,
      ),
    );
    const billed = inclusiveTotals(
      lines.flatMap((l) =>
        l.sizes.map((size) => ({
          amount:
            (Number(size.quantity) || 0) *
            (Number(size.unitPrice) || 0) *
            (1 - (Number(size.discountPct) || 0) / 100),
          gstRate: size.gstRate,
        })),
      ),
      Number(f.freight) || 0,
    );
    return {
      subtotal: billed.subtotal,
      totalDiscount,
      gstTotal: billed.gstTotal,
      freight: billed.freight,
      grandTotal: billed.grandTotal,
    };
  }, [lines, f.freight]);

  // Payload builder shared by manual save and auto-save drafts: throws while
  // the form is not yet submittable (auto-save treats that as "browser only").
  const buildPayload = () => {
      if (lines.length === 0) throw new Error("Add at least one product line");
      const payloadLines: Array<{
        product_id: string;
        sku: string | null;
        name: string;
        unit: string;
        color: string | null;
        size: string | null;
        product_code: string | null;
        hsn_code: string | null;
        mrp: number | null;
        ordered_qty: number;
        unit_price: number;
        discount_pct: number | null;
        gst_rate: number | null;
        notes: string | null;
      }> = [];
      for (const l of lines) {
        if (!l.sizes || l.sizes.length === 0) {
          // Empty line (no sizes) — still validated below.
          payloadLines.push({
            product_id: l.product_id,
            sku: l.sku,
            name: l.name,
            unit: l.unit || "piece",
            color: l.color.trim() || null,
            size: null,
            product_code: l.product_code.trim() || null,
            hsn_code: l.hsn_code.trim() || null,
            mrp: l.mrp ? Number(l.mrp) : null,
            ordered_qty: 0,
            unit_price: 0,
            discount_pct: null,
            gst_rate: null,
            notes: l.notes.trim() || null,
          });
          continue;
        }
        for (const s of l.sizes) {
          payloadLines.push({
            product_id: s.childProductId,
            sku: s.childSku,
            name: s.childName || l.name,
            unit: s.unit || l.unit || "piece",
            color: l.color.trim() || null,
            size: s.size.trim() || null,
            product_code: l.product_code.trim() || null,
            hsn_code: s.hsnCode || l.hsn_code,
            mrp: s.mrp ? Number(s.mrp) : null,
            ordered_qty: Number(s.quantity) || 0,
            unit_price: Number(s.unitPrice) || 0,
            discount_pct: s.discountPct ? Number(s.discountPct) : null,
            gst_rate: s.gstRate ? Number(s.gstRate) : null,
            notes: l.notes.trim() || null,
          });
        }
      }
      for (const l of payloadLines) {
        if (!l.product_id) throw new Error("Every line must select a product from the catalogue");
        if (!(l.ordered_qty > 0)) throw new Error("Ordered quantity must be greater than zero");
        if (l.unit_price < 0)
          throw new Error("Unit selling price must be greater than or equal to zero");
        if (l.discount_pct != null && (l.discount_pct < 0 || l.discount_pct > 100)) {
          throw new Error("Discount must be a percentage between 0 and 100");
        }
      }
      // Block creation/edit when ordered qty exceeds available inventory.
      const short: string[] = [];
      for (const l of payloadLines) {
        if (!l.product_id) continue;
        const available = stockBalance.get(l.product_id) ?? 0;
        if (l.ordered_qty > 0 && l.ordered_qty > available) {
          const p = products.find((x) => x.id === l.product_id);
          short.push(`${l.name ?? p?.name ?? l.product_id}: ordered ${l.ordered_qty}, available ${available}`);
        }
      }
      if (short.length > 0) throw new Error("Insufficient inventory — " + short.join("; "));
      if (!f.customer_id) throw new Error("Select a billing customer");
      const sameAsBilling = (f as any).same_as_billing !== false;
      const shipId = sameAsBilling ? f.customer_id : ((f as any).ship_customer_id as string);
      if (!sameAsBilling && !shipId) throw new Error("Select a shipping customer or tick “Same as billing”");
      if (!(f as any).payment_term_id && soTerms.length > 0)
        throw new Error("Select an approved payment term for this order");
      const shipCustomer = shipId ? customers.find((c) => c.id === shipId) : null;
      const payload = {
        order_date: f.order_date,
        customer_id: f.customer_id || null,
        customer_name: f.customer_id
          ? (customers.find((c) => c.id === f.customer_id)?.name ?? null)
          : null,
        customerType: f.customer_type || null,
        ship_customer_id: shipId || null,
        ship_customer_name: shipId ? (shipCustomer?.name ?? null) : null,
        contact_person: f.contact_person.trim() || null,
        billing_address: f.billing_address.trim() || null,
        delivery_address: f.delivery_address.trim() || null,
        state: (f.state ?? "").trim() || null,
        city: (f.city ?? "").trim() || null,
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
        payment_terms: formatPaymentTerms({ paymentTermsType: f.payment_terms_type as any, advancePct: Number(f.payment_terms_advance_pct) || null, paymentTermsDays: Number(f.payment_terms_days) || null }),
        expected_dispatch_date: f.expected_dispatch_date || null,
        expected_delivery_date: f.expected_delivery_date || null,
        notes: f.notes.trim() || null,
        freight: Number(f.freight) || 0,
        documents: docs,
        lines: payloadLines,
      };
    return payload;
  };

  // Auto-save: browser mirror (crash safety) + one server draft when the
  // buffered state is already submittable. Cleared on manual save.
  const soDraft = useFormDraft({
    key: isEdit && so ? `so:${so.id}` : "so:new",
    data: { f, lines, docs },
    isEmpty: (d) =>
      !(d.f as any).customer_id &&
      !(d.f as any).contact_person?.trim() &&
      !(d.f as any).billing_address?.trim() &&
      !(d.f as any).delivery_address?.trim() &&
      !(d.f as any).state?.trim() &&
      !(d.f as any).city?.trim() &&
      !(d.f as any).buyer_order_no?.trim() &&
      !(d.f as any).reference_no?.trim() &&
      !(d.f as any).notes?.trim() &&
      !(d.f as any).remarks?.trim() &&
      !(d.f as any).freight?.trim() &&
      (d.lines ?? []).every((l: any) => !l.product_id && !(l.name ?? "").trim()) &&
      (d.docs ?? []).length === 0,
    getServerPayload: () => {
      try {
        return buildPayload();
      } catch {
        return null;
      }
    },
    createServerDraft: (p) => api.goodsSalesOrders.create({ ...p, client_id: userId }),
    serverEnabled: !isEdit,
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = buildPayload();
      if (isEdit && so) {
        await api.goodsSalesOrders.update(so.id, payload);
      } else {
        await api.goodsSalesOrders.create({ ...payload, client_id: userId });
      }
    },
    onSuccess: () => {
      soDraft.clear();
      onSaved();
      toast.success(isEdit ? "Sales order updated" : "Sales order created");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const pushToWarehouse = async () => {
    if (!so) return;
    try {
      await api.goodsSalesOrders.salesReview(so.id, "push");
      onSaved();
      toast.success("SO pushed to Warehouse");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
      <div className="flex flex-wrap gap-2">
        {isEdit && canWrite && ["draft", "pending_review"].includes(status) && (
          <button
            type="button"
            onClick={pushToWarehouse}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/50 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
          >
            <Send className="h-3.5 w-3.5" /> Push to warehouse
          </button>
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
            type="submit"
            form="so-form"
            disabled={save.isPending}
            className="inline-flex items-center gap-2 rounded-[10px] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:-translate-y-px hover:shadow-md disabled:opacity-60"
          >
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Save changes" : "Create SO"}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <DialogWithStickyFooter
      title={isEdit ? `Sales order ${so.so_number}` : "New Sales Order"}
      subtitle={isEdit ? undefined : "Create a confirmed customer order. Stock is reserved after approval and reduced only when physical dispatch is confirmed."}
      onClose={onClose}
      wide
      footer={footer}
    >
      {isEdit && so && (
        <DocumentStatusStripCompact
          docType="Sales order"
          docNumber={so.so_number ?? "—"}
          status={so.status}
          statusLabel={statusLabel("sales_order", so.status)}
          owner={ownerLabel((so as any).owner_role, (so as any).assigned_user_name)}
          nextAction={(so as any).next_action ?? "None"}
          inventoryImpact={inventoryImpact("sales_order", so)}
          cashImpact={cashImpact("sales_order", so)}
        />
      )}
      {isEdit && so && stockCheckQ.data && (
        <div
          className={`mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3.5 py-2 text-xs ${
            stockCheckQ.data.sufficient
              ? "border-sem-success/40 bg-sem-success/10 text-sem-success"
              : "border-destructive/40 bg-destructive/10 text-destructive"
          }`}
        >
          <div className="flex items-center gap-2">
            <PackageCheck className="h-4 w-4 shrink-0" />
            <span className="font-medium">
              {stockCheckQ.data.sufficient
                ? "Auto-check stock: Available (All items in stock, reserved on confirmation)"
                : `Auto-check stock: Insufficient stock on ${stockCheckQ.data.shortLines.length} item(s) (prevents overselling)`}
            </span>
          </div>
          {!stockCheckQ.data.sufficient && (
            <span className="text-[11px] font-mono">
              {stockCheckQ.data.shortLines
                .map((s) => `${s.name}: short by ${s.required - s.available}`)
                .join("; ")}
            </span>
          )}
        </div>
      )}
      <DraftResumeBanner
        draft={soDraft}
        label="Unsaved sales order found"
        onApply={(d) => {
          setF(d.f);
          setLines(d.lines);
          setDocs(d.docs ?? []);
        }}
      />
      <form
        id="so-form"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="space-y-5"
      >
          {/* Header */}
          <fieldset className="rounded-lg border border-border/60 p-4">
            <legend className="px-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Sales order header
            </legend>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <L label="SO number">
                <input
                  className={inputBase}
                  value={isEdit ? so.so_number : ""}
                  disabled
                  placeholder="System-generated"
                />
              </L>
              <L label="Order date">
                <input
                  type="date"
                  className={inputBase}
                  value={f.order_date}
                  onChange={(e) => setF({ ...f, order_date: e.target.value })}
                  disabled={!editable}
                />
              </L>
              <L label="Billing customer *">
                <SearchableSelect
                  value={f.customer_id}
                  onChange={pickBillingCustomer}
                  placeholder="Select billing customer…"
                  disabled={!editable}
                  options={customers.map((c) => ({ value: c.id, label: c.name }))}
                />
              </L>
              <L label="Customer Type (Price Tier)">
                <select
                  className={inputBase}
                  value={f.customer_type}
                  onChange={(e) => handleCustomerTypeChange(e.target.value)}
                  disabled={!editable}
                >
                  {PRICE_TIERS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                {(() => {
                  const cType = f.customer_type;
                  if (!cType) return null;
                  return (
                    <div className="mt-1 flex items-center gap-1.5 text-[11px]">
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-primary/10 text-primary">
                        {cType.toUpperCase()} Pricing Active
                      </span>
                    </div>
                  );
                })()}
              </L>
              <L label="Shipping customer">
                <SearchableSelect
                  value={(f as any).same_as_billing !== false ? f.customer_id : ((f as any).ship_customer_id as string)}
                  onChange={pickShippingCustomer}
                  placeholder="Select shipping customer…"
                  disabled={!editable || (f as any).same_as_billing !== false}
                  options={customers.map((c) => ({ value: c.id, label: c.name }))}
                />
                <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={(f as any).same_as_billing !== false}
                    disabled={!editable}
                    onChange={(e) => toggleSameAsBilling(e.target.checked)}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  Same as billing customer
                </label>
              </L>
              <L label="Contact person">
                <input
                  className={inputBase}
                  value={f.contact_person}
                  onChange={(e) => setF({ ...f, contact_person: e.target.value })}
                  placeholder="Auto-filled from customer"
                  disabled={!editable}
                />
              </L>
              <L label="Billing address">
                {(() => {
                  const c = customers.find((x) => x.id === f.customer_id);
                  const listed = c?.billing_addresses ?? [];
                  const opts = billAddrFor === f.customer_id && billAddrBook ? billAddrBook : listed;
                  return (
                    <>
                      {editable && opts.length > 1 && (
                        <select
                          className={`${selectBase} mb-1`}
                          value={opts.findIndex((a) => fullAddr(a) === f.billing_address) >= 0 ? String(opts.findIndex((a) => fullAddr(a) === f.billing_address)) : "custom"}
                          onChange={(e) => {
                            if (e.target.value === "custom") return;
                            const a = opts[Number(e.target.value)];
                            if (a) setF({ ...f, billing_address: fullAddr(a) });
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
                        className={textareaBase}
                        value={f.billing_address}
                        onChange={(e) => setF({ ...f, billing_address: e.target.value })}
                        placeholder="Auto-filled from customer — pick a saved address or type custom"
                        disabled={!editable}
                      />
                    </>
                  );
                })()}
                <div className="mt-1 grid grid-cols-2 gap-1.5">
                  <input
                    className={`${inputBase} !py-1.5 !text-xs`}
                    value={f.bill_gstin}
                    onChange={(e) => setF({ ...f, bill_gstin: e.target.value })}
                    placeholder="Bill-to GSTIN"
                    disabled={!editable}
                  />
                  <input
                    className={`${inputBase} !py-1.5 !text-xs text-center placeholder:text-center`}
                    value={f.bill_pan}
                    onChange={(e) => setF({ ...f, bill_pan: e.target.value })}
                    placeholder="Bill-to PAN"
                    disabled={!editable}
                  />
                </div>
              </L>
              <L label="Delivery / shipping address">
                {(() => {
                  const sid = ((f as any).same_as_billing !== false ? f.customer_id : (f as any).ship_customer_id) as string;
                  const c = customers.find((x) => x.id === sid);
                  const listed = c?.shipping_addresses?.length ? c.shipping_addresses : (c?.billing_addresses ?? []);
                  const live = shipAddrFor === sid && shipAddrBook ? shipAddrBook : [];
                  const opts = live.length ? live : listed;
                  return (
                    <>
                      {editable && opts.length > 1 && (
                        <select
                          className={`${selectBase} mb-1`}
                          value={opts.findIndex((a) => fullAddr(a) === f.delivery_address) >= 0 ? String(opts.findIndex((a) => fullAddr(a) === f.delivery_address)) : "custom"}
                          onChange={(e) => {
                            if (e.target.value === "custom") return;
                            const a = opts[Number(e.target.value)];
                            if (a) {
                              const city = String((a as any).city ?? "").trim();
                              const rawState = String((a as any).state ?? "").trim();
                              const state = canonState(rawState) || (city ? stateForCity(city) || "" : "");
                              setF({
                                ...f,
                                delivery_address: fullAddr(a),
                                ...(city || state
                                  ? {
                                      city: city || f.city,
                                      state: state || f.state,
                                    }
                                  : {}),
                              });
                            }
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
                        className={textareaBase}
                        value={f.delivery_address}
                        onChange={(e) => setF({ ...f, delivery_address: e.target.value })}
                        placeholder="Auto-filled from customer — pick a saved address or type custom"
                        disabled={!editable}
                      />
                    </>
                  );
                })()}
                <div className="mt-1 grid grid-cols-2 gap-1.5">
                  <input
                    className={`${inputBase} !py-1.5 !text-xs`}
                    value={f.ship_gstin}
                    onChange={(e) => setF({ ...f, ship_gstin: e.target.value })}
                    placeholder="Ship-to GSTIN"
                    disabled={!editable}
                  />
                  <input
                    className={`${inputBase} !py-1.5 !text-xs text-center placeholder:text-center`}
                    value={f.ship_pan}
                    onChange={(e) => setF({ ...f, ship_pan: e.target.value })}
                    placeholder="Ship-to PAN"
                    disabled={!editable}
                  />
                </div>
              </L>
              <L label="State">
                <StateSelect
                  value={f.state ?? ""}
                  onChange={(v) =>
                    setF((prev) => ({
                      ...prev,
                      state: v,
                      // Never keep a city from the previous state.
                      city: v === (prev.state ?? "") ? (prev.city ?? "") : "",
                    }))
                  }
                  placeholder="Select state…"
                  disabled={!editable}
                />
              </L>
              <L label="City">
                <CitySelect
                  stateValue={f.state ?? ""}
                  value={f.city ?? ""}
                  onChange={(v) => setF({ ...f, city: v })}
                  placeholder={(f.state ?? "") ? "Select city…" : "Select a state first…"}
                  disabled={!editable}
                />
              </L>
              <L label="Salesperson / owner">
                <input className={inputBase} value={so?.salesperson_name ?? "You"} disabled />
              </L>
              <L label="Payment terms (approved)">
                {!f.customer_id ? (
                  <div className="text-xs text-muted-foreground">
                    Select a billing customer first — only its approved terms can be used.
                  </div>
                ) : soTermsQ.isLoading ? (
                  <div className="text-xs text-muted-foreground">Loading approved terms…</div>
                ) : soTerms.length === 0 ? (
                  <div className="text-xs text-destructive">
                    No approved terms for this customer. Add one in Customers → Edit before
                    creating the order.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <select
                      className={inputBase}
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
                  className={inputBase}
                  value={f.expected_dispatch_date}
                  onChange={(e) => setF({ ...f, expected_dispatch_date: e.target.value })}
                  disabled={!editable}
                />
              </L>
              <L label="Expected delivery date">
                <input
                  type="date"
                  className={inputBase}
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
                  className={textareaBase}
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
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <L label="Buyer's order no.">
                <div className="space-y-1">
                  <input
                    className={inputBase}
                    value={f.buyer_order_no}
                    onChange={(e) => setF({ ...f, buyer_order_no: e.target.value })}
                    placeholder="Customer PO number"
                    disabled={!editable}
                  />
                  {(() => {
                    const suggested = computeNextBuyerOrderNo(f.customer_id, sos);
                    if (suggested && f.buyer_order_no !== suggested) {
                      return (
                        <button
                          type="button"
                          onClick={() => setF({ ...f, buyer_order_no: suggested })}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                        >
                          Use next sequence: <span className="font-semibold">{suggested}</span> (this customer's series)
                        </button>
                      );
                    }
                    return null;
                  })()}
                </div>
              </L>
              <L label="Reference no. & date">
                <input
                  className={inputBase}
                  value={f.reference_no}
                  onChange={(e) => setF({ ...f, reference_no: e.target.value })}
                  placeholder="Ref no. & date"
                  disabled={!editable}
                />
              </L>
              <L label="Delivery note">
                <input
                  className={inputBase}
                  value={f.delivery_note}
                  onChange={(e) => setF({ ...f, delivery_note: e.target.value })}
                  placeholder="Delivery note ref"
                  disabled={!editable}
                />
              </L>
              <L label="Dispatch doc no.">
                <input
                  className={inputBase}
                  value={f.dispatch_doc_no}
                  onChange={(e) => setF({ ...f, dispatch_doc_no: e.target.value })}
                  placeholder="Dispatch document"
                  disabled={!editable}
                />
              </L>
              <L label="Dispatched through">
                <input
                  className={inputBase}
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
                  className={textareaBase}
                  value={f.remarks}
                  onChange={(e) => setF({ ...f, remarks: e.target.value })}
                  placeholder="Optional remarks for the PDF — leave blank to print nothing"
                  disabled={!editable}
                />
              </L>
            </div>
          </fieldset>

          {/* Line items */}
          <fieldset className="rounded-lg border border-border/60 p-5">
            <legend className="px-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Sales order item lines
            </legend>
            {products.length === 0 ? (
              <div className="rounded-md border border-sem-attention/40 bg-sem-attention/10 p-3 text-xs text-sem-attention">
                No active products in the catalogue yet — add products in the Product catalogue tab first.
              </div>
            ) : (
              <div className="space-y-4">
                {lines.map((l, i) => (
                  <MultiSizeLineCard
                    key={i}
                    products={products}
                    value={l}
                    onChange={(next) => setLine(i, next)}
                    onRemove={() => removeLine(i)}
                    disabled={!editable}
                    mode="sales"
                    stockBalance={stockBalance}
                    customerType={f.customer_type}
                  />
                ))}
                {editable && (
                  <button
                    type="button"
                    onClick={addLine}
                    className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add product line
                  </button>
                )}
              </div>
            )}
          </fieldset>

          {/* Totals */}
          <div className="ml-auto max-w-sm space-y-1 rounded-lg border border-border/60 bg-muted/20 p-4 text-sm">
            <Row
              label="Total quantity"
              value={lines.reduce((s, l) => s + l.sizes.reduce((sz, size) => sz + (Number(size.quantity) || 0), 0), 0).toLocaleString()}
            />
            <Row label="Subtotal (ex-GST)" value={fmtMoney(totals.subtotal)} />
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
                className={`${inputBase} !w-40 !py-1 text-right`}
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
        </form>
        
        <datalist id="so-gst-rates">
          <option value="0" />
          <option value="5" />
          <option value="12" />
          <option value="18" />
          <option value="28" />
        </datalist>
      </DialogWithStickyFooter>
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
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
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
