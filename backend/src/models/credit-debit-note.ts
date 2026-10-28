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
  /** Party id the note belongs to (supplier/vendor for purchase-side notes). */
  supplierId: string | null;
  /** Purchase return that raised this note (if any). */
  purchaseReturnId: string | null;
  purchaseReturnNumber: string | null;
  /** How much of this note has been applied to an invoice. */
  appliedAmount: number;
  appliedInvoiceId: string | null;
  appliedInvoiceNumber: string | null;
  appliedAt: string | null;
  lineItems: any[]; subtotal: number | null;
  taxRate: number; taxAmount: number;
  notes: string | null; documents: any[];
  source: string;
  createdAt: string; updatedAt: string;
  rejectedBy: string | null; rejectedAt: string | null; rejectionReason: string | null;
  approvedBy: string | null; approvedAt: string | null; approvedByName: string | null;
}

export async function list(clientId?: string) {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, { entityType: "CreditDebitNote", limit: 500, reverse: true });
    return items as CreditDebitNote[];
  }
  return db.scanByType("CreditDebitNote", { limit: 2000 }) as Promise<CreditDebitNote[]>;
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
    supplierId: data.supplierId || null,
    purchaseReturnId: data.purchaseReturnId || null,
    purchaseReturnNumber: data.purchaseReturnNumber || null,
    appliedAmount: Number(data.appliedAmount) || 0,
    appliedInvoiceId: data.appliedInvoiceId || null,
    appliedInvoiceNumber: data.appliedInvoiceNumber || null,
    appliedAt: data.appliedAt || null,
    lineItems: data.lineItems || [], subtotal: data.subtotal || null,
    taxRate: data.taxRate || 0, taxAmount: data.taxAmount || 0,
    notes: data.notes || null, documents: data.documents || [],
    source: data.source || "manual",
    rejectedBy: null, rejectedAt: null, rejectionReason: null,
    approvedBy: null, approvedAt: null, approvedByName: null,
    createdAt: now, updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<CreditDebitNote>) {
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  const allowed = ["kind","noteNumber","noteDate","amount","reason","status","invoiceId","purchaseInvoiceId","counterparty","lineItems","subtotal","taxRate","taxAmount","notes","documents","supplierId","purchaseReturnId","purchaseReturnNumber","appliedAmount","appliedInvoiceId","appliedInvoiceNumber","appliedAt","rejectedBy","rejectedAt","rejectionReason","approvedBy","approvedAt","approvedByName"];
  for (const k of allowed) { if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k]; }
  return db.updateItem(`CD_NOTE#${id}`, `CD_NOTE#${id}`, patch);
}

export async function remove(id: string) { return db.deleteItem(`CD_NOTE#${id}`); }
