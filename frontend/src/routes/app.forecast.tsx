import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import api from "@/lib/api-client";
import { useSignedImageUrl } from "@/lib/s3-image";
import {
  bucketMovementsByMonth,
  currentMonthBucket,
  forecastSKU,
  MONTH_NAMES,
  computeVelocityByCategory,
  computePricingStrategy,
  recomputeTimeline,
  type ForecastResult,
  type MomentumTag,
  type VelocityTag,
  type PricingStrategyResult,
  type CategoryVelocityInput,
} from "@/lib/forecast-engine";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpDown,
  BadgePercent,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  Loader2,
  Minus,
  Package,
  Pencil,
  RefreshCw,
  Save,
  Search,
  SearchX,
  ShoppingCart,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from "recharts";
import { toast } from "sonner";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/app/forecast")({
  component: ForecastPage,
});

type Product = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  reorder_level: number;
  max_stock: number;
  lead_time_days: number;
  safety_stock_days: number;
  unit_price: number;
  unit_cost: number;
  minimum_gross_margin_percentage: number | null;
  status: string;
  image_url: string | null;
};

type Analysis = {
  product: Product;
  stock: number;
  forecast: ForecastResult;
  velocityTag: VelocityTag;
  pricingStrategy: PricingStrategyResult | null;
};

type FilterT =
  | "all"
  | "reorder"
  | "fast"
  | "medium"
  | "slow"
  | "accelerating"
  | "declining"
  | "out"
  | "critical";

type SortKey = "velocity" | "reorder" | "cover" | "stockout" | "trend";

// Deep-convert snake_case object keys to camelCase (the backend transform
// middleware snake_cases every response key, so we restore them here).
function snakeToCamelDeep(value: unknown): any {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => snakeToCamelDeep(v));
  if (typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value as Record<string, any>)) {
      out[k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = snakeToCamelDeep(v);
    }
    return out;
  }
  return value;
}

function ForecastPage() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FilterT>("all");
  const [category, setCategory] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortKey>("reorder");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const PAGE_SIZE = 10;

  // Tick every minute so date-sensitive fields (estimatedStockoutDate,
  // reorderByDate, nextRefillDate, days of cover) are recomputed against the
  // live clock instead of staying frozen at page-load time.
  const [clockTick, setClockTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setClockTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const productsQ = useQuery({
    queryKey: ["products-forecast"],
    queryFn: async () => {
      const data = await api.products.list();
      return data
        .filter((p: any) => p.status === "active")
        .map((p: any) => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          category: p.category,
          reorder_level: p.reorderLevel ?? p.reorder_level,
          max_stock: p.maxStock ?? p.max_stock,
          lead_time_days: p.leadTimeDays ?? p.lead_time_days,
          safety_stock_days: p.safetyStockDays ?? p.safety_stock_days ?? 30,
          unit_price: p.unitPrice ?? p.unit_price,
          unit_cost: p.unitCost ?? p.unit_cost,
          minimum_gross_margin_percentage:
            p.minimumGrossMarginPercentage ?? p.minimum_gross_margin_percentage ?? null,
          status: p.status,
          image_url: p.imageUrl ?? p.image_url ?? null,
        }))
        .sort((a: any, b: any) => a.sku?.localeCompare(b.sku ?? "") ?? 0);
    },
    refetchInterval: 60_000, // keep SKU data current (lead times, prices, …)
  });

  // Catalogue-wide default minimum margin — used by products without their own.
  const catalogueSettingsQ = useQuery({
    queryKey: ["catalogue-settings"],
    queryFn: async () => api.catalogueSettings.get(),
  });
  const defaultMargin = catalogueSettingsQ.data?.default_minimum_margin ?? 0.4;

  const movementsQ = useQuery({
    queryKey: ["movements-forecast"],
    queryFn: async () => {
      const data = await api.stockMovements.list();
      // Live stock counts CONFIRMED movements only (drafts/cancelled don't move stock)
      return data
        .filter((m: any) => (m.status ?? "confirmed") === "confirmed")
        .map((m: any) => ({
          product_id: m.productId ?? m.product_id,
          direction: m.direction,
          quantity: m.quantity,
          movement_date: m.movementDate ?? m.movement_date,
        }));
    },
    refetchInterval: 60_000, // live stock levels — sales/stock-ins flow in every minute
  });

  // Fetch server-side persisted forecasts (auto-fresh via ensureFresh on backend)
  const forecastVarsQ = useQuery({
    queryKey: ["forecast-variables"],
    queryFn: async () => {
      // The backend's transform middleware converts every response key to
      // snake_case (product_id, final_forecast, days_of_cover, …). Convert it
      // back to camelCase so the forecast engine + UI below can read it.
      const data = await api.forecastVariables.list();
      return snakeToCamelDeep(data);
    },
    staleTime: 60_000, // 1 min — backend auto-refresh on first request of the day
    refetchInterval: 60_000, // re-pull persisted snapshots + trigger ensureFresh every minute
  });

  // Recompute mutation
  const recomputeMutation = useMutation({
    mutationFn: () => api.forecastVariables.recompute(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["forecast-variables"] });
    },
  });

  const analyses = useMemo(() => {
    // Try server-side persisted forecasts first
    const fv = forecastVarsQ.data;
    if (fv && fv.snapshots && fv.snapshots.length > 0 && fv.products && fv.products.length > 0) {
      // Build a map of products from the server response
      const productMap = new Map<string, any>();
      for (const p of fv.products) {
        productMap.set(p.id, {
          id: p.id,
          sku: p.sku,
          name: p.name,
          category: p.category,
          reorder_level: p.reorderLevel ?? p.reorder_level ?? 0,
          max_stock: p.maxStock ?? p.max_stock ?? 0,
          lead_time_days: p.leadTimeDays ?? p.lead_time_days ?? 14,
          safety_stock_days: p.safetyStockDays ?? p.safety_stock_days ?? 30,
          unit_price: p.unitPrice ?? p.unit_price ?? 0,
          unit_cost: p.unitCost ?? p.unit_cost ?? 0,
          minimum_gross_margin_percentage:
            p.minimumGrossMarginPercentage ?? p.minimum_gross_margin_percentage ?? null,
          status: p.status ?? "active",
          image_url: p.imageUrl ?? p.image_url ?? null,
        });
      }

      // Build a map of snapshots by productId — keep the NEWEST snapshot per
      // product. Raced recomputes can leave duplicate rows behind, and the
      // backend returns them newest-first; without this guard a stale zero
      // snapshot can overwrite the fresh one and the page renders dead/0.
      const snapshotMap = new Map<string, any>();
      for (const s of fv.snapshots) {
        const cur = snapshotMap.get(s.productId);
        if (!cur || newerSnapshot(s, cur)) snapshotMap.set(s.productId, s);
      }

      const rows: Analysis[] = [];
      for (const [id, product] of productMap) {
        const snapshot = snapshotMap.get(id);
        if (!snapshot) continue;

        // Calculate stock from movements (needed for timeline recomputation)
        const moves = (movementsQ.data ?? []).filter((m: any) => m.product_id === id);
        let stock = 0;
        for (const m of moves) stock += (m.direction === "in" ? 1 : -1) * Number(m.quantity);

        // Live current-month outbound sales — drives the pace adjustment factor
        const curMonthKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
        let currentMonthOutbound = 0;
        for (const m of moves) {
          if (m.direction === "out" && (m.movement_date ?? "").slice(0, 7) === curMonthKey)
            currentMonthOutbound += Number(m.quantity);
        }

        const f = recomputeTimeline(
          snapshot.forecast as ForecastResult,
          stock,
          product.lead_time_days,
          currentMonthOutbound,
        );

        rows.push({
          product,
          stock,
          forecast: f,
          velocityTag: snapshot.velocityTag ?? f.velocityTag ?? "dead",
          pricingStrategy: null as PricingStrategyResult | null,
        });
      }

      // Recompute category-based velocity for every SKU (same pass as the
      // client-side fallback below). Defensive: persisted snapshots may carry
      // the engine's hardcoded "dead" placeholder if they were computed before
      // the backend started persisting the real velocity tag.
      const velInputs: CategoryVelocityInput[] = rows.map((r) => ({
        productId: r.product.id,
        category: r.product.category,
        recent3MonthAvg: r.forecast.calculationBreakdown?.momentum?.recent3MonthAvg ?? 0,
      }));
      const velocityMap = computeVelocityByCategory(velInputs);
      for (const row of rows) {
        const vt = velocityMap.get(row.product.id);
        if (vt) {
          row.velocityTag = vt;
          row.forecast.velocityTag = vt;
        }
      }

      // Compute pricing strategy for each SKU (needs local data)
      for (const row of rows) {
        const p = row.product;
        const f = row.forecast;
        row.pricingStrategy = computePricingStrategy({
          velocity: row.velocityTag,
          momentum: f.momentumTag,
          daysOfCover: f.daysOfCover,
          unitCost: Number(p.unit_cost),
          unitPrice: Number(p.unit_price),
          minimumGrossMarginPercentage: p.minimum_gross_margin_percentage ?? defaultMargin,
          supplierLeadTimeDays: p.lead_time_days,
          safetyStockDays: Number(p.safety_stock_days) || 30,
          maxCoverDays: 180,
        });
      }

      return rows;
    }

    // Fallback: client-side compute (same as before)
    const byProduct = new Map<string, any[]>();
    for (const m of (movementsQ.data ?? []) as any[]) {
      if (!m.product_id) continue;
      const arr = byProduct.get(m.product_id) ?? [];
      arr.push(m);
      byProduct.set(m.product_id, arr);
    }
    const rows = ((productsQ.data ?? []) as Product[]).map((p) => {
      const moves = byProduct.get(p.id) ?? [];
      let stock = 0;
      for (const m of moves) stock += (m.direction === "in" ? 1 : -1) * Number(m.quantity);
      const history = bucketMovementsByMonth(moves, 12);
      const currentMonth = currentMonthBucket(moves);
      const f = forecastSKU(history, stock, p.lead_time_days, 6, {
        config: { safetyStockDays: Number(p.safety_stock_days) || 30 },
        currentMonth,
      });
      return {
        product: p,
        stock,
        forecast: f,
        velocityTag: "dead" as VelocityTag,
        pricingStrategy: null as PricingStrategyResult | null,
      };
    });

    // 2. Compute category-based velocity for all SKUs
    const velInputs: CategoryVelocityInput[] = rows.map((r) => ({
      productId: r.product.id,
      category: r.product.category,
      recent3MonthAvg: r.forecast.calculationBreakdown.momentum.recent3MonthAvg,
    }));
    const velocityMap = computeVelocityByCategory(velInputs);

    // 3. Apply computed velocity tags
    for (const row of rows) {
      const vt = velocityMap.get(row.product.id);
      if (vt) row.velocityTag = vt;
      // @ts-ignore — override the default from forecastSKU
      row.forecast.velocityTag = vt ?? "dead";
    }

    // 4. Compute pricing strategy for each SKU
    for (const row of rows) {
      const p = row.product;
      const f = row.forecast;
      row.pricingStrategy = computePricingStrategy({
        velocity: row.velocityTag,
        momentum: f.momentumTag,
        daysOfCover: f.daysOfCover,
        unitCost: Number(p.unit_cost),
        unitPrice: Number(p.unit_price),
        minimumGrossMarginPercentage: p.minimum_gross_margin_percentage ?? defaultMargin,
        supplierLeadTimeDays: p.lead_time_days,
        safetyStockDays: Number(p.safety_stock_days) || 30,
        maxCoverDays: 180,
      });
    }

    return rows;
  }, [productsQ.data, movementsQ.data, forecastVarsQ.data, catalogueSettingsQ.data, clockTick]);

  const filtered = useMemo(() => {
    const r = analyses.filter((a) => {
      if (category !== "all" && a.product.category !== category) return false;
      if (
        q &&
        !a.product.sku.toLowerCase().includes(q.toLowerCase()) &&
        !a.product.name.toLowerCase().includes(q.toLowerCase())
      )
        return false;
      if (filter === "reorder" && a.forecast.recommendedReorder <= 0) return false;
      if (filter === "fast" && a.velocityTag !== "fast_mover") return false;
      if (filter === "medium" && a.velocityTag !== "medium_mover") return false;
      if (filter === "slow" && a.velocityTag !== "slow_mover" && a.velocityTag !== "dead")
        return false;
      if (filter === "accelerating" && a.forecast.momentumTag !== "accelerating") return false;
      if (filter === "declining" && a.forecast.momentumTag !== "declining") return false;
      if (filter === "out" && a.stock > 0) return false;
      if (filter === "critical" && a.forecast.stockoutUrgency !== "critical") return false;
      return true;
    });
    // dir flips the natural sort order of each key (default preserves the
    // original behaviour: reorder qty desc).
    const dir = sortDir === "desc" ? 1 : -1;
    r.sort((a, b) => {
      if (sortBy === "velocity") return (b.forecast.avgMonthly - a.forecast.avgMonthly) * dir;
      if (sortBy === "cover") return (a.forecast.daysOfCover - b.forecast.daysOfCover) * dir;
      if (sortBy === "stockout")
        return (
          (a.forecast.estimatedStockoutDate ?? "9999-99-99").localeCompare(
            b.forecast.estimatedStockoutDate ?? "9999-99-99",
          ) * dir
        );
      if (sortBy === "trend")
        return (Math.abs(b.forecast.trend) - Math.abs(a.forecast.trend)) * dir;
      return (b.forecast.recommendedReorder - a.forecast.recommendedReorder) * dir;
    });
    return r;
  }, [analyses, q, filter, category, sortBy, sortDir]);

  const summary = useMemo(() => {
    let toReorder = 0,
      reorderQty = 0,
      reorderValue = 0,
      fast = 0,
      slow = 0,
      dead = 0,
      accelerating = 0,
      declining = 0,
      inactive = 0,
      out = 0,
      critical = 0;
    for (const a of analyses) {
      if (a.forecast.recommendedReorder > 0) {
        toReorder++;
        reorderQty += a.forecast.recommendedReorder;
        reorderValue += a.forecast.recommendedReorder * Number(a.product.unit_cost);
      }
      if (a.velocityTag === "fast_mover") fast++;
      if (a.velocityTag === "slow_mover") slow++;
      if (a.velocityTag === "dead") dead++;
      if (a.forecast.momentumTag === "accelerating") accelerating++;
      if (a.forecast.momentumTag === "declining") declining++;
      if (a.forecast.momentumTag === "inactive") inactive++;
      if (a.stock <= 0) out++;
      if (a.forecast.stockoutUrgency === "critical") critical++;
    }
    return {
      toReorder,
      reorderQty,
      reorderValue,
      fast,
      slow,
      dead,
      accelerating,
      declining,
      inactive,
      out,
      critical,
    };
  }, [analyses]);

  const categories = useMemo(() => {
    const s = new Set<string>();
    for (const a of analyses) if (a.product.category) s.add(a.product.category);
    return Array.from(s).sort((x, y) => x.localeCompare(y));
  }, [analyses]);

  const loading = productsQ.isLoading || movementsQ.isLoading;

  // -------- Pagination (presentation only) --------
  useEffect(() => {
    setPage(1);
  }, [q, filter, category, sortBy]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const handleSort = (key: SortKey) => {
    if (sortBy === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortBy(key);
      setSortDir("desc");
    }
  };

  const resetFilters = () => {
    setQ("");
    setFilter("all");
    setCategory("all");
    setPage(1);
  };

  const exportCSV = () => {
    const header = [
      "SKU",
      "Product",
      "Category",
      "Velocity",
      "Momentum",
      "In stock",
      "Days cover",
      "Monthly forecast",
      "Stockout date",
      "Recommended order",
    ];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = filtered.map((a) => [
      a.product.sku,
      a.product.name,
      a.product.category ?? "",
      velocityLabel(a.velocityTag),
      momentumLabel(a.forecast.momentumTag),
      a.stock,
      a.forecast.daysOfCover === Infinity ? "" : Math.round(a.forecast.daysOfCover),
      a.forecast.forecast[0]?.qty ?? 0,
      a.forecast.estimatedStockoutDate ?? "",
      a.forecast.recommendedReorder,
    ]);
    const csv = [header, ...lines].map((row) => row.map(esc).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sku-forecast.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleExpand = (id: string) => {
    setExpanded(expanded === id ? null : id);
  };

  return (
    <div className="min-h-screen bg-white">
      {/* ── Dark navy header ─────────────────────────────────────── */}
      <PageHeader
        totalSkus={analyses.length}
        needReorder={summary.toReorder}
        stockoutRisk={summary.critical}
      />

      <div className="mx-auto w-full max-w-[1440px] space-y-5 px-4 py-6 md:px-8 md:py-8">
        {/* ── Filter toolbar ─────────────────────────────────────── */}
        <FiltersToolbar
          q={q}
          onQ={setQ}
          category={category}
          onCategory={setCategory}
          categories={categories}
          filter={filter}
          onFilter={setFilter}
          onRecompute={() => recomputeMutation.mutate()}
          recomputing={recomputeMutation.isPending}
          computedDate={forecastVarsQ.data?.computedDate}
          onExport={exportCSV}
        />

        {/* ── Table / empty / loading states ─────────────────────── */}
        {loading ? (
          <SKUTableSkeleton />
        ) : analyses.length === 0 ? (
          <EmptyState />
        ) : filtered.length === 0 ? (
          <NoResults onReset={resetFilters} />
        ) : (
          <SKUTable
            rows={pageRows}
            total={filtered.length}
            expanded={expanded}
            onToggle={toggleExpand}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={handleSort}
            defaultMargin={defaultMargin}
            page={safePage}
            pageCount={pageCount}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
          />
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Header + summary cards
   ═══════════════════════════════════════════════════════════════════════ */

function PageHeader({
  totalSkus,
  needReorder,
  stockoutRisk,
}: {
  totalSkus: number;
  needReorder: number;
  stockoutRisk: number;
}) {
  return (
    <header className="bg-slate-900">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 px-4 py-6 md:flex-row md:items-center md:justify-between md:px-8 md:py-5">
        <div className="flex items-center gap-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 shadow-lg shadow-blue-600/30">
            <Package className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-white">SKU Forecast</h1>
            <p className="text-xs text-slate-400">Demand planning · reorder intelligence</p>
          </div>
        </div>
        <SummaryCards totalSkus={totalSkus} needReorder={needReorder} stockoutRisk={stockoutRisk} />
      </div>
    </header>
  );
}

function SummaryCards({
  totalSkus,
  needReorder,
  stockoutRisk,
}: {
  totalSkus: number;
  needReorder: number;
  stockoutRisk: number;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <HeaderStat
        icon={<Package className="h-4 w-4" />}
        iconClass="bg-blue-500/15 text-blue-400"
        value={totalSkus}
        label="Total SKUs"
      />
      <HeaderStat
        icon={<AlertTriangle className="h-4 w-4" />}
        iconClass="bg-amber-500/15 text-amber-400"
        value={needReorder}
        label="Need Reorder"
      />
      <HeaderStat
        icon={<Zap className="h-4 w-4" />}
        iconClass="bg-rose-500/15 text-rose-400"
        value={stockoutRisk}
        label="Stockout Risk"
      />
    </div>
  );
}

function HeaderStat({
  icon,
  iconClass,
  value,
  label,
}: {
  icon: React.ReactNode;
  iconClass: string;
  value: number;
  label: string;
}) {
  return (
    <div
      className="min-w-0 rounded-xl border border-white/10 bg-white/[0.06] px-3.5 py-3"
      title={label}
    >
      <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${iconClass}`}>
        {icon}
      </div>
      <div className="mt-2 text-xl font-bold tabular-nums leading-none text-white">
        {value.toLocaleString()}
      </div>
      <div className="mt-1 text-[11px] font-medium text-slate-400">{label}</div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Filters toolbar
   ═══════════════════════════════════════════════════════════════════════ */

const EXTRA_FILTERS: { value: FilterT; label: string }[] = [
  { value: "reorder", label: "Need reorder" },
  { value: "critical", label: "Critical stockout" },
  { value: "out", label: "Out of stock" },
  { value: "accelerating", label: "Accelerating" },
  { value: "declining", label: "Declining" },
];

function FiltersToolbar({
  q,
  onQ,
  category,
  onCategory,
  categories,
  filter,
  onFilter,
  onRecompute,
  recomputing,
  computedDate,
  onExport,
}: {
  q: string;
  onQ: (v: string) => void;
  category: string;
  onCategory: (v: string) => void;
  categories: string[];
  filter: FilterT;
  onFilter: (v: FilterT) => void;
  onRecompute: () => void;
  recomputing: boolean;
  computedDate?: string;
  onExport: () => void;
}) {
  const velocityValue: FilterT =
    filter === "fast" || filter === "medium" || filter === "slow" ? filter : "all";
  const activeExtra = EXTRA_FILTERS.some((o) => o.value === filter);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-card">
      {/* Search */}
      <div className="relative min-w-[220px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          value={q}
          onChange={(e) => onQ(e.target.value)}
          placeholder="Search SKU or product name…"
          aria-label="Search SKU or product name"
          className="h-11 w-full rounded-[10px] border border-gray-200 bg-white pl-9 pr-9 text-sm text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15"
        />
        {q && (
          <button
            onClick={() => onQ("")}
            aria-label="Clear search"
            title="Clear search"
            className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Category */}
      <div className="relative">
        <select
          value={category}
          onChange={(e) => onCategory(e.target.value)}
          aria-label="Filter by category"
          className="h-11 cursor-pointer appearance-none rounded-[10px] border border-gray-200 bg-white pl-3.5 pr-9 text-sm text-gray-700 outline-none transition-all hover:border-gray-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15"
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
      </div>

      {/* Velocity */}
      <div className="relative">
        <select
          value={velocityValue}
          onChange={(e) => onFilter(e.target.value as FilterT)}
          aria-label="Filter by velocity"
          className="h-11 cursor-pointer appearance-none rounded-[10px] border border-gray-200 bg-white pl-3.5 pr-9 text-sm text-gray-700 outline-none transition-all hover:border-gray-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15"
        >
          <option value="all">All velocities</option>
          <option value="fast">Fast</option>
          <option value="medium">Steady</option>
          <option value="slow">Slow</option>
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
      </div>

      {/* More filters */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            title="More filters"
            className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-gray-200 bg-white px-3.5 text-sm font-medium text-gray-700 transition-all hover:border-gray-300 hover:bg-gray-50"
          >
            <SlidersHorizontal className="h-4 w-4 text-gray-500" />
            More filters
            {activeExtra && <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-56 p-1.5 shadow-dropdown">
          <p className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            Quick filters
          </p>
          <div className="flex flex-col">
            {EXTRA_FILTERS.map((o) => {
              const active = filter === o.value;
              return (
                <button
                  key={o.value}
                  onClick={() => onFilter(active ? "all" : o.value)}
                  className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                    active
                      ? "bg-blue-50 font-medium text-blue-700"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {active ? (
                    <Check className="h-4 w-4 shrink-0 text-blue-600" />
                  ) : (
                    <span className="h-4 w-4 shrink-0" />
                  )}
                  {o.label}
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      {/* Right group */}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <span
          className="hidden items-center gap-1.5 text-xs text-emerald-600 md:inline-flex"
          title="Forecasts refresh automatically every 60 seconds"
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          Live
        </span>
        {computedDate && (
          <span className="hidden text-xs text-gray-400 lg:block">Computed {computedDate}</span>
        )}
        <button
          onClick={onRecompute}
          disabled={recomputing}
          title="Recompute forecasts now"
          className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-gray-200 bg-white px-3.5 text-sm font-medium text-gray-700 transition-all hover:border-gray-300 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 text-gray-500 ${recomputing ? "animate-spin" : ""}`} />
          {recomputing ? "Computing…" : "Recompute"}
        </button>
        <button
          onClick={onExport}
          title="Export the current view as CSV"
          className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition-all hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/30"
        >
          <Download className="h-4 w-4" />
          Export
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Table + rows
   ═══════════════════════════════════════════════════════════════════════ */

function SKUTable({
  rows,
  total,
  expanded,
  onToggle,
  sortBy,
  sortDir,
  onSort,
  defaultMargin,
  page,
  pageCount,
  pageSize,
  onPageChange,
}: {
  rows: Analysis[];
  total: number;
  expanded: string | null;
  onToggle: (id: string) => void;
  sortBy: SortKey;
  sortDir: "desc" | "asc";
  onSort: (k: SortKey) => void;
  defaultMargin: number;
  page: number;
  pageCount: number;
  pageSize: number;
  onPageChange: (p: number) => void;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-card">
      {/* ── Mobile: cards ── */}
      <div className="md:hidden">
        {rows.map((a) => (
          <MobileRowCard
            key={a.product.id}
            product={a.product}
            stock={a.stock}
            f={a.forecast}
            velocityTag={a.velocityTag}
            pricingStrategy={a.pricingStrategy}
            defaultMargin={defaultMargin}
            expanded={expanded === a.product.id}
            onToggle={() => onToggle(a.product.id)}
          />
        ))}
      </div>

      {/* ── Tablet & desktop: full table ── */}
      {/* overflow-x-clip (not -auto) so the sticky thead sticks to the
          viewport instead of to this wrapper's scrollport */}
      <div className="hidden overflow-x-clip rounded-t-xl md:block">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="sticky top-14 z-10 md:top-0">
            <tr className="border-b border-gray-200 bg-[#FAFAFA]">
              <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Product
              </th>
              <SortableTh
                label="Velocity"
                sortKey="velocity"
                sortBy={sortBy}
                dir={sortDir}
                onSort={onSort}
                className="hidden md:table-cell"
              />
              <th className="hidden px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 lg:table-cell">
                Momentum
              </th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                In Stock
              </th>
              <SortableTh
                label="Days Cover"
                sortKey="cover"
                sortBy={sortBy}
                dir={sortDir}
                onSort={onSort}
                className="hidden md:table-cell"
              />
              <th className="hidden px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500 xl:table-cell">
                Monthly Forecast
              </th>
              <SortableTh
                label="Stockout Date"
                sortKey="stockout"
                sortBy={sortBy}
                dir={sortDir}
                onSort={onSort}
                className="hidden lg:table-cell"
              />
              <SortableTh
                label="Recommended Order"
                sortKey="reorder"
                sortBy={sortBy}
                dir={sortDir}
                onSort={onSort}
                className="hidden md:table-cell"
              />
              <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Action
              </th>
              <th className="w-12 px-2 py-3" aria-label="Expand row" />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <TableRow
                key={a.product.id}
                product={a.product}
                stock={a.stock}
                f={a.forecast}
                velocityTag={a.velocityTag}
                pricingStrategy={a.pricingStrategy}
                defaultMargin={defaultMargin}
                expanded={expanded === a.product.id}
                onToggle={() => onToggle(a.product.id)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Pagination footer ── */}
      <div className="flex flex-col items-center justify-between gap-3 border-t border-gray-100 px-6 py-4 sm:flex-row">
        <p className="text-sm text-gray-500">
          Showing{" "}
          <span className="font-medium text-gray-900">
            {total === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)}
          </span>{" "}
          of <span className="font-medium text-gray-900">{total}</span> SKUs
        </p>
        <Pagination page={page} pageCount={pageCount} onPageChange={onPageChange} />
      </div>
    </div>
  );
}

function SortableTh({
  label,
  sortKey,
  sortBy,
  dir,
  onSort,
  className = "",
}: {
  label: string;
  sortKey: SortKey;
  sortBy: SortKey;
  dir: "desc" | "asc";
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = sortBy === sortKey;
  // "cover"/"stockout" naturally sort ascending; mirror the arrow to the real
  // effective direction so the chevron is never misleading.
  const ascKeys: SortKey[] = ["cover", "stockout"];
  const effective =
    ascKeys.includes(sortKey) && sortBy === sortKey ? (dir === "desc" ? "asc" : "desc") : dir;
  return (
    <th
      className={`px-4 py-3 ${className}`}
      aria-sort={active ? (effective === "asc" ? "ascending" : "descending") : undefined}
    >
      <button
        onClick={() => onSort(sortKey)}
        title={`Sort by ${label.toLowerCase()}`}
        className={`group inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors hover:text-gray-900 ${
          active ? "text-gray-900" : "text-gray-500"
        }`}
      >
        {label}
        {active ? (
          effective === "asc" ? (
            <ChevronUp className="h-3.5 w-3.5 text-blue-600" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-blue-600" />
          )
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-60" />
        )}
      </button>
    </th>
  );
}

function TableRow({
  product,
  stock,
  f,
  velocityTag,
  pricingStrategy,
  defaultMargin,
  expanded,
  onToggle,
}: {
  product: Product;
  stock: number;
  f: ForecastResult;
  velocityTag: VelocityTag;
  pricingStrategy: PricingStrategyResult | null;
  defaultMargin: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const imgSrc = useSignedImageUrl(product.image_url);
  const nextMonthQty = f.forecast[0]?.qty ?? 0;
  const needsReorder = f.recommendedReorder > 0;
  const stockoutDays = f.estimatedStockoutDate ? daysRemaining(f.estimatedStockoutDate) : null;
  const coverDanger = f.daysOfCover < 7;

  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer border-b border-gray-100 transition-colors duration-150 last:border-0 hover:bg-gray-50 ${
          expanded ? "bg-gray-50/70" : ""
        }`}
      >
        {/* Product */}
        <td className="px-6 py-4">
          <div className="flex items-center gap-3">
            {product.image_url && imgSrc ? (
              <img
                src={imgSrc}
                alt={product.name}
                className="h-10 w-10 shrink-0 rounded-lg border border-gray-200 object-cover"
              />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-100 text-[11px] font-bold text-gray-500">
                {product.sku.slice(0, 2).toUpperCase() || "?"}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-gray-900">{product.name}</div>
              <div className="mt-0.5 truncate text-xs text-gray-500">
                {product.sku}
                {product.category && <> · {product.category}</>}
              </div>
            </div>
          </div>
        </td>

        {/* Velocity */}
        <td className="hidden px-4 py-4 md:table-cell">
          <span className={`text-sm font-medium ${velocityColor(velocityTag)}`}>
            {velocityLabel(velocityTag)}
          </span>
        </td>

        {/* Momentum */}
        <td className="hidden px-4 py-4 lg:table-cell">
          <span className={`text-sm font-medium ${momentumColor(f.momentumTag)}`}>
            {momentumLabel(f.momentumTag)}
          </span>
        </td>

        {/* In stock */}
        <td
          className={`px-4 py-4 text-right text-sm font-medium tabular-nums ${
            stock <= 0 ? "text-red-600" : "text-gray-900"
          }`}
        >
          {stock.toLocaleString()}
        </td>

        {/* Days cover */}
        <td
          className={`hidden px-4 py-4 text-right text-sm tabular-nums md:table-cell ${
            coverDanger ? "font-medium text-red-600" : "text-gray-900"
          }`}
        >
          {f.daysOfCover === Infinity ? "∞" : `${Math.round(f.daysOfCover)} days`}
        </td>

        {/* Monthly forecast */}
        <td className="hidden px-4 py-4 text-center text-sm font-medium tabular-nums text-gray-900 xl:table-cell">
          {nextMonthQty.toLocaleString()}
        </td>

        {/* Stockout date */}
        <td className="hidden px-4 py-4 text-right lg:table-cell">
          {f.estimatedStockoutDate ? (
            <span
              title={
                stockoutDays !== null
                  ? stockoutDays <= 0
                    ? "Out of stock now"
                    : `Stockout in ~${stockoutDays} days`
                  : undefined
              }
              className={`text-sm tabular-nums ${
                stockoutDays !== null && stockoutDays <= 7
                  ? "font-medium text-red-600"
                  : "text-amber-600"
              }`}
            >
              {fmtShortDate(f.estimatedStockoutDate)}
            </span>
          ) : (
            <span className="text-sm text-gray-400">—</span>
          )}
        </td>

        {/* Recommended order */}
        <td className="hidden px-4 py-4 text-right md:table-cell">
          {needsReorder ? (
            <span className="text-sm font-semibold tabular-nums text-gray-900">
              {f.recommendedReorder.toLocaleString()}
            </span>
          ) : (
            <span className="text-sm text-gray-400">—</span>
          )}
        </td>

        {/* Action */}
        <td className="px-4 py-4 text-right">
          <ActionButton needsReorder={needsReorder} qty={f.recommendedReorder} onClick={onToggle} />
        </td>

        {/* Chevron */}
        <td className="w-12 px-2 py-4 text-right">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            aria-label={expanded ? "Collapse row details" : "Expand row details"}
            title={expanded ? "Collapse details" : "Expand details"}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700"
          >
            <ChevronRight
              className={`h-4 w-4 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
            />
          </button>
        </td>
      </tr>

      {/* Expanded detail panel */}
      {expanded && (
        <tr className="border-b border-gray-100 bg-gray-50/60">
          <td colSpan={10} className="px-6">
            <ExpandedForecastDetail
              product={product}
              f={f}
              pricingStrategy={pricingStrategy}
              defaultMargin={defaultMargin}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function MobileRowCard({
  product,
  stock,
  f,
  velocityTag,
  pricingStrategy,
  defaultMargin,
  expanded,
  onToggle,
}: {
  product: Product;
  stock: number;
  f: ForecastResult;
  velocityTag: VelocityTag;
  pricingStrategy: PricingStrategyResult | null;
  defaultMargin: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const imgSrc = useSignedImageUrl(product.image_url);
  const nextMonthQty = f.forecast[0]?.qty ?? 0;
  const needsReorder = f.recommendedReorder > 0;
  const stockoutDays = f.estimatedStockoutDate ? daysRemaining(f.estimatedStockoutDate) : null;

  return (
    <div className="border-b border-gray-100 px-4 py-4 last:border-0">
      <button
        onClick={onToggle}
        className="flex w-full items-start gap-3 text-left"
        aria-label={expanded ? "Collapse row details" : "Expand row details"}
      >
        {product.image_url && imgSrc ? (
          <img
            src={imgSrc}
            alt={product.name}
            className="h-10 w-10 shrink-0 rounded-lg border border-gray-200 object-cover"
          />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-100 text-[11px] font-bold text-gray-500">
            {product.sku.slice(0, 2).toUpperCase() || "?"}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-gray-900">{product.name}</div>
          <div className="truncate text-xs text-gray-500">
            {product.sku}
            {product.category && <> · {product.category}</>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <span className={`font-medium ${velocityColor(velocityTag)}`}>
              {velocityLabel(velocityTag)}
            </span>
            <span className="text-gray-300">·</span>
            <span className={`font-medium ${momentumColor(f.momentumTag)}`}>
              {momentumLabel(f.momentumTag)}
            </span>
          </div>
        </div>
        <ChevronRight
          className={`mt-1 h-4 w-4 shrink-0 text-gray-400 transition-transform duration-150 ${
            expanded ? "rotate-90" : ""
          }`}
        />
      </button>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <MiniStat label="In stock" value={stock.toLocaleString()} danger={stock <= 0} />
        <MiniStat
          label="Days cover"
          value={f.daysOfCover === Infinity ? "∞" : `${Math.round(f.daysOfCover)}d`}
          danger={f.daysOfCover < 7}
        />
        <MiniStat label="Forecast" value={nextMonthQty.toLocaleString()} />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="text-sm">
          <span
            className={`tabular-nums ${
              f.estimatedStockoutDate
                ? stockoutDays !== null && stockoutDays <= 7
                  ? "font-medium text-red-600"
                  : "text-amber-600"
                : "text-gray-400"
            }`}
          >
            {f.estimatedStockoutDate ? fmtShortDate(f.estimatedStockoutDate) : "—"}
          </span>
          <span className="mx-2 text-gray-300">·</span>
          <span className="text-gray-500">
            Order:{" "}
            <span
              className={`font-medium tabular-nums ${
                needsReorder ? "text-gray-900" : "text-gray-400"
              }`}
            >
              {needsReorder ? f.recommendedReorder.toLocaleString() : "—"}
            </span>
          </span>
        </div>
        <ActionButton needsReorder={needsReorder} qty={f.recommendedReorder} onClick={onToggle} />
      </div>

      {expanded && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <ExpandedForecastDetail
            product={product}
            f={f}
            pricingStrategy={pricingStrategy}
            defaultMargin={defaultMargin}
          />
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/60 px-2 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-gray-400">{label}</div>
      <div
        className={`mt-0.5 text-sm font-semibold tabular-nums ${
          danger ? "text-red-600" : "text-gray-900"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function ActionButton({
  needsReorder,
  qty,
  onClick,
}: {
  needsReorder: boolean;
  qty: number;
  onClick: () => void;
}) {
  if (needsReorder) {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        title="Expand details to review this reorder"
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition-all hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/30 active:scale-[0.98]"
      >
        <ShoppingCart className="h-4 w-4" />
        Order {qty.toLocaleString()}
      </button>
    );
  }
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title="Review pricing strategy"
      className="inline-flex h-10 items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 transition-all hover:border-gray-300 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/30 active:scale-[0.98]"
    >
      <BadgePercent className="h-4 w-4 text-gray-500" />
      Review Price
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Pagination
   ═══════════════════════════════════════════════════════════════════════ */

function getPageItems(page: number, count: number): (number | "…")[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const items: (number | "…")[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(count - 1, page + 1);
  if (start > 2) items.push("…");
  for (let i = start; i <= end; i++) items.push(i);
  if (end < count - 1) items.push("…");
  items.push(count);
  return items;
}

function Pagination({
  page,
  pageCount,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  onPageChange: (p: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        title="Previous page"
        className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronLeft className="h-4 w-4" />
        <span className="hidden sm:inline">Previous</span>
      </button>
      {getPageItems(page, pageCount).map((it, i) =>
        it === "…" ? (
          <span key={`e-${i}`} className="px-1 text-sm text-gray-400">
            …
          </span>
        ) : (
          <button
            key={it}
            onClick={() => onPageChange(it)}
            aria-label={`Page ${it}`}
            aria-current={it === page ? "page" : undefined}
            className={`h-8 min-w-8 rounded-lg px-2 text-sm tabular-nums transition-colors ${
              it === page
                ? "bg-gray-100 font-semibold text-gray-900"
                : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
            }`}
          >
            {it}
          </button>
        ),
      )}
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= pageCount}
        title="Next page"
        className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span className="hidden sm:inline">Next</span>
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Empty / no-results / loading states
   ═══════════════════════════════════════════════════════════════════════ */

function EmptyState() {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-6 py-20 text-center shadow-card">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100">
        <Package className="h-6 w-6 text-gray-400" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-gray-900">No products yet</h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">
        Add products and record stock movements to see demand forecasts and reorder recommendations.
      </p>
    </div>
  );
}

function NoResults({ onReset }: { onReset: () => void }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-6 py-20 text-center shadow-card">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100">
        <SearchX className="h-6 w-6 text-gray-400" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-gray-900">No SKUs match your filters</h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">
        Try adjusting your search or clearing the active filters.
      </p>
      <button
        onClick={onReset}
        className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
      >
        Clear filters
      </button>
    </div>
  );
}

function SKUTableSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-card">
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-[#FAFAFA]">
              {Array.from({ length: 9 }).map((_, i) => (
                <th key={i} className="px-4 py-3 first:pl-6">
                  <Skeleton className="h-3 w-16" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 8 }).map((_, r) => (
              <tr key={r} className="border-b border-gray-100">
                {Array.from({ length: 9 }).map((_, c) => (
                  <td key={c} className="px-4 py-5 first:pl-6">
                    <div className="flex items-center gap-3">
                      {c === 0 && <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />}
                      <Skeleton
                        className="h-4"
                        style={{ width: `${55 + ((r * 7 + c * 13) % 30)}%` }}
                      />
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-4 p-4 md:hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Label / formatting helpers
   ═══════════════════════════════════════════════════════════════════════ */

const VELOCITY_LABEL: Record<VelocityTag, string> = {
  fast_mover: "Fast",
  medium_mover: "Steady",
  slow_mover: "Slow",
  dead: "Dead",
};

function velocityLabel(t: VelocityTag): string {
  return VELOCITY_LABEL[t] ?? t;
}

function velocityColor(t: VelocityTag): string {
  if (t === "fast_mover") return "text-emerald-600";
  if (t === "medium_mover") return "text-gray-600";
  if (t === "slow_mover") return "text-amber-600";
  return "text-rose-600";
}

const MOMENTUM_LABEL: Record<MomentumTag, string> = {
  accelerating: "Positive",
  stable: "Stable",
  declining: "Declining",
  inactive: "Inactive",
};

function momentumLabel(t: MomentumTag): string {
  return MOMENTUM_LABEL[t] ?? t;
}

function momentumColor(t: MomentumTag): string {
  if (t === "accelerating") return "text-emerald-600";
  if (t === "stable") return "text-gray-600";
  if (t === "declining") return "text-amber-600";
  return "text-gray-400";
}

/** True when `a` is a newer persisted snapshot than `b` (by computedDate, then updatedAt). */
function newerSnapshot(a: any, b: any): boolean {
  const aDate = a.computedDate ?? a.computed_date ?? "";
  const bDate = b.computedDate ?? b.computed_date ?? "";
  if (aDate !== bDate) return aDate > bDate;
  const aUpd = a.updatedAt ?? a.updated_at ?? "";
  const bUpd = b.updatedAt ?? b.updated_at ?? "";
  return aUpd > bUpd;
}

function daysRemaining(dateStr: string): number {
  const d = new Date(dateStr);
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / 86400000);
}

function fmtShortDate(d: string): string {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// --------------- Edit pricing (recommendation stays read-only) ---------------

// Margin is stored as a decimal (0.4 = 40%) but edited as a percent (40).
// Legacy records may hold a raw percent (e.g. 40) — normalize those too.
function marginStoredToPercent(v: number | null | undefined): string {
  const n = Number(v ?? 0.4) || 0.4;
  const pct = n > 1 ? n : n * 100;
  return String(Math.round(pct * 100) / 100);
}

function EditPricingForm({
  product,
  pricingStrategy,
  defaultMargin,
}: {
  product: Product;
  pricingStrategy: PricingStrategyResult | null;
  defaultMargin: number;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [unitCost, setUnitCost] = useState(String(product.unit_cost ?? ""));
  const [marginPct, setMarginPct] = useState(
    marginStoredToPercent(product.minimum_gross_margin_percentage ?? defaultMargin),
  );
  const [savedFlash, setSavedFlash] = useState(false);
  const dirtyRef = useRef(false);

  // If the product record changes underneath us (60s refetch, another tab),
  // resync the form — unless the user has started typing.
  useEffect(() => {
    if (dirtyRef.current) return;
    setUnitCost(String(product.unit_cost ?? ""));
    setMarginPct(marginStoredToPercent(product.minimum_gross_margin_percentage ?? defaultMargin));
  }, [product.unit_cost, product.minimum_gross_margin_percentage, defaultMargin]);

  const changePct = pricingStrategy?.recommendedPriceChangePct ?? 0;
  // Margin is entered as a percentage (e.g. 40 = 40%) and stored as a decimal (0.4).
  const margin = Math.min(0.99, Math.max(0.01, (Number(marginPct) || 40) / 100));
  const cost = Number(unitCost) || 0;
  // Margin floor: min permitted = unit price × (1 + margin). Unit cost does NOT affect it.
  const price = Number(product.unit_price) || 0;
  const minPermitted = price > 0 ? price * (1 + margin) : 0;
  // Live preview: the demo ±% is applied to the unit COST, floored at the
  // margin minimum — exactly like the engine.
  const recommended = Math.round(Math.max(cost * (1 + changePct / 100), minPermitted) * 100) / 100;

  const save = useMutation({
    mutationFn: async () => {
      await api.products.update(product.id, {
        unit_cost: Number(unitCost) || 0,
        minimum_gross_margin_percentage: Math.min(
          0.99,
          Math.max(0.01, (Number(marginPct) || 40) / 100),
        ),
      });
    },
    onSuccess: () => {
      // Invalidate both keys so the forecast page AND the products page
      // (which shares the same underlying product data) pick up the change.
      qc.invalidateQueries({ queryKey: ["products-forecast"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      setOpen(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to update pricing"),
  });

  return (
    <div className="rounded-xl border border-border/50 bg-card p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs uppercase tracking-widest text-muted-foreground">Edit pricing</h4>
        <button
          onClick={() => setOpen(!open)}
          className="inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:underline transition-colors"
        >
          <Pencil className="h-2.5 w-2.5" />
          {open ? "Close" : "Update unit cost / margin"}
        </button>
      </div>
      {savedFlash && (
        <div className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
          ✓ Pricing saved — strategy refresh queued.
        </div>
      )}
      {open && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-[9px] uppercase tracking-widest text-muted-foreground">
                Unit cost ($)
              </span>
              <input
                type="number"
                step="0.01"
                value={unitCost}
                onChange={(e) => {
                  dirtyRef.current = true;
                  setUnitCost(e.target.value);
                }}
                className="w-full rounded-lg border border-border bg-input px-2.5 py-1.5 text-sm outline-none transition-all focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[9px] uppercase tracking-widest text-muted-foreground">
                Min gross margin (%)
              </span>
              <input
                type="number"
                step="0.5"
                min="1"
                max="99"
                value={marginPct}
                onChange={(e) => {
                  dirtyRef.current = true;
                  setMarginPct(e.target.value);
                }}
                className="w-full rounded-lg border border-border bg-input px-2.5 py-1.5 text-sm outline-none transition-all focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
              />
            </label>
          </div>
          <div className="space-y-1 rounded-lg border border-border/30 bg-muted/30 px-3 py-2 text-[10px]">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Min permitted price</span>
              <span className="font-mono font-semibold tabular-nums">
                ${minPermitted.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                Recommended{" "}
                {changePct !== 0 && `(applies ${changePct > 0 ? "+" : ""}${changePct}%)`}
              </span>
              <span className="font-mono font-semibold tabular-nums text-primary">
                ${recommended.toFixed(2)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground transition-all duration-200 hover:opacity-90 disabled:opacity-60"
            >
              {save.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Save className="h-3 w-3" />
              )}
              Save pricing
            </button>
            <span className="text-[9px] text-muted-foreground/60">
              Only unit cost & margin are saved — unit price is never auto-changed.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Expanded Detail (the star of the show)
   ═══════════════════════════════════════════════════════════════════════ */

function ExpandedForecastDetail({
  product,
  f,
  pricingStrategy,
  defaultMargin,
}: {
  product: Product;
  f: ForecastResult;
  pricingStrategy: PricingStrategyResult | null;
  defaultMargin: number;
}) {
  // Build chart data: 12 history months + 6 forecast months
  const chartData = useMemo(() => {
    const data: any[] = [];
    // History
    for (const h of f.history) {
      const [y, m] = h.month.split("-").map(Number);
      const monthName = MONTH_NAMES[m - 1] ?? "";
      data.push({
        month: `${monthName.slice(0, 3)}`,
        fullMonth: h.month,
        actual: h.qty,
        forecast: null,
        baseline: null,
        piLow: null,
        piHigh: null,
      });
    }
    // Forecast
    for (const m of f.forecast) {
      data.push({
        month: m.monthName.slice(0, 3),
        fullMonth: m.month,
        actual: null,
        forecast: m.qty,
        baseline: m.baseline,
        piLow: m.predictionIntervalLow ?? null,
        piHigh: m.predictionIntervalHigh ?? null,
      });
    }
    return data;
  }, [f]);

  const imgSrc = useSignedImageUrl(product.image_url);
  const next6Total = f.forecast.reduce((a, b) => a + b.qty, 0);

  return (
    <div className="py-6 animate-in fade-in slide-in-from-top-2 duration-300">
      {/* Item header */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        {product.image_url && imgSrc ? (
          <img
            src={imgSrc}
            alt={product.name}
            className="h-10 w-10 shrink-0 rounded-lg border border-border object-cover"
          />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-muted/30 text-[10px] font-bold text-muted-foreground">
            {product.sku.slice(0, 2).toUpperCase() || "?"}
          </div>
        )}
        <div>
          <div className="font-mono text-[11px] text-muted-foreground leading-none mb-0.5">
            {product.sku}
          </div>
          <div className="text-base font-semibold leading-tight">{product.name}</div>
          {product.category && (
            <div className="text-[10px] text-muted-foreground/60 mt-0.5">{product.category}</div>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-1.5 text-right">
            <div className="text-[8px] uppercase tracking-widest text-muted-foreground">
              Unit price
            </div>
            <div className="font-mono text-sm font-semibold tabular-nums">
              ${Number(product.unit_price || 0).toFixed(2)}
            </div>
          </div>
          <div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-1.5 text-right">
            <div className="text-[8px] uppercase tracking-widest text-muted-foreground">
              Unit cost
            </div>
            <div className="font-mono text-sm font-semibold tabular-nums">
              ${Number(product.unit_cost || 0).toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* LEFT: Chart + 6-month forecast (3/5 width) */}
        <div className="lg:col-span-3 space-y-4">
          {/* Demand trend chart */}
          <div className="rounded-xl border border-border/50 bg-card p-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="text-xs uppercase tracking-widest text-muted-foreground">
                  Demand trend
                </h4>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                  12mo history · 6mo forecast
                </p>
              </div>
              <div className="flex items-center gap-3 text-[10px]">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                  Forecast
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
                  Actual
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 border-2 border-primary/40 rounded-sm bg-transparent" />
                  80% CI
                </span>
              </div>
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="actualGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="5%"
                        stopColor="hsl(var(--muted-foreground))"
                        stopOpacity={0.2}
                      />
                      <stop
                        offset="95%"
                        stopColor="hsl(var(--muted-foreground))"
                        stopOpacity={0.02}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border) / 0.4)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => v.toLocaleString()}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: "12px",
                      border: "1px solid hsl(var(--border) / 0.6)",
                      background: "hsl(var(--popover))",
                      boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
                      fontSize: "12px",
                    }}
                    formatter={(value: any, name: string) => {
                      if (value === null || value === undefined) return ["—", ""];
                      const labels: Record<string, string> = {
                        actual: "Actual demand",
                        forecast: "Forecast",
                        baseline: "Baseline",
                        piLow: "80% CI Low",
                        piHigh: "80% CI High",
                      };
                      return [value.toLocaleString(), labels[name] ?? name];
                    }}
                    labelFormatter={(label) => `${label}`}
                  />
                  <Area
                    type="monotone"
                    dataKey="actual"
                    stroke="hsl(var(--muted-foreground) / 0.5)"
                    strokeWidth={2}
                    fill="url(#actualGrad)"
                    dot={{ r: 3, fill: "hsl(var(--muted-foreground) / 0.6)", strokeWidth: 0 }}
                    connectNulls={false}
                  />
                  {/* Confidence interval band */}
                  <Area
                    type="monotone"
                    dataKey="piHigh"
                    stroke="transparent"
                    fill="hsl(var(--primary) / 0.06)"
                    strokeWidth={0}
                    connectNulls={true}
                  />
                  <Area
                    type="monotone"
                    dataKey="piLow"
                    stroke="transparent"
                    fill="hsl(var(--primary) / 0.06)"
                    strokeWidth={0}
                    connectNulls={true}
                  />
                  <Area
                    type="monotone"
                    dataKey="forecast"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2.5}
                    fill="url(#forecastGrad)"
                    dot={{ r: 4, fill: "hsl(var(--primary))", strokeWidth: 0 }}
                    strokeDasharray="5 3"
                    connectNulls={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 6-month forecast table */}
          <div className="rounded-xl border border-border/50 bg-card p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs uppercase tracking-widest text-muted-foreground">
                Next 6-month forecast
              </h4>
              <span className="text-[10px] text-muted-foreground/60">
                {f.forecast.length} months ·{" "}
                <span className="font-mono font-semibold text-primary">
                  {next6Total.toLocaleString()}
                </span>{" "}
                units total
              </span>
            </div>
            <table className="table-premium w-full text-sm">
              <thead>
                <tr className="border-b border-border/70 text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                  <th className="py-2.5 text-left font-medium">Month</th>
                  <th className="py-2.5 text-right font-medium">Forecast (units)</th>
                  <th className="py-2.5 text-right font-medium">Daily rate</th>
                </tr>
              </thead>
              <tbody>
                {f.forecast.map((m, i) => (
                  <tr
                    key={m.month}
                    className={`border-b border-border/40 transition-colors ${
                      i === 0 ? "bg-primary/[0.05]" : "hover:bg-muted/20"
                    }`}
                  >
                    <td className="py-2.5 text-left">
                      <div className="text-xs font-semibold">
                        {i === 0 && (
                          <span className="mr-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-primary">
                            Next
                          </span>
                        )}
                        {m.monthName}
                      </div>
                      <div className="text-[9px] text-muted-foreground/50">{m.month}</div>
                    </td>
                    <td className="py-2.5 text-right font-mono text-sm font-semibold tabular-nums">
                      {m.qty.toLocaleString()}
                    </td>
                    <td className="py-2.5 text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {m.dailyRate.toFixed(1)}/d
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="pt-3 text-xs font-semibold text-foreground/70">
                    {f.forecast.length}-month total
                  </td>
                  <td className="pt-3 text-right font-mono text-base font-bold tabular-nums text-primary">
                    {next6Total.toLocaleString()}
                  </td>
                  <td className="pt-3 text-right text-[9px] text-muted-foreground/60">
                    forecast demand
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* RIGHT: Pricing (2/5 width) */}
        <div className="lg:col-span-2 space-y-4">
          {/* Pricing strategy — enhanced visual card */}
          {pricingStrategy &&
            (() => {
              const isDanger =
                pricingStrategy.strategy === "Clearance" ||
                pricingStrategy.strategy === "Markdown / Promotion";
              const isWarning =
                pricingStrategy.strategy === "Targeted promotion" ||
                pricingStrategy.strategy === "Monitor";
              const isPositive =
                pricingStrategy.strategy === "Protect margin" ||
                pricingStrategy.strategy === "Hold price / protect availability";
              const isNeutral = pricingStrategy.strategy === "Hold price";

              const borderColor = isDanger
                ? "border-rose-300/60 dark:border-rose-800/40"
                : isWarning
                  ? "border-amber-300/60 dark:border-amber-800/40"
                  : isPositive
                    ? "border-emerald-300/60 dark:border-emerald-800/40"
                    : "border-border/50";

              const badgeBg = isDanger
                ? "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-400/30"
                : isWarning
                  ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-400/30"
                  : isPositive
                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-400/30"
                    : "bg-muted/40 text-muted-foreground border-border/40";

              const accentBar = isDanger
                ? "bg-rose-500"
                : isWarning
                  ? "bg-amber-500"
                  : isPositive
                    ? "bg-emerald-500"
                    : "bg-muted-foreground/30";

              const StrategyIcon = isDanger
                ? AlertTriangle
                : isWarning
                  ? TrendingDown
                  : isPositive
                    ? TrendingUp
                    : Minus;

              return (
                <div className={`rounded-xl border ${borderColor} bg-card overflow-hidden`}>
                  {/* Colored accent bar */}
                  <div className={`h-1 w-full ${accentBar}`} />

                  <div className="p-4 space-y-3">
                    {/* Strategy header with icon */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className={`flex h-7 w-7 items-center justify-center rounded-lg ${badgeBg}`}
                        >
                          <StrategyIcon className="h-3.5 w-3.5" />
                        </div>
                        <div>
                          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">
                            Pricing strategy
                          </div>
                          <div className="text-sm font-bold leading-tight">
                            {pricingStrategy.strategy}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[8px] uppercase tracking-widest font-semibold ${badgeBg}`}
                      >
                        {pricingStrategy.inventoryPosition}
                      </span>
                    </div>

                    {/* Rule triggered */}
                    <div className="rounded-lg bg-muted/30 px-3 py-2 border border-border/30">
                      <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-0.5">
                        Rule triggered
                      </div>
                      <div className="text-[11px] font-mono font-medium text-foreground/80">
                        {pricingStrategy.triggeredRule}
                      </div>
                    </div>

                    {/* Suggested action */}
                    <div className="space-y-1">
                      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">
                        Action
                      </div>
                      <div className="text-xs font-medium leading-relaxed">
                        {pricingStrategy.suggestedAction}
                      </div>
                    </div>

                    {/* Reason */}
                    <div className="space-y-1">
                      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">
                        Reason
                      </div>
                      <div className="text-[10px] text-muted-foreground/80 leading-relaxed">
                        {pricingStrategy.reason}
                      </div>
                    </div>

                    {/* Price comparison bar */}
                    <div className="rounded-lg border border-border/30 bg-muted/20 p-3 space-y-2">
                      <div className="text-[8px] uppercase tracking-widest text-muted-foreground">
                        Price analysis
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-[9px] text-muted-foreground">Unit cost</div>
                          <div className="font-mono text-sm tabular-nums text-muted-foreground">
                            ${Number(pricingStrategy.conditions.unitCost).toFixed(2)}
                          </div>
                        </div>
                        <div className="flex items-center justify-center text-muted-foreground/40">
                          <ArrowRight className="h-3.5 w-3.5" />
                        </div>
                        <div className="flex-1 min-w-0 text-right">
                          <div className="text-[9px] text-muted-foreground">Min permitted</div>
                          <div className="font-mono text-sm font-bold tabular-nums">
                            ${pricingStrategy.minimumPrice.toFixed(2)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2 border-t border-border/30 pt-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-[9px] text-muted-foreground">Current</div>
                          <div className="font-mono text-sm tabular-nums">
                            ${Number(pricingStrategy.conditions.unitPrice).toFixed(2)}
                          </div>
                        </div>
                        <div className="flex items-center justify-center text-muted-foreground/40">
                          <ArrowRight className="h-3.5 w-3.5" />
                        </div>
                        <div className="flex-1 min-w-0 text-right">
                          <div className="text-[9px] text-muted-foreground flex items-center justify-end gap-1">
                            Recommended
                            <span
                              className={`inline-flex items-center rounded-full px-1.5 py-px text-[8px] font-bold ${
                                pricingStrategy.recommendedPriceChangePct > 0
                                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                  : pricingStrategy.recommendedPriceChangePct < 0
                                    ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
                                    : "bg-muted/40 text-muted-foreground"
                              }`}
                            >
                              {pricingStrategy.recommendedPriceChangePct > 0 ? "+" : ""}
                              {pricingStrategy.recommendedPriceChangePct}%
                            </span>
                          </div>
                          <div className="font-mono text-sm font-bold tabular-nums text-primary">
                            ${pricingStrategy.recommendedPrice.toFixed(2)}
                          </div>
                        </div>
                      </div>
                      {/* Price range bar */}
                      <div className="h-2 rounded-full bg-muted overflow-hidden relative">
                        {(() => {
                          const minP = pricingStrategy.minimumPrice;
                          const curP = Number(pricingStrategy.conditions.unitPrice);
                          const recP = pricingStrategy.recommendedPrice;
                          const maxP = curP * 1.5;
                          const range = maxP - minP;
                          const pos = (v: number) => (range > 0 ? ((v - minP) / range) * 100 : 50);
                          const minPos = pos(minP);
                          const curPos = pos(curP);
                          const recPos = pos(recP);
                          return (
                            <>
                              <div className="absolute inset-0 bg-gradient-to-r from-rose-400/30 via-amber-400/30 to-emerald-400/30" />
                              <div
                                className="absolute top-0 bottom-0 w-0.5 bg-foreground rounded-full transition-all"
                                style={{ left: `${Math.min(Math.max(curPos, 2), 98)}%` }}
                              />
                              <div
                                className="absolute top-0 bottom-0 w-0.5 bg-destructive rounded-full transition-all"
                                style={{ left: `${Math.min(Math.max(minPos, 2), 98)}%` }}
                              />
                              <div
                                className="absolute top-0 bottom-0 w-0.5 bg-primary rounded-full transition-all"
                                style={{ left: `${Math.min(Math.max(recPos, 2), 98)}%` }}
                              />
                            </>
                          );
                        })()}
                      </div>
                      <div className="flex justify-between text-[8px] text-muted-foreground/50">
                        <span>Floor</span>
                        <span>Current</span>
                        <span>Ceiling</span>
                      </div>
                    </div>

                    {/* Input conditions grid */}
                    <div className="grid grid-cols-2 gap-1.5">
                      <ConditionChip
                        label="Velocity"
                        value={
                          pricingStrategy.conditions.velocity === "fast_mover"
                            ? "Fast mover"
                            : pricingStrategy.conditions.velocity === "medium_mover"
                              ? "Medium mover"
                              : pricingStrategy.conditions.velocity === "slow_mover"
                                ? "Slow mover"
                                : "Dead"
                        }
                        tone={
                          pricingStrategy.conditions.velocity === "fast_mover"
                            ? "positive"
                            : pricingStrategy.conditions.velocity === "medium_mover"
                              ? "neutral"
                              : pricingStrategy.conditions.velocity === "slow_mover"
                                ? "warning"
                                : "danger"
                        }
                      />
                      <ConditionChip
                        label="Momentum"
                        value={
                          pricingStrategy.conditions.momentum === "accelerating"
                            ? "Accelerating"
                            : pricingStrategy.conditions.momentum === "stable"
                              ? "Stable"
                              : pricingStrategy.conditions.momentum === "declining"
                                ? "Declining"
                                : "Inactive"
                        }
                        tone={
                          pricingStrategy.conditions.momentum === "accelerating"
                            ? "positive"
                            : pricingStrategy.conditions.momentum === "stable"
                              ? "neutral"
                              : "danger"
                        }
                      />
                      <ConditionChip
                        label="Days cover"
                        value={String(pricingStrategy.conditions.daysOfCover)}
                        tone={
                          pricingStrategy.inventoryPosition === "low"
                            ? "danger"
                            : pricingStrategy.inventoryPosition === "high"
                              ? "warning"
                              : "positive"
                        }
                      />
                      <ConditionChip
                        label="Margin floor"
                        value={`${Math.round(pricingStrategy.conditions.minGrossMarginPct * 100)}%`}
                        tone="neutral"
                      />
                    </div>
                  </div>
                </div>
              );
            })()}

          {/* Edit pricing — recommendation stays read-only; edits are manual */}
          <EditPricingForm
            product={product}
            pricingStrategy={pricingStrategy}
            defaultMargin={defaultMargin}
          />
        </div>
      </div>
    </div>
  );
}

function ConditionChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "positive" | "warning" | "danger" | "neutral";
}) {
  const bg =
    tone === "positive"
      ? "bg-emerald-500/10 border-emerald-500/20"
      : tone === "warning"
        ? "bg-amber-500/10 border-amber-500/20"
        : tone === "danger"
          ? "bg-rose-500/10 border-rose-500/20"
          : "bg-muted/30 border-border/30";
  const txt =
    tone === "positive"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warning"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "danger"
          ? "text-rose-600 dark:text-rose-400"
          : "text-muted-foreground";
  return (
    <div className={`rounded-lg border ${bg} px-2.5 py-1.5`}>
      <div className="text-[8px] uppercase tracking-widest text-muted-foreground/70">{label}</div>
      <div className={`text-[11px] font-semibold tabular-nums ${txt}`}>{value}</div>
    </div>
  );
}
