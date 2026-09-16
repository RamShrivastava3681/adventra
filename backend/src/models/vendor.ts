import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";
import { PaymentTermsType, normalizePaymentTermsType, normalizeAdvancePct } from "../lib/payment-terms.js";

export interface Vendor {
  pk: string; sk: string; gsi1pk: string; gsi1sk: string;
  entityType: "Vendor";
  id: string; clientId: string; name: string;
  industry: string | null; addressLine: string | null; city: string | null;
  country: string | null; postalCode: string | null; phone: string | null; website: string | null;
  contactName: string | null; contactEmail: string | null; contactDesignation: string | null; contactPhone: string | null;
  paymentTermsDays: number; notes: string | null; vendorCode: string;
  /** Structured payment terms: credit (Net N), advance_full (100% advance),
   *  advance_partial (X% advance + remainder on delivery) or on_delivery. */
  paymentTermsType: PaymentTermsType | null;
  /** Advance percentage for advance_partial terms (1–99). */
  advancePct: number | null;
  createdAt: string; updatedAt: string;
}

export async function list(clientId?: string) {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, { entityType: "Vendor" });
    return items as Vendor[];
  }
  return db.scanByType("Vendor", { limit: 1000 }) as Promise<Vendor[]>;
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
    paymentTermsDays: (() => {
      const raw = (data as any).paymentTermsDays ?? (data as any).payment_terms_days;
      if (raw === undefined || raw === null || raw === "") return 30;
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 30;
    })(),
    paymentTermsType: normalizePaymentTermsType((data as any).paymentTermsType ?? (data as any).payment_terms_type) || "credit",
    advancePct: normalizeAdvancePct((data as any).advancePct ?? (data as any).advance_pct),
    notes: data.notes || null, vendorCode: code,
    createdAt: now, updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<Vendor>) {
  const allowed = ["name","industry","addressLine","city","country","postalCode","phone","website","contactName","contactEmail","contactDesignation","contactPhone","paymentTermsDays","paymentTermsType","advancePct","notes"];
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  for (const k of allowed) { if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k]; }
  // Accept snake_case aliases too (silent drops used to reset terms to defaults).
  const alias: Record<string, string> = { payment_terms_days: "paymentTermsDays", payment_terms_type: "paymentTermsType", advance_pct: "advancePct", address_line: "addressLine", postal_code: "postalCode", contact_name: "contactName", contact_email: "contactEmail", contact_designation: "contactDesignation", contact_phone: "contactPhone" };
  for (const [sk, ck] of Object.entries(alias)) {
    if ((updates as any)[sk] !== undefined && patch[ck] === undefined) patch[ck] = (updates as any)[sk];
  }
  return db.updateItem(`VENDOR#${id}`, `VENDOR#${id}`, patch);
}

export async function remove(id: string) { return db.deleteItem(`VENDOR#${id}`); }
