import * as CashAccount from "../models/cash-account.js";
import * as CashFlowSettings from "../models/cash-flow-settings.js";
import * as ExpectedInflow from "../models/expected-inflow.js";
import * as ExpectedOutflow from "../models/expected-outflow.js";
import * as PurchaseCommitment from "../models/purchase-commitment.js";
import * as RecurringExpense from "../models/recurring-expense.js";
import * as MarketplaceSettlement from "../models/marketplace-settlement.js";
import * as Invoice from "../models/invoice.js";
import * as PurchaseInvoice from "../models/purchase-invoice.js";
import * as GoodsPO from "../models/goods-purchase-order.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CashEventDirection = "INFLOW" | "OUTFLOW";

export interface CashEvent {
  date: string;            // YYYY-MM-DD
  type: string;            // e.g. CUSTOMER_COLLECTION, SALARY
  direction: CashEventDirection;
  amount: number;
  source: string;          // model source: "inflow", "outflow", "recurring", "marketplace"
  sourceId: string;        // ID of the originating record
  status: string;
  priority: string;
  category: string;
  description: string;
}

export interface PeriodForecast {
  label: string;           // e.g. "Week 1", "2026-09", "2026-09-15"
  startDate: string;
  endDate: string;
  openingCash: number;
  expectedInflows: number;
  expectedOutflows: number;
  closingCash: number;
  inflowEvents: CashEvent[];
  outflowEvents: CashEvent[];
}

export type ForecastMode = "daily" | "weekly" | "monthly";
export type ForecastViewMode = "base" | "with_commitments";

export interface CashFlowForecast {
  clientId: string;
  mode: ForecastMode;
  viewMode: ForecastViewMode;
  currentAvailableCash: number;
  minimumCashBuffer: number;
  periods: PeriodForecast[];
  lowestProjectedCash: number;
  lowestProjectedCashDate: string;
  shortageRisk: boolean;
  shortageAmount: number;
  shortageDate: string | null;
  cashStatus: "GREEN" | "AMBER" | "RED";
  alerts: CashFlowAlert[];
  generatedAt: string;
}

export interface CashFlowAlert {
  id: string;
  type: string;
  severity: "info" | "warning" | "critical";
  message: string;
  sourceType: string | null;
  sourceId: string | null;
  date: string | null;
  amount: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function startOfWeek(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay(); // 0=Sun
  const diff = day === 0 ? 6 : day - 1; // Mon-based week
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

function endOfWeek(dateStr: string): string {
  return addDays(startOfWeek(dateStr), 6);
}

function startOfMonth(dateStr: string): string {
  return dateStr.slice(0, 7) + "-01";
}

function endOfMonth(dateStr: string): string {
  const [y, m] = dateStr.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${dateStr.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

function nextWeekStart(dateStr: string): string {
  return addDays(endOfWeek(dateStr), 1);
}

function nextMonthStart(dateStr: string): string {
  const [y, m] = dateStr.split("-").map(Number);
  if (m === 12) return `${y + 1}-01-01`;
  return `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  let cur = start;
  while (cur <= end) {
    dates.push(cur);
    cur = addDays(cur, 1);
  }
  return dates;
}

// ---------------------------------------------------------------------------
// Recurring expense occurrence generation
// ---------------------------------------------------------------------------

function generateOccurrences(
  expense: RecurringExpense.RecurringExpense,
  horizonEnd: string
): Array<{ date: string; amount: number }> {
  if (expense.status && expense.status.toLowerCase() !== "active") return [];
  const occurrences: Array<{ date: string; amount: number }> = [];
  const start = expense.startDate || "2000-01-01";
  const end = expense.endDate || horizonEnd;
  if (start > end) return [];

  const paymentDay = Number(expense.paymentDay) || 1;
  const amount = Number(expense.amount) || 0;
  const frequency = String(expense.frequency || "").toUpperCase();

  if (frequency === "WEEKLY") {
    // Generate every week from start, on the same weekday
    let cur = startOfWeek(start);
    // Align to the correct weekday (paymentDay here acts as offset from Monday)
    if (paymentDay > 1) cur = addDays(cur, paymentDay - 1);
    while (cur <= end) {
      if (cur >= start) occurrences.push({ date: cur, amount });
      cur = addDays(cur, 7);
    }
  } else if (frequency === "MONTHLY") {
    let [y, m] = start.split("-").map(Number);
    while (`${y}-${String(m).padStart(2, "0")}-01` <= end) {
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const day = Math.min(paymentDay, lastDay);
      const date = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (date >= start && date <= end) occurrences.push({ date, amount });
      m++;
      if (m > 12) { m = 1; y++; }
    }
  } else if (frequency === "QUARTERLY") {
    let [y, m] = start.split("-").map(Number);
    while (`${y}-${String(m).padStart(2, "0")}-01` <= end) {
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const day = Math.min(paymentDay, lastDay);
      const date = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (date >= start && date <= end) occurrences.push({ date, amount });
      m += 3;
      if (m > 12) { m -= 12; y++; }
    }
  } else if (frequency === "ANNUAL") {
    let [y, m] = start.split("-").map(Number);
    while (`${y}-${String(m).padStart(2, "0")}-01` <= end) {
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const day = Math.min(paymentDay, lastDay);
      const date = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (date >= start && date <= end) occurrences.push({ date, amount });
      y++;
    }
  }

  return occurrences;
}

// ---------------------------------------------------------------------------
// Build cash events from all sources
// ---------------------------------------------------------------------------

async function buildCashEvents(
  clientId: string,
  horizonEnd: string
): Promise<CashEvent[]> {
  const events: CashEvent[] = [];
  const seen = new Set<string>();
  const today = new Date().toISOString().slice(0, 10);

  const pushEvent = (event: CashEvent) => {
    const dedupeKey = event.sourceId
      ? `${event.source}:${event.sourceId}:${event.date}:${event.type}:${event.amount}`
      : `${event.source}:${event.date}:${event.type}:${event.amount}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    events.push(event);
  };

  // 0. Sales invoices: direct inflow driver in the live ledger, even when sync tables are stale.
  const salesInvoices = await Invoice.list(clientId);
  const liveSalesInvoiceIds = new Set(salesInvoices.map((invoice) => invoice?.id).filter(Boolean));
  const purchaseInvoices = await PurchaseInvoice.list(clientId);
  const livePurchaseInvoiceIds = new Set(purchaseInvoices.map((invoice) => invoice?.id).filter(Boolean));
  const goodsPurchaseOrders = await GoodsPO.list(clientId);
  // A PO is only consumed by a purchase invoice that is still live — a
  // cancelled invoice releases the PO so it keeps showing as a commitment.
  const invoicedPOIds = new Set(
    purchaseInvoices
      .filter((invoice: any) => String(invoice?.status || "").toLowerCase() !== "cancelled")
      .map((invoice: any) => invoice?.goodsPurchaseOrderId)
      .filter(Boolean),
  );
  for (const po of goodsPurchaseOrders) {
    if (!["approved", "sent", "partially_received"].includes(String(po.status || "").toLowerCase())) continue;
    if (invoicedPOIds.has(po.id)) continue;
    const date = po.expectedDate || po.dueDate || po.expectedDeliveryDate || po.poDate;
    if (!date || date > horizonEnd) continue;
    pushEvent({
      date,
      type: "PURCHASE_COMMITMENT",
      direction: "OUTFLOW",
      amount: round2(Number(po.grandTotal) || 0),
      source: "purchase_order",
      sourceId: po.id,
      status: String(po.status || "APPROVED").toUpperCase(),
      priority: "NORMAL",
      category: "PURCHASE_COMMITMENT",
      description: `${po.supplierName || "Supplier"} - PO ${po.poNumber || po.id}`,
    });
  }
  for (const invoice of salesInvoices) {
    if (!invoice?.id) continue;
    const status = String(invoice.status || "").toLowerCase();
    if (status === "cancelled") continue;

    const totalDue = Math.max(0, (Number(invoice.grandTotal ?? invoice.amount ?? 0) || 0)
      - (Number(invoice.advanceDeducted ?? 0) || 0));
    let paidAmount = Math.min(totalDue, Math.max(0, Number(invoice.amountReceived) || 0));
    if (status === "paid" && paidAmount <= 0) paidAmount = totalDue;

    const paidDate = invoice.paidDate || invoice.receiptDate;
    if (paidAmount > 0 && paidDate && paidDate <= horizonEnd) {
      pushEvent({
        date: paidDate,
        type: "CUSTOMER_COLLECTION",
        direction: "INFLOW",
        amount: round2(paidAmount),
        source: "invoice_payment",
        sourceId: invoice.id,
        status: "PAID",
        priority: "NORMAL",
        category: "CUSTOMER_COLLECTION",
        description: `${invoice.debtorId || "Customer"} - Invoice ${invoice.invoiceNumber || invoice.id} payment`,
      });
    }

    const outstanding = round2(Math.max(0, totalDue - paidAmount));
    const expectedDate = invoice.expectedDate || invoice.dueDate || invoice.promisedPaymentDate || invoice.issueDate;
    if (outstanding <= 0 || !expectedDate || expectedDate > horizonEnd) continue;

    pushEvent({
      date: expectedDate,
      type: "CUSTOMER_COLLECTION",
      direction: "INFLOW",
      amount: outstanding,
      source: "invoice",
      sourceId: invoice.id,
      status: status ? status.toUpperCase() : "EXPECTED",
      priority: "NORMAL",
      category: "CUSTOMER_COLLECTION",
      description: `${invoice.debtorId || "Customer"} - Invoice ${invoice.invoiceNumber || invoice.id}`,
    });
  }

  // 1. Expected Inflows (from invoice integration and manual entries)
  const inflows = await ExpectedInflow.list(clientId);
  for (const inflow of inflows) {
    if (!ExpectedInflow.ACTIVE_INFLOW_STATUSES.includes(inflow.status as any)) continue;
    if (inflow.expectedDate > horizonEnd) continue;
    if (inflow.source === "invoice" && inflow.sourceId && liveSalesInvoiceIds.has(inflow.sourceId)) continue;
    // Skip inflows that are in the past and not overdue (they've likely been received)
    // But keep OVERDUE and DELAYED inflows
    pushEvent({
      date: inflow.expectedDate,
      type: inflow.type,
      direction: "INFLOW",
      amount: round2(inflow.amount),
      source: "inflow",
      sourceId: inflow.id,
      status: inflow.status,
      priority: "NORMAL",
      category: inflow.type,
      description: `${inflow.customerName || inflow.marketplaceName || inflow.type} - ${inflow.notes || ""}`,
    });
  }

  // 2. Purchase invoices: direct outflow driver in the live ledger, even when sync tables are stale.
  for (const invoice of purchaseInvoices) {
    if (!invoice?.id) continue;
    const status = String(invoice.status || "").toLowerCase();
    if (status === "cancelled") continue;

    const totalDue = Math.max(0, (Number(invoice.grandTotal ?? invoice.amount ?? 0) || 0)
      - (Number(invoice.advanceDeducted ?? 0) || 0));
    let paidAmount = Math.min(totalDue, Math.max(0, Number(invoice.amountPaid) || 0));
    if (status === "paid" && paidAmount <= 0) paidAmount = totalDue;

    if (paidAmount > 0 && invoice.paidDate && invoice.paidDate <= horizonEnd) {
      pushEvent({
        date: invoice.paidDate,
        type: "SUPPLIER_PAYMENT",
        direction: "OUTFLOW",
        amount: round2(paidAmount),
        source: "purchase_invoice_payment",
        sourceId: invoice.id,
        status: "PAID",
        priority: "NORMAL",
        category: "SUPPLIER_PAYMENT",
        description: `${invoice.supplierName || invoice.vendorId || "Supplier"} - Invoice ${invoice.invoiceNumber || invoice.id} payment`,
      });
    }

    const outstanding = round2(Math.max(0, totalDue - paidAmount));
    const expectedDate = invoice.expectedDate || invoice.dueDate || invoice.agreedPaymentDate || invoice.issueDate;
    if (outstanding <= 0 || !expectedDate || expectedDate > horizonEnd) continue;

    pushEvent({
      date: expectedDate,
      type: "SUPPLIER_PAYMENT",
      direction: "OUTFLOW",
      amount: outstanding,
      source: "purchase_invoice",
      sourceId: invoice.id,
      status: status ? status.toUpperCase() : "PLANNED",
      priority: "NORMAL",
      category: "SUPPLIER_PAYMENT",
      description: `${invoice.supplierName || invoice.vendorId || "Supplier"} - Invoice ${invoice.invoiceNumber || invoice.id}`,
    });
  }

  // 3. Expected Outflows (from purchase invoice integration and manual entries)
  const outflows = await ExpectedOutflow.list(clientId);
  for (const outflow of outflows) {
    if (!ExpectedOutflow.ACTIVE_OUTFLOW_STATUSES.includes(outflow.status as any)) continue;
    if (outflow.expectedDate > horizonEnd) continue;
    if (outflow.source === "purchase_invoice" && outflow.sourceId && livePurchaseInvoiceIds.has(outflow.sourceId)) continue;
    pushEvent({
      date: outflow.expectedDate,
      type: outflow.type,
      direction: "OUTFLOW",
      amount: round2(outflow.amount),
      source: "outflow",
      sourceId: outflow.id,
      status: outflow.status,
      priority: outflow.priority,
      category: outflow.type,
      description: `${outflow.supplierName || outflow.type} - ${outflow.notes || ""}`,
    });
  }

  // 4. Purchase Commitments (pending POs without supplier invoices)
  const commitments = await PurchaseCommitment.list(clientId);
  for (const c of commitments) {
    if (c.status === "CANCELLED") continue;
    if (c.expectedPaymentDate > horizonEnd) continue;
    pushEvent({
      date: c.expectedPaymentDate,
      type: "PURCHASE_COMMITMENT",
      direction: "OUTFLOW",
      amount: round2(c.expectedPaymentAmount),
      source: "commitment",
      sourceId: c.id,
      status: c.status,
      priority: c.criticalStockDependency ? "CRITICAL" : "NORMAL",
      category: "PURCHASE_COMMITMENT",
      description: `PO commitment - ${c.supplierName || "Supplier"}${c.criticalStockDependency ? " (critical)" : ""}`,
    });
  }

  // 5. Marketplace Settlements (net only)
  const settlements = await MarketplaceSettlement.list(clientId);
  for (const s of settlements) {
    if (s.status === "DISPUTED") continue;
    const settlementDate = s.status === "RECEIVED"
      ? (s.actualSettlementDate || s.expectedSettlementDate)
      : s.expectedSettlementDate;
    if (!settlementDate || settlementDate > horizonEnd) continue;
    pushEvent({
      date: settlementDate,
      type: "MARKETPLACE_SETTLEMENT",
      direction: "INFLOW",
      amount: round2(s.netSettlementExpected),
      source: "marketplace",
      sourceId: s.id,
      status: s.status,
      priority: "NORMAL",
      category: "MARKETPLACE",
      description: `${s.marketplaceName} net settlement${s.settlementPeriod ? ` (${s.settlementPeriod})` : ""}`,
    });
  }

  // 6. Recurring Expenses — generate future occurrences
  const recurring = await RecurringExpense.list(clientId);
  for (const exp of recurring) {
    const occurrences = generateOccurrences(exp, horizonEnd);
    for (const occ of occurrences) {
      pushEvent({
        date: occ.date,
        type: exp.category.toUpperCase().replace(/\s+/g, "_"),
        direction: "OUTFLOW",
        amount: round2(occ.amount),
        source: "recurring",
        sourceId: exp.id,
        status: "PLANNED",
        priority: "NORMAL",
        category: exp.category,
        description: exp.description || exp.category,
      });
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Period generation
// ---------------------------------------------------------------------------

function generatePeriods(
  mode: ForecastMode,
  today: string
): Array<{ label: string; startDate: string; endDate: string }> {
  const periods: Array<{ label: string; startDate: string; endDate: string }> = [];

  if (mode === "daily") {
    // First 30 calendar days beginning with the current month.
    const monthStart = startOfMonth(today);
    for (let i = 0; i < 30; i++) {
      const d = addDays(monthStart, i);
      periods.push({ label: d, startDate: d, endDate: d });
    }
  } else if (mode === "weekly") {
    // Next 13 weeks
    let weekStart = startOfWeek(today);
    for (let i = 0; i < 13; i++) {
      const we = endOfWeek(weekStart);
      periods.push({
        label: `Week ${i + 1} (${weekStart})`,
        startDate: weekStart,
        endDate: we,
      });
      weekStart = nextWeekStart(weekStart);
    }
  } else if (mode === "monthly") {
    // Next 6 months
    let monthStart = startOfMonth(today);
    for (let i = 0; i < 6; i++) {
      const me = endOfMonth(monthStart);
      periods.push({
        label: monthStart,
        startDate: monthStart,
        endDate: me,
      });
      monthStart = nextMonthStart(monthStart);
    }
  }

  return periods;
}

// ---------------------------------------------------------------------------
// Main forecast computation
// ---------------------------------------------------------------------------

/**
 * Distinct client scopes that actually hold cash-flow records. Used to run the
 * engine portfolio-wide for platform-staff accounts (no single client scope).
 */
async function cashDataOwners(): Promise<string[]> {
  const [accounts, inflows, outflows, recurring, settlements, commitments] =
    await Promise.all([
      CashAccount.list(),
      ExpectedInflow.list(),
      ExpectedOutflow.list(),
      RecurringExpense.list(),
      MarketplaceSettlement.list(),
      PurchaseCommitment.list(),
    ]);
  const owners = new Set<string>();
  for (const rows of [accounts, inflows, outflows, recurring, settlements, commitments]) {
    for (const r of rows as any[]) {
      if (r?.clientId) owners.add(r.clientId);
    }
  }
  return Array.from(owners);
}

/** Empty forecast used when no cash records exist anywhere on the platform. */
function emptyForecast(
  mode: ForecastMode,
  viewMode: ForecastViewMode,
): CashFlowForecast {
  return {
    clientId: "all",
    mode,
    viewMode,
    currentAvailableCash: 0,
    minimumCashBuffer: 0,
    periods: [],
    lowestProjectedCash: 0,
    lowestProjectedCashDate: new Date().toISOString().slice(0, 10),
    shortageRisk: false,
    shortageAmount: 0,
    shortageDate: null,
    cashStatus: "GREEN",
    alerts: [],
    generatedAt: new Date().toISOString(),
  };
}

/** Combine per-owner projections (same mode ⇒ same period grid) into one view. */
function mergeOwnerForecasts(
  forecasts: CashFlowForecast[],
  mode: ForecastMode,
  viewMode: ForecastViewMode,
): CashFlowForecast {
  const combined = emptyForecast(mode, viewMode);
  combined.periods = (forecasts[0]?.periods ?? []).map((p, idx) => {
    const open = forecasts.reduce((s, f) => s + (f.periods[idx]?.openingCash ?? 0), 0);
    const inflows = forecasts.reduce((s, f) => s + (f.periods[idx]?.expectedInflows ?? 0), 0);
    const outflows = forecasts.reduce((s, f) => s + (f.periods[idx]?.expectedOutflows ?? 0), 0);
    return {
      label: p.label,
      startDate: p.startDate,
      endDate: p.endDate,
      openingCash: round2(open),
      expectedInflows: round2(inflows),
      expectedOutflows: round2(outflows),
      closingCash: round2(open + inflows - outflows),
      inflowEvents: forecasts.flatMap((f) => f.periods[idx]?.inflowEvents ?? []),
      outflowEvents: forecasts.flatMap((f) => f.periods[idx]?.outflowEvents ?? []),
    };
  });
  combined.currentAvailableCash = round2(
    forecasts.reduce((s, f) => s + f.currentAvailableCash, 0),
  );
  combined.minimumCashBuffer = round2(
    forecasts.reduce((s, f) => s + f.minimumCashBuffer, 0),
  );
  const lows = combined.periods
    .map((p) => ({ val: p.closingCash, date: p.endDate }))
    .concat({ val: combined.currentAvailableCash, date: combined.periods[0]?.startDate ?? "" });
  const lowest = lows.reduce((a, b) => (b.val < a.val ? b : a), {
    val: combined.currentAvailableCash,
    date: combined.periods[0]?.startDate ?? "",
  });
  combined.lowestProjectedCash = round2(lowest.val);
  combined.lowestProjectedCashDate = lowest.date || new Date().toISOString().slice(0, 10);
  combined.shortageRisk = combined.lowestProjectedCash < combined.minimumCashBuffer;
  combined.shortageAmount = combined.shortageRisk
    ? round2(Math.max(0, combined.minimumCashBuffer - combined.lowestProjectedCash))
    : 0;
  combined.shortageDate = combined.shortageRisk ? combined.lowestProjectedCashDate : null;
  combined.cashStatus =
    combined.lowestProjectedCash < combined.minimumCashBuffer
      ? "RED"
      : combined.lowestProjectedCash < combined.minimumCashBuffer * 1.2
        ? "AMBER"
        : "GREEN";
  // Avoid duplicate alert ids across operating accounts.
  combined.alerts = forecasts.flatMap((f, i) =>
    f.alerts.map((a) => ({ ...a, id: `${i}-${a.id}` })),
  );
  return combined;
}

/**
 * Forecast for one operating account. Pass an explicit client id (legacy
 * behaviour) — staff accounts pass `undefined` and get the pooled portfolio
 * projection via the exported wrapper.
 */
async function computeOwnerForecast(
  clientId: string,
  mode: ForecastMode = "weekly",
  viewMode: ForecastViewMode = "with_commitments"
): Promise<CashFlowForecast> {
  const today = new Date().toISOString().slice(0, 10);

  // Determine horizon based on mode
  let horizonEnd: string;
  if (mode === "daily") horizonEnd = addDays(startOfMonth(today), 29);
  else if (mode === "weekly") horizonEnd = addDays(today, 13 * 7);
  else horizonEnd = addDays(today, 6 * 31);

  // Parallel fetch
  const [settings, accounts, events] = await Promise.all([
    CashFlowSettings.get(clientId),
    CashAccount.list(clientId),
    buildCashEvents(clientId, horizonEnd),
  ]);

  const currentCash = accounts
    .filter((a: any) => !a.status || a.status.toLowerCase() === "active")
    .reduce((sum, a: any) => {
      const currentBal = Number(a.currentBalance ?? a.balance ?? a.current_balance ?? a.amount ?? 0) || 0;
      const restricted = Number(a.restrictedBalance ?? a.restricted ?? a.restricted_balance ?? 0) || 0;
      const avail = a.availableForOperations !== undefined && !isNaN(Number(a.availableForOperations))
        ? Number(a.availableForOperations)
        : (currentBal - restricted);
      return sum + avail;
    }, 0);

  const minimumBuffer = Number(settings.minimumCashBuffer) || 0;
  const periods = generatePeriods(mode, today);

  // Filter events based on view mode:
  // "base" = confirmed inflows/outflows only (exclude all PO commitments,
  //          both manual entries and approved purchase orders)
  // "with_commitments" = base + planned PO commitments
  const filteredEvents = viewMode === "base"
    ? events.filter((e) => e.source !== "commitment" && e.source !== "purchase_order")
    : events;

  // Build a date→events index for fast lookup
  const eventsByDate = new Map<string, CashEvent[]>();
  for (const e of filteredEvents) {
    const arr = eventsByDate.get(e.date) || [];
    arr.push(e);
    eventsByDate.set(e.date, arr);
  }

  // Compute period forecasts
  const periodForecasts: PeriodForecast[] = [];
  let runningCash = currentCash;

  for (const period of periods) {
    const periodDates = dateRange(period.startDate, period.endDate);
    let periodInflows = 0;
    let periodOutflows = 0;
    const inflowEvents: CashEvent[] = [];
    const outflowEvents: CashEvent[] = [];

    for (const d of periodDates) {
      const dayEvents = eventsByDate.get(d) || [];
      for (const e of dayEvents) {
        if (e.direction === "INFLOW") {
          periodInflows += e.amount;
          inflowEvents.push(e);
        } else {
          periodOutflows += e.amount;
          outflowEvents.push(e);
        }
      }
    }

    const opening = round2(runningCash);
    const closing = round2(opening + periodInflows - periodOutflows);

    periodForecasts.push({
      label: period.label,
      startDate: period.startDate,
      endDate: period.endDate,
      openingCash: opening,
      expectedInflows: round2(periodInflows),
      expectedOutflows: round2(periodOutflows),
      closingCash: closing,
      inflowEvents,
      outflowEvents,
    });

    runningCash = closing;
  }

  // Find lowest projected cash
  let lowestCash = currentCash;
  let lowestDate = today;
  for (const pf of periodForecasts) {
    if (pf.closingCash < lowestCash) {
      lowestCash = pf.closingCash;
      lowestDate = pf.endDate;
    }
  }

  // Cash status
  let cashStatus: "GREEN" | "AMBER" | "RED" = "GREEN";
  if (lowestCash < minimumBuffer) {
    cashStatus = "RED";
  } else if (lowestCash < minimumBuffer * 1.2) {
    cashStatus = "AMBER";
  }

  // Shortage detection
  const shortageRisk = lowestCash < minimumBuffer;
  let shortageAmount = 0;
  let shortageDate: string | null = null;
  if (shortageRisk) {
    shortageAmount = round2(minimumBuffer - lowestCash);
    shortageDate = lowestDate;
  }

  // Generate alerts
  const alerts = await generateAlerts(clientId, periodForecasts, minimumBuffer, events);

  return {
    clientId,
    mode,
    viewMode,
    currentAvailableCash: round2(currentCash),
    minimumCashBuffer: minimumBuffer,
    periods: periodForecasts,
    lowestProjectedCash: round2(lowestCash),
    lowestProjectedCashDate: lowestDate,
    shortageRisk,
    shortageAmount,
    shortageDate,
    cashStatus,
    alerts,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Cash-flow forecast. `clientId` scopes the projection to one operating
 * account (legacy behaviour). When omitted (platform-staff accounts with no
 * client scope) the whole portfolio is pooled: if a single account owns the
 * cash records the caller sees that account's projection verbatim, otherwise
 * per-owner projections are merged into one combined view.
 */
export async function computeForecast(
  clientId: string | undefined,
  mode: ForecastMode = "weekly",
  viewMode: ForecastViewMode = "with_commitments",
): Promise<CashFlowForecast> {
  if (clientId) return computeOwnerForecast(clientId, mode, viewMode);
  const owners = await cashDataOwners();
  if (owners.length === 0) return emptyForecast(mode, viewMode);
  if (owners.length === 1) return computeOwnerForecast(owners[0], mode, viewMode);
  const forecasts = await Promise.all(
    owners.map((id) => computeOwnerForecast(id, mode, viewMode)),
  );
  return mergeOwnerForecasts(forecasts, mode, viewMode);
}

// ---------------------------------------------------------------------------
// Alert generation
// ---------------------------------------------------------------------------

async function generateAlerts(
  clientId: string,
  periods: PeriodForecast[],
  minimumBuffer: number,
  events: CashEvent[]
): Promise<CashFlowAlert[]> {
  const alerts: CashFlowAlert[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const in7Days = addDays(today, 7);

  // 1. CASH_BELOW_BUFFER
  for (const p of periods) {
    if (p.closingCash < minimumBuffer) {
      alerts.push({
        id: `cash-below-${p.startDate}`,
        type: "CASH_BELOW_BUFFER",
        severity: "critical",
        message: `Projected cash is expected to fall below the minimum buffer (${minimumBuffer.toLocaleString()}) by ${p.endDate}. Projected: ${p.closingCash.toLocaleString()}`,
        sourceType: null,
        sourceId: null,
        date: p.endDate,
        amount: p.closingCash,
      });
      break; // Only alert for the first occurrence
    }
  }

  // 2. LARGE_PAYMENT_DUE (outflows in next 7 days > 20% of buffer)
  const soonOutflows = events.filter(
    (e) => e.direction === "OUTFLOW" && e.date >= today && e.date <= in7Days
  );
  const totalSoonOutflows = soonOutflows.reduce((s, e) => s + e.amount, 0);
  if (totalSoonOutflows > minimumBuffer * 0.2 && soonOutflows.length > 0) {
    alerts.push({
      id: `large-payment-${today}`,
      type: "LARGE_PAYMENT_DUE",
      severity: "warning",
      message: `₹${totalSoonOutflows.toLocaleString()} in payments due within the next 7 days`,
      sourceType: "outflows",
      sourceId: null,
      date: in7Days,
      amount: totalSoonOutflows,
    });
  }

  // 3. Overdue inflows
  const overdueInflows = events.filter(
    (e) => e.direction === "INFLOW" && e.status === "OVERDUE" && e.date < today
  );
  if (overdueInflows.length > 0) {
    const total = overdueInflows.reduce((s, e) => s + e.amount, 0);
    alerts.push({
      id: `overdue-collections-${today}`,
      type: "CUSTOMER_COLLECTION_OVERDUE",
      severity: "warning",
      message: `${overdueInflows.length} overdue customer collection(s) totalling ₹${total.toLocaleString()}`,
      sourceType: "inflow",
      sourceId: overdueInflows[0]?.sourceId || null,
      date: today,
      amount: total,
    });
  }

  // 4. Delayed marketplace settlements
  const delayedSettlements = events.filter(
    (e) => e.type === "MARKETPLACE_SETTLEMENT" && e.status === "DELAYED"
  );
  if (delayedSettlements.length > 0) {
    const total = delayedSettlements.reduce((s, e) => s + e.amount, 0);
    alerts.push({
      id: `delayed-settlements-${today}`,
      type: "MARKETPLACE_SETTLEMENT_DELAYED",
      severity: "warning",
      message: `${delayedSettlements.length} marketplace settlement(s) delayed totalling ₹${total.toLocaleString()}`,
      sourceType: "marketplace",
      sourceId: delayedSettlements[0]?.sourceId || null,
      date: today,
      amount: total,
    });
  }

  // 5. Critical purchase commitments
  const criticalCommitments = events.filter(
    (e) => e.type === "PURCHASE_COMMITMENT" && e.priority === "CRITICAL" && e.status !== "CANCELLED"
  );
  if (criticalCommitments.length > 0) {
    const total = criticalCommitments.reduce((s, e) => s + e.amount, 0);
    alerts.push({
      id: `critical-commitments-${today}`,
      type: "CRITICAL_STOCK_DEFERRED",
      severity: "critical",
      message: `${criticalCommitments.length} critical purchase commitment(s) totalling ₹${total.toLocaleString()}`,
      sourceType: "commitment",
      sourceId: criticalCommitments[0]?.sourceId || null,
      date: today,
      amount: total,
    });
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// Summary helpers for the dashboard
// ---------------------------------------------------------------------------

export interface CashCommandCentreSummary {
  currentAvailableCash: number;
  marketplaceValue: number;
  expectedInflowsNext7Days: number;
  expectedOutflowsNext7Days: number;
  totalRecurringExpensesNext7Days: number;
  projectedClosingCashNext7Days: number;
  projectedClosingCashNext30Days: number;
  lowestProjectedCashDate: string;
  lowestProjectedCash: number;
  totalOverdueCollections: number;
  totalSupplierPaymentsDue: number;
  totalPlannedPurchaseCommitments: number;
  confirmedSupplierPayables: number;
  totalMarketplaceSettlementsPending: number;
  plannedPurchaseOrders: number;
  overdueCustomerReceipts: number;
  supplierPayables: number;
  poCommitments: number;
  marketplaceInflowsNext7Days: number;
  salesInflowsNext7Days: number;
  recurringOutflowsNext7Days: number;
  purchaseOutflowsNext7Days: number;
  cashStatus: "GREEN" | "AMBER" | "RED";
  alerts: CashFlowAlert[];
}

async function getOwnerSummary(clientId: string): Promise<CashCommandCentreSummary> {
  const [settings, accounts, inflows, outflows, commitments, settlements, recurring, salesInvoices, purchaseInvoices, goodsPurchaseOrders] = await Promise.all([
    CashFlowSettings.get(clientId),
    CashAccount.list(clientId),
    ExpectedInflow.list(clientId),
    ExpectedOutflow.list(clientId),
    PurchaseCommitment.list(clientId),
    MarketplaceSettlement.list(clientId),
    RecurringExpense.list(clientId),
    Invoice.list(clientId),
    PurchaseInvoice.list(clientId),
    GoodsPO.list(clientId),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const in7 = addDays(today, 7);
  const in30 = addDays(today, 30);

  const currentCash = accounts
    .filter((a: any) => !a.status || a.status.toLowerCase() === "active")
    .reduce((sum, a: any) => {
      const currentBal = Number(a.currentBalance ?? a.balance ?? a.current_balance ?? a.amount ?? 0) || 0;
      const restricted = Number(a.restrictedBalance ?? a.restricted ?? a.restricted_balance ?? 0) || 0;
      const avail = a.availableForOperations !== undefined && !isNaN(Number(a.availableForOperations))
        ? Number(a.availableForOperations)
        : (currentBal - restricted);
      return sum + avail;
    }, 0);

  // Marketplace value: total balance of MARKETPLACE-type cash accounts
  const marketplaceValue = accounts
    .filter((a: any) => (!a.status || a.status.toLowerCase() === "active") && (a.accountType === "MARKETPLACE" || a.type === "MARKETPLACE"))
    .reduce((sum, a: any) => {
      const currentBal = Number(a.currentBalance ?? a.balance ?? a.current_balance ?? a.amount ?? 0) || 0;
      const restricted = Number(a.restrictedBalance ?? a.restricted ?? a.restricted_balance ?? 0) || 0;
      const avail = a.availableForOperations !== undefined && !isNaN(Number(a.availableForOperations))
        ? Number(a.availableForOperations)
        : (currentBal - restricted);
      return sum + avail;
    }, 0);

  const liveSalesInvoiceIds = new Set(salesInvoices.map((invoice: any) => invoice?.id).filter(Boolean));
  const livePurchaseInvoiceIds = new Set(purchaseInvoices.map((invoice: any) => invoice?.id).filter(Boolean));
  // Only live purchase invoices consume a PO commitment — cancelled invoices
  // release the PO back so it keeps showing as an approved-PO outflow.
  const invoicedPOIds = new Set(
    purchaseInvoices
      .filter((invoice: any) => String(invoice?.status || "").toLowerCase() !== "cancelled")
      .map((invoice: any) => invoice?.goodsPurchaseOrderId)
      .filter(Boolean),
  );
  const approvedPOs = goodsPurchaseOrders.filter((po: any) =>
    ["approved", "sent", "partially_received"].includes(String(po.status || "").toLowerCase()) && !invoicedPOIds.has(po.id),
  );
  const plannedPOs = goodsPurchaseOrders.filter((po: any) =>
    ["draft", "pending_review"].includes(String(po.status || "").toLowerCase()),
  );

  // Active inflows in next 7 days (direct expected inflows + marketplace settlements)
  const activeInflows = inflows.filter((i) =>
    ExpectedInflow.ACTIVE_INFLOW_STATUSES.includes(i.status as any) &&
    !(i.source === "invoice" && i.sourceId && liveSalesInvoiceIds.has(i.sourceId))
  );
  const directInflows7d = activeInflows
    .filter((i) => i.expectedDate >= today && i.expectedDate <= in7)
    .reduce((s, i) => s + (Number(i.amount) || 0), 0);

  const settlements7d = settlements
    .filter((s) => s.status !== "RECEIVED" && s.status !== "DISPUTED" && s.expectedSettlementDate >= today && s.expectedSettlementDate <= in7)
    .reduce((s, x) => s + (Number(x.netSettlementExpected) || 0), 0);

  const invoiceInflows7d = salesInvoices
    .filter((invoice: any) => invoice && invoice.id && String(invoice.status || "").toLowerCase() !== "cancelled")
    .reduce((s, invoice: any) => {
      const status = String(invoice.status || "").toLowerCase();
      const totalDue = Math.max(0, (Number(invoice.grandTotal ?? invoice.amount ?? 0) || 0) - (Number(invoice.advanceDeducted ?? 0) || 0));
      let paidAmount = Math.min(totalDue, Math.max(0, Number(invoice.amountReceived) || 0));
      if (status === "paid" && paidAmount <= 0) paidAmount = totalDue;
      const paidDate = invoice.paidDate || invoice.receiptDate;
      const paymentInWindow = paidAmount > 0 && paidDate >= today && paidDate <= in7;
      const outstanding = Math.max(0, totalDue - paidAmount);
      const dueDate = invoice.expectedDate || invoice.dueDate || invoice.promisedPaymentDate || invoice.issueDate;
      const unpaidInWindow = outstanding > 0 && dueDate >= today && dueDate <= in7;
      return s + (paymentInWindow ? paidAmount : 0) + (unpaidInWindow ? outstanding : 0);
    }, 0);

  const totalInflows7d = directInflows7d + settlements7d + invoiceInflows7d;

  // Active outflows in next 7 days (direct expected outflows + commitments + recurring expenses)
  const activeOutflows = outflows.filter((o) =>
    ExpectedOutflow.ACTIVE_OUTFLOW_STATUSES.includes(o.status as any) &&
    !(o.source === "purchase_invoice" && o.sourceId && livePurchaseInvoiceIds.has(o.sourceId))
  );
  const directOutflows7d = activeOutflows
    .filter((o) => o.expectedDate >= today && o.expectedDate <= in7)
    .reduce((s, o) => s + (Number(o.amount) || 0), 0);

  // Commitments in next 7 days
  const activeCommitments = commitments.filter((c) => c.status !== "CANCELLED");
  const commitmentsOut = activeCommitments
    .filter((c) => c.expectedPaymentDate >= today && c.expectedPaymentDate <= in7)
    .reduce((s, c) => s + (Number(c.expectedPaymentAmount) || 0), 0);

  // Recurring expenses in next 7 days
  const recurring7d = recurring
    .filter((r) => !r.status || r.status.toLowerCase() === "active")
    .flatMap((exp) => generateOccurrences(exp, in7))
    .filter((occ) => occ.date >= today && occ.date <= in7)
    .reduce((s, occ) => s + (Number(occ.amount) || 0), 0);

  const invoiceOutflows7d = purchaseInvoices
    .filter((invoice: any) => invoice && invoice.id && String(invoice.status || "").toLowerCase() !== "cancelled")
    .reduce((s, invoice: any) => {
      const status = String(invoice.status || "").toLowerCase();
      const totalDue = Math.max(0, (Number(invoice.grandTotal ?? invoice.amount ?? 0) || 0) - (Number(invoice.advanceDeducted ?? 0) || 0));
      let paidAmount = Math.min(totalDue, Math.max(0, Number(invoice.amountPaid) || 0));
      if (status === "paid" && paidAmount <= 0) paidAmount = totalDue;
      const paidDate = invoice.paidDate;
      const paymentInWindow = paidAmount > 0 && paidDate >= today && paidDate <= in7;
      const outstanding = Math.max(0, totalDue - paidAmount);
      const dueDate = invoice.expectedDate || invoice.dueDate || invoice.agreedPaymentDate || invoice.issueDate;
      const unpaidInWindow = outstanding > 0 && dueDate >= today && dueDate <= in7;
      return s + (paymentInWindow ? paidAmount : 0) + (unpaidInWindow ? outstanding : 0);
    }, 0);

  const poOutflows7d = approvedPOs
    .filter((po: any) => {
      const date = po.expectedDate || po.dueDate || po.expectedDeliveryDate || po.poDate;
      return date >= today && date <= in7;
    })
    .reduce((s: number, po: any) => s + (Number(po.grandTotal) || 0), 0);
  const totalOutflows7d = directOutflows7d + commitmentsOut + poOutflows7d + recurring7d + invoiceOutflows7d;

  // Overdue collections
  const overdueTotal = activeInflows
    .filter((i) => i.status === "OVERDUE" || (i.status !== "RECEIVED" && i.status !== "CANCELLED" && i.expectedDate < today))
    .reduce((s, i) => s + (Number(i.amount) || 0), 0);

  // Supplier payments due
  const supplierDue = activeOutflows
    .filter((o) => o.type === "SUPPLIER_PAYMENT" && o.expectedDate >= today && o.expectedDate <= in7)
    .reduce((s, o) => s + (Number(o.amount) || 0), 0);

  // Marketplace pending (settlements)
  const pendingSettlements = settlements.filter((s) => s.status === "EXPECTED" || s.status === "DELAYED");
  const pendingTotal = pendingSettlements.reduce((s, x) => s + (Number(x.netSettlementExpected) || 0), 0);

  // Total planned purchase commitments (all non-cancelled POs without invoices)
  const plannedCommitmentsTotal = activeCommitments
    .reduce((s, c) => s + (Number(c.expectedPaymentAmount) || 0), 0) +
    approvedPOs.reduce((s: number, po: any) => s + (Number(po.grandTotal) || 0), 0);

  // Confirmed supplier payables (all active supplier payment outflows)
  const confirmedSupplierPayables = activeOutflows
    .filter((o) => o.type === "SUPPLIER_PAYMENT")
    .reduce((s, o) => s + (Number(o.amount) || 0), 0);

  const overdueInvoiceReceipts = salesInvoices.reduce((s: number, invoice: any) => {
    const status = String(invoice?.status || "").toLowerCase();
    if (!invoice?.id || status === "cancelled" || status === "paid") return s;
    const totalDue = Math.max(0, (Number(invoice.grandTotal ?? invoice.amount ?? 0) || 0) - (Number(invoice.advanceDeducted ?? 0) || 0));
    const outstanding = Math.max(0, totalDue - (Number(invoice.amountReceived) || 0));
    return s + (invoice.dueDate < today ? outstanding : 0);
  }, 0);

  const supplierPayables = purchaseInvoices.reduce((s: number, invoice: any) => {
    const status = String(invoice?.status || "").toLowerCase();
    if (!invoice?.id || status === "cancelled" || status === "paid") return s;
    const totalDue = Math.max(0, (Number(invoice.grandTotal ?? invoice.amount ?? 0) || 0) - (Number(invoice.advanceDeducted ?? 0) || 0));
    return s + Math.max(0, totalDue - (Number(invoice.amountPaid) || 0));
  }, 0);

  // Run forecast for projected values
  const weekly = await computeForecast(clientId, "weekly");
  const daily = await computeForecast(clientId, "daily");

  // Projected closing in 7 days
  const p7 = weekly.periods[0]?.closingCash ?? currentCash;
  // Projected closing in 30 days
  const lastDaily = daily.periods[daily.periods.length - 1];
  const p30 = lastDaily?.closingCash ?? currentCash;

  return {
    currentAvailableCash: round2(currentCash),
    marketplaceValue: round2(marketplaceValue),
    expectedInflowsNext7Days: round2(totalInflows7d),
    expectedOutflowsNext7Days: round2(totalOutflows7d),
    totalRecurringExpensesNext7Days: round2(recurring7d),
    projectedClosingCashNext7Days: round2(p7),
    projectedClosingCashNext30Days: round2(p30),
    lowestProjectedCashDate: weekly.lowestProjectedCashDate,
    lowestProjectedCash: weekly.lowestProjectedCash,
    totalOverdueCollections: round2(overdueTotal),
    totalSupplierPaymentsDue: round2(supplierDue),
    totalPlannedPurchaseCommitments: round2(plannedCommitmentsTotal),
    confirmedSupplierPayables: round2(confirmedSupplierPayables),
    totalMarketplaceSettlementsPending: round2(pendingTotal),
    overdueCustomerReceipts: round2(overdueInvoiceReceipts),
    supplierPayables: round2(supplierPayables),
    poCommitments: round2(plannedCommitmentsTotal),
    plannedPurchaseOrders: round2(plannedPOs.reduce((sum: number, po: any) => sum + (Number(po.grandTotal) || 0), 0)),
    marketplaceInflowsNext7Days: round2(settlements7d),
    salesInflowsNext7Days: round2(invoiceInflows7d),
    recurringOutflowsNext7Days: round2(recurring7d),
    purchaseOutflowsNext7Days: round2(invoiceOutflows7d),
    cashStatus: weekly.cashStatus,
    alerts: weekly.alerts,
  };
}

/**
 * Dashboard summary for the cash command centre. `clientId` scopes it to one
 * operating account; omitted ⇒ portfolio-wide pooling (same rules as
 * `computeForecast`).
 */
export async function getSummary(
  clientId: string | undefined,
): Promise<CashCommandCentreSummary> {
  if (clientId) return getOwnerSummary(clientId);
  const owners = await cashDataOwners();
  if (owners.length === 0) {
    const now = new Date().toISOString().slice(0, 10);
    return {
      currentAvailableCash: 0,
      marketplaceValue: 0,
      expectedInflowsNext7Days: 0,
      expectedOutflowsNext7Days: 0,
      totalRecurringExpensesNext7Days: 0,
      projectedClosingCashNext7Days: 0,
      projectedClosingCashNext30Days: 0,
      lowestProjectedCashDate: now,
      lowestProjectedCash: 0,
      totalOverdueCollections: 0,
      totalSupplierPaymentsDue: 0,
      totalPlannedPurchaseCommitments: 0,
      confirmedSupplierPayables: 0,
      totalMarketplaceSettlementsPending: 0,
      overdueCustomerReceipts: 0,
      supplierPayables: 0,
      poCommitments: 0,
      plannedPurchaseOrders: 0,
      marketplaceInflowsNext7Days: 0,
      salesInflowsNext7Days: 0,
      recurringOutflowsNext7Days: 0,
      purchaseOutflowsNext7Days: 0,
      cashStatus: "GREEN",
      alerts: [],
    };
  }
  if (owners.length === 1) return getOwnerSummary(owners[0]);
  const summaries = await Promise.all(owners.map((id) => getOwnerSummary(id)));
  const base = summaries[0];
  const numericKeys = [
    "currentAvailableCash", "marketplaceValue", "expectedInflowsNext7Days",
    "expectedOutflowsNext7Days", "totalRecurringExpensesNext7Days",
    "projectedClosingCashNext7Days", "projectedClosingCashNext30Days",
    "lowestProjectedCash", "totalOverdueCollections", "totalSupplierPaymentsDue",
    "totalPlannedPurchaseCommitments", "confirmedSupplierPayables",
    "totalMarketplaceSettlementsPending", "overdueCustomerReceipts",
    "supplierPayables", "poCommitments", "plannedPurchaseOrders",
    "marketplaceInflowsNext7Days", "salesInflowsNext7Days",
    "recurringOutflowsNext7Days", "purchaseOutflowsNext7Days",
  ] as const;
  const merged: CashCommandCentreSummary = {
    ...base,
  };
  for (const key of numericKeys) {
    (merged as any)[key] = round2(
      summaries.reduce((s, x) => s + Number((x as any)[key] ?? 0), 0),
    );
  }
  merged.lowestProjectedCashDate = summaries
    .map((s) => s.lowestProjectedCashDate)
    .filter(Boolean)
    .sort()[0] ?? base.lowestProjectedCashDate;
  merged.cashStatus = merged.lowestProjectedCash < merged.currentAvailableCash
    ? "GREEN"
    : base.cashStatus;
  merged.alerts = summaries.flatMap((s, i) =>
    s.alerts.map((a) => ({ ...a, id: `${i}-${a.id}` })),
  );
  return merged;
}
