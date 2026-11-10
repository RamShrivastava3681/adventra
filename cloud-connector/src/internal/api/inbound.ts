import { Router } from 'express';
import { InboundService } from '../service/inbound';
import { validateInput, InboundWebhookSchema, BatchIngestSchema } from '../validator';
import { loggingMiddleware, requestIdMiddleware, errorMiddleware } from './middleware';
import { ConnectorError, AuthenticationError } from '../../pkg/errors';
import { InMemorySyncJobRepository } from '../repository/inmemory/sync-job-repo';
import { InMemoryIdempotencyStore } from '../repository/inmemory/idempotency-store';

export function inboundRoutes(deps: {
  inboundService: InboundService;
  webhookSecret: string;
  verifySignature: boolean;
}): Router {
  const router = Router();
  router.use(loggingMiddleware());
  router.use(requestIdMiddleware());

  router.post(
    '/webhooks/:connectorId',
    (req, res, next) => {
      const { connectorId } = req.params as { connectorId: string };
      let body: unknown;
      try {
        body = validateInput(InboundWebhookSchema, req.body ?? {});
      } catch (err) {
        next(err);
        return;
      }
      const signature = req.header('x-signature') ?? req.header('x-hub-signature-256') ?? '';
      (req as any)._webhook = { connectorId, body, signature, rawBody: (req as any).rawBody };
      next();
    },
    async (req, res, next) => {
      try {
        const { connectorId, body, signature, rawBody } = (req as any)._webhook;
        const service = (req as any).app.locals.inboundService as InboundService;
        const result = await service.receiveWebhook(rawBody ?? '', signature, connectorId);
        res.status(result.duplicate ? 200 : 202).json({
          accepted: result.accepted,
          requestId: result.requestId,
          duplicate: result.duplicate,
          jobId: result.job?.id,
          summary: result.duplicate ? 'Duplicate event ignored' : 'Event accepted for processing',
        });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get('/sync/inbound', async (req, res, next) => {
    try {
      const service = (req as any).app.locals.inboundService as InboundService;
      const connectorId = String(req.query.connectorId ?? '');
      const cursor = String(req.query.cursor ?? '');
      const changes = await service.pollInbound(connectorId, cursor);
      res.status(200).json(changes);
    } catch (err) {
      next(err);
    }
  });

  router.post('/sync/inbound/batch', async (req, res, next) => {
    try {
      const body = validateInput(BatchIngestSchema, req.body ?? {});
      const service = (req as any).app.locals.inboundService as InboundService;
      const results = await service.batchIngest([body]);
      res.status(202).json({ accepted: true, results, requestId: crypto.randomUUID() });
    } catch (err) {
      next(err);
    }
  });

  router.use(errorMiddleware());
  return router;
}

export function buildInboundService(webhookSecret: string, verifySignature: boolean): InboundService {
  return new InboundService({
    syncJobRepository: new InMemorySyncJobRepository(),
    idempotencyStore: new InMemoryIdempotencyStore(),
    webhookSecret,
    verifySignature,
  });
}




