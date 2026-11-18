/**
 * Myntra integration routes.
 *
 * 1. OUTBOUND APIs (Myntra → WhizUnik). These are the "outbound API URLs"
 *    Myntra asks for during OMS onboarding (Postman: Myntra Seller API V4 →
 *    Outbound). Base = MYNTRA_SELLER_DOMAIN = https://<host>/api/myntra
 *      POST     {base}/storefront/v4/order/:sellerOrderId                Create Order
 *      PUT      {base}/storefront/v4/order/:sellerOrderId/:eventType     Update Order
 *      GET      {base}/storefront/v4/packet/downloadinvoice/:packetId    Download Invoice
 *      POST     {base}/failureinventory/update                           Failure Inventory Update
 *      POST     {base}/storefront/v4/return/:packetIdOrReturnId          Create Return (RTO / customer)
 *      PUT      {base}/storefront/v4/return/:returnId/update             Update Return
 *    Myntra authenticates with the `access_token` header (MYNTRA_OUTBOUND_TOKEN).
 *    Replies use Myntra's own format { statusCode, statusMessage, statusType }
 *    and bypass the app's snake_case response transform.
 *
 * 2. DASHBOARD APIs (logged-in users): status, orders, returns, inventory,
 *    events, seller actions (accept / reject / RTD) and invoice / label PDFs.
 *
 * The Mockify contract test (column D of Myntra's sheet) is a backend command:
 * `npm run myntra:mockify` — see scripts/myntra-mockify.ts.
 */
import { Router, Request, Response } from "express";
import crypto from "node:crypto";
import PDFDocument from "pdfkit";
import { authMiddleware } from "../middleware/auth.js";
import { config } from "../config.js";
import * as MyntraModel from "../models/marketplace-myntra.js";
import * as Api from "../services/myntra-api.service.js";

const router = Router();

// ════════════════════════════ OUTBOUND (Myntra → us) ════════════════════════

type MyntraReply = { statusCode: number; statusMessage: string; statusType: "SUCCESS" | "ERROR" };

/** Send Myntra-format JSON without the global camelCase→snake_case transform. */
function reply(res: Response, http: number, body: MyntraReply) {
  res.status(http).type("application/json").send(JSON.stringify(body));
  return body;
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Myntra must send our token in `access_token` once MYNTRA_OUTBOUND_TOKEN is set. */
function isAuthorized(req: Request): boolean {
  const expected = config.myntra.outboundToken;
  if (!expected) return true;
  const got = String(req.headers["access_token"] ?? req.headers["access-token"] ?? "");
  return got.length > 0 && safeEqual(got, expected);
}

/** Body exactly as Myntra sent it (keys untouched). */
function originalBody(req: Request): { raw: string; json: any } {
  const raw: string = (req as any).rawBody ?? (req.body ? JSON.stringify(req.body) : "");
  let json: any = req.body;
  if ((req as any).rawBody) {
    try {
      json = JSON.parse((req as any).rawBody);
    } catch {
      json = req.body;
    }
  }
  return { raw, json: json ?? {} };
}

const num = (v: any): number | null => (v === undefined || v === null || v === "" || isNaN(Number(v)) ? null : Number(v));
const str = (v: any): string | null => (v === undefined || v === null || v === "" ? null : String(v));

function linesFrom(payload: any, existing: MyntraModel.MyntraOrderLine[] = []): MyntraModel.MyntraOrderLine[] {
  const entries: any[] = Array.isArray(payload?.orderLineEntries) ? payload.orderLineEntries : [];
  if (!entries.length) return existing;
  const byId = new Map(existing.map((l) => [l.orderLineId, l]));
  for (const e of entries) {
    const id = str(e.orderLineId ?? e.id);
    if (!id) continue;
    const prev = byId.get(id);
    byId.set(id, {
      orderLineId: id,
      sku: str(e.sku) ?? prev?.sku ?? "",
      quantity: num(e.quantity) ?? prev?.quantity ?? 1,
      status: str(e.status) ?? prev?.status ?? null,
      mrp: num(e.mrp) ?? prev?.mrp ?? null,
      lineFinalAmount: num(e.lineFinalAmount) ?? prev?.lineFinalAmount ?? null,
      invoiceNumber: str(e.invoiceNumber) ?? prev?.invoiceNumber ?? null,
    });
  }
  return [...byId.values()];
}

/** Wraps an outbound handler: auth, event log, Myntra-format error replies. */
function outbound(event: string, handler: (req: Request, res: Response, payload: { raw: string; json: any }) => Promise<MyntraReply | void>) {
  return async (req: Request, res: Response) => {
    const payload = originalBody(req);
    const authorized = isAuthorized(req);
    let body: MyntraReply | void;
    let http = 200;
    try {
      if (!authorized) {
        http = 401;
        body = reply(res, 401, { statusCode: 401, statusMessage: "Unauthenticated", statusType: "ERROR" });
      } else {
        body = await handler(req, res, payload);
        http = res.statusCode;
      }
    } catch (err: any) {
      console.error(`[myntra] outbound ${event} failed:`, err?.message);
      http = 500;
      const updating = /UPDATE|SHIPPED|DELIVERED|CANCEL|HOLD|LOST/.test(event);
      body = reply(res, 500, {
        statusCode: updating ? 3002 : 3001,
        statusMessage: updating ? "Error while updating order/return" : "Error while creating order/return",
        statusType: "ERROR",
      });
    }
    MyntraModel.logEvent({
      event,
      method: req.method,
      path: req.originalUrl,
      authorized,
      responseStatus: http,
      responseBody: body ? JSON.stringify(body) : `<${res.getHeader("content-type") ?? "file"}>`,
      rawPayload: payload.raw.slice(0, 350_000),
    }).catch((e) => console.error("[myntra] failed to log event:", e?.message));
  };
}

// Create Order — idempotent: a duplicate push also returns success.
router.post(
  "/myntra/storefront/v4/order/:sellerOrderId",
  outbound("CREATE_ORDER", async (req, res, { raw, json }) => {
    const sellerOrderId = str(json.sellerOrderId) ?? req.params.sellerOrderId;
    const existing = await MyntraModel.getOrder(sellerOrderId);
    await MyntraModel.saveOrder({
      sellerOrderId,
      orderId: str(json.orderId ?? json.id) ?? existing?.orderId ?? null,
      packetId: str(json.packetId) ?? existing?.packetId ?? null,
      warehouse: str(json.warehouse) ?? existing?.warehouse ?? null,
      status: str(json.status) ?? existing?.status ?? "CREATED",
      onHold: Boolean(json.onHold ?? existing?.onHold ?? false),
      orderDate: str(json.orderDate ?? json.createdOn) ?? existing?.orderDate ?? null,
      paymentMethod: str(json.paymentMethod) ?? existing?.paymentMethod ?? null,
      amountDue: num(json.amountDue ?? json.totalPaymentReceived) ?? existing?.amountDue ?? null,
      courierCode: str(json.courierCode) ?? existing?.courierCode ?? null,
      trackingNumber: str(json.trackingNumber) ?? existing?.trackingNumber ?? null,
      receiverCity: str(json.city) ?? existing?.receiverCity ?? null,
      receiverState: str(json.stateName ?? json.state) ?? existing?.receiverState ?? null,
      receiverZipcode: str(json.zipcode) ?? existing?.receiverZipcode ?? null,
      orderLines: linesFrom(json, existing?.orderLines),
      lastEvent: "CREATE_ORDER",
      rawPayload: raw.slice(0, 350_000),
      createdAt: existing?.createdAt,
    });
    return reply(res, 200, { statusCode: 1006, statusMessage: "Order created successfully.", statusType: "SUCCESS" });
  }),
);

const EVENT_STATUS: Record<string, string> = {
  shipped: "SHIPPED",
  delivered: "DELIVERED",
  lost: "LOST",
};

// Update Order — itemCancellation, onhold, unhold, shipped, delivered, lost,
// trackingNumberUpdate, repromise, itemBlock, itemNsts, itemXPacked, assignmentUpdate.
const updateOrder = outbound("UPDATE_ORDER", async (req, res, { raw, json }) => {
  const eventType = String(req.params.eventType ?? "");
  const ev = eventType.toLowerCase();
  // Before RTD calls are order based; after RTD they are packet based.
  const idFromBody = str(json.sellerOrderId);
  const packetFromBody = str(json.packetId);
  let order =
    (idFromBody && (await MyntraModel.getOrder(idFromBody))) ||
    (await MyntraModel.getOrder(req.params.sellerOrderId)) ||
    (packetFromBody && (await MyntraModel.findOrderByPacket(packetFromBody))) ||
    (await MyntraModel.findOrderByPacket(req.params.sellerOrderId));

  if (!order) {
    const sellerOrderId = idFromBody;
    if (!sellerOrderId) {
      return reply(res, 400, { statusCode: 2020, statusMessage: "Order not found", statusType: "ERROR" });
    }
    // Update for an order we never received: keep it, built from this payload.
    order = await MyntraModel.saveOrder({
      sellerOrderId,
      status: "CREATED",
      orderLines: [],
      rawPayload: raw.slice(0, 350_000),
    });
  }

  const lines = linesFrom(json, order.orderLines);
  let status = str(json.status) ?? EVENT_STATUS[ev] ?? order.status;
  let onHold = order.onHold ?? false;
  if (ev === "onhold") onHold = true;
  if (ev === "unhold") onHold = false;
  if (ev === "itemcancellation") {
    const cancelled = new Set(
      (Array.isArray(json.orderLineEntries) ? json.orderLineEntries : [])
        .map((e: any) => str(e.orderLineId))
        .concat(Array.isArray(json.orderLineIds) ? json.orderLineIds.map(String) : [])
        .filter(Boolean),
    );
    for (const l of lines) if (cancelled.has(l.orderLineId)) l.status = "CANCELLED";
    if (lines.length && lines.every((l) => l.status === "CANCELLED")) status = "CANCELLED";
  }

  await MyntraModel.saveOrder({
    ...order,
    packetId: packetFromBody ?? order.packetId ?? null,
    trackingNumber: str(json.trackingNumber) ?? order.trackingNumber ?? null,
    courierCode: str(json.courierCode) ?? order.courierCode ?? null,
    warehouse: str(json.warehouse) ?? order.warehouse ?? null,
    status,
    onHold,
    orderLines: lines,
    lastEvent: eventType,
    rawPayload: raw.slice(0, 350_000),
  });
  return reply(res, 200, { statusCode: 1008, statusMessage: "Order updated successfully", statusType: "SUCCESS" });
});
router.put("/myntra/storefront/v4/order/:sellerOrderId/:eventType", updateOrder);
router.post("/myntra/storefront/v4/order/:sellerOrderId/:eventType", updateOrder);

// Download Invoice — PDF byte stream for the packet.
router.get(
  "/myntra/storefront/v4/packet/downloadinvoice/:packetId",
  outbound("DOWNLOAD_INVOICE", async (req, res) => {
    const order = await MyntraModel.findOrderByPacket(req.params.packetId);
    if (!order) return reply(res, 404, { statusCode: 2020, statusMessage: "Error retrieving order", statusType: "ERROR" });
    const pdf = await invoicePdf(order);
    res.status(200).type("application/pdf").setHeader("Content-Disposition", `inline; filename="invoice-${req.params.packetId}.pdf"`);
    res.send(pdf);
  }),
);

// Failure Inventory Update — async inventory entries Myntra could not apply.
router.post(
  "/myntra/failureinventory/update",
  outbound("FAILURE_INVENTORY", async (_req, res, { json }) => {
    const entries: any[] = Array.isArray(json) ? json : Array.isArray(json?.failedEntries) ? json.failedEntries : [];
    for (const e of entries) {
      const sku = str(e.sku);
      const storeCode = str(e.store_code ?? e.storeCode);
      if (!sku || !storeCode) continue;
      await MyntraModel.saveInventory({
        sku,
        storeCode,
        quantity: num(e.quantity),
        processingSla: num(e.processingSla),
        source: "pushed",
        pushStatus: "FAILED",
        remarks: str(e.remarks),
      });
    }
    return reply(res, 200, { statusCode: 1001, statusMessage: "Inventory updated successfully", statusType: "SUCCESS" });
  }),
);

function returnFields(json: any, key: string, existing?: MyntraModel.MyntraReturn | null) {
  const items: any[] = Array.isArray(json.items) ? json.items : [];
  const lineIds = items.map((i) => str(i.orderLineId)).filter(Boolean) as string[];
  if (json.orderLineId) lineIds.push(String(json.orderLineId));
  return {
    returnKey: key,
    returnId: str(json.id ?? json.returnId) ?? existing?.returnId ?? null,
    returnReferenceId: str(json.returnReferenceId) ?? existing?.returnReferenceId ?? null,
    type: str(json.type) ?? existing?.type ?? null,
    status: str(json.status) ?? existing?.status ?? null,
    sellerOrderId: str(json.sellerOrderId) ?? existing?.sellerOrderId ?? null,
    orderId: str(json.orderId) ?? existing?.orderId ?? null,
    trackingNumber: str(json.trackingNumber) ?? existing?.trackingNumber ?? null,
    reason: str(json.reason ?? items[0]?.reason) ?? existing?.reason ?? null,
    returnWarehouseCode: str(json.returnWarehouseCode) ?? existing?.returnWarehouseCode ?? null,
    orderLineIds: lineIds.length ? [...new Set(lineIds)] : existing?.orderLineIds ?? [],
  };
}

/** Our key for a return: Myntra's id when given, else the path id. */
function returnKeyFor(json: any, pathId: string) {
  return str(json.id ?? json.returnId ?? json.returnReferenceId) ?? pathId;
}

// Create Return (RTO by packetId, customer return by returnId) — idempotent.
router.post(
  "/myntra/storefront/v4/return/:id",
  outbound("CREATE_RETURN", async (req, res, { raw, json }) => {
    const key = returnKeyFor(json, req.params.id);
    const existing = await MyntraModel.getReturn(key);
    await MyntraModel.saveReturn({
      ...returnFields(json, key, existing),
      rawPayload: raw.slice(0, 350_000),
      createdAt: existing?.createdAt,
    });
    return reply(res, 200, { statusCode: 1006, statusMessage: "Return Created Successfully", statusType: "SUCCESS" });
  }),
);

const updateReturn = outbound("UPDATE_RETURN", async (req, res, { raw, json }) => {
  const key = returnKeyFor(json, req.params.id);
  const existing = await MyntraModel.getReturn(key);
  await MyntraModel.saveReturn({
    ...returnFields(json, key, existing),
    rawPayload: raw.slice(0, 350_000),
    createdAt: existing?.createdAt,
  });
  return reply(res, 200, { statusCode: 1008, statusMessage: "Return updated successfully", statusType: "SUCCESS" });
});
router.put("/myntra/storefront/v4/return/:id/update", updateReturn);
router.post("/myntra/storefront/v4/return/:id/update", updateReturn);

function invoicePdf(order: MyntraModel.MyntraOrder): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(16).text("Tax Invoice", { align: "center" }).moveDown();
    doc.fontSize(10);
    doc.text(`Seller order: ${order.sellerOrderId}`);
    if (order.orderId) doc.text(`Myntra order: ${order.orderId}`);
    if (order.packetId) doc.text(`Packet: ${order.packetId}`);
    if (order.warehouse) doc.text(`Dispatch warehouse: ${order.warehouse}`);
    if (order.orderDate) doc.text(`Order date: ${order.orderDate}`);
    const ship = [order.receiverCity, order.receiverState, order.receiverZipcode].filter(Boolean).join(", ");
    if (ship) doc.text(`Ship to: ${ship}`);
    doc.moveDown();
    doc.font("Helvetica-Bold").text("Order line        SKU                     Qty      Amount (INR)");
    doc.font("Helvetica");
    let total = 0;
    for (const l of order.orderLines) {
      const amount = l.lineFinalAmount ?? 0;
      total += amount;
      doc.text(`${l.orderLineId.padEnd(18)}${(l.sku || "-").padEnd(24)}${String(l.quantity).padEnd(9)}${amount.toFixed(2)}`);
    }
    doc.moveDown().font("Helvetica-Bold").text(`Total: INR ${total.toFixed(2)}`);
    doc.end();
  });
}

// ════════════════════════════ DASHBOARD (logged-in) ═════════════════════════

router.get("/myntra/status", authMiddleware, async (_req: Request, res: Response) => {
  try {
    const m = config.myntra;
    const [orders, returns, events] = await Promise.all([
      MyntraModel.listOrders(),
      MyntraModel.listReturns(),
      MyntraModel.listEvents(1),
    ]);
    const { latest } = await MyntraModel.listApiCalls();
    const lastCall = latest.sort((a, b) => b.calledAt.localeCompare(a.calledAt))[0] ?? null;
    res.json({
      success: true,
      isConfigured: m.isConfigured,
      isStage: /pretrtest|mockify/i.test(m.apiDomain),
      receivingOrders: Boolean(m.sellerDomain),
      counts: { orders: orders.length, returns: returns.length },
      lastEventAt: events[0]?.receivedAt ?? null,
      lastCallAt: lastCall?.calledAt ?? null,
      lastCallOk: lastCall ? lastCall.ok : null,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/myntra/orders", authMiddleware, async (_req: Request, res: Response) => {
  try {
    const orders = await MyntraModel.listOrders();
    res.json({ success: true, orders: orders.map(({ rawPayload, ...o }) => o) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/myntra/returns", authMiddleware, async (_req: Request, res: Response) => {
  try {
    const returns = await MyntraModel.listReturns();
    res.json({ success: true, returns: returns.map(({ rawPayload, ...r }) => r) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/myntra/inventory", authMiddleware, async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, items: await MyntraModel.listInventory() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/myntra/events", authMiddleware, async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, events: await MyntraModel.listEvents(200) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Shape a call result for the dashboard. */
const callOut = (r: Api.MyntraCallResult) => ({
  api: r.api,
  ok: r.ok,
  httpStatus: r.httpStatus,
  message: r.error ?? r.json?.statusMessage ?? r.text.slice(0, 300),
  responseText: r.text.slice(0, 20000),
});

router.post("/myntra/inventory/push", authMiddleware, async (req: Request, res: Response) => {
  try {
    const entries: Api.InventoryEntry[] = (Array.isArray(req.body?.entries) ? req.body.entries : [])
      .map((e: any) => ({
        sku: String(e.sku ?? "").trim(),
        quantity: Math.max(0, Math.floor(Number(e.quantity))),
        processingSla: Math.max(1, Math.floor(Number(e.processingSla ?? 3))),
        store_code: String(e.storeCode ?? e.store_code ?? "").trim(),
      }))
      .filter((e: Api.InventoryEntry) => e.sku && e.store_code && Number.isFinite(e.quantity));
    if (!entries.length) return res.status(400).json({ success: false, error: "Add at least one SKU, store code and quantity" });
    if (entries.length > 10) return res.status(400).json({ success: false, error: "Myntra accepts at most 10 SKUs per call" });
    const r = await Api.updateInventory(entries);
    const failed = new Map<string, string>();
    for (const f of (r.json?.failedEntries ?? []) as any[]) failed.set(`${f.sku}#${f.store_code}`, String(f.remarks ?? "Failed"));
    if (r.ok) {
      for (const e of entries) {
        const why = failed.get(`${e.sku}#${e.store_code}`);
        await MyntraModel.saveInventory({
          sku: e.sku,
          storeCode: e.store_code,
          quantity: e.quantity,
          processingSla: e.processingSla,
          source: "pushed",
          pushStatus: why ? "FAILED" : "SUCCESS",
          remarks: why ?? null,
        });
      }
    }
    res.json({ success: r.ok, result: callOut(r) });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post("/myntra/inventory/search", authMiddleware, async (req: Request, res: Response) => {
  try {
    const skus: string[] = (Array.isArray(req.body?.skus) ? req.body.skus : []).map(String).filter(Boolean);
    if (!skus.length) return res.status(400).json({ success: false, error: "Enter at least one SKU" });
    const r = await Api.searchInventory(skus.slice(0, 100));
    for (const d of (r.json?.inventoryDetails ?? []) as any[]) {
      for (const s of (d.stores ?? []) as any[]) {
        const storeCode = str(s.stores_code ?? s.store_code ?? s.storeCode);
        if (!storeCode) continue;
        await MyntraModel.saveInventory({
          sku: String(d.sku),
          storeCode,
          quantity: num(s.inventoryCount ?? s.quantity),
          processingSla: num(s.processingSla),
          source: "myntra",
          pushStatus: null,
          remarks: null,
        });
      }
    }
    res.json({ success: r.ok, result: callOut(r) });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

async function orderOr404(req: Request, res: Response) {
  const order = await MyntraModel.getOrder(req.params.id);
  if (!order) res.status(404).json({ success: false, error: "Order not found" });
  return order;
}

const activeLineIds = (o: MyntraModel.MyntraOrder) =>
  o.orderLines.filter((l) => l.status !== "CANCELLED").map((l) => l.orderLineId);

router.post("/myntra/orders/:id/accept", authMiddleware, async (req: Request, res: Response) => {
  try {
    const order = await orderOr404(req, res);
    if (!order) return;
    if (!order.warehouse) return res.status(400).json({ success: false, error: "Order has no warehouse from Myntra" });
    const r = await Api.acceptOrder(order.sellerOrderId, order.warehouse, activeLineIds(order));
    if (r.ok) await MyntraModel.saveOrder({ ...order, status: "ACCEPTED", lastEvent: "SELLER_ACCEPT" });
    res.json({ success: r.ok, result: callOut(r) });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post("/myntra/orders/:id/reject", authMiddleware, async (req: Request, res: Response) => {
  try {
    const order = await orderOr404(req, res);
    if (!order) return;
    const reasonId = Number(req.body?.reasonId);
    if (!Number.isInteger(reasonId) || reasonId < 1 || reasonId > 14)
      return res.status(400).json({ success: false, error: "Choose a rejection reason" });
    if (!order.warehouse) return res.status(400).json({ success: false, error: "Order has no warehouse from Myntra" });
    const r = await Api.rejectOrder(order.sellerOrderId, order.warehouse, activeLineIds(order), reasonId);
    if (r.ok) await MyntraModel.saveOrder({ ...order, status: "REJECTED", lastEvent: "SELLER_REJECT" });
    res.json({ success: r.ok, result: callOut(r) });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post("/myntra/orders/:id/ready-to-dispatch", authMiddleware, async (req: Request, res: Response) => {
  try {
    const order = await orderOr404(req, res);
    if (!order) return;
    if (!order.warehouse) return res.status(400).json({ success: false, error: "Order has no warehouse from Myntra" });
    const r = await Api.readyToDispatchMyntraInvoice(
      order.warehouse,
      activeLineIds(order).map((orderLineId) => ({ sellerOrderId: order.sellerOrderId, orderLineId })),
    );
    if (r.ok) await MyntraModel.saveOrder({ ...order, status: "READY_TO_DISPATCH", lastEvent: "SELLER_RTD" });
    res.json({ success: r.ok, result: callOut(r) });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/** Pull the order from Myntra and store packet / tracking / line details. */
router.post("/myntra/orders/:id/refresh", authMiddleware, async (req: Request, res: Response) => {
  try {
    const order = await orderOr404(req, res);
    if (!order) return;
    const r = await Api.getOrder(order.sellerOrderId);
    if (r.ok && r.json) {
      const data = r.json.data ?? r.json.order ?? r.json;
      const orderObj = Array.isArray(data) ? data[0] : data;
      await MyntraModel.saveOrder({
        ...order,
        status: str(Api.deepFind(orderObj, ["status"])) ?? order.status,
        packetId: str(Api.deepFind(orderObj, ["packetId"])) ?? order.packetId ?? null,
        trackingNumber: str(Api.deepFind(orderObj, ["trackingNumber"])) ?? order.trackingNumber ?? null,
        courierCode: str(Api.deepFind(orderObj, ["courierCode"])) ?? order.courierCode ?? null,
        orderLines: linesFrom(orderObj, order.orderLines),
        lastEvent: "SELLER_REFRESH",
      });
    }
    res.json({ success: r.ok, result: callOut(r) });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ── Documents from Myntra (after Ready To Dispatch) ─────────────────────────

async function sendDocument(req: Request, res: Response, kind: "invoice" | "label") {
  try {
    const order = await MyntraModel.getOrder(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: "Order not found" });
    if (!order.packetId)
      return res.status(400).json({ success: false, error: "No packet yet — mark the order Ready to dispatch first" });
    const r = kind === "invoice" ? await Api.downloadInvoice(order.packetId) : await Api.downloadShippingLabel(order.packetId);
    if (!r.ok || !r.buffer) {
      return res.status(502).json({
        success: false,
        error: `Myntra did not return the ${kind === "invoice" ? "invoice" : "shipping label"} (HTTP ${r.httpStatus ?? "no response"}): ${r.error ?? r.json?.statusMessage ?? r.text.slice(0, 200)}`,
      });
    }
    const name = `${kind === "invoice" ? "invoice" : "shipping-label"}-${order.packetId}.pdf`;
    res.status(200).type(r.contentType || "application/pdf").setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.send(r.buffer);
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
}

router.get("/myntra/orders/:id/invoice", authMiddleware, (req, res) => sendDocument(req, res, "invoice"));
router.get("/myntra/orders/:id/shipping-label", authMiddleware, (req, res) => sendDocument(req, res, "label"));

export default router;
