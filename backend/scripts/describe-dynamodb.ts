import { DynamoDBClient, DescribeTableCommand, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { config } from "../src/config.js";

const client = new DynamoDBClient({
  region: config.dynamodb.region,
  endpoint: config.dynamodb.endpoint,
  ...(config.dynamodb.credentials ? { credentials: config.dynamodb.credentials } : {}),
});

async function main() {
  const tables = await client.send(new ListTablesCommand({ Limit: 100 }));
  const tableName = config.dynamodb.tableName;
  const result = await client.send(new DescribeTableCommand({ TableName: tableName }));
  const table = result.Table;
  console.log(JSON.stringify({
    configuredTable: tableName,
    tables: tables.TableNames ?? [],
    status: table?.TableStatus,
    billingMode: table?.BillingModeSummary?.BillingMode,
    tableSizeBytes: table?.TableSizeBytes,
    itemCount: table?.ItemCount,
    provisionedTable: {
      readCapacityUnits: table?.ProvisionedThroughput?.ReadCapacityUnits,
      writeCapacityUnits: table?.ProvisionedThroughput?.WriteCapacityUnits,
    },
    gsis: (table?.GlobalSecondaryIndexes ?? []).map((index) => ({
      name: index.IndexName,
      status: index.IndexStatus,
      projectionType: index.Projection?.ProjectionType,
      projectedAttributes: index.Projection?.NonKeyAttributes ?? null,
      sizeBytes: index.IndexSizeBytes,
      itemCount: index.ItemCount,
      provisionedReadCapacityUnits: index.ProvisionedThroughput?.ReadCapacityUnits,
      provisionedWriteCapacityUnits: index.ProvisionedThroughput?.WriteCapacityUnits,
    })),
  }, null, 2));
}

main().catch((err) => {
  console.error("DynamoDB describe failed:", err);
  process.exit(1);
});
