import { promises as fs } from "fs";
import path from "path";

/**
 * Helpers shared by resumable DynamoDB maintenance scripts.
 *
 * The backfill touches the whole table, so it must be safe to stop and restart:
 * progress is checkpointed after every page, throttling is retried with jitter,
 * and a per-item failure is counted instead of aborting the run.
 */

export interface BackfillCheckpoint {
  table: string;
  /** LastEvaluatedKey of the last fully processed page, or null at the start. */
  lastKey: Record<string, any> | null;
  scanned: number;
  eligible: number;
  updated: number;
  skipped: number;
  failed: number;
  startedAt: string;
  updatedAt: string;
  completed: boolean;
}

export const DEFAULT_CHECKPOINT_FILE = "backfill-gsi2.checkpoint.json";

const THROTTLE_NAMES = new Set([
  "ProvisionedThroughputExceededException",
  "ThrottlingException",
  "RequestLimitExceeded",
  "TooManyRequestsException",
  "LimitExceededException",
  "TransactionInProgressException",
]);

export function isThrottlingError(err: unknown): boolean {
  const e = err as any;
  const name = String(e?.name ?? "");
  if (THROTTLE_NAMES.has(name)) return true;
  const status = Number(e?.$metadata?.httpStatusCode ?? e?.statusCode ?? 0);
  if (status === 429) return true;
  return String(e?.code ?? "") === "ThrottlingException";
}

/**
 * Exponential backoff with jitter: 500ms, 1s, 2s … capped at 30s. Jitter keeps
 * a fleet of concurrent workers from retrying in lockstep.
 */
export function backoffDelayMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const exponent = Math.max(0, Math.floor(attempt));
  const base = Math.min(30_000, 500 * 2 ** exponent);
  const jitter = Math.floor(base * 0.5 * random());
  return Math.min(30_000, base + jitter);
}

export interface RetryOptions {
  attempts?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

/** Retries throttling errors only; every other failure is thrown immediately. */
export async function withThrottleRetry<T>(
  run: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 6);
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (attempt >= attempts - 1 || !isThrottlingError(err)) throw err;
      const delayMs = backoffDelayMs(attempt, options.random);
      options.onRetry?.(err, attempt + 1, delayMs);
      await sleep(delayMs);
    }
  }
}

export function tableMatchesCheckpoint(
  checkpoint: BackfillCheckpoint,
  table: string,
): boolean {
  return checkpoint.table === table;
}

export async function readCheckpoint(
  file: string,
): Promise<BackfillCheckpoint | null> {
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as BackfillCheckpoint;
    if (typeof parsed?.table !== "string" || typeof parsed?.scanned !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Writes atomically so a crash mid-write cannot corrupt the checkpoint. */
export async function writeCheckpoint(
  file: string,
  checkpoint: BackfillCheckpoint,
): Promise<void> {
  await fs.mkdir(path.dirname(path.resolve(file)), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(checkpoint, null, 2), "utf8");
  await fs.rename(tmp, file);
}

export async function clearCheckpoint(file: string): Promise<void> {
  await fs.rm(file, { force: true });
}
