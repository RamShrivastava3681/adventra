// ===========================================================================
// TransactionFilters — shared filter bar for the transaction list pages
// (invoices, orders, GRN, quotations, dispatches, proformas, notes, advances,
// expenses). Provides four controls in one bar:
//   1. Search        — free-text match against page-configured fields
//   2. Status        — dropdown of every status (with counts), replaces chips
//   3. From / To     — date range on the document's main date
//   4. Arrange by    — sort by the dates that exist for that document type
//                      (created / issue / due …), newest or oldest first
// All filtering/sorting happens client-side; the component hands the filtered
// result to `children` so pages keep rendering their own table.
// ===========================================================================

import { useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";

export type TxSortField<T> = {
  /** Stable id, e.g. "created" — combined with "-asc"/"-desc" for the select. */
  value: string;
  /** Human label, e.g. "Created date". */
  label: string;
  /** Returns the row's date value for this field (YYYY-MM-DD or ISO). */
  get: (item: T) => string | null | undefined;
};

export type TxFiltersConfig<T> = {
  searchPlaceholder?: string;
  /** Return every searchable string for a row (numbers, debtor, supplier…). */
  search: (item: T) => Array<string | null | undefined>;
  /** Status dimension. Omit (or leave null) to hide the status dropdown. */
  statusField?: (item: T) => string | null | undefined;
  /** Label map for status values (falls back to the raw value). */
  statusLabel?: Record<string, string>;
  /** Preferred ordering of status values in the dropdown. */
  statusOrder?: string[];
  /** The document's main date — used by the From/To range filter. */
  dateField: (item: T) => string | null | undefined;
  /** Label for the main date, e.g. "Issue date". */
  dateLabel?: string;
  /** Dates available for sorting — each becomes newest-first + oldest-first. */
  sortFields: TxSortField<T>[];
  /** Default sort, e.g. "issue-desc". Defaults to first sort field, desc. */
  defaultSort?: string;
};

const inputCls =
  "w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition-all focus:border-primary/50 focus:ring-2 focus:ring-primary/10";
const labelCls =
  "mb-1 block text-[10px] font-medium uppercase tracking-widest text-muted-foreground";

export function TransactionFilters<T>({
  data,
  config,
  children,
}: {
  data: T[];
  config: TxFiltersConfig<T>;
  children: (filtered: T[]) => ReactNode;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState(
    config.defaultSort ?? `${config.sortFields[0]?.value ?? "created"}-desc`,
  );

  // Status options are derived from the data so every status that actually
  // exists shows up, with its count, in the configured order.
  const statusOptions = (() => {
    if (!config.statusField) return [];
    const counts = new Map<string, number>();
    for (const item of data) {
      const s = config.statusField(item);
      if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    const order = config.statusOrder ?? [];
    const known = order.filter((v) => counts.has(v));
    const rest = [...counts.keys()]
      .filter((v) => !order.includes(v))
      .sort((a, b) => a.localeCompare(b));
    return [...known, ...rest].map((v) => ({
      value: v,
      label: `${config.statusLabel?.[v] ?? v} (${counts.get(v)})`,
    }));
  })();

  const sortOptions = config.sortFields.flatMap((f) => [
    { value: `${f.value}-desc`, label: `${f.label} · newest first` },
    { value: `${f.value}-asc`, label: `${f.label} · oldest first` },
  ]);

  let filtered = data;
  const query = q.trim().toLowerCase();
  if (query) {
    filtered = filtered.filter((item) =>
      config.search(item).some((s) => (s ?? "").toString().toLowerCase().includes(query)),
    );
  }
  if (config.statusField && status !== "all") {
    filtered = filtered.filter((item) => config.statusField!(item) === status);
  }
  if (dateFrom || dateTo) {
    filtered = filtered.filter((item) => {
      const d = config.dateField(item) ?? "";
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      return true;
    });
  }
  const [field, dir] = sort.split("-");
  const sf = config.sortFields.find((f) => f.value === field);
  if (sf) {
    const sign = dir === "asc" ? 1 : -1;
    filtered = [...filtered].sort((a, b) => {
      const av = sf.get(a) ?? "";
      const bv = sf.get(b) ?? "";
      return av.localeCompare(bv) * sign;
    });
  }

  const hasFilters = q !== "" || status !== "all" || dateFrom !== "" || dateTo !== "";

  const clear = () => {
    setQ("");
    setStatus("all");
    setDateFrom("");
    setDateTo("");
  };

  return (
    <div>
      <div className="flex shrink-0 flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4 overflow-x-auto">
        <div className="min-w-[220px] flex-1">
          <span className={labelCls}>Search</span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              className={`${inputCls} pl-9`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={config.searchPlaceholder ?? "Search…"}
            />
          </div>
        </div>

        {statusOptions.length > 0 && (
          <div className="w-48">
            <span className={labelCls}>Status</span>
            <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">All statuses</option>
              {statusOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="w-40">
          <span className={labelCls}>
            {config.dateLabel ? `${config.dateLabel} · from` : "From"}
          </span>
          <input
            type="date"
            className={inputCls}
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>

        <div className="w-40">
          <span className={labelCls}>{config.dateLabel ? `${config.dateLabel} · to` : "To"}</span>
          <input
            type="date"
            className={inputCls}
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>

        <div className="w-52">
          <span className={labelCls}>Arrange by</span>
          <select className={inputCls} value={sort} onChange={(e) => setSort(e.target.value)}>
            {sortOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {hasFilters && (
          <button
            onClick={clear}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-2 text-xs text-muted-foreground transition hover:border-destructive hover:text-destructive"
            title="Clear all filters"
          >
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        )}
      </div>
      <div className="mt-4">{children(filtered)}</div>
    </div>
  );
}

export default TransactionFilters;
