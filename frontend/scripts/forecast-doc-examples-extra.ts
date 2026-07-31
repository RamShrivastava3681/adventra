// Reproduces the supplementary examples in DEMAND-FORECAST-FORMULAS.md (project root).
// Run with: node scripts/forecast-doc-examples-extra.ts   (from the frontend/ folder)
import {
  correctForAvailability,
  bucketMovementsByMonth,
  forecastSKU,
  type MovementInput,
  type AvailabilityInput,
  type MonthlyBucket,
} from "../src/lib/forecast-engine.ts";

const log = (s: string) => console.log(s);
const now = new Date();
const monthKeys: string[] = [];
for (let i = 11; i >= 0; i--) {
  const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
  monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
}
const sales = [24, 20, 14, 10, 12, 8, 9, 12, 16, 22, 28, 30];
const insPerMonth = [15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15];
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
for (let k = 0; k < 55; k++) {
  const day = String((k % 20) + 1).padStart(2, "0");
  movements.push({ movement_date: `2026-06-${day}`, quantity: 1, direction: "in" });
}
const availability: AvailabilityInput[] = [{ month: "2026-01", inStockDays: 15, daysInMonth: 31 }];
const history: MonthlyBucket[] = bucketMovementsByMonth(movements, 12, availability);

// ---- Reorder formula with LOW stock (5 units) + MOQ + order multiple ----
log("=== REORDER, LOW STOCK (stock=5, config: lead 14, MOQ 50, multiple 25) ===");
const low = forecastSKU(history, 5, 14, 6, {
  config: { supplierLeadTimeDays: 14, safetyStockDays: 30, minimumOrderQty: 50, orderMultiple: 25 },
});
log(JSON.stringify({
  recommendedReorder: low.recommendedReorder,
  leadTimeDemand: low.calculationBreakdown.reorder.totalLeadTimeDemand,
  safetyStockUnits: low.calculationBreakdown.reorder.safetyStockUnits,
  inventoryPosition: low.calculationBreakdown.reorder.inventoryPosition,
  recommendedBeforeCaps: low.calculationBreakdown.reorder.recommendedBeforeCaps,
  afterMOQ: low.calculationBreakdown.reorder.afterMOQ,
  afterMultiple: low.calculationBreakdown.reorder.afterMultiple,
}, null, 2));

// ---- Reorder with NO config (stock=5) — shows plain ceil rounding ----
log("=== REORDER, LOW STOCK, NO CONFIG (stock=5) ===");
const low2 = forecastSKU(history, 5, 14, 6);
log(JSON.stringify({
  recommendedReorder: low2.recommendedReorder,
  leadTimeDemand: low2.calculationBreakdown.reorder.totalLeadTimeDemand,
  safetyStockUnits: low2.calculationBreakdown.reorder.safetyStockUnits,
  recommendedBeforeCaps: low2.calculationBreakdown.reorder.recommendedBeforeCaps,
}, null, 2));

// ---- maxCoverDays cap example (stock=400, high stock) ----
log("=== MAXCOVER CAP, HIGH STOCK (stock=400, maxCoverDays=180) ===");
const cap = forecastSKU(history, 400, 14, 6, {
  config: { supplierLeadTimeDays: 14, maxCoverDays: 180 },
});
log(JSON.stringify({
  recommendedReorder: cap.recommendedReorder,
  dailyForecast: cap.dailyForecast,
  maxStock: cap.calculationBreakdown.reorder.maxStock,
  headroom: cap.calculationBreakdown.reorder.headroom,
  inventoryPosition: cap.calculationBreakdown.reorder.inventoryPosition,
  daysOfCover: cap.daysOfCover,
  overstockRisk: cap.overstockRisk,
}, null, 2));

// ---- Protected core SKU bypasses the cap ----
log("=== PROTECTED CORE, HIGH STOCK (stock=400, maxCoverDays=180, isProtectedCore) ===");
const prot = forecastSKU(history, 400, 14, 6, {
  config: { supplierLeadTimeDays: 14, maxCoverDays: 180, isProtectedCore: true },
});
log(JSON.stringify({
  recommendedReorder: prot.recommendedReorder,
  maxStock: prot.calculationBreakdown.reorder.maxStock,
  headroom: prot.calculationBreakdown.reorder.headroom,
}, null, 2));

// ---- Prediction interval internals ----
log("=== PREDICTION INTERVAL INTERNALS ===");
// Recompute exactly like the engine does (forecastIndex = n-1+1 = 12, center = unrounded forecast)
const values = history.map((h) => h.qty);
const n = values.length;
const expDecay = 0.3;
const weights = values.map((_, i) => Math.exp(expDecay * (i - n + 1)));
const wsum = weights.reduce((a, b) => a + b, 0);
const avg = values.reduce((a, v, i) => a + v * weights[i], 0) / wsum;

// slope recompute (decay 0.25)
const decay = 0.25;
const tWeights = values.map((_, i) => Math.exp(decay * (i - n + 1)));
const twsum = tWeights.reduce((a, b) => a + b, 0);
const xs = Array.from({ length: n }, (_, i) => i);
const meanX = xs.reduce((a, b, i) => a + b * tWeights[i], 0) / twsum;
const meanY = values.reduce((a, b, i) => a + b * tWeights[i], 0) / twsum;
let num = 0, den = 0;
for (let i = 0; i < n; i++) {
  num += tWeights[i] * (xs[i] - meanX) * (values[i] - meanY);
  den += tWeights[i] * (xs[i] - meanX) ** 2;
}
const slope = num / den;

const forecastIndex = n - 1 + 1; // 12
const residuals = values.map((v, i) => v - (avg + slope * i));
const mse = residuals.reduce((a, r) => a + r * r, 0) / Math.max(n - 2, 1);
const se = Math.sqrt(mse);
const z = 1.28;
const pMeanX = (n - 1) / 2;
const ssx = values.reduce((a, _, i) => a + (i - pMeanX) ** 2, 0);
const sePred = se * Math.sqrt(1 + 1 / n + (forecastIndex - pMeanX) ** 2 / Math.max(ssx, 1));
const halfWidth = Math.round(z * sePred);
// center = unrounded August forecast = max(0, avg + slope*1*1) * seas
const seasAug = 1.4005763688760808;
const center = Math.max(0, avg + slope * 1) * seasAug;
log(JSON.stringify({
  n, avg, slope,
  residuals: residuals.map((r) => Math.round(r * 100) / 100),
  mse: Math.round(mse * 100) / 100,
  se: Math.round(se * 100) / 100,
  z, pMeanX, ssx, forecastIndex,
  sePred: Math.round(sePred * 100) / 100,
  zTimesSePred: Math.round(z * sePred * 100) / 100,
  halfWidth,
  center: Math.round(center * 100) / 100,
  low: Math.max(0, center - halfWidth),
  high: center + halfWidth,
}, null, 2));

// ---- momentum + velocity + pricing for the MAIN example ----
log("=== MAIN EXAMPLE SUMMARY (stock=30, lead 14, no config) ===");
const main = forecastSKU(history, 30, 14, 6);
log(JSON.stringify({
  weightedBaseline: main.calculationBreakdown.weightedAverage.result,
  trendSlope: main.calculationBreakdown.trendAnalysis.slope,
  trendStrength: main.calculationBreakdown.trendAnalysis.rSquared,
  trendDirection: main.calculationBreakdown.trendAnalysis.direction,
  overallAvg: main.calculationBreakdown.seasonality.overallAvg,
  momentum: main.calculationBreakdown.momentum,
  daysOfCover: main.calculationBreakdown.daysOfCover,
  risk: main.calculationBreakdown.risk,
  timeline: main.calculationBreakdown.timeline,
  finalForecast: main.finalForecast,
}, null, 2));

// ---- availability edge: month with no data, and a flat history for reference ----
log("=== AVAILABILITY EDGE CASES ===");
log(JSON.stringify({
  noData: correctForAvailability(42, "2026-01"),
  fullAvailability: correctForAvailability(42, "2026-06", { month: "2026-06", inStockDays: 30, daysInMonth: 30 }),
  boundaryCap: correctForAvailability(100, "2026-06", { month: "2026-06", inStockDays: 15, daysInMonth: 30 }),
}, null, 2));
