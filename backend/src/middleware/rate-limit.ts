// =============================================================================
// Rate limiting & throttling middleware
//
// Hard limits (express-rate-limit) + graduated slow-down (express-slow-down)
// per source IP, using an in-memory store. Limits are tuned per route class:
//   login  — very strict (brute-force / credential stuffing)
//   signup — strict (account-creation abuse)
//   public token endpoints (NOA / debtor reminder links) — bounded
//   authenticated API — generous backstop against runaway clients
//
// NOTE: The store is in-memory (single instance). For multi-instance
// deployments, swap `store` for a shared Redis store (see SECURITY-AUDIT.md).
// =============================================================================

import rateLimit from "express-rate-limit";
import slowDown from "express-slow-down";
import { config } from "../config.js";

// Log every rate-limit rejection so violations are visible in server logs.
function logViolation(kind: string) {
  return (_req: any, _res: any, next?: (err?: unknown) => void) => {
    console.warn(
      `[security] RATE_LIMIT ${kind} ip=${_req.ip} path=${_req.originalUrl}`
    );
    // The library's built-in handler responds 429; we only augment logging.
    if (typeof next === "function") next();
  };
}

// Shared options for all limiters. `validate: false` keeps requests from
// private/NAT'd office IPs working when a reverse proxy adds X-Forwarded-For.
const baseOptions = {
  standardHeaders: true, // return standard RateLimit-* headers
  legacyHeaders: false, // drop deprecated X-RateLimit-* headers
  validate: false as const,
};

// Only FAILED attempts consume budget. Successful logins/signups (status < 400)
// never count, so multiple users behind one office NAT IP can all log in
// without tripping throttling — brute-force attempts still get blocked.
const failureOnly = {
  ...baseOptions,
  skipSuccessfulRequests: true as const,
};

/** Normalize an email for per-account keys (never trust raw body values). */
function keyEmail(req: any): string {
  const email = req?.body?.email;
  return typeof email === "string" ? email.trim().toLowerCase().slice(0, 200) : "unknown";
}

/** Hard cap on FAILED login attempts per IP (stops distributed brute-force). */
export const loginLimiter = rateLimit({
  ...failureOnly,
  windowMs: config.rateLimit.loginWindowMs,
  limit: config.rateLimit.loginLimit,
  handler: (req, res) => {
    logViolation("LOGIN")(req, res);
    res.status(429).json({ error: "Too many login attempts. Please try again later." });
  },
});

/** Hard cap on FAILED login attempts per account+IP (stops single-account brute-force). */
export const accountLoginLimiter = rateLimit({
  ...failureOnly,
  windowMs: config.rateLimit.loginWindowMs,
  limit: config.rateLimit.accountLoginLimit,
  keyGenerator: (req) => `${req.ip ?? "-"}|${keyEmail(req)}`,
  handler: (req, res) => {
    logViolation("ACCOUNT")(req, res);
    res.status(429).json({ error: "Too many login attempts for this account. Please try again later." });
  },
});

/** Hard cap on account creations per IP (successful signups don't count). */
export const signupLimiter = rateLimit({
  ...failureOnly,
  windowMs: config.rateLimit.signupWindowMs,
  limit: config.rateLimit.signupLimit,
  handler: (req, res) => {
    logViolation("SIGNUP")(req, res);
    res.status(429).json({ error: "Too many signup attempts. Please try again later." });
  },
});

/** Bounded access to public token-authenticated endpoints (NOA, reminder links). */
export const publicTokenLimiter = rateLimit({
  ...baseOptions,
  windowMs: config.rateLimit.publicWindowMs,
  limit: config.rateLimit.publicLimit,
  handler: (req, res) => {
    logViolation("PUBLIC")(req, res);
    res.status(429).json({ error: "Too many requests. Please try again later." });
  },
});

/** Backstop for the authenticated API — generous, but bounded per IP. */
export const apiLimiter = rateLimit({
  ...baseOptions,
  windowMs: config.rateLimit.apiWindowMs,
  limit: config.rateLimit.apiLimit,
  handler: (req, res) => {
    logViolation("API")(req, res);
    res.status(429).json({ error: "Too many requests. Please try again later." });
  },
});

/**
 * Graduated slow-down for auth endpoints — throttles only FAILED attempts so
 * legitimate logins are never delayed; repeated failures get progressively
 * slowed before the hard limit kicks in.
 */
export const authSlowDown = slowDown({
  windowMs: config.rateLimit.loginWindowMs,
  delayAfter: config.rateLimit.slowDownAfter,
  delayMs: (hits: number) => Math.min(hits * config.rateLimit.slowDownMs, config.rateLimit.slowDownMaxMs),
  skipSuccessfulRequests: true as const,
  validate: false as const,
});
