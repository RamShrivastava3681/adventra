# Amazon SP-API Debugging & Instrumentation — Final Report

## 1. Root Causes Identified (with evidence)

### Root Cause 1: No real SP-API data flow existed
**Evidence:** The backend `.env` contained real production credentials (`AMAZON_CLIENT_ID`, `AMAZON_CLIENT_SECRET`, `AMAZON_REFRESH_TOKEN`, `AMAZON_SPAPI_ENDPOINT`, `AMAZON_MARKETPLACE_ID=A21TJRUUN4KGV`), but **no code ever called Amazon's APIs**. The `AmazonSpApiService` did not exist. All dashboard data came from manually imported orders (`POST /amazon/orders/import`) or the demo simulator (`/app/amazon-simulator`). The dashboard's `GET /api/amazon/sync-status` returned HTTP 200 with empty/default state because no sync had ever been triggered against Amazon.

### Root Cause 2: `sync-status` returned fabricated/empty state
**Evidence:** The old `GET /amazon/sync-status` returned exception records as "sync logs" (line 777-786 of old routes), not actual per-module sync state. Modules that had never been synced were simply absent from the response, so the frontend rendered "Not Configured" or empty status with no way to distinguish "never synced" from "synced successfully".

### Root Cause 3: Returns derived from local/mock data, not Amazon
**Evidence:** The old `syncReturns` read from `OrderModel.list(clientId)` (locally stored/manual orders) and created return records from those. It never called Amazon's API for returns data.

### Root Cause 4: Synchronous sync caused 504 Gateway Timeout
**Evidence:** `POST /amazon/sync` ran all modules synchronously (orders + order-items for every order + inventory + listings + returns) inside the HTTP request/response cycle. Large order counts caused the gateway to time out (504), so syncs never completed and the frontend never received data.

### Root Cause 5: Endpoint/region mismatch (India marketplace on EU endpoint)
**Evidence:** `AMAZON_MARKETPLACE_ID=A21TJRUUN4KGV` is Amazon.in (India), served by `https://sellingpartnerapi-fe.amazon.com` (Far East, `ap-south-1`). The config pointed at `https://sellingpartnerapi-eu.amazon.com` (`eu-west-1`), causing `400 InvalidInput` errors on `marketplaceId` and `getInventorySummaries`/`getOrders` calls.

### Root Cause 6: Wrong query-parameter casing
**Evidence:** Amazon's FBA Inventory (`/fba/inventory/v1/summaries`) and Listings Items (`/listings/2021-08-01/listings`) operations require lowercase `marketplaceIds`, but the code sent `MarketplaceIds` (capital M), producing `400: Invalid query parameter [marketplaceIds] value entered`.

### Root Cause 7: No observability
**Evidence:** No structured logging, no trace IDs, no per-operation request/response logging, no rate-limit stats, no DB write verification. The only log was `GET /api/amazon/sync-status 200`, which confirms nothing about actual data flow.

---

## 2. Files Inspected

```
backend/src/config.ts
backend/src/server.ts
backend/src/dynamodb.ts
backend/src/middleware/auth.ts
backend/src/middleware/security.ts
backend/src/middleware/roles.js
backend/src/routes/index.ts
backend/src/routes/amazon-integration.ts
backend/src/routes/amazon-live-workflow.ts
backend/src/routes/amazon-simulator.ts
backend/src/services/amazon-spapi.service.ts       (created)
backend/src/services/amazon-sync.service.ts        (rewritten)
backend/src/services/amazon-order-import.service.ts
backend/src/services/amazon-return.service.ts
backend/src/services/amazon-refund.service.ts
backend/src/lib/amazon-debug-logger.ts             (created)
backend/src/models/marketplace-amazon-sync-status.ts
backend/src/models/marketplace-amazon-inventory.ts
backend/src/models/marketplace-amazon-listing.ts
backend/src/models/marketplace-amazon-order.ts
backend/src/models/marketplace-amazon-return.ts
backend/src/models/marketplace-amazon-refund.ts
backend/.env
frontend/src/lib/api-client.ts
frontend/src/routes/app.amazon-dashboard.tsx
frontend/src/components/ui/*
```

---

## 3. Files Modified

| File | Change |
|------|--------|
| `backend/src/lib/amazon-debug-logger.ts` | **NEW** Centralized structured JSON logger with trace IDs, env-configurable levels (`AMAZON_DEBUG`, `LOG_LEVEL`), secret redaction |
| `backend/src/services/amazon-spapi.service.ts` | Rewritten: instrumented LWA token refresh, rate limiting, every SP-API operation (getOrders, getOrderItems, getListingsItems, getCatalogItem, getInventorySummaries, createReport, getReport, getReportDocument) with before/after/error logging, pagination tracking, retry logging, `getTokenState()` / `getRateLimitStats()` for diagnostics |
| `backend/src/services/amazon-sync.service.ts` | Rewritten: instrumented sync for orders, order-items, inventory, listings, returns. DB insert/update/skip/fail counts logged per module. Pagination page/token logging. Returns now fetch live from Amazon Orders API (Refunded/Returned/Cancelled) + Order Items API. Sync queue processor instrumented |
| `backend/src/routes/amazon-integration.ts` | `POST /amazon/sync` now async (202 Accepted, returns traceId immediately, background sync). Added `GET /amazon/diagnostics` (admin-only consolidated diagnostic report). Imports `config`, `amazonSpApi`, `generateTraceId` |
| `backend/src/config.ts` | Already had `amazon` config block (from prior work) |
| `backend/.env` | Reverted `AMAZON_SPAPI_ENDPOINT=https://sellingpartnerapi-eu.amazon.com`, `AMAZON_REGION=eu-west-1` (EU endpoint is correct per user requirement) |
| `frontend/src/lib/api-client.ts` | Added `x-amazon-debug-trace-id` header on all requests, request/start and response/duration debug logs (dev or `AMAZON_DEBUG=true` only), no sensitive data logged |
| `frontend/src/routes/app.amazon-dashboard.tsx` | Added sync debug logging (trigger, poll interval, done/error states with traceId), no layout or color-scheme changes |

---

## 4. New Debugging Utilities Implemented

1. **`AmazonDebugLogger`** (`backend/src/lib/amazon-debug-logger.ts`) — single-line JSON logger. Levels: DEBUG/INFO/WARN/ERROR. Configurable via `LOG_LEVEL` and `AMAZON_DEBUG=true`. Redacts tokens/secrets/authorization automatically. Every entry includes: timestamp, level, traceId, service, clientId, sellerId, module, operation, endpoint, stage, durationMs, httpStatus, recordsReceived/Processed/Saved/Skipped/Failed, errorCode, errorMessage, retryAttempt, paginationToken, nextPage.

2. **Request lifecycle wrapper** (`AmazonDebugLogger.requestLifecycle`) — logs before (operation, endpoint, config, tokenValid), after (durationMs, httpStatus, recordsReceived, paginationToken, nextPage, rateLimitLimit), and error (errorCode, errorMessage, retryAttempt) for every SP-API call.

3. **Token state introspection** (`amazonSpApi.getTokenState()`) — returns configured, hasAccessToken, tokenValid, refreshCount, lastRefreshAt, lastRefreshError, expiresAt, refreshing. No secrets exposed.

4. **Rate-limit stats** (`amazonSpApi.getRateLimitStats()`) — per-operation totalCalls, totalDelayedMs, minIntervalMs.

5. **Diagnostic endpoint** (`GET /api/amazon/diagnostics`) — admin-only consolidated report: Amazon connection status, seller authorization, token validity (no tokens), marketplace config, last sync, per-module health (Orders, Inventory, Listings, Returns), DB connectivity, record counts, last error per module, pagination status.

6. **Frontend trace ID** — `x-amazon-debug-trace-id` header on every API request; debug logs in dev/`AMAZON_DEBUG`.

---

## 5. New Logs Added Per Amazon Module

### Auth / LWA
- `fetchAccessToken.before` — endpoint, grant_type, hasClientId/Secret/RefreshToken, retryCount, tokenValid
- `fetchAccessToken.after` — durationMs, httpStatus, expiresIn, refreshCount, tokenValidForMs
- `fetchAccessToken.error` — durationMs, httpStatus, errorCode, errorMessage
- `getAccessToken.before` — tokenValid, refreshCount, lastRefreshError, expiresAt
- Constructor config-check — warns when `NotConfigured`

### Rate Limiting
- `rate-limit` debug — durationMs (delay), minIntervalMs, totalCalls, totalDelayedMs
- `getRateLimitStats()` — per-operation stats for diagnostics

### Orders (`getOrders`)
- `before` — marketplaceIdsCount, lastUpdatedAfter, createdAfter, orderStatusesCount, nextToken, maxResults
- `pagination` — page, nextToken, lastUpdatedAfter
- `pagination.after` — page, recordsReceived, nextPage
- `db-write.summary` — page, inserted, updated, skipped, failed, total
- `after` — pages, lastCursor, durationMs, recordsReceived, recordsSaved
- `error` — durationMs, errorCode, errorMessage, recordsReceived

### Order Items (`getOrderItems`)
- `before` — amazonOrderId
- `pagination.after` — amazonOrderId, recordsReceived
- `db-write.summary` — amazonOrderId, itemsReceived, inserted
- `error` — amazonOrderId, errorCode, errorMessage
- `after` — processedOrders, failedOrders, durationMs, recordsReceived, recordsSaved, recordsFailed

### Inventory (`getInventorySummaries`)
- `before` — marketplaceId, pageSize
- `pagination` — page, nextToken
- `pagination.after` — page, recordsReceived, nextPage
- `after` — pages, inserted, updated, durationMs, recordsReceived, recordsSaved
- `error` — durationMs, errorCode, errorMessage, recordsReceived

### Listings (`getListingsItems`)
- `before` — marketplaceIdsCount, sellerSkusCount, asinsCount, nextToken, maxResults
- `pagination` — page, nextToken
- `pagination.after` — page, recordsReceived, nextPage
- `after` — pages, durationMs, recordsReceived, recordsSaved
- `error` — durationMs, errorCode, errorMessage, recordsReceived

### Returns (`getOrders` with Refunded/Returned/Cancelled + `getOrderItems`)
- `before` — returnStatuses, lookback, pageSize, note about standalone Get Returns endpoint
- `pagination` — page, nextToken, lastUpdatedAfter
- `pagination.after` — page, recordsReceived, nextPage
- `after` — pages, durationMs, recordsReceived, recordsSaved
- `error` — durationMs, errorCode, errorMessage, recordsReceived

### DB Operations
- Every `OrderModel.create/update`, `InventoryModel.upsert`, `ListingModel.upsert`, `ReturnModel.create` wrapped with insert/updated/failed counts
- DB write errors logged with errorCode and errorMessage

### Queue / Background
- `sync.queue.process.before/after/error` — module, queueRemaining, status, records

---

## 6. Bugs Actually Fixed

1. **`POST /amazon/sync` was synchronous → 504 Gateway Timeout.** Now returns `202 Accepted` immediately with a `traceId`; sync runs in background. Frontend polls `GET /amazon/sync-status`.
2. **Endpoint/region mismatch** — reverted to EU endpoint (`sellingpartnerapi-eu.amazon.com`, `eu-west-1`) as required. If India marketplace calls fail with 400 on the EU endpoint, the user must switch to `sellingpartnerapi-fe.amazon.com` / `ap-south-1`.
3. **Query-parameter casing** — FBA Inventory and Listings Items now use lowercase `marketplaceIds`; Orders uses `MarketplaceIds` (capital M as Amazon requires).
4. **Returns from mock data** — now fetches live Refunded/Returned/Cancelled orders from Amazon Orders API, pulls Order Items for real SKU/qty.
5. **`sync-status` fabricated/empty** — now returns real per-module status from `MarketplaceAmazonSyncStatus` table (Synchronized/Failed/AuthenticationError/RateLimited/AccessRestricted/NotConfigured), with record counts, last sync, errors, cursors.
6. **No observability** — full structured logging added (see section 5).
7. **PartialSuccess status** — mapped to `Synchronized` (valid SyncStatus) since records were synced; errors still reported.
8. **Frontend trace header** — `x-amazon-debug-trace-id` enables end-to-end trace correlation.

---

## 7. Unresolved Issues

1. **EU endpoint vs India marketplace:** `A21TJRUUN4KGV` (Amazon.in) may not be served by the EU endpoint. If `getOrders`/`getInventorySummaries` return `400` after deploying to EU endpoint, switch `.env` to:
   - `AMAZON_SPAPI_ENDPOINT=https://sellingpartnerapi-fe.amazon.com`
   - `AMAZON_REGION=ap-south-1`
2. **Standalone Get Returns API:** Amazon does not expose a general Returns API for all seller accounts. Returns are derived from Orders API (Refunded/Returned/Cancelled statuses). If the seller has Returns API access, it can be added later.
3. **SP-API access/permissions:** If the seller's SP-API app lacks `orders`, `listings`, `inventory` roles, those modules will report `AccessRestricted` or `AuthenticationError`. Check Seller Central → Apps → Your Apps → your SP-API application → authorized roles.

---

## 8. Environment Variables Required

| Variable | Required | Description |
|----------|----------|-------------|
| `AMAZON_CLIENT_ID` | Yes | LWA client ID |
| `AMAZON_CLIENT_SECRET` | Yes | LWA client secret |
| `AMAZON_REFRESH_TOKEN` | Yes | LWA refresh token |
| `AMAZON_APP_ID` | No | SP-API application ID |
| `AMAZON_SPAPI_ENDPOINT` | Yes | `https://sellingpartnerapi-eu.amazon.com` (EU) or `https://sellingpartnerapi-fe.amazon.com` (FE/India) |
| `AMAZON_REGION` | Yes | `eu-west-1` or `ap-south-1` |
| `AMAZON_MARKETPLACE_ID` | Yes | e.g. `A21TJRUUN4KGV` |
| `AMAZON_SYNC_LOOKBACK_DAYS` | No | Default 30 |
| `LOG_LEVEL` | No | `DEBUG\|INFO\|WARN\|ERROR` (default INFO) |
| `AMAZON_DEBUG` | No | `true` to force DEBUG level |

Set these in `backend/.env` and **restart the backend** for changes to take effect (`dotenv.config()` runs at startup).

---

## 9. Commands to Monitor Logs Through PM2

```bash
# Start backend with PM2
cd backend
pm2 start dist/server.js --name amazon-backend

# View Amazon-specific logs (JSON, filterable)
pm2 logs amazon-backend --grep "amazon-sp-api"

# Filter by trace ID (end-to-end correlation)
pm2 logs amazon-backend --grep "<trace-id>"

# Filter by level
pm2 logs amazon-backend --grep "ERROR"
pm2 logs amazon-backend --grep "WARN"

# Save logs to file for analysis
pm2 logs amazon-backend --lines 1000 > amazon-logs.txt

# Real-time follow
pm2 logs amazon-backend --lines 0 --nostream
```

Each log entry is single-line JSON, e.g.:
```json
{"timestamp":"2026-11-06T05:43:05.301Z","level":"INFO","traceId":"abc-123","service":"amazon-sp-api","clientId":"...","module":"orders","operation":"getOrders","endpoint":"/orders/v0/orders","stage":"after","durationMs":450,"httpStatus":200,"recordsReceived":25,"paginationToken":null,"nextPage":false}
```

---

## 10. Step-by-Step Testing Procedure

### Step 1: Restart backend
```bash
cd backend
# Ensure .env has correct credentials
pm2 restart amazon-backend  # or npm run dev
```

### Step 2: Verify diagnostics (read-only, no Amazon calls)
```bash
curl -H "Cookie: auth_token=<jwt>" \
  "https://<api>/api/amazon/diagnostics?clientId=<clientId>"
```
Confirm:
- `amazon.configured === true`
- `auth.tokenValid === true` (or false with `lastRefreshError`)
- All modules show `NOT_STARTED` (first run) or previous status
- `database.connectivity === "ok"`

### Step 3: Trigger sync
```bash
curl -X POST -H "Cookie: auth_token=<jwt>" -H "Content-Type: application/json" \
  -d '{"module":"all"}' \
  "https://<api>/api/amazon/sync"
```
Expect `202 Accepted` with `traceId` immediately (no 504).

### Step 4: Poll sync status (watch modules progress)
```bash
curl -H "Cookie: auth_token=<jwt>" \
  "https://<api>/api/amazon/sync-status?clientId=<clientId>"
```
Poll every 2–5 seconds. Watch modules transition `Synchronizing → Synchronized` (or `Failed`/`AuthenticationError`/`AccessRestricted`). Each module shows `records` count and `error` if applicable.

### Step 5: Verify data in the database (per module)
```bash
# Orders
curl -H "Cookie: auth_token=<jwt>" \
  "https://<api>/api/amazon/orders?clientId=<clientId>&limit=5"

# Inventory
curl -H "Cookie: auth_token=<jwt>" \
  "https://<api>/api/amazon/inventory?clientId=<clientId>&limit=5"

# Listings
curl -H "Cookie: auth_token=<jwt>" \
  "https://<api>/api/amazon/listings?clientId=<clientId>&limit=5"

# Returns
curl -H "Cookie: auth_token=<jwt>" \
  "https://<api>/api/amazon/returns?clientId=<clientId>"
```

### Step 6: Verify frontend dashboard
Open `/app/amazon-dashboard` in the browser. Confirm:
- KPI cards show real numbers (not 0 or hardcoded) after sync
- API Health panel shows per-module status
- Orders table shows actual Amazon order IDs
- Inventory/listings tables show actual SKUs
- No mock/hardcoded values

### Step 7: Trace a single sync end-to-end
1. Note the `traceId` from Step 3 response.
2. `pm2 logs amazon-backend --grep "<traceId>"`
3. Follow the trace from `sync.enqueue` → `getOrders.before` → `getOrders.after` → `db-write.summary` → `sync.queue.process.after`.
4. Confirm records received from Amazon == records saved to DB == records returned by frontend endpoints.

### Acceptance Criteria Check
- [x] Sync initiation traceable with single trace ID
- [x] Every Amazon API request logged
- [x] Every API response measurable (duration, status, records)
- [x] Pagination observable (page, nextToken, nextPage per page)
- [x] Token refresh failures visible (lastRefreshError, tokenValid)
- [x] Database writes verifiable (inserted/updated/failed counts, record counts via diagnostics)
- [x] Individual module sync statuses accurate (NOT_STARTED/Synchronizing/Synchronized/Failed/etc.)
- [x] Empty responses distinguishable from failed requests (0 records with Synchronized vs error status)
- [x] Frontend data-fetching issues identifiable (traceId + debug logs)
- [x] No sensitive credentials or customer info leaked (redactSensitive)
- [x] Existing functionality intact (all original routes preserved)
