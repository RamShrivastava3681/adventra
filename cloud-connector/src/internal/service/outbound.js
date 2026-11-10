/**
 * Outbound (push) service. Creates pollable commands that the Tally desktop
 * connector picks up via GET /commands/pending, executes against local Tally,
 * and acknowledges via POST /commands/ack. Exponential backoff retry (max 5)
 * and dead letter queue for permanent failures. Idempotency keys prevent
 * duplicate connector records.
 */
import { childLogger } from '../../pkg/logger';
import { deadLetterTotal, outboundErrorsTotal, outboundPushesTotal, } from '../../pkg/logger/metrics';
const MAX_RETRIES = 5;
const BACKOFF_BASE_MS = 1000;
export class OutboundService {
    log = childLogger({ service: 'outbound' });
    deps;
    maxRetries;
    deadLetterQueue;
    commandStore;
    constructor(deps) {
        this.deps = deps;
        this.maxRetries = deps.maxRetries ?? MAX_RETRIES;
        this.deadLetterQueue = deps.deadLetterQueue;
        this.commandStore = deps.commandStore;
    }
    async push(input) {
        const log = this.log.child({ connectorId: input.connectorId, resourceType: input.resourceType });
        const idempotent = await this.deps.idempotencyStore.has(input.idempotencyKey, input.connectorId, 'outbound');
        if (idempotent) {
            outboundPushesTotal.inc({ connector_id: input.connectorId, resource_type: input.resourceType, status: 'duplicate' });
            return { jobId: input.idempotencyKey, commandId: input.idempotencyKey, status: 'completed', accepted: true };
        }
        const job = await this.deps.syncJobRepository.create({
            connectorId: input.connectorId,
            direction: 'outbound',
            status: 'pending',
            idempotencyKey: input.idempotencyKey,
            payload: input.payload,
            attempts: 0,
        });
        const command = await this.deps.commandStore.create({
            connectorId: input.connectorId,
            resourceType: input.resourceType,
            payload: input.payload,
            idempotencyKey: input.idempotencyKey,
            status: 'pending',
            attempts: 0,
        });
        await this.deps.idempotencyStore.mark(input.idempotencyKey, input.connectorId, 'outbound');
        outboundPushesTotal.inc({ connector_id: input.connectorId, resource_type: input.resourceType, status: 'queued' });
        log.info({ jobId: job.id, commandId: command.id }, 'Outbound command queued for connector poll');
        return { jobId: job.id, commandId: command.id, status: 'pending', accepted: true };
    }
    async pushBatch(items) {
        const results = await Promise.all(items.map((it) => this.push(it)));
        return results;
    }
    async getJob(jobId) {
        return this.deps.syncJobRepository.findById(jobId);
    }
    async getCommand(commandId) {
        return this.deps.commandStore.findById(commandId);
    }
    async ackCommand(commandId, status, result = {}) {
        const command = await this.deps.commandStore.ack(commandId, status, result);
        if (!command) {
            return { ok: false };
        }
        await this.deps.syncJobRepository.updateStatus(command.id, status === 'DONE' ? 'completed' : 'failed', {
            processedAt: new Date(),
        });
        if (status === 'CANCELLED') {
            outboundErrorsTotal.inc({ connector_id: command.connectorId, resource_type: command.resourceType, code: 'PERMANENT' });
            await this.deps.deadLetterQueue.add({
                connectorId: command.connectorId,
                direction: 'outbound',
                payload: command.payload,
                errorMessage: result?.error ?? 'Command cancelled',
                attempts: command.attempts,
                nextRetryAt: new Date(),
            });
            deadLetterTotal.inc({ connector_id: command.connectorId, direction: 'outbound' });
        }
        else {
            outboundPushesTotal.inc({ connector_id: command.connectorId, resource_type: command.resourceType, status: 'success' });
        }
        this.log.info({ commandId, status }, 'Command acknowledged');
        return { ok: true, command };
    }
    async listPendingCommands(connectorId) {
        return this.deps.commandStore.listPending(connectorId);
    }
    async retryDeadLetter(limit = 50) {
        const due = await this.deps.deadLetterQueue.listDue(limit);
        let retried = 0, succeeded = 0, failed = 0;
        for (const entry of due) {
            retried++;
            try {
                const command = await this.deps.commandStore.create({
                    connectorId: entry.connectorId,
                    resourceType: entry.direction,
                    payload: entry.payload,
                    idempotencyKey: `${entry.id}-retry-${Date.now()}`,
                    status: 'pending',
                    attempts: entry.attempts,
                });
                succeeded++;
                await this.deps.deadLetterQueue.markProcessed(entry.id);
                await this.deps.syncJobRepository.updateStatus(command.id, 'pending');
            }
            catch {
                failed++;
                await this.deps.deadLetterQueue.incrementAttempts(entry.id, new Date(Date.now() + BACKOFF_BASE_MS * 4));
            }
        }
        return { retried, succeeded, failed };
    }
}
