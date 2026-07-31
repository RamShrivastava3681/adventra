// Seed script: creates 3 demo products + 12 months of stock movements so the
// Demand Forecast page has real data to analyze.
//
// Run with:  cd backend && npx tsx scripts/seed-forecast-demo.ts
//
// Data goes to the REAL DynamoDB table configured in backend/.env, owned by the
// admin user (ADMIN_EMAIL). Idempotent: existing products/movements are reused,
// so running it twice will not create duplicates.

import * as Product from "../src/models/product.js";
import * as StockMovement from "../src/models/stock-movement.js";
import * as db from "../src/dynamodb.js";
import { config } from "../src/config.js";
import {
  bucketMovementsByMonth,
  forecastSKU,
  computeVelocityByCategory,
  type MovementInput,
} from "../src/lib/forecast-engine.js";

const log = (s: string) => console.log(s);

// ---------------------------------------------------------------------------
// Demo dataset — three different demand behaviors
// ---------------------------------------------------------------------------
type SeedProduct = {
  sku: string;
  name: string;
  description: string;
  category: string;
  unitPrice: number;
  unitCost: number;
  reorderLevel: number;
  maxStock: number;
  leadTimeDays: number;
  /** 12 monthly sales values, oldest → newest, aligned to the last 12 months */
  sales: number[];
  /** stock placed on the very first month (opening balance) */
  openingStock: number;
  /** monthly restock = that month's sales + this buffer */
  restockBuffer: number;
};

const SEEDS: SeedProduct[] = [
  {
    // 1) GROWING product — steady month-over-month growth
    sku: "TB-1001",
    name: "Trekking Backpack",
    description: "45L trekking backpack with integrated rain cover",
    category: "Trekking Gear",
    unitPrice: 59.99,
    unitCost: 25,
    reorderLevel: 20,
    maxStock: 120,
    leadTimeDays: 14,
    sales: [12, 14, 15, 17, 18, 20, 22, 24, 26, 29, 33, 36],
    openingStock: 10,
    restockBuffer: 3,
  },
  {
    // 2) SEASONAL product — strong summer peak, quiet winter
    sku: "HP-2001",
    name: "Hiking Poles",
    description: "Pair of lightweight carbon hiking poles",
    category: "Trekking Gear",
    unitPrice: 39.99,
    unitCost: 16,
    reorderLevel: 15,
    maxStock: 100,
    leadTimeDays: 21,
    sales: [40, 32, 18, 10, 7, 5, 6, 10, 18, 30, 38, 42],
    openingStock: 8,
    restockBuffer: 0,
  },
  {
    // 3) FLAT / SLOW product — low, stable sales
    sku: "SP-3001",
    name: "Sleeping Pad",
    description: "Self-inflating camping sleeping pad",
    category: "Trekking Gear",
    unitPrice: 29.99,
    unitCost: 12,
    reorderLevel: 8,
    maxStock: 60,
    leadTimeDays: 30,
    sales: [6, 5, 6, 7, 6, 5, 6, 7, 6, 5, 6, 7],
    openingStock: 10,
    restockBuffer: 2,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const pad2 = (n: number) => String(n).padStart(2, "0");

/** The last 12 month keys, oldest first (relative to today). */
function last12MonthKeys(): string[] {
  const now = new Date();
  const keys: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
  }
  return keys;
}

function monthKeyToDate(key: string, day: number): string {
  return `${key}-${pad2(day)}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  // Safety guards: this script writes to the REAL DynamoDB table.
  const isDryRun = process.argv.includes("--dry-run");
  const hasConfirmed = process.argv.includes("--yes");
  if (!isDryRun && !hasConfirmed) {
    log(`❌ Refusing to write to table "${config.dynamodb.tableName}" without confirmation.`);
    log("   Re-run with:  --yes");
    log("   To preview without writing anything, use:            --dry-run");
    process.exit(1);
  }
  if (isDryRun) log("▶ DRY RUN — no data will be written.\n");

  const adminEmail = config.admin.email;
  if (!adminEmail) {
    log("❌ No ADMIN_EMAIL set in backend/.env — cannot resolve the owner account.");
    process.exit(1);
  }

  const users = (await db.scanByType("User")) as any[];
  const owner = users.find((u) => u.email === adminEmail);
  if (!owner) {
    log(`❌ User "${adminEmail}" not found. Create it by starting the backend once, or set ADMIN_EMAIL correctly.`);
    process.exit(1);
  }
  const clientId = owner.id;
  log(`→ Owner account: ${owner.email} (id ${clientId})`);

  const monthKeys = last12MonthKeys();
  log(`→ 12-month window: ${monthKeys[0]} … ${monthKeys[11]} (relative to today)`);

  if (isDryRun) {
    const dryProducts = await Product.list(clientId);
    const dryMovements = await StockMovement.list(clientId);
    for (const seed of SEEDS) {
      const existing = dryProducts.find((p: any) => p.sku === seed.sku);
      const m = dryMovements.filter((x) => x.productId === existing?.id);
      log(`  · ${seed.sku} ${seed.name}: product ${existing ? "exists (reuse)" : "to create"} · ${m.length}/${1 + monthKeys.length * 2} movements ${m.length >= 1 + monthKeys.length * 2 ? "→ skip" : "→ create"}`);
    }
    log("\n(End of dry run — nothing written.)");
    process.exit(0);
  }

  // Existing data (idempotency)
  const existingProducts = await Product.list(clientId);
  const existingMovements = await StockMovement.list(clientId);

  const createdProducts: Array<{ sku: string; name: string; id: string; category: string; leadTimeDays: number; reused: boolean }> = [];
  const movementCount = { in: 0, out: 0, skipped: 0 };

  for (const seed of SEEDS) {
    // --- Product (create or reuse) ---
    let product = existingProducts.find((p: any) => p.sku === seed.sku) as any;
    let reused = true;
    if (!product) {
      product = await Product.create({
        clientId,
        sku: seed.sku,
        name: seed.name,
        description: seed.description,
        category: seed.category,
        unitPrice: seed.unitPrice,
        unitCost: seed.unitCost,
        reorderLevel: seed.reorderLevel,
        maxStock: seed.maxStock,
        leadTimeDays: seed.leadTimeDays,
        status: "active",
        season: "all",
      });
      reused = false;
    }
    createdProducts.push({
      sku: product.sku,
      name: product.name,
      id: product.id,
      category: product.category ?? seed.category,
      leadTimeDays: product.leadTimeDays ?? seed.leadTimeDays,
      reused,
    });

    // --- Movements (idempotent: fully seeded products are skipped; partial ones self-heal) ---
    const productMovements = existingMovements.filter((m) => m.productId === product.id);
    const expectedMovements = 1 + monthKeys.length * 2; // opening + 12 restocks + 12 sales = 25
    if (productMovements.length >= expectedMovements) {
      log(`  · ${seed.sku} ${seed.name}: already fully seeded (${productMovements.length} movements) → skipped (no duplicates)`);
      movementCount.skipped += 1;
      continue;
    }
    if (productMovements.length > 0) {
      // A previous run was interrupted — remove its partial movements before re-seeding
      log(`  · ${seed.sku} ${seed.name}: found ${productMovements.length}/${expectedMovements} movements (partial run) → removing and re-seeding`);
      const removedIn = productMovements.filter((m) => m.direction === "in").length;
      const removedOut = productMovements.filter((m) => m.direction === "out").length;
      await Promise.all(productMovements.map((m) => StockMovement.remove(m.id)));
      movementCount.in = Math.max(0, movementCount.in - removedIn);
      movementCount.out = Math.max(0, movementCount.out - removedOut);
    }

    // Opening stock on the first month
    await StockMovement.create({
      clientId,
      productId: product.id,
      direction: "in",
      itemName: seed.name,
      sku: seed.sku,
      quantity: seed.openingStock,
      unit: "unit",
      unitCost: seed.unitCost,
      notes: "Opening stock",
      movementDate: monthKeyToDate(monthKeys[0], 1),
    });
    movementCount.in += 1;

    // One monthly restock + one monthly sale per month (all awaited)
    const writes: Promise<unknown>[] = [];
    monthKeys.forEach((key, i) => {
      const salesQty = seed.sales[i];
      const restockQty = salesQty + seed.restockBuffer;
      // restock arrives early in the month
      writes.push(StockMovement.create({
        clientId,
        productId: product.id,
        direction: "in",
        itemName: seed.name,
        sku: seed.sku,
        quantity: restockQty,
        unit: "unit",
        unitCost: seed.unitCost,
        notes: `Monthly restock ${key}`,
        movementDate: monthKeyToDate(key, 5),
      }));
      // sales spread through the month
      writes.push(StockMovement.create({
        clientId,
        productId: product.id,
        direction: "out",
        itemName: seed.name,
        sku: seed.sku,
        quantity: salesQty,
        unit: "unit",
        unitCost: seed.unitCost,
        notes: `Monthly sales ${key}`,
        movementDate: monthKeyToDate(key, 15),
      }));
    });
    await Promise.all(writes);
    movementCount.in += monthKeys.length;
    movementCount.out += monthKeys.length;

    log(`  ✓ ${seed.sku} ${seed.name}: product ${reused ? "reused" : "created"} + 12 months of movements`);
  }

  log(`→ Movements written: ${movementCount.in} in, ${movementCount.out} out, ${movementCount.skipped} products already seeded`);

  // -------------------------------------------------------------------------
  // Verification — run the real forecast engine exactly like the page does
  // -------------------------------------------------------------------------
  log("\n=== FORECAST PREVIEW (what the page will show) ===");
  const allMovements = await StockMovement.list(clientId);
  const byProduct = new Map<string, MovementInput[]>();
  for (const m of allMovements) {
    if (!m.productId) continue;
    const arr = byProduct.get(m.productId) ?? [];
    arr.push({ movement_date: m.movementDate, quantity: m.quantity, direction: m.direction });
    byProduct.set(m.productId, arr);
  }

  const rows = createdProducts
    .map((cp) => {
      const moves = byProduct.get(cp.id) ?? [];
      let stock = 0;
      for (const m of moves) stock += (m.direction === "in" ? 1 : -1) * Number(m.quantity);
      const history = bucketMovementsByMonth(moves, 12);
      const forecast = forecastSKU(history, stock, cp.leadTimeDays, 6);
      return { product: cp, stock, forecast };
    })
    .filter((r) => r.forecast.history.length > 0);

  // category-based velocity (like the page does)
  const velInputs = rows.map((r) => ({
    productId: r.product.id,
    category: r.product.category,
    recent3MonthAvg: r.forecast.calculationBreakdown.momentum.recent3MonthAvg,
  }));
  const velocityMap = computeVelocityByCategory(velInputs);

  for (const r of rows) {
    const f = r.forecast;
    log(JSON.stringify({
      sku: r.product.sku,
      name: r.product.name,
      stockOnHand: r.stock,
      nextMonthForecast: f.finalForecast,
      dailyForecast: f.dailyForecast,
      trend: f.trend,
      trendStrength: f.trendStrength,
      trendDirection: f.trendDirection,
      seasonalityFactor: f.seasonalityFactor,
      daysOfCover: f.daysOfCover,
      recommendedReorder: f.recommendedReorder,
      momentum: f.momentumTag,
      velocity: velocityMap.get(r.product.id),
      stockoutRisk: f.stockoutRisk,
      overstockRisk: f.overstockRisk,
      estimatedStockoutDate: f.estimatedStockoutDate,
      urgency: f.stockoutUrgency,
      forecastMonths: f.forecast.map((m) => `${m.monthName}:${m.qty}`).join(", "),
    }, null, 2));
  }

  log("\n✅ Seed complete. Open the Demand Forecast page (/app/forecast) to see these products.");
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
