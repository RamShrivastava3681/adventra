import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export type InflowType =
  | "CUSTOMER_COLLECTION"
  | "CUSTOMER_ADVANCE_RECEIVED"
  | "MARKETPLACE_SETTLEMENT"
  | "CASH_SALE_POS"
  | "WEBSITE_PAYMENT_GATEWAY"
  | "SALES_RETURN_RECOVERY"
  | "SUPPLIER_REFUND"
  | "BANK_INTEREST_RECEIVED"
  | "LOAN_DISBURSEMENT"
  | "CAPITAL_INTRODUCED"
  | "TAX_REFUND"
  | "INSURANCE_CLAIM"
  | "ADVANCE_RECEIPT"
  | "DEPOSIT_REFUND"
  | "INTEREST_RECEIPT"
  | "LOAN_WORKING_CAPITAL"
  | "OTHER";

export type InflowStatus =
  | "EXPECTED"
  | "PROMISED"
  | "PARTIALLY_RECEIVED"
  | "RECEIVED"
  | "OVERDUE"
  | "DELAYED"
  | "DISPUTED"
  | "CANCELLED";

export interface ExpectedInflow {
  pk: string; sk: string; gsi1pk: string; gsi1sk: string;
  entityType: "ExpectedInflow";
  id: string; clientId: string;
  type: InflowType;
  source: string;        // e.g. "invoice", "manual", "marketplace"
  sourceId: string | null;
  customerId: string | null;
  customerName: string | null;
  marketplaceName: string | null;
  amount: number;
  expectedDate: string;
  confidence: number;    // 0-100
  status: InflowStatus;
  ownerId: string | null;
  ownerName: string | null;
  notes: string | null;
  supportingDocument: string | null;
  createdAt: string; updatedAt: string;
}

/** Fields that contribute to the future forecast */
export const ACTIVE_INFLOW_STATUSES: InflowStatus[] = [
  "EXPECTED", "PROMISED", "PARTIALLY_RECEIVED", "OVERDUE", "DELAYED",
];

export async function list(clientId?: string) {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, {
      entityType: "ExpectedInflow",
      limit: 2000,
      reverse: true,
    });
    return items as ExpectedInflow[];
  }
  return db.scanByType("ExpectedInflow", { limit: 2000 }) as Promise<ExpectedInflow[]>;
}

export async function get(id: string) {
  return db.getItem(`EXPECTED_INFLOW#${id}`) as Promise<ExpectedInflow | null>;
}

/** Find an existing inflow by source type + source ID (deterministic linking). */
export async function findBySource(clientId: string, source: string, sourceId: string) {
  const items = await list(clientId);
  return items.find((i) => i.source === source && i.sourceId === sourceId) ?? null;
}

export async function create(
  data: Partial<ExpectedInflow> & { clientId: string; type: InflowType; amount: number; expectedDate: string }
) {
  const id = uuid();
  const now = db.nowISO();
  const item: ExpectedInflow = {
    pk: `EXPECTED_INFLOW#${id}`, sk: `EXPECTED_INFLOW#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`, gsi1sk: `ExpectedInflow#${now}`,
    entityType: "ExpectedInflow", id, clientId: data.clientId,
    type: data.type,
    source: data.source || "manual",
    sourceId: data.sourceId || null,
    customerId: data.customerId || null,
    customerName: data.customerName || null,
    marketplaceName: data.marketplaceName || null,
    amount: Number(data.amount) || 0,
    expectedDate: data.expectedDate,
    confidence: Number(data.confidence) ?? 80,
    status: data.status || "EXPECTED",
    ownerId: data.ownerId || null,
    ownerName: data.ownerName || null,
    notes: data.notes || null,
    supportingDocument: data.supportingDocument || null,
    createdAt: now, updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<ExpectedInflow>) {
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  const allowed = [
    "type", "source", "sourceId", "customerId", "customerName", "marketplaceName",
    "amount", "expectedDate", "confidence", "status", "ownerId", "ownerName",
    "notes", "supportingDocument",
  ];
  for (const k of allowed) {
    if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k];
  }
  return db.updateItem(`EXPECTED_INFLOW#${id}`, `EXPECTED_INFLOW#${id}`, patch);
}

export async function remove(id: string) {
  return db.deleteItem(`EXPECTED_INFLOW#${id}`);
}
