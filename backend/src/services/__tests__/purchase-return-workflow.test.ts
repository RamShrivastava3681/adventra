/**
 * Purchase-return workflow — finance half.
 *
 * Uses an in-memory DynamoDB mock to exercise the real models + the supplier
 * credit service: create an invoice, raise a debit note, apply it, verify the
 * invoice is never reopened and the remaining note stays as supplier credit.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const store = new Map<string, any>();
const key = (pk: string, sk: string) => `${pk}::${sk}`;

vi.mock("../../dynamodb.js", () => ({
  putItem: vi.fn(async (item: any) => {
    store.set(key(item.pk, item.sk), { ...item });
    return item;
  }),
  getItem: vi.fn(async (pk: string, sk?: string) => store.get(key(pk, sk ?? pk)) ?? null),
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
  queryByGSI1: vi.fn(async (_clientId: string, opts: any) => ({
    items: [...store.values()].filter((i) => i.entityType === opts.entityType),
  })),
  scanByType: vi.fn(async (type: string) => [...store.values()].filter((i) => i.entityType === type)),
  nowISO: vi.fn(() => "2026-10-27T00:00:00.000Z"),
  todayDate: vi.fn(() => "2026-10-27"),
}));

import * as PurchaseInvoice from "../../models/purchase-invoice.js";
import * as CreditDebitNote from "../../models/credit-debit-note.js";
import * as PurchaseReturn from "../../models/purchase-return.js";
import {
  applyDebitNoteToInvoice,
  listSupplierCredits,
} from "../purchase-credit.js";
import { computeReturnTotals, normalizeReturnLines } from "../../lib/purchase-returns.js";

const invoiceLines = [
  {
    productId: "p1",
    sku: "SKU-1",
    name: "Trekking Backpack",
    unit: "piece",
    orderedQty: 10,
    grnReceivedQty: 10,
    invoiceQty: 10,
    unitPrice: 1000,
    poUnitPrice: 1000,
    gstRate: 18,
    lineTotal: 10000,
  },
];

async function makeInvoice(overrides: Record<string, any> = {}) {
  return PurchaseInvoice.create({
    clientId: "client-1",
    vendorId: "supplier-1",
    invoiceNumber: `INV-${Math.random().toString(36).slice(2, 8)}`,
    supplierName: "Acme Supplies",
    lines: invoiceLines as any,
    status: "approved_for_payment",
    ...overrides,
  });
}

async function makeNote(amount: number, supplierId = "supplier-1") {
  return CreditDebitNote.create({
    clientId: "client-1",
    kind: "debit",
    noteNumber: `DN-${Math.random().toString(36).slice(2, 8)}`,
    amount,
    status: "approved",
    supplierId,
    purchaseInvoiceId: "pi-1",
    counterparty: "Acme Supplies",
    source: "purchase_return",
  });
}

beforeEach(() => store.clear());

describe("purchase return — debit note applies without reopening the invoice", () => {
  it("reduces the open invoice balance and keeps the invoice amount untouched", async () => {
    const invoice = await makeInvoice();
    // Unit prices are GST-inclusive: 10 × 1,000 is the payable, GST inside it.
    expect(invoice.amount).toBe(10000);
    expect(invoice.balanceDue).toBe(10000);
    expect(invoice.creditAdjusted).toBe(0);

    const note = await makeNote(3000);
    const result = await applyDebitNoteToInvoice("client-1", invoice.id, note.id);

    expect(result.applied).toBe(3000);
    expect(result.remainingNote).toBe(0);

    const fresh = await PurchaseInvoice.get(invoice.id);
    expect(fresh!.amount).toBe(10000); // original payable preserved
    expect(fresh!.creditAdjusted).toBe(3000);
    expect(fresh!.balanceDue).toBe(7000); // 10,000 − 3,000 credit

    const freshNote = await CreditDebitNote.get(note.id);
    expect(freshNote!.appliedAmount).toBe(3000);
  });

  it("caps the note at the invoice outstanding and leaves the rest as supplier credit", async () => {
    const invoice = await makeInvoice();
    const note = await makeNote(20000);

    const result = await applyDebitNoteToInvoice("client-1", invoice.id, note.id);
    expect(result.applied).toBe(10000);
    expect(result.remainingNote).toBe(10000);

    const fresh = await PurchaseInvoice.get(invoice.id);
    expect(fresh!.balanceDue).toBe(0);
    expect(fresh!.creditAdjusted).toBe(10000);

    const credits = await listSupplierCredits("client-1", "supplier-1");
    expect(credits.total).toBe(10000);
    expect(credits.credits[0].remainingAmount).toBe(10000);
  });

  it("keeps the full note as credit when the invoice is already paid", async () => {
    const invoice = await makeInvoice({ amountPaid: 10000 });
    expect(invoice.balanceDue).toBe(0);

    const note = await makeNote(2000);
    const result = await applyDebitNoteToInvoice("client-1", invoice.id, note.id);
    expect(result.applied).toBe(0);
    expect(result.remainingNote).toBe(2000);

    const fresh = await PurchaseInvoice.get(invoice.id);
    expect(fresh!.amount).toBe(10000);
    expect(fresh!.amountPaid).toBe(10000);
    expect(fresh!.balanceDue).toBe(0);
    expect(fresh!.status).toBe("approved_for_payment"); // status untouched by credit
  });

  it("never applies the same note twice", async () => {
    const invoice = await makeInvoice();
    const note = await makeNote(3000);
    const first = await applyDebitNoteToInvoice("client-1", invoice.id, note.id);
    expect(first.applied).toBe(3000);
    const second = await applyDebitNoteToInvoice("client-1", invoice.id, note.id);
    expect(second.applied).toBe(0);
    const fresh = await PurchaseInvoice.get(invoice.id);
    expect(fresh!.creditAdjusted).toBe(3000);
  });

  it("rejects a note from a different supplier", async () => {
    const invoice = await makeInvoice();
    const note = await makeNote(3000, "supplier-2");
    await expect(
      applyDebitNoteToInvoice("client-1", invoice.id, note.id),
    ).rejects.toThrow(/different supplier/);
  });
});

describe("purchase return — return quantities feed the debit note amount", () => {
  it("builds a validated return from invoice lines and totals it", () => {
    const lines = normalizeReturnLines(
      [
        {
          productId: "p1",
          sku: "SKU-1",
          name: "Trekking Backpack",
          unit: "piece",
          invoiceQty: 10,
          unitPrice: 1000,
          gstRate: 18,
        },
      ],
      [{ productId: "p1", returnQty: 2 }],
    );
    const totals = computeReturnTotals(lines);
    // 2 × 1,000 GST-inclusive: 2,000 credited, 1,694.92 of it taxable value.
    expect(totals.subtotal).toBe(1694.92);
    expect(totals.gstTotal).toBe(305.08);
    expect(totals.totalAmount).toBe(2000);
  });

  it("persists a pending return with no stock or balance effect", async () => {
    const invoice = await makeInvoice();
    const ret = await PurchaseReturn.create({
      clientId: "client-1",
      purchaseInvoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      supplierId: invoice.vendorId,
      supplierName: invoice.supplierName,
      lines: normalizeReturnLines(
        invoiceLines as any,
        [{ productId: "p1", returnQty: 1 }],
      ),
      subtotal: 1000,
      gstTotal: 180,
      totalAmount: 1180,
    });
    expect(ret.status).toBe("pending_approval");
    expect(ret.stockAppliedAt).toBeNull();
    const freshInvoice = await PurchaseInvoice.get(invoice.id);
    expect(freshInvoice!.balanceDue).toBe(10000);
    expect(freshInvoice!.creditAdjusted).toBe(0);
  });
});
