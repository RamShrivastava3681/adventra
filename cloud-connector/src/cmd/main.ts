#!/usr/bin/env node
/**
 * WhizUnik Cloud Connector — application entry point.
 */

import { createServer } from 'node:http';
import { loadConfig } from '../internal/config/index';
import { logger } from '../pkg/logger';
import { InMemorySyncJobRepository } from '../internal/repository/inmemory/sync-job-repo';
import { InMemoryIdempotencyStore } from '../internal/repository/inmemory/idempotency-store';
import { InMemoryConnectorConfigRepository } from '../internal/repository/inmemory/connector-config-repo';
import { InMemorySyncStateRepository } from '../internal/repository/inmemory/sync-state-repo';
import { InMemoryDeadLetterQueue } from '../internal/repository/inmemory/dead-letter-queue';
import { InMemoryCommandStore } from '../internal/repository/inmemory/command-store';
import { InboundService } from '../internal/service/inbound';
import { OutboundService } from '../internal/service/outbound';
import { SyncService } from '../internal/service/sync';
import { createApp } from '../internal/api/index';
import { metricsContent } from '../pkg/logger/metrics';

async function main(): Promise<void> {
  const config = loadConfig();
  logger.info({ env: config.nodeEnv, port: config.port }, 'Starting WhizUnik Cloud Connector');

  const syncJobRepo = new InMemorySyncJobRepository();
  const idempotencyStore = new InMemoryIdempotencyStore();
  const connectorConfigRepo = new InMemoryConnectorConfigRepository();
  const syncStateRepo = new InMemorySyncStateRepository();
  const deadLetterQueue = new InMemoryDeadLetterQueue();
  const commandStore = new InMemoryCommandStore();

  const inboundService = new InboundService({
    syncJobRepository: syncJobRepo,
    idempotencyStore,
    webhookSecret: config.connector.webhookSecret,
    verifySignature: config.features.webhookSigVerify,
  });

  const outboundService = new OutboundService({
    syncJobRepository: syncJobRepo,
    idempotencyStore,
    commandStore,
    deadLetterQueue,
    maxRetries: config.connector.maxRetries,
  });

  const syncService = new SyncService({
    syncStateRepository: syncStateRepo,
    intervalMinutes: config.sync.intervalMinutes,
    onTick: async () => {
      if (!config.features.outbound) return;
      logger.debug('SYNC_TICK', 'Scheduled sync tick');
    },
  });

  const app = createApp({
    inboundService,
    outboundService,
    commandStore,
    syncJobRepository: syncJobRepo,
    idempotencyStore,
    connectorConfigRepository: connectorConfigRepo,
    webhookSecret: config.connector.webhookSecret,
    verifySignature: config.features.webhookSigVerify,
  });

  const server = createServer(app);

  function dbHealth(): Promise<boolean> {
    return Promise.resolve(true);
  }

  function connectorHealth(): Promise<boolean> {
    return Promise.resolve(true);
  }

  const { healthRoutes } = await import('../internal/api/health');
  app.use(healthRoutes({ dbHealth, connectorHealth }));

  server.listen(config.port, config.host, () => {
    logger.info({ port: config.port, host: config.host }, 'HTTP server listening');
    syncService.start();
  });

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, async () => {
      logger.info({ signal: sig }, 'Shutting down');
      syncService.stop();
      server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
      });
    });
  }
}

main().catch((err) => {
  logger.error(err, 'Application failed to start');
  process.exit(1);
});
