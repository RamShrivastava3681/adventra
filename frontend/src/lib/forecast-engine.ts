// Enhanced forecast engine with exponentially weighted trend detection,
// smoothed seasonality, confidence intervals, and availability-aware corrections.
// Designed for accurate, AI-like demand forecasting across all product categories.

export type MonthlyBucket = {
  month: string; // 'YYYY-MM'
  qty: number; // corrected demand (used by the model)
  rawQty?: number; // actual outbound sales
  availabilityRate?: number; // 0..1
};

export type MovementInput = {
  movement_date: string;
  quantity: number;
  direction: string;
};

// Per-month availability signal for a SKU. Provide as many months as known.
export type AvailabilityInput = {
  month: string; // 'YYYY-MM'
  inStockDays: number;
  daysInMonth?: number; // defaults to real calendar days
};

// Optional business factors applied on top of the baseline forecast.
export type ForecastFactors = {
  trekkingSeasonIndex?: number; // 0.85..1.20
  weatherIndex?: number; // 0.80..1.25
  promotionLift?: number; // 1.00..1.35
  regionalDemandIndex?: number; // 0.75..1.30
  eventLift?: number; // 1.00..1.25
};

// Optional per-SKU configuration.
export type SKUConfig = {
  productCategory?: string;
  seasonProfile?: string;
  weatherSensitivity?: "low" | "medium" | "high";
  lifecycleStage?: "intro" | "growth" | "mature" | "decline";
  region?: string;
  supplierLeadTimeDays?: number;
  leadTimeVariabilityDays?: number;
  minimumOrderQty?: number;
  orderMultiple?: number;
  serviceLevelTarget?: number; // e.g. 0.95
  safetyStockDays?: number;
  maxCoverDays?: number;
  isProtectedCore?: boolean;
  confirmedInboundStock?: number;
  committedCustomerOrders?: number;
  /** Minimum gross margin as a decimal (e.g. 0.40 = 40%). Used by pricing strategy. */
  minimumGrossMarginPercentage?: number;
};

export type MomentumTag = "accelerating" | "stable" | "declining" | "inactive";
export type VelocityTag = "fast_mover" | "medium_mover" | "slow_mover" | "dead";
export type InventoryPosition = "low" | "normal" | "high";

export type PricingStrategyResult = {
  strategy: string;
  suggestedAction: string;
  reason: string;
  minimumPrice: number;
  inventoryPosition: InventoryPosition;
  /** The specific pricing rule that was triggered */
  triggeredRule: string;
  /** Input conditions that led to this recommendation */
  conditions: {
    velocity: VelocityTag;
    momentum: MomentumTag;
    daysOfCover: number;
    unitCost: number;
    unitPrice: number;
    minGrossMarginPct: number;
    supplierLeadTimeDays: number;
    safetyStockDays: number;
    maxCoverDays: number;
  };
};

// -----------------------------------------------------------------------------
// Availability correction
// -----------------------------------------------------------------------------

function daysInMonthFor(monthKey: string): number {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

/**
 * Corrects outbound sales for stockout months.
 *   availabilityRate = inStockDays / daysInMonth
 *   correctedDemand  = actual / max(availabilityRate, 0.70)
 *   correctedDemand  = min(correctedDemand, actual * 1.4)
 * When availability data is missing the raw value is used unchanged.
 */
export function correctForAvailability(
  actualOutboundQty: number,
  monthKey: string,
  availability?: AvailabilityInput
): { correctedDemand: number; availabilityRate?: number } {
  if (!availability) return { correctedDemand: actualOutboundQty };
  const dim = availability.daysInMonth ?? daysInMonthFor(monthKey);
  if (!dim || dim <= 0) return { correctedDemand: actualOutboundQty };
  const rate = Math.max(0, Math.min(1, availability.inStockDays / dim));
  if (rate >= 1) return { correctedDemand: actualOutboundQty, availabilityRate: 1 };
  const divisor = Math.max(rate, 0.7);
  const corrected = Math.min(actualOutboundQty / divisor, actualOutboundQty * 1.4);
  return { correctedDemand: corrected, availabilityRate: rate };
}

// -----------------------------------------------------------------------------
// Bucketing
// -----------------------------------------------------------------------------

export function bucketMovementsByMonth(
  movements: MovementInput[],
  months: number = 12,
  availability?: AvailabilityInput[]
): MonthlyBucket[] {
  const now = new Date();
  const buckets: MonthlyBucket[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      qty: 0,
      rawQty: 0,
    });
  }
  const idx = new Map(buckets.map((b, i) => [b.month, i]));
  const availByMonth = new Map((availability ?? []).map((a) => [a.month, a]));

  for (const m of movements) {
    if (m.direction !== "out") continue;
    const k = m.movement_date.slice(0, 7);
    const i = idx.get(k);
    if (i != null) (buckets[i].rawQty as number) += Number(m.quantity);
  }

  for (const b of buckets) {
    const raw = b.rawQty ?? 0;
    const { correctedDemand, availabilityRate } = correctForAvailability(
      raw,
      b.month,
      availByMonth.get(b.month)
    );
    b.qty = correctedDemand;
    b.availabilityRate = availabilityRate;
  }
  return buckets;
}

// -----------------------------------------------------------------------------
// Baseline math (unchanged)
// -----------------------------------------------------------------------------

function weightedAverage(values: number[], weights: number[]): number {
  const wsum = weights.reduce((a, b) => a + b, 0);
  if (wsum === 0) return 0;
  return values.reduce((a, v, i) => a + v * weights[i], 0) / wsum;
}

// -----------------------------------------------------------------------------
// Enhanced trend detection — exponentially weighted linear regression
// Recent months get exponentially more weight, making the trend more responsive
// to the latest demand signals while still being robust to noise.
// -----------------------------------------------------------------------------

function enhancedTrendSlope(values: number[]): {
  slope: number;
  strength: number; // 0..1 (weighted R²)
  direction: "up" | "down" | "stable";
  // extended for calculation breakdown
  _weights?: number[];
  _meanX?: number;
  _meanY?: number;
  _numerator?: number;
  _denominator?: number;
  _ssRes?: number;
  _ssTot?: number;
  _threshold?: number;
} {
  const n = values.length;
  if (n < 2) return { slope: 0, strength: 0, direction: "stable" };

  // Exponentially decaying weights: most recent = highest weight
  const decay = 0.25;
  const weights = values.map((_, i) => Math.exp(decay * (i - n + 1)));
  const wsum = weights.reduce((a, b) => a + b, 0);

  const xs = Array.from({ length: n }, (_, i) => i);
  const meanX = xs.reduce((a, b, i) => a + b * weights[i], 0) / wsum;
  const meanY = values.reduce((a, b, i) => a + b * weights[i], 0) / wsum;

  let num = 0,
    den = 0;
  for (let i = 0; i < n; i++) {
    num += weights[i] * (xs[i] - meanX) * (values[i] - meanY);
    den += weights[i] * (xs[i] - meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;

  // Weighted R² as trend strength
  const ssRes = values.reduce((a, v, i) => {
    const predicted = meanY + slope * (xs[i] - meanX);
    return a + weights[i] * (v - predicted) ** 2;
  }, 0);
  const ssTot = values.reduce((a, v, i) => a + weights[i] * (v - meanY) ** 2, 0);
  const rSquared = ssTot === 0 ? 0 : Math.max(0, Math.min(1, 1 - ssRes / ssTot));

  const threshold = Math.abs(meanY) * 0.02 || 0.5; // at least 2% or 0.5 units
  const direction =
    slope > threshold ? "up" : slope < -threshold ? "down" : "stable";

  return {
    slope: Math.round(slope * 100) / 100,
    strength: Math.round(rSquared * 100) / 100,
    direction,
    _weights: weights.map((w) => Math.round(w * 1000) / 1000),
    _meanX: Math.round(meanX * 1000) / 1000,
    _meanY: Math.round(meanY * 1000) / 1000,
    _numerator: Math.round(num * 1000) / 1000,
    _denominator: Math.round(den * 1000) / 1000,
    _ssRes: Math.round(ssRes * 100) / 100,
    _ssTot: Math.round(ssTot * 100) / 100,
    _threshold: Math.round(threshold * 100) / 100,
  };
}

// -----------------------------------------------------------------------------
// Enhanced seasonality — neighbor-smoothed seasonal factors
// Uses triangular smoothing (70% target month + 15% each neighbor) to reduce
// noise while preserving genuine seasonal patterns.
// -----------------------------------------------------------------------------

function smoothSeasonalityFactor(
  history: MonthlyBucket[],
  targetMonthIdx: number
): number {
  const grouped: number[][] = Array.from({ length: 12 }, () => []);
  for (const h of history) {
    const mi = parseInt(h.month.split("-")[1], 10) - 1;
    grouped[mi].push(h.qty);
  }
  const overallAvg =
    history.reduce((a, b) => a + b.qty, 0) / Math.max(history.length, 1);
  if (overallAvg === 0) return 1;

  const getAvg = (idx: number) =>
    grouped[idx].reduce((a, b) => a + b, 0) /
    Math.max(grouped[idx].length, 1);

  const rawTarget = getAvg(targetMonthIdx) / overallAvg;
  const prevIdx = (targetMonthIdx + 11) % 12;
  const nextIdx = (targetMonthIdx + 1) % 12;
  const rawPrev = getAvg(prevIdx) / overallAvg;
  const rawNext = getAvg(nextIdx) / overallAvg;

  // Triangular smoothing: 70% target, 15% each neighbor
  const smoothed = rawTarget * 0.7 + (rawPrev + rawNext) * 0.15;

  // Clamp to prevent extreme seasonality
  return Math.max(0.5, Math.min(2.0, smoothed));
}

// -----------------------------------------------------------------------------
// Prediction interval calculation (80% confidence)
// -----------------------------------------------------------------------------

function predictionInterval(
  values: number[],
  slope: number,
  avg: number,
  forecastIndex: number,
  center: number
): { low: number; high: number } {
  const n = values.length;
  if (n < 3) return { low: Math.max(0, center - Math.round(center * 0.3)), high: Math.round(center * 1.3) };

  // Standard error of the estimate (residuals from linear fit)
  const residuals = values.map((v, i) => {
    const fitted = avg + slope * i;
    return v - fitted;
  });
  const mse =
    residuals.reduce((a, r) => a + r * r, 0) / Math.max(n - 2, 1);
  const se = Math.sqrt(mse);

  // 80% confidence: z ≈ 1.28
  const z = 1.28;
  const meanX = (n - 1) / 2;
  const ssx = values.reduce((a, _, i) => a + (i - meanX) ** 2, 0);
  const sePred =
    se *
    Math.sqrt(
      1 + 1 / n + (forecastIndex - meanX) ** 2 / Math.max(ssx, 1)
    );

  // Center the interval on the actual forecast point (which includes seasonality, dampening, factors)
  const halfWidth = Math.round(z * sePred);
  return {
    low: Math.max(0, center - halfWidth),
    high: center + halfWidth,
  };
}

// -----------------------------------------------------------------------------
// Factor application
// -----------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

const DEFAULT_FACTORS: Required<ForecastFactors> = {
  trekkingSeasonIndex: 1,
  weatherIndex: 1,
  promotionLift: 1,
  regionalDemandIndex: 1,
  eventLift: 1,
};

function resolveFactors(f?: ForecastFactors): Required<ForecastFactors> {
  return { ...DEFAULT_FACTORS, ...(f ?? {}) };
}

function applyFactors(
  baseline: number,
  factors: Required<ForecastFactors>
): number {
  const combined =
    baseline *
    factors.trekkingSeasonIndex *
    factors.weatherIndex *
    factors.promotionLift *
    factors.regionalDemandIndex *
    factors.eventLift;
  return clamp(combined, baseline * 0.7, baseline * 1.5);
}

// -----------------------------------------------------------------------------
// Result type
// -----------------------------------------------------------------------------

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthNameFromKey(monthKey: string): string {
  const [_, m] = monthKey.split("-").map(Number);
  return MONTH_NAMES[m - 1] ?? "Unknown";
}

export type MonthForecast = {
  month: string; // 'YYYY-MM'
  monthName: string; // 'August'
  qty: number; // finalForecast
  baseline: number; // pre-factor baseline
  seasonalityFactor: number;
  dailyRate: number; // forecast qty / days in month
  /** Stock needed at the start of this month to cover demand without stockout */
  stockRequired: number;
  /** Projected stock remaining at the end of the month after demand is fulfilled */
  projectedStockAfter: number;
  /** How many units to order to cover this month's demand (if stock is insufficient) */
  suggestedOrder: number;
  predictionIntervalLow?: number; // 80% confidence lower bound
  predictionIntervalHigh?: number; // 80% confidence upper bound
};

export type ForecastResult = {
  history: MonthlyBucket[];
  forecast: MonthForecast[];
  // per-SKU aggregate metrics
  rawOutboundDemand: number;
  availabilityRate: number; // averaged over months with data, else 1
  correctedDemand: number;
  weightedBaseline: number;
  trendAdjustment: number;
  trendStrength: number; // 0..1 how pronounced the trend is (weighted R²)
  trendDirection: "up" | "down" | "stable";
  seasonalityFactor: number; // next-month seasonality
  trekkingSeasonIndex: number;
  weatherIndex: number;
  promotionLift: number;
  regionalDemandIndex: number;
  eventLift: number;
  finalForecast: number; // next-month final forecast
  dailyForecast: number; // daily demand rate (next month forecast / actual days)
  inventoryPosition: number;
  daysOfCover: number;
  recommendedReorder: number;
  momentumTag: MomentumTag;
  velocityTag: VelocityTag;
  stockoutRisk: "low" | "medium" | "high";
  overstockRisk: "low" | "medium" | "high";
  // --- New timeline fields ---
  /** Estimated date stock will run out (based on dailyForecast) */
  estimatedStockoutDate: string | null;
  /** Last safe date to place a purchase order to avoid stockout */
  reorderByDate: string | null;
  /** Date the next refill order would arrive if ordered today */
  nextRefillDate: string;
  /** Urgency level for reordering */
  stockoutUrgency: "critical" | "warning" | "safe";
  // legacy aliases (kept for existing UI)
  avgMonthly: number;
  trend: number;
  /** Legacy alias — kept for backward compatibility during migration */
  velocity: MomentumTag;
  /** @deprecated Use momentumTag instead */
  _velocityLegacy: "fast" | "steady" | "slow" | "dead";
  /** Full calculation breakdown with every intermediate variable and number */
  calculationBreakdown: CalculationBreakdown;
};

// -----------------------------------------------------------------------------
// Calculation Breakdown — exposes every intermediate value with numbers
// -----------------------------------------------------------------------------

export type CalculationBreakdown = {
  inputData: {
    values: number[];
    monthLabels: string[];
  };
  weightedAverage: {
    description: string;
    formula: string;
    values: number[];
    weights: number[];
    weightedSum: number;
    weightSum: number;
    result: number;
  };
  trendAnalysis: {
    description: string;
    formula: string;
    decay: number;
    weights: number[];
    meanX: number;
    meanY: number;
    numerator: number;
    denominator: number;
    slope: number;
    ssRes: number;
    ssTot: number;
    rSquared: number;
    threshold: number;
    direction: "up" | "down" | "stable";
  };
  seasonality: {
    description: string;
    formula: string;
    overallAvg: number;
    perMonthBreakdown: Array<{
      monthIndex: number;
      monthName: string;
      values: number[];
      monthAvg: number;
      rawFactor: number;
      prevRawFactor: number;
      nextRawFactor: number;
      smoothedFactor: number;
      clampedFactor: number;
    }>;
  };
  monthlyDetail: Array<{
    monthName: string;
    monthKey: string;
    dampeningLambda: number;
    dampening: number;
    trendContribution: number;
    avgPlusTrend: number;
    seasonalityFactor: number;
    baseline: number;
    factorsMultiplied: number;
    clampLow: number;
    clampHigh: number;
    finalForecast: number;
    daysInMonth: number;
    dailyRate: number;
    runningStockBefore: number;
    stockRequired: number;
    safetyStockDays: number;
    monthlySafetyStock: number;
    stockShortfall: number;
    suggestedOrder: number;
    predictionIntervalLow: number;
    predictionIntervalHigh: number;
    projectedStockAfter: number;
  }>;
  reorder: {
    description: string;
    supplierLeadDays: number;
    leadTimeDemandBreakdown: Array<{
      monthName: string;
      dailyRate: number;
      daysUsed: number;
      contribution: number;
    }>;
    totalLeadTimeDemand: number;
    demandMean: number;
    demandVariance: number;
    demandStdDev: number;
    serviceLevelTarget: number | null;
    serviceLevelZ: number;
    safetyStockFormula: string;
    safetyStockUnits: number;
    inventoryPosition: number;
    recommendedBeforeCaps: number;
    maxCoverDays: number | null;
    maxStock: number | null;
    headroom: number | null;
    afterCap: number;
    minimumOrderQty: number | null;
    afterMOQ: number;
    orderMultiple: number | null;
    afterMultiple: number;
    finalRecommended: number;
  };
  daysOfCover: {
    dailyForecast: number;
    inventoryPosition: number;
    recent3MonthAvg: number;
    recentDaily: number;
    daysOfCover: number;
  };
  momentum: {
    recent3MonthAvg: number;
    overallAvg: number;
    threshold120pct: number;
    threshold60pct: number;
    result: MomentumTag;
  };
  risk: {
    coverVsLead: number;
    stockoutRisk: string;
    maxCoverDays: number;
    overstockRisk: string;
  };
  timeline: {
    dailyForecast: number;
    inventoryPosition: number;
    daysUntilStockout: number | null;
    estimatedStockoutDate: string | null;
    supplierLeadDays: number;
    reorderByDate: string | null;
    nextRefillDate: string;
    stockoutUrgency: string;
  };
};

export type ForecastOptions = {
  factors?: ForecastFactors;
  config?: SKUConfig;
};

// -----------------------------------------------------------------------------
// Seasonality breakdown (for display)
// -----------------------------------------------------------------------------

function computeSeasonalityBreakdown(
  history: MonthlyBucket[],
  targetMonthIdx: number
): {
  overallAvg: number;
  perMonthBreakdown: Array<{
    monthIndex: number;
    monthName: string;
    values: number[];
    monthAvg: number;
    rawFactor: number;
    prevRawFactor: number;
    nextRawFactor: number;
    smoothedFactor: number;
    clampedFactor: number;
  }>;
} {
  const grouped: number[][] = Array.from({ length: 12 }, () => []);
  for (const h of history) {
    const mi = parseInt(h.month.split("-")[1], 10) - 1;
    grouped[mi].push(h.qty);
  }
  const overallAvg =
    history.reduce((a, b) => a + b.qty, 0) / Math.max(history.length, 1);

  const getAvg = (idx: number) =>
    grouped[idx].reduce((a, b) => a + b, 0) /
    Math.max(grouped[idx].length, 1);

  const breakdown = Array.from({ length: 12 }, (_, mi) => {
    const prevIdx = (mi + 11) % 12;
    const nextIdx = (mi + 1) % 12;
    const monthAvg = getAvg(mi);
    const rawTarget = overallAvg > 0 ? monthAvg / overallAvg : 1;
    const rawPrev = overallAvg > 0 ? getAvg(prevIdx) / overallAvg : 1;
    const rawNext = overallAvg > 0 ? getAvg(nextIdx) / overallAvg : 1;
    const smoothed = rawTarget * 0.7 + (rawPrev + rawNext) * 0.15;
    const clamped = Math.max(0.5, Math.min(2.0, smoothed));
    return {
      monthIndex: mi,
      monthName: MONTH_NAMES[mi],
      values: [...grouped[mi]],
      monthAvg: Math.round(monthAvg * 100) / 100,
      rawFactor: Math.round(rawTarget * 1000) / 1000,
      prevRawFactor: Math.round(rawPrev * 1000) / 1000,
      nextRawFactor: Math.round(rawNext * 1000) / 1000,
      smoothedFactor: Math.round(smoothed * 1000) / 1000,
      clampedFactor: Math.round(clamped * 1000) / 1000,
    };
  });

  return {
    overallAvg: Math.round(overallAvg * 100) / 100,
    perMonthBreakdown: breakdown,
  };
}

// -----------------------------------------------------------------------------
// Main forecast
// -----------------------------------------------------------------------------

export function forecastSKU(
  history: MonthlyBucket[],
  currentStock: number,
  leadTimeDays: number,
  horizonMonths: number = 6,
  options: ForecastOptions = {}
): ForecastResult {
  const cfg = options.config ?? {};
  const factors = resolveFactors(options.factors);

  const values = history.map((h) => h.qty);
  const n = values.length;
  // Exponential weighting for a smooth, accurate baseline
  // Weight decays exponentially from most recent (weight=1.0) to oldest (weight≈0.04 for 12mo)
  const expDecay = 0.3;
  const weights = values.map((_, i) => Math.exp(expDecay * (i - n + 1)));
  const avg = weightedAverage(values, weights);

  // Enhanced trend detection
  const trendAnalysis = enhancedTrendSlope(values);
  const slope = trendAnalysis.slope;

  // Calculate dampening factor for longer horizons
  // Trend influence decreases as we forecast further out
  const dampeningLambda = 0.9;

  // Inventory position
  const inbound = cfg.confirmedInboundStock ?? 0;
  const committed = cfg.committedCustomerOrders ?? 0;
  const inventoryPosition = currentStock + inbound - committed;

  const forecast: MonthForecast[] = [];
  const now = new Date();
  let runningStock = inventoryPosition;

  for (let i = 1; i <= horizonMonths; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const seas = smoothSeasonalityFactor(history, d.getMonth());
    // Apply dampened trend: trend influence decreases further out
    const dampening = Math.pow(dampeningLambda, i - 1);
    const trendContribution = slope * i * dampening;
    const baseline = Math.max(0, avg + trendContribution) * seas;
    const final = applyFactors(baseline, factors);

    // Per-month daily rate
    const dm = daysInMonthFor(monthKey);
    const dailyRate = dm > 0 ? final / dm : final / 30;

    // Stock required: how much stock we need at the start of this month
    // to cover the forecast demand
    const stockRequired = Math.max(0, final);

    // Safety stock target for this month
    const monthlySafetyStock = dailyRate * (cfg.safetyStockDays ?? 30);

    // Projected stock at end of month (before any new orders)
    const projectedStockAfter = Math.max(0, runningStock - final);

    // Suggested order: if running stock won't cover demand,
    // order enough to cover the shortfall plus safety stock
    let suggestedOrder = 0;
    if (runningStock < final + monthlySafetyStock) {
      suggestedOrder = Math.ceil(final + monthlySafetyStock - runningStock);
    }

    // Confidence interval centered on the forecast value
    const pi = predictionInterval(values, slope, avg, n - 1 + i, final);

    forecast.push({
      month: monthKey,
      monthName: monthNameFromKey(monthKey),
      qty: Math.round(final),
      baseline: Math.round(baseline),
      seasonalityFactor: seas,
      dailyRate: Math.round(dailyRate * 10) / 10,
      stockRequired: Math.round(stockRequired),
      projectedStockAfter: Math.round(projectedStockAfter),
      suggestedOrder: Math.round(suggestedOrder),
      predictionIntervalLow: pi.low,
      predictionIntervalHigh: pi.high,
    });

    // Update running stock with the order arriving
    // (if we suggested an order for this month, assume it arrives after lead time)
    runningStock = projectedStockAfter;
  }

  // Aggregates
  const rawOutboundDemand = history.reduce((a, b) => a + (b.rawQty ?? b.qty), 0);
  const correctedDemand = history.reduce((a, b) => a + b.qty, 0);
  const availSamples = history.filter((h) => h.availabilityRate != null);
  const availabilityRate =
    availSamples.length > 0
      ? availSamples.reduce((a, b) => a + (b.availabilityRate as number), 0) /
        availSamples.length
      : 1;

  const nextMonthSeas = forecast[0]?.seasonalityFactor ?? 1;
  const nextMonthBaseline = forecast[0]?.baseline ?? 0;
  const nextMonthFinal = forecast[0]?.qty ?? 0;

  // ---- Improved calculations using per-month data ----

  // Daily forecast: next month's actual daily rate (used for stockout timeline)
  const dailyForecast = forecast[0]?.dailyRate ?? 0;

  // Recent daily rate for fallback cover calculation
  const recentAvg =
    values.slice(-3).reduce((a, b) => a + b, 0) / Math.max(Math.min(3, n), 1);
  const recentDaily = recentAvg / 30;

  // Days of cover: use multi-month weighted average for stability
  // A single month's rate can be skewed by seasonality (e.g. December peak → artificially low days of cover)
  // A 3-month forward-looking weighted average smooths this out while staying demand-responsive
  const coverRates = forecast
    .slice(0, Math.min(3, forecast.length))
    .map((mf) => mf.dailyRate)
    .filter((r) => r > 0);
  const coverDailyRate = coverRates.length > 0
    ? coverRates.reduce((sum, r, i) => sum + r * (coverRates.length - i), 0) /
      coverRates.reduce((sum, _, i) => sum + (coverRates.length - i), 0)
    : dailyForecast > 0 ? dailyForecast : recentDaily;

  const daysOfCover =
    coverDailyRate > 0
      ? Math.round(inventoryPosition / coverDailyRate)
      : recentDaily > 0
      ? Math.round(inventoryPosition / recentDaily)
      : Infinity;

  // ---- Improved reorder calculation using month-by-month demand ----
  const supplierLead = cfg.supplierLeadTimeDays ?? leadTimeDays;
  const safetyDays = cfg.safetyStockDays ?? 30;

  // Calculate lead time demand by summing daily rates across the
  // months that the lead time spans, for better accuracy
  let leadTimeDemand = 0;
  let remainingLeadDays = supplierLead;
  for (const mf of forecast) {
    if (remainingLeadDays <= 0) break;
    const dm = daysInMonthFor(mf.month);
    const daysToTake = Math.min(remainingLeadDays, dm);
    leadTimeDemand += mf.dailyRate * daysToTake;
    remainingLeadDays -= daysToTake;
  }

  // Safety stock based on de-seasonalized demand variability
  // Removing seasonality from variance prevents inflated safety stock for seasonal SKUs
  // e.g. a product with 2x December peak would have ~2x raw stddev → using de-seasonalized values fixes this
  const mean = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  
  // De-seasonalize values for more accurate variance estimation
  let deSeasonalizedValues: number[];
  if (n >= 12) {
    deSeasonalizedValues = values.map((v, i) => {
      const monthIdx = parseInt(history[i].month.split("-")[1], 10) - 1;
      const sf = smoothSeasonalityFactor(history, monthIdx);
      return sf > 0 ? v / sf : v;
    });
  } else {
    deSeasonalizedValues = [...values];
  }
  const desMean = deSeasonalizedValues.reduce((a, b) => a + b, 0) / Math.max(n, 1);
  const desVariance =
    n > 1
      ? deSeasonalizedValues.reduce((a, v) => a + (v - desMean) ** 2, 0) / (n - 1)
      : 0;
  const demandStdDev = Math.sqrt(desVariance);
  // Safety stock = z-score (95% service level ≈ 1.65) * std dev * sqrt(lead time / 30)
  const serviceLevelZ = cfg.serviceLevelTarget
    ? cfg.serviceLevelTarget >= 0.99 ? 2.33
      : cfg.serviceLevelTarget >= 0.95 ? 1.65
      : cfg.serviceLevelTarget >= 0.90 ? 1.28
      : 1.04
    : 1.65;
  const safetyStockUnits =
    demandStdDev > 0
      ? Math.round(serviceLevelZ * demandStdDev * Math.sqrt(supplierLead / 30))
      : Math.round(dailyForecast * safetyDays);

  let recommended = Math.max(0, leadTimeDemand + safetyStockUnits - inventoryPosition);

  // Cap by maxCoverDays unless protected
  if (cfg.maxCoverDays && !cfg.isProtectedCore && dailyForecast > 0) {
    const maxStock = dailyForecast * cfg.maxCoverDays;
    const headroom = Math.max(0, maxStock - inventoryPosition);
    recommended = Math.min(recommended, headroom);
  }

  // Minimum order qty
  if (recommended > 0 && cfg.minimumOrderQty) {
    recommended = Math.max(recommended, cfg.minimumOrderQty);
  }

  // Order multiple rounding (round up)
  const mult = cfg.orderMultiple ?? 1;
  if (mult > 1 && recommended > 0) {
    recommended = Math.ceil(recommended / mult) * mult;
  } else {
    recommended = Math.ceil(recommended);
  }

  const momentumTag: MomentumTag =
    recentAvg === 0
      ? "inactive"
      : recentAvg >= avg * 1.2
      ? "accelerating"
      : recentAvg >= avg * 0.6
      ? "stable"
      : "declining";

  // Risks
  const coverVsLead = daysOfCover === Infinity ? 999 : daysOfCover / Math.max(supplierLead, 1);
  const stockoutRisk: ForecastResult["stockoutRisk"] =
    coverVsLead < 1 ? "high" : coverVsLead < 1.5 ? "medium" : "low";
  const maxCover = cfg.maxCoverDays ?? 180;
  const overstockRisk: ForecastResult["overstockRisk"] =
    daysOfCover === Infinity && inventoryPosition > 0
      ? "high"
      : daysOfCover > maxCover
      ? "high"
      : daysOfCover > maxCover * 0.75
      ? "medium"
      : "low";

  // --- Timeline calculations ---
  const today = new Date();
  // Estimated stockout date
  let estimatedStockoutDate: string | null = null;
  if (dailyForecast > 0 && inventoryPosition > 0) {
    const daysUntilStockout = Math.ceil(inventoryPosition / dailyForecast);
    const d = new Date(today);
    d.setDate(d.getDate() + daysUntilStockout);
    estimatedStockoutDate = d.toISOString().slice(0, 10);
  } else if (inventoryPosition <= 0) {
    estimatedStockoutDate = today.toISOString().slice(0, 10); // already out
  }

  // Reorder-by date (order must be placed by this date to avoid stockout)
  let reorderByDate: string | null = null;
  if (estimatedStockoutDate) {
    const d = new Date(estimatedStockoutDate);
    d.setDate(d.getDate() - supplierLead);
    reorderByDate = d.toISOString().slice(0, 10);
  }

  // Next refill date (if ordered today)
  const nextRefill = new Date(today);
  nextRefill.setDate(nextRefill.getDate() + supplierLead);
  const nextRefillDate = nextRefill.toISOString().slice(0, 10);

  // Stockout urgency
  const stockoutUrgency: ForecastResult["stockoutUrgency"] =
    inventoryPosition <= 0 || (reorderByDate && new Date(reorderByDate) <= today)
      ? "critical"
      : reorderByDate && new Date(reorderByDate) <= new Date(today.getTime() + supplierLead * 86400000)
      ? "warning"
      : "safe";

  // ---- Build Calculation Breakdown ----
  const seasonalityBreakdown = computeSeasonalityBreakdown(history, 0);

  const calculationBreakdown: CalculationBreakdown = {
    inputData: {
      values: [...values],
      monthLabels: history.map((h) => {
        const mi = parseInt(h.month.split("-")[1], 10) - 1;
        return MONTH_NAMES[mi] ?? h.month;
      }),
    },
    weightedAverage: {
      description:
        "Exponentially weighted average with decay=0.3 — most recent month gets highest weight. Smooth continuous weighting avoids the artificial jumps of step-function weights.",
      formula:
        "weightedAvg = Σ(value_i × weight_i) ÷ Σ(weight_i)",
      values: [...values],
      weights: [...weights],
      weightedSum: Math.round(
        values.reduce((a, v, i) => a + v * weights[i], 0) * 100
      ) / 100,
      weightSum: weights.reduce((a, b) => a + b, 0),
      result: Math.round(avg * 100) / 100,
    },
    trendAnalysis: {
      description:
        "Exponentially weighted linear regression. Recent months get exponentially more weight (decay=" + trendAnalysis._weights?.[0]?.toFixed(3) + " → " + "1.000) to detect trends faster.",
      formula:
        "slope = Σ(w_i × (x_i - meanX) × (y_i - meanY)) ÷ Σ(w_i × (x_i - meanX)²)",
      decay: 0.25,
      weights: trendAnalysis._weights ?? [],
      meanX: trendAnalysis._meanX ?? 0,
      meanY: trendAnalysis._meanY ?? 0,
      numerator: trendAnalysis._numerator ?? 0,
      denominator: trendAnalysis._denominator ?? 0,
      slope: trendAnalysis.slope,
      ssRes: trendAnalysis._ssRes ?? 0,
      ssTot: trendAnalysis._ssTot ?? 0,
      rSquared: trendAnalysis.strength,
      threshold: trendAnalysis._threshold ?? 0.5,
      direction: trendAnalysis.direction,
    },
    seasonality: {
      description:
        "For each calendar month, the average historical demand is divided by the overall average to get a seasonal factor. Triangular smoothing (70% target + 15% each neighbor) reduces noise.",
      formula:
        "factor = clamp(targetAvg/overall × 0.7 + prevAvg/overall × 0.15 + nextAvg/overall × 0.15, 0.5, 2.0)",
      overallAvg: seasonalityBreakdown.overallAvg,
      perMonthBreakdown: seasonalityBreakdown.perMonthBreakdown,
    },
    monthlyDetail: forecast.map((mf, i) => {
      const dampening = Math.pow(dampeningLambda, i);
      const trendContribution = slope * (i + 1) * dampening;
      const avgPlusTrend = avg + trendContribution;
      const baselineBeforeSeas = Math.max(0, avgPlusTrend);
      const baseline = baselineBeforeSeas * mf.seasonalityFactor;
      const factorsMultiplied =
        factors.trekkingSeasonIndex *
        factors.weatherIndex *
        factors.promotionLift *
        factors.regionalDemandIndex *
        factors.eventLift;
      const dm = daysInMonthFor(mf.month);
      const runningStockBefore = i === 0 ? inventoryPosition : forecast[i - 1].projectedStockAfter;
      const safetyStockDaysUsed = cfg.safetyStockDays ?? 30;
      const monthlySafetyStock = mf.dailyRate * safetyStockDaysUsed;
      const stockShortfall = Math.max(
        0,
        mf.qty + monthlySafetyStock - runningStockBefore
      );
      return {
        monthName: mf.monthName,
        monthKey: mf.month,
        dampeningLambda,
        dampening: Math.round(dampening * 1000) / 1000,
        trendContribution: Math.round(trendContribution * 100) / 100,
        avgPlusTrend: Math.round(avgPlusTrend * 100) / 100,
        seasonalityFactor: mf.seasonalityFactor,
        baseline: mf.baseline,
        factorsMultiplied: Math.round(factorsMultiplied * 1000) / 1000,
        clampLow: Math.round(baseline * 0.7),
        clampHigh: Math.round(baseline * 1.5),
        finalForecast: mf.qty,
        daysInMonth: dm,
        dailyRate: mf.dailyRate,
        runningStockBefore: Math.round(runningStockBefore),
        stockRequired: mf.stockRequired,
        safetyStockDays: safetyStockDaysUsed,
        monthlySafetyStock: Math.round(monthlySafetyStock * 10) / 10,
        stockShortfall: Math.round(stockShortfall),
        suggestedOrder: mf.suggestedOrder,
        predictionIntervalLow: mf.predictionIntervalLow ?? 0,
        predictionIntervalHigh: mf.predictionIntervalHigh ?? 0,
        projectedStockAfter: mf.projectedStockAfter,
      };
    }),
    reorder: {
      description:
        "Lead time demand is calculated by summing daily demand rates across the months the lead time spans. Safety stock uses demand variability (standard deviation) × service level z-score × √(lead time / 30).",
      supplierLeadDays: supplierLead,
      leadTimeDemandBreakdown: (() => {
        const breakdown: CalculationBreakdown["reorder"]["leadTimeDemandBreakdown"] = [];
        let remaining = supplierLead;
        for (const mf of forecast) {
          if (remaining <= 0) break;
          const dm = daysInMonthFor(mf.month);
          const daysToTake = Math.min(remaining, dm);
          breakdown.push({
            monthName: mf.monthName,
            dailyRate: mf.dailyRate,
            daysUsed: daysToTake,
            contribution: Math.round(mf.dailyRate * daysToTake * 100) / 100,
          });
          remaining -= daysToTake;
        }
        return breakdown;
      })(),
      totalLeadTimeDemand: Math.round(leadTimeDemand * 100) / 100,
      demandMean: Math.round(mean * 100) / 100,
      demandVariance: Math.round(desVariance * 100) / 100,
      demandStdDev: Math.round(demandStdDev * 100) / 100,
      serviceLevelTarget: cfg.serviceLevelTarget ?? null,
      serviceLevelZ: Math.round(serviceLevelZ * 100) / 100,
      safetyStockFormula:
        demandStdDev > 0
          ? serviceLevelZ +
            " × " +
            Math.round(demandStdDev * 100) / 100 +
            " × √(" +
            supplierLead +
            "/30)"
          : dailyForecast + " × " + safetyDays + " (fallback)",
      safetyStockUnits,
      inventoryPosition,
      recommendedBeforeCaps: Math.max(
        0,
        leadTimeDemand + safetyStockUnits - inventoryPosition
      ),
      maxCoverDays: cfg.maxCoverDays ?? null,
      maxStock:
        cfg.maxCoverDays && dailyForecast > 0
          ? Math.round(dailyForecast * cfg.maxCoverDays)
          : null,
      headroom:
        cfg.maxCoverDays && !cfg.isProtectedCore && dailyForecast > 0
          ? Math.max(
              0,
              Math.round(dailyForecast * cfg.maxCoverDays) - inventoryPosition
            )
          : null,
      afterCap: (() => {
        let r = Math.max(0, leadTimeDemand + safetyStockUnits - inventoryPosition);
        if (cfg.maxCoverDays && !cfg.isProtectedCore && dailyForecast > 0) {
          const maxStock = dailyForecast * cfg.maxCoverDays;
          const headroom = Math.max(0, maxStock - inventoryPosition);
          r = Math.min(r, headroom);
        }
        return Math.round(r);
      })(),
      minimumOrderQty: cfg.minimumOrderQty ?? null,
      afterMOQ: (() => {
        let r = Math.max(0, leadTimeDemand + safetyStockUnits - inventoryPosition);
        if (cfg.maxCoverDays && !cfg.isProtectedCore && dailyForecast > 0) {
          const maxStock = dailyForecast * cfg.maxCoverDays;
          const headroom = Math.max(0, maxStock - inventoryPosition);
          r = Math.min(r, headroom);
        }
        if (r > 0 && cfg.minimumOrderQty) r = Math.max(r, cfg.minimumOrderQty);
        return Math.round(r);
      })(),
      orderMultiple: (cfg.orderMultiple && cfg.orderMultiple > 1) ? cfg.orderMultiple : null,
      afterMultiple: recommended,
      finalRecommended: recommended,
    },
    daysOfCover: {
      dailyForecast,
      inventoryPosition,
      recent3MonthAvg: Math.round(recentAvg * 100) / 100,
      recentDaily: Math.round(recentDaily * 100) / 100,
      daysOfCover,
    },
    momentum: {
      recent3MonthAvg: Math.round(recentAvg * 100) / 100,
      overallAvg: Math.round(avg * 100) / 100,
      threshold120pct: Math.round(avg * 1.2 * 100) / 100,
      threshold60pct: Math.round(avg * 0.6 * 100) / 100,
      result: momentumTag,
    },
    risk: {
      coverVsLead: Math.round(coverVsLead * 100) / 100,
      stockoutRisk,
      maxCoverDays: maxCover,
      overstockRisk,
    },
    timeline: {
      dailyForecast,
      inventoryPosition,
      daysUntilStockout:
        dailyForecast > 0 && inventoryPosition > 0
          ? Math.ceil(inventoryPosition / dailyForecast)
          : null,
      estimatedStockoutDate,
      supplierLeadDays: supplierLead,
      reorderByDate,
      nextRefillDate,
      stockoutUrgency,
    },
  };

  return {
    history,
    forecast,
    rawOutboundDemand: Math.round(rawOutboundDemand),
    availabilityRate: Math.round(availabilityRate * 100) / 100,
    correctedDemand: Math.round(correctedDemand),
    weightedBaseline: Math.round(avg),
    trendAdjustment: Math.round(slope * 10) / 10,
    trendStrength: trendAnalysis.strength,
    trendDirection: trendAnalysis.direction,
    seasonalityFactor: Math.round(nextMonthSeas * 100) / 100,
    trekkingSeasonIndex: factors.trekkingSeasonIndex,
    weatherIndex: factors.weatherIndex,
    promotionLift: factors.promotionLift,
    regionalDemandIndex: factors.regionalDemandIndex,
    eventLift: factors.eventLift,
    finalForecast: Math.round(nextMonthFinal),
    dailyForecast: Math.round(dailyForecast * 10) / 10,
    inventoryPosition,
    daysOfCover,
    recommendedReorder: recommended,
    momentumTag,
    velocityTag: "dead" as VelocityTag, // overridden at page level with category-based velocity
    stockoutRisk,
    overstockRisk,
    // --- New timeline fields ---
    estimatedStockoutDate,
    reorderByDate,
    nextRefillDate,
    stockoutUrgency,
    // legacy aliases
    avgMonthly: Math.round(avg),
    trend: Math.round(slope * 10) / 10,
    velocity: momentumTag, // legacy alias
    _velocityLegacy: momentumTag === "accelerating" ? "fast" : momentumTag === "stable" ? "steady" : momentumTag === "declining" ? "slow" : "dead" as "fast" | "steady" | "slow" | "dead",
    calculationBreakdown,
  };
}

// =============================================================================
// Utility: Category-based Velocity
// Compares each SKU's recent sales (last 3 months) against others in the same
// category to determine relative selling speed.
// =============================================================================

export type CategoryVelocityInput = {
  productId: string;
  category: string | null;
  /** Average monthly sales over the last 3 months */
  recent3MonthAvg: number;
};

/**
 * Computes a velocity tag for each SKU based on its sales rank within its category.
 *
 * Rules:
 * - No sales in last 3 months → "dead"
 * - Top 20% selling SKUs in category → "fast_mover"
 * - Next 30% → "medium_mover"
 * - All remaining active SKUs → "slow_mover"
 */
export function computeVelocityByCategory(
  skus: CategoryVelocityInput[]
): Map<string, VelocityTag> {
  const result = new Map<string, VelocityTag>();

  // Group by category; uncategorised SKUs all go into a single bucket
  const byCategory = new Map<string, CategoryVelocityInput[]>();
  for (const sku of skus) {
    const cat = sku.category ?? "__uncategorised__";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(sku);
  }

  for (const [, group] of byCategory) {
    // Sort by recent 3-month avg descending
    const sorted = [...group].sort((a, b) => b.recent3MonthAvg - a.recent3MonthAvg);
    const total = sorted.length;

    for (let i = 0; i < total; i++) {
      const sku = sorted[i];
      // Dead: no sales in last 3 months
      if (sku.recent3MonthAvg === 0) {
        result.set(sku.productId, "dead");
        continue;
      }
      const position = (i + 1) / total; // 0..1 (lower = higher rank)
      if (position <= 0.2) {
        result.set(sku.productId, "fast_mover");
      } else if (position <= 0.5) {
        result.set(sku.productId, "medium_mover");
      } else {
        result.set(sku.productId, "slow_mover");
      }
    }
  }

  return result;
}

// =============================================================================
// Pricing Strategy Indicator
// =============================================================================

/**
 * Determines the inventory position based on days of cover vs targets.
 */
export function determineInventoryPosition(
  daysOfCover: number,
  supplierLeadTimeDays: number,
  safetyStockDays: number,
  maxCoverDays: number
): InventoryPosition {
  if (daysOfCover < supplierLeadTimeDays + safetyStockDays) return "low";
  if (daysOfCover > maxCoverDays) return "high";
  return "normal";
}

/**
 * Computes a recommended pricing strategy for a single SKU based on:
 * - Velocity (category-based relative sales speed)
 * - Momentum (sales trend vs historical average)
 * - Days of cover
 * - Unit cost and minimum gross margin
 */
export function computePricingStrategy(params: {
  velocity: VelocityTag;
  momentum: MomentumTag;
  daysOfCover: number;
  unitCost: number;
  unitPrice: number;
  minimumGrossMarginPercentage?: number;
  supplierLeadTimeDays: number;
  safetyStockDays: number;
  maxCoverDays: number;
}): PricingStrategyResult {
  const {
    velocity,
    momentum,
    daysOfCover,
    unitCost,
    unitPrice,
    minimumGrossMarginPercentage: grossMarginPct = 0.40,
    supplierLeadTimeDays,
    safetyStockDays,
    maxCoverDays,
  } = params;

  // 1. Calculate minimum permitted price
  const minGrossMargin = Math.max(0.01, Math.min(0.99, grossMarginPct));
  const minimumPrice = unitCost > 0 ? unitCost / (1 - minGrossMargin) : 0;

  // 2. Determine inventory position
  const inventoryPosition = determineInventoryPosition(
    daysOfCover,
    supplierLeadTimeDays,
    safetyStockDays,
    maxCoverDays
  );

  // 3. Apply pricing strategy rules
  const isClearance =
    (velocity === "dead" || momentum === "inactive") && inventoryPosition === "high";
  const isMarkdown =
    velocity === "slow_mover" && momentum === "declining" && inventoryPosition === "high";
  const isTargetedPromotion =
    velocity === "slow_mover" && momentum === "stable";
  const isHoldPrice =
    velocity === "medium_mover" && momentum === "stable";
  const isProtectMargin =
    velocity === "fast_mover" && momentum === "accelerating" && inventoryPosition === "low";
  const isHoldAvailability =
    velocity === "fast_mover" && momentum === "stable";
  const isMonitor =
    velocity === "fast_mover" && momentum === "declining";

  // Build reason parts and rule description
  const parts: string[] = [];

  let strategy: string;
  let suggestedAction: string;
  let triggeredRule: string;

  if (isClearance) {
    strategy = "Clearance";
    triggeredRule = `Velocity=${velocity === "dead" ? "Dead" : velocity}, Momentum=${momentum === "inactive" ? "Inactive" : momentum}, Stock=High`;
    suggestedAction = `Reduce price by 20% to 40% (min ${formatMoney(minimumPrice)})`;
    parts.push(getVelocityLabel(velocity));
    parts.push(getMomentumLabel(momentum));
    parts.push("stock is high");
  } else if (isMarkdown) {
    strategy = "Markdown / Promotion";
    triggeredRule = `Slow mover, Declining momentum, High stock`;
    suggestedAction = `Reduce price by 10% to 20% (min ${formatMoney(minimumPrice)})`;
    parts.push("slow-moving, declining demand");
    parts.push("stock cover is above the maximum target");
  } else if (isTargetedPromotion) {
    strategy = "Targeted promotion";
    triggeredRule = `Slow mover, Stable momentum`;
    suggestedAction = `Reduce price by 5% to 10%, or bundle with a related product (min ${formatMoney(minimumPrice)})`;
    parts.push("slow-moving with stable demand");
  } else if (isHoldPrice) {
    strategy = "Hold price";
    triggeredRule = `Medium mover, Stable momentum`;
    suggestedAction = "No price change recommended";
    parts.push("medium-moving with stable demand");
  } else if (isProtectMargin) {
    strategy = "Protect margin";
    triggeredRule = `Fast mover, Accelerating momentum, Low stock (${daysOfCover}d cover)`;
    const canIncrease = minimumPrice < unitPrice;
    if (canIncrease) {
      const maxIncrease = Math.min(unitPrice * 0.05, unitPrice - minimumPrice);
      const increasePct = maxIncrease > 0 ? Math.round((maxIncrease / unitPrice) * 100) : 3;
      suggestedAction = `Avoid discounts. Review a ${increasePct}% to 5% price increase.`;
    } else {
      suggestedAction = "Avoid discounts. Do not reduce price below current levels.";
    }
    parts.push("fast-moving, accelerating demand");
    parts.push(`only ${daysOfCover} days of stock cover`);
  } else if (isHoldAvailability) {
    strategy = "Hold price / protect availability";
    triggeredRule = `Fast mover, Stable momentum`;
    suggestedAction = "No discount; prioritise replenishment";
    parts.push("fast-moving with stable demand");
  } else if (isMonitor) {
    strategy = "Monitor";
    triggeredRule = `Fast mover, Declining momentum`;
    suggestedAction = "Hold price initially; do not increase price";
    parts.push("fast-moving but demand is weakening");
  } else {
    // Default fallback
    strategy = "Hold price";
    triggeredRule = `Default — ${getVelocityLabel(velocity)}, ${getMomentumLabel(momentum)}`;
    suggestedAction = "No price change recommended";
    parts.push(getVelocityLabel(velocity));
    parts.push(getMomentumLabel(momentum));
  }

  const reason = `${parts[0] ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1) : ""}${parts.length > 1 ? ", " + parts.slice(1).join(", ") : ""}.`;

  return {
    strategy,
    suggestedAction,
    reason,
    minimumPrice: Math.round(minimumPrice * 100) / 100,
    inventoryPosition,
    triggeredRule,
    conditions: {
      velocity,
      momentum,
      daysOfCover,
      unitCost,
      unitPrice,
      minGrossMarginPct: minGrossMargin,
      supplierLeadTimeDays,
      safetyStockDays,
      maxCoverDays,
    },
  };
}

function getVelocityLabel(v: VelocityTag): string {
  switch (v) {
    case "fast_mover": return "fast-moving";
    case "medium_mover": return "medium-moving";
    case "slow_mover": return "slow-moving";
    case "dead": return "not selling";
  }
}

function getMomentumLabel(m: MomentumTag): string {
  switch (m) {
    case "accelerating": return "accelerating demand";
    case "stable": return "stable demand";
    case "declining": return "declining demand";
    case "inactive": return "no recent activity";
  }
}

function formatMoney(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}
