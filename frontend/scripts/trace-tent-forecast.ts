import { bucketMovementsByMonth, currentMonthBucket, forecastSKU } from "../src/lib/forecast-engine";

const movements = [
  // Opening stock
  { movement_date: "2025-10-01", quantity: 999, direction: "in" },
  // Oct 2025
  { movement_date: "2025-10-09", quantity: 4, direction: "out" },
  { movement_date: "2025-10-15", quantity: 15, direction: "out" },
  { movement_date: "2025-10-16", quantity: 5, direction: "out" },
  { movement_date: "2025-10-18", quantity: 2, direction: "out" },
  { movement_date: "2025-10-22", quantity: 12, direction: "out" },
  { movement_date: "2025-10-25", quantity: 5, direction: "out" },
  { movement_date: "2025-10-27", quantity: 10, direction: "out" },
  { movement_date: "2025-10-29", quantity: 3, direction: "out" },
  { movement_date: "2025-10-30", quantity: 7, direction: "out" },
  // Nov 2025
  { movement_date: "2025-11-03", quantity: 21, direction: "out" },
  { movement_date: "2025-11-04", quantity: 2, direction: "out" },
  { movement_date: "2025-11-07", quantity: 5, direction: "out" },
  { movement_date: "2025-11-09", quantity: 4, direction: "out" },
  { movement_date: "2025-11-10", quantity: 2, direction: "out" },
  { movement_date: "2025-11-13", quantity: 3, direction: "out" },
  { movement_date: "2025-11-14", quantity: 10, direction: "out" },
  { movement_date: "2025-11-15", quantity: 2, direction: "out" },
  { movement_date: "2025-11-19", quantity: 5, direction: "out" },
  { movement_date: "2025-11-20", quantity: 4, direction: "out" },
  { movement_date: "2025-11-22", quantity: 10, direction: "out" },
  // Dec 2025
  { movement_date: "2025-12-03", quantity: 3, direction: "out" },
  { movement_date: "2025-12-10", quantity: 12, direction: "out" },
  { movement_date: "2025-12-15", quantity: 20, direction: "out" },
  { movement_date: "2025-12-16", quantity: 5, direction: "out" },
  { movement_date: "2025-12-17", quantity: 5, direction: "out" },
  { movement_date: "2025-12-22", quantity: 37, direction: "out" },
  { movement_date: "2025-12-23", quantity: 30, direction: "out" },
  // Jan 2026
  { movement_date: "2026-01-01", quantity: 200, direction: "out" },
  // Apr 2026
  { movement_date: "2026-04-01", quantity: 22, direction: "out" },
  { movement_date: "2026-04-03", quantity: 1, direction: "out" },
  { movement_date: "2026-04-09", quantity: 2, direction: "out" },
  { movement_date: "2026-04-13", quantity: 1, direction: "out" },
  { movement_date: "2026-04-24", quantity: 5, direction: "out" },
  { movement_date: "2026-04-28", quantity: 5, direction: "out" },
  { movement_date: "2026-04-29", quantity: 12, direction: "out" },
  // May 2026
  { movement_date: "2026-05-01", quantity: 50, direction: "out" },
  { movement_date: "2026-05-05", quantity: 1, direction: "out" },
  { movement_date: "2026-05-06", quantity: 3, direction: "out" },
  { movement_date: "2026-05-09", quantity: 1, direction: "out" },
  { movement_date: "2026-05-12", quantity: 1, direction: "in" },
  { movement_date: "2026-05-13", quantity: 1, direction: "out" },
  { movement_date: "2026-05-15", quantity: 1, direction: "out" },
  { movement_date: "2026-05-18", quantity: 2, direction: "out" },
  { movement_date: "2026-05-19", quantity: 5, direction: "out" },
  { movement_date: "2026-05-21", quantity: 2, direction: "out" },
  { movement_date: "2026-05-22", quantity: 1, direction: "out" },
  { movement_date: "2026-05-23", quantity: 5, direction: "out" },
  { movement_date: "2026-05-24", quantity: 1, direction: "out" },
  { movement_date: "2026-05-25", quantity: 2, direction: "out" },
  { movement_date: "2026-05-26", quantity: 1, direction: "out" },
  { movement_date: "2026-05-29", quantity: 1, direction: "out" },
  { movement_date: "2026-05-30", quantity: 1, direction: "out" },
  { movement_date: "2026-05-31", quantity: 1, direction: "in" },
  // Jun 2026
  { movement_date: "2026-06-01", quantity: 1, direction: "out" },
  { movement_date: "2026-06-02", quantity: 23, direction: "out" },
  { movement_date: "2026-06-03", quantity: 3, direction: "in" },
  { movement_date: "2026-06-04", quantity: 1, direction: "out" },
  { movement_date: "2026-06-06", quantity: 41, direction: "out" },
  { movement_date: "2026-06-07", quantity: 2, direction: "out" },
  { movement_date: "2026-06-08", quantity: 2, direction: "out" },
  { movement_date: "2026-06-09", quantity: 6, direction: "out" },
  { movement_date: "2026-06-12", quantity: 3, direction: "out" },
  { movement_date: "2026-06-15", quantity: 7, direction: "out" },
  { movement_date: "2026-06-17", quantity: 13, direction: "out" },
  { movement_date: "2026-06-18", quantity: 2, direction: "out" },
  { movement_date: "2026-06-20", quantity: 1, direction: "out" },
  { movement_date: "2026-06-22", quantity: 1, direction: "out" },
  { movement_date: "2026-06-23", quantity: 1, direction: "in" },
  { movement_date: "2026-06-24", quantity: 3, direction: "out" },
  { movement_date: "2026-06-25", quantity: 2, direction: "in" },
  { movement_date: "2026-06-26", quantity: 1, direction: "out" },
  { movement_date: "2026-06-27", quantity: 7, direction: "out" },
  { movement_date: "2026-06-30", quantity: 6, direction: "in" },
  // Jul 2026
  { movement_date: "2026-07-01", quantity: 124, direction: "out" },
  { movement_date: "2026-07-24", quantity: 2, direction: "out" },
  { movement_date: "2026-07-25", quantity: 30, direction: "out" },
  { movement_date: "2026-07-28", quantity: 1, direction: "out" },
  { movement_date: "2026-07-31", quantity: 15, direction: "out" },
  // Aug 2026 (current month - partial)
  { movement_date: "2026-08-06", quantity: 2, direction: "out" },
  { movement_date: "2026-08-10", quantity: 1, direction: "out" },
  { movement_date: "2026-08-11", quantity: 1, direction: "out" },
  { movement_date: "2026-08-12", quantity: 2, direction: "out" },
  { movement_date: "2026-08-19", quantity: 3, direction: "out" },
  { movement_date: "2026-08-22", quantity: 1, direction: "out" },
  { movement_date: "2026-08-26", quantity: 3, direction: "out" },
];

// ============================================================
// Step 1: Compute stock (all movements)
// ============================================================
let stock = 0;
for (const m of movements) stock += (m.direction === "in" ? 1 : -1) * Number(m.quantity);
console.log("=== STEP 1: INVENTORY POSITION ===");
console.log("Total stock (all confirmed movements):", stock);

// ============================================================
// Step 2: Bucket movements into 12-month history (default: no targetMonth)
// ============================================================
const history = bucketMovementsByMonth(movements, 12);
console.log("\n=== STEP 2: 12-MONTH HISTORY BUCKETS ===");
for (const h of history) {
  console.log(
    `  ${h.month}: qty(corr)=${h.qty}, rawQty=${h.rawQty}, entries=${h.entryCount}, availRate=${h.availabilityRate ?? "N/A"}`
  );
}

// ============================================================
// Step 3: Current month bucket (August 2026)
// ============================================================
const currentMonth = currentMonthBucket(movements);
console.log("\n=== STEP 3: CURRENT MONTH (AUG 2026) ===");
console.log(`  rawQty=${currentMonth.rawQty}, correctedQty=${currentMonth.qty}`);

// ============================================================
// Step 4: Run forecast (default behavior, no targetMonth)
// ============================================================
const leadTimeDays = 14;
const f = forecastSKU(history, stock, leadTimeDays, 6, {
  config: { safetyStockDays: 30 },
  currentMonth,
  movements,
});

console.log("\n=== STEP 4: FORECAST RESULTS (NEXT 6 MONTHS) ===");
for (const m of f.forecast) {
  console.log(
    `  ${m.month} (${m.monthName}): forecast=${m.qty}, baseline=${m.baseline}, seas=${m.seasonalityFactor}, dailyRate=${m.dailyRate}, PI=[${m.predictionIntervalLow}, ${m.predictionIntervalHigh}]`
  );
}

// ============================================================
// Step 5: Input data
// ============================================================
const bd = f.calculationBreakdown;
console.log("\n=== STEP 5: INPUT DATA ===");
console.log("  Demand values (12 months):", bd.inputData.values);
console.log("  Month labels:", bd.inputData.monthLabels);

// ============================================================
// Step 6: Weighted average
// ============================================================
console.log("\n=== STEP 6: WEIGHTED AVERAGE ===");
console.log("  Formula:", bd.weightedAverage.formula);
console.log("  Values:", bd.weightedAverage.values);
console.log("  Weights:", bd.weightedAverage.weights);
console.log("  Weighted sum:", bd.weightedAverage.weightedSum);
console.log("  Weight sum:", bd.weightedAverage.weightSum);
console.log("  Result (weightedAvg):", bd.weightedAverage.result);

// ============================================================
// Step 7: Trend analysis
// ============================================================
console.log("\n=== STEP 7: TREND ANALYSIS (OLS REGRESSION) ===");
console.log("  Formula:", bd.trendAnalysis.formula);
console.log("  Σx:", bd.trendAnalysis.sumX, " Σy:", bd.trendAnalysis.sumY);
console.log("  Σxy:", bd.trendAnalysis.sumXY, " Σx²:", bd.trendAnalysis.sumX2);
console.log("  MeanX:", bd.trendAnalysis.meanX, " MeanY:", bd.trendAnalysis.meanY);
console.log("  Numerator:", bd.trendAnalysis.numerator);
console.log("  Denominator:", bd.trendAnalysis.denominator);
console.log("  Slope:", bd.trendAnalysis.slope);
console.log("  SS residual:", bd.trendAnalysis.ssRes, " SS total:", bd.trendAnalysis.ssTot);
console.log("  R²:", bd.trendAnalysis.rSquared);
console.log("  Threshold:", bd.trendAnalysis.threshold);
console.log("  Direction:", bd.trendAnalysis.direction);

// ============================================================
// Step 8: Seasonality
// ============================================================
console.log("\n=== STEP 8: SEASONALITY ===");
console.log("  Overall avg entry count:", bd.seasonality.overallAvg);
for (const pm of bd.seasonality.perMonthBreakdown) {
  if (pm.monthAvg > 0) {
    console.log(
      `  ${pm.monthName}: entries=${JSON.stringify(pm.values)}, avg=${pm.monthAvg}, rawFactor=${pm.rawFactor}, clamped=${pm.clampedFactor}`
    );
  }
}

// ============================================================
// Step 9: Per-month detail (the core formula)
// ============================================================
console.log("\n=== STEP 9: PER-MONTH FORECAST BREAKDOWN ===");
for (const md of bd.monthlyDetail) {
  console.log(`\n  ${md.monthName} (${md.monthKey}):`);
  console.log(`    Weighted avg:       ${md.monthWeightedAvg}`);
  console.log(`    Slope:             ${md.monthSlope}`);
  console.log(`    Trend contribution: ${md.trendContribution}`);
  console.log(`    avg + slope:       ${md.avgPlusTrend}`);
  console.log(`    Seasonality:       ${md.seasonalityFactor}`);
  console.log(`    Baseline:          ${md.baseline}`);
  console.log(`    Days in month:     ${md.daysInMonth}`);
  console.log(`    Daily rate:        ${md.dailyRate}`);
  console.log(`    Final forecast:    ${md.finalForecast}`);
  console.log(`    PI low/high:       [${md.predictionIntervalLow}, ${md.predictionIntervalHigh}]`);
  console.log(`    Running stock:     ${md.runningStockBefore}`);
  console.log(`    Safety stock:      ${md.monthlySafetyStock} (${md.safetyStockDays} days × ${md.dailyRate}/day)`);
  console.log(`    Stock shortfall:   ${md.stockShortfall}`);
  console.log(`    Suggested order:   ${md.suggestedOrder}`);
}

// ============================================================
// Step 10: Aggregate summary
// ============================================================
console.log("\n=== STEP 10: AGGREGATE METRICS ===");
console.log("  Raw outbound demand:", f.rawOutboundDemand);
console.log("  Corrected demand:", f.correctedDemand);
console.log("  Availability rate:", f.availabilityRate);
console.log("  Weighted baseline:", f.weightedBaseline);
console.log("  Trend slope:", f.trendAdjustment);
console.log("  Trend strength (R²):", f.trendStrength);
console.log("  Trend direction:", f.trendDirection);
console.log("  Seasonality (next month):", f.seasonalityFactor);
console.log("  Final forecast (next month):", f.finalForecast);
console.log("  Daily forecast:", f.dailyForecast);
console.log("  Inventory position:", f.inventoryPosition);
console.log("  Days of cover:", f.daysOfCover);
console.log("  Momentum:", f.momentumTag);
console.log("  Velocity:", f.velocityTag);
console.log("  Stockout risk:", f.stockoutRisk);
console.log("  Overstock risk:", f.overstockRisk);
console.log("  Estimated stockout:", f.estimatedStockoutDate);
console.log("  Reorder by:", f.reorderByDate);
console.log("  Next refill:", f.nextRefillDate);
console.log("  Stockout urgency:", f.stockoutUrgency);
console.log("  Recommended reorder:", f.recommendedReorder);

// ============================================================
// Step 11: Pace adjustment
// ============================================================
console.log("\n=== STEP 11: LIVE PACE ADJUSTMENT ===");
const pa = bd.paceAdjustment;
console.log("  Current month base forecast:", pa.currentMonthBaseForecast);
console.log("  Next month base forecast:", pa.nextMonthBaseForecast);
console.log("  Actual sales to date:", pa.actualSalesToDate);
console.log("  Expected sales to date:", pa.expectedSalesToDate);
console.log("  Days elapsed:", pa.daysElapsed, "/", pa.daysInMonth);
console.log("  Sales pace ratio:", pa.salesPaceRatio);
console.log("  Adjustment factor:", pa.adjustmentFactor);
console.log("  Adjusted next forecast:", pa.adjustedNextForecast);
console.log("  Reason:", pa.reason);

// ============================================================
// Step 12: Reorder
// ============================================================
console.log("\n=== STEP 12: REORDER CALCULATION ===");
const ro = bd.reorder;
console.log("  Supplier lead days:", ro.supplierLeadDays);
console.log("  Last 3 months:", JSON.stringify(ro.lastThreeMonths, null, 4));
console.log("  Total demand:", ro.totalDemand);
console.log("  Total days:", ro.totalDays);
console.log("  Daily average:", ro.dailyAverage);
console.log("  Required stock:", ro.requiredStock);
console.log("  Safety stock formula:", ro.safetyStockFormula);
console.log("  Safety stock units:", ro.safetyStockUnits);
console.log("  Inventory position:", ro.inventoryPosition);
console.log("  Before caps:", ro.recommendedBeforeCaps);
console.log("  After cap:", ro.afterCap);
console.log("  Min order qty:", ro.minimumOrderQty);
console.log("  After MOQ:", ro.afterMOQ);
console.log("  Order multiple:", ro.orderMultiple);
console.log("  Final recommended:", ro.finalRecommended);
