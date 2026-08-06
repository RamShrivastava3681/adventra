import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { authMiddleware, AuthPayload } from "../middleware/auth.js";
import { requireAdmin, requireChecker } from "../middleware/roles.js";
import { requireRole } from "../middleware/roles.js";
import * as User from "../models/user.js";
import * as Submission from "../models/submission.js";

// ─── View-As middleware (for reporting managers to see their reports' data) ──
// NOTE: this runs via router.use() BEFORE the per-route authMiddleware, so it
// decodes the JWT itself to learn who is making the request.
const viewAsMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const viewAsUserId = req.query.viewAsUserId as string | undefined;
  if (!viewAsUserId) return next();

  // Only for GET requests (read-only view)
  if (req.method !== "GET") return next();

  // Never impersonate auth endpoints — /auth/me must always return the real
  // signed-in user (keeps the frontend auth context intact after a refresh).
  if (req.path.startsWith("/auth/")) return next();

  try {
    // Resolve the requester identity (authMiddleware hasn't run yet at this stage)
    if (!req.user) {
      const header = req.headers.authorization || "";
      if (!header.startsWith("Bearer ")) {
        return res.status(401).json({ error: "No token provided" });
      }
      try {
        const payload = jwt.verify(header.replace("Bearer ", ""), config.jwt.secret) as AuthPayload;
        req.user = { userId: payload.userId, email: payload.email, roles: payload.roles || [] };
      } catch {
        return res.status(401).json({ error: "Invalid or expired token" });
      }
    }

    // Verify the requester is a reporting_manager
    if (!req.user.roles?.includes("reporting_manager")) {
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
import * as CatalogueSettings from "../models/catalogue-settings.js";
import * as StockMovement from "../models/stock-movement.js";
import * as Debtor from "../models/debtor.js";
import * as Vendor from "../models/vendor.js";
import * as Supplier from "../models/supplier.js";
import * as Invoice from "../models/invoice.js";
import * as PurchaseInvoice from "../models/purchase-invoice.js";
import * as PurchaseOrder from "../models/purchase-order.js";
import * as GoodsPO from "../models/goods-purchase-order.js";
import * as GoodsReceipt from "../models/goods-receipt.js";
import * as Expense from "../models/expense.js";
import * as Advance from "../models/advance.js";
import * as Alert from "../models/alert.js";
import * as CoA from "../models/chart-of-account.js";
import * as Journal from "../models/journal.js";
import * as CDNote from "../models/credit-debit-note.js";
import * as Combined from "../models/models-combined.js";
import * as db from "../dynamodb.js";

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
router.get("/admin/users/:managerId/reports", authMiddleware, (req, res, next) => {
  // Allow admins OR the reporting manager themself to fetch reports
  if (req.user?.roles?.includes("factor_admin") || req.user?.userId === req.params.managerId) {
    return next();
  }
  return res.status(403).json({ error: "Access denied. Only admins and the reporting manager themselves can view reports." });
}, (req, res) => User.getReports(req, res));

// ===================== USER PROFILES (view-as support) =====================
// Public profile of a user — only the user themself, admins, or their reporting
// manager may fetch it. Used by the frontend to render a team member's own
// sidebar/tabs while a reporting manager is in view-as mode.
router.get("/users/:id", authMiddleware, async (req, res) => {
  try {
    const targetId = req.params.id;
    const requesterId = req.originalUserId ?? req.user!.userId;
    const requesterRoles: string[] = req.user!.roles || [];

    const isAdmin = requesterRoles.includes("factor_admin");
    const isSelf = requesterId === targetId;
    if (!isSelf && !isAdmin) {
      const managed = await User.getViewAsTarget(requesterId, targetId);
      if (!managed) {
        return res.status(403).json({ error: "Access denied" });
      }
    }

    const item = await db.getItem(`USER#${targetId}`);
    if (!item) return res.status(404).json({ error: "User not found" });
    const { passwordHash, ...safe } = item as any;
    return res.json(safe);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

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

// ===================== CATALOGUE SETTINGS =====================
router.get("/catalogue-settings", authMiddleware, async (req, res) => {
  try {
    const settings = await CatalogueSettings.get(req.user!.userId);
    res.json(settings);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.put("/catalogue-settings", authMiddleware, async (req, res) => {
  try {
    const raw = req.body.defaultMinimumMargin;
    const margin = Number(raw);
    // Expect a decimal in (0.01, 0.99), e.g. 0.40 for 40%. Reject a raw percent
    // like 40 (would silently clamp into a 99% margin floor if we allowed it).
    if (!Number.isFinite(margin) || margin < 0.01 || margin > 0.99) {
      return res.status(400).json({ error: "defaultMinimumMargin must be a decimal between 0.01 and 0.99 (e.g. 0.40 for 40%)" });
    }
    const settings = await CatalogueSettings.update(req.user!.userId, { defaultMinimumMargin: margin });

    // Products created before the catalogue default existed carry the old
    // hardcoded 0.4 (or null). Treat that as "not customized" and clear it so
    // every item without its own margin now inherits the new catalogue default.
    // Items with a genuinely different per-item margin keep their override.
    const products = await Product.list(req.user!.userId);
    for (const p of products) {
      const m = (p as any).minimumGrossMarginPercentage;
      if (m !== null && m !== undefined && m !== 0.4) continue;
      await Product.update(p.id, { minimumGrossMarginPercentage: null });
    }

    res.json(settings);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===================== STOCK MOVEMENTS =====================
// Movement reasons that may be chosen on a MANUAL entry. Goods receipt and
// Dispatch are system-only (created by confirmed GRNs / dispatched invoices).
const MANUAL_MOVEMENT_REASONS = [
  "Opening stock",
  "Stock adjustment",
  "Damage",
  "Samples / internal use",
  "Customer return",
  "Supplier return",
];

router.get("/stock-movements", authMiddleware, async (req, res) => {
  try {
    const { productId } = req.query;
    const items = await StockMovement.list(req.user!.userId);
    const result = productId ? items.filter((m) => m.productId === productId) : items;
    res.json(result);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /stock-movements — create a movement.
 * System flows are identified by their source-document link (invoiceId /
 * goodsReceiptId / purchaseInvoiceId) and get server-side attribution.
 * EVERYTHING else is a manual entry and is validated strictly regardless of
 * status: a catalogue product must be selected (SKU / name / unit are taken
 * from the product, never typed), a movement reason from the manual set is
 * required, and notes are mandatory.
 */
router.post("/stock-movements", authMiddleware, async (req, res) => {
  try {
    const clientId = req.user!.userId;
    const body = req.body || {};

    if (!(Number(body.quantity) > 0)) {
      return res.status(400).json({ error: "Quantity must be greater than zero" });
    }
    if (!["in", "out"].includes(body.direction)) {
      return res.status(400).json({ error: "Direction must be Credit (in) or Debit (out)" });
    }
    const status = body.status ?? "confirmed";
    if (!["draft", "confirmed"].includes(status)) {
      return res.status(400).json({ error: "Status must be draft or confirmed" });
    }

    const isSystemFlow = !!(body.invoiceId || body.goodsReceiptId || body.purchaseInvoiceId);

    if (!isSystemFlow) {
      if (!body.reason || !MANUAL_MOVEMENT_REASONS.includes(body.reason)) {
        return res.status(400).json({
          error: "Manual entries require a movement reason — Opening stock, Stock adjustment, Damage, Samples / internal use, Customer return or Supplier return",
        });
      }
      if (!body.notes || !String(body.notes).trim()) {
        return res.status(400).json({ error: "Notes are required for every manual inventory entry" });
      }
      if (!body.productId) {
        return res.status(400).json({ error: "Select a product from the catalogue (SKU / name / unit are auto-filled)" });
      }
      const product = await Product.get(body.productId);
      if (!product) return res.status(400).json({ error: "The selected catalogue product no longer exists" });
      // Users never type SKU / name / unit — always take them from the catalogue.
      body.itemName = product.name;
      body.sku = product.sku;
      body.unit = product.unitOfMeasure || "unit";
      if (body.unitCost === undefined || body.unitCost === null || body.unitCost === "") {
        body.unitCost = product.unitCost || 0;
      }
      body.createdById = req.user!.userId;
      body.createdByName = req.user!.email;
      if (status === "confirmed") {
        body.confirmedById = body.confirmedById ?? req.user!.userId;
        body.confirmedByName = body.confirmedByName ?? req.user!.email;
        body.confirmedAt = body.confirmedAt ?? db.nowISO();
      }
    } else {
      // System-created movements (invoice dispatch stock-outs, GRN flows) are
      // attributed server-side so callers can't spoof who created/confirmed them.
      body.createdById = req.user!.userId;
      body.createdByName = req.user!.email;
      body.confirmedById = body.confirmedById ?? req.user!.userId;
      body.confirmedByName = body.confirmedByName ?? req.user!.email;
      body.confirmedAt = body.confirmedAt ?? db.nowISO();
    }

    const item = await StockMovement.create({ ...body, clientId });
    // Trigger forecast recompute asynchronously (fire-and-forget)
    const { recomputeAll } = await import("../services/forecast-service.js");
    recomputeAll(req.user!.userId).catch((err: any) =>
      console.error("  ⚠ Forecast recompute after stock movement creation failed:", err)
    );
    res.status(201).json(item);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/** POST /stock-movements/:id/confirm — flip a draft into the live stock (atomic). */
router.post("/stock-movements/:id/confirm", authMiddleware, async (req, res) => {
  try {
    const clientId = req.user!.userId;
    const current = await StockMovement.get(req.params.id);
    if (!current) return res.status(404).json({ error: "Movement not found" });
    if (current.goodsReceiptId || current.invoiceId || current.purchaseInvoiceId) {
      return res.status(400).json({ error: "This movement is created by its linked document — manage it from the GRN or invoice instead" });
    }
    if (current.status === "cancelled") {
      return res.status(400).json({ error: "Cannot confirm a cancelled movement" });
    }
    const flipped = await StockMovement.confirm(current.id, req.user!.userId, req.user!.email);
    if (!flipped) return res.json({ ...current, alreadyConfirmed: true });
    recomputeForecast(clientId);
    res.json(flipped);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/** POST /stock-movements/:id/cancel — cancelling a confirmed movement creates an opposite reversal. */
router.post("/stock-movements/:id/cancel", authMiddleware, async (req, res) => {
  try {
    const clientId = req.user!.userId;
    const current = await StockMovement.get(req.params.id);
    if (!current) return res.status(404).json({ error: "Movement not found" });
    if (current.goodsReceiptId || current.invoiceId || current.purchaseInvoiceId) {
      return res.status(400).json({ error: "This movement is created by its linked document — cancel the GRN or invoice instead" });
    }
    if (current.status === "cancelled") return res.json({ ...current, alreadyCancelled: true });
    // Atomic → cancelled flip FIRST (mirrors the GRN cancel pattern): exactly
    // one concurrent cancel wins, so only the winner writes the reversal — a
    // loser never creates a duplicate reversal entry.
    const flipped = await StockMovement.cancel(current.id, req.user!.userId, req.user!.email);
    if (!flipped) return res.json({ ...current, alreadyCancelled: true });
    // A confirmed movement already moved stock — create an opposite reversal
    // entry (also confirmed) so live stock stays correct.
    if (current.status === "confirmed") {
      await StockMovement.create({
        clientId,
        productId: current.productId,
        direction: current.direction === "in" ? "out" : "in",
        itemName: current.itemName,
        sku: current.sku,
        quantity: current.quantity,
        unit: current.unit,
        unitCost: current.unitCost,
        warehouse: current.warehouse,
        reason: current.reason || "Stock adjustment",
        linkedDocumentType: current.linkedDocumentType,
        linkedDocumentNumber: current.linkedDocumentNumber,
        status: "confirmed",
        notes: `${current.movementNumber} cancelled — reversal`,
        movementDate: db.todayDate(),
        createdById: req.user!.userId,
        createdByName: req.user!.email,
        confirmedById: req.user!.userId,
        confirmedByName: req.user!.email,
        confirmedAt: db.nowISO(),
      });
    }
    recomputeForecast(clientId);
    res.json(flipped);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete("/stock-movements/:id", authMiddleware, async (req, res) => {
  try {
    const current = await StockMovement.get(req.params.id);
    if (current) {
      if (current.goodsReceiptId || current.invoiceId || current.purchaseInvoiceId) {
        return res.status(400).json({ error: "This movement is created by its linked document — manage it from the GRN or invoice instead" });
      }
      if (current.status === "confirmed") {
        return res.status(400).json({ error: "Confirmed movements cannot be deleted — cancel them instead" });
      }
    }
    await StockMovement.remove(req.params.id);
    // Trigger forecast recompute asynchronously (fire-and-forget)
    const { recomputeAll } = await import("../services/forecast-service.js");
    recomputeAll(req.user!.userId).catch((err: any) =>
      console.error("  ⚠ Forecast recompute after stock movement deletion failed:", err)
    );
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
    // Auto-create stock movement for inventory items — a confirmed dispatch:
    // Debit entry, reduces stock, linked to the sales invoice.
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
            status: "confirmed",
            reason: "Dispatch",
            linkedDocumentType: "Sales Invoice",
            linkedDocumentNumber: item.invoiceNumber || null,
            createdById: req.user!.userId,
            createdByName: req.user!.email,
            confirmedById: req.user!.userId,
            confirmedByName: req.user!.email,
            confirmedAt: db.nowISO(),
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
// Lifecycle: draft → verified → approved_for_payment → partially_paid/paid,
// with cancelled available from draft/verified. A purchase invoice NEVER
// creates stock — only a confirmed GRN credits inventory. The invoice records
// the supplier payable (grand total); payments accumulate in amountPaid.

/** Resolve a merged supplier/vendor id to its display name (denormalized). */
async function resolveSupplierName(id: string): Promise<string | null> {
  if (!id) return null;
  try {
    const s = await Supplier.get(id);
    if (s) return s.companyName;
    const v = await Vendor.get(id);
    if (v) return v.name;
  } catch { /* ignore */ }
  return null;
}

/**
 * Validate + snapshot purchase-invoice lines against the linked goods PO.
 * Product, name, unit and the PO unit price come from the PO; the billed
 * quantity/price come from the supplier invoice.
 */
function validatePurchaseInvoiceLines(po: any, rawLines: any[]) {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw new Error("Add at least one line from the linked purchase order");
  }
  const lines: any[] = [];
  for (const ln of rawLines) {
    const poLine = (po.lines ?? []).find((l: any) => l.productId === ln.productId);
    if (!poLine) throw new Error("A line references a product that is not on the linked purchase order");
    const invoiceQty = Number(ln.invoiceQty);
    if (!Number.isFinite(invoiceQty) || invoiceQty <= 0) {
      throw new Error(`Invoice quantity must be greater than zero for ${poLine.name}`);
    }
    const unitPrice = Number(ln.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new Error(`Unit price must be greater than or equal to zero for ${poLine.name}`);
    }
    const gst = ln.gstRate === undefined || ln.gstRate === null || ln.gstRate === "" ? poLine.gstRate : Number(ln.gstRate);
    if (Number.isFinite(Number(gst)) && (Number(gst) < 0 || Number(gst) > 100)) {
      throw new Error(`GST rate must be between 0 and 100% for ${poLine.name}`);
    }
    lines.push({
      productId: poLine.productId,
      sku: poLine.sku,
      name: poLine.name,
      unit: poLine.unit ?? "unit",
      orderedQty: Number(poLine.orderedQty) || 0,
      grnReceivedQty: Number(ln.grnReceivedQty) || 0,
      invoiceQty,
      unitPrice,
      poUnitPrice: Number(poLine.unitPrice) || 0,
      gstRate: Number.isFinite(Number(gst)) ? Number(gst) : null,
    });
  }
  return lines;
}

/** Duplicate supplier invoice number check — same supplier, not cancelled. */
async function findDuplicatePurchaseInvoice(
  clientId: string,
  supplierId: string | null | undefined,
  invoiceNumber: string | null | undefined,
  excludeId: string | null
) {
  if (!supplierId || !invoiceNumber) return null;
  const needle = String(invoiceNumber).trim().toLowerCase();
  if (!needle) return null;
  const all = await PurchaseInvoice.list(clientId);
  return (
    all.find(
      (p: any) =>
        p.id !== excludeId &&
        p.status !== "cancelled" &&
        p.vendorId === supplierId &&
        String(p.invoiceNumber ?? "").trim().toLowerCase() === needle
    ) ?? null
  );
}

/**
 * Keep the linked purchase invoice in sync with a GRN: set the GRN reference
 * and back-fill each line's received (accepted) quantity. When the GRN is
 * cancelled (or the link is moved), the old link + quantities are cleared.
 */
async function syncLinkedPurchaseInvoice(receipt: any, previousPiId?: string) {
  const detach = async (piId: string) => {
    if (!piId) return;
    const pi = await PurchaseInvoice.get(piId);
    if (!pi) return;
    if (pi.linkedGoodsReceiptId && pi.linkedGoodsReceiptId !== receipt.id) return;
    await PurchaseInvoice.update(pi.id, {
      linkedGoodsReceiptId: null,
      linkedGoodsReceiptNumber: null,
      lines: (pi.lines ?? []).map((l: any) => ({ ...l, grnReceivedQty: 0 })),
    });
  };
  if (previousPiId && previousPiId !== receipt.purchaseInvoiceId) await detach(previousPiId);
  if (!receipt.purchaseInvoiceId) return;
  const pi = await PurchaseInvoice.get(receipt.purchaseInvoiceId);
  if (!pi) return;
  if (receipt.status === "cancelled") {
    if (pi.linkedGoodsReceiptId === receipt.id) await detach(receipt.purchaseInvoiceId);
    return;
  }
  const qtyByProduct = new Map<string, number>();
  for (const ln of receipt.lines ?? []) {
    qtyByProduct.set(String(ln.productId), Number(ln.acceptedQty ?? ln.receivedQty) || 0);
  }
  await PurchaseInvoice.update(pi.id, {
    linkedGoodsReceiptId: receipt.id,
    linkedGoodsReceiptNumber: receipt.receiptNumber,
    lines: (pi.lines ?? []).map((l: any) => ({
      ...l,
      grnReceivedQty: qtyByProduct.get(String(l.productId)) ?? l.grnReceivedQty ?? 0,
    })),
  });
}

router.get("/purchase-invoices", authMiddleware, async (req, res) => {
  try { res.json(await PurchaseInvoice.list(req.user!.userId)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.post("/purchase-invoices", authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    const clientId = req.user!.userId;
    // NOTE: a purchase invoice NEVER creates stock — only a confirmed GRN credits
    // inventory (the GRN is the sole stock-in document for purchases).
    if (!body.vendorId) return res.status(400).json({ error: "Select a supplier" });
    if (!body.invoiceNumber || !String(body.invoiceNumber).trim()) {
      return res.status(400).json({ error: "Supplier invoice number is required" });
    }
    // Supplier invoice number must be unique per supplier (cancelled excluded).
    const dup = await findDuplicatePurchaseInvoice(clientId, body.vendorId, body.invoiceNumber, null);
    if (dup) {
      return res.status(400).json({ error: `Supplier invoice number "${body.invoiceNumber}" already exists for this supplier on invoice ${dup.invoiceNumber}` });
    }
    if (!body.supplierName) body.supplierName = await resolveSupplierName(body.vendorId);
    // The purchase-invoice ↔ purchase-order link is MANDATORY: the invoice
    // lines come from the PO, and the GRN (created later) receives against the
    // same PO. No PO = no purchase invoice.
    if (!body.goodsPurchaseOrderId) {
      return res.status(400).json({ error: "A linked purchase order is required" });
    }
    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      return res.status(400).json({ error: "Add at least one line from the linked purchase order" });
    }
    const po = await GoodsPO.get(body.goodsPurchaseOrderId);
    if (!po) return res.status(404).json({ error: "Linked purchase order not found" });
    if (po.status === "cancelled") {
      return res.status(400).json({ error: "Cannot invoice against a cancelled purchase order" });
    }
    try { body.lines = validatePurchaseInvoiceLines(po, body.lines); }
    catch (e: any) { return res.status(400).json({ error: e.message }); }
    body.goodsPoNumber = po.poNumber;
    const item = await PurchaseInvoice.create({ ...body, clientId, vendorId: body.vendorId });
    // Instant reminder check for purchase invoices too
    if (item.dueDate && !["paid", "rejected", "cancelled"].includes(item.status)) {
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
    const body = req.body || {};
    const current = await PurchaseInvoice.get(req.params.id);
    if (!current) return res.status(404).json({ error: "Purchase invoice not found" });
    const roles: string[] = req.user!.roles || [];
    const isAdmin = roles.includes("factor_admin");
    const isChecker = roles.includes("checker");
    const isTreasury = roles.includes("treasury");
    const isCreator = req.user!.userId === current.clientId;

    // ── Role guards on status changes ──
    if (body.status && body.status !== current.status) {
      const toStatus = String(body.status);
      const allowed =
        toStatus === "cancelled" ? isAdmin || isCreator :
        toStatus === "paid" || toStatus === "partially_paid" ? isAdmin || isTreasury :
        toStatus === "approved_for_payment" ? isAdmin || isChecker :
        toStatus === "verified" ? isAdmin || isCreator :
        toStatus === "draft" ? isAdmin || isCreator || isChecker :
        false;
      if (!allowed) return res.status(403).json({ error: "You do not have permission to make this status change" });
    }
    // ── Only treasury/admin can record payments ──
    if (body.amountPaid !== undefined && Number(body.amountPaid) !== Number(current.amountPaid ?? 0)) {
      if (!isAdmin && !isTreasury) return res.status(403).json({ error: "Only treasury/admin can record payments" });
    }
    // ── Closed invoices are frozen (payment/status only) ──
    if (current.status === "paid" || current.status === "cancelled") {
      const frozen = ["lines", "freight", "vendorId", "invoiceNumber", "issueDate", "receivedDate", "dueDate", "goodsPurchaseOrderId", "notes", "documents"];
      if (frozen.some((k) => (body as any)[k] !== undefined)) {
        return res.status(400).json({ error: `A ${current.status} invoice cannot be edited` });
      }
    }

    if (body.vendorId && body.vendorId !== current.vendorId) {
      body.supplierName = (await resolveSupplierName(body.vendorId)) ?? current.supplierName;
    }
    // The purchase-invoice ↔ purchase-order link is MANDATORY — but only for
    // CONTENT edits. Status/payment/note transitions (checker approval,
    // treasury payments, credit-note adjustments) must keep working on legacy
    // invoices created before the rule, which have no linked PO.
    const contentEdit =
      body.lines !== undefined ||
      body.freight !== undefined ||
      body.goodsPurchaseOrderId !== undefined ||
      body.vendorId !== undefined ||
      body.invoiceNumber !== undefined;
    if (contentEdit) {
      const poId = body.goodsPurchaseOrderId || current.goodsPurchaseOrderId;
      if (!poId) {
        return res.status(400).json({ error: "A linked purchase order is required" });
      }
      if (body.goodsPurchaseOrderId !== undefined) {
        const linkedPo = await GoodsPO.get(body.goodsPurchaseOrderId);
        if (linkedPo?.status === "cancelled") {
          return res.status(400).json({ error: "Cannot link a cancelled purchase order" });
        }
      }
      if (body.lines !== undefined) {
        if (!Array.isArray(body.lines) || body.lines.length === 0) {
          return res.status(400).json({ error: "Add at least one line from the linked purchase order" });
        }
        const po = await GoodsPO.get(poId);
        if (!po) return res.status(404).json({ error: "Linked purchase order not found" });
        try { body.lines = validatePurchaseInvoiceLines(po, body.lines); }
        catch (e: any) { return res.status(400).json({ error: e.message }); }
        body.goodsPoNumber = po.poNumber;
      }
    }
    // Supplier invoice number must be unique per supplier (excluding self + cancelled).
    if (body.invoiceNumber !== undefined || body.vendorId !== undefined) {
      const dup = await findDuplicatePurchaseInvoice(
        req.user!.userId,
        body.vendorId ?? current.vendorId,
        body.invoiceNumber ?? current.invoiceNumber,
        current.id
      );
      if (dup) {
        return res.status(400).json({ error: `Supplier invoice number "${body.invoiceNumber ?? current.invoiceNumber}" already exists for this supplier on invoice ${dup.invoiceNumber}` });
      }
    }
    const updated = await PurchaseInvoice.update(req.params.id, body);
    // Instant reminder check on update
    if (body.dueDate || body.status) {
      const inv = await PurchaseInvoice.get(req.params.id);
      if (inv && inv.dueDate && !["paid", "rejected", "cancelled"].includes(inv.status)) {
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
  try {
    const current = await PurchaseInvoice.get(req.params.id);
    if (!current) return res.status(404).json({ error: "Purchase invoice not found" });
    if (!["draft"].includes(current.status)) {
      return res.status(400).json({ error: "Only draft purchase invoices can be deleted — cancel verified+ invoices instead" });
    }
    await PurchaseInvoice.remove(req.params.id);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===================== PURCHASE ORDERS (Proformas) =====================
// Purchase-side proformas are supplier quotations: their product lines must
// reference catalogue SKUs with quantity > 0 and unit price >= 0.

/** Validate proforma (purchase-side) catalogue lines if provided. */
async function validateProformaLines(clientId: string, rawLines: any[]) {
  if (!Array.isArray(rawLines) || rawLines.length === 0) return [];
  const products = await Product.list(clientId);
  const catalogueIds = new Set(products.map((p: any) => p.id));
  for (const l of rawLines) {
    if (!l.productId) throw new Error("Every line must select a product from the catalogue");
    if (!catalogueIds.has(l.productId)) throw new Error("Every SKU must come from the product catalogue");
    if (!(Number(l.quantity) > 0)) throw new Error("Quantity must be greater than zero");
    if (Number(l.unitPrice) < 0) throw new Error("Unit price must be greater than or equal to zero");
  }
  return rawLines;
}

router.get("/purchase-orders", authMiddleware, async (req, res) => {
  try { res.json(await PurchaseOrder.list(req.user!.userId)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.post("/purchase-orders", authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    if (body.lines !== undefined) {
      try { body.lines = await validateProformaLines(req.user!.userId, body.lines); }
      catch (e: any) { return res.status(400).json({ error: e.message }); }
    }
    const item = await PurchaseOrder.create({ ...body, clientId: req.user!.userId });
    res.status(201).json(item);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.put("/purchase-orders/:id", authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    if (body.lines !== undefined) {
      try { body.lines = await validateProformaLines(req.user!.userId, body.lines); }
      catch (e: any) { return res.status(400).json({ error: e.message }); }
    }
    res.json(await PurchaseOrder.update(req.params.id, body));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.delete("/purchase-orders/:id", authMiddleware, async (req, res) => {
  try { await PurchaseOrder.remove(req.params.id); res.json({ success: true }); } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===================== GOODS PURCHASE ORDERS (catalogue-backed POs) =====================
// Distinct from the proforma PurchaseOrder model above: a goods PO is a purchase
// request/commitment that references catalogue SKUs. It NEVER creates inventory —
// only a GRN (goods receipt) credits stock.

/** Shape + catalogue checks for PO lines. SKUs must come from the product catalogue. */
async function validateGoodsPOLines(clientId: string, rawLines: any[]) {
  const lines = Array.isArray(rawLines) ? rawLines : [];
  if (lines.length === 0) throw new Error("Add at least one product line");
  const products = await Product.list(clientId);
  const catalogueIds = new Set(products.map((p: any) => p.id));
  for (const l of lines) {
    if (!l.productId) throw new Error("Every line must select a product from the catalogue");
    if (!catalogueIds.has(l.productId)) throw new Error("Every SKU must come from the product catalogue");
    if (!(Number(l.orderedQty) > 0)) throw new Error("Ordered quantity must be greater than zero");
    if (Number(l.unitPrice) < 0) throw new Error("Unit price must be greater than or equal to zero");
  }
  return lines;
}

router.get("/goods-purchase-orders", authMiddleware, async (req, res) => {
  try { res.json(await GoodsPO.list(req.user!.userId)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.post("/goods-purchase-orders", authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    let lines: any[];
    try { lines = await validateGoodsPOLines(req.user!.userId, body.lines); } catch (e: any) { return res.status(400).json({ error: e.message }); }
    const item = await GoodsPO.create({
      ...body, lines, clientId: req.user!.userId,
      buyerId: req.user!.userId, buyerName: req.user!.email,
    });
    res.status(201).json(item);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.put("/goods-purchase-orders/:id", authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    if (body.lines !== undefined) {
      let lines: any[];
      try { lines = await validateGoodsPOLines(req.user!.userId, body.lines); } catch (e: any) { return res.status(400).json({ error: e.message }); }
      body.lines = lines;
    }
    res.json(await GoodsPO.update(req.params.id, body));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.delete("/goods-purchase-orders/:id", authMiddleware, async (req, res) => {
  try { await GoodsPO.remove(req.params.id); res.json({ success: true }); } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===================== GOODS RECEIPTS (GRN) =====================
// Lifecycle: draft (no stock) → confirm (credits stock with the ACCEPTED
// quantity, folds accepted qty into the PO) → cancelled (reversing debit
// entries only if stock had already been credited).
// The GRN is the ONLY document that credits inventory — POs, proformas and
// purchase invoices never touch stock.

function assertPOReceivable(po: any) {
  if (po.status === "cancelled") throw new Error("Cannot receive against a cancelled PO");
  if (po.status === "draft") throw new Error("Approve and send the PO before receiving goods");
  if (po.status === "fully_received") throw new Error("PO is already fully received");
}

/**
 * Validate GRN lines against the PO (ordered/pending limits) and snapshot them
 * onto the GRN. The over-receipt gate applies to the ACCEPTED quantity — that
 * is what counts toward the PO and enters stock.
 */
function validateReceiptLines(po: any, rawLines: any[], allowOverReceipt: boolean) {
  const lines: any[] = [];
  if (!Array.isArray(rawLines) || rawLines.length === 0) throw new Error("At least one received line required");
  // Accumulate per-product accepted quantities so duplicate lines can't each
  // pass the pending check and collectively over-receive.
  const seen = new Map<string, number>();
  for (const ln of rawLines) {
    const poLine = (po.lines ?? []).find((l: any) => l.productId === ln.productId);
    if (!poLine) throw new Error("A receipt line references a product that is not on this PO");
    const receivedQty = Number(ln.receivedQty);
    if (!Number.isFinite(receivedQty) || receivedQty <= 0) throw new Error(`Received quantity must be greater than zero for ${poLine.name}`);
    // Empty/null accepted defaults to received (accepted is normally same as received).
    const rawAccepted = ln.acceptedQty;
    const acceptedQty =
      rawAccepted === undefined || rawAccepted === null || rawAccepted === ""
        ? receivedQty
        : Number(rawAccepted);
    if (!Number.isFinite(acceptedQty) || acceptedQty < 0) throw new Error(`Accepted quantity must be a non-negative number for ${poLine.name}`);
    if (acceptedQty > receivedQty) throw new Error(`Accepted quantity cannot exceed received quantity for ${poLine.name}`);
    const rawRejected = ln.rejectedQty;
    const rejectedQty =
      rawRejected === undefined || rawRejected === null || rawRejected === ""
        ? 0
        : Number(rawRejected);
    if (!Number.isFinite(rejectedQty) || rejectedQty < 0) throw new Error(`Rejected quantity must be a non-negative number for ${poLine.name}`);
    if (rejectedQty > receivedQty) throw new Error(`Rejected quantity cannot exceed received quantity for ${poLine.name}`);
    if (acceptedQty + rejectedQty > receivedQty) {
      throw new Error(`Accepted + rejected cannot exceed received quantity for ${poLine.name}`);
    }
    const already = seen.get(poLine.productId) ?? 0;
    const pending = poLine.orderedQty - (poLine.receivedQty ?? 0) - already;
    if (acceptedQty > pending && !allowOverReceipt) {
      throw new Error(`Accepting ${acceptedQty} for ${poLine.name} exceeds the ${Math.max(0, pending)} pending. Over-receipt requires checker/admin approval.`);
    }
    seen.set(poLine.productId, already + acceptedQty);
    lines.push({
      productId: poLine.productId, sku: poLine.sku, name: poLine.name,
      unit: poLine.unit ?? "unit",
      orderedQty: poLine.orderedQty, receivedQty, acceptedQty, rejectedQty,
      unitCost: Number(ln.unitCost ?? poLine.unitPrice) || 0,
      gstRate: poLine.gstRate ?? null,
      lineValue: Math.round(acceptedQty * (Number(ln.unitCost ?? poLine.unitPrice) || 0) * 100) / 100,
      notes: ln.notes || null,
    });
  }
  return lines;
}

/** Quantity that was credited for a line — accepted, or received for legacy GRNs. */
function creditedQty(l: any): number {
  return Number(l.acceptedQty ?? l.receivedQty) || 0;
}

/** Credit inventory for the ACCEPTED quantity of every GRN line and fold accepted qty into the PO. */
async function creditGoodsReceipt(clientId: string, receipt: any, po: any) {
  const unitByProduct = new Map<string, string>(
    (po.lines ?? []).map((l: any) => [String(l.productId), String(l.unit ?? "unit")] as [string, string])
  );
  for (const ln of receipt.lines ?? []) {
    const qty = creditedQty(ln);
    if (!(qty > 0)) continue; // fully rejected lines credit nothing
    await StockMovement.create({
      clientId, productId: ln.productId, direction: "in", itemName: ln.name, sku: ln.sku,
      quantity: qty, unit: unitByProduct.get(ln.productId) || ln.unit || "unit",
      unitCost: ln.unitCost,
      warehouse: receipt.warehouse || null,
      reason: "Goods receipt",
      linkedDocumentType: "GRN",
      linkedDocumentNumber: receipt.receiptNumber,
      status: "confirmed",
      notes: `GRN ${receipt.receiptNumber}`,
      movementDate: receipt.receivedDate, goodsReceiptId: receipt.id,
      purchaseOrderId: receipt.goodsPurchaseOrderId,
      createdById: receipt.receivedById, createdByName: receipt.receivedBy,
      confirmedById: receipt.creditedBy, confirmedByName: receipt.creditedBy, confirmedAt: receipt.creditedAt,
    });
  }
  await GoodsPO.recordReceipt(receipt.goodsPurchaseOrderId, (receipt.lines ?? []).map((l: any) => ({ productId: l.productId, receivedQty: creditedQty(l) })));
}

/** Create reversing debit (stock-out) entries for a confirmed GRN and revoke its PO quantities. */
async function reverseGoodsReceipt(clientId: string, receipt: any, po: any) {
  const unitByProduct = new Map<string, string>(
    (po?.lines ?? []).map((l: any) => [String(l.productId), String(l.unit ?? "unit")] as [string, string])
  );
  for (const ln of receipt.lines ?? []) {
    const qty = creditedQty(ln);
    if (!(qty > 0)) continue;
    await StockMovement.create({
      clientId, productId: ln.productId, direction: "out", itemName: ln.name, sku: ln.sku,
      quantity: qty, unit: unitByProduct.get(ln.productId) || ln.unit || "unit",
      unitCost: ln.unitCost,
      warehouse: receipt.warehouse || null,
      reason: "Stock adjustment",
      linkedDocumentType: "GRN",
      linkedDocumentNumber: receipt.receiptNumber,
      status: "confirmed",
      notes: `GRN ${receipt.receiptNumber} cancelled — reversal`,
      movementDate: db.todayDate(), goodsReceiptId: receipt.id,
      purchaseOrderId: receipt.goodsPurchaseOrderId,
      createdById: receipt.cancelledBy, createdByName: receipt.cancelledBy,
      confirmedById: receipt.cancelledBy, confirmedByName: receipt.cancelledBy, confirmedAt: db.nowISO(),
    });
  }
  await GoodsPO.revokeReceipt(receipt.goodsPurchaseOrderId, (receipt.lines ?? []).map((l: any) => ({ productId: l.productId, receivedQty: creditedQty(l) })));
}

async function recomputeForecast(clientId: string) {
  const { recomputeAll } = await import("../services/forecast-service.js");
  recomputeAll(clientId).catch((err: any) =>
    console.error("  ⚠ Forecast recompute after goods receipt change failed:", err)
  );
}

router.get("/goods-receipts", authMiddleware, async (req, res) => {
  try { res.json(await GoodsReceipt.list(req.user!.userId)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/** POST /goods-receipts — create a DRAFT GRN. No stock impact. */
router.post("/goods-receipts", authMiddleware, async (req, res) => {
  try {
    const clientId = req.user!.userId;
    const body = req.body || {};
    if (!body.goodsPurchaseOrderId) return res.status(400).json({ error: "goodsPurchaseOrderId required" });
    const po = await GoodsPO.get(body.goodsPurchaseOrderId);
    if (!po) return res.status(404).json({ error: "PO not found" });
    if (po.status === "cancelled") return res.status(400).json({ error: "Cannot create a GRN against a cancelled PO" });
    // A draft may be prepared against any open PO; the receivable/over-receipt
    // checks run at CONFIRM time (the moment stock actually gets credited).
    let lines: any[];
    try { lines = validateReceiptLines(po, body.lines, false); } catch (e: any) { return res.status(400).json({ error: e.message }); }
    const receipt = await GoodsReceipt.create({
      clientId, goodsPurchaseOrderId: po.id, poNumber: po.poNumber,
      supplierId: body.supplierId ?? po.supplierId, supplierName: body.supplierName ?? po.supplierName,
      warehouse: body.warehouse ?? po.warehouse,
      receivedDate: body.receivedDate || null,
      purchaseInvoiceId: body.purchaseInvoiceId || null,
      challanNumber: body.challanNumber || null,
      receivedById: req.user!.userId, receivedBy: req.user!.email,
      notes: body.notes || null, documents: body.documents || [],
      status: "draft", lines,
    });
    await syncLinkedPurchaseInvoice(receipt);
    res.status(201).json(receipt);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/** POST /goods-receipts/:id/confirm — credit stock (idempotent, race-safe). */
router.post("/goods-receipts/:id/confirm", authMiddleware, async (req, res) => {
  try {
    const clientId = req.user!.userId;
    const receipt = await GoodsReceipt.get(req.params.id);
    if (!receipt) return res.status(404).json({ error: "GRN not found" });
    // Legacy GRNs from the pre-lifecycle flow have status "received" and were
    // already credited — never credit them again.
    if (receipt.status === "received") return res.json({ ...receipt, alreadyConfirmed: true });
    if (receipt.status === "cancelled") return res.status(400).json({ error: "Cannot confirm a cancelled GRN" });
    const allowOver = !!req.body?.allowOverReceipt && (req.user!.roles?.includes("factor_admin") || req.user!.roles?.includes("checker"));
    const po = await GoodsPO.get(receipt.goodsPurchaseOrderId);
    if (!po) return res.status(404).json({ error: "PO not found" });
    try { assertPOReceivable(po); } catch (e: any) { return res.status(400).json({ error: e.message }); }
    // Re-validate at confirm time — the PO may have been received further in the
    // meantime, so pending is checked against the live PO.
    try { validateReceiptLines(po, receipt.lines, allowOver); } catch (e: any) { return res.status(400).json({ error: e.message }); }
    // Atomic draft → confirmed flip: exactly one concurrent confirm wins and
    // credits stock; the others get alreadyConfirmed and credit nothing.
    const flipped = await GoodsReceipt.flipToConfirmed(receipt.id, req.user!.email);
    if (!flipped) return res.json({ ...receipt, alreadyConfirmed: true });
    await creditGoodsReceipt(clientId, flipped, po);
    await syncLinkedPurchaseInvoice(flipped);
    recomputeForecast(clientId);
    res.json(flipped);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/** POST /goods-receipts/:id/cancel — reversing debit entries only if stock was credited. */
router.post("/goods-receipts/:id/cancel", authMiddleware, async (req, res) => {
  try {
    const clientId = req.user!.userId;
    const receipt = await GoodsReceipt.get(req.params.id);
    if (!receipt) return res.status(404).json({ error: "GRN not found" });
    if (receipt.status === "cancelled") return res.json({ ...receipt, alreadyCancelled: true });
    // Atomic → cancelled flip: only the winner performs the reversal.
    const flipped = await GoodsReceipt.flipToCancelled(receipt.id, req.user!.email);
    if (!flipped) return res.json({ ...receipt, alreadyCancelled: true });
    // Decide reversal from POST-flip state: "received" is the legacy confirmed
    // status (stock was credited), and flipToCancelled keeps stockCredited true
    // from confirm — so this is also safe against a confirm racing in between.
    const wasCredited = receipt.status === "received" || flipped.stockCredited === true;
    if (wasCredited) {
      const po = await GoodsPO.get(receipt.goodsPurchaseOrderId);
      if (po) await reverseGoodsReceipt(clientId, receipt, po);
    }
    await syncLinkedPurchaseInvoice(flipped);
    recomputeForecast(clientId);
    res.json(flipped);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/** PUT /goods-receipts/:id — edit a DRAFT only (no stock impact). */
router.put("/goods-receipts/:id", authMiddleware, async (req, res) => {
  try {
    const receipt = await GoodsReceipt.get(req.params.id);
    if (!receipt) return res.status(404).json({ error: "GRN not found" });
    if (receipt.status !== "draft") return res.status(400).json({ error: "Only draft GRNs can be edited — confirm or cancel first" });
    const body = req.body || {};
    const po = await GoodsPO.get(receipt.goodsPurchaseOrderId);
    if (!po) return res.status(404).json({ error: "PO not found" });
    let lines = receipt.lines;
    if (body.lines !== undefined) {
      try { lines = validateReceiptLines(po, body.lines, false); } catch (e: any) { return res.status(400).json({ error: e.message }); }
    }
    // Normalize an explicit empty-string unlink to null so the PI link clears.
    const newPiId =
      body.purchaseInvoiceId !== undefined
        ? body.purchaseInvoiceId
          ? String(body.purchaseInvoiceId)
          : null
        : receipt.purchaseInvoiceId;
    const updated = await GoodsReceipt.update(receipt.id, {
      receivedDate: body.receivedDate ?? receipt.receivedDate,
      warehouse: body.warehouse ?? receipt.warehouse,
      purchaseInvoiceId: newPiId,
      challanNumber: body.challanNumber ?? receipt.challanNumber,
      notes: body.notes ?? receipt.notes,
      documents: body.documents ?? receipt.documents,
      lines,
    });
    await syncLinkedPurchaseInvoice(updated, receipt.purchaseInvoiceId ?? undefined);
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/** DELETE /goods-receipts/:id — delete a DRAFT only. Confirmed GRNs must be cancelled first. */
router.delete("/goods-receipts/:id", authMiddleware, async (req, res) => {
  try {
    const receipt = await GoodsReceipt.get(req.params.id);
    if (!receipt) return res.status(404).json({ error: "GRN not found" });
    if (receipt.status !== "draft") {
      return res.status(400).json({ error: "Only draft GRNs can be deleted — cancel confirmed GRNs instead" });
    }
    // Detach any linked purchase invoice so it doesn't dangle at a deleted GRN.
    await syncLinkedPurchaseInvoice({ ...receipt, status: "cancelled" }, receipt.purchaseInvoiceId ?? undefined);
    await GoodsReceipt.remove(receipt.id);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
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
    const alerts: Array<{ message: string; type: string }> = [];
    for (const inv of invoices) {
      if (!inv.dueDate) continue;
      const dpd = Math.max(0, Math.floor((Date.now() - new Date(inv.dueDate).getTime()) / 86400000));
      if (dpd > 0 && inv.status !== "paid" && inv.status !== "rejected") {
        alerts.push({ message: `Invoice ${inv.invoiceNumber} overdue ${dpd} days — $${inv.amount}`, type: "overdue" });
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

// ===================== FORECAST VARIABLES (persisted snapshots) =====================
/**
 * GET /forecast-variables — returns persisted forecast snapshots for all active products.
 * Auto-triggers a daily recompute if today's forecast hasn't been computed yet.
 */
router.get("/forecast-variables", authMiddleware, async (req, res) => {
  try {
    const clientId = req.user!.userId;
    const { ensureFresh, recomputeAll } = await import("../services/forecast-service.js");

    // Automatically recompute if stale (daily freshness check)
    const wasRecomputed = await ensureFresh(clientId);

    // Fetch all persisted forecast variables
    const { listByClient } = await import("../models/forecast-variable.js");
    const variables = await listByClient(clientId);

    // Parse forecastJson and build response with rich data
    const snapshots = variables.map((v) => ({
      ...v,
      forecast: JSON.parse(v.forecastJson),
    }));

    // Also fetch products for category info (used by frontend pricing strategy)
    const products = await Product.list(clientId);
    const productMap = new Map(products.filter((p: any) => p.status === "active").map((p: any) => [p.id, p]));

    res.json({
      computedDate: variables.length > 0 ? variables[0].computedDate : null,
      wasRecomputed,
      snapshots,
      products: Array.from(productMap.values()),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /forecast-variables/recompute — manually trigger a full recompute.
 */
router.post("/forecast-variables/recompute", authMiddleware, async (req, res) => {
  try {
    const clientId = req.user!.userId;
    const { recomputeAll } = await import("../services/forecast-service.js");
    const result = await recomputeAll(clientId);
    res.json({
      computedDate: result.computedDate,
      count: result.count,
      message: `Forecasts recomputed for ${result.count} products on ${result.computedDate}`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
// In-memory multipart parser — 15 MB cap, matching the frontend uploaders.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

/**
 * POST /upload — multipart form with `file`, and optionally `path` (S3 key) and
 * `scope` (e.g. "products", "invoices"). If no path is given, one is derived
 * from the user id + scope + a timestamp. Stores the object in S3 and returns
 * { path, url, name, size, type }.
 */
router.post("/upload", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file provided (multipart field name: file)" });
    const { path, scope } = (req.body || {}) as { path?: string; scope?: string };
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const safePath = (path || `${req.user!.userId}/${scope || "misc"}/${Date.now()}-${safeName}`).replace(/^\/+/, "");
    // Every key lives under the requester's own folder — never accept a path
    // that points into another account's data.
    if (!safePath.startsWith(`${req.user!.userId}/`)) {
      return res.status(403).json({ error: "Upload key must be scoped to your account" });
    }
    const { uploadFile } = await import("../s3.js");
    const result = await uploadFile(safePath, file.buffer, file.mimetype || "application/octet-stream");
    res.status(201).json({ path: safePath, url: result.url, name: file.originalname, size: file.size, type: file.mimetype });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/** GET /upload/<path>/url — signed short-lived download URL for a stored object. */
router.get("/upload/*/url", authMiddleware, async (req, res) => {
  try {
    const key = decodeURIComponent(req.params[0]);
    // Only sign URLs for the requester's own folder.
    if (!key.startsWith(`${req.user!.userId}/`)) {
      return res.status(403).json({ error: "Access denied" });
    }
    const { getSignedDownloadUrl } = await import("../s3.js");
    const url = await getSignedDownloadUrl(key);
    res.json({ path: key, url });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/** DELETE /upload/<path> — delete a stored object from S3. */
router.delete("/upload/*", authMiddleware, async (req, res) => {
  try {
    const key = decodeURIComponent(req.params[0]);
    // Only allow deleting objects in the requester's own folder.
    if (!key.startsWith(`${req.user!.userId}/`)) {
      return res.status(403).json({ error: "Access denied" });
    }
    const { deleteFile } = await import("../s3.js");
    await deleteFile(key);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===================== USER PROGRESS (for reporting managers) =====================
router.get("/user-progress", authMiddleware, async (req, res) => {
  try {
    const userId = req.user!.userId;

    // Get user profile
    const user = await db.getItem(`USER#${userId}`);
    if (!user) return res.status(404).json({ error: "User not found" });

    const roles: string[] = (user as any).roles || [];
    const isSalesRep = roles.includes("sales_rep");
    const isOperations = roles.includes("operations");
    const isChecker = roles.includes("checker");
    const isTreasury = roles.includes("treasury");

    // Fetch all data in parallel
    const [
      leads,
      opportunities,
      activities,
      invoices,
      purchaseInvoices,
      purchaseOrders,
      expenses,
      advances,
      allSubmissions,
    ] = await Promise.all([
      isSalesRep ? Combined.listLeads(userId) : Promise.resolve([]),
      isSalesRep ? Combined.listOpportunities(userId) : Promise.resolve([]),
      isSalesRep ? Combined.listActivities(userId) : Promise.resolve([]),
      isOperations || isChecker || isTreasury ? Invoice.list(userId) : Promise.resolve([]),
      isOperations ? PurchaseInvoice.list(userId) : Promise.resolve([]),
      isOperations ? PurchaseOrder.list(userId) : Promise.resolve([]),
      Expense.list(userId),
      Advance.list(userId),
      db.scanByType("Submission").then((items: any[]) => items.filter((s: any) => s.userId === userId)),
    ]);

    // Compute stats
    const leadsByStatus: Record<string, number> = {};
    for (const l of leads) {
      const st = (l as any).status || "unknown";
      leadsByStatus[st] = (leadsByStatus[st] || 0) + 1;
    }

    const oppsByStage: Record<string, number> = {};
    let totalOppAmount = 0;
    for (const o of opportunities) {
      const st = (o as any).stage || "unknown";
      oppsByStage[st] = (oppsByStage[st] || 0) + 1;
      totalOppAmount += (o as any).amount || 0;
    }

    const invoicesByStatus: Record<string, number> = {};
    let totalInvoiceAmount = 0;
    for (const inv of invoices) {
      const st = (inv as any).status || "unknown";
      invoicesByStatus[st] = (invoicesByStatus[st] || 0) + 1;
      totalInvoiceAmount += (inv as any).amount || 0;
    }

    const poByStatus: Record<string, number> = {};
    for (const po of purchaseInvoices) {
      const st = (po as any).status || "unknown";
      poByStatus[st] = (poByStatus[st] || 0) + 1;
    }

    const subsByType: Record<string, number> = {};
    const subsByStatus: Record<string, number> = {};
    for (const s of allSubmissions) {
      const t = (s as any).type || "unknown";
      const st = (s as any).status || "unknown";
      subsByType[t] = (subsByType[t] || 0) + 1;
      subsByStatus[st] = (subsByStatus[st] || 0) + 1;
    }

    const progress = {
      user: {
        id: (user as any).id,
        email: (user as any).email,
        companyName: (user as any).companyName,
        contactName: (user as any).contactName,
        roles,
      },
      stats: {
        leads: { total: leads.length, byStatus: leadsByStatus, totalEstimatedValue: leads.reduce((s: number, l: any) => s + (l.estimatedValue || 0), 0) },
        opportunities: { total: opportunities.length, byStage: oppsByStage, totalAmount: totalOppAmount },
        activities: { total: activities.length, recent: activities.slice(-5).reverse() },
        invoices: { total: invoices.length, byStatus: invoicesByStatus, totalAmount: totalInvoiceAmount },
        purchaseInvoices: { total: purchaseInvoices.length, byStatus: poByStatus },
        purchaseOrders: { total: purchaseOrders.length },
        expenses: { total: expenses.length, totalAmount: expenses.reduce((s: number, e: any) => s + (e.amount || 0), 0) },
        advances: { total: advances.length, totalAmount: advances.reduce((s: number, a: any) => s + (a.amount || 0), 0) },
        submissions: { total: allSubmissions.length, byType: subsByType, byStatus: subsByStatus },
      },
    };

    res.json(progress);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
