import { describe, it, expect, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { InboundService } from '../src/internal/service/inbound';
import { InMemorySyncJobRepository } from '../src/internal/repository/inmemory/sync-job-repo';
import { InMemoryIdempotencyStore } from '../src/internal/repository/inmemory/idempotency-store';

function makeSecret() {
  return 'test-webhook-secret';
}

function sign(rawBody: string | Buffer, secret: string) {
  const hex = createHmac('sha256', secret).update(typeof rawBody === 'string' ? rawBody : rawBody).digest('hex');
  return `sha256=${hex}`;
}

function makeService(secret = makeSecret(), verifySignature = true) {
  return new InboundService({
    syncJobRepository: new InMemorySyncJobRepository(),
    idempotencyStore: new InMemoryIdempotencyStore(),
    webhookSecret: secret,
    verifySignature,
  });
}

describe('InboundService (receiving data)', () => {
  let repo: InMemorySyncJobRepository;
  let store: InMemoryIdempotencyStore;
  let service: InboundService;

  beforeEach(() => {
    repo = new InMemorySyncJobRepository();
    store = new InMemoryIdempotencyStore();
    service = new InboundService({
      syncJobRepository: repo,
      idempotencyStore: store,
      webhookSecret: makeSecret(),
      verifySignature: true,
    });
  });

  it('accepts a valid signed webhook and persists the job', async () => {
    const body = JSON.stringify({
      eventId: 'evt_1',
      connectorId: 'conn-1',
      eventType: 'company.created',
      timestamp: '2026-01-01T00:00:00Z',
      payload: { companyId: 'c1', entityType: 'sales_voucher', records: [] },
    });
    const sig = sign(body, makeSecret());
    const result = await service.receiveWebhook(body, sig, 'conn-1');
    expect(result.accepted).toBe(true);
    expect(result.duplicate).toBe(false);
    const job = await repo.findByEventId('conn-1', 'evt_1');
    expect(job).not.toBeNull();
    expect(job!.direction).toBe('inbound');
    expect(job!.status).toBe('completed');
  });

  it('ignores duplicate inbound events with the same eventId', async () => {
    const body = JSON.stringify({
      eventId: 'evt_dup',
      connectorId: 'conn-1',
      eventType: 'company.created',
      payload: {},
    });
    const sig = sign(body, makeSecret());
    const first = await service.receiveWebhook(body, sig, 'conn-1');
    expect(first.duplicate).toBe(false);
    const second = await service.receiveWebhook(body, sig, 'conn-1');
    expect(second.duplicate).toBe(true);
    expect(second.accepted).toBe(true);
    const job = await repo.findByEventId('conn-1', 'evt_dup');
    expect(job).not.toBeNull();
    expect(job!.eventId).toBe('evt_dup');
  });

  it('rejects webhook without a signature when verification is enabled', async () => {
    const body = JSON.stringify({ eventId: 'evt_nosig', connectorId: 'c', eventType: 'x', payload: {} });
    await expect(service.receiveWebhook(body, undefined, 'c')).rejects.toThrow();
  });

  it('rejects webhook with an invalid signature', async () => {
    const body = JSON.stringify({ eventId: 'evt_badsig', connectorId: 'c', eventType: 'x', payload: {} });
    await expect(service.receiveWebhook(body, 'sha256=deadbeef', 'c')).rejects.toThrow();
  });

  it('skips signature verification when disabled', async () => {
    const svc = makeService(makeSecret(), false);
    const body = JSON.stringify({ eventId: 'evt_nosig2', connectorId: 'c', eventType: 'x', payload: {} });
    const result = await svc.receiveWebhook(body, undefined, 'c');
    expect(result.accepted).toBe(true);
  });
});




