# WhizUnik Command — Workflow Clarity & Closure
## Detailed Developer Document: Requirements vs. Current Codebase

**Source:** `WhizUnik_Workflow_Clarity_and_Closure_Developer_Guide.pdf` (desktop, extracted 15 Sep 2026)
**Codebase reviewed:** `adventra-platform` — backend `src/` (Express + DynamoDB single-table) and frontend `src/` (TanStack Start + React Query), 327 files, branch `master` @ 15 Sep 2026.
**Companion docs already in repo:** `COMPLETE-WORKFLOW-GUIDE.md` (PDF-1/2/3 specs), `GIT_CHANGES_2026-09-10_to_2026-09-15.md`.

---

## 0. Purpose and scope (from the PDF)

The guide converts the walkthrough review into a focused implementation scope. It does **not** redesign the platform. It makes document hand-offs clearer, reduces first-use complexity, and completes the operational closing flow:

> Accepted Sales Order → invoice → IRN → dispatch → E-way Bill → payment → inventory debit.

**Delivery objective (verbatim):** a user opening any work item must immediately see
1. what the document is, 2. its current status, 3. who owns the next action,
4. what needs to happen next, 5. whether stock has moved, 6. whether available cash has changed.

**Explicitly out of scope:** direct government-portal / Tally integration (IRN & EWB stay manually recorded this release), changing commercial approval policy, changing historical stock/invoice/payment records.

---

## 1. Executive gap summary

| # | PDF requirement | Codebase state today | Gap size |
|---|---|---|---|
| 1 | Shared document-status strip on all 7 document types | **Does not exist.** No `StatusStrip` component anywhere; data fields (`workflowStatus`, `currentOwnerRole`, `nextRequiredAction` on SO; `paymentStatus`/`inventoryStatus` on tasks) exist to feed it. | **Medium** — new shared component + wiring into 7 pages/drawers |
| 2 | Form simplification — required-first with collapsible "Additional details" on PO / Dispatch / SO / Sales Invoice forms | **Not implemented.** Forms are flat (e.g. `app.invoices.tsx` 2,026 lines, `app.purchase-orders.tsx`, `app.dispatches.tsx`). All fields render at once. | **Medium** — pure frontend re-organisation, no field removal |
| 3 | Role queues (Sales / Procurement / Checker / Finance / Treasury / Warehouse) with one primary action + cash/stock cue | **Largely exists.** `app.tasks.tsx` (unified queue), 4 workbenches (`sales`, `finance`, `procurement`, `warehouse`), `app.checker.tsx`. Tasks already carry `requiredAction`, `paymentStatus`, `inventoryStatus`, `amount`. | **Small** — polish per-role filter presets + surfaced impact column |
| 4 | Notifications + audit timeline on every transition | **Implemented.** `advanceWorkflow()` + `timelineStatus()` fire on every handoff; `NotificationLog`, `DocTimeline`, `WorkflowSettings` (email toggles), `workflow-reminders.ts` (due/overdue/escalation worker). | **None / verify** |
| 5 | Sales execution flow after customer acceptance (12 steps, 4 payment-term routes) | **Mostly implemented** via `advanceWorkflow` chain: client acceptance → `create_proforma`/`create_invoice` task → IRN → dispatch → EWB → confirm → debit. Gaps in naming and 2 ordering rules (see §6). | **Small–Medium** |
| 6 | Dispatch Order data & validation (qty ≤ invoice qty − already dispatched; EWB gate on IRN) | **Mostly implemented.** Auto-dispatch-from-IRN flow exists; `validateDispatchLines` enforces pending qty; `record-ewb` requires submitted dispatch. Validation is against the **SO**, not the **invoice** — PDF asks for invoice-based quantity validation. | **Small** |
| 7 | Inventory & cash rules table | **Matches.** "Only a confirmed goods document moves stock" is the core invariant (`COMPLETE-WORKFLOW-GUIDE.md` §0; `goods-dispatch.ts`, `goods-receipt.ts`, `stock-movement.ts`). Cash only on Treasury verify/record. | **None / verify** |
| 8 | Data model & events (task uniqueness key, timeline fields, invoice IRN/EWB fields, dispatch readiness fields, named domain events) | **Mostly present**, but event names differ (see §8) and the uniqueness key is enforced at scan level, not storage level. | **Small** |
| 9 | Acceptance tests (7 scenarios + definition of done) | **No workflow acceptance tests exist.** Only `cash-flow-engine.test.ts` and `eway-bill.test.ts`. | **Medium** — test authoring |

---

## 2. §1 Shared document status strip — detailed requirements

### 2.1 What the PDF demands

A single strip component, placed **directly below the page title and above the normal document fields**, on the detail page **and** preview drawer of every operational document:

| Field | Requirement |
|---|---|
| Document reference | Type + system ref, e.g. "Sales Order SO 12345" |
| Lifecycle status | Current workflow status — human label, never an internal code |
| Current owner | Role or named user who must act next |
| Next action | Action phrase — "Record IRN", "Prepare dispatch details", "Approve invoice" |
| Inventory impact | One of: `No stock movement` · `Stock credited` · `Stock reserved if used` · `Stock debited` · `Location transfer only` |
| Cash impact | One of: `No cash impact` · `Expected receipt` · `Expected payment` · `Actual receipt recorded` · `Actual payment recorded` |
| Linked records | Compact links to parent/downstream docs: SO, Invoice, Proforma, GRN, Dispatch Order, payment |

### 2.2 Status presentation rules (colour semantics)

| State type | Colour | Examples |
|---|---|---|
| Needs action | **Amber** | Waiting for Warehouse, Record IRN, Payment overdue |
| In review / approved | **Blue** | Sent for approval, Approved, Customer acceptance pending |
| Completed / paid | **Green** | IRN recorded, Payment received, Fully dispatched |
| Blocked / exception | **Red** | Rejected, Cancelled, Overdue, Dispatch blocked |
| Informational | **Grey** | Draft, Archived, No stock movement |

> **Rule:** colour is a *secondary cue only*. The text label and next-action statement must always be present. Do not rely on colour alone.

### 2.3 Codebase mapping

- Documents to cover: **Sales Orders** (`app.sales-orders.tsx`), **Purchase Orders** (`app.purchase-orders.tsx`), **Proformas** (`app.proformas.tsx`), **Sales Invoices** (`app.invoices.tsx`), **Purchase Invoices** (`app.purchases.tsx`), **GRNs** (`app.grn.tsx`), **Dispatch Orders** (`app.dispatches.tsx`). Detail modals already live in `components/document-view.tsx` (`SalesOrderDetailModal`, `InvoiceDetailModal`, `ProformaDetailModal`, `PurchaseOrderDetailModal`) — the strip must be added there too.
- Data already available per document:
  - **SO:** `workflowStatus`, `currentOwnerRole`, `nextRequiredAction`, `nextDueDate`, `stockStatus` (`pending|reserved|in_transit`), `warehouseStatus`, `debtorApprovalStatus`, `dispatchHold` (model `goods-sales-order.ts` lines 185–190, 162–171, 174–177).
  - **Workflow tasks (any doc):** `docStatus`, `ownerRole`, `assignedUser`, `requiredAction`, `nextAction`, `paymentStatus`, `inventoryStatus`, `amount`, `dueDate` (model `workflow-task.ts`).
  - **Invoice:** `status`, `irn`, `ewbNumber`, `paymentStatus()` helper, `balanceOutstanding()`, `advanceDeducted` (`invoice.ts`).
  - **Dispatch:** `status` lifecycle + `stockDebited` flag + `shippingStatus` (`goods-dispatch.ts`).
- `GET /workflow-tasks/doc/:docType/:docId` already returns the open task for any document — the strip can resolve owner/next-action from it (endpoint at `routes/index.ts:1489`).
- Existing UI primitives to reuse: `StatusPill`, `Card`, `PageHeader` in `components/ledger-ui.tsx`; the app already has semantic colour tokens `sem-attention` (amber), `sem-success` (green), `sem-info` (blue), `destructive` (red), `muted` (grey) — matching the PDF's five-state palette exactly.

### 2.4 Gaps / work items

1. **Create `components/document-status-strip.tsx`** — one component, props: `docType`, `docNumber`, `status`, `ownerRole`, `assignedUser`, `nextAction`, `inventoryImpact`, `cashImpact`, `linkedDocs[]`.
2. **Impact derivation helpers** (new `lib/doc-impact.ts`):
   - `inventoryImpact(docType, doc)`: SO → `Stock reserved` when `stockStatus === "reserved"` else `No stock movement`; GRN → `Stock credited` when `stockCredited`; Dispatch → `Stock debited` when `stockDebited`, `Stock reserved` when status `details_submitted`/`ready_for_dispatch` (task `inventoryStatus: "reserved"` is already set today at route line 2480); transfer type → `Location transfer only`; sample/internal-use → `Stock debited`.
   - `cashImpact(docType, doc)`: SO → `No cash impact`; Proforma → `Expected receipt`; Invoice → `Expected receipt` until `amountReceived > 0` → `Actual receipt recorded` when `paymentStatus() === "paid"`; Purchase Invoice → `Expected payment` → `Actual payment recorded`; payment task → `Actual receipt recorded` when verified.
3. **Status label map** — one canonical `statusLabel(docType, code)` function so no internal code (e.g. `checker_pending`) is ever shown raw. Also used by queue rows (§3).
4. Wire into the 7 list-page detail views + 4 modals in `document-view.tsx`. Backend needs **no change** — a `GET /workflow-tasks/doc/...` per doc plus the document itself supplies every field.

---

## 3. §2 Form simplification — detailed requirements

### 3.1 What the PDF demands

Keep **all** current data fields and document-output behaviour. Change only what is shown first. A new user completes the basic transaction without being asked for optional / print-only / compliance-later fields. Each collapsed area is a **labelled expandable section**. Never hide a mandatory field. If an optional field becomes mandatory (payment term, transport mode, compliance state), **expand its section and show the reason**.

### 3.2 The four forms

| Form | Open by default | Move under "Additional details" |
|---|---|---|
| **Purchase Order** | Supplier, PO date, delivery warehouse, expected delivery date, payment term, expected payment date, item lines, attachments, notes | Quotation/reference fields, vendor print data, delivery clauses, packaging, cancellation/delay/notification clauses, other print-only details |
| **Dispatch Order** | Source warehouse, customer, delivery address, item lines, quantity, dispatch date, transporter/mode, vehicle number, distance, transporter document details | Packing notes, optional delivery instructions, print notes, non-mandatory transport references |
| **Sales Order** | Customer, saved billing/shipping address, child SKU lines, selected payment term, expected dispatch/delivery dates, customer order/reference, notes | Optional print references and additional remarks |
| **Sales Invoice** | Linked Sales Order, invoice date, customer, payment term, due/expected receipt date, line values, advance adjustment, notes | Optional references and output-only fields already obtained from linked records |

### 3.3 Codebase mapping

- **Sales Order form** (`app.sales-orders.tsx`): already term-aware — choosing a `DebtorPaymentTerm` sets `paymentTermId`, `advancePct`, `balanceDueDays`, `dispatchCondition` (lines ~1480–1500). Print-only fields that must collapse: `buyerOrderNo`, `referenceNo`, `deliveryNote`, `dispatchDocNo`, `dispatchedThrough`, `shipGstin`, `shipPan`, `billGstin`, `billPan`, `remarks` (model `goods-sales-order.ts` lines 55–75).
- **Purchase Order form** (`app.purchase-orders.tsx`): clause/template fields exist server-side (`po-clause.ts` model, "vendor print data, delivery clauses, packaging, cancellation/delay/notification clauses" per PDF) — these are exactly the collapsible set.
- **Dispatch Order form**: the pipeline already separates *required-at-submit* from *optional*: `POST /goods-dispatches/:id/submit-to-finance` validates `transportMode`, `transporterName`, `distanceKm > 0`, and `vehicleNumber` **or** `transportDocNumber` (routes line ~6630). Packing fields (`cartonCount`, `packageType`, `grossWeight`, `handlingInstructions`, `internalDispatchNotes`) are optional → collapse. Modal for the form exists (`PrepareDispatchModal` in `components/dispatch-workflow.tsx`).
- **Sales Invoice form** (`app.invoices.tsx`): mandatory core is SO link + date + customer + term + due date + lines + advance adjustment. Tally print fields (`deliveryNoteRef`, `otherReferences`, `buyerOrderDate`, `dispatchDocNumber`, `destination`, `termsOfDelivery`, consignee/buyer GST snapshots) → collapse.
- UI kit: Radix `Collapsible` and `Accordion` are already dependencies (frontend `package.json`) — no new package needed.

### 3.4 Conditional-mandatory rule (must implement)

Example already in the codebase: `submit-to-finance` demands `vehicleNumber` **or** `transportDocNumber` depending on transport mode. The form must auto-expand the transport section and render the reason text ("Vehicle number or transport document number is required for this mode") when validation would fail. Same pattern for payment terms that flip `advancePct` to mandatory, and for EWB-required consignments (distance/threshold).

### 3.5 Work items

1. Build a small `FormSection` (labelled, expandable, optional `reason` prop) in `components/dialog/`.
2. Reorder the 4 forms: core fields first, `FormSection title="Additional details"` for the rest.
3. Add reactive expansion: watch the fields that make collapsed fields mandatory; expand + show reason.
4. **Do not** touch field names, payload shape, or print templates — output parity is a stated requirement.

---

## 4. §3 Queue and workspace behaviour — detailed requirements

### 4.1 What the PDF demands

Queues are the primary operating surface; each team works its own queue, not a general document list. Existing role permissions maintained.

**Queue item fields:** Document (reference, type, linked parent, customer/supplier) · Status + age (highlight overdue) · Next action (exact task wording — main decision cue) · Owner (named user where assigned, else role) · Financial & stock cue (compact) · **One primary action** (secondary actions stay in detail view).

**Required role queues and their content:**

| Role | Must show |
|---|---|
| Sales | SOs awaiting warehouse confirmation, customer acceptance, UTRs to share with Treasury, returned items |
| Procurement | PO drafts, POs awaiting Checker, supplier invoices awaiting review, expected receipts |
| Checker | All approval items with doc type, total, creator, linked docs, approve/return/reject actions |
| Finance | Proforma tasks, final-invoice tasks, invoice-approval items (if configured), Record IRN tasks, Record E-way Bill tasks |
| Treasury | Expected customer receipts, advance receipts, supplier payment tasks, submitted UTRs, unallocated payments, overdue items |
| Warehouse | GRNs, stock transfers, Prepare Dispatch Order tasks, Ready-to-Dispatch tasks, sample/internal-use movements, return tasks |

**Idempotency rule:** every transition creates **exactly one** next task; reprocessing never duplicates tasks, notifications, or stock movements.

### 4.2 Codebase mapping

- **Unified queue exists:** `app.tasks.tsx` — "Workflow Queue (PDF-3 §7, §8)" with filters `mine / pending / due_today / overdue / rejected / completed`, role dropdown, search, personal-queue-first ordering (server sorts: assigned-to-me → my-role → rest, `routes/index.ts:1468–1486`). Rows already show `required_action`, `next_action`, `priority`, `due_date`, `overdue`, `amount`, `payment_status`, `inventory_status`, `linked_docs`.
- **Role workbenches exist and already filter by task family:**
  - Sales: `app.sales-workbench.tsx` filters to `sales_order / sales_invoice / proforma / dispatch / payment` tasks; KPIs = `client_acceptance`, advance pending, invoices awaiting approval, `prepare_dispatch` ready.
  - Finance: `app.finance-workbench.tsx`; Procurement: `app.procurement-workbench.tsx`; Warehouse: `app.warehouse-workbench.tsx` (all task-driven, see their headers).
  - Checker: `app.checker.tsx` — approval queue with SO/PO/PI/SI tabs, approve/return/reject, creator resolution via `/admin/users`, ageing buckets.
- **Idempotency is implemented in the engine:** `WorkflowTask.openTask()` returns the existing open task unchanged when the same `docType + docId + stage` is already open (`created: false`) and closes siblings first — exactly one open task per document (`workflow-task.ts`). Email sending is gated on `created === true` (no duplicate notifications). Stock debits are idempotent via the atomic `markStockDebited()` conditional update (`goods-dispatch.ts`), and GRN confirm uses the analogous `stockCredited` flag.
- **Permissions unchanged:** role middleware (`requireRole`, `effectiveListScope`) is preserved on every route.

### 4.3 Gaps / work items

1. **"One primary action" column** — the queue rows show `requiredAction` text but no single button. Add a `PrimaryActionButton` per stage (open / approve / record payment / prepare dispatch / record IRN / record EWB), mapped from `t.stage`, deep-linking to the owning page. Keep everything else in the drawer.
2. **Age column** — `created_at` is present; render "age in status" (e.g. "3d in Record IRN") + overdue highlight (PDF explicitly asks for *age in status*, not just due date).
3. **Per-role default filter presets** — when Treasury opens `/app/tasks`, preselect the treasury family (receipts/UTRs/payments); same for the other five roles. This is config, not new backend.
4. **Queue coverage check** — everything the PDF lists is produced by existing stages: warehouse confirm (`stock_check`), client acceptance (`client_acceptance`), UTR share (payment `payment_confirmation`), returns (`dispatch` returned), PO drafts/Checker (`purchase_order` checker_approval), supplier invoices (`purchase_invoice` review), expected receipts (Treasury panel via proformas/expected-inflow), GRN/transfer/sample/return (Warehouse workbench tabs). Verify each renders in the role's workbench, add missing panels only if a probe shows gaps.

---

## 5. §4 Notifications and audit trail — detailed requirements

### 5.1 What the PDF demands

- In-app **and** email notification when a new task is assigned to a role/user.
- Timeline event for every: creation, submission, approval, return, acceptance, compliance-number entry, payment record, dispatch confirmation, cancellation, reversal.
- Timeline entries show: timestamp, acting user, action, previous status, new status, linked reference.
- Email contains: document reference, counterparty, amount if relevant, next action, direct platform link. **Must not include sensitive bank details.**

### 5.2 Codebase mapping — this section is already built

- **Dual notification on assignment:** `advanceWorkflow()` opens the task, writes the timeline entry, and (only when `created === true`) sends `notifyWorkflowTask()` email + logs `NotificationLog` (routes `index.ts:200–283`). In-app surface = the queue itself + bell/alerts.
- **Email content:** `notifyWorkflowTask()` (email.ts:841) sends Document, Supplier/Customer (counterparty), Current Status, Required Action, Due Date, Latest Update + an "Open Task" deep link (`appPath` per handoff). **No bank details are included** — bank/UPI details only print on proforma PDFs sent to customers, not in workflow emails. ✅ complies.
- **Timeline coverage:** `timelineStatus()` writes `prevStatus → newStatus` with actor id/email/roles. The ten event classes map to existing timeline kinds: `note`, `attachment`, `rejection`, `payment_proof`, `delivery_note`, `supplier_invoice`, `mention`, `revised_date`, `status_change`, `assignment`, `system` (`doc-timeline.ts`). Verified call sites: SO submit/approve/reject (`sales-review`, `warehouse-approve`, `checker-approve`), client acceptance (`/approvals/:token/respond`), IRN record (`invoice.irn_recorded` + "invoice locked"), IRN clear, EWB record / not-required, dispatch submit/send-back/cancel, dispatch confirmation ("inventory debited"), payment submit/verify/reject, invoice issue/approve/reject/cancel, GRN confirm/cancel.
- **Reminder/escalation worker:** `workflow-reminders.ts` — due-soon reminders (24 h default), daily overdue reminders, daily escalation to configured recipient (falls back to admins), all logged to `NotificationLog`.
- **User-togglable:** `WorkflowSettings` — `emailOnAssignment/Approval/Rejection`, `reminderHoursBefore`, `overdueReminder: daily|off`, `escalationEmail`, `dailySummary`; honoured by `advanceWorkflow` and the worker.

### 5.3 Gaps / work items

1. **"Acceptance" event** — client acceptance currently logs `system` timeline "Client accepted on …"; add explicit `kind` semantics or text pattern "Customer acceptance" so the audit filter can find acceptances (cosmetic).
2. **Compliance-entry events** — IRN/EWB timeline entries exist; ensure they always capture *who* entered (they do via `req.user.email`) and note the **correction** path: `DELETE /invoices/:id/irn` writes `invoice.irn_cleared` audit but **no timeline entry today** → add one ("IRN cleared — reason — previous value retained in audit"). The previous value is preserved by `AuditLog.writeWorkflowAction`, satisfying "retain previous value in audit history".
3. **"In-app notification"** — confirm the bell/alerts component consumes `NotificationLog` (it does for overdue today); surface new-assignment entries too if not already shown.

---

## 6. §5 Sales execution flow after customer acceptance — detailed requirements

### 6.1 The required 12-step flow

**Entry gate (PDF):** begins **only after** Warehouse confirmed availability + Checker approved the SO + customer accepted. A Sales Order alone never debits inventory.

| Step | Owner | System action & gate |
|---|---|---|
| 1 | System/Sales | Customer accepts SO → status **Customer Accepted** |
| 2 | System | Route by payment term — **exactly one** Finance task |
| 3 | Finance | 100% advance / part advance → **Create Proforma** task; credit / on-delivery / non-advance → **Create Final Invoice** task |
| 4 | Treasury | Record advance against Proforma (date, amount, method, UTR); update **actual** cash; when threshold met → create final-invoice task |
| 5 | Finance | Create invoice from accepted SO (auto-fill customer, addresses, term, due date, SKU lines, taxes, permitted advance adjustment); apply invoice approval policy if configured |
| 6 | System | When approved/issued per tenant policy → Finance **Record IRN** task. Inventory unchanged |
| 7 | Finance | Record IRN manually; validate **64 chars**; IRN date + attachment; on success → Warehouse **Prepare Dispatch Order** task |
| 8 | Warehouse | Create/complete Dispatch Order linked to invoice; capture dispatch + transport; **do not debit inventory yet** |
| 9 | Finance | Once dispatch details complete → **Record E-way Bill** task; store number, date, valid-until, attachment |
| 10 | System | Dispatch Order → **Ready to Dispatch** only when: invoice issued + IRN recorded + EWB recorded (where required) + **advance gate satisfied** |
| 11 | Warehouse | Confirm physical dispatch → **one immutable outbound stock movement**; update dispatched quantities; set partial/full dispatch status |
| 12 | Treasury | Balance receipt for credit/balance-after-dispatch terms when actually received; update actual cash + invoice balance; overdue expected receipts stay projected until recorded |

### 6.2 Codebase mapping — step by step

| PDF step | Where it lives today | Status |
|---|---|---|
| 1. Customer accepts | `/approvals/:token/respond` (one-time token, atomic `updateItemIf` claim) sets `debtorApprovalStatus=approved`, SO `confirmed` | ✅ |
| 2. Route by term | Same handler: `advancePct > 0 → stage "create_proforma"` else `stage "create_invoice"`; exactly one task via `openTask` idempotency | ✅ |
| 3. Proforma task | `Create Advance Proforma` → `/app/proformas`; proforma creation links `linkedGoodsSoId`, sets `advanceAmount` (= SO value × advance %) | ✅ |
| 4. Record advance | Sales submits UTR proof (`POST /payment-receipts`) → Treasury `verify` → when verified total ≥ `advanceAmount`: proforma → `paid`, **then** `Create Final Sales Invoice` task opens | ✅ (threshold gate enforced) |
| 5. Create invoice | `POST /invoices` requires SO link + `warehouseStatus === "approved"` (`assertInvoiceMatchesSO`); auto-fill from SO; **payment-condition gate** `assertPaymentConditionForInvoice` enforces `no_check / advance_required / full_required` from the SO's term snapshot; `advanceDeducted` from verified proforma; credit-limit check | ✅ |
| 5b. Approval policy | Checker approves via `PUT /invoices/:id` (status changes checker-only) **or** Finance issues draft directly via `POST /invoices/:id/issue` (skips checker — documented tenant policy). Both paths raise the same next task | ✅ |
| 6. Record IRN task | Both approval paths call `advanceWorkflow stage:"record_irn", ownerRole:"treasury", requiredAction:"Record IRN from Tally"` | ✅ (owner label is "treasury", PDF says Finance — see gaps) |
| 7. Record IRN | `POST /invoices/:id/irn` — 64-char hex validation via `normalizeIrn` (`/^[0-9a-f]{64}$/`), ack no/date validation, `irnEnteredBy/At`, **no auto placeholder**; IRN freezes invoice content edits (`irnFrozen` field list); then **auto-creates the Dispatch Order** pre-filled from invoice + SO (lines = invoice qty − already dispatched) and opens Warehouse `prepare_dispatch` task | ✅ |
| 8. Prepare dispatch | Warehouse fills packing + transport on the draft; `submit-to-finance` validates mandatory transport fields → `details_submitted`; **no stock impact** | ✅ |
| 9. EWB task | `submit-to-finance` opens Finance `generate_ewb` task | ✅ |
| 9–10. Record EWB | `POST /goods-dispatches/:id/record-ewb` (Treasury/admin): numeric EWB 8–16 digits, `generatedAt`, `validUntil`, mirrors onto invoice (`ewbNumber/ewbGeneratedAt/ewbValidUntil/transporter/vehicle/lrRef`); "EWB Not Required" path with **authorised reason**; → `ready_for_dispatch` + `confirm_dispatch` task | ✅ |
| 10. Release gate | `POST /goods-dispatches/:id/confirm` — when `finalInvoiceId` present, requires `status === "ready_for_dispatch"` **or** `ewbNotRequired` + reason; blocks with "E-Way Bill pending — Finance must record it first"; plus `dispatchHold` and credit-limit gates | ✅ — **but no explicit advance-gate re-check at this step** (see gap below) |
| 11. Physical dispatch | Pipeline move to `dispatched`: `assertSODispatchable` (incl. warehouse sign-off), `validateDispatchLines` (pending-qty vs live SO), stock-balance check per location, atomic `markStockDebited` (idempotent), `debitSalesOrder` creates **confirmed** `StockMovement` rows (direction `out`) + folds qty into SO; SO → partially/fully dispatched; timeline "inventory debited" | ✅ |
| 12. Balance receipt | `POST /invoices/:id/payment` (Treasury/admin) accumulates `amountReceived`, derives `partially_paid/paid`, `lateDays`; expected inflow exists from invoice creation (`syncInvoiceToInflow`) and is reduced on payment (`syncInvoicePaymentToInflow`) | ✅ |

**Payment-term routing (the four routes in Definition of Done):**
- **credit** → `create_invoice` task → issue/approve → IRN → dispatch (gate `no_check`). ✅
- **advance_full** → `dispatchCondition: "full_required"` → proforma → verified full advance → invoice. ✅
- **advance_partial** → `dispatchCondition: "advance_required"` → proforma → verified advance ≥ SO value × advancePct → invoice (advance deducted on invoice; balance due later). ✅
- **on_delivery** → `full_required` → invoice after full verified receipt. ✅
- Structured terms + dispatch conditions live in `lib/payment-terms.ts`; SO snapshots are frozen after draft (re-selectable only from an approved master term) — routes `index.ts:4945–4966`.

### 6.3 Gaps / work items

1. **IRN attachment** — PDF asks for "IRN date and attachment". Route stores `ackNo/ackDate`; there is no dedicated IRN attachment file. Add optional `irnAttachmentId` (S3 doc uploader already exists: `DocumentUploader` component + `documents` array pattern).
2. **EWB attachment** — PDF: "supporting attachment where available". Same fix: `ewbAttachmentId` on dispatch/invoice.
3. **Advance gate at dispatch release (step 10)** — `assertPaymentConditionForInvoice` runs at *invoice creation*, not at *dispatch confirm*. For `advance_required`/`full_required` terms, re-run the verified-receipt check inside the `finalInvoiceId` branch of `POST /goods-dispatches/:id/confirm` so the release gate matches the PDF exactly ("Ready to Dispatch only when … any advance gate is satisfied").
4. **Role naming** — engine tasks use `ownerRole: "treasury"` for IRN/EWB while the PDF calls the owner "Finance". Either rename the owner label in the UI mapping (`OWNER_LABEL` already renders treasury → "Treasury") or keep as-is and document that Treasury *is* the Finance team in this deployment. Decision needed from product.
5. **Step 1 status label** — set/emit a visible "Customer Accepted" lifecycle label (SO status today becomes `confirmed` + `debtorApprovalStatus: approved`; the status strip's `statusLabel` map should render it as "Customer Accepted").
6. **Immutable movement** — stock movements are append-only with `status: "confirmed"` at creation; corrections go through cancel/return reversals (`reverseDispatch`, `recordReturned`). ✅ compliant; add a regression test to lock it.

---

## 7. §6 Dispatch Order data and validation — detailed requirements

### 7.1 What the PDF demands

Dispatch Order = separate operational document **linked to the final invoice**; invoice provides customer/product/tax/commercial data; warehouse adds movement + transport. Saved dispatch values flow to the invoice output automatically (Finance never retypes).

| Section | Required fields | Validation |
|---|---|---|
| Linked document | Final invoice, SO, source warehouse, customer, ship-to, item lines & quantities | **Quantity ≤ invoice qty − previously dispatched**; source warehouse must hold the required available stock |
| Dispatch details | Planned dispatch date, dispatch doc no (if used), delivery-note ref (if used), contact/instructions | Required before "dispatch details complete" |
| Transport | Mode, transporter name/ID, vehicle no, transporter doc no/date, distance, destination PIN | Required fields by **selected mode** and EWB requirement; vehicle format validation **configurable** |
| Packing | Package count/details | Optional unless business rules require |
| Compliance | IRN inherited from invoice (read-only to Warehouse); EWB fields read-only to Warehouse after Finance records | **EWB task cannot complete unless IRN present when e-invoicing applies** |

**Manual compliance behaviour:** IRN manually entered by Finance on approved/issued invoice, exactly 64 alphanumeric, **no placeholder generated**; EWB number manually entered by Finance **only after** dispatch details complete; store number/date/valid-until/attachment; compliance timeline shows who entered/changed; corrections retain previous value in audit. Future Tally integration replaces manual capture — **keep integration hooks separate**.

### 7.2 Codebase mapping

- **Auto-creation from invoice:** on IRN record, backend auto-creates the dispatch pre-filled with `finalInvoiceId/Number`, `irnSnapshot`, `invoicedValue`, `invoicedGst`, customer, addresses, SO link, and lines computed as invoice qty − already-dispatched (routes `index.ts:2380–2470`). ✅ "system should not require Finance to retype them" — satisfied.
- **Invoice print auto-picks dispatch values:** `assembleInvoiceEwb()` (routes `index.ts:5560+`) merges NIC record → dispatch record → invoice mirror for the EWB print section of the Tally-format invoice PDF. ✅
- **IRN read-only to Warehouse:** IRN lives only on the invoice; the dispatch holds a snapshot (`irnSnapshot`); warehouse UI never edits it. EWB fields on the dispatch are written only by the Treasury-only `record-ewb` endpoint (`requireRole("treasury","factor_admin")`). ✅
- **EWB cannot complete unless IRN present:** the EWB flow is reachable only via the IRN → auto-dispatch → submit → `generate_ewb` chain, and the IRN endpoint refuses to run when a dispatch already references the invoice. The 64-char validation and "no placeholder" rule are enforced in `Invoice.recordIrn`/`normalizeIrn`. ✅
- **Stock availability:** `stockBalanceByProduct()` per source location; dispatch blocked on negative balance at submit-to-pipeline `dispatched` and at confirm. ✅
- **Mode-based required fields:** submit validates `transportMode + transporterName + distance > 0 + (vehicleNumber || transportDocNumber)`. ⚠ Partial: this is one static rule, not "required fields by selected mode", and vehicle-format validation is not configurable.

### 7.3 Gaps / work items

1. **Invoice-based quantity validation** — `validateDispatchLines` validates against the **SO** pending quantity. The PDF wants `qty ≤ invoice qty − previously dispatched`. Add a parallel check when `finalInvoiceId` is set (sum prior non-cancelled dispatches per product for that invoice).
2. **Configurable vehicle-number format** — add a per-tenant setting (e.g. `WorkflowSettings.vehicleFormatRegex` or a catalogue setting) consumed by the route + frontend validation.
3. **Mode-driven required fields** — small mapping table `mode → required fields` (e.g. road: vehicle/doc; rail/air/ship: transporter doc mandatory, vehicle optional) in `submit-to-finance` + the `PrepareDispatchModal`.
4. **PIN code** — `deliveryPincode` field exists on the dispatch model and is saved; ensure it's marked required for road EWB when business rules require (EBW API requires it for > 0 distance when generated later — the NIC integration already handles its own payload).
5. **Attachments** (from §6): IRN + EWB attachment IDs.
6. **Correction audit** — IRN clear path needs a timeline entry (see §5.3.2). EWB corrections: today a re-record is blocked once status advanced; the audit trail retains history via `AuditLog`. Add explicit "previous value retained" text to the timeline when a correction ever becomes possible.

---

## 8. §7 Inventory and cash rules — detailed requirements & verification

The PDF's event table:

| Event | Inventory | Available cash | Projected cash |
|---|---|---|---|
| Sales Order / Proforma / Invoice | No movement | No change | Expected customer receipt follows payment term once invoice/expected date exists |
| Approved Purchase Order | No movement | No change | Expected supplier outflow from expected payment date |
| GRN | **Credit receiving location** | No change | — |
| Internal warehouse transfer | Move between locations only | No change | — |
| Sample / internal-use issue | **Debit stock** | No change | — |
| Physical dispatch confirmed | **Debit outbound stock** | No change | — |
| Treasury receipt / payment | No movement | **Change only when actually recorded** | Remove/reduce corresponding expected cash item |

**Codebase verification — all rules hold:**

- Stock is **derived** from confirmed movements only (`stock-movement.ts`: "live stock = Σ confirmed credits − Σ confirmed debits"; legacy pre-status records normalized to confirmed).
- The one-invariant rule is documented and enforced: **"A document never touches stock — only a confirmed goods document does"** (`COMPLETE-WORKFLOW-GUIDE.md` §0). SO/Proforma/Invoice create **no** movements — routes assert this in comments and in `validateInvoiceLines` ("Creating an invoice NEVER creates inventory").
- GRN confirm → `stockCredited` idempotent flag + credit movements at the receiving location (`goods-receipt.ts`).
- Dispatch → debit **only** at pipeline `dispatched` (never at confirm/pick/pack), idempotent via `markStockDebited` (`goods-dispatch.ts` header + routes `index.ts:6917+`).
- Transfers move stock between `sourceLocationId`/`destinationLocationId` only (dispatch types `stock_transfer`, movement `transferId`).
- Samples/internal-use → `damage_sample_adjustment` dispatch type debits stock.
- Cash: only Treasury verify/record changes actual cash — `PaymentReceipt.verify` (proforma advance) and `POST /invoices/:id/payment`; the cash-flow engine distinguishes projected (`expected-inflow`/`expected-outflow`) from actual, and receipts remove/reduce the expected item (`syncInvoicePaymentToInflow`).

**Gap:** none functional. Work item: encode this table as a test fixture (§10) so regressions fail loudly.

---

## 9. §8 Data model and event requirements

### 9.1 Entity requirements vs. schema

| Entity | PDF required additions/checks | Codebase state | Action |
|---|---|---|---|
| **Workflow task** | Unique key = tenant + doc type + doc ID + task type; status; owner role/user; created/completed timestamps; next-action label; deep link | `WorkflowTask` has all fields; uniqueness enforced logically in `openTask` (`same stage open → return existing`) via a scan filter; `taskRef()` helper exists but is **not stored** as an attribute | ✅ functionally idempotent. Optional hardening: store `taskRef` as a unique attribute/GSI and use a conditional `putItemIf(attribute_not_exists)` instead of scan-then-put to survive concurrent writers |
| **Document timeline** | Append-only; actor, action, old/new status, metadata, linked refs | `DocTimeline.addEntry` — append-only `TIMELINE#docType#docId`, `kind`, `actorId/Email/Roles`, `prevStatus/newStatus`, `attachment`, `mentionedUser` | ✅ |
| **Sales invoice** | IRN value, IRN date, IRN attachment ID; EWB value, EWB date, valid-until, EWB attachment ID | `irn`, `ackNo`, `ackDate`, `irnSource/EnteredBy/EnteredAt`, `signedQr`, `ewbNumber`, `ewbDate`, `ewbGeneratedAt`, `ewbValidUntil` — **missing: `irnAttachmentId`, `ewbAttachmentId`** | Add 2 fields to model `allowed` list + record endpoints |
| **Dispatch order** | Invoice ID, SO ID, source location, transport data, dispatch-detail-complete timestamp, readiness state, physical-dispatch confirmation timestamp | `finalInvoiceId`, `goodsSalesOrderId`, `sourceLocationId`, full transport block, `submittedAt/submittedBy` (= details complete), readiness = `status: ready_for_dispatch` + `stockDebited`, physical confirm = `actualDispatchedAt/actualVehicleNumber/actualPackedQty/lrNumber` | ✅ (all present; "readiness state" is derivable — optionally add an explicit `readinessState` string if the strip needs it cheap) |
| **Stock movement** | Immutable event: movement type, source/destination, SKU child ID, qty, linked dispatch/GRN, actor | `StockMovement` — direction in/out, `sourceLocationId/destinationLocationId`, `productId`, `quantity`, `goodsDispatchId/goodsReceiptId`, `createdBy/confirmedBy` … cancel is a status change that drops it from balances | ✅ |
| **Payment allocation** | Payment ID, linked invoice/proforma, allocated amount, reference/UTR, status; **no actual-cash update until Treasury confirms** | `PaymentReceipt` (submit → verify/reject) covers proforma/invoice receipts with UTR + proof; `NotificationLog`-style status; **bulk payments** (`bulk-payment.ts`: FIFO/two-pass/manual allocation with `remaining` carry-forward) cover supplier allocations | ✅ |

### 9.2 Event names

**PDF requires** explicit domain events: `sales_order_customer_accepted`, `finance_proforma_required`, `advance_received`, `final_invoice_required`, `invoice_issued`, `irn_recorded`, `dispatch_preparation_required`, `dispatch_details_completed`, `eway_bill_required`, `eway_bill_recorded`, `dispatch_released`, `physical_dispatch_confirmed`, `stock_debited`, `receipt_recorded`, `payment_overdue`.

**Codebase today:** transitions are implicit — audit actions like `workflow.task_opened`, `invoice.irn_recorded`, `dispatch.submitted`, `dispatch.cancelled`, `sales_order.checker_approve`, plus workflow `stage` keys (`client_acceptance`, `create_proforma`, `create_invoice`, `payment_confirmation`, `record_irn`, `prepare_dispatch`, `generate_ewb`, `confirm_dispatch`, …) and timeline kinds. **There is no named domain-event bus.**

**Decision (recommended):** introduce a lightweight `DomainEvent` writer rather than refactoring the engine:

```ts
// backend/src/models/domain-event.ts  (new)
export const DOMAIN_EVENTS = [
  "sales_order_customer_accepted", "finance_proforma_required", "advance_received",
  "final_invoice_required", "invoice_issued", "irn_recorded",
  "dispatch_preparation_required", "dispatch_details_completed", "eway_bill_required",
  "eway_bill_recorded", "dispatch_released", "physical_dispatch_confirmed",
  "stock_debited", "receipt_recorded", "payment_overdue",
] as const;
// writeEvent({ clientId, eventId (uuid), name, docType, docId, docNumber, actorId, payload })
// dedupe key: name + docType + docId (+ stage) — checked before any downstream write
```

Emit points (one line each, fire-and-forget, next to the existing `advanceWorkflow`/`timelineStatus` calls):

| PDF event | Emit at |
|---|---|
| `sales_order_customer_accepted` | `/approvals/:token/respond` (sales_order, approved) |
| `finance_proforma_required` | same handler, `needsProforma` branch |
| `advance_received` | `payment-receipts/:id/verify` when proforma threshold met |
| `final_invoice_required` | same verify handler + client-acceptance non-advance branch |
| `invoice_issued` | `POST /invoices/:id/issue` + checker approval branch |
| `irn_recorded` | `POST /invoices/:id/irn` |
| `dispatch_preparation_required` | IRN handler after auto-dispatch creation |
| `dispatch_details_completed` | `submit-to-finance` |
| `eway_bill_required` | `submit-to-finance` (after details completed) |
| `eway_bill_recorded` | `record-ewb` |
| `dispatch_released` | `confirm` success (finalInvoiceId branch) |
| `physical_dispatch_confirmed` | shipping-status → `dispatched` |
| `stock_debited` | inside `markStockDebited` success (route side) |
| `receipt_recorded` | `POST /invoices/:id/payment` + receipt verify |
| `payment_overdue` | `workflow-reminders.ts` overdue worker |

**Idempotency rule from PDF:** "Event handlers must be idempotent. Store and check an event ID or task uniqueness key before creating a downstream task or stock movement." → the event write itself dedupes on `name+docType+docId`; stock already guards via `stockDebited`/`stockCredited` conditional updates; tasks via `openTask`.

---

## 10. §9 Acceptance tests + definition of done

### 10.1 PDF scenarios

| Scenario | Expected result |
|---|---|
| **Credit terms, goods in stock** | Customer accepts SO → Finance final-invoice task; invoice issued; IRN recorded; Warehouse completes Dispatch Order; EWB recorded; Warehouse confirms dispatch; **inventory debits once**; Treasury can record receipt later |
| **100% advance, goods in stock** | Customer accepts → Proforma task; Treasury records full advance; final-invoice task appears **only after payment**; IRN/dispatch/EWB follow; **dispatch cannot confirm before the advance gate** |
| **Part advance + balance later** | Proforma shows advance required; Treasury records advance; final invoice shows gross + advance adjustment; outstanding balance + due date correct; balance receipt recordable after dispatch |
| **IRN missing** | Warehouse may **not** release dispatch; status strip says "Waiting for Finance to record IRN" |
| **EWB missing where required** | Warehouse may complete dispatch details but cannot confirm physical dispatch; Finance receives the EWB task |
| **Repeated submit / refresh** | No duplicate finance/warehouse/treasury tasks, notifications, or stock movements |
| **Dispatch correction / return** | Never edit completed stock history; use approved return/reversal/credit-note/debit-note workflow and append timeline events |

### 10.2 Definition of done (from PDF)

1. Status strip + queue layout consistent across the listed documents.
2. Dense forms use required-first sections without removing existing fields or document-output data.
3. **All four payment-term routes complete:** credit, 100% advance, part advance + balance, goods in transit.
4. IRN & EWB manual capture, task gating, audit history, validation complete.
5. Physical dispatch creates exactly one stock debit; Treasury records actual cash only when payment confirmed.
6. Acceptance scenarios verified in a clean test tenant with screenshots/evidence.

### 10.3 Recommended automated tests (new)

Add `backend/src/services/__tests__/workflow-closure.test.ts` (vitest is already a devDependency) covering, against a mocked `dynamodb.js`:

1. `openTask` idempotency — same stage twice → `created:false`, no duplicate email flag.
2. Payment-term routing — `advancePct > 0 → create_proforma` else `create_invoice` (exactly one).
3. `assertPaymentConditionForInvoice` — throws for `advance_required` below threshold; passes at threshold; `full_required` requires 100%.
4. `normalizeIrn` — rejects 63/65 chars, non-hex; accepts 64-char hex.
5. Dispatch confirm gate — `finalInvoiceId` without `ready_for_dispatch` → blocked with EWB hint.
6. `markStockDebited` — second call returns `null` (no double debit); `debitSalesOrder` creates exactly N movements for N lines.
7. `recordPayment` — partial → `partially_paid`, full → `paid` + `paidDate`; never exceeds `netReceivable`.
8. Inventory/cash matrix — assert zero movements for SO/proforma/invoice creation; credit only on GRN confirm; debit only on dispatched.

### 10.4 Manual test-tenant script (evidence for DoD #6)

1. Seed: catalogue SKU, customer + approved terms for all 4 types, warehouse location with stock.
2. Run each scenario end-to-end per §10.1; capture screenshots at: acceptance toast, Finance queue task, IRN modal, dispatch auto-creation, EWB modal, dispatch confirm block (IRN/EWB missing variants), stock movement row, invoice balance.
3. Repeat-submit test: double-click each primary action + refresh mid-flow; verify queue counts unchanged and single `StockMovement`.

---

## 11. Consolidated implementation plan (suggested order)

**Phase 1 — no-backend UI (fast wins)**
1. `DocumentStatusStrip` + `statusLabel`/`doc-impact` helpers; wire into 7 documents + 4 detail modals.
2. Queue polish: primary-action button, age-in-status column, per-role filter presets.
3. Form simplification: `FormSection` + reorder the 4 forms with reactive mandatory expansion.

**Phase 2 — small backend additions**
4. `irnAttachmentId` + `ewbAttachmentId` fields + upload wiring.
5. Invoice-quantity validation on dispatch lines (`finalInvoiceId` branch).
6. Advance-gate re-check at dispatch confirm (reuse `assertPaymentConditionForInvoice`).
7. IRN-clear timeline entry; mode-based transport requirements; configurable vehicle format.
8. `DomainEvent` model + the 15 emit points (§9.2 table).

**Phase 3 — hardening & tests**
9. Optional: `taskRef` uniqueness attribute + conditional put.
10. Automated test suite (§10.3); manual tenant run + evidence pack (§10.4).

**Compliance notes:** role permissions and the tenant's existing approval policy are untouched throughout; no historical records are migrated or rewritten; Tally/government integration stays out — manual capture with hooks left clean for the future integration.

---

## Appendix A — Key files touched (reference)

| Area | Files |
|---|---|
| Status strip | `frontend/src/components/document-status-strip.tsx` (new), `lib/doc-impact.ts` (new), `components/document-view.tsx`, `routes/app.{sales-orders,purchase-orders,proformas,invoices,purchases,grn,dispatches}.tsx` |
| Queue | `routes/app.tasks.tsx`, 4 `*-workbench.tsx`, `app.checker.tsx` |
| Forms | `components/dialog/FormSection.tsx` (new), `routes/app.{sales-orders,purchase-orders,dispatches,invoices}.tsx`, `components/dispatch-workflow.tsx` |
| Backend gates | `routes/index.ts` (IRN/EWB/dispatch-confirm/payment handlers), `models/invoice.ts`, `models/goods-dispatch.ts`, `models/workflow-task.ts` |
| Events | `models/domain-event.ts` (new), emit points in `routes/index.ts`, `workflow-reminders.ts` |
| Tests | `backend/src/services/__tests__/workflow-closure.test.ts` (new) |

## Appendix B — Verbatim constraint reminders (from the PDF)

- "Use colour as a secondary cue only. The text label and next-action statement must always be present."
- "Never hide a mandatory field. If an optional field becomes mandatory … expand its section and show the reason."
- "Every transition must create exactly one next task … Reprocessing the same transition must not create duplicate tasks, duplicate notifications or duplicate stock movements."
- "A Sales Order alone never debits inventory."
- "Do not debit inventory yet" (dispatch preparation) — "Inventory changes only when Warehouse confirms physical dispatch."
- "Validate exactly 64 alphanumeric characters. Do not generate a placeholder automatically." (IRN)
- "The compliance timeline must show who entered or changed the number. A correction must retain the previous value in audit history."
- "Keep integration hooks separate from the current manual workflow." (future Tally)
- "Overdue expected receipts remain projected until Treasury records them."
