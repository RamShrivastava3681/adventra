// ---------------------------------------------------------------------------
// E-Way Bill Configuration — Direct NIC API (v1.03)
// ---------------------------------------------------------------------------
// Configuration for the direct taxpayer → NIC E-Way Bill System integration.
// Replaces the previous WhiteBooks GSP-based configuration.
//
// Environment separation:
//   EWB_API_ENV = "sandbox" | "preproduction" | "production"
//
// Credentials are stored per-GSTIN in the EwbCredential model, NOT in
// environment variables. Environment variables only contain:
//   - API endpoint URLs
//   - NIC EWB public key for encryption
//   - Server-level encryption key for credential storage
//
// Reference: https://docs.ewaybillgst.gov.in/apidocs/
// ---------------------------------------------------------------------------

export const ewayBillConfig = {
  // ── Environment ────────────────────────────────────────────────────────
  /** Current environment — determines which NIC API base URL is used. */
  environment: (process.env.EWB_API_ENV || "sandbox") as
    | "sandbox"
    | "preproduction"
    | "production",

  // ── NIC E-Way Bill API Base URLs ───────────────────────────────────────
  /** Direct NIC API base URLs (NOT GSP proxy URLs). */
  baseUrls: {
    sandbox: "https://esandbox.ewaybillgst.gov.in",
    preproduction: "https://preprod.ewaybillgst.gov.in",
    production: "https://ewaybillgst.gov.in",
  } as Record<string, string>,

  /** API version path prefix. */
  apiVersion: "/gsp/ewaybillapi/v1.03",

  // ── NIC EWB Public Key ────────────────────────────────────────────────
  /**
   * The NIC EWB public key (PEM format) used to encrypt authentication
   * credentials. This is provided by the E-Way Bill System during onboarding.
   *
   * For sandbox/preproduction, use the sandbox public key.
   * For production, use the production public key.
   *
   * In PEM format with newlines:
   * -----BEGIN PUBLIC KEY-----
   * MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...
   * -----END PUBLIC KEY-----
   */
  publicKey: process.env.EWB_API_PUBLIC_KEY || "",

  // ── API Endpoint Paths (NIC v1.03) ────────────────────────────────────
  endpoints: {
    /** Authenticate and get access token + SEK. */
    auth: "/ewayapi/auth",
    /** Generate a new E-Way Bill. */
    generate: "/ewayapi/generateEwayBill",
    /** Update Part-B (vehicle assignment). */
    updatePartB: "/ewayapi/updatePartB",
    /** Cancel an E-Way Bill. */
    cancel: "/ewayapi/canEwayBill",
    /** Get E-Way Bill details by EWB number. */
    getDetails: "/ewayapi/getewaybill",
    /** Get GSTIN details from the portal. */
    getGstinDetails: "/ewayapi/getgstiniDdetails",
    /** Extend E-Way Bill validity. */
    extendValidity: "/ewayapi/extendValidity",
    /** Get E-Way Bills assigned to transporter. */
    getEwbByTransporter: "/ewayapi/getewbByTransporter",
    /** Reject an E-Way Bill. */
    rejectEwb: "/ewayapi/rejectewb",
  } as Record<string, string>,

  // ── NIC Header Fields ──────────────────────────────────────────────────
  /**
   * These headers are required by the NIC API for every request.
   * gstin, authtoken are per-request (from credential store).
   * ip_address is the client's IP (for NIC audit trail).
   */
  requiredHeaders: {
    /** GSTIN header name expected by NIC. */
    gstinHeader: "gstin",
    /** Auth token header name. */
    authTokenHeader: "authtoken",
    /** IP address header. NIC requires this for audit. */
    ipAddressHeader: "ip_address",
  },

  // ── Request Tuning ─────────────────────────────────────────────────────
  /** Max retries on transient failures (429, 500, 502, 503). */
  maxRetries: 3,
  /** Base delay (ms) between retries — doubles each attempt. */
  retryBaseDelayMs: 1000,
  /** Request timeout (ms). */
  timeoutMs: 30_000,

  // ── Business Rules ─────────────────────────────────────────────────────
  /** Minimum taxable value (₹) for mandatory EWB generation. */
  threshold: 50_000,
  /** Default validity period (days). */
  defaultValidityDays: 1,
  /** Distance bands that determine validity. */
  validityBands: [
    { upToKm: 50, days: 1 },
    { upToKm: 300, days: 3 },
    { upToKm: 500, days: 5 },
    { upToKm: Infinity, days: 10 },
  ],

  // ── Token Management ───────────────────────────────────────────────────
  /** Access token validity in seconds (NIC default: 6 hours). */
  tokenValiditySec: 21600,
  /** Refresh token 5 minutes before expiry. */
  tokenRefreshBufferMs: 5 * 60 * 1000,

  // ── Production Prerequisites ───────────────────────────────────────────
  /** Requirements that must be met before production activation. */
  productionPrerequisites: [
    "Automated invoice generation system in place",
    "Minimum API transaction volume requirements met",
    "SSL/TLS certificate on domain",
    "Indian static IP address configured",
    "Pre-production testing completed and approved",
    "API testing report submitted to NIC",
  ],
} as const;

// ── Convenience Functions ─────────────────────────────────────────────────

/** Get the base URL for the current environment. */
export function ewayBillBaseUrl(): string {
  return ewayBillConfig.baseUrls[ewayBillConfig.environment] ||
    ewayBillConfig.baseUrls.sandbox;
}

/** Get the full endpoint URL for a given path. */
export function ewayBillEndpoint(path: string): string {
  return `${ewayBillBaseUrl()}${ewayBillConfig.apiVersion}${path}`;
}

/** Get the auth endpoint URL. */
export function ewayBillAuthUrl(): string {
  return ewayBillEndpoint(ewayBillConfig.endpoints.auth);
}

/** Get the generate EWB endpoint URL. */
export function ewayBillGenerateUrl(): string {
  return ewayBillEndpoint(ewayBillConfig.endpoints.generate);
}

/** Get the cancel EWB endpoint URL. */
export function ewayBillCancelUrl(): string {
  return ewayBillEndpoint(ewayBillConfig.endpoints.cancel);
}

/** Get the get details endpoint URL. */
export function ewayBillGetDetailsUrl(): string {
  return ewayBillEndpoint(ewayBillConfig.endpoints.getDetails);
}

/** Get the update Part-B endpoint URL. */
export function ewayBillUpdatePartBUrl(): string {
  return ewayBillEndpoint(ewayBillConfig.endpoints.updatePartB);
}

/** Get the extend validity endpoint URL. */
export function ewayBillExtendUrl(): string {
  return ewayBillEndpoint(ewayBillConfig.endpoints.extendValidity);
}

/** Calculate validity days based on distance (km). */
export function validityDaysForDistance(distanceKm: number): number {
  for (const band of ewayBillConfig.validityBands) {
    if (distanceKm <= band.upToKm) return band.days;
  }
  return 10; // fallback
}
