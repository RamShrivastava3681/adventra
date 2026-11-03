/**
 * Marketplace fulfilment pipeline — takes a marketplace order through the normal
 * WhizUnik workflows:
 *
 *   SKU mapping → stock reservation (Marketplace Sales Order) → channel invoice record
 *   → warehouse task → pack → dispatch / stock OUT → delivery → return + inspection
 *   → stock decision → credit note → refund reference → settlement + reconciliation.
 *
 * It is channel-agnostic: an order source (the Amazon Demo Simulator today, the live
 * Amazon SP-API adapter later) only feeds orders, invoices, tracking numbers, returns,
 * refunds and settlements in. Every business rule lives here, on the real models
 * (GoodsSO, StockMovement, GoodsDispatch, WorkflowTask, CreditDebitNote,
 * MarketplaceSettlement, AuditLog) plus the marketplace order/return records.
 */
import * as db from "../dynamodb.js";
import * as AmazonOrder from "../models/marketplace-amazon-order.js";
import * as SkuMapping from "../models/marketplace-amazon-sku-mapping.js";
import * as InvoiceRecord from "../models/marketplace-amazon-invoice-record.js";
import * as AmazonReturn from "../models/marketplace-amazon-return.js";
import * as AmazonRefund from "../models/marketplace-amazon-refund.js";
import * as AmazonException from "../models/marketplace-amazon-exception.js";
import * as Product from "../models/product.js";
import * as GoodsSO from "../models/goods-sales-order.js";
import * as GoodsDispatch from "../models/goods-dispatch.js";
import * as StockMovement from "../models/stock-movement.js";
import * as WorkflowTask from "../models/workflow-task.js";
import * as CreditDebitNote from "../models/credit-debit-note.js";
import * as MarketplaceSettlement from "../models/marketplace-settlement.js";
import * as AuditLog from "../models/audit-log.js";
import { exGstPrice, round2, splitGstInclusive } from "../lib/gst.js";
import { assertSOStockAvailable, reservedStockByProduct, stockBalanceByProduct } from "./stock-availability.js";
import { debitSalesOrder } from "./dispatch-stock.js";

type Order = AmazonOrder.MarketplaceAmazonOrder;
type Return = AmazonReturn.MarketplaceAmazonReturn;

export interface Actor {
  userId: string | null;
  email: string;
}

/** Where the channel's orders are fulfilled from, and how documents are numbered. */
export interface FulfilmentContext {
  clientId: string;
  channel: string;
  customerId: string;
  customerName: string;
  warehouseLocationId: string;
  warehouseName: string;
  /** Location for damaged / rejected returns — never counted as available stock. */
  inspectionLocationId: string;
  inspectionName: string;
  /** Prefix for WhizUnik document numbers ("DEMO-" in the demo tenant). */
  docPrefix: string;
  /** Audit action namespace, e.g. "amazon_demo". */
  auditPrefix: string;
}

export const ORDER_STATUS = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  AWAITING_STOCK: "Awaiting Stock",
  SKU_MAPPING_REQUIRED: "SKU Mapping Required",
  INVOICE_PENDING: "Invoice Pending",
  INVOICE_RECEIVED: "Invoice Received",
  PACKED: "Packed",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  RETURN_INITIATED: "Return Initiated",
  RETURNED: "Returned",
  REFUNDED: "Refunded",
  CLOSED: "Closed",
} as const;

export const FULFILMENT_TYPES = ["EasyShip", "SelfShip", "SellerFlex", "FBA", "MCF", "Dropship", "Vendor"] as const;

export const DAMAGED_DISPOSITIONS = [
  "Returned",
  "Recovered through claim",
  "Written off with approval",
  "Pending decision",
] as const;

/** Who owns each failure and what "Retry" does about it. */
export const EXCEPTION_PLAYBOOK: Record<string, { owner: string; retryAction: string }> = {
  UnmappedSKU: { owner: "Catalogue team", retryAction: "Map the Amazon SKU to a WhizUnik SKU, then retry the order" },
  StockShortage: { owner: "Warehouse / Purchase", retryAction: "Receive stock, then retry the reservation" },
  MissingAmazonInvoice: { owner: "Marketplace operations", retryAction: "Fetch the Amazon invoice, then open the warehouse task" },
  ShipmentConfirmationFailure: { owner: "Warehouse dispatch", retryAction: "Retry the courier booking and confirm dispatch" },
  MissingTrackingNumber: { owner: "Warehouse dispatch", retryAction: "Generate the AWB / tracking number and confirm dispatch" },
  DuplicateOrder: { owner: "Marketplace operations", retryAction: "Re-check the order — the original is kept, the duplicate is ignored" },
  DuplicateReturn: { owner: "Returns desk", retryAction: "Re-check the return — the original is kept, the duplicate is ignored" },
  APIFailure: { owner: "Integration (IT)", retryAction: "Re-run the order import from the stored payload" },
  SettlementDiscrepancy: { owner: "Finance", retryAction: "Correct the bank receipt and re-run the reconciliation" },
};

export class PipelineError extends Error {
  constructor(
    message: string,
    public code: string,
    public status = 400,
  ) {
    super(message);
    this.name = "PipelineError";
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Short order token used in document numbers: AMZ-DEMO-1001 → 1001. */
export function orderSuffix(orderNo: string): string {
  return orderNo.replace(/^AMZ-(DEMO-)?/i, "").replace(/[^A-Za-z0-9-]/g, "") || orderNo;
}

export function docNumber(ctx: FulfilmentContext, kind: string, orderNo: string): string {
  return `${ctx.docPrefix}${kind}-${orderSuffix(orderNo)}`;
}

/** Order value after discount (GST-inclusive, the app's pricing convention). */
export function orderValue(o: Pick<Order, "quantity" | "sellingPrice" | "discount">): number {
  return round2(Number(o.quantity) * Number(o.sellingPrice) - (Number(o.discount) || 0));
}

function unitNetPrice(o: Order): number {
  return o.quantity > 0 ? orderValue(o) / o.quantity : 0;
}

export function formatAddress(a: Order["deliveryAddress"] | null | undefined): string {
  if (!a) return "";
  return [a.addressLine1, a.addressLine2, a.city, a.state, a.postalCode, a.country].filter(Boolean).join(", ");
}

async function audit(ctx: FulfilmentContext, actor: Actor, event: string, target: string, detail: Record<string, unknown> = {}) {
  await AuditLog.writeAuditLog({
    actorId: actor.userId,
    actorEmail: actor.email,
    action: `${ctx.auditPrefix}.${event}`,
    target,
    detail: { channel: ctx.channel, ...detail },
  });
}

async function setOrder(order: Order, patch: Partial<Order>): Promise<Order> {
  return ((await AmazonOrder.update(order.id, patch)) ?? { ...order, ...patch }) as Order;
}

export async function requireOrder(ctx: FulfilmentContext, orderNo: string): Promise<Order> {
  const o = await AmazonOrder.findByAmazonOrderId(ctx.clientId, orderNo);
  if (!o) throw new PipelineError(`Order ${orderNo} not found`, "NotFound", 404);
  return o;
}

async function requireReturn(returnId: string): Promise<Return> {
  const r = await AmazonReturn.get(returnId);
  if (!r) throw new PipelineError("Return not found", "NotFound", 404);
  return r;
}

async function requireDispatch(order: Order) {
  const d = order.dispatchId ? await GoodsDispatch.get(order.dispatchId) : null;
  if (!d) throw new PipelineError(`No warehouse task yet for ${order.amazonOrderId}`, "SequenceError");
  return d;
}

function isOpen(e: AmazonException.MarketplaceAmazonException) {
  return e.currentStatus === "Open" || e.currentStatus === "InProgress";
}

// ── exceptions ───────────────────────────────────────────────────────────────

export async function raiseException(
  ctx: FulfilmentContext,
  actor: Actor,
  input: { affectedOrder: string; reason: AmazonException.ExceptionReason; message: string; item?: string; payload?: Record<string, any> | null },
) {
  const now = db.nowISO();
  const open = (await AmazonException.list(ctx.clientId)).find(
    (e) => e.affectedOrder === input.affectedOrder && e.errorReason === input.reason && isOpen(e),
  );
  if (open) {
    return AmazonException.update(open.id, {
      errorMessage: input.message,
      lastAttempt: now,
      ...(input.payload !== undefined ? { payload: input.payload } : {}),
    });
  }
  const playbook = EXCEPTION_PLAYBOOK[input.reason];
  const created = await AmazonException.create({
    clientId: ctx.clientId,
    affectedOrder: input.affectedOrder,
    errorReason: input.reason,
    errorMessage: input.message,
    affectedItem: input.item,
    maxRetries: 3,
    responsibleUser: playbook?.owner ?? actor.email,
  });
  const ex = await AmazonException.update(created.id, {
    retryAction: playbook?.retryAction ?? null,
    payload: input.payload ?? null,
    lastAttempt: now,
  });
  await audit(ctx, actor, "exception_raised", input.affectedOrder, { reason: input.reason, message: input.message });
  return ex;
}

export async function resolveExceptions(
  ctx: FulfilmentContext,
  actor: Actor,
  affectedOrder: string,
  reasons: string[],
  note: string,
) {
  const open = (await AmazonException.list(ctx.clientId)).filter(
    (e) => e.affectedOrder === affectedOrder && reasons.includes(e.errorReason) && isOpen(e),
  );
  for (const e of open) {
    await AmazonException.resolveException(e.id, note, actor.email);
    await audit(ctx, actor, "exception_resolved", affectedOrder, { reason: e.errorReason, note });
  }
}

// ── Phase 1–4: order → SKU mapping → Marketplace Sales Order → reservation ──

export interface MarketplaceOrderInput {
  amazonOrderId: string;
  orderDate?: string | null;
  amazonSku: string;
  internalSku?: string | null;
  productName: string;
  colour?: string | null;
  size?: string | null;
  quantity: number;
  sellingPrice: number;
  discount?: number | null;
  taxRate?: number | null;
  deliveryAddress: Order["deliveryAddress"];
  expectedDispatchDate?: string | null;
  fulfilmentType: string;
  shippingMethod?: string | null;
}

export async function importOrder(ctx: FulfilmentContext, input: MarketplaceOrderInput, actor: Actor): Promise<Order> {
  const orderNo = String(input.amazonOrderId || "").trim();
  const quantity = Number(input.quantity);
  const price = Number(input.sellingPrice);
  const discount = Number(input.discount) || 0;
  const taxRate = Number(input.taxRate) || 0;
  if (!orderNo) throw new PipelineError("Amazon order number is required", "Validation");
  if (!String(input.amazonSku || "").trim()) throw new PipelineError("Amazon SKU is required", "Validation");
  if (!Number.isInteger(quantity) || quantity < 1) throw new PipelineError("Quantity must be a whole number of at least 1", "Validation");
  if (!(price >= 0)) throw new PipelineError("Selling price must be zero or more", "Validation");
  if (discount < 0 || discount > quantity * price) throw new PipelineError("Discount must be between ₹0 and the order value", "Validation");
  if (taxRate < 0 || taxRate > 28) throw new PipelineError("Tax must be a GST rate between 0% and 28%", "Validation");
  const fulfilmentType = input.fulfilmentType || "EasyShip";
  if (!(FULFILMENT_TYPES as readonly string[]).includes(fulfilmentType)) {
    throw new PipelineError(`Fulfilment type must be one of ${FULFILMENT_TYPES.join(", ")}`, "Validation");
  }
  if (await AmazonOrder.findByAmazonOrderId(ctx.clientId, orderNo)) {
    throw new PipelineError(`Amazon order ${orderNo} already exists — duplicate import refused`, "DuplicateOrder", 409);
  }
  const value = round2(quantity * price - discount);
  const split = splitGstInclusive(value, taxRate);
  const created = await AmazonOrder.create({
    clientId: ctx.clientId,
    amazonOrderId: orderNo,
    orderDate: input.orderDate || db.todayDate(),
    amazonSku: input.amazonSku.trim(),
    productName: input.productName || input.amazonSku,
    colour: input.colour || null,
    size: input.size || null,
    quantity,
    sellingPrice: price,
    discount,
    taxInformation: { taxableAmount: split.taxableValue, taxAmount: split.gstAmount, taxRate },
    deliveryAddress: input.deliveryAddress,
    shippingMethod: input.shippingMethod || "Standard",
    fulfilmentType: fulfilmentType as Order["fulfilmentType"],
    expectedDispatchDate: input.expectedDispatchDate || null,
  });
  const order = await setOrder(created, {
    whizunikStatus: ORDER_STATUS.PENDING,
    internalSku: input.internalSku || null,
  });
  await audit(ctx, actor, "order_received", orderNo, { amazonSku: order.amazonSku, quantity, orderValue: value });
  return processOrder(ctx, orderNo, actor);
}

/** Map the SKU, raise the Marketplace Sales Order and reserve stock. Safe to re-run (Retry). */
export async function processOrder(ctx: FulfilmentContext, orderNo: string, actor: Actor): Promise<Order> {
  let order = await requireOrder(ctx, orderNo);
  if (order.whizunikStatus === ORDER_STATUS.CANCELLED || order.whizunikStatus === ORDER_STATUS.CLOSED) {
    throw new PipelineError(`Order ${orderNo} is ${order.whizunikStatus}`, "SequenceError");
  }
  if (order.salesOrderId) {
    return order.whizunikStatus === ORDER_STATUS.AWAITING_STOCK ? reserveStock(ctx, order, actor) : order;
  }

  // Phase 2 — every Amazon SKU must map to a catalogue SKU before anything else happens.
  const mapping = await SkuMapping.findByChannelSku(ctx.clientId, order.amazonSku);
  const mapped = mapping && (mapping.status === "Mapped" || mapping.status === "Active") ? mapping : null;
  const product = mapped
    ? ((await Product.list(ctx.clientId)) as Product.Product[]).find(
        (p) => p.sku?.toUpperCase() === mapped.whizunikSku.toUpperCase(),
      ) ?? null
    : null;
  if (!mapped || !product) {
    order = await setOrder(order, { whizunikStatus: ORDER_STATUS.SKU_MAPPING_REQUIRED });
    await raiseException(ctx, actor, {
      affectedOrder: orderNo,
      reason: "UnmappedSKU",
      message: mapped
        ? `Mapped SKU ${mapped.whizunikSku} is not in the product catalogue`
        : `Amazon SKU ${order.amazonSku} is not mapped to a WhizUnik SKU — no reservation or warehouse task created`,
      item: order.amazonSku,
    });
    await audit(ctx, actor, "sku_mapping_required", orderNo, { amazonSku: order.amazonSku });
    return order;
  }

  // Phase 4 — the Marketplace Sales Order, on the normal Sales Order structure.
  const gross = order.quantity * order.sellingPrice;
  const discountPct = gross > 0 ? Math.round(((order.discount || 0) / gross) * 100 * 10000) / 10000 : 0;
  const address = formatAddress(order.deliveryAddress);
  const so = await GoodsSO.create({
    clientId: ctx.clientId,
    soNumber: docNumber(ctx, "SO", orderNo),
    orderDate: order.orderDate,
    customerId: ctx.customerId,
    customerName: ctx.customerName,
    customerType: "Others",
    billingAddress: address,
    deliveryAddress: address,
    state: order.deliveryAddress?.state || null,
    city: order.deliveryAddress?.city || null,
    buyerOrderNo: orderNo,
    referenceNo: `${ctx.channel} · ${order.fulfilmentType}`,
    dispatchLocation: ctx.warehouseLocationId,
    expectedDispatchDate: order.expectedDispatchDate,
    paymentTerms: `Collected by ${ctx.channel}; paid in the marketplace settlement`,
    notes: `${ctx.channel} marketplace order ${orderNo} (${order.fulfilmentType}). Invoice issued by ${ctx.channel}.`,
    status: "warehouse_pending",
    stockStatus: "pending",
    currentOwnerRole: "warehouse",
    nextRequiredAction: "Reserve stock",
    lines: [
      {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        unit: product.unitOfMeasure || "piece",
        orderedQty: order.quantity,
        dispatchedQty: 0,
        unitPrice: order.sellingPrice,
        discountPct: discountPct || null,
        gstRate: order.taxInformation?.taxRate ?? product.gstRate ?? null,
        color: product.color ?? order.colour,
        size: product.size ?? order.size,
        productCode: product.model ?? product.sku,
        mrp: product.mrp ?? null,
        hsnCode: product.hsnCode ?? null,
        lineTotal: 0,
        notes: `${ctx.channel} SKU ${order.amazonSku}`,
      },
    ],
  });
  order = await setOrder(order, {
    salesOrderId: so.id,
    salesOrderNumber: so.soNumber,
    internalSku: product.sku,
    productId: product.id,
    colour: order.colour || product.color,
    size: order.size || product.size,
  });
  await resolveExceptions(ctx, actor, orderNo, ["UnmappedSKU"], `Mapped to ${product.sku}`);
  await audit(ctx, actor, "sales_order_created", orderNo, { soNumber: so.soNumber, sku: product.sku });
  return reserveStock(ctx, order, actor);
}

/** Phase 3 — reserve main-inventory stock (no stock OUT until dispatch). */
async function reserveStock(ctx: FulfilmentContext, order: Order, actor: Actor): Promise<Order> {
  const so = await GoodsSO.get(order.salesOrderId!);
  if (!so) throw new PipelineError("Sales order not found", "NotFound", 404);
  const check = await assertSOStockAvailable(ctx.clientId, so, ctx.warehouseLocationId);
  if (!check.sufficient) {
    const s = check.shortLines[0];
    const message = `${s.name}: needs ${s.required}, only ${s.available} available in ${ctx.warehouseName} (${s.onHand} on hand, ${s.reservedByOthers} reserved)`;
    await GoodsSO.update(so.id, { status: "warehouse_pending", stockStatus: "pending", warehouseNotes: `Awaiting stock — ${message}` });
    order = await setOrder(order, { whizunikStatus: ORDER_STATUS.AWAITING_STOCK });
    await raiseException(ctx, actor, { affectedOrder: order.amazonOrderId, reason: "StockShortage", message, item: order.internalSku ?? undefined });
    await audit(ctx, actor, "stock_short", order.amazonOrderId, { message });
    return order;
  }
  const now = db.nowISO();
  await GoodsSO.update(so.id, {
    status: "confirmed",
    manualStatus: "confirmed",
    stockStatus: "reserved",
    reservedAt: now,
    reservedBy: actor.email,
    warehouseStatus: "approved",
    warehouseApprovedBy: actor.email,
    warehouseApprovedAt: now,
    warehouseNotes: `Reserved ${order.quantity} in ${ctx.warehouseName} for ${ctx.channel} ${order.amazonOrderId}`,
    nextRequiredAction: `Await ${ctx.channel} invoice`,
  });
  order = await setOrder(order, { whizunikStatus: ORDER_STATUS.CONFIRMED });
  await resolveExceptions(ctx, actor, order.amazonOrderId, ["StockShortage"], "Stock reserved");
  await audit(ctx, actor, "stock_reserved", order.amazonOrderId, { quantity: order.quantity, location: ctx.warehouseName });

  // Phase 5 — the invoice record is opened now and filled when the channel issues its invoice.
  if (!order.invoiceRecordId) {
    const value = orderValue(order);
    const rec = await InvoiceRecord.create({
      clientId: ctx.clientId,
      amazonOrderId: order.amazonOrderId,
      whizunikSalesOrderId: so.id,
      invoiceNumber: null,
      invoiceIssueDate: null,
      issuer: "Amazon",
      amount: value,
      grandTotal: value,
      taxableAmount: order.taxInformation.taxableAmount,
      taxAmount: order.taxInformation.taxAmount,
      taxRate: order.taxInformation.taxRate,
      currency: "INR",
      status: "AwaitingAmazonInvoice",
    });
    order = await setOrder(order, { invoiceRecordId: rec.id });
  }
  order = await setOrder(order, { whizunikStatus: ORDER_STATUS.INVOICE_PENDING, invoiceStatus: "AwaitingAmazonInvoice" });
  return order;
}

// ── Phase 5: channel invoice (issued by the marketplace, never a WhizUnik invoice) ──

export async function recordChannelInvoice(
  ctx: FulfilmentContext,
  orderNo: string,
  invoice: { invoiceNumber: string; invoiceDate: string; attachmentUrl?: string | null },
  actor: Actor,
): Promise<Order> {
  const order = await requireOrder(ctx, orderNo);
  if (!order.invoiceRecordId) {
    throw new PipelineError("Stock must be reserved before the Amazon invoice is recorded", "SequenceError");
  }
  const rec = await InvoiceRecord.get(order.invoiceRecordId);
  if (!rec) throw new PipelineError("Invoice record not found", "NotFound", 404);
  if (rec.status === "InvoiceReceived") return openWarehouseTask(ctx, orderNo, actor);
  if (!invoice.invoiceNumber) throw new PipelineError("Amazon invoice number is required", "Validation");
  await InvoiceRecord.update(rec.id, {
    invoiceNumber: invoice.invoiceNumber,
    invoiceIssueDate: invoice.invoiceDate,
    status: "InvoiceReceived",
    attachedAt: db.nowISO(),
    attachmentUrl: invoice.attachmentUrl ?? null,
    notes: `Issued by ${ctx.channel}. No WhizUnik sales invoice is raised for this order.`,
  });
  await setOrder(order, { invoiceStatus: "InvoiceReceived", whizunikStatus: ORDER_STATUS.INVOICE_RECEIVED });
  await resolveExceptions(ctx, actor, orderNo, ["MissingAmazonInvoice"], `Invoice ${invoice.invoiceNumber} received`);
  await audit(ctx, actor, "invoice_received", orderNo, { invoiceNumber: invoice.invoiceNumber, issuer: ctx.channel });
  return openWarehouseTask(ctx, orderNo, actor);
}

// ── Phase 6–8: warehouse task → pack → dispatch / stock OUT → delivered ──

async function openWarehouseTask(ctx: FulfilmentContext, orderNo: string, actor: Actor): Promise<Order> {
  let order = await requireOrder(ctx, orderNo);
  if (order.dispatchId) return order;
  if (order.invoiceStatus !== "InvoiceReceived") {
    throw new PipelineError("The warehouse task opens only after the Amazon invoice is received", "SequenceError");
  }
  const so = await GoodsSO.get(order.salesOrderId!);
  if (!so) throw new PipelineError("Sales order not found", "NotFound", 404);
  const rec = order.invoiceRecordId ? await InvoiceRecord.get(order.invoiceRecordId) : null;
  const variant = [order.colour, order.size].filter(Boolean).join(" / ");
  const draft = await GoodsDispatch.create({
    clientId: ctx.clientId,
    goodsSalesOrderId: so.id,
    soNumber: so.soNumber,
    dispatchNumber: docNumber(ctx, "DSP", orderNo),
    customerId: ctx.customerId,
    customerName: ctx.customerName,
    deliveryAddress: order.deliveryAddress?.addressLine1 || so.deliveryAddress,
    deliveryCity: order.deliveryAddress?.city || null,
    deliveryState: order.deliveryAddress?.state || null,
    deliveryPincode: order.deliveryAddress?.postalCode || null,
    warehouse: ctx.warehouseName,
    sourceLocationId: ctx.warehouseLocationId,
    dispatchType: "marketplace_sale",
    channel: ctx.channel,
    plannedDispatchAt: order.expectedDispatchDate,
    cartonCount: 1,
    packageType: "Box",
    handlingInstructions:
      `${ctx.channel} ${order.fulfilmentType}: pack ${order.quantity} × ${order.internalSku}${variant ? ` (${variant})` : ""} in 1 box. ` +
      `Insert ${ctx.channel} invoice ${rec?.invoiceNumber ?? ""} and label with order ${orderNo}.`,
    notes: `${ctx.channel} order ${orderNo} · invoice ${rec?.invoiceNumber ?? "—"} issued by ${ctx.channel}`,
    lines: (so.lines ?? []).map((l) => ({
      productId: l.productId,
      sku: l.sku,
      name: l.name,
      unit: l.unit,
      orderedQty: l.orderedQty,
      dispatchedQty: Math.max(0, l.orderedQty - (l.dispatchedQty ?? 0)),
      packedQty: null,
      deliveredQty: 0,
      returnedQty: 0,
      unitPrice: l.unitPrice,
      discountPct: l.discountPct,
      gstRate: l.gstRate,
      lineValue: 0,
      notes: l.notes,
      color: l.color,
      size: l.size,
    })) as GoodsDispatch.GoodsDispatchLine[],
  });
  // Confirm releases the dispatch for picking; stock is debited only at "dispatched".
  await GoodsDispatch.flipToConfirmed(draft.id);
  const { task } = await WorkflowTask.openTask(
    {
      clientId: ctx.clientId,
      workflowType: "dispatch",
      stage: "picking",
      docType: "dispatch",
      docId: draft.id,
      docNumber: draft.dispatchNumber,
      counterparty: ctx.customerName,
      docStatus: "confirmed",
      ownerRole: "warehouse",
      requiredAction: `Pick & pack ${order.quantity} × ${order.internalSku}${variant ? ` (${variant})` : ""} for ${ctx.channel} order ${orderNo} (${order.fulfilmentType}) at ${ctx.warehouseName}`,
      nextAction: "Mark packed",
      dueDate: order.expectedDispatchDate,
      amount: orderValue(order),
      inventoryStatus: "reserved",
      linkedDocs: [
        { type: "sales_order", id: so.id, number: so.soNumber },
        { type: "marketplace_order", id: order.id, number: orderNo },
      ],
    },
    actor,
  );
  order = await setOrder(order, { dispatchId: draft.id, dispatchNumber: draft.dispatchNumber, warehouseTaskId: task.id });
  await GoodsSO.update(so.id, { nextRequiredAction: "Warehouse: pick & pack" });
  await audit(ctx, actor, "warehouse_task_created", orderNo, { dispatchNumber: draft.dispatchNumber, taskId: task.id });
  return order;
}

export async function markPacked(ctx: FulfilmentContext, orderNo: string, actor: Actor): Promise<Order> {
  let order = await requireOrder(ctx, orderNo);
  const d = await requireDispatch(order);
  if (d.shippingStatus !== "picking") {
    throw new PipelineError(`Dispatch ${d.dispatchNumber} is "${d.shippingStatus}" — only a picking task can be packed`, "SequenceError");
  }
  const packed = (d.lines ?? []).reduce((n, l) => n + (l.dispatchedQty ?? 0), 0);
  await GoodsDispatch.update(d.id, {
    shippingStatus: "packed",
    shippingStatusAt: db.nowISO(),
    shippingStatusBy: actor.email,
    actualPackedQty: packed,
    lines: (d.lines ?? []).map((l) => ({ ...l, packedQty: l.dispatchedQty })),
  });
  const { task } = await WorkflowTask.openTask(
    {
      clientId: ctx.clientId,
      workflowType: "dispatch",
      stage: "packed",
      docType: "dispatch",
      docId: d.id,
      docNumber: d.dispatchNumber,
      counterparty: ctx.customerName,
      docStatus: "confirmed",
      ownerRole: "warehouse",
      requiredAction: `Hand ${d.dispatchNumber} to the courier and confirm dispatch`,
      nextAction: "Confirm dispatch",
      dueDate: order.expectedDispatchDate,
      linkedDocs: [{ type: "marketplace_order", id: order.id, number: orderNo }],
    },
    actor,
  );
  order = await setOrder(order, { whizunikStatus: ORDER_STATUS.PACKED, warehouseTaskId: task.id });
  await audit(ctx, actor, "packed", orderNo, { dispatchNumber: d.dispatchNumber, packages: d.cartonCount ?? 1, quantity: packed });
  return order;
}

/** Phase 7 — dispatch: the reservation becomes a stock OUT movement. */
export async function confirmDispatch(
  ctx: FulfilmentContext,
  orderNo: string,
  shipment: { courier: string; awbNumber: string | null },
  actor: Actor,
): Promise<Order> {
  let order = await requireOrder(ctx, orderNo);
  const d = await requireDispatch(order);
  if (d.stockDebited) throw new PipelineError(`${orderNo} is already dispatched`, "SequenceError", 409);
  if (d.shippingStatus !== "packed") {
    throw new PipelineError("Pack the order before confirming dispatch (invoice → warehouse → packing → dispatch)", "SequenceError");
  }
  const so = await GoodsSO.get(d.goodsSalesOrderId);
  if (!so || !["confirmed", "partially_dispatched"].includes(so.status)) {
    throw new PipelineError("Stock is not reserved for this order — it cannot be dispatched", "SequenceError");
  }
  if (!shipment.courier) throw new PipelineError("Courier is required", "Validation");
  if (!shipment.awbNumber) {
    await raiseException(ctx, actor, {
      affectedOrder: orderNo,
      reason: "MissingTrackingNumber",
      message: `${shipment.courier} returned no AWB / tracking number — dispatch not confirmed, stock not moved`,
      item: d.dispatchNumber,
    });
    throw new PipelineError("A tracking number (AWB) is required to confirm dispatch", "MissingTrackingNumber");
  }
  const balance = await stockBalanceByProduct(ctx.clientId, ctx.warehouseLocationId);
  for (const ln of d.lines ?? []) {
    const available = balance.get(ln.productId) ?? 0;
    if ((ln.dispatchedQty ?? 0) > available) {
      throw new PipelineError(`${ln.name}: only ${Math.max(0, available)} in ${ctx.warehouseName}; cannot dispatch ${ln.dispatchedQty}`, "StockShortage");
    }
  }
  // Same debit path as the warehouse "Dispatched" move: once, guarded by stockDebited.
  const marked = await GoodsDispatch.markStockDebited(d.id, actor.email);
  if (marked) {
    const fresh = (await GoodsDispatch.get(d.id)) ?? marked;
    await debitSalesOrder(ctx.clientId, fresh, so);
  }
  const now = db.nowISO();
  await GoodsDispatch.update(d.id, {
    shippingStatus: "in_transit",
    shippingStatusAt: now,
    shippingStatusBy: actor.email,
    transporterName: shipment.courier,
    trackingNumber: shipment.awbNumber,
    lrNumber: shipment.awbNumber,
    transportMode: "Road",
    actualDispatchedAt: now,
    dispatchDate: db.todayDate(),
    dispatchedBy: actor.email,
    dispatchedById: actor.userId,
  });
  const { task } = await WorkflowTask.openTask(
    {
      clientId: ctx.clientId,
      workflowType: "dispatch",
      stage: "in_transit",
      docType: "dispatch",
      docId: d.id,
      docNumber: d.dispatchNumber,
      counterparty: ctx.customerName,
      docStatus: "confirmed",
      ownerRole: "warehouse",
      requiredAction: `Track ${shipment.courier} AWB ${shipment.awbNumber} until delivered`,
      nextAction: "Mark delivered",
      linkedDocs: [{ type: "marketplace_order", id: order.id, number: orderNo }],
    },
    actor,
  );
  order = await setOrder(order, {
    courier: shipment.courier,
    awbNumber: shipment.awbNumber,
    trackingStatus: "In Transit",
    shippedAt: now,
    whizunikStatus: ORDER_STATUS.SHIPPED,
    amazonOrderStatus: "Shipped",
    warehouseTaskId: task.id,
  });
  await GoodsSO.update(so.id, { nextRequiredAction: "In transit" });
  await resolveExceptions(ctx, actor, orderNo, ["ShipmentConfirmationFailure", "MissingTrackingNumber"], `Dispatched via ${shipment.courier} ${shipment.awbNumber}`);
  await audit(ctx, actor, "dispatched", orderNo, {
    courier: shipment.courier,
    awbNumber: shipment.awbNumber,
    stockOut: (d.lines ?? []).reduce((n, l) => n + (l.dispatchedQty ?? 0), 0),
  });
  return order;
}

export async function markDelivered(ctx: FulfilmentContext, orderNo: string, actor: Actor): Promise<Order> {
  let order = await requireOrder(ctx, orderNo);
  const d = await requireDispatch(order);
  if (!d.stockDebited) throw new PipelineError("Confirm dispatch before marking the order delivered", "SequenceError");
  if (d.shippingStatus === "delivered") throw new PipelineError(`${orderNo} is already delivered`, "SequenceError", 409);
  const lines = (d.lines ?? [])
    .filter((l) => (l.dispatchedQty ?? 0) > (l.deliveredQty ?? 0))
    .map((l) => ({ productId: l.productId, deliveredQty: (l.dispatchedQty ?? 0) - (l.deliveredQty ?? 0) }));
  const now = db.nowISO();
  await GoodsDispatch.markDelivered(d.id, lines, db.todayDate(), actor.email);
  await GoodsDispatch.update(d.id, { shippingStatus: "delivered", shippingStatusAt: now, shippingStatusBy: actor.email });
  await WorkflowTask.closeTasksForDoc("dispatch", d.id, actor, "Delivered");
  order = await setOrder(order, {
    whizunikStatus: ORDER_STATUS.DELIVERED,
    amazonOrderStatus: "Delivered",
    trackingStatus: "Delivered",
    deliveredAt: now,
  });
  await audit(ctx, actor, "delivered", orderNo, { deliveredAt: now });
  return order;
}

// ── Phase 9–11: return → inspection → stock decision → credit note → refund → close ──

export async function createReturn(
  ctx: FulfilmentContext,
  orderNo: string,
  input: { quantity: number; reason: string; amazonReturnId?: string | null },
  actor: Actor,
): Promise<Return> {
  let order = await requireOrder(ctx, orderNo);
  const d = order.dispatchId ? await GoodsDispatch.get(order.dispatchId) : null;
  if (!d?.stockDebited) throw new PipelineError("Only a dispatched order can be returned", "SequenceError");
  const existing = await AmazonReturn.findByAmazonOrderId(ctx.clientId, orderNo);
  if (existing) {
    throw new PipelineError(`Return ${existing.returnNumber ?? existing.id} already exists for ${orderNo} — duplicate return refused`, "DuplicateReturn", 409);
  }
  const shipped = (d.lines ?? []).reduce((n, l) => n + (l.dispatchedQty ?? 0), 0);
  const qty = Number(input.quantity);
  if (!Number.isInteger(qty) || qty < 1 || qty > shipped) {
    throw new PipelineError(`Return quantity must be between 1 and the ${shipped} dispatched`, "Validation");
  }
  const invoice = order.invoiceRecordId ? await InvoiceRecord.get(order.invoiceRecordId) : null;
  const created = await AmazonReturn.create({
    clientId: ctx.clientId,
    amazonOrderId: orderNo,
    whizunikSalesOrderId: order.salesOrderId!,
    amazonReturnId: input.amazonReturnId ?? null,
    returnStatus: "ReturnInitiated",
    quantityReturned: qty,
    quantityAccepted: 0,
    quantityDamaged: 0,
    quantityMissing: 0,
    returnReason: input.reason || "Customer return",
    conditionDescription: null,
  });
  const ret = (await AmazonReturn.update(created.id, {
    returnNumber: docNumber(ctx, "RET", orderNo),
    salesOrderNumber: order.salesOrderNumber ?? null,
    invoiceRecordId: invoice?.id ?? null,
    invoiceNumber: invoice?.invoiceNumber ?? null,
    dispatchId: d.id,
    productId: order.productId ?? null,
    sku: order.internalSku ?? null,
    damagedDisposition: null,
  })) as Return;
  order = await setOrder(order, { whizunikStatus: ORDER_STATUS.RETURN_INITIATED });
  await audit(ctx, actor, "return_initiated", orderNo, { returnNumber: ret.returnNumber, quantity: qty, reason: ret.returnReason });
  return ret;
}

const RETURN_FLOW = ["ReturnInitiated", "InTransit", "Received", "UnderInspection"] as const;

export async function advanceReturn(
  ctx: FulfilmentContext,
  returnId: string,
  to: "InTransit" | "Received" | "UnderInspection",
  actor: Actor,
): Promise<Return> {
  const ret = await requireReturn(returnId);
  const from = RETURN_FLOW.indexOf(ret.returnStatus as any);
  if (from < 0 || RETURN_FLOW[from + 1] !== to) {
    throw new PipelineError(`Return is "${ret.returnStatus}" — next step is ${RETURN_FLOW[from + 1] ?? "inspection result"}`, "SequenceError");
  }
  const updated = (await AmazonReturn.update(ret.id, {
    returnStatus: to,
    ...(to === "Received" ? { goodsReceivedAt: db.nowISO() } : {}),
  })) as Return;
  await audit(ctx, actor, `return_${to.toLowerCase()}`, ret.amazonOrderId, { returnNumber: ret.returnNumber });
  return updated;
}

/** Phase 10 — inspection result and stock decision. Damaged units never reach available stock. */
export async function inspectReturn(
  ctx: FulfilmentContext,
  returnId: string,
  input: { accepted: number; damaged: number; missing?: number; notes?: string | null },
  actor: Actor,
): Promise<Return> {
  const ret = await requireReturn(returnId);
  if (ret.returnStatus !== "UnderInspection") {
    throw new PipelineError(`Return is "${ret.returnStatus}" — move it to Under Inspection first`, "SequenceError");
  }
  const accepted = Number(input.accepted) || 0;
  const damaged = Number(input.damaged) || 0;
  const missing = Number(input.missing) || 0;
  if ([accepted, damaged, missing].some((n) => !Number.isInteger(n) || n < 0) || accepted + damaged + missing !== ret.quantityReturned) {
    throw new PipelineError(`Accepted + damaged + missing must equal the ${ret.quantityReturned} returned`, "Validation");
  }
  const product = ret.productId ? await Product.get(ret.productId) : null;
  if (!product) throw new PipelineError("Returned product not found", "NotFound", 404);
  const now = db.nowISO();
  const base = {
    clientId: ctx.clientId,
    productId: product.id,
    direction: "in" as const,
    itemName: product.name,
    sku: product.sku,
    unit: product.unitOfMeasure || "piece",
    unitCost: exGstPrice(product.unitCost ?? 0, product.gstRate),
    linkedDocumentType: "Marketplace Return",
    linkedDocumentNumber: ret.returnNumber ?? null,
    status: "confirmed" as const,
    salesOrderId: ret.whizunikSalesOrderId,
    goodsDispatchId: ret.dispatchId ?? null,
    channel: ctx.channel,
    createdById: actor.userId,
    createdByName: actor.email,
    confirmedById: actor.userId,
    confirmedByName: actor.email,
    confirmedAt: now,
  };
  if (accepted > 0) {
    await StockMovement.create({
      ...base,
      quantity: accepted,
      warehouse: ctx.warehouseName,
      destinationLocationId: ctx.warehouseLocationId,
      reason: "Marketplace return — accepted, resalable",
      notes: `${ret.returnNumber}: ${accepted} back to available stock`,
    });
  }
  if (damaged > 0) {
    await StockMovement.create({
      ...base,
      quantity: damaged,
      warehouse: ctx.inspectionName,
      destinationLocationId: ctx.inspectionLocationId,
      reason: "Marketplace return — damaged / rejected, under inspection (not sellable)",
      notes: `${ret.returnNumber}: ${damaged} held in ${ctx.inspectionName}`,
    });
  }
  if (ret.dispatchId && accepted + damaged > 0) {
    await GoodsDispatch.recordReturned(ret.dispatchId, [{ productId: product.id, returnedQty: accepted + damaged }], actor.email);
  }
  const status = accepted === ret.quantityReturned ? "Accepted" : accepted === 0 ? "Rejected" : "PartiallyAccepted";
  const updated = (await AmazonReturn.update(ret.id, {
    returnStatus: status,
    quantityAccepted: accepted,
    quantityDamaged: damaged,
    quantityMissing: missing,
    warehouseInspectionNotes: input.notes ?? null,
    checkerId: actor.userId,
    checkerName: actor.email,
    checkerApprovedAt: now,
  })) as Return;
  const order = await requireOrder(ctx, ret.amazonOrderId);
  await setOrder(order, { whizunikStatus: ORDER_STATUS.RETURNED, amazonOrderStatus: "Returned" });
  await audit(ctx, actor, "return_inspected", ret.amazonOrderId, { returnNumber: ret.returnNumber, accepted, damaged, missing, result: status });
  return updated;
}

/** Phase 11 — credit note for the approved financial quantity only. */
export async function createCreditNote(
  ctx: FulfilmentContext,
  returnId: string,
  input: { approvedQty?: number | null },
  actor: Actor,
): Promise<Return> {
  const ret = await requireReturn(returnId);
  if (ret.creditNoteId) {
    throw new PipelineError(`Credit note ${ret.creditNoteNumber ?? ""} already exists for this return`, "DuplicateCreditNote", 409);
  }
  if (!["Accepted", "PartiallyAccepted"].includes(ret.returnStatus)) {
    throw new PipelineError("Inspect the return first — a credit note covers only the accepted quantity", "SequenceError");
  }
  const received = ret.quantityAccepted + ret.quantityDamaged;
  const approvedQty = input.approvedQty == null ? ret.quantityAccepted : Number(input.approvedQty);
  if (!Number.isInteger(approvedQty) || approvedQty < 1 || approvedQty > received) {
    throw new PipelineError(`Approved quantity must be between 1 and the ${received} received`, "Validation");
  }
  const order = await requireOrder(ctx, ret.amazonOrderId);
  const unit = unitNetPrice(order);
  const amount = round2(unit * approvedQty);
  const rate = order.taxInformation?.taxRate ?? 0;
  const split = splitGstInclusive(amount, rate);
  const refund = ret.refundId ? await AmazonRefund.get(ret.refundId) : null;
  const now = db.nowISO();
  const cn = await CreditDebitNote.create({
    clientId: ctx.clientId,
    kind: "credit",
    noteNumber: docNumber(ctx, "CN", ret.amazonOrderId),
    amount,
    reason: `${ctx.channel} return ${ret.returnNumber}: ${ret.returnReason ?? "customer return"}`,
    status: refund ? "refunded" : "approved",
    counterparty: ctx.customerName,
    lineItems: [
      {
        sku: ret.sku,
        name: order.productName,
        colour: order.colour,
        size: order.size,
        quantity: approvedQty,
        unitPrice: round2(unit),
        gstRate: rate,
        amount,
      },
    ],
    subtotal: split.taxableValue,
    taxRate: rate,
    taxAmount: split.gstAmount,
    notes: `Against ${ctx.channel} invoice ${ret.invoiceNumber ?? "—"} (issued by ${ctx.channel}) for order ${ret.amazonOrderId}`,
    source: "marketplace_return",
    marketplaceLinks: {
      channel: ctx.channel,
      amazonOrderId: ret.amazonOrderId,
      salesOrderId: ret.whizunikSalesOrderId,
      salesOrderNumber: ret.salesOrderNumber ?? null,
      invoiceRecordId: ret.invoiceRecordId ?? null,
      invoiceNumber: ret.invoiceNumber ?? null,
      returnId: ret.id,
      returnNumber: ret.returnNumber ?? null,
      acceptedQty: approvedQty,
      refundReference: refund?.refundReference ?? null,
    },
  });
  await CreditDebitNote.update(cn.id, { approvedBy: actor.email, approvedByName: actor.email, approvedAt: now });
  const updated = (await AmazonReturn.update(ret.id, {
    creditNoteId: cn.id,
    creditNoteNumber: cn.noteNumber,
    returnStatus: refund ? "RefundConfirmed" : "CreditNoteCreated",
  })) as Return;
  await audit(ctx, actor, "credit_note_created", ret.amazonOrderId, { creditNoteNumber: cn.noteNumber, approvedQty, amount });
  return updated;
}

/**
 * Record the marketplace's refund to the customer. WhizUnik never refunds again:
 * one refund per return, whether it arrives before or after the credit note.
 */
export async function recordRefund(
  ctx: FulfilmentContext,
  returnId: string,
  input: { refundReference: string; amount?: number | null },
  actor: Actor,
): Promise<Return> {
  const ret = await requireReturn(returnId);
  const prior = ret.refundId
    ? await AmazonRefund.get(ret.refundId)
    : (await AmazonRefund.list(ctx.clientId)).find((r) => r.linkedReturnId === ret.id) ?? null;
  if (prior) {
    throw new PipelineError(`Refund ${prior.refundReference} is already recorded for this return — a second refund is not allowed`, "DuplicateRefund", 409);
  }
  if (!input.refundReference) throw new PipelineError("Amazon refund reference is required", "Validation");
  const order = await requireOrder(ctx, ret.amazonOrderId);
  const cn = ret.creditNoteId ? await CreditDebitNote.get(ret.creditNoteId) : null;
  const inspected = !RETURN_FLOW.includes(ret.returnStatus as any);
  const qty = inspected ? ret.quantityAccepted || ret.quantityReturned : ret.quantityReturned;
  const amount = round2(input.amount ?? cn?.amount ?? unitNetPrice(order) * qty);
  const refund = await AmazonRefund.create({
    clientId: ctx.clientId,
    amazonOrderId: ret.amazonOrderId,
    whizunikSalesOrderId: ret.whizunikSalesOrderId,
    amazonRefundId: input.refundReference,
    refundReference: input.refundReference,
    amount,
    currency: "INR",
    refundStatus: "Completed",
    refundDate: db.todayDate(),
    linkedReturnId: ret.id,
  });
  if (cn) {
    await CreditDebitNote.update(cn.id, {
      status: "refunded",
      notes: `${cn.notes ?? ""} · ${ctx.channel} refund ${input.refundReference}`.trim(),
      marketplaceLinks: { ...(cn.marketplaceLinks ?? {}), refundReference: input.refundReference },
    });
  }
  const updated = (await AmazonReturn.update(ret.id, {
    refundId: refund.id,
    refundReference: input.refundReference,
    refundStatus: "Completed",
    ...(cn ? { returnStatus: "RefundConfirmed" as const } : {}),
  })) as Return;
  await setOrder(order, { whizunikStatus: ORDER_STATUS.REFUNDED, amazonOrderStatus: "Refunded" });
  await audit(ctx, actor, "refund_recorded", ret.amazonOrderId, { refundReference: input.refundReference, amount });
  return updated;
}

/** Decide what happens to damaged / rejected units (they stay out of available stock). */
export async function setDamagedDisposition(
  ctx: FulfilmentContext,
  returnId: string,
  input: { disposition: string; approvedBy?: string | null; notes?: string | null },
  actor: Actor,
): Promise<Return> {
  const ret = await requireReturn(returnId);
  if (!(ret.quantityDamaged > 0)) throw new PipelineError("This return has no damaged units", "Validation");
  if (!(DAMAGED_DISPOSITIONS as readonly string[]).includes(input.disposition)) {
    throw new PipelineError(`Disposition must be one of: ${DAMAGED_DISPOSITIONS.join(", ")}`, "Validation");
  }
  if (ret.damagedDisposition && ret.damagedDisposition !== "Pending decision") {
    throw new PipelineError(`Damaged units are already "${ret.damagedDisposition}"`, "SequenceError", 409);
  }
  if (input.disposition === "Written off with approval" && !input.approvedBy) {
    throw new PipelineError("A write-off needs the approver's name", "Validation");
  }
  const now = db.nowISO();
  if (input.disposition !== "Pending decision") {
    const product = ret.productId ? await Product.get(ret.productId) : null;
    const reason = {
      Returned: "Damaged return — sent back",
      "Recovered through claim": `Damaged return — recovered through ${ctx.channel} claim`,
      "Written off with approval": `Damaged return — written off (approved by ${input.approvedBy})`,
    }[input.disposition as "Returned"];
    await StockMovement.create({
      clientId: ctx.clientId,
      productId: ret.productId ?? null,
      direction: "out",
      itemName: product?.name ?? ret.sku ?? "Returned item",
      sku: ret.sku ?? null,
      quantity: ret.quantityDamaged,
      unit: product?.unitOfMeasure || "piece",
      unitCost: product ? exGstPrice(product.unitCost ?? 0, product.gstRate) : null,
      warehouse: ctx.inspectionName,
      sourceLocationId: ctx.inspectionLocationId,
      reason,
      linkedDocumentType: "Marketplace Return",
      linkedDocumentNumber: ret.returnNumber ?? null,
      status: "confirmed",
      channel: ctx.channel,
      createdById: actor.userId,
      createdByName: actor.email,
      confirmedById: actor.userId,
      confirmedByName: actor.email,
      confirmedAt: now,
      notes: input.notes ?? null,
    });
  }
  const updated = (await AmazonReturn.update(ret.id, {
    damagedDisposition: input.disposition,
    damagedDispositionBy: input.approvedBy || actor.email,
    damagedDispositionAt: now,
    damagedDispositionNotes: input.notes ?? null,
  })) as Return;
  await audit(ctx, actor, "damaged_disposition", ret.amazonOrderId, {
    returnNumber: ret.returnNumber,
    quantity: ret.quantityDamaged,
    disposition: input.disposition,
    approvedBy: input.approvedBy ?? null,
  });
  return updated;
}

export async function closeReturn(ctx: FulfilmentContext, returnId: string, actor: Actor): Promise<Return> {
  const ret = await requireReturn(returnId);
  if (ret.returnStatus === "Closed") throw new PipelineError("Return is already closed", "SequenceError", 409);
  if (RETURN_FLOW.includes(ret.returnStatus as any)) throw new PipelineError("Inspect the return before closing it", "SequenceError");
  if (ret.quantityDamaged > 0 && !ret.damagedDisposition) {
    throw new PipelineError(
      `Record what happens to the ${ret.quantityDamaged} damaged units (${DAMAGED_DISPOSITIONS.join(" / ")}) before closing`,
      "SequenceError",
    );
  }
  if (ret.returnStatus !== "Rejected" && !ret.creditNoteId) throw new PipelineError("Create the credit note before closing", "SequenceError");
  if (ret.creditNoteId && !ret.refundId) throw new PipelineError("Record the Amazon refund reference before closing", "SequenceError");
  const updated = (await AmazonReturn.update(ret.id, { returnStatus: "Closed", closedAt: db.nowISO() })) as Return;
  const order = await requireOrder(ctx, ret.amazonOrderId);
  await setOrder(order, { whizunikStatus: ORDER_STATUS.CLOSED });
  await audit(ctx, actor, "return_closed", ret.amazonOrderId, { returnNumber: ret.returnNumber });
  return updated;
}

// ── Phase 12: settlement → bank receipt → reconciliation ──

export async function createSettlement(
  ctx: FulfilmentContext,
  orderNo: string,
  input: { commission: number; shippingFee: number; otherDeductions: number; settlementReference?: string | null; expectedDate?: string | null },
  actor: Actor,
) {
  const order = await requireOrder(ctx, orderNo);
  const d = order.dispatchId ? await GoodsDispatch.get(order.dispatchId) : null;
  if (!d?.stockDebited) throw new PipelineError("Only a dispatched order can be settled", "SequenceError");
  const existing = (await MarketplaceSettlement.list(ctx.clientId)).find((s) => s.amazonOrderId === orderNo);
  if (existing) throw new PipelineError(`Settlement ${existing.settlementReference} already exists for ${orderNo}`, "DuplicateSettlement", 409);
  const commission = round2(Number(input.commission) || 0);
  const shippingFee = round2(Number(input.shippingFee) || 0);
  const otherDeductions = round2(Number(input.otherDeductions) || 0);
  const gross = orderValue(order);
  const refunds = round2(
    (await AmazonRefund.list(ctx.clientId)).filter((r) => r.amazonOrderId === orderNo).reduce((n, r) => n + (Number(r.amount) || 0), 0),
  );
  const net = Math.max(0, round2(gross - commission - shippingFee - otherDeductions - refunds));
  const settlement = await MarketplaceSettlement.create({
    clientId: ctx.clientId,
    marketplaceName: ctx.channel,
    settlementReference: input.settlementReference || docNumber(ctx, "SET", orderNo),
    settlementPeriod: db.todayDate().slice(0, 7),
    grossSales: gross,
    marketplaceFees: commission,
    deductions: round2(shippingFee + otherDeductions),
    refundsReturns: refunds,
    expectedSettlementDate: input.expectedDate || db.todayDate(),
    status: "EXPECTED",
    notes: `${ctx.channel} settlement for order ${orderNo}`,
    amazonOrderId: orderNo,
    breakdown: { orderValue: gross, commission, shippingFee, refundAmount: refunds, otherDeductions, netSettlement: net },
  });
  await audit(ctx, actor, "settlement_created", orderNo, { settlementReference: settlement.settlementReference, net });
  return settlement;
}

export async function recordBankReceipt(
  ctx: FulfilmentContext,
  settlementId: string,
  input: { amount: number; receivedOn?: string | null; bankReference?: string | null },
  actor: Actor,
) {
  const s = await MarketplaceSettlement.get(settlementId);
  if (!s) throw new PipelineError("Settlement not found", "NotFound", 404);
  const bankReceipt = {
    amount: round2(Number(input.amount) || 0),
    receivedOn: input.receivedOn || db.todayDate(),
    bankReference: input.bankReference || null,
  };
  await MarketplaceSettlement.update(s.id, { bankReceipt });
  await audit(ctx, actor, "bank_receipt_recorded", s.amazonOrderId ?? s.id, bankReceipt);
  return reconcileSettlement(ctx, s.id, actor);
}

/** Finance reconciliation: order → invoice → dispatch → return → credit note → deductions → net → bank receipt. */
export async function reconcileSettlement(ctx: FulfilmentContext, settlementId: string, actor: Actor) {
  const s = await MarketplaceSettlement.get(settlementId);
  if (!s?.amazonOrderId) throw new PipelineError("Settlement not found", "NotFound", 404);
  const order = await requireOrder(ctx, s.amazonOrderId);
  const value = orderValue(order);
  const invoice = order.invoiceRecordId ? await InvoiceRecord.get(order.invoiceRecordId) : null;
  const dispatch = order.dispatchId ? await GoodsDispatch.get(order.dispatchId) : null;
  const ret = await AmazonReturn.findByAmazonOrderId(ctx.clientId, order.amazonOrderId);
  const cn = ret?.creditNoteId ? await CreditDebitNote.get(ret.creditNoteId) : null;
  const b = s.breakdown ?? {};
  const bank = s.bankReceipt ?? null;
  const expectedNet = Math.max(0, round2(s.grossSales - s.marketplaceFees - s.deductions - s.refundsReturns));
  const checks = [
    { step: "Amazon order", ok: !!order && s.grossSales === value, detail: `${order.amazonOrderId} · ${order.quantity} × ${order.internalSku ?? order.amazonSku} = ₹${value}` },
    {
      step: "Invoice",
      ok: invoice?.status === "InvoiceReceived" && round2(invoice.grandTotal) === value,
      detail: invoice?.invoiceNumber ? `${invoice.invoiceNumber} (issued by ${invoice.issuer}) ₹${invoice.grandTotal}` : "Awaiting Amazon invoice",
    },
    {
      step: "Dispatch",
      ok: dispatch?.stockDebited === true,
      detail: dispatch ? `${dispatch.dispatchNumber} · ${dispatch.transporterName ?? "—"} ${dispatch.trackingNumber ?? ""}`.trim() : "Not dispatched",
    },
    {
      step: "Return",
      ok: !ret || ret.returnStatus === "Closed",
      detail: ret ? `${ret.returnNumber} · ${ret.quantityReturned} returned (${ret.quantityAccepted} resalable, ${ret.quantityDamaged} damaged) · ${ret.returnStatus}` : "No return",
    },
    {
      step: "Credit Note",
      ok: cn ? round2(cn.amount) === s.refundsReturns : s.refundsReturns === 0,
      detail: cn ? `${cn.noteNumber} ₹${cn.amount} · refund ₹${s.refundsReturns}` : `No credit note · refund ₹${s.refundsReturns}`,
    },
    {
      step: "Marketplace deductions",
      ok: round2((b.commission ?? 0) + (b.shippingFee ?? 0) + (b.otherDeductions ?? 0)) === round2(s.marketplaceFees + s.deductions),
      detail: `Commission ₹${b.commission ?? 0} + shipping ₹${b.shippingFee ?? 0} + other ₹${b.otherDeductions ?? 0}`,
    },
    { step: "Net settlement", ok: s.netSettlementExpected === expectedNet, detail: `₹${s.netSettlementExpected}` },
    {
      step: "Bank receipt",
      ok: !!bank && bank.amount === s.netSettlementExpected,
      detail: bank ? `₹${bank.amount} on ${bank.receivedOn}${bank.bankReference ? ` · ${bank.bankReference}` : ""}` : "Not received yet",
    },
  ];
  const reconciled = checks.every((c) => c.ok);
  const mismatch = !!bank && bank.amount !== s.netSettlementExpected;
  await MarketplaceSettlement.update(s.id, {
    reconciliation: { reconciled, checkedAt: db.nowISO(), checks },
    status: reconciled ? "RECEIVED" : mismatch ? "DISPUTED" : s.status,
    actualSettlementDate: bank?.receivedOn ?? null,
  });
  if (mismatch) {
    await raiseException(ctx, actor, {
      affectedOrder: order.amazonOrderId,
      reason: "SettlementDiscrepancy",
      message: `Bank received ₹${bank!.amount} but the net settlement is ₹${s.netSettlementExpected} (difference ₹${round2(bank!.amount - s.netSettlementExpected)})`,
      item: s.settlementReference ?? undefined,
      payload: { settlementId: s.id },
    });
  } else if (reconciled) {
    await resolveExceptions(ctx, actor, order.amazonOrderId, ["SettlementDiscrepancy"], "Settlement reconciled");
  }
  await audit(ctx, actor, "settlement_reconciled", order.amazonOrderId, { reconciled, settlementReference: s.settlementReference });
  return MarketplaceSettlement.get(s.id);
}

// ── read model ───────────────────────────────────────────────────────────────

/** Physical / reserved / available / under-inspection stock per product, from the real ledger. */
export async function stockSummary(ctx: FulfilmentContext) {
  const [products, central, inspection, reserved] = await Promise.all([
    Product.list(ctx.clientId) as Promise<Product.Product[]>,
    stockBalanceByProduct(ctx.clientId, ctx.warehouseLocationId),
    stockBalanceByProduct(ctx.clientId, ctx.inspectionLocationId),
    reservedStockByProduct(ctx.clientId, undefined, ctx.warehouseLocationId),
  ]);
  return products
    .map((p) => {
      const physical = central.get(p.id) ?? 0;
      const held = reserved.get(p.id) ?? 0;
      return {
        productId: p.id,
        sku: p.sku,
        name: p.name,
        colour: p.color,
        size: p.size,
        warehouse: ctx.warehouseName,
        physicalStock: physical,
        reservedStock: held,
        availableStock: Math.max(0, physical - held),
        underInspection: inspection.get(p.id) ?? 0,
      };
    })
    .sort((a, b) => a.sku.localeCompare(b.sku));
}
