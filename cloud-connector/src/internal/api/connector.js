/**
 * Tally connector cloud API routes. These are the endpoints the Tally desktop
 * connector calls (per src/service/cloud/client.ts in tally-connector/):
 *
 *   POST /api/integrations/tally/connect        pairing -> returns connectorId + tokens
 *   POST /api/integrations/tally/token          refresh access token
 *   POST /api/integrations/tally/sync/batch     inbound batch upload (idempotent)
 *   POST /api/integrations/tally/heartbeat      heartbeat; returns pending commands
 *   GET  /api/integrations/tally/commands/pending poll cloud->connector commands
 *   POST /api/integrations/tally/commands/ack   connector acks a command
 */
import { Router } from 'express';
import { z } from 'zod';
import { buildStructuredError, structuredErrorStatus, AuthenticationError, ConnectorError } from '../../pkg/errors';
function randId(prefix = 'id') {
    return `${prefix}_${crypto.randomUUID()}`;
}
const PairingSchema = z.object({
    pairingCode: z.string().min(1),
    deviceId: z.string().min(1),
    deviceName: z.string().min(1),
    appVersion: z.string().optional(),
    protocolVersion: z.string().optional(),
    company: z.object({ name: z.string(), tallyGuid: z.string().optional() }).optional(),
});
const TokenSchema = z.object({
    refreshToken: z.string().min(1),
    deviceId: z.string().optional(),
    connectorId: z.string().optional(),
});
const BatchSchema = z.object({
    batchId: z.string().min(1),
    requestId: z.string().min(1),
    syncId: z.string().optional(),
    deviceId: z.string().optional(),
    companyId: z.string().optional(),
    entityType: z.string().optional(),
    batchNumber: z.number().optional(),
    totalBatches: z.number().optional(),
    records: z.array(z.record(z.string(), z.unknown())).min(1),
});
export function connectorRoutes(deps) {
    const router = Router();
    // In-memory token store: accessToken -> connectorId (and refreshToken -> connectorId)
    const accessTokens = new Map();
    const refreshTokens = new Map();
    const tokenExpiry = new Map();
    function authenticate(req) {
        const auth = (req.headers.authorization ?? '');
        const match = /^Bearer\s+(.+)$/i.exec(auth);
        if (!match)
            return null;
        const token = match[1];
        const connectorId = accessTokens.get(token);
        if (!connectorId)
            return null;
        const exp = tokenExpiry.get(token) ?? 0;
        if (Date.now() > exp)
            return null;
        return { connectorId, token };
    }
    // POST /api/integrations/tally/connect — pairing
    router.post('/api/integrations/tally/connect', async (req, res, next) => {
        try {
            const body = PairingSchema.parse(req.body ?? {});
            const connectorId = randId('wz-connector');
            const accessToken = `at_${randId('')}`;
            const refreshToken = `rt_${randId('')}`;
            const expiresAt = Date.now() + 3600_000;
            accessTokens.set(accessToken, connectorId);
            refreshTokens.set(refreshToken, connectorId);
            tokenExpiry.set(accessToken, expiresAt);
            await deps.connectorConfigRepository.create({
                id: connectorId,
                name: body.company?.name ?? 'Tally Company',
                type: 'tally',
                baseUrl: undefined,
                authType: 'bearer',
                credentialsRef: undefined,
                isActive: true,
            });
            res.status(200).json({
                connectorId,
                accessToken,
                refreshToken,
                accessTokenExpiresAt: new Date(expiresAt).toISOString(),
                tenant: { id: 'tenant-1', name: 'WhizUnik Tenant' },
                companyMapping: {
                    tallyCompanyGuid: body.company?.tallyGuid ?? randId('guid'),
                    whizunikCompanyId: `whiz-company-${connectorId}`,
                },
            });
        }
        catch (err) {
            next(err);
        }
    });
    // POST /api/integrations/tally/token — refresh
    router.post('/api/integrations/tally/token', async (req, res, next) => {
        try {
            const body = TokenSchema.parse(req.body ?? {});
            const connectorId = refreshTokens.get(body.refreshToken);
            if (!connectorId) {
                throw new AuthenticationError('Unknown refresh token');
            }
            const accessToken = `at_${randId('')}`;
            const expiresAt = Date.now() + 3600_000;
            accessTokens.set(accessToken, connectorId);
            tokenExpiry.set(accessToken, expiresAt);
            res.status(200).json({
                connectorId,
                accessToken,
                refreshToken: body.refreshToken,
                accessTokenExpiresAt: new Date(expiresAt).toISOString(),
                tenant: { id: 'tenant-1', name: 'WhizUnik Tenant' },
            });
        }
        catch (err) {
            next(err);
        }
    });
    // POST /api/integrations/tally/sync/batch — inbound batch upload (idempotent)
    router.post('/api/integrations/tally/sync/batch', async (req, res, next) => {
        try {
            const auth = authenticate(req);
            if (!auth) {
                throw new AuthenticationError('Invalid token');
            }
            const body = BatchSchema.parse(req.body ?? {});
            const duplicate = (await deps.idempotencyStore.has(body.batchId, auth.connectorId, 'inbound')) ||
                (await deps.idempotencyStore.has(body.requestId, auth.connectorId, 'inbound'));
            await deps.idempotencyStore.mark(body.batchId, auth.connectorId, 'inbound');
            await deps.idempotencyStore.mark(body.requestId, auth.connectorId, 'inbound');
            const job = await deps.syncJobRepository.create({
                connectorId: auth.connectorId,
                direction: 'inbound',
                status: 'completed',
                idempotencyKey: `batch|${auth.connectorId}|${body.batchId}`,
                payload: {
                    batchId: body.batchId,
                    requestId: body.requestId,
                    syncId: body.syncId,
                    companyId: body.companyId,
                    entityType: body.entityType,
                    records: body.records,
                    source: 'tally_connector_batch',
                },
                processedAt: new Date(),
            });
            res.status(200).json({
                acked: true,
                batchId: body.batchId,
                duplicate,
                receivedCount: duplicate ? 0 : body.records.length,
                jobId: job.id,
            });
        }
        catch (err) {
            next(err);
        }
    });
    // POST /api/integrations/tally/heartbeat — heartbeat; returns pending commands
    router.post('/api/integrations/tally/heartbeat', async (req, res, next) => {
        try {
            const auth = authenticate(req);
            if (!auth) {
                throw new AuthenticationError('Invalid token');
            }
            const commands = await deps.outboundService.listPendingCommands(auth.connectorId);
            res.status(200).json({
                commands: commands.map((c) => ({
                    id: c.id,
                    commandId: c.idempotencyKey,
                    command: 'PUSH_VOUCHERS',
                    type: 'PUSH_VOUCHERS',
                    payload: {
                        companyId: commandPayloadCompany(c.payload),
                        companyName: commandPayloadCompanyName(c.payload),
                        connectorId: c.connectorId,
                        vouchers: Array.isArray(c.payload) ? c.payload : [c.payload],
                    },
                })),
            });
        }
        catch (err) {
            next(err);
        }
    });
    // GET /api/integrations/tally/commands/pending — poll pending commands
    router.get('/api/integrations/tally/commands/pending', async (req, res, next) => {
        try {
            const auth = authenticate(req);
            if (!auth) {
                throw new AuthenticationError('Invalid token');
            }
            const commands = await deps.outboundService.listPendingCommands(auth.connectorId);
            res.status(200).json({
                commands: commands.map((c) => ({
                    id: c.id,
                    commandId: c.idempotencyKey,
                    command: 'PUSH_VOUCHERS',
                    type: 'PUSH_VOUCHERS',
                    payload: {
                        companyId: commandPayloadCompany(c.payload),
                        companyName: commandPayloadCompanyName(c.payload),
                        connectorId: c.connectorId,
                        vouchers: Array.isArray(c.payload) ? c.payload : [c.payload],
                    },
                })),
            });
        }
        catch (err) {
            next(err);
        }
    });
    // POST /api/integrations/tally/commands/ack — ack a command
    router.post('/api/integrations/tally/commands/ack', async (req, res, next) => {
        try {
            const auth = authenticate(req);
            if (!auth) {
                throw new AuthenticationError('Invalid token');
            }
            const body = z.object({
                commandId: z.string(),
                status: z.enum(['DONE', 'CANCELLED']),
                result: z.record(z.string(), z.unknown()).optional(),
            }).parse(req.body ?? {});
            let result = await deps.outboundService.ackCommand(body.commandId, body.status, body.result ?? {});
            if (!result.ok) {
                // Fallback: lookup by idempotencyKey
                const pending = await deps.outboundService.listPendingCommands(auth.connectorId);
                const byKey = pending.find((c) => c.idempotencyKey === body.commandId);
                if (byKey) {
                    result = await deps.outboundService.ackCommand(byKey.id, body.status, body.result ?? {});
                }
            }
            if (!result.ok) {
                throw new ConnectorError('Command not found', { statusCode: 404 });
            }
            res.status(200).json({ ok: true });
        }
        catch (err) {
            next(err);
        }
    });
    router.use((err, _req, res, _next) => {
        const status = structuredErrorStatus(err);
        const body = buildStructuredError(randId('req'), err);
        res.status(status).json(body);
    });
    return router;
}
function commandPayloadCompany(payload) {
    if (payload && typeof payload === 'object' && 'companyId' in payload) {
        return String(payload.companyId ?? '');
    }
    return undefined;
}
function commandPayloadCompanyName(payload) {
    if (payload && typeof payload === 'object' && 'companyName' in payload) {
        return String(payload.companyName ?? '');
    }
    return undefined;
}
