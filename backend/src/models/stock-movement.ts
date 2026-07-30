import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export interface StockMovement {
  pk: string; sk: string; gsi1pk: string; gsi1sk: string; gsi2pk: string; gsi2sk: string;
  entityType: "StockMovement";
  id: string; clientId: string; productId: string | null;
  direction: "in" | "out"; itemName: string; sku: string | null;
  quantity: number; unit: string; unitCost: number | null;
  notes: string | null; movementDate: string;
  invoiceId: string | null; purchaseInvoiceId: string | null;
  createdAt: string; updatedAt: string;
}

export async function list(clientId: string) {
  const { items } = await db.queryByGSI1(clientId, { entityType: "StockMovement", limit: 500, reverse: true });
  return items as StockMovement[];
}

export async function listAll() {
  return db.scanByType("StockMovement", { limit: 2000 }) as Promise<StockMovement[]>;
}

export async function get(id: string) {
  return db.getItem(`STOCK_MOVEMENT#${id}`) as Promise<StockMovement | null>;
}

export async function create(data: Partial<StockMovement> & { clientId: string; direction: "in" | "out"; itemName: string; quantity: number }) {
  const id = uuid(); const now = db.nowISO();
  const item: StockMovement = {
    pk: `STOCK_MOVEMENT#${id}`, sk: `STOCK_MOVEMENT#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`, gsi1sk: `StockMovement#${now}`,
    gsi2pk: "StockMovement", gsi2sk: `StockMovement#${id}`,
    entityType: "StockMovement", id, clientId: data.clientId,
    productId: data.productId || null, direction: data.direction,
    itemName: data.itemName, sku: data.sku || null,
    quantity: data.quantity, unit: data.unit || "unit",
    unitCost: data.unitCost != null ? data.unitCost : null,
    notes: data.notes || null, movementDate: data.movementDate || db.todayDate(),
    invoiceId: data.invoiceId || null, purchaseInvoiceId: data.purchaseInvoiceId || null,
    createdAt: now, updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function remove(id: string) {
  return db.deleteItem(`STOCK_MOVEMENT#${id}`);
}

export async function getByProduct(clientId: string, productId: string) {
  const all = await list(clientId);
  return all.filter((m) => m.productId === productId);
}

export async function getBalance(productId: string, allMovements: StockMovement[]) {
  return allMovements
    .filter((m) => m.productId === productId)
    .reduce((sum, m) => sum + (m.direction === "in" ? m.quantity : -m.quantity), 0);
}
