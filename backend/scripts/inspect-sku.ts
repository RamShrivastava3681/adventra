// One-off read-only inspector: dumps every stock movement for a SKU (the raw
// digits behind the reorder calc) + monthly aggregation + engine result.
//
// Usage: cd backend && npx tsx scripts/inspect-sku.ts [SKU]
import * as db from "../src/dynamodb.js";
import * as Product from "../src/models/product.js";
import * as StockMovement from "../src/models/stock-movement.js";
import { config } from "../src/config.js";
import {
  bucketMovementsByMonth,
  currentMonthBucket,
  forecastSKU,
} from "../src/lib/forecast-engine.js";

const targetSku = process.argv[2] ?? "TS-RC-001";

async function main() {
  const adminEmail = config.admin.email;
  if (!adminEmail) throw new Error("No ADMIN_EMAIL in .env");
  const users = (await db.scanByType("User")) as any[];
  const owner = users.find((u) => u.email === adminEmail);
  if (!owner) throw new Error(`Admin user ${adminEmail} not found`);
  const clientId = owner.id;

  const products = (await Product.list(clientId)) as any[];
  const product = products.find((p) => (p.sku ?? "").toUpperCase() === targetSku.toUpperCase());
  if (!product) {
    console.log(`❌ SKU ${targetSku} not found. Existing SKUs:`);
    for (const p of products) console.log(`   · ${p.sku} — ${p.name}`);
    return;
  }

  const moves = (await StockMovement.list(clientId))
    .filter((m) => m.productId === product.id)
    .sort((a, b) => (a.movementDate ?? "").localeCompare(b.movementDate ?? ""));

  let stock = 0;
  for (const m of moves) stock += (m.direction === "in" ? 1 : -1) * Number(m.quantity);

  console.log("==============================================");
  console.log(`SKU: ${product.sku}  ·  ${product.name}`);
  console.log(`Lead time: ${product.leadTimeDays ?? 14}d  ·  Safety stock: ${product.safetyStockDays ?? 30}d`);
  console.log("----------------------------------------------");
  console.log(`RAW STOCK MOVEMENTS (${moves.length} total, sorted by date):`);
  for (const m of moves) {
    console.log(
      `   ${m.movementDate}  ${m.direction === "in" ? "IN " : "OUT"}  qty=${m.quantity}` +
        `  ${m.notes ? `(${m.notes})` : ""}${m.invoiceId ? " [invoice]" : ""}${m.purchaseInvoiceId ? " [purchase]" : ""}`
    );
  }
  console.log("----------------------------------------------");
  console.log("MONTHLY AGGREGATION (out only, via bucketMovementsByMonth):");
  const formatted = moves.map((m: any) => ({
    movement_date: m.movementDate ?? m.movement_date,
    quantity: m.quantity,
    direction: m.direction,
  }));
  const history = bucketMovementsByMonth(formatted, 12);
  const currentMonth = currentMonthBucket(formatted);
  for (const h of history) {
    console.log(`   ${h.month}: out qty=${h.qty}${h.rawQty !== undefined && h.rawQty !== h.qty ? ` (raw ${h.rawQty})` : ""}`);
  }
  console.log(`   ${currentMonth.month} (current partial): out=${currentMonth.rawQty ?? 0} to date`);
  console.log("----------------------------------------------");
  const leadTimeDays = product.leadTimeDays ?? 14;
  const f = forecastSKU(history, stock, leadTimeDays, 6, {
    config: { safetyStockDays: product.safetyStockDays ?? 30 },
    currentMonth,
  });
  const r = f.calculationBreakdown.reorder;
  console.log(`Stock on hand: ${stock}  ·  Inventory position: ${f.inventoryPosition}`);
  console.log(`REORDER BREAKDOWN:`);
  console.log(`   Last 3 completed months picked by engine: ${r.lastThreeMonths.map((m) => `${m.monthKey} (${m.monthName}) demand=${m.demand} days=${m.days}`).join("  |  ")}`);
  console.log(`   totalDemand=${r.totalDemand}  totalDays=${r.totalDays}  dailyAvg=${r.dailyAverage}`);
  console.log(`   requiredStock=${r.requiredStock}  →  rawReorder=${r.recommendedBeforeCaps}  →  FINAL=${r.finalRecommended}`);
  console.log("==============================================");
}

main().catch((err) => {
  console.error("❌ Inspect failed:", err);
  process.exit(1);
});
