# Insight Factor (Adventra) — Tech Stack & Technical Q&A

> **Purpose:** One document that (1) lists every technology used in this project and what it does, and
> (2) collects the technical questions a person is likely to be asked about the project — with
> model answers you can adapt. Read it before a demo, a code walkthrough, or a technical interview.

---

## Part 1 — The Tech Stack

### 1.1 High-level architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser                                                         │
│  React 19 SPA  (TanStack Router + TanStack Query + Tailwind)    │
└───────────────────────────────┬──────────────────────────────────┘
                                │  HTTPS (same-origin, /api)
┌───────────────────────────────▼──────────────────────────────────┐
│  Nginx (production)                                             │
│  • serves the built SPA (static files, hashed assets)           │
│  • SPA fallback → index.html                                    │
│  • reverse-proxies /api/* → Express on :4040                    │
└───────────────────────────────┬──────────────────────────────────┘
                                │  /api (JSON, httpOnly session cookie)
┌───────────────────────────────▼──────────────────────────────────┐
│  Express 4 + TypeScript API (PM2-managed Node process)          │
│  Security stack → middleware chain → routes → model layer       │
└───────────────┬──────────────────────────┬───────────────────────┘
                │                          │
    ┌───────────▼──────────┐    ┌──────────▼───────────┐
    │ DynamoDB (single-    │    │ S3 (document &       │
    │ table design)        │    │ image uploads,       │
    │ • all entities in    │    │ presigned URLs)      │
    │   one table          │    └──────────────────────┘
    └──────────────────────┘
```

- **Monorepo layout:** root `package.json` (runs both apps with `concurrently`), plus `frontend/` and `backend/` folders.
- **Frontend** is a **client-only SPA** built with Vite — the output is static files (no Node needed at runtime in production).
- **Backend** is a single Express process, run by **PM2** in production and by **tsx watch** in development.

### 1.2 Frontend

| Layer | Technology | What it's used for |
|---|---|---|
| Framework | **React 19** (function components + hooks) | UI |
| Language | **TypeScript 5.8** | Types everywhere, route tree is typed |
| Build tool | **Vite 7** (`@vitejs/plugin-react`) | Dev server, bundling, dev proxy `/api → localhost:4040` |
| Routing | **TanStack Router** | File-based routing (`src/routes/*.tsx`, `routeTree.gen.ts` auto-generated), typed routes + search params |
| Data fetching | **TanStack Query (React Query) v5** | Server-state cache, loading/error states |
| Styling | **Tailwind CSS v4** (`@tailwindcss/vite`) | Utility-first CSS |
| UI components | **shadcn/ui** style — Radix UI primitives (dialog, dropdown, tabs, tooltip, select, table…), `class-variance-authority`, `tailwind-merge`, `clsx`, **lucide-react** icons, **sonner** toasts, **cmdk** command palette, **vaul** drawer, **embla-carousel** | Accessible component library |
| Forms | **react-hook-form** + **zod** (`@hookform/resolvers`) | Validation & form state |
| Charts | **recharts** | Demand-forecast area charts, dashboards |
| Dates | **date-fns** | Date math/formatting |
| Other | `react-day-picker`, `input-otp`, `react-resizable-panels`, `tw-animate-css` | Pickers, OTP, panel layouts, animations |
| Lint/format | **ESLint 9** + **Prettier 3** | Code quality |

### 1.3 Backend

| Layer | Technology | What it's used for |
|---|---|---|
| Runtime | **Node.js 20+** (ESM, `"type": "module"`) | Server |
| Framework | **Express 4** | HTTP API, middleware pipeline, routing |
| Language | **TypeScript 5.3**; dev runner **tsx watch** | Typed backend, hot reload in dev |
| Auth | **jsonwebtoken** (JWT), **bcryptjs** (12 rounds), **cookie-parser** | Sessions, password hashing, httpOnly cookie |
| Database | **AWS SDK v3** — `@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb` | All persistence (single-table design) |
| Object storage | **AWS SDK v3** — `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` | Uploads + short-lived signed download URLs |
| Uploads | **multer** | Multipart file parsing |
| Email | **nodemailer** (SMTP) | Reminders, NOA, approval requests (HTML + PDF attachments) |
| PDF generation | **pdfkit** | Invoice / NOA / quotation / PO PDFs |
| Validation | **zod** (in deps; heavily used on the frontend) | Schema validation |
| IDs | **uuid** | UUIDs for entities, capability tokens |
| Security | **helmet**, **cors**, **express-rate-limit**, **express-slow-down**, custom middleware (`security.ts`) | Headers/CSP, CORS allowlist, rate limiting, CSRF origin guard, sanitization |
| Config | **dotenv** | Env-driven config (`config.ts`) |
| Process mgmt (prod) | **PM2** (`ecosystem.config.cjs`) | Runs the compiled server, auto-restart, logs |

### 1.4 Data layer — DynamoDB single-table design

This is the most distinctive architectural decision in the project:

- **One table** (default name `InsightFactor`) holds **every entity** — users, products, invoices, stock movements, POs, GRNs, quotations, sales orders, dispatches, forecast snapshots, audit logs, etc.
- **Access pattern keys:**
  - `PK` / `SK` — item identity (`USER#<id>`, `PRODUCT#<id>`, `INV#<id>`…), `SK` mirrors `PK` for simple gets.
  - `GSI1_PK = CLIENT#<clientId>`, `GSI1_SK = <EntityType>#<createdAt>` — the main "everything for one client" query, sorted newest-first, filterable per entity type via `begins_with`.
  - `GSI2_PK = <entityType>` — global per-type queries (e.g. all users).
  - `entityType` attribute — discriminator so the same table can hold many shapes.
- **Generic helpers** in `dynamodb.ts`: `getItem`, `putItem`, `updateItem`, `updateItemIf` (conditional/atomic updates), `queryByGSI1`, `scanByType`, `deleteItem`.
- **Concurrency control:** `updateItemIf` uses a DynamoDB **ConditionExpression** (e.g. `status = 'draft'`) so exactly one concurrent request can flip a state (draft → confirmed). A failed condition returns `null` = "already done" — this is what makes double-clicks and duplicate requests harmless.
- **Scalability trade-off:** everything for a client is one GSI1 partition → cheap single-key queries; cross-entity joins are done in application code; a few places use `scanByType` (fine at current scale, flagged as a scaling concern).

### 1.5 File storage & email

- **S3:** documents and product images are uploaded (magic-byte validated) and served via short-lived **presigned URLs** (default 120 s TTL) — the bucket stays private. Keys are scoped per user (`userId/...`) to prevent cross-tenant access.
- **Email (nodemailer/SMTP):**
  - Invoice due-date **reminders** to admin and to debtors (one-time token links).
  - **NOA (Notice of Assignment)** emails with the invoice PDF attached and a public accept/reject page.
  - **Quotation / Sales Order / Purchase Order** approval emails with PDFs and secure-token Approve/Reject links.
  - Submission notifications (visit/travel/expense/leave requests).
  - Transporter hardened with `disableFileAccess` / `disableUrlAccess` (blocks SSRF/file-read via message fields).

### 1.6 Auth & security (highlights)

- **Sessions:** stateless **JWT in an `httpOnly`, `SameSite=Strict`, `Secure`-in-prod cookie** (7-day expiry, `iss`/`aud`/`jti` claims). Client JS never sees the token; `Authorization: Bearer` kept as a fallback for scripts.
- **CSRF:** SameSite=Strict cookie **plus** a server-side `Origin` allowlist check on every non-GET `/api` request (`csrfOriginGuard`).
- **Rate limiting:** login (30 failed/15 min per IP + 10 per account), signup, public token endpoints, and an API-wide backstop — **only failed attempts count** so legitimate users behind a shared NAT IP are never blocked; `express-slow-down` throttles after repeated failures.
- **Input hardening:** body-size limits (5 MB JSON), prototype-pollution sanitizer, magic-byte upload validation (rejects HTML/SVG/executables), model-level field allowlists (no mass assignment), centralized error handler that never leaks `err.message` to clients.
- **Boot guard:** production refuses to start with a missing/weak `JWT_SECRET`.
- **Audit trail:** append-only DynamoDB audit log for workflow actions (GRN confirmed, dispatch confirmed, invoice issued, payments…) and admin actions; security events logged (failed logins, permission denials).
- **RBAC:** roles — `client` (maker), `checker`, `treasury`, `sales_rep`, `operations`, `reporting_manager`, `factor_admin` (admin). Gates enforced **server-side** (`requireRole`), not just in the UI.
- **View-as:** reporting managers can read-only impersonate the users they manage (GET only, verified manager↔report relationship, never on `/auth/*`).

### 1.7 Domain model (the business features)

- **Product catalogue** — SKUs, pricing (unitPrice/unitCost/MRP), GST rates, margins, logistics fields (lead time, safety stock, MOQ, order multiples).
- **Procurement:** Supplier/Vendor masters → **Purchase Proforma** → **Purchase Order** → **Purchase Invoice** → **GRN** (stock-in, the only purchase-side stock event).
- **Sales:** Debtor/Customer masters → **Quotation** → **Sales Order** → **Dispatch note** (stock-out) → **Sales Invoice** → payments, NOA, reminders.
- **Inventory ledger:** atomic **stock movements** (in/out, draft/confirmed/cancelled). **Live stock is derived, never stored:** `liveStock = Σ confirmed in − Σ confirmed out`.
- **Demand forecasting:** a **shared engine** (identical file in `backend/src/lib` and `frontend/src/lib`) computing weighted baseline, OLS trend, seasonality, 80% prediction intervals, days-of-cover, reorder recommendations, velocity/momentum tags, and pricing suggestions.
- **Accounting:** chart of accounts, journal entries, balance sheet, expenses, advances, credit/debit notes.
- **CRM:** leads, opportunities, activities.
- **HR-style submissions:** visit reports, travel/leave/expense requests with maker–checker approval and email notifications.
- **Operations:** alerts, reminder logs, invoice templates, dashboards.

### 1.8 Deployment

| Component | Tech | How |
|---|---|---|
| Frontend | Static SPA | `vite build` → `frontend/dist/`, served by **Nginx** with SPA fallback |
| Backend | Node/Express | `tsc` build → `dist/server.js`, run with **PM2** (`ecosystem.config.cjs`, fork mode, auto-restart, max-memory 500 MB) |
| Reverse proxy | **Nginx** | `/api/*` → `localhost:4040`, `/assets/*` cached 1 year |
| TLS | **Let's Encrypt (certbot)** | auto-renewing SSL |
| Infra (prod) | **AWS** | DynamoDB table + S3 bucket; optional DynamoDB Local (`DYNAMODB_ENDPOINT`) in dev |

Environment is fully env-driven: `PORT`, `NODE_ENV`, `JWT_SECRET`, `AWS_*`, `DYNAMODB_TABLE`, `S3_BUCKET`, `CORS_ORIGIN`, `SMTP_*`, `APP_URL`, plus `RL_*` rate-limit knobs.

---

## Part 2 — Technical Questions & Answers

### A. Architecture & design decisions

**Q1. Explain the overall architecture of the project.**
It's a two-tier web app: a React 19 SPA (TanStack Router + TanStack Query, Tailwind) talking over HTTPS to a single Express 4 + TypeScript API. The API uses a single-table DynamoDB design, S3 for file storage with presigned URLs, and SMTP via nodemailer for email. In production the SPA is served as static files by Nginx (which also proxies `/api` to the Express process on port 4040), and the API runs under PM2. Everything is TypeScript, env-driven, and the monorepo has a root script that runs frontend and backend together in dev.

**Q2. Why Express and not NestJS / Fastify / Next.js?**
The backend is a straightforward REST/JSON API with heavy business logic in a model layer. Express is minimal, well-known, and easy to compose with the middleware chain this project relies on (Helmet, rate limiting, transform, sanitization). The frontend is deliberately a separate SPA rather than Next.js because the app is a client-heavy dashboard where server-side rendering buys little — static hosting keeps deployment simple (no Node at runtime for the frontend).

**Q3. Why did you pick TanStack Router instead of React Router?**
File-based routing with a fully typed route tree (`routeTree.gen.ts`), typed search params (validated with zod), and first-class support for layouts, loaders and route guards. The `$token`-style dynamic routes (public approval pages, NOA pages) map cleanly to the file convention.

**Q4. How do the frontend and backend stay in sync on business logic?**
The demand-forecast engine is the best example: the *same* `forecast-engine.ts` file is kept in both `backend/src/lib` and `frontend/src/lib` (the file itself says "KEEP IN SYNC"). The server persists the authoritative snapshots; the client can run the identical math for instant display. API field naming is also normalized by a middleware that converts snake_case → camelCase on the way in and camelCase → snake_case on the way out, so the frontend can use idiomatic JS naming.

**Q5. What was the hardest design problem, and how did you solve it?**
Keeping stock accurate under concurrency. The solution is a strict rule — *a document never touches stock; only a confirmed GRN (stock-in) or confirmed dispatch (stock-out) does* — combined with atomic conditional updates in DynamoDB (`updateItemIf` with a `status = 'draft'` guard) so exactly one concurrent confirm wins and double-clicks can't double-credit or double-debit inventory.

**Q6. How would you scale this app if it grew 100×?**
Several levers: (1) move rate-limit state from in-memory to Redis (needed for horizontal instances); (2) replace `scanByType` full-table scans with proper GSI queries/pagination; (3) add a shared `assertOwned` IDOR guard across all by-id routes (documented as the top security TODO); (4) shard the DynamoDB access pattern or move high-volume entities (stock movements) to their own table; (5) queue forecast recomputes (SQS) instead of fire-and-forget in-process; (6) add CI with typecheck, lint, tests, and dependency scanning.

### B. Data modeling (DynamoDB)

**Q7. Why DynamoDB? Why not Postgres?**
The app is serverless-friendly, needs predictable low-latency single-key reads, and multi-tenant data fits a "one client per partition" model. DynamoDB removes operational overhead (no connection pooling, no migrations for this schema) and scales reads/writes horizontally for free. The trade-offs — no joins, no ad-hoc SQL — are handled by a single-table design and app-level aggregation. (For the record, the project could be ported to Postgres with an ORM; the models are already clean CRUD interfaces.)

**Q8. Explain the single-table design.**
Every entity lives in one table. Items are keyed by `PK`/`SK` (e.g. `USER#<uuid>`, `PRODUCT#<uuid>`), discriminated by an `entityType` attribute, and indexed by `GSI1` (`CLIENT#<clientId>` + `ENTITY#<createdAt>` for per-client lists, newest first) and `GSI2` (per-entity-type lookups). This gives O(1) point reads, efficient per-client paginated lists, and a tiny infrastructure footprint. The cost is that relationships are modeled by convention (IDs + snapshot fields) rather than foreign keys.

**Q9. How do you model relations without joins?**
By **snapshotting**. Line items on orders/invoices copy `sku`, `name`, `unit`, `price` at creation time, so deleting or editing a catalogue product never corrupts historical documents. Cross-entity lookups (e.g. invoice → sales order → customer) are done by storing the linked IDs (`goodsSalesOrderId`, `soNumber`) and doing app-level fetches. This is deliberate: documents must be immutable records.

**Q10. How do you prevent concurrent requests from double-processing a document?**
DynamoDB conditional updates. `updateItemIf` runs e.g. `SET status = :new WHERE status = :old`; if the condition fails, the request is a no-op (`null` result = "already confirmed"). Every money/stock step — GRN confirm, dispatch confirm, movement confirm/cancel — uses this pattern, so two simultaneous double-clicks or retried requests can't both win.

**Q11. Why is live stock "derived" instead of stored as a number?**
Because a single stored number is a race-condition and audit hazard: any missed update leaves it wrong forever. Instead, stock movements are append-only atomic records, and live stock is always computed as `Σ confirmed in − Σ confirmed out`. Cancelling a movement simply removes it from the balance (no reversal entry needed), and the whole ledger is auditable — you can always explain *why* stock changed.

**Q12. What's the difference between GSI1 and GSI2 usage?**
GSI1 is the workhorse: "all of client X's products/invoices/movements, newest first, optionally filtered to one entity type via `begins_with`". GSI2 is used for global per-type queries (e.g. all users for admin, `scanByType` fallback for entity-wide scans). GSI2 usage is lighter and could be expanded for global reporting.

### C. Backend / Node / Express

**Q13. Walk me through the Express middleware chain.**
In order: production startup guard (JWT secret), Helmet (CSP, HSTS in prod, Permissions-Policy), CORS allowlist, cookie parser, bounded body parsers, request logger (with token redaction), input sanitizer (prototype-pollution defense), snake_case↔camelCase transform, then on `/api`: CSRF origin guard, API-wide rate limiter, no-store header, routes; then a generic 404 and a centralized error handler that logs details but returns only a generic message to clients.

**Q14. How is the API organized?**
All routes live in one `routes/index.ts` (REST/JSON, thin handlers), with business logic in `models/*` (DynamoDB CRUD + domain rules like `assertSOReceivable`, `flipToConfirmed`, advance deduction) and cross-cutting concerns in `middleware/*`. This keeps routes declarative and testable.

**Q15. Why does the transform middleware exist, and what could go wrong with it?**
The frontend sends camelCase JSON while the backend stores snake_case (DynamoDB convention), and vice versa — the middleware does the mapping automatically so neither side worries about it. Risks are handled carefully: only known entity fields are transformed, and the 5xx error path scrubs `err.message` so no internals leak.

**Q16. How do background jobs work here?**
In-process, no queue: (1) an hourly `setInterval` scheduler runs due-date invoice reminders (once per day per invoice, guarded by `lastOverdueReminderDate`); (2) forecast recompute is fire-and-forget async after every stock-affecting event; (3) forecasts are recomputed on server startup. For production scale these would move to a job queue, but in-process keeps deployment to a single PM2 process.

**Q17. How are PDFs generated?**
`pdfkit` builds invoice / NOA / quotation / PO PDFs on the server from the document data (`document-pdf.ts`). PDFs are attached to NOA and approval emails and available for print/preview.

**Q18. How do the public approval/NOA pages work without login?**
Each document gets a one-time capability token (a UUID). Emails link to public routes (`/approvals/:token`, `/noa/:token`) that verify the token, load only that document, and let the recipient Approve/Reject/comment. Tokens are single-use (invalidated after use), rate-limited, and the pages carry no auth — it's the unguessable token that is the credential.

### D. Frontend / React

**Q19. How does the frontend fetch data?**
A typed API client (`api-client.ts`) wraps `fetch` with `credentials: "include"` (for the httpOnly cookie), JSON handling, and consistent error objects. Components use TanStack Query hooks for caching, refetching, and optimistic-ish UX. GET requests automatically forward the `viewAsUserId` search param so the reporting-manager impersonation works across the app.

**Q20. How is state managed?**
Server state → TanStack Query (cache, invalidation). Auth session → a React context (`AuthProvider`) that calls `/auth/me`, keeps a sequence guard so a stale response can't overwrite a newer session, and exposes derived flags (`isAdmin`, `isChecker`, …). Local UI state → component state/hooks. No global store library — it isn't needed.

**Q21. How do you handle forms?**
react-hook-form for state/perf, zod schemas (`@hookform/resolvers`) for validation, shadcn-style controlled inputs. Complex documents (GRN, invoices, dispatches) use the same pattern with dynamic line-item arrays.

**Q22. Why is the JWT not in localStorage?**
XSS safety. The token lives in an `httpOnly` cookie, so client-side JavaScript — including any future XSS — can never read it. `SameSite=Strict` + a server Origin check cover CSRF. The auth context even migrates away any legacy `localStorage` token on boot.

**Q23. What happens when the user's session is stale?**
The API returns 401, `api-client` throws a typed error, and `AuthProvider` resets to signed-out state (sequence guard prevents races). The app routes the user to the sign-in page.

**Q24. How are routes protected by role?**
TanStack Router handles client-side gating (menus/tabs hidden by role), but the real enforcement is server-side `requireRole` middleware — the client gating is UX, the server gating is security.

### E. Auth & security

**Q25. Describe the authentication flow end-to-end.**
Login → server verifies credentials (bcrypt, 12 rounds) → signs a JWT (7-day expiry, `iss`/`aud`/`jti`) → sets it as an `httpOnly`, `SameSite=Strict`, `Secure`-in-prod cookie → subsequent requests carry it automatically → `authMiddleware` verifies signature/expiry/issuer/audience → sets `req.user`. Logout clears the cookie. `Authorization: Bearer` remains as a fallback for API scripts.

**Q26. How is CSRF prevented?**
Two layers: the session cookie is `SameSite=Strict` (browsers won't attach it to cross-site requests), and every non-GET `/api` request is checked against an approved-Origin allowlist server-side (`csrfOriginGuard`) — covering older browsers or relaxed SameSite behavior. Verified live: evil origins get 403.

**Q27. How is brute-force prevented?**
express-rate-limit + express-slow-down: failed logins are limited per IP (30/15 min) and per account+IP (10/15 min); signups per IP (10/hour); public token endpoints (60/15 min); and an API-wide backstop (1000/15 min). Only *failed* attempts consume budget, so a shared office NAT can't lock out legitimate users. Slow-down progressively delays repeated failures.

**Q28. What upload security exists?**
Multer parses the multipart body, but file types are validated by **magic bytes** (file content), never the client-supplied Content-Type: HTML/SVG (stored XSS), executables (PE/ELF/JAR/Mach-O), and scripts are rejected; images, PDFs, office docs and text are allowed. S3 keys must start with the requester's own `userId/` (IDOR defense), and files are served via short-lived presigned URLs from a private bucket.

**Q29. How is the API protected against injection?**
DynamoDB is only ever accessed through the AWS SDK with parameterized commands — there's no string-built SQL. User input is further protected by: body-size limits, a deep sanitizer that strips `__proto__`/`constructor`/`prototype` (prototype pollution), strict model field allowlists, and email/password validation in the user model.

**Q30. What's in the audit trail?**
Every significant workflow action — stock created/confirmed/cancelled, GRN confirmed, dispatch confirmed/returned, invoice created/issued/paid, admin user/role changes — is written (fire-and-forget) to an append-only DynamoDB audit log with actor, action, target, IP and user-agent. Security events (failed logins, permission denials, invalid tokens) are logged separately.

**Q31. What known security gaps remain?**
Documented in `SECURITY-AUDIT.md`: some by-id GETs don't re-check ownership (IDOR — mitigated by unguessable UUIDs, needs a shared `assertOwned` helper); Debtor/Supplier masters are shared across clients (product decision pending); JWTs aren't revocable server-side (no denylist/version); 7-day token lifetime; in-memory rate-limit store resets on restart; no MFA/password-reset yet. Overall hardening score: ~55 → 82/100.

### F. Domain: inventory & document lifecycle

**Q32. Why doesn't creating an order change stock?**
By design: *"a document never touches stock — only a confirmed goods document does."* Purchase orders, proformas, quotations, and invoices are commitments/records. Stock-in happens only when a **GRN is confirmed**; stock-out only when a **dispatch is confirmed**. This keeps the ledger truthful and prevents accidental stock edits from draft documents.

**Q33. Explain the GRN confirm flow step by step.**
(1) Re-validate against the live PO (not draft/cancelled/fully received; over-receipt requires admin/checker + explicit flag). (2) Atomic conditional flip `status: draft → confirmed` — exactly one concurrent request wins. (3) Create confirmed stock-in movements for accepted quantities, linked to the GRN. (4) Fold accepted qty into PO `receivedQty` and recompute PO status. (5) Back-fill the linked purchase invoice's `grnReceivedQty`. (6) Trigger forecast recompute asynchronously.

**Q34. What happens when a GRN or dispatch is cancelled?**
The effect is reversed symmetrically: a cancelled GRN creates stock-*out* reversals and revokes the PO's received qty; a cancelled dispatch creates stock-*in* reversals and revokes the SO's dispatched qty; a return credits stock back in and reopens the SO for re-dispatch. Cancelling a *manual* movement does **not** create a reversal — the entry just drops out of the balance (cancelled +100 leaves the balance at 0, not −100).

**Q35. What is the maker–checker model and why?**
Separation of duties: makers (clients) create and submit documents; checkers approve/reject (quotation prices, proforma funding, PO approval, invoice approval/dispute); treasury records payments and funds proformas; admins do everything; sales reps are read-only except quotations. Gates (e.g. quotation→SO conversion requires price `approved`, invoice issue requires a *confirmed* SO) are enforced server-side, so the UI can't be bypassed.

**Q36. How do derived vs. manual statuses work?**
Some statuses are user actions (draft, approved, sent, cancelled, confirmed), others are **derived** from the underlying movements — `partially_received`/`fully_received` come from GRNs, `partially_dispatched`/`fully_dispatched` from dispatches, `delivered` from delivery events. The manual status is stored separately (`manualStatus`), so revoking all receipts falls back cleanly instead of getting stuck.

**Q37. How is the advance deduction calculated, and why server-side?**
Both sales and purchase invoices can link a proforma; the deduction is `max(advances actually paid, agreed advancePct × proforma total)`, computed from recorded advance records on the server — never trusted from the client payload. The stored `amount` is the net payable/receivable that the funding pipeline reads.

**Q38. What validation exists when invoicing against a sales order?**
The SO must exist and be confirmed (never draft/cancelled); the invoice customer must match the SO customer; every line must reference a product on the SO; and invoice qty must not exceed the ordered qty. Purchase invoices require an approved & sent PO and enforce unique invoice numbers per supplier (cancelled excluded).

### G. Demand forecasting

**Q39. Explain the forecast engine pipeline.**
Per SKU: (1) bucket confirmed stock-out movements into 12 trailing calendar months; (2) correct demand for stockouts (`actual / max(availabilityRate, 0.7)`, capped at 1.4×); (3) weighted baseline (newest 3 months ×3, next 3 ×2, oldest 6 ×1); (4) OLS trend with R² strength → up/down/stable; (5) raw calendar-month seasonality clamped 0.5–2.0; (6) 6-month horizon of `baseline × trend × seasonality × factors`, clamped 0.7–1.5×, with 80% prediction intervals; (7) live pace adjustment for next month (actual vs. expected-to-date, clamped 0.8–1.2); (8) days of cover, reorder recommendation, stockout/overstock risk, momentum & velocity tags, and a pricing recommendation (never auto-applied).

**Q40. Why does the client run the same engine as the server?**
So the UI can compute instantly while the server persists authoritative snapshots (`ForecastVariable` per product). The engine is deterministic pure math — same inputs, same outputs — so a "KEEP IN SYNC" shared file guarantees they never diverge. Snapshots de-dup with last-writer-wins, and non-finite numbers are stored as null so one quiet SKU can't crash the batch.

**Q41. What is the "live pace adjustment"?**
It compares current-month sales-to-date against what the base forecast expected by now (`expectedToDate = forecast × daysElapsed/daysInMonth`). If actual is 120% of expected, next month's forecast is nudged by `clamp(1 + 0.3 × 0.2, 0.8, 1.2)` ≈ +6%. It's disabled before day 7 of the month and when there's no current-month data, and it only affects the next-month forecast (display-only, never the base months).

**Q42. How is the reorder recommendation computed?**
`requiredStock = dailyAverage × (leadTimeDays + safetyStockDays)` where dailyAverage = corrected demand over the last 3 calendar months ÷ their actual calendar days; `recommended = max(0, requiredStock − inventoryPosition)`, then capped by maxCoverDays, raised to minimumOrderQty, and rounded up to the order multiple. Timeline: estimated stockout date (today + days of cover), reorder-by date (stockout − lead time), urgency (critical/warning/safe).

**Q43. When is the forecast recomputed?**
After any stock-affecting event — movement create/update/confirm/cancel/delete, GRN confirm, dispatch confirm/return, product delete — plus a daily freshness check and on server startup. Recompute is asynchronous and failure-isolated per SKU so one bad product can't break the batch.

### H. Concurrency, performance & edge cases

**Q44. What concurrency bugs did you design against?**
Double-confirm of GRN/dispatch (solved with conditional updates), double payments (accumulate `amountReceived`, paid invoices frozen), duplicate reminder emails (busy guards + `lastOverdueReminderDate` once/day), stale auth responses overwriting fresh sessions (sequence guard), and forecast snapshot races (last-writer-wins).

**Q45. Where are the hot spots / performance risks?**
`scanByType` full-table scans on several list handlers (fine now, needs pagination caps or GSIs at scale); per-client lists query GSI1 which is efficient; forecast recompute runs over every active product per client (bounded by client count on startup via `Promise.allSettled`); in-memory rate limiting doesn't survive restarts.

**Q46. How is money handled to avoid floating-point bugs?**
Values are rounded to 2dp at computation boundaries; quantities support 3dp; GST and discount percentages are capped (0–100, GST presets 0/5/12/18/28); advance deductions are computed with explicit rounding server-side; and the engine persists non-finite numbers as null.

**Q47. What happens if an email fails mid-workflow?**
Emails are best-effort and never roll back the status change: "Send to customer/debtor" marks the document as sent and attempts the email; on failure a warning is shown and the send can be retried. NOA status is only marked sent after a successful send.

### I. Deployment & operations

**Q48. Describe the deployment process.**
Build both apps (`npm run build` → `frontend/dist` static files + `backend/dist`), copy to the server, start the backend with PM2 (`ecosystem.config.cjs`), serve the SPA with Nginx (SPA fallback to `index.html`, `/api` proxied to `localhost:4040`, hashed assets cached 1 year), and get TLS via certbot. `pm2 save`/`pm2 startup` handle reboots.

**Q49. How do environment variables differ between frontend and backend?**
Backend reads `.env` at runtime via dotenv (secrets like `JWT_SECRET`, `AWS_*`, `SMTP_*`). Frontend `VITE_*` vars are **baked into the JS bundle at build time** — so they must be set before building and match the production domain.

**Q50. What does the server do on startup?**
Binds the port, seeds the admin user from env (creating or promoting `factor_admin`), starts the hourly reminder scheduler, and asynchronously recomputes forecasts for every client that has inventory data (only clients with movements — it scans stock movements, not user accounts).

**Q51. How would you add CI/CD?**
A pipeline that runs `tsc --noEmit` (typecheck) in both apps, ESLint/Prettier, the forecast-engine test runner, `npm audit`, then builds and deploys (rsync/ssh + `pm2 reload` for backend, rsync of `frontend/dist` for the static site). Secrets stay in the server's `.env`, never in CI logs.

### J. Testing & quality

**Q52. What tests exist?**
The forecast engine has a standalone test file (`forecast-engine.tests.ts`) with an inline assert helper (no framework dependency) covering availability correction, factor clamping, and edge cases — run with `bun src/lib/forecast-engine.tests.ts`. There's no unit/integration suite for routes yet — that's a documented improvement (superagent + a test DynamoDB or mocks).

**Q53. How do you verify correctness without many automated tests?**
Defense in depth: server-side validation on every route, model field allowlists, idempotent state flips, and the audit trail — every workflow action is recorded, so behavior can be verified by replaying events. The security work was verified live with a full matrix (malformed JSON, prototype-pollution bodies, oversized bodies, upload magic-byte matrix, evil-origin 403, login throttling).

**Q54. What would you improve if you had a month?**
Top of the list: close the IDOR gap with a shared `assertOwned` helper; add proper integration tests for the document lifecycle (PO→GRN→stock, SO→dispatch→invoice); move JWTs to short-lived access + refresh-token rotation with server-side revocation; move rate limiting to Redis; replace `scanByType` scans with paginated GSI queries; add a CI pipeline with lint/typecheck/audit gates; and add password reset + MFA.

---

*Generated from the actual codebase — cross-check with `COMPLETE-WORKFLOW-GUIDE.md`, `SECURITY-AUDIT.md`, `DEPLOY.md`, and `backend/src` for details.*
