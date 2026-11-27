/**
 * Removes the duplicate Amazon order and order-item records the old sync created.
 *
 * Before the fix, the orders sync looked an order up among the newest 500 only,
 * so every older order was created again on each sync; order items were keyed by
 * a counter, so every sync added another copy. This script keeps ONE order record
 * per (client, Amazon Order ID) and deletes the rest, and deletes the old-format
 * item rows (they have no `orderItemId`); the fixed order-items sync fetches the
 * items again with stable keys and fills SKU and product name on each order.
 *
 * Which order record is kept: the one the lookup record already points at; else
 * the one with the most WhizUnik links (sales order, invoice, dispatch…); else the
 * most recently updated. Its lookup record is written so the sync uses it.
 *
 * Usage (from backend/):
 *   npx tsx scripts/dedupe-amazon-orders.ts                       # dry run: counts only, changes nothing
 *   npx tsx scripts/dedupe-amazon-orders.ts --apply --i-have-a-backup
 *
 * Take a DynamoDB backup (or confirm point-in-time recovery) before --apply.
 * Demo-tenant records (isDemoData) are never touched.
 */
import "dotenv/config";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { config } from "../src/config.js";
import { orderRefItem } from "../src/models/marketplace-amazon-order.js";

const TABLE = config.dynamodb.tableName;
const doc = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: config.dynamodb.region,
    credentials: config.dynamodb.credentials,
    endpoint: config.dynamodb.endpoint,
  }),
  {
    marshallOptions: { removeUndefinedValues: true },
  },
);

const APPLY = process.argv.includes("--apply");
if (APPLY && !process.argv.includes("--i-have-a-backup")) {
  console.error("Refusing to delete: take a DynamoDB backup first, then add --i-have-a-backup.");
  process.exit(1);
}

const LINK_FIELDS = [
  "salesOrderId",
  "invoiceRecordId",
  "dispatchId",
  "warehouseTaskId",
  "internalSku",
  "productId",
  "awbNumber",
  "whizunikStatus",
] as const;

type Row = Record<string, any>;

async function queryAllByType(entityType: string, projection: string): Promise<Row[]> {
  const out: Row[] = [];
  let start: Row | undefined;
  do {
    const r = await doc.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: "GSI2",
        KeyConditionExpression: "gsi2pk = :t",
        ExpressionAttributeValues: { ":t": entityType },
        ProjectionExpression: projection,
        ExclusiveStartKey: start,
      }),
    );
    out.push(...(r.Items ?? []));
    start = r.LastEvaluatedKey;
    if (out.length % 50000 < (r.Items?.length ?? 0)) process.stdout.write(`  read ${out.length} ${entityType}…\n`);
  } while (start);
  return out;
}

async function deleteKeys(keys: { pk: string; sk: string }[], label: string) {
  let done = 0;
  for (let i = 0; i < keys.length; i += 25) {
    let requests = keys.slice(i, i + 25).map((k) => ({ DeleteRequest: { Key: { pk: k.pk, sk: k.sk } } }));
    for (let attempt = 0; requests.length && attempt < 8; attempt++) {
      const r = await doc.send(new BatchWriteCommand({ RequestItems: { [TABLE]: requests } }));
      requests = (r.UnprocessedItems?.[TABLE] as typeof requests) ?? [];
      if (requests.length) await new Promise((res) => setTimeout(res, 200 * 2 ** attempt));
    }
    if (requests.length) throw new Error(`${requests.length} deletes still unprocessed after retries`);
    done += Math.min(25, keys.length - i);
    if (done % 10000 < 25) console.log(`  deleted ${done}/${keys.length} ${label}`);
  }
}

async function main() {
  console.log(`Table ${TABLE} — ${APPLY ? "APPLY (deleting)" : "DRY RUN (nothing is changed)"}\n`);

  // ── Orders ──
  const orders = await queryAllByType(
    "MarketplaceAmazonOrder",
    ["pk", "sk", "id", "clientId", "amazonOrderId", "updatedAt", "isDemoData", ...LINK_FIELDS].join(", "),
  );
  const groups = new Map<string, Row[]>();
  for (const o of orders) {
    if (o.isDemoData || !o.clientId || !o.amazonOrderId) continue;
    const k = `${o.clientId}|${o.amazonOrderId}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(o);
  }

  const orderDeletes: { pk: string; sk: string }[] = [];
  const keepers: Row[] = [];
  for (const [k, rows] of groups) {
    const [clientId, amazonOrderId] = k.split("|");
    const refPk = `MARKETPLACE_AMAZON_ORDER_REF#${clientId}#${amazonOrderId}`;
    const ref = (await doc.send(new GetCommand({ TableName: TABLE, Key: { pk: refPk, sk: refPk } }))).Item;
    const links = (o: Row) => LINK_FIELDS.filter((f) => o[f] != null && o[f] !== "").length;
    const keeper =
      rows.find((o) => ref && o.id === ref.orderId) ??
      [...rows].sort((a, b) => links(b) - links(a) || String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))[0];
    keepers.push(keeper);
    for (const o of rows) if (o !== keeper) orderDeletes.push({ pk: o.pk, sk: o.sk });
  }

  console.log(`Orders: ${orders.length} records, ${groups.size} real Amazon orders, ${orderDeletes.length} duplicates to delete`);

  // ── Order items (old format = no orderItemId) ──
  const items = await queryAllByType("MarketplaceAmazonOrderItem", "pk, sk, orderItemId, isDemoData");
  const itemDeletes = items.filter((i) => !i.isDemoData && !i.orderItemId).map((i) => ({ pk: i.pk, sk: i.sk }));
  console.log(`Order items: ${items.length} records, ${itemDeletes.length} old-format rows to delete (re-fetched by the fixed sync)\n`);

  if (!APPLY) {
    console.log("Dry run finished. Nothing was changed. Re-run with --apply --i-have-a-backup to delete.");
    return;
  }

  for (const k of keepers) {
    await doc.send(new PutCommand({ TableName: TABLE, Item: orderRefItem(k.clientId, k.amazonOrderId, k.id) }));
  }
  console.log(`Wrote ${keepers.length} lookup records`);
  await deleteKeys(orderDeletes, "orders");
  await deleteKeys(itemDeletes, "order items");
  console.log("\nDone. Run the Amazon orders + order-items sync to fill SKU and product name on every order.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err?.message ?? err);
    process.exit(1);
  });
