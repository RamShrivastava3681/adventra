# Security Audit & Hardening Report — Insight Factor API

**Audited:** August 2026 · Backend: Express 4 (TypeScript, ESM) on AWS DynamoDB + S3
**Scope:** full-stack API security review (OWASP Top 10 / API Security Top 10)
**Result:** security hardening implemented and live-verified; score raised from ~55 → **82/100** (details below).

---

## 1. Executive summary

The application had a reasonable foundation (JWT auth, bcrypt, CORS allowlist, Helmet, model-level
field allowlists) but was missing entire security layers and had several exploitable weaknesses:

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | **No rate limiting anywhere** — login/signup/public endpoints were brute-forceable | Critical | ✅ Fixed |
| 2 | **Error handler leaked `err.message` to clients** on every route (DB errors, stack traces) | High | ✅ Fixed |
| 3 | **Default JWT secret fallback** (`dev-secret-change-in-production`) — forgeable tokens if deployed unset | High | ✅ Fixed (production refuses to boot) |
| 4 | **Uploads accepted any file type** with client-supplied Content-Type → stored-XSS (HTML/SVG served from S3) & executable uploads | High | ✅ Fixed (magic-byte validation) |
| 5 | **Vulnerable dependencies**: nodemailer (SMTP injection/SSRF, high), uuid (buffer overflow, moderate) | High | ✅ Fixed (upgraded; `npm audit` clean) |
| 6 | **No request logging / audit trail** for privileged admin actions | Medium | ✅ Fixed |
| 7 | **Prototype pollution** via JSON body keys (`__proto__`, `constructor`) | Medium | ✅ Fixed (deep sanitizer) |
| 8 | **Capability tokens logged to server logs** (NOA / reminder tokens in URLs) | Medium | ✅ Fixed (redacted) |
| 9 | **No response cache control** on sensitive API data | Low | ✅ Fixed |
| 10 | **Unbounded JSON body / no multipart field limits** | Medium | ✅ Fixed |

---

## 2. Every middleware now protecting the app (and why)

Middleware order in `src/server.ts` (top → bottom):

| # | Middleware | File | Why it exists |
|---|------------|------|---------------|
| 1 | **Production startup guard** | `server.ts` | Refuses to boot with a missing/weak/short `JWT_SECRET` in production — prevents token forgery |
| 2 | **`helmet()`** | `server.ts` | Security headers: CSP (`default-src 'none'`, `script-src 'none'`), `X-Frame-Options`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, COOP/CORP, HSTS (production only), removes `X-Powered-By` |
| 3 | **Permissions-Policy header** | `server.ts` | Disables camera/mic/geolocation/payment/usb APIs for any content served by the API |
| 4 | **CORS (allowlist)** | `server.ts` | Only approved origins; explicit methods/headers; credentials; no wildcards; 24h preflight cache |
| 5 | **Body parsers with limits** | `server.ts` | `express.json({ limit })` (5 MB default) + `express.urlencoded` (100 KB) — bounded memory consumption; 413 on overflow |
| 6 | **`requestLogger`** | `middleware/security.ts` | Access log with method, path, status, duration, IP, user id; **redacts capability tokens** (NOA, remind-debtor); 4xx→warn, 5xx→error |
| 7 | **`sanitizeInput`** | `middleware/security.ts` | Deep-strips `__proto__` / `constructor` / `prototype` keys from JSON bodies & query strings — prevents prototype pollution |
| 8 | **`snakeCaseToCamelCase` / `camelCaseToSnakeCase`** | `middleware/transform.ts` | Existing API contract layer; the response wrapper now also **scrubs `error` on 5xx** so `err.message` never reaches clients |
| 9 | **`noStore`** | `middleware/security.ts` | `Cache-Control: no-store` on every `/api` response — no sensitive data cached |
| 10 | **`apiLimiter`** | `middleware/rate-limit.ts` | IP-based backstop: 1000 req / 15 min on the whole API |
| 11 | **`loginLimiter` + `accountLoginLimiter` + `authSlowDown`** | `middleware/rate-limit.ts` | **Failed logins only** — 30/15 min per IP (stops distributed brute-force) **and** 10/15 min per account+IP (stops single-account brute-force). Successful logins never count, so users on a shared office NAT IP are never blocked. Slow-down throttles only failures (after 10, 200 ms→max 10 s) |
| 12 | **`signupLimiter` + `authSlowDown`** | `middleware/rate-limit.ts` | 10 failed signups / hour per IP (successful signups don't count) — stops account-creation abuse without affecting legit signups |
| 13 | **`publicTokenLimiter`** | `middleware/rate-limit.ts` | 60 req / 15 min on public token endpoints (`/noa/:token`, `/invoices/:id/remind-debtor/:token`) — stops token-guessing & reminder spam |
| 14 | **`authMiddleware`** | `middleware/auth.ts` | Verifies JWT signature + expiry + issuer/audience (when present); logs invalid-token attempts; sets `req.user` |
| 15 | **`viewAsMiddleware`** | `routes/index.ts` | Read-only impersonation for reporting managers — checks role **and** that the manager actually manages the target user |
| 16 | **`requireRole` family** | `middleware/roles.ts` | RBAC: `requireAdmin`, `requireChecker`, `requireTreasury`…; logs permission denials as security events |
| 17 | **`auditAdminAction`** | `middleware/security.ts` | Writes an append-only DynamoDB audit record (actor, action, target, IP) after every admin mutation |
| 18 | **Upload magic-byte validation** | `middleware/security.ts` + route | Content-Type derived from file contents, never the client; rejects HTML/SVG (stored XSS), PE/ELF/JAR/Mach-O, scripts, unknown binaries; allows images, PDF, office docs, text |
| 19 | **404 handler** | `server.ts` | Generic, no path/stack disclosure |
| 20 | **`apiErrorHandler`** | `middleware/security.ts` | Centralized: multer size → 413, payload too large → 413, bad JSON → 400, everything else logged server-side + generic 500 |
| 21 | **`csrfOriginGuard`** | `middleware/security.ts` | Runs at the top of every `/api` request (non-GET): rejects state-changing requests whose `Origin` isn't an approved origin — defense-in-depth beneath the `SameSite=Strict` cookie |

**Auth model hardening (`models/user.ts`):** email format/length validation, password 6–128, bounded
all string fields, case-normalized emails, JWT now carries `iss`/`aud`/`jti` claims, role changes
validated against a known-role allowlist, failed logins → security events.

**Email hardening (`email.ts`):** `disableFileAccess` + `disableUrlAccess` on the SMTP transport —
closes the nodemailer SSRF / arbitrary-file-read advisories.

---

## 3. What I checked that was already safe (no change needed)

- **SQL / NoSQL injection** — DynamoDB is accessed only through the AWS SDK with parameterized commands; no string-built queries; no SQL anywhere.
- **Mass assignment / over-posting** — every model `update()` uses a hard-coded field allowlist (e.g. `Invoice.update`, `Product.update`); `roles`, `clientId`, `passwordHash` are never writable via the API.
- **Password storage** — bcrypt, 12 rounds.
- **Token entropy** — NOA & debtor-reminder tokens are `uuid()` (unguessable); reminder tokens are invalidated after one use.
- **IDOR on uploads** — S3 keys must start with the requester's own `userId/`.
- **Secrets in repo** — `.gitignore` covers `.env` / `*.local`; no secrets found in tracked files.
- **CSRF** — **now protected**: sessions are `httpOnly` + `SameSite=Strict` cookies (browsers never attach them to cross-site requests) **plus** a server-side `Origin` allowlist check on every non-GET `/api` request (covers older browsers / relaxed SameSite behavior). Verified live: `Origin: https://adventra.whizunikhub.com` → allowed; `Origin: http://evil.example.com` → 403.
- **Sessions** — stateless JWT held in an `httpOnly` cookie: `SameSite=Strict`, `Path=/`, `Secure` in production, 7-day `Max-Age`. `localStorage` no longer holds the token; the `Authorization: Bearer` header remains as a fallback for API scripts/tests.

---

## 4. Every change made (preserving existing functionality)

1. `backend/package.json` — added `express-rate-limit`, `express-slow-down`; upgraded `express` 4.18→4.22, `nodemailer` 6→9, `uuid` 9→11 (fixes the audit advisories).
2. `backend/src/config.ts` — new `security` + `rateLimit` config blocks (all env-overridable: `MAX_JSON_BODY`, `RL_LOGIN_LIMIT`, …), `isProduction` flag.
3. `backend/src/middleware/security.ts` — **new**: request logger (with token redaction), prototype-pollution sanitizer, `noStore`, centralized error handler, magic-byte upload validator, admin-audit middleware, security-event logger.
4. `backend/src/middleware/rate-limit.ts` — **new**: login/signup/public/API limiters + slow-down.
5. `backend/src/models/audit-log.ts` — **new**: append-only DynamoDB audit trail.
6. `backend/src/server.ts` — production JWT-secret guard, hardened Helmet (CSP/HSTS/Referrer/Permissions-Policy), strict CORS, body limits, trust-proxy (loopback-only), middleware ordering, global error handler.
7. `backend/src/middleware/auth.ts` — issuer/audience-aware token verification; invalid-token security events.
8. `backend/src/middleware/roles.ts` — permission denials logged.
9. `backend/src/middleware/transform.ts` — 5xx error-body scrub (never leak `err.message`).
10. `backend/src/models/user.ts` — strict input validation, normalized emails, JWT claims, known-role validation, audit of failed logins/email changes.
11. `backend/src/routes/index.ts` — limiters on auth + public routes; upload magic-byte validation (client paths preserved so the frontend's stored keys stay valid); NOA decision validation; admin audit wiring; fixed the one HTML `err.message` leak (`/remind-debtor`); `viewAs` uses the hardened `verifyToken`.
12. `backend/src/email.ts` — nodemailer transport hardened against file/URL access.

**Cookie-auth migration (JWT out of `localStorage` → httpOnly cookie):**
13. `backend/src/middleware/auth.ts` — cookie helpers (`setAuthCookie` / `clearAuthCookie` / `getTokenFromRequest`): the JWT is set as an `httpOnly`, `SameSite=Strict`, `Path=/` cookie (`Secure` in production); cookie is read first, `Authorization: Bearer` kept as a fallback.
14. `backend/src/models/user.ts` + `routes/index.ts` — login/signup now set the cookie and return **user only** (no token in the body); new `POST /auth/logout` clears the cookie; `viewAs` reads the cookie too.
15. `backend/src/middleware/security.ts` + `config.ts` — `csrfOriginGuard` (Origin allowlist on non-GET). Dev origins (`localhost:5173/3000/8080`, `127.0.0.1`) are merged into the CORS/CSRF allowlist **only when not in production**, so the local Vite flow works while production keeps the strict `CORS_ORIGIN` allowlist.
16. Frontend — `api-client` sends `credentials: "include"` and never touches `localStorage`; `auth-context` rewritten for cookie sessions (sequence guard retained; sign-out also bumps it so an in-flight `/auth/me` can't resurrect a session); `document-uploader`, `s3-image`, `app.products` drop the `Authorization` header; `vite.config.ts` adds a dev proxy `/api → http://localhost:4040` so the cookie flow is testable locally same-origin.

**Live verification performed:** boot + health, security headers, malformed JSON → 400, prototype-pollution body → 401 (not 500), 6 MB body → 413, login throttling (slow-down delays + 429 after limit), `login_failed` security events, token redaction in logs, magic-byte matrix (EXE/ELF/scripts/HTML/SVG/JAR rejected; PNG/PDF/DOCX/XLS/CSV accepted; path traversal cleaned), `npm audit` → 0 vulnerabilities, `tsc` clean.

---

## 5. Remaining vulnerabilities / risk register

| # | Risk | Severity | Why it remains |
|---|------|----------|----------------|
| 1 | **IDOR on some `GET /<resource>/:id` routes** (e.g. `/products/:id`, `/invoices/:id`) — the model `get()` doesn't always re-check `clientId` ownership | Medium | IDs are unguessable UUIDs, but they can leak via shared emails/documents. Fixing all ~100 endpoints is a larger refactor (needs a shared `assertOwned` helper wired into every model). Recommended next step. |
| 1b | ~~Rate limiter counting *successful* logins~~ — **fixed**: limiters now count failed attempts only, so a second user logging in from the same IP is never throttled by the first user's attempts | Fixed | Verified live: user A exhausts their own failed-login budget (429) while user B's login still returns a normal 401. Frontend `checkAuth` race (stale `/auth/me` overwriting a fresh session) also fixed with a sequence guard. |
| 2 | **Shared master data** — `Debtor.list()` / `Supplier.list()` are global (no `clientId` scoping) | Medium | Either intentional (shared counterparty master) or a cross-tenant data leak. Needs a product decision. |
| 3 | **JWT revocation is not implemented** — `jti` is issued but no denylist/version check; tokens survive email changes and logout | Medium | Requires state (DynamoDB token-version column) + middleware check. Recommended next step. |
| 4 | **7-day token lifetime** | Low–Med | Short-lived access tokens (15–60 min) + refresh-token rotation is the enterprise pattern. |
| 5 | ~~JWT in `localStorage`~~ — **fixed**: token now lives in an `httpOnly`, `SameSite=Strict`, `Secure`-in-prod cookie, never readable by JS | Fixed | Cookie flow live-verified (flags, no-token-in-body, cookie auth, Bearer fallback, logout, evil-origin 403). Note: stateless JWT means logout clears the cookie client-side only — a captured token stays valid until expiry (see #3). |
| 6 | **Signup reveals "Email already registered" (409)** — account enumeration | Low | Standard UX trade-off; acceptable for a B2B product, worth revisiting. |
| 7 | **In-memory rate-limit store** — resets on restart, per-instance | Low–Med | Fine for single-instance; needs shared Redis store when scaling horizontally. |
| 8 | **No password reset / OTP / MFA flows exist** | Med | No endpoints to rate-limit yet; the `signupLimiter` pattern extends trivially. |
| 9 | **`scanByType` full-table scans** in several handlers | Low–Med | Availability/abuse concern (unbounded scans); add pagination caps. |
| 10 | **No CSP on the SPA itself** (Vite serves it) | Low–Med | The API is hardened; the SPA needs its own CSP via the web server config. |
| 11 | **`sanitizeInput` strips `constructor`/`prototype` fields** globally | Low | By design (pollution defense); would only matter if legit business data ever used those names. |
| 12 | **Audit-log & security-event writes are fire-and-forget** (could be lost on crash) | Low | Acceptable trade-off; batch/stream to a durable log sink for enterprise. |

---

## 6. Security score

| Category | Before | After |
|----------|:------:|:-----:|
| AuthN / AuthZ / RBAC / IDOR | 60 | 70 |
| Input validation & injection | 55 | 85 |
| Rate limiting & abuse protection | 5 | 90 |
| Headers / CORS / CSRF | 70 | 92 |
| File upload security | 20 | 88 |
| Error handling & info disclosure | 30 | 85 |
| Logging & monitoring | 15 | 75 |
| Secrets & dependency hygiene | 55 | 92 |
| Session/JWT lifecycle | 45 | 70 |
| **Overall** | **~55/100** | **82/100** |

---

## 7. Roadmap to enterprise-grade (90+)

**Short term (days):**
1. Close the IDOR gap — shared `assertOwned(resource, clientId)` helper wired into every by-id `get`/`update`/`delete` route, with view-as + admin bypass.
2. Decide Debtor/Supplier scoping (tenant vs. shared master).
3. ~~Move the frontend token out of `localStorage`~~ — **done** (httpOnly `SameSite=Strict` cookie + CSRF origin guard). Next: short-lived access tokens (15–60 min).
4. Add rate-limited password reset + OTP endpoints.

**Medium term (weeks):**
5. JWT refresh-token rotation with server-side revocation (token version column + denylist).
6. MFA (TOTP) for admin + treasury roles.
7. Request signing / HMAC for server-to-server endpoints; signed download URLs already short-lived — add content-disposition to force `attachment` for non-image types.
8. Structured JSON logs (pino) shipped to a SIEM; alerting on `auth.login_failed` spikes and 429s.
9. Shared Redis rate-limit store + trusted proxy chain.
10. S3 bucket policy: private + CloudFront with its own CSP; object-level content-type pinning via a Lambda@Edge.

**Long term:**
11. Full CSP on the SPA; HSTS preload; Certificate Transparency monitoring.
12. Dependency scanning in CI (Dependabot/npm audit gate) + SAST (Semgrep/CodeQL) + OWASP ZAP DAST in the release pipeline.
13. Annual pen test; threat model review on every new route.

---

## 8. OWASP Top 10 mapping

- **A01 Broken Access Control** → RBAC + view-as checks + admin audit; IDOR item tracked (§5.1).
- **A02 Cryptographic Failures** → bcrypt(12), strong-JWT-secret guard, HSTS in prod.
- **A03 Injection** → parameterized DynamoDB, prototype-pollution sanitizer, input validation.
- **A04 Insecure Design** → rate limiting, body limits, slow-down.
- **A05 Security Misconfiguration** → hardened Helmet/CORS/headers, no `X-Powered-By`.
- **A06 Vulnerable Components** → upgraded deps, `npm audit` clean.
- **A07 Auth Failures** → login rate limit + uniform "Invalid credentials".
- **A08 Integrity Failures** → magic-byte upload validation, signed URLs.
- **A09 Logging & Monitoring Failures** → request/security/audit logging + token redaction.
- **A10 SSRF** → nodemailer file/URL access disabled.
