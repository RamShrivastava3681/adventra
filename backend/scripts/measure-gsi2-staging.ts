import { DynamoDBClient, DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  QueryCommand,
  UpdateCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { config } from "../src/config.js";

const tableName = "adventra-gsi2-staging";
const dynamo = new DynamoDBClient({
  region: config.dynamodb.region,
  endpoint: config.dynamodb.endpoint,
  ...(config.dynamodb.credentials ? { credentials: config.dynamodb.credentials } : {}),
});
const doc = DynamoDBDocumentClient.from(dynamo, {
  marshallOptions: { removeUndefinedValues: true },
});

async function main() {
  const before = await dynamo.send(new DescribeTableCommand({ TableName: tableName }));
  let scannedItems = 0;
  let scanRcus = 0;
  let lastKey: Record<string, any> | undefined;

  do {
    const result = await doc.send(new ScanCommand({
      TableName: tableName,
      Limit: 100,
      ExclusiveStartKey: lastKey,
      ConsistentRead: false,
      ReturnConsumedCapacity: "TOTAL",
    }));
    scannedItems += result.Items?.length ?? 0;
    scanRcus += result.ConsumedCapacity?.CapacityUnits ?? 0;
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  let queriedItems = 0;
  let queryRcus = 0;
  lastKey = undefined;
  let gsiResultCount = 0;
  do {
    const result = await doc.send(new QueryCommand({
      TableName: tableName,
      IndexName: "GSI2",
      KeyConditionExpression: "gsi2pk = :pk",
      ExpressionAttributeValues: { ":pk": "MarketplaceAmazonOrder" },
      ExclusiveStartKey: lastKey,
      Limit: 100,
      ReturnConsumedCapacity: "TOTAL",
    }));
    queriedItems += result.Items?.length ?? 0;
    queryRcus += result.ConsumedCapacity?.CapacityUnits ?? 0;
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  let updated = 0;
  let updateWcus = 0;
  const eligible = await doc.send(new ScanCommand({
    TableName: tableName,
    FilterExpression: "attribute_not_exists(gsi2pk)",
    Limit: 100,
    ConsistentRead: true,
  }));
  for (const item of eligible.Items ?? []) {
    if (updated >= 10) break;
    const entityType = item.entityType;
    if (typeof entityType !== "string") continue;
    const result = await doc.send(new UpdateCommand({
      TableName: tableName,
      Key: { pk: item.pk, sk: item.sk },
      UpdateExpression: "SET gsi2pk = :pk",
      ConditionExpression: "attribute_exists(pk) AND attribute_not_exists(gsi2pk)",
      ExpressionAttributeValues: { ":pk": entityType },
      ReturnConsumedCapacity: "TOTAL",
    }));
    updateWcus += result.ConsumedCapacity?.CapacityUnits ?? 0;
    updated++;
  }

  const after = await dynamo.send(new DescribeTableCommand({ TableName: tableName }));
  console.log(JSON.stringify({
    tableName,
    measuredItems: 1000,
    sampleUpdateCount: updated,
    updateWcus,
    scanItems: scannedItems,
    scanRcus,
    gsi2QueryItems: queriedItems,
    gsi2QueryRcus: queryRcus,
    tableSizeBytesBefore: before.Table?.TableSizeBytes,
    tableSizeBytesAfter: after.Table?.TableSizeBytes,
  }, null, 2));
}

main().catch((err) => {
  console.error("Measurement failed:", err);
  process.exit(1);
});
