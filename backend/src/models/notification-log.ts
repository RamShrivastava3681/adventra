import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";
import { config } from "../config.js";

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

/** Document-scoped pointer partition (one ref per notification). */
function docPointerPk(docType: string, docId: string): string {
  return `NOTIFDOC#${docType}#${docId}`;
}

function docPointerSk(createdAt: string, id: string): string {
  return `NOTIF#${createdAt}#${id}`;
}

async function writeDocPointer(entry: NotificationEntry): Promise<void> {
  if (!entry.docType || !entry.docId) return;
  await db.putItemIfAbsent({
    pk: docPointerPk(entry.docType, entry.docId),
    sk: docPointerSk(entry.createdAt, entry.id),
    entityType: "NotificationLogRef",
    notificationId: entry.id,
  }).catch(() => undefined);
}

/** Remove a notification's doc pointer (used by party cascade deletes). */
export async function removeDocPointer(
  docType: string | null,
  docId: string | null,
  id: string,
  createdAt: string,
): Promise<void> {
  if (!docType || !docId) return;
  await db
    .deleteItem(docPointerPk(docType, docId), docPointerSk(createdAt, id))
    .catch(() => undefined);
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
  await writeDocPointer(item);
  return item;
}

export async function listForDoc(docType: string, docId: string): Promise<NotificationEntry[]> {
  const refs = await db.queryAllByPk(docPointerPk(docType, docId));
  const fromRefs = (
    await Promise.all(refs.map((ref) => db.getItem(`NOTIF#${ref.notificationId}`)))
  ).filter(Boolean) as NotificationEntry[];

  if (config.dynamodb.scanSource === "gsi2") {
    return fromRefs
      .filter((n) => n.docType === docType && n.docId === docId)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  // Transitional fallback: notifications written before the doc pointer
  // existed are still visible through the legacy bounded entity read. Once the
  // pointer backfill is verified, GSI2 mode reads pointers only.
  const legacy = (await db.scanByType("NotificationLog", { limit: 2000 })) as NotificationEntry[];
  const merged = new Map<string, NotificationEntry>();
  for (const n of legacy) {
    if (n.docType === docType && n.docId === docId) merged.set(n.id, n);
  }
  for (const n of fromRefs) {
    if (n.docType === docType && n.docId === docId) merged.set(n.id, n);
  }
  const rows = [...merged.values()];
  const alreadyPointed = new Set(fromRefs.map((n) => n.id));
  await Promise.all(
    rows.filter((n) => !alreadyPointed.has(n.id)).map(writeDocPointer),
  );
  return rows.sort((a, b) =>
    String(a.createdAt).localeCompare(String(b.createdAt)),
  );
}
