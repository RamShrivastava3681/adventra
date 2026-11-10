/**
 * Mount all API routes on the Express app.
 */
import express from 'express';
import { inboundRoutes } from './inbound';
import { outboundRoutes } from './outbound';
import { healthRoutes } from './health';
import { connectorRoutes } from './connector';
export function createApp(opts) {
    const app = express();
    app.use(express.json({
        verify: (req, _res, buf) => {
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
