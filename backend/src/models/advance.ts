import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export interface Advance {
  pk: string; sk: string; gsi1pk: string; gsi1sk: string;
  entityType: "Advance";
  id: string; clientId: string;
  side: "sales" | "purchase";
  amount: number; advanceDate: string;
  status: string; reference: string | null; notes: string | null;
  invoiceId: string | null; purchaseInvoiceId: string | null; purchaseOrderId: string | null;
  paymentRef: string;
  createdAt: string; updatedAt: string;
}

export async function list(clientId?: string) {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, { entityType: "Advance", limit: 500, reverse: true });
    return items as Advance[];
  }
  return db.scanByType("Advance", { limit: 2000 }) as Promise<Advance[]>;
}

export async function get(id: string) { return db.getItem(`ADVANCE#${id}`) as Promise<Advance | null>; }

export async function create(data: Partial<Advance> & { clientId: string; side: "sales" | "purchase"; amount: number }) {
  const id = uuid(); const now = db.nowISO();
  const ref = `PAY-${now.slice(0, 4)}-${id.slice(0, 6).toUpperCase()}`;
  const item: Advance = {
    pk: `ADVANCE#${id}`, sk: `ADVANCE#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`, gsi1sk: `Advance#${now}`,
    entityType: "Advance", id, clientId: data.clientId,
    side: data.side, amount: data.amount,
    advanceDate: data.advanceDate || db.todayDate(),
    status: data.status || "open", reference: data.reference || null, notes: data.notes || null,
    invoiceId: data.invoiceId || null, purchaseInvoiceId: data.purchaseInvoiceId || null,
    purchaseOrderId: data.purchaseOrderId || null, paymentRef: ref,
    createdAt: now, updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<Advance>) {
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  const allowed = ["amount","status","reference","notes","side","advanceDate","invoiceId","purchaseInvoiceId","purchaseOrderId"];
  for (const k of allowed) { if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k]; }
  return db.updateItem(`ADVANCE#${id}`, `ADVANCE#${id}`, patch);
}

export async function remove(id: string) { return db.deleteItem(`ADVANCE#${id}`); }
