# Adventra Platform — End-to-End Workflow Document
### Product → Supplier → Purchase Order → Purchase Proforma → Purchase Invoice → GRN → Customer → Sales Order → Sales Proforma → Sales Invoice → IRN → Dispatch → E-Way Bill → Warehouse → Finance

> Source: extracted from live implementation (`backend/src/models/*` + `frontend/src/routes/app.*.tsx` + `COMPLETE-WORKFLOW-GUIDE.md`).
> Rule that governs everything: **A document never touches stock — only a confirmed goods document does.**
> - Purchase side: PO / Proforma / Purchase Invoice = NO stock. Only **confirmed GRN** = Stock IN.
> - Sales side: Quotation / SO / Sales Invoice = NO stock. Only **confirmed Dispatch (shippingStatus=dispatched)** = Stock OUT.
> - Live stock = Σ confirmed IN − Σ confirmed OUT. Draft/cancelled never count. Money rounded 2dp, qty 3dp, GST 0/5/12/18/28, discount 0–100%.

---
## 0. Global navigation / where each step lives

> **Corrected order (as used in production): Proforma is created AFTER PO / SO, linked to it.**
> - Purchase: `PO → Purchase Proforma (from PO, for advance) → Purchase Invoice → GRN`
> - Sales: `SO → Sales Proforma (from SO, for advance) → Sales Invoice → IRN → Dispatch → EWB`
> - Quotation (if used) is the only doc BEFORE SO/PO — it is an offer. Proforma is never a quotation; it is raised after the order to claim advance/part-payment.

### 0A. End-to-end workflow master table

| Seq | Stage | Document / Master | Created AFTER (linked to) | Page | Entry precondition | Exit → Next step | Stock effect | Key statuses |
|---|---|---|---|---|---|---|---|---|
| 1 | Master | **Product** | — (first) | `/app/products` | Name + SKU | Active product → usable in PO/SO | None | `active / inactive` |
| 2 | Master | **Supplier** | — (needs Product for link) | `/app/suppliers` | companyName | Active supplier → usable in PO | None | `prospect / active / suspended / offboarded` |
| 3 | Purchase | **Purchase Order (Goods PO)** | Supplier + Product | `/app/purchase-orders` | Supplier + ≥1 product line | `sent` → Proforma + Invoice + GRN | None | `draft → pending_review → approved → sent → partially/fully_received / cancelled` |
| 4 | Purchase | **Purchase Proforma (advance claim)** | **AFTER PO** (`linkedGoodsPoId`) | `/app/proformas` → Purchase | Sent PO | `approved → funded` → advance deducted in PI | None | doc `received → reviewed → converted / expired / cancelled` + funding `pending_review → approved → funded / rejected` |
| 5 | Purchase | **Purchase Invoice (payable)** | **AFTER PO** (`goodsPurchaseOrderId*`) + optional Proforma | `/app/purchases` | Approved + sent PO | `approved_for_payment → paid` → GRN links back | None | `draft → verified → approved_for_payment → partially_paid → paid / cancelled` |
| 6 | Purchase | **GRN** | **AFTER PO** (`goodsPurchaseOrderId*`) + optional PI | `/app/grn` | Sent / partially_received PO | `confirmed` → Stock IN, PO received%, PI grnReceivedQty | **Stock IN** (acceptedQty) on Confirm | `draft → confirmed → cancelled` |
| 7 | Master | **Customer (Debtor)** | — (parallel to purchase) | `/app/debtors` | name | Customer → usable in SO | None | no status; `creditLimit + enforce` |
| 8 | Sales | **Sales Order (Goods SO)** | Customer + Product (+ optional Quotation) | `/app/sales-orders` | Customer + ≥1 product line | `confirmed` (+ warehouse + debtor approved) → Proforma + Invoice + Dispatch | None | `draft → warehouse_pending → warehouse_approved → checker_pending → confirmed → partially/fully_dispatched / cancelled` |
| 9 | Sales | **Sales Proforma (advance claim)** | **AFTER SO** (`linkedGoodsSoId`) | `/app/proformas` → Sales | Confirmed SO | `approved → funded` → advance deducted in SI | None | same dual status as purchase |
| 10 | Sales | **Sales Invoice (receivable)** | **AFTER SO** (`goodsSalesOrderId*`) + optional Proforma | `/app/invoices` | Confirmed SO | `pending → approved → funded` + NOA → IRN → Dispatch | None | `draft → pending → approved → funded → advanced → paid / partially_paid / cancelled / rejected / disputed` |
| 11 | Sales | **IRN (e-Invoice)** | AFTER Sales Invoice | Invoice Detail → IRN | Approved/funded invoice | IRN set → Dispatch allowed (from-Invoice mode) | None | `irn set / not set` (64-hex + ackNo + ackDate) |
| 12 | Sales | **Dispatch** | **AFTER SO** (`goodsSalesOrderId*`) + optional Invoice/IRN | `/app/dispatches` | Confirmed / partially_dispatched SO (+ IRN if from Invoice) | `confirmed + shipped (dispatched)` → Stock OUT → delivered / returned | **Stock OUT** on shipped | `draft → details_submitted → ready_for_dispatch → confirmed → partially_delivered → delivered / returned / cancelled` + `shippingStatus picking → delivered` |
| 13 | Sales | **E-Way Bill** | AFTER Dispatch + Invoice | Dispatch Detail → EWB | Generated dispatch + invoice values (≥₹50k) | `generated` + pdfUrl → goods move | None | `pending → generated → vehicle_updated / extended / cancelled / expired / failed` |
| 14 | Ops | **Warehouse + Inventory** | Across SO/Dispatch/GRN | `/app/warehouse`, `/app/inventory` | Pending SO / draft dispatch / draft movement | SO approved/reserved; dispatch shipped; balances verified | IN (GRN/return/manual) / OUT (dispatch/manual) | movement `draft → confirmed → cancelled`; `warehouseStatus pending/approved/on_hold`; `stockStatus pending/reserved/in_transit` |
| 15 | Money | **Finance** | Across PI / SI / Proforma / Dispatch | `/app/finance-workbench` (11 tabs) | Any pending doc | Reviewed → Funded → Paid; journals posted | None (posting only) | funding + treasury + audit |

### 0B. Visual chain (PO/SO → Proforma)

```
PRODUCT ─┬─► SUPPLIER ─► PURCHASE ORDER (sent) ─┬─► PURCHASE PROFORMA (after PO, advance) ─┐
         │                                      │                                         ▼
         │                                      └─► PURCHASE INVOICE (after PO, less advance) ─► GRN (confirmed = STOCK IN)
         │
         └─► CUSTOMER ─► SALES ORDER (confirmed) ─┬─► SALES PROFORMA (after SO, advance) ─┐
                                                 │                                       ▼
                                                 └─► SALES INVOICE (after SO, less advance) ─► IRN ─► DISPATCH (shipped = STOCK OUT) ─► E-WAY BILL
                                                                                                                          ▼
                                                                                                          WAREHOUSE (approve / pick / pack / ship / balances)
                                                                                                                          ▼
                                                                                                          FINANCE (review → fund → pay, journals, cash-flow)
```

| # | Step | Frontend page | Backend API |
|---|---|---|---|
| 1 | Product | `/app/products` | `GET/POST/PUT/DELETE /products`, `/catalogue-settings` |
| 2 | Supplier | `/app/suppliers` (+ Vendors merged) | `/suppliers`, `/vendors` |
| 3 | Purchase Order (Goods PO) | `/app/purchase-orders` | `GET/POST /goods-purchase-orders`, `PUT/DELETE /:id` |
| 4 | Purchase Proforma | `/app/proformas` tab Purchase | `GET/POST/PUT/DELETE /purchase-orders` with `side=purchase` |
| 5 | Purchase Invoice | `/app/purchases` + `/app/finance-purchases` | `/purchase-invoices` |
| 6 | GRN | `/app/grn` | `GET/POST /goods-receipts`, `/:id/confirm`, `/:id/cancel` |
| 7 | Customer (Debtor) | `/app/debtors` | `/debtors` |
| 8 | Sales Order (Goods SO) | `/app/sales-orders` + `/app/finance-sales-orders` | `GET/POST/PUT/DELETE /goods-sales-orders` |
| 9 | Sales Proforma (+ Quotation) | `/app/proformas` tab Sales | `/purchase-orders` with `side=sales`, `/quotations` |
| 10 | Sales Invoice | `/app/invoices` + `/app/finance-invoices` | `/invoices`, `/:id/issue`, `/:id/payment`, `/:id/send-noa` |
| 11 | IRN (e-Invoice) | Invoice Detail → IRN button (Finance role) | `Invoice.recordIrn / clearIrn` |
| 12 | Dispatch | `/app/dispatches` + `/app/finance-dispatches` | `GET/POST /goods-dispatches`, `/:id/confirm|cancel|deliver|return` |
| 13 | E-Way Bill | Dispatch Detail → EWB + `/eway-bills` | `/eway-bills`, NIC GSP integration |
| 14 | Warehouse | `/app/warehouse`, `/app/warehouse-workbench`, `/app/inventory` | `/stock-movements`, `/stock-locations`, SO/dispatch actions |
| 15 | Finance | `/app/finance-workbench` (11 tabs), `/app/accounting`, `/app/cash-flow`, `/app/bulk-payments`, `/app/advances` | `/invoices`, `/purchase-invoices`, `/journals`, `/chart-of-accounts`, `/advances`, `/bulk-payments` |

---
## 1. PRODUCT (Catalogue) — `/app/products`

**Purpose:** Master data every later document snapshots (SKU/name/unit/price). Deleting a product deletes its movements + forecasts; old documents keep snapshots.

**Page structure:** No tabs. `CatalogueToolbar` filters + `ProductsTable` (Master SKU → Colour → Sellable rows, stock badge green/amber/red vs reorderLevel) + `ProductDetailDrawer`.
**Buttons:** View Forecasting, Export, Create Master SKU, View, Add colour/size, Edit prices, Delete/Copy SKU.

### 1.1 Tabs / sections in UI
1. Filters toolbar — `Search (q), Category, Gender, Colour, Size, Status (active/inactive), Sort, Default margin% editor`
2. Products table — columns Master SKU / Colour / Sellable rows, thumbnail (signed S3 URL), stock badge
3. ProductDetailDrawer — `Product Information | Pricing | Channel overrides | Variant Hierarchy`

### 1.2 All fields (Product model)
| Tab/Section | Field | Type / Values | Required | Default / Notes |
|---|---|---|---|---|
| Identity | `sku` | string | Auto if blank | `SKU-XXXXXXXX`, globally unique case-insensitive; variants `PARENT-COLOR-SIZE[-2,-3]` |
| | `name` | string | **Yes** | `clientId+name` required on create |
| | `description` | string/null | No | — |
| | `barcode` | string/null | No | — |
| | `barcodeType` | EAN-13 / UPC-A / QR / null | No | — |
| | `category` | string/null | No | filterable |
| | `subcategory` | string/null | No | — |
| | `brand` | string/null | No | — |
| | `gender` | string/null | No | filterable |
| | `size` | string/null | No | filterable; `sizeSystem` EU/UK/US/Custom |
| | `color` | string/null | No | filterable |
| | `model` | string/null | No | — |
| | `season` | string | No | default `all` |
| | `imageUrl` | string/null (S3) | No | thumbnail |
| | `parentId`, `skuLevel` | parent/color/variant/null | No | variant hierarchy |
| | `categoryMasterId, genderMasterId, colorMasterId, sizeMasterId` | id/null | No | master links |
| Pricing | `unitPrice` (selling) | number | No | default 0; price tiers: MRP, ecommercePrice, retailerPrice, distributorPrice, flexiblePrice |
| | `unitCost` (purchase) | number | No | default 0; values GRN stock-in |
| | `mrp` | number/null | No | max retail price |
| | `minimumGrossMarginPercentage` | 0.01–0.99 / null | No | null = inherit catalogue default; floor = `unitCost/(1-minMargin)` |
| | `gstRate` | 0/5/12/18/28/null | No | preset list |
| Logistics | `unitOfMeasure` | piece/pair/carton/box/dozen/kg… | No | default `piece` |
| | `unitsPerCarton` | number/null | No | — |
| | `reorderLevel` | number | No | default 0; drives badge + forecast |
| | `maxStock` | number | No | default 0 |
| | `leadTimeDays` | number | No | default 30 |
| | `safetyStockDays` | number | No | default 30 |
| | `supplierId` | id/null | No | preferred supplier link |
| | `supplierProductCode` | string/null | No | supplier's code |
| | `minimumOrderQuantity` | number/null | No | forecast rounds up to this |
| | `orderMultiple` | number/null | No | forecast rounds up to multiple |
| | `hsnCode` | string/null | No | GST classification |
| Status | `status` | active / inactive | No | default `active`; only active in pickers |
| Settings | `catalogue-settings.defaultMinimumMargin` | decimal e.g. 0.40 | No | re-baselines products with old 0.4 |
| PriceEditModal only | cost, selling price, MRP, retailer/distributor/e-commerce, GST% | numbers | As shown | quick edit, nothing else |

**Exit criteria:** ≥1 `active` product with unitPrice, unitCost, gstRate, UOM.

---
## 2. SUPPLIER — `/app/suppliers`

**Purpose:** Vendor master for all procurement. UI merges **Supplier** (`companyName…`) + legacy **Vendor** (`name`) in every dropdown.

**Page structure:** No tabs. KPI cards (Total suppliers, Outstanding Payables) + table (Supplier / Contact / Default Payment Term / Outstanding / Open POs / Status) + `SupplierDetailModal`.
**Buttons:** Onboard supplier, View / Edit / Delete.

### 2.1 All fields (Supplier model + Vendor legacy)
| Section | Field | Type / Values | Required | Default |
|---|---|---|---|---|
| Company | `companyName` (Supplier) / `name` (Vendor) | string | **Yes** | code auto `SUP-XXXXXX` / `VEN-XXXXXX` |
| | `industry` | string/null | No | — |
| | `addressLine`, `city`, `country`, `postalCode` | string/null | No | — |
| | `stateCode` | string/null | No | auto from GSTIN first 2 chars |
| | `gstin`, `panCardNo` | string/null | No | GSTIN/PAN |
| | `website` (Vendor only) | string/null | No | — |
| Contact | `contactName`, `contactEmail`, `contactPhone` (+ Vendor `contactDesignation`) | string/null | No | auto-fills PO/Proforma/PI |
| Status | `status` (Supplier only) | prospect / active / suspended / offboarded | No | default `prospect` |
| Payment terms | `paymentTermsDays` | number | No | default 30 (drives PI dueDate) |
| | `paymentTermsType` | credit / advance_full / advance_partial / on_delivery | No | default `credit` |
| | `advancePct` | 1–99 | Only if advance_partial | — |
| Bank | `bankHolder, bankName, bankAcNo, bankIfsc, bankBranch` | string/null | No | payout |
| Other | `notes` | string/null | No | — |

**Exit criteria:** Supplier `active`, GSTIN+PAN captured, paymentTermsDays set.

---
## 3. PURCHASE ORDER (Goods PO) — `/app/purchase-orders`

**Purpose:** Commitment to supplier. **Never touches stock.** Created from catalogue; can co-create proforma/invoice in same modal (radio: Save PO only / Purchase proforma / Purchase invoice — mutually exclusive).

**Page structure:** No tabs. Stat tiles (Open / Commitment / Received / Fully received) + `TransactionFilters` + table (PO / Supplier / Delivery / Qty / Grand total / Received% / Status + supplier-approval) + `POModal` + `GRNModal/GRNsModal`.
**Buttons:** New purchase order, View, Edit (only draft/approved), Download PDF, Approve (admin/checker), Mark sent, Cancel.

### 3.1 Header fields
| Section | Field | Required | Notes |
|---|---|---|---|
| IDs | `poNumber` | Auto | `ADV-<FY>-PO-001` via `nextPoNumber`; `poDate` default today |
| Counterparty | `supplierId` + denormalized `supplierName` | **Yes** | picker merges Supplier+Vendor |
| Logistics | `warehouse` | No | free text (no master) |
| | `expectedDeliveryDate`, `expectedDate`, `dueDate` | No | delivery tracking |
| Commercial | `paymentTerms` (text) + `paymentTermsType` + `advancePct` | No | terms snapshot |
| | `buyerId`, `buyerName` | No | defaults to current user |
| | `freight` | No | added to grandTotal |
| | `notes`, `documents[]` (path,name,type,size,uploaded_at) | No | attachments |
| Garment print block (all optional string/null) | `quotationNo, quotationDate, contactPerson, contactPersonContact, vendorAddress, vendorGstin, vendorPan, vendorState, paymentTermsNote, deliveryNoteDate, dispatchedThrough, destination, packaging, deliveryTime, partialShip, deliveryStandard, notificationClause, cancellationClause, delayClause, otherTerms, deliveryTermsLine, placeOfSupply, buyerAddress, buyerGstin, billToAddress, shipToAddress, billToName, billToContactPerson, billToContact` + `billToDebtorId, billToSupplierId, shipToSupplierId, shipToDebtorId` | No | prints on PO PDF |
| Approval | `status` + `manualStatus` | System | see lifecycle |
| | `supplierApprovalStatus` pending/approved/rejected + `supplierApprovalToken, SentAt, RespondedAt, Comments, Email` | System | emailed supplier approval |
| | `reviewedBy, reviewedAt` | System | checker |

### 3.2 Lines (`GoodsPOLine[]`) — one row per product
`productId*` (picker, active only), `sku` (snapshot), `name` (snapshot), `unit` (snapshot), `color, size, fabric, hsnCode`, `orderedQty*` (>0), `unitPrice*` (≥0; last-price memory suggests most recent PO/GRN price), `gstRate`, `lineTotal = orderedQty×unitPrice` (auto), `receivedQty` (system from GRNs, not editable).

### 3.3 Totals + co-create
`totalQty, subtotal = Σ lineTotal, gstTotal, freight, grandTotal`. Co-create radio: `none | proforma (pfForm: proforma_number/date/supplier/valid_until/currency/advance%) | purchase_invoice (piForm: invoice_number/dates/freight)`.

### 3.4 Lifecycle
`draft → pending_review → approved → sent → (partially_received) → fully_received`, `cancelled` from draft/approved/sent/verified. `partially/fully_received` **derived** via `recomputeStatus` (all receivedQty≥orderedQty → fully; any >0 → partially; else manualStatus). Editable only draft/approved; lines with receivedQty locked. `recordReceipt` blocks cancelled/draft/pending_review/fully_received. Over-receipt needs admin/checker + explicit flag.

**Exit criteria:** PO `sent` (approved + sent). Needed for PI + GRN.

---
## 4. PURCHASE PROFORMA (created AFTER PO — advance claim) — `/app/proformas` → Purchase tab

**Purpose:** Advance/part-payment claim raised **AFTER the PO is sent**, linked to that PO (`linkedGoodsPoId`). **No stock.** Checker approves → Treasury funds → funded amount is deducted from the Purchase Invoice. This is NOT a quotation and does NOT convert to PO in this flow.

**Page structure:** Tabs `All / Sales / Purchase` chips + table (Proforma / PO# / Counterparty / Side / Invoice amount / Advance / Status pills: doc received/reviewed/converted/expired/cancelled + funding draft/pending_review/approved/funded/rejected) + `PurchaseProformaModal` + `ProformaDetailModal`.
**Buttons:** Purchase proforma (New, from PO), View/Edit, Submit to checker, Approve / Fund (checker/treasury), Cancel/Expire.

### 4.1 All fields (`PurchaseOrder` model with `side=purchase`)
| Section | Field | Required | Notes |
|---|---|---|---|
| IDs | `poNumber` | **Yes** | default `PF-XXXXXXXX`; if blank auto `PF-<number>`; `proformaNumber` e.g. `PF-2026-001` |
| | `proformaDate`, `issueDate` | No | — |
| Counterparty | `vendorId` (supplier)*, `supplierContact`, `supplierGstin` | vendorId Yes | picker Supplier+Vendor merged |
| Validity | `validUntil` | No | expiry |
| Commercial | `currency` | No | USD/INR/EUR/GBP/AED, default INR |
| | `paymentTerms` (Net 15/30/60, Advance, COD, LC) + `paymentTermsType` + `advancePct` | No | advancePct feeds funding |
| | `expectedDeliveryDate`, `expectedDate` | No | — |
| | `poAmount`, `amount` | System | invoice amount snapshot |
| Lines (`ProformaLine[]`) | `productId, sku, name, hsnCode, unit, quantity* (>0), unitPrice* (defaults to product unitCost), gstRate, lineTotal=qty×price` | Yes per line | catalogue picker |
| Totals | `subtotal, gstTotal, freight, grandTotal` | System | grandTotal = subtotal+gst+freight |
| Advance ask | `advanceAmount, advanceDueDate, bankDetails, upiDetails, paymentReference, sentAt` | No | advance proforma — what treasury funds |
| Links | `linkedGoodsPoId*` (parent PO — created AFTER PO), `documents[]`, `notes` | PO link Yes | proforma copies PO lines; do NOT create standalone |
| Dual status | `status` (received/reviewed/converted/expired/cancelled) + `proformaStatus` (pending_review/approved/funded/rejected) + `ReviewedAt/By, ReviewComments, FundedAt/By/Amount/Reference` | System | fund needs approved |

**Exit criteria:** `proformaStatus=funded` (approved → funded). Funded amount auto-deducted in Purchase Invoice (`max(paid, advancePct×proformaTotal)`).

---
## 5. PURCHASE INVOICE (Supplier payable) — `/app/purchases`

**Purpose:** What you owe supplier. **Never touches stock.** MUST link a PO (no PO = no invoice). Billed qty/price editable vs PO snapshot; GRN qty back-filled later; warn-only differences; advance deducted server-side.

**Page structure:** No tabs. KPIs (Total / Open payables / Suppliers used) + table (Invoice / Supplier / PO / GRN / Grand total / Due / Status / Linked sales) + `NewPurchaseModal` + `PurchaseDetailModal`.
**Buttons:** Record purchase invoice, View, Edit (draft/verified only), Push to checker (draft→verified), Approve for payment (checker), Record payment (treasury), Cancel.

### 5.1 Header fields
| Section | Field | Required | Notes |
|---|---|---|---|
| Counterparty | `vendorId*` + `supplierName` | **Yes** | Supplier/Vendor picker |
| IDs | `invoiceNumber*` | **Yes** | unique per supplier (cancelled excluded) — supplier's invoice no. |
| | `goodsPurchaseOrderId*` + `goodsPoNumber`, `poNumber, poDate, poAmount` | **Yes (PO link)** | pick approved+sent PO → autofills lines; needs approved & sent PO server-side |
| Dates | `issueDate*`, `receivedDate`, `dueDate` (auto from supplier paymentTermsDays), `expectedDate, agreedPaymentDate, paidDate` | issueDate Yes | — |
| Commercial | `paymentTermsType, advancePct`, `freight`, `notes`, `differenceNotes` (encouraged before approval), `documents[]` | No | — |
| Links | `linkedSupplierProformaId + Number` (advance deduction), `linkedGoodsReceiptId + Number` (back-filled on GRN), `billToSupplierId, billToName, billToContactPerson, billToAddress`, `purchaseOrderId (proforma ref), paymentReference` | No/System | — |
| Money | `subtotal, gstTotal, freight, grandTotal, advanceDeducted, amount (= grandTotal−advanceDeducted, net payable), amountPaid, balanceDue, advanceRate` (def 0.80) | System | amount = what funding reads |
| Reminders | `lastOverdueReminderDate` | System | — |

### 5.2 Lines (`PurchaseInvoiceLine[]`)
`productId, sku, name, unit` (snapshotted from PO), `orderedQty` (PO snap), `grnReceivedQty` (auto after GRN link), `invoiceQty*` (>0, editable), `unitPrice*` (≥0, editable), `poUnitPrice` (snapshot), `gstRate`, `lineTotal = invoiceQty×unitPrice`.

### 5.3 Difference checks (warn-only, prominent)
- Qty vs GRN: `|invoiceQty − grnReceivedQty| > 0` → "qty ≠ GRN"
- Price vs PO: `|unitPrice − poUnitPrice| > 0` → "price ≠ PO"

### 5.4 Advance deduction (purchase)
If supplier proforma linked (id or PO/proforma number match): deduct `max(advances paid, advancePct×proformaTotal)`; `netPayable = grandTotal − advanceDeducted` (never negative); stored `amount` = net payable.

### 5.5 Lifecycle
`draft → verified (Review, maker) → approved_for_payment (checker) → partially_paid → paid (treasury recordPayment accumulates amountPaid; reversal → approved_for_payment)`, `cancelled` from draft/verified. Paid/cancelled frozen. GRN link back-fills `grnReceivedQty`; GRN cancel detaches.

**Exit criteria:** `approved_for_payment` (or paid). GRN can link to it.

---
## 6. GRN (Goods Received Note) — `/app/grn`

**Purpose:** THE ONLY stock-IN document. Created against PO when goods arrive. Confirm credits stock, folds acceptedQty into PO, syncs PI, recomputes forecast.

**Page structure:** No tabs. Stats (Drafts / Confirmed / Units / Stock value) + table (GRN / Supplier / Linked PO / Delivery / Recv-Acc-Rej / Stock value / Status draft/confirmed/cancelled) + `GrnModal`.
**Buttons:** New GRN, View, Edit draft, Confirm (credits stock, idempotent race-safe), Cancel/Reverse (creates reversing stock-out + PO revoke + PI detach), Delete draft.

### 6.1 Header fields
| Field | Required | Notes |
|---|---|---|
| `receiptNumber` | Auto | `GRN-XXXXXXXX` |
| `goodsPurchaseOrderId*` + `poNumber` | **Yes** | pick sent/partially-received PO; guards: not draft/cancelled/fully-received |
| `supplierId, supplierName` | Auto | from PO |
| `receivedDate*` | **Yes** | receipt date |
| `receivingLocationId` | No | default Central; `warehouse` legacy free text also kept |
| `challanNumber` | No | supplier delivery challan |
| `purchaseInvoiceId` (linked PI) | No | optional link for 3-way match |
| `receivedById, receivedBy` | No | attributed (defaults you) |
| `notes`, `documents[]` (challan photos) | No | — |
| `status` draft/confirmed/cancelled (+legacy received=confirmed), `stockCredited`, `creditedAt/By, cancelledAt/By` | System | — |
| `Allow over-receipt` checkbox | Only admin/checker | else received ≤ pending enforced |

### 6.2 Lines (`GoodsReceiptLine[]`, one per PO line + barcode scan `SKU/barcode +1`)
`productId, sku, name, unit` (snap), `orderedQty` (snap), `receivedQty*`, `acceptedQty*` (enters stock), `rejectedQty` (damaged), `unitCost*` (values stock-in), `gstRate`, `lineValue = acceptedQty×unitCost`, `notes`.

### 6.3 Confirm / Cancel (money steps)
Confirm: re-validate live PO → atomic `flipToConfirmed (status draft→confirmed, one winner)` → create **confirmed stock-IN movements** (reason Goods receipt, linked GRN) → fold acceptedQty into PO receivedQty + `recomputeStatus` → back-fill PI `grnReceivedQty` → async forecast recompute. Cancel: if credited, create reversing **stock-OUT** + `revokeReceipt` + detach PI.

**Exit criteria:** `confirmed` + `stockCredited=true`. Stock IN visible in Inventory.

---
## 7. CUSTOMER (Debtor) — `/app/debtors`

**Purpose:** Customer master for Quotation/SO/Sales Invoice. Picking debtor auto-fills contact, billing/delivery, due-date term.

**Page structure:** No tabs. Table (Name / Salesman / Industry / PAN / GSTIN / Exposure / Terms) + `DebtorModal` + `DebtorDetailModal`.
**Buttons:** Add customer, View / Edit / Delete.

### 7.1 All fields (Debtor model)
| Section | Field | Required | Notes |
|---|---|---|---|
| Company | `name*`, `debtorCode` (auto `BUY-XXXXXX`), `industry`, `customerType` Dealer/Retailer/Defence/Others (validated), `website, phone` | name Yes | Defence GST 0% special |
| Tax | `gstin, panCardNo, stateCode` (auto GSTIN[0:2]) + GST/PAN uploads | No | drives e-invoice/EWB |
| Billing addresses[] | `label, address*, city, state, postalCode` + Add button | address Yes | first mirrors `billingAddress` |
| Shipping addresses[] | same + `Same as billing` checkbox | No | first mirrors `shippingAddress`; also `city, country, state, postalCode` legacy |
| Primary contact | `contactName, contactDesignation, contactEmail, contactPhone` | No | auto-fills SO/Invoice `customerContact` |
| Salesman | `salesmanName, salesmanPhone, salesmanEmail` | No | — |
| Credit | `creditLimit (₹/null)`, `enforceCreditLimit` (default true if limit>0) | No | blocks over-limit if enforced |
| Payment terms | `CustomerTermsManager` (approved terms) + legacy `paymentTermsType` (def credit), `advancePct`, `paymentTermsDays` (def 30), `defaultPaymentTermId` | No | drives invoice dueDate |
| Other | `documents[]`, `notes` | No | — |

**Exit criteria:** Customer with billing+shipping, GSTIN, paymentTermsDays, salesman.

---
## 8. SALES ORDER (Goods SO) — `/app/sales-orders`

**Purpose:** Confirmed customer order. **Never debits stock.** Mirror of PO. Requires debtor approval + warehouse sign-off in full flow.

**Page structure:** No tabs. Stats (Open / Order book / Dispatched / Fully dispatched) + table (SO / Customer / Dispatch dates / Qty / Grand total / Dispatched% / Status pills: draft/warehouse_pending/warehouse_approved/checker_pending/pending_review/confirmed/partially/fully_dispatched/cancelled + debtor approval) + `SOModal`.
**Buttons:** New sales order, View, PDF, Edit (draft/confirmed only; dispatched lines locked), Confirm, Send to debtor (email PDF + token), Cancel.

### 8.1 Header fields
| Section | Field | Required | Notes |
|---|---|---|---|
| IDs | `soNumber` auto `ADV-<FY>-SO-001`, `orderDate*` | Auto/Yes | `buyerOrderNo` auto per-customer 001… via `nextBuyerOrderNo` |
| Customer | `customerId*` (billing debtor) + `customerName`, `customerType`, `shipCustomerId` + `shipCustomerName` + `same_as_billing` checkbox, `contactPerson` (auto), `billingAddress` (auto), `deliveryAddress` (auto), `city, state` | customerId Yes | debtor picker |
| PDF meta | `referenceNo, deliveryNote, dispatchDocNo, dispatchedThrough, buyerOrderNo` | No | prints |
| Tax | `shipGstin, shipPan, billGstin, billPan, remarks` | No | GST 0% if Defence |
| Sales | `salespersonId, salespersonName` | No | — |
| Terms | `paymentTermId` (approved terms snapshot: `paymentTermName, balancePct, balanceDueDays, balanceDueBasis invoice_date/so_confirmation, advanceDueBasis`) + legacy `paymentTerms, paymentTermsType, advancePct` | No | snapshot |
| Dates | `expectedDispatchDate, expectedDeliveryDate` | No | drives dispatch queue + reminders |
| Money | `freight`, `notes`, `documents[]` | No | — |
| Links | `linkedQuotationId + Number` (pick open quotations → autofill) | No | — |
| Workflow | `status` + `manualStatus`, `workflowStatus` (def draft), `currentOwnerRole` (def sales), `nextRequiredAction, nextDueDate` | System | workbench routing |
| Debtor approval | `debtorApprovalStatus` pending/approved/rejected + `Token, SentAt, RespondedAt, Comments, Email` | System | emailed PDF token flow |
| Warehouse | `warehouseStatus` pending/approved/on_hold + `ApprovedBy/At/Notes`, `stockStatus` pending/reserved/in_transit, `dispatchLocation, expectedInwardDate, reservedBy/At, dispatchHold + Reason` | System | warehouse sign-off |
| Review | `reviewedBy/At, salesReviewedBy/At/Notes` | System | checker |

### 8.2 Lines (`GoodsSalesOrderLine[]`)
`productId*` (active only, variant picker), `sku, name, unit` (snap), `color, size, productCode, hsnCode, mrp`, `orderedQty*` (>0), `unitPrice*` (≥0, default product unitPrice; `price_tier` Default/MRP/E-commerce/Retailer/Distributor/Flexible), `discountPct` (0–100, GST on discounted), `gstRate`, `lineTotal = orderedQty×unitPrice×(1−disc/100)` (auto), `dispatchedQty` (system), `notes`.

### 8.3 Lifecycle
`draft → warehouse_pending → warehouse_approved → checker_pending/pending_review → confirmed → (partially_dispatched) → fully_dispatched`, `cancelled`. Derived dispatched states via `recordDispatch/revokeDispatch`; blocks cancelled/draft/pending_review/fully_dispatched. Over-dispatch needs admin/checker.

**Exit criteria:** `confirmed` (+ debtor approved + warehouse approved in strict flow). Needed for Dispatch + Sales Invoice (invoice requires confirmed SO server-side).

---
## 9. SALES PROFORMA (created AFTER SO — advance claim) — `/app/proformas` → Sales tab

**Purpose:** Advance/part-payment claim raised **AFTER the SO is confirmed**, linked to that SO (`linkedGoodsSoId`). **No stock, no accounting.** Checker approves → customer pays advance → Treasury marks funded → funded amount is deducted from the Sales Invoice. (Quotation, if used, is the separate BEFORE-SO offer — do not confuse the two.)

**Page structure:** Same proforma table filtered `side=sales` + `SalesProformaModal` + `ProformaDetailModal`.
**Buttons:** Sales proforma (New, from SO), View/Edit, Submit to checker, Send to debtor, Approve / Fund (checker/treasury), Cancel/Expire.

### 9.1 All fields (`side=sales`)
| Section | Field | Required | Notes |
|---|---|---|---|
| IDs | `poNumber` def `PF-XXXXXXXX`, `proformaNumber` e.g. PF-2026-001, `proformaDate, issueDate` | proformaNumber Yes | — |
| Customer | `debtorId*`, `debtorContact` (auto), `debtorGstin` (auto) or free `prospectName` (quotation) | **Yes** | — |
| Validity | `validUntil` | No | — |
| Commercial | `currency` (def INR), `paymentTerms`, `expectedDate/expectedDeliveryDate`, `poAmount, amount` | No | — |
| Links | `linkedGoodsSoId*` (parent SO — created AFTER SO) | SO link Yes | proforma copies SO lines; do NOT create standalone |
| Lines | `productId, sku, name, hsnCode, unit, quantity*, unitPrice* (from SO; updatedUnitPrice = maker revision, needs checker), discountType pct/amount/none + discountValue, gstRate, notes; effective = updatedUnitPrice ?? unitPrice` | Yes per line | snapshot from SO |
| Totals | `subtotal, totalDiscount, gstTotal, freight, grandTotal` | System | — |
| Advance | `advanceAmount, advanceDueDate, bankDetails, upiDetails, paymentReference, sentAt` | No | what customer pays; feeds sales advance deduction |
| Status | `status` draft/sent/accepted/rejected/expired + `proformaStatus` funding pending_review/approved/funded/rejected + `ReviewedAt/By/Comments, FundedAt/By/Amount/Reference` | System | fund needs approved |

**Exit criteria:** `proformaStatus=funded`. Funded amount auto-deducted in Sales Invoice (`max(paid, advancePct×proformaTotal)`).

---
## 10. SALES INVOICE — `/app/invoices`

**Purpose:** Billing after dispatch intent. **Never reduces stock** (only dispatch does). MUST link confirmed SO; customer + lines validated (products on SO, qty ≤ ordered, customer match). Advance deducted server-side; NOA + reminders + payments.

**Page structure:** No tabs. Table (Invoice [+SO/PF/IRN/EWB/PO] / Customer / Grand total / Received / Balance / Due / Expected Dispatch / Status draft/pending/approved/funded/advanced/paid/partially_paid/overdue / NOA not_sent/sent/accepted/rejected / UTR) + `NewInvoiceModal` + `UtrModal` + `IrnModal` + `InvoiceDetailModal`.
**Buttons:** New invoice, View, Edit (draft/pending only; paid/cancelled frozen), Review→funding queue (draft→pending Issued), NOA email (PDF+token), Record payment (treasury), IRN (finance), Send reminder, Cancel.

### 10.1 Header fields
| Section | Field | Required | Notes |
|---|---|---|---|
| IDs | `invoiceNumber` auto `ADV-<FY>-SI-001` | Auto | — |
| Customer | `debtorId*`, `customerContact` (auto), `billingAddress` (auto), `deliveryAddress` (auto) | **Yes** | from debtor |
| Link | `goodsSalesOrderId*` + `Number` | **Yes (mandatory)** | pick SO → autofills debtor/addresses/terms/lines; server requires confirmed SO |
| Dates | `issueDate*`, `dueDate*` (auto from debtor paymentTermsDays), `expectedDate, promisedPaymentDate, expectedDispatchDate` | issue/due Yes | reminders use dueDate |
| Commercial | `paymentTerms, paymentTermsType, advancePct`, `poNumber/poDate/poAmount` (customer PO ref, optional), `freight`, `notes`, `documents[]` | No | — |
| Advance link | linked customer proforma (formal id or unique PO-number match) | No | deducts max(paid, agreed%) |
| Money | `subtotalGoods, totalDiscount, gstTotal, freight, grandTotal, advanceDeducted, amount` (= grandTotal−advanceDeducted, net receivable), `amountReceived, shortPayment, lateDays, paidDate, receiptDate` | System | amount = what funding reads; UI shows Less advance line + history by PO# |
| Funding | `status` draft/pending(Issued)/approved/funded/advanced/paid/partially_paid + cancelled/rejected/disputed; `advanceRate` def 0.80, `feeRate` def 0.025 | System | Review needs SO link + confirmed SO |
| NOA | `noaStatus` not_sent/sent/accepted/rejected + `noaToken, SentAt, RespondedAt, Comments` | System | email PDF + token; reminder log |
| UTR | `utr_reference, payment_amount` | No | sales tab |
| Tally refs | `tallyVoucherRef, tallyInvoiceNumber, transporter, vehicleNumber, lrRef, placeOfSupply, consigneeName/Address/Gstin/Pan/State/StateCode, buyerGstin/Pan/State/StateCode, deliveryNoteRef/Date, otherReferences, buyerOrderDate, dispatchDocNumber, destination, termsOfDelivery` | No | Tally bridge |
| E-invoice snap | `irn, ackNo, ackDate, irnSource manual/tally, irnEnteredBy/At, signedQr, ewbNumber/Date/GeneratedAt/ValidUntil, irnAttachmentId, ewbAttachmentId` | System/No | see §11 |
| Meta | `source` def manual, `lastOverdueReminderDate, debtorReminderToken`, `purchaseInvoiceId, purchaseOrderId, supplierId` (linked purchase side) | System | — |

### 10.2 Lines (`InvoiceLine[]`)
`productId, sku, name, unit, hsnCode, quantity*, unitPrice*, discountPct (0–100), gstRate, rateInclTax (= unitPrice×(1+gst)), lineTotal` (auto). Editable within SO bounds.

### 10.3 Post-issue
NOA send (email+token, idempotent — email fail never rolls back, retry allowed, busy guards); Payments `recordPayment` accumulates `amountReceived` → derives paid/partially_paid + `paidDate, lateDays`; Reminders instant on create/update if near/past due + daily cron (once/day `lastOverdueReminderDate`) + manual admin send.

**Exit criteria:** `approved/funded` + IRN set (for dispatch gate) — see next.

---
## 11. IRN (e-Invoice Registration Number) — Invoice Detail → IRN

**Purpose:** GST e-invoice registration. Dispatch create-from-invoice gate requires Finance-approved invoice + IRN.

**UI:** `IrnModal` (Finance role). Fields:
- `irn*` — 64-char hex string (validated; blocks if invoice paid/cancelled/rejected or IRN already set)
- `ackNo*`, `ackDate*` — NIC acknowledgement number + date
- `irnSource` — manual / tally (auto)
- `irnEnteredBy, irnEnteredAt` — attribution (auto)
- `signedQr` — signed QR payload (optional paste)
- `irnAttachmentId` — signed JSON upload (optional)

**Server helpers:** `recordIrn` (validates 64-hex, status gate) / `clearIrn`. Invoice stores `irn, ackNo, ackDate, signedQr` + snapshot copied to Dispatch `finalInvoiceId/Number, irnSnapshot, invoicedValue, Gst` on create-from-invoice.

**Exit criteria:** `irn` present + invoice `approved/funded`. Unblocks Dispatch + EWB.

---
## 12. DISPATCH (Goods Dispatch Note) — `/app/dispatches`

**Purpose:** THE ONLY stock-OUT document. Created against confirmed SO (live available-stock check per line). Confirm + `shippingStatus=dispatched` debits stock, folds into SO, allows deliver/return.

**Page structure:** Sections `Pending Dispatch Invoices` (Invoice/Customer/SO/Amount/Expected Dispatch/Days left/Status) + `Dispatches` (Dispatch/Customer/SO/Warehouse/Qty/Delivered%/Status) + SO filter + `DispatchCreateModal` + detail (Edit/Packing/EWB/Confirm/ship-status/Cancel/Return/Print challan).
**Buttons:** Create from sales order / from Invoice, View, Edit, Packing update, EWB generate, Confirm, ship-status advance (picking→packed→awaiting_pick→dispatched→in_transit→delivered, forward-only), Mark delivered, Record return, Cancel, Print delivery challan (`/app/challan/$dispatchId`).

### 12.1 Create modal fields
| Section | Field | Required | Notes |
|---|---|---|---|
| Mode | `from SO` vs `from Invoice` radio | **Yes** | from-Invoice requires Finance-approved invoice + IRN |
| Link | `goodsSalesOrderId*` (+ `soNumber`) OR `Invoice*` | **Yes** | SO must be confirmed/partially-dispatched |
| Dates | `dispatchDate*` | **Yes** | — |
| Locations | `warehouse` (text), `sourceLocationId, destinationLocationId, channel` | No | default Central |
| Type | `dispatchType` customer_sale / marketplace_sale / pos_sale / stock_transfer / customer_return / return_to_supplier / damage_sample_adjustment | No | drives movement reason |
| Transport (plan) | `transporterName, trackingNumber (AWB), deliveryChallanNumber, transportMode, transporterId, vehicleNumber, vehicleType, transportDocType/Number/Date, driverName/Mobile, deliveryCity/State/Pincode, distanceKm, plannedDispatchAt, actualDispatchedAt, actualVehicleNumber, lrNumber` | No | Part-B for EWB |
| Links | `linkedCustomerProformaId/Number, linkedSalesInvoiceId/Number` | No | — |
| Delivery | `customerId, customerName, contactPerson, deliveryAddress` | Auto from SO | editable |
| Packing | `cartonCount, packageType, grossWeight + grossWeightUnit, handlingInstructions, internalDispatchNotes, actualPackedQty, packedQty (per line)` | No | packing step |
| Other | `dispatchedById/By` (auto you), `notes`, `documents[]`, barcode scan `SKU/barcode +1` | No | — |
| EWB gate | `ewayBillId/Number/Status/GeneratedAt/ValidUntil, ewbNotRequired + Reason, ewbAttachmentId` | System/No | — |
| Invoice snap | `finalInvoiceId/Number, irnSnapshot, invoicedValue, Gst` | System | from-Invoice mode |

### 12.2 Lines (`GoodsDispatchLine[]`)
`productId, sku, name, unit` (snap from SO), `orderedQty` (snap), `dispatchedQty*` (>0, ≤ pending), `packedQty`, `deliveredQty / returnedQty` (system), `unitPrice + discountPct` (snap), `gstRate`, `lineValue = dispatchedQty×unitPrice×(1−disc/100)`, `notes`.

### 12.3 Lifecycle
`draft → details_submitted → ready_for_dispatch → confirmed → partially_delivered → delivered`, `cancelled` from any, `returned` from confirmed/delivered. `shippingStatus` picking→packed→awaiting_pick→dispatched→in_transit→delivered. **Stock OUT only at shippingStatus=dispatched** via `markStockDebited` (idempotent; soft check warns if > available, doesn't block). `markDelivered` accumulates deliveredQty + deliveryDate (no stock). `recordReturn` accumulates returnedQty (blank = full), **credits stock IN** (Customer return) + revokes SO dispatchedQty → status `returned` (re-dispatchable). Cancel creates reversing stock-IN only if debited + SO revoke.

**Exit criteria:** `confirmed` + `shippingStatus=dispatched` (stock debited) → EWB + deliver.

---
## 13. E-WAY BILL — Dispatch Detail → EWB (+ `/eway-bills`)

**Purpose:** GST e-way bill for movement ≥ ₹50,000 (`EWB_THRESHOLD=50000`, `requiresEwb` if totalValue>50000). Automatic (NIC GSP) or manual.

**UI:** EWB button on dispatch (enter Part-A/B or auto from invoice+dispatch), vehicle update, extend, cancel, print PDF (`pdfUrl`).
**Buttons:** Generate, Update vehicle (Part-B), Extend validity, Cancel, Print.

### 13.1 All fields (EwayBill model)
| Section | Field | Required | Notes |
|---|---|---|---|
| Links | `goodsDispatchId*`, `dispatchNumber`, `salesInvoiceId/Number`, `ewbNumber` (12-digit NIC, system after generate), `ewbReplyId` | dispatchId Yes | — |
| Supplier (from) | `supplierGstin*`, `supplierTradeName, supplierAddress`, `supplierStateCode` (auto GSTIN[0:2]) | **Yes** | your GSTIN |
| Recipient (to) | `recipientGstin*`, `recipientTradeName, recipientAddress`, `recipientStateCode` | **Yes** | customer GSTIN |
| Document | `documentNumber*` (invoice no.), `documentDate*` | **Yes** | — |
| Values | `taxableValue*, cgstAmount, sgstAmount, igstAmount, cessAmount, totalValue*, hsnDetails[]` | **Yes** | from invoice snap |
| Transport | `transportMode*` road/rail/air/ship (def road), `transporterGstin/Id/Name`, `approxDistance` | mode Yes | — |
| Part-B | `vehicleNumber, vehicleUpdateDate, partBMode, vehicleType` | For road | update vehicle flow |
| Validity | `validFrom, validUntil, extensionCount` | System | extend flow |
| Status | `status` pending/generated/vehicle_updated/extended/cancelled/expired/consolidated/failed + `generationMode` automatic/manual, `consolidatedEwbId/Number, lastError/At, pdfUrl, generatedAt, cancelledAt/By, extendedAt, lastSyncedAt` | System | helpers markGenerated/markFailed/markCancelled/updatePartB/extendValidity |

**Exit criteria:** `status=generated` + `pdfUrl` (print accompanies goods) + dispatch `ewbNumber/ValidUntil` synced. Or `ewbNotRequired + Reason` if < threshold.

---
## 14. WAREHOUSE — `/app/warehouse`, `/app/warehouse-workbench`, `/app/inventory`, `/app/stock-allocation`

**Purpose:** Physical fulfilment: sign off SOs, pick/pack/ship dispatches, manual stock corrections, live balances.

### 14.1 Tabs (Warehouse Workbench — `/app/warehouse`)
| Tab | Contents / Columns | Actions + Fields |
|---|---|---|
| Overview | KPIs (pending SOs, ready, in-transit, low stock) | — |
| Pending Sales Order (sign-off queue) | Order / Buyer / Ordered / Pending / Value / Status | **Approve** (line-by-line stock check: product, ordered, available, shortfall) → sets `warehouseStatus=approved, stockStatus=reserved, reservedBy/At, dispatchLocation, expectedInwardDate`; **Reject → Checker** (`warehouseStatus=on_hold + Notes`), `dispatchHold + Reason` |
| Open Sales Orders | search/sort, same columns | view only |
| Ready to dispatch (orders+invoices) | orders + linked invoices ready | **Create & set to picking** (opens DispatchCreateModal prefilled: SO, dispatch_date, warehouse, source/dest location, channel, dispatch_type) |
| Dispatches (pipeline) | picking / packed / awaiting_pick / dispatched / in_transit / delivered columns; Date/Item/Direction/Qty/Warehouse/Status/Linked doc | **shipMove**: `Awaiting Pickup transporter form` (`transporterName, vehicleNumber, lrNumber, driverName/Mobile, actualDispatchedAt`) → `shippingStatus=dispatched` (**debits stock**); Cancel/Return; packing update (`cartonCount, packageType, grossWeight`) |
| Inventory movements | Date / Item / Direction / Qty / Warehouse / Status / Linked doc | view ledger |
| Manual movement | form below | **New manual movement** (see §14.3) |

### 14.2 Inventory — `/app/inventory`
Sections: `Location-wise Stock Breakdown [Show/Hide]` (per `StockLocation`: Central Warehouse default + central_warehouse/marketplace_warehouse/own_store/transit/other_warehouse, active/inactive) → `Stock Breakdown [12-mo monthly sales/SKU]` → `Live stock [confirmed credits−debits + Adjust]` (item, sku, in stock, unit, value qty×unitCost, red if negative, thumbnails) → filters `Direction All/Credit/Debit + Status All/draft/confirmed/cancelled` → `Movements` table (Movement no. `MOV-XXXXXXXX` / Date / Direction Credit green/Debit amber / Item / Qty / Unit cost / Total / Reason / Warehouse / Linked doc [GRN/Dispatch/PO/Purchase/Sales Invoice/Return/Adjustment] / Status).
**Buttons:** Bulk import, New movement, Adjust row, Edit/Confirm/Cancel/Delete (manual drafts only; system movements immutable — "manage from GRN/dispatch").

### 14.3 Manual movement fields (`MovementModal`)
`movementNumber` (auto), `movementDate*`, `warehouse` (legacy) + `sourceLocationId/destinationLocationId/channel/dispatchType/customerName`, `reason*` (Opening stock IN / Stock adjustment IN / Damage OUT / Samples-internal OUT / Customer return IN / Supplier return OUT), `direction*` Credit(in)/Debit(out), barcode scan + `productId*` (`SKU·name`, catalogue snap `itemName/sku/unit`), `quantity*`, `unitCost` (auto MRP, values ledger) + `total`, `linkedDocumentType/Number` (GRN/Dispatch/PO/PI/SO/Invoice/Return/Adjustment), `notes*` (required), attribution `createdBy/confirmedBy/cancelledBy + At`, `Save draft / Save & confirm`. Confirm atomic `draft→confirmed`; Cancel drops out (no reversal entry).

**Exit criteria:** SO warehouse-approved, dispatch shipped (stock debited), live stock correct per location.

---
## 15. FINANCE — `/app/finance-workbench` + accounting + cash + bulk + advances

**Purpose:** Money: approve/fund/pay every document, record advances, journalise, forecast cash.

### 15.1 Finance Workbench tabs (`/app/finance-workbench` — same-page nav)
| Tab | What you see | Actions / Fields |
|---|---|---|
| Workbench | KPIs (Sales Awaiting Approval, Purchase Pending, Open Payments, Overdue) + filter chips (All/Sales Invoices/Purchase Invoices/Proforma/Payments/Dispatch) + search doc/counterparty + owner select; table Document/Counterparty/Value/Current Status/Next Step/Owner/Action | **Review / Fund / Dispatch / Open** per row; header `+ New Bulk Payment` |
| Cash Command | cash position, inflows/outflows | sync cash-flow engine |
| Treasury | pay queue | **Record payment** (`amountPaid`, `paymentReference`, `paidDate`; auto partially_paid/paid; reversal → approved_for_payment) |
| Bulk Payments | batch pay run | `bulk-payment` (multiple invoices, single ref) |
| Sales Orders | SO funding view | same as §8 + approve |
| Sales Invoices | SI funding view (`/app/finance-invoices`) | Review (draft→pending), Approve, Fund, Advance (advanceRate 0.80, feeRate 0.025), NOA, IRN, UTR, Remind |
| Proforma Invoices | PF funding view (`/app/finance-proformas`) | Submit/Approve/Fund (`FundedAt/By/Amount/Reference`), advance% |
| Advances | advance ledger (`Advance`: `side*` sales/purchase, `amount*`, `advanceDate` def today, `status` def open, `reference, notes`, `invoiceId/purchaseInvoiceId/purchaseOrderId`, `paymentRef` auto `PAY-YYYY-XXXXXX`) | Record advance (feeds deduction `max(paid, agreed%)`) |
| Purchase Invoices | PI pay view (`/app/finance-purchases`) | Verify → Approve for payment → Pay (see §5.5) |
| Dispatch Orders | dispatch finance view (`/app/finance-dispatches`) | IRN gate check, EWB check |
| Activity History | audit log (`AuditLog`: actor, action `po.*/grn.confirmed/dispatch.confirmed/invoice.*/stock.*`, target, detail, immutable, fire-and-forget) | view only |

### 15.2 Accounting (`/app/accounting`, `/app/balance-sheet`)
- **Chart of Accounts** (`code*, name*, type*` asset/liability/equity/revenue/direct_cost/expense/other_income/other_expense, `subtype, description, taxRate` def 0, `currency` def INR, `status` def active, `isSystem` + `systemKey`; system seed: 1000 Bank, 1100 AR, 1200 Inventory, 2000 AP, 2100 Tax, 3000 Capital, 4000 Sales, 5000 COGS, 6000 Opex; system rows undeletable).
- **Journals** (`journalDate` def today, `reference, description, source` def manual, `sourceId, status` def posted, `createdBy`; lines: `accountId*, lineNo` def 1, `debit, credit, taxRate/taxAmount` def 0, `description`; only `source=manual` deletable).
- Postings (conceptual): GRN confirmed → Dr Inventory / Cr AP (or GRN clearing); Dispatch shipped → Dr COGS / Cr Inventory; Sales Invoice issued → Dr AR / Cr Sales + Tax; payment → Dr Bank / Cr AR (sales) or Dr AP / Cr Bank (purchase).

### 15.3 Cash flow + reminders + roles
- **Cash flow** (`/app/cash-flow`): `expected-inflow/outflow`, `cash-account`, `cash-flow-settings`; engine sync; daily overdue cron (once/day `lastOverdueReminderDate`); instant near/past-due check on create/update; manual admin remind; NOA tracked in reminder log.
- **Maker–checker gates (server-enforced):** Client creates/edits drafts, submits, marks PO sent, drafts receipts/dispatches; Checker approves/rejects proformas/POs/invoices + allows over-receipt/dispatch; Treasury/Admin records payments + funds proformas; Sales rep read-only on PO/SO/dispatch (quotes only); Admin all. Gates: SI issue needs confirmed SO; PI needs approved+sent PO; Proforma needs sent PO / confirmed SO (created AFTER); GRN confirm needs sent/partially-received PO; Dispatch confirm needs confirmed/partially-dispatched SO.

---
## 16. End-to-end checklist (one row per gate — Proforma AFTER PO/SO)

1. [ ] Product active (sku, name, UOM, unitCost, unitPrice, gstRate, hsn, reorder/lead/safety, MOQ/multiple)
2. [ ] Supplier onboarded (company, GSTIN/PAN, contact, paymentTermsDays/type, bank)
3. [ ] PO created (supplier, warehouse, expectedDelivery, buyer, lines orderedQty/unitPrice/gst, freight, print block) → approved → **sent**
4. [ ] Purchase Proforma created **AFTER PO** (linkedGoodsPoId, vendor, currency, paymentTerms, lines copied from PO, advanceAmount/advancePct) → submitted → **approved → funded**
5. [ ] Purchase Invoice recorded **AFTER PO** (supplier, invoiceNumber unique/supplier, PO link*, issue/received/due, lines invoiceQty/unitPrice, freight, differenceNotes, linked proforma → advance deducted) → verified → **approved_for_payment** → paid
6. [ ] GRN created (PO link, receivedDate, challan, location, lines received/accepted/rejected/unitCost, linked PI, receivedBy) → **confirmed (stock IN)** → PO partially/fully_received, PI grnReceivedQty synced
7. [ ] Customer onboarded (name, type, GSTIN/PAN, billing+shipping, contact, salesman, creditLimit+enforce, paymentTermsDays)
8. [ ] SO created (customer+ship, contact/addresses, buyerOrderNo, terms snapshot, expectedDispatch/Delivery, lines qty/price-tier/discount/gst, freight, optional linkedQuotationId) → warehouse-approved → debtor-approved → **confirmed**
9. [ ] Sales Proforma created **AFTER SO** (linkedGoodsSoId, customer, currency, terms, lines copied from SO, advanceAmount/advancePct) → **approved → funded**
10. [ ] Sales Invoice created **AFTER SO** (customer, SO link* mandatory, issue/due, PO ref, lines qty/price/discount/gst, freight, linked proforma → advance deducted) → Reviewed (Issued) → approved → funded; NOA sent
11. [ ] IRN recorded (irn 64-hex, ackNo, ackDate, source, signedQr/attachment) — Finance only
12. [ ] Dispatch created (SO or IRN-invoice, dispatchDate, warehouse/locations, type, transporter/tracking/challan, lines dispatchedQty, packing) → confirmed → **shipped=dispatched (stock OUT)** → delivered / returned
13. [ ] E-Way Bill generated (supplier/recipient GSTIN, doc number/date, values+hsn, transportMode, vehicle Part-B, validUntil, pdfUrl) or marked not-required with reason
14. [ ] Warehouse signed off (SO approve/reserve, pick→pack→awaiting_pick→dispatched→in_transit→delivered, manual movements as needed, location-wise balances verified)
15. [ ] Finance closed (payments recorded both sides, advances adjusted, journals posted, reminders/NOA done, audit history intact, forecast recomputed)

*Generated 2026-10-15 from Adventra codebase. Keep this file as the single field-level contract for re-implementation.*
