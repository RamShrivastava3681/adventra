import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";
import { PaymentTermsType, normalizePaymentTermsType, normalizeAdvancePct } from "../lib/payment-terms.js";

export interface Debtor {
  pk: string; sk: string; gsi1pk: string; gsi1sk: string;
  entityType: "Debtor";
  id: string; name: string; industry: string | null;
  billingAddress: string | null; shippingAddress: string | null; city: string | null; country: string | null;
  postalCode: string | null; phone: string | null; website: string | null;
  contactName: string | null; contactEmail: string | null; contactDesignation: string | null; contactPhone: string | null;
  paymentTermsDays: number;
  /** Structured payment terms: credit (Net N), advance_full (100% advance),
   *  advance_partial (X% advance + remainder on delivery) or on_delivery. */
  paymentTermsType: PaymentTermsType | null;
  /** Advance percentage for advance_partial terms (1–99). */
  advancePct: number | null;
  // ── GST / E-Way Bill fields ──
  /** 15-digit GST Identification Number (required for E-Way Bill generation). */
  gstin: string | null;
  /** PAN (Permanent Account Number) - 10-character alphanumeric ID. */
  panCardNo: string | null;
  /** State code (2-digit, derived from GSTIN or manually set). */
  stateCode: string | null;
  notes: string | null; debtorCode: string;
  createdAt: string; updatedAt: string;
}

export async function list() { return db.scanByType("Debtor") as Promise<Debtor[]>; }
export async function get(id: string) { return db.getItem(`DEBTOR#${id}`) as Promise<Debtor | null>; }

export async function create(data: Partial<Debtor> & { name: string }) {
  const id = uuid(); const now = db.nowISO();
  const code = `BUY-${id.slice(0, 6).toUpperCase()}`;
  const item: Debtor = {
    pk: `DEBTOR#${id}`, sk: `DEBTOR#${id}`,
    gsi1pk: "GLOBAL", gsi1sk: `Debtor#${now}`,
    entityType: "Debtor", id,
    name: data.name, industry: data.industry || null,
    billingAddress: data.billingAddress || null, shippingAddress: data.shippingAddress || null, city: data.city || null, country: data.country || null,
    postalCode: data.postalCode || null, phone: data.phone || null, website: data.website || null,
    contactName: data.contactName || null, contactEmail: data.contactEmail || null,
    contactDesignation: data.contactDesignation || null, contactPhone: data.contactPhone || null,
    paymentTermsDays: data.paymentTermsDays || 30,
    paymentTermsType: normalizePaymentTermsType(data.paymentTermsType) || "credit",
    advancePct: normalizeAdvancePct(data.advancePct),
    gstin: data.gstin || null,
    panCardNo: data.panCardNo || null,
    stateCode: data.stateCode || (data.gstin ? data.gstin.slice(0, 2) : null),
    notes: data.notes || null, debtorCode: code,
    createdAt: now, updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<Debtor>) {
  const allowed = ["name","industry","billingAddress","shippingAddress","city","country","postalCode","phone","website","contactName","contactEmail","contactDesignation","contactPhone","paymentTermsDays","paymentTermsType","advancePct","gstin","panCardNo","stateCode","notes"];
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  for (const k of allowed) { if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k]; }
  return db.updateItem(`DEBTOR#${id}`, `DEBTOR#${id}`, patch);
}

export async function remove(id: string) { return db.deleteItem(`DEBTOR#${id}`); }
