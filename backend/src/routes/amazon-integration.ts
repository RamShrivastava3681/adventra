import { Router, Request, Response } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole, effectiveListScope } from "../middleware/roles.js";
import * as db from "../dynamodb.js";
import * as AuditLog from "../models/audit-log.js";

import * as AmazonOrderImport from "../services/amazon-order-import.service.js";
import * as AmazonSkuMapping from "../services/amazon-sku-mapping.service.js";
import * as AmazonInvoice from "../services/amazon-invoice.service.js";
import * as AmazonFulfilment from "../services/amazon-fulfilment.service.js";
import * as AmazonReturn from "../services/amazon-return.service.js";
import * as AmazonRefund from "../services/amazon-refund.service.js";
import * as AmazonSettlement from "../services/amazon-settlement.service.js";

const router = Router();

// View-as middleware is handled by the main router middleware
// Amazon routes inherit the view-as behavior from the parent router

// ===================== AMAZON ORDER IMPORT =====================

/**
 * POST /amazon/orders/import
 * Import Amazon order from SP-API or manual entry.
 * Automatic duplicate prevention.
 */
router.post("/amazon/orders/import", authMiddleware, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const data = req.body || {};

    const order = await AmazonOrderImportService.importOrder({
      clientId,
      amazonOrderId: data.amazonOrderId,
      orderDate: data.orderDate,
      amazonSku: data.amazonSku,
      productName: data.productName,
      colour: data.colour,
      size: data.size,
      quantity: data.quantity,
      sellingPrice: data.sellingPrice,
      discount: data.discount,
      taxInformation: data.taxInformation,
      deliveryAddress: data.deliveryAddress,
      shippingMethod: data.shippingMethod,
      fulfilmentType: data.fulfilmentType,
      expectedDispatchDate: data.expectedDispatchDate,
      amazonOrderStatus: data.amazonOrderStatus,
      invoiceStatus: data.invoiceStatus,
    });

    // Track action
    void AuditLog.writeWorkflowAction(
      { userId: req.user?.userId, email: req.user?.email, roles: req.user?.roles },
      "amazon.order_imported",
      order.id,
      { amazonOrderId: data.amazonOrderId },
      { ip: req.ip, userAgent: req.headers["user-agent"] },
    );

    res.status(201).json({
      success: true,
      order,
      message: "Amazon order imported successfully",
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /amazon/orders
 * List all Amazon orders for a client.
 */
router.get("/amazon/orders", authMiddleware, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const orders = await AmazonOrderImportService.list(clientId);
    res.json(orders);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /amazon/orders/:amazonOrderId
 * Get a specific Amazon order.
 */
router.get("/amazon/orders/:amazonOrderId", authMiddleware, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const order = await AmazonOrderImportService.get(req.params.amazonOrderId);
    if (!order) return res.status(404).json({ error: "Amazon order not found" });
    res.json(order);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /amazon/orders/:amazonOrderId/status
 * Update Amazon order status.
 */
router.put("/amazon/orders/:amazonOrderId/status", authMiddleware, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const { amazonOrderStatus, invoiceStatus } = req.body || {};
    const result = await AmazonOrderImportService.updateStatus(
      req.params.amazonOrderId,
      amazonOrderStatus,
      invoiceStatus
    );
    if (!result) return res.status(404).json({ error: "Amazon order not found" });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== SKU MAPPING =====================

/**
 * GET /amazon/sku-mappings
 * List all Amazon SKU mappings.
 */
router.get("/amazon/sku-mappings", authMiddleware, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const mappings = await AmazonSkuMappingService.getMappings(clientId);
    res.json(mappings);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /amazon/sku-mappings
 * Create or update Amazon SKU mapping.
 */
router.post("/amazon/sku-mappings", authMiddleware, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const data = req.body || {};

    const mapping = await AmazonSkuMappingService.createMapping({
      clientId,
      channelSku: data.channelSku,
      listingId: data.listingId,
      whizunikSku: data.whizunikSku,
      colour: data.colour,
      size: data.size,
      productName: data.productName,
      variant: data.variant,
      warehouse: data.warehouse,
      mrp: data.mrp,
      sellingPrice: data.sellingPrice,
      hsn: data.hsn,
      gstRate: data.gstRate,
      status: data.status,
      safetyStock: data.safetyStock,
    });

    res.status(201).json({
      success: true,
      mapping,
      message: "SKU mapping created/updated successfully",
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /amazon/sku-mappings/validate/:amazonSku
 * Validate if an Amazon SKU is mapped.
 */
router.get("/amazon/sku-mappings/validate/:amazonSku", authMiddleware, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const result = await AmazonSkuMappingService.validateSku(clientId, req.params.amazonSku);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /amazon/sku-mappings/unmapped
 * Get unmapped SKUs for a list of Amazon SKUs.
 */
router.get("/amazon/sku-mappings/unmapped", authMiddleware, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const amazonSkus = (req.query.skus as string || "").split(",").filter((s: string) => s.trim());
    const result = await AmazonSkuMappingService.getUnmappedSkus(clientId, amazonSkus);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== INVOICE MANAGEMENT =====================

/**
 * POST /amazon/invoices
 * Create Amazon invoice record.
 */
router.post("/amazon/invoices", authMiddleware, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const data = req.body || {};

    const invoice = await AmazonInvoiceService.createInvoiceRecord({
      clientId,
      amazonOrderId: data.amazonOrderId,
      whizunikSalesOrderId: data.whizunikSalesOrderId,
      invoiceNumber: data.invoiceNumber,
      invoiceIssueDate: data.invoiceIssueDate,
      issuer: data.issuer || "WhizUnik",
      amount: data.amount,
      grandTotal: data.grandTotal,
      taxableAmount: data.taxableAmount,
      taxAmount: data.taxAmount,
      taxRate: data.taxRate,
      currency: data.currency || "INR",
    });

    res.status(201).json({
      success: true,
      invoice,
      message: "Amazon invoice record created successfully",
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * PUT /amazon/invoices/:amazonOrderId/status
 * Update invoice status for an Amazon order.
 */
router.put("/amazon/invoices/status", authMiddleware, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const { amazonOrderId, status } = req.body || {};

    const result = await AmazonInvoiceService.updateInvoiceStatus(amazonOrderId, status);
    if (!result) return res.status(404).json({ error: "Invoice record not found" });

    res.json({
      success: true,
      invoice: result,
      message: "Invoice status updated successfully",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /amazon/invoices/mark-received
 * Mark invoice as received from Amazon.
 */
router.put("/amazon/invoices/mark-received", authMiddleware, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const { amazonOrderId, invoiceNumber, invoiceIssueDate } = req.body || {};

    const result = await AmazonInvoiceService.markInvoiceReceived(amazonOrderId, invoiceNumber, invoiceIssueDate);
    res.json({
      success: true,
      invoice: result,
      message: "Invoice marked as received from Amazon",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== FULFILMENT & DISPATCH =====================

/**
 * POST /amazon/fulfilment/create-task
 * Create warehouse task for Amazon order fulfilment.
 */
router.post("/amazon/fulfilment/create-task", authMiddleware, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const data = req.body || {};

    const task = await AmazonFulfilmentService.createWarehouseTask({
      clientId,
      amazonOrderId: data.amazonOrderId,
      whizunikSalesOrderId: data.whizunikSalesOrderId,
      amazonSku: data.amazonSku,
      colour: data.colour,
      size: data.size,
      quantity: data.quantity,
      warehouseLocation: data.warehouseLocation,
      packingRequirements: data.packingRequirements,
      dispatchDeadline: data.dispatchDeadline,
      fulfilmentType: data.fulfilmentType,
    });

    res.status(201).json({
      success: true,
      task,
      message: "Warehouse task created successfully",
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * PUT /amazon/fulfilment/dispatch
 * Update dispatch information for an Amazon shipment.
 */
router.put("/amazon/fulfilment/dispatch", authMiddleware, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const data = req.body || {};

    const task = await AmazonFulfilmentService.updateDispatch({
      shipmentId: data.shipmentId,
      awbNumber: data.awbNumber,
      trackingNumber: data.trackingNumber,
      carrierName: data.carrierName,
      dispatchDate: data.dispatchDate,
    });

    res.json({
      success: true,
      task,
      message: "Dispatch updated successfully",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== RETURNS MANAGEMENT =====================

/**
 * POST /amazon/returns
 * Create Amazon return record.
 */
router.post("/amazon/returns", authMiddleware, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const data = req.body || {};

    const ret = await AmazonReturnService.createReturn({
      clientId,
      amazonOrderId: data.amazonOrderId,
      whizunikSalesOrderId: data.whizunikSalesOrderId,
      amazonReturnId: data.amazonReturnId,
      returnStatus: data.returnStatus,
      quantityReturned: data.quantityReturned,
      quantityAccepted: data.quantityAccepted,
      quantityDamaged: data.quantityDamaged,
      quantityMissing: data.quantityMissing,
      returnReason: data.returnReason,
      conditionDescription: data.conditionDescription,
    });

    res.status(201).json({
      success: true,
      return: ret,
      message: "Amazon return record created successfully",
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * PUT /amazon/returns/:returnId/status
 * Update return status.
 */
router.put("/amazon/returns/:returnId/status", authMiddleware, async (req: Request, res: Response) => {
  try {
    const returnId = req.params.returnId;
    const { status, quantityAccepted, quantityDamaged } = req.body || {};

    const result = await AmazonReturnService.updateReturnStatus(returnId, status, quantityAccepted, quantityDamaged);
    res.json({
      success: true,
      return: result,
      message: "Return status updated successfully",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /amazon/returns/finalize
 * Finalize Amazon return and create credit note.
 */
router.put("/amazon/returns/finalize", authMiddleware, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const data = req.body || {};

    const result = await AmazonReturnService.finalizeReturn(data.returnId, {
      quantityAccepted: data.quantityAccepted,
      quantityDamaged: data.quantityDamaged,
      refundReference: data.refundReference,
      checkerId: data.checkerId,
      checkerName: data.checkerName,
    });

    res.json({
      success: true,
      return: result,
      message: "Return finalized successfully",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== REFUNDS =====================

/**
 * POST /amazon/refunds
 * Create Amazon refund record.
 */
router.post("/amazon/refunds", authMiddleware, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const data = req.body || {};

    const refund = await AmazonRefundService.createRefund({
      clientId,
      amazonOrderId: data.amazonOrderId,
      whizunikSalesOrderId: data.whizunikSalesOrderId,
      amazonRefundId: data.amazonRefundId,
      refundReference: data.refundReference,
      amount: data.amount,
      currency: data.currency || "INR",
      refundStatus: data.refundStatus,
      refundDate: data.refundDate,
      linkedReturnId: data.linkedReturnId,
    });

    res.status(201).json({
      success: true,
      refund,
      message: "Amazon refund record created successfully",
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * PUT /amazon/refunds/:refundId/status
 * Update refund status.
 */
router.put("/amazon/refunds/:refundId/status", authMiddleware, async (req: Request, res: Response) => {
  try {
    const refundId = req.params.refundId;
    const { status, refundReference } = req.body || {};

    const result = await AmazonRefundService.updateRefundStatus(refundId, status, refundReference);
    res.json({
      success: true,
      refund: result,
      message: "Refund status updated successfully",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /amazon/refunds/order/:amazonOrderId
 * Get refund by Amazon order ID.
 */
router.get("/amazon/refunds/order/:amazonOrderId", authMiddleware, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const result = await AmazonRefundService.getRefundByOrder(req.params.amazonOrderId, clientId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /amazon/refunds/check-existence
 * Check if refund already exists for an order.
 */
router.put("/amazon/refunds/check-existence", authMiddleware, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const { amazonOrderId } = req.body || {};

    const result = await AmazonRefundService.checkExistingRefund(amazonOrderId, clientId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== SETTLEMENT RECONCILIATION =====================

/**
 * POST /amazon/settlements
 * Create Amazon settlement record.
 */
router.post("/amazon/settlements", authMiddleware, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const data = req.body || {};

    const settlement = await AmazonSettlementService.createSettlement({
      clientId,
      marketplaceName: data.marketplaceName,
      grossSales: data.grossSales,
      marketplaceFees: data.marketplaceFees,
      deductions: data.deductions,
      refundsReturns: data.refundsReturns,
      expectedSettlementDate: data.expectedSettlementDate,
      settlementPeriod: data.settlementPeriod,
      settlementReference: data.settlementReference,
    });

    res.status(201).json({
      success: true,
      settlement,
      message: "Amazon settlement record created successfully",
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * PUT /amazon/settlements/:settlementId/status
 * Update settlement status.
 */
router.put("/amazon/settlements/:settlementId/status", authMiddleware, async (req: Request, res: Response) => {
  try {
    const settlementId = req.params.settlementId;
    const { status } = req.body || {};

    const result = await AmazonSettlementService.updateSettlementStatus(settlementId, status);
    res.json({
      success: true,
      settlement: result,
      message: "Settlement status updated successfully",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /amazon/settlements/reconcile/:settlementId
 * Reconcile Amazon settlement.
 */
router.put("/amazon/settlements/reconcile/:settlementId", authMiddleware, async (req: Request, res: Response) => {
  try {
    const settlementId = req.params.settlementId;

    const result = await AmazonSettlementService.reconcileSettlement(settlementId);
    res.json({
      success: true,
      settlement: result,
      message: "Settlement reconciled successfully",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /amazon/settlements/summary
 * Get Amazon settlement summary.
 */
router.get("/amazon/settlements/summary", authMiddleware, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const summary = await AmazonSettlementService.getSettlementSummary(clientId);
    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== EXCEPTION MANAGEMENT =====================

/**
 * GET /amazon/exceptions
 * List all Amazon exceptions.
 */
router.get("/amazon/exceptions", authMiddleware, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const exceptions = await MarketplaceAmazonExceptionModel.list(clientId);
    res.json(exceptions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /amazon/exceptions/open
 * List open Amazon exceptions.
 */
router.get("/amazon/exceptions/open", authMiddleware, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const exceptions = await MarketplaceAmazonExceptionModel.findOpenExceptions(clientId);
    res.json(exceptions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /amazon/exceptions/reason/:reason
 * List exceptions by reason.
 */
router.get("/amazon/exceptions/reason/:reason", authMiddleware, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const reason = req.params.reason as ExceptionReason;
    const exceptions = await MarketplaceAmazonExceptionModel.findByReason(clientId, reason);
    res.json(exceptions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /amazon/exceptions/:exceptionId/resolve
 * Resolve an exception.
 */
router.put("/amazon/exceptions/:exceptionId/resolve", authMiddleware, async (req: Request, res: Response) => {
  try {
    const exceptionId = req.params.exceptionId;
    const { resolutionNotes, responsibleUser } = req.body || {};

    const result = await MarketplaceAmazonExceptionModel.resolveException(
      exceptionId,
      resolutionNotes,
      responsibleUser
    );

    res.json({
      success: true,
      exception: result,
      message: "Exception resolved successfully",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /amazon/exceptions/:exceptionId/retry
 * Retry failed operation.
 */
router.put("/amazon/exceptions/:exceptionId/retry", authMiddleware, async (req: Request, res: Response) => {
  try {
    const exceptionId = req.params.exceptionId;

    const result = await MarketplaceAmazonExceptionModel.incrementRetry(exceptionId);
    res.json({
      success: true,
      exception: result,
      message: "Retry incremented successfully",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== AMAZON ORDER SYNC STATUS =====================

/**
 * GET /amazon/sync-logs
 * Get Amazon sync logs.
 */
router.get("/amazon/sync-logs", authMiddleware, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    // Return exception records as sync logs for now
    const exceptions = await MarketplaceAmazonExceptionModel.list(clientId);
    res.json(exceptions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;