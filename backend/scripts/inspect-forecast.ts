#!/usr/bin/env tsx
// Inspect the stored forecast calculation breakdown for a specific SKU.
//
// Usage:
//   cd backend && npx tsx scripts/inspect-forecast.ts EH-900
//   npx tsx scripts/inspect-forecast.ts EH-900 --month 2026-04
//
// Pulls the latest ForecastVariable snapshot from DynamoDB, deserialises
// the stored forecastJson, and prints the full calculation breakdown.

import * as db from "../src/dynamodb.js";
import { config } from "../src/config.js";

const targetSku = (process.argv[2] ?? "EH-900").toUpperCase();
const targetMonth = process.argv.find((_, i, a) => a[i - 1] === "--month") ?? null;

async function main() {
  console.log(`→ Table: ${config.dynamodb.tableName}`);
  console.log(`→ Looking for SKU: ${targetSku}`);
  if (targetMonth) console.log(`→ Target month: ${targetMonth}`);
  console.log();

  // 1. Find the user / client
  const users = (await db.scanByType("User")) as any[];
  if (users.length === 0) {
    console.error("❌ No users found.");
    process.exit(1);
  }
  const owner = users[0];
  const clientId = owner.id;
  console.log(`→ Client: ${owner.email} (${clientId})`);

  // 2. Find the product
  const products = (await db.scanByType("Product")) as any[];
  const product = products.find(
    (p: any) => (p.sku ?? "").toUpperCase() === targetSku && p.clientId === clientId
  );
  if (!product) {
    console.error(`❌ Product ${targetSku} not found for client ${clientId}.`);
    console.log(`   Available SKUs: ${products.filter((p: any) => p.clientId === clientId).map((p: any) => p.sku).join(", ")}`);
    process.exit(1);
  }
  console.log(`→ Product: ${product.sku} — ${product.name} (id: ${product.id})`);
  console.log(`  category: ${product.category}, leadTimeDays: ${product.leadTimeDays}, safetyStockDays: ${product.safetyStockDays}`);
  console.log();

  // 3. Find the forecast snapshot
  const forecastItems = (await db.queryByGSI1(clientId, {
    entityType: "ForecastVariable",
    limit: 500,
    reverse: true,
  })) as any;

  const snapshots = forecastItems.items.filter((f: any) => f.productId === product.id);
  if (snapshots.length === 0) {
    console.error(`❌ No forecast snapshots found for ${targetSku}.`);
    process.exit(1);
  }
  // Use the newest snapshot
  const snapshot = snapshots[0];
  console.log(`→ Snapshot computed: ${snapshot.computedDate}`);
  console.log(`  finalForecast: ${snapshot.finalForecast}, daysOfCover: ${snapshot.daysOfCover}, recommendedReorder: ${snapshot.recommendedReorder}`);
  console.log();

  const forecast = JSON.parse(snapshot.forecastJson);

  // 4. Print the full 12-month history
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("  12-MONTH HISTORY (outbound demand, corrected)");
  console.log("═══════════════════════════════════════════════════════════════════");
  const bd = forecast.calculationBreakdown;
  console.log(`  Values:  [${bd.inputData.values.join(", ")}]`);
  console.log(`  Labels:  [${bd.inputData.monthLabels.join(", ")}]`);
  console.log();

  // 5. Print weighted average calculation
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("  WEIGHTED AVERAGE");
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log(`  ${bd.weightedAverage.description}`);
  console.log(`  Formula: ${bd.weightedAverage.formula}`);
  console.log(`  Values:  [${bd.weightedAverage.values.join(", ")}]`);
  console.log(`  Weights: [${bd.weightedAverage.weights.join(", ")}]`);
  console.log(`  Σ(w×y) = ${bd.weightedAverage.weightedSum}`);
  console.log(`  Σ(w)   = ${bd.weightedAverage.weightSum}`);
  console.log(`  Result  = ${bd.weightedAverage.result}`);
  console.log();

  // 6. Print trend analysis
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("  TREND ANALYSIS (OLS)");
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log(`  ${bd.trendAnalysis.description}`);
  console.log(`  Formula: ${bd.trendAnalysis.formula}`);
  console.log(`  Σx=${bd.trendAnalysis.sumX}, Σy=${bd.trendAnalysis.sumY}`);
  console.log(`  Σxy=${bd.trendAnalysis.sumXY}, Σx²=${bd.trendAnalysis.sumX2}`);
  console.log(`  meanX=${bd.trendAnalysis.meanX}, meanY=${bd.trendAnalysis.meanY}`);
  console.log(`  Numerator   = ${bd.trendAnalysis.numerator}`);
  console.log(`  Denominator = ${bd.trendAnalysis.denominator}`);
  console.log(`  Slope       = ${bd.trendAnalysis.slope}`);
  console.log(`  R²          = ${bd.trendAnalysis.rSquared}`);
  console.log(`  Direction   = ${bd.trendAnalysis.direction}`);
  console.log(`  ssRes=${bd.trendAnalysis.ssRes}, ssTot=${bd.trendAnalysis.ssTot}`);
  console.log();

  // 7. Print seasonality
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("  SEASONALITY");
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log(`  ${bd.seasonality.description}`);
  console.log(`  Formula: ${bd.seasonality.formula}`);
  console.log(`  Overall avg entry count: ${bd.seasonality.overallAvg}`);
  console.log();
  for (const pb of bd.seasonality.perMonthBreakdown) {
    console.log(
      `  ${pb.monthName.padEnd(10)} entries=[${pb.values.join(", ").padEnd(8)}] avg=${String(pb.monthAvg).padEnd(6)} raw=${String(pb.rawFactor).padEnd(6)} smoothed=${String(pb.smoothedFactor).padEnd(6)} clamped=${pb.clampedFactor}`
    );
  }
  console.log();

  // 8. Print monthly detail for the forecast months
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("  FORECAST MONTHS (month-by-month detail)");
  console.log("═══════════════════════════════════════════════════════════════════");
  for (const md of bd.monthlyDetail) {
    console.log(`\n  ── ${md.monthName} (${md.monthKey}) ──`);
    console.log(`    Weighted avg (month)      = ${md.monthWeightedAvg}`);
    console.log(`    Trend slope (month)       = ${md.monthSlope}`);
    console.log(`    Trend contribution        = ${md.trendContribution}`);
    console.log(`    avg + slope               = ${md.avgPlusTrend}`);
    console.log(`    Seasonality factor        = ${md.seasonalityFactor}`);
    console.log(`    Baseline = (avg+slope)×seas = ${md.baseline}`);
    console.log(`    Factors multiplied         = ${md.factorsMultiplied}`);
    console.log(`    Clamp range                = [${md.clampLow}, ${md.clampHigh}]`);
    console.log(`    ★ FINAL FORECAST (qty)     = ${md.finalForecast}`);
    console.log(`    Days in month              = ${md.daysInMonth}`);
    console.log(`    Daily rate                 = ${md.dailyRate}`);
    console.log(`    Running stock before       = ${md.runningStockBefore}`);
    console.log(`    Stock required             = ${md.stockRequired}`);
    console.log(`    Safety stock days          = ${md.safetyStockDays}`);
    console.log(`    Monthly safety stock       = ${md.monthlySafetyStock}`);
    console.log(`    Stock shortfall            = ${md.stockShortfall}`);
    console.log(`    Suggested order            = ${md.suggestedOrder}`);
    console.log(`    Prediction interval        = [${md.predictionIntervalLow}, ${md.predictionIntervalHigh}]`);
    console.log(`    Projected stock after      = ${md.projectedStockAfter}`);
  }
  console.log();

  // 9. Print reorder
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("  REORDER CALCULATION");
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log(`  ${bd.reorder.description}`);
  console.log(`  Supplier lead days: ${bd.reorder.supplierLeadDays}`);
  console.log(`  Safety stock days:  ${bd.reorder.safetyStockDays}`);
  console.log(`  Last 3 months:`);
  for (const m of bd.reorder.lastThreeMonths) {
    console.log(`    ${m.monthName.padEnd(10)} demand=${String(m.demand).padEnd(8)} days=${m.days}`);
  }
  console.log(`  Total demand = ${bd.reorder.totalDemand}`);
  console.log(`  Total days   = ${bd.reorder.totalDays}`);
  console.log(`  Daily average = ${bd.reorder.dailyAverage}`);
  console.log(`  Required stock = dailyAvg × (lead + safety) = ${bd.reorder.requiredStock}`);
  console.log(`  Inventory position = ${bd.reorder.inventoryPosition}`);
  console.log(`  Safety stock units = ${bd.reorder.safetyStockUnits} (${bd.reorder.safetyStockFormula})`);
  console.log(`  Recommended (before caps) = ${bd.reorder.recommendedBeforeCaps}`);
  console.log(`  Max cover days: ${bd.reorder.maxCoverDays}`);
  console.log(`  Max stock:      ${bd.reorder.maxStock}`);
  console.log(`  Headroom:       ${bd.reorder.headroom}`);
  console.log(`  After cap:      ${bd.reorder.afterCap}`);
  console.log(`  After MOQ:      ${bd.reorder.afterMOQ}`);
  console.log(`  Order multiple: ${bd.reorder.orderMultiple}`);
  console.log(`  After multiple: ${bd.reorder.afterMultiple}`);
  console.log(`  ★ Final recommended reorder = ${bd.reorder.finalRecommended}`);
  console.log();

  // 10. Print pace adjustment
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("  PACE ADJUSTMENT");
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log(`  Current month base forecast = ${bd.paceAdjustment.currentMonthBaseForecast}`);
  console.log(`  Next month base forecast    = ${bd.paceAdjustment.nextMonthBaseForecast}`);
  console.log(`  Adjusted next forecast      = ${bd.paceAdjustment.adjustedNextForecast}`);
  console.log(`  Actual sales to date        = ${bd.paceAdjustment.actualSalesToDate}`);
  console.log(`  Expected sales to date      = ${bd.paceAdjustment.expectedSalesToDate}`);
  console.log(`  Days elapsed                = ${bd.paceAdjustment.daysElapsed}`);
  console.log(`  Days in month               = ${bd.paceAdjustment.daysInMonth}`);
  console.log(`  Sales pace ratio            = ${bd.paceAdjustment.salesPaceRatio}`);
  console.log(`  Adjustment factor           = ${bd.paceAdjustment.adjustmentFactor}`);
  console.log(`  Reason: ${bd.paceAdjustment.reason}`);
  console.log();

  // 11. Print days of cover
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("  DAYS OF COVER");
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log(`  Daily forecast      = ${bd.daysOfCover.dailyForecast}`);
  console.log(`  Inventory position  = ${bd.daysOfCover.inventoryPosition}`);
  console.log(`  Total demand (3mo)  = ${bd.daysOfCover.totalDemand}`);
  console.log(`  Total days (3mo)    = ${bd.daysOfCover.totalDays}`);
  console.log(`  Recent 3-month avg  = ${bd.daysOfCover.recent3MonthAvg}`);
  console.log(`  Recent daily avg    = ${bd.daysOfCover.recentDaily}`);
  console.log(`  ★ Days of cover     = ${bd.daysOfCover.daysOfCover}`);
  console.log();

  // 12. Print momentum
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("  MOMENTUM");
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log(`  Recent 3-month avg  = ${bd.momentum.recent3MonthAvg}`);
  console.log(`  Overall avg         = ${bd.momentum.overallAvg}`);
  console.log(`  Threshold 120%      = ${bd.momentum.threshold120pct}`);
  console.log(`  Threshold 60%       = ${bd.momentum.threshold60pct}`);
  console.log(`  ★ Momentum tag      = ${bd.momentum.result}`);
  console.log();

  // 13. Print risk
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("  RISK ASSESSMENT");
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log(`  Cover vs lead ratio = ${bd.risk.coverVsLead}`);
  console.log(`  Stockout risk       = ${bd.risk.stockoutRisk}`);
  console.log(`  Max cover days      = ${bd.risk.maxCoverDays}`);
  console.log(`  Overstock risk      = ${bd.risk.overstockRisk}`);
  console.log();

  // 14. Print timeline
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("  TIMELINE");
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log(`  Daily forecast          = ${bd.timeline.dailyForecast}`);
  console.log(`  Inventory position      = ${bd.timeline.inventoryPosition}`);
  console.log(`  Days until stockout     = ${bd.timeline.daysUntilStockout}`);
  console.log(`  Estimated stockout date = ${bd.timeline.estimatedStockoutDate}`);
  console.log(`  Supplier lead days      = ${bd.timeline.supplierLeadDays}`);
  console.log(`  Reorder by date         = ${bd.timeline.reorderByDate}`);
  console.log(`  Next refill date        = ${bd.timeline.nextRefillDate}`);
  console.log(`  Stockout urgency        = ${bd.timeline.stockoutUrgency}`);
  console.log();

  // 15. Summary
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("  TOP-LEVEL RESULT");
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log(`  Weighted baseline  = ${forecast.weightedBaseline}`);
  console.log(`  Trend adjustment   = ${forecast.trendAdjustment}`);
  console.log(`  Trend direction    = ${forecast.trendDirection}`);
  console.log(`  Trend strength     = ${forecast.trendStrength}`);
  console.log(`  Seasonality factor = ${forecast.seasonalityFactor}`);
  console.log(`  Final forecast     = ${forecast.finalForecast}`);
  console.log(`  Daily forecast     = ${forecast.dailyForecast}`);
  console.log(`  Adjusted forecast  = ${forecast.adjustedNextForecast}`);
  console.log(`  Adjustment factor  = ${forecast.adjustmentFactor}`);
  console.log(`  Avg monthly        = ${forecast.avgMonthly}`);
  console.log(`  Velocity tag       = ${forecast.velocityTag}`);
  console.log(`  Momentum tag       = ${forecast.momentumTag}`);
  console.log(`  Inventory position = ${forecast.inventoryPosition}`);
  console.log(`  Days of cover      = ${forecast.daysOfCover}`);
  console.log(`  Recommended reorder= ${forecast.recommendedReorder}`);
  console.log();

  // 16. Print each forecast month array entry
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("  FORECAST ARRAY (6-month horizon)");
  console.log("═══════════════════════════════════════════════════════════════════");
  for (const m of forecast.forecast) {
    console.log(`  ${m.monthName.padEnd(10)} ${m.month}  qty=${String(m.qty).padEnd(6)}  baseline=${String(m.baseline).padEnd(6)}  seas=${String(m.seasonalityFactor).padEnd(6)}  daily=${m.dailyRate}  PI=[${m.predictionIntervalLow}–${m.predictionIntervalHigh}]`);
  }

  console.log("\n✅ Done.");
}

main().catch((err) => {
  console.error("❌ Failed:", err?.message ?? err);
  process.exit(1);
});
