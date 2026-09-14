import { useState } from "react";
import type { Product } from "@/routes/app.products";
import { ProductThumb } from "@/components/product-thumb";
import { fmtMoney } from "@/components/ledger-ui";
import { TableSkeleton } from "@/components/skeletons";
import { copySku } from "@/components/sku-shared";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";

/* ────────────────────────────────────────────────────────────────────────────
 * Products & SKUs catalogue presentation.
 * Display only: hierarchy, stock summaries and filters are computed from the
 * existing product / movement data in app.products.tsx and passed in as
 * view-model rows. No new data fetching, no new calculations.
 * ──────────────────────────────────────────────────────────────────────── */

export type StockState = "out" | "low" | "ok";

/** Existing stock rule: out at zero, low at/below the SKU's reorder level. */
export function stockStateOf(stock: number, reorderLevel: number): StockState {
  if (stock <= 0) return "out";
  if (stock <= reorderLevel) return "low";
  return "ok";
}

export interface ColourNode {
  colour: Product;
  sizes: Product[];
}

export interface MasterRow {
  master: Product;
  colours: ColourNode[];
  /** Leaf (sellable) SKUs in this family, including a childless master itself. */
  sellables: Product[];
  inStock: number;
  lowStock: number;
  outStock: number;
  familyStock: number;
  familyState: StockState;
}

export interface SellableRow {
  item: Product;
  master: Product;
  colour: string;
  size: string;
  stock: number;
  state: StockState;
}

export type CatalogueTab = "products" | "sellable";

/* ── Small primitives ─────────────────────────────────────────────────── */

export function SkuCode({ code, strong = false }: { code: string; strong?: boolean }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <span
        className={`truncate font-mono ${strong ? "text-[13px] font-semibold text-foreground" : "text-xs font-medium text-foreground"}`}
        title={code}
      >
        {code}
      </span>
      <button
        type="button"
        onClick={() => copySku(code)}
        title={`Copy ${code}`}
        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-primary"
      >
        <Copy className="h-3 w-3" />
      </button>
    </span>
  );
}

export function StockStatePill({ state }: { state: StockState }) {
  if (state === "out")
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-destructive">
        <span className="h-1.5 w-1.5 rounded-full bg-destructive" /> Out of Stock
      </span>
    );
  if (state === "low")
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-sem-attention">
        <span className="h-1.5 w-1.5 rounded-full bg-sem-attention" /> Low Stock
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-sem-success">
      <span className="h-1.5 w-1.5 rounded-full bg-sem-success" /> In Stock
    </span>
  );
}

export function ActivePill({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-sem-success">
      <span className="h-1.5 w-1.5 rounded-full bg-sem-success" /> Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" /> Inactive
    </span>
  );
}

export function Pager({
  page,
  totalPages,
  from,
  to,
  total,
  onPage,
}: {
  page: number;
  totalPages: number;
  from: number;
  to: number;
  total: number;
  onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
      <span>
        Showing {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onPage(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40"
          aria-label="Previous page"
        >
          <ChevronRight className="h-3.5 w-3.5 rotate-180" />
        </button>
        <span className="px-1 font-medium">
          {page} / {totalPages}
        </span>
        <button
          onClick={() => onPage(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40"
          aria-label="Next page"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/* ── Tabs ─────────────────────────────────────────────────────────────── */

export function CatalogueTabs({
  tab,
  onTab,
  productCount,
  sellableCount,
}: {
  tab: CatalogueTab;
  onTab: (t: CatalogueTab) => void;
  productCount: number;
  sellableCount: number;
}) {
  const tabs: Array<{ key: CatalogueTab; label: string; count: number }> = [
    { key: "products", label: "Products", count: productCount },
    { key: "sellable", label: "Sellable SKUs", count: sellableCount },
  ];
  return (
    <div className="border-b border-border bg-background">
      <div className="mx-auto w-full max-w-[1440px] px-4 md:px-8">
        <nav className="flex gap-1" aria-label="Catalogue sections">
          {tabs.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => onTab(t.key)}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap border-b-2 px-3.5 py-2.5 text-[13px] transition-colors ${
                  active
                    ? "border-primary font-semibold text-primary"
                    : "border-transparent font-medium text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}{" "}
                <span className={active ? "text-primary/70" : "text-muted-foreground/70"}>
                  ({t.count})
                </span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

/* ── Search + filter toolbar ──────────────────────────────────────────── */

export interface ToolbarFilters {
  q: string;
  cat: string;
  gender: string;
  colour: string;
  size: string;
  status: string;
  sort: string;
}

export function CatalogueToolbar({
  f,
  set,
  categories,
  genders,
  colours,
  sizes,
  resultCount,
  onClear,
  filtersActive,
  canWrite,
  marginInput,
  onMarginInput,
  onSaveMargin,
  marginPending,
  defaultMargin,
}: {
  f: ToolbarFilters;
  set: (patch: Partial<ToolbarFilters>) => void;
  categories: string[];
  genders: Array<{ name: string; code: string }>;
  colours: Array<{ name: string; code: string }>;
  sizes: Array<{ id: string; name: string }>;
  resultCount: number;
  onClear: () => void;
  filtersActive: boolean;
  canWrite: boolean;
  marginInput: string;
  onMarginInput: (v: string) => void;
  onSaveMargin: () => void;
  marginPending: boolean;
  defaultMargin: number;
}) {
  const selectCls =
    "h-9 rounded-md border border-border bg-card px-2.5 text-[13px] text-foreground focus:border-primary focus:outline-none";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[220px] flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={f.q}
          onChange={(e) => set({ q: e.target.value })}
          placeholder="Search product, SKU or model number..."
          aria-label="Search products"
          className="h-9 w-full rounded-md border border-border bg-card pl-9 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
        />
      </div>
      <select
        value={f.cat}
        onChange={(e) => set({ cat: e.target.value })}
        aria-label="Filter by category"
        className={selectCls}
      >
        <option value="all">Category: All</option>
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <select
        value={f.gender}
        onChange={(e) => set({ gender: e.target.value })}
        aria-label="Filter by gender"
        className={selectCls}
      >
        <option value="all">Gender: All</option>
        {genders.map((g) => (
          <option key={g.code} value={g.code}>
            {g.name}
          </option>
        ))}
      </select>
      <select
        value={f.colour}
        onChange={(e) => set({ colour: e.target.value })}
        aria-label="Filter by colour"
        className={selectCls}
      >
        <option value="all">Colour: All</option>
        {colours.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </select>
      <select
        value={f.size}
        onChange={(e) => set({ size: e.target.value })}
        aria-label="Filter by size"
        className={selectCls}
      >
        <option value="all">Size: All</option>
        {sizes.map((s) => (
          <option key={s.id} value={s.name}>
            {s.name}
          </option>
        ))}
      </select>
      <select
        value={f.status}
        onChange={(e) => set({ status: e.target.value })}
        aria-label="Filter by status"
        className={selectCls}
      >
        <option value="all">Status: All</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </select>
      <select
        value={f.sort}
        onChange={(e) => set({ sort: e.target.value })}
        aria-label="Sort"
        className={selectCls}
      >
        <option value="sku">Sort: SKU</option>
        <option value="name">Sort: Product Name</option>
        <option value="stock">Sort: Stock Status</option>
      </select>
      {filtersActive && (
        <button
          onClick={onClear}
          className="inline-flex h-9 items-center gap-1 rounded-md border border-border px-3 text-xs font-medium text-muted-foreground hover:border-primary/40 hover:text-primary"
        >
          <X className="h-3.5 w-3.5" /> Clear
        </button>
      )}
      <div className="ml-auto flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{resultCount} shown</span>
        {canWrite && (
          <>
            <label className="hidden items-center gap-1.5 xl:inline-flex">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Margin %
              </span>
              <input
                type="number"
                step="0.5"
                min="1"
                max="99"
                value={marginInput}
                onChange={(e) => onMarginInput(e.target.value)}
                className="h-9 w-16 rounded-md border border-border bg-card px-2 text-[13px] outline-none transition-all focus:border-primary/50"
              />
            </label>
            <button
              onClick={onSaveMargin}
              disabled={marginPending}
              className="hidden h-9 items-center gap-1.5 rounded-md border border-border/60 px-3 text-[11px] font-medium text-muted-foreground transition-all hover:border-border hover:bg-muted/30 hover:text-foreground disabled:opacity-50 xl:inline-flex"
              title={`Catalogue default margin (currently ${Math.round(defaultMargin * 100)}%)`}
            >
              {marginPending && <Loader2 className="h-3 w-3 animate-spin" />}
              {marginPending ? "Saving…" : "Save"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Products tab ─────────────────────────────────────────────────────── */

function RowMenu({ children }: { children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
          aria-label="More actions"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProductsTable({
  rows,
  pageItems,
  loading,
  canWrite,
  emptyFiltered,
  stockOf,
  onClearFilters,
  onCreate,
  onView,
  onAddColour,
  onAddSize,
  onEditPrices,
  onDelete,
  onViewSellables,
  pager,
}: {
  rows: MasterRow[];
  pageItems: MasterRow[];
  loading: boolean;
  canWrite: boolean;
  emptyFiltered: boolean;
  stockOf: (id: string) => number;
  onClearFilters: () => void;
  onCreate: () => void;
  onView: (m: Product) => void;
  onAddColour: (m: Product) => void;
  onAddSize: (c: Product) => void;
  onEditPrices: (p: Product) => void;
  onDelete: (p: Product) => void;
  onViewSellables: (m: Product) => void;
  pager: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [openColours, setOpenColours] = useState<Set<string>>(new Set());
  const toggle = (set: Set<string>, id: string, apply: (n: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    apply(next);
  };

  if (loading) return <TableSkeleton rows={8} cols={8} />;
  if (rows.length === 0) {
    return emptyFiltered ? (
      <div className="py-12 text-center">
        <p className="text-sm font-medium text-foreground">No products match these filters</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Try a different search or clear filters.
        </p>
        <button
          onClick={onClearFilters}
          className="mt-3 rounded-md border border-border px-4 py-2 text-xs font-medium hover:border-primary hover:text-primary"
        >
          Clear filters
        </button>
      </div>
    ) : (
      <div className="py-12 text-center">
        <p className="text-sm font-medium text-foreground">No products yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Create your first Master SKU to start building your catalogue.
        </p>
        {canWrite && (
          <button
            onClick={onCreate}
            className="mt-3 inline-flex items-center gap-1.5 rounded-[10px] bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:-translate-y-px hover:shadow-md"
          >
            <Plus className="h-3.5 w-3.5" /> Create Master SKU
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="-mx-5 overflow-x-auto table-wrap">
        <table className="table-premium w-full min-w-[880px] text-sm">
          <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr className="border-b border-border bg-muted/40">
              <th className="w-8 px-2 py-2" aria-label="Expand" />
              <th className="px-4 py-2 text-left font-medium">Product</th>
              <th className="px-4 py-2 text-left font-medium">Master SKU</th>
              <th className="px-4 py-2 text-left font-medium">Category</th>
              <th className="px-4 py-2 text-left font-medium">Gender</th>
              <th className="px-4 py-2 text-left font-medium">Variants</th>
              <th className="px-4 py-2 text-left font-medium">Stock Summary</th>
              <th className="px-4 py-2 text-left font-medium">Status</th>
              <th className="px-4 py-2 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((r) => {
              const m = r.master;
              const isOpen = expanded.has(m.id);
              return (
                <>
                  <tr
                    key={m.id}
                    className={`border-b border-border/60 transition-colors hover:bg-muted/30 ${isOpen ? "bg-muted/20" : ""}`}
                  >
                    <td className="px-2 py-2.5">
                      <button
                        onClick={() => toggle(expanded, m.id, setExpanded)}
                        aria-expanded={isOpen}
                        aria-label={isOpen ? "Collapse variants" : "Expand variants"}
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <ProductThumb imageUrl={m.image_url} name={m.name} />
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-medium text-foreground">
                            {m.name}
                          </div>
                          <div className="font-mono text-[11px] text-muted-foreground">
                            {m.model ?? "—"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <SkuCode code={m.sku} />
                    </td>
                    <td className="px-4 py-2.5 text-[13px] text-muted-foreground">
                      {m.category ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-[13px] text-muted-foreground">
                      {m.gender ?? "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => toggle(expanded, m.id, setExpanded)}
                        className="text-left text-[13px] text-foreground hover:text-primary"
                        title={isOpen ? "Collapse" : "Expand hierarchy"}
                      >
                        <span className="font-medium">{r.sellables.length}</span>{" "}
                        <span className="text-muted-foreground">
                          sellable variant{r.sellables.length === 1 ? "" : "s"}
                        </span>
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{r.sellables.length}</span>{" "}
                      variants · <span className="font-medium text-sem-success">{r.inStock}</span>{" "}
                      in stock ·{" "}
                      <span className="font-medium text-sem-attention">{r.lowStock}</span> low ·{" "}
                      <span className="font-medium text-destructive">{r.outStock}</span> out
                    </td>
                    <td className="px-4 py-2.5">
                      <ActivePill active={m.status === "active"} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          onClick={() => onView(m)}
                          className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-sm transition-all hover:-translate-y-px hover:shadow-md"
                        >
                          <Eye className="h-3.5 w-3.5" /> View
                        </button>
                        {canWrite && (
                          <RowMenu>
                            <DropdownMenuItem onClick={() => onEditPrices(m)}>
                              <Pencil className="h-3.5 w-3.5" /> Edit prices
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onAddColour(m)}>
                              <Plus className="h-3.5 w-3.5" /> Add Colour Variant
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onViewSellables(m)}>
                              <Eye className="h-3.5 w-3.5" /> View Sellable SKUs
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => onDelete(m)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Delete Master SKU
                            </DropdownMenuItem>
                          </RowMenu>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr key={`${m.id}-tree`} className="border-b border-border/60 bg-muted/20">
                      <td />
                      <td colSpan={8} className="px-4 py-3">
                        <HierarchyTree
                          row={r}
                          openColours={openColours}
                          onToggleColour={(id) => toggle(openColours, id, setOpenColours)}
                          canWrite={canWrite}
                          stockOf={stockOf}
                          onView={onView}
                          onAddColour={() => onAddColour(m)}
                          onAddSize={onAddSize}
                        />
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
      {pager}
    </>
  );
}

/** Inline expandable Master → Colour → Sellable tree. */
function HierarchyTree({
  row,
  openColours,
  onToggleColour,
  canWrite,
  stockOf,
  onView,
  onAddColour,
  onAddSize,
}: {
  row: MasterRow;
  openColours: Set<string>;
  onToggleColour: (id: string) => void;
  canWrite: boolean;
  stockOf: (id: string) => number;
  onView: (m: Product) => void;
  onAddColour: () => void;
  onAddSize: (c: Product) => void;
}) {
  const m = row.master;
  return (
    <div className="max-w-3xl text-[13px]">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <span>
          Product: <span className="font-medium text-foreground">{m.name}</span>
        </span>
        <span>
          Category: <span className="font-medium text-foreground">{m.category ?? "—"}</span>
        </span>
        <span>
          Gender: <span className="font-medium text-foreground">{m.gender ?? "—"}</span>
        </span>
        <button onClick={() => onView(m)} className="font-medium text-primary hover:underline">
          Open detail
        </button>
      </div>
      <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Colour Variants
      </p>
      {row.colours.length === 0 && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
          <span>No colour variants yet — add one to start selling.</span>
          {canWrite && (
            <button
              onClick={onAddColour}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium hover:border-primary hover:text-primary"
            >
              <Plus className="h-3 w-3" /> Add colour
            </button>
          )}
        </div>
      )}
      <div className="mt-2 space-y-2">
        {row.colours.map((n) => {
          const open = openColours.has(n.colour.id);
          return (
            <div key={n.colour.id} className="rounded-lg border border-border/70 bg-card">
              <button
                onClick={() => onToggleColour(n.colour.id)}
                aria-expanded={open}
                className="flex w-full items-center gap-2 px-3 py-2 text-left"
              >
                {open ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="font-medium text-foreground">
                  {n.colour.color ?? n.colour.name}
                </span>
                <SkuCode code={n.colour.sku} />
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {n.sizes.length} sellable SKU{n.sizes.length === 1 ? "" : "s"}
                </span>
              </button>
              {open && (
                <div className="border-t border-border/60 px-3 py-2">
                  {n.sizes.length === 0 ? (
                    <div className="flex items-center justify-between gap-2 py-1 text-xs text-muted-foreground">
                      <span>Colour variant only — no sizes yet.</span>
                      {canWrite && (
                        <button
                          onClick={() => onAddSize(n.colour)}
                          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium hover:border-primary hover:text-primary"
                        >
                          <Plus className="h-3 w-3" /> Add size
                        </button>
                      )}
                    </div>
                  ) : (
                    <ul className="divide-y divide-border/50">
                      {n.sizes.map((s) => (
                        <li key={s.id} className="flex items-center gap-2 py-1.5 text-[13px]">
                          <span className="w-14 shrink-0 pl-5 text-muted-foreground">
                            {s.size ?? "—"}
                          </span>
                          <SkuCode code={s.sku} />
                          <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                            {s.unit_price ? fmtMoney(s.unit_price) : "—"}
                          </span>
                          <span className="shrink-0 font-mono text-xs text-muted-foreground">
                            stk {stockOf(s.id).toLocaleString()}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Sellable SKUs tab ────────────────────────────────────────────────── */

export function SellableTable({
  rows,
  pageItems,
  loading,
  canWrite,
  emptyFiltered,
  masterFilter,
  onClearMasterFilter,
  onClearFilters,
  onCreate,
  onViewMaster,
  onEditPrices,
  onDelete,
  pager,
}: {
  rows: SellableRow[];
  pageItems: SellableRow[];
  loading: boolean;
  canWrite: boolean;
  emptyFiltered: boolean;
  masterFilter: { sku: string; name: string } | null;
  onClearMasterFilter: () => void;
  onClearFilters: () => void;
  onCreate: () => void;
  onViewMaster: (m: Product) => void;
  onEditPrices: (p: Product) => void;
  onDelete: (p: Product) => void;
  pager: React.ReactNode;
}) {
  if (loading) return <TableSkeleton rows={8} cols={10} />;
  if (rows.length === 0) {
    return emptyFiltered || masterFilter ? (
      <div className="py-12 text-center">
        <p className="text-sm font-medium text-foreground">No sellable SKUs match</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Try a different search or clear filters.
        </p>
        <button
          onClick={() => {
            onClearMasterFilter();
            onClearFilters();
          }}
          className="mt-3 rounded-md border border-border px-4 py-2 text-xs font-medium hover:border-primary hover:text-primary"
        >
          Clear filters
        </button>
      </div>
    ) : (
      <div className="py-12 text-center">
        <p className="text-sm font-medium text-foreground">No sellable SKUs yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Create a Colour Variant and Size Variant under a Master SKU.
        </p>
        {canWrite && (
          <button
            onClick={onCreate}
            className="mt-3 inline-flex items-center gap-1.5 rounded-[10px] bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:-translate-y-px hover:shadow-md"
          >
            <Plus className="h-3.5 w-3.5" /> Create Master SKU
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      {masterFilter && (
        <button
          onClick={onClearMasterFilter}
          className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
        >
          Sellable SKUs for {masterFilter.sku} <X className="h-3 w-3" />
        </button>
      )}
      {/* Mobile cards */}
      <div className="grid gap-3 md:hidden">
        {pageItems.map((r) => (
          <div key={r.item.id} className="rounded-xl border border-border bg-card p-4">
            <SkuCode code={r.item.sku} strong />
            <p className="mt-1 truncate text-[13px] text-muted-foreground">
              {r.master.name} · {r.master.model ?? ""}
            </p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {r.colour} · {r.size}
            </p>
            <div className="mt-3 flex items-end justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Available
                </p>
                <p className="num text-xl font-semibold text-foreground">
                  {r.stock.toLocaleString()}
                </p>
              </div>
              <StockStatePill state={r.state} />
            </div>
            <div className="mt-3 flex justify-end">
              <button
                onClick={() => onViewMaster(r.master)}
                className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-sm"
              >
                <Eye className="h-3.5 w-3.5" /> View
              </button>
            </div>
          </div>
        ))}
      </div>
      {/* Desktop / tablet table */}
      <div className="hidden md:block">
        <div className="-mx-5 overflow-x-auto table-wrap">
          <table className="table-premium w-full min-w-[1020px] text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-2 text-left font-medium">Sellable SKU</th>
                <th className="px-4 py-2 text-left font-medium">Product</th>
                <th className="px-4 py-2 text-left font-medium">Colour</th>
                <th className="px-4 py-2 text-left font-medium">Size</th>
                <th className="px-4 py-2 text-left font-medium">Master SKU</th>
                <th className="px-4 py-2 text-right font-medium">On Hand</th>
                <th className="px-4 py-2 text-right font-medium">Reserved</th>
                <th className="px-4 py-2 text-right font-medium">Available</th>
                <th className="px-4 py-2 text-left font-medium">Stock Status</th>
                <th className="px-4 py-2 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((r) => (
                <tr
                  key={r.item.id}
                  className="border-b border-border/60 transition-colors hover:bg-muted/30"
                >
                  <td className="px-4 py-2.5">
                    <SkuCode code={r.item.sku} strong />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="text-[13px] font-medium text-foreground">{r.master.name}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {r.master.model ?? "—"}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-[13px] text-muted-foreground">{r.colour}</td>
                  <td className="px-4 py-2.5 text-[13px] text-muted-foreground">{r.size}</td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => onViewMaster(r.master)}
                      title="Open Master SKU"
                      className="font-mono text-xs text-primary hover:underline"
                    >
                      {r.master.sku}
                    </button>
                  </td>
                  <td className="num px-4 py-2.5 text-right text-[13px] font-medium">
                    {r.stock.toLocaleString()}
                  </td>
                  <td className="num px-4 py-2.5 text-right text-[13px] text-muted-foreground">
                    —
                  </td>
                  <td className="num px-4 py-2.5 text-right text-[13px] font-medium">
                    {r.stock.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5">
                    <StockStatePill state={r.state} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        onClick={() => onViewMaster(r.master)}
                        className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-sm transition-all hover:-translate-y-px hover:shadow-md"
                      >
                        <Eye className="h-3.5 w-3.5" /> View
                      </button>
                      {canWrite && (
                        <RowMenu>
                          <DropdownMenuItem onClick={() => onEditPrices(r.item)}>
                            <Pencil className="h-3.5 w-3.5" /> Edit prices
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => onDelete(r.item)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Delete sellable SKU
                          </DropdownMenuItem>
                        </RowMenu>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Available equals on-hand — the application does not track per-SKU reservations.
      </p>
      {pager}
    </>
  );
}
