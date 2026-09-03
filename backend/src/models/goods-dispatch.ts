import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

/**
 * Goods Dispatch Note — the most important stock document on the sales side.
 * Created against a Sales Order; THIS is what debits inventory: only a
 * CONFIRMED dispatch creates stock-out movements (for the dispatched quantity
 * of each line). The SO, proforma and sales invoice never touch stock.
 *
 * Lifecycle (mirrors GoodsReceipt, plus delivery/return tracking):
 *   draft     → created from an SO; editable; no stock impact.
 *   confirmed → stock-out movements created (dispatched qty) + SO dispatched
 *               qty folded in. Confirm is idempotent (stockDebited flag).
 *   partially_delivered / delivered → per-line delivered qty recorded by
 *               "Mark Delivered" (no stock impact — already debited).
 *   returned  → per-line returned qty recorded by "Record Return"; reversing
 *               credit (stock-in) entries created for the returned qty and the
 *               SO dispatched qty is revoked so the SO can be re-dispatched.
 *   cancelled → reversing credit entries created ONLY if stock had already
 *               been debited; SO quantities revoked.
 */

export type GoodsDispatchStatus =
  | "draft"
  | "confirmed"
  | "partially_delivered"
  | "delivered"
  | "cancelled"
  | "returned";

/** Dispatch types — determines stock impact behavior. */
export type DispatchType =
  | "customer_sale"
  | "marketplace_sale"
  | "pos_sale"
  | "stock_transfer"
  | "customer_return"
  | "return_to_supplier"
  | "damage_sample_adjustment";

export const DISPATCH_TYPES: DispatchType[] = [
  "customer_sale",
  "marketplace_sale",
  "pos_sale",
  "stock_transfer",
  "customer_return",
  "return_to_supplier",
  "damage_sample_adjustment",
];

export const DISPATCH_TYPE_LABELS: Record<DispatchType, string> = {
  customer_sale: "Customer Sale",
  marketplace_sale: "Marketplace Sale",
  pos_sale: "POS Sale",
  stock_transfer: "Stock Transfer",
  customer_return: "Customer Return",
  return_to_supplier: "Return to Supplier",
  damage_sample_adjustment: "Damage / Sample / Adjustment",
};

export interface GoodsDispatchLine {
  productId: string;
  sku: string | null;
  name: string;
  /** Unit of measure from the catalogue (piece, pair, carton…). */
  unit: string;
  /** Ordered quantity on the SO line (snapshot). */
  orderedQty: number;
  /** Quantity actually dispatched on this note. */
  dispatchedQty: number;
  /** System-maintained: quantity confirmed delivered to the customer. */
  deliveredQty: number;
  /** System-maintained: quantity returned by the customer. */
  returnedQty: number;
  /** Unit selling price at dispatch (snapshot from the SO line). */
  unitPrice: number;
  /** Discount percentage from the SO line (snapshot). */
  discountPct: number | null;
  gstRate: number | null;
  /** System-calculated: dispatchedQty × unitPrice × (1 − discountPct/100). */
  lineValue: number;
  /** Optional per-line note. */
  notes: string | null;
}

export interface GoodsDispatch {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "GoodsDispatch";
  id: string;
  clientId: string;
  /** System-generated (DSP-XXXXXXXX). */
  dispatchNumber: string;
  goodsSalesOrderId: string;
  soNumber: string | null;
  customerId: string | null;
  customerName: string | null;
  contactPerson: string | null;
  deliveryAddress: string | null;
  /** Warehouse / store goods are dispatched from. */
  warehouse: string | null;
  dispatchDate: string;
  /** Transporter / courier name — optional. */
  transporterName: string | null;
  /** Tracking / AWB number — optional. */
  trackingNumber: string | null;
  /** Delivery challan number — optional. */
  deliveryChallanNumber: string | null;
  /** Linked customer proforma invoice — optional. */
  linkedCustomerProformaId: string | null;
  linkedCustomerProformaNumber: string | null;
  /** Linked sales invoice — optional. */
  linkedSalesInvoiceId: string | null;
  linkedSalesInvoiceNumber: string | null;
  /** User who packed / dispatched the goods (system-attributed). */
  dispatchedById: string | null;
  dispatchedBy: string | null;
  /** Date goods were confirmed delivered (Mark Delivered). */
  deliveryDate: string | null;
  deliveredAt: string | null;
  deliveredBy: string | null;
  returnedAt: string | null;
  returnedBy: string | null;
  notes: string | null;
  documents: any[];
  status: GoodsDispatchStatus;
  /** True once stock has been debited — Confirm is idempotent on this. */
  stockDebited: boolean;
  debitedAt: string | null;
  debitedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  // ── E-Way Bill fields ──
  /** Linked E-Way Bill record ID (set after EWB generation). */
  ewayBillId: string | null;
  /** EWB number assigned by the NIC portal (12-digit). */
  ewayBillNumber: string | null;
  /** EWB lifecycle status: pending, generated, vehicle_updated, cancelled, failed. */
  ewayBillStatus: string | null;
  lines: GoodsDispatchLine[];

  // ── Location-based inventory fields ──
  /** Dispatch type — determines stock impact behavior. */
  dispatchType: DispatchType | null;
  /** Source location for the dispatch. */
  sourceLocationId: string | null;
  /** Destination location (for transfers: the receiving location). */
  destinationLocationId: string | null;
  /** Channel: Amazon, Flipkart, etc. For marketplace sales. */
  channel: string | null;

  createdAt: string;
  updatedAt: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalizeLines(lines: GoodsDispatchLine[]): GoodsDispatchLine[] {
  return (lines ?? []).map((l) => {
    const orderedQty = Number(l.orderedQty) || 0;
    const dispatchedQty = Number(l.dispatchedQty) || 0;
    const unitPrice = Number(l.unitPrice) || 0;
    const discountPct =
      l.discountPct === undefined || l.discountPct === null
        ? null
        : Math.min(100, Math.max(0, Number(l.discountPct) || 0));
    return {
      ...l,
      unit: l.unit || "unit",
      orderedQty,
      dispatchedQty,
      deliveredQty: Number(l.deliveredQty) || 0,
      returnedQty: Number(l.returnedQty) || 0,
      unitPrice,
      discountPct,
      lineValue: round2(dispatchedQty * unitPrice * (1 - (discountPct ?? 0) / 100)),
      notes: l.notes || null,
    };
  });
}

/** Derive the delivered state from per-line delivered quantities. */
export function recomputeDeliveredStatus(
  dispatch: Pick<GoodsDispatch, "status" | "lines">,
): GoodsDispatchStatus {
  const lines = dispatch.lines ?? [];
  const anyDelivered = lines.some((l) => (l.deliveredQty ?? 0) > 0);
  const allDelivered =
    lines.length > 0 &&
    lines.every((l) => (l.deliveredQty ?? 0) >= (l.dispatchedQty ?? 0));
  if (allDelivered) return "delivered";
  if (anyDelivered) return "partially_delivered";
  return dispatch.status;
}

export async function list(clientId?: string) {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, { entityType: "GoodsDispatch", limit: 500, reverse: true });
    return items as GoodsDispatch[];
  }
  return db.scanByType("GoodsDispatch", { limit: 2000 }) as Promise<GoodsDispatch[]>;
}

export async function get(id: string) {
  return db.getItem(`GOODS_DISPATCH#${id}`) as Promise<GoodsDispatch | null>;
}

export async function create(data: Partial<GoodsDispatch> & { clientId: string; goodsSalesOrderId: string; lines: GoodsDispatchLine[] }) {
  const id = uuid();
  const now = db.nowISO();
  const lines = normalizeLines(data.lines ?? []);
  const item: GoodsDispatch = {
    pk: `GOODS_DISPATCH#${id}`,
    sk: `GOODS_DISPATCH#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`,
    gsi1sk: `GoodsDispatch#${now}`,
    entityType: "GoodsDispatch",
    id,
    clientId: data.clientId,
    dispatchNumber: data.dispatchNumber || `DSP-${id.slice(0, 8).toUpperCase()}`,
    goodsSalesOrderId: data.goodsSalesOrderId,
    soNumber: data.soNumber || null,
    customerId: data.customerId || null,
    customerName: data.customerName || null,
    contactPerson: data.contactPerson || null,
    deliveryAddress: data.deliveryAddress || null,
    warehouse: data.warehouse || null,
    dispatchDate: data.dispatchDate || db.todayDate(),
    transporterName: data.transporterName || null,
    trackingNumber: data.trackingNumber || null,
    deliveryChallanNumber: data.deliveryChallanNumber || null,
    linkedCustomerProformaId: data.linkedCustomerProformaId || null,
    linkedCustomerProformaNumber: data.linkedCustomerProformaNumber || null,
    linkedSalesInvoiceId: data.linkedSalesInvoiceId || null,
    linkedSalesInvoiceNumber: data.linkedSalesInvoiceNumber || null,
    dispatchedById: data.dispatchedById || null,
    dispatchedBy: data.dispatchedBy || null,
    deliveryDate: data.deliveryDate || null,
    deliveredAt: data.deliveredAt || null,
    deliveredBy: data.deliveredBy || null,
    returnedAt: data.returnedAt || null,
    returnedBy: data.returnedBy || null,
    notes: data.notes || null,
    documents: data.documents || [],
    status: data.status || "draft",
    stockDebited: data.status === "confirmed" || data.stockDebited === true,
    debitedAt: data.debitedAt || null,
    debitedBy: data.debitedBy || null,
    cancelledAt: data.cancelledAt || null,
    cancelledBy: data.cancelledBy || null,
    ewayBillId: data.ewayBillId || null,
    ewayBillNumber: data.ewayBillNumber || null,
    ewayBillStatus: data.ewayBillStatus || null,
    lines,
    // Location-based fields
    dispatchType: data.dispatchType || null,
    sourceLocationId: data.sourceLocationId || null,
    destinationLocationId: data.destinationLocationId || null,
    channel: data.channel || null,
    createdAt: now,
    updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<GoodsDispatch>) {
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  const allowed = [
    "dispatchNumber", "goodsSalesOrderId", "soNumber", "customerId", "customerName",
    "contactPerson", "deliveryAddress", "warehouse", "dispatchDate",
    "transporterName", "trackingNumber", "deliveryChallanNumber",
    "linkedCustomerProformaId", "linkedCustomerProformaNumber",
    "linkedSalesInvoiceId", "linkedSalesInvoiceNumber",
    "dispatchedById", "dispatchedBy", "deliveryDate", "deliveredAt", "deliveredBy",
    "returnedAt", "returnedBy", "notes", "documents", "status", "stockDebited",
    "debitedAt", "debitedBy", "cancelledAt", "cancelledBy",
    "ewayBillId", "ewayBillNumber", "ewayBillStatus",
    "lines",
    // Location fields
    "dispatchType", "sourceLocationId", "destinationLocationId", "channel",
  ];
  for (const k of allowed) {
    if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k];
  }
  if (updates.lines !== undefined) patch.lines = normalizeLines(updates.lines as GoodsDispatchLine[]);
  return db.updateItem(`GOODS_DISPATCH#${id}`, `GOODS_DISPATCH#${id}`, patch);
}

/**
 * Atomic draft → confirmed flip. Returns the updated item, or null if the
 * dispatch was already confirmed (or is cancelled) — callers must only debit
 * stock when this returns a value, so concurrent confirms can't double-debit.
 *
 * NOTE: the condition only checks the status. `attribute_not_exists(debitedAt)`
 * is intentionally NOT used here — create() stores `debitedAt: null` (a NULL
 * DynamoDB attribute still exists), which would make that check always fail and
 * silently turn every confirm into a no-op.
 */
export async function flipToConfirmed(id: string, debitedBy: string) {
  return db.updateItemIf(
    `GOODS_DISPATCH#${id}`,
    `GOODS_DISPATCH#${id}`,
    {
      status: "confirmed",
      stockDebited: true,
      debitedAt: db.nowISO(),
      debitedBy,
      updatedAt: db.nowISO(),
    },
    "#status = :draft",
    { ":draft": "draft" },
    true,
    { "#status": "status" },
  ) as Promise<GoodsDispatch | null>;
}

/**
 * Atomic → cancelled flip. Returns the updated item, or null if already
 * cancelled. Callers decide whether to reverse stock based on the prior status
 * (confirmed/delivered/returned = debited).
 *
 * NOTE: like flipToConfirmed, the condition only checks the status — the old
 * `attribute_not_exists(cancelledAt)` guard never passed because create()
 * stores `cancelledAt: null`, silently breaking every cancel.
 */
export async function flipToCancelled(id: string, cancelledBy: string) {
  return db.updateItemIf(
    `GOODS_DISPATCH#${id}`,
    `GOODS_DISPATCH#${id}`,
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
  ) as Promise<GoodsDispatch | null>;
}

/**
 * Mark delivered: fold per-line delivered quantities in, record the delivery
 * date and derive the delivered status (partially_delivered / delivered).
 */
export async function markDelivered(
  id: string,
  deliveredLines: Array<{ productId: string; deliveredQty: number }>,
  deliveryDate: string | null,
  deliveredBy: string,
) {
  const d = await get(id);
  if (!d) throw new Error("Dispatch note not found");
  const lines = (d.lines ?? []).map((l) => {
    const x = deliveredLines.find((v) => v.productId === l.productId);
    return x ? { ...l, deliveredQty: (l.deliveredQty ?? 0) + x.deliveredQty } : l;
  });
  return update(id, {
    lines,
    status: recomputeDeliveredStatus({ status: d.status, lines }),
    deliveryDate: deliveryDate || d.deliveryDate || db.todayDate(),
    deliveredAt: db.nowISO(),
    deliveredBy,
  });
}

/**
 * Record return: fold per-line returned quantities in and close the dispatch
 * as "returned". Stock reversal movements are created by the caller (route) —
 * this only records the document state.
 */
export async function recordReturned(
  id: string,
  returnedLines: Array<{ productId: string; returnedQty: number }>,
  returnedBy: string,
) {
  const d = await get(id);
  if (!d) throw new Error("Dispatch note not found");
  const lines = (d.lines ?? []).map((l) => {
    const x = returnedLines.find((v) => v.productId === l.productId);
    return x ? { ...l, returnedQty: (l.returnedQty ?? 0) + x.returnedQty } : l;
  });
  return update(id, {
    lines,
    status: "returned",
    returnedAt: db.nowISO(),
    returnedBy,
  });
}

export async function remove(id: string) {
  return db.deleteItem(`GOODS_DISPATCH#${id}`);
}
