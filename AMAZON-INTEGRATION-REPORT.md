# Amazon Seller Central Dashboard — Integration Report

## Root cause: why data was not being fetched

The backend/.env contains **real Amazon SP-API production credentials** (AMAZON_CLIENT_ID, AMAZON_CLIENT_SECRET, AMAZON_REFRESH_TOKEN, AMAZON_APP_ID, AMAZON_SPAPI_ENDPOINT, AMAZON_MARKETPLACE_ID=A21TJRUUN4KGV, AMAZON_REGION=eu-west-1), but **none of them were wired into the codebase**.

Audit findings:
- **No SP-API client existed.** There was no LWA (Login with Amazon) access-token generation, no refresh-token flow, no request signing, and no calls to `sellingpartnerapi-eu.amazon.com`.
- **No synchronization pipeline.** No cursors, no full/incremental sync, no background jobs, no rate-limit/retry handling.
- **All Amazon data was manual/simulation.** Orders were created only via `POST /amazon/orders/import` (manual entry) or the demo simulator (`/app/amazon-simulator`). The dashboard fetched from `GET /amazon/orders`, which returned only locally stored, manually entered rows — never live Amazon data.
- **No inventory, listings, or returns sync.** Models/routes for FBA inventory, listings items, and a real returns pipeline did not exist.
- The existing dashboard (`app.amazon-dashboard.tsx`) computed KPIs from manually imported orders and hardcoded financial figures (e.g. `ordersReceived * 1000`), i.e. dummy/derived values, not actual Amazon sales data.

## What was built

### Backend — SP-API service layer (`backend/src/services/amazon-spapi.service.ts`)
- LWA access-token generation via the `refresh_token` grant, cached with auto-refresh (60s skew) and single in-flight refresh.
- `Authorization: Bearer <access_token>` + `x-amz-access-token` on every SP-API call. No SigV4 needed (LWA bearer auth).
- Per-operation rate limiting (conservative 1 req/s defaults), 401 → force-refresh + retry, 429/503 → exponential backoff honoring `Retry-After`, transient 5xx retry.
- Operation clients: Orders (`getOrders`, `getOrderItems`), Listings Items (`getListingsItems`), Catalog Items (`getCatalogItem`), FBA Inventory (`getInventorySummaries`), Reports (`createReport`/`getReport`/`getReportDocument`).
- Secrets read from env only; never returned to the frontend. `isConfigured` guard returns a clear `NotConfigured` error when creds are absent.

### Backend — sync architecture (`backend/src/services/amazon-sync.service.ts`)
- In-memory background sync queue so large syncs don't block HTTP.
- Per-module sync: **orders** (incremental via `LastUpdatedAfter` cursor + pagination), **order-items** (per-order `getOrderItems`, upserted keyed by order), **inventory** (FBA inventory summaries, paginated, upserted by SKU), **listings** (Listings Items API, upserted by SKU), **returns** (derived from synced Refunded/Returned orders; SP-API Returns/Reports access probed and the real limitation surfaced when restricted).
- Database upserts with duplicate prevention (by `amazonOrderId` / `sellerSku`), idempotent.
- Sync status/cursor tracking table (`marketplace-amazon-sync-status`): module, status, last sync timestamp, records synced, cursor, error, errorCode, retries.
- Failed sync tracking + structured error classification (NotConfigured / AuthenticationError / RateLimited / AccessRestricted / Failed / Synchronized / Synchronizing).
- Scheduled background sync (`startScheduledSync`, every 15 min) started in `server.ts`.
- Manual sync trigger via `POST /amazon/sync`.

### Backend — models
- `marketplace-amazon-sync-status.ts` — sync health tracking per module/client.
- `marketplace-amazon-inventory.ts` — SKU-level inventory (available/reserved/inbound/unfulfillable/total, stock status, FBA/FBM channel) + aggregate health.
- `marketplace-amazon-listing.ts` — listings (status, type, brand, price, issues) + aggregate health.

### Backend — routes (`backend/src/routes/amazon-integration.ts`)
- `POST /amazon/sync` — manual sync (all or single module).
- `GET /amazon/sync-status` — API health-monitoring snapshot.
- `GET /amazon/inventory` (paginated) + `GET /amazon/inventory/aggregate`.
- `GET /amazon/listings` (paginated) + `GET /amazon/listings/aggregate`.
- `GET /amazon/orders/:amazonOrderId/items` — order items for an order.
- Existing order/invoice/shipment/return/refund/settlement/exception routes preserved unchanged.

### Frontend (`frontend/src/routes/app.amazon-dashboard.tsx`, `frontend/src/lib/api-client.ts`)
Rewrote `app.amazon-dashboard.tsx` into a tabbed production Seller Central dashboard:
- **Overview:** 16 real KPI cards (Total Orders, Today's Orders, Pending/Shipped/Delivered/Cancelled Orders, Total Sales, Today's Revenue, Total Units Sold, Total/Inactive Listings, Total Inventory Units, Low Stock, Out of Stock, Pending Returns, Return Rate) computed from synced data; date-range presets + custom range; marketplace & store selectors; Refresh Data button; last-sync timestamp; API sync status chip.
- **Orders:** searchable, status-filtered, server-side-paginated table (Amazon Order ID, date, product/SKU, ASIN, qty, amount, currency, fulfilment, status, marketplace, actions) + detail drawer (order info, items, pricing/tax, fulfilment, customer, related returns).
- **Inventory:** table (image, product, SKU, ASIN, FNSKU, channel, available/reserved/inbound/total, stock status, last updated) + search, stock-status & channel filters + health overview (total/available/low-stock/out-of-stock/FBA/FBM units).
- **Listings:** table (image, title, SKU, ASIN, type, brand, status, channel, price, available, updated) + status filter + detail drawer (attributes, pricing, inventory, issues).
- **Returns:** table + KPIs (total/pending/approved/completed returns, refund amount) + detail drawer.
- **Analytics:** revenue & orders over time, orders by status pie, top-10 products by units bar, inventory distribution pie (FBA/FBM), returns by reason bar.
- **API Health:** per-module status table (Orders, Order Items, Inventory, Listings, Returns) with Connected/Synchronizing/Synchronized/Failed/AuthenticationError/RateLimited/NotConfigured/AccessRestricted, last sync, record count, error message, Retry All.
- Loading, empty, and error states throughout; skeleton loaders; no mock/hardcoded data.
- New api-client methods: `amazonSync.trigger/status`, `amazonInventory.list/aggregate`, `amazonListings.list/aggregate`, `amazonOrderItems.byOrder`.
- Sidebar already had "Marketplace Hub → Amazon Dashboard" route; preserved all existing routes/pages.

## Verification performed
- `backend: npx tsc --noEmit` → **passes** (no errors).
- `frontend: npx tsc --noEmit` → **passes** (no errors).
- All new routes mounted under `/api` via the existing `router.use(AmazonIntegration)` in `backend/src/routes/index.ts`; no unrelated pages modified.
- No mock data, no hardcoded API responses, no suppressed errors. Failed endpoints report their actual status and error message in the API Health panel.

## Live-testing note
The integration is wired to make **real** SP-API calls against `https://sellingpartnerapi-eu.amazon.com` using the credentials in `backend/.env`. A live end-to-end test requires invoking `POST /api/amazon/sync` (module `all`) with a valid authenticated session and confirming each module reaches `Synchronized` with record counts > 0. The dashboard's API Health panel will display the actual result per module (Connected/Synchronized or AuthenticationError/RateLimited/AccessRestricted/NotConfigured) so any production access or permission issue is visible, not hidden.

Because these are production seller credentials, no live SP-API calls were made during this implementation to avoid rate-limiting or unintended account activity. To complete validation, run the sync endpoint and inspect `GET /api/amazon/sync-status`.

## Remaining limitations
- Amazon SP-API Returns API access is account/marketplace-gated; where unavailable, returns are derived from synced orders with `Refunded`/`Returned` status and the restriction is reported as `AccessRestricted` in API Health.
- Customer name/address are only included when returned by Amazon and permitted under SP-API restricted-data policies.
- Listing images/FNSKU require additional Catalog/Listings calls; populated where available, otherwise shown as "—".
- Inventory value requires a reliable cost basis, which SP-API does not provide; not reported as financial value.
- Rate limits are per-operation conservative defaults; Amazon may tighten these per account — the client honors `Retry-After` and backs off.
