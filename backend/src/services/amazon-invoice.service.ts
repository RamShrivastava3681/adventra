import {
  findByAmazonOrderId,
  create as createInvoiceRecord,
  update as updateInvoiceRecord,
  list as listInvoiceRecords,
  get as getInvoiceRecordById,
  updateStatus as updateInvoiceRecordStatus,
} from "../models/marketplace-amazon-invoice-record.js";
import type { InvoiceRecordStatus } from "../models/marketplace-amazon-invoice-record.js";

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
    const existing = await findByAmazonOrderId(data.clientId, data.amazonOrderId);
    if (existing) {
      // Update existing invoice record
      return await updateInvoiceRecord(existing.id, {
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

    // Create new invoice record
    return await createInvoiceRecord({
      clientId: data.clientId,
      amazonOrderId: data.amazonOrderId,
      whizunikSalesOrderId: data.whizunikSalesOrderId,
      invoiceNumber: data.invoiceNumber ?? null,
      invoiceIssueDate: data.invoiceIssueDate ?? null,
      issuer: data.issuer || "WhizUnik",
      amount: data.amount,
      grandTotal: data.grandTotal,
      taxableAmount: data.taxableAmount,
      taxAmount: data.taxAmount,
      taxRate: data.taxRate,
      currency: data.currency,
      status: "Pending",
    });
  }

  static async updateInvoiceStatus(amazonOrderId: string, status: InvoiceRecordStatus) {
    const invoice = await this.getInvoiceByOrder(amazonOrderId);
    if (!invoice) return null;
    return await updateInvoiceRecordStatus(invoice.id, status);
  }

  static async markInvoiceReceived(amazonOrderId: string, invoiceNumber: string, invoiceIssueDate: string) {
    const invoice = await this.getInvoiceByOrder(amazonOrderId);
    if (!invoice) return null;
    return await updateInvoiceRecord(invoice.id, {
      status: "InvoiceReceived",
      invoiceNumber,
      invoiceIssueDate,
    });
  }

  static async getInvoiceByOrder(amazonOrderId: string) {
    const items = await listInvoiceRecords();
    return items.find((i) => i.amazonOrderId === amazonOrderId) || null;
  }

  static async getInvoiceRecord(id: string) {
    return await getInvoiceRecordById(id);
  }
}
