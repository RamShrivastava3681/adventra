import { describe, it, expect } from 'vitest';
import {
  toDomainWebhook,
  toExternalPush,
  toExternalPushBatch,
  toTallyDate,
  toIsoDate,
  mapEnum,
  type DomainPush,
} from '../src/internal/mapper';

describe('mapper', () => {
  describe('toDomainWebhook', () => {
    it('maps an external webhook to an inbound domain job', () => {
      const external = {
        eventId: 'evt_123',
        connectorId: 'conn-1',
        eventType: 'company.created',
        timestamp: '2026-01-01T00:00:00Z',
        payload: { companyId: 'c1', entityType: 'sales_voucher', records: [] },
      };
      const domain = toDomainWebhook(external as any, 'conn-1');
      expect(domain.connectorId).toBe('conn-1');
      expect(domain.direction).toBe('inbound');
      expect(domain.status).toBe('pending');
      expect(domain.eventId).toBe('evt_123');
      expect(domain.idempotencyKey).toBe('inbound|conn-1|evt_123');
      expect(domain.payload).toMatchObject({ eventType: 'company.created' });
    });

    it('generates an event id when missing', () => {
      const domain = toDomainWebhook({ connectorId: 'c', eventType: 'x' } as any, 'c');
      expect(typeof domain.eventId).toBe('string');
      expect(domain.eventId!.length).toBeGreaterThan(0);
    });
  });

  describe('toExternalPush', () => {
    it('maps a domain push to a Tally PushVoucher', () => {
      const domain: DomainPush = {
        resourceType: 'voucher',
        invoiceId: 'inv-1',
        invoiceNumber: 'INV-100',
        partyName: 'Acme Corp',
        amount: 1180,
        tallyDate: '20260101',
        idempotencyKey: 'idem-1',
        quantity: 2,
        unitPrice: 500,
        gstRate: 18,
        grandTotal: 1180,
      };
      const ext = toExternalPush(domain);
      expect(ext.invoiceNumber).toBe('INV-100');
      expect(ext.partyName).toBe('Acme Corp');
      expect(ext.amount).toBe(1180);
      expect(ext.tallyDate).toBe('20260101');
      expect(ext.idempotencyKey).toBe('idem-1');
      expect(ext.quantity).toBe(2);
      expect(ext.gstRate).toBe(18);
    });
  });

  describe('toExternalPushBatch', () => {
    it('maps multiple domain pushes to a batch payload', () => {
      const items: DomainPush[] = [
        { resourceType: 'voucher', invoiceId: 'i1', invoiceNumber: 'N1', partyName: 'A', amount: 100, tallyDate: '20260101', idempotencyKey: 'k1' },
        { resourceType: 'voucher', invoiceId: 'i2', invoiceNumber: 'N2', partyName: 'B', amount: 200, tallyDate: '20260102', idempotencyKey: 'k2' },
      ];
      const batch = toExternalPushBatch(items);
      expect(batch.vouchers).toHaveLength(2);
      expect(batch.vouchers[0].invoiceNumber).toBe('N1');
      expect(batch.vouchers[1].invoiceNumber).toBe('N2');
    });
  });

  describe('toTallyDate', () => {
    it('normalizes ISO date to YYYYMMDD', () => {
      expect(toTallyDate('2026-03-05T10:00:00Z')).toBe('20260305');
      expect(toTallyDate(new Date('2026-03-05'))).toBe('20260305');
    });
    it('returns empty string for invalid date', () => {
      expect(toTallyDate('not-a-date')).toBe('');
    });
  });

  describe('toIsoDate', () => {
    it('normalizes to YYYY-MM-DD', () => {
      expect(toIsoDate('2026-03-05T10:00:00Z')).toBe('2026-03-05');
    });
  });

  describe('mapEnum', () => {
    it('maps known values and defaults unknown', () => {
      expect(mapEnum('sales_voucher', { sales_voucher: 'Sales' }, 'Other')).toBe('Sales');
      expect(mapEnum('unknown_type', { sales_voucher: 'Sales' }, 'Other')).toBe('Other');
      expect(mapEnum(undefined, { a: 'b' }, 'default')).toBe('default');
    });
  });
});




