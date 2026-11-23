export class RequestRateLimiter {
  private windowStartedAt: number;
  private requests = 0;

  constructor(
    private readonly requestsPerMinute: number,
    private readonly now: () => number = Date.now,
    private readonly wait: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {
    this.windowStartedAt = this.now();
  }

  async waitForSlot(): Promise<void> {
    const now = this.now();
    if (now - this.windowStartedAt >= 60_000) {
      this.windowStartedAt = now;
      this.requests = 0;
    }

    if (this.requests >= this.requestsPerMinute) {
      const remaining = 60_000 - (this.now() - this.windowStartedAt);
      if (remaining > 0) await this.wait(remaining);
      this.windowStartedAt = this.now();
      this.requests = 0;
    }

    this.requests++;
  }
}
