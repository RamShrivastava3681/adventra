import { Router, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { effectiveListScope } from "../middleware/roles.js";
import * as db from "../dynamodb.js";
import * as AuditLog from "../models/audit-log.js";
import * as Invoice from "../models/invoice.js";
import * as PurchaseInvoice from "../models/purchase-invoice.js";
import * as CDNote from "../models/credit-debit-note.js";
import * as Debtor from "../models/debtor.js";
import * as Vendor from "../models/vendor.js";
import * as Supplier from "../models/supplier.js";
import * as BulkPayment from "../models/bulk-payment.js";

const router = Router();

// All bulk-payment routes require authentication
router.use(authMiddleware);

/** Treasury or platform-admin only — mirrors POST /invoices/:id/payment. */
function requireBulkPayWrite(req: Request, res: Response, next: () => void) {
  const roles: string[] = (req as any).user?.roles || [];
  if (!roles.includes("factor_admin") && !roles.includes("super_admin") && !roles.includes("treasury")) {
    return res.status(403).json({ error: "Only treasury/admin can process bulk payments" });
  }
  next();
}

/** Audit helper — fire-and-forget */
function trackBulkPayAction(req: Request, action: string, target: string | null, detail?: Record<string, unknown>) {
  const actor = (req as any).user;
  void AuditLog.writeWorkflowAction(
    { userId: actor?.userId, email: actor?.email, roles: actor?.roles },
    action,
    target,
    detail,
    { ip: req.ip, userAgent: req.headers["user-agent"] },
  );
}

function fmtINR(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(n) || 0);
}

// Sales (AR) invoices that bulk payments may touch — mirrors the funding queue.
const AR_ELIGIBLE = new Set(["approved", "funded", "advanced", "overdue", "partially_paid"]);
// Purchase (AP) invoices that bulk payments may touch — mirrors the funding queue.
const AP_ELIGIBLE = new Set(["approved_for_payment", "partially_paid", "approved", "funded", "advanced", "overdue"]);

// ── Helpers ──

function computeLateDays(dueDate: string | null, closeDate: string): number {
  if (!dueDate) return 0;
  return Math.max(0, Math.round((new Date(closeDate).getTime() - new Date(dueDate).getTime()) / 86400000));
}

function outstandingPurchase(inv: { amount: number; amountPaid: number | null }): number {
  return inv.amountPaid != null ? Math.max(0, Number(inv.amount) - Number(inv.amountPaid)) : Number(inv.amount);
}

async function closeSalesInvoice(inv: Invoice.Invoice, closeDate: string) {
  const balance = Invoice.balanceOutstanding(inv);
  const lateDays = computeLateDays(inv.dueDate, closeDate);
  return Invoice.update(inv.id, {
    status: "paid",
    amountReceived: (Number(inv.amountReceived) || 0) + balance,
    paidDate: closeDate,
    receiptDate: closeDate,
    lateDays,
  });
}

async function partiallyPaySalesInvoice(inv: Invoice.Invoice, amount: number) {
  return Invoice.update(inv.id, {
    status: "partially_paid",
    amountReceived: (Number(inv.amountReceived) || 0) + amount,
  });
}

async function closePurchaseInvoice(inv: PurchaseInvoice.PurchaseInvoice, closeDate: string) {
  const balance = outstandingPurchase(inv);
  return PurchaseInvoice.update(inv.id, {
    status: "paid",
    amountPaid: (Number(inv.amountPaid) || 0) + balance,
    paidDate: closeDate,
  });
}

async function partiallyPayPurchaseInvoice(inv: PurchaseInvoice.PurchaseInvoice, amount: number) {
  // The model derives partially_paid status + balanceDue from amountPaid.
  return PurchaseInvoice.update(inv.id, { amountPaid: (Number(inv.amountPaid) || 0) + amount });
}

async function settleCreditNote(noteId: string): Promise<{ ok: boolean; error?: string }> {
  const note = await CDNote.get(noteId);
  if (!note) return { ok: false, error: "Credit note not found" };
  if (note.kind !== "credit") return { ok: false, error: "Only credit notes can be settled as credit" };
  if (note.status !== "approved") return { ok: false, error: `Credit note status is "${note.status}", must be approved` };
  await CDNote.update(noteId, { status: "applied" });
  return { ok: true };
}

type Closed = { id: string; invoiceNumber: string; amount: number; latePaymentDays: number };
type Partial = { id: string; invoiceNumber: string; amountPaid: number; remaining: number };
type Skipped = { id: string; invoiceNumber: string; reason: string };

// ── POST /bulk-payments/process (AR) ──
const processSchema = z.object({
  debtorId: z.string().min(1),
  paymentDate: z.string().min(1),
  amount: z.number().positive(),
  useBalance: z.boolean().optional().default(false),
  mode: z.enum(["manual", "fifo", "two_pass_fifo"]),
  selectedInvoiceIds: z.array(z.string()).optional().default([]),
  settleCreditNoteIds: z.array(z.string()).optional().default([]),
});

router.post("/bulk-payments/process", requireBulkPayWrite, async (req: Request, res: Response) => {
  try {
    const parsed = processSchema.parse(req.body);
    const scope = effectiveListScope(req);

    // ── 1. Available amount (fresh cash + carried-forward leftovers) ──
    let availableAmount = parsed.amount;
    const consumedOld: BulkPayment.BulkPayment[] = [];
    if (parsed.useBalance) {
      const prev = (await BulkPayment.list(scope)).filter(
        (p) => p.debtorId === parsed.debtorId && Number(p.remaining) > 0,
      );
      consumedOld.push(...prev);
      availableAmount += prev.reduce((s, p) => s + Number(p.remaining), 0);
    }

    // ── 2. Open invoices for this debtor, oldest due first ──
    const openInvoices = (await Invoice.list(scope))
      .filter((i) => i.debtorId === parsed.debtorId && AR_ELIGIBLE.has(i.status))
      .sort((a, b) => (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31"));

    // ── 3. Allocate by mode (strict FIFO never partially pays) ──
    const closed: Closed[] = [];
    const partiallyPaid: Partial[] = [];
    const skipped: Skipped[] = [];
    let remaining = availableAmount;

    const fullClose = async (inv: Invoice.Invoice, closeDate: string) => {
      const balance = Invoice.balanceOutstanding(inv);
      await closeSalesInvoice(inv, closeDate);
      closed.push({ id: inv.id, invoiceNumber: inv.invoiceNumber, amount: balance, latePaymentDays: computeLateDays(inv.dueDate, closeDate) });
      remaining -= balance;
    };

    if (parsed.mode === "manual") {
      const selected = openInvoices.filter((inv) => parsed.selectedInvoiceIds.includes(inv.id));
      for (const inv of selected) {
        if (remaining <= 0) break;
        const balance = Invoice.balanceOutstanding(inv);
        if (remaining >= balance) {
          await fullClose(inv, parsed.paymentDate);
        } else {
          await partiallyPaySalesInvoice(inv, remaining);
          partiallyPaid.push({ id: inv.id, invoiceNumber: inv.invoiceNumber, amountPaid: remaining, remaining: balance - remaining });
          remaining = 0;
        }
      }
      for (const inv of openInvoices) {
        if (!parsed.selectedInvoiceIds.includes(inv.id)) {
          skipped.push({ id: inv.id, invoiceNumber: inv.invoiceNumber, reason: "Not selected" });
        }
      }
    } else {
      const passes =
        parsed.mode === "two_pass_fifo"
          ? [
              openInvoices.filter((inv) => inv.dueDate != null && inv.dueDate <= parsed.paymentDate),
              openInvoices.filter((inv) => inv.dueDate == null || inv.dueDate > parsed.paymentDate),
            ]
          : [openInvoices];
      for (let p = 0; p < passes.length; p++) {
        for (const inv of passes[p]) {
          if (remaining <= 0) break;
          const balance = Invoice.balanceOutstanding(inv);
          if (remaining >= balance) {
            // Future invoices pre-close on their due date → late days stay 0.
            const closeDate = parsed.mode === "two_pass_fifo" && p === 1 ? (inv.dueDate ?? parsed.paymentDate) : parsed.paymentDate;
            await fullClose(inv, closeDate);
          } else {
            skipped.push({
              id: inv.id,
              invoiceNumber: inv.invoiceNumber,
              reason: parsed.mode === "fifo" ? "Insufficient funds (FIFO strict)" : `Insufficient funds (Pass ${p + 1})`,
            });
          }
        }
      }
    }

    // ── 4. Settle credit notes ──
    const settledCredits: string[] = [];
    const creditErrors: Array<{ id: string; error: string }> = [];
    for (const noteId of parsed.settleCreditNoteIds) {
      const r = await settleCreditNote(noteId);
      if (r.ok) settledCredits.push(noteId);
      else creditErrors.push({ id: noteId, error: r.error ?? "Failed to settle" });
    }

    // ── 5. Persist the payment record + consume old leftovers ──
    const record = await BulkPayment.create({
      clientId: (req as any).user.userId,
      debtorId: parsed.debtorId,
      amount: parsed.amount,
      paymentDate: parsed.paymentDate,
      remaining,
      invoicesClosed: closed.length,
      closedInvoices: closed.map((c) => ({ id: c.id, invoiceNumber: c.invoiceNumber, amount: c.amount })),
      partialInvoices: partiallyPaid.map((p) => ({ id: p.id, invoiceNumber: p.invoiceNumber, amountPaid: p.amountPaid })),
      creditNoteIds: settledCredits,
      mode: parsed.mode,
    });
    for (const old of consumedOld) await BulkPayment.consumeRemaining(old.id);

    trackBulkPayAction(req, "bulk_payment.processed", record.id, {
      partyKind: "debtor",
      partyId: parsed.debtorId,
      closed: closed.length,
      partial: partiallyPaid.length,
      remaining,
    });
    res.status(201).json({
      paymentId: record.id,
      amount: parsed.amount,
      remaining,
      closed,
      partiallyPaid,
      skipped,
      settledCredits,
      creditErrors,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(400).json({ error: err.message });
  }
});

// ── POST /bulk-payments/process-purchase (AP) ──
const processPurchaseSchema = z.object({
  vendorId: z.string().min(1),
  paymentDate: z.string().min(1),
  amount: z.number().positive(),
  useBalance: z.boolean().optional().default(false),
  mode: z.enum(["manual", "fifo", "two_pass_fifo"]),
  selectedInvoiceIds: z.array(z.string()).optional().default([]),
  settleCreditNoteIds: z.array(z.string()).optional().default([]),
});

router.post("/bulk-payments/process-purchase", requireBulkPayWrite, async (req: Request, res: Response) => {
  try {
    const parsed = processPurchaseSchema.parse(req.body);
    const scope = effectiveListScope(req);

    const vendor = await Vendor.get(parsed.vendorId);
    if (!vendor) return res.status(404).json({ error: "Vendor not found" });
    if (scope && (vendor as any).clientId !== scope) return res.status(403).json({ error: "Forbidden" });

    const debtorKey = `vendor_${parsed.vendorId}`;
    let availableAmount = parsed.amount;
    const consumedOld: BulkPayment.BulkPayment[] = [];
    if (parsed.useBalance) {
      const prev = (await BulkPayment.list(scope)).filter((p) => p.debtorId === debtorKey && Number(p.remaining) > 0);
      consumedOld.push(...prev);
      availableAmount += prev.reduce((s, p) => s + Number(p.remaining), 0);
    }

    const openInvoices = (await PurchaseInvoice.list(scope))
      .filter((pi) => pi.vendorId === vendor.id && AP_ELIGIBLE.has(pi.status))
      .sort((a, b) => (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31"));

    const closed: Closed[] = [];
    const partiallyPaid: Partial[] = [];
    const skipped: Skipped[] = [];
    let remaining = availableAmount;

    const fullClose = async (inv: PurchaseInvoice.PurchaseInvoice, closeDate: string) => {
      const balance = outstandingPurchase(inv);
      await closePurchaseInvoice(inv, closeDate);
      closed.push({ id: inv.id, invoiceNumber: inv.invoiceNumber, amount: balance, latePaymentDays: computeLateDays(inv.dueDate, closeDate) });
      remaining -= balance;
    };

    if (parsed.mode === "manual") {
      const selected = openInvoices.filter((inv) => parsed.selectedInvoiceIds.includes(inv.id));
      for (const inv of selected) {
        if (remaining <= 0) break;
        const balance = outstandingPurchase(inv);
        if (remaining >= balance) {
          await fullClose(inv, parsed.paymentDate);
        } else {
          await partiallyPayPurchaseInvoice(inv, remaining);
          partiallyPaid.push({ id: inv.id, invoiceNumber: inv.invoiceNumber, amountPaid: remaining, remaining: balance - remaining });
          remaining = 0;
        }
      }
      for (const inv of openInvoices) {
        if (!parsed.selectedInvoiceIds.includes(inv.id)) {
          skipped.push({ id: inv.id, invoiceNumber: inv.invoiceNumber, reason: "Not selected" });
        }
      }
    } else {
      const passes =
        parsed.mode === "two_pass_fifo"
          ? [
              openInvoices.filter((inv) => inv.dueDate != null && inv.dueDate <= parsed.paymentDate),
              openInvoices.filter((inv) => inv.dueDate == null || inv.dueDate > parsed.paymentDate),
            ]
          : [openInvoices];
      for (let p = 0; p < passes.length; p++) {
        for (const inv of passes[p]) {
          if (remaining <= 0) break;
          const balance = outstandingPurchase(inv);
          if (remaining >= balance) {
            const closeDate = parsed.mode === "two_pass_fifo" && p === 1 ? (inv.dueDate ?? parsed.paymentDate) : parsed.paymentDate;
            await fullClose(inv, closeDate);
          } else {
            skipped.push({
              id: inv.id,
              invoiceNumber: inv.invoiceNumber,
              reason: parsed.mode === "fifo" ? "Insufficient funds (FIFO strict)" : `Insufficient funds (Pass ${p + 1})`,
            });
          }
        }
      }
    }

    const settledCredits: string[] = [];
    const creditErrors: Array<{ id: string; error: string }> = [];
    for (const noteId of parsed.settleCreditNoteIds) {
      const r = await settleCreditNote(noteId);
      if (r.ok) settledCredits.push(noteId);
      else creditErrors.push({ id: noteId, error: r.error ?? "Failed to settle" });
    }

    const record = await BulkPayment.create({
      clientId: (req as any).user.userId,
      debtorId: debtorKey,
      amount: parsed.amount,
      paymentDate: parsed.paymentDate,
      remaining,
      invoicesClosed: closed.length,
      closedInvoices: closed.map((c) => ({ id: c.id, invoiceNumber: c.invoiceNumber, amount: c.amount })),
      partialInvoices: partiallyPaid.map((p) => ({ id: p.id, invoiceNumber: p.invoiceNumber, amountPaid: p.amountPaid })),
      creditNoteIds: settledCredits,
      mode: parsed.mode,
    });
    for (const old of consumedOld) await BulkPayment.consumeRemaining(old.id);

    trackBulkPayAction(req, "bulk_payment.purchase_processed", record.id, {
      partyKind: "supplier",
      partyId: parsed.vendorId,
      closed: closed.length,
      partial: partiallyPaid.length,
      remaining,
    });
    res.status(201).json({
      paymentId: record.id,
      amount: parsed.amount,
      remaining,
      supplierName: (vendor as any).name ?? null,
      closed,
      partiallyPaid,
      skipped,
      settledCredits,
      creditErrors,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(400).json({ error: err.message });
  }
});

// ── GET /bulk-payments/balance/:debtorId ──
router.get("/bulk-payments/balance/:debtorId", async (req: Request, res: Response) => {
  try {
    const payments = (await BulkPayment.list(effectiveListScope(req))).filter(
      (p) => p.debtorId === req.params.debtorId && Number(p.remaining) > 0,
    );
    res.json({ totalRemaining: payments.reduce((s, p) => s + Number(p.remaining), 0), paymentCount: payments.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /bulk-payments/purchase-balance/:vendorId ──
router.get("/bulk-payments/purchase-balance/:vendorId", async (req: Request, res: Response) => {
  try {
    const key = `vendor_${req.params.vendorId}`;
    const payments = (await BulkPayment.list(effectiveListScope(req))).filter(
      (p) => p.debtorId === key && Number(p.remaining) > 0,
    );
    res.json({ totalRemaining: payments.reduce((s, p) => s + Number(p.remaining), 0), paymentCount: payments.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /bulk-payments/history ──
router.get("/bulk-payments/history", async (req: Request, res: Response) => {
  try {
    const scope = effectiveListScope(req);
    const debtorId = req.query.debtorId as string | undefined;
    let payments = await BulkPayment.list(scope);
    if (debtorId) payments = payments.filter((p) => p.debtorId === debtorId);
    payments.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

    const debtors = await Debtor.list();
    const debtorMap = new Map(debtors.map((d: any) => [d.id, d.name ?? d.companyName ?? "Unknown"]));
    const vendors = await Vendor.list(scope);
    const vendorMap = new Map(vendors.map((v: any) => [`vendor_${v.id}`, v.name ?? "Unknown"]));
    const suppliers = await Supplier.list();
    const supplierMap = new Map(suppliers.map((s: any) => [`supplier_${s.id}`, s.companyName ?? s.name ?? "Unknown"]));

    const enriched = payments.map((p) => ({
      ...p,
      debtorName: debtorMap.get(p.debtorId) ?? vendorMap.get(p.debtorId) ?? supplierMap.get(p.debtorId) ?? "Unknown",
    }));
    res.json({
      payments: enriched,
      totals: {
        totalPayments: enriched.length,
        totalAmount: enriched.reduce((s, p) => s + Number(p.amount), 0),
        totalRemaining: enriched.reduce((s, p) => s + Number(p.remaining), 0),
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /bulk-payments/reverse/:paymentId ──
router.post("/bulk-payments/reverse/:paymentId", requireBulkPayWrite, async (req: Request, res: Response) => {
  try {
    const payment = await BulkPayment.get(req.params.paymentId);
    if (!payment) return res.status(404).json({ error: "Payment record not found" });

    const isSupplierPayment = payment.debtorId.startsWith("supplier_") || payment.debtorId.startsWith("vendor_");
    const today = db.todayDate();
    const reversedInvoices: string[] = [];
    const reversalErrors: Array<{ id: string; error: string }> = [];
    const restoredCreditNotes: string[] = [];
    const creditNoteErrors: Array<{ id: string; error: string }> = [];

    const reverseOne = async (id: string, paidAmount: number): Promise<{ ok: boolean; error?: string }> => {
      if (isSupplierPayment) {
        const inv = await PurchaseInvoice.get(id);
        if (!inv) return { ok: false, error: "Purchase invoice not found" };
        const left = Math.max(0, (Number(inv.amountPaid) || 0) - paidAmount);
        if (left <= 0) {
          await PurchaseInvoice.update(id, { amountPaid: 0, status: "approved_for_payment", paidDate: null });
        } else {
          await PurchaseInvoice.update(id, { amountPaid: left });
        }
        return { ok: true };
      }
      const inv = await Invoice.get(id);
      if (!inv) return { ok: false, error: "Invoice not found" };
      const left = Math.max(0, (Number(inv.amountReceived) || 0) - paidAmount);
      if (left <= 0) {
        const overdue = inv.dueDate != null && inv.dueDate < today;
        await Invoice.update(id, {
          status: overdue ? "overdue" : "approved",
          amountReceived: null,
          paidDate: null,
          receiptDate: null,
          lateDays: null,
        });
      } else {
        await Invoice.update(id, { status: "partially_paid", amountReceived: left });
      }
      return { ok: true };
    };

    for (const ci of payment.closedInvoices ?? []) {
      const r = await reverseOne(ci.id, ci.amount);
      if (r.ok) reversedInvoices.push(ci.id);
      else reversalErrors.push({ id: ci.id, error: r.error ?? "Unknown error" });
    }
    for (const pi of payment.partialInvoices ?? []) {
      const r = await reverseOne(pi.id, pi.amountPaid);
      if (r.ok) reversedInvoices.push(pi.id);
      else reversalErrors.push({ id: pi.id, error: r.error ?? "Unknown error" });
    }
    for (const noteId of payment.creditNoteIds ?? []) {
      const note = await CDNote.get(noteId);
      if (!note) {
        creditNoteErrors.push({ id: noteId, error: "Credit note not found" });
        continue;
      }
      await CDNote.update(noteId, { status: "approved" });
      restoredCreditNotes.push(noteId);
    }

    await BulkPayment.remove(payment.id);
    trackBulkPayAction(req, "bulk_payment.reversed", payment.id, {
      reversed: reversedInvoices.length,
      restoredCredits: restoredCreditNotes.length,
    });
    res.json({
      success: true,
      paymentId: payment.id,
      reversedInvoices,
      reversalErrors,
      restoredCreditNotes,
      creditNoteErrors,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
export { fmtINR as fmtMoneyShort };
