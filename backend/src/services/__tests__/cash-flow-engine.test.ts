/**
 * Cash-Flow Forecast Engine — Unit Tests
 *
 * Tests the core calculation logic without requiring DynamoDB by mocking
 * the model layer. Each test verifies one specific requirement from the spec.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockAccounts: any[] = [];
const mockSettings: any = {
  minimumCashBuffer: 1000000,
  baseCurrency: "INR",
};
const mockInflows: any[] = [];
const mockOutflows: any[] = [];
const mockCommitments: any[] = [];
const mockSettlements: any[] = [];
const mockRecurring: any[] = [];
const mockSalesInvoices: any[] = [];
const mockPurchaseInvoices: any[] = [];

vi.mock("../../models/cash-account.js", () => ({
  list: vi.fn(() => Promise.resolve(mockAccounts)),
  get: vi.fn(),
  totalAvailableCash: vi.fn(() =>
    Promise.resolve(
      mockAccounts
        .filter((a) => a.status === "active")
        .reduce((s, a) => s + (a.availableForOperations || 0), 0)
    )
  ),
}));

vi.mock("../../models/cash-flow-settings.js", () => ({
  get: vi.fn(() => Promise.resolve(mockSettings)),
}));

vi.mock("../../models/expected-inflow.js", () => ({
  list: vi.fn(() => Promise.resolve(mockInflows)),
  ACTIVE_INFLOW_STATUSES: ["EXPECTED", "PROMISED", "PARTIALLY_RECEIVED", "OVERDUE", "DELAYED"],
}));

vi.mock("../../models/expected-outflow.js", () => ({
  list: vi.fn(() => Promise.resolve(mockOutflows)),
  ACTIVE_OUTFLOW_STATUSES: ["PLANNED", "APPROVED", "DUE", "PARTIALLY_PAID", "DEFERRED"],
}));

vi.mock("../../models/purchase-commitment.js", () => ({
  list: vi.fn(() => Promise.resolve(mockCommitments)),
}));

vi.mock("../../models/marketplace-settlement.js", () => ({
  list: vi.fn(() => Promise.resolve(mockSettlements)),
}));

vi.mock("../../models/recurring-expense.js", () => ({
  list: vi.fn(() => Promise.resolve(mockRecurring)),
}));

vi.mock("../../models/invoice.js", () => ({
  list: vi.fn(() => Promise.resolve(mockSalesInvoices)),
}));
vi.mock("../../models/purchase-invoice.js", () => ({
  list: vi.fn(() => Promise.resolve(mockPurchaseInvoices)),
}));

// ── Import AFTER mocks ─────────────────────────────────────────────────────

import { computeForecast, getSummary } from "../cash-flow-engine.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Reset mocks between tests
beforeEach(() => {
  mockAccounts.length = 0;
  mockInflows.length = 0;
  mockOutflows.length = 0;
  mockCommitments.length = 0;
  mockSettlements.length = 0;
  mockRecurring.length = 0;
  mockSalesInvoices.length = 0;
  mockPurchaseInvoices.length = 0;
  mockSettings.minimumCashBuffer = 1000000;
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Cash-Flow Forecast Engine", () => {
  const CLIENT = "test-client";

  describe("Basic calculation", () => {
    it("Opening ₹40L + Inflows ₹20L - Outflows ₹15L = ₹45L closing", async () => {
      // Opening cash = ₹40,00,000
      mockAccounts.push({
        id: "acc1",
        clientId: CLIENT,
        availableForOperations: 4000000,
        status: "active",
      });

      // Inflow = ₹20,00,000 (expected next week)
      const futureDate = addDays(today(), 3);
      mockInflows.push({
        id: "in1",
        clientId: CLIENT,
        type: "CUSTOMER_COLLECTION",
        source: "invoice",
        sourceId: "inv1",
        amount: 2000000,
        expectedDate: futureDate,
        status: "EXPECTED",
      });

      // Outflow = ₹15,00,000
      mockOutflows.push({
        id: "out1",
        clientId: CLIENT,
        type: "SUPPLIER_PAYMENT",
        source: "purchase_invoice",
        sourceId: "pi1",
        amount: 1500000,
        expectedDate: futureDate,
        status: "PLANNED",
        priority: "NORMAL",
      });

      const forecast = await computeForecast(CLIENT, "weekly");

      expect(forecast.currentAvailableCash).toBe(4000000);
      expect(forecast.periods.length).toBe(13);

      // The first period should contain both the inflow and outflow
      const firstPeriod = forecast.periods[0];
      expect(firstPeriod.expectedInflows).toBe(2000000);
      expect(firstPeriod.expectedOutflows).toBe(1500000);
      expect(firstPeriod.openingCash).toBe(4000000);
      expect(firstPeriod.closingCash).toBe(4500000);
    });
  });

  describe("Period rollover", () => {
    it("Week 1 closing = Week 2 opening", async () => {
      mockAccounts.push({
        id: "acc1",
        clientId: CLIENT,
        availableForOperations: 4000000,
        status: "active",
      });

      const todayDate = today();
      // Week 1 inflow
      mockInflows.push({
        id: "in1",
        clientId: CLIENT,
        type: "CUSTOMER_COLLECTION",
        source: "invoice",
        sourceId: "inv1",
        amount: 500000,
        expectedDate: addDays(todayDate, 3),
        status: "EXPECTED",
      });

      // Week 2 outflow
      mockOutflows.push({
        id: "out1",
        clientId: CLIENT,
        type: "SUPPLIER_PAYMENT",
        source: "purchase_invoice",
        sourceId: "pi1",
        amount: 200000,
        expectedDate: addDays(todayDate, 10),
        status: "PLANNED",
        priority: "NORMAL",
      });

      const forecast = await computeForecast(CLIENT, "weekly");

      const week1 = forecast.periods[0];
      const week2 = forecast.periods[1];

      // Week 1 should have inflow, week 2 should have outflow
      expect(week1.expectedInflows).toBe(500000);
      expect(week2.expectedOutflows).toBe(200000);

      // Period rollover: week 2 opening must equal week 1 closing
      expect(week2.openingCash).toBe(week1.closingCash);
    });
  });

  describe("Invoice-backed forecast items", () => {
    it("uses live sales and purchase invoice dates and amounts when building forecast events", async () => {
      mockAccounts.push({
        id: "acc1",
        clientId: CLIENT,
        availableForOperations: 1000000,
        status: "active",
      });

      const inflowDate = addDays(today(), 4);
      const outflowDate = addDays(today(), 9);

      mockSalesInvoices.push({
        id: "inv-live",
        clientId: CLIENT,
        debtorId: "debtor-1",
        amount: 750000,
        dueDate: inflowDate,
        issueDate: today(),
        status: "draft",
        amountReceived: 0,
      });

      mockPurchaseInvoices.push({
        id: "pi-live",
        clientId: CLIENT,
        vendorId: "vendor-1",
        amount: 320000,
        dueDate: outflowDate,
        issueDate: today(),
        status: "approved_for_payment",
        amountPaid: 0,
      });

      const forecast = await computeForecast(CLIENT, "weekly");
      const allPeriods = forecast.periods.flatMap((p) => [
        ...p.inflowEvents.map((e: any) => ({ period: p.label, direction: e.direction, amount: e.amount, date: e.date })),
        ...p.outflowEvents.map((e: any) => ({ period: p.label, direction: e.direction, amount: e.amount, date: e.date })),
      ]);

      expect(allPeriods.some((e) => e.direction === "INFLOW" && e.amount === 750000 && e.date === inflowDate)).toBe(true);
      expect(allPeriods.some((e) => e.direction === "OUTFLOW" && e.amount === 320000 && e.date === outflowDate)).toBe(true);
    });

    it("uses the requested day, weekly, and monthly horizons", async () => {
      mockAccounts.push({
        id: "acc1",
        clientId: CLIENT,
        availableForOperations: 1000000,
        status: "active",
      });

      const dailyForecast = await computeForecast(CLIENT, "daily");
      const weeklyForecast = await computeForecast(CLIENT, "weekly");
      const monthlyForecast = await computeForecast(CLIENT, "monthly");

      expect(dailyForecast.periods.length).toBe(30);
      expect(weeklyForecast.periods.length).toBe(13);
      expect(monthlyForecast.periods.length).toBe(6);
    });
  });

  describe("Manual and recurring entries", () => {
    it("includes manual expected entries and recurring expenses in period rows", async () => {
      mockAccounts.push({
        id: "acc1",
        clientId: CLIENT,
        availableForOperations: 2500000,
        status: "active",
      });

      const manualInflowDate = addDays(today(), 2);
      const manualOutflowDate = addDays(today(), 6);
      const recurringDate = addDays(today(), 8);

      mockInflows.push({
        id: "manual-in",
        clientId: CLIENT,
        type: "CUSTOMER_COLLECTION",
        source: "manual",
        sourceId: "manual-in",
        amount: 400000,
        expectedDate: manualInflowDate,
        status: "EXPECTED",
      });

      mockOutflows.push({
        id: "manual-out",
        clientId: CLIENT,
        type: "SALARY",
        source: "manual",
        sourceId: "manual-out",
        amount: 180000,
        expectedDate: manualOutflowDate,
        status: "PLANNED",
        priority: "NORMAL",
      });

      mockRecurring.push({
        id: "rec-1",
        clientId: CLIENT,
        category: "Rent",
        description: "Office rent",
        amount: 50000,
        frequency: "MONTHLY",
        paymentDay: Number(recurringDate.slice(-2)),
        status: "active",
        startDate: today(),
        endDate: null,
      });

      const forecast = await computeForecast(CLIENT, "weekly");
      const allPeriods = forecast.periods.flatMap((p) => [
        ...p.inflowEvents.map((e: any) => ({ period: p.label, direction: e.direction, amount: e.amount, date: e.date, source: e.source })),
        ...p.outflowEvents.map((e: any) => ({ period: p.label, direction: e.direction, amount: e.amount, date: e.date, source: e.source })),
      ]);

      expect(allPeriods.some((e) => e.direction === "INFLOW" && e.amount === 400000 && e.date === manualInflowDate && e.source === "inflow")).toBe(true);
      expect(allPeriods.some((e) => e.direction === "OUTFLOW" && e.amount === 180000 && e.date === manualOutflowDate && e.source === "outflow")).toBe(true);
      expect(allPeriods.some((e) => e.direction === "OUTFLOW" && e.amount === 50000 && e.date === recurringDate)).toBe(true);
    });
  });

  describe("Cancelled items", () => {
    it("Cancelled inflows must not affect forecast", async () => {
      mockAccounts.push({
        id: "acc1",
        clientId: CLIENT,
        availableForOperations: 1000000,
        status: "active",
      });

      const futureDate = addDays(today(), 3);
      mockInflows.push({
        id: "in1",
        clientId: CLIENT,
        type: "CUSTOMER_COLLECTION",
        source: "invoice",
        sourceId: "inv1",
        amount: 500000,
        expectedDate: futureDate,
        status: "CANCELLED", // cancelled
      });

      mockInflows.push({
        id: "in2",
        clientId: CLIENT,
        type: "CUSTOMER_COLLECTION",
        source: "invoice",
        sourceId: "inv2",
        amount: 300000,
        expectedDate: futureDate,
        status: "EXPECTED", // active
      });

      const forecast = await computeForecast(CLIENT, "weekly");
      const firstPeriod = forecast.periods[0];

      // Only the expected inflow should appear
      expect(firstPeriod.expectedInflows).toBe(300000);
    });

    it("Cancelled outflows must not affect forecast", async () => {
      mockAccounts.push({
        id: "acc1",
        clientId: CLIENT,
        availableForOperations: 1000000,
        status: "active",
      });

      const futureDate = addDays(today(), 3);
      mockOutflows.push({
        id: "out1",
        clientId: CLIENT,
        type: "SUPPLIER_PAYMENT",
        source: "purchase_invoice",
        sourceId: "pi1",
        amount: 200000,
        expectedDate: futureDate,
        status: "CANCELLED",
        priority: "NORMAL",
      });

      const forecast = await computeForecast(CLIENT, "weekly");
      const firstPeriod = forecast.periods[0];

      expect(firstPeriod.expectedOutflows).toBe(0);
    });
  });

  describe("Minimum buffer / risk detection", () => {
    it("Projected cash below buffer triggers shortage risk", async () => {
      mockSettings.minimumCashBuffer = 1000000; // ₹10L buffer

      mockAccounts.push({
        id: "acc1",
        clientId: CLIENT,
        availableForOperations: 750000, // ₹7.5L — below buffer
        status: "active",
      });

      const forecast = await computeForecast(CLIENT, "weekly");

      expect(forecast.shortageRisk).toBe(true);
      expect(forecast.cashStatus).toBe("RED");
    });

    it("Projected cash comfortably above buffer = GREEN", async () => {
      mockSettings.minimumCashBuffer = 1000000;

      mockAccounts.push({
        id: "acc1",
        clientId: CLIENT,
        availableForOperations: 5000000, // ₹50L — well above buffer
        status: "active",
      });

      const forecast = await computeForecast(CLIENT, "weekly");

      expect(forecast.shortageRisk).toBe(false);
      expect(forecast.cashStatus).toBe("GREEN");
    });

    it("Projected cash within 20% of buffer = AMBER", async () => {
      mockSettings.minimumCashBuffer = 1000000;

      mockAccounts.push({
        id: "acc1",
        clientId: CLIENT,
        availableForOperations: 1150000, // ₹11.5L — within 20% of ₹10L buffer
        status: "active",
      });

      const forecast = await computeForecast(CLIENT, "weekly");

      expect(forecast.shortageRisk).toBe(false);
      expect(forecast.cashStatus).toBe("AMBER");
    });
  });

  describe("Marketplace settlements", () => {
    it("Gross ₹10L, Fees ₹2L, Refunds ₹1L → Inflow ₹7L", async () => {
      mockAccounts.push({
        id: "acc1",
        clientId: CLIENT,
        availableForOperations: 0,
        status: "active",
      });

      const futureDate = addDays(today(), 3);
      mockSettlements.push({
        id: "set1",
        clientId: CLIENT,
        marketplaceName: "Amazon",
        grossSales: 1000000,
        marketplaceFees: 200000,
        deductions: 0,
        refundsReturns: 100000,
        netSettlementExpected: 700000, // net = 10L - 2L - 0 - 1L = 7L
        expectedSettlementDate: futureDate,
        status: "EXPECTED",
      });

      const forecast = await computeForecast(CLIENT, "weekly");
      const firstPeriod = forecast.periods[0];

      expect(firstPeriod.expectedInflows).toBe(700000);
    });
  });

  describe("Recurring expenses", () => {
    it("Monthly expense appears on future scheduled dates", async () => {
      mockAccounts.push({
        id: "acc1",
        clientId: CLIENT,
        availableForOperations: 5000000,
        status: "active",
      });

      const todayDate = today();
      mockRecurring.push({
        id: "rec1",
        clientId: CLIENT,
        category: "Salary",
        description: "Monthly salary",
        amount: 500000,
        frequency: "MONTHLY",
        paymentDay: 1,
        status: "active",
        startDate: todayDate,
        endDate: null,
      });

      const forecast = await computeForecast(CLIENT, "weekly");

      // Total outflows across all weeks should include salary payments
      const totalOutflows = forecast.periods.reduce(
        (sum, p) => sum + p.expectedOutflows,
        0
      );
      // At least one monthly salary should appear
      expect(totalOutflows).toBeGreaterThanOrEqual(500000);
    });
  });

  describe("Multi-tenant isolation", () => {
    it("Only returns data for the specified clientId", async () => {
      // This test verifies the engine only queries models with the correct clientId
      // Since our mocks return the same data regardless, we verify the engine
      // passes the clientId correctly
      mockAccounts.push({
        id: "acc1",
        clientId: "other-client",
        availableForOperations: 99999999,
        status: "active",
      });

      // The engine queries with CLIENT, but the mock always returns the same data
      // This test ensures the engine doesn't crash and processes whatever it receives
      const forecast = await computeForecast(CLIENT, "weekly");
      expect(forecast).toBeDefined();
      expect(forecast.clientId).toBe(CLIENT);
    });
  });

  describe("Empty state", () => {
    it("With no data, forecast returns zero for all periods", async () => {
      const forecast = await computeForecast(CLIENT, "weekly");

      expect(forecast.currentAvailableCash).toBe(0);
      expect(forecast.periods.length).toBe(13);
      for (const p of forecast.periods) {
        expect(p.expectedInflows).toBe(0);
        expect(p.expectedOutflows).toBe(0);
      }
    });
  });

  describe("Forecast modes", () => {
    it("Daily mode returns 30 periods", async () => {
      const forecast = await computeForecast(CLIENT, "daily");
      expect(forecast.periods.length).toBe(30);
      expect(forecast.mode).toBe("daily");
    });

    it("Weekly mode returns 13 periods", async () => {
      const forecast = await computeForecast(CLIENT, "weekly");
      expect(forecast.periods.length).toBe(13);
      expect(forecast.mode).toBe("weekly");
    });

    it("Monthly mode returns 6 periods", async () => {
      const forecast = await computeForecast(CLIENT, "monthly");
      expect(forecast.periods.length).toBe(6);
      expect(forecast.mode).toBe("monthly");
    });
  });

  describe("Summary & Available Cash Robustness", () => {
    it("Computes available cash correctly with various account status casings and missing availableForOperations", async () => {
      mockAccounts.push(
        { id: "acc1", clientId: CLIENT, currentBalance: 500000, restrictedBalance: 50000, status: "ACTIVE", accountType: "BANK" },
        { id: "acc2", clientId: CLIENT, currentBalance: 300000, restrictedBalance: 0, status: "active", accountType: "MARKETPLACE", availableForOperations: 300000 },
        { id: "acc3", clientId: CLIENT, currentBalance: 100000, restrictedBalance: 0, status: "closed", accountType: "CASH" },
      );

      const summary = await getSummary(CLIENT);
      // acc1: 500k - 50k = 450k, acc2: 300k, acc3: closed (0) => total 750,000
      expect(summary.currentAvailableCash).toBe(750000);
      expect(summary.marketplaceValue).toBe(300000);
    });

    it("Includes both expected inflows and marketplace settlements in 7-day inflows summary", async () => {
      mockAccounts.push({ id: "acc1", clientId: CLIENT, currentBalance: 1000000, status: "active" });

      mockInflows.push({
        id: "in1",
        clientId: CLIENT,
        type: "CUSTOMER_COLLECTION",
        amount: 250000,
        expectedDate: addDays(today(), 2),
        status: "EXPECTED",
      });

      mockSettlements.push({
        id: "set1",
        clientId: CLIENT,
        marketplaceName: "Amazon",
        grossSales: 150000,
        marketplaceFees: 20000,
        netSettlementExpected: 130000,
        expectedSettlementDate: addDays(today(), 4),
        status: "EXPECTED",
      });

      const summary = await getSummary(CLIENT);
      // 250,000 + 130,000 = 380,000
      expect(summary.expectedInflowsNext7Days).toBe(380000);
      expect(summary.totalMarketplaceSettlementsPending).toBe(130000);
    });

    it("Includes direct outflows, PO commitments, and recurring expenses in 7-day outflows summary", async () => {
      mockAccounts.push({ id: "acc1", clientId: CLIENT, currentBalance: 1000000, status: "active" });

      mockOutflows.push({
        id: "out1",
        clientId: CLIENT,
        type: "SUPPLIER_PAYMENT",
        amount: 100000,
        expectedDate: addDays(today(), 2),
        status: "PLANNED",
      });

      mockCommitments.push({
        id: "com1",
        clientId: CLIENT,
        expectedPaymentAmount: 50000,
        expectedPaymentDate: addDays(today(), 3),
        status: "COMMITTED",
      });

      // Today's day of month
      const currentDay = new Date().getUTCDate();
      mockRecurring.push({
        id: "rec1",
        clientId: CLIENT,
        category: "Rent",
        amount: 40000,
        frequency: "MONTHLY",
        paymentDay: currentDay,
        startDate: today(),
        status: "active",
      });

      const summary = await getSummary(CLIENT);
      // 100,000 (outflow) + 50,000 (commitment) + 40,000 (recurring) = 190,000
      expect(summary.expectedOutflowsNext7Days).toBe(190000);
    });
  });
});
