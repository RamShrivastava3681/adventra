import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export type ShipmentStatus = "Pending" | "AwaitingPack" | "Packed" | "Dispatched" | "InTransit" | "Delivered" | "Cancelled" | "Returned";

export interface MarketplaceAmazonShipment {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "MarketplaceAmazonShipment";
  id: string;
  clientId: string;
  amazonOrderId: string;
  whizunikSalesOrderId: string;
  amazonShipmentId: string | null;
  awbNumber: string | null; // Amazon Tracking/AWB number
  trackingNumber: string | null;
  shippingMethod: string;
  carrierName: string | null;
  dispatchDate: string | null;
  deliverByDate: string | null;
  deliveryStatus: ShipmentStatus;
  deliveryLocation: {
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  quantity: number;
  fulfilmentType: "FBA" | "SellerFlex" | "MCF" | "Dropship" | "Vendor";
  packageWeight: number | null;
  packageDimensions: {
    length: number | null;
    width: number | null;
    height: number | null;
    unit: string | null;
  } | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

function key(id: string) {
  return { pk: `MARKETPLACE_AMAZON_SHIPMENT#${id}`, sk: `MARKETPLACE_AMAZON_SHIPMENT#${id}` };
}

export async function list(clientId?: string) {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, {
      entityType: "MarketplaceAmazonShipment",
      limit: 500,
      reverse: true,
    });
    return items as MarketplaceAmazonShipment[];
  }
  return db.scanByType("MarketplaceAmazonShipment", { limit: 2000 }) as Promise<MarketplaceAmazonShipment[]>;
}

export async function get(id: string) {
  const { pk, sk } = key(id);
  return db.getItem(pk, sk) as Promise<MarketplaceAmazonShipment | null>;
}

export async function create(
  data: Partial<MarketplaceAmazonShipment> & {
    clientId: string;
    amazonOrderId: string;
    whizunikSalesOrderId: string;
    amazonShipmentId: string | null;
    awbNumber: string | null;
    trackingNumber: string | null;
    shippingMethod: string;
    carrierName: string | null;
    dispatchDate: string | null;
    deliverByDate: string | null;
    deliveryStatus: string | null;
    deliveryLocation: any;
    quantity: number;
    fulfilmentType: string;
    packageWeight: number | null;
    packageDimensions: any | null;
  }
) {
  const id = uuid();
  const now = db.nowISO();
  const item: MarketplaceAmazonShipment = {
    ...key(id),
    gsi1pk: `CLIENT#${data.clientId}`,
    gsi1sk: `MarketplaceAmazonShipment#${now}`,
    entityType: "MarketplaceAmazonShipment",
    id,
    clientId: data.clientId,
    amazonOrderId: data.amazonOrderId,
    whizunikSalesOrderId: data.whizunikSalesOrderId,
    amazonShipmentId: data.amazonShipmentId ?? null,
    awbNumber: data.awbNumber ?? null,
    trackingNumber: data.trackingNumber ?? null,
    shippingMethod: data.shippingMethod,
    carrierName: data.carrierName ?? null,
    dispatchDate: data.dispatchDate ?? null,
    deliverByDate: data.deliverByDate ?? null,
    deliveryStatus: data.deliveryStatus ?? "Pending",
    deliveryLocation: data.deliveryLocation || {
      addressLine1: "",
      addressLine2: null,
      city: "",
      state: "",
      postalCode: "",
      country: "",
    },
    quantity: Number(data.quantity),
    fulfilmentType: data.fulfilmentType || "FBA",
    packageWeight: data.packageWeight ?? null,
    packageDimensions: data.packageDimensions ?? null,
    notes: data.notes ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<MarketplaceAmazonShipment>) {
  const { pk, sk } = key(id);
  return db.updateItem(pk, sk, {
    ...updates,
    updatedAt: db.nowISO(),
  }) as Promise<MarketplaceAmazonShipment | null>;
}

export async function findByAmazonOrderId(clientId: string, amazonOrderId: string): Promise<MarketplaceAmazonShipment | null> {
  const items = await list(clientId);
  return items.find((s) => s.amazonOrderId === amazonOrderId) || null;
}

export async function updateStatus(id: string, status: string) {
  const { pk, sk } = key(id);
  return db.updateItem(pk, sk, {
    deliveryStatus: status,
    updatedAt: db.nowISO(),
  }) as Promise<MarketplaceAmazonShipment | null>;
}