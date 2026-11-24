/**
 * Runs Myntra's Neo-Mockify test flow (mockify_guide.pdf) against the real
 * stage system and records every response, so column D ("Response") of the
 * "Mockify Contracts" sheet can be filled with genuine results.
 *
 * Flow (as in the guide):
 *   Data preparation: token → SKU + warehouse → inventory (+ discount, expiry)
 *   Order processing: create → get → accept/reject → RTD → invoice / label
 *   Post-pack events:  shipped → delivered (and lost)
 *   Return journey:    customer return / RTV, courier return / RTO, updates
 *
 * Nothing is simulated here: a step either gets a real response from Myntra
 * or is reported as failed / skipped with the reason.
 */
import * as XLSX from "xlsx";
import { config } from "../config.js";
import * as Api from "./myntra-api.service.js";
import * as MyntraModel from "../models/marketplace-myntra.js";

/** Column A of Myntra's contract sheet, in sheet order. */
export const CONTRACT_ROWS: string[] = [
  "Generate token",
  "Refresh Token",
  "Update Inventory",
  "Update Async Inventory",
  "Failed Async Inventory Acknowledgement",
  "Search Inventory",
  "Discount",
  "Update Expiry",
  "Create order",
  "Accept order",
  "Reject Order",
  "Ready To Dispatch Myntra generated invoice RTD",
  "Ready To Dispatch Seller generated invoice",
  "Ready To Ship",
  "Get Order by Id",
  "Get Order by Packet Id",
  "Get Invoice Details",
  "Download Invoice Inbound",
  "Download Shipping Label",
  "Shipped",
  "Delivered",
  "Lost",
  "Customer Item Cancellation",
  "OnHold",
  "UnHold",
  "Assignment Update",
  "Courier Return / Closed Box Return / RTO",
  "Customer Return / RTV",
  "RTO Update Returns",
  "RTV Update Returns",
  "VFS Seller cancellation",
  "To add / update SKU",
  "Add / update Warehouse",
];

/** Rows Myntra marked as unavailable in the sheet itself. */
const NOT_AVAILABLE: Record<string, string> = {
  "Assignment Update": "Not available currently (marked by Myntra in the contract sheet)",
};

export interface StepResult {
  scenario: string;
  api: string;
  status: "ok" | "failed" | "skipped";
  httpStatus: number | null;
  note: string;
  at: string;
}

export interface RunState {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  steps: StepResult[];
  error: string | null;
  orders: Record<string, string>;
}

let state: RunState = { running: false, startedAt: null, finishedAt: null, steps: [], error: null, orders: {} };

export const getRunState = (): RunState => state;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function pad(n: number) {
  return String(n).padStart(2, "0");
}
/** dd-MM-yyyy HH:mm:ss in IST (Myntra date format). */
function myntraDateTime(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000 + 5.5 * 3600000);
  return `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(
    d.getUTCMinutes(),
  )}:${pad(d.getUTCSeconds())}`;
}
function isoDate(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

function summarize(r: Api.MyntraCallResult): string {
  if (r.error) return r.error;
  const msg = r.json?.statusMessage ?? r.json?.message;
  return msg ? String(msg) : r.text.slice(0, 160);
}

export interface RunOptions {
  skus?: string[];
  warehouses?: string[];
}

export function preflight(): string[] {
  const problems: string[] = [];
  if (!config.myntra.isConfigured) problems.push("Set MYNTRA_MERCHANT_ID and MYNTRA_SECRET_KEY in backend/.env.");
  if (!config.myntra.sellerDomain && !config.myntra.mockPushUrl)
    problems.push(
      "Set MYNTRA_SELLER_DOMAIN (public URL of our outbound API, e.g. https://adventra.whizunikhub.com/api/myntra) so Mockify can push orders to us.",
    );
  return problems;
}

/** Runs the whole flow and resolves when it is finished. */
export async function runToCompletion(opts: RunOptions = {}): Promise<RunState> {
  if (state.running) throw new Error("A Mockify test run is already in progress");
  const problems = preflight();
  if (problems.length) throw new Error(problems.join(" "));
  state = { running: true, startedAt: new Date().toISOString(), finishedAt: null, steps: [], error: null, orders: {} };
  try {
    await runAll(opts);
  } catch (err: any) {
    state.error = String(err?.message ?? err);
  } finally {
    state.running = false;
    state.finishedAt = new Date().toISOString();
  }
  return state;
}

/** Starts the flow in the background (the result is read with getRunState). */
export function startRun(opts: RunOptions = {}): RunState {
  const problems = preflight();
  if (problems.length) throw new Error(problems.join(" "));
  if (state.running) throw new Error("A Mockify test run is already in progress");
  void runToCompletion(opts);
  return state;
}

async function runAll(opts: RunOptions) {
  // Defaults are the SKUs / stores Myntra's sheet says to use when none were shared.
  const skus = opts.skus?.length ? opts.skus : ["SKU1", "SKU2", "SKU3"];
  const warehouses = opts.warehouses?.length ? opts.warehouses : ["WH1", "WH2", "WH3"];
  const wh = warehouses[0];

  let scenario = "Data preparation";
  const record = (api: string, status: StepResult["status"], httpStatus: number | null, note: string) => {
    state.steps.push({ scenario, api, status, httpStatus, note, at: new Date().toISOString() });
  };
  const step = async (r: Promise<Api.MyntraCallResult>) => {
    const res = await r;
    record(res.api, res.ok ? "ok" : "failed", res.httpStatus, summarize(res));
    return res;
  };
  /**
   * Mockify's order state is not consistent between requests (the same order
   * is sometimes "not found" a second later), so order actions are retried a
   * few times before the result is recorded.
   */
  const stepRetry = async (call: () => Promise<Api.MyntraCallResult>, tries = 5) => {
    let res = await call();
    for (let i = 1; i < tries && !res.ok; i++) {
      await sleep(4000);
      res = await call();
    }
    record(res.api, res.ok ? "ok" : "failed", res.httpStatus, summarize(res));
    return res;
  };
  /** Our outbound URL for an order event, with the real id in the path as Myntra sends it. */
  const orderEvent = (id: string, event: string) =>
    Api.outboundEndpoint(`/storefront/v4/order/${encodeURIComponent(id)}/${event}`, "PUT");
  const skip = (api: string, why: string) => record(api, "skipped", null, why);

  // ── Data preparation ──
  const token = await step(Api.generateToken());
  if (!token.ok) {
    state.error = "Token generation failed — check merchant id / secret key and that Myntra whitelisted our server IP.";
    return;
  }
  await step(Api.refreshAccessToken());
  await step(Api.addOrUpdateSkus(skus.map((sku) => ({ sku, price: 1000 }))));
  await step(Api.addOrUpdateWarehouses(warehouses.map((warehouseName) => ({ warehouseName, skus }))));
  const invEntries = skus
    .flatMap((sku) => warehouses.map((store_code) => ({ quantity: 100, sku, processingSla: 3, store_code })))
    .slice(0, 10); // Myntra batch limit
  const inv = await step(Api.updateInventory(invEntries));
  if (inv.ok) {
    for (const e of invEntries) {
      await MyntraModel.saveInventory({
        sku: e.sku,
        storeCode: e.store_code,
        quantity: e.quantity,
        processingSla: e.processingSla,
        source: "pushed",
        pushStatus: "SUCCESS",
        remarks: null,
      });
    }
  }
  await step(
    Api.updateInventoryAsync([{ quantity: 60, sku: skus[0], processingSla: 5, store_code: warehouses[warehouses.length - 1] }]),
  );
  await step(Api.failedAsyncInventoryAck(Api.outboundEndpoint("/failureinventory/update", "POST")));
  await step(Api.searchInventory(skus));
  await step(
    Api.overrideDiscount({
      startDate: myntraDateTime(0),
      endDate: myntraDateTime(30),
      discountType: "FlatPercent",
      discountEntries: [{ sku: skus[0], discount: 20 }],
    }),
  );
  await step(Api.updateExpiry([{ sku: skus[0], expiryDate: isoDate(365) }]));

  // ── Order helpers ──
  const createOrder = async (label: string, orderSkus: string[]) => {
    const res = await step(
      Api.mockCreateOrder({
        endpoint: Api.outboundEndpoint("/storefront/v4/order/mockify", "POST"),
        skus: orderSkus,
        warehouse: wh,
        processingTime: 10,
      }),
    );
    const id = Api.deepFind(res.json, ["sellerOrderId"]);
    if (!id) {
      skip(`${label}: rest of scenario`, "Create order returned no sellerOrderId");
      return null;
    }
    state.orders[label] = String(id);
    await sleep(3000); // let Mockify finish pushing the order to us
    return String(id);
  };

  interface LoadedOrder {
    lineIds: string[];
    packetId: string | null;
    trackingNumber: string | null;
    /** Line status as Myntra reports it, e.g. "AS" (assigned, not yet accepted). */
    lineStatus: string | null;
  }
  const readOrder = (json: Api.Json): LoadedOrder => {
    const packetId = Api.deepFind(json, ["packetId"]);
    const trackingNumber = Api.deepFind(json, ["trackingNumber"]);
    const lineStatus = Api.deepFind(json?.orderLineEntries?.[0] ?? null, ["status_code", "statusCode", "status"]);
    return {
      lineIds: Api.findOrderLineIds(json),
      packetId: packetId ? String(packetId) : null,
      trackingNumber: trackingNumber ? String(trackingNumber) : null,
      lineStatus: lineStatus ? String(lineStatus) : null,
    };
  };

  /**
   * Mockify processes orders asynchronously: a new order is not retrievable
   * for a few seconds, and accept / RTD change its status a little later.
   * Poll Get Order until `until` holds (or ~45 s pass), then record one step.
   */
  const loadOrder = async (sellerOrderId: string, until?: (o: LoadedOrder) => boolean) => {
    const deadline = Date.now() + 45_000;
    let res: Api.MyntraCallResult;
    let o: LoadedOrder;
    for (;;) {
      res = await Api.getOrder(sellerOrderId);
      o = readOrder(res.json);
      if (res.ok && o.lineIds.length && (!until || until(o))) break;
      if (Date.now() > deadline) break;
      await sleep(3000);
    }
    record(res.api, res.ok ? "ok" : "failed", res.httpStatus, summarize(res));
    let { lineIds, packetId, trackingNumber } = o;
    if (!lineIds.length || !packetId) {
      // Fall back to what Mockify pushed to our outbound API.
      const stored = await MyntraModel.getOrder(sellerOrderId);
      if (stored) {
        if (!lineIds.length) lineIds = stored.orderLines.map((l) => l.orderLineId);
        packetId = packetId ?? stored.packetId ?? null;
        trackingNumber = trackingNumber ?? stored.trackingNumber ?? null;
      }
    }
    return {
      lineIds,
      packetId: packetId ? String(packetId) : null,
      trackingNumber: trackingNumber ? String(trackingNumber) : null,
      lineStatus: o.lineStatus,
    };
  };
  const accepted = (o: LoadedOrder) => Boolean(o.lineStatus && o.lineStatus.toUpperCase() !== "AS");
  const packed = (o: LoadedOrder) => Boolean(o.packetId);

  const lineEntries = (id: string, lineIds: string[]) => lineIds.map((orderLineId) => ({ sellerOrderId: id, orderLineId }));
  const sellerInvoice = (id: string, lineIds: string[]) =>
    lineIds.map((orderLineId, i) => ({
      sellerOrderId: id,
      orderLineId,
      invoiceNumber: `WZMYN${Date.now()}${i}`,
      invoiceDate: myntraDateTime(0),
      unitTotalAmount: 1050.0,
      taxEntries: [
        { taxRate: 2.5, taxType: "CGST", unitTaxAmount: 25.0, unitTaxableAmount: 1000.0 },
        { taxRate: 2.5, taxType: "SGST", unitTaxAmount: 25.0, unitTaxableAmount: 1000.0 },
      ],
    }));

  /** Create → load → accept → wait until accepted. Returns the order or null. */
  const acceptedOrder = async (label: string, orderSkus: string[]) => {
    // Mockify sometimes never lets an order be accepted; start a fresh one then.
    for (let attempt = 1; attempt <= 3; attempt++) {
      const id = await createOrder(label, orderSkus);
      if (!id) return null;
      const o = await loadOrder(id);
      if (!o.lineIds.length) continue;
      const acc = await stepRetry(() => Api.acceptOrder(id, wh, o.lineIds));
      if (!acc.ok) continue;
      await loadOrder(id, accepted);
      return { id, lineIds: o.lineIds };
    }
    skip("Accept order", `Order ${label} could not be accepted after 3 fresh orders`);
    return null;
  };

  // ── Scenario A: happy path, Myntra-generated invoice, delivered, customer return ──
  scenario = "Order A – accept, RTD (Myntra invoice), ship, deliver, customer return";
  const a = await acceptedOrder("A", skus.slice(0, 2));
  if (a) {
    await stepRetry(() => Api.readyToDispatchMyntraInvoice(wh, lineEntries(a.id, a.lineIds)));
    const o = await loadOrder(a.id, packed);
    if (!o.packetId) skip("Get Order by Packet Id", "No packetId after Ready To Dispatch");
    else {
      await sleep(5000); // let Mockify finish building the packet
      const packet = await stepRetry(() => Api.getPacket(o.packetId!));
      const tracking = o.trackingNumber ?? Api.deepFind(packet.json, ["trackingNumber"]) ?? null;
      await stepRetry(() => Api.getInvoiceDetails(o.packetId!));
      await stepRetry(() => Api.downloadInvoice(o.packetId!));
      await stepRetry(() => Api.downloadShippingLabel(o.packetId!));
      if (tracking) await stepRetry(() => Api.readyToShip(String(tracking)));
      else skip("Ready To Ship", "No tracking number on packet");
      await stepRetry(() => Api.mockShipped(o.packetId!, orderEvent(a.id, "shipped")));
      await sleep(3000);
      await stepRetry(() => Api.mockDelivered(o.packetId!, orderEvent(a.id, "delivered")));
      await sleep(3000);
      const ret = await stepRetry(() =>
        Api.mockCustomerReturn(a.id, a.lineIds[0], Api.outboundEndpoint(`/storefront/v4/return/${a.id}-${a.lineIds[0]}`, "POST")),
      );
      const returnId = Api.deepFind(ret.json, ["returnId", "id", "returnReferenceId"]);
      if (returnId)
        await stepRetry(() =>
          Api.mockRtvUpdate(String(returnId), Api.outboundEndpoint(`/storefront/v4/return/${returnId}/update`, "PUT")),
        );
      else skip("RTV Update Returns", "Customer return gave no returnId");
    }
  }

  // ── Scenario B: reject ──
  scenario = "Order B – reject";
  const b = await createOrder("B", [skus[0]]);
  if (b) {
    const o = await loadOrder(b);
    if (o.lineIds.length) await stepRetry(() => Api.rejectOrder(b, wh, o.lineIds, 3));
    else skip("Reject Order", "No orderLineIds found for order B");
  }

  // ── Scenario C: seller-generated invoice, shipped, courier return / RTO ──
  scenario = "Order C – RTD (seller invoice), ship, RTO";
  const c = await acceptedOrder("C", [skus[1] ?? skus[0]]);
  if (c) {
    await stepRetry(() => Api.readyToDispatchSellerInvoice(wh, sellerInvoice(c.id, c.lineIds)));
    const o = await loadOrder(c.id, packed);
    if (o.packetId) {
      await stepRetry(() => Api.mockShipped(o.packetId!, orderEvent(c.id, "shipped")));
      await sleep(3000);
      await stepRetry(() => Api.mockCourierReturn(o.packetId!, Api.outboundEndpoint(`/storefront/v4/return/${o.packetId}`, "POST")));
      await stepRetry(() => Api.mockRtoUpdate(o.packetId!, Api.outboundEndpoint(`/storefront/v4/return/${o.packetId}/update`, "PUT")));
    } else skip("Courier Return / Closed Box Return / RTO", "No packetId after Ready To Dispatch for order C");
  }

  // ── Scenario D: lost in transit ──
  scenario = "Order D – ship, lost";
  const d = await acceptedOrder("D", [skus[0]]);
  if (d) {
    await stepRetry(() => Api.readyToDispatchMyntraInvoice(wh, lineEntries(d.id, d.lineIds)));
    const o = await loadOrder(d.id, packed);
    if (o.packetId) {
      await stepRetry(() => Api.mockShipped(o.packetId!, orderEvent(d.id, "shipped")));
      await stepRetry(() => Api.mockLost(o.packetId!, orderEvent(d.id, "lost")));
    } else skip("Lost", "No packetId for order D");
  }

  // ── Scenario E: on hold, un-hold, customer cancellation ──
  scenario = "Order E – on hold, un-hold, customer cancellation";
  const e = await acceptedOrder("E", skus.slice(0, 2));
  if (e) {
    await stepRetry(() => Api.mockOnHold(e.id, orderEvent(e.id, "onhold")));
    await stepRetry(() => Api.mockUnHold(e.id, orderEvent(e.id, "unhold")));
    await stepRetry(() => Api.mockItemCancellation(e.id, [e.lineIds[0]], orderEvent(e.id, "ItemCancellation")));
  }

  // ── Scenario F: seller cancellation ──
  scenario = "Order F – seller cancellation";
  const f = await acceptedOrder("F", [skus[0]]);
  if (f) {
    await stepRetry(() => Api.sellerCancelItems(f.id, [{ orderLineId: f.lineIds[0], comment: "Seller cancellation test" }]));
  }

  scenario = "Not available";
  for (const [api, why] of Object.entries(NOT_AVAILABLE)) skip(api, why);
}

// ── Contract sheet (column D) ────────────────────────────────────────────────

export interface ContractRow {
  api: string;
  method: string | null;
  url: string | null;
  request: string;
  response: string;
  httpStatus: number | null;
  ok: boolean | null;
  calledAt: string | null;
  usedLastOk: boolean;
  note: string | null;
}

function curlOf(call: MyntraModel.MyntraApiCall): string {
  const parts = [`curl --location --request ${call.method} '${call.url}'`];
  parts.push(`--header 'Content-Type: application/json'`);
  if (call.api !== "Generate token" && call.api !== "Refresh Token") parts.push(`--header 'access_token: << ACCESS TOKEN >>'`);
  if (call.requestBody) parts.push(`--data-raw '${call.requestBody}'`);
  return parts.join(" \\\n");
}

function responseText(call: MyntraModel.MyntraApiCall): string {
  const body = call.error ? `ERROR: ${call.error}` : call.responseBody;
  let pretty = body;
  try {
    pretty = JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    /* not JSON — keep as received */
  }
  const head = `HTTP ${call.httpStatus ?? "no response"}`;
  // Excel cell limit is 32,767 characters.
  return `${head}\n${pretty}`.slice(0, 32000);
}

export async function contractRows(): Promise<ContractRow[]> {
  const { latest, lastOk } = await MyntraModel.listApiCalls();
  const byApi = (list: MyntraModel.MyntraApiCall[]) => new Map(list.map((c) => [c.api, c]));
  const ok = byApi(lastOk);
  const last = byApi(latest);
  return CONTRACT_ROWS.map((api) => {
    const call = ok.get(api) ?? last.get(api);
    if (!call) {
      return {
        api,
        method: null,
        url: null,
        request: "",
        response: "",
        httpStatus: null,
        ok: null,
        calledAt: null,
        usedLastOk: false,
        note: NOT_AVAILABLE[api] ?? null,
      };
    }
    return {
      api,
      method: call.method,
      url: call.url,
      request: curlOf(call),
      response: responseText(call),
      httpStatus: call.httpStatus,
      ok: call.ok,
      calledAt: call.calledAt,
      usedLastOk: ok.has(api),
      note: NOT_AVAILABLE[api] ?? null,
    };
  });
}

/** Workbook in the same layout as Myntra's sheet: API | Request | Comments | Response. */
export async function contractWorkbook(): Promise<Buffer> {
  const rows = await contractRows();
  const aoa: (string | null)[][] = [["API", "Request", "Comments", "Response"]];
  for (const r of rows) {
    aoa.push([r.api, r.request, r.note ?? "", r.response || (r.note ? r.note : "Not called yet")]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 34 }, { wch: 80 }, { wch: 40 }, { wch: 90 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Mockify Contracts");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
