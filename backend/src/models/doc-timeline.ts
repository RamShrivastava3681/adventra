import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

/**
 * DocTimeline — per-document activity timeline (PDF-3 §2).
 * User updates (note / attachment / reason / UTR proof / mention / revised
 * date) and automatic system updates share one view, keyed by document.
 * Entries are append-only; moving teams never loses earlier updates.
 */

export type TimelineKind =
  | "note"
  | "attachment"
  | "rejection"
  | "payment_proof"
  | "delivery_note"
  | "supplier_invoice"
  | "mention"
  | "revised_date"
  | "status_change"
  | "assignment"
  | "system";

export interface TimelineEntry {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "DocTimeline";
  id: string;
  clientId: string;
  docType: string;
  docId: string;
  docNumber: string | null;
  kind: TimelineKind;
  actorId: string | null;
  actorEmail: string | null;
  actorRoles: string[];
  text: string | null;
  attachment: { name: string; url: string } | null;
  prevStatus: string | null;
  newStatus: string | null;
  mentionedUser: string | null;
  createdAt: string;
}

export async function listForDoc(docType: string, docId: string): Promise<TimelineEntry[]> {
  const items = await db.scanByType("DocTimeline", { limit: 2000 });
  return (items as TimelineEntry[])
    .filter((e) => e.docType === docType && e.docId === docId)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export async function addEntry(data: {
  clientId: string;
  docType: string;
  docId: string;
  docNumber?: string | null;
  kind: TimelineKind;
  actorId?: string | null;
  actorEmail?: string | null;
  actorRoles?: string[];
  text?: string | null;
  attachment?: TimelineEntry["attachment"];
  prevStatus?: string | null;
  newStatus?: string | null;
  mentionedUser?: string | null;
}): Promise<TimelineEntry> {
  const id = uuid();
  const now = db.nowISO();
  const item: TimelineEntry = {
    pk: `TIMELINE#${data.docType}#${data.docId}`,
    sk: `ENTRY#${now}#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`,
    gsi1sk: `DocTimeline#${now}`,
    entityType: "DocTimeline",
    id,
    clientId: data.clientId,
    docType: data.docType,
    docId: data.docId,
    docNumber: data.docNumber ?? null,
    kind: data.kind,
    actorId: data.actorId ?? null,
    actorEmail: data.actorEmail ?? null,
    actorRoles: data.actorRoles ?? [],
    text: data.text ?? null,
    attachment: data.attachment ?? null,
    prevStatus: data.prevStatus ?? null,
    newStatus: data.newStatus ?? null,
    mentionedUser: data.mentionedUser ?? null,
    createdAt: now,
  };
  await db.putItem(item);
  return item;
}
