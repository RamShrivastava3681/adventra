import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { InboundService } from '../src/internal/service/inbound';
import { OutboundService } from '../src/internal/service/outbound';
import { InMemorySyncJobRepository } from '../src/internal/repository/inmemory/sync-job-repo';
import { InMemoryIdempotencyStore } from '../src/internal/repository/inmemory/idempotency-store';
import { InMemoryDeadLetterQueue } from '../src/internal/repository/inmemory/dead-letter-queue';
import { InMemoryCommandStore } from '../src/internal/repository/inmemory/command-store';

const SECRET = 'integration-secret';

function sign(rawBody: string, secret: string) {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

class FakeConnector implements ConnectorClient {
  readonly name = 'fake';
  async pushResource() {
    return { ok: true, status: 200, body: { ok: true } };
  }
  async pushBatch() {
    return [];
  }
}

describe('integration: inbound webhook + outbound push', () => {  it('receives a signed webhook and persists it', async () => {
    const repo = new InMemorySyncJobRepository();
    const store = new InMemoryIdempotencyStore();
    const inbound = new InboundService({
      syncJobRepository: repo,
      idempotencyStore: store,
      webhookSecret: SECRET,
      verifySignature: true,
    });

    const body = JSON.stringify({
      eventId: 'evt-int-1',
      connectorId: 'conn-int',
      eventType: 'sales_voucher.created',
      timestamp: '2026-01-01T00:00:00Z',
      payload: { companyId: 'c1', entityType: 'sales_voucher', records: [{ invoiceNumber: 'INV-1' }] },
    });
    const sig = sign(body, SECRET);

    const result = await inbound.receiveWebhook(body, sig, 'conn-int');
    expect(result.accepted).toBe(true);
    expect(result.duplicate).toBe(false);
    const job = await repo.findByEventId('conn-int', 'evt-int-1');
    expect(job).not.toBeNull();
    expect(job!.payload).toMatchObject({ eventType: 'sales_voucher.created' });
  });

  it('rejects an unsigned webhook', async () => {
    const inbound = new InboundService({
      syncJobRepository: new InMemorySyncJobRepository(),
      idempotencyStore: new InMemoryIdempotencyStore(),
      webhookSecret: SECRET,
      verifySignature: true,
    });
    const body = JSON.stringify({ eventId: 'evt-int-nosig', connectorId: 'c', eventType: 'x', payload: {} });
    await expect(inbound.receiveWebhook(body, undefined, 'c')).rejects.toThrow();
  });

  it('ignores duplicate inbound events', async () => {
    const repo = new InMemorySyncJobRepository();
    const store = new InMemoryIdempotencyStore();
    const inbound = new InboundService({
      syncJobRepository: repo,
      idempotencyStore: store,
      webhookSecret: SECRET,
      verifySignature: true,
    });
    const body = JSON.stringify({ eventId: 'evt-int-dup', connectorId: 'c', eventType: 'x', payload: {} });
    const sig = sign(body, SECRET);
    const first = await inbound.receiveWebhook(body, sig, 'c');
    expect(first.duplicate).toBe(false);
    const second = await inbound.receiveWebhook(body, sig, 'c');
    expect(second.duplicate).toBe(true);
  });

  it('pushes outbound to the connector client successfully', async () => {
    const repo = new InMemorySyncJobRepository();
    const store = new InMemoryIdempotencyStore();
    const outbound = new OutboundService({
      syncJobRepository: repo,
      idempotencyStore: store,
      deadLetterQueue: new InMemoryDeadLetterQueue(),
      commandStore: new InMemoryCommandStore(),
      maxRetries: 3,
    });
    const result = await outbound.push({
      connectorId: 'conn-int',
      resourceType: 'voucher',
      payload: { invoiceNumber: 'INV-PUSH' },
      idempotencyKey: 'idem-int-push',
    });
    expect(result.accepted).toBe(true);
    expect(result.status).toBe('pending');
    const job = await outbound.getJob(result.jobId);
    expect(job?.status).toBe('pending');
  });
});
