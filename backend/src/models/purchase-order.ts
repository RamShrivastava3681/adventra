import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export interface PurchaseOrder {
  pk: string; sk: string; gsi1pk: string; gsi1sk: string;
  entityType: "PurchaseOrder";
  id: string; clientId: string;
  poNumber: string; amount: number; poAmount: number | null;
  side: "sales" | "purchase";
  status: string; currency: string;
  debtorId: string | null; vendorId: string | null;
  issueDate: string; expectedDate: string | null;
  proformaNumber: string | null; proformaStatus: string;
  proformaDate: string | null;
  proformaFundedAmount: number | null; proformaFundedAt: string | null;
  proformaFundedBy: string | null; proformaFundingReference: string | null;
  proformaReviewedAt: string | null; proformaReviewedBy: string | null;
  proformaReviewComments: string | null;
  notes: string | null;
  createdAt: string; updatedAt: string;
}

export async function list(clientId: string) {
  const { items } = await db.queryByGSI1(clientId, { entityType: "PurchaseOrder", limit: 500, reverse: true });
  return items as PurchaseOrder[];
}

export async function get(id: string) { return db.getItem(`PURCHASE_ORDER#${id}`) as Promise<PurchaseOrder | null>; }

export async function create(data: Partial<PurchaseOrder> & { clientId: string; poNumber: string; side: "sales" | "purchase" }) {
  const id = uuid(); const now = db.nowISO();
  const item: PurchaseOrder = {
    pk: `PURCHASE_ORDER#${id}`, sk: `PURCHASE_ORDER#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`, gsi1sk: `PurchaseOrder#${now}`,
    entityType: "PurchaseOrder", id, clientId: data.clientId,
    poNumber: data.poNumber, amount: data.amount || 0, poAmount: data.poAmount ?? null,
    side: data.side, status: data.status || "draft", currency: data.currency || "USD",
    debtorId: data.debtorId || null, vendorId: data.vendorId || null,
    issueDate: data.issueDate || db.todayDate(), expectedDate: data.expectedDate || null,
    proformaNumber: data.proformaNumber || null,
    proformaStatus: data.proformaStatus || "draft",
    proformaDate: data.proformaDate || null,
    proformaFundedAmount: data.proformaFundedAmount ?? null, proformaFundedAt: data.proformaFundedAt || null,
    proformaFundedBy: data.proformaFundedBy || null, proformaFundingReference: data.proformaFundingReference || null,
    proformaReviewedAt: data.proformaReviewedAt || null, proformaReviewedBy: data.proformaReviewedBy || null,
    proformaReviewComments: data.proformaReviewComments || null,
    notes: data.notes || null, createdAt: now, updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<PurchaseOrder>) {
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  const allowed = ["amount","poAmount","status","side","poNumber","debtorId","vendorId","issueDate","expectedDate","currency","proformaNumber","proformaStatus","proformaDate","proformaFundedAmount","proformaFundedAt","proformaFundedBy","proformaFundingReference","proformaReviewedAt","proformaReviewedBy","proformaReviewComments","notes"];
  for (const k of allowed) { if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k]; }
  return db.updateItem(`PURCHASE_ORDER#${id}`, `PURCHASE_ORDER#${id}`, patch);
}

export async function remove(id: string) { return db.deleteItem(`PURCHASE_ORDER#${id}`); }
