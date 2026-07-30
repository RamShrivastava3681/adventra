import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export interface Alert {
  pk: string; sk: string;
  entityType: "Alert";
  id: string; clientId: string | null; debtorId: string | null; invoiceId: string | null;
  type: string; severity: string; message: string; isRead: boolean;
  createdAt: string;
}

export async function list() {
  return db.scanByType("Alert", { limit: 500 }) as Promise<Alert[]>;
}

export async function create(data: Partial<Alert> & { message: string; type: string }) {
  const id = uuid(); const now = db.nowISO();
  const item: Alert = {
    pk: `ALERT#${id}`, sk: `ALERT#${id}`,
    entityType: "Alert", id,
    clientId: data.clientId || null, debtorId: data.debtorId || null, invoiceId: data.invoiceId || null,
    type: data.type, severity: data.severity || "info",
    message: data.message, isRead: false,
    createdAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function markRead(id: string) {
  return db.updateItem(`ALERT#${id}`, `ALERT#${id}`, { isRead: true });
}

export async function createBatch(alerts: (Partial<Alert> & { message: string; type: string })[]) {
  for (const a of alerts) await create(a);
}

export async function remove(id: string) { return db.deleteItem(`ALERT#${id}`); }
