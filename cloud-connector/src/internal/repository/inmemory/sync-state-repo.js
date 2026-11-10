export class InMemorySyncStateRepository {
    states = new Map();
    async get(connectorId) {
        return this.states.get(connectorId) ?? null;
    }
    async set(connectorId, state) {
        const existing = this.states.get(connectorId) ?? { connectorId, updatedAt: new Date() };
        this.states.set(connectorId, { ...existing, ...state, updatedAt: new Date() });
    }
}
