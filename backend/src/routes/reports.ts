// ===========================================================================
// Reports API — backs the "Reports" module (dashboard + 12 report pages).
//
// Every endpoint reads the live documents (invoices, purchase invoices,
// proformas, advances, expenses, stock, credit/debit notes, debtors,
// suppliers, chart of accounts, journals) across the whole portfolio and
// returns flat, display-ready rows. Sales invoices, purchase invoices and the
// aging report are server-paginated ({ data, total, totalPages }); everything
// else returns the full matching set for client-side filtering.
//
// Field-name note: this Express app snake-cases every res.json body (see
// middleware/transform.ts), so the wire format for the keys below is
// snake_case, e.g. "invoice_number", "total_pages".
// ===========================================================================

import { Router, Request, Response } from "express";
import { authMiddleware } from "../middleware/auth.js";
import * as db from "../dynamodb.js";
import * as Debtor from "../models/debtor.js";
import * as Supplier from "../models/supplier.js";
import * as Invoice from "../models/invoice.js";
import * as PurchaseInvoice from "../models/purchase-invoice.js";
import { balanceOutstanding } from "../models/invoice.js";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const today = () => db.todayDate();

function inRange(
  dateStr: string | null | undefined,
  from?: string,
  to?: string,
) {
  if (!dateStr) return false;
  const d = String(dateStr).slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function daysBetween(a?: string | null, b?: string | null) {
  if (!a || !b) return 0;
  const ms =
    Date.parse(String(b).slice(0, 10)) - Date.parse(String(a).slice(0, 10));
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.round(ms / 86_400_000));
}

function paginate<T>(rows: T[], page: number, limit: number) {
  const safePage = Math.max(1, page);
  const safeLimit = Math.min(5000, Math.max(1, limit));
  const total = rows.length;
  const start = (safePage - 1) * safeLimit;
  return {
    data: rows.slice(start, start + safeLimit),
    total,
    totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    page: safePage,
    limit: safeLimit,
  };
}

function queryStr(v: unknown): string | undefined {
  const s = String(v ?? "");
  return s ? s : undefined;
}

/** Macro bucket used by the status pills: "open" / "closed". */
const CLOSED_STATUSES = new Set(["paid", "cancelled", "rejected"]);

// ─────────────────────────────────────────────────────────────────────────────
// One shared dataset loader — each report needs most of the same tables, so a
// single parallel scan bundle keeps the per-endpoint logic small.
// ─────────────────────────────────────────────────────────────────────────────

async function loadDataset() {
  const [
    users,
    debtors,
    suppliers,
    vendors,
    invoices,
    purchaseInvoices,
    proformas,
    advances,
    expenses,
    movements,
    products,
    notes,
    coa,
    journals,
    journalLines,
    manualEntries,
  ] = await Promise.all([
    db.scanByType("User", { limit: 1000 }) as Promise<any[]>,
    Debtor.list(),
    Supplier.list(),
    db.scanByType("Vendor", { limit: 1000 }) as Promise<any[]>,
    Invoice.list(),
    PurchaseInvoice.list(),
    db.scanByType("PurchaseOrder", { limit: 2000 }) as Promise<any[]>,
    db.scanByType("Advance", { limit: 2000 }) as Promise<any[]>,
    db.scanByType("Expense", { limit: 2000 }) as Promise<any[]>,
    db.scanByType("StockMovement", { limit: 3000 }) as Promise<any[]>,
    db.scanByType("Product", { limit: 2000 }) as Promise<any[]>,
    db.scanByType("CreditDebitNote", { limit: 2000 }) as Promise<any[]>,
    db.scanByType("ChartOfAccount", { limit: 2000 }) as Promise<any[]>,
    db.scanByType("Journal", { limit: 2000 }) as Promise<any[]>,
    db.scanByType("JournalLine", { limit: 5000 }) as Promise<any[]>,
    db.scanByType("ManualBalanceEntry", { limit: 2000 }) as Promise<any[]>,
  ]);

  const clientName = new Map<string, string>();
  for (const u of users) {
    clientName.set(u.id, u.companyName || u.email || u.id);
  }

  const debtorById = new Map<string, any>();
  for (const d of debtors) debtorById.set(d.id, d);
  const vendorById = new Map<string, any>();
  for (const v of vendors) vendorById.set(v.id, v);
  const invoiceById = new Map<string, any>();
  for (const i of invoices) invoiceById.set(i.id, i);
  const piById = new Map<string, any>();
  for (const p of purchaseInvoices) piById.set(p.id, p);
  const poById = new Map<string, any>();
  for (const p of proformas) poById.set(p.id, p);

  const nameOfDebtor = (id?: string | null) =>
    id ? debtorById.get(id)?.name || id : null;
  const nameOfVendor = (id?: string | null) =>
    id ? vendorById.get(id)?.name || id : null;

  return {
    clientName,
    debtorById,
    vendorById,
    invoiceById,
    piById,
    poById,
    nameOfDebtor,
    nameOfVendor,
    users,
    debtors,
    suppliers,
    vendors,
    invoices,
    purchaseInvoices,
    proformas,
    advances,
    expenses,
    movements,
    products,
    notes,
    coa,
    journals,
    journalLines,
    manualEntries,
  };
}

// Shared row-construction helpers -------------------------------------------

function salesRow(inv: any, ctx: any): Record<string, any> {
  const grand = num(inv.grandTotal) || num(inv.amount);
  const amount =
    num(inv.amount) >= 0
      ? num(inv.amount)
      : Math.max(0, grand - num(inv.advanceDeducted));
  const received = num(inv.amountReceived);
  const outstanding = round2(Math.max(0, amount - received));
  const termsDays =
    num(inv.paymentTermsDays) ||
    (inv.dueDate && inv.issueDate
      ? daysBetween(inv.issueDate, inv.dueDate)
      : 0);
  const payDays =
    inv.paidDate && inv.issueDate
      ? daysBetween(inv.issueDate, inv.paidDate)
      : null;
  return {
    id: inv.id,
    invoice_number: inv.invoiceNumber,
    debtor_id: inv.debtorId || null,
    debtor: inv.debtor?.name ?? ctx.nameOfDebtor(inv.debtorId) ?? "—",
    client_id: inv.clientId,
    client: ctx.clientName.get(inv.clientId) ?? "—",
    amount: round2(amount),
    outstanding,
    advance_rate: num(inv.advanceRate) || 0,
    fee_rate: num(inv.feeRate) || 0,
    issue_date: inv.issueDate || null,
    due_date: inv.dueDate || inv.expectedDate || null,
    contractual_terms: !!inv.paymentTerms || !!inv.poNumber,
    status: inv.status,
    paid_date: inv.paidDate ? String(inv.paidDate).slice(0, 10) : null,
    amount_received: round2(received),
    short_payment: inv.shortPayment != null ? num(inv.shortPayment) : null,
    late_days: inv.lateDays != null ? num(inv.lateDays) : null,
    pay_days: payDays,
    noa_status: inv.noaStatus || "not_sent",
    payment_type: inv.paymentType || "manual",
    po_number: inv.poNumber || null,
    terms_days: termsDays || null,
    bl_date: inv.blDate || null,
    due_date_source: inv.dueDateSource || null,
    advance_received_date:
      inv.advanceReceivedDate || inv.advancePaidDate || null,
    created_at: inv.createdAt || null,
  };
}

function purchaseRow(pi: any, ctx: any): Record<string, any> {
  const amount = num(pi.amount) || num(pi.grandTotal) || 0;
  const paid = num(pi.amountPaid);
  const balance =
    pi.balanceDue != null && num(pi.balanceDue) >= 0
      ? num(pi.balanceDue)
      : Math.max(0, amount - paid);
  return {
    id: pi.id,
    invoice_number: pi.invoiceNumber,
    vendor: pi.supplierName ?? ctx.nameOfVendor(pi.vendorId) ?? "—",
    client_id: pi.clientId,
    client: ctx.clientName.get(pi.clientId) ?? "—",
    amount: round2(amount),
    amount_paid: round2(paid),
    balance_due: round2(balance),
    status: pi.status,
    issue_date: pi.issueDate || null,
    due_date: pi.dueDate || pi.expectedDate || null,
    paid_date: pi.paidDate ? String(pi.paidDate).slice(0, 10) : null,
    funded_date: pi.fundedDate ? String(pi.fundedDate).slice(0, 10) : null,
    advance_rate: num(pi.advanceRate) || 0,
    advance_paid_date: pi.advancePaidDate
      ? String(pi.advancePaidDate).slice(0, 10)
      : null,
    po_number: pi.goodsPoNumber || pi.poNumber || null,
    notes: pi.notes || null,
    created_at: pi.createdAt || null,
  };
}

// Live (fundable) sales-invoice statuses used by the aging report.
const LIVE_SALES = new Set([
  "approved",
  "funded",
  "advanced",
  "partially_paid",
  "overdue",
  "disputed",
]);

function agingBuckets(
  inv: any,
  ctx: any,
  nowISO: string,
): Record<string, number> | null {
  if (!LIVE_SALES.has(inv.status)) return null;
  const amount =
    num(inv.amount) >= 0
      ? num(inv.amount)
      : Math.max(0, num(inv.grandTotal) - num(inv.advanceDeducted));
  const balance = round2(Math.max(0, amount - num(inv.amountReceived)));
  if (balance <= 0.005) return null;
  const due = inv.dueDate ? String(inv.dueDate).slice(0, 10) : null;
  const pastDue = due ? Math.max(0, daysBetween(due, nowISO)) : 0;
  return { balance, pastDue };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/buyers — options for the buyer dropdown (Sales + Aging).
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/reports/buyers",
  authMiddleware,
  async (_req: Request, res: Response) => {
    try {
      const debtors = await Debtor.list();
      res.json(
        debtors
          .map((d: any) => ({ id: d.id, name: d.name }))
          .sort((a: any, b: any) =>
            String(a.name).localeCompare(String(b.name)),
          ),
      );
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/sales-invoices — server-paginated.
// Params: page, limit, search, status (all|open|closed), buyer_id,
//         payment_type (mass_upload|bulk_pay|treasury_pay|manual), from, to
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/reports/sales-invoices",
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const ctx = await loadDataset();
      const status = queryStr(req.query.status) || "all";
      const q = (queryStr(req.query.search) || "").toLowerCase();
      const buyerId = queryStr(req.query.buyer_id);
      const paymentType = queryStr(req.query.payment_type);
      const from = queryStr(req.query.from);
      const to = queryStr(req.query.to);

      let rows = ctx.invoices
        .map((inv: any) => salesRow(inv, ctx))
        .filter((r: any) => {
          if (from && !inRange(r.issue_date, from, to)) return false;
          if (status === "open" && CLOSED_STATUSES.has(r.status)) return false;
          if (status === "closed" && !CLOSED_STATUSES.has(r.status))
            return false;
          if (buyerId && r.debtor_id !== buyerId) return false;
          if (paymentType && r.payment_type !== paymentType) return false;
          if (q) {
            const hay =
              `${r.invoice_number} ${r.debtor} ${r.client} ${r.po_number} ${r.noa_status} ${r.payment_type}`.toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        });

      rows.sort((a: any, b: any) =>
        String(b.issue_date || "").localeCompare(String(a.issue_date || "")),
      );
      res.json(
        paginate(
          rows,
          Number(req.query.page) || 1,
          Number(req.query.limit) || 25,
        ),
      );
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/purchase-invoices — server-paginated.
// Params: page, limit, search, status (all|open|closed), from, to
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/reports/purchase-invoices",
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const ctx = await loadDataset();
      const status = queryStr(req.query.status) || "all";
      const q = (queryStr(req.query.search) || "").toLowerCase();
      const from = queryStr(req.query.from);
      const to = queryStr(req.query.to);

      let rows = ctx.purchaseInvoices
        .map((pi: any) => purchaseRow(pi, ctx))
        .filter((r: any) => {
          if (from && !inRange(r.issue_date, from, to)) return false;
          if (status === "open" && CLOSED_STATUSES.has(r.status)) return false;
          if (status === "closed" && !CLOSED_STATUSES.has(r.status))
            return false;
          if (q) {
            const hay =
              `${r.invoice_number} ${r.vendor} ${r.client} ${r.po_number}`.toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        });

      rows.sort((a: any, b: any) =>
        String(b.issue_date || "").localeCompare(String(a.issue_date || "")),
      );
      res.json(
        paginate(
          rows,
          Number(req.query.page) || 1,
          Number(req.query.limit) || 25,
        ),
      );
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/aging — debtor aging buckets, server-paginated.
// Params: page, limit, search, status (all|overdue|pending), buyer_id, from, to
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/reports/aging",
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const ctx = await loadDataset();
      const status = queryStr(req.query.status) || "all";
      const q = (queryStr(req.query.search) || "").toLowerCase();
      const buyerId = queryStr(req.query.buyer_id);
      const from = queryStr(req.query.from);
      const to = queryStr(req.query.to);
      const nowISO = today();

      // Include one (possibly empty) row per live buyer so the filter bar and
      // table stay meaningful even when nothing is currently ageing.
      const byBuyer = new Map<string, any>();
      const seedBuyer = (id: string) => {
        if (byBuyer.has(id)) return byBuyer.get(id);
        const row: any = {
          buyer_id: id,
          buyer: ctx.nameOfDebtor(id) ?? "—",
          invoices: 0,
          current: 0,
          d1_30: 0,
          d31_60: 0,
          d61_90: 0,
          d91_120: 0,
          d120: 0,
          total: 0,
          hasLive: false,
        };
        byBuyer.set(id, row);
        return row;
      };

      for (const inv of ctx.invoices) {
        const bucket = agingBuckets(inv, ctx, nowISO);
        if (!bucket) continue;
        if (from && !inRange(inv.issueDate, from, to)) continue;
        const pastDue = bucket.pastDue;
        if (status === "overdue" && pastDue <= 0) continue;
        if (status === "pending" && pastDue > 0) continue;
        const key = inv.debtorId || "unknown";
        const row = seedBuyer(key);
        row.hasLive = true;
        row.invoices += 1;
        const bal = bucket.balance;
        if (pastDue <= 0) row.current = round2(row.current + bal);
        else if (pastDue <= 30) row.d1_30 = round2(row.d1_30 + bal);
        else if (pastDue <= 60) row.d31_60 = round2(row.d31_60 + bal);
        else if (pastDue <= 90) row.d61_90 = round2(row.d61_90 + bal);
        else if (pastDue <= 120) row.d91_120 = round2(row.d91_120 + bal);
        else row.d120 = round2(row.d120 + bal);
        row.total = round2(row.total + bal);
      }

      let rows = Array.from(byBuyer.values())
        .filter((r) => r.hasLive)
        .map(({ hasLive, ...rest }) => rest);

      if (buyerId) rows = rows.filter((r) => r.buyer_id === buyerId);
      if (q) rows = rows.filter((r) => `${r.buyer}`.toLowerCase().includes(q));

      rows.sort((a, b) => b.total - a.total);
      res.json(
        paginate(
          rows,
          Number(req.query.page) || 1,
          Number(req.query.limit) || 25,
        ),
      );
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/proformas — full set (client-side filtering).
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/reports/proformas",
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const ctx = await loadDataset();
      const from = queryStr(req.query.from);
      const to = queryStr(req.query.to);
      const rows = ctx.proformas.map((p: any) => {
        const party =
          p.side === "sales"
            ? (ctx.nameOfDebtor(p.debtorId) ?? "—")
            : (ctx.nameOfVendor(p.vendorId) ?? "—");
        const date = p.proformaDate || p.issueDate || null;
        return {
          id: p.id,
          po_number: p.poNumber || null,
          proforma_number: p.proformaNumber || null,
          side: p.side,
          party,
          client_id: p.clientId,
          client: ctx.clientName.get(p.clientId) ?? "—",
          amount: round2(num(p.poAmount) || num(p.amount) || 0),
          currency: p.currency || "INR",
          proforma_date: date,
          expected_date: p.expectedDate || p.expectedDeliveryDate || null,
          status: p.status || "draft",
          proforma_status: p.proformaStatus || "draft",
          funded_amount:
            p.proformaFundedAmount != null
              ? round2(num(p.proformaFundedAmount))
              : null,
          funded_at: p.proformaFundedAt
            ? String(p.proformaFundedAt).slice(0, 10)
            : null,
          funding_reference: p.proformaFundingReference || null,
          notes: p.notes || null,
        };
      });
      const filtered = from
        ? rows.filter((r) => inRange(r.proforma_date, from, to))
        : rows;
      res.json(filtered);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/debtors — full set, aggregated from the debtor master + invoices.
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/reports/debtors",
  authMiddleware,
  async (_req: Request, res: Response) => {
    try {
      const ctx = await loadDataset();

      // Per-debtor aggregates across the whole portfolio.
      const agg = new Map<string, any>();
      for (const inv of ctx.invoices) {
        const debtorId = inv.debtorId;
        if (!debtorId) continue;
        let row = agg.get(debtorId);
        if (!row) {
          row = {
            count: 0,
            open: 0,
            closed: 0,
            invoiced: 0,
            paid: 0,
            outstanding: 0,
            oldestOpen: null as string | null,
            latest: null as string | null,
            payDays: [] as number[],
          };
          agg.set(debtorId, row);
        }
        const closed = CLOSED_STATUSES.has(inv.status);
        const amount =
          num(inv.amount) >= 0 ? num(inv.amount) : num(inv.grandTotal);
        row.count += 1;
        if (closed) row.closed += 1;
        else row.open += 1;
        row.invoiced = round2(row.invoiced + amount);
        row.paid = round2(row.paid + num(inv.amountReceived));
        if (!closed) {
          const bal = round2(Math.max(0, amount - num(inv.amountReceived)));
          row.outstanding = round2(row.outstanding + bal);
          const issue = inv.issueDate
            ? String(inv.issueDate).slice(0, 10)
            : null;
          if (
            issue &&
            bal > 0.005 &&
            (!row.oldestOpen || issue < row.oldestOpen)
          )
            row.oldestOpen = issue;
        }
        const issueD = inv.issueDate
          ? String(inv.issueDate).slice(0, 10)
          : null;
        if (issueD && (!row.latest || issueD > row.latest)) row.latest = issueD;
        if (inv.paidDate && inv.issueDate) {
          row.payDays.push(daysBetween(inv.issueDate, inv.paidDate));
        }
      }

      const med = (xs: number[]) => {
        if (xs.length === 0) return null;
        const s = [...xs].sort((a, b) => a - b);
        const mid = Math.floor(s.length / 2);
        return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
      };
      const stats = (xs: number[]) => {
        if (xs.length === 0)
          return { avg: null, median: null, max: null, min: null };
        const sum = xs.reduce((a, b) => a + b, 0);
        return {
          avg: Math.round(sum / xs.length),
          median: med(xs),
          max: Math.max(...xs),
          min: Math.min(...xs),
        };
      };

      const rows = ctx.debtors.map((d: any) => {
        const a = agg.get(d.id) ?? {
          count: 0,
          open: 0,
          closed: 0,
          invoiced: 0,
          paid: 0,
          outstanding: 0,
          oldestOpen: null,
          latest: null,
          payDays: [],
        };
        const st = stats(a.payDays);
        const contact = [d.contactName, d.contactEmail, d.contactPhone]
          .filter(Boolean)
          .join(" · ");
        const address = [d.addressLine, d.city, d.country, d.postalCode]
          .filter(Boolean)
          .join(", ");
        return {
          uid: d.id,
          name: d.name,
          code: d.debtorCode || null,
          legal_entity: d.name,
          registration_no: d.gstin || null,
          invoice_count_total: a.count,
          invoice_count_open: a.open,
          invoice_count_closed: a.closed,
          outstanding: round2(a.outstanding),
          total_invoiced: round2(a.invoiced),
          total_paid: round2(a.paid),
          oldest_open_date: a.oldestOpen,
          latest_invoice_date: a.latest,
          avg_pay_days: st.avg,
          median_pay_days: st.median,
          max_pay_days: st.max,
          min_pay_days: st.min,
          industry: d.industry || null,
          relationship_since: d.createdAt
            ? String(d.createdAt).slice(0, 10)
            : null,
          contact: contact || null,
          address: address || null,
          terms_days: num(d.paymentTermsDays) || null,
          notes: d.notes || null,
        };
      });
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/suppliers — full set.
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/reports/suppliers",
  authMiddleware,
  async (_req: Request, res: Response) => {
    try {
      const suppliers = await Supplier.list();
      const rows = suppliers.map((s: any) => ({
        id: s.id,
        company: s.companyName,
        industry: s.industry || null,
        contact:
          [s.contactName, s.contactEmail, s.contactPhone]
            .filter(Boolean)
            .join(" · ") || null,
        city_country: [s.city, s.country].filter(Boolean).join(", ") || null,
        terms: s.paymentTermsDays ? `${s.paymentTermsDays} days` : null,
        status: s.status || "prospect",
        notes: s.notes || null,
      }));
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/advances — full set.
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/reports/advances",
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const ctx = await loadDataset();
      const from = queryStr(req.query.from);
      const to = queryStr(req.query.to);
      const rows = ctx.advances.map((a: any) => {
        // Resolve the linked document + counterparty.
        let ref: string | null = null;
        let party: string | null = null;
        if (a.invoiceId) {
          const inv = ctx.invoiceById.get(a.invoiceId);
          if (inv) {
            ref = inv.invoiceNumber || null;
            party = ctx.nameOfDebtor(inv.debtorId);
          }
        } else if (a.purchaseInvoiceId) {
          const pi = ctx.piById.get(a.purchaseInvoiceId);
          if (pi) {
            ref = pi.invoiceNumber || null;
            party = pi.supplierName ?? ctx.nameOfVendor(pi.vendorId);
          }
        } else if (a.purchaseOrderId) {
          const po = ctx.poById.get(a.purchaseOrderId);
          if (po) {
            ref = po.proformaNumber || po.poNumber || null;
            party =
              po.side === "sales"
                ? ctx.nameOfDebtor(po.debtorId)
                : ctx.nameOfVendor(po.vendorId);
          }
        }
        return {
          id: a.id,
          side: a.side,
          ref,
          party: party || "—",
          client_id: a.clientId,
          client: ctx.clientName.get(a.clientId) ?? "—",
          amount: round2(num(a.amount)),
          date: a.advanceDate || null,
          payment_ref: a.paymentRef || null,
          reference: a.reference || null,
          status: a.status || "open",
          notes: a.notes || null,
        };
      });
      const filtered = from
        ? rows.filter((r) => inRange(r.date, from, to))
        : rows;
      res.json(filtered);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/expenses — full set.
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/reports/expenses",
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const ctx = await loadDataset();
      const from = queryStr(req.query.from);
      const to = queryStr(req.query.to);
      const rows = ctx.expenses.map((e: any) => {
        let linked: string | null = null;
        if (e.invoiceId)
          linked = ctx.invoiceById.get(e.invoiceId)?.invoiceNumber || null;
        else if (e.purchaseInvoiceId)
          linked = ctx.piById.get(e.purchaseInvoiceId)?.invoiceNumber || null;
        return {
          id: e.id,
          category: e.category,
          description: e.description || null,
          amount: round2(num(e.amount)),
          date: e.expenseDate || null,
          linked_invoice: linked || e.expenseRef || null,
          client_id: e.clientId,
          client: ctx.clientName.get(e.clientId) ?? "—",
        };
      });
      const filtered = from
        ? rows.filter((r) => inRange(r.date, from, to))
        : rows;
      res.json(filtered);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/inventory — full set (confirmed movements per catalogue item).
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/reports/inventory",
  authMiddleware,
  async (_req: Request, res: Response) => {
    try {
      const ctx = await loadDataset();
      const confirmed = ctx.movements.filter(
        (m: any) => m.status === "confirmed",
      );
      const byProduct = new Map<
        string,
        { qty: number; unitCost: number; clientId: string }
      >();
      for (const m of confirmed) {
        if (!m.productId) continue;
        const cur = byProduct.get(m.productId) ?? {
          qty: 0,
          unitCost: num(m.unitCost) || 0,
          clientId: m.clientId,
        };
        cur.qty = round2(
          cur.qty + (m.direction === "in" ? num(m.quantity) : -num(m.quantity)),
        );
        if (m.unitCost != null) cur.unitCost = num(m.unitCost);
        byProduct.set(m.productId, cur);
      }
      const rows = ctx.products
        .filter((p: any) => byProduct.has(p.id))
        .map((p: any) => {
          const s = byProduct.get(p.id)!;
          const qty = s.qty;
          const salePrice = num(p.unitPrice) || 0;
          const unitCost = num(p.unitCost) || s.unitCost || 0;
          return {
            id: p.id,
            item: p.name,
            sku: p.sku || null,
            description: p.description || null,
            closing_qty: qty,
            sale_price: round2(salePrice),
            extended_price: round2(qty * salePrice),
            unit_cost: round2(unitCost),
            extended_cost: round2(qty * unitCost),
            client_id: p.clientId,
            client: ctx.clientName.get(p.clientId) ?? "—",
          };
        })
        .filter((r: any) => r.closing_qty !== 0)
        .sort((a: any, b: any) => b.extended_cost - a.extended_cost);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/portfolio — portfolio summary metrics + per-buyer summary table.
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/reports/portfolio",
  authMiddleware,
  async (_req: Request, res: Response) => {
    try {
      const ctx = await loadDataset();
      const nowISO = today();

      const buyers = new Set<string>();
      let invoices = 0;
      let value = 0;
      let collections = 0;
      let outstanding = 0;
      let openCount = 0;
      let closedCount = 0;
      const payDays: number[] = [];
      const perBuyer = new Map<string, any>();

      for (const inv of ctx.invoices) {
        if (inv.status === "cancelled") continue;
        const closed = CLOSED_STATUSES.has(inv.status);
        if (inv.debtorId) buyers.add(inv.debtorId);

        const grand = num(inv.grandTotal) || num(inv.amount);
        const amount =
          num(inv.amount) >= 0
            ? num(inv.amount)
            : Math.max(0, grand - num(inv.advanceDeducted));
        const received = num(inv.amountReceived);
        const bal = round2(Math.max(0, amount - received));

        // NOTE: invoice `amount` is already net of any advance received against
        // the linked proforma, so collections = amount received on the invoice
        // (never advances) and outstanding + collected = invoiced.
        invoices += 1;
        value = round2(value + amount);
        collections = round2(collections + received);
        outstanding = round2(outstanding + bal);
        if (closed) closedCount += 1;
        else openCount += 1;

        if (inv.paidDate && inv.issueDate)
          payDays.push(daysBetween(inv.issueDate, inv.paidDate));

        const debtorId = inv.debtorId || "unknown";
        let b = perBuyer.get(debtorId);
        if (!b) {
          b = {
            buyer: ctx.nameOfDebtor(inv.debtorId) ?? "—",
            invoices: 0,
            value: 0,
            collections: 0,
            outstanding: 0,
          };
          perBuyer.set(debtorId, b);
        }
        b.invoices += 1;
        b.value = round2(b.value + amount);
        b.collections = round2(b.collections + received);
        b.outstanding = round2(b.outstanding + bal);
      }

      const sorted = [...payDays].sort((x, y) => x - y);
      const median =
        sorted.length === 0
          ? null
          : sorted.length % 2
            ? sorted[Math.floor(sorted.length / 2)]
            : Math.round(
                (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2,
              );
      const avg = payDays.length
        ? Math.round(payDays.reduce((a, b) => a + b, 0) / payDays.length)
        : null;

      const metrics = {
        total_buyers: buyers.size,
        total_invoices: invoices,
        total_invoice_value: round2(value),
        total_collections: round2(collections),
        total_outstanding: round2(outstanding),
        open_invoices: openCount,
        closed_invoices: closedCount,
        avg_payment_days: avg,
        median_payment_days: median,
        as_of: nowISO,
      };

      const rows = Array.from(perBuyer.values())
        .filter((r: any) => r.invoices > 0)
        .sort((a: any, b: any) => b.outstanding - a.outstanding);

      res.json({ metrics, rows });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/balance-sheet — portfolio statement (assets / liabilities /
// equity), as of a date. Rows render as a dedicated statement view.
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/reports/balance-sheet",
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const ctx = await loadDataset();
      const asOf = queryStr(req.query.as_of) || today();
      const nowISO = today();

      // Inventory value (confirmed movements only).
      let inventoryValue = 0;
      const confirmed = ctx.movements.filter(
        (m: any) => m.status === "confirmed",
      );
      const perProduct = new Map<string, { qty: number; unitCost: number }>();
      for (const m of confirmed) {
        if (!m.productId) continue;
        const cur = perProduct.get(m.productId) ?? {
          qty: 0,
          unitCost: num(m.unitCost) || 0,
        };
        cur.qty += m.direction === "in" ? num(m.quantity) : -num(m.quantity);
        if (m.unitCost != null) cur.unitCost = num(m.unitCost);
        perProduct.set(m.productId, cur);
      }
      for (const [, v] of perProduct)
        inventoryValue = round2(
          inventoryValue + Math.max(0, v.qty) * v.unitCost,
        );

      // Accounts receivable: outstanding balances on live invoices as of the date.
      // Invoice `amount` is net of any advance deducted at creation, so the
      // outstanding balance here never double counts customer advances.
      let arTotal = 0;
      const arRows: Array<{ label: string; amount: number }> = [];
      for (const inv of ctx.invoices) {
        if (!LIVE_SALES.has(inv.status)) continue;
        if (inv.issueDate && String(inv.issueDate).slice(0, 10) > asOf)
          continue;
        const bal = balanceOutstanding(inv);
        if (bal <= 0.005) continue;
        arTotal = round2(arTotal + bal);
        arRows.push({
          label: `${inv.invoiceNumber} · ${ctx.nameOfDebtor(inv.debtorId) ?? "—"}`,
          amount: round2(bal),
        });
      }
      const arRowsClean = arRows;

      // Cash & bank: net advance flows + manual bank balances from journals.
      let cash = 0;
      const cashRows: Array<{ label: string; amount: number }> = [];
      for (const a of ctx.advances) {
        if (a.status === "refunded") continue;
        const v = a.side === "sales" ? num(a.amount) : -num(a.amount);
        cash = round2(cash + v);
        cashRows.push({
          label:
            `${a.side === "sales" ? "Customer receipt" : "Supplier payment"} ${a.paymentRef || ""}`.trim(),
          amount: round2(v),
        });
      }

      // Accounts payable: purchase invoices not yet paid.
      let apTotal = 0;
      const apRows: Array<{ label: string; amount: number }> = [];
      for (const pi of ctx.purchaseInvoices) {
        if (CLOSED_STATUSES.has(pi.status)) continue;
        const amount = num(pi.amount) || num(pi.grandTotal) || 0;
        const paid = num(pi.amountPaid);
        const bal = round2(Math.max(0, amount - paid));
        if (bal <= 0.005) continue;
        apTotal = round2(apTotal + bal);
        apRows.push({
          label: `${pi.invoiceNumber} · ${pi.supplierName ?? "—"}`,
          amount: bal,
        });
      }

      // Manual balance entries + journal balances by section.
      const journalByAccount = new Map<
        string,
        { debit: number; credit: number }
      >();
      const accountById = new Map<string, any>();
      for (const j of ctx.journals) {
        if (j.status !== "posted") continue;
        for (const l of ctx.journalLines) {
          if (l.journalId !== j.id) continue;
          const cur = journalByAccount.get(l.accountId) ?? {
            debit: 0,
            credit: 0,
          };
          cur.debit += num(l.debit);
          cur.credit += num(l.credit);
          journalByAccount.set(l.accountId, cur);
          accountById.set(
            l.accountId,
            ctx.coa.find((c: any) => c.id === l.accountId),
          );
        }
      }
      const accountBalance = (id: string, debitNormal: boolean) => {
        const b = journalByAccount.get(id) ?? { debit: 0, credit: 0 };
        return debitNormal
          ? round2(b.debit - b.credit)
          : round2(b.credit - b.debit);
      };

      const manualBySection = new Map<string, number>();
      for (const m of ctx.manualEntries)
        manualBySection.set(
          m.section,
          round2((manualBySection.get(m.section) ?? 0) + num(m.amount)),
        );

      const section = (
        label: string,
        items: Array<{ label: string; amount: number }>,
      ) => {
        const total = round2(items.reduce((s, i) => s + i.amount, 0));
        return { label, items, total };
      };

      const assets: any[] = [];
      assets.push(
        section("Fixed assets", [
          ...ctx.coa
            .filter((c: any) => c.type === "asset" && c.subtype === "fixed")
            .map((c: any) => ({
              label: c.name,
              amount: accountBalance(c.id, true),
            })),
          ...(manualBySection.get("tangible_asset")
            ? [
                {
                  label: "Manual entries",
                  amount: manualBySection.get("tangible_asset")!,
                },
              ]
            : []),
        ]),
      );
      assets.push(
        section("Cash at bank & in hand", [
          ...cashRows,
          ...ctx.coa
            .filter(
              (c: any) =>
                c.type === "asset" &&
                ["bank", "cash", "petty_cash"].includes(c.subtype || ""),
            )
            .map((c: any) => ({
              label: c.name,
              amount: accountBalance(c.id, true),
            })),
          ...(manualBySection.get("cash_bank")
            ? [
                {
                  label: "Manual entries",
                  amount: manualBySection.get("cash_bank")!,
                },
              ]
            : []),
        ]),
      );
      assets.push(section("Accounts receivable", arRowsClean));
      assets.push(
        section(
          "Inventory",
          inventoryValue !== 0
            ? [{ label: "Inventory on hand", amount: inventoryValue }]
            : [],
        ),
      );
      const otherAssets = ctx.coa
        .filter(
          (c: any) =>
            c.type === "asset" &&
            !["fixed", "bank", "cash", "petty_cash"].includes(c.subtype || ""),
        )
        .map((c: any) => ({
          label: c.name,
          amount: accountBalance(c.id, true),
        }));
      const manualOtherAssets =
        (manualBySection.get("other_current_asset") || 0) +
        (manualBySection.get("accounts_receivable") || 0) +
        (manualBySection.get("other_other_asset") || 0);
      if (manualOtherAssets || otherAssets.some((i: any) => i.amount !== 0)) {
        assets.push(
          section("Other current assets", [
            ...otherAssets,
            ...(manualOtherAssets
              ? [{ label: "Manual entries", amount: manualOtherAssets }]
              : []),
          ]),
        );
      }

      const liabilities: any[] = [];
      liabilities.push(section("Accounts payable", apRows));
      const custAdvances = ctx.advances
        .filter(
          (a: any) =>
            a.side === "sales" && a.status !== "refunded" && !a.invoiceId,
        )
        .reduce((s: number, a: any) => s + num(a.amount), 0);
      const liabManual =
        (manualBySection.get("accounts_payable") || 0) +
        (manualBySection.get("customer_advance") || 0) +
        (manualBySection.get("corporation_tax_payable") || 0) +
        (manualBySection.get("other_current_liability") || 0) +
        (manualBySection.get("rounding") || 0);
      const coaLiab = ctx.coa
        .filter((c: any) => c.type === "liability")
        .map((c: any) => ({
          label: c.name,
          amount: accountBalance(c.id, false),
        }));
      const liabRows = [
        ...(custAdvances
          ? [{ label: "Customer advances", amount: round2(custAdvances) }]
          : []),
        ...coaLiab,
        ...(liabManual
          ? [{ label: "Manual entries", amount: liabManual }]
          : []),
      ];
      liabilities.push(section("Liabilities", liabRows));

      const equityItems: Array<{ label: string; amount: number }> = [
        ...ctx.coa
          .filter((c: any) => c.type === "equity")
          .map((c: any) => ({
            label: c.name,
            amount: accountBalance(c.id, false),
          })),
        ...(manualBySection.get("share_capital")
          ? [
              {
                label: "Share capital (manual)",
                amount: manualBySection.get("share_capital")!,
              },
            ]
          : []),
        ...(manualBySection.get("retained_earnings")
          ? [
              {
                label: "Retained earnings (manual)",
                amount: manualBySection.get("retained_earnings")!,
              },
            ]
          : []),
        ...(manualBySection.get("other_equity")
          ? [
              {
                label: "Other equity (manual)",
                amount: manualBySection.get("other_equity")!,
              },
            ]
          : []),
      ];
      const equity = section("Capital & reserves", equityItems);

      const totalAssets = round2(assets.reduce((s, a) => s + a.total, 0));
      const totalLiabilities = round2(
        liabilities.reduce((s, l) => s + l.total, 0),
      );
      const equityTotal = equity.total;

      // The statement always balances: the retained-earnings balancing figure
      // captures accumulated profit not yet posted to the equity ledger.
      const balancingRetained = round2(
        totalAssets - totalLiabilities - equityTotal,
      );
      if (Math.abs(balancingRetained) > 0.005) {
        equity.items.push({
          label: "Retained earnings (balancing)",
          amount: balancingRetained,
        });
        equity.total = round2(equity.total + balancingRetained);
      }

      res.json({
        as_of: asOf,
        generated_at: nowISO,
        assets,
        liabilities,
        equity,
        total_assets: totalAssets,
        total_liabilities: round2(totalLiabilities),
        total_equity: equity.total,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/profit-loss — P&L statement for the period [from, to].
//
// Figures are trade-flow based (the same documents the rest of the platform
// manages): sales/purchase invoices drive turnover and cost of sales, credit
// and debit notes adjust them, purchase advances make up the principal cost,
// and expenses (grouped by category) form the direct + administrative costs.
// The FX difference lines are populated by the UI (manual depreciation
// adjustments) and sent back with every export.
// ─────────────────────────────────────────────────────────────────────────────
const DIRECT_CATEGORY_RULES: Array<{
  key: string;
  label: string;
  test: RegExp;
}> = [
  {
    key: "freight",
    label: "Freight & delivery",
    test: /freight|delivery|transport|shipping|logistic/i,
  },
  {
    key: "customs",
    label: "Customs & duties",
    test: /customs?|dut(y|ies)|import|clearing/i,
  },
  {
    key: "referral",
    label: "Referral fees",
    test: /referral|commission|brokerage/i,
  },
];

router.get(
  "/reports/profit-loss",
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const ctx = await loadDataset();
      let from = queryStr(req.query.from) || "";
      let to = queryStr(req.query.to) || "";
      if (!from || !to) {
        const d = new Date();
        from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
        to = today();
      }

      const inPeriod = (dateStr: string | null | undefined) =>
        inRange(dateStr, from, to);
      const sum = (items: any[], pick: (x: any) => number) =>
        round2(items.reduce((s, x) => s + num(pick(x)), 0));

      // ── Turnover ──────────────────────────────────────────────────────────
      const salesInvoices = ctx.invoices.filter(
        (i: any) =>
          !["draft", "cancelled", "rejected"].includes(i.status) &&
          inPeriod(i.issueDate),
      );
      const salesNotes = ctx.notes.filter(
        (n: any) => n.invoiceId && inPeriod(n.noteDate || n.createdAt),
      );

      const grossSales = sum(salesInvoices, (i) =>
        num(i.amount) >= 0
          ? num(i.amount)
          : Math.max(0, num(i.grandTotal) - num(i.advanceDeducted)),
      );
      const otherSalesIncome = sum(
        salesNotes.filter((n: any) => n.kind === "debit"),
        (n) => num(n.amount),
      );
      const debitNoteAdjustments = -sum(
        salesNotes.filter((n: any) => n.kind === "credit"),
        (n) => num(n.amount),
      );

      const turnoverLines = [
        {
          key: "gross_sales",
          label: "Gross sales",
          amount: grossSales,
          indent: 0,
        },
        {
          key: "other_sales_income",
          label: "Other sales income",
          amount: round2(otherSalesIncome),
          indent: 0,
        },
        {
          key: "debit_note_adjustments",
          label: "Debit-note adjustments",
          amount: round2(debitNoteAdjustments),
          indent: 0,
        },
      ];
      const turnoverTotal = round2(
        grossSales + otherSalesIncome + debitNoteAdjustments,
      );

      // ── Cost of sales ─────────────────────────────────────────────────────
      const purchaseInvoices = ctx.purchaseInvoices.filter(
        (p: any) =>
          !["draft", "cancelled"].includes(p.status) && inPeriod(p.issueDate),
      );
      const purchaseNotes = ctx.notes.filter(
        (n: any) => n.purchaseInvoiceId && inPeriod(n.noteDate || n.createdAt),
      );
      const grossPurchases = sum(
        purchaseInvoices,
        (p) => num(p.amount) || num(p.grandTotal),
      );
      const creditNoteReturns = -sum(
        purchaseNotes.filter((n: any) => n.kind === "credit"),
        (n) => num(n.amount),
      );
      const principalCost = sum(
        ctx.advances.filter(
          (a: any) =>
            a.side === "purchase" &&
            a.status !== "refunded" &&
            inPeriod(a.advanceDate),
        ),
        (a) => num(a.amount),
      );

      // Expenses: split into direct-cost lines and the admin by-category map.
      const periodExpenses = ctx.expenses.filter((e: any) =>
        inPeriod(e.expenseDate || e.createdAt),
      );
      const adminByCategory = new Map<string, number>();
      const directCosts = new Map<string, number>();
      for (const rule of DIRECT_CATEGORY_RULES) directCosts.set(rule.key, 0);
      for (const e of periodExpenses) {
        const cat = String(e.category || "Uncategorised");
        const rule = DIRECT_CATEGORY_RULES.find((r) => r.test.test(cat));
        if (rule)
          directCosts.set(
            rule.key,
            round2((directCosts.get(rule.key) ?? 0) + num(e.amount)),
          );
        else
          adminByCategory.set(
            cat,
            round2((adminByCategory.get(cat) ?? 0) + num(e.amount)),
          );
      }

      // Journal-posted expenses not already captured by the expense documents.
      const expenseAccounts = ctx.coa.filter(
        (c: any) => c.type === "expense" || c.type === "other_expense",
      );
      for (const acc of expenseAccounts) {
        const b = journalBalance(ctx, acc.id, from, to);
        if (Math.abs(b) < 0.005) continue;
        const name =
          acc.type === "other_expense" && /tax/i.test(acc.name || "")
            ? null
            : acc.name; // taxes handled below
        if (name)
          adminByCategory.set(
            name,
            round2((adminByCategory.get(name) ?? 0) + b),
          );
      }

      const costLines = [
        {
          key: "gross_purchases",
          label: "Gross purchases",
          amount: round2(grossPurchases),
          indent: 0,
        },
        {
          key: "credit_note_returns",
          label: "Credit-note returns",
          amount: round2(creditNoteReturns),
          indent: 0,
        },
        {
          key: "principal_cost",
          label: "Principal cost (advances to suppliers)",
          amount: round2(principalCost),
          indent: 0,
        },
        ...Array.from(directCosts.entries())
          .filter(([, v]) => Math.abs(v) > 0.005)
          .map(([key, v]) => {
            const rule = DIRECT_CATEGORY_RULES.find((r) => r.key === key)!;
            return { key, label: rule.label, amount: v, indent: 0 };
          }),
      ];
      const costTotal = round2(
        grossPurchases +
          creditNoteReturns +
          principalCost +
          Array.from(directCosts.values()).reduce((s, v) => s + v, 0),
      );

      const grossProfit = round2(turnoverTotal - costTotal);

      // ── Administrative costs (by category) ────────────────────────────────
      const adminRows = Array.from(adminByCategory.entries())
        .filter(([, v]) => Math.abs(v) > 0.005)
        .sort((a, b) => b[1] - a[1])
        .map(([label, amount]) => ({
          key: label.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
          label,
          amount: round2(amount),
        }));
      const adminTotal = round2(adminRows.reduce((s, r) => s + r.amount, 0));
      const operatingProfit = round2(grossProfit - adminTotal);

      // ── Other income/expenses posted to journals ──────────────────────────
      let otherNet = 0;
      for (const c of ctx.coa) {
        if (c.type !== "other_income" && c.type !== "other_expense") continue;
        if (c.type === "other_expense" && /tax/i.test(c.name || "")) continue;
        otherNet = round2(
          otherNet +
            journalBalance(
              ctx,
              c.id,
              from,
              to,
              c.type === "other_income" ? "credit" : "debit",
            ),
        );
      }
      const profitBeforeTax = round2(operatingProfit + otherNet);

      // ── Taxation (by category) ────────────────────────────────────────────
      const taxRows: Array<{ key: string; label: string; amount: number }> = [];
      for (const acc of ctx.coa) {
        const isTax =
          acc.type === "other_expense" && /tax/i.test(acc.name || "");
        if (!isTax) continue;
        const b = journalBalance(ctx, acc.id, from, to, "debit");
        if (Math.abs(b) < 0.005) continue;
        taxRows.push({ key: acc.id, label: acc.name, amount: round2(b) });
      }
      // GST accounted on the documents themselves (output less input) shows up
      // here as the net indirect-tax position for the period.
      const outputGst = sum(salesInvoices, (i) => num(i.gstTotal));
      const inputGst = sum(purchaseInvoices, (p) => num(p.gstTotal));
      const netGst = round2(outputGst - inputGst);
      if (Math.abs(netGst) > 0.005) {
        taxRows.push({
          key: "net_gst",
          label: `GST (output ${fmt0(outputGst)} − input ${fmt0(inputGst)})`,
          amount: netGst,
        });
      }
      const taxTotal = round2(taxRows.reduce((s, r) => s + r.amount, 0));
      const profitAfterTax = round2(profitBeforeTax - taxTotal);

      res.json({
        from,
        to,
        generated_at: today(),
        turnover: { lines: turnoverLines, total: turnoverTotal },
        cost_of_sales: { lines: costLines, total: costTotal },
        gross_profit: grossProfit,
        admin: { lines: adminRows, total: adminTotal },
        operating_profit: operatingProfit,
        other_net: otherNet,
        profit_before_tax: profitBeforeTax,
        tax: { lines: taxRows, total: taxTotal },
        profit_after_tax: profitAfterTax,
        fx: { turnover: 0, cost_of_sales: 0 }, // manual depreciation adjustments live in the UI
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

function journalBalance(
  ctx: any,
  accountId: string,
  from: string,
  to: string,
  normal: "debit" | "credit" = "debit",
): number {
  const journals = ctx.journals.filter(
    (j: any) =>
      j.status === "posted" && inRange(j.journalDate || j.createdAt, from, to),
  );
  const ids = new Set(journals.map((j: any) => j.id));
  let debit = 0;
  let credit = 0;
  for (const l of ctx.journalLines) {
    if (l.accountId !== accountId || !ids.has(l.journalId)) continue;
    debit += num(l.debit);
    credit += num(l.credit);
  }
  return normal === "debit" ? round2(debit - credit) : round2(credit - debit);
}

function fmt0(n: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

export default router;
