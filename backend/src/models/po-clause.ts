import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

/**
 * POClause — a reusable purchase-order clause text (packaging, delivery
 * time, partial shipment, delivery standard, notification, cancellation,
 * delay, other, delivery terms).
 *
 * Saved automatically the first time a buyer types a value in the PO form;
 * later POs pick it from a dropdown instead of retyping it.
 */

export type POClauseKind =
  | "packaging"
  | "delivery_time"
  | "partial_ship"
  | "delivery_standard"
  | "notification"
  | "cancellation"
  | "delay"
  | "other"
  | "delivery_terms";

export const PO_CLAUSE_KINDS: POClauseKind[] = [
  "packaging",
  "delivery_time",
  "partial_ship",
  "delivery_standard",
  "notification",
  "cancellation",
  "delay",
  "other",
  "delivery_terms",
];

export interface POClause {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "POClause";
  id: string;
  clientId: string;
  kind: POClauseKind;
  value: string;
  /** How often this text has been reused (most-used sorts first). */
  useCount: number;
  createdAt: string;
  updatedAt: string;
}

export function isPOClauseKind(v: unknown): v is POClauseKind {
  return typeof v === "string" && (PO_CLAUSE_KINDS as readonly string[]).includes(v);
}

export async function list(clientId: string | undefined, kind?: POClauseKind) {
  const items = clientId
    ? await db.queryByGSI1(clientId, { entityType: "POClause" })
    : { items: await db.scanByType("POClause") };
  const all = (items.items as POClause[]).filter((x) => !kind || x.kind === kind);
  // Most-used first, then newest.
  all.sort((a, b) => (b.useCount ?? 0) - (a.useCount ?? 0) || String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
  return all;
}

/**
 * Insert a clause text, or bump the usage count when the same text (case-
 * insensitive) already exists for this client + kind. Returns the row, or
 * null when the value is blank.
 */
export async function upsert(
  clientId: string,
  kind: POClauseKind,
  value: unknown,
): Promise<POClause | null> {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const existing = await list(clientId, kind);
  const dup = existing.find((x) => x.value.trim().toLowerCase() === text.toLowerCase());
  if (dup) {
    await db.updateItem(dup.pk, dup.sk, {
      useCount: (dup.useCount ?? 0) + 1,
      updatedAt: db.nowISO(),
    });
    return { ...dup, useCount: (dup.useCount ?? 0) + 1 };
  }
  const id = uuid();
  const now = db.nowISO();
  const item: POClause = {
    pk: `PO_CLAUSE#${id}`,
    sk: `PO_CLAUSE#${id}`,
    gsi1pk: `CLIENT#${clientId}`,
    gsi1sk: `POClause#${kind}#${now}`,
    entityType: "POClause",
    id,
    clientId,
    kind,
    value: text,
    useCount: 1,
    createdAt: now,
    updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function get(id: string) {
  return db.getItem(`PO_CLAUSE#${id}`) as Promise<POClause | null>;
}

export async function remove(id: string) {
  return db.deleteItem(`PO_CLAUSE#${id}`);
}
