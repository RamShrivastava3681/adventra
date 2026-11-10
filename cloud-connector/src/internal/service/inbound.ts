import { createHmac } from 'node:crypto';
import { SyncJob, JobStatus, SyncJobRepository } from '../domain/entities';
import { IdempotencyStore } from '../domain/entities';
import { childLogger } from '../../pkg/logger';
import { logger } from '../../pkg/logger';
import { toDomainWebhook } from '../mapper';
import { AuthenticationError, ConnectorError } from '../../pkg/errors';
import { inboundEventsTotal } from '../../pkg/logger/metrics';

export interface InboundServiceDeps {
  syncJobRepository: SyncJobRepository;
  idempotencyStore: IdempotencyStore;
  webhookSecret: string;
  verifySignature: boolean;
}

export class InboundService {
  private readonly log = childLogger({ service: 'inbound' });
  private readonly deps: InboundServiceDeps;

  constructor(deps: InboundServiceDeps) {
    this.deps = deps;
  }

  async receiveWebhook(
    rawBody: string | Buffer,
    signature: string | undefined,
    connectorId: string,
  ): Promise<{ accepted: boolean; requestId: string; job?: SyncJob; duplicate?: boolean }> {
    const requestId = crypto.randomUUID();
    const log = this.log.child({ requestId, connectorId });

    if (this.deps.verifySignature) {
      this.verifyWebhookSignature(rawBody, signature);
    }

    let parsed: unknown;
    try {
      parsed = typeof rawBody === 'string' ? JSON.parse(rawBody) : JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new ConnectorError('Invalid JSON payload', { statusCode: 400 });
    }

    const obj = parsed as Record<string, unknown>;
    const eventId = obj.eventId as string | undefined;
    if (!eventId) {
      throw new ConnectorError('Missing eventId', { statusCode: 400 });
    }

    const duplicate = await this.deps.idempotencyStore.has(eventId, connectorId, 'inbound');
    if (duplicate) {
      inboundEventsTotal.inc({ connector_id: connectorId, event_type: String(obj.eventType ?? 'unknown'), status: 'duplicate' });
      log.info({ eventId }, 'Duplicate inbound event ignored');
      return { accepted: true, requestId, duplicate: true };
    }

    const domain = toDomainWebhook(obj, connectorId);

    const job = await this.deps.syncJobRepository.create({
      connectorId,
      direction: 'inbound',
      status: 'completed',
      eventId,
      idempotencyKey: domain.idempotencyKey ?? `inbound|${connectorId}|${eventId}`,
      payload: domain.payload,
      processedAt: new Date(),
    });

    await this.deps.idempotencyStore.mark(eventId, connectorId, 'inbound');

    inboundEventsTotal.inc({ connector_id: connectorId, event_type: String(obj.eventType ?? 'unknown'), status: 'accepted' });
    log.info({ eventId, jobId: job.id }, 'Inbound event received and persisted');

    return { accepted: true, requestId, job, duplicate: false };
  }

  async pollInbound(connectorId: string, cursor?: string) {
    const jobs = await this.deps.syncJobRepository.listPending(500);
    const filtered = jobs.filter((j: SyncJob) => j.connectorId === connectorId && j.direction === 'inbound');
    const changes = filtered.map((j) => ({
      eventId: j.eventId,
      connectorId: j.connectorId,
      eventType: (j.payload as Record<string, unknown> | undefined)?.eventType ?? null,
      timestamp: j.createdAt.toISOString(),
      payload: j.payload,
    }));
    return { connectorId, cursor: cursor ?? null, changes };
  }

  async batchIngest(items: { connectorId: string; batchId: string; records: unknown[] }[]) {
    const results = items.map((item) => ({
      batchId: item.batchId,
      accepted: item.records.length,
      skipped: 0,
    }));
    return results;
  }

  private verifyWebhookSignature(rawBody: string | Buffer, signature: string | undefined): void {
    if (!signature) {
      throw new AuthenticationError('Missing webhook signature');
    }
    const expected = this.hmacSha256(rawBody);
    const provided = signature.replace(/^sha256=/i, '');
    if (!this.timingSafeEqual(provided, expected)) {
      throw new AuthenticationError('Invalid webhook signature');
    }
  }

  private hmacSha256(data: string | Buffer): string {
    const hmac = createHmac('sha256', this.deps.webhookSecret);
    hmac.update(typeof data === 'string' ? data : data);
    return hmac.digest('hex');
  }

  private timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }
}





