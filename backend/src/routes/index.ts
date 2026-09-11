import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import { v4 as uuid } from "uuid";
import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
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
import {
  detectFileType,
  sanitizeS3Key,
  auditAdminAction,
  logSecurityEvent,
} from "../middleware/security.js";
import {
  requireAdmin,
  requireSuperAdmin,
  requireChecker,
  requireRole,
  effectiveListScope,
  isStaffAccount,
} from "../middleware/roles.js";
import * as User from "../models/user.js";
import * as Submission from "../models/submission.js";
import * as ReminderLog from "../models/reminder-log.js";
import * as ReminderSettings from "../models/reminder-settings.js";

// ─── Default company logo for print PDFs ─────────────────────────────────────
// <repo-root>/img/logo.png, resolved from this file so it works both from
// src/ (tsx dev) and dist/ (compiled production).
const ROUTES_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_LOGO_PATH = resolve(ROUTES_DIR, "../../../img/logo.png");
function loadRootLogo(): Buffer | null {
  try {
    if (existsSync(ROOT_LOGO_PATH)) return readFileSync(ROOT_LOGO_PATH);
  } catch {
    /* fall through to the text fallback */
  }
  return null;
}

// ─── View-As middleware (for reporting managers to see their reports' data) ──
// NOTE: this runs via router.use() BEFORE the per-route authMiddleware, so it
// decodes the JWT itself to learn who is making the request.
const viewAsMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
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
        req.user = {
          userId: payload.userId,
          email: payload.email,
          roles: payload.roles || [],
        };
      } catch {
        return res.status(401).json({ error: "Invalid or expired token" });
      }
    }

    // Verify the requester is a reporting_manager
    if (!req.user.roles?.includes("reporting_manager")) {
      logSecurityEvent("view_as.denied", req, { targetUserId: viewAsUserId });
      return res
        .status(403)
        .json({ error: "Only reporting managers can use view-as" });
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
import * as SkuMaster from "../models/sku-master.js";
import * as CatalogueSettings from "../models/catalogue-settings.js";
import * as StockMovement from "../models/stock-movement.js";
import * as Debtor from "../models/debtor.js";
import * as Vendor from "../models/vendor.js";
import * as Supplier from "../models/supplier.js";
import * as Invoice from "../models/invoice.js";
import * as PurchaseInvoice from "../models/purchase-invoice.js";
import * as PurchaseOrder from "../models/purchase-order.js";
import * as GoodsPO from "../models/goods-purchase-order.js";
import * as POClause from "../models/po-clause.js";
import * as GoodsReceipt from "../models/goods-receipt.js";
import * as GoodsSO from "../models/goods-sales-order.js";
import * as GoodsDispatch from "../models/goods-dispatch.js";
import * as Expense from "../models/expense.js";
import * as Advance from "../models/advance.js";
import * as Alert from "../models/alert.js";
import * as CoA from "../models/chart-of-account.js";
import * as Journal from "../models/journal.js";
import * as CDNote from "../models/credit-debit-note.js";
import * as Combined from "../models/models-combined.js";
import * as StockLocation from "../models/stock-location.js";
import * as DebtorTerm from "../models/debtor-payment-term.js";
import * as WorkflowTask from "../models/workflow-task.js";
import * as DocTimeline from "../models/doc-timeline.js";
import * as PaymentReceipt from "../models/payment-receipt.js";
import * as NotificationLog from "../models/notification-log.js";
import * as WorkflowSettings from "../models/workflow-settings.js";
import * as db from "../dynamodb.js";
import * as AuditLog from "../models/audit-log.js";

const router = Router();

/** Record a workflow action in the immutable audit trail (fire-and-forget). */
function trackAction(
  req: Request,
  action: string,
  target: string | null,
  detail?: Record<string, unknown>,
) {
  const actor = (req as any).user;
  void AuditLog.writeWorkflowAction(
    { userId: actor?.userId, email: actor?.email, roles: actor?.roles },
    action,
    target,
    detail,
    { ip: req.ip, userAgent: req.headers["user-agent"] },
  );
}

/**
 * Email every admin / treasury / checker user when a document lands in the
 * checker review queue or the treasury action queue. Fire-and-forget — never
 * blocks or fails the request.
 */
function notifyPendingQueue(
  req: Request,
  notice: {
    stage: "checker" | "treasury";
    kind: "sales_invoice" | "purchase_invoice" | "proforma" | "purchase_order" | "sales_order";
    number: string;
    amount: number;
    counterparty?: string | null;
    dueDate?: string | null;
    reviewPath?: string;
  },
) {
  const actorEmail = (req as any).user?.email as string | undefined;
  void (async () => {
    try {
      const { notifyPendingApprovers } = await import("../email.js");
      await notifyPendingApprovers({ ...notice, submittedBy: actorEmail ?? null });
    } catch (err) {
      console.error("  ⚠ Pending-queue email failed:", err);
    }
  })();
}

/**
 * Unified workflow handoff (PDF-3 §5 + Final Working Rule):
 * open the next task (idempotent) + timeline entry + spec-format email +
 * notification log. Fire-and-forget — never blocks the request. Email honors
 * the client's WorkflowSettings (assignment/approval/rejection toggles).
 */
function advanceWorkflow(
  req: Request,
  task: Omit<WorkflowTask.OpenTaskInput, "clientId"> & { clientId?: string },
  opts?: {
    timelineKind?: DocTimeline.TimelineKind;
    timelineText?: string | null;
    emailKind?: "assignment" | "approval" | "rejection" | "info";
    docType?: string;
    appPath?: string;
  },
) {
  const actor = (req as any).user as { userId: string; email: string; roles?: string[] } | undefined;
  const clientId = task.clientId ?? actor?.userId ?? "";
  void (async () => {
    try {
      const { task: opened, created } = await WorkflowTask.openTask(
        { ...task, clientId },
        { userId: actor?.userId, email: actor?.email },
      );
      const docType = opts?.docType ?? task.docType;
      await DocTimeline.addEntry({
        clientId,
        docType,
        docId: task.docId,
        docNumber: task.docNumber ?? null,
        kind: opts?.timelineKind ?? "assignment",
        actorId: actor?.userId ?? null,
        actorEmail: actor?.email ?? null,
        actorRoles: actor?.roles ?? [],
        text: opts?.timelineText ?? `${task.requiredAction} → ${task.ownerRole}`,
        prevStatus: null,
        newStatus: task.docStatus ?? null,
      });
      trackAction(req, `workflow.task_opened`, opened.id, {
        entityType: "workflow_task",
        stage: task.stage,
        docType: task.docType,
        docNumber: task.docNumber,
        ownerRole: task.ownerRole,
      });
      // Email only for genuinely new assignments (dedupe by DocType+DocID+Stage).
      if (!created) return;
      const settings = await WorkflowSettings.get(clientId).catch(() => null);
      const emailKind = opts?.emailKind ?? "assignment";
      const allowed =
        emailKind === "assignment"
          ? settings?.emailOnAssignment !== false
          : emailKind === "approval"
            ? settings?.emailOnApproval !== false
            : emailKind === "rejection"
              ? settings?.emailOnRejection !== false
              : true;
      if (!allowed) return;
      const { notifyWorkflowTask } = await import("../email.js");
      const result = await notifyWorkflowTask({
        taskName: task.requiredAction,
        docNumber: task.docNumber ?? task.docId,
        counterparty: task.counterparty ?? null,
        currentStatus: task.docStatus ?? null,
        requiredAction: task.requiredAction,
        dueDate: task.dueDate ?? null,
        latestUpdate: task.latestUpdate ?? null,
        ownerRole: task.ownerRole,
        submittedBy: actor?.email ?? null,
        appPath: opts?.appPath ?? "/app/workspace",
      });
      await NotificationLog.log({
        clientId,
        kind: emailKind === "info" ? "info" : emailKind,
        taskId: opened.id,
        docType: task.docType,
        docId: task.docId,
        docNumber: task.docNumber ?? null,
        recipients: result.recipients,
        subject: `Action Required — ${task.requiredAction} — ${task.docNumber ?? ""}`,
        sent: result.sent,
        error: result.sent ? null : "suppressed or failed",
      });
    } catch (err) {
      console.error("  ⚠ Workflow handoff failed:", err);
    }
  })();
}

/** Timeline status-change entry + audit for a document transition. */
function timelineStatus(
  req: Request,
  doc: { clientId: string; docType: string; docId: string; docNumber?: string | null },
  prevStatus: string | null,
  newStatus: string,
  text?: string | null,
  kind: DocTimeline.TimelineKind = "status_change",
) {
  const actor = (req as any).user as { userId: string; email: string; roles?: string[] } | undefined;
  void DocTimeline.addEntry({
    clientId: doc.clientId,
    docType: doc.docType,
    docId: doc.docId,
    docNumber: doc.docNumber ?? null,
    kind,
    actorId: actor?.userId ?? null,
    actorEmail: actor?.email ?? null,
    actorRoles: actor?.roles ?? [],
    text: text ?? `${prevStatus ?? "—"} → ${newStatus}`,
    prevStatus,
    newStatus,
  }).catch((e) => console.error("  ⚠ Timeline write failed:", e));
}

// Apply view-as middleware to all data routes
router.use(viewAsMiddleware);

// ===================== AUTH =====================
router.post("/auth/signup", signupLimiter, authSlowDown, (req, res) =>
  User.signup(req, res),
);
router.post(
  "/auth/login",
  loginLimiter,
  accountLoginLimiter,
  authSlowDown,
  (req, res) => User.login(req, res),
);
// Logout — clears the httpOnly session cookie. Unauthenticated calls are fine.
router.post("/auth/logout", (req, res) => {
  clearAuthCookie(res);
  res.json({ success: true });
});
router.get("/auth/me", authMiddleware, (req, res) => User.getProfile(req, res));
router.put("/auth/profile", authMiddleware, (req, res) =>
  User.updateProfile(req, res),
);

// ===================== ADMIN =====================
router.get("/admin/users", authMiddleware, requireAdmin, (req, res) =>
  User.getUsers(req, res),
);
// Create / delete users, role toggles and manager assignment are restricted to
// the super admin (sankalp@whizunik). Other admins keep all data access.
router.post(
  "/admin/users/create",
  authMiddleware,
  requireSuperAdmin,
  auditAdminAction,
  (req, res) => User.adminCreateUser(req, res),
);
router.put(
  "/admin/users/role",
  authMiddleware,
  requireSuperAdmin,
  auditAdminAction,
  (req, res) => User.updateUserRole(req, res),
);
router.delete(
  "/admin/users/:userId",
  authMiddleware,
  requireSuperAdmin,
  auditAdminAction,
  (req, res) => User.adminDeleteUser(req, res),
);
router.get("/admin/users/managers", authMiddleware, requireAdmin, (req, res) =>
  User.listManagers(req, res),
);
router.put(
  "/admin/users/:userId/assign-manager",
  authMiddleware,
  requireSuperAdmin,
  auditAdminAction,
  (req, res) => User.assignManager(req, res),
);
router.get(
  "/admin/users/:managerId/reports",
  authMiddleware,
  (req, res, next) => {
    // Allow admins OR the reporting manager themself to fetch reports
    if (
      req.user?.roles?.includes("factor_admin") ||
      req.user?.userId === req.params.managerId
    ) {
      return next();
    }
    return res
      .status(403)
      .json({
        error:
          "Access denied. Only admins and the reporting manager themselves can view reports.",
      });
  },
  (req, res) => User.getReports(req, res),
);

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
    // Presence/location data (last seen, IP, geo) stays private: visible only to
    // the user themself and the super admin, never to other admins/managers.
    if (!isSelf && !requesterRoles.includes("super_admin")) {
      delete safe.lastSeenAt;
      delete safe.lastSeenIp;
      delete safe.lastSeenGeo;
    }
    return res.json(safe);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ===================== PRODUCTS =====================
const SKU_MASTER_TYPES = ["category", "gender", "color", "size"] as const;
function isSkuMasterType(value: string): value is SkuMaster.SkuMasterType {
  return (SKU_MASTER_TYPES as readonly string[]).includes(value);
}

router.get("/sku-masters/:type", authMiddleware, async (req, res) => {
  try {
    if (!isSkuMasterType(req.params.type)) return res.status(400).json({ error: "Invalid master type" });
    res.json(await SkuMaster.list(effectiveListScope(req), req.params.type));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.post("/sku-masters/:type", authMiddleware, requireRole("factor_admin", "super_admin"), async (req, res) => {
  try {
    if (!isSkuMasterType(req.params.type)) return res.status(400).json({ error: "Invalid master type" });
    const item = await SkuMaster.create({ ...req.body, masterType: req.params.type, clientId: req.user!.userId });
    trackAction(req, "sku_master.created", item.id, { entityType: item.masterType, entityRef: item.code });
    res.status(201).json(item);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});
router.put("/sku-masters/:id", authMiddleware, requireRole("factor_admin", "super_admin"), async (req, res) => {
  try {
    const current = await SkuMaster.get(req.params.id);
    if (!current) return res.status(404).json({ error: "SKU master not found" });
    const products = await Product.list(current.clientId);
    const used = (products as any[]).some((p) =>
      [p.categoryMasterId, p.genderMasterId, p.colorMasterId, p.sizeMasterId].includes(current.id),
    );
    if (used && req.body?.code !== undefined && SkuMaster.normalizeCode(req.body.code) !== current.code) {
      return res.status(409).json({ error: "This code is already used by SKUs and cannot be changed" });
    }
    const item = await SkuMaster.update(current.id, req.body || {});
    trackAction(req, "sku_master.updated", current.id, { entityType: current.masterType, entityRef: current.code, used });
    res.json(item);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

function validPrice(value: unknown, label: string) {
  const n = Number(value ?? 0); if (!Number.isFinite(n) || n < 0) throw new Error(`${label} cannot be negative`); return n;
}

/** Creates the complete parent → colour → final-SKU hierarchy atomically from configured masters. */
router.post("/products/create-hierarchy", authMiddleware, async (req, res) => {
  try {
    const body = req.body || {}; const clientId = req.user!.userId;
    const [category, gender] = await Promise.all([SkuMaster.get(body.categoryMasterId), SkuMaster.get(body.genderMasterId)]);
    if (!category || category.masterType !== "category" || !category.active) throw new Error("Select an active category");
    if (!gender || gender.masterType !== "gender" || !gender.active) throw new Error("Select an active gender");
    const model = String(body.model ?? "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
    const name = String(body.name ?? "").trim(); if (!name || !model) throw new Error("Product name and model number are required");
    const parentSku = `AD-${gender.code}-${category.code}-${model}`;
    const all = await Product.list(clientId);
    const taken = new Set((all as any[]).map((p) => String(p.sku).toUpperCase()));
    if (taken.has(parentSku)) throw new Error(`SKU already exists: ${parentSku}`);
    const colors = await Promise.all((Array.isArray(body.colorMasterIds) ? body.colorMasterIds : []).map((id: string) => SkuMaster.get(id)));
    const sizes = await Promise.all((Array.isArray(body.sizeMasterIds) ? body.sizeMasterIds : []).map((id: string) => SkuMaster.get(id)));
    if (colors.some((x) => !x || x.masterType !== "color" || !x.active)) throw new Error("Select only active colours");
    if (sizes.some((x) => !x || x.masterType !== "size" || !x.active)) throw new Error("Select only active sizes");
    const unitCost = validPrice(body.unitCost, "Unit price"); const unitPrice = validPrice(body.unitPrice, "Selling price");
    const mrp = body.mrp === undefined || body.mrp === "" ? null : validPrice(body.mrp, "MRP");
    if (mrp !== null && mrp < unitPrice) throw new Error("MRP cannot be lower than selling price");
    const ecommercePrice = body.ecommercePrice === undefined || body.ecommercePrice === "" ? null : validPrice(body.ecommercePrice, "E-commerce price");
    const common: any = { name, category: category.name, gender: gender.name, model, unitPrice, unitCost, mrp, ecommercePrice,
      retailerPrice: body.retailerPrice === "" ? null : validPrice(body.retailerPrice, "Retailer price"),
      distributorPrice: body.distributorPrice === "" ? null : validPrice(body.distributorPrice, "Distributor price"),
      unitOfMeasure: body.unitOfMeasure || "piece", categoryMasterId: category.id, genderMasterId: gender.id, status: "active",
      hsnCode: String(body.hsnCode ?? "").trim() || null };
    const parent = await Product.create({ ...common, clientId, sku: parentSku, skuLevel: "parent" });
    const colourProducts: any[] = []; const variants: any[] = [];
    // Variant-matrix opt-outs: frontend sends ["<colorId>:<sizeId>"] for disabled cells.
    const disabled = new Set(Array.isArray(body.disabledKeys) ? body.disabledKeys.map((x: unknown) => String(x)) : []);
    for (const color of colors as SkuMaster.SkuMaster[]) {
      const colorSku = `${parentSku}-${color.code}`;
      if (taken.has(colorSku)) throw new Error(`SKU already exists: ${colorSku}`);
      const colourProduct = await Product.create({ ...common, clientId, parentId: parent.id, sku: colorSku, skuLevel: "color", color: color.name, colorMasterId: color.id });
      colourProducts.push(colourProduct); taken.add(colorSku);
      for (const size of sizes as SkuMaster.SkuMaster[]) {
        if (disabled.has(`${color.id}:${size.id}`)) continue;
        const sku = `${colorSku}-${size.code}`;
        if (taken.has(sku)) throw new Error(`SKU already exists: ${sku}`);
        variants.push(await Product.create({ ...common, clientId, parentId: colourProduct.id, sku, skuLevel: "variant", color: color.name, size: size.name, colorMasterId: color.id, sizeMasterId: size.id }));
        taken.add(sku);
      }
    }
    trackAction(req, "product.sku_hierarchy_created", parent.id, { entityType: "product", entityRef: parentSku, variants: variants.length });
    res.status(201).json({ parent, colors: colourProducts, variants });
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

router.get("/products/check-sku", authMiddleware, async (req, res) => {
  try {
    const sku = String(req.query.sku ?? "").trim().toUpperCase();
    if (!sku) return res.json({ exists: false, sku: "" });
    const items = await Product.list(effectiveListScope(req));
    const exists = (items as any[]).some((p) => String(p.sku ?? "").toUpperCase() === sku);
    res.json({ exists, sku });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/products", authMiddleware, async (req, res) => {
  try {
    const items = await Product.list(effectiveListScope(req));
    res.json(items);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.get("/products/:id", authMiddleware, async (req, res) => {
  try {
    const item = await Product.get(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });
    res.json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
// Inherited commercial details when a child SKU (colour/size variant) is
// created — the variant form only asks for colour, size and an optional SKU,
// so everything else is copied from the parent record at creation time.
const VARIANT_INHERITED_FIELDS = [
  "name",
  "description",
  "category",
  "subcategory",
  "gender",
  "brand",
  "model",
  "unitOfMeasure",
  "season",
  "unitPrice",
  "unitCost",
  "mrp",
  "ecommercePrice",
  "retailerPrice",
  "distributorPrice",
  "flexiblePrice",
  "minimumGrossMarginPercentage",
  "reorderLevel",
  "maxStock",
  "leadTimeDays",
  "safetyStockDays",
  "supplierId",
  "supplierProductCode",
  "minimumOrderQuantity",
  "orderMultiple",
  "hsnCode",
  "gstRate",
  "imageUrl",
  "unitsPerCarton",
  "status",
] as const;

/** Load a parent product and validate it can own variants. Throws on error. */
async function resolveVariantParent(clientId: string, parentId: string, isStaff: boolean) {
  const parent = await Product.get(parentId);
  if (!parent) throw new Error("Parent product not found");
  if (parent.clientId !== clientId && !isStaff) {
    throw new Error("Forbidden — the parent product belongs to another client");
  }
  // Staged hierarchy: Master SKU → colour SKU → size SKU (max two levels).
  // A final size SKU (one that carries a size of its own) cannot own children —
  // sizes are always added under a colour SKU.
  const isFinalSizeSku =
    parent.skuLevel === "variant" || !!(parent.size && String(parent.size).trim());
  if (isFinalSizeSku) {
    throw new Error(
      "A size SKU cannot have variants. Add sizes under a colour SKU instead.",
    );
  }
  return parent;
}

router.post("/products", authMiddleware, async (req, res) => {
  const clientId = req.user!.userId;
  const body = req.body || {};
  // Child SKUs inherit the parent's commercial details server-side; only
  // colour / size / optional SKU (and parentId) are taken from the request.
  if (body.parentId) {
    try {
      const parent = await resolveVariantParent(
        clientId,
        body.parentId,
        isStaffAccount(req.user?.roles),
      );
      for (const key of VARIANT_INHERITED_FIELDS) {
        if ((parent as any)[key] !== undefined && (body as any)[key] === undefined) {
          (body as any)[key] = (parent as any)[key];
        }
      }
      // Staged-creation rules: a colour is added under a Master SKU, a size
      // under a colour SKU. (A colour+size one-shot under a master is still
      // accepted for back-compat with document quick-add flows.)
      const parentIsMaster = !parent.parentId;
      const reqColour = (body.color ?? "").toString().trim();
      const reqSize = (body.size ?? "").toString().trim();
      if (parentIsMaster && !reqColour && !reqSize) {
        throw new Error("Enter a colour or a size for this variant");
      }
      if (!parentIsMaster && !reqSize) {
        throw new Error("Pick a size for this size SKU");
      }
      // Default the hierarchy level when the caller doesn't state it: a lone
      // colour under a master is a colour SKU, everything else is final.
      if ((body as any).skuLevel === undefined) {
        (body as any).skuLevel = !parentIsMaster || reqSize ? "variant" : "color";
      }
      if (!body.name) body.name = parent.name;
      // The variant name reads as a concrete sellable line, e.g. "Running Shoe — Black / 42".
      const colour = (body.color ?? "").toString().trim();
      const size = (body.size ?? "").toString().trim();
      const attrs = [colour, size].filter(Boolean).map((a) => a.toUpperCase()).join(" / ");
      body.name = attrs ? `${parent.name} — ${attrs}` : parent.name;
      if (!body.sku) {
        body.sku = await Product.nextAvailableVariantSku(
          clientId,
          parent.sku,
          colour,
          size,
        );
      }
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  }
  try {
    const item = await Product.create({
      ...body,
      clientId,
    });
    res.status(201).json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.put("/products/:id", authMiddleware, async (req, res) => {
  try {
    const item = await Product.update(req.params.id, req.body);
    res.json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.delete("/products/:id", authMiddleware, async (req, res) => {
  try {
    const product = await Product.get(req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found" });
    // Only the owning client (or any platform-staff account) may delete a
    // product; the cascade runs against the product's own client scope.
    const isStaff = isStaffAccount(req.user?.roles);
    if (product.clientId !== req.user!.userId && !isStaff) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const ownerId = product.clientId;
    // Variant cascade: deleting a parent also deletes every child SKU. Each
    // one removes its catalogue record AND everything that hangs off it —
    // inventory movements and forecast snapshots. Documents (invoices,
    // orders, GRNs, dispatches) keep their snapshot copies.
    const siblings = (await Product.list(ownerId)) as any[];
    // SKU hierarchies may be parent → colour → final size SKU. Remove every
    // descendant rather than only the first variant level.
    const childIds: string[] = [];
    const pending = [product.id];
    while (pending.length) {
      const parentId = pending.shift()!;
      const direct = siblings.filter((p) => p.parentId === parentId).map((p) => p.id);
      childIds.push(...direct);
      pending.push(...direct);
    }
    const { removeAllForProduct } =
      await import("../models/forecast-variable.js");
    let movementsDeleted = 0;
    let forecastsDeleted = 0;
    for (const id of [product.id, ...childIds]) {
      movementsDeleted += (await StockMovement.removeByProduct(ownerId, id)) ?? 0;
      forecastsDeleted += (await removeAllForProduct(ownerId, id)) ?? 0;
      await Product.remove(id);
    }
    recomputeForecast(ownerId);
    res.json({
      success: true,
      movementsDeleted,
      forecastsDeleted,
      variantsDeleted: childIds.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== CATALOGUE SETTINGS =====================
router.get("/catalogue-settings", authMiddleware, async (req, res) => {
  try {
    const settings = await CatalogueSettings.get(req.user!.userId);
    res.json(settings);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.put("/catalogue-settings", authMiddleware, async (req, res) => {
  try {
    const raw = req.body.defaultMinimumMargin;
    const margin = Number(raw);
    // Expect a decimal in (0.01, 0.99), e.g. 0.40 for 40%. Reject a raw percent
    // like 40 (would silently clamp into a 99% margin floor if we allowed it).
    if (!Number.isFinite(margin) || margin < 0.01 || margin > 0.99) {
      return res
        .status(400)
        .json({
          error:
            "defaultMinimumMargin must be a decimal between 0.01 and 0.99 (e.g. 0.40 for 40%)",
        });
    }
    const settings = await CatalogueSettings.update(req.user!.userId, {
      defaultMinimumMargin: margin,
    });

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
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
    const items = await StockMovement.list(effectiveListScope(req));
    const result = productId
      ? items.filter((m) => m.productId === productId)
      : items;
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
      return res
        .status(400)
        .json({ error: "Quantity must be greater than zero" });
    }
    if (!["in", "out"].includes(body.direction)) {
      return res
        .status(400)
        .json({ error: "Direction must be Credit (in) or Debit (out)" });
    }
    const status = body.status ?? "confirmed";
    if (!["draft", "confirmed"].includes(status)) {
      return res
        .status(400)
        .json({ error: "Status must be draft or confirmed" });
    }

    const isSystemFlow = !!(
      body.invoiceId ||
      body.goodsReceiptId ||
      body.purchaseInvoiceId ||
      body.goodsDispatchId
    );

    if (!isSystemFlow) {
      if (!body.reason || !MANUAL_MOVEMENT_REASONS.includes(body.reason)) {
        return res.status(400).json({
          error:
            "Manual entries require a movement reason — Opening stock, Stock adjustment, Damage, Samples / internal use, Customer return or Supplier return",
        });
      }
      if (!body.notes || !String(body.notes).trim()) {
        return res
          .status(400)
          .json({
            error: "Notes are required for every manual inventory entry",
          });
      }
      if (!body.productId) {
        return res
          .status(400)
          .json({
            error:
              "Select a product from the catalogue (SKU / name / unit are auto-filled)",
          });
      }
      const product = await Product.get(body.productId);
      if (!product)
        return res
          .status(400)
          .json({ error: "The selected catalogue product no longer exists" });
      // Users never type SKU / name / unit — always take them from the catalogue.
      body.itemName = product.name;
      body.sku = product.sku;
      body.unit = product.unitOfMeasure || "unit";
      if (
        body.unitCost === undefined ||
        body.unitCost === null ||
        body.unitCost === ""
      ) {
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
      console.error(
        "  ⚠ Forecast recompute after stock movement creation failed:",
        err,
      ),
    );
    res.status(201).json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /stock-movements/bulk — bulk-create movements for a single product.
 * Accepts { productId, reason, warehouse, notes, status, movements: [{ date, direction, quantity }] }.
 * All rows are validated, then inserted. Returns { created: number, movements: [...] }.
 */
router.post(
  "/stock-movements/bulk",
  authMiddleware,
  async (req, res) => {
    try {
      const clientId = req.user!.userId;
      const body = req.body || {};

      if (!body.productId) {
        return res
          .status(400)
          .json({ error: "productId is required" });
      }
      const product = await Product.get(body.productId);
      if (!product)
        return res
          .status(400)
          .json({ error: "The selected catalogue product no longer exists" });

      const reason = body.reason || "Stock adjustment";
      const notes = body.notes || "Bulk import";
      const status = body.status ?? "confirmed";
      if (!["draft", "confirmed"].includes(status)) {
        return res.status(400).json({ error: "Status must be draft or confirmed" });
      }

      const rows = body.movements;
      if (!Array.isArray(rows) || rows.length === 0) {
        return res
          .status(400)
          .json({ error: "movements must be a non-empty array" });
      }
      if (rows.length > 500) {
        return res
          .status(400)
          .json({ error: "Maximum 500 movements per import" });
      }

      // Validate all rows first
      const validated: Array<{
        direction: "in" | "out";
        quantity: number;
        movementDate: string;
        reason: string;
      }> = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const dir = String(row.direction ?? "").trim().toLowerCase();
        if (dir !== "in" && dir !== "out") {
          return res
            .status(400)
            .json({ error: `Row ${i + 1}: direction must be "in" or "out"` });
        }
        const qty = Number(row.quantity);
        if (!(qty > 0)) {
          return res
            .status(400)
            .json({ error: `Row ${i + 1}: quantity must be greater than zero` });
        }
        const date = String(row.date ?? "").trim();
        if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) {
          return res
            .status(400)
            .json({ error: `Row ${i + 1}: date must be YYYY-MM-DD` });
        }
        const rowReason = String(row.reason ?? reason).trim() || reason;
        validated.push({
          direction: dir as "in" | "out",
          quantity: qty,
          movementDate: date,
          reason: rowReason,
        });
      }

      // Create all movements
      const created: any[] = [];
      for (const v of validated) {
        const item = await StockMovement.create({
          clientId,
          productId: product.id,
          itemName: product.name,
          sku: product.sku,
          unit: product.unitOfMeasure || "unit",
          direction: v.direction,
          quantity: v.quantity,
          unitCost: product.unitCost || 0,
          reason: v.reason,
          notes,
          movementDate: v.movementDate,
          warehouse: body.warehouse || null,
          status: status as "draft" | "confirmed",
          createdById: req.user!.userId,
          createdByName: req.user!.email,
          ...(status === "confirmed"
            ? {
                confirmedById: req.user!.userId,
                confirmedByName: req.user!.email,
                confirmedAt: db.nowISO(),
              }
            : {}),
        } as any);
        created.push(item);
      }

      trackAction(req, "stock.bulk_created", product.id, {
        entityType: "stock",
        entityRef: product.sku ?? product.name,
        count: created.length,
        status,
      });

      // Trigger forecast recompute asynchronously
      const { recomputeAll } = await import("../services/forecast-service.js");
      recomputeAll(clientId).catch((err: any) =>
        console.error("  ⚠ Forecast recompute after bulk stock import failed:", err),
      );

      res.status(201).json({ created: created.length, movements: created });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

/** POST /stock-movements/:id/confirm — flip a draft into the live stock (atomic). */
router.post(
  "/stock-movements/:id/confirm",
  authMiddleware,
  async (req, res) => {
    try {
      const clientId = req.user!.userId;
      const current = await StockMovement.get(req.params.id);
      if (!current)
        return res.status(404).json({ error: "Movement not found" });
      if (
        current.goodsReceiptId ||
        current.invoiceId ||
        current.purchaseInvoiceId ||
        current.goodsDispatchId
      ) {
        return res
          .status(400)
          .json({
            error:
              "This movement is created by its linked document — manage it from the GRN, invoice or dispatch instead",
          });
      }
      if (current.status === "cancelled") {
        return res
          .status(400)
          .json({ error: "Cannot confirm a cancelled movement" });
      }
      const flipped = await StockMovement.confirm(
        current.id,
        req.user!.userId,
        req.user!.email,
      );
      trackAction(req, "stock.confirmed", current.id, {
        entityType: "stock",
        entityRef: current.sku ?? current.itemName,
        direction: current.direction,
        quantity: current.quantity,
      });
      if (!flipped) return res.json({ ...current, alreadyConfirmed: true });
      recomputeForecast(clientId);
      res.json(flipped);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

/** POST /stock-movements/:id/cancel — cancel a manual movement (drafts or confirmed). */
router.post("/stock-movements/:id/cancel", authMiddleware, async (req, res) => {
  try {
    const current = await StockMovement.get(req.params.id);
    if (!current) return res.status(404).json({ error: "Movement not found" });
    // Platform staff may manage any client's manual entries; clients only theirs.
    if (
      current.clientId !== req.user!.userId &&
      !isStaffAccount(req.user?.roles)
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (
      current.goodsReceiptId ||
      current.invoiceId ||
      current.purchaseInvoiceId ||
      current.goodsDispatchId
    ) {
      return res
        .status(400)
        .json({
          error:
            "This movement is created by its linked document — cancel the GRN, invoice or dispatch instead",
        });
    }
    if (current.status === "cancelled")
      return res.json({ ...current, alreadyCancelled: true });
    // Atomic → cancelled flip: exactly one concurrent cancel wins.
    const flipped = await StockMovement.cancel(
      current.id,
      req.user!.userId,
      req.user!.email,
    );
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
    recomputeForecast(current.clientId);
    res.json(flipped);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/stock-movements/:id", authMiddleware, async (req, res) => {
  try {
    const current = await StockMovement.get(req.params.id);
    if (current) {
      if (
        current.clientId !== req.user!.userId &&
        !isStaffAccount(req.user?.roles)
      ) {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (
        current.goodsReceiptId ||
        current.invoiceId ||
        current.purchaseInvoiceId ||
        current.goodsDispatchId
      ) {
        return res
          .status(400)
          .json({
            error:
              "This movement is created by its linked document — manage it from the GRN, invoice or dispatch instead",
          });
      }
      if (current.status === "confirmed") {
        return res
          .status(400)
          .json({
            error:
              "Confirmed movements cannot be deleted — cancel them instead",
          });
      }
    }
    await StockMovement.remove(req.params.id);
    // Trigger forecast recompute asynchronously (fire-and-forget) against the
    // movement's own client scope.
    const { recomputeAll } = await import("../services/forecast-service.js");
    recomputeAll(current?.clientId ?? req.user!.userId).catch((err: any) =>
      console.error(
        "  ⚠ Forecast recompute after stock movement deletion failed:",
        err,
      ),
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
    const current = await StockMovement.get(req.params.id);
    if (!current) return res.status(404).json({ error: "Movement not found" });
    if (
      current.goodsReceiptId ||
      current.invoiceId ||
      current.purchaseInvoiceId ||
      current.goodsDispatchId
    ) {
      return res
        .status(400)
        .json({
          error:
            "This movement is created by its linked document — manage it from the GRN, invoice or dispatch instead",
        });
    }
    if (current.status === "cancelled") {
      return res
        .status(400)
        .json({ error: "Cancelled movements cannot be edited" });
    }
    const body = req.body || {};

    // Same strict validation as manual creation.
    if (body.quantity !== undefined && !(Number(body.quantity) > 0)) {
      return res
        .status(400)
        .json({ error: "Quantity must be greater than zero" });
    }
    if (
      body.direction !== undefined &&
      !["in", "out"].includes(body.direction)
    ) {
      return res
        .status(400)
        .json({ error: "Direction must be Credit (in) or Debit (out)" });
    }
    if (
      body.reason !== undefined &&
      !MANUAL_MOVEMENT_REASONS.includes(body.reason)
    ) {
      return res
        .status(400)
        .json({
          error:
            "Manual entries require a movement reason — Opening stock, Stock adjustment, Damage, Samples / internal use, Customer return or Supplier return",
        });
    }
    if (body.notes !== undefined && !String(body.notes).trim()) {
      return res
        .status(400)
        .json({ error: "Notes are required for every manual inventory entry" });
    }
    if (
      body.unitCost !== undefined &&
      body.unitCost !== null &&
      body.unitCost !== ""
    ) {
      const uc = Number(body.unitCost);
      if (!Number.isFinite(uc) || uc < 0) {
        return res
          .status(400)
          .json({ error: "Unit cost must be greater than or equal to zero" });
      }
      body.unitCost = uc;
    }
    // Changing the product re-snapshots SKU / name / unit from the catalogue
    // (users never type those — the item identity always comes from the product).
    if (body.productId !== undefined && body.productId !== current.productId) {
      const product = await Product.get(body.productId);
      if (!product)
        return res
          .status(400)
          .json({ error: "The selected catalogue product no longer exists" });
      body.itemName = product.name;
      body.sku = product.sku;
      body.unit = product.unitOfMeasure || "unit";
    }

    const updated = await StockMovement.update(current.id, body);
    recomputeForecast(current.clientId);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== DEBTORS =====================
router.get("/debtors", authMiddleware, async (req, res) => {
  try {
    res.json(await Debtor.list());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.get("/debtors/:id", authMiddleware, async (req, res) => {
  try {
    const item = await Debtor.get(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });
    res.json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.post("/debtors", authMiddleware, async (req, res) => {
  try {
    const item = await Debtor.create(req.body);
    // Auto-create the default approved term from the legacy single-term
    // fields so every customer satisfies "terms are mandatory" (PDF §1).
    // Failures here must not roll back the debtor itself.
    try {
      const body = req.body || {};
      const clientId = (item as any).clientId ?? (req.user as any)?.userId ?? null;
      const advancePct =
        body.paymentTermsType === "advance_full"
          ? 100
          : Number(body.advancePct) || 0;
      const { formatPaymentTerms, balancePctFor, defaultDispatchConditionFor } =
        await import("../lib/payment-terms.js");
      const name =
        formatPaymentTerms({
          paymentTermsType: body.paymentTermsType ?? null,
          advancePct: advancePct || null,
          paymentTermsDays: body.paymentTermsDays ?? null,
          paymentTerms: body.paymentTerms ?? null,
        }) || "Default terms";
      if (clientId) {
        const term = await DebtorTerm.create(clientId, item.id, {          name,
          paymentTermsType: body.paymentTermsType ?? null,
          paymentTerms: body.paymentTerms ?? null,
          advancePct,
          balancePct: balancePctFor(advancePct),
          balanceDueDays:
            !body.paymentTermsType ||
            body.paymentTermsType === "credit" ||
            body.paymentTermsType === "on_delivery" ||
            body.paymentTermsType === "advance_partial"
              ? Math.max(0, Math.floor(Number(body.paymentTermsDays) || 0))
              : 0,
          dispatchCondition: defaultDispatchConditionFor(
            body.paymentTermsType ?? "credit",
            advancePct,
          ),
          isDefault: true,
        });
        await Debtor.update(item.id, { defaultPaymentTermId: term.id } as any);
      }
    } catch (e: any) {
      console.error("  ⚠ default payment-term auto-create failed:", e?.message ?? e);
    }
    res.status(201).json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.put("/debtors/:id", authMiddleware, async (req, res) => {
  try {
    res.json(await Debtor.update(req.params.id, req.body));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.delete("/debtors/:id", authMiddleware, async (req, res) => {
  try {
    await Debtor.remove(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============ DEBTOR PAYMENT TERMS (PDF §1: multiple terms, one default) ====
router.get("/debtors/:id/payment-terms", authMiddleware, async (req, res) => {
  try {
    const debtor = await Debtor.get(req.params.id);
    if (!debtor) return res.status(404).json({ error: "Debtor not found" });
    res.json(await DebtorTerm.listByDebtor(req.params.id));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.post("/debtors/:id/payment-terms", authMiddleware, async (req, res) => {
  try {
    const debtor = await Debtor.get(req.params.id);
    if (!debtor) return res.status(404).json({ error: "Debtor not found" });
    const clientId = (req.user as any)?.userId ?? "api";
    const term = await DebtorTerm.create(clientId, req.params.id, req.body || {});
    if (term.isDefault) {
      await Debtor.update(req.params.id, { defaultPaymentTermId: term.id } as any);
    }
    trackAction(req, "debtor_term.created", term.id, {
      entityType: "debtor_term", debtorId: req.params.id, name: term.name,
    });
    res.status(201).json(term);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
router.put("/debtors/:id/payment-terms/:termId", authMiddleware, async (req, res) => {
  try {
    const updated = await DebtorTerm.update(req.params.id, req.params.termId, req.body || {});
    if (!updated) return res.status(404).json({ error: "Payment term not found" });
    if (updated.isDefault) {
      await Debtor.update(req.params.id, { defaultPaymentTermId: updated.id } as any);
    }
    trackAction(req, "debtor_term.updated", updated.id, {
      entityType: "debtor_term", debtorId: req.params.id, name: updated.name,
    });
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
router.post("/debtors/:id/payment-terms/:termId/set-default", authMiddleware, async (req, res) => {
  try {
    const updated = await DebtorTerm.setDefault(req.params.id, req.params.termId);
    if (!updated) return res.status(404).json({ error: "Payment term not found" });
    await Debtor.update(req.params.id, { defaultPaymentTermId: updated.id } as any);
    trackAction(req, "debtor_term.set_default", updated.id, {
      entityType: "debtor_term", debtorId: req.params.id, name: updated.name,
    });
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
router.delete("/debtors/:id/payment-terms/:termId", authMiddleware, async (req, res) => {
  try {
    await DebtorTerm.remove(req.params.id, req.params.termId);
    trackAction(req, "debtor_term.deleted", req.params.termId, {
      entityType: "debtor_term", debtorId: req.params.id,
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ===================== WORKFLOW ENGINE (PDF-3) =====================
// Unified tasks, per-document timelines, payment receipts, notifications.

// ---- Tasks ----
router.get("/workflow-tasks", authMiddleware, async (req, res) => {
  try {
    const scopeAll = req.query.scope === "all";
    // status=done returns recently completed tasks for the queue's Completed filter.
    const tasks =
      req.query.status === "done"
        ? await WorkflowTask.listRecentDone(100, scopeAll ? undefined : effectiveListScope(req))
        : await WorkflowTask.listOpen(scopeAll ? undefined : effectiveListScope(req));
    const withOverdue = tasks.map((t) => ({ ...t, overdue: WorkflowTask.isOverdue(t) }));
    // Personal queue first (assigned to me), then role queue, then rest.
    const me = req.user!.email;
    const roleOf = (req.user!.roles ?? []) as string[];
    const rank = (t: any) =>
      t.assignedUser === me || t.assignedUser === req.user!.userId ? 0
      : roleOf.includes(t.ownerRole) || t.ownerRole === "sales" && roleOf.includes("client") ? 1 : 2;
    withOverdue.sort((a: any, b: any) => rank(a) - rank(b) || String(b.createdAt).localeCompare(String(a.createdAt)));
    res.json(withOverdue);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.get("/workflow-tasks/doc/:docType/:docId", authMiddleware, async (req, res) => {
  try {
    res.json(await WorkflowTask.listForDoc(req.params.docType, req.params.docId));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Timeline ----
router.get("/timeline/:docType/:docId", authMiddleware, async (req, res) => {
  try {
    const entries = await DocTimeline.listForDoc(req.params.docType, req.params.docId);
    const notifs = await NotificationLog.listForDoc(req.params.docType, req.params.docId);
    res.json({ entries, notifications: notifs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.post("/timeline/:docType/:docId", authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.text?.trim() && !body.attachment)
      return res.status(400).json({ error: "Write an update or attach a file" });
    const entry = await DocTimeline.addEntry({
      clientId: req.user!.userId,
      docType: req.params.docType,
      docId: req.params.docId,
      docNumber: body.docNumber ?? null,
      kind: body.kind || "note",
      actorId: req.user!.userId,
      actorEmail: req.user!.email,
      actorRoles: req.user!.roles ?? [],
      text: body.text?.trim() || null,
      attachment: body.attachment || null,
      mentionedUser: body.mentionedUser || null,
    });
    trackAction(req, "timeline.note_added", entry.id, {
      entityType: "timeline", docType: req.params.docType, docId: req.params.docId,
    });
    // Mention emails the mentioned user directly (spec §6).
    if (body.mentionedUser) {
      void (async () => {
        try {
          const { notifyWorkflowTask } = await import("../email.js");
          await notifyWorkflowTask({
            taskName: "You were mentioned",
            docNumber: body.docNumber ?? req.params.docId,
            requiredAction: body.text?.trim()?.slice(0, 120) || "See the update",
            ownerRole: "client",
            submittedBy: req.user!.email,
            appPath: "/app/workspace",
          });
        } catch (e) { console.error("  ⚠ Mention email failed:", e); }
      })();
    }
    res.status(201).json(entry);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Payment receipts (Sales submits → Treasury verifies) ----
router.get("/payment-receipts", authMiddleware, async (req, res) => {
  try {
    res.json(await PaymentReceipt.list(effectiveListScope(req)));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.post("/payment-receipts", authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    const item = await PaymentReceipt.submit({
      clientId: req.user!.userId,
      salesOrderId: body.salesOrderId ?? body.sales_order_id ?? null,
      salesOrderNumber: body.salesOrderNumber ?? body.sales_order_number ?? null,
      proformaId: body.proformaId ?? body.proforma_id ?? null,
      proformaNumber: body.proformaNumber ?? body.proforma_number ?? null,
      invoiceId: body.invoiceId ?? body.invoice_id ?? null,
      invoiceNumber: body.invoiceNumber ?? body.invoice_number ?? null,
      amount: Number(body.amount) || 0,
      utr: body.utr ?? null,
      paymentMode: body.paymentMode ?? body.payment_mode ?? null,
      proofName: body.proofName ?? body.proof_name ?? null,
      proofUrl: body.proofUrl ?? body.proof_url ?? null,
      submittedBy: req.user!.email,
    });
    timelineStatus(req, { clientId: req.user!.userId, docType: "payment", docId: item.id, docNumber: item.utr },
      null, "submitted", `Payment proof submitted by ${req.user!.email} — ₹${item.amount}${item.utr ? ` · UTR ${item.utr}` : ""}`, "payment_proof");
    advanceWorkflow(req, {
      workflowType: item.proformaId ? "proforma" : "sales_invoice",
      stage: "payment_confirmation",
      docType: "payment",
      docId: item.id,
      docNumber: item.utr || item.proformaNumber || item.invoiceNumber,
      counterparty: null,
      docStatus: "submitted",
      ownerRole: "treasury",
      requiredAction: "Verify payment and UTR",
      nextAction: "Release next workflow step",
      amount: item.amount,
      paymentStatus: "submitted",
      linkedDocs: [
        ...(item.salesOrderId ? [{ type: "sales_order", id: item.salesOrderId, number: item.salesOrderNumber }] : []),
        ...(item.proformaId ? [{ type: "proforma", id: item.proformaId, number: item.proformaNumber }] : []),
        ...(item.invoiceId ? [{ type: "sales_invoice", id: item.invoiceId, number: item.invoiceNumber }] : []),
      ],
    }, { timelineKind: "payment_proof", docType: "payment", appPath: "/app/queue" });
    res.status(201).json(item);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
router.post("/payment-receipts/:id/verify", authMiddleware, requireRole("treasury", "factor_admin"), async (req, res) => {
  try {
    const body = req.body || {};
    const item = await PaymentReceipt.verify(req.params.id, {
      receiptDate: body.receiptDate ?? body.receipt_date ?? "",
      collectionAccount: body.collectionAccount ?? body.collection_account ?? null,
      paymentMode: body.paymentMode ?? body.payment_mode ?? null,
      verifiedBy: req.user!.email,
    });
    await WorkflowTask.closeTasksForDoc("payment", item.id, req.user, "Payment verified");
    timelineStatus(req, { clientId: item.clientId, docType: "payment", docId: item.id, docNumber: item.utr },
      "submitted", "verified", `Treasury verified ₹${item.amount} on ${item.receiptDate}`, "payment_proof");
    // Advance → Paid cascade: proforma paid + next Finance task (PDF-2 §6).
    if (item.proformaId) {
      try {
        const pf = await PurchaseOrder.get(item.proformaId);
        const total = await PaymentReceipt.verifiedTotalForProforma(item.proformaId);
        const agreed = Number((pf as any)?.advanceAmount) || 0;
        if (pf && total >= agreed) {
          await PurchaseOrder.update(item.proformaId, { proformaStatus: "paid", paymentReference: item.utr } as any);
          timelineStatus(req, { clientId: item.clientId, docType: "proforma", docId: item.proformaId, docNumber: item.proformaNumber },
            (pf as any).proformaStatus, "paid", `Advance verified — ₹${total} received`);
          // Next Finance task: Create Final Sales Invoice.
          const so = (pf as any).linkedGoodsSoId ? await GoodsSO.get((pf as any).linkedGoodsSoId).catch(() => null) : null;
          if (so) {
            advanceWorkflow(req, {
              clientId: item.clientId,
              workflowType: "sales_order",
              stage: "create_invoice",
              docType: "sales_order",
              docId: so.id,
              docNumber: so.soNumber,
              counterparty: so.customerName,
              docStatus: so.status,
              ownerRole: "treasury",
              requiredAction: "Create Final Sales Invoice",
              nextAction: "Send invoice for approval / IRN",
              amount: Number(so.grandTotal) || 0,
              paymentStatus: "advance_verified",
              linkedDocs: [{ type: "proforma", id: item.proformaId, number: item.proformaNumber }],
            }, { timelineKind: "system", docType: "sales_order", appPath: "/app/invoices" });
          }
        }
      } catch (e: any) { console.error("  ⚠ Proforma paid cascade failed:", e?.message ?? e); }
    }
    try {
      const _s = await WorkflowSettings.get(item.clientId).catch(() => null);
      if (_s?.emailOnApproval !== false) {
        const { notifyWorkflowTask } = await import("../email.js");
        const r = await notifyWorkflowTask({
          taskName: "Payment verified", docNumber: item.utr || item.proformaNumber || item.invoiceNumber || item.id,
          requiredAction: `₹${item.amount} verified by Treasury`, ownerRole: "client",
          submittedBy: req.user!.email, appPath: "/app/workspace",
        });
        await NotificationLog.log({
          clientId: item.clientId, kind: "approval", taskId: null, docType: "payment",
          docId: item.id, docNumber: item.utr, recipients: r.recipients,
          subject: `Payment verified — ${item.utr || ""}`, sent: r.sent, error: r.sent ? null : "failed",
        });
      }
    } catch (e) { console.error("  ⚠ Verify email failed:", e); }
    res.json(item);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
router.post("/payment-receipts/:id/reject", authMiddleware, requireRole("treasury", "factor_admin"), async (req, res) => {
  try {
    const item = await PaymentReceipt.reject(req.params.id, String(req.body?.reason ?? ""), req.user!.email);
    await WorkflowTask.closeTasksForDoc("payment", item.id, req.user, "Payment proof rejected");
    timelineStatus(req, { clientId: item.clientId, docType: "payment", docId: item.id, docNumber: item.utr },
      "submitted", "rejected", `Treasury rejected proof: ${item.rejectReason}`, "rejection");
    res.json(item);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ---- Notification settings ----
router.get("/workflow-settings", authMiddleware, async (req, res) => {
  try {
    res.json(await WorkflowSettings.get(req.user!.userId));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.put("/workflow-settings", authMiddleware, requireAdmin, async (req, res) => {
  try {
    res.json(await WorkflowSettings.update(req.user!.userId, req.body || {}));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== VENDORS =====================
router.get("/vendors", authMiddleware, async (req, res) => {
  try {
    res.json(await Vendor.list(effectiveListScope(req)));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.post("/vendors", authMiddleware, async (req, res) => {
  try {
    res
      .status(201)
      .json(await Vendor.create({ ...req.body, clientId: req.user!.userId }));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.put("/vendors/:id", authMiddleware, async (req, res) => {
  try {
    res.json(await Vendor.update(req.params.id, req.body));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.delete("/vendors/:id", authMiddleware, async (req, res) => {
  try {
    await Vendor.remove(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== SUPPLIERS =====================
router.get("/suppliers", authMiddleware, async (req, res) => {
  try {
    res.json(await Supplier.list());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.post("/suppliers", authMiddleware, async (req, res) => {
  try {
    res.status(201).json(await Supplier.create(req.body));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.put("/suppliers/:id", authMiddleware, async (req, res) => {
  try {
    res.json(await Supplier.update(req.params.id, req.body));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.delete("/suppliers/:id", authMiddleware, async (req, res) => {
  try {
    await Supplier.remove(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== INVOICES (Sales) =====================

// Public token-authenticated endpoint: send reminder to debtor (clicked from admin email)
router.get(
  "/invoices/:id/remind-debtor/:token",
  publicTokenLimiter,
  async (req, res) => {
    try {
      const { sendReminderToDebtor } = await import("../invoice-reminder.js");
      const result = await sendReminderToDebtor(
        req.params.id,
        req.params.token,
      );
      if (result.success) {
        res.send(
          `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Reminder Sent</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f5f7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:16px;} .card{background:#fff;border-radius:12px;padding:32px;max-width:480px;box-shadow:0 1px 3px rgba(0,0,0,0.08);text-align:center;} h1{font-size:20px;color:#059669;margin:0 0 8px;} p{font-size:14px;color:#64748b;margin:0 0 4px;line-height:1.5;} .emoji{font-size:48px;margin-bottom:12px;}</style></head><body><div class="card"><div class="emoji">✅</div><h1>Reminder Forwarded!</h1><p>${result.message}</p></div></body></html>`,
        );
      } else {
        res
          .status(400)
          .send(
            `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f5f7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:16px;} .card{background:#fff;border-radius:12px;padding:32px;max-width:480px;box-shadow:0 1px 3px rgba(0,0,0,0.08);text-align:center;} h1{font-size:20px;color:#dc2626;margin:0 0 8px;} p{font-size:14px;color:#64748b;margin:0 0 4px;line-height:1.5;} .emoji{font-size:48px;margin-bottom:12px;}</style></head><body><div class="card"><div class="emoji">❌</div><h1>Could Not Send Reminder</h1><p>${result.message}</p></div></body></html>`,
          );
      }
    } catch (err: any) {
      console.error("[remind-debtor] Failed to send reminder:", err);
      res
        .status(500)
        .send(
          `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error</title></head><body><h1>Error</h1><p>Something went wrong. Please try again later.</p></body></html>`,
        );
    }
  },
);

/**
 * Validate sales-invoice lines against the product catalogue and snapshot them.
 * SKUs must come from the catalogue; quantity > 0 and unit price >= 0.
 * Creating an invoice NEVER creates inventory — only a confirmed dispatch debits.
 */
async function validateInvoiceLines(clientId: string | undefined, rawLines: any[]) {
  const lines = Array.isArray(rawLines) ? rawLines : [];
  if (lines.length === 0) throw new Error("Add at least one product line");
  const products = await Product.list(clientId);
  const productById = new Map(products.map((p: any) => [p.id, p]));
  for (const l of lines) {
    if (!l.productId)
      throw new Error("Every line must select a product from the catalogue");
    if (!productById.has(l.productId))
      throw new Error("Every SKU must come from the product catalogue");
    if (!(Number(l.quantity) > 0))
      throw new Error("Quantity must be greater than zero");
    if (Number(l.unitPrice) < 0)
      throw new Error(
        "Unit selling price must be greater than or equal to zero",
      );
    applyVariantSnapshot(l, productById.get(l.productId));
  }
  return lines;
}

// ── Colour/size variant snapshots on document lines ─────────────────────────
// Document lines keep snapshot copies (sku, name, unit…) so later catalogue
// edits never rewrite history. Colour/size are snapshotted the same way so
// printed line items and PDFs can show "Black · 42" for variant SKUs.

/** Copy colour/size attributes from a catalogue product onto a document line. */
function applyVariantSnapshot(line: any, product: any): void {
  if (!line || !product) return;
  const color = product.color ?? null;
  const size = product.size ?? null;
  if (color !== null && color !== undefined) line.color = color;
  else delete line.color;
  if (size !== null && size !== undefined) line.size = size;
  else delete line.size;
}

/** Copy colour/size snapshots from a linked document's line (PO→PI, PO→GRN…). */
function copyVariantSnapshot(line: any, sourceLine: any): void {
  if (!line || !sourceLine) return;
  applyVariantSnapshot(line, sourceLine);
}

/**
 * Snapshot Tally-print fields onto a sales-invoice line: HSN code from the
 * catalogue (never re-looked-up later) and the tax-inclusive rate default.
 * An explicitly supplied rateInclTax is kept so the print matches Tally.
 */
function applyInvoicePrintSnapshot(line: any, product: any): void {
  if (!line) return;
  if ((line.hsnCode === undefined || line.hsnCode === null || line.hsnCode === "") && product) {
    const hsn = product.hsnCode ?? product.hsn_code ?? null;
    if (hsn) line.hsnCode = hsn;
  }
  if (line.rateInclTax === undefined || line.rateInclTax === null) {
    const base = Number(line.unitPrice) || 0;
    const gst = Number(line.gstRate ?? product?.gstRate ?? product?.gst_rate ?? 0) || 0;
    line.rateInclTax = Math.round(base * (1 + gst / 100) * 100) / 100;
  }
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
        (String(p.proformaNumber ?? "") === needle ||
          String(p.poNumber ?? "") === needle),
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
    if (pf.side !== side)
      throw new Error(`The linked proforma is not a ${side} proforma`);
    pfNumber = pf.proformaNumber ?? pf.poNumber ?? null;
  }
  const advances = await Advance.list(clientId);
  const paid = (advances as any[])
    .filter(
      (a) =>
        a.side === side &&
        a.purchaseOrderId === pfId &&
        a.status !== "refunded",
    )
    .reduce((s: number, a: any) => s + (Number(a.amount) || 0), 0);
  // The proforma's agreed advance % (set when it was created from a purchase
  // order) drives the deduction too — it covers the expected advance even
  // before treasury has funded it. Whichever is larger (agreed % vs the
  // amount actually paid) is what is deducted.
  const pctAdvance =
    Number(pf?.advancePct) > 0
      ? Math.round(
          (((Number(pf.poAmount) || Number(pf.amount) || 0) *
            Number(pf.advancePct)) /
            100) *
            100,
        ) / 100
      : 0;
  return {
    proformaId: pfId,
    proformaNumber: pfNumber,
    advanceDeducted: Math.round(Math.max(paid, pctAdvance) * 100) / 100,
  };
}

/**
 * Payment-condition gate for final-invoice creation (PDF-2 §4/§7).
 * Reads the SO's permanent term snapshot + Treasury-verified receipts:
 * - no_check (Net 30/60): client acceptance is enough.
 * - advance_required: agreed advance (proforma advanceAmount or
 *   SO value × advance %) must be verified.
 * - full_required: the full invoice value must be verified.
 */
async function assertPaymentConditionForInvoice(so: any, lines: any[]): Promise<void> {
  const condition = (so as any).dispatchCondition ?? "no_check";
  if (condition === "no_check") return;
  const lineTotal = lines.reduce((s: number, l: any) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0) * (1 - (Number(l.discountPct) || 0) / 100), 0);
  const gstEst = lines.reduce((s: number, l: any) => {
    const net = (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0) * (1 - (Number(l.discountPct) || 0) / 100);
    return s + (net * (Number(l.gstRate) || 0)) / 100;
  }, 0);
  const invoiceValue = Math.round((lineTotal + gstEst) * 100) / 100;
  // Verified money = receipts against any proforma/invoice of this order.
  const receipts = await PaymentReceipt.list((so as any).clientId).catch(() => [] as any[]);
  const mine = (receipts as any[]).filter(
    (r) => r.status === "verified" && (r.salesOrderId === so.id || (r.proformaId && r.proformaNumber)),
  );
  const byProforma = new Map<string, number>();
  for (const r of mine) {
    if (r.proformaId) byProforma.set(r.proformaId, (byProforma.get(r.proformaId) ?? 0) + Number(r.amount));
  }
  const verified = [...byProforma.values()].reduce((s, v) => s + v, 0)
    + mine.filter((r) => !r.proformaId).reduce((s, r) => s + Number(r.amount), 0);
  if (condition === "advance_required") {
    const advancePct = Number((so as any).advancePct ?? 0) || 0;
    const soValue = Number(so.grandTotal) || invoiceValue;
    const required = Math.round(soValue * (advancePct / 100) * 100) / 100;
    if (verified + 0.005 < required) {
      throw new Error(`Advance payment pending — ₹${verified.toLocaleString("en-IN")} verified of ₹${required.toLocaleString("en-IN")} required`);
    }
    return;
  }
  if (condition === "full_required") {
    if (verified + 0.005 < invoiceValue) {
      throw new Error(`Balance payment pending — ₹${verified.toLocaleString("en-IN")} verified of ₹${invoiceValue.toLocaleString("en-IN")} required`);
    }
  }
}

/**
 * Validate a sales invoice against its linked sales order: the SO must be
 * confirmed/open (never draft or cancelled), the invoice customer must be the
 * SO customer, and every line must reference a product on the SO with a
 * quantity that fits the ordered quantity.
 *
 * Additionally, the SO must have warehouse sign-off (warehouseStatus === "approved")
 * to be eligible for invoicing from the sales invoice tab as a "pending sales order".
 */
function assertInvoiceMatchesSO(
  so: any,
  lines: any[],
  debtorId: string | null,
) {
  if (!so) throw new Error("Linked sales order not found");
  if (so.status === "cancelled")
    throw new Error("Cannot invoice against a cancelled sales order");
  if (so.status === "draft" || so.status === "pending_review")
    throw new Error("Confirm the sales order before invoicing");
  if (so.warehouseStatus !== "approved") {
    throw new Error(
      "Sales order must have warehouse sign-off (approved) before invoicing",
    );
  }
  if (debtorId && so.customerId && debtorId !== so.customerId) {
    throw new Error(
      "The invoice customer must match the linked sales order's customer",
    );
  }
  for (const l of lines) {
    if (!l.productId) continue; // catalogue check validates product selection
    const soLine = (so.lines ?? []).find(
      (x: any) => x.productId === l.productId,
    );
    if (!soLine) {
      throw new Error(
        `"${l.name || l.productId}" is not on the linked sales order`,
      );
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
    // Platform staff (non-client roles) also read across the whole portfolio.
    const scopeAll = req.query.scope === "all";
    res.json(await Invoice.list(scopeAll ? undefined : effectiveListScope(req)));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.get("/invoices/:id", authMiddleware, async (req, res) => {
  try {
    const item = await Invoice.get(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });
    res.json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /invoices/:id/pdf — download the Tally-style tax-invoice PDF. */
router.get("/invoices/:id/pdf", authMiddleware, async (req, res) => {
  try {
    const inv = await Invoice.get(req.params.id);
    if (!inv || (inv.clientId !== req.user!.userId && !isStaffAccount(req.user?.roles))) {
      return res.status(404).json({ error: "Invoice not found" });
    }
    const { pdf, number } = await buildInvoiceTallyBuffer(inv, inv.clientId);
    const filename = `${(number || "invoice").replace(/[^A-Za-z0-9-_]/g, "_")}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(pdf);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
      return res
        .status(403)
        .json({ error: "Only the invoice owner or an admin can send the NOA" });
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
        error:
          "SMTP is not configured — set SMTP_HOST / SMTP_USER / SMTP_PASS to send the NOA email",
      });
    }

    if (!inv.noaToken) {
      return res
        .status(400)
        .json({
          error:
            "Invoice has no NOA token — cannot build the verification link",
        });
    }

    // Build the invoice PDF (Tally-style tax invoice + e-Way Bill section).
    const { pdf, number, grandTotal } = await buildInvoiceTallyBuffer(inv, inv.clientId);
    const companyName = "Adventra";

    const filename = `${number.replace(/[^A-Za-z0-9-_]/g, "_")}.pdf`;
    const noaUrl = `${config.appUrl}/noa/${inv.noaToken}`;
    const { sendInvoiceNoaEmail } = await import("../email.js");
    const sent = await sendInvoiceNoaEmail({
      invoiceNumber: inv.invoiceNumber,
      amount: grandTotal,
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
      return res
        .status(400)
        .json({
          error: "Failed to send the email — check the SMTP configuration",
        });
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
      console.error(
        `  ⚠ Failed to create NOA reminder log for ${inv.invoiceNumber}:`,
        err,
      );
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
    if (!body.debtorId)
      return res.status(400).json({ error: "Select a customer" });
    // Goods invoices always carry catalogue lines.
    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      return res.status(400).json({ error: "Add at least one product line" });
    }
    try {
      body.lines = await validateInvoiceLines(clientId, body.lines);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
    // The sales order link is MANDATORY: every invoice bills against a
    // confirmed sales order, and its lines must come from that order.
    if (!body.goodsSalesOrderId)
      return res
        .status(400)
        .json({ error: "A linked sales order is required" });
    const so = await GoodsSO.get(body.goodsSalesOrderId);
    if (!so)
      return res.status(404).json({ error: "Linked sales order not found" });
    try {
      assertInvoiceMatchesSO(so, body.lines ?? [], body.debtorId);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
    // Payment-condition gate (PDF-2 §4/§7): orders carrying a permanent
    // term snapshot can only be invoiced once Treasury verified enough.
    // Legacy orders without a snapshot keep the old behavior.
    if ((so as any).paymentTermId) {
      try {
        await assertPaymentConditionForInvoice(so, body.lines ?? []);
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }
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
      invoiceNumber:
        body.invoiceNumber || `INV-${uuid().slice(0, 8).toUpperCase()}`,
      status: body.status || "draft",
    });
    trackAction(req, "invoice.created", item.id, {
      entityType: "invoice",
      entityRef: item.invoiceNumber,
      amount: item.amount,
      status: item.status,
      clientId,
    });
    timelineStatus(req, { clientId, docType: "sales_invoice", docId: item.id, docNumber: item.invoiceNumber },
      null, "draft", `Finance created final invoice ${item.invoiceNumber} from ${so.soNumber}`);
    await WorkflowTask.closeTasksForDoc("sales_order", so.id, req.user, "Final invoice created");
    try {
      await GoodsSO.update(so.id, {
        workflowStatus: "invoice_pending",
        currentOwnerRole: "treasury",
        nextRequiredAction: "Approve invoice and record IRN",
      });
    } catch { /* non-fatal */ }
    // Cash-flow sync: create expected customer collection from invoice
    (async () => {
      try {
        const { syncInvoiceToInflow } = await import("../services/cash-flow-sync.js");
        await syncInvoiceToInflow(item);
      } catch (err: any) {
        console.error("  ⚠ Cash-flow sync after invoice creation failed:", err?.message ?? err);
      }
    })();
    // Instant reminder check: if due date is close or past, send reminder immediately
    if (
      item.dueDate &&
      item.status !== "paid" &&
      item.status !== "rejected" &&
      item.status !== "draft"
    ) {
      // Fire-and-forget — don't block the response. Respects the admin's
      // automatic-reminders on/off setting.
      const { autoSendReminderOnChange } = await import("../invoice-reminder.js");
      void autoSendReminderOnChange(item.id, "sales");
    }
    res.status(201).json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /invoices/:id/issue — flip a draft into the review queue (Issued). */
router.post("/invoices/:id/issue", authMiddleware, async (req, res) => {
  try {
    const current = await Invoice.get(req.params.id);
    if (!current) return res.status(404).json({ error: "Invoice not found" });
    if (current.status === "cancelled")
      return res
        .status(400)
        .json({ error: "Cannot issue a cancelled invoice" });
    if (current.status === "paid")
      return res.status(400).json({ error: "Invoice is already paid" });
    // Idempotent re-issue: an already-issued invoice just stays issued.
    if (current.status !== "draft")
      return res.json({ ...current, alreadyIssued: true });
    // Every invoice that enters the review/funding queue must be backed by a
    // confirmed sales order — legacy drafts without a link cannot be issued.
    if (!current.goodsSalesOrderId) {
      return res
        .status(400)
        .json({
          error: "Link a confirmed sales order before issuing this invoice",
        });
    }
    const issueSo = await GoodsSO.get(current.goodsSalesOrderId);
    if (!issueSo || issueSo.status === "cancelled") {
      return res
        .status(400)
        .json({
          error: "Cannot issue an invoice linked to a cancelled sales order",
        });
    }
    if (issueSo.status === "draft") {
      return res
        .status(400)
        .json({ error: "Confirm the sales order before issuing this invoice" });
    }
    const updated = await Invoice.update(current.id, { status: "pending" });
    trackAction(req, "invoice.issued", current.id, {
      entityType: "invoice",
      entityRef: current.invoiceNumber,
      status: "pending",
    });
    // Pending in checker → mail admin, treasury and checker users.
    notifyPendingQueue(req, {
      stage: "checker",
      kind: "sales_invoice",
      number: current.invoiceNumber,
      amount: Number((updated as any)?.grandTotal ?? (updated as any)?.amount ?? current.amount) || 0,
      dueDate: (updated as any)?.dueDate ?? current.dueDate ?? null,
      reviewPath: "/app/checker",
    });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /invoices/:id/irn — record the manually-entered IRN from Tally
 * (v1: manual paste; later the Tally integration writes with source=tally).
 * Only finance/admin/checker may record; the invoice must be approved/issued
 * and have no IRN yet. Recording locks content edits (see PUT guard).
 */
router.post("/invoices/:id/irn", authMiddleware, async (req, res) => {
  try {
    const roles: string[] = req.user!.roles || [];
    const allowed = roles.some((r) =>
      ["factor_admin", "checker", "treasury", "super_admin"].includes(r),
    );
    if (!allowed)
      return res.status(403).json({ error: "Only finance/checker/admin can record the IRN" });
    const body = req.body || {};
    try {
      const updated = await Invoice.recordIrn(req.params.id, {
        irn: String(body.irn ?? ""),
        ackNo: body.ackNo ?? body.ack_no ?? null,
        ackDate: body.ackDate ?? body.ack_date ?? null,
        enteredBy: req.user!.email,
        source: body.source === "tally" ? "tally" : "manual",
      });
      trackAction(req, "invoice.irn_recorded", updated.id, {
        entityType: "invoice",
        entityRef: (updated as any).invoiceNumber,
        ackNo: (updated as any).ackNo,
        ackDate: (updated as any).ackDate,
      });
      timelineStatus(req, { clientId: (updated as any).clientId, docType: "sales_invoice", docId: updated.id, docNumber: (updated as any).invoiceNumber },
        "approved", "irn_generated", `IRN recorded (${String((updated as any).irn).slice(0, 12)}…) — invoice locked`);
      await WorkflowTask.closeTasksForDoc("sales_invoice", updated.id, req.user, "IRN recorded");
      // IRN → auto-create the Dispatch Order pre-filled from invoice + SO
      // (PDF-1 step 8: warehouse receives "Prepare Dispatch Order").
      try {
        const invFull = await Invoice.get(updated.id);
        const soForDispatch = invFull?.goodsSalesOrderId ? await GoodsSO.get(invFull.goodsSalesOrderId).catch(() => null) : null;
        const invLines: any[] = (invFull as any)?.lines ?? [];
        const dispLines = invLines.map((l: any) => ({
          productId: l.productId,
          sku: l.sku ?? null,
          name: l.name,
          unit: l.unit || "unit",
          orderedQty: Number(soForDispatch?.lines?.find((x: any) => x.productId === l.productId)?.orderedQty ?? l.quantity) || 0,
          dispatchedQty: 0,
          deliveredQty: 0,
          returnedQty: 0,
          unitPrice: Number(l.unitPrice) || 0,
          discountPct: l.discountPct ?? null,
          gstRate: l.gstRate ?? null,
          lineValue: 0,
          notes: null,
        }));
        const dispatch = await GoodsDispatch.create({
          clientId: (updated as any).clientId,
          goodsSalesOrderId: invFull?.goodsSalesOrderId || "",
          soNumber: invFull?.goodsSalesOrderNumber ?? soForDispatch?.soNumber ?? null,
          customerId: invFull?.debtorId ?? soForDispatch?.customerId ?? null,
          customerName: soForDispatch?.customerName ?? null,
          contactPerson: soForDispatch?.contactPerson ?? invFull?.customerContact ?? null,
          deliveryAddress: invFull?.deliveryAddress ?? soForDispatch?.deliveryAddress ?? null,
          warehouse: (soForDispatch as any)?.dispatchLocation ?? null,
          finalInvoiceId: updated.id,
          finalInvoiceNumber: (updated as any).invoiceNumber,
          irnSnapshot: (updated as any).irn,
          invoicedValue: Number((updated as any).grandTotal) || 0,
          invoicedGst: Number((updated as any).gstTotal) || 0,
          linkedSalesInvoiceId: updated.id,
          linkedSalesInvoiceNumber: (updated as any).invoiceNumber,
          status: "draft",
          lines: dispLines,
        } as any);
        timelineStatus(req, { clientId: (updated as any).clientId, docType: "dispatch", docId: dispatch.id, docNumber: dispatch.dispatchNumber },
          null, "draft", `Dispatch order auto-created from invoice ${(updated as any).invoiceNumber} — packing + transport pending`);
        advanceWorkflow(req, {
          workflowType: "dispatch",
          stage: "prepare_dispatch",
          docType: "dispatch",
          docId: dispatch.id,
          docNumber: dispatch.dispatchNumber,
          counterparty: dispatch.customerName,
          docStatus: "draft",
          ownerRole: "operations",
          requiredAction: "Prepare Dispatch Order (packing + transport)",
          nextAction: "Submit Dispatch Details to Finance",
          amount: Number((updated as any).grandTotal) || 0,
          inventoryStatus: "reserved",
          linkedDocs: [
            { type: "sales_invoice", id: updated.id, number: (updated as any).invoiceNumber },
            ...(invFull?.goodsSalesOrderId ? [{ type: "sales_order", id: invFull.goodsSalesOrderId, number: invFull.goodsSalesOrderNumber }] : []),
          ],
        }, { timelineKind: "system", docType: "dispatch", appPath: "/app/dispatches" });
      } catch (e: any) {
        console.error("  ⚠ Auto dispatch-order creation failed:", e?.message ?? e);
      }
      res.json(updated);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /invoices/:id/irn — clear a manually-entered IRN for same-day
 * correction. Blocked once dispatch activity references the invoice.
 */
router.delete("/invoices/:id/irn", authMiddleware, async (req, res) => {
  try {
    const roles: string[] = req.user!.roles || [];
    const allowed = roles.some((r) =>
      ["factor_admin", "checker", "treasury", "super_admin"].includes(r),
    );
    if (!allowed)
      return res.status(403).json({ error: "Only finance/checker/admin can clear the IRN" });
    const inv = await Invoice.get(req.params.id);
    if (!inv) return res.status(404).json({ error: "Invoice not found" });
    // A dispatch linked to this invoice means goods may have moved — the IRN
    // (and e-way bill) must go through cancellation, not silent clearing.
    const dispatches = await GoodsDispatch.list((req.user as any)?.userId);
    const linked = (dispatches as any[]).some(
      (d) => d.linkedSalesInvoiceId === req.params.id && d.status !== "cancelled",
    );
    if (linked)
      return res.status(400).json({
        error: "A dispatch references this invoice — cancel the dispatch/e-way bill first",
      });
    try {
      const updated = await Invoice.clearIrn(req.params.id, String(req.body?.reason ?? req.query?.reason ?? ""));
      trackAction(req, "invoice.irn_cleared", updated.id, {
        entityType: "invoice",
        entityRef: (updated as any).invoiceNumber,
      });
      res.json(updated);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /invoices/:id/payment — record a customer payment (treasury/admin). */router.post("/invoices/:id/payment", authMiddleware, async (req, res) => {
  try {
    const roles: string[] = req.user!.roles || [];
    if (!roles.includes("factor_admin") && !roles.includes("treasury")) {
      return res
        .status(403)
        .json({ error: "Only treasury/admin can record payments" });
    }
    const current = await Invoice.get(req.params.id);
    if (!current) return res.status(404).json({ error: "Invoice not found" });
    if (current.status === "draft") {
      return res
        .status(400)
        .json({ error: "Issue the invoice before recording payments" });
    }
    if (current.status === "cancelled") {
      return res
        .status(400)
        .json({ error: "Cannot record a payment on a cancelled invoice" });
    }
    if (current.status === "paid") {
      return res.status(400).json({ error: "Invoice is already paid" });
    }
    const amt = Number(req.body?.amountReceived);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res
        .status(400)
        .json({ error: "Payment amount must be greater than zero" });
    }
    const updated = await Invoice.recordPayment(
      req.params.id,
      amt,
      req.body?.receiptDate || db.todayDate(),
    );
    trackAction(req, "invoice.payment", current.id, {
      entityType: "invoice",
      entityRef: current.invoiceNumber,
      amountReceived: amt,
      amountPaid: updated?.amountPaid ?? 0,
    });
    // Cash-flow sync: update expected inflow when payment is recorded
    (async () => {
      try {
        const { syncInvoicePaymentToInflow } = await import("../services/cash-flow-sync.js");
        await syncInvoicePaymentToInflow(current, amt);
      } catch (err: any) {
        console.error("  ⚠ Cash-flow sync after payment failed:", err?.message ?? err);
      }
    })();
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/invoices/:id", authMiddleware, async (req, res) => {
  try {
    if (
      req.body.status &&
      ["approved", "rejected", "disputed"].includes(req.body.status)
    ) {
      // Checker-only action
      const userRoles = req.user!.roles;
      if (
        !userRoles.includes("factor_admin") &&
        !userRoles.includes("checker")
      ) {
        return res
          .status(403)
          .json({ error: "Only checker/admin can approve/reject" });
      }
    }
    if (req.body.status === "cancelled") {
      const userRoles = req.user!.roles || [];
      const isAdmin = userRoles.includes("factor_admin");
      const isCreator =
        req.user!.userId === (await Invoice.get(req.params.id))?.clientId;
      if (!isAdmin && !isCreator) {
        return res
          .status(403)
          .json({
            error: "Only the creator or an admin can cancel an invoice",
          });
      }
      const current = await Invoice.get(req.params.id);
      if (current && !["draft", "pending"].includes(current.status)) {
        return res
          .status(400)
          .json({ error: "Only draft or issued invoices can be cancelled" });
      }
    }
    const body = req.body || {};
    const current = await Invoice.get(req.params.id);
    if (!current) return res.status(404).json({ error: "Invoice not found" });
    // Once an IRN is recorded, normal editing is blocked — use the
    // cancellation or credit-note workflow instead (PDF §7). Only status,
    // payment, NOA, EWB-link and print-reference fields stay editable.
    if ((current as any).irn) {
      const irnFrozen = [
        "lines",
        "freight",
        "amount",
        "debtorId",
        "invoiceNumber",
        "issueDate",
        "dueDate",
        "goodsSalesOrderId",
        "goodsSalesOrderNumber",
        "billingAddress",
        "deliveryAddress",
        "paymentTerms",
        "paymentTermsType",
        "advancePct",
        "customerContact",
        "notes",
        "documents",
        "poNumber",
        "poDate",
        "poAmount",
        "linkedCustomerProformaId",
        "linkedCustomerProformaNumber",
        "advanceDeducted",
        "subtotalGoods",
        "totalDiscount",
        "gstTotal",
        "grandTotal",
      ];
      if (irnFrozen.some((k) => (body as any)[k] !== undefined)) {
        return res.status(400).json({
          error: "IRN is recorded — this e-invoice is locked. Use cancellation or a credit note to correct it",
        });
      }
    }
    // Closed invoices are frozen for content edits (payment/status only).
    if (current.status === "paid" || current.status === "cancelled") {
      const frozen = [
        "lines",
        "freight",
        "amount",
        "debtorId",
        "invoiceNumber",
        "issueDate",
        "dueDate",
        "goodsSalesOrderId",
        "billingAddress",
        "deliveryAddress",
        "paymentTerms",
        "customerContact",
        "notes",
        "documents",
        "poNumber",
        "poAmount",
        "linkedCustomerProformaId",
        "linkedCustomerProformaNumber",
        "advanceDeducted",
      ];
      if (frozen.some((k) => (body as any)[k] !== undefined)) {
        return res
          .status(400)
          .json({ error: `A ${current.status} invoice cannot be edited` });
      }
    }
    // Content edits are restricted to draft (and light edits on issued).
    if (body.lines !== undefined) {
      let lines: any[];
      try {
        lines = await validateInvoiceLines(effectiveListScope(req), body.lines);
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }
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
      if (!soId)
        return res
          .status(400)
          .json({ error: "A linked sales order is required" });
      const so = await GoodsSO.get(soId);
      if (!so)
        return res.status(404).json({ error: "Linked sales order not found" });
      try {
        assertInvoiceMatchesSO(
          so,
          body.lines !== undefined ? body.lines : (current.lines ?? []),
          body.debtorId !== undefined ? body.debtorId : current.debtorId,
        );
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }
      if (body.goodsSalesOrderId && !body.goodsSalesOrderNumber)
        body.goodsSalesOrderNumber = so.soNumber;
    }
    // Re-resolve the linked proforma when the link or PO number changes.
    if (
      body.linkedCustomerProformaId !== undefined ||
      body.poNumber !== undefined
    ) {
      try {
        const merged = { ...current, ...body } as any;
        const pf = await resolveProformaForInvoice(
          req.user!.userId,
          merged,
          "sales",
        );
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
      // Checker-approved → pending in treasury: mail admin, treasury, checker.
      if (s === "approved") {
        notifyPendingQueue(req, {
          stage: "treasury",
          kind: "sales_invoice",
          number: current.invoiceNumber,
          amount: Number((updated as any)?.grandTotal ?? (updated as any)?.amount ?? current.amount) || 0,
          dueDate: (updated as any)?.dueDate ?? current.dueDate ?? null,
          reviewPath: "/app/queue",
        });
        timelineStatus(req, { clientId: current.clientId, docType: "sales_invoice", docId: current.id, docNumber: current.invoiceNumber },
          current.status, "approved", `Checker approved ${current.invoiceNumber} — IRN pending`);
        advanceWorkflow(req, {
          workflowType: "sales_invoice",
          stage: "record_irn",
          docType: "sales_invoice",
          docId: current.id,
          docNumber: current.invoiceNumber,
          counterparty: null,
          docStatus: "approved",
          ownerRole: "treasury",
          requiredAction: "Record IRN from Tally",
          nextAction: "Prepare Dispatch Order",
          amount: Number((updated as any)?.grandTotal ?? current.amount) || 0,
          linkedDocs: current.goodsSalesOrderId ? [{ type: "sales_order", id: current.goodsSalesOrderId, number: current.goodsSalesOrderNumber }] : [],
        }, { timelineKind: "system", docType: "sales_invoice", appPath: "/app/invoices" });
      }
      if (s === "rejected" || s === "disputed") {
        timelineStatus(req, { clientId: current.clientId, docType: "sales_invoice", docId: current.id, docNumber: current.invoiceNumber },
          current.status, s, `Invoice ${s}${req.body.notes ? `: ${req.body.notes}` : ""}`, "rejection");
      }
    }
    // Instant reminder check on update (e.g., status changed to approved)
    if (req.body.dueDate || req.body.status) {
      const inv = await Invoice.get(req.params.id);
      if (
        inv &&
        inv.dueDate &&
        inv.status !== "paid" &&
        inv.status !== "rejected"
      ) {
        // Fire-and-forget; respects the automatic-reminders on/off setting.
        const { autoSendReminderOnChange } =
          await import("../invoice-reminder.js");
        void autoSendReminderOnChange(inv.id, "sales");
      }
    }
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.delete("/invoices/:id", authMiddleware, async (req, res) => {
  try {
    await Invoice.remove(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
  } catch {
    /* ignore */
  }
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
    const poLine = (po.lines ?? []).find(
      (l: any) => l.productId === ln.productId,
    );
    if (!poLine)
      throw new Error(
        "A line references a product that is not on the linked purchase order",
      );
    const invoiceQty = Number(ln.invoiceQty);
    if (!Number.isFinite(invoiceQty) || invoiceQty <= 0) {
      throw new Error(
        `Invoice quantity must be greater than zero for ${poLine.name}`,
      );
    }
    const unitPrice = Number(ln.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new Error(
        `Unit price must be greater than or equal to zero for ${poLine.name}`,
      );
    }
    const gst =
      ln.gstRate === undefined || ln.gstRate === null || ln.gstRate === ""
        ? poLine.gstRate
        : Number(ln.gstRate);
    if (
      Number.isFinite(Number(gst)) &&
      (Number(gst) < 0 || Number(gst) > 100)
    ) {
      throw new Error(`GST rate must be between 0 and 100% for ${poLine.name}`);
    }
    lines.push({
      productId: poLine.productId,
      sku: poLine.sku,
      name: poLine.name,
      unit: poLine.unit ?? "unit",
      color: poLine.color ?? null,
      size: poLine.size ?? null,
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
  excludeId: string | null,
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
        String(p.invoiceNumber ?? "")
          .trim()
          .toLowerCase() === needle,
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
    if (pi.linkedGoodsReceiptId && pi.linkedGoodsReceiptId !== receipt.id)
      return;
    await PurchaseInvoice.update(pi.id, {
      linkedGoodsReceiptId: null,
      linkedGoodsReceiptNumber: null,
      lines: (pi.lines ?? []).map((l: any) => ({ ...l, grnReceivedQty: 0 })),
    });
  };
  if (previousPiId && previousPiId !== receipt.purchaseInvoiceId)
    await detach(previousPiId);
  if (!receipt.purchaseInvoiceId) return;
  const pi = await PurchaseInvoice.get(receipt.purchaseInvoiceId);
  if (!pi) return;
  if (receipt.status === "cancelled") {
    if (pi.linkedGoodsReceiptId === receipt.id)
      await detach(receipt.purchaseInvoiceId);
    return;
  }
  const qtyByProduct = new Map<string, number>();
  for (const ln of receipt.lines ?? []) {
    qtyByProduct.set(
      String(ln.productId),
      Number(ln.acceptedQty ?? ln.receivedQty) || 0,
    );
  }
  await PurchaseInvoice.update(pi.id, {
    linkedGoodsReceiptId: receipt.id,
    linkedGoodsReceiptNumber: receipt.receiptNumber,
    lines: (pi.lines ?? []).map((l: any) => ({
      ...l,
      grnReceivedQty:
        qtyByProduct.get(String(l.productId)) ?? l.grnReceivedQty ?? 0,
    })),
  });
}

router.get("/purchase-invoices", authMiddleware, async (req, res) => {
  try {
    // ?scope=all returns every client's purchase invoices — used by the shared dashboard.
    // Platform staff (non-client roles) also read across the whole portfolio.
    const scopeAll = req.query.scope === "all";
    res.json(
      await PurchaseInvoice.list(scopeAll ? undefined : effectiveListScope(req)),
    );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.post("/purchase-invoices", authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    const clientId = req.user!.userId;
    // NOTE: a purchase invoice NEVER creates stock — only a confirmed GRN credits
    // inventory (the GRN is the sole stock-in document for purchases).
    if (!body.vendorId)
      return res.status(400).json({ error: "Select a supplier" });
    if (!body.invoiceNumber || !String(body.invoiceNumber).trim()) {
      return res
        .status(400)
        .json({ error: "Supplier invoice number is required" });
    }
    // Supplier invoice number must be unique per supplier (cancelled excluded).
    const dup = await findDuplicatePurchaseInvoice(
      clientId,
      body.vendorId,
      body.invoiceNumber,
      null,
    );
    if (dup) {
      return res
        .status(400)
        .json({
          error: `Supplier invoice number "${body.invoiceNumber}" already exists for this supplier on invoice ${dup.invoiceNumber}`,
        });
    }
    if (!body.supplierName)
      body.supplierName = await resolveSupplierName(body.vendorId);
    // The purchase-invoice ↔ purchase-order link is MANDATORY: the invoice
    // lines come from the PO, and the GRN (created later) receives against the
    // same PO. No PO = no purchase invoice.
    if (!body.goodsPurchaseOrderId) {
      return res
        .status(400)
        .json({ error: "A linked purchase order is required" });
    }
    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      return res
        .status(400)
        .json({
          error: "Add at least one line from the linked purchase order",
        });
    }
    const po = await GoodsPO.get(body.goodsPurchaseOrderId);
    if (!po)
      return res.status(404).json({ error: "Linked purchase order not found" });
    if (po.status === "cancelled") {
      return res
        .status(400)
        .json({ error: "Cannot invoice against a cancelled purchase order" });
    }
    if (po.status === "draft" || po.status === "pending_review") {
      return res
        .status(400)
        .json({
          error: "Approve and send the purchase order before invoicing",
        });
    }
    try {
      body.lines = validatePurchaseInvoiceLines(po, body.lines);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
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
    const item = await PurchaseInvoice.create({
      ...body,
      clientId,
      vendorId: body.vendorId,
    });
    trackAction(req, "purchase_invoice.created", item.id, {
      entityType: "purchase_invoice",
      entityRef: item.invoiceNumber,
      amount: item.amount,
      status: item.status,
      supplier: item.supplierName,
    });
    // Cash-flow sync: create expected supplier outflow from purchase invoice
    (async () => {
      try {
        const { syncPurchaseInvoiceToOutflow } = await import("../services/cash-flow-sync.js");
        await syncPurchaseInvoiceToOutflow(item);
      } catch (err: any) {
        console.error("  ⚠ Cash-flow sync after purchase invoice creation failed:", err?.message ?? err);
      }
    })();
    // Instant reminder check for purchase invoices too
    if (
      item.dueDate &&
      !["paid", "rejected", "cancelled"].includes(item.status)
    ) {
      // Fire-and-forget; respects the automatic-reminders on/off setting.
      const { autoSendReminderOnChange } = await import("../invoice-reminder.js");
      void autoSendReminderOnChange(item.id, "purchase");
    }
    res.status(201).json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.put("/purchase-invoices/:id", authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    const current = await PurchaseInvoice.get(req.params.id);
    if (!current)
      return res.status(404).json({ error: "Purchase invoice not found" });
    const roles: string[] = req.user!.roles || [];
    const isAdmin = roles.includes("factor_admin");
    const isChecker = roles.includes("checker");
    const isTreasury = roles.includes("treasury");
    const isCreator = req.user!.userId === current.clientId;

    // ── Role guards on status changes ──
    if (body.status && body.status !== current.status) {
      const toStatus = String(body.status);
      const allowed =
        toStatus === "cancelled"
          ? isAdmin || isCreator
          : toStatus === "paid" || toStatus === "partially_paid"
            ? isAdmin || isTreasury
            : toStatus === "approved_for_payment"
              ? isAdmin || isChecker
              : toStatus === "verified"
                ? isAdmin || isCreator
                : toStatus === "draft"
                  ? isAdmin || isCreator || isChecker
                  : false;
      if (!allowed)
        return res
          .status(403)
          .json({
            error: "You do not have permission to make this status change",
          });
    }
    // ── Only treasury/admin can record payments ──
    if (
      body.amountPaid !== undefined &&
      Number(body.amountPaid) !== Number(current.amountPaid ?? 0)
    ) {
      if (!isAdmin && !isTreasury)
        return res
          .status(403)
          .json({ error: "Only treasury/admin can record payments" });
    }
    // ── Closed invoices are frozen (payment/status only) ──
    if (current.status === "paid" || current.status === "cancelled") {
      const frozen = [
        "lines",
        "freight",
        "vendorId",
        "invoiceNumber",
        "issueDate",
        "receivedDate",
        "dueDate",
        "goodsPurchaseOrderId",
        "notes",
        "documents",
        "linkedSupplierProformaId",
        "linkedSupplierProformaNumber",
        "advanceDeducted",
      ];
      if (frozen.some((k) => (body as any)[k] !== undefined)) {
        return res
          .status(400)
          .json({ error: `A ${current.status} invoice cannot be edited` });
      }
    }

    if (body.vendorId && body.vendorId !== current.vendorId) {
      body.supplierName =
        (await resolveSupplierName(body.vendorId)) ?? current.supplierName;
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
        return res
          .status(400)
          .json({ error: "A linked purchase order is required" });
      }
      if (body.goodsPurchaseOrderId !== undefined) {
        const linkedPo = await GoodsPO.get(body.goodsPurchaseOrderId);
        if (linkedPo?.status === "cancelled") {
          return res
            .status(400)
            .json({ error: "Cannot link a cancelled purchase order" });
        }
        if (linkedPo?.status === "draft") {
          return res
            .status(400)
            .json({
              error: "Approve and send the purchase order before invoicing",
            });
        }
      }
      if (body.lines !== undefined) {
        if (!Array.isArray(body.lines) || body.lines.length === 0) {
          return res
            .status(400)
            .json({
              error: "Add at least one line from the linked purchase order",
            });
        }
        const po = await GoodsPO.get(poId);
        if (!po)
          return res
            .status(404)
            .json({ error: "Linked purchase order not found" });
        try {
          body.lines = validatePurchaseInvoiceLines(po, body.lines);
        } catch (e: any) {
          return res.status(400).json({ error: e.message });
        }
        body.goodsPoNumber = po.poNumber;
      }
    }
    // Optional supplier-proforma link → recompute the advance deduction when
    // the link or PO number changes.
    if (
      body.linkedSupplierProformaId !== undefined ||
      body.poNumber !== undefined
    ) {
      try {
        const merged = { ...current, ...body } as any;
        const pf = await resolveProformaForInvoice(
          req.user!.userId,
          merged,
          "purchase",
        );
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
        current.id,
      );
      if (dup) {
        return res
          .status(400)
          .json({
            error: `Supplier invoice number "${body.invoiceNumber ?? current.invoiceNumber}" already exists for this supplier on invoice ${dup.invoiceNumber}`,
          });
      }
    }
    const updated = await PurchaseInvoice.update(req.params.id, body);
    // Audit trail — record treasury payment recording (amountPaid delta).
    if (
      body.amountPaid !== undefined &&
      Number(body.amountPaid) !== Number(current.amountPaid ?? 0)
    ) {
      trackAction(req, "purchase_invoice.payment", current.id, {
        entityType: "purchase_invoice",
        entityRef: current.invoiceNumber,
        amountPaid: Number(body.amountPaid) || 0,
        prevAmountPaid: Number(current.amountPaid ?? 0),
      });
      timelineStatus(req, { clientId: req.user!.userId, docType: "purchase_invoice", docId: current.id, docNumber: current.invoiceNumber },
        current.status, current.status, `Treasury recorded payment ₹${Number(body.amountPaid) || 0}`);
      const payable = Number((updated as any)?.amount ?? current.amount) || 0;
      if (payable > 0 && Number(body.amountPaid) >= payable - 0.005) {
        advanceWorkflow(req, {
          workflowType: "purchase_order",
          stage: "await_goods",
          docType: "purchase_invoice",
          docId: current.id,
          docNumber: current.invoiceNumber,
          counterparty: (updated as any)?.supplierName ?? current.supplierName ?? null,
          docStatus: "paid",
          ownerRole: "operations",
          requiredAction: "Monitor expected delivery, create GRN on arrival",
          nextAction: "Credit inventory",
          amount: payable,
        }, { timelineKind: "system", docType: "purchase_invoice", appPath: "/app/warehouse" });
      }
    }
    // Audit trail — record workflow status transitions.
    if (body.status && body.status !== current.status) {
      const s = String(body.status);
      // Disputes and cancellations require a reason (PDF-3 §8).
      if ((s === "disputed" || s === "cancelled") && !String(body.differenceNotes ?? body.notes ?? req.body?.reason ?? "").trim()) {
        return res.status(400).json({ error: `A reason is required to mark the invoice ${s}` });
      }
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
      // Verified → pending in checker; approved_for_payment → pending in
      // treasury: mail admin, treasury and checker users.
      if (s === "verified" || s === "approved_for_payment") {
        notifyPendingQueue(req, {
          stage: s === "verified" ? "checker" : "treasury",
          kind: "purchase_invoice",
          number: current.invoiceNumber,
          amount: Number((updated as any)?.grandTotal ?? (updated as any)?.amount ?? current.amount) || 0,
          counterparty: (updated as any)?.supplierName ?? current.supplierName ?? null,
          dueDate: (updated as any)?.dueDate ?? current.dueDate ?? null,
          reviewPath: s === "verified" ? "/app/checker" : "/app/queue",
        });
        timelineStatus(req, { clientId: req.user!.userId, docType: "purchase_invoice", docId: current.id, docNumber: current.invoiceNumber },
          current.status, s, s === "verified" ? "Invoice submitted for checker approval" : "Checker approved — sent to Treasury");
        advanceWorkflow(req, {
          workflowType: "purchase_invoice",
          stage: s === "verified" ? "checker_approval" : "treasury_payment",
          docType: "purchase_invoice",
          docId: current.id,
          docNumber: current.invoiceNumber,
          counterparty: (updated as any)?.supplierName ?? current.supplierName ?? null,
          docStatus: s,
          ownerRole: s === "verified" ? "checker" : "treasury",
          requiredAction: s === "verified" ? "Approve or reject invoice" : "Record payment commitment or actual payment",
          nextAction: s === "verified" ? "Send to Treasury" : "Await goods",
          amount: Number((updated as any)?.amount ?? current.amount) || 0,
          paymentStatus: s,
        }, { timelineKind: "system", docType: "purchase_invoice", appPath: s === "verified" ? "/app/checker" : "/app/queue" });
      }
      if (s === "disputed" || s === "cancelled") {
        timelineStatus(req, { clientId: req.user!.userId, docType: "purchase_invoice", docId: current.id, docNumber: current.invoiceNumber },
          current.status, s, `Invoice ${s}: ${String(body.differenceNotes ?? body.notes ?? req.body?.reason ?? "").trim()}`, "rejection");
        await WorkflowTask.closeTasksForDoc("purchase_invoice", current.id, req.user, `Invoice ${s}`);
      }
    }
    // Instant reminder check on update
    if (body.dueDate || body.status) {
      const inv = await PurchaseInvoice.get(req.params.id);
      if (
        inv &&
        inv.dueDate &&
        !["paid", "rejected", "cancelled"].includes(inv.status)
      ) {
        // Fire-and-forget; respects the automatic-reminders on/off setting.
        const { autoSendReminderOnChange } =
          await import("../invoice-reminder.js");
        void autoSendReminderOnChange(inv.id, "purchase");
      }
    }
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.delete("/purchase-invoices/:id", authMiddleware, async (req, res) => {
  try {
    const current = await PurchaseInvoice.get(req.params.id);
    if (!current)
      return res.status(404).json({ error: "Purchase invoice not found" });
    await PurchaseInvoice.remove(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== PURCHASE ORDERS (Proformas) =====================
// Purchase-side proformas are supplier quotations: their product lines must
// reference catalogue SKUs with quantity > 0 and unit price >= 0.

/** Validate proforma (purchase-side) catalogue lines if provided. */
async function validateProformaLines(clientId: string | undefined, rawLines: any[]) {
  if (!Array.isArray(rawLines) || rawLines.length === 0) return [];
  const products = await Product.list(clientId);
  const productById = new Map(products.map((p: any) => [p.id, p]));
  for (const l of rawLines) {
    if (!l.productId)
      throw new Error("Every line must select a product from the catalogue");
    if (!productById.has(l.productId))
      throw new Error("Every SKU must come from the product catalogue");
    if (!(Number(l.quantity) > 0))
      throw new Error("Quantity must be greater than zero");
    if (Number(l.unitPrice) < 0)
      throw new Error("Unit price must be greater than or equal to zero");
    applyVariantSnapshot(l, productById.get(l.productId));
    applyInvoicePrintSnapshot(l, productById.get(l.productId));
  }
  return rawLines;
}

router.get("/purchase-orders", authMiddleware, async (req, res) => {
  try {
    res.json(await PurchaseOrder.list(effectiveListScope(req)));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.post("/purchase-orders", authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    if (body.lines !== undefined) {
      try {
        body.lines = await validateProformaLines(effectiveListScope(req), body.lines);
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }
    }
    // Advance % must be a sane 0–100 value (drives the calculated advance).
    if (
      body.advancePct !== undefined &&
      body.advancePct !== null &&
      (Number(body.advancePct) < 0 || Number(body.advancePct) > 100)
    ) {
      return res
        .status(400)
        .json({ error: "Advance percentage must be between 0 and 100" });
    }
    // Recording a proforma always submits it to the checker for review — the
    // funding workflow is maker → checker approval → treasury funding.
    body.proformaStatus = "pending_review";
    const item = await PurchaseOrder.create({
      ...body,
      clientId: req.user!.userId,
    });
    trackAction(req, "proforma.created", item.id, {
      entityType: "proforma",
      entityRef: item.proformaNumber ?? item.poNumber,
      side: item.side,
      amount: item.poAmount ?? item.amount,
      status: item.proformaStatus,
    });
    // Submitted to checker → mail admin, treasury and checker users.
    notifyPendingQueue(req, {
      stage: "checker",
      kind: "proforma",
      number: item.proformaNumber ?? item.poNumber,
      amount: Number(item.poAmount ?? item.amount) || 0,
      reviewPath: "/app/checker",
    });
    res.status(201).json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
            return res
              .status(403)
              .json({
                error:
                  "Only the checker (or admin) can approve or reject proformas",
              });
          }
          if (!isAdmin && current.clientId === req.user!.userId) {
            return res
              .status(403)
              .json({
                error:
                  "You cannot review a proforma you created (segregation of duties)",
              });
          }
          if (current.proformaStatus === "funded") {
            return res
              .status(400)
              .json({ error: "This proforma is already funded" });
          }
          body.proformaReviewedBy = req.user!.userId;
          body.proformaReviewedAt = db.nowISO();
          break;
        }
        case "funded": {
          if (!isAdmin && !isTreasury) {
            return res
              .status(403)
              .json({ error: "Only treasury (or admin) can fund proformas" });
          }
          // Funding is the terminal step of the workflow — it requires the
          // checker's approval first.
          if (current.proformaStatus !== "approved") {
            return res
              .status(400)
              .json({
                error:
                  "Proforma must be approved by the checker before it can be funded",
              });
          }
          if (body.proformaFundedBy === undefined)
            body.proformaFundedBy = req.user!.userId;
          if (body.proformaFundedAt === undefined)
            body.proformaFundedAt = db.nowISO();
          break;
        }
        case "pending_review": {
          // Maker (re-)submits — allowed from draft or after a rejection.
          if (["approved", "funded"].includes(current.proformaStatus)) {
            return res
              .status(400)
              .json({ error: "This proforma is already approved or funded" });
          }
          break;
        }
        default:
          return res
            .status(400)
            .json({
              error:
                "proformaStatus must be pending_review, approved, rejected or funded",
            });
      }
    }

    // Converting to a purchase order or sales order requires the checker's
    // approval first (both conversion statuses are gated — `status` is not
    // part of the frozen content, so this is the only guard on it).
    if (
      (body.status === "converted_to_po" ||
        body.status === "converted_to_so") &&
      current.proformaStatus !== "approved"
    ) {
      return res
        .status(400)
        .json({
          error:
            "Proforma must be approved by the checker before converting to a purchase or sales order",
        });
    }

    // Content (lines, amounts, parties, attachments…) is frozen once the
    // proforma enters the review pipeline (or is approved/funded) — only
    // workflow transitions may touch the document then. This holds even when
    // the payload carries a proformaStatus decision, so a checker's
    // approve/reject (or treasury's fund) cannot smuggle content edits through.
    // A checker rejection reopens it for the maker to fix and resubmit.
    const contentKeys = [
      "lines",
      "amount",
      "poAmount",
      "freight",
      "documents",
      "proformaNumber",
      "proformaDate",
      "debtorId",
      "vendorId",
      "issueDate",
      "expectedDate",
      "validUntil",
      "paymentTerms",
      "expectedDeliveryDate",
      "notes",
      "debtorContact",
      "debtorGstin",
      "supplierContact",
      "supplierGstin",
      "poNumber",
      "linkedGoodsPoId",
      "linkedGoodsSoId",
      "advancePct",
    ];
    const frozen = ["pending_review", "approved", "funded"].includes(
      current.proformaStatus ?? "",
    );
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
        error:
          "Proforma is under review or already approved — content cannot be edited until the checker decides (a rejection reopens it for changes)",
      });
    }

    if (body.lines !== undefined) {
      try {
        body.lines = await validateProformaLines(effectiveListScope(req), body.lines);
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }
    }
    const updated = await PurchaseOrder.update(req.params.id, body);
    // Audit trail — record maker/checker/treasury workflow transitions.
    if (
      body.proformaStatus !== undefined &&
      body.proformaStatus !== current.proformaStatus
    ) {
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
      // Re-submitted → pending in checker; approved → pending in treasury:
      // mail admin, treasury and checker users.
      if (s === "pending_review" || s === "approved") {
        notifyPendingQueue(req, {
          stage: s === "pending_review" ? "checker" : "treasury",
          kind: "proforma",
          number: (updated as any)?.proformaNumber ?? current.proformaNumber ?? current.poNumber,
          amount: Number((updated as any)?.poAmount ?? (updated as any)?.amount ?? current.poAmount ?? current.amount) || 0,
          reviewPath: s === "pending_review" ? "/app/checker" : "/app/queue",
        });
      }
    }
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.delete("/purchase-orders/:id", authMiddleware, async (req, res) => {
  try {
    await PurchaseOrder.remove(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /proformas/:id/pdf — download the Tally-style proforma PDF.
 * Sales-side proformas print as "PROFORMA INVOICE"; purchase-side proformas
 * (supplier quotations) print with the supplier name in the seller block.
 */
router.get("/proformas/:id/pdf", authMiddleware, async (req, res) => {
  try {
    const pf = await PurchaseOrder.get(req.params.id);
    if (!pf) return res.status(404).json({ error: "Proforma not found" });
    const { proformaToTallyData, buildProformaTallyPdf } = await import("../lib/document-pdf.js");
    const { seller, bank, bankRaw, declarationRaw, logoImage } = await resolveTallySellerParts(pf.clientId);
    // Enrich the sales-side bill-to block from the debtor master so the PDF
    // prints logo + seller alongside full customer details (name, address,
    // GSTIN, PAN) even when the proforma only stores the debtor id.
    let enriched: any = pf;
    try {
      const debtorId = (pf as any).debtorId ?? (pf as any).debtor_id ?? null;
      if ((pf as any).side === "sales" && debtorId) {
        const d: any = await Debtor.get(debtorId).catch(() => null);
        if (d) {
          const addrs: any[] = Array.isArray(d.billingAddresses)
            ? d.billingAddresses
            : Array.isArray(d.billing_addresses)
              ? d.billing_addresses
              : [];
          const primaryAddr =
            addrs.find((a: any) => (a?.address ?? "").trim())?.address ??
            d.billingAddress ??
            d.billing_address ??
            null;
          enriched = {
            ...pf,
            debtorName: (pf as any).debtorName ?? d.name ?? null,
            debtor_billing_address:
              (pf as any).debtorBillingAddress ??
              (pf as any).debtor_billing_address ??
              primaryAddr,
            debtor_city: (pf as any).debtorCity ?? (pf as any).debtor_city ?? d.city ?? null,
            debtor_country:
              (pf as any).debtorCountry ?? (pf as any).debtor_country ?? d.country ?? null,
            debtor_gstin:
              (pf as any).debtorGstin ?? (pf as any).debtor_gstin ?? d.gstin ?? null,
            debtor_pan:
              (pf as any).debtorPan ?? (pf as any).debtor_pan ?? d.panCardNo ?? d.pan_card_no ?? null,
          };
        }
      }
    } catch { /* master enrichment is best-effort; the record prints as-is */ }
    const data = proformaToTallyData(enriched, {
      seller,
      bank,
      bankRaw,
      declarationRaw,
      logoImage,
    });
    const pdf = await buildProformaTallyPdf(data);
    const label = pf.side === "purchase" ? "Proforma" : "ProformaInvoice";
    const filename = `${label}_${data.number.replace(/[^A-Za-z0-9_-]/g, "_")}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(pdf);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /purchase-orders/:id/convert-to-so — turn a sales proforma into a DRAFT
 * sales order. The SO is auto-created from the proforma's header + catalogue
 * lines (draft — no stock impact; only a confirmed dispatch ever debits
 * inventory) and the proforma is marked "converted_to_so" + linked by id.
 */
router.post(
  "/purchase-orders/:id/convert-to-so",
  authMiddleware,
  async (req, res) => {
    try {
      const clientId = req.user!.userId;
      const pf = await PurchaseOrder.get(req.params.id);
      if (!pf) return res.status(404).json({ error: "Proforma not found" });
      if (pf.side !== "sales") {
        return res
          .status(400)
          .json({
            error: "Only sales proformas can be converted to a sales order",
          });
      }
      if (pf.status === "converted_to_so") {
        return res
          .status(400)
          .json({ error: "Proforma is already converted to a sales order" });
      }
      if (!["received", "reviewed"].includes(pf.status)) {
        return res
          .status(400)
          .json({
            error:
              "Only received or reviewed proformas can be converted to a sales order",
          });
      }
      // Conversion is gated on the checker's approval (same as the purchase side).
      if (pf.proformaStatus !== "approved") {
        return res
          .status(400)
          .json({
            error:
              "Proforma must be approved by the checker before converting to a sales order",
          });
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
        return res
          .status(400)
          .json({ error: "Add at least one product line before converting" });
      }
      const customerName = pf.debtorId
        ? await resolveCustomerName(pf.debtorId)
        : null;
      const so = await GoodsSO.create({
        clientId,
        orderDate: db.todayDate(),
        customerId: pf.debtorId || null,
        customerName,
        contactPerson: pf.debtorContact || null,
        paymentTerms: pf.paymentTerms || null,
        paymentTermsType: (pf as any).paymentTermsType ?? null,
        advancePct: (pf as any).advancePct ?? null,
        expectedDispatchDate: null,
        expectedDeliveryDate: pf.expectedDeliveryDate || null,
        notes: pf.notes || null,
        documents: pf.documents || [],
        freight: pf.freight || 0,
        status: "draft",
        lines,
      });
      await PurchaseOrder.update(pf.id, {
        status: "converted_to_so",
        linkedGoodsSoId: so.id,
      });
      res.status(201).json({ success: true, salesOrder: so });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

/**
 * POST /purchase-orders/from-sales-order — Finance creates the Advance
 * Proforma FROM an accepted Sales Order (PDF-2 §5). Copies the order summary
 * as catalogue lines; advance amount = SO value × advance %; due date = SO
 * confirmation date (v1). Creates no stock/Invoice/IRN/EWB/receivable — only
 * an expected advance receipt for cash-flow forecasting.
 */
router.post(
  "/purchase-orders/from-sales-order",
  authMiddleware,
  requireRole("treasury", "factor_admin"),
  async (req, res) => {
    try {
      const clientId = req.user!.userId;
      const so = await GoodsSO.get(String(req.body?.salesOrderId ?? ""));
      if (!so) return res.status(404).json({ error: "Sales order not found" });
      if ((so as any).debtorApprovalStatus !== "approved")
        return res.status(400).json({ error: "Client must accept the sales order first" });
      const advancePct = Number((so as any).advancePct ?? 0) || 0;
      if (!(advancePct > 0))
        return res.status(400).json({ error: "This order needs no advance — create the final invoice instead" });
      const existing = (await PurchaseOrder.list(clientId)).filter(
        (p: any) => p.side === "sales" && (p as any).linkedGoodsSoId === so.id && p.status !== "cancelled",
      );
      if (existing.length > 0)
        return res.status(400).json({ error: "An advance proforma already exists for this order" });
      const lines = (so.lines ?? []).map((l: any) => ({
        productId: l.productId,
        sku: l.sku ?? null,
        name: l.name,
        unit: l.unit || "unit",
        quantity: Number(l.orderedQty) || 0,
        unitPrice: Number(l.unitPrice) || 0,
        gstRate: l.gstRate ?? null,
        lineTotal: 0,
      }));
      const soValue = Number(so.grandTotal) || 0;
      const advanceAmount = Math.round(soValue * (advancePct / 100) * 100) / 100;
      let bankDetails: string | null = null;
      try {
        const parts = await resolveTallySellerParts(clientId);
        if (parts.bank) {
          bankDetails = `${parts.bank.holder} | ${parts.bank.bank} | A/c ${parts.bank.acNo} | IFSC ${parts.bank.ifsc} | ${parts.bank.branch}`;
        } else bankDetails = parts.bankRaw;
      } catch { bankDetails = null; }
      const item = await PurchaseOrder.create({
        clientId,
        side: "sales",
        poNumber: `ADV-${so.soNumber}`,
        debtorId: so.customerId,
        debtorContact: so.contactPerson,
        paymentTerms: (so as any).paymentTermName ?? so.paymentTerms ?? null,
        paymentTermsType: (so as any).paymentTermsType ?? null,
        advancePct,
        lines,
        freight: 0,
        status: "draft",
        linkedGoodsSoId: so.id,
        advanceAmount,
        advanceDueDate: (so as any).reviewedAt?.slice(0, 10) ?? db.todayDate(),
        bankDetails,
        upiDetails: null,
      } as any);
      await PurchaseOrder.update(item.id, { proformaStatus: "draft" } as any);
      await WorkflowTask.closeTasksForDoc("sales_order", so.id, req.user, "Advance proforma created");
      timelineStatus(req, { clientId, docType: "sales_order", docId: so.id, docNumber: so.soNumber },
        (so as any).workflowStatus ?? null, "proforma_pending",
        `Finance created advance proforma ${(item as any).proformaNumber ?? item.poNumber} — ₹${advanceAmount} (${advancePct}%)`);
      advanceWorkflow(req, {
        workflowType: "proforma",
        stage: "await_payment",
        docType: "proforma",
        docId: item.id,
        docNumber: (item as any).proformaNumber ?? item.poNumber,
        counterparty: so.customerName,
        docStatus: "sent",
        ownerRole: "client",
        requiredAction: "Collect advance payment",
        nextAction: "Submit UTR to Treasury",
        amount: advanceAmount,
        paymentStatus: "awaiting",
        linkedDocs: [{ type: "sales_order", id: so.id, number: so.soNumber }],
      }, { timelineKind: "system", docType: "proforma", appPath: "/app/proformas" });
      res.status(201).json(item);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

/**
 * POST /purchase-orders/:id/send — Finance sends the advance proforma to the
 * client (proformaStatus draft → sent). No stock/invoice/IRN/EWB effect.
 */
router.post(
  "/purchase-orders/:id/send",
  authMiddleware,
  requireRole("treasury", "factor_admin"),
  async (req, res) => {
    try {
      const pf = await PurchaseOrder.get(req.params.id);
      if (!pf) return res.status(404).json({ error: "Proforma not found" });
      if (pf.side !== "sales") return res.status(400).json({ error: "Only sales proformas can be sent" });
      const updated = await PurchaseOrder.update(pf.id, { proformaStatus: "sent", sentAt: db.nowISO() } as any);
      timelineStatus(req, { clientId: (pf as any).clientId, docType: "proforma", docId: pf.id, docNumber: (pf as any).proformaNumber ?? pf.poNumber },
        (pf as any).proformaStatus, "sent", "Finance sent the advance proforma to the client");
      trackAction(req, "proforma.sent", pf.id, { entityType: "proforma", entityRef: (pf as any).proformaNumber ?? pf.poNumber });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ===================== GOODS PURCHASE ORDERS (catalogue-backed POs) =====================
// Distinct from the proforma PurchaseOrder model above: a goods PO is a purchase
// request/commitment that references catalogue SKUs. It NEVER creates inventory —
// only a GRN (goods receipt) credits stock.

/** Shape + catalogue checks for PO lines. SKUs must come from the product catalogue. */
async function validateGoodsPOLines(clientId: string | undefined, rawLines: any[]) {
  const lines = Array.isArray(rawLines) ? rawLines : [];
  if (lines.length === 0) throw new Error("Add at least one product line");
  const products = await Product.list(clientId);
  const productById = new Map(products.map((p: any) => [p.id, p]));
  for (const l of lines) {
    if (!l.productId)
      throw new Error("Every line must select a product from the catalogue");
    if (!productById.has(l.productId))
      throw new Error("Every SKU must come from the product catalogue");
    if (!(Number(l.orderedQty) > 0))
      throw new Error("Ordered quantity must be greater than zero");
    if (Number(l.unitPrice) < 0)
      throw new Error("Unit price must be greater than or equal to zero");
    const poProduct = productById.get(l.productId) as any;
    applyVariantSnapshot(l, poProduct);
    // Server-owned print snapshots for the garment PO: HSN from the
    // catalogue (kept when the client already sent one); fabric stays
    // exactly as entered per line (no fabric master exists).
    if (poProduct) {
      const hsn = l.hsnCode ?? l.hsn_code ?? poProduct.hsnCode ?? poProduct.hsn_code ?? null;
      if (hsn) l.hsnCode = hsn;
      else delete l.hsnCode;
      if (l.fabric !== undefined && l.fabric !== null && String(l.fabric).trim() === "") {
        l.fabric = null;
      }
    }
  }
  return lines;
}

// ===================== PO CLAUSES =====================
// Reusable purchase-order clause texts (packaging, delivery terms, …).
// Saved automatically from the PO form; later POs pick them from a dropdown.
router.get("/po-clauses", authMiddleware, async (req, res) => {
  try {
    const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
    if (kind !== undefined && !POClause.isPOClauseKind(kind)) {
      return res.status(400).json({ error: "Invalid clause kind" });
    }
    res.json(await POClause.list(effectiveListScope(req), kind as POClause.POClauseKind | undefined));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.post("/po-clauses", authMiddleware, async (req, res) => {
  try {
    const { kind, value } = req.body || {};
    if (!POClause.isPOClauseKind(kind)) return res.status(400).json({ error: "Invalid clause kind" });
    const item = await POClause.upsert(req.user!.userId, kind, value);
    if (!item) return res.status(400).json({ error: "Clause text is required" });
    res.status(201).json(item);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});
router.delete("/po-clauses/:id", authMiddleware, async (req, res) => {
  try {
    const current = await POClause.get(req.params.id);
    if (!current) return res.status(404).json({ error: "Clause not found" });
    if (current.clientId !== req.user!.userId && !isStaffAccount(req.user?.roles)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    await POClause.remove(req.params.id);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get("/goods-purchase-orders", authMiddleware, async (req, res) => {
  try {
    res.json(await GoodsPO.list(effectiveListScope(req)));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.get(
  "/goods-purchase-orders/pending-invoices",
  authMiddleware,
  async (req, res) => {
    try {
      const clientId = req.user!.userId;
      const { items } = await db.queryByGSI1(clientId, {
        entityType: "GoodsPurchaseOrder",
        limit: 500,
        reverse: true,
      });
      const pendingInvoices = (items as any[]).filter(
        (po) =>
          (po.status ?? "").toString() === "approved" &&
          (po.supplierApprovalStatus ?? null) === "approved",
      );
      res.json(pendingInvoices);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);
router.get(
  "/goods-purchase-orders/proforma-pending",
  authMiddleware,
  async (req, res) => {
    try {
      const clientId = req.user!.userId;
      const { items } = await db.queryByGSI1(clientId, {
        entityType: "GoodsPurchaseOrder",
        limit: 500,
        reverse: true,
      });
      const proformaPending = (
        await Promise.all(
          (items as any[]).map(async (po) => {
            if (!po.supplierId) return null;
            const vendor = await Vendor.get(po.supplierId);
            if (!vendor) return null;
            const hasAdvanceTerms =
              (vendor.paymentTermsType ?? "credit") === "advance_full" ||
              (vendor.paymentTermsType ?? "credit") === "advance_partial";
            return hasAdvanceTerms && (po.supplierApprovalStatus ?? null) === "approved"
              ? po
              : null;
          }),
        )
      ).filter(Boolean);
      res.json(proformaPending);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);
router.post("/goods-purchase-orders", authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    let lines: any[];
    try {
      lines = await validateGoodsPOLines(effectiveListScope(req), body.lines);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
    const item = await GoodsPO.create({
      ...body,
      lines,
      clientId: req.user!.userId,
      // buyerId always records the actual creator; buyerName is a free-text
      // "Buyer / created by" display field the user may set to anything.
      // An explicit empty value is honored (user cleared the field); the
      // signed-in email is only the fallback when no value was sent at all.
      buyerId: req.user!.userId,
      buyerName:
        body.buyerName !== undefined ? body.buyerName : req.user!.email,
    });
    res.status(201).json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.put("/goods-purchase-orders/:id", authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    const current = await GoodsPO.get(req.params.id);
    if (body.lines !== undefined) {
      let lines: any[];
      try {
        lines = await validateGoodsPOLines(effectiveListScope(req), body.lines);
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }
      body.lines = lines;
    }
    const updated = await GoodsPO.update(req.params.id, body);
    // Submitted → pending in checker: mail admin, treasury and checker users.
    if (body.status === "pending_review" && current?.status !== "pending_review") {
      notifyPendingQueue(req, {
        stage: "checker",
        kind: "purchase_order",
        number: (updated as any)?.poNumber ?? current?.poNumber ?? req.params.id,
        amount: Number((updated as any)?.grandTotal ?? current?.grandTotal) || 0,
        counterparty: (updated as any)?.supplierName ?? current?.supplierName ?? null,
        dueDate: (updated as any)?.expectedDeliveryDate ?? current?.expectedDeliveryDate ?? null,
        reviewPath: "/app/checker",
      });
      timelineStatus(req, { clientId: req.user!.userId, docType: "purchase_order", docId: req.params.id, docNumber: (updated as any)?.poNumber },
        current?.status ?? null, "pending_review", "Procurement submitted PO for checker approval");
      advanceWorkflow(req, {
        workflowType: "purchase_order",
        stage: "checker_approval",
        docType: "purchase_order",
        docId: req.params.id,
        docNumber: (updated as any)?.poNumber ?? null,
        counterparty: (updated as any)?.supplierName ?? null,
        docStatus: "pending_review",
        ownerRole: "checker",
        requiredAction: "Approve or reject PO",
        nextAction: "Send PO to Supplier",
        amount: Number((updated as any)?.grandTotal) || 0,
      }, { timelineKind: "system", docType: "purchase_order", appPath: "/app/checker" });
    }
    // Approved → auto-email to supplier + procurement tracking task (PDF-3 §3).
    if (body.status === "approved" && current?.status !== "approved") {
      timelineStatus(req, { clientId: req.user!.userId, docType: "purchase_order", docId: req.params.id, docNumber: (updated as any)?.poNumber },
        current?.status ?? null, "approved", `Checker approved PO ${(updated as any)?.poNumber ?? ""}`);
      try {
        const po = await GoodsPO.get(req.params.id);
        if (po && po.status === "approved") {
          const sent = await sendPurchaseOrderToSupplier(po, req.user!.userId);
          await GoodsPO.update(po.id, {
            supplierApprovalStatus: "pending",
            supplierApprovalToken: sent.token,
            supplierApprovalSentAt: db.nowISO(),
            supplierApprovalRespondedAt: null,
            supplierApprovalComments: null,
            supplierApprovalEmail: sent.email,
            status: "sent",
          } as any);
          timelineStatus(req, { clientId: req.user!.userId, docType: "purchase_order", docId: po.id, docNumber: (po as any).poNumber },
            "approved", "sent", `System emailed PO to supplier (${sent.email})`);
        }
      } catch (e: any) {
        console.error("  ⚠ Auto supplier email failed:", e?.message ?? e);
      }
      advanceWorkflow(req, {
        workflowType: "purchase_order",
        stage: "track_supplier",
        docType: "purchase_order",
        docId: req.params.id,
        docNumber: (updated as any)?.poNumber ?? null,
        counterparty: (updated as any)?.supplierName ?? null,
        docStatus: "sent",
        ownerRole: "client",
        requiredAction: "Track supplier response, record supplier invoice",
        nextAction: "Submit invoice for approval",
        amount: Number((updated as any)?.grandTotal) || 0,
      }, { timelineKind: "system", docType: "purchase_order", appPath: "/app/purchases" });
    }
    if (body.status === "cancelled" && current?.status !== "cancelled") {
      const reason = String(body.notes ?? req.body?.reason ?? "").trim();
      if (!reason) return res.status(400).json({ error: "A reason is required to cancel the purchase order" });
      timelineStatus(req, { clientId: req.user!.userId, docType: "purchase_order", docId: req.params.id, docNumber: (updated as any)?.poNumber },
        current?.status ?? null, "cancelled", `PO cancelled: ${reason}`, "rejection");
      await WorkflowTask.closeTasksForDoc("purchase_order", req.params.id, req.user, "PO cancelled");
    }
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.delete(
  "/goods-purchase-orders/:id",
  authMiddleware,
  async (req, res) => {
    try {
      await GoodsPO.remove(req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ===================== GOODS RECEIPTS (GRN) =====================
// Lifecycle: draft (no stock) → confirm (credits stock with the ACCEPTED
// quantity, folds accepted qty into the PO) → cancelled (reversing debit
// entries only if stock had already been credited).
// The GRN is the ONLY document that credits inventory — POs, proformas and
// purchase invoices never touch stock.

function assertPOReceivable(po: any) {
  if (po.status === "cancelled")
    throw new Error("Cannot receive against a cancelled PO");
  if (po.status === "draft" || po.status === "pending_review")
    throw new Error("Approve and send the PO before receiving goods");
  if (po.status === "fully_received")
    throw new Error("PO is already fully received");
}

/**
 * Validate GRN lines against the PO (ordered/pending limits) and snapshot them
 * onto the GRN. The over-receipt gate applies to the ACCEPTED quantity — that
 * is what counts toward the PO and enters stock.
 */
function validateReceiptLines(
  po: any,
  rawLines: any[],
  allowOverReceipt: boolean,
) {
  const lines: any[] = [];
  if (!Array.isArray(rawLines) || rawLines.length === 0)
    throw new Error("At least one received line required");
  // Accumulate per-product accepted quantities so duplicate lines can't each
  // pass the pending check and collectively over-receive.
  const seen = new Map<string, number>();
  for (const ln of rawLines) {
    const poLine = (po.lines ?? []).find(
      (l: any) => l.productId === ln.productId,
    );
    if (!poLine)
      throw new Error(
        "A receipt line references a product that is not on this PO",
      );
    const receivedQty = Number(ln.receivedQty);
    if (!Number.isFinite(receivedQty) || receivedQty <= 0)
      throw new Error(
        `Received quantity must be greater than zero for ${poLine.name}`,
      );
    // Empty/null accepted defaults to received (accepted is normally same as received).
    const rawAccepted = ln.acceptedQty;
    const acceptedQty =
      rawAccepted === undefined || rawAccepted === null || rawAccepted === ""
        ? receivedQty
        : Number(rawAccepted);
    if (!Number.isFinite(acceptedQty) || acceptedQty < 0)
      throw new Error(
        `Accepted quantity must be a non-negative number for ${poLine.name}`,
      );
    if (acceptedQty > receivedQty)
      throw new Error(
        `Accepted quantity cannot exceed received quantity for ${poLine.name}`,
      );
    const rawRejected = ln.rejectedQty;
    const rejectedQty =
      rawRejected === undefined || rawRejected === null || rawRejected === ""
        ? 0
        : Number(rawRejected);
    if (!Number.isFinite(rejectedQty) || rejectedQty < 0)
      throw new Error(
        `Rejected quantity must be a non-negative number for ${poLine.name}`,
      );
    if (rejectedQty > receivedQty)
      throw new Error(
        `Rejected quantity cannot exceed received quantity for ${poLine.name}`,
      );
    if (acceptedQty + rejectedQty > receivedQty) {
      throw new Error(
        `Accepted + rejected cannot exceed received quantity for ${poLine.name}`,
      );
    }
    const already = seen.get(poLine.productId) ?? 0;
    const pending = poLine.orderedQty - (poLine.receivedQty ?? 0) - already;
    if (acceptedQty > pending && !allowOverReceipt) {
      throw new Error(
        `Accepting ${acceptedQty} for ${poLine.name} exceeds the ${Math.max(0, pending)} pending. Over-receipt requires checker/admin approval.`,
      );
    }
    seen.set(poLine.productId, already + acceptedQty);
    lines.push({
      productId: poLine.productId,
      sku: poLine.sku,
      name: poLine.name,
      unit: poLine.unit ?? "unit",
      orderedQty: poLine.orderedQty,
      receivedQty,
      acceptedQty,
      rejectedQty,
      unitCost: Number(ln.unitCost ?? poLine.unitPrice) || 0,
      gstRate: poLine.gstRate ?? null,
      lineValue:
        Math.round(
          acceptedQty * (Number(ln.unitCost ?? poLine.unitPrice) || 0) * 100,
        ) / 100,
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
    (po.lines ?? []).map(
      (l: any) =>
        [String(l.productId), String(l.unit ?? "unit")] as [string, string],
    ),
  );
  for (const ln of receipt.lines ?? []) {
    const qty = creditedQty(ln);
    if (!(qty > 0)) continue; // fully rejected lines credit nothing
    await StockMovement.create({
      clientId,
      productId: ln.productId,
      direction: "in",
      itemName: ln.name,
      sku: ln.sku,
      quantity: qty,
      unit: unitByProduct.get(ln.productId) || ln.unit || "unit",
      unitCost: ln.unitCost,
      warehouse: receipt.warehouse || null,
      reason: "Goods receipt",
      linkedDocumentType: "GRN",
      linkedDocumentNumber: receipt.receiptNumber,
      status: "confirmed",
      notes: `GRN ${receipt.receiptNumber}`,
      movementDate: receipt.receivedDate,
      goodsReceiptId: receipt.id,
      purchaseOrderId: receipt.goodsPurchaseOrderId,
      createdById: receipt.receivedById,
      createdByName: receipt.receivedBy,
      confirmedById: receipt.creditedBy,
      confirmedByName: receipt.creditedBy,
      confirmedAt: receipt.creditedAt,
      destinationLocationId: receipt.receivingLocationId || null,
    });
  }
  await GoodsPO.recordReceipt(
    receipt.goodsPurchaseOrderId,
    (receipt.lines ?? []).map((l: any) => ({
      productId: l.productId,
      receivedQty: creditedQty(l),
    })),
  );
}

/** Create reversing debit (stock-out) entries for a confirmed GRN and revoke its PO quantities. */
async function reverseGoodsReceipt(clientId: string, receipt: any, po: any) {
  const unitByProduct = new Map<string, string>(
    (po?.lines ?? []).map(
      (l: any) =>
        [String(l.productId), String(l.unit ?? "unit")] as [string, string],
    ),
  );
  for (const ln of receipt.lines ?? []) {
    const qty = creditedQty(ln);
    if (!(qty > 0)) continue;
    await StockMovement.create({
      clientId,
      productId: ln.productId,
      direction: "out",
      itemName: ln.name,
      sku: ln.sku,
      quantity: qty,
      unit: unitByProduct.get(ln.productId) || ln.unit || "unit",
      unitCost: ln.unitCost,
      warehouse: receipt.warehouse || null,
      reason: "Stock adjustment",
      linkedDocumentType: "GRN",
      linkedDocumentNumber: receipt.receiptNumber,
      status: "confirmed",
      notes: `GRN ${receipt.receiptNumber} cancelled — reversal`,
      movementDate: db.todayDate(),
      goodsReceiptId: receipt.id,
      purchaseOrderId: receipt.goodsPurchaseOrderId,
      createdById: receipt.cancelledBy,
      createdByName: receipt.cancelledBy,
      confirmedById: receipt.cancelledBy,
      confirmedByName: receipt.cancelledBy,
      confirmedAt: db.nowISO(),
      sourceLocationId: receipt.receivingLocationId || null,
    });
  }
  await GoodsPO.revokeReceipt(
    receipt.goodsPurchaseOrderId,
    (receipt.lines ?? []).map((l: any) => ({
      productId: l.productId,
      receivedQty: creditedQty(l),
    })),
  );
}

async function recomputeForecast(clientId: string) {
  const { recomputeAll } = await import("../services/forecast-service.js");
  recomputeAll(clientId).catch((err: any) =>
    console.error(
      "  ⚠ Forecast recompute after goods receipt change failed:",
      err,
    ),
  );
}

router.get("/goods-receipts", authMiddleware, async (req, res) => {
  try {
    res.json(await GoodsReceipt.list(effectiveListScope(req)));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /goods-receipts — create a DRAFT GRN. No stock impact. */
router.post("/goods-receipts", authMiddleware, async (req, res) => {
  try {
    const clientId = req.user!.userId;
    const body = req.body || {};
    if (!body.goodsPurchaseOrderId)
      return res.status(400).json({ error: "goodsPurchaseOrderId required" });
    const po = await GoodsPO.get(body.goodsPurchaseOrderId);
    if (!po) return res.status(404).json({ error: "PO not found" });
    if (po.status === "cancelled")
      return res
        .status(400)
        .json({ error: "Cannot create a GRN against a cancelled PO" });
    // A draft may be prepared against any open PO; the receivable/over-receipt
    // checks run at CONFIRM time (the moment stock actually gets credited).
    let lines: any[];
    try {
      lines = validateReceiptLines(po, body.lines, false);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
    const receivingLocation = body.receivingLocationId
      ? await StockLocation.get(body.receivingLocationId)
      : await StockLocation.getDefaultLocation(clientId);
    if (!receivingLocation || receivingLocation.clientId !== clientId || receivingLocation.status !== "active")
      return res.status(400).json({ error: "A valid active receiving location is required" });
    const receipt = await GoodsReceipt.create({
      clientId,
      goodsPurchaseOrderId: po.id,
      poNumber: po.poNumber,
      supplierId: body.supplierId ?? po.supplierId,
      supplierName: body.supplierName ?? po.supplierName,
      warehouse: body.warehouse ?? po.warehouse,
      receivedDate: body.receivedDate || null,
      purchaseInvoiceId: body.purchaseInvoiceId || null,
      challanNumber: body.challanNumber || null,
      receivedById: req.user!.userId,
      receivedBy: req.user!.email,
      notes: body.notes || null,
      documents: body.documents || [],
      status: "draft",
      lines,
      receivingLocationId: receivingLocation.id,
    });
    await syncLinkedPurchaseInvoice(receipt);
    res.status(201).json(receipt);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /goods-receipts/:id/confirm — credit stock (idempotent, race-safe). */
router.post("/goods-receipts/:id/confirm", authMiddleware, async (req, res) => {
  try {
    const clientId = req.user!.userId;
    const receipt = await GoodsReceipt.get(req.params.id);
    if (!receipt) return res.status(404).json({ error: "GRN not found" });
    // Legacy GRNs from the pre-lifecycle flow have status "received" and were
    // already credited — never credit them again.
    if (receipt.status === "received")
      return res.json({ ...receipt, alreadyConfirmed: true });
    if (receipt.status === "cancelled")
      return res.status(400).json({ error: "Cannot confirm a cancelled GRN" });
    const allowOver =
      !!req.body?.allowOverReceipt &&
      (req.user!.roles?.includes("factor_admin") ||
        req.user!.roles?.includes("checker"));
    const po = await GoodsPO.get(receipt.goodsPurchaseOrderId);
    if (!po) return res.status(404).json({ error: "PO not found" });
    try {
      assertPOReceivable(po);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
    const receivingLocation = receipt.receivingLocationId
      ? await StockLocation.get(receipt.receivingLocationId)
      : await StockLocation.getDefaultLocation(clientId);
    if (!receivingLocation || receivingLocation.clientId !== clientId || receivingLocation.status !== "active")
      return res.status(400).json({ error: "The GRN receiving location is missing or inactive" });
    // Re-validate at confirm time — the PO may have been received further in the
    // meantime, so pending is checked against the live PO.
    try {
      validateReceiptLines(po, receipt.lines, allowOver);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
    // Variance gate (PDF-3 §3): received ≠ PO → warehouse note required.
    const variance = (receipt.lines ?? []).some((l: any) => {
      const poLine = (po.lines ?? []).find((x: any) => x.productId === l.productId);
      return poLine && Number(l.receivedQty) !== Number(poLine.orderedQty);
    });
    if (variance && !String((receipt as any).notes ?? "").trim() && !String(req.body?.notes ?? "").trim()) {
      return res.status(400).json({ error: "Received quantity differs from the PO — add a warehouse note first" });
    }
    // Atomic draft → confirmed flip: exactly one concurrent confirm wins and
    // credits stock; the others get alreadyConfirmed and credit nothing.
    const flipped = await GoodsReceipt.flipToConfirmed(
      receipt.id,
      req.user!.email,
    );
    if (!flipped) return res.json({ ...receipt, alreadyConfirmed: true });
    await creditGoodsReceipt(clientId, { ...flipped, receivingLocationId: receivingLocation.id }, po);
    trackAction(req, "grn.confirmed", receipt.id, {
      entityType: "grn",
      entityRef: receipt.receiptNumber,
      poNumber: receipt.poNumber,
      lines: receipt.lines?.length ?? 0,
    });
    timelineStatus(req, { clientId, docType: "grn", docId: receipt.id, docNumber: receipt.receiptNumber },
      "draft", "confirmed", `Warehouse confirmed GRN — inventory credited against ${receipt.poNumber}`);
    await WorkflowTask.closeTasksForDoc("purchase_order", po.id, req.user, "Goods received");
    await syncLinkedPurchaseInvoice(flipped);
    recomputeForecast(clientId);
    res.json(flipped);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /goods-receipts/:id/cancel — reversing debit entries only if stock was credited. */
router.post("/goods-receipts/:id/cancel", authMiddleware, async (req, res) => {
  try {
    const clientId = req.user!.userId;
    const receipt = await GoodsReceipt.get(req.params.id);
    if (!receipt) return res.status(404).json({ error: "GRN not found" });
    if (receipt.status === "cancelled")
      return res.json({ ...receipt, alreadyCancelled: true });
    // Atomic → cancelled flip: only the winner performs the reversal.
    const flipped = await GoodsReceipt.flipToCancelled(
      receipt.id,
      req.user!.email,
    );
    if (!flipped) return res.json({ ...receipt, alreadyCancelled: true });
    // Decide reversal from POST-flip state: "received" is the legacy confirmed
    // status (stock was credited), and flipToCancelled keeps stockCredited true
    // from confirm — so this is also safe against a confirm racing in between.
    const wasCredited =
      receipt.status === "received" || flipped.stockCredited === true;
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
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** PUT /goods-receipts/:id — edit a DRAFT only (no stock impact). */
router.put("/goods-receipts/:id", authMiddleware, async (req, res) => {
  try {
    const receipt = await GoodsReceipt.get(req.params.id);
    if (!receipt) return res.status(404).json({ error: "GRN not found" });
    if (receipt.status !== "draft")
      return res
        .status(400)
        .json({
          error: "Only draft GRNs can be edited — confirm or cancel first",
        });
    const body = req.body || {};
    const po = await GoodsPO.get(receipt.goodsPurchaseOrderId);
    if (!po) return res.status(404).json({ error: "PO not found" });
    let lines = receipt.lines;
    if (body.lines !== undefined) {
      try {
        lines = validateReceiptLines(po, body.lines, false);
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }
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
      receivingLocationId: body.receivingLocationId ?? receipt.receivingLocationId,
    });
    await syncLinkedPurchaseInvoice(
      updated,
      receipt.purchaseInvoiceId ?? undefined,
    );
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /goods-receipts/:id — delete a DRAFT only. Confirmed GRNs must be cancelled first. */
router.delete("/goods-receipts/:id", authMiddleware, async (req, res) => {
  try {
    const receipt = await GoodsReceipt.get(req.params.id);
    if (!receipt) return res.status(404).json({ error: "GRN not found" });
    if (receipt.status !== "draft") {
      return res
        .status(400)
        .json({
          error:
            "Only draft GRNs can be deleted — cancel confirmed GRNs instead",
        });
    }
    // Detach any linked purchase invoice so it doesn't dangle at a deleted GRN.
    await syncLinkedPurchaseInvoice(
      { ...receipt, status: "cancelled" },
      receipt.purchaseInvoiceId ?? undefined,
    );
    await GoodsReceipt.remove(receipt.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== GOODS SALES ORDERS (catalogue-backed SOs) =====================
// A sales order records a customer's confirmed order against the catalogue. It
// NEVER debits inventory — stock only reduces after a CONFIRMED dispatch note
// (the sales-side mirror of PO → GRN).

/** Shape + catalogue checks for SO lines. SKUs must come from the product catalogue. */
async function validateGoodsSOLines(clientId: string | undefined, rawLines: any[]) {
  const lines = Array.isArray(rawLines) ? rawLines : [];
  if (lines.length === 0) throw new Error("Add at least one product line");
  const products = await Product.list(clientId);
  const productById = new Map(products.map((p: any) => [p.id, p]));
  for (const l of lines) {
    if (!l.productId)
      throw new Error("Every line must select a product from the catalogue");
    if (!productById.has(l.productId))
      throw new Error("Every SKU must come from the product catalogue");
    if (!(Number(l.orderedQty) > 0))
      throw new Error("Ordered quantity must be greater than zero");
    if (Number(l.unitPrice) < 0)
      throw new Error(
        "Unit selling price must be greater than or equal to zero",
      );
    if (
      l.discountPct !== undefined &&
      l.discountPct !== null &&
      l.discountPct !== ""
    ) {
      const d = Number(l.discountPct);
      if (!Number.isFinite(d) || d < 0 || d > 100) {
        throw new Error("Discount must be a percentage between 0 and 100");
      }
    }
    applyVariantSnapshot(l, productById.get(l.productId));
    // Server-owned print snapshots (code/MRP/HSN): always refreshed from the
    // catalogue so the Tally-style SO PDF prints catalogue truth.
    // (Colour/size are handled by applyVariantSnapshot above.)
    const soProduct = productById.get(l.productId) as any;
    if (soProduct) {
      l.productCode = soProduct.model || soProduct.sku || null;
      l.mrp = soProduct.mrp ?? null;
      const hsn = soProduct.hsnCode ?? soProduct.hsn_code ?? null;
      if (hsn) l.hsnCode = hsn;
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
  } catch {
    /* ignore */
  }
  return null;
}

router.get("/goods-sales-orders", authMiddleware, async (req, res) => {
  try {
    res.json(await GoodsSO.list(effectiveListScope(req)));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.get(
  "/goods-sales-orders/pending-invoices",
  authMiddleware,
  async (req, res) => {
    try {
      const clientId = req.user!.userId;
      const { items } = await db.queryByGSI1(clientId, {
        entityType: "GoodsSalesOrder",
        limit: 500,
        reverse: true,
      });
      const pendingInvoices = (items as any[]).filter(
        (so) =>
          (so.status ?? "").toString() === "confirmed" &&
          (so.warehouseStatus ?? null) === "approved",
      );
      res.json(pendingInvoices);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);
router.get(
  "/goods-sales-orders/proforma-pending",
  authMiddleware,
  async (req, res) => {
    try {
      const clientId = req.user!.userId;
      const { items } = await db.queryByGSI1(clientId, {
        entityType: "GoodsSalesOrder",
        limit: 500,
        reverse: true,
      });
      const proformaPending = (
        await Promise.all(
          (items as any[]).map(async (so) => {
            if (!so.customerId) return null;
            const debtor = await Debtor.get(so.customerId);
            if (!debtor) return null;
            const hasAdvanceTerms =
              (debtor.paymentTermsType ?? "credit") === "advance_full" ||
              (debtor.paymentTermsType ?? "credit") === "advance_partial";
            return hasAdvanceTerms && (so.warehouseStatus ?? null) === "approved"
              ? so
              : null;
          }),
        )
      ).filter(Boolean);
      res.json(proformaPending);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);
router.post("/goods-sales-orders", authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    let lines: any[];
    try {
      lines = await validateGoodsSOLines(effectiveListScope(req), body.lines);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
    if (!body.customerName && body.customerId)
      body.customerName = await resolveCustomerName(body.customerId);
    // PDF §2: copy the selected approved term as a permanent snapshot.
    // If the caller picked a term, verify it belongs to this customer;
    // otherwise fall back to the customer's default term.
    if (body.customerId) {
      try {
        const { normalizeBalancePct, normalizeBalanceDueDays } =
          await import("../lib/payment-terms.js");
        let term: any = null;
        if (body.paymentTermId) {
          term = await DebtorTerm.getById(String(body.paymentTermId));
          if (!term || term.debtorId !== body.customerId || term.isActive === false) {
            return res.status(400).json({
              error: "Selected payment term is not approved for this customer",
            });
          }
        } else {
          term = await DebtorTerm.getDefault(body.customerId);
        }
        if (term) {
          body.paymentTermId = term.id;
          body.paymentTermName = term.name;
          body.paymentTermsType = term.paymentTermsType;
          body.advancePct = term.advancePct;
          body.balancePct =
            normalizeBalancePct(body.balancePct) ?? term.balancePct;
          body.balanceDueDays =
            normalizeBalanceDueDays(body.balanceDueDays) ?? term.balanceDueDays;
          body.balanceDueBasis = term.balanceDueBasis;
          body.advanceDueBasis = term.advanceDueBasis;
          body.dispatchCondition = term.dispatchCondition;
          if (!body.paymentTerms) body.paymentTerms = term.name;
        }
      } catch (e: any) {
        console.error("  ⚠ payment-term snapshot failed:", e?.message ?? e);
      }
    }
    const item = await GoodsSO.create({
      ...body,
      // Every newly created sales order must enter the Sales review gate.
      status: "draft",
      lines,
      clientId: req.user!.userId,
      salespersonId: req.user!.userId,
      salespersonName: req.user!.email,
    });
    timelineStatus(req, { clientId: req.user!.userId, docType: "sales_order", docId: item.id, docNumber: item.soNumber },
      null, "draft", `Sales created ${item.soNumber} for ${item.customerName ?? "customer"}`);
    advanceWorkflow(req, {
      workflowType: "sales_order",
      stage: "stock_check",
      docType: "sales_order",
      docId: item.id,
      docNumber: item.soNumber,
      counterparty: item.customerName,
      docStatus: "draft",
      ownerRole: "operations",
      requiredAction: "Confirm and reserve stock",
      nextAction: "Send to Checker",
      amount: Number(item.grandTotal) || 0,
      inventoryStatus: "pending",
      linkedDocs: [],
    }, { timelineKind: "system", docType: "sales_order", appPath: "/app/warehouse" });
    res.status(201).json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.put("/goods-sales-orders/:id", authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    const roles = req.user?.roles ?? [];
    if (roles.includes("checker") && !roles.includes("factor_admin") && !roles.includes("super_admin")) {
      return res.status(403).json({ error: "Checker users may only approve or reject sales orders" });
    }
    const current = await GoodsSO.get(req.params.id);
    if (!current) return res.status(404).json({ error: "Sales order not found" });
    // Workflow states are changed only through the dedicated review endpoints.
    // This prevents a generic edit request from skipping Sales, Warehouse, or
    // Checker approval. Cancellation remains an explicit normal edit action.
    if (body.status !== undefined && body.status !== current.status && body.status !== "cancelled") {
      return res.status(403).json({ error: "Use the sales-order workflow actions to change status" });
    }
    if (body.lines !== undefined) {
      let lines: any[];
      try {
        lines = await validateGoodsSOLines(effectiveListScope(req), body.lines);
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }
      body.lines = lines;
    }
    if (body.customerName === undefined && body.customerId)
      body.customerName = await resolveCustomerName(body.customerId);
    // Warehouse sign-off is controlled exclusively by the dedicated sign-off
    // endpoint — strip it from generic edits so it can't be smuggled through.
    delete body.warehouseStatus;
    delete body.warehouseApprovedBy;
    delete body.warehouseApprovedAt;
    delete body.warehouseNotes;
    // PDF §2: the payment-term snapshot is permanent. Once the SO leaves
    // draft, term fields can only change through a term re-selection that
    // re-snapshots from an approved master term.
    const SNAPSHOT_FIELDS = [
      "paymentTermId",
      "paymentTermName",
      "paymentTermsType",
      "advancePct",
      "balancePct",
      "balanceDueDays",
      "balanceDueBasis",
      "advanceDueBasis",
      "dispatchCondition",
    ];
    const touchesSnapshot = SNAPSHOT_FIELDS.some((k) => body[k] !== undefined);
    if (touchesSnapshot && current && current.status !== "draft") {
      // Allow re-selection only when the caller supplies a valid approved
      // term id for the same customer — re-snapshot from the master.
      if (body.paymentTermId && body.paymentTermId !== (current as any).paymentTermId) {
        const term = await DebtorTerm.getById(String(body.paymentTermId));
        if (!term || term.debtorId !== current.customerId || term.isActive === false) {
          return res.status(400).json({
            error: "Selected payment term is not approved for this customer",
          });
        }
        body.paymentTermName = term.name;
        body.paymentTermsType = term.paymentTermsType;
        body.advancePct = term.advancePct;
        body.balancePct = term.balancePct;
        body.balanceDueDays = term.balanceDueDays;
        body.balanceDueBasis = term.balanceDueBasis;
        body.advanceDueBasis = term.advanceDueBasis;
        body.dispatchCondition = term.dispatchCondition;
        body.paymentTerms = term.name;
      } else {
        return res.status(403).json({
          error: "Payment terms are frozen on this sales order — select another approved term to change them",
        });
      }
    }
    // A re-confirmed SO re-enters the warehouse queue: clear the previous
    // sign-off so the hard gate re-applies after a checker review cycle.
    if (body.status === "confirmed") {
      if (current && ["draft", "pending_review", "cancelled"].includes(current.status)) {
        body.warehouseStatus = null;
        body.warehouseApprovedBy = null;
        body.warehouseApprovedAt = null;
        body.warehouseNotes = null;
      }
    }
    res.json(await GoodsSO.update(req.params.id, body));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.delete("/goods-sales-orders/:id", authMiddleware, async (req, res) => {
  try {
    await GoodsSO.remove(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /goods-sales-orders/:id/pdf — download the Tally-style sales-order PDF. */
router.get("/goods-sales-orders/:id/pdf", authMiddleware, async (req, res) => {
  try {
    const so = await GoodsSO.get(req.params.id);
    if (!so || (so.clientId !== req.user!.userId && !isStaffAccount(req.user?.roles))) {
      return res.status(404).json({ error: "Sales order not found" });
    }
    const { pdf, number } = await buildSalesOrderTallyBuffer(so, so.clientId);
    const filename = `${(number || "sales-order").replace(/[^A-Za-z0-9-_]/g, "_")}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(pdf);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /goods-purchase-orders/:id/pdf — download the garment-style purchase-order PDF. */
router.get("/goods-purchase-orders/:id/pdf", authMiddleware, async (req, res) => {
  try {
    const po = await GoodsPO.get(req.params.id);
    if (!po || (po.clientId !== req.user!.userId && !isStaffAccount(req.user?.roles))) {
      return res.status(404).json({ error: "Purchase order not found" });
    }
    const { pdf, number } = await buildGoodsPOTallyBuffer(po, po.clientId);
    const filename = `${(number || "purchase-order").replace(/[^A-Za-z0-9-_]/g, "_")}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(pdf);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** Sales review: draft -> pending_review -> warehouse_pending. */
router.post(
  "/goods-sales-orders/:id/sales-review",
  authMiddleware,
  async (req, res) => {
    try {
      const so = await GoodsSO.get(req.params.id);
      if (!so) return res.status(404).json({ error: "Sales order not found" });
      const action = String(req.body?.action || "submit");
      const roles = req.user!.roles ?? [];
      const isSalesReviewer = roles.some((r) =>
        ["reporting_manager", "factor_admin", "super_admin"].includes(r),
      );
      const transitions: Record<string, { from: string; to: string }> = {
        submit: { from: "draft", to: "pending_review" },
        approve: { from: "pending_review", to: "warehouse_pending" },
        reject: { from: "pending_review", to: "draft" },
      };
      const transition = transitions[action];
      if (!transition)
        return res.status(400).json({ error: "action must be submit, approve or reject" });
      if ((action === "approve" || action === "reject") && !isSalesReviewer) {
        return res.status(403).json({ error: "Only a reporting manager or admin can review sales orders" });
      }
      if (so.status !== transition.from)
        return res.status(409).json({ error: `Sales order must be ${transition.from}` });

      const isDecision = action !== "submit";
      const updated = await GoodsSO.update(so.id, {
        status: transition.to as any,
        manualStatus: transition.to as any,
        salesReviewedBy: isDecision ? req.user!.userId : null,
        salesReviewedAt: isDecision ? new Date().toISOString() : null,
        salesReviewNotes: req.body?.notes ? String(req.body.notes) : null,
        // A fresh Sales approval always starts a fresh warehouse sign-off.
        ...(action === "approve"
          ? { warehouseStatus: null, warehouseApprovedBy: null, warehouseApprovedAt: null, warehouseNotes: null }
          : {}),
      });
      trackAction(req, `sales_order.sales_review_${action}`, so.id, {
        entityType: "sales_order", entityRef: so.soNumber,
        previous: so.status, status: transition.to,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

/** Warehouse sign-off: warehouse_pending -> checker_pending. */
router.post(
  "/goods-sales-orders/:id/warehouse-approve",
  authMiddleware,
  requireRole("operations", "factor_admin", "super_admin"),
  async (req, res) => {
    try {
      const so = await GoodsSO.get(req.params.id);
      if (!so) return res.status(404).json({ error: "Sales order not found" });
      const action = String(req.body?.action || "approve");
      const transitions: Record<string, { from: string; to: string }> = {
        approve: { from: "warehouse_pending", to: "checker_pending" },
        reject: { from: "warehouse_pending", to: "pending_review" },
      };
      const transition = transitions[action];
      if (!transition)
        return res.status(400).json({ error: "action must be approve or reject" });
      if (so.status !== transition.from)
        return res.status(409).json({ error: `Sales order must be ${transition.from}` });

      // Reservation payload (stock check reserves, never debits — PDF-2 §3).
      const stockStatus = String(req.body?.stockStatus || "reserved");
      if (!["reserved", "in_transit"].includes(stockStatus) && action === "approve") {
        return res.status(400).json({ error: "stockStatus must be reserved or in_transit" });
      }
      const updated = await GoodsSO.update(so.id, {
        status: transition.to as any,
        manualStatus: transition.to as any,
        warehouseStatus: action === "approve" ? "approved" : "on_hold",
        warehouseApprovedBy: req.user!.userId,
        warehouseApprovedAt: new Date().toISOString(),
        warehouseNotes: req.body?.notes ? String(req.body.notes) : null,
        ...(action === "approve"
          ? {
              stockStatus: stockStatus as any,
              dispatchLocation: req.body?.dispatchLocation ? String(req.body.dispatchLocation) : so.dispatchLocation,
              expectedInwardDate: stockStatus === "in_transit" ? String(req.body?.expectedInwardDate || "") || null : null,
              reservedBy: req.user!.userId,
              reservedAt: new Date().toISOString(),
              workflowStatus: "checker_pending",
              currentOwnerRole: "checker",
              nextRequiredAction: "Approve or reject Sales Order",
            }
          : {}),
      });
      trackAction(req, `sales_order.warehouse_${action}`, so.id, {
        entityType: "sales_order", entityRef: so.soNumber,
        previous: so.status, status: transition.to,
      });
      timelineStatus(req, { clientId: so.clientId, docType: "sales_order", docId: so.id, docNumber: so.soNumber },
        so.status, transition.to as string,
        action === "approve"
          ? `Warehouse ${stockStatus === "in_transit" ? "marked Stock In Transit" : "reserved stock"} at ${req.body?.dispatchLocation || so.dispatchLocation || "warehouse"}${req.body?.notes ? ` — ${req.body.notes}` : ""}`
          : `Warehouse put order on hold${req.body?.notes ? `: ${req.body.notes}` : ""}`);
      // Signed off → pending in checker: mail admin, treasury, checker users.
      if (action === "approve" && transition.to === "checker_pending") {
        notifyPendingQueue(req, {
          stage: "checker",
          kind: "sales_order",
          number: so.soNumber,
          amount: Number((updated as any)?.grandTotal ?? so.grandTotal) || 0,
          dueDate: (updated as any)?.expectedDeliveryDate ?? (so as any)?.expectedDeliveryDate ?? null,
          reviewPath: "/app/checker",
        });
        advanceWorkflow(req, {
          workflowType: "sales_order",
          stage: "checker_approval",
          docType: "sales_order",
          docId: so.id,
          docNumber: so.soNumber,
          counterparty: so.customerName,
          docStatus: "checker_pending",
          ownerRole: "checker",
          requiredAction: "Approve or reject Sales Order",
          nextAction: "Send to Client",
          amount: Number((updated as any)?.grandTotal ?? so.grandTotal) || 0,
          inventoryStatus: (updated as any)?.stockStatus ?? "reserved",
        }, { timelineKind: "system", docType: "sales_order", appPath: "/app/checker" });
      }
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

/** Checker approval: checker_pending -> confirmed. */
router.post(
  "/goods-sales-orders/:id/checker-approve",
  authMiddleware,
  requireRole("checker", "factor_admin", "super_admin"),
  async (req, res) => {
    try {
      const so = await GoodsSO.get(req.params.id);
      if (!so) return res.status(404).json({ error: "Sales order not found" });
      const action = String(req.body?.action || "approve");
      const transitions: Record<string, { from: string; to: string }> = {
        approve: { from: "checker_pending", to: "confirmed" },
        reject: { from: "checker_pending", to: "warehouse_pending" },
      };
      // Existing records from the former workflow may still be parked at
      // warehouse_approved. Let a checker complete those legacy records; all
      // newly approved warehouse orders go directly to checker_pending.
      const transition =
        action === "approve" && so.status === "warehouse_approved"
          ? { from: "warehouse_approved", to: "confirmed" }
          : transitions[action];
      if (!transition)
        return res.status(400).json({ error: "action must be approve or reject" });
      if (so.status !== transition.from)
        return res.status(409).json({ error: `Sales order must be ${transition.from}` });
      // Rejection requires a reason (PDF-3 §8) — it travels back with the task.
      const reason = String(req.body?.notes ?? req.body?.reason ?? "").trim();
      if (action === "reject" && !reason) {
        return res.status(400).json({ error: "A reason is required to reject the sales order" });
      }

      const updated = await GoodsSO.update(so.id, {
        status: transition.to as any,
        manualStatus: transition.to as any,
        reviewedBy: action === "approve" ? req.user!.userId : null,
        reviewedAt: action === "approve" ? new Date().toISOString() : null,
        ...(action === "reject"
          ? { warehouseStatus: "pending", warehouseApprovedBy: null, warehouseApprovedAt: null }
          : {
              workflowStatus: "sent_to_client",
              currentOwnerRole: "client",
              nextRequiredAction: "Accept, reject or request change",
            }),
      });
      trackAction(req, `sales_order.checker_${action}`, so.id, {
        entityType: "sales_order", entityRef: so.soNumber,
        previous: so.status, status: transition.to,
      });
      if (action === "reject") {
        timelineStatus(req, { clientId: so.clientId, docType: "sales_order", docId: so.id, docNumber: so.soNumber },
          so.status, transition.to as string, `Checker rejected: ${reason}`, "rejection");
        advanceWorkflow(req, {
          workflowType: "sales_order",
          stage: "stock_check",
          docType: "sales_order",
          docId: so.id,
          docNumber: so.soNumber,
          counterparty: so.customerName,
          docStatus: transition.to,
          ownerRole: "operations",
          requiredAction: "Re-check stock after checker rejection",
          nextAction: "Send to Checker",
          amount: Number(so.grandTotal) || 0,
        }, { timelineKind: "rejection", timelineText: `Checker rejected: ${reason}`, emailKind: "rejection", docType: "sales_order", appPath: "/app/warehouse" });
        return res.json(updated);
      }
      // Checker approved → system auto-sends the SO to the client (PDF-2 §3).
      let sendNote: string | null = null;
      try {
        const sent = await sendDocumentToDebtor("sales_order", { ...so, ...(updated as any) }, so.clientId);
        await GoodsSO.update(so.id, {
          debtorApprovalStatus: "pending",
          debtorApprovalToken: sent.token,
          debtorApprovalSentAt: db.nowISO(),
          debtorApprovalRespondedAt: null,
          debtorApprovalComments: null,
          debtorApprovalEmail: sent.email,
        });
        timelineStatus(req, { clientId: so.clientId, docType: "sales_order", docId: so.id, docNumber: so.soNumber },
          "confirmed", "sent_to_client", `Checker approved — SO emailed to ${sent.email} for client acceptance`);
      } catch (e: any) {
        sendNote = e?.message ?? "automatic email failed";
        timelineStatus(req, { clientId: so.clientId, docType: "sales_order", docId: so.id, docNumber: so.soNumber },
          "confirmed", "confirmed", `Checker approved — auto-email failed (${sendNote}); resend from Sales Orders`);
      }
      advanceWorkflow(req, {
        workflowType: "sales_order",
        stage: "client_acceptance",
        docType: "sales_order",
        docId: so.id,
        docNumber: so.soNumber,
        counterparty: so.customerName,
        docStatus: "confirmed",
        ownerRole: "client",
        requiredAction: "Accept, reject or request change",
        nextAction: "Create Finance task",
        amount: Number(so.grandTotal) || 0,
        inventoryStatus: (so as any).stockStatus ?? "reserved",
      }, {
        timelineKind: "system",
        timelineText: sendNote ? `Awaiting client acceptance (auto-email failed: ${sendNote})` : "Awaiting client acceptance — approval link emailed",
        docType: "sales_order",
        appPath: "/app/sales-orders",
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

/** POST /goods-sales-orders/:id/warehouse-signoff — warehouse accept/hold/reject.
 *  A hard gate: dispatch notes can only be created against warehouse-approved
 *  SOs. Only operations/admin can sign off; the checker re-confirm flow clears
 *  the sign-off so a re-confirmed order re-enters the warehouse queue. */
const WAREHOUSE_SIGNOFF_ROLES = ["factor_admin", "super_admin", "operations"];
router.post(
  "/goods-sales-orders/:id/warehouse-signoff",
  authMiddleware,
  async (req, res) => {
    try {
      const user = req.user!;
      if (!user.roles?.some((r) => WAREHOUSE_SIGNOFF_ROLES.includes(r))) {
        return res
          .status(403)
          .json({ error: "Only operations or admin can sign off sales orders" });
      }
      const so = await GoodsSO.get(req.params.id);
      if (!so) return res.status(404).json({ error: "Sales order not found" });
      const status = String(req.body?.status || "");
      if (!["approved", "on_hold", "rejected"].includes(status)) {
        return res
          .status(400)
          .json({ error: "status must be approved, on_hold or rejected" });
      }
      const previous = so.warehouseStatus ?? null;
      const updated = await GoodsSO.update(so.id, {
        warehouseStatus: status as any,
        warehouseApprovedBy: user.userId,
        warehouseApprovedAt: new Date().toISOString(),
        warehouseNotes:
          req.body?.notes !== undefined
            ? String(req.body.notes || "") || null
            : so.warehouseNotes,
      });
      trackAction(req, "sales_order.warehouse_signoff", so.id, {
        entityType: "sales_order",
        entityRef: so.soNumber,
        status,
        previous,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ===================== DEBTOR PDF APPROVALS =====================
// Send a sales order PDF to the debtor by email with an
// Approve/Reject link. The debtor's decision is recorded on the document and
// reflected in the Sales Orders tab (accepted / confirmed).
// The public /approvals/:token endpoints are token-authenticated (rate-limited,
// no login) and one-time: the token is cleared once the debtor responds.

/** Locate a document by its one-time approval token (debtor or supplier). */
async function findApprovalDoc(
  token: string,
): Promise<{
  kind: "sales_order" | "purchase_order";
  doc: any;
} | null> {
  const [sos, pos] = await Promise.all([
    db.scanByType("GoodsSalesOrder"),
    db.scanByType("GoodsPurchaseOrder"),
  ]);
  const so = (sos as any[]).find((x) => x.debtorApprovalToken === token);
  if (so) return { kind: "sales_order", doc: so };
  const po = (pos as any[]).find((x) => x.supplierApprovalToken === token);
  if (po) return { kind: "purchase_order", doc: po };
  return null;
}

/** Resolve the client's company name + contact + address for PDFs and email branding. */
async function resolveCompanyName(
  userId: string,
): Promise<{ name: string; contact: string | null; address: string | null }> {
  try {
    const client = await db.getItem(`USER#${userId}`);
    if (client) {
      return {
        name:
          (client as any).companyName || (client as any).email || "Our Company",
        contact: (client as any).email || null,
        address: (client as any).address || null,
      };
    }
  } catch {
    /* ignore */
  }
  return { name: "Our Company", contact: null, address: null };
}

/** Shared send-to-debtor logic: build PDF, email it, return the fresh token. */
/** Seller + bank + logo inputs for the Tally-style SO PDF (template first, user record fallback). */
async function resolveTallySellerParts(clientId: string): Promise<{
  seller: { name: string; address: string; gstin: string; stateName: string; stateCode: string; email: string };
  bank: { holder: string; bank: string; acNo: string; ifsc: string; branch: string } | null;
  bankRaw: string | null;
  declarationRaw: string | null;
  logoImage: Buffer | null;
}> {
  const [template, company] = await Promise.all([
    Combined.getTemplate(clientId).catch(() => null),
    resolveCompanyName(clientId),
  ]);
  const t = (template ?? {}) as any;
  // Company identity precedence: the address written in Settings (user
  // profile) wins everywhere; the invoice template is the fallback. Name and
  // email keep the template-first print-branding override. Nothing is
  // defaulted here — blanks render blank on the PDF.
  const rawName = t.companyName || company.name || "";
  const seller = {
    name: rawName === "Our Company" ? "" : rawName,
    address: company.address || t.companyAddress || "",
    gstin: t.taxId || "",
    stateName: t.companyState || "",
    stateCode: t.companyStateCode || "",
    email: t.companyEmail || company.contact || "",
  };
  const bank =
    t.bankHolder || t.bankName || t.bankAcNo || t.bankIfsc || t.bankBranch
      ? {
          holder: t.bankHolder || "",
          bank: t.bankName || "",
          acNo: t.bankAcNo || "",
          ifsc: t.bankIfsc || "",
          branch: t.bankBranch || "",
        }
      : null;
  let logoImage: Buffer | null = null;
  if (typeof t.logoUrl === "string" && /^https?:\/\//i.test(t.logoUrl)) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const resp = await fetch(t.logoUrl, { signal: ctrl.signal });
      clearTimeout(timer);
      if (resp.ok) logoImage = Buffer.from(await resp.arrayBuffer());
    } catch {
      logoImage = null;
    }
  }
  // Default to the Adventra logo shipped in <repo-root>/img/logo.png.
  if (!logoImage) logoImage = loadRootLogo();
  return { seller, bank, bankRaw: t.bankDetails || null, declarationRaw: t.declaration || null, logoImage };
}

/** Build the Tally-style sales-order PDF for a SO record. Shared by download + email. */
async function buildSalesOrderTallyBuffer(
  doc: any,
  clientId: string,
): Promise<{ pdf: Buffer; number: string; grandTotal: number }> {
  const { seller, bank, bankRaw, declarationRaw, logoImage } = await resolveTallySellerParts(clientId);
  const { salesOrderToTallyData, buildSalesOrderTallyPdf } =
    await import("../lib/document-pdf.js");
  const data = salesOrderToTallyData(doc, {
    seller,
    bank,
    bankRaw,
    declarationRaw,
    logoImage,
  });
  const pdf = await buildSalesOrderTallyPdf(data);
  return { pdf, number: data.number, grandTotal: data.grandTotal };
}

/**
 * Build the garment-style purchase-order PDF for a goods PO record.
 * Shared by download + supplier email. Resolves the supplier master for the
 * vendor block (name/address/contact fallbacks when the PO only stores ids).
 */
async function buildGoodsPOTallyBuffer(
  po: any,
  clientId: string,
): Promise<{ pdf: Buffer; number: string; grandTotal: number }> {
  const { seller, bank, bankRaw, declarationRaw } = await resolveTallySellerParts(clientId);
  const { goodsPOToPdfData, buildGoodsPOTallyPdf } =
    await import("../lib/document-pdf.js");
  let supplier: any = null;
  try {
    const sid = po.supplierId ?? po.supplier_id ?? null;
    if (sid) {
      supplier = await Supplier.get(sid).catch(() => null);
      if (!supplier) supplier = await Vendor.get(sid).catch(() => null);
    }
  } catch { supplier = null; }
  // Bill-to debtor + ship-to supplier masters for the Buyer/Consignee blocks
  // (name/GSTIN fallbacks — the stored addresses always win).
  let billToDebtor: any = null;
  let shipToSupplier: any = null;
  try {
    const bid = po.billToDebtorId ?? po.bill_to_debtor_id ?? null;
    if (bid) billToDebtor = await Debtor.get(bid).catch(() => null);
    const stid = po.shipToSupplierId ?? po.ship_to_supplier_id ?? null;
    if (stid) {
      shipToSupplier = await Supplier.get(stid).catch(() => null);
      if (!shipToSupplier) shipToSupplier = await Vendor.get(stid).catch(() => null);
    }
  } catch { billToDebtor = null; shipToSupplier = null; }
  const data = goodsPOToPdfData(po, { seller, bank, bankRaw, declarationRaw, supplier, billToDebtor, shipToSupplier });
  const pdf = await buildGoodsPOTallyPdf(data);
  return { pdf, number: data.poNumber, grandTotal: data.grandTotal };
}

/**
 * Build the Tally-style tax-invoice PDF (+ e-Way Bill section when data is
 * present) for an invoice record. Shared by download + NOA email.
 * QR encodes the signed QR payload when pasted, else the IRN.
 */
async function buildInvoiceTallyBuffer(
  inv: any,
  clientId: string,
): Promise<{ pdf: Buffer; number: string; grandTotal: number }> {
  const { seller, bank, bankRaw, declarationRaw } = await resolveTallySellerParts(clientId);
  const {
    invoiceToTallyData,
    buildInvoiceTallyPdf,
    makeEinvoiceQrImage,
  } = await import("../lib/document-pdf.js");
  const debtor = inv.debtorId ? await Debtor.get(inv.debtorId).catch(() => null) : null;
  const so = inv.goodsSalesOrderId ? await GoodsSO.get(inv.goodsSalesOrderId).catch(() => null) : null;
  const qrImage = await makeEinvoiceQrImage(inv.signedQr || inv.irn || null).catch(() => null);
  const ewb = await assembleInvoiceEwb(inv, debtor, seller).catch(() => null);
  const data = invoiceToTallyData(inv, {
    debtor,
    so,
    seller,
    bank,
    bankRaw,
    declarationRaw,
    qrImage,
    ewb,
  });
  const pdf = await buildInvoiceTallyPdf(data);
  return { pdf, number: data.number, grandTotal: data.grandTotal };
}

/**
 * Assemble the e-Way Bill print section (v1: manual paste + dispatch/NIC
 * record when linked). Returns null when there is no EWB number anywhere —
 * the PDF then prints the invoice without the EWB section.
 */
async function assembleInvoiceEwb(inv: any, debtor: any, seller: any): Promise<any | null> {
  const dispatches = await GoodsDispatch.list(inv.clientId).catch(() => [] as any[]);
  const dispatch = (dispatches as any[])
    .filter((d) => d.linkedSalesInvoiceId === inv.id && d.status !== "cancelled")
    .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))[0] ?? null;
  let record: any = null;
  if (dispatch) {
    try {
      const EWB = await import("../models/eway-bill.js");
      record = await EWB.getByDispatchId(dispatch.id);
    } catch { record = null; }
  }
  const ewbNo =
    record?.ewbNumber ?? inv.ewbNumber ?? inv.ewb_number ?? null;
  if (!ewbNo) return null;
  const short = (iso: any): string => {
    if (!iso) return "";
    const s = String(iso);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const [Y, M_, D] = s.slice(0, 10).split("-").map(Number);
      return `${D}-${mon[M_ - 1]}-${String(Y).slice(2)}`;
    }
    return s;
  };
  const rawLines: any[] = inv.lines ?? [];
  const goods = rawLines.map((l: any) => ({
    hsn: l.hsnCode ?? l.hsn_code ?? "",
    name: l.name ?? "Item",
    quantity: Number(l.quantity ?? 0) || 0,
    unit: l.unit ?? "unit",
    taxable: Number(l.lineTotal ?? l.line_total ?? 0) || 0,
    rate: Number(l.gstRate ?? l.gst_rate ?? 0) || 0,
  }));
  const subtotal = Number(inv.subtotalGoods ?? inv.subtotal ?? goods.reduce((x, gl) => x + gl.taxable, 0)) || 0;
  const grandTotal = Number(inv.grandTotal ?? inv.grand_total ?? subtotal) || 0;
  const taxTotal = Number(inv.gstTotal ?? inv.gst_total ?? 0) || 0;
  const buyerGstin = inv.buyerGstin ?? inv.buyer_gstin ?? debtor?.gstin ?? "";
  const buyerState = inv.buyerState ?? inv.buyer_state ?? "";
  return {
    docNo: `Tax Invoice - ${inv.invoiceNumber || inv.invoice_number || ""}`,
    date: short(inv.issueDate ?? inv.issue_date ?? ""),
    irn: inv.irn ?? null,
    ackNo: inv.ackNo ?? inv.ack_no ?? null,
    ackDate: short(inv.ackDate ?? inv.ack_date ?? ""),
    ewbNo: String(ewbNo),
    mode: "",
    generatedDate: short(record?.generatedAt ?? record?.createdAt ?? new Date().toISOString()),
    generatedBy: seller?.gstin ?? "",
    approxDistance: record?.approxDistance ? `${record.approxDistance} KM` : "",
    validUpto: short(record?.validUntil ?? ""),
    supplyType: "Outward-Supply",
    txnType: "Bill From - Dispatch From",
    fromName: seller?.name ?? "",
    fromGstin: seller?.gstin ?? "",
    fromState: seller?.stateName ?? "",
    dispatchFrom: dispatch?.warehouse ?? "",
    toName: debtor?.name ?? "",
    toGstin: buyerGstin,
    toState: buyerState,
    shipTo: inv.deliveryAddress ?? inv.delivery_address ?? "",
    goods,
    totalTaxable: Math.round(subtotal * 100) / 100,
    otherAmt: Math.round((grandTotal - subtotal - taxTotal) * 100) / 100,
    totalInvAmt: grandTotal,
    igstAmt: taxTotal,
    transporterId: record?.transporterGstin ?? record?.transporterId ?? "",
    transporterName: dispatch?.transporterName ?? record?.transporterName ?? "",
    transportDocNo: dispatch?.trackingNumber ?? "",
    transportDocDate: "",
    vehicleNo: record?.vehicleNumber ?? "",
    vehicleFrom: String(seller?.stateName || "").toUpperCase(),
    cewbNo: record?.consolidatedEwbNumber ?? "",
  };
}
async function sendDocumentToDebtor(
  kind: "sales_order",
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
    throw new Error(
      "SMTP is not configured — set SMTP_HOST / SMTP_USER / SMTP_PASS to send approval emails",
    );
  }

  const company = await resolveCompanyName(clientId);
  const { pdf, number, grandTotal } = await buildSalesOrderTallyBuffer(doc, clientId);

  const token = uuid();
  const approvalUrl = `${config.appUrl}/approve/${token}`;
  const { sendDocumentApprovalEmail } = await import("../email.js");
  const sent = await sendDocumentApprovalEmail({
    kind,
    number,
    grandTotal,
    validUntil: doc.expectedDeliveryDate ?? doc.expected_delivery_date ?? null,
    customerName: doc.customerName ?? doc.customer_name ?? debtor?.name ?? "Customer",
    customerEmail: email,
    companyName: company.name,
    pdfBuffer: pdf,
    pdfFilename: `${number.replace(/[^A-Za-z0-9-_]/g, "_")}.pdf`,
    approvalUrl,
  });
  if (!sent)
    throw new Error("Failed to send the email — check the SMTP configuration");
  return {
    token,
    email,
    filename: `${number.replace(/[^A-Za-z0-9-_]/g, "_")}.pdf`,
  };
}

/** Shared send-to-supplier logic: build the PO PDF, email it, return the fresh token. */
async function sendPurchaseOrderToSupplier(
  po: any,
  clientId: string,
): Promise<{ token: string; email: string; filename: string }> {
  // The PO supplier can be either a Supplier or a legacy Vendor record — try
  // both masters so the email is always resolved.
  let supplierName: string | null = po.supplierName || null;
  let email: string | null = null;
  if (po.supplierId) {
    const supplier = await Supplier.get(po.supplierId);
    if (supplier) {
      supplierName = supplier.companyName || supplierName;
      email = supplier.contactEmail?.trim() || null;
    } else {
      const vendor = await Vendor.get(po.supplierId);
      if (vendor) {
        supplierName = vendor.name || supplierName;
        email = vendor.contactEmail?.trim() || null;
      }
    }
  }
  if (!email) {
    throw new Error(
      `No contact email on file for "${supplierName || "the supplier"}" — add one in the Suppliers tab first`,
    );
  }
  const { isEmailConfigured } = await import("../email.js");
  if (!isEmailConfigured()) {
    throw new Error(
      "SMTP is not configured — set SMTP_HOST / SMTP_USER / SMTP_PASS to send approval emails",
    );
  }

  const company = await resolveCompanyName(clientId);
  const { pdf, number, grandTotal } = await buildGoodsPOTallyBuffer(po, clientId);
  const data = { number, grandTotal, validUntil: po.expectedDeliveryDate ?? po.expected_delivery_date ?? null };

  const token = uuid();
  const approvalUrl = `${config.appUrl}/approve/${token}`;
  const { sendDocumentApprovalEmail } = await import("../email.js");
  const sent = await sendDocumentApprovalEmail({
    kind: "purchase_order",
    number: data.number,
    grandTotal: data.grandTotal,
    validUntil: data.validUntil,
    customerName: supplierName || "Supplier",
    customerEmail: email,
    companyName: company.name,
    pdfBuffer: pdf,
    pdfFilename: `${data.number.replace(/[^A-Za-z0-9-_]/g, "_")}.pdf`,
    approvalUrl,
  });
  if (!sent)
    throw new Error("Failed to send the email — check the SMTP configuration");
  return {
    token,
    email,
    filename: `${data.number.replace(/[^A-Za-z0-9-_]/g, "_")}.pdf`,
  };
}

/** POST /goods-purchase-orders/:id/send-to-supplier — email the PO PDF for approval. */
router.post(
  "/goods-purchase-orders/:id/send-to-supplier",
  authMiddleware,
  async (req, res) => {
    try {
      const po = await GoodsPO.get(req.params.id);
      if (!po)
        return res.status(404).json({ error: "Purchase order not found" });
      if (po.status !== "approved") {
        return res.status(400).json({
          error:
            "Only checker-approved purchase orders can be sent to the supplier",
        });
      }
      const sent = await sendPurchaseOrderToSupplier(po, req.user!.userId);
      const updated = await GoodsPO.update(po.id, {
        supplierApprovalStatus: "pending",
        supplierApprovalToken: sent.token,
        supplierApprovalSentAt: db.nowISO(),
        supplierApprovalRespondedAt: null,
        supplierApprovalComments: null,
        supplierApprovalEmail: sent.email,
        status: "sent",
        manualStatus: "sent",
      });
      trackAction(req, "purchase_order.sent_to_supplier", po.id, {
        entityType: "purchase_order",
        entityRef: po.poNumber,
        sentTo: sent.email,
        amount: po.grandTotal,
      });
      res.json({ success: true, sentTo: sent.email, document: updated });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  },
);

/** POST /goods-sales-orders/:id/send-to-debtor — email the SO PDF for approval. */
router.post(
  "/goods-sales-orders/:id/send-to-debtor",
  authMiddleware,
  async (req, res) => {
    try {
      const so = await GoodsSO.get(req.params.id);
      if (!so) return res.status(404).json({ error: "Sales order not found" });
      if (so.status !== "confirmed") {
        return res.status(400).json({
          error:
            "Only checker-confirmed sales orders can be sent to the debtor",
        });
      }
      const sent = await sendDocumentToDebtor(
        "sales_order",
        so,
        req.user!.userId,
      );
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
  },
);

/**
 * Whitelisted summary of a document for the public debtor page — never expose
 * internal fields (clientId, salespersonId, approval reviewers, tokens…).
 */
function publicApprovalSummary(
  kind: "sales_order" | "purchase_order",
  doc: any,
) {
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
    // Normalize so the public approval page can read one field set: for a
    // purchase order the supplier approval mirrors the debtor approval fields.
    debtorApprovalStatus:
      kind === "purchase_order"
        ? (doc.supplierApprovalStatus ?? null)
        : (doc.debtorApprovalStatus ?? null),
    debtorApprovalComments:
      kind === "purchase_order"
        ? (doc.supplierApprovalComments ?? null)
        : (doc.debtorApprovalComments ?? null),
  };
  if (kind === "purchase_order") {
    return {
      ...base,
      customerName: doc.supplierName ?? null,
      poNumber: doc.poNumber,
      poDate: doc.poDate,
      expectedDeliveryDate: doc.expectedDeliveryDate,
    };
  }
  return {
    ...base,
    soNumber: doc.soNumber,
    orderDate: doc.orderDate,
    expectedDeliveryDate: doc.expectedDeliveryDate,
  };
}

/** GET /approvals/:token — public, one-time token lookup for the approval page. */
router.get("/approvals/:token", publicTokenLimiter, async (req, res) => {
  try {
    const found = await findApprovalDoc(req.params.token);
    if (!found) return res.status(404).json({ error: "Not found" });
    // Resolve the sending party: debtor for sales docs, supplier for a PO.
    let party: {
      name: string;
      contactName: string | null;
      contactEmail: string | null;
    } | null = null;
    if (found.kind === "purchase_order") {
      const supplier = found.doc.supplierId
        ? await Supplier.get(found.doc.supplierId)
        : null;
      if (supplier) {
        party = {
          name: supplier.companyName || supplier.contactName || "Supplier",
          contactName: supplier.contactName,
          contactEmail: supplier.contactEmail,
        };
      }
    } else {
      const debtor = found.doc.customerId
        ? await Debtor.get(found.doc.customerId)
        : null;
      if (debtor) {
        party = {
          name: debtor.name,
          contactName: debtor.contactName,
          contactEmail: debtor.contactEmail,
        };
      }
    }
    res.json({
      kind: found.kind,
      document: publicApprovalSummary(found.kind, found.doc),
      debtor: party,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /approvals/:token/respond — record the party's decision (one-time, atomic). */
router.post(
  "/approvals/:token/respond",
  publicTokenLimiter,
  async (req, res) => {
    try {
      const { decision, comments } = req.body || {};
      if (!["approved", "rejected"].includes(decision)) {
        return res
          .status(400)
          .json({ error: "decision must be 'approved' or 'rejected'" });
      }
      if (
        comments !== undefined &&
        (typeof comments !== "string" || comments.length > 2000)
      ) {
        return res.status(400).json({ error: "Comments are too long" });
      }
      const found = await findApprovalDoc(req.params.token);
      if (!found) {
        return res
          .status(404)
          .json({
            error: "This approval link is invalid or has already been used",
          });
      }
      const { kind, doc } = found;

      // Per-kind config: which lifecycle statuses are "locked" (the document has
      // moved past the sendable state, so the decision is recorded but the
      // lifecycle status stays untouched), which approval fields to write, and
      // what status to set on approval/rejection.
      const cfg =
        kind === "sales_order"
          ? {
              locked: [
                "partially_dispatched",
                "fully_dispatched",
                "cancelled",
              ],
              field: "debtorApproval",
              pk: `GOODS_SO#${doc.id}`,
              onApprove: "confirmed",
              onReject: "draft",
            }
          : {
              locked: ["partially_received", "fully_received", "cancelled"],
              field: "supplierApproval",
              pk: `GOODS_PO#${doc.id}`,
              onApprove: "sent",
              onReject: "draft",
            };

      const locked = cfg.locked.includes(doc.status);
      const f = cfg.field;
      // Client rejection / change-request requires a reason (PDF-3 §8).
      if (decision !== "approved" && !String(comments || "").trim()) {
        return res.status(400).json({ error: "Please give a reason so Sales can act on it" });
      }
      const patch: Record<string, any> = {
        [`${f}Status`]: decision,
        [`${f}RespondedAt`]: db.nowISO(),
        [`${f}Comments`]: comments || null,
        [`${f}Token`]: null,
      };
      if (!locked) {
        patch.status = decision === "approved" ? cfg.onApprove : cfg.onReject;
        // Keep the manual status in sync so receipt/dispatch-derived statuses
        // can fall back to the right state when fully revoked.
        if (kind === "sales_order" || kind === "purchase_order") {
          patch.manualStatus = patch.status;
        }
        if (kind === "sales_order" && patch.status === "confirmed") {
          // Client acceptance KEEPS the warehouse reservation (PDF-2 §3) and
          // records the acceptance identity for the audit trail.
          patch.debtorApprovalEmail = (doc as any).debtorApprovalEmail ?? null;
          patch.workflowStatus = "finance_pending";
          patch.currentOwnerRole = "treasury";
          patch.nextRequiredAction = "Create Proforma or Final Sales Invoice";
        }
      }

      // Atomic claim: the token must still match, so exactly one concurrent
      // response wins — the loser gets a 404 (link already used).
      const claimed = await db.updateItemIf(
        cfg.pk,
        cfg.pk,
        patch,
        `${f}Token = :tok`,
        { ":tok": req.params.token },
      );
      if (!claimed) {
        return res
          .status(404)
          .json({
            error: "This approval link is invalid or has already been used",
          });
      }
      // Client acceptance auto-creates the correct Finance task (PDF-2 §4):
      // advance% > 0 → Create Advance Proforma, else Create Final Sales Invoice.
      if (kind === "sales_order" && decision === "approved" && !locked) {
        const advancePct = Number((claimed as any).advancePct ?? 0) || 0;
        const needsProforma = advancePct > 0;
        const fakeReq = { user: { userId: (claimed as any).clientId, email: "system", roles: [] } } as any;
        advanceWorkflow(fakeReq, {
          clientId: (claimed as any).clientId,
          workflowType: "sales_order",
          stage: needsProforma ? "create_proforma" : "create_invoice",
          docType: "sales_order",
          docId: (claimed as any).id,
          docNumber: (claimed as any).soNumber,
          counterparty: (claimed as any).customerName,
          docStatus: "confirmed",
          ownerRole: "treasury",
          requiredAction: needsProforma ? "Create Advance Proforma" : "Create Final Sales Invoice",
          nextAction: needsProforma ? "Send proforma and await payment" : "Send invoice for approval / IRN",
          amount: Number((claimed as any).grandTotal) || 0,
          paymentStatus: needsProforma ? "advance_pending" : "not_required",
          inventoryStatus: (claimed as any).stockStatus ?? "reserved",
          linkedDocs: [],
        }, {
          timelineKind: "system",
          timelineText: `Client accepted on ${(claimed as any).debtorApprovalRespondedAt ?? "recorded time"} — Finance task: ${needsProforma ? "Create Advance Proforma" : "Create Final Sales Invoice"}`,
          docType: "sales_order",
          appPath: needsProforma ? "/app/proformas" : "/app/invoices",
        });
      }
      if (kind === "sales_order" && decision !== "approved" && !locked) {
        const fakeReq = { user: { userId: (claimed as any).clientId, email: "system", roles: [] } } as any;
        advanceWorkflow(fakeReq, {
          clientId: (claimed as any).clientId,
          workflowType: "sales_order",
          stage: "stock_check",
          docType: "sales_order",
          docId: (claimed as any).id,
          docNumber: (claimed as any).soNumber,
          counterparty: (claimed as any).customerName,
          docStatus: "draft",
          ownerRole: "operations",
          requiredAction: "Re-check stock after client rejection",
          nextAction: "Send to Checker",
          amount: Number((claimed as any).grandTotal) || 0,
        }, {
          timelineKind: "rejection",
          timelineText: `Client rejected: ${comments}`,
          emailKind: "rejection",
          docType: "sales_order",
          appPath: "/app/warehouse",
        });
      }
      res.json({
        success: true,
        decision,
        status: claimed.status ?? doc.status,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ===================== GOODS DISPATCHES (sales-side of GRN) =====================
// Lifecycle: draft (no stock) → confirm (DEBITS stock with the dispatched
// quantity, folds dispatched qty into the SO) → cancelled (reversing credit
// entries only if stock had already been debited).
// The dispatch note is the ONLY document that debits inventory for sales
// orders — SOs, proformas and sales invoices never touch stock.

function assertSODispatchable(so: any) {
  if (so.status === "cancelled")
    throw new Error("Cannot dispatch against a cancelled sales order");
  if (so.status === "draft" || so.status === "pending_review")
    throw new Error("Confirm the sales order before dispatching goods");
  if (so.status === "fully_dispatched")
    throw new Error("Sales order is already fully dispatched");
  // Warehouse sign-off hard gate — enforced again at confirm time (the moment
  // stock is debited), not just at draft creation.
  if ((so.warehouseStatus ?? null) !== "approved")
    throw new Error(
      `Warehouse sign-off required — this sales order is currently "${
        so.warehouseStatus ?? "pending"
      }". Approve it on the Warehouse Control page first.`,
    );
}

/**
 * Validate dispatch lines against the SO (ordered/pending limits) and snapshot
 * them onto the dispatch note. The over-dispatch gate applies to the
 * dispatched quantity — that is what counts toward the SO and leaves stock.
 */
function validateDispatchLines(
  so: any,
  rawLines: any[],
  allowOverDispatch: boolean,
) {
  const lines: any[] = [];
  if (!Array.isArray(rawLines) || rawLines.length === 0)
    throw new Error("At least one dispatched line required");
  // Accumulate per-product dispatched quantities so duplicate lines can't each
  // pass the pending check and collectively over-dispatch.
  const seen = new Map<string, number>();
  for (const ln of rawLines) {
    const soLine = (so.lines ?? []).find(
      (l: any) => l.productId === ln.productId,
    );
    if (!soLine)
      throw new Error(
        "A dispatch line references a product that is not on this sales order",
      );
    const dispatchedQty = Number(ln.dispatchedQty);
    if (!Number.isFinite(dispatchedQty) || dispatchedQty <= 0)
      throw new Error(
        `Dispatched quantity must be greater than zero for ${soLine.name}`,
      );
    const already = seen.get(soLine.productId) ?? 0;
    const pending = soLine.orderedQty - (soLine.dispatchedQty ?? 0) - already;
    if (dispatchedQty > pending && !allowOverDispatch) {
      throw new Error(
        `Dispatching ${dispatchedQty} for ${soLine.name} exceeds the ${Math.max(0, pending)} pending. Over-dispatch requires checker/admin approval.`,
      );
    }
    seen.set(soLine.productId, already + dispatchedQty);
    lines.push({
      productId: soLine.productId,
      sku: soLine.sku,
      name: soLine.name,
      unit: soLine.unit ?? "unit",
      color: soLine.color ?? null,
      size: soLine.size ?? null,
      orderedQty: soLine.orderedQty,
      dispatchedQty,
      unitPrice: Number(ln.unitPrice ?? soLine.unitPrice) || 0,
      discountPct: soLine.discountPct ?? null,
      gstRate: soLine.gstRate ?? null,
      lineValue:
        Math.round(
          dispatchedQty *
            (Number(ln.unitPrice ?? soLine.unitPrice) || 0) *
            (1 - (soLine.discountPct ?? 0) / 100) *
            100,
        ) / 100,
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
async function stockBalanceByProduct(
  clientId: string,
  locationId: string,
): Promise<Map<string, number>> {
  const movements = await StockMovement.list(clientId);
  const balance = new Map<string, number>();
  for (const m of movements) {
    if (!m.productId || m.status !== "confirmed") continue;
    if (m.direction === "in" && m.destinationLocationId !== locationId) continue;
    if (m.direction === "out" && m.sourceLocationId !== locationId) continue;
    balance.set(
      m.productId,
      (balance.get(m.productId) ?? 0) +
        (m.direction === "in" ? m.quantity : -m.quantity),
    );
  }
  return balance;
}

/** Debit inventory for every dispatch line and fold dispatched qty into the SO. */
async function debitSalesOrder(clientId: string, dispatch: any, so: any) {
  const unitByProduct = new Map<string, string>(
    (so.lines ?? []).map(
      (l: any) =>
        [String(l.productId), String(l.unit ?? "unit")] as [string, string],
    ),
  );
  for (const ln of dispatch.lines ?? []) {
    const qty = debitedQty(ln);
    if (!(qty > 0)) continue;
    let unitCost = ln.unitPrice;
    try {
      const prod = await Product.get(ln.productId);
      if (prod && prod.unitCost != null) unitCost = prod.unitCost;
    } catch {
      /* keep the dispatch snapshot */
    }
    await StockMovement.create({
      clientId,
      productId: ln.productId,
      direction: "out",
      itemName: ln.name,
      sku: ln.sku,
      quantity: qty,
      unit: unitByProduct.get(ln.productId) || ln.unit || "unit",
      unitCost,
      warehouse: dispatch.warehouse || null,
      reason: "Dispatch",
      linkedDocumentType: "Dispatch",
      linkedDocumentNumber: dispatch.dispatchNumber,
      status: "confirmed",
      notes:
        `Dispatch ${dispatch.dispatchNumber} for SO ${dispatch.soNumber ?? ""}`.trim(),
      movementDate: dispatch.dispatchDate,
      goodsDispatchId: dispatch.id,
      salesOrderId: dispatch.goodsSalesOrderId,
      createdById: dispatch.dispatchedById,
      createdByName: dispatch.dispatchedBy,
      confirmedById: dispatch.debitedBy,
      confirmedByName: dispatch.debitedBy,
      confirmedAt: dispatch.debitedAt,
      sourceLocationId: dispatch.sourceLocationId || null,
      destinationLocationId: dispatch.destinationLocationId || null,
      dispatchType: dispatch.dispatchType || null,
      channel: dispatch.channel || null,
    });
  }
  await GoodsSO.recordDispatch(
    dispatch.goodsSalesOrderId,
    (dispatch.lines ?? []).map((l: any) => ({
      productId: l.productId,
      dispatchedQty: debitedQty(l),
    })),
  );
}

/** Create reversing credit (stock-in) entries for a confirmed dispatch and revoke its SO quantities. */
async function reverseDispatch(clientId: string, dispatch: any, so: any) {
  const unitByProduct = new Map<string, string>(
    (so?.lines ?? []).map(
      (l: any) =>
        [String(l.productId), String(l.unit ?? "unit")] as [string, string],
    ),
  );
  for (const ln of dispatch.lines ?? []) {
    const qty = debitedQty(ln);
    if (!(qty > 0)) continue;
    let unitCost = ln.unitPrice;
    try {
      const prod = await Product.get(ln.productId);
      if (prod && prod.unitCost != null) unitCost = prod.unitCost;
    } catch {
      /* keep the dispatch snapshot */
    }
    await StockMovement.create({
      clientId,
      productId: ln.productId,
      direction: "in",
      itemName: ln.name,
      sku: ln.sku,
      quantity: qty,
      unit: unitByProduct.get(ln.productId) || ln.unit || "unit",
      unitCost,
      warehouse: dispatch.warehouse || null,
      reason: "Stock adjustment",
      linkedDocumentType: "Dispatch",
      linkedDocumentNumber: dispatch.dispatchNumber,
      status: "confirmed",
      notes: `Dispatch ${dispatch.dispatchNumber} cancelled — reversal`,
      movementDate: db.todayDate(),
      goodsDispatchId: dispatch.id,
      salesOrderId: dispatch.goodsSalesOrderId,
      createdById: dispatch.cancelledBy,
      createdByName: dispatch.cancelledBy,
      confirmedById: dispatch.cancelledBy,
      confirmedByName: dispatch.cancelledBy,
      confirmedAt: db.nowISO(),
      destinationLocationId: dispatch.sourceLocationId || null,
      dispatchType: dispatch.dispatchType || null,
    });
  }
  await GoodsSO.revokeDispatch(
    dispatch.goodsSalesOrderId,
    (dispatch.lines ?? []).map((l: any) => ({
      productId: l.productId,
      dispatchedQty: debitedQty(l),
    })),
  );
}

router.get("/goods-dispatches", authMiddleware, async (req, res) => {
  try {
    res.json(await GoodsDispatch.list(effectiveListScope(req)));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /goods-dispatches — create a DRAFT dispatch note. No stock impact. */
router.post("/goods-dispatches", authMiddleware, async (req, res) => {
  try {
    const clientId = req.user!.userId;
    const body = req.body || {};
    if (!body.goodsSalesOrderId)
      return res.status(400).json({ error: "goodsSalesOrderId required" });
    const so = await GoodsSO.get(body.goodsSalesOrderId);
    if (!so) return res.status(404).json({ error: "Sales order not found" });
    if (so.status === "cancelled")
      return res
        .status(400)
        .json({
          error: "Cannot create a dispatch against a cancelled sales order",
        });
    // Warehouse sign-off is a HARD GATE: a confirmed SO that the warehouse has
    // not approved (or has put on hold / rejected) cannot be dispatched.
    if ((so.warehouseStatus ?? null) !== "approved") {
      return res.status(400).json({
        error: `Warehouse sign-off required — this sales order is currently "${
          so.warehouseStatus ?? "pending"
        }". Approve it on the Warehouse Control page first.`,
      });
    }
    // A draft may be prepared against any open SO; the dispatchable/over-dispatch
    // checks run at CONFIRM time (the moment stock actually gets debited).
    let lines: any[];
    try {
      lines = validateDispatchLines(so, body.lines, false);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
    // Resolve linked-document numbers for display snapshots.
    let linkedProformaNumber: string | null =
      body.linkedCustomerProformaNumber ?? null;
    if (body.linkedCustomerProformaId && !linkedProformaNumber) {
      const pf = await PurchaseOrder.get(body.linkedCustomerProformaId);
      linkedProformaNumber = pf ? (pf.proformaNumber ?? pf.poNumber) : null;
    }
    let linkedInvoiceNumber: string | null =
      body.linkedSalesInvoiceNumber ?? null;
    if (body.linkedSalesInvoiceId && !linkedInvoiceNumber) {
      const inv = await Invoice.get(body.linkedSalesInvoiceId);
      linkedInvoiceNumber = inv ? inv.invoiceNumber : null;
    }
    const dispatch = await GoodsDispatch.create({
      clientId,
      goodsSalesOrderId: so.id,
      soNumber: so.soNumber,
      customerId: body.customerId ?? so.customerId,
      customerName: body.customerName ?? so.customerName,
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
      dispatchedById: req.user!.userId,
      dispatchedBy: req.user!.email,
      notes: body.notes || null,
      documents: body.documents || [],
      status: "draft",
      lines,
      // Location-based fields
      dispatchType: body.dispatchType || null,
      sourceLocationId: body.sourceLocationId || null,
      destinationLocationId: body.destinationLocationId || null,
      channel: body.channel || null,
    });
    res.status(201).json(dispatch);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /goods-dispatches/:id/confirm — debit stock (idempotent, race-safe). */
router.post(
  "/goods-dispatches/:id/confirm",
  authMiddleware,
  async (req, res) => {
    try {
      const clientId = req.user!.userId;
      const dispatch = await GoodsDispatch.get(req.params.id);
      if (!dispatch)
        return res.status(404).json({ error: "Dispatch note not found" });
      if (dispatch.status === "cancelled")
        return res
          .status(400)
          .json({ error: "Cannot confirm a cancelled dispatch" });
      const allowOver =
        !!req.body?.allowOverDispatch &&
        (req.user!.roles?.includes("factor_admin") ||
          req.user!.roles?.includes("checker"));
      const so = await GoodsSO.get(dispatch.goodsSalesOrderId);
      if (!so) return res.status(404).json({ error: "Sales order not found" });
      // Readiness gate for the new flow (PDF-1 steps 10–12, PDF-2 §9):
      // dispatches built from a final invoice confirm only when Ready
      // (EWB generated) or EWB-Not-Required is recorded. Legacy dispatches
      // without an invoice link keep the old direct-confirm behavior.
      if ((dispatch as any).finalInvoiceId) {
        const ready = dispatch.status === "ready_for_dispatch";
        const excused = (dispatch as any).ewbNotRequired === true && !!(dispatch as any).ewbNotRequiredReason;
        if (!ready && !excused) {
          const hint =
            dispatch.status === "details_submitted"
              ? "E-Way Bill pending — Finance must record it first"
              : "Dispatch order is not submitted — Warehouse must submit packing + transport first";
          return res.status(400).json({ error: `Not ready for physical dispatch: ${hint}` });
        }
        // Dispatch controls (PDF-2 §10 blocked reasons).
        if ((so as any).dispatchHold === true) {
          return res.status(400).json({ error: `Manual dispatch hold: ${(so as any).dispatchHoldReason || "no reason given"}` });
        }
        // Credit-limit check (PDF-2 §10 blocked reasons).
        if (so.customerId) {
          try {
            const debtor = await Debtor.get(so.customerId);
            const limit = Number((debtor as any)?.creditLimit);
            if (Number.isFinite(limit) && limit > 0) {
              const invoices = await Invoice.list(clientId).catch(() => [] as any[]);
              const exposure = (invoices as any[])
                .filter((i: any) => i.debtorId === so.customerId && !["paid", "cancelled", "rejected"].includes(i.status))
                .reduce((s: number, i: any) => s + (Number(i.amount) || 0), 0);
              if (exposure > limit) {
                return res.status(400).json({ error: `Credit limit exceeded — exposure ₹${exposure.toLocaleString("en-IN")} over limit ₹${limit.toLocaleString("en-IN")}` });
              }
            }
          } catch (e: any) {
            if (e?.message?.startsWith("Credit limit exceeded")) throw e;
            console.error("  ⚠ Credit-limit check failed:", e?.message ?? e);
          }
        }
      }
      try {
        assertSODispatchable(so);
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }
      // Re-validate at confirm time — the SO may have been dispatched further in
      // the meantime, so pending is checked against the live SO.
      try {
        validateDispatchLines(so, dispatch.lines, allowOver);
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }
      if (!dispatch.sourceLocationId)
        return res.status(400).json({ error: "Select the warehouse to dispatch from" });
      const sourceLocation = await StockLocation.get(dispatch.sourceLocationId);
      if (!sourceLocation || sourceLocation.clientId !== clientId || sourceLocation.status !== "active")
        return res.status(400).json({ error: "The dispatch source location is missing or inactive" });
      // Stock is owned by a location. Never debit another warehouse or allow a
      // dispatch to create a negative balance in the selected warehouse.
      const balance = await stockBalanceByProduct(clientId, dispatch.sourceLocationId);
      for (const ln of dispatch.lines ?? []) {
        const qty = debitedQty(ln);
        if (!(qty > 0)) continue;
        const available = balance.get(ln.productId) ?? 0;
        if (qty > available) {
          return res.status(400).json({
            error: `${ln.name}: only ${Math.max(0, available)} available in ${sourceLocation.name}; cannot dispatch ${qty}`,
          });
        }
      }
      // Atomic draft → confirmed flip: exactly one concurrent confirm wins and
      // debits stock; the others get alreadyConfirmed and debit nothing.
      const flipped = await GoodsDispatch.flipToConfirmed(
        dispatch.id,
        req.user!.email,
      );
      if (!flipped) return res.json({ ...dispatch, alreadyConfirmed: true });
      await debitSalesOrder(clientId, flipped, so);
      // Physical-confirm capture (PDF-1 step 12): actuals recorded at flip.
      try {
        const actuals: Record<string, any> = {};
        if (req.body?.actualDispatchedAt) actuals.actualDispatchedAt = String(req.body.actualDispatchedAt);
        else actuals.actualDispatchedAt = db.nowISO();
        if (req.body?.actualVehicleNumber !== undefined) actuals.actualVehicleNumber = String(req.body.actualVehicleNumber || "") || null;
        if (req.body?.actualPackedQty !== undefined) actuals.actualPackedQty = Number(req.body.actualPackedQty) || null;
        if (req.body?.lrNumber !== undefined) actuals.lrNumber = String(req.body.lrNumber || "") || null;
        await GoodsDispatch.update(flipped.id, actuals);
      } catch (e) { console.error("  ⚠ Dispatch actuals capture failed:", e); }
      trackAction(req, "dispatch.confirmed", dispatch.id, {
        entityType: "dispatch",
        entityRef: dispatch.dispatchNumber,
        soNumber: dispatch.soNumber,
        lines: dispatch.lines?.length ?? 0,
      });
      timelineStatus(req, { clientId, docType: "dispatch", docId: dispatch.id, docNumber: dispatch.dispatchNumber },
        "ready_for_dispatch", "confirmed",
        `Warehouse confirmed physical dispatch from ${dispatch.warehouse ?? "warehouse"}${req.body?.lrNumber ? ` · LR ${req.body.lrNumber}` : ""} — inventory debited`);
      await WorkflowTask.closeTasksForDoc("dispatch", dispatch.id, req.user, "Physical dispatch confirmed");
      timelineStatus(req, { clientId, docType: "sales_order", docId: so.id, docNumber: so.soNumber },
        so.status, "dispatched", `Goods dispatched via ${dispatch.dispatchNumber} — visible to Sales, Finance and Treasury`);
      recomputeForecast(clientId);
      // Auto-generate E-Way Bill if taxable value exceeds threshold
      (async () => {
        try {
          const { shouldAutoGenerate, generateEwb } = await import("../services/eway-bill-service.js");
          if (shouldAutoGenerate(flipped)) {
            await generateEwb({ dispatchId: flipped.id });
            console.log(`  ✅ E-Way Bill auto-generated for dispatch ${flipped.dispatchNumber}`);
          }
        } catch (err: any) {
          console.error("  ⚠ E-Way Bill auto-generation failed:", err?.message ?? err);
        }
      })();
      // Cash-flow sync: auto-create/update marketplace settlement for marketplace dispatches
      (async () => {
        try {
          if (flipped.dispatchType === "marketplace_sale") {
            const { syncMarketplaceDispatchToSettlement } = await import("../services/cash-flow-sync.js");
            await syncMarketplaceDispatchToSettlement(flipped);
          }
        } catch (err: any) {
          console.error("  ⚠ Cash-flow marketplace sync failed:", err?.message ?? err);
        }
      })();
      res.json(flipped);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

/** POST /goods-dispatches/:id/cancel — reversing credit entries only if stock was debited. */
router.post(
  "/goods-dispatches/:id/cancel",
  authMiddleware,
  async (req, res) => {
    try {
      const clientId = req.user!.userId;
      const dispatch = await GoodsDispatch.get(req.params.id);
      if (!dispatch)
        return res.status(404).json({ error: "Dispatch note not found" });
      if (dispatch.status === "cancelled")
        return res.json({ ...dispatch, alreadyCancelled: true });
      if (dispatch.status === "returned") {
        return res
          .status(400)
          .json({
            error:
              "Cannot cancel a returned dispatch — the return has already credited stock back",
          });
      }
      // EWB generated but goods not leaving → cancel the e-way bill through
      // the approved process first (PDF-1 rule 9 / PDF-2 §9).
      const hasEwb = !!(dispatch.ewayBillNumber || dispatch.ewayBillId) && !dispatch.ewbNotRequired;
      if (hasEwb && req.body?.ewbCancelled !== true) {
        return res.status(400).json({
          error: "E-way bill exists — cancel it first, then retry with ewbCancelled: true",
        });
      }
      // Atomic → cancelled flip: only the winner performs the reversal.
      const flipped = await GoodsDispatch.flipToCancelled(
        dispatch.id,
        req.user!.email,
      );
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
      timelineStatus(req, { clientId, docType: "dispatch", docId: dispatch.id, docNumber: dispatch.dispatchNumber },
        dispatch.status, "cancelled", req.body?.reason ? `Cancelled: ${req.body.reason}` : "Dispatch cancelled");
      await WorkflowTask.closeTasksForDoc("dispatch", dispatch.id, req.user, "Dispatch cancelled");
      recomputeForecast(clientId);
      res.json(flipped);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

/**
 * POST /goods-dispatches/:id/submit-to-finance — warehouse submits packing +
 * transport details (PDF-1). Validates required fields, moves draft →
 * details_submitted, opens the Finance "Generate E-Way Bill" task.
 */
router.post(
  "/goods-dispatches/:id/submit-to-finance",
  authMiddleware,
  requireRole("operations", "factor_admin"),
  async (req, res) => {
    try {
      const dispatch = await GoodsDispatch.get(req.params.id);
      if (!dispatch) return res.status(404).json({ error: "Dispatch note not found" });
      if (dispatch.status !== "draft")
        return res.status(400).json({ error: "Only draft dispatch orders can be submitted" });
      const d: any = { ...dispatch, ...(req.body || {}) };
      const missing: string[] = [];
      if (!d.transportMode) missing.push("transport mode");
      if (!d.transporterName) missing.push("transporter name");
      if (!(Number(d.distanceKm) > 0)) missing.push("approximate distance");
      if (!d.vehicleNumber && !d.transportDocNumber) missing.push("vehicle number or transport document number");
      if (missing.length > 0)
        return res.status(400).json({ error: `Missing dispatch details: ${missing.join(", ")}` });
      const pack: Record<string, any> = {};
      for (const k of ["cartonCount", "packageType", "grossWeight", "grossWeightUnit", "handlingInstructions", "internalDispatchNotes", "plannedDispatchAt", "transportMode", "transporterName", "transporterId", "distanceKm", "vehicleNumber", "vehicleType", "transportDocType", "transportDocNumber", "transportDocDate", "driverName", "driverMobile", "deliveryCity", "deliveryState", "deliveryPincode"]) {
        if ((req.body || {})[k] !== undefined) pack[k] = (req.body || {})[k];
      }
      const updated = await GoodsDispatch.update(dispatch.id, {
        ...pack,
        status: "details_submitted" as any,
        submittedAt: db.nowISO(),
        submittedBy: req.user!.email,
      });
      trackAction(req, "dispatch.submitted", dispatch.id, {
        entityType: "dispatch", entityRef: dispatch.dispatchNumber,
      });
      timelineStatus(req, { clientId: dispatch.clientId, docType: "dispatch", docId: dispatch.id, docNumber: dispatch.dispatchNumber },
        "draft", "details_submitted", `Warehouse submitted packing + transport (${d.transporterName}, ${d.transportMode})`);
      advanceWorkflow(req, {
        workflowType: "dispatch",
        stage: "generate_ewb",
        docType: "dispatch",
        docId: dispatch.id,
        docNumber: dispatch.dispatchNumber,
        counterparty: dispatch.customerName,
        docStatus: "details_submitted",
        ownerRole: "treasury",
        requiredAction: "Generate E-Way Bill",
        nextAction: "Confirm Physical Dispatch",
        amount: (dispatch as any).invoicedValue ?? null,
        linkedDocs: [
          ...(dispatch.finalInvoiceId ? [{ type: "sales_invoice", id: dispatch.finalInvoiceId, number: dispatch.finalInvoiceNumber }] : []),
          { type: "sales_order", id: dispatch.goodsSalesOrderId, number: dispatch.soNumber },
        ],
      }, { timelineKind: "system", docType: "dispatch", appPath: "/app/dispatches" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

/**
 * POST /goods-dispatches/:id/send-back — Finance returns the dispatch order
 * for correction before EWB generation (PDF-1 rule 8). Reason mandatory.
 */
router.post(
  "/goods-dispatches/:id/send-back",
  authMiddleware,
  requireRole("treasury", "factor_admin"),
  async (req, res) => {
    try {
      const reason = String(req.body?.reason ?? "").trim();
      if (!reason) return res.status(400).json({ error: "A reason is required to send the order back" });
      const dispatch = await GoodsDispatch.get(req.params.id);
      if (!dispatch) return res.status(404).json({ error: "Dispatch note not found" });
      if (dispatch.status !== "details_submitted")
        return res.status(400).json({ error: "Only submitted dispatch orders can be sent back" });
      const updated = await GoodsDispatch.update(dispatch.id, { status: "draft" as any });
      timelineStatus(req, { clientId: dispatch.clientId, docType: "dispatch", docId: dispatch.id, docNumber: dispatch.dispatchNumber },
        "details_submitted", "draft", `Finance sent back for correction: ${reason}`, "rejection");
      advanceWorkflow(req, {
        workflowType: "dispatch",
        stage: "prepare_dispatch",
        docType: "dispatch",
        docId: dispatch.id,
        docNumber: dispatch.dispatchNumber,
        counterparty: dispatch.customerName,
        docStatus: "draft",
        ownerRole: "operations",
        requiredAction: `Correct dispatch order: ${reason}`,
        nextAction: "Submit Dispatch Details to Finance",
        amount: (dispatch as any).invoicedValue ?? null,
      }, { timelineKind: "rejection", timelineText: reason, emailKind: "rejection", docType: "dispatch", appPath: "/app/dispatches" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

/**
 * POST /goods-dispatches/:id/record-ewb — Finance records the EWB (v1 manual;
 * later written by Tally). Saves on dispatch + invoice, moves to
 * ready_for_dispatch, opens "Confirm Physical Dispatch" for Warehouse.
 */
router.post(
  "/goods-dispatches/:id/record-ewb",
  authMiddleware,
  requireRole("treasury", "factor_admin"),
  async (req, res) => {
    try {
      const dispatch = await GoodsDispatch.get(req.params.id);
      if (!dispatch) return res.status(404).json({ error: "Dispatch note not found" });
      if (!["details_submitted", "draft"].includes(dispatch.status))
        return res.status(400).json({ error: "E-Way Bill can only be recorded on a submitted dispatch order" });
      const body = req.body || {};
      // "EWB Not Required" path with authorised reason (PDF-2 §9).
      if (body.notRequired === true) {
        const reason = String(body.reason ?? "").trim();
        if (!reason) return res.status(400).json({ error: "An authorised reason is required when no e-way bill is needed" });
        const updated = await GoodsDispatch.update(dispatch.id, {
          ewbNotRequired: true, ewbNotRequiredReason: reason, status: "ready_for_dispatch" as any,
        });
        timelineStatus(req, { clientId: dispatch.clientId, docType: "dispatch", docId: dispatch.id, docNumber: dispatch.dispatchNumber },
          dispatch.status, "ready_for_dispatch", `E-Way Bill not required: ${reason} (by ${req.user!.email})`);
        advanceWorkflow(req, {
          workflowType: "dispatch",
          stage: "confirm_dispatch",
          docType: "dispatch",
          docId: dispatch.id,
          docNumber: dispatch.dispatchNumber,
          counterparty: dispatch.customerName,
          docStatus: "ready_for_dispatch",
          ownerRole: "operations",
          requiredAction: "Confirm Physical Dispatch",
          nextAction: "Debit inventory",
          amount: (dispatch as any).invoicedValue ?? null,
        }, { timelineKind: "system", docType: "dispatch", appPath: "/app/warehouse" });
        return res.json(updated);
      }
      const ewbNumber = String(body.ewbNumber ?? "").trim();
      if (!/^\d{8,16}$/.test(ewbNumber))
        return res.status(400).json({ error: "Enter the numeric E-Way Bill number from Tally" });
      const updated = await GoodsDispatch.update(dispatch.id, {
        ewayBillNumber: ewbNumber,
        ewayBillStatus: "generated",
        ewayBillGeneratedAt: body.generatedAt || db.nowISO(),
        ewayBillValidUntil: body.validUntil || null,
        status: "ready_for_dispatch" as any,
      });
      // Mirror onto the linked invoice (spec: saved against both).
      if (dispatch.finalInvoiceId) {
        try {
          await Invoice.update(dispatch.finalInvoiceId, {
            ewbNumber,
            ewbGeneratedAt: body.generatedAt || db.nowISO(),
            ewbValidUntil: body.validUntil || null,
            transporter: dispatch.transporterName,
            vehicleNumber: (dispatch as any).vehicleNumber ?? null,
            lrRef: (dispatch as any).transportDocNumber ?? null,
          } as any);
        } catch (e) { console.error("  ⚠ Invoice EWB mirror failed:", e); }
      }
      timelineStatus(req, { clientId: dispatch.clientId, docType: "dispatch", docId: dispatch.id, docNumber: dispatch.dispatchNumber },
        dispatch.status, "ready_for_dispatch", `E-Way Bill ${ewbNumber} recorded — ready for physical dispatch`);
      advanceWorkflow(req, {
        workflowType: "dispatch",
        stage: "confirm_dispatch",
        docType: "dispatch",
        docId: dispatch.id,
        docNumber: dispatch.dispatchNumber,
        counterparty: dispatch.customerName,
        docStatus: "ready_for_dispatch",
        ownerRole: "operations",
        requiredAction: "Confirm Physical Dispatch",
        nextAction: "Debit inventory",
        amount: (dispatch as any).invoicedValue ?? null,
      }, { timelineKind: "system", docType: "dispatch", appPath: "/app/warehouse" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

/** PUT /goods-dispatches/:id — edit a DRAFT only (no stock impact). */
/** POST /goods-dispatches/:id/shipping-status — move the logistics pipeline
 *  forward (awaiting_pick → picking → packed → dispatched → in_transit →
 *  delivered). Pure shipping metadata: stock is NEVER touched here. Carrier
 *  and tracking can be set/edited at any pipeline stage. */
router.post(
  "/goods-dispatches/:id/shipping-status",
  authMiddleware,
  async (req, res) => {
    try {
      const dispatch = await GoodsDispatch.get(req.params.id);
      if (!dispatch)
        return res.status(404).json({ error: "Dispatch note not found" });
      if (dispatch.status === "cancelled")
        return res
          .status(400)
          .json({ error: "Cannot move a cancelled dispatch through the pipeline" });
      if (dispatch.status === "returned")
        return res
          .status(400)
          .json({ error: "A returned dispatch has already closed the pipeline" });
      if (dispatch.status === "draft")
        return res.status(400).json({
          error: "Confirm the dispatch note first — the pipeline starts on confirmed dispatches",
        });
      const to = String(req.body?.status || "");
      if (to === "delivered") {
        // Delegate to the existing deliver flow (validates quantities, records
        // delivery date/user, derives partially/fully delivered status).
        const deliveredLines = (dispatch.lines ?? [])
          .filter((l) => (l.dispatchedQty ?? 0) > (l.deliveredQty ?? 0))
          .map((l) => ({
            productId: l.productId,
            deliveredQty: (l.dispatchedQty ?? 0) - (l.deliveredQty ?? 0),
          }));
        if (deliveredLines.length === 0)
          return res.status(400).json({ error: "Dispatch is already fully delivered" });
        const updated = await GoodsDispatch.markDelivered(
          dispatch.id,
          deliveredLines,
          req.body?.deliveryDate || null,
          req.user!.email,
        );
        await GoodsDispatch.update(dispatch.id, {
          shippingStatus: "delivered",
          shippingStatusAt: new Date().toISOString(),
          shippingStatusBy: req.user!.email,
          ...(req.body?.notes !== undefined
            ? { shippingNotes: String(req.body.notes || "") || null }
            : {}),
          ...(req.body?.carrier !== undefined ? { transporterName: req.body.carrier || null } : {}),
          ...(req.body?.trackingNumber !== undefined
            ? { trackingNumber: req.body.trackingNumber || null }
            : {}),
        });
        trackAction(req, "dispatch.shipping_status", dispatch.id, {
          entityType: "dispatch",
          entityRef: dispatch.dispatchNumber,
          shippingStatus: "delivered",
        });
        return res.json({ ...updated, shippingStatus: "delivered" });
      }
      if (!GoodsDispatch.SHIPPING_STATUSES.includes(to as any))
        return res.status(400).json({
          error: `status must be one of ${GoodsDispatch.SHIPPING_STATUSES.join(", ")} (or use the delivered flow)`,
        });
      const current =
        dispatch.shippingStatus ?? "awaiting_pick";
      if (to === current) {
        // Metadata-only update: carrier / tracking / notes can be saved without
        // moving the pipeline (PUT /goods-dispatches only edits drafts).
        const hasMeta =
          req.body?.carrier !== undefined ||
          req.body?.trackingNumber !== undefined ||
          req.body?.notes !== undefined;
        if (!hasMeta)
          return res.status(400).json({ error: `Dispatch is already "${current}"` });
        const metaPatch: Record<string, any> = {};
        if (req.body?.carrier !== undefined)
          metaPatch.transporterName = req.body.carrier || null;
        if (req.body?.trackingNumber !== undefined)
          metaPatch.trackingNumber = req.body.trackingNumber || null;
        if (req.body?.notes !== undefined)
          metaPatch.shippingNotes = String(req.body.notes || "") || null;
        const metaUpdated = await GoodsDispatch.update(dispatch.id, metaPatch);
        return res.json(metaUpdated);
      }
      if (!GoodsDispatch.isValidShippingTransition(current, to as any))
        return res.status(400).json({
          error: `Invalid transition: ${current} → ${to} (forward only — a dispatch can never move backwards)`,
        });
      const patch: Record<string, any> = {
        shippingStatus: to,
        shippingStatusAt: new Date().toISOString(),
        shippingStatusBy: req.user!.email,
      };
      if (req.body?.notes !== undefined)
        patch.shippingNotes = String(req.body.notes || "") || null;
      if (req.body?.carrier !== undefined)
        patch.transporterName = req.body.carrier || null;
      if (req.body?.trackingNumber !== undefined)
        patch.trackingNumber = req.body.trackingNumber || null;
      const updated = await GoodsDispatch.update(dispatch.id, patch);
      trackAction(req, "dispatch.shipping_status", dispatch.id, {
        entityType: "dispatch",
        entityRef: dispatch.dispatchNumber,
        shippingStatus: to,
        previous: current,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

router.put("/goods-dispatches/:id", authMiddleware, async (req, res) => {
  try {
    const dispatch = await GoodsDispatch.get(req.params.id);
    if (!dispatch)
      return res.status(404).json({ error: "Dispatch note not found" });
    if (dispatch.status !== "draft")
      return res
        .status(400)
        .json({
          error:
            "Only draft dispatch notes can be edited — confirm or cancel first",
        });
    const body = req.body || {};
    const so = await GoodsSO.get(dispatch.goodsSalesOrderId);
    if (!so) return res.status(404).json({ error: "Sales order not found" });
    let lines = dispatch.lines;
    if (body.lines !== undefined) {
      try {
        lines = validateDispatchLines(so, body.lines, false);
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }
    }
    // Packing + transport fields (PDF-1) may be saved on the draft alongside
    // the base fields — they are validated strictly at submit-to-finance.
    const PACKING_FIELDS = [
      "cartonCount", "packageType", "grossWeight", "grossWeightUnit",
      "handlingInstructions", "internalDispatchNotes", "plannedDispatchAt",
      "transportMode", "transporterName", "transporterId", "distanceKm",
      "vehicleNumber", "vehicleType", "transportDocType", "transportDocNumber",
      "transportDocDate", "driverName", "driverMobile",
      "deliveryCity", "deliveryState", "deliveryPincode",
    ] as const;
    const packing: Record<string, any> = {};
    for (const k of PACKING_FIELDS) {
      if (body[k] !== undefined) packing[k] = body[k];
    }
    const updated = await GoodsDispatch.update(dispatch.id, {
      dispatchDate: body.dispatchDate ?? dispatch.dispatchDate,
      warehouse: body.warehouse ?? dispatch.warehouse,
      notes: body.notes ?? dispatch.notes,
      documents: body.documents ?? dispatch.documents,
      lines,
      ...packing,
    });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /goods-dispatches/:id — delete a DRAFT only. Confirmed dispatches must be cancelled first. */
router.delete("/goods-dispatches/:id", authMiddleware, async (req, res) => {
  try {
    const dispatch = await GoodsDispatch.get(req.params.id);
    if (!dispatch)
      return res.status(404).json({ error: "Dispatch note not found" });
    if (dispatch.status !== "draft") {
      return res
        .status(400)
        .json({
          error:
            "Only draft dispatch notes can be deleted — cancel confirmed dispatches instead",
        });
    }
    await GoodsDispatch.remove(dispatch.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/goods-dispatches/:id", authMiddleware, async (req, res) => {
  try {
    const item = await GoodsDispatch.get(req.params.id);
    if (!item)
      return res.status(404).json({ error: "Dispatch note not found" });
    res.json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /goods-dispatches/:id/deliver — record per-line delivered qty + delivery date. No stock impact. */
router.post(
  "/goods-dispatches/:id/deliver",
  authMiddleware,
  async (req, res) => {
    try {
      const dispatch = await GoodsDispatch.get(req.params.id);
      if (!dispatch)
        return res.status(404).json({ error: "Dispatch note not found" });
      if (["draft", "cancelled", "returned"].includes(dispatch.status)) {
        return res
          .status(400)
          .json({
            error: `Cannot mark a ${dispatch.status} dispatch as delivered`,
          });
      }
      if (dispatch.status === "delivered") {
        return res
          .status(400)
          .json({ error: "Dispatch is already fully delivered" });
      }
      const rawLines = Array.isArray(req.body?.lines) ? req.body.lines : [];
      if (rawLines.length === 0)
        return res
          .status(400)
          .json({ error: "Enter a delivered quantity for at least one line" });
      // Accumulate per-product delivered quantities so duplicate lines can't collectively over-deliver.
      const seen = new Map<string, number>();
      const delivered: Array<{ productId: string; deliveredQty: number }> = [];
      for (const ln of rawLines) {
        const dLine = (dispatch.lines ?? []).find(
          (l: any) => l.productId === ln.productId,
        );
        if (!dLine)
          return res
            .status(400)
            .json({
              error:
                "A delivery line references a product that is not on this dispatch",
            });
        const qty = Number(ln.deliveredQty);
        if (!Number.isFinite(qty) || qty <= 0)
          return res
            .status(400)
            .json({
              error: `Delivered quantity must be greater than zero for ${dLine.name}`,
            });
        const already = seen.get(dLine.productId) ?? 0;
        const remaining = dLine.dispatchedQty - (dLine.deliveredQty ?? 0);
        if (qty > remaining - already) {
          return res
            .status(400)
            .json({
              error: `Delivered quantity for ${dLine.name} exceeds the ${Math.max(0, remaining - already)} not yet delivered`,
            });
        }
        seen.set(dLine.productId, already + qty);
        delivered.push({ productId: dLine.productId, deliveredQty: qty });
      }
      const updated = await GoodsDispatch.markDelivered(
        dispatch.id,
        delivered,
        req.body.deliveryDate || null,
        req.user!.email,
      );
      trackAction(req, "dispatch.delivered", dispatch.id, {
        entityType: "dispatch",
        entityRef: dispatch.dispatchNumber,
        deliveredQty: delivered.reduce((sum, d) => sum + d.deliveredQty, 0),
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

/** POST /goods-dispatches/:id/return — record per-line returns, credit stock back, revoke SO dispatched qty. */
router.post(
  "/goods-dispatches/:id/return",
  authMiddleware,
  async (req, res) => {
    try {
      const clientId = req.user!.userId;
      const dispatch = await GoodsDispatch.get(req.params.id);
      if (!dispatch)
        return res.status(404).json({ error: "Dispatch note not found" });
      if (["draft", "cancelled", "returned"].includes(dispatch.status)) {
        return res
          .status(400)
          .json({
            error: `Cannot record a return on a ${dispatch.status} dispatch`,
          });
      }
      const rawLines = Array.isArray(req.body?.lines) ? req.body.lines : [];
      const returned: Array<{ productId: string; returnedQty: number }> = [];
      const seen = new Map<string, number>();
      // No lines → return everything not yet returned (full return).
      if (rawLines.length === 0) {
        for (const dLine of dispatch.lines ?? []) {
          const remaining = dLine.dispatchedQty - (dLine.returnedQty ?? 0);
          if (remaining > 0)
            returned.push({
              productId: dLine.productId,
              returnedQty: remaining,
            });
        }
      } else {
        for (const ln of rawLines) {
          const dLine = (dispatch.lines ?? []).find(
            (l: any) => l.productId === ln.productId,
          );
          if (!dLine)
            return res
              .status(400)
              .json({
                error:
                  "A return line references a product that is not on this dispatch",
              });
          const qty = Number(ln.returnedQty);
          if (!Number.isFinite(qty) || qty <= 0)
            return res
              .status(400)
              .json({
                error: `Returned quantity must be greater than zero for ${dLine.name}`,
              });
          const already = seen.get(dLine.productId) ?? 0;
          const remaining = dLine.dispatchedQty - (dLine.returnedQty ?? 0);
          if (qty > remaining - already) {
            return res
              .status(400)
              .json({
                error: `Returned quantity for ${dLine.name} exceeds the ${Math.max(0, remaining - already)} not yet returned`,
              });
          }
          seen.set(dLine.productId, already + qty);
          returned.push({ productId: dLine.productId, returnedQty: qty });
        }
      }
      if (returned.length === 0)
        return res
          .status(400)
          .json({
            error: "Nothing to return — all quantities already returned",
          });
      const so = await GoodsSO.get(dispatch.goodsSalesOrderId);
      // Credit the returned quantity back into stock (system-created reversal).
      for (const r of returned) {
        const dLine = (dispatch.lines ?? []).find(
          (l: any) => l.productId === r.productId,
        );
        if (!dLine) continue;
        let unitCost = dLine.unitPrice;
        try {
          const prod = await Product.get(dLine.productId);
          if (prod && prod.unitCost != null) unitCost = prod.unitCost;
        } catch {
          /* keep the dispatch snapshot */
        }
        await StockMovement.create({
          clientId,
          productId: dLine.productId,
          direction: "in",
          itemName: dLine.name,
          sku: dLine.sku,
          quantity: r.returnedQty,
          unit: dLine.unit || "unit",
          unitCost,
          warehouse: dispatch.warehouse || null,
          reason: "Customer return",
          linkedDocumentType: "Dispatch",
          linkedDocumentNumber: dispatch.dispatchNumber,
          status: "confirmed",
          notes: `Dispatch ${dispatch.dispatchNumber} returned — stock-in`,
          movementDate: db.todayDate(),
          goodsDispatchId: dispatch.id,
          salesOrderId: dispatch.goodsSalesOrderId,
          createdById: req.user!.userId,
          createdByName: req.user!.email,
          confirmedById: req.user!.userId,
          confirmedByName: req.user!.email,
          confirmedAt: db.nowISO(),
        });
      }
      const updated = await GoodsDispatch.recordReturned(
        dispatch.id,
        returned,
        req.user!.email,
      );
      trackAction(req, "dispatch.returned", dispatch.id, {
        entityType: "dispatch",
        entityRef: dispatch.dispatchNumber,
        returnedQty: returned.reduce((sum, r) => sum + r.returnedQty, 0),
      });
      if (so) {
        await GoodsSO.revokeDispatch(
          so.id,
          returned.map((r) => ({
            productId: r.productId,
            dispatchedQty: r.returnedQty,
          })),
        );
      }
      recomputeForecast(clientId);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ===================== EXPENSES =====================
router.get("/expenses", authMiddleware, async (req, res) => {
  try {
    // ?scope=all returns every client's expenses — used by the shared dashboard.
    // Platform staff (non-client roles) also read across the whole portfolio.
    const scopeAll = req.query.scope === "all";
    res.json(await Expense.list(scopeAll ? undefined : effectiveListScope(req)));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.post("/expenses", authMiddleware, async (req, res) => {
  try {
    const item = await Expense.create({
      ...req.body,
      clientId: req.user!.userId,
    });
    trackAction(req, "expense.created", item.id, {
      entityType: "expense",
      entityRef: item.expenseRef,
      category: item.category,
      amount: item.amount,
    });
    res.status(201).json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.put("/expenses/:id", authMiddleware, async (req, res) => {
  try {
    res.json(await Expense.update(req.params.id, req.body));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.delete("/expenses/:id", authMiddleware, async (req, res) => {
  try {
    await Expense.remove(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== ADVANCES =====================
router.get("/advances", authMiddleware, async (req, res) => {
  try {
    res.json(await Advance.list(effectiveListScope(req)));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.post("/advances", authMiddleware, async (req, res) => {
  try {
    res
      .status(201)
      .json(await Advance.create({ ...req.body, clientId: req.user!.userId }));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.put("/advances/:id", authMiddleware, async (req, res) => {
  try {
    res.json(await Advance.update(req.params.id, req.body));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.delete("/advances/:id", authMiddleware, async (req, res) => {
  try {
    await Advance.remove(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== AUDIT / ACTIVITY FEED =====================
/**
 * GET /audit/activity — admin-only workflow audit trail (newest first).
 * Actor display names are resolved live from the User table (contactName
 * preferred, email fallback). System/security noise is filtered out.
 */
router.get(
  "/audit/activity",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
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
          actorName: u
            ? u.contactName || u.email || e.actorEmail
            : e.actorEmail,
          actorRoles: u
            ? (u.roles ?? [])
            : ((e.detail?.actorRoles as string[]) ?? []),
        };
      });
      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ===================== ALERTS =====================
router.get("/alerts", authMiddleware, async (req, res) => {
  try {
    res.json(await Alert.list());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.put("/alerts/:id/read", authMiddleware, async (req, res) => {
  try {
    res.json(await Alert.markRead(req.params.id));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.post(
  "/alerts/generate",
  authMiddleware,
  requireAdmin,
  auditAdminAction,
  async (req, res) => {
    try {
      const invoices = await Invoice.list();
      const alerts: Array<{ message: string; type: string }> = [];
      for (const inv of invoices) {
        if (!inv.dueDate) continue;
        const dpd = Math.max(
          0,
          Math.floor((Date.now() - new Date(inv.dueDate).getTime()) / 86400000),
        );
        if (dpd > 0 && inv.status !== "paid" && inv.status !== "rejected") {
          alerts.push({
            message: `Invoice ${inv.invoiceNumber} overdue ${dpd} days — $${inv.amount}`,
            type: "overdue",
          });
        }
      }
      for (const a of alerts) await Alert.create(a);
      res.json({ generated: alerts.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ===================== CHART OF ACCOUNTS =====================
router.get("/chart-of-accounts", authMiddleware, async (req, res) => {
  try {
    res.json(await CoA.list(effectiveListScope(req)));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.post("/chart-of-accounts", authMiddleware, async (req, res) => {
  try {
    res
      .status(201)
      .json(await CoA.create({ ...req.body, clientId: req.user!.userId }));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.put("/chart-of-accounts/:id", authMiddleware, async (req, res) => {
  try {
    res.json(await CoA.update(req.params.id, req.body));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.delete("/chart-of-accounts/:id", authMiddleware, async (req, res) => {
  try {
    const item = await CoA.get(req.params.id);
    await CoA.remove(req.params.id, item?.isSystem);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.post("/chart-of-accounts/seed", authMiddleware, async (req, res) => {
  try {
    await CoA.seedDefault(req.user!.userId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== JOURNALS =====================
router.get("/journals", authMiddleware, async (req, res) => {
  try {
    res.json(await Journal.listJournals(effectiveListScope(req)));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.get("/journals/:id", authMiddleware, async (req, res) => {
  try {
    const journal = await Journal.getJournal(req.params.id);
    if (!journal) return res.status(404).json({ error: "Not found" });
    const lines = await Journal.getLinesByJournal(req.params.id);
    res.json({ ...journal, lines });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.post("/journals", authMiddleware, async (req, res) => {
  try {
    const { lines, ...journalData } = req.body;
    const journal = await Journal.createJournal({
      ...journalData,
      clientId: req.user!.userId,
    });
    if (lines?.length) {
      await Journal.createLines(
        lines.map((l: any, i: number) => ({
          ...l,
          journalId: journal.id,
          lineNo: i + 1,
        })),
      );
    }
    res.status(201).json(journal);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.delete("/journals/:id", authMiddleware, async (req, res) => {
  try {
    const journal = await Journal.getJournal(req.params.id);
    await Journal.deleteJournal(req.params.id, journal?.source);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== ACCOUNT TRANSACTIONS =====================
router.get(
  "/account-transactions/:accountId",
  authMiddleware,
  async (req, res) => {
    try {
      const { lines, journals } = await Journal.getAccountTransactions(
        req.params.accountId,
      );
      res.json({ lines, journals });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ===================== CREDIT/DEBIT NOTES =====================
router.get("/credit-debit-notes", authMiddleware, async (req, res) => {
  try {
    res.json(await CDNote.list(effectiveListScope(req)));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.post("/credit-debit-notes", authMiddleware, async (req, res) => {
  try {
    res
      .status(201)
      .json(await CDNote.create({ ...req.body, clientId: req.user!.userId }));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.put("/credit-debit-notes/:id", authMiddleware, async (req, res) => {
  try {
    res.json(await CDNote.update(req.params.id, req.body));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.delete("/credit-debit-notes/:id", authMiddleware, async (req, res) => {
  try {
    await CDNote.remove(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== MANUAL BALANCE ENTRIES =====================
router.get("/balance-entries", authMiddleware, async (req, res) => {
  try {
    res.json(await Combined.listManualEntries(effectiveListScope(req)));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.post("/balance-entries", authMiddleware, async (req, res) => {
  try {
    res
      .status(201)
      .json(
        await Combined.createManualEntry({
          ...req.body,
          clientId: req.user!.userId,
        }),
      );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.put("/balance-entries/:id", authMiddleware, async (req, res) => {
  try {
    res.json(await Combined.updateManualEntry(req.params.id, req.body));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.delete("/balance-entries/:id", authMiddleware, async (req, res) => {
  try {
    await Combined.deleteManualEntry(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== INVOICE TEMPLATES =====================
router.get("/invoice-templates", authMiddleware, async (req, res) => {
  try {
    const template = await Combined.getTemplate(req.user!.userId);
    res.json(template);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.put("/invoice-templates", authMiddleware, async (req, res) => {
  try {
    res.json(
      await Combined.upsertTemplate({
        ...req.body,
        clientId: req.user!.userId,
      }),
    );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== LEADS (CRM) =====================
router.get("/crm/leads", authMiddleware, async (req, res) => {
  try {
    res.json(await Combined.listLeads(effectiveListScope(req)));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.post("/crm/leads", authMiddleware, async (req, res) => {
  try {
    res
      .status(201)
      .json(
        await Combined.createLead({ ...req.body, clientId: req.user!.userId }),
      );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.put("/crm/leads/:id", authMiddleware, async (req, res) => {
  try {
    res.json(await Combined.updateLead(req.params.id, req.body));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.delete("/crm/leads/:id", authMiddleware, async (req, res) => {
  try {
    await Combined.deleteLead(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== OPPORTUNITIES (CRM) =====================
router.get("/crm/opportunities", authMiddleware, async (req, res) => {
  try {
    res.json(await Combined.listOpportunities(effectiveListScope(req)));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.post("/crm/opportunities", authMiddleware, async (req, res) => {
  try {
    res
      .status(201)
      .json(
        await Combined.createOpportunity({
          ...req.body,
          clientId: req.user!.userId,
        }),
      );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.put("/crm/opportunities/:id", authMiddleware, async (req, res) => {
  try {
    res.json(await Combined.updateOpportunity(req.params.id, req.body));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.delete("/crm/opportunities/:id", authMiddleware, async (req, res) => {
  try {
    await Combined.deleteOpportunity(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== CRM ACTIVITIES =====================
router.get("/crm/activities", authMiddleware, async (req, res) => {
  try {
    res.json(await Combined.listActivities(effectiveListScope(req)));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.post("/crm/activities", authMiddleware, async (req, res) => {
  try {
    res
      .status(201)
      .json(
        await Combined.createActivity({
          ...req.body,
          clientId: req.user!.userId,
        }),
      );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.put("/crm/activities/:id", authMiddleware, async (req, res) => {
  try {
    res.json(await Combined.updateActivity(req.params.id, req.body));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.delete("/crm/activities/:id", authMiddleware, async (req, res) => {
  try {
    await Combined.deleteActivity(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== REMINDER LOGS & MANUAL REMINDERS =====================
router.get("/reminder-logs", authMiddleware, async (req, res) => {
  try {
    const { list } = await import("../models/reminder-log.js");
    const logs = await list();
    // Sort newest first
    logs.sort((a, b) => b.sentAt.localeCompare(a.sentAt));
    res.json(logs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Manually send a reminder for a specific sales invoice
router.post(
  "/invoices/:id/send-reminder",
  authMiddleware,
  requireAdmin,
  auditAdminAction,
  async (req, res) => {
    try {
      const { sendReminderForInvoice } = await import("../invoice-reminder.js");
      const result = await sendReminderForInvoice(req.params.id, "sales");
      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// Manually send a reminder for a specific purchase invoice
router.post(
  "/purchase-invoices/:id/send-reminder",
  authMiddleware,
  requireAdmin,
  auditAdminAction,
  async (req, res) => {
    try {
      const { sendReminderForInvoice } = await import("../invoice-reminder.js");
      const result = await sendReminderForInvoice(req.params.id, "purchase");
      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// Manually trigger the full reminder scheduler
router.post(
  "/reminders/run",
  authMiddleware,
  requireAdmin,
  auditAdminAction,
  async (req, res) => {
    try {
      const { runDueDateReminders } = await import("../invoice-reminder.js");
      const result = await runDueDateReminders();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ===================== REMINDER SETTINGS (any admin) =====================
// Read the current automatic-reminder configuration.
router.get("/reminder-settings", authMiddleware, requireAdmin, async (req, res) => {
  try {
    res.json(await ReminderSettings.get());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update automatic reminders: enabled on/off + the due-date schedule (e.g.
// mail when due in 1 / 2 / 7 / 15 / 30 days or on the due date itself).
router.put(
  "/reminder-settings",
  authMiddleware,
  requireAdmin,
  auditAdminAction,
  async (req, res) => {
    try {
      const body = req.body || {};
      if (body.enabled === undefined && body.scheduleDays === undefined) {
        return res
          .status(400)
          .json({ error: "Nothing to update — send enabled and/or scheduleDays" });
      }
      const updated = await ReminderSettings.update({
        enabled: body.enabled,
        scheduleDays: body.scheduleDays,
        updatedBy: req.user?.email ?? null,
      });
      res.json(updated);
    } catch (err: any) {
      const msg = err?.message || "Failed to update reminder settings";
      return res.status(400).json({ error: msg });
    }
  },
);

// ===================== FORECAST (reuses engine) =====================
router.get("/forecast", authMiddleware, async (req, res) => {
  try {
    const products = await Product.list(effectiveListScope(req));
    const movements = await StockMovement.list(effectiveListScope(req));
    res.json({ products, movements });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== FORECAST VARIABLES (persisted snapshots) =====================
/**
 * GET /forecast-variables — returns persisted forecast snapshots for all active products.
 * Auto-triggers a daily recompute if today's forecast hasn't been computed yet.
 */
router.get("/forecast-variables", authMiddleware, async (req, res) => {
  try {
    // Platform staff read the whole portfolio's snapshots; the daily freshness
    // recompute stays scoped to a single client (staff have none of their own).
    const clientId = effectiveListScope(req);
    const { ensureFresh, recomputeAll } =
      await import("../services/forecast-service.js");

    // Automatically recompute if stale (daily freshness check)
    const wasRecomputed = clientId ? await ensureFresh(clientId) : false;

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
    const productMap = new Map(
      products
        .filter((p: any) => p.status === "active")
        .map((p: any) => [p.id, p]),
    );

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
router.post(
  "/forecast-variables/recompute",
  authMiddleware,
  async (req, res) => {
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
  },
);

// ===================== DASHBOARD =====================
router.get("/dashboard", authMiddleware, async (req, res) => {
  try {
    const invoices = await Invoice.list(effectiveListScope(req));
    const advances = await Advance.list(effectiveListScope(req));
    const debtors = await Debtor.list();
    const products = await Product.list(effectiveListScope(req));
    const movements = await StockMovement.list(effectiveListScope(req));

    // Calculate summary
    const pendingInvoices = invoices.filter((i) => i.status === "pending");
    const approvedInvoices = invoices.filter((i) => i.status === "approved");
    const overdueInvoices = invoices.filter((i) => i.status === "overdue");
    const totalSalesAdvance = advances
      .filter((a) => a.side === "sales" && a.status !== "refunded")
      .reduce((s, a) => s + a.amount, 0);
    const totalPurchaseAdvance = advances
      .filter((a) => a.side === "purchase" && a.status !== "refunded")
      .reduce((s, a) => s + a.amount, 0);
    const inventoryValue = movements
      .filter((m) => m.direction === "in")
      .reduce((s, m) => s + m.quantity * (m.unitCost || 0), 0);

    res.json({
      pendingInvoices: pendingInvoices.length,
      approvedInvoices: approvedInvoices.length,
      overdueInvoices: overdueInvoices.length,
      totalSalesAdvance,
      totalPurchaseAdvance,
      inventoryValue,
      invoices,
      advances,
      debtors,
      products,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== SUBMISSIONS (Visits, Travel, Expenses, Leave) =====================
router.post("/submissions", authMiddleware, (req, res) =>
  Submission.create(req, res),
);
router.get("/submissions", authMiddleware, (req, res) =>
  Submission.list(req, res),
);
router.put("/submissions/:id", authMiddleware, (req, res) =>
  Submission.update(req, res),
);
router.delete("/submissions/:id", authMiddleware, (req, res) =>
  Submission.remove(req, res),
);

// Reporting Manager: team requests
router.get("/requests", authMiddleware, (req, res) =>
  Submission.listTeamRequests(req, res),
);
router.put("/requests/:id/status", authMiddleware, (req, res) =>
  Submission.updateRequestStatus(req, res),
);

// ===================== NOA (Notification of Assignment) =====================
router.get("/noa/:token", publicTokenLimiter, async (req, res) => {
  try {
    const invoice = await Invoice.getByNOAToken(req.params.token);
    if (!invoice) return res.status(404).json({ error: "Not found" });
    const debtor = await Debtor.get(invoice.debtorId);
    // The assignor's company name — the NOA page shows who is assigning the invoice.
    const company = await resolveCompanyName(invoice.clientId);
    res.json({ invoice, debtor, clientCompany: company.name });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/noa/:token/respond", publicTokenLimiter, async (req, res) => {
  try {
    const { decision, comments } = req.body || {};
    if (
      typeof decision !== "string" ||
      !decision.trim() ||
      decision.length > 30
    ) {
      return res.status(400).json({ error: "A valid decision is required" });
    }
    if (
      comments !== undefined &&
      (typeof comments !== "string" || comments.length > 2000)
    ) {
      return res.status(400).json({ error: "Comments are too long" });
    }
    const invoice = await Invoice.getByNOAToken(req.params.token);
    if (!invoice) return res.status(404).json({ error: "Not found" });
    const updates: any = {
      noaStatus: decision,
      noaRespondedAt: new Date().toISOString(),
    };
    if (comments) updates.noaComments = comments;
    await Invoice.update(invoice.id, updates);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
router.post(
  "/upload",
  authMiddleware,
  upload.single("file"),
  async (req, res) => {
    try {
      const file = req.file;
      if (!file) {
        return res
          .status(400)
          .json({ error: "No file provided (multipart field name: file)" });
      }
      const { path, scope } = (req.body || {}) as {
        path?: string;
        scope?: string;
      };
      // 1) Magic-byte validation — the content type is derived from the file
      //    contents, never trusted from the client. This blocks HTML/SVG uploads
      //    (stored XSS served from the S3 origin) and executable files, while
      //    allowing images, PDFs, office docs (docx/xlsx/…) and plain text.
      const detected = detectFileType(file.buffer);
      if (!detected) {
        return res
          .status(415)
          .json({
            error:
              "Unsupported file type. Allowed: JPEG, PNG, WebP, GIF, PDF, office documents and text files.",
          });
      }
      // 2) Keep the client-supplied path (sanitized) — the frontend stores this
      //    exact key locally and uses it to open/delete the object. Only the
      //    S3 Content-Type comes from the detected file contents.
      const safePath = sanitizeS3Key(
        path ||
          `${req.user!.userId}/${scope || "misc"}/${Date.now()}-${uuid().slice(0, 8)}.bin`,
      );
      // Every key must live under the requester's own folder.
      if (!safePath.startsWith(`${req.user!.userId}/`)) {
        return res
          .status(403)
          .json({ error: "Upload key must be scoped to your account" });
      }
      const { uploadFile } = await import("../s3.js");
      const result = await uploadFile(safePath, file.buffer, detected.mime);
      res
        .status(201)
        .json({
          path: safePath,
          url: result.url,
          name: file.originalname,
          size: file.size,
          type: detected.mime,
        });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

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
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
      isOperations || isChecker || isTreasury
        ? Invoice.list(userId)
        : Promise.resolve([]),
      isOperations ? PurchaseInvoice.list(userId) : Promise.resolve([]),
      isOperations ? PurchaseOrder.list(userId) : Promise.resolve([]),
      Expense.list(userId),
      Advance.list(userId),
      db
        .scanByType("Submission")
        .then((items: any[]) => items.filter((s: any) => s.userId === userId)),
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
        leads: {
          total: leads.length,
          byStatus: leadsByStatus,
          totalEstimatedValue: leads.reduce(
            (s: number, l: any) => s + (l.estimatedValue || 0),
            0,
          ),
        },
        opportunities: {
          total: opportunities.length,
          byStage: oppsByStage,
          totalAmount: totalOppAmount,
        },
        activities: {
          total: activities.length,
          recent: activities.slice(-5).reverse(),
        },
        invoices: {
          total: invoices.length,
          byStatus: invoicesByStatus,
          totalAmount: totalInvoiceAmount,
        },
        purchaseInvoices: {
          total: purchaseInvoices.length,
          byStatus: poByStatus,
        },
        purchaseOrders: { total: purchaseOrders.length },
        expenses: {
          total: expenses.length,
          totalAmount: expenses.reduce(
            (s: number, e: any) => s + (e.amount || 0),
            0,
          ),
        },
        advances: {
          total: advances.length,
          totalAmount: advances.reduce(
            (s: number, a: any) => s + (a.amount || 0),
            0,
          ),
        },
        submissions: {
          total: allSubmissions.length,
          byType: subsByType,
          byStatus: subsByStatus,
        },
      },
    };

    res.json(progress);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== CASH FLOW & TREASURY =====================
import cashFlowRoutes from "./cash-flow.js";
router.use(cashFlowRoutes);

// ===================== E-WAY BILL =====================
import ewayBillRoutes from "./eway-bill.js";
router.use(ewayBillRoutes);

// ===================== REPORTS MODULE =====================
// 12 report endpoints backing the Reports dashboard and report detail pages.
import reportsRoutes from "./reports.js";
router.use(reportsRoutes);

// ===================== BULK PAYMENTS =====================
// FIFO / two-pass FIFO / manual allocation across open invoices (AR + AP).
import bulkPaymentsRoutes from "./bulk-payments.js";
router.use(bulkPaymentsRoutes);

// ===================== STOCK LOCATIONS =====================
router.get("/stock-locations", authMiddleware, async (req, res) => {
  try {
    const items = await StockLocation.list(effectiveListScope(req));
    res.json(items);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.get("/stock-locations/:id", authMiddleware, async (req, res) => {
  try {
    const item = await StockLocation.get(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });
    res.json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.post("/stock-locations", authMiddleware, async (req, res) => {
  try {
    const item = await StockLocation.create({
      ...req.body,
      clientId: req.user!.userId,
    });
    res.status(201).json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.put("/stock-locations/:id", authMiddleware, async (req, res) => {
  try {
    const item = await StockLocation.update(req.params.id, req.body);
    res.json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.delete("/stock-locations/:id", authMiddleware, async (req, res) => {
  try {
    await StockLocation.remove(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== LOCATION STOCK SUMMARY =====================
/**
 * GET /stock-summary — returns location-wise stock breakdown and total company
 * stock for every active product.
 * Query params: ?productId=xxx (optional, single product)
 */
router.get("/stock-summary", authMiddleware, async (req, res) => {
  try {
    const clientId = effectiveListScope(req);
    const productId = req.query.productId as string | undefined;
    const [movements, locations, products] = await Promise.all([
      StockMovement.list(clientId),
      StockLocation.list(clientId),
      Product.list(clientId),
    ]);
    const confirmed = movements.filter((m: any) => m.status === "confirmed");
    const activeProducts = products.filter((p: any) => p.status === "active");

    const result: any[] = [];
    for (const p of productId ? activeProducts.filter((p: any) => p.id === productId) : activeProducts) {
      const pMovements = confirmed.filter((m: any) => m.productId === p.id);
      const locationBreakdown: any[] = [];
      let totalCompanyStock = 0;

      for (const loc of locations) {
        let qty = 0;
        for (const m of pMovements) {
          if (m.direction === "in" && m.destinationLocationId === loc.id) {
            qty += Number(m.quantity);
          } else if (m.direction === "out" && m.sourceLocationId === loc.id) {
            qty -= Number(m.quantity);
          }
        }
        locationBreakdown.push({ locationId: loc.id, locationName: loc.name, locationType: loc.locationType, quantity: qty });
        totalCompanyStock += qty;
      }
      // Also count movements without a location (legacy)
      let legacyStock = 0;
      for (const m of pMovements) {
        if (!m.sourceLocationId && !m.destinationLocationId) {
          legacyStock += m.direction === "in" ? Number(m.quantity) : -Number(m.quantity);
        }
      }
      if (legacyStock !== 0) {
        locationBreakdown.unshift({ locationId: "_legacy", locationName: "Unallocated (Legacy)", locationType: "other_warehouse", quantity: legacyStock });
        totalCompanyStock += legacyStock;
      }

      result.push({
        productId: p.id,
        sku: p.sku,
        name: p.name,
        totalCompanyStock,
        locationBreakdown,
      });
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== STOCK TRANSFER =====================
/**
 * POST /stock-transfers — create a stock transfer between two locations.
 * Creates TWO stock movements (source out + destination in) linked by transferId.
 * This is NOT a sale — Total Company Stock does not change.
 */
router.post("/stock-transfers", authMiddleware, async (req, res) => {
  try {
    const clientId = req.user!.userId;
    const body = req.body || {};
    const { sourceLocationId, destinationLocationId, productId, quantity, notes, transitMode } = body;

    if (!sourceLocationId) return res.status(400).json({ error: "Source location required" });
    if (!destinationLocationId) return res.status(400).json({ error: "Destination location required" });
    if (!productId) return res.status(400).json({ error: "Product required" });
    if (!(Number(quantity) > 0)) return res.status(400).json({ error: "Quantity must be greater than zero" });
    if (sourceLocationId === destinationLocationId) return res.status(400).json({ error: "Source and destination must be different" });

    const product = await Product.get(productId);
    if (!product) return res.status(400).json({ error: "Product not found" });

    // Validate source location has sufficient stock
    const allMovements = await StockMovement.list(clientId);
    const confirmed = allMovements.filter((m: any) => m.status === "confirmed" && m.productId === productId);
    let sourceStock = 0;
    for (const m of confirmed) {
      if (m.direction === "in" && m.destinationLocationId === sourceLocationId) sourceStock += Number(m.quantity);
      else if (m.direction === "out" && m.sourceLocationId === sourceLocationId) sourceStock -= Number(m.quantity);
    }
    if (sourceStock < Number(quantity)) {
      return res.status(400).json({ error: `Insufficient stock at source location. Available: ${sourceStock}, Requested: ${quantity}` });
    }

    const transferId = uuid();
    const now = db.nowISO();
    const transferNumber = `TRF-${transferId.slice(0, 8).toUpperCase()}`;
    const sourceLoc = await StockLocation.get(sourceLocationId);
    const destLoc = await StockLocation.get(destinationLocationId);

    // If transit mode, destination is a "Transit" location
    const effectiveDestId = transitMode ? destinationLocationId : destinationLocationId;

    // Create source movement (stock out)
    const sourceMovement = await StockMovement.create({
      clientId,
      productId,
      direction: "out",
      itemName: product.name,
      sku: product.sku,
      quantity: Number(quantity),
      unit: product.unitOfMeasure || "unit",
      unitCost: product.unitCost || 0,
      warehouse: sourceLoc?.name || null,
      reason: "Stock transfer",
      linkedDocumentType: "Transfer",
      linkedDocumentNumber: transferNumber,
      status: "confirmed",
      notes: `Transfer from ${sourceLoc?.name ?? "source"} to ${destLoc?.name ?? "dest"}`,
      movementDate: body.movementDate || db.todayDate(),
      sourceLocationId,
      destinationLocationId: effectiveDestId,
      dispatchType: "stock_transfer",
      transferId,
      createdById: req.user!.userId,
      createdByName: req.user!.email,
      confirmedById: req.user!.userId,
      confirmedByName: req.user!.email,
      confirmedAt: now,
    });

    // Create destination movement (stock in) — unless it's a transit dispatch
    // (the destination will be created later when transit is received)
    let destMovement = null;
    if (!transitMode) {
      destMovement = await StockMovement.create({
        clientId,
        productId,
        direction: "in",
        itemName: product.name,
        sku: product.sku,
        quantity: Number(quantity),
        unit: product.unitOfMeasure || "unit",
        unitCost: product.unitCost || 0,
        warehouse: destLoc?.name || null,
        reason: "Stock transfer",
        linkedDocumentType: "Transfer",
        linkedDocumentNumber: transferNumber,
        status: "confirmed",
        notes: `Transfer from ${sourceLoc?.name ?? "source"} to ${destLoc?.name ?? "dest"}`,
        movementDate: body.movementDate || db.todayDate(),
        sourceLocationId: effectiveDestId,
        destinationLocationId,
        dispatchType: "stock_transfer",
        transferId,
        createdById: req.user!.userId,
        createdByName: req.user!.email,
        confirmedById: req.user!.userId,
        confirmedByName: req.user!.email,
        confirmedAt: now,
      });
    }

    res.status(201).json({
      transferId,
      transferNumber,
      sourceMovement,
      destinationMovement: destMovement,
      message: transitMode
        ? `Transfer dispatched. Stock moved from ${sourceLoc?.name} to Transit.`
        : `Transfer completed. ${product.name} moved from ${sourceLoc?.name} to ${destLoc?.name}.`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /stock-transfers/:transferId/receive — receive a transfer that is currently in transit.
 * Creates the destination stock-in movement.
 */
router.post("/stock-transfers/:transferId/receive", authMiddleware, async (req, res) => {
  try {
    const clientId = req.user!.userId;
    const { transferId } = req.params;
    const body = req.body || {};
    const { destinationLocationId, productId, quantity } = body;

    if (!destinationLocationId) return res.status(400).json({ error: "Destination location required" });

    // Find the source movement for this transfer
    const allMovements = await StockMovement.list(clientId);
    const sourceMov = allMovements.find((m) => m.transferId === transferId && m.direction === "out" && m.status === "confirmed");
    if (!sourceMov) return res.status(404).json({ error: "Transfer not found or not dispatched" });

    // Check if already received
    const alreadyReceived = allMovements.find((m) => m.transferId === transferId && m.direction === "in" && m.status === "confirmed");
    if (alreadyReceived) return res.status(400).json({ error: "This transfer has already been received" });

    const recvQty = Number(quantity) || sourceMov.quantity;
    const recvProductId = productId || sourceMov.productId;
    const product = await Product.get(recvProductId);
    if (!product) return res.status(400).json({ error: "Product not found" });

    const destLoc = await StockLocation.get(destinationLocationId);
    const now = db.nowISO();
    const transferNumber = sourceMov.linkedDocumentNumber || `TRF-${transferId.slice(0, 8).toUpperCase()}`;

    // Create destination stock-in movement
    const destMovement = await StockMovement.create({
      clientId,
      productId: recvProductId,
      direction: "in",
      itemName: product.name,
      sku: product.sku,
      quantity: recvQty,
      unit: product.unitOfMeasure || "unit",
      unitCost: product.unitCost || 0,
      warehouse: destLoc?.name || null,
      reason: "Stock transfer",
      linkedDocumentType: "Transfer",
      linkedDocumentNumber: transferNumber,
      status: "confirmed",
      notes: `Transfer received at ${destLoc?.name ?? "destination"}`,
      movementDate: db.todayDate(),
      sourceLocationId: sourceMov.destinationLocationId,
      destinationLocationId,
      dispatchType: "stock_transfer",
      transferId,
      createdById: req.user!.userId,
      createdByName: req.user!.email,
      confirmedById: req.user!.userId,
      confirmedByName: req.user!.email,
      confirmedAt: now,
    });

    res.status(201).json({
      transferId,
      destinationMovement: destMovement,
      message: `Transfer received. ${product.name} now at ${destLoc?.name ?? "destination"}.`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
