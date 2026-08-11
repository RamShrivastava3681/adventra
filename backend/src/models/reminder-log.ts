import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

// ---------------------------------------------------------------------------
// ReminderLog — audit trail of every invoice reminder sent
// ---------------------------------------------------------------------------
// Each time the scheduler or the debtor-forwarding endpoint sends an email, a
// ReminderLog row is created so users can see *which* reminders were sent,
// *when*, *to whom*, and *whether they succeeded*.
// ---------------------------------------------------------------------------

export interface ReminderLog {
  pk: string; sk: string; gsi1pk: string; gsi1sk: string;
  entityType: "ReminderLog";
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  type: "sales" | "purchase";
  recipient: "admin" | "debtor";
  recipientEmail: string;
  sentAt: string;
  daysUntilDue: number;
  isOverdue: boolean;
  status: "sent" | "failed";
  counterpartyName: string;
  /** Distinguishes NOA emails from plain payment reminders (absent on legacy rows). */
  kind?: "noa" | "reminder";
}

export async function list(): Promise<ReminderLog[]> {
  return db.scanByType("ReminderLog", { limit: 2000 }) as Promise<ReminderLog[]>;
}

export async function create(data: {
  invoiceId: string;
  invoiceNumber: string;
  type: "sales" | "purchase";
  recipient: "admin" | "debtor";
  recipientEmail: string;
  daysUntilDue: number;
  isOverdue: boolean;
  status: "sent" | "failed";
  counterpartyName: string;
  /** Defaults to "reminder" — pass "noa" for Notice of Assignment emails. */
  kind?: "noa" | "reminder";
}): Promise<ReminderLog> {
  const id = uuid();
  const now = db.nowISO();
  const item: ReminderLog = {
    pk: `REMINDER_LOG#${id}`,
    sk: `REMINDER_LOG#${id}`,
    gsi1pk: "GLOBAL",
    gsi1sk: `ReminderLog#${now}`,
    entityType: "ReminderLog",
    id,
    invoiceId: data.invoiceId,
    invoiceNumber: data.invoiceNumber,
    type: data.type,
    recipient: data.recipient,
    recipientEmail: data.recipientEmail,
    sentAt: now,
    daysUntilDue: data.daysUntilDue,
    isOverdue: data.isOverdue,
    status: data.status,
    counterpartyName: data.counterpartyName,
    kind: data.kind ?? "reminder",
  };
  await db.putItem(item);
  return item;
}
