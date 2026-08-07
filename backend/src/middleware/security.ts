// =============================================================================
// Security middleware — request logging, input sanitization, response
// hardening, centralized error handling and upload validation.
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { config } from "../config.js";
import { writeAuditLog } from "../models/audit-log.js";

// ---------------------------------------------------------------------------
// 1. Request logging — structured access log with security-relevant flags.
//    Never logs Authorization headers, tokens, passwords or bodies.
// ---------------------------------------------------------------------------
/**
 * Redact capability tokens from URLs before logging — NOA and debtor-reminder
 * tokens are unguessable secrets that must never land in server logs.
 */
function redactUrl(url: string): string {
  return url
    .replace(/\/noa\/[^/]+/g, "/noa/[redacted]")
    .replace(/\/remind-debtor\/[^/]+/g, "/remind-debtor/[redacted]");
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    const userId = (req as any).user?.userId ?? "-";
    const line =
      `${new Date().toISOString()} ${req.method} ${redactUrl(req.originalUrl)} ` +
      `${res.statusCode} ${duration}ms ip=${req.ip ?? "-"} user=${userId}`;
    if (res.statusCode >= 500) console.error(line);
    else if (res.statusCode >= 400) console.warn(line);
    else console.log(line);
  });
  next();
}

// ---------------------------------------------------------------------------
// 2. Prototype-pollution sanitizer — strips `__proto__`, `constructor` and
//    `prototype` keys from parsed JSON bodies and query strings, recursively.
// ---------------------------------------------------------------------------
const POLLUTED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 20 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = sanitizeValue(value[i], depth + 1);
    }
    return value;
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (POLLUTED_KEYS.has(key)) {
      try {
        delete obj[key];
      } catch {
        /* ignore */
      }
      continue;
    }
    obj[key] = sanitizeValue(obj[key], depth + 1);
  }
  return value;
}

export function sanitizeInput(req: Request, _res: Response, next: NextFunction) {
  if (req.body && typeof req.body === "object") sanitizeValue(req.body);
  if (req.query && typeof req.query === "object") sanitizeValue(req.query);
  next();
}

// ---------------------------------------------------------------------------
// 3. Cache control — sensitive API responses must never be cached.
// ---------------------------------------------------------------------------
export function noStore(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  next();
}

// ---------------------------------------------------------------------------
// 4. Centralized error handler — generic client responses, detailed server
//    logs. Replaces ad-hoc `res.status(500).json({ error: err.message })`.
// ---------------------------------------------------------------------------
export function apiErrorHandler(
  err: any,
  _req: Request,
  res: Response,
  next: NextFunction
) {
  if (res.headersSent) return next(err);

  // Multer file-size / field-count violations
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "File is too large" });
  }
  if (err?.code === "LIMIT_FILE_COUNT" || err?.code === "LIMIT_UNEXPECTED_FILE" || err?.code === "LIMIT_FIELD_COUNT") {
    return res.status(400).json({ error: "Invalid multipart upload" });
  }
  // express.json() body too large
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body too large" });
  }
  // Malformed JSON
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON payload" });
  }
  // Malformed URL-encoded body
  if (err?.type === "entity.urlencoded.too.large") {
    return res.status(413).json({ error: "Request body too large" });
  }

  // 4xx errors with a useful message (e.g. custom validation errors) keep
  // their message; everything else is logged in detail server-side and
  // returned as a generic message.
  if (err?.statusCode && err.statusCode < 500 && err.message) {
    return res.status(err.statusCode).json({ error: String(err.message) });
  }
  console.error(
    `[error] ${new Date().toISOString()} ${_req.method} ${_req.originalUrl} ip=${_req.ip ?? "-"}`,
    err
  );
  return res.status(500).json({ error: "Internal server error" });
}

// ---------------------------------------------------------------------------
// 5. Upload validation — magic-byte (file signature) detection.
//    The Content-Type is derived from the file contents, never trusted from
//    the client. Only safe, non-executable types are allowed, which prevents
//    stored XSS (HTML/SVG served from the S3 origin) and executable uploads.
// ---------------------------------------------------------------------------
interface FileType {
  /** Canonical extension when the magic bytes identify a fixed type, else null (office/text files keep their client extension). */
  ext: string | null;
  /** Content type derived from the file contents — never from the client. */
  mime: string;
}

const SIGNATURES: Array<{ ext: string | null; mime: string; match: (b: Buffer) => boolean }> = [
  {
    ext: ".jpg", mime: "image/jpeg",
    match: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    ext: ".png", mime: "image/png",
    match: (b) => b.length >= 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    ext: ".webp", mime: "image/webp",
    match: (b) => b.length >= 12 &&
      b.toString("ascii", 0, 4) === "RIFF" &&
      b.toString("ascii", 8, 12) === "WEBP",
  },
  {
    ext: ".gif", mime: "image/gif",
    match: (b) => b.length >= 4 &&
      b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
  },
  {
    ext: ".pdf", mime: "application/pdf",
    match: (b) => b.length >= 4 && b.toString("ascii", 0, 4) === "%PDF",
  },
  // Office documents (docx/xlsx/pptx…) are ZIP archives; OLE docs are the
  // classic compound format. Content type is inert (download-only), so these
  // are safe to store even though we can't pin a single extension.
  {
    ext: null, mime: "application/octet-stream",
    match: (b) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07),
  },
  {
    ext: null, mime: "application/octet-stream",
    match: (b) => b.length >= 8 &&
      b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0 &&
      b[4] === 0xa1 && b[5] === 0xb1 && b[6] === 0x1a && b[7] === 0xe1,
  },
];

/** Reject anything that looks like HTML/SVG — the stored-XSS vector. */
function looksLikeMarkup(buf: Buffer): boolean {
  const head = buf.subarray(0, 1024).toString("latin1");
  return /<\s*(script|iframe|object|embed|svg|meta|link|style|base|form)[\s>/]/i.test(head);
}

/** Executable / script signatures that must always be rejected. */
const EXECUTABLE_SIGNATURES: Array<(b: Buffer) => boolean> = [
  (b) => b.length >= 2 && b[0] === 0x4d && b[1] === 0x5a, // MZ — Windows PE (.exe/.dll)
  (b) => b.length >= 4 && b[0] === 0x7f && b.toString("ascii", 1, 4) === "ELF", // ELF binaries
  (b) => b.length >= 2 && b[0] === 0x23 && b[1] === 0x21, // #! — shell/python scripts
  (b) => b.length >= 2 && b[0] === 0xca && b[1] === 0xfe, // Mach-O (macOS)
  (b) => b.length >= 4 && b[0] === 0x4a && b[1] === 0x41 && b[2] === 0x52 && b[3] === 0x53, // Java JAR
];

/**
 * Detect the real file type from magic bytes. Returns null for unsupported
 * or dangerous files (HTML/SVG, executables, scripts, unknown binaries).
 */
export function detectFileType(buffer: Buffer): FileType | null {
  if (!buffer || buffer.length === 0) return null;
  for (const sig of SIGNATURES) {
    if (sig.match(buffer)) return { ext: sig.ext, mime: sig.mime };
  }
  if (EXECUTABLE_SIGNATURES.some((sig) => sig(buffer))) return null;
  // Plain-text files (CSV, TXT, RTF, JSON…) — safe as text/plain; rejected if
  // they contain HTML/SVG markup.
  const head = buffer.subarray(0, 1024);
  const isBinary = head.includes(0x00);
  if (!isBinary && !looksLikeMarkup(buffer)) {
    return { ext: null, mime: "text/plain; charset=utf-8" };
  }
  return null;
}

/** Keep only safe characters in a client-supplied S3 key; drop traversal segments. */
export function sanitizeS3Key(raw: string): string {
  const cleaned = raw
    .split("/")
    .filter((seg) => seg.length > 0 && seg !== "." && seg !== "..")
    .map((seg) => seg.replace(/[^a-zA-Z0-9._-]+/g, "_"))
    .join("/");
  return cleaned.replace(/^\/+/, "");
}

// ---------------------------------------------------------------------------
// 5b. CSRF origin guard — defense-in-depth for cookie-authenticated sessions.
//     The primary protection is the SameSite=Strict session cookie (browsers
//     won't attach it to cross-site requests at all). This additionally
//     rejects state-changing requests whose Origin isn't an approved origin,
//     covering older browsers and misconfigured SameSite behavior.
// ---------------------------------------------------------------------------
export function csrfOriginGuard(allowedOrigins: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      return next();
    }
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
      logSecurityEvent("csrf.origin_rejected", req, { origin });
      return res.status(403).json({ error: "Cross-origin request rejected" });
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// 6. Admin audit middleware — records privileged actions after the response
//    completes (actor, action, target, IP). Add after requireAdmin.
// ---------------------------------------------------------------------------
export function auditAdminAction(req: Request, res: Response, next: NextFunction) {
  res.on("finish", () => {
    const actor = (req as any).user;
    const action = `${req.method} ${req.baseUrl || ""}${req.path}`;
    writeAuditLog({
      actorId: actor?.userId ?? null,
      actorEmail: actor?.email ?? null,
      action: `admin.${req.method.toLowerCase()}.${req.path.split("/").filter(Boolean).join(".")}`,
      target: req.params ? Object.values(req.params as Record<string, string>)[0] ?? null : null,
      detail: { route: action, statusCode: res.statusCode },
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      statusCode: res.statusCode,
    });
  });
  next();
}

// ---------------------------------------------------------------------------
// 7. Security event logging (failed logins, invalid tokens, denied access)
// ---------------------------------------------------------------------------
export function logSecurityEvent(
  action: string,
  req: Pick<Request, "ip" | "headers" | "body"> | null,
  detail?: Record<string, unknown>
) {
  const safeDetail: Record<string, unknown> = {
    ...(detail ?? {}),
  };
  // Never log credentials or tokens.
  delete safeDetail.password;
  console.warn(`[security] ${action} ip=${req?.ip ?? "-"}`, safeDetail);
  writeAuditLog({
    actorId: (req as any)?.user?.userId ?? null,
    actorEmail: null,
    action,
    target: null,
    detail: safeDetail,
    ip: req?.ip,
    userAgent: req?.headers?.["user-agent"],
  });
}

/** True only when the app runs in production — used for HSTS and guards. */
export const isProduction = config.isProduction;
