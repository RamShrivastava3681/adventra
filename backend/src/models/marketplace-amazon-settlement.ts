import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export type SettlementStatus = "EXPECTED" | "RECEIVED" | "DELAYED" | "DISPUTED";

export interface MarketplaceAmazonSettlement {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "MarketplaceAmazonSettlement";
  id: string;
  clientId: string;
  marketplaceName: string;
  settlementReference: string | null;
  settlementPeriod: string | null;
  grossSales: number;
  marketplaceFees: number;
  deductions: number;
  refundsReturns: number;
  netSettlementExpected: number;
  expectedSettlementDate: string;
  actualSettlementDate: string | null;
  status: SettlementStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

function key(id: string) {
  return { pk: `MARKETPLACE_AMAZON_SETTLEMENT#${id}`, sk: `MARKETPLACE_AMAZON_SETTLEMENT#${id}` };
}

export async function list(clientId?: string) {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, {
      entityType: "MarketplaceAmazonSettlement",
      limit: 500,
      reverse: true,
    });
    return items as MarketplaceAmazonSettlement[];
  }
  return db.scanByType("MarketplaceAmazonSettlement", { limit: 2000 }) as Promise<MarketplaceAmazonSettlement[]>;
}

export async function get(id: string) {
  const { pk, sk } = key(id);
  return db.getItem(pk, sk) as Promise<MarketplaceAmazonSettlement | null>;
}

export async function create(
  data: Partial<MarketplaceAmazonSettlement> & {
    clientId: string;
    marketplaceName: string;
    grossSales: number;
    expectedSettlementDate: string;
  }
) {
  const id = uuid();
  const now = db.nowISO();
  const fees = Number(data.marketplaceFees) || 0;
  const deductions = Number(data.deductions) || 0;
  const refunds = Number(data.refundsReturns) || 0;
  const gross = Number(data.grossSales) || 0;
  const net = gross - fees - deductions - refunds;
  const item: MarketplaceAmazonSettlement = {
    pk: `MARKETPLACE_AMAZON_SETTLEMENT#${id}`, sk: `MARKETPLACE_AMAZON_SETTLEMENT#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`, gsi1sk: `MarketplaceAmazonSettlement#${now}`,
    entityType: "MarketplaceAmazonSettlement", id, clientId: data.clientId,
    marketplaceName: data.marketplaceName,
    settlementReference: data.settlementReference || null,
    settlementPeriod: data.settlementPeriod || null,
    grossSales: gross,
    marketplaceFees: fees,
    deductions,
    refundsReturns: refunds,
    netSettlementExpected: Math.max(0, net),
    expectedSettlementDate: data.expectedSettlementDate,
    actualSettlementDate: data.actualSettlementDate || null,
    status: data.status || "EXPECTED",
    notes: data.notes || null,
    createdAt: now, updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<MarketplaceAmazonSettlement>) {
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  const allowed = [
    "marketplaceName", "settlementReference", "settlementPeriod",
    "grossSales", "marketplaceFees", "deductions", "refundsReturns",
    "netSettlementExpected", "expectedSettlementDate", "actualSettlementDate",
    "status", "notes",
  ];
  for (const k of allowed) {
    if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k];
  }
  // Recompute net if any component changed
  if (patch.grossSales !== undefined || patch.marketplaceFees !== undefined ||
      patch.deductions !== undefined || patch.refundsReturns !== undefined) {
    const current = await get(id);
    const gross = Number(patch.grossSales ?? current?.grossSales) || 0;
    const fees = Number(patch.marketplaceFees ?? current?.marketplaceFees) || 0;
    const ded = Number(patch.deductions ?? current?.deductions) || 0;
    const ref = Number(patch.refundsReturns ?? current?.refundsReturns) || 0;
    patch.netSettlementExpected = Math.max(0, gross - fees - ded - ref);
  }
  return db.updateItem(`MARKETPLACE_AMAZON_SETTLEMENT#${id}`, `MARKETPLACE_AMAZON_SETTLEMENT#${id}`, patch);
}

export async function remove(id: string) {
  return db.deleteItem(`MARKETPLACE_AMAZON_SETTLEMENT#${id}`);
}

export async function findByReference(clientId: string, reference: string): Promise<MarketplaceAmazonSettlement | null> {
  const items = await list(clientId);
  return items.find((s) => s.settlementReference === reference) || null;
}