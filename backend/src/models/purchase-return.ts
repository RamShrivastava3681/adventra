import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";
import { fyTag, nextInSeries } from "../lib/doc-series.js";
import { round2, type ComputedReturnLine } from "../lib/purchase-returns.js";

/**
 * Purchase Return — goods sent back to a supplier against a purchase invoice.
 *
 * Lifecycle:
 *   pending_approval → approved | rejected
 *   pending_approval → cancelled (by the maker)
 *
 * Stock is reduced ONLY on approval (status approved). Draft/pending/rejected/
 * cancelled returns never touch stock or supplier balances. A debit note is
 * created alongside the return and applied to the source invoice (if it still
 * has an outstanding balance) or held as supplier credit for a future invoice.
 */
export type PurchaseReturnStatus =
  | "pending_approval"
  | "approved"
  | "rejected"
  | "cancelled";

export interface PurchaseReturn {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  gsi2pk: string;
  gsi2sk: string;
  entityType: "PurchaseReturn";
  id: string;
  clientId: string;
  /** System-generated (ADV-<FY>-PR-001). */
  returnNumber: string;
  returnDate: string;
  purchaseInvoiceId: string;
  invoiceNumber: string;
  supplierId: string;
  supplierName: string | null;
  goodsPurchaseOrderId: string | null;
  warehouse: string | null;
  reason: string;
  notes: string | null;
  documents: any[];
  lines: ComputedReturnLine[];
  subtotal: number;
  gstTotal: number;
  totalAmount: number;
  status: PurchaseReturnStatus;
  /** Whom the checker signed off as. */
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedByName: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  /** The supplier debit note raised for this return. */
  debitNoteId: string | null;
  debitNoteNumber: string | null;
  /** Amount applied straight to the source invoice (0 when it was already paid). */
  appliedAmount: number;
  /** Amount left as supplier credit (available for a future invoice). */
  supplierCredit: number;
  /** Set once stock has been reduced — guards double stock-out on retries. */
  stockAppliedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function key(id: string) {
  return { pk: `PURCHASE_RETURN#${id}`, sk: `PURCHASE_RETURN#${id}` };
}

export async function nextReturnNumber(
  clientId: string,
  returnDate?: string | null,
): Promise<string> {
  // Shared-database mode: number against the whole portfolio so two users
  // can never allocate the same return number.
  void clientId;
  const prefix = `ADV-${fyTag(returnDate)}-PR-`;
  const returns = await list();
  return nextInSeries(prefix, returns.map((r) => r.returnNumber));
}

export async function list(clientId?: string) {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, {
      entityType: "PurchaseReturn",
      limit: 500,
      reverse: true,
    });
    return items as PurchaseReturn[];
  }
  return db.scanByType("PurchaseReturn", { limit: 2000 }) as Promise<PurchaseReturn[]>;
}

export async function listForInvoice(purchaseInvoiceId: string) {
  const items = await db.scanByType("PurchaseReturn", { limit: 2000 });
  return (items as PurchaseReturn[]).filter(
    (r) => r.purchaseInvoiceId === purchaseInvoiceId,
  );
}

export async function get(id: string) {
  return db.getItem(`PURCHASE_RETURN#${id}`) as Promise<PurchaseReturn | null>;
}

export async function create(
  data: Partial<PurchaseReturn> & {
    clientId: string;
    purchaseInvoiceId: string;
    invoiceNumber: string;
    supplierId: string;
    lines: ComputedReturnLine[];
    subtotal: number;
    gstTotal: number;
    totalAmount: number;
  },
) {
  const id = uuid();
  const now = db.nowISO();
  const { pk, sk } = key(id);
  const item: PurchaseReturn = {
    ...{ pk, sk },
    gsi1pk: `CLIENT#${data.clientId}`,
    gsi1sk: `PurchaseReturn#${now}`,
    gsi2pk: "PurchaseReturn",
    gsi2sk: `PURCHASE_RETURN#${id}`,
    entityType: "PurchaseReturn",
    id,
    clientId: data.clientId,
    returnNumber:
      data.returnNumber ||
      (await nextReturnNumber(data.clientId, data.returnDate || null)),
    returnDate: data.returnDate || db.todayDate(),
    purchaseInvoiceId: data.purchaseInvoiceId,
    invoiceNumber: data.invoiceNumber,
    supplierId: data.supplierId,
    supplierName: data.supplierName || null,
    goodsPurchaseOrderId: data.goodsPurchaseOrderId || null,
    warehouse: data.warehouse || null,
    reason: data.reason || "Purchase return",
    notes: data.notes || null,
    documents: data.documents || [],
    lines: data.lines,
    subtotal: round2(data.subtotal),
    gstTotal: round2(data.gstTotal),
    totalAmount: round2(data.totalAmount),
    status: data.status || "pending_approval",
    approvedBy: null,
    approvedByName: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedByName: null,
    rejectedAt: null,
    rejectionReason: null,
    debitNoteId: null,
    debitNoteNumber: null,
    appliedAmount: 0,
    supplierCredit: 0,
    stockAppliedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<PurchaseReturn>) {
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  const allowed = [
    "returnDate",
    "warehouse",
    "reason",
    "notes",
    "documents",
    "status",
    "approvedBy",
    "approvedByName",
    "approvedAt",
    "rejectedBy",
    "rejectedByName",
    "rejectedAt",
    "rejectionReason",
    "debitNoteId",
    "debitNoteNumber",
    "appliedAmount",
    "supplierCredit",
    "stockAppliedAt",
  ];
  for (const k of allowed) {
    if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k];
  }
  return db.updateItem(`PURCHASE_RETURN#${id}`, `PURCHASE_RETURN#${id}`, patch);
}

export async function remove(id: string) {
  return db.deleteItem(`PURCHASE_RETURN#${id}`);
}
