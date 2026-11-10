import { Router } from 'express';
import { loggingMiddleware, requestIdMiddleware } from './middleware';
import { metricsContent } from '../../pkg/logger/metrics';

export function healthRoutes(deps: {
  dbHealth?: () => Promise<boolean>;
  connectorHealth?: () => Promise<boolean>;
}): Router {
  const router = Router();
  router.use(loggingMiddleware());
  router.use(requestIdMiddleware());

  router.get('/health', (_req, res) => {
    res.status(200).json({ status: 'up', checks: { app: 'up' } });
  });

  router.get('/ready', async (_req, res) => {
    const checks: Record<string, string> = { app: 'up' };
    let ready = true;
    if (deps.dbHealth) {
      try { checks.db = (await deps.dbHealth()) ? 'up' : 'down'; } catch { checks.db = 'down'; ready = false; }
    }
    if (deps.connectorHealth) {
      try { checks.connector = (await deps.connectorHealth()) ? 'up' : 'down'; } catch { checks.connector = 'down'; ready = false; }
    }
    if (!ready) return res.status(503).json({ status: 'down', checks });
    res.status(200).json({ status: 'up', checks });
  });

  router.get('/sync/status', async (_req, res) => {
    res.status(200).json([]);
  });

  router.get('/metrics', async (_req, res) => {
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.status(200).send(await metricsContent());
  });

  return router;
}




