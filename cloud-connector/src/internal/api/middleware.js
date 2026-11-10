import { structuredErrorStatus, buildStructuredError, isAppError, AppError } from '../../pkg/errors';
import { logger } from '../../pkg/logger';
import { requestDuration } from '../../pkg/logger/metrics';
export function requestIdMiddleware(headerName = 'x-request-id') {
    return (req, _res, next) => {
        req.requestId = req.header(headerName) ?? crypto.randomUUID();
        next();
    };
}
export function captureRawBody() {
    return (req, _res, next) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            req.rawBody = Buffer.concat(chunks);
            next();
        });
    };
}
export function loggingMiddleware() {
    return (req, _res, next) => {
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
export function apiKeyMiddleware(apiKey) {
    if (!apiKey)
        return (_req, _res, next) => next();
    return (req, _res, next) => {
        const key = req.header('x-api-key') ?? req.query.api_key;
        if (!key || key !== apiKey) {
            const appErr = new AppError({ message: 'Invalid or missing API key', code: 'AUTHENTICATION_FAILED', statusCode: 401 });
            next(appErr);
            return;
        }
        next();
    };
}
export function errorMiddleware() {
    return (err, _req, res, _next) => {
        const requestId = _req.requestId ?? crypto.randomUUID();
        const status = structuredErrorStatus(err);
        const body = buildStructuredError(requestId, err);
        if (isAppError(err)) {
            const appErr = err;
            if (appErr.isOperational === false) {
                logger.error({ requestId, err: appErr }, 'Non-operational error');
            }
            else {
                logger.warn({ requestId, status, err }, 'Request error');
            }
        }
        else {
            logger.warn({ requestId, status, err }, 'Request error');
        }
        res.status(status).json(body);
    };
}
export function notFoundMiddleware() {
    return (_req, res) => {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found', requestId: crypto.randomUUID() } });
    };
}
