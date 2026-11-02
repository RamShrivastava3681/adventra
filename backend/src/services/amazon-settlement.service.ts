import {
  findByReference,
  create as createSettlementRecord,
  update as updateSettlementRecord,
  get as getSettlement,
  list as listSettlements,
} from "../models/marketplace-amazon-settlement.js";
import { list as listOrders } from "../models/marketplace-amazon-order.js";
import { list as listInvoices } from "../models/marketplace-amazon-invoice-record.js";
import { list as listRefunds } from "../models/marketplace-amazon-refund.js";
import { list as listReturns } from "../models/marketplace-amazon-return.js";

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
    if (data.settlementReference) {
      const existing = await findByReference(data.clientId, data.settlementReference);
      if (existing) {
        return await updateSettlementRecord(existing.id, data);
      }
    }

    const item = await createSettlementRecord({
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
    return await updateSettlementRecord(settlementId, {
      status: status as any,
    });
  }

  static async reconcileSettlement(settlementId: string): Promise<any> {
    const settlement = await getSettlement(settlementId);
    if (!settlement) throw new Error("Settlement not found");

    // Get all associated records
    const orders = await listOrders(settlement.clientId);
    const invoices = await listInvoices(settlement.clientId);
    const refunds = await listRefunds(settlement.clientId);
    const returns = await listReturns(settlement.clientId);

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
    const unitsSold = orderItems.reduce((sum, o) => sum + o.quantity, 0);
    const averageUnitPrice = unitsSold > 0 ? grossSales / unitsSold : 0;
    const totalReturns = returns.reduce((sum, r) => sum + r.quantityAccepted * averageUnitPrice, 0);

    const netSettlement = grossSales - marketplaceFees - deductions - totalRefunds - totalReturns;

    // Update settlement with reconciled values
    return await updateSettlementRecord(settlementId, {
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
    const settlements = await listSettlements(clientId);
    const orders = await listOrders(clientId);
    const invoices = await listInvoices(clientId);
    const refunds = await listRefunds(clientId);
    const returns = await listReturns(clientId);

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
