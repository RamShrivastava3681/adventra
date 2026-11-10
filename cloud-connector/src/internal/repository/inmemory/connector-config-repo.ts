import { ConnectorConfig, ConnectorConfigRepository } from '../../domain/entities';

export class InMemoryConnectorConfigRepository implements ConnectorConfigRepository {
  private readonly configs = new Map<string, ConnectorConfig>();

  async findById(id: string): Promise<ConnectorConfig | null> {
    return this.configs.get(id) ?? null;
  }

  async findActive(): Promise<ConnectorConfig[]> {
    return [...this.configs.values()].filter((c) => c.isActive);
  }

  async create(config: Omit<ConnectorConfig, 'createdAt'>): Promise<ConnectorConfig> {
    const id = config.id ?? crypto.randomUUID();
    const c: ConnectorConfig = { ...config, id, createdAt: new Date(), isActive: config.isActive ?? true };
    this.configs.set(id, c);
    return c;
  }

  /** Test seed helper. */
  seed(config: ConnectorConfig): void {
    this.configs.set(config.id, config);
  }
}




