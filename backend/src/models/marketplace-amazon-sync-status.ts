import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export type SyncStatus =
  | "NotConfigured"
  | "Connected"
  | "Synchronizing"
  | "Synchronized"
  | "Failed"
  | "AuthenticationError"
  | "RateLimited"
  | "AccessRestricted";

export interface MarketplaceAmazonSyncStatus {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "MarketplaceAmazonSyncStatus";
  id: string;
  clientId: string;
  module: "orders" | "order-items" | "inventory" | "listings" | "returns";
  status: SyncStatus;
  lastSyncAt: string | null;
  recordsSynced: number;
  lastCursor: string | null; // pagination token / timestamp cursor
  error: string | null;
  errorCode: string | null;
  retries: number;
  createdAt: string;
  updatedAt: string;
}

function key(id: string) {
  return { pk: `MARKETPLACE_AMAZON_SYNC_STATUS#${id}`, sk: `MARKETPLACE_AMAZON_SYNC_STATUS#${id}` };
}

export async function list(clientId?: string) {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, {
      entityType: "MarketplaceAmazonSyncStatus",
      limit: 500,
    });
    return items as MarketplaceAmazonSyncStatus[];
  }
  return db.scanByType("MarketplaceAmazonSyncStatus", { limit: 1000 }) as Promise<MarketplaceAmazonSyncStatus[]>;
}

export async function get(id: string) {
  const { pk, sk } = key(id);
  return db.getItem(pk, sk) as Promise<MarketplaceAmazonSyncStatus | null>;
}

export async function findByClientAndModule(clientId: string, module: MarketplaceAmazonSyncStatus["module"]) {
  const items = await list(clientId);
  return items.find((s) => s.module === module) || null;
}

export async function upsert({
  clientId,
  module,
  status,
  lastSyncAt,
  recordsSynced,
  lastCursor,
  error,
  errorCode,
  retries,
}: {
  clientId: string;
  module: MarketplaceAmazonSyncStatus["module"];
  status: SyncStatus;
  lastSyncAt?: string | null;
  recordsSynced?: number;
  lastCursor?: string | null;
  error?: string | null;
  errorCode?: string | null;
  retries?: number;
}) {
  const existing = await findByClientAndModule(clientId, module);
  const now = db.nowISO();
  const id = existing?.id ?? uuid();

  const item: MarketplaceAmazonSyncStatus = {
    ...key(id),
    gsi1pk: `CLIENT#${clientId}`,
    gsi1sk: `MarketplaceAmazonSyncStatus#${module}`,
    entityType: "MarketplaceAmazonSyncStatus",
    id,
    clientId,
    module,
    status: status ?? "NotConfigured",
    lastSyncAt: lastSyncAt ?? null,
    recordsSynced: recordsSynced ?? 0,
    lastCursor: lastCursor ?? null,
    error: error ?? null,
    errorCode: errorCode ?? null,
    retries: retries ?? 0,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await db.putItem(item);
  return item;
}

export async function markSyncing({
  clientId,
  module,
}: {
  clientId: string;
  module: MarketplaceAmazonSyncStatus["module"];
}) {
  return upsert({ clientId, module, status: "Synchronizing", retries: 0 });
}
