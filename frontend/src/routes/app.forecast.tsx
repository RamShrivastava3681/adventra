import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import api from "@/lib/api-client";
import { PageHeader, Card, fmtMoney } from "@/components/ledger-ui";
import { bucketMovementsByMonth, currentMonthBucket, forecastSKU, MONTH_NAMES, computeVelocityByCategory, computePricingStrategy, recomputeTimeline, type ForecastResult, type CalculationBreakdown, type MomentumTag, type VelocityTag, type PricingStrategyResult, type CategoryVelocityInput } from "@/lib/forecast-engine";
import {
  TrendingUp, TrendingDown, AlertTriangle, Package, Search, BarChart3, RefreshCw,
  CalendarClock, Clock, Truck, ArrowUpDown, ArrowRight, Zap, ArrowUp, ArrowDown, Minus,
  Loader2, Save, Pencil,
} from "lucide-react";
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Area, AreaChart, BarChart, Bar,
} from "recharts";
import { toast } from "sonner";

export const Route = createFileRoute("/app/forecast")({
  component: ForecastPage,
});

type Product = {
  id: string; sku: string; name: string; category: string | null;
  reorder_level: number; max_stock: number; lead_time_days: number;
  safety_stock_days: number;
  unit_price: number; unit_cost: number;
  minimum_gross_margin_percentage: number | null; status: string;
};

type Analysis = { product: Product; stock: number; forecast: ForecastResult; velocityTag: VelocityTag; pricingStrategy: PricingStrategyResult | null };

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
  const [filter, setFilter] = useState<"all" | "reorder" | "fast" | "slow" | "accelerating" | "declining" | "out" | "critical">("all");
  const [sortBy, setSortBy] = useState<"velocity" | "reorder" | "cover" | "stockout" | "trend">("reorder");
  const [expanded, setExpanded] = useState<string | null>(null);

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
      return data.filter((p: any) => p.status === "active").map((p: any) => ({
        id: p.id, sku: p.sku, name: p.name, category: p.category,
        reorder_level: p.reorderLevel ?? p.reorder_level, max_stock: p.maxStock ?? p.max_stock,
        lead_time_days: p.leadTimeDays ?? p.lead_time_days, safety_stock_days: p.safetyStockDays ?? p.safety_stock_days ?? 30,
        unit_price: p.unitPrice ?? p.unit_price,
        unit_cost: p.unitCost ?? p.unit_cost,
        minimum_gross_margin_percentage: p.minimumGrossMarginPercentage ?? p.minimum_gross_margin_percentage ?? null,
        status: p.status,
      })).sort((a: any, b: any) => a.sku?.localeCompare(b.sku ?? "") ?? 0);
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
      return data.map((m: any) => ({ product_id: m.productId ?? m.product_id, direction: m.direction, quantity: m.quantity, movement_date: m.movementDate ?? m.movement_date }));
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
          id: p.id, sku: p.sku, name: p.name, category: p.category,
          reorder_level: p.reorderLevel ?? p.reorder_level ?? 0,
          max_stock: p.maxStock ?? p.max_stock ?? 0,
          lead_time_days: p.leadTimeDays ?? p.lead_time_days ?? 14,
          safety_stock_days: p.safetyStockDays ?? p.safety_stock_days ?? 30,
          unit_price: p.unitPrice ?? p.unit_price ?? 0,
          unit_cost: p.unitCost ?? p.unit_cost ?? 0,
          minimum_gross_margin_percentage: p.minimumGrossMarginPercentage ?? p.minimum_gross_margin_percentage ?? null,
          status: p.status ?? "active",
        });
      }

      // Build a map of snapshots by productId
      const snapshotMap = new Map<string, any>();
      for (const s of fv.snapshots) {
        snapshotMap.set(s.productId, s);
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
          if (m.direction === "out" && (m.movement_date ?? "").slice(0, 7) === curMonthKey) currentMonthOutbound += Number(m.quantity);
        }

        const f = recomputeTimeline(snapshot.forecast as ForecastResult, stock, product.lead_time_days, currentMonthOutbound);

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
      return { product: p, stock, forecast: f, velocityTag: "dead" as VelocityTag, pricingStrategy: null as PricingStrategyResult | null };
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
    let r = analyses.filter((a) => {
      if (q && !a.product.sku.toLowerCase().includes(q.toLowerCase()) && !a.product.name.toLowerCase().includes(q.toLowerCase())) return false;
      if (filter === "reorder" && a.forecast.recommendedReorder <= 0) return false;
      if (filter === "fast" && a.velocityTag !== "fast_mover") return false;
      if (filter === "slow" && a.velocityTag !== "slow_mover" && a.velocityTag !== "dead") return false;
      if (filter === "accelerating" && a.forecast.momentumTag !== "accelerating") return false;
      if (filter === "declining" && a.forecast.momentumTag !== "declining") return false;
      if (filter === "out" && a.stock > 0) return false;
      if (filter === "critical" && a.forecast.stockoutUrgency !== "critical") return false;
      return true;
    });
    r.sort((a, b) => {
      if (sortBy === "velocity") return b.forecast.avgMonthly - a.forecast.avgMonthly;
      if (sortBy === "cover") return a.forecast.daysOfCover - b.forecast.daysOfCover;
      if (sortBy === "stockout") return (a.forecast.estimatedStockoutDate ?? "9999-99-99").localeCompare(b.forecast.estimatedStockoutDate ?? "9999-99-99");
      if (sortBy === "trend") return Math.abs(b.forecast.trend) - Math.abs(a.forecast.trend);
      return b.forecast.recommendedReorder - a.forecast.recommendedReorder;
    });
    return r;
  }, [analyses, q, filter, sortBy]);

  const summary = useMemo(() => {
    let toReorder = 0, reorderQty = 0, reorderValue = 0, fast = 0, slow = 0, dead = 0, accelerating = 0, declining = 0, inactive = 0, out = 0, critical = 0;
    for (const a of analyses) {
      if (a.forecast.recommendedReorder > 0) { toReorder++; reorderQty += a.forecast.recommendedReorder; reorderValue += a.forecast.recommendedReorder * Number(a.product.unit_cost); }
      if (a.velocityTag === "fast_mover") fast++;
      if (a.velocityTag === "slow_mover") slow++;
      if (a.velocityTag === "dead") dead++;
      if (a.forecast.momentumTag === "accelerating") accelerating++;
      if (a.forecast.momentumTag === "declining") declining++;
      if (a.forecast.momentumTag === "inactive") inactive++;
      if (a.stock <= 0) out++;
      if (a.forecast.stockoutUrgency === "critical") critical++;
    }
    return { toReorder, reorderQty, reorderValue, fast, slow, dead, accelerating, declining, inactive, out, critical };
  }, [analyses]);

  const toggleExpand = (id: string) => {
    setExpanded(expanded === id ? null : id);
  };

  return (
    <div>
      <PageHeader
        eyebrow="Intelligence"
        title="Demand forecast & reorder"
        description="Seasonal trend model over 12 months of sales. Shows monthly breakdowns, estimated stockout dates, and reorder timelines for every SKU."
        breadcrumbs={[
          { label: "Dashboard", href: "/app/dashboard" },
          { label: "Forecast" },
        ]}
      />

      <div className="space-y-6 p-6 md:p-10">
        {/* Summary tiles */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-9">
          {/* Velocity stats */}
          <StatTile label="Fast movers" value={summary.fast} icon={<TrendingUp className="h-4 w-4 text-emerald-500" />} />
          <StatTile label="Slow movers" value={summary.slow} icon={<TrendingDown className="h-4 w-4 text-amber-500" />} />
          <StatTile label="Dead stock" value={summary.dead} />
          {/* Momentum stats */}
          <StatTile label="Accelerating" value={summary.accelerating} icon={<ArrowUp className="h-4 w-4 text-emerald-500" />} />
          <StatTile label="Declining" value={summary.declining} icon={<ArrowDown className="h-4 w-4 text-rose-500" />} />
          <StatTile label="Inactive" value={summary.inactive} />
          {/* Core ops */}
          <StatTile label="Out of stock" value={summary.out} tone="destructive" />
          <StatTile
            label="Critical"
            value={summary.critical}
            tone={summary.critical > 0 ? "destructive" : undefined}
            icon={summary.critical > 0 ? <Zap className="h-4 w-4 text-rose-500" /> : undefined}
          />
          <StatTile label="Need reorder" value={summary.toReorder} tone="warning" icon={<AlertTriangle className="h-4 w-4 text-amber-500" />} />
        </div>

        {/* Filters bar */}
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Search SKU or name…"
                className="w-full rounded-lg border border-border bg-input px-9 py-2.5 text-sm outline-none transition-all focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(["all","reorder","critical","fast","slow","accelerating","declining","out"] as const).map((s) => (
                <button key={s} onClick={() => setFilter(s)}
                  className={`rounded-full border px-3.5 py-1.5 text-[11px] uppercase tracking-[0.12em] font-medium transition-all duration-200 ${
                    filter === s
                      ? s === "critical"
                        ? "border-rose-400/50 bg-rose-500/10 text-rose-500 shadow-sm"
                        : "border-primary/50 bg-primary/10 text-primary shadow-sm"
                      : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground hover:bg-muted/30"
                  }`}>
                  {s === "critical" && <Zap className="inline h-3 w-3 mr-1 -mt-0.5" />}
                  {s}
                </button>
              ))}
            </div>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}
              className="rounded-lg border border-border bg-input px-3.5 py-2.5 text-sm outline-none transition-all focus:border-primary/50 focus:ring-2 focus:ring-primary/10">
              <option value="reorder">Sort: Reorder qty ↓</option>
              <option value="velocity">Sort: Velocity ↓</option>
              <option value="cover">Sort: Days of cover ↑</option>
              <option value="stockout">Sort: Stockout date ↑</option>
              <option value="trend">Sort: Trend strength ↓</option>
            </select>

            {/* Recompute button + freshness badge */}
            <div className="flex items-center gap-2 ml-auto">
              <span className="inline-flex items-center gap-1.5 text-[10px] text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
                Live · refresh 60s
              </span>
              {forecastVarsQ.data?.computedDate && (
                <span className="text-[10px] text-muted-foreground/60 whitespace-nowrap">
                  Computed {forecastVarsQ.data.computedDate}
                </span>
              )}
              <button
                onClick={() => recomputeMutation.mutate()}
                disabled={recomputeMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-2 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-border hover:bg-muted/30 transition-all duration-200 disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${recomputeMutation.isPending ? "animate-spin" : ""}`} />
                {recomputeMutation.isPending ? "Computing…" : "Recompute"}
              </button>
            </div>

            <span className="text-[11px] text-muted-foreground hidden md:block">
              {filtered.length} of {analyses.length} SKUs
            </span>
          </div>
        </Card>

        {/* Main table */}
        <Card title="SKU forecast">
          {analyses.length === 0 ? (
            <div className="py-14 text-center text-sm text-muted-foreground">
              <Package className="mx-auto mb-3 h-10 w-10 opacity-30" />
              <div className="text-base font-medium text-foreground/70">No products yet</div>
              <div className="mt-1">Add products and record stock movements to see forecasts.</div>
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                  <tr className="border-b border-border/70">
                    <th className="px-5 py-3 text-left font-medium">SKU / Name</th>
                    <th className="px-5 py-3 text-left font-medium">Velocity</th>
                    <th className="px-5 py-3 text-left font-medium">Momentum</th>
                    <th className="px-5 py-3 text-right font-medium">In stock</th>
                    <th className="px-5 py-3 text-right font-medium">Days cover</th>
                    <th className="px-5 py-3 text-right font-medium">Trend</th>
                    <th className="px-5 py-3 text-right font-medium">Monthly forecast</th>
                    <th className="px-5 py-3 text-right font-medium">Stockout date</th>
                    <th className="px-5 py-3 text-right font-medium">Reorder by</th>
                    <th className="px-5 py-3 text-right font-medium">Refill arrives</th>
                    <th className="px-5 py-3 text-right font-medium">Reorder now</th>
                    <th className="px-5 py-3 text-center font-medium">Chart</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a) => (
                    <ForecastRow
                      key={a.product.id}
                      product={a.product}
                      stock={a.stock}
                      f={a.forecast}
                      velocityTag={a.velocityTag}
                      pricingStrategy={a.pricingStrategy}
                      defaultMargin={defaultMargin}
                      expanded={expanded === a.product.id}
                      onToggle={() => toggleExpand(a.product.id)}
                    />
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && analyses.length > 0 && (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No SKUs match the current filter.
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// --------------- utilities ---------------

function daysRemaining(dateStr: string): number {
  const d = new Date(dateStr);
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / 86400000);
}

function formatDays(d: number): string {
  if (d <= 0) return "Overdue";
  if (d === 1) return "1 day";
  if (d < 30) return `${d} days`;
  return `${d}d`;
}

// --------------- Trend cell component ---------------

function TrendCell({ f }: { f: ForecastResult }) {
  const isUp = f.trendDirection === "up";
  const isDown = f.trendDirection === "down";
  const isStable = f.trendDirection === "stable";

  const icon = isUp ? <ArrowUp className="h-4 w-4" />
    : isDown ? <ArrowDown className="h-4 w-4" />
    : <Minus className="h-4 w-4" />;

  const color = isUp ? "text-emerald-500"
    : isDown ? "text-rose-500"
    : "text-muted-foreground";

  const bgColor = isUp ? "bg-emerald-500/8"
    : isDown ? "bg-rose-500/8"
    : "bg-muted/30";

  // Trend strength bar
  const strengthPct = Math.round(f.trendStrength * 100);
  const barColor = strengthPct > 70 ? (isUp ? "bg-emerald-500" : isDown ? "bg-rose-500" : "bg-muted-foreground")
    : strengthPct > 40 ? (isUp ? "bg-emerald-400" : isDown ? "bg-rose-400" : "bg-muted-foreground")
    : "bg-muted-foreground/40";

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <div className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 ${bgColor}`}>
        <span className={`${color}`}>{icon}</span>
        <span className={`font-mono text-xs font-semibold tabular-nums ${color}`}>
          {f.trend > 0 ? "+" : ""}{f.trend}/mo
        </span>
      </div>
      <div className="flex items-center gap-1.5 w-full">
        <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${strengthPct}%` }}
          />
        </div>
        <span className="text-[9px] tabular-nums text-muted-foreground/60 font-medium">
          {strengthPct}%
        </span>
      </div>
    </div>
  );
}

// --------------- Sparkline (tiny inline chart in Monthly forecast column) ---------------

function ForecastSparkline({ forecast }: { forecast: ForecastResult['forecast'] }) {
  const maxQty = Math.max(...forecast.map((f) => f.qty), 1);
  return (
    <div className="flex items-end gap-[3px] h-8"
      title={forecast.map((f) => `${f.monthName} ${f.month.slice(0,4)}: ${f.qty.toLocaleString()} units`).join(" · ")}>
      {forecast.map((f, i) => {
        const h = Math.max((f.qty / maxQty) * 28, 3);
        const isNextMonth = i === 0;
        return (
          <div key={i} className="group relative flex-1 flex flex-col items-center justify-end">
            <div
              className={`w-full rounded-t-sm transition-all duration-300 ease-out hover:opacity-80 cursor-pointer ${
                isNextMonth ? "ring-1 ring-primary/40" : ""
              }`}
              style={{
                height: `${h}px`,
                background: isNextMonth
                  ? `linear-gradient(to top, hsl(var(--primary) / 0.85), hsl(var(--primary) / 0.55))`
                  : `linear-gradient(to top, hsl(var(--primary) / 0.6), hsl(var(--primary) / 0.35))`,
              }}
            />
            <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-popover px-2.5 py-1.5 text-[10px] text-popover-foreground opacity-0 shadow-xl ring-1 ring-border/50 transition-opacity group-hover:opacity-100 z-10">
              <div className="font-semibold">{f.monthName}</div>
              <div className="text-muted-foreground">{f.qty.toLocaleString()} units</div>
              <div className="text-[9px] text-muted-foreground/60">
                Stock req: {f.stockRequired.toLocaleString()}
                {f.suggestedOrder > 0 && ` · Order ${f.suggestedOrder}`}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --------------- Main Row ---------------

function ForecastRow({ product, stock, f, velocityTag, pricingStrategy, defaultMargin, expanded, onToggle }: {
  product: Product; stock: number; f: ForecastResult; velocityTag: VelocityTag; pricingStrategy: PricingStrategyResult | null;
  defaultMargin: number;
  expanded: boolean; onToggle: () => void;
}) {
  const nextMonthQty = f.forecast[0]?.qty ?? 0;
  const next6Total = f.forecast.reduce((a, b) => a + b.qty, 0);

  // Velocity (category-based) icons & tones
  const vIcon = velocityTag === "fast_mover" ? <TrendingUp className="h-3 w-3" />
    : velocityTag === "medium_mover" ? <BarChart3 className="h-3 w-3" />
    : velocityTag === "slow_mover" ? <TrendingDown className="h-3 w-3" />
    : velocityTag === "dead" ? <Package className="h-3 w-3" />
    : <BarChart3 className="h-3 w-3" />;
  const vTone = velocityTag === "fast_mover" ? "success" : velocityTag === "medium_mover" ? "primary" : velocityTag === "slow_mover" ? "warning" : "destructive";
  const vLabel = velocityTag === "fast_mover" ? "Fast mover" : velocityTag === "medium_mover" ? "Medium mover" : velocityTag === "slow_mover" ? "Slow mover" : velocityTag === "dead" ? "Dead" : velocityTag;

  // Momentum icons & tones
  const mIcon = f.momentumTag === "accelerating" ? <TrendingUp className="h-3 w-3" />
    : f.momentumTag === "stable" ? <Minus className="h-3 w-3" />
    : f.momentumTag === "declining" ? <TrendingDown className="h-3 w-3" />
    : <Package className="h-3 w-3" />;
  const mTone = f.momentumTag === "accelerating" ? "success" : f.momentumTag === "stable" ? "primary" : f.momentumTag === "declining" ? "warning" : "destructive";

  const stockoutDays = f.estimatedStockoutDate ? daysRemaining(f.estimatedStockoutDate) : null;
  const reorderDays = f.reorderByDate ? daysRemaining(f.reorderByDate) : null;
  const refillDays = daysRemaining(f.nextRefillDate);

  const urgencyIcon = f.stockoutUrgency === "critical" ? <Zap className="h-3 w-3" />
    : f.stockoutUrgency === "warning" ? <Clock className="h-3 w-3" />
    : <CalendarClock className="h-3 w-3" />;

  const isCritical = f.stockoutUrgency === "critical";
  const isWarning = f.stockoutUrgency === "warning";

  return (
    <>
      <tr
        className={`border-b border-border/50 transition-all duration-200 cursor-pointer select-none
          ${isCritical ? "bg-rose-500/5 hover:bg-rose-500/8" : "hover:bg-muted/30"}
          ${expanded ? "bg-muted/20 shadow-inner" : ""}
        `}
        onClick={onToggle}
      >
        {/* SKU / Name */}
        <td className="px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg border text-[10px] font-bold transition-colors ${
              isCritical ? "border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-400"
              : isWarning ? "border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400"
              : "border-border/60 bg-muted/30 text-muted-foreground"
            }`}>
              {product.sku.slice(0, 2).toUpperCase() || "?"}
            </div>
            <div>
              <div className="font-mono text-[11px] text-muted-foreground leading-none mb-0.5">{product.sku}</div>
              <div className="text-sm font-medium leading-tight">{product.name}</div>
              {product.category && (
                <div className="text-[10px] text-muted-foreground/60 mt-0.5">{product.category}</div>
              )}
            </div>
          </div>
        </td>

        {/* Velocity (category-based) */}
        <td className="px-5 py-3.5">
          <div className="flex items-center gap-1.5">
            <span className={`${vTone === "success" ? "text-emerald-500" : vTone === "warning" ? "text-amber-500" : vTone === "destructive" ? "text-rose-500" : "text-primary"}`}>
              {vIcon}
            </span>
            <Pill tone={vTone as any}>{vLabel}</Pill>
          </div>
        </td>

        {/* Momentum (sales trend) */}
        <td className="px-5 py-3.5">
          <div className="flex items-center gap-1.5">
            <span className={`${mTone === "success" ? "text-emerald-500" : mTone === "warning" ? "text-amber-500" : mTone === "destructive" ? "text-rose-500" : "text-primary"}`}>
              {mIcon}
            </span>
            <Pill tone={mTone as any}>{f.momentumTag === "accelerating" ? "Accelerating" : f.momentumTag === "stable" ? "Stable" : f.momentumTag === "declining" ? "Declining" : f.momentumTag === "inactive" ? "Inactive" : f.momentumTag}</Pill>
          </div>
        </td>

        {/* In stock */}
        <td className="px-5 py-3.5 text-right">
          <div className={`font-mono text-sm font-semibold tabular-nums ${
            stock <= 0 ? "text-rose-600" : stock <= product.reorder_level ? "text-amber-600" : "text-foreground"
          }`}>
            {stock.toLocaleString()}
          </div>
          <div className="text-[9px] text-muted-foreground/60 leading-tight">
            {stock <= 0
              ? "⚠ Out of stock"
              : stock <= product.reorder_level
              ? `≤ reorder lvl (${product.reorder_level})`
              : `reorder lvl: ${product.reorder_level}`
            }
          </div>
        </td>

        {/* Days cover */}
        <td className="px-5 py-3.5 text-right">
          <CoverGauge days={f.daysOfCover} leadTime={product.lead_time_days} />
        </td>

        {/* Trend */}
        <td className="px-5 py-3.5 text-right">
          <TrendCell f={f} />
        </td>

        {/* Monthly forecast */}
        <td className="px-5 py-3.5 text-right">
          <div className="font-mono text-sm font-semibold tabular-nums">
            {nextMonthQty.toLocaleString()}
            {f.adjustmentFactor !== 1 && (
              <>
                <span className="text-muted-foreground/40"> → </span>
                <span className="text-primary">{f.adjustedNextForecast.toLocaleString()}</span>
              </>
            )}
          </div>
          {f.adjustmentFactor !== 1 && (
            <div className="text-[9px] font-semibold text-amber-600 dark:text-amber-400 flex items-center justify-end gap-0.5">
              {f.adjustmentFactor > 1 ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
              live {Math.round((f.adjustmentFactor - 1) * 100) > 0 ? "+" : ""}{Math.round((f.adjustmentFactor - 1) * 100)}%
            </div>
          )}
          <div className="text-[9px] text-muted-foreground/60">next 6mo: {next6Total.toLocaleString()}</div>
          <div className="mt-1">
            <ForecastSparkline forecast={f.forecast} />
          </div>
        </td>

        {/* Stockout date */}
        <td className="px-5 py-3.5 text-right">
          {f.estimatedStockoutDate ? (
            <div className={`inline-flex flex-col items-end ${
              stockoutDays !== null && stockoutDays <= 0 ? "text-rose-600" :
              stockoutDays !== null && stockoutDays <= product.lead_time_days ? "text-amber-600" : "text-muted-foreground"
            }`}>
              <span className="text-xs font-semibold tabular-nums">{f.estimatedStockoutDate.slice(5)}</span>
              {stockoutDays !== null && (
                <span className={`text-[10px] mt-0.5 flex items-center gap-0.5 font-medium ${
                  stockoutDays <= 0 ? "text-rose-500" :
                  stockoutDays <= 7 ? "text-amber-500" : "text-muted-foreground/60"
                }`}>
                  {stockoutDays <= 0 ? "⚠ Out now" : `${stockoutDays}d away`}
                </span>
              )}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground/50 italic">Sufficient</span>
          )}
        </td>

        {/* Reorder by */}
        <td className="px-5 py-3.5 text-right">
          {f.reorderByDate ? (
            <div className={`inline-flex flex-col items-end ${
              reorderDays !== null && reorderDays <= 0 ? "text-rose-600 font-medium" :
              reorderDays !== null && reorderDays <= 7 ? "text-amber-600" : "text-muted-foreground"
            }`}>
              <span className="text-xs tabular-nums">{f.reorderByDate.slice(5)}</span>
              <span className={`text-[10px] mt-0.5 flex items-center gap-0.5 font-medium ${
                reorderDays !== null && reorderDays <= 0 ? "text-rose-500" :
                reorderDays !== null && reorderDays <= 7 ? "text-amber-500" : "text-muted-foreground/60"
              }`}>
                {urgencyIcon}
                {reorderDays !== null && reorderDays <= 0 ? "OVERDUE" : reorderDays !== null ? `${reorderDays}d` : ""}
              </span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground/50 italic">—</span>
          )}
        </td>

        {/* Refill arrives */}
        <td className="px-5 py-3.5 text-right">
          <div className="inline-flex flex-col items-end text-muted-foreground">
            <span className="text-xs tabular-nums">{f.nextRefillDate.slice(5)}</span>
            <span className="text-[10px] text-muted-foreground/60 mt-0.5 flex items-center gap-0.5">
              <Truck className="h-2.5 w-2.5" />
              {formatDays(refillDays)}
            </span>
          </div>
        </td>

        {/* Reorder now */}
        <td className="px-5 py-3.5 text-right">
          {f.recommendedReorder > 0 ? (
            <div className="inline-flex flex-col items-end">
              <span className="font-bold text-primary tabular-nums text-base leading-none">
                {f.recommendedReorder.toLocaleString()}
              </span>
              <span className="text-[10px] text-muted-foreground/70 mt-0.5">
                {fmtMoney(f.recommendedReorder * Number(product.unit_cost))}
              </span>
              {f.reorderByDate && daysRemaining(f.reorderByDate) <= 7 && (
                <span className="mt-1 text-[9px] font-semibold text-rose-500 flex items-center gap-0.5 bg-rose-500/10 px-1.5 py-0.5 rounded-full">
                  <Zap className="h-2.5 w-2.5" />
                  Order soon
                </span>
              )}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground/50 italic">Stocked</span>
          )}
        </td>

        {/* Toggle */}
        <td className="px-5 py-3.5 text-center">
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-all duration-200"
          >
            <ArrowUpDown className={`h-3.5 w-3.5 transition-all duration-300 ${expanded ? "rotate-180 text-primary" : ""}`} />
          </button>
        </td>
      </tr>

      {/* Expanded detail panel */}
      {expanded && (
        <tr className="border-b border-border/30">
          <td colSpan={12} className="px-5 py-0">
            <ExpandedForecastDetail product={product} stock={stock} f={f} velocityTag={velocityTag} pricingStrategy={pricingStrategy} defaultMargin={defaultMargin} />
          </td>
        </tr>
      )}
    </>
  );
}

// --------------- Edit pricing (recommendation stays read-only) ---------------

// Margin is stored as a decimal (0.4 = 40%) but edited as a percent (40).
// Legacy records may hold a raw percent (e.g. 40) — normalize those too.
function marginStoredToPercent(v: number | null | undefined): string {
  const n = Number(v ?? 0.4) || 0.4;
  const pct = n > 1 ? n : n * 100;
  return String(Math.round(pct * 100) / 100);
}

function EditPricingForm({ product, pricingStrategy, defaultMargin }: {
  product: Product;
  pricingStrategy: PricingStrategyResult | null;
  defaultMargin: number;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [unitCost, setUnitCost] = useState(String(product.unit_cost ?? ""));
  const [marginPct, setMarginPct] = useState(marginStoredToPercent(product.minimum_gross_margin_percentage ?? defaultMargin));
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
        minimum_gross_margin_percentage: Math.min(0.99, Math.max(0.01, (Number(marginPct) || 40) / 100)),
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
              <span className="mb-1 block text-[9px] uppercase tracking-widest text-muted-foreground">Unit cost ($)</span>
              <input
                type="number" step="0.01" value={unitCost}
                onChange={(e) => { dirtyRef.current = true; setUnitCost(e.target.value); }}
                className="w-full rounded-lg border border-border bg-input px-2.5 py-1.5 text-sm outline-none transition-all focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[9px] uppercase tracking-widest text-muted-foreground">Min gross margin (%)</span>
              <input
                type="number" step="0.5" min="1" max="99" value={marginPct}
                onChange={(e) => { dirtyRef.current = true; setMarginPct(e.target.value); }}
                className="w-full rounded-lg border border-border bg-input px-2.5 py-1.5 text-sm outline-none transition-all focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
              />
            </label>
          </div>
          <div className="space-y-1 rounded-lg border border-border/30 bg-muted/30 px-3 py-2 text-[10px]">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Min permitted price</span>
              <span className="font-mono font-semibold tabular-nums">${minPermitted.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Recommended {changePct !== 0 && `(applies ${changePct > 0 ? "+" : ""}${changePct}%)`}</span>
              <span className="font-mono font-semibold tabular-nums text-primary">${recommended.toFixed(2)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground transition-all duration-200 hover:opacity-90 disabled:opacity-60"
            >
              {save.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
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

// --------------- Cover gauge (Days cover cell) ---------------

function CoverGauge({ days, leadTime }: { days: number; leadTime: number }) {
  const ratio = days === Infinity ? 999 : days / Math.max(leadTime, 1);
  const pct = Math.min((ratio / 4) * 100, 100);
  const color =
    ratio < 1 ? "bg-rose-500" :
    ratio < 1.5 ? "bg-amber-500" :
    ratio < 3 ? "bg-emerald-500" :
    "bg-emerald-500";

  return (
    <div className="flex flex-col items-end">
      <div className="font-mono text-sm font-semibold tabular-nums">
        {days === Infinity ? "∞" : `${days}d`}
      </div>
      <div className="text-[9px] text-muted-foreground/60 mb-1">lead {leadTime}d</div>
      <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

// --------------- Expanded Detail (the star of the show) ---------------

function ExpandedForecastDetail({ product, stock, f, velocityTag, pricingStrategy, defaultMargin }: {
  product: Product; stock: number; f: ForecastResult;
  velocityTag: VelocityTag; pricingStrategy: PricingStrategyResult | null;
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

  const coverVsLead = f.daysOfCover === Infinity ? 999 : f.daysOfCover / Math.max(product.lead_time_days, 1);

  return (
    <div className="py-6 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* LEFT: Chart area (3/5 width) */}
        <div className="lg:col-span-3 space-y-4">
          {/* Demand trend chart */}
          <div className="rounded-xl border border-border/50 bg-card p-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="text-xs uppercase tracking-widest text-muted-foreground">Demand trend</h4>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">12mo history · 6mo forecast</p>
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
                      <stop offset="5%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.4)" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => v.toLocaleString()}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: '12px',
                      border: '1px solid hsl(var(--border) / 0.6)',
                      background: 'hsl(var(--popover))',
                      boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                      fontSize: '12px',
                    }}
                    formatter={(value: any, name: string) => {
                      if (value === null || value === undefined) return ['—', ''];
                      const labels: Record<string, string> = {
                        actual: 'Actual demand',
                        forecast: 'Forecast',
                        baseline: 'Baseline',
                        piLow: '80% CI Low',
                        piHigh: '80% CI High',
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
                    dot={{ r: 3, fill: 'hsl(var(--muted-foreground) / 0.6)', strokeWidth: 0 }}
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
                    dot={{ r: 4, fill: 'hsl(var(--primary))', strokeWidth: 0 }}
                    strokeDasharray="5 3"
                    connectNulls={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Monthly breakdown bars */}
          <div className="rounded-xl border border-border/50 bg-card p-4">
            <h4 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
              6-month forecast breakdown
            </h4>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={f.forecast} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.3)" vertical={false} />
                  <XAxis
                    dataKey="monthName"
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    tickFormatter={(v: string) => v.slice(0, 3)}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => v.toLocaleString()}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: '12px',
                      border: '1px solid hsl(var(--border) / 0.6)',
                      background: 'hsl(var(--popover))',
                      boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                      fontSize: '12px',
                    }}
                    formatter={(value: any, name: string) => [
                      value !== null ? value.toLocaleString() : '—',
                      name === 'qty' ? 'Forecast' : name === 'baseline' ? 'Baseline' : '',
                    ]}
                    labelFormatter={(label) => label}
                  />
                  <Bar dataKey="qty" name="qty" radius={[4, 4, 0, 0]}
                    fill="hsl(var(--primary))"
                    fillOpacity={0.8}
                  />
                  <Bar dataKey="baseline" name="baseline" radius={[4, 4, 0, 0]}
                    fill="hsl(var(--muted-foreground))"
                    fillOpacity={0.3}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-end gap-4 mt-2 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-primary/80" />
                Forecast demand
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-muted-foreground/30" />
                Baseline
              </span>
            </div>
          </div>
        </div>

        {/* RIGHT: Timeline & KPIs (2/5 width) */}
        <div className="lg:col-span-2 space-y-4">
          {/* Month-by-month stock requirement table */}
          <div className="rounded-xl border border-border/50 bg-card p-4">
            <h4 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
              Stock requirements by month
            </h4>
            <div className="space-y-1.5">
              {f.forecast.map((m, i) => (
                <MonthRequirementRow key={i} month={m} index={i} />
              ))}
            </div>
          </div>

          {/* Stockout timeline visualization */}
          <div className="rounded-xl border border-border/50 bg-card p-4">
            <h4 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
              Stockout timeline
            </h4>
            <StockoutTimeline
              stock={stock}
              dailyForecast={f.dailyForecast}
              estimatedStockoutDate={f.estimatedStockoutDate}
              reorderByDate={f.reorderByDate}
              nextRefillDate={f.nextRefillDate}
              leadTimeDays={product.lead_time_days}
              daysOfCover={f.daysOfCover}
              stockoutUrgency={f.stockoutUrgency}
            />
          </div>

          {/* Pricing strategy — enhanced visual card */}
          {pricingStrategy && (() => {
            const isDanger = pricingStrategy.strategy === "Clearance" || pricingStrategy.strategy === "Markdown / Promotion";
            const isWarning = pricingStrategy.strategy === "Targeted promotion" || pricingStrategy.strategy === "Monitor";
            const isPositive = pricingStrategy.strategy === "Protect margin" || pricingStrategy.strategy === "Hold price / protect availability";
            const isNeutral = pricingStrategy.strategy === "Hold price";

            const borderColor = isDanger ? "border-rose-300/60 dark:border-rose-800/40"
              : isWarning ? "border-amber-300/60 dark:border-amber-800/40"
              : isPositive ? "border-emerald-300/60 dark:border-emerald-800/40"
              : "border-border/50";

            const badgeBg = isDanger ? "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-400/30"
              : isWarning ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-400/30"
              : isPositive ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-400/30"
              : "bg-muted/40 text-muted-foreground border-border/40";

            const accentBar = isDanger ? "bg-rose-500"
              : isWarning ? "bg-amber-500"
              : isPositive ? "bg-emerald-500"
              : "bg-muted-foreground/30";

            const StrategyIcon = isDanger ? AlertTriangle
              : isWarning ? TrendingDown
              : isPositive ? TrendingUp
              : Minus;

            return (
              <div className={`rounded-xl border ${borderColor} bg-card overflow-hidden`}>
                {/* Colored accent bar */}
                <div className={`h-1 w-full ${accentBar}`} />

                <div className="p-4 space-y-3">
                  {/* Strategy header with icon */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${badgeBg}`}>
                        <StrategyIcon className="h-3.5 w-3.5" />
                      </div>
                      <div>
                        <div className="text-[9px] uppercase tracking-widest text-muted-foreground">
                          Pricing strategy
                        </div>
                        <div className="text-sm font-bold leading-tight">{pricingStrategy.strategy}</div>
                      </div>
                    </div>
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[8px] uppercase tracking-widest font-semibold ${badgeBg}`}>
                      {pricingStrategy.inventoryPosition}
                    </span>
                  </div>

                  {/* Rule triggered */}
                  <div className="rounded-lg bg-muted/30 px-3 py-2 border border-border/30">
                    <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-0.5">Rule triggered</div>
                    <div className="text-[11px] font-mono font-medium text-foreground/80">
                      {pricingStrategy.triggeredRule}
                    </div>
                  </div>

                  {/* Suggested action */}
                  <div className="space-y-1">
                    <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Action</div>
                    <div className="text-xs font-medium leading-relaxed">
                      {pricingStrategy.suggestedAction}
                    </div>
                  </div>

                  {/* Reason */}
                  <div className="space-y-1">
                    <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Reason</div>
                    <div className="text-[10px] text-muted-foreground/80 leading-relaxed">
                      {pricingStrategy.reason}
                    </div>
                  </div>

                  {/* Price comparison bar */}
                  <div className="rounded-lg border border-border/30 bg-muted/20 p-3 space-y-2">
                    <div className="text-[8px] uppercase tracking-widest text-muted-foreground">Price analysis</div>
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
                          <span className={`inline-flex items-center rounded-full px-1.5 py-px text-[8px] font-bold ${pricingStrategy.recommendedPriceChangePct > 0 ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : pricingStrategy.recommendedPriceChangePct < 0 ? "bg-rose-500/15 text-rose-600 dark:text-rose-400" : "bg-muted/40 text-muted-foreground"}`}>
                            {pricingStrategy.recommendedPriceChangePct > 0 ? "+" : ""}{pricingStrategy.recommendedPriceChangePct}%
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
                      value={pricingStrategy.conditions.velocity === "fast_mover" ? "Fast mover"
                        : pricingStrategy.conditions.velocity === "medium_mover" ? "Medium mover"
                        : pricingStrategy.conditions.velocity === "slow_mover" ? "Slow mover"
                        : "Dead"}
                      tone={pricingStrategy.conditions.velocity === "fast_mover" ? "positive"
                        : pricingStrategy.conditions.velocity === "medium_mover" ? "neutral"
                        : pricingStrategy.conditions.velocity === "slow_mover" ? "warning"
                        : "danger"}
                    />
                    <ConditionChip
                      label="Momentum"
                      value={pricingStrategy.conditions.momentum === "accelerating" ? "Accelerating"
                        : pricingStrategy.conditions.momentum === "stable" ? "Stable"
                        : pricingStrategy.conditions.momentum === "declining" ? "Declining"
                        : "Inactive"}
                      tone={pricingStrategy.conditions.momentum === "accelerating" ? "positive"
                        : pricingStrategy.conditions.momentum === "stable" ? "neutral"
                        : "danger"}
                    />
                    <ConditionChip
                      label="Days cover"
                      value={String(pricingStrategy.conditions.daysOfCover)}
                      tone={pricingStrategy.inventoryPosition === "low" ? "danger"
                        : pricingStrategy.inventoryPosition === "high" ? "warning"
                        : "positive"}
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
          <EditPricingForm product={product} pricingStrategy={pricingStrategy} defaultMargin={defaultMargin} />

          {/* Risk indicators */}
          <div className="rounded-xl border border-border/50 bg-card p-4">
            <h4 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
              Risk assessment
            </h4>
            <div className="space-y-2.5">
              <RiskBar
                label="Stockout risk"
                level={f.stockoutRisk}
                color={f.stockoutRisk === "high" ? "rose" : f.stockoutRisk === "medium" ? "amber" : "emerald"}
              />
              <RiskBar
                label="Overstock risk"
                level={f.overstockRisk}
                color={f.overstockRisk === "high" ? "rose" : f.overstockRisk === "medium" ? "amber" : "emerald"}
              />
              <RiskBar
                label="Coverage ratio"
                level={coverVsLead < 1 ? "high" : coverVsLead < 1.5 ? "medium" : "low"}
                color={coverVsLead < 1 ? "rose" : coverVsLead < 1.5 ? "amber" : "emerald"}
                detail={`${f.daysOfCover === Infinity ? "∞" : f.daysOfCover}d cover / ${product.lead_time_days}d lead`}
              />
            </div>
          </div>

          {/* KPI grid */}
          <div className="rounded-xl border border-border/50 bg-card p-4">
            <h4 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
              Key metrics
            </h4>
            <div className="grid grid-cols-2 gap-2">
              <KpiSquare label="Monthly avg" value={f.avgMonthly.toLocaleString()} />
              <KpiSquare
                label="Trend"
                value={`${f.trend > 0 ? "+" : ""}${f.trend}/mo`}
                tone={f.trend > 0 ? "success" : f.trend < 0 ? "destructive" : undefined}
              />
              <KpiSquare label="Trend strength" value={`${Math.round(f.trendStrength * 100)}%`} tone={f.trendStrength > 0.7 ? "primary" : undefined} />
              <KpiSquare label="Seasonality" value={`×${f.seasonalityFactor.toFixed(2)}`} />
              <KpiSquare label="Daily demand" value={`${f.dailyForecast.toFixed(1)}/d`} />
              <KpiSquare label="Recommended qty" value={f.recommendedReorder.toLocaleString()} tone="primary" />
              <KpiSquare label="Reorder value" value={fmtMoney(f.recommendedReorder * Number(product.unit_cost))} />
              <KpiSquare label="Next month" value={f.finalForecast.toLocaleString()} />
              <KpiSquare
                label="Adjusted next mo"
                value={f.adjustmentFactor !== 1 ? f.adjustedNextForecast.toLocaleString() : "—"}
                tone={f.adjustmentFactor !== 1 ? "primary" : undefined}
              />
              <KpiSquare label="In stock value" value={fmtMoney(stock * Number(product.unit_cost))} />
            </div>
          </div>
        </div>
      </div>

      {/* Calculation details section — shows every formula with numbers */}
      <CalculationDetails breakdown={f.calculationBreakdown} />
    </div>
  );
}

// --------------- Stockout Timeline Visualization ---------------

function StockoutTimeline({
  stock, dailyForecast, estimatedStockoutDate, reorderByDate, nextRefillDate,
  leadTimeDays, daysOfCover, stockoutUrgency,
}: {
  stock: number; dailyForecast: number; estimatedStockoutDate: string | null;
  reorderByDate: string | null; nextRefillDate: string; leadTimeDays: number;
  daysOfCover: number; stockoutUrgency: string;
}) {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const refillDate = nextRefillDate;
  const outDate = estimatedStockoutDate ?? "N/A";

  // Calculate relative positions for the timeline bar (0% = today, 100% = refill date or stockout, whichever is later)
  const endDate = outDate !== "N/A"
    ? (refillDate > outDate ? refillDate : outDate)
    : refillDate;
  const totalDays = daysRemaining(endDate);
  const safeTotal = Math.max(totalDays, 1);

  const reorderPct = reorderByDate ? (daysRemaining(reorderByDate) / safeTotal) * 100 : 100;
  const outPct = outDate !== "N/A" ? (daysRemaining(outDate) / safeTotal) * 100 : 100;
  const refillPct = (daysRemaining(refillDate) / safeTotal) * 100;

  return (
    <div className="space-y-3">
      {/* Timeline bar */}
      <div className="relative h-7">
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-2 rounded-full bg-muted">
          {/* Stock cover segment */}
          <div
            className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ${
              stockoutUrgency === "critical" ? "bg-gradient-to-r from-rose-500 to-rose-300" :
              stockoutUrgency === "warning" ? "bg-gradient-to-r from-amber-500 to-amber-300" :
              "bg-gradient-to-r from-emerald-500 to-emerald-300"
            }`}
            style={{ width: `${Math.min(Math.max(outPct, 5), 100)}%` }}
          />
        </div>
        {/* Markers */}
        {reorderByDate && (
          <div className="absolute top-0" style={{ left: `${Math.min(Math.max(reorderPct, 3), 97)}%` }}>
            <div className="w-0.5 h-7 bg-amber-400 rounded-full" />
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-[8px] font-semibold text-amber-500 whitespace-nowrap">
              ⚑ Order
            </div>
          </div>
        )}
        {outDate !== "N/A" && (
          <div className="absolute top-0" style={{ left: `${Math.min(Math.max(outPct, 3), 97)}%` }}>
            <div className="w-0.5 h-7 bg-rose-500 rounded-full" />
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-[8px] font-semibold text-rose-500 whitespace-nowrap">
              ✕ Out
            </div>
          </div>
        )}
        <div className="absolute top-0" style={{ left: `${Math.min(Math.max(refillPct, 3), 97)}%` }}>
          <div className="w-0.5 h-7 bg-primary rounded-full" />
          <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-[8px] font-semibold text-primary whitespace-nowrap">
            ✓ In
          </div>
        </div>
      </div>

      {/* Timeline labels */}
      <div className="space-y-1.5">
        <TimelineRow
          label="Today"
          value={todayStr}
          icon={<Clock className="h-3 w-3" />}
          color="text-foreground"
        />
        {reorderByDate && (
          <TimelineRow
            label="Reorder by"
            value={reorderByDate}
            detail={`${daysRemaining(reorderByDate) > 0 ? `${daysRemaining(reorderByDate)} days` : "OVERDUE"}`}
            icon={<Clock className="h-3 w-3" />}
            color={stockoutUrgency === "critical" ? "text-rose-500" : stockoutUrgency === "warning" ? "text-amber-500" : "text-muted-foreground"}
          />
        )}
        <TimelineRow
          label="Refill arrives"
          value={refillDate}
          detail={`${daysRemaining(refillDate)} days`}
          icon={<Truck className="h-3 w-3" />}
          color="text-primary"
        />
        <TimelineRow
          label="Stockout"
          value={outDate}
          detail={outDate !== "N/A" ? `${daysRemaining(outDate)} days away` : "No stockout risk"}
          icon={<AlertTriangle className="h-3 w-3" />}
          color={stockoutUrgency === "critical" ? "text-rose-500" : stockoutUrgency === "warning" ? "text-amber-500" : "text-emerald-500"}
        />
      </div>
    </div>
  );
}

// --------------- Risk Bar ---------------

function RiskBar({ label, level, color, detail }: {
  label: string; level: string; color: "rose" | "amber" | "emerald"; detail?: string;
}) {
  const pct = level === "high" ? 100 : level === "medium" ? 60 : 20;
  const barColor = color === "rose" ? "bg-rose-500" : color === "amber" ? "bg-amber-500" : "bg-emerald-500";
  const textColor = color === "rose" ? "text-rose-600" : color === "amber" ? "text-amber-600" : "text-emerald-600";

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
        <span className={`text-[10px] font-semibold uppercase ${textColor}`}>{level}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      {detail && <div className="text-[9px] text-muted-foreground/60 mt-0.5">{detail}</div>}
    </div>
  );
}

// --------------- Supporting components ---------------

function TimelineRow({ label, value, detail, icon, color }: {
  label: string; value: string; detail?: string;
  icon: React.ReactNode; color: string;
}) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <div className={`${color} flex-shrink-0`}>{icon}</div>
      <div className="flex-1 min-w-0 flex items-baseline justify-between gap-2">
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className={`text-xs font-semibold tabular-nums ${color}`}>{value}</span>
      </div>
      {detail && <span className="text-[9px] text-muted-foreground/50">{detail}</span>}
    </div>
  );
}

// --------------- Month-by-month stock requirement row ---------------

function MonthRequirementRow({ month, index }: {
  month: ForecastResult['forecast'][0];
  index: number;
}) {
  const isNext = index === 0;
  const isNextNext = index === 1;

  return (
    <div className={`flex items-center gap-3 py-2 px-3 rounded-lg transition-all ${
      isNext
        ? "bg-primary/5 border border-primary/15"
        : isNextNext
        ? "bg-muted/30 border border-border/30"
        : ""
    }`}>
      {/* Month badge */}
      <div className="flex-shrink-0 w-20">
        <div className="text-[10px] font-semibold uppercase tracking-wide">
          {isNext && <span className="text-primary">Next · </span>}
          {month.monthName}
        </div>
        <div className="text-[8px] text-muted-foreground/50">{month.month}</div>
      </div>

      {/* Demand bar */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[9px] text-muted-foreground">Demand</span>
          <span className="font-mono text-xs font-semibold tabular-nums">{month.qty.toLocaleString()}</span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary/60"
            style={{ width: `${Math.min((month.qty / 100) * 100, 100)}%` }}
          />
        </div>
      </div>

      {/* Stock required */}
      <div className="flex-shrink-0 text-right min-w-[70px]">
        <div className="text-[9px] text-muted-foreground">Stock req</div>
        <div className="font-mono text-xs font-semibold tabular-nums">
          {month.stockRequired.toLocaleString()}
        </div>
      </div>

      {/* Projected after */}
      <div className="flex-shrink-0 text-right min-w-[70px]">
        <div className="text-[9px] text-muted-foreground">After demand</div>
        <div className={`font-mono text-xs font-semibold tabular-nums ${
          month.projectedStockAfter <= 0 ? "text-rose-500" :
          month.projectedStockAfter < month.stockRequired * 0.3 ? "text-amber-500" :
          "text-emerald-500"
        }`}>
          {month.projectedStockAfter.toLocaleString()}
        </div>
      </div>

      {/* Suggested order */}
      <div className="flex-shrink-0 text-right min-w-[75px]">
        <div className="text-[9px] text-muted-foreground">Order if short</div>
        <div className={`font-mono text-xs font-semibold tabular-nums ${
          month.suggestedOrder > 0 ? "text-primary" : "text-muted-foreground/40"
        }`}>
          {month.suggestedOrder > 0 ? month.suggestedOrder.toLocaleString() : "—"}
        </div>
      </div>

      {/* Daily rate */}
      <div className="flex-shrink-0 text-right min-w-[55px] hidden md:block">
        <div className="text-[9px] text-muted-foreground">/day</div>
        <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {month.dailyRate.toFixed(1)}
        </div>
      </div>
    </div>
  );
}

function KpiSquare({ label, value, tone }: {
  label: string; value: string; tone?: "success" | "destructive" | "primary" | "warning";
}) {
  const t = tone === "success" ? "text-emerald-500" : tone === "destructive" ? "text-rose-500"
    : tone === "primary" ? "text-primary" : tone === "warning" ? "text-amber-500" : "text-foreground";
  return (
    <div className="rounded-lg border border-border/40 bg-muted/20 p-2.5 hover:bg-muted/40 transition-colors">
      <div className="text-[8px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`font-semibold text-sm tabular-nums ${t}`}>{value}</div>
    </div>
  );
}

function StatTile({ label, value, tone, icon }: { label: string; value: string | number; tone?: "warning" | "destructive"; icon?: React.ReactNode }) {
  const t = tone === "warning" ? "text-amber-500" : tone === "destructive" ? "text-rose-500" : "text-foreground";
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-center justify-between">
        <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
        {icon}
      </div>
      <div className={`mt-1.5 font-display text-2xl tabular-nums ${t}`}>{value}</div>
    </div>
  );
}

function Pill({ children, tone }: { children: React.ReactNode; tone: "success" | "warning" | "destructive" | "primary" }) {
  const s = tone === "success" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
    : tone === "warning" ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
    : tone === "primary" ? "bg-primary/10 text-primary border-primary/30"
    : "bg-rose-500/10 text-rose-600 border-rose-500/30";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-widest font-semibold ${s}`}>
      {children}
    </span>
  );
}

function ConditionChip({ label, value, tone }: {
  label: string; value: string; tone: "positive" | "warning" | "danger" | "neutral";
}) {
  const bg = tone === "positive" ? "bg-emerald-500/10 border-emerald-500/20"
    : tone === "warning" ? "bg-amber-500/10 border-amber-500/20"
    : tone === "danger" ? "bg-rose-500/10 border-rose-500/20"
    : "bg-muted/30 border-border/30";
  const txt = tone === "positive" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "warning" ? "text-amber-600 dark:text-amber-400"
    : tone === "danger" ? "text-rose-600 dark:text-rose-400"
    : "text-muted-foreground";
  return (
    <div className={`rounded-lg border ${bg} px-2.5 py-1.5`}>
      <div className="text-[8px] uppercase tracking-widest text-muted-foreground/70">{label}</div>
      <div className={`text-[11px] font-semibold tabular-nums ${txt}`}>{value}</div>
    </div>
  );
}

// ===========================================================================
// Calculation Details — shows every intermediate variable with actual numbers
// ===========================================================================

function CalculationDetails({ breakdown }: { breakdown: CalculationBreakdown }) {
  const [openSection, setOpenSection] = useState<string | null>(null);

  const toggle = (id: string) =>
    setOpenSection(openSection === id ? null : id);

  return (
    <div className="mt-6 border-t border-border/30 pt-6 space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <div className="h-4 w-1 rounded-full bg-primary" />
        <h4 className="text-xs uppercase tracking-widest text-foreground/70 font-semibold">
          Full calculation breakdown
        </h4>
        <div className="text-[9px] text-muted-foreground/40">
          — every variable with actual numbers
        </div>
      </div>

      {/* 1. Input Data */}
      <CalcSection
        id="input"
        label="① Input data"
        open={openSection}
        onToggle={toggle}
      >
        <div className="text-[10px] text-muted-foreground mb-2">
          Historical monthly demand values (corrected for stockouts):
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
          {breakdown.inputData.values.map((v, i) => (
            <CalcVar
              key={i}
              name={breakdown.inputData.monthLabels[i] ?? `M${i}`}
              value={v}
            />
          ))}
        </div>
      </CalcSection>

      {/* 2. Average (simple) */}
      <CalcSection
        id="wavg"
        label="② Weighted average (12 months · 3/2/1 weights)"
        open={openSection}
        onToggle={toggle}
      >
        <Formula formula={breakdown.weightedAverage.formula} />
        <CalcTable
          headers={["Month", "Demand"]}
          rows={breakdown.weightedAverage.values.map((v, i) => [
            breakdown.inputData.monthLabels[i] ?? `M${i}`,
            String(v),
          ])}
        />
        <div className="mt-2 space-y-1 text-[11px]">
          <CalcLine
            label="Σ (demand × weight)"
            value={String(breakdown.weightedAverage.weightedSum)}
          />
          <CalcLine
            label="Σ weights"
            value={String(breakdown.weightedAverage.weightSum)}
          />
          <CalcLine
            label="Weighted avg"
            value={String(breakdown.weightedAverage.result)}
            highlight
            formula={`${breakdown.weightedAverage.weightedSum} ÷ ${breakdown.weightedAverage.weightSum} = ${breakdown.weightedAverage.result}`}
          />
        </div>
      </CalcSection>

      {/* 3. Trend Analysis */}
      <CalcSection
        id="trend"
        label="③ Trend analysis (linear regression)"
        open={openSection}
        onToggle={toggle}
      >
        <Formula formula={breakdown.trendAnalysis.formula} />
        <div className="grid grid-cols-2 gap-2 mt-2">
          <CalcVar name="ΣX (month idx)" value={breakdown.trendAnalysis.sumX ?? 0} />
          <CalcVar name="ΣY (sales)" value={breakdown.trendAnalysis.sumY ?? 0} />
          <CalcVar name="ΣXY" value={breakdown.trendAnalysis.sumXY ?? 0} />
          <CalcVar name="ΣX²" value={breakdown.trendAnalysis.sumX2 ?? 0} />
          <CalcVar name="Numerator" value={breakdown.trendAnalysis.numerator ?? 0} />
          <CalcVar name="Denominator" value={breakdown.trendAnalysis.denominator ?? 0} />
          <CalcVar
            name="Slope"
            value={breakdown.trendAnalysis.slope}
            highlight
          />
          <CalcVar name="SS Residual" value={breakdown.trendAnalysis.ssRes} />
          <CalcVar name="SS Total" value={breakdown.trendAnalysis.ssTot} />
          <CalcVar name="R² (strength)" value={breakdown.trendAnalysis.rSquared} highlight />
          <CalcVar name="Direction threshold" value={breakdown.trendAnalysis.threshold} />
          <CalcVar name="Direction" value={breakdown.trendAnalysis.direction} />
        </div>
      </CalcSection>

      {/* 4. Seasonality Factors */}
      <CalcSection
        id="seas"
        label="④ Seasonality factors (raw, no smoothing)"
        open={openSection}
        onToggle={toggle}
      >
        <Formula formula={breakdown.seasonality.formula} />
        <div className="text-[10px] text-muted-foreground mb-1">
          Overall average: <span className="font-mono font-semibold">{breakdown.seasonality.overallAvg}</span>
        </div>
        <CalcTable
          headers={["Month", "Avg", "Raw", "Prev", "Next", "Factor", "Clamped"]}
          rows={breakdown.seasonality.perMonthBreakdown.map((m) => [
            m.monthName.slice(0, 3),
            String(m.monthAvg),
            String(m.rawFactor),
            String(m.prevRawFactor),
            String(m.nextRawFactor),
            String(m.smoothedFactor),
            String(m.clampedFactor),
          ])}
        />
        <div className="mt-1 text-[9px] text-muted-foreground/60">
          Formula: clamp(targetAvg ÷ overallAvg, 0.5, 2.0) — raw factor, no neighbor smoothing
        </div>
      </CalcSection>

      {/* 5. Per-Month Forecast */}
      <CalcSection
        id="monthly"
        label="⑤ Month-by-month forecast calculation"
        open={openSection}
        onToggle={toggle}
      >
        <div className="space-y-4">
          {breakdown.monthlyDetail.map((m, i) => (
            <div
              key={i}
              className={`rounded-lg border p-3 ${
                i === 0
                  ? "border-primary/20 bg-primary/[0.03]"
                  : "border-border/40"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold uppercase tracking-wide">
                  {m.monthName}
                </span>
                {i === 0 && (
                  <span className="text-[9px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                    Next month
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-1 text-[10px]">
                <CalcVar name="Trend contrib" value={m.trendContribution} />
                <CalcVar name="Weighted baseline + trend" value={m.avgPlusTrend} />
                <CalcVar name="Seas factor" value={m.seasonalityFactor} />
                <CalcVar name="Weighted baseline + trend contrib" value={m.avgPlusTrend} />
                <CalcVar name="Baseline (× seasonality)" value={m.baseline} />
                <CalcVar name="Factors ×" value={m.factorsMultiplied} />
                <CalcVar name="Clamp [low, high]" value={`[${m.clampLow}, ${m.clampHigh}]`} />
                <CalcVar name="Final forecast" value={m.finalForecast} highlight />
                <CalcVar name="Days in month" value={m.daysInMonth} />
                <CalcVar name="Daily rate" value={m.dailyRate} />
                <CalcVar name="Running stock (start)" value={m.runningStockBefore} />
                <CalcVar name="Stock required" value={m.stockRequired} />
                <CalcVar name="Safety stock days" value={m.safetyStockDays} />
                <CalcVar name="Safety stock (units)" value={m.monthlySafetyStock} />
                <CalcVar name="Stock shortfall" value={m.stockShortfall} />
                <CalcVar
                  name="Suggested order"
                  value={m.suggestedOrder}
                  highlight={m.suggestedOrder > 0}
                />
                <CalcVar name="80% CI low" value={m.predictionIntervalLow} />
                <CalcVar name="80% CI high" value={m.predictionIntervalHigh} />
                <CalcVar name="Projected stock after" value={m.projectedStockAfter} />
              </div>
              <div className="mt-1.5 text-[9px] text-muted-foreground/50">
                baseline = {m.avgPlusTrend} × {m.seasonalityFactor} = {m.baseline} ·
                final = clamp({m.baseline} × {m.factorsMultiplied}, {m.clampLow}, {m.clampHigh}) = {m.finalForecast} ·
                daily = {m.finalForecast} ÷ {m.daysInMonth}d = {m.dailyRate}/d
              </div>
            </div>
          ))}
        </div>
      </CalcSection>

      {/* 6. Reorder Calculation */}
      <CalcSection
        id="reorder"
        label="⑥ Reorder calculation"
        open={openSection}
        onToggle={toggle}
      >
        <div className="space-y-2 text-[11px]">
          <div className="font-medium text-xs mb-1">Daily average — last 3 completed months</div>
          <CalcTable
            headers={["Month", "Corrected demand", "Days"]}
            rows={breakdown.reorder.lastThreeMonths.map((m) => [
              m.monthName,
              String(m.demand),
              String(m.days),
            ])}
          />
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <CalcVar name="Total demand" value={String(breakdown.reorder.totalDemand)} />
            <CalcVar name="Calendar days" value={String(breakdown.reorder.totalDays)} />
            <CalcVar
              name="Daily avg demand"
              value={breakdown.reorder.dailyAverage}
              highlight
              formula={`${breakdown.reorder.totalDemand} ÷ ${breakdown.reorder.totalDays} = ${breakdown.reorder.dailyAverage}`}
            />
          </div>

          <div className="font-medium text-xs mt-3 mb-1">Required stock (daily avg × (lead + safety))</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <CalcVar name="Supplier lead days" value={breakdown.reorder.supplierLeadDays} />
            <CalcVar name="Safety stock days" value={breakdown.reorder.safetyStockDays} />
            <CalcVar
              name="Safety stock"
              value={breakdown.reorder.safetyStockUnits}
            />
            <CalcVar
              name="Required stock"
              value={breakdown.reorder.requiredStock}
              highlight
              formula={`${breakdown.reorder.dailyAverage} × (${breakdown.reorder.supplierLeadDays} + ${breakdown.reorder.safetyStockDays}) = ${breakdown.reorder.requiredStock}`}
            />
          </div>
          {breakdown.reorder.safetyStockFormula && (
            <div className="text-[9px] text-muted-foreground/60 font-mono">
              safety stock = {breakdown.reorder.safetyStockFormula} = {breakdown.reorder.safetyStockUnits}
            </div>
          )}

          <div className="font-medium text-xs mt-3 mb-1">Recommended order qty</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <CalcVar name="Inventory position" value={breakdown.reorder.inventoryPosition} />
            <CalcVar
              name="Before caps"
              value={breakdown.reorder.recommendedBeforeCaps}
              formula={`max(0, ${breakdown.reorder.requiredStock} - ${breakdown.reorder.inventoryPosition})`}
            />
            {breakdown.reorder.maxCoverDays && (
              <>
                <CalcVar name="Max cover days" value={breakdown.reorder.maxCoverDays} />
                <CalcVar name="Max stock" value={breakdown.reorder.maxStock ?? 0} />
                <CalcVar name="Headroom" value={breakdown.reorder.headroom ?? 0} />
              </>
            )}
            {breakdown.reorder.minimumOrderQty && (
              <CalcVar
                name="Min order qty"
                value={breakdown.reorder.minimumOrderQty}
              />
            )}
            {breakdown.reorder.orderMultiple && (
              <CalcVar
                name="Order multiple"
                value={breakdown.reorder.orderMultiple}
              />
            )}
            <CalcVar
              name="Final recommended"
              value={breakdown.reorder.finalRecommended}
              highlight
            />
          </div>
        </div>
      </CalcSection>

      {/* 7. Live Pace Adjustment */}
      <CalcSection
        id="pace"
        label="⑦ Live pace adjustment (next month)"
        open={openSection}
        onToggle={toggle}
      >
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
          <CalcVar
            name="Current mo. base forecast"
            value={breakdown.paceAdjustment.currentMonthBaseForecast}
          />
          <CalcVar
            name="Next mo. base forecast"
            value={breakdown.paceAdjustment.nextMonthBaseForecast}
          />
          <CalcVar name="Days elapsed" value={breakdown.paceAdjustment.daysElapsed} />
          <CalcVar name="Days in month" value={breakdown.paceAdjustment.daysInMonth} />
          <CalcVar
            name="Expected sales to date"
            value={breakdown.paceAdjustment.expectedSalesToDate}
            formula={`${breakdown.paceAdjustment.currentMonthBaseForecast} × ${breakdown.paceAdjustment.daysElapsed} ÷ ${breakdown.paceAdjustment.daysInMonth} = ${breakdown.paceAdjustment.expectedSalesToDate}`}
          />
          <CalcVar
            name="Actual sales to date"
            value={breakdown.paceAdjustment.actualSalesToDate}
          />
          <CalcVar
            name="Sales pace ratio"
            value={breakdown.paceAdjustment.salesPaceRatio ?? "—"}
            formula={
              breakdown.paceAdjustment.salesPaceRatio != null
                ? `${breakdown.paceAdjustment.actualSalesToDate} ÷ ${breakdown.paceAdjustment.expectedSalesToDate} = ${breakdown.paceAdjustment.salesPaceRatio}`
                : undefined
            }
          />
          <CalcVar
            name="Adjustment factor"
            value={breakdown.paceAdjustment.adjustmentFactor}
            highlight
            formula={
              breakdown.paceAdjustment.salesPaceRatio != null
                ? `1 + 0.30 × (${breakdown.paceAdjustment.salesPaceRatio} − 1), clamped to [0.80, 1.20]`
                : "no adjustment applies"
            }
          />
          <CalcVar
            name="Adjusted next month"
            value={breakdown.paceAdjustment.adjustedNextForecast}
            highlight
            formula={`${breakdown.paceAdjustment.nextMonthBaseForecast} × ${breakdown.paceAdjustment.adjustmentFactor} = ${breakdown.paceAdjustment.adjustedNextForecast}`}
          />
        </div>
        <div className="mt-2 rounded-lg bg-muted/30 border border-border/30 px-3 py-2 text-[10px] text-muted-foreground">
          <span className="text-muted-foreground/60">Reason: </span>
          {breakdown.paceAdjustment.reason}
        </div>
      </CalcSection>

      {/* 8. Days of Cover & Velocity */}
      <CalcSection
        id="cover"
        label="⑧ Days of cover & velocity"
        open={openSection}
        onToggle={toggle}
      >
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
          <CalcVar
            name="Inventory position"
            value={breakdown.daysOfCover.inventoryPosition}
          />
          <CalcVar
            name="Daily forecast"
            value={breakdown.daysOfCover.dailyForecast}
          />
          <CalcVar
            name="Days of cover"
            value={
              breakdown.daysOfCover.daysOfCover === Infinity
                ? "∞"
                : breakdown.daysOfCover.daysOfCover
            }
            highlight
            formula={
              breakdown.daysOfCover.dailyForecast > 0
                ? `${breakdown.daysOfCover.inventoryPosition} ÷ ${breakdown.daysOfCover.dailyForecast} = ${breakdown.daysOfCover.daysOfCover}`
                : `Recent 3mo avg: ${breakdown.daysOfCover.recent3MonthAvg} ÷ 30 = ${breakdown.daysOfCover.recentDaily}`
            }
          />
          <CalcVar
            name="Recent 3mo avg"
            value={breakdown.daysOfCover.recent3MonthAvg}
          />
          <CalcVar name="Recent daily" value={breakdown.daysOfCover.recentDaily} />
          <CalcVar
            name="Velocity"
            value={breakdown.momentum.result}
            highlight
            formula={
              breakdown.momentum.recent3MonthAvg >= breakdown.momentum.threshold120pct
                ? `${breakdown.momentum.recent3MonthAvg} ≥ ${breakdown.momentum.threshold120pct} → accelerating`
                : breakdown.momentum.recent3MonthAvg >= breakdown.momentum.threshold60pct
                ? `${breakdown.momentum.recent3MonthAvg} ≥ ${breakdown.momentum.threshold60pct} → stable`
                : breakdown.momentum.recent3MonthAvg > 0
                ? `${breakdown.momentum.recent3MonthAvg} < ${breakdown.momentum.threshold60pct} → declining`
                : `0 → dead`
            }
          />
        </div>
      </CalcSection>

      {/* 9. Risk & Timeline */}
      <CalcSection
        id="risk"
        label="⑨ Risk assessment & timeline"
        open={openSection}
        onToggle={toggle}
      >
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
          <CalcVar
            name="Cover / Lead ratio"
            value={breakdown.risk.coverVsLead}
            formula={`${breakdown.daysOfCover.daysOfCover} ÷ ${breakdown.reorder.supplierLeadDays} = ${breakdown.risk.coverVsLead}`}
          />
          <CalcVar name="Stockout risk" value={breakdown.risk.stockoutRisk} highlight />
          <CalcVar name="Max cover days" value={breakdown.risk.maxCoverDays} />
          <CalcVar name="Overstock risk" value={breakdown.risk.overstockRisk} />
          <CalcVar
            name="Days until stockout"
            value={breakdown.timeline.daysUntilStockout ?? "N/A"}
          />
          <CalcVar name="Stockout date" value={breakdown.timeline.estimatedStockoutDate ?? "—"} />
          <CalcVar name="Reorder by date" value={breakdown.timeline.reorderByDate ?? "—"} />
          <CalcVar name="Next refill date" value={breakdown.timeline.nextRefillDate} />
          <CalcVar
            name="Stockout urgency"
            value={breakdown.timeline.stockoutUrgency}
            highlight
          />
        </div>
      </CalcSection>
    </div>
  );
}

// --------------- Calculation Details Sub-components ---------------

function CalcSection({
  id,
  label,
  open,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  open: string | null;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}) {
  const isOpen = open === id;
  return (
    <div className="rounded-xl border border-border/40 overflow-hidden transition-all duration-200">
      <button
        onClick={() => onToggle(id)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-muted/20 transition-colors text-xs font-medium"
      >
        <span>{label}</span>
        <svg
          className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div className="px-4 pb-4 pt-1 border-t border-border/20">
          {children}
        </div>
      )}
    </div>
  );
}

function Formula({ formula }: { formula: string }) {
  return (
    <div className="mb-2 p-2 rounded-lg bg-muted/30 border border-border/20 text-[10px] font-mono text-primary/80">
      <span className="text-[8px] uppercase tracking-widest text-muted-foreground mr-2">Formula:</span>
      {formula}
    </div>
  );
}

function CalcVar({
  name,
  value,
  highlight,
  formula,
}: {
  name: string;
  value: string | number;
  highlight?: boolean;
  formula?: string;
}) {
  return (
    <div
      className={`rounded-lg px-2.5 py-1.5 border ${
        highlight
          ? "border-primary/30 bg-primary/5"
          : "border-border/20 bg-muted/15"
      }`}
    >
      <div className="text-[8px] uppercase tracking-wider text-muted-foreground/70">
        {name}
      </div>
      <div
        className={`font-mono text-xs tabular-nums ${
          highlight ? "text-primary font-bold" : "text-foreground/80"
        }`}
      >
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      {formula && (
        <div className="text-[8px] text-muted-foreground/40 font-mono mt-0.5 truncate">
          {formula}
        </div>
      )}
    </div>
  );
}

function CalcLine({
  label,
  value,
  highlight,
  formula,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  formula?: string;
}) {
  return (
    <div
      className={`flex items-center justify-between px-2.5 py-1 rounded ${
        highlight ? "bg-primary/5 border border-primary/20" : ""
      }`}
    >
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <div className="text-right">
        <span
          className={`font-mono text-xs font-semibold tabular-nums ${
            highlight ? "text-primary" : "text-foreground/80"
          }`}
        >
          {value}
        </span>
        {formula && (
          <div className="text-[8px] text-muted-foreground/40 font-mono mt-0.5">
            {formula}
          </div>
        )}
      </div>
    </div>
  );
}

function CalcTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="table-premium w-full text-[10px]">
        <thead>
          <tr className="border-b border-border/20">
            {headers.map((h, i) => (
              <th
                key={i}
                className="text-left font-medium text-muted-foreground/60 py-1 pr-3 whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-border/10">
              {row.map((cell, ci) => (
                <td key={ci} className="font-mono text-foreground/70 py-1 pr-3 whitespace-nowrap">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
