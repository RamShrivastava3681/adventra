import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export interface Transporter {
  pk: string; sk: string; gsi1pk: string; gsi1sk: string;
  entityType: "Transporter";
  id: string; clientId: string; name: string;
  contactName: string | null; contactPhone: string | null; contactEmail: string | null;
  phone: string | null; website: string | null;
  addressLine: string | null; city: string | null; state: string | null; postalCode: string | null;
  gstin: string | null; vehicleNumber: string | null; notes: string | null;
  transporterCode: string;
  createdAt: string; updatedAt: string;
}

export async function list(clientId?: string) {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, { entityType: "Transporter" });
    return items as Transporter[];
  }
  return db.scanByType("Transporter", { limit: 1000 }) as Promise<Transporter[]>;
}

export async function get(id: string) { return db.getItem(`TRANSPORTER#${id}`) as Promise<Transporter | null>; }

export async function create(data: Partial<Transporter> & { clientId: string; name: string }) {
  const id = uuid(); const now = db.nowISO();
  const code = `TRN-${id.slice(0, 6).toUpperCase()}`;
  const item: Transporter = {
    pk: `TRANSPORTER#${id}`, sk: `TRANSPORTER#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`, gsi1sk: `Transporter#${now}`,
    entityType: "Transporter", id, clientId: data.clientId,
    name: data.name, contactName: data.contactName || null,
    contactPhone: data.contactPhone || null, contactEmail: data.contactEmail || null,
    phone: data.phone || null, website: data.website || null,
    addressLine: data.addressLine || null, city: data.city || null,
    state: data.state || null, postalCode: data.postalCode || null,
    gstin: data.gstin || null, vehicleNumber: data.vehicleNumber || null,
    notes: data.notes || null, transporterCode: code,
    createdAt: now, updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<Transporter>) {
  const allowed = ["name","contactName","contactPhone","contactEmail","phone","website","addressLine","city","state","postalCode","gstin","vehicleNumber","notes"];
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  for (const k of allowed) { if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k]; }
  const alias: Record<string, string> = {
    contact_name: "contactName", contact_phone: "contactPhone", contact_email: "contactEmail",
    address_line: "addressLine", postal_code: "postalCode", vehicle_number: "vehicleNumber",
  };
  for (const [sk, ck] of Object.entries(alias)) {
    if ((updates as any)[sk] !== undefined && patch[ck] === undefined) patch[ck] = (updates as any)[sk];
  }
  return db.updateItem(`TRANSPORTER#${id}`, `TRANSPORTER#${id}`, patch);
}

export async function remove(id: string) { return db.deleteItem(`TRANSPORTER#${id}`); }
