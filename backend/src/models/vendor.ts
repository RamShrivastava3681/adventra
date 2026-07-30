import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export interface Vendor {
  pk: string; sk: string; gsi1pk: string; gsi1sk: string;
  entityType: "Vendor";
  id: string; clientId: string; name: string;
  industry: string | null; addressLine: string | null; city: string | null;
  country: string | null; postalCode: string | null; phone: string | null; website: string | null;
  contactName: string | null; contactEmail: string | null; contactDesignation: string | null; contactPhone: string | null;
  paymentTermsDays: number; notes: string | null; vendorCode: string;
  createdAt: string; updatedAt: string;
}

export async function list(clientId: string) {
  const { items } = await db.queryByGSI1(clientId, { entityType: "Vendor" });
  return items as Vendor[];
}

export async function get(id: string) { return db.getItem(`VENDOR#${id}`) as Promise<Vendor | null>; }

export async function create(data: Partial<Vendor> & { clientId: string; name: string }) {
  const id = uuid(); const now = db.nowISO();
  const code = `VEN-${id.slice(0, 6).toUpperCase()}`;
  const item: Vendor = {
    pk: `VENDOR#${id}`, sk: `VENDOR#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`, gsi1sk: `Vendor#${now}`,
    entityType: "Vendor", id, clientId: data.clientId,
    name: data.name, industry: data.industry || null,
    addressLine: data.addressLine || null, city: data.city || null,
    country: data.country || null, postalCode: data.postalCode || null,
    phone: data.phone || null, website: data.website || null,
    contactName: data.contactName || null, contactEmail: data.contactEmail || null,
    contactDesignation: data.contactDesignation || null, contactPhone: data.contactPhone || null,
    paymentTermsDays: data.paymentTermsDays || 30,
    notes: data.notes || null, vendorCode: code,
    createdAt: now, updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<Vendor>) {
  const allowed = ["name","industry","addressLine","city","country","postalCode","phone","website","contactName","contactEmail","contactDesignation","contactPhone","paymentTermsDays","notes"];
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  for (const k of allowed) { if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k]; }
  return db.updateItem(`VENDOR#${id}`, `VENDOR#${id}`, patch);
}

export async function remove(id: string) { return db.deleteItem(`VENDOR#${id}`); }
