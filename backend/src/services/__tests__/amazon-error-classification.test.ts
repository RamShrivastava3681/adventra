/**
 * Amazon error classification must never throw: the sync error handlers call it without
 * response headers, and a crash there turned every failed SP-API call into
 * "TypeError: headers.get is not a function" (seen in production on the inventory sync).
 */
import { describe, it, expect } from "vitest";
import { classifyError } from "../../lib/amazon-error-classification.js";
import { amazonApplicationStatus } from "../../lib/amazon-application-status.js";

const inventory400 = Object.assign(
  new Error(
    'SP-API GET /fba/inventory/v1/summaries failed (400): { "errors": [ { "code": "InvalidInput", "message": "Invalid request, please check your input." } ] }',
  ),
  { status: 400 },
);

describe("amazon error classification", () => {
  it("classifies an error with no headers (the sync catch blocks) without throwing", () => {
    const c = classifyError(inventory400);
    expect(c.httpStatus).toBe(400);
    expect(c.amazonRequestId).toBeNull();
    expect(c.message).toContain("InvalidInput");
  });

  it("works through classifyAmazonError exactly as amazon-sync.service calls it", () => {
    const r = amazonApplicationStatus.classifyAmazonError(inventory400, undefined, inventory400.message);
    expect(r.classified.httpStatus).toBe(400);
    expect(r.classification).toBeTruthy();
  });

  it("reads the request id from fetch Headers, a plain header map, or the error itself", () => {
    expect(classifyError(inventory400, new Headers({ "x-amzn-RequestId": "req-headers" })).amazonRequestId).toBe("req-headers");
    expect(classifyError(inventory400, { "x-amzn-requestid": "req-map" }).amazonRequestId).toBe("req-map");
    expect(classifyError(Object.assign(new Error(inventory400.message), { status: 400, amazonRequestId: "req-err" })).amazonRequestId).toBe("req-err");
  });

  it("still redacts tokens from the message", () => {
    const c = classifyError(new Error("failed with refresh_token: Atzr|abc123secret"));
    expect(c.message).not.toContain("abc123secret");
  });
});
