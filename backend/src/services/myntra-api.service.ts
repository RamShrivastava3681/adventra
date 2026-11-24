/**
 * Myntra Seller API V4 client (Pretr OMS).
 *
 * Covers every inbound API in Myntra's "Mockify Contracts" sheet. Each call is
 * logged as the latest result for its sheet row (column A name), so the
 * dashboard can show — and export — the real response for column D.
 *
 * Auth: POST /authorization/generate_token with header `secret_key` and body
 * { merchant_id }. Myntra returns the tokens in the RESPONSE HEADERS
 * `access_token` / `refresh_token` (valid 30 days).
 */
import { config } from "../config.js";
import * as MyntraModel from "../models/marketplace-myntra.js";

export type Json = any;

export interface MyntraCallResult {
  api: string;
  httpStatus: number | null;
  ok: boolean;
  json: Json | null;
  text: string;
  buffer: Buffer | null;
  contentType: string;
  headers: Record<string, string>;
  error: string | null;
}

/** Endpoint object Mockify uses to push events to our outbound APIs. */
export interface MyntraEndpoint {
  url: string;
  headers: Record<string, string>;
  method: "POST" | "PUT" | "GET";
}

const TIMEOUT_MS = 30_000;

let accessToken: string | null = null;
let refreshToken: string | null = null;
let tokenIssuedAt = 0;
const TOKEN_TTL_MS = 29 * 24 * 60 * 60 * 1000; // Myntra: valid 30 days

export function tokenState() {
  return {
    hasAccessToken: Boolean(accessToken),
    issuedAt: tokenIssuedAt ? new Date(tokenIssuedAt).toISOString() : null,
  };
}

function mask(value: string | null | undefined): string {
  if (!value) return "";
  return value.length <= 8 ? "****" : `${value.slice(0, 4)}…${value.slice(-4)} (masked)`;
}

function isBinary(contentType: string) {
  return /application\/(pdf|octet-stream)|image\//i.test(contentType);
}

/** Myntra marks failures in the body with statusType "ERROR" even on some 200s. */
function bodyIsError(json: Json | null): boolean {
  if (!json || typeof json !== "object") return false;
  const type = String(json.statusType ?? json.status ?? "").toUpperCase();
  return type === "ERROR" || type === "FAILURE" || type === "FAILED";
}

interface CallOptions {
  method: "GET" | "POST" | "PUT";
  path: string;
  body?: unknown;
  /** Send access_token (default true). */
  auth?: boolean;
  /** x-partner-store value; the sheet uses "MYNTRA" for a few calls. */
  partnerStore?: string;
  /** Send the mocking-partner-name header (stage testing only). */
  mocking?: boolean;
  headers?: Record<string, string>;
}

async function rawCall(api: string, opts: CallOptions, retried = false): Promise<MyntraCallResult> {
  const url = `${config.myntra.apiDomain}${opts.path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-partner-store": opts.partnerStore ?? config.myntra.partnerStore,
    ...(opts.headers ?? {}),
  };
  if (opts.auth !== false) {
    const token = await getAccessToken();
    headers["access_token"] = token;
  }
  if (opts.mocking && config.myntra.mockingPartnerName) {
    headers["mocking-partner-name"] = config.myntra.mockingPartnerName;
  }

  const requestBody = opts.body === undefined ? "" : JSON.stringify(opts.body);
  const started = Date.now();
  let result: MyntraCallResult;
  try {
    const res = await fetch(url, {
      method: opts.method,
      headers,
      body: opts.body === undefined ? undefined : requestBody,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const contentType = res.headers.get("content-type") ?? "";
    const outHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      outHeaders[k] = v;
    });
    let text = "";
    let buffer: Buffer | null = null;
    let json: Json | null = null;
    if (isBinary(contentType)) {
      buffer = Buffer.from(await res.arrayBuffer());
      text = `<${contentType || "binary"} file, ${buffer.length} bytes>`;
    } else {
      text = await res.text();
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
    }
    result = {
      api,
      httpStatus: res.status,
      ok: res.ok && !bodyIsError(json),
      json,
      text,
      buffer,
      contentType,
      headers: outHeaders,
      error: null,
    };
  } catch (err: any) {
    result = {
      api,
      httpStatus: null,
      ok: false,
      json: null,
      text: "",
      buffer: null,
      contentType: "",
      headers: {},
      error: err?.name === "TimeoutError" ? `Timed out after ${TIMEOUT_MS / 1000}s` : String(err?.message ?? err),
    };
  }

  // Token expired / revoked → get a fresh one and retry once.
  if (result.httpStatus === 401 && opts.auth !== false && !retried) {
    accessToken = null;
    return rawCall(api, opts, true);
  }

  const shownHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(result.headers)) {
    if (k === "access_token" || k === "refresh_token") shownHeaders[k] = mask(v);
    else if (k === "content-type") shownHeaders[k] = v;
  }

  await MyntraModel.saveApiCall({
    api,
    method: opts.method,
    url,
    requestBody,
    httpStatus: result.httpStatus,
    ok: result.ok,
    responseBody: result.text,
    responseHeaders: JSON.stringify(shownHeaders),
    error: result.error,
    durationMs: Date.now() - started,
    calledAt: new Date().toISOString(),
  }).catch((e) => console.error("[myntra] failed to log API call:", e?.message));

  return result;
}

// ── Authentication ───────────────────────────────────────────────────────────

export async function generateToken(): Promise<MyntraCallResult> {
  if (!config.myntra.isConfigured) {
    throw new Error("Myntra is not configured: set MYNTRA_MERCHANT_ID and MYNTRA_SECRET_KEY in backend/.env");
  }
  const result = await rawCall("Generate token", {
    method: "POST",
    path: "/authorization/generate_token",
    auth: false,
    headers: { secret_key: config.myntra.secretKey },
    body: { merchant_id: config.myntra.merchantId },
  });
  if (result.ok && result.headers["access_token"]) {
    accessToken = result.headers["access_token"];
    refreshToken = result.headers["refresh_token"] ?? refreshToken;
    tokenIssuedAt = Date.now();
  }
  return result;
}

export async function refreshAccessToken(): Promise<MyntraCallResult> {
  if (!refreshToken) await generateToken();
  const result = await rawCall("Refresh Token", {
    method: "POST",
    path: "/authorization/refresh_token",
    auth: false,
    headers: { refresh_token: refreshToken ?? "" },
    body: { merchant_id: config.myntra.merchantId },
  });
  if (result.ok && result.headers["access_token"]) {
    accessToken = result.headers["access_token"];
    refreshToken = result.headers["refresh_token"] ?? refreshToken;
    tokenIssuedAt = Date.now();
  }
  return result;
}

async function getAccessToken(): Promise<string> {
  if (accessToken && Date.now() - tokenIssuedAt < TOKEN_TTL_MS) return accessToken;
  const result = await generateToken();
  if (!accessToken) {
    throw new Error(
      `Myntra token generation failed (HTTP ${result.httpStatus ?? "no response"}): ${result.error ?? result.text.slice(0, 300)}`,
    );
  }
  return accessToken;
}

// ── Catalogue setup (Mockify data preparation) ───────────────────────────────

export const addOrUpdateSkus = (entries: { sku: string; price: number }[]) =>
  rawCall("To add / update SKU", { method: "PUT", path: "/sku", body: entries });

export const addOrUpdateWarehouses = (entries: { warehouseName: string; skus: string[] }[]) =>
  rawCall("Add / update Warehouse", { method: "PUT", path: "/warehouse", body: entries });

// ── Inventory ────────────────────────────────────────────────────────────────

export interface InventoryEntry {
  quantity: number;
  sku: string;
  processingSla: number;
  store_code: string;
}

export const updateInventory = (entries: InventoryEntry[]) =>
  rawCall("Update Inventory", { method: "PUT", path: "/partner/v4/inventory/update", body: entries });

export const updateInventoryAsync = (entries: InventoryEntry[]) =>
  rawCall("Update Async Inventory", { method: "PUT", path: "/partner/v4/inventory/async/update", body: entries });

export const failedAsyncInventoryAck = (endpoint: MyntraEndpoint) =>
  rawCall("Failed Async Inventory Acknowledgement", { method: "POST", path: "/failureinventory/update", body: endpoint });

export const searchInventory = (skus: string[]) =>
  rawCall("Search Inventory", { method: "POST", path: "/partner/v4/inventory/search", body: skus });

export const overrideDiscount = (body: {
  startDate: string;
  endDate: string;
  discountType: string;
  discountEntries: { sku: string; discount: number }[];
}) => rawCall("Discount", { method: "PUT", path: "/partner/v4/discount/override", body, partnerStore: "MYNTRA" });

export const updateExpiry = (entries: { sku: string; expiryDate: string }[]) =>
  rawCall("Update Expiry", { method: "PUT", path: "/partner/v4/expiry/update", body: entries });

// ── Orders (seller actions) ──────────────────────────────────────────────────

const eventTime = () => {
  // Myntra format: "yyyy-MM-dd HH:mm:ss" (IST)
  const d = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return d.toISOString().replace("T", " ").slice(0, 19);
};

export const acceptOrder = (sellerOrderId: string, warehouse: string, orderLineIds: string[]) =>
  rawCall("Accept order", {
    method: "PUT",
    path: `/partner/v4/order/${encodeURIComponent(sellerOrderId)}/accept`,
    partnerStore: "MYNTRA",
    body: { eventTime: eventTime(), warehouse, orderLineEntries: orderLineIds.map((orderLineId) => ({ orderLineId })) },
  });

export const rejectOrder = (
  sellerOrderId: string,
  warehouse: string,
  orderLineIds: string[],
  rejectionReasonId: number,
  imgUrl?: Record<string, string>,
) =>
  rawCall("Reject Order", {
    method: "PUT",
    path: `/partner/v4/order/${encodeURIComponent(sellerOrderId)}/reject`,
    body: {
      eventTime: eventTime(),
      warehouse,
      orderLineEntries: orderLineIds.map((orderLineId) => ({
        orderLineId,
        rejectionReasonId,
        ...(imgUrl ? { imgUrl } : {}),
      })),
    },
  });

export const readyToDispatchMyntraInvoice = (
  warehouse: string,
  entries: { sellerOrderId: string; orderLineId: string }[],
) =>
  rawCall("Ready To Dispatch Myntra generated invoice RTD", {
    method: "PUT",
    path: "/partner/v4/order/readyToDispatch",
    body: { warehouse, orderLineEntries: entries },
  });

export interface SellerInvoiceLine {
  sellerOrderId: string;
  orderLineId: string;
  invoiceNumber: string;
  invoiceDate: string; // dd-MM-yyyy HH:mm:ss
  unitTotalAmount: number;
  taxEntries: { taxRate: number; taxType: string; unitTaxAmount: number; unitTaxableAmount: number }[];
}

export const readyToDispatchSellerInvoice = (warehouse: string, entries: SellerInvoiceLine[]) =>
  rawCall("Ready To Dispatch Seller generated invoice", {
    method: "PUT",
    path: "/partner/v4/order/readyToDispatch",
    body: { warehouse, orderLineEntries: entries },
  });

export const readyToShip = (trackingNumber: string) =>
  rawCall("Ready To Ship", {
    method: "PUT",
    path: `/partner/v4/trackingNumber/${encodeURIComponent(trackingNumber)}/readyToShip`,
    mocking: true,
  });

export const getOrder = (sellerOrderId: string) =>
  rawCall("Get Order by Id", {
    method: "GET",
    path: `/partner/v4/order/${encodeURIComponent(sellerOrderId)}`,
    mocking: true,
  });

export const getPacket = (packetId: string) =>
  rawCall("Get Order by Packet Id", {
    method: "GET",
    path: `/partner/v4/packet/${encodeURIComponent(packetId)}`,
    mocking: true,
  });

export const getInvoiceDetails = (packetId: string) =>
  rawCall("Get Invoice Details", {
    method: "GET",
    path: `/partner/v4/packet/${encodeURIComponent(packetId)}/getInvoiceDetails`,
    mocking: true,
  });

export const downloadInvoice = (packetId: string) =>
  rawCall("Download Invoice Inbound", {
    method: "GET",
    path: `/partner/v4/packet/${encodeURIComponent(packetId)}/getDocument?type=invoice`,
    mocking: true,
  });

export const downloadShippingLabel = (packetId: string) =>
  rawCall("Download Shipping Label", {
    method: "GET",
    path: `/partner/v4/packet/${encodeURIComponent(packetId)}/shippingLabel`,
    mocking: true,
  });

export const sellerCancelItems = (sellerOrderId: string, entries: { orderLineId: string; comment: string }[]) =>
  rawCall("VFS Seller cancellation", {
    method: "PUT",
    path: `/partner/v4/order/${encodeURIComponent(sellerOrderId)}/cancelItems`,
    body: entries,
  });

// ── Mockify simulator triggers (stage testing only) ─────────────────────────
// Each one makes Mockify push the matching event to `endpoint` (our outbound API).

export const mockCreateOrder = (opts: {
  endpoint: MyntraEndpoint;
  skus: string[];
  warehouse: string;
  processingTime?: number;
  ppmp?: boolean;
}) =>
  rawCall("Create order", {
    method: "POST",
    path: "/storefront/v4/mock/order",
    headers: opts.ppmp ? { ppmp: "true" } : {},
    body: {
      endpoint: opts.endpoint,
      processingTime: opts.processingTime ?? 10,
      skus: opts.skus,
      warehouse: opts.warehouse,
    },
  });

const packetEvent = (api: string, packetId: string, event: "shipped" | "delivered" | "lost", endpoint: MyntraEndpoint) =>
  rawCall(api, {
    method: "PUT",
    path: `/storefront/v4/mock/packet/${encodeURIComponent(packetId)}/${event}`,
    // Sheet: "pass the orderLineIds array empty only for this API"
    body: { endpoint, orderLineIds: [] },
  });

export const mockShipped = (packetId: string, endpoint: MyntraEndpoint) => packetEvent("Shipped", packetId, "shipped", endpoint);
export const mockDelivered = (packetId: string, endpoint: MyntraEndpoint) =>
  packetEvent("Delivered", packetId, "delivered", endpoint);
export const mockLost = (packetId: string, endpoint: MyntraEndpoint) => packetEvent("Lost", packetId, "lost", endpoint);

export const mockItemCancellation = (sellerOrderId: string, orderLineIds: string[], endpoint: MyntraEndpoint) =>
  rawCall("Customer Item Cancellation", {
    method: "PUT",
    path: `/storefront/v4/mock/order/${encodeURIComponent(sellerOrderId)}/itemCancellation`,
    body: { endpoint, orderLineIds },
  });

export const mockOnHold = (sellerOrderId: string, endpoint: MyntraEndpoint) =>
  rawCall("OnHold", {
    method: "PUT",
    path: `/storefront/v4/mock/order/${encodeURIComponent(sellerOrderId)}/onhold`,
    body: { endpoint, orderLineIds: [] },
  });

export const mockUnHold = (sellerOrderId: string, endpoint: MyntraEndpoint) =>
  rawCall("UnHold", {
    method: "PUT",
    path: `/storefront/v4/mock/order/${encodeURIComponent(sellerOrderId)}/unhold`,
    // The sheet shows a bare endpoint body, but Mockify rejects it
    // ("Invalid request body provided"); it takes the same shape as OnHold.
    body: { endpoint, orderLineIds: [] },
  });

export const mockCourierReturn = (packetId: string, endpoint: MyntraEndpoint) =>
  rawCall("Courier Return / Closed Box Return / RTO", {
    method: "POST",
    path: `/storefront/v4/mock/return/cou_${encodeURIComponent(packetId)}`,
    body: endpoint,
  });

export const mockCustomerReturn = (sellerOrderId: string, orderLineId: string, endpoint: MyntraEndpoint) =>
  rawCall("Customer Return / RTV", {
    method: "POST",
    path: "/storefront/v4/mock/return/",
    body: { endpoint, sellerOrderId, orderLineId },
  });

export const mockRtoUpdate = (packetId: string, endpoint: MyntraEndpoint) =>
  rawCall("RTO Update Returns", {
    method: "PUT",
    path: `/storefront/v4/mock/return/cou_${encodeURIComponent(packetId)}/update`,
    body: endpoint,
  });

export const mockRtvUpdate = (returnId: string, endpoint: MyntraEndpoint) =>
  rawCall("RTV Update Returns", {
    method: "PUT",
    // Mockify's customer-return response already gives "cus_<id>".
    path: `/storefront/v4/mock/return/${returnId.startsWith("cus_") ? "" : "cus_"}${encodeURIComponent(returnId)}/update`,
    body: endpoint,
  });

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Endpoint object for Mockify pushes. Mockify calls exactly this URL, so it
 * points at our real outbound API (MYNTRA_SELLER_DOMAIN must be public).
 */
export function outboundEndpoint(path: string, method: MyntraEndpoint["method"] = "POST"): MyntraEndpoint {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (config.myntra.mockPushUrl) return { url: config.myntra.mockPushUrl, headers, method: "POST" };
  if (config.myntra.outboundToken) {
    headers["access_token"] = config.myntra.outboundToken;
    // nginx drops header names containing "_" unless `underscores_in_headers on`
    // is set; the hyphenated copy still reaches us (isAuthorized accepts both).
    headers["access-token"] = config.myntra.outboundToken;
  }
  return { url: `${config.myntra.sellerDomain}${path}`, headers, method };
}

/** First value found for any of `keys`, searching the object depth-first. */
export function deepFind(obj: Json, keys: string[]): Json | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") {
      const found = deepFind(v, keys);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** All orderLineId values found anywhere in the object. */
export function findOrderLineIds(obj: Json): string[] {
  const ids = new Set<string>();
  const walk = (o: Json) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach(walk);
    if (o.orderLineId !== undefined && o.orderLineId !== null) ids.add(String(o.orderLineId));
    Object.values(o).forEach(walk);
  };
  walk(obj);
  return [...ids];
}
