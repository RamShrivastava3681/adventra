import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export interface MarketplaceFlipkartOrder {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "MarketplaceFlipkartOrder";
  id: string;
  clientId: string;
  flipkartOrderId: string;
  orderItemId: string;
  orderDate: string;
  fsn: string;
  sku: string;
  title: string;
  quantity: number;
  sellingPrice: number;
  totalPrice: number;
  taxAmount: number;
  fulfilmentType: "FBF" | "Smart" | "Non-Smart" | "Express";
  orderStatus:
    | "APPROVED"
    | "PACKING"
    | "PACKED"
    | "READY_TO_DISPATCH"
    | "DISPATCHED"
    | "DELIVERED"
    | "CANCELLED"
    | "RETURNED";
  paymentType: "PREPAID" | "COD";
  deliveryAddress: {
    name?: string;
    city: string;
    state: string;
    postalCode: string;
  };
  trackingId?: string;
  invoiceNumber?: string;
  createdAt: string;
  updatedAt: string;
}

function key(id: string) {
  return { pk: `MARKETPLACE_FLIPKART_ORDER#${id}`, sk: `MARKETPLACE_FLIPKART_ORDER#${id}` };
}

export async function list(clientId?: string): Promise<MarketplaceFlipkartOrder[]> {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, {
      entityType: "MarketplaceFlipkartOrder",
      limit: 500,
      reverse: true,
    });
    return items as MarketplaceFlipkartOrder[];
  }
  return db.scanByType("MarketplaceFlipkartOrder", { limit: 1000 }) as Promise<MarketplaceFlipkartOrder[]>;
}

export async function get(id: string): Promise<MarketplaceFlipkartOrder | null> {
  const { pk, sk } = key(id);
  return db.getItem(pk, sk) as Promise<MarketplaceFlipkartOrder | null>;
}

export async function getByOrderId(flipkartOrderId: string): Promise<MarketplaceFlipkartOrder | null> {
  const orders = await list();
  return orders.find((o) => o.flipkartOrderId === flipkartOrderId) || null;
}

export async function create(
  data: Partial<MarketplaceFlipkartOrder> & {
    clientId: string;
    flipkartOrderId: string;
    orderItemId: string;
    fsn: string;
    sku: string;
    title: string;
    quantity: number;
    sellingPrice: number;
  }
): Promise<MarketplaceFlipkartOrder> {
  const id = uuid();
  const now = db.nowISO();
  const totalPrice = Number(data.totalPrice ?? (data.quantity * data.sellingPrice));
  const taxAmount = Number(data.taxAmount ?? Math.round(totalPrice * 0.18));

  const item: MarketplaceFlipkartOrder = {
    ...key(id),
    gsi1pk: `CLIENT#${data.clientId}`,
    gsi1sk: `MarketplaceFlipkartOrder#${now}`,
    entityType: "MarketplaceFlipkartOrder",
    id,
    clientId: data.clientId,
    flipkartOrderId: data.flipkartOrderId,
    orderItemId: data.orderItemId,
    orderDate: data.orderDate || db.todayDate(),
    fsn: data.fsn,
    sku: data.sku,
    title: data.title,
    quantity: Number(data.quantity),
    sellingPrice: Number(data.sellingPrice),
    totalPrice,
    taxAmount,
    fulfilmentType: data.fulfilmentType || "Non-Smart",
    orderStatus: data.orderStatus || "APPROVED",
    paymentType: data.paymentType || "PREPAID",
    deliveryAddress: data.deliveryAddress || {
      name: "Customer",
      city: "Bengaluru",
      state: "Karnataka",
      postalCode: "560001",
    },
    trackingId: data.trackingId,
    invoiceNumber: data.invoiceNumber,
    createdAt: now,
    updatedAt: now,
  };

  await db.putItem(item);
  return item;
}

export async function updateStatus(
  id: string,
  orderStatus: MarketplaceFlipkartOrder["orderStatus"]
): Promise<MarketplaceFlipkartOrder | null> {
  const order = await get(id);
  if (!order) return null;

  const updated: MarketplaceFlipkartOrder = {
    ...order,
    orderStatus,
    updatedAt: db.nowISO(),
  };

  await db.putItem(updated);
  return updated;
}
