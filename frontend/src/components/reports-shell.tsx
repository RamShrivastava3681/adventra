// ===========================================================================
// Shared Reports module UI — layout chrome used by every report detail page:
// page header w/ Excel + PDF actions, quick-tab bar across the 12 reports,
// the filter bar (status pills, search, buyer, payment-type toggles, dates),
// the column picker, pagination and the generic data table.
// ===========================================================================

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Columns3, ListFilter, Printer, Search, X } from "lucide-react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { EmptyState, PageHeader, StatusPill, fmtDate, fmtMoney } from "@/components/ledger-ui";
import { TableSkeleton } from "@/components/skeletons";
import {
  REPORTS,
  STATUS_LABEL_OVERRIDES,
  type ReportColumn,
  type ReportDef,
} from "@/lib/reports-registry";
import { exportExcelReport, printPdfReport, type ExportHeading } from "@/lib/reports-export";

// ─── Filter model ──────────────────────────────────────────────────────────

export interface ReportFilters {
  status: string; // "all" or a pill value (open/closed/overdue/…)
  q: string;
  buyerId: string;
  payment: string; // "" | bulk_pay | treasury_pay
  from: string;
  to: string;
}

export const EMPTY_FILTERS: ReportFilters = {
  status: "all",
  q: "",
  buyerId: "",
  payment: "",
  from: "",
  to: "",
};

export function filtersActive(f: ReportFilters) {
  return (
    f.status !== "all" ||
    f.q !== "" ||
    f.buyerId !== "" ||
    f.payment !== "" ||
    f.from !== "" ||
    f.to !== ""
  );
}

/** Company name used on export headers — from the signed-in profile. */
export function useExportHeading(title: string, period?: string): ExportHeading {
  const { user } = useAuth();
  return {
    companyName: user?.companyName || (user as any)?.company_name || "",
    title,
    period,
  };
}

// ─── Data hook ─────────────────────────────────────────────────────────────

export interface ReportDataResult {
  rows: any[];
  total: number;
  totalPages: number;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

function paginatedCall(def: ReportDef, filters: ReportFilters, page: number, limit: number) {
  const params: Record<string, any> = {
    page,
    limit,
    search: filters.q || undefined,
    buyer_id: filters.buyerId || undefined,
    payment_type: filters.payment || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
  };
  if (filters.status !== "all") params.status = filters.status;
  if (def.id === "sales-invoices") return api.reports.salesInvoices(params);
  if (def.id === "purchase-invoices") return api.reports.purchaseInvoices(params);
  return api.reports.aging(params);
}

function fullCall(def: ReportDef) {
  if (def.id === "proformas") return api.reports.proformas();
  if (def.id === "advances") return api.reports.advances();
  if (def.id === "expenses") return api.reports.expenses();
  if (def.id === "debtors") return api.reports.debtors();
  if (def.id === "suppliers") return api.reports.suppliers();
  return api.reports.inventory();
}

function applyClientFilters(def: ReportDef, rows: any[], filters: ReportFilters) {
  const term = filters.q.trim().toLowerCase();
  let out = rows;
  if (filters.status !== "all" && def.filters.statusMatch) {
    out = out.filter((r) => def.filters!.statusMatch!(r, filters.status));
  }
  if (term) {
    const text = def.searchText ?? ((r) => JSON.stringify(r));
    out = out.filter((r) => text(r).toLowerCase().includes(term));
  }
  if ((filters.from || filters.to) && def.filters.dateOf) {
    out = out.filter((r) => {
      const d = def.filters!.dateOf!(r) ?? "";
      if (filters.from && d < filters.from) return false;
      if (filters.to && d > filters.to) return false;
      return true;
    });
  }
  return out;
}

/**
 * Fetch + filter rows for a report. Server-paginated reports keep filtering
 * on the API; everything else loads the full set once and filters client-side
 * by status, search and date.
 */
export function useReportData(
  def: ReportDef,
  filters: ReportFilters,
  page: number,
  limit: number,
): ReportDataResult {
  const paginated = !!def.serverPaginated;
  // Statements (balance sheet / portfolio / P&L) are handled by their own
  // dedicated views — never fetch a tabular dataset for them.
  const hasTableColumns = !!(def.columns && def.columns.length > 0);

  // Debounce the free-text search on server-paginated reports so each
  // keystroke doesn't fire a request; every other filter applies instantly.
  const [debouncedQ, setDebouncedQ] = useState(filters.q);
  useEffect(() => {
    if (!paginated) {
      setDebouncedQ(filters.q);
      return;
    }
    const t = setTimeout(() => setDebouncedQ(filters.q), 350);
    return () => clearTimeout(t);
  }, [filters.q, paginated]);
  const liveFilters = paginated ? { ...filters, q: debouncedQ } : filters;

  const q = useQuery({
    queryKey: [
      "report-data",
      def.id,
      "server",
      page,
      limit,
      liveFilters.status,
      liveFilters.q,
      liveFilters.buyerId,
      liveFilters.payment,
      liveFilters.from,
      liveFilters.to,
    ],
    queryFn: () => paginatedCall(def, liveFilters, page, limit),
    enabled: paginated,
  });

  const fullQ = useQuery({
    queryKey: ["report-data", def.id, "full"],
    queryFn: () => fullCall(def),
    enabled: !paginated && hasTableColumns,
  });

  const derived = useMemo(() => {
    if (paginated) {
      const d: any = q.data ?? {};
      return { rows: d.data ?? [], total: d.total ?? 0, totalPages: d.total_pages ?? 1 };
    }
    if (!hasTableColumns) return { rows: [], total: 0, totalPages: 1 };
    const rows = applyClientFilters(def, fullQ.data ?? [], filters);
    return { rows, total: rows.length, totalPages: 1 };
  }, [paginated, hasTableColumns, q.data, fullQ.data, filters, def]);

  return {
    rows: derived.rows,
    total: derived.total,
    totalPages: derived.totalPages,
    isLoading: paginated ? q.isLoading : fullQ.isLoading,
    isError: paginated ? q.isError : fullQ.isError,
    error: (paginated ? q.error : fullQ.error) as Error | null,
  };
}

/**
 * Re-fetch every row matching the current filters (not just the active page)
 * so exports honour the same filters as the on-screen view.
 */
export async function collectRowsForExport(def: ReportDef, filters: ReportFilters): Promise<any[]> {
  if (def.serverPaginated) {
    const res = await paginatedCall(def, filters, 1, 5000);
    return res.data ?? [];
  }
  const rows = await fullCall(def);
  return applyClientFilters(def, rows, filters);
}

export function visibleColumnsOf(def: ReportDef) {
  return (def.columns ?? []).filter((c) => !c.hiddenByDefault).map((c) => c.key);
}

/** Default + live visible-column state for a report definition. */
export function useColumnVisibility(def: ReportDef) {
  const [visible, setVisible] = useState<string[]>(() => visibleColumnsOf(def));
  useEffect(() => {
    setVisible(visibleColumnsOf(def));
  }, [def.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return { visible, setVisible };
}

// ─── Header + quick tabs ───────────────────────────────────────────────────

export function ReportHeader({
  def,
  onExcel,
  onPdf,
  busy,
}: {
  def: ReportDef;
  onExcel: () => void;
  onPdf: () => void;
  busy: "excel" | "pdf" | null;
}) {
  const Icon = def.icon;
  return (
    <PageHeader
      eyebrow="Reports"
      title={def.title}
      description={def.description}
      backTo="/app/reporting"
      breadcrumbs={[{ label: "Reports" }]}
      icon={<Icon className="h-5 w-5" />}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onExcel}
            disabled={busy === "excel"}
            className="inline-flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2 text-sm font-medium text-emerald-600 transition hover:bg-emerald-500/20 disabled:opacity-60 dark:text-emerald-300"
          >
            <span className="text-base leading-none">▦</span> Excel
          </button>
          <button
            onClick={onPdf}
            disabled={busy === "pdf"}
            className="inline-flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3.5 py-2 text-sm font-medium text-destructive transition hover:bg-destructive/15 disabled:opacity-60"
          >
            <Printer className="h-4 w-4" /> PDF
          </button>
        </div>
      }
    />
  );
}

export function QuickTabs({ activeId }: { activeId: string }) {
  return (
    <div className="border-b border-border/70 bg-background/95">
      <div className="flex gap-1.5 overflow-x-auto px-1 py-2 [scrollbar-width:thin]">
        {REPORTS.map((r) => {
          const active = r.id === activeId;
          const Icon = r.icon;
          return (
            <Link
              key={r.id}
              to="/app/reporting/$report"
              params={{ report: r.id }}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                active
                  ? "border-primary/30 bg-primary-soft text-primary"
                  : "border-border text-muted-foreground hover:border-primary/25 hover:text-foreground"
              }`}
            >
              <Icon className={`h-3.5 w-3.5 ${active ? "text-primary" : ""}`} />
              {r.cardTitle}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ─── Column picker ─────────────────────────────────────────────────────────

export function ColumnPicker({
  def,
  visible,
  onChange,
}: {
  def: ReportDef;
  visible: string[];
  onChange: (keys: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const cols = def.columns ?? [];
  if (cols.length === 0) return null;

  const allVisible = cols.length === visible.length;
  const toggle = (key: string) => {
    onChange(visible.includes(key) ? visible.filter((k) => k !== key) : [...visible, key]);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        <Columns3 className="h-3.5 w-3.5" />
        Columns
        <span className="rounded bg-muted px-1 font-mono text-[10px]">
          {visible.length}/{cols.length}
        </span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-30 mt-1.5 w-64 rounded-xl border border-border bg-popover p-2 shadow-lg animate-in fade-in slide-in-from-top-1">
            <div className="flex items-center justify-between px-2 pb-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Columns
              </span>
              <button
                onClick={() =>
                  onChange(allVisible ? visibleColumnsOf(def) : cols.map((c) => c.key))
                }
                className="text-[10px] font-medium text-primary hover:underline"
              >
                {allVisible ? "Reset" : "Show all"}
              </button>
            </div>
            <div className="max-h-72 space-y-0.5 overflow-y-auto">
              {cols.map((c) => (
                <label
                  key={c.key}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-primary"
                    checked={visible.includes(c.key)}
                    onChange={() => toggle(c.key)}
                  />
                  <span className="truncate">{c.label}</span>
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Filter bar ────────────────────────────────────────────────────────────

export function ReportFilterBar({
  def,
  filters,
  onChange,
  buyers,
  extra,
}: {
  def: ReportDef;
  filters: ReportFilters;
  onChange: (patch: Partial<ReportFilters>) => void;
  buyers: Array<{ id: string; name: string }>;
  extra?: ReactNode;
}) {
  const f = def.filters;
  const hasAny = f.statuses || f.buyer || f.paymentTypes || f.search || f.dateRange;
  if (!hasAny) return null;

  const inputCls =
    "w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition-all focus:border-primary/50 focus:ring-2 focus:ring-primary/10";
  const labelCls =
    "mb-1 block text-[10px] font-medium uppercase tracking-widest text-muted-foreground";
  const hasDates = !!(filters.from || filters.to);

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      {(f.statuses || f.paymentTypes) && (
        <div className="flex flex-wrap items-center gap-2">
          {f.statuses && (
            <div className="flex items-center gap-1">
              {[{ value: "all", label: "All" }, ...f.statuses].map((s) => (
                <button
                  key={s.value}
                  onClick={() => onChange({ status: s.value })}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                    filters.status === s.value
                      ? "border-primary bg-primary-soft text-primary"
                      : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
          {f.paymentTypes && (
            <>
              <span className="mx-1 h-4 w-px bg-border" />
              {["bulk_pay", "treasury_pay"].map((v) => (
                <label
                  key={v}
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                    filters.payment === v
                      ? "border-primary bg-primary-soft text-primary"
                      : "border-border text-muted-foreground hover:border-primary/25"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-primary"
                    checked={filters.payment === v}
                    onChange={() => onChange({ payment: filters.payment === v ? "" : v })}
                  />
                  {v === "bulk_pay" ? "Bulk Pay" : "Treasury Pay"}
                </label>
              ))}
            </>
          )}
          {extra}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        {f.search && (
          <div className="min-w-[210px] flex-1">
            <span className={labelCls}>Search</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                className={`${inputCls} pl-9`}
                value={filters.q}
                onChange={(e) => onChange({ q: e.target.value })}
                placeholder={f.searchPlaceholder ?? "Search…"}
              />
            </div>
          </div>
        )}

        {f.buyer && (
          <div className="w-52">
            <span className={labelCls}>Buyer</span>
            <select
              className={inputCls}
              value={filters.buyerId}
              onChange={(e) => onChange({ buyerId: e.target.value })}
            >
              <option value="">All buyers</option>
              {buyers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {f.dateRange && (
          <>
            <div className="w-40">
              <span className={labelCls}>{f.dateLabel ? `${f.dateLabel} · from` : "From"}</span>
              <input
                type="date"
                className={inputCls}
                value={filters.from}
                onChange={(e) => onChange({ from: e.target.value })}
              />
            </div>
            <div className="w-40">
              <span className={labelCls}>{f.dateLabel ? `${f.dateLabel} · to` : "To"}</span>
              <input
                type="date"
                className={inputCls}
                value={filters.to}
                onChange={(e) => onChange({ to: e.target.value })}
              />
            </div>
            {hasDates && (
              <button
                onClick={() => onChange({ from: "", to: "" })}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-2 text-xs text-muted-foreground transition hover:border-destructive hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" /> Clear dates
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Pagination ────────────────────────────────────────────────────────────

export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-b-xl border border-t-0 border-border bg-card px-5 py-3 text-xs text-muted-foreground">
      <span>
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          className="rounded-md border border-border px-2.5 py-1 font-medium transition hover:bg-muted disabled:opacity-40"
        >
          ← Prev
        </button>
        <span className="px-1 font-mono text-[11px]">
          Page {page} / {totalPages}
        </span>
        <button
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages}
          className="rounded-md border border-border px-2.5 py-1 font-medium transition hover:bg-muted disabled:opacity-40"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

// ─── Generic data table ────────────────────────────────────────────────────

function numericCol(c: ReportColumn) {
  return ["money", "int", "days", "percent"].includes(c.kind);
}

function CellValue({ col, row }: { col: ReportColumn; row: any }) {
  const raw = col.get ? col.get(row) : row[col.key];
  if (raw === null || raw === undefined || raw === "")
    return <span className="text-muted-foreground/50">—</span>;
  switch (col.kind) {
    case "money":
      return <span className="num">{fmtMoney(raw)}</span>;
    case "percent": {
      const n = Number(raw);
      const pct = Number.isFinite(n) ? (Math.abs(n) <= 1.5 ? n * 100 : n) : n;
      return <span className="num">{Number.isFinite(pct) ? `${Math.round(pct)}%` : "—"}</span>;
    }
    case "date":
      return <span className="whitespace-nowrap">{fmtDate(raw)}</span>;
    case "bool":
      return raw ? (
        <span className="text-success">Yes</span>
      ) : (
        <span className="text-muted-foreground/60">No</span>
      );
    case "days":
      return <span className="num">{Number(raw)}d</span>;
    case "pill": {
      const shown = col.labelFor ? col.labelFor(raw) : String(raw).replace(/_/g, " ");
      return (
        <StatusPill
          status={String(raw)
            .replace(/[^a-z0-9_]/gi, "_")
            .toLowerCase()}
          label={STATUS_LABEL_OVERRIDES[String(raw)] ?? shown}
        />
      );
    }
    case "mono":
      return <span className="font-mono text-xs">{raw}</span>;
    case "int":
      return <span className="num">{Number(raw).toLocaleString("en-US")}</span>;
    default:
      return <span className="line-clamp-2">{raw}</span>;
  }
}

export function ReportTable({
  def,
  rows,
  visible,
  loading,
  emptyHint,
  footer,
}: {
  def: ReportDef;
  rows: any[];
  visible: string[];
  loading?: boolean;
  emptyHint?: string;
  footer?: Array<{ label: string; value: string | number }>;
}) {
  const columns = (def.columns ?? []).filter((c) => visible.includes(c.key));

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card">
        <TableSkeleton rows={6} cols={Math.min(Math.max(columns.length, 4), 10)} />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card">
        <EmptyState
          icon={<ListFilter className="h-5 w-5" />}
          title="No rows match"
          description={
            emptyHint ?? "Try widening the filters — nothing matches the current selection."
          }
        />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="table-premium w-full text-sm">
          <thead className="bg-muted/30 text-xs uppercase tracking-widest text-muted-foreground">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`whitespace-nowrap px-3 py-2.5 font-normal ${numericCol(c) ? "text-right" : "text-left"}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id ?? i} className="border-b border-border/60 hover:bg-muted/30">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-3 py-2.5 align-top ${numericCol(c) ? "text-right" : "text-left"} ${c.kind === "text" ? "max-w-[280px]" : ""}`}
                  >
                    <CellValue col={c} row={r} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer && footer.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/40 font-semibold">
                {columns.map((c, idx) => {
                  const f = footer.find((x) => x.label === c.label);
                  return (
                    <td
                      key={c.key}
                      className={`px-3 py-2.5 ${numericCol(c) ? "text-right" : "text-left"}`}
                    >
                      {f ? f.value : idx === 0 ? "Total" : ""}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ─── Shared toolbar actions row ────────────────────────────────────────────

export function TableToolbar({
  def,
  total,
  visible,
  setVisible,
  extra,
}: {
  def: ReportDef;
  total?: number;
  visible: string[];
  setVisible: (k: string[]) => void;
  extra?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="text-xs text-muted-foreground">
        {total !== undefined && (
          <span>
            {total} {total === 1 ? "row" : "rows"}
          </span>
        )}
        {extra}
      </div>
      <ColumnPicker def={def} visible={visible} onChange={setVisible} />
    </div>
  );
}

// ─── Shared export runner for tabular reports ──────────────────────────────

export async function runTabularExport(
  kind: "excel" | "pdf",
  def: ReportDef,
  heading: ExportHeading,
  rows: any[],
  visible: string[],
) {
  const columns = (def.columns ?? []).filter((c) => visible.includes(c.key));
  if (columns.length === 0)
    throw new Error("No columns are visible — enable at least one column to export");
  if (kind === "excel") {
    exportExcelReport(def.title, heading, columns, rows);
  } else {
    await printPdfReport(def.title, heading, columns, rows);
  }
}

export { fmtDate, fmtMoney };
