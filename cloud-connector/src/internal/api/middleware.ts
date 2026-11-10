import { Request, Response, NextFunction } from 'express';
import { structuredErrorStatus, buildStructuredError, isAppError, AppError } from '../../pkg/errors';
import { logger } from '../../pkg/logger';
import { requestDuration } from '../../pkg/logger/metrics';

export interface RequestWithId extends Request {
  requestId?: string;
  rawBody?: Buffer;
}

export function requestIdMiddleware(headerName = 'x-request-id') {
  return (req: RequestWithId, _res: Response, next: NextFunction): void => {
    req.requestId = req.header(headerName) ?? crypto.randomUUID();
    next();
  };
}

export function captureRawBody() {
  return (req: RequestWithId, _res: Response, next: NextFunction): void => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      req.rawBody = Buffer.concat(chunks);
      next();
    });
  };
}

export function loggingMiddleware() {
  return (req: RequestWithId, _res: Response, next: NextFunction): void => {
    const start = process.hrtime.bigint();
    _res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      logger.child({ requestId: req.requestId }).info({
        method: req.method,
        route: req.route?.path ?? req.path,
        statusCode: _res.statusCode,
        durationMs,
        ip: req.ip,
      });
      requestDuration.observe({ method: req.method, route: req.route?.path ?? req.path, status_code: String(_res.statusCode) }, durationMs / 1000);
    });
    next();
  };
}

export function apiKeyMiddleware(apiKey: string) {
  if (!apiKey) return (_req: Request, _res: Response, next: NextFunction) => next();
  return (req: Request, _res: Response, next: NextFunction): void => {
    const key = req.header('x-api-key') ?? (req.query.api_key as string | undefined);
    if (!key || key !== apiKey) {
      const appErr = new AppError({ message: 'Invalid or missing API key', code: 'AUTHENTICATION_FAILED', statusCode: 401 });
      next(appErr);
      return;
    }
    next();
  };
}

export function errorMiddleware() {
  return (err: unknown, _req: RequestWithId, res: Response, _next: NextFunction): void => {
    const requestId = _req.requestId ?? crypto.randomUUID();
    const status = structuredErrorStatus(err);
    const body = buildStructuredError(requestId, err);
    if (isAppError(err)) {
      const appErr = err as AppError;
      if (appErr.isOperational === false) {
        logger.error({ requestId, err: appErr }, 'Non-operational error');
      } else {
        logger.warn({ requestId, status, err }, 'Request error');
      }
    } else {
      logger.warn({ requestId, status, err }, 'Request error');
    }
    res.status(status).json(body);
  };
}

export function notFoundMiddleware() {
  return (_req: RequestWithId, res: Response): void => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found', requestId: crypto.randomUUID() } });
  };
}




