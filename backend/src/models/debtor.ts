import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";
import { PaymentTermsType, normalizePaymentTermsType, normalizeAdvancePct } from "../lib/payment-terms.js";

export interface DebtorAddress {
  label: string | null;
  address: string;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
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
  /** When true (default when a limit is set), invoices that would push
   *  unpaid exposure over creditLimit are blocked. When false, the limit
   *  is kept for display but bypassed. */
  enforceCreditLimit: boolean | null;
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

/** Normalize user-supplied address lists: accepts strings or {label,address,city,state,postalCode} objects, drops blanks. */
function normalizeAddresses(input: unknown): DebtorAddress[] | null {
  if (input === undefined) return null;
  if (input === null) return null;
  const arr = Array.isArray(input) ? input : [input];
  const out: DebtorAddress[] = [];
  for (const entry of arr) {
    if (typeof entry === "string") {
      if (entry.trim()) out.push({ label: null, address: entry.trim() });
    } else if (entry && typeof entry === "object") {
      const e = entry as any;
      const addr = e.address ?? e.addressLine ?? e.address_line ?? "";
      const cityRaw = e.city ?? "";
      const stateRaw = e.state ?? e.country ?? "";
      const pinRaw = e.postalCode ?? e.postal_code ?? e.postal_code_no ?? e.pin ?? e.pincode ?? e.zip ?? "";
      const hasAddr = typeof addr === "string" && addr.trim();
      const hasCity = typeof cityRaw === "string" && cityRaw.trim();
      const hasState = typeof stateRaw === "string" && stateRaw.trim();
      const hasPin = String(pinRaw ?? "").trim();
      if (hasAddr || hasCity || hasState || hasPin) {
        const label = e.label;
        out.push({
          label: typeof label === "string" && label.trim() ? label.trim() : null,
          address: typeof addr === "string" ? addr.trim() : "",
          city: hasCity ? cityRaw.trim() : null,
          state: hasState ? String(stateRaw).trim() : null,
          postalCode: hasPin ? String(pinRaw).trim() : null,
        });
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
  const firstBilling = billingAddresses[0] as any;
  const fullBillingAddress = firstBilling
    ? [firstBilling.address, firstBilling.city, firstBilling.state, firstBilling.postalCode].filter(Boolean).join(", ") || data.billingAddress || null
    : data.billingAddress || null;
  const fullShippingAddress = shippingAddresses[0]
    ? [(shippingAddresses[0] as any).address, (shippingAddresses[0] as any).city, (shippingAddresses[0] as any).state, (shippingAddresses[0] as any).postalCode].filter(Boolean).join(", ") || data.shippingAddress || null
    : data.shippingAddress || null;
  const item: Debtor = {
    pk: `DEBTOR#${id}`, sk: `DEBTOR#${id}`,
    gsi1pk: "GLOBAL", gsi1sk: `Debtor#${now}`,
    entityType: "Debtor", id,
    name: data.name, industry: data.industry || null,
    billingAddress: fullBillingAddress,
    shippingAddress: fullShippingAddress,
    billingAddresses: billingAddresses.length ? billingAddresses : null,
    shippingAddresses: shippingAddresses.length ? shippingAddresses : null,
    // Top-level city/country/postal kept in sync from the first billing
    // address for legacy reports/PDFs; the master is now per-address.
    city: data.city || firstBilling?.city || null,
    country: data.country || firstBilling?.state || null,
    postalCode: data.postalCode || firstBilling?.postalCode || null, phone: data.phone || null, website: data.website || null,
    contactName: data.contactName || null, contactEmail: data.contactEmail || null,
    contactDesignation: data.contactDesignation || null, contactPhone: data.contactPhone || null,
    salesmanName: data.salesmanName || null,
    salesmanPhone: data.salesmanPhone || null,
    salesmanEmail: data.salesmanEmail || null,
    paymentTermsDays: (() => {
      const raw = (data as any).paymentTermsDays;
      if (raw === undefined || raw === null || raw === "") return 30;
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 30;
    })(),
    paymentTermsType: normalizePaymentTermsType(data.paymentTermsType) || "credit",
    advancePct: normalizeAdvancePct(data.advancePct),
    defaultPaymentTermId: (data as any).defaultPaymentTermId || null,
    creditLimit: (() => {
      const raw = (data as any).creditLimit;
      if (raw === undefined || raw === null || raw === "") return null;
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? n : null;
    })(),
    enforceCreditLimit: (() => {
      const raw = (data as any).enforceCreditLimit;
      if (raw === undefined || raw === null || raw === "") {
        // Default: enforce when a limit is provided, otherwise off.
        const lim = Number((data as any).creditLimit);
        return Number.isFinite(lim) && lim > 0 ? true : false;
      }
      return raw === true || raw === "true" || raw === 1 || raw === "1";
    })(),
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
  const allowed = ["name","industry","billingAddress","shippingAddress","billingAddresses","shippingAddresses","city","country","postalCode","phone","website","contactName","contactEmail","contactDesignation","contactPhone","salesmanName","salesmanPhone","salesmanEmail","paymentTermsDays","paymentTermsType","advancePct","defaultPaymentTermId","creditLimit","enforceCreditLimit","gstin","panCardNo","stateCode","notes"];
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  for (const k of allowed) { if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k]; }
  if (patch.creditLimit !== undefined) {
    const raw = patch.creditLimit;
    if (raw === null || raw === "") patch.creditLimit = null;
    else {
      const n = Number(raw);
      patch.creditLimit = Number.isFinite(n) && n >= 0 ? n : null;
    }
  }
  if (patch.enforceCreditLimit !== undefined) {
    const raw = patch.enforceCreditLimit;
    if (raw === null || raw === "") patch.enforceCreditLimit = false;
    else patch.enforceCreditLimit = raw === true || raw === "true" || raw === 1 || raw === "1";
  }
  // Normalize address lists and keep the legacy single-address fields in sync
  // (first entry = primary). Top-level city/country/postal follow the first
  // billing address unless explicitly overridden.
  if (patch.billingAddresses !== undefined) {
    const norm = normalizeAddresses(patch.billingAddresses) ?? [];
    patch.billingAddresses = norm.length ? norm : null;
    if (norm.length) {
      const f = norm[0] as any;
      patch.billingAddress = [f.address, f.city, f.state, f.postalCode].filter(Boolean).join(", ") || f.address;
      if (patch.city === undefined && f.city) patch.city = f.city;
      if (patch.country === undefined && f.state) patch.country = f.state;
      if (patch.postalCode === undefined && f.postalCode) patch.postalCode = f.postalCode;
    } else if (patch.billingAddress === undefined) patch.billingAddress = null;
  }
  if (patch.shippingAddresses !== undefined) {
    const norm = normalizeAddresses(patch.shippingAddresses) ?? [];
    patch.shippingAddresses = norm.length ? norm : null;
    if (norm.length) {
      const f = norm[0] as any;
      patch.shippingAddress = [f.address, f.city, f.state, f.postalCode].filter(Boolean).join(", ") || f.address;
    } else if (patch.shippingAddress === undefined) patch.shippingAddress = null;
  }
  return db.updateItem(`DEBTOR#${id}`, `DEBTOR#${id}`, patch);
}

export async function remove(id: string) { return db.deleteItem(`DEBTOR#${id}`); }
