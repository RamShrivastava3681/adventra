import { DynamoDBClient, DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import { config } from "../src/config.js";

const client = new DynamoDBClient({
  region: config.dynamodb.region,
  endpoint: config.dynamodb.endpoint,
  ...(config.dynamodb.credentials ? { credentials: config.dynamodb.credentials } : {}),
});

await client.send(new DeleteTableCommand({ TableName: "adventra-gsi2-staging" }));
console.log("Deleted adventra-gsi2-staging");
