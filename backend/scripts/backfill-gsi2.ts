/**
 * Controlled, resumable GSI2 backfill.
 *
 * Usage:
 *   npx tsx scripts/backfill-gsi2.ts --dry-run
 *   npx tsx scripts/backfill-gsi2.ts --apply
 *   npx tsx scripts/backfill-gsi2.ts --apply --resume
 *   npx tsx scripts/backfill-gsi2.ts --verify
 *
 * Requires a completed backup and a successful staging dry-run before apply.
 * Apply changes only the missing gsi2pk/gsi2sk attributes and never overwrites
 * keys written by an application write. Progress is checkpointed after every
 * page, so an interrupted run resumes with `--resume`.
 *
 * Staging rehearsal (never production):
 *   npx tsx scripts/prepare-gsi2-staging.ts <backup.jsonl.gz> --reset
 *   npx tsx scripts/backfill-gsi2.ts --table adventra-gsi2-staging --dry-run --checkpoint staging-backfill.checkpoint.json
 *   npx tsx scripts/backfill-gsi2.ts --table adventra-gsi2-staging --apply --checkpoint staging-backfill.checkpoint.json
 *   npx tsx scripts/backfill-gsi2.ts --table adventra-gsi2-staging --verify --checkpoint staging-backfill.checkpoint.json
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { config } from "../src/config.js";
import { shouldBackfillGsi2 } from "../src/lib/gsi2-backfill.js";
import { expectedGsi2Keys, gsi2KeysFor, isIndexableEntityType } from "../src/lib/entity-index.js";
import {
  DEFAULT_CHECKPOINT_FILE,
  readCheckpoint,
  tableMatchesCheckpoint,
  withThrottleRetry,
  writeCheckpoint,
  type BackfillCheckpoint,
} from "../src/lib/backfill-runner.js";
import { RequestRateLimiter } from "../src/lib/request-rate-limiter.js";

const apply = process.argv.includes("--apply");
const verify = process.argv.includes("--verify");
const resume = process.argv.includes("--resume");
const dryRun = process.argv.includes("--dry-run") || (!apply && !verify);

if (apply && verify) {
  console.error("Choose one mode: --apply or --verify.");
  process.exit(1);
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const tableName = argValue("--table") || config.dynamodb.tableName;
const checkpointFile =
  argValue("--checkpoint") ||
  process.env.GSI2_BACKFILL_CHECKPOINT ||
  DEFAULT_CHECKPOINT_FILE;
const maxItems = Math.max(0, parseInt(argValue("--max-items") || "0", 10) || 0);
const pageSize = Math.max(1, parseInt(argValue("--page-size") || "1000", 10) || 1000);
const requestsPerMinute = Math.max(
  1,
  parseInt(
    argValue("--requests-per-minute") ||
      process.env.GSI2_BACKFILL_REQUESTS_PER_MINUTE ||
      "1000",
    10,
  ) || 1000,
);
const rateLimiter = new RequestRateLimiter(requestsPerMinute);

const client = new DynamoDBClient({
  region: config.dynamodb.region,
  endpoint: config.dynamodb.endpoint,
  ...(config.dynamodb.credentials ? { credentials: config.dynamodb.credentials } : {}),
});
const doc = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const MAX_FAILURE_SAMPLES = 10;

function isConditionFailure(err: any) {
  return err?.name === "ConditionalCheckFailedException";
}

interface Counters {
  scanned: number;
  eligible: number;
  updated: number;
  skipped: number;
  failed: number;
}

interface FailureSample {
  pk: string;
  sk: string;
  entityType: string | null;
  error: string;
}

function emptyCheckpoint(): BackfillCheckpoint {
  const now = new Date().toISOString();
  return {
    table: tableName,
    lastKey: null,
    scanned: 0,
    eligible: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    startedAt: now,
    updatedAt: now,
    completed: false,
  };
}

async function loadStart(): Promise<BackfillCheckpoint> {
  const checkpoint = await readCheckpoint(checkpointFile);
  if (!checkpoint) return emptyCheckpoint();
  if (!tableMatchesCheckpoint(checkpoint, tableName)) {
    throw new Error(
      `Checkpoint ${checkpointFile} belongs to table "${checkpoint.table}", not "${tableName}". ` +
        `Use --checkpoint <file> or delete the stale checkpoint.`,
    );
  }
  if (!resume) {
    console.log(
      JSON.stringify({
        note: `Ignoring existing checkpoint (pass --resume to continue it): ${checkpointFile}`,
        previous: {
          scanned: checkpoint.scanned,
          eligible: checkpoint.eligible,
          completed: checkpoint.completed,
        },
      }),
    );
    return emptyCheckpoint();
  }
  if (checkpoint.completed) {
    console.log(
      JSON.stringify({
        note: `Checkpoint already complete; starting a fresh pass: ${checkpointFile}`,
      }),
    );
    return emptyCheckpoint();
  }
  return checkpoint;
}

async function main() {
  const checkpoint = await loadStart();
  const resumed = resume && checkpoint.scanned > 0;
  const counters: Counters = {
    scanned: checkpoint.scanned,
    eligible: checkpoint.eligible,
    updated: checkpoint.updated,
    skipped: checkpoint.skipped,
    failed: checkpoint.failed,
  };
  const byEntityType = new Map<string, number>();
  const failures: FailureSample[] = [];
  let lastKey: Record<string, any> | undefined = checkpoint.lastKey ?? undefined;
  let pages = 0;
  let updateConsumedCapacity = 0;

  // Verification state (only used with --verify).
  const verifyByType = new Map<
    string,
    { eligible: number; missing: number; wrongPartition: number; sortDrift: number }
  >();

  const persist = async (completed: boolean) => {
    checkpoint.lastKey = lastKey ?? null;
    checkpoint.scanned = counters.scanned;
    checkpoint.eligible = counters.eligible;
    checkpoint.updated = counters.updated;
    checkpoint.skipped = counters.skipped;
    checkpoint.failed = counters.failed;
    checkpoint.updatedAt = new Date().toISOString();
    checkpoint.completed = completed;
    await writeCheckpoint(checkpointFile, checkpoint);
  };

  do {
    await rateLimiter.waitForSlot();
    const result = await withThrottleRetry(() =>
      doc.send(
        new ScanCommand({
          TableName: tableName,
          ExclusiveStartKey: lastKey,
          Limit: pageSize,
          ConsistentRead: true,
        }),
      ),
    );
    pages++;

    for (const item of result.Items ?? []) {
      counters.scanned++;

      if (verify) {
        if (!isIndexableEntityType(item.entityType)) continue;
        const expected = expectedGsi2Keys(item);
        if (!expected) continue;
        const stats = verifyByType.get(item.entityType) ?? {
          eligible: 0,
          missing: 0,
          wrongPartition: 0,
          sortDrift: 0,
        };
        stats.eligible++;
        if (!item.gsi2pk) stats.missing++;
        else if (item.gsi2pk !== expected.gsi2pk) stats.wrongPartition++;
        if (item.gsi2pk && item.gsi2sk !== expected.gsi2sk) stats.sortDrift++;
        verifyByType.set(item.entityType, stats);
        continue;
      }

      if (!shouldBackfillGsi2(item)) continue;
      counters.eligible++;
      byEntityType.set(item.entityType, (byEntityType.get(item.entityType) ?? 0) + 1);

      if (!apply) continue;

      if (!item.pk || !item.sk) {
        counters.skipped++;
        continue;
      }
      const keys = gsi2KeysFor(item);
      if (!keys) continue;
      try {
        await rateLimiter.waitForSlot();
        const update = await withThrottleRetry(() =>
          doc.send(
            new UpdateCommand({
              TableName: tableName,
              Key: { pk: item.pk, sk: item.sk },
              UpdateExpression: "SET gsi2pk = :pk, gsi2sk = :sk",
              ConditionExpression: "attribute_exists(pk) AND attribute_not_exists(gsi2pk)",
              ExpressionAttributeValues: {
                ":pk": keys.gsi2pk,
                ":sk": keys.gsi2sk,
              },
              ReturnConsumedCapacity: "TOTAL",
            }),
          ),
        );
        counters.updated++;
        updateConsumedCapacity += update.ConsumedCapacity?.CapacityUnits ?? 0;
      } catch (err) {
        // A concurrent application write may have populated the key first; that
        // is a skip, not a failure. Anything else is isolated and counted.
        if (isConditionFailure(err)) {
          counters.skipped++;
        } else {
          counters.failed++;
          if (failures.length < MAX_FAILURE_SAMPLES) {
            failures.push({
              pk: String(item.pk ?? ""),
              sk: String(item.sk ?? ""),
              entityType: item.entityType ?? null,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    }

    lastKey = result.LastEvaluatedKey;
    await persist(!lastKey);
  } while (lastKey && (maxItems === 0 || counters.eligible < maxItems));

  const summaryByType = Object.fromEntries(
    [...byEntityType.entries()].sort(([a], [b]) => a.localeCompare(b)),
  );

  if (verify) {
    const verification = Object.fromEntries(
      [...verifyByType.entries()].sort(([a], [b]) => a.localeCompare(b)),
    );
    const totals = Object.values(verification).reduce(
      (acc, s) => ({
        eligible: acc.eligible + s.eligible,
        missing: acc.missing + s.missing,
        wrongPartition: acc.wrongPartition + s.wrongPartition,
        sortDrift: acc.sortDrift + s.sortDrift,
      }),
      { eligible: 0, missing: 0, wrongPartition: 0, sortDrift: 0 },
    );
    console.log(
      JSON.stringify(
        {
          mode: "verify",
          table: tableName,
          pages,
          scanned: counters.scanned,
          eligible: totals.eligible,
          missing: totals.missing,
          wrongPartition: totals.wrongPartition,
          sortDrift: totals.sortDrift,
          incomplete: totals.missing > 0 || totals.wrongPartition > 0,
          byEntityType: verification,
          checkpoint: checkpointFile,
        },
        null,
        2,
      ),
    );
    if (totals.missing > 0 || totals.wrongPartition > 0) process.exitCode = 2;
    return;
  }

  await persist(!lastKey);

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        table: tableName,
        resumed,
        pages,
        requestsPerMinute,
        pageSize,
        scanned: counters.scanned,
        eligible: counters.eligible,
        updated: counters.updated,
        skipped: counters.skipped,
        failed: counters.failed,
        byEntityType: summaryByType,
        updateConsumedCapacity,
        failures,
        complete: !lastKey && counters.failed === 0,
        stoppedEarly: maxItems > 0 && counters.eligible >= maxItems,
        checkpoint: checkpointFile,
        nextCommand: lastKey
          ? `npx tsx scripts/backfill-gsi2.ts ${apply ? "--apply " : ""}--resume --checkpoint ${checkpointFile}`
          : null,
      },
      null,
      2,
    ),
  );

  if (counters.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("GSI2 backfill failed:", err);
  process.exit(1);
});
