import { describe, expect, it } from "vitest";
import { RequestRateLimiter } from "../../lib/request-rate-limiter.js";

describe("RequestRateLimiter", () => {
  it("allows exactly 1,000 slots in a one-minute window", async () => {
    let now = 0;
    const waits: number[] = [];
    const limiter = new RequestRateLimiter(
      1000,
      () => now,
      async (ms) => {
        waits.push(ms);
        now += ms;
      },
    );

    for (let i = 0; i < 1000; i++) await limiter.waitForSlot();
    await limiter.waitForSlot();

    expect(waits).toEqual([60000]);
  });

  it("resets after one minute", async () => {
    let now = 0;
    const waits: number[] = [];
    const limiter = new RequestRateLimiter(
      1000,
      () => now,
      async (ms) => {
        waits.push(ms);
        now += ms;
      },
    );

    now = 60000;
    await limiter.waitForSlot();
    expect(waits).toEqual([]);
  });
});
