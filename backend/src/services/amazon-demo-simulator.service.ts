/**
 * Amazon Demo Simulator — a demo order source for the marketplace fulfilment pipeline.
 *
 * Amazon's sandbox has too little data for a full demo, so this service plays the part
 * of Amazon: it creates demo orders, issues simulated Amazon invoices, books the courier,
 * sends return notifications, refunds and settlements. Everything WhizUnik does with them
 * runs through `marketplace-fulfilment.service.ts` — the same Sales Order, inventory
 * ledger, warehouse task, dispatch, credit note and settlement code a live Amazon adapter
 * will call later.
 *
 * All calls run inside `runAsDemo`, so every record lands in the demo tenant
 * (tenantId MARKETPLACE-DEMO, isDemoData true) and live data is never read or changed.
 */
import * as db from "../dynamodb.js";
import { DEMO_TENANT_ID, runAsDemo } from "../lib/demo-context.js";
import * as Debtor from "../models/debtor.js";
import * as StockLocation from "../models/stock-location.js";
import * as Product from "../models/product.js";
import * as StockMovement from "../models/stock-movement.js";
import * as SkuMapping from "../models/marketplace-amazon-sku-mapping.js";
import * as AmazonOrder from "../models/marketplace-amazon-order.js";
import * as InvoiceRecord from "../models/marketplace-amazon-invoice-record.js";
import * as AmazonReturn from "../models/marketplace-amazon-return.js";
import * as AmazonRefund from "../models/marketplace-amazon-refund.js";
import * as AmazonException from "../models/marketplace-amazon-exception.js";
import * as GoodsSO from "../models/goods-sales-order.js";
import * as GoodsDispatch from "../models/goods-dispatch.js";
import * as CreditDebitNote from "../models/credit-debit-note.js";
import * as MarketplaceSettlement from "../models/marketplace-settlement.js";
import * as AuditLog from "../models/audit-log.js";
import { buildPackingSlipPdf, dispatchToPackingSlipData } from "../lib/document-pdf.js";
import { buildSimulatedInvoicePdf, buildSimulatedSettlementPdf } from "../lib/demo-documents.js";
import { round2 } from "../lib/gst.js";
import * as P from "./marketplace-fulfilment.service.js";

export { DEMO_TENANT_ID };
export const DEMO_CHANNEL = "Amazon";
export const DEMO_CUSTOMER_NAME = "Amazon India (Marketplace) — DEMO";
export const DEMO_COURIER = "BlueDart Express";
const WAREHOUSE_NAME = "Demo Central Warehouse";
const INSPECTION_NAME = "Demo Returns Inspection (not sellable)";
const AUDIT_PREFIX = "amazon_demo";
const DEMO_FEES = { commissionPct: 10, shippingFee: 100, otherDeductions: 50 };

export const DEMO_ADDRESS = {
  addressLine1: "Flat 12, Demo Residency, MG Road",
  addressLine2: null,
  city: "Bengaluru",
  state: "Karnataka",
  postalCode: "560001",
  country: "IN",
};

/** Demo catalogue seeded on reset (opening stock in the demo central warehouse). */
export const DEMO_CATALOGUE = [
  { sku: "GLV-BLU-M", amazonSku: "AMZ-GLV-BLU-M", asin: "B0DEMOGLV1", name: "Demo Gloves", colour: "Blue", size: "Medium", price: 500, mrp: 599, cost: 300, gstRate: 5, hsn: "6116", opening: 100 },
  { sku: "TS-BLK-M", amazonSku: "AMZ-TS-BLK-M", asin: "B0DEMOTSH1", name: "Demo T-Shirt", colour: "Black", size: "Medium", price: 800, mrp: 999, cost: 450, gstRate: 5, hsn: "6109", opening: 50 },
  // In the catalogue but deliberately NOT mapped — used by the "Unmapped SKU" simulation.
  { sku: "GLV-RED-L", amazonSku: "AMZ-GLV-RED-L", asin: "B0DEMOGLV2", name: "Demo Gloves", colour: "Red", size: "Large", price: 500, mrp: 599, cost: 300, gstRate: 5, hsn: "6116", opening: 20, unmapped: true },
];

/** The repeatable test order from the developer note. */
export const JOURNEY_ORDER = {
  amazonOrderId: "AMZ-DEMO-1001",
  amazonSku: "AMZ-GLV-BLU-M",
  internalSku: "GLV-BLU-M",
  productName: "Demo Gloves",
  colour: "Blue",
  size: "Medium",
  quantity: 10,
  sellingPrice: 500,
  discount: 0,
  taxRate: 5,
  fulfilmentType: "EasyShip",
};

export const ERROR_KINDS = [
  "unmapped_sku",
  "insufficient_stock",
  "missing_invoice",
  "dispatch_failure",
  "duplicate_order",
  "duplicate_return",
  "api_failure",
  "settlement_mismatch",
  "missing_tracking",
] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

type Actor = P.Actor;

const suffix = P.orderSuffix;

const demoInvoiceNumber = (orderNo: string) => `AMZ-INV-DEMO-${suffix(orderNo)}`;
const demoAwb = (orderNo: string) => `TRK-DEMO-${suffix(orderNo)}`;
const demoRefundRef = (orderNo: string) => `AMZ-RFND-DEMO-${suffix(orderNo)}`;
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

// ── demo tenant baseline ─────────────────────────────────────────────────────

async function seedBaseline(actor: Actor) {
  const customer = await Debtor.create({
    name: DEMO_CUSTOMER_NAME,
    customerType: "Others",
    billingAddress: "Amazon Seller Services (demo), Bengaluru",
    notes: "Demo marketplace customer — tenant MARKETPLACE-DEMO",
  });
  const warehouse = await StockLocation.create({
    clientId: DEMO_TENANT_ID,
    name: WAREHOUSE_NAME,
    locationType: "central_warehouse",
    channel: DEMO_CHANNEL,
    address: "Demo warehouse, Bengaluru",
  });
  await StockLocation.create({
    clientId: DEMO_TENANT_ID,
    name: INSPECTION_NAME,
    locationType: "other_warehouse",
    address: "Returns bay — damaged / rejected units awaiting a decision",
  });
  for (const c of DEMO_CATALOGUE) {
    const product = await Product.create({
      clientId: DEMO_TENANT_ID,
      sku: c.sku,
      name: c.name,
      color: c.colour,
      size: c.size,
      category: "Demo",
      brand: "WhizUnik Demo",
      unitOfMeasure: "piece",
      unitPrice: c.price,
      ecommercePrice: c.price,
      unitCost: c.cost,
      mrp: c.mrp,
      gstRate: c.gstRate,
      hsnCode: c.hsn,
      reorderLevel: 0,
      status: "active",
    });
    await StockMovement.create({
      clientId: DEMO_TENANT_ID,
      productId: product.id,
      direction: "in",
      itemName: product.name,
      sku: product.sku,
      quantity: c.opening,
      unit: "piece",
      unitCost: c.cost,
      warehouse: warehouse.name,
      destinationLocationId: warehouse.id,
      reason: "Opening stock (demo baseline)",
      status: "confirmed",
      createdByName: actor.email,
      confirmedByName: actor.email,
      confirmedAt: db.nowISO(),
    });
    if (c.unmapped) continue;
    await SkuMapping.create({
      clientId: DEMO_TENANT_ID,
      channelSku: c.amazonSku,
      listingId: c.asin,
      whizunikSku: c.sku,
      colour: c.colour,
      size: c.size,
      productName: c.name,
      variant: `${c.colour} / ${c.size}`,
      warehouse: WAREHOUSE_NAME,
      mrp: c.mrp,
      sellingPrice: c.price,
      hsn: c.hsn,
      gstRate: c.gstRate,
      status: "Mapped",
    });
  }
  await AuditLog.writeAuditLog({
    actorId: actor.userId,
    actorEmail: actor.email,
    action: `${AUDIT_PREFIX}.baseline_seeded`,
    target: DEMO_TENANT_ID,
    detail: { customerId: customer.id, products: DEMO_CATALOGUE.map((c) => `${c.sku} × ${c.opening}`) },
  });
}

async function loadContext(actor: Actor, seedIfMissing = true): Promise<P.FulfilmentContext> {
  const [locations, debtors] = await Promise.all([StockLocation.list(DEMO_TENANT_ID), Debtor.list()]);
  const warehouse = locations.find((l) => l.name === WAREHOUSE_NAME);
  const inspection = locations.find((l) => l.name === INSPECTION_NAME);
  const customer = debtors.find((d) => d.name === DEMO_CUSTOMER_NAME);
  if (!warehouse || !inspection || !customer) {
    if (!seedIfMissing) throw new P.PipelineError("Demo baseline could not be created", "BaselineMissing", 500);
    await seedBaseline(actor);
    return loadContext(actor, false);
  }
  return {
    clientId: DEMO_TENANT_ID,
    channel: DEMO_CHANNEL,
    customerId: customer.id,
    customerName: customer.name,
    warehouseLocationId: warehouse.id,
    warehouseName: warehouse.name,
    inspectionLocationId: inspection.id,
    inspectionName: inspection.name,
    docPrefix: "DEMO-",
    auditPrefix: AUDIT_PREFIX,
  };
}

/** Run `fn` inside the demo tenant with its fulfilment context. */
function demo<T>(actor: Actor, fn: (ctx: P.FulfilmentContext) => Promise<T>): Promise<T> {
  return runAsDemo(async () => fn(await loadContext(actor)));
}

async function audit(ctx: P.FulfilmentContext, actor: Actor, event: string, target: string, detail: Record<string, unknown> = {}) {
  await AuditLog.writeAuditLog({
    actorId: actor.userId,
    actorEmail: actor.email,
    action: `${ctx.auditPrefix}.${event}`,
    target,
    detail: { channel: ctx.channel, simulated: true, ...detail },
  });
}

async function nextOrderNo(ctx: P.FulfilmentContext): Promise<string> {
  const orders = await AmazonOrder.list(ctx.clientId);
  const max = orders.reduce((n, o) => {
    const m = /^AMZ-DEMO-(\d+)$/.exec(o.amazonOrderId);
    return m ? Math.max(n, Number(m[1])) : n;
  }, 1001);
  return `AMZ-DEMO-${max + 1}`;
}

// ── "Amazon" side of the simulation ──────────────────────────────────────────

export interface DemoOrderInput extends Partial<P.MarketplaceOrderInput> {
  /** Hold the Amazon invoice back to show "Awaiting Amazon Invoice". */
  delayInvoice?: boolean;
}

function toOrderInput(input: DemoOrderInput, orderNo: string): P.MarketplaceOrderInput {
  const known = DEMO_CATALOGUE.find((c) => c.amazonSku === input.amazonSku);
  return {
    amazonOrderId: orderNo,
    orderDate: input.orderDate || db.todayDate(),
    amazonSku: input.amazonSku || JOURNEY_ORDER.amazonSku,
    internalSku: input.internalSku ?? known?.sku ?? null,
    productName: input.productName || known?.name || "Demo product",
    colour: input.colour ?? known?.colour ?? null,
    size: input.size ?? known?.size ?? null,
    quantity: Number(input.quantity ?? 1),
    sellingPrice: Number(input.sellingPrice ?? known?.price ?? 0),
    discount: Number(input.discount ?? 0),
    taxRate: Number(input.taxRate ?? known?.gstRate ?? 5),
    deliveryAddress: { ...DEMO_ADDRESS, ...(input.deliveryAddress ?? {}) },
    expectedDispatchDate: input.expectedDispatchDate || inDays(2),
    fulfilmentType: input.fulfilmentType || "EasyShip",
    shippingMethod: input.shippingMethod || "Standard",
  };
}

/** Amazon issues its invoice — WhizUnik only records it. */
async function issueInvoice(ctx: P.FulfilmentContext, orderNo: string, actor: Actor) {
  const order = await P.requireOrder(ctx, orderNo);
  if (order.invoiceDelayed) await AmazonOrder.update(order.id, { invoiceDelayed: false });
  return P.recordChannelInvoice(
    ctx,
    orderNo,
    {
      invoiceNumber: demoInvoiceNumber(orderNo),
      invoiceDate: db.todayDate(),
      attachmentUrl: `/amazon/simulator/documents/invoice/${encodeURIComponent(orderNo)}`,
    },
    actor,
  );
}

/** After mapping/reservation: let "Amazon" issue the invoice unless it is held back. */
async function afterProcessing(ctx: P.FulfilmentContext, orderNo: string, actor: Actor) {
  const order = await P.requireOrder(ctx, orderNo);
  if (order.whizunikStatus !== P.ORDER_STATUS.INVOICE_PENDING) return order;
  if (order.invoiceDelayed) {
    await P.raiseException(ctx, actor, {
      affectedOrder: orderNo,
      reason: "MissingAmazonInvoice",
      message: `Amazon has not issued the invoice for ${orderNo} yet — warehouse task held until it arrives`,
      item: order.internalSku ?? order.amazonSku,
    });
    return order;
  }
  return issueInvoice(ctx, orderNo, actor);
}

async function placeOrder(ctx: P.FulfilmentContext, input: DemoOrderInput, actor: Actor) {
  const orderNo = String(input.amazonOrderId || "").trim() || (await nextOrderNo(ctx));
  try {
    const order = await P.importOrder(ctx, toOrderInput(input, orderNo), actor);
    if (input.delayInvoice) await AmazonOrder.update(order.id, { invoiceDelayed: true });
  } catch (err) {
    if (err instanceof P.PipelineError && err.code === "DuplicateOrder") {
      await P.raiseException(ctx, actor, { affectedOrder: orderNo, reason: "DuplicateOrder", message: err.message, item: orderNo });
    }
    throw err;
  }
  return afterProcessing(ctx, orderNo, actor);
}

async function dispatchOrder(ctx: P.FulfilmentContext, orderNo: string, actor: Actor, awbNumber?: string | null, courier?: string | null) {
  return P.confirmDispatch(
    ctx,
    orderNo,
    { courier: courier || DEMO_COURIER, awbNumber: awbNumber === undefined ? demoAwb(orderNo) : awbNumber },
    actor,
  );
}

/** A fresh demo order taken as far as `until` (used by the error simulations). */
async function orderUpTo(ctx: P.FulfilmentContext, actor: Actor, until: "packed" | "delivered", input: DemoOrderInput = {}) {
  const orderNo = await nextOrderNo(ctx);
  await placeOrder(ctx, { amazonSku: JOURNEY_ORDER.amazonSku, quantity: 2, ...input, amazonOrderId: orderNo }, actor);
  await P.markPacked(ctx, orderNo, actor);
  if (until === "delivered") {
    await dispatchOrder(ctx, orderNo, actor);
    await P.markDelivered(ctx, orderNo, actor);
  }
  return P.requireOrder(ctx, orderNo);
}

async function latestOrder(ctx: P.FulfilmentContext, pick: (o: AmazonOrder.MarketplaceAmazonOrder) => boolean) {
  const orders = (await AmazonOrder.list(ctx.clientId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return orders.find(pick) ?? null;
}

const dispatched = (o: AmazonOrder.MarketplaceAmazonOrder) => !!o.shippedAt;

// ── public API (routes call these) ───────────────────────────────────────────

export const AmazonDemoSimulatorService = {
  /** Reset Demo Baseline — deletes demo-tenant records only (audit trail kept), then re-seeds. */
  async resetDemoBaseline(actor: Actor) {
    return runAsDemo(async () => {
      const items = (await db.scanDemoItems()).filter((i) => i.entityType !== "AuditLog");
      for (let i = 0; i < items.length; i += 25) {
        await Promise.all(items.slice(i, i + 25).map((it) => db.deleteItem(it.pk, it.sk)));
      }
      await seedBaseline(actor);
      const ctx = await loadContext(actor, false);
      await audit(ctx, actor, "reset", DEMO_TENANT_ID, { deletedRecords: items.length });
      return { deletedRecords: items.length };
    });
  },

  addDemoAmazonOrder(input: DemoOrderInput, actor: Actor) {
    return demo(actor, (ctx) => placeOrder(ctx, input, actor));
  },

  addSkuMapping(input: { channelSku: string; whizunikSku: string }, actor: Actor) {
    return demo(actor, async (ctx) => {
      const product = ((await Product.list(ctx.clientId)) as Product.Product[]).find(
        (p) => p.sku.toUpperCase() === String(input.whizunikSku || "").toUpperCase(),
      );
      if (!product) throw new P.PipelineError(`WhizUnik SKU ${input.whizunikSku} is not in the demo catalogue`, "Validation");
      if (!input.channelSku) throw new P.PipelineError("Amazon SKU is required", "Validation");
      const existing = await SkuMapping.findByChannelSku(ctx.clientId, input.channelSku);
      if (existing) throw new P.PipelineError(`${input.channelSku} is already mapped to ${existing.whizunikSku}`, "Duplicate", 409);
      const mapping = await SkuMapping.create({
        clientId: ctx.clientId,
        channelSku: input.channelSku,
        listingId: input.channelSku,
        whizunikSku: product.sku,
        colour: product.color,
        size: product.size,
        productName: product.name,
        variant: [product.color, product.size].filter(Boolean).join(" / "),
        warehouse: ctx.warehouseName,
        mrp: product.mrp ?? 0,
        sellingPrice: product.unitPrice,
        hsn: product.hsnCode ?? "",
        gstRate: product.gstRate ?? 0,
        status: "Mapped",
      });
      await audit(ctx, actor, "sku_mapped", input.channelSku, { whizunikSku: product.sku });
      return mapping;
    });
  },

  /** Goods receipt into the demo central warehouse (fixes "Awaiting Stock"). */
  addDemoStock(input: { sku: string; quantity: number }, actor: Actor) {
    return demo(actor, async (ctx) => {
      const qty = Number(input.quantity);
      if (!Number.isInteger(qty) || qty < 1) throw new P.PipelineError("Quantity must be a whole number of at least 1", "Validation");
      const product = ((await Product.list(ctx.clientId)) as Product.Product[]).find((p) => p.sku === input.sku);
      if (!product) throw new P.PipelineError(`SKU ${input.sku} is not in the demo catalogue`, "Validation");
      const movement = await StockMovement.create({
        clientId: ctx.clientId,
        productId: product.id,
        direction: "in",
        itemName: product.name,
        sku: product.sku,
        quantity: qty,
        unit: product.unitOfMeasure || "piece",
        unitCost: product.unitCost,
        warehouse: ctx.warehouseName,
        destinationLocationId: ctx.warehouseLocationId,
        reason: "Goods receipt (demo)",
        status: "confirmed",
        createdById: actor.userId,
        createdByName: actor.email,
        confirmedByName: actor.email,
        confirmedAt: db.nowISO(),
      });
      await audit(ctx, actor, "stock_received", product.sku, { quantity: qty, location: ctx.warehouseName });
      return movement;
    });
  },

  receiveInvoice(orderNo: string, actor: Actor) {
    return demo(actor, (ctx) => issueInvoice(ctx, orderNo, actor));
  },

  markPacked(orderNo: string, actor: Actor) {
    return demo(actor, (ctx) => P.markPacked(ctx, orderNo, actor));
  },

  /** Confirm Demo Dispatch — BlueDart Express, AWB TRK-DEMO-<order>. */
  confirmDemoDispatch(orderNo: string, actor: Actor, opts: { courier?: string; awbNumber?: string } = {}) {
    return demo(actor, (ctx) => dispatchOrder(ctx, orderNo, actor, opts.awbNumber || undefined, opts.courier));
  },

  markDelivered(orderNo: string, actor: Actor) {
    return demo(actor, (ctx) => P.markDelivered(ctx, orderNo, actor));
  },

  /** Create Demo Return — Amazon return notification for a dispatched order. */
  createDemoReturn(input: { amazonOrderId?: string; quantity?: number; reason?: string }, actor: Actor) {
    return demo(actor, async (ctx) => {
      const order = input.amazonOrderId
        ? await P.requireOrder(ctx, input.amazonOrderId)
        : await latestOrder(ctx, (o) => dispatched(o) && o.whizunikStatus !== P.ORDER_STATUS.CLOSED && !o.whizunikStatus?.startsWith("Return"));
      if (!order) throw new P.PipelineError("No dispatched demo order to return — dispatch an order first", "SequenceError");
      try {
        return await P.createReturn(
          ctx,
          order.amazonOrderId,
          { quantity: input.quantity ?? order.quantity, reason: input.reason || "Customer return — no longer needed", amazonReturnId: `AMZ-RMA-DEMO-${suffix(order.amazonOrderId)}` },
          actor,
        );
      } catch (err) {
        if (err instanceof P.PipelineError && err.code === "DuplicateReturn") {
          await P.raiseException(ctx, actor, { affectedOrder: order.amazonOrderId, reason: "DuplicateReturn", message: err.message, item: order.amazonOrderId });
        }
        throw err;
      }
    });
  },

  /** Create Damaged Return — return received and inspected: all but 2 resalable, 2 damaged. */
  createDamagedReturn(input: { amazonOrderId?: string; quantity?: number; damaged?: number }, actor: Actor) {
    return demo(actor, async (ctx) => {
      const ret = await this.createDemoReturn({ ...input, reason: "Damaged — customer return" }, actor);
      const damaged = Math.min(ret.quantityReturned, Math.max(1, Number(input.damaged ?? 2)));
      await P.advanceReturn(ctx, ret.id, "InTransit", actor);
      await P.advanceReturn(ctx, ret.id, "Received", actor);
      await P.advanceReturn(ctx, ret.id, "UnderInspection", actor);
      return P.inspectReturn(
        ctx,
        ret.id,
        { accepted: ret.quantityReturned - damaged, damaged, missing: 0, notes: `${damaged} unit(s) torn / soiled — held for a decision` },
        actor,
      );
    });
  },

  /** One step of the normal return workflow. */
  returnAction(returnId: string, action: string, body: Record<string, any>, actor: Actor) {
    return demo(actor, async (ctx) => {
      switch (action) {
        case "in_transit":
          return P.advanceReturn(ctx, returnId, "InTransit", actor);
        case "received":
          return P.advanceReturn(ctx, returnId, "Received", actor);
        case "under_inspection":
          return P.advanceReturn(ctx, returnId, "UnderInspection", actor);
        case "inspect":
          return P.inspectReturn(ctx, returnId, { accepted: body.accepted, damaged: body.damaged, missing: body.missing, notes: body.notes }, actor);
        case "credit_note":
          return P.createCreditNote(ctx, returnId, { approvedQty: body.approvedQty ?? null }, actor);
        case "refund": {
          const ret = await AmazonReturn.get(returnId);
          return P.recordRefund(ctx, returnId, { refundReference: body.refundReference || demoRefundRef(ret?.amazonOrderId ?? returnId) }, actor);
        }
        case "disposition":
          return P.setDamagedDisposition(ctx, returnId, { disposition: body.disposition, approvedBy: body.approvedBy, notes: body.notes }, actor);
        case "close":
          return P.closeReturn(ctx, returnId, actor);
        default:
          throw new P.PipelineError(`Unknown return action ${action}`, "Validation");
      }
    });
  },

  /** Simulate Refund — Amazon refunds the customer; WhizUnik stores the reference once. */
  simulateRefund(input: { returnId?: string; refundReference?: string }, actor: Actor) {
    return demo(actor, async (ctx) => {
      const returns = (await AmazonReturn.list(ctx.clientId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const ret = input.returnId ? returns.find((r) => r.id === input.returnId) : returns.find((r) => !r.refundId) ?? returns[0];
      if (!ret) throw new P.PipelineError("No demo return to refund — create a return first", "SequenceError");
      return P.recordRefund(ctx, ret.id, { refundReference: input.refundReference || demoRefundRef(ret.amazonOrderId) }, actor);
    });
  },

  /** Simulate Settlement — Amazon settles the order (10% commission, ₹100 shipping, ₹50 other) and pays the net. */
  simulateSettlement(input: { amazonOrderId?: string; bankShortBy?: number }, actor: Actor) {
    return demo(actor, async (ctx) => {
      const settled = new Set((await MarketplaceSettlement.list(ctx.clientId)).map((s) => s.amazonOrderId));
      const order = input.amazonOrderId
        ? await P.requireOrder(ctx, input.amazonOrderId)
        : await latestOrder(ctx, (o) => dispatched(o) && !settled.has(o.amazonOrderId));
      if (!order) throw new P.PipelineError("No dispatched, unsettled demo order — dispatch an order first", "SequenceError");
      const s = await P.createSettlement(
        ctx,
        order.amazonOrderId,
        {
          commission: round2((P.orderValue(order) * DEMO_FEES.commissionPct) / 100),
          shippingFee: DEMO_FEES.shippingFee,
          otherDeductions: DEMO_FEES.otherDeductions,
          expectedDate: inDays(7),
        },
        actor,
      );
      return P.recordBankReceipt(
        ctx,
        s.id,
        { amount: round2(s.netSettlementExpected - (Number(input.bankShortBy) || 0)), bankReference: `UTR-DEMO-${suffix(order.amazonOrderId)}` },
        actor,
      );
    });
  },

  recordBankReceipt(settlementId: string, input: { amount: number; bankReference?: string }, actor: Actor) {
    return demo(actor, (ctx) => P.recordBankReceipt(ctx, settlementId, input, actor));
  },

  reconcileSettlement(settlementId: string, actor: Actor) {
    return demo(actor, (ctx) => P.reconcileSettlement(ctx, settlementId, actor));
  },

  /** Run one of the error simulations through the real pipeline step. */
  simulateError(kind: ErrorKind, actor: Actor) {
    return demo(actor, async (ctx) => {
      let affectedOrder: string;
      const expectFailure = async (fn: () => Promise<unknown>) => {
        try {
          await fn();
        } catch (err) {
          if (!(err instanceof P.PipelineError)) throw err;
        }
      };
      switch (kind) {
        case "unmapped_sku": {
          affectedOrder = await nextOrderNo(ctx);
          await placeOrder(ctx, { amazonOrderId: affectedOrder, amazonSku: "AMZ-GLV-RED-L", productName: "Demo Gloves", colour: "Red", size: "Large", quantity: 2, sellingPrice: 500 }, actor);
          break;
        }
        case "insufficient_stock": {
          const tee = DEMO_CATALOGUE[1];
          const stock = (await P.stockSummary(ctx)).find((s) => s.sku === tee.sku);
          affectedOrder = await nextOrderNo(ctx);
          await placeOrder(ctx, { amazonOrderId: affectedOrder, amazonSku: tee.amazonSku, quantity: (stock?.availableStock ?? 0) + 10 }, actor);
          break;
        }
        case "missing_invoice": {
          affectedOrder = await nextOrderNo(ctx);
          await placeOrder(ctx, { amazonOrderId: affectedOrder, amazonSku: JOURNEY_ORDER.amazonSku, quantity: 2, delayInvoice: true }, actor);
          break;
        }
        case "dispatch_failure": {
          affectedOrder = (await orderUpTo(ctx, actor, "packed")).amazonOrderId;
          // The courier rejects the booking: dispatch is not confirmed and no stock moves.
          await P.raiseException(ctx, actor, {
            affectedOrder,
            reason: "ShipmentConfirmationFailure",
            message: `${DEMO_COURIER} booking API rejected the pickup request (HTTP 502) — dispatch not confirmed, stock still reserved`,
            item: `DEMO-DSP-${suffix(affectedOrder)}`,
            payload: { courier: DEMO_COURIER },
          });
          break;
        }
        case "missing_tracking": {
          affectedOrder = (await orderUpTo(ctx, actor, "packed")).amazonOrderId;
          await expectFailure(() => dispatchOrder(ctx, affectedOrder, actor, null));
          break;
        }
        case "duplicate_order": {
          const original = (await latestOrder(ctx, () => true)) ?? (await placeOrder(ctx, { amazonSku: JOURNEY_ORDER.amazonSku, quantity: 1 }, actor));
          affectedOrder = original.amazonOrderId;
          await expectFailure(() => placeOrder(ctx, { amazonOrderId: affectedOrder, amazonSku: original.amazonSku, quantity: original.quantity }, actor));
          break;
        }
        case "duplicate_return": {
          const withReturn = new Set((await AmazonReturn.list(ctx.clientId)).map((r) => r.amazonOrderId));
          let order = await latestOrder(ctx, (o) => withReturn.has(o.amazonOrderId));
          if (!order) {
            order = await orderUpTo(ctx, actor, "delivered");
            await P.createReturn(ctx, order.amazonOrderId, { quantity: 1, reason: "Customer return — no longer needed" }, actor);
          }
          affectedOrder = order.amazonOrderId;
          await expectFailure(() => this.createDemoReturn({ amazonOrderId: affectedOrder, quantity: 1 }, actor));
          break;
        }
        case "api_failure": {
          affectedOrder = await nextOrderNo(ctx);
          // Amazon's order API fails mid-import: nothing is created, the payload is kept for retry.
          await P.raiseException(ctx, actor, {
            affectedOrder,
            reason: "APIFailure",
            message: "Amazon SP-API getOrders timed out (HTTP 503) — order not imported; payload kept for retry",
            item: JOURNEY_ORDER.amazonSku,
            payload: { order: { amazonOrderId: affectedOrder, amazonSku: JOURNEY_ORDER.amazonSku, quantity: 1 } },
          });
          break;
        }
        case "settlement_mismatch": {
          affectedOrder = (await orderUpTo(ctx, actor, "delivered")).amazonOrderId;
          // Amazon's bank transfer arrives ₹50 short of the settlement report.
          await this.simulateSettlement({ amazonOrderId: affectedOrder, bankShortBy: 50 }, actor);
          break;
        }
        default:
          throw new P.PipelineError(`Unknown error simulation ${kind}`, "Validation");
      }
      const exceptions = (await AmazonException.list(ctx.clientId)).filter((e) => e.affectedOrder === affectedOrder && e.currentStatus === "Open");
      return { affectedOrder, exception: exceptions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null };
    });
  },

  /** Retry Failed Event — re-runs the step that failed. */
  retryFailedEvent(exceptionId: string, options: { mapToSku?: string; addStock?: number }, actor: Actor) {
    return demo(actor, async (ctx) => {
      const ex = await AmazonException.get(exceptionId);
      if (!ex) throw new P.PipelineError("Exception not found", "NotFound", 404);
      if (ex.currentStatus === "Resolved" || ex.currentStatus === "Closed") throw new P.PipelineError("This event is already resolved", "SequenceError", 409);
      await AmazonException.incrementRetry(ex.id);
      const orderNo = ex.affectedOrder;
      try {
        switch (ex.errorReason) {
          case "UnmappedSKU": {
            const order = await P.requireOrder(ctx, orderNo);
            if (options.mapToSku) await this.addSkuMapping({ channelSku: order.amazonSku, whizunikSku: options.mapToSku }, actor);
            const after = await P.processOrder(ctx, orderNo, actor);
            if (after.whizunikStatus === P.ORDER_STATUS.SKU_MAPPING_REQUIRED) {
              throw new P.PipelineError(`${order.amazonSku} is still unmapped — add a SKU mapping, then retry`, "UnmappedSKU");
            }
            await afterProcessing(ctx, orderNo, actor);
            break;
          }
          case "StockShortage": {
            const order = await P.requireOrder(ctx, orderNo);
            if (options.addStock) await this.addDemoStock({ sku: order.internalSku!, quantity: options.addStock }, actor);
            const after = await P.processOrder(ctx, orderNo, actor);
            if (after.whizunikStatus === P.ORDER_STATUS.AWAITING_STOCK) {
              throw new P.PipelineError("Still not enough available stock — receive stock, then retry", "StockShortage");
            }
            await afterProcessing(ctx, orderNo, actor);
            break;
          }
          case "MissingAmazonInvoice":
            await issueInvoice(ctx, orderNo, actor);
            break;
          case "ShipmentConfirmationFailure":
          case "MissingTrackingNumber":
            await dispatchOrder(ctx, orderNo, actor);
            break;
          case "DuplicateOrder":
          case "DuplicateReturn": {
            const original = ex.errorReason === "DuplicateOrder"
              ? await AmazonOrder.findByAmazonOrderId(ctx.clientId, orderNo)
              : await AmazonReturn.findByAmazonOrderId(ctx.clientId, orderNo);
            if (!original) throw new P.PipelineError("The original record is missing — import it again", "NotFound");
            await AmazonException.resolveException(ex.id, "Re-checked: the original is kept and the duplicate was not imported", actor.email);
            await audit(ctx, actor, "exception_resolved", orderNo, { reason: ex.errorReason });
            break;
          }
          case "APIFailure": {
            const payload = (ex.payload?.order ?? {}) as DemoOrderInput;
            await placeOrder(ctx, { ...payload, amazonOrderId: orderNo }, actor);
            await P.resolveExceptions(ctx, actor, orderNo, ["APIFailure"], "Order imported on retry");
            break;
          }
          case "SettlementDiscrepancy": {
            const s = ex.payload?.settlementId ? await MarketplaceSettlement.get(ex.payload.settlementId) : null;
            if (!s) throw new P.PipelineError("Settlement not found", "NotFound", 404);
            // Finance books the corrected bank receipt and reconciles again.
            await P.recordBankReceipt(ctx, s.id, { amount: s.netSettlementExpected, bankReference: `${s.bankReceipt?.bankReference ?? "UTR-DEMO"}-CORRECTED` }, actor);
            break;
          }
          default:
            throw new P.PipelineError(`No retry for ${ex.errorReason}`, "Validation");
        }
      } catch (err: any) {
        await AmazonException.update(ex.id, { errorMessage: `Retry failed: ${err?.message ?? err}`, currentStatus: "Open" });
        await audit(ctx, actor, "retry_failed", orderNo, { reason: ex.errorReason, error: err?.message });
        throw err;
      }
      await audit(ctx, actor, "retry_succeeded", orderNo, { reason: ex.errorReason });
      return { exception: await AmazonException.get(ex.id), order: await AmazonOrder.findByAmazonOrderId(ctx.clientId, orderNo) };
    });
  },

  /** Run Full Demo Journey — reset, then AMZ-DEMO-1001 through every step, reported from the actual records. */
  async runFullDemoJourney(actor: Actor) {
    await this.resetDemoBaseline(actor);
    return demo(actor, async (ctx) => {
      const steps: Array<{ step: string; status: "success" | "failed"; detail: string }> = [];
      const orderNo = JOURNEY_ORDER.amazonOrderId;
      const stockOf = async () => {
        const s = (await P.stockSummary(ctx)).find((x) => x.sku === JOURNEY_ORDER.internalSku)!;
        return `physical ${s.physicalStock} · reserved ${s.reservedStock} · available ${s.availableStock} · under inspection ${s.underInspection}`;
      };
      const run = async (step: string, fn: () => Promise<string>) => {
        try {
          steps.push({ step, status: "success", detail: await fn() });
        } catch (err: any) {
          steps.push({ step, status: "failed", detail: err?.message ?? String(err) });
          throw err;
        }
      };
      try {
        await run("Amazon order", async () => {
          const o = await P.importOrder(ctx, toOrderInput({ ...JOURNEY_ORDER, deliveryAddress: DEMO_ADDRESS }, orderNo), actor);
          return `${o.amazonOrderId} · ${o.quantity} × ${o.amazonSku} (${o.colour} / ${o.size}) · ₹${P.orderValue(o).toLocaleString("en-IN")} · ${o.fulfilmentType}`;
        });
        await run("SKU mapping", async () => {
          const o = await P.requireOrder(ctx, orderNo);
          if (!o.internalSku) throw new Error(`Order status ${o.whizunikStatus}`);
          return `${o.amazonSku} → ${o.internalSku}`;
        });
        await run("Main inventory reservation", async () => `${JOURNEY_ORDER.internalSku}: ${await stockOf()}`);
        await run("Marketplace Sales Order", async () => {
          const o = await P.requireOrder(ctx, orderNo);
          const so = await GoodsSO.get(o.salesOrderId!);
          return `${so!.soNumber} · buyer order ${so!.buyerOrderNo} · ${so!.status} · stock ${so!.stockStatus} · ₹${so!.grandTotal}`;
        });
        await run("Simulated Amazon invoice", async () => {
          const o = await issueInvoice(ctx, orderNo, actor);
          const inv = await InvoiceRecord.get(o.invoiceRecordId!);
          return `${inv!.invoiceNumber} · issuer ${inv!.issuer} · status Received · total ₹${inv!.grandTotal} (GST ₹${inv!.taxAmount}) · no WhizUnik invoice`;
        });
        await run("Warehouse task", async () => {
          const o = await P.requireOrder(ctx, orderNo);
          const d = await GoodsDispatch.get(o.dispatchId!);
          return `${d!.dispatchNumber} · ${d!.warehouse} · deadline ${d!.plannedDispatchAt ?? "—"} · ${o.fulfilmentType} · picking`;
        });
        await run("Packing slip", async () => {
          const o = await P.markPacked(ctx, orderNo, actor);
          const d = await GoodsDispatch.get(o.dispatchId!);
          return `SIMULATED AMAZON PACKING SLIP for ${d!.dispatchNumber} · ${d!.cartonCount} package · packed ${d!.actualPackedQty}`;
        });
        await run("Courier and AWB", async () => {
          const o = await dispatchOrder(ctx, orderNo, actor);
          return `${o.courier} · AWB ${o.awbNumber} · ${o.trackingStatus}`;
        });
        await run("Dispatch", async () => {
          const o = await P.requireOrder(ctx, orderNo);
          return `WhizUnik ${o.whizunikStatus} · Amazon ${o.amazonOrderStatus}`;
        });
        await run("Stock OUT", async () => `${JOURNEY_ORDER.internalSku}: ${await stockOf()}`);
        await run("Delivered status", async () => {
          const o = await P.markDelivered(ctx, orderNo, actor);
          return `WhizUnik ${o.whizunikStatus} · Amazon ${o.amazonOrderStatus} · ${o.deliveredAt}`;
        });
        let returnId = "";
        await run("Customer return", async () => {
          const r = await P.createReturn(ctx, orderNo, { quantity: 10, reason: "Damaged — customer return", amazonReturnId: `AMZ-RMA-DEMO-${suffix(orderNo)}` }, actor);
          returnId = r.id;
          return `${r.returnNumber} · ${r.quantityReturned} units · linked to ${r.salesOrderNumber} and invoice ${r.invoiceNumber}`;
        });
        await run("Inspection", async () => {
          await P.advanceReturn(ctx, returnId, "InTransit", actor);
          await P.advanceReturn(ctx, returnId, "Received", actor);
          await P.advanceReturn(ctx, returnId, "UnderInspection", actor);
          const r = await P.inspectReturn(ctx, returnId, { accepted: 8, damaged: 2, missing: 0, notes: "2 pairs torn — not resalable" }, actor);
          return `${r.returnStatus} · inspected by ${r.checkerName}`;
        });
        await run("Damaged / resalable split", async () => `10 returned → 8 to available stock, 2 held in ${ctx.inspectionName}: ${await stockOf()}`);
        await run("Credit Note", async () => {
          const r = await P.createCreditNote(ctx, returnId, {}, actor);
          const cn = await CreditDebitNote.get(r.creditNoteId!);
          return `${cn!.noteNumber} · ${cn!.marketplaceLinks?.acceptedQty} accepted × ₹${JOURNEY_ORDER.sellingPrice} = ₹${cn!.amount} · against ${cn!.marketplaceLinks?.invoiceNumber}`;
        });
        await run("Refund reference", async () => {
          const r = await P.recordRefund(ctx, returnId, { refundReference: demoRefundRef(orderNo) }, actor);
          return `${r.refundReference} · ₹${(await CreditDebitNote.get(r.creditNoteId!))!.amount} refunded by Amazon · no second refund`;
        });
        await run("Damaged units decision", async () => {
          const r = await P.setDamagedDisposition(ctx, returnId, { disposition: "Written off with approval", approvedBy: "Finance Manager (demo)", notes: "Below repair value" }, actor);
          return `${r.quantityDamaged} units ${r.damagedDisposition} (${r.damagedDispositionBy}) · ${await stockOf()}`;
        });
        await run("Return closed", async () => {
          const r = await P.closeReturn(ctx, returnId, actor);
          return `${r.returnNumber} ${r.returnStatus}`;
        });
        await run("Settlement reconciliation", async () => {
          const s = await this.simulateSettlement({ amazonOrderId: orderNo }, actor);
          const b = s!.breakdown ?? {};
          return `${s!.settlementReference}: ₹${b.orderValue} − commission ₹${b.commission} − shipping ₹${b.shippingFee} − refund ₹${b.refundAmount} − other ₹${b.otherDeductions} = net ₹${b.netSettlement} · bank ₹${s!.bankReceipt?.amount} · ${s!.reconciliation?.reconciled ? "reconciled" : "NOT reconciled"}`;
        });
      } catch {
        /* the failed step is already in `steps` */
      }
      await audit(ctx, actor, "journey_run", orderNo, { steps: steps.length, failed: steps.filter((s) => s.status === "failed").length });
      return { amazonOrderId: orderNo, completed: steps.every((s) => s.status === "success"), steps };
    });
  },

  /** Everything the simulator page shows, read from the demo tenant's real records. */
  getState(actor: Actor) {
    return demo(actor, async (ctx) => {
      const c = ctx.clientId;
      const [orders, mappings, stock, sos, invoices, dispatches, taskPage, returns, refunds, notes, settlements, exceptions, movements, auditRows] =
        await Promise.all([
          AmazonOrder.list(c),
          SkuMapping.list(c),
          P.stockSummary(ctx),
          GoodsSO.list(c),
          InvoiceRecord.list(c),
          GoodsDispatch.list(c),
          db.queryByGSI1(c, { entityType: "WorkflowTask", limit: 500 }),
          AmazonReturn.list(c),
          AmazonRefund.list(c),
          CreditDebitNote.list(c),
          MarketplaceSettlement.list(c),
          AmazonException.list(c),
          StockMovement.list(c),
          AuditLog.list({ limit: 1000 }),
        ]);
      const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));
      const soById = byId(sos);
      const dispatchById = byId(dispatches);
      const invoiceById = byId(invoices);
      const returnByOrder = new Map(returns.map((r) => [r.amazonOrderId, r]));
      const settlementByOrder = new Map(settlements.map((s) => [s.amazonOrderId, s]));
      const newest = <T extends { createdAt: string }>(rows: T[]) => [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return {
        tenantId: DEMO_TENANT_ID,
        isDemoData: true,
        warehouse: ctx.warehouseName,
        inspectionLocation: ctx.inspectionName,
        customer: ctx.customerName,
        defaults: { courier: DEMO_COURIER, address: DEMO_ADDRESS, journeyOrder: JOURNEY_ORDER, fees: DEMO_FEES, catalogue: DEMO_CATALOGUE },
        stock,
        orders: newest(orders).map((o) => {
          const so = o.salesOrderId ? soById.get(o.salesOrderId) : null;
          const d = o.dispatchId ? dispatchById.get(o.dispatchId) : null;
          const inv = o.invoiceRecordId ? invoiceById.get(o.invoiceRecordId) : null;
          const reserved = so && ["confirmed", "partially_dispatched", "warehouse_approved", "checker_pending"].includes(so.status);
          return {
            ...o,
            orderValue: P.orderValue(o),
            deliveryAddressText: P.formatAddress(o.deliveryAddress),
            salesOrderStatus: so?.status ?? null,
            reservation: d?.stockDebited
              ? `Converted to stock OUT (${o.quantity})`
              : reserved
                ? `Reserved ${o.quantity} in ${ctx.warehouseName}`
                : "Not reserved",
            invoiceNumber: inv?.invoiceNumber ?? null,
            invoiceRecordStatus: inv?.status ?? null,
            dispatchStatus: d ? (d.shippingStatus ?? d.status) : null,
            returnId: returnByOrder.get(o.amazonOrderId)?.id ?? null,
            settlementId: settlementByOrder.get(o.amazonOrderId)?.id ?? null,
          };
        }),
        mappings,
        salesOrders: newest(sos),
        invoices: newest(invoices),
        dispatches: newest(dispatches),
        warehouseTasks: newest(taskPage.items as any[]),
        returns: newest(returns),
        refunds: newest(refunds),
        creditNotes: newest(notes),
        settlements: newest(settlements),
        exceptions: newest(exceptions).map((e) => ({ ...e, payload: undefined })),
        ledger: newest(movements).slice(0, 100),
        auditTrail: auditRows.filter((a) => String(a.action).startsWith(`${AUDIT_PREFIX}.`)).slice(0, 200),
      };
    });
  },

  /** Simulated document PDFs (each clearly marked as a demo document). */
  getDocument(kind: "invoice" | "packing-slip" | "settlement", orderNo: string, actor: Actor) {
    return demo(actor, async (ctx): Promise<{ filename: string; pdf: Buffer }> => {
      const order = await P.requireOrder(ctx, orderNo);
      if (kind === "invoice") {
        const inv = order.invoiceRecordId ? await InvoiceRecord.get(order.invoiceRecordId) : null;
        if (!inv?.invoiceNumber) throw new P.PipelineError("Awaiting Amazon invoice — no invoice document yet", "SequenceError", 404);
        const pdf = await buildSimulatedInvoicePdf({
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.invoiceIssueDate ?? db.todayDate(),
          amazonOrderId: order.amazonOrderId,
          salesOrderNumber: order.salesOrderNumber ?? null,
          issuer: inv.issuer,
          status: inv.status === "InvoiceReceived" ? "Received" : inv.status,
          productName: order.productName,
          sku: order.internalSku ?? null,
          amazonSku: order.amazonSku,
          colour: order.colour,
          size: order.size,
          quantity: order.quantity,
          sellingPrice: order.sellingPrice,
          discount: order.discount,
          taxRate: inv.taxRate,
          taxableAmount: inv.taxableAmount,
          taxAmount: inv.taxAmount,
          total: inv.grandTotal,
          deliveryAddress: P.formatAddress(order.deliveryAddress),
        });
        return { filename: `${inv.invoiceNumber}.pdf`, pdf };
      }
      if (kind === "packing-slip") {
        const d = order.dispatchId ? await GoodsDispatch.get(order.dispatchId) : null;
        if (!d) throw new P.PipelineError("No warehouse task yet — no packing slip", "SequenceError", 404);
        const inv = order.invoiceRecordId ? await InvoiceRecord.get(order.invoiceRecordId) : null;
        const data = dispatchToPackingSlipData(d, { name: "WhizUnik Demo Seller · MARKETPLACE-DEMO" });
        data.watermark = "SIMULATED AMAZON PACKING SLIP · DEMO DOCUMENT";
        data.invoiceNumber = inv?.invoiceNumber ?? null;
        data.notes = `Amazon order ${order.amazonOrderId} · ${order.fulfilmentType} · ${d.cartonCount ?? 1} package(s)`;
        return { filename: `${d.dispatchNumber}-packing-slip.pdf`, pdf: await buildPackingSlipPdf(data) };
      }
      const s = (await MarketplaceSettlement.list(ctx.clientId)).find((x) => x.amazonOrderId === orderNo);
      if (!s) throw new P.PipelineError("No settlement for this order yet", "SequenceError", 404);
      const b = s.breakdown ?? {};
      const pdf = await buildSimulatedSettlementPdf({
        settlementReference: s.settlementReference ?? s.id,
        settlementPeriod: s.settlementPeriod,
        amazonOrderId: orderNo,
        status: s.status,
        orderValue: b.orderValue ?? s.grossSales,
        commission: b.commission ?? s.marketplaceFees,
        shippingFee: b.shippingFee ?? 0,
        refundAmount: b.refundAmount ?? s.refundsReturns,
        otherDeductions: b.otherDeductions ?? 0,
        netSettlement: s.netSettlementExpected,
        bankReceipt: s.bankReceipt ?? null,
        reconciliation: (s.reconciliation as any) ?? null,
      });
      return { filename: `${s.settlementReference ?? "settlement"}.pdf`, pdf };
    });
  },
};
