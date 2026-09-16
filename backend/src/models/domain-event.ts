import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

/**
 * DomainEvent — lightweight log-only named events (WHIZUNIK §8).
 * Fire-and-forget next to existing advanceWorkflow/timelineStatus calls.
 * Dedupe key: name + docType + docId. Creates NO downstream tasks or
 * stock movements — the engine remains the single writer.
 */

export const DOMAIN_EVENTS = [
  "sales_order_customer_accepted",
  "finance_proforma_required",
  "advance_received",
  "final_invoice_required",
  "invoice_issued",
  "irn_recorded",
  "dispatch_preparation_required",
  "dispatch_details_completed",
  "eway_bill_required",
  "eway_bill_recorded",
  "dispatch_released",
  "physical_dispatch_confirmed",
  "stock_debited",
  "receipt_recorded",
  "payment_overdue",
] as const;

export type DomainEventName = (typeof DOMAIN_EVENTS)[number];

export interface DomainEvent {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "DomainEvent";
  id: string;
  clientId: string;
  name: DomainEventName | string;
  docType: string;
  docId: string;
  docNumber: string | null;
  actorId: string | null;
  payload: Record<string, any> | null;
  createdAt: string;
}

/** Log-only emit. Returns null when the same name+doc was already logged. */
export async function writeEvent(data: {
  clientId: string;
  name: DomainEventName | string;
  docType: string;
  docId: string;
  docNumber?: string | null;
  actorId?: string | null;
  payload?: Record<string, any> | null;
}): Promise<DomainEvent | null> {
  const dedupeKey = `${data.name}#${data.docType}#${data.docId}`;
  try {
    const existing = await db.scanByType("DomainEvent", { limit: 2000 });
    if ((existing as any[]).some((e) => `${e.name}#${e.docType}#${e.docId}` === dedupeKey)) {
      return null;
    }
  } catch {
    // If the scan fails, still attempt the write — never block the caller.
  }
  const id = uuid();
  const now = db.nowISO();
  const item: DomainEvent = {
    pk: `DOMAINEVENT#${data.docType}#${data.docId}`,
    sk: `EVENT#${now}#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`,
    gsi1sk: `DomainEvent#${now}`,
    entityType: "DomainEvent",
    id,
    clientId: data.clientId,
    name: data.name,
    docType: data.docType,
    docId: data.docId,
    docNumber: data.docNumber ?? null,
    actorId: data.actorId ?? null,
    payload: data.payload ?? null,
    createdAt: now,
  };
  try {
    await db.putItem(item);
  } catch {
    return null;
  }
  return item;
}

export async function listForDoc(docType: string, docId: string): Promise<DomainEvent[]> {
  const items = await db.scanByType("DomainEvent", { limit: 2000 });
  return (items as DomainEvent[])
    .filter((e) => e.docType === docType && e.docId === docId)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}
