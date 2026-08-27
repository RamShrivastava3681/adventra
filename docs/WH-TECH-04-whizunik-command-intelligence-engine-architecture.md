# WH-TECH-04 — WHIZUNIK COMMAND — The Executive Control System

## Intelligence Engine — Architecture & Expansion Roadmap

### Version 1.0

**Document Type:** Intelligence Engine architecture review & expansion roadmap (Day 4)
**Version:** 1.0
**Date:** 2026-08-18
**Classification:** Internal — Draft for Sankalp review
**Status:** Architecture review and planning exercise; no code modified, no functionality developed, no production changes
**Companion Documents:** WH-TECH-01 (Product Register), WH-TECH-02 (Technical Architecture), WH-TECH-03 (Intelligence Engine Specification)

---

## Document Control

| Attribute | Value |
|-----------|-------|
| Document ID | WH-TECH-04 |
| Document Title | WHIZUNIK COMMAND — Intelligence Engine — Architecture & Expansion Roadmap |
| Document Type | Day 4 architecture review & expansion planning |
| Version | 1.0 |
| Classification | Internal — Draft for Sankalp review |
| Prepared by | Ram Shrivastava |
| Reviewed by | Sankalp (pending) |
| Date | 2026-08-18 |
| Scope | Architecture review of existing Intelligence Engine + future architecture concept |
| Previous Documents | WH-TECH-01, WH-TECH-02, WH-TECH-03 |

### Revision History

| Version | Date | Author | Description of Changes |
|---------|------|--------|------------------------|
| 1.0 | 2026-08-18 | Ram Shrivastava | Initial Day 4 architecture review & expansion roadmap |

### Critical Rules Applied

- **Do NOT implement any new Intelligence Engine functionality.**
- **Do NOT refactor existing Intelligence Engine code.**
- **Do NOT modify algorithms.**
- **Do NOT optimize calculations.**
- **Do NOT migrate databases.**
- **Do NOT create new forecasting systems.**
- **Do NOT build receivables forecasting, supplier-payment forecasting, cash-flow forecasting, or working-capital forecasting.**
- **Do NOT change the current production architecture.**
- **Do NOT silently fix architectural problems.**
- Current architecture documented from actual implementation.
- Future architecture clearly separated from current architecture.
- Recommendations are architectural concepts only.
- All major architectural changes marked for Sankalp review.
- No Day 5 work started.

---

## 1. Document Purpose

This document reviews the architecture of the WHIZUNIK COMMAND Intelligence Engine as it exists today, determines how reusable and coherent the current implementation is, and prepares a future architectural concept and expansion roadmap. It is a Day 4 architecture review and planning exercise only:

- It does **not** implement new intelligence capabilities.
- It does **not** refactor or modify existing code.
- It does **not** change the production architecture.
- It **does** identify architectural strengths, weaknesses, gaps, and duplication.
- It **does** propose a future reusable Intelligence Engine architecture.
- It **does** create an expansion roadmap for intelligence capabilities.
- Items marked **FUTURE — ARCHITECTURE CONCEPT** are proposals only.

Day 5 is **out of scope** and is not started.

---

## 2. Current Intelligence Architecture

### 2.1 Overview

**CURRENT — IMPLEMENTED**

The Intelligence Engine is implemented as a **single TypeScript module** (`forecast-engine.ts`, ~1,878 lines) that provides all intelligence capabilities in one file. It exists in two identical copies: one in the backend (`backend/src/lib/forecast-engine.ts`) and one in the frontend (`frontend/src/lib/forecast-engine.ts`), guarded only by a `// KEEP IN SYNC` comment.

The engine is **deterministic and statistical** — no ML, no AI, no external services. It uses weighted averages, OLS linear regression, raw seasonal factors, and rule-based pricing tables. All capabilities are computed within the `forecastSKU` function or closely related functions in the same file.

### 2.2 Architecture Characteristics

| Characteristic | Assessment | Evidence |
|----------------|-----------|----------|
| Architecture pattern | Monolithic single-file module | One `forecast-engine.ts` file per copy |
| Language | TypeScript | Pure TS, no Python/ML libraries |
| Algorithm type | Statistical heuristics | Weighted average, OLS, rule-based tables |
| ML/AI | None | No training, no models, no external AI services |
| Code duplication | Two identical copies | Backend + frontend with "KEEP IN SYNC" comment |
| Configuration | Mixed (hard-coded + per-product fields) | Hard-coded thresholds + `Product.leadTimeDays`, `safetyStockDays` |
| Persistence | DynamoDB snapshots | `ForecastVariable` model |
| Client-specific logic | None in engine | Engine is client-agnostic; data is client-scoped |

### 2.3 How Each Capability Is Implemented

| Capability | Implementation | Shared With |
|------------|---------------|-------------|
| Sales Forecasting | `forecastSKU()` — the main function | All capabilities share the same baseline, trend, seasonality |
| SKU Demand Forecasting | `forecastSKU()` called per product | Sales Forecasting (same function, different scope) |
| Velocity Analysis | `computeVelocityByCategory()` — separate function in same file | Momentum (uses same `recent3MonthAvg`) |
| Momentum Analysis | Inline in `forecastSKU()` — `momentumTag` calculation | Velocity (uses same data) |
| Stock-Out Risk | Inline in `forecastSKU()` — `stockoutRisk`, `stockoutUrgency` | Overstock (same `daysOfCover` calculation) |
| Overstock Risk | Inline in `forecastSKU()` — `overstockRisk` | Stock-Out (same data) |
| Reorder Recommendations | Inline in `forecastSKU()` — reorder section | Uses same `dailyAverage`, `requiredStock` |
| Margin Analysis | `minimumPrice` in `computePricingStrategy()` | Pricing Recommendations (input only) |
| Pricing Recommendations | `computePricingStrategy()` — separate function | Uses velocity, momentum, inventory position from `forecastSKU` |
| Timeline Intelligence | Inline in `forecastSKU()` — date calculations | Uses `daysOfCover`, `supplierLeadTime` |
| Live Pace Adjustment | `computePaceAdjustment()` — separate function | Feeds into `forecastSKU` output |
| Prediction Intervals | `predictionInterval()` — separate function | Used by `forecastSKU` for each forecast month |

---

## 3. Current Capability Architecture Map

### 3.1 Full Traceability Table

| Capability | Data Source | Processing | Calculation | Output | Shared Components | Client-Specific Logic |
|------------|-----------|-----------|-------------|--------|-------------------|----------------------|
| Sales Forecasting | `StockMovement` (out, confirmed) | `bucketMovementsByMonth` (12-month bucketing) | `forecastSKU` (weighted avg + OLS + seasonality + factors) | `ForecastResult.forecast[]` (6-month array) | `weightedAverage`, `enhancedTrendSlope`, `rawSeasonalityFactor`, `applyFactors`, `predictionInterval` | None |
| SKU Demand Forecasting | Same as Sales | Same as Sales | Same `forecastSKU` per product | Per-SKU `ForecastVariable` snapshots | Same shared functions | None |
| Velocity Analysis | `Product.category`, `recent3MonthAvg` from `forecastSKU` | `computeVelocityByCategory` (group + rank) | Percentile ranking within category | `VelocityTag` per SKU | `recent3MonthAvg` (from momentum calc) | None |
| Momentum Analysis | 12-month demand values, 3-month recent average | Inline in `forecastSKU` | `recentAvg / overallAvg` ratio | `MomentumTag` per SKU | `weightedAverage` (for `overallAvg`) | None |
| Stock-Out Risk | `inventoryPosition`, `dailyAverage`, `supplierLeadTime` | Inline in `forecastSKU` | `coverVsLead` ratio | `stockoutRisk`, `estimatedStockoutDate`, `stockoutUrgency` | `daysOfCover` calculation | None |
| Overstock Risk | `daysOfCover`, `maxCoverDays` | Inline in `forecastSKU` | `daysOfCover / maxCover` | `overstockRisk` | `daysOfCover` (same as stock-out) | None |
| Reorder Recommendations | `dailyAverage`, `supplierLeadTime`, `safetyStockDays`, `inventoryPosition` | Inline in `forecastSKU` | `requiredStock − position` with caps | `recommendedReorder`, `reorderByDate` | `dailyAverage` (same as risk) | None |
| Margin Analysis | `unitCost`, `minimumGrossMarginPercentage` | `computePricingStrategy` | `cost / (1 − margin)` | `minimumPrice` | Used only by pricing | None |
| Pricing Recommendations | `velocityTag`, `momentumTag`, `daysOfCover`, `unitCost`, `unitPrice` | `computePricingStrategy` (rule matching) | `DEFAULT_PRICE_CHANGE_RULES` lookup | `PricingStrategyResult` | `determineInventoryPosition`, `resolvePriceChangePct` | None (rules are "demo" values) |

---

## 4. Shared Data Structures

### 4.1 CURRENT — IMPLEMENTED

| Data Structure | Used By | Shared? | Evidence |
|---------------|---------|---------|----------|
| `MonthlyBucket` | Sales Forecasting, SKU Demand Forecasting, all time-series calculations | **Yes** — single definition, shared everywhere | `forecast-engine.ts` type definition |
| `MovementInput` | Sales Forecasting, SKU Demand Forecasting | **Yes** — input format for bucketing | `forecast-engine.ts` type definition |
| `ForecastResult` | Sales/SKU Forecasting, Stock-Out, Overstock, Reorder, Timeline, Pricing (indirectly) | **Yes** — main output type used by all capabilities | `forecast-engine.ts` type definition |
| `MonthForecast` | Sales/SKU Forecasting | **Yes** — per-month forecast output | `forecast-engine.ts` type definition |
| `CalculationBreakdown` | Sales/SKU Forecasting, Reorder, Momentum, Risk, Timeline | **Yes** — full calculation trace for all capabilities | `forecast-engine.ts` type definition |
| `VelocityTag` | Velocity Analysis, Pricing Recommendations | **Yes** — shared tag type | `forecast-engine.ts` type definition |
| `MomentumTag` | Momentum Analysis, Pricing Recommendations | **Yes** — shared tag type | `forecast-engine.ts` type definition |
| `InventoryPosition` | Pricing Recommendations, Risk calculations | **Yes** — shared enum | `forecast-engine.ts` type definition |
| `ForecastFactors` | Sales/SKU Forecasting | **Yes** — optional business factors | `forecast-engine.ts` type definition |
| `SKUConfig` | Sales/SKU Forecasting, Pricing | **Yes** — per-product configuration | `forecast-engine.ts` type definition |
| `ForecastVariable` | All capabilities (persistence layer) | **Yes** — DynamoDB model | `forecast-variable.ts` |
| `PricingStrategyResult` | Pricing Recommendations | **Yes** — single definition | `forecast-engine.ts` type definition |

### 4.2 Assessment

**Strength:** The data structures are well-designed and shared. All capabilities operate on common types (`MonthlyBucket`, `ForecastResult`, `VelocityTag`, `MomentumTag`). There are no duplicate representations of the same business concept within the engine.

**Weakness:** The `ForecastResult` type is very large (40+ fields) and carries data for all capabilities simultaneously. Every capability's output is bundled into one monolithic return type, even when a consumer only needs a subset.

---

## 5. Shared Calculation Frameworks

### 5.1 CURRENT — IMPLEMENTED

| Shared Framework | Used By | Evidence | Reusable? |
|-----------------|---------|----------|-----------|
| `weightedAverage(values, weights)` | Baseline calculation, momentum `overallAvg` | `forecast-engine.ts` function | **Yes** — general-purpose weighted average |
| `enhancedTrendSlope(values)` | Sales/SKU Forecasting trend detection | `forecast-engine.ts` function | **Yes** — general OLS slope + R² |
| `rawSeasonalityFactor(history, targetMonth)` | Sales/SKU Forecasting seasonality | `forecast-engine.ts` function | **Yes** — general seasonal factor |
| `correctForAvailability(actual, month, availability)` | Sales/SKU Forecasting demand correction | `forecast-engine.ts` function | **Yes** — general availability correction |
| `bucketMovementsByMonth(movements, months, availability)` | Sales/SKU Forecasting data preparation | `forecast-engine.ts` function | **Yes** — general time-series bucketing |
| `currentMonthBucket(movements, availability)` | Live pace adjustment | `forecast-engine.ts` function | **Yes** — general current-period extraction |
| `computePaceAdjustment(params)` | Sales/SKU Forecasting live adjustment | `forecast-engine.ts` function | **Yes** — general pace comparison |
| `predictionInterval(values, slope, avg, index, center)` | Sales/SKU Forecasting confidence bounds | `forecast-engine.ts` function | **Yes** — general OLS prediction interval |
| `applyFactors(baseline, factors)` | Sales/SKU Forecasting business factors | `forecast-engine.ts` function | **Yes** — general factor multiplication |
| `determineInventoryPosition(cover, lead, safety, max)` | Pricing Recommendations | `forecast-engine.ts` function | **Yes** — general inventory position |
| `resolvePriceChangePct(params)` | Pricing Recommendations | `forecast-engine.ts` function | **Yes** — general rule-based lookup |
| `clamp(v, lo, hi)` | Everywhere | `forecast-engine.ts` utility | **Yes** — general utility |

### 5.2 Assessment

**Strength:** The calculation frameworks are genuinely reusable. Functions like `weightedAverage`, `enhancedTrendSlope`, `rawSeasonalityFactor`, `computePaceAdjustment`, and `predictionInterval` are well-encapsulated, parameterized, and could be reused for other time-series intelligence capabilities (receivables forecasting, cash-flow forecasting, etc.).

**Weakness:** The frameworks are embedded in the same monolithic file as the business logic. They are not separated into a "calculation utilities" module that could be independently imported.

---

## 6. Current Architecture Assessment

### 6.1 QUALITATIVE ASSESSMENT

| Area | Assessment | Evidence | Main Concern |
|------|-----------|----------|-------------|
| Modularity | **Needs Improvement** | All capabilities in one 1,878-line file; no separation between calculation utilities, business logic, and data access | Monolithic structure makes it hard to test, extend, or reuse individual capabilities |
| Reusability | **Adequate** | Shared data structures and calculation functions exist; engine is client-agnostic | Two identical copies (backend/frontend) create drift risk; no shared module |
| Data consistency | **Strong** | All capabilities use `MonthlyBucket`, `ForecastResult`, `VelocityTag`, `MomentumTag` — single definitions | No duplicate representations within the engine |
| Explainability | **Strong** | Full `CalculationBreakdown` exposes every intermediate value, formula, and number | Every forecast comes with a complete audit trail |
| Configurability | **Needs Improvement** | Most thresholds hard-coded (seasonality clamp, momentum thresholds, risk thresholds, pace adjustment); only `leadTimeDays`, `safetyStockDays`, `maxCoverDays` per product | Cannot vary intelligence behavior by client without code changes |
| Extensibility | **Adequate** | New capabilities can be added to `forecastSKU` or as new functions; existing structure is additive | Adding a new intelligence type (e.g., receivables forecasting) would require significant refactoring of the monolithic return type |
| Scalability | **Needs Improvement** | In-process computation, no caching layer, no pagination; `recomputeAll` iterates all products synchronously; DynamoDB snapshots per product | 10 clients with 100 products each = 1,000 serial forecast computations per recompute |
| Maintainability | **Adequate** | TypeScript, well-commented, `CalculationBreakdown` provides traceability; `KEEP IN SYNC` comment warns about duplication | One developer can understand it, but the monolithic structure and dual copies create maintenance burden |

### 6.2 SCORING SUMMARY

| Area | Score | Key Issue |
|------|-------|-----------|
| Modularity | Needs Improvement | Single-file monolith |
| Reusability | Adequate | Shared functions exist but are not in a separate module |
| Data Consistency | Strong | Single type definitions throughout |
| Explainability | Strong | Full calculation breakdown |
| Configurability | Needs Improvement | Hard-coded thresholds |
| Extensibility | Adequate | Additive but monolithic return type |
| Scalability | Needs Improvement | Serial in-process computation |
| Maintainability | Adequate | Readable but dual-copy burden |

---

## 7. Current Architecture Diagram

**CURRENT — IMPLEMENTED**

```
┌─────────────────────────────────────────────────────────────┐
│                    Business Data Sources                     │
│  StockMovement (confirmed, out) · Product (catalogue)       │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│              forecast-service.ts (Orchestration)              │
│  recomputeAll() · ensureFresh() · per-product iteration      │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│            forecast-engine.ts (Monolithic Engine)             │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────────────────────┐ │
│  │ Data Preparation │  │ Core Calculation                  │ │
│  │ bucketMovements  │  │ weightedAverage                   │ │
│  │ correctForAvail  │  │ enhancedTrendSlope (OLS)         │ │
│  │ currentMonth     │  │ rawSeasonalityFactor              │ │
│  └──────────────────┘  │ applyFactors                      │ │
│                        │ computePaceAdjustment             │ │
│  ┌──────────────────┐  │ predictionInterval                │ │
│  │ Risk & Timeline  │  └──────────────────────────────────┘ │
│  │ stockoutRisk     │                                       │
│  │ overstockRisk    │  ┌──────────────────────────────────┐ │
│  │ daysOfCover      │  │ Intelligence Outputs              │ │
│  │ estimatedDate    │  │ momentumTag                       │ │
│  │ reorderByDate    │  │ velocityTag (via computeVelocity │ │
│  │ stockoutUrgency  │  │   ByCategory — separate fn)      │ │
│  └──────────────────┘  │ recommendedReorder                │ │
│                        │ PricingStrategyResult              │ │
│  ┌──────────────────┐  │ (via computePricingStrategy —     │ │
│  │ Pricing          │  │   separate function)              │ │
│  │ resolvePrice     │  └──────────────────────────────────┘ │
│  │ determinePos     │                                       │
│  │ DEFAULT_RULES    │  ┌──────────────────────────────────┐ │
│  └──────────────────┘  │ Output                            │ │
│                        │ ForecastResult (monolithic type)   │ │
│                        │ CalculationBreakdown (full trace)  │ │
│                        └──────────────────────────────────┘ │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│              DynamoDB (ForecastVariable snapshots)            │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│              Frontend (app.forecast.tsx)                      │
│  Duplicated engine · recomputeTimeline() · charts · filters  │
└─────────────────────────────────────────────────────────────┘
```

**Key observations on the current diagram:**
- Everything flows through one monolithic engine file
- `computeVelocityByCategory` and `computePricingStrategy` are separate functions but in the same file
- The `ForecastResult` type is the single output carrying all capability results
- `CalculationBreakdown` provides full traceability
- The frontend has a duplicated copy of the engine

---

## 8. Current Architectural Gaps

### 8.1 CURRENT vs DESIRED REUSABLE ARCHITECTURE

| Gap | Current Situation | Desired State | Impact | Priority | Review Required |
|-----|------------------|---------------|--------|----------|----------------|
| **Dual code copies** | Engine exists identically in `backend/src/lib` and `frontend/src/lib` with "KEEP IN SYNC" comment | Single shared module imported by both | Logic drift risk; maintenance burden; bug fixes must be applied twice | High | Yes |
| **Monolithic file** | All 12 capabilities in one 1,878-line file | Separate calculation utilities from business logic from data access | Hard to test, extend, or reuse individual capabilities | Medium | Yes |
| **Hard-coded thresholds** | Seasonality clamp (0.5–2.0), momentum thresholds (1.2/0.6), risk thresholds (1.0/1.5), pace adjustment (0.3), max cover (180) | Per-client configurable thresholds | Cannot customize intelligence behavior per client | Medium | Yes |
| **Monolithic output type** | `ForecastResult` has 40+ fields covering all capabilities | Separate output types per capability | Consumers pull more data than needed; adding new capabilities bloats the type | Low | Yes |
| **No shared intelligence module** | Engine is embedded in `lib/` alongside other utilities | Dedicated `intelligence/` module with clear interfaces | Hard to find, understand, and extend intelligence code | Low | Yes |
| **No intelligence API abstraction** | Frontend directly calls engine functions + API routes | Clean intelligence service interface | Tight coupling between UI and engine internals | Low | No |
| **No client configuration layer** | Thresholds are hard-coded or per-product only | Per-client intelligence configuration (thresholds, enabled capabilities, terminology) | Cannot vary intelligence per client without code changes | Medium | Yes |
| **No intelligence versioning** | Engine has no version; snapshots are date-stamped only | Engine version tracked with snapshots | Cannot determine which version produced a snapshot | Low | No |
| **No alert generation integration** | Stock-out/overstock risk is computed but not surfaced as alerts | Risk scores feed into the Alert system | Management must check the forecast page; no proactive alerts | Medium | Yes |
| **Unused business factors** | `ForecastFactors` (season, weather, promo) always default to 1.0 | Connected to real data sources | Business context not leveraged | Low | Yes |
| **Unused SKUConfig fields** | Lifecycle stage, region, weather sensitivity unused | Populated from product data | Intelligence cannot adapt to product lifecycle | Low | Yes |
| **No intelligence testing** | `forecast-engine.tests.ts` exists but no test runner configured | Automated tests in CI/CD | Changes ship without verification | Medium | Yes |

---

## 9. Future Intelligence Engine Architecture

### FUTURE — ARCHITECTURE CONCEPT

> **This section proposes a future architecture. It is NOT implemented and NOT recommended for immediate development. It is a planning concept for Sankalp's review.**

### 9.1 Vision

The future Intelligence Engine should evolve from a monolithic forecast module into a **layered, reusable intelligence framework** that can support the full business intelligence chain:

```
Sales → Inventory → Purchase Requirements → Receivables → Supplier Payments → Cash → Working Capital
```

### 9.2 Proposed Layered Architecture

**FUTURE — ARCHITECTURE CONCEPT**

```
┌─────────────────────────────────────────────────────────────┐
│                   Layer 5 — Management Output                │
│  Dashboards · Alerts · Forecasts · Recommendations          │
│  Explanations · Action Queues · Email digests                │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                  Layer 4 — Decision Intelligence             │
│  Reorder Recommendations · Pricing Recommendations          │
│  Collection Priorities · Payment Priorities                  │
│  Cash Warnings · Working Capital Recommendations            │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                  Layer 3 — Intelligence Services             │
│  Forecasting · Trend Analysis · Velocity · Momentum         │
│  Anomaly Detection · Risk Scoring · Demand Prediction       │
│  Receivable Forecasting · Payment Forecasting               │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                   Layer 2 — Data Preparation                 │
│  Validation · Normalization · Aggregation                    │
│  Time-Series Preparation · Feature Generation                │
│  Data Quality Checks · Outlier Detection                     │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    Layer 1 — Business Data                   │
│  Sales · Purchases · Inventory · Customers · Suppliers      │
│  Receivables · Payments · Cash · Expenses                    │
└─────────────────────────────────────────────────────────────┘
```

### 9.3 Proposed Module Structure

**FUTURE — ARCHITECTURE CONCEPT**

```
src/
├── intelligence/
│   ├── core/                    # Shared calculation utilities
│   │   ├── statistics.ts        # weightedAverage, OLS, prediction intervals
│   │   ├── time-series.ts       # bucketing, seasonality, pace adjustment
│   │   ├── risk.ts              # risk scoring, threshold evaluation
│   │   └── rules.ts             # rule-based recommendation engine
│   ├── config/                  # Client configuration
│   │   ├── thresholds.ts        # configurable thresholds per client
│   │   ├── capabilities.ts      # enabled/disabled capabilities per client
│   │   └── terminology.ts       # labels, units, terminology per client
│   ├── preparation/             # Data preparation pipelines
│   │   ├── demand.ts            # demand data preparation
│   │   ├── inventory.ts         # inventory data preparation
│   │   └── receivables.ts       # receivable data preparation (future)
│   ├── services/                # Intelligence services
│   │   ├── demand-forecast.ts   # demand forecasting
│   │   ├── inventory-risk.ts    # stock-out / overstock risk
│   │   ├── velocity.ts          # velocity analysis
│   │   ├── momentum.ts          # momentum analysis
│   │   ├── reorder.ts           # reorder recommendations
│   │   ├── pricing.ts           # pricing recommendations
│   │   ├── receivable-forecast.ts  # receivable forecasting (future)
│   │   └── cash-flow.ts         # cash flow intelligence (future)
│   ├── decisions/               # Decision intelligence
│   │   ├── procurement.ts       # reorder + pricing decisions
│   │   ├── collections.ts       # collection priority decisions (future)
│   │   └── treasury.ts          # cash + payment decisions (future)
│   └── output/                  # Output formatting
│       ├── alerts.ts            # alert generation
│       ├── recommendations.ts   # recommendation formatting
│       └── explanations.ts      # explanation generation
```

### 9.4 Current vs Future Mapping

| Current Component | Future Layer | Future Module | Reused? |
|-------------------|-------------|---------------|---------|
| `weightedAverage` | Layer 2 (Data Preparation) | `core/statistics.ts` | **Yes** — direct reuse |
| `enhancedTrendSlope` | Layer 2 | `core/statistics.ts` | **Yes** — direct reuse |
| `rawSeasonalityFactor` | Layer 2 | `core/time-series.ts` | **Yes** — direct reuse |
| `bucketMovementsByMonth` | Layer 2 | `core/time-series.ts` | **Yes** — direct reuse |
| `computePaceAdjustment` | Layer 2 | `core/time-series.ts` | **Yes** — direct reuse |
| `predictionInterval` | Layer 2 | `core/statistics.ts` | **Yes** — direct reuse |
| `correctForAvailability` | Layer 2 | `preparation/demand.ts` | **Yes** — direct reuse |
| `forecastSKU` | Layer 3 | `services/demand-forecast.ts` | **Partially** — refactor into smaller services |
| `computeVelocityByCategory` | Layer 3 | `services/velocity.ts` | **Yes** — direct reuse |
| Momentum calculation | Layer 3 | `services/momentum.ts` | **Yes** — extract from inline code |
| Risk calculations | Layer 3 | `services/inventory-risk.ts` | **Yes** — extract from inline code |
| Reorder calculation | Layer 4 | `decisions/procurement.ts` | **Yes** — extract from inline code |
| `computePricingStrategy` | Layer 4 | `decisions/procurement.ts` | **Yes** — direct reuse |
| `CalculationBreakdown` | Layer 5 | `output/explanations.ts` | **Yes** — restructure for per-capability use |
| `ForecastResult` | Layer 5 | `output/recommendations.ts` | **Refactor** — split into per-capability types |

---

## 10. Future Reusability Model

### FUTURE — ARCHITECTURE CONCEPT

```
┌─────────────────────────────────────────┐
│     Common Intelligence Engine           │
│  algorithms · data structures            │
│  calculation frameworks                  │
│  recommendation framework                │
│  explanation framework                   │
└────────────────────┬────────────────────┘
                     │
          ┌──────────┴──────────┐
          ▼                     ▼
┌─────────────────┐  ┌─────────────────┐
│ Client A Config │  │ Client B Config │
│ thresholds      │  │ thresholds      │
│ enabled caps    │  │ enabled caps    │
│ terminology     │  │ terminology     │
│ alert settings  │  │ alert settings  │
└────────┬────────┘  └────────┬────────┘
         │                    │
         ▼                    ▼
┌─────────────────┐  ┌─────────────────┐
│ Client A Data   │  │ Client B Data   │
│ sales           │  │ sales           │
│ inventory       │  │ inventory       │
│ purchases       │  │ purchases       │
│ receivables     │  │ receivables     │
└────────┬────────┘  └────────┬────────┘
         │                    │
         ▼                    ▼
┌─────────────────┐  ┌─────────────────┐
│ Client A        │  │ Client B        │
│ Intelligence    │  │ Intelligence    │
│ Experience      │  │ Experience      │
└─────────────────┘  └─────────────────┘
```

### 10.1 Common Intelligence Engine (shared)

**FUTURE — ARCHITECTURE CONCEPT**

All clients share:
- Same algorithms (weighted average, OLS, seasonality, risk scoring)
- Same data structures (`MonthlyBucket`, `VelocityTag`, `MomentumTag`)
- Same calculation frameworks (statistics, time-series, rules)
- Same recommendation framework (rule-based pricing, reorder logic)
- Same explanation framework (`CalculationBreakdown`)

### 10.2 Client Configuration (per-client)

**FUTURE — ARCHITECTURE CONCEPT**

Each client configures:
- Forecast history window (default 12 months)
- Forecast horizon (default 6 months)
- Safety stock days (default 30)
- Max cover days (default 180)
- Lead time defaults
- Momentum thresholds (default 1.2/0.6)
- Seasonality clamp range (default 0.5–2.0)
- Risk thresholds (default 1.0/1.5)
- Pricing rules (currently "demo" values)
- Enabled intelligence capabilities
- Alert settings (which risks generate alerts)
- Terminology (labels, units, currency)

### 10.3 Client Data (per-client)

**FUTURE — ARCHITECTURE CONCEPT**

Each client's data flows through the common engine:
- Sales data → demand intelligence
- Inventory data → inventory intelligence
- Purchase data → procurement intelligence (future)
- Receivable data → collections intelligence (future)
- Payment data → treasury intelligence (future)
- Cash data → cash flow intelligence (future)

---

## 11. Future Data Flow

### FUTURE — ARCHITECTURE CONCEPT

```
Sales Data
    ↓
Demand Intelligence (current: forecast engine)
    ├── Demand Forecast
    ├── Velocity Tags
    ├── Momentum Tags
    └── Demand Risk Scores
        ↓
Inventory Intelligence (current: stock-out/overstock risk)
    ├── Days of Cover
    ├── Stock-Out Risk
    ├── Overstock Risk
    └── Inventory Position
        ↓
Purchase Requirements (current: reorder recommendations)
    ├── Recommended Quantities
    ├── Reorder Timing
    └── Supplier Commitments
        ↓
Receivables Intelligence (FUTURE — not implemented)
    ├── Expected Collections
    ├── Overdue Risk
    ├── Collection Priorities
    └── DPD Forecast
        ↓
Supplier Payment Intelligence (FUTURE — not implemented)
    ├── Payment Schedule
    ├── Payment Risk
    └── Payment Priorities
        ↓
Cash Position Intelligence (FUTURE — not implemented)
    ├── Cash Flow Forecast
    ├── Cash Surplus/Deficit
    └── Cash Warnings
        ↓
Working Capital Intelligence (FUTURE — not implemented)
    ├── Working Capital Forecast
    ├── Optimization Recommendations
    └── Capital Efficiency Scores
        ↓
Management Recommendations (current + future)
    ├── What happened? (historical analysis)
    ├── What is likely to happen? (forecasting)
    └── What should management consider doing? (recommendations)
```

### 11.1 Future Capability Details

| # | Capability | Required Data | Expected Output | Management Use | Dependencies | Reusable? |
|---|-----------|--------------|----------------|----------------|-------------|-----------|
| F1 | Receivables Forecasting | Invoice maturity dates, payment history, collection history, debtor payment patterns | Expected collections by period, overdue probability, collection priority ranking | "Which invoices are likely to be paid late?" | Reliable receivable data, payment history, debtor master | Yes |
| F2 | Supplier Payment Forecasting | Purchase invoice due dates, payment terms, cash position | Payment schedule, payment priority, cash requirement forecast | "When do we need to pay suppliers, and how much?" | Purchase invoice data, payment terms, cash data | Yes |
| F3 | Cash Flow Forecasting | Sales forecasts, receivable forecasts, purchase forecasts, payment forecasts, expense patterns | Cash surplus/deficit by period, cash warnings, funding needs | "Will we have enough cash in 30/60/90 days?" | F1, F2, expense data, advance data | Yes |
| F4 | Working Capital Forecasting | All of the above | Working capital cycle, optimization recommendations, capital efficiency | "How can we optimize our working capital?" | F1, F2, F3, inventory intelligence | Yes |
| F5 | Anomaly Detection | Historical patterns across all data types | Unusual transactions, outliers, data quality alerts | "Is something unusual happening?" | Sufficient historical data, baseline patterns | Yes |
| F6 | Category Intelligence | Product categories, cross-SKU patterns | Category trends, cross-sell opportunities, portfolio health | "How is each product category performing?" | Product catalogue, sales data, inventory data | Yes |

**Note:** All future capabilities (F1–F6) are **Architecture Concepts Only** — not implemented and not recommended for immediate development.

---

## 12. Intelligence Expansion Roadmap

### CURRENT — IMPLEMENTED

| # | Capability | Status | Method | Notes |
|---|-----------|--------|--------|-------|
| C1 | Sales Forecasting | **Implemented** | Weighted avg + OLS + seasonality + pace adjustment | Core capability |
| C2 | SKU Demand Forecasting | **Implemented** | Same as C1, per product | Core capability |
| C3 | Velocity Analysis | **Implemented** | Category-based percentile ranking | Core capability |
| C4 | Momentum Analysis | **Implemented** | Recent vs historical average | Core capability |
| C5 | Stock-Out Alerts | **Implemented** | Days of cover vs lead time | Core capability |
| C6 | Overstock Alerts | **Implemented** | Days of cover vs max cover | Core capability |
| C7 | SKU Reorder Recommendations | **Implemented** | Rule-based (daily avg × lead + safety − position) | Core capability |
| C8 | Margin Analysis | **Partially Implemented** | Minimum price floor only | Needs standalone expansion |
| C9 | Pricing Recommendations | **Implemented** | Rule-based table (velocity × momentum × stock) | Advisory only |
| C10 | Timeline Intelligence | **Implemented** | Date calculations from days of cover | Core capability |
| C11 | Live Pace Adjustment | **Implemented** | Actual vs expected sales comparison | Core capability |
| C12 | Prediction Intervals | **Implemented** | OLS residual-based (80% confidence) | Core capability |

### FOUNDATION — Required Before Expansion

| # | Capability | Why Needed | Depends On | Estimated Effort |
|---|-----------|------------|-----------|-----------------|
| F1 | Shared Intelligence Module | Dual code copies must be consolidated before any expansion | Decision on shared package strategy | Medium |
| F2 | Client Configuration Layer | Thresholds must be per-client before multi-client scaling | F1 | Medium |
| F3 | Intelligence API Abstraction | Clean interface between UI and engine needed for new consumers | F1 | Low |
| F4 | Alert Integration | Risk scores should generate proactive alerts | F1, existing Alert model | Low |
| F5 | Testing Infrastructure | Automated tests needed before modifying engine | CI/CD setup | Low |
| F6 | Intelligence Versioning | Snapshots must track engine version for auditability | F1 | Low |

### POTENTIAL FUTURE — Intelligence Expansion

| # | Capability | Status | Required Data | Dependencies | Value |
|---|-----------|--------|--------------|-------------|-------|
| P1 | Receivables Forecasting | **Architecture Concept Only** | Invoice maturity, payment history, collection history | Reliable invoice/payment data, debtor payment patterns | High — directly impacts cash planning |
| P2 | Supplier Payment Forecasting | **Architecture Concept Only** | Purchase invoice due dates, payment terms, cash position | Purchase invoice data, payment terms | High — prevents payment defaults |
| P3 | Cash Flow Forecasting | **Architecture Concept Only** | Sales forecasts, receivable forecasts, purchase forecasts, payment forecasts, expenses | P1, P2, expense data, advance data | Very High — CEO-level intelligence |
| P4 | Working Capital Forecasting | **Architecture Concept Only** | All of the above | P1, P2, P3, inventory intelligence | Very High — strategic planning |
| P5 | Anomaly Detection | **Architecture Concept Only** | Historical patterns across all data types | Sufficient historical data | Medium — risk management |
| P6 | Category Intelligence | **Architecture Concept Only** | Product categories, cross-SKU patterns | Product catalogue, sales data | Medium — portfolio management |
| P7 | Customer Payment Behavior | **Architecture Concept Only** | Debtor payment history, invoice aging, collection events | Debtor master, invoice data, reminder logs | High — collections optimization |
| P8 | Supplier Reliability Scoring | **Architecture Concept Only** | GRN delivery dates, PO dates, lead time history | Goods PO, GRN data, supplier master | Medium — procurement intelligence |

---

## 13. Future Capability Dependencies

### FUTURE — ARCHITECTURE CONCEPT

```
                    ┌──────────────────────────┐
                    │  Foundation Capabilities  │
                    │  (Shared Module, Config,  │
                    │   Alert Integration)      │
                    └────────────┬─────────────┘
                                 │
                    ┌────────────┴─────────────┐
                    │  Current Capabilities     │
                    │  (C1–C12: Forecast,       │
                    │   Risk, Reorder, Pricing)  │
                    └────────────┬─────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                   │
              ▼                  ▼                   ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ P7: Customer     │  │ P8: Supplier     │  │ P5: Anomaly      │
│ Payment Behavior │  │ Reliability      │  │ Detection        │
│ (needs invoice + │  │ (needs PO + GRN  │  │ (needs historical│
│  payment data)   │  │  + lead time)    │  │  patterns)       │
└────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘
         │                     │                     │
         ▼                     ▼                     │
┌──────────────────┐  ┌──────────────────┐           │
│ P1: Receivables  │  │ P2: Supplier     │           │
│ Forecasting      │  │ Payment          │           │
│ (needs P7 +      │  │ Forecasting      │           │
│  invoice data)   │  │ (needs P8 +      │           │
└────────┬─────────┘  │  cash data)      │           │
         │            └────────┬─────────┘           │
         │                     │                     │
         ▼                     ▼                     │
┌──────────────────┐  ┌──────────────────┐           │
│ P3: Cash Flow    │◄─┤ P6: Category     │           │
│ Forecasting      │  │ Intelligence     │           │
│ (needs P1 + P2 + │  └──────────────────┘           │
│  expenses)       │                                 │
└────────┬─────────┘                                 │
         │                                           │
         ▼                                           │
┌──────────────────┐                                 │
│ P4: Working      │                                 │
│ Capital          │                                 │
│ Forecasting      │                                 │
│ (needs P1+P2+P3  │                                 │
│  + inventory)    │                                 │
└──────────────────┘                                 │
```

### 13.1 Dependency Summary

| Capability | Depends On | Must Exist First |
|-----------|-----------|-----------------|
| P1: Receivables Forecasting | P7 (Customer Payment Behavior), invoice data, payment history | Reliable invoice/payment data quality |
| P2: Supplier Payment Forecasting | P8 (Supplier Reliability), purchase invoice data, cash data | Supplier payment terms, purchase data quality |
| P3: Cash Flow Forecasting | P1 (Receivables), P2 (Supplier Payments), expense data, advance data | P1 and P2 must be production-stable |
| P4: Working Capital Forecasting | P1, P2, P3, inventory intelligence | P3 must be production-stable |
| P5: Anomaly Detection | Historical data across all modules | Sufficient data volume (6+ months) |
| P6: Category Intelligence | Product catalogue, sales data, inventory data | Current inventory intelligence stable |
| P7: Customer Payment Behavior | Debtor master, invoice data, reminder logs, payment records | Debtor payment history exists |
| P8: Supplier Reliability | Goods PO data, GRN data, supplier master | GRN delivery tracking exists |

---

## 14. Architectural Recommendations

### 14.1 Consolidate Dual Engine Copies

**Current problem:** The forecast engine exists as two identical 1,878-line files (backend + frontend) with only a "KEEP IN SYNC" comment to prevent drift.

**Why it matters:** Every bug fix or feature addition must be applied twice. If one copy is updated and the other is not, forecasts will silently disagree between server-persisted snapshots and client-side display.

**Recommended direction:** Extract the engine into a shared package (or a shared directory with build-time copying) that both backend and frontend import.

**Reusability benefit:** Single source of truth; new intelligence capabilities added once.

**Scalability benefit:** Engine improvements apply to all consumers immediately.

**Risks:** Build configuration changes; import path updates; potential TypeScript compilation differences between backend (CommonJS/ESM) and frontend (Vite ESM).

**Dependencies:** Decision on monorepo tooling (npm workspaces, tsconfig paths, or build-time copy script).

**Sankalp approval required:** Yes — this changes the development workflow.

---

### 14.2 Introduce Client Intelligence Configuration

**Current problem:** Thresholds (seasonality clamp, momentum thresholds, risk thresholds, pace adjustment, max cover) are hard-coded. Per-product settings (lead time, safety stock) exist but cannot vary by client.

**Why it matters:** Different clients may have different demand patterns, lead times, and risk tolerances. A one-size-fits-all configuration limits the platform's ability to serve diverse businesses.

**Recommended direction:** Create a `ClientIntelligenceConfig` record per client, storing:
- Forecast history window (default 12)
- Forecast horizon (default 6)
- Safety stock days (default 30)
- Max cover days (default 180)
- Momentum thresholds (default 1.2/0.6)
- Risk thresholds (default 1.0/1.5)
- Enabled capabilities (default: all current)
- Pricing rules (currently "demo" values)

**Reusability benefit:** Engine becomes truly multi-client; configuration drives behavior.

**Scalability benefit:** New clients onboard by creating a config record, not by forking code.

**Risks:** Configuration complexity; incorrect thresholds could produce poor recommendations.

**Dependencies:** WH-TECH-04 §8.1 (Shared Intelligence Module).

**Sankalp approval required:** Yes — this changes the data model.

---

### 14.3 Separate Calculation Utilities from Business Logic

**Current problem:** Statistical functions (weighted average, OLS, seasonality, prediction intervals) are mixed with business logic (risk scoring, reorder calculation, pricing rules) in the same file.

**Why it matters:** Statistical utilities could be reused for future intelligence capabilities (receivables forecasting, cash flow forecasting). Mixing them with business logic makes them harder to find and test independently.

**Recommended direction:** Extract `core/statistics.ts`, `core/time-series.ts`, and `core/risk.ts` as pure utility modules with no business dependencies.

**Reusability benefit:** Future intelligence capabilities can import the same utilities.

**Scalability benefit:** Statistical improvements apply to all capabilities at once.

**Risks:** Refactoring may introduce subtle behavioral changes if not carefully tested.

**Dependencies:** WH-TECH-04 §14.1 (Consolidate Dual Engine Copies).

**Sankalp approval required:** Yes — this restructures the engine.

---

### 14.4 Integrate Risk Scores with Alert System

**Current problem:** Stock-out and overstock risk scores are computed by the forecast engine but only displayed on the forecast page. They do not generate proactive alerts.

**Why it matters:** Management must actively check the forecast page to discover risk. The existing Alert system (`backend/src/models/alert.ts`) could surface these risks automatically.

**Recommended direction:** After forecast recompute, generate Alert records for "critical" stock-out urgency and "high" overstock risk.

**Reusability benefit:** Alert generation is a generic capability that can be extended for future intelligence.

**Scalability benefit:** Proactive notifications scale better than passive dashboards.

**Risks:** Alert fatigue if thresholds are too sensitive; need per-client alert configuration.

**Dependencies:** Existing Alert model; WH-TECH-04 §14.2 (Client Intelligence Configuration for thresholds).

**Sankalp approval required:** Yes — this changes the alert generation behavior.

---

### 14.5 Split Monolithic ForecastResult Type

**Current problem:** `ForecastResult` has 40+ fields covering every capability. Every consumer receives all fields even if they only need a subset.

**Why it matters:** Adding new capabilities bloats the type further. Consumers (frontend, API) must destructure large objects. TypeScript compilation may slow with very large types.

**Recommended direction:** Split into focused types:
- `DemandForecast` (forecast array, baseline, trend, seasonality, pace)
- `InventoryRisk` (stock-out risk, overstock risk, days of cover, timeline)
- `ReorderRecommendation` (quantity, timing, safety stock)
- `MomentumVelocity` (momentum tag, velocity tag)
- `CalculationBreakdown` (full trace, optional)

Keep `ForecastResult` as a union/composite for backward compatibility.

**Reusability benefit:** Each type is focused and composable.

**Scalability benefit:** New capabilities add new types without bloating existing ones.

**Risks:** Breaking change for existing consumers; migration needed.

**Dependencies:** WH-TECH-04 §14.1 (Consolidate Dual Engine Copies).

**Sankalp approval required:** No — this is internal architecture cleanup.

---

### 14.6 Add Engine Versioning to Snapshots

**Current problem:** `ForecastVariable` snapshots do not record which engine version produced them. There is no way to determine if a snapshot was produced by an older version of the engine.

**Why it matters:** After engine updates, old snapshots may have been produced by different logic. Without versioning, it is impossible to know if a recommendation was produced by current or outdated logic.

**Recommended direction:** Add `engineVersion` field to `ForecastVariable` model. Record the engine version at recompute time.

**Reusability benefit:** Audit trail for all intelligence outputs.

**Scalability benefit:** Version-based migration when engine logic changes.

**Risks:** Minimal — additive field.

**Dependencies:** None.

**Sankalp approval required:** No — this is a data model addition.

---

## 15. Business Rationale

### CURRENT — IMPLEMENTED

**What exists today?**

The WHIZUNIK COMMAND Intelligence Engine provides SKU-level demand forecasting, inventory risk analysis, reorder recommendations, and pricing guidance. It uses statistical methods (weighted averages, linear regression, seasonal factors, rule-based tables) to produce deterministic, explainable outputs. Every forecast comes with a full calculation breakdown showing every intermediate value.

**What is working well?**

- The calculation frameworks (`weightedAverage`, `enhancedTrendSlope`, `rawSeasonalityFactor`, `computePaceAdjustment`, `predictionInterval`) are genuinely reusable and well-encapsulated.
- Data structures are consistent — all capabilities share `MonthlyBucket`, `ForecastResult`, `VelocityTag`, `MomentumTag`.
- Explainability is strong — `CalculationBreakdown` provides full audit trails.
- The engine is client-agnostic — no client-specific logic exists in the intelligence code.
- The pricing recommendation engine is well-designed — rule-based, advisory only, with clear input/output separation.

### FUTURE — ARCHITECTURE CONCEPT

**What is fragmented?**

- The engine is a monolithic file mixing calculation utilities, business logic, and output formatting.
- Dual copies (backend/frontend) create drift risk.
- Most thresholds are hard-coded, preventing per-client customization.
- Risk scores are not surfaced as proactive alerts.
- The `ForecastResult` type bundles all capability outputs into one monolithic structure.
- No shared intelligence module exists — the engine is embedded in `lib/` alongside unrelated utilities.

**What should the architecture eventually become?**

A layered, reusable Intelligence Engine with:
1. **Shared calculation utilities** (statistics, time-series, risk) — reused across all capabilities
2. **Client configuration** (thresholds, enabled capabilities, terminology) — per-client customization
3. **Capability services** (demand forecasting, velocity, momentum, risk, reorder, pricing) — focused, testable modules
4. **Decision intelligence** (reorder, pricing, collections, payments) — recommendation layer
5. **Management output** (dashboards, alerts, forecasts, explanations) — user-facing layer

**Why?**

| Benefit | Explanation |
|---------|-------------|
| Faster onboarding | New clients configure thresholds, not code |
| Less custom development | Intelligence capabilities are shared, not per-client |
| Consistent intelligence | Same algorithms produce same quality for all clients |
| Easier maintenance | Single codebase, single test suite, single deployment |
| Scalability | Engine supports 10, 50, 100 clients without separate implementations |
| Better management decisions | Full intelligence chain (sales → inventory → receivables → cash → working capital) |

---

## 16. Risks & Considerations

| # | Risk | Impact | Mitigation | Review Required |
|---|------|--------|------------|-----------------|
| 1 | Refactoring breaks existing forecasts | Users see different numbers after update | Version snapshots; compare old vs new outputs; gradual migration | Yes |
| 2 | Client configuration produces poor recommendations | Wrong thresholds → wrong alerts/reorders | Default to current hard-coded values; require Sankalp review for non-default | Yes |
| 3 | Shared module introduces build complexity | Frontend/backend compilation issues | Use build-time copy or tsconfig paths; test thoroughly | No |
| 4 | Alert integration causes alert fatigue | Too many alerts → users ignore them | Conservative thresholds; per-client alert configuration | Yes |
| 5 | Future capabilities (P1–P8) are architecturally premature | Building before data quality is sufficient | Document as concepts only; do not build until data exists | No |
| 6 | Dual code copies may have already drifted | Backend and frontend produce different results | Compare outputs; add automated comparison tests | Yes |
| 7 | Hard-coded "demo" pricing rules used in production | Recommendations may not suit real business | Replace with configurable rules per client | Yes |

---

## 17. Sankalp Review Items

### Current Architecture

1. **Q1 — Shared framework intent:** Are the current intelligence capabilities intended to share a common framework, or are they independently implemented pieces that happen to be in the same file?

2. **Q2 — Velocity/momentum definitions:** Are the current definitions of velocity (category percentile) and momentum (recent vs historical ratio) correct for the business? Should the thresholds (120%/60%) be configurable per client?

3. **Q3 — Client-specific calculations:** Are hard-coded thresholds acceptable, or should different clients be able to configure their own thresholds (safety stock, max cover, risk thresholds, pricing rules)?

4. **Q4 — Pricing rules:** The `DEFAULT_PRICE_CHANGE_RULES` are described as "demo" values. Are they appropriate for production? Should the override mechanism be used?

5. **Q5 — Alert integration:** Should stock-out and overstock risk scores generate proactive alerts through the existing Alert system?

6. **Q6 — Forecast engine duplication:** Should the dual copies (backend/frontend) be consolidated? What is the preferred approach (shared package, build-time copy, or other)?

7. **Q7 — Engine versioning:** Should forecast snapshots record which engine version produced them?

### Future Architecture

8. **Q8 — Intelligence as reusable services:** Should intelligence capabilities be treated as reusable services shared across clients, or as optional modules that can be customized per client?

9. **Q9 — Capability classification:** Which capabilities should be Core (always on), which Configurable (per-client settings), and which Optional (opt-in)?

10. **Q10 — Common intelligence foundation:** What data should become the common intelligence foundation? Is it sufficient to start with sales + inventory, or should receivables/purchases be included from the beginning?

11. **Q11 — Explainability level:** Is the current `CalculationBreakdown` (full intermediate values) sufficient, or is a simpler human-readable explanation needed?

### Expansion

12. **Q12 — Receivables intelligence timing:** When should receivables forecasting be introduced? What data quality is required first?

13. **Q13 — Cash flow forecasting prerequisites:** What data quality is required before cash-flow forecasting can be reliable? Is it even feasible with the current data model?

14. **Q14 — Next highest-value capability:** Which intelligence capability creates the most customer value next — receivables forecasting, customer payment behavior scoring, supplier reliability scoring, or anomaly detection?

15. **Q15 — Intelligence Engine positioning:** Is the Intelligence Engine a core differentiator (marketing priority) or an optional module (feature priority)? This affects architecture investment decisions.

---

## 18. Unknowns / Open Questions

| # | Item | Status |
|---|------|--------|
| 1 | Whether the Intelligence Engine is production-live or only in testing | **Not Verified** from repo (see WH-TECH-02 §21) |
| 2 | Whether the backend and frontend engine copies have already drifted | **Unknown** — no automated comparison exists |
| 3 | Whether the "demo" pricing rules have ever been customized for any client | **Unknown** — no override caller found in code |
| 4 | Whether management has reviewed forecast accuracy | **Unknown** — no feedback loop in code |
| 5 | Whether the Intelligence Engine is a core differentiator or optional module | **Unknown** — see WH-TECH-01 §8 Q6, WH-TECH-02 §20 Q-6 |
| 6 | Whether multi-client intelligence is planned (10/50/100 clients) | **Unknown** — deployment topology unclear (see WH-TECH-02 §20 Q-3) |
| 7 | Whether receivables data quality is sufficient for forecasting | **Unknown** — invoice/payment data exists but patterns unverified |
| 8 | Whether the forecast engine tests are run regularly | **Not Verified** — no test runner configured |
| 9 | Whether the business factors (season, weather, promo) have ever been populated | **Unknown** — always default to 1.0 |
| 10 | Whether the SKUConfig lifecycle/region fields have ever been used | **Unknown** — not populated by forecast service |

---

## Executive Summary

### Intelligence Engine Statistics

| Metric | Assessment |
|--------|-----------|
| Current architecture pattern | Monolithic single-file module (~1,878 lines) |
| Code duplication | Two identical copies (backend + frontend) |
| Shared data structures | 12 types shared across all capabilities (strong) |
| Shared calculation frameworks | 12 reusable functions identified (strong) |
| Client-specific logic | None in engine (strong) |
| Explainability | Full `CalculationBreakdown` (strong) |
| Configurability | Mostly hard-coded thresholds (needs improvement) |
| Scalability | Serial in-process computation (needs improvement) |

### Architecture Strengths

1. **Genuinely reusable calculation utilities** — `weightedAverage`, `enhancedTrendSlope`, `rawSeasonalityFactor`, `computePaceAdjustment`, `predictionInterval` are well-encapsulated and could serve future intelligence capabilities.
2. **Consistent data structures** — All capabilities share common types without duplication.
3. **Strong explainability** — Every forecast comes with a full audit trail of intermediate values.
4. **Client-agnostic engine** — No client-specific logic exists in the intelligence code.
5. **Well-designed pricing framework** — Rule-based, advisory-only, with clear separation of concerns.

### Architecture Weaknesses

1. **Dual code copies** — Backend and frontend contain identical 1,878-line files with only a comment to prevent drift.
2. **Monolithic file** — All capabilities in one file; no separation between utilities, business logic, and output.
3. **Hard-coded thresholds** — Most intelligence parameters cannot be configured per client.
4. **No alert integration** — Risk scores are computed but not surfaced proactively.
5. **No testing infrastructure** — Test file exists but no test runner is configured.

### Recommended Future Architecture

A **layered, reusable intelligence framework** with:
- Shared calculation utilities (statistics, time-series, risk)
- Per-client configuration (thresholds, enabled capabilities)
- Focused capability services (demand, velocity, momentum, risk, reorder, pricing)
- Decision intelligence layer (reorder, pricing, collections, payments)
- Management output layer (dashboards, alerts, forecasts, explanations)

### Reusability Strategy

- **Common engine:** All clients share the same algorithms and data structures.
- **Client configuration:** Thresholds and behavior vary per client via configuration records.
- **Client data:** Each client's data flows through the common engine independently.
- **Result:** `Common Engine + Client Config + Client Data = Client Intelligence Experience`

### Future Intelligence Expansion Areas

1. **Receivables Forecasting** — Expected collections, overdue risk, collection priorities
2. **Customer Payment Behavior** — Payment pattern scoring, debtor risk assessment
3. **Supplier Payment Forecasting** — Payment schedule, payment priority, cash requirements
4. **Supplier Reliability Scoring** — Delivery performance, lead time reliability
5. **Cash Flow Forecasting** — Cash surplus/deficit, funding needs, cash warnings
6. **Working Capital Forecasting** — Working capital cycle, optimization recommendations
7. **Anomaly Detection** — Unusual transactions, data quality alerts
8. **Category Intelligence** — Portfolio health, cross-sell opportunities

### Major Architectural Gaps

| Gap | Priority |
|-----|----------|
| Dual code copies (backend/frontend) | High |
| Hard-coded thresholds (no per-client config) | Medium |
| No alert integration for risk scores | Medium |
| Monolithic `ForecastResult` type | Low |
| No engine versioning | Low |
| No testing infrastructure | Medium |

### Items Requiring Sankalp Approval

1. Shared intelligence module consolidation approach
2. Client intelligence configuration model
3. Alert integration for stock-out/overstock risk
4. Pricing rules customization (replace "demo" values)
5. Intelligence Engine positioning (core vs optional)
6. Next highest-value intelligence capability

---

## Sankalp Architecture Review Agenda

1. **Shared framework:** Are the intelligence capabilities intended to share a common framework, or are they independent?
2. **Threshold configurability:** Should thresholds (safety stock, max cover, risk, pricing) be per-client configurable?
3. **Engine duplication:** Should the dual copies be consolidated? What approach?
4. **Alert integration:** Should risk scores generate proactive alerts?
5. **Pricing rules:** Are the "demo" rules appropriate for production?
6. **Intelligence positioning:** Core differentiator or optional module?
7. **Expansion priorities:** Receivables intelligence, customer payment behavior, or supplier reliability next?
8. **Future architecture layers:** Is the proposed 5-layer model appropriate?
9. **Reusability strategy:** Common engine + client config + client data — does this match the product vision?
10. **Cash flow forecasting:** When is the data quality sufficient to support it?

---

*End of WH-TECH-04 v1.0. Day 4 deliverable only — no Day 5 work performed, no code modified, no production changes. Internal — Draft for Sankalp review.*
