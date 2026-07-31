import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export interface ForecastVariable {
  pk: string; sk: string;
  gsi1pk: string; gsi1sk: string;
  gsi2pk: string; gsi2sk: string;
  entityType: "ForecastVariable";
  id: string;
  clientId: string;
  productId: string;
  productSku: string | null;
  productName: string | null;

  /** ISO date string of when this snapshot was computed (e.g. "2026-07-31") */
  computedDate: string;

  /** The forecast output — stored as serialized JSON */
  forecastJson: string;

  /** Selected top-level fields for quick queries without deserializing.
   *  Numerics are nullable because the engine can produce non-finite values
   *  (e.g. daysOfCover = Infinity for products with no sales history), which
   *  are persisted as null. */
  finalForecast: number | null;
  dailyForecast: number | null;
  daysOfCover: number | null;
  recommendedReorder: number | null;
  inventoryPosition: number | null;
  trendDirection: string;
  momentumTag: string;
  stockoutRisk: string;
  estimatedStockoutDate: string | null;
  reorderByDate: string | null;
  nextRefillDate: string;
  stockoutUrgency: string;
  avgMonthly: number | null;

  createdAt: string;
  updatedAt: string;
}

export async function listByClient(clientId: string): Promise<ForecastVariable[]> {
  const { items } = await db.queryByGSI1(clientId, {
    entityType: "ForecastVariable",
    limit: 500,
    reverse: true,
  });
  return items as ForecastVariable[];
}

export async function getByProduct(
  clientId: string,
  productId: string
): Promise<ForecastVariable | null> {
  const all = await listByClient(clientId);
  return all.find((f) => f.productId === productId) ?? null;
}

export async function upsert(
  data: Omit<ForecastVariable, "pk" | "sk" | "gsi1pk" | "gsi1sk" | "gsi2pk" | "gsi2sk" | "entityType" | "id" | "createdAt" | "updatedAt"> & { id?: string }
): Promise<ForecastVariable> {
  const existing = await getByProduct(data.clientId, data.productId);
  const id = existing?.id ?? data.id ?? uuid();
  const now = db.nowISO();

  const item: ForecastVariable = {
    pk: `FORECAST_VARIABLE#${id}`,
    sk: `FORECAST_VARIABLE#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`,
    gsi1sk: `ForecastVariable#${data.computedDate}T${now}`,
    gsi2pk: "ForecastVariable",
    gsi2sk: `ForecastVariable#${id}`,
    entityType: "ForecastVariable",
    id,
    clientId: data.clientId,
    productId: data.productId,
    productSku: data.productSku ?? null,
    productName: data.productName ?? null,
    computedDate: data.computedDate,
    forecastJson: data.forecastJson,
    finalForecast: data.finalForecast,
    dailyForecast: data.dailyForecast,
    daysOfCover: data.daysOfCover,
    recommendedReorder: data.recommendedReorder,
    inventoryPosition: data.inventoryPosition,
    trendDirection: data.trendDirection,
    momentumTag: data.momentumTag,
    stockoutRisk: data.stockoutRisk,
    estimatedStockoutDate: data.estimatedStockoutDate ?? null,
    reorderByDate: data.reorderByDate ?? null,
    nextRefillDate: data.nextRefillDate,
    stockoutUrgency: data.stockoutUrgency,
    avgMonthly: data.avgMonthly,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await db.putItem(item);
  return item;
}

export async function remove(id: string) {
  return db.deleteItem(`FORECAST_VARIABLE#${id}`);
}

export async function removeAllForClient(clientId: string) {
  const items = await listByClient(clientId);
  for (const item of items) {
    await remove(item.id);
  }
}

/** Get the latest computed date across all forecast variables for a client */
export async function getLatestComputedDate(clientId: string): Promise<string | null> {
  const items = await listByClient(clientId);
  if (items.length === 0) return null;
  // Sort by computedDate descending
  items.sort((a, b) => b.computedDate.localeCompare(a.computedDate));
  return items[0].computedDate;
}