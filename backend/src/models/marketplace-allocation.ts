import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

/**
 * Marketplace Allocation — stock reserved for a specific sales channel.
 *
 * Unlike a stock transfer, an allocation does not move stock between locations.
 * It earmarks on-hand stock at the source location for one marketplace so the
 * same units cannot be reserved twice. The reservation is released when the
 * user reverses it, and is consumed as marketplace orders are fulfilled.
 */

export const MARKETPLACES = [
  "amazon",
  "flipkart",
  "shopify",
  "myntra",
  "marketplace4",
] as const;

export type Marketplace = (typeof MARKETPLACES)[number];

export const MARKETPLACE_LABELS: Record<Marketplace, string> = {
  amazon: "Amazon India",
  flipkart: "Flipkart",
  shopify: "Shopify Store",
  myntra: "Myntra",
  marketplace4: "Marketplace 4",
};

export type MarketplaceAllocationStatus = "active" | "depleted" | "reversed";

export interface MarketplaceAllocation {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "MarketplaceAllocation";
  id: string;
  clientId: string;
  allocationNumber: string;
  marketplace: Marketplace;
  marketplaceName: string;
  productId: string;
  sku: string | null;
  productName: string;
  unit: string;
  quantity: number;
  reservedQuantity: number;
  consumedQuantity: number;
  sourceLocationId: string | null;
  sourceLocationName: string | null;
  status: MarketplaceAllocationStatus;
  notes: string | null;
  createdById: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  reversedById: string | null;
  reversedByName: string | null;
  reversedAt: string | null;
  depletedAt: string | null;
}

export function isMarketplace(value: unknown): value is Marketplace {
  return (MARKETPLACES as readonly string[]).includes(String(value));
}

function key(id: string) {
  return { pk: `MARKETPLACE_ALLOCATION#${id}`, sk: `MARKETPLACE_ALLOCATION#${id}` };
}

export async function list(clientId?: string) {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, {
      entityType: "MarketplaceAllocation",
      limit: 500,
      reverse: true,
    });
    return items as MarketplaceAllocation[];
  }
  return db.scanByType("MarketplaceAllocation", { limit: 1000 }) as Promise<
    MarketplaceAllocation[]
  >;
}

export async function get(id: string) {
  const { pk, sk } = key(id);
  return db.getItem(pk, sk) as Promise<MarketplaceAllocation | null>;
}

export async function create(
  data: Partial<MarketplaceAllocation> & {
    clientId: string;
    marketplace: Marketplace;
    productId: string;
    productName: string;
    quantity: number;
  }
) {
  const id = uuid();
  const now = db.nowISO();
  const quantity = Number(data.quantity);
  const item: MarketplaceAllocation = {
    ...key(id),
    gsi1pk: `CLIENT#${data.clientId}`,
    gsi1sk: `MarketplaceAllocation#${now}`,
    entityType: "MarketplaceAllocation",
    id,
    clientId: data.clientId,
    allocationNumber: `MKT-${id.slice(0, 8).toUpperCase()}`,
    marketplace: data.marketplace,
    marketplaceName: data.marketplaceName || MARKETPLACE_LABELS[data.marketplace],
    productId: data.productId,
    sku: data.sku ?? null,
    productName: data.productName,
    unit: data.unit || "unit",
    quantity,
    reservedQuantity: quantity,
    consumedQuantity: 0,
    sourceLocationId: data.sourceLocationId ?? null,
    sourceLocationName: data.sourceLocationName ?? null,
    status: "active",
    notes: data.notes ?? null,
    createdById: data.createdById ?? null,
    createdByName: data.createdByName ?? null,
    createdAt: now,
    updatedAt: now,
    reversedById: null,
    reversedByName: null,
    reversedAt: null,
    depletedAt: null,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<MarketplaceAllocation>) {
  const { pk, sk } = key(id);
  return db.updateItem(pk, sk, {
    ...updates,
    updatedAt: db.nowISO(),
  }) as Promise<MarketplaceAllocation | null>;
}

export async function reverse(
  id: string,
  actor: { id: string | null; name: string | null }
) {
  const current = await get(id);
  if (!current) throw new Error("Marketplace allocation not found");
  if (current.status === "reversed") {
    throw new Error("This allocation has already been reversed");
  }
  const now = db.nowISO();
  return update(id, {
    status: "reversed",
    reversedById: actor.id,
    reversedByName: actor.name,
    reversedAt: now,
  });
}

/**
 * Consume reserved marketplace stock (oldest allocation first) and return any
 * allocations that reached zero. The caller raises the out-of-stock alert.
 */
export async function consume(data: {
  clientId?: string;
  marketplace: Marketplace;
  productId?: string | null;
  sku?: string | null;
  quantity: number;
}) {
  const requested = Number(data.quantity);
  if (!(requested > 0)) throw new Error("Quantity must be greater than zero");

  let allocations = (await list(data.clientId)).filter(
    (a) =>
      a.status === "active" &&
      a.marketplace === data.marketplace &&
      (data.productId
        ? a.productId === data.productId
        : data.sku
          ? a.sku === data.sku
          : true)
  );
  allocations = allocations.sort((a, b) =>
    String(a.createdAt).localeCompare(String(b.createdAt))
  );

  let remaining = requested;
  const depleted: MarketplaceAllocation[] = [];
  for (const allocation of allocations) {
    if (remaining <= 0) break;
    const take = Math.min(Number(allocation.reservedQuantity) || 0, remaining);
    if (take <= 0) continue;
    const nextReserved = (Number(allocation.reservedQuantity) || 0) - take;
    const updated = await update(allocation.id, {
      reservedQuantity: nextReserved,
      consumedQuantity: (Number(allocation.consumedQuantity) || 0) + take,
      status: nextReserved <= 0 ? "depleted" : "active",
      ...(nextReserved <= 0 ? { depletedAt: db.nowISO() } : {}),
    });
    if (nextReserved <= 0 && updated) depleted.push(updated);
    remaining -= take;
  }

  return {
    consumed: requested - remaining,
    depleted,
  };
}
