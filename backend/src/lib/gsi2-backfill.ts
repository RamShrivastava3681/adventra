import { gsi2KeysFor } from "./entity-index.js";

/**
 * True when the item needs its GSI2 keys written. Existing valid keys are never
 * flagged, so an apply run is idempotent.
 *
 * Both keys are required: DynamoDB only projects an item into the index when
 * the partition AND sort key are both present. A legacy record that has only
 * `gsi2pk` is still invisible to GSI2 queries, so it must be repaired too.
 */
export function shouldBackfillGsi2(item: Record<string, any>): boolean {
  const keys = gsi2KeysFor(item);
  if (!keys) return false;
  return typeof item.gsi2pk !== "string" || typeof item.gsi2sk !== "string";
}
