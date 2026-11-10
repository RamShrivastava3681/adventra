/**
 * Prometheus metrics. Counters for inbound/outbound events and errors,
 * latency histograms. Safe to call multiple times (registers once).
 */
import { Counter, Histogram, Registry, collectDefaultMetrics, Gauge } from 'prom-client';
export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: 'connector_' });
export const inboundEventsTotal = new Counter({
    name: 'connector_inbound_events_total',
    help: 'Total inbound events received',
    labelNames: ['connector_id', 'event_type', 'status'],
    registers: [registry],
});
export const outboundPushesTotal = new Counter({
    name: 'connector_outbound_pushes_total',
    help: 'Total outbound push attempts',
    labelNames: ['connector_id', 'resource_type', 'status'],
    registers: [registry],
});
export const outboundErrorsTotal = new Counter({
    name: 'connector_outbound_errors_total',
    help: 'Total outbound push errors',
    labelNames: ['connector_id', 'resource_type', 'code'],
    registers: [registry],
});
export const deadLetterTotal = new Counter({
    name: 'connector_dead_letter_total',
    help: 'Total items moved to dead letter queue',
    labelNames: ['connector_id', 'direction'],
    registers: [registry],
});
export const requestDuration = new Histogram({
    name: 'connector_http_request_duration_seconds',
    help: 'HTTP request duration',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [registry],
});
export const syncLagGauge = new Gauge({
    name: 'connector_sync_lag_minutes',
    help: 'Sync lag in minutes per connector',
    labelNames: ['connector_id', 'direction'],
    registers: [registry],
});
export async function metricsContent() {
    return registry.metrics();
}
