// =============================================================================
// Field name transformation middleware
//
// The frontend uses snake_case field names (e.g., unit_price, invoice_number)
// while the backend models use camelCase (e.g., unitPrice, invoiceNumber).
// This middleware bridges the gap in both directions:
//
//   REQUEST  (body)  snake_case → camelCase  — so model functions get
//                                                correct property names
//   RESPONSE (json)  camelCase  → snake_case — so the frontend receives
//                                                what it expects
// =============================================================================

import { Request, Response, NextFunction } from "express";

/** Convert a single snake_case key to camelCase */
function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/** Convert a single camelCase key to snake_case */
function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/** Deeply transform all object keys using the given function */
function deepTransformKeys(value: unknown, fn: (key: string) => string): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => deepTransformKeys(item, fn));
  }
  if (typeof value === "object" && !(value instanceof Date)) {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      result[fn(key)] = deepTransformKeys(val, fn);
    }
    return result;
  }
  // Return primitives (string, number, boolean) as-is
  return value;
}

// ---------------------------------------------------------------------------
// Express Middleware: snake_case → camelCase for request body
// ---------------------------------------------------------------------------
export function snakeCaseToCamelCase(req: Request, _res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
    req.body = deepTransformKeys(req.body, snakeToCamel) as Record<string, unknown>;
  }
  next();
}

// ---------------------------------------------------------------------------
// Express Middleware: camelCase → snake_case for response JSON
// ---------------------------------------------------------------------------
export function camelCaseToSnakeCase(req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);
  res.json = function (body: unknown) {
    if (body !== null && body !== undefined) {
      // Security: never leak internal error details to clients on 5xx. Many
      // route handlers respond with `err.message`, which can expose database
      // errors, stack traces or file paths. Errors below 500 (validation,
      // 4xx) are intentionally kept — they carry user-facing messages.
      let safe = body;
      if (
        res.statusCode >= 500 &&
        typeof body === "object" &&
        (body as Record<string, unknown> | null)?.error !== undefined
      ) {
        safe = { ...(body as Record<string, unknown>), error: "Internal server error" };
      }
      return originalJson(deepTransformKeys(safe, camelToSnake));
    }
    return originalJson(body);
  } as typeof res.json;
  next();
}
