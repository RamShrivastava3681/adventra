import { MarketplaceAmazonOrder, MarketplaceAmazonOrderModel } from "../models/marketplace-amazon-order.js";
import { MarketplaceAmazonSkuMapping, MarketplaceAmazonSkuMappingModel } from "../models/marketplace-amazon-sku-mapping.js";
import { MarketplaceAmazonInvoiceRecord, MarketplaceAmazonInvoiceRecordModel } from "../models/marketplace-amazon-invoice-record.js";
import { MarketplaceAmazonShipment, MarketplaceAmazonShipmentModel } from "../models/marketplace-amazon-shipment.js";
import { MarketplaceAmazonReturn, MarketplaceAmazonReturnModel } from "../models/marketplace-amazon-return.js";
import { MarketplaceAmazonRefund, MarketplaceAmazonRefundModel } from "../models/marketplace-amazon-refund.js";
import { MarketplaceAmazonSettlement, MarketplaceAmazonSettlementModel } from "../models/marketplace-amazon-settlement.js";
import { MarketplaceAmazonException, MarketplaceAmazonExceptionModel } from "../models/marketplace-amazon-exception.js";
import * as db from "../dynamodb.js";
import { MarketplaceAllocation } from "../models/marketplace-allocation.js";
import { Product } from "../models/product.js";

export class AmazonOrderImportService {

  static async importOrder(data: {
    clientId: string;
    amazonOrderId: string;
    orderDate: string;
    amazonSku: string;
    productName: string;
    colour: string | null;
    size: string | null;
    quantity: number;
    sellingPrice: number;
    discount: number;
    taxInformation: {
      taxableAmount: number;
      taxAmount: number;
      taxRate: number;
    };
    deliveryAddress: {
      addressLine1: string;
      addressLine2: string | null;
      city: string;
      state: string;
      postalCode: string;
      country: string;
    };
    shippingMethod: string;
    fulfilmentType: string;
    expectedDispatchDate: string | null;
    amazonOrderStatus: string;
    invoiceStatus: string;
  }) {
    // Check for duplicate order prevention
    const existing = await MarketplaceAmazonOrderModel.findByAmazonOrderId(data.clientId, data.amazonOrderId);
    if (existing) {
      // Update existing order if it's a new sync
      return await MarketplaceAmazonOrderModel.update(data.amazonOrderId, {
        orderDate: data.orderDate,
        amazonOrderStatus: data.amazonOrderStatus,
        invoiceStatus: data.invoiceStatus,
        updatedAt: db.nowISO(),
      });
    }

    // Map Amazon SKU to WhizUnik SKU
    const mapping = await MarketplaceAmazonSkuMappingModel.findByChannelSku(data.clientId, data.amazonSku);
    
    let whizunikSku = data.amazonSku;
    if (mapping) {
      whizunikSku = mapping.whizunikSku;
    }

    // Create the Amazon order record
    const order = await MarketplaceAmazonOrderModel.create({
      clientId: data.clientId,
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

    // If SKU is mapped, check stock reservation
    if (mapping && mapping.whizunikSku) {
      await this.reserveStock(data.clientId, whizunikSku, data.quantity, order.id);
    } else {
      // Mark order as awaiting SKU mapping
      await MarketplaceAmazonOrderModel.updateStatus(data.amazonOrderId, "AwaitingSKUMapping");
    }

    return order;
  }

  private static async reserveStock(
    clientId: string,
    whizunikSku: string,
    quantity: number,
    amazonOrderId: string
  ) {
    // Check existing marketplace allocations for this SKU
    const allocations = await db.queryByGSI1(clientId, {
      entityType: "MarketplaceAllocation",
      limit: 500,
    });

    const activeAllocations = (allocations as MarketplaceAllocation[])
      .filter((a) => a.status === "active" && a.sku === whizunikSku);

    let remaining = quantity;
    for (const allocation of activeAllocations) {
      if (remaining <= 0) break;
      const take = Math.min(allocation.reservedQuantity || 0, remaining);
      if (take <= 0) continue;
      await MarketplaceAllocationModel.update(allocation.id, {
        reservedQuantity: (Number(allocation.reservedQuantity) || 0) - take,
        consumedQuantity: (Number(allocation.consumedQuantity) || 0) + take,
      });
      remaining -= take;
    }

    if (remaining > 0) {
      // Stock shortage - mark order as awaiting stock
      await MarketplaceAmazonOrderModel.updateStatus(amazonOrderId, "AwaitingStock");
      // Generate exception
      await MarketplaceAmazonExceptionModel.create({
        clientId,
        affectedOrder: amazonOrderId,
        errorReason: "StockShortage",
        errorMessage: `Insufficient stock for SKU ${whizunikSku}. Required: ${quantity}, Available after allocation: ${remaining}`,
        affectedItem: whizunikSku,
        maxRetries: 3,
        responsibleUser: null,
      });
    }
  }

  static async processSkuMapping(clientId: string, amazonSku: string) {
    // Find or create mapping
    let mapping = await MarketplaceAmazonSkuMappingModel.findByChannelSku(clientId, amazonSku);
    
    if (!mapping) {
      // Generate exception - unmapped SKU
      await MarketplaceAmazonExceptionModel.create({
        clientId,
        affectedOrder: "",
        errorReason: "UnmappedSKU",
        errorMessage: `Amazon SKU "${amazonSku}" is not mapped to a WhizUnik SKU`,
        affectedItem: amazonSku,
        maxRetries: 3,
        responsibleUser: null,
      });
      return null;
    }

    return mapping;
  }
}

export class AmazonSkuMappingService {

  static async getMappings(clientId: string) {
    return await MarketplaceAmazonSkuMappingModel.list(clientId);
  }

  static async createMapping(data: {
    clientId: string;
    channelSku: string;
    listingId: string;
    whizunikSku: string;
    colour: string | null;
    size: string | null;
    productName: string;
    variant: string;
    warehouse: string;
    mrp: number;
    sellingPrice: number;
    hsn: string;
    gstRate: number;
    status?: "Mapped" | "Pending" | "Error";
    safetyStock?: number;
  }) {
    // Check for duplicate mapping
    const existing = await MarketplaceAmazonSkuMappingModel.findByChannelSku(data.clientId, data.channelSku);
    if (existing) {
      return await MarketplaceAmazonSkuMappingModel.update(existing.id, {
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
        status: data.status ?? "Mapped",
        safetyStock: data.safetyStock ?? 0,
      });
    }

    return await MarketplaceAmazonSkuMappingModel.create({
      clientId: data.clientId,
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
      status: data.status ?? "Pending",
      safetyStock: data.safetyStock ?? 0,
    });
  }

  static async updateMapping(id: string, updates: Partial<{
    whizunikSku: string;
    colour: string | null;
    size: string | null;
    productName: string;
    variant: string;
    warehouse: string;
    mrp: number;
    sellingPrice: number;
    hsn: string;
    gstRate: number;
    status: "Mapped" | "Pending" | "Error";
    safetyStock: number;
  }>) {
    return await MarketplaceAmazonSkuMappingModel.update(id, updates);
  }

  static async deleteMapping(id: string) {
    return await MarketplaceAmazonSkuMappingModel.remove(id);
  }
}

export class AmazonInvoiceService {

  static async createInvoiceRecord(data: {
    clientId: string;
    amazonOrderId: string;
    whizunikSalesOrderId: string;
    invoiceNumber: string | null;
    invoiceIssueDate: string | null;
    issuer: "Amazon" | "WhizUnik";
    amount: number;
    grandTotal: number;
    taxableAmount: number;
    taxAmount: number;
    taxRate: number;
    currency: string;
  }) {
    // Check for existing invoice for this order
    const existing = await MarketplaceAmazonInvoiceRecordModel.findByAmazonOrderId(data.clientId, data.amazonOrderId);
    if (existing) {
      return await MarketplaceAmazonInvoiceRecordModel.update(existing.id, {
        invoiceNumber: data.invoiceNumber,
        invoiceIssueDate: data.invoiceIssueDate,
        issuer: data.issuer,
        amount: data.amount,
        grandTotal: data.grandTotal,
        taxableAmount: data.taxableAmount,
        taxAmount: data.taxAmount,
        taxRate: data.taxRate,
        currency: data.currency,
        status: "InvoiceReceived",
      });
    }

    return await MarketplaceAmazonInvoiceRecordModel.create({
      clientId: data.clientId,
      amazonOrderId: data.amazonOrderId,
      whizunikSalesOrderId: data.whizunikSalesOrderId,
      invoiceNumber: data.invoiceNumber,
      invoiceIssueDate: data.invoiceIssueDate,
      issuer: data.issuer,
      amount: data.amount,
      grandTotal: data.grandTotal,
      taxableAmount: data.taxableAmount,
      taxAmount: data.taxAmount,
      taxRate: data.taxRate,
      currency: data.currency,
      status: "Pending",
    });
  }

  static async updateInvoiceStatus(amazonOrderId: string, status: string) {
    // Find the invoice record by searching all invoices
    const items = await MarketplaceAmazonInvoiceRecordModel.list("");
    const invoice = items.find((i) => i.amazonOrderId === amazonOrderId);
    if (invoice) {
      return await MarketplaceAmazonInvoiceRecordModel.update(invoice.id, {
        status,
      });
    }
    return null;
  }

  static async markInvoiceReceived(amazonOrderId: string, invoiceNumber: string, invoiceIssueDate: string) {
    const items = await MarketplaceAmazonInvoiceRecordModel.list("");
    const invoice = items.find((i) => i.amazonOrderId === amazonOrderId);
    if (invoice) {
      return await MarketplaceAmazonInvoiceRecordModel.update(invoice.id, {
        status: "InvoiceReceived",
        invoiceNumber,
        invoiceIssueDate,
      });
    }
    return null;
  }
}

export class AmazonFulfilmentService {

  static async createWarehouseTask(data: {
    clientId: string;
    amazonOrderId: string;
    whizunikSalesOrderId: string;
    amazonSku: string;
    colour: string | null;
    size: string | null;
    quantity: number;
    warehouseLocation: string;
    packingRequirements: string;
    dispatchDeadline: string;
    fulfilmentType: string;
  }) {
    // Check prerequisites: SKU mapping, stock reservation, invoice
    const mapping = await MarketplaceAmazonSkuMappingModel.findByChannelSku(data.clientId, data.amazonSku);
    if (!mapping) {
      throw new Error("SKU mapping not found for Amazon SKU: " + data.amazonSku);
    }

    // Check invoice status
    const order = await MarketplaceAmazonOrderModel.findByAmazonOrderId(data.clientId, data.amazonOrderId);
    if (!order) {
      throw new Error("Amazon order not found: " + data.amazonOrderId);
    }

    if (order.invoiceStatus !== "InvoiceReceived") {
      throw new Error("Invoice not received yet. Current status: " + order.invoiceStatus);
    }

    // Check stock availability
    const allocations = await db.queryByGSI1(data.clientId, {
      entityType: "MarketplaceAllocation",
      limit: 500,
    });
    const activeAllocations = (allocations as any[])
      .filter((a: any) => a.status === "active" && a.sku === mapping.whizunikSku);
    
    let totalReserved = 0;
    for (const alloc of activeAllocations) {
      totalReserved += Number(alloc.reservedQuantity) || 0;
    }

    if (totalReserved < data.quantity) {
      throw new Error(`Insufficient reserved stock. Required: ${data.quantity}, Reserved: ${totalReserved}`);
    }

    // Create warehouse task
    const task = await MarketplaceAmazonShipmentModel.create({
      clientId: data.clientId,
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
      deliveryStatus: "Pending",
    });

    // Update order status
    await MarketplaceAmazonOrderModel.updateStatus(data.amazonOrderId, "AwaitingWarehouseAction");

    return task;
  }

  static async updateDispatch(data: {
    shipmentId: string;
    awbNumber: string;
    trackingNumber: string;
    carrierName: string;
    dispatchDate: string;
  }) {
    return await MarketplaceAmazonShipmentModel.update(shipmentId, {
      awbNumber: data.awbNumber,
      trackingNumber: data.trackingNumber,
      carrierName: data.carrierName,
      dispatchDate: data.dispatchDate,
      deliveryStatus: "Dispatched",
    });
  }
}

export class AmazonReturnService {

  static async createReturn(data: {
    clientId: string;
    amazonOrderId: string;
    whizunikSalesOrderId: string;
    amazonReturnId: string | null;
    returnStatus: string | null;
    quantityReturned: number;
    quantityAccepted: number;
    quantityDamaged: number;
    quantityMissing: number;
    returnReason: string | null;
    conditionDescription: string | null;
  }) {
    // Check if return already exists
    const existing = await MarketplaceAmazonReturnModel.findByAmazonOrderId(data.clientId, data.amazonOrderId);
    if (existing) {
      return await MarketplaceAmazonReturnModel.update(existing.id, {
        returnStatus: data.returnStatus,
        quantityReturned: data.quantityReturned,
        quantityAccepted: data.quantityAccepted,
        quantityDamaged: data.quantityDamaged,
        quantityMissing: data.quantityMissing,
        returnReason: data.returnReason,
        conditionDescription: data.conditionDescription,
      });
    }

    return await MarketplaceAmazonReturnModel.create({
      clientId: data.clientId,
      amazonOrderId: data.amazonOrderId,
      whizunikSalesOrderId: data.whizunikSalesOrderId,
      amazonReturnId: data.amazonReturnId,
      returnStatus: data.returnStatus ?? "ReturnInitiated",
      quantityReturned: data.quantityReturned,
      quantityAccepted: data.quantityAccepted,
      quantityDamaged: data.quantityDamaged,
      quantityMissing: data.quantityMissing,
      returnReason: data.returnReason,
      conditionDescription: data.conditionDescription,
    });
  }

  static async updateReturnStatus(returnId: string, status: string, quantityAccepted: number, quantityDamaged: number) {
    return await MarketplaceAmazonReturnModel.update(returnId, {
      returnStatus: status,
      quantityAccepted,
      quantityDamaged,
      updatedAt: new Date().toISOString(),
    });
  }

  static async createCreditNote(returnId: string, data: {
    amazonOrderId: string;
    whizunikSalesOrderId: string;
    originalInvoiceId: string;
    acceptedQuantity: number;
    amazonRefundReference: string;
  }) {
    // Check if credit note already exists for this return
    const ret = await MarketplaceAmazonReturnModel.get(returnId);
    if (!ret) throw new Error("Return not found");

    // Check if credit note already exists
    const existingCredits = await MarketplaceAmazonRefundModel.list(ret.clientId);
    const alreadyHasCredit = existingCredits.some((r) => r.linkedReturnId === returnId);
    if (alreadyHasCredit) {
      return null; // Credit note already exists
    }

    // Create refund record
    const refund = await MarketplaceAmazonRefundModel.create({
      clientId: ret.clientId,
      amazonOrderId: ret.amazonOrderId,
      whizunikSalesOrderId: ret.whizunikSalesOrderId,
      amazonRefundId: null,
      refundReference: data.amazonRefundReference,
      amount: 0, // Will be calculated based on accepted quantity
      currency: "INR",
      refundStatus: "Pending",
      refundDate: new Date().toISOString(),
      linkedReturnId: returnId,
      linkedReturnItemId: null,
    });

    // Update return with credit note ID
    await MarketplaceAmazonReturnModel.update(returnId, {
      creditNoteId: refund.id,
    });

    return refund;
  }

  static async updateRefundStatus(refundId: string, status: string, refundReference: string) {
    return await MarketplaceAmazonRefundModel.update(refundId, {
      refundStatus: status,
      refundReference: refundReference,
    });
  }
}

export class AmazonSettlementService {

  static async createSettlement(data: {
    clientId: string;
    marketplaceName: string;
    grossSales: number;
    marketplaceFees: number;
    deductions: number;
    refundsReturns: number;
    expectedSettlementDate: string;
    settlementPeriod: string | null;
    settlementReference: string | null;
  }) {
    // Check for existing settlement with same reference
    const existing = await MarketplaceAmazonSettlementModel.findByReference(data.clientId, data.settlementReference || "");
    if (existing) {
      return await MarketplaceAmazonSettlementModel.update(existing.id, data);
    }

    return await MarketplaceAmazonSettlementModel.create({
      clientId: data.clientId,
      marketplaceName: data.marketplaceName,
      grossSales: data.grossSales,
      marketplaceFees: data.marketplaceFees,
      deductions: data.deductions,
      refundsReturns: data.refundsReturns,
      expectedSettlementDate: data.expectedSettlementDate,
      settlementPeriod: data.settlementPeriod,
      settlementReference: data.settlementReference,
      status: "EXPECTED",
    });
  }

  static async updateSettlementStatus(settlementId: string, status: string) {
    return await MarketplaceAmazonSettlementModel.update(settlementId, {
      status,
    });
  }

  static async reconcileSettlement(settlementId: string) {
    const settlement = await MarketplaceAmazonSettlementModel.get(settlementId);
    if (!settlement) throw new Error("Settlement not found");

    // Get all associated orders, invoices, dispatches, returns, refunds
    const orders = await MarketplaceAmazonOrderModel.list(settlement.clientId);
    const orderSettlements = settlement; // already have this

    // Calculate totals from associated records
    const orderItems = orders.filter((o) => o.invoiceStatus === "InvoiceReceived");
    
    // Return total refunded amounts
    const refunds = await MarketplaceAmazonRefundModel.list(settlement.clientId);
    const returnItems = await MarketplaceAmazonReturnModel.list(settlement.clientId);

    // Net settlement reconciliation
    const grossSales = orderItems.reduce((sum, o) => sum + o.sellingPrice * o.quantity, 0);
    const totalFees = orderItems.reduce((sum, o) => sum + (o.sellingPrice * o.quantity * 0.15), 0); // Amazon fee estimate
    const totalRefunds = refunds.reduce((sum, r) => sum + r.amount, 0);
    const totalReturns = returnItems.reduce((sum, r) => sum + (r.quantityAccepted * (ret.amazonSku ? 100 : 0)), 0); // Simplified

    const netSettlement = grossSales - totalFees - totalRefunds - totalReturns;

    // Update settlement with reconciled values
    return await MarketplaceAmazonSettlementModel.update(settlementId, {
      grossSales,
      deductions: totalFees,
      refundsReturns: totalRefunds,
      netSettlementExpected: netSettlement > 0 ? netSettlement : 0,
      status: "RECEIVED",
    });
  }
}