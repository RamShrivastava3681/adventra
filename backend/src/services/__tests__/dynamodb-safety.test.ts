import { afterEach, describe, expect, it, vi } from "vitest";
import { shouldBackfillGsi2 } from "../../lib/gsi2-backfill.js";
import { resolveScanSource } from "../../config.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DynamoDB read source safety", () => {
  it("defaults to GSI2 queries so normal workflows never scan", () => {
    expect(resolveScanSource(undefined, undefined)).toBe("gsi2");
    expect(resolveScanSource(undefined, "true")).toBe("gsi2");
    expect(resolveScanSource("gsi2", undefined)).toBe("gsi2");
    expect(resolveScanSource("gsi2", "true")).toBe("gsi2");
  });

  it("honours the explicit scan escape hatches", () => {
    expect(resolveScanSource("scan", undefined)).toBe("scan");
    expect(resolveScanSource("scan", "true")).toBe("scan");
  });

  it("falls back to scans when the verified flag is explicitly disabled", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveScanSource(undefined, "false")).toBe("scan");
    expect(resolveScanSource("gsi2", "false")).toBe("scan");
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("GSI2 backfill safety", () => {
  it("backfills records that have an entity type but no gsi2pk", () => {
    expect(shouldBackfillGsi2({ pk: "INVOICE#1", sk: "INVOICE#1", entityType: "Invoice" })).toBe(true);
  });

  it("does not modify records that already have both index keys", () => {
    expect(shouldBackfillGsi2({
      pk: "INVOICE#1",
      sk: "INVOICE#1",
      entityType: "Invoice",
      gsi2pk: "Invoice",
      gsi2sk: "Invoice#INV-001",
    })).toBe(false);
  });

  it("repairs a record that has a partition key but no sort key", () => {
    expect(shouldBackfillGsi2({
      pk: "INVOICE#1",
      sk: "INVOICE#1",
      entityType: "Invoice",
      gsi2pk: "Invoice",
    })).toBe(true);
  });

  it("does not invent an index key for untyped records", () => {
    expect(shouldBackfillGsi2({ pk: "UNKNOWN#1", sk: "UNKNOWN#1" })).toBe(false);
  });

  it("backfills Submission with its user/type partition", () => {
    expect(shouldBackfillGsi2({
      pk: "USER#u1",
      sk: "SUBMISSION#s1",
      entityType: "Submission",
      userId: "u1",
      type: "visit",
    })).toBe(true);
  });

  it("skips internal lookup pointer records", () => {
    expect(shouldBackfillGsi2({
      pk: "USEREMAIL#a@b.com",
      sk: "USEREMAIL#a@b.com",
      entityType: "UserEmail",
    })).toBe(false);
    expect(shouldBackfillGsi2({
      pk: "WTASKDOC#po#1",
      sk: "TASK#1",
      entityType: "WorkflowTaskRef",
    })).toBe(false);
  });
});
