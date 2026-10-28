/**
 * Purchase returns — quantity and supplier-credit rules.
 * Pure-function coverage only (no DynamoDB, stock, or route side effects).
 */
import { describe, it, expect } from "vitest";
import {
  computeCreditApplication,
  computeEligibleQty,
  computeInvoiceOutstanding,
  computeNoteRemaining,
  computeReturnTotals,
  normalizeReturnLines,
} from "../../lib/purchase-returns.js";

const invoiceLines = [
  {
    productId: "p1",
    sku: "SKU-1",
    name: "Trekking Backpack",
    unit: "piece",
    invoiceQty: 10,
    unitPrice: 1000,
    gstRate: 18,
  },
  {
    productId: "p2",
    sku: "SKU-2",
    name: "Water Bottle",
    unit: "piece",
    invoiceQty: 4,
    unitPrice: 250,
    gstRate: 0,
  },
];

describe("eligible return quantity", () => {
  it("subtracts previously returned units and never goes negative", () => {
    expect(computeEligibleQty(10, 3)).toBe(7);
    expect(computeEligibleQty(10, 10)).toBe(0);
    expect(computeEligibleQty(10, 15)).toBe(0);
  });
});

describe("normalizeReturnLines", () => {
  it("normalises a valid partial return and snapshots line values", () => {
    const lines = normalizeReturnLines(invoiceLines, [
      { productId: "p1", returnQty: 3 },
      { productId: "p2", returnQty: 1 },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      productId: "p1",
      eligibleQty: 10,
      returnQty: 3,
      unitPrice: 1000,
      lineTotal: 3000,
      gstRate: 18,
    });
    expect(lines[1].lineTotal).toBe(250);
  });

  it("accounts for units already returned against the invoice", () => {
    const lines = normalizeReturnLines(
      invoiceLines,
      [{ productId: "p1", returnQty: 7 }],
      { p1: 3 },
    );
    expect(lines[0].previouslyReturnedQty).toBe(3);
    expect(lines[0].eligibleQty).toBe(7);
    expect(lines[0].returnQty).toBe(7);
  });

  it("rejects a return above the unreturned quantity", () => {
    expect(() =>
      normalizeReturnLines(invoiceLines, [{ productId: "p1", returnQty: 11 }]),
    ).toThrow(/only 10 unreturned/);
    expect(() =>
      normalizeReturnLines(
        invoiceLines,
        [{ productId: "p1", returnQty: 8 }],
        { p1: 3 },
      ),
    ).toThrow(/only 7 unreturned/);
  });

  it("rejects zero/negative quantities and unknown products", () => {
    expect(() =>
      normalizeReturnLines(invoiceLines, [{ productId: "p1", returnQty: 0 }]),
    ).toThrow(/greater than zero/);
    expect(() =>
      normalizeReturnLines(invoiceLines, [{ productId: "nope", returnQty: 1 }]),
    ).toThrow(/does not belong/);
    expect(() => normalizeReturnLines(invoiceLines, [])).toThrow(/at least one/);
  });

  it("sums duplicate rows for the same product", () => {
    const lines = normalizeReturnLines(invoiceLines, [
      { productId: "p1", returnQty: 2 },
      { productId: "p1", returnQty: 3 },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].returnQty).toBe(5);
  });
});

describe("return totals", () => {
  it("computes subtotal, GST and total", () => {
    const lines = normalizeReturnLines(invoiceLines, [
      { productId: "p1", returnQty: 2 }, // 2,000 including 18% GST
      { productId: "p2", returnQty: 1 }, // 250, no GST
    ]);
    const totals = computeReturnTotals(lines);
    // Credit is the returned amount as entered; GST is the part inside it.
    expect(totals.subtotal).toBe(1944.92);
    expect(totals.gstTotal).toBe(305.08);
    expect(totals.totalAmount).toBe(2250);
  });
});

describe("supplier credit application", () => {
  const invoice = { amount: 10000, amountPaid: 0, creditAdjusted: 0 };
  const note = { amount: 2000, appliedAmount: 0 };

  it("computes invoice outstanding and note remaining", () => {
    expect(computeInvoiceOutstanding(invoice)).toBe(10000);
    expect(
      computeInvoiceOutstanding({ amount: 10000, amountPaid: 4000, creditAdjusted: 1000 }),
    ).toBe(5000);
    expect(computeNoteRemaining({ amount: 2000, appliedAmount: 500 })).toBe(1500);
  });

  it("caps at the invoice outstanding when the invoice is smaller than the note", () => {
    expect(
      computeCreditApplication({ noteRemaining: 2000, invoiceOutstanding: 1500 }),
    ).toBe(1500);
  });

  it("returns 0 when the invoice is settled (credit stays available)", () => {
    expect(
      computeCreditApplication({ noteRemaining: 2000, invoiceOutstanding: 0 }),
    ).toBe(0);
  });

  it("supports full and partial explicit applications", () => {
    expect(
      computeCreditApplication({
        noteRemaining: 2000,
        invoiceOutstanding: 5000,
        requestedAmount: 2000,
      }),
    ).toBe(2000);
    expect(
      computeCreditApplication({
        noteRemaining: 2000,
        invoiceOutstanding: 5000,
        requestedAmount: 750,
      }),
    ).toBe(750);
  });

  it("rejects over-application and non-positive requests", () => {
    expect(() =>
      computeCreditApplication({
        noteRemaining: 2000,
        invoiceOutstanding: 5000,
        requestedAmount: 2500,
      }),
    ).toThrow(/at most 2000/);
    expect(() =>
      computeCreditApplication({
        noteRemaining: 2000,
        invoiceOutstanding: 5000,
        requestedAmount: 0,
      }),
    ).toThrow(/greater than zero/);
  });
});
