import { createHmac } from 'node:crypto';
import { childLogger } from '../../pkg/logger';
import { toDomainWebhook } from '../mapper';
import { AuthenticationError, ConnectorError } from '../../pkg/errors';
import { inboundEventsTotal } from '../../pkg/logger/metrics';
export class InboundService {
    log = childLogger({ service: 'inbound' });
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    async receiveWebhook(rawBody, signature, connectorId) {
        const requestId = crypto.randomUUID();
        const log = this.log.child({ requestId, connectorId });
        if (this.deps.verifySignature) {
            this.verifyWebhookSignature(rawBody, signature);
        }
        let parsed;
        try {
            parsed = typeof rawBody === 'string' ? JSON.parse(rawBody) : JSON.parse(rawBody.toString('utf8'));
        }
        catch {
            throw new ConnectorError('Invalid JSON payload', { statusCode: 400 });
        }
        const obj = parsed;
        const eventId = obj.eventId;
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
    async pollInbound(connectorId, cursor) {
        const jobs = await this.deps.syncJobRepository.listPending(500);
        const filtered = jobs.filter((j) => j.connectorId === connectorId && j.direction === 'inbound');
        const changes = filtered.map((j) => ({
            eventId: j.eventId,
            connectorId: j.connectorId,
            eventType: j.payload?.eventType ?? null,
            timestamp: j.createdAt.toISOString(),
            payload: j.payload,
        }));
        return { connectorId, cursor: cursor ?? null, changes };
    }
    async batchIngest(items) {
        const results = items.map((item) => ({
            batchId: item.batchId,
            accepted: item.records.length,
            skipped: 0,
        }));
        return results;
    }
    verifyWebhookSignature(rawBody, signature) {
        if (!signature) {
            throw new AuthenticationError('Missing webhook signature');
        }
        const expected = this.hmacSha256(rawBody);
        const provided = signature.replace(/^sha256=/i, '');
        if (!this.timingSafeEqual(provided, expected)) {
            throw new AuthenticationError('Invalid webhook signature');
        }
    }
    hmacSha256(data) {
        const hmac = createHmac('sha256', this.deps.webhookSecret);
        hmac.update(typeof data === 'string' ? data : data);
        return hmac.digest('hex');
    }
    timingSafeEqual(a, b) {
        if (a.length !== b.length)
            return false;
        let diff = 0;
        for (let i = 0; i < a.length; i++)
            diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
        return diff === 0;
    }
}
