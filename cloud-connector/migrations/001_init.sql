-- WhizUnik Cloud Connector — initial schema
-- Run against PostgreSQL (e.g. via docker-compose entrypoint or `psql -f`).

CREATE TABLE IF NOT EXISTS connector_configs (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL,
  base_url       TEXT,
  auth_type      TEXT NOT NULL,
  credentials_ref TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_jobs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id   TEXT NOT NULL,
  direction      TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  status         TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed','dead')),
  payload        JSONB NOT NULL,
  event_id       TEXT,
  idempotency_key TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at   TIMESTAMPTZ,
  error_message  TEXT,
  attempts       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key         TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  direction   TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (key, connector_id, direction)
);

CREATE TABLE IF NOT EXISTS sync_state (
  connector_id   TEXT PRIMARY KEY,
  last_synced_at TIMESTAMPTZ,
  cursor         TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dead_letter_queue (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id   TEXT NOT NULL,
  direction      TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  payload        JSONB NOT NULL,
  error_message  TEXT NOT NULL,
  attempts       INTEGER NOT NULL DEFAULT 0,
  next_retry_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_connector_direction ON sync_jobs(connector_id, direction);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_status ON sync_jobs(status);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_event_id ON sync_jobs(connector_id, event_id);
CREATE INDEX IF NOT EXISTS idx_dead_letter_next_retry ON dead_letter_queue(next_retry_at);
