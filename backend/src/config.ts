import dotenv from "dotenv";
dotenv.config();

// Only include explicit credentials when they are actually set — otherwise
// let the AWS SDK use its default credential chain (env vars, ~/.aws/credentials,
// IAM role, etc.). Passing empty strings causes cryptic "security key not found" errors.
interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

function awsCredentials(): AwsCredentials | undefined {
  const id = process.env.AWS_ACCESS_KEY_ID;
  const secret = process.env.AWS_SECRET_ACCESS_KEY;
  if (id && secret) return { accessKeyId: id, secretAccessKey: secret };
  return undefined;
}

const isProduction = (process.env.NODE_ENV || "development") === "production";

/**
 * Chooses the entity-read source.
 *
 * GSI2 is the default: normal workflows and Tally exports must not full-scan
 * the table. The index is only complete after `backfill-gsi2.ts --apply` and a
 * clean `--verify` run, so production must have that migration applied first.
 *
 * Two explicit escape hatches remain:
 *   DYNAMODB_SCAN_SOURCE=scan       force legacy scans
 *   DYNAMODB_GSI2_VERIFIED=false    force legacy scans (emergency rollback)
 * An unset environment never silently falls back to scans.
 */
export function resolveScanSource(
  requested: string | undefined,
  verified: string | undefined,
): "scan" | "gsi2" {
  if (requested === "scan") return "scan";
  if (verified === "false") {
    console.warn(
      "[dynamodb] DYNAMODB_GSI2_VERIFIED=false — using table scans for entity reads. " +
        "Unset it (or set it to true) to return to GSI2 queries.",
    );
    return "scan";
  }
  return "gsi2";
}


// Approved browser origins (used by CORS and the CSRF origin guard).
// Explicitly configured via CORS_ORIGIN — in production ONLY these are allowed.
const configuredOrigins = (process.env.CORS_ORIGIN || "http://localhost:3000,http://localhost:8080")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// Local-development origins (Vite dev server, plain localhost) are merged in
// ONLY when not running in production, so the local browser flow — which talks
// to the API same-origin through the Vite proxy and sends `Origin:
// http://localhost:5173` on POSTs — passes the CSRF origin guard. Production
// keeps the strict CORS_ORIGIN allowlist.
const DEV_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:8080",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3000",
];
const corsOrigins = isProduction
  ? configuredOrigins
  : Array.from(new Set([...configuredOrigins, ...DEV_ALLOWED_ORIGINS]));

export const config = {
  port: parseInt(process.env.PORT || "4040", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  isProduction,

  // ── Security tuning (all overridable via env) ─────────────────────────────
  security: {
    // Max JSON payload the API will parse (bytes). Keep small — file uploads go
    // through multipart (/upload), never through the JSON body.
    jsonBodyLimit: process.env.MAX_JSON_BODY || "5mb",
    // Tally XML mass imports travel as a JSON string and can be much larger
    // than normal API payloads.
    tallyXmlBodyLimit: process.env.MAX_TALLY_XML_BODY || "50mb",
    // Max URL-encoded form body size.
    urlencodedLimit: process.env.MAX_URLENCODED_BODY || "100kb",
    // JSON parse of a request must be bounded; rejects giant arrays/queries.
    maxQueryLength: parseInt(process.env.MAX_QUERY_LENGTH || "2000", 10),
    // Short-lived signed download URLs for uploaded objects (seconds).
    signedUrlTtlSeconds: parseInt(process.env.SIGNED_URL_TTL || "120", 10),
  },

  // ── Rate limiting (per-IP, in-memory) ─────────────────────────────────────
  // IMPORTANT: login/signup limiters only count FAILED attempts (successful
  // logins never consume budget), so users on a shared office NAT IP can log
  // in freely — only brute-force attempts get blocked.
  rateLimit: {
    loginWindowMs: parseInt(process.env.RL_LOGIN_WINDOW_MS || String(15 * 60 * 1000), 10),
    loginLimit: parseInt(process.env.RL_LOGIN_LIMIT || "30", 10), // failed logins / IP
    accountLoginLimit: parseInt(process.env.RL_ACCOUNT_LOGIN_LIMIT || "10", 10), // failed logins / account
    signupWindowMs: parseInt(process.env.RL_SIGNUP_WINDOW_MS || String(60 * 60 * 1000), 10),
    signupLimit: parseInt(process.env.RL_SIGNUP_LIMIT || "10", 10),
    publicWindowMs: parseInt(process.env.RL_PUBLIC_WINDOW_MS || String(15 * 60 * 1000), 10),
    publicLimit: parseInt(process.env.RL_PUBLIC_LIMIT || "60", 10),
    apiWindowMs: parseInt(process.env.RL_API_WINDOW_MS || "60000", 10),
    apiLimit: parseInt(process.env.RL_API_LIMIT || "1000", 10),
    // Slow-down (throttle) only slows FAILED attempts, and starts much later
    // than the old settings so legitimate multi-user logins are never delayed.
    slowDownAfter: parseInt(process.env.RL_SLOW_AFTER || "10", 10),
    slowDownMs: parseInt(process.env.RL_SLOW_MS || "200", 10),
    slowDownMaxMs: parseInt(process.env.RL_SLOW_MAX_MS || "10000", 10),
  },


  admin: {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  },

  // Designated super admin account. Defaults to the admin email so the seeded
  // admin (sankalp@whizunik.com) is also the super admin unless overridden.
  superAdmin: {
    email: process.env.SUPER_ADMIN_EMAIL || process.env.ADMIN_EMAIL,
  },

  jwt: {
    secret: process.env.JWT_SECRET || "dev-secret-change-in-production",
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    // httpOnly session cookie — the JWT is never exposed to client JS.
    cookieName: process.env.AUTH_COOKIE_NAME || "auth_token",
  },

  // Approved browser origins (used by CORS and the CSRF origin guard).
  corsOrigins,

  dynamodb: {
    region: process.env.AWS_REGION || "ap-south-1",
    credentials: awsCredentials(),
    tableName: process.env.DYNAMODB_TABLE || "adventra",
    gsi1Name: process.env.DYNAMODB_GSI1_NAME || "GSI1",
    gsi2Name: process.env.DYNAMODB_GSI2_NAME || "GSI2",
    gsiKeysOnly: process.env.DYNAMODB_GSI_KEYS_ONLY === "true",
    endpoint: process.env.DYNAMODB_ENDPOINT || undefined,

    // Read-path safety (see "Safe DynamoDB Scan Fix"). Every unbounded read is
    // capped so a runaway scan/query can never silently drain the table.
    // Tally exports use a dedicated uncapped helper and are the only exception.
    readDiagnostics: process.env.DYNAMODB_READ_DIAGNOSTICS === "true",

    // GSI2 is the default read source so normal workflows never scan the table.
    // It contains every record only after `backfill-gsi2.ts --apply` and a
    // clean `--verify`; set DYNAMODB_SCAN_SOURCE=scan or
    // DYNAMODB_GSI2_VERIFIED=false to roll back to table scans.
    scanSource: resolveScanSource(
      process.env.DYNAMODB_SCAN_SOURCE,
      process.env.DYNAMODB_GSI2_VERIFIED,
    ),

    readLimits: {
      maxScanPages: parseInt(process.env.DYNAMODB_MAX_SCAN_PAGES || "400", 10),
      maxScanItems: parseInt(process.env.DYNAMODB_MAX_SCAN_ITEMS || "200000", 10),
      scanTimeoutMs: parseInt(process.env.DYNAMODB_SCAN_TIMEOUT_MS || "120000", 10),
      warnScanPages: parseInt(process.env.DYNAMODB_WARN_SCAN_PAGES || "20", 10),
      warnScanItems: parseInt(process.env.DYNAMODB_WARN_SCAN_ITEMS || "10000", 10),
    },
  },

  s3: {
    region: process.env.S3_BUCKET_REGION || process.env.AWS_REGION || "us-east-1",
    bucket: process.env.S3_BUCKET || "",
    credentials: awsCredentials(),
  },

  appUrl: process.env.APP_URL || "http://localhost:3000",

  // ── Amazon Selling Partner API (SP-API) / LWA ─────────────────────────────
  amazon: {
    clientId: process.env.AMAZON_CLIENT_ID || "",
    clientSecret: process.env.AMAZON_CLIENT_SECRET || "",
    refreshToken: process.env.AMAZON_REFRESH_TOKEN || "",
    appId: process.env.AMAZON_APP_ID || "",
    spapiEndpoint: process.env.AMAZON_SP_API_ENDPOINT || process.env.AMAZON_SPAPI_ENDPOINT || "https://sellingpartnerapi-eu.amazon.com",
    spApiRegion: process.env.AMAZON_SP_API_REGION || process.env.AMAZON_REGION || "eu-west-1",
    // Backward-compatible alias for spApiRegion.
    region: process.env.AMAZON_SP_API_REGION || process.env.AMAZON_REGION || "eu-west-1",
    marketplaceId: process.env.AMAZON_MARKETPLACE_ID || "",
    // Seller ID (merchant ID) — separate from marketplace ID.
    // Amazon India marketplace ID is A21TJRUUN4KGV; seller ID is different.
    sellerId: process.env.AMAZON_SELLER_ID || "",
    countryCode: process.env.AMAZON_COUNTRY_CODE || null,
    applicationStatus: process.env.AMAZON_APPLICATION_STATUS || null,
    lwaEndpoint: process.env.AMAZON_LWA_ENDPOINT || "https://api.amazon.com/auth/o2/token",
    syncLookbackDays: parseInt(process.env.AMAZON_SYNC_LOOKBACK_DAYS || "30", 10),
    isConfigured: Boolean(process.env.AMAZON_CLIENT_ID && process.env.AMAZON_CLIENT_SECRET && process.env.AMAZON_REFRESH_TOKEN),
  },

  // ── Flipkart Marketplace API ──────────────────────────────────────────────
  flipkart: {
    appId: process.env.FLIPKART_APP_ID || "",
    appSecret: process.env.FLIPKART_APP_SECRET || "",
    sellerId: process.env.FLIPKART_SELLER_ID || "",
    apiEndpoint: process.env.FLIPKART_API_ENDPOINT || "https://api.flipkart.net/sellers",
    sandbox: process.env.FLIPKART_SANDBOX === "true",
    isConfigured: Boolean(process.env.FLIPKART_APP_ID && process.env.FLIPKART_APP_SECRET),
  },

  // ── Myntra Seller API V4 (Pretr OMS) ──────────────────────────────────────
  // Test system (Neo-Mockify): http://pretrtest-neo.myntapi.com — needs our
  // server IP whitelisted by Myntra. Production domain is shared by Myntra
  // after OMS onboarding.
  myntra: {
    merchantId: process.env.MYNTRA_MERCHANT_ID || "",
    secretKey: process.env.MYNTRA_SECRET_KEY || "",
    apiDomain: (process.env.MYNTRA_API_DOMAIN || "http://pretrtest-neo.myntapi.com").replace(/\/+$/, ""),
    partnerStore: process.env.MYNTRA_PARTNER_STORE || "Myntra",
    // Header Myntra asks for during stage (Mockify) testing only.
    mockingPartnerName: process.env.MYNTRA_MOCKING_PARTNER_NAME || "",
    // Token Myntra must send in the `access_token` header when it calls our
    // outbound endpoints (create order, order update, returns, invoice).
    outboundToken: process.env.MYNTRA_OUTBOUND_TOKEN || "",
    // Public base URL of our outbound endpoints, e.g. https://adventra.whizunikhub.com/api/myntra
    sellerDomain: (process.env.MYNTRA_SELLER_DOMAIN || "").replace(/\/+$/, ""),
    // Local testing only: where Mockify should push events when our own
    // outbound URLs are not public (e.g. the sample run.mocky.io URL from
    // Myntra's sheet). Leave empty on the server.
    mockPushUrl: process.env.MYNTRA_MOCK_PUSH_URL || "",
    isConfigured: Boolean(process.env.MYNTRA_MERCHANT_ID && process.env.MYNTRA_SECRET_KEY),
  },

  // ── Shopify Admin API (GraphQL) ───────────────────────────────────────────
  // A custom app in the store's admin (Settings → Apps → Develop apps) gives
  // the Admin API access token (shpat_…). Scopes: read_orders, read_products,
  // read_inventory (and read_returns for returns).
  shopify: {
    storeDomain: (process.env.SHOPIFY_STORE_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/+$/, ""),
    accessToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "",
    apiVersion: process.env.SHOPIFY_API_VERSION || "2026-07",
    syncLookbackDays: parseInt(process.env.SHOPIFY_SYNC_LOOKBACK_DAYS || "60", 10),
    isConfigured: Boolean(process.env.SHOPIFY_STORE_DOMAIN && process.env.SHOPIFY_ADMIN_ACCESS_TOKEN),
  },

  // ── AJIO ─────────────────────────────────────────────────────────────────
  // AJIO has no public seller API; access is given to approved OMS partners.
  // Set these once AJIO shares the API details.
  ajio: {
    apiBaseUrl: (process.env.AJIO_API_BASE_URL || "").replace(/\/+$/, ""),
    sellerId: process.env.AJIO_SELLER_ID || "",
    apiKey: process.env.AJIO_API_KEY || "",
    isConfigured: Boolean(process.env.AJIO_API_BASE_URL && process.env.AJIO_API_KEY),
  },

  smtp: {
    host: process.env.SMTP_HOST || "",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
  },
} as const;
