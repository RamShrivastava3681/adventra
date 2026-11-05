import {
  findByAmazonOrderId,
  create as createReturnRecord,
  update as updateReturnRecord,
  get as getReturn,
  list as listReturns,
} from "../models/marketplace-amazon-return.js";
import type { ReturnStatus } from "../models/marketplace-amazon-return.js";
import {
  create as createRefundRecord,
  update as updateRefundRecord,
  list as listRefunds,
} from "../models/marketplace-amazon-refund.js";

export class AmazonReturnService {

  static async listReturns(clientId: string) {
    return await listReturns(clientId);
  }

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
    // Check if return already exists for this order
    const existing = await findByAmazonOrderId(data.clientId, data.amazonOrderId);
    if (existing) {
      return await updateReturnRecord(existing.id, {
        returnStatus: (data.returnStatus ?? existing.returnStatus) as ReturnStatus,
        quantityReturned: data.quantityReturned,
        quantityAccepted: data.quantityAccepted,
        quantityDamaged: data.quantityDamaged,
        quantityMissing: data.quantityMissing,
        returnReason: data.returnReason,
        conditionDescription: data.conditionDescription,
      });
    }

    return await createReturnRecord({
      clientId: data.clientId,
      amazonOrderId: data.amazonOrderId,
      whizunikSalesOrderId: data.whizunikSalesOrderId,
      amazonReturnId: data.amazonReturnId,
      returnStatus: (data.returnStatus ?? "ReturnInitiated") as ReturnStatus,
      quantityReturned: data.quantityReturned,
      quantityAccepted: data.quantityAccepted,
      quantityDamaged: data.quantityDamaged,
      quantityMissing: data.quantityMissing,
      returnReason: data.returnReason,
      conditionDescription: data.conditionDescription,
    });
  }

  static async updateReturnStatus(returnId: string, status: ReturnStatus, quantityAccepted: number, quantityDamaged: number): Promise<any> {
    const ret = await getReturn(returnId);
    if (!ret) throw new Error("Return not found");

    // Update return status
    const updated = await updateReturnRecord(returnId, {
      returnStatus: status,
      quantityAccepted,
      quantityDamaged,
    });

    // If return is accepted and credit note should be created
    if (status === "Accepted" && quantityAccepted > 0) {
      // Check if credit note already exists
      const alreadyHasCredit = (await listRefunds(ret.clientId)).some(
        (r) => r.linkedReturnId === returnId
      );
      if (!alreadyHasCredit) {
        // Create credit note (refund record)
        const refund = await createRefundRecord({
          clientId: ret.clientId,
          amazonOrderId: ret.amazonOrderId,
          whizunikSalesOrderId: ret.whizunikSalesOrderId,
          amazonRefundId: null,
          refundReference: `CRT-${returnId}-${Date.now()}`,
          amount: 0, // Will be calculated based on accepted quantity
          currency: "INR",
          refundStatus: "Pending",
          refundDate: new Date().toISOString(),
          linkedReturnId: returnId,
          linkedReturnItemId: null,
        });

        // Update return with credit note ID
        await updateReturnRecord(returnId, {
          creditNoteId: refund.id,
        });

        return { return: updated, refund };
      }
    }

    return { return: updated };
  }

  static async finalizeReturn(returnId: string, data: {
    quantityAccepted: number;
    quantityDamaged: number;
    refundReference: string;
    checkerId: string;
    checkerName: string;
  }) {
    const ret = await getReturn(returnId);
    if (!ret) throw new Error("Return not found");

    // Update return with final quantities
    const updated = await updateReturnRecord(returnId, {
      quantityAccepted: data.quantityAccepted,
      quantityDamaged: data.quantityDamaged,
      returnStatus: data.quantityDamaged > 0 ? "PartiallyAccepted" : "Accepted",
      checkerId: data.checkerId,
      checkerName: data.checkerName,
      checkerApprovedAt: new Date().toISOString(),
    });

    // If there are damaged goods, they should not enter available stock
    // Update refund status
    if (data.refundReference) {
      const refunds = await listRefunds(ret.clientId);
      const associatedRefund = refunds.find((r) => r.linkedReturnId === returnId);
      if (associatedRefund) {
        await updateRefundRecord(associatedRefund.id, {
          refundStatus: "Processed",
          refundReference: data.refundReference,
        });
      }
    }

    return updated;
  }
}
