import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export interface PurchaseCommitment {
  pk: string; sk: string; gsi1pk: string; gsi1sk: string;
  entityType: "PurchaseCommitment";
  id: string; clientId: string;
  linkedPO: string | null;
  linkedSupplierProforma: string | null;
  supplierId: string | null;
  supplierName: string | null;
  expectedPaymentAmount: number;
  expectedPaymentDate: string;
  advancePaymentRequired: boolean;
  criticalStockDependency: boolean;
  status: string;  // PLANNED | APPROVED | DEFERRED | CANCELLED
  ownerId: string | null;
  ownerName: string | null;
  notes: string | null;
  createdAt: string; updatedAt: string;
}

export async function list(clientId: string) {
  const { items } = await db.queryByGSI1(clientId, {
    entityType: "PurchaseCommitment",
    limit: 1000,
    reverse: true,
  });
  return items as PurchaseCommitment[];
}

export async function get(id: string) {
  return db.getItem(`PURCHASE_COMMITMENT#${id}`) as Promise<PurchaseCommitment | null>;
}

export async function create(
  data: Partial<PurchaseCommitment> & { clientId: string; expectedPaymentAmount: number; expectedPaymentDate: string }
) {
  const id = uuid();
  const now = db.nowISO();
  const item: PurchaseCommitment = {
    pk: `PURCHASE_COMMITMENT#${id}`, sk: `PURCHASE_COMMITMENT#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`, gsi1sk: `PurchaseCommitment#${now}`,
    entityType: "PurchaseCommitment", id, clientId: data.clientId,
    linkedPO: data.linkedPO || null,
    linkedSupplierProforma: data.linkedSupplierProforma || null,
    supplierId: data.supplierId || null,
    supplierName: data.supplierName || null,
    expectedPaymentAmount: Number(data.expectedPaymentAmount) || 0,
    expectedPaymentDate: data.expectedPaymentDate,
    advancePaymentRequired: data.advancePaymentRequired || false,
    criticalStockDependency: data.criticalStockDependency || false,
    status: data.status || "PLANNED",
    ownerId: data.ownerId || null,
    ownerName: data.ownerName || null,
    notes: data.notes || null,
    createdAt: now, updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<PurchaseCommitment>) {
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  const allowed = [
    "linkedPO", "linkedSupplierProforma", "supplierId", "supplierName",
    "expectedPaymentAmount", "expectedPaymentDate", "advancePaymentRequired",
    "criticalStockDependency", "status", "ownerId", "ownerName", "notes",
  ];
  for (const k of allowed) {
    if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k];
  }
  return db.updateItem(`PURCHASE_COMMITMENT#${id}`, `PURCHASE_COMMITMENT#${id}`, patch);
}

export async function remove(id: string) {
  return db.deleteItem(`PURCHASE_COMMITMENT#${id}`);
}
