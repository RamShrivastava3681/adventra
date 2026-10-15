import * as Invoice from "../models/invoice.js";
import * as PurchaseInvoice from "../models/purchase-invoice.js";
import * as Debtor from "../models/debtor.js";
import * as Supplier from "../models/supplier.js";
import * as Vendor from "../models/vendor.js";
import * as db from "../dynamodb.js";

// =============================================================================
// Bank statement reconciliation
//
// Wire shape (camelCase here; the response middleware snake_cases it and the
// frontend api-client camelizes it back):
//   reconcile → { totalEntries, matchedCount, partialCount, unmatchedCount,
//                 alreadyAppliedCount, matches: ReconciliationMatch[] }
//   apply     ← { matches: ApplyItem[] }
//   apply     → { success, appliedCount, failedCount, results: ApplyResult[] }
//
// Credit entries (money in) match SALES invoices; debit entries (money out)
// match PURCHASE invoices. Amounts are compared against the outstanding
// balance, never the document total.
// =============================================================================

export interface BankStatementEntry {
  id?: string;
  date?: string; // YYYY-MM-DD
  description?: string; // Narration
  reference?: string | null; // Explicit UTR if available
  amount?: number;
  type?: "credit" | "debit"; // credit = customer money in, debit = vendor money out
}

export type MatchConfidence = "exact_utr" | "invoice_in_narration" | "amount_party_exact" | "unmatched";
export type InvoiceKind = "sales" | "purchase";

export interface ReconciliationMatch {
  entryId: string;
  entryDate: string;
  narration: string;
  entryAmount: number; // absolute amount
  entryType: "credit" | "debit";
  matchedInvoiceId: string | null;
  matchedInvoiceNumber: string | null;
  matchedInvoiceType: InvoiceKind | null;
  partyName: string | null;
  invoiceTotal: number | null;
  invoiceBalance: number | null;
  detectedUtr: string | null;
  matchConfidence: MatchConfidence;
  /** Entry amount equals the invoice's outstanding balance (within ₹1). */
  amountMatches: boolean;
  notes: string;
  /** The UTR is already recorded on the matched invoice — nothing to apply. */
  applied: boolean;
}

export interface ApplyItem {
  entryId?: string;
  matchedInvoiceId: string | null;
  matchedInvoiceType: InvoiceKind | null;
  entryAmount: number;
  entryDate?: string;
  detectedUtr?: string | null;
  narration?: string;
}

export interface ApplyResult {
  entryId: string | null;
  invoiceId: string;
  invoiceNumber: string;
  invoiceType: InvoiceKind | string;
  status: "applied" | "failed";
  invoiceStatus: string | null;
  amountApplied: number;
  message: string;
  error?: string;
}

/** Fired after each successful apply so the route can run the same side effects as manual payment recording. */
export type AppliedHook = (e: {
  kind: InvoiceKind;
  before: any;
  after: any;
  amount: number;
  utr: string;
  paymentDate: string;
}) => void | Promise<void>;

const AMOUNT_TOLERANCE = 1; // ₹1
const CLOSED_STATUSES = new Set(["draft", "cancelled", "rejected", "paid"]);

const round2 = (n: number) => Math.round(n * 100) / 100;
const compact = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ── UTR extraction ───────────────────────────────────────────────────────────

const UTR_KEYWORDS = new Set(["UTR", "UTRNO", "RRN", "REF", "REFNO", "TXNID", "TXN", "TRANID"]);
const NON_UTR_PREFIX = /^(INV|PO|SO|BILL|PI|GRN|DN|CN)\d/;

/**
 * Extract UTR / bank reference candidates from a narration, best first.
 * Handles e.g. "NEFT-AXIS-CMS123456789-PARTY", "NEFT/AXN882910394821/M/S TEXTILES/INV-001",
 * "RTGS/HDFC887766554433/...", "IMPS/P2A/412345678901/NAME", "UPI/412345678901/...".
 * Only the strongest tier of narration tokens is returned so arbitrary long
 * numbers (account numbers etc.) are ignored when a proper reference exists.
 */
export function extractUtrsFromNarration(narration: string | undefined | null, explicitRef?: string | null): string[] {
  const out: string[] = [];
  const add = (v: string) => {
    if (v && !out.includes(v)) out.push(v);
  };
  const ref = compact(explicitRef);
  if (ref.length >= 6) add(ref);

  const tokens = String(narration || "").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const keyword: string[] = []; // tier 1: token right after UTR/RRN/REF keyword
  const alnum: string[] = []; // tier 2: bank-style alphanumeric refs (HDFC887766554433, CMS123456789, AXN8829...)
  const rrn12: string[] = []; // tier 3: 12-digit IMPS/UPI RRN
  const longNum: string[] = []; // tier 4: other long numerics (13-22 digits)

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.length < 6 || t.length > 24 || NON_UTR_PREFIX.test(t)) continue;
    const digits = (t.match(/\d/g) || []).length;
    const letters = t.length - digits;
    const prev = tokens[i - 1] ?? "";
    const prev2 = tokens[i - 2] ?? "";
    const afterKeyword = UTR_KEYWORDS.has(prev) || (prev === "NO" && UTR_KEYWORDS.has(prev2));
    if (afterKeyword && digits >= 4) keyword.push(t);
    else if (letters > 0 && digits >= 8 && t.length >= 10 && t.length <= 22) alnum.push(t);
    else if (letters === 0 && t.length === 12) rrn12.push(t);
    else if (letters === 0 && t.length >= 13 && t.length <= 22) longNum.push(t);
  }
  const best = [keyword, alnum, rrn12, longNum].find((tier) => tier.length > 0) ?? [];
  best.forEach(add);
  return out;
}

/** UTR tokens already stored on a document reference field (may hold several, comma-separated). */
function refTokens(v: unknown): string[] {
  return String(v ?? "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((t) => t.length >= 6);
}

function utrEquals(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return s.length >= 12 && l.includes(s);
}

function mergeRef(existing: unknown, utr: string): string {
  const cur = String(existing ?? "").trim();
  if (!cur) return utr;
  if (refTokens(cur).some((t) => utrEquals(t, utr))) return cur;
  return `${cur}, ${utr}`.slice(0, 500);
}

// ── Document helpers ─────────────────────────────────────────────────────────

interface Doc {
  kind: InvoiceKind;
  id: string;
  number: string;
  altNumbers: string[]; // e.g. PO numbers for purchase invoices
  partyName: string;
  status: string;
  total: number;
  balance: number;
  paidSoFar: number;
  refField: unknown;
  reconciledUtrs: string[];
  dueDate: string;
}

function salesDoc(inv: any, debtorMap: Map<string, string>): Doc {
  return {
    kind: "sales",
    id: inv.id,
    number: String(inv.invoiceNumber || inv.id),
    altNumbers: [],
    partyName: debtorMap.get(inv.debtorId) || inv.customerName || "",
    status: String(inv.status || ""),
    total: Invoice.netReceivable(inv),
    balance: Invoice.balanceOutstanding(inv),
    paidSoFar: Number(inv.amountReceived) || 0,
    refField: inv.utr_reference,
    reconciledUtrs: Array.isArray(inv.reconciledUtrs) ? inv.reconciledUtrs : [],
    dueDate: String(inv.dueDate || "9999-12-31"),
  };
}

function purchasePayable(pi: any): number {
  return Number(pi.amount) || Number(pi.grandTotal) || 0;
}

function purchaseDoc(pi: any, partyMap: Map<string, string>): Doc {
  const payable = purchasePayable(pi);
  const paid = Number(pi.amountPaid) || 0;
  return {
    kind: "purchase",
    id: pi.id,
    number: String(pi.invoiceNumber || pi.id),
    altNumbers: [pi.goodsPoNumber, pi.poNumber].filter(Boolean).map(String),
    partyName: partyMap.get(pi.vendorId) || partyMap.get(pi.supplierId) || pi.supplierName || "",
    status: String(pi.status || ""),
    total: round2(payable),
    balance: round2(Math.max(0, payable - paid)),
    paidSoFar: paid,
    refField: pi.paymentReference,
    reconciledUtrs: Array.isArray(pi.reconciledUtrs) ? pi.reconciledUtrs : [],
    dueDate: String(pi.dueDate || "9999-12-31"),
  };
}

const isOpen = (d: Doc) => !CLOSED_STATUSES.has(d.status) && d.balance > 0.005;

/**
 * Is this UTR already recorded as a payment on the document? True when bank
 * reconciliation applied it before, or when the reference field carries it and
 * a payment has already been booked (manual payment with the same UTR).
 */
function utrAlreadyRecorded(d: Pick<Doc, "refField" | "reconciledUtrs" | "paidSoFar" | "status">, utr: string): boolean {
  if (!utr) return false;
  if (d.reconciledUtrs.some((u) => utrEquals(compact(u), utr))) return true;
  const hasPayment = d.paidSoFar > 0 || d.status === "paid";
  return hasPayment && refTokens(d.refField).some((t) => utrEquals(t, utr));
}

/** Regex for an invoice number inside a narration with token boundaries ("INV-1" ≠ "INV-12"). */
function numberRegex(num: string): RegExp | null {
  const c = compact(num);
  if (c.length < 4) return null;
  if (/^\d+$/.test(c) && c.length < 5) return null; // short pure numbers are too ambiguous
  const parts = String(num).toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (parts.length === 0) return null;
  const body = parts.map(escapeRe).join("[^A-Z0-9]?");
  return new RegExp(`(?<![A-Z0-9])${body}(?![A-Z0-9])`);
}

const NAME_NOISE = /\b(M\/S|MS|MESSRS|PVT|PRIVATE|LTD|LIMITED|LLP|CO|COMPANY|AND|THE|INC|CORP)\b/g;
function normName(s: string): string {
  return ` ${String(s || "")
    .toUpperCase()
    .replace(/M\/S/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(NAME_NOISE, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

// ── Matching ─────────────────────────────────────────────────────────────────

const SCORE: Record<Exclude<MatchConfidence, "unmatched">, number> = {
  exact_utr: 300,
  invoice_in_narration: 200,
  amount_party_exact: 100,
};

/**
 * Match statement entries against open sales (credits) and purchase (debits)
 * invoices. Each entry gets its strongest candidate across all invoices and
 * each invoice is claimed by at most one entry per run (global greedy by score).
 */
export async function matchBankStatement(entries: BankStatementEntry[]): Promise<{
  totalEntries: number;
  matchedCount: number;
  partialCount: number;
  unmatchedCount: number;
  alreadyAppliedCount: number;
  matches: ReconciliationMatch[];
}> {
  // Shared-database mode: reconcile against the whole company's invoices.
  const [invoices, purchaseInvoices, debtors, suppliers, vendors] = await Promise.all([
    Invoice.list().catch(() => [] as any[]),
    PurchaseInvoice.list().catch(() => [] as any[]),
    Debtor.list().catch(() => [] as any[]),
    Supplier.list().catch(() => [] as any[]),
    Vendor.list().catch(() => [] as any[]),
  ]);

  const debtorMap = new Map<string, string>(debtors.map((d: any) => [d.id, d.name || d.companyName || ""]));
  const partyMap = new Map<string, string>([
    ...suppliers.map((s: any) => [s.id, s.companyName || s.name || ""] as [string, string]),
    ...vendors.map((v: any) => [v.id, v.name || ""] as [string, string]),
  ]);

  const salesDocs = invoices.map((i: any) => salesDoc(i, debtorMap));
  const purchaseDocs = purchaseInvoices.map((p: any) => purchaseDoc(p, partyMap));

  const usedIds = new Set<string>();
  const rows = entries.map((entry, idx) => {
    let entryId = String(entry.id || `entry-${idx + 1}`);
    while (usedIds.has(entryId)) entryId = `${entryId}-${idx + 1}`;
    usedIds.add(entryId);
    const rawAmount = Number(entry.amount) || 0;
    const entryType: "credit" | "debit" = entry.type === "debit" || entry.type === "credit" ? entry.type : rawAmount < 0 ? "debit" : "credit";
    const narration = String(entry.description || "");
    return {
      idx,
      entryId,
      entryType,
      entryDate: String(entry.date || db.todayDate()),
      narration,
      amount: round2(Math.abs(rawAmount)),
      utrs: extractUtrsFromNarration(narration, entry.reference),
      narrUpper: narration.toUpperCase(),
      narrName: normName(narration),
    };
  });

  const result: ReconciliationMatch[] = rows.map((r) => ({
    entryId: r.entryId,
    entryDate: r.entryDate,
    narration: r.narration,
    entryAmount: r.amount,
    entryType: r.entryType,
    matchedInvoiceId: null,
    matchedInvoiceNumber: null,
    matchedInvoiceType: null,
    partyName: null,
    invoiceTotal: null,
    invoiceBalance: null,
    detectedUtr: r.utrs[0] ?? null,
    matchConfidence: "unmatched",
    amountMatches: false,
    notes: "",
    applied: false,
  }));

  const setDoc = (m: ReconciliationMatch, d: Doc) => {
    m.matchedInvoiceId = d.id;
    m.matchedInvoiceNumber = d.number;
    m.matchedInvoiceType = d.kind;
    m.partyName = d.partyName || null;
    m.invoiceTotal = d.total;
    m.invoiceBalance = d.balance;
  };

  // 1) Idempotency: a UTR already booked on an invoice means this line is done.
  const done = new Set<number>();
  for (const r of rows) {
    if (r.amount <= 0) continue;
    const docs = r.entryType === "credit" ? salesDocs : purchaseDocs;
    for (const utr of r.utrs) {
      const d = docs.find((doc) => utrAlreadyRecorded(doc, utr));
      if (d) {
        const m = result[r.idx];
        setDoc(m, d);
        m.detectedUtr = utr;
        m.matchConfidence = "exact_utr";
        m.applied = true;
        m.notes = `UTR ${utr} is already recorded on ${d.kind} invoice ${d.number} — nothing to apply.`;
        done.add(r.idx);
        break;
      }
    }
  }

  // 2) Score every (entry, open invoice) pair.
  type Cand = { idx: number; doc: Doc; conf: Exclude<MatchConfidence, "unmatched">; score: number; amountMatches: boolean; utr: string | null };
  const cands: Cand[] = [];
  const openSales = salesDocs.filter(isOpen);
  const openPurchases = purchaseDocs.filter(isOpen);
  const regexCache = new Map<string, RegExp | null>();
  const reFor = (num: string) => {
    if (!regexCache.has(num)) regexCache.set(num, numberRegex(num));
    return regexCache.get(num)!;
  };

  for (const r of rows) {
    if (done.has(r.idx) || r.amount <= 0) continue;
    const docs = r.entryType === "credit" ? openSales : openPurchases;
    for (const d of docs) {
      const amountMatches = Math.abs(d.balance - r.amount) <= AMOUNT_TOLERANCE;
      let conf: Cand["conf"] | null = null;
      let utr: string | null = null;
      let score = 0;

      const docRefs = refTokens(d.refField);
      const hitUtr = r.utrs.find((u) => docRefs.some((t) => utrEquals(t, u)));
      if (hitUtr) {
        conf = "exact_utr";
        utr = hitUtr;
        score = SCORE.exact_utr;
      } else {
        const numHit = [d.number, ...d.altNumbers].findIndex((n) => {
          const re = reFor(n);
          return !!re && re.test(r.narrUpper);
        });
        if (numHit >= 0) {
          conf = "invoice_in_narration";
          score = SCORE.invoice_in_narration - (numHit > 0 ? 20 : 0); // PO number weaker than invoice number
        } else if (amountMatches) {
          const name = normName(d.partyName);
          if (name.trim().length > 3 && r.narrName.includes(name)) {
            conf = "amount_party_exact";
            score = SCORE.amount_party_exact;
          }
        }
      }
      if (!conf) continue;
      if (amountMatches) score += 10;
      else if (r.amount > d.balance + AMOUNT_TOLERANCE) score -= 5; // overpayment is less likely the right invoice
      cands.push({ idx: r.idx, doc: d, conf, score, amountMatches, utr: utr ?? r.utrs[0] ?? null });
    }
  }

  // 3) Greedy assignment: strongest pair first; one invoice ↔ one entry.
  cands.sort(
    (a, b) =>
      b.score - a.score ||
      a.doc.dueDate.localeCompare(b.doc.dueDate) || // oldest due first among equals
      a.idx - b.idx,
  );
  const claimedDocs = new Set<string>();
  const assigned = new Set<number>();
  const contested = new Set<number>();
  for (const c of cands) {
    if (assigned.has(c.idx)) continue;
    const key = `${c.doc.kind}:${c.doc.id}`;
    if (claimedDocs.has(key)) {
      contested.add(c.idx);
      continue;
    }
    claimedDocs.add(key);
    assigned.add(c.idx);
    const m = result[c.idx];
    setDoc(m, c.doc);
    m.matchConfidence = c.conf;
    m.amountMatches = c.amountMatches;
    if (c.utr) m.detectedUtr = c.utr;
    const amtNote = c.amountMatches
      ? "amount matches the outstanding balance"
      : rows[c.idx].amount < c.doc.balance
        ? `partial payment (₹${rows[c.idx].amount} of ₹${c.doc.balance} outstanding)`
        : `amount exceeds outstanding ₹${c.doc.balance} — only the balance will be applied`;
    const how =
      c.conf === "exact_utr"
        ? `UTR ${c.utr} matches the reference on ${c.doc.number}`
        : c.conf === "invoice_in_narration"
          ? `${c.doc.number} found in narration`
          : `party "${c.doc.partyName}" with exact amount`;
    m.notes = `${how}; ${amtNote}.${m.detectedUtr ? "" : " No UTR detected — add a reference column to apply."}`;
  }

  for (const r of rows) {
    const m = result[r.idx];
    if (done.has(r.idx) || assigned.has(r.idx)) continue;
    if (r.amount <= 0) m.notes = "Entry has no amount.";
    else if (contested.has(r.idx)) m.notes = "Candidate invoice was claimed by a stronger statement entry in this run.";
    else if (r.utrs.length > 0)
      m.notes = `Detected UTR ${r.utrs.join(", ")} does not match any open ${r.entryType === "credit" ? "sales" : "purchase"} invoice.`;
    else m.notes = "No UTR, invoice number or party name + amount match found.";
  }

  const live = result.filter((m) => !m.applied);
  return {
    totalEntries: result.length,
    matchedCount: live.filter((m) => m.matchedInvoiceId && m.amountMatches).length,
    partialCount: live.filter((m) => m.matchedInvoiceId && !m.amountMatches).length,
    unmatchedCount: live.filter((m) => !m.matchedInvoiceId).length,
    alreadyAppliedCount: result.length - live.length,
    matches: result,
  };
}

// ── Apply ────────────────────────────────────────────────────────────────────

/**
 * Apply confirmed matches. Sales invoices go through Invoice.recordPayment (the
 * same accumulate-and-derive-status path as POST /invoices/:id/payment);
 * purchase invoices accumulate amountPaid and let the model derive
 * paid / partially_paid + balanceDue (as bulk payments do). The UTR is stored
 * on the invoice and in `reconciledUtrs` so the same line cannot be applied twice.
 */
export async function applyReconciliation(
  items: ApplyItem[],
  onApplied?: AppliedHook,
): Promise<{ success: boolean; appliedCount: number; failedCount: number; results: ApplyResult[] }> {
  const results: ApplyResult[] = [];
  const batchUtrs = new Set<string>();

  for (const item of items) {
    const id = String(item?.matchedInvoiceId || "");
    const kind = item?.matchedInvoiceType;
    const entryId = item?.entryId ? String(item.entryId) : null;
    const fail = (msg: string, number?: string): void => {
      results.push({
        entryId,
        invoiceId: id,
        invoiceNumber: number || id,
        invoiceType: kind || "unknown",
        status: "failed",
        invoiceStatus: null,
        amountApplied: 0,
        message: msg,
        error: msg,
      });
    };

    try {
      if (!id || (kind !== "sales" && kind !== "purchase")) {
        fail("Missing matched invoice");
        continue;
      }
      const amount = round2(Math.abs(Number(item.entryAmount) || 0));
      if (!(amount > 0)) {
        fail("Payment amount must be greater than zero");
        continue;
      }
      const utr = compact(item.detectedUtr);
      if (utr.length < 6) {
        fail("A UTR / bank reference is required to apply a statement line");
        continue;
      }
      if (batchUtrs.has(utr)) {
        fail(`UTR ${utr} appears more than once in this batch`);
        continue;
      }
      const paymentDate = /^\d{4}-\d{2}-\d{2}$/.test(String(item.entryDate || "")) ? String(item.entryDate) : db.todayDate();

      if (kind === "sales") {
        const inv: any = await Invoice.get(id);
        if (!inv) {
          fail("Sales invoice not found");
          continue;
        }
        const d = salesDoc(inv, new Map());
        if (CLOSED_STATUSES.has(d.status) || d.balance <= 0.005) {
          fail(`Invoice is ${d.balance <= 0.005 ? "already fully paid" : d.status} — cannot record a payment`, d.number);
          continue;
        }
        if (utrAlreadyRecorded(d, utr)) {
          fail(`UTR ${utr} is already recorded on this invoice`, d.number);
          continue;
        }
        // Within ₹1 of the balance (rounding) or more than it → settle the balance.
        const applyAmt = amount >= d.balance - AMOUNT_TOLERANCE ? d.balance : amount;
        await Invoice.recordPayment(id, applyAmt, paymentDate);
        const after: any = await db.updateItem(`INVOICE#${id}`, `INVOICE#${id}`, {
          utr_reference: mergeRef(inv.utr_reference, utr),
          reconciledUtrs: [...d.reconciledUtrs, utr],
          updatedAt: db.nowISO(),
        });
        batchUtrs.add(utr);
        const newStatus = String(after?.status ?? "");
        const excess = round2(amount - applyAmt);
        results.push({
          entryId,
          invoiceId: id,
          invoiceNumber: d.number,
          invoiceType: "sales",
          status: "applied",
          invoiceStatus: newStatus,
          amountApplied: applyAmt,
          message: `₹${applyAmt} recorded on ${d.number} (UTR ${utr}) — now ${newStatus === "paid" ? "PAID" : "PARTIALLY PAID"}${excess > AMOUNT_TOLERANCE ? `; ₹${excess} excess not applied` : ""}`,
        });
        if (onApplied) await Promise.resolve(onApplied({ kind: "sales", before: inv, after, amount: applyAmt, utr, paymentDate })).catch(() => {});
      } else {
        const pi: any = await PurchaseInvoice.get(id);
        if (!pi) {
          fail("Purchase invoice not found");
          continue;
        }
        const d = purchaseDoc(pi, new Map());
        if (CLOSED_STATUSES.has(d.status) || d.balance <= 0.005) {
          fail(`Purchase invoice is ${d.balance <= 0.005 ? "already fully paid" : d.status} — cannot record a payment`, d.number);
          continue;
        }
        if (utrAlreadyRecorded(d, utr)) {
          fail(`UTR ${utr} is already recorded on this purchase invoice`, d.number);
          continue;
        }
        const applyAmt = amount >= d.balance - AMOUNT_TOLERANCE ? d.balance : amount;
        const newPaid = round2(d.paidSoFar + applyAmt);
        const fullyPaid = newPaid >= d.total - 0.005;
        // The model derives paid / partially_paid + balanceDue from amountPaid.
        await PurchaseInvoice.update(id, {
          amountPaid: newPaid,
          paymentReference: mergeRef(pi.paymentReference, utr),
          ...(fullyPaid ? { paidDate: paymentDate } : {}),
        });
        const after: any = await db.updateItem(`PURCHASE_INVOICE#${id}`, `PURCHASE_INVOICE#${id}`, {
          reconciledUtrs: [...d.reconciledUtrs, utr],
          updatedAt: db.nowISO(),
        });
        batchUtrs.add(utr);
        const newStatus = String(after?.status ?? "");
        const excess = round2(amount - applyAmt);
        results.push({
          entryId,
          invoiceId: id,
          invoiceNumber: d.number,
          invoiceType: "purchase",
          status: "applied",
          invoiceStatus: newStatus,
          amountApplied: applyAmt,
          message: `₹${applyAmt} paid on ${d.number} (UTR ${utr}) — now ${newStatus === "paid" ? "PAID" : "PARTIALLY PAID"}${excess > AMOUNT_TOLERANCE ? `; ₹${excess} excess not applied` : ""}`,
        });
        if (onApplied) await Promise.resolve(onApplied({ kind: "purchase", before: pi, after, amount: applyAmt, utr, paymentDate })).catch(() => {});
      }
    } catch (err: any) {
      fail(err?.message || "Failed to reconcile");
    }
  }

  const appliedCount = results.filter((r) => r.status === "applied").length;
  const failedCount = results.length - appliedCount;
  return { success: appliedCount > 0 && failedCount === 0, appliedCount, failedCount, results };
}
