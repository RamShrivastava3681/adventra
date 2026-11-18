/**
 * Myntra integration — drives the real routes, models and API client over
 * HTTP against an in-memory table. Only the AWS SDK and Myntra's own server
 * (global fetch, for the client tests) are replaced.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

vi.mock("@aws-sdk/client-dynamodb", () => ({ DynamoDBClient: class {} }));
vi.mock("@aws-sdk/lib-dynamodb", async () => import("./helpers/fake-dynamo.js"));
// The dashboard routes need a logged-in user; the outbound routes must not.
vi.mock("../../middleware/auth.js", () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { userId: "u-1" };
    next();
  },
}));

const fake = await import("./helpers/fake-dynamo.js");
const { config } = await import("../../config.js");
const { snakeCaseToCamelCase, camelCaseToSnakeCase } = await import("../../middleware/transform.js");
const { default: myntraRoutes } = await import("../../routes/myntra-integration.js");
const MyntraModel = await import("../../models/marketplace-myntra.js");
const Api = await import("../myntra-api.service.js");
const Mockify = await import("../myntra-mockify.service.js");

const myntra = config.myntra as any;
let base = "";
let server: any;

beforeAll(async () => {
  const app = express();
  // Same raw-body capture as server.ts, then the app's global key transforms.
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        if (req.url?.startsWith("/api/myntra/storefront/") || req.url?.startsWith("/api/myntra/failureinventory/")) {
          (req as any).rawBody = buf.toString("utf8");
        }
      },
    }),
  );
  app.use(snakeCaseToCamelCase);
  app.use(camelCaseToSnakeCase);
  app.use("/api", myntraRoutes);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/myntra`;
});
afterAll(() => server?.close());

beforeEach(() => {
  fake.table.clear();
  myntra.outboundToken = "";
  myntra.merchantId = "M1";
  myntra.secretKey = "S1";
  myntra.isConfigured = true;
  myntra.sellerDomain = "https://seller.example.com/api/myntra";
  myntra.mockPushUrl = "";
  myntra.apiDomain = "http://pretrtest-neo.myntapi.com";
  vi.unstubAllGlobals();
});

const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

// Shape taken from Myntra's Postman "Outbound > Create Order" sample.
const orderPayload = {
  receiverName: "Test User",
  city: "Bengaluru",
  stateName: "Karnataka",
  zipcode: "560001",
  paymentMethod: "on",
  sellerOrderId: "SO-1",
  orderId: 9001,
  warehouse: "WH1",
  status: "WP",
  onHold: false,
  amountDue: 2100,
  orderLineEntries: [
    { orderLineId: "L1", sku: "SKU1", quantity: 1, mrp: 1500, lineFinalAmount: 1050 },
    { orderLineId: "L2", sku: "SKU2", quantity: 1, mrp: 1500, lineFinalAmount: 1050 },
  ],
};

describe("outbound APIs (Myntra → us)", () => {
  it("Create Order stores the order and replies in Myntra's format, untouched by snake_case", async () => {
    const res = await send("POST", "/storefront/v4/order/SO-1", orderPayload);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(
      JSON.stringify({ statusCode: 1006, statusMessage: "Order created successfully.", statusType: "SUCCESS" }),
    );
    const order = await MyntraModel.getOrder("SO-1");
    expect(order).toMatchObject({ sellerOrderId: "SO-1", orderId: "9001", warehouse: "WH1", status: "WP", receiverCity: "Bengaluru" });
    expect(order!.orderLines.map((l) => [l.orderLineId, l.sku])).toEqual([
      ["L1", "SKU1"],
      ["L2", "SKU2"],
    ]);
    // Stored exactly as Myntra sent it (camelCase keys preserved).
    expect(JSON.parse(order!.rawPayload)).toEqual(orderPayload);
  });

  it("Create Order is idempotent — a duplicate push also succeeds and keeps one order", async () => {
    await send("POST", "/storefront/v4/order/SO-1", orderPayload);
    const again = await send("POST", "/storefront/v4/order/SO-1", orderPayload);
    expect((await again.json()).statusCode).toBe(1006);
    expect((await MyntraModel.listOrders()).length).toBe(1);
  });

  it("Update Order applies packet-level shipped / delivered and order-level hold events", async () => {
    await send("POST", "/storefront/v4/order/SO-1", orderPayload);
    // After RTD Myntra addresses the packet, not the order.
    let res = await send("PUT", "/storefront/v4/order/PKT-1/shipped", {
      sellerOrderId: "SO-1",
      packetId: "PKT-1",
      trackingNumber: "TRK-1",
      courierCode: "EK",
    });
    expect(await res.json()).toEqual({ statusCode: 1008, statusMessage: "Order updated successfully", statusType: "SUCCESS" });
    let order = await MyntraModel.getOrder("SO-1");
    expect(order).toMatchObject({ status: "SHIPPED", packetId: "PKT-1", trackingNumber: "TRK-1", courierCode: "EK" });

    res = await send("PUT", "/storefront/v4/order/PKT-1/delivered", { eventTime: "2026-11-18 10:00:00" });
    expect(res.status).toBe(200);
    order = await MyntraModel.getOrder("SO-1");
    expect(order!.status).toBe("DELIVERED");

    await send("POST", "/storefront/v4/order/SO-2", { ...orderPayload, sellerOrderId: "SO-2" });
    await send("PUT", "/storefront/v4/order/SO-2/onhold", {});
    expect((await MyntraModel.getOrder("SO-2"))!.onHold).toBe(true);
    await send("PUT", "/storefront/v4/order/SO-2/unhold", {});
    expect((await MyntraModel.getOrder("SO-2"))!.onHold).toBe(false);
  });

  it("ItemCancellation cancels the named lines, and the order once every line is cancelled", async () => {
    await send("POST", "/storefront/v4/order/SO-1", orderPayload);
    await send("PUT", "/storefront/v4/order/SO-1/ItemCancellation", { orderLineEntries: [{ orderLineId: "L1" }] });
    let order = await MyntraModel.getOrder("SO-1");
    expect(order!.orderLines.find((l) => l.orderLineId === "L1")!.status).toBe("CANCELLED");
    expect(order!.status).toBe("WP");
    await send("PUT", "/storefront/v4/order/SO-1/ItemCancellation", { orderLineEntries: [{ orderLineId: "L2" }] });
    order = await MyntraModel.getOrder("SO-1");
    expect(order!.status).toBe("CANCELLED");
  });

  it("Update Order for an unknown order without sellerOrderId is refused", async () => {
    const res = await send("PUT", "/storefront/v4/order/NOPE/shipped", {});
    expect(res.status).toBe(400);
    expect((await res.json()).statusType).toBe("ERROR");
  });

  it("Create Return (RTO and customer) is idempotent and Update Return changes status", async () => {
    const rto = {
      id: 77,
      orderId: 9001,
      returnReferenceId: "RR-1",
      type: "RTO",
      status: "RTO_CREATED",
      sellerOrderId: "SO-1",
      trackingNumber: "TRK-1",
      items: [{ orderLineId: "L1", reason: "Undelivered" }],
      returnWarehouseCode: "WH1",
    };
    let res = await send("POST", "/storefront/v4/return/PKT-1", rto);
    expect(await res.json()).toEqual({ statusCode: 1006, statusMessage: "Return Created Successfully", statusType: "SUCCESS" });
    res = await send("POST", "/storefront/v4/return/PKT-1", rto);
    expect((await res.json()).statusCode).toBe(1006);
    expect((await MyntraModel.listReturns()).length).toBe(1);

    res = await send("PUT", "/storefront/v4/return/77/update", { id: 77, status: "RTO_RECEIVED" });
    expect((await res.json()).statusCode).toBe(1008);
    const ret = await MyntraModel.getReturn("77");
    expect(ret).toMatchObject({ status: "RTO_RECEIVED", type: "RTO", sellerOrderId: "SO-1", reason: "Undelivered" });
    expect(ret!.orderLineIds).toEqual(["L1"]);
  });

  it("Failure Inventory Update keeps Myntra's store_code key and marks the row failed", async () => {
    const res = await send("POST", "/failureinventory/update", [
      { sku: "SKU1", quantity: 10, processingSla: 5, store_code: "MF", remarks: "Invalid SKU, Invalid Warehouse" },
    ]);
    expect((await res.json()).statusCode).toBe(1001);
    const rows = await MyntraModel.listInventory();
    expect(rows).toEqual([
      expect.objectContaining({ sku: "SKU1", storeCode: "MF", quantity: 10, pushStatus: "FAILED", remarks: "Invalid SKU, Invalid Warehouse" }),
    ]);
  });

  it("Download Invoice returns a PDF for a known packet and Myntra's error for an unknown one", async () => {
    await send("POST", "/storefront/v4/order/SO-1", { ...orderPayload, packetId: "PKT-9" });
    const ok = await send("GET", "/storefront/v4/packet/downloadinvoice/PKT-9");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("application/pdf");
    expect(Buffer.from(await ok.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF");
    const missing = await send("GET", "/storefront/v4/packet/downloadinvoice/NOPE");
    expect(missing.status).toBe(404);
  });

  it("requires the access_token header once MYNTRA_OUTBOUND_TOKEN is set", async () => {
    myntra.outboundToken = "secret-token";
    const denied = await send("POST", "/storefront/v4/order/SO-1", orderPayload);
    expect(denied.status).toBe(401);
    expect(await MyntraModel.getOrder("SO-1")).toBeNull();
    const allowed = await send("POST", "/storefront/v4/order/SO-1", orderPayload, { access_token: "secret-token" });
    expect(allowed.status).toBe(200);
  });

  it("logs every call Myntra makes, including refused ones", async () => {
    myntra.outboundToken = "secret-token";
    await send("POST", "/storefront/v4/order/SO-1", orderPayload);
    await new Promise((r) => setTimeout(r, 50));
    const events = await MyntraModel.listEvents();
    expect(events[0]).toMatchObject({ event: "CREATE_ORDER", authorized: false, responseStatus: 401 });
  });
});

describe("Myntra API client (us → Myntra)", () => {
  it("reads tokens from the response headers and sends them as access_token", async () => {
    const calls: { url: string; init: any }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: any) => {
        calls.push({ url, init });
        if (url.endsWith("/authorization/generate_token")) {
          return new Response(JSON.stringify({ statusCode: 200, statusMessage: "Token generated.", statusType: "SUCCESS" }), {
            status: 200,
            headers: { "content-type": "application/json", access_token: "AT-123", refresh_token: "RT-456" },
          });
        }
        return new Response(JSON.stringify({ statusCode: 1001, statusMessage: "Inventory updated successfully", statusType: "SUCCESS" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const r = await Api.updateInventory([{ quantity: 5, sku: "SKU1", processingSla: 3, store_code: "WH1" }]);
    expect(r.ok).toBe(true);
    expect(calls[0].init.headers.secret_key).toBe("S1");
    expect(JSON.parse(calls[0].init.body)).toEqual({ merchant_id: "M1" });
    expect(calls[1].init.headers.access_token).toBe("AT-123");
    expect(calls[1].init.headers["x-partner-store"]).toBe("Myntra");

    // Saved for column D, with the token masked in the stored headers.
    const rows = await Mockify.contractRows();
    const inv = rows.find((x) => x.api === "Update Inventory")!;
    expect(inv.ok).toBe(true);
    expect(inv.response).toContain("Inventory updated successfully");
    const tokenRow = rows.find((x) => x.api === "Generate token")!;
    expect(tokenRow.request).not.toContain("S1");
    const { latest } = await MyntraModel.listApiCalls();
    expect(latest.find((c) => c.api === "Generate token")!.responseHeaders).not.toContain("AT-123");
  });

  it("treats a 200 with statusType ERROR as failed and keeps the last good response for column D", async () => {
    let fail = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify(
            fail
              ? { statusCode: 2007, statusMessage: "Invalid sku", statusType: "ERROR" }
              : { statusCode: 1002, statusMessage: "Inventory retrieved successfully", statusType: "SUCCESS" },
          ),
          { status: 200, headers: { "content-type": "application/json", access_token: "AT" } },
        ),
      ),
    );
    expect((await Api.searchInventory(["SKU1"])).ok).toBe(true);
    fail = true;
    expect((await Api.searchInventory(["BAD"])).ok).toBe(false);
    const row = (await Mockify.contractRows()).find((x) => x.api === "Search Inventory")!;
    expect(row.usedLastOk).toBe(true);
    expect(row.response).toContain("Inventory retrieved successfully");
  });

  it("exports the contract sheet in Myntra's layout with every column A row", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await Mockify.contractWorkbook());
    const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    expect(rows[0]).toEqual(["API", "Request", "Comments", "Response"]);
    expect(rows.slice(1).map((r) => r[0])).toEqual(Mockify.CONTRACT_ROWS);
    const assignment = rows.find((r) => r[0] === "Assignment Update")!;
    expect(assignment[3]).toContain("Not available currently");
  });

  it("refuses to start a Mockify run without a public seller domain", () => {
    myntra.sellerDomain = "";
    expect(() => Mockify.startRun()).toThrow(/MYNTRA_SELLER_DOMAIN/);
  });
});
