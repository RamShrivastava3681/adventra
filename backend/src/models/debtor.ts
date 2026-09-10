import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";
import { PaymentTermsType, normalizePaymentTermsType, normalizeAdvancePct } from "../lib/payment-terms.js";

export interface DebtorAddress {
  label: string | null;
  address: string;
}

export interface Debtor {
  pk: string; sk: string; gsi1pk: string; gsi1sk: string;
  entityType: "Debtor";
  id: string; name: string; industry: string | null;
  billingAddress: string | null; shippingAddress: string | null;
  /** All saved billing addresses (first entry = primary, mirrored in billingAddress). */
  billingAddresses: DebtorAddress[] | null;
  /** All saved shipping addresses (first entry = primary, mirrored in shippingAddress). */
  shippingAddresses: DebtorAddress[] | null;
  city: string | null; country: string | null;
  postalCode: string | null; phone: string | null; website: string | null;
  contactName: string | null; contactEmail: string | null; contactDesignation: string | null; contactPhone: string | null;
  /** Assigned salesman for this debtor. */
  salesmanName: string | null;
  salesmanPhone: string | null;
  salesmanEmail: string | null;
  paymentTermsDays: number;
  /** Structured payment terms: credit (Net N), advance_full (100% advance),
   *  advance_partial (X% advance + remainder on delivery) or on_delivery. */
  paymentTermsType: PaymentTermsType | null;
  /** Advance percentage for advance_partial terms (1–99). */
  advancePct: number | null;
  /**
   * LEGACY single-term fields (kept for historic documents). New payment terms
   * live in DebtorPaymentTerm rows; one per debtor is the default. On create,
   * the server auto-creates a default term from these fields — see routes.
   */
  /** Default approved term for new sales orders (DebtorPaymentTerm id). */
  defaultPaymentTermId: string | null;
  /** Credit limit for dispatch gating (null = no limit). */
  creditLimit: number | null;
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

/** Normalize user-supplied address lists: accepts strings or {label,address} objects, drops blanks. */
function normalizeAddresses(input: unknown): DebtorAddress[] | null {
  if (input === undefined) return null;
  if (input === null) return null;
  const arr = Array.isArray(input) ? input : [input];
  const out: DebtorAddress[] = [];
  for (const entry of arr) {
    if (typeof entry === "string") {
      if (entry.trim()) out.push({ label: null, address: entry.trim() });
    } else if (entry && typeof entry === "object") {
      const addr = (entry as any).address ?? (entry as any).addressLine ?? "";
      if (typeof addr === "string" && addr.trim()) {
        const label = (entry as any).label;
        out.push({ label: typeof label === "string" && label.trim() ? label.trim() : null, address: addr.trim() });
      }
    }
  }
  return out;
}

export async function create(data: Partial<Debtor> & { name: string }) {
  const id = uuid(); const now = db.nowISO();
  const code = `BUY-${id.slice(0, 6).toUpperCase()}`;
  let billingAddresses = normalizeAddresses((data as any).billingAddresses) ?? [];
  let shippingAddresses = normalizeAddresses((data as any).shippingAddresses) ?? [];
  // Back-compat: fall back to the legacy single-address fields.
  if (billingAddresses.length === 0 && data.billingAddress) billingAddresses = [{ label: null, address: data.billingAddress }];
  if (shippingAddresses.length === 0 && data.shippingAddress) shippingAddresses = [{ label: null, address: data.shippingAddress }];
  const item: Debtor = {
    pk: `DEBTOR#${id}`, sk: `DEBTOR#${id}`,
    gsi1pk: "GLOBAL", gsi1sk: `Debtor#${now}`,
    entityType: "Debtor", id,
    name: data.name, industry: data.industry || null,
    billingAddress: billingAddresses[0]?.address || data.billingAddress || null,
    shippingAddress: shippingAddresses[0]?.address || data.shippingAddress || null,
    billingAddresses: billingAddresses.length ? billingAddresses : null,
    shippingAddresses: shippingAddresses.length ? shippingAddresses : null,
    city: data.city || null, country: data.country || null,
    postalCode: data.postalCode || null, phone: data.phone || null, website: data.website || null,
    contactName: data.contactName || null, contactEmail: data.contactEmail || null,
    contactDesignation: data.contactDesignation || null, contactPhone: data.contactPhone || null,
    salesmanName: data.salesmanName || null,
    salesmanPhone: data.salesmanPhone || null,
    salesmanEmail: data.salesmanEmail || null,
    paymentTermsDays: data.paymentTermsDays || 30,
    paymentTermsType: normalizePaymentTermsType(data.paymentTermsType) || "credit",
    advancePct: normalizeAdvancePct(data.advancePct),
    defaultPaymentTermId: (data as any).defaultPaymentTermId || null,
    creditLimit: (data as any).creditLimit ?? null,
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
  const allowed = ["name","industry","billingAddress","shippingAddress","billingAddresses","shippingAddresses","city","country","postalCode","phone","website","contactName","contactEmail","contactDesignation","contactPhone","salesmanName","salesmanPhone","salesmanEmail","paymentTermsDays","paymentTermsType","advancePct","defaultPaymentTermId","creditLimit","gstin","panCardNo","stateCode","notes"];
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  for (const k of allowed) { if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k]; }
  // Normalize address lists and keep the legacy single-address fields in sync
  // (first entry = primary).
  if (patch.billingAddresses !== undefined) {
    const norm = normalizeAddresses(patch.billingAddresses) ?? [];
    patch.billingAddresses = norm.length ? norm : null;
    if (norm.length) patch.billingAddress = norm[0].address;
    else if (patch.billingAddress === undefined) patch.billingAddress = null;
  }
  if (patch.shippingAddresses !== undefined) {
    const norm = normalizeAddresses(patch.shippingAddresses) ?? [];
    patch.shippingAddresses = norm.length ? norm : null;
    if (norm.length) patch.shippingAddress = norm[0].address;
    else if (patch.shippingAddress === undefined) patch.shippingAddress = null;
  }
  return db.updateItem(`DEBTOR#${id}`, `DEBTOR#${id}`, patch);
}

export async function remove(id: string) { return db.deleteItem(`DEBTOR#${id}`); }
