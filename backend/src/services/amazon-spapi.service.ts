import { config } from "../config.js";

type Json = Record<string, any>;

interface TokenCache {
  accessToken: string | null;
  expiresAt: number; // epoch ms
  refreshing: Promise<string> | null;
}

interface RateLimitState {
  lastCall: number;
  minIntervalMs: number;
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
  getReport: 1,
  createReport: 1,
  default: 1,
};

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
 *
 * Secrets (client secret, refresh token) are read from env only and are never
 * returned to the frontend.
 */
export class AmazonSpApiService {
  private readonly endpoint: string;
  private readonly marketplaceId: string;
  private readonly region: string;
  private token: TokenCache = { accessToken: null, expiresAt: 0, refreshing: null };
  private readonly rateLimits = new Map<string, RateLimitState>();

  constructor() {
    if (!config.amazon.isConfigured) {
      // Defer the hard error until a call is actually attempted, so the app can
      // boot without Amazon creds in non-Amazon deployments.
    }
    this.endpoint = config.amazon.spapiEndpoint;
    this.marketplaceId = config.amazon.marketplaceId;
    this.region = config.amazon.region;
  }

  private isConfigured(): boolean {
    return Boolean(config.amazon.isConfigured);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // LWA access token
  // ──────────────────────────────────────────────────────────────────────────

  private async fetchAccessToken(): Promise<string> {
    const { clientId, clientSecret, refreshToken, lwaEndpoint } = config.amazon;
    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error(
        "Amazon SP-API is not configured: AMAZON_CLIENT_ID, AMAZON_CLIENT_SECRET and AMAZON_REFRESH_TOKEN must be set.",
      );
    }

    const body = new URLSearchParams();
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", refreshToken);
    body.set("client_id", clientId);
    body.set("client_secret", clientSecret);
    body.set("scope", "sellingpartnerapi::notifications");

    const res = await fetch(lwaEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`LWA token request failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
    };
    if (!data.access_token) {
      throw new Error("LWA token response did not include an access_token");
    }

    const ttl = Number(data.expires_in || 3600) * 1000;
    // Refresh 60s before actual expiry to avoid racing the boundary.
    this.token = {
      accessToken: data.access_token,
      expiresAt: Date.now() + ttl - 60_000,
      refreshing: null,
    };
    return data.access_token;
  }

  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.token.accessToken && now < this.token.expiresAt) {
      return this.token.accessToken;
    }
    // Only one refresh in flight at a time.
    if (this.token.refreshing) {
      return this.token.refreshing;
    }
    this.token.refreshing = this.fetchAccessToken();
    try {
      return await this.token.refreshing;
    } finally {
      this.token.refreshing = null;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Rate limiting
  // ──────────────────────────────────────────────────────────────────────────

  private rateLimitMs(operation: string): number {
    const rps = OPERATION_RATE_LIMITS[operation] ?? OPERATION_RATE_LIMITS.default;
    return Math.max(100, Math.round(1000 / rps));
  }

  private async enforceRateLimit(operation: string): Promise<void> {
    const minInterval = this.rateLimitMs(operation);
    const state = this.rateLimits.get(operation) ?? { lastCall: 0, minIntervalMs: minInterval };
    state.minIntervalMs = minInterval;
    const now = Date.now();
    const elapsed = now - state.lastCall;
    if (elapsed < minInterval) {
      await new Promise((resolve) => setTimeout(resolve, minInterval - elapsed));
    }
    state.lastCall = Date.now();
    this.rateLimits.set(operation, state);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Core SP-API request
  // ──────────────────────────────────────────────────────────────────────────

  async request<T = any>({
    operation,
    method = "GET",
    path,
    query,
    body,
    idempotencyKey,
    maxRetries = 5,
  }: {
    operation: string;
    method?: string;
    path: string;
    query?: Record<string, string | number | boolean | undefined>;
    body?: any;
    idempotencyKey?: string;
    maxRetries?: number;
  }): Promise<T> {
    if (!this.isConfigured()) {
      throw new Error(
        "Amazon SP-API is not configured. Set AMAZON_CLIENT_ID, AMAZON_CLIENT_SECRET and AMAZON_REFRESH_TOKEN.",
      );
    }

    await this.enforceRateLimit(operation);

    const accessToken = await this.getAccessToken();
    const url = new URL(`${this.endpoint}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null || v === "") continue;
        url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "x-amz-access-token": accessToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (idempotencyKey) headers["x-amz-idempotency-key"] = idempotencyKey;

    let lastError: any = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(url.toString(), {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        });

        // Honor Amazon's retry-after / rate-limit headers.
        const retryAfter = res.headers.get("retry-after") || res.headers.get("x-amzn-RateLimit-Retry-After");
        const rateLimitLimit = res.headers.get("x-amzn-RateLimit-Limit");

        if (res.status === 401) {
          // Token may have expired; force refresh and retry once.
          this.token = { accessToken: null, expiresAt: 0, refreshing: null };
          const freshToken = await this.getAccessToken();
          headers.Authorization = `Bearer ${freshToken}`;
          headers["x-amz-access-token"] = freshToken;
          continue;
        }

        if (res.status === 429 || res.status === 503) {
          const retryAfterSec = retryAfter ? parseInt(retryAfter, 10) : null;
          const backoffMs = retryAfterSec ? retryAfterSec * 1000 : Math.min(1000 * 2 ** attempt, 30_000);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          lastError = new Error(`SP-API throttled (${res.status}), retrying in ${backoffMs}ms`);
          continue;
        }

        if (res.status >= 500 && attempt < maxRetries) {
          const backoffMs = Math.min(1000 * 2 ** attempt, 30_000);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          lastError = new Error(`SP-API server error (${res.status}), retrying`);
          continue;
        }

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`SP-API ${method} ${path} failed (${res.status}): ${text.slice(0, 500)}`);
        }

        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          return (await res.json()) as T;
        }
        return (await res.text()) as unknown as T;
      } catch (err: any) {
        lastError = err;
        // Don't retry non-transient fetch failures (DNS, config) except 401 handled above.
        if (err.message && err.message.includes("not configured")) throw err;
        if (attempt >= maxRetries) break;
        const backoffMs = Math.min(1000 * 2 ** attempt, 30_000);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    throw lastError || new Error(`SP-API request failed after ${maxRetries + 1} attempts`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Orders API
  // ──────────────────────────────────────────────────────────────────────────

  async getOrders({
    createdAfter,
    lastUpdatedAfter,
    marketplaceIds = this.marketplaceId ? [this.marketplaceId] : [],
    orderStatuses,
    nextToken,
    maxResults = 100,
  }: {
    createdAfter?: string;
    lastUpdatedAfter?: string;
    marketplaceIds?: string[];
    orderStatuses?: string[];
    nextToken?: string;
    maxResults?: number;
  }) {
    const query: Record<string, any> = {
      MarketplaceIds: marketplaceIds.join(","),
      MaxResults: String(maxResults),
    };
    if (createdAfter) query.CreatedAfter = createdAfter;
    if (lastUpdatedAfter) query.LastUpdatedAfter = lastUpdatedAfter;
    if (orderStatuses?.length) query.OrderStatuses = orderStatuses.join(",");
    if (nextToken) query.NextToken = nextToken;

    return this.request({
      operation: "getOrders",
      path: "/orders/v0/orders",
      query,
    });
  }

  async getOrderItems({ amazonOrderId }: { amazonOrderId: string }) {
    return this.request({
      operation: "getOrderItems",
      path: `/orders/v0/orders/${encodeURIComponent(amazonOrderId)}/orderItems`,
      query: {},
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Listings Items API
  // ──────────────────────────────────────────────────────────────────────────

  async getListingsItems({
    marketplaceIds = this.marketplaceId ? [this.marketplaceId] : [],
    sellerSkus,
    asins,
    nextToken,
    maxResults = 100,
  }: {
    marketplaceIds?: string[];
    sellerSkus?: string[];
    asins?: string[];
    nextToken?: string;
    maxResults?: number;
  }) {
    const query: Record<string, any> = {
      marketplaceIds: marketplaceIds.join(","),
      MaxResults: String(maxResults),
    };
    if (sellerSkus?.length) query.sellerSkus = sellerSkus.join(",");
    if (asins?.length) query.asins = asins.join(",");
    if (nextToken) query.nextToken = nextToken;

    return this.request({
      operation: "getListingsItems",
      path: "/listings/2021-08-01/listings",
      query,
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Catalog Items API
  // ──────────────────────────────────────────────────────────────────────────

  async getCatalogItem({ asin, marketplaceIds = this.marketplaceId ? [this.marketplaceId] : [] }: { asin: string; marketplaceIds?: string[] }) {
    return this.request({
      operation: "getCatalogItem",
      path: `/catalog/2022-04-01/items/${encodeURIComponent(asin)}`,
      query: {
        MarketplaceIds: marketplaceIds.join(","),
        InclusionOptions: "summaries,attributes,images",
      },
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FBA Inventory API
  // ──────────────────────────────────────────────────────────────────────────

  async getInventorySummaries({
    marketplaceIds = this.marketplaceId ? [this.marketplaceId] : [],
    nextToken,
    maxResults = 100,
    queryDetails = false,
  }: {
    marketplaceIds?: string[];
    nextToken?: string;
    maxResults?: number;
    queryDetails?: boolean;
  }) {
    const query: Record<string, any> = {
      marketplaceIds: marketplaceIds.join(","),
      MaxResults: String(maxResults),
      ...(queryDetails ? { QueryDetails: "true" } : {}),
    };
    if (nextToken) query.nextToken = nextToken;

    return this.request({
      operation: "getInventorySummaries",
      path: "/fba/inventory/v1/summaries",
      query,
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Reports API
  // ──────────────────────────────────────────────────────────────────────────

  async createReport({
    reportType,
    marketplaceIds = this.marketplaceId ? [this.marketplaceId] : [],
    dataStartTime,
    dataEndTime,
  }: {
    reportType: string;
    marketplaceIds?: string[];
    dataStartTime?: string;
    dataEndTime?: string;
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
      },
    });
  }

  async getReport({ reportId }: { reportId: string }) {
    return this.request({
      operation: "getReport",
      path: `/reports/2021-06-30/reports/${encodeURIComponent(reportId)}`,
      query: {},
    });
  }

  async getReportDocument({ documentId }: { documentId: string }) {
    return this.request({
      operation: "getReport",
      path: `/reports/2021-06-30/documents/${encodeURIComponent(documentId)}`,
      query: {},
    });
  }

  async getReportDocumentContents({ url }: { url: string }) {
    const res = await fetch(url, { headers: { Accept: "text/csv,application/json" } });
    if (!res.ok) throw new Error(`Report document fetch failed (${res.status})`);
    return res.text();
  }
}

export const amazonSpApi = new AmazonSpApiService();
