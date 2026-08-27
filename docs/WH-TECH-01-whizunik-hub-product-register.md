# WH-TECH-01 — WHIZUNIK COMMAND — The Executive Control System — Product & Module Register

**Version:** 1.0
**Type:** Day 1 — Existing Product Inventory & Module Register (evidence-based)
**Source:** Deep-dive inspection of the repository (frontend, backend, database layer, configuration, deployment, documentation)
**Date:** 2026-08-17
**Status:** Draft for Sankalp review

---

## 1. Document Purpose

This register documents the **current, actually-implemented** WHIZUNIK COMMAND product and classifies every verified module/feature for standardisation and reusability. It is an inventory exercise only:

- No new functionality was developed.
- No code was refactored or modified.
- No architectural decisions were made.
- Nothing is documented as implemented unless it could be verified from source code, UI routes, API routes, database models, configuration, deployment files, or documentation.
- Items that could not be verified are explicitly marked **Unknown / Partially Verified / Needs Review**.

Day 2 activities (architecture documentation, technical debt analysis, security assessment, Intelligence Engine architecture) are **out of scope** for this document.

---

## 2. Product Overview (verified functionality only)

WHIZUNIK COMMAND ("The Executive Control System") is a web platform with two distinct business workflows implemented in one codebase:

1. **Receivables factoring & monitoring** (the platform's original positioning — the public landing page is titled *"WHIZUNIK COMMAND — Receivables factoring & monitoring"*): invoice submission, checker approval, treasury funding queue, advances against receivables, debtor master, invoice reminders, Notice of Assignment (NOA) emails, ageing/portfolio dashboards.
2. **Goods trading lifecycle** (built out most recently, branded internally as the *"WHIZUNIK COMMAND Goods Platform"*): product catalogue, quotations, sales orders, purchase orders, goods receipts (GRN), dispatch notes, inventory stock movements, and a demand-forecasting + pricing-recommendation engine.

Both workflows share one platform: a React 19 SPA (TanStack Router/Query, Tailwind v4, shadcn/Radix UI, Recharts) calling an Express 4 + TypeScript API, backed by a **single-table DynamoDB design** (GSI1 client-scoped, GSI2 entity-scoped) with S3 for file storage and Nodemailer for transactional email. Auth is JWT in an httpOnly SameSite=Strict cookie with role-based access control (7 roles).

**Naming discrepancy (recorded, not resolved):** the product appears under three names — **WHIZUNIK COMMAND** (public brand + theme key `whizunik-theme`), **Insight Factor** (server logs, email templates, admin account, repo/package name, DynamoDB table default `InsightFactor`), and **Adventra** (deployment domain `adventra.whizunikhub.com`, NOA email branding, seed data, documentation and PPT decks) — plus **Globalor**, which is referenced in the product brief as the **planned target client/brand** for the standardised product but has **zero code references** (see §5 and §8). See §8 and §10.

---

## 3. Product Module Register

Legend — Status: **Live** / **Testing** / **Development** / **Needs Review** (exactly one; runtime status cannot be verified from the repo, so most rows are "Needs Review" with the deployment evidence noted). Classification: **CORE** / **CONFIGURABLE** / **OPTIONAL MODULE** / **CLIENT-SPECIFIC** / **Needs Sankalp Review** (with rationale).

| # | Module | Purpose | Major Functions | Inputs | Outputs | Dependencies | Status | Classification | Evidence |
| - | ------ | ------- | --------------- | ------ | ------- | ------------ | ------ | -------------- | -------- |
| 1 | Authentication & Session Management | Sign users into the platform and keep sessions secure | Email/password signup & login; httpOnly SameSite=Strict cookie session; logout; /auth/me profile; profile update; per-IP & per-account rate limiting; graduated slow-down; issuer/audience token validation | Email, password, company name, contact name | Session cookie, user profile, security log events | User model, DynamoDB, config (.env) | Needs Review (deployment artifacts exist) | CORE | `backend/src/models/user.ts`; `backend/src/middleware/auth.ts`; `backend/src/middleware/rate-limit.ts`; `frontend/src/routes/auth.tsx`; `frontend/src/lib/auth-context.tsx` |
| 2 | User Management & Role-Based Access (RBAC) | Administer users, assign roles, manage reporting lines | Admin create user; list users; add/remove roles; assign reporting manager; list managers/reports; 7 roles (`client`, `sales_rep`, `operations`, `checker`, `treasury`, `reporting_manager`, `factor_admin`); role-driven sidebar & route wall; maker–checker segregation of duties; admin auto-seed from env | User records, roles, manager ids | Managed users, role assignments, audit events | User model, auth middleware, roles middleware, DynamoDB | Needs Review | CORE | `backend/src/models/user.ts`; `backend/src/middleware/roles.ts`; `backend/src/routes/index.ts` (admin routes); `frontend/src/routes/app.tsx` (nav); `frontend/src/routes/app.admin.tsx` |
| 3 | Portfolio Dashboard | Portfolio-wide KPIs shared across roles | Portfolio KPIs (gross sales, net income, outstanding, advanced, overdue count, collection rate, short payments, avg late days); monthly income trend chart; receivables ageing buckets; alerts feed; cross-client `scope=all` data | All clients' invoices, purchase invoices, expenses, alerts, debtors | KPI cards, charts, ageing table | Invoice, PurchaseInvoice, Expense, Alert, Debtor models | Needs Review | CORE | `frontend/src/routes/app.dashboard.tsx`; `backend/src/routes/index.ts` (scope=all lists) |
| 4 | Product Catalogue | Master data for goods SKUs that every goods document and the forecast reference | CRUD products; SKU auto-generation; category/subcategory/brand/gender/size/color/model/season; barcode + type; unit of measure; unit price/cost/MRP; GST rate + HSN (India); reorder level, max stock, lead time, safety stock; MOQ & order multiple; supplier link + supplier product code; image upload; cascade delete (stock movements + forecast snapshots); active/inactive status; stock badge | Product fields, images | Catalogue records, stock movements, forecast inputs | StockMovement, ForecastVariable models, S3 | Needs Review | OPTIONAL MODULE (goods/distribution customers) — could be Core for goods clients; Sankalp decision needed | `backend/src/models/product.ts`; `backend/src/routes/index.ts` (products); `frontend/src/routes/app.products.tsx` |
| 5 | Catalogue Settings | Per-client pricing defaults for the catalogue | Default minimum gross margin (0.01–0.99) per client; re-baselines legacy products that carry the old hardcoded 0.4 | Margin value | Per-client settings record; product margin updates | Product model | Needs Review | CONFIGURABLE | `backend/src/models/catalogue-settings.ts`; `backend/src/routes/index.ts` (catalogue-settings); `frontend/src/routes/app.products.tsx` (margin editor) |
| 6 | Inventory & Stock Movements | Track stock in/out; the atomic record behind all stock numbers | Manual movement CRUD with 6 reasons (Opening stock, Stock adjustment, Damage, Samples/internal use, Customer return, Supplier return); draft → confirm → cancel lifecycle; system-created movements from confirmed GRNs/dispatches; derived live stock (Σ confirmed credits − debits); per-product ledger; catalogue-only SKU validation; forecast recompute triggers | Catalogue products, quantities, reasons, notes, linked documents | Stock movements, live stock balances, inventory value, forecast triggers | Product, StockMovement models; GRN/Dispatch flows; forecast service | Needs Review | OPTIONAL MODULE (goods customers) | `backend/src/models/stock-movement.ts`; `backend/src/routes/index.ts` (stock-movements); `frontend/src/routes/app.inventory.tsx` |
| 7 | Debtor (Customer) Master | Counterparty master for customers who owe receivables | CRUD debtors; contact/designation/phone/email; industry, address, payment terms (days); auto debtor codes; per-debtor exposure from open invoices; global (not client-scoped) storage | Debtor details | Debtor records; exposure summaries | Debtor model, Invoice model | Needs Review | CORE | `backend/src/models/debtor.ts`; `backend/src/routes/index.ts` (debtors); `frontend/src/routes/app.debtors.tsx` |
| 8 | Supplier & Vendor Masters | Counterparty masters for payables/procurement | Supplier CRUD (`companyName`, status prospect/active/suspended/offboarded); **legacy Vendor CRUD** (client-scoped); merged supplier+vendor dropdowns across procurement UIs; open AP per supplier | Supplier/vendor details | Supplier & vendor records; merged lists | Supplier, Vendor models; PurchaseInvoice | Needs Review | CORE (with duplication note — see §7) | `backend/src/models/supplier.ts`; `backend/src/models/vendor.ts`; `frontend/src/routes/app.suppliers.tsx`; `frontend/src/routes/app.vendors.tsx` |
| 9 | Sales Invoices (AR) | Bill customers and run the receivables/funding pipeline | CRUD; catalogue lines (qty, unit price, discount %, GST, freight) with system totals; **mandatory linked sales order** validation; linked customer proforma → advance deduction; lifecycle draft→issued→approved/rejected/disputed→funded→advanced→paid/overdue; treasury-only payment recording (partial/full, late days, short payment); NOA email with PDF; payment reminders; browser print preview using invoice template; attachments; search/filter; audit trail | Debtors, products, sales orders, proformas, advances, payments | Invoices, NOA emails, reminders, payment records, audit events | Invoice, Debtor, GoodsSO, PurchaseOrder(proforma), Advance, ReminderLog models; document-pdf lib; email service | Needs Review | CORE | `backend/src/models/invoice.ts`; `backend/src/routes/index.ts` (invoices); `frontend/src/routes/app.invoices.tsx`; `frontend/src/routes/app.invoice-preview.$id.tsx` |
| 10 | Purchase Invoices (AP) | Record supplier bills and run the payables pipeline | CRUD; **mandatory linked goods PO**; supplier invoice-number uniqueness per supplier; lifecycle draft→verified→approved_for_payment→partially_paid/paid; role-guarded transitions; amountPaid/balanceDue; linked GRN sync (received qty back-fill); qty/price difference notes vs GRN/PO; proforma advance deduction; reminders; attachments; filters | Suppliers/vendors, goods POs, GRNs, advances, payments | Purchase invoices, payment records, difference reports | PurchaseInvoice, GoodsPO, GoodsReceipt, Advance models | Needs Review | CORE | `backend/src/models/purchase-invoice.ts`; `backend/src/routes/index.ts` (purchase-invoices); `frontend/src/routes/app.purchases.tsx` |
| 11 | Proformas & Advance Funding Workflow | Funding-side documents with maker→checker→treasury approval | Sales & purchase proformas; maker creates → checker approves/rejects → treasury funds; advance % drives calculated advance; funding amounts/reference; content frozen under review; convert sales proforma → draft sales order; convert purchase proforma → PO (gated); audit events | Debtors/vendors, products, advance %, funding decisions | Proformas, funding records, converted SOs/POs | PurchaseOrder(proforma) model, Advance, GoodsSO, GoodsPO | Needs Review | OPTIONAL MODULE (factoring/advance-funding customers) | `backend/src/models/purchase-order.ts`; `backend/src/routes/index.ts` (purchase-orders); `frontend/src/routes/app.proformas.tsx`; `frontend/src/routes/app.queue.tsx` |
| 12 | Goods Purchase Orders (catalogue POs) | Procurement commitments against the catalogue (never touch stock) | CRUD; catalogue lines; supplier, warehouse, buyer; maker→checker approval (pending_review→approved); send-to-supplier email with PDF approval link; status machine incl. partially/fully received derived from GRNs; received-qty tracking | Products, suppliers, buyers | POs, supplier approval emails, received-qty state | GoodsPurchaseOrder model; Supplier/Vendor; document-pdf; email | Needs Review | OPTIONAL MODULE (goods customers) | `backend/src/models/goods-purchase-order.ts`; `backend/src/routes/index.ts` (goods-purchase-orders); `frontend/src/routes/app.purchase-orders.tsx` |
| 13 | Goods Receipts (GRN) | Record incoming goods; the only document that credits stock | CRUD; draft→confirm (credits accepted qty, folds into PO); accepted/rejected qty split; over-receipt gate requiring checker/admin; cancel with reversing stock-out entries; link purchase invoice + challan number; warehouse; attachments | Goods POs, received/accepted/rejected qty, invoices, challans | GRNs, stock-in movements, PO received state | GoodsReceipt, GoodsPO, StockMovement, PurchaseInvoice models | Needs Review | OPTIONAL MODULE (goods customers) | `backend/src/models/goods-receipt.ts`; `backend/src/routes/index.ts` (goods-receipts); `frontend/src/routes/app.grn.tsx` |
| 14 | Quotations | Offer documents to customers (never touch stock or accounting) | CRUD; catalogue lines; **maker's revised unit price requiring checker approval**; discount pct/amount; validity; send-to-debtor email with PDF + approve/reject; convert (approved) quotation → sales order; statuses draft/sent/accepted/rejected/expired/converted_to_so | Products, customers, prices, approvals | Quotations, approval emails, converted SOs | Quotation model; document-pdf; email | Needs Review | OPTIONAL MODULE (goods customers) | `backend/src/models/quotation.ts`; `backend/src/routes/index.ts` (quotations); `frontend/src/routes/app.quotations.tsx`; `frontend/src/routes/app.quotation.$quotationId.tsx` |
| 15 | Goods Sales Orders (catalogue SOs) | Customer order commitments against the catalogue (never touch stock) | CRUD; catalogue lines; customer, salesperson; maker→checker confirm; debtor approval email with PDF; dispatched-qty tracking; status machine incl. partially/fully dispatched derived from dispatches; conversion from quotation/proforma | Products, debtors, salespersons, approvals | SOs, debtor approval emails, dispatched state | GoodsSalesOrder model; document-pdf; email | Needs Review | OPTIONAL MODULE (goods customers) | `backend/src/models/goods-sales-order.ts`; `backend/src/routes/index.ts` (goods-sales-orders); `frontend/src/routes/app.sales-orders.tsx` |
| 16 | Goods Dispatches & Delivery Challans | Ship goods; the only document that debits stock | CRUD; draft→confirm (debits stock, folds into SO); over-dispatch gate; soft stock-availability warnings; mark delivered (partial/full); record return (stock back + SO revoke); cancel with reversing credit entries; delivery challan print/save-PDF; transporter/tracking number; links to proforma/invoice | SOs, products, delivered/returned qty, transporters | Dispatch notes, stock-out movements, challans, delivery/return records | GoodsDispatch, GoodsSO, StockMovement models | Needs Review | OPTIONAL MODULE (goods customers) | `backend/src/models/goods-dispatch.ts`; `backend/src/routes/index.ts` (goods-dispatches); `frontend/src/routes/app.dispatches.tsx`; `frontend/src/routes/app.challan.$dispatchId.tsx` |
| 17 | Expenses | Record operating costs | CRUD; categories (logistics/insurance/interest/administrative/other); attachments; optional link to invoice/PI; cross-client scope for dashboard | Expense details, attachments | Expense records | Expense model; S3 | Needs Review | CORE | `backend/src/models/expense.ts`; `frontend/src/routes/app.expenses.tsx` |
| 18 | Advances | Track customer/supplier advances and their deduction | CRUD; sales/purchase side; amount, date, status (open/refunded…); reference/payment ref; links to proforma/invoice; server-side advance deduction on invoices | Proformas, invoices, advance amounts | Advance records; invoice advance deductions | Advance model, Invoice, PurchaseInvoice, PurchaseOrder | Needs Review | CORE | `backend/src/models/advance.ts`; `frontend/src/routes/app.advances.tsx` |
| 19 | Alerts & Risk Monitoring | Surface risk flags (overdue, etc.) | List alerts; mark read; admin-only manual generation of overdue-invoice alerts (DPD-based); type/severity/message | Invoices (due dates), manual trigger | Alert records | Alert model, Invoice | Needs Review. **Note:** generation is currently manual/admin-triggered only — no automated scheduler found for alerts | CORE (with note — see §8 Q7) | `backend/src/models/alert.ts`; `backend/src/routes/index.ts` (alerts); `frontend/src/routes/app.alerts.tsx` |
| 20 | Audit Trail & Activity Feed | Immutable record of privileged + workflow actions | Workflow actions (invoice created/approved/paid, GRN confirmed, dispatch delivered…); security events (failed logins, access denied, CSRF, view-as); admin actions; admin activity feed UI with actor resolution | Actor, action, target, detail, IP/UA | Audit log entries, activity feed | AuditLog model; security middleware | Needs Review | CORE | `backend/src/models/audit-log.ts`; `backend/src/middleware/security.ts`; `backend/src/routes/index.ts` (audit/activity); `frontend/src/routes/app.alerts.tsx` (activity tab) |
| 21 | Invoice Reminders & Email Scheduler | Proactive payment reminders for sales & purchase invoices | Hourly scheduler (acts once/day per invoice); day thresholds 15/7/2/1/0; manual send per invoice; run-all trigger; one-time debtor-forwarding token link; reminder log; instant trigger on invoice create/update; email templates | Invoices, due dates, debtor/vendor emails | Reminder emails, reminder logs, `lastOverdueReminderDate` updates | Invoice, PurchaseInvoice, ReminderLog models; email service; scheduler | Needs Review | CORE (thresholds are hard-coded — candidate for CONFIGURABLE) | `backend/src/invoice-reminder.ts`; `backend/src/email.ts`; `frontend/src/routes/app.reminders.tsx` |
| 22 | Chart of Accounts | Account master for double-entry bookkeeping | CRUD; 8 account types (asset/liability/equity/revenue/direct_cost/expense/other_income/other_expense); system accounts (non-deletable); default seed (Bank, AR, Inventory, AP, Tax Payable, Capital, Sales, COGS, OpEx); tax rate; currency | Account fields | Chart of accounts records | ChartOfAccount model | Needs Review | CORE | `backend/src/models/chart-of-account.ts`; `frontend/src/routes/app.accounting.tsx` |
| 23 | Journals & Account Transactions | Post and view double-entry entries | Journal CRUD; journal lines (debit/credit, tax, description); account-transaction drill-down (lines + source journals); manual journals only deletable | Chart of accounts, debit/credit amounts | Journal entries, per-account transaction views | Journal model, ChartOfAccount | Needs Review | CORE | `backend/src/models/journal.ts`; `backend/src/routes/index.ts` (journals); `frontend/src/routes/app.accounting.tsx` |
| 24 | Credit / Debit Notes | Adjust receivables/payables post-invoice | CRUD; credit/debit kind; statuses (pending/approved/applied/void/issued); link invoice/PI; line items, tax, documents; print preview with template | Invoices/PIs, note details | Notes, print/preview documents | CreditDebitNote model, Invoice, PurchaseInvoice | Needs Review | CORE | `backend/src/models/credit-debit-note.ts`; `frontend/src/routes/app.notes.tsx`; `frontend/src/routes/app.note-preview.$id.tsx` |
| 25 | Balance Sheet & Manual Balance Entries | Produce a balance sheet as of a date | As-of-date report from CoA + invoices + PIs + advances + stock + journals + expenses + manual entries; 12 sections (tangible assets, cash/bank, AR, AP, customer advance, corp tax, share capital, retained earnings…); manual balance-entry CRUD (opening balances); drill-down rows; print/download | CoA, invoices, PIs, advances, stock, journals, expenses, manual entries | Balance sheet report | Many models; ManualBalanceEntry model | Needs Review | CORE | `frontend/src/routes/app.balance-sheet.tsx`; `frontend/src/routes/app.accounting.tsx` (tab); `backend/src/models/models-combined.ts` (balance entries) |
| 26 | Invoice & Document Templates | Per-client branding for printed/PDF documents | Per-client template get/upsert; company name/address/email/phone, tax id, logo, primary/accent color, currency + symbol, default tax rate, bank details, terms, footer, signature label; used by invoice/note print previews | Branding fields | Branded document previews | InvoiceTemplate model (models-combined) | Needs Review | CONFIGURABLE | `frontend/src/routes/app.template.tsx`; `backend/src/models/models-combined.ts`; `frontend/src/components/invoice-print.tsx` |
| 27 | File Storage (S3 Uploads) | Upload, serve and delete attachments/images | Multipart upload (15 MB); magic-byte content detection (blocks HTML/SVG/executables); sanitized keys scoped to requester's folder; short-lived signed download URLs (60s, cached client-side); delete | Files (images/PDFs/office/text) | Stored objects, signed URLs | S3 lib, security middleware, multer | Needs Review | CORE | `backend/src/s3.ts`; `backend/src/middleware/security.ts`; `backend/src/routes/index.ts` (upload); `frontend/src/lib/s3-image.ts`; `frontend/src/components/document-uploader.tsx` |
| 28 | CRM (Leads / Opportunities / Activities) | Sales pipeline management | Lead CRUD (sources, statuses new/contacted/qualified/converted/lost, estimated value); opportunity CRUD (stages with probabilities, amount, close date, product interest); activity CRUD (call/email/meeting/note/task, due dates, completion); pipeline view; demo seed script with realistic accounts | Leads, opportunities, activities | Pipeline records, stats | Combined model (models-combined); seed scripts | Needs Review. **Note:** only populated by demo seed data; no evidence of production usage | OPTIONAL MODULE | `backend/src/models/models-combined.ts` (CRM); `backend/src/routes/index.ts` (crm); `frontend/src/routes/app.crm.tsx`; `backend/scripts/seed-crm-demo.ts` |
| 29 | Submissions & Team Workspace | Team operational requests (visits, travel, expenses, leave) | Submission CRUD (type visit/travel/expense/leave); statuses pending/approved/rejected; reporting-manager team-request list + approve/reject; email notifications on submit and decision; personal workspace with stats and tabs | Submission details, manager decisions | Submissions, request records, emails, workspace stats | Submission model; email service; User (reporting manager) | Needs Review | OPTIONAL MODULE | `backend/src/models/submission.ts`; `backend/src/routes/index.ts` (submissions, requests); `frontend/src/routes/app.workspace.tsx`; `frontend/src/routes/app.requests.tsx` |
| 30 | Reporting Manager & View-As | Managers review team performance and impersonate members read-only | View-as middleware (GET-only, reporting_manager-only, target must be a managed user); sidebar mirrors viewed user's roles; api-client auto-forwards `viewAsUserId`; team reports page; `/user-progress` aggregated stats per role; requests queue | Team members, roles | Impersonated data views, progress stats | User model, view-as middleware, all data routes | Needs Review | OPTIONAL MODULE (managerial customers) | `backend/src/routes/index.ts` (viewAsMiddleware, user-progress); `frontend/src/lib/view-as.ts`; `frontend/src/components/view-as-banner.tsx`; `frontend/src/routes/app.reports.tsx` |
| 31 | Demand Forecasting & Pricing Strategy | SKU-level demand forecast, reorder & pricing recommendations | Shared forecast engine (backend + frontend copies): 12-month monthly buckets, stockout availability correction, weighted baseline (3/2/1), OLS trend + R², raw seasonality (clamped 0.5–2.0), 6-month horizon, 80% prediction intervals, live pace adjustment (clamped 0.8–1.2), days of cover, reorder recommendation (lead time + safety stock), momentum & category-relative velocity tags, stockout/overstock risk, timeline (stockout date, reorder-by, refill, urgency), pricing-strategy rules (clearance/markdown/hold/protect margin, never auto-applied), full calculation breakdown; persisted daily snapshots (`ForecastVariable`); auto-recompute on every stock event + startup + daily freshness; forecast page with filters, sorts, charts | Stock movements (confirmed), catalogue products (lead time, safety stock, costs, margins) | Forecast snapshots, reorder recommendations, pricing recommendations, charts | Forecast engine (lib), forecast-service, ForecastVariable, StockMovement, Product models | Needs Review | OPTIONAL MODULE (with strong review flag — likely the flagship differentiator; see §8) | `backend/src/lib/forecast-engine.ts`; `frontend/src/lib/forecast-engine.ts`; `backend/src/services/forecast-service.ts`; `backend/src/models/forecast-variable.ts`; `frontend/src/routes/app.forecast.tsx`; `DEMAND-FORECAST-FORMULAS.md` |
| 32 | Notice of Assignment (NOA) | Notify debtors their receivables are assigned to the factor | Send NOA email with invoice PDF (owner/admin); token-based public NOA page (accept/reject/comment); status + response timestamps/comments; reminder-log kind "noa"; **hard-coded "Adventra" company branding in the email route** | Invoices, debtor emails | NOA emails, public NOA pages, responses | Invoice (noa fields), Debtor, email, document-pdf | Needs Review | OPTIONAL MODULE (factoring customers) — see client-specific branding in §5 | `backend/src/routes/index.ts` (send-noa, noa routes); `backend/src/email.ts` (sendInvoiceNoaEmail); `frontend/src/routes/noa.$token.tsx` |
| 33 | Counterparty Document Approvals | Let debtors/suppliers approve documents via emailed link | Public one-time-token pages for Quotation / Sales Order / Purchase Order; whitelisted document summary (no internal fields); approve/reject with comments; one-time token (atomic claim); status sync back to document (accepted/confirmed/sent) | Documents, counterparty emails, decisions | Approval emails, public approval pages, updated document statuses | Quotation, GoodsSO, GoodsPO, email, document-pdf | Needs Review | OPTIONAL MODULE | `backend/src/routes/index.ts` (approvals); `backend/src/email.ts` (sendDocumentApprovalEmail); `frontend/src/routes/approve.$token.tsx` |
| 34 | Public Pages (Landing & Auth) | Marketing + entry points | Landing page (WHIZUNIK COMMAND factoring positioning, feature highlights); sign-in/sign-up pages; plus public approve/NOA pages | — | Public web pages | — | Needs Review | CORE (landing/auth) | `frontend/src/routes/index.tsx`; `frontend/src/routes/auth.tsx` |

---

## 4. Feature-Level Inventory

Expansion of the modules above into individual verified features (≈260 features across the 34 modules). Representative detail below; the register table in §3 is the authoritative module-level view.

### 4.1 CORE modules — key features

**Authentication & Session (1)** — signup with validation (email regex, password 6–128, company/contact length caps); login with bcrypt compare; opaque 401s; JWT (issuer `insight-factor-api`, audience `insight-factor-web`, jti); httpOnly + SameSite=Strict + Secure(in prod) cookie; `/auth/me`; profile update (company, contact, email with security event, address, phone, photo); logout; failed-attempt-only rate limits (login 30/IP, 10/account, signup 10/IP/hour, public 60, API 1000) + graduated slow-down. *Evidence: `backend/src/models/user.ts`, `middleware/auth.ts`, `middleware/rate-limit.ts`.*

**User Management & RBAC (2)** — admin user create with role whitelist; role add/remove; manager assignment with role check; manager/report lists; admin seed from `ADMIN_EMAIL`/`ADMIN_PASSWORD` env; role-based sidebar (checker/treasury/operations/sales/manager/admin variants); client-side route wall; server-side `requireAdmin/requireChecker/requireTreasury` + per-route guards; maker–checker segregation on proformas, quotations, POs. *Evidence: `routes/index.ts`, `frontend/src/routes/app.tsx`, `app.admin.tsx`.*

**Sales Invoices (9)** — catalogue-line validation (SKU must exist, qty>0, price≥0); mandatory confirmed-SO link with line/qty matching; proforma link + server-side advance deduction (`max(paid, agreed%)`); totals recomputation (subtotal, discount, GST, freight, grand total, net receivable); statuses incl. funding states; treasury-only payments with clamping to net receivable; `paidDate`/`lateDays`/`shortPayment`; NOA email; instant + scheduled reminders; frozen closed invoices; audit events; template-branded print preview. *Evidence: `models/invoice.ts`, `routes/index.ts`, `app.invoices.tsx`.*

**Purchase Invoices (10)** — mandatory PO link; unique supplier invoice number; qty/price difference detection vs GRN/PO; role-guarded transitions (creator→verified, checker→approved_for_payment, treasury→paid); GRN link back-fill; advance deduction; balanceDue; reminders. *Evidence: `models/purchase-invoice.ts`.*

**Expenses (17), Advances (18), Chart of Accounts (22), Journals (23), Credit/Debit Notes (24), Balance Sheet (25)** — CRUD + lifecycle as listed in §3. *Evidence: `models/expense.ts`, `models/advance.ts`, `models/chart-of-account.ts`, `models/journal.ts`, `models/credit-debit-note.ts`, `models/models-combined.ts`, `app.accounting.tsx`, `app.balance-sheet.tsx`.*

**Alerts (19)** — list/mark-read; admin `POST /alerts/generate` computes DPD and creates overdue alerts. **Note:** no automated scheduler generates alerts — only the manual admin trigger (see §8). *Evidence: `models/alert.ts`, `routes/index.ts`.*

**Audit (20)** — `writeWorkflowAction` + `writeAuditLog` (fire-and-forget); `requestLogger`, `logSecurityEvent`; admin activity feed filters noise (`auth.`, `csrf.`, `view_as.`, `access.denied`), resolves actor names, caps at 200. *Evidence: `models/audit-log.ts`, `middleware/security.ts`, `routes/index.ts`.*

**Reminders (21)** — hourly `startReminderScheduler`; per-day dedupe via `lastOverdueReminderDate`; thresholds `[15,7,2,1,0]`; manual per-invoice send; `POST /reminders/run`; one-time debtor-forward token (`/remind-debtor/:token`); `ReminderLog` audit. *Evidence: `invoice-reminder.ts`, `email.ts`.*

**File Storage (27)** — magic-byte detection (JPEG/PNG/WebP/GIF/PDF/ZIP/OLE/text; rejects HTML/SVG/EXE/ELF/scripts/JAR); sanitized keys; per-user folder enforcement; signed URLs; delete. *Evidence: `middleware/security.ts`, `s3.ts`, `routes/index.ts`.*

### 4.2 OPTIONAL modules — key features

**Product Catalogue (4), Inventory (6), Goods PO (12), GRN (13), Quotations (14), Goods SO (15), Dispatches (16)** — the goods lifecycle with the governing invariant *"a document never touches stock — only a confirmed GRN/dispatch does"*; over-receipt/over-dispatch gates (checker/admin bypass); soft stock warnings on dispatch; returns credit stock back and revoke SO quantities; cancellation reversal semantics; statuses derived from received/dispatched/delivered quantities (`recomputeStatus`/`recomputeDeliveredStatus`); challan print. *Evidence: `models/goods-*.ts`, `routes/index.ts`, `app.grn.tsx`, `app.purchase-orders.tsx`, `app.quotations.tsx`, `app.sales-orders.tsx`, `app.dispatches.tsx`, `app.challan.$dispatchId.tsx`, `COMPLETE-WORKFLOW-GUIDE.md`.*

**Forecasting (31)** — see §3; engine duplicated verbatim in `frontend/src/lib` and `backend/src/lib` with explicit "KEEP IN SYNC" comment; server persists snapshots; recompute fires on stock movement create/confirm/cancel/delete, GRN confirm/cancel, dispatch confirm/cancel/return, product delete, plus daily freshness + startup. *Evidence: `lib/forecast-engine.ts` (both), `services/forecast-service.ts`, `models/forecast-variable.ts`, `app.forecast.tsx`.*

**CRM (28)** — leads/opportunities/activities + pipeline; seed script references specific demo accounts (`ram@gmail.com`, `arjun.jaiswal@whizunik.com`, `sankalp@whizunik.com`). *Evidence: `models/models-combined.ts`, `scripts/seed-crm-demo.ts`, `app.crm.tsx`.*

**Submissions (29), Reporting Manager & View-As (30)** — see §3.

**NOA (32), Document Approvals (33)** — see §3.

### 4.3 Shared frontend capabilities (cross-cutting)

- Search/filter/sort tables via `TransactionFilters` (`frontend/src/components/transaction-filters.tsx`) on invoices, purchases, proformas, quotations, SOs, POs, GRNs, dispatches, advances, expenses, notes.
- Read-only document detail modals for checker/treasury (`components/document-view.tsx`).
- Document uploader + list (`components/document-uploader.tsx`), signed-image hook (`lib/s3-image.ts`), product thumbnails, skeletons.
- Theme (light/dark/system, `lib/theme.tsx`), command palette (Cmd+K), responsive mobile nav.
- Backend field-transform middleware: request snake_case→camelCase, response camelCase→snake_case (`middleware/transform.ts`) — every frontend type uses snake_case.

---

## 5. Client-Specific Functionality

**Globalor — planned client (not in code).** A repository-wide search for "Globalor" (case-insensitive) returned **zero matches** across code, configuration, deployment files, slide decks and assets — the brand actually rendered across the frontend is **WHIZUNIK COMMAND** (page titles, sidebar, auth page, logo alt). Per the product brief, Globalor is understood to be a **planned client/brand** for the standardised product. No Globalor module, workflow, terminology, dashboard, report, rule or integration exists in this repository — **status requires Sankalp confirmation** (§8 Q1).

**Retail — no client-specific implementation found.** "Retail" appears only in (a) the MRP field description ("max retail price") and (b) demo/seed company names (e.g. "MetroMart Retail Pvt Ltd", "Khan Retailers", "Menon Retail Group" in `scripts/seed-crm-demo.ts`) and slide decks. No retail-specific business logic exists.

| # | Client | Functionality | Why client-specific | Reusable? | Evidence | Sankalp recommendation |
|---|--------|---------------|---------------------|-----------|----------|------------------------|
| C1 | Adventra | NOA email branding hard-coded to `"Adventra"` in the send-NOA route, while every other email/PDF resolves the company name from the user record | Hard-coded constant in business logic (`const companyName = "Adventra";` in `routes/index.ts`) | Yes — move to the per-client invoice template / user profile (module 26 is already the natural home) | `backend/src/routes/index.ts` (send-noa) | Confirm Adventra is a client brand; approve moving branding into the configurable template |
| C2 | Adventra | Demo/seed datasets branded with Adventra SKUs (`ADV-RC-001` "Adventra Trail Rain Cover", etc.) and WHIZUNIK COMMAND demo accounts | Scripts `seed-sku-movements.ts`, `seed-forecast-demo.ts`, `seed-crm-demo.ts` are Adventra-specific; scripts write to the **real DynamoDB table** per their headers | Partially — the scripts are generic scaffolding, the data is not | `backend/scripts/*.ts` | Confirm whether demo data has leaked into production data; decide whether to keep/remove seed scripts |
| C3 | Adventra | Deployment/branding: `adventra.whizunikhub.com` in nginx config, PM2 app name `adventra-backend`, `CORS_ORIGIN`, `DEPLOY.md`, PPT decks | Infrastructure + docs targeted at one tenant domain | Yes — parametrise domain/branding for multi-tenant deployment | `deploy/nginx.conf`, `ecosystem.config.cjs`, `backend/.env.example`, `DEPLOY.md`, `ppt-generator/` | Confirm production topology (single-tenant vs multi-tenant); see §8 Q4 |
| C4 | Globalor | **Planned client per the product brief; not implemented** — repo-wide search returns zero matches; the frontend renders "WHIZUNIK COMMAND" | Brief-referenced only (see §2) | N/A until onboarding starts | repo-wide search (zero matches); `frontend/src/routes/*` (WHIZUNIK COMMAND branding) | Confirm Globalor onboarding timeline and target modules |

**No whole module was classified CLIENT-SPECIFIC** — the Adventra-specific code is confined to branding constants, seed data, and deployment config. All goods/inventory modules are generic (client-scoped via `clientId`) and classified OPTIONAL MODULE pending Sankalp's product decision.

---

## 6. Reusability Opportunities

| Opportunity | Today | Could become | Evidence | Effort estimate (qualitative) |
|-------------|-------|--------------|----------|-------------------------------|
| Invoice/document branding (colors, logo, tax id, terms, bank details) | Per-client `InvoiceTemplate` used by browser print only | **CONFIGURABLE core** — also feed the emailed PDFs (document-pdf + NOA) so server emails match the client template | `app.template.tsx`, `components/invoice-print.tsx`, `lib/document-pdf.ts`, `routes/index.ts` (NOA hard-codes Adventra) | Low — one shared data source, two consumers |
| Reminder thresholds `[15,7,2,1,0]` | Hard-coded | **CONFIGURABLE** — per-client reminder cadence | `invoice-reminder.ts` | Low |
| Default advance rate (0.80) & fee rate (0.025) | Model defaults | **CONFIGURABLE** — per-client defaults | `models/invoice.ts`, `models/purchase-invoice.ts` | Low |
| Currency | Fields exist (CoA, proforma) but emails/PDFs hard-code USD/$ | **CONFIGURABLE** — honour the stored currency everywhere | `email.ts`, `lib/document-pdf.ts`, `models/*.ts` | Medium (touch all money formatting) |
| Alert generation | Manual admin trigger only | **CORE automated** — scheduled overdue/risk alert generation | `routes/index.ts` (alerts), `invoice-reminder.ts` (scheduler pattern to reuse) | Low–Medium |
| Goods lifecycle (catalogue → PO → GRN, quotation → SO → dispatch → invoice) | Implemented, Adventra-driven | **Optional reusable module** for any distribution/retail customer | `models/goods-*.ts`, `COMPLETE-WORKFLOW-GUIDE.md` | Already built — packaging/documentation effort |
| Forecasting + pricing engine | Implemented; duplicated FE/BE copies | **Core differentiator / optional module** — decision needed (see §8 Q6) | `lib/forecast-engine.ts` (×2), `services/forecast-service.ts` | Already built |
| CRM, Submissions/Workspace, View-As, NOA, Approvals | Implemented, partly demo-seeded | **Optional modules** with per-client enablement (feature flags don't exist yet) | see §3 modules 28–33 | Packaging/config effort |
| `Vendor` (legacy) + `Supplier` masters | Two models merged in UI | **Single Supplier master**, migrate Vendor data | `models/vendor.ts`, `models/supplier.ts`, `routes/index.ts` | Medium (data migration) — refactor, out of Day 1 scope |

---

## 7. Duplicated Functionality

Recorded for awareness only — **not fixed**.

| # | Duplicated functionality | Locations | Apparent reason | Possible common capability | Needs review? |
|---|--------------------------|-----------|-----------------|----------------------------|---------------|
| D1 | **Forecast engine kept in two identical copies** (explicit "KEEP IN SYNC" comment) | `backend/src/lib/forecast-engine.ts` vs `frontend/src/lib/forecast-engine.ts` | Server computes/persists; client renders live — same logic shipped twice | Single shared package/module | Yes — risk of drift; sync comment already warns |
| D2 | **Two supplier-side masters**: `Supplier` (new, global) and `Vendor` (legacy, client-scoped) | `models/supplier.ts`, `models/vendor.ts`; merged in every procurement dropdown; purchase invoices/POs can reference either | Migration from legacy Vendor to Supplier model | Single supplier master | Yes |
| D3 | **Two "purchase order" concepts**: `PurchaseOrder` (proforma/funding) vs `GoodsPurchaseOrder` (catalogue PO) | `models/purchase-order.ts`, `models/goods-purchase-order.ts` | Deliberate split (funding vs goods) but names collide | Clearer naming/namespacing | Yes — naming review |
| D4 | **Balance sheet implemented twice**: as a tab in `/app/accounting` and as a standalone `/app/balance-sheet` route (both fetch CoA+invoices+PIs+advances+stock+journals+expenses) | `frontend/src/routes/app.accounting.tsx`, `frontend/src/routes/app.balance-sheet.tsx` | Two-page build-out of the same report | One report component | Yes |
| D5 | **Parallel aggregation paths**: `/dashboard` API, `/user-progress` API, dashboard page KPIs, reporting page, and balance-sheet all recompute totals independently | `routes/index.ts` (dashboard, user-progress), `app.dashboard.tsx`, `app.reporting.tsx`, `app.balance-sheet.tsx` | No shared analytics/query layer | Shared metrics service | Yes — metric drift risk |
| D6 | **Two invoice line/amount structures** on the Invoice model: legacy `lineItems`/`subtotal`/`taxRate`/`taxAmount` alongside new `lines`/`subtotalGoods`/`gstTotal`/`grandTotal` | `models/invoice.ts` | Migration in progress; emails still read legacy fields | Single canonical line/totals shape | Yes |
| D7 | **Two PDF/print pipelines**: backend `document-pdf.ts` (emailed PDFs) vs frontend `invoice-print.tsx` PrintShell (browser print) | `backend/src/lib/document-pdf.ts`, `frontend/src/components/invoice-print.tsx` | Different contexts (attachment vs print) | Shared document renderer (or server-rendered HTML→PDF) | Yes |
| D8 | **Reminder triggers in multiple places**: hourly scheduler + instant triggers inside invoice/purchase-invoice create/update handlers | `invoice-reminder.ts` + `routes/index.ts` (several `sendReminderForInvoice` call sites) | Responsiveness (instant) + batch (scheduler) | Single reminder dispatch service with dedupe | Low risk; verify dedupe holds |
| D9 | **Stock balance / inventory value computed several ways**: dashboard sums only `direction==="in"` (no debits), balance sheet and forecast compute confirmed in−out | `routes/index.ts` (dashboard), `app.dashboard.tsx`, `app.balance-sheet.tsx`, `forecast-service.ts` | Different definitions per consumer | Single stock-valuation helper | Yes — numbers can disagree |

---

## 8. Items Requiring Sankalp Review

1. **Q1 — "Globalor":** referenced in the product brief as a **planned client/brand**, but a repository-wide search returns **zero matches** — the brand actually rendered in the frontend is **WHIZUNIK COMMAND**. Is Globalor a planned client to onboard, a separate codebase, or an error in the brief?
2. **Q2 — Product naming:** the platform is simultaneously "WHIZUNIK COMMAND" (public brand), "Insight Factor" (legacy product/API/admin/DynamoDB default), and "Adventra" (deployment domain + NOA branding + docs). Which is the official product name for the register and future branding?
3. **Q3 — Adventra status:** is Adventra a live production tenant, a demo, or the seed client? Should the register treat the goods lifecycle as "built for Adventra" or "built for WHIZUNIK COMMAND generally"?
4. **Q4 — Deployment topology:** production config targets a single domain (`adventra.whizunikhub.com`) with a single DynamoDB table and per-user `clientId` scoping. Is the intended model **single-tenant per install**, **multi-tenant shared**, or **per-client forks**? This determines how much of the CLIENT-SPECIFIC items become CONFIGURABLE.
5. **Q5 — Status (Live/Testing/Development):** deployment artifacts exist (PM2, nginx, Let's Encrypt paths) but runtime status cannot be verified from the repo. Sankalp must confirm which modules are live in production, in testing, or in development.
6. **Q6 — Forecasting & pricing engine:** is this the flagship **CORE** differentiator (marketing, PPTs and formula docs suggest yes) or an **OPTIONAL MODULE** for goods clients? Classification affects everything downstream.
7. **Q7 — Alerts automation:** alert *generation* is only manual (admin button). Is automated alert generation (like the reminder scheduler) planned/required?
8. **Q8 — Accounting integration depth:** the accounting page claims "every financial movement becomes a balanced journal," but journals are currently **manual only** — invoices, payments, GRNs and dispatches do not auto-post entries. Is this the intended state (manual bookkeeping) or a gap?
9. **Q9 — Currency/region:** GSTIN/HSN fields (India) coexist with default currency USD and `$` formatting in emails/PDFs. What are the target currencies/regions for the common product?
10. **Q10 — Debtor scoping:** Debtors are global (no `clientId`) while Products, Vendors, Invoices, etc. are client-scoped. Intentional (shared debtor book across clients) or an inconsistency?
11. **Q11 — Vendor vs Supplier:** legacy `Vendor` + new `Supplier` — is consolidation planned?
12. **Q12 — CRM and Submissions demo data:** only seeded demo data exists (including `sankalp@whizunik.com` and `ram@gmail.com` accounts writing to the real table). Are these features production-active, and should seed scripts be removed/guarded?
13. **Q13 — Duplication:** are D1–D9 (incl. the dual balance-sheet routes and dual invoice-line structures) intentional migration states or debt to schedule?
14. **Q14 — Naming collision:** `PurchaseOrder` (proforma) vs `GoodsPurchaseOrder` — confirm the product terminology going forward.
15. **Q15 — Planned vs implemented:** several prompt-listed concepts (Intelligence Engine, pricing *recommendations* applied automatically) are **not implemented**; Globalor is planned-client branding only (§5) — confirm none of these are expected to be documented as present.
16. **Q16 — Multi-client dashboards:** `scope=all` lists expose all clients' invoices/PIs/expenses to the shared dashboard. Is cross-client visibility intended for all roles, or should it be restricted?

---

## 9. Inventory Summary

### Module-level (34 modules)

| Classification | Modules | 
| -------------- | ------: |
| Core | 18 |
| Configurable | 2 |
| Optional Module | 14 |
| Client-Specific | 0 |
| Needs Sankalp Review (flagged) | 16 modules carry a review flag in §8 |

### Feature-level (≈260 features, classified by their module)

| Classification | Features (approx.) |
| -------------- | ------------------: |
| Core | ≈140 |
| Configurable | ≈6 |
| Optional Module | ≈110 |
| Client-Specific (items, not modules) | 3 items (C1–C3) + 1 planned-client finding (C4 — Globalor, brief-referenced only) |

### Totals & tallies

- **Total modules:** 34
- **Total major features (verified):** ≈260
- **Core modules:** 18
- **Configurable modules:** 2 (plus configurable opportunities listed in §6)
- **Optional modules:** 14
- **Client-specific modules:** 0; **client-specific items:** 3 (C1–C3); **planned-client finding:** 1 (C4 — Globalor, brief-referenced only, not in code)
- **Items requiring Sankalp review:** 16 questions in §8 (plus the classification flags above)
- **Duplicated functionality items:** 9 (D1–D9)

*(No percentages are manufactured — counts are direct tallies from the register.)*

---

## 10. Limitations / Unknowns

1. **Runtime status unverifiable:** nothing in the repo proves which environment is live. Status is "Needs Review" everywhere; deployment artifacts (PM2, nginx, env examples) are the only evidence.
2. **Globalor:** zero code references; treated as a **planned client/brand** referenced in the product brief only, not implemented (see §5).
3. **Database contents:** DynamoDB is single-table with no schema/migration files; the register documents the *models'* shape, not the actual data. Seed scripts suggest real-table demo data exists but that cannot be confirmed from code.
4. **Intelligence Engine:** the prompt mentions a future Intelligence Engine — **not implemented**; the closest verified capability is the deterministic forecast/pricing engine (module 31).
5. **Secrets:** env values and credentials were not read/exported; only `.env.example` keys and config shapes are referenced.
6. **Frontend UI verification:** routes/pages were inventoried from source; no browser walkthrough was performed.
7. **Feature counts are approximate:** features were tallied from the deep-dive; a few lists may be ±5.
8. **Reports nuance:** `/app/reporting` (sales/purchase/ageing report cards) and `/app/reports` (reporting-manager team view) are distinct pages; their product relationship is unclear (see §8).
9. **Route orphans:** `/app/vendors` and `/app/accounting` exist as routes but do not appear in the admin sidebar (suppliers + balance-sheet are surfaced instead) — legacy entry points retained.

---

## 11. Executive Summary

1. **Total modules discovered:** 34 (18 Core, 2 Configurable, 14 Optional).
2. **Total major features discovered:** ≈260 verified in code.
3. **Core count:** 18 modules (auth/RBAC, dashboard, masters, invoices AR/AP, expenses, advances, alerts, audit, reminders, CoA, journals, credit/debit notes, balance sheet, file storage, public pages).
4. **Configurable count:** 2 modules (catalogue settings, invoice/document templates) — with 4 more strong candidates listed in §6.
5. **Optional Module count:** 14 (goods catalogue/inventory/PO/GRN/quotation/SO/dispatch, proformas/funding, CRM, submissions, view-as, forecasting, NOA, approvals).
6. **Client-Specific count:** 0 modules; 3 items (Adventra NOA branding hard-coded in a route, Adventra seed/demo data, Adventra deployment config). **Globalor is a planned client per the product brief — zero code references exist; the brand actually rendered is WHIZUNIK COMMAND.**
7. **Items requiring Sankalp review:** 16 questions (§8).
8. **Major reusable opportunities:** per-client document branding for all outputs (incl. emailed PDFs), configurable reminder thresholds/advance rates, automated alert generation, the already-built goods lifecycle as a reusable optional module, and the forecast/pricing engine as a potential core differentiator.
9. **Major client-specific functionality:** hard-coded "Adventra" NOA branding (C1); Adventra-branded demo seeds writing to the real table (C2); adventra.whizunikhub.com deployment (C3).
10. **Major uncertainties:** product naming (WHIZUNIK COMMAND vs Insight Factor vs Adventra vs planned Globalor); production status; single- vs multi-tenant; Globalor onboarding (planned, not in code); whether forecasting is core or optional; accounting depth (manual journals only); currency/region; debtor scoping; alert automation.

---

## 12. Recommended Discussion Agenda With Sankalp

1. **Naming & identity** (Q2, Q3): WHIZUNIK COMMAND vs Insight Factor vs Adventra — official name, and whether Adventra is a client or the seed tenant.
2. **Globalor** (Q1): confirm Globalor is a planned client to onboard (per the brief) and the target timeline — note zero code references exist today.
3. **Production status** (Q5): which modules are Live/Testing/Development today.
4. **Deployment topology** (Q4, Q16): single-tenant vs multi-tenant; whether `scope=all` cross-client dashboards are intended.
5. **Forecast/pricing engine positioning** (Q6): Core differentiator vs optional module.
6. **Branding/configurability approvals** (C1, §6): move NOA branding to the template; approve configurable reminder cadence, advance/fee defaults, currency handling.
7. **Data hygiene** (Q12, C2): demo seed data in the real table — cleanup decision.
8. **Duplication triage** (D1–D9, Q11, Q13, Q14): confirm which duplicates are intentional migration states vs debt (no fixes in Day 1).
9. **Accounting depth** (Q8, Q9): manual-journals-only vs auto-posting; target currency/region.
10. **Alert automation** (Q7) and **debtor scoping** (Q10).

---

*End of WH-TECH-01. Prepared as a Day 1 deliverable only — no Day 2 analysis performed, no code modified.*
