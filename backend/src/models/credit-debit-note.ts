import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export interface CreditDebitNote {
  pk: string; sk: string; gsi1pk: string; gsi1sk: string;
  entityType: "CreditDebitNote";
  id: string; clientId: string;
  kind: "credit" | "debit";
  noteNumber: string; noteDate: string;
  amount: number; reason: string | null;
  status: string;
  invoiceId: string | null; purchaseInvoiceId: string | null;
  counterparty: string | null;
  lineItems: any[]; subtotal: number | null;
  taxRate: number; taxAmount: number;
  notes: string | null; documents: any[];
  source: string;
  createdAt: string; updatedAt: string;
}

export async function list(clientId: string) {
  const { items } = await db.queryByGSI1(clientId, { entityType: "CreditDebitNote", limit: 500, reverse: true });
  return items as CreditDebitNote[];
}

export async function get(id: string) { return db.getItem(`CD_NOTE#${id}`) as Promise<CreditDebitNote | null>; }

export async function create(data: Partial<CreditDebitNote> & { clientId: string; kind: "credit" | "debit"; noteNumber: string; amount: number }) {
  const id = uuid(); const now = db.nowISO();
  const item: CreditDebitNote = {
    pk: `CD_NOTE#${id}`, sk: `CD_NOTE#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`, gsi1sk: `CreditDebitNote#${now}`,
    entityType: "CreditDebitNote", id, clientId: data.clientId,
    kind: data.kind, noteNumber: data.noteNumber, noteDate: data.noteDate || db.todayDate(),
    amount: data.amount, reason: data.reason || null,
    status: data.status || "pending",
    invoiceId: data.invoiceId || null, purchaseInvoiceId: data.purchaseInvoiceId || null,
    counterparty: data.counterparty || null,
    lineItems: data.lineItems || [], subtotal: data.subtotal || null,
    taxRate: data.taxRate || 0, taxAmount: data.taxAmount || 0,
    notes: data.notes || null, documents: data.documents || [],
    source: data.source || "manual",
    createdAt: now, updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<CreditDebitNote>) {
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  const allowed = ["kind","noteNumber","noteDate","amount","reason","status","invoiceId","purchaseInvoiceId","counterparty","lineItems","subtotal","taxRate","taxAmount","notes","documents"];
  for (const k of allowed) { if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k]; }
  return db.updateItem(`CD_NOTE#${id}`, `CD_NOTE#${id}`, patch);
}

export async function remove(id: string) { return db.deleteItem(`CD_NOTE#${id}`); }
