// Reproduces the main worked example in DEMAND-FORECAST-FORMULAS.md (project root).
// Run with: node scripts/forecast-doc-examples.ts   (from the frontend/ folder)
import {
  correctForAvailability,
  bucketMovementsByMonth,
  forecastSKU,
  computeVelocityByCategory,
  computePricingStrategy,
  type MovementInput,
  type AvailabilityInput,
  type MonthlyBucket,
} from "../src/lib/forecast-engine.ts";

const log = (s: string) => console.log(s);

// ---------------------------------------------------------------------------
// 1. Availability correction examples (pure function)
// ---------------------------------------------------------------------------
log("=== 1. AVAILABILITY CORRECTION ===");
const avExamples: Array<[number, string, AvailabilityInput]> = [
  [42, "2026-06", { month: "2026-06", inStockDays: 21, daysInMonth: 30 }],
  [10, "2026-06", { month: "2026-06", inStockDays: 3, daysInMonth: 30 }],
  [100, "2026-04", { month: "2026-04", inStockDays: 27, daysInMonth: 30 }],
];
for (const [qty, month, av] of avExamples) {
  const r = correctForAvailability(qty, month, av);
  log(JSON.stringify({ qty, month, av, result: r }));
}

// ---------------------------------------------------------------------------
// 2. Fictional SKU: TB-1001 Trekking Backpack (category "Backpacks")
// Monthly outbound sales Aug 2025 .. Jul 2026 (seasonal + mild growth)
// ---------------------------------------------------------------------------
const now = new Date(); // 2026-07-31 when this document was generated
const monthKeys: string[] = [];
for (let i = 11; i >= 0; i--) {
  const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
  monthKeys.push(
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
  );
}
//                 Aug  Sep  Oct  Nov  Dec  Jan  Feb  Mar  Apr  May  Jun  Jul
const sales = [   24,  20,  14,  10,  12,   8,   9,  12,  16,  22,  28,  30 ];
const insPerMonth = [15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15]; // 180 total in
// extra ins so stock on hand = 30: sum(ins)=180+55=235, sum(out)=205, stock=30
const extraIns = 55;

const movements: MovementInput[] = [];
monthKeys.forEach((mk, i) => {
  for (let k = 0; k < sales[i]; k++) {
    const day = String((k % 28) + 1).padStart(2, "0");
    movements.push({ movement_date: `${mk}-${day}`, quantity: 1, direction: "out" });
  }
  for (let k = 0; k < insPerMonth[i]; k++) {
    const day = String((k % 15) + 5).padStart(2, "0");
    movements.push({ movement_date: `${mk}-${day}`, quantity: 1, direction: "in" });
  }
});
for (let k = 0; k < extraIns; k++) {
  const day = String((k % 20) + 1).padStart(2, "0");
  movements.push({ movement_date: `2026-06-${day}`, quantity: 1, direction: "in" });
}

// Availability: Jan 2026 was a stockout month (only 15 of 31 days stocked)
const availability: AvailabilityInput[] = [
  { month: "2026-01", inStockDays: 15, daysInMonth: 31 },
];

const history: MonthlyBucket[] = bucketMovementsByMonth(movements, 12, availability);

log("=== 2. BUCKETED HISTORY (12 months) ===");
log(JSON.stringify(history));

// Stock on hand exactly as the page computes it
let stock = 0;
for (const m of movements) stock += (m.direction === "in" ? 1 : -1) * Number(m.quantity);
log(`stock on hand = ${stock}`);

// ---------------------------------------------------------------------------
// 3. Main forecast run — exactly like the page: forecastSKU(history, stock, lead, 6)
// ---------------------------------------------------------------------------
log("=== 3. MAIN FORECAST (as the page computes it) ===");
const leadTimeDays = 14;
const f = forecastSKU(history, stock, leadTimeDays, 6);
log(JSON.stringify({
  rawOutboundDemand: f.rawOutboundDemand,
  availabilityRate: f.availabilityRate,
  correctedDemand: f.correctedDemand,
  weightedBaseline: f.weightedBaseline,
  trend: f.trend,
  trendStrength: f.trendStrength,
  trendDirection: f.trendDirection,
  seasonalityFactor: f.seasonalityFactor,
  finalForecast: f.finalForecast,
  dailyForecast: f.dailyForecast,
  inventoryPosition: f.inventoryPosition,
  daysOfCover: f.daysOfCover,
  recommendedReorder: f.recommendedReorder,
  momentumTag: f.momentumTag,
  velocityTag: f.velocityTag,
  stockoutRisk: f.stockoutRisk,
  overstockRisk: f.overstockRisk,
  estimatedStockoutDate: f.estimatedStockoutDate,
  reorderByDate: f.reorderByDate,
  nextRefillDate: f.nextRefillDate,
  stockoutUrgency: f.stockoutUrgency,
  avgMonthly: f.avgMonthly,
  forecastMonths: f.forecast.map((m) => ({
    month: m.month, monthName: m.monthName, qty: m.qty, baseline: m.baseline,
    seasonalityFactor: m.seasonalityFactor, dailyRate: m.dailyRate,
    stockRequired: m.stockRequired, projectedStockAfter: m.projectedStockAfter,
    suggestedOrder: m.suggestedOrder,
    predictionIntervalLow: m.predictionIntervalLow, predictionIntervalHigh: m.predictionIntervalHigh,
  })),
}));
log("--- calculationBreakdown (pretty) ---");
log(JSON.stringify(f.calculationBreakdown, null, 2));

// ---------------------------------------------------------------------------
// 4. Velocity by category — several SKUs in "Backpacks"
// ---------------------------------------------------------------------------
log("=== 4. VELOCITY BY CATEGORY ===");
const skus = [
  { productId: "TB-1002", category: "Backpacks", recent3MonthAvg: 40 },
  { productId: "TB-1001", category: "Backpacks", recent3MonthAvg: 26.67 },
  { productId: "TB-1005", category: "Backpacks", recent3MonthAvg: 22 },
  { productId: "TB-1003", category: "Backpacks", recent3MonthAvg: 15 },
  { productId: "TB-1004", category: "Backpacks", recent3MonthAvg: 0 },
  { productId: "HP-2001", category: null, recent3MonthAvg: 33 },
  { productId: "HP-2002", category: null, recent3MonthAvg: 5 },
];
log(JSON.stringify(Object.fromEntries(computeVelocityByCategory(skus))));

// ---------------------------------------------------------------------------
// 5. Pricing strategy — main SKU + a clearance example
// ---------------------------------------------------------------------------
log("=== 5. PRICING STRATEGY ===");
const mainPricing = computePricingStrategy({
  velocity: "medium_mover",
  momentum: f.momentumTag,
  daysOfCover: f.daysOfCover,
  unitCost: 25,
  unitPrice: 59.99,
  minimumGrossMarginPercentage: 0.4,
  supplierLeadTimeDays: 14,
  safetyStockDays: 30,
  maxCoverDays: 180,
});
log("main SKU: " + JSON.stringify(mainPricing));

const clearancePricing = computePricingStrategy({
  velocity: "dead",
  momentum: "inactive",
  daysOfCover: 250,
  unitCost: 10,
  unitPrice: 24.99,
  minimumGrossMarginPercentage: 0.4,
  supplierLeadTimeDays: 21,
  safetyStockDays: 30,
  maxCoverDays: 180,
});
log("clearance example: " + JSON.stringify(clearancePricing));

// ---------------------------------------------------------------------------
// 6. Forecast with factors + config (demonstrates factor math, MOQ, multiples, caps)
// ---------------------------------------------------------------------------
log("=== 6. FORECAST WITH FACTORS + CONFIG ===");
const f2 = forecastSKU(history, stock, leadTimeDays, 6, {
  factors: { trekkingSeasonIndex: 1.1, weatherIndex: 1.05, promotionLift: 1.0, regionalDemandIndex: 1.0, eventLift: 1.0 },
  config: {
    supplierLeadTimeDays: 14,
    safetyStockDays: 30,
    serviceLevelTarget: 0.95,
    minimumOrderQty: 50,
    orderMultiple: 25,
    maxCoverDays: 180,
  },
});
log(JSON.stringify({
  finalForecast: f2.finalForecast,
  dailyForecast: f2.dailyForecast,
  recommendedReorder: f2.recommendedReorder,
  momentumTag: f2.momentumTag,
  calc: {
    weightedAverage: f2.calculationBreakdown.weightedAverage,
    trendAnalysis: f2.calculationBreakdown.trendAnalysis,
    reorder: f2.calculationBreakdown.reorder,
    daysOfCover: f2.calculationBreakdown.daysOfCover,
    risk: f2.calculationBreakdown.risk,
    timeline: f2.calculationBreakdown.timeline,
  },
}, null, 2));
