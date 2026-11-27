import {
  DescribeTableCommand,
  DynamoDBClient,
  UpdateTableCommand,
} from "@aws-sdk/client-dynamodb";
import { config } from "../src/config.js";

const INDEXES = [
  { current: "GSI1", replacement: "GSI1_KEYS", partition: "gsi1pk", sort: "gsi1sk" },
  { current: "GSI2", replacement: "GSI2_KEYS", partition: "gsi2pk", sort: "gsi2sk" },
] as const;
const args = new Set(process.argv.slice(2));
const createReplacements = args.has("--create-replacements");
const deleteFullIndexesFlag = args.has("--delete-full-indexes");
const apply = args.has("--apply");
const confirmAppDeployed = args.has("--confirm-app-deployed");
const tableName = config.dynamodb.tableName;

if (createReplacements === deleteFullIndexesFlag) {
  throw new Error("Choose exactly one phase: --create-replacements or --delete-full-indexes.");
}
if (!apply && (createReplacements || deleteFullIndexesFlag)) {
  console.log("Dry run only. Add --apply to make the selected AWS changes.");
}
if (deleteFullIndexesFlag && !confirmAppDeployed) {
  throw new Error(
    "Refusing to delete the full-projection indexes without --confirm-app-deployed.",
  );
}

const client = new DynamoDBClient({
  region: config.dynamodb.region,
  endpoint: config.dynamodb.endpoint,
  ...(config.dynamodb.credentials ? { credentials: config.dynamodb.credentials } : {}),
});

function indexByName(table: any, name: string) {
  return table.GlobalSecondaryIndexes?.find((index: any) => index.IndexName === name);
}

function hasExpectedKeys(index: any, partition: string, sort: string): boolean {
  const keys = index?.KeySchema ?? [];
  return (
    keys.length === 2 &&
    keys.some((key: any) => key.AttributeName === partition && key.KeyType === "HASH") &&
    keys.some((key: any) => key.AttributeName === sort && key.KeyType === "RANGE")
  );
}

async function describeTable() {
  const response = await client.send(new DescribeTableCommand({ TableName: tableName }));
  if (!response.Table) throw new Error(`Table "${tableName}" was not returned by AWS.`);
  return response.Table;
}

async function waitForIndex(name: string, shouldExist: boolean): Promise<void> {
  for (let attempt = 0; attempt < 180; attempt++) {
    const table = await describeTable();
    const index = indexByName(table, name);
    if (table.TableStatus === "ACTIVE") {
      if (shouldExist && index?.IndexStatus === "ACTIVE") return;
      if (!shouldExist && !index) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error(
    `Timed out waiting for index "${name}" to ${shouldExist ? "become ACTIVE" : "be deleted"}.`,
  );
}

async function createReplacementIndexes(): Promise<void> {
  let table = await describeTable();
  if (table.TableStatus !== "ACTIVE") {
    throw new Error(`Table "${tableName}" must be ACTIVE, found ${table.TableStatus}.`);
  }

  for (const spec of INDEXES) {
    const original = indexByName(table, spec.current);
    if (
      !original ||
      original.IndexStatus !== "ACTIVE" ||
      !hasExpectedKeys(original, spec.partition, spec.sort)
    ) {
      throw new Error(`Expected active index "${spec.current}" with its current key schema.`);
    }

    const replacement = indexByName(table, spec.replacement);
    if (replacement) {
      if (
        !hasExpectedKeys(replacement, spec.partition, spec.sort) ||
        replacement.Projection?.ProjectionType !== "KEYS_ONLY"
      ) {
        throw new Error(`Existing "${spec.replacement}" has an unexpected schema or projection.`);
      }
      if (replacement.IndexStatus !== "ACTIVE") {
        console.log(`Waiting for ${spec.replacement} (${replacement.IndexStatus})...`);
        await waitForIndex(spec.replacement, true);
      }
      console.log(`${spec.replacement} already exists and is ACTIVE with KEYS_ONLY.`);
      table = await describeTable();
      continue;
    }

    if (!apply) {
      console.log(
        `Would create ${spec.replacement} on ${tableName} (${spec.partition}, ${spec.sort}) with KEYS_ONLY.`,
      );
      continue;
    }

    await client.send(
      new UpdateTableCommand({
        TableName: tableName,
        AttributeDefinitions: [
          { AttributeName: spec.partition, AttributeType: "S" },
          { AttributeName: spec.sort, AttributeType: "S" },
        ],
        GlobalSecondaryIndexUpdates: [
          {
            Create: {
              IndexName: spec.replacement,
              KeySchema: [
                { AttributeName: spec.partition, KeyType: "HASH" },
                { AttributeName: spec.sort, KeyType: "RANGE" },
              ],
              Projection: { ProjectionType: "KEYS_ONLY" },
            },
          },
        ],
      }),
    );
    console.log(`Creation started for ${spec.replacement}; waiting for ACTIVE.`);
    await waitForIndex(spec.replacement, true);
    table = await describeTable();
    const created = indexByName(table, spec.replacement);
    if (
      !created ||
      !hasExpectedKeys(created, spec.partition, spec.sort) ||
      created.Projection?.ProjectionType !== "KEYS_ONLY"
    ) {
      throw new Error(`AWS did not report the expected schema for ${spec.replacement}.`);
    }
    console.log(
      `${spec.replacement} ACTIVE; approximate item count=${created.ItemCount ?? "unknown"}, sizeBytes=${created.IndexSizeBytes ?? "unknown"}.`,
    );
  }
}

async function deleteFullIndexes(): Promise<void> {
  let table = await describeTable();
  if (table.TableStatus !== "ACTIVE") {
    throw new Error(`Table "${tableName}" must be ACTIVE, found ${table.TableStatus}.`);
  }

  for (const spec of INDEXES) {
    const replacement = indexByName(table, spec.replacement);
    if (
      !replacement ||
      replacement.IndexStatus !== "ACTIVE" ||
      !hasExpectedKeys(replacement, spec.partition, spec.sort) ||
      replacement.Projection?.ProjectionType !== "KEYS_ONLY"
    ) {
      throw new Error(`Refusing deletion: ${spec.replacement} is not ACTIVE with KEYS_ONLY.`);
    }

    const original = indexByName(table, spec.current);
    if (!original) {
      console.log(`${spec.current} is already absent.`);
      continue;
    }
    if (!hasExpectedKeys(original, spec.partition, spec.sort)) {
      throw new Error(`Refusing deletion: ${spec.current} has an unexpected key schema.`);
    }

    if (!apply) {
      console.log(`Would delete ${spec.current} from ${tableName}.`);
      continue;
    }

    await client.send(
      new UpdateTableCommand({
        TableName: tableName,
        GlobalSecondaryIndexUpdates: [{ Delete: { IndexName: spec.current } }],
      }),
    );
    console.log(`Deletion started for ${spec.current}; waiting until it is absent.`);
    await waitForIndex(spec.current, false);
    table = await describeTable();
  }
}

async function main() {
  const table = await describeTable();
  console.log(
    `Table=${tableName} region=${config.dynamodb.region} status=${table.TableStatus} billing=${table.BillingModeSummary?.BillingMode ?? "PROVISIONED"}`,
  );
  if (createReplacements) await createReplacementIndexes();
  else await deleteFullIndexes();
}

main()
  .catch((error) => {
    console.error("GSI projection migration failed:", error);
    process.exitCode = 1;
  })
  .finally(() => client.destroy());
