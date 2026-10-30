import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export type ReturnStatus =
  | "ReturnInitiated"
  | "InTransit"
  | "Received"
  | "UnderInspection"
  | "Accepted"
  | "PartiallyAccepted"
  | "Rejected"
  | "CreditNoteCreated"
  | "RefundConfirmed"
  | "Closed";

export interface ReturnQuantityBreakdown {
  totalReturned: number;
  acceptedAndResalable: number;
  damagedOrRejected: number;
  missing: number;
}

export interface MarketplaceAmazonReturn {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "MarketplaceAmazonReturn";
  id: string;
  clientId: string;
  amazonOrderId: string;
  whizunikSalesOrderId: string;
  amazonReturnId: string | null;
  returnStatus: ReturnStatus;
  quantityReturned: number;
  quantityAccepted: number;
  quantityDamaged: number;
  quantityMissing: number;
  returnReason: string | null;
  conditionDescription: string | null;
  goodsReceivedAt: string | null;
  warehouseInspectionNotes: string | null;
  checkerId: string | null;
  checkerName: string | null;
  checkerApprovedAt: string | null;
  creditNoteId: string | null;
  refundReference: string | null;
  refundStatus: "Pending" | "Processed" | "Completed" | "Failed";
  createdAt: string;
  updatedAt: string;
}

function key(id: string) {
  return { pk: `MARKETPLACE_AMAZON_RETURN#${id}`, sk: `MARKETPLACE_AMAZON_RETURN#${id}` };
}

export async function list(clientId?: string) {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, {
      entityType: "MarketplaceAmazonReturn",
      limit: 500,
      reverse: true,
    });
    return items as MarketplaceAmazonReturn[];
  }
  return db.scanByType("MarketplaceAmazonReturn", { limit: 2000 }) as Promise<MarketplaceAmazonReturn[]>;
}

export async function get(id: string) {
  const { pk, sk } = key(id);
  return db.getItem(pk, sk) as Promise<MarketplaceAmazonReturn | null>;
}

export async function create(
  data: Partial<MarketplaceAmazonReturn> & {
    clientId: string;
    amazonOrderId: string;
    whizunikSalesOrderId: string;
    amazonReturnId: string | null;
    returnStatus: string | null;
    quantityReturned: number;
    quantityAccepted: number;
    quantityDamaged: number;
    quantityMissing: number;
    returnReason: string | null;
    conditionDescription: string | null;
  }
) {
  const id = uuid();
  const now = db.nowISO();
  const item: MarketplaceAmazonReturn = {
    ...key(id),
    gsi1pk: `CLIENT#${data.clientId}`,
    gsi1sk: `MarketplaceAmazonReturn#${now}`,
    entityType: "MarketplaceAmazonReturn",
    id,
    clientId: data.clientId,
    amazonOrderId: data.amazonOrderId,
    whizunikSalesOrderId: data.whizunikSalesOrderId,
    amazonReturnId: data.amazonReturnId ?? null,
    returnStatus: data.returnStatus ?? "ReturnInitiated",
    quantityReturned: Number(data.quantityReturned),
    quantityAccepted: Number(data.quantityAccepted) || 0,
    quantityDamaged: Number(data.quantityDamaged) || 0,
    quantityMissing: Number(data.quantityMissing) || 0,
    returnReason: data.returnReason ?? null,
    conditionDescription: data.conditionDescription ?? null,
    goodsReceivedAt: data.goodsReceivedAt ?? null,
    warehouseInspectionNotes: data.warehouseInspectionNotes ?? null,
    checkerId: data.checkerId ?? null,
    checkerName: data.checkerName ?? null,
    checkerApprovedAt: data.checkerApprovedAt ?? null,
    creditNoteId: data.creditNoteId ?? null,
    refundReference: data.refundReference ?? null,
    refundStatus: data.refundStatus ?? "Pending",
    createdAt: now,
    updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<MarketplaceAmazonReturn>) {
  const { pk, sk } = key(id);
  return db.updateItem(pk, sk, {
    ...updates,
    updatedAt: db.nowISO(),
  }) as Promise<MarketplaceAmazonReturn | null>;
}

export async function findByAmazonOrderId(clientId: string, amazonOrderId: string): Promise<MarketplaceAmazonReturn | null> {
  const items = await list(clientId);
  return items.find((r) => r.amazonOrderId === amazonOrderId) || null;
}

export async function updateStatus(id: string, status: string) {
  const { pk, sk } = key(id);
  return db.updateItem(pk, sk, {
    returnStatus: status,
    updatedAt: db.nowISO(),
  }) as Promise<MarketplaceAmazonReturn | null>;
}