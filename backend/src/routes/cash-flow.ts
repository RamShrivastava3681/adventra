import { Router, Request, Response } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole, effectiveListScope } from "../middleware/roles.js";
import * as db from "../dynamodb.js";
import * as AuditLog from "../models/audit-log.js";
import * as CashAccount from "../models/cash-account.js";
import * as CashFlowSettings from "../models/cash-flow-settings.js";
import * as ExpectedInflow from "../models/expected-inflow.js";
import * as ExpectedOutflow from "../models/expected-outflow.js";
import * as PurchaseCommitment from "../models/purchase-commitment.js";
import * as RecurringExpense from "../models/recurring-expense.js";
import * as MarketplaceSettlement from "../models/marketplace-settlement.js";
import * as CashFlowEngine from "../services/cash-flow-engine.js";
import * as GoodsPO from "../models/goods-purchase-order.js";
import * as PurchaseInvoice from "../models/purchase-invoice.js";
import * as Invoice from "../models/invoice.js";
import * as Debtor from "../models/debtor.js";
import * as Vendor from "../models/vendor.js";

const router = Router();

// All cash-flow routes require authentication
router.use(authMiddleware);

// Role-based middleware for cash-flow specific operations
const requireCashFlowWrite = requireRole("factor_admin", "treasury");
const requireCashFlowAdmin = requireRole("factor_admin");

/** Audit helper — fire-and-forget */
function trackCashFlowAction(
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

// ===================== SETTINGS =====================

router.get("/cash-flow/settings", async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const settings = await CashFlowSettings.get(clientId);
    res.json(settings);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/cash-flow/settings", requireCashFlowAdmin, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const { minimumCashBuffer, baseCurrency } = req.body || {};
    if (minimumCashBuffer !== undefined && (Number(minimumCashBuffer) < 0 || !Number.isFinite(Number(minimumCashBuffer)))) {
      return res.status(400).json({ error: "minimumCashBuffer must be a non-negative number" });
    }
    const updates: Record<string, any> = {};
    if (minimumCashBuffer !== undefined) updates.minimumCashBuffer = Number(minimumCashBuffer);
    if (baseCurrency !== undefined) updates.baseCurrency = String(baseCurrency);
    const settings = await CashFlowSettings.update(clientId, updates);
    trackCashFlowAction(req, "cashflow.settings_updated", null, updates);
    res.json(settings);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== CASH ACCOUNTS =====================

router.get("/cash-accounts", async (req: Request, res: Response) => {
  try {
    const accounts = await CashAccount.list(effectiveListScope(req));
    res.json(accounts);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/cash-accounts/:id", async (req: Request, res: Response) => {
  try {
    const item = await CashAccount.get(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });
    res.json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/cash-accounts", requireCashFlowWrite, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const body = req.body || {};
    const accountName = body.accountName || body.name || body.account_name;
    const accountType = body.accountType || body.type || body.account_type || "BANK";
    const currentBalance = body.currentBalance ?? body.balance ?? body.current_balance ?? body.amount ?? 0;
    const restrictedBalance = body.restrictedBalance ?? body.restricted ?? body.restricted_balance ?? 0;
    const status = body.status || "active";

    if (!accountName) return res.status(400).json({ error: "accountName is required" });

    const item = await CashAccount.create({
      clientId,
      accountName: String(accountName).trim(),
      accountType,
      currentBalance: Number(currentBalance) || 0,
      restrictedBalance: Number(restrictedBalance) || 0,
      status,
    });
    trackCashFlowAction(req, "cashaccount.created", item.id, { accountName, accountType });
    res.status(201).json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/cash-accounts/:id", requireCashFlowWrite, async (req: Request, res: Response) => {
  try {
    const current = await CashAccount.get(req.params.id);
    if (!current) return res.status(404).json({ error: "Not found" });

    const clientId = (req as any).user.userId;
    if (current.clientId !== clientId) return res.status(403).json({ error: "Forbidden" });

    const updates = { ...req.body, lastUpdatedBy: (req as any).user.userId };
    const item = await CashAccount.update(req.params.id, updates);

    // Audit balance changes
    if (req.body.currentBalance !== undefined || req.body.balance !== undefined) {
      trackCashFlowAction(req, "cashaccount.balance_updated", req.params.id, {
        previousBalance: current.currentBalance,
        newBalance: req.body.currentBalance ?? req.body.balance,
        accountName: current.accountName,
      });
    }

    res.json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/cash-accounts/:id", requireCashFlowWrite, async (req: Request, res: Response) => {
  try {
    const item = await CashAccount.get(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });
    await CashAccount.remove(req.params.id);
    trackCashFlowAction(req, "cashaccount.deleted", req.params.id, { accountName: item.accountName });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /cash-accounts/:id/reconcile
 * Reconcile bank balance: records actual bank balance as new opening balance.
 * Per the PDF spec: "At the beginning of each month, or during a regular reconciliation:
 * Actual Bank Balance = Opening Cash Balance for the new forecast period."
 */
router.post("/cash-accounts/:id/reconcile", requireCashFlowWrite, async (req: Request, res: Response) => {
  try {
    const current = await CashAccount.get(req.params.id);
    if (!current) return res.status(404).json({ error: "Not found" });

    const clientId = (req as any).user.userId;
    if (current.clientId !== clientId) return res.status(403).json({ error: "Forbidden" });

    const { actualBalance, notes } = req.body || {};
    if (actualBalance === undefined || actualBalance === null) {
      return res.status(400).json({ error: "actualBalance is required" });
    }
    if (Number(actualBalance) < 0 || !Number.isFinite(Number(actualBalance))) {
      return res.status(400).json({ error: "actualBalance must be a non-negative number" });
    }

    const previousBalance = current.currentBalance;
    const newBalance = Number(actualBalance);

    const updated = await CashAccount.update(req.params.id, {
      currentBalance: newBalance,
      updateSource: "reconciliation",
      lastUpdatedBy: (req as any).user.userId,
    });

    trackCashFlowAction(req, "cashaccount.reconciled", req.params.id, {
      accountName: current.accountName,
      previousBalance,
      newBalance,
      notes: notes || null,
      reconciledBy: (req as any).user.email,
    });

    res.json({
      success: true,
      account: updated,
      previousBalance,
      newBalance,
      reconciledAt: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== EXPECTED INFLOWS =====================

router.get("/cash-flow/inflows", async (req: Request, res: Response) => {
  try {
    const inflows = await ExpectedInflow.list(effectiveListScope(req));
    res.json(inflows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/cash-flow/inflows/:id", async (req: Request, res: Response) => {
  try {
    const item = await ExpectedInflow.get(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });
    res.json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/cash-flow/inflows", requireCashFlowWrite, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const { type, amount, expectedDate, customerId, customerName, marketplaceName, source, sourceId, confidence, notes } = req.body || {};
    if (!type) return res.status(400).json({ error: "type is required" });
    if (!amount || Number(amount) <= 0) return res.status(400).json({ error: "amount must be positive" });
    if (!expectedDate) return res.status(400).json({ error: "expectedDate is required" });

    // Validate type
    const validTypes = [
      "CUSTOMER_COLLECTION", "CUSTOMER_ADVANCE_RECEIVED", "MARKETPLACE_SETTLEMENT",
      "CASH_SALE_POS", "WEBSITE_PAYMENT_GATEWAY", "SALES_RETURN_RECOVERY",
      "SUPPLIER_REFUND", "BANK_INTEREST_RECEIVED", "LOAN_DISBURSEMENT",
      "CAPITAL_INTRODUCED", "TAX_REFUND", "INSURANCE_CLAIM", "ADVANCE_RECEIPT",
      "DEPOSIT_REFUND", "INTEREST_RECEIPT", "LOAN_WORKING_CAPITAL", "OTHER",
    ];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(", ")}` });
    }

    const item = await ExpectedInflow.create({
      clientId,
      type,
      amount: Number(amount),
      expectedDate,
      customerId,
      customerName,
      marketplaceName,
      source: source || "manual",
      sourceId: sourceId || null,
      confidence: confidence ? Number(confidence) : 80,
      notes,
      ownerId: (req as any).user.userId,
      ownerName: (req as any).user.email,
    });
    trackCashFlowAction(req, "cashflow.inflow_created", item.id, { type, amount, expectedDate });
    res.status(201).json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/cash-flow/inflows/:id", requireCashFlowWrite, async (req: Request, res: Response) => {
  try {
    const item = await ExpectedInflow.get(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });

    const previous = { ...item };
    const updated = await ExpectedInflow.update(req.params.id, req.body);

    // Audit significant changes
    if (req.body.amount !== undefined || req.body.expectedDate !== undefined || req.body.status !== undefined) {
      trackCashFlowAction(req, "cashflow.inflow_updated", req.params.id, {
        previousAmount: previous.amount,
        newAmount: req.body.amount ?? previous.amount,
        previousDate: previous.expectedDate,
        newDate: req.body.expectedDate ?? previous.expectedDate,
        previousStatus: previous.status,
        newStatus: req.body.status ?? previous.status,
      });
    }

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/cash-flow/inflows/:id", requireCashFlowWrite, async (req: Request, res: Response) => {
  try {
    await ExpectedInflow.remove(req.params.id);
    trackCashFlowAction(req, "cashflow.inflow_deleted", req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== EXPECTED OUTFLOWS =====================

router.get("/cash-flow/outflows", async (req: Request, res: Response) => {
  try {
    const outflows = await ExpectedOutflow.list(effectiveListScope(req));
    res.json(outflows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/cash-flow/outflows/:id", async (req: Request, res: Response) => {
  try {
    const item = await ExpectedOutflow.get(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });
    res.json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/cash-flow/outflows", requireCashFlowWrite, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const { type, amount, expectedDate, supplierId, supplierName, priority, source, sourceId, notes } = req.body || {};
    if (!type) return res.status(400).json({ error: "type is required" });
    if (!amount || Number(amount) <= 0) return res.status(400).json({ error: "amount must be positive" });
    if (!expectedDate) return res.status(400).json({ error: "expectedDate is required" });

    const validTypes = [
      "SUPPLIER_PAYMENT", "PLANNED_PURCHASE_COMMITMENT", "SUPPLIER_ADVANCE_PAID",
      "FREIGHT_LOGISTICS", "MARKETPLACE_FEES", "MARKETPLACE_ADVERTISING",
      "SALARY", "RENT", "UTILITY", "MARKETING", "TRAVEL_REIMBURSEMENT",
      "TAX", "EMI", "INSURANCE", "CUSTOMER_REFUND", "SUPPLIER_RETURN_COST",
      "CAPITAL_WITHDRAWAL", "CAPEX", "BANK_CHARGES", "SOFTWARE", "WAREHOUSE",
      "PROFESSIONAL_FEE", "OTHER",
    ];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(", ")}` });
    }

    const item = await ExpectedOutflow.create({
      clientId,
      type,
      amount: Number(amount),
      expectedDate,
      supplierId,
      supplierName,
      priority: priority || "NORMAL",
      source: source || "manual",
      sourceId: sourceId || null,
      notes,
      ownerId: (req as any).user.userId,
      ownerName: (req as any).user.email,
    });
    trackCashFlowAction(req, "cashflow.outflow_created", item.id, { type, amount, expectedDate });
    res.status(201).json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/cash-flow/outflows/:id", requireCashFlowWrite, async (req: Request, res: Response) => {
  try {
    const item = await ExpectedOutflow.get(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });

    const previous = { ...item };
    const updated = await ExpectedOutflow.update(req.params.id, req.body);

    if (req.body.amount !== undefined || req.body.expectedDate !== undefined || req.body.status !== undefined) {
      trackCashFlowAction(req, "cashflow.outflow_updated", req.params.id, {
        previousAmount: previous.amount,
        newAmount: req.body.amount ?? previous.amount,
        previousDate: previous.expectedDate,
        newDate: req.body.expectedDate ?? previous.expectedDate,
        previousStatus: previous.status,
        newStatus: req.body.status ?? previous.status,
      });
    }

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/cash-flow/outflows/:id", requireCashFlowWrite, async (req: Request, res: Response) => {
  try {
    await ExpectedOutflow.remove(req.params.id);
    trackCashFlowAction(req, "cashflow.outflow_deleted", req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== PURCHASE COMMITMENTS =====================

router.get("/cash-flow/commitments", async (req: Request, res: Response) => {
  try {
    res.json(await PurchaseCommitment.list(effectiveListScope(req)));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/cash-flow/commitments", requireCashFlowWrite, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const { expectedPaymentAmount, expectedPaymentDate, linkedPO, supplierId, supplierName, advancePaymentRequired, criticalStockDependency, notes } = req.body || {};
    if (!expectedPaymentAmount || Number(expectedPaymentAmount) <= 0) {
      return res.status(400).json({ error: "expectedPaymentAmount must be positive" });
    }
    if (!expectedPaymentDate) {
      return res.status(400).json({ error: "expectedPaymentDate is required" });
    }

    const item = await PurchaseCommitment.create({
      clientId,
      expectedPaymentAmount: Number(expectedPaymentAmount),
      expectedPaymentDate,
      linkedPO, supplierId, supplierName,
      advancePaymentRequired: !!advancePaymentRequired,
      criticalStockDependency: !!criticalStockDependency,
      notes,
      ownerId: (req as any).user.userId,
      ownerName: (req as any).user.email,
    });
    trackCashFlowAction(req, "cashflow.commitment_created", item.id, { amount: expectedPaymentAmount });
    res.status(201).json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/cash-flow/commitments/:id", requireCashFlowWrite, async (req: Request, res: Response) => {
  try {
    const item = await PurchaseCommitment.get(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });
    const updated = await PurchaseCommitment.update(req.params.id, req.body);
    trackCashFlowAction(req, "cashflow.commitment_updated", req.params.id, req.body);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/cash-flow/commitments/:id", requireCashFlowWrite, async (req: Request, res: Response) => {
  try {
    await PurchaseCommitment.remove(req.params.id);
    trackCashFlowAction(req, "cashflow.commitment_deleted", req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== RECURRING EXPENSES =====================

router.get("/cash-flow/recurring", async (req: Request, res: Response) => {
  try {
    res.json(await RecurringExpense.list(effectiveListScope(req)));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/cash-flow/recurring", requireCashFlowWrite, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const { category, description, amount, frequency, paymentDay, startDate, endDate, status } = req.body || {};
    if (!category) return res.status(400).json({ error: "category is required" });
    if (!amount || Number(amount) <= 0) return res.status(400).json({ error: "amount must be positive" });
    if (!frequency) return res.status(400).json({ error: "frequency is required" });

    const validFreq = ["WEEKLY", "MONTHLY", "QUARTERLY", "ANNUAL"];
    if (!validFreq.includes(frequency)) {
      return res.status(400).json({ error: `frequency must be one of: ${validFreq.join(", ")}` });
    }

    const item = await RecurringExpense.create({
      clientId,
      category,
      description,
      amount: Number(amount),
      frequency,
      paymentDay: paymentDay ? Number(paymentDay) : 1,
      startDate: startDate || db.todayDate(),
      endDate: endDate || null,
      status: status || "active",
      ownerId: (req as any).user.userId,
      ownerName: (req as any).user.email,
    });
    trackCashFlowAction(req, "cashflow.recurring_created", item.id, { category, amount, frequency });
    res.status(201).json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/cash-flow/recurring/:id", requireCashFlowWrite, async (req: Request, res: Response) => {
  try {
    const item = await RecurringExpense.get(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });
    const updated = await RecurringExpense.update(req.params.id, req.body);
    trackCashFlowAction(req, "cashflow.recurring_updated", req.params.id, req.body);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/cash-flow/recurring/:id", requireCashFlowWrite, async (req: Request, res: Response) => {
  try {
    await RecurringExpense.remove(req.params.id);
    trackCashFlowAction(req, "cashflow.recurring_deleted", req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== MARKETPLACE SETTLEMENTS =====================

router.get("/cash-flow/settlements", async (req: Request, res: Response) => {
  try {
    res.json(await MarketplaceSettlement.list(effectiveListScope(req)));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/cash-flow/settlements", requireCashFlowWrite, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const { marketplaceName, grossSales, marketplaceFees, deductions, refundsReturns, expectedSettlementDate, settlementReference, settlementPeriod, notes } = req.body || {};
    if (!marketplaceName) return res.status(400).json({ error: "marketplaceName is required" });
    if (!grossSales || Number(grossSales) < 0) return res.status(400).json({ error: "grossSales must be non-negative" });
    if (!expectedSettlementDate) return res.status(400).json({ error: "expectedSettlementDate is required" });

    const item = await MarketplaceSettlement.create({
      clientId,
      marketplaceName,
      grossSales: Number(grossSales),
      marketplaceFees: marketplaceFees ? Number(marketplaceFees) : 0,
      deductions: deductions ? Number(deductions) : 0,
      refundsReturns: refundsReturns ? Number(refundsReturns) : 0,
      expectedSettlementDate,
      settlementReference,
      settlementPeriod,
      notes,
    });
    trackCashFlowAction(req, "cashflow.settlement_created", item.id, {
      marketplace: marketplaceName,
      netExpected: item.netSettlementExpected,
    });
    res.status(201).json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/cash-flow/settlements/:id", requireCashFlowWrite, async (req: Request, res: Response) => {
  try {
    const item = await MarketplaceSettlement.get(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });
    const updated = await MarketplaceSettlement.update(req.params.id, req.body);
    trackCashFlowAction(req, "cashflow.settlement_updated", req.params.id, req.body);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/cash-flow/settlements/:id", requireCashFlowWrite, async (req: Request, res: Response) => {
  try {
    await MarketplaceSettlement.remove(req.params.id);
    trackCashFlowAction(req, "cashflow.settlement_deleted", req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== FORECAST ENDPOINTS =====================

router.get("/cash-flow/forecast", async (req: Request, res: Response) => {
  try {
    const scope = effectiveListScope(req);
    const mode = (req.query.mode as string) || "weekly";
    const viewMode = (req.query.view as string) || "with_commitments";
    if (!["daily", "weekly", "monthly"].includes(mode)) {
      return res.status(400).json({ error: "mode must be daily, weekly, or monthly" });
    }
    if (!["base", "with_commitments"].includes(viewMode)) {
      return res.status(400).json({ error: "view must be base or with_commitments" });
    }
    const forecast = await CashFlowEngine.computeForecast(scope, mode as any, viewMode as any);
    res.json(forecast);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/cash-flow/forecast/daily", async (req: Request, res: Response) => {
  try {
    const scope = effectiveListScope(req);
    const viewMode = (req.query.view as string) || "with_commitments";
    const forecast = await CashFlowEngine.computeForecast(scope, "daily", viewMode as any);
    res.json(forecast);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/cash-flow/forecast/weekly", async (req: Request, res: Response) => {
  try {
    const scope = effectiveListScope(req);
    const viewMode = (req.query.view as string) || "with_commitments";
    const forecast = await CashFlowEngine.computeForecast(scope, "weekly", viewMode as any);
    res.json(forecast);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/cash-flow/forecast/monthly", async (req: Request, res: Response) => {
  try {
    const scope = effectiveListScope(req);
    const viewMode = (req.query.view as string) || "with_commitments";
    const forecast = await CashFlowEngine.computeForecast(scope, "monthly", viewMode as any);
    res.json(forecast);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== UNINVOICED PURCHASE ORDERS =====================

router.get("/cash-flow/uninvoiced-pos", async (req: Request, res: Response) => {
  try {
    const scope = effectiveListScope(req);
    const [allPOs, allInvoices] = await Promise.all([
      GoodsPO.list(scope),
      PurchaseInvoice.list(scope),
    ]);

    // Build a set of goodsPurchaseOrderId values from LIVE purchase invoices
    // (a cancelled invoice releases the PO so it stays an approved commitment).
    const invoicedPOIds = new Set<string>();
    for (const pi of allInvoices) {
      if (pi.goodsPurchaseOrderId && String(pi.status || "").toLowerCase() !== "cancelled") {
        invoicedPOIds.add(pi.goodsPurchaseOrderId);
      }
    }

    // Filter: POs that are not cancelled/draft/pending_review AND have no linked invoice
    const uninvoiced = allPOs.filter((po) => {
      if (po.status === "cancelled") return false;
      if (po.status === "draft" || po.status === "pending_review") return false;
      return !invoicedPOIds.has(po.id);
    });

    res.json(uninvoiced);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/cash-flow/planned-pos", async (req: Request, res: Response) => {
  try {
    const planned = (await GoodsPO.list(effectiveListScope(req))).filter((po) =>
      ["draft", "pending_review"].includes(String(po.status || "").toLowerCase()),
    );
    res.json(planned);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== TRACEABILITY =====================

/**
 * GET /cash-flow/trace/:sourceType/:sourceId
 * Resolve full traceability details for a forecast line item.
 * Returns: source doc type, doc number, counterparty, expected date, amount, status, last updated info.
 */
router.get("/cash-flow/trace/:sourceType/:sourceId", async (req: Request, res: Response) => {
  try {
    const { sourceType, sourceId } = req.params;
    let trace: any = null;

    switch (sourceType) {
      case "invoice": {
        const invoice = await Invoice.get(sourceId);
        if (!invoice) return res.status(404).json({ error: "Invoice not found" });
        let customerName: string | null = null;
        if (invoice.debtorId) {
          const debtor = await Debtor.get(invoice.debtorId);
          customerName = debtor?.name || null;
        }
        const grandTotal = Number(invoice.grandTotal) || Number(invoice.amount) || 0;
        const advanceDeducted = Number(invoice.advanceDeducted) || 0;
        const amountReceived = Number(invoice.amountReceived) || 0;
        const outstanding = Math.max(0, grandTotal - advanceDeducted - amountReceived);
        trace = {
          sourceDocumentType: "Sales Invoice",
          sourceDocumentNumber: invoice.invoiceNumber || invoice.id,
          counterparty: customerName || "Customer",
          counterpartyType: "customer",
          expectedDate: invoice.dueDate || invoice.issueDate,
          amount: outstanding,
          totalAmount: grandTotal,
          amountReceived,
          status: invoice.status,
          lastUpdatedAt: invoice.updatedAt,
          notes: invoice.notes || null,
        };
        break;
      }
      case "purchase_invoice": {
        const pi = await PurchaseInvoice.get(sourceId);
        if (!pi) return res.status(404).json({ error: "Purchase invoice not found" });
        let supplierName: string | null = pi.supplierName || null;
        if (!supplierName && pi.vendorId) {
          const vendor = await Vendor.get(pi.vendorId);
          supplierName = vendor?.name || null;
        }
        const grandTotal = Number(pi.grandTotal) || Number(pi.amount) || 0;
        const advanceDeducted = Number(pi.advanceDeducted) || 0;
        const amountPaid = Number(pi.amountPaid) || 0;
        const outstanding = Math.max(0, grandTotal - advanceDeducted - amountPaid);
        trace = {
          sourceDocumentType: "Purchase Invoice",
          sourceDocumentNumber: pi.invoiceNumber || pi.id,
          counterparty: supplierName || "Supplier",
          counterpartyType: "supplier",
          expectedDate: pi.dueDate || pi.issueDate,
          amount: outstanding,
          totalAmount: grandTotal,
          amountPaid,
          status: pi.status,
          lastUpdatedAt: pi.updatedAt,
          notes: null,
        };
        break;
      }
      case "inflow": {
        const inflow = await ExpectedInflow.get(sourceId);
        if (!inflow) return res.status(404).json({ error: "Inflow not found" });
        trace = {
          sourceDocumentType: "Expected Inflow",
          sourceDocumentNumber: inflow.id,
          counterparty: inflow.customerName || inflow.marketplaceName || inflow.type,
          counterpartyType: inflow.customerId ? "customer" : "other",
          expectedDate: inflow.expectedDate,
          amount: inflow.amount,
          status: inflow.status,
          lastUpdatedAt: inflow.updatedAt,
          notes: inflow.notes,
        };
        break;
      }
      case "outflow": {
        const outflow = await ExpectedOutflow.get(sourceId);
        if (!outflow) return res.status(404).json({ error: "Outflow not found" });
        trace = {
          sourceDocumentType: "Expected Outflow",
          sourceDocumentNumber: outflow.id,
          counterparty: outflow.supplierName || outflow.type,
          counterpartyType: "supplier",
          expectedDate: outflow.expectedDate,
          amount: outflow.amount,
          status: outflow.status,
          lastUpdatedAt: outflow.updatedAt,
          notes: outflow.notes,
        };
        break;
      }
      case "commitment": {
        const commitment = await PurchaseCommitment.get(sourceId);
        if (!commitment) return res.status(404).json({ error: "Commitment not found" });
        trace = {
          sourceDocumentType: "Purchase Commitment",
          sourceDocumentNumber: commitment.linkedPO || commitment.id,
          counterparty: commitment.supplierName || "Supplier",
          counterpartyType: "supplier",
          expectedDate: commitment.expectedPaymentDate,
          amount: commitment.expectedPaymentAmount,
          status: commitment.status,
          lastUpdatedAt: commitment.updatedAt,
          notes: commitment.notes,
        };
        break;
      }
      case "marketplace": {
        const settlement = await MarketplaceSettlement.get(sourceId);
        if (!settlement) return res.status(404).json({ error: "Settlement not found" });
        trace = {
          sourceDocumentType: "Marketplace Settlement",
          sourceDocumentNumber: settlement.settlementReference || settlement.id,
          counterparty: settlement.marketplaceName,
          counterpartyType: "marketplace",
          expectedDate: settlement.expectedSettlementDate,
          amount: settlement.netSettlementExpected,
          grossSales: settlement.grossSales,
          fees: settlement.marketplaceFees,
          status: settlement.status,
          lastUpdatedAt: settlement.updatedAt,
          notes: settlement.notes,
        };
        break;
      }
      case "recurring": {
        const recurring = await RecurringExpense.get(sourceId);
        if (!recurring) return res.status(404).json({ error: "Recurring expense not found" });
        trace = {
          sourceDocumentType: "Recurring Expense",
          sourceDocumentNumber: recurring.id,
          counterparty: recurring.category,
          counterpartyType: "expense",
          expectedDate: recurring.startDate,
          amount: recurring.amount,
          frequency: recurring.frequency,
          status: recurring.status,
          lastUpdatedAt: recurring.updatedAt,
          notes: recurring.description,
        };
        break;
      }
      default:
        return res.status(400).json({ error: `Unknown source type: ${sourceType}` });
    }

    trackCashFlowAction(req, "cashflow.trace_resolved", sourceId, { sourceType });
    res.json(trace);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== DASHBOARD SUMMARY =====================

router.get("/cash-flow/summary", async (req: Request, res: Response) => {
  try {
    const summary = await CashFlowEngine.getSummary(effectiveListScope(req));
    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
