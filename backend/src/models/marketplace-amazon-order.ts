import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export interface MarketplaceAmazonOrder {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "MarketplaceAmazonOrder";
  id: string;
  clientId: string;
  amazonOrderId: string;
  orderDate: string;
  amazonSku: string;
  productName: string;
  colour: string | null;
  size: string | null;
  quantity: number;
  sellingPrice: number;
  discount: number;
  taxInformation: {
    taxableAmount: number;
    taxAmount: number;
    taxRate: number;
  };
  deliveryAddress: {
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  shippingMethod: string;
  fulfilmentType: "FBA" | "SellerFlex" | "MCF" | "Dropship" | "Vendor";
  expectedDispatchDate: string | null;
  amazonOrderStatus: "Pending" | "PartiallyShipped" | "Shipped" | "Delivered" | "Cancelled" | "Returned" | "Refunded" | "PendingConfirmation";
  invoiceStatus: "Pending" | "AwaitingAmazonInvoice" | "InvoiceReceived" | "Fulfilled" | "Cancelled";
  createdAt: string;
  updatedAt: string;
}

function key(id: string) {
  return { pk: `MARKETPLACE_AMAZON_ORDER#${id}`, sk: `MARKETPLACE_AMAZON_ORDER#${id}` };
}

export async function list(clientId?: string) {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, {
      entityType: "MarketplaceAmazonOrder",
      limit: 500,
      reverse: true,
    });
    return items as MarketplaceAmazonOrder[];
  }
  return db.scanByType("MarketplaceAmazonOrder", { limit: 1000 }) as Promise<MarketplaceAmazonOrder[]>;
}

export async function get(id: string) {
  const { pk, sk } = key(id);
  return db.getItem(pk, sk) as Promise<MarketplaceAmazonOrder | null>;
}

export async function create(
  data: Partial<MarketplaceAmazonOrder> & {
    clientId: string;
    amazonOrderId: string;
    amazonSku: string;
    productName: string;
    colour: string | null;
    size: string | null;
    quantity: number;
    sellingPrice: number;
    discount: number;
    shippingMethod: string;
    fulfilmentType: string;
  }
) {
  const id = uuid();
  const now = db.nowISO();
  const item: MarketplaceAmazonOrder = {
    ...key(id),
    gsi1pk: `CLIENT#${data.clientId}`,
    gsi1sk: `MarketplaceAmazonOrder#${now}`,
    entityType: "MarketplaceAmazonOrder",
    id,
    clientId: data.clientId,
    amazonOrderId: data.amazonOrderId,
    orderDate: data.orderDate || db.todayDate(),
    amazonSku: data.amazonSku,
    productName: data.productName,
    colour: data.colour ?? null,
    size: data.size ?? null,
    quantity: Number(data.quantity),
    sellingPrice: Number(data.sellingPrice),
    discount: Number(data.discount) || 0,
    taxInformation: data.taxInformation || {
      taxableAmount: 0,
      taxAmount: 0,
      taxRate: 0,
    },
    deliveryAddress: data.deliveryAddress || {
      addressLine1: "",
      addressLine2: null,
      city: "",
      state: "",
      postalCode: "",
      country: "",
    },
    shippingMethod: data.shippingMethod,
    fulfilmentType: data.fulfilmentType || "FBA",
    expectedDispatchDate: data.expectedDispatchDate ?? null,
    amazonOrderStatus: "Pending",
    invoiceStatus: "Pending",
    createdAt: now,
    updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<MarketplaceAmazonOrder>) {
  const { pk, sk } = key(id);
  return db.updateItem(pk, sk, {
    ...updates,
    updatedAt: db.nowISO(),
  }) as Promise<MarketplaceAmazonOrder | null>;
}

export async function findByAmazonOrderId(clientId: string, amazonOrderId: string): Promise<MarketplaceAmazonOrder | null> {
  const items = await list(clientId);
  return items.find((o) => o.amazonOrderId === amazonOrderId) || null;
}

export async function updateStatus(id: string, status: string, invoiceStatus?: string) {
  const { pk, sk } = key(id);
  const updates: any = {
    amazonOrderStatus: status,
    updatedAt: db.nowISO(),
  };
  if (invoiceStatus !== undefined) {
    updates.invoiceStatus = invoiceStatus;
  }
  return db.updateItem(pk, sk, {
    ...updates,
    updatedAt: db.nowISO(),
  }) as Promise<MarketplaceAmazonOrder | null>;
}