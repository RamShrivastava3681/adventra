import { Router } from 'express';
import { InboundService } from '../service/inbound';
import { validateInput, InboundWebhookSchema, BatchIngestSchema } from '../validator';
import { loggingMiddleware, requestIdMiddleware, errorMiddleware } from './middleware';
import { InMemorySyncJobRepository } from '../repository/inmemory/sync-job-repo';
import { InMemoryIdempotencyStore } from '../repository/inmemory/idempotency-store';
export function inboundRoutes(deps) {
    const router = Router();
    router.use(loggingMiddleware());
    router.use(requestIdMiddleware());
    router.post('/webhooks/:connectorId', (req, res, next) => {
        const { connectorId } = req.params;
        let body;
        try {
            body = validateInput(InboundWebhookSchema, req.body ?? {});
        }
        catch (err) {
            next(err);
            return;
        }
        const signature = req.header('x-signature') ?? req.header('x-hub-signature-256') ?? '';
        req._webhook = { connectorId, body, signature, rawBody: req.rawBody };
        next();
    }, async (req, res, next) => {
        try {
            const { connectorId, body, signature, rawBody } = req._webhook;
            const service = req.app.locals.inboundService;
            const result = await service.receiveWebhook(rawBody ?? '', signature, connectorId);
            res.status(result.duplicate ? 200 : 202).json({
                accepted: result.accepted,
                requestId: result.requestId,
                duplicate: result.duplicate,
                jobId: result.job?.id,
                summary: result.duplicate ? 'Duplicate event ignored' : 'Event accepted for processing',
            });
        }
        catch (err) {
            next(err);
        }
    });
    router.get('/sync/inbound', async (req, res, next) => {
        try {
            const service = req.app.locals.inboundService;
            const connectorId = String(req.query.connectorId ?? '');
            const cursor = String(req.query.cursor ?? '');
            const changes = await service.pollInbound(connectorId, cursor);
            res.status(200).json(changes);
        }
        catch (err) {
            next(err);
        }
    });
    router.post('/sync/inbound/batch', async (req, res, next) => {
        try {
            const body = validateInput(BatchIngestSchema, req.body ?? {});
            const service = req.app.locals.inboundService;
            const results = await service.batchIngest([body]);
            res.status(202).json({ accepted: true, results, requestId: crypto.randomUUID() });
        }
        catch (err) {
            next(err);
        }
    });
    router.use(errorMiddleware());
    return router;
}
export function buildInboundService(webhookSecret, verifySignature) {
    return new InboundService({
        syncJobRepository: new InMemorySyncJobRepository(),
        idempotencyStore: new InMemoryIdempotencyStore(),
        webhookSecret,
        verifySignature,
    });
}
