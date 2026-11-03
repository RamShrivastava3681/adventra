/**
 * Amazon Demo Simulator — runs the real data layer (dynamodb.ts with demo-tenant
 * isolation) and the real Sales / Inventory / Dispatch / Finance models against an
 * in-memory table. Only the AWS SDK is replaced.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@aws-sdk/client-dynamodb", () => ({ DynamoDBClient: class {} }));
vi.mock("@aws-sdk/lib-dynamodb", async () => import("./helpers/fake-dynamo.js"));

const fake = await import("./helpers/fake-dynamo.js");
const db = await import("../../dynamodb.js");
const { runAsDemo, DemoIsolationError, DEMO_TENANT_ID } = await import("../../lib/demo-context.js");
const { AmazonDemoSimulatorService: Sim, ERROR_KINDS } = await import("../amazon-demo-simulator.service.js");
const { PipelineError } = await import("../marketplace-fulfilment.service.js");

const actor = { userId: "u-1", email: "ops@example.com" };
const glv = (state: any) => state.stock.find((s: any) => s.sku === "GLV-BLU-M");
const step = (r: any, name: string) => r.steps.find((s: any) => s.step === name)?.detail ?? "";
const live = { pk: "PRODUCT#live-1", sk: "PRODUCT#live-1", entityType: "Product", id: "live-1", sku: "GLV-BLU-M", name: "Live gloves", clientId: "c-live" };

async function orderThroughDispatch(orderNo: string, quantity = 10) {
  await Sim.addDemoAmazonOrder({ amazonOrderId: orderNo, amazonSku: "AMZ-GLV-BLU-M", quantity, sellingPrice: 500 }, actor);
  await Sim.markPacked(orderNo, actor);
  return Sim.confirmDemoDispatch(orderNo, actor);
}

beforeEach(async () => {
  fake.table.clear();
  await db.putItem({ ...live });
  await Sim.resetDemoBaseline(actor);
});

describe("demo tenant isolation (dynamodb.ts)", () => {
  it("tags demo writes and keeps the two tenants invisible to each other", async () => {
    const demoItem = await runAsDemo(() => db.putItem({ pk: "X#1", sk: "X#1", entityType: "Product", id: "x1", sku: "D" }));
    expect(demoItem).toMatchObject({ isDemoData: true, tenantId: DEMO_TENANT_ID });

    const liveProducts = await db.scanByType("Product");
    expect(liveProducts.map((p) => p.id)).toEqual(["live-1"]);
    expect(await db.getItem("X#1")).toBeNull();

    const demoProducts = await runAsDemo(() => db.scanByType("Product"));
    expect(demoProducts.every((p) => p.isDemoData === true)).toBe(true);
    expect(demoProducts.some((p) => p.id === "live-1")).toBe(false);
    expect(await runAsDemo(() => db.getItem(live.pk))).toBeNull();
  });

  it("refuses demo-mode writes to live records", async () => {
    await expect(runAsDemo(() => db.updateItem(live.pk, live.sk, { name: "hacked" }))).rejects.toBeInstanceOf(DemoIsolationError);
    await expect(runAsDemo(() => db.deleteItem(live.pk, live.sk))).rejects.toBeInstanceOf(DemoIsolationError);
    await expect(runAsDemo(() => db.putItem({ ...live, name: "overwrite" }))).rejects.toBeInstanceOf(DemoIsolationError);
    expect(await runAsDemo(() => db.updateItemIf(live.pk, live.sk, { name: "x" }, "attribute_exists(pk)", {}))).toBeNull();
    expect(await db.getItem(live.pk)).toMatchObject({ name: "Live gloves" });
  });
});

describe("Run Full Demo Journey", () => {
  it("moves AMZ-DEMO-1001 through every WhizUnik workflow with the developer-note numbers", async () => {
    const r = await Sim.runFullDemoJourney(actor);
    expect(r.steps.filter((s) => s.status === "failed")).toEqual([]);
    expect(r.completed).toBe(true);
    expect(r.steps.map((s) => s.step)).toEqual([
      "Amazon order",
      "SKU mapping",
      "Main inventory reservation",
      "Marketplace Sales Order",
      "Simulated Amazon invoice",
      "Warehouse task",
      "Packing slip",
      "Courier and AWB",
      "Dispatch",
      "Stock OUT",
      "Delivered status",
      "Customer return",
      "Inspection",
      "Damaged / resalable split",
      "Credit Note",
      "Refund reference",
      "Damaged units decision",
      "Return closed",
      "Settlement reconciliation",
    ]);
    expect(step(r, "Amazon order")).toContain("₹5,000");
    expect(step(r, "SKU mapping")).toBe("AMZ-GLV-BLU-M → GLV-BLU-M");
    expect(step(r, "Main inventory reservation")).toContain("physical 100 · reserved 10 · available 90");
    expect(step(r, "Courier and AWB")).toBe("BlueDart Express · AWB TRK-DEMO-1001 · In Transit");
    expect(step(r, "Stock OUT")).toContain("physical 90 · reserved 0 · available 90");
    expect(step(r, "Damaged / resalable split")).toContain("physical 98 · reserved 0 · available 98 · under inspection 2");
    expect(step(r, "Credit Note")).toContain("₹4000");
    expect(step(r, "Settlement reconciliation")).toContain("net ₹350");
    expect(step(r, "Settlement reconciliation")).toContain("reconciled");

    // Real WhizUnik records, all in the demo tenant.
    const so = fake.allItems("GoodsSalesOrder");
    expect(so).toHaveLength(1);
    expect(so[0]).toMatchObject({ soNumber: "DEMO-SO-1001", buyerOrderNo: "AMZ-DEMO-1001", status: "fully_dispatched", isDemoData: true });
    expect(fake.allItems("GoodsDispatch")[0]).toMatchObject({ stockDebited: true, shippingStatus: "delivered", trackingNumber: "TRK-DEMO-1001" });
    expect(fake.allItems("Invoice")).toHaveLength(0); // rule 6: Amazon's invoice, no WhizUnik invoice
    expect(fake.allItems("CreditDebitNote")).toHaveLength(1);
    expect(fake.allItems("MarketplaceSettlement")[0]).toMatchObject({ netSettlementExpected: 350, status: "RECEIVED" });
    expect(fake.allItems("WorkflowTask").length).toBeGreaterThan(0);
    const audit = fake.allItems("AuditLog").map((a) => a.action);
    for (const e of ["order_received", "stock_reserved", "invoice_received", "warehouse_task_created", "dispatched", "delivered", "return_inspected", "credit_note_created", "refund_recorded", "return_closed", "settlement_reconciled"]) {
      expect(audit).toContain(`amazon_demo.${e}`);
    }
    const nonDemo = [...fake.table.values()].filter((i) => i.pk !== live.pk && i.isDemoData !== true);
    expect(nonDemo).toEqual([]);

    const state = await Sim.getState(actor);
    expect(glv(state)).toMatchObject({ physicalStock: 98, reservedStock: 0, availableStock: 98, underInspection: 0 });
    expect(state.returns[0]).toMatchObject({ returnStatus: "Closed", quantityAccepted: 8, quantityDamaged: 2, damagedDisposition: "Written off with approval" });
    expect(state.orders[0]).toMatchObject({ whizunikStatus: "Closed", amazonOrderStatus: "Refunded", courier: "BlueDart Express" });
  });

  it("is repeatable and leaves live data alone", async () => {
    await Sim.runFullDemoJourney(actor);
    const second = await Sim.runFullDemoJourney(actor);
    expect(second.completed).toBe(true);
    expect(fake.allItems("GoodsSalesOrder")).toHaveLength(1);
    expect(await db.getItem(live.pk)).toMatchObject({ name: "Live gloves" });
    expect((await db.scanByType("GoodsSalesOrder")).length).toBe(0);
  });
});

describe("order rules", () => {
  it("reserves on order and reduces physical stock only at dispatch", async () => {
    await Sim.addDemoAmazonOrder({ amazonOrderId: "AMZ-DEMO-2001", amazonSku: "AMZ-GLV-BLU-M", quantity: 10, sellingPrice: 500 }, actor);
    let s = glv(await Sim.getState(actor));
    expect(s).toMatchObject({ physicalStock: 100, reservedStock: 10, availableStock: 90 });
    await Sim.markPacked("AMZ-DEMO-2001", actor);
    s = glv(await Sim.getState(actor));
    expect(s.physicalStock).toBe(100);
    await Sim.confirmDemoDispatch("AMZ-DEMO-2001", actor);
    s = glv(await Sim.getState(actor));
    expect(s).toMatchObject({ physicalStock: 90, reservedStock: 0, availableStock: 90 });
  });

  it("settles a plain order at the note's example: ₹5,000 − 500 − 100 − 0 − 50 = ₹4,350", async () => {
    await orderThroughDispatch("AMZ-DEMO-2002");
    const s = await Sim.simulateSettlement({ amazonOrderId: "AMZ-DEMO-2002" }, actor);
    expect(s!.breakdown).toEqual({ orderValue: 5000, commission: 500, shippingFee: 100, refundAmount: 0, otherDeductions: 50, netSettlement: 4350 });
    expect(s!.reconciliation?.reconciled).toBe(true);
  });

  it("stops an unmapped SKU before any reservation or warehouse task", async () => {
    const o = await Sim.addDemoAmazonOrder({ amazonOrderId: "AMZ-DEMO-2003", amazonSku: "AMZ-GLV-RED-L", quantity: 2, sellingPrice: 500 }, actor);
    expect(o.whizunikStatus).toBe("SKU Mapping Required");
    expect(fake.allItems("GoodsSalesOrder")).toHaveLength(0);
    expect(fake.allItems("GoodsDispatch")).toHaveLength(0);
    await expect(Sim.markPacked("AMZ-DEMO-2003", actor)).rejects.toBeInstanceOf(PipelineError);
  });

  it("enforces the sequence and refuses duplicates", async () => {
    await Sim.addDemoAmazonOrder({ amazonOrderId: "AMZ-DEMO-2004", amazonSku: "AMZ-GLV-BLU-M", quantity: 4, sellingPrice: 500 }, actor);
    await expect(Sim.confirmDemoDispatch("AMZ-DEMO-2004", actor)).rejects.toThrow(/Pack the order/);
    await expect(Sim.markDelivered("AMZ-DEMO-2004", actor)).rejects.toThrow(/Confirm dispatch/);
    await expect(Sim.createDemoReturn({ amazonOrderId: "AMZ-DEMO-2004" }, actor)).rejects.toThrow(/dispatched/);
    await expect(Sim.addDemoAmazonOrder({ amazonOrderId: "AMZ-DEMO-2004", amazonSku: "AMZ-GLV-BLU-M", quantity: 1 }, actor)).rejects.toMatchObject({ code: "DuplicateOrder" });

    await Sim.markPacked("AMZ-DEMO-2004", actor);
    await Sim.confirmDemoDispatch("AMZ-DEMO-2004", actor);
    const ret = await Sim.createDamagedReturn({ amazonOrderId: "AMZ-DEMO-2004" }, actor);
    expect(ret).toMatchObject({ returnStatus: "PartiallyAccepted", quantityAccepted: 2, quantityDamaged: 2 });
    await expect(Sim.createDemoReturn({ amazonOrderId: "AMZ-DEMO-2004" }, actor)).rejects.toMatchObject({ code: "DuplicateReturn" });

    // Damaged units never reach available stock.
    expect(glv(await Sim.getState(actor))).toMatchObject({ physicalStock: 98, availableStock: 98, underInspection: 2 });

    await Sim.returnAction(ret.id, "credit_note", {}, actor);
    await Sim.simulateRefund({ returnId: ret.id }, actor);
    await expect(Sim.simulateRefund({ returnId: ret.id }, actor)).rejects.toMatchObject({ code: "DuplicateRefund" });
    expect(fake.allItems("MarketplaceAmazonRefund")).toHaveLength(1);
    await expect(Sim.returnAction(ret.id, "close", {}, actor)).rejects.toThrow(/damaged units/);
    await expect(Sim.returnAction(ret.id, "disposition", { disposition: "Written off with approval" }, actor)).rejects.toThrow(/approver/);
    await Sim.returnAction(ret.id, "disposition", { disposition: "Recovered through claim" }, actor);
    const closed = await Sim.returnAction(ret.id, "close", {}, actor);
    expect(closed).toMatchObject({ returnStatus: "Closed" });
    expect(fake.allItems("CreditDebitNote")[0]).toMatchObject({ amount: 1000, status: "refunded" });
  });

  it("holds the warehouse task while the Amazon invoice is delayed", async () => {
    const o = await Sim.addDemoAmazonOrder({ amazonOrderId: "AMZ-DEMO-2005", amazonSku: "AMZ-GLV-BLU-M", quantity: 1, delayInvoice: true }, actor);
    expect(o).toMatchObject({ whizunikStatus: "Invoice Pending", invoiceStatus: "AwaitingAmazonInvoice" });
    expect(fake.allItems("GoodsDispatch")).toHaveLength(0);
    const after = await Sim.receiveInvoice("AMZ-DEMO-2005", actor);
    expect(after).toMatchObject({ whizunikStatus: "Invoice Received", invoiceStatus: "InvoiceReceived" });
    expect(fake.allItems("GoodsDispatch")).toHaveLength(1);
  });
});

describe("error simulations", () => {
  it.each(ERROR_KINDS.map((k) => [k]))("%s shows the failure and Retry re-runs the step", async (kind) => {
    const { exception } = await Sim.simulateError(kind, actor);
    expect(exception).toBeTruthy();
    expect(exception).toMatchObject({ currentStatus: "Open" });
    expect(exception!.affectedOrder).toBeTruthy();
    expect(exception!.errorMessage).toBeTruthy();
    expect(exception!.responsibleUser).toBeTruthy();
    expect(exception!.retryAction).toBeTruthy();

    const options = kind === "unmapped_sku" ? { mapToSku: "GLV-RED-L" } : kind === "insufficient_stock" ? { addStock: 20 } : {};
    const { exception: after } = await Sim.retryFailedEvent(exception!.id, options, actor);
    expect(after).toMatchObject({ currentStatus: "Resolved" });
  });

  it("a retry that cannot succeed yet stays open", async () => {
    const { exception } = await Sim.simulateError("unmapped_sku", actor);
    await expect(Sim.retryFailedEvent(exception!.id, {}, actor)).rejects.toThrow(/still unmapped/);
    const state = await Sim.getState(actor);
    expect(state.exceptions.find((e: any) => e.id === exception!.id)).toMatchObject({ currentStatus: "Open", retryCount: 1 });
  });
});
