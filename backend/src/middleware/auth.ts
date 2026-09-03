import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { logSecurityEvent } from "./security.js";
import * as db from "../dynamodb.js";
import { touchPresence } from "../services/presence.js";

export interface AuthPayload {
  userId: string;
  email: string;
  roles: string[];
}

export const TOKEN_ISSUER = "insight-factor-api";
export const TOKEN_AUDIENCE = "insight-factor-web";

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
      viewAsUserId?: string;
      originalUserId?: string;
    }
  }
}

/** Parse a JWT expiry string like "7d", "12h", "30m", "90s" into seconds. */
export function expiresInToSeconds(expiresIn: string): number {
  const m = /^(\d+)\s*([smhdw])$/.exec(String(expiresIn).trim());
  if (!m) return 7 * 86400;
  const n = parseInt(m[1], 10);
  const mult: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
  return n * (mult[m[2]] ?? 86400);
}

/** Cookie flags — httpOnly (XSS-proof), SameSite=Strict (CSRF-proof), Secure in prod. */
export function authCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: config.isProduction,
    path: "/",
  };
}

/** Persist the session token as an httpOnly cookie on the response. */
export function setAuthCookie(res: Response, token: string): void {
  res.cookie(config.jwt.cookieName, token, {
    ...authCookieOptions(),
    maxAge: expiresInToSeconds(config.jwt.expiresIn) * 1000,
  });
}

/** Clear the session cookie (logout). */
export function clearAuthCookie(res: Response): void {
  res.clearCookie(config.jwt.cookieName, authCookieOptions());
}

/**
 * Extract the JWT from the request: httpOnly cookie first (the web app),
 * falling back to an `Authorization: Bearer` header (API scripts/tests).
 */
export function getTokenFromRequest(req: Request): string | null {
  const cookie = (req as Request & { cookies?: Record<string, string> }).cookies?.[config.jwt.cookieName];
  if (typeof cookie === "string" && cookie.length > 0) return cookie;
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) return header.replace("Bearer ", "");
  return null;
}

/**
 * Verify a JWT (signature + expiry). Issuer/audience claims are validated when
 * present on the token — legacy tokens without claims keep working, while any
 * token that *claims* an issuer/audience must match ours (prevents cross-app
 * token confusion if the secret were ever reused elsewhere).
 */
export function verifyToken(token: string): AuthPayload & { iat?: number; exp?: number; jti?: string } {
  const payload = jwt.verify(token, config.jwt.secret) as AuthPayload & {
    iat?: number;
    exp?: number;
    jti?: string;
    iss?: string;
    aud?: string | string[];
  };
  if (payload.iss && payload.iss !== TOKEN_ISSUER) {
    throw new jwt.JsonWebTokenError("invalid issuer");
  }
  const aud = payload.aud;
  const audMatches = Array.isArray(aud)
    ? aud.includes(TOKEN_AUDIENCE)
    : aud === undefined || aud === TOKEN_AUDIENCE;
  if (!audMatches) {
    throw new jwt.JsonWebTokenError("invalid audience");
  }
  return payload;
}

/**
 * Load the live USER record for a token's subject.
 *
 * Identity comes from the database, not the JWT claims:
 *  - a deleted/disabled account is rejected immediately (401) even if its
 *    cookie has not yet expired;
 *  - role changes take effect instantly, without waiting for the user to
 *    re-login or for the old token to expire.
 * Returns null when the account no longer exists.
 */
async function loadUserFromDb(userId: string): Promise<{
  id: string;
  email: string;
  roles: string[];
} | null> {
  const item = await db.getItem(`USER#${userId}`);
  if (!item) return null;
  const u = item as any;
  return {
    id: u.id ?? userId,
    email: u.email ?? "",
    roles: Array.isArray(u.roles) ? u.roles : [],
  };
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = getTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    const payload = verifyToken(token);
    // If the view-as middleware already impersonated a target user (it runs
    // before this per-route middleware), keep that identity intact — we only
    // validate the token here.
    if (req.viewAsUserId && req.user) {
      return next();
    }
    const live = await loadUserFromDb(payload.userId);
    if (!live) {
      logSecurityEvent("auth.account_not_found", req, { reason: "deleted_or_missing" });
      return res.status(401).json({ error: "Account no longer exists" });
    }
    req.user = {
      userId: payload.userId,
      email: live.email || payload.email,
      roles: live.roles,
    };
    // Record last-seen / IP presence (throttled, fire-and-forget).
    touchPresence(payload.userId, req.ip);
    next();
  } catch (err) {
    logSecurityEvent("auth.invalid_token", req);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = getTokenFromRequest(req);
  if (token) {
    try {
      const payload = verifyToken(token) as any;
      req.user = {
        userId: payload.userId,
        email: payload.email,
        roles: payload.roles || [],
      };
    } catch {
      // ignore invalid token for optional auth
    }
  }
  next();
}
