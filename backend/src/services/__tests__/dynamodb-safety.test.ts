import { describe, expect, it } from "vitest";
import { shouldBackfillGsi2 } from "../../lib/gsi2-backfill.js";

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
