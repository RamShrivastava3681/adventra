import { DeadLetterEntry, DeadLetterQueue, Direction } from '../../domain/entities';

export class InMemoryDeadLetterQueue implements DeadLetterQueue {
  private readonly entries = new Map<string, DeadLetterEntry>();

  async add(input: Omit<DeadLetterEntry, 'id' | 'createdAt'>): Promise<DeadLetterEntry> {
    const id = crypto.randomUUID();
    const entry: DeadLetterEntry = {
      ...input,
      id,
      createdAt: new Date(),
      attempts: input.attempts ?? 0,
      nextRetryAt: input.nextRetryAt ?? new Date(),
    };
    this.entries.set(id, entry);
    return entry;
  }

  async listDue(limit = 100): Promise<DeadLetterEntry[]> {
    const now = Date.now();
    const due = [...this.entries.values()].filter((e) => {
      if (!e.nextRetryAt) return true;
      return e.nextRetryAt.getTime() <= now;
    });
    due.sort((a, b) => (a.nextRetryAt?.getTime() ?? 0) - (b.nextRetryAt?.getTime() ?? 0));
    return due.slice(0, limit);
  }

  async markProcessed(id: string): Promise<void> {
    this.entries.delete(id);
  }

  async incrementAttempts(id: string, nextRetryAt?: Date): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.set(id, { ...entry, attempts: (entry.attempts ?? 0) + 1, nextRetryAt: nextRetryAt ?? new Date() });
  }
}




