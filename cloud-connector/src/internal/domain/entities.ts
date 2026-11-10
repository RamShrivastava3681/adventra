/**
 * Core domain entities, value objects and repository interfaces for the
 * WhizUnik Cloud Connector. Kept free of infrastructure concerns so the
 * service layer can be tested with in-memory doubles.
 */

export type Direction = 'inbound' | 'outbound';
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'dead';

export interface SyncJob {
  id: string;
  connectorId: string;
  direction: Direction;
  status: JobStatus;
  payload: unknown;
  eventId?: string;
  idempotencyKey?: string;
  createdAt: Date;
  processedAt?: Date;
  errorMessage?: string;
  attempts?: number;
}

export interface IdempotencyKey {
  key: string;
  connectorId: string;
  direction: Direction;
  createdAt: Date;
  expiresAt: Date;
}

export interface ConnectorConfig {
  id: string;
  name: string;
  type: string;
  baseUrl?: string;
  authType: string;
  credentialsRef?: string;
  isActive: boolean;
  createdAt: Date;
}

export interface SyncState {
  connectorId: string;
  lastSyncedAt?: Date;
  cursor?: string;
  updatedAt: Date;
}

export interface DeadLetterEntry {
  id: string;
  connectorId: string;
  direction: Direction;
  payload: unknown;
  errorMessage: string;
  attempts: number;
  nextRetryAt?: Date;
  createdAt: Date;
}

export interface SyncJobRepository {
  create(job: Omit<SyncJob, 'id' | 'createdAt'>): Promise<SyncJob>;
  findById(id: string): Promise<SyncJob | null>;
  findByEventId(connectorId: string, eventId: string): Promise<SyncJob | null>;
  updateStatus(id: string, status: JobStatus, opts?: { errorMessage?: string; processedAt?: Date; attempts?: number }): Promise<void>;
  listPending(limit?: number): Promise<SyncJob[]>;
  listPendingCommands(connectorId: string, limit?: number): Promise<SyncJob[]>;
}

export interface IdempotencyStore {
  has(key: string, connectorId: string, direction: Direction): Promise<boolean>;
  mark(key: string, connectorId: string, direction: Direction, ttlMs?: number): Promise<void>;
}

export interface ConnectorConfigRepository {
  findById(id: string): Promise<ConnectorConfig | null>;
  findActive(): Promise<ConnectorConfig[]>;
  create(config: Omit<ConnectorConfig, 'createdAt'>): Promise<ConnectorConfig>;
}

export interface PairingResult {
  connectorId: string;
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: string;
  tenant: { id: string; name: string };
  companyMapping?: { tallyCompanyGuid: string; whizunikCompanyId: string };
}

export interface SyncStateRepository {
  get(connectorId: string): Promise<SyncState | null>;
  set(connectorId: string, state: Partial<SyncState>): Promise<void>;
}

export interface DeadLetterQueue {
  add(entry: Omit<DeadLetterEntry, 'id' | 'createdAt'>): Promise<DeadLetterEntry>;
  listDue(limit?: number): Promise<DeadLetterEntry[]>;
  markProcessed(id: string): Promise<void>;
  incrementAttempts(id: string, nextRetryAt?: Date): Promise<void>;
}

export interface OutboundCommand {
  id: string;
  connectorId: string;
  resourceType: string;
  payload: unknown;
  idempotencyKey: string;
  status: JobStatus;
  errorMessage?: string;
  attempts: number;
  createdAt: Date;
  processedAt?: Date;
}

export interface CommandStore {
  create(command: Omit<OutboundCommand, 'id' | 'createdAt'>): Promise<OutboundCommand>;
  listPending(connectorId: string): Promise<OutboundCommand[]>;
  ack(commandId: string, status: 'DONE' | 'CANCELLED', result?: unknown): Promise<OutboundCommand | null>;
  findById(id: string): Promise<OutboundCommand | null>;
  findByIdempotencyKey(key: string, connectorId: string): Promise<OutboundCommand | null>;
}

export interface ConnectorClient {
  name: string;
  pushResource(resourceType: string, payload: unknown, idempotencyKey: string): Promise<{ ok: boolean; status?: number; body?: unknown }>;
  pushBatch(items: { resourceType: string; payload: unknown; idempotencyKey: string }[]): Promise<Array<{ ok: boolean; status?: number; body?: unknown }>>;
}




