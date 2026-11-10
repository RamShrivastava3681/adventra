import { describe, it, expect } from 'vitest';
import { OutboundService, type OutboundPushInput } from '../src/internal/service/outbound';
import { InMemorySyncJobRepository } from '../src/internal/repository/inmemory/sync-job-repo';
import { InMemoryIdempotencyStore } from '../src/internal/repository/inmemory/idempotency-store';
import { InMemoryDeadLetterQueue } from '../src/internal/repository/inmemory/dead-letter-queue';
import { InMemoryCommandStore } from '../src/internal/repository/inmemory/command-store';

function makeService() {
  return new OutboundService({
    syncJobRepository: new InMemorySyncJobRepository(),
    idempotencyStore: new InMemoryIdempotencyStore(),
    commandStore: new InMemoryCommandStore(),
    deadLetterQueue: new InMemoryDeadLetterQueue(),
    maxRetries: 2,
  });
}

function input(overrides: Partial<OutboundPushInput> = {}): OutboundPushInput {
  return {
    connectorId: 'conn-1',
    resourceType: 'voucher',
    payload: { invoiceNumber: 'INV-1' },
    idempotencyKey: `idem-${Math.random()}`,
    ...overrides,
  };
}

describe('OutboundService (command-based push)', () => {
  it('pushes a resource and queues a command for the connector', async () => {
    const svc = makeService();
    const result = await svc.push(input({ idempotencyKey: 'idem-ok' }));
    expect(result.accepted).toBe(true);
    expect(result.status).toBe('pending');
    const job = await svc.getJob(result.jobId);
    expect(job?.status).toBe('pending');
    const cmd = await svc.getCommand(result.commandId);
    expect(cmd).not.toBeNull();
    expect(cmd!.idempotencyKey).toBe('idem-ok');
  });

  it('ignores duplicate outbound pushes by idempotency key', async () => {
    const svc = makeService();
    const key = 'idem-dup';
    await svc.push(input({ idempotencyKey: key }));
    await svc.push(input({ idempotencyKey: key }));
    const pending = await svc.listPendingCommands('conn-1');
    expect(pending.filter((c) => c.idempotencyKey === key)).toHaveLength(1);
  });

  it('acks a command as DONE -> job completed', async () => {
    const svc = makeService();
    const { commandId } = await svc.push(input({ idempotencyKey: 'idem-done' }));
    const ack = await svc.ackCommand(commandId, 'DONE', {});
    expect(ack.ok).toBe(true);
    const cmd = await svc.getCommand(commandId);
    expect(cmd?.status).toBe('completed');
  });

  it('acks a command as CANCELLED -> job failed + dead letter', async () => {
    const svc = makeService();
    const { commandId } = await svc.push(input({ idempotencyKey: 'idem-cancel' }));
    const ack = await svc.ackCommand(commandId, 'CANCELLED', { error: 'boom' });
    expect(ack.ok).toBe(true);
    const dlq = await svc.deadLetterQueue.listDue(10);
    expect(dlq.length).toBe(1);
  });

  it('lists pending commands for a connector', async () => {
    const svc = makeService();
    await svc.push(input({ idempotencyKey: 'idem-list-1' }));
    await svc.push(input({ idempotencyKey: 'idem-list-2' }));
    const pending = await svc.listPendingCommands('conn-1');
    expect(pending.length).toBe(2);
    const other = await svc.listPendingCommands('conn-other');
    expect(other.length).toBe(0);
  });

  it('retries dead letter entries back into commands', async () => {
    const svc = makeService();
    await svc.deadLetterQueue.add({
      connectorId: 'conn-1',
      direction: 'outbound',
      payload: { invoiceNumber: 'INV-DLQ' },
      errorMessage: 'boom',
      attempts: 0,
      nextRetryAt: new Date(),
    });
    const res = await svc.retryDeadLetter();
    expect(res.retried).toBe(1);
    expect(res.succeeded).toBe(1);
    expect(res.failed).toBe(0);
    const pending = await svc.listPendingCommands('conn-1');
    expect(pending.length).toBe(1);
  });
});
