import { gsi2KeysFor } from "./entity-index.js";

/**
 * True when the item needs its GSI2 keys written. Existing valid keys are never
 * flagged, so an apply run is idempotent.
 */
export function shouldBackfillGsi2(item: Record<string, any>): boolean {
  const keys = gsi2KeysFor(item);
  if (!keys) return false;
  return typeof item.gsi2pk !== "string";
}
