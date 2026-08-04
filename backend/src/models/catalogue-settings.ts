import * as db from "../dynamodb.js";

export interface CatalogueSettings {
  pk: string;
  sk: string;
  entityType: "CatalogueSettings";
  id: string;
  clientId: string;
  /**
   * Default minimum gross margin (0.01–0.99) applied to every product that
   * has no per-product minimumGrossMarginPercentage of its own. Default 0.40.
   */
  defaultMinimumMargin: number;
  updatedAt: string;
}

export const DEFAULT_MINIMUM_MARGIN = 0.4;

const pkFor = (clientId: string) => `SETTINGS#CATALOGUE#${clientId}`;

export async function get(clientId: string): Promise<CatalogueSettings> {
  const item = await db.getItem(pkFor(clientId));
  if (item) return item as CatalogueSettings;
  const now = db.nowISO();
  return {
    pk: pkFor(clientId),
    sk: pkFor(clientId),
    entityType: "CatalogueSettings",
    id: clientId,
    clientId,
    defaultMinimumMargin: DEFAULT_MINIMUM_MARGIN,
    updatedAt: now,
  };
}

export async function update(
  clientId: string,
  updates: { defaultMinimumMargin: number }
): Promise<CatalogueSettings> {
  const current = await get(clientId);
  const item: CatalogueSettings = {
    ...current,
    defaultMinimumMargin: updates.defaultMinimumMargin,
    updatedAt: db.nowISO(),
  };
  await db.putItem(item);
  return item;
}
