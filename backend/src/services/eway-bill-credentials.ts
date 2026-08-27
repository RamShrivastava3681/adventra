// ---------------------------------------------------------------------------
// E-Way Bill Credential Model — Multi-Tenant API Configuration
// ---------------------------------------------------------------------------
// Stores per-GSTIN E-Way Bill API credentials for the direct taxpayer →
// NIC E-Way Bill System integration. Each company/GST registration gets
// its own credential record. Sensitive fields (client secret, API password,
// access token, SEK) are encrypted at rest using AES-256-CBC.
// ---------------------------------------------------------------------------

import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// ── Types ────────────────────────────────────────────────────────────────────

export type EwbEnvironment = "sandbox" | "preproduction" | "production";

export type OnboardingStatus =
  | "NOT_CONFIGURED"       // No credentials saved
  | "CONFIGURED"           // Credentials saved but not yet authenticated
  | "AUTHENTICATED"        // Successfully authenticated to NIC
  | "AUTHENTICATION_FAILED" // Last auth attempt failed
  | "PRE_PRODUCTION"       // Pre-production API access enabled
  | "PRODUCTION"           // Production API access enabled
  | "DISABLED";            // Manually disabled by admin

export interface EwbCredential {
  // ── DynamoDB keys ──
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "EwbCredential";

  id: string;
  /** Tenant/company ID — the WhizUnik user/client who owns these credentials. */
  clientId: string;

  /** 15-digit GSTIN registered for E-Way Bill generation. */
  gstin: string;

  /** Client ID provided by the E-Way Bill System after direct API onboarding. */
  apiClientId: string;

  /** Encrypted client secret (AES-256-CBC). Never stored in plaintext. */
  encryptedClientSecret: string;

  /** E-Way Bill API username (not encrypted — it's not a secret per NIC spec). */
  apiUsername: string;

  /** Encrypted API password (AES-256-CBC). Never stored in plaintext. */
  encryptedApiPassword: string;

  /** Encrypted access token (AES-256-CBC). Set after successful authentication. */
  encryptedAccessToken: string | null;

  /** Encrypted SEK (AES-256-CBC). Set after successful authentication. */
  encryptedSek: string | null;

  /** Hash of the app_key used for this credential (for auditing, not for decryption). */
  appKeyHash: string | null;

  /** Decrypted app_key as raw hex — needed for SEK decryption on subsequent requests.
   *  Stored encrypted with a server-level key (the client secret encryption key). */
  encryptedAppKey: string | null;

  /** When the access token expires. ISO timestamp. */
  tokenExpiresAt: string | null;

  /** Environment: sandbox, preproduction, or production. */
  environment: EwbEnvironment;

  /** Current onboarding/connection status. */
  onboardingStatus: OnboardingStatus;

  /** Timestamp of last successful authentication. */
  lastAuthAt: string | null;

  /** Last authentication error message (if any). Never expose secrets. */
  lastAuthError: string | null;

  /** Last time this credential was tested. */
  lastTestedAt: string | null;

  /** Whether this credential is the active one for this GSTIN. */
  isActive: boolean;

  createdAt: string;
  updatedAt: string;
}

// ── Encryption Helpers (at-rest encryption for credential fields) ─────────────

/**
 * Server-level encryption key for storing credentials at rest.
 * In production, this should come from a KMS / HSM.
 * For development, we derive it from a config env var.
 */
function getServerEncryptionKey(): Buffer {
  const keyHex = process.env.EWB_CREDENTIAL_ENCRYPTION_KEY || "";
  if (!keyHex) {
    // Fallback: derive from JWT_SECRET (NOT recommended for production)
    const { createHash } = require("node:crypto");
    const fallback = createHash("sha256")
      .update(process.env.JWT_SECRET || "dev-credential-key-change-in-prod")
      .digest();
    return fallback;
  }
  return Buffer.from(keyHex, "hex");
}

function encryptAtRest(plaintext: string): string {
  if (!plaintext) return "";
  const key = getServerEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  // Prepend IV (hex) + ":" + ciphertext (hex)
  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptAtRest(encryptedHex: string): string {
  if (!encryptedHex) return "";
  const [ivHex, cipherHex] = encryptedHex.split(":");
  if (!ivHex || !cipherHex) return "";
  const key = getServerEncryptionKey();
  const iv = Buffer.from(ivHex, "hex");
  const cipherBuf = Buffer.from(cipherHex, "hex");
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  const decrypted = Buffer.concat([decipher.update(cipherBuf), decipher.final()]);
  return decrypted.toString("utf-8");
}

export { encryptAtRest, decryptAtRest };

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function list(clientId: string): Promise<EwbCredential[]> {
  const { items } = await db.queryByGSI1(clientId, {
    entityType: "EwbCredential",
    limit: 100,
    reverse: true,
  });
  return items as EwbCredential[];
}

export async function get(id: string): Promise<EwbCredential | null> {
  return db.getItem(`EWB_CRED#${id}`) as Promise<EwbCredential | null>;
}

export async function getByClientIdAndGstin(
  clientId: string,
  gstin: string,
): Promise<EwbCredential | null> {
  const items = await list(clientId);
  return items.find((c) => c.gstin === gstin && c.isActive) ?? null;
}

export async function create(
  data: Partial<EwbCredential> & {
    clientId: string;
    gstin: string;
    apiClientId: string;
    clientSecret: string;
    apiUsername: string;
    apiPassword: string;
  },
): Promise<EwbCredential> {
  const id = uuid();
  const now = db.nowISO();

  const item: EwbCredential = {
    pk: `EWB_CRED#${id}`,
    sk: `EWB_CRED#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`,
    gsi1sk: `EwbCredential#${now}`,
    entityType: "EwbCredential",
    id,
    clientId: data.clientId,
    gstin: data.gstin,
    apiClientId: data.apiClientId,
    encryptedClientSecret: encryptAtRest(data.clientSecret),
    apiUsername: data.apiUsername,
    encryptedApiPassword: encryptAtRest(data.apiPassword),
    encryptedAccessToken: null,
    encryptedSek: null,
    appKeyHash: null,
    encryptedAppKey: null,
    tokenExpiresAt: null,
    environment: data.environment || "sandbox",
    onboardingStatus: "CONFIGURED",
    lastAuthAt: null,
    lastAuthError: null,
    lastTestedAt: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  await db.putItem(item);
  return item;
}

export async function update(
  id: string,
  updates: Partial<EwbCredential>,
): Promise<EwbCredential | null> {
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  const allowed = [
    "gstin", "apiClientId", "apiUsername", "environment",
    "onboardingStatus", "lastAuthAt", "lastAuthError", "lastTestedAt", "isActive",
  ];

  for (const k of allowed) {
    if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k];
  }

  // Handle encrypted fields separately
  if (updates.encryptedClientSecret !== undefined) {
    patch.encryptedClientSecret = updates.encryptedClientSecret;
  }
  if (updates.encryptedApiPassword !== undefined) {
    patch.encryptedApiPassword = updates.encryptedApiPassword;
  }
  if (updates.encryptedAccessToken !== undefined) {
    patch.encryptedAccessToken = updates.encryptedAccessToken;
  }
  if (updates.encryptedSek !== undefined) {
    patch.encryptedSek = updates.encryptedSek;
  }
  if (updates.encryptedAppKey !== undefined) {
    patch.encryptedAppKey = updates.encryptedAppKey;
  }
  if (updates.appKeyHash !== undefined) {
    patch.appKeyHash = updates.appKeyHash;
  }
  if (updates.tokenExpiresAt !== undefined) {
    patch.tokenExpiresAt = updates.tokenExpiresAt;
  }

  await db.updateItem(`EWB_CRED#${id}`, `EWB_CRED#${id}`, patch);
  return get(id);
}

export async function remove(id: string): Promise<void> {
  await db.deleteItem(`EWB_CRED#${id}`);
}

// ── Convenience: Store Auth Token ────────────────────────────────────────────

/**
 * Store the access token and SEK after successful authentication.
 * Both are encrypted at rest before being stored.
 */
export async function storeAuthToken(
  id: string,
  accessToken: string,
  sek: string,
  appKey: string,
  expiresInSec: number = 21600, // 6 hours default
): Promise<EwbCredential | null> {
  const expiresAt = new Date(Date.now() + expiresInSec * 1000).toISOString();
  return update(id, {
    encryptedAccessToken: encryptAtRest(accessToken),
    encryptedSek: encryptAtRest(sek),
    encryptedAppKey: encryptAtRest(appKey),
    tokenExpiresAt: expiresAt,
    onboardingStatus: "AUTHENTICATED",
    lastAuthAt: db.nowISO(),
    lastAuthError: null,
  });
}

// ── Convenience: Retrieve Decrypted Secrets ──────────────────────────────────

/**
 * Retrieve the decrypted credentials for API calls.
 * Returns null if the credential record doesn't exist.
 *
 * WARNING: The returned values are sensitive. Never log or expose them.
 */
export async function getDecryptedCredentials(id: string): Promise<{
  gstin: string;
  apiClientId: string;
  clientSecret: string;
  apiUsername: string;
  apiPassword: string;
  accessToken: string | null;
  sek: string | null;
  appKey: string | null;
  tokenExpiresAt: string | null;
  environment: EwbEnvironment;
} | null> {
  const cred = await get(id);
  if (!cred) return null;

  return {
    gstin: cred.gstin,
    apiClientId: cred.apiClientId,
    clientSecret: decryptAtRest(cred.encryptedClientSecret),
    apiUsername: cred.apiUsername,
    apiPassword: decryptAtRest(cred.encryptedApiPassword),
    accessToken: cred.encryptedAccessToken ? decryptAtRest(cred.encryptedAccessToken) : null,
    sek: cred.encryptedSek ? decryptAtRest(cred.encryptedSek) : null,
    appKey: cred.encryptedAppKey ? decryptAtRest(cred.encryptedAppKey) : null,
    tokenExpiresAt: cred.tokenExpiresAt,
    environment: cred.environment,
  };
}

// ── Convenience: Check if Token is Expired ───────────────────────────────────

export function isTokenExpired(cred: EwbCredential): boolean {
  if (!cred.tokenExpiresAt) return true;
  // Consider expired 5 minutes before actual expiry (safety margin)
  return Date.now() >= new Date(cred.tokenExpiresAt).getTime() - 5 * 60 * 1000;
}
