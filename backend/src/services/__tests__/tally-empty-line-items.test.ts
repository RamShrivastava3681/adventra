import { describe, expect, it, vi } from "vitest";

// Live case ADV-26/27-SI-006: the invoice has `lineItems: []` next to its real `lines`.
// Product lookup used `items || lineItems || lines`, stopped at the empty array and
// reported "Referenced master missing — stock item" for a product that exists.
const PRODUCT = "a301081c-534f-492b-bbdd-904f5bf8604e";
const INVOICE = "8aced1ce-4363-4efa-a72d-5cafba0d64df";
const DEBTOR = "3c33dcf1-9536-40c5-9df2-c162bcfb5812";

const items = vi.hoisted(() => new Map<string, any>());

vi.mock("../../dynamodb.js", () => ({
  listAllByType: vi.fn(async () => []),
  queryByPk: vi.fn(async () => ({ items: [] as any[], lastKey: undefined })),
  getItem: vi.fn(async (pk: string) => items.get(pk) ?? null),
  putItem: vi.fn(async () => undefined),
  nowISO: () => "2026-11-25T00:00:00.000Z",
}));

import { SUGGESTED_MAPPING } from "../../models/tally.js";
import { validateRecords } from "../tally/engine.js";

items.set("TALLY_CONFIG#shared", {
  clientId: "shared", companyName: "Whizunik", godownName: "Main Warehouse", homeState: "Uttar Pradesh",
  defaultUnit: "pics", stockGroup: "Primary", gstRegistrationType: "Regular", gstApplicableFrom: "2026-10-01",
  gstin: "09AAACW0000A1Z5", allowDuplicateReExport: false, mappings: SUGGESTED_MAPPING,
});
items.set(`PRODUCT#${PRODUCT}`, {
  id: PRODUCT, clientId: "tally-demo", sku: "TD-TSHIRT-001", name: "Tally Demo Cotton T-Shirt",
  hsnCode: "61091000", unitOfMeasure: "piece", gstRate: 18, status: "active",
});
items.set(`DEBTOR#${DEBTOR}`, { id: DEBTOR, name: "Tally Demo Customer", state: "Uttar Pradesh" });
items.set(`INVOICE#${INVOICE}`, {
  id: INVOICE, clientId: "f9133e76", debtorId: DEBTOR, invoiceNumber: "ADV-26/27-SI-006", issueDate: "2026-11-25",
  amount: 590, grandTotal: 590, subtotalGoods: 500, gstTotal: 90, status: "approved",
  lineItems: [],
  lines: [{ productId: PRODUCT, sku: "TD-TSHIRT-001", name: "Tally Demo Cotton T-Shirt", unit: "piece", quantity: 1,
    unitPrice: 590, gstRate: 18, hsnCode: "61091000", rateInclTax: 590, lineTotal: 590 }],
});

describe("Tally product lookup with an empty lineItems array", () => {
  it("finds the stock item from `lines` when `lineItems` is []", async () => {
    const r: any = await validateRecords("f9133e76", "sales", [INVOICE]);
    expect(r.configError ?? null).toBeNull();
    const errors = r.records.flatMap((x: any) => x.errors);
    expect(errors.join(" ")).not.toMatch(/Referenced master missing/);
  });
});
