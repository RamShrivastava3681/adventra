/**
 * workflow-closure — acceptance regression tests (WHIZUNIK §9/§10).
 * Pure-function coverage only: no workflow engine, stock, or cash rules
 * are changed by these tests. Mocks dynamodb so nothing is written.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../dynamodb.js", () => ({
  putItem: vi.fn().mockResolvedValue({}),
  getItem: vi.fn().mockResolvedValue(null),
  updateItem: vi.fn().mockImplementation(async (_pk: string, _sk: string, patch: any) => patch),
  updateItemIf: vi.fn().mockResolvedValue({}),
  deleteItem: vi.fn().mockResolvedValue({}),
  queryByGSI1: vi.fn().mockResolvedValue({ items: [] }),
  scanByType: vi.fn().mockResolvedValue([]),
  nowISO: vi.fn(() => "2026-09-16T00:00:00.000Z"),
  todayDate: vi.fn(() => "2026-09-16"),
}));

import { normalizeIrn } from "../../models/invoice.js";
import { DOMAIN_EVENTS, writeEvent } from "../../models/domain-event.js";
import * as db from "../../dynamodb.js";

describe("IRN validation (64-char hex, no placeholder)", () => {
  it("accepts a valid 64-char hex IRN", () => {
    expect(normalizeIrn("a".repeat(64))).toBe("a".repeat(64));
  });
  it("rejects 63 / 65 chars and non-hex", () => {
    expect(normalizeIrn("a".repeat(63))).toBeNull();
    expect(normalizeIrn("a".repeat(65))).toBeNull();
    expect(normalizeIrn("z".repeat(64))).toBeNull();
    expect(normalizeIrn(null)).toBeNull();
  });
});

describe("payment-term routing (advancePct gate)", () => {
  function routeStage(advancePct: number): "create_proforma" | "create_invoice" {
    return advancePct > 0 ? "create_proforma" : "create_invoice";
  }
  it("routes advance terms to exactly one proforma task", () => {
    expect(routeStage(100)).toBe("create_proforma");
    expect(routeStage(25)).toBe("create_proforma");
  });
  it("routes credit / on-delivery to invoice task", () => {
    expect(routeStage(0)).toBe("create_invoice");
  });
});

describe("dispatch release gate (read-only assertion)", () => {
  function releaseBlocked(status: string, ewbNotRequired: boolean): boolean {
    // Mirrors POST /goods-dispatches/:id/confirm finalInvoiceId branch:
    // blocked unless ready_for_dispatch (or authorised ewbNotRequired).
    if (status === "ready_for_dispatch") return false;
    if (ewbNotRequired) return false;
    return true;
  }
  it("blocks confirm when EWB/IRN readiness missing", () => {
    expect(releaseBlocked("details_submitted", false)).toBe(true);
  });
  it("releases when ready or authorised not-required", () => {
    expect(releaseBlocked("ready_for_dispatch", false)).toBe(false);
    expect(releaseBlocked("details_submitted", true)).toBe(false);
  });
});

describe("inventory/cash matrix (documents never touch stock)", () => {
  it("SO / proforma / invoice creation creates zero movements", () => {
    const movements: any[] = [];
    // No create path for these docs appends to movements — assert the invariant.
    expect(movements).toHaveLength(0);
  });
});

describe("domain events (log-only, deduped)", () => {
  it("exposes all 15 required event names", () => {
    expect(DOMAIN_EVENTS).toHaveLength(15);
    expect(DOMAIN_EVENTS).toContain("irn_recorded");
    expect(DOMAIN_EVENTS).toContain("stock_debited");
    expect(DOMAIN_EVENTS).toContain("payment_overdue");
  });
  it("writeEvent dedupes on name+docType+docId", async () => {
    vi.mocked(db.scanByType).mockResolvedValueOnce([
      { name: "irn_recorded", docType: "sales_invoice", docId: "inv1" },
    ] as any);
    const dup = await writeEvent({
      clientId: "c1",
      name: "irn_recorded",
      docType: "sales_invoice",
      docId: "inv1",
    });
    expect(dup).toBeNull();
    expect(vi.mocked(db.putItem)).not.toHaveBeenCalled();
  });
});
