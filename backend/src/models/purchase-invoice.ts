import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export interface PurchaseInvoice {
  pk: string; sk: string; gsi1pk: string; gsi1sk: string;
  entityType: "PurchaseInvoice";
  id: string; clientId: string; vendorId: string;
  invoiceNumber: string; amount: number;
  poNumber: string | null; poDate: string | null; poAmount: number | null;
  issueDate: string; dueDate: string | null; paidDate: string | null;
  status: string; notes: string | null;
  advanceRate: number; advancePaidDate: string | null;
  fundedDate: string | null; purchaseOrderId: string | null;
  documents: any[];
  /** Tracks the last date an overdue reminder email was sent (YYYY-MM-DD). Used by the daily reminder cron. */
  lastOverdueReminderDate: string | null;
  createdAt: string; updatedAt: string;
}

export async function list(clientId?: string) {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, { entityType: "PurchaseInvoice", limit: 500, reverse: true });
    return items as PurchaseInvoice[];
  }
  return db.scanByType("PurchaseInvoice", { limit: 2000 }) as Promise<PurchaseInvoice[]>;
}

export async function get(id: string) { return db.getItem(`PURCHASE_INVOICE#${id}`) as Promise<PurchaseInvoice | null>; }

export async function create(data: Partial<PurchaseInvoice> & { clientId: string; vendorId: string; invoiceNumber: string; amount: number }) {
  const id = uuid(); const now = db.nowISO();
  const item: PurchaseInvoice = {
    pk: `PURCHASE_INVOICE#${id}`, sk: `PURCHASE_INVOICE#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`, gsi1sk: `PurchaseInvoice#${now}`,
    entityType: "PurchaseInvoice", id, clientId: data.clientId, vendorId: data.vendorId,
    invoiceNumber: data.invoiceNumber, amount: data.amount,
    poNumber: data.poNumber || null, poDate: data.poDate || null, poAmount: data.poAmount || null,
    issueDate: data.issueDate || db.todayDate(), dueDate: data.dueDate || null, paidDate: null,
    status: data.status || "pending", notes: data.notes || null,
    lastOverdueReminderDate: null,
    advanceRate: data.advanceRate ?? 0.80, advancePaidDate: null,
    fundedDate: null, purchaseOrderId: data.purchaseOrderId || null,
    documents: data.documents || [], createdAt: now, updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<PurchaseInvoice>) {
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  const allowed = ["amount","status","paidDate","dueDate","issueDate","invoiceNumber","vendorId","poNumber","poDate","poAmount","notes","advanceRate","advancePaidDate","fundedDate","purchaseOrderId","documents","lastOverdueReminderDate"];
  for (const k of allowed) { if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k]; }
  return db.updateItem(`PURCHASE_INVOICE#${id}`, `PURCHASE_INVOICE#${id}`, patch);
}

export async function remove(id: string) { return db.deleteItem(`PURCHASE_INVOICE#${id}`); }
