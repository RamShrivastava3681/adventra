// ---------------------------------------------------------------------------
// E-Way Bill Direct NIC API Client (v1.03)
// ---------------------------------------------------------------------------
// Replaces the WhiteBooksGspConnector with direct calls to the NIC
// E-Way Bill System. Handles:
//   • Authentication (encrypt credentials, get access token + SEK)
//   • Token caching and auto-refresh on expiry
//   • Request encryption (AES/CBC with SEK)
//   • Response decryption
//   • Exponential back-off retries on transient errors
//   • Structured error handling
//
// Architecture:
//   WhizUnik Backend → NIC E-Way Bill API (direct, no GSP proxy)
//
// Reference: https://docs.ewaybillgst.gov.in/apidocs/version1.03/
// ---------------------------------------------------------------------------

import {
  ewayBillConfig,
  ewayBillBaseUrl,
  ewayBillAuthUrl,
  ewayBillGenerateUrl,
  ewayBillCancelUrl,
  ewayBillGetDetailsUrl,
  ewayBillUpdatePartBUrl,
  ewayBillExtendUrl,
} from "../config/eway-bill.js";
import {
  generateAppKey,
  buildAuthPayload,
  decryptSek,
  encryptWithSek,
  decryptWithSek,
  encodeBase64,
  decodeBase64,
} from "./eway-bill-crypto.js";
import {
  type EwbCredential,
  type EwbEnvironment,
  getDecryptedCredentials,
  storeAuthToken,
  isTokenExpired,
  decryptAtRest,
} from "./eway-bill-credentials.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** Cached token state per credential ID. */
interface TokenCache {
  credentialId: string;
  accessToken: string;
  sek: string;
  appKeyRaw: Buffer;
  /** Epoch ms when the token expires. We refresh 5 min early. */
  expiresAt: number;
}

/** Standard error shape from the direct NIC API. */
export interface NicApiError {
  errorCode: string;
  errorMessage: string;
  raw?: any;
}

/** Result of a successful EWB generation call. */
export interface GenerateEwbResult {
  /** 12-digit EWB number assigned by NIC. */
  ewbNo: number;
  /** Unique request ID. */
  ewayBillRequestId: string | null;
  /** EWB generation date (DD/MM/YYYY). */
  ewayBillDate: string;
  /** Valid until date (DD/MM/YYYY). */
  validUpto: string;
  /** Alert message, if any. */
  alert: string | null;
  /** Raw response for audit. */
  raw: any;
}

/** Result of a Part-B update call. */
export interface UpdatePartBResult {
  ewbNo: number;
  vehicleNo: string;
  updatedDate: string;
  raw: any;
}

/** Result of a cancellation call. */
export interface CancelEwbResult {
  ewbNo: number;
  cancelledDate: string;
  raw: any;
}

/** Result of a validity extension call. */
export interface ExtendEwbResult {
  ewbNo: number;
  newValidUpto: string;
  raw: any;
}

/** Result of fetching EWB details. */
export interface EwbDetailsResult {
  ewbNo: number;
  supplyType: string;
  docType: string;
  docNo: string;
  docDate: string;
  fromGstin: string;
  toGstin: string;
  totalValue: number;
  cgstValue: number;
  sgstValue: number;
  igstValue: number;
  cessValue: number;
  totInvValue: number;
  status: string;
  generatedDate: string;
  validUpto: string;
  transporterName: string | null;
  vehicleNo: string | null;
  raw: any;
}

// ── NIC EWB Request/Response Shapes (v1.03) ─────────────────────────────────

interface NicGenerateRequest {
  supplyType: "O" | "I";
  subSupplyType: string;
  subSupplyDesc?: string;
  docType: "INV" | "CHL" | "BIL" | "BOE" | "CNT" | "OTH";
  docNo: string;
  docDate: string; // DD/MM/YYYY
  fromGstin: string;
  fromTrdName?: string;
  fromAddr1?: string;
  fromAddr2?: string;
  fromPlace?: string;
  actFromStateCode: number;
  fromPincode: number;
  fromStateCode: number;
  toGstin: string;
  toTrdName?: string;
  toAddr1?: string;
  toAddr2?: string;
  toPlace?: string;
  toPincode: number;
  actToStateCode: number;
  toStateCode: number;
  transactionType: number;
  totalValue: number;
  cgstValue: number;
  sgstValue: number;
  igstValue: number;
  cessValue: number;
  totInvValue: number;
  otherValue?: number;
  transMode: "1" | "2" | "3" | "4";
  transDistance: string;
  transporterName?: string;
  transporterId?: string;
  transDocNo?: string;
  transDocDate?: string;
  vehicleNo?: string;
  vehicleType?: string;
  itemList: Array<{
    productName: string;
    productDesc?: string;
    hsnCode: number;
    quantity: number;
    qtyUnit: string;
    taxableAmount: number;
    sgstRate: number;
    cgstRate: number;
    igstRate: number;
    cessRate: number;
    cessNonadvol?: number;
  }>;
}

interface NicPartBRequest {
  ewbNo: number;
  vehicleNo: string;
  fromPlace: string;
  fromState: number;
  reasonCode: string;
  reasonRem: string;
  transMode: string;
  transDocNo?: string;
  transDocDate?: string;
}

interface NicCancelRequest {
  ewbNo: number;
  cancelReason: string;
  cancelRemarks: string;
}

interface NicExtendRequest {
  ewbNo: number;
  fromPlace: string;
  fromState: number;
  remainingDistance: number;
  transMode: string;
  reasonCode: string;
  reasonRem: string;
}

// ── Transport Mode Mapping ──────────────────────────────────────────────────

const TRANSPORT_MODE_MAP: Record<string, "1" | "2" | "3" | "4"> = {
  road: "1",
  rail: "2",
  air: "3",
  ship: "4",
};

// ── Direct NIC API Client ──────────────────────────────────────────────────

export class EwayBillDirectClient {
  private tokenCaches: Map<string, TokenCache> = new Map();

  // ── Authentication ─────────────────────────────────────────────────────

  /**
   * Authenticate with the NIC E-Way Bill System and get an access token.
   *
   * Per NIC v1.03:
   *   1. Generate a random 256-bit app_key
   *   2. Build credentials JSON { action, username, password, app_key }
   *   3. Base64 encode the JSON
   *   4. Encrypt with NIC EWB public key (RSA/ECB/PKCS1)
   *   5. POST encrypted data to auth endpoint with client-id/secret headers
   *   6. Receive { authtoken, sek } where sek is encrypted with app_key
   *   7. Decrypt SEK using app_key (AES/ECB)
   *
   * @param credentialId - The EwbCredential record ID
   * @returns Decrypted SEK (for subsequent API calls) and access token
   */
  async authenticate(credentialId: string): Promise<{
    accessToken: string;
    sek: string;
    expiresInSec: number;
  }> {
    const creds = await getDecryptedCredentials(credentialId);
    if (!creds) throw new EwbClientError("E-Way Bill credentials not found", "CREDENTIALS_NOT_FOUND");

    if (!ewayBillConfig.publicKey) {
      throw new EwbClientError(
        "NIC EWB public key not configured. Set EWB_API_PUBLIC_KEY in environment.",
        "PUBLIC_KEY_MISSING",
      );
    }

    // 1. Generate app_key
    const appKey = generateAppKey();

    // 2. Build and encrypt auth payload
    const encryptedPayload = buildAuthPayload(
      creds.apiUsername,
      creds.apiPassword,
      appKey.base64,
      ewayBillConfig.publicKey,
    );

    // 3. POST to auth endpoint
    const authUrl = ewayBillAuthUrl();
    const response = await this.rawRequest("POST", authUrl, {
      Data: encryptedPayload,
    }, {
      "client-id": creds.apiClientId,
      "client-secret": creds.clientSecret,
      "gstin": creds.gstin,
      "Content-Type": "application/json",
    });

    // 4. Parse auth response
    if (response.status !== "1" && response.status !== 1) {
      const errorMsg = response.error || response.ErrorMessage || response.message || "Authentication failed";
      throw new EwbClientError(
        `Authentication failed: ${errorMsg}`,
        "AUTH_FAILED",
        response,
      );
    }

    if (!response.authtoken || !response.sek) {
      throw new EwbClientError(
        "Invalid auth response: missing authtoken or sek",
        "INVALID_AUTH_RESPONSE",
        response,
      );
    }

    // 5. Decrypt SEK using app_key
    const decryptedSek = decryptSek(response.sek, appKey.raw);

    // 6. Store token in credential record
    const expiresInSec = ewayBillConfig.tokenValiditySec;
    await storeAuthToken(credentialId, response.authtoken, decryptedSek, appKey.base64, expiresInSec);

    // 7. Cache locally
    this.tokenCaches.set(credentialId, {
      credentialId,
      accessToken: response.authtoken,
      sek: decryptedSek,
      appKeyRaw: appKey.raw,
      expiresAt: Date.now() + expiresInSec * 1000,
    });

    return {
      accessToken: response.authtoken,
      sek: decryptedSek,
      expiresInSec,
    };
  }

  /**
   * Get a valid access token, re-authenticating if expired.
   */
  async getValidToken(credentialId: string): Promise<{
    accessToken: string;
    sek: string;
  }> {
    // Check local cache first
    const cached = this.tokenCaches.get(credentialId);
    if (cached && Date.now() < cached.expiresAt - ewayBillConfig.tokenRefreshBufferMs) {
      return { accessToken: cached.accessToken, sek: cached.sek };
    }

    // Re-authenticate
    const result = await this.authenticate(credentialId);
    return { accessToken: result.accessToken, sek: result.sek };
  }

  // ── HTTP Helpers ───────────────────────────────────────────────────────

  /**
   * Make an authenticated, encrypted request to the NIC API.
   */
  private async request<T>(
    method: "GET" | "POST",
    endpoint: string,
    payload: Record<string, any>,
    credentialId: string,
  ): Promise<T> {
    const creds = await getDecryptedCredentials(credentialId);
    if (!creds) throw new EwbClientError("Credentials not found", "CREDENTIALS_NOT_FOUND");

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= ewayBillConfig.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = ewayBillConfig.retryBaseDelayMs * Math.pow(2, attempt - 1);
          await sleep(delay);
        }

        // Get valid token (auto-refresh if needed)
        const { accessToken, sek } = await this.getValidToken(credentialId);

        // Encrypt payload with SEK
        const encryptedPayload = encryptWithSek(payload, sek);

        // Build request headers
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "gstin": creds.gstin,
          "authtoken": accessToken,
          "ip_address": "0.0.0.0", // NIC requires this header
        };

        // Make the request
        const url = `${ewayBillBaseUrl()}${ewayBillConfig.apiVersion}${endpoint}`;
        const response = await this.rawRequest("POST", url, {
          data: {
            Content: encryptedPayload,
          },
        }, headers);

        // Decrypt response
        if (response.data && response.data.Content) {
          return decryptWithSek<T>(response.data.Content, sek);
        }

        // Some endpoints may return unencrypted responses (e.g., errors)
        return response as T;
      } catch (err: any) {
        lastError = err;

        // Don't retry on auth errors
        if (err instanceof EwbClientError) {
          if (err.code === "AUTH_FAILED" || err.code === "CREDENTIALS_NOT_FOUND") throw err;
          if (err.code?.startsWith("HTTP_4") && err.code !== "HTTP_429") throw err;
        }

        // Don't retry on the last attempt
        if (attempt === ewayBillConfig.maxRetries) break;
      }
    }

    throw lastError || new EwbClientError("Max retries exceeded", "MAX_RETRIES");
  }

  /**
   * Make a raw HTTP request without encryption.
   * Used for authentication endpoint.
   */
  private async rawRequest(
    method: "GET" | "POST",
    url: string,
    body?: any,
    headers?: Record<string, string>,
  ): Promise<any> {
    const fetchHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...headers,
    };

    const fetchOptions: RequestInit = {
      method,
      headers: fetchHeaders,
      signal: AbortSignal.timeout(ewayBillConfig.timeoutMs),
    };

    if (body && method !== "GET") {
      fetchOptions.body = JSON.stringify(body);
    }

    const res = await fetch(url, fetchOptions);
    const text = await res.text();

    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    if (!res.ok) {
      throw new EwbClientError(
        `API error (${res.status}): ${typeof data === "string" ? data : JSON.stringify(data)}`,
        `HTTP_${res.status}`,
        data,
      );
    }

    // Check for business-level errors
    if (data && typeof data === "object") {
      if (data.error || data.errorCode || data.status === "error" || data.status === "0") {
        throw new EwbClientError(
          data.errorMessage || data.error || data.message || "Unknown API error",
          data.errorCode || "API_ERROR",
          data,
        );
      }
    }

    return data;
  }

  // ── EWB API Methods ──────────────────────────────────────────────────

  /**
   * Generate an E-Way Bill via the NIC API.
   */
  async generateEwb(
    credentialId: string,
    payload: Omit<NicGenerateRequest, "action">,
  ): Promise<GenerateEwbResult> {
    const res = await this.request<any>(
      "POST",
      ewayBillConfig.endpoints.generate,
      payload as Record<string, any>,
      credentialId,
    );

    return {
      ewbNo: res.ewayBillNo || res.ewbNo || res.billNo,
      ewayBillRequestId: res.ewayBillRequestId || res.requestId || null,
      ewayBillDate: res.ewayBillDate || res.billDate || "",
      validUpto: res.validUpto || res.validUntil || "",
      alert: res.alert || null,
      raw: res,
    };
  }

  /**
   * Update Part-B (vehicle assignment) on an existing EWB.
   */
  async updatePartB(
    credentialId: string,
    payload: NicPartBRequest,
  ): Promise<UpdatePartBResult> {
    const res = await this.request<any>(
      "POST",
      ewayBillConfig.endpoints.updatePartB,
      payload as Record<string, any>,
      credentialId,
    );

    return {
      ewbNo: res.ewayBillNo || payload.ewbNo,
      vehicleNo: payload.vehicleNo,
      updatedDate: res.updatedDate || new Date().toISOString(),
      raw: res,
    };
  }

  /**
   * Cancel an E-Way Bill (must be within the NIC cancellation window).
   */
  async cancelEwb(
    credentialId: string,
    payload: NicCancelRequest,
  ): Promise<CancelEwbResult> {
    const res = await this.request<any>(
      "POST",
      ewayBillConfig.endpoints.cancel,
      payload as Record<string, any>,
      credentialId,
    );

    return {
      ewbNo: payload.ewbNo,
      cancelledDate: res.cancelledDate || new Date().toISOString(),
      raw: res,
    };
  }

  /**
   * Extend the validity of an E-Way Bill.
   */
  async extendValidity(
    credentialId: string,
    payload: NicExtendRequest,
  ): Promise<ExtendEwbResult> {
    const res = await this.request<any>(
      "POST",
      ewayBillConfig.endpoints.extendValidity,
      payload as Record<string, any>,
      credentialId,
    );

    return {
      ewbNo: payload.ewbNo,
      newValidUpto: res.validUpto || res.newValidUpto || "",
      raw: res,
    };
  }

  /**
   * Get E-Way Bill details by EWB number.
   */
  async getEwbDetails(
    credentialId: string,
    ewbNo: number,
  ): Promise<EwbDetailsResult> {
    const res = await this.request<any>(
      "POST",
      ewayBillConfig.endpoints.getDetails,
      { ewbNo },
      credentialId,
    );

    return {
      ewbNo: res.ewayBillNo || ewbNo,
      supplyType: res.supplyType || "",
      docType: res.docType || "",
      docNo: res.docNo || "",
      docDate: res.docDate || "",
      fromGstin: res.fromGstin || "",
      toGstin: res.toGstin || "",
      totalValue: res.totalValue || 0,
      cgstValue: res.cgstValue || 0,
      sgstValue: res.sgstValue || 0,
      igstValue: res.igstValue || 0,
      cessValue: res.cessValue || 0,
      totInvValue: res.totInvValue || 0,
      status: res.status || res.ewbStatus || "",
      generatedDate: res.ewayBillDate || "",
      validUpto: res.validUpto || "",
      transporterName: res.transporterName || null,
      vehicleNo: res.vehicleNo || null,
      raw: res,
    };
  }

  /**
   * Test connection — attempt authentication and return status.
   */
  async testConnection(credentialId: string): Promise<{
    success: boolean;
    message: string;
    environment: string;
  }> {
    try {
      const result = await this.authenticate(credentialId);
      return {
        success: true,
        message: `Successfully authenticated. Token valid for ${Math.round(result.expiresInSec / 3600)} hours.`,
        environment: ewayBillConfig.environment,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || "Authentication failed",
        environment: ewayBillConfig.environment,
      };
    }
  }
}

// ── Error Class ─────────────────────────────────────────────────────────────

export class EwbClientError extends Error {
  code: string;
  raw?: any;

  constructor(message: string, code: string, raw?: any) {
    super(message);
    this.name = "EwbClientError";
    this.code = code;
    this.raw = raw;
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

let _instance: EwayBillDirectClient | null = null;

export function getDirectClient(): EwayBillDirectClient {
  if (!_instance) {
    _instance = new EwayBillDirectClient();
  }
  return _instance;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Re-export types for backward compatibility ───────────────────────────────

// These are kept so the service layer doesn't need major changes
export { mapTransportMode, determineTransactionType, determineSupplyType } from "./eway-bill-gsp-compat.js";

// ── Date Helpers ─────────────────────────────────────────────────────────────

/** Convert YYYY-MM-DD to DD/MM/YYYY (NIC format). */
export function toNicDate(isoDate: string): string {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

/** Convert DD/MM/YYYY (NIC format) to YYYY-MM-DD. */
export function fromNicDate(nicDate: string): string {
  if (!nicDate) return "";
  const [d, m, y] = nicDate.split("/");
  return `${y}-${m}-${d}`;
}
