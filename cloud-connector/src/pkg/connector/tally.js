import { ConnectorError } from '../errors';
import { logger } from '../logger';
export class TallyConnectorClient {
    name = 'tally';
    baseUrl;
    apiKey;
    timeoutMs;
    constructor(opts) {
        this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
        this.apiKey = opts.apiKey;
        this.timeoutMs = opts.timeoutMs ?? 30000;
    }
    headers() {
        return {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'X-Request-Id': crypto.randomUUID(),
        };
    }
    async request(path, body) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const res = await fetch(`${this.baseUrl}${path}`, {
                method: 'POST',
                headers: this.headers(),
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            let json = null;
            const text = await res.text();
            if (text) {
                try {
                    json = JSON.parse(text);
                }
                catch {
                    json = text;
                }
            }
            if (!res.ok) {
                throw new ConnectorError(`Tally connector returned ${res.status}`, { status: res.status, body: json, path });
            }
            return { status: res.status, body: json };
        }
        catch (err) {
            if (err instanceof ConnectorError)
                throw err;
            throw new ConnectorError(err instanceof Error ? err.message : 'Connector request failed', { cause: err });
        }
        finally {
            clearTimeout(timer);
        }
    }
    async pushResource(resourceType, payload, idempotencyKey) {
        const { status, body: resBody } = await this.request('/api/integrations/tally/commands/ack', {
            commandId: idempotencyKey,
            status: 'DONE',
            result: { resourceType, payload, idempotencyKey, syncedAt: new Date().toISOString() },
        });
        logger.info('TALLY_PUSH_RESOURCE', 'Pushed resource to Tally connector', { resourceType, idempotencyKey, status });
        return { ok: status >= 200 && status < 300, status, body: resBody };
    }
    async pushBatch(items) {
        const results = [];
        for (const item of items) {
            try {
                results.push(await this.pushResource(item.resourceType, item.payload, item.idempotencyKey));
            }
            catch (err) {
                results.push({ ok: false, body: err instanceof Error ? err.message : String(err) });
            }
        }
        return results;
    }
}
