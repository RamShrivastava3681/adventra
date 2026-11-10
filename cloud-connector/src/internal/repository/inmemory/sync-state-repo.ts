import { SyncState, SyncStateRepository } from '../../domain/entities';

export class InMemorySyncStateRepository implements SyncStateRepository {
  private readonly states = new Map<string, SyncState>();

  async get(connectorId: string): Promise<SyncState | null> {
    return this.states.get(connectorId) ?? null;
  }

  async set(connectorId: string, state: Partial<SyncState>): Promise<void> {
    const existing = this.states.get(connectorId) ?? { connectorId, updatedAt: new Date() };
    this.states.set(connectorId, { ...existing, ...state, updatedAt: new Date() });
  }
}




