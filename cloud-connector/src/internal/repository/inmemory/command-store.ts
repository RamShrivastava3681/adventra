import { OutboundCommand, CommandStore, JobStatus } from '../../domain/entities';

export class InMemoryCommandStore implements CommandStore {
  private readonly commands = new Map<string, OutboundCommand>();

  async create(command: Omit<OutboundCommand, 'id' | 'createdAt'>): Promise<OutboundCommand> {
    const id = crypto.randomUUID();
    const c: OutboundCommand = {
      ...command,
      id,
      createdAt: new Date(),
      status: command.status ?? 'pending',
      attempts: command.attempts ?? 0,
    };
    this.commands.set(id, c);
    return c;
  }

  async listPending(connectorId: string): Promise<OutboundCommand[]> {
    return [...this.commands.values()].filter(
      (c) => c.connectorId === connectorId && (c.status === 'pending' || c.status === 'running'),
    );
  }

  async ack(commandId: string, status: 'DONE' | 'CANCELLED', result?: unknown): Promise<OutboundCommand | null> {
    const c = this.commands.get(commandId);
    if (!c) return null;
    const updated: OutboundCommand = {
      ...c,
      status: status === 'DONE' ? 'completed' : 'failed',
      processedAt: new Date(),
      errorMessage: status === 'CANCELLED' && result && typeof result === 'object' && result !== null && 'error' in result ? String((result as { error?: unknown }).error) : undefined,
    };
    this.commands.set(commandId, updated);
    return updated;
  }

  async findById(id: string): Promise<OutboundCommand | null> {
    return this.commands.get(id) ?? null;
  }

  async findByIdempotencyKey(key: string, connectorId: string): Promise<OutboundCommand | null> {
    for (const c of this.commands.values()) {
      if (c.connectorId === connectorId && c.idempotencyKey === key) return c;
    }
    return null;
  }
}
