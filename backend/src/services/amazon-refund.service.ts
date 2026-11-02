import {
  create as createRefundRecord,
  update as updateRefundRecord,
  get as getRefund,
  list as listRefunds,
} from "../models/marketplace-amazon-refund.js";
import type { RefundStatus } from "../models/marketplace-amazon-refund.js";

export class AmazonRefundService {

  static async createRefund(data: {
    clientId: string;
    amazonOrderId: string;
    whizunikSalesOrderId: string | null;
    amazonRefundId: string | null;
    refundReference: string;
    amount: number;
    currency: string;
    refundStatus?: RefundStatus;
    refundDate: string | null;
    linkedReturnId: string | null;
  }) {
    // Check if a refund already exists for this order
    const existing = await listRefunds(data.clientId);
    const refundToUpdate = existing.find((r) => r.amazonOrderId === data.amazonOrderId);
    if (refundToUpdate) {
      // Update existing refund
      return await updateRefundRecord(refundToUpdate.id, {
        refundReference: data.refundReference,
        amount: data.amount,
        currency: data.currency,
        refundStatus: data.refundStatus,
        refundDate: data.refundDate,
        linkedReturnId: data.linkedReturnId,
      });
    }

    return await createRefundRecord({
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

  static async updateRefundStatus(refundId: string, status: RefundStatus, refundReference: string): Promise<any> {
    const refund = await getRefund(refundId);
    if (!refund) throw new Error("Refund not found");

    // Check if Amazon has already refunded
    const alreadyProcessed = refund.refundStatus === "Completed" || refund.refundStatus === "Refunded";
    if (alreadyProcessed) {
      return refund; // Do not issue another refund
    }

    return await updateRefundRecord(refundId, {
      refundStatus: status,
      refundReference: refundReference,
    });
  }

  static async getRefundByOrder(amazonOrderId: string, clientId: string): Promise<any | null> {
    const refunds = await listRefunds(clientId);
    return refunds.find((r) => r.amazonOrderId === amazonOrderId) || null;
  }

  static async checkExistingRefund(amazonOrderId: string, clientId: string): Promise<{
    exists: boolean;
    refundStatus: string;
    refundReference: string;
    amount: number;
  }> {
    const refund = await this.getRefundByOrder(amazonOrderId, clientId);
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
