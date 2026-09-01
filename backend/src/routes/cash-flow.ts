import { Router, Request, Response } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
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
    const clientId = (req as any).user.userId;
    const accounts = await CashAccount.list(clientId);
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

// ===================== EXPECTED INFLOWS =====================

router.get("/cash-flow/inflows", async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const inflows = await ExpectedInflow.list(clientId);
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
      "CUSTOMER_COLLECTION", "MARKETPLACE_SETTLEMENT", "LOAN_DISBURSEMENT",
      "PROMOTER_CAPITAL", "TAX_REFUND", "INSURANCE_CLAIM", "ADVANCE_RECEIPT",
      "DEPOSIT_REFUND", "INTEREST_RECEIPT", "OTHER",
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
    const clientId = (req as any).user.userId;
    const outflows = await ExpectedOutflow.list(clientId);
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
      "SUPPLIER_PAYMENT", "PURCHASE_COMMITMENT", "SALARY", "TAX", "EMI",
      "RENT", "UTILITY", "SOFTWARE", "WAREHOUSE", "TRANSPORT", "MARKETING",
      "INSURANCE", "PROFESSIONAL_FEE", "CAPEX", "OTHER",
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
    const clientId = (req as any).user.userId;
    res.json(await PurchaseCommitment.list(clientId));
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
    const clientId = (req as any).user.userId;
    res.json(await RecurringExpense.list(clientId));
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
    const clientId = (req as any).user.userId;
    res.json(await MarketplaceSettlement.list(clientId));
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
    const clientId = (req as any).user.userId;
    const mode = (req.query.mode as string) || "weekly";
    if (!["daily", "weekly", "monthly"].includes(mode)) {
      return res.status(400).json({ error: "mode must be daily, weekly, or monthly" });
    }
    const forecast = await CashFlowEngine.computeForecast(clientId, mode as any);
    res.json(forecast);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/cash-flow/forecast/daily", async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const forecast = await CashFlowEngine.computeForecast(clientId, "daily");
    res.json(forecast);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/cash-flow/forecast/weekly", async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const forecast = await CashFlowEngine.computeForecast(clientId, "weekly");
    res.json(forecast);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/cash-flow/forecast/monthly", async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const forecast = await CashFlowEngine.computeForecast(clientId, "monthly");
    res.json(forecast);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== DASHBOARD SUMMARY =====================

router.get("/cash-flow/summary", async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    const summary = await CashFlowEngine.getSummary(clientId);
    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
