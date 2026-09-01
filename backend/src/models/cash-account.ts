import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export type CashAccountType = "BANK" | "CASH" | "MARKETPLACE" | "FIXED_DEPOSIT" | "OTHER";

export interface CashAccount {
  pk: string; sk: string; gsi1pk: string; gsi1sk: string;
  entityType: "CashAccount";
  id: string; clientId: string;
  accountName: string;
  accountType: CashAccountType;
  currentBalance: number;
  restrictedBalance: number;
  availableForOperations: number;
  balanceAsOf: string;
  lastUpdatedBy: string | null;
  updateSource: string;
  status: string;
  createdAt: string; updatedAt: string;
}

export async function list(clientId: string) {
  const { items } = await db.queryByGSI1(clientId, {
    entityType: "CashAccount",
    limit: 100,
  });
  return items as CashAccount[];
}

export async function get(id: string) {
  return db.getItem(`CASH_ACCOUNT#${id}`) as Promise<CashAccount | null>;
}

export async function create(
  data: Partial<CashAccount> & { clientId: string; accountName: string; accountType: CashAccountType; currentBalance: number }
) {
  const id = uuid();
  const now = db.nowISO();
  const currentBal = Number(data.currentBalance) || 0;
  const restricted = Number(data.restrictedBalance) || 0;
  const item: CashAccount = {
    pk: `CASH_ACCOUNT#${id}`, sk: `CASH_ACCOUNT#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`, gsi1sk: `CashAccount#${now}`,
    entityType: "CashAccount", id, clientId: data.clientId,
    accountName: data.accountName,
    accountType: data.accountType,
    currentBalance: currentBal,
    restrictedBalance: restricted,
    availableForOperations: currentBal - restricted,
    balanceAsOf: now,
    lastUpdatedBy: null,
    updateSource: "manual",
    status: data.status || "active",
    createdAt: now, updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<CashAccount>) {
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  const allowed = ["accountName", "accountType", "currentBalance", "restrictedBalance", "status", "updateSource", "lastUpdatedBy"];
  for (const k of allowed) {
    if ((updates as any)[k] !== undefined) {
      if (k === "currentBalance" || k === "restrictedBalance") {
        patch[k] = Number((updates as any)[k]) || 0;
      } else {
        patch[k] = (updates as any)[k];
      }
    }
  }
  // Recompute available balance if balance or restricted changed
  if (patch.currentBalance !== undefined || patch.restrictedBalance !== undefined) {
    const current = await get(id);
    const bal = patch.currentBalance !== undefined ? Number(patch.currentBalance) : (Number(current?.currentBalance) || 0);
    const restricted = patch.restrictedBalance !== undefined ? Number(patch.restrictedBalance) : (Number(current?.restrictedBalance) || 0);
    patch.availableForOperations = bal - restricted;
    patch.balanceAsOf = db.nowISO();
  }
  return db.updateItem(`CASH_ACCOUNT#${id}`, `CASH_ACCOUNT#${id}`, patch);
}

export async function remove(id: string) {
  return db.deleteItem(`CASH_ACCOUNT#${id}`);
}

/** Sum of available-for-operations across all active cash accounts for a client. */
export async function totalAvailableCash(clientId: string): Promise<number> {
  const accounts = await list(clientId);
  return accounts
    .filter((a) => !a.status || a.status.toLowerCase() === "active")
    .reduce((sum, a) => {
      const avail = a.availableForOperations !== undefined && !isNaN(Number(a.availableForOperations))
        ? Number(a.availableForOperations)
        : ((Number(a.currentBalance) || 0) - (Number(a.restrictedBalance) || 0));
      return sum + avail;
    }, 0);
}
