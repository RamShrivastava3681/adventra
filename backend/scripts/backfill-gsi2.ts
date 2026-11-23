/**
 * Controlled GSI2 backfill.
 *
 * Usage:
 *   npx tsx scripts/backfill-gsi2.ts --dry-run
 *   npx tsx scripts/backfill-gsi2.ts --apply
 *
 * Requires a completed backup and a successful staging dry-run before apply.
 * Apply changes only the missing gsi2pk attribute.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { config } from "../src/config.js";
import { shouldBackfillGsi2 } from "../src/lib/gsi2-backfill.js";
import { gsi2KeysFor } from "../src/lib/entity-index.js";
import { RequestRateLimiter } from "../src/lib/request-rate-limiter.js";

const apply = process.argv.includes("--apply");
const dryRun = process.argv.includes("--dry-run") || !apply;
const tableArgIndex = process.argv.indexOf("--table");
const tableName = tableArgIndex >= 0
  ? process.argv[tableArgIndex + 1]
  : config.dynamodb.tableName;
const maxItemsArgIndex = process.argv.indexOf("--max-items");
const maxItems = maxItemsArgIndex >= 0
  ? Math.max(0, parseInt(process.argv[maxItemsArgIndex + 1] || "0", 10) || 0)
  : 0;
const rateArgIndex = process.argv.indexOf("--requests-per-minute");
const requestsPerMinute = rateArgIndex >= 0
  ? Math.max(1, parseInt(process.argv[rateArgIndex + 1] || "1000", 10) || 1000)
  : Math.max(1, parseInt(process.env.GSI2_BACKFILL_REQUESTS_PER_MINUTE || "1000", 10) || 1000);
const rateLimiter = new RequestRateLimiter(requestsPerMinute);

const client = new DynamoDBClient({
  region: config.dynamodb.region,
  endpoint: config.dynamodb.endpoint,
  ...(config.dynamodb.credentials ? { credentials: config.dynamodb.credentials } : {}),
});
const doc = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

async function main() {
  let lastKey: Record<string, any> | undefined;
  let scanned = 0;
  let eligible = 0;
  let updateConsumedCapacity = 0;
  const counts = new Map<string, number>();

  do {
    await rateLimiter.waitForSlot();
    const result = await doc.send(new ScanCommand({
      TableName: tableName,
      ExclusiveStartKey: lastKey,
      ConsistentRead: true,
    }));

    for (const item of result.Items ?? []) {
      scanned++;
      if (!shouldBackfillGsi2(item)) continue;
      eligible++;
      counts.set(item.entityType, (counts.get(item.entityType) ?? 0) + 1);

      if (apply) {
        const keys = gsi2KeysFor(item);
        if (!keys) continue;
        await rateLimiter.waitForSlot();
        const update = await doc.send(new UpdateCommand({
          TableName: tableName,
          Key: { pk: item.pk, sk: item.sk },
          UpdateExpression: "SET gsi2pk = :pk, gsi2sk = :sk",
          ConditionExpression: "attribute_exists(pk) AND attribute_not_exists(gsi2pk)",
          ExpressionAttributeValues: {
            ":pk": keys.gsi2pk,
            ":sk": keys.gsi2sk,
          },
          ReturnConsumedCapacity: "TOTAL",
        }));
        updateConsumedCapacity += update.ConsumedCapacity?.CapacityUnits ?? 0;
      }
      if (maxItems > 0 && eligible >= maxItems) break;
    }
    lastKey = result.LastEvaluatedKey;
  } while (lastKey && (maxItems === 0 || eligible < maxItems));

  const summary = Object.fromEntries(
    [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)),
  );
  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    table: tableName,
    requestsPerMinute,
    scanned,
    eligible,
    byEntityType: summary,
    updateConsumedCapacity,
  }, null, 2));
}

main().catch((err) => {
  console.error("GSI2 backfill failed:", err);
  process.exit(1);
});
