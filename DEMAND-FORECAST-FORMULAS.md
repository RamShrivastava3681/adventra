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
| Today's date | 2026-07-31 |

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
5. [Step 3 — The trend (weighted line of best fit)](#5-step-3--the-trend-weighted-line-of-best-fit)
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
        ▼
Seasonality  ──►  "August is 1.40× a normal month"
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
than the distant past. So the engine computes an **exponentially weighted average**: recent months
count more, old months count less, smoothly.

### Formula 4a — The weights

For month number `i` (counting 0 = oldest, 11 = newest), with decay `d = 0.3`:

```
weight_i = e^(d × (i − n + 1))          where n = 12 months
```

`e` is Euler's number ≈ 2.71828. For the newest month: `e^0 = 1` (full weight).
For the oldest month: `e^(0.3 × (0 − 12 + 1)) = e^(−3.3) ≈ 0.0369`.

**Our actual weights:**

| i | Month | Value (yᵢ) | Weight (wᵢ) |
|---|---|---|---|
| 0 | Aug 2025 | 24 | 0.0369 |
| 1 | Sep 2025 | 20 | 0.0498 |
| 2 | Oct 2025 | 14 | 0.0672 |
| 3 | Nov 2025 | 10 | 0.0907 |
| 4 | Dec 2025 | 12 | 0.1225 |
| 5 | Jan 2026 | 11.2 | 0.1653 |
| 6 | Feb 2026 | 9 | 0.2231 |
| 7 | Mar 2026 | 12 | 0.3012 |
| 8 | Apr 2026 | 16 | 0.4066 |
| 9 | May 2026 | 22 | 0.5488 |
| 10 | Jun 2026 | 28 | 0.7408 |
| 11 | Jul 2026 | 30 | **1.0000** |

### Formula 4b — The weighted average itself

```
weightedAvg = (y₀·w₀ + y₁·w₁ + … + y₁₁·w₁₁) ÷ (w₀ + w₁ + … + w₁₁)
            = Σ(yᵢ · wᵢ) ÷ Σ(wᵢ)
```

**Our actual numbers:**
```
Σ(yᵢ·wᵢ) = 24×0.0369 + 20×0.0498 + 14×0.0672 + 10×0.0907 + 12×0.1225
         + 11.2×0.1653 + 9×0.2231 + 12×0.3012 + 16×0.4066 + 22×0.5488
         + 28×0.7408 + 30×1.0
         = 81.99

Σ(wᵢ)  = 3.7529

weightedAvg = 81.99 ÷ 3.7529 = 21.85
```

The page shows this as **Monthly avg = 22** (rounded).

> 🍋 **Lemonade stand:** instead of adding all 12 months equally, you say "last month counts fully,
> the month before counts 74%, the month before that 55%…" — older months get smaller and smaller
> votes. July (30 cups) matters much more than last August (24 cups).

---

## 5. Step 3 — The trend (weighted line of best fit)

**The idea:** is demand going up, down, or flat? The engine draws a straight line through the 12
months and measures its **slope**. But like the average, it lets recent months vote more strongly
(exponential decay `d = 0.25`). This is called an *exponentially weighted linear regression*.

### Formula 5a — The trend weights

```
weight_i = e^(0.25 × (i − n + 1))
```

**Our actual trend weights** (newest = 1.000, oldest = 0.064):

```
[0.064, 0.082, 0.105, 0.135, 0.174, 0.223, 0.287, 0.368, 0.472, 0.607, 0.779, 1.000]
```

### Formula 5b — Weighted centers (meanX, meanY)

`x` is the month *number* (0 to 11). `y` is that month's demand.

```
meanX = Σ(xᵢ·wᵢ) ÷ Σ(wᵢ)        (weighted "middle" of the month numbers)
meanY = Σ(yᵢ·wᵢ) ÷ Σ(wᵢ)        (weighted "middle" of the demands — same as our baseline!)
```

**Our actual numbers:**
```
meanX = 8.108
meanY = 21.019
```

### Formula 5c — The slope (the trend itself)

```
slope = Σ( wᵢ × (xᵢ − meanX) × (yᵢ − meanY) )  ÷  Σ( wᵢ × (xᵢ − meanX)² )
        └────────────── numerator ──────────────┘   └── denominator ──┘
```

**Our actual numbers:**
```
numerator   = Σ wᵢ(xᵢ − meanX)(yᵢ − meanY) = 72.415
denominator = Σ wᵢ(xᵢ − meanX)²            = 34.265
slope       = 72.415 ÷ 34.265 = 2.11
```

So demand is rising by about **+2.11 units per month**. The page shows this as **Trend = +2.1/mo**.

### Formula 5d — Trend strength (weighted R²)

A slope is only trustworthy if the data really does follow a line. The engine computes a weighted
**R²** ("R-squared") between 0 and 1:

```
ssRes = Σ wᵢ × (yᵢ − predictedᵢ)²        predictedᵢ = meanY + slope × (xᵢ − meanX)
ssTot = Σ wᵢ × (yᵢ − meanY)²
R²    = 1 − ssRes ÷ ssTot
```

**Our actual numbers:**
```
ssRes = 107.30
ssTot = 260.33
R²    = 1 − 107.30 ÷ 260.33 = 0.59
```

The page shows this as **Trend strength = 59%**. (0.59 = 59%.)

### Formula 5e — Deciding the direction (up / down / stable)

A tiny slope isn't a real trend. The engine requires the slope to beat a **threshold**:

```
threshold = |meanY| × 0.02      (2% of the average; falls back to 0.5 only if the average is 0)
```

**Our actual numbers:**
```
threshold = 21.019 × 0.02 = 0.42
```

Then:

| Condition | Direction |
|---|---|
| slope > +0.42 | **up** |

> 💡 The parenthetical in the formula above says "0.5 if the average is zero": the code is
> `Math.abs(meanY) × 0.02 || 0.5`, meaning 0.5 is only a fallback when the average itself is 0
> (no demand at all). It is not a minimum.
| slope < −0.42 | **down** |
| otherwise | **stable** |

Our slope is **+2.11 > 0.42 → direction = "up"** ✅

> 🍋 **Lemonade stand:** each month you sold a little more than the month before. The "slope" is
> how many extra cups per month. "Strength" is how consistent that growth was — 59% means it's a
> real pattern, not random noise. Direction says: the line is pointing up.

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

### Formula 6c — Triangular smoothing (blend with neighbors)

One month of data is noisy, so each factor gets blended with its two neighbors (70% self,
15% each neighbor):

```
smoothedFactor = rawTarget × 0.70  +  (rawPrev + rawNext) × 0.15
```

**Our actual number for August (the next forecast month):**
```
smoothedFactor = 1.383 × 0.70 + (1.729 + 1.153) × 0.15
               = 0.9681       + 0.4323
               = 1.4006
```

### Formula 6d — Clamping (never let seasonality go crazy)

```
seasonalityFactor = clamp(smoothedFactor, 0.5, 2.0)
```

August: `clamp(1.4006, 0.5, 2.0) = 1.4006` — no change. The page shows **Seasonality = ×1.40**.
(If a factor computed to 2.3 it would be cut to 2.0; if 0.3 it would be raised to 0.5.)

**All 12 smoothed + clamped factors** (these are what the engine actually uses):

| Month | Raw | Smoothed | Clamped (used) |
|---|---|---|---|
| Jan | 0.646 | 0.633 | 0.633 |
| Feb | 0.519 | 0.564 | 0.564 |
| Mar | 0.692 | 0.700 | 0.700 |
| Apr | 0.922 | 0.939 | 0.939 |
| May | 1.268 | 1.268 | 1.268 |
| Jun | 1.614 | 1.579 | 1.579 |
| Jul | 1.729 | 1.660 | 1.660 |
| Aug | 1.383 | 1.401 | **1.401** |
| Sep | 1.153 | 1.135 | 1.135 |
| Oct | 0.807 | 0.824 | 0.824 |
| Nov | 0.576 | 0.628 | 0.628 |
| Dec | 0.692 | 0.667 | 0.667 |

> 🍋 **Lemonade stand:** August is a hot, busy month, so it always sells ~40% more than average
> (factor 1.40). November is quiet (~0.63×). The "smoothing" just means: if one month was a freak
> accident, the neighbors soften it — we only trust a pattern if it's smooth.

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

**Worked example (August 2026):** suppose you set trekking season = 1.10 and weather = 1.05:
```
factorsMultiplied = 1.10 × 1.05 × 1.0 × 1.0 × 1.0 = 1.155
baseline          = 33.56          (computed in Step 6 below)
adjusted          = 33.56 × 1.155 = 38.76
clamp range       = 33.56×0.70 = 23.49  …  33.56×1.50 = 50.34
final             = 38.76  (inside the range, so unchanged)  → page shows 39
```

In the main example for this document we set **no factors**, so `factorsMultiplied = 1`
and the forecast stays at baseline.

> 🍋 **Lemonade stand:** "it's summer AND the town fair is this week" — so you plan to make a bit
> more. But the recipe refuses to go below 70% or above 150% of normal, so one lucky day can't
> make you buy a truckload of lemons.

---

## 8. Step 6 — The monthly forecast, month by month

Now the engine builds a forecast for each of the next 6 months (Aug 2026 … Jan 2027).
For month number `i` (1 = next month):

### Formula 8a — Dampened trend contribution

Trends shouldn't run forever — the further out you forecast, the less the trend pushes.
Dampening factor `λ = 0.9`:

```
dampening          = 0.9^(i−1)
trendContribution  = slope × i × dampening
avgPlusTrend       = weightedAvg + trendContribution
```

**Our actual numbers:**

| Month | i | dampening (0.9^(i−1)) | trendContribution (2.11 × i × damp) | avgPlusTrend (21.85 + contrib) |
|---|---|---|---|---|
| Aug 2026 | 1 | 1.000 | 2.11 | 23.96 |
| Sep 2026 | 2 | 0.900 | 3.80 | 25.65 |
| Oct 2026 | 3 | 0.810 | 5.13 | 26.98 |
| Nov 2026 | 4 | 0.729 | 6.15 | 28.00 |
| Dec 2026 | 5 | 0.656 | 6.92 | 28.77 |
| Jan 2027 | 6 | 0.590 | 7.48 | 29.32 |

> Notice the trend contribution grows each month (2.11 → 7.48) but more slowly, because dampening
> multiplies it down. Trend influence fades the further you look.

### Formula 8b — The baseline for the month

```
baseline = max(0, avgPlusTrend) × seasonalityFactor(month)
```

**Our actual numbers (using the seasonality factors from Step 4):**

| Month | avgPlusTrend | × seasonality | = **baseline** |
|---|---|---|---|
| Aug 2026 | 23.96 | × 1.401 | **33.56** → 34 |
| Sep 2026 | 25.65 | × 1.135 | **29.11** → 29 |
| Oct 2026 | 26.98 | × 0.824 | **22.23** → 22 |
| Nov 2026 | 28.00 | × 0.628 | **17.58** → 18 |
| Dec 2026 | 28.77 | × 0.667 | **19.20** → 19 |
| Jan 2027 | 29.32 | × 0.633 | **18.56** → 19 |

### Formula 8c — Final forecast (with factors)

With no business factors this equals the baseline. (With factors: Step 5, `final = clamp(baseline × factors, 0.7×baseline, 1.5×baseline)`.)

### Formula 8d — Daily rate

```
dailyRate = finalForecast ÷ daysInMonth(month)
```

**Our actual numbers:**

| Month | final | days | **dailyRate** |
|---|---|---|---|
| Aug 2026 | 34 | 31 | **1.1/day** |
| Sep 2026 | 29 | 30 | **1.0/day** |
| Oct 2026 | 22 | 31 | **0.7/day** |
| Nov 2026 | 18 | 30 | **0.6/day** |
| Dec 2026 | 19 | 31 | **0.6/day** |
| Jan 2027 | 19 | 31 | **0.6/day** |

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
| Aug 2026 | 34 | 1.1 | 34 | 33 | 30 | 37 | **37** | 0 |
| Sep 2026 | 29 | 1.0 | 29 | 30 | 0 | 59 | **59** | 0 |
| Oct 2026 | 22 | 0.7 | 22 | 21 | 0 | 43 | **44** | 0 |
| Nov 2026 | 18 | 0.6 | 18 | 18 | 0 | 36 | **36** | 0 |
| Dec 2026 | 19 | 0.6 | 19 | 18 | 0 | 37 | **38** | 0 |
| Jan 2027 | 19 | 0.6 | 19 | 18 | 0 | 37 | **37** | 0 |

> 💡 **Why October shows "shortfall 43" but "suggested order 44"?** The shortfall column is computed
> from the *displayed* (rounded) values (22 + 21 = 43), but the suggested order is computed from the
> *unrounded* forecast (true demand 22.23, true daily rate 0.717/day → 22.23 + 21.51 − 0 = 43.74 →
> rounded up to 44). The engine always uses the unrounded numbers internally and only rounds for display.

> 🍋 **Lemonade stand:** August needs 34 cups, plus 33 cups of spare lemons just in case = 67 cups
> needed. You have 30 → you need 37 more. September needs even more because last month you already
> used everything up.

---

## 9. Step 7 — The prediction interval (the "probably" range)

Forecasts are guesses, so the page shows an **80% confidence range**: "we're 80% sure demand lands
between these two numbers." The engine builds it from how badly the straight line failed in the past.

### Formula 9a — Residuals (how wrong the line was each month)

The engine uses a simple (unweighted) line `fittedᵢ = avg + slope × i` for this step:

```
residualᵢ = yᵢ − fittedᵢ
```

**Our actual residuals:** `[2.15, −3.96, −12.08, −18.19, −18.30, −21.22, −25.53, −24.64, −22.76, −18.87, −14.98, −15.10]`

### Formula 9b — Standard error of the estimate (se)

```
mse = Σ(residualᵢ²) ÷ (n − 2)      n = 12
se  = √mse
```

**Our actual numbers:**
```
mse = 386.70
se  = √386.70 = 19.66
```

### Formula 9c — Standard error of prediction (sePred)

The further into the future you forecast, the wider the range. With `z = 1.28` (the 80% z-score),
`meanX = (n−1)/2 = 5.5`, and `ssx = Σ(i − meanX)² = 143`:

```
sePred = se × √( 1 + 1/n + (forecastIndex − meanX)² ÷ ssx )
```

**Our actual numbers for August 2026 (`forecastIndex = 12`, one month ahead of the data):**
```
sePred = 19.66 × √( 1 + 1/12 + (12 − 5.5)² ÷ 143 )
       = 19.66 × √(1.0833 + 0.2955)
       = 19.66 × 1.1742
       = 23.09
```

### Formula 9d — The interval, centered on the forecast

```
halfWidth = round(z × sePred)          z = 1.28
low  = max(0, center − halfWidth)
high = center + halfWidth
```

`center` is the (unrounded) forecast for that month — for August: **33.56**.

**Our actual numbers:**
```
halfWidth = round(1.28 × 23.09) = round(29.56) = 30
low       = max(0, 33.56 − 30)  = 3.56    (shown rounded as 4)
high      = 33.56 + 30          = 63.56   (shown rounded as 64)
```

> 💡 The page renders the raw interval values (e.g. 3.56 – 63.56); the numbers in the table below
> are rounded to one decimal for readability.

**The 80% prediction interval for every forecast month (from the engine):**

| Month | Forecast | 80% low | 80% high |
|---|---|---|---|
| Aug 2026 | 34 | 3.6 | 63.6 |
| Sep 2026 | 29 | 0 | 60.1 |
| Oct 2026 | 22 | 0 | 54.2 |
| Nov 2026 | 18 | 0 | 50.6 |
| Dec 2026 | 19 | 0 | 53.2 |
| Jan 2027 | 19 | 0 | 54.6 |

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

**Our actual numbers (Aug 1.1, Sep 1.0, Oct 0.7):**
```
coverDailyRate = (1.1×3 + 1.0×2 + 0.7×1) ÷ 6
               = (3.3 + 2.0 + 0.7) ÷ 6
               = 6.0 ÷ 6 = 1.0/day
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
daysOfCover       = round(30 ÷ 1.0) = 30 days
```

The page shows **Days cover = 30d**.

> 🍋 **Lemonade stand:** you have 30 cups of lemonade and you sell ~1 cup a day → you'll last
> about 30 days. (If a big order was already promised to a customer, we'd subtract it; if a
> delivery is already on its way, we'd add it.)

---

## 11. Step 9 — The reorder recommendation (how much to buy)

**The question:** "How many units should I order right now?" The answer must cover:

1. **Lead time demand** — how many you'll sell while waiting for the order to arrive (14 days).
2. **Safety stock** — a buffer against demand surprises.
3. **Minus what you already have.**

### Formula 11a — Lead time demand (day-by-day, month-by-month)

The engine walks through the forecast months, taking as many days as the lead time needs:

```
remainingLeadDays = supplierLeadTimeDays (14)
for each forecast month:
    daysToTake     = min(remainingLeadDays, daysInMonth)
    leadTimeDemand += dailyRate × daysToTake
    remainingLeadDays −= daysToTake
```

**Our actual numbers (14 days fits entirely inside August):**
```
leadTimeDemand = 1.1/day × 14 days = 15.4 units
```

### Formula 11b — Demand variability (de-seasonalized standard deviation)

Safety stock should reflect how *variable* demand is, but seasonality must not inflate it.
If a product peaks at 2× in December, its raw standard deviation looks huge — so the engine
divides each month by its seasonality factor first, then measures spread:

```
deSeasonalizedᵢ = yᵢ ÷ seasonalityFactor(monthᵢ)      (only when history ≥ 12 months)
desMean         = average of deSeasonalized values
desVariance     = Σ(deSeasonalizedᵢ − desMean)² ÷ (n − 1)
demandStdDev    = √desVariance
```

**Our actual numbers:**
```
demandMean     = 17.35
demandVariance = 0.48
demandStdDev   = √0.48 = 0.70
```

### Formula 11c — Safety stock units

```
serviceLevelZ  = 1.65                      (default, = 95% service level; see Appendix B)
safetyStock    = round(serviceLevelZ × demandStdDev × √(leadTimeDays ÷ 30))
```

**Our actual numbers:**
```
safetyStock = round(1.65 × 0.70 × √(14 ÷ 30))
            = round(1.65 × 0.70 × 0.6831)
            = round(0.789) = 1 unit
```

*(Fallback when demand is perfectly stable, stdDev = 0: `safetyStock = round(dailyForecast × safetyStockDays)`.)*

### Formula 11d — The recommendation, step by step

```
recommended = max(0, leadTimeDemand + safetyStock − inventoryPosition)
```

**Main example (stock = 30):**
```
recommended = max(0, 15.4 + 1 − 30) = max(0, −13.6) = 0  → nothing needed (page: "Stocked")
```

**Low-stock example (stock = 5):**
```
recommended = max(0, 15.4 + 1 − 5) = 11.4  → page rounds up to 12
```

### Formula 11e — The "caps and rules" pass (in order)

1. **Max cover cap** — never order so much that you'd hold more than `maxCoverDays` of stock
   (unless the product is a protected core item):

   ```
   maxStock  = dailyForecast × maxCoverDays
   headroom  = max(0, maxStock − inventoryPosition)
   recommended = min(recommended, headroom)
   ```

   **Example (stock = 400, maxCoverDays = 180):**
   ```
   maxStock = 1.1 × 180 = 198
   headroom = max(0, 198 − 400) = 0
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
11.4 → MOQ → max(11.4, 50) = 50 → multiple → ceil(50÷25)×25 = 50
```

The page shows **Reorder now = 50** for that scenario, and the reorder value is
`50 × unit cost = 50 × $25 = $1,250`.

> 🍋 **Lemonade stand:** to reorder lemons you need: enough for the 14 days while the delivery
> comes (15 cups) + a spare cup in case of surprise (1) = 16, minus what you have. If you have 5,
> buy 11… but the lemon guy only sells boxes of 25 and minimum 50, so you buy 50. And if you
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
overallAvg (the weighted baseline) = 21.85
threshold120pct = 21.85 × 1.2 = 26.22
threshold60pct  = 21.85 × 0.6 = 13.11
```

### Formula 12c — The tag

| Condition | Momentum tag |
|---|---|
| recent3MonthAvg = 0 | `inactive` |
| recent3MonthAvg ≥ 26.22 (120%) | `accelerating` |
| recent3MonthAvg ≥ 13.11 (60%) | `stable` |
| otherwise | `declining` |

**Our actual result:** `26.67 ≥ 26.22` → **`accelerating`** ✅ (page shows "Accelerating")

> 🍋 **Lemonade stand:** the last 3 months you sold 26.7 cups/month but your usual is 21.9.
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

**Our actual numbers:** `coverVsLead = 30 ÷ 14 = 2.14`

| Condition | Stockout risk |
|---|---|
| coverVsLead < 1.0 | **high** (you'll run out before new stock arrives) |
| coverVsLead < 1.5 | **medium** |
| otherwise | **low** |

Our 2.14 → **low** ✅

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

Our daysOfCover = 30 → **low** ✅
(The 400-unit example from Step 11: 400 > 180 → **high**.)

> 🍋 **Lemonade stand:** 30 days of stock vs a 14-day delivery = you're safe (2.14× covered).
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
daysOfCover           = 30 days          (from Step 8)
estimatedStockoutDate = 2026-07-31 + 30 days = 2026-08-30
```

*(If stock is already 0, the stockout date is today. If there is no forecast demand at all
(daysOfCover = ∞), there is no stockout date and the SKU shows as "Sufficient".)*

### Formula 15b — Reorder-by date (last safe day to order)

```
reorderByDate = estimatedStockoutDate − supplierLeadTimeDays
```

**Our actual numbers:** `2026-08-30 − 14 days = 2026-08-16`

### Formula 15c — Next refill date (if you ordered today)

```
nextRefillDate = today + supplierLeadTimeDays
```

**Our actual numbers:** `2026-07-31 + 14 days = 2026-08-14`

### Formula 15d — Stockout urgency

| Condition | Urgency |
|---|---|
| stock ≤ 0, or reorderByDate ≤ today | `critical` |
| reorderByDate ≤ today + supplierLeadTimeDays | `warning` |
| otherwise | `safe` |

**Our actual numbers:** reorderByDate (Aug 16) > today + 14 days (Aug 14) → **`safe`** ✅

> 🍋 **Lemonade stand:** you have 30 days of stock, so you'll run out on Aug 30. The lemon man
> takes 14 days, so you must order by Aug 16 at the very latest. Since that's comfortably in the
> future, the page rates you "safe". If the date ever slips inside the 14-day delivery window the
> page would warn, and past Aug 16 it would scream "CRITICAL".

---

## 16. Step 14 — Pricing strategy (what to do with the price)

Finally, the page suggests a pricing move based on **velocity**, **momentum**, **days of cover**,
and your margins.

### Formula 16a — Minimum permitted price (from your margin floor)

```
minimumGrossMargin = clamp(minimumGrossMarginPercentage, 0.01, 0.99)   (default 0.40)
minimumPrice       = unitCost ÷ (1 − minimumGrossMargin)
```

**Our actual numbers:**
```
minimumPrice = $25.00 ÷ (1 − 0.40) = $25.00 ÷ 0.60 = $41.67
```

So you must never price below **$41.67** if you want at least a 40% gross margin.
(Current price is $59.99, so you're comfortably above the floor.)

### Formula 16b — Inventory position

```
if daysOfCover < leadTime + safetyStockDays  →  "low"
else if daysOfCover > maxCoverDays           →  "high"
else                                          →  "normal"
```

**Our actual numbers:** `30 < 14 + 30 = 44` → **low** stock position.

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
**"Hold price — no price change recommended"**. Reason shown on page:
*"Medium-moving, accelerating demand."*

**Worked clearance example:** a dead product (velocity `dead`, momentum `inactive`) with 250 days
of cover, cost $10:
```
minimumPrice = $10 ÷ 0.60 = $16.67
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

**Weighted average (baseline)** — decay `d = 0.3`, newest month = index 11
```
wᵢ = e^(d × (i − n + 1))
weightedAvg = Σ(yᵢ·wᵢ) ÷ Σ(wᵢ)
```

**Trend** — decay `d = 0.25`
```
meanX = Σ(xᵢ·wᵢ) ÷ Σ(wᵢ)      meanY = Σ(yᵢ·wᵢ) ÷ Σ(wᵢ)
slope = Σ(wᵢ(xᵢ−meanX)(yᵢ−meanY)) ÷ Σ(wᵢ(xᵢ−meanX)²)
R²    = 1 − Σwᵢ(yᵢ−predᵢ)² ÷ Σwᵢ(yᵢ−meanY)²        predᵢ = meanY + slope(xᵢ−meanX)
threshold = |meanY| × 0.02    direction: slope>+t → up · slope<−t → down · else stable
```

**Seasonality**
```
overallAvg = Σyᵢ ÷ 12
rawᵢ       = monthAvgᵢ ÷ overallAvg
smoothᵢ    = rawᵢ × 0.7 + (rawₚᵣₑᵥ + rawₙₑₓₜ) × 0.15
factorᵢ    = clamp(smoothᵢ, 0.5, 2.0)
```

**Factors**
```
adjusted = baseline × (trekking × weather × promotion × regional × event)
final    = clamp(adjusted, baseline × 0.70, baseline × 1.50)
```

**Monthly forecast** (month i = 1…6)
```
dampening         = 0.9^(i−1)
trendContribution = slope × i × dampening
baseline          = max(0, weightedAvg + trendContribution) × seasonalityFactor
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
leadTimeDemand = Σ (dailyRate × days) over the months the lead time spans
stdDev         = √( Σ(deSeasonalizedᵢ − desMean)² ÷ (n−1) )
safetyStock    = round(z × stdDev × √(leadTime ÷ 30))     z = 1.65 default
recommended    = max(0, leadTimeDemand + safetyStock − inventoryPosition)
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
minimumPrice = unitCost ÷ (1 − minGrossMargin)
low if cover < lead + safetyDays · high if cover > maxCoverDays · else normal
+ the 8 decision rules in Step 14
```

---

## Appendix B — Constants and default values

| Constant | Value | Where used |
|---|---|---|
| Baseline decay `d` | 0.3 | weighted average |
| Trend decay `d` | 0.25 | trend regression |
| Dampening lambda `λ` | 0.9 | trend contribution per month |
| Seasonality smoothing | 70% self / 15% each neighbor | seasonal factors |
| Seasonality clamp | 0.5 – 2.0 | seasonal factors |
| Factor clamp | 0.7× – 1.5× baseline | business factors |
| Confidence level | 80% (`z = 1.28`) | prediction interval |
| Small-history fallback | ±30% | prediction interval (n < 3) |
| Availability divisor floor | 0.70 | availability correction |
| Availability cap | 1.4× actual | availability correction |
| Service level (default) | 95% → `z = 1.65` | safety stock |
| Service level table | ≥99% → 2.33 · ≥95% → 1.65 · ≥90% → 1.28 · else 1.04 | safety stock |
| Safety stock days (default) | 30 | monthly safety stock |
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

*Generated from the real output of `forecastSKU()` in `frontend/src/lib/forecast-engine.ts` on 2026-07-31.*
