import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

/**
 * NotificationLog — delivery record for workflow emails (PDF-3 §6, §9).
 * Every assignment / approval / rejection / overdue email is logged with
 * recipient + sent status so the audit trail can prove notification.
 */

export interface NotificationEntry {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "NotificationLog";
  id: string;
  clientId: string;
  kind: "assignment" | "approval" | "rejection" | "overdue" | "mention" | "info";
  taskId: string | null;
  docType: string | null;
  docId: string | null;
  docNumber: string | null;
  recipients: string[];
  subject: string;
  sent: boolean;
  error: string | null;
  createdAt: string;
}

export async function log(entry: Omit<NotificationEntry, "pk" | "sk" | "gsi1pk" | "gsi1sk" | "entityType" | "id" | "createdAt">): Promise<NotificationEntry> {
  const id = uuid();
  const now = db.nowISO();
  const item: NotificationEntry = {
    pk: `NOTIF#${id}`,
    sk: `NOTIF#${id}`,
    gsi1pk: `CLIENT#${entry.clientId}`,
    gsi1sk: `NotificationLog#${now}`,
    entityType: "NotificationLog",
    id,
    ...entry,
    createdAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function listForDoc(docType: string, docId: string): Promise<NotificationEntry[]> {
  const items = await db.scanByType("NotificationLog", { limit: 2000 });
  return (items as NotificationEntry[])
    .filter((n) => n.docType === docType && n.docId === docId)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}
