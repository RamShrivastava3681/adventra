import { describe, expect, it } from "vitest";
import {
  gsi2KeysFor,
  isIndexableEntityType,
  withEntityIndexKeys,
} from "../../lib/entity-index.js";

describe("GSI2 write coverage", () => {
  it("derives entity-wide keys for a model that never set them", () => {
    const item = withEntityIndexKeys({
      pk: "DEBTOR#1",
      sk: "DEBTOR#1",
      entityType: "Debtor",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(item.gsi2pk).toBe("Debtor");
    expect(item.gsi2sk).toBe("ENTITY#2026-01-01T00:00:00.000Z");
  });

  it("never overwrites an explicit model key", () => {
    const item = withEntityIndexKeys({
      pk: "INVOICE#1",
      sk: "INVOICE#1",
      entityType: "Invoice",
      gsi2pk: "Invoice",
      gsi2sk: "Invoice#INV-001",
    });
    expect(item.gsi2pk).toBe("Invoice");
    expect(item.gsi2sk).toBe("Invoice#INV-001");
  });

  it("fills a missing gsi2sk without changing an explicit gsi2pk", () => {
    const keys = gsi2KeysFor({
      pk: "X#1",
      entityType: "Debtor",
      gsi2pk: "Debtor",
      createdAt: "2026-01-01",
    });
    expect(keys).toEqual({ gsi2pk: "Debtor", gsi2sk: "ENTITY#2026-01-01" });
  });

  it("keeps Submission's user/type partition", () => {
    const item = withEntityIndexKeys({
      pk: "USER#u1",
      sk: "SUBMISSION#s1",
      entityType: "Submission",
      userId: "u1",
      type: "visit",
      createdAt: "2026-01-01",
    });
    expect(item.gsi2pk).toBe("USER#u1#visit");
  });

  it("does not invent a Submission key without its user/type", () => {
    const item = withEntityIndexKeys({
      pk: "USER#u1",
      sk: "SUBMISSION#s1",
      entityType: "Submission",
    });
    expect(item.gsi2pk).toBeUndefined();
  });

  it("skips internal lookup pointer records", () => {
    for (const entityType of ["UserEmail", "NoaToken", "WorkflowTaskRef", "NotificationLogRef"]) {
      expect(isIndexableEntityType(entityType)).toBe(false);
      expect(withEntityIndexKeys({ entityType }).gsi2pk).toBeUndefined();
    }
  });
});
