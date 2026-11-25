import { gunzipSync } from "zlib";
import { config } from "../config.js";
import { AmazonDebugLogger, generateTraceId } from "../lib/amazon-debug-logger.js";
import { validateMarketplaceConfig, getSigningConfig } from "../lib/amazon-marketplace-config.js";
import { classifyError } from "../lib/amazon-error-classification.js";

type Json = Record<string, any>;

interface TokenCache {
  accessToken: string | null;
  expiresAt: number; // epoch ms
  refreshing: Promise<string> | null;
  refreshCount: number;
  lastRefreshAt: number | null;
  lastRefreshError: string | null;
}

interface RateLimitState {
  lastCall: number;
  minIntervalMs: number;
  totalCalls: number;
  totalDelayedMs: number;
}

// SP-API rate limits (requests per second) per operation group.
// Conservative defaults; Amazon returns x-amzn-RateLimit-Limit/Retry-After
// headers which override these where available.
const OPERATION_RATE_LIMITS: Record<string, number> = {
  getOrders: 1,
  getOrderItems: 1,
  getOrderItemsByOrderId: 1,
  getListingsItems: 1,
  getCatalogItem: 1,
  getInventorySummaries: 1,
  getReports: 1,
  getReport: 1,
  getReportDocument: 1,
  createReport: 1,
  default: 1,
};

// Cached marketplace config validation (validated once per process).
let _marketplaceValidation: Awaited<ReturnType<typeof validateMarketplaceConfig>> | null = null;

function getMarketplaceValidation() {
  if (!_marketplaceValidation) {
    _marketplaceValidation = validateMarketplaceConfig();
  }
  return _marketplaceValidation;
}

/**
 * SP-API response helpers. Orders v0 and FBA Inventory v1 wrap their data in `payload`
 * ({ payload: { Orders, NextToken } }); Listings Items 2021-08-01 returns it at the top level
 * ({ items, pagination }). Always read responses through these.
 */
export function spApiBody(resp: any): any {
  return resp?.payload ?? resp ?? {};
}

/** Next-page token wherever the API puts it (payload.NextToken, pagination.nextToken, …). */
export function spApiNextToken(resp: any): string | null {
  return resp?.payload?.NextToken ?? resp?.NextToken ?? resp?.pagination?.nextToken ?? resp?.nextToken ?? null;
}

/** The record list of any SP-API response shape (orders, order items, inventory, listings). */
export function spApiRecords(resp: any): any[] {
  const body = spApiBody(resp);
  const list = body.Orders ?? body.OrderItems ?? body.inventorySummaries ?? body.InventorySummaries ?? resp?.items ?? body.Listings;
  return Array.isArray(list) ? list : [];
}

/**
 * Amazon Selling Partner API (SP-API) client.
 *
 * Authenticates via Login with Amazon (LWA) using the refresh_token grant.
 * All SP-API calls carry the LWA access token as a Bearer token.
 *
 * Implements:
 * - Access token caching + automatic refresh on 401
 * - Per-operation rate limiting (token-bucket style, min interval between calls)
 * - Exponential backoff retry on 429 / 503 / transient errors
 * - Idempotency-key support where the operation allows it
 * - Structured debug logging for every lifecycle stage
 *
 * Secrets (client secret, refresh token) are read from env only and are never
 * returned to the frontend or logged.
 */
export class AmazonSpApiService {
  private readonly endpoint: string;
  private readonly marketplaceId: string;
  private readonly region: string;
  private token: TokenCache = {
    accessToken: null,
    expiresAt: 0,
    refreshing: null,
    refreshCount: 0,
    lastRefreshAt: null,
    lastRefreshError: null,
  };
  private readonly rateLimits = new Map<string, RateLimitState>();
  private readonly log: AmazonDebugLogger;

  constructor() {
    this.log = new AmazonDebugLogger({ module: "auth" });
    if (!config.amazon.isConfigured) {
      this.log.warn({
        operation: "constructor",
        stage: "config-check",
        errorCode: "NotConfigured",
        errorMessage:
          "Amazon SP-API is not configured. Set AMAZON_CLIENT_ID, AMAZON_CLIENT_SECRET and AMAZON_REFRESH_TOKEN.",
      });
    }
    if (!config.amazon.marketplaceId) {
      this.log.warn({
        operation: "constructor",
        stage: "config-check",
        errorCode: "NotConfigured",
        errorMessage:
          "Amazon SP-API marketplace is not configured. Set AMAZON_MARKETPLACE_ID.",
      });
    }
    this.endpoint = config.amazon.spapiEndpoint;
    this.marketplaceId = config.amazon.marketplaceId;
    this.region = config.amazon.region;
  }

  /** Returns the configured marketplace IDs array, or throws a clear error if none is set. */
  private requireMarketplaceIds(): string[] {
    if (!this.marketplaceId) {
      const err = new Error(
        "Amazon SP-API marketplace is not configured: AMAZON_MARKETPLACE_ID must be set.",
      );
      this.log.error({
        operation: "requireMarketplaceIds",
        stage: "error",
        errorCode: "NotConfigured",
        errorMessage: err.message,
      });
      throw err;
    }
    return [this.marketplaceId];
  }

  // ──────────────────────────────────────────────────────────────────────────
  // LWA access token (instrumented)
  // ──────────────────────────────────────────────────────────────────────────

  private isConfigured(): boolean {
    return Boolean(config.amazon.isConfigured);
  }

  private async fetchAccessToken(): Promise<string> {
    const { clientId, clientSecret, refreshToken, lwaEndpoint } = config.amazon;
    if (!clientId || !clientSecret || !refreshToken) {
      const err = new Error(
        "Amazon SP-API is not configured: AMAZON_CLIENT_ID, AMAZON_CLIENT_SECRET and AMAZON_REFRESH_TOKEN must be set.",
      );
      this.log.error({
        operation: "fetchAccessToken",
        endpoint: lwaEndpoint,
        stage: "error",
        errorCode: "NotConfigured",
        errorMessage: err.message,
      });
      throw err;
    }

    const start = Date.now();
    this.log.info({
      operation: "fetchAccessToken",
      endpoint: lwaEndpoint,
      stage: "before",
      retryAttempt: this.token.refreshCount,
      tokenValid: Boolean(this.token.accessToken && Date.now() < this.token.expiresAt),
      config: {
        hasClientId: Boolean(clientId),
        hasClientSecret: Boolean(clientSecret),
        hasRefreshToken: Boolean(refreshToken),
        lwaEndpoint,
        grantType: "refresh_token",
      },
    });

    try {
      const res = await fetch(lwaEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
          scope: "sellingpartnerapi::notifications",
        }),
      });

      const duration = Date.now() - start;

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const err = new Error(`LWA token request failed (${res.status}): ${text.slice(0, 500)}`);
        this.log.error({
          operation: "fetchAccessToken",
          endpoint: lwaEndpoint,
          stage: "error",
          durationMs: duration,
          httpStatus: res.status,
          errorCode: String(res.status),
          errorMessage: err.message,
          retryAttempt: this.token.refreshCount,
        });
        throw err;
      }

      const data = (await res.json()) as {
        access_token?: string;
        expires_in?: number;
        refresh_token?: string;
      };
      if (!data.access_token) {
        const err = new Error("LWA token response did not include an access_token");
        this.log.error({
          operation: "fetchAccessToken",
          endpoint: lwaEndpoint,
          stage: "error",
          durationMs: duration,
          httpStatus: res.status,
          errorCode: "MissingAccessToken",
          errorMessage: err.message,
        });
        throw err;
      }

      const ttl = Number(data.expires_in || 3600) * 1000;
      const now = Date.now();
      this.token = {
        accessToken: data.access_token,
        expiresAt: now + ttl - 60_000, // refresh 60s before actual expiry
        refreshing: null,
        refreshCount: this.token.refreshCount + 1,
        lastRefreshAt: now,
        lastRefreshError: null,
      };

      this.log.info({
        operation: "fetchAccessToken",
        endpoint: lwaEndpoint,
        stage: "after",
        durationMs: duration,
        httpStatus: res.status,
        recordsReceived: 1,
        config: {
          expiresIn: data.expires_in,
          refreshCount: this.token.refreshCount,
          tokenValidForMs: ttl,
        },
      });

      return data.access_token;
    } catch (err: any) {
      this.token.lastRefreshError = err?.message ?? String(err);
      throw err;
    }
  }

  async getAccessToken(): Promise<string> {
    const now = Date.now();
    const valid = Boolean(this.token.accessToken && now < this.token.expiresAt);

    this.log.debug({
      operation: "getAccessToken",
      stage: "before",
      tokenValid: valid,
      refreshCount: this.token.refreshCount,
      lastRefreshError: this.token.lastRefreshError,
      expiresAt: this.token.expiresAt ? new Date(this.token.expiresAt).toISOString() : null,
      now: new Date(now).toISOString(),
    });

    if (valid) {
      return this.token.accessToken!;
    }
    // Only one refresh in flight at a time — prevents concurrent requests
    // from triggering unnecessary token refresh operations.
    if (this.token.refreshing) {
      this.log.info({
        operation: "getAccessToken",
        stage: "before",
        tokenValid: false,
        refreshingInFlight: true,
        retryAttempt: this.token.refreshCount,
      });
      return this.token.refreshing;
    }
    this.token.refreshing = this.fetchAccessToken();
    try {
      return await this.token.refreshing;
    } finally {
      this.token.refreshing = null;
    }
  }

  /** Returns sanitized token-state summary for diagnostics (no secrets). */
  getTokenState(): {
    configured: boolean;
    hasAccessToken: boolean;
    tokenValid: boolean;
    refreshCount: number;
    lastRefreshAt: string | null;
    lastRefreshError: string | null;
    expiresAt: string | null;
    refreshing: boolean;
  } {
    const now = Date.now();
    return {
      configured: this.isConfigured(),
      hasAccessToken: Boolean(this.token.accessToken),
      tokenValid: Boolean(this.token.accessToken && now < this.token.expiresAt),
      refreshCount: this.token.refreshCount,
      lastRefreshAt: this.token.lastRefreshAt ? new Date(this.token.lastRefreshAt).toISOString() : null,
      lastRefreshError: this.token.lastRefreshError ?? null,
      expiresAt: this.token.expiresAt ? new Date(this.token.expiresAt).toISOString() : null,
      refreshing: Boolean(this.token.refreshing),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Rate limiting (instrumented)
  // ──────────────────────────────────────────────────────────────────────────

  private rateLimitMs(operation: string): number {
    const rps = OPERATION_RATE_LIMITS[operation] ?? OPERATION_RATE_LIMITS.default;
    return Math.max(100, Math.round(1000 / rps));
  }

  private async enforceRateLimit(operation: string, log: AmazonDebugLogger): Promise<void> {
    const minInterval = this.rateLimitMs(operation);
    const state = this.rateLimits.get(operation) ?? {
      lastCall: 0,
      minIntervalMs: minInterval,
      totalCalls: 0,
      totalDelayedMs: 0,
    };
    state.minIntervalMs = minInterval;
    state.totalCalls += 1;
    const now = Date.now();
    const elapsed = now - state.lastCall;
    let delayedMs = 0;
    if (elapsed < minInterval) {
      delayedMs = minInterval - elapsed;
      state.totalDelayedMs += delayedMs;
      await new Promise((resolve) => setTimeout(resolve, delayedMs));
    }
    state.lastCall = Date.now();
    this.rateLimits.set(operation, state);

    if (delayedMs > 0) {
      log.debug({
        operation,
        stage: "rate-limit",
        durationMs: delayedMs,
        config: { minInterval, totalCalls: state.totalCalls, totalDelayedMs: state.totalDelayedMs },
      });
    }
  }

  /** Returns per-operation rate-limit stats for diagnostics. */
  getRateLimitStats(): Record<string, { totalCalls: number; totalDelayedMs: number; minIntervalMs: number }> {
    const out: Record<string, { totalCalls: number; totalDelayedMs: number; minIntervalMs: number }> = {};
    for (const [op, st] of this.rateLimits.entries()) {
      out[op] = { totalCalls: st.totalCalls, totalDelayedMs: st.totalDelayedMs, minIntervalMs: st.minIntervalMs };
    }
    return out;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Core SP-API request (instrumented)
  // ──────────────────────────────────────────────────────────────────────────

  async request<T = any>({
    operation,
    method = "GET",
    path,
    query,
    body,
    idempotencyKey,
    maxRetries = 5,
    traceId,
    clientId,
    sellerId,
    module,
  }: {
    operation: string;
    method?: string;
    path: string;
    query?: Record<string, string | number | boolean | undefined>;
    body?: any;
    idempotencyKey?: string;
    maxRetries?: number;
    traceId?: string;
    clientId?: string | null;
    sellerId?: string | null;
    module?: string;
  }): Promise<T> {
    const log = new AmazonDebugLogger({
      traceId,
      clientId: clientId ?? this.log.clientId ?? null,
      sellerId: sellerId ?? this.log.sellerId ?? null,
    }).child({ module: module ?? operation, clientId, sellerId });

    if (!this.isConfigured()) {
      log.error({
        operation,
        endpoint: path,
        stage: "error",
        errorCode: "NotConfigured",
        errorMessage:
          "Amazon SP-API is not configured. Set AMAZON_CLIENT_ID, AMAZON_CLIENT_SECRET and AMAZON_REFRESH_TOKEN.",
      });
      throw new Error(
        "Amazon SP-API is not configured. Set AMAZON_CLIENT_ID, AMAZON_CLIENT_SECRET and AMAZON_REFRESH_TOKEN.",
      );
    }

    // Validate marketplace-region configuration (fail fast with clear error).
    const mv = getMarketplaceValidation();
    if (!mv.valid) {
      log.error({
        operation,
        endpoint: path,
        stage: "error",
        errorCode: "ConfigurationInvalid",
        errorMessage: mv.errors.join("; "),
        config: { errors: mv.errors, warnings: mv.warnings },
      });
      throw new Error(`Amazon SP-API configuration invalid: ${mv.errors.join("; ")}`);
    }

    // Log signing configuration for every request (no secrets).
    const signing = getSigningConfig();
    if (signing) {
      log.debug({
        operation,
        endpoint: path,
        stage: "signing",
        config: {
          service: signing.service,
          signingRegion: signing.region,
          host: signing.host,
          method,
          path,
        },
      });
    }

    await this.enforceRateLimit(operation, log);

    const accessToken = await this.getAccessToken();
    const url = new URL(`${this.endpoint}${path}`);
    const sanitizedQuery: Record<string, any> = {};
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null || v === "") continue;
        // Attach actual query parameters to the URL so Amazon receives them.
        url.searchParams.set(k, String(v));
        // Do not log potentially sensitive query values raw; mark presence only.
        sanitizedQuery[k] = typeof v === "string" && v.length > 0 ? `[present:${v.length}]` : v;
      }
    }

    const start = Date.now();
    log.info({
      operation,
      endpoint: path,
      method,
      stage: "before",
      config: { ...sanitizedQuery, idempotencyKey: idempotencyKey ? "[present]" : undefined },
      tokenValid: true,
    });

    // Final request URL logging — safe, no credentials or buyer data.
    log.info({
      operation,
      endpoint: path,
      stage: "final-request-url",
      config: {
        queryKeys: query ? Object.keys(query) : [],
        queryString: url.searchParams.toString(),
        url: url.origin + url.pathname,
      },
    });

    const headers: Record<string, string> = {
      Authorization: "Bearer [redacted]",
      "x-amz-access-token": "[redacted]",
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    const realHeaders: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "x-amz-access-token": accessToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (idempotencyKey) realHeaders["x-amz-idempotency-key"] = idempotencyKey;

    let lastError: any = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(url.toString(), {
          method,
          headers: realHeaders,
          body: body ? JSON.stringify(body) : undefined,
        });

        const duration = Date.now() - start;
        const retryAfter = res.headers.get("retry-after") || res.headers.get("x-amzn-RateLimit-Retry-After");
        const rateLimitLimit = res.headers.get("x-amzn-RateLimit-Limit");

        if (res.status === 401) {
          log.warn({
            operation,
            endpoint: path,
            stage: "retry",
            durationMs: duration,
            httpStatus: res.status,
            errorCode: "AuthError",
            errorMessage: "401 Unauthorized — forcing token refresh",
            retryAttempt: attempt,
          });
          // Token may have expired; force refresh and retry once.
          this.token = {
            ...this.token,
            accessToken: null,
            expiresAt: 0,
            refreshing: null,
          };
          const freshToken = await this.getAccessToken();
          realHeaders.Authorization = `Bearer ${freshToken}`;
          realHeaders["x-amz-access-token"] = freshToken;
          continue;
        }

        if (res.status === 429 || res.status === 503) {
          const retryAfterSec = retryAfter ? parseInt(retryAfter, 10) : null;
          const backoffMs = retryAfterSec ? retryAfterSec * 1000 : Math.min(1000 * 2 ** attempt, 30_000);
          log.warn({
            operation,
            endpoint: path,
            stage: "retry",
            durationMs: duration,
            httpStatus: res.status,
            errorCode: res.status === 429 ? "RateLimited" : "ServiceUnavailable",
            errorMessage: `SP-API throttled (${res.status}), retrying in ${backoffMs}ms`,
            retryAttempt: attempt,
            config: {
              retryAfterHeader: retryAfter,
              rateLimitLimit,
              backoffMs,
            },
          });
          lastError = new Error(`SP-API throttled (${res.status}), retrying in ${backoffMs}ms`);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }

        if (res.status >= 500 && attempt < maxRetries) {
          const backoffMs = Math.min(1000 * 2 ** attempt, 30_000);
          log.warn({
            operation,
            endpoint: path,
            stage: "retry",
            durationMs: duration,
            httpStatus: res.status,
            errorCode: `ServerError${res.status}`,
            errorMessage: `SP-API server error (${res.status}), retrying in ${backoffMs}ms`,
            retryAttempt: attempt,
            config: { backoffMs },
          });
          lastError = new Error(`SP-API server error (${res.status}), retrying`);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          const err = new Error(`SP-API ${method} ${path} failed (${res.status}): ${text.slice(0, 500)}`);
          const classified = classifyError(err, res.headers, text.slice(0, 200));
          Object.assign(err, {
            status: res.status,
            amazonRequestId: classified.amazonRequestId,
          });
          // Attach classification so the catch block knows if this is retryable
          Object.defineProperty(err, 'classified', { value: classified, enumerable: false, writable: false });
          log.error({
            operation,
            endpoint: path,
            stage: "error",
            durationMs: duration,
            httpStatus: res.status,
            errorCode: classified.classification,
            errorMessage: classified.message,
            amazonErrorCode: classified.amazonErrorCode,
            amazonRequestId: classified.amazonRequestId,
            retryable: classified.retryable,
            retryAttempt: attempt,
          });
          throw err;
        }

        const contentType = res.headers.get("content-type") || "";
        let result: any;
        if (contentType.includes("application/json")) {
          result = await res.json();
        } else {
          result = await res.text();
        }

        let recordsReceived = 0;
        let paginationToken: string | null = null;
        let nextPage = false;
        if (result && typeof result === "object" && !Array.isArray(result) && typeof result !== "string") {
          recordsReceived = spApiRecords(result).length;
          paginationToken = spApiNextToken(result);
          nextPage = Boolean(paginationToken);
        }

        log.info({
          operation,
          endpoint: path,
          stage: "after",
          durationMs: duration,
          httpStatus: res.status,
          recordsReceived,
          paginationToken,
          nextPage,
          config: {
            rateLimitLimit,
            retryAfterHeader: retryAfter,
          },
        });

        return result as T;
      } catch (err: any) {
        lastError = err;
        const duration = Date.now() - start;
        // Get classification - either from attached property or classify fresh
        const classified = err?.classified ?? classifyError(err, undefined, undefined);

        // Don't retry non-transient errors (400, 403, permanent failures)
        if (!classified.retryable) {
          log.error({
            operation,
            endpoint: path,
            stage: "error",
            durationMs: duration,
            errorCode: classified.classification,
            errorMessage: classified.message,
            amazonErrorCode: classified.amazonErrorCode,
            amazonRequestId: classified.amazonRequestId,
            retryable: false,
            retryAttempt: attempt,
          });
          throw err;
        }

        // Don't retry "not configured" errors
        if (err.message && err.message.includes("not configured")) {
          log.error({
            operation,
            endpoint: path,
            stage: "error",
            durationMs: duration,
            errorCode: "NotConfigured",
            errorMessage: err.message,
            retryAttempt: attempt,
          });
          throw err;
        }

        if (attempt >= maxRetries) {
          log.error({
            operation,
            endpoint: path,
            stage: "error",
            durationMs: duration,
            errorCode: classified.classification,
            errorMessage: classified.message,
            retryable: false,
            retryAttempt: attempt,
          });
          break;
        }

        // Exponential backoff with jitter for retryable errors (429, 5xx, network)
        const backoffMs = Math.min(1000 * 2 ** attempt, 30_000);
        const jitterMs = Math.floor(Math.random() * 1000);
        log.warn({
          operation,
          endpoint: path,
          stage: "retry",
          durationMs: duration,
          httpStatus: classified.httpStatus,
          errorCode: classified.classification,
          errorMessage: classified.message,
          retryable: true,
          retryAttempt: attempt,
          config: { backoffMs, jitterMs },
        });
        lastError = new Error(`SP-API retryable error, retrying in ${backoffMs + jitterMs}ms`);
        await new Promise((resolve) => setTimeout(resolve, backoffMs + jitterMs));
      }
    }

    throw lastError || new Error(`SP-API request failed after ${maxRetries + 1} attempts`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Orders API (instrumented)
  // ──────────────────────────────────────────────────────────────────────────

  async getOrders({
    createdAfter,
    lastUpdatedAfter,
    marketplaceIds = this.requireMarketplaceIds(),
    orderStatuses,
    nextToken,
    maxResults = 100,
    traceId,
    clientId,
    sellerId,
  }: {
    createdAfter?: string;
    lastUpdatedAfter?: string;
    marketplaceIds?: string[];
    orderStatuses?: string[];
    nextToken?: string;
    maxResults?: number;
    traceId?: string;
    clientId?: string | null;
    sellerId?: string | null;
  }) {
    const log = new AmazonDebugLogger({ traceId, clientId, sellerId }).child({
      module: "orders",
      clientId,
      sellerId,
    });

    log.info({
      operation: "getOrders",
      endpoint: "/orders/v0/orders",
      stage: "before",
      config: {
        marketplaceIdsCount: marketplaceIds.length,
        lastUpdatedAfter,
        createdAfter,
        orderStatusesCount: orderStatuses?.length ?? 0,
        nextToken: nextToken ? "[present]" : null,
        maxResults,
      },
    });

    // ORDERS_REQUEST_PARAMS — safe diagnostic log (no credentials or buyer data)
    const firstMarketplaceId = marketplaceIds && marketplaceIds.length > 0 ? marketplaceIds[0] : null;
    log.info({
      operation: "getOrders",
      endpoint: "/orders/v0/orders",
      stage: "request-params",
      config: {
        marketplaceIdPresent: Boolean(firstMarketplaceId),
        marketplaceIdLength: firstMarketplaceId ? firstMarketplaceId.length : 0,
        marketplaceIdValue: firstMarketplaceId ? `[present:${firstMarketplaceId.length}]` : null,
        marketplaceIdsPresent: Boolean(marketplaceIds && marketplaceIds.length > 0),
        marketplaceIdsCount: marketplaceIds ? marketplaceIds.length : 0,
        sellerIdPresent: Boolean(sellerId),
        sellerIdLength: sellerId ? sellerId.length : 0,
        lastUpdatedAfter: lastUpdatedAfter ?? null,
        sdkPropertyName: "MarketplaceIds", // Orders API v0 expects capital M, plural
      },
    });

    const query: Record<string, any> = {
      MarketplaceIds: marketplaceIds.join(","),
      MaxResults: String(maxResults),
    };
    if (createdAfter) query.CreatedAfter = createdAfter;
    if (lastUpdatedAfter) query.LastUpdatedAfter = lastUpdatedAfter;
    if (orderStatuses?.length) query.OrderStatuses = orderStatuses.join(",");
    if (nextToken) query.NextToken = nextToken;

    const result = await this.request({
      operation: "getOrders",
      path: "/orders/v0/orders",
      query,
      traceId,
      clientId,
      sellerId,
      module: "orders",
    });

    log.info({
      operation: "getOrders",
      endpoint: "/orders/v0/orders",
      stage: "after",
      config: {
        nextToken: spApiNextToken(result) ? "[present]" : null,
      },
    });

    return result;
  }

  async getOrderItems({
    amazonOrderId,
    traceId,
    clientId,
    sellerId,
  }: {
    amazonOrderId: string;
    traceId?: string;
    clientId?: string | null;
    sellerId?: string | null;
  }) {
    const log = new AmazonDebugLogger({ traceId, clientId, sellerId }).child({
      module: "order-items",
      clientId,
      sellerId,
    });

    log.info({
      operation: "getOrderItems",
      endpoint: "/orders/v0/orders/{orderId}/orderItems",
      stage: "before",
      config: { amazonOrderId },
    });

    const result = await this.request({
      operation: "getOrderItems",
      path: `/orders/v0/orders/${encodeURIComponent(amazonOrderId)}/orderItems`,
      query: {},
      traceId,
      clientId,
      sellerId,
      module: "order-items",
    });

    log.info({
      operation: "getOrderItems",
      endpoint: "/orders/v0/orders/{orderId}/orderItems",
      stage: "after",
      config: { amazonOrderId },
    });

    return result;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Listings Items API (instrumented)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Listings Items API v2021-08-01 — searchListingsItems:
   * GET /listings/2021-08-01/items/{sellerId}. `sellerId` is the seller's Merchant Token
   * (AMAZON_SELLER_ID), not the marketplace ID. Returns { numberOfResults, pagination: { nextToken }, items }.
   */
  async getListingsItems({
    marketplaceIds = this.requireMarketplaceIds(),
    sellerSkus,
    asins,
    nextToken,
    maxResults = 20,
    traceId,
    clientId,
    sellerId,
  }: {
    marketplaceIds?: string[];
    sellerSkus?: string[];
    asins?: string[];
    nextToken?: string;
    maxResults?: number;
    traceId?: string;
    clientId?: string | null;
    sellerId?: string | null;
  }) {
    const log = new AmazonDebugLogger({ traceId, clientId, sellerId }).child({
      module: "listings",
      clientId,
      sellerId,
    });
    const endpoint = "/listings/2021-08-01/items/{sellerId}";

    if (!marketplaceIds || marketplaceIds.length === 0 || !sellerId) {
      const err = new Error(
        !sellerId
          ? "AMAZON_SELLER_ID (the seller's Merchant Token) is required for getListingsItems"
          : "marketplaceIds is required for getListingsItems",
      );
      log.error({
        operation: "getListingsItems",
        endpoint,
        stage: "error",
        errorCode: "MissingRequiredParameter",
        errorMessage: err.message,
      });
      throw err;
    }

    // searchListingsItems allows at most 20 items per page.
    const pageSize = Math.min(Math.max(1, maxResults), 20);
    log.info({
      operation: "getListingsItems",
      endpoint,
      stage: "before",
      config: {
        marketplaceIdsCount: marketplaceIds.length,
        marketplaceIdsPresent: Boolean(marketplaceIds && marketplaceIds.length > 0),
        sellerSkusCount: sellerSkus?.length ?? 0,
        asinsCount: asins?.length ?? 0,
        nextToken: nextToken ? "[present]" : null,
        pageSize,
      },
    });

    const query: Record<string, any> = {
      marketplaceIds: marketplaceIds.join(","),
      includedData: "summaries,attributes,offers,fulfillmentAvailability,issues",
      pageSize: String(pageSize),
    };
    if (sellerSkus?.length) {
      query.identifiers = sellerSkus.join(",");
      query.identifiersType = "SKU";
    } else if (asins?.length) {
      query.identifiers = asins.join(",");
      query.identifiersType = "ASIN";
    }
    if (nextToken) query.pageToken = nextToken;

    const path = `/listings/2021-08-01/items/${encodeURIComponent(sellerId)}`;
    const url = new URL(`${this.endpoint}${path}`);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }

    log.info({
      operation: "getListingsItems",
      endpoint,
      stage: "final-request-url",
      config: {
        queryKeys: Object.keys(query),
        queryString: url.searchParams.toString(),
        url: url.origin + endpoint,
      },
    });

    const result = await this.request({
      operation: "getListingsItems",
      path,
      query,
      traceId,
      clientId,
      sellerId,
      module: "listings",
    });

    log.info({
      operation: "getListingsItems",
      endpoint,
      stage: "after",
      config: { nextToken: spApiNextToken(result) ? "[present]" : null },
    });

    return result;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Catalog Items API (instrumented)
  // ──────────────────────────────────────────────────────────────────────────

  async getCatalogItem({
    asin,
    marketplaceIds = this.requireMarketplaceIds(),
    traceId,
    clientId,
    sellerId,
  }: {
    asin: string;
    marketplaceIds?: string[];
    traceId?: string;
    clientId?: string | null;
    sellerId?: string | null;
  }) {
    return this.request({
      operation: "getCatalogItem",
      path: `/catalog/2022-04-01/items/${encodeURIComponent(asin)}`,
      query: {
        MarketplaceIds: marketplaceIds.join(","),
        InclusionOptions: "summaries,attributes,images",
      },
      traceId,
      clientId,
      sellerId,
      module: "catalog",
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FBA Inventory API (instrumented)
  // ──────────────────────────────────────────────────────────────────────────

  async getInventorySummaries({
    marketplaceIds = this.requireMarketplaceIds(),
    nextToken,
    maxResults = 100,
    queryDetails = true,
    traceId,
    clientId,
    sellerId,
  }: {
    marketplaceIds?: string[];
    nextToken?: string;
    maxResults?: number;
    queryDetails?: boolean;
    traceId?: string;
    clientId?: string | null;
    sellerId?: string | null;
  }) {
    const log = new AmazonDebugLogger({ traceId, clientId, sellerId }).child({
      module: "inventory",
      clientId,
      sellerId,
    });

    if (!marketplaceIds || marketplaceIds.length === 0) {
      const err = new Error("marketplaceIds is required for getInventorySummaries");
      log.error({
        operation: "getInventorySummaries",
        endpoint: "/fba/inventory/v1/summaries",
        stage: "error",
        errorCode: "MissingRequiredParameter",
        errorMessage: err.message,
      });
      throw err;
    }

    log.info({
      operation: "getInventorySummaries",
      endpoint: "/fba/inventory/v1/summaries",
      stage: "before",
      config: {
        marketplaceIdsCount: marketplaceIds.length,
        marketplaceIdsPresent: Boolean(marketplaceIds && marketplaceIds.length > 0),
        nextToken: nextToken ? "[present]" : null,
        maxResults,
        queryDetails,
      },
    });

    // FBA Inventory v1 requires granularityType + granularityId; `details=true` returns the
    // fulfillable / reserved / inbound / unfulfillable quantities. (It has no page-size parameter.)
    const query: Record<string, any> = {
      granularityType: "Marketplace",
      granularityId: marketplaceIds[0],
      marketplaceIds: marketplaceIds.join(","),
    };
    if (queryDetails) query.details = "true";
    if (nextToken) query.nextToken = nextToken;

    const url = new URL(`${this.endpoint}/fba/inventory/v1/summaries`);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }

    log.info({
      operation: "getInventorySummaries",
      endpoint: "/fba/inventory/v1/summaries",
      stage: "final-request-url",
      config: {
        queryKeys: Object.keys(query),
        queryString: url.searchParams.toString(),
        url: url.origin + url.pathname,
      },
    });

    const result = await this.request({
      operation: "getInventorySummaries",
      path: "/fba/inventory/v1/summaries",
      query,
      traceId,
      clientId,
      sellerId,
      module: "inventory",
    });

    log.info({
      operation: "getInventorySummaries",
      endpoint: "/fba/inventory/v1/summaries",
      stage: "after",
      config: { nextToken: spApiNextToken(result) ? "[present]" : null },
    });

    return result;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Reports API (instrumented)
  // ──────────────────────────────────────────────────────────────────────────

  async getReports({
    reportTypes,
    processingStatuses,
    marketplaceIds = this.requireMarketplaceIds(),
    createdSince,
    pageSize = 10,
    nextToken,
    traceId,
    clientId,
    sellerId,
  }: {
    reportTypes?: string[];
    processingStatuses?: string[];
    marketplaceIds?: string[];
    createdSince?: string;
    pageSize?: number;
    nextToken?: string;
    traceId?: string;
    clientId?: string | null;
    sellerId?: string | null;
  }) {
    const query: Record<string, string | number | boolean | undefined> = {
      pageSize: String(pageSize),
    };
    if (reportTypes?.length) query.reportTypes = reportTypes.join(",");
    if (processingStatuses?.length) query.processingStatuses = processingStatuses.join(",");
    if (marketplaceIds?.length) query.marketplaceIds = marketplaceIds.join(",");
    if (createdSince) query.createdSince = createdSince;
    if (nextToken) query.nextToken = nextToken;

    return this.request({
      operation: "getReports",
      path: "/reports/2021-06-30/reports",
      query,
      traceId,
      clientId,
      sellerId,
      module: "reports",
    });
  }

  async createReport({
    reportType,
    marketplaceIds = this.requireMarketplaceIds(),
    dataStartTime,
    dataEndTime,
    reportOptions,
    traceId,
    clientId,
    sellerId,
  }: {
    reportType: string;
    marketplaceIds?: string[];
    dataStartTime?: string;
    dataEndTime?: string;
    reportOptions?: Record<string, string>;
    traceId?: string;
    clientId?: string | null;
    sellerId?: string | null;
  }) {
    return this.request({
      operation: "createReport",
      method: "POST",
      path: "/reports/2021-06-30/reports",
      body: {
        reportType,
        marketplaceIds,
        ...(dataStartTime ? { dataStartTime } : {}),
        ...(dataEndTime ? { dataEndTime } : {}),
        ...(reportOptions ? { reportOptions } : {}),
      },
      traceId,
      clientId,
      sellerId,
      module: "reports",
    });
  }

  async getReport({ reportId, traceId, clientId, sellerId }: { reportId: string; traceId?: string; clientId?: string | null; sellerId?: string | null }) {
    return this.request({
      operation: "getReport",
      path: `/reports/2021-06-30/reports/${encodeURIComponent(reportId)}`,
      query: {},
      traceId,
      clientId,
      sellerId,
      module: "reports",
    });
  }

  async getReportDocument({ documentId, traceId, clientId, sellerId }: { documentId: string; traceId?: string; clientId?: string | null; sellerId?: string | null }) {
    return this.request({
      operation: "getReportDocument",
      path: `/reports/2021-06-30/documents/${encodeURIComponent(documentId)}`,
      query: {},
      traceId,
      clientId,
      sellerId,
      module: "reports",
    });
  }

  async getReportDocumentContents({ url, compressionAlgorithm }: { url: string; compressionAlgorithm?: string | null }) {
    const res = await fetch(url, { headers: { Accept: "text/csv,text/tab-separated-values,application/json,*/*" } });
    if (!res.ok) throw new Error(`Report document fetch failed (${res.status})`);
    const rawBuffer = Buffer.from(await res.arrayBuffer());
    const isGzip =
      String(compressionAlgorithm || "").toUpperCase() === "GZIP" ||
      (rawBuffer.length >= 2 && rawBuffer[0] === 0x1f && rawBuffer[1] === 0x8b);
    const decoded = isGzip ? gunzipSync(rawBuffer) : rawBuffer;
    return decoded.toString("utf8");
  }

  /**
   * Request a report from SP-API, poll until DONE / DONE_NO_DATA, and download + decompress its contents.
   */
  async fetchReportContent({
    reportType,
    marketplaceIds = this.requireMarketplaceIds(),
    dataStartTime,
    dataEndTime,
    reportOptions,
    maxPollAttempts = 24,
    pollIntervalMs = 3000,
    traceId,
    clientId,
    sellerId,
  }: {
    reportType: string;
    marketplaceIds?: string[];
    dataStartTime?: string;
    dataEndTime?: string;
    reportOptions?: Record<string, string>;
    maxPollAttempts?: number;
    pollIntervalMs?: number;
    traceId?: string;
    clientId?: string | null;
    sellerId?: string | null;
  }): Promise<{
    reportId: string;
    processingStatus: string;
    reportDocumentId: string | null;
    content: string;
  }> {
    const created = await this.createReport({
      reportType,
      marketplaceIds,
      dataStartTime,
      dataEndTime,
      reportOptions,
      traceId,
      clientId,
      sellerId,
    });
    const reportId = created?.reportId ?? created?.payload?.reportId;
    if (!reportId) {
      throw new Error(`SP-API createReport for ${reportType} did not return a reportId`);
    }

    let processingStatus = "IN_QUEUE";
    let reportDocumentId: string | null = null;

    for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
      const statusResp = await this.getReport({ reportId, traceId, clientId, sellerId });
      const report = statusResp?.payload ?? statusResp ?? {};
      processingStatus = String(report.processingStatus || "IN_QUEUE");
      reportDocumentId = report.reportDocumentId ?? null;

      if (processingStatus === "DONE") break;
      if (processingStatus === "DONE_NO_DATA") {
        return { reportId, processingStatus, reportDocumentId: null, content: "" };
      }
      if (processingStatus === "CANCELLED" || processingStatus === "FATAL") {
        throw new Error(`SP-API report ${reportType} (${reportId}) ended with status ${processingStatus}`);
      }
    }

    if (processingStatus !== "DONE" || !reportDocumentId) {
      throw new Error(
        `SP-API report ${reportType} (${reportId}) timed out in status ${processingStatus}`,
      );
    }

    const docResp = await this.getReportDocument({
      documentId: reportDocumentId,
      traceId,
      clientId,
      sellerId,
    });
    const doc = docResp?.payload ?? docResp ?? {};
    if (!doc.url) {
      throw new Error(`SP-API report document ${reportDocumentId} missing download url`);
    }

    const content = await this.getReportDocumentContents({
      url: doc.url,
      compressionAlgorithm: doc.compressionAlgorithm ?? null,
    });

    return { reportId, processingStatus, reportDocumentId, content };
  }
}

export const amazonSpApi = new AmazonSpApiService();
export { generateTraceId, AmazonDebugLogger };
