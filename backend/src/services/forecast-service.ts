import * as Product from "../models/product.js";
import * as StockMovement from "../models/stock-movement.js";
import * as ForecastVariable from "../models/forecast-variable.js";
import {
  bucketMovementsByMonth,
  currentMonthBucket,
  forecastSKU,
  computeVelocityByCategory,
  isDemandMovement,
  type CategoryVelocityInput,
  type ForecastResult,
  type VelocityTag,
} from "../lib/forecast-engine.js";

export type ForecastSnapshot = {
  productId: string;
  productSku: string | null;
  productName: string | null;
  leadTimeDays: number;
  forecast: ForecastResult;
  velocityTag: VelocityTag;
};


/**
 * Computes forecasts for all active products of a client and persists them.
 * Runs exactly the same logic as the frontend but on the server.
 *
 * IMPORTANT: Forecast demand is based ONLY on actual customer demand movements.
 * Stock transfers, GRN, and other internal stock movements are excluded.
 */
export async function recomputeAll(clientId: string): Promise<{
  computedDate: string;
  count: number;
  snapshots: ForecastSnapshot[];
}> {
  const [products, rawMovements] = await Promise.all([
    Product.list(clientId),
    StockMovement.list(clientId),
  ]);

  // Only CONFIRMED movements reflect live stock (drafts/cancelled don't).
  // list() already normalizes legacy records to "confirmed".
  const movements = rawMovements.filter((m: any) => m.status === "confirmed");

  const activeProducts = products.filter(
    (p: any) => p.status === "active"
  );

  // Group movements by product
  const byProduct = new Map<string, any[]>();
  for (const m of movements) {
    if (!m.productId) continue;
    const arr = byProduct.get(m.productId) ?? [];
    arr.push(m);
    byProduct.set(m.productId, arr);
  }

  const snapshots: ForecastSnapshot[] = [];

  for (const p of activeProducts) {
    const productId = p.id;
    const moves = byProduct.get(productId) ?? [];

    // Calculate current stock (Total Company Stock) — ALL confirmed movements count
    let stock = 0;
    for (const m of moves) {
      stock += (m.direction === "in" ? 1 : -1) * Number(m.quantity);
    }

    // For forecast DEMAND, only use demand-type movements
    const demandMoves = moves.filter(isDemandMovement);

    // Convert movements to the format bucketMovementsByMonth expects.
    // Include dispatchType and status so the engine's isDemandMovement can
    // properly classify sales vs returns vs other movement types.
    const formattedMoves = demandMoves.map((m: any) => ({
      movement_date: m.movementDate ?? m.movement_date,
      quantity: m.quantity,
      direction: m.direction,
      dispatchType: m.dispatchType ?? null,
      reason: m.reason ?? null,
      status: m.status,
    }));

    // Anchor the 12-month history to NEXT month so the current (partial)
    // month is excluded from the baseline — matches the frontend default.
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const targetMonth = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}`;

    const history = bucketMovementsByMonth(formattedMoves, 12, undefined, targetMonth);
    const currentMonth = currentMonthBucket(formattedMoves);
    const leadTimeDays = p.leadTimeDays ?? 14;
    const f = forecastSKU(history, stock, leadTimeDays, 6, {
      config: { safetyStockDays: p.safetyStockDays ?? 30 },
      currentMonth,
      movements: formattedMoves,
    });

    snapshots.push({
      productId,
      productSku: p.sku ?? null,
      productName: p.name ?? null,
      leadTimeDays,
      forecast: f,
      velocityTag: "dead" as VelocityTag,
    });
  }

  // 2. Compute category-based velocity for all SKUs
  const velInputs: CategoryVelocityInput[] = snapshots.map((s) => ({
    productId: s.productId,
    category: null, // will look up from product
    recent3MonthAvg: s.forecast.calculationBreakdown.momentum.recent3MonthAvg,
  }));
  // Get categories from products
  const productMap = new Map(activeProducts.map((p: any) => [p.id, p]));
  for (const input of velInputs) {
    const prod = productMap.get(input.productId);
    input.category = prod?.category ?? null;
  }

  const velocityMap = computeVelocityByCategory(velInputs);

  // Apply velocity tags
  for (const s of snapshots) {
    const vt = velocityMap.get(s.productId);
    if (vt) {
      s.velocityTag = vt;
      // Also persist the real tag inside forecastJson — the engine hardcodes
      // velocityTag to "dead" and the page reads it from there, so without this
      // every product would show as dead no matter how much it sells.
      s.forecast.velocityTag = vt;
    }
  }

  // 3. Persist each forecast to DynamoDB
  const computedDate = new Date().toISOString().slice(0, 10);

  // DynamoDB rejects non-finite numbers (e.g. daysOfCover = Infinity for a
  // product with no sales history). Map them to null before persisting so one
  // quiet SKU can never crash the whole client's recompute.
  const safeNumber = (n: number | null | undefined): number | null =>
    typeof n === "number" && Number.isFinite(n) ? n : null;

  let persisted = 0;
  const failures: string[] = [];

  for (const s of snapshots) {
    const f = s.forecast;
    try {
      await ForecastVariable.upsert({
        clientId,
        productId: s.productId,
        productSku: s.productSku,
        productName: s.productName,
        computedDate,
        forecastJson: JSON.stringify(f),
        finalForecast: safeNumber(f.finalForecast),
        dailyForecast: safeNumber(f.dailyForecast),
        daysOfCover: safeNumber(f.daysOfCover),
        recommendedReorder: safeNumber(f.recommendedReorder),
        inventoryPosition: safeNumber(f.inventoryPosition),
        trendDirection: f.trendDirection,
        momentumTag: f.momentumTag,
        velocityTag: s.velocityTag,
        stockoutRisk: f.stockoutRisk,
        estimatedStockoutDate: f.estimatedStockoutDate,
        reorderByDate: f.reorderByDate,
        nextRefillDate: f.nextRefillDate,
        stockoutUrgency: f.stockoutUrgency,
        avgMonthly: safeNumber(f.avgMonthly),
        currentMonthBaseForecast: safeNumber(f.currentMonthBaseForecast),
        nextMonthBaseForecast: safeNumber(f.nextMonthBaseForecast),
        adjustedNextForecast: safeNumber(f.adjustedNextForecast),
        adjustmentFactor: safeNumber(f.adjustmentFactor),
        adjustmentReason: f.adjustmentReason ?? null,
      });
      persisted += 1;
    } catch (err: any) {
      // Never let a single SKU's persistence failure abort the whole client.
      console.error(
        `  ⚠ Failed to persist forecast for ${s.productSku ?? s.productId}:`,
        err?.message ?? err
      );
      failures.push(s.productSku ?? s.productId);
    }
  }

  // If every write failed (e.g. DynamoDB unreachable), fail loudly so the
  // startup/recompute caller reports the client as failed instead of
  // silently reporting "succeeded" with zero snapshots persisted.
  if (snapshots.length > 0 && persisted === 0) {
    throw new Error(
      `All ${snapshots.length} forecast(s) failed to persist (e.g. ${failures[0] ?? "unknown"}).`
    );
  }

  return {
    computedDate,
    count: persisted,
    snapshots,
  };
}

/**
 * Checks if the forecast should be recomputed (outdated or never computed)
 * and triggers a recompute if needed.
 */
export async function ensureFresh(clientId: string): Promise<boolean> {
  const latestDate = await ForecastVariable.getLatestComputedDate(clientId);
  const today = new Date().toISOString().slice(0, 10);

  const movements = await StockMovement.list(clientId);
  const latestMovementDate = movements
    .filter((m: any) => m.status === "confirmed")
    .map((m: any) => String(m.movementDate ?? m.movement_date ?? ""))
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  // Recompute if: no forecast exists, the saved snapshot is older than today,
  // or there are confirmed movements newer than the latest saved snapshot.
  if (
    !latestDate ||
    latestDate < today ||
    (latestMovementDate && latestDate < latestMovementDate)
  ) {
    await recomputeAll(clientId);
    return true; // recomputed
  }
  return false; // already fresh
}
