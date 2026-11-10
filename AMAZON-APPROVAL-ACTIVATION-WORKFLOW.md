# Amazon SP-API Post-Approval Activation Workflow

**Application:** WhizUnik Command live  
**Marketplace:** Amazon India (A21TJRUUN4KGV)  
**Endpoint:** https://sellingpartnerapi-eu.amazon.com (eu-west-1)  
**Current State:** Public Developer registration UNDER REVIEW; Application DRAFT

This document is the controlled activation checklist. Do NOT automatically activate production access based on assumptions. Each step must be verified with actual evidence (HTTP status, Amazon request ID, records received/persisted) before proceeding to the next.

---

## Phase 0 — Pre-Approval (current state)

While Amazon review is pending:

- [ ] Do NOT create new production app clients.
- [ ] Do NOT bypass the application status.
- [ ] Do NOT generate duplicate application registrations.
- [ ] Do NOT unnecessarily change existing credentials.
- [ ] Keep sandbox/demo functionality operational (`/app/amazon-simulator`).
- [ ] Monitor `GET /api/amazon/application-status` for review-state changes.
- [ ] Confirm backend `.env` credentials remain unchanged (no regeneration).

### Evidence to collect now (baseline)

Run `GET /api/amazon/application-status` and record:

| Field | Value |
|-------|-------|
| developerRegistration | |
| applicationStatus | |
| productionClientAvailable | |
| publicDeveloperApproved | |
| roleApprovalStatus | |
| sellerAuthorizationStatus | |
| overallClassification | |
| reviewPendingMessage | |

---

## Phase 1 — Amazon Confirms Approval

Only begin this phase after Amazon notifies the developer that Public Developer registration is approved.

1. [ ] Public Developer registration is **Approved** (verified in Seller Central Developer Console).
2. [ ] Application status permits production use (no longer DRAFT).
3. [ ] Required API roles are approved (orders, listings, inventory, returns).
4. [ ] Production app client is available/created in Seller Central.
5. [ ] Seller account is authorized for the application (Seller Central → Apps → Your Apps → Authorize).
6. [ ] Correct LWA credentials are configured in `backend/.env`:
   - `AMAZON_CLIENT_ID`
   - `AMAZON_CLIENT_SECRET`
   - `AMAZON_REFRESH_TOKEN` (valid, not expired)
   - `AMAZON_APP_ID`
7. [ ] Environment variables updated:
   - `AMAZON_SPAPI_ENDPOINT=https://sellingpartnerapi-eu.amazon.com`
   - `AMAZON_REGION=eu-west-1`
   - `AMAZON_MARKETPLACE_ID=A21TJRUUN4KGV`
   - `AMAZON_SELLER_ID=<seller-id>`
   - Declaration vars (optional): `AMAZON_DEVELOPER_REGISTRATION_STATUS=approved`, `AMAZON_PUBLIC_DEVELOPER_APPROVED=true`, `AMAZON_PRODUCTION_CLIENT_AVAILABLE=true`, `AMAZON_ROLE_APPROVAL_STATUS=approved`, `AMAZON_SELLER_AUTHORIZED=authorized`, `AMAZON_APPLICATION_STATUS=production_enabled`
8. [ ] Backend restarted (`npm run build` + restart, or PM2 restart) so `dotenv.config()` picks up changes.

---

## Phase 2 — Post-Activation Verification (mandatory, in order)

After restart, run each test and record evidence. Do not skip a step if the previous step failed.

| # | Test | Endpoint | HTTP Status | Amazon Request ID | Records Received | Records Persisted | Result |
|---|------|----------|-------------|-------------------|------------------|-------------------|--------|
| 1 | Diagnostics / application status | `GET /api/amazon/application-status` | | | | | |
| 2 | LWA token exchange | `GET /api/amazon/diagnostics` (auth.tokenValid) | | | | | |
| 3 | Orders sync | `POST /api/amazon/sync` (module: orders) | | | | | |
| 4 | Order Items sync | `POST /api/amazon/sync` (module: order-items) | | | | | |
| 5 | Inventory sync | `POST /api/amazon/sync` (module: inventory) | | | | | |
| 6 | Listings sync | `POST /api/amazon/sync` (module: listings) | | | | | |
| 7 | Returns processing | `POST /api/amazon/sync` (module: returns) | | | | | |
| 8 | DB persistence verified | `GET /api/amazon/application-status` (module DB counts) | | | | | |
| 9 | Frontend data verified | Open `/app/amazon-dashboard` | | | | | |

### Acceptance criteria per module

- **Orders:** `SUCCESS`, recordsReceived > 0, recordsPersisted > 0, DB count matches.
- **Order Items:** `SUCCESS`/`PARTIAL`, items persisted for synced order IDs. Must NOT be marked successful if Orders failed.
- **Inventory:** `SUCCESS`, FBA inventory summaries persisted by SKU. Distinguish FBA from FBM.
- **Listings:** `SUCCESS` or `ACCESS_RESTRICTED` (if Listings role not approved — record the restriction, do not fail the whole activation).
- **Returns:** `SUCCESS`/`EMPTY`, derived from Orders API (Refunded/Returned/Cancelled). Record if standalone Returns API is unavailable.

### After each test, record

- HTTP status code
- Amazon `x-amzn-RequestId`
- Records received from Amazon
- Records processed / inserted / updated / skipped
- Records persisted (DB count)
- Last successful sync timestamp
- Error classification (if any)

---

## Phase 3 — Declare Production Readiness

Only declare production readiness after ALL of the following are true:

- [ ] Orders synchronization retrieves and persists records (verified).
- [ ] Order Items synchronization retrieves and persists items (verified).
- [ ] Inventory synchronization retrieves and persists FBA/FBM summaries (verified).
- [ ] Database persistence verified for all synced modules.
- [ ] Frontend dashboard displays real Amazon data (not mock/demo).
- [ ] API Health dashboard shows per-module status with no unexplained `FAILED`.
- [ ] Review-pending banner is no longer displayed (`applicationStatus` = `production_enabled`, `productionClientAvailable` = true).

**Production readiness declaration must be documented with the Phase 2 evidence table above.** Do not declare readiness based on HTTP 200 alone.

---

## Rollback / Restrictions

If any step fails:

- Record the error classification (`CONFIGURATION_ERROR`, `API_REQUEST_FAILED`, `ACCESS_RESTRICTED`, `REVIEW_PENDING`, `DATA_PROCESSING_FAILED`).
- Do not proceed to the next module until the blocker is resolved.
- If the failure is Amazon-side (review pending, role not approved, seller not authorized), wait for Amazon/Seller Central action — do not bypass.
- If the failure is a code defect (configuration, pagination, DB write), fix and retest.

## Ongoing Monitoring

- Scheduled background sync runs every 15 minutes (`startScheduledSync`).
- Monitor `GET /api/amazon/sync-status` for per-module health.
- Structured logs are available via `pm2 logs --grep "amazon-sp-api"`.
- The demo simulator (`/app/amazon-simulator`) remains available for validating the WhizUnik operational workflow without live Amazon data.
