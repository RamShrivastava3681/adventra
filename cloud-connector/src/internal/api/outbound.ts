import { Router } from 'express';
import { OutboundService, OutboundPushInput } from '../service/outbound';
import { validateInput, OutboundPushSchema, BatchPushSchema } from '../validator';
import { loggingMiddleware, requestIdMiddleware, errorMiddleware } from './middleware';
import { ConnectorError } from '../../pkg/errors';

export function outboundRoutes(deps: { outboundService: OutboundService }): Router {
  const router = Router();
  router.use(loggingMiddleware());
  router.use(requestIdMiddleware());

  router.post(
    '/sync/outbound/:resource',
    async (req, res, next) => {
      try {
        const resource = String(req.params.resource);
        const body = validateInput(OutboundPushSchema, { ...(req.body ?? {}), resourceType: resource });
        const service = (req as any).app.locals.outboundService as OutboundService;
        const result = await service.push(body as OutboundPushInput);
        res.status(result.accepted ? 202 : 200).json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  router.post('/sync/outbound/batch', async (req, res, next) => {
    try {
      const body = validateInput(BatchPushSchema, req.body ?? {});
      const service = (req as any).app.locals.outboundService as OutboundService;
      const results = await service.pushBatch(body.items as OutboundPushInput[]);
      res.status(202).json({ accepted: true, results, requestId: crypto.randomUUID() });
    } catch (err) {
      next(err);
    }
  });

  router.get('/sync/outbound/:jobId', async (req, res, next) => {
    try {
      const service = (req as any).app.locals.outboundService as OutboundService;
      const job = await service.getJob(String(req.params.jobId));
      if (!job) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Job not found', requestId: crypto.randomUUID() } });
        return;
      }
      res.status(200).json({ jobId: job.id, status: job.status, createdAt: job.createdAt, processedAt: job.processedAt, errorMessage: job.errorMessage });
    } catch (err) {
      next(err);
    }
  });

  router.use(errorMiddleware());
  return router;
}




