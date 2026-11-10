export class InMemoryCommandStore {
    commands = new Map();
    async create(command) {
        const id = crypto.randomUUID();
        const c = {
            ...command,
            id,
            createdAt: new Date(),
            status: command.status ?? 'pending',
            attempts: command.attempts ?? 0,
        };
        this.commands.set(id, c);
        return c;
    }
    async listPending(connectorId) {
        return [...this.commands.values()].filter((c) => c.connectorId === connectorId && (c.status === 'pending' || c.status === 'running'));
    }
    async ack(commandId, status, result) {
        const c = this.commands.get(commandId);
        if (!c)
            return null;
        const updated = {
            ...c,
            status: status === 'DONE' ? 'completed' : 'failed',
            processedAt: new Date(),
            errorMessage: status === 'CANCELLED' && result && typeof result === 'object' && result !== null && 'error' in result ? String(result.error) : undefined,
        };
        this.commands.set(commandId, updated);
        return updated;
    }
    async findById(id) {
        return this.commands.get(id) ?? null;
    }
    async findByIdempotencyKey(key, connectorId) {
        for (const c of this.commands.values()) {
            if (c.connectorId === connectorId && c.idempotencyKey === key)
                return c;
        }
        return null;
    }
}
