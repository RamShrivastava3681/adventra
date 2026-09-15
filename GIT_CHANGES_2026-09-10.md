# Git Changes — 10 September 2026

**Repository:** adventra-platform
**Date covered:** 10 September 2026 (00:00:00 to 23:59:59, +0530 IST)
**Author (all commits):** RamShrivastava3681 <ramshrivastava304@gmail.com>
**Total commits:** 10
**Generated:** 15 September 2026

This document lists every commit from 10 September 2026 in chronological order, with commit time/date, message, file list, and a summary of the code changes.

---

## Overview table

| # | Commit (short) | Commit Time and Date | Message | Files | Insertions / Deletions |
|---|---|---|---|---|---|
| 1 | `001c682` | 2026-09-10 00:08:21 +0530 | fixes and bulk pay | 15 | +2680 / -107 |
| 2 | `c4fe086` | 2026-09-10 01:01:24 +0530 | sample | 3 | +495 / -29 |
| 3 | `19afb5b` | 2026-09-10 09:58:51 +0530 | gst collection in cashcommand center | 7 | +1065 / -130 |
| 4 | `718ef83` | 2026-09-10 10:17:26 +0530 | colour coding | 34 | +728 / -549 |
| 5 | `09df115` | 2026-09-10 14:12:48 +0530 | order sales template | 12 | +2359 / -153 |
| 6 | `a91d460` | 2026-09-10 14:27:58 +0530 | logo fix in template | 1 | +5 / -3 |
| 7 | `0842f61` | 2026-09-10 20:22:14 +0530 | charizard | 30 | +6738 / -1686 |
| 8 | `85c5bf8` | 2026-09-10 23:19:20 +0530 | qwerasd | 36 | +3365 / -479 |
| 9 | `7fbf2e7` | 2026-09-10 23:30:01 +0530 | Stop drilling into /app/challan/$dispatchId from the dispatch detail view | 2 | +2 / -5 |
| 10 | `6ed8dfd` | 2026-09-10 23:40:49 +0530 | Restore /app/dispatches/challan/$dispatchId as a first-class child route | 3 | +19 / -22 |

---

## 1. `001c682989fc62c0dd40a8469eb0c3abf974ada5` — fixes and bulk pay

- **Commit time and date:** 2026-09-10 00:08:21 +0530
- **Author / Committer:** RamShrivastava3681
- **Message:** `fixes and bulk pay` (no body)

**Stats:** 15 files changed, 2680 insertions, 107 deletions

**Files changed:**
- `backend/scripts/seed-sku-masters.ts` (new, +67)
- `backend/src/models/bulk-payment.ts` (new, +96)
- `backend/src/models/goods-sales-order.ts` (+10)
- `backend/src/models/product.ts` (+27/-2)
- `backend/src/models/sku-master.ts` (new, +77)
- `backend/src/routes/bulk-payments.ts` (new, +519)
- `backend/src/routes/index.ts` (+191/-16)
- `frontend/src/lib/api-client.ts` (+13/-2)
- `frontend/src/routeTree.gen.ts` (+21)
- `frontend/src/routes/app.bulk-payments.tsx` (new, +1341)
- `frontend/src/routes/app.checker.tsx` (+3/-3)
- `frontend/src/routes/app.products.tsx` (+294/-18)
- `frontend/src/routes/app.sales-orders.tsx` (+12/-58)
- `frontend/src/routes/app.tsx` (+3)
- `frontend/src/routes/app.warehouse.tsx` (+8/-8)

**Code changes:**
- **New Bulk Payments backend:** added `BulkPayment` DynamoDB model (`BULK_PAYMENT#` pk, `BulkPayment` entityType) with fields `debtorId` (supports `vendor_<id>` prefix for AP), `amount`, `paymentDate`, `remaining` (unapplied carry-forward), `invoicesClosed`/`closedInvoices`/`partialInvoices`, `creditNoteIds`, `mode` (`manual` | `fifo` | `two_pass_fifo`). Helpers: `list`, `get`, `create`, `consumeRemaining`, `remove`.
- **New `backend/src/routes/bulk-payments.ts` (519 lines):** bulk-payment allocation API (FIFO / two-pass FIFO / manual allocation against open invoices, closing full invoices and partially paying others, carrying leftover `remaining` forward).
- **New SKU Master backend:** added `SkuMaster` model (`category` | `gender` | `color` | `size` types) + `backend/scripts/seed-sku-masters.ts` seed script.
- **Product model (`backend/src/models/product.ts`):** extended to support parent/master-SKU hierarchy and variant linkage.
- **Sales-order model (`goods-sales-order.ts`):** +10 lines for bulk-payment / SKU-master linkage.
- **Route mounting (`backend/src/routes/index.ts`):** +191/-16 to mount bulk-payment routes and SKU-master routes.
- **New frontend page `app.bulk-payments.tsx` (1341 lines):** full Bulk Payments UI — party picker (AR/AP), amount entry, allocation mode selector, invoice allocation table, closed/partial summary, remaining-balance display.
- **API client (`frontend/src/lib/api-client.ts`):** added `bulkPayments` endpoints.
- **Products page (`app.products.tsx`, +294/-18):** SKU-master pickers, parent/variant creation flows wired to new masters.
- **Sales-orders page (`app.sales-orders.tsx`, +12/-58):** fixes to allocation / totals around bulk payments.
- **Checker (`app.checker.tsx`), Warehouse (`app.warehouse.tsx`), App shell (`app.tsx`), `routeTree.gen.ts`:** route registration for `/app/bulk-payments`, nav wall entry, small status/label fixes.

---

## 2. `c4fe0868c3c4672b5d4035b7ad8c47f669fc1c0e` — sample

- **Commit time and date:** 2026-09-10 01:01:24 +0530
- **Author / Committer:** RamShrivastava3681
- **Message:** `sample` (no body)

**Stats:** 3 files changed, 495 insertions, 29 deletions

**Files changed:**
- `frontend/src/routeTree.gen.ts` (+21)
- `frontend/src/routes/app.sample-distribution.tsx` (new, +444)
- `frontend/src/routes/app.tsx` (+59/-29)

**Code changes:**
- **New page `app.sample-distribution.tsx` (444 lines):** Sample Distribution / Samples-internal-use inventory flow.
  - Types `CatalogueProduct` and `SampleMovement` (`movement_number`, `product_id`, `direction in|out`, `item_name`, `sku`, `quantity`, `unit`, `unit_cost`, `reason`, `linked_document_type`, `customer_name`, `status`, `movement_date`).
  - Helper `isSample()` filters movements where `reason === "Samples / internal use"` or `linked_document_type === "Sample"`.
  - `salesmanLabel()` fallback chain for salesman display names.
  - `SampleDistributionPage`: React-Query `products-samples` list, sample movements table (`PageHeader`, `Card`, `EmptyState`, `TableSkeleton`, `SearchableSelect`), create-sample modal with `Gift/Plus/X/Loader2` UI, `canWrite = isAdmin || isOperations` gate, toast notifications.
- **App shell (`app.tsx`):** added Sample Distribution nav item, route-wall permission, sidebar section wiring (+59/-29).
- **`routeTree.gen.ts`:** registered `/app/sample-distribution` route.

---

## 3. `19afb5bc48789e887939c7c386033d39c8936894` — gst collection in cashcommand center

- **Commit time and date:** 2026-09-10 09:58:51 +0530
- **Author / Committer:** RamShrivastava3681
- **Message:** `gst collection in cashcommand center` (no body)

**Stats:** 7 files changed, 1065 insertions, 130 deletions

**Files changed:**
- `backend/src/routes/cash-flow.ts` (+30)
- `backend/src/services/cash-flow-engine.ts` (+157/-? — exports `cashDataOwners`, adds GST interfaces)
- `frontend/src/components/skeletons.tsx` (+35)
- `frontend/src/lib/api-client.ts` (+4)
- `frontend/src/routes/app.cash-flow.tsx` (+161)
- `frontend/src/routes/app.dashboard.tsx` (+796/-~130 — command-center redesign)
- `frontend/src/routes/app.tsx` (+12/-? — sidebar width + search + nav)

**Code changes:**
- **Backend GST ledger:**
  - `GET /cash-flow/gst-collection` in `backend/src/routes/cash-flow.ts`: merges per-owner ledgers portfolio-wide (`CashFlowEngine.cashDataOwners()` + `getGstCollection()`), sorts by `issueDate`, returns `{ totals, invoices }` with `gstTotalBilled`, `gstCollected`, `gstOutstanding`, `gstDueNext7Days`, `gstInvoiceCount`.
  - `cash-flow-engine.ts`: exported `cashDataOwners()`; added `CashCommandCentreSummary` GST fields, `GstCollectionRow` / `GstCollection` interfaces; helpers `invoiceGstTotal()` (camelCase + snake_case: `gstTotal/gst_total/taxAmount/tax_amount`), `invoiceNetReceivable()` (grand − advance), `invoicePaidAmount()` (paid counts as fully received, pro-rata GST).
- **Frontend Cash Flow (`app.cash-flow.tsx`, +161):**
  - New `gstCollectionQ` query (`["cash-flow-gst-collection"]`, 30s refetch), invalidation on mutation.
  - `gstLedger` useMemo with 3-tier fallback: dedicated API ledger → summary totals → client-side roll-up from `salesInvoicesQ`.
  - New `TabsTrigger value="gst"` + `TabsContent value="gst"`: “GST Amount Collection” header, 4 `SummaryCard`s (Total Billed / Collected / Outstanding / Due 7d), invoice table (Invoice, Customer, Due Date, Invoice Value, GST Amount, GST Collected, GST Outstanding, Status).
- **Dashboard (`app.dashboard.tsx`, large redesign):**
  - Replaced `PageHeader` with command-center header (Portfolio Overview + health badge “Portfolio healthy” / “N overdue need attention”).
  - `PrimaryMetric` → `KpiCard` with MoM trend (`momPct`), `Sparkline` SVG, compact `fmtCompact` (₹Cr/₹L/₹K), `monthLabel`, `timeAgo`.
  - Portfolio chart: 8M/6M/3M/1M range switcher, Gross/Net/Margin header totals, refined `AreaChart` tooltips.
  - `SecondaryMetric` → `PerfCell` with left accent bar; aging waterfall recolored (emerald/amber/orange/red) with % + compact values; alerts card restyle (5-item slice, Review link); new “Action Required” table (overdue, short payment, due-soon, funding pending, supplier pending); new “Portfolio Health” (`Healthy/Needs attention/At risk`, collection rate, overdue, avg collection days) + “Recent Activity” timeline feed.
- **Skeletons (`skeletons.tsx`):** +35 lines — loading skeleton for new GST/cash tables.
- **API client:** +4 lines — `cashFlow.gstCollection.list()`.
- **App shell:** sidebar `w-60 → w-56`, flyout `left-60 → left-56`, search button with “Search…” + `⌘K` hint.

---

## 4. `718ef835ecbc024baa3716dcc899f77d8a3f4450` — colour coding

- **Commit time and date:** 2026-09-10 10:17:26 +0530
- **Author / Committer:** RamShrivastava3681
- **Message:** `colour coding` (no body)

**Stats:** 34 files changed, 728 insertions, 549 deletions

**Files changed (all frontend):**
- `frontend/src/components/document-view.tsx`, `ledger-ui.tsx`, `product-variant-picker.tsx`, `reports-shell.tsx`, `reports-views.tsx`, `frontend/src/lib/reports-registry.ts`
- Routes: `app.admin.tsx`, `app.advances.tsx`, `app.alerts.tsx`, `app.bulk-payments.tsx`, `app.cash-flow.tsx`, `app.checker.tsx`, `app.crm.tsx`, `app.dashboard.tsx`, `app.dispatches.tsx`, `app.forecast.tsx`, `app.grn.tsx`, `app.inventory.tsx`, `app.invoices.tsx`, `app.notes.tsx`, `app.products.tsx`, `app.proformas.tsx`, `app.purchase-orders.tsx`, `app.purchases.tsx`, `app.queue.tsx`, `app.reminders.tsx`, `app.requests.tsx`, `app.sales-orders.tsx`, `app.stock-allocation.tsx`, `app.warehouse.tsx`, `app.workspace.tsx`, `approve.$token.tsx`, `noa.$token.tsx`
- `frontend/src/styles.css` (+72)

**Code changes — semantic colour system:**
- **`styles.css` (+72):** new CSS variables `--sem-success (#16a34a)`, `--sem-info (#2563eb)`, `--sem-attention (#d97706)`, `--sem-caution (#ea580c)`, `--sem-critical (#dc2626)`, `--sem-neutral (#64748b)` + dark-mode overrides (`#4ade80/#60a5fa/#fbbf24/#fb923c/#f87171/#94a3b8`); mapped to `--color-sem-*`; new `.sev-badge` component with `.sev-critical/.sev-action/.sev-attention/.sev-info/.sev-neutral` variants (dot + uppercase label, never color-alone). Comment: “business meaning, not brand … card backgrounds stay neutral”.
- **Bulk rename across ~30 files:** `bg-success/* → bg-sem-success/*`, `text-success → text-sem-success`, `bg-warning/* → bg-sem-attention/*`, `text-warning → text-sem-attention`, `bg-blue-*/text-blue-* → bg-sem-info/text-sem-info`, `bg-red-*/text-red-* → bg-sem-critical/text-sem-critical`. Examples:
  - `ledger-ui.tsx` (216 lines changed): status tones, badges, metric colors.
  - `app.cash-flow.tsx` (212 lines), `app.dashboard.tsx` (113 lines: `bg-destructive→bg-red-500`, `bg-warning→bg-amber-500`, aging bars `bg-emerald-500/amber-400/orange-500/red-500`, `KpiCard` spark tones `blue/green/amber`, `PerfCell` tone map).
  - `app.queue.tsx`, `app.purchases.tsx`, `app.purchase-orders.tsx`, `app.proformas.tsx`, `app.sales-orders.tsx`, `app.reminders.tsx`, `app.requests.tsx`, `app.workspace.tsx`, `app.warehouse.tsx`: all status pills, progress bars, approve buttons, GRN/PO badges migrated.
  - `approve.$token.tsx`: approve button `bg-success → bg-sem-success`; `noa.$token.tsx` same for accept button.
- No logic changes — purely visual token migration for consistent “healthy / info / attention / caution / critical” meaning.

---

## 5. `09df1151f30764223ddcb828b86f80d960a5ab74` — order sales template

- **Commit time and date:** 2026-09-10 14:12:48 +0530
- **Author / Committer:** RamShrivastava3681
- **Message:** `order sales template` (no body)

**Stats:** 12 files changed, 2359 insertions, 153 deletions

**Files changed:**
- `backend/src/email.ts` (+106)
- `backend/src/lib/document-pdf.ts` (+538/-? — Tally-style sales-order PDF)
- `backend/src/models/debtor.ts` (+59/-? — multi-address)
- `backend/src/models/goods-sales-order.ts` (+50)
- `backend/src/models/models-combined.ts` (+15)
- `backend/src/routes/index.ts` (+270/-? — sales-order PDF route + debtor/template sync)
- `frontend/src/routes/app.debtors.tsx` (+274/-? — address lists)
- `frontend/src/routes/app.products.tsx` (+565/-? — Master SKU rename + per-SKU pricing)
- `frontend/src/routes/app.sales-orders.tsx` (+395/-? — PDF download + tax/address fields)
- `frontend/src/routes/app.settings.tsx` (+104/-? — company address + bank)
- `frontend/src/routes/app.template.tsx` (+108/-? — state/bank/declaration)
- `frontend/src/routes/app.tsx` (+28/-? — `SALES_OPERATOR_ITEMS → SALES_ITEMS` rename)

**Code changes:**
- **Sales-order Tally PDF (`backend/src/lib/document-pdf.ts`, +538):** new `buildSalesOrderTallyPdf()` — header grid (buyer order no., reference no./date, delivery note, dispatch doc no., dispatched through), bill-to/ship-to with GSTIN/PAN, line table with colour/size/code/MRP snapshots + offer price, remarks block, bank-details table, declaration block, logo cell handling.
- **Sales-order model (`goods-sales-order.ts`, +50):** new nullable columns `buyer_order_no`, `reference_no`, `delivery_note`, `dispatch_doc_no`, `dispatched_through`, `ship_gstin`, `ship_pan`, `bill_gstin`, `bill_pan`, `remarks`; line snapshots `color/size/product_code/mrp`.
- **Debtor multi-address (`debtor.ts`, +59):** new `DebtorAddress {label, address}`; `billingAddresses` / `shippingAddresses` arrays (first = primary, mirrored in legacy `billingAddress/shippingAddress`); `normalizeAddresses()` accepts strings or `{label,address}` objects, drops blanks.
- **Pending-approval emails (`backend/src/email.ts`, +106):** `notifyPendingApprovers({stage: checker|treasury, kind, number, amount, counterparty, dueDate, submittedBy})` → notifies `factor_admin/super_admin/treasury/checker` roles (excludes actor), with dashboard deep link (`/app/checker` or `/app/queue`).
- **Routes (`index.ts`, +270):** `GET /goods-sales-orders/:id/pdf` download endpoint (content-disposition filename), debtor address persistence, invoice-template sync.
- **Frontend Sales Orders (+395):** `API_URL` + `downloadSalesOrderPdf(id, fallbackName)` helper; row-level PDF button (`FileDown` + `…` busy state); `SOModal` new fields (buyer order, reference, delivery note, dispatch doc, dispatched through, ship/bill GSTIN/PAN, remarks fieldset “for PDF”); address dropdowns (`normAddresses`, `addrLabel`, primary/custom logic); line snapshot display (`Colour · Size · Code · MRP ₹ · Offer ₹`); edit-modal PDF button; `Customer` type extended with `billing_addresses/shipping_addresses/gstin/pan`.
- **Debtors page (+274):** multi-address editor (label + address rows, primary badge, GSTIN/PAN passthrough).
- **Products page (+565):** “Product” → “Master SKU” rename (`New product → New Master SKU`, wizard steps `Master SKU details/pricing/colours/sizes`, `AD-GENDER-CATEGORY-MODEL` format `AD-U-TN-ET1100`); per-variant pricing snapshot (cost, selling, MRP, retailer, distributor, e-commerce, GST%) editable on create/edit, no longer inherited live from parent; `VariantModal`/`SkuBuilderModal`/`AddColourOrSizeModal` updates.
- **Settings (+104):** `company_address` textarea (“used on all documents”), “Company bank details” card (holder, bank name, ac no., IFSC, branch) saved to invoice template; `refreshAuth()` after save.
- **Template (+108):** new fields `company_state`, `company_state_code` (GST print), structured bank rows (`bank_holder/bank_name/bank_ac_no/bank_ifsc/bank_branch`) + free-text fallback + `declaration` textarea; description updated to “sales orders, sales invoices and credit/debit notes”.
- **Nav (`app.tsx`):** `SALES_OPERATOR_ITEMS → SALES_ITEMS`, section label “Sales Operator” → “Sales”.

---

## 6. `a91d4607d735655ced29f5371d83b8cc837ab52a` — logo fix in template

- **Commit time and date:** 2026-09-10 14:27:58 +0530
- **Author / Committer:** RamShrivastava3681
- **Message:** `logo fix in template` (no body)

**Stats:** 1 file changed, 5 insertions, 3 deletions

**Files changed:**
- `backend/src/lib/document-pdf.ts` (+5/-3)

**Code changes (exact diff in `buildSalesOrderTallyPdf`):**
- Logo cell background: `doc.rect(...).fill("#111111")` → `fill(TALLY.white)` with comment “White background: the Adventra logo asset is a dark mark on transparency, so it needs a light cell to stay visible.”
- Fallback text color: `fillColor("#FFFFFF")` → `fillColor(TALLY.ink)` in both `catch` and `else` branches.
- Fallback text: `sel.name` → `sel.name || " "` (avoids PDFKit error on empty string).
- Keeps border stroke `TALLY.ink`, `logoH = max(64, leftH - rightRowsH)` logic unchanged.

---

## 7. `0842f616dd98b8e1ba7f8686147c94a28094b7ba` — charizard

- **Commit time and date:** 2026-09-10 20:22:14 +0530
- **Author / Committer:** RamShrivastava3681
- **Message:** `charizard` (no body)

**Stats:** 30 files changed, 6738 insertions, 1686 deletions

**Files changed:**
- Backend: `package.json` (+2), `package-lock.json` (+284), `src/dynamodb.ts` (+15), `src/email.ts` (+76), `src/lib/document-pdf.ts` (+3928/-? — major rewrite), `src/lib/payment-terms.ts` (new, +108), `src/models/debtor-payment-term.ts` (new, +301), `src/models/debtor.ts` (+13/-?), `src/models/doc-timeline.ts` (new, +95), `src/models/goods-dispatch.ts` (+98/-?), `src/models/goods-sales-order.ts` (+73/-?), `src/models/invoice.ts` (+186/-?), `src/models/notification-log.ts` (new, +52), `src/models/payment-receipt.ts` (new, +165), `src/models/purchase-order.ts` (+19), `src/models/workflow-settings.ts` (new, +71), `src/models/workflow-task.ts` (new, +194), `src/routes/index.ts` (+1635/-? — workflow + terms + timeline APIs), `src/scripts/backfill-debtor-terms.ts` (new, +68)
- Frontend: `src/components/customer-terms.tsx` (new, +359), `src/components/payment-terms.tsx` (+2/-?), `src/lib/api-client.ts` (+36), `src/routes/app.debtors.tsx` (+119/-?), `app.dispatches.tsx` (+4), `app.invoices.tsx` (+213/-?), `app.products.tsx` (+88/-?), `app.proformas.tsx` (+90/-?), `app.queue.tsx` (+2), `app.sales-orders.tsx` (+126/-?), `app.warehouse.tsx` (+2)

**Code changes:**
- **Payment terms system:** new `payment-terms.ts` lib + `debtor-payment-term.ts` model (terms types, advance %, due-date computation, normalization) + `backfill-debtor-terms.ts` migration script; `debtor.ts` links debtor → terms; `customer-terms.tsx` (359 lines) UI for per-customer terms; `payment-terms.tsx` tweak.
- **Document workflow engine:** new `workflow-settings.ts` + `workflow-task.ts` models (task lifecycle, `requiredAction`, `docId/docNumber`, `counterparty`, `dueDate`, `status`, owner roles); `index.ts` +1635 lines adds workflow CRUD, approval transitions, assignment, overdue queries.
- **Timeline & notifications:** new `doc-timeline.ts` (per-document event log) + `notification-log.ts` (email audit trail); `email.ts` +76 lines for workflow/terms notifications.
- **Financial docs:** `invoice.ts` +186 (statuses, advance deduction, short-payment, receipt linkage), `payment-receipt.ts` new (+165, receipts against invoices), `goods-sales-order.ts` +73 (terms + workflow fields), `goods-dispatch.ts` +98 (dispatch status linkage), `purchase-order.ts` +19.
- **PDF rewrite (`document-pdf.ts`, ~3928 changed lines):** large refactor/expansion of all document PDFs (sales, purchase, proforma, invoice) to shared Tally-style renderer with terms, timeline, and logo handling.
- **DynamoDB (`dynamodb.ts` +15):** new indexes/keys for workflow/task/timeline queries.
- **Frontend:** debtors/invoices/proformas/sales-orders/products pages wired to terms + workflow actions (approve/reject, timeline view, receipt allocation); dispatches/queue/warehouse +4/+2/+2 line link-outs; `api-client.ts` +36 new endpoints (`paymentTerms`, `workflow`, `timeline`, `receipts`).
- **Deps:** `package.json` +2 / `package-lock.json` +284 (likely `uuid`/email or PDF deps for new modules).

---

## 8. `85c5bf84d1f40dec666882e7f887b6e4409b3588` — qwerasd

- **Commit time and date:** 2026-09-10 23:19:20 +0530
- **Author / Committer:** RamShrivastava3681
- **Message:** `qwerasd` (no body)

**Stats:** 36 files changed, 3365 insertions, 479 deletions

**Files changed:**
- Backend: `src/email.ts` (+26), `src/lib/document-pdf.ts` (+441), `src/models/workflow-task.ts` (+29), `src/routes/index.ts` (+50), `src/server.ts` (+4), `src/workflow-reminders.ts` (new, +229)
- Frontend: `scripts/patch-dialog-imports.sh` (new, +43), `src/components/dialog/LineRow.tsx` (new, +200), `src/components/dialog/index.tsx` (new, +240), `src/components/dispatch-workflow.tsx` (new, +503), `src/components/document-timeline.tsx` (new, +270), `src/components/document-view.tsx` (+9/-?), `src/lib/api-client.ts` (+37), `src/routeTree.gen.ts` (+105), routes: `app.advances.tsx`, `app.crm.tsx`, `app.debtors.tsx`, `app.dispatches.tsx` (+115), `app.expenses.tsx`, `app.finance-invoices.tsx`, `app.finance-proformas.tsx`, `app.finance-purchases.tsx`, `app.finance-sales-orders.tsx`, `app.grn.tsx`, `app.inventory.tsx`, `app.invoices.tsx` (+256/-?), `app.notes.tsx`, `app.proformas.tsx`, `app.purchase-orders.tsx`, `app.sales-orders.tsx` (+306), `app.sample-distribution.tsx`, `app.stock-allocation.tsx`, `app.suppliers.tsx`, `app.tasks.tsx` (new, +421), `app.tsx` (+33), `app.vendors.tsx`
- Total: 36 files, +3365/-479

**Code changes:**
- **Workflow reminder worker (`workflow-reminders.ts`, new 229 lines):** interval worker — (1) due-soon reminders (24h window, once/day), (2) daily overdue reminders (`overdueReminder: daily|off`), (3) escalation to `escalationEmail` fallback admins (once/day); `resolveRecipients` / `resolveEscalationRecipients` / `sendTaskEmail` helpers; logs to `NotificationLog`; never throws. `server.ts` +4 wires the interval.
- **Task model (`workflow-task.ts`, +29):** `lastReminderDate`, `lastEscalationDate` dedupe fields; `markReminded()`, `markEscalated()`, `listRecentDone(limit, clientId)` for Completed filter.
- **Dispatch workflow UI (`dispatch-workflow.tsx`, new 503 lines):** multi-step dispatch action panel (pack → dispatch → deliver → return) with status transitions, validation, and timeline writes; `dispatches.tsx` +115 integrates it into dispatch detail.
- **Shared dialog kit:** `dialog/index.tsx` (240) + `dialog/LineRow.tsx` (200) reusable line-item editor + `patch-dialog-imports.sh` codemod; `document-view.tsx` +9 adopts it.
- **Document timeline UI (`document-timeline.tsx`, new 270 lines):** vertical timeline rendering `doc-timeline` events (approvals, emails, status changes).
- **Tasks page (`app.tasks.tsx`, new 421 lines):** workflow task inbox (filters: open/due-soon/overdue/done, assignee, doc type), approve/complete actions, `listRecentDone` Completed tab.
- **Dialog migration (306 + 256 + ~80-line edits):** `app.sales-orders.tsx` (+306), `app.invoices.tsx` (+256), `app.proformas.tsx`, `app.purchase-orders.tsx`, `app.grn.tsx`, `app.inventory.tsx`, `app.stock-allocation.tsx`, `app.suppliers/vendors`, `app.crm/debtors/advances/expenses/notes` migrated from inline modals to shared `dialog/` components + show timeline.
- **Finance shortcuts:** `app.finance-*.tsx` +6 each — deep links into new task/invoice views.
- **PDF (`document-pdf.ts`, +441):** challan/invoice-preview additions (delivery-challan layout, timeline footer).
- **Email (`email.ts`, +26) + routes (`index.ts`, +50):** reminder/escalation templates + `NotificationLog` write path.
- **App shell (`app.tsx`, +33) + `routeTree.gen.ts` (+105):** `/app/tasks` route, nav item, route-wall entry.

---

## 9. `7fbf2e79178b21000fa2192f21e2c44be70732e1` — Stop drilling into /app/challan/$dispatchId

- **Commit time and date:** 2026-09-10 23:30:01 +0530
- **Author / Committer:** RamShrivastava3681 (Co-Authored-By: Codebuff)
- **Full message:**
  > Stop drilling into /app/challan/$dispatchId from the dispatch detail view
  >
  > The /app/challan/$dispatchId route was registered but orphaned from the navigation tree (no sidebar item, no route-wall entry), so TanStack Router's buildRouteTree invariant failed when it could not wire the parent-child relationship. Redirect the Print delivery challan link to the invoice preview page instead, and drop the unused /app/challan entry from the warehouse route-wall and the current-page label lookup.

**Stats:** 2 files changed, 2 insertions, 5 deletions

**Files changed:**
- `frontend/src/routes/app.dispatches.tsx` (+?/-? — link retarget)
- `frontend/src/routes/app.tsx` (-2 — route-wall + labels)

**Code changes (exact):**
- `app.dispatches.tsx` `DispatchDetailModal`: `<Link to="/app/challan/$dispatchId" params={{dispatchId}}>` with label “Print delivery challan” → `<Link to={/app/invoice-preview/...}>` with label “Print invoice” (uses `linked_sales_invoice_id ?? id`).
- `app.tsx` `AppLayout`: removed `"/app/challan"` from warehouse `route-wall` array (`/app/forecast, /app/grn, /app/dispatches, /app/challan, /app/stock-allocation, /app/sample-distribution` → without challan); removed `["/app/challan/", "Dispatch"]` from `DETAIL_LABELS`.
- Purpose: hotfix for TanStack Router `buildRouteTree` invariant crash on orphaned `/app/challan` route.

---

## 10. `6ed8dfd01149a71cd248e2a720ea7328fd52b0c3` — Restore /app/dispatches/challan/$dispatchId

- **Commit time and date:** 2026-09-10 23:40:49 +0530
- **Author / Committer:** RamShrivastava3681 (Co-Authored-By: Codebuff)
- **Full message:**
  > Restore /app/dispatches/challan/$dispatchId as a first-class child route
  >
  > The assorted /app/challan references were cleared in the previous cleanup, but the delivery-challan print destination still exists in the UI. Rather than keep routing through invoice preview, place the challan page under /app/dispatches so it is a real child of the dispatches tree and reachable from the dispatch-detail "Print delivery challan" action.
  >
  > Changes:
  > - Move the challan route file to /app/dispatches/challan/$dispatchId and switch it to a TanStack loader that fetches the dispatch once on navigation.
  > - Add /app/dispatches/challan to the warehouse route wall so the new path is navigable for operations/admin.
  > - Label the current page "Challan" when on /app/dispatches/challan/$dispatchId.
  > - Rewire the dispatch detail print link to /app/dispatches/challan/$dispatchId.
  >
  > Production build passes after the change:
  > - dist/index.html 1.83 kB
  > - dist/assets/index-NEp1iOoO.css 151.07 kB
  > - dist/assets/index-EqrKoHxb.js 2,813.41 kB

**Stats:** 3 files changed, 19 insertions, 22 deletions

**Files changed:**
- `frontend/src/routes/app.challan.$dispatchId.tsx` (+?/-? — rewritten to loader pattern, 34 lines changed)
- `frontend/src/routes/app.dispatches.tsx` (+?/-? — print link rewired back to challan)
- `frontend/src/routes/app.tsx` (+2 — wall + label)

**Code changes:**
- Moved/rewrote challan route as `/app/dispatches/challan/$dispatchId` child of dispatches tree (TanStack `loader` fetches dispatch once on navigation instead of in-component fetch).
- `app.tsx`: added `/app/dispatches/challan` to warehouse route-wall (operations/admin navigable); added current-page label “Challan” for `/app/dispatches/challan/$dispatchId`.
- `app.dispatches.tsx`: dispatch-detail action restored to “Print delivery challan” → `/app/dispatches/challan/$dispatchId`.
- Verified with production build (`dist/index.html 1.83 kB`, CSS 151.07 kB, JS 2,813.41 kB).

---

## Notes on reading this document

- Times are commit times as recorded by git (`--date=iso`), timezone +0530.
- `routeTree.gen.ts` changes are auto-generated by TanStack Router and mirror the route adds/removes above.
- Commits 7 (`charizard`) and 8 (`qwerasd`) are the largest; per-file insertion/deletion counts are in the Stats/Files sections — full diffs can be viewed with `git show <hash>`.
- Commit 9 → 10 is a revert-and-fix pair: 9 temporarily redirected challan printing to invoice-preview to fix a router crash; 10 restores a proper nested challan route.

## Verification commands

```powershell
git log --since="2026-09-10 00:00:00" --until="2026-09-10 23:59:59" --pretty=format:"%h %ad %s" --date=iso --all --reverse
git show --stat <commit-hash>
git show <commit-hash> -- <file-path>
```
