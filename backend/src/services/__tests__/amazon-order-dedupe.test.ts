/**
 * Amazon orders / order-items sync must never duplicate records, and must fill
 * SKU and product name on the order. Runs the real sync and models against an
 * in-memory table; only the AWS SDK and the SP-API calls are replaced.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@aws-sdk/client-dynamodb", () => ({ DynamoDBClient: class {} }));
vi.mock("@aws-sdk/lib-dynamodb", async () => import("./helpers/fake-dynamo.js"));

const fake = await import("./helpers/fake-dynamo.js");
const db = await import("../../dynamodb.js");
const { config } = await import("../../config.js");
const { amazonSpApi } = await import("../amazon-spapi.service.js");
const { amazonSync } = await import("../amazon-sync.service.js");
const OrderModel = await import("../../models/marketplace-amazon-order.js");

const CLIENT = "client-1";
const rows = (type: string) => [...fake.table.values()].filter((i: any) => i.entityType === type);

/** Amazon orders as getOrders returns them: no items inside. */
const amazonOrders = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    AmazonOrderId: `402-0000000-${String(i).padStart(7, "0")}`,
    PurchaseDate: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString(),
    LastUpdateDate: "2026-11-20T00:00:00Z",
    OrderStatus: "Unshipped",
    FulfillmentChannel: "MFN",
    OrderTotal: { Amount: "1000.00", CurrencyCode: "INR" },
    NumberOfItemsUnshipped: 2,
    PurchaseOrderNumber: "PO-BUYER-123",
  }));

const itemsFor = (orderId: string) => ({
  payload: {
    AmazonOrderId: orderId,
    OrderItems: [
      { OrderItemId: `${orderId}-A`, SellerSKU: "ADV-TEE-BLK-M", Title: "Adventra Tee Black M", QuantityOrdered: 1, ItemPrice: { Amount: "600.00", CurrencyCode: "INR" } },
      { OrderItemId: `${orderId}-B`, SellerSKU: "ADV-CAP-RED", Title: "Adventra Cap Red", QuantityOrdered: 1, ItemPrice: { Amount: "400.00", CurrencyCode: "INR" } },
    ],
  },
});

let orderPages: any[];

beforeEach(() => {
  fake.table.clear();
  (config.amazon as any).isConfigured = true;
  orderPages = [];
  vi.restoreAllMocks();
  vi.spyOn(amazonSpApi, "getOrders").mockImplementation(async () => ({ payload: { Orders: orderPages, NextToken: null } }) as any);
  vi.spyOn(amazonSpApi, "getOrderItems").mockImplementation(async ({ amazonOrderId }: any) => itemsFor(amazonOrderId) as any);
});

describe("orders sync", () => {
  it("keeps one record per Amazon order across repeated syncs, even past 500 orders", async () => {
    orderPages = amazonOrders(600);
    await amazonSync.run("orders", CLIENT);
    await amazonSync.run("orders", CLIENT);
    await amazonSync.run("orders", CLIENT);
    expect(rows("MarketplaceAmazonOrder")).toHaveLength(600);
    expect(rows(OrderModel.ORDER_REF_ENTITY)).toHaveLength(600);
    expect(new Set(rows("MarketplaceAmazonOrder").map((o: any) => o.amazonOrderId)).size).toBe(600);
  });

  it("never uses the buyer's purchase-order number as the SKU", async () => {
    orderPages = amazonOrders(1);
    await amazonSync.run("orders", CLIENT);
    const [order] = rows("MarketplaceAmazonOrder") as any[];
    expect(order.amazonSku).toBe("");
    expect(order.amazonLastUpdatedAt).toBe("2026-11-20T00:00:00Z");
  });

  it("finds an order saved before the lookup record existed, without copying it", async () => {
    await db.putItem({
      pk: "MARKETPLACE_AMAZON_ORDER#legacy-1",
      sk: "MARKETPLACE_AMAZON_ORDER#legacy-1",
      gsi1pk: `CLIENT#${CLIENT}`,
      gsi1sk: "MarketplaceAmazonOrder#2026-11-01T00:00:00Z",
      entityType: "MarketplaceAmazonOrder",
      id: "legacy-1",
      clientId: CLIENT,
      amazonOrderId: "402-0000000-0000000",
      amazonSku: "",
      productName: "",
      quantity: 2,
      sellingPrice: 500,
      createdAt: "2026-11-01T00:00:00Z",
      updatedAt: "2026-11-01T00:00:00Z",
    });
    orderPages = amazonOrders(1);
    await amazonSync.run("orders", CLIENT);
    expect(rows("MarketplaceAmazonOrder")).toHaveLength(1);
    const [ref] = rows(OrderModel.ORDER_REF_ENTITY) as any[];
    expect(ref.orderId).toBe("legacy-1");
  });

  it("keeps lookup records out of the entity-type index (GSI2)", async () => {
    orderPages = amazonOrders(1);
    await amazonSync.run("orders", CLIENT);
    const [ref] = rows(OrderModel.ORDER_REF_ENTITY) as any[];
    expect(ref.gsi2pk).toBeUndefined();
    expect(ref.gsi1pk).toBe(`CLIENT#${CLIENT}`);
  });
});

describe("order-items sync", () => {
  it("writes each item once, fills SKU and product name on the order, and skips current orders next time", async () => {
    orderPages = amazonOrders(3);
    await amazonSync.run("orders", CLIENT);

    await amazonSync.run("order-items", CLIENT);
    expect(rows("MarketplaceAmazonOrderItem")).toHaveLength(6);
    const order = (await OrderModel.findByAmazonOrderId(CLIENT, "402-0000000-0000000"))!;
    expect(order).toMatchObject({ amazonSku: "ADV-TEE-BLK-M", productName: "Adventra Tee Black M", quantity: 2, sellingPrice: 600 });
    expect(order.itemsSyncedAt).toBeTruthy();

    const calls = vi.mocked(amazonSpApi.getOrderItems).mock.calls.length;
    await amazonSync.run("order-items", CLIENT);
    expect(vi.mocked(amazonSpApi.getOrderItems).mock.calls.length).toBe(calls); // nothing re-fetched
    expect(rows("MarketplaceAmazonOrderItem")).toHaveLength(6);
  });

  it("re-fetches items when Amazon updates the order, overwriting instead of adding", async () => {
    orderPages = amazonOrders(1);
    await amazonSync.run("orders", CLIENT);
    await amazonSync.run("order-items", CLIENT);

    orderPages = amazonOrders(1).map((o) => ({ ...o, LastUpdateDate: "2099-01-01T00:00:00Z" }));
    await amazonSync.run("orders", CLIENT);
    await amazonSync.run("order-items", CLIENT);
    expect(vi.mocked(amazonSpApi.getOrderItems)).toHaveBeenCalledTimes(2);
    expect(rows("MarketplaceAmazonOrderItem")).toHaveLength(2);
  });

  it("a later orders sync keeps the item-level quantity and price", async () => {
    orderPages = amazonOrders(1);
    await amazonSync.run("orders", CLIENT);
    await amazonSync.run("order-items", CLIENT);
    await amazonSync.run("orders", CLIENT);
    const order = (await OrderModel.findByAmazonOrderId(CLIENT, "402-0000000-0000000"))!;
    expect(order).toMatchObject({ amazonSku: "ADV-TEE-BLK-M", sellingPrice: 600, quantity: 2 });
  });
});

describe("order create", () => {
  it("a second create for the same Amazon order returns the first record instead of a copy", async () => {
    const base = {
      clientId: CLIENT,
      amazonOrderId: "402-1111111-1111111",
      amazonSku: "X",
      productName: "X",
      colour: null,
      size: null,
      quantity: 1,
      sellingPrice: 10,
      discount: 0,
      shippingMethod: "Standard",
      fulfilmentType: "SellerFlex" as const,
    };
    const a = await OrderModel.create(base);
    const b = await OrderModel.create(base);
    expect(b.id).toBe(a.id);
    expect(rows("MarketplaceAmazonOrder")).toHaveLength(1);
  });
});
