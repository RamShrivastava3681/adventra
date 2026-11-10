import { IdempotencyKey, IdempotencyStore, Direction } from '../../domain/entities';

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly keys = new Map<string, { expiresAt: Date }>();

  private k(connectorId: string, direction: Direction, key: string) {
    return `${connectorId}|${direction}|${key}`;
  }

  async has(key: string, connectorId: string, direction: Direction): Promise<boolean> {
    const entry = this.keys.get(this.k(connectorId, direction, key));
    if (!entry) return false;
    if (entry.expiresAt.getTime() <= Date.now()) {
      this.keys.delete(this.k(connectorId, direction, key));
      return false;
    }
    return true;
  }

  async mark(key: string, connectorId: string, direction: Direction, ttlMs = 5 * 60 * 1000): Promise<void> {
    this.keys.set(this.k(connectorId, direction, key), { expiresAt: new Date(Date.now() + ttlMs) });
  }
}




