import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export type RecurringFrequency = "WEEKLY" | "MONTHLY" | "QUARTERLY" | "ANNUAL";

export interface RecurringExpense {
  pk: string; sk: string; gsi1pk: string; gsi1sk: string;
  entityType: "RecurringExpense";
  id: string; clientId: string;
  category: string;
  description: string | null;
  amount: number;
  frequency: RecurringFrequency;
  paymentDay: number | null;  // day of month/week for scheduling
  bankAccountId: string | null;
  ownerId: string | null;
  ownerName: string | null;
  status: string;  // active | paused | cancelled
  startDate: string;
  endDate: string | null;
  createdAt: string; updatedAt: string;
}

export async function list(clientId?: string) {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, {
      entityType: "RecurringExpense",
      limit: 500,
      reverse: true,
    });
    return items as RecurringExpense[];
  }
  return db.scanByType("RecurringExpense", { limit: 2000 }) as Promise<RecurringExpense[]>;
}

export async function get(id: string) {
  return db.getItem(`RECURRING_EXPENSE#${id}`) as Promise<RecurringExpense | null>;
}

export async function create(
  data: Partial<RecurringExpense> & { clientId: string; category: string; amount: number; frequency: RecurringFrequency }
) {
  const id = uuid();
  const now = db.nowISO();
  const item: RecurringExpense = {
    pk: `RECURRING_EXPENSE#${id}`, sk: `RECURRING_EXPENSE#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`, gsi1sk: `RecurringExpense#${now}`,
    entityType: "RecurringExpense", id, clientId: data.clientId,
    category: data.category,
    description: data.description || null,
    amount: Number(data.amount) || 0,
    frequency: data.frequency,
    paymentDay: data.paymentDay ?? null,
    bankAccountId: data.bankAccountId || null,
    ownerId: data.ownerId || null,
    ownerName: data.ownerName || null,
    status: data.status || "active",
    startDate: data.startDate || db.todayDate(),
    endDate: data.endDate || null,
    createdAt: now, updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<RecurringExpense>) {
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  const allowed = [
    "category", "description", "amount", "frequency", "paymentDay",
    "bankAccountId", "ownerId", "ownerName", "status", "startDate", "endDate",
  ];
  for (const k of allowed) {
    if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k];
  }
  return db.updateItem(`RECURRING_EXPENSE#${id}`, `RECURRING_EXPENSE#${id}`, patch);
}

export async function remove(id: string) {
  return db.deleteItem(`RECURRING_EXPENSE#${id}`);
}
