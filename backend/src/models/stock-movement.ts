import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export const MOVEMENT_STATUSES = ["draft", "confirmed", "cancelled"] as const;

/**
 * Inventory movement — the atomic record of stock moving into (credit / "in")
 * or out of (debit / "out") a warehouse.
 *
 * Lifecycle:
 *   draft     → manual entries start here; NO stock impact.
 *   confirmed → only confirmed movements affect live stock (live stock =
 *               Σ confirmed credits − Σ confirmed debits). System actions
 *               (confirmed GRN, dispatched sales invoice) create movements
 *               already confirmed.
 *   cancelled → cancelled before/after confirm; cancelling a confirmed
 *               movement creates an opposite reversal entry so stock stays
 *               correct.
 *
 * Legacy records created before the status field existed are normalized to
 * "confirmed" by list/get (they already affected stock).
 */
export interface StockMovement {
  pk: string; sk: string; gsi1pk: string; gsi1sk: string; gsi2pk: string; gsi2sk: string;
  entityType: "StockMovement";
  id: string; clientId: string; productId: string | null;
  /** System-generated movement number (MOV-XXXXXXXX). */
  movementNumber: string;
  /** "in" (Credit) or "out" (Debit). */
  direction: "in" | "out"; itemName: string; sku: string | null;
  quantity: number; unit: string; unitCost: number | null;
  /** Delivery warehouse / store. */
  warehouse: string | null;
  /** Movement reason: Goods receipt / Dispatch / Customer return / Supplier return / Damage / Opening stock / Stock adjustment / Samples · internal use. */
  reason: string | null;
  /** Linked document type — GRN / Dispatch / PO / Purchase Invoice / Sales Invoice / Return / Adjustment. */
  linkedDocumentType: string | null;
  /** Linked document number (e.g. GRN-XXXX, PO-XXXX, invoice number). */
  linkedDocumentNumber: string | null;
  status: "draft" | "confirmed" | "cancelled";
  /** Attribution — system or the signing-in user. */
  createdById: string | null;
  createdByName: string | null;
  confirmedById: string | null;
  confirmedByName: string | null;
  confirmedAt: string | null;
  cancelledById: string | null;
  cancelledByName: string | null;
  cancelledAt: string | null;
  notes: string | null; movementDate: string;
  invoiceId: string | null; purchaseInvoiceId: string | null;
  /** GRN that created this stock-in movement (goods receipts). */
  goodsReceiptId: string | null;
  /** Goods PO this movement belongs to (GRN-created movements). */
  purchaseOrderId: string | null;
  createdAt: string; updatedAt: string;
}

/** Legacy records (pre-status) already moved stock → treat them as confirmed. */
function normalize(m: any): StockMovement {
  return {
    ...m,
    status: (MOVEMENT_STATUSES as readonly string[]).includes(m.status) ? m.status : "confirmed",
  };
}

export async function list(clientId: string) {
  const { items } = await db.queryByGSI1(clientId, { entityType: "StockMovement", limit: 500, reverse: true });
  return (items as any[]).map(normalize) as StockMovement[];
}

export async function listAll() {
  const items = await db.scanByType("StockMovement", { limit: 2000 });
  return (items as any[]).map(normalize) as StockMovement[];
}

export async function get(id: string) {
  const item = await db.getItem(`STOCK_MOVEMENT#${id}`);
  return item ? normalize(item) : null;
}

export async function create(data: Partial<StockMovement> & { clientId: string; direction: "in" | "out"; itemName: string; quantity: number }) {
  const id = uuid(); const now = db.nowISO();
  const item: StockMovement = {
    pk: `STOCK_MOVEMENT#${id}`, sk: `STOCK_MOVEMENT#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`, gsi1sk: `StockMovement#${now}`,
    gsi2pk: "StockMovement", gsi2sk: `StockMovement#${id}`,
    entityType: "StockMovement", id, clientId: data.clientId,
    movementNumber: data.movementNumber || `MOV-${id.slice(0, 8).toUpperCase()}`,
    productId: data.productId || null, direction: data.direction,
    itemName: data.itemName, sku: data.sku || null,
    quantity: data.quantity, unit: data.unit || "unit",
    unitCost: data.unitCost != null ? data.unitCost : null,
    warehouse: data.warehouse || null,
    reason: data.reason || null,
    linkedDocumentType: data.linkedDocumentType || null,
    linkedDocumentNumber: data.linkedDocumentNumber || null,
    status: (MOVEMENT_STATUSES as readonly string[]).includes(data.status as string) ? data.status as StockMovement["status"] : "confirmed",
    createdById: data.createdById || null,
    createdByName: data.createdByName || null,
    confirmedById: data.confirmedById || null,
    confirmedByName: data.confirmedByName || null,
    confirmedAt: data.confirmedAt || null,
    cancelledById: data.cancelledById || null,
    cancelledByName: data.cancelledByName || null,
    cancelledAt: data.cancelledAt || null,
    notes: data.notes || null, movementDate: data.movementDate || db.todayDate(),
    invoiceId: data.invoiceId || null, purchaseInvoiceId: data.purchaseInvoiceId || null,
    goodsReceiptId: data.goodsReceiptId || null,
    purchaseOrderId: data.purchaseOrderId || null,
    createdAt: now, updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

/**
 * Atomic draft → confirmed flip. Returns the updated item, or null if it was
 * already confirmed/cancelled — callers must only treat the movement as
 * confirmed when this returns a value (concurrent confirms can't double-count).
 */
export async function confirm(id: string, confirmedById: string, confirmedByName: string) {
  return db.updateItemIf(
    `STOCK_MOVEMENT#${id}`,
    `STOCK_MOVEMENT#${id}`,
    {
      status: "confirmed",
      confirmedById,
      confirmedByName,
      confirmedAt: db.nowISO(),
      updatedAt: db.nowISO(),
    },
    "#status = :draft",
    { ":draft": "draft" },
    true,
    { "#status": "status" },
  ) as Promise<StockMovement | null>;
}

/**
 * Atomic → cancelled flip. Returns the updated item, or null if already
 * cancelled. Callers decide whether a reversal entry is needed based on the
 * prior status (confirmed = already affected stock).
 */
export async function cancel(id: string, cancelledById: string, cancelledByName: string) {
  return db.updateItemIf(
    `STOCK_MOVEMENT#${id}`,
    `STOCK_MOVEMENT#${id}`,
    {
      status: "cancelled",
      cancelledById,
      cancelledByName,
      cancelledAt: db.nowISO(),
      updatedAt: db.nowISO(),
    },
    "#status <> :cancelled AND attribute_not_exists(cancelledAt)",
    { ":cancelled": "cancelled" },
    true,
    { "#status": "status" },
  ) as Promise<StockMovement | null>;
}

export async function remove(id: string) {
  return db.deleteItem(`STOCK_MOVEMENT#${id}`);
}

export async function getByProduct(clientId: string, productId: string) {
  const all = await list(clientId);
  return all.filter((m) => m.productId === productId);
}

/** Live stock for a product = confirmed credits − confirmed debits. */
export async function getBalance(productId: string, allMovements: StockMovement[]) {
  return allMovements
    .filter((m) => m.productId === productId && m.status === "confirmed")
    .reduce((sum, m) => sum + (m.direction === "in" ? m.quantity : -m.quantity), 0);
}
