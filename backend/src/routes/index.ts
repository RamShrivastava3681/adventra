import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import { v4 as uuid } from "uuid";
import { config } from "../config.js";
import {
  authMiddleware,
  AuthPayload,
  verifyToken,
  getTokenFromRequest,
  clearAuthCookie,
} from "../middleware/auth.js";
import {
  loginLimiter,
  accountLoginLimiter,
  signupLimiter,
  publicTokenLimiter,
  authSlowDown,
} from "../middleware/rate-limit.js";
import { detectFileType, sanitizeS3Key, auditAdminAction, logSecurityEvent } from "../middleware/security.js";
import { requireAdmin, requireChecker } from "../middleware/roles.js";
import { requireRole } from "../middleware/roles.js";
import * as User from "../models/user.js";
import * as Submission from "../models/submission.js";
import * as ReminderLog from "../models/reminder-log.js";

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
      const token = getTokenFromRequest(req);
      if (!token) {
        return res.status(401).json({ error: "No token provided" });
      }
      try {
        const payload = verifyToken(token) as AuthPayload;
        req.user = { userId: payload.userId, email: payload.email, roles: payload.roles || [] };
      } catch {
        return res.status(401).json({ error: "Invalid or expired token" });
      }
    }

    // Verify the requester is a reporting_manager
    if (!req.user.roles?.includes("reporting_manager")) {
      logSecurityEvent("view_as.denied", req, { targetUserId: viewAsUserId });
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
import * as GoodsSO from "../models/goods-sales-order.js";
import * as GoodsDispatch from "../models/goods-dispatch.js";
import * as Quotation from "../models/quotation.js";
import * as Expense from "../models/expense.js";
import * as Advance from "../models/advance.js";
import * as Alert from "../models/alert.js";
import * as CoA from "../models/chart-of-account.js";
import * as Journal from "../models/journal.js";
import * as CDNote from "../models/credit-debit-note.js";
import * as Combined from "../models/models-combined.js";
import * as db from "../dynamodb.js";
import * as AuditLog from "../models/audit-log.js";

const router = Router();

/** Record a workflow action in the immutable audit trail (fire-and-forget). */
function trackAction(
  req: Request,
  action: string,
  target: string | null,
  detail?: Record<string, unknown>
) {
  const actor = (req as any).user;
  void AuditLog.writeWorkflowAction(
    { userId: actor?.userId, email: actor?.email, roles: actor?.roles },
    action,
    target,
    detail,
    { ip: req.ip, userAgent: req.headers["user-agent"] }
  );
}

// Apply view-as middleware to all data routes
router.use(viewAsMiddleware);

// ===================== AUTH =====================
router.post("/auth/signup", signupLimiter, authSlowDown, (req, res) => User.signup(req, res));
router.post("/auth/login", loginLimiter, accountLoginLimiter, authSlowDown, (req, res) => User.login(req, res));
// Logout — clears the httpOnly session cookie. Unauthenticated calls are fine.
router.post("/auth/logout", (req, res) => {
  clearAuthCookie(res);
  res.json({ success: true });
});
router.get("/auth/me", authMiddleware, (req, res) => User.getProfile(req, res));
router.put("/auth/profile", authMiddleware, (req, res) => User.updateProfile(req, res));

// ===================== ADMIN =====================
router.get("/admin/users", authMiddleware, requireAdmin, (req, res) => User.getUsers(req, res));
router.post("/admin/users/create", authMiddleware, requireAdmin, auditAdminAction, (req, res) => User.adminCreateUser(req, res));
router.put("/admin/users/role", authMiddleware, requireAdmin, auditAdminAction, (req, res) => User.updateUserRole(req, res));
router.get("/admin/users/managers", authMiddleware, requireAdmin, (req, res) => User.listManagers(req, res));
router.put("/admin/users/:userId/assign-manager", authMiddleware, requireAdmin, auditAdminAction, (req, res) => User.assignManager(req, res));
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
    const clientId = req.user!.userId;
    const product = await Product.get(req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found" });
    if (product.clientId !== clientId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    // Cascade: remove the catalogue record AND everything that hangs off it —
    // inventory movements and forecast snapshots. Documents (invoices, orders,
    // GRNs, dispatches, quotations) keep their own snapshot copies untouched.
    const movementsDeleted = await StockMovement.removeByProduct(clientId, product.id);
    const { removeAllForProduct } = await import("../models/forecast-variable.js");
    const forecastsDeleted = await removeAllForProduct(clientId, product.id);
    await Product.remove(product.id);
    recomputeForecast(clientId);
    res.json({ success: true, movementsDeleted, forecastsDeleted });
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

    const isSystemFlow = !!(body.invoiceId || body.goodsReceiptId || body.purchaseInvoiceId || body.goodsDispatchId);

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
    trackAction(req, "stock.created", item.id, {
      entityType: "stock",
      entityRef: item.sku ?? item.itemName,
      direction: item.direction,
      quantity: item.quantity,
      reason: item.reason ?? null,
      status: item.status,
    });
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
    if (current.goodsReceiptId || current.invoiceId || current.purchaseInvoiceId || current.goodsDispatchId) {
      return res.status(400).json({ error: "This movement is created by its linked document — manage it from the GRN, invoice or dispatch instead" });
    }
    if (current.status === "cancelled") {
      return res.status(400).json({ error: "Cannot confirm a cancelled movement" });
    }
    const flipped = await StockMovement.confirm(current.id, req.user!.userId, req.user!.email);
    trackAction(req, "stock.confirmed", current.id, {
      entityType: "stock",
      entityRef: current.sku ?? current.itemName,
      direction: current.direction,
      quantity: current.quantity,
    });
    if (!flipped) return res.json({ ...current, alreadyConfirmed: true });
    recomputeForecast(clientId);
    res.json(flipped);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/** POST /stock-movements/:id/cancel — cancel a manual movement (drafts or confirmed). */
router.post("/stock-movements/:id/cancel", authMiddleware, async (req, res) => {
  try {
    const clientId = req.user!.userId;
    const current = await StockMovement.get(req.params.id);
    if (!current) return res.status(404).json({ error: "Movement not found" });
    if (current.clientId !== clientId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (current.goodsReceiptId || current.invoiceId || current.purchaseInvoiceId || current.goodsDispatchId) {
      return res.status(400).json({ error: "This movement is created by its linked document — cancel the GRN, invoice or dispatch instead" });
    }
    if (current.status === "cancelled") return res.json({ ...current, alreadyCancelled: true });
    // Atomic → cancelled flip: exactly one concurrent cancel wins.
    const flipped = await StockMovement.cancel(current.id, req.user!.userId, req.user!.email);
    trackAction(req, "stock.cancelled", current.id, {
      entityType: "stock",
      entityRef: current.sku ?? current.itemName,
      direction: current.direction,
      quantity: current.quantity,
    });
    if (!flipped) return res.json({ ...current, alreadyCancelled: true });
    // No reversal entry is ever created. Live stock only counts CONFIRMED
    // movements — a cancelled entry simply drops out of the balance, so its
    // effect is removed automatically (a cancelled +100 credit leaves the
    // balance at 0, not −100).
    recomputeForecast(clientId);
    res.json(flipped);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete("/stock-movements/:id", authMiddleware, async (req, res) => {
  try {
    const clientId = req.user!.userId;
    const current = await StockMovement.get(req.params.id);
    if (current) {
      if (current.clientId !== clientId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (current.goodsReceiptId || current.invoiceId || current.purchaseInvoiceId || current.goodsDispatchId) {
        return res.status(400).json({ error: "This movement is created by its linked document — manage it from the GRN, invoice or dispatch instead" });
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

/**
 * PUT /stock-movements/:id — edit a MANUAL movement (drafts or confirmed).
 * Live stock & inventory value recompute from the corrected entry because they
 * are always derived from the movement list. System-created movements (linked
 * to a GRN / invoice / purchase invoice / dispatch) are managed from their
 * source document, and cancelled movements are closed — neither can be edited.
 */
router.put("/stock-movements/:id", authMiddleware, async (req, res) => {
  try {
    const clientId = req.user!.userId;
    const current = await StockMovement.get(req.params.id);
    if (!current) return res.status(404).json({ error: "Movement not found" });
    if (current.goodsReceiptId || current.invoiceId || current.purchaseInvoiceId || current.goodsDispatchId) {
      return res.status(400).json({ error: "This movement is created by its linked document — manage it from the GRN, invoice or dispatch instead" });
    }
    if (current.status === "cancelled") {
      return res.status(400).json({ error: "Cancelled movements cannot be edited" });
    }
    const body = req.body || {};

    // Same strict validation as manual creation.
    if (body.quantity !== undefined && !(Number(body.quantity) > 0)) {
      return res.status(400).json({ error: "Quantity must be greater than zero" });
    }
    if (body.direction !== undefined && !["in", "out"].includes(body.direction)) {
      return res.status(400).json({ error: "Direction must be Credit (in) or Debit (out)" });
    }
    if (body.reason !== undefined && !MANUAL_MOVEMENT_REASONS.includes(body.reason)) {
      return res.status(400).json({ error: "Manual entries require a movement reason — Opening stock, Stock adjustment, Damage, Samples / internal use, Customer return or Supplier return" });
    }
    if (body.notes !== undefined && !String(body.notes).trim()) {
      return res.status(400).json({ error: "Notes are required for every manual inventory entry" });
    }
    if (body.unitCost !== undefined && body.unitCost !== null && body.unitCost !== "") {
      const uc = Number(body.unitCost);
      if (!Number.isFinite(uc) || uc < 0) {
        return res.status(400).json({ error: "Unit cost must be greater than or equal to zero" });
      }
      body.unitCost = uc;
    }
    // Changing the product re-snapshots SKU / name / unit from the catalogue
    // (users never type those — the item identity always comes from the product).
    if (body.productId !== undefined && body.productId !== current.productId) {
      const product = await Product.get(body.productId);
      if (!product) return res.status(400).json({ error: "The selected catalogue product no longer exists" });
      body.itemName = product.name;
      body.sku = product.sku;
      body.unit = product.unitOfMeasure || "unit";
    }

    const updated = await StockMovement.update(current.id, body);
    recomputeForecast(clientId);
    res.json(updated);
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
router.get("/invoices/:id/remind-debtor/:token", publicTokenLimiter, async (req, res) => {
  try {
    const { sendReminderToDebtor } = await import("../invoice-reminder.js");
    const result = await sendReminderToDebtor(req.params.id, req.params.token);
    if (result.success) {
      res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Reminder Sent</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f5f7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:16px;} .card{background:#fff;border-radius:12px;padding:32px;max-width:480px;box-shadow:0 1px 3px rgba(0,0,0,0.08);text-align:center;} h1{font-size:20px;color:#059669;margin:0 0 8px;} p{font-size:14px;color:#64748b;margin:0 0 4px;line-height:1.5;} .emoji{font-size:48px;margin-bottom:12px;}</style></head><body><div class="card"><div class="emoji">✅</div><h1>Reminder Forwarded!</h1><p>${result.message}</p></div></body></html>`);
    } else {
      res.status(400).send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f5f7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:16px;} .card{background:#fff;border-radius:12px;padding:32px;max-width:480px;box-shadow:0 1px 3px rgba(0,0,0,0.08);text-align:center;} h1{font-size:20px;color:#dc2626;margin:0 0 8px;} p{font-size:14px;color:#64748b;margin:0 0 4px;line-height:1.5;} .emoji{font-size:48px;margin-bottom:12px;}</style></head><body><div class="card"><div class="emoji">❌</div><h1>Could Not Send Reminder</h1><p>${result.message}</p></div></body></html>`);
    }
  } catch (err: any) {
    console.error("[remind-debtor] Failed to send reminder:", err);
    res.status(500).send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error</title></head><body><h1>Error</h1><p>Something went wrong. Please try again later.</p></body></html>`);
  }
});

/**
 * Validate sales-invoice lines against the product catalogue and snapshot them.
 * SKUs must come from the catalogue; quantity > 0 and unit price >= 0.
 * Creating an invoice NEVER creates inventory — only a confirmed dispatch debits.
 */
async function validateInvoiceLines(clientId: string, rawLines: any[]) {
  const lines = Array.isArray(rawLines) ? rawLines : [];
  if (lines.length === 0) throw new Error("Add at least one product line");
  const products = await Product.list(clientId);
  const catalogueIds = new Set(products.map((p: any) => p.id));
  for (const l of lines) {
    if (!l.productId) throw new Error("Every line must select a product from the catalogue");
    if (!catalogueIds.has(l.productId)) throw new Error("Every SKU must come from the product catalogue");
    if (!(Number(l.quantity) > 0)) throw new Error("Quantity must be greater than zero");
    if (Number(l.unitPrice) < 0) throw new Error("Unit selling price must be greater than or equal to zero");
  }
  return lines;
}

/**
 * Resolve the proforma linked to an invoice (sales: customer proforma, or
 * purchase: supplier proforma) and compute the advance deduction from the
 * recorded advances (server-side, never trusted from the client). Prefers the
 * formal linked-proforma id; falls back to matching the typed PO number
 * against proformas of the given side. Returns null when there is nothing to
 * link; throws when a formal link is invalid.
 */
async function resolveProformaForInvoice(
  clientId: string,
  body: any,
  side: "sales" | "purchase",
) {
  const formalId: string | null | undefined =
    body.linkedCustomerProformaId ?? body.linkedSupplierProformaId;
  const poNumber: string | null | undefined = body.poNumber;
  const linkName = side === "sales" ? "customer proforma" : "supplier proforma";
  let pfId: string | null = formalId || null;
  let pfNumber: string | null = null;
  let pf: any = null;
  if (!pfId) {
    const needle = String(poNumber ?? "").trim();
    if (!needle) return null;
    const orders = await PurchaseOrder.list(clientId);
    const matches = (orders as any[]).filter(
      (p) =>
        p.side === side &&
        (String(p.proformaNumber ?? "") === needle || String(p.poNumber ?? "") === needle),
    );
    // Multiple/no match by number → manual PO entry, no formal link.
    if (matches.length !== 1) {
      return { proformaId: null, proformaNumber: null, advanceDeducted: 0 };
    }
    pfId = matches[0].id;
    pf = matches[0];
    pfNumber = matches[0].proformaNumber ?? matches[0].poNumber ?? null;
  } else {
    pf = await PurchaseOrder.get(pfId);
    if (!pf) throw new Error(`Linked ${linkName} not found`);
    if (pf.side !== side) throw new Error(`The linked proforma is not a ${side} proforma`);
    pfNumber = pf.proformaNumber ?? pf.poNumber ?? null;
  }
  const advances = await Advance.list(clientId);
  const paid = (advances as any[])
    .filter((a) => a.side === side && a.purchaseOrderId === pfId && a.status !== "refunded")
    .reduce((s: number, a: any) => s + (Number(a.amount) || 0), 0);
  // The proforma's agreed advance % (set when it was created from a purchase
  // order) drives the deduction too — it covers the expected advance even
  // before treasury has funded it. Whichever is larger (agreed % vs the
  // amount actually paid) is what is deducted.
  const pctAdvance =
    Number(pf?.advancePct) > 0
      ? Math.round(
          ((Number(pf.poAmount) || Number(pf.amount) || 0) * Number(pf.advancePct)) / 100 * 100,
        ) / 100
      : 0;
  return {
    proformaId: pfId,
    proformaNumber: pfNumber,
    advanceDeducted: Math.round(Math.max(paid, pctAdvance) * 100) / 100,
  };
}

/**
 * Validate a sales invoice against its linked sales order: the SO must be
 * confirmed/open (never draft or cancelled), the invoice customer must be the
 * SO customer, and every line must reference a product on the SO with a
 * quantity that fits the ordered quantity.
 */
function assertInvoiceMatchesSO(so: any, lines: any[], debtorId: string | null) {
  if (!so) throw new Error("Linked sales order not found");
  if (so.status === "cancelled") throw new Error("Cannot invoice against a cancelled sales order");
  if (so.status === "draft") throw new Error("Confirm the sales order before invoicing");
  if (debtorId && so.customerId && debtorId !== so.customerId) {
    throw new Error("The invoice customer must match the linked sales order's customer");
  }
  for (const l of lines) {
    if (!l.productId) continue; // catalogue check validates product selection
    const soLine = (so.lines ?? []).find((x: any) => x.productId === l.productId);
    if (!soLine) {
      throw new Error(`"${l.name || l.productId}" is not on the linked sales order`);
    }
    const qty = Number(l.quantity) || 0;
    if (qty > Number(soLine.orderedQty)) {
      throw new Error(
        `Invoice quantity for ${soLine.name} (${qty}) exceeds the ordered quantity (${Number(soLine.orderedQty)}) on the sales order`,
      );
    }
  }
}

router.get("/invoices", authMiddleware, async (req, res) => {
  try {
    // ?scope=all returns every client's invoices — used by the shared dashboard.
    const scopeAll = req.query.scope === "all";
    res.json(await Invoice.list(scopeAll ? undefined : req.user!.userId));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.get("/invoices/:id", authMiddleware, async (req, res) => {
  try {
    const item = await Invoice.get(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });
    res.json(item);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /invoices/:id/send-noa — email the Notice of Assignment to the buyer
 * (debtor) with the invoice PDF attached, then mark the NOA as sent.
 */
router.post("/invoices/:id/send-noa", authMiddleware, async (req, res) => {
  try {
    const inv = await Invoice.get(req.params.id);
    if (!inv) return res.status(404).json({ error: "Invoice not found" });
    // Only the invoice owner or an admin may email the NOA.
    const userRoles = req.user!.roles || [];
    const isAdmin = userRoles.includes("factor_admin");
    if (!isAdmin && inv.clientId !== req.user!.userId) {
      return res.status(403).json({ error: "Only the invoice owner or an admin can send the NOA" });
    }
    const debtor = inv.debtorId ? await Debtor.get(inv.debtorId) : null;
    const email = debtor?.contactEmail?.trim() || null;
    if (!email) {
      return res.status(400).json({
        error: `No contact email on file for "${debtor?.name || "the debtor"}" — add one in the Debtors tab first`,
      });
    }

    const { isEmailConfigured } = await import("../email.js");
    if (!isEmailConfigured()) {
      return res.status(400).json({
        error: "SMTP is not configured — set SMTP_HOST / SMTP_USER / SMTP_PASS to send the NOA email",
      });
    }

    if (!inv.noaToken) {
      return res.status(400).json({ error: "Invoice has no NOA token — cannot build the verification link" });
    }

    // Build the invoice PDF (white background, "Adventra" branding, debtor details).
    const company = await resolveCompanyName(inv.clientId);
    const companyName = "Adventra";
    const { invoiceToPdfData, buildInvoicePdf } = await import("../lib/document-pdf.js");
    const pdfData = invoiceToPdfData(inv, debtor, companyName, company.contact);
    const pdf = await buildInvoicePdf(pdfData);

    const filename = `${pdfData.number.replace(/[^A-Za-z0-9-_]/g, "_")}.pdf`;
    const noaUrl = `${config.appUrl}/noa/${inv.noaToken}`;
    const { sendInvoiceNoaEmail } = await import("../email.js");
    const sent = await sendInvoiceNoaEmail({
      invoiceNumber: inv.invoiceNumber,
      amount: pdfData.grandTotal,
      dueDate: inv.dueDate || null,
      issueDate: inv.issueDate || null,
      debtorName: debtor?.name || "Customer",
      debtorEmail: email,
      companyName,
      noaUrl,
      pdfBuffer: pdf,
      pdfFilename: filename,
    });
    if (!sent) {
      return res.status(400).json({ error: "Failed to send the email — check the SMTP configuration" });
    }

    const updated = await Invoice.update(inv.id, {
      noaStatus: "sent",
      noaSentAt: db.nowISO(),
    });

    // Audit trail — consistent with the reminder flow.
    try {
      await ReminderLog.create({
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        type: "sales",
        recipient: "debtor",
        recipientEmail: email,
        daysUntilDue: 0,
        isOverdue: false,
        status: "sent",
        counterpartyName: debtor?.name || "",
        kind: "noa",
      });
    } catch (err) {
      console.error(`  ⚠ Failed to create NOA reminder log for ${inv.invoiceNumber}:`, err);
    }

    res.json({ success: true, sentTo: email, invoice: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /invoices — create a sales invoice (draft by default).
 * IMPORTANT: creating an invoice NEVER reduces stock. Stock is only debited
 * when a Dispatch note is confirmed — the invoice merely bills the customer
 * after the goods have been dispatched.
 */
router.post("/invoices", authMiddleware, async (req, res) => {
  try {
    const clientId = req.user!.userId;
    const body = req.body || {};
    if (!body.debtorId) return res.status(400).json({ error: "Select a customer" });
    // Goods invoices always carry catalogue lines.
    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      return res.status(400).json({ error: "Add at least one product line" });
    }
    try { body.lines = await validateInvoiceLines(clientId, body.lines); } catch (e: any) { return res.status(400).json({ error: e.message }); }
    // The sales order link is MANDATORY: every invoice bills against a
    // confirmed sales order, and its lines must come from that order.
    if (!body.goodsSalesOrderId) return res.status(400).json({ error: "A linked sales order is required" });
    const so = await GoodsSO.get(body.goodsSalesOrderId);
    if (!so) return res.status(404).json({ error: "Linked sales order not found" });
    try {
      assertInvoiceMatchesSO(so, body.lines ?? [], body.debtorId);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
    if (!body.goodsSalesOrderNumber) body.goodsSalesOrderNumber = so.soNumber;
    // Resolve the linked customer proforma (formal field or PO-number match)
    // and compute the advance deduction server-side from the recorded advances.
    if (body.linkedCustomerProformaId || body.poNumber) {
      try {
        const pf = await resolveProformaForInvoice(clientId, body, "sales");
        if (pf) {
          body.linkedCustomerProformaId = pf.proformaId;
          body.linkedCustomerProformaNumber = pf.proformaNumber;
          body.advanceDeducted = pf.advanceDeducted;
        }
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }
    }
    const item = await Invoice.create({
      ...body,
      clientId,
      invoiceNumber: body.invoiceNumber || `INV-${uuid().slice(0, 8).toUpperCase()}`,
      status: body.status || "draft",
    });
    trackAction(req, "invoice.created", item.id, {
      entityType: "invoice",
      entityRef: item.invoiceNumber,
      amount: item.amount,
      status: item.status,
      clientId,
    });
    // Instant reminder check: if due date is close or past, send reminder immediately
    if (item.dueDate && item.status !== "paid" && item.status !== "rejected" && item.status !== "draft") {
      const { sendReminderForInvoice } = await import("../invoice-reminder.js");
      // Fire-and-forget — don't block the response
      sendReminderForInvoice(item.id, "sales").catch((err: any) =>
        console.error(`  ⚠ Instant reminder trigger failed for ${item.invoiceNumber}:`, err)
      );
    }
    res.status(201).json(item);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/** POST /invoices/:id/issue — flip a draft into the review queue (Issued). */
router.post("/invoices/:id/issue", authMiddleware, async (req, res) => {
  try {
    const current = await Invoice.get(req.params.id);
    if (!current) return res.status(404).json({ error: "Invoice not found" });
    if (current.status === "cancelled") return res.status(400).json({ error: "Cannot issue a cancelled invoice" });
    if (current.status === "paid") return res.status(400).json({ error: "Invoice is already paid" });
    // Idempotent re-issue: an already-issued invoice just stays issued.
    if (current.status !== "draft") return res.json({ ...current, alreadyIssued: true });
    // Every invoice that enters the review/funding queue must be backed by a
    // confirmed sales order — legacy drafts without a link cannot be issued.
    if (!current.goodsSalesOrderId) {
      return res.status(400).json({ error: "Link a confirmed sales order before issuing this invoice" });
    }
    const issueSo = await GoodsSO.get(current.goodsSalesOrderId);
    if (!issueSo || issueSo.status === "cancelled") {
      return res.status(400).json({ error: "Cannot issue an invoice linked to a cancelled sales order" });
    }
    if (issueSo.status === "draft") {
      return res.status(400).json({ error: "Confirm the sales order before issuing this invoice" });
    }
    const updated = await Invoice.update(current.id, { status: "pending" });
    trackAction(req, "invoice.issued", current.id, {
      entityType: "invoice",
      entityRef: current.invoiceNumber,
      status: "pending",
    });
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/** POST /invoices/:id/payment — record a customer payment (treasury/admin). */
router.post("/invoices/:id/payment", authMiddleware, async (req, res) => {
  try {
    const roles: string[] = req.user!.roles || [];
    if (!roles.includes("factor_admin") && !roles.includes("treasury")) {
      return res.status(403).json({ error: "Only treasury/admin can record payments" });
    }
    const current = await Invoice.get(req.params.id);
    if (!current) return res.status(404).json({ error: "Invoice not found" });
    if (current.status === "draft") {
      return res.status(400).json({ error: "Issue the invoice before recording payments" });
    }
    if (current.status === "cancelled") {
      return res.status(400).json({ error: "Cannot record a payment on a cancelled invoice" });
    }
    if (current.status === "paid") {
      return res.status(400).json({ error: "Invoice is already paid" });
    }
    const amt = Number(req.body?.amountReceived);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: "Payment amount must be greater than zero" });
    }
    const updated = await Invoice.recordPayment(req.params.id, amt, req.body?.receiptDate || db.todayDate());
    trackAction(req, "invoice.payment", current.id, {
      entityType: "invoice",
      entityRef: current.invoiceNumber,
      amountReceived: amt,
      amountPaid: updated?.amountPaid ?? 0,
    });
    res.json(updated);
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
    if (req.body.status === "cancelled") {
      const userRoles = req.user!.roles || [];
      const isAdmin = userRoles.includes("factor_admin");
      const isCreator = req.user!.userId === (await Invoice.get(req.params.id))?.clientId;
      if (!isAdmin && !isCreator) {
        return res.status(403).json({ error: "Only the creator or an admin can cancel an invoice" });
      }
      const current = await Invoice.get(req.params.id);
      if (current && !["draft", "pending"].includes(current.status)) {
        return res.status(400).json({ error: "Only draft or issued invoices can be cancelled" });
      }
    }
    const body = req.body || {};
    const current = await Invoice.get(req.params.id);
    if (!current) return res.status(404).json({ error: "Invoice not found" });
    // Closed invoices are frozen for content edits (payment/status only).
    if (current.status === "paid" || current.status === "cancelled") {
      const frozen = ["lines", "freight", "amount", "debtorId", "invoiceNumber", "issueDate", "dueDate", "goodsSalesOrderId", "billingAddress", "deliveryAddress", "paymentTerms", "customerContact", "notes", "documents", "poNumber", "poAmount", "linkedCustomerProformaId", "linkedCustomerProformaNumber", "advanceDeducted"];
      if (frozen.some((k) => (body as any)[k] !== undefined)) {
        return res.status(400).json({ error: `A ${current.status} invoice cannot be edited` });
      }
    }
    // Content edits are restricted to draft (and light edits on issued).
    if (body.lines !== undefined) {
      let lines: any[];
      try { lines = await validateInvoiceLines(req.user!.userId, body.lines); } catch (e: any) { return res.status(400).json({ error: e.message }); }
      body.lines = lines;
    }
    // The sales order link is MANDATORY for content edits — validate against
    // the SO whenever the order, lines or customer are touched. Status and
    // payment transitions (checker/treasury) keep working on legacy invoices.
    const contentEdit =
      body.lines !== undefined ||
      body.goodsSalesOrderId !== undefined ||
      body.debtorId !== undefined;
    if (contentEdit) {
      const soId = body.goodsSalesOrderId || current.goodsSalesOrderId;
      if (!soId) return res.status(400).json({ error: "A linked sales order is required" });
      const so = await GoodsSO.get(soId);
      if (!so) return res.status(404).json({ error: "Linked sales order not found" });
      try {
        assertInvoiceMatchesSO(
          so,
          body.lines !== undefined ? body.lines : current.lines ?? [],
          body.debtorId !== undefined ? body.debtorId : current.debtorId,
        );
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }
      if (body.goodsSalesOrderId && !body.goodsSalesOrderNumber) body.goodsSalesOrderNumber = so.soNumber;
    }
    // Re-resolve the linked proforma when the link or PO number changes.
    if (body.linkedCustomerProformaId !== undefined || body.poNumber !== undefined) {
      try {
        const merged = { ...current, ...body } as any;
        const pf = await resolveProformaForInvoice(req.user!.userId, merged, "sales");
        if (pf) {
          body.linkedCustomerProformaId = pf.proformaId;
          body.linkedCustomerProformaNumber = pf.proformaNumber;
          body.advanceDeducted = pf.advanceDeducted;
        }
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }
    }
    const updated = await Invoice.update(req.params.id, body);
    // Audit trail — record checker/admin decisions and cancellations.
    if (req.body.status && req.body.status !== current.status) {
      const s = String(req.body.status);
      if (["approved", "rejected", "disputed", "cancelled"].includes(s)) {
        trackAction(req, `invoice.${s}`, current.id, {
          entityType: "invoice",
          entityRef: current.invoiceNumber,
          status: s,
          prevStatus: current.status,
        });
      }
    }
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
  try {
    const current = await Invoice.get(req.params.id);
    if (current && current.status !== "draft") {
      return res.status(400).json({ error: "Only draft invoices can be deleted — cancel instead" });
    }
    await Invoice.remove(req.params.id);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
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
  try {
    // ?scope=all returns every client's purchase invoices — used by the shared dashboard.
    const scopeAll = req.query.scope === "all";
    res.json(await PurchaseInvoice.list(scopeAll ? undefined : req.user!.userId));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
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
    if (po.status === "draft") {
      return res.status(400).json({ error: "Approve and send the purchase order before invoicing" });
    }
    try { body.lines = validatePurchaseInvoiceLines(po, body.lines); }
    catch (e: any) { return res.status(400).json({ error: e.message }); }
    body.goodsPoNumber = po.poNumber;
    // Optional supplier-proforma link → advance deduction (server-side).
    if (body.linkedSupplierProformaId || body.poNumber) {
      try {
        const pf = await resolveProformaForInvoice(clientId, body, "purchase");
        if (pf) {
          body.linkedSupplierProformaId = pf.proformaId;
          body.linkedSupplierProformaNumber = pf.proformaNumber;
          body.advanceDeducted = pf.advanceDeducted;
        }
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }
    }
    const item = await PurchaseInvoice.create({ ...body, clientId, vendorId: body.vendorId });
    trackAction(req, "purchase_invoice.created", item.id, {
      entityType: "purchase_invoice",
      entityRef: item.invoiceNumber,
      amount: item.amount,
      status: item.status,
      supplier: item.supplierName,
    });
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
      const frozen = ["lines", "freight", "vendorId", "invoiceNumber", "issueDate", "receivedDate", "dueDate", "goodsPurchaseOrderId", "notes", "documents", "linkedSupplierProformaId", "linkedSupplierProformaNumber", "advanceDeducted"];
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
        if (linkedPo?.status === "draft") {
          return res.status(400).json({ error: "Approve and send the purchase order before invoicing" });
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
    // Optional supplier-proforma link → recompute the advance deduction when
    // the link or PO number changes.
    if (body.linkedSupplierProformaId !== undefined || body.poNumber !== undefined) {
      try {
        const merged = { ...current, ...body } as any;
        const pf = await resolveProformaForInvoice(req.user!.userId, merged, "purchase");
        if (pf) {
          body.linkedSupplierProformaId = pf.proformaId;
          body.linkedSupplierProformaNumber = pf.proformaNumber;
          body.advanceDeducted = pf.advanceDeducted;
        }
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
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
    // Audit trail — record treasury payment recording (amountPaid delta).
    if (body.amountPaid !== undefined && Number(body.amountPaid) !== Number(current.amountPaid ?? 0)) {
      trackAction(req, "purchase_invoice.payment", current.id, {
        entityType: "purchase_invoice",
        entityRef: current.invoiceNumber,
        amountPaid: Number(body.amountPaid) || 0,
        prevAmountPaid: Number(current.amountPaid ?? 0),
      });
    }
    // Audit trail — record workflow status transitions.
    if (body.status && body.status !== current.status) {
      const s = String(body.status);
      const actionByStatus = {
        verified: "purchase_invoice.verified",
        approved_for_payment: "purchase_invoice.approved",
        paid: "purchase_invoice.paid",
        partially_paid: "purchase_invoice.partially_paid",
        cancelled: "purchase_invoice.cancelled",
      } as Record<string, string>;
      if (actionByStatus[s]) {
        trackAction(req, actionByStatus[s], current.id, {
          entityType: "purchase_invoice",
          entityRef: current.invoiceNumber,
          status: s,
          prevStatus: current.status,
          amount: current.amount,
        });
      }
    }
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
    // Advance % must be a sane 0–100 value (drives the calculated advance).
    if (
      body.advancePct !== undefined &&
      body.advancePct !== null &&
      (Number(body.advancePct) < 0 || Number(body.advancePct) > 100)
    ) {
      return res.status(400).json({ error: "Advance percentage must be between 0 and 100" });
    }
    // Recording a proforma always submits it to the checker for review — the
    // funding workflow is maker → checker approval → treasury funding.
    body.proformaStatus = "pending_review";
    const item = await PurchaseOrder.create({ ...body, clientId: req.user!.userId });
    trackAction(req, "proforma.created", item.id, {
      entityType: "proforma",
      entityRef: item.proformaNumber ?? item.poNumber,
      side: item.side,
      amount: item.poAmount ?? item.amount,
      status: item.proformaStatus,
    });
    res.status(201).json(item);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.put("/purchase-orders/:id", authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    const current = await PurchaseOrder.get(req.params.id);
    if (!current) return res.status(404).json({ error: "Proforma not found" });

    // ── Maker–checker–treasury funding workflow (enforced server-side) ──
    // pending_review (maker) → approved/rejected (checker) → funded (treasury).
    if (body.proformaStatus !== undefined) {
      const roles: string[] = req.user!.roles || [];
      const isAdmin = roles.includes("factor_admin");
      const isChecker = roles.includes("checker");
      const isTreasury = roles.includes("treasury");
      switch (body.proformaStatus) {
        case "approved":
        case "rejected": {
          if (!isAdmin && !isChecker) {
            return res.status(403).json({ error: "Only the checker (or admin) can approve or reject proformas" });
          }
          if (!isAdmin && current.clientId === req.user!.userId) {
            return res.status(403).json({ error: "You cannot review a proforma you created (segregation of duties)" });
          }
          if (current.proformaStatus === "funded") {
            return res.status(400).json({ error: "This proforma is already funded" });
          }
          body.proformaReviewedBy = req.user!.userId;
          body.proformaReviewedAt = db.nowISO();
          break;
        }
        case "funded": {
          if (!isAdmin && !isTreasury) {
            return res.status(403).json({ error: "Only treasury (or admin) can fund proformas" });
          }
          // Funding is the terminal step of the workflow — it requires the
          // checker's approval first.
          if (current.proformaStatus !== "approved") {
            return res.status(400).json({ error: "Proforma must be approved by the checker before it can be funded" });
          }
          if (body.proformaFundedBy === undefined) body.proformaFundedBy = req.user!.userId;
          if (body.proformaFundedAt === undefined) body.proformaFundedAt = db.nowISO();
          break;
        }
        case "pending_review": {
          // Maker (re-)submits — allowed from draft or after a rejection.
          if (["approved", "funded"].includes(current.proformaStatus)) {
            return res.status(400).json({ error: "This proforma is already approved or funded" });
          }
          break;
        }
        default:
          return res.status(400).json({ error: "proformaStatus must be pending_review, approved, rejected or funded" });
      }
    }

    // Converting to a purchase order or sales order requires the checker's
    // approval first (both conversion statuses are gated — `status` is not
    // part of the frozen content, so this is the only guard on it).
    if (
      (body.status === "converted_to_po" || body.status === "converted_to_so") &&
      current.proformaStatus !== "approved"
    ) {
      return res.status(400).json({ error: "Proforma must be approved by the checker before converting to a purchase or sales order" });
    }

    // Content (lines, amounts, parties, attachments…) is frozen once the
    // proforma enters the review pipeline (or is approved/funded) — only
    // workflow transitions may touch the document then. This holds even when
    // the payload carries a proformaStatus decision, so a checker's
    // approve/reject (or treasury's fund) cannot smuggle content edits through.
    // A checker rejection reopens it for the maker to fix and resubmit.
    const contentKeys = [
      "lines", "amount", "poAmount", "freight", "documents", "proformaNumber",
      "proformaDate", "debtorId", "vendorId", "issueDate", "expectedDate",
      "validUntil", "paymentTerms", "expectedDeliveryDate", "notes", "debtorContact",
      "debtorGstin", "supplierContact", "supplierGstin", "poNumber",
      "linkedGoodsPoId", "linkedGoodsSoId", "advancePct",
    ];
    const frozen = ["pending_review", "approved", "funded"].includes(current.proformaStatus ?? "");
    // Converting an approved proforma carries its linked PO/SO id along with
    // the status transition — that link is part of the conversion, not a
    // content edit, so it is exempt from the freeze.
    const converting =
      body.status === "converted_to_po" || body.status === "converted_to_so";
    const freezeBlocked = contentKeys.some(
      (k) =>
        (body as any)[k] !== undefined &&
        !(converting && (k === "linkedGoodsPoId" || k === "linkedGoodsSoId")),
    );
    if (frozen && freezeBlocked) {
      return res.status(400).json({
        error: "Proforma is under review or already approved — content cannot be edited until the checker decides (a rejection reopens it for changes)",
      });
    }

    if (body.lines !== undefined) {
      try { body.lines = await validateProformaLines(req.user!.userId, body.lines); }
      catch (e: any) { return res.status(400).json({ error: e.message }); }
    }
    const updated = await PurchaseOrder.update(req.params.id, body);
    // Audit trail — record maker/checker/treasury workflow transitions.
    if (body.proformaStatus !== undefined && body.proformaStatus !== current.proformaStatus) {
      const s = String(body.proformaStatus);
      const actionByStatus = {
        pending_review: "proforma.submitted",
        approved: "proforma.approved",
        rejected: "proforma.rejected",
        funded: "proforma.funded",
      } as Record<string, string>;
      if (actionByStatus[s]) {
        trackAction(req, actionByStatus[s], current.id, {
          entityType: "proforma",
          entityRef: current.proformaNumber ?? current.poNumber,
          side: current.side,
          status: s,
          prevStatus: current.proformaStatus,
          amount: current.poAmount ?? current.amount,
        });
      }
    }
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.delete("/purchase-orders/:id", authMiddleware, async (req, res) => {
  try { await PurchaseOrder.remove(req.params.id); res.json({ success: true }); } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /purchase-orders/:id/convert-to-so — turn a sales proforma into a DRAFT
 * sales order. The SO is auto-created from the proforma's header + catalogue
 * lines (draft — no stock impact; only a confirmed dispatch ever debits
 * inventory) and the proforma is marked "converted_to_so" + linked by id.
 */
router.post("/purchase-orders/:id/convert-to-so", authMiddleware, async (req, res) => {
  try {
    const clientId = req.user!.userId;
    const pf = await PurchaseOrder.get(req.params.id);
    if (!pf) return res.status(404).json({ error: "Proforma not found" });
    if (pf.side !== "sales") {
      return res.status(400).json({ error: "Only sales proformas can be converted to a sales order" });
    }
    if (pf.status === "converted_to_so") {
      return res.status(400).json({ error: "Proforma is already converted to a sales order" });
    }
    if (!["received", "reviewed"].includes(pf.status)) {
      return res.status(400).json({ error: "Only received or reviewed proformas can be converted to a sales order" });
    }
    // Conversion is gated on the checker's approval (same as the purchase side).
    if (pf.proformaStatus !== "approved") {
      return res.status(400).json({ error: "Proforma must be approved by the checker before converting to a sales order" });
    }
    const lines: any[] = (pf.lines ?? []).map((l: any) => ({
      productId: l.productId,
      sku: l.sku,
      name: l.name,
      unit: l.unit || "unit",
      orderedQty: Number(l.quantity) || 0,
      dispatchedQty: 0,
      unitPrice: Number(l.unitPrice) || 0,
      discountPct: null,
      gstRate: l.gstRate ?? null,
      notes: null,
    }));
    if (lines.length === 0) {
      return res.status(400).json({ error: "Add at least one product line before converting" });
    }
    const customerName = pf.debtorId ? await resolveCustomerName(pf.debtorId) : null;
    const so = await GoodsSO.create({
      clientId,
      orderDate: db.todayDate(),
      customerId: pf.debtorId || null,
      customerName,
      contactPerson: pf.debtorContact || null,
      paymentTerms: pf.paymentTerms || null,
      expectedDispatchDate: null,
      expectedDeliveryDate: pf.expectedDeliveryDate || null,
      notes: pf.notes || null,
      documents: pf.documents || [],
      freight: pf.freight || 0,
      status: "draft",
      lines,
    });
    await PurchaseOrder.update(pf.id, { status: "converted_to_so", linkedGoodsSoId: so.id });
    res.status(201).json({ success: true, salesOrder: so });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
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
      // buyerId always records the actual creator; buyerName is a free-text
      // "Buyer / created by" display field the user may set to anything.
      // An explicit empty value is honored (user cleared the field); the
      // signed-in email is only the fallback when no value was sent at all.
      buyerId: req.user!.userId,
      buyerName: body.buyerName !== undefined ? body.buyerName : req.user!.email,
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
    trackAction(req, "grn.confirmed", receipt.id, {
      entityType: "grn",
      entityRef: receipt.receiptNumber,
      poNumber: receipt.poNumber,
      lines: receipt.lines?.length ?? 0,
    });
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
    trackAction(req, "grn.cancelled", receipt.id, {
      entityType: "grn",
      entityRef: receipt.receiptNumber,
      poNumber: receipt.poNumber,
      wasCredited,
    });
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

// ===================== GOODS SALES ORDERS (catalogue-backed SOs) =====================
// A sales order records a customer's confirmed order against the catalogue. It
// NEVER debits inventory — stock only reduces after a CONFIRMED dispatch note
// (the sales-side mirror of PO → GRN).

/** Shape + catalogue checks for SO lines. SKUs must come from the product catalogue. */
async function validateGoodsSOLines(clientId: string, rawLines: any[]) {
  const lines = Array.isArray(rawLines) ? rawLines : [];
  if (lines.length === 0) throw new Error("Add at least one product line");
  const products = await Product.list(clientId);
  const catalogueIds = new Set(products.map((p: any) => p.id));
  for (const l of lines) {
    if (!l.productId) throw new Error("Every line must select a product from the catalogue");
    if (!catalogueIds.has(l.productId)) throw new Error("Every SKU must come from the product catalogue");
    if (!(Number(l.orderedQty) > 0)) throw new Error("Ordered quantity must be greater than zero");
    if (Number(l.unitPrice) < 0) throw new Error("Unit selling price must be greater than or equal to zero");
    if (l.discountPct !== undefined && l.discountPct !== null && l.discountPct !== "") {
      const d = Number(l.discountPct);
      if (!Number.isFinite(d) || d < 0 || d > 100) {
        throw new Error("Discount must be a percentage between 0 and 100");
      }
    }
  }
  return lines;
}

/** Resolve a customer (debtor) id to its display name (denormalized). */
async function resolveCustomerName(id: string): Promise<string | null> {
  if (!id) return null;
  try {
    const d = await Debtor.get(id);
    if (d) return d.name;
  } catch { /* ignore */ }
  return null;
}

router.get("/goods-sales-orders", authMiddleware, async (req, res) => {
  try { res.json(await GoodsSO.list(req.user!.userId)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.post("/goods-sales-orders", authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    let lines: any[];
    try { lines = await validateGoodsSOLines(req.user!.userId, body.lines); } catch (e: any) { return res.status(400).json({ error: e.message }); }
    if (!body.customerName && body.customerId) body.customerName = await resolveCustomerName(body.customerId);
    const item = await GoodsSO.create({
      ...body, lines, clientId: req.user!.userId,
      salespersonId: req.user!.userId, salespersonName: req.user!.email,
    });
    res.status(201).json(item);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.put("/goods-sales-orders/:id", authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    if (body.lines !== undefined) {
      let lines: any[];
      try { lines = await validateGoodsSOLines(req.user!.userId, body.lines); } catch (e: any) { return res.status(400).json({ error: e.message }); }
      body.lines = lines;
    }
    if (body.customerName === undefined && body.customerId) body.customerName = await resolveCustomerName(body.customerId);
    res.json(await GoodsSO.update(req.params.id, body));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.delete("/goods-sales-orders/:id", authMiddleware, async (req, res) => {
  try { await GoodsSO.remove(req.params.id); res.json({ success: true }); } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===================== QUOTATIONS =====================
// A quotation is an offer to a customer/prospect. It NEVER affects inventory
// or accounting — stock is only affected after a confirmed dispatch. An
// accepted quotation converts into a GoodsSalesOrder (linked by id + number).

/** Shape + catalogue checks for quotation lines. SKUs must come from the product catalogue. */
async function validateQuotationLines(clientId: string, rawLines: any[]) {
  const lines = Array.isArray(rawLines) ? rawLines : [];
  if (lines.length === 0) throw new Error("Add at least one product line");
  const products = await Product.list(clientId);
  const catalogueIds = new Set(products.map((p: any) => p.id));
  for (const l of lines) {
    if (!l.productId) throw new Error("Every line must select a product from the catalogue");
    if (!catalogueIds.has(l.productId)) throw new Error("Every SKU must come from the product catalogue");
    if (!(Number(l.quantity) > 0)) throw new Error("Quantity must be greater than zero");
    if (Number(l.unitPrice) < 0) throw new Error("Unit selling price must be greater than or equal to zero");
    if (
      l.updatedUnitPrice !== undefined &&
      l.updatedUnitPrice !== null &&
      l.updatedUnitPrice !== "" &&
      (!Number.isFinite(Number(l.updatedUnitPrice)) || Number(l.updatedUnitPrice) < 0)
    ) {
      throw new Error("Updated unit price must be a number greater than or equal to zero");
    }
    // An empty-string "updated price" means no revision — normalize to null so
    // the model (typed number | null) never sees a string.
    if (l.updatedUnitPrice === "") l.updatedUnitPrice = null;
    if (l.discountType !== undefined && l.discountType !== null && !["pct", "amount"].includes(l.discountType)) {
      throw new Error("Discount type must be 'pct' or 'amount'");
    }
    if (l.discountType === "pct" && (Number(l.discountValue) < 0 || Number(l.discountValue) > 100)) {
      throw new Error("Percentage discount must be between 0 and 100");
    }
    if (l.discountType === "amount" && Number(l.discountValue) < 0) {
      throw new Error("Discount amount must be greater than or equal to zero");
    }
  }
  return lines;
}

router.get("/quotations", authMiddleware, async (req, res) => {
  try { res.json(await Quotation.list(req.user!.userId)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.get("/quotations/:id", authMiddleware, async (req, res) => {
  try {
    const item = await Quotation.get(req.params.id);
    if (!item) return res.status(404).json({ error: "Quotation not found" });
    res.json(item);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.post("/quotations", authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    let lines: any[];
    try { lines = await validateQuotationLines(req.user!.userId, body.lines); } catch (e: any) { return res.status(400).json({ error: e.message }); }
    if (!body.customerName && body.customerId) body.customerName = await resolveCustomerName(body.customerId);
    const item = await Quotation.create({
      ...body, lines, clientId: req.user!.userId,
      salespersonId: req.user!.userId, salespersonName: req.user!.email,
    });
    res.status(201).json(item);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.put("/quotations/:id", authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    const current = await Quotation.get(req.params.id);
    if (!current) return res.status(404).json({ error: "Quotation not found" });

    // ── Maker–checker price approval ──
    if (body.approvalStatus !== undefined) {
      if (body.approvalStatus === "approved" || body.approvalStatus === "rejected") {
        // Only the checker (or admin) may decide, and never on their own quote.
        const roles: string[] = req.user!.roles || [];
        const isAdmin = roles.includes("factor_admin");
        const isChecker = roles.includes("checker");
        if (!isAdmin && !isChecker) {
          return res.status(403).json({ error: "Only the checker (or admin) can approve or reject quotations" });
        }
        if (!isAdmin && current.clientId === req.user!.userId) {
          return res.status(403).json({ error: "You cannot review a quotation you created (segregation of duties)" });
        }
        if (current.status === "converted_to_so") {
          return res.status(400).json({ error: "This quotation is already converted to a sales order" });
        }
        body.approvalReviewedBy = req.user!.userId;
        body.approvalReviewedAt = db.nowISO();
      } else if (body.approvalStatus === "pending_review") {
        // Maker submits for approval. Content must be settled first.
        if (current.approvalStatus === "approved") {
          return res.status(400).json({ error: "This quotation is already approved" });
        }
        if (current.status === "converted_to_so") {
          return res.status(400).json({ error: "This quotation is already converted to a sales order" });
        }
        body.status = body.status ?? "sent";
        body.approvalRequestedAt = db.nowISO();
      } else {
        return res.status(400).json({ error: "approvalStatus must be pending_review, approved or rejected" });
      }
    }

    // Lines are frozen once an approval is in flight (or after approval) — not
    // even a checker's decision may smuggle line edits through. After a
    // rejection the maker can edit again and resubmit.
    const underReview = ["pending_review", "approved"].includes(current.approvalStatus ?? "");
    if (underReview && body.lines !== undefined) {
      return res.status(400).json({ error: "Quotation is under review — lines cannot be edited until the checker decides" });
    }

    if (body.lines !== undefined) {
      let lines: any[];
      try { lines = await validateQuotationLines(req.user!.userId, body.lines); } catch (e: any) { return res.status(400).json({ error: e.message }); }
      body.lines = lines;
    }
    if (body.customerName === undefined && body.customerId) body.customerName = await resolveCustomerName(body.customerId);
    const updated = await Quotation.update(req.params.id, body);
    // Audit trail — record maker submission / checker approval decisions.
    if (body.approvalStatus !== undefined && body.approvalStatus !== current.approvalStatus) {
      const s = String(body.approvalStatus);
      const actionByStatus = {
        pending_review: "quotation.submitted",
        approved: "quotation.approved",
        rejected: "quotation.rejected",
      } as Record<string, string>;
      if (actionByStatus[s]) {
        trackAction(req, actionByStatus[s], current.id, {
          entityType: "quotation",
          entityRef: current.quotationNumber,
          status: s,
          prevStatus: current.approvalStatus ?? null,
          amount: current.grandTotal,
        });
      }
    }
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.delete("/quotations/:id", authMiddleware, async (req, res) => {
  try {
    const q = await Quotation.get(req.params.id);
    if (!q) return res.status(404).json({ error: "Quotation not found" });
    if (!["draft"].includes(q.status)) {
      return res.status(400).json({ error: "Only draft quotations can be deleted" });
    }
    await Quotation.remove(q.id);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/** POST /quotations/:id/convert — turn a sent/accepted quotation into a sales order. */
router.post("/quotations/:id/convert", authMiddleware, async (req, res) => {
  try {
    const clientId = req.user!.userId;
    const q = await Quotation.get(req.params.id);
    if (!q) return res.status(404).json({ error: "Quotation not found" });
    if (q.status === "converted_to_so") return res.status(400).json({ error: "Quotation is already converted to a sales order" });
    if (!["sent", "accepted"].includes(q.status)) {
      return res.status(400).json({ error: "Only sent or accepted quotations can be converted to a sales order" });
    }
    // Maker–checker gate: the updated prices must be approved before the quote
    // can become a sales order.
    if (q.approvalStatus !== "approved") {
      return res.status(400).json({ error: "Quotation must be approved by the checker before converting to a sales order" });
    }
    const lines: any[] = (q.lines ?? []).map((l: any) => {
      // The approved effective price — the maker's updated price when set,
      // otherwise the original quoted price.
      const unitPrice = Number(l.updatedUnitPrice ?? l.unitPrice) || 0;
      let discountPct: number | null = null;
      if (l.discountType === "pct") discountPct = Number(l.discountValue) || 0;
      else if (l.discountType === "amount") {
        const gross = (Number(l.quantity) || 0) * unitPrice;
        if (gross > 0) discountPct = Math.round(((Number(l.discountValue) || 0) / gross) * 100 * 100) / 100;
      }
      return {
        productId: l.productId, sku: l.sku, name: l.name, unit: l.unit || "unit",
        orderedQty: Number(l.quantity) || 0,
        unitPrice,
        discountPct,
        gstRate: l.gstRate ?? null,
        notes: l.notes || null,
      };
    });
    const so = await GoodsSO.create({
      clientId,
      orderDate: db.todayDate(),
      customerId: q.customerId, customerName: q.customerName,
      contactPerson: q.contactPerson, billingAddress: q.billingAddress, deliveryAddress: q.deliveryAddress,
      salespersonId: q.salespersonId, salespersonName: q.salespersonName,
      paymentTerms: q.paymentTerms, expectedDeliveryDate: q.expectedDeliveryDate,
      freight: q.freight,
      linkedQuotationId: q.id, linkedQuotationNumber: q.quotationNumber,
      notes: q.notes ? `Converted from quotation ${q.quotationNumber}. ${q.notes}` : `Converted from quotation ${q.quotationNumber}`,
      documents: q.documents || [],
      status: "draft", lines,
    });
    const updated = await Quotation.update(q.id, { status: "converted_to_so", linkedGoodsSoId: so.id });
    res.status(201).json({ quotation: updated, salesOrder: so });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===================== DEBTOR PDF APPROVALS =====================
// Send a quotation / sales order PDF to the debtor by email with an
// Approve/Reject link. The debtor's decision is recorded on the document and
// reflected in the Quotations / Sales Orders tabs (accepted / confirmed).
// The public /approvals/:token endpoints are token-authenticated (rate-limited,
// no login) and one-time: the token is cleared once the debtor responds.

/** Locate a document by its one-time debtor approval token. */
async function findApprovalDoc(token: string): Promise<{ kind: "quotation" | "sales_order"; doc: any } | null> {
  const [quotations, sos] = await Promise.all([
    db.scanByType("Quotation"),
    db.scanByType("GoodsSalesOrder"),
  ]);
  const q = (quotations as any[]).find((x) => x.debtorApprovalToken === token);
  if (q) return { kind: "quotation", doc: q };
  const so = (sos as any[]).find((x) => x.debtorApprovalToken === token);
  if (so) return { kind: "sales_order", doc: so };
  return null;
}

/** Resolve the client's company name + contact for the PDF and email branding. */
async function resolveCompanyName(userId: string): Promise<{ name: string; contact: string | null }> {
  try {
    const client = await db.getItem(`USER#${userId}`);
    if (client) {
      return {
        name: (client as any).companyName || (client as any).email || "Our Company",
        contact: (client as any).email || null,
      };
    }
  } catch { /* ignore */ }
  return { name: "Our Company", contact: null };
}

/** Shared send-to-debtor logic: build PDF, email it, return the fresh token. */
async function sendDocumentToDebtor(
  kind: "quotation" | "sales_order",
  doc: any,
  clientId: string,
): Promise<{ token: string; email: string; filename: string }> {
  const debtor = doc.customerId ? await Debtor.get(doc.customerId) : null;
  const email = debtor?.contactEmail?.trim() || null;
  if (!email) {
    throw new Error(
      `No contact email on file for "${debtor?.name || "the customer"}" — add one in the Debtors tab first`,
    );
  }
  const { isEmailConfigured } = await import("../email.js");
  if (!isEmailConfigured()) {
    throw new Error("SMTP is not configured — set SMTP_HOST / SMTP_USER / SMTP_PASS to send approval emails");
  }

  const company = await resolveCompanyName(clientId);
  const { quotationToPdfData, salesOrderToPdfData, buildDocumentPdf } = await import("../lib/document-pdf.js");
  const data =
    kind === "quotation"
      ? quotationToPdfData(doc, company.name, company.contact)
      : salesOrderToPdfData(doc, company.name, company.contact);
  const pdf = await buildDocumentPdf(data);

  const token = uuid();
  const approvalUrl = `${config.appUrl}/approve/${token}`;
  const { sendDocumentApprovalEmail } = await import("../email.js");
  const sent = await sendDocumentApprovalEmail({
    kind,
    number: data.number,
    grandTotal: data.grandTotal,
    validUntil: data.validUntil,
    customerName: data.customerName || debtor?.name || "Customer",
    customerEmail: email,
    companyName: company.name,
    pdfBuffer: pdf,
    pdfFilename: `${data.number.replace(/[^A-Za-z0-9-_]/g, "_")}.pdf`,
    approvalUrl,
  });
  if (!sent) throw new Error("Failed to send the email — check the SMTP configuration");
  return { token, email, filename: `${data.number.replace(/[^A-Za-z0-9-_]/g, "_")}.pdf` };
}

/** POST /quotations/:id/send-to-debtor — email the quotation PDF for approval. */
router.post("/quotations/:id/send-to-debtor", authMiddleware, async (req, res) => {
  try {
    const q = await Quotation.get(req.params.id);
    if (!q) return res.status(404).json({ error: "Quotation not found" });
    if (!["draft", "sent", "accepted", "rejected"].includes(q.status)) {
      return res.status(400).json({
        error:
          q.status === "converted_to_so"
            ? "This quotation is already converted to a sales order"
            : "Only draft, sent or accepted quotations can be sent to the debtor",
      });
    }
    const sent = await sendDocumentToDebtor("quotation", q, req.user!.userId);
    const updated = await Quotation.update(q.id, {
      debtorApprovalStatus: "pending",
      debtorApprovalToken: sent.token,
      debtorApprovalSentAt: db.nowISO(),
      debtorApprovalRespondedAt: null,
      debtorApprovalComments: null,
      debtorApprovalEmail: sent.email,
    });
    res.json({ success: true, sentTo: sent.email, document: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /goods-sales-orders/:id/send-to-debtor — email the SO PDF for approval. */
router.post("/goods-sales-orders/:id/send-to-debtor", authMiddleware, async (req, res) => {
  try {
    const so = await GoodsSO.get(req.params.id);
    if (!so) return res.status(404).json({ error: "Sales order not found" });
    if (!["draft", "confirmed"].includes(so.status)) {
      return res.status(400).json({
        error: "Only draft or confirmed sales orders can be sent to the debtor",
      });
    }
    const sent = await sendDocumentToDebtor("sales_order", so, req.user!.userId);
    const updated = await GoodsSO.update(so.id, {
      debtorApprovalStatus: "pending",
      debtorApprovalToken: sent.token,
      debtorApprovalSentAt: db.nowISO(),
      debtorApprovalRespondedAt: null,
      debtorApprovalComments: null,
      debtorApprovalEmail: sent.email,
    });
    res.json({ success: true, sentTo: sent.email, document: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Whitelisted summary of a document for the public debtor page — never expose
 * internal fields (clientId, salespersonId, approval reviewers, tokens…).
 */
function publicApprovalSummary(kind: "quotation" | "sales_order", doc: any) {
  const base = {
    id: doc.id,
    status: doc.status,
    customerName: doc.customerName ?? null,
    contactPerson: doc.contactPerson ?? null,
    billingAddress: doc.billingAddress ?? null,
    deliveryAddress: doc.deliveryAddress ?? null,
    paymentTerms: doc.paymentTerms ?? null,
    notes: doc.notes ?? null,
    lines: (doc.lines ?? []).map((l: any) => ({
      productId: l.productId,
      sku: l.sku ?? null,
      name: l.name ?? "Item",
      unit: l.unit ?? "unit",
      quantity: Number(l.quantity) || 0,
      orderedQty: Number(l.orderedQty) || 0,
      unitPrice: Number(l.unitPrice) || 0,
      updatedUnitPrice: l.updatedUnitPrice ?? null,
      discountType: l.discountType ?? null,
      discountValue: l.discountValue ?? null,
      discountPct: l.discountPct ?? null,
      gstRate: l.gstRate ?? null,
      lineTotal: Number(l.lineTotal) || 0,
    })),
    subtotal: Number(doc.subtotal) || 0,
    totalDiscount: Number(doc.totalDiscount) || 0,
    gstTotal: Number(doc.gstTotal) || 0,
    freight: Number(doc.freight) || 0,
    grandTotal: Number(doc.grandTotal) || 0,
    debtorApprovalStatus: doc.debtorApprovalStatus ?? null,
    debtorApprovalComments: doc.debtorApprovalComments ?? null,
  };
  return kind === "quotation"
    ? {
        ...base,
        quotationNumber: doc.quotationNumber,
        quotationDate: doc.quotationDate,
        validUntil: doc.validUntil,
      }
    : {
        ...base,
        soNumber: doc.soNumber,
        orderDate: doc.orderDate,
        expectedDeliveryDate: doc.expectedDeliveryDate,
      };
}

/** GET /approvals/:token — public, one-time token lookup for the debtor page. */
router.get("/approvals/:token", publicTokenLimiter, async (req, res) => {
  try {
    const found = await findApprovalDoc(req.params.token);
    if (!found) return res.status(404).json({ error: "Not found" });
    const debtor = found.doc.customerId ? await Debtor.get(found.doc.customerId) : null;
    res.json({
      kind: found.kind,
      document: publicApprovalSummary(found.kind, found.doc),
      debtor: debtor
        ? { name: debtor.name, contactName: debtor.contactName, contactEmail: debtor.contactEmail }
        : null,
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/** POST /approvals/:token/respond — record the debtor's decision (one-time, atomic). */
router.post("/approvals/:token/respond", publicTokenLimiter, async (req, res) => {
  try {
    const { decision, comments } = req.body || {};
    if (!["approved", "rejected"].includes(decision)) {
      return res.status(400).json({ error: "decision must be 'approved' or 'rejected'" });
    }
    if (comments !== undefined && (typeof comments !== "string" || comments.length > 2000)) {
      return res.status(400).json({ error: "Comments are too long" });
    }
    const found = await findApprovalDoc(req.params.token);
    if (!found) {
      return res.status(404).json({ error: "This approval link is invalid or has already been used" });
    }
    const { kind, doc } = found;

    // Never clobber a document that has moved past the sendable state — e.g. a
    // quotation that was already converted to an SO, or an SO that is already
    // dispatched/cancelled. The debtor's decision is still recorded; the
    // lifecycle status stays untouched.
    const locked =
      kind === "quotation"
        ? ["converted_to_so", "expired"].includes(doc.status)
        : ["partially_dispatched", "fully_dispatched", "cancelled"].includes(doc.status);

    const patch: Record<string, any> = {
      debtorApprovalStatus: decision,
      debtorApprovalRespondedAt: db.nowISO(),
      debtorApprovalComments: comments || null,
      debtorApprovalToken: null,
    };
    if (!locked) {
      patch.status =
        kind === "quotation"
          ? decision === "approved"
            ? "accepted"
            : "rejected"
          : decision === "approved"
            ? "confirmed"
            : "draft";
      if (kind === "sales_order") patch.manualStatus = patch.status;
    }

    // Atomic claim: the token must still match, so exactly one concurrent
    // response wins — the loser gets a 404 (link already used).
    const pk = kind === "quotation" ? `QUOTATION#${doc.id}` : `GOODS_SO#${doc.id}`;
    const claimed = await db.updateItemIf(
      pk,
      pk,
      patch,
      "debtorApprovalToken = :tok",
      { ":tok": req.params.token },
    );
    if (!claimed) {
      return res.status(404).json({ error: "This approval link is invalid or has already been used" });
    }
    res.json({ success: true, decision, status: claimed.status ?? doc.status });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===================== GOODS DISPATCHES (sales-side of GRN) =====================
// Lifecycle: draft (no stock) → confirm (DEBITS stock with the dispatched
// quantity, folds dispatched qty into the SO) → cancelled (reversing credit
// entries only if stock had already been debited).
// The dispatch note is the ONLY document that debits inventory for sales
// orders — SOs, proformas and sales invoices never touch stock.

function assertSODispatchable(so: any) {
  if (so.status === "cancelled") throw new Error("Cannot dispatch against a cancelled sales order");
  if (so.status === "draft") throw new Error("Confirm the sales order before dispatching goods");
  if (so.status === "fully_dispatched") throw new Error("Sales order is already fully dispatched");
}

/**
 * Validate dispatch lines against the SO (ordered/pending limits) and snapshot
 * them onto the dispatch note. The over-dispatch gate applies to the
 * dispatched quantity — that is what counts toward the SO and leaves stock.
 */
function validateDispatchLines(so: any, rawLines: any[], allowOverDispatch: boolean) {
  const lines: any[] = [];
  if (!Array.isArray(rawLines) || rawLines.length === 0) throw new Error("At least one dispatched line required");
  // Accumulate per-product dispatched quantities so duplicate lines can't each
  // pass the pending check and collectively over-dispatch.
  const seen = new Map<string, number>();
  for (const ln of rawLines) {
    const soLine = (so.lines ?? []).find((l: any) => l.productId === ln.productId);
    if (!soLine) throw new Error("A dispatch line references a product that is not on this sales order");
    const dispatchedQty = Number(ln.dispatchedQty);
    if (!Number.isFinite(dispatchedQty) || dispatchedQty <= 0) throw new Error(`Dispatched quantity must be greater than zero for ${soLine.name}`);
    const already = seen.get(soLine.productId) ?? 0;
    const pending = soLine.orderedQty - (soLine.dispatchedQty ?? 0) - already;
    if (dispatchedQty > pending && !allowOverDispatch) {
      throw new Error(`Dispatching ${dispatchedQty} for ${soLine.name} exceeds the ${Math.max(0, pending)} pending. Over-dispatch requires checker/admin approval.`);
    }
    seen.set(soLine.productId, already + dispatchedQty);
    lines.push({
      productId: soLine.productId, sku: soLine.sku, name: soLine.name,
      unit: soLine.unit ?? "unit",
      orderedQty: soLine.orderedQty, dispatchedQty,
      unitPrice: Number(ln.unitPrice ?? soLine.unitPrice) || 0,
      discountPct: soLine.discountPct ?? null,
      gstRate: soLine.gstRate ?? null,
      lineValue: Math.round(dispatchedQty * (Number(ln.unitPrice ?? soLine.unitPrice) || 0) * (1 - (soLine.discountPct ?? 0) / 100) * 100) / 100,
      notes: ln.notes || null,
    });
  }
  return lines;
}

/** Quantity that was debited for a line — the dispatched quantity. */
function debitedQty(l: any): number {
  return Number(l.dispatchedQty) || 0;
}

/** Available stock per product (confirmed credits − confirmed debits). */
async function stockBalanceByProduct(clientId: string): Promise<Map<string, number>> {
  const movements = await StockMovement.list(clientId);
  const balance = new Map<string, number>();
  for (const m of movements) {
    if (!m.productId || m.status !== "confirmed") continue;
    balance.set(m.productId, (balance.get(m.productId) ?? 0) + (m.direction === "in" ? m.quantity : -m.quantity));
  }
  return balance;
}

/** Debit inventory for every dispatch line and fold dispatched qty into the SO. */
async function debitSalesOrder(clientId: string, dispatch: any, so: any) {
  const unitByProduct = new Map<string, string>(
    (so.lines ?? []).map((l: any) => [String(l.productId), String(l.unit ?? "unit")] as [string, string])
  );
  for (const ln of dispatch.lines ?? []) {
    const qty = debitedQty(ln);
    if (!(qty > 0)) continue;
    let unitCost = ln.unitPrice;
    try {
      const prod = await Product.get(ln.productId);
      if (prod && prod.unitCost != null) unitCost = prod.unitCost;
    } catch { /* keep the dispatch snapshot */ }
    await StockMovement.create({
      clientId, productId: ln.productId, direction: "out", itemName: ln.name, sku: ln.sku,
      quantity: qty, unit: unitByProduct.get(ln.productId) || ln.unit || "unit",
      unitCost,
      warehouse: dispatch.warehouse || null,
      reason: "Dispatch",
      linkedDocumentType: "Dispatch",
      linkedDocumentNumber: dispatch.dispatchNumber,
      status: "confirmed",
      notes: `Dispatch ${dispatch.dispatchNumber} for SO ${dispatch.soNumber ?? ""}`.trim(),
      movementDate: dispatch.dispatchDate, goodsDispatchId: dispatch.id,
      salesOrderId: dispatch.goodsSalesOrderId,
      createdById: dispatch.dispatchedById, createdByName: dispatch.dispatchedBy,
      confirmedById: dispatch.debitedBy, confirmedByName: dispatch.debitedBy, confirmedAt: dispatch.debitedAt,
    });
  }
  await GoodsSO.recordDispatch(dispatch.goodsSalesOrderId, (dispatch.lines ?? []).map((l: any) => ({ productId: l.productId, dispatchedQty: debitedQty(l) })));
}

/** Create reversing credit (stock-in) entries for a confirmed dispatch and revoke its SO quantities. */
async function reverseDispatch(clientId: string, dispatch: any, so: any) {
  const unitByProduct = new Map<string, string>(
    (so?.lines ?? []).map((l: any) => [String(l.productId), String(l.unit ?? "unit")] as [string, string])
  );
  for (const ln of dispatch.lines ?? []) {
    const qty = debitedQty(ln);
    if (!(qty > 0)) continue;
    let unitCost = ln.unitPrice;
    try {
      const prod = await Product.get(ln.productId);
      if (prod && prod.unitCost != null) unitCost = prod.unitCost;
    } catch { /* keep the dispatch snapshot */ }
    await StockMovement.create({
      clientId, productId: ln.productId, direction: "in", itemName: ln.name, sku: ln.sku,
      quantity: qty, unit: unitByProduct.get(ln.productId) || ln.unit || "unit",
      unitCost,
      warehouse: dispatch.warehouse || null,
      reason: "Stock adjustment",
      linkedDocumentType: "Dispatch",
      linkedDocumentNumber: dispatch.dispatchNumber,
      status: "confirmed",
      notes: `Dispatch ${dispatch.dispatchNumber} cancelled — reversal`,
      movementDate: db.todayDate(), goodsDispatchId: dispatch.id,
      salesOrderId: dispatch.goodsSalesOrderId,
      createdById: dispatch.cancelledBy, createdByName: dispatch.cancelledBy,
      confirmedById: dispatch.cancelledBy, confirmedByName: dispatch.cancelledBy, confirmedAt: db.nowISO(),
    });
  }
  await GoodsSO.revokeDispatch(dispatch.goodsSalesOrderId, (dispatch.lines ?? []).map((l: any) => ({ productId: l.productId, dispatchedQty: debitedQty(l) })));
}

router.get("/goods-dispatches", authMiddleware, async (req, res) => {
  try { res.json(await GoodsDispatch.list(req.user!.userId)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/** POST /goods-dispatches — create a DRAFT dispatch note. No stock impact. */
router.post("/goods-dispatches", authMiddleware, async (req, res) => {
  try {
    const clientId = req.user!.userId;
    const body = req.body || {};
    if (!body.goodsSalesOrderId) return res.status(400).json({ error: "goodsSalesOrderId required" });
    const so = await GoodsSO.get(body.goodsSalesOrderId);
    if (!so) return res.status(404).json({ error: "Sales order not found" });
    if (so.status === "cancelled") return res.status(400).json({ error: "Cannot create a dispatch against a cancelled sales order" });
    // A draft may be prepared against any open SO; the dispatchable/over-dispatch
    // checks run at CONFIRM time (the moment stock actually gets debited).
    let lines: any[];
    try { lines = validateDispatchLines(so, body.lines, false); } catch (e: any) { return res.status(400).json({ error: e.message }); }
    // Resolve linked-document numbers for display snapshots.
    let linkedProformaNumber: string | null = body.linkedCustomerProformaNumber ?? null;
    if (body.linkedCustomerProformaId && !linkedProformaNumber) {
      const pf = await PurchaseOrder.get(body.linkedCustomerProformaId);
      linkedProformaNumber = pf ? (pf.proformaNumber ?? pf.poNumber) : null;
    }
    let linkedInvoiceNumber: string | null = body.linkedSalesInvoiceNumber ?? null;
    if (body.linkedSalesInvoiceId && !linkedInvoiceNumber) {
      const inv = await Invoice.get(body.linkedSalesInvoiceId);
      linkedInvoiceNumber = inv ? inv.invoiceNumber : null;
    }
    const dispatch = await GoodsDispatch.create({
      clientId, goodsSalesOrderId: so.id, soNumber: so.soNumber,
      customerId: body.customerId ?? so.customerId, customerName: body.customerName ?? so.customerName,
      contactPerson: body.contactPerson ?? so.contactPerson,
      deliveryAddress: body.deliveryAddress ?? so.deliveryAddress,
      warehouse: body.warehouse ?? null,
      dispatchDate: body.dispatchDate || null,
      transporterName: body.transporterName || null,
      trackingNumber: body.trackingNumber || null,
      deliveryChallanNumber: body.deliveryChallanNumber || null,
      linkedCustomerProformaId: body.linkedCustomerProformaId || null,
      linkedCustomerProformaNumber: linkedProformaNumber,
      linkedSalesInvoiceId: body.linkedSalesInvoiceId || null,
      linkedSalesInvoiceNumber: linkedInvoiceNumber,
      dispatchedById: req.user!.userId, dispatchedBy: req.user!.email,
      notes: body.notes || null, documents: body.documents || [],
      status: "draft", lines,
    });
    res.status(201).json(dispatch);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/** POST /goods-dispatches/:id/confirm — debit stock (idempotent, race-safe). */
router.post("/goods-dispatches/:id/confirm", authMiddleware, async (req, res) => {
  try {
    const clientId = req.user!.userId;
    const dispatch = await GoodsDispatch.get(req.params.id);
    if (!dispatch) return res.status(404).json({ error: "Dispatch note not found" });
    if (dispatch.status === "cancelled") return res.status(400).json({ error: "Cannot confirm a cancelled dispatch" });
    const allowOver = !!req.body?.allowOverDispatch && (req.user!.roles?.includes("factor_admin") || req.user!.roles?.includes("checker"));
    const so = await GoodsSO.get(dispatch.goodsSalesOrderId);
    if (!so) return res.status(404).json({ error: "Sales order not found" });
    try { assertSODispatchable(so); } catch (e: any) { return res.status(400).json({ error: e.message }); }
    // Re-validate at confirm time — the SO may have been dispatched further in
    // the meantime, so pending is checked against the live SO.
    try { validateDispatchLines(so, dispatch.lines, allowOver); } catch (e: any) { return res.status(400).json({ error: e.message }); }
    // Soft stock check: warn (don't block) when available stock is short.
    const balance = await stockBalanceByProduct(clientId);
    const warnings: string[] = [];
    for (const ln of dispatch.lines ?? []) {
      const qty = debitedQty(ln);
      if (!(qty > 0)) continue;
      const available = balance.get(ln.productId) ?? 0;
      if (qty > available) {
        warnings.push(`${ln.name}: dispatching ${qty} but only ${Math.max(0, available)} in stock`);
      }
    }
    // Atomic draft → confirmed flip: exactly one concurrent confirm wins and
    // debits stock; the others get alreadyConfirmed and debit nothing.
    const flipped = await GoodsDispatch.flipToConfirmed(dispatch.id, req.user!.email);
    if (!flipped) return res.json({ ...dispatch, alreadyConfirmed: true });
    await debitSalesOrder(clientId, flipped, so);
    trackAction(req, "dispatch.confirmed", dispatch.id, {
      entityType: "dispatch",
      entityRef: dispatch.dispatchNumber,
      soNumber: dispatch.soNumber,
      lines: dispatch.lines?.length ?? 0,
    });
    recomputeForecast(clientId);
    res.json({ ...flipped, stockWarnings: warnings });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/** POST /goods-dispatches/:id/cancel — reversing credit entries only if stock was debited. */
router.post("/goods-dispatches/:id/cancel", authMiddleware, async (req, res) => {
  try {
    const clientId = req.user!.userId;
    const dispatch = await GoodsDispatch.get(req.params.id);
    if (!dispatch) return res.status(404).json({ error: "Dispatch note not found" });
    if (dispatch.status === "cancelled") return res.json({ ...dispatch, alreadyCancelled: true });
    if (dispatch.status === "returned") {
      return res.status(400).json({ error: "Cannot cancel a returned dispatch — the return has already credited stock back" });
    }
    // Atomic → cancelled flip: only the winner performs the reversal.
    const flipped = await GoodsDispatch.flipToCancelled(dispatch.id, req.user!.email);
    if (!flipped) return res.json({ ...dispatch, alreadyCancelled: true });
    const wasDebited = flipped.stockDebited === true;
    if (wasDebited) {
      const so = await GoodsSO.get(dispatch.goodsSalesOrderId);
      if (so) await reverseDispatch(clientId, dispatch, so);
    trackAction(req, "dispatch.cancelled", dispatch.id, {
      entityType: "dispatch",
      entityRef: dispatch.dispatchNumber,
      wasDebited,
    });
    }
    recomputeForecast(clientId);
    res.json(flipped);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/** PUT /goods-dispatches/:id — edit a DRAFT only (no stock impact). */
router.put("/goods-dispatches/:id", authMiddleware, async (req, res) => {
  try {
    const dispatch = await GoodsDispatch.get(req.params.id);
    if (!dispatch) return res.status(404).json({ error: "Dispatch note not found" });
    if (dispatch.status !== "draft") return res.status(400).json({ error: "Only draft dispatch notes can be edited — confirm or cancel first" });
    const body = req.body || {};
    const so = await GoodsSO.get(dispatch.goodsSalesOrderId);
    if (!so) return res.status(404).json({ error: "Sales order not found" });
    let lines = dispatch.lines;
    if (body.lines !== undefined) {
      try { lines = validateDispatchLines(so, body.lines, false); } catch (e: any) { return res.status(400).json({ error: e.message }); }
    }
    const updated = await GoodsDispatch.update(dispatch.id, {
      dispatchDate: body.dispatchDate ?? dispatch.dispatchDate,
      warehouse: body.warehouse ?? dispatch.warehouse,
      notes: body.notes ?? dispatch.notes,
      documents: body.documents ?? dispatch.documents,
      lines,
    });
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/** DELETE /goods-dispatches/:id — delete a DRAFT only. Confirmed dispatches must be cancelled first. */
router.delete("/goods-dispatches/:id", authMiddleware, async (req, res) => {
  try {
    const dispatch = await GoodsDispatch.get(req.params.id);
    if (!dispatch) return res.status(404).json({ error: "Dispatch note not found" });
    if (dispatch.status !== "draft") {
      return res.status(400).json({ error: "Only draft dispatch notes can be deleted — cancel confirmed dispatches instead" });
    }
    await GoodsDispatch.remove(dispatch.id);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get("/goods-dispatches/:id", authMiddleware, async (req, res) => {
  try {
    const item = await GoodsDispatch.get(req.params.id);
    if (!item) return res.status(404).json({ error: "Dispatch note not found" });
    res.json(item);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/** POST /goods-dispatches/:id/deliver — record per-line delivered qty + delivery date. No stock impact. */
router.post("/goods-dispatches/:id/deliver", authMiddleware, async (req, res) => {
  try {
    const dispatch = await GoodsDispatch.get(req.params.id);
    if (!dispatch) return res.status(404).json({ error: "Dispatch note not found" });
    if (["draft", "cancelled", "returned"].includes(dispatch.status)) {
      return res.status(400).json({ error: `Cannot mark a ${dispatch.status} dispatch as delivered` });
    }
    if (dispatch.status === "delivered") {
      return res.status(400).json({ error: "Dispatch is already fully delivered" });
    }
    const rawLines = Array.isArray(req.body?.lines) ? req.body.lines : [];
    if (rawLines.length === 0) return res.status(400).json({ error: "Enter a delivered quantity for at least one line" });
    // Accumulate per-product delivered quantities so duplicate lines can't collectively over-deliver.
    const seen = new Map<string, number>();
    const delivered: Array<{ productId: string; deliveredQty: number }> = [];
    for (const ln of rawLines) {
      const dLine = (dispatch.lines ?? []).find((l: any) => l.productId === ln.productId);
      if (!dLine) return res.status(400).json({ error: "A delivery line references a product that is not on this dispatch" });
      const qty = Number(ln.deliveredQty);
      if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: `Delivered quantity must be greater than zero for ${dLine.name}` });
      const already = seen.get(dLine.productId) ?? 0;
      const remaining = dLine.dispatchedQty - (dLine.deliveredQty ?? 0);
      if (qty > remaining - already) {
        return res.status(400).json({ error: `Delivered quantity for ${dLine.name} exceeds the ${Math.max(0, remaining - already)} not yet delivered` });
      }
      seen.set(dLine.productId, already + qty);
      delivered.push({ productId: dLine.productId, deliveredQty: qty });
    }
    const updated = await GoodsDispatch.markDelivered(dispatch.id, delivered, req.body.deliveryDate || null, req.user!.email);
    trackAction(req, "dispatch.delivered", dispatch.id, {
      entityType: "dispatch",
      entityRef: dispatch.dispatchNumber,
      deliveredQty: delivered.reduce((sum, d) => sum + d.deliveredQty, 0),
    });
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/** POST /goods-dispatches/:id/return — record per-line returns, credit stock back, revoke SO dispatched qty. */
router.post("/goods-dispatches/:id/return", authMiddleware, async (req, res) => {
  try {
    const clientId = req.user!.userId;
    const dispatch = await GoodsDispatch.get(req.params.id);
    if (!dispatch) return res.status(404).json({ error: "Dispatch note not found" });
    if (["draft", "cancelled", "returned"].includes(dispatch.status)) {
      return res.status(400).json({ error: `Cannot record a return on a ${dispatch.status} dispatch` });
    }
    const rawLines = Array.isArray(req.body?.lines) ? req.body.lines : [];
    const returned: Array<{ productId: string; returnedQty: number }> = [];
    const seen = new Map<string, number>();
    // No lines → return everything not yet returned (full return).
    if (rawLines.length === 0) {
      for (const dLine of dispatch.lines ?? []) {
        const remaining = dLine.dispatchedQty - (dLine.returnedQty ?? 0);
        if (remaining > 0) returned.push({ productId: dLine.productId, returnedQty: remaining });
      }
    } else {
      for (const ln of rawLines) {
        const dLine = (dispatch.lines ?? []).find((l: any) => l.productId === ln.productId);
        if (!dLine) return res.status(400).json({ error: "A return line references a product that is not on this dispatch" });
        const qty = Number(ln.returnedQty);
        if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: `Returned quantity must be greater than zero for ${dLine.name}` });
        const already = seen.get(dLine.productId) ?? 0;
        const remaining = dLine.dispatchedQty - (dLine.returnedQty ?? 0);
        if (qty > remaining - already) {
          return res.status(400).json({ error: `Returned quantity for ${dLine.name} exceeds the ${Math.max(0, remaining - already)} not yet returned` });
        }
        seen.set(dLine.productId, already + qty);
        returned.push({ productId: dLine.productId, returnedQty: qty });
      }
    }
    if (returned.length === 0) return res.status(400).json({ error: "Nothing to return — all quantities already returned" });
    const so = await GoodsSO.get(dispatch.goodsSalesOrderId);
    // Credit the returned quantity back into stock (system-created reversal).
    for (const r of returned) {
      const dLine = (dispatch.lines ?? []).find((l: any) => l.productId === r.productId);
      if (!dLine) continue;
      let unitCost = dLine.unitPrice;
      try {
        const prod = await Product.get(dLine.productId);
        if (prod && prod.unitCost != null) unitCost = prod.unitCost;
      } catch { /* keep the dispatch snapshot */ }
      await StockMovement.create({
        clientId, productId: dLine.productId, direction: "in", itemName: dLine.name, sku: dLine.sku,
        quantity: r.returnedQty, unit: dLine.unit || "unit", unitCost,
        warehouse: dispatch.warehouse || null,
        reason: "Customer return",
        linkedDocumentType: "Dispatch",
        linkedDocumentNumber: dispatch.dispatchNumber,
        status: "confirmed",
        notes: `Dispatch ${dispatch.dispatchNumber} returned — stock-in`,
        movementDate: db.todayDate(), goodsDispatchId: dispatch.id,
        salesOrderId: dispatch.goodsSalesOrderId,
        createdById: req.user!.userId, createdByName: req.user!.email,
        confirmedById: req.user!.userId, confirmedByName: req.user!.email, confirmedAt: db.nowISO(),
      });
    }
    const updated = await GoodsDispatch.recordReturned(dispatch.id, returned, req.user!.email);
    trackAction(req, "dispatch.returned", dispatch.id, {
      entityType: "dispatch",
      entityRef: dispatch.dispatchNumber,
      returnedQty: returned.reduce((sum, r) => sum + r.returnedQty, 0),
    });
    if (so) {
      await GoodsSO.revokeDispatch(so.id, returned.map((r) => ({ productId: r.productId, dispatchedQty: r.returnedQty })));
    }
    recomputeForecast(clientId);
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===================== EXPENSES =====================
router.get("/expenses", authMiddleware, async (req, res) => {
  try {
    // ?scope=all returns every client's expenses — used by the shared dashboard.
    const scopeAll = req.query.scope === "all";
    res.json(await Expense.list(scopeAll ? undefined : req.user!.userId));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.post("/expenses", authMiddleware, async (req, res) => {
  try {
    const item = await Expense.create({ ...req.body, clientId: req.user!.userId });
    trackAction(req, "expense.created", item.id, {
      entityType: "expense",
      entityRef: item.expenseRef,
      category: item.category,
      amount: item.amount,
    });
    res.status(201).json(item);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
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

// ===================== AUDIT / ACTIVITY FEED =====================
/**
 * GET /audit/activity — admin-only workflow audit trail (newest first).
 * Actor display names are resolved live from the User table (contactName
 * preferred, email fallback). System/security noise is filtered out.
 */
router.get("/audit/activity", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const NOISE_PREFIXES = ["auth.", "csrf.", "view_as.", "access.denied"];
    // GSI2 returns only the newest entries (bounded) — the append-only log
    // never triggers a full scan. Filter noise, then cap the feed.
    const entries = (await AuditLog.list({ limit: 1000 }))
      .filter((e) => !NOISE_PREFIXES.some((p) => e.action.startsWith(p)))
      .slice(0, 200);
    const users = await db.scanByType("User");
    const byId = new Map(users.map((u) => [u.id, u]));
    const enriched = entries.map((e) => {
      const u = e.actorId ? byId.get(e.actorId) : null;
      // Request metadata (ip/userAgent/statusCode) is not needed by the UI.
      const rest = { ...e };
      delete rest.ip;
      delete rest.userAgent;
      delete rest.statusCode;
      return {
        ...rest,
        actorName: u ? u.contactName || u.email || e.actorEmail : e.actorEmail,
        actorRoles: u ? (u.roles ?? []) : ((e.detail?.actorRoles as string[]) ?? []),
      };
    });
    res.json(enriched);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===================== ALERTS =====================
router.get("/alerts", authMiddleware, async (req, res) => {
  try { res.json(await Alert.list()); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.put("/alerts/:id/read", authMiddleware, async (req, res) => {
  try { res.json(await Alert.markRead(req.params.id)); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.post("/alerts/generate", authMiddleware, requireAdmin, auditAdminAction, async (req, res) => {
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
router.post("/invoices/:id/send-reminder", authMiddleware, requireAdmin, auditAdminAction, async (req, res) => {
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
router.post("/purchase-invoices/:id/send-reminder", authMiddleware, requireAdmin, auditAdminAction, async (req, res) => {
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
router.post("/reminders/run", authMiddleware, requireAdmin, auditAdminAction, async (req, res) => {
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
router.get("/noa/:token", publicTokenLimiter, async (req, res) => {
  try {
    const invoice = await Invoice.getByNOAToken(req.params.token);
    if (!invoice) return res.status(404).json({ error: "Not found" });
    const debtor = await Debtor.get(invoice.debtorId);
    // The assignor's company name — the NOA page shows who is assigning the invoice.
    const company = await resolveCompanyName(invoice.clientId);
    res.json({ invoice, debtor, clientCompany: company.name });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/noa/:token/respond", publicTokenLimiter, async (req, res) => {
  try {
    const { decision, comments } = req.body || {};
    if (typeof decision !== "string" || !decision.trim() || decision.length > 30) {
      return res.status(400).json({ error: "A valid decision is required" });
    }
    if (comments !== undefined && (typeof comments !== "string" || comments.length > 2000)) {
      return res.status(400).json({ error: "Comments are too long" });
    }
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
  limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 4, parts: 6 },
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
    if (!file) {
      return res.status(400).json({ error: "No file provided (multipart field name: file)" });
    }
    const { path, scope } = (req.body || {}) as { path?: string; scope?: string };
    // 1) Magic-byte validation — the content type is derived from the file
    //    contents, never trusted from the client. This blocks HTML/SVG uploads
    //    (stored XSS served from the S3 origin) and executable files, while
    //    allowing images, PDFs, office docs (docx/xlsx/…) and plain text.
    const detected = detectFileType(file.buffer);
    if (!detected) {
      return res.status(415).json({ error: "Unsupported file type. Allowed: JPEG, PNG, WebP, GIF, PDF, office documents and text files." });
    }
    // 2) Keep the client-supplied path (sanitized) — the frontend stores this
    //    exact key locally and uses it to open/delete the object. Only the
    //    S3 Content-Type comes from the detected file contents.
    const safePath = sanitizeS3Key(
      path || `${req.user!.userId}/${scope || "misc"}/${Date.now()}-${uuid().slice(0, 8)}.bin`
    );
    // Every key must live under the requester's own folder.
    if (!safePath.startsWith(`${req.user!.userId}/`)) {
      return res.status(403).json({ error: "Upload key must be scoped to your account" });
    }
    const { uploadFile } = await import("../s3.js");
    const result = await uploadFile(safePath, file.buffer, detected.mime);
    res.status(201).json({ path: safePath, url: result.url, name: file.originalname, size: file.size, type: detected.mime });
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
