# WH-TECH-03 — WHIZUNIK COMMAND — The Executive Control System

## Intelligence Engine — Functional & Technical Specification

### Version 1.0

**Document Type:** Intelligence Engine audit & specification (Day 3 — current-state documentation)
**Version:** 1.0
**Date:** 2026-08-18
**Classification:** Internal — Draft for Sankalp review
**Status:** Evidence-based record of the Intelligence Engine as it exists today; no code modified, no functionality developed

---

## Document Control

| Attribute | Value |
|-----------|-------|
| Document ID | WH-TECH-03 |
| Document Title | WHIZUNIK COMMAND — Intelligence Engine — Functional & Technical Specification |
| Document Type | Current-state Intelligence Engine audit (Day 3 — documentation exercise) |
| Version | 1.0 |
| Classification | Internal — Draft for Sankalp review |
| Prepared by | Ram Shrivastava |
| Reviewed by | Sankalp (pending) |
| Date | 2026-08-18 |
| Scope | Intelligence Engine capabilities of WHIZUNIK COMMAND **as they exist today**, verified from the repository |
| Companion Documents | WH-TECH-01 (Product Register, Day 1), WH-TECH-02 (Technical Architecture, Day 2) |

### Revision History

| Version | Date | Author | Description of Changes |
|---------|------|--------|------------------------|
| 1.0 | 2026-08-18 | Ram Shrivastava | Initial Day 3 current-state Intelligence Engine audit & specification |

### Critical Rules Applied

- **Do NOT build new intelligence functionality.**
- **Do NOT modify forecasting algorithms.**
- **Do NOT tune model parameters.**
- **Do NOT refactor intelligence-related code.**
- **Do NOT replace algorithms with better algorithms.**
- **Do NOT make assumptions about business logic.**
- **Do NOT document planned functionality as implemented.**
- **Do NOT invent mathematical formulas where the implementation cannot verify them.**
- **Do NOT silently correct existing calculations.**
- **Document the system exactly as it exists today.**
- If implementation and intended business logic appear different, document the discrepancy.
- If something cannot be determined from the code/data/configuration, mark it: *Unknown / Not Found / Partially Implemented / Needs Sankalp Review*.
- No code was modified. No recommendations were implemented. Day 4 work was not started.

---

## 1. Document Purpose

This document records the **WHIZUNIK COMMAND Intelligence Engine as it actually works today** — every algorithm, every calculation, every input, every output, every recommendation, every assumption, and every limitation — as an audit baseline for Sankalp's Intelligence Engine review. It is a Day 3 documentation exercise only:

- It does **not** propose intelligence algorithm improvements.
- It does **not** redesign the Intelligence Engine.
- It does **not** implement any recommendation.
- It does **not** document planned functionality as current.
- Items that cannot be verified from the repository are marked **Unknown / Not Found / Partially Implemented / Needs Review**.

Day 4 (architecture redesign) is **out of scope** and is not started.

---

## 2. Intelligence Engine Overview

The WHIZUNIK COMMAND Intelligence Engine is a **deterministic statistical forecasting and recommendation system** implemented in TypeScript. It is **not** an AI/ML system — there are no machine learning models, no neural networks, no external AI services, no training pipelines, and no prediction APIs. The engine uses classical statistical methods: weighted averages, ordinary least squares (OLS) trend detection, raw seasonal factors, heuristic rule-based recommendations, and a rule-based pricing strategy table.

### What the Intelligence Engine Does

The engine provides four categories of intelligence to management:

1. **Demand Intelligence** — SKU-level demand forecasting (6-month horizon), live pace adjustment, stock-out/overstock risk scoring
2. **Inventory Intelligence** — Days-of-cover calculation, reorder recommendations (quantity + timing), stock-out/overstock risk alerts
3. **Commercial Intelligence** — Category-based velocity tagging, momentum analysis, pricing strategy recommendations
4. **Timeline Intelligence** — Estimated stockout date, reorder-by date, next refill date, urgency classification

### Architecture

The Intelligence Engine exists as **two identical copies** of the same TypeScript code: one in `backend/src/lib/forecast-engine.ts` and one in `frontend/src/lib/forecast-engine.ts`. The file is annotated with `// KEEP IN SYNC` to warn developers to keep them identical. The server computes forecasts and persists snapshots to DynamoDB; the frontend re-computes forecasts client-side for live display and also consumes persisted server snapshots.

**Evidence:**
- `backend/src/lib/forecast-engine.ts` (1,878 lines)
- `frontend/src/lib/forecast-engine.ts` (1,872 lines)
- `backend/src/services/forecast-service.ts` (server persistence)
- `backend/src/models/forecast-variable.ts` (DynamoDB model)
- `frontend/src/routes/app.forecast.tsx` (forecast UI page)
- `DEMAND-FORECAST-FORMULAS.md` (formula documentation)

---

## 3. Current Intelligence Capabilities

### 3.1 Intelligence Capability Inventory

| # | Capability | Module | Current Status | Evidence | Classification |
| - | ---------- | ------ | -------------- | -------- | -------------- |
| 1 | Sales Forecasting (Demand Intelligence) | Forecast Engine | **Implemented** | `forecast-engine.ts` (`forecastSKU`), `forecast-service.ts`, `app.forecast.tsx` | OPTIONAL MODULE |
| 2 | SKU Demand Forecasting | Forecast Engine | **Implemented** | Same engine — SKU-level execution via `forecastSKU` per active product | OPTIONAL MODULE |
| 3 | Velocity Analysis | Forecast Engine | **Implemented** | `computeVelocityByCategory` in `forecast-engine.ts` | OPTIONAL MODULE |
| 4 | Momentum Analysis | Forecast Engine | **Implemented** | Momentum tag calculation inside `forecastSKU` | OPTIONAL MODULE |
| 5 | Stock-Out Alerts (Risk) | Forecast Engine | **Implemented** | `stockoutRisk`, `estimatedStockoutDate`, `stockoutUrgency` in `ForecastResult` | OPTIONAL MODULE |
| 6 | Overstock Alerts (Risk) | Forecast Engine | **Implemented** | `overstockRisk` in `ForecastResult` | OPTIONAL MODULE |
| 7 | SKU Reorder Recommendations | Forecast Engine | **Implemented** | `recommendedReorder` in `ForecastResult`; reorder section in `CalculationBreakdown` | OPTIONAL MODULE |
| 8 | Margin Analysis | Forecast Engine | **Partially Implemented** | `minimumGrossMarginPercentage` used by pricing strategy; no standalone margin analysis capability exists | OPTIONAL MODULE |
| 9 | Pricing Recommendations | Forecast Engine | **Implemented** | `computePricingStrategy` in `forecast-engine.ts` | OPTIONAL MODULE |
| 10 | Timeline Intelligence | Forecast Engine | **Implemented** | `estimatedStockoutDate`, `reorderByDate`, `nextRefillDate`, `stockoutUrgency` in `ForecastResult` | OPTIONAL MODULE |
| 11 | Live Pace Adjustment | Forecast Engine | **Implemented** | `computePaceAdjustment` in `forecast-engine.ts` | OPTIONAL MODULE |
| 12 | Prediction Intervals | Forecast Engine | **Implemented** | `predictionInterval` (80% confidence) in `forecast-engine.ts` | OPTIONAL MODULE |

**Summary:** 12 capabilities identified. 11 fully implemented. 1 partially implemented (Margin Analysis — only used as input to pricing, not as a standalone analysis).

**Note:** All capabilities exist within the same Forecast Engine module (Module 31 per WH-TECH-01). There is no separate "Intelligence Engine" service — the forecast engine IS the intelligence engine.

---

## 4. Intelligence Engine Architecture / Flow

### 4.1 Conceptual Flow

```
Business Data (Stock Movements + Product Catalogue)
        ↓
Data Preparation (Bucketing, Availability Correction)
        ↓
WHIZUNIK COMMAND Intelligence Engine
        ↓
Forecast / Analysis / Alert / Recommendation
        ↓
Persisted Snapshot (DynamoDB) + Frontend Display
        ↓
Management Action
```

### 4.2 Actual Implementation Flow

```
StockMovement.list(clientId) + Product.list(clientId)
        ↓
filter(status === "confirmed")
        ↓
Group movements by product
        ↓
bucketMovementsByMonth() → 12 monthly buckets
        ↓
correctForAvailability() → availability-adjusted demand
        ↓
forecastSKU() per product:
  ├── weightedAverage(values, [3,2,1] weights) → baseline
  ├── enhancedTrendSlope(values) → OLS slope + R²
  ├── rawSeasonalityFactor(history, targetMonth) → seasonal factor
  ├── applyFactors(baseline × trend × seasonality, factors)
  ├── computePaceAdjustment() → live pace correction
  ├── daysOfCover / reorder / risk / timeline calculations
  └── predictionInterval() → 80% confidence bounds
        ↓
computeVelocityByCategory() → velocity tags
        ↓
ForecastVariable.upsert() → DynamoDB persistence
        ↓
Frontend: forecast-vars query → recomputeTimeline() → UI display
```

### 4.3 Recompute Triggers

| Trigger | Evidence | When |
|---------|----------|------|
| Stock movement created | `backend/src/routes/index.ts` (stock-movements) | On every stock event |
| Stock movement confirmed | `backend/src/routes/index.ts` | On confirm |
| Stock movement cancelled | `backend/src/routes/index.ts` | On cancel |
| Stock movement deleted | `backend/src/routes/index.ts` | On delete |
| GRN confirmed | `backend/src/routes/index.ts` (goods-receipts) | On GRN confirm |
| GRN cancelled | `backend/src/routes/index.ts` | On GRN cancel |
| Dispatch confirmed | `backend/src/routes/index.ts` (goods-dispatches) | On dispatch confirm |
| Dispatch cancelled | `backend/src/routes/index.ts` | On dispatch cancel |
| Dispatch returned | `backend/src/routes/index.ts` | On return |
| Product deleted | `backend/src/routes/index.ts` | On product delete |
| Server startup | `backend/src/server.ts` (`recomputeAllForecastsOnStartup`) | On boot |
| Daily freshness | `forecast-service.ts` (`ensureFresh`) | On first API request each day |
| Manual recompute | Frontend button → `POST /forecast-variables/recompute` | On-demand |

### 4.4 Capability Status on the Flow

| Flow Stage | Status |
|------------|--------|
| Business Data | **Implemented** — stock movements + product catalogue |
| Data Preparation | **Implemented** — bucketing + availability correction |
| Intelligence Engine (core) | **Implemented** — 12 capabilities, all deterministic statistical |
| Persistence | **Implemented** — DynamoDB snapshots |
| Frontend Display | **Implemented** — forecast page with charts, filters, sorts |
| Recommendation Display | **Implemented** — reorder, pricing, risk, timeline |
| Management Action | **Not Implemented by the system** — pricing recommendations are never auto-applied; reorder must be manually initiated |

---

## 5. Sales Forecasting

### 1. Business Purpose

Sales forecasting enables management to anticipate future demand for each SKU over a 6-month horizon, supporting procurement planning, inventory management, and cash-flow forecasting. Without this capability, management would rely on gut feel or historical look-back, leading to either excess inventory (capital tied up in unsold goods) or stock-outs (lost sales).

### 2. Management Problem

- **Without forecasting:** Management has no forward-looking view of demand; procurement is reactive (order when you run out).
- **Why needed:** To plan purchase orders in advance, maintain adequate stock levels, and avoid both overstock and stockout situations.
- **What decision it supports:** "How many units of SKU X should we order, and by when?"

### 3. Input Data

| Input | Source | Required? | Purpose |
|-------|--------|-----------|---------|
| Historical outbound sales (12 months) | `StockMovement` model (confirmed, direction=out) | Yes | Demand history for the model |
| Product catalogue fields | `Product` model | Yes | Lead time, safety stock, costs, margins |
| Current stock position | Computed from `StockMovement` (Σ in − Σ out) | Yes | Inventory position for reorder calculation |
| Supplier lead time | `Product.leadTimeDays` (default 14) | Yes | Reorder timing |
| Safety stock days | `Product.safetyStockDays` (default 30) | Yes | Safety buffer calculation |
| Minimum gross margin | `Product.minimumGrossMarginPercentage` (default 0.40) | Yes (pricing) | Price floor calculation |
| Maximum cover days | `Product.maxStock` / maxCoverDays | No | Overstock cap |
| Minimum order quantity | `Product.moq` / minimumOrderQty | No | Order sizing |
| Order multiple | `Product.orderMultiple` | No | Order rounding |

### 4. Data Preparation

| Step | Description | Evidence |
|------|-------------|----------|
| Filter confirmed | Only `status === "confirmed"` movements are used (drafts/cancelled excluded) | `forecast-service.ts` line 32 |
| Direction filter | Only `direction === "out"` movements contribute to demand | `bucketMovementsByMonth` in `forecast-engine.ts` |
| Monthly bucketing | Outbound movements grouped by `YYYY-MM` into 12 trailing calendar months | `bucketMovementsByMonth` |
| Availability correction | If stockout data is provided: `correctedDemand = actual / max(availabilityRate, 0.70)`, capped at `actual × 1.4` | `correctForAvailability` |
| NaN/Infinity handling | Non-finite numbers (e.g. daysOfCover = Infinity for zero-sales SKUs) are persisted as null to prevent DynamoDB rejection | `forecast-service.ts` `safeNumber()` |

### 5. Calculation / Algorithm

**Forecast horizon:** 6 months ahead from the current date.

**Step 1 — Weighted Baseline:**
```
weights[i] = age < 3 ? 3 : age < 6 ? 2 : 1
weightedAvg = Σ(value[i] × weight[i]) ÷ Σ(weight[i])
```
Where `age = n - 1 - i` (0 = newest month). Recent 3 months weigh 3×, middle 3 weigh 2×, oldest 6 weigh 1×.

**Step 2 — Trend Detection (OLS):**
```
slope = (n·Σ(x·y) − Σx·Σy) ÷ (n·Σ(x²) − (Σx)²)
```
Where `x = month index 1..n`, `y = monthly demand`. R² computed as trend strength. Direction: `slope > threshold ? "up" : slope < -threshold ? "down" : "stable"` where `threshold = |meanY| × 0.02 || 0.5`.

**Step 3 — Seasonality:**
```
factor = clamp(targetMonthAvg / overallAvg, 0.5, 2.0)
```
No neighbor smoothing — raw per-month factor used directly.

**Step 4 — Monthly Forecast:**
```
baseline = max(0, weightedAvg + slope × i) × seasonalFactor
finalForecast = applyFactors(baseline, factors)
```
Where `i` is the forecast month offset (1..6).

**Step 5 — Factor Application:**
```
combined = baseline × trekkingSeason × weather × promotion × regional × event
final = clamp(combined, baseline × 0.7, baseline × 1.5)
```
All factors default to 1.0 when not provided.

**Step 6 — Live Pace Adjustment:**
```
expectedSalesToDate = currentMonthBaseForecast × daysElapsed ÷ daysInMonth
salesPaceRatio = actualSalesToDate ÷ expectedSalesToDate
rawAdjustment = 1 + 0.30 × (salesPaceRatio − 1)
adjustmentFactor = clamp(rawAdjustment, 0.80, 1.20)
adjustedNextForecast = nextMonthBaseForecast × adjustmentFactor
```
No adjustment when `daysElapsed < 7` or `expectedSalesToDate ≤ 0`.

**Step 7 — Prediction Intervals (80% confidence):**
```
z = 1.28 (80% confidence)
sePred = se × √(1 + 1/n + (forecastIndex − meanX)² / ssx)
halfWidth = round(z × sePred)
interval = [forecast − halfWidth, forecast + halfWidth]
```
Where `se = √(MSE)` from residuals of the OLS fit.

**Evidence:** `backend/src/lib/forecast-engine.ts` functions `forecastSKU`, `weightedAverage`, `enhancedTrendSlope`, `rawSeasonalityFactor`, `applyFactors`, `computePaceAdjustment`, `predictionInterval`.

### 6. Variables

| Variable | Meaning | Source | Effect on Output |
|----------|---------|--------|------------------|
| Monthly demand (12 months) | Corrected outbound sales per month | Stock movements | Primary input to baseline, trend, seasonality |
| Weighted average | Recency-weighted mean demand | Calculated | Baseline demand level |
| Slope (OLS) | Monthly demand trend | Calculated | Adds trend to baseline per forecast month |
| R² | Trend strength (0–1) | Calculated | Not used to modify forecast; informational only |
| Seasonal factor | Per-calendar-month demand multiplier | Calculated | Scales baseline for seasonal effects |
| Forecast factors | Business adjustment multipliers | Optional inputs (defaults 1.0) | Multiply baseline (clamped to 0.7–1.5×) |
| Current month base forecast | Baseline forecast for the current calendar month | Calculated | Input to pace adjustment |
| Sales pace ratio | Actual vs expected sales to date | Calculated | Adjusts next-month forecast by ±20% max |

### 7. Parameters / Weightings

| Parameter | Value | Unit | Configurable? | Location |
|-----------|------:| ---- | ------------- | -------- |
| History window | 12 | months | Hard-coded | `forecast-engine.ts` `bucketMovementsByMonth` default |
| Forecast horizon | 6 | months | Hard-coded | `forecast-engine.ts` `forecastSKU` default |
| Recent weight | 3 | × | Hard-coded | `forecast-engine.ts` weights calculation |
| Middle weight | 2 | × | Hard-coded | `forecast-engine.ts` weights calculation |
| Old weight | 1 | × | Hard-coded | `forecast-engine.ts` weights calculation |
| Seasonality clamp low | 0.5 | ratio | Hard-coded | `rawSeasonalityFactor` |
| Seasonality clamp high | 2.0 | ratio | Hard-coded | `rawSeasonalityFactor` |
| Trend threshold | 2% of mean or 0.5 units | units | Hard-coded | `enhancedTrendSlope` |
| Factor clamp low | 0.7 | × | Hard-coded | `applyFactors` |
| Factor clamp high | 1.5 | × | Hard-coded | `applyFactors` |
| Pace adjustment coefficient | 0.30 | × | Hard-coded | `computePaceAdjustment` |
| Pace adjustment clamp low | 0.80 | × | Hard-coded | `computePaceAdjustment` |
| Pace adjustment clamp high | 1.20 | × | Hard-coded | `computePaceAdjustment` |
| Pace minimum days elapsed | 7 | days | Hard-coded | `computePaceAdjustment` |
| Prediction interval confidence | 80% | — | Hard-coded (z=1.28) | `predictionInterval` |
| Availability correction floor | 0.70 | ratio | Hard-coded | `correctForAvailability` |
| Availability correction cap | 1.4× | multiplier | Hard-coded | `correctForAvailability` |
| Default lead time | 14 | days | Configurable per product | `Product.leadTimeDays` |
| Default safety stock | 30 | days | Configurable per product | `Product.safetyStockDays` |
| Trekking season index | 1.0 | multiplier | Configurable (optional) | `ForecastFactors` |
| Weather index | 1.0 | multiplier | Configurable (optional) | `ForecastFactors` |
| Promotion lift | 1.0 | multiplier | Configurable (optional) | `ForecastFactors` |
| Regional demand index | 1.0 | multiplier | Configurable (optional) | `ForecastFactors` |
| Event lift | 1.0 | multiplier | Configurable (optional) | `ForecastFactors` |

**Note:** The `ForecastFactors` (trekking season, weather, promotion, regional, event) are supported by the engine but are **not currently populated from any data source** — they always default to 1.0. The optional `SKUConfig` type supports additional fields (product category, season profile, weather sensitivity, lifecycle stage, etc.) but these are **not populated by the forecast service**. They exist in the type definitions only.

### 8. Output

| Output | Format | Meaning | Consumer |
|--------|--------|---------|----------|
| `finalForecast` | number (units) | Next month's forecast demand | Frontend forecast page |
| `adjustedNextForecast` | number (units) | Next month's forecast after pace adjustment | Frontend forecast page |
| `dailyForecast` | number (units/day) | Daily demand rate for next month | Frontend, reorder calculation |
| `forecast[]` | array of 6 `MonthForecast` | Monthly forecast for 6 months | Frontend charts |
| `history[]` | array of 12 `MonthlyBucket` | Historical demand (corrected) | Frontend charts |
| `weightedBaseline` | number | Recency-weighted average demand | Frontend, calculation breakdown |
| `trendAdjustment` | number | OLS slope | Frontend |
| `trendDirection` | "up"/"down"/"stable" | Direction of demand trend | Frontend |
| `trendStrength` | number (0–1) | R² value | Frontend |
| `seasonalityFactor` | number | Next-month seasonal multiplier | Frontend |
| `calculationBreakdown` | object | Full calculation trace with every intermediate value | Frontend "show workings" |
| `predictionIntervalLow/High` | number | 80% confidence bounds per forecast month | Frontend charts (error bars) |

### 9. Recommendation

**Forecast → Stock Position → Threshold Evaluation → Reorder Recommendation → Management Action**

The forecast output feeds into the reorder recommendation (§11), stock-out risk (§9), and overstock risk (§10). Management is expected to review the forecast, assess the reorder recommendation, and manually place purchase orders.

### 10. Management Use

Management should interpret the forecast as a **statistical baseline** for demand planning. The 80% prediction intervals provide a range of likely outcomes. The live pace adjustment nudges the next-month forecast based on current-month sales velocity. Management should use this to decide when and how much to order, not as an exact prediction.

### 11. Assumptions

| Assumption | Type | Evidence |
|------------|------|----------|
| Historical outbound sales represent future demand | Inferred (algorithm design) | `bucketMovementsByMonth` uses past sales as model input |
| Demand patterns are relatively stable (seasonality repeats) | Inferred (algorithm design) | `rawSeasonalityFactor` assumes calendar-month seasonality |
| Confirmed stock movements reflect actual physical inventory | Inferred | `forecast-service.ts` filters `status === "confirmed"` |
| Product catalogue data (lead time, safety stock) is accurate | Inferred | Used directly in reorder calculation |
| Stockout availability data (if provided) is accurate | Inferred | `correctForAvailability` adjusts demand for stockout periods |
| Current month's partial sales are representative of the full month | Inferred | Pace adjustment extrapolates partial-month data |

### 12. Limitations

| Limitation | Impact | Evidence |
|------------|--------|----------|
| Minimum 2 months of history required for trend detection | New SKUs with <2 months of data get slope=0, strength=0 | `enhancedTrendSlope`: `if (n < 2) return { slope: 0, strength: 0 }` |
| Minimum 3 months of history for prediction intervals | SKUs with <3 months get ±30% wide intervals | `predictionInterval`: `if (n < 3) return { low: center × 0.7, high: center × 1.3 }` |
| No availability data means no stockout correction | Months with stockouts appear as low demand, not corrected demand | `correctForAvailability`: returns raw qty when no availability data |
| Forecast factors always default to 1.0 | Business adjustments (season, weather, promo) have no effect | No data source populates `ForecastFactors` |
| SKUConfig fields not populated | Lifecycle stage, season profile, weather sensitivity unused | `forecast-service.ts` only passes `safetyStockDays` |
| 80% confidence interval is relatively narrow | May understate uncertainty for volatile products | z=1.28 in `predictionInterval` |
| Linear trend assumes constant rate of change | Accelerating or decelerating trends may be misspecified | `enhancedTrendSlope` fits a single line |
| Seasonality uses raw per-month averages | Single noisy month can create extreme seasonality factors | Clamped to 0.5–2.0 but no neighbor smoothing |
| Pace adjustment limited to ±20% | Large demand shifts may be under-adjusted | `clamp(rawAdjustment, 0.80, 1.20)` |
| Pace adjustment inactive for first 7 days of month | No real-time correction early in the month | `if (daysElapsed < 7)` |
| No external data integration | No market data, competitor data, or economic indicators | No external APIs configured |

### 13. End-to-End Trace

```
StockMovement.list(clientId)
  → forecast-service.ts (recomputeAll)
    → forecast-engine.ts (bucketMovementsByMonth + forecastSKU per product)
      → ForecastVariable.upsert() → DynamoDB
        → Frontend query → recomputeTimeline() → forecast page
```

**Files involved:**
- `backend/src/models/stock-movement.ts` (data source)
- `backend/src/models/product.ts` (catalogue data)
- `backend/src/lib/forecast-engine.ts` (core algorithm)
- `backend/src/services/forecast-service.ts` (orchestration + persistence)
- `backend/src/models/forecast-variable.ts` (DynamoDB model)
- `backend/src/routes/index.ts` (API endpoints: `/forecast`, `/forecast-variables`, `/forecast-variables/recompute`)
- `frontend/src/lib/forecast-engine.ts` (duplicate client-side engine)
- `frontend/src/routes/app.forecast.tsx` (UI)

---

## 6. SKU Demand Forecasting

### 1. Business Purpose

SKU-level demand forecasting provides a per-product view of expected future sales, enabling targeted procurement decisions at the individual SKU level rather than aggregate category or product-family level.

### 2. Management Problem

- **Without SKU forecasting:** Management cannot identify which specific products will run out or overstock.
- **Why needed:** Different SKUs have different demand patterns, lead times, and seasonality — a one-size-fits-all forecast is insufficient.
- **What decision it supports:** "Which specific SKUs need reordering, and how many?"

### 3. Relationship to Sales Forecasting

SKU demand forecasting is **not a separate algorithm** — it is the same `forecastSKU` function executed once per active product. The forecast service (`recomputeAll`) iterates over all active products for a client and runs the engine for each one.

**Evidence:** `forecast-service.ts` lines 37–65 — `for (const p of activeProducts)` loop calling `forecastSKU` per product.

### 4. Key Differentiator from Aggregate Forecasting

The SKU-level execution means:
- Each product gets its own 12-month demand history (from its stock movements)
- Each product gets its own trend, seasonality, and baseline
- Each product gets its own reorder recommendation
- Category-based velocity tags are computed relative to other SKUs in the same category

### 5. Output

Same as Sales Forecasting (§5.8), but per-SKU. Persisted as individual `ForecastVariable` records in DynamoDB.

---

## 7. Velocity Analysis

### 1. Business Purpose

Velocity analysis classifies each SKU by its **relative selling speed within its product category**, enabling management to identify fast-moving, slow-moving, and dead products. This supports inventory prioritization, marketing focus, and pricing decisions.

### 2. Management Problem

- **Without velocity analysis:** Management cannot objectively compare products — a product selling 50 units/month might be fast in one category but slow in another.
- **Why needed:** To prioritize procurement for fast movers, identify slow movers for clearance, and detect dead stock.
- **What decision it supports:** "Which products should get priority replenishment attention?"

### 3. Input Data

| Input | Source | Required? | Purpose |
|-------|--------|-----------|---------|
| Product ID | `Product.id` | Yes | Identifier |
| Product category | `Product.category` | Yes | Grouping for relative comparison |
| Recent 3-month average | From `forecastSKU` momentum calculation | Yes | Basis for ranking |

### 4. Calculation / Algorithm

**Function:** `computeVelocityByCategory(skus: CategoryVelocityInput[])`

**Rules:**
1. Group SKUs by category (uncategorized SKUs grouped together)
2. Sort each category by recent 3-month average demand (descending)
3. Assign tags by rank position within category:

| Rank Position | Tag | Meaning |
|---------------|-----|---------|
| Zero sales | `"dead"` | No sales in last 3 months |
| Top 20% | `"fast_mover"` | Fastest selling in category |
| Next 30% | `"medium_mover"` | Moderate seller |
| Remaining 50% | `"slow_mover"` | Slow seller |

**Formula:**
```
position = (rank + 1) / total_in_category
if recent3MonthAvg === 0 → "dead"
if position ≤ 0.2 → "fast_mover"
if position ≤ 0.5 → "medium_mover"
else → "slow_mover"
```

### 5. Variables

| Variable | Meaning | Source | Effect |
|----------|---------|--------|--------|
| `recent3MonthAvg` | Average monthly sales over last 3 months | `forecastSKU` momentum calc | Basis for ranking |
| `category` | Product category string | `Product.category` | Groups SKUs for relative comparison |
| Category size | Number of SKUs in category | Derived | Determines rank thresholds |

### 6. Parameters

| Parameter | Value | Configurable? | Location |
|-----------|------:| ------------- | -------- |
| Fast mover threshold | Top 20% | Hard-coded | `computeVelocityByCategory` |
| Medium mover threshold | Next 30% | Hard-coded | `computeVelocityByCategory` |
| Dead sales threshold | 0 units | Hard-coded | `computeVelocityByCategory` |
| History window for average | 3 months | Hard-coded | `forecastSKU` `recentAvg` calculation |

### 7. Output

| Output | Format | Meaning | Consumer |
|--------|--------|---------|----------|
| `velocityTag` | "fast_mover"/"medium_mover"/"slow_mover"/"dead" | Category-relative selling speed | Forecast page, pricing strategy |

### 8. Management Use

Management should interpret velocity tags as relative measures within each product category, not absolute sales figures. A "fast_mover" in a low-volume category sells less than a "slow_mover" in a high-volume category — the tag indicates relative priority within its peer group.

### 9. Assumptions

| Assumption | Type | Evidence |
|------------|------|----------|
| Recent 3-month sales reflect current selling speed | Inferred | Uses `recentAvg` from last 3 values |
| Products in the same category are comparable | Inferred | Category grouping logic |
| Zero recent sales means the product is dead | Inferred | `if (recent3MonthAvg === 0) → "dead"` |

### 10. Limitations

| Limitation | Impact | Evidence |
|------------|--------|----------|
| No products in category → no velocity assigned | Empty categories produce no output | `for (const [, group)` only processes non-empty groups |
| Category field may be null | All uncategorized products grouped together | `sku.category ?? "__uncategorised__"` |
| Only relative within category, no absolute measure | A "slow_mover" in a high-volume category may still be important | Design choice |

### 11. End-to-End Trace

```
forecast-service.ts (recomputeAll)
  → forecastSKU per product (provides recent3MonthAvg)
  → computeVelocityByCategory(velInputs) → velocityMap
  → velocityTag applied to ForecastVariable
    → DynamoDB persistence → Frontend display
```

---

## 8. Momentum Analysis

### 1. Business Purpose

Momentum analysis determines whether a SKU's demand is **accelerating, stable, or declining** relative to its historical average, enabling management to spot emerging trends before they fully materialize.

### 2. Management Problem

- **Without momentum analysis:** Management sees only current sales levels, not direction — a product with declining sales may look fine today but will be a problem soon.
- **Why needed:** To detect demand shifts early and adjust procurement, pricing, or marketing strategy.
- **What decision it supports:** "Is demand for this product growing, shrinking, or flat?"

### 3. Input Data

| Input | Source | Required? | Purpose |
|-------|--------|-----------|---------|
| 12-month demand history | `values` array from `forecastSKU` | Yes | Baseline average |
| Recent 3-month average | `values.slice(-3)` average | Yes | Current demand signal |

### 4. Calculation / Algorithm

```
recentAvg = average of last 3 months of demand
overallAvg = weighted average of all 12 months (3/2/1 weighting)

if recentAvg === 0 → "inactive"
if recentAvg ≥ overallAvg × 1.2 → "accelerating"
if recentAvg ≥ overallAvg × 0.6 → "stable"
else → "declining"
```

### 5. Variables

| Variable | Meaning | Source | Effect |
|----------|---------|--------|--------|
| `recentAvg` | Average monthly demand over last 3 months | Calculated | Current demand signal |
| `overallAvg` | Weighted 12-month average demand | Calculated | Historical baseline |
| 1.2× threshold | "Accelerating" threshold | Hard-coded | recentAvg must be 120%+ of baseline |
| 0.6× threshold | "Declining" threshold | Hard-coded | recentAvg must be below 60% of baseline |

### 6. Parameters

| Parameter | Value | Configurable? | Location |
|-----------|------:| ------------- | -------- |
| Accelerating threshold | 120% of overallAvg | Hard-coded | `forecast-engine.ts` momentum calc |
| Declining threshold | 60% of overallAvg | Hard-coded | `forecast-engine.ts` momentum calc |
| Recent window | 3 months | Hard-coded | `values.slice(-3)` |
| Baseline weighting | 3/2/1 (recent/middle/old) | Hard-coded | `weightedAverage` |

### 7. Output

| Output | Format | Meaning | Consumer |
|--------|--------|---------|----------|
| `momentumTag` | "accelerating"/"stable"/"declining"/"inactive" | Demand direction | Forecast page, pricing strategy |

### 8. Management Use

Management should interpret momentum alongside velocity and stock position. An "accelerating" momentum with "low" stock position suggests the product is gaining demand and may need expedited replenishment. A "declining" momentum with "high" stock suggests potential overstock.

### 9. Assumptions

| Assumption | Type | Evidence |
|------------|------|----------|
| Recent 3-month average is representative of current momentum | Inferred | Algorithm design |
| 12-month weighted average is a stable baseline | Inferred | 3/2/1 weighting scheme |
| 120% and 60% are meaningful thresholds | Hard-coded assumption | No evidence these are data-derived |

### 10. Limitations

| Limitation | Impact | Evidence |
|------------|--------|----------|
| Thresholds are arbitrary (120%, 60%) | May not fit all product categories equally | Hard-coded in `forecastSKU` |
| Only 4 categories (no "moderately accelerating") | Granularity is coarse | `MomentumTag` type |
| "Inactive" requires exact zero | A product with 1 unit/month would be "declining", not "inactive" | `recentAvg === 0` |

---

## 9. Stock-Out Alerts (Risk)

### 1. Business Purpose

Stock-out risk analysis identifies products that are likely to run out of inventory before a replenishment order can arrive, enabling management to take preventive action (expedite orders, source alternatives, adjust sales commitments).

### 2. Management Problem

- **Without stock-out risk:** Management discovers stock-outs only when they happen — too late to prevent lost sales.
- **Why needed:** To proactively identify at-risk products and take preventive action.
- **What decision it supports:** "Which products need immediate attention to prevent stock-outs?"

### 3. Input Data

| Input | Source | Required? | Purpose |
|-------|--------|-----------|---------|
| Inventory position | `currentStock + inbound − committed` | Yes | Current available stock |
| Days of cover | `inventoryPosition ÷ dailyAverage` | Yes | How many days stock will last |
| Supplier lead time | `Product.leadTimeDays` (default 14) | Yes | Time to receive replenishment |
| Daily average demand | Last 3 months demand ÷ calendar days | Yes | Demand rate |

### 4. Calculation / Algorithm

**Days of Cover:**
```
daysOfCover = inventoryPosition ÷ dailyAverage
```
Where `dailyAverage = Σ(last 3 months demand) ÷ Σ(last 3 months calendar days)`.

**Stock-Out Risk:**
```
coverVsLead = daysOfCover ÷ supplierLeadTime
if coverVsLead < 1.0 → "high"
if coverVsLead < 1.5 → "medium"
else → "low"
```

**Estimated Stockout Date:**
```
estimatedStockoutDate = today + daysOfCover
```

**Reorder-By Date:**
```
reorderByDate = estimatedStockoutDate − supplierLeadTime
```

**Stock-Out Urgency:**
```
if inventoryPosition ≤ 0 OR reorderByDate ≤ today → "critical"
if reorderByDate ≤ today + supplierLeadTime → "warning"
else → "safe"
```

### 5. Variables

| Variable | Meaning | Source | Effect |
|----------|---------|--------|--------|
| `inventoryPosition` | Current available stock (units) | Computed from movements | Numerator of days of cover |
| `dailyAverage` | Average daily demand | Last 3 months demand ÷ days | Denominator of days of cover |
| `supplierLeadTime` | Days to receive a new order | Product catalogue | Urgency threshold |
| `daysOfCover` | Days until stock runs out | Computed | Primary risk indicator |

### 6. Parameters

| Parameter | Value | Configurable? | Location |
|-----------|------:| ------------- | -------- |
| High risk threshold | coverVsLead < 1.0 | Hard-coded | `forecast-engine.ts` risk calc |
| Medium risk threshold | coverVsLead < 1.5 | Hard-coded | `forecast-engine.ts` risk calc |
| Default lead time | 14 days | Configurable per product | `Product.leadTimeDays` |
| History window for daily average | 3 months | Hard-coded | `forecastSKU` |

### 7. Output

| Output | Format | Meaning | Consumer |
|--------|--------|---------|----------|
| `stockoutRisk` | "low"/"medium"/"high" | Risk of stock-out | Forecast page risk badges |
| `estimatedStockoutDate` | ISO date string | Predicted date stock runs out | Forecast page timeline |
| `reorderByDate` | ISO date string | Last date to place order | Forecast page timeline |
| `nextRefillDate` | ISO date string | When a today-order would arrive | Forecast page timeline |
| `stockoutUrgency` | "critical"/"warning"/"safe" | Immediate action needed? | Forecast page urgency indicator |
| `daysOfCover` | number (days) | Days until stockout | Forecast page |

### 8. Management Use

A "critical" urgency means management should act immediately — stock has already run out or the reorder deadline has passed. A "warning" urgency means the reorder deadline is within one lead-time cycle. "Safe" means there is adequate time. Management should use `reorderByDate` as the target date for placing purchase orders.

### 9. Assumptions

| Assumption | Type | Evidence |
|------------|------|----------|
| Demand continues at the recent 3-month rate | Inferred | `dailyAverage` is used as the demand forecast |
| Supplier lead time is fixed and accurate | Inferred | Used directly without variability |
| No inbound orders already in transit | Inferred | `confirmedInboundStock` defaults to 0 |

### 10. Limitations

| Limitation | Impact | Evidence |
|------------|--------|----------|
| No inbound order tracking integrated | `confirmedInboundStock` defaults to 0 | `cfg.confirmedInboundStock ?? 0` |
| Lead time is treated as fixed | No lead-time variability considered | `leadTimeVariabilityDays` in SKUConfig but unused |
| Days of cover = Infinity for zero-demand products | Cannot assess risk for products with no sales | `dailyAverage > 0 ? ... : Infinity` |
| Risk thresholds may not suit all categories | 1.0/1.5× lead time is hard-coded | No per-category configuration |

---

## 10. Overstock Alerts (Risk)

### 1. Business Purpose

Overstock risk analysis identifies products where inventory levels are excessive relative to demand, tying up capital and warehouse space unnecessarily.

### 2. Management Problem

- **Without overstock risk:** Management may not realize capital is tied up in slow-moving inventory.
- **Why needed:** To identify products that should be discounted, promoted, or not reordered.
- **What decision it supports:** "Which products have excess inventory that should be addressed?"

### 3. Calculation / Algorithm

```
maxCover = cfg.maxCoverDays ?? 180

if daysOfCover === Infinity AND inventoryPosition > 0 → "high"
if daysOfCover > maxCover → "high"
if daysOfCover > maxCover × 0.75 → "medium"
else → "low"
```

### 4. Parameters

| Parameter | Value | Configurable? | Location |
|-----------|------:| ------------- | -------- |
| Default max cover days | 180 | Configurable per product | `Product.maxStock` / `maxCoverDays` |
| Medium overstock threshold | 75% of maxCover | Hard-coded | `forecast-engine.ts` risk calc |

### 5. Output

| Output | Format | Meaning | Consumer |
|--------|--------|---------|----------|
| `overstockRisk` | "low"/"medium"/"high" | Risk of overstocking | Forecast page risk badges |

### 6. Management Use

An overstock "high" risk suggests management should consider pausing reorders, running promotions, or discounting to reduce inventory. The `maxCoverDays` parameter (default 180) controls the threshold — products with more than 180 days of cover at current demand are flagged.

---

## 11. SKU Reorder Recommendations

### 1. Business Purpose

The reorder recommendation calculates **how many units to order** and **when to order**, combining demand forecast, lead time, and safety stock to determine the optimal reorder quantity.

### 2. Management Problem

- **Without reorder recommendations:** Management must manually calculate how much to order, often leading to over-ordering or under-ordering.
- **Why needed:** To automate the reorder quantity calculation and ensure orders arrive before stock runs out.
- **What decision it supports:** "How many units should I order for this SKU, and when?"

### 3. Input Data

| Input | Source | Required? | Purpose |
|-------|--------|-----------|---------|
| Inventory position | Computed from stock movements | Yes | Current stock level |
| Last 3 months demand | Corrected outbound demand | Yes | Demand rate |
| Supplier lead time | `Product.leadTimeDays` | Yes | Reorder timing |
| Safety stock days | `Product.safetyStockDays` | Yes | Safety buffer |
| Maximum cover days | `Product.maxStock` | No | Overstock cap |
| Minimum order quantity | `Product.moq` | No | Minimum order |
| Order multiple | `Product.orderMultiple` | No | Rounding rule |

### 4. Calculation / Algorithm

**Step 1 — Daily Average:**
```
dailyAverage = Σ(last 3 months corrected demand) ÷ Σ(last 3 months calendar days)
```

**Step 2 — Required Stock:**
```
requiredStock = dailyAverage × (supplierLeadTime + safetyStockDays)
```

**Step 3 — Raw Reorder:**
```
rawReorder = max(0, requiredStock − inventoryPosition)
```

**Step 4 — Apply Caps:**
```
// Max cover cap (unless product isProtectedCore)
if maxCoverDays AND NOT isProtectedCore AND dailyAverage > 0:
    maxStock = dailyAverage × maxCoverDays
    headroom = max(0, maxStock − inventoryPosition)
    recommended = min(rawReorder, headroom)

// Minimum order quantity
if recommended > 0 AND minimumOrderQty:
    recommended = max(recommended, minimumOrderQty)

// Order multiple rounding (round up)
if orderMultiple > 1 AND recommended > 0:
    recommended = ceil(recommended ÷ orderMultiple) × orderMultiple
else:
    recommended = ceil(recommended)
```

### 5. Variables

| Variable | Meaning | Source | Effect |
|----------|---------|--------|--------|
| `inventoryPosition` | Current available stock | Computed | Subtracted from required stock |
| `dailyAverage` | Average daily demand (last 3 months) | Computed | Drives required stock calculation |
| `supplierLeadTime` | Days to receive order | Product catalogue | Multiplied into required stock |
| `safetyStockDays` | Days of safety buffer | Product catalogue | Multiplied into required stock |
| `maxCoverDays` | Maximum inventory cover | Product catalogue | Caps reorder quantity |
| `minimumOrderQty` | Minimum order size | Product catalogue | Floor for order quantity |
| `orderMultiple` | Order rounding rule | Product catalogue | Rounds up to nearest multiple |

### 6. Parameters

| Parameter | Value | Configurable? | Location |
|-----------|------:| ------------- | -------- |
| Default lead time | 14 days | Configurable per product | `Product.leadTimeDays` |
| Default safety stock | 30 days | Configurable per product | `Product.safetyStockDays` |
| Max cover days | 180 days (default) | Configurable per product | `Product.maxStock` |
| isProtectedCore | false (default) | Configurable per product | `SKUConfig` |

### 7. Output

| Output | Format | Meaning | Consumer |
|--------|--------|---------|----------|
| `recommendedReorder` | number (units) | How many units to order | Forecast page, reorder column |
| `reorderByDate` | ISO date | When to place order | Forecast page timeline |
| `safetyStockUnits` | number | Safety stock in units | Calculation breakdown |

### 8. Management Use

Management should place a purchase order for `recommendedReorder` units by the `reorderByDate`. The recommendation accounts for lead time, safety buffer, and maximum cover constraints. Products marked `isProtectedCore` bypass the max-cover cap.

### 9. Assumptions

| Assumption | Type | Evidence |
|------------|------|----------|
| Demand will continue at the recent 3-month rate | Inferred | `dailyAverage` used as demand proxy |
| Supplier can deliver in exactly `leadTimeDays` | Inferred | No variability in lead time |
| No inbound orders in transit | Inferred | `confirmedInboundStock` defaults to 0 |
| Safety stock of 30 days is adequate (default) | Hard-coded default | `cfg.safetyStockDays ?? 30` |

### 10. Limitations

| Limitation | Impact | Evidence |
|------------|--------|----------|
| No inbound order integration | Overlooks orders already placed | `confirmedInboundStock` defaults to 0 |
| Lead time treated as fixed | No supplier variability considered | `leadTimeVariabilityDays` unused |
| Safety stock of 30 days may not suit all products | Products with short lead times get excessive safety stock | Default 30 hard-coded |
| No Economic Order Quantity (EOQ) model | Does not optimize for holding vs ordering costs | Simple reorder rule |
| Reorder is per-SKU, not per-supplier | Does not batch orders to reduce shipping costs | Per-product calculation |

---

## 12. Margin Analysis

### 1. Business Purpose

Margin analysis (as partially implemented) provides the **minimum price floor** for each SKU based on its cost and desired gross margin, used by the pricing strategy engine to ensure recommended prices never violate margin requirements.

### 2. Management Problem

- **Without margin analysis:** Pricing recommendations might suggest prices below cost or below acceptable margins.
- **Why needed:** To ensure profitability floor is maintained in all pricing decisions.
- **What decision it supports:** "What is the lowest acceptable price for this product?"

### 3. Calculation / Algorithm

```
minimumPrice = unitCost ÷ (1 − minGrossMarginPercentage)
```

Where `minGrossMarginPercentage` is clamped to [0.01, 0.99].

**Example:** If unit cost = ₹60 and min gross margin = 40%, then minimumPrice = ₹60 ÷ (1 − 0.40) = ₹100.

### 4. Current Implementation Status

**Partially Implemented.** Margin analysis exists only as:
- A field in the Product catalogue (`minimumGrossMarginPercentage`, default 0.40)
- A calculation within `computePricingStrategy` (`minimumPrice`)
- A value displayed in the pricing strategy output

There is **no standalone margin analysis capability** — no margin-per-SKU report, no margin-per-customer analysis, no margin-per-category aggregation, and no margin trend analysis. The margin data serves exclusively as an input to the pricing strategy engine.

### 5. Output

| Output | Format | Meaning | Consumer |
|--------|--------|---------|----------|
| `minimumPrice` | number ($) | Minimum permitted price | Pricing strategy output |
| `minGrossMarginPct` | number (0–1) | Configured margin floor | Pricing strategy conditions |

---

## 13. Pricing Recommendations

### 1. Business Purpose

Pricing recommendations suggest price adjustments (increases or decreases) for each SKU based on its velocity, momentum, and inventory position, helping management optimize pricing to balance demand stimulation with margin protection.

### 2. Management Problem

- **Without pricing recommendations:** Management sets prices manually without demand-side context.
- **Why needed:** To data-drive pricing decisions — discount slow movers with high stock, protect margins on fast movers, hold prices on steady sellers.
- **What decision it supports:** "Should I change the price of this product, and if so, by how much?"

### 3. Input Data

| Input | Source | Required? | Purpose |
|-------|--------|-----------|---------|
| Velocity tag | `computeVelocityByCategory` | Yes | Relative selling speed |
| Momentum tag | `forecastSKU` momentum calc | Yes | Demand direction |
| Days of cover | `forecastSKU` | Yes | Inventory position indicator |
| Unit cost (MRP) | `Product.unitCost` | Yes | Minimum price calculation |
| Unit price | `Product.unitPrice` / MRP | Yes | Current selling price |
| Minimum gross margin % | `Product.minimumGrossMarginPercentage` | Yes | Price floor |
| Supplier lead time | `Product.leadTimeDays` | Yes | Inventory position context |
| Safety stock days | `Product.safetyStockDays` | Yes | Inventory position context |
| Max cover days | `Product.maxStock` | Yes | Inventory position context |

### 4. Calculation / Algorithm

**Step 1 — Determine Inventory Position:**
```
if daysOfCover < supplierLeadTimeDays + safetyStockDays → "low"
if daysOfCover > maxCoverDays → "high"
else → "normal"
```

**Step 2 — Resolve Price Change:**
Match against `DEFAULT_PRICE_CHANGE_RULES` (first match wins):

| # | Rule ID | Velocity | Momentum | Stock Position | Change % |
|---|---------|----------|----------|----------------|--------:|
| 1 | clearance-dead | dead | any | high | −25% |
| 2 | clearance-inactive | any | inactive | high | −25% |
| 3 | markdown | slow_mover | declining | high | −15% |
| 4 | protect-accelerating | fast_mover | accelerating | low | +5% |
| 5 | protect-stable | fast_mover | stable | low | +3% |
| 6 | targeted-promotion | slow_mover | stable | any | −10% |
| 7 | hold-price | medium_mover | stable | any | 0% |

**Step 3 — Calculate Recommended Price:**
```
recommendedPrice = unitPrice × (1 + changePct / 100)
```
Applied to the SKU's **current selling price (MRP)**, NOT the unit cost.

**Step 4 — Calculate Minimum Price:**
```
minimumPrice = unitCost ÷ (1 − minGrossMargin)
```

**Step 5 — Determine Strategy:**

| Condition | Strategy | Suggested Action |
|-----------|----------|-----------------|
| (dead OR inactive) AND high stock | Clearance | Reduce price by 25% |
| slow_mover AND declining AND high stock | Markdown / Promotion | Reduce price by 15% |
| slow_mover AND stable | Targeted promotion | Reduce price by 10% or bundle |
| medium_mover AND stable | Hold price | No change |
| fast_mover AND accelerating AND low stock | Protect margin | Review +5% increase |
| fast_mover AND stable AND low stock | Protect margin | Avoid discounts |
| fast_mover AND stable | Hold price / protect availability | No discount; prioritise replenishment |
| fast_mover AND declining | Monitor | Hold price; do not increase |
| Default | Hold price | No price change recommended |

### 5. Variables

| Variable | Meaning | Source | Effect |
|----------|---------|--------|--------|
| `velocity` | Category-relative selling speed | `computeVelocityByCategory` | Primary input to rule matching |
| `momentum` | Demand direction vs historical | `forecastSKU` momentum calc | Primary input to rule matching |
| `inventoryPosition` | Days of cover vs targets | Computed | Determines stock position tag |
| `unitCost` | Product cost price | Product catalogue | Minimum price calculation |
| `unitPrice` | Current selling price (MRP) | Product catalogue | Base for price change % |

### 6. Parameters

| Parameter | Value | Configurable? | Location |
|-----------|------:| ------------- | -------- |
| Clearance discount | −25% | Hard-coded (override via `priceChangeRules`) | `DEFAULT_PRICE_CHANGE_RULES` |
| Markdown discount | −15% | Hard-coded | `DEFAULT_PRICE_CHANGE_RULES` |
| Targeted promotion discount | −10% | Hard-coded | `DEFAULT_PRICE_CHANGE_RULES` |
| Margin protect increase (accelerating) | +5% | Hard-coded | `DEFAULT_PRICE_CHANGE_RULES` |
| Margin protect increase (stable) | +3% | Hard-coded | `DEFAULT_PRICE_CHANGE_RULES` |
| Default minimum margin | 40% | Configurable per product (default 0.40) | `Product.minimumGrossMarginPercentage` |

### 7. Output

| Output | Format | Meaning | Consumer |
|--------|--------|---------|----------|
| `strategy` | string | Pricing strategy label | Forecast page |
| `suggestedAction` | string | Human-readable action | Forecast page |
| `reason` | string | Why this strategy | Forecast page |
| `minimumPrice` | number ($) | Price floor | Forecast page |
| `recommendedPrice` | number ($) | Suggested price | Forecast page |
| `recommendedPriceChangePct` | number (%) | Price change % | Forecast page |
| `triggeredRule` | string | Which rule matched | Forecast page |
| `inventoryPosition` | "low"/"normal"/"high" | Stock position | Forecast page |
| `priceChangeRule` | string/null | Rule ID from table | Calculation breakdown |
| `conditions` | object | Input conditions | Calculation breakdown |

### 8. Management Use

Management should review pricing recommendations as **suggestions only** — they are never automatically applied to prices. The system explicitly states: "recommendation only — never auto-applied." Management should evaluate the recommendation against broader business context (competitor pricing, customer relationships, strategic priorities) before adjusting prices.

### 9. Assumptions

| Assumption | Type | Evidence |
|------------|------|----------|
| The price-change table captures appropriate business rules | Hard-coded assumption | `DEFAULT_PRICE_CHANGE_RULES` |
| A 25% clearance is appropriate for dead/overstock products | Hard-coded assumption | Rule `clearance-dead` |
| A 5% increase is acceptable for accelerating fast movers | Hard-coded assumption | Rule `protect-accelerating` |
| Velocity, momentum, and stock position are sufficient for pricing | Hard-coded assumption | Only three inputs to the rule engine |

### 10. Limitations

| Limitation | Impact | Evidence |
|------------|--------|----------|
| Price-change rules are hard-coded | Cannot be adjusted without code changes | `DEFAULT_PRICE_CHANGE_RULES` |
| No competitor pricing integration | Recommendations ignore market context | No external data sources |
| No customer-segment pricing | All customers see the same recommendation | No customer data in engine |
| No promotional calendar integration | Promotions not coordinated with pricing | `promotionLift` always defaults to 1.0 |
| No price elasticity modeling | Cannot predict demand response to price changes | Rule-based only |
| Recommendations are advisory only | No enforcement mechanism | "never auto-applied" |

---

## 14. Business Logic vs Technical Logic

### 14.1 Sales Forecasting

**Business Logic:**
- The system looks at how much of each product was sold over the last 12 months.
- Recent months count more than old months (recency weighting).
- It detects whether sales are trending up, down, or flat (linear trend).
- It identifies seasonal patterns (e.g., "Product X always sells more in December").
- It adjusts for months where the product was out of stock (availability correction).
- It projects demand forward 6 months, applying any business factors (season, weather, promotions).
- It compares actual current-month sales to what was expected and nudges the next-month forecast accordingly.

**Technical Logic:**
- 12-month trailing buckets of outbound `StockMovement` records (direction=out, status=confirmed)
- `correctForAvailability` applies: `corrected = actual / max(rate, 0.70)` capped at `actual × 1.4`
- Weighted average: weights `[3,3,3,2,2,2,1,1,1,1,1,1]` over 12 months
- OLS slope: `slope = (n·Σxy − Σx·Σy) / (n·Σx² − (Σx)²)`
- Seasonality: `factor = clamp(monthAvg / overallAvg, 0.5, 2.0)`
- Factors: `combined = baseline × trekking × weather × promo × regional × event`, clamped to 0.7–1.5×
- Pace: `adjustment = 1 + 0.3 × (actual/expected − 1)`, clamped to 0.8–1.2×
- 80% prediction intervals via standard error of OLS residuals

### 14.2 Velocity Analysis

**Business Logic:**
- Products are grouped by category and ranked by recent selling speed.
- The top 20% are "fast movers," next 30% "medium movers," rest "slow movers," zero sales "dead."
- This helps management prioritize attention by category.

**Technical Logic:**
- `computeVelocityByCategory`: group by `Product.category`, sort by `recent3MonthAvg` descending, assign by percentile rank.

### 14.3 Momentum Analysis

**Business Logic:**
- Recent 3-month average demand is compared to the 12-month weighted average.
- If recent demand is 120%+ of average → accelerating; below 60% → declining; between → stable; zero → inactive.

**Technical Logic:**
- `recentAvg = values.slice(-3).reduce(sum) / 3`
- `overallAvg = weightedAverage(values, [3,2,1])`
- Thresholds: 1.2× (accelerating), 0.6× (declining)

### 14.4 Stock-Out Risk

**Business Logic:**
- How many days will current stock last at current demand?
- If stock will last fewer days than the supplier lead time → high risk.
- If within 1.5× lead time → medium risk.
- Urgency: "critical" if already out or past reorder date; "warning" if within one lead time; "safe" otherwise.

**Technical Logic:**
- `daysOfCover = inventoryPosition / dailyAverage`
- `coverVsLead = daysOfCover / supplierLeadTime`
- Risk: `< 1 = high`, `< 1.5 = medium`, `else = low`
- `estimatedStockoutDate = today + daysOfCover`
- `reorderByDate = stockoutDate − leadTime`

### 14.5 Reorder Recommendations

**Business Logic:**
- How much stock do we need to cover demand until the next delivery arrives, plus a safety buffer?
- If current stock is below that → order the difference.
- Respect minimum order quantities and order multiples.

**Technical Logic:**
- `requiredStock = dailyAverage × (leadTime + safetyDays)`
- `reorder = max(0, requiredStock − inventoryPosition)`
- Caps: maxCover, MOQ, orderMultiple

### 14.6 Pricing Recommendations

**Business Logic:**
- Fast movers with low stock and accelerating demand → can increase price.
- Dead/slow movers with high stock → should decrease price to stimulate demand or clear stock.
- Medium movers with stable demand → hold price.
- Never recommend below the margin floor.

**Technical Logic:**
- Rule-based table matching (velocity × momentum × stockPosition → changePct)
- `recommendedPrice = unitPrice × (1 + changePct / 100)`
- `minimumPrice = unitCost / (1 − minMargin)`

---

## 15. Intended vs Actual Implementation

### 15.1 Capability Comparison

| Capability | Intended Logic (Protocol) | Actual Logic (Code) | Difference | Severity | Needs Review? |
|------------|--------------------------|--------------------|------------|----------| ------------- |
| Sales Forecasting | Demand forecasting with historical data | Weighted average + OLS trend + seasonality + pace adjustment | Method is simpler than implied (no ML/AI) — uses statistical heuristics | Low | Yes — confirm method is acceptable |
| SKU Demand Forecasting | Per-SKU forecasting | Same `forecastSKU` per product | Implemented as described | None | No |
| Velocity Analysis | Relative selling speed analysis | Category-based percentile ranking | Implemented as described | None | No |
| Momentum Analysis | Demand trend analysis | recentAvg vs overallAvg with 1.2/0.6 thresholds | Implemented as described | Low | Yes — confirm thresholds |
| Stock-Out Alerts | Early warning for stock-outs | daysOfCover vs leadTime ratio | Implemented as described | None | No |
| Overstock Alerts | Identification of excess inventory | daysOfCover vs maxCoverDays (default 180) | Implemented as described | Low | Yes — confirm maxCover default |
| SKU Reorder Recommendations | How much to order | dailyAverage × (lead + safety) − position | Implemented as described | Low | Yes — confirm safety stock default |
| Margin Analysis | Margin analysis per SKU/customer/category | Only minimum price floor for pricing engine | **Partially Implemented** — no standalone margin analysis | Medium | Yes — is standalone margin analysis needed? |
| Pricing Recommendations | Pricing based on velocity, momentum, stock position | Rule-based table with 7 rules | Implemented but rules are hard-coded "demo" values | Medium | Yes — are demo rules production-appropriate? |
| Demand Intelligence (aggregate) | Category/product-family level demand view | Not implemented as separate view | **Not Implemented** — only SKU-level | Low | Yes — is aggregate view needed? |
| AI/ML forecasting | Protocol mentions "AI/ML" capabilities | **Not Implemented** — no ML models, no training, no AI services | Entirely absent | High | Yes — is ML forecasting planned? |
| Automated price application | Some protocols suggest auto-applied pricing | **Not Implemented** — pricing is advisory only | Correct — recommendations are never auto-applied | None | No — this is the right design |

### 15.2 Key Discrepancies

1. **No ML/AI:** The protocol describes an "Intelligence Engine" which may imply machine learning. The actual implementation is purely **statistical heuristics** — weighted averages, linear regression, rule-based tables. There are no training pipelines, no model files, no external AI services.

2. **Margin Analysis is not standalone:** The protocol lists "Margin Analysis" as a capability. In the implementation, margin data is only used as an input to the pricing engine. There is no SKU-level margin report, margin trend analysis, or margin-by-customer breakdown.

3. **Pricing rules are "demo" values:** The `DEFAULT_PRICE_CHANGE_RULES` are described in the code as "demo price-change percentages" — the code comments explicitly say "Demo price-change percentages. First matching rule wins. Override by passing a custom `priceChangeRules` array." The override mechanism exists but is not used by any caller.

4. **Business factors unused:** The `ForecastFactors` type supports trekking season, weather, promotion, regional demand, and event lift — but none of these are populated from any data source. They always default to 1.0.

5. **SKUConfig fields unused:** The `SKUConfig` type supports product category, season profile, weather sensitivity, lifecycle stage, region, and more — but the forecast service only passes `safetyStockDays`.

---

## 16. Assumptions

### Explicit Assumptions (stated in code)

| # | Assumption | Evidence |
|---|------------|----------|
| 1 | Historical outbound sales represent future demand | Algorithm design — `bucketMovementsByMonth` |
| 2 | Confirmed stock movements reflect actual physical inventory | `forecast-service.ts` filters `status === "confirmed"` |
| 3 | The 12-month history window is sufficient for trend/seasonality | Hard-coded `months = 12` in `bucketMovementsByMonth` |
| 4 | The 6-month forecast horizon is appropriate | Hard-coded `horizonMonths = 6` in `forecastSKU` |
| 5 | 30-day safety stock is a reasonable default | Hard-coded `cfg.safetyStockDays ?? 30` |
| 6 | 180-day max cover is a reasonable default | Hard-coded `cfg.maxCoverDays ?? 180` |
| 7 | 80% confidence is the appropriate interval | Hard-coded `z = 1.28` in `predictionInterval` |

### Inferred Assumptions (implicit in algorithm design)

| # | Assumption | Evidence |
|---|------------|----------|
| 1 | Demand patterns are relatively stable (seasonality repeats) | Raw seasonality factor assumes calendar-month patterns |
| 2 | A linear trend is a reasonable approximation | OLS fits a single straight line |
| 3 | Recent months are more predictive than older months | 3/2/1 weighting scheme |
| 4 | 120% and 60% are meaningful momentum thresholds | Hard-coded in momentum calculation |
| 5 | Category-relative velocity is meaningful | `computeVelocityByCategory` groups by category |
| 6 | Products with zero recent sales are "dead" | `if (recent3MonthAvg === 0) → "dead"` |
| 7 | Supplier lead time is fixed and accurate | Used directly without variability |

### Needs Review

| # | Assumption | Why Needs Review |
|---|------------|-----------------|
| 1 | Are the momentum thresholds (120%, 60%) appropriate for all product categories? | Hard-coded, may not fit all businesses |
| 2 | Is 30-day safety stock appropriate for all SKUs? | Default may be too high or too low |
| 3 | Is 180-day max cover appropriate? | Default may not suit all product types |
| 4 | Are the pricing rules (clearance −25%, markdown −15%, etc.) appropriate? | Described as "demo" values in code |
| 5 | Should the business factors (season, weather, promo) be connected to real data? | Currently unused |

---

## 17. Limitations

| # | Limitation | Impact | Evidence |
|---|------------|--------|----------|
| 1 | No ML/AI capabilities | Cannot learn from patterns that linear regression misses | No ML libraries, no training pipelines |
| 2 | Linear trend only | Cannot model accelerating/decelerating trends | OLS fits single line |
| 3 | No external data integration | Cannot account for market conditions, competitors, weather | No external APIs |
| 4 | Forecast factors unused | Business context (season, weather, promo) has no effect | Defaults to 1.0 |
| 5 | SKUConfig fields unused | Product lifecycle, region, weather sensitivity unused | Not populated by service |
| 6 | No demand aggregation | Cannot view demand at category/family level | Per-SKU only |
| 7 | No confidence scoring | 80% interval exists but no per-point confidence | Fixed z=1.28 |
| 8 | No outlier detection | Extreme sales months can skew the model | No filtering |
| 9 | No new product handling | New SKUs with <2 months of data get no trend | `n < 2 → slope=0` |
| 10 | Dual engine copies | Backend and frontend can drift | `KEEP IN SYNC` comment only |
| 11 | No promotional calendar integration | Pricing rules cannot be coordinated with promotions | No promo data source |
| 12 | No lead-time variability | Reorder timing assumes fixed delivery | `leadTimeVariabilityDays` unused |
| 13 | In-memory processing only | Large product catalogs may slow recompute | No pagination or streaming |

---

## 18. Current Capability Status

| Capability | Status | Method | Main Inputs | Main Output | Recommendation | Confidence/Limitations |
|------------|--------|--------|-------------|-------------|----------------|----------------------|
| Sales Forecasting | **Implemented** | Weighted average + OLS trend + seasonality + pace adjustment | 12-month outbound movements, product catalogue | 6-month forecast, daily rate, trend, seasonality | N/A (input to other capabilities) | 80% prediction intervals; no ML; linear trend assumption |
| SKU Demand Forecasting | **Implemented** | Same as sales forecasting, per-product | Same as above | Per-SKU forecast | N/A | Same as above |
| Velocity Analysis | **Implemented** | Category-based percentile ranking | 3-month average, product category | fast_mover/medium_mover/slow_mover/dead | N/A | Depends on category data quality |
| Momentum Analysis | **Implemented** | Recent vs historical average comparison | 3-month average, 12-month weighted average | accelerating/stable/declining/inactive | N/A | Hard-coded thresholds (120%, 60%) |
| Stock-Out Alerts | **Implemented** | Days of cover vs lead time ratio | Inventory position, daily demand, lead time | low/medium/high risk, estimated stockout date | "critical"/"warning"/"safe" urgency | Lead time assumed fixed; no inbound order tracking |
| Overstock Alerts | **Implemented** | Days of cover vs max cover threshold | Inventory position, daily demand, maxCoverDays | low/medium/high overstock risk | Pause reorders, consider clearance | Default 180-day max may not suit all products |
| SKU Reorder Recommendations | **Implemented** | dailyAverage × (lead + safety) − position | Inventory, demand, lead time, safety stock, MOQ | Recommended quantity, reorder-by date | Place order for recommended qty by reorder date | No EOQ; no inbound order tracking |
| Margin Analysis | **Partially Implemented** | minimumPrice = cost ÷ (1 − margin) | Unit cost, minimum gross margin | Minimum price floor | Used by pricing engine only | No standalone margin analysis |
| Pricing Recommendations | **Implemented** | Rule-based table (velocity × momentum × stockPosition → changePct) | Velocity, momentum, stock position, unit cost/price | Strategy, recommended price, minimum price | Advisory only — never auto-applied | Rules are "demo" values; no override caller |
| Timeline Intelligence | **Implemented** | today + daysOfCover; stockoutDate − leadTime | Days of cover, lead time | Stockout date, reorder-by date, refill date, urgency | Act by reorder-by date | Assumes fixed lead time |

---

## 19. Items Requiring Sankalp Review

1. **Q1 — Method classification:** The Intelligence Engine uses weighted averages, OLS trend, seasonal factors, and rule-based pricing. There is no ML/AI. Is the current statistical method sufficient, or should ML forecasting be developed?

2. **Q2 — Margin Analysis scope:** Margin analysis currently exists only as a minimum price floor for pricing. Is a standalone margin analysis capability (SKU-level margin reports, margin trends, margin-by-customer) needed?

3. **Q3 — Pricing rules:** The `DEFAULT_PRICE_CHANGE_RULES` are described as "demo" values in the code comments. Are the current rules (clearance −25%, markdown −15%, protect +5%/+3%, etc.) appropriate for production? Should the override mechanism be used?

4. **Q4 — Momentum thresholds:** The 120% (accelerating) and 60% (declining) thresholds are hard-coded. Are these appropriate for all product categories, or should they be configurable?

5. **Q5 — Safety stock default:** The default safety stock is 30 days. Is this appropriate for all SKUs, or should it vary by category, lead time, or demand variability?

6. **Q6 — Max cover days:** The default max cover is 180 days. Is this appropriate, or should it be configurable per category?

7. **Q7 — Business factors:** The forecast engine supports trekking season, weather, promotion, regional demand, and event lift — but none are connected to real data. Should these be connected to a data source?

8. **Q8 — SKUConfig fields:** Product category, season profile, weather sensitivity, lifecycle stage, region — all defined in the type but unused by the service. Should these be populated?

9. **Q9 — Forecast engine duplication:** The engine exists as two identical copies (backend and frontend) with a "KEEP IN SYNC" comment. Should this be refactored into a shared module?

10. **Q10 — Pricing auto-apply:** Pricing recommendations are advisory only (never auto-applied). Is this the intended design, or should auto-application be considered for certain rules?

11. **Q11 — Aggregate forecasting:** There is no category-level or product-family-level demand view. Only SKU-level forecasting exists. Is an aggregate view needed?

12. **Q12 — New product handling:** Products with <2 months of data get no trend; <3 months get wide (±30%) prediction intervals. How should new products be handled?

13. **Q13 — Inbound order integration:** The reorder recommendation assumes no inbound orders in transit (`confirmedInboundStock` defaults to 0). Should inbound orders be tracked?

14. **Q14 — Lead time variability:** Lead time is treated as fixed. Should supplier delivery variability be modeled?

15. **Q15 — Outlier handling:** Extreme sales months can skew the weighted average and trend. Should outlier detection be added?

---

## 20. Unknowns / Missing Information

| # | Item | Status |
|---|------|--------|
| 1 | Whether the Intelligence Engine is production-live or only in testing | **Not Verified** from repo (see WH-TECH-02 §21) |
| 2 | Whether forecast data has been reviewed by management for accuracy | **Unknown** — no feedback loop in code |
| 3 | Whether the pricing recommendations have ever been used in practice | **Unknown** — advisory only, no usage tracking |
| 4 | Whether the `ForecastFactors` (season, weather, promo) have ever been populated | **Unknown** — defaults to 1.0; no data source identified |
| 5 | Whether the `SKUConfig` fields have ever been used | **Unknown** — not populated by forecast service |
| 6 | Whether the reorder recommendations have been acted upon | **Unknown** — no order-creation integration |
| 7 | Whether the 80% confidence interval is the right level | **Unknown** — no management feedback recorded |
| 8 | Whether the "demo" pricing rules have been customized | **Unknown** — no override caller found in code |
| 9 | Whether the 30-day safety stock default is appropriate for the business | **Unknown** — requires Sankalp confirmation |
| 10 | Whether the 180-day max cover default is appropriate | **Unknown** — requires Sankalp confirmation |
| 11 | Whether forecasting is intended as a core differentiator or an optional module | **Unknown** — see WH-TECH-01 §8 Q6, WH-TECH-02 §20 Q-6 |
| 12 | Whether there are plans for ML/AI forecasting | **Unknown** — not implemented today |
| 13 | Whether the forecast engine tests (`forecast-engine.tests.ts`) are run regularly | **Not Verified** — no test runner configured |

---

## Executive Summary

### Intelligence Engine Statistics

| Metric | Count |
|--------|------:|
| Total capabilities found | 12 |
| Fully implemented | 11 |
| Partially implemented | 1 (Margin Analysis) |
| Not implemented | 0 (all listed capabilities exist in some form) |
| Main algorithms used | Weighted average, OLS linear regression, raw seasonal factors, rule-based pricing table, heuristic risk scoring |
| Main data sources | Stock movements (confirmed outbound), Product catalogue, Inventory position |
| Major assumptions | Historical sales represent future demand; demand is linear-trending; seasonality repeats; lead time is fixed; 30-day safety stock is adequate |
| Major limitations | No ML/AI; linear trend only; no external data; unused business factors; dual engine copies; no aggregate forecasting; pricing rules are "demo" values |
| Intended-vs-actual discrepancies | No ML despite "Intelligence Engine" name; margin analysis not standalone; pricing rules described as demo; business factors unused |
| Items requiring Sankalp review | 15 questions (§19) |

### Key Findings

1. **The Intelligence Engine is a deterministic statistical system, not an AI/ML system.** It uses weighted averages, OLS regression, and rule-based tables. There are no machine learning models, no training pipelines, no external AI services.

2. **All 12 identified capabilities are implemented** (11 fully, 1 partially). The system provides comprehensive SKU-level forecasting, risk analysis, reorder recommendations, and pricing guidance.

3. **The engine exists as two identical code copies** (backend and frontend) with only a "KEEP IN SYNC" comment to prevent drift.

4. **Several features are defined but unused:** ForecastFactors (season/weather/promo), SKUConfig fields (lifecycle stage, region, weather sensitivity), and the pricing rule override mechanism.

5. **Pricing recommendations are advisory only** — never automatically applied. This appears to be the correct design.

6. **The system lacks aggregate-level views** — only SKU-level forecasting exists.

---

## Sankalp Review Agenda

1. **Method appropriateness** (Q1): Is the current statistical method sufficient, or should ML forecasting be developed?
2. **Pricing rules** (Q3): Are the "demo" pricing rules appropriate for production?
3. **Business factors** (Q7): Should season/weather/promo factors be connected to real data?
4. **Safety stock & max cover** (Q5, Q6): Are the 30-day safety stock and 180-day max cover defaults appropriate?
5. **Margin analysis scope** (Q2): Is standalone margin analysis needed beyond the pricing engine input?
6. **Forecast engine duplication** (Q9): Should the dual copies be refactored?
7. **Positioning** (Q11): Is the Intelligence Engine a core differentiator or an optional module?
8. **ML roadmap** (Q1): Is ML forecasting planned for the future?

---

*End of WH-TECH-03 v1.0. Day 3 deliverable only — no Day 4 (redesign) work performed, no code modified. Internal — Draft for Sankalp review.*
