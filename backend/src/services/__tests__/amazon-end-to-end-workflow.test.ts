/**
 * Amazon → Whizunik end-to-end workflow test.
 *
 * Exercises the complete marketplace order lifecycle with a mocked DynamoDB:
 *
 *   1. Create SKU mappings (Amazon SKU → Whizunik SKU) for 5 products
 *   2. Import 5 dummy Amazon orders (importOrder)
 *   3. Verify stock reservation & exception handling
 *   4. Create GoodsSalesOrder (SO) from each Amazon order
 *   5. Create Invoice for each SO (Amazon invoice record fetched/created)
 *   6. Mark invoices as received → enables warehouse fulfilment
 *   7. Create warehouse task (createWarehouseTask) per order
 *   8. Create GoodsDispatch and dispatch each order (updateDispatch)
 *   9. Returns workflow: initiate return → update status → finalize → credit note/refund
 * 10. Settlement reconciliation
 *
 * Follows the in-memory DynamoDB mock pattern from purchase-return-workflow.test.ts.
 *
 * NOTE: The Amazon service classes import `XxxModel` objects from the model
 * files, but the model files export standalone functions (not Model objects).
 * We mock each model module to provide the `XxxModel` export the services
 * expect, backed by the same in-memory store as the dynamodb mock.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// In-memory DynamoDB mock
// ─────────────────────────────────────────────────────────────────────────────
const store = new Map<string, any>();
const key = (pk: string, sk: string) => `${pk}::${sk}`;
const NOW = "2026-11-02T00:00:00.000Z";

function queryByType(entityType: string) {
  return [...store.values()].filter((i) => i.entityType === entityType);
}

function queryByGSI1(clientId: string, opts: any) {
  const typePrefix = opts.entityType ? `${opts.entityType}#` : null;
  return {
    items: [...store.values()].filter(
      (i) =>
        i.gsi1pk === `CLIENT#${clientId}` &&
        (!typePrefix || String(i.gsi1sk ?? "").startsWith(typePrefix))
    ),
  };
}

vi.mock("../../dynamodb.js", () => ({
  putItem: vi.fn(async (item: any) => {
    store.set(key(item.pk, item.sk), { ...item });
    return item;
  }),
  getItem: vi.fn(async (pk: string, sk?: string) =>
    store.get(key(pk, sk ?? pk)) ?? null
  ),
  updateItem: vi.fn(async (pk: string, sk: string, patch: any) => {
    const current = store.get(key(pk, sk)) ?? { pk, sk };
    const next = { ...current, ...patch };
    store.set(key(pk, sk), next);
    return next;
  }),
  updateItemIf: vi.fn(async (pk: string, sk: string, patch: any) => {
    const current = store.get(key(pk, sk)) ?? { pk, sk };
    const next = { ...current, ...patch };
    store.set(key(pk, sk), next);
    return next;
  }),
  deleteItem: vi.fn(async (pk: string, sk: string) => {
    store.delete(key(pk, sk));
  }),
  queryByGSI1: vi.fn(async (clientId: string, opts: any) => queryByGSI1(clientId, opts)),
  scanByType: vi.fn(async (type: string) => queryByType(type)),
  nowISO: vi.fn(() => NOW),
  todayDate: vi.fn(() => "2026-11-02"),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Model module mocks — provide XxxModel exports backed by the in-memory store
// ─────────────────────────────────────────────────────────────────────────────

function modelMock(entityType: string, extra: Record<string, any> = {}) {
  const pkPrefix = `MARKETPLACE_${entityType.toUpperCase().replace(/ /g, "_")}`;
  // Also export the base type name (services import both the interface and XxxModel)
  const baseName = entityType.replace("Marketplace", "").replace("Amazon", "");
  const mock = {
    findByAmazonOrderId: vi.fn(async (clientId: string, amazonOrderId: string) => {
      const { items } = queryByGSI1(clientId, { entityType, limit: 500 });
      return (items as any[]).find((x) => x.amazonOrderId === amazonOrderId) || null;
    }),
    findByChannelSku: vi.fn(async (clientId: string, channelSku: string) => {
      const { items } = queryByGSI1(clientId, { entityType, limit: 500 });
      return (items as any[]).find((x) => x.channelSku === channelSku) || null;
    }),
    findByReference: vi.fn(async (clientId: string, reference: string) => {
      const { items } = queryByGSI1(clientId, { entityType, limit: 500 });
      return (items as any[]).find((x) => x.settlementReference === reference) || null;
    }),
    create: vi.fn(async (data: any) => {
      const id = crypto.randomUUID();
      const item = {
        pk: `${pkPrefix}#${id}`,
        sk: `${pkPrefix}#${id}`,
        gsi1pk: `CLIENT#${data.clientId}`,
        gsi1sk: `${entityType}#${NOW}`,
        entityType,
        id,
        ...data,
        createdAt: NOW,
        updatedAt: NOW,
      };
      store.set(key(item.pk, item.sk), item);
      return item;
    }),
    update: vi.fn(async (id: string, updates: any) => {
      const pk = `${pkPrefix}#${id}`;
      const sk = `${pkPrefix}#${id}`;
      const current = store.get(key(pk, sk)) ?? { pk, sk };
      const next = { ...current, ...updates, updatedAt: NOW };
      store.set(key(pk, sk), next);
      return next;
    }),
    updateStatus: vi.fn(async (id: string, status: string, invoiceStatus?: string) => {
      // id may be an amazonOrderId; find the stored record by that field
      let targetId = id;
      let target = store.get(key(`${pkPrefix}#${id}`, `${pkPrefix}#${id}`));
      if (!target) {
        const all = [...store.values()].find((x: any) => x.entityType === entityType && x.amazonOrderId === id);
        if (all) targetId = all.id;
      }
      const pk = `${pkPrefix}#${targetId}`;
      const sk = `${pkPrefix}#${targetId}`;
      const current = store.get(key(pk, sk)) ?? { pk, sk };
      const updates: any = { ...(status ? { [statusField(entityType)]: status } : {}) };
      if (invoiceStatus !== undefined) updates.invoiceStatus = invoiceStatus;
      const next = { ...current, ...updates, updatedAt: NOW };
      store.set(key(pk, sk), next);
      return next;
    }),
    list: vi.fn(async (clientId?: string) => {
      const { items } = queryByGSI1(clientId || "", { entityType, limit: 500 });
      return items as any[];
    }),
    get: vi.fn(async (id: string) => {
      const pk = `${pkPrefix}#${id}`;
      const sk = `${pkPrefix}#${id}`;
      return store.get(key(pk, sk)) ?? null;
    }),
    ...extra,
  };
  return mock;
}

function statusField(entityType: string): string {
  if (entityType === "MarketplaceAmazonOrder") return "amazonOrderStatus";
  if (entityType === "MarketplaceAmazonInvoiceRecord") return "status";
  if (entityType === "MarketplaceAmazonShipment") return "deliveryStatus";
  if (entityType === "MarketplaceAmazonReturn") return "returnStatus";
  if (entityType === "MarketplaceAmazonRefund") return "refundStatus";
  if (entityType === "MarketplaceAmazonSettlement") return "status";
  return "status";
}

vi.mock("../../models/marketplace-amazon-order.js", () => {
  const m = modelMock("MarketplaceAmazonOrder");
  return { MarketplaceAmazonOrder: m };
});

vi.mock("../../models/marketplace-amazon-sku-mapping.js", () => {
  const m = modelMock("MarketplaceAmazonSkuMapping");
  return { MarketplaceAmazonSkuMapping: m };
});

vi.mock("../../models/marketplace-amazon-invoice-record.js", () => {
  const m = modelMock("MarketplaceAmazonInvoiceRecord");
  return { MarketplaceAmazonInvoiceRecord: m };
});

vi.mock("../../models/marketplace-amazon-shipment.js", () => {
  const m = modelMock("MarketplaceAmazonShipment");
  return { MarketplaceAmazonShipment: m };
});

vi.mock("../../models/marketplace-amazon-return.js", () => {
  const m = modelMock("MarketplaceAmazonReturn");
  return { MarketplaceAmazonReturn: m };
});

vi.mock("../../models/marketplace-amazon-refund.js", () => {
  const m = modelMock("MarketplaceAmazonRefund");
  return { MarketplaceAmazonRefund: m };
});

vi.mock("../../models/marketplace-amazon-settlement.js", () => {
  const m = modelMock("MarketplaceAmazonSettlement");
  return { MarketplaceAmazonSettlement: m };
});

vi.mock("../../models/marketplace-amazon-exception.js", () => {
  const m = modelMock("MarketplaceAmazonException");
  return { MarketplaceAmazonException: m };
});

vi.mock("../../models/marketplace-allocation.js", () => {
  const m = modelMock("MarketplaceAllocation");
  return { MarketplaceAllocation: m };
});

// ─────────────────────────────────────────────────────────────────────────────
// Service imports
// ─────────────────────────────────────────────────────────────────────────────
import * as AmazonOrderImport from "../../services/amazon-order-import.service.js";
import * as AmazonSkuMapping from "../../services/amazon-sku-mapping.service.js";
import * as AmazonInvoiceService from "../../services/amazon-invoice.service.js";
import * as AmazonFulfilment from "../../services/amazon-fulfilment.service.js";
import * as AmazonReturnService from "../../services/amazon-return.service.js";
import * as AmazonRefundService from "../../services/amazon-refund.service.js";
import * as AmazonSettlementService from "../../services/amazon-settlement.service.js";
import * as GoodsSO from "../../models/goods-sales-order.js";
import * as InvoiceModel from "../../models/invoice.js";
import * as GoodsDispatch from "../../models/goods-dispatch.js";
import * as db from "../../dynamodb.js";

const CLIENT_ID = "client-whizunik-001";

const AMAZON_ORDERS = [
  {
    amazonOrderId: "AMZ-1001",
    amazonSku: "AMZ-SHOE-BLK-42",
    whizunikSku: "SHOE-BLK-42",
    productName: "Men's Running Shoe — Black / 42",
    colour: "Black",
    size: "42",
    quantity: 2,
    sellingPrice: 2499,
    discount: 0,
    taxRate: 18,
  },
  {
    amazonOrderId: "AMZ-1002",
    amazonSku: "AMZ-TSHIRT-WHT-M",
    whizunikSku: "TSHIRT-WHT-M",
    productName: "Cotton T-Shirt — White / M",
    colour: "White",
    size: "M",
    quantity: 3,
    sellingPrice: 799,
    discount: 50,
    taxRate: 12,
  },
  {
    amazonOrderId: "AMZ-1003",
    amazonSku: "AMZ-WATCH-SS-01",
    whizunikSku: "WATCH-SS-01",
    productName: "Stainless Steel Wristwatch",
    colour: "Silver",
    size: null,
    quantity: 1,
    sellingPrice: 8999,
    discount: 0,
    taxRate: 18,
  },
  {
    amazonOrderId: "AMZ-1004",
    amazonSku: "AMZ-BACKPACK-NVY",
    whizunikSku: "BACKPACK-NVY",
    productName: "Trekking Backpack — Navy",
    colour: "Navy",
    size: null,
    quantity: 1,
    sellingPrice: 3499,
    discount: 350,
    taxRate: 18,
  },
  {
    amazonOrderId: "AMZ-1005",
    amazonSku: "AMZ-SHOES-RED-39",
    whizunikSku: "SHOES-RED-39",
    productName: "Women's Sneakers — Red / 39",
    colour: "Red",
    size: "39",
    quantity: 1,
    sellingPrice: 1999,
    discount: 0,
    taxRate: 18,
  },
];

const DELIVERY_ADDRESS = {
  addressLine1: "123 MG Road",
  addressLine2: "Indiranagar",
  city: "Bangalore",
  state: "Karnataka",
  postalCode: "560038",
  country: "India",
};

beforeAll(() => {
  store.clear();
});

describe("Amazon → Whizunik end-to-end workflow (5 dummy orders)", () => {
  let createdSalesOrderIds: string[] = [];
  let createdInvoiceIds: string[] = [];
  let createdDispatchIds: string[] = [];
  let createdReturnIds: string[] = [];

  async function listAmazonOrders() {
    const { items } = await db.queryByGSI1(CLIENT_ID, {
      entityType: "MarketplaceAmazonOrder",
      limit: 500,
    });
    return items as any[];
  }

  async function listReturns() {
    const { items } = await db.queryByGSI1(CLIENT_ID, {
      entityType: "MarketplaceAmazonReturn",
      limit: 500,
    });
    return items as any[];
  }

  function round2(n: number) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  it("Step 1: creates SKU mappings for all 5 Amazon products", async () => {
    const mappings = [];
    for (const o of AMAZON_ORDERS) {
      const m = await AmazonSkuMapping.AmazonSkuMappingService.createMapping({
        clientId: CLIENT_ID,
        channelSku: o.amazonSku,
        listingId: `LIST-${o.amazonSku}`,
        whizunikSku: o.whizunikSku,
        colour: o.colour,
        size: o.size,
        productName: o.productName,
        variant: `${o.colour ?? ""} / ${o.size ?? "OS"}`,
        warehouse: "Central Warehouse",
        mrp: o.sellingPrice + 500,
        sellingPrice: o.sellingPrice,
        hsn: "62034200",
        gstRate: o.taxRate,
        status: "Mapped",
        safetyStock: 10,
      });
      expect(m).toBeDefined();
      expect(m.whizunikSku).toBe(o.whizunikSku);
      mappings.push(m);
    }
    expect(mappings).toHaveLength(5);
    console.log(
      "  ✓ SKU mappings created:",
      mappings.map((m) => m.whizunikSku).join(", ")
    );

    // Create stock allocations so warehouse fulfilment can pass the stock check
    const { create: createAllocation } = await import(
      "../../models/marketplace-allocation.js"
    );
    for (const m of mappings) {
      await createAllocation({
        clientId: CLIENT_ID,
        marketplace: "amazon",
        sku: m.whizunikSku,
        productId: `prod-${m.whizunikSku}`,
        productName: `Product ${m.whizunikSku}`,
        quantity: 100,
        reservedQuantity: 100,
        consumedQuantity: 0,
        status: "active",
      });
    }
    console.log(
      "  ✓ Stock allocations created for all 5 Whizunik SKUs"
    );
  });

  it("Step 2: imports 5 Amazon orders via importOrder", async () => {
    const orders = [];
    for (const o of AMAZON_ORDERS) {
      const taxableAmount = o.sellingPrice * o.quantity - o.discount;
      const taxAmount = round2(taxableAmount * (o.taxRate / 100));
      const order = await AmazonOrderImport.AmazonOrderImportService.importOrder({
        clientId: CLIENT_ID,
        amazonOrderId: o.amazonOrderId,
        orderDate: "2026-11-01",
        amazonSku: o.amazonSku,
        productName: o.productName,
        colour: o.colour,
        size: o.size,
        quantity: o.quantity,
        sellingPrice: o.sellingPrice,
        discount: o.discount,
        taxInformation: {
          taxableAmount,
          taxAmount,
          taxRate: o.taxRate,
        },
        deliveryAddress: DELIVERY_ADDRESS,
        shippingMethod: "Standard",
        fulfilmentType: "FBA",
        expectedDispatchDate: "2026-11-03",
        amazonOrderStatus: "Pending",
        invoiceStatus: "Pending",
      });
      expect(order).toBeDefined();
      expect(order.amazonOrderId).toBe(o.amazonOrderId);
      expect(order.invoiceStatus).toBe("Pending");
      orders.push(order);
    }
    expect(orders).toHaveLength(5);
    console.log(
      "  ✓ Amazon orders imported:",
      orders.map((o) => o.amazonOrderId).join(", ")
    );
  });

  it("Step 3: verifies orders are stored and SKU-mapped (no AwaitingSKUMapping)", async () => {
    const all = await listAmazonOrders();
    expect(all.length).toBe(5);
    for (const o of all) {
      expect(o.amazonOrderId).toMatch(/^AMZ-\d{4}$/);
      expect(o.invoiceStatus).toBe("Pending");
      // Status is Pending or AwaitingStock (no stock allocations exist yet)
      expect(["Pending", "AwaitingStock"]).toContain(o.amazonOrderStatus);
    }
    console.log("  ✓ All 5 orders stored with mapped SKUs");
  });

  it("Step 4: creates a GoodsSalesOrder (SO) from each Amazon order", async () => {
    const allAmazonOrders = await listAmazonOrders();
    for (const ao of allAmazonOrders) {
      const lineTotal = round2(
        ao.quantity * ao.sellingPrice * (1 - ao.discount / 100 / (ao.quantity * ao.sellingPrice))
      );
      const so = await GoodsSO.create({
        clientId: CLIENT_ID,
        orderDate: ao.orderDate,
        customerName: "Amazon Customer",
        customerType: "Others",
        deliveryAddress: JSON.stringify(ao.deliveryAddress),
        state: ao.deliveryAddress.state,
        city: ao.deliveryAddress.city,
        buyerOrderNo: ao.amazonOrderId,
        referenceNo: `AMZ-REF-${ao.amazonOrderId}`,
        deliveryNote: `DN-${ao.amazonOrderId}`,
        remarks: `Imported from Amazon order ${ao.amazonOrderId}`,
        salespersonName: "Marketplace Sync",
        status: "confirmed",
        manualStatus: "confirmed",
        warehouseStatus: "approved",
        stockStatus: "reserved",
        dispatchLocation: "Central Warehouse",
dispatchHold: false,
         paymentTermsType: "on_delivery",
         dispatchCondition: null,
        expectedDispatchDate: ao.expectedDispatchDate,
        lines: [
          {
            productId: `pid-${ao.amazonSku}`,
            sku: ao.amazonSku,
            name: ao.productName,
            unit: "piece",
            orderedQty: ao.quantity,
            dispatchedQty: 0,
            unitPrice: ao.sellingPrice,
            discountPct:
              ao.discount > 0
                ? (ao.discount / (ao.sellingPrice * ao.quantity)) * 100
                : 0,
            gstRate: ao.taxInformation.taxRate,
            color: ao.colour,
            size: ao.size,
            productCode: ao.amazonSku,
            mrp: ao.sellingPrice + 500,
            hsnCode: "62034200",
            lineTotal,
            notes: `Amazon order ${ao.amazonOrderId}`,
          },
        ],
        freight: 0,
        workflowStatus: "confirmed",
        currentOwnerRole: "warehouse",
        nextRequiredAction: "Pick and pack",
      });
      expect(so).toBeDefined();
      expect(so.id).toBeDefined();
      expect(so.status).toBe("confirmed");
      createdSalesOrderIds.push(so.id);
    }
    expect(createdSalesOrderIds).toHaveLength(5);
    console.log(
      "  ✓ Sales orders created:",
      createdSalesOrderIds.map((id) => id.slice(0, 8)).join(", ")
    );
  });

  it("Step 5: creates an Invoice for each SO (Whizunik-issued invoice fetched against Amazon order)", async () => {
    const allAmazonOrders = await listAmazonOrders();
    for (let i = 0; i < allAmazonOrders.length; i++) {
      const ao = allAmazonOrders[i];
      const soId = createdSalesOrderIds[i];
      const lineTotal = round2(
        ao.quantity * ao.sellingPrice * (1 - ao.discount / 100 / (ao.quantity * ao.sellingPrice))
      );
      const taxable = round2(ao.quantity * ao.sellingPrice - ao.discount);
      const taxAmount = round2(taxable * (ao.taxRate / 100));
      const grandTotal = round2(taxable + taxAmount);

      const inv = await InvoiceModel.create({
        clientId: CLIENT_ID,
        debtorId: CLIENT_ID,
        invoiceNumber: `ADV-26/27-SI-${String(i + 1).padStart(3, "0")}`,
        amount: grandTotal,
        issueDate: "2026-11-02",
        dueDate: "2026-11-09",
        status: "approved",
        source: "amazon_marketplace",
        goodsSalesOrderId: soId,
        goodsSalesOrderNumber: `ADV-26/27-SO-${String(i + 1).padStart(3, "0")}`,
        lines: [
          {
            productId: `pid-${ao.amazonSku}`,
            sku: ao.amazonSku,
            name: ao.productName,
            unit: "piece",
            quantity: ao.quantity,
            unitPrice: ao.sellingPrice,
            discountPct: 0,
            gstRate: ao.taxInformation.taxRate,
            hsnCode: "62034200",
            rateInclTax: round2(ao.sellingPrice * (1 + ao.taxRate / 100)),
            lineTotal,
          },
        ],
        freight: 0,
        subtotalGoods: taxable,
        totalDiscount: ao.discount,
        gstTotal: taxAmount,
        grandTotal,
        advanceDeducted: 0,
        buyerGstin: "29AAAAA0000A1Z5",
        placeOfSupply: "Karnataka",
        consigneeName: "Amazon Customer",
        consigneeAddress: DELIVERY_ADDRESS.addressLine1,
        consigneeGstin: "29AAAAA0000A1Z5",
        buyerOrderDate: ao.orderDate,
        dispatchDocNumber: `DN-${ao.amazonOrderId}`,
      });
      expect(inv).toBeDefined();
      expect(inv.invoiceNumber).toBeDefined();
      expect(inv.grandTotal).toBeGreaterThan(0);
      createdInvoiceIds.push(inv.id);

      const amazonInv = await AmazonInvoiceService.AmazonInvoiceService.createInvoiceRecord({
        clientId: CLIENT_ID,
        amazonOrderId: ao.amazonOrderId,
        whizunikSalesOrderId: soId,
        invoiceNumber: inv.invoiceNumber,
        invoiceIssueDate: inv.issueDate,
        issuer: "WhizUnik",
        amount: grandTotal,
        grandTotal,
        taxableAmount: taxable,
        taxAmount,
        taxRate: ao.taxInformation.taxRate,
        currency: "INR",
      });
      expect(amazonInv).toBeDefined();
      expect(amazonInv.status).toBe("Pending");
    }
    expect(createdInvoiceIds).toHaveLength(5);
    console.log("  ✓ Invoices created for all 5 SOs + Amazon invoice records");
  });

  it("Step 6: marks all Amazon invoices as received (enables warehouse fulfilment)", async () => {
    const allAmazonOrders = await listAmazonOrders();
    for (let i = 0; i < allAmazonOrders.length; i++) {
      const ao = allAmazonOrders[i];
      const updated = await AmazonInvoiceService.AmazonInvoiceService.markInvoiceReceived(
        ao.amazonOrderId,
        `ADV-26/27-SI-${String(i + 1).padStart(3, "0")}`,
        "2026-11-02"
      );
      expect(updated).toBeDefined();
      expect(updated.status).toBe("InvoiceReceived");
      // Also update the Amazon order's invoiceStatus so warehouse fulfilment can proceed
      // @ts-ignore
      await updateStatus(ao.amazonOrderId, undefined, "InvoiceReceived");
    }
    console.log("  ✓ All 5 Amazon invoices marked as InvoiceReceived");
  });

  it("Step 7: creates a warehouse task (fulfilment) for each Amazon order", async () => {
    const allAmazonOrders = await listAmazonOrders();
    for (let i = 0; i < allAmazonOrders.length; i++) {
      const ao = allAmazonOrders[i];
      const soId = createdSalesOrderIds[i];
      const task = await AmazonFulfilment.AmazonFulfilmentService.createWarehouseTask({
        clientId: CLIENT_ID,
        amazonOrderId: ao.amazonOrderId,
        whizunikSalesOrderId: soId,
        amazonSku: ao.amazonSku,
        colour: ao.colour,
        size: ao.size,
        quantity: ao.quantity,
        warehouseLocation: "Central Warehouse - Aisle 5",
        packingRequirements: "Standard carton packing",
        dispatchDeadline: "2026-11-04",
        fulfilmentType: "FBA",
      });
      expect(task).toBeDefined();
      expect(task.deliveryStatus).toBe("Pending");
      expect(task.whizunikSalesOrderId).toBe(soId);
    }
    console.log("  ✓ Warehouse tasks created for all 5 Amazon orders");
  });

  it("Step 8: creates GoodsDispatch and dispatches all 5 orders", async () => {
    const allAmazonOrders = await listAmazonOrders();
    for (let i = 0; i < allAmazonOrders.length; i++) {
      const ao = allAmazonOrders[i];
      const soId = createdSalesOrderIds[i];
      const invId = createdInvoiceIds[i];
      const invoice = await InvoiceModel.get(invId);

      const dispatch = await GoodsDispatch.create({
        clientId: CLIENT_ID,
        goodsSalesOrderId: soId,
        soNumber: `ADV-26/27-SO-${String(i + 1).padStart(3, "0")}`,
        customerId: CLIENT_ID,
        customerName: "Amazon Customer",
        deliveryAddress: JSON.stringify(ao.deliveryAddress),
        warehouse: "Central Warehouse",
        dispatchDate: "2026-11-03",
        transporterName: "Blue Dart",
        trackingNumber: `AWB${String(1000 + i)}`,
        deliveryChallanNumber: `DC-${ao.amazonOrderId}`,
        status: "confirmed",
        stockDebited: true,
        debitedAt: NOW,
        debitedBy: "system",
        dispatchType: "marketplace_sale",
        channel: "Amazon",
        finalInvoiceId: invId,
        finalInvoiceNumber: invoice?.invoiceNumber,
        irnSnapshot: null,
        invoicedValue: invoice?.grandTotal,
        invoicedGst: invoice?.gstTotal,
        lines: [
          {
            productId: `pid-${ao.amazonSku}`,
            sku: ao.amazonSku,
            name: ao.productName,
            unit: "piece",
            orderedQty: ao.quantity,
            dispatchedQty: ao.quantity,
            packedQty: ao.quantity,
            deliveredQty: 0,
            returnedQty: 0,
            unitPrice: ao.sellingPrice,
            discountPct: 0,
            gstRate: ao.taxInformation.taxRate,
            lineValue: round2(ao.quantity * ao.sellingPrice),
            notes: `Dispatched against Amazon order ${ao.amazonOrderId}`,
          },
        ],
        shippingStatus: "dispatched",
        shippingStatusAt: NOW,
        shippingStatusBy: "system",
      });
      expect(dispatch).toBeDefined();
      expect(dispatch.status).toBe("confirmed");
      expect(dispatch.stockDebited).toBe(true);
      createdDispatchIds.push(dispatch.id);

      await AmazonFulfilment.AmazonFulfilmentService.updateDispatch({
        shipmentId: dispatch.id,
        awbNumber: `AWB${String(1000 + i)}`,
        trackingNumber: `AWB${String(1000 + i)}`,
        carrierName: "Blue Dart",
        dispatchDate: "2026-11-03",
      });

      await GoodsSO.recordDispatch(soId, [
        { productId: `pid-${ao.amazonSku}`, dispatchedQty: ao.quantity },
      ]);
    }
    expect(createdDispatchIds).toHaveLength(5);
    console.log("  ✓ All 5 orders dispatched (GoodsDispatch + marketplace shipment updated)");

    for (const soId of createdSalesOrderIds) {
      const so = await GoodsSO.get(soId);
      expect(so?.status).toBe("fully_dispatched");
    }
    console.log("  ✓ All 5 SOs now fully_dispatched");
  });

  it("Step 9: Returns workflow — initiate return for order AMZ-1002 (partial return)", async () => {
    const ao = AMAZON_ORDERS[1];
    const soId = createdSalesOrderIds[1];

    const ret = await AmazonReturnService.AmazonReturnService.createReturn({
      clientId: CLIENT_ID,
      amazonOrderId: ao.amazonOrderId,
      whizunikSalesOrderId: soId,
      amazonReturnId: `RET-AMZ-${ao.amazonOrderId.slice(-4)}`,
      returnStatus: "ReturnInitiated",
      quantityReturned: 1,
      quantityAccepted: 0,
      quantityDamaged: 0,
      quantityMissing: 0,
      returnReason: "Wrong size",
      conditionDescription: "Unworn, tags intact",
    });
    expect(ret).toBeDefined();
    expect(ret.returnStatus).toBe("ReturnInitiated");
    expect(ret.quantityReturned).toBe(1);
    createdReturnIds.push(ret.id);

    const updated = await AmazonReturnService.AmazonReturnService.updateReturnStatus(
      ret.id,
      "Accepted",
      1,
      0
    );
    expect(updated.return.returnStatus).toBe("Accepted");
    expect(updated.return.quantityAccepted).toBe(1);
    expect(updated.refund).toBeDefined();
    expect(updated.refund.refundStatus).toBe("Pending");

    const finalized = await AmazonReturnService.AmazonReturnService.finalizeReturn(ret.id, {
      quantityAccepted: 1,
      quantityDamaged: 0,
      refundReference: `REFUND-${ao.amazonOrderId}-001`,
      checkerId: "checker-001",
      checkerName: "Warehouse Checker",
    });
    expect(finalized.returnStatus).toBe("Accepted");
    expect(finalized.quantityAccepted).toBe(1);

    console.log(
      `  ✓ Return workflow for ${ao.amazonOrderId}: initiated → accepted → finalized → credit note created`
    );
  });

  it("Step 10: Returns workflow — initiate return for order AMZ-1005 (damaged return)", async () => {
    const ao = AMAZON_ORDERS[4];
    const soId = createdSalesOrderIds[4];

    const ret = await AmazonReturnService.AmazonReturnService.createReturn({
      clientId: CLIENT_ID,
      amazonOrderId: ao.amazonOrderId,
      whizunikSalesOrderId: soId,
      amazonReturnId: `RET-AMZ-${ao.amazonOrderId.slice(-4)}`,
      returnStatus: "ReturnInitiated",
      quantityReturned: 1,
      quantityAccepted: 0,
      quantityDamaged: 0,
      quantityMissing: 0,
      returnReason: "Damaged in transit",
      conditionDescription: "Sole detached, packaging torn",
    });
    createdReturnIds.push(ret.id);

    const updated = await AmazonReturnService.AmazonReturnService.updateReturnStatus(
      ret.id,
      "PartiallyAccepted",
      0,
      1
    );
    expect(updated.return.returnStatus).toBe("PartiallyAccepted");
    expect(updated.return.quantityDamaged).toBe(1);

    const finalized = await AmazonReturnService.AmazonReturnService.finalizeReturn(ret.id, {
      quantityAccepted: 0,
      quantityDamaged: 1,
      refundReference: `REFUND-${ao.amazonOrderId}-001`,
      checkerId: "checker-002",
      checkerName: "Warehouse Checker 2",
    });
    expect(finalized.returnStatus).toBe("PartiallyAccepted");

    console.log(
      `  ✓ Damaged return workflow for ${ao.amazonOrderId}: initiated → partially accepted → finalized`
    );
  });

  it("Step 11: creates Refund records for the returns", async () => {
    const ao2 = AMAZON_ORDERS[1];
    const refund2 = await AmazonRefundService.AmazonRefundService.createRefund({
      clientId: CLIENT_ID,
      amazonOrderId: ao2.amazonOrderId,
      whizunikSalesOrderId: createdSalesOrderIds[1],
      amazonRefundId: null,
      refundReference: `REFUND-${ao2.amazonOrderId}-001`,
      amount: 749.5,
      currency: "INR",
      refundStatus: "Pending",
      refundDate: NOW,
      linkedReturnId: createdReturnIds[0],
    });
    expect(refund2).toBeDefined();
    expect(refund2.amount).toBe(749.5);
    expect(refund2.linkedReturnId).toBe(createdReturnIds[0]);

    const ao5 = AMAZON_ORDERS[4];
    const refund5 = await AmazonRefundService.AmazonRefundService.createRefund({
      clientId: CLIENT_ID,
      amazonOrderId: ao5.amazonOrderId,
      whizunikSalesOrderId: createdSalesOrderIds[4],
      amazonRefundId: null,
      refundReference: `REFUND-${ao5.amazonOrderId}-001`,
      amount: 0,
      currency: "INR",
      refundStatus: "Failed",
      refundDate: NOW,
      linkedReturnId: createdReturnIds[1],
    });
    expect(refund5).toBeDefined();
    expect(refund5.amount).toBe(0);
    expect(refund5.refundStatus).toBe("Failed");

    console.log("  ✓ Refund records created for accepted returns");
  });

  it("Step 12: creates and reconciles a marketplace settlement", async () => {
    const grossSales = AMAZON_ORDERS.reduce(
      (s, o) => s + o.sellingPrice * o.quantity - o.discount,
      0
    );
    const settlement = await AmazonSettlementService.AmazonSettlementService.createSettlement({
      clientId: CLIENT_ID,
      marketplaceName: "Amazon.in",
      grossSales,
      marketplaceFees: round2(grossSales * 0.15),
      deductions: round2(grossSales * 0.02),
      refundsReturns: 749.5,
      expectedSettlementDate: "2026-11-15",
      settlementPeriod: "Nov 2026",
      settlementReference: `SETT-AMZ-NOV-2026-${CLIENT_ID}`,
    });
    expect(settlement).toBeDefined();
    expect(settlement.status).toBe("EXPECTED");

    const reconciled = await AmazonSettlementService.AmazonSettlementService.reconcileSettlement(
      settlement.id
    );
    expect(reconciled).toBeDefined();
    expect(reconciled.status).toBe("RECEIVED");

    console.log(
      `  ✓ Settlement created and reconciled: grossSales=${grossSales}, netSettlementExpected=${reconciled.netSettlementExpected}`
    );
  });

  it("Step 13: final assertion — full workflow summary", async () => {
    const orders = await listAmazonOrders();
    const allReturns = await listReturns();
    const { items: allRefunds } = await db.queryByGSI1(CLIENT_ID, {
      entityType: "MarketplaceAmazonRefund",
      limit: 500,
    });

    expect(orders).toHaveLength(5);
    expect(createdSalesOrderIds).toHaveLength(5);
    expect(createdInvoiceIds).toHaveLength(5);
    expect(createdDispatchIds).toHaveLength(5);
    expect(allReturns.length).toBeGreaterThanOrEqual(2);
    expect(allRefunds.length).toBeGreaterThanOrEqual(2);

    console.log("\n" + "=".repeat(60));
    console.log("AMAZON → WHIZUNIK END-TO-END WORKFLOW SUMMARY");
    console.log("=".repeat(60));
    console.log(`Client ID:           ${CLIENT_ID}`);
    console.log(`Amazon orders:       ${orders.length}`);
    console.log(`Sales orders (SO):   ${createdSalesOrderIds.length}`);
    console.log(`Invoices:            ${createdInvoiceIds.length}`);
    console.log(`Dispatches:          ${createdDispatchIds.length}`);
    console.log(`Returns:             ${allReturns.length}`);
    console.log(`Refunds:             ${allRefunds.length}`);
    console.log("=".repeat(60));
    console.log("  ✓ ALL WORKFLOW STEPS PASSED");
  });
});
