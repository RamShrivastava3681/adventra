import { MarketplaceAmazonInvoiceRecord, MarketplaceAmazonInvoiceRecordModel } from "../models/marketplace-amazon-invoice-record.js";
import { MarketplaceAmazonOrder } from "../models/marketplace-amazon-order.js";

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
      // Update existing invoice record
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

  static async updateInvoiceStatus(amazonOrderId: string, status: string): Promise<any> {
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

  static async markInvoiceReceived(amazonOrderId: string, invoiceNumber: string, invoiceIssueDate: string): Promise<any> {
    const items = await MarketplaceAmazonInvoiceRecordModel.list("");
    const invoice = items.find((i) => i.amazonOrderId === amazonOrderId);
    if (invoice) {
      return await MarketplaceAmazonInvoiceRecordModel.update(invoice.id, {
        status: "InvoiceReceived",
        invoiceNumber,
        invoiceIssueDate,
      });
    }
    // Create new invoice record if not exists
    return await MarketplaceAmazonInvoiceRecordModel.create({
      clientId: "",
      amazonOrderId: amazonOrderId,
      whizunikSalesOrderId: "",
      invoiceNumber,
      invoiceIssueDate,
      issuer: "Amazon",
      amount: 0,
      grandTotal: 0,
      taxableAmount: 0,
      taxAmount: 0,
      taxRate: 0,
      currency: "INR",
      status: "InvoiceReceived",
    });
  }

  static async getInvoiceByOrder(amazonOrderId: string): Promise<any | null> {
    const items = await MarketplaceAmazonInvoiceRecordModel.list("");
    return items.find((i) => i.amazonOrderId === amazonOrderId) || null;
  }
}