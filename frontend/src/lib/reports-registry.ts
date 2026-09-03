// ===========================================================================
// Reports module registry — the single source of truth that drives both the
// Reports Dashboard (categories + cards) and the shared report detail layout
// (filters, columns, pagination and exports).
// ===========================================================================

import type { LucideIcon } from "lucide-react";
import { fmtMoney } from "@/components/ledger-ui";
import {
  Scale,
  TrendingUp,
  Layers,
  FileText,
  ShoppingCart,
  FileSignature,
  Clock4,
  Building2,
  Truck,
  Wallet,
  Receipt,
  Boxes,
} from "lucide-react";

export type ReportId =
  | "balance-sheet"
  | "profit-loss"
  | "portfolio"
  | "sales-invoices"
  | "purchase-invoices"
  | "proformas"
  | "aging"
  | "debtors"
  | "suppliers"
  | "advances"
  | "expenses"
  | "inventory";

export type CategoryId = "financial" | "invoices" | "customers" | "other";

export type ColumnKind =
  "text" | "mono" | "money" | "int" | "percent" | "date" | "pill" | "bool" | "days";

export interface ReportColumn {
  key: string;
  label: string;
  kind: ColumnKind;
  /** Optional accessor — defaults to `row[key]`. */
  get?: (row: any) => any;
  /** Display label for a raw value (pills, codes, booleans). */
  labelFor?: (v: any) => string;
  /** Start hidden (long-tail columns); user can re-enable via the column picker. */
  hiddenByDefault?: boolean;
  /** Column alignment override (defaults: numbers right, text left). */
  align?: "left" | "right";
}

export interface ReportFilterDef {
  /** Status pills shown before the search box ("All" is always first). */
  statuses?: Array<{ value: string; label: string }>;
  /** Show the buyer (debtor) dropdown. */
  buyer?: boolean;
  /** Show the Bulk Pay / Treasury Pay checkboxes (payment_type filter). */
  paymentTypes?: boolean;
  /** Show the free-text search box. */
  search: boolean;
  searchPlaceholder?: string;
  /** Show From / To date range. */
  dateRange?: boolean;
  dateLabel?: string;
  /** Client-side per-row status matcher (full reports). Server-paginated
   *  reports leave this undefined — the API performs the matching. */
  statusMatch?: (row: any, value: string) => boolean;
  /** Client-side date accessor used by the From/To range on full reports. */
  dateOf?: (row: any) => string | null | undefined;
}

export interface ReportDef {
  id: ReportId;
  title: string;
  /** Card headline on the dashboard. */
  cardTitle: string;
  description: string;
  icon: LucideIcon;
  accent: {
    /** Icon chip classes. */
    chip: string;
    /** Colored bar under the card title. */
    bar: string;
    /** Accent text color for the category label / title hover. */
    text: string;
  };
  category: CategoryId;
  /** True when the API paginates server-side (page/limit/search/status…). */
  serverPaginated?: boolean;
  filters: ReportFilterDef;
  columns?: ReportColumn[];
  /** Search text assembled from the row for client-side reports. */
  searchText?: (row: any) => string;
}

export const CATEGORY_META: Array<{ id: CategoryId; label: string; description: string }> = [
  { id: "financial", label: "Financial reports", description: "Statements & portfolio health" },
  {
    id: "invoices",
    label: "Invoice reports",
    description: "Sales, purchase and proforma documents",
  },
  { id: "customers", label: "Customer reports", description: "Aging, debtors and suppliers" },
  { id: "other", label: "Other reports", description: "Advances, expenses and inventory" },
];

// ─── Shared value-label maps ──────────────────────────────────────────────

export const PAYMENT_TYPE_LABELS: Record<string, string> = {
  manual: "Manual Pay",
  mass_upload: "Mass Upload",
  bulk_pay: "Bulk Pay",
  treasury_pay: "Treasury Pay",
};

export const NOA_STATUS_LABELS: Record<string, string> = {
  not_sent: "Not sent",
  sent: "Sent",
  accepted: "Accepted",
  rejected: "Rejected",
  commented: "Commented",
  approved: "Approved",
};

export const SIDE_LABELS: Record<string, string> = {
  sales: "Sales",
  purchase: "Purchase",
};

// ─── Reports ───────────────────────────────────────────────────────────────

const closedMacro = (row: any, value: string) => {
  const closed = ["paid", "cancelled", "rejected"].includes(String(row.status));
  return value === "open" ? !closed : closed;
};

export const REPORTS: ReportDef[] = [
  // ── Financial ──────────────────────────────────────────────────────────────
  {
    id: "balance-sheet",
    title: "Balance Sheet",
    cardTitle: "Balance Sheet",
    description: "Assets, liabilities and equity across the portfolio as of today.",
    icon: Scale,
    accent: {
      chip: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-300",
      bar: "bg-indigo-500",
      text: "text-indigo-600 dark:text-indigo-300",
    },
    category: "financial",
    filters: { search: false },
  },
  {
    id: "profit-loss",
    title: "Profit & Loss",
    cardTitle: "Profit & Loss",
    description: "Turnover, cost of sales and profit for the selected period.",
    icon: TrendingUp,
    accent: {
      chip: "bg-violet-500/10 text-violet-600 dark:text-violet-300",
      bar: "bg-violet-500",
      text: "text-violet-600 dark:text-violet-300",
    },
    category: "financial",
    filters: { search: false },
  },
  {
    id: "portfolio",
    title: "Portfolio Summary",
    cardTitle: "Portfolio Summary",
    description: "Buyers, invoices, collections and outstanding at a glance.",
    icon: Layers,
    accent: {
      chip: "bg-sky-500/10 text-sky-600 dark:text-sky-300",
      bar: "bg-sky-500",
      text: "text-sky-600 dark:text-sky-300",
    },
    category: "financial",
    filters: { search: false },
  },
  // ── Invoice reports ────────────────────────────────────────────────────────
  {
    id: "sales-invoices",
    title: "Sales Invoices",
    cardTitle: "Sales Invoices",
    description: "Every sales invoice across the portfolio — funding, ageing and payment detail.",
    icon: FileText,
    accent: {
      chip: "bg-blue-500/10 text-blue-600 dark:text-blue-300",
      bar: "bg-blue-500",
      text: "text-blue-600 dark:text-blue-300",
    },
    category: "invoices",
    serverPaginated: true,
    filters: {
      statuses: [
        { value: "open", label: "Open" },
        { value: "closed", label: "Closed" },
      ],
      buyer: true,
      paymentTypes: true,
      search: true,
      searchPlaceholder: "Invoice #, debtor, client or PO…",
      dateRange: true,
      dateLabel: "Issue date",
    },
    searchText: (r) =>
      `${r.invoice_number} ${r.debtor} ${r.client} ${r.po_number} ${r.noa_status} ${r.payment_type}`,
    columns: [
      { key: "id", label: "ID", kind: "mono", hiddenByDefault: true },
      { key: "invoice_number", label: "Invoice #", kind: "mono" },
      { key: "debtor", label: "Debtor", kind: "text" },
      { key: "client", label: "Client", kind: "text" },
      { key: "amount", label: "Amount", kind: "money" },
      { key: "outstanding", label: "Outstanding", kind: "money" },
      { key: "advance_rate", label: "Advance rate", kind: "percent" },
      { key: "fee_rate", label: "Fee rate", kind: "percent" },
      { key: "issue_date", label: "Issue date", kind: "date" },
      { key: "due_date", label: "ERP due date", kind: "date" },
      { key: "contractual_terms", label: "Contractual terms", kind: "bool" },
      { key: "status", label: "Status", kind: "pill" },
      { key: "paid_date", label: "Paid date", kind: "date" },
      { key: "amount_received", label: "Amount received", kind: "money" },
      { key: "short_payment", label: "Short payment", kind: "money" },
      { key: "late_days", label: "Late days", kind: "days" },
      { key: "pay_days", label: "Pay days", kind: "days" },
      {
        key: "noa_status",
        label: "NOA status",
        kind: "pill",
        labelFor: (v) => NOA_STATUS_LABELS[v] ?? v,
        get: (r) => r.noa_status,
      },
      {
        key: "payment_type",
        label: "Payment type",
        kind: "pill",
        labelFor: (v) => PAYMENT_TYPE_LABELS[v] ?? v,
        get: (r) => r.payment_type,
      },
      { key: "po_number", label: "PO number", kind: "text" },
      { key: "terms_days", label: "Terms days", kind: "days" },
      { key: "bl_date", label: "BL date", kind: "date", hiddenByDefault: true },
      { key: "due_date_source", label: "Due date source", kind: "text", hiddenByDefault: true },
      {
        key: "advance_received_date",
        label: "Advance received date",
        kind: "date",
        hiddenByDefault: true,
      },
      { key: "created_at", label: "Created", kind: "date", hiddenByDefault: true },
    ],
  },
  {
    id: "purchase-invoices",
    title: "Purchase Invoices",
    cardTitle: "Purchase Invoices",
    description: "Supplier invoices, funding and payments across the portfolio.",
    icon: ShoppingCart,
    accent: {
      chip: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-300",
      bar: "bg-cyan-500",
      text: "text-cyan-600 dark:text-cyan-300",
    },
    category: "invoices",
    serverPaginated: true,
    filters: {
      statuses: [
        { value: "open", label: "Open" },
        { value: "closed", label: "Closed" },
      ],
      search: true,
      searchPlaceholder: "Invoice #, supplier, client or PO…",
      dateRange: true,
      dateLabel: "Issue date",
    },
    searchText: (r) => `${r.invoice_number} ${r.vendor} ${r.client} ${r.po_number}`,
    columns: [
      { key: "id", label: "ID", kind: "mono", hiddenByDefault: true },
      { key: "invoice_number", label: "Invoice #", kind: "mono" },
      { key: "vendor", label: "Vendor", kind: "text" },
      { key: "client", label: "Client", kind: "text" },
      { key: "amount", label: "Amount", kind: "money" },
      { key: "amount_paid", label: "Amount paid", kind: "money" },
      { key: "balance_due", label: "Balance due", kind: "money" },
      { key: "status", label: "Status", kind: "pill" },
      { key: "issue_date", label: "Issue date", kind: "date" },
      { key: "due_date", label: "Due date", kind: "date" },
      { key: "paid_date", label: "Paid date", kind: "date" },
      { key: "funded_date", label: "Funded date", kind: "date" },
      { key: "advance_rate", label: "Advance rate", kind: "percent" },
      { key: "advance_paid_date", label: "Advance paid date", kind: "date" },
      { key: "po_number", label: "PO number", kind: "text" },
      { key: "notes", label: "Notes", kind: "text" },
      { key: "created_at", label: "Created", kind: "date", hiddenByDefault: true },
    ],
  },
  {
    id: "proformas",
    title: "Proforma Invoices",
    cardTitle: "Proforma Invoices",
    description: "Sales and purchase proformas with their funding state.",
    icon: FileSignature,
    accent: {
      chip: "bg-teal-500/10 text-teal-600 dark:text-teal-300",
      bar: "bg-teal-500",
      text: "text-teal-600 dark:text-teal-300",
    },
    category: "invoices",
    filters: {
      statuses: [
        { value: "open", label: "Open" },
        { value: "closed", label: "Closed" },
      ],
      search: true,
      searchPlaceholder: "PO #, proforma #, party or client…",
      dateRange: true,
      dateLabel: "Proforma date",
      statusMatch: closedMacro,
      dateOf: (r) => r.proforma_date,
    },
    searchText: (r) =>
      `${r.po_number} ${r.proforma_number} ${r.party} ${r.client} ${r.side} ${r.proforma_status}`,
    columns: [
      { key: "id", label: "ID", kind: "mono", hiddenByDefault: true },
      { key: "po_number", label: "PO #", kind: "mono" },
      { key: "proforma_number", label: "Proforma #", kind: "mono" },
      {
        key: "side",
        label: "Side",
        kind: "pill",
        labelFor: (v) => SIDE_LABELS[v] ?? v,
        get: (r) => r.side,
      },
      { key: "party", label: "Debtor / Vendor", kind: "text" },
      { key: "client", label: "Client", kind: "text" },
      { key: "amount", label: "Amount", kind: "money" },
      { key: "currency", label: "Currency", kind: "text" },
      { key: "proforma_date", label: "Proforma date", kind: "date" },
      { key: "expected_date", label: "Expected date", kind: "date" },
      { key: "status", label: "Status", kind: "pill" },
      {
        key: "proforma_status",
        label: "Proforma status",
        kind: "pill",
        get: (r) => r.proforma_status,
      },
      { key: "funded_amount", label: "Funded amount", kind: "money" },
      { key: "funded_at", label: "Funded at", kind: "date" },
      { key: "funding_reference", label: "Funding reference", kind: "mono" },
      { key: "notes", label: "Notes", kind: "text" },
    ],
  },
  // ── Customer reports ───────────────────────────────────────────────────────
  {
    id: "aging",
    title: "Aging Report",
    cardTitle: "Aging Report",
    description: "Buyer balances aged by how long they've been past due.",
    icon: Clock4,
    accent: {
      chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
      bar: "bg-emerald-500",
      text: "text-emerald-600 dark:text-emerald-300",
    },
    category: "customers",
    serverPaginated: true,
    filters: {
      statuses: [
        { value: "overdue", label: "Overdue" },
        { value: "pending", label: "Pending" },
      ],
      buyer: true,
      search: true,
      searchPlaceholder: "Buyer name…",
      dateRange: true,
      dateLabel: "Invoice date",
    },
    searchText: (r) => `${r.buyer}`,
    columns: [
      { key: "buyer_id", label: "ID", kind: "mono", hiddenByDefault: true },
      { key: "buyer", label: "Buyer", kind: "text" },
      { key: "invoices", label: "Invoices", kind: "int" },
      { key: "current", label: "Current", kind: "money" },
      { key: "d1_30", label: "1–30 days", kind: "money" },
      { key: "d31_60", label: "31–60 days", kind: "money" },
      { key: "d61_90", label: "61–90 days", kind: "money" },
      { key: "d91_120", label: "91–120 days", kind: "money" },
      { key: "d120", label: "120+ days", kind: "money" },
      { key: "total", label: "Total outstanding", kind: "money" },
    ],
  },
  {
    id: "debtors",
    title: "Debtors",
    cardTitle: "Debtors",
    description: "Buyer master with invoicing, payment-speed and contact detail.",
    icon: Building2,
    accent: {
      chip: "bg-green-500/10 text-green-600 dark:text-green-300",
      bar: "bg-green-500",
      text: "text-green-600 dark:text-green-300",
    },
    category: "customers",
    filters: {
      search: true,
      searchPlaceholder: "Buyer, industry, contact or city…",
    },
    searchText: (r) =>
      `${r.name} ${r.code} ${r.registration_no} ${r.industry} ${r.contact} ${r.address} ${r.city}`,
    columns: [
      { key: "uid", label: "UID", kind: "mono", hiddenByDefault: true },
      { key: "name", label: "Name", kind: "text" },
      { key: "code", label: "Code", kind: "mono", hiddenByDefault: true },
      { key: "legal_entity", label: "Legal entity", kind: "text", hiddenByDefault: true },
      { key: "registration_no", label: "Registration no.", kind: "mono" },
      { key: "invoice_count_total", label: "Invoices", kind: "int" },
      { key: "invoice_count_open", label: "Open", kind: "int" },
      { key: "invoice_count_closed", label: "Closed", kind: "int" },
      { key: "outstanding", label: "Outstanding", kind: "money" },
      { key: "total_invoiced", label: "Total invoiced", kind: "money" },
      { key: "total_paid", label: "Total paid", kind: "money" },
      { key: "oldest_open_date", label: "Oldest open invoice", kind: "date" },
      { key: "latest_invoice_date", label: "Latest invoice", kind: "date" },
      { key: "avg_pay_days", label: "Avg pay days", kind: "days" },
      { key: "median_pay_days", label: "Median pay days", kind: "days" },
      { key: "max_pay_days", label: "Max pay days", kind: "days" },
      { key: "min_pay_days", label: "Min pay days", kind: "days" },
      { key: "industry", label: "Industry", kind: "text" },
      { key: "relationship_since", label: "Relationship since", kind: "date" },
      { key: "contact", label: "Contact", kind: "text" },
      { key: "address", label: "Address", kind: "text" },
      { key: "terms_days", label: "Terms (days)", kind: "days" },
      { key: "notes", label: "Notes", kind: "text", hiddenByDefault: true },
    ],
  },
  {
    id: "suppliers",
    title: "Suppliers",
    cardTitle: "Suppliers",
    description: "Supplier master list with contacts and status.",
    icon: Truck,
    accent: {
      chip: "bg-lime-500/10 text-lime-600 dark:text-lime-300",
      bar: "bg-lime-500",
      text: "text-lime-600 dark:text-lime-300",
    },
    category: "customers",
    filters: {
      statuses: [
        { value: "active", label: "Active" },
        { value: "prospect", label: "Prospect" },
      ],
      search: true,
      searchPlaceholder: "Company, industry or contact…",
      statusMatch: (row, v) => String(row.status ?? "prospect") === v,
    },
    searchText: (r) => `${r.company} ${r.industry} ${r.contact} ${r.city_country} ${r.status}`,
    columns: [
      { key: "id", label: "ID", kind: "mono", hiddenByDefault: true },
      { key: "company", label: "Company", kind: "text" },
      { key: "industry", label: "Industry", kind: "text" },
      { key: "contact", label: "Contact", kind: "text" },
      { key: "city_country", label: "City / country", kind: "text" },
      { key: "status", label: "Status", kind: "pill" },
      { key: "terms", label: "Terms", kind: "text" },
      { key: "notes", label: "Notes", kind: "text" },
    ],
  },
  // ── Other reports ──────────────────────────────────────────────────────────
  {
    id: "advances",
    title: "Advances",
    cardTitle: "Advances",
    description: "Advances paid and received against invoices and proformas.",
    icon: Wallet,
    accent: {
      chip: "bg-amber-500/10 text-amber-600 dark:text-amber-300",
      bar: "bg-amber-500",
      text: "text-amber-600 dark:text-amber-300",
    },
    category: "other",
    filters: {
      statuses: [
        { value: "open", label: "Open" },
        { value: "applied", label: "Applied" },
        { value: "refunded", label: "Refunded" },
      ],
      search: true,
      searchPlaceholder: "Reference, party, invoice or PO…",
      dateRange: true,
      dateLabel: "Advance date",
      statusMatch: (row, v) => String(row.status) === v,
      dateOf: (r) => r.date,
    },
    searchText: (r) => `${r.ref} ${r.party} ${r.client} ${r.payment_ref} ${r.reference} ${r.side}`,
    columns: [
      { key: "id", label: "ID", kind: "mono", hiddenByDefault: true },
      {
        key: "side",
        label: "Side",
        kind: "pill",
        labelFor: (v) => SIDE_LABELS[v] ?? v,
        get: (r) => r.side,
      },
      { key: "ref", label: "Linked invoice / PO", kind: "mono" },
      { key: "party", label: "Debtor / Vendor", kind: "text" },
      { key: "client", label: "Client", kind: "text" },
      { key: "amount", label: "Amount", kind: "money" },
      { key: "date", label: "Date", kind: "date" },
      { key: "payment_ref", label: "Payment ref", kind: "mono" },
      { key: "reference", label: "Reference", kind: "text" },
      { key: "status", label: "Status", kind: "pill" },
      { key: "notes", label: "Notes", kind: "text" },
    ],
  },
  {
    id: "expenses",
    title: "Expenses",
    cardTitle: "Expenses",
    description: "Recorded expenses by category with linked documents.",
    icon: Receipt,
    accent: {
      chip: "bg-orange-500/10 text-orange-600 dark:text-orange-300",
      bar: "bg-orange-500",
      text: "text-orange-600 dark:text-orange-300",
    },
    category: "other",
    filters: {
      search: true,
      searchPlaceholder: "Category, description or linked invoice…",
      dateRange: true,
      dateLabel: "Expense date",
      dateOf: (r) => r.date,
    },
    searchText: (r) => `${r.category} ${r.description} ${r.linked_invoice} ${r.client}`,
    columns: [
      { key: "id", label: "ID", kind: "mono", hiddenByDefault: true },
      { key: "category", label: "Category", kind: "text" },
      { key: "description", label: "Description", kind: "text" },
      { key: "amount", label: "Amount", kind: "money" },
      { key: "date", label: "Date", kind: "date" },
      { key: "linked_invoice", label: "Linked invoice", kind: "mono" },
      { key: "client", label: "Client", kind: "text" },
    ],
  },
  {
    id: "inventory",
    title: "Inventory Tracking",
    cardTitle: "Inventory Tracking",
    description: "Closing stock quantities and valuation per catalogue item.",
    icon: Boxes,
    accent: {
      chip: "bg-rose-500/10 text-rose-600 dark:text-rose-300",
      bar: "bg-rose-500",
      text: "text-rose-600 dark:text-rose-300",
    },
    category: "other",
    filters: {
      search: true,
      searchPlaceholder: "Item, SKU or description…",
    },
    searchText: (r) => `${r.item} ${r.sku} ${r.description} ${r.client}`,
    columns: [
      { key: "id", label: "ID", kind: "mono", hiddenByDefault: true },
      { key: "item", label: "Item", kind: "text" },
      { key: "sku", label: "SKU", kind: "mono" },
      { key: "description", label: "Description", kind: "text" },
      { key: "closing_qty", label: "Closing qty", kind: "int" },
      { key: "sale_price", label: "Sale price", kind: "money" },
      { key: "extended_price", label: "Extended price", kind: "money" },
      { key: "unit_cost", label: "Unit cost", kind: "money" },
      { key: "extended_cost", label: "Extended cost", kind: "money" },
      { key: "client", label: "Client", kind: "text", hiddenByDefault: true },
    ],
  },
];

export const REPORTS_BY_ID = new Map<string, ReportDef>(REPORTS.map((r) => [r.id, r]));

export function getReport(id: string): ReportDef | undefined {
  return REPORTS_BY_ID.get(id);
}

export const TABULAR_REPORT_IDS: ReportId[] = [
  "sales-invoices",
  "purchase-invoices",
  "proformas",
  "aging",
  "debtors",
  "suppliers",
  "advances",
  "expenses",
  "inventory",
];

/** Reports grouped by category, in dashboard order. */
export function reportsByCategory() {
  return CATEGORY_META.map((cat) => ({
    ...cat,
    reports: REPORTS.filter((r) => r.category === cat.id),
  })).filter((c) => c.reports.length > 0);
}

// ─── Value helpers shared with the table renderer and the exporters ────────

export function fmtNum(v: any): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

export function fmtNum2(v: any): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** Format a raw value for a column — used by both the table and the exports. */
export function formatCell(col: ReportColumn, row: any): string {
  const raw = col.get ? col.get(row) : row[col.key];
  const val = col.labelFor ? col.labelFor(raw) : raw;
  if (val === null || val === undefined || val === "") return "—";
  switch (col.kind) {
    case "money":
      return fmtMoney(raw);
    case "percent": {
      const n = Number(raw);
      const pct = Number.isFinite(n) ? (Math.abs(n) <= 1.5 ? n * 100 : n) : n;
      return Number.isFinite(pct) ? `${Math.round(pct)}%` : "—";
    }
    case "date": {
      if (!val) return "—";
      return new Date(val).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    }
    case "bool":
      return raw ? "Yes" : "No";
    case "days":
      return Number.isFinite(Number(raw)) ? `${Number(raw)}d` : "—";
    case "int":
    case "mono":
    case "text":
    case "pill":
    default:
      return String(val);
  }
}

/** Numeric value used when exporting (money/int/days), else formatted text. */
export function exportValue(col: ReportColumn, row: any): string | number {
  const raw = col.get ? col.get(row) : row[col.key];
  if (raw === null || raw === undefined || raw === "") return "";
  if (col.kind === "money" || col.kind === "percent" || col.kind === "int" || col.kind === "days") {
    const n = Number(raw);
    return Number.isFinite(n)
      ? col.kind === "percent"
        ? Math.round(Math.abs(n) <= 1.5 ? n * 100 : n)
        : n
      : raw;
  }
  if (col.kind === "bool") return raw ? "Yes" : "No";
  if (col.kind === "date") return String(raw).slice(0, 10);
  const v = col.labelFor ? col.labelFor(raw) : raw;
  return v === null || v === undefined ? "" : String(v);
}

export const STATUS_LABEL_OVERRIDES: Record<string, string> = {
  approved_for_payment: "Approved for payment",
  partially_paid: "Partially paid",
  not_sent: "Not sent",
  ...SIDE_LABELS,
};
