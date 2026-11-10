/**
 * Amazon SP-API Application Review Status — Centralized Status Management.
 *
 * Provides a single source of truth for the WhizUnik Command Amazon application's
 * review/production-readiness state. Distinguishes Amazon-side restrictions
 * (developer registration under review, production client unavailable, roles not
 * approved, seller not authorized) from actual code defects (configuration errors,
 * API request failures, data processing failures).
 *
 * Never logs or returns credentials, tokens, or secrets.
 *
 * Classifications (internal):
 *   APPLICATION_REVIEW_PENDING   Developer registration under Amazon review.
 *   APPLICATION_DRAFT            Application still in Draft; production blocked.
 *   APPLICATION_APPROVED         Application approved for production use.
 *   PRODUCTION_CLIENT_UNAVAILABLE Production app client not yet creatable.
 *   ROLE_NOT_APPROVED            Required SP-API role(s) not yet approved.
 *   SELLER_NOT_AUTHORIZED        Seller account has not authorized the app.
 *   CONFIGURATION_ERROR          Backend/env configuration is invalid.
 *   API_REQUEST_FAILED           SP-API / LWA request failed (non-auth).
 *   EMPTY_RESPONSE               API succeeded but returned zero records.
 *   DATA_PROCESSING_FAILED       Records received but DB persistence failed.
 *   SYNC_SUCCESS                 Data retrieved, processed, persisted.
 *   SYNC_PARTIAL                 Some records synced, some operations failed.
 *
 * Dashboard statuses (derived from classifications):
 *   SUCCESS, EMPTY, PARTIAL, FAILED, ACCESS_RESTRICTED, REVIEW_PENDING, IN_PROGRESS
 */

import { config } from "../config.js";
import { validateMarketplaceConfig } from "./amazon-marketplace-config.js";
import { classifyError, type ClassifiedError } from "./amazon-error-classification.js";
import { AmazonDebugLogger } from "./amazon-debug-logger.js";

export type AppReviewClassification =
  | "APPLICATION_REVIEW_PENDING"
  | "APPLICATION_DRAFT"
  | "APPLICATION_APPROVED"
  | "PRODUCTION_CLIENT_UNAVAILABLE"
  | "ROLE_NOT_APPROVED"
  | "SELLER_NOT_AUTHORIZED"
  | "CONFIGURATION_ERROR"
  | "API_REQUEST_FAILED"
  | "EMPTY_RESPONSE"
  | "DATA_PROCESSING_FAILED"
  | "SYNC_SUCCESS"
  | "SYNC_PARTIAL";

export type DashboardStatus =
  | "SUCCESS"
  | "EMPTY"
  | "PARTIAL"
  | "FAILED"
  | "ACCESS_RESTRICTED"
  | "REVIEW_PENDING"
  | "IN_PROGRESS";

export interface AmazonApplicationState {
  developerRegistration: "pending" | "approved" | "rejected";
  applicationStatus: "draft" | "production_enabled";
  publicDeveloperApproved: boolean;
  productionClientAvailable: boolean;
  roleApprovalStatus: "pending" | "approved";
  sellerAuthorizationStatus: "pending" | "authorized";
  overallClassification: AppReviewClassification;
  reviewPendingMessage: string | null;
  lastSuccessfulSync: string | null;
}

export interface AmazonModuleHealth {
  module: string;
  status: DashboardStatus;
  lastAttemptedAt: string | null;
  lastSuccessfulAt: string | null;
  httpStatus: number | null;
  recordsReceived: number;
  recordsProcessed: number;
  recordsInserted: number;
  recordsUpdated: number;
  recordsSkipped: number;
  databaseRecordCount: number;
  paginationCount: number;
  durationMs: number | null;
  errorClassification: string | null;
  errorMessage: string | null;
  errorCode: string | null;
  amazonRequestId: string | null;
}

export interface AmazonApplicationHealth {
  application: AmazonApplicationState;
  modules: AmazonModuleHealth[];
  summary: {
    allModulesSuccess: boolean;
    hasAccessRestricted: boolean;
    hasReviewPending: boolean;
    hasFailed: boolean;
    totalRecordsReceived: number;
    totalRecordsPersisted: number;
  };
}

const log = new AmazonDebugLogger({ module: "amazon-application-status" });

/** Read optional developer-declared status from env (manual declaration only — never assumed). */
function readDeclaredStatus(): {
  developerRegistration: "pending" | "approved" | "rejected" | null;
  publicDeveloperApproved: boolean | null;
  productionClientAvailable: boolean | null;
  roleApprovalStatus: "pending" | "approved" | null;
  sellerAuthorizationStatus: "pending" | "authorized" | null;
} {
  const raw = process.env.AMAZON_DEVELOPER_REGISTRATION_STATUS;
  const developerRegistration =
    raw === "approved" || raw === "rejected" || raw === "pending" ? raw : null;

  const publicDeveloperApproved =
    process.env.AMAZON_PUBLIC_DEVELOPER_APPROVED === "true"
      ? true
      : process.env.AMAZON_PUBLIC_DEVELOPER_APPROVED === "false"
        ? false
        : null;

  const productionClientAvailable =
    process.env.AMAZON_PRODUCTION_CLIENT_AVAILABLE === "true"
      ? true
      : process.env.AMAZON_PRODUCTION_CLIENT_AVAILABLE === "false"
        ? false
        : null;

  const roleApprovalStatus =
    process.env.AMAZON_ROLE_APPROVAL_STATUS === "approved" || process.env.AMAZON_ROLE_APPROVAL_STATUS === "pending"
      ? process.env.AMAZON_ROLE_APPROVAL_STATUS
      : null;

  const sellerAuthorizationStatus =
    process.env.AMAZON_SELLER_AUTHORIZED === "authorized" || process.env.AMAZON_SELLER_AUTHORIZED === "pending"
      ? process.env.AMAZON_SELLER_AUTHORIZED
      : null;

  return {
    developerRegistration,
    publicDeveloperApproved,
    productionClientAvailable,
    roleApprovalStatus,
    sellerAuthorizationStatus,
  };
}

/** Map an internal classification to a dashboard status. */
function classificationToDashboardStatus(classification: AppReviewClassification): DashboardStatus {
  switch (classification) {
    case "SYNC_SUCCESS": return "SUCCESS";
    case "EMPTY_RESPONSE": return "EMPTY";
    case "SYNC_PARTIAL": return "PARTIAL";
    case "CONFIGURATION_ERROR":
    case "API_REQUEST_FAILED":
    case "DATA_PROCESSING_FAILED": return "FAILED";
    case "PRODUCTION_CLIENT_UNAVAILABLE":
    case "ROLE_NOT_APPROVED":
    case "SELLER_NOT_AUTHORIZED": return "ACCESS_RESTRICTED";
    case "APPLICATION_REVIEW_PENDING":
    case "APPLICATION_DRAFT": return "REVIEW_PENDING";
    default: return "FAILED";
  }
}

/** Map a dashboard status back to a classification (for display/derivation). */
export function dashboardStatusToClassification(status: DashboardStatus): AppReviewClassification {
  switch (status) {
    case "SUCCESS": return "SYNC_SUCCESS";
    case "EMPTY": return "EMPTY_RESPONSE";
    case "PARTIAL": return "SYNC_PARTIAL";
    case "FAILED": return "API_REQUEST_FAILED";
    case "ACCESS_RESTRICTED": return "ROLE_NOT_APPROVED";
    case "REVIEW_PENDING": return "APPLICATION_REVIEW_PENDING";
    case "IN_PROGRESS": return "APPLICATION_REVIEW_PENDING";
    default: return "API_REQUEST_FAILED";
  }
}

/**
 * Determine the overall Amazon application state.
 *
 * Evidence-based: never assumes approval. Everything that is not explicitly
 * declared or provable from config is treated as pending/unknown so the seller
 * is never misled into thinking production access is available.
 */
export function getApplicationState(): AmazonApplicationState {
  const declared = readDeclaredStatus();
  const mv = validateMarketplaceConfig();
  const configured = config.amazon.isConfigured && Boolean(config.amazon.marketplaceId);
  const appStatusEnv = (config.amazon.applicationStatus || "").toLowerCase();

  // ── Developer registration ──
  // Default to pending when Amazon review is under way; only "approved"/"rejected"
  // when the developer has explicitly declared it via env.
  let developerRegistration: "pending" | "approved" | "rejected" = "pending";
  if (declared.developerRegistration) {
    developerRegistration = declared.developerRegistration;
  } else if (appStatusEnv === "approved" || appStatusEnv === "production_enabled") {
    developerRegistration = "approved";
  } else if (appStatusEnv === "rejected") {
    developerRegistration = "rejected";
  }

  // ── Public developer approval ──
  let publicDeveloperApproved = false;
  if (declared.publicDeveloperApproved === true) {
    publicDeveloperApproved = true;
  } else if (developerRegistration === "approved") {
    publicDeveloperApproved = true;
  }

  // ── Application status ──
  let applicationStatus: "draft" | "production_enabled" = "draft";
  if (appStatusEnv === "production_enabled" || appStatusEnv === "approved") {
    applicationStatus = "production_enabled";
  }

  // ── Production client availability ──
  // Defaults to unavailable when under review / draft; only available when explicitly declared.
  let productionClientAvailable = false;
  if (declared.productionClientAvailable === true) {
    productionClientAvailable = true;
  }

  // ── Role approval ──
  let roleApprovalStatus: "pending" | "approved" = "pending";
  if (declared.roleApprovalStatus === "approved") {
    roleApprovalStatus = "approved";
  }

  // ── Seller authorization ──
  // Seller is considered authorized only when LWA is configured, token is valid,
  // sellerId is set, and the developer has not explicitly declared otherwise.
  let sellerAuthorizationStatus: "pending" | "authorized" = "pending";
  if (declared.sellerAuthorizationStatus === "authorized") {
    sellerAuthorizationStatus = "authorized";
  } else if (configured && config.amazon.sellerId && declared.sellerAuthorizationStatus !== "pending") {
    // LWA + sellerId present is a necessary (not sufficient) signal; mark pending
    // until explicitly confirmed, because a valid token does not prove the seller
    // has authorized this specific application in Seller Central.
    sellerAuthorizationStatus = "pending";
  }

  // ── Overall classification (most restrictive first) ──
  let overallClassification: AppReviewClassification = "APPLICATION_REVIEW_PENDING";
  let reviewPendingMessage: string | null = null;

  if (!mv.valid || !configured) {
    overallClassification = "CONFIGURATION_ERROR";
    reviewPendingMessage =
      "Amazon SP-API backend configuration is invalid. Check AMAZON_CLIENT_ID, " +
      "AMAZON_CLIENT_SECRET, AMAZON_REFRESH_TOKEN, AMAZON_MARKETPLACE_ID, " +
      "AMAZON_SPAPI_ENDPOINT and AMAZON_REGION.";
  } else if (developerRegistration === "rejected") {
    overallClassification = "APPLICATION_REVIEW_PENDING";
    reviewPendingMessage = "Amazon developer registration was rejected.";
  } else if (developerRegistration === "pending" || applicationStatus === "draft") {
    overallClassification = "APPLICATION_REVIEW_PENDING";
    reviewPendingMessage =
      "Amazon Public Developer registration is currently under review. Production app client " +
      "creation and certain production access operations may remain unavailable until Amazon " +
      "completes its review.";
  } else if (!productionClientAvailable) {
    overallClassification = "PRODUCTION_CLIENT_UNAVAILABLE";
    reviewPendingMessage =
      "Production app client is not available. Complete the Public Developer review and " +
      "create a production app client in Seller Central before enabling live data sync.";
  } else if (!publicDeveloperApproved) {
    overallClassification = "APPLICATION_REVIEW_PENDING";
    reviewPendingMessage = "Public Developer approval has not been confirmed.";
  } else if (roleApprovalStatus === "pending") {
    overallClassification = "ROLE_NOT_APPROVED";
    reviewPendingMessage =
      "Required SP-API role(s) are not yet approved. Authorize the application in Seller " +
      "Central and request the orders, listings, inventory and returns roles.";
  } else if (sellerAuthorizationStatus === "pending") {
    overallClassification = "SELLER_NOT_AUTHORIZED";
    reviewPendingMessage =
      "Seller account has not authorized this application. Complete seller authorization " +
      "in Seller Central → Apps → Your Apps → Authorize.";
  } else {
    overallClassification = "APPLICATION_APPROVED";
    reviewPendingMessage = null;
  }

  return {
    developerRegistration,
    applicationStatus,
    publicDeveloperApproved,
    productionClientAvailable,
    roleApprovalStatus,
    sellerAuthorizationStatus,
    overallClassification,
    reviewPendingMessage,
    lastSuccessfulSync: null, // filled in by health builder from sync status
  };
}

/**
 * Classify a raw SP-API/LWA error into the internal taxonomy, using available
 * evidence (HTTP status, Amazon response messages, request IDs) rather than
 * assuming every failure is caused by the developer review.
 */
export function classifyAmazonError(
  err: any,
  headers?: { get(name: string): string | null },
  bodySnippet?: string,
): {
  classification: AppReviewClassification;
  dashboardStatus: DashboardStatus;
  classified: ClassifiedError;
} {
  const classified = classifyError(err, headers, bodySnippet);

  let classification: AppReviewClassification;
  switch (classified.classification) {
    case "NOT_CONFIGURED":
      classification = "CONFIGURATION_ERROR";
      break;
    case "TOKEN_INVALID_OR_EXPIRED":
      classification = "API_REQUEST_FAILED";
      break;
    case "ROLE_OR_AUTHORIZATION_MISSING":
      classification = "SELLER_NOT_AUTHORIZED";
      break;
    case "REGION_MISMATCH":
      classification = "CONFIGURATION_ERROR";
      break;
    case "RATE_LIMITED":
      classification = "API_REQUEST_FAILED";
      break;
    case "AMAZON_SERVICE_ERROR":
    case "AMAZON_NETWORK_ERROR":
      classification = "API_REQUEST_FAILED";
      break;
    case "RESPONSE_PARSING_ERROR":
    case "DATABASE_WRITE_ERROR":
      classification = "DATA_PROCESSING_FAILED";
      break;
    case "UNKNOWN":
    default:
      classification = "API_REQUEST_FAILED";
      break;
  }

  return {
    classification,
    dashboardStatus: classificationToDashboardStatus(classification),
    classified,
  };
}

export const amazonApplicationStatus = {
  getApplicationState,
  classifyAmazonError,
  classificationToDashboardStatus,
  dashboardStatusToClassification,
  readDeclaredStatus,
};
