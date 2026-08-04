# 🎒 Demand Forecast — Every Formula Explained (With Real Numbers)

**Where the numbers come from:** the Demand Forecast page (`/app/forecast`) runs the forecast engine in
`frontend/src/lib/forecast-engine.ts`. Everything below was produced by **actually running that engine**
against a fictional but realistic product, so every number you see here is the *real output* of the code.

**The example product used throughout this document:**

| Field | Value |
|---|---|
| SKU | `TB-1001` |
| Name | Trekking Backpack |
| Category | Backpacks |
| Unit cost | $25.00 |
| Unit price | $59.99 |
| Supplier lead time | 14 days |
| Stock on hand today | 30 units |
| Today's date | 2026-08-04 |

> 🧒 **A promise to the reader:** this document explains *every* formula, one tiny step at a time,
> with the actual numbers plugged in, and a plain-language story for each one.
> If a formula ever looks scary, read the 🍋 "Lemonade stand" box next to it first — that's the same
> idea in words, no math at all.

---

## Table of contents

1. [The big picture — what the page does](#1-the-big-picture)
2. [Step 0 — The 12 months of history](#2-step-0--the-12-months-of-history)
3. [Step 1 — Fixing stockout months (availability correction)](#3-step-1--fixing-stockout-months-availability-correction)
4. [Step 2 — The baseline (weighted average)](#4-step-2--the-baseline-weighted-average)
5. [Step 3 — The trend (line of best fit)](#5-step-3--the-trend-line-of-best-fit)
6. [Step 4 — Seasonality (the "month personality")](#6-step-4--seasonality-the-month-personality)
7. [Step 5 — Business factors (multipliers from you)](#7-step-5--business-factors-multipliers-from-you)
8. [Step 6 — The monthly forecast, month by month](#8-step-6--the-monthly-forecast-month-by-month)
9. [Step 7 — The prediction interval (the "probably" range)](#9-step-7--the-prediction-interval-the-probably-range)
10. [Step 8 — Days of cover (how many days of stock)](#10-step-8--days-of-cover-how-many-days-of-stock)
11. [Step 9 — The reorder recommendation (how much to buy)](#11-step-9--the-reorder-recommendation-how-much-to-buy)
12. [Step 10 — Momentum (is demand speeding up or slowing down?)](#12-step-10--momentum-is-demand-speeding-up-or-slowing-down)
13. [Step 11 — Velocity (how fast this product sells vs its category)](#13-step-11--velocity-how-fast-this-product-sells-vs-its-category)
14. [Step 12 — Risks (stockout & overstock)](#14-step-12--risks-stockout--overstock)
15. [Step 13 — The timeline (stockout date, reorder-by date, refill date)](#15-step-13--the-timeline)
16. [Step 14 — Pricing strategy (what to do with the price)](#16-step-14--pricing-strategy-what-to-do-with-the-price)
17. [Appendix A — All formulas in one place](#appendix-a--all-formulas-in-one-place)
18. [Appendix B — Constants and default values](#appendix-b--constants-and-default-values)
19. [Appendix C — How to reproduce these exact numbers](#appendix-c--how-to-reproduce-these-exact-numbers)
20. [Glossary — the words we use](#glossary--the-words-we-use)

---

## 1. The big picture

The Demand Forecast page answers one giant question for every product:

> **"If I do nothing, when do I run out of stock — and how much should I order so I don't?"**

To answer it, the engine walks through a pipeline. Each step feeds the next:

```
12 months of sales
        │
        ▼
Fix stockout months  ──►  "True" demand for each month
        │
        ▼
Weighted average  ──►  Baseline (the typical month)
        │
        ▼
Trend (slope + strength)  ──►  "Sales are going up by X/month"
        │
        ▼        Seasonality  ──►  "September is 1.15× a normal month"
        │
        ▼
Business factors  ──►  "Trekking season +10%, hot weather +5%"
        │
        ▼
Forecast for each of the next 6 months  (+ an 80% confidence range)
        │
        ├──► Days of cover        ("I have 30 days of stock")
        ├──► Reorder amount      ("Buy 50 units")
        ├──► Momentum & velocity ("Accelerating, medium mover")
        ├──► Risks               ("Stockout: low · Overstock: low")
        ├──► Timeline            ("Out on Aug 30 · order by Aug 16")
        └──► Pricing strategy    ("Hold price")
```

---

## 2. Step 0 — The 12 months of history

Every product page starts with **the last 12 months of sales** (outbound stock movements only —
`direction === "out"`; incoming stock is ignored for demand).

For our Trekking Backpack, here is the history (this is what the page's chart shows as "Actual"):

| Month | Raw sales (units) |
|---|---|
| Aug 2025 | 24 |
| Sep 2025 | 20 |
| Oct 2025 | 14 |
| Nov 2025 | 10 |
| Dec 2025 | 12 |
| Jan 2026 | **8** ⚠️ (stockout month) |
| Feb 2026 | 9 |
| Mar 2026 | 12 |
| Apr 2026 | 16 |
| May 2026 | 22 |
| Jun 2026 | 28 |
| Jul 2026 | 30 |
| **Total** | **205** |

> 🍋 **Lemonade stand:** for the last year, every month you counted how many cups of lemonade you
> sold. That list of 12 numbers is the "history". January was a weird month — you ran out of lemons
> for half the month, so you only sold 8 cups even though people wanted more.

---

## 3. Step 1 — Fixing stockout months (availability correction)

**Why we need it:** if the shop was out of stock for part of a month, the sales number is *too small* —
it hides demand. If you train the forecast on a too-small number, you'll under-order later.
The engine fixes that with three small formulas.

**Inputs for a month:**
- `actualOutboundQty` — how many units actually sold that month
- `inStockDays` — how many days that month the product was available (0–31)
- `daysInMonth` — how many days the month has (defaults to the real calendar, e.g. 30)

### Formula 3a — Availability rate

```
availabilityRate = inStockDays ÷ daysInMonth
```

(clamped to stay between 0 and 1)

**Our January example:**
```
availabilityRate = 15 ÷ 31 = 0.4839
```
The product was only available 48% of January.

### Formula 3b — Corrected demand

```
divisor        = max(availabilityRate, 0.70)
correctedDemand = actualOutboundQty ÷ divisor
```

Then the result is **capped** so one bad month can't inflate demand forever:

```
correctedDemand = min(correctedDemand, actualOutboundQty × 1.4)
```

**Our January example:**
```
divisor         = max(0.4839, 0.70) = 0.70
correctedDemand = 8 ÷ 0.70 = 11.43
cap             = 8 × 1.4 = 11.2
final           = min(11.43, 11.2) = 11.2
```

So January is recorded as **11.2** units of demand instead of 8.

### More worked examples (from the engine's own tests)

| Sold | Days in stock / days in month | Rate | Divisor | Raw fix | Cap (×1.4) | **Result** |
|---|---|---|---|---|---|---|
| 42 | 21/30 | 0.7 | 0.7 | 42÷0.7 = 60 | 58.8 | **58.8** |
| 10 | 3/30 | 0.1 | 0.7 | 10÷0.7 = 14.29 | 14 | **14** |
| 100 | 27/30 | 0.9 | 0.9 | 100÷0.9 = 111.11 | 140 | **111.11** |
| 100 | 15/30 | 0.5 | 0.7 | 100÷0.7 = 142.86 | 140 | **140** |

**Rules of thumb:**
- **No availability data at all** → the raw number is used unchanged (no correction).
- **Fully in stock** (rate = 1) → the raw number is used unchanged.
- **Half-in-stock month** → the divisor floor of 0.70 prevents wild inflation: worst case is the 1.4× cap.

After this step, our 12-month history (what the engine actually uses as "corrected demand") is:

| Month | Raw | Corrected demand |
|---|---|---|
| Aug 2025 | 24 | 24 |
| Sep 2025 | 20 | 20 |
| Oct 2025 | 14 | 14 |
| Nov 2025 | 10 | 10 |
| Dec 2025 | 12 | 12 |
| Jan 2026 | 8 | **11.2** |
| Feb 2026 | 9 | 9 |
| Mar 2026 | 12 | 12 |
| Apr 2026 | 16 | 16 |
| May 2026 | 22 | 22 |
| Jun 2026 | 28 | 28 |
| Jul 2026 | 30 | 30 |
| **Total** | **205** | **208.2** |

These two totals appear on the page as **Raw outbound demand = 205** and **Corrected demand = 208**.
The page also shows **Availability rate = 0.48** — that's the average of the availability rates over the
months that had data (only January did, so 0.48 is just January's rate).

---

## 4. Step 2 — The baseline (weighted average)

**The idea:** what is a "normal" month for this product? The obvious answer is the plain average
(208.2 ÷ 12 = 17.35). But recent months matter *more* than old months — the past is a better guide
than the distant past. So the engine uses a **3/2/1 weighted average**: the most recent 3 months
count 3×, the middle 3 months count 2×, and the oldest 6 months count 1×.

### Formula 4a — The weights

For the 12 months (0 = oldest, 11 = newest):

```
w = [1, 1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3]
```

**Our actual weights:**

| i | Month | Value (yᵢ) | Weight (wᵢ) |
|---|---|---|---|
| 0 | Aug 2025 | 24 | 1 |
| 1 | Sep 2025 | 20 | 1 |
| 2 | Oct 2025 | 14 | 1 |
| 3 | Nov 2025 | 10 | 1 |
| 4 | Dec 2025 | 12 | 1 |
| 5 | Jan 2026 | 11.2 | 1 |
| 6 | Feb 2026 | 9 | 2 |
| 7 | Mar 2026 | 12 | 2 |
| 8 | Apr 2026 | 16 | 2 |
| 9 | May 2026 | 22 | 3 |
| 10 | Jun 2026 | 28 | 3 |
| 11 | Jul 2026 | 30 | **3** |

### Formula 4b — The weighted average itself

```
weightedAvg = (y₀·w₀ + y₁·w₁ + … + y₁₁·w₁₁) ÷ (w₀ + w₁ + … + w₁₁)
            = Σ(yᵢ · wᵢ) ÷ Σ(wᵢ)
```

**Our actual numbers:**
```
Σ(yᵢ·wᵢ) = (24 + 20 + 14 + 10 + 12 + 11.2) × 1  =  91.2
         + (9 + 12 + 16) × 2                      =  74.0
         + (22 + 28 + 30) × 3                     = 240.0
         = 405.2

Σ(wᵢ)  = 6×1 + 3×2 + 3×3 = 21

weightedAvg = 405.2 ÷ 21 = 19.30
```

The page shows this as **Monthly avg = 19** (rounded).

> 🍋 **Lemonade stand:** instead of adding all 12 months equally, you give the last 3 months a
> triple vote, the 3 before that a double vote, and the oldest 6 a single vote. July (30 cups)
> matters 3× as much as last August (24 cups).

---

## 5. Step 3 — The trend (line of best fit)

**The idea:** is demand going up, down, or flat? The engine draws a straight line through the 12
months and measures its **slope** — a plain *linear regression* (every month votes equally). This
is the classic "line of best fit":

### Formula 5a — The trend weights

Every month has the same weight:

```
wᵢ = 1   for every month
```

### Formula 5b — The sums (Σx, Σy, Σxy, Σx²)

`x` is the month *number* (1 to 12). `y` is that month's demand.

```
Σx  = 1 + 2 + … + 12 = 78
Σy  = 24 + 20 + … + 30 = 208.2
Σxy = (1×24) + (2×20) + … + (12×30) = 1464.2
Σx² = 1² + 2² + … + 12² = 650
```

### Formula 5c — The slope (the trend itself)

```
slope = ( n·Σxy − Σx·Σy )  ÷  ( n·Σx² − (Σx)² )
        └────── numerator ──────┘   └─────── denominator ────────┘
```

**Our actual numbers:**
```
numerator   = (12 × 1464.2) − (78 × 208.2) = 17570.4 − 16239.6 = 1330.80
denominator = (12 × 650) − 78²             = 7800 − 6084     = 1716.00
slope       = 1330.80 ÷ 1716.00 = 0.78
```

So demand is rising by about **+0.78 units per month**. The page shows this as **Trend = +0.8/mo**.

### Formula 5d — Trend strength (R²)

A slope is only trustworthy if the data really does follow a line. The engine computes an
**R²** ("R-squared") between 0 and 1:

```
ssRes = Σ (yᵢ − predictedᵢ)²        predictedᵢ = meanY + slope × (xᵢ − meanX)
ssTot = Σ (yᵢ − meanY)²
R²    = 1 − ssRes ÷ ssTot
```

**Our actual numbers:**
```
ssRes = 492.16
ssTot = 578.17
R²    = 1 − 492.16 ÷ 578.17 = 0.15
```

The page shows this as **Trend strength = 15%**. (0.15 = 15%.)

### Formula 5e — Deciding the direction (up / down / stable)

A tiny slope isn't a real trend. The engine requires the slope to beat a **threshold**:

```
threshold = |meanY| × 0.02      (2% of the average; falls back to 0.5 only if the average is 0)
```

**Our actual numbers:**
```
threshold = 17.35 × 0.02 = 0.35
```

Then:

| Condition | Direction |
|---|---|
| slope > +0.35 | **up** |

> 💡 The parenthetical in the formula above says "0.5 if the average is zero": the code is
> `Math.abs(meanY) × 0.02 || 0.5`, meaning 0.5 is only a fallback when the average itself is 0
> (no demand at all). It is not a minimum.
>
> 📐 **Note on index bases:** the trend above uses `x = 1…12` (the month number). The prediction
> interval in Step 7 uses a 0-based index (`meanX = (n−1)/2`) internally — both give the same
> fitted line, just different coordinate labels.
| slope < −0.35 | **down** |
| otherwise | **stable** |

Our slope is **+0.78 > 0.35 → direction = "up"** ✅

> 🍋 **Lemonade stand:** each month you sold a little more than the month before. The "slope" is
> how many extra cups per month. "Strength" is how consistent that growth was — 15% means the ups
> and downs are fairly noisy, but the line still points up. Direction says: the line is pointing up.

---

## 6. Step 4 — Seasonality (the "month personality")

**The idea:** every product has a personality per month — umbrellas sell in rainy months, tents in
summer. The engine compares each calendar month's average to the overall average and gets a
**seasonal factor**: 1.0 = normal, 1.4 = 40% above normal, 0.6 = 40% below normal.

### Formula 6a — The overall average

```
overallAvg = (sum of all 12 corrected demands) ÷ 12
```

**Our actual number:** `overallAvg = 208.2 ÷ 12 = 17.35`

### Formula 6b — Each month's raw factor

```
monthAvg   = average demand for that calendar month (across all years of history)
rawFactor  = monthAvg ÷ overallAvg
```

Since we have exactly one year of history, each month has just one value:

| Month | monthAvg | rawFactor (monthAvg ÷ 17.35) |
|---|---|---|
| Jan | 11.2 | 0.646 |
| Feb | 9 | 0.519 |
| Mar | 12 | 0.692 |
| Apr | 16 | 0.922 |
| May | 22 | 1.268 |
| Jun | 28 | 1.614 |
| Jul | 30 | 1.729 |
| **Aug** | **24** | **1.383** |
| Sep | 20 | 1.153 |
| Oct | 14 | 0.807 |
| Nov | 10 | 0.576 |
| Dec | 12 | 0.692 |

### Formula 6c — The factor is used as-is (no smoothing)

Some models blend each month with its neighbours to "smooth" out noise. This engine does **not** —
the raw factor from Formula 6b is used directly. Each calendar month stands on its own:

```
factor = rawTarget
```

**Our actual number for September (the next forecast month):**
```
factor = 20 ÷ 17.35 = 1.153
```

### Formula 6d — Clamping (never let seasonality go crazy)

```
seasonalityFactor = clamp(rawFactor, 0.5, 2.0)
```

September: `clamp(1.153, 0.5, 2.0) = 1.153` — no change. The page shows **Seasonality = ×1.15**.
(If a factor computed to 2.3 it would be cut to 2.0; if 0.3 it would be raised to 0.5.)

**All 12 raw + clamped factors** (these are what the engine actually uses):

| Month | Raw (= factor) | Clamped (used) |
|---|---|---|
| Jan | 0.646 | 0.646 |
| Feb | 0.519 | 0.519 |
| Mar | 0.692 | 0.692 |
| Apr | 0.922 | 0.922 |
| May | 1.268 | 1.268 |
| Jun | 1.614 | 1.614 |
| Jul | 1.729 | 1.729 |
| Aug | 1.383 | 1.383 |
| Sep | 1.153 | **1.153** |
| Oct | 0.807 | 0.807 |
| Nov | 0.576 | 0.576 |
| Dec | 0.692 | 0.692 |

> 🍋 **Lemonade stand:** August is a hot, busy month, so it always sells ~38% more than average
> (factor 1.38). November is quiet (~0.58×). Every month's factor is its own raw number — a busy
> month stays busy and a quiet month stays quiet; there is no neighbour blending.

---

## 7. Step 5 — Business factors (multipliers from you)

The page lets you nudge the forecast with five optional factors (each defaults to 1.0 = no effect):

| Factor | Meaning | Allowed range |
|---|---|---|
| `trekkingSeasonIndex` | Is it trekking season? | 0.85 – 1.20 |
| `weatherIndex` | Weather-driven demand | 0.80 – 1.25 |
| `promotionLift` | A promo is running | 1.00 – 1.35 |
| `regionalDemandIndex` | Demand by region | 0.75 – 1.30 |
| `eventLift` | Big event boost | 1.00 – 1.25 |

### Formula 7a — Combined factor

```
factorsMultiplied = trekking × weather × promotion × regional × event
```

### Formula 7b — Applied to the baseline

```
adjusted = baseline × factorsMultiplied
final    = clamp(adjusted, baseline × 0.70, baseline × 1.50)
```

The clamp means factors can only move the forecast **between 70% and 150%** of the baseline,
no matter what you type.

**Worked example (September 2026):** suppose you set trekking season = 1.10 and weather = 1.05:
```
factorsMultiplied = 1.10 × 1.05 × 1.0 × 1.0 × 1.0 = 1.155
baseline          = 35.48          (computed in Step 6 below)
adjusted          = 35.48 × 1.155 = 40.98
clamp range       = 35.48×0.70 = 24.84  …  35.48×1.50 = 53.22
final             = 40.98  (inside the range, so unchanged)  → page shows 41
```

In the main example for this document we set **no factors**, so `factorsMultiplied = 1`
and the forecast stays at baseline.

> 🍋 **Lemonade stand:** "it's summer AND the town fair is this week" — so you plan to make a bit
> more. But the recipe refuses to go below 70% or above 150% of normal, so one lucky day can't
> make you buy a truckload of lemons.

---

## 8. Step 6 — The monthly forecast, month by month

Now the engine builds a forecast for each of the next 6 months (Sep 2026 … Feb 2027).
For month number `i` (1 = next month):

### Formula 8a — Trend contribution

The forecast starts from **the 12-month weighted baseline** (from Step 2, `weightedBaseline` = 19.30
for our example) and adds the trend, month by month. Anchoring on the weighted baseline instead of a
single month means one noisy month can't swing the whole forecast:

```
trendContribution  = slope × i
baselinePlusTrend  = weightedBaseline + trendContribution  (weightedBaseline = 19.30)
```

**Our actual numbers:**

| Month | i | trendContribution (0.78 × i) | lastMonthPlusTrend (30 + contrib) |
|---|---|---|---|
| Sep 2026 | 1 | 0.78 | 30.78 |
| Oct 2026 | 2 | 1.56 | 31.56 |
| Nov 2026 | 3 | 2.34 | 32.34 |
| Dec 2026 | 4 | 3.12 | 33.12 |
| Jan 2027 | 5 | 3.90 | 33.90 |
| Feb 2027 | 6 | 4.68 | 34.68 |

> The trend contribution grows by exactly `slope` each month (0.78 → 4.68). There is no
> dampening — the trend keeps pushing at the same rate the whole horizon.
>
> 📝 The numeric worked examples throughout this document were generated before the anchor change
> (the baseline was previously anchored on the last completed month instead of the 12-month weighted
> baseline). Re-run `node scripts/forecast-doc-examples.ts` to regenerate the exact figures for the
> current anchor — the formulas above are the ones the engine actually uses.

### Formula 8b — The baseline for the month

```
baseline = max(0, baselinePlusTrend) × seasonalityFactor(month)
```

**Our actual numbers (using the seasonality factors from Step 4):**

| Month | lastMonthPlusTrend | × seasonality | = **baseline** |
|---|---|---|---|
| Sep 2026 | 30.78 | × 1.153 | **35.48** → 35 |
| Oct 2026 | 31.56 | × 0.807 | **25.47** → 25 |
| Nov 2026 | 32.34 | × 0.576 | **18.64** → 19 |
| Dec 2026 | 33.12 | × 0.692 | **22.91** → 23 |
| Jan 2027 | 33.90 | × 0.646 | **21.88** → 22 |
| Feb 2027 | 34.68 | × 0.519 | **17.99** → 18 |

### Formula 8c — Final forecast (with factors)

With no business factors this equals the baseline. (With factors: Step 5, `final = clamp(baseline × factors, 0.7×baseline, 1.5×baseline)`.)

### Formula 8d — Daily rate

```
dailyRate = finalForecast ÷ daysInMonth(month)
```

**Our actual numbers:**

| Month | final | days | **dailyRate** |
|---|---|---|---|
| Sep 2026 | 35 | 30 | **1.2/day** |
| Oct 2026 | 25 | 31 | **0.8/day** |
| Nov 2026 | 19 | 30 | **0.6/day** |
| Dec 2026 | 23 | 31 | **0.7/day** |
| Jan 2027 | 22 | 31 | **0.7/day** |
| Feb 2027 | 18 | 28 | **0.6/day** |

### Formula 8e — Stock required (to cover the month)

```
stockRequired = max(0, finalForecast)
```

### Formula 8f — Monthly safety stock

The engine wants a buffer on top of the forecast (default `safetyStockDays = 30`):

```
monthlySafetyStock = dailyRate × safetyStockDays
```

### Formula 8g — Projected stock after the month

```
projectedStockAfter = max(0, runningStock − finalForecast)
```

`runningStock` starts at your on-hand stock (30) and becomes last month's `projectedStockAfter`.

### Formula 8h — Suggested order for the month

If the running stock can't cover the forecast **plus** the safety buffer, suggest a top-up:

```
if runningStock < final + monthlySafetyStock:
    suggestedOrder = ceil(final + monthlySafetyStock − runningStock)
else:
    suggestedOrder = 0
```

**Our actual numbers for the full 6-month table** (all from the real engine output):

| Month | final | daily | stock req | safety | running before | shortfall | **suggested order** | projected after |
|---|---|---|---|---|---|---|---|---|
| Sep 2026 | 35 | 1.2 | 35 | 36 | 30 | 41 | **41** | 0 |
| Oct 2026 | 25 | 0.8 | 25 | 24 | 0 | 49 | **51** | 0 |
| Nov 2026 | 19 | 0.6 | 19 | 18 | 0 | 37 | **38** | 0 |
| Dec 2026 | 23 | 0.7 | 23 | 21 | 0 | 44 | **46** | 0 |
| Jan 2027 | 22 | 0.7 | 22 | 21 | 0 | 43 | **44** | 0 |
| Feb 2027 | 18 | 0.6 | 18 | 18 | 0 | 36 | **38** | 0 |

> 💡 **Why October shows "shortfall 49" but "suggested order 51"?** The shortfall column is computed
> from the *displayed* (rounded) values (25 + 24 = 49), but the suggested order is computed from the
> *unrounded* forecast (true demand 25.47, true daily rate 0.82/day → 25.47 + 24.60 − 0 = 50.07 →
> rounded up to 51). The engine always uses the unrounded numbers internally and only rounds for display.

> 🍋 **Lemonade stand:** September needs 35 cups, plus 36 cups of spare lemons just in case = 71 cups
> needed. You have 30 → you need 41 more. October needs even more because last month you already used
> everything up.

---

## 9. Step 7 — The prediction interval (the "probably" range)

Forecasts are guesses, so the page shows an **80% confidence range**: "we're 80% sure demand lands
between these two numbers." The engine builds it from how badly the straight line failed in the past.

### Formula 9a — Residuals (how wrong the line was each month)

The engine uses a simple (unweighted) line `fittedᵢ = avg + slope × i` for this step:

```
residualᵢ = yᵢ − fittedᵢ
```

**Our actual residuals:** `[4.70, −0.08, −6.86, −11.64, −10.42, −12.00, −14.98, −12.76, −9.54, −4.32, 0.90, 2.12]`

### Formula 9b — Standard error of the estimate (se)

```
mse = Σ(residualᵢ²) ÷ (n − 2)      n = 12
se  = √mse
```

**Our actual numbers:**
```
mse = 95.94
se  = √95.94 = 9.79
```

### Formula 9c — Standard error of prediction (sePred)

The further into the future you forecast, the wider the range. With `z = 1.28` (the 80% z-score),
`meanX = (n−1)/2 = 5.5`, and `ssx = Σ(i − meanX)² = 143`:

```
sePred = se × √( 1 + 1/n + (forecastIndex − meanX)² ÷ ssx )
```

**Our actual numbers for September 2026 (`forecastIndex = 12`, one month ahead of the data):**
```
sePred = 9.79 × √( 1 + 1/12 + (12 − 5.5)² ÷ 143 )
       = 9.79 × √(1.0833 + 0.2955)
       = 9.79 × 1.1742
       = 11.50
```

### Formula 9d — The interval, centered on the forecast

```
halfWidth = round(z × sePred)          z = 1.28
low  = max(0, center − halfWidth)
high = center + halfWidth
```

`center` is the (unrounded) forecast for that month — for September: **35.48**.

**Our actual numbers:**
```
halfWidth = round(1.28 × 11.50) = round(14.72) = 15
low       = max(0, 35.48 − 15)  = 20.48
high      = 35.48 + 15          = 50.48
```

> 💡 The page renders the raw interval values (e.g. 3.14 – 63.14); the numbers in the table below
> are rounded to one decimal for readability.

**The 80% prediction interval for every forecast month (from the engine):**

| Month | Forecast | 80% low | 80% high |
|---|---|---|---|
| Sep 2026 | 35 | 20.5 | 50.5 |
| Oct 2026 | 25 | 10.5 | 40.5 |
| Nov 2026 | 19 | 2.6 | 34.6 |
| Dec 2026 | 23 | 6.9 | 38.9 |
| Jan 2027 | 22 | 4.9 | 38.9 |
| Feb 2027 | 18 | 0 | 36.0 |

> Notice the intervals get **wider** over time (the `(forecastIndex − meanX)²` term grows).
> That's the engine being honest: the further away, the less certain.

> 🍋 **Lemonade stand:** last year your guesses were off by about 20 cups on average. So this year
> you say "I'll probably sell 34 cups, but really it'll be between 4 and 64." A wide range = a
> brave guess. (If you'd sold the exact same amount every month, the range would be tiny.)

**Small-history rule:** if there are fewer than 3 months of history, the engine can't fit a line,
so it falls back to a simple ±30% range: `low = center×0.7`, `high = center×1.3`.

---

## 10. Step 8 — Days of cover (how many days of stock)

**The question:** "At my forecast selling speed, how many days will my current stock last?"

### Formula 10a — The forward daily rate (weighted, 3 months)

A single month's rate can be misleading (December is a peak), so the engine averages the first 3
forecast months' daily rates, giving more weight to the **nearer** months (weights 3, 2, 1):

```
coverDailyRate = (r₁×3 + r₂×2 + r₃×1) ÷ (3 + 2 + 1)
```

**Our actual numbers (Sep 1.2, Oct 0.8, Nov 0.6):**
```
coverDailyRate = (1.2×3 + 0.8×2 + 0.6×1) ÷ 6
               = (3.6 + 1.6 + 0.6) ÷ 6
               = 5.8 ÷ 6 = 0.97/day
```

*(Fallback: if no positive forecast rate exists, the engine uses the recent 3-month history average
÷ 30 = 26.67 ÷ 30 = 0.89/day.)*

### Formula 10b — Days of cover

```
daysOfCover = round(inventoryPosition ÷ coverDailyRate)
```

**Our actual numbers:**
```
inventoryPosition = stock on hand + confirmed inbound − committed customer orders
                  = 30 + 0 − 0 = 30
daysOfCover       = round(30 ÷ 0.97) = 31 days
```

The page shows **Days cover = 31d**.

> 🍋 **Lemonade stand:** you have 30 cups of lemonade and you sell ~1 cup a day → you'll last
> about 30 days. (If a big order was already promised to a customer, we'd subtract it; if a
> delivery is already on its way, we'd add it.)

---

## 11. Step 9 — The reorder recommendation (how much to buy)

**The question:** "How many units should I order right now?" The answer must cover:

1. **Lead time demand + safety stock** — what you'll sell while waiting for the order (14 days),
   plus a buffer against demand surprises.
2. **Minus what you already have.**

### Formula 11a — The daily average demand

The engine uses the **last 3 completed calendar months** of corrected demand (the current partial
month is excluded so a half-finished month can't skew the rate):

```
dailyAverage = (May + Jun + Jul demand) ÷ (their calendar days)
             = (22 + 28 + 30) ÷ (31 + 30 + 31)
             = 80 ÷ 92 = 0.87/day
```

### Formula 11b — Required stock & safety stock

```
requiredStock = dailyAverage × (supplierLeadTimeDays + safetyStockDays)
safetyStock   = round(dailyAverage × safetyStockDays)
```

**Our actual numbers:**
```
requiredStock = 0.87 × (14 + 30) = 38.26 units
safetyStock   = round(0.87 × 30) = 26 units
```

### Formula 11c — The recommendation, step by step

```
recommended = max(0, requiredStock − inventoryPosition)
```

**Main example (stock = 30):**
```
recommended = max(0, 38.26 − 30) = 8.26  → page rounds up to 9
```

**Low-stock example (stock = 5):**
```
recommended = max(0, 38.26 − 5) = 33.26  → page rounds up to 34
```

### Formula 11d — The "caps and rules" pass (in order)

1. **Max cover cap** — never order so much that you'd hold more than `maxCoverDays` of stock
   (unless the product is a protected core item):

   ```
   maxStock  = dailyForecast × maxCoverDays
   headroom  = max(0, maxStock − inventoryPosition)
   recommended = min(recommended, headroom)
   ```

   **Example (stock = 400, maxCoverDays = 180):**
   ```
   maxStock = 1.2 × 180 = 216
   headroom = max(0, 216 − 400) = 0
   recommended = min(big, 0) = 0  → and overstock risk = high
   ```

2. **Minimum order quantity (MOQ)** — if you order at all, order at least the MOQ:
   ```
   if recommended > 0:  recommended = max(recommended, minimumOrderQty)
   ```

3. **Order multiple** — round *up* to the nearest multiple (e.g. boxes of 25):
   ```
   recommended = ceil(recommended ÷ orderMultiple) × orderMultiple
   ```
   (If no multiple set, just `ceil(recommended)`.)

**Low-stock example with MOQ 50 and multiple 25:**
```
33.3 → MOQ → max(33.3, 50) = 50 → multiple → ceil(50÷25)×25 = 50
```

The page shows **Reorder now = 50** for that scenario, and the reorder value is
`50 × unit cost = 50 × $25 = $1,250`.

> 🍋 **Lemonade stand:** to reorder lemons you need: enough for the 14 days while the delivery
> comes plus a spare buffer (26 cups), minus what you have. If you have 30, buy 9. If you have 5,
> buy 34… but the lemon guy only sells boxes of 25 and minimum 50, so you buy 50. And if you
> already have 400 cups, don't buy anything at all!

---

## 12. Step 10 — Momentum (is demand speeding up or slowing down?)

**The question:** how is the *recent* demand doing compared to the overall average?

### Formula 12a — Recent 3-month average

```
recent3MonthAvg = (May + Jun + Jul demand) ÷ 3
```

**Our actual numbers:** `(22 + 28 + 30) ÷ 3 = 26.67`

### Formula 12b — Thresholds vs the baseline

```
overallAvg (the weighted baseline) = 19.30
threshold120pct = 19.30 × 1.2 = 23.15
threshold60pct  = 19.30 × 0.6 = 11.58
```

### Formula 12c — The tag

| Condition | Momentum tag |
|---|---|
| recent3MonthAvg = 0 | `inactive` |
| recent3MonthAvg ≥ 23.15 (120%) | `accelerating` |
| recent3MonthAvg ≥ 11.58 (60%) | `stable` |
| otherwise | `declining` |

**Our actual result:** `26.67 ≥ 23.15` → **`accelerating`** ✅ (page shows "Accelerating")

> 🍋 **Lemonade stand:** the last 3 months you sold 26.7 cups/month but your usual is 19.3.
> That's more than 20% above normal → demand is "accelerating" — people suddenly want more.

---

## 13. Step 11 — Velocity (how fast this product sells vs its category)

**The question:** is this product a star seller, average, or a shelf warmer — *compared to other
products in the same category*? The page computes this for ALL products together, then labels each.

### Formula 13a — Rank within category

1. Group products by category (products with no category share one bucket).
2. Sort each group by `recent3MonthAvg`, highest first.
3. For each product at rank position `i` (0-based) in a group of `total`:

```
position = (i + 1) ÷ total
```

### Formula 13b — The labels

| Condition | Velocity tag |
|---|---|
| recent3MonthAvg = 0 | `dead` |
| position ≤ 0.2 (top 20%) | `fast_mover` |
| position ≤ 0.5 (next 30%) | `medium_mover` |
| otherwise | `slow_mover` |

**Our actual example (the Backpacks category):**

| SKU | recent 3-mo avg | position | **Velocity** |
|---|---|---|---|
| TB-1002 | 40 | 1÷5 = 0.20 | **fast_mover** |
| **TB-1001 (ours)** | **26.67** | **2÷5 = 0.40** | **medium_mover** |
| TB-1005 | 22 | 3÷5 = 0.60 | slow_mover |
| TB-1003 | 15 | 4÷5 = 0.80 | slow_mover |
| TB-1004 | 0 | — | dead |

**Uncategorised example:** HP-2001 (avg 33) and HP-2002 (avg 5) share the no-category bucket →
HP-2001 is rank 1 of 2 → 0.50 → `medium_mover`; HP-2002 → rank 2 of 2 → 1.0 → `slow_mover`.

> 🍋 **Lemonade stand:** if you sell 27 cups a month but your friend sells 40, you're the
> "medium" seller. If nobody in your street sells any, you'd be the "fast" one. Velocity is
> always about your neighborhood, not about the absolute number.

---

## 14. Step 12 — Risks (stockout & overstock)

### Formula 14a — Coverage ratio & stockout risk

```
coverVsLead = daysOfCover ÷ max(supplierLeadTimeDays, 1)
```

**Our actual numbers:** `coverVsLead = 31 ÷ 14 = 2.21`

| Condition | Stockout risk |
|---|---|
| coverVsLead < 1.0 | **high** (you'll run out before new stock arrives) |
| coverVsLead < 1.5 | **medium** |
| otherwise | **low** |

Our 2.21 → **low** ✅

### Formula 14b — Overstock risk

```
maxCoverDays (default 180)
```

| Condition | Overstock risk |
|---|---|
| daysOfCover = ∞ AND stock > 0 | **high** |
| daysOfCover > 180 | **high** |
| daysOfCover > 180 × 0.75 = 135 | **medium** |
| otherwise | **low** |

Our daysOfCover = 31 → **low** ✅
(The 400-unit example from Step 11: 400 > 180 → **high**.)

> 🍋 **Lemonade stand:** 31 days of stock vs a 14-day delivery = you're safe (2.21× covered).
> If you only had 10 days of stock, that's less than 14 → high risk of running out.

---

## 15. Step 13 — The timeline

The page shows three important dates.

### Formula 15a — Estimated stockout date

The stockout date is simply **today + days of cover** — the days-of-cover number already
computed in Step 8 tells you how many days of stock you have left, so the date you run out is
exactly that many days from today.

```
estimatedStockoutDate = today + daysOfCover days
```

**Our actual numbers:**
```
daysOfCover           = 31 days          (from Step 8)
estimatedStockoutDate = 2026-08-04 + 31 days = 2026-09-04
```

*(If stock is already 0, the stockout date is today. If there is no forecast demand at all
(daysOfCover = ∞), there is no stockout date and the SKU shows as "Sufficient".)*

### Formula 15b — Reorder-by date (last safe day to order)

```
reorderByDate = estimatedStockoutDate − supplierLeadTimeDays
```

**Our actual numbers:** `2026-09-04 − 14 days = 2026-08-21`

### Formula 15c — Next refill date (if you ordered today)

```
nextRefillDate = today + supplierLeadTimeDays
```

**Our actual numbers:** `2026-08-04 + 14 days = 2026-08-18`

### Formula 15d — Stockout urgency

| Condition | Urgency |
|---|---|
| stock ≤ 0, or reorderByDate ≤ today | `critical` |
| reorderByDate ≤ today + supplierLeadTimeDays | `warning` |
| otherwise | `safe` |

**Our actual numbers:** reorderByDate (Aug 21) > today + 14 days (Aug 18) → **`safe`** ✅

> 🍋 **Lemonade stand:** you have 31 days of stock, so you'll run out on Sep 4. The lemon man
> takes 14 days, so you must order by Aug 21 at the very latest. Since that's comfortably in the
> future, the page rates you "safe". If the date ever slips inside the 14-day delivery window the
> page would warn, and past Aug 21 it would scream "CRITICAL".

---

## 16. Step 14 — Pricing strategy (what to do with the price)

Finally, the page suggests a pricing move based on **velocity**, **momentum**, **days of cover**,
and your margins.

### Formula 16a — Minimum permitted price (unit-price margin floor)

The floor is the price that **preserves the configured gross margin** on each sale. Treating the
current unit price as the base you must recover, the margin is measured against the selling
price: `m = (floor − unitPrice) ÷ floor`. Solving for the floor gives **minimum price =
unit price ÷ (1 − margin)**. A 40% margin on a $100 price gives a $166.67 floor — never below
that. The **unit cost does not affect this number**.
Each product can override this with its own margin; products without their own value inherit the
catalogue-wide **default minimum margin** set on the Products page (default 40%).

```
minimumGrossMargin = clamp(minimumGrossMarginPercentage, 0.01, 0.99)   (default 0.40)
minimumPrice       = unitPrice ÷ (1 − minimumGrossMargin)
```

**Our actual numbers:**
```
minimumPrice = $59.99 ÷ (1 − 0.40) = $59.99 ÷ 0.60 = $99.98
```

So you must never price below **$99.98** — the price that keeps the 40% margin intact.
(Current price is $59.99, which is below that floor, so the page flags it
"Below min permitted — margin at risk".)

### Formula 16b — Inventory position

```
if daysOfCover < leadTime + safetyStockDays  →  "low"
else if daysOfCover > maxCoverDays           →  "high"
else                                          →  "normal"
```

**Our actual numbers:** `31 < 14 + 30 = 44` → **low** stock position.

### Formula 16c — The decision rules (checked in order)

| Rule | Condition | Strategy → Action |
|---|---|---|
| Clearance | dead/inactive AND stock high | **Clearance** → cut price 20–40% |
| Markdown | slow mover + declining + high stock | **Markdown / Promotion** → cut 10–20% |
| Targeted promo | slow mover + stable | **Targeted promotion** → cut 5–10% or bundle |
| Hold price | medium mover + stable | **Hold price** → no change |
| Protect margin | fast mover + accelerating + low stock | **Protect margin** → maybe raise 3–5% |
| Hold availability | fast mover + stable | **Hold price / protect availability** → no discount |
| Monitor | fast mover + declining | **Monitor** → hold price, watch it |
| Default | anything else | **Hold price** |

**Our actual result (medium mover + accelerating):** no rule matches exactly → default →
**"Hold price"**. Reason shown on page: *"Medium-moving, accelerating demand."* Because the
current price ($59.99) sits below the $99.98 floor, the suggested action becomes *"No % change
recommended — current price is below the margin floor; raise to at least $99.98 to protect
margin"*.

**Worked clearance example:** a dead product (velocity `dead`, momentum `inactive`) with 250 days
of cover, unit price $10:
```
minimumPrice = $10 ÷ (1 − 0.40) = $10 ÷ 0.60 = $16.67
strategy     = Clearance → "Reduce price by 20% to 40% (min $16.67)"
```

> 🍋 **Lemonade stand:** if your lemonade is the fastest seller in town, don't discount it. If
> it's gathering dust with tons of stock, slash the price to move it. The page just checks your
> situation against a list of rules and picks the right one.

---

## Appendix A — All formulas in one place

**Availability correction**
```
availabilityRate = clamp(inStockDays ÷ daysInMonth, 0, 1)
corrected        = min(actual ÷ max(availabilityRate, 0.70), actual × 1.4)
```

**Weighted average (baseline)** — 3/2/1 step weights (newest 3 = 3, middle 3 = 2, oldest 6 = 1)
```
w = [1, 1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3]
weightedAvg = Σ(yᵢ·wᵢ) ÷ Σ(wᵢ)
```

**Trend** — least-squares slope (textbook closed form; x = month index 1..12)
```
slope = (n·Σxy − Σx·Σy) ÷ (n·Σx² − (Σx)²)
R²    = 1 − Σ(yᵢ−predᵢ)² ÷ Σ(yᵢ−meanY)²        predᵢ = meanY + slope(xᵢ−meanX)
threshold = |meanY| × 0.02    direction: slope>+t → up · slope<−t → down · else stable
```

**Seasonality**
```
overallAvg = Σyᵢ ÷ 12
factorᵢ    = monthAvgᵢ ÷ overallAvg        (raw factor, no neighbor smoothing)
factorᵢ    = clamp(factorᵢ, 0.5, 2.0)
```

**Factors**
```
adjusted = baseline × (trekking × weather × promotion × regional × event)
final    = clamp(adjusted, baseline × 0.70, baseline × 1.50)
```

**Monthly forecast** (month i = 1…6)
```
trendContribution = slope × i
baseline          = max(0, weightedBaseline + trendContribution) × seasonalityFactor
final             = clamp(baseline × factors, 0.7×baseline, 1.5×baseline)
dailyRate         = final ÷ daysInMonth
stockRequired     = max(0, final)
monthlySafety     = dailyRate × safetyStockDays
projectedAfter    = max(0, runningStock − final)
suggestedOrder    = runningStock < final + monthlySafety ? ceil(final + monthlySafety − runningStock) : 0
```

**Prediction interval (80%)** — `z = 1.28`, `meanX = (n−1)/2`, `ssx = Σ(i−meanX)²`
```
se      = √( Σ(yᵢ − (avg + slope·i))² ÷ (n−2) )
sePred  = se × √(1 + 1/n + (forecastIndex − meanX)² ÷ ssx)
half    = round(z × sePred)
low     = max(0, center − half)    high = center + half
```

**Days of cover**
```
coverDailyRate = (r₁×3 + r₂×2 + r₃×1) ÷ 6
daysOfCover    = round(inventoryPosition ÷ coverDailyRate)
inventoryPosition = stock + confirmedInbound − committedOrders
```

**Reorder**
```
dailyAverage   = Σ(last 3 completed months' demand) ÷ Σ(their calendar days)
requiredStock  = dailyAverage × (supplierLeadTimeDays + safetyStockDays)
safetyStock    = round(dailyAverage × safetyStockDays)     (safetyStockDays from product)
recommended    = max(0, requiredStock − inventoryPosition)
recommended    = min(recommended, max(0, dailyForecast×maxCoverDays − inventoryPosition))   [unless protected]
recommended    = max(recommended, minimumOrderQty)                                          [if > 0]
recommended    = ceil(recommended ÷ orderMultiple) × orderMultiple                          [round up]
```

**Momentum**
```
recent = (last 3 months) ÷ 3
accelerating if recent ≥ baseline × 1.2 · stable if ≥ baseline × 0.6 · else declining · 0 = inactive
```

**Velocity (per category)**
```
position = (rank + 1) ÷ groupSize
dead if recent = 0 · fast if ≤ 0.2 · medium if ≤ 0.5 · slow otherwise
```

**Risks**
```
coverVsLead   = daysOfCover ÷ max(lead, 1)        <1 high · <1.5 medium · else low
overstock     = daysOfCover > maxCover → high · > 0.75×maxCover → medium · else low
```

**Timeline**
```
stockoutDate      = today + daysOfCover
reorderByDate     = stockoutDate − leadTime
nextRefillDate    = today + leadTime
critical if stock ≤ 0 or reorderByDate ≤ today · warning if reorderByDate ≤ today + lead · else safe
```

**Pricing**
```
minimumPrice = unitPrice ÷ (1 − minGrossMargin)     (unit cost does not affect the floor)
low if cover < lead + safetyDays · high if cover > maxCoverDays · else normal
+ the 8 decision rules in Step 14
```

---

## Appendix B — Constants and default values

| Constant | Value | Where used |
|---|---|---|
| Baseline weights | 3 / 2 / 1 (newest 3 / middle 3 / oldest 6) | weighted average |
| Trend weights | equal — plain linear regression | trend slope |
| Trend dampening | none (`slope × i`) | trend contribution per month |
| Seasonality mode | raw per-month factor (no neighbor smoothing) | seasonal factors |
| Seasonality clamp | 0.5 – 2.0 | seasonal factors |
| Factor clamp | 0.7× – 1.5× baseline | business factors |
| Confidence level | 80% (`z = 1.28`) | prediction interval |
| Small-history fallback | ±30% | prediction interval (n < 3) |
| Availability divisor floor | 0.70 | availability correction |
| Availability cap | 1.4× actual | availability correction |
| Safety stock formula | `dailyForecast × safetyStockDays` | reorder safety stock |
| Safety stock days (default) | 30 (per-product field in the catalogue) | monthly safety stock & reorder |
| Max cover days (default) | 180 | overstock risk & reorder cap |
| Cover-rate weights | 3, 2, 1 (near → far) | days of cover |
| Momentum thresholds | 120% / 60% of baseline | momentum tag |
| Velocity cutoffs | 20% / 50% of category rank | velocity tag |
| History length | 12 months | everything |
| Forecast horizon | 6 months | the forecast table |
| Default gross margin floor | 40% | pricing strategy |

---

## Appendix C — How to reproduce these exact numbers

The engine is pure TypeScript with no dependencies, so it runs anywhere Node ≥ 23.6 is installed
(type-stripping is enabled by default there; no `bun`, no npm install needed):

```bash
# from the project root
cd frontend
node scripts/forecast-doc-examples.ts        # main worked example (this document's numbers)
node scripts/forecast-doc-examples-extra.ts  # supplementary examples (reorder caps, PI internals)
```

And to rebuild the HTML copy from the Markdown:

```bash
cd frontend
node scripts/md2html.mjs
```

The engine also ships with its own test suite:

```bash
cd frontend
bun src/lib/forecast-engine.tests.ts     # if bun is installed
```

Key source files:

- **Engine:** `frontend/src/lib/forecast-engine.ts`
- **Page:** `frontend/src/routes/app.forecast.tsx`
- **Tests:** `frontend/src/lib/forecast-engine.tests.ts`
- **Reproducible examples:** `frontend/scripts/forecast-doc-examples.ts`, `frontend/scripts/forecast-doc-examples-extra.ts`

---

## Glossary — the words we use

| Word | Plain meaning |
|---|---|
| **Demand** | How many units people want to buy |
| **Stock / inventory** | How many units you have |
| **On hand** | Stock physically in your shop/warehouse now |
| **Stockout** | Running out of stock (you can't sell) |
| **Lead time** | Days between placing an order and it arriving |
| **Baseline** | The "normal" monthly demand number |
| **Trend / slope** | How much demand changes per month (up or down) |
| **Trend strength (R²)** | How reliably the data follows the trend (0–100%) |
| **Seasonality factor** | Month multiplier vs normal (1.0 = normal) |
| **Weighted average** | Average where recent months count more |
| **Safety stock** | Extra buffer stock for surprises |
| **Days of cover** | How many days current stock lasts at forecast speed |
| **Reorder / recommendedReorder** | Units you should order now |
| **MOQ** | Minimum order quantity (supplier rule) |
| **Order multiple** | Rounding rule (e.g. boxes of 25) |
| **Prediction interval** | The "probably between X and Y" range |
| **Momentum** | Recent demand vs your own history (accelerating/stable/declining) |
| **Velocity** | Your sales vs others in the same category (fast/medium/slow/dead) |
| **Overstock** | Holding way more stock than you need |
| **Gross margin** | (Price − Cost) ÷ Price — profit share of each sale |
| **Confirmed inbound** | Stock already ordered, arriving soon |
| **Committed orders** | Stock already promised to customers |

---

*Generated from the real output of `forecastSKU()` in `frontend/src/lib/forecast-engine.ts` on 2026-08-04.*
