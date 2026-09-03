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
    apiWindowMs: parseInt(process.env.RL_API_WINDOW_MS || String(15 * 60 * 1000), 10),
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
    region: process.env.AWS_REGION || "us-east-1",
    credentials: awsCredentials(),
    tableName: process.env.DYNAMODB_TABLE || "InsightFactor",
    endpoint: process.env.DYNAMODB_ENDPOINT || undefined,
  },

  s3: {
    region: process.env.S3_BUCKET_REGION || process.env.AWS_REGION || "us-east-1",
    bucket: process.env.S3_BUCKET || "",
    credentials: awsCredentials(),
  },

  appUrl: process.env.APP_URL || "http://localhost:3000",

  smtp: {
    host: process.env.SMTP_HOST || "",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
  },
} as const;
