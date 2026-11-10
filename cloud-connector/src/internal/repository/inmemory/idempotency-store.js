export class InMemoryIdempotencyStore {
    keys = new Map();
    k(connectorId, direction, key) {
        return `${connectorId}|${direction}|${key}`;
    }
    async has(key, connectorId, direction) {
        const entry = this.keys.get(this.k(connectorId, direction, key));
        if (!entry)
            return false;
        if (entry.expiresAt.getTime() <= Date.now()) {
            this.keys.delete(this.k(connectorId, direction, key));
            return false;
        }
        return true;
    }
    async mark(key, connectorId, direction, ttlMs = 5 * 60 * 1000) {
        this.keys.set(this.k(connectorId, direction, key), { expiresAt: new Date(Date.now() + ttlMs) });
    }
}
