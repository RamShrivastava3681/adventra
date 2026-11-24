/**
 * Shopify sync + shared channel dashboard routes, against an in-memory table.
 * Only the AWS SDK and Shopify's server (global fetch) are replaced.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

vi.mock("@aws-sdk/client-dynamodb", () => ({ DynamoDBClient: class {} }));
vi.mock("@aws-sdk/lib-dynamodb", async () => import("./helpers/fake-dynamo.js"));
vi.mock("../../middleware/auth.js", () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { userId: "u-1" };
    next();
  },
}));

const fake = await import("./helpers/fake-dynamo.js");
const { config } = await import("../../config.js");
const { camelCaseToSnakeCase } = await import("../../middleware/transform.js");
const { default: channelRoutes } = await import("../../routes/marketplace-channels.js");
const Shopify = await import("../shopify-api.service.js");
const ChannelModel = await import("../../models/marketplace-channel.js");

const shopify = config.shopify as any;
const ajio = config.ajio as any;
let base = "";
let server: any;
const realFetch = globalThis.fetch;

beforeAll(() => {
  const app = express();
  app.use(express.json());
  app.use(camelCaseToSnakeCase);
  app.use("/api", channelRoutes);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(() => server?.close());

beforeEach(() => {
  fake.table.clear();
  shopify.storeDomain = "adventra-test.myshopify.com";
  shopify.accessToken = "shpat_test";
  shopify.isConfigured = true;
  ajio.isConfigured = false;
  vi.unstubAllGlobals();
});

const order = (over: Record<string, unknown> = {}) => ({
  id: "gid://shopify/Order/1001",
  name: "#1001",
  createdAt: "2026-11-10T10:00:00Z",
  cancelledAt: null,
  displayFinancialStatus: "PAID",
  displayFulfillmentStatus: "UNFULFILLED",
  paymentGatewayNames: ["razorpay"],
  currentTotalPriceSet: { shopMoney: { amount: "1499.00", currencyCode: "INR" } },
  totalRefundedSet: { shopMoney: { amount: "0.00" } },
  shippingAddress: { city: "Pune", province: "Maharashtra" },
  lineItems: {
    nodes: [{ sku: "TS-BLK-M", name: "Tee Black / M", quantity: 1, currentQuantity: 1, originalTotalSet: { shopMoney: { amount: "1499.00" } } }],
  },
  fulfillments: [],
  refunds: [],
  ...over,
});

/** A fake Shopify GraphQL endpoint answering by query name. */
function stubShopify(handlers: { orders?: any[]; returns?: any; variants?: any[]; status?: number }) {
  const calls: { url: string; headers: any; body: any }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: any) => {
      if (!String(url).includes("myshopify.com")) return realFetch(url, init);
      const body = JSON.parse(init.body);
      calls.push({ url, headers: init.headers, body });
      if (handlers.status) return new Response("{}", { status: handlers.status });
      const page = { hasNextPage: false, endCursor: null };
      let data: any;
      if (body.query.includes("query Orders(")) data = { orders: { pageInfo: page, nodes: handlers.orders ?? [] } };
      else if (body.query.includes("query OrderReturns(")) {
        if (handlers.returns === "deny")
          return new Response(JSON.stringify({ errors: [{ message: "Access denied for returns field." }] }), { status: 200 });
        data = { orders: { pageInfo: page, nodes: handlers.returns ?? [] } };
      } else data = { productVariants: { pageInfo: page, nodes: handlers.variants ?? [] } };
      return new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  return calls;
}

describe("Shopify order stages", () => {
  it.each([
    [{}, "New"],
    [{ displayFulfillmentStatus: "PARTIALLY_FULFILLED" }, "Processing"],
    [{ displayFulfillmentStatus: "FULFILLED" }, "Shipped"],
    [{ displayFulfillmentStatus: "FULFILLED", fulfillments: [{ displayStatus: "DELIVERED", trackingInfo: [] }] }, "Delivered"],
    [{ cancelledAt: "2026-11-11T00:00:00Z" }, "Cancelled"],
    [{ displayFinancialStatus: "REFUNDED" }, "Returned"],
  ])("%j → %s", (over, stage) => {
    expect(Shopify.shopifyStage(order(over))).toBe(stage);
  });
});

describe("Shopify sync", () => {
  it("stores orders, refunds, returns and stock, sending the access token", async () => {
    const calls = stubShopify({
      orders: [
        order({
          displayFulfillmentStatus: "FULFILLED",
          fulfillments: [{ displayStatus: "IN_TRANSIT", trackingInfo: [{ number: "AWB123", company: "Delhivery" }] }],
          refunds: [{ id: "gid://shopify/Refund/9", createdAt: "2026-11-12T00:00:00Z", note: "Size issue", totalRefundedSet: { shopMoney: { amount: "500.00" } } }],
        }),
      ],
      returns: [{ id: "gid://shopify/Order/1001", name: "#1001", createdAt: "2026-11-10T10:00:00Z", returns: { nodes: [{ id: "gid://shopify/Return/7", name: "#1001-R1", status: "OPEN" }] } }],
      variants: [
        { id: "gid://shopify/ProductVariant/55", sku: "TS-BLK-M", title: "M", displayName: "Tee - Black / M", price: "1499.00", inventoryQuantity: 4, product: { title: "Tee", status: "ACTIVE" } },
      ],
    });

    const state = await Shopify.syncShopify();
    expect(state.lastSyncOk).toBe(true);
    expect(state.counts).toEqual({ orders: 1, inventory: 1, returns: 2 });
    expect(calls[0].url).toBe("https://adventra-test.myshopify.com/admin/api/2026-07/graphql.json");
    expect(calls[0].headers["X-Shopify-Access-Token"]).toBe("shpat_test");

    const [o] = await ChannelModel.listOrders("shopify");
    expect(o).toMatchObject({ orderId: "1001", orderNumber: "#1001", stage: "Shipped", value: 1499, courier: "Delhivery", trackingNumber: "AWB123", state: "Maharashtra" });
    expect(o.items).toEqual([{ sku: "TS-BLK-M", title: "Tee Black / M", quantity: 1, amount: 1499 }]);

    const returns = await ChannelModel.listReturns("shopify");
    expect(returns.map((r) => [r.type, r.status, r.amount])).toEqual(
      expect.arrayContaining([
        ["Refund", "Refunded", 500],
        ["Return", "OPEN", 0],
      ]),
    );
    const [inv] = await ChannelModel.listInventory("shopify");
    expect(inv).toMatchObject({ sku: "TS-BLK-M", quantity: 4, price: 1499, active: true });
  });

  it("re-syncing updates records instead of duplicating them", async () => {
    stubShopify({ orders: [order()] });
    await Shopify.syncShopify();
    stubShopify({ orders: [order({ displayFulfillmentStatus: "FULFILLED" })] });
    await Shopify.syncShopify();
    const orders = await ChannelModel.listOrders("shopify");
    expect(orders).toHaveLength(1);
    expect(orders[0].stage).toBe("Shipped");
  });

  it("still syncs orders and stock when the app lacks the returns scope", async () => {
    stubShopify({ orders: [order()], returns: "deny", variants: [] });
    const state = await Shopify.syncShopify();
    expect(state.lastSyncOk).toBe(true);
    expect(state.lastSyncMessage).toContain("read_returns");
    expect(await ChannelModel.listOrders("shopify")).toHaveLength(1);
  });

  it("records a failed sync with Shopify's reason", async () => {
    stubShopify({ status: 401 });
    const state = await Shopify.syncShopify();
    expect(state.lastSyncOk).toBe(false);
    expect(state.lastSyncMessage).toMatch(/refused the access token/);
    expect((await ChannelModel.getSyncState("shopify")).lastSyncOk).toBe(false);
  });
});

describe("channel dashboard routes", () => {
  it("returns status and synced data for Shopify", async () => {
    stubShopify({ orders: [order()] });
    await Shopify.syncShopify();
    const body = await (await fetch(`${base}/channels/shopify/dashboard`)).json();
    expect(body.status).toMatchObject({ connected: true, can_sync: true, last_sync_ok: true });
    expect(body.orders).toHaveLength(1);
    expect(body.orders[0].order_number).toBe("#1001");
    expect(body.orders[0].pk).toBeUndefined();
  });

  it("AJIO shows not connected, has no data and refuses to sync", async () => {
    const body = await (await fetch(`${base}/channels/ajio/dashboard`)).json();
    expect(body.status).toMatchObject({ connected: false, can_sync: false });
    expect(body.status.not_connected_message).toMatch(/AJIO/);
    expect(body.orders).toEqual([]);
    const sync = await fetch(`${base}/channels/ajio/sync`, { method: "POST" });
    expect(sync.status).toBe(400);
  });

  it("refuses Shopify sync when not connected, and unknown channels", async () => {
    shopify.isConfigured = false;
    expect((await fetch(`${base}/channels/shopify/sync`, { method: "POST" })).status).toBe(400);
    expect((await fetch(`${base}/channels/meesho/dashboard`)).status).toBe(404);
  });
});
