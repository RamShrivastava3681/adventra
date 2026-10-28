/**
 * GST-inclusive pricing.
 *
 * Catalogue prices (118 @ 18%) are the amount the buyer pays, so 118 is billed
 * as-is and splits into 100 taxable value + 18 GST. Documents must total the
 * prices as entered — never price × (1 + GST%).
 */
import { describe, it, expect } from "vitest";
import { exGstPrice, inclusiveTotals, splitGstInclusive } from "../../lib/gst.js";
import * as Invoice from "../../models/invoice.js";
import * as PurchaseInvoice from "../../models/purchase-invoice.js";
import * as GoodsSO from "../../models/goods-sales-order.js";
import * as GoodsPO from "../../models/goods-purchase-order.js";
import * as Proforma from "../../models/purchase-order.js";
import { computeReturnTotals, normalizeReturnLines } from "../../lib/purchase-returns.js";

const invoiceLine = (over: Record<string, any> = {}) =>
  ({
    productId: "p1",
    sku: "SKU-1",
    name: "Tee",
    unit: "pc",
    quantity: 1,
    unitPrice: 118,
    discountPct: null,
    gstRate: 18,
    hsnCode: "61091000",
    rateInclTax: null,
    lineTotal: 0,
    ...over,
  }) as any;

const soLine = (over: Record<string, any> = {}) =>
  ({
    productId: "p1",
    sku: "SKU-1",
    name: "Tee",
    unit: "pc",
    orderedQty: 1,
    unitPrice: 118,
    discountPct: null,
    gstRate: 18,
    dispatchedQty: 0,
    lineTotal: 0,
    notes: null,
    ...over,
  }) as any;

describe("splitGstInclusive", () => {
  it("splits 118 at 18% into 100 + 18", () => {
    expect(splitGstInclusive(118, 18)).toEqual({ taxableValue: 100, gstAmount: 18, total: 118 });
  });

  it("returns the amount as taxable when there is no GST", () => {
    expect(splitGstInclusive(118, 0)).toEqual({ taxableValue: 118, gstAmount: 0, total: 118 });
    expect(splitGstInclusive(118, null)).toEqual({ taxableValue: 118, gstAmount: 0, total: 118 });
  });

  it("gives a per-piece ex-GST value", () => {
    expect(exGstPrice(118, 18)).toBe(100);
    expect(exGstPrice(118, 12)).toBe(105.36);
    expect(exGstPrice(1000, 5)).toBe(952.38);
  });

  it("treats negative and out-of-range rates as no GST / 100%", () => {
    expect(exGstPrice(118, -18)).toBe(118);
    expect(exGstPrice(118, 100)).toBe(59);
  });
});

describe("inclusiveTotals", () => {
  it("totals the amounts as entered and reports the GST inside them", () => {
    const totals = inclusiveTotals(
      [
        { amount: 118, gstRate: 18 },
        { amount: 236, gstRate: 18 },
      ],
      0,
    );
    expect(totals.subtotal).toBe(300);
    expect(totals.gstTotal).toBe(54);
    expect(totals.grandTotal).toBe(354);
    // The parts always re-add to the amount as entered.
    expect(totals.subtotal + totals.gstTotal + totals.freight).toBe(totals.grandTotal);
  });

  it("adds freight on top without touching the GST split", () => {
    const totals = inclusiveTotals([{ amount: 118, gstRate: 18 }], 50);
    expect(totals.subtotal).toBe(100);
    expect(totals.gstTotal).toBe(18);
    expect(totals.freight).toBe(50);
    expect(totals.grandTotal).toBe(168);
  });

  it("mixes rates per line", () => {
    const totals = inclusiveTotals(
      [
        { amount: 118, gstRate: 18 },
        { amount: 112, gstRate: 12 },
        { amount: 105, gstRate: 5 },
      ],
      0,
    );
    expect(totals.subtotal).toBe(300);
    expect(totals.gstTotal).toBe(35);
    expect(totals.grandTotal).toBe(335);
  });
});

describe("sales invoice totals", () => {
  it("bills 2 × 118 at 18% as 236, not 278.48", () => {
    const totals = Invoice.computeTotals([invoiceLine({ quantity: 2 })], 0);
    expect(totals.grandTotal).toBe(236);
    expect(totals.subtotalGoods).toBe(200);
    expect(totals.gstTotal).toBe(36);
  });

  it("splits GST on the discounted amount", () => {
    const totals = Invoice.computeTotals([invoiceLine({ quantity: 2, discountPct: 10 })], 0);
    expect(totals.grandTotal).toBe(212.4);
    expect(totals.subtotalGoods).toBe(180);
    expect(totals.gstTotal).toBe(32.4);
    expect(totals.totalDiscount).toBe(23.6);
  });

  it("treats the unit price as the tax-inclusive rate", () => {
    const totals = Invoice.computeTotals([invoiceLine({ quantity: 1 })], 0);
    expect(totals.grandTotal).toBe(118);
  });
});

describe("sales order totals", () => {
  it("bills the catalogue price as entered", () => {
    const totals = GoodsSO.computeTotals([soLine({ orderedQty: 3 })], 0);
    expect(totals.grandTotal).toBe(354);
    expect(totals.subtotal).toBe(300);
    expect(totals.gstTotal).toBe(54);
    expect(totals.totalQty).toBe(3);
  });

  it("applies the line discount before splitting GST", () => {
    const totals = GoodsSO.computeTotals([soLine({ orderedQty: 2, discountPct: 50 })], 0);
    expect(totals.grandTotal).toBe(118);
    expect(totals.subtotal).toBe(100);
    expect(totals.gstTotal).toBe(18);
    expect(totals.totalDiscount).toBe(118);
  });
});

describe("purchase side totals", () => {
  it("goods PO adds freight without adding GST again", () => {
    const totals = GoodsPO.computeTotals(
      [
        {
          productId: "p1",
          sku: "SKU-1",
          name: "Tee",
          unit: "pc",
          orderedQty: 2,
          unitPrice: 118,
          discountPct: null,
          gstRate: 18,
          receivedQty: 0,
          lineTotal: 0,
        } as any,
      ],
      40,
    );
    expect(totals.subtotal).toBe(200);
    expect(totals.gstTotal).toBe(36);
    expect(totals.grandTotal).toBe(276);
  });

  it("purchase invoice totals the billed amount as entered", () => {
    const totals = PurchaseInvoice.computeTotals(
      [
        {
          productId: "p1",
          sku: "SKU-1",
          name: "Tee",
          unit: "pc",
          orderedQty: 2,
          grnReceivedQty: 2,
          invoiceQty: 2,
          unitPrice: 118,
          poUnitPrice: 118,
          gstRate: 18,
          lineTotal: 0,
        } as any,
      ],
      0,
    );
    expect(totals.grandTotal).toBe(236);
    expect(totals.subtotal).toBe(200);
    expect(totals.gstTotal).toBe(36);
  });

  it("proforma totals the quoted amount as entered", () => {
    const totals = Proforma.computeProformaTotals(
      [
        {
          productId: "p1",
          sku: "SKU-1",
          name: "Tee",
          hsnCode: null,
          unit: "pc",
          quantity: 2,
          unitPrice: 118,
          gstRate: 18,
          lineTotal: 0,
        } as any,
      ],
      0,
    );
    expect(totals.grandTotal).toBe(236);
    expect(totals.subtotal).toBe(200);
    expect(totals.gstTotal).toBe(36);
  });
});

describe("purchase return totals", () => {
  it("credits the returned amount as entered, splitting its GST", () => {
    const lines = normalizeReturnLines(
      [
        {
          productId: "p1",
          sku: "SKU-1",
          name: "Tee",
          unit: "pc",
          invoiceQty: 10,
          unitPrice: 118,
          gstRate: 18,
        },
      ],
      [{ productId: "p1", returnQty: 2 }],
    );
    expect(lines[0].unitPriceExGst).toBe(100);
    const totals = computeReturnTotals(lines);
    expect(totals.subtotal).toBe(200);
    expect(totals.gstTotal).toBe(36);
    expect(totals.totalAmount).toBe(236);
  });
});
