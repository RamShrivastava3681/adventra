import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export type BulkPaymentMode = "manual" | "fifo" | "two_pass_fifo";

export interface BulkPaymentClosedInvoice {
  id: string;
  invoiceNumber: string;
  amount: number;
}

export interface BulkPaymentPartialInvoice {
  id: string;
  invoiceNumber: string;
  amountPaid: number;
}

export interface BulkPayment {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "BulkPayment";
  id: string;
  clientId: string;
  /**
   * Party this payment belongs to. Debtor id for AR payments,
   * `vendor_<id>` for supplier (AP) payments — the prefix keeps AR/AP
   * balances in one table without colliding.
   */
  debtorId: string;
  amount: number;
  paymentDate: string;
  /** Unapplied leftover carried forward to future payments. */
  remaining: number;
  invoicesClosed: number;
  closedInvoices: BulkPaymentClosedInvoice[];
  partialInvoices: BulkPaymentPartialInvoice[];
  creditNoteIds: string[];
  mode: BulkPaymentMode;
  createdAt: string;
  updatedAt: string;
}

export async function list(clientId?: string) {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, { entityType: "BulkPayment", limit: 500, reverse: true });
    return items as BulkPayment[];
  }
  return db.scanByType("BulkPayment", { limit: 2000 }) as Promise<BulkPayment[]>;
}

export async function get(id: string) {
  return db.getItem(`BULK_PAYMENT#${id}`) as Promise<BulkPayment | null>;
}

export async function create(
  data: Pick<BulkPayment, "clientId" | "debtorId" | "amount" | "paymentDate" | "remaining" | "invoicesClosed" | "closedInvoices" | "partialInvoices" | "creditNoteIds" | "mode">,
) {
  const id = uuid();
  const now = db.nowISO();
  const item: BulkPayment = {
    pk: `BULK_PAYMENT#${id}`,
    sk: `BULK_PAYMENT#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`,
    gsi1sk: `BulkPayment#${now}`,
    entityType: "BulkPayment",
    id,
    clientId: data.clientId,
    debtorId: data.debtorId,
    amount: data.amount,
    paymentDate: data.paymentDate,
    remaining: data.remaining,
    invoicesClosed: data.invoicesClosed,
    closedInvoices: data.closedInvoices,
    partialInvoices: data.partialInvoices,
    creditNoteIds: data.creditNoteIds,
    mode: data.mode,
    createdAt: now,
    updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

/** Zero out the carried-forward balance once it has been consumed. */
export async function consumeRemaining(id: string) {
  return db.updateItem(`BULK_PAYMENT#${id}`, `BULK_PAYMENT#${id}`, {
    remaining: 0,
    updatedAt: db.nowISO(),
  });
}

export async function remove(id: string) {
  return db.deleteItem(`BULK_PAYMENT#${id}`);
}
