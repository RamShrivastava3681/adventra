/**
 * GSI2 index-key population for single-table records.
 *
 * GSI2 is an entity-type index (`gsi2pk = entityType`). Reads through GSI2 only
 * see records that carry both index keys, so every model write must populate
 * them. Rather than duplicating this in ~60 models, `putItem` routes items
 * through `withEntityIndexKeys`.
 *
 * Rules:
 *  - Never overwrite an existing gsi2pk/gsi2sk written by a model.
 *  - Skip internal lookup-pointer records (email, NOA token, doc sidecar refs).
 *  - Submission uses a user/type partition for its own access pattern, so it
 *    keeps its explicit key and never falls back to the bare entity type.
 */

/** Internal pointer records that are fetched by primary key only. */
const NON_INDEXED_ENTITY_TYPES = new Set([
  "UserEmail",
  "NoaToken",
  "WorkflowTaskRef",
  "NotificationLogRef",
]);

/** Entity types that do not use `entityType` as their GSI2 partition. */
const CUSTOM_GSI2_PK: Record<string, (item: Record<string, any>) => string | null> = {
  Submission: (item) =>
    item.userId && item.type ? `USER#${item.userId}#${item.type}` : null,
};

export function isIndexableEntityType(entityType: unknown): entityType is string {
  return (
    typeof entityType === "string" &&
    entityType.length > 0 &&
    !NON_INDEXED_ENTITY_TYPES.has(entityType)
  );
}

/** Derive the correct GSI2 keys for an item, or null when it cannot be indexed. */
export function gsi2KeysFor(
  item: Record<string, any>,
): { gsi2pk: string; gsi2sk: string } | null {
  const entityType = item.entityType;
  if (!isIndexableEntityType(entityType)) return null;

  const custom = CUSTOM_GSI2_PK[entityType]?.(item);
  if (custom === null) return null;

  const sortSource =
    item.createdAt ?? item.updatedAt ?? item.id ?? item.pk ?? "";
  return {
    gsi2pk: item.gsi2pk ?? custom ?? entityType,
    gsi2sk: item.gsi2sk ?? `ENTITY#${sortSource}`,
  };
}

export function withEntityIndexKeys<T extends Record<string, any>>(
  item: T,
): T & { gsi2pk?: string; gsi2sk?: string } {
  const keys = gsi2KeysFor(item);
  if (!keys) return item;
  if (item.gsi2pk === keys.gsi2pk && item.gsi2sk === keys.gsi2sk) return item;
  return { ...item, ...keys };
}
