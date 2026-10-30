import { MarketplaceAmazonRefund, MarketplaceAmazonRefundModel } from "../models/marketplace-amazon-refund.js";
import { MarketplaceAmazonReturn, MarketplaceAmazonReturnModel } from "../models/marketplace-amazon-return.js";
import { MarketplaceAmazonOrder, MarketplaceAmazonOrderModel } from "../models/marketplace-amazon-order.js";

export class AmazonRefundService {

  static async createRefund(data: {
    clientId: string;
    amazonOrderId: string;
    whizunikSalesOrderId: string | null;
    amazonRefundId: string | null;
    refundReference: string;
    amount: number;
    currency: string;
    refundStatus?: "Pending" | "Processed" | "Completed" | "Failed";
    refundDate: string | null;
    linkedReturnId: string | null;
  }) {
    // Check if refund already exists for this order
    const existing = await MarketplaceAmazonRefundModel.list(data.clientId);
    const alreadyHasRefund = existing.some((r) => r.amazonOrderId === data.amazonOrderId);
    if (alreadyHasRefund) {
      // Update existing refund
      const refundToUpdate = existing.find((r) => r.amazonOrderId === data.amazonOrderId);
      if (refundToUpdate) {
        return await MarketplaceAmazonRefundModel.update(refundToUpdate.id, {
          refundReference: data.refundReference,
          amount: data.amount,
          currency: data.currency,
          refundStatus: data.refundStatus,
          refundDate: data.refundDate,
          linkedReturnId: data.linkedReturnId,
        });
      }
    }

    return await MarketplaceAmazonRefundModel.create({
      clientId: data.clientId,
      amazonOrderId: data.amazonOrderId,
      whizunikSalesOrderId: data.whizunikSalesOrderId,
      amazonRefundId: data.amazonRefundId,
      refundReference: data.refundReference,
      amount: Number(data.amount),
      currency: data.currency || "INR",
      refundStatus: data.refundStatus ?? "Pending",
      refundDate: data.refundDate ?? new Date().toISOString(),
      linkedReturnId: data.linkedReturnId,
    });
  }

  static async updateRefundStatus(refundId: string, status: string, refundReference: string): Promise<any> {
    const refund = await MarketplaceAmazonRefundModel.get(refundId);
    if (!refund) throw new Error("Refund not found");

    // Check if Amazon has already refunded
    const alreadyProcessed = refund.refundStatus === "Completed" || refund.refundStatus === "Refunded";
    if (alreadyProcessed) {
      return refund; // Do not issue another refund
    }

    return await MarketplaceAmazonRefundModel.update(refundId, {
      refundStatus: status,
      refundReference: refundReference,
    });
  }

  static async getRefundByOrder(amazonOrderId: string, clientId: string): Promise<any | null> {
    const refunds = await MarketplaceAmazonRefundModel.list(clientId);
    return refunds.find((r) => r.amazonOrderId === amazonOrderId) || null;
  }

  static async checkExistingRefund(amazonOrderId: string, clientId: string): Promise<{
    exists: boolean;
    refundStatus: string;
    refundReference: string;
    amount: number;
  }> {
    const refunds = await MarketplaceAmazonRefundModel.list(clientId);
    const refund = refunds.find((r) => r.amazonOrderId === amazonOrderId);
    if (refund) {
      return {
        exists: true,
        refundStatus: refund.refundStatus,
        refundReference: refund.refundReference,
        amount: refund.amount,
      };
    }
    return {
      exists: false,
      refundStatus: "None",
      refundReference: "",
      amount: 0,
    };
  }
}