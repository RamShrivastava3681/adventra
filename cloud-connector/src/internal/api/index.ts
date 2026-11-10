/**
 * Mount all API routes on the Express app.
 */

import express, { Application } from 'express';
import { inboundRoutes } from './inbound';
import { outboundRoutes } from './outbound';
import { healthRoutes } from './health';
import { connectorRoutes } from './connector';
import { InboundService } from '../service/inbound';
import { OutboundService } from '../service/outbound';
import { SyncJobRepository } from '../domain/entities';
import { IdempotencyStore } from '../domain/entities';
import { ConnectorConfigRepository } from '../domain/entities';
import { CommandStore } from '../domain/entities';

export function createApp(opts: {
  inboundService: InboundService;
  outboundService: OutboundService;
  commandStore: CommandStore;
  syncJobRepository: SyncJobRepository;
  idempotencyStore: IdempotencyStore;
  connectorConfigRepository: ConnectorConfigRepository;
  webhookSecret: string;
  verifySignature: boolean;
}): Application {
  const app = express() as Application;

  app.use(express.json({
    verify: (req: any, _res: any, buf: Buffer) => {
      req.rawBody = buf;
    },
  }));
  app.use(express.urlencoded({ extended: false }));

  app.locals.inboundService = opts.inboundService;
  app.locals.outboundService = opts.outboundService;

  app.use(inboundRoutes({
    inboundService: opts.inboundService,
    webhookSecret: opts.webhookSecret,
    verifySignature: opts.verifySignature,
  }));
  app.use(outboundRoutes({ outboundService: opts.outboundService }));
  app.use(connectorRoutes({
    syncJobRepository: opts.syncJobRepository,
    idempotencyStore: opts.idempotencyStore,
    outboundService: opts.outboundService,
    connectorConfigRepository: opts.connectorConfigRepository,
  }));
  app.use(healthRoutes({}));

  return app;
}
