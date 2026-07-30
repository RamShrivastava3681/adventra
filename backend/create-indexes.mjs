// Script to create GSI1 and GSI2 indexes on the DynamoDB "adventra" table
// Run with: node create-indexes.mjs

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  UpdateTableCommand,
  DescribeTableCommand,
} from "@aws-sdk/client-dynamodb";

// Load .env manually
import { readFileSync } from "fs";
const envFile = readFileSync(".env", "utf-8");
const env = {};
for (const line of envFile.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
}

const region = env.AWS_REGION || "ap-south-1";
const tableName = env.DYNAMODB_TABLE || "adventra";
const accessKeyId = env.AWS_ACCESS_KEY_ID;
const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;

if (!accessKeyId || !secretAccessKey) {
  console.error("❌ AWS credentials not found in .env");
  process.exit(1);
}

const client = new DynamoDBClient({
  region,
  credentials: { accessKeyId, secretAccessKey },
});

console.log(`\n🔧 Creating indexes on table "${tableName}" in region "${region}" ...\n`);

async function createIndex(indexName, pkName, skName) {
  console.log(`  Creating index "${indexName}" ...`);
  const input = {
    TableName: tableName,
    AttributeDefinitions: [
      { AttributeName: pkName, AttributeType: "S" },
      { AttributeName: skName, AttributeType: "S" },
    ],
    GlobalSecondaryIndexUpdates: [
      {
        Create: {
          IndexName: indexName,
          KeySchema: [
            { AttributeName: pkName, KeyType: "HASH" },
            { AttributeName: skName, KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "ALL" },
        },
      },
    ],
  };

  try {
    await client.send(new UpdateTableCommand(input));
    console.log(`  ✅ Index "${indexName}" creation initiated.`);
  } catch (err) {
    if (err.name === "ResourceInUseException") {
      console.log(`  ⚠  Index "${indexName}" already exists or is being created.`);
    } else {
      throw err;
    }
  }
}

async function waitForIndexActive(indexName) {
  console.log(`  ⏳ Waiting for index "${indexName}" to become ACTIVE ...`);
  let attempts = 0;
  while (attempts < 120) {
    const desc = await client.send(
      new DescribeTableCommand({ TableName: tableName })
    );
    const index = desc.Table.GlobalSecondaryIndexes?.find(
      (i) => i.IndexName === indexName
    );
    if (index) {
      if (index.IndexStatus === "ACTIVE") {
        console.log(`  ✅ Index "${indexName}" is ACTIVE.`);
        return;
      }
      console.log(`     Status: ${index.IndexStatus} (attempt ${attempts + 1})`);
    }
    await new Promise((r) => setTimeout(r, 5000));
    attempts++;
  }
  console.log(`  ⚠  Timed out waiting for "${indexName}". Check AWS console.`);
}

async function main() {
  // Step 1: Describe the current table
  console.log("📋 Current table info:");
  let desc;
  try {
    desc = await client.send(
      new DescribeTableCommand({ TableName: tableName })
    );
    console.log(`  Table: ${desc.Table.TableName}`);
    console.log(`  Status: ${desc.Table.TableStatus}`);
  } catch (err) {
    if (err.name === "ResourceNotFoundException") {
      console.error(`❌ Table "${tableName}" does not exist!`);
      process.exit(1);
    }
    throw err;
  }

  const existingIndexList =
    desc.Table.GlobalSecondaryIndexes?.map((i) => i.IndexName) || [];
  console.log(`  Existing indexes: ${existingIndexList.join(", ") || "none"}`);

  const needGSI1 = !existingIndexList.includes("GSI1");
  const needGSI2 = !existingIndexList.includes("GSI2");

  if (!needGSI1 && !needGSI2) {
    console.log("\n✅ Both GSI1 and GSI2 already exist! No action needed.\n");
    return;
  }

  // Step 2: Create GSI1 first, wait for it to become ACTIVE
  if (needGSI1) {
    console.log("");
    await createIndex("GSI1", "gsi1pk", "gsi1sk");
    console.log("  📌 GSI1 creation command submitted.");
    console.log("");
    await waitForIndexActive("GSI1");
  } else {
    console.log("\n✅ GSI1 already exists.");
  }

  // Step 3: Create GSI2 now that GSI1 is active
  if (needGSI2) {
    console.log("");
    // Re-describe to get latest state
    const currentDesc = await client.send(
      new DescribeTableCommand({ TableName: tableName })
    );
    const currentIndexes = currentDesc.Table.GlobalSecondaryIndexes?.map((i) => i.IndexName) || [];
    if (!currentIndexes.includes("GSI2")) {
      await createIndex("GSI2", "gsi2pk", "gsi2sk");
      console.log("  📌 GSI2 creation command submitted.");
      console.log("");
      await waitForIndexActive("GSI2");
    } else {
      console.log("✅ GSI2 already exists (was created during wait).");
    }
  } else {
    console.log("✅ GSI2 already exists.");
  }

  // Summary
  console.log("\n✅ All indexes created and active!");
  console.log("\n📋 Final table info:");
  const finalDesc = await client.send(
    new DescribeTableCommand({ TableName: tableName })
  );
  for (const idx of finalDesc.Table.GlobalSecondaryIndexes || []) {
    console.log(`  - ${idx.IndexName}: ${idx.IndexStatus}`);
  }

  console.log("\n🚀 Restart your backend server and the API should work!\n");
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
