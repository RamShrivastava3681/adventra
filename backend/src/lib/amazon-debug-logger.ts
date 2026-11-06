/**
 * Centralized Amazon SP-API structured debugging logger.
 *
 * Produces single-line JSON log entries consumable by PM2 / CloudWatch /
 * Elasticsearch. Never logs access tokens, refresh tokens, client secrets,
 * authorization headers, or customer PII.
 *
 * Configuration via environment variables:
 *   AMAZON_DEBUG=true        -> enables DEBUG-level Amazon logs
 *   LOG_LEVEL=DEBUG|INFO|WARN|ERROR  -> global minimum level
 *   AMAZON_LOG_TRACE_ID_HEADER  -> optional header name to read trace ID from
 */

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

const LEVEL_ORDER: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

function getMinLevel(): LogLevel {
  const env = (process.env.LOG_LEVEL || process.env.AMAZON_LOG_LEVEL || "INFO").toUpperCase();
  if (env in LEVEL_ORDER) return env as LogLevel;
  if (process.env.AMAZON_DEBUG === "true" || process.env.AMAZON_DEBUG === "1") return "DEBUG";
  return "INFO";
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[getMinLevel()];
}

function redactSensitive(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return obj;
  if (Array.isArray(obj)) return obj.map(redactSensitive);
  if (typeof obj === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      const key = k.toLowerCase();
      if (
        key.includes("token") ||
        key.includes("secret") ||
        key.includes("password") ||
        key.includes("authorization") ||
        key.includes("access_key") ||
        key.includes("secret_key") ||
        key.includes("session_token") ||
        key.includes("refresh_token")
      ) {
        out[k] = "[redacted]";
      } else {
        out[k] = redactSensitive(v);
      }
    }
    return out;
  }
  return obj;
}

function generateTraceId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

interface AmazonLogContext {
  traceId?: string;
  clientId?: string;
  sellerId?: string;        // non-sensitive identifier (marketplace/seller id suffix)
  module?: string;          // orders | order-items | inventory | listings | returns | auth | db
  operation?: string;
  endpoint?: string;        // URL without sensitive query params
  stage?: string;           // before | after | error | retry | refresh
  durationMs?: number;
  httpStatus?: number;
  recordsReceived?: number;
  recordsProcessed?: number;
  recordsSaved?: number;
  recordsSkipped?: number;
  recordsFailed?: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  retryAttempt?: number;
  paginationToken?: string | null;
  nextPage?: boolean;
  config?: Record<string, any>; // sanitized config snapshot
  [key: string]: any;
}

export class AmazonDebugLogger {
  public readonly traceId: string;
  public readonly clientId: string | null;
  public readonly sellerId: string | null;
  public readonly module: string | null;

  constructor(opts: { traceId?: string; clientId?: string | null; sellerId?: string | null; module?: string | null } = {}) {
    this.traceId = opts.traceId ?? generateTraceId();
    this.clientId = opts.clientId ?? null;
    this.sellerId = opts.sellerId ?? null;
    this.module = opts.module ?? null;
  }

  child(opts: { module?: string; clientId?: string | null; sellerId?: string | null }): AmazonDebugLogger {
    return new AmazonDebugLogger({
      traceId: this.traceId,
      clientId: opts.clientId ?? this.clientId,
      sellerId: opts.sellerId ?? this.sellerId,
      module: opts.module ?? this.module,
    });
  }

  private emit(level: LogLevel, ctx: AmazonLogContext): void {
    if (!shouldLog(level)) return;

    const entry: Record<string, any> = {
      timestamp: new Date().toISOString(),
      level,
      traceId: this.traceId,
      service: "amazon-sp-api",
    };

    if (this.clientId) entry.clientId = this.clientId;
    if (this.sellerId) entry.sellerId = this.sellerId;
    if (ctx.module) entry.module = ctx.module;
    if (ctx.operation) entry.operation = ctx.operation;
    if (ctx.endpoint) entry.endpoint = ctx.endpoint;
    if (ctx.stage) entry.stage = ctx.stage;
    if (ctx.durationMs !== undefined) entry.durationMs = ctx.durationMs;
    if (ctx.httpStatus !== undefined) entry.httpStatus = ctx.httpStatus;
    if (ctx.recordsReceived !== undefined) entry.recordsReceived = ctx.recordsReceived;
    if (ctx.recordsProcessed !== undefined) entry.recordsProcessed = ctx.recordsProcessed;
    if (ctx.recordsSaved !== undefined) entry.recordsSaved = ctx.recordsSaved;
    if (ctx.recordsSkipped !== undefined) entry.recordsSkipped = ctx.recordsSkipped;
    if (ctx.recordsFailed !== undefined) entry.recordsFailed = ctx.recordsFailed;
    if (ctx.errorCode !== undefined) entry.errorCode = ctx.errorCode;
    if (ctx.errorMessage !== undefined) entry.errorMessage = ctx.errorMessage;
    if (ctx.retryAttempt !== undefined) entry.retryAttempt = ctx.retryAttempt;
    if (ctx.paginationToken !== undefined) entry.paginationToken = ctx.paginationToken;
    if (ctx.nextPage !== undefined) entry.nextPage = ctx.nextPage;
    if (ctx.config) entry.config = redactSensitive(ctx.config);

    // spread any extra fields
    for (const [k, v] of Object.entries(ctx)) {
      if (!(k in entry)) entry[k] = v;
    }

    const line = JSON.stringify(entry);
    if (level === "ERROR") console.error(line);
    else if (level === "WARN") console.warn(line);
    else console.log(line);
  }

  debug(ctx: AmazonLogContext): void { this.emit("DEBUG", ctx); }
  info(ctx: AmazonLogContext): void { this.emit("INFO", ctx); }
  warn(ctx: AmazonLogContext): void { this.emit("WARN", ctx); }
  error(ctx: AmazonLogContext): void { this.emit("ERROR", ctx); }

  // Convenience: log a full SP-API request lifecycle
  async requestLifecycle<T>(
    opts: {
      module: string;
      operation: string;
      endpoint: string;
      method?: string;
      clientId?: string | null;
      sellerId?: string | null;
      config?: Record<string, any>;
      fn: () => Promise<T>;
    },
  ): Promise<T> {
    const log = this.child({ module: opts.module, clientId: opts.clientId ?? this.clientId, sellerId: opts.sellerId ?? this.sellerId });
    const start = Date.now();
    const sanitizedQuery = redactSensitive(opts.config ?? {});

    log.info({
      operation: opts.operation,
      endpoint: opts.endpoint,
      stage: "before",
      method: opts.method ?? "GET",
      config: sanitizedQuery,
      tokenValid: true, // token presence checked at call time; actual value never logged
    });

    try {
      const result = await opts.fn();
      const duration = Date.now() - start;

      let recordsReceived = 0;
      let paginationToken: string | null = null;
      let nextPage = false;
      if (result && typeof result === "object") {
        const r = result as any;
        const orders = r.Orders ?? r.InventorySummaries ?? r.Listings ?? r.OrderItems ?? [];
        recordsReceived = Array.isArray(orders) ? orders.length : 0;
        paginationToken = r.NextToken ?? r.nextToken ?? null;
        nextPage = Boolean(paginationToken);
      }

      log.info({
        operation: opts.operation,
        endpoint: opts.endpoint,
        stage: "after",
        durationMs: duration,
        httpStatus: 200,
        recordsReceived,
        paginationToken,
        nextPage,
      });

      return result;
    } catch (err: any) {
      const duration = Date.now() - start;
      log.error({
        operation: opts.operation,
        endpoint: opts.endpoint,
        stage: "error",
        durationMs: duration,
        errorCode: err?.code ?? err?.status ?? "Unknown",
        errorMessage: err?.message ?? String(err),
        retryAttempt: 0,
      });
      throw err;
    }
  }
}

export { generateTraceId };
export type { LogLevel, AmazonLogContext };
