import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export interface Supplier {
  pk: string; sk: string; entityType: "Supplier";
  id: string; companyName: string;
  contactName: string | null; contactEmail: string | null; contactPhone: string | null;
  industry: string | null;
  addressLine: string | null; city: string | null; country: string | null; postalCode: string | null;
  status: string; notes: string | null; supplierCode: string;
  createdAt: string; updatedAt: string;
}

export async function list() { return db.scanByType("Supplier") as Promise<Supplier[]>; }
export async function get(id: string) { return db.getItem(`SUPPLIER#${id}`) as Promise<Supplier | null>; }

export async function create(data: Partial<Supplier> & { companyName: string }) {
  const id = uuid(); const now = db.nowISO();
  const code = `SUP-${id.slice(0, 6).toUpperCase()}`;
  const item: Supplier = {
    pk: `SUPPLIER#${id}`, sk: `SUPPLIER#${id}`, entityType: "Supplier", id,
    companyName: data.companyName, contactName: data.contactName || null,
    contactEmail: data.contactEmail || null, contactPhone: data.contactPhone || null,
    industry: data.industry || null,
    addressLine: data.addressLine || null, city: data.city || null, country: data.country || null, postalCode: data.postalCode || null,
    status: data.status || "prospect", notes: data.notes || null,
    supplierCode: code, createdAt: now, updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<Supplier>) {
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  const allowed = ["companyName","contactName","contactEmail","contactPhone","industry","addressLine","city","country","postalCode","status","notes"];
  for (const k of allowed) { if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k]; }
  return db.updateItem(`SUPPLIER#${id}`, `SUPPLIER#${id}`, patch);
}

export async function remove(id: string) { return db.deleteItem(`SUPPLIER#${id}`); }
