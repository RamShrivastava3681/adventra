export class InMemorySyncJobRepository {
    jobs = new Map();
    async create(input) {
        const id = crypto.randomUUID();
        const job = {
            ...input,
            id,
            createdAt: new Date(),
            attempts: input.attempts ?? 0,
        };
        this.jobs.set(id, job);
        return job;
    }
    async findById(id) {
        return this.jobs.get(id) ?? null;
    }
    async findByEventId(connectorId, eventId) {
        for (const job of this.jobs.values()) {
            if (job.connectorId === connectorId && job.eventId === eventId)
                return job;
        }
        return null;
    }
    async updateStatus(id, status, opts = {}) {
        const job = this.jobs.get(id);
        if (!job)
            return;
        this.jobs.set(id, {
            ...job,
            status,
            errorMessage: opts.errorMessage ?? job.errorMessage,
            processedAt: opts.processedAt ?? job.processedAt,
            attempts: opts.attempts !== undefined ? opts.attempts : job.attempts,
        });
    }
    async listPending(limit = 100) {
        const pending = [...this.jobs.values()].filter((j) => j.status === 'pending' || j.status === 'running');
        pending.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return pending.slice(0, limit);
    }
    async listPendingCommands(connectorId, limit = 100) {
        const pending = [...this.jobs.values()].filter((j) => j.connectorId === connectorId && j.direction === 'outbound' && (j.status === 'pending' || j.status === 'running'));
        pending.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return pending.slice(0, limit);
    }
}
