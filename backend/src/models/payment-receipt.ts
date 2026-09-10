import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

/**
 * PaymentReceipt — Sales submits payment proof + UTR; Treasury verifies.
 * Sales can never mark money received (PDF-2 §6). One receipt links a
 * Proforma or Invoice (+ Sales Order) to a single verification decision.
 */

export type ReceiptStatus = "submitted" | "verified" | "rejected";

export interface PaymentReceipt {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "PaymentReceipt";
  id: string;
  clientId: string;
  salesOrderId: string | null;
  salesOrderNumber: string | null;
  proformaId: string | null;
  proformaNumber: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  amount: number;
  utr: string | null;
  paymentMode: string | null;
  proofName: string | null;
  proofUrl: string | null;
  submittedBy: string | null;
  submittedAt: string;
  status: ReceiptStatus;
  receiptDate: string | null;
  collectionAccount: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  rejectReason: string | null;
  createdAt: string;
  updatedAt: string;
}

function key(id: string) {
  return { pk: `PAYRECEIPT#${id}`, sk: `PAYRECEIPT#${id}` };
}

export async function list(clientId?: string): Promise<PaymentReceipt[]> {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, { entityType: "PaymentReceipt", limit: 500, reverse: true });
    return items as PaymentReceipt[];
  }
  return db.scanByType("PaymentReceipt", { limit: 2000 }) as Promise<PaymentReceipt[]>;
}

export async function get(id: string): Promise<PaymentReceipt | null> {
  const { pk, sk } = key(id);
  return db.getItem(pk, sk) as Promise<PaymentReceipt | null>;
}

export async function submit(data: {
  clientId: string;
  salesOrderId?: string | null;
  salesOrderNumber?: string | null;
  proformaId?: string | null;
  proformaNumber?: string | null;
  invoiceId?: string | null;
  invoiceNumber?: string | null;
  amount: number;
  utr?: string | null;
  paymentMode?: string | null;
  proofName?: string | null;
  proofUrl?: string | null;
  submittedBy: string;
}): Promise<PaymentReceipt> {
  if (!(Number(data.amount) > 0)) throw new Error("Receipt amount must be greater than zero");
  if (!data.proformaId && !data.invoiceId)
    throw new Error("Link the receipt to a Proforma or an Invoice");
  const id = uuid();
  const now = db.nowISO();
  const { pk, sk } = key(id);
  const item: PaymentReceipt = {
    pk,
    sk,
    gsi1pk: `CLIENT#${data.clientId}`,
    gsi1sk: `PaymentReceipt#${now}`,
    entityType: "PaymentReceipt",
    id,
    clientId: data.clientId,
    salesOrderId: data.salesOrderId || null,
    salesOrderNumber: data.salesOrderNumber || null,
    proformaId: data.proformaId || null,
    proformaNumber: data.proformaNumber || null,
    invoiceId: data.invoiceId || null,
    invoiceNumber: data.invoiceNumber || null,
    amount: Math.round(Number(data.amount) * 100) / 100,
    utr: data.utr?.trim() || null,
    paymentMode: data.paymentMode?.trim() || null,
    proofName: data.proofName || null,
    proofUrl: data.proofUrl || null,
    submittedBy: data.submittedBy,
    submittedAt: now,
    status: "submitted",
    receiptDate: null,
    collectionAccount: null,
    verifiedBy: null,
    verifiedAt: null,
    rejectReason: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function verify(
  id: string,
  data: { receiptDate: string; collectionAccount?: string | null; paymentMode?: string | null; verifiedBy: string },
): Promise<PaymentReceipt> {
  const current = await get(id);
  if (!current) throw new Error("Receipt not found");
  if (current.status !== "submitted") throw new Error("Receipt is already decided");
  if (!/^\d{4}-\d{2}-\d{2}/.test(data.receiptDate || "")) throw new Error("Receipt date must be YYYY-MM-DD");
  const { pk, sk } = key(id);
  return db.updateItem(pk, sk, {
    status: "verified",
    receiptDate: data.receiptDate.slice(0, 10),
    collectionAccount: data.collectionAccount?.trim() || null,
    paymentMode: data.paymentMode?.trim() || current.paymentMode,
    verifiedBy: data.verifiedBy,
    verifiedAt: db.nowISO(),
    updatedAt: db.nowISO(),
  }) as Promise<PaymentReceipt>;
}

export async function reject(id: string, reason: string, actor: string): Promise<PaymentReceipt> {
  const current = await get(id);
  if (!current) throw new Error("Receipt not found");
  if (current.status !== "submitted") throw new Error("Receipt is already decided");
  if (!reason?.trim()) throw new Error("A reason is required to reject payment proof");
  const { pk, sk } = key(id);
  await db.updateItem(pk, sk, {
    status: "rejected",
    rejectReason: reason.trim(),
    verifiedBy: actor,
    verifiedAt: db.nowISO(),
    updatedAt: db.nowISO(),
  });
  return get(id) as Promise<PaymentReceipt>;
}

/** Total Treasury-verified amount linked to a proforma (never double-counts). */
export async function verifiedTotalForProforma(proformaId: string): Promise<number> {
  const items = await db.scanByType("PaymentReceipt", { limit: 2000 });
  return (items as PaymentReceipt[])
    .filter((r) => r.proformaId === proformaId && r.status === "verified")
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);
}

/** Total Treasury-verified amount linked to an invoice. */
export async function verifiedTotalForInvoice(invoiceId: string): Promise<number> {
  const items = await db.scanByType("PaymentReceipt", { limit: 2000 });
  return (items as PaymentReceipt[])
    .filter((r) => r.invoiceId === invoiceId && r.status === "verified")
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);
}
