import { bucketMovementsByMonth, forecastSKU } from "../src/lib/forecast-engine";

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
  // Aug 2026
  { movement_date: "2026-08-06", quantity: 2, direction: "out" },
  { movement_date: "2026-08-10", quantity: 1, direction: "out" },
  { movement_date: "2026-08-11", quantity: 1, direction: "out" },
  { movement_date: "2026-08-12", quantity: 2, direction: "out" },
  { movement_date: "2026-08-19", quantity: 3, direction: "out" },
  { movement_date: "2026-08-22", quantity: 1, direction: "out" },
  { movement_date: "2026-08-26", quantity: 3, direction: "out" },
];

// Compute stock
let stock = 0;
for (const m of movements) stock += (m.direction === "in" ? 1 : -1) * Number(m.quantity);
console.log("Stock:", stock);

// Forecast with targetMonth = 2026-04
const history = bucketMovementsByMonth(movements, 12, undefined, "2026-04");
const f = forecastSKU(history, stock, 14, 6, {
  config: { safetyStockDays: 30 },
  targetMonth: "2026-04",
  movements,
});

console.log("\n=== FORECAST (Apr-Sep 2026) ===");
for (const m of f.forecast) {
  console.log(`${m.month} (${m.monthName}): qty=${m.qty}, baseline=${m.baseline}, seas=${m.seasonalityFactor}`);
}

console.log("\n=== CALCULATION BREAKDOWN ===");
for (const md of f.calculationBreakdown.monthlyDetail) {
  console.log(`${md.monthName}: trendContrib=${md.trendContribution}, avgPlusTrend=${md.avgPlusTrend}, seas=${md.seasonalityFactor}, baseline=${md.baseline}, final=${md.finalForecast}`);
}
