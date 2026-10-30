import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export type InvoiceRecordStatus = "Pending" | "AwaitingAmazonInvoice" | "InvoiceReceived" | "Fulfilled" | "Cancelled";

export interface MarketplaceAmazonInvoiceRecord {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "MarketplaceAmazonInvoiceRecord";
  id: string;
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
  status: InvoiceRecordStatus;
  amazonInvoiceId: string | null; // Amazon SP-API invoice ID
  attachedAt: string | null;
  attachmentUrl: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

function key(id: string) {
  return { pk: `MARKETPLACE_AMAZON_INVOICE_RECORD#${id}`, sk: `MARKETPLACE_AMAZON_INVOICE_RECORD#${id}` };
}

export async function list(clientId?: string) {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, {
      entityType: "MarketplaceAmazonInvoiceRecord",
      limit: 500,
      reverse: true,
    });
    return items as MarketplaceAmazonInvoiceRecord[];
  }
  return db.scanByType("MarketplaceAmazonInvoiceRecord", { limit: 2000 }) as Promise<MarketplaceAmazonInvoiceRecord[]>;
}

export async function get(id: string) {
  const { pk, sk } = key(id);
  return db.getItem(pk, sk) as Promise<MarketplaceAmazonInvoiceRecord | null>;
}

export async function create(
  data: Partial<MarketplaceAmazonInvoiceRecord> & {
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
  }
) {
  const id = uuid();
  const now = db.nowISO();
  const item: MarketplaceAmazonInvoiceRecord = {
    ...key(id),
    gsi1pk: `CLIENT#${data.clientId}`,
    gsi1sk: `MarketplaceAmazonInvoiceRecord#${now}`,
    entityType: "MarketplaceAmazonInvoiceRecord",
    id,
    clientId: data.clientId,
    amazonOrderId: data.amazonOrderId,
    whizunikSalesOrderId: data.whizunikSalesOrderId,
    invoiceNumber: data.invoiceNumber ?? null,
    invoiceIssueDate: data.invoiceIssueDate ?? null,
    issuer: data.issuer || "WhizUnik",
    amount: Number(data.amount),
    grandTotal: Number(data.grandTotal),
    taxableAmount: Number(data.taxableAmount),
    taxAmount: Number(data.taxAmount),
    taxRate: Number(data.taxRate) || 0,
    currency: data.currency || "INR",
    status: data.status ?? "Pending",
    amazonInvoiceId: data.amazonInvoiceId ?? null,
    attachedAt: data.attachedAt ?? null,
    attachmentUrl: data.attachmentUrl ?? null,
    notes: data.notes ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<MarketplaceAmazonInvoiceRecord>) {
  const { pk, sk } = key(id);
  return db.updateItem(pk, sk, {
    ...updates,
    updatedAt: db.nowISO(),
  }) as Promise<MarketplaceAmazonInvoiceRecord | null>;
}

export async function findByAmazonOrderId(clientId: string, amazonOrderId: string): Promise<MarketplaceAmazonInvoiceRecord | null> {
  const items = await list(clientId);
  return items.find((i) => i.amazonOrderId === amazonOrderId) || null;
}

export async function updateStatus(id: string, status: InvoiceRecordStatus) {
  const { pk, sk } = key(id);
  return db.updateItem(pk, sk, {
    status,
    updatedAt: db.nowISO(),
  }) as Promise<MarketplaceAmazonInvoiceRecord | null>;
}