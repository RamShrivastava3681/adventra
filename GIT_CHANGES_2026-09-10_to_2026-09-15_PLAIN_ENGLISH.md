# What Changed in the App — 10 September to 15 September 2026 (Plain English)

**For:** non-technical readers (founders, operations, sales, accounts).
**Covers:** all 31 updates from 10 Sept 2026 to today (15 Sept 2026). No updates went out on 12 Sept or 15 Sept.
**Technical detail:** see `GIT_CHANGES_2026-09-10_to_2026-09-15.md`.

---

## 10 September 2026 — 10 updates

### 1. 00:08 — Bulk payments + product fixes
**What you see:** a new Bulk Payments page where you can enter one payment from a customer (or to a supplier) and it automatically spreads across all open bills, closing what it can and showing leftover balance.
**Why it matters:** no more splitting one bank receipt manually across 10 invoices. Also fixed product/variant saving behind the scenes.

### 2. 01:01 — Samples tracking
**What you see:** a new Sample Distribution page that lists every free sample sent out — what item, how many, to whom, and when.
**Why it matters:** samples no longer get lost inside normal stock; sales and warehouse can see who got what.

### 3. 09:58 — GST collection tracker + new dashboard
**What you see:** a new GST Collection tab in Cash Flow showing total GST billed, GST already collected, GST still pending, and GST due in the next 7 days, bill-by-bill. The main Dashboard got a new look with sales trend, overdue alerts, “needs your attention” list, and business health.
**Why it matters:** you can finally answer “how much GST are we still waiting on?” without Excel.

### 4. 10:17 — Colour meanings fixed everywhere
**What you see:** green always means good/paid, blue means funding/open, amber means waiting/aging, red means overdue/risk — same colours on every page.
**Why it matters:** staff no longer have to guess what a colour means; overdue and risk stand out instantly.

### 5. 14:12 — Sales order print + customer addresses
**What you see:** sales orders now download as a clean Tally-style PDF with order number, addresses, GST numbers, transport details, and bank details. Customers can now save multiple billing/shipping addresses and pick one per order. Product names now say “Master SKU” with proper pricing per size/colour.
**Why it matters:** quotations and orders look professional and carry all tax/transport info buyers ask for.

### 6. 14:27 — Logo fix on print
**What you see:** the company logo on the sales-order PDF now shows correctly on a white box instead of disappearing on black.
**Why it matters:** printed orders look correct when sent to customers.

### 7. 20:22 — Payment terms, approvals, receipts (big backend)
**What you see:** you can now set payment terms per customer (e.g. 30 days, advance %), see an approval trail on documents, and record part-payments/receipts against invoices. Invoices, orders and dispatches show richer status.
**Why it matters:** credit control and approvals are now tracked inside the app instead of on phone/WhatsApp.

### 8. 23:19 — Task reminders, dispatch steps, activity history
**What you see:** a new Tasks inbox with due dates, daily reminders for overdue work, dispatch now moves step-by-step (pack → dispatch → deliver), and every document shows a timeline of what happened and when.
**Why it matters:** nothing slips — overdue tasks remind you and escalate automatically.

### 9. 23:30 — Fixed crash on challan print (temporary)
**What you see:** the “Print challan” button briefly printed the invoice instead. This stopped the app from crashing.
**Why it matters:** stability fix late at night; printing kept working.

### 10. 23:40 — Proper challan print page restored
**What you see:** “Print delivery challan” is back and opens its own clean challan page under Dispatches.
**Why it matters:** warehouse can print the correct delivery paper for every dispatch again.

---

## 11 September 2026 — 12 updates

### 11. 00:08 — App navigation plumbing (invisible)
**What you see:** nothing visible. The tool that builds the app’s pages was reconfigured so new pages generate correctly.
**Why it matters:** prevents “page not found” errors when developers add screens.

### 12. 00:45 — Fixed page-list error
**What you see:** nothing visible. Removed a broken auto-generated file and fixed finance page links.
**Why it matters:** app loads reliably again after the midnight change above.

### 13. 10:04 — Invoice look and payment terms
**What you see:** invoices, proformas and their print previews follow the new template (bank, tax, terms) and let you pick payment terms while creating them.
**Why it matters:** every invoice sent out looks consistent and states when payment is due.

### 14. 11:04 — Purchase-order clauses
**What you see:** while making a Purchase Order you can now tick standard clauses (warranty, delivery, penalty etc.) from a list, and they print on the PO.
**Why it matters:** POs to suppliers are legally complete without typing clauses each time.

### 15. 11:15 — Product filter fix
**What you see:** the category filter on the Products page now shows all real categories, including old ones, and filtering works regardless of capital/small letters.
**Why it matters:** you can actually find products; nothing hides because of spelling.

### 16. 11:24 — Supplier details improved
**What you see:** Suppliers page captures more contact/tax details, and Purchase Orders use that saved supplier instead of asking again.
**Why it matters:** less re-typing, fewer supplier mistakes on POs.

### 17. 12:09 — Small print + product fixes
**What you see:** tiny fixes to PDF spacing, product labels, and download names.
**Why it matters:** polish; prints and lists look a bit cleaner.

### 18. 12:20 — Simplified money queue
**What you see:** the treasury/funding queue no longer shows two confusing extra columns (UTR/payment amount from checker).
**Why it matters:** the queue is simpler — only receipt date and amount matter now.

### 19. 14:53 — Product + purchase-order cleanup
**What you see:** Products page (colours/sizes/prices) and Purchase Orders behave more correctly; several small wrong labels and email wordings fixed.
**Why it matters:** fewer errors while creating SKUs and POs.

### 20. 15:03 — Customer credit limits
**What you see:** Customers page now shows credit limit, pending dues and payment terms; sales orders show the customer’s credit snapshot.
**Why it matters:** sales can check “can we give more credit to this buyer?” before booking.

### 21. 15:48 — Removed clutter
**What you see:** two pages (Invoices, Sales Orders) lost ~67 lines of old test/duplicate blocks. Nothing you use disappeared.
**Why it matters:** faster, cleaner screens.

### 22. 15:56 — Save buttons fixed
**What you see:** the Save button on New Invoice and New Sales Order now always works, even though the button sits in the bottom bar outside the form.
**Why it matters:** fixes the “I filled everything but Save does nothing” complaint.

---

## 13 September 2026 — 1 update

### 23. 22:14 — Pop-ups and screens restyled
**What you see:** all pop-up windows now share the same roomy blue-grey style with clear titles and Cancel/Save at the bottom. A new shared “workbench” layout was introduced behind the scenes.
**Why it matters:** the app feels consistent and easier to read; sets up the big workbench screens next day.

---

## 14 September 2026 — 8 updates (big UI week)

### 24. 00:35 — Whole-app theme polish
**What you see:** colours, cards, login and loading screens tidied across ~50 pages; dark mode looks correct.
**Why it matters:** no new features, but everything looks calmer and more professional.

### 25. 12:42 — New Sales + Purchase workbenches (biggest change)
**What you see:** two brand-new boards — Sales Workbench (orders → dispatch → billing in one flow) and Procurement Workbench (purchase indents → POs → receipts). Products page split into neat tables with separate pop-ups for Master, Colour and Sellable SKUs. Checker and Warehouse pages rebuilt on the same tables.
**Why it matters:** daily sales/purchase work moves from 5 scattered pages to 2 focused boards — much faster for operations.

### 26. 14:25 — Dashboard simplified into cards
**What you see:** the Dashboard is now small cards (cash in hand, alerts, priorities) instead of one giant page. Data loads card-by-card so you see something quickly.
**Why it matters:** owners get the pulse of the business in seconds; slow full-page loads are gone.

### 27. 14:54 — New sidebar, top bar, warehouse board
**What you see:** left menu and top bar are now slimmer and faster; new Warehouse Workbench board for receiving → putaway → dispatch.
**Why it matters:** navigation is clearer and warehouse staff get their own triage board like sales/purchase.

### 28. 15:03 — Who-sees-what menu fix
**What you see:** the menu now correctly shows Sales / Warehouse / Finance sections based on your role.
**Why it matters:** people only see what they’re allowed to use.

### 29. 15:48 — New Finance board
**What you see:** new Finance Workbench that pulls cash, invoices and payment queues into one place. Dispatches link deeper into it.
**Why it matters:** accounts/treasury get one screen for “what’s due, what to pay, what to fund” instead of jumping between Dashboard and queues.

### 30. 16:31 — Workbench tidy-up
**What you see:** duplicate filters/buttons removed from the new boards; product tables simplified.
**Why it matters:** the new boards are less cluttered after first-day feedback.

### 31. 17:04 — Warehouse page slimmed (latest)
**What you see:** the old Warehouse page is now light — heavy work moved to the Warehouse Workbench. Purchases page got clearer stock-receipt info.
**Why it matters:** warehouse opens fast; old and new pages no longer duplicate each other.

---

## In one paragraph

Between 10–14 Sept the app grew from scattered accounting screens into role-based boards: bulk payments and GST tracking for accounts, samples and challans for warehouse, Tally-style PDFs and multi-address customers for sales, payment terms/credit limits/clauses for control, and finally dedicated Sales, Purchase, Warehouse and Finance workbenches with a card-style dashboard — plus consistent colours, fixed Save buttons, working prints, and daily task reminders throughout.
