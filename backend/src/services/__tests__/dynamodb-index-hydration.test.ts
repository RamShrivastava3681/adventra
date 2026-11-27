import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@aws-sdk/client-dynamodb", () => ({ DynamoDBClient: class {} }));
vi.mock("@aws-sdk/lib-dynamodb", async () => import("./helpers/fake-dynamo.js"));

const fake = await import("./helpers/fake-dynamo.js");
const db = await import("../../dynamodb.js");
const { config } = await import("../../config.js");
const dynamodbConfig = config.dynamodb as any;
const originalKeysOnly = dynamodbConfig.gsiKeysOnly;

beforeEach(() => {
  fake.table.clear();
  dynamodbConfig.gsiKeysOnly = true;
});

afterEach(() => {
  dynamodbConfig.gsiKeysOnly = originalKeysOnly;
});

function product(id: string, createdAt: string) {
  return {
    pk: `PRODUCT#${id}`,
    sk: `PRODUCT#${id}`,
    gsi1pk: "CLIENT#client-1",
    gsi1sk: `Product#${createdAt}`,
    gsi2pk: "Product",
    gsi2sk: `ENTITY#${createdAt}`,
    entityType: "Product",
    id,
    name: `Product ${id}`,
  };
}

describe("DynamoDB GSI item hydration", () => {
  it("returns full base-table records in GSI1 query order", async () => {
    await db.putItem(product("older", "2026-01-01"));
    await db.putItem(product("newer", "2026-02-01"));

    const result = await db.queryByGSI1("client-1");

    expect(result.items.map((item) => item.id)).toEqual(["newer", "older"]);
    expect(result.items[0]).toMatchObject({
      pk: "PRODUCT#newer",
      sk: "PRODUCT#newer",
      name: "Product newer",
    });
  });

  it("hydrates GSI2 reads and applies the requested base-item projection", async () => {
    await db.putItem(product("one", "2026-01-01"));

    const result = await db.scanByType("Product", { projection: ["id"] });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      pk: "PRODUCT#one",
      sk: "PRODUCT#one",
      id: "one",
    });
    expect(result[0]).not.toHaveProperty("name");
  });
});
