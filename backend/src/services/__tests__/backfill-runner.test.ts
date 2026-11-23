import { promises as fs } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  backoffDelayMs,
  clearCheckpoint,
  isThrottlingError,
  readCheckpoint,
  tableMatchesCheckpoint,
  withThrottleRetry,
  writeCheckpoint,
  type BackfillCheckpoint,
} from "../../lib/backfill-runner.js";

function throttleError() {
  return Object.assign(new Error("slow down"), {
    name: "ProvisionedThroughputExceededException",
  });
}

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "backfill-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("backfill throttling helpers", () => {
  it("recognises throttling and ignores ordinary errors", () => {
    expect(isThrottlingError(throttleError())).toBe(true);
    expect(isThrottlingError({ name: "ThrottlingException" })).toBe(true);
    expect(isThrottlingError({ name: "ValidationException" })).toBe(false);
    expect(isThrottlingError(new Error("boom"))).toBe(false);
  });

  it("backs off exponentially with jitter and a 30s cap", () => {
    expect(backoffDelayMs(0, () => 0)).toBe(500);
    expect(backoffDelayMs(1, () => 0)).toBe(1000);
    expect(backoffDelayMs(2, () => 0.5)).toBe(2500);
    expect(backoffDelayMs(20, () => 1)).toBe(30_000);
  });

  it("retries throttling failures and returns the eventual result", async () => {
    const sleep = vi.fn(async () => {});
    let attempts = 0;
    const result = await withThrottleRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw throttleError();
        return "ok";
      },
      { sleep, random: () => 0 },
    );

    expect(result).toBe("ok");
    expect(attempts).toBe(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 500);
    expect(sleep).toHaveBeenNthCalledWith(2, 1000);
  });

  it("does not retry non-throttling failures", async () => {
    const sleep = vi.fn(async () => {});
    await expect(
      withThrottleRetry(async () => {
        throw new Error("bad key");
      }, { sleep }),
    ).rejects.toThrow("bad key");
    expect(sleep).not.toHaveBeenCalled();
  });

  it("gives up after the configured attempt count", async () => {
    const sleep = vi.fn(async () => {});
    await expect(
      withThrottleRetry(async () => {
        throw throttleError();
      }, { sleep, attempts: 3 }),
    ).rejects.toThrow("slow down");
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});

describe("backfill checkpoints", () => {
  const checkpoint: BackfillCheckpoint = {
    table: "adventra-gsi2-staging",
    lastKey: { pk: "INVOICE#1", sk: "INVOICE#1" },
    scanned: 1200,
    eligible: 900,
    updated: 890,
    skipped: 5,
    failed: 5,
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:10:00.000Z",
    completed: false,
  };

  it("round-trips a checkpoint atomically", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "checkpoint.json");

    await writeCheckpoint(file, checkpoint);

    expect(await readCheckpoint(file)).toEqual(checkpoint);
    await expect(fs.access(`${file}.tmp`)).rejects.toBeTruthy();
    await clearCheckpoint(file);
    expect(await readCheckpoint(file)).toBeNull();
  });

  it("returns null for a corrupt checkpoint instead of resuming blindly", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "checkpoint.json");
    await fs.writeFile(file, "{not json", "utf8");

    expect(await readCheckpoint(file)).toBeNull();
  });

  it("only resumes a checkpoint that belongs to the same table", () => {
    expect(tableMatchesCheckpoint(checkpoint, "adventra-gsi2-staging")).toBe(true);
    expect(tableMatchesCheckpoint(checkpoint, "adventra")).toBe(false);
  });
});
