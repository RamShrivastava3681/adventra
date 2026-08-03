import * as Invoice from "./models/invoice.js";
import * as PurchaseInvoice from "./models/purchase-invoice.js";
import * as Debtor from "./models/debtor.js";
import * as Vendor from "./models/vendor.js";
import * as Supplier from "./models/supplier.js";
import * as db from "./dynamodb.js";
import { sendInvoiceReminder, sendDebtorReminder, isEmailConfigured } from "./email.js";
import * as ReminderLog from "./models/reminder-log.js";
import { config } from "./config.js";

// ---------------------------------------------------------------------------
// Due-date reminder thresholds (days before due)
// ---------------------------------------------------------------------------
const REMINDER_DAYS = [15, 7, 2, 1, 0]; // 0 = due today

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysUntilDue(dueDate: string): number {
  const due = new Date(dueDate);
  const today = new Date(todayDate());
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}

function isPaidOrClosed(status: string): boolean {
  const closed = ["paid", "rejected", "refunded", "cancelled", "disputed"];
  return closed.includes(status.toLowerCase());
}

// ---------------------------------------------------------------------------
// Fetch full invoice + counterparty details for comprehensive emails
// ---------------------------------------------------------------------------

interface CounterpartyInfo {
  name: string;
  email: string | null;
}

async function resolveCounterparty(id: string, type: "debtor" | "vendor"): Promise<CounterpartyInfo> {
  try {
    if (type === "debtor") {
      const d = await Debtor.get(id);
      if (d) return { name: d.name, email: d.contactEmail };
    } else {
      const v = await Vendor.get(id);
      if (v) return { name: v.name, email: v.contactEmail || null };
      // Purchase invoices may reference the Supplier model (created via the
      // visible "Suppliers" page) instead of the Vendor model.
      const s = await Supplier.get(id);
      if (s) return { name: s.companyName, email: s.contactEmail || null };
    }
  } catch {
    // fall through
  }
  return { name: id, email: null };
}

// ---------------------------------------------------------------------------
// Public function: send reminder for a specific invoice by ID
// ---------------------------------------------------------------------------

/**
 * Manually send a reminder for a specific invoice — bypasses the automated
 * scheduler's day-threshold / once-per-day guards so that clicking
 * "Send Reminder" always dispatches the email.
 */
export async function sendReminderForInvoice(
  invoiceId: string,
  type: "sales" | "purchase"
): Promise<{ success: boolean; message: string }> {
  if (!isEmailConfigured()) {
    return { success: false, message: "SMTP not configured — cannot send reminders" };
  }

  try {
    let inv: any;
    if (type === "sales") {
      inv = await Invoice.get(invoiceId);
      if (!inv) return { success: false, message: "Invoice not found" };
    } else {
      inv = await PurchaseInvoice.get(invoiceId);
      if (!inv) return { success: false, message: "Purchase invoice not found" };
    }

    if (!inv.dueDate) return { success: false, message: "Invoice has no due date" };
    if (isPaidOrClosed(inv.status)) return { success: false, message: "Invoice is already paid or closed" };

    const dud = daysUntilDue(inv.dueDate);
    const isOverdue = dud < 0;

    // Resolve counterparty details
    const counterpartyId = type === "sales" ? inv.debtorId : inv.vendorId;
    const counterpartyType = type === "sales" ? "debtor" as const : "vendor" as const;
    const cp = await resolveCounterparty(counterpartyId, counterpartyType);

    const sent = await sendInvoiceReminder({
      type,
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      amount: inv.amount,
      subtotal: inv.subtotal ?? null,
      taxRate: inv.taxRate ?? 0,
      taxAmount: inv.taxAmount ?? 0,
      dueDate: inv.dueDate,
      issueDate: inv.issueDate,
      status: inv.status,
      clientName: config.admin.email || "Client",
      counterpartyId,
      counterpartyName: cp.name,
      counterpartyEmail: cp.email,
      lineItems: inv.lineItems ?? [],
      notes: inv.notes ?? null,
      daysUntilDue: dud,
      isOverdue,
      debtorReminderToken: type === "sales" ? (inv.debtorReminderToken ?? null) : null,
    });

    if (sent) {
      // Update last-reminder date on the invoice
      try {
        if (type === "sales") {
          await Invoice.update(inv.id, { lastOverdueReminderDate: todayDate() });
        } else {
          await PurchaseInvoice.update(inv.id, { lastOverdueReminderDate: todayDate() });
        }
      } catch (err) {
        console.error(`  ❌ Failed to update reminder date for ${type} invoice ${inv.invoiceNumber}:`, err);
      }

      // Create audit log entry
      try {
        await ReminderLog.create({
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          type,
          recipient: "admin",
          recipientEmail: config.admin.email || "",
          daysUntilDue: dud,
          isOverdue,
          status: "sent",
          counterpartyName: cp.name,
        });
      } catch (err) {
        console.error(`  ❌ Failed to create reminder log for ${inv.invoiceNumber}:`, err);
      }

      return { success: true, message: `Reminder sent for ${type} invoice ${inv.invoiceNumber}` };
    }

    return { success: false, message: "Failed to send email. Check SMTP configuration." };
  } catch (err: any) {
    return { success: false, message: `Error sending reminder: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// Process a single invoice (sales or purchase)
// ---------------------------------------------------------------------------

async function processInvoice(params: {
  id: string;
  invoiceNumber: string;
  amount: number;
  subtotal: number | null;
  taxRate: number;
  taxAmount: number;
  issueDate: string;
  dueDate: string;
  status: string;
  clientId: string;
  counterpartyId: string;
  counterpartyType: "debtor" | "vendor";
  lastReminderDate: string | null;
  debtorReminderToken: string | null;
  lineItems: Array<{ description?: string; quantity?: number; unitCost?: number; amount?: number; productId?: string }> | undefined | null;
  notes: string | null;
  type: "sales" | "purchase";
}): Promise<boolean> {
  if (isPaidOrClosed(params.status)) return false;
  if (!params.dueDate) return false;

  const dud = daysUntilDue(params.dueDate);
  const isOverdue = dud < 0;

  // Check if any reminder should be sent today
  let shouldSend = false;

  if (isOverdue) {
    if (params.lastReminderDate !== todayDate()) {
      shouldSend = true;
    }
  } else {
    shouldSend = REMINDER_DAYS.includes(dud);
  }

  if (!shouldSend) return false;

  // Resolve counterparty details
  const cp = await resolveCounterparty(params.counterpartyId, params.counterpartyType);

  // Send the reminder with full details
  const sent = await sendInvoiceReminder({
    type: params.type,
    invoiceId: params.id,
    invoiceNumber: params.invoiceNumber,
    amount: params.amount,
    subtotal: params.subtotal,
    taxRate: params.taxRate,
    taxAmount: params.taxAmount,
    dueDate: params.dueDate,
    issueDate: params.issueDate,
    status: params.status,
    clientName: config.admin.email || "Client",
    counterpartyId: params.counterpartyId,
    counterpartyName: cp.name,
    counterpartyEmail: cp.email,
    lineItems: params.lineItems,
    notes: params.notes,
    daysUntilDue: dud,
    isOverdue,
    debtorReminderToken: params.debtorReminderToken,
  });

  // Record that we sent a reminder today (prevents duplicates)
  if (sent) {
    try {
      const update = { lastOverdueReminderDate: todayDate() };
      if (params.type === "sales") {
        await Invoice.update(params.id, update);
      } else {
        await PurchaseInvoice.update(params.id, update);
      }
      // Create audit log entry
      await ReminderLog.create({
        invoiceId: params.id,
        invoiceNumber: params.invoiceNumber,
        type: params.type,
        recipient: "admin",
        recipientEmail: config.admin.email || "",
        daysUntilDue: dud,
        isOverdue,
        status: "sent",
        counterpartyName: cp.name,
      }).catch((err) => console.error(`  ❌ Failed to create reminder log for ${params.invoiceNumber}:`, err));
    } catch (err) {
      console.error(`  ❌ Failed to update reminder date for ${params.type} invoice ${params.invoiceNumber}:`, err);
    }
  }

  return sent;
}

// ---------------------------------------------------------------------------
// Main reminder run — called once per day (or on demand)
// ---------------------------------------------------------------------------

export async function runDueDateReminders(): Promise<{ checked: number; sent: number }> {
  if (!isEmailConfigured()) {
    console.log("  ⚠ Invoice reminders skipped — SMTP not configured");
    return { checked: 0, sent: 0 };
  }

  let checked = 0;
  let sent = 0;

  // --- Sales Invoices ---
  try {
    const invoices = await Invoice.list();
    for (const inv of invoices) {
      if (!inv.dueDate) continue;
      checked++;
      const wasSent = await processInvoice({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        amount: inv.amount,
        subtotal: inv.subtotal,
        taxRate: inv.taxRate,
        taxAmount: inv.taxAmount,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        status: inv.status,
        clientId: inv.clientId,
        counterpartyId: inv.debtorId,
        counterpartyType: "debtor",
        lastReminderDate: inv.lastOverdueReminderDate,
        debtorReminderToken: inv.debtorReminderToken,
        lineItems: inv.lineItems,
        notes: inv.notes,
        type: "sales",
      });
      if (wasSent) sent++;
    }
  } catch (err) {
    console.error("  ❌ Error processing sales invoice reminders:", err);
  }

  // --- Purchase Invoices ---
  try {
    const purchaseInvoices = await PurchaseInvoice.list();
    for (const inv of purchaseInvoices) {
      if (!inv.dueDate) continue;
      checked++;
      const wasSent = await processInvoice({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        amount: inv.amount,
        subtotal: null,
        taxRate: 0,
        taxAmount: 0,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        status: inv.status,
        clientId: inv.clientId,
        counterpartyId: inv.vendorId,
        counterpartyType: "vendor",
        lastReminderDate: inv.lastOverdueReminderDate,
        debtorReminderToken: null,
        lineItems: [],
        notes: inv.notes,
        type: "purchase",
      });
      if (wasSent) sent++;
    }
  } catch (err) {
    console.error("  ❌ Error processing purchase invoice reminders:", err);
  }

  console.log(`  📬 Due-date reminders: ${checked} checked, ${sent} sent`);

  return { checked, sent };
}

// ---------------------------------------------------------------------------
// Send a one-off reminder to debtor (triggered by clicking the admin email link)
// ---------------------------------------------------------------------------

export async function sendReminderToDebtor(invoiceId: string, token: string): Promise<{ success: boolean; message: string }> {
  const inv = await Invoice.get(invoiceId);
  if (!inv) return { success: false, message: "Invoice not found" };
  if (inv.debtorReminderToken !== token) return { success: false, message: "Invalid or expired token" };
  if (isPaidOrClosed(inv.status)) return { success: false, message: "Invoice is already paid or closed" };

  const dud = daysUntilDue(inv.dueDate);
  const isOverdue = dud < 0;

  const cp = await resolveCounterparty(inv.debtorId, "debtor");
  if (!cp.email) return { success: false, message: `Debtor ${cp.name} has no email address on file` };

  const sent = await sendDebtorReminder({
    invoiceNumber: inv.invoiceNumber,
    amount: inv.amount,
    dueDate: inv.dueDate,
    issueDate: inv.issueDate,
    counterpartyName: cp.name,
    counterpartyEmail: cp.email,
    daysUntilDue: dud,
    isOverdue,
    lineItems: inv.lineItems,
    notes: inv.notes,
  });

  if (sent) {
    // Invalidate the token so it can't be reused
    await Invoice.update(invoiceId, { debtorReminderToken: null });
    // Create audit log entry
    await ReminderLog.create({
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      type: "sales",
      recipient: "debtor",
      recipientEmail: cp.email,
      daysUntilDue: dud,
      isOverdue,
      status: "sent",
      counterpartyName: cp.name,
    }).catch((err) => console.error(`  ❌ Failed to create debtor reminder log:`, err));
    return { success: true, message: `Reminder sent to ${cp.name} at ${cp.email}` };
  }

  return { success: false, message: "Failed to send email. Check SMTP configuration." };
}

// ---------------------------------------------------------------------------
// Scheduled runner — checks every hour, but only acts once per day per invoice
// ---------------------------------------------------------------------------

let running = false;

export async function startReminderScheduler(intervalMs: number = 60 * 60 * 1000): Promise<void> {
  if (running) return;
  running = true;

  console.log(`  ⏰ Invoice reminder scheduler started (interval: ${intervalMs / 60000}min)`);

  await runDueDateReminders();

  setInterval(async () => {
    try {
      await runDueDateReminders();
    } catch (err) {
      console.error("  ❌ Reminder scheduler error:", err);
    }
  }, intervalMs);
}
