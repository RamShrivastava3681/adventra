import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProduct: vi.fn(async () => null as any),
  getByProduct: vi.fn(async () => [] as any[]),
  getConfig: vi.fn(async () => null as any),
  listExportRecords: vi.fn(async () => [] as any[]),
  listBatchSummaries: vi.fn(async () => [] as any[]),
  getVendor: vi.fn(async () => null as any),
  getSupplier: vi.fn(async () => null as any),
  getPurchaseInvoice: vi.fn(async () => null as any),
}));

vi.mock("../../models/product.js", () => ({ get: mocks.getProduct }));
vi.mock("../../models/stock-movement.js", () => ({ get: vi.fn(), getByProduct: mocks.getByProduct }));
vi.mock("../../models/vendor.js", () => ({ get: mocks.getVendor }));
vi.mock("../../models/supplier.js", () => ({ get: mocks.getSupplier }));
vi.mock("../../models/purchase-invoice.js", () => ({ get: mocks.getPurchaseInvoice }));
vi.mock("../../models/tally.js", async () => {
  const actual = await vi.importActual<typeof import("../../models/tally.js")>("../../models/tally.js");
  return {
    ...actual,
    getConfig: mocks.getConfig,
    listExportRecords: mocks.listExportRecords,
    listBatchSummaries: mocks.listBatchSummaries,
  };
});
vi.mock("../../dynamodb.js", () => ({
  nowISO: () => "2026-01-01T00:00:00.000Z",
  queryByPk: vi.fn(async () => ({ items: [] })),
  getItem: vi.fn(async () => null),
}));

import { buildRecords } from "../tally/engine.js";

const config: any = {
  companyName: "Test Co",
  homeState: "Uttar Pradesh",
  gstin: "09AABCU9603R1ZM",
  godownName: "Main Warehouse",
  defaultUnit: "pics",
  stockGroup: "Primary",
  batchName: "Primary Batch",
  gstApplicableFrom: "2026-04-01",
  mappings: {
    salesLedger: "Sales",
    purchaseLedger: "Purchase",
    roundOffLedger: "Round Off",
    debtorsGroup: "Sundry Debtors",
    creditorsGroup: "Sundry Creditors",
    cgstInputLedger: "CGST Input",
    sgstInputLedger: "SGST Input",
    igstInputLedger: "IGST Input",
    cgstOutputLedger: "CGST Output",
    sgstOutputLedger: "SGST Output",
    igstOutputLedger: "IGST Output",
  },
  allowDuplicateReExport: false,
};

const product: any = {
  id: "p1",
  name: "Test Backpack",
  sku: "TEST-1",
  hsnCode: "42029200",
  gstRate: 18,
  unitOfMeasure: "pics",
  unitPrice: 2450,
  unitCost: 1400,
  category: "Backpacks",
};

describe("Tally stock-item opening balance", () => {
  it("includes confirmed opening stock in the stock item master XML", async () => {
    mocks.getProduct.mockResolvedValue(product);
    mocks.getConfig.mockResolvedValue(config);
    mocks.getByProduct.mockResolvedValue([
      { productId: "p1", status: "confirmed", direction: "in", quantity: 100, unitCost: 1400 },
    ]);

    const { prepared } = await buildRecords("client-1", "stock-items", config, ["p1"]);

    expect(prepared).toHaveLength(1);
    expect(prepared[0].errors).toEqual([]);
    expect(prepared[0].xml).toContain("<OPENINGBALANCE>100.00 pics</OPENINGBALANCE>");
    expect(prepared[0].xml).toContain("<OPENINGVALUE>-140000.00</OPENINGVALUE>");
    expect(prepared[0].xml).toContain("<OPENINGRATE>1400.0000/pics</OPENINGRATE>");
    expect(mocks.getByProduct).toHaveBeenCalledWith("client-1", "p1");
  });

  it("resolves a Supplier record as the purchase party when no Vendor exists", async () => {
    mocks.getProduct.mockResolvedValue(product);
    mocks.getConfig.mockResolvedValue(config);
    mocks.getVendor.mockResolvedValue(null);
    mocks.getSupplier.mockResolvedValue({ id: "s1", companyName: "Test Supplier", stateCode: "27" });
    mocks.getPurchaseInvoice.mockResolvedValue({
      id: "pi1",
      invoiceNumber: "TEST-PI-1",
      vendorId: "s1",
      issueDate: "2026-01-01",
      status: "paid",
      lines: [
        {
          productId: "p1",
          sku: "TEST-1",
          name: "Test Backpack",
          unit: "pics",
          invoiceQty: 2,
          unitPrice: 1000,
          gstRate: 18,
          lineTotal: 2000,
        },
      ],
      subtotal: 1694.92,
      gstTotal: 305.08,
      grandTotal: 2000,
      amountPaid: 2000,
      paidDate: "2026-01-02",
    });

    const { prepared } = await buildRecords("client-1", "purchases", config, ["pi1"]);

    expect(prepared).toHaveLength(1);
    expect(prepared[0].errors).toEqual([]);
    expect(prepared[0].party).toBe("Test Supplier");
    expect(prepared[0].xml).toContain("Test Supplier");
    expect(mocks.getSupplier).toHaveBeenCalledWith("s1");
  });
});
