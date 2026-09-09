import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export type SkuMasterType = "category" | "gender" | "color" | "size";

export interface SkuMaster {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "SkuMaster";
  id: string;
  clientId: string;
  masterType: SkuMasterType;
  name: string;
  code: string;
  sizeSystem: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export function normalizeCode(value: unknown) {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

export async function list(clientId: string | undefined, type?: SkuMasterType) {
  const items = clientId
    ? await db.queryByGSI1(clientId, { entityType: "SkuMaster" })
    : { items: await db.scanByType("SkuMaster") };
  return (items.items as SkuMaster[]).filter((x) => !type || x.masterType === type);
}

export async function get(id: string) {
  return db.getItem(`SKU_MASTER#${id}`) as Promise<SkuMaster | null>;
}

export async function create(data: { clientId: string; masterType: SkuMasterType; name: string; code: string; sizeSystem?: string | null }) {
  const name = String(data.name ?? "").trim();
  const code = normalizeCode(data.code);
  if (!name || !code) throw new Error("Name and code are required");
  const existing = await list(data.clientId, data.masterType);
  if (existing.some((x) => x.code === code)) throw new Error(`${data.masterType} code ${code} already exists`);
  const id = uuid(); const now = db.nowISO();
  const item: SkuMaster = {
    pk: `SKU_MASTER#${id}`, sk: `SKU_MASTER#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`, gsi1sk: `SkuMaster#${data.masterType}#${now}`,
    entityType: "SkuMaster", id, clientId: data.clientId, masterType: data.masterType,
    name, code, sizeSystem: data.masterType === "size" ? (data.sizeSystem?.trim() || "Custom") : null,
    active: true, createdAt: now, updatedAt: now,
  };
  await db.putItem(item); return item;
}

export async function update(id: string, updates: Partial<SkuMaster>) {
  const current = await get(id); if (!current) throw new Error("SKU master not found");
  const patch: Record<string, unknown> = { updatedAt: db.nowISO() };
  if (updates.name !== undefined) {
    const name = String(updates.name).trim();
    if (!name) throw new Error("Name is required");
    patch.name = name;
  }
  if (updates.code !== undefined) {
    const code = normalizeCode(updates.code);
    if (!code) throw new Error("Code is required");
    if (code !== current.code) {
      const siblings = await list(current.clientId, current.masterType);
      if (siblings.some((x) => x.id !== current.id && x.code === code)) {
        throw new Error(`${current.masterType} code ${code} already exists`);
      }
    }
    patch.code = code;
  }
  if (updates.sizeSystem !== undefined && current.masterType === "size") patch.sizeSystem = updates.sizeSystem || "Custom";
  if (updates.active !== undefined) patch.active = Boolean(updates.active);
  return db.updateItem(current.pk, current.sk, patch);
}
