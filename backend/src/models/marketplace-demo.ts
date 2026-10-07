import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

/**
 * Marketplace Demo orders/invoices — lightweight e-commerce demo docs.
 *
 * Rule implemented (per client request + PDF flow):
 *   e-commerce order  -> creates ONE demo sales order (idempotent)
 *   payment collected -> creates ONE demo invoice linked to that SO
 *
 * Kept separate from GoodsSalesOrder/Invoice so the Hub PoC never trips
 * production validation (catalogue, debtor, payment-terms, credit-limit).
 * All records carry demo:true and a shared correlationId for drill-down.
 */

export type DemoSoStatus = "reserved" | "dispatched" | "cancelled";
export type DemoPaymentStatus = "pending" | "collected_by_marketplace";

export interface MarketplaceDemoOrder {
  pk: string; sk: string; gsi1pk: string; gsi1sk: string;
  entityType: "MarketplaceDemoOrder";
  id: string; clientId: string;
  demo: true;
  correlationId: string;
  marketplace: string;
  externalOrderId: string;
  eventId: string;
  channelSku: string;
  whizunikSku: string;
  quantity: number;
  unitPrice: number;
  totalValue: number;
  soNumber: string;
  status: DemoSoStatus;
  paymentStatus: DemoPaymentStatus;
  invoiceId: string | null;
  createdAt: string; updatedAt: string;
}

export interface MarketplaceDemoInvoice {
  pk: string; sk: string; gsi1pk: string; gsi1sk: string;
  entityType: "MarketplaceDemoInvoice";
  id: string; clientId: string;
  demo: true;
  correlationId: string;
  demoOrderId: string;
  soNumber: string;
  invoiceNumber: string;
  marketplace: string;
  externalOrderId: string;
  amount: number;
  status: "demo_issued";
  createdAt: string;
}

function orderKey(id: string) {
  return { pk: `MARKETPLACE_DEMO_ORDER#${id}`, sk: `MARKETPLACE_DEMO_ORDER#${id}` };
}

function invoiceKey(id: string) {
  return { pk: `MARKETPLACE_DEMO_INVOICE#${id}`, sk: `MARKETPLACE_DEMO_INVOICE#${id}` };
}

export async function listOrders(clientId: string) {
  const { items } = await db.queryByGSI1(clientId, {
    entityType: "MarketplaceDemoOrder",
    limit: 200,
    reverse: true,
  });
  return items as MarketplaceDemoOrder[];
}

export async function listInvoices(clientId: string) {
  const { items } = await db.queryByGSI1(clientId, {
    entityType: "MarketplaceDemoInvoice",
    limit: 200,
    reverse: true,
  });
  return items as MarketplaceDemoInvoice[];
}

/** Idempotent: same client+marketplace+externalOrderId returns existing order. */
export async function findByExternalOrder(clientId: string, marketplace: string, externalOrderId: string) {
  const orders = await listOrders(clientId);
  return orders.find(
    (o) => o.marketplace === marketplace && o.externalOrderId === externalOrderId,
  ) || null;
}

export async function createDemoOrder(data: {
  clientId: string;
  marketplace: string;
  externalOrderId: string;
  eventId: string;
  channelSku: string;
  whizunikSku: string;
  quantity: number;
  unitPrice: number;
}) {
  const existing = await findByExternalOrder(data.clientId, data.marketplace, data.externalOrderId);
  if (existing) return { order: existing, created: false };

  if (!data.whizunikSku || data.whizunikSku === "UNMAPPED") {
    throw new Error("Mapping required — resolve the channel SKU before creating a sales order");
  }
  const qty = Number(data.quantity);
  const price = Number(data.unitPrice);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error("quantity must be positive");
  if (!Number.isFinite(price) || price < 0) throw new Error("unitPrice must be non-negative");

  const id = uuid();
  const now = db.nowISO();
  const correlationId = `${data.eventId}:${data.marketplace}:${data.externalOrderId}`;
  const item: MarketplaceDemoOrder = {
    ...orderKey(id),
    gsi1pk: `CLIENT#${data.clientId}`,
    gsi1sk: `MarketplaceDemoOrder#${now}`,
    entityType: "MarketplaceDemoOrder",
    id,
    clientId: data.clientId,
    demo: true,
    correlationId,
    marketplace: data.marketplace,
    externalOrderId: data.externalOrderId,
    eventId: data.eventId,
    channelSku: data.channelSku,
    whizunikSku: data.whizunikSku,
    quantity: qty,
    unitPrice: price,
    totalValue: Math.round(qty * price * 100) / 100,
    soNumber: `SO-DEMO-${now.slice(0, 10).replace(/-/g, "")}-${id.slice(0, 4).toUpperCase()}`,
    status: "reserved",
    paymentStatus: "pending",
    invoiceId: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.putItem(item);
  return { order: item, created: true };
}

/**
 * Payment creates the invoice. One SO -> one invoice: second call returns
 * the existing invoice without duplicating.
 */
export async function recordPaymentAndInvoice(orderId: string) {
  const raw = await db.getItem(orderKey(orderId).pk, orderKey(orderId).sk);
  const order = raw as MarketplaceDemoOrder | null;
  if (!order) throw new Error("Demo sales order not found");
  if (order.status === "cancelled") throw new Error("Cannot invoice a cancelled order");
  if (order.invoiceId) {
    const inv = await db.getItem(invoiceKey(order.invoiceId).pk, invoiceKey(order.invoiceId).sk);
    return { order, invoice: inv as MarketplaceDemoInvoice, created: false };
  }
  const id = uuid();
  const now = db.nowISO();
  const invoice: MarketplaceDemoInvoice = {
    ...invoiceKey(id),
    gsi1pk: `CLIENT#${order.clientId}`,
    gsi1sk: `MarketplaceDemoInvoice#${now}`,
    entityType: "MarketplaceDemoInvoice",
    id,
    clientId: order.clientId,
    demo: true,
    correlationId: order.correlationId,
    demoOrderId: order.id,
    soNumber: order.soNumber,
    invoiceNumber: `INV-DEMO-${now.slice(0, 10).replace(/-/g, "")}-${id.slice(0, 4).toUpperCase()}`,
    marketplace: order.marketplace,
    externalOrderId: order.externalOrderId,
    amount: order.totalValue,
    status: "demo_issued",
    createdAt: now,
  };
  await db.putItem(invoice);
  await db.updateItem(orderKey(order.id).pk, orderKey(order.id).sk, {
    invoiceId: id,
    paymentStatus: "collected_by_marketplace",
    updatedAt: db.nowISO(),
  });
  const updated = await db.getItem(orderKey(order.id).pk, orderKey(order.id).sk);
  return { order: updated as MarketplaceDemoOrder, invoice, created: true };
}
