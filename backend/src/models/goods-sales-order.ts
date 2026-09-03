import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

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
  /** System-calculated: orderedQty × unitPrice × (1 − discountPct/100). */
  lineTotal: number;
  /** Optional per-line note. */
  notes: string | null;
}

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
  /** Salesperson / owner who owns the order. */
  salespersonId: string | null;
  salespersonName: string | null;
  /** Linked quotation — optional. (Quotation flow to be defined; stored by number for now.) */
  linkedQuotationId: string | null;
  linkedQuotationNumber: string | null;
  paymentTerms: string | null;
  expectedDispatchDate: string | null;
  expectedDeliveryDate: string | null;
  notes: string | null;
  documents: any[];
  status: string;
  /**
   * The last manually-set status (draft / pending_review / confirmed /
   * cancelled). Dispatch-driven statuses (partially/fully dispatched) are
   * derived and this field is the fallback when dispatch quantities are fully
   * revoked.
   */
  manualStatus: string;
  /** Who reviewed this SO at the maker–checker step (checker/admin id). null = not yet reviewed. */
  reviewedBy: string | null;
  /** When the checker reviewed this SO. null = not yet reviewed. */
  reviewedAt: string | null;
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
  "pending_review",
  "confirmed",
  "partially_dispatched",
  "fully_dispatched",
  "cancelled",
] as const;
const MANUAL_STATUSES = ["draft", "pending_review", "confirmed", "cancelled"];

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
): string {
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
    salespersonId: data.salespersonId || null,
    salespersonName: data.salespersonName || null,
    linkedQuotationId: data.linkedQuotationId || null,
    linkedQuotationNumber: data.linkedQuotationNumber || null,
    debtorApprovalStatus: (data.debtorApprovalStatus as any) || null,
    debtorApprovalToken: data.debtorApprovalToken || null,
    debtorApprovalSentAt: data.debtorApprovalSentAt || null,
    debtorApprovalRespondedAt: data.debtorApprovalRespondedAt || null,
    debtorApprovalComments: data.debtorApprovalComments || null,
    debtorApprovalEmail: data.debtorApprovalEmail || null,
    paymentTerms: data.paymentTerms || null,
    expectedDispatchDate: data.expectedDispatchDate || null,
    expectedDeliveryDate: data.expectedDeliveryDate || null,
    notes: data.notes || null,
    documents: data.documents || [],
    status,
    manualStatus: status,
    reviewedBy: data.reviewedBy || null,
    reviewedAt: data.reviewedAt || null,
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
    "salespersonId",
    "salespersonName",
    "linkedQuotationId",
    "linkedQuotationNumber",
    "paymentTerms",
    "expectedDispatchDate",
    "expectedDeliveryDate",
    "notes",
    "documents",
    "status",
    "manualStatus",
    "reviewedBy",
    "reviewedAt",
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
