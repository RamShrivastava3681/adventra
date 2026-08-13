# Adventra Goods Platform — Complete Workflow Implementation Guide

> **Purpose of this document:** A self-contained, copy-paste-ready specification that explains how
> Adventra implements the complete goods/inventory lifecycle so you can reproduce the **exact**
> features in your other platform. It covers: **Product Catalogue → Purchase Order → Proforma →
> Purchase Invoice → GRN → Quotation → Sales Order → Dispatch → Sales Invoice → Inventory →
> Demand Forecasting**.
>
> You already have **Suppliers, Debtors, Invoices and Proformas**. This document tells you what to
> build on top of them, and exactly how the existing modules plug into the new ones.

---

## 0. The ONE rule that ties everything together

> **"A document never touches stock — only a *confirmed* goods document does."**

- **Purchase side:** A Purchase Order, a supplier Proforma, and a Purchase Invoice **never create
  inventory**. Only a **confirmed GRN (Goods Received Note)** creates the stock-in movements.
- **Sales side:** A Quotation, a Sales Order, and a Sales Invoice **never reduce inventory**. Only a
  **confirmed Dispatch note** creates the stock-out movements.
- **Inventory is derived, never stored as a single number:** live stock for any SKU =
  `Σ(confirmed stock-in movements) − Σ(confirmed stock-out movements)`. Draft/cancelled movements
  never count.
- This rule is repeated everywhere in the UI as user-facing text, so the user always understands
  why placing an order doesn't change stock.

### Document → stock mapping (memorize this table)

| Document | Stock effect | When |
|---|---|---|
| Purchase Order (PO) | None | — |
| Supplier proforma (purchase) | None | — |
| Purchase Invoice (PI) | None | — |
| **GRN** | **Stock IN** (accepted qty) | On **Confirm** only |
| Quotation | None | — |
| Sales Order (SO) | None | — |
| **Dispatch note** | **Stock OUT** (dispatched qty) | On **Confirm** only |
| Return (customer) | Stock IN (returned qty) | On **Record Return** |
| Manual movement | Stock IN/OUT | On **Confirm** only |

---

## 1. Foundational entities (assumed present, but listed for the exact field contracts)

### 1.1 Product Catalogue (the master data every document depends on)

Every order, quote, GRN, dispatch, invoice and forecast references **catalogue products**. Line
items are **snapshots** of the product (SKU, name, unit) at the time the document is created —
deleting a product never corrupts old documents.

**Fields:**
- Identity: `sku` (auto `SKU-XXXXXXXX` if blank), `name`, `description`, `barcode` +
  `barcodeType` (EAN-13/UPC-A/QR), `category`, `subcategory`, `brand`, `gender`, `size`, `color`,
  `model`, `season`, `imageUrl`
- Pricing: `unitPrice` (selling), `unitCost` (purchase), `mrp` (max retail price),
  `minimumGrossMarginPercentage` (decimal 0.01–0.99; `null` = inherit catalogue default),
  `gstRate` (0/5/12/18/28)
- Logistics: `unitOfMeasure` (piece/pair/carton/box/dozen/kg…), `unitsPerCarton`,
  `reorderLevel`, `maxStock`, `leadTimeDays` (default 30), `safetyStockDays` (default 30),
  `supplierId`, `supplierProductCode`, `minimumOrderQuantity`, `orderMultiple`, `hsnCode`
- Status: `active` / `inactive` (only `active` products appear in order/quote pickers)

**Catalogue settings:** one per account — `defaultMinimumMargin` (decimal, e.g. `0.40` = 40%).
Products without their own margin inherit it. Changing it re-baselines older products that still
carry the old hardcoded `0.4`.

**Delete = cascade:** deleting a product also deletes its inventory movements and forecast
snapshots (documents keep their snapshots).

**UI extras:** stock badge per product (green/amber/red vs `reorderLevel`), default-margin editor,
product thumbnails via signed S3 URLs.

### 1.2 Supplier / Vendor (you have these)

Suppliers exist in two models that are **merged in every dropdown** (procurement pages, PO page,
purchase proforma, purchase invoice): the visible **Supplier** model (`companyName`,
`contactName`, `contactEmail`, `contactPhone`, `addressLine`, `paymentTermsDays`) and the legacy
**Vendor** model (`name`). All procurement UI queries both and merges.

### 1.3 Debtor = Customer (you have these)

Used as the customer master for Quotations, Sales Orders, Sales Invoices. Picking a debtor
auto-fills contact person, billing/delivery address, and due-date term (paymentTermsDays, default
30 net).

---

## 2. Procurement (purchase) flow — end to end

```
Supplier proforma ──► Purchase Order ──► Purchase Invoice ──► GRN ──► Stock IN
     (quotation)          (commit)          (payable)        (receipt)   (inventory)
```

### 2.1 Purchase Proforma (supplier quotation) — `side = "purchase"`

You already have the proforma engine. The goods upgrade adds **catalogue lines** and **convert to
PO**:

- Header: `proformaNumber` (required, e.g. `PF-2026-001`), `proformaDate`, `vendorId` (supplier),
  `supplierContact`, `supplierGstin`, `validUntil`, `currency` (USD/INR/EUR/GBP/AED),
  `paymentTerms` (Net 15/30/60, Advance, COD, LC), `expectedDeliveryDate`, `poNumber` (auto-set to
  `PF-<number>` when blank), `freight`, `notes`, attachments
- Lines: `productId`, `sku`, `name`, `unit`, `quantity`, `unitPrice` (defaults to product
  `unitCost`), `gstRate`
- Totals: `subtotal = Σ(qty × price)`, `gstTotal`, `freight`, `grandTotal`
- **Lifecycle (document status):** `received → reviewed → converted_to_po → expired | cancelled`
  (both sides share this)
- **Funding status (checker/treasury pipeline):** `pending_review → approved → funded | rejected`
- Created already in `pending_review`. Convert to PO is **gated on checker approval**
  (`proformaStatus === "approved"`) — enforced server-side too.
- Advance: `advancePct` (optional % of the proforma total) feeds the funding pipeline.

### 2.2 Purchase Order (goods PO) — the commitment

Created from the catalogue; may optionally create a proforma or purchase invoice in the **same
modal** (radio pick: "Save PO only" / "Purchase proforma" / "Purchase invoice" — mutually
exclusive).

**Header:** system `poNumber` (`PO-XXXXXXXX`), `poDate`, `supplierId` (+ denormalized
`supplierName`), `warehouse` (free text — no warehouse master), `expectedDeliveryDate`,
`paymentTerms`, `buyerName` (defaults to current user), `notes`, `documents`, `freight`.

**Lines:** `productId`, `sku`, `name`, `unit`, `orderedQty` (> 0), `unitPrice` (≥ 0; last-price
memory auto-suggests the most recent PO/GRN price for the product), `gstRate`,
`receivedQty` (system-maintained from GRNs), `lineTotal = orderedQty × unitPrice`.

**Totals:** `subtotal`, `gstTotal`, `freight`, `grandTotal`.

**Status machine:**
```
draft → approved → sent → (partially_received) → fully_received
          └────────────────────────┘ cancelled
```
- `draft`/`approved`/`sent`/`cancelled` are **manual**; `partially_received`/`fully_received` are
  **derived** from GRNs (`recomputeStatus`). Manual status is stored separately
  (`manualStatus`) so revoking all receipts falls back cleanly.
- **Approve** (admin/checker only), **Mark sent**, **Cancel** are explicit actions.
- A PO is **editable only while draft/approved**. Lines that already have `receivedQty` cannot be
  removed or reduced below the received amount.
- **Invariants:** `recordReceipt` rejects cancelled POs, drafts ("Approve and send the PO before
  receiving goods"), and fully-received POs.

### 2.3 Purchase Invoice (supplier payable) — `PurchaseInvoice`

**Never touches stock.** Records what you owe the supplier. Lines are snapshotted **from the
linked PO** (product, name, unit, PO unit price) but the **billed qty and price** are editable
from the supplier's actual invoice.

**Header:** `vendorId` (+ `supplierName`), `invoiceNumber` (required, **unique per supplier** —
cancelled excluded), `issueDate`, `receivedDate`, `dueDate` (auto from supplier payment terms),
`freight`, `notes`, `documents`, `goodsPurchaseOrderId` (MANDATORY — no PO = no invoice),
`poNumber` reference, optional `linkedSupplierProformaId`.

**Lines:** `orderedQty` (from PO), `grnReceivedQty` (back-filled when a GRN links — see below),
`invoiceQty` (> 0), `unitPrice` (≥ 0), `poUnitPrice` (snapshot), `gstRate`, `lineTotal`.

**Difference checks (warn-only, surfaced prominently):**
- **Qty vs GRN:** `|invoiceQty − grnReceivedQty| > 0` → "qty ≠ GRN"
- **Price vs PO:** `|unitPrice − poUnitPrice| > 0` → "price ≠ PO"
- A free-text `differenceNotes` field is encouraged before approval.

**Advance deduction (purchase side):** if a supplier proforma is linked (formal id or matching
PO/proforma number), the **larger of** (a) advances actually paid against it, and (b) the
proforma's agreed `advancePct × proformaTotal`, is deducted:
`netPayable = grandTotal − advanceDeducted` (never negative). The `amount` field stored is the
**net payable** — what the funding pipeline reads.

**Status machine:**
```
draft → verified → approved_for_payment → partially_paid → paid
   └─────────────┘ cancelled (also from verified)
```
- **Review** = draft → verified (maker). Checker approves for payment. Treasury records payments
  (`amountPaid`), which auto-derives `partially_paid`/`paid` + `paidDate`.
- Payment fully reversed ⇒ back to `approved_for_payment`.

**GRN link (later):** when a GRN is created for the same PO and linked to this invoice, the
backend back-fills `linkedGoodsReceiptId/Number` and each line's `grnReceivedQty`; cancelling the
GRN detaches and clears those quantities.

### 2.4 GRN (Goods Received Note) — the ONLY stock-in document

Created **against a PO** when goods actually arrive. Captures:
- Header: `receiptNumber` (`GRN-XXXXXXXX`), `goodsPurchaseOrderId` (mandatory), `poNumber`,
  `supplierName`, `warehouse`, `receivedDate`, `challanNumber` (supplier delivery challan),
  `receivedBy` (attributed), `notes`, delivery-challan/photos attachments
- Lines per PO line: `orderedQty` (snapshot), `receivedQty`, **`acceptedQty`** (what enters
  stock), **`rejectedQty`** (damaged/defective), `unitCost` (values the stock-in), `gstRate`,
  `lineValue = acceptedQty × unitCost`, notes. Barcode scan support speeds entry.
- Optional `purchaseInvoiceId` link (the invoice that bills this receipt).

**Lifecycle:** `draft → confirmed → cancelled` (legacy `received` = already credited, treated as
confirmed).

**Confirm (the money step) — idempotent + race-safe:**
1. Re-validate against the **live PO** (`assertPOReceivable`: not draft/cancelled/fully received;
   received qty must not exceed the pending qty unless the actor is admin/checker with an explicit
   "allow over-receipt" override).
2. Atomic `flipToConfirmed` (conditional update `status = 'draft'`) — exactly one concurrent
   confirm wins.
3. **Create confirmed stock-IN movements** for the accepted qty of each line, linked to the GRN,
   reason "Goods receipt".
4. Fold `acceptedQty` into the PO line's `receivedQty` and recompute the PO status.
5. Sync the linked purchase invoice (back-fill `grnReceivedQty`).
6. Recompute forecasts (async).

**Cancel:** if stock was already credited, reversing **stock-OUT** movements are created and the
PO received qty is revoked (`revokeReceipt`). The linked purchase invoice is detached.

---

## 3. Sales flow — end to end

```
Quotation ──► Sales Order ──► Dispatch ──► Sales Invoice ──► NOA / Reminders / Payment
 (offer)      (commit)       (stock OUT)   (billing)       (collections)
```

### 3.1 Quotation — the offer (never touches inventory or accounting)

**Header:** `quotationNumber` (`QT-XXXXXXXX`), `quotationDate`, `validUntil`, `customerId` (debtor)
**or** free-text `prospectName`, `contactPerson` (auto-filled), `billingAddress`, `deliveryAddress`,
`salespersonName` (auto "You"), `paymentTerms`, `expectedDeliveryDate`, `notes`, attachments.

**Lines:** `productId`, `sku`, `name`, `unit`, `quantity`, `unitPrice` (original offered price),
**`updatedUnitPrice`** (maker's revised price — requires checker approval), `discountType`
(`pct` | `amount` | none), `discountValue`, `gstRate`, `notes`. Effective price = `updatedUnitPrice`
when set, else `unitPrice`.

**Totals:** `subtotal`, `totalDiscount`, `gstTotal`, `freight`, `grandTotal`.

**Two parallel status dimensions:**

1. **Lifecycle:** `draft → sent → accepted | rejected | expired → converted_to_so`
   - "Send to customer" marks `sent` **and emails the quotation PDF** to the debtor.
2. **Maker–checker price approval:** `pending_review → approved | rejected` (shown as a second
   pill). Submit → checker reviews → approve/reject with comments. A rejected quote reopens lines
   for revision and resubmission.
3. **Debtor approval (optional):** "Send to debtor" emails the PDF with a one-time secure token
   link; the customer clicks **Approve/Reject** on a public page (no login). Status pills:
   `pending → approved | rejected`, with their comments stored back.

**Convert to SO:** only when `approvalStatus === "approved"` and status is `sent`/`accepted`.
Converts lines (using the approved effective price; `amount` discounts converted to `discountPct`
on the SO), links by id + number, marks `converted_to_so`. **No stock impact.**

### 3.2 Sales Order (goods SO) — the confirmed order

**Header:** `soNumber` (`SO-XXXXXXXX`), `orderDate`, `customerId` + `customerName`, `contactPerson`,
`billingAddress`, `deliveryAddress`, `salespersonId/Name`, optional `linkedQuotationId` +
`linkedQuotationNumber` (pick from open quotations → auto-fills), `paymentTerms`,
`expectedDispatchDate`, `expectedDeliveryDate`, `notes`, attachments.

**Lines:** `productId`, `sku`, `name`, `unit`, `orderedQty` (> 0), `unitPrice` (≥ 0, defaults to
product `unitPrice`), `discountPct` (0–100, GST applies to the discounted value),
`gstRate`, `dispatchedQty` (system-maintained from dispatches), `lineTotal =
orderedQty × unitPrice × (1 − discountPct/100)`, notes.

**Status machine:**
```
draft → confirmed → (partially_dispatched) → fully_dispatched
   └──────────────────────────────┘ cancelled
```
- Same manual-vs-derived pattern as the PO: `partially/fully_dispatched` come from dispatch
  notes; `manualStatus` is the fallback.
- **Debtor approval:** same emailed-PDF secure-token flow as quotations (`pending → approved |
  rejected`).
- Editable only while draft/confirmed. Lines with dispatched qty are protected.
- `recordDispatch` guards: no dispatch on cancelled, draft ("Confirm the sales order before
  dispatching goods"), or fully-dispatched SOs.

### 3.3 Dispatch note — the ONLY stock-out document

"The most important stock document on the sales side." Created **against a confirmed SO** (with a
live available-stock check shown per line before dispatch).

**Header:** `dispatchNumber` (`DSP-XXXXXXXX`), `goodsSalesOrderId` (mandatory), `soNumber`,
`customerName`, `contactPerson`, `deliveryAddress`, `warehouse`, `dispatchDate`, `transporterName`,
`trackingNumber` (AWB), `deliveryChallanNumber`, `linkedCustomerProformaId/Number` (optional),
`linkedSalesInvoiceId/Number` (optional), `dispatchedBy` (attributed), notes.

**Lines:** `orderedQty` (snapshot), `dispatchedQty` (> 0, not exceeding pending),
`deliveredQty` / `returnedQty` (system-maintained), `unitPrice` + `discountPct` (snapshot from
SO), `gstRate`, `lineValue = dispatchedQty × unitPrice × (1 − discountPct/100)`, notes.

**Lifecycle:**
```
draft → confirmed → partially_delivered → delivered
                    └────────────► returned (from any confirmed/delivered state)
   └──────────────────────────────────────┘ cancelled
```

**Confirm (the money step) — idempotent + race-safe:**
1. Re-validate vs the **live SO** (`assertSODispatchable` + qty vs pending).
2. **Soft stock check:** warn (don't block) when dispatched qty exceeds live available stock.
3. Atomic `flipToConfirmed` → **create confirmed stock-OUT movements** linked to the dispatch,
   reason "Dispatch".
4. Fold `dispatchedQty` into the SO and recompute its status.

**Mark delivered:** per-line delivered qty accumulated, `deliveryDate` recorded, status derives
`partially_delivered`/`delivered`. **No stock impact** (already debited).

**Record return:** per-line returned qty accumulated (blank lines = full return); **credits stock
back IN** (reason "Customer return") and **revokes the SO's dispatched qty** so the SO can be
re-dispatched. Dispatch closes as `returned`.

**Cancel:** reversing **stock-IN** movements created if stock was already debited; SO quantities
revoked.

### 3.4 Sales Invoice — billing after dispatch

**Never reduces stock** (only a confirmed dispatch does). Every invoice **must link to a
confirmed sales order** — the customer and every line are validated against it (line products must
be on the SO; qty ≤ ordered qty; customer must match).

**Create-from-SO UX:** pick the SO → auto-fills debtor, addresses, terms, due date, and the lines
(ordered qty, unit price, discount, GST). Lines remain editable within SO bounds.

**Header:** `invoiceNumber` (auto `INV-XXXXXXXX`), `issueDate`, `dueDate` (auto from debtor's
`paymentTermsDays`), `debtorId`, `customerContact`, `billingAddress`, `deliveryAddress`,
`goodsSalesOrderId` (+ `Number`), `paymentTerms`, `poNumber/poDate/poAmount` (optional reference),
`notes`, attachments.

**Lines:** `productId`, `sku`, `name`, `unit`, `quantity`, `unitPrice`, `discountPct`, `gstRate`,
`lineTotal`.

**Totals:** `subtotalGoods`, `totalDiscount`, `gstTotal`, `freight`, `grandTotal` (what prints).

**Advance deduction (sales side):** linked customer proforma (formal id or unique PO-number
match) → deduct the **larger of** advances received against it and its agreed advance %.
`netReceivable = grandTotal − advanceDeducted`; `amount` stored = the net receivable (what the
customer owes / what funding reads). UI shows "Less advance" line, advance history lookup by PO
number, and live balance.

**Status machine (you have the funding pipeline):**
```
draft → pending (Issued) → approved → funded → advanced → paid / partially_paid
   └────────────────────────────────────────────┘ cancelled | rejected | disputed
```
- **Review** (draft → issued) requires the SO link + confirmed SO.
- **NOA:** send Notice of Assignment email with the invoice PDF + secure token; tracked in the
  reminder log; `noaStatus: not_sent → sent → accepted | rejected | commented`.
- **Payments** (treasury/admin): `recordPayment` accumulates `amountReceived`, derives
  `partially_paid`/`paid`, records `paidDate` + `lateDays`.
- **Reminders:** instant check on create/update when due-date is near/past; daily cron sends
  overdue reminders (once per day — `lastOverdueReminderDate`); admin can send manually.
- Paid/cancelled invoices are **frozen** for content edits.

---

## 4. Inventory (stock movements) — the ledger

**Atomic records**, one row per stock in/out event:

- Fields: `movementNumber` (`MOV-XXXXXXXX`), `productId`, `direction` (`in`=Credit / `out`=Debit),
  `itemName`, `sku`, `unit` (all snapshotted **from the catalogue**, never typed), `quantity`,
  `unitCost`, `warehouse`, `reason`, `linkedDocumentType` + `linkedDocumentNumber`, `status`
  (`draft | confirmed | cancelled`), attribution (`createdBy`, `confirmedBy`, `cancelledBy`,
  timestamps), `movementDate`, and source-document link ids (`goodsReceiptId`, `goodsDispatchId`,
  `invoiceId`, `purchaseInvoiceId`, `purchaseOrderId`, `salesOrderId`).

**The core invariant:** `liveStock = Σ confirmed("in") − Σ confirmed("out")`. Drafts and
cancelled entries never count.

**Manual entries** (reasons): Opening stock (in), Stock adjustment (in), Damage (out), Samples /
internal use (out), Customer return (in), Supplier return (out). Manual entries require a
product, a reason, and notes; they start as **drafts** and only affect stock once **confirmed**.
Save-draft / Save-&-confirm buttons.

**System-created movements** (from confirmed GRNs / dispatches / returns) are **immutable** — the
UI hides edit/confirm/cancel/delete for them ("manage it from the GRN, invoice or dispatch
instead"). Manual drafts can be edited/confirmed/cancelled/deleted; confirmed manual entries can
be edited/cancelled but not deleted.

**Cancel semantics (important):** cancelling a confirmed movement does **not** create a reversal
entry — the movement simply drops out of the live balance (a cancelled +100 credit leaves the
balance at 0, not −100).

**Live stock table** groups by SKU: `item, sku, in stock, unit, inventory value
(qty × unitCost)`, with product thumbnails and negative balances highlighted red. Movement ledger
lists every row with direction badges (Credit green / Debit amber), status badges, and linked-doc
references. Barcode/SKU scanning in the movement form.

---

## 5. Demand forecasting

Runs **the same engine on the server and the client** (shared code), driven by **confirmed
stock-out movements** (12 trailing months) + live confirmed stock.

**Engine pipeline per SKU:**
1. **Bucket** outbound movements by calendar month (current partial month included).
2. **Availability correction:** when a month had stockouts, scale demand up
   (`corrected = actual / max(availabilityRate, 0.7)`, capped at `actual × 1.4`).
3. **Weighted baseline:** 12-month weighted average — newest 3 months ×3, middle 3 ×2, oldest 6 ×1.
4. **Trend:** ordinary-least-squares slope with R² strength (`direction: up|down|stable`).
5. **Seasonality:** raw per-calendar-month factor (monthAvg / overallAvg), clamped 0.5–2.0.
6. **Forecast horizon:** 6 months of `baseline × trend × seasonality × factors`, clamped 0.7–1.5×,
   with 80% prediction intervals; per month: daily rate, stock required, projected stock after,
   suggested order.
7. **Live pace adjustment (next month):** `expectedToDate = baseForecast × daysElapsed/daysInMonth`;
   `salesPaceRatio = actual/expected`; `factor = clamp(1 + 0.3×(ratio−1), 0.80, 1.20)` (disabled
   before day 7 or when expected is 0). Display-only.
8. **Days of cover:** `stock ÷ (last-3-months demand / their calendar days)`.
9. **Reorder recommendation:**
   `requiredStock = dailyAvg × (leadTimeDays + safetyStockDays)`;
   `recommended = max(0, requiredStock − inventoryPosition)`, then capped by maxCoverDays,
   raised to minimumOrderQty, rounded up to orderMultiple.
10. **Timeline:** `estimatedStockoutDate` (today + daysOfCover), `reorderByDate`
    (stockout date − lead time), `nextRefillDate` (today + lead time),
    `stockoutUrgency: critical | warning | safe`.
11. **Momentum tag:** `accelerating | stable | declining | inactive` (recent 3-mo avg vs 120%/60%
    of overall avg).
12. **Velocity tag (category-relative):** no sales in 3 months → `dead`; top 20% of category →
    `fast_mover`; next 30% → `medium_mover`; rest → `slow_mover`.
13. **Pricing strategy (recommendation only, never auto-applied):** rule table over
    velocity/momentum/stock position → price-change % (e.g. dead+high stock → −25% clearance,
    fast+accelerating+low → +5% protect margin). Floor price = `unitCost ÷ (1 − minGrossMargin)`.

**Server side:** `recomputeAll(clientId)` recomputes every active product and persists a
`ForecastVariable` snapshot per product (JSON + key fields for fast queries; non-finite numbers
persisted as null so one quiet SKU can't crash the batch). Recompute triggers on: stock-movement
create/update/confirm/cancel/delete, GRN confirm, dispatch confirm/return, product delete, and a
daily "ensure fresh" check. Snapshot de-dup (last writer wins).

**UI:** summary tiles (to-reorder count/qty/value, fast/slow/dead, accelerating/declining, out of
stock, critical), filters (reorder/fast/medium/slow/accelerating/declining/out/critical +
category), sorts, pagination, per-SKU expandable panel with area chart + full calculation
breakdown, CSV export, manual "Recompute" button.

---

## 6. The API surface (exact endpoints)

| Method | Path | Purpose |
|---|---|---|
| GET/POST/PUT/DELETE | `/products`, `/products/:id` | Catalogue CRUD (delete cascades movements + forecasts) |
| GET/PUT | `/catalogue-settings` | Default minimum margin |
| GET/POST/PUT/DELETE | `/stock-movements`, `/:id`, `/:id/confirm`, `/:id/cancel` | Inventory ledger |
| GET/POST | `/goods-purchase-orders`, `/:id` (PUT/DELETE) | Purchase orders |
| GET/POST | `/goods-receipts`, `/:id` (PUT/DELETE), `/:id/confirm`, `/:id/cancel` | GRN lifecycle |
| GET/POST/PUT/DELETE | `/purchase-invoices`, `/:id` | Supplier payables |
| GET/POST/PUT/DELETE | `/purchase-orders`, `/:id`, `/:id/convert-to-so` | Proformas (both sides) + sales conversion |
| GET/POST/PUT/DELETE | `/quotations`, `/:id`, `/:id/convert`, `/:id/send-to-debtor` | Quotations + approval |
| GET/POST/PUT/DELETE | `/goods-sales-orders`, `/:id`, `/:id/send-to-debtor` | Sales orders + approval |
| GET/POST | `/goods-dispatches`, `/:id`, `/:id/confirm`, `/:id/cancel`, `/:id/deliver`, `/:id/return` | Dispatch lifecycle |
| GET/POST/PUT/DELETE | `/invoices`, `/:id`, `/:id/issue`, `/:id/payment`, `/:id/send-noa`, `/invoices/:id/remind-debtor/:token` | Sales invoices + NOA + reminders |
| GET | `/approvals/:token`, POST `/approvals/:token/respond` | Public debtor approve/reject pages |
| GET | `/forecast-variables` (list), POST `/forecast-variables/recompute` | Forecast snapshots |

---

## 7. Roles & maker–checker gates (exact permission model)

| Role | Write access |
|---|---|
| Client (maker) | Create/edit drafts, submit for review, mark PO sent, record receipts/dispatches drafts, convert (after approval) |
| Checker | Approve/reject: quotations (prices), proformas (funding), POs (approve), invoices (approve/reject/dispute); allow over-receipt/over-dispatch |
| Treasury/Admin | Record payments on sales + purchase invoices, fund proformas |
| Sales rep | **Read-only** on POs/SOs/dispatches (can write quotations only) |
| Admin | Everything |

**Gates enforced server-side, not just in the UI:**
- Quotation → SO conversion requires `approvalStatus === "approved"`.
- Proforma → PO/SO conversion requires `proformaStatus === "approved"`.
- Sales invoice issue requires a **confirmed** SO.
- Purchase invoice creation requires an **approved & sent** PO.
- GRN confirm requires a **sent/partially-received** PO; dispatch confirm requires a
  **confirmed/partially-dispatched** SO.
- Over-quantity receipts/dispatches require admin/checker + explicit flag.

---

## 8. Cross-cutting invariants & edge cases to implement exactly

1. **Documents are snapshots, not live links** — line items copy SKU/name/unit/price; later
   catalogue edits never alter old documents.
2. **Statuses are dual-track where two approvals exist** (quotation: lifecycle + price approval +
   debtor approval; proforma: document lifecycle + funding status) — render as multiple pills.
3. **Derived statuses** (partially/fully received & dispatched, delivered) are recomputed, never
   manually set; manual status kept separately for clean fallback.
4. **Concurrency:** confirm/cancel use atomic conditional updates (`status = 'draft'` guard) so
   double-clicks/double-requests can't double-credit/debit stock. A null result means
   "already confirmed" — credit nothing.
5. **Cancellation always reverses its own effect:** GRN cancel → stock-out reversals + PO revoke;
   dispatch cancel → stock-in reversals + SO revoke; return → stock-in + SO revoke; cancelled
   movements drop out of the balance.
6. **IDEMPOTENT emails:** "Send to customer/debtor" marks sent AND emails; failure of the email
   never rolls back the status (warning shown, retry allowed). No duplicate emails from
   double-clicks (busy guards).
7. **Advance deduction is computed server-side** from recorded advances (never trusted from the
   client) and uses `max(paid, agreedPct)` on both sales and purchase sides.
8. **Duplicate detection:** purchase-invoice numbers are unique per supplier (cancelled excluded).
9. **Numbers:** money rounded to 2dp everywhere; quantities support 3dp; GST % capped 0–100
   (0/5/12/18/28 presets); discount % capped 0–100.
10. **Audit trail:** every workflow action (`po.*`, `grn.confirmed`, `dispatch.confirmed`,
    `invoice.*`, `stock.*`, …) is written to an immutable audit log with actor, action, target,
    and detail — fire-and-forget.
11. **Forecast recompute** is triggered asynchronously after every stock-affecting event and is
    failure-isolated per SKU.

---

## 9. Suggested build order for your platform

1. **Product Catalogue** (+ catalogue settings, margin floor) — everything references it.
2. **Inventory ledger** (stock movements, confirm/cancel semantics, live balances).
3. **Purchase Order + GRN** (learn the "document never touches stock, GRN credits" pattern).
4. **Purchase Invoice** (link to PO, difference checks, advance deduction, payment lifecycle).
5. **Sales Order + Dispatch** (mirror of PO+GRN on the sales side; add deliver/return).
6. **Quotation** (dual approval + debtor email approval) → convert to SO.
7. **Sales Invoice** (link to SO, NOA, payments, reminders) — you already have the funding
   pipeline; just bolt on the SO link and advance deduction.
8. **Wire proformas both ways** (purchase proforma → PO; sales proforma → SO).
9. **Demand forecasting** (shared engine, server persistence, recompute triggers, UI).

Every module above was extracted directly from the working Adventra implementation, so following
this document reproduces the exact behavior — including the subtle bits like dual statuses,
race-safe confirmations, and derived stock.
