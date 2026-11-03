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

// ---- Generic CRUD ----

export async function getItem(pk: string, sk?: string) {
  const params: GetCommandInput = {
    TableName: TABLE,
    Key: { pk, sk: sk || pk },
  };
  const result = await docClient.send(new GetCommand(params));
  const item = result.Item ?? null;
  return visibleInCurrentMode(item) ? item : null;
}

export async function putItem(item: Record<string, any>) {
  item = tagForCurrentMode(item);
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
  options?: { limit?: number; reverse?: boolean },
) {
  const params: QueryCommandInput = {
    TableName: TABLE,
    KeyConditionExpression: "pk = :pk",
    ExpressionAttributeValues: { ":pk": pk },
    Limit: options?.limit || 500,
    ScanIndexForward: options?.reverse !== undefined ? !options.reverse : true,
  };
  const result = await docClient.send(new QueryCommand(params));
  return { items: filterForCurrentMode(result.Items ?? []), lastKey: result.LastEvaluatedKey };
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
  const params: QueryCommandInput = {
    TableName: TABLE,
    IndexName: "GSI1",
    KeyConditionExpression: "gsi1pk = :pk",
    ExpressionAttributeValues: { ":pk": `CLIENT#${clientId}` },
    Limit: options?.limit || 100,
    ScanIndexForward: options?.reverse !== undefined ? !options.reverse : false,
    ExclusiveStartKey: options?.exclusiveStartKey,
  };

  if (options?.entityType) {
    params.KeyConditionExpression += " AND begins_with(gsi1sk, :type)";
    params.ExpressionAttributeValues![":type" as string] = `${options.entityType}#`;
  }

  const result = await docClient.send(new QueryCommand(params));
  return { items: filterForCurrentMode(result.Items ?? []), lastKey: result.LastEvaluatedKey };
}

export async function scanByType(
  entityType: string,
  options?: { limit?: number }
) {
  const maxLimit = options?.limit || 1000;
  let lastKey: Record<string, any> | undefined;
  const allItems: Record<string, any>[] = [];

  do {
    const params: any = {
      TableName: TABLE,
      FilterExpression: "entityType = :t",
      ExpressionAttributeValues: { ":t": entityType },
      Limit: maxLimit,
      ExclusiveStartKey: lastKey,
    };
    const result = await docClient.send(new ScanCommand(params));
    if (result.Items) allItems.push(...result.Items);
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return filterForCurrentMode(allItems);
}

/** Every demo-tenant record (any entity type). Used by Reset Demo Baseline. */
export async function scanDemoItems() {
  if (!isDemoMode()) throw new DemoIsolationError("scanDemoItems is only available in demo mode");
  let lastKey: Record<string, any> | undefined;
  const allItems: Record<string, any>[] = [];
  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: "isDemoData = :d",
        ExpressionAttributeValues: { ":d": true },
        ExclusiveStartKey: lastKey,
      })
    );
    if (result.Items) allItems.push(...result.Items);
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return filterForCurrentMode(allItems);
}

export async function queryByGSI2(
  entityType: string,
  options?: {
    limit?: number;
    reverse?: boolean;
  }
) {
  const params: QueryCommandInput = {
    TableName: TABLE,
    IndexName: "GSI2",
    KeyConditionExpression: "gsi2pk = :pk",
    ExpressionAttributeValues: { ":pk": entityType },
    Limit: options?.limit || 1000,
    ScanIndexForward: options?.reverse !== undefined ? !options.reverse : true,
  };
  const result = await docClient.send(new QueryCommand(params));
  return filterForCurrentMode(result.Items ?? []);
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
