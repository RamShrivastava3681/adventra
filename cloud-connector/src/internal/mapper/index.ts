/**
 * Bidirectional mapping between the external Tally connector schema and the
 * internal domain model. Handles date formats, casing, enum mapping, null
 * handling and field-level transformations.
 */

import { SyncJob, Direction, JobStatus } from '../domain/entities';

export interface ExternalWebhookPayload {
  eventId?: string;
  connectorId?: string;
  eventType?: string;
  timestamp?: string;
  payload?: unknown;
  [key: string]: unknown;
}

export interface ExternalBatchPayload {
  batchId?: string;
  requestId?: string;
  syncId?: string;
  deviceId?: string;
  companyId?: string;
  entityType?: string;
  batchNumber?: number;
  totalBatches?: number;
  records?: unknown[];
  [key: string]: unknown;
}

export interface PushVoucher {
  invoiceId: string;
  invoiceNumber: string;
  partyName: string;
  amount: number;
  tallyDate: string;
  voucherType?: string;
  customerLedgerName?: string;
  skuCode?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  gstRate?: number;
  grandTotal?: number;
  idempotencyKey?: string;
  companyId?: string;
  companyName?: string;
  narration?: string;
  reason?: string;
}

export interface DomainPush {
  resourceType: string;
  invoiceId: string;
  invoiceNumber: string;
  partyName: string;
  amount: number;
  tallyDate: string;
  idempotencyKey: string;
  companyId?: string;
  companyName?: string;
  narration?: string;
  quantity?: number;
  unitPrice?: number;
  gstRate?: number;
  grandTotal?: number;
  [key: string]: unknown;
}

/** External webhook â†’ internal domain SyncJob fields. */
export function toDomainWebhook(
  external: ExternalWebhookPayload,
  connectorId: string,
): Partial<SyncJob> {
  const eventId = String(external.eventId ?? crypto.randomUUID());
  return {
    connectorId,
    direction: 'inbound' as Direction,
    status: 'pending' as JobStatus,
    eventId,
    idempotencyKey: `inbound|${connectorId}|${eventId}`,
    payload: {
      eventType: external.eventType ?? null,
      timestamp: external.timestamp ?? null,
      payload: external.payload ?? null,
      source: 'tally_connector',
    },
    createdAt: new Date(),
  };
}

/** External batch payload â†’ normalized batch record. */
export function toDomainBatch(external: ExternalBatchPayload, connectorId: string) {
  return {
    batchId: external.batchId ?? crypto.randomUUID(),
    requestId: external.requestId ?? crypto.randomUUID(),
    syncId: external.syncId ?? null,
    connectorId,
    companyId: external.companyId ?? null,
    entityType: external.entityType ?? null,
    batchNumber: external.batchNumber ?? 0,
    totalBatches: external.totalBatches ?? 0,
    records: Array.isArray(external.records) ? external.records : [],
    receivedAt: new Date(),
  };
}

/** Internal domain push â†’ external Tally PushVoucher schema. */
export function toExternalPush(domain: DomainPush): PushVoucher {
  const voucher: PushVoucher = {
    invoiceId: domain.invoiceId,
    invoiceNumber: domain.invoiceNumber,
    partyName: domain.partyName,
    amount: Number(domain.amount) || 0,
    tallyDate: domain.tallyDate,
    voucherType: 'Sales',
    customerLedgerName: domain.partyName,
    idempotencyKey: domain.idempotencyKey,
    narration: undefined,
  };
  if (domain.companyId) voucher.companyId = String(domain.companyId);
  if (domain.companyName) voucher.companyName = String(domain.companyName);
  if (domain.narration) voucher.narration = String(domain.narration);
  if (domain.quantity !== undefined) voucher.quantity = domain.quantity;
  if (domain.unitPrice !== undefined) voucher.unitPrice = domain.unitPrice;
  if (domain.gstRate !== undefined) voucher.gstRate = domain.gstRate;
  if (domain.grandTotal !== undefined) voucher.grandTotal = domain.grandTotal;
  return voucher;
}

/** Internal domain push â†’ external Tally PushVouchersPayload (batch). */
export function toExternalPushBatch(items: DomainPush[]) {
  return {
    companyId: items[0]?.companyId ?? undefined,
    companyName: items[0]?.companyName ?? undefined,
    vouchers: items.map((it) => toExternalPush(it)),
  };
}

/** Normalize an ISO date to Tally YYYYMMDD voucher date. */
export function toTallyDate(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/** Normalize an ISO date to YYYY-MM-DD. */
export function toIsoDate(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/** Map an enum from external casing to internal canonical value. */
export function mapEnum(value: unknown, mapping: Record<string, string>, def: string): string {
  const key = String(value ?? '').trim();
  return mapping[key] ?? def;
}




