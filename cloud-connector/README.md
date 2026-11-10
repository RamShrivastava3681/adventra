# WhizUnik Cloud Connector

Cloud-native, bidirectional data connector between the **WhizUnik cloud** and the
**Tally desktop connector** (`tally-connector/`). It receives (ingests) Tally data
from the connector and pushes (syncs) cloud data back to it, with full
transformation, validation, idempotency, retry / dead-letter handling, and
observability.

> "Separate tab for receiving data": inbound webhook receipt lives under the
> dedicated `POST /webhooks/{connectorId}` endpoint.

## Architecture

```
src/
├── cmd/                    # main.ts entry point
├── internal/
│   ├── api/                # Express routes + middleware (inbound tab, outbound, health)
│   ├── domain/             # Entities, value objects, repository interfaces
│   ├── service/            # InboundService, OutboundService, SyncService
│   ├── repository/         # In-memory repos (tests/local dev) + postgres/redis stubs
│   ├── mapper/             # External <-> domain transformation (Tally schema)
│   ├── validator/          # Zod request validation
│   └── config/             # 12-factor env config loading & validation
├── pkg/
│   ├── connector/          # TallyConnectorClient (calls tally-connector cloud API)
│   ├── logger/             # Pino structured JSON logger + Prometheus metrics
│   └── errors/             # AppError / structured error responses
├── migrations/             # PostgreSQL schema (001_init.sql)
├── examples/               # Example inbound/outbound payloads
├── tests/                  # Unit + integration tests
├── docker/                 # Multi-stage Dockerfile (non-root)
├── k8s/                    # Kubernetes manifests (optional)
├── docker-compose.yml      # app + postgres + redis
├── openapi.yaml            # OpenAPI 3.0 spec
├── .env.example            # Environment config template
└── README.md
```

## Tech stack

- Node.js 20+, TypeScript, Express
- PostgreSQL (primary) + Redis (cache / rate limiting / idempotency)
- Pino (structured JSON logging), prom-client (Prometheus metrics)
- Zod (validation), vitest + supertest (testing)
- Docker multi-stage build, docker-compose

## Quick start (local dev)

No PostgreSQL/Redis required locally — the app defaults to the **in-memory**
repository driver (`REPO_DRIVER=inmemory`), so it runs with `npm install` alone.

```bash
cd cloud-connector
cp .env.example .env        # edit values if needed
npm install
npm run dev                 # tsx watch on http://localhost:8080
```

Run with Docker (PostgreSQL + Redis):

```bash
cp .env.example .env
docker compose up --build   # app on :8080, postgres :5432, redis :6379
```

Run checks:

```bash
npm run typecheck           # tsc --noEmit
npm test                    # vitest (22 tests)
```

## API usage examples (curl)

### 1. Receive a webhook from the Tally connector (receiving data tab)

The connector signs webhooks with HMAC-SHA256 using `CONNECTOR_WEBHOOK_SECRET`.
Header: `X-Signature: sha256=<hex>`.

```bash
WEBHOOK_SECRET=dev-webhook-secret-change-in-production
BODY=$(cat examples/inbound-webhook.json)
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | sed 's/^.* //')

curl -i -X POST http://localhost:8080/webhooks/wz-connector-001 \
  -H "Content-Type: application/json" \
  -H "X-Signature: sha256=$SIG" \
  -d "$BODY"
# => 202 Accepted  { "accepted": true, "duplicate": false, ... }
```

Same event ID twice → second request returns `duplicate: true` and is not
double-persisted.

Missing/invalid signature → `401 Unauthorized`.

### 2. Poll the connector for inbound changes

```bash
curl http://localhost:8080/sync/inbound?connectorId=wz-connector-001
```

### 3. Bulk inbound ingest

```bash
curl -i -X POST http://localhost:8080/sync/inbound/batch \
  -H "Content-Type: application/json" \
  -d '{"connectorId":"wz-connector-001","batchId":"batch-001","records":[{"invoiceNumber":"INV-1"}]}'
# => 202 Accepted
```

### 4. Push data to the Tally connector (outbound)

```bash
curl -i -X POST http://localhost:8080/sync/outbound/voucher \
  -H "Content-Type: application/json" \
  -d @examples/outbound-push.json
# => 202 Accepted  { "jobId": "...", "status": "completed", "accepted": true }
```

Check a push job:

```bash
curl http://localhost:8080/sync/outbound/<jobId>
```

Bulk push:

```bash
curl -i -X POST http://localhost:8080/sync/outbound/batch \
  -H "Content-Type: application/json" \
  -d '{"connectorId":"wz-connector-001","items":[...]}'
```

### 5. System endpoints

```bash
curl http://localhost:8080/health       # liveness  -> 200 {status:"up"}
curl http://localhost:8080/ready        # readiness -> 200 (or 503 if deps down)
curl http://localhost:8080/sync/status  # per-connector sync health
curl http://localhost:8080/metrics      # Prometheus text format
```

### 6. Error shape

All errors return structured JSON:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid payload",
    "details": [ { "path": "eventId", "message": "Required" } ],
    "requestId": "req_..."
  }
}
```

## Connector configuration guide

The Tally desktop connector (`tally-connector/`) calls this cloud service at
`CONNECTOR_BASE_URL` (default `http://localhost:8080`):

| Cloud endpoint | Connector uses it for |
|---|---|
| `POST /api/integrations/tally/connect` | Pairing (returns connectorId + tokens) |
| `POST /api/integrations/tally/token` | Access-token refresh |
| `POST /api/integrations/tally/sync/batch` | Inbound batch upload (idempotent by batchId/requestId) |
| `POST /api/integrations/tally/heartbeat` | Heartbeat (legacy connectors get commands) |
| `GET /api/integrations/tally/commands/pending` | Poll cloud→connector commands |
| `POST /api/integrations/tally/commands/ack` | Acknowledge a command (DONE/CANCELLED) |

Set these in `.env`:

```
CONNECTOR_BASE_URL=https://api.whizunik.example
CONNECTOR_API_KEY=<cloud API key for the connector>
CONNECTOR_WEBHOOK_SECRET=<HMAC secret the connector signs webhooks with>
CONNECTOR_MAX_RETRIES=5
TALLY_PUSH_ENABLED=true
FEATURE_INBOUND=true
FEATURE_OUTBOUND=true
```

Webhook signature verification is enforced when
`FEATURE_WEBHOOK_SIG_VERIFY=true` (requests without a valid `X-Signature: sha256=...`
header are rejected with 401).

## Deployment

### Docker

```bash
docker build -t whizunik/cloud-connector:1.0.0 -f docker/Dockerfile .
docker run -p 8080:8080 --env-file .env whizunik/cloud-connector:1.0.0
```

The Dockerfile is multi-stage and runs as a non-root user (`nodejs`, uid 1001).

### Docker Compose (local dev)

```bash
docker compose up --build
```

Starts `app`, `postgres:15`, `redis:7`. Set `REPO_DRIVER=postgres` in `.env` to
use PostgreSQL instead of in-memory storage.

### Kubernetes

See `k8s/` for Deployment, Service, ConfigMap, Secret and HPA manifests.
Scale based on CPU/memory or Redis queue depth; target 99.9% uptime and
1000+ events/minute per connector.

## Observability

- Structured JSON logs (Pino) with `requestId` propagated across boundaries.
- Prometheus metrics at `GET /metrics`:
  - `connector_inbound_events_total{connector_id,event_type,status}`
  - `connector_outbound_pushes_total{connector_id,resource_type,status}`
  - `connector_outbound_errors_total{connector_id,resource_type,code}`
  - `connector_dead_letter_total{connector_id,direction}`
  - `connector_sync_lag_minutes{connector_id,direction}`
  - `connector_http_request_duration_seconds`
- Health: `GET /health` (liveness), `GET /ready` (readiness, checks deps).
- Alerting thresholds: error rate > 5%, sync lag > 15 min, circuit breaker open.

## Testing

```bash
npm test          # 22 unit + integration tests (vitest)
npm run typecheck # tsc --noEmit
```

Tests use the in-memory repository driver, so they run without PostgreSQL/Redis.
Coverage targets the service and mapper layers.

## Example payloads

- `examples/inbound-webhook.json` — webhook the Tally connector sends to the cloud.
- `examples/outbound-push.json` — cloud push to the Tally connector (PushVoucher).

Full contract: `openapi.yaml` (OpenAPI 3.0).
