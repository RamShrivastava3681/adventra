import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listAllByType: vi.fn(async (entityType: string) => [{ id: entityType, entityType }]),
  queryByPk: vi.fn(async () => ({ items: [] as any[], lastKey: undefined })),
  getItem: vi.fn(async () => null),
  putItem: vi.fn(async () => undefined),
}));

vi.mock("../../dynamodb.js", () => ({
  listAllByType: mocks.listAllByType,
  queryByPk: mocks.queryByPk,
  getItem: mocks.getItem,
  putItem: mocks.putItem,
  nowISO: () => "2026-01-01T00:00:00.000Z",
}));

import { createRequestContext, getDashboardOverview } from "../tally/engine.js";

function scannedTypes(): string[] {
  return mocks.listAllByType.mock.calls.map(([entityType]) => entityType as string);
}

describe("Tally request read context", () => {
  beforeEach(() => {
    mocks.listAllByType.mockClear();
    mocks.queryByPk.mockClear();
  });

  it("scans each entity type at most once per request", async () => {
    const ctx = createRequestContext("client-1");

    await Promise.all([ctx.debtors(), ctx.debtors(), ctx.invoices(), ctx.debtors()]);
    await ctx.invoices();

    expect(scannedTypes()).toEqual(["Debtor", "Invoice"]);
  });

  it("loads export tracking and batches once even when awaited repeatedly", async () => {
    const ctx = createRequestContext("client-1");

    await Promise.all([ctx.exportRecords(), ctx.exportRecordMap(), ctx.exportRecords()]);
    await ctx.batches();
    await ctx.batches();

    expect(mocks.queryByPk).toHaveBeenCalledTimes(2);
  });

  it("reuses one cache across all eleven dashboard export types", async () => {
    const data = await getDashboardOverview("client-1");

    const counts = new Map<string, number>();
    for (const type of scannedTypes()) {
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }

    expect(counts.size).toBeGreaterThan(0);
    for (const [type, count] of counts) {
      expect(count, `${type} should be scanned once`).toBe(1);
    }
    expect(data.entityStats.sales.eligible).toBe(1);
  });
});
