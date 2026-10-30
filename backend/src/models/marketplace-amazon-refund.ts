import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export type RefundStatus = "Pending" | "Processed" | "Completed" | "Failed" | "Refunded";

export interface MarketplaceAmazonRefund {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "MarketplaceAmazonRefund";
  id: string;
  clientId: string;
  amazonOrderId: string;
  whizunikSalesOrderId: string | null;
  amazonRefundId: string | null; // Amazon refund ID
  refundReference: string; // External refund reference/UTR
  amount: number;
  currency: string;
  refundStatus: RefundStatus;
  refundDate: string | null;
  linkedReturnId: string | null;
  linkedReturnItemId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

function key(id: string) {
  return { pk: `MARKETPLACE_AMAZON_REFUND#${id}`, sk: `MARKETPLACE_AMAZON_REFUND#${id}` };
}

export async function list(clientId?: string) {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, {
      entityType: "MarketplaceAmazonRefund",
      limit: 500,
      reverse: true,
    });
    return items as MarketplaceAmazonRefund[];
  }
  return db.scanByType("MarketplaceAmazonRefund", { limit: 2000 }) as Promise<MarketplaceAmazonRefund[]>;
}

export async function get(id: string) {
  const { pk, sk } = key(id);
  return db.getItem(pk, sk) as Promise<MarketplaceAmazonRefund | null>;
}

export async function create(
  data: Partial<MarketplaceAmazonRefund> & {
    clientId: string;
    amazonOrderId: string;
    whizunikSalesOrderId: string | null;
    amazonRefundId: string | null;
    refundReference: string;
    amount: number;
    currency: string;
    refundStatus: string | null;
    refundDate: string | null;
    linkedReturnId: string | null;
  }
) {
  const id = uuid();
  const now = db.nowISO();
  const item: MarketplaceAmazonRefund = {
    ...key(id),
    gsi1pk: `CLIENT#${data.clientId}`,
    gsi1sk: `MarketplaceAmazonRefund#${now}`,
    entityType: "MarketplaceAmazonRefund",
    id,
    clientId: data.clientId,
    amazonOrderId: data.amazonOrderId,
    whizunikSalesOrderId: data.whizunikSalesOrderId ?? null,
    amazonRefundId: data.amazonRefundId ?? null,
    refundReference: data.refundReference,
    amount: Number(data.amount),
    currency: data.currency || "INR",
    refundStatus: data.refundStatus ?? "Pending",
    refundDate: data.refundDate ?? null,
    linkedReturnId: data.linkedReturnId ?? null,
    linkedReturnItemId: data.linkedReturnItemId ?? null,
    notes: data.notes ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<MarketplaceAmazonRefund>) {
  const { pk, sk } = key(id);
  return db.updateItem(pk, sk, {
    ...updates,
    updatedAt: db.nowISO(),
  }) as Promise<MarketplaceAmazonRefund | null>;
}

export async function findByAmazonOrderId(clientId: string, amazonOrderId: string): Promise<MarketplaceAmazonRefund | null> {
  const items = await list(clientId);
  return items.find((r) => r.amazonOrderId === amazonOrderId) || null;
}

export async function updateStatus(id: string, status: string) {
  const { pk, sk } = key(id);
  return db.updateItem(pk, sk, {
    refundStatus: status,
    updatedAt: db.nowISO(),
  }) as Promise<MarketplaceAmazonRefund | null>;
}