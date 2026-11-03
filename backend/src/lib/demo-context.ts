/**
 * Demo tenant context — keeps Marketplace Demo Simulator data apart from live data.
 *
 * Code that runs inside `runAsDemo(fn)` writes every record into the demo tenant
 * (`isDemoData: true`, `tenantId: "MARKETPLACE-DEMO"`) and sees only demo records.
 * Code outside it (every normal screen) never sees demo records. The data layer
 * (`dynamodb.ts`) applies these rules on every read and write, so the simulator can
 * drive the real Sales / Inventory / Warehouse / Finance code without touching live data.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export const DEMO_TENANT_ID = "MARKETPLACE-DEMO";

const demoStore = new AsyncLocalStorage<{ demo: true }>();

/** Run `fn` (and everything it awaits) inside the demo tenant. */
export function runAsDemo<T>(fn: () => Promise<T> | T): Promise<T> {
  return demoStore.run({ demo: true }, async () => fn());
}

export function isDemoMode(): boolean {
  return demoStore.getStore()?.demo === true;
}

export function isDemoItem(item: Record<string, any> | null | undefined): boolean {
  return item?.isDemoData === true;
}

/** Demo mode sees only demo records; live mode never sees them. */
export function visibleInCurrentMode(item: Record<string, any> | null | undefined): boolean {
  if (!item) return false;
  return isDemoMode() ? isDemoItem(item) : !isDemoItem(item);
}

export function filterForCurrentMode<T extends Record<string, any>>(items: T[]): T[] {
  return items.filter(visibleInCurrentMode);
}

/** Stamp a record written in demo mode with the demo tenant markers. */
export function tagForCurrentMode<T extends Record<string, any>>(item: T): T {
  if (!isDemoMode()) return item;
  return { ...item, isDemoData: true, tenantId: DEMO_TENANT_ID };
}

/**
 * Condition added to demo-mode updates/deletes so they can only ever change a demo
 * record. Returns null outside demo mode.
 */
export function demoWriteGuard(): {
  expression: string;
  names: Record<string, string>;
  values: Record<string, any>;
} | null {
  if (!isDemoMode()) return null;
  return {
    expression: "#__demo = :__demo",
    names: { "#__demo": "isDemoData" },
    values: { ":__demo": true },
  };
}

export class DemoIsolationError extends Error {
  constructor(message = "Demo mode cannot change live (non-demo) data") {
    super(message);
    this.name = "DemoIsolationError";
  }
}
