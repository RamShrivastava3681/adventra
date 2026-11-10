import { ConnectorClient } from '../../internal/domain/entities';
import { ConnectorError } from '../errors';
import { logger } from '../logger';

export interface TallyConnectorClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

export class TallyConnectorClient implements ConnectorClient {
  readonly name = 'tally';
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(opts: TallyConnectorClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 30000;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'X-Request-Id': crypto.randomUUID(),
    };
  }

  private async request(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      let json: unknown = null;
      const text = await res.text();
      if (text) {
        try { json = JSON.parse(text); } catch { json = text; }
      }
      if (!res.ok) {
        throw new ConnectorError(`Tally connector returned ${res.status}`, { status: res.status, body: json, path });
      }
      return { status: res.status, body: json };
    } catch (err) {
      if (err instanceof ConnectorError) throw err;
      throw new ConnectorError(err instanceof Error ? err.message : 'Connector request failed', { cause: err });
    } finally {
      clearTimeout(timer);
    }
  }

  async pushResource(
    resourceType: string,
    payload: unknown,
    idempotencyKey: string,
  ): Promise<{ ok: boolean; status?: number; body?: unknown }> {
    const { status, body: resBody } = await this.request('/api/integrations/tally/commands/ack', {
      commandId: idempotencyKey,
      status: 'DONE',
      result: { resourceType, payload, idempotencyKey, syncedAt: new Date().toISOString() },
    });
    logger.info('TALLY_PUSH_RESOURCE', 'Pushed resource to Tally connector', { resourceType, idempotencyKey, status });
    return { ok: status >= 200 && status < 300, status, body: resBody };
  }

  async pushBatch(
    items: { resourceType: string; payload: unknown; idempotencyKey: string }[],
  ): Promise<Array<{ ok: boolean; status?: number; body?: unknown }>> {
    const results: Array<{ ok: boolean; status?: number; body?: unknown }> = [];
    for (const item of items) {
      try {
        results.push(await this.pushResource(item.resourceType, item.payload, item.idempotencyKey));
      } catch (err) {
        results.push({ ok: false, body: err instanceof Error ? err.message : String(err) });
      }
    }
    return results;
  }
}




