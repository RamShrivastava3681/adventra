import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
  type GetCommandInput,
  type PutCommandInput,
  type UpdateCommandInput,
  type DeleteCommandInput,
  type QueryCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { config } from "./config.js";
import {
  demoWriteGuard,
  DemoIsolationError,
  filterForCurrentMode,
  isDemoMode,
  tagForCurrentMode,
  visibleInCurrentMode,
} from "./lib/demo-context.js";
import { withEntityIndexKeys } from "./lib/entity-index.js";

const dynamoConfig: ConstructorParameters<typeof DynamoDBClient>[0] = {
  region: config.dynamodb.region,
  endpoint: config.dynamodb.endpoint,
};
if (config.dynamodb.credentials) {
  dynamoConfig.credentials = config.dynamodb.credentials;
}

const client = new DynamoDBClient(dynamoConfig);

const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const TABLE = config.dynamodb.tableName;

// ---------------------------------------------------------------------------
// Single-Table Design
// ---------------------------------------------------------------------------
// PK = unique identifier for the item
// SK = same as PK for simple gets; or metadata for composite keys
// GSI1_PK = "CLIENT#{clientId}" for client-scoped queries
// GSI1_SK = "ENTITY#{createdAt}" for sorting
// GSI2_PK = entityType ("Invoice", "Product", …) for entity-wide queries
// GSI2_SK = "ENTITY#{createdAt|id}" for stable ordering
// entityType = discriminator (e.g., "User", "Product", "Invoice")
// All entity fields are stored as top-level attributes.
// ---------------------------------------------------------------------------

export { TABLE };

// Demo tenant isolation (see lib/demo-context.ts): inside `runAsDemo` every write is
// tagged as demo data and every read sees only demo data; outside it demo data is
// invisible. Demo-mode writes are conditioned so they can never change live records.
function isConditionFailure(err: any) {
  return err?.name === "ConditionalCheckFailedException";
}

// ---------------------------------------------------------------------------
// Read diagnostics + safety limits
// ---------------------------------------------------------------------------

/**
 * Raised when a bounded read hits its page/item/time limit. We throw instead of
 * returning partial data so a production export can never be silently
 * truncated (PDF §7).
 */
export class DynamoReadLimitError extends Error {
  readonly code = "DYNAMODB_READ_LIMIT";
  constructor(operation: string, entityType: string | null, detail: string) {
    super(
      `Operation paused: The data set is larger than the permitted one-time limit. ` +
        `${detail} Run the migration in smaller batches. ` +
        `(operation=${operation}${entityType ? `, entityType=${entityType}` : ""})`,
    );
    this.name = "DynamoReadLimitError";
  }
}

export class DynamoReadAbortedError extends Error {
  readonly code = "DYNAMODB_READ_ABORTED";
  constructor(entityType: string | null) {
    super(`DynamoDB read cancelled${entityType ? ` (entityType=${entityType})` : ""}.`);
    this.name = "DynamoReadAbortedError";
  }
}

interface ReadMeta {
  operation: "GetItem" | "Query" | "Scan";
  entityType?: string | null;
  tenantId?: string | null;
}

/** First stack frame outside this module — used only when diagnostics are on. */
function callerFromStack(): string {
  const lines = (new Error().stack || "").split("\n");
  for (const raw of lines) {
    const m = /at (?:.*\()?([^\s()]+:\d+:\d+)\)?$/.exec(raw.trim());
    if (!m) continue;
    const loc = m[1];
    if (loc.includes("dynamodb.")) continue;
    if (loc.includes("node:")) continue;
    return loc;
  }
  return "unknown";
}

/** Adds consumed-capacity accounting only when read diagnostics are enabled. */
function withReadDiagnostics<T extends Record<string, any>>(params: T): T {
  if (config.dynamodb.readDiagnostics) {
    (params as Record<string, any>).ReturnConsumedCapacity = "TOTAL";
  }
  return params;
}

async function instrumentRead<T>(
  meta: ReadMeta,
  run: () => Promise<T>,
  itemCount: (res: T) => number,
): Promise<T> {
  const started = Date.now();
  const res = await run();
  if (config.dynamodb.readDiagnostics) {
    const capacity = (res as any)?.ConsumedCapacity;
    const consumedCapacity =
      typeof capacity === "number" ? capacity : capacity?.CapacityUnits ?? undefined;
    // Deliberately excludes item contents, QR payloads and GST data (PDF §9).
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        table: TABLE,
        operation: meta.operation,
        caller: callerFromStack(),
        entityType: meta.entityType ?? undefined,
        tenantId: meta.tenantId ?? undefined,
        items: itemCount(res),
        consumedCapacity,
        durationMs: Date.now() - started,
        requestId: (res as any)?.$metadata?.requestId,
      }),
    );
  }
  return res;
}

export interface BoundedReadOptions {
  /**
   * Legacy page size (kept for call-site compatibility). Despite the name it
   * never limits the total result — the reader walks every page, exactly like
   * the original scan. Use `maxItems` for a total cap.
   */
  limit?: number;
  /** Requested page size. Defaults to `limit`, then 1000. */
  pageSize?: number;
  maxPages?: number;
  maxItems?: number;
  /** 0 disables the duration guard. */
  timeoutMs?: number;
  signal?: AbortSignal;
  consistentRead?: boolean;
  /**
   * Attributes to return. Item data is billed on transfer, so export/dashboard
   * reads use this to skip large embedded arrays. `isDemoData` is always added
   * so demo isolation still works.
   */
  projection?: string[];
  /** Disables caps entirely. Reserved for the dedicated Tally all-records helper. */
  unbounded?: boolean;
}

function resolveReadCaps(options?: BoundedReadOptions) {
  if (options?.unbounded) {
    return { maxPages: Number.POSITIVE_INFINITY, maxItems: Number.POSITIVE_INFINITY, timeoutMs: 0 };
  }
  const limits = config.dynamodb.readLimits;
  return {
    maxPages: options?.maxPages ?? limits.maxScanPages,
    maxItems: options?.maxItems ?? limits.maxScanItems,
    timeoutMs: options?.timeoutMs ?? limits.scanTimeoutMs,
  };
}

function resolvePageSize(options?: BoundedReadOptions): number {
  const requested = options?.pageSize ?? options?.limit ?? 1000;
  return Number.isFinite(requested) && requested > 0
    ? Math.floor(requested)
    : 1000;
}

/**
 * Applies a projection without ever dropping `isDemoData`, which
 * `filterForCurrentMode` needs to keep demo rows out of live reads.
 */
function applyProjection(
  params: Record<string, any>,
  projection?: string[],
): void {
  if (!projection?.length) return;
  const names = Array.from(new Set([...projection, "isDemoData"]));
  params.ProjectionExpression = names.map((_, i) => `#p${i}`).join(", ");
  params.ExpressionAttributeNames = {
    ...(params.ExpressionAttributeNames ?? {}),
    ...Object.fromEntries(names.map((name, i) => [`#p${i}`, name])),
  };
}

function assertWithinCaps(
  operation: "Scan" | "Query",
  entityType: string,
  caps: { maxPages: number; maxItems: number; timeoutMs: number },
  state: { pages: number; items: number; started: number },
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw new DynamoReadAbortedError(entityType);
  if (caps.timeoutMs > 0 && Date.now() - state.started > caps.timeoutMs) {
    throw new DynamoReadLimitError(
      operation,
      entityType,
      `Timed out after ${caps.timeoutMs}ms.`,
    );
  }
  if (state.pages >= caps.maxPages) {
    throw new DynamoReadLimitError(
      operation,
      entityType,
      `Reached the ${caps.maxPages}-page limit.`,
    );
  }
  if (state.items > caps.maxItems) {
    throw new DynamoReadLimitError(
      operation,
      entityType,
      `Reached the ${caps.maxItems}-item limit.`,
    );
  }
}

/**
 * Fully-paginated entity read. Both the legacy table Scan and the newer GSI2
 * Query walk every page until LastEvaluatedKey is empty — the caps above are the
 * only way this stops early, and they throw rather than truncate.
 */
async function readAllByEntityType(
  entityType: string,
  mode: "scan" | "gsi2",
  options?: BoundedReadOptions,
): Promise<Record<string, any>[]> {
  const caps = resolveReadCaps(options);
  const pageSize = resolvePageSize(options);
  const state = { pages: 0, items: 0, started: Date.now() };
  const allItems: Record<string, any>[] = [];
  let lastKey: Record<string, any> | undefined;
  let warned = false;
  const operation = mode === "scan" ? "Scan" : "Query";

  do {
    assertWithinCaps(operation, entityType, caps, state, options?.signal);

    const params: Record<string, any> =
      mode === "scan"
        ? {
            TableName: TABLE,
            FilterExpression: "entityType = :t",
            ExpressionAttributeValues: { ":t": entityType },
            Limit: pageSize,
            ExclusiveStartKey: lastKey,
            ...(options?.consistentRead ? { ConsistentRead: true } : {}),
          }
        : {
            TableName: TABLE,
            IndexName: "GSI2",
            KeyConditionExpression: "gsi2pk = :pk",
            ExpressionAttributeValues: { ":pk": entityType },
            Limit: pageSize,
            ExclusiveStartKey: lastKey,
          };
    applyProjection(params, options?.projection);
    withReadDiagnostics(params);

    const result = await instrumentRead(
      { operation, entityType },
      () =>
        docClient.send(
          mode === "scan"
            ? new ScanCommand(params as any)
            : new QueryCommand(params as any),
        ),
      (res: any) => (res.Items ?? []).length,
    );

    state.pages++;
    const items = (result as any).Items ?? [];
    if (items.length) {
      // Check before appending so a capped read never blows past its budget.
      if (state.items + items.length > caps.maxItems) {
        throw new DynamoReadLimitError(
          operation,
          entityType,
          `Reached the ${caps.maxItems}-item limit.`,
        );
      }
      allItems.push(...items);
      state.items += items.length;
    }

    if (
      !warned &&
      (state.items >= config.dynamodb.readLimits.warnScanItems ||
        state.pages >= config.dynamodb.readLimits.warnScanPages)
    ) {
      warned = true;
      console.warn(
        `[dynamodb] Large entity read: source=${mode} entityType=${entityType} ` +
          `caller=${config.dynamodb.readDiagnostics ? callerFromStack() : "n/a"} ` +
          `items=${state.items} pages=${state.pages}`,
      );
    }

    assertWithinCaps(operation, entityType, caps, state, options?.signal);
    lastKey = (result as any).LastEvaluatedKey;
  } while (lastKey);

  return filterForCurrentMode(allItems);
}

// ---- Generic CRUD ----

export async function getItem(pk: string, sk?: string) {
  const params: GetCommandInput = withReadDiagnostics({
    TableName: TABLE,
    Key: { pk, sk: sk || pk },
  });
  const result = await instrumentRead(
    { operation: "GetItem", tenantId: pk.startsWith("CLIENT#") ? pk.slice(7) : null },
    () => docClient.send(new GetCommand(params)),
    (res: any) => (res.Item ? 1 : 0),
  );
  const item = (result as any).Item ?? null;
  return visibleInCurrentMode(item) ? item : null;
}

export async function putItem(item: Record<string, any>) {
  item = withEntityIndexKeys(tagForCurrentMode(item));
  const params: PutCommandInput = { TableName: TABLE, Item: item };
  const guard = demoWriteGuard();
  if (guard) {
    params.ConditionExpression = `attribute_not_exists(pk) OR ${guard.expression}`;
    params.ExpressionAttributeNames = guard.names;
    params.ExpressionAttributeValues = guard.values;
  }
  try {
    await docClient.send(new PutCommand(params));
  } catch (err: any) {
    if (guard && isConditionFailure(err)) throw new DemoIsolationError();
    throw err;
  }
  return item;
}

/**
 * Insert an item only if its key does not already exist. Used for unique lookup
 * pointers (email, NOA token) so two concurrent writers cannot both win.
 */
export async function putItemIfAbsent(item: Record<string, any>) {
  item = withEntityIndexKeys(tagForCurrentMode(item));
  const params: PutCommandInput = {
    TableName: TABLE,
    Item: item,
    ConditionExpression: "attribute_not_exists(pk)",
  };
  try {
    await docClient.send(new PutCommand(params));
    return true;
  } catch (err: any) {
    if (isConditionFailure(err)) return false;
    throw err;
  }
}

export async function updateItem(
  pk: string,
  sk: string,
  updates: Record<string, any>
) {
  const expr = Object.keys(updates)
    .map((k, i) => `#f${i} = :v${i}`)
    .join(", ");
  const attrNames = Object.keys(updates).reduce(
    (a, k, i) => ({ ...a, [`#f${i}`]: k }),
    {} as Record<string, string>
  );
  const attrValues = Object.values(updates).reduce(
    (a, v, i) => ({ ...a, [`:v${i}`]: v }),
    {} as Record<string, any>
  );

  const params: UpdateCommandInput = {
    TableName: TABLE,
    Key: { pk, sk },
    UpdateExpression: `SET ${expr}`,
    ExpressionAttributeNames: attrNames,
    ExpressionAttributeValues: attrValues,
    ReturnValues: "ALL_NEW",
  };
  const guard = demoWriteGuard();
  if (guard) {
    params.ConditionExpression = guard.expression;
    Object.assign(params.ExpressionAttributeNames!, guard.names);
    Object.assign(params.ExpressionAttributeValues!, guard.values);
  }
  try {
    const result = await docClient.send(new UpdateCommand(params));
    return result.Attributes ?? null;
  } catch (err: any) {
    if (guard && isConditionFailure(err)) throw new DemoIsolationError();
    throw err;
  }
}

/**
 * Conditional update — only applies `updates` when `conditionExpression` holds.
 * Throws if the condition fails (caller can catch ConditionalCheckFailedException)
 * or returns null when `returnNullOnConditionFailure` is true. Used for atomic
 * state flips (e.g. draft → confirmed) so concurrent requests can't both win.
 */
export async function updateItemIf(
  pk: string,
  sk: string,
  updates: Record<string, any>,
  conditionExpression: string,
  conditionValues: Record<string, any>,
  returnNullOnConditionFailure = true,
  conditionNames: Record<string, string> = {}
) {
  const expr = Object.keys(updates)
    .map((k, i) => `#f${i} = :v${i}`)
    .join(", ");
  const attrNames = Object.keys(updates).reduce(
    (a, k, i) => ({ ...a, [`#f${i}`]: k }),
    {} as Record<string, string>
  );
  const attrValues = Object.values(updates).reduce(
    (a, v, i) => ({ ...a, [`:v${i}`]: v }),
    {} as Record<string, any>
  );
  const guard = demoWriteGuard();
  const params: UpdateCommandInput = {
    TableName: TABLE,
    Key: { pk, sk },
    UpdateExpression: `SET ${expr}`,
    ConditionExpression: guard
      ? `(${conditionExpression}) AND ${guard.expression}`
      : conditionExpression,
    ExpressionAttributeNames: { ...attrNames, ...conditionNames, ...(guard?.names ?? {}) },
    ExpressionAttributeValues: { ...attrValues, ...conditionValues, ...(guard?.values ?? {}) },
    ReturnValues: "ALL_NEW",
  };
  try {
    const result = await docClient.send(new UpdateCommand(params));
    return result.Attributes ?? null;
  } catch (err: any) {
    if (returnNullOnConditionFailure && err?.name === "ConditionalCheckFailedException") {
      return null;
    }
    throw err;
  }
}

export async function deleteItem(pk: string, sk?: string) {
  const params: DeleteCommandInput = {
    TableName: TABLE,
    Key: { pk, sk: sk || pk },
  };
  const guard = demoWriteGuard();
  if (guard) {
    params.ConditionExpression = guard.expression;
    params.ExpressionAttributeNames = guard.names;
    params.ExpressionAttributeValues = guard.values;
  }
  try {
    await docClient.send(new DeleteCommand(params));
  } catch (err: any) {
    if (!guard || !isConditionFailure(err)) throw err;
    // Missing item → nothing to delete. A live item → refuse.
    const existing = await docClient.send(new GetCommand({ TableName: TABLE, Key: params.Key }));
    if (existing.Item) throw new DemoIsolationError();
  }
}

// ---- Queries ----

export async function queryByPk(
  pk: string,
  options?: {
    limit?: number;
    reverse?: boolean;
    exclusiveStartKey?: Record<string, any>;
    projection?: string[];
  },
) {
  const params: QueryCommandInput = withReadDiagnostics({
    TableName: TABLE,
    KeyConditionExpression: "pk = :pk",
    ExpressionAttributeValues: { ":pk": pk },
    Limit: options?.limit || 500,
    ScanIndexForward: options?.reverse !== undefined ? !options.reverse : true,
    ExclusiveStartKey: options?.exclusiveStartKey,
  });
  applyProjection(params as Record<string, any>, options?.projection);
  const result = await instrumentRead(
    {
      operation: "Query",
      tenantId: pk.startsWith("USER#") ? pk.slice(5) : null,
    },
    () => docClient.send(new QueryCommand(params)),
    (res: any) => (res.Items ?? []).length,
  );
  const items = (result as any).Items ?? [];
  return {
    items: filterForCurrentMode(items),
    lastKey: (result as any).LastEvaluatedKey,
  };
}

export async function queryByGSI1(
  clientId: string,
  options?: {
    entityType?: string;
    limit?: number;
    reverse?: boolean;
    exclusiveStartKey?: Record<string, any>;
  }
) {
  const params: QueryCommandInput = withReadDiagnostics({
    TableName: TABLE,
    IndexName: "GSI1",
    KeyConditionExpression: "gsi1pk = :pk",
    ExpressionAttributeValues: { ":pk": `CLIENT#${clientId}` },
    Limit: options?.limit || 100,
    ScanIndexForward: options?.reverse !== undefined ? !options.reverse : false,
    ExclusiveStartKey: options?.exclusiveStartKey,
  });

  if (options?.entityType) {
    params.KeyConditionExpression += " AND begins_with(gsi1sk, :type)";
    params.ExpressionAttributeValues![":type" as string] = `${options.entityType}#`;
  }

  const result = await instrumentRead(
    { operation: "Query", entityType: options?.entityType ?? null, tenantId: clientId },
    () => docClient.send(new QueryCommand(params)),
    (res: any) => (res.Items ?? []).length,
  );
  const items = (result as any).Items ?? [];
  return {
    items: filterForCurrentMode(items),
    lastKey: (result as any).LastEvaluatedKey,
  };
}

/**
 * Entity-wide read used by every model `list()`.
 *
 * Reads through GSI2 (gsi2pk = entityType) so normal workflows never touch the
 * table with a Scan.
 */
export async function scanByType(
  entityType: string,
  options?: BoundedReadOptions,
) {
  return readAllByEntityType(
    entityType,
    config.dynamodb.scanSource === "scan" ? "scan" : "gsi2",
    options,
  );
}

/**
 * Dedicated all-records helper for Tally export/import. Fully paginated and
 * deliberately uncapped so exports are never truncated (PDF §8).
 */
export async function listAllByType(
  entityType: string,
  options?: Omit<BoundedReadOptions, "unbounded">,
) {
  return readAllByEntityType(
    entityType,
    config.dynamodb.scanSource === "scan" ? "scan" : "gsi2",
    { ...options, unbounded: true },
  );
}

/** Every demo-tenant record (any entity type). Used by Reset Demo Baseline. */
export async function scanDemoItems(options?: { signal?: AbortSignal }) {
  if (!isDemoMode()) throw new DemoIsolationError("scanDemoItems is only available in demo mode");
  const caps = resolveReadCaps(options);
  const state = { pages: 0, items: 0, started: Date.now() };
  let lastKey: Record<string, any> | undefined;
  const allItems: Record<string, any>[] = [];
  do {
    assertWithinCaps("Scan", "demo", caps, state, options?.signal);
    const params: Record<string, any> = withReadDiagnostics({
      TableName: TABLE,
      FilterExpression: "isDemoData = :d",
      ExpressionAttributeValues: { ":d": true },
      ExclusiveStartKey: lastKey,
    });
    const result = await instrumentRead(
      { operation: "Scan", entityType: "demo" },
      () => docClient.send(new ScanCommand(params as any)),
      (res: any) => (res.Items ?? []).length,
    );
    state.pages++;
    const items = (result as any).Items ?? [];
    if (items.length) {
      allItems.push(...items);
      state.items += items.length;
    }
    assertWithinCaps("Scan", "demo", caps, state, options?.signal);
    lastKey = (result as any).LastEvaluatedKey;
  } while (lastKey);
  return filterForCurrentMode(allItems);
}

/**
 * Fully-paginated primary-key query, capped like `scanByType`. Used for
 * document-scoped sidecars (timeline, events, task/notification pointers).
 */
export async function queryAllByPk(
  pk: string,
  options?: BoundedReadOptions & { reverse?: boolean },
): Promise<Record<string, any>[]> {
  const caps = resolveReadCaps(options);
  const pageSize = resolvePageSize(options);
  const state = { pages: 0, items: 0, started: Date.now() };
  const allItems: Record<string, any>[] = [];
  let lastKey: Record<string, any> | undefined;

  do {
    assertWithinCaps("Query", pk, caps, state, options?.signal);

    const params: QueryCommandInput = withReadDiagnostics({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": pk },
      Limit: pageSize,
      ScanIndexForward: options?.reverse !== undefined ? !options.reverse : true,
      ExclusiveStartKey: lastKey,
      ...(options?.consistentRead ? { ConsistentRead: true } : {}),
    });
    applyProjection(params as Record<string, any>, options?.projection);

    const result = await instrumentRead(
      { operation: "Query", tenantId: pk.startsWith("USER#") ? pk.slice(5) : null },
      () => docClient.send(new QueryCommand(params)),
      (res: any) => (res.Items ?? []).length,
    );

    state.pages++;
    const items = filterForCurrentMode((result as any).Items ?? []);
    if (items.length) {
      if (state.items + items.length > caps.maxItems) {
        throw new DynamoReadLimitError(
          "Query",
          pk,
          `Reached the ${caps.maxItems}-item limit.`,
        );
      }
      allItems.push(...items);
      state.items += items.length;
    }

    assertWithinCaps("Query", pk, caps, state, options?.signal);
    lastKey = (result as any).LastEvaluatedKey;
  } while (lastKey);

  return allItems;
}

/**
 * Explicit GSI2 entity read, regardless of the configured scan source. This is
 * the reusable `queryAllByGSI2(entityType, options)` helper from the plan.
 */
export async function queryAllByGSI2(
  entityType: string,
  options?: BoundedReadOptions,
): Promise<Record<string, any>[]> {
  return readAllByEntityType(entityType, "gsi2", options);
}

export async function queryByGSI2(
  entityType: string,
  options?: {
    limit?: number;
    reverse?: boolean;
    exclusiveStartKey?: Record<string, any>;
  }
) {
  const params: QueryCommandInput = withReadDiagnostics({
    TableName: TABLE,
    IndexName: "GSI2",
    KeyConditionExpression: "gsi2pk = :pk",
    ExpressionAttributeValues: { ":pk": entityType },
    Limit: options?.limit || 1000,
    ScanIndexForward: options?.reverse !== undefined ? !options.reverse : true,
    ExclusiveStartKey: options?.exclusiveStartKey,
  });
  const result = await instrumentRead(
    { operation: "Query", entityType },
    () => docClient.send(new QueryCommand(params)),
    (res: any) => (res.Items ?? []).length,
  );
  const items = (result as any).Items ?? [];
  return {
    items: filterForCurrentMode(items),
    lastKey: (result as any).LastEvaluatedKey,
  };
}

// ---- Helpers ----

export function nowISO() {
  return new Date().toISOString();
}

export function todayDate() {
  return nowISO().slice(0, 10);
}

export function generateId(): string {
  return uuidv4();
}
