import { MarketplaceAmazonSettlement, MarketplaceAmazonSettlementModel } from "../models/marketplace-amazon-settlement.js";
import { MarketplaceAmazonOrder, MarketplaceAmazonOrderModel } from "../models/marketplace-amazon-order.js";
import { MarketplaceAmazonInvoiceRecord, MarketplaceAmazonInvoiceRecordModel } from "../models/marketplace-amazon-invoice-record.js";
import { MarketplaceAmazonReturn, MarketplaceAmazonReturnModel } from "../models/marketplace-amazon-return.js";
import { MarketplaceAmazonRefund, MarketplaceAmazonRefundModel } from "../models/marketplace-amazon-refund.js";

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

    const item = await MarketplaceAmazonSettlementModel.create({
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

    return item;
  }

  static async updateSettlementStatus(settlementId: string, status: string): Promise<any> {
    return await MarketplaceAmazonSettlementModel.update(settlementId, {
      status,
    });
  }

  static async reconcileSettlement(settlementId: string): Promise<any> {
    const settlement = await MarketplaceAmazonSettlementModel.get(settlementId);
    if (!settlement) throw new Error("Settlement not found");

    // Get all associated records
    const orders = await MarketplaceAmazonOrderModel.list(settlement.clientId);
    const invoices = await MarketplaceAmazonInvoiceRecordModel.list(settlement.clientId);
    const refunds = await MarketplaceAmazonRefundModel.list(settlement.clientId);
    const returns = await MarketplaceAmazonReturnModel.list(settlement.clientId);

    // Calculate reconciliation totals
    // Gross sales from orders with invoice received
    const orderItems = orders.filter((o) => o.invoiceStatus === "InvoiceReceived");
    const grossSales = orderItems.reduce((sum, o) => sum + o.sellingPrice * o.quantity, 0);

    // Marketplace fees (estimated 15% for Amazon)
    const marketplaceFees = orderItems.reduce((sum, o) => sum + (o.sellingPrice * o.quantity * 0.15), 0);

    // Deductions (TCS, other)
    const deductions = invoices.reduce((sum, i) => sum + i.taxAmount, 0);

    // Refunds and returns
    const totalRefunds = refunds.reduce((sum, r) => sum + r.amount, 0);
    const totalReturns = returns.reduce((sum, r) => sum + r.quantityAccepted * (settlement.grossSales / orders.length || 0), 0);

    const netSettlement = grossSales - marketplaceFees - deductions - totalRefunds - totalReturns;

    // Update settlement with reconciled values
    return await MarketplaceAmazonSettlementModel.update(settlementId, {
      grossSales,
      marketplaceFees,
      deductions,
      refundsReturns: totalRefunds,
      netSettlementExpected: netSettlement > 0 ? netSettlement : 0,
      actualSettlementDate: new Date().toISOString(),
      status: "RECEIVED",
    });
  }

  static async getSettlementSummary(clientId: string) {
    const settlements = await MarketplaceAmazonSettlementModel.list(clientId);
    const orders = await MarketplaceAmazonOrderModel.list(clientId);
    const invoices = await MarketplaceAmazonInvoiceRecordModel.list(clientId);
    const refunds = await MarketplaceAmazonRefundModel.list(clientId);
    const returns = await MarketplaceAmazonReturnModel.list(clientId);

    const totalGross = settlements.reduce((sum, s) => sum + s.grossSales, 0);
    const totalFees = settlements.reduce((sum, s) => sum + s.marketplaceFees, 0);
    const totalDeductions = settlements.reduce((sum, s) => sum + s.deductions, 0);
    const totalRefunds = settlements.reduce((sum, s) => sum + s.refundsReturns, 0);
    const totalNet = settlements.reduce((sum, s) => sum + s.netSettlementExpected, 0);

    const receivedCount = settlements.filter((s) => s.status === "RECEIVED").length;
    const expectedCount = settlements.filter((s) => s.status === "EXPECTED").length;

    return {
      totalGross,
      totalFees,
      totalDeductions,
      totalRefunds,
      totalNet,
      settlementCount: settlements.length,
      receivedCount,
      expectedCount,
      orderCount: orders.length,
      invoiceCount: invoices.length,
      refundCount: refunds.length,
      returnCount: returns.length,
    };
  }
}