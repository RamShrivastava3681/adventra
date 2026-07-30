import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export interface Invoice {
  pk: string; sk: string; gsi1pk: string; gsi1sk: string; gsi2pk: string; gsi2sk: string;
  entityType: "Invoice";
  id: string; clientId: string; debtorId: string;
  invoiceNumber: string; amount: number;
  issueDate: string; dueDate: string;
  status: string;
  advanceRate: number; feeRate: number;
  paidDate: string | null; amountReceived: number | null; receiptDate: string | null;
  shortPayment: number | null; lateDays: number | null;
  poNumber: string | null; poDate: string | null; poAmount: number | null;
  purchaseInvoiceId: string | null; purchaseOrderId: string | null;
  supplierId: string | null;
  lineItems: any[];
  subtotal: number | null; taxRate: number; taxAmount: number;
  notes: string | null; documents: any[];
  noaStatus: string; noaToken: string | null; noaSentAt: string | null;
  noaRespondedAt: string | null; noaComments: string | null;
  source: string;
  /** Tracks the last date an overdue reminder email was sent (YYYY-MM-DD). Used by the daily reminder cron. */
  lastOverdueReminderDate: string | null;
  /** Secure token for one-click debtor reminder forwarding from the admin email. */
  debtorReminderToken: string | null;
  createdAt: string; updatedAt: string;
}

export async function list(clientId?: string) {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, { entityType: "Invoice", limit: 500, reverse: true });
    return items as Invoice[];
  }
  return db.scanByType("Invoice", { limit: 2000 }) as Promise<Invoice[]>;
}

export async function get(id: string) { return db.getItem(`INVOICE#${id}`) as Promise<Invoice | null>; }

export async function create(data: Partial<Invoice> & { clientId: string; debtorId: string; invoiceNumber: string; amount: number; dueDate: string }) {
  const id = uuid(); const now = db.nowISO();
  const item: Invoice = {
    pk: `INVOICE#${id}`, sk: `INVOICE#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`, gsi1sk: `Invoice#${now}`,
    gsi2pk: "Invoice", gsi2sk: `Invoice#${data.invoiceNumber}`,
    entityType: "Invoice", id,
    clientId: data.clientId, debtorId: data.debtorId,
    invoiceNumber: data.invoiceNumber, amount: data.amount,
    issueDate: data.issueDate || db.todayDate(), dueDate: data.dueDate,
    status: data.status || "pending",
    advanceRate: data.advanceRate ?? 0.80, feeRate: data.feeRate ?? 0.025,
    paidDate: null, amountReceived: null, receiptDate: null,
    shortPayment: null, lateDays: null,
    poNumber: data.poNumber || null, poDate: data.poDate || null, poAmount: data.poAmount || null,
    purchaseInvoiceId: data.purchaseInvoiceId || null, purchaseOrderId: data.purchaseOrderId || null,
    supplierId: data.supplierId || null,
    lineItems: data.lineItems || [],
    subtotal: data.subtotal || null, taxRate: data.taxRate || 0, taxAmount: data.taxAmount || 0,
    notes: data.notes || null, documents: data.documents || [],
    lastOverdueReminderDate: null,
    debtorReminderToken: uuid(),
    noaStatus: "not_sent", noaToken: uuid(), noaSentAt: null,
    noaRespondedAt: null, noaComments: null,
    source: data.source || "manual",
    createdAt: now, updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<Invoice>) {
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  const allowed = ["amount","status","paidDate","amountReceived","receiptDate","shortPayment","lateDays","advanceRate","feeRate","poNumber","poDate","poAmount","purchaseInvoiceId","purchaseOrderId","supplierId","lineItems","subtotal","taxRate","taxAmount","notes","documents","noaStatus","noaSentAt","noaRespondedAt","noaComments","issueDate","dueDate","invoiceNumber","debtorId","lastOverdueReminderDate","debtorReminderToken"];
  for (const k of allowed) { if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k]; }
  return db.updateItem(`INVOICE#${id}`, `INVOICE#${id}`, patch);
}

export async function remove(id: string) { return db.deleteItem(`INVOICE#${id}`); }

export async function getByNOAToken(token: string) {
  const items = await db.scanByType("Invoice");
  return items.find((i: any) => i.noaToken === token) as Invoice | undefined;
}
