import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export interface ChartOfAccount {
  pk: string; sk: string; gsi1pk: string; gsi1sk: string;
  entityType: "ChartOfAccount";
  id: string; clientId: string;
  code: string; name: string; type: string; subtype: string | null;
  description: string | null; taxRate: number; currency: string;
  status: string; isSystem: boolean; systemKey: string | null;
  createdAt: string; updatedAt: string;
}

const ACCOUNT_TYPES = ["asset","liability","equity","revenue","direct_cost","expense","other_income","other_expense"];

export async function list(clientId?: string) {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, { entityType: "ChartOfAccount" });
    return items as ChartOfAccount[];
  }
  return db.scanByType("ChartOfAccount") as Promise<ChartOfAccount[]>;
}

export async function get(id: string) { return db.getItem(`COA#${id}`) as Promise<ChartOfAccount | null>; }

export async function getBySystemKey(clientId: string, key: string) {
  const accounts = await list(clientId);
  return accounts.find((a) => a.systemKey === key) || null;
}

export async function create(data: Partial<ChartOfAccount> & { clientId: string; code: string; name: string; type: string }) {
  const id = uuid(); const now = db.nowISO();
  const item: ChartOfAccount = {
    pk: `COA#${id}`, sk: `COA#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`, gsi1sk: `ChartOfAccount#${now}`,
    entityType: "ChartOfAccount", id, clientId: data.clientId,
    code: data.code, name: data.name, type: data.type,
    subtype: data.subtype || null, description: data.description || null,
    taxRate: data.taxRate || 0, currency: data.currency || "USD",
    status: data.status || "active", isSystem: data.isSystem || false,
    systemKey: data.systemKey || null, createdAt: now, updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<ChartOfAccount>) {
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  const allowed = ["code","name","type","subtype","description","taxRate","status"];
  for (const k of allowed) { if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k]; }
  return db.updateItem(`COA#${id}`, `COA#${id}`, patch);
}

export async function remove(id: string, isSystem?: boolean) {
  if (isSystem) throw new Error("Cannot delete system accounts");
  return db.deleteItem(`COA#${id}`);
}

export async function seedDefault(clientId: string) {
  const defaults = [
    { code: "1000", name: "Bank", type: "asset", subtype: "bank", systemKey: "bank" },
    { code: "1100", name: "Accounts Receivable", type: "asset", subtype: "accounts_receivable", systemKey: "ar" },
    { code: "1200", name: "Inventory", type: "asset", subtype: "inventory", systemKey: "inventory" },
    { code: "2000", name: "Accounts Payable", type: "liability", subtype: "accounts_payable", systemKey: "ap" },
    { code: "2100", name: "Tax Payable", type: "liability", subtype: "taxes_payable", systemKey: "tax_payable" },
    { code: "3000", name: "Capital", type: "equity", subtype: "capital", systemKey: "capital" },
    { code: "4000", name: "Sales", type: "revenue", subtype: "sales", systemKey: "sales" },
    { code: "5000", name: "Cost of Goods Sold", type: "direct_cost", subtype: "cogs", systemKey: "cogs" },
    { code: "6000", name: "Operating Expenses", type: "expense", subtype: "operating", systemKey: "operating_exp" },
  ];
  for (const acct of defaults) {
    const existing = await getBySystemKey(clientId, acct.systemKey);
    if (!existing) {
      await create({ ...acct, clientId, isSystem: true });
    }
  }
}
