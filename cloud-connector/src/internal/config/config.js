import { z } from 'zod';
const envSchema = z.object({
    NODE_ENV: z.string().default('development'),
    PORT: z.string().default('8080'),
    APP_URL: z.string().url().default('http://localhost:8080'),
    HOST: z.string().default('0.0.0.0'),
    TRUST_PROXY: z.string().default('1'),
    LOG_LEVEL: z.string().default('info'),
    LOG_PRETTY: z.string().default('1'),
    DB_HOST: z.string().default('localhost'),
    DB_PORT: z.string().default('5432'),
    DB_USER: z.string().default('connector'),
    DB_PASSWORD: z.string().default(''),
    DB_NAME: z.string().default('connector_db'),
    DB_SSL: z.string().default('false'),
    DB_MAX_CONNECTIONS: z.string().default('10'),
    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: z.string().default('6379'),
    REDIS_PASSWORD: z.string().default(''),
    REDIS_DB: z.string().default('0'),
    REPO_DRIVER: z.string().default('inmemory'),
    CONNECTOR_BASE_URL: z.string().url().default('http://localhost:8080'),
    CONNECTOR_API_KEY: z.string().default(''),
    CONNECTOR_WEBHOOK_SECRET: z.string().default('dev-webhook-secret-change-in-production'),
    CONNECTOR_TIMEOUT_MS: z.string().default('30000'),
    CONNECTOR_MAX_RETRIES: z.string().default('5'),
    SYNC_INTERVAL_MINUTES: z.string().default('15'),
    SYNC_BATCH_SIZE: z.string().default('500'),
    TALLY_PUSH_ENABLED: z.string().default('true'),
    FEATURE_INBOUND: z.string().default('true'),
    FEATURE_OUTBOUND: z.string().default('true'),
    CORS_ORIGIN: z.string().default('http://localhost:3000,http://localhost:8080'),
    RATE_LIMIT_WINDOW_MS: z.string().default('60000'),
    RATE_LIMIT_MAX: z.string().default('100'),
    API_KEY: z.string().default(''),
    FEATURE_WEBHOOK_SIG_VERIFY: z.string().default('true'),
    REQUEST_ID_HEADER: z.string().default('x-request-id'),
});
export function loadConfig(env = process.env) {
    const parsed = envSchema.parse(env);
    const bool = (v) => v === '1' || v === 'true' || v === 'yes';
    const num = (v, def) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : def;
    };
    return {
        nodeEnv: parsed.NODE_ENV,
        port: num(parsed.PORT, 8080),
        appUrl: parsed.APP_URL,
        host: parsed.HOST,
        trustProxy: bool(parsed.TRUST_PROXY),
        logLevel: parsed.LOG_LEVEL,
        logPretty: bool(parsed.LOG_PRETTY),
        db: {
            host: parsed.DB_HOST,
            port: num(parsed.DB_PORT, 5432),
            user: parsed.DB_USER,
            password: parsed.DB_PASSWORD,
            name: parsed.DB_NAME,
            ssl: bool(parsed.DB_SSL),
            maxConnections: num(parsed.DB_MAX_CONNECTIONS, 10),
        },
        redis: {
            host: parsed.REDIS_HOST,
            port: num(parsed.REDIS_PORT, 6379),
            password: parsed.REDIS_PASSWORD,
            db: num(parsed.REDIS_DB, 0),
        },
        repoDriver: (parsed.REPO_DRIVER === 'postgres' ? 'postgres' : 'inmemory'),
        connector: {
            baseUrl: parsed.CONNECTOR_BASE_URL,
            apiKey: parsed.CONNECTOR_API_KEY,
            webhookSecret: parsed.CONNECTOR_WEBHOOK_SECRET,
            timeoutMs: num(parsed.CONNECTOR_TIMEOUT_MS, 30000),
            maxRetries: num(parsed.CONNECTOR_MAX_RETRIES, 5),
        },
        sync: {
            intervalMinutes: num(parsed.SYNC_INTERVAL_MINUTES, 15),
            batchSize: num(parsed.SYNC_BATCH_SIZE, 500),
            tallyPushEnabled: bool(parsed.TALLY_PUSH_ENABLED),
        },
        features: {
            inbound: bool(parsed.FEATURE_INBOUND),
            outbound: bool(parsed.FEATURE_OUTBOUND),
            webhookSigVerify: bool(parsed.FEATURE_WEBHOOK_SIG_VERIFY),
        },
        security: {
            corsOrigin: parsed.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean),
            rateLimitWindowMs: num(parsed.RATE_LIMIT_WINDOW_MS, 60000),
            rateLimitMax: num(parsed.RATE_LIMIT_MAX, 100),
            apiKey: parsed.API_KEY,
        },
        requestIdHeader: parsed.REQUEST_ID_HEADER,
    };
}
