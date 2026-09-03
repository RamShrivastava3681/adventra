// =============================================================================
// User presence — last-seen time + IP geolocation
//
// Captures "who was active when and from where" on the USER record so the
// super admin can review team activity. Location is resolved from the request
// IP with the bundled offline MaxMind GeoIP database (geoip-lite) — no
// external API calls, no API key, free.
//
// Writes are throttled in-memory (once per user per interval) so a busy
// user's page fetches don't hammer DynamoDB, and all failures are swallowed —
// presence tracking must never take down or slow a request.
// =============================================================================

import geoip from "geoip-lite";
import * as db from "../dynamodb.js";

export interface GeoSummary {
  country: string;
  region: string;
  city: string;
}

/** Resolve city-level location for a public IPv4 address. Null when private/unknown. */
export function geoFromIp(ip?: string | null): GeoSummary | null {
  if (!ip) return null;
  const clean = String(ip).trim();
  // geoip-lite only covers public IPv4. Private/LAN/VPN ranges (10.x, 172.16-31.x,
  // 192.168.x, 127.x) and IPv6 fall through to null → shown as "unknown".
  if (!/^\d{1,3}(\.\d{1,3}){4}$/.test(`${clean}.`)) return null;
  const hit = geoip.lookup(clean);
  if (!hit) return null;
  return {
    country: hit.country ?? "",
    region: hit.region ?? "",
    city: hit.city ?? "",
  };
}

// Per-user throttle: at most one presence write per window.
const TOUCH_INTERVAL_MS = 60_000;
const lastTouchAt = new Map<string, number>();

/** Persist lastSeenAt / lastSeenIp / lastSeenGeo for a user. Never throws. */
async function writePresence(userId: string, ip?: string | null): Promise<void> {
  try {
    await db.updateItem(`USER#${userId}`, `USER#${userId}`, {
      lastSeenAt: db.nowISO(),
      lastSeenIp: ip ?? null,
      lastSeenGeo: geoFromIp(ip),
    });
  } catch (err) {
    console.error(`[presence] Failed to record presence for ${userId}:`, err);
  }
}

/** Record presence immediately on a successful login. */
export function recordLogin(userId: string, ip?: string | null): void {
  lastTouchAt.set(userId, Date.now());
  void writePresence(userId, ip);
}

/** Throttled presence update for authenticated API traffic (fire-and-forget). */
export function touchPresence(userId: string, ip?: string | null): void {
  const now = Date.now();
  const last = lastTouchAt.get(userId) ?? 0;
  if (now - last < TOUCH_INTERVAL_MS) return;
  lastTouchAt.set(userId, now);
  void writePresence(userId, ip);
}

/** Strip presence/location fields from a user document before it leaves the API. */
export function stripPresence<T extends Record<string, unknown>>(user: T): T {
  const { lastSeenAt, lastSeenIp, lastSeenGeo, ...safe } = user;
  return safe as T;
}
