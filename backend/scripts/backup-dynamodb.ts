/**
 * Full DynamoDB table backup to a gzipped JSONL file.
 *
 * Usage:
 *   npx tsx scripts/backup-dynamodb.ts
 *   npx tsx scripts/backup-dynamodb.ts --out backups/my-backup.jsonl.gz
 *   npx tsx scripts/backup-dynamodb.ts --max-items 1000   # smoke test only
 *
 * This is an admin/one-time tool (PDF "Safe DynamoDB Scan Fix" §3B): it uses
 * ScanCommand deliberately, paginates until done, and never runs on page load.
 * The output is the restore source for the GSI2 backfill rollback.
 */
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { createWriteStream } from "node:fs";
import { mkdirSync } from "node:fs";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { config } from "../src/config.js";

function arg(name: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? "true";
}

async function* scanAll(maxItems: number): AsyncGenerator<Record<string, any>> {
  const client = new DynamoDBClient({
    region: config.dynamodb.region,
    endpoint: config.dynamodb.endpoint,
    ...(config.dynamodb.credentials ? { credentials: config.dynamodb.credentials } : {}),
  });
  const doc = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });

  let lastKey: Record<string, any> | undefined;
  let emitted = 0;
  let pages = 0;
  do {
    const res = await doc.send(
      new ScanCommand({
        TableName: config.dynamodb.tableName,
        ExclusiveStartKey: lastKey,
        ConsistentRead: true,
      }),
    );
    pages++;
    for (const item of res.Items ?? []) {
      yield item;
      emitted++;
      if (maxItems > 0 && emitted >= maxItems) return;
    }
    lastKey = res.LastEvaluatedKey;
    if (pages % 10 === 0) {
      console.log(`  ... scanned ${pages} pages / ${emitted} items`);
    }
  } while (lastKey);
}

async function main() {
  const table = config.dynamodb.tableName;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = path.resolve(
    arg("out", `backups/dynamodb-${table}-${stamp}.jsonl.gz`)!,
  );
  const maxItems = parseInt(arg("max-items", "0")!, 10) || 0;

  mkdirSync(path.dirname(out), { recursive: true });
  console.log(`\nBacking up table "${table}" (${config.dynamodb.region}) -> ${out}`);
  if (maxItems > 0) console.log(`  (limited to ${maxItems} items — smoke test)`);

  const started = Date.now();
  let count = 0;

  async function* jsonLines() {
    for await (const item of scanAll(maxItems)) {
      count++;
      yield Buffer.from(JSON.stringify(item) + "\n", "utf8");
    }
  }

  await pipeline(Readable.from(jsonLines()), createGzip({ level: 9 }), createWriteStream(out));

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n✅ Backup complete: ${count} items in ${seconds}s`);
  console.log(`   ${out}\n`);
}

main().catch((err) => {
  console.error("❌ Backup failed:", err);
  process.exit(1);
});
