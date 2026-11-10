export class InMemoryConnectorConfigRepository {
    configs = new Map();
    async findById(id) {
        return this.configs.get(id) ?? null;
    }
    async findActive() {
        return [...this.configs.values()].filter((c) => c.isActive);
    }
    async create(config) {
        const id = config.id ?? crypto.randomUUID();
        const c = { ...config, id, createdAt: new Date(), isActive: config.isActive ?? true };
        this.configs.set(id, c);
        return c;
    }
    /** Test seed helper. */
    seed(config) {
        this.configs.set(config.id, config);
    }
}
