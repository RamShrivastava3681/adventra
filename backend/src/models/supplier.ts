import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";
import { PaymentTermsType, normalizePaymentTermsType, normalizeAdvancePct } from "../lib/payment-terms.js";

export interface Supplier {
  pk: string; sk: string; entityType: "Supplier";
  id: string; companyName: string;
  contactName: string | null; contactEmail: string | null; contactPhone: string | null;
  industry: string | null;
  addressLine: string | null; city: string | null; country: string | null; postalCode: string | null;
  status: string; notes: string | null; supplierCode: string;
  /** 15-digit GST Identification Number. */
  gstin: string | null;
  /** PAN (Permanent Account Number) - 10-character alphanumeric ID. */
  panCardNo: string | null;
  /** State code (2-digit, derived from GSTIN or manually set). */
  stateCode: string | null;
  /** Credit period in days (Net N) when paymentTermsType is "credit". */
  paymentTermsDays: number;
  /** Structured payment terms: credit (Net N), advance_full (100% advance),
   *  advance_partial (X% advance + remainder on delivery) or on_delivery. */
  paymentTermsType: PaymentTermsType | null;
  /** Advance percentage for advance_partial terms (1–99). */
  advancePct: number | null;
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
    paymentTermsDays: (() => {
      const raw = (data as any).paymentTermsDays;
      if (raw === undefined || raw === null || raw === "") return 30;
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 30;
    })(),
    paymentTermsType: normalizePaymentTermsType(data.paymentTermsType) || "credit",
    advancePct: normalizeAdvancePct(data.advancePct),
    gstin: data.gstin || null,
    panCardNo: data.panCardNo || null,
    stateCode: data.stateCode || (data.gstin ? data.gstin.slice(0, 2) : null),
    supplierCode: code, createdAt: now, updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<Supplier>) {
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  const allowed = ["companyName","contactName","contactEmail","contactPhone","industry","addressLine","city","country","postalCode","status","notes","paymentTermsDays","paymentTermsType","advancePct","gstin","panCardNo","stateCode"];
  for (const k of allowed) { if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k]; }
  return db.updateItem(`SUPPLIER#${id}`, `SUPPLIER#${id}`, patch);
}

export async function remove(id: string) { return db.deleteItem(`SUPPLIER#${id}`); }
