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
import * as CreditDebitNote from "../models/credit-debit-note.js";
import * as MarketplaceSettlement from "../models/marketplace-settlement.js";
import * as Debtor from "../models/debtor.js";
import * as StockLocation from "../models/stock-location.js";
import * as AuditLog from "../models/audit-log.js";
import * as P from "./marketplace-fulfilment.service.js";
import { buildPackingSlipPdf, dispatchToPackingSlipData } from "../lib/document-pdf.js";
import { buildSimulatedInvoicePdf, buildSimulatedSettlementPdf } from "../lib/demo-documents.js";
import { round2 } from "../lib/gst.js";

type Actor = P.Actor;

const AUDIT_PREFIX = "amazon_live";
const DEFAULT_CHANNEL = "Amazon India";
const DEFAULT_COURIER = "BlueDart Express";
const DEFAULT_FEES = { commissionPct: 10, shippingFee: 100, otherDeductions: 50 };

export interface LiveOrderInput extends Partial<P.MarketplaceOrderInput> {
  delayInvoice?: boolean;
}

/** Get or create a default marketplace customer (Debtor) for this client */
async function getOrCreateMarketplaceCustomer(clientId: string): Promise<Debtor.Debtor> {
  const debtors = await Debtor.list();
  const found = debtors.find(
    (d: any) =>
      (d.clientId === clientId || !d.clientId) &&
      (d.name.toLowerCase().includes("amazon") || d.name.toLowerCase().includes("marketplace")),
  );
  if (found) return found;

  return Debtor.create({
    name: "Amazon India (Marketplace)",
    customerType: "Others",
    billingAddress:
      "Amazon Seller Services Pvt Ltd, Brigade Gateway, 8/1, 26/1, Dr Rajkumar Road, Malleshwaram West, Bengaluru, Karnataka 560055",
    creditLimit: 10000000,
    paymentTermsDays: 30,
  });
}

/** Get or create an inspection location for damaged returns */
async function getOrCreateInspectionLocation(clientId: string, defaultLoc: StockLocation.StockLocation): Promise<StockLocation.StockLocation> {
  const locations = await StockLocation.list(clientId);
  const inspection = locations.find(
    (l) => (l.locationType === "other_warehouse" || l.name.toLowerCase().includes("inspection")) && l.status === "active",
  );
  if (inspection) return inspection;

  try {
    return await StockLocation.create({
      clientId,
      name: "Returns Inspection (Damaged)",
      locationType: "other_warehouse",
      status: "active",
    });
  } catch {
    return defaultLoc;
  }
}

/** Load the fulfilment context for the client's live account */
export async function loadLiveContext(clientId: string, _actor: Actor): Promise<P.FulfilmentContext> {
  const customer = await getOrCreateMarketplaceCustomer(clientId);
  const warehouse = await StockLocation.getDefaultLocation(clientId);
  const inspection = await getOrCreateInspectionLocation(clientId, warehouse);

  return {
    clientId,
    channel: DEFAULT_CHANNEL,
    customerId: customer.id,
    customerName: customer.name,
    warehouseLocationId: warehouse.id,
    warehouseName: warehouse.name,
    inspectionLocationId: inspection.id,
    inspectionName: inspection.name,
    docPrefix: "AMZ-",
    auditPrefix: AUDIT_PREFIX,
  };
}

const suffix = P.orderSuffix;
const liveInvoiceNumber = (orderNo: string) => `AMZ-INV-${suffix(orderNo)}`;
const liveAwb = (orderNo: string) => `TRK-AMZ-${suffix(orderNo)}`;
const liveRefundRef = (orderNo: string) => `AMZ-RFND-${suffix(orderNo)}`;
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function nextOrderNo(clientId: string): Promise<string> {
  const orders = await AmazonOrder.list(clientId);
  const max = orders.reduce((n, o) => {
    const m = /^AMZ-LIVE-(\d+)$/.exec(o.amazonOrderId);
    return m ? Math.max(n, Number(m[1])) : n;
  }, 1000);
  return `AMZ-LIVE-${max + 1}`;
}

async function audit(
  ctx: P.FulfilmentContext,
  actor: Actor,
  event: string,
  target: string,
  detail: Record<string, unknown> = {},
) {
  await AuditLog.writeAuditLog({
    actorId: actor.userId,
    actorEmail: actor.email,
    action: `${ctx.auditPrefix}.${event}`,
    target,
    detail: { channel: ctx.channel, live: true, ...detail },
  });
}

export const AmazonLiveWorkflowService = {
  /** Fetch the complete live workflow state for the authenticated client account */
  async getState(actor: Actor, clientId: string) {
    const ctx = await loadLiveContext(clientId, actor);
    const c = ctx.clientId;

    const [
      orders,
      mappings,
      stock,
      sos,
      invoices,
      dispatches,
      returns,
      refunds,
      notes,
      settlements,
      exceptions,
      movements,
      auditRows,
      products,
    ] = await Promise.all([
      AmazonOrder.list(c),
      SkuMapping.list(c),
      P.stockSummary(ctx).catch(() => []),
      GoodsSO.list(c),
      InvoiceRecord.list(c),
      GoodsDispatch.list(c),
      AmazonReturn.list(c),
      AmazonRefund.list(c),
      CreditDebitNote.list(c),
      MarketplaceSettlement.list(c),
      AmazonException.list(c),
      StockMovement.list(c),
      AuditLog.list({ limit: 1000 }),
      Product.list(c),
    ]);

    const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));
    const soById = byId(sos);
    const dispatchById = byId(dispatches);
    const invoiceById = byId(invoices);
    const returnByOrder = new Map(returns.map((r) => [r.amazonOrderId, r]));
    const settlementByOrder = new Map(settlements.map((s) => [s.amazonOrderId, s]));
    const newest = <T extends { createdAt: string }>(rows: T[]) =>
      [...rows].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

    // Real catalogue mapping
    const catalogue = products.map((p) => ({
      sku: p.sku,
      amazonSku: `AMZ-${p.sku}`,
      name: p.name,
      colour: p.color || "",
      size: p.size || "",
      price: p.unitPrice || p.ecommercePrice || p.mrp || 1000,
      mrp: p.mrp || p.unitPrice || 1200,
      cost: p.unitCost || 500,
      gstRate: 18,
      hsn: p.hsnCode || "6109",
    }));

    return {
      tenantId: clientId,
      isDemoData: false,
      warehouse: ctx.warehouseName,
      inspectionLocation: ctx.inspectionName,
      customer: ctx.customerName,
      defaults: {
        courier: DEFAULT_COURIER,
        address: {
          addressLine1: "123 Business Park, MG Road",
          city: "Bengaluru",
          state: "Karnataka",
          postalCode: "560001",
          country: "IN",
        },
        fees: DEFAULT_FEES,
        catalogue,
      },
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
          salesOrderNumber: so?.soNumber ?? null,
          reservation: d?.stockDebited
            ? `Converted to stock OUT (${o.quantity})`
            : reserved
              ? `Reserved ${o.quantity} in ${ctx.warehouseName}`
              : "Not reserved",
          invoiceNumber: inv?.invoiceNumber ?? null,
          invoiceRecordStatus: inv?.status ?? null,
          dispatchStatus: d ? (d.shippingStatus ?? d.status) : null,
          dispatchNumber: d?.dispatchNumber ?? null,
          returnId: returnByOrder.get(o.amazonOrderId)?.id ?? null,
          settlementId: settlementByOrder.get(o.amazonOrderId)?.id ?? null,
        };
      }),
      invoices: newest(invoices),
      dispatches: newest(dispatches),
      returns: newest(returns),
      refunds: newest(refunds),
      creditNotes: newest(notes),
      settlements: newest(settlements),
      exceptions: newest(exceptions).map((e) => ({ ...e, payload: undefined })),
      ledger: newest(movements).slice(0, 100),
      auditTrail: auditRows.filter((a) => String(a.action).startsWith(`${AUDIT_PREFIX}.`)).slice(0, 200),
    };
  },

  /** Create/Import a live Amazon Order into the client's actual workflow */
  async createOrder(input: LiveOrderInput, actor: Actor, clientId: string) {
    const ctx = await loadLiveContext(clientId, actor);
    const orderNo = input.amazonOrderId?.trim() || (await nextOrderNo(clientId));

    const orderInput: P.MarketplaceOrderInput = {
      amazonOrderId: orderNo,
      orderDate: input.orderDate || db.todayDate(),
      amazonSku: input.amazonSku || `AMZ-SKU-${orderNo}`,
      internalSku: input.internalSku ?? null,
      productName: input.productName || "Live Marketplace Item",
      colour: input.colour ?? null,
      size: input.size ?? null,
      quantity: Number(input.quantity || 1),
      sellingPrice: Number(input.sellingPrice || 1000),
      discount: Number(input.discount || 0),
      taxRate: Number(input.taxRate || 18),
      deliveryAddress: {
        addressLine1: input.deliveryAddress?.addressLine1 || "123 Customer Lane",
        addressLine2: input.deliveryAddress?.addressLine2 || null,
        city: input.deliveryAddress?.city || "Bengaluru",
        state: input.deliveryAddress?.state || "Karnataka",
        postalCode: input.deliveryAddress?.postalCode || "560001",
        country: "IN",
      },
      expectedDispatchDate: input.expectedDispatchDate || inDays(2),
      fulfilmentType: input.fulfilmentType || "EasyShip",
      shippingMethod: input.shippingMethod || "Standard",
    };

    const order = await P.importOrder(ctx, orderInput, actor);

    // If invoice is not held back, automatically record channel invoice to open the warehouse task
    if (!input.delayInvoice && order.whizunikStatus === P.ORDER_STATUS.INVOICE_PENDING) {
      return P.recordChannelInvoice(
        ctx,
        orderNo,
        {
          invoiceNumber: liveInvoiceNumber(orderNo),
          invoiceDate: db.todayDate(),
          attachmentUrl: `/amazon/live/documents/invoice/${encodeURIComponent(orderNo)}`,
        },
        actor,
      );
    }

    return order;
  },

  /** Record Amazon Invoice on live order */
  async receiveInvoice(orderNo: string, actor: Actor, clientId: string) {
    const ctx = await loadLiveContext(clientId, actor);
    return P.recordChannelInvoice(
      ctx,
      orderNo,
      {
        invoiceNumber: liveInvoiceNumber(orderNo),
        invoiceDate: db.todayDate(),
        attachmentUrl: `/amazon/live/documents/invoice/${encodeURIComponent(orderNo)}`,
      },
      actor,
    );
  },

  /** Mark live order packed */
  async markPacked(orderNo: string, actor: Actor, clientId: string) {
    const ctx = await loadLiveContext(clientId, actor);
    return P.markPacked(ctx, orderNo, actor);
  },

  /** Confirm dispatch on live order — debits physical stock and records AWB */
  async confirmDispatch(orderNo: string, actor: Actor, clientId: string, body: any = {}) {
    const ctx = await loadLiveContext(clientId, actor);
    return P.confirmDispatch(
      ctx,
      orderNo,
      {
        courier: body.courier || DEFAULT_COURIER,
        awbNumber: body.awbNumber || liveAwb(orderNo),
      },
      actor,
    );
  },

  /** Mark live order delivered */
  async markDelivered(orderNo: string, actor: Actor, clientId: string) {
    const ctx = await loadLiveContext(clientId, actor);
    return P.markDelivered(ctx, orderNo, actor);
  },

  /** Create return for live order */
  async createReturn(input: { amazonOrderId?: string; quantity?: number; reason?: string }, actor: Actor, clientId: string) {
    const ctx = await loadLiveContext(clientId, actor);
    let orderNo = input.amazonOrderId;
    const withReturn = new Set((await AmazonReturn.list(clientId)).map((r) => r.amazonOrderId));
    if (!orderNo) {
      const orders = await AmazonOrder.list(clientId);
      const shipped = orders.find((o) => o.shippedAt && !withReturn.has(o.amazonOrderId));
      if (!shipped) throw new P.PipelineError("No shipped orders available to return", "SequenceError");
      orderNo = shipped.amazonOrderId;
    }

    const order = await P.requireOrder(ctx, orderNo);
    return P.createReturn(
      ctx,
      orderNo,
      {
        quantity: Number(input.quantity || order.quantity || 1),
        reason: input.reason || "Customer return - size/fit issue",
        amazonReturnId: `AMZ-RET-${suffix(orderNo)}`,
      },
      actor,
    );
  },

  /** Create damaged return for live order */
  async createDamagedReturn(input: { amazonOrderId?: string }, actor: Actor, clientId: string) {
    const ctx = await loadLiveContext(clientId, actor);
    let orderNo = input.amazonOrderId;
    const withReturn = new Set((await AmazonReturn.list(clientId)).map((r) => r.amazonOrderId));
    if (!orderNo) {
      const orders = await AmazonOrder.list(clientId);
      const shipped = orders.find((o) => o.shippedAt && !withReturn.has(o.amazonOrderId));
      if (!shipped) throw new P.PipelineError("No shipped orders available to return", "SequenceError");
      orderNo = shipped.amazonOrderId;
    }

    const order = await P.requireOrder(ctx, orderNo);
    const ret = await P.createReturn(
      ctx,
      orderNo,
      {
        quantity: order.quantity || 1,
        reason: "Damaged in transit",
        amazonReturnId: `AMZ-RET-${suffix(orderNo)}`,
      },
      actor,
    );

    // Advance to inspection
    await P.advanceReturn(ctx, ret.id, "InTransit", actor);
    await P.advanceReturn(ctx, ret.id, "Received", actor);
    await P.advanceReturn(ctx, ret.id, "UnderInspection", actor);

    // Split damaged
    const total = ret.quantityReturned;
    const damaged = Math.max(1, Math.floor(total / 2));
    const accepted = total - damaged;
    return P.inspectReturn(
      ctx,
      ret.id,
      {
        accepted,
        damaged,
        missing: 0,
        notes: `${damaged} unit(s) damaged; ${accepted} accepted back into sellable inventory`,
      },
      actor,
    );
  },

  /** Execute a specific return action */
  async returnAction(id: string, action: string, body: any, actor: Actor, clientId: string) {
    const ctx = await loadLiveContext(clientId, actor);
    switch (action) {
      case "in_transit":
        return P.advanceReturn(ctx, id, "InTransit", actor);
      case "received":
        return P.advanceReturn(ctx, id, "Received", actor);
      case "under_inspection":
        return P.advanceReturn(ctx, id, "UnderInspection", actor);
      case "record_inspection":
        return P.inspectReturn(ctx, id, body, actor);
      case "credit_note":
        return P.createCreditNote(ctx, id, body, actor);
      case "set_disposition":
        return P.setDamagedDisposition(ctx, id, body, actor);
      case "close":
        return P.closeReturn(ctx, id, actor);
      default:
        throw new P.PipelineError(`Unknown return action: ${action}`, "Validation");
    }
  },

  /** Record refund on live return */
  async simulateRefund(input: { returnId?: string; refundReference?: string }, actor: Actor, clientId: string) {
    const ctx = await loadLiveContext(clientId, actor);
    const returns = (await AmazonReturn.list(clientId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const ret = input.returnId ? returns.find((r) => r.id === input.returnId) : returns.find((r) => !r.refundId) ?? returns[0];
    if (!ret) throw new P.PipelineError("No return to refund — create a return first", "SequenceError");

    return P.recordRefund(
      ctx,
      ret.id,
      { refundReference: input.refundReference || liveRefundRef(ret.amazonOrderId) },
      actor,
    );
  },

  /** Record live settlement */
  async simulateSettlement(input: { amazonOrderId?: string; bankShortBy?: number }, actor: Actor, clientId: string) {
    const ctx = await loadLiveContext(clientId, actor);
    const settled = new Set((await MarketplaceSettlement.list(clientId)).map((s) => s.amazonOrderId));
    const orders = await AmazonOrder.list(clientId);
    const order = input.amazonOrderId
      ? await P.requireOrder(ctx, input.amazonOrderId)
      : orders.find((o) => o.shippedAt && !settled.has(o.amazonOrderId));

    if (!order) throw new P.PipelineError("No dispatched, unsettled order found", "SequenceError");

    const s = await P.createSettlement(
      ctx,
      order.amazonOrderId,
      {
        commission: round2((P.orderValue(order) * DEFAULT_FEES.commissionPct) / 100),
        shippingFee: DEFAULT_FEES.shippingFee,
        otherDeductions: DEFAULT_FEES.otherDeductions,
        expectedDate: inDays(7),
      },
      actor,
    );

    return P.recordBankReceipt(
      ctx,
      s.id,
      {
        amount: round2(s.netSettlementExpected - (Number(input.bankShortBy) || 0)),
        bankReference: `UTR-LIVE-${suffix(order.amazonOrderId)}`,
      },
      actor,
    );
  },

  /** Record bank receipt on settlement */
  async recordBankReceipt(settlementId: string, input: { amount: number; bankReference?: string }, actor: Actor, clientId: string) {
    const ctx = await loadLiveContext(clientId, actor);
    return P.recordBankReceipt(ctx, settlementId, input, actor);
  },

  /** Reconcile live settlement */
  async reconcileSettlement(settlementId: string, actor: Actor, clientId: string) {
    const ctx = await loadLiveContext(clientId, actor);
    return P.reconcileSettlement(ctx, settlementId, actor);
  },

  /** Add physical stock to live warehouse */
  async addStock(input: { sku: string; quantity: number }, actor: Actor, clientId: string) {
    const ctx = await loadLiveContext(clientId, actor);
    const qty = Number(input.quantity);
    if (!Number.isInteger(qty) || qty < 1) throw new P.PipelineError("Quantity must be at least 1", "Validation");

    const products = await Product.list(clientId);
    let product = products.find((p) => p.sku === input.sku);

    if (!product) {
      // Auto-create product if not found in catalogue
      product = await Product.create({
        clientId,
        sku: input.sku,
        name: `Item ${input.sku}`,
        unitPrice: 1000,
        unitCost: 500,
        unitOfMeasure: "piece",
        season: "All-Season",
      });
    }

    const movement = await StockMovement.create({
      clientId,
      productId: product.id,
      direction: "in",
      itemName: product.name,
      sku: product.sku,
      quantity: qty,
      unit: product.unitOfMeasure || "piece",
      unitCost: product.unitCost,
      warehouse: ctx.warehouseName,
      reason: "Goods receipt",
      linkedDocumentType: "Purchase",
      linkedDocumentNumber: `GRN-LIVE-${Date.now().toString().slice(-6)}`,
      notes: "Stock receipt (Marketplace Live Workflow)",
    });

    await audit(ctx, actor, "stock_received", product.sku, { quantity: qty, warehouse: ctx.warehouseName });
    return { success: true, movement, sku: product.sku, quantity: qty };
  },

  /** Add live SKU Mapping */
  async addSkuMapping(input: { channelSku: string; whizunikSku: string }, actor: Actor, clientId: string) {
    const ctx = await loadLiveContext(clientId, actor);
    const mapping = await SkuMapping.create({
      clientId,
      channelSku: input.channelSku,
      listingId: `LST-${Date.now()}`,
      whizunikSku: input.whizunikSku,
      productName: input.whizunikSku,
      colour: null,
      size: null,
      variant: "Standard",
      warehouse: ctx.warehouseName,
      mrp: 1200,
      sellingPrice: 1000,
      hsn: "6203",
      gstRate: 18,
    });
    await audit(ctx, actor, "sku_mapped", input.channelSku, { whizunikSku: input.whizunikSku });
    return mapping;
  },

  /** Retry Failed Event for live order */
  async retryFailedEvent(exceptionId: string, options: { mapToSku?: string; addStock?: number }, actor: Actor, clientId: string) {
    const ctx = await loadLiveContext(clientId, actor);
    const ex = await AmazonException.get(exceptionId);
    if (!ex) throw new P.PipelineError("Exception not found", "NotFound", 404);
    if (ex.currentStatus === "Resolved" || ex.currentStatus === "Closed") {
      throw new P.PipelineError("This event is already resolved", "SequenceError", 409);
    }
    await AmazonException.incrementRetry(ex.id);
    const orderNo = ex.affectedOrder;
    if (options.mapToSku) {
      await this.addSkuMapping({ channelSku: ex.affectedItem || orderNo, whizunikSku: options.mapToSku }, actor, clientId);
    }
    if (options.addStock) {
      const order = await P.requireOrder(ctx, orderNo);
      if (order.internalSku) {
        await this.addStock({ sku: order.internalSku, quantity: options.addStock }, actor, clientId);
      }
    }
    const after = await P.processOrder(ctx, orderNo, actor);
    if (after.whizunikStatus !== P.ORDER_STATUS.SKU_MAPPING_REQUIRED && after.whizunikStatus !== P.ORDER_STATUS.AWAITING_STOCK) {
      await AmazonException.resolveException(ex.id, "Resolved on retry", actor.email);
      await audit(ctx, actor, "exception_resolved", orderNo, { reason: ex.errorReason });
    }
    return { success: true, order: after, exception: ex };
  },

  /** Generate document PDF for live order */
  async getDocument(kind: "invoice" | "packing-slip" | "settlement", orderNo: string, actor: Actor, clientId: string) {
    const ctx = await loadLiveContext(clientId, actor);
    const order = await P.requireOrder(ctx, orderNo);

    if (kind === "invoice") {
      const inv = order.invoiceRecordId ? await InvoiceRecord.get(order.invoiceRecordId) : null;
      if (!inv?.invoiceNumber) throw new P.PipelineError("No invoice generated yet", "SequenceError", 404);
      const pdf = await buildSimulatedInvoicePdf({
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceIssueDate ?? db.todayDate(),
        amazonOrderId: order.amazonOrderId,
        salesOrderNumber: order.salesOrderNumber ?? null,
        issuer: inv.issuer || "Amazon India",
        status: inv.status === "InvoiceReceived" ? "Received" : inv.status,
        productName: order.productName,
        sku: order.internalSku ?? null,
        amazonSku: order.amazonSku,
        colour: order.colour,
        size: order.size,
        quantity: order.quantity,
        sellingPrice: order.sellingPrice,
        discount: order.discount,
        taxRate: inv.taxRate || 18,
        taxableAmount: inv.taxableAmount,
        taxAmount: inv.taxAmount,
        total: inv.grandTotal,
        deliveryAddress: P.formatAddress(order.deliveryAddress),
      });
      return { filename: `${inv.invoiceNumber}.pdf`, pdf };
    }

    if (kind === "packing-slip") {
      const d = order.dispatchId ? await GoodsDispatch.get(order.dispatchId) : null;
      if (!d) throw new P.PipelineError("No warehouse dispatch note yet", "SequenceError", 404);
      const inv = order.invoiceRecordId ? await InvoiceRecord.get(order.invoiceRecordId) : null;
      const data = dispatchToPackingSlipData(d, { name: "WhizUnik Seller (Live Production)" });
      data.watermark = "AMAZON PACKING SLIP";
      data.invoiceNumber = inv?.invoiceNumber ?? null;
      data.notes = `Amazon order ${order.amazonOrderId} · ${order.fulfilmentType} · ${d.cartonCount ?? 1} package(s)`;
      return { filename: `${d.dispatchNumber}-packing-slip.pdf`, pdf: await buildPackingSlipPdf(data) };
    }

    const s = (await MarketplaceSettlement.list(clientId)).find((x) => x.amazonOrderId === orderNo);
    if (!s) throw new P.PipelineError("No settlement record found for this order", "SequenceError", 404);
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
  },
};
