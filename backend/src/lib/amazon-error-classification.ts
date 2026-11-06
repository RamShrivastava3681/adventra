/**
 * Amazon SP-API error classification.
 *
 * Classifies SP-API / LWA errors into actionable categories so the dashboard
 * and diagnostics can report the precise root cause instead of a generic
 * "AccessRestricted" or "Failed" status.
 *
 * Never logs credentials, tokens, or buyer PII.
 */

export type ErrorClassification =
  | "REGION_MISMATCH"
  | "ROLE_OR_AUTHORIZATION_MISSING"
  | "TOKEN_INVALID_OR_EXPIRED"
  | "ACCESS_GRANTED_NO_DATA"
  | "RATE_LIMITED"
  | "AMAZON_SERVICE_ERROR"
  | "AMAZON_NETWORK_ERROR"
  | "RESPONSE_PARSING_ERROR"
  | "DATABASE_WRITE_ERROR"
  | "NOT_CONFIGURED"
  | "UNKNOWN";

export interface ClassifiedError {
  classification: ErrorClassification;
  httpStatus: number | null;
  amazonErrorCode: string | null;
  amazonRequestId: string | null;
  message: string; // redacted, safe for logs/frontend
  retryable: boolean;
}

/** Extract the Amazon Request-ID from a response, if present. */
function extractRequestId(headers: { get(name: string): string | null } | null | undefined): string | null {
  if (!headers) return null;
  return headers.get("x-amzn-RequestId") ?? headers.get("x-amzn-requestid") ?? null;
}

/**
 * Classify an error from an SP-API / LWA response.
 *
 * @param err - The error thrown by the SP-API client (may have .status, .code, .message)
 * @param headers - Optional response headers (for Amazon Request-ID)
 * @param bodySnippet - Optional redacted response body snippet (first 200 chars)
 */
export function classifyError(
  err: any,
  headers?: { get(name: string): string | null },
  bodySnippet?: string,
): ClassifiedError {
  const httpStatus = err?.status ?? err?.httpStatus ?? null;
  const amazonErrorCode = err?.code ?? null;
  const amazonRequestId = extractRequestId(headers ?? ({} as any));
  const rawMessage = err?.message ?? String(err ?? "");

  // Redact the message: strip anything that looks like a token or secret.
  const message = rawMessage
    .replace(/Atzr\|[A-Za-z0-9\-_~]*/g, "Atzr|[redacted]")
    .replace(/access_token["\s:]+[A-Za-z0-9\-_~.]+/gi, 'access_token "[redacted]"')
    .replace(/client_secret["\s:]+[A-Za-z0-9\-_~.]+/gi, 'client_secret "[redacted]"')
    .replace(/refresh_token["\s:]+[A-Za-z0-9\-_~.]+/gi, 'refresh_token "[redacted]"');

  // 401 → token invalid or expired
  if (httpStatus === 401 || rawMessage.includes("401") || rawMessage.includes("Unauthorized")) {
    return {
      classification: "TOKEN_INVALID_OR_EXPIRED",
      httpStatus,
      amazonErrorCode,
      amazonRequestId,
      message: `LWA/SP-API authentication failed (HTTP ${httpStatus}): ${message}`,
      retryable: false,
    };
  }

  // 403 → could be region mismatch or role/authorization missing
  if (httpStatus === 403 || rawMessage.includes("403")) {
    const lower = rawMessage.toLowerCase();
    if (
      lower.includes("invalidinput") ||
      lower.includes("marketplace") ||
      lower.includes("region") ||
      lower.includes("invalid query parameter")
    ) {
      return {
        classification: "REGION_MISMATCH",
        httpStatus,
        amazonErrorCode,
        amazonRequestId,
        message: `SP-API region/marketplace mismatch (HTTP 403): ${message}`,
        retryable: false,
      };
    }
    if (
      lower.includes("access") ||
      lower.includes("denied") ||
      lower.includes("forbidden") ||
      lower.includes("unauthorized") ||
      lower.includes("role") ||
      lower.includes("permission")
    ) {
      return {
        classification: "ROLE_OR_AUTHORIZATION_MISSING",
        httpStatus,
        amazonErrorCode,
        amazonRequestId,
        message: `SP-API role or authorization missing (HTTP 403): ${message}`,
        retryable: false,
      };
    }
    return {
      classification: "ROLE_OR_AUTHORIZATION_MISSING",
      httpStatus,
      amazonErrorCode,
      amazonRequestId,
      message: `SP-API access denied (HTTP 403): ${message}`,
      retryable: false,
    };
  }

  // 429 → rate limited
  if (httpStatus === 429 || rawMessage.includes("429") || rawMessage.includes("throttl")) {
    return {
      classification: "RATE_LIMITED",
      httpStatus,
      amazonErrorCode,
      amazonRequestId,
      message: `SP-API rate limited (HTTP 429): ${message}`,
      retryable: true,
    };
  }

  // 5xx → Amazon service error
  if (httpStatus && httpStatus >= 500 && httpStatus < 600) {
    return {
      classification: "AMAZON_SERVICE_ERROR",
      httpStatus,
      amazonErrorCode,
      amazonRequestId,
      message: `SP-API service error (HTTP ${httpStatus}): ${message}`,
      retryable: true,
    };
  }

  // Network / fetch errors (no HTTP status)
  if (!httpStatus && err) {
    const lower = rawMessage.toLowerCase();
    if (lower.includes("network") || lower.includes("timeout") || lower.includes("econnrefused") || lower.includes("enotfound")) {
      return {
        classification: "AMAZON_NETWORK_ERROR",
        httpStatus: null,
        amazonErrorCode: null,
        amazonRequestId: null,
        message: `SP-API network error: ${message}`,
        retryable: true,
      };
    }
    if (lower.includes("not configured")) {
      return {
        classification: "NOT_CONFIGURED",
        httpStatus: null,
        amazonErrorCode: null,
        amazonRequestId: null,
        message: `SP-API not configured: ${message}`,
        retryable: false,
      };
    }
    return {
      classification: "UNKNOWN",
      httpStatus: null,
      amazonErrorCode: null,
      amazonRequestId: null,
      message: `SP-API error: ${message}`,
      retryable: false,
    };
  }

  // 400 → could be validation/region mismatch
  if (httpStatus === 400 || rawMessage.includes("400")) {
    const lower = rawMessage.toLowerCase();
    if (lower.includes("marketplace") || lower.includes("region") || lower.includes("invalidinput")) {
      return {
        classification: "REGION_MISMATCH",
        httpStatus,
        amazonErrorCode,
        amazonRequestId,
        message: `SP-API invalid marketplace/region input (HTTP 400): ${message}`,
        retryable: false,
      };
    }
    return {
      classification: "RESPONSE_PARSING_ERROR",
      httpStatus,
      amazonErrorCode,
      amazonRequestId,
      message: `SP-API request failed (HTTP 400): ${message}`,
      retryable: false,
    };
  }

  // Fallback
  return {
    classification: "UNKNOWN",
    httpStatus,
    amazonErrorCode,
    amazonRequestId,
    message: `SP-API error (HTTP ${httpStatus ?? "unknown"}): ${message}`,
    retryable: false,
  };
}

/** Map a ClassifiedError to a sync status string. */
export function classificationToSyncStatus(classification: ErrorClassification): string {
  switch (classification) {
    case "TOKEN_INVALID_OR_EXPIRED": return "AuthenticationError";
    case "ROLE_OR_AUTHORIZATION_MISSING": return "AccessRestricted";
    case "REGION_MISMATCH": return "AccessRestricted";
    case "RATE_LIMITED": return "RateLimited";
    case "AMAZON_SERVICE_ERROR": return "Failed";
    case "AMAZON_NETWORK_ERROR": return "Failed";
    case "NOT_CONFIGURED": return "NotConfigured";
    case "ACCESS_GRANTED_NO_DATA": return "Synchronized";
    default: return "Failed";
  }
}
