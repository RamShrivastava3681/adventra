import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export type ExceptionStatus = "Open" | "InProgress" | "Resolved" | "Closed";

export type ExceptionReason =
  | "AmazonOrderImportFailure"
  | "UnmappedSKU"
  | "MissingColour"
  | "MissingSize"
  | "StockShortage"
  | "MissingAmazonInvoice"
  | "InvalidInvoiceInformation"
  | "ShipmentConfirmationFailure"
  | "IncompleteReturnInformation"
  | "UnmatchedRefund"
  | "SettlementDiscrepancy"
  | "APIAuthenticationFailure";

export interface MarketplaceAmazonException {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "MarketplaceAmazonException";
  id: string;
  clientId: string;
  affectedOrder: string; // Amazon Order ID or WhizUnik SO ID
  errorReason: ExceptionReason;
  errorMessage: string;
  affectedItem?: string; // SKU, ASIN, or item reference
  lastAttempt: string | null; // ISO timestamp
  retryCount: number;
  maxRetries: number;
  responsibleUser: string | null;
  currentStatus: ExceptionStatus;
  resolutionNotes: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function key(id: string) {
  return { pk: `MARKETPLACE_AMAZON_EXCEPTION#${id}`, sk: `MARKETPLACE_AMAZON_EXCEPTION#${id}` };
}

export async function list(clientId?: string) {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, {
      entityType: "MarketplaceAmazonException",
      limit: 500,
      reverse: true,
    });
    return items as MarketplaceAmazonException[];
  }
  return db.scanByType("MarketplaceAmazonException", { limit: 2000 }) as Promise<MarketplaceAmazonException[]>;
}

export async function get(id: string) {
  const { pk, sk } = key(id);
  return db.getItem(pk, sk) as Promise<MarketplaceAmazonException | null>;
}

export async function create(
  data: Partial<MarketplaceAmazonException> & {
    clientId: string;
    affectedOrder: string;
    errorReason: ExceptionReason;
    errorMessage: string;
    affectedItem?: string;
    maxRetries: number;
    responsibleUser: string | null;
  }
) {
  const id = uuid();
  const now = db.nowISO();
  const item: MarketplaceAmazonException = {
    ...key(id),
    gsi1pk: `CLIENT#${data.clientId}`,
    gsi1sk: `MarketplaceAmazonException#${now}`,
    entityType: "MarketplaceAmazonException",
    id,
    clientId: data.clientId,
    affectedOrder: data.affectedOrder,
    errorReason: data.errorReason,
    errorMessage: data.errorMessage,
    affectedItem: data.affectedItem ?? null,
    lastAttempt: null,
    retryCount: 0,
    maxRetries: data.maxRetries || 3,
    responsibleUser: data.responsibleUser ?? null,
    currentStatus: "Open",
    resolutionNotes: null,
    resolvedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<MarketplaceAmazonException>) {
  const { pk, sk } = key(id);
  return db.updateItem(pk, sk, {
    ...updates,
    updatedAt: db.nowISO(),
  }) as Promise<MarketplaceAmazonException | null>;
}

export async function resolveException(id: string, resolutionNotes: string, responsibleUser: string) {
  const { pk, sk } = key(id);
  return db.updateItem(pk, sk, {
    currentStatus: "Resolved",
    resolutionNotes,
    responsibleUser,
    resolvedAt: db.nowISO(),
    updatedAt: db.nowISO(),
  }) as Promise<MarketplaceAmazonException | null>;
}

export async function incrementRetry(id: string) {
  const { pk, sk } = key(id);
  const current = await get(id);
  if (!current) return null;
  return db.updateItem(pk, sk, {
    retryCount: (current.retryCount ?? 0) + 1,
    lastAttempt: db.nowISO(),
    updatedAt: db.nowISO(),
  }) as Promise<MarketplaceAmazonException | null>;
}

export async function findOpenExceptions(clientId: string): Promise<MarketplaceAmazonException[]> {
  const items = await list(clientId);
  return items.filter((e) => e.currentStatus === "Open");
}

export async function findByReason(clientId: string, reason: ExceptionReason): Promise<MarketplaceAmazonException[]> {
  const items = await list(clientId);
  return items.filter((e) => e.errorReason === reason);
}