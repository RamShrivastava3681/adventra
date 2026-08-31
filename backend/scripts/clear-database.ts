// One-off script: clears ALL data from the DynamoDB table except User entities
// so you keep access after the wipe.
//
// Run with:  cd backend && npx tsx scripts/clear-database.ts [--dry-run] [--yes]
//
// ⚠️  DESTRUCTIVE — writes to the REAL DynamoDB table configured in backend/.env

import * as db from "../src/dynamodb.js";
import { config } from "../src/config.js";

const log = (s: string) => console.log(s);

// Entities to keep (never delete)
const KEEP = new Set(["User"]);

async function main() {
  const isDryRun = process.argv.includes("--dry-run");
  const hasConfirmed = process.argv.includes("--yes");
  if (!isDryRun && !hasConfirmed) {
    log(`❌ Refusing to write to table "${config.dynamodb.tableName}" without confirmation.`);
    log("   Re-run with:  --yes");
    log("   To preview without writing anything, use:            --dry-run");
    process.exit(1);
  }
  if (isDryRun) log("▶ DRY RUN — no data will be deleted.\n");

  log(`→ Table: ${config.dynamodb.tableName}\n`);

  // Scan ALL items in the table
  let allItems: any[] = [];
  let lastKey: Record<string, any> | undefined;
  let scanCount = 0;
  do {
    const params: any = {
      TableName: config.dynamodb.tableName,
      Limit: 100,
      ExclusiveStartKey: lastKey,
    };
    const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
    const { DynamoDBDocumentClient, ScanCommand } = await import("@aws-sdk/lib-dynamodb");
    const client = new DynamoDBClient({
      region: config.dynamodb.region,
      endpoint: config.dynamodb.endpoint,
      ...(config.dynamodb.credentials ? { credentials: config.dynamodb.credentials } : {}),
    });
    const docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
    const result = await docClient.send(new ScanCommand(params));
    if (result.Items) allItems.push(...result.Items);
    lastKey = result.LastEvaluatedKey;
    scanCount++;
  } while (lastKey);

  log(`→ Total items in table: ${allItems.length}\n`);

  // Group by entityType
  const byType = new Map<string, any[]>();
  for (const item of allItems) {
    const type = item.entityType || "Unknown";
    const arr = byType.get(type) || [];
    arr.push(item);
    byType.set(type, arr);
  }

  // Separate keep vs delete
  const toDelete: any[] = [];
  const kept: any[] = [];

  for (const [type, items] of byType) {
    if (KEEP.has(type)) {
      kept.push(...items);
      log(`  🔒 ${type}: ${items.length} item(s) — KEPT`);
    } else {
      toDelete.push(...items);
      log(`  🗑️  ${type}: ${items.length} item(s) — will be deleted`);
    }
  }

  log(`\n→ Items to KEEP:    ${kept.length}`);
  log(`→ Items to DELETE:  ${toDelete.length}\n`);

  if (toDelete.length === 0) {
    log("✅ Nothing to delete — table is already clean.");
    process.exit(0);
  }

  if (isDryRun) {
    log("(End of dry run — nothing deleted.)");
    process.exit(0);
  }

  // Delete in batches (DynamoDB BatchWriteItem handles up to 25)
  const BATCH_SIZE = 25;
  let deleted = 0;
  let errors = 0;

  for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
    const batch = toDelete.slice(i, i + BATCH_SIZE);
    // We need to use BatchWriteCommand which supports up to 25 deletes
    const { BatchWriteCommand } = await import("@aws-sdk/lib-dynamodb");
    const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
    const { DynamoDBDocumentClient } = await import("@aws-sdk/lib-dynamodb");
    const client = new DynamoDBClient({
      region: config.dynamodb.region,
      endpoint: config.dynamodb.endpoint,
      ...(config.dynamodb.credentials ? { credentials: config.dynamodb.credentials } : {}),
    });
    const docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });

    const requestItems: any[] = batch.map((item: any) => ({
      DeleteRequest: {
        Key: { pk: item.pk, sk: item.sk },
      },
    }));

    try {
      const result = await docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [config.dynamodb.tableName]: requestItems,
          },
        })
      );

      const unprocessed = result.UnprocessedItems?.[config.dynamodb.tableName] || [];
      deleted += batch.length - unprocessed.length;
      errors += unprocessed.length;

      if (unprocessed.length > 0) {
        log(`  ⚠️  Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${unprocessed.length} unprocessed items (throttled)`);
      }
    } catch (err: any) {
      log(`  ❌ Batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${err?.message}`);
      errors += batch.length;
    }

    // Progress
    if ((i + BATCH_SIZE) % 100 === 0 || i + BATCH_SIZE >= toDelete.length) {
      log(`  Progress: ${Math.min(i + BATCH_SIZE, toDelete.length)}/${toDelete.length}`);
    }
  }

  log(`\n✅ Done. Deleted ${deleted} item(s). Errors: ${errors}.`);
  log(`   Users kept: ${kept.length}`);
}

main().catch((err) => {
  console.error("❌ Failed:", err);
  process.exit(1);
});
