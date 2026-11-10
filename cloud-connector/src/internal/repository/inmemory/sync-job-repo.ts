import { SyncJob, JobStatus, SyncJobRepository } from '../../domain/entities';

export class InMemorySyncJobRepository implements SyncJobRepository {
  private readonly jobs = new Map<string, SyncJob>();

  async create(input: Omit<SyncJob, 'id' | 'createdAt'>): Promise<SyncJob> {
    const id = crypto.randomUUID();
    const job: SyncJob = {
      ...input,
      id,
      createdAt: new Date(),
      attempts: input.attempts ?? 0,
    };
    this.jobs.set(id, job);
    return job;
  }

  async findById(id: string): Promise<SyncJob | null> {
    return this.jobs.get(id) ?? null;
  }

  async findByEventId(connectorId: string, eventId: string): Promise<SyncJob | null> {
    for (const job of this.jobs.values()) {
      if (job.connectorId === connectorId && job.eventId === eventId) return job;
    }
    return null;
  }

  async updateStatus(
    id: string,
    status: JobStatus,
    opts: { errorMessage?: string; processedAt?: Date; attempts?: number } = {},
  ): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) return;
    this.jobs.set(id, {
      ...job,
      status,
      errorMessage: opts.errorMessage ?? job.errorMessage,
      processedAt: opts.processedAt ?? job.processedAt,
      attempts: opts.attempts !== undefined ? opts.attempts : job.attempts,
    });
  }

  async listPending(limit = 100): Promise<SyncJob[]> {
    const pending = [...this.jobs.values()].filter((j) => j.status === 'pending' || j.status === 'running');
    pending.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return pending.slice(0, limit);
  }

  async listPendingCommands(connectorId: string, limit = 100): Promise<SyncJob[]> {
    const pending = [...this.jobs.values()].filter(
      (j) => j.connectorId === connectorId && j.direction === 'outbound' && (j.status === 'pending' || j.status === 'running'),
    );
    pending.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return pending.slice(0, limit);
  }
}




