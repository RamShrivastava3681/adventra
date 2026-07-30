import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export interface Expense {
  pk: string; sk: string; gsi1pk: string; gsi1sk: string;
  entityType: "Expense";
  id: string; clientId: string;
  category: string; description: string | null;
  amount: number; expenseDate: string;
  invoiceId: string | null; purchaseInvoiceId: string | null;
  documents: any[]; expenseRef: string;
  createdAt: string; updatedAt: string;
}

export async function list(clientId: string) {
  const { items } = await db.queryByGSI1(clientId, { entityType: "Expense", limit: 500, reverse: true });
  return items as Expense[];
}

export async function get(id: string) { return db.getItem(`EXPENSE#${id}`) as Promise<Expense | null>; }

export async function create(data: Partial<Expense> & { clientId: string; category: string; amount: number }) {
  const id = uuid(); const now = db.nowISO();
  const ref = `EXP-${now.slice(0, 4)}-${id.slice(0, 6).toUpperCase()}`;
  const item: Expense = {
    pk: `EXPENSE#${id}`, sk: `EXPENSE#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`, gsi1sk: `Expense#${now}`,
    entityType: "Expense", id, clientId: data.clientId,
    category: data.category, description: data.description || null,
    amount: data.amount, expenseDate: data.expenseDate || db.todayDate(),
    invoiceId: data.invoiceId || null, purchaseInvoiceId: data.purchaseInvoiceId || null,
    documents: data.documents || [], expenseRef: ref,
    createdAt: now, updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<Expense>) {
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  const allowed = ["category","description","amount","expenseDate","invoiceId","purchaseInvoiceId","documents"];
  for (const k of allowed) { if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k]; }
  return db.updateItem(`EXPENSE#${id}`, `EXPENSE#${id}`, patch);
}

export async function remove(id: string) { return db.deleteItem(`EXPENSE#${id}`); }
