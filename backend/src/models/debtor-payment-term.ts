import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";
import {
  PaymentTermsType,
  DispatchCondition,
  DueBasis,
  normalizePaymentTermsType,
  normalizeAdvancePct,
  normalizeBalancePct,
  normalizeBalanceDueDays,
  normalizeDueBasis,
  normalizeDispatchCondition,
  balancePctFor,
  defaultDispatchConditionFor,
  formatPaymentTerms,
} from "../lib/payment-terms.js";

/**
 * DebtorPaymentTerm — one of possibly many payment terms approved for a
 * customer (Debtor). Exactly one active term per debtor is the default.
 *
 * PDF §1: every term carries advance %, balance %, due days/basis and a
 * dispatch condition. The Sales Order copies the selected term as a permanent
 * snapshot — later master edits never change historic documents.
 */

export interface DebtorPaymentTerm {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "DebtorPaymentTerm";
  id: string;
  clientId: string;
  debtorId: string;
  /** Display name, e.g. "30% Advance + Balance Net 30". */
  name: string;
  /** Legacy structured type backing this term (for label compat). */
  paymentTermsType: PaymentTermsType | null;
  /** Free-text legacy terms (fallback label only). */
  paymentTerms: string | null;
  /** Advance % (0–100). */
  advancePct: number;
  /** V1 fixed: "so_confirmation". */
  advanceDueBasis: DueBasis;
  /** Balance % (0–100). Defaults to 100 − advancePct. */
  balancePct: number;
  /** Credit days for the balance (0 = due on invoice date). */
  balanceDueDays: number;
  /** V1 fixed: "invoice_date". */
  balanceDueBasis: DueBasis;
  /** Dispatch gate for this term. */
  dispatchCondition: DispatchCondition;
  /** Exactly one active term per debtor. */
  isDefault: boolean;
  /** Inactive terms stay for history but are hidden from SO dropdowns. */
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TermInput {
  name?: string | null;
  paymentTermsType?: string | null;
  paymentTerms?: string | null;
  advancePct?: number | null;
  advanceDueBasis?: string | null;
  balancePct?: number | null;
  balanceDueDays?: number | null;
  balanceDueBasis?: string | null;
  dispatchCondition?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function termKey(debtorId: string, id: string): { pk: string; sk: string } {
  return { pk: `DEBTOR#${debtorId}`, sk: `TERM#${id}` };
}

/** Validate + normalize a term payload. Throws on invalid input. */
export function validateTermInput(data: TermInput): {
  name: string;
  paymentTermsType: PaymentTermsType | null;
  paymentTerms: string | null;
  advancePct: number;
  advanceDueBasis: DueBasis;
  balancePct: number;
  balanceDueDays: number;
  balanceDueBasis: DueBasis;
  dispatchCondition: DispatchCondition;
} {
  const paymentTermsType = normalizePaymentTermsType(data.paymentTermsType);
  const paymentTerms =
    typeof data.paymentTerms === "string" && data.paymentTerms.trim()
      ? data.paymentTerms.trim()
      : null;

  let advancePct: number;
  if (paymentTermsType === "advance_full") {
    advancePct = 100;
  } else if (paymentTermsType === "advance_partial") {
    const p = normalizeAdvancePct(data.advancePct);
    if (p == null) throw new Error("Partial advance terms require advancePct (1–99)");
    advancePct = p;
  } else if (data.advancePct !== undefined && data.advancePct !== null && String(data.advancePct) !== "") {
    const n = Number(data.advancePct);
    if (!Number.isFinite(n) || n < 0 || n > 100)
      throw new Error("advancePct must be between 0 and 100");
    advancePct = round2(n);
  } else {
    advancePct = 0;
  }

  let balancePct = normalizeBalancePct(data.balancePct);
  if (balancePct == null) balancePct = balancePctFor(advancePct);
  if (Math.abs(balancePct + advancePct - 100) > 0.01)
    throw new Error("advancePct + balancePct must equal 100");

  const balanceDueDays = normalizeBalanceDueDays(data.balanceDueDays) ?? 0;
  const dispatchCondition =
    normalizeDispatchCondition(data.dispatchCondition) ??
    defaultDispatchConditionFor(paymentTermsType, advancePct);

  const name =
    typeof data.name === "string" && data.name.trim()
      ? data.name.trim()
      : formatPaymentTerms({
          paymentTermsType,
          advancePct: advancePct || null,
          paymentTermsDays: balanceDueDays || null,
          paymentTerms,
        }) || "Custom terms";

  return {
    name,
    paymentTermsType,
    paymentTerms,
    advancePct,
    advanceDueBasis: normalizeDueBasis(data.advanceDueBasis) ?? "so_confirmation",
    balancePct,
    balanceDueDays,
    balanceDueBasis: normalizeDueBasis(data.balanceDueBasis) ?? "invoice_date",
    dispatchCondition,
  };
}

export async function listByDebtor(
  debtorId: string,
  opts?: { activeOnly?: boolean; clientId?: string },
): Promise<DebtorPaymentTerm[]> {
  const { items } = await db.queryByPk(`DEBTOR#${debtorId}`, { limit: 500 });
  let terms = (items as DebtorPaymentTerm[]).filter(
    (t) => t.entityType === "DebtorPaymentTerm",
  );
  if (opts?.clientId) terms = terms.filter((t) => t.clientId === opts.clientId);
  if (opts?.activeOnly !== false) terms = terms.filter((t) => t.isActive !== false);
  // Default first, then newest.
  terms.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || (a.name || "").localeCompare(b.name || ""));
  return terms;
}

export async function getDefault(
  debtorId: string,
  clientId?: string,
): Promise<DebtorPaymentTerm | null> {
  const terms = await listByDebtor(debtorId, { clientId });
  return terms.find((t) => t.isDefault) ?? terms[0] ?? null;
}

export async function get(debtorId: string, id: string): Promise<DebtorPaymentTerm | null> {
  const { pk, sk } = termKey(debtorId, id);
  return db.getItem(pk, sk) as Promise<DebtorPaymentTerm | null>;
}

/** Fetch by term id alone (scans type — prefer get(debtorId, id) when known). */
export async function getById(id: string): Promise<DebtorPaymentTerm | null> {
  const items = await db.scanByType("DebtorPaymentTerm", { limit: 2000 });
  return ((items as DebtorPaymentTerm[]).find((t) => t.id === id) ?? null);
}

export async function create(
  clientId: string,
  debtorId: string,
  data: TermInput,
): Promise<DebtorPaymentTerm> {
  const v = validateTermInput(data);
  const existing = await listByDebtor(debtorId, { activeOnly: false });
  // First term for a debtor always becomes the default.
  const isDefault = existing.length === 0 ? true : data.isDefault === true;
  const id = uuid();
  const now = db.nowISO();
  const { pk, sk } = termKey(debtorId, id);
  const item: DebtorPaymentTerm = {
    pk,
    sk,
    gsi1pk: `CLIENT#${clientId}`,
    gsi1sk: `DebtorPaymentTerm#${now}`,
    entityType: "DebtorPaymentTerm",
    id,
    clientId,
    debtorId,
    ...v,
    isDefault,
    isActive: data.isActive !== false,
    createdAt: now,
    updatedAt: now,
  };
  await db.putItem(item);
  if (isDefault) await unsetOthersDefault(debtorId, id);
  return (await get(debtorId, id)) as DebtorPaymentTerm;
}

async function unsetOthersDefault(debtorId: string, keepId: string) {
  const terms = await listByDebtor(debtorId, { activeOnly: false });
  for (const t of terms) {
    if (t.id !== keepId && t.isDefault) {
      const { pk, sk } = termKey(debtorId, t.id);
      await db.updateItem(pk, sk, { isDefault: false, updatedAt: db.nowISO() });
    }
  }
}

export async function update(
  debtorId: string,
  id: string,
  updates: TermInput,
): Promise<DebtorPaymentTerm | null> {
  const current = await get(debtorId, id);
  if (!current) return null;
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  // Re-validate the full term when any financial field changes so the
  // advance+balance==100 invariant always holds.
  const touchesFinance =
    updates.name !== undefined ||
    updates.paymentTermsType !== undefined ||
    updates.paymentTerms !== undefined ||
    updates.advancePct !== undefined ||
    updates.balancePct !== undefined ||
    updates.balanceDueDays !== undefined ||
    updates.balanceDueBasis !== undefined ||
    updates.advanceDueBasis !== undefined ||
    updates.dispatchCondition !== undefined;
  if (touchesFinance) {
    const v = validateTermInput({
      name: updates.name !== undefined ? updates.name : current.name,
      paymentTermsType:
        updates.paymentTermsType !== undefined
          ? updates.paymentTermsType
          : current.paymentTermsType,
      paymentTerms: updates.paymentTerms !== undefined ? updates.paymentTerms : current.paymentTerms,
      advancePct: updates.advancePct !== undefined ? updates.advancePct : current.advancePct,
      advanceDueBasis:
        updates.advanceDueBasis !== undefined ? updates.advanceDueBasis : current.advanceDueBasis,
      balancePct: updates.balancePct !== undefined ? updates.balancePct : current.balancePct,
      balanceDueDays:
        updates.balanceDueDays !== undefined ? updates.balanceDueDays : current.balanceDueDays,
      balanceDueBasis:
        updates.balanceDueBasis !== undefined ? updates.balanceDueBasis : current.balanceDueBasis,
      dispatchCondition:
        updates.dispatchCondition !== undefined
          ? updates.dispatchCondition
          : current.dispatchCondition,
    });
    Object.assign(patch, v);
  }
  if (updates.isActive !== undefined) patch.isActive = updates.isActive !== false;
  if (updates.isDefault === true) patch.isDefault = true;
  const { pk, sk } = termKey(debtorId, id);
  await db.updateItem(pk, sk, patch);
  if (updates.isDefault === true) {
    await unsetOthersDefault(debtorId, id);
  }
  return get(debtorId, id);
}

export async function setDefault(debtorId: string, id: string): Promise<DebtorPaymentTerm | null> {
  const current = await get(debtorId, id);
  if (!current) return null;
  if (current.isActive === false) throw new Error("Cannot set an inactive term as default");
  const { pk, sk } = termKey(debtorId, id);
  await db.updateItem(pk, sk, { isDefault: true, updatedAt: db.nowISO() });
  await unsetOthersDefault(debtorId, id);
  return get(debtorId, id);
}

export async function remove(debtorId: string, id: string): Promise<void> {
  const current = await get(debtorId, id);
  if (!current) return;
  const siblings = await listByDebtor(debtorId, {
    activeOnly: false,
  });
  const others = siblings.filter((t) => t.id !== id && t.isActive !== false);
  if (current.isDefault && others.length > 0)
    throw new Error("Set another term as default before deleting the default term");
  const { pk, sk } = termKey(debtorId, id);
  await db.deleteItem(pk, sk);
}
