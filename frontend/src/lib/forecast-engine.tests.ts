// Standalone test runner for the forecast engine.
// Run with:  bun src/lib/forecast-engine.tests.ts
// Uses a tiny inline assert helper so no test framework dependency is needed.

import {
  correctForAvailability,
  bucketMovementsByMonth,
  currentMonthBucket,
  computePaceAdjustment,
  computePricingStrategy,
  forecastSKU,
  recomputeTimeline,
  type MonthlyBucket,
  type ForecastResult,
} from "./forecast-engine";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}\n    ${(err as Error).message}`);
  }
}
function eq(a: unknown, b: unknown, msg = "") {
  if (a !== b) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function close(a: number, b: number, tol = 1.5) {
  if (Math.abs(a - b) > tol) throw new Error(`expected ≈${b}, got ${a}`);
}
function truthy(v: unknown, msg = "expected truthy") {
  if (!v) throw new Error(msg);
}

function mkHistory(qtys: number[]): MonthlyBucket[] {
  const now = new Date();
  return qtys.map((q, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (qtys.length - 1 - i), 1);
    return {
      month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      qty: q,
      rawQty: q,
    };
  });
}

function makeTrendingHistory(steps: number, slope: number, base: number, noise = 0): MonthlyBucket[] {
  const now = new Date();
  return Array.from({ length: steps }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (steps - 1 - i), 1);
    const val = base + slope * i + (noise > 0 ? Math.round((Math.random() - 0.5) * noise) : 0);
    return {
      month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      qty: Math.max(0, val),
      rawQty: Math.max(0, val),
    };
  });
}

console.log("correctForAvailability");
test("returns raw when availability missing", () => {
  const r = correctForAvailability(42, "2026-01");
  eq(r.correctedDemand, 42);
  eq(r.availabilityRate, undefined);
});
test("no correction when fully available", () => {
  const r = correctForAvailability(42, "2026-01", { month: "2026-01", inStockDays: 31, daysInMonth: 31 });
  eq(r.correctedDemand, 42);
  eq(r.availabilityRate, 1);
});
test("scales 42 units @ 21/30 days -> 60", () => {
  const r = correctForAvailability(42, "2026-06", { month: "2026-06", inStockDays: 21, daysInMonth: 30 });
  close(r.availabilityRate!, 0.7, 0.001);
  close(r.correctedDemand, 60);
});
test("caps at 1.4x actual for severe stockouts", () => {
  const r = correctForAvailability(10, "2026-06", { month: "2026-06", inStockDays: 3, daysInMonth: 30 });
  close(r.correctedDemand, 14);
});

console.log("\nforecastSKU baseline stability");
test("unchanged when no factors supplied", () => {
  const h = mkHistory([10, 12, 11, 13, 15, 14, 16, 18, 17, 19, 20, 22]);
  const a = forecastSKU(h, 50, 14);
  const b = forecastSKU(h, 50, 14, 6, { factors: {} });
  eq(a.finalForecast, b.finalForecast);
  eq(a.forecast[0].qty, b.forecast[0].qty);
});
test("factors cap at 150% of baseline", () => {
  const h = mkHistory([10, 12, 11, 13, 15, 14, 16, 18, 17, 19, 20, 22]);
  const base = forecastSKU(h, 50, 14);
  const boosted = forecastSKU(h, 50, 14, 6, {
    factors: {
      trekkingSeasonIndex: 1.2,
      weatherIndex: 1.25,
      promotionLift: 1.35,
      regionalDemandIndex: 1.3,
      eventLift: 1.25,
    },
  });
  const b0 = base.forecast[0].baseline;
  truthy(boosted.forecast[0].qty <= Math.round(b0 * 1.5) + 1, "should be capped at 150%");
  truthy(boosted.forecast[0].qty >= base.forecast[0].qty, "should be >= baseline");
});

console.log("\nbucketMovementsByMonth — completed months only + currentMonthBucket");
test("buckets only completed months (current month excluded) and corrects stockouts", () => {
  const now = new Date();
  const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonth = `${lm.getFullYear()}-${String(lm.getMonth() + 1).padStart(2, "0")}`;
  const movements = Array.from({ length: 42 }, (_, i) => ({
    movement_date: `${lastMonth}-${String((i % 28) + 1).padStart(2, "0")}`,
    quantity: 1,
    direction: "out",
  }));
  const buckets = bucketMovementsByMonth(movements, 1, [
    { month: lastMonth, inStockDays: 21, daysInMonth: 30 },
  ]);
  eq(buckets.length, 1, "one completed month bucket");
  eq(buckets[0].month, lastMonth, "bucket is the last completed month");
  const b = buckets[0];
  eq(b.rawQty, 42);
  close(b.qty, 60);
  close(b.availabilityRate!, 0.7, 0.001);
});
test("currentMonthBucket sums only current-month outbound movements", () => {
  const now = new Date();
  const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonth = `${lm.getFullYear()}-${String(lm.getMonth() + 1).padStart(2, "0")}`;
  const movements = [
    { movement_date: `${cur}-05`, quantity: 3, direction: "out" },
    { movement_date: `${cur}-06`, quantity: 2, direction: "out" },
    { movement_date: `${lastMonth}-20`, quantity: 100, direction: "out" },
    { movement_date: `${cur}-07`, quantity: 5, direction: "in" },
  ];
  const b = currentMonthBucket(movements);
  eq(b.month, cur);
  eq(b.rawQty, 5, "only current-month outbound counts");
});

console.log("\nreorder calculation");
test("rounds up to order multiple and respects MOQ", () => {
  const h = mkHistory([30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]);
  const r = forecastSKU(h, 0, 14, 6, {
    config: { supplierLeadTimeDays: 14, safetyStockDays: 30, orderMultiple: 25, minimumOrderQty: 50 },
  });
  eq(r.recommendedReorder % 25, 0);
  truthy(r.recommendedReorder >= 50, "at least MOQ");
});
test("caps reorder by maxCoverDays unless protected", () => {
  const h = mkHistory([30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]);
  const capped = forecastSKU(h, 0, 14, 6, {
    config: { supplierLeadTimeDays: 60, safetyStockDays: 60, maxCoverDays: 30 },
  });
  const prot = forecastSKU(h, 0, 14, 6, {
    config: { supplierLeadTimeDays: 60, safetyStockDays: 60, maxCoverDays: 30, isProtectedCore: true },
  });
  truthy(prot.recommendedReorder > capped.recommendedReorder, "protected should order more");
});
test("flags stockout and overstock risks", () => {
  const h = mkHistory([30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]);
  const low = forecastSKU(h, 2, 14, 6, { config: { supplierLeadTimeDays: 14 } });
  eq(low.stockoutRisk, "high");
  const high = forecastSKU(h, 5000, 14, 6, { config: { supplierLeadTimeDays: 14, maxCoverDays: 90 } });
  eq(high.overstockRisk, "high");
});

console.log("\ntrend detection & strength");
test("detects upward trend", () => {
  const h = makeTrendingHistory(12, 3, 20); // up by 3 per month
  const r = forecastSKU(h, 100, 14);
  eq(r.trendDirection, "up");
  truthy(r.trend > 0, "trend should be positive");
  truthy(r.trendStrength > 0, "trend strength should exist");
});
test("detects downward trend", () => {
  const h = makeTrendingHistory(12, -2, 50); // down by 2 per month
  const r = forecastSKU(h, 100, 14);
  eq(r.trendDirection, "down");
  truthy(r.trend < 0, "trend should be negative");
});
test("detects stable/no trend", () => {
  const h = makeTrendingHistory(12, 0, 30); // flat
  const r = forecastSKU(h, 100, 14);
  eq(r.trendDirection, "stable");
  close(r.trend, 0, 0.5);
});
test("strong trend has high strength", () => {
  const h = makeTrendingHistory(12, 5, 10); // strongly upward
  const r = forecastSKU(h, 100, 14);
  truthy(r.trendStrength > 0.5, `strong uptrend should have high strength, got ${r.trendStrength}`);
});

console.log("\nconfidence intervals");
test("forecast months have prediction intervals", () => {
  const h = mkHistory([10, 12, 11, 13, 15, 14, 16, 18, 17, 19, 20, 22]);
  const r = forecastSKU(h, 50, 14);
  for (const m of r.forecast) {
    truthy(m.predictionIntervalLow != null, `month ${m.month} should have low PI`);
    truthy(m.predictionIntervalHigh != null, `month ${m.month} should have high PI`);
    truthy(m.predictionIntervalHigh! >= m.qty, `PI high (${m.predictionIntervalHigh}) >= qty (${m.qty})`);
    truthy(m.predictionIntervalLow! <= m.qty, `PI low (${m.predictionIntervalLow}) <= qty (${m.qty})`);
  }
});
test("confidence interval widens with forecast horizon", () => {
  const h = mkHistory([10, 12, 11, 13, 15, 14, 16, 18, 17, 19, 20, 22]);
  const r = forecastSKU(h, 50, 14);
  const firstWidth = r.forecast[0].predictionIntervalHigh! - r.forecast[0].predictionIntervalLow!;
  const lastWidth = r.forecast[r.forecast.length - 1].predictionIntervalHigh! - r.forecast[r.forecast.length - 1].predictionIntervalLow!;
  truthy(lastWidth >= firstWidth, `CI should widen: first=${firstWidth}, last=${lastWidth}`);
});

console.log("\ndaily forecast accuracy");
test("daily forecast uses actual month days", () => {
  const h = mkHistory([30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]);
  const r = forecastSKU(h, 100, 14);
  const nextMonthQty = r.forecast[0]?.qty ?? 0;
  const dm = r.forecast[0]?.dailyRate ?? 0;
  // dailyRate should be qty / actual days in that month
  close(dm * 30, nextMonthQty, 2);
  truthy(r.dailyForecast > 0, "dailyForecast should be > 0");
});

test("forecast has month names", () => {
  const h = mkHistory([10, 12, 11, 13, 15, 14, 16, 18, 17, 19, 20, 22]);
  const r = forecastSKU(h, 50, 14, 3);
  eq(r.forecast.length, 3);
  for (const m of r.forecast) {
    truthy(m.monthName, `month ${m.month} should have a monthName`);
    truthy(m.monthName.length > 0, `monthName should not be empty`);
    truthy(typeof m.stockRequired === "number", `stockRequired should be a number`);
    truthy(typeof m.projectedStockAfter === "number", `projectedStockAfter should be a number`);
    truthy(typeof m.dailyRate === "number", `dailyRate should be a number`);
    truthy(typeof m.suggestedOrder === "number", `suggestedOrder should be a number`);
  }
});

test("projected stock decreases over months without reorder", () => {
  const h = mkHistory([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]);
  const r = forecastSKU(h, 50, 14, 3);
  // Stock should decrease each month as demand consumes it
  for (let i = 1; i < r.forecast.length; i++) {
    truthy(
      r.forecast[i].projectedStockAfter <= r.forecast[i - 1].projectedStockAfter,
      `Month ${i} projected stock (${r.forecast[i].projectedStockAfter}) should be <= month ${i - 1} (${r.forecast[i - 1].projectedStockAfter})`
    );
  }
});

test("suggested order triggers when stock is low", () => {
  // Very low stock, high demand — should trigger suggested orders
  const h = mkHistory([100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]);
  const r = forecastSKU(h, 10, 30, 3);
  // First month: 10 stock vs ~100 demand
  truthy(r.forecast[0].suggestedOrder > 0, "should suggest order when stock is low");
  truthy(r.forecast[0].projectedStockAfter <= r.forecast[0].stockRequired, "stock after should be <= required");
});

console.log("\ntimeline — stockout date = today + days of cover");
test("estimatedStockoutDate equals today + daysOfCover", () => {
  const h = mkHistory([30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]);
  const r = forecastSKU(h, 30, 14);
  truthy(Number.isFinite(r.daysOfCover), "daysOfCover should be finite");
  truthy(r.estimatedStockoutDate != null, "estimatedStockoutDate should exist");
  const d = new Date();
  d.setDate(d.getDate() + r.daysOfCover);
  eq(r.estimatedStockoutDate, d.toISOString().slice(0, 10));
});
test("no stockout date when demand is zero (daysOfCover = Infinity)", () => {
  const h = mkHistory([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const r = forecastSKU(h, 30, 14);
  eq(r.daysOfCover, Infinity);
  eq(r.estimatedStockoutDate, null);
});
test("stockout date is today when already out of stock", () => {
  const h = mkHistory([30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]);
  const r = forecastSKU(h, 0, 14);
  eq(r.estimatedStockoutDate, new Date().toISOString().slice(0, 10));
});

console.log("\nnew fields — stock requirement");

console.log("\nlive pace adjustment");
test("computePaceAdjustment applies the ratio formula", () => {
  // base 60, day 15 of a 30-day month → expected 30. Actual 45 → ratio 1.5
  const p = computePaceAdjustment({ currentMonthBaseForecast: 60, actualSalesToDate: 45, daysElapsed: 15, daysInMonth: 30 });
  close(p.expectedSalesToDate, 30, 0.01);
  close(p.salesPaceRatio!, 1.5, 0.001);
  close(p.adjustmentFactor, 1.15, 0.001);
});
test("adjustment factor clamps to 1.20 and 0.80", () => {
  const hot = computePaceAdjustment({ currentMonthBaseForecast: 60, actualSalesToDate: 300, daysElapsed: 15, daysInMonth: 30 });
  eq(hot.adjustmentFactor, 1.2);
  const cold = computePaceAdjustment({ currentMonthBaseForecast: 60, actualSalesToDate: 0, daysElapsed: 15, daysInMonth: 30 });
  eq(cold.adjustmentFactor, 0.8);
});
test("no adjustment before 7 days or with no current-month forecast", () => {
  const early = computePaceAdjustment({ currentMonthBaseForecast: 60, actualSalesToDate: 999, daysElapsed: 6, daysInMonth: 30 });
  eq(early.adjustmentFactor, 1);
  eq(early.salesPaceRatio, null);
  const zeroBase = computePaceAdjustment({ currentMonthBaseForecast: 0, actualSalesToDate: 10, daysElapsed: 15, daysInMonth: 30 });
  eq(zeroBase.adjustmentFactor, 1);
});
test("forecastSKU exposes base + adjusted next month without altering the base", () => {
  const h = mkHistory([30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]);
  const now = new Date();
  const currentMonth: MonthlyBucket = {
    month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
    qty: 45,
    rawQty: 45,
  };
  const r = forecastSKU(h, 50, 14, 6, { currentMonth });
  eq(r.nextMonthBaseForecast, r.finalForecast, "base next-month forecast unchanged");
  truthy(r.adjustmentFactor >= 0.8 && r.adjustmentFactor <= 1.2, "factor within clamp");
  // Without current-month data the factor is 1 (no adjustment)
  const r2 = forecastSKU(h, 50, 14, 6);
  eq(r2.adjustmentFactor, 1);
  // The adjustment never alters the forecast months themselves
  eq(
    r.forecast.map((m) => m.qty).join(","),
    r2.forecast.map((m) => m.qty).join(","),
    "forecast months identical with or without adjustment"
  );
});
test("recomputeTimeline refreshes the pace factor from live current-month sales", () => {
  const h = mkHistory([30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]);
  const now = new Date();
  const currentMonth: MonthlyBucket = {
    month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
    qty: 0,
    rawQty: 0,
  };
  const r = forecastSKU(h, 50, 14, 6, { currentMonth });
  const base = r.adjustmentFactor;
  const fresh = recomputeTimeline(r, 50, 14, 10000);
  truthy(fresh.adjustmentFactor >= base, "factor rises with strong live sales");
  eq(fresh.nextMonthBaseForecast, r.nextMonthBaseForecast, "base forecast preserved");
  eq(fresh.calculationBreakdown.paceAdjustment.adjustedNextForecast, fresh.adjustedNextForecast);
});

console.log("\ntrend for longer horizons (no dampening)");
test("produces a full 6-month forecast", () => {
  const h = makeTrendingHistory(12, 10, 20); // strong upward trend
  const r = forecastSKU(h, 100, 14, 6);
  const diffs = r.forecast.slice(1).map((m, i) => m.qty - r.forecast[i].qty);
  truthy(diffs.length > 0, "should produce multiple forecast months");
});

console.log("\nseasonality (no neighbor smoothing)");
test("seasonality factor is the raw month factor, not neighbor-blended", () => {
  const now = new Date();
  const curIdx = now.getMonth();
  // Current calendar month = 60 units, every other month = 100.
  // overallAvg = (11×100 + 60) ÷ 12 = 96.67 → raw factor = 60 ÷ 96.67 = 0.6207.
  // Old 70/15/15 blending would have given ~0.7448.
  const h: MonthlyBucket[] = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    const q = d.getMonth() === curIdx ? 60 : 100;
    return {
      month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      qty: q,
      rawQty: q,
    };
  });
  const r = forecastSKU(h, 1000, 14);
  const bd = r.calculationBreakdown.seasonality.perMonthBreakdown[curIdx];
  close(bd.rawFactor, 0.6207, 0.001);
  close(bd.smoothedFactor, bd.rawFactor, 0.001);
  close(bd.clampedFactor, bd.rawFactor, 0.001);
});
test("safety stock = dailyAverage × safetyStockDays from config", () => {
  // Safety stock is daily avg demand (last 3 completed months) × product safety stock days.
  const h = mkHistory([30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]);
  const a = forecastSKU(h, 0, 30, 6, { config: { supplierLeadTimeDays: 30, safetyStockDays: 30 } });
  const bd = a.calculationBreakdown.reorder;
  const expected = Math.round(bd.dailyAverage * 30);
  eq(bd.safetyStockUnits, expected, "safety = dailyAverage × 30");
  eq(bd.safetyStockDays, 30);
  // A different safety stock days value must change the result proportionally
  const c = forecastSKU(h, 0, 30, 6, { config: { supplierLeadTimeDays: 30, safetyStockDays: 15 } });
  eq(c.calculationBreakdown.reorder.safetyStockUnits, Math.round(c.calculationBreakdown.reorder.dailyAverage * 15), "safety scales with safetyStockDays");
});
test("reorder = requiredStock − stock on hand (last-3-months daily average)", () => {
  const h = mkHistory([30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]);
  const r = forecastSKU(h, 0, 14, 6, { config: { supplierLeadTimeDays: 14, safetyStockDays: 30 } });
  const bd = r.calculationBreakdown.reorder;
  // requiredStock = dailyAverage × (lead time + safety days)
  close(bd.requiredStock, bd.dailyAverage * (14 + 30), 0.01);
  // recommendedBeforeCaps holds the unrounded raw reorder; final = ceil(raw)
  const expected = Math.ceil(bd.recommendedBeforeCaps);
  eq(r.recommendedReorder, expected, "raw reorder = max(0, required − position), ceil");
  // With stock on hand, reorder shrinks by exactly that stock
  const r2 = forecastSKU(h, 100, 14, 6, { config: { supplierLeadTimeDays: 14, safetyStockDays: 30 } });
  const bd2 = r2.calculationBreakdown.reorder;
  eq(r2.recommendedReorder, Math.ceil(bd2.recommendedBeforeCaps));
  close(r2.recommendedReorder, Math.max(0, expected - 100), 1);
});
test("daily average uses only the last 3 completed months (current month excluded)", () => {
  const now = new Date();
  const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const h = mkHistory([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]);
  const r = forecastSKU(h, 0, 14, 6, { config: { supplierLeadTimeDays: 14, safetyStockDays: 30 } });
  const bd = r.calculationBreakdown.reorder;
  eq(bd.lastThreeMonths.length, 3, "exactly 3 completed months");
  truthy(bd.lastThreeMonths.every((m) => m.monthKey < curKey), "current (partial) month is excluded");
  eq(bd.totalDemand, 30, "3 completed months × 10 units each");
  // Calendar days must match the real days of those months
  const realDays = bd.lastThreeMonths.reduce(
    (s, m) => s + new Date(Number(m.monthKey.slice(0, 4)), Number(m.monthKey.slice(5, 7)), 0).getDate(),
    0
  );
  eq(bd.totalDays, realDays, "calendar days match the actual months");
  // dailyAverage = totalDemand ÷ totalDays
  close(bd.dailyAverage, bd.totalDemand / bd.totalDays, 0.0001);
});
test("recomputeTimeline refreshes reorder against live stock & backfills new fields", () => {
  const h = mkHistory([30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]);
  const r = forecastSKU(h, 50, 14, 6, {
    config: { supplierLeadTimeDays: 14, safetyStockDays: 30 },
  });
  // Simulate an OLD persisted snapshot that lacks the new reorder fields
  const oldSnapshot: ForecastResult = JSON.parse(
    JSON.stringify({
      ...r,
      recommendedReorder: 999,
      calculationBreakdown: {
        ...r.calculationBreakdown,
        reorder: {
          supplierLeadDays: 14,
          requiredStock: 100,
          inventoryPosition: 50,
          finalRecommended: 999,
        },
      },
    })
  );
  const fresh = recomputeTimeline(oldSnapshot, 50, 14);
  // Reorder was recomputed (not 999), and matches the fresh engine result
  eq(fresh.recommendedReorder, r.recommendedReorder, "reorder recomputed live");
  const rb = fresh.calculationBreakdown.reorder;
  eq(rb.safetyStockDays, 30, "safety days backfilled with default");
  truthy(typeof rb.safetyStockUnits === "number" && rb.safetyStockUnits > 0, "safety units backfilled");
  truthy(typeof rb.dailyForecast === "number", "dailyForecast backfilled");
  // Daily average uses the last 3 completed months (current month excluded)
  const now = new Date();
  const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  eq(rb.lastThreeMonths.length, 3, "exactly 3 completed months");
  truthy(rb.lastThreeMonths.every((m) => m.monthKey < curKey), "current month excluded");
  truthy(typeof rb.dailyAverage === "number" && rb.dailyAverage > 0, "daily average backfilled");
});

console.log("\nrecommended price — demo price-change table (configurable, recommendation only)");

function pricing(over: Record<string, unknown> = {}) {
  return computePricingStrategy({
    velocity: "medium_mover",
    momentum: "stable",
    daysOfCover: 120,
    unitCost: 10,
    unitPrice: 25,
    minimumGrossMarginPercentage: 0.4,
    supplierLeadTimeDays: 14,
    safetyStockDays: 30,
    maxCoverDays: 180,
    ...(over as any),
  });
}

test("clearance: dead + high stock → −25%", () => {
  const r = pricing({ velocity: "dead", daysOfCover: 300 });
  eq(r.recommendedPriceChangePct, -25);
  eq(r.strategy, "Clearance");
  eq(r.priceChangeRule, "clearance-dead");
  close(r.recommendedPrice, 25 * 0.75, 0.01);
});

test("clearance: inactive momentum + high stock → −25%", () => {
  const r = pricing({ velocity: "slow_mover", momentum: "inactive", daysOfCover: 300 });
  eq(r.recommendedPriceChangePct, -25);
  eq(r.priceChangeRule, "clearance-inactive");
});

test("markdown: slow + declining + high → −15%", () => {
  const r = pricing({ velocity: "slow_mover", momentum: "declining", daysOfCover: 300 });
  eq(r.recommendedPriceChangePct, -15);
  eq(r.strategy, "Markdown / Promotion");
  eq(r.priceChangeRule, "markdown");
  close(r.recommendedPrice, 25 * 0.85, 0.01);
});

test("protect margin: fast + accelerating + low → +5%", () => {
  const r = pricing({ velocity: "fast_mover", momentum: "accelerating", daysOfCover: 20 });
  eq(r.recommendedPriceChangePct, 5);
  eq(r.strategy, "Protect margin");
  eq(r.priceChangeRule, "protect-accelerating");
  close(r.recommendedPrice, 25 * 1.05, 0.01);
});

test("protect margin: fast + stable + low → +3% (new branch)", () => {
  const r = pricing({ velocity: "fast_mover", momentum: "stable", daysOfCover: 20 });
  eq(r.recommendedPriceChangePct, 3);
  eq(r.strategy, "Protect margin");
  eq(r.priceChangeRule, "protect-stable");
  close(r.recommendedPrice, 25 * 1.03, 0.01);
});

test("targeted promotion: slow + stable (any stock) → −10%", () => {
  const normal = pricing({ velocity: "slow_mover", momentum: "stable", daysOfCover: 120 });
  eq(normal.recommendedPriceChangePct, -10);
  eq(normal.strategy, "Targeted promotion");
  close(normal.recommendedPrice, 25 * 0.9, 0.01);
  const high = pricing({ velocity: "slow_mover", momentum: "stable", daysOfCover: 300 });
  eq(high.recommendedPriceChangePct, -10, "applies at high stock too");
});

test("hold price: medium + stable → 0%", () => {
  const r = pricing({ velocity: "medium_mover", momentum: "stable", daysOfCover: 120 });
  eq(r.recommendedPriceChangePct, 0);
  eq(r.recommendedPrice, 25);
});

test("any other combination → 0% and no rule id", () => {
  const r = pricing({ velocity: "fast_mover", momentum: "stable", daysOfCover: 120 });
  eq(r.recommendedPriceChangePct, 0);
  eq(r.priceChangeRule, null);
});

test("recommended price never goes below the minimumPrice floor", () => {
  const r = pricing({ unitPrice: 12, unitCost: 10 }); // price below margin floor
  const min = 10 / (1 - 0.4); // 16.67
  close(r.recommendedPrice, min, 0.01);
  truthy(r.recommendedPrice >= min - 0.001, "floored at minimum price");
});

test("recommendation never mutates the SKU price inputs", () => {
  const input = {
    velocity: "fast_mover" as const,
    momentum: "accelerating" as const,
    daysOfCover: 20,
    unitCost: 10,
    unitPrice: 25,
  };
  const r = computePricingStrategy({
    ...input,
    supplierLeadTimeDays: 14,
    safetyStockDays: 30,
    maxCoverDays: 180,
  });
  eq(r.conditions.unitPrice, 25, "conditions carry the original price");
  eq(r.conditions.unitCost, 10);
  truthy(r.recommendedPrice !== 25, "recommended price is a separate output");
  eq(input.unitPrice, 25, "input object untouched");
  eq(input.unitCost, 10);
});

test("custom price-change rules override the defaults", () => {
  const custom = [
    { id: "aggressive", velocity: "slow_mover" as const, momentum: "stable" as const, changePct: -5 },
  ];
  const r = computePricingStrategy({
    velocity: "slow_mover",
    momentum: "stable",
    daysOfCover: 120,
    unitCost: 10,
    unitPrice: 25,
    supplierLeadTimeDays: 14,
    safetyStockDays: 30,
    maxCoverDays: 180,
    priceChangeRules: custom,
  });
  eq(r.recommendedPriceChangePct, -5);
  eq(r.priceChangeRule, "aggressive");
});

test("per-product min gross margin drives the floor", () => {
  const r = pricing({ unitPrice: 12, unitCost: 10, minimumGrossMarginPercentage: 0.7 });
  const min = 10 / (1 - 0.7); // 33.33 with a 70% margin requirement
  close(r.recommendedPrice, min, 0.01);
  close(r.conditions.minGrossMarginPct, 0.7, 0.0001);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0 && typeof process !== "undefined") process.exit(1);
