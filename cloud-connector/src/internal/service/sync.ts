/**
 * Scheduled sync worker. Polls the connector for pending inbound changes and
 * triggers outbound delta pushes on a configurable cron-like interval.
 */

import { childLogger } from '../../pkg/logger';
import { logger } from '../../pkg/logger';
import { SyncStateRepository } from '../domain/entities';

export interface SyncServiceDeps {
  syncStateRepository: SyncStateRepository;
  intervalMinutes: number;
  onTick?: () => Promise<void>;
}

export class SyncService {
  private readonly log = childLogger({ service: 'sync' });
  private readonly deps: SyncServiceDeps;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(deps: SyncServiceDeps) {
    this.deps = deps;
  }

  start(): void {
    if (this.timer) return;
    const ms = this.deps.intervalMinutes * 60 * 1000;
    this.log.info({ intervalMinutes: this.deps.intervalMinutes }, 'Scheduled sync worker started');
    this.tick().catch((err) => this.log.error(err, 'Initial sync tick failed'));
    this.timer = setInterval(() => {
      this.tick().catch((err) => this.log.error(err, 'Scheduled sync tick failed'));
    }, ms);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.log.info('Scheduled sync worker stopped');
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      if (this.deps.onTick) await this.deps.onTick();
      const state = await this.deps.syncStateRepository.get('tally-connector');
      logger.info({ state }, 'Sync tick completed');
    } finally {
      this.running = false;
    }
  }
}





