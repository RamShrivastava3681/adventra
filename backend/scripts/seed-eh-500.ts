#!/usr/bin/env tsx
// Seed script: creates confirmed inventory movements for a SKU from an Excel
// spreadsheet. Product is created automatically if it doesn't exist.
//
// Run with:
//   cd backend && npx tsx scripts/seed-eh-500.ts <SKU> <path-to-xlsx> [--dry-run] [--yes]
//
// Examples:
//   npx tsx scripts/seed-eh-500.ts EH-500 "C:/Users/ramsh/Desktop/eh-500.xlsx" --yes
//   npx tsx scripts/seed-eh-500.ts EH-900 "C:/Users/ramsh/Desktop/eh-900.xlsx" --dry-run
//
// Supported Excel formats:
//   - Columns: date, stock in, stock out  (both stock-in and stock-out)
//   - Columns: date, stock out            (stock-out only)
//
// Negative stock-out values are treated as customer returns (stock-in).
// Rows with no data in any quantity column are skipped.

import * as Product from "../src/models/product.js";
import * as StockMovement from "../src/models/stock-movement.js";
import * as db from "../src/dynamodb.js";
import { config } from "../src/config.js";
import XLSX from "xlsx";

const log = (s: string) => console.log(s);

// ---------------------------------------------------------------------------
// Excel parsing — auto-detects columns
// ---------------------------------------------------------------------------
type ParsedRow = { date: string; stockIn: number; stockOut: number };

function parseExcel(filePath: string): ParsedRow[] {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];

  // Read as raw arrays so we get ALL columns from the header row, even if
  // the first data row has nulls in some columns (xlsx drops those columns
  // when using keyed mode).
  const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { header: 1 });
  const headerRow = (rawRows[0] ?? []) as string[];
  const dataRows = rawRows.slice(1);

  // Map column indices by header name (case-insensitive)
  const colIdx: Record<string, number> = {};
  headerRow.forEach((h: string, i: number) => {
    const key = String(h).toLowerCase().trim().replace(/\s+/g, "");
    if (key.includes("date")) colIdx.date = i;
    if (key.includes("stockin") || key.includes("stock-in")) colIdx.stockIn = i;
    if (key.includes("stockout") || key.includes("stock-out")) colIdx.stockOut = i;
  });

  const hasStockIn = colIdx.stockIn !== undefined;
  const hasStockOut = colIdx.stockOut !== undefined;
  const hasDate = colIdx.date !== undefined;

  const monthToNum: Record<string, string> = {
    Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
    Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
  };
  const monthIdx: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };

  let prevMi = -1;
  let year = 2025;
  const result: ParsedRow[] = [];

  for (const row of dataRows) {
    if (!hasDate) continue;
    const rawDate = row[colIdx.date];
    if (!rawDate) continue;
    const parts = String(rawDate).split("-");
    if (parts.length !== 2) continue;

    const day = parts[0].trim();
    const monStr = parts[1].trim();
    const mi = monthIdx[monStr];
    if (mi === undefined) continue;

    if (prevMi !== -1 && mi < prevMi && prevMi >= 8) year++;
    prevMi = mi;

    const dateStr = `${year}-${monthToNum[monStr]}-${day.padStart(2, "0")}`;
    const stockIn = hasStockIn ? (Number(row[colIdx.stockIn]) || 0) : 0;
    const stockOut = hasStockOut ? (Number(row[colIdx.stockOut]) || 0) : 0;

    // Skip rows with no data at all
    if (!hasStockIn || !row[colIdx.stockIn]) {
      if (!hasStockOut || !row[colIdx.stockOut]) continue;
    }

    result.push({ date: dateStr, stockIn, stockOut });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const isDryRun = process.argv.includes("--dry-run");
  const hasConfirmed = process.argv.includes("--yes");

  // Parse CLI arguments: SKU and file path
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const targetSku = (positional[0] ?? "EH-500").toUpperCase();
  const filePath = positional[1];

  if (!filePath) {
    log("❌ Missing Excel file path.");
    log("Usage: npx tsx scripts/seed-eh-500.ts <SKU> <path-to-xlsx> [--dry-run] [--yes]");
    process.exit(1);
  }

  if (!isDryRun && !hasConfirmed) {
    log(`❌ Refusing to write to table "${config.dynamodb.tableName}" without confirmation.`);
    log("   Re-run with:  --yes");
    log("   To preview, use:  --dry-run");
    process.exit(1);
  }
  if (isDryRun) log("▶ DRY RUN — no data will be written.\n");

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

  // --- Parse Excel ---
  const rows = parseExcel(filePath);
  log(`→ Parsed ${rows.length} rows from Excel (file: ${filePath})\n`);

  // --- Resolve or create product ---
  const products = (await Product.list(clientId)) as any[];
  let product = products.find((p: any) => (p.sku ?? "").toUpperCase() === targetSku);

  if (!product) {
    if (isDryRun) {
      log(`→ Product ${targetSku} not found — would create it (dry run).\n`);
      product = { id: "dry-run", sku: targetSku, name: targetSku, unitOfMeasure: "unit", unitCost: null };
    } else {
      log(`→ Creating product ${targetSku}...`);
      product = await Product.create({
        clientId,
        sku: targetSku,
        name: targetSku,
        description: `${targetSku} product`,
        category: "general",
        unitPrice: 0,
        unitCost: 0,
        reorderLevel: 0,
        maxStock: 0,
        leadTimeDays: 0,
        status: "active",
        season: "all",
      });
      log(`   Created: ${product.sku} — ${product.name} (id ${product.id})\n`);
    }
  } else {
    log(`→ Product found: ${product.sku} — ${product.name}\n`);
  }

  const unit = product.unitOfMeasure || "unit";
  const unitCost = Number(product.unitCost) > 0 ? Number(product.unitCost) : null;
  const createdBy = { id: owner.id, name: owner.email };

  // Existing movements for idempotency
  const existing = isDryRun
    ? []
    : (await StockMovement.list(clientId)).filter((m: any) => m.productId === product.id);

  // --- Build movement entries ---
  type MovementEntry = {
    date: string;
    reference: string;
    direction: "credit" | "debit";
    quantity: number;
    sourceType: "opening_stock" | "dispatch" | "goods_receipt";
    notes: string;
  };

  const movements: MovementEntry[] = [];
  let seq = 0;

  for (const row of rows) {
    // Stock in → credit
    if (row.stockIn > 0) {
      seq++;
      movements.push({
        date: row.date,
        reference: `GRN-${targetSku}-${String(seq).padStart(4, "0")}`,
        direction: "credit",
        quantity: row.stockIn,
        sourceType: "goods_receipt",
        notes: "Goods receipt",
      });
    }
    // Stock out → debit (positive) or credit (negative = return)
    if (row.stockOut !== 0) {
      seq++;
      const isReturn = row.stockOut < 0;
      movements.push({
        date: row.date,
        reference: `${isReturn ? "RET" : "DSP"}-${targetSku}-${String(seq).padStart(4, "0")}`,
        direction: isReturn ? "credit" : "debit",
        quantity: Math.abs(row.stockOut),
        sourceType: isReturn ? "goods_receipt" : "dispatch",
        notes: isReturn ? "Customer return" : "Dispatch",
      });
    }
  }

  const reasonOf = (s: string) => s === "goods_receipt" ? "Goods receipt" : s === "dispatch" ? "Dispatch" : "Opening stock";
  const linkedDocType = (s: string) => s === "dispatch" ? "Dispatch" : s === "goods_receipt" ? "GRN" : null;

  if (isDryRun) {
    log(`PLAN (${movements.length} movements):`);
    let balance = 0;
    for (const m of movements) {
      const dir = m.direction === "credit" ? "in" : "out";
      balance += dir === "in" ? m.quantity : -m.quantity;
      log(
        `  NEW   ${m.date}  ${dir === "in" ? "IN " : "OUT"}  qty=${m.quantity}` +
        `  ${m.reference}  (${reasonOf(m.sourceType)})`
      );
    }
    log(`\nExpected running balance: ${balance}`);
    log("(End of dry run.)");
    process.exit(0);
  }

  // --- Create movements ---
  const counts = { in: 0, out: 0, skipped: 0 };
  let balance = 0;
  const created: any[] = [];

  for (const m of movements) {
    const dir = m.direction === "credit" ? "in" : "out";
    const dup = existing.some(
      (e: any) => e.linkedDocumentNumber === m.reference && e.direction === dir && e.status === "confirmed"
    );
    if (dup) {
      counts.skipped++;
      log(`  · ${m.reference}: already exists → skipped`);
      continue;
    }
    const item = await StockMovement.create({
      clientId,
      productId: product.id,
      direction: dir,
      itemName: product.name,
      sku: product.sku,
      quantity: m.quantity,
      unit,
      unitCost,
      warehouse: "Main Warehouse",
      reason: reasonOf(m.sourceType),
      linkedDocumentType: linkedDocType(m.sourceType),
      linkedDocumentNumber: m.reference,
      status: "confirmed",
      notes: m.notes,
      movementDate: m.date,
      createdById: createdBy.id,
      createdByName: createdBy.name,
      confirmedById: createdBy.id,
      confirmedByName: createdBy.name,
      confirmedAt: db.nowISO(),
    });
    created.push(item);
    counts[dir] += 1;
    balance += dir === "in" ? m.quantity : -m.quantity;
    log(`  ✓ ${m.date}  ${dir === "in" ? "IN " : "OUT"}  qty=${m.quantity}  ${m.reference}  → ${item.movementNumber}`);
  }

  log(`\n→ Movements written: ${counts.in} in, ${counts.out} out, ${counts.skipped} skipped`);
  log(`→ Balance delta: ${balance}`);

  // Running balance
  const allForProduct = (await StockMovement.list(clientId)).filter(
    (m: any) => m.productId === product.id && m.status === "confirmed"
  );
  const running = allForProduct.reduce(
    (sum: number, m: any) => sum + (m.direction === "in" ? m.quantity : -m.quantity),
    0
  );
  log(`→ Running balance for ${product.sku}: ${running}`);

  // Recompute forecasts
  const { recomputeAll } = await import("../src/services/forecast-service.js");
  try {
    const res = await recomputeAll(clientId);
    log(`→ Forecast recomputed for ${res.count} product(s) (computed ${res.computedDate}).`);
  } catch (err: any) {
    log(`  ⚠ Forecast recompute failed: ${err?.message ?? err}`);
  }

  log(`\n✅ Done. ${created.length} movement(s) created for ${product.sku}.`);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
