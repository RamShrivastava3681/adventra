import { Router, Request, Response, NextFunction } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { requireAdmin, requireChecker } from "../middleware/roles.js";
import { requireRole } from "../middleware/roles.js";
import * as User from "../models/user.js";
import * as Submission from "../models/submission.js";

// ─── View-As middleware (for reporting managers to see their reports' data) ──
const viewAsMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const viewAsUserId = req.query.viewAsUserId as string | undefined;
  if (!viewAsUserId) return next();

  // Only for GET requests (read-only view)
  if (req.method !== "GET") return next();

  try {
    // Verify the requester is a reporting_manager
    if (!req.user?.roles?.includes("reporting_manager")) {
      return res.status(403).json({ error: "Only reporting managers can use view-as" });
    }

    // Verify the target user is managed by this reporting manager
    const target = await User.getViewAsTarget(req.user.userId, viewAsUserId);
    if (!target) {
      return res.status(403).json({ error: "You do not manage this user" });
    }

    // Store both the original and the viewed user ID
    req.originalUserId = req.user.userId;
    req.user = { ...req.user, userId: viewAsUserId };
    req.viewAsUserId = viewAsUserId;
    next();
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};
import * as Product from "../models/product.js";
import * as StockMovement from "../models/stock-movement.js";
import * as Debtor from "../models/debtor.js";
import * as Vendor from "../models/vendor.js";
import * as Supplier from "../models/supplier.js";
import * as Invoice from "../models/invoice.js";
import * as PurchaseInvoice from "../models/purchase-invoice.js";
import * as PurchaseOrder from "../models/purchase-order.js";
import * as Expense from "../models/expense.js";
import * as Advance from "../models/advance.js";
import * as Alert from "../models/alert.js";
import * as CoA from "../models/chart-of-account.js";
import * as Journal from "../models/journal.js";
import * as CDNote from "../models/credit-debit-note.js";
import * as Combined from "../models/models-combined.js";

const router = Router();

// Apply view-as middleware to all data routes
router.use(viewAsMiddleware);

// ===================== AUTH =====================
router.post("/auth/signup", (req, res) => User.signup(req, res));
router.post("/auth/login", (req, res) => User.login(req, res));
router.get("/auth/me", authMiddleware, (req, res) => User.getProfile(req, res));
router.put("/auth/profile", authMiddleware, (req, res) => User.updateProfile(req, res));

// ===================== ADMIN =====================
router.get("/admin/users", authMiddleware, requireAdmin, (req, res) => User.getUsers(req, res));
router.post("/admin/users/create", authMiddleware, requireAdmin, (req, res) => User.adminCreateUser(req, res));
router.put("/admin/users/role", authMiddleware, requireAdmin, (req, res) => User.updateUserRole(req, res));
router.get("/admin/users/managers", authMiddleware, requireAdmin, (req, res) => User.listManagers(req, res));
router.put("/admin/users/:userId/assign-manager", authMiddleware, requireAdmin, (req, res) => User.assignManager(req, res));
router.get("/admin/users/:managerId/reports", authMiddleware, requireAdmin, (req, res) => User.getReports(req, res));

// ===================== PRODUCTS =====================
router.get("/products", authMiddleware, async (req, res) => {
  try {
    const items = await Product.list(req.user!.userId);
    res.json(items);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.get("/products/:id", authMiddleware, async (req, res) => {
  try {
    const item = await Product.get(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });
    res.json(item);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.post("/products", authMiddleware, async (req, res) => {
  try {
    const item = await Product.create({ ...req.body, clientId: req.user!.userId });
    res.status(201).json(item);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.put("/products/:id", authMiddleware, async (req, res) => {
  try {
    const item = await Product.update(req.params.id, req.body);
    res.json(item);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.delete("/products/:id", authMiddleware, async (req, res) => {
  try {
    await Product.remove(req.params.id);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===================== STOCK MOVEMENTS =====================
router.get("/stock-movements", authMiddleware, async (req, res) => {
  try {
    const { productId } = req.query;
    const items = await StockMovement.list(req.user!.userId);
    const result = productId ? items.filter((m) => m.productId === productId) : items;
    res.json(result);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.post("/stock-movements", authMiddleware, async (req, res) => {
  try {
    const item = await StockMovement.create({ ...req.body, clientId: req.user!.userId });
    res.status(201).json(item);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.delete("/stock-movements/:id", authMiddleware, async (req, res) => {
  try {
    await StockMovement.remove(req.params.id);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===================== DEBTORS =====================
router.get("/debtors", authMiddleware, async (req, res) => {
  try { res.json(await Debtor.list()); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.get("/debtors/:id", authMiddleware, async (req, res) => {
  try {
    const item = await Debtor.get(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });
    res.json(item);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.post("/debtors", authMiddleware, async (req, res) => {
  try { res.status(201).json(await Debtor.create(req.body)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.put("/debtors/:id", authMiddleware, async (req, res) => {
  try { res.json(await Debtor.update(req.params.id, req.body)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.delete("/debtors/:id", authMiddleware, async (req, res) => {
  try { await Debtor.remove(req.params.id); res.json({ success: true }); } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===================== VENDORS =====================
router.get("/vendors", authMiddleware, async (req, res) => {
  try { res.json(await Vendor.list(req.user!.userId)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.post("/vendors", authMiddleware, async (req, res) => {
  try { res.status(201).json(await Vendor.create({ ...req.body, clientId: req.user!.userId })); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.put("/vendors/:id", authMiddleware, async (req, res) => {
  try { res.json(await Vendor.update(req.params.id, req.body)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.delete("/vendors/:id", authMiddleware, async (req, res) => {
  try { await Vendor.remove(req.params.id); res.json({ success: true }); } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===================== SUPPLIERS =====================
router.get("/suppliers", authMiddleware, async (req, res) => {
  try { res.json(await Supplier.list()); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.post("/suppliers", authMiddleware, async (req, res) => {
  try { res.status(201).json(await Supplier.create(req.body)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.put("/suppliers/:id", authMiddleware, async (req, res) => {
  try { res.json(await Supplier.update(req.params.id, req.body)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.delete("/suppliers/:id", authMiddleware, async (req, res) => {
  try { await Supplier.remove(req.params.id); res.json({ success: true }); } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===================== INVOICES (Sales) =====================

// Public token-authenticated endpoint: send reminder to debtor (clicked from admin email)
router.get("/invoices/:id/remind-debtor/:token", async (req, res) => {
  try {
    const { sendReminderToDebtor } = await import("../invoice-reminder.js");
    const result = await sendReminderToDebtor(req.params.id, req.params.token);
    if (result.success) {
      res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Reminder Sent</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f5f7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:16px;} .card{background:#fff;border-radius:12px;padding:32px;max-width:480px;box-shadow:0 1px 3px rgba(0,0,0,0.08);text-align:center;} h1{font-size:20px;color:#059669;margin:0 0 8px;} p{font-size:14px;color:#64748b;margin:0 0 4px;line-height:1.5;} .emoji{font-size:48px;margin-bottom:12px;}</style></head><body><div class="card"><div class="emoji">✅</div><h1>Reminder Forwarded!</h1><p>${result.message}</p></div></body></html>`);
    } else {
      res.status(400).send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f5f7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:16px;} .card{background:#fff;border-radius:12px;padding:32px;max-width:480px;box-shadow:0 1px 3px rgba(0,0,0,0.08);text-align:center;} h1{font-size:20px;color:#dc2626;margin:0 0 8px;} p{font-size:14px;color:#64748b;margin:0 0 4px;line-height:1.5;} .emoji{font-size:48px;margin-bottom:12px;}</style></head><body><div class="card"><div class="emoji">❌</div><h1>Could Not Send Reminder</h1><p>${result.message}</p></div></body></html>`);
    }
  } catch (err: any) {
    res.status(500).send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error</title></head><body><h1>Error</h1><p>${err.message}</p></body></html>`);
  }
});

router.get("/invoices", authMiddleware, async (req, res) => {
  try { res.json(await Invoice.list(req.user!.userId)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.get("/invoices/:id", authMiddleware, async (req, res) => {
  try {
    const item = await Invoice.get(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });
    res.json(item);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.post("/invoices", authMiddleware, async (req, res) => {
  try {
    const item = await Invoice.create({ ...req.body, clientId: req.user!.userId });
    // Auto-create stock movement for inventory items
    if (req.body.createStockMovement && req.body.lineItems?.length) {
      for (const li of req.body.lineItems) {
        if (li.productId) {
          await StockMovement.create({
            clientId: req.user!.userId,
            productId: li.productId,
            direction: "out",
            itemName: li.description || "Invoice item",
            quantity: li.quantity || 1,
            unit: "unit",
            unitCost: li.unitCost || 0,
            movementDate: req.body.issueDate,
            invoiceId: item.id,
          });
        }
      }
    }
    // Instant reminder check: if due date is close or past, send reminder immediately
    if (item.dueDate && item.status !== "paid" && item.status !== "rejected") {
      const { sendReminderForInvoice } = await import("../invoice-reminder.js");
      // Fire-and-forget — don't block the response
      sendReminderForInvoice(item.id, "sales").catch((err: any) =>
        console.error(`  ⚠ Instant reminder trigger failed for ${item.invoiceNumber}:`, err)
      );
    }
    res.status(201).json(item);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.put("/invoices/:id", authMiddleware, async (req, res) => {
  try {
    if (req.body.status && ["approved","rejected","disputed"].includes(req.body.status)) {
      // Checker-only action
      const userRoles = req.user!.roles;
      if (!userRoles.includes("factor_admin") && !userRoles.includes("checker")) {
        return res.status(403).json({ error: "Only checker/admin can approve/reject" });
      }
    }
    const updated = await Invoice.update(req.params.id, req.body);
    // Instant reminder check on update (e.g., status changed to approved)
    if (req.body.dueDate || req.body.status) {
      const inv = await Invoice.get(req.params.id);
      if (inv && inv.dueDate && inv.status !== "paid" && inv.status !== "rejected") {
        const { sendReminderForInvoice } = await import("../invoice-reminder.js");
        sendReminderForInvoice(inv.id, "sales").catch((err: any) =>
          console.error(`  ⚠ Instant reminder trigger failed for ${inv.invoiceNumber}:`, err)
        );
      }
    }
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.delete("/invoices/:id", authMiddleware, async (req, res) => {
  try { await Invoice.remove(req.params.id); res.json({ success: true }); } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===================== PURCHASE INVOICES =====================
router.get("/purchase-invoices", authMiddleware, async (req, res) => {
  try { res.json(await PurchaseInvoice.list(req.user!.userId)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.post("/purchase-invoices", authMiddleware, async (req, res) => {
  try {
    const item = await PurchaseInvoice.create({ ...req.body, clientId: req.user!.userId });
    // Instant reminder check for purchase invoices too
    if (item.dueDate && item.status !== "paid" && item.status !== "rejected") {
      const { sendReminderForInvoice } = await import("../invoice-reminder.js");
      sendReminderForInvoice(item.id, "purchase").catch((err: any) =>
        console.error(`  ⚠ Instant reminder trigger failed for purchase ${item.invoiceNumber}:`, err)
      );
    }
    res.status(201).json(item);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.put("/purchase-invoices/:id", authMiddleware, async (req, res) => {
  try {
    const updated = await PurchaseInvoice.update(req.params.id, req.body);
    // Instant reminder check on update
    if (req.body.dueDate || req.body.status) {
      const { get } = await import("../models/purchase-invoice.js");
      const inv = await get(req.params.id);
      if (inv && inv.dueDate && inv.status !== "paid" && inv.status !== "rejected") {
        const { sendReminderForInvoice } = await import("../invoice-reminder.js");
        sendReminderForInvoice(inv.id, "purchase").catch((err: any) =>
          console.error(`  ⚠ Instant reminder trigger failed for purchase ${inv.invoiceNumber}:`, err)
        );
      }
    }
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.delete("/purchase-invoices/:id", authMiddleware, async (req, res) => {
  try { await PurchaseInvoice.remove(req.params.id); res.json({ success: true }); } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===================== PURCHASE ORDERS (Proformas) =====================
router.get("/purchase-orders", authMiddleware, async (req, res) => {
  try { res.json(await PurchaseOrder.list(req.user!.userId)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.post("/purchase-orders", authMiddleware, async (req, res) => {
  try {
    const item = await PurchaseOrder.create({ ...req.body, clientId: req.user!.userId });
    res.status(201).json(item);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.put("/purchase-orders/:id", authMiddleware, async (req, res) => {
  try { res.json(await PurchaseOrder.update(req.params.id, req.body)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.delete("/purchase-orders/:id", authMiddleware, async (req, res) => {
  try { await PurchaseOrder.remove(req.params.id); res.json({ success: true }); } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===================== EXPENSES =====================
router.get("/expenses", authMiddleware, async (req, res) => {
  try { res.json(await Expense.list(req.user!.userId)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.post("/expenses", authMiddleware, async (req, res) => {
  try { res.status(201).json(await Expense.create({ ...req.body, clientId: req.user!.userId })); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.put("/expenses/:id", authMiddleware, async (req, res) => {
  try { res.json(await Expense.update(req.params.id, req.body)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.delete("/expenses/:id", authMiddleware, async (req, res) => {
  try { await Expense.remove(req.params.id); res.json({ success: true }); } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===================== ADVANCES =====================
router.get("/advances", authMiddleware, async (req, res) => {
  try { res.json(await Advance.list(req.user!.userId)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.post("/advances", authMiddleware, async (req, res) => {
  try { res.status(201).json(await Advance.create({ ...req.body, clientId: req.user!.userId })); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.put("/advances/:id", authMiddleware, async (req, res) => {
  try { res.json(await Advance.update(req.params.id, req.body)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.delete("/advances/:id", authMiddleware, async (req, res) => {
  try { await Advance.remove(req.params.id); res.json({ success: true }); } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===================== ALERTS =====================
router.get("/alerts", authMiddleware, async (req, res) => {
  try { res.json(await Alert.list()); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.put("/alerts/:id/read", authMiddleware, async (req, res) => {
  try { res.json(await Alert.markRead(req.params.id)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.post("/alerts/generate", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const invoices = await Invoice.list();
    const debtors = await Debtor.list();
    const alerts: Array<{ message: string; type: string }> = [];
    for (const inv of invoices) {
      if (!inv.dueDate) continue;
      const dpd = Math.max(0, Math.floor((Date.now() - new Date(inv.dueDate).getTime()) / 86400000));
      if (dpd > 0 && inv.status !== "paid" && inv.status !== "rejected") {
        alerts.push({ message: `Invoice ${inv.invoiceNumber} overdue ${dpd} days — $${inv.amount}`, type: "overdue" });
      }
    }
    for (const d of debtors) {
      const exposure = invoices.filter((i) => i.debtorId === d.id && i.status !== "paid" && i.status !== "rejected")
        .reduce((s, i) => s + i.amount, 0);
      const util = d.creditLimit > 0 ? exposure / d.creditLimit : 0;
      if (util > 0.85) {
        alerts.push({ message: `${d.name} at ${(util * 100).toFixed(0)}% of credit limit`, type: "credit_limit" });
      }
    }
    for (const a of alerts) await Alert.create(a);
    res.json({ generated: alerts.length });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===================== CHART OF ACCOUNTS =====================
router.get("/chart-of-accounts", authMiddleware, async (req, res) => {
  try { res.json(await CoA.list(req.user!.userId)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.post("/chart-of-accounts", authMiddleware, async (req, res) => {
  try { res.status(201).json(await CoA.create({ ...req.body, clientId: req.user!.userId })); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.put("/chart-of-accounts/:id", authMiddleware, async (req, res) => {
  try { res.json(await CoA.update(req.params.id, req.body)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.delete("/chart-of-accounts/:id", authMiddleware, async (req, res) => {
  try {
    const item = await CoA.get(req.params.id);
    await CoA.remove(req.params.id, item?.isSystem);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.post("/chart-of-accounts/seed", authMiddleware, async (req, res) => {
  try {
    await CoA.seedDefault(req.user!.userId);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===================== JOURNALS =====================
router.get("/journals", authMiddleware, async (req, res) => {
  try { res.json(await Journal.listJournals(req.user!.userId)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.get("/journals/:id", authMiddleware, async (req, res) => {
  try {
    const journal = await Journal.getJournal(req.params.id);
    if (!journal) return res.status(404).json({ error: "Not found" });
    const lines = await Journal.getLinesByJournal(req.params.id);
    res.json({ ...journal, lines });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.post("/journals", authMiddleware, async (req, res) => {
  try {
    const { lines, ...journalData } = req.body;
    const journal = await Journal.createJournal({ ...journalData, clientId: req.user!.userId });
    if (lines?.length) {
      await Journal.createLines(
        lines.map((l: any, i: number) => ({ ...l, journalId: journal.id, lineNo: i + 1 }))
      );
    }
    res.status(201).json(journal);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.delete("/journals/:id", authMiddleware, async (req, res) => {
  try {
    const journal = await Journal.getJournal(req.params.id);
    await Journal.deleteJournal(req.params.id, journal?.source);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===================== ACCOUNT TRANSACTIONS =====================
router.get("/account-transactions/:accountId", authMiddleware, async (req, res) => {
  try {
    const { lines, journals } = await Journal.getAccountTransactions(req.params.accountId);
    res.json({ lines, journals });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===================== CREDIT/DEBIT NOTES =====================
router.get("/credit-debit-notes", authMiddleware, async (req, res) => {
  try { res.json(await CDNote.list(req.user!.userId)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.post("/credit-debit-notes", authMiddleware, async (req, res) => {
  try { res.status(201).json(await CDNote.create({ ...req.body, clientId: req.user!.userId })); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.put("/credit-debit-notes/:id", authMiddleware, async (req, res) => {
  try { res.json(await CDNote.update(req.params.id, req.body)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.delete("/credit-debit-notes/:id", authMiddleware, async (req, res) => {
  try { await CDNote.remove(req.params.id); res.json({ success: true }); } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===================== MANUAL BALANCE ENTRIES =====================
router.get("/balance-entries", authMiddleware, async (req, res) => {
  try { res.json(await Combined.listManualEntries(req.user!.userId)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.post("/balance-entries", authMiddleware, async (req, res) => {
  try { res.status(201).json(await Combined.createManualEntry({ ...req.body, clientId: req.user!.userId })); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.put("/balance-entries/:id", authMiddleware, async (req, res) => {
  try { res.json(await Combined.updateManualEntry(req.params.id, req.body)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.delete("/balance-entries/:id", authMiddleware, async (req, res) => {
  try { await Combined.deleteManualEntry(req.params.id); res.json({ success: true }); } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===================== INVOICE TEMPLATES =====================
router.get("/invoice-templates", authMiddleware, async (req, res) => {
  try {
    const template = await Combined.getTemplate(req.user!.userId);
    res.json(template);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.put("/invoice-templates", authMiddleware, async (req, res) => {
  try { res.json(await Combined.upsertTemplate({ ...req.body, clientId: req.user!.userId })); } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===================== LEADS (CRM) =====================
router.get("/crm/leads", authMiddleware, async (req, res) => {
  try { res.json(await Combined.listLeads(req.user!.userId)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.post("/crm/leads", authMiddleware, async (req, res) => {
  try { res.status(201).json(await Combined.createLead({ ...req.body, clientId: req.user!.userId })); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.put("/crm/leads/:id", authMiddleware, async (req, res) => {
  try { res.json(await Combined.updateLead(req.params.id, req.body)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.delete("/crm/leads/:id", authMiddleware, async (req, res) => {
  try { await Combined.deleteLead(req.params.id); res.json({ success: true }); } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===================== OPPORTUNITIES (CRM) =====================
router.get("/crm/opportunities", authMiddleware, async (req, res) => {
  try { res.json(await Combined.listOpportunities(req.user!.userId)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.post("/crm/opportunities", authMiddleware, async (req, res) => {
  try { res.status(201).json(await Combined.createOpportunity({ ...req.body, clientId: req.user!.userId })); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.put("/crm/opportunities/:id", authMiddleware, async (req, res) => {
  try { res.json(await Combined.updateOpportunity(req.params.id, req.body)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.delete("/crm/opportunities/:id", authMiddleware, async (req, res) => {
  try { await Combined.deleteOpportunity(req.params.id); res.json({ success: true }); } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===================== CRM ACTIVITIES =====================
router.get("/crm/activities", authMiddleware, async (req, res) => {
  try { res.json(await Combined.listActivities(req.user!.userId)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.post("/crm/activities", authMiddleware, async (req, res) => {
  try { res.status(201).json(await Combined.createActivity({ ...req.body, clientId: req.user!.userId })); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.put("/crm/activities/:id", authMiddleware, async (req, res) => {
  try { res.json(await Combined.updateActivity(req.params.id, req.body)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.delete("/crm/activities/:id", authMiddleware, async (req, res) => {
  try { await Combined.deleteActivity(req.params.id); res.json({ success: true }); } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===================== REMINDER LOGS & MANUAL REMINDERS =====================
router.get("/reminder-logs", authMiddleware, async (req, res) => {
  try {
    const { list } = await import("../models/reminder-log.js");
    const logs = await list();
    // Sort newest first
    logs.sort((a, b) => b.sentAt.localeCompare(a.sentAt));
    res.json(logs);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Manually send a reminder for a specific sales invoice
router.post("/invoices/:id/send-reminder", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { sendReminderForInvoice } = await import("../invoice-reminder.js");
    const result = await sendReminderForInvoice(req.params.id, "sales");
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Manually send a reminder for a specific purchase invoice
router.post("/purchase-invoices/:id/send-reminder", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { sendReminderForInvoice } = await import("../invoice-reminder.js");
    const result = await sendReminderForInvoice(req.params.id, "purchase");
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Manually trigger the full reminder scheduler
router.post("/reminders/run", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { runDueDateReminders } = await import("../invoice-reminder.js");
    const result = await runDueDateReminders();
    res.json(result);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===================== FORECAST (reuses engine) =====================
router.get("/forecast", authMiddleware, async (req, res) => {
  try {
    const products = await Product.list(req.user!.userId);
    const movements = await StockMovement.list(req.user!.userId);
    res.json({ products, movements });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===================== DASHBOARD =====================
router.get("/dashboard", authMiddleware, async (req, res) => {
  try {
    const invoices = await Invoice.list(req.user!.userId);
    const advances = await Advance.list(req.user!.userId);
    const debtors = await Debtor.list();
    const products = await Product.list(req.user!.userId);
    const movements = await StockMovement.list(req.user!.userId);
    
    // Calculate summary
    const pendingInvoices = invoices.filter((i) => i.status === "pending");
    const approvedInvoices = invoices.filter((i) => i.status === "approved");
    const overdueInvoices = invoices.filter((i) => i.status === "overdue");
    const totalSalesAdvance = advances.filter((a) => a.side === "sales" && a.status !== "refunded").reduce((s, a) => s + a.amount, 0);
    const totalPurchaseAdvance = advances.filter((a) => a.side === "purchase" && a.status !== "refunded").reduce((s, a) => s + a.amount, 0);
    const inventoryValue = movements
      .filter((m) => m.direction === "in")
      .reduce((s, m) => s + (m.quantity * (m.unitCost || 0)), 0);
    
    res.json({ pendingInvoices: pendingInvoices.length, approvedInvoices: approvedInvoices.length, overdueInvoices: overdueInvoices.length, totalSalesAdvance, totalPurchaseAdvance, inventoryValue, invoices, advances, debtors, products });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===================== SUBMISSIONS (Visits, Travel, Expenses, Leave) =====================
router.post("/submissions", authMiddleware, (req, res) => Submission.create(req, res));
router.get("/submissions", authMiddleware, (req, res) => Submission.list(req, res));
router.put("/submissions/:id", authMiddleware, (req, res) => Submission.update(req, res));
router.delete("/submissions/:id", authMiddleware, (req, res) => Submission.remove(req, res));

// Reporting Manager: team requests
router.get("/requests", authMiddleware, (req, res) => Submission.listTeamRequests(req, res));
router.put("/requests/:id/status", authMiddleware, (req, res) => Submission.updateRequestStatus(req, res));

// ===================== NOA (Notification of Assignment) =====================
router.get("/noa/:token", async (req, res) => {
  try {
    const invoice = await Invoice.getByNOAToken(req.params.token);
    if (!invoice) return res.status(404).json({ error: "Not found" });
    const debtor = await Debtor.get(invoice.debtorId);
    res.json({ invoice, debtor });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/noa/:token/respond", async (req, res) => {
  try {
    const { decision, comments } = req.body;
    const invoice = await Invoice.getByNOAToken(req.params.token);
    if (!invoice) return res.status(404).json({ error: "Not found" });
    const updates: any = { noaStatus: decision, noaRespondedAt: new Date().toISOString() };
    if (comments) updates.noaComments = comments;
    await Invoice.update(invoice.id, updates);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===================== FILE UPLOAD (S3) =====================
router.post("/upload-url", authMiddleware, async (req, res) => {
  try {
    const { key, contentType } = req.body;
    const { uploadFile } = await import("../s3.js");
    // Note: For direct upload, use presigned POST. For now, accept base64 or buffer.
    res.json({ message: "Upload endpoint ready. Use S3 presigned URLs for direct browser uploads." });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
