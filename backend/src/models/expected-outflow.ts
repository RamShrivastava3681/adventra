import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export type OutflowType =
  | "SUPPLIER_PAYMENT"
  | "PLANNED_PURCHASE_COMMITMENT"
  | "SUPPLIER_ADVANCE_PAID"
  | "FREIGHT_LOGISTICS"
  | "MARKETPLACE_FEES"
  | "MARKETPLACE_ADVERTISING"
  | "SALARY"
  | "RENT"
  | "UTILITY"
  | "MARKETING"
  | "TRAVEL_REIMBURSEMENT"
  | "TAX"
  | "EMI"
  | "INSURANCE"
  | "CUSTOMER_REFUND"
  | "SUPPLIER_RETURN_COST"
  | "CAPITAL_WITHDRAWAL"
  | "CAPEX"
  | "BANK_CHARGES"
  | "SOFTWARE"
  | "WAREHOUSE"
  | "PROFESSIONAL_FEE"
  | "OTHER";

export type OutflowStatus =
  | "PLANNED"
  | "APPROVED"
  | "DUE"
  | "PARTIALLY_PAID"
  | "PAID"
  | "DEFERRED"
  | "CANCELLED";

export interface ExpectedOutflow {
  pk: string; sk: string; gsi1pk: string; gsi1sk: string;
  entityType: "ExpectedOutflow";
  id: string; clientId: string;
  type: OutflowType;
  source: string;        // e.g. "purchase_invoice", "manual", "recurring"
  sourceId: string | null;
  supplierId: string | null;
  supplierName: string | null;
  amount: number;
  expectedDate: string;
  priority: string;      // CRITICAL, HIGH, NORMAL, CAN_DEFER
  status: OutflowStatus;
  ownerId: string | null;
  ownerName: string | null;
  notes: string | null;
  supportingDocument: string | null;
  createdAt: string; updatedAt: string;
}

/** Fields that contribute to the future forecast */
export const ACTIVE_OUTFLOW_STATUSES: OutflowStatus[] = [
  "PLANNED", "APPROVED", "DUE", "PARTIALLY_PAID", "DEFERRED",
];

export async function list(clientId: string) {
  const { items } = await db.queryByGSI1(clientId, {
    entityType: "ExpectedOutflow",
    limit: 2000,
    reverse: true,
  });
  return items as ExpectedOutflow[];
}

export async function get(id: string) {
  return db.getItem(`EXPECTED_OUTFLOW#${id}`) as Promise<ExpectedOutflow | null>;
}

/** Find an existing outflow by source type + source ID (deterministic linking). */
export async function findBySource(clientId: string, source: string, sourceId: string) {
  const items = await list(clientId);
  return items.find((i) => i.source === source && i.sourceId === sourceId) ?? null;
}

export async function create(
  data: Partial<ExpectedOutflow> & { clientId: string; type: OutflowType; amount: number; expectedDate: string }
) {
  const id = uuid();
  const now = db.nowISO();
  const item: ExpectedOutflow = {
    pk: `EXPECTED_OUTFLOW#${id}`, sk: `EXPECTED_OUTFLOW#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`, gsi1sk: `ExpectedOutflow#${now}`,
    entityType: "ExpectedOutflow", id, clientId: data.clientId,
    type: data.type,
    source: data.source || "manual",
    sourceId: data.sourceId || null,
    supplierId: data.supplierId || null,
    supplierName: data.supplierName || null,
    amount: Number(data.amount) || 0,
    expectedDate: data.expectedDate,
    priority: data.priority || "NORMAL",
    status: data.status || "PLANNED",
    ownerId: data.ownerId || null,
    ownerName: data.ownerName || null,
    notes: data.notes || null,
    supportingDocument: data.supportingDocument || null,
    createdAt: now, updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<ExpectedOutflow>) {
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  const allowed = [
    "type", "source", "sourceId", "supplierId", "supplierName",
    "amount", "expectedDate", "priority", "status", "ownerId", "ownerName",
    "notes", "supportingDocument",
  ];
  for (const k of allowed) {
    if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k];
  }
  return db.updateItem(`EXPECTED_OUTFLOW#${id}`, `EXPECTED_OUTFLOW#${id}`, patch);
}

export async function remove(id: string) {
  return db.deleteItem(`EXPECTED_OUTFLOW#${id}`);
}
