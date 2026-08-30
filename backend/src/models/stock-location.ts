import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

/**
 * Stock Location — represents a physical or logical place where inventory is held.
 *
 * Types:
 *   central_warehouse   → Main warehouse
 *   marketplace_warehouse → Amazon FBA, Flipkart, etc.
 *   own_store           → Company retail stores
 *   transit             → Goods in transit between locations
 *   other_warehouse     → Any other storage location
 */

export type LocationType =
  | "central_warehouse"
  | "marketplace_warehouse"
  | "own_store"
  | "transit"
  | "other_warehouse";

export const LOCATION_TYPES: LocationType[] = [
  "central_warehouse",
  "marketplace_warehouse",
  "own_store",
  "transit",
  "other_warehouse",
];

export const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
  central_warehouse: "Central Warehouse",
  marketplace_warehouse: "Marketplace Warehouse",
  own_store: "Own Store",
  transit: "Transit",
  other_warehouse: "Other Warehouse",
};

export interface StockLocation {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "StockLocation";
  id: string;
  clientId: string;
  name: string;
  locationType: LocationType;
  channel: string | null;
  address: string | null;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
}

export async function list(clientId: string) {
  const { items } = await db.queryByGSI1(clientId, {
    entityType: "StockLocation",
    limit: 500,
    reverse: true,
  });
  return items as StockLocation[];
}

export async function get(id: string) {
  return db.getItem(`STOCK_LOCATION#${id}`) as Promise<StockLocation | null>;
}

export async function create(
  data: Partial<StockLocation> & { clientId: string; name: string }
) {
  const id = uuid();
  const now = db.nowISO();
  const item: StockLocation = {
    pk: `STOCK_LOCATION#${id}`,
    sk: `STOCK_LOCATION#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`,
    gsi1sk: `StockLocation#${now}`,
    entityType: "StockLocation",
    id,
    clientId: data.clientId,
    name: data.name,
    locationType: data.locationType || "central_warehouse",
    channel: data.channel || null,
    address: data.address || null,
    status: data.status || "active",
    createdAt: now,
    updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<StockLocation>) {
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  const allowed = ["name", "locationType", "channel", "address", "status"];
  for (const k of allowed) {
    if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k];
  }
  return db.updateItem(`STOCK_LOCATION#${id}`, `STOCK_LOCATION#${id}`, patch);
}

export async function remove(id: string) {
  return db.deleteItem(`STOCK_LOCATION#${id}`);
}

/**
 * Find the default Central Warehouse location for a client.
 * Creates one if none exists.
 */
export async function getDefaultLocation(clientId: string): Promise<StockLocation> {
  const locations = await list(clientId);
  const central = locations.find(
    (l) => l.locationType === "central_warehouse" && l.status === "active"
  );
  if (central) return central;

  // Auto-create a default Central Warehouse
  return create({
    clientId,
    name: "Central Warehouse",
    locationType: "central_warehouse",
    status: "active",
  });
}
