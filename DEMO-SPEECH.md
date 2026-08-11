# 🎤 Adventra — Live Demo Speech

> **What this is:** a word-for-word script you can deliver while demoing Adventra to clients, investors, or your own team. It covers **every role**, **every tab**, and the **entire demand-forecasting engine** — every formula, in plain language with real numbers. Read it straight through (~10 minutes) or use the appendix cheat sheet for a live walkthrough.

**How to use this script**

- **Bold = say it out loud.** (Parentheses = stage direction: click, point, pause.)
- Sections are roughly one page each when printed, so you can cut any page without breaking the flow.
- Short on time? Read Parts 1, 2, 4, 5 and 7 — that's the whole story in about six pages.
- Every forecasting number in Part 5 is the *actual output* of the engine in `frontend/src/lib/forecast-engine.ts`, run against a real example product (Trekking Backpack `TB-1001`).

---

## Part 1 — Opening: what Adventra is

> **"Good morning everyone. I'm going to show you Adventra — a receivables-factoring and debtor-monitoring platform that turns outstanding invoices into working capital, without losing sight of risk."**

**"Let me set the scene. A trading company lives on its cash flow. Every day it ships goods, raises invoices, and waits — sometimes 30, 60, even 90 days — to get paid. That waiting is money sitting still. Adventra does three things about it:**

1. **Submit** — the company's sales invoices come into the platform and are checked by a second pair of eyes.
2. **Advance** — once approved, the treasury desk funds against those invoices, often the same day.
3. **Collect** — the platform watches every debtor, chases payments with automated reminders, and tracks aging, concentration, and credit risk live.

**And beneath all of it — the part I'm most proud of — is a demand-forecasting engine that tells you, for every single product, when you'll run out of stock and exactly how much to reorder. I'll spend the last part of this demo on that, formula by formula."**

(Point at the landing page: the stat strip and live monitoring panels.)

---

## Part 2 — The people: every role at a glance

> **"Adventra is one platform with six job-specific consoles. Each person logs in and sees only the tabs their job needs. No noise. Here's who's who:"**

| Role | Console | What they own |
|---|---|---|
| **Admin** (`factor_admin`) | **Factor console** | Everything — the full portfolio, all tabs, approvals, team roles, configuration |
| **Checker** | **Checker desk** | The second pair of eyes — maker-checker approval of every submitted transaction |
| **Treasury** | **Treasury desk** | The funding queue — disbursing advances, releasing reserves on collection |
| **Operations** | **Operations desk** | Day-to-day transactions — buying, receiving, selling, shipping |
| **Sales rep** | **Sales workspace** | Leads, quotations, debtors, suppliers — the front of the funnel |
| **Reporting manager** | **Reporting console** | Team output, per-member progress, "view-as" inspection, approval requests |
| **Client** | **Trader portal** | The base role every new account starts with, before roles are assigned |

> **"Notice the pattern: the closer you get to money, the fewer tabs you see. The admin sees everything; the checker sees what needs checking; the sales rep sees only sales."**

---

## Part 3 — The consoles: what each role sees

> **"One login — six different sidebars. Let me show you what each console looks like."**

**Factor console (Admin)** — the full map:

- **Single tabs:** Dashboard · Checker · Funding queue
- **Transactions (13):** Purchase invoices, Purchase orders, Goods received (GRN), Quotations, Sales orders, Dispatch, Sales invoices, Proforma invoices, Debtors, Suppliers, Credit/Debit notes, Expenses, Advances
- **Catalog & Inventory:** Product catalog, Demand forecasting, Inventory
- **Sales:** Leads (CRM), Quotations, Debtors, Suppliers
- **System:** Alerts, Reminders, Operations (admin), Invoice template, Settings

**Checker desk:** Dashboard · My Workspace · Checker · the 13 Transactions

**Treasury desk:** Dashboard · My Workspace · Funding queue · the 13 Transactions

**Operations desk:** Dashboard · My Workspace · the 13 Transactions

**Sales workspace:** Dashboard · My Workspace · Sales (Leads, Quotations, Debtors, Suppliers)

**Reporting console:** Dashboard · My Reports · Requests · Settings

**Trader portal (client):** Dashboard

(Click through a couple of roles — or use "View as" from the Reporting console to walk in a sales rep's shoes. A banner shows you're impersonating, and every page scopes to that person's data.)

---

## Part 4 — Every tab, one breath each

> **"Here's the whole map — thirty-four pages, one line each — so you know exactly what lives behind every tab."**

| Tab | What it is |
|---|---|
| **Landing page** | Capabilities and live monitoring panels — where visitors first meet the product |
| **Sign in / Sign up** | Free account creation, no card required |
| **Dashboard** | The command center — income KPIs, funding KPIs, settlement quality, aging waterfall, live alerts feed |
| **My Workspace** | Personal requests — visits, travel, expenses, leave; submit and track |
| **Checker** | Maker-checker approval queue for every submitted transaction |
| **Funding queue** | Treasury's disbursement list — approved invoices and advances awaiting funding |
| **Purchase invoices** | The cost side of each deal — supplier invoices with PO details |
| **Purchase orders** | Orders placed with suppliers |
| **Goods received (GRN)** | Receiving stock against purchase orders — the stock-in event |
| **Quotations** | Sales quotes, with a rich quotation detail page — convert to orders |
| **Sales orders** | Confirmed customer orders |
| **Dispatch** | Shipping and challans — the stock-out event, with per-dispatch detail |
| **Sales invoices** | The money-maker — submit, then checker, then funding queue; printable branded preview |
| **Proforma invoices** | Raised against a PO to take or release an advance; applied to the final invoice with the same PO |
| **Credit / Debit notes** | Credit = refunds/discounts; Debit = extra charges/claims; both flow through approval to the linked invoice |
| **Debtors** | Credit limits, risk scores, and live exposure for every payer |
| **Suppliers** | Onboarding the companies whose invoices you finance — terms, credit lines, lifecycle |
| **Vendors** | The companies you buy from — contacts, payment terms, open payables |
| **Expenses** | Logistics, insurance, interest — link each to a sales or purchase invoice for true per-deal economics |
| **Advances** | Money received or paid ahead of the final invoice — always tied to an invoice |
| **Products & SKUs** | The master catalog — price, cost, reorder level, lead time; powers forecasting and low-stock alerts |
| **Demand forecasting** | The engine — full treatment in Part 5 |
| **Inventory** | A double-entry stock ledger — every movement is a dated, valued journal entry |
| **CRM / Leads** | Lead pipeline, opportunities, activities — per-user scope |
| **Alerts** | Real-time surveillance — overdue invoices, credit-limit breaches, severity-tagged, unread counts |
| **Reminders** | Automated email nudges that keep collections on schedule |
| **Operations (admin)** | Generate alerts, manage team roles, act on exceptions |
| **Invoice template** | Brand the platform's generated invoices and notes |
| **Accounting** | Chart of accounts and journals — every financial movement is a balanced entry |
| **Balance sheet** | As-of-date statement that auto-updates from every module |
| **My Reports** | Reporting manager view — per-team-member progress |
| **Requests** | Team approval requests surfaced across the organization |
| **Profile** | Personal info and photo |
| **Settings** | Company profile, admin bootstrap |

> **"Thirty-four pages — but because of role walls, any single user sees only ten to fifteen. That's the design philosophy in one line: the right information, at the right time, for the right person."**

---

## Part 5 — The forecasting engine: every formula

> **"Now the star of the show. The Demand Forecast page answers one question for every product: 'If I do nothing, when do I run out of stock — and how much should I order so I don't?'"**

**"The engine is a fourteen-step pipeline over the last twelve months of sales. Let me walk it with a real product — the Trekking Backpack, TB-1001: unit cost $25, unit price $59.99, fourteen-day supplier lead time, thirty units on hand, today is August 4th, 2026. Every number I say is the real output of the code."**

### Step 0 — The 12 months of history

The engine reads the last 12 months of **outbound** stock movements (incoming stock is ignored for demand):

`24, 20, 14, 10, 12, 8, 9, 12, 16, 22, 28, 30` → **205 units total**.

**"But January — 8 units — was a stockout month. The shelves were empty for half the month. If we train the forecast on 8, we'll under-order forever. So the engine fixes it."**

### Step 1 — Availability correction (fixing stockout months)

```
availabilityRate = inStockDays ÷ daysInMonth
corrected         = min( actual ÷ max(availabilityRate, 0.70),  actual × 1.4 )
```

January: `15 ÷ 31 = 0.48` → `min(8 ÷ 0.70, 11.2) = 11.2`.

The **0.70 divisor floor** stops wild inflation, and the **1.4× cap** means one bad month can't distort demand permanently. Corrected total: **208.2 units**.

### Step 2 — Baseline: a 3/2/1 weighted average

**"Recent months matter more than old months. The newest 3 count triple, the middle 3 double, the oldest 6 single:"**

```
w          = [1,1,1,1,1,1,2,2,2,3,3,3]
weightedAvg = Σ(yᵢ·wᵢ) ÷ Σ(wᵢ) = 405.2 ÷ 21 = 19.30
```

The page shows **Monthly avg = 19**.

### Step 3 — Trend: the line of best fit

```
slope = (n·Σxy − Σx·Σy) ÷ (n·Σx² − (Σx)²) = 1330.8 ÷ 1716 = +0.78 units/month
R²    = 1 − ssRes ÷ ssTot = 0.15      → "trend strength 15%"
direction: slope must beat |meanY| × 2% (= 0.35) → +0.78 > 0.35 → "up"
```

**"Demand is rising about 0.8 units a month. R² tells us how reliably the data follows that line — 15% is noisy, but the direction is still up."**

### Step 4 — Seasonality: the month personality

```
overallAvg = Σy ÷ 12 = 17.35
factor     = monthAvg ÷ overallAvg,  clamped to 0.5–2.0
```

September: `20 ÷ 17.35 = ×1.15`. January is ×0.65, July ×1.73. **"Backpacks sell in summer — the data says so; we just measure it."**

### Step 5 — Business factors: your judgment, quantified

Five optional multipliers: trekking season, weather, promotions, regional demand, events (each defaults to 1.0 = no effect):

```
factors = trekking × weather × promotion × regional × event
final   = clamp(baseline × factors, 0.7 × baseline, 1.5 × baseline)
```

**"No matter what you type, factors can only move the forecast between 70% and 150% of normal. One lucky day can't make you buy a truckload."**

### Step 6 — The monthly forecast, month by month

```
baseline        = max(0, weightedBaseline + slope × i) × seasonalFactor    (i = 1…6)
dailyRate       = final ÷ daysInMonth
monthlySafety   = dailyRate × safetyStockDays (30)
suggestedOrder  = running < final + safety ? ceil(final + safety − running) : 0
```

September: `(19.30 + 0.78) × 1.153 = 35.48 → 35 units`.

| Month | Forecast | Daily | Safety | Suggested order |
|---|---|---|---|---|
| Sep 2026 | 35 | 1.2 | 36 | **41** |
| Oct 2026 | 25 | 0.8 | 24 | **51** |
| Nov 2026 | 19 | 0.6 | 18 | **38** |
| Dec 2026 | 23 | 0.7 | 21 | **46** |
| Jan 2027 | 22 | 0.7 | 21 | **44** |
| Feb 2027 | 18 | 0.6 | 18 | **38** |

**"Running stock starts at 30. September needs 35 units plus a 36-unit safety buffer — that's 71; you have 30, so buy 41. October already starts at zero, so it wants a full top-up of 51."**

### Step 7 — The prediction interval: the honest range (80% confidence)

```
se      = √( Σresidual² ÷ (n−2) ) = 9.79
sePred  = se × √( 1 + 1/n + (i − meanX)² ÷ ssx ) = 11.50
half    = round(1.28 × sePred) = 15     →   September: 20.5 – 50.5
```

**"We're 80% sure September lands between 20 and 50 units. Notice the bands widen the further we look — the engine is honest about uncertainty. And with fewer than 3 months of history it falls back to a simple ±30% range."**

### Step 8 — Days of cover

```
last3DailyAvg = (Jun + Jul + Aug) ÷ (30 + 31 + 31) = 80 ÷ 92 = 0.87/day
daysOfCover   = round(inventoryPosition ÷ last3DailyAvg) = round(30 ÷ 0.87) = 34 days
```

Inventory position = on hand + confirmed inbound − committed customer orders.

### Step 9 — The reorder recommendation

```
requiredStock = dailyAvg × (leadTime + safetyStockDays) = 0.87 × 44 = 38.26
recommended   = max(0, requiredStock − inventoryPosition) = 38.26 − 30 = 8.26 → 9
```

Then three business rules, in order: **cap by max cover** (180 days) so you never over-buy; **respect the MOQ** (if you order at all, order at least the minimum); **round up to the order multiple** (e.g. boxes of 25). **"Buy 9 today — and the page even values it: 9 × $25 = $225 at cost."**

### Step 10 — Momentum: speeding up or slowing down?

```
recent = last-3-months avg = (22+28+30) ÷ 3 = 26.67
≥ baseline × 120% (= 23.15) → accelerating   ·   ≥ baseline × 60% → stable   ·   else declining
```

26.67 → **accelerating**. **"People suddenly want more backpacks."**

### Step 11 — Velocity: how fast, versus the neighborhood

Within each category, products are ranked by recent average; `position = (rank + 1) ÷ group size`:

```
≤ 20% → fast mover · ≤ 50% → medium · else slow · zero sales → dead
```

TB-1001 is rank 2 of 5 in Backpacks → 0.40 → **medium mover**. **"Velocity is always about your neighborhood, not the absolute number."**

### Step 12 — Risks: stockout and overstock

```
coverVsLead = daysOfCover ÷ leadTime = 34 ÷ 14 = 2.43
< 1.0 → stockout HIGH · < 1.5 → medium · else low   →  low ✅
daysOfCover > 180 → overstock HIGH · > 135 → medium →  34 → low ✅
```

### Step 13 — The timeline: three dates that matter

```
stockoutDate  = today + daysOfCover = Aug 4 + 34 = Sep 7
reorderByDate = stockoutDate − leadTime = Sep 7 − 14 = Aug 24   ← last safe day to order
refillDate    = today + leadTime = Aug 18
```

Urgency: **critical** if you've already passed the reorder-by date, **warning** inside the lead window, otherwise **safe**. Today: **safe**.

### Step 14 — Pricing strategy

```
minimumPrice = unitPrice ÷ (1 − minMargin) = $59.99 ÷ 0.60 = $99.98   (40% margin floor)
```

Then eight decision rules — from **clearance** (dead product, too much stock: cut price 20–40%) to **protect margin** (fast mover, low stock: maybe raise 3–5%). Our backpack is a medium mover, accelerating → **hold price**.

> **"And every number I just showed you is auditable — click any forecast and it expands to show the complete calculation breakdown, number by number. No black box."**

---

## Part 6 — Closing

> **"So that's Adventra in ten minutes. One platform, six consoles, thirty-four pages, and a forecasting engine that turns twelve months of history into a buying decision with a date on it. Submit, advance, collect — while aging, concentration, and credit risk move live. Thank you — I'm happy to take questions."**

(Useful answers: "The approval step always gates funding — nothing gets money without a check." / "The forecast recomputes live and persists daily snapshots — it refreshes every 60 seconds." / "Role changes are validated against a known-role allowlist and every privileged action is audit-logged.")

---

## Appendix — Live-demo cheat sheet (the ten clicks)

1. **Landing page** → stat strip, live monitoring panels
2. **Sign in** → show the role badge and console label
3. **Dashboard** → aging waterfall chart
4. **Sales invoices** → create one → watch it land on the **Checker** desk
5. **Checker** approves → the invoice enters the **Funding queue**
6. **Treasury** funds → status becomes "advanced"
7. **Products** → open TB-1001 → reorder level and lead time
8. **Inventory** → stock ledger → drill into a linked invoice
9. **Demand forecast** → expand TB-1001 → walk the calculation breakdown
10. **Alerts** → show a credit-limit breach firing in real time
