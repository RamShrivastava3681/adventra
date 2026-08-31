#!/usr/bin/env tsx
// Delete all stock movements for one or more SKUs and recompute forecasts.
//
// Run with:  cd backend && npx tsx scripts/delete-movements.ts <SKU> [SKU...] [--dry-run] [--yes]
//
// Examples:
//   npx tsx scripts/delete-movements.ts EH-500 EH-900 --yes
//   npx tsx scripts/delete-movements.ts EH-500 --dry-run

import * as Product from "../src/models/product.js";
import * as StockMovement from "../src/models/stock-movement.js";
import * as db from "../src/dynamodb.js";
import { config } from "../src/config.js";

const log = (s: string) => console.log(s);

async function main() {
  const isDryRun = process.argv.includes("--dry-run");
  const hasConfirmed = process.argv.includes("--yes");

  const skus = process.argv
    .slice(2)
    .filter((a) => !a.startsWith("--"))
    .map((s) => s.toUpperCase());

  if (skus.length === 0) {
    log("❌ No SKUs specified.");
    log("Usage: npx tsx scripts/delete-movements.ts <SKU> [SKU...] [--dry-run] [--yes]");
    process.exit(1);
  }

  if (!isDryRun && !hasConfirmed) {
    log(`❌ Refusing to delete from table "${config.dynamodb.tableName}" without confirmation.`);
    log("   Re-run with:  --yes");
    log("   To preview, use:  --dry-run");
    process.exit(1);
  }

  if (isDryRun) log("▶ DRY RUN — nothing will be deleted.\n");

  const adminEmail = config.admin.email;
  if (!adminEmail) {
    log("❌ No ADMIN_EMAIL set in backend/.env");
    process.exit(1);
  }

  const users = (await db.scanByType("User")) as any[];
  const owner = users.find((u) => u.email === adminEmail);
  if (!owner) {
    log(`❌ User "${adminEmail}" not found.`);
    process.exit(1);
  }
  const clientId = owner.id;
  log(`→ Owner: ${owner.email} (id ${clientId})`);
  log(`→ Table: ${config.dynamodb.tableName}\n`);

  const products = (await Product.list(clientId)) as any[];
  const allMovements = isDryRun ? [] : await StockMovement.list(clientId);

  for (const sku of skus) {
    const product = products.find((p: any) => (p.sku ?? "").toUpperCase() === sku);
    if (!product) {
      log(`⚠ SKU ${sku} not found in catalogue — skipping.\n`);
      continue;
    }

    const movements = isDryRun
      ? (await StockMovement.list(clientId)).filter((m: any) => m.productId === product.id)
      : allMovements.filter((m: any) => m.productId === product.id);

    const confirmed = movements.filter((m: any) => m.status === "confirmed");
    const balance = confirmed.reduce(
      (sum: number, m: any) => sum + (m.direction === "in" ? m.quantity : -m.quantity),
      0
    );

    log(`→ ${product.sku} — ${product.name}`);
    log(`   Movements: ${movements.length} total (${confirmed.length} confirmed)`);
    log(`   Current balance: ${balance}`);

    if (isDryRun) {
      log(`   Would delete ${movements.length} movement(s).\n`);
      continue;
    }

    const deleted = await StockMovement.removeByProduct(clientId, product.id);
    log(`   ✅ Deleted ${deleted} movement(s). New balance: 0\n`);
  }

  if (!isDryRun) {
    // Recompute forecasts
    const { recomputeAll } = await import("../src/services/forecast-service.js");
    try {
      const res = await recomputeAll(clientId);
      log(`→ Forecast recomputed for ${res.count} product(s) (computed ${res.computedDate}).`);
    } catch (err: any) {
      log(`  ⚠ Forecast recompute failed: ${err?.message ?? err}`);
    }
  }

  log(`\n✅ Done.`);
}

main().catch((err) => {
  console.error("❌ Failed:", err);
  process.exit(1);
});
