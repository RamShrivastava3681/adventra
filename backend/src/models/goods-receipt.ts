import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

/**
 * Goods Received Note (GRN) — created when goods actually arrive against a
 * Purchase Order. THIS is what credits inventory: only a CONFIRMED GRN creates
 * stock-in movements (for the accepted quantity of each line). The PO, proforma
 * and purchase invoice never touch stock.
 *
 * Lifecycle:
 *   draft     → created; editable; no stock impact.
 *   confirmed → stock-in movements created (accepted qty) + PO received qty
 *               folded in. Confirm is idempotent (stockCredited flag).
 *   cancelled → reversing debit (stock-out) entries created ONLY if stock had
 *               already been credited; PO quantities revoked.
 */

export interface GoodsReceiptLine {
  productId: string;
  sku: string | null;
  name: string;
  /** Unit of measure from the catalogue (piece, pair, carton…). */
  unit: string;
  /** Ordered quantity on the PO line (snapshot). */
  orderedQty: number;
  /** Quantity actually received (manual entry or barcode scan). */
  receivedQty: number;
  /** Quantity accepted into stock — this is what gets credited. */
  acceptedQty: number;
  /** Rejected / damaged quantity (optional). */
  rejectedQty: number;
  /** Unit cost at receipt — used to value the stock-in movement. */
  unitCost: number;
  gstRate: number | null;
  /** System-calculated: acceptedQty × unitCost. */
  lineValue: number;
  /** Optional per-line note. */
  notes: string | null;
}

export interface GoodsReceipt {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "GoodsReceipt";
  id: string;
  clientId: string;
  /** System-generated (GRN-XXXXXXXX). */
  receiptNumber: string;
  goodsPurchaseOrderId: string;
  poNumber: string | null;
  supplierId: string | null;
  supplierName: string | null;
  /** Delivery warehouse / store. */
  warehouse: string | null;
  receivedDate: string;
  /** Linked purchase invoice (optional at this stage). */
  purchaseInvoiceId: string | null;
  /** Supplier delivery challan number (optional). */
  challanNumber: string | null;
  /** Warehouse user who received the goods. */
  receivedById: string | null;
  receivedBy: string | null;
  notes: string | null;
  /** Delivery challan / photo attachments (optional). */
  documents: any[];
  status: "draft" | "confirmed" | "cancelled" | "received";
  /** True once stock has been credited — Confirm is idempotent on this. */
  stockCredited: boolean;
  creditedAt: string | null;
  creditedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  lines: GoodsReceiptLine[];

  /** Stock location where goods are received. Defaults to Central Warehouse. */
  receivingLocationId: string | null;

  createdAt: string;
  updatedAt: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalizeLines(lines: GoodsReceiptLine[]): GoodsReceiptLine[] {
  return (lines ?? []).map((l) => {
    const receivedQty = Number(l.receivedQty) || 0;
    const acceptedQty = Number.isFinite(Number(l.acceptedQty)) ? Number(l.acceptedQty) : receivedQty;
    const rejectedQty = Number.isFinite(Number(l.rejectedQty)) ? Number(l.rejectedQty) : 0;
    const unitCost = Number(l.unitCost) || 0;
    return {
      ...l,
      unit: l.unit || "unit",
      receivedQty,
      acceptedQty,
      rejectedQty,
      unitCost,
      lineValue: round2(acceptedQty * unitCost),
      notes: l.notes || null,
    };
  });
}

export async function list(clientId: string) {
  const { items } = await db.queryByGSI1(clientId, { entityType: "GoodsReceipt", limit: 500, reverse: true });
  return items as GoodsReceipt[];
}

export async function get(id: string) {
  return db.getItem(`GOODS_RECEIPT#${id}`) as Promise<GoodsReceipt | null>;
}

export async function create(data: Partial<GoodsReceipt> & { clientId: string; goodsPurchaseOrderId: string; lines: GoodsReceiptLine[] }) {
  const id = uuid();
  const now = db.nowISO();
  const lines = normalizeLines(data.lines ?? []);
  const item: GoodsReceipt = {
    pk: `GOODS_RECEIPT#${id}`,
    sk: `GOODS_RECEIPT#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`,
    gsi1sk: `GoodsReceipt#${now}`,
    entityType: "GoodsReceipt",
    id,
    clientId: data.clientId,
    receiptNumber: data.receiptNumber || `GRN-${id.slice(0, 8).toUpperCase()}`,
    goodsPurchaseOrderId: data.goodsPurchaseOrderId,
    poNumber: data.poNumber || null,
    supplierId: data.supplierId || null,
    supplierName: data.supplierName || null,
    warehouse: data.warehouse || null,
    receivedDate: data.receivedDate || db.todayDate(),
    purchaseInvoiceId: data.purchaseInvoiceId || null,
    challanNumber: data.challanNumber || null,
    receivedById: data.receivedById || null,
    receivedBy: data.receivedBy || null,
    notes: data.notes || null,
    documents: data.documents || [],
    status: data.status || "draft",
    stockCredited: data.status === "confirmed" || data.stockCredited === true,
    creditedAt: data.creditedAt || null,
    creditedBy: data.creditedBy || null,
    cancelledAt: data.cancelledAt || null,
    cancelledBy: data.cancelledBy || null,
    lines,
    receivingLocationId: data.receivingLocationId || null,
    createdAt: now,
    updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<GoodsReceipt>) {
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  const allowed = [
    "receiptNumber", "goodsPurchaseOrderId", "poNumber", "supplierId", "supplierName",
    "warehouse", "receivedDate", "purchaseInvoiceId", "challanNumber",
    "receivedById", "receivedBy", "notes", "documents", "status", "stockCredited",
    "creditedAt", "creditedBy", "cancelledAt", "cancelledBy", "lines",
    "receivingLocationId",
  ];
  for (const k of allowed) {
    if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k];
  }
  if (updates.lines !== undefined) patch.lines = normalizeLines(updates.lines as GoodsReceiptLine[]);
  return db.updateItem(`GOODS_RECEIPT#${id}`, `GOODS_RECEIPT#${id}`, patch);
}

/**
 * Atomic draft → confirmed flip. Returns the updated item, or null if the GRN
 * was already confirmed (or is cancelled) — callers must only credit stock when
 * this returns a value, so concurrent confirm requests can't double-credit.
 *
 * NOTE: the condition only checks the status. `attribute_not_exists(creditedAt)`
 * is intentionally NOT used here — create() stores `creditedAt: null` (a NULL
 * DynamoDB attribute still exists), which would make that check always fail and
 * silently turn every confirm into a no-op.
 */
export async function flipToConfirmed(id: string, creditedBy: string) {
  return db.updateItemIf(
    `GOODS_RECEIPT#${id}`,
    `GOODS_RECEIPT#${id}`,
    {
      status: "confirmed",
      stockCredited: true,
      creditedAt: db.nowISO(),
      creditedBy,
      updatedAt: db.nowISO(),
    },
    "#status = :draft",
    { ":draft": "draft" },
    true,
    { "#status": "status" },
  ) as Promise<GoodsReceipt | null>;
}

/**
 * Atomic → cancelled flip. Returns the updated item, or null if already
 * cancelled. Callers decide whether to reverse stock based on the prior status
 * (confirmed/received = credited).
 *
 * NOTE: like flipToConfirmed, the condition only checks the status — the old
 * `attribute_not_exists(cancelledAt)` guard never passed because create()
 * stores `cancelledAt: null`, silently breaking every cancel.
 */
export async function flipToCancelled(id: string, cancelledBy: string) {
  return db.updateItemIf(
    `GOODS_RECEIPT#${id}`,
    `GOODS_RECEIPT#${id}`,
    {
      status: "cancelled",
      cancelledAt: db.nowISO(),
      cancelledBy,
      updatedAt: db.nowISO(),
    },
    "#status <> :cancelled",
    { ":cancelled": "cancelled" },
    true,
    { "#status": "status" },
  ) as Promise<GoodsReceipt | null>;
}

export async function remove(id: string) {
  return db.deleteItem(`GOODS_RECEIPT#${id}`);
}
