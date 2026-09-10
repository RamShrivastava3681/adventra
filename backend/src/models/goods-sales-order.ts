import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";
import { PaymentTermsType, DispatchCondition, DueBasis, normalizePaymentTermsType, normalizeAdvancePct, normalizeBalancePct, normalizeBalanceDueDays, normalizeDueBasis, normalizeDispatchCondition, balancePctFor } from "../lib/payment-terms.js";

/**
 * Goods Sales Order (SO) — a customer's confirmed order against the product
 * catalogue. An SO NEVER debits inventory: stock only reduces after a
 * CONFIRMED dispatch note. Dispatched quantities are updated from dispatch
 * notes via recordDispatch.
 *
 * Mirrors GoodsPurchaseOrder (goods-purchase-order.js): sales side of the
 * same document pattern.
 */

export interface GoodsSalesOrderLine {
  productId: string;
  sku: string | null;
  name: string;
  /** Unit of measure from the catalogue (piece, pair, carton…) */
  unit: string;
  /** Quantity the customer ordered. */
  orderedQty: number;
  /** System-maintained: sum of dispatched quantities from dispatch notes. */
  dispatchedQty: number;
  /** Unit selling price agreed with the customer. */
  unitPrice: number;
  /** Discount percentage (0–100), optional — GST applies to the discounted value. */
  discountPct: number | null;
  /** GST rate as a percentage (0–99), from the catalogue or overridden. */
  gstRate: number | null;
  /** Server snapshot from the catalogue (overwritten on every save): variant colour. */
  color: string | null;
  /** Server snapshot from the catalogue (overwritten on every save): variant size. */
  size: string | null;
  /** Server snapshot (overwritten on every save): product model code, fallback SKU. Printed as "Product Code". */
  productCode: string | null;
  /** Server snapshot from the catalogue (overwritten on every save): MRP. */
  mrp: number | null;
  /** System-calculated: orderedQty × unitPrice × (1 − discountPct/100). */
  lineTotal: number;
  /** Optional per-line note. */
  notes: string | null;
}

export type GoodsSalesOrderStatus =
  | "draft"
  | "warehouse_pending"
  | "warehouse_approved"
  | "checker_pending"
  | "pending_review"
  | "confirmed"
  | "partially_dispatched"
  | "fully_dispatched"
  | "cancelled";

export interface GoodsSalesOrder {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "GoodsSalesOrder";
  id: string;
  clientId: string;
  /** System-generated (SO-XXXXXXXX) unless manually supplied. */
  soNumber: string;
  orderDate: string;
  customerId: string | null;
  /** Denormalized customer name for display. */
  customerName: string | null;
  /** Customer contact person (auto-filled from the debtor master, editable). */
  contactPerson: string | null;
  billingAddress: string | null;
  deliveryAddress: string | null;
  // ── PDF header meta (Tally-style print): all optional, blank renders blank. ──
  /** Buyer's purchase-order number printed on the PDF. */
  buyerOrderNo: string | null;
  /** Reference number & date printed on the PDF. */
  referenceNo: string | null;
  /** Delivery note reference printed on the PDF. */
  deliveryNote: string | null;
  /** Dispatch document number printed on the PDF. */
  dispatchDocNo: string | null;
  /** "Dispatched through" line printed on the PDF. */
  dispatchedThrough: string | null;
  // ── Buyer tax snapshots (ship-to and bill-to can carry different GSTINs). ──
  /** GSTIN printed under the shipping-address block (auto-filled from debtor, editable). */
  shipGstin: string | null;
  /** PAN printed under the shipping-address block. */
  shipPan: string | null;
  /** GSTIN printed under the BILL TO block (auto-filled from debtor, editable). */
  billGstin: string | null;
  /** PAN printed under the BILL TO block. */
  billPan: string | null;
  /** Remarks printed above the bank-details block. */
  remarks: string | null;
  /** Salesperson / owner who owns the order. */
  salespersonId: string | null;
  salespersonName: string | null;
  paymentTerms: string | null;
  /** Structured payment terms: credit (Net N), advance_full (100% advance),
   *  advance_partial (X% advance + remainder on delivery) or on_delivery. */
  paymentTermsType: PaymentTermsType | null;
  /** Advance percentage for advance_partial terms (1–99). */
  advancePct: number | null;
  // ── Payment-term snapshot (PDF §2): the approved term copied permanently
  // onto the SO. Later Customer Master edits must not change historic SOs. ──
  /** Approved term this SO was created from (DebtorPaymentTerm id). */
  paymentTermId: string | null;
  /** Approved term name at time of selection (snapshot). */
  paymentTermName: string | null;
  /** Balance % snapshot (advancePct + balancePct == 100). */
  balancePct: number | null;
  /** Balance due days snapshot (0 = due on invoice date). */
  balanceDueDays: number | null;
  /** Balance due basis snapshot. V1: always "invoice_date". */
  balanceDueBasis: DueBasis | null;
  /** Advance due basis snapshot. V1: always "so_confirmation". */
  advanceDueBasis: DueBasis | null;
  /** Dispatch condition snapshot — gates dispatch in a later phase. */
  dispatchCondition: DispatchCondition | null;
  expectedDispatchDate: string | null;
  expectedDeliveryDate: string | null;
  notes: string | null;
  documents: any[];
  status: GoodsSalesOrderStatus;
  /**
   * The last manually-set status (draft / pending_review / confirmed /
   * cancelled). Dispatch-driven statuses (partially/fully dispatched) are
   * derived and this field is the fallback when dispatch quantities are fully
   * revoked.
   */
  manualStatus: Exclude<GoodsSalesOrderStatus, "partially_dispatched" | "fully_dispatched">;
  /** Who reviewed this SO at the maker–checker step (checker/admin id). null = not yet reviewed. */
  reviewedBy: string | null;
  /** When the checker reviewed this SO. null = not yet reviewed. */
  reviewedAt: string | null;
  /** Sales-review decision recorded before the warehouse can receive the order. */
  salesReviewedBy: string | null;
  salesReviewedAt: string | null;
  salesReviewNotes: string | null;
  /** Debtor (customer) approval via the emailed PDF. null = never sent. */
  debtorApprovalStatus: "pending" | "approved" | "rejected" | null;
  /** One-time secure token embedded in the approval link — nulled on response. */
  debtorApprovalToken: string | null;
  /** When the "send to debtor" email with the PDF was dispatched. */
  debtorApprovalSentAt: string | null;
  /** When the debtor clicked approve/reject. */
  debtorApprovalRespondedAt: string | null;
  /** Optional comments left by the debtor (usually with a rejection). */
  debtorApprovalComments: string | null;
  /** The email address the PDF was sent to. */
  debtorApprovalEmail: string | null;
  /**
   * Warehouse sign-off (hard gate): a sales order that is pending/on_hold can
   * NOT have dispatch notes created against it. Cleared to null by the checker
   * flow so a re-confirmed SO re-enters the warehouse queue.
   */
  warehouseStatus: "pending" | "approved" | "on_hold" | null;
  /** Warehouse user who signed off (id). null until first decision. */
  warehouseApprovedBy: string | null;
  /** When the warehouse signed off. */
  warehouseApprovedAt: string | null;
  /** Free-text note left by the warehouse (usually with a hold). */
  warehouseNotes: string | null;
  // ── Stock reservation (PDF-2 §3: reserve, never debit, at stock check). ──
  /** Reservation state for this order's lines. */
  stockStatus: "pending" | "reserved" | "in_transit" | null;
  /** Warehouse / dispatch location confirmed at stock check. */
  dispatchLocation: string | null;
  /** Expected inward date for pre-orders (Stock In Transit). */
  expectedInwardDate: string | null;
  /** Who confirmed the reservation. */
  reservedBy: string | null;
  reservedAt: string | null;
  // ── Dispatch controls (PDF-2 §10 blocked reasons). ──
  /** Manual dispatch hold with mandatory reason. */
  dispatchHold: boolean;
  dispatchHoldReason: string | null;
  // ── Workflow engine pointers (PDF-3 §10: stored on each document). ──
  workflowStatus: string | null;
  currentOwnerRole: string | null;
  nextRequiredAction: string | null;
  nextDueDate: string | null;
  lines: GoodsSalesOrderLine[];
  totalQty: number;
  subtotal: number;
  totalDiscount: number;
  gstTotal: number;
  freight: number;
  grandTotal: number;
  createdAt: string;
  updatedAt: string;
}

export const SO_STATUSES = [
  "draft",
  "warehouse_pending",
  "warehouse_approved",
  "checker_pending",
  "pending_review",
  "confirmed",
  "partially_dispatched",
  "fully_dispatched",
  "cancelled",
] as const;
const MANUAL_STATUSES = [
  "draft",
  "warehouse_pending",
  "warehouse_approved",
  "checker_pending",
  "pending_review",
  "confirmed",
  "cancelled",
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Gross value before discount for a line: orderedQty × unitPrice. */
function grossValue(
  l: Pick<GoodsSalesOrderLine, "orderedQty" | "unitPrice">,
): number {
  return (Number(l.orderedQty) || 0) * (Number(l.unitPrice) || 0);
}

/** Discounted value a line sells for: gross × (1 − discountPct/100). */
function netValue(
  l: Pick<GoodsSalesOrderLine, "orderedQty" | "unitPrice" | "discountPct">,
): number {
  const g = grossValue(l);
  const disc = Math.min(100, Math.max(0, Number(l.discountPct) || 0));
  return g * (1 - disc / 100);
}

function computeLineTotals(
  lines: GoodsSalesOrderLine[],
): GoodsSalesOrderLine[] {
  return lines.map((l) => {
    const orderedQty = Number(l.orderedQty) || 0;
    const unitPrice = Number(l.unitPrice) || 0;
    const discountPct =
      l.discountPct === undefined || l.discountPct === null
        ? null
        : Math.min(100, Math.max(0, Number(l.discountPct) || 0));
    return {
      ...l,
      orderedQty,
      unitPrice,
      discountPct,
      lineTotal: round2(
        orderedQty * unitPrice * (1 - (discountPct ?? 0) / 100),
      ),
      dispatchedQty: l.dispatchedQty ?? 0,
      notes: l.notes || null,
    };
  });
}

export function computeTotals(lines: GoodsSalesOrderLine[], freight: number) {
  const normalized = computeLineTotals(lines);
  const totalQty = normalized.reduce((s, l) => s + l.orderedQty, 0);
  const subtotal = round2(normalized.reduce((s, l) => s + l.lineTotal, 0));
  const totalDiscount = round2(
    normalized.reduce((s, l) => s + (grossValue(l) - netValue(l)), 0),
  );
  const gstTotal = round2(
    normalized.reduce((s, l) => s + (netValue(l) * (l.gstRate ?? 0)) / 100, 0),
  );
  const f = Number(freight) || 0;
  return {
    totalQty,
    subtotal,
    totalDiscount,
    gstTotal,
    freight: round2(f),
    grandTotal: round2(subtotal + gstTotal + f),
  };
}

export function recomputeStatus(
  so: Pick<GoodsSalesOrder, "status" | "manualStatus" | "lines">,
): GoodsSalesOrderStatus {
  const lines = so.lines ?? [];
  if (
    lines.length > 0 &&
    lines.every(
      (l) => (l.dispatchedQty ?? 0) >= l.orderedQty && l.orderedQty > 0,
    )
  ) {
    return "fully_dispatched";
  }
  if (lines.some((l) => (l.dispatchedQty ?? 0) > 0)) {
    return "partially_dispatched";
  }
  return so.manualStatus || so.status || "confirmed";
}

export async function list(clientId?: string) {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, {
      entityType: "GoodsSalesOrder",
      limit: 500,
      reverse: true,
    });
    return items as GoodsSalesOrder[];
  }
  return db.scanByType("GoodsSalesOrder", { limit: 2000 }) as Promise<GoodsSalesOrder[]>;
}

export async function get(id: string) {
  return db.getItem(`GOODS_SO#${id}`) as Promise<GoodsSalesOrder | null>;
}

export async function create(
  data: Partial<GoodsSalesOrder> & { clientId: string },
) {
  const id = uuid();
  const now = db.nowISO();
  const lines = computeLineTotals((data.lines ?? []) as GoodsSalesOrderLine[]);
  const totals = computeTotals(lines, data.freight ?? 0);
  const status =
    data.status && SO_STATUSES.includes(data.status as any)
      ? data.status
      : "draft";
  const item: GoodsSalesOrder = {
    pk: `GOODS_SO#${id}`,
    sk: `GOODS_SO#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`,
    gsi1sk: `GoodsSalesOrder#${now}`,
    entityType: "GoodsSalesOrder",
    id,
    clientId: data.clientId,
    soNumber: data.soNumber || `SO-${id.slice(0, 8).toUpperCase()}`,
    orderDate: data.orderDate || db.todayDate(),
    customerId: data.customerId || null,
    customerName: data.customerName || null,
    contactPerson: data.contactPerson || null,
    billingAddress: data.billingAddress || null,
    deliveryAddress: data.deliveryAddress || null,
    buyerOrderNo: data.buyerOrderNo || null,
    referenceNo: data.referenceNo || null,
    deliveryNote: data.deliveryNote || null,
    dispatchDocNo: data.dispatchDocNo || null,
    dispatchedThrough: data.dispatchedThrough || null,
    shipGstin: data.shipGstin || null,
    shipPan: data.shipPan || null,
    billGstin: data.billGstin || null,
    billPan: data.billPan || null,
    remarks: data.remarks || null,
    salespersonId: data.salespersonId || null,
    salespersonName: data.salespersonName || null,
    debtorApprovalStatus: (data.debtorApprovalStatus as any) || null,
    debtorApprovalToken: data.debtorApprovalToken || null,
    debtorApprovalSentAt: data.debtorApprovalSentAt || null,
    debtorApprovalRespondedAt: data.debtorApprovalRespondedAt || null,
    debtorApprovalComments: data.debtorApprovalComments || null,
    debtorApprovalEmail: data.debtorApprovalEmail || null,
    warehouseStatus: (data.warehouseStatus as any) || null,
    warehouseApprovedBy: data.warehouseApprovedBy || null,
    warehouseApprovedAt: data.warehouseApprovedAt || null,
    warehouseNotes: data.warehouseNotes || null,
    stockStatus: (data.stockStatus as any) || "pending",
    dispatchLocation: data.dispatchLocation || null,
    expectedInwardDate: data.expectedInwardDate || null,
    reservedBy: data.reservedBy || null,
    reservedAt: data.reservedAt || null,
    dispatchHold: (data as any).dispatchHold === true,
    dispatchHoldReason: data.dispatchHoldReason || null,
    workflowStatus: data.workflowStatus || "draft",
    currentOwnerRole: data.currentOwnerRole || "sales",
    nextRequiredAction: data.nextRequiredAction || "Complete sales order",
    nextDueDate: data.nextDueDate || null,
    paymentTerms: data.paymentTerms || null,
    paymentTermsType: normalizePaymentTermsType(data.paymentTermsType),
    advancePct: normalizeAdvancePct(data.advancePct),
    paymentTermId: data.paymentTermId || null,
    paymentTermName: data.paymentTermName || null,
    balancePct: normalizeBalancePct((data as any).balancePct) ?? balancePctFor(normalizeAdvancePct(data.advancePct)),
    balanceDueDays: normalizeBalanceDueDays((data as any).balanceDueDays) ?? null,
    balanceDueBasis: normalizeDueBasis((data as any).balanceDueBasis) ?? "invoice_date",
    advanceDueBasis: normalizeDueBasis((data as any).advanceDueBasis) ?? "so_confirmation",
    dispatchCondition: normalizeDispatchCondition((data as any).dispatchCondition),
    expectedDispatchDate: data.expectedDispatchDate || null,
    expectedDeliveryDate: data.expectedDeliveryDate || null,
    notes: data.notes || null,
    documents: data.documents || [],
    status,
    manualStatus: status as GoodsSalesOrder["manualStatus"],
    reviewedBy: data.reviewedBy || null,
    reviewedAt: data.reviewedAt || null,
    salesReviewedBy: data.salesReviewedBy || null,
    salesReviewedAt: data.salesReviewedAt || null,
    salesReviewNotes: data.salesReviewNotes || null,
    lines,
    ...totals,
    createdAt: now,
    updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<GoodsSalesOrder>) {
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  const allowed = [
    "soNumber",
    "orderDate",
    "customerId",
    "customerName",
    "contactPerson",
    "billingAddress",
    "deliveryAddress",
    "buyerOrderNo",
    "referenceNo",
    "deliveryNote",
    "dispatchDocNo",
    "dispatchedThrough",
    "shipGstin",
    "shipPan",
    "billGstin",
    "billPan",
    "remarks",
    "salespersonId",
    "salespersonName",
    "paymentTerms",
    "paymentTermsType",
    "advancePct",
    "paymentTermId",
    "paymentTermName",
    "balancePct",
    "balanceDueDays",
    "balanceDueBasis",
    "advanceDueBasis",
    "dispatchCondition",
    "expectedDispatchDate",
    "expectedDeliveryDate",
    "notes",
    "documents",
    "status",
    "manualStatus",
    "reviewedBy",
    "reviewedAt",
    "salesReviewedBy",
    "salesReviewedAt",
    "salesReviewNotes",
    "lines",
    "totalQty",
    "subtotal",
    "totalDiscount",
    "gstTotal",
    "freight",
    "grandTotal",
    "debtorApprovalStatus",
    "debtorApprovalToken",
    "debtorApprovalSentAt",
    "debtorApprovalRespondedAt",
    "debtorApprovalComments",
    "debtorApprovalEmail",
    "warehouseStatus",
    "warehouseApprovedBy",
    "warehouseApprovedAt",
    "warehouseNotes",
    "stockStatus",
    "dispatchLocation",
    "expectedInwardDate",
    "reservedBy",
    "reservedAt",
    "dispatchHold",
    "dispatchHoldReason",
    "workflowStatus",
    "currentOwnerRole",
    "nextRequiredAction",
    "nextDueDate",
  ];
  for (const k of allowed) {
    if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k];
  }
  // Recompute line totals + document totals whenever lines/freight change.
  // When only lines change (e.g. a dispatch folds in dispatched quantities),
  // keep the stored freight so totals don't silently drop the freight charge.
  if (updates.lines !== undefined || updates.freight !== undefined) {
    const current = await get(id);
    const lines = computeLineTotals(
      updates.lines !== undefined
        ? (updates.lines as GoodsSalesOrderLine[])
        : ((current?.lines ?? []) as GoodsSalesOrderLine[]),
    );
    patch.lines = lines;
    const freight =
      updates.freight !== undefined
        ? Number(updates.freight) || 0
        : (current?.freight ?? 0);
    Object.assign(patch, computeTotals(lines, freight));
  }
  // Track the manual status so dispatch-derived statuses can fall back to it.
  if (updates.status && MANUAL_STATUSES.includes(updates.status)) {
    patch.manualStatus = updates.status;
  }
  return db.updateItem(`GOODS_SO#${id}`, `GOODS_SO#${id}`, patch);
}

export async function remove(id: string) {
  return db.deleteItem(`GOODS_SO#${id}`);
}

/** Add dispatched quantities (from a dispatch note) to SO lines and recompute the status. */
export async function recordDispatch(
  soId: string,
  dispatched: Array<{ productId: string; dispatchedQty: number }>,
) {
  const so = await get(soId);
  if (!so) throw new Error("Sales order not found");
  if (so.status === "cancelled")
    throw new Error("Cannot dispatch against a cancelled sales order");
  if (so.status === "draft" || so.status === "pending_review")
    throw new Error("Confirm the sales order before dispatching goods");
  if (so.status === "fully_dispatched")
    throw new Error("Sales order is already fully dispatched");
  const lines = (so.lines ?? []).map((l) => {
    const d = dispatched.find((x) => x.productId === l.productId);
    return d
      ? { ...l, dispatchedQty: (l.dispatchedQty ?? 0) + d.dispatchedQty }
      : l;
  });
  return update(soId, { lines, status: recomputeStatus({ ...so, lines }) });
}

/** Subtract dispatched quantities (when a dispatch note is revoked/cancelled) and recompute the status. */
export async function revokeDispatch(
  soId: string,
  revoked: Array<{ productId: string; dispatchedQty: number }>,
) {
  const so = await get(soId);
  if (!so) throw new Error("Sales order not found");
  const lines = (so.lines ?? []).map((l) => {
    const d = revoked.find((x) => x.productId === l.productId);
    return d
      ? {
          ...l,
          dispatchedQty: Math.max(0, (l.dispatchedQty ?? 0) - d.dispatchedQty),
        }
      : l;
  });
  return update(soId, { lines, status: recomputeStatus({ ...so, lines }) });
}
