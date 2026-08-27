# WH-TECH-02 — WHIZUNIK COMMAND — The Executive Control System — Technical Architecture

**Document Type:** Technical Architecture Record (Day 2 — current-state documentation)
**Version:** 1.0
**Date:** 2026-08-18
**Classification:** Internal — Draft for Sankalp review
**Status:** Evidence-based record of the architecture as it exists today; no code modified, no functionality developed

---

## Document Control

| Attribute | Value |
|-----------|-------|
| Document ID | WH-TECH-02 |
| Document Title | WHIZUNIK COMMAND — The Executive Control System — Technical Architecture |
| Document Type | Current-state architecture record (Day 2 — documentation exercise) |
| Version | 1.0 |
| Classification | Internal — Draft for Sankalp review |
| Prepared by | Ram Shrivastava |
| Reviewed by | Sankalp (pending) |
| Date | 2026-08-18 |
| Scope | Architecture of WHIZUNIK COMMAND **as it exists today**, verified from the repository |

### Revision History

| Version | Date | Author | Description of Changes |
|---------|------|--------|------------------------|
| 1.0 | 2026-08-18 | Ram Shrivastava | Initial Day 2 current-state technical architecture record |

### Critical Rules Applied

- **No new functionality developed, no code refactored, no architecture changed.**
- Every major statement is traceable to repository evidence (file paths, config, package files, routes).
- Items that could not be verified are explicitly marked **Unknown / Not Found / Partially Verified / Needs Review**.
- Discrepancies between documentation and implementation are recorded, not resolved.
- No secrets, API keys, passwords, tokens or connection strings are exposed — only `.env.example` keys and config shapes are referenced.
- Companion document: `WH-TECH-01-whizunik-hub-product-register.md` (Day 1 module register, 34 modules).

---

## 1. Document Purpose

This document records how WHIZUNIK COMMAND **actually works today** — frontend, backend, database, authentication, hosting, storage, integrations, environments, and module dependencies — as a technical baseline for Sankalp's architecture review. It is a Day 2 documentation exercise only:

- It does **not** propose a redesign.
- It does **not** document future architecture (e.g., a future Intelligence Engine) as current.
- It does **not** implement any recommendation.
- Items that cannot be verified from the repository are marked **Unknown / Not Found / Partially Verified / Needs Review**.

Day 3 (Intelligence Engine documentation) and Day 4 (architecture redesign) are **out of scope** and are not started.

---

## 2. Architecture Overview

WHIZUNIK COMMAND is a **monolithic full-stack web application** in one repository: a client-side-rendered React SPA (`frontend/`) talking to a single Express + TypeScript API (`backend/`), backed by **one AWS DynamoDB table** (single-table design), with **S3** for file storage and **Nodemailer (SMTP)** for transactional email. Two business workflows share the codebase:

1. **Receivables factoring & monitoring** — invoices (AR), purchase invoices (AP), proformas/advances, checker→treasury approval pipeline, NOA emails, reminders, ageing/dashboard.
2. **Goods trading lifecycle** — product catalogue, quotations, sales orders, purchase orders, goods receipts (GRN), dispatches, inventory/stock movements, and the demand-forecasting + pricing-recommendation engine.

**Topology:** a single VPS runs Nginx (static SPA + reverse proxy) and one PM2 process (fork mode, 1 instance) for the API. There is **one production domain** (`adventra.whizunikhub.com`), **one DynamoDB table**, and **one S3 bucket**. Multi-client isolation is **data-level only**: most entities carry a `clientId` and are queried via `GSI1` (`CLIENT#{clientId}`); there are no per-client deployments, databases, feature flags or tenant configurations beyond `InvoiceTemplate` and `CatalogueSettings` records.

**Naming discrepancy (recorded, not resolved):** the product is simultaneously branded **WHIZUNIK COMMAND** (frontend UI, theme key `whizunik-theme`), **Insight Factor** (backend/API logs, email templates, admin seed, repo/package name, default DynamoDB table `InsightFactor`), and **Adventra** (production domain, NOA email branding hard-coded in a route, seed data, deployment docs). **Globalor** is referenced in the product brief as a **planned client/brand** for the standardised product but has **zero references in code** (see §15). This is recorded as an observation (see §19 O-01).

---

## 3. Technology Stack

Versions are extracted from `package.json` files; runtime/infrastructure versions are marked where not verifiable.

| Layer | Technology | Version | Evidence | Purpose |
| ----- | ---------- | ------- | -------- | ------- |
| Frontend framework | React (SPA) | ^19.2.0 | `frontend/package.json` | UI rendering |
| Frontend routing | TanStack Router (file-based) | ^1.168.25 | `frontend/package.json`, `frontend/src/router.tsx`, `frontend/src/routeTree.gen.ts` | Client-side routing |
| Server-state fetching | TanStack Query | ^5.83.0 | `frontend/package.json`, `frontend/src/routes/__root.tsx` | Data fetching/caching |
| Frontend build | Vite | ^7.3.1 | `frontend/package.json`, `frontend/vite.config.ts` | Dev server + static build → `dist/` |
| Styling | Tailwind CSS (v4 plugin) | ^4.2.1 | `frontend/package.json`, `frontend/src/styles.css` | Utility styling + design system |
| UI primitives | Radix UI + shadcn-style components | multiple `@radix-ui/react-*` | `frontend/package.json`, `frontend/src/components/ui/` | Accessible UI building blocks |
| Charts | Recharts | ^2.15.4 | `frontend/package.json` | Dashboard/forecast charts |
| Forms/validation | react-hook-form + zod | ^7.71.2 / ^3.24.2 | `frontend/package.json` | Form handling, client validation |
| Backend framework | Express + TypeScript | ^4.21.2 / ^5.3.3 | `backend/package.json`, `backend/src/server.ts` | HTTP API |
| Backend runtime | Node.js | **Unknown** (no `engines` field) | `backend/package.json` | Runtime — version not pinned/verifiable |
| Backend dev tooling | tsx (watch) / tsc (build) | ^4.7.0 / ^5.3.3 | `backend/package.json` | Dev runner, compile to `dist/` |
| Database | AWS DynamoDB (single-table) | SDK ^3.500.0 | `backend/src/dynamodb.ts`, `backend/src/config.ts` | Primary data store |
| Object storage | AWS S3 | SDK ^3.500.0 (+ presigner) | `backend/src/s3.ts`, `frontend/src/lib/s3-image.ts` | File uploads/attachments |
| Authentication | JWT (jsonwebtoken) + bcryptjs | ^9.0.2 / ^2.4.3 | `backend/src/middleware/auth.ts`, `backend/src/models/user.ts` | Session + password hashing |
| Email | Nodemailer (SMTP) | ^9.0.4 | `backend/src/email.ts`, `backend/src/config.ts` | Reminders, NOA, approvals, notifications |
| PDF generation | pdfkit | ^0.19.1 | `backend/package.json`, `backend/src/lib/document-pdf.ts` | Emailed PDF attachments |
| Browser print | Custom print templates (React) | — | `frontend/src/components/invoice-print.tsx` | Print/save-PDF documents |
| Uploads | multer | ^1.4.5-lts.1 | `backend/package.json` | Multipart file uploads |
| Security middleware | helmet, express-rate-limit, express-slow-down | ^7.1.0 / ^7.4.0 / ^2.0.3 | `backend/src/server.ts`, `backend/src/middleware/rate-limit.ts` | Headers, rate limiting, slow-down |
| Validation (server) | zod | ^3.22.0 | `backend/package.json`, `backend/src/routes/index.ts` | Request validation |
| Process manager | PM2 | **Not versioned in repo** | `ecosystem.config.cjs` | Production process management |
| Reverse proxy / static host | Nginx | **Not versioned in repo** | `deploy/nginx.conf` | Static SPA + `/api` reverse proxy |
| TLS | Let's Encrypt (Certbot) | **Not versioned in repo** | `deploy/nginx.conf` (cert paths), `DEPLOY.md` | HTTPS |
| Monorepo orchestration | concurrently (npm workspaces: none — separate installs) | ^9.1.2 | `package.json` (postinstall) | Run FE+BE dev servers together |
| Testing | — | — | `frontend/src/lib/forecast-engine.tests.ts` | **No test runner configured** in any `package.json` (see §19 O-08) |

---

## 4. Frontend Architecture

### 4.1 Framework & Build

- **React 19 SPA**, client-side rendered; output is static files (`frontend/dist/`) — evidence: `frontend/vite.config.ts` ("SPA (client-only) build configuration"), root `package.json` (`build` → `frontend && npm run build`).
- Entry points: `frontend/src/main.tsx`, `frontend/src/router.tsx`; file-based routing via TanStack Router plugin (`frontend/src/routeTree.gen.ts`).
- Dev server proxies `/api` → `http://localhost:4040` so the httpOnly cookie works same-origin (same pattern as Nginx in prod) — evidence: `frontend/vite.config.ts`.

### 4.2 Routing

- Library: **TanStack Router** (file-based, `frontend/src/routes/`).
- **Public routes:** `/` (landing), `/auth` (sign in / sign up), `/approve/:token` (counterparty document approval), `/noa/:token` (NOA response) — evidence: `frontend/src/routes/{index,auth,approve.$token,noa.$token}.tsx`.
- **Protected routes:** `/app/*` (all workspace pages) behind a client-side route wall in `frontend/src/routes/app.tsx` and the auth context (`frontend/src/lib/auth-context.tsx`); server-side guards back this up (§7).
- **Major app routes:** dashboard, invoices, purchases, proformas, queue (checker/treasury), products, inventory, debtors, suppliers, vendors, quotations, sales-orders, purchase-orders, grn, dispatches, expenses, advances, alerts, reminders, accounting, balance-sheet, notes, template (branding), crm, workspace, requests, reports (manager), reporting, forecast, admin, profile, settings, checker, plus preview pages (`invoice-preview.$id`, `note-preview.$id`, `challan.$dispatchId`, `quotation.$quotationId`) — evidence: `frontend/src/routes/app.*.tsx` (43 route files).

### 4.3 Component Structure

- `frontend/src/components/` — shared UI: `ui/` (Radix/shadcn primitives), cross-cutting business components (`transaction-filters.tsx`, `document-view.tsx`, `document-uploader.tsx`, `invoice-print.tsx`, `view-as-banner.tsx`, skeletons).
- `frontend/src/lib/` — client services: `api-client.ts` (API layer), `auth-context.tsx`, `s3-image.ts`, `theme.tsx`, `view-as.ts`, `forecast-engine.ts` (duplicate of backend engine — see §19 O-04).
- `frontend/src/routes/` — one file per route/page (feature components live with their routes).

### 4.4 State Management

- **Server state:** TanStack Query (query cache, `frontend/src/routes/__root.tsx` wraps `<QueryClientProvider>`).
- **Local state:** React hooks per page/form.
- **Auth state:** React context (`frontend/src/lib/auth-context.tsx`) reflecting the server-held session.
- **Theme:** `frontend/src/lib/theme.tsx` (light/dark/system, key `whizunik-theme`).
- **No global store** (no Redux/Zustand/etc.), no client-side persistence layer beyond theme + React Query cache.

### 4.5 API Communication

- **Client:** `frontend/src/lib/api-client.ts` — a `fetch` wrapper; base URL `import.meta.env.VITE_API_URL || "/api"`; sends `credentials: "include"` (httpOnly cookie — JWT never touches `localStorage`).
- **Serialization:** the backend transform middleware (`backend/src/middleware/transform.ts`) converts request `snake_case → camelCase` and response `camelCase → snake_case`, so every frontend type is snake_case — evidence: WH-TECH-01 §6.3, `server.ts`.
- **View-as forwarding:** `api-client.ts` auto-appends `viewAsUserId` from the URL to GET requests (reporting-manager impersonation).
- **Error handling:** non-2xx responses are parsed for `{ error }`, thrown as `Error` with `.status`; 204 handled; dev-mode body logging.

### 4.6 Authentication (frontend)

- Login/signup via `api.auth.*` (`/auth/login`, `/auth/signup`, `/auth/me`, `/auth/logout`, `/auth/profile`); session lives in an httpOnly cookie set by the server — evidence: `frontend/src/lib/api-client.ts` (auth namespace), `frontend/src/lib/auth-context.tsx`.
- Client-side role-based UI: role-driven sidebar and route wall in `frontend/src/routes/app.tsx`.

### 4.7 Major Frontend Modules → Implementation

| Day 1 module | UI location | Key routes | Services |
|--------------|-------------|------------|----------|
| Dashboard (3) | `app.dashboard.tsx` | `/app` | `api.dashboard()`, `scope=all` lists |
| Invoices (9) | `app.invoices.tsx`, `invoice-preview.$id.tsx` | `/app/invoices` | `api.invoices.*` (incl. `sendNoa`, `recordPayment`) |
| Purchases (10) | `app.purchases.tsx` | `/app/purchases` | `api.purchaseInvoices.*` |
| Proformas/Funding (11) | `app.proformas.tsx`, `app.queue.tsx`, `app.checker.tsx` | `/app/proformas`, `/app/queue` | `api.purchaseOrders.*` |
| Catalogue/Inventory (4,6) | `app.products.tsx`, `app.inventory.tsx` | `/app/products`, `/app/inventory` | `api.products.*`, `api.stockMovements.*`, `api.catalogueSettings.*` |
| Goods lifecycle (12–16) | `app.purchase-orders.tsx`, `app.grn.tsx`, `app.sales-orders.tsx`, `app.quotations.tsx`, `app.dispatches.tsx`, `app.challan.$dispatchId.tsx` | `/app/*` | `api.goodsPurchaseOrders.*`, `api.goodsReceipts.*`, `api.goodsSalesOrders.*`, `api.quotations.*`, `api.goodsDispatches.*` |
| Accounting (22–26) | `app.accounting.tsx`, `app.balance-sheet.tsx`, `app.notes.tsx`, `app.template.tsx` | `/app/accounting`, `/app/balance-sheet`, `/app/notes`, `/app/template` | `api.chartOfAccounts.*`, `api.journals.*`, `api.creditDebitNotes.*`, `api.balanceEntries.*`, `api.invoiceTemplates.*` |
| Forecasting (31) | `app.forecast.tsx` | `/app/forecast` | `api.forecast()`, `api.forecastVariables.*` |
| CRM (28) | `app.crm.tsx` | `/app/crm` | `api.crm.*` |
| Workspace (29,30) | `app.workspace.tsx`, `app.requests.tsx`, `app.reports.tsx` | `/app/workspace`, `/app/requests`, `/app/reports` | `api.submissions.*`, `api.requests.*`, `api.userProgress()` |

---

## 5. Backend Architecture

### 5.1 Framework & Entry Point

- **Express 4 + TypeScript**; entry `backend/src/server.ts` (dev: `tsx watch`, prod: `node dist/server.js`) — evidence: `backend/package.json`.
- Server identity in logs/emails: **"Insight Factor API"** (`server.ts` startup log, `email.ts` default company name).

### 5.2 Middleware Pipeline (order in `server.ts`)

1. Production guard — refuses to boot with missing/short/placeholder `JWT_SECRET`.
2. `helmet` (strict CSP, HSTS only in prod) + `Permissions-Policy`.
3. CORS (origin allowlist; dev origins merged only when not production).
4. `cookieParser`; JSON body limit `5mb`; URL-encoded limit `100kb`.
5. `requestLogger`, `sanitizeInput` (XSS scrub), field-transform (`snake_case ⇄ camelCase`).
6. `GET /health` (public).
7. `/api` mounted with `csrfOriginGuard` + `apiLimiter` (1000 req/15min) + `noStore`.
8. 404 handler + central `apiErrorHandler`.
9. On startup: admin seed from env (`seedAdmin`), reminder scheduler (`startReminderScheduler`), forecast recompute (`recomputeAllForecastsOnStartup`).

### 5.3 API Architecture

- **Single route file:** `backend/src/routes/index.ts` (5,407 lines) — all REST handlers for every module are inline `async (req, res)` closures with per-route `authMiddleware` + role guards (`requireAdmin` / `requireChecker` / `requireTreasury`), plus public token routes (`/approvals/:token`, `/noa/:token`) using `publicTokenLimiter` — evidence: `backend/src/routes/index.ts` route inventory.
- **Business logic locations:** route handlers; model static methods (e.g., `User.signup/getProfile/updateProfile`, `Submission.*`); `backend/src/services/forecast-service.ts`; `backend/src/lib/forecast-engine.ts`; `backend/src/lib/document-pdf.ts`.
- **Validation:** zod in route handlers.
- **Data access:** `backend/src/dynamodb.ts` (generic wrapper over `@aws-sdk/lib-dynamodb`).
- **Background processing:** in-process scheduler in `backend/src/invoice-reminder.ts` (hourly checks, once-per-day-per-invoice reminder emails); forecast recompute on startup + every stock event + daily freshness. **No queues, workers, cron or external job infrastructure exist.**

**Request flow (as implemented):**

```
Browser
  ↓  HTTPS (Nginx proxy → :4040)
Express middleware chain (helmet → cors → cookies → sanitize → transform)
  ↓
Route handler in routes/index.ts (auth + role guards, zod validation)
  ↓
Business logic (inline / model statics / forecast-service / lib)
  ↓
dynamodb.ts wrapper → DynamoDB (single table) · s3.ts → S3 · email.ts → SMTP
```

### 5.4 Major Backend Modules → Implementation

| Module | API routes (prefix) | Handlers | Data models |
|--------|---------------------|----------|-------------|
| Auth/RBAC | `/auth/*`, `/admin/users*`, `/users/:id` | `routes/index.ts` + `User` statics | `models/user.ts` |
| Products/Catalogue | `/products`, `/catalogue-settings` | inline | `product.ts`, `catalogue-settings.ts` |
| Inventory | `/stock-movements` (+ `/confirm`, `/cancel`) | inline | `stock-movement.ts` |
| Masters | `/debtors`, `/suppliers`, `/vendors` | inline | `debtor.ts`, `supplier.ts`, `vendor.ts` |
| Invoices AR | `/invoices` (+ `/issue`, `/payment`, `/send-noa`, `/send-reminder`, `/remind-debtor/:token`) | inline | `invoice.ts`, `reminder-log.ts` |
| Purchase invoices AP | `/purchase-invoices` (+ `/send-reminder`) | inline | `purchase-invoice.ts` |
| Proformas/Funding | `/purchase-orders` (+ `/convert-to-so`) | inline | `purchase-order.ts`, `advance.ts` |
| Goods lifecycle | `/goods-purchase-orders`, `/goods-receipts`, `/goods-sales-orders`, `/quotations`, `/goods-dispatches`, `/approvals/:token` | inline | `goods-*.ts`, `quotation.ts` |
| Accounting | `/chart-of-accounts`, `/journals`, `/account-transactions/:id`, `/credit-debit-notes`, `/balance-entries`, `/invoice-templates` | inline | `chart-of-account.ts`, `journal.ts`, `credit-debit-note.ts`, `models-combined.ts` |
| Alerts/Audit | `/alerts` (+ `/generate`), `/audit/activity` | inline | `alert.ts`, `audit-log.ts` |
| CRM | `/crm/leads`, `/crm/opportunities`, `/crm/activities` | inline | `models-combined.ts` |
| Submissions | `/submissions`, `/requests` | `Submission` statics | `submission.ts` |
| Forecasting | `/forecast`, `/forecast-variables` (+ `/recompute`) | inline + `forecast-service.ts` | `forecast-variable.ts` |
| Dashboard | `/dashboard`, `/user-progress` | inline | (computed from models) |
| Files | `/upload`, signed-download endpoints | inline | S3 keys in models |

---

## 6. Database Architecture

### 6.1 Technology

- **AWS DynamoDB**, single-table design — evidence: `backend/src/dynamodb.ts` ("Single-Table Design" comment), `backend/.env.example` (`DYNAMODB_TABLE=InsightFactor`).
- Table name configurable via `DYNAMODB_TABLE` (default **`InsightFactor`**); local development via `DYNAMODB_ENDPOINT` (DynamoDB Local) — evidence: `backend/src/config.ts`.
- **No ORM, no schema/migration files** — item shape is enforced by TypeScript model files and application code only.

### 6.2 Key Design

- `PK` / `SK` — unique item identity (`sk` defaults to `pk`).
- `GSI1` — `gsi1pk = "CLIENT#{clientId}"`, `gsi1sk = "{EntityType}#{createdAt}"` → client-scoped queries.
- `GSI2` — `gsi2pk = entityType` → entity-scoped queries (e.g., global scans).
- `entityType` discriminator (`User`, `Product`, `Invoice`, …).
- Access patterns in `dynamodb.ts`: `getItem`, `putItem`, `updateItem`, `updateItemIf` (conditional updates for atomic state flips like draft→confirmed), `deleteItem`, `queryByGSI1`, `queryByGSI2`, `scanByType`.

### 6.3 Module → Data Mapping

| Application Module | Main Data | Storage |
| ------------------ | --------- | ------- |
| Auth & RBAC | Users, roles, managers | `User` items, GSI1 (`CLIENT#{userId}`), GSI2 (`User`) |
| Sales / Invoices | Invoices, payments, reminders, NOA fields | `Invoice`, `ReminderLog` items |
| Purchases / AP | Purchase invoices | `PurchaseInvoice` items |
| Funding | Proformas, advances | `PurchaseOrder`, `Advance` items |
| Catalogue / Inventory | Products, stock movements, catalogue settings | `Product`, `StockMovement`, `CatalogueSettings` items |
| Goods lifecycle | POs, GRNs, SOs, quotations, dispatches | `GoodsPurchaseOrder`, `GoodsReceipt`, `GoodsSalesOrder`, `Quotation`, `GoodsDispatch` items |
| Customers / Suppliers | Debtors (global), suppliers, vendors | `Debtor`, `Supplier`, `Vendor` items |
| Accounting | CoA, journals, notes, balance entries, templates | `ChartOfAccount`, `Journal`, `CreditDebitNote`, `ManualBalanceEntry` (in `models-combined.ts`), `InvoiceTemplate` items |
| Forecasting | Persisted forecast snapshots | `ForecastVariable` items |
| CRM / Submissions / Alerts / Audit | Leads, opportunities, activities; submissions; alerts; audit log | Combined model items, `Submission`, `Alert`, `AuditLog` items |
| Files | Object keys/metadata (objects live in S3) | Key references on entity items |

### 6.4 Indexes & Relationships

- **GSI1 (client-scoped)** is the primary read path for all client-owned data; **GSI2 (entity-scoped)** supports cross-client lists (e.g., `scope=all` dashboards, admin).
- Relationships are **application-enforced, not database-enforced** (no foreign keys): e.g., invoice↔sales-order, GRN↔PO, dispatch↔SO, forecast↔product/stock-movement, advance↔invoice.
- Note: `Debtor` is stored **globally (no `clientId`)** while most other entities are client-scoped — recorded as an open question (see §20 Q-10).

---

## 7. Authentication & Authorization

### 7.1 Mechanism

- **JWT in an httpOnly cookie** (`auth_token`), `SameSite=Strict`, `Secure` in production, default 7-day expiry — evidence: `backend/src/middleware/auth.ts` (`authCookieOptions`, `setAuthCookie`), `backend/src/config.ts` (`jwt`).
- Issuer `insight-factor-api` / audience `insight-factor-web` claims are validated when present; `Bearer` header fallback supported for scripts/tests — evidence: `backend/src/middleware/auth.ts` (`TOKEN_ISSUER`, `TOKEN_AUDIENCE`).
- Passwords hashed with **bcrypt** (cost 12 for admin seed) — evidence: `backend/src/models/user.ts`, `server.ts` (`seedAdmin`).
- Login flow: `POST /auth/login` → bcrypt compare → JWT → cookie set; `GET /auth/me`; `POST /auth/logout` clears the cookie. Opaque 401s; failed-attempt-only rate limits (login 30/IP, 10/account; signup 10/IP/hr; public 60; API 1000) + graduated slow-down — evidence: `backend/src/middleware/rate-limit.ts`, `backend/src/config.ts` (`rateLimit`).

### 7.2 Roles & Authorization

- **7 roles:** `client`, `sales_rep`, `operations`, `checker`, `treasury`, `reporting_manager`, `factor_admin` — evidence: `backend/src/models/user.ts`, `backend/src/middleware/roles.ts`.
- Server-side guards `requireAdmin` / `requireChecker` / `requireTreasury` per route; maker–checker segregation on proformas, quotations, POs; treasury-only payment recording — evidence: `backend/src/routes/index.ts`.
- **View-as:** read-only impersonation by `reporting_manager` over managed users (`viewAsMiddleware`, GET-only, target must be a report) — evidence: `backend/src/routes/index.ts`, `frontend/src/lib/view-as.ts`.
- Client-side route wall + role-driven sidebar mirror these roles — evidence: `frontend/src/routes/app.tsx`.
- **CSRF:** `SameSite=Strict` cookie + server-side Origin allowlist on every non-GET `/api` request (`csrfOriginGuard`) — evidence: `server.ts`, `backend/src/middleware/security.ts`.

### 7.3 Protected vs Public

- **Protected:** all `/api/*` routes except `POST /auth/login`, `POST /auth/signup`, `GET /health` — evidence: route guards in `routes/index.ts`.
- **Public token endpoints (no login):** `GET/POST /approvals/:token`, `GET/POST /noa/:token`, `GET /api/invoices/:id/remind-debtor/:token` (one-time tokens) — evidence: `routes/index.ts`, `frontend/src/routes/approve.$token.tsx`, `noa.$token.tsx`.

---

## 8. Hosting & Deployment

### 8.1 Production (as deployed)

| Item | Value | Evidence |
|------|-------|----------|
| Host | Single VPS (**provider unknown / Not Verified**) | `DEPLOY.md`, `deploy/nginx.conf` |
| Domain | `adventra.whizunikhub.com` | `deploy/nginx.conf`, `backend/.env.example` (`CORS_ORIGIN`), `DEPLOY.md` |
| Reverse proxy / static host | Nginx — serves SPA from `/home/www/adventra/frontend/dist`, proxies `/api/` → `127.0.0.1:4040`, `client_max_body_size 12m` | `deploy/nginx.conf` |
| TLS | Let's Encrypt (Certbot), TLSv1.2/1.3, HTTP→HTTPS redirect | `deploy/nginx.conf` |
| Process manager | PM2 — app `adventra-backend`, fork mode, **1 instance**, `max_memory_restart 500M`, logs to `../logs/`, env from `backend/.env` | `ecosystem.config.cjs` |
| Frontend build | `npm run build` → `frontend/dist` (static) | root `package.json`, `DEPLOY.md` |
| Backend | `tsc` → `backend/dist/server.js` | `backend/package.json` |
| CI/CD | **Not Found** — no GitHub Actions / pipelines in repo | repo-wide search |
| Containerization | **Not Found** — no Docker files | repo-wide search |

### 8.2 Development

- `npm run dev` (root) runs FE (Vite, `:5173`) + BE (tsx watch, `:4040`) via concurrently; Vite proxies `/api` → `localhost:4040` — evidence: root `package.json`, `frontend/vite.config.ts`.
- Local DynamoDB supported via `DYNAMODB_ENDPOINT` (DynamoDB Local); S3 optional via `S3_BUCKET`; email optional via SMTP env — evidence: `backend/.env.example`, `backend/src/config.ts`.
- Local browser origins merged into the CORS/CSRF allowlist **only when not production** — evidence: `backend/src/config.ts`.

### 8.3 Testing / Staging

**Testing/Staging Environment: Not Found / Not Verified.** There is no staging deployment configuration in the repo. The only test artifact is a single unit-test file for the forecast engine (`frontend/src/lib/forecast-engine.tests.ts`); **no test runner is configured** in any `package.json` (see §19 O-08).

---

## 9. Storage Architecture

| What | Where | Accessed via | Used by | Evidence |
|------|-------|--------------|---------|----------|
| Product images, document attachments (invoices, POs, GRNs, notes, expenses) | **AWS S3** bucket (`S3_BUCKET` env; referenced bucket name `whizunik` in a code comment) | `backend/src/s3.ts` (put/delete/get-signed-URL) + `POST /upload`; frontend `lib/s3-image.ts` (signed-URL caching) | Product catalogue, invoices, GRNs, expenses, notes, templates (logo) | `backend/src/s3.ts`, `backend/src/config.ts` (s3), `frontend/src/lib/s3-image.ts` |
| File objects' metadata/keys | DynamoDB (key references on entity items) | `dynamodb.ts` | All modules | model files |
| Local filesystem | **Not used** (no evidence) | — | — | repo-wide search |

**Access controls (upload path):** multipart upload with 15 MB cap, magic-byte content detection (blocks HTML/SVG/executables), sanitized keys scoped to the requester's folder, short-lived signed download URLs (60s — `getSignedDownloadUrl` default in `s3.ts`; the frontend caches them for 50s in `s3-image.ts`), delete — evidence: `backend/src/middleware/security.ts`, `backend/src/s3.ts`, `backend/src/config.ts` (`signedUrlTtlSeconds`), WH-TECH-01 §5 module 27.

**Observation:** S3 is **optional by configuration** (`S3_BUCKET` empty in `.env.example`); uploads silently fail/no-op when unset (see §19 O-07).

---

## 10. API & External Services

Register of external integrations (all **outbound**; no inbound webhooks or third-party APIs):

| Service | Purpose | Used By | Direction | Current Status |
| ------- | ------- | ------- | --------- | -------------- |
| AWS DynamoDB | Primary data store (single table) | Backend (`dynamodb.ts`) | Hub → AWS | Configured (`DYNAMODB_TABLE=InsightFactor` default); runtime status Not Verified |
| AWS S3 | File storage (optional) | Backend (`s3.ts`), uploads | Hub → AWS | Configured via env; bucket/usage Not Verified |
| SMTP provider (Nodemailer) | Transactional email — reminders, NOA, document approvals, submission notifications | Backend (`email.ts`) | Hub → External | **Provider Unknown** (only `SMTP_HOST/PORT/USER/PASS` in config; `.env.example` omits SMTP block — Partially Verified) |
| pdfkit (in-process) | PDF attachments for emailed documents | Backend (`lib/document-pdf.ts`) | Internal | Live |
| Browser print templates | Print/save-PDF documents | Frontend (`components/invoice-print.tsx` etc.) | Internal | Live |

**Not found (verified absent):** payment gateways, accounting-system integrations, marketplace/seller APIs, AI services, analytics providers, third-party auth providers (auth is email/password only), webhooks. Marketing claims of "SOC 2 / ISO 27001" on the landing page (`frontend/src/routes/index.tsx`) are **unverified** (no evidence in repo).

---

## 11. Data Import / Export

| Movement | Mechanism | Evidence |
|----------|-----------|----------|
| CSV / Excel imports | **Not Found** | repo-wide search |
| Report / data exports | **Not Found** (no CSV/Excel export endpoints or buttons) | repo-wide search |
| PDF generation (out) | Backend `pdfkit` for emailed PDFs (invoices, quotations, SOs, POs, NOA); browser print templates for on-screen save/print (invoice, challan, notes) | `backend/src/lib/document-pdf.ts`, `frontend/src/components/invoice-print.tsx`, `app.challan.$dispatchId.tsx` |
| Email out (out) | Reminders (scheduler + instant), NOA, counterparty approvals, submission notifications | `backend/src/email.ts`, `backend/src/invoice-reminder.ts` |
| Demo/seed data (in) | `backend/scripts/seed-crm-demo.ts`, `seed-sku-movements.ts`, `seed-forecast-demo.ts` — Adventra-branded demo datasets writing to the **configured (real) table** | `backend/scripts/*.ts` |
| Database migrations | **Not Found** (schema-less DynamoDB; no migration files) | repo-wide search |

**Data flow (as implemented):**

```
User input (UI forms) / seed scripts
        ↓
Express API (routes/index.ts → validation → business logic)
        ↓
DynamoDB (single table)  ── computed at read time ──▶ dashboards / reports / balance sheet
        ↓
PDFs (pdfkit) + emails (SMTP)   ·   S3 (attachments)
```

---

## 12. Production Environment

| Area | Current state | Evidence |
|------|---------------|----------|
| Frontend | Static SPA served by Nginx at `adventra.whizunikhub.com` | `deploy/nginx.conf` |
| Backend | Express API on `127.0.0.1:4040`, PM2 (`adventra-backend`, fork, 1 instance) | `ecosystem.config.cjs`, `deploy/nginx.conf` |
| Database | AWS DynamoDB single table (default `InsightFactor`; real table name **Not Verified**) | `backend/.env.example`, `backend/src/config.ts` |
| Storage | S3 bucket (name Not Verified; `whizunik` in a frontend comment) | `frontend/src/lib/s3-image.ts` |
| API config | `CORS_ORIGIN=https://adventra.whizunikhub.com`, strict allowlist in prod | `backend/.env.example`, `backend/src/config.ts` |
| Authentication | JWT httpOnly cookie, `Secure` in prod; HSTS preload | `backend/src/middleware/auth.ts`, `server.ts` |
| Deployment | Manual — `DEPLOY.md` steps (build → upload → PM2 restart → certbot); no CI/CD | `DEPLOY.md`, repo-wide search |
| Runtime status | **Not Verified** from repo (artifacts exist; nothing proves it is live) | — |

---

## 13. Development Environment

| Area | Current state | Evidence |
|------|---------------|----------|
| Frontend | Vite dev server (`:5173`), proxy `/api` → `:4040` | `frontend/vite.config.ts` |
| Backend | `tsx watch src/server.ts` (`:4040`), nodemon-less hot reload | `backend/package.json` |
| Database | DynamoDB Local via `DYNAMODB_ENDPOINT`, or shared/remote table | `backend/.env.example` |
| Storage | Optional S3 (`S3_BUCKET`) | `backend/.env.example` |
| API config | Local origins auto-merged into allowlist (dev only) | `backend/src/config.ts` |
| Authentication | Same JWT flow; cookie not `Secure` in dev (http over localhost) | `backend/src/middleware/auth.ts` |
| Email | Optional SMTP env; skips sends with a warning when unset | `backend/src/email.ts` (`isEmailConfigured`) |
| Orchestration | Root `npm run dev` (concurrently), `postinstall` installs both apps | `package.json` |

---

## 14. Testing/Staging Environment

**Testing/Staging Environment: Not Found / Not Verified.**

- No staging deployment configuration exists in the repository.
- No test runner is configured (no `test` script in any `package.json`).
- The only test artifact is `frontend/src/lib/forecast-engine.tests.ts` (forecast engine unit tests, no runner wired).
- No CI pipeline exists that would run tests.

---

## 15. Client Environments

**No separate per-client deployments or databases exist.** There is one deployment, one DynamoDB table, and one S3 bucket. Multi-client isolation is **data-level via `clientId`** (GSI1) on most entities, with these per-client configuration records:

| Client | What exists today | Evidence | Notes |
|--------|-------------------|----------|-------|
| **Adventra** | Production domain `adventra.whizunikhub.com`; PM2 app name `adventra-backend`; `CORS_ORIGIN`; NOA email company name hard-coded `"Adventra"`; Adventra-branded seed data (`ADV-RC-001` SKUs); deployment docs and PPT decks | `deploy/nginx.conf`, `ecosystem.config.cjs`, `backend/.env.example`, `DEPLOY.md`, `backend/src/routes/index.ts` (send-noa), `backend/scripts/seed-*.ts` | Single-tenant deployment assumption — see §19 O-01, §20 Q-4 |
| **Globalor** | **Planned client per the product brief — no code, config, or deployment references exist.** Zero matches for "Globalor" in a repository-wide search (including binary PPTX decks/assets); the frontend renders **WHIZUNIK COMMAND**. No Globalor modules, routes, tenant records, or branding exist | repo-wide search (zero matches); `frontend/src/routes/*` (WHIZUNIK COMMAND branding) | Onboarding would currently require code-level brand/template changes (see §20 Q-1/Q-2) |
| **Retail** | No client-specific implementation. "Retail" appears only in the MRP field description and demo/seed company names (e.g., "MetroMart Retail Pvt Ltd" in `backend/scripts/seed-crm-demo.ts`) | `backend/src/models/product.ts`, `backend/scripts/seed-crm-demo.ts` | Not a tenant |

**Client-specific mechanisms that DO exist (generic, config-driven):**

- `InvoiceTemplate` — per-client document branding (company name/logo/colors/tax id/bank details/currency) used by browser print previews — evidence: `backend/src/models/models-combined.ts`, `frontend/src/routes/app.template.tsx`.
- `CatalogueSettings` — per-client default minimum gross margin — evidence: `backend/src/models/catalogue-settings.ts`.
- **Hard-coded client logic:** NOA email company name `const companyName = "Adventra";` in the send-NOA route while every other email/PDF resolves the company name from the user record — evidence: `backend/src/routes/index.ts` (send-noa), `backend/src/email.ts`.
- **No feature flags, no tenant IDs beyond `clientId`, no client-specific env vars, no client-specific frontend/backend branches** exist.

---

## 16. Module Dependency Map (today's system)

| Module | Depends On | Feeds | Data Shared |
|--------|------------|-------|-------------|
| Authentication & RBAC | User model, DynamoDB | All modules (identity/roles) | User records, roles, `clientId` |
| Portfolio Dashboard | Invoices, PurchaseInvoice, Expense, Alert, Debtor | Users (read-only) | Aggregated KPIs; `scope=all` cross-client lists |
| Product Catalogue | StockMovement, ForecastVariable, S3 | Inventory, PO/GRN/SO/Quotation/Invoice lines, Forecasting | Product/SKU, price/cost/margin, lead time, safety stock |
| Inventory & Stock Movements | Product, GRN, Dispatch | Live stock balance, Forecasting, Balance Sheet, Dashboard | Confirmed stock-in/out entries (Σ credits − debits) |
| Sales Invoices (AR) | Debtor, Product, GoodsSO, PurchaseOrder (proforma), Advance | Funding pipeline, NOA, Reminders, Dashboard, Balance Sheet | Invoice amounts, advance deductions, payment records |
| Purchase Invoices (AP) | Supplier/Vendor, GoodsPO, GoodsReceipt, Advance | Payables, Reminders, Dashboard, Balance Sheet | Bill amounts, received-qty back-fill, differences |
| Proformas & Funding | PurchaseOrder, Advance, Debtor/Vendor, Product | Invoice creation (conversion), Queue/Checker | Advance %/amounts, funding decisions |
| Goods lifecycle (PO → GRN; Quotation → SO → Dispatch) | Product, Supplier/Vendor, Debtor | Stock movements (GRN/dispatch), Purchase/Sales invoices, Forecast | Quantities, statuses derived from received/dispatched/delivered |
| Forecasting & Pricing | Product, StockMovement, ForecastVariable | Forecast page, reorder/pricing recommendations | Persisted snapshots; recompute on every stock event |
| Accounting (CoA/Journals/Notes/Balance) | Many models (manual entries only — no auto-posting) | Balance Sheet, print previews | Journal lines, manual balance entries |
| Alerts & Audit | Invoice, AuditLog | Dashboard alerts feed, admin activity feed | DPD-based overdue alerts (manual generation), audit events |
| Reminders & Scheduler | Invoice, PurchaseInvoice, ReminderLog, Email | Debtor/admin emails | `lastOverdueReminderDate` dedupe state |
| File Storage | S3, Security middleware | All modules with attachments | Signed URLs, object keys |
| Submissions / View-As | User (manager), Submission | Workspace, Reports, Requests | Request statuses, impersonated data views |

**Key flows (verified):** Sales: quotation → sales order → dispatch → invoice → payment/reminder/NOA. Procurement: PO → GRN (credits stock) → purchase invoice → payment/reminder. Funding: proforma → advance → invoice deduction. Forecasting: stock events → recompute → snapshots → recommendations.

---

## 17. Current Architecture Diagram

```
                       ┌─────────────────────────────────────────┐
                       │           User (browser)                │
                       │  React 19 SPA · TanStack Router/Query   │
                       └──────────────────┬──────────────────────┘
                                          │ HTTPS (httpOnly session cookie)
                                          ▼
                       ┌─────────────────────────────────────────┐
                       │   Nginx  (adventra.whizunikhub.com)     │
                       │  static SPA (frontend/dist)  +  /api →  │
                       └──────────────────┬──────────────────────┘
                                          │ reverse proxy :4040
                                          ▼
                       ┌─────────────────────────────────────────┐
                       │  Express API (PM2, 1 instance, fork)    │
                       │  helmet · cors · sanitize · transform   │
                       │  csrf origin guard · rate limits        │
                       │  routes/index.ts (+role guards, zod)    │
                       │  in-process: reminder scheduler (hourly)│
                       │              forecast recompute         │
                       └──────┬──────────┬──────────┬────────────┘
                              │          │          │
                ┌─────────────▼───┐  ┌───▼──────┐  ┌─▼─────────────┐
                │ DynamoDB        │  │ S3       │  │ SMTP (nodemailer) │
                │ single table    │  │ files    │  │ reminders/NOA/   │
                │ GSI1 client,    │  │ (images, │  │ approvals        │
                │ GSI2 entity     │  │ docs)    │  │                  │
                └─────────────────┘  └──────────┘  └─────────────────┘

   Public token pages (no login): /approve/:token · /noa/:token · /remind-debtor/:token
   Data isolation: per-user clientId via GSI1 (single table, single deployment)
   Testing/Staging: NOT FOUND   ·   CI/CD: NOT FOUND   ·   Globalor: planned client, not in code
```

---

## 18. Business-Level Architecture Explanation

*(For Sankalp — no code required to understand.)*

1. **How does information enter Hub?** People type it in — sales teams create invoices, quotations, orders; warehouse staff record goods receipts and dispatches; the finance desk records payments, advances and journal entries. Data also enters via demo/seed scripts (development convenience), and counterparties respond through emailed links (approve a quotation, accept a Notice of Assignment). There are **no automatic feeds** — no bank feeds, no CSV/Excel import, no marketplace/API connections today.

2. **Where is information stored?** Everything lives in **one AWS database table** (DynamoDB). Invoices, products, stock movements, users, journals — all share the same table, separated by record type and by "client ID" tags. Files (images, PDF attachments) live in **AWS S3**; the database only keeps references to them. Emails are sent out via the customer's SMTP mail server.

3. **How do modules communicate?** They share the same database and the same API. When a goods receipt is confirmed, the system writes a stock-in movement, updates the purchase order's "received" state, and triggers the forecast to recalculate. When an invoice is issued, it can deduct an advance, create a funding record, and feed the dashboard and balance sheet. Modules "talk" by writing records the other modules read — there is no separate message bus or event queue.

4. **Where do calculations happen?** On the server, inside the API handlers: invoice totals, advance deductions, stock balances, ageing, the balance sheet, and the forecast/reorder/pricing engine (the forecast math is duplicated in the browser too, so the screen can show live numbers — see observation O-04). The database stores raw records; figures are computed when someone opens a page.

5. **Where does client-specific logic exist?** Mostly nowhere — modules are generic and tagged with a client ID. The exceptions: the **invoice document template** (logo, colors, tax details) and **catalogue margin settings** are per-client records; the NOA email hard-codes the company name "Adventra"; deployment/branding targets one domain (`adventra.whizunikhub.com`). **Globalor is planned per the brief but not implemented.**

6. **What external dependencies are important?** **AWS (DynamoDB + S3)** — if AWS is down or the table is misconfigured, the whole product stops; **the mail server (SMTP)** — reminders and approvals depend on it; the **server/VPS** — a single machine runs both the website and the API. No payment gateway, accounting package, or AI service is connected.

7. **What obvious scalability/architecture concerns exist?** The product runs on **one server and one database table** (single points of failure); the dashboard and balance sheet **recalculate totals at read time** (slows with data volume); the forecast engine exists **twice** (client and server copies can drift); there is **no staging environment, no CI/CD, and no automated tests** wired in; alerts are generated **manually**; journals are **manual** (no auto-posting); alert/API rate limits are **in-memory** (lost on restart, ineffective across multiple instances). None of these are fixed in this document — see §19 and §20.

---

## 19. Current Architecture Observations

Classification: **Normal / No Immediate Concern** · **Needs Review** · **Potential Scalability Concern** · **Potential Architecture Concern** · **Unknown**

| ID | Severity | Observation | Evidence | Why it matters |
|----|----------|-------------|----------|----------------|
| O-01 | Needs Review | **Four product names in play:** WHIZUNIK COMMAND (UI), Insight Factor (backend/API/table), Adventra (domain/NOA/docs), and **Globalor (planned client per brief — zero code references)** | `frontend/src/routes/*` (WHIZUNIK COMMAND), `backend/src/middleware/auth.ts` (insight-factor issuer/audience), `deploy/nginx.conf` + `DEPLOY.md` (adventra), repo-wide search (no Globalor) | Brand confusion; every rebrand/onboarding touches code |
| O-02 | Needs Review | **Single production server** (Nginx + PM2 + one API instance) | `deploy/nginx.conf`, `ecosystem.config.cjs` | Single point of failure; no horizontal scaling path |
| O-03 | Potential Architecture Concern | **Monolithic route file** (~5,300-line `routes/index.ts`) with inline handlers; business logic not separated into controllers/services for most modules | `backend/src/routes/index.ts` | Maintainability; testability; onboarding |
| O-04 | Needs Review | **Forecast engine duplicated** verbatim in frontend and backend (only a "KEEP IN SYNC" comment guards it) | `frontend/src/lib/forecast-engine.ts`, `backend/src/lib/forecast-engine.ts` | Logic drift between display and server persistence |
| O-05 | Potential Scalability Concern | **Read-time aggregation everywhere:** dashboard, balance sheet, reporting, user-progress each recompute totals independently; dashboard sums only `direction==="in"` (no debits) | `backend/src/routes/index.ts` (dashboard/user-progress), `frontend/src/routes/app.dashboard.tsx`, `app.balance-sheet.tsx` | Numbers can disagree; cost grows with data volume |
| O-06 | Needs Review | **Journals are manual only** — invoices/payments/GRNs/dispatches do not auto-post entries | `backend/src/routes/index.ts` (journals), WH-TECH-01 KF-05 | Accounting depth claim unverified; manual bookkeeping burden |
| O-07 | Needs Review | **Alert generation is manual/admin-triggered only**; S3 optional (uploads fail with HTTP 500 when `S3_BUCKET` is unset — no graceful degradation); SMTP optional (sends are skipped with a warning when unconfigured) | `backend/src/routes/index.ts` (alerts/generate, upload route), `backend/src/config.ts`, `backend/src/email.ts` (`isEmailConfigured`) | Risk monitoring depends on human action; partial feature degradation |
| O-08 | Potential Architecture Concern | **No test runner, no CI/CD, no staging environment**; single test file not wired into scripts | `package.json` files, `frontend/src/lib/forecast-engine.tests.ts`, repo-wide search | Changes ship without automated verification |
| O-09 | Needs Review | **In-memory rate limiting** (per-process) and single-table **scans** for admin/entity lists (`scanByType`) | `backend/src/middleware/rate-limit.ts`, `backend/src/dynamodb.ts` | Limits don't survive restart or multi-instance; scans cost reads |
| O-10 | Needs Review | **Seed/demo scripts write to the configured (real) table** with Adventra/WHIZUNIK COMMAND demo data and personal emails | `backend/scripts/seed-*.ts` | Demo data may have leaked into production data |
| O-11 | Needs Review | **Hard-coded client branding** in code (NOA "Adventra"; frontend brand strings) instead of configuration; **no feature flags** for optional modules | `backend/src/routes/index.ts` (send-noa), `frontend/src/routes/*` | Every tenant/brand change requires code edits; **Globalor onboarding would need code changes today** |
| O-12 | Needs Review | **Dual masters & duplicates:** Supplier vs legacy Vendor; two "PO" concepts; dual balance-sheet pages; dual invoice line structures; two frontend print/PDF pipelines | `backend/src/models/{supplier,vendor,purchase-order,goods-purchase-order,invoice}.ts`, `frontend/src/routes/app.{accounting,balance-sheet}.tsx` | Migration state/debt — triage needed (WH-TECH-01 D1–D10) |
| O-13 | Unknown | **Runtime status of production** (live vs testing), hosting provider, Node version, real DynamoDB table name, S3 bucket, SMTP provider | repo-wide search (absent) | Cannot be verified from the repository |
| O-14 | Normal | Single-table design with GSI1/GSI2 access patterns; conditional writes for atomic state transitions; origin-guarded CSRF + httpOnly cookies; magic-byte upload validation | `backend/src/dynamodb.ts`, `backend/src/middleware/security.ts`, `backend/src/middleware/auth.ts` | Sound foundations for current scale |

---

## 20. Items Requiring Sankalp Review

1. **Q-1 — Product name & Globalor:** the product is rendered as **WHIZUNIK COMMAND** while backend/API/table use **Insight Factor** and deployment uses **Adventra**; the brief references **Globalor as a planned client** with zero code references. What is the official name, and is Globalor a client to onboard (timeline?) or a rebrand?
2. **Q-2 — Branding strategy:** approve moving hard-coded brand strings ("Adventra" NOA, frontend brand text) into the per-client document template so future clients (incl. **Globalor**) need no code changes.
3. **Q-3 — Deployment topology:** single-tenant per install vs multi-tenant shared (per `clientId`) vs per-client forks — decides how client-specific items become configurable.
4. **Q-4 — Adventra status:** live production tenant, demo, or seed client?
5. **Q-5 — Production status:** which modules are Live/Testing/Development (not verifiable from repo).
6. **Q-6 — Forecasting & pricing engine:** flagship CORE differentiator or OPTIONAL MODULE?
7. **Q-7 — Alert automation & accounting depth:** automated alert generation? auto-posting journals vs manual-only?
8. **Q-8 — Currency/region:** GSTIN/HSN (India) vs USD default formatting in emails/PDFs.
9. **Q-9 — Debtor scoping:** global debtors vs client-scoped — intentional?
10. **Q-10 — Vendor vs Supplier consolidation** and duplication triage (O-12 / WH-TECH-01 D1–D10).
11. **Q-11 — Data hygiene:** remove/guard seed scripts that write to the real table.
12. **Q-12 — Staging, CI/CD, tests:** are these planned? (Currently absent.)
13. **Q-13 — Cross-client dashboards:** is `scope=all` visibility intended for all roles?

---

## 21. Unknowns / Missing Information

| Item | Status |
|------|--------|
| Runtime status of production (live vs testing vs development) | **Not Verified** from repo |
| Hosting provider (VPS) | **Unknown** |
| Node.js runtime version | **Unknown** (no `engines` field) |
| Real DynamoDB table name in production (default `InsightFactor`) | **Not Verified** |
| S3 bucket name/region in production (comment references `whizunik`) | **Not Verified** |
| SMTP provider | **Unknown** (generic SMTP env only) |
| Nginx / PM2 / OS versions | **Not Verified** (unversioned in repo) |
| **Globalor** — scope, onboarding timeline, target modules | **Not in code; planned per brief** (see §15, §20 Q-1) |
| Testing/staging environment | **Not Found** |
| CI/CD pipeline | **Not Found** |
| Whether emails for reminders target the debtor directly vs admin-forwarding | Partially verified (both paths exist in `email.ts`) |

---

## Final Quality Check

- **Current-state accuracy:** all architecture statements verified against `package.json`, `server.ts`, `config.ts`, `dynamodb.ts`, middleware, route inventory, `deploy/nginx.conf`, `ecosystem.config.cjs`, `.env.example`, `DEPLOY.md`, and frontend route/client files. No future architecture documented as current (the Intelligence Engine is **not** documented as present).
- **Frontend/backend/database/infrastructure/integrations/dependencies/diagram:** covered in §4–§17.
- **Safety:** no code modified, no functionality developed, no recommendations implemented, no credentials or secrets exposed (only `.env.example` keys and config shapes referenced).

---

## Sankalp Architecture Review Agenda

1. **Naming & identity** (Q-1/Q-2): WHIZUNIK COMMAND vs Insight Factor vs Adventra vs **planned Globalor** — official name; branding strategy for future clients.
2. **Topology** (Q-3/Q-4/Q-13): single-tenant vs multi-tenant; Adventra's status; cross-client dashboard visibility.
3. **Production state** (Q-5, §21 unknowns): what is actually live; hosting/SMTP/table/bucket details.
4. **Product positioning** (Q-6): forecasting/pricing engine as core differentiator.
5. **Operational gaps** (Q-7/Q-11/Q-12): alert automation, journal auto-posting, seed-script hygiene, staging/CI/tests.
6. **Duplication triage** (Q-10/O-12): confirm which duplicates are intentional migration states vs debt.
7. **Configurability** (Q-8/Q-9): currency/region targets; debtor scoping.

---

*End of WH-TECH-02 v1.0. Day 2 deliverable only — no Day 3 (Intelligence Engine) or Day 4 (redesign) work performed, no code modified. Internal — Draft for Sankalp review.*
