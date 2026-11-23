import { DynamoDBClient, CreateTableCommand, DeleteTableCommand, DescribeTableCommand, ResourceInUseException } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { config } from "../src/config.js";

const tableName = "adventra-gsi2-staging";
const backupPath = process.argv[2];
const limit = 1000;

const dynamo = new DynamoDBClient({
  region: config.dynamodb.region,
  endpoint: config.dynamodb.endpoint,
  ...(config.dynamodb.credentials ? { credentials: config.dynamodb.credentials } : {}),
});
const doc = DynamoDBDocumentClient.from(dynamo, {
  marshallOptions: { removeUndefinedValues: true },
});

async function waitActive() {
  for (let i = 0; i < 60; i++) {
    const result = await dynamo.send(new DescribeTableCommand({ TableName: tableName }));
    if (result.Table?.TableStatus === "ACTIVE") return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Staging table did not become ACTIVE");
}

async function main() {
  if (!backupPath) throw new Error("Backup .jsonl.gz path is required");

  if (process.argv.includes("--reset")) {
    try {
      await dynamo.send(new DeleteTableCommand({ TableName: tableName }));
      for (let i = 0; i < 60; i++) {
        try {
          await dynamo.send(new DescribeTableCommand({ TableName: tableName }));
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (err: any) {
          if (err?.name === "ResourceNotFoundException") break;
          throw err;
        }
      }
    } catch (err: any) {
      if (err?.name !== "ResourceNotFoundException") throw err;
    }
  }

  try {
    await dynamo.send(new CreateTableCommand({
      TableName: tableName,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "pk", AttributeType: "S" },
        { AttributeName: "sk", AttributeType: "S" },
        { AttributeName: "gsi1pk", AttributeType: "S" },
        { AttributeName: "gsi1sk", AttributeType: "S" },
        { AttributeName: "gsi2pk", AttributeType: "S" },
        { AttributeName: "gsi2sk", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: "GSI1",
          KeySchema: [
            { AttributeName: "gsi1pk", KeyType: "HASH" },
            { AttributeName: "gsi1sk", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "ALL" },
        },
        {
          IndexName: "GSI2",
          KeySchema: [
            { AttributeName: "gsi2pk", KeyType: "HASH" },
            { AttributeName: "gsi2sk", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "ALL" },
        },
      ],
    }));
  } catch (err) {
    if (!(err instanceof ResourceInUseException) && err?.name !== "ResourceInUseException") throw err;
  }
  await waitActive();

  let inserted = 0;
  const lines = createInterface({
    input: createReadStream(backupPath).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  for await (const line of lines) {
    if (!line) continue;
    const item = JSON.parse(line);
    if (typeof item.entityType !== "string" || typeof item.gsi2pk === "string") continue;
    await doc.send(new PutCommand({
      TableName: tableName,
      Item: item,
      ReturnConsumedCapacity: "TOTAL",
    }));
    inserted++;
    if (inserted >= limit) break;
  }

  console.log(JSON.stringify({ tableName, inserted, source: backupPath }, null, 2));
}

main().catch((err) => {
  console.error("Staging preparation failed:", err);
  process.exit(1);
});
