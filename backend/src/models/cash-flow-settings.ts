import * as db from "../dynamodb.js";

export interface CashFlowSettings {
  pk: string; sk: string; gsi1pk: string; gsi1sk: string;
  entityType: "CashFlowSettings";
  clientId: string;
  minimumCashBuffer: number;
  baseCurrency: string;
  createdAt: string; updatedAt: string;
}

/** Get or create default settings for a client. */
export async function get(clientId: string): Promise<CashFlowSettings> {
  const key = `CASHFLOW_SETTINGS#${clientId}`;
  const item = await db.getItem(key, key) as CashFlowSettings | null;
  if (item) return item;
  // Seed defaults
  const now = db.nowISO();
  const defaults: CashFlowSettings = {
    pk: key, sk: key,
    gsi1pk: `CLIENT#${clientId}`, gsi1sk: `CashFlowSettings#${now}`,
    entityType: "CashFlowSettings",
    clientId,
    minimumCashBuffer: 100000, // ₹1,00,000 default
    baseCurrency: "INR",
    createdAt: now, updatedAt: now,
  };
  await db.putItem(defaults);
  return defaults;
}

export async function update(clientId: string, updates: Partial<CashFlowSettings>) {
  const current = await get(clientId);
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  const allowed = ["minimumCashBuffer", "baseCurrency"];
  for (const k of allowed) {
    if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k];
  }
  return db.updateItem(current.pk, current.sk, patch);
}
