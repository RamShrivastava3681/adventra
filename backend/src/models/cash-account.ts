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

export async function list(clientId?: string) {
  const items = clientId
    ? (await db.queryByGSI1(clientId, {
        entityType: "CashAccount",
        limit: 100,
      })).items || []
    : await db.scanByType("CashAccount", { limit: 1000 });
  return (items || []).map((a: any) => {
    const accName = a.accountName || a.name || a.account_name || "Cash Account";
    const accType = a.accountType || a.type || a.account_type || "BANK";
    const currentBal = Number(a.currentBalance ?? a.balance ?? a.current_balance ?? a.amount ?? 0) || 0;
    const restricted = Number(a.restrictedBalance ?? a.restricted ?? a.restricted_balance ?? 0) || 0;
    const avail = a.availableForOperations !== undefined && !isNaN(Number(a.availableForOperations))
      ? Number(a.availableForOperations)
      : (currentBal - restricted);
    return {
      ...a,
      accountName: accName,
      accountType: accType,
      currentBalance: currentBal,
      restrictedBalance: restricted,
      availableForOperations: avail,
      status: a.status || "active",
    } as CashAccount;
  });
}

export async function get(id: string) {
  const item = await db.getItem(`CASH_ACCOUNT#${id}`) as any;
  if (!item) return null;
  const accName = item.accountName || item.name || item.account_name || "Cash Account";
  const accType = item.accountType || item.type || item.account_type || "BANK";
  const currentBal = Number(item.currentBalance ?? item.balance ?? item.current_balance ?? item.amount ?? 0) || 0;
  const restricted = Number(item.restrictedBalance ?? item.restricted ?? item.restricted_balance ?? 0) || 0;
  const avail = item.availableForOperations !== undefined && !isNaN(Number(item.availableForOperations))
    ? Number(item.availableForOperations)
    : (currentBal - restricted);
  return {
    ...item,
    accountName: accName,
    accountType: accType,
    currentBalance: currentBal,
    restrictedBalance: restricted,
    availableForOperations: avail,
    status: item.status || "active",
  } as CashAccount;
}

export async function create(
  data: any
) {
  const id = uuid();
  const now = db.nowISO();
  const accName = data.accountName || data.name || data.account_name || "Cash Account";
  const accType = data.accountType || data.type || data.account_type || "BANK";
  const currentBal = Number(data.currentBalance ?? data.balance ?? data.current_balance ?? data.amount ?? 0) || 0;
  const restricted = Number(data.restrictedBalance ?? data.restricted ?? data.restricted_balance ?? 0) || 0;
  const avail = data.availableForOperations !== undefined && !isNaN(Number(data.availableForOperations))
    ? Number(data.availableForOperations)
    : (currentBal - restricted);

  const item: CashAccount = {
    pk: `CASH_ACCOUNT#${id}`, sk: `CASH_ACCOUNT#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`, gsi1sk: `CashAccount#${now}`,
    entityType: "CashAccount", id, clientId: data.clientId,
    accountName: accName,
    accountType: accType,
    currentBalance: currentBal,
    restrictedBalance: restricted,
    availableForOperations: avail,
    balanceAsOf: now,
    lastUpdatedBy: null,
    updateSource: "manual",
    status: data.status || "active",
    createdAt: now, updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: any) {
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  if (updates.accountName || updates.name || updates.account_name) {
    patch.accountName = updates.accountName || updates.name || updates.account_name;
  }
  if (updates.accountType || updates.type || updates.account_type) {
    patch.accountType = updates.accountType || updates.type || updates.account_type;
  }
  if (updates.currentBalance !== undefined || updates.balance !== undefined || updates.current_balance !== undefined) {
    patch.currentBalance = Number(updates.currentBalance ?? updates.balance ?? updates.current_balance) || 0;
  }
  if (updates.restrictedBalance !== undefined || updates.restricted !== undefined || updates.restricted_balance !== undefined) {
    patch.restrictedBalance = Number(updates.restrictedBalance ?? updates.restricted ?? updates.restricted_balance) || 0;
  }
  if (updates.status !== undefined) patch.status = updates.status;
  if (updates.updateSource !== undefined) patch.updateSource = updates.updateSource;
  if (updates.lastUpdatedBy !== undefined) patch.lastUpdatedBy = updates.lastUpdatedBy;

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
