import { afterEach, describe, expect, it, vi } from "vitest";
import { shouldBackfillGsi2 } from "../../lib/gsi2-backfill.js";
import { resolveScanSource } from "../../config.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DynamoDB read source safety", () => {
  it("defaults to scans so unbackfilled records stay visible to exports", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveScanSource(undefined, undefined)).toBe("scan");
    expect(resolveScanSource("scan", "true")).toBe("scan");
    expect(resolveScanSource("gsi2", undefined)).toBe("scan");
  });

  it("ignores an unverified GSI2 request with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveScanSource("gsi2", "false")).toBe("scan");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("uses GSI2 only after the backfill verification is recorded", () => {
    expect(resolveScanSource("gsi2", "true")).toBe("gsi2");
  });
});

describe("GSI2 backfill safety", () => {
  it("backfills records that have an entity type but no gsi2pk", () => {
    expect(shouldBackfillGsi2({ pk: "INVOICE#1", sk: "INVOICE#1", entityType: "Invoice" })).toBe(true);
  });

  it("does not modify records that already have gsi2pk", () => {
    expect(shouldBackfillGsi2({
      pk: "INVOICE#1",
      sk: "INVOICE#1",
      entityType: "Invoice",
      gsi2pk: "Invoice",
    })).toBe(false);
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
