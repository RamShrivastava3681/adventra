import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export interface MarketplaceFlipkartReturn {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "MarketplaceFlipkartReturn";
  id: string;
  clientId: string;
  returnId: string;
  flipkartOrderId: string;
  orderItemId: string;
  fsn: string;
  sku: string;
  title: string;
  returnType: "CUSTOMER_RETURN" | "COURIER_RETURN"; // COURIER_RETURN is RTO (Undelivered)
  reason: string;
  subReason?: string;
  refundAmount: number;
  status: "REQUESTED" | "APPROVED" | "IN_TRANSIT" | "RECEIVED" | "REJECTED" | "COMPLETED";
  trackingNumber?: string;
  returnDate: string;
  createdAt: string;
  updatedAt: string;
}

function key(id: string) {
  return { pk: `MARKETPLACE_FLIPKART_RETURN#${id}`, sk: `MARKETPLACE_FLIPKART_RETURN#${id}` };
}

export async function list(clientId?: string): Promise<MarketplaceFlipkartReturn[]> {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, {
      entityType: "MarketplaceFlipkartReturn",
      limit: 500,
      reverse: true,
    });
    return items as MarketplaceFlipkartReturn[];
  }
  return db.scanByType("MarketplaceFlipkartReturn", { limit: 1000 }) as Promise<MarketplaceFlipkartReturn[]>;
}

export async function create(
  data: Partial<MarketplaceFlipkartReturn> & {
    clientId: string;
    returnId: string;
    flipkartOrderId: string;
    orderItemId: string;
    fsn: string;
    sku: string;
    title: string;
    returnType: "CUSTOMER_RETURN" | "COURIER_RETURN";
    reason: string;
    refundAmount: number;
  }
): Promise<MarketplaceFlipkartReturn> {
  const id = uuid();
  const now = db.nowISO();

  const item: MarketplaceFlipkartReturn = {
    ...key(id),
    gsi1pk: `CLIENT#${data.clientId}`,
    gsi1sk: `MarketplaceFlipkartReturn#${now}`,
    entityType: "MarketplaceFlipkartReturn",
    id,
    clientId: data.clientId,
    returnId: data.returnId,
    flipkartOrderId: data.flipkartOrderId,
    orderItemId: data.orderItemId,
    fsn: data.fsn,
    sku: data.sku,
    title: data.title,
    returnType: data.returnType,
    reason: data.reason,
    subReason: data.subReason,
    refundAmount: Number(data.refundAmount),
    status: data.status || "COMPLETED",
    trackingNumber: data.trackingNumber,
    returnDate: data.returnDate || db.todayDate(),
    createdAt: now,
    updatedAt: now,
  };

  await db.putItem(item);
  return item;
}
