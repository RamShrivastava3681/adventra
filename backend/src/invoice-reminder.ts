import * as Invoice from "./models/invoice.js";
import * as PurchaseInvoice from "./models/purchase-invoice.js";
import * as Debtor from "./models/debtor.js";
import * as Vendor from "./models/vendor.js";
import * as Supplier from "./models/supplier.js";
import * as db from "./dynamodb.js";
import { sendInvoiceReminder, sendDebtorReminder, isEmailConfigured } from "./email.js";
import * as ReminderLog from "./models/reminder-log.js";
import { config } from "./config.js";
import * as ReminderSettings from "./models/reminder-settings.js";
import * as Alert from "./models/alert.js";

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
// Fire-and-forget automatic send for invoice create/update hooks.
// Respects the admin's reminder on/off setting — manual sends are unaffected.
// ---------------------------------------------------------------------------

export async function autoSendReminderOnChange(
  invoiceId: string,
  type: "sales" | "purchase"
): Promise<void> {
  try {
    if (!(await ReminderSettings.isEnabled())) return;
    await sendReminderForInvoice(invoiceId, type);
  } catch (err: any) {
    console.error(
      `  ⚠ Instant reminder trigger failed for ${type} invoice ${invoiceId}:`,
      err?.message ?? err
    );
  }
}

// ---------------------------------------------------------------------------
// In-app payment alerts — independent of SMTP and of the email on/off toggle
// ---------------------------------------------------------------------------

/** Days before the due date that raise a "payment due" alert (Treasury). */
const PAYMENT_DUE_ALERT_DAYS = [3, 0];
/** Days overdue at which the invoice is escalated to managers (once). */
const ESCALATION_OVERDUE_DAYS = 7;

interface AlertInvoice {
  id: string;
  invoiceNumber: string;
  amount: number;
  dueDate: string | null;
  status: string;
  clientId: string;
  counterpartyId: string;
  counterpartyType: "debtor" | "vendor";
  type: "sales" | "purchase";
}

/**
 * Existing alert keys so a run never raises the same alert twice:
 * payment_due once per invoice per day, overdue_escalation once per invoice.
 */
async function existingAlertKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  const alerts = await Alert.list().catch(() => [] as any[]);
  for (const a of alerts as any[]) {
    if (!a.invoiceId) continue;
    if (a.type === "payment_due") keys.add(`payment_due:${a.invoiceId}:${String(a.createdAt ?? "").slice(0, 10)}`);
    if (a.type === "overdue_escalation") keys.add(`overdue_escalation:${a.invoiceId}`);
  }
  return keys;
}

async function raisePaymentAlerts(inv: AlertInvoice, keys: Set<string>): Promise<number> {
  if (!inv.dueDate || isPaidOrClosed(inv.status) || inv.status === "draft") return 0;
  const dud = daysUntilDue(inv.dueDate);
  const label = inv.type === "sales" ? "Sales" : "Purchase";
  const amount = `₹${(Number(inv.amount) || 0).toLocaleString("en-IN")}`;
  let raised = 0;

  if (PAYMENT_DUE_ALERT_DAYS.includes(dud)) {
    const key = `payment_due:${inv.id}:${todayDate()}`;
    if (!keys.has(key)) {
      const cp = await resolveCounterparty(inv.counterpartyId, inv.counterpartyType);
      await Alert.create({
        clientId: inv.clientId,
        invoiceId: inv.id,
        debtorId: inv.counterpartyType === "debtor" ? inv.counterpartyId : null,
        type: "payment_due",
        severity: dud === 0 ? "warning" : "info",
        message: `Payment Due Alert: ${label} Invoice ${inv.invoiceNumber} (${amount}, ${cp.name}) is due ${dud === 0 ? "today" : `in ${dud} days`} (${inv.dueDate}). Treasury notified.`,
      }).catch((err) => console.error(`  ❌ Failed to create payment due alert for ${inv.invoiceNumber}:`, err));
      keys.add(key);
      raised++;
    }
  }

  if (dud <= -ESCALATION_OVERDUE_DAYS) {
    const key = `overdue_escalation:${inv.id}`;
    if (!keys.has(key)) {
      const cp = await resolveCounterparty(inv.counterpartyId, inv.counterpartyType);
      const message = `OVERDUE ESCALATION: ${label} Invoice ${inv.invoiceNumber} for ${amount} (${cp.name}) is overdue by ${Math.abs(dud)} days. Managerial review required.`;
      await Alert.create({
        clientId: inv.clientId,
        invoiceId: inv.id,
        debtorId: inv.counterpartyType === "debtor" ? inv.counterpartyId : null,
        type: "overdue_escalation",
        severity: "critical",
        message,
      }).catch((err) => console.error(`  ❌ Failed to create overdue escalation alert for ${inv.invoiceNumber}:`, err));
      keys.add(key);
      raised++;
      // Email the escalation recipients (configured manager + admins) — same
      // recipients as overdue workflow-task escalations. Skipped without SMTP.
      try {
        const [{ resolveEscalationRecipients }, WorkflowSettings, { sendWorkflowReminderEmail }] = await Promise.all([
          import("./workflow-reminders.js"),
          import("./models/workflow-settings.js"),
          import("./email.js"),
        ]);
        const settings = await WorkflowSettings.get(inv.clientId);
        const recipients = await resolveEscalationRecipients(settings, inv.clientId);
        await sendWorkflowReminderEmail({
          to: recipients,
          subject: `ESCALATION — ${label} invoice ${inv.invoiceNumber} overdue ${Math.abs(dud)} days`,
          html: `<p>${message}</p><p>Due date: ${inv.dueDate}. Open the platform to follow up.</p>`,
        });
      } catch (err) {
        console.error(`  ⚠ Escalation email failed for ${inv.invoiceNumber}:`, err);
      }
    }
  }
  return raised;
}

/** Raise payment-due / overdue-escalation alerts for every open invoice. */
export async function runPaymentAlerts(): Promise<{ raised: number }> {
  const keys = await existingAlertKeys();
  let raised = 0;
  try {
    for (const inv of await Invoice.list()) {
      raised += await raisePaymentAlerts({
        id: inv.id, invoiceNumber: inv.invoiceNumber, amount: inv.amount, dueDate: inv.dueDate,
        status: inv.status, clientId: inv.clientId, counterpartyId: inv.debtorId,
        counterpartyType: "debtor", type: "sales",
      }, keys);
    }
  } catch (err) {
    console.error("  ❌ Error raising sales invoice payment alerts:", err);
  }
  try {
    for (const inv of await PurchaseInvoice.list()) {
      raised += await raisePaymentAlerts({
        id: inv.id, invoiceNumber: inv.invoiceNumber, amount: inv.amount, dueDate: inv.dueDate,
        status: inv.status, clientId: inv.clientId, counterpartyId: inv.vendorId,
        counterpartyType: "vendor", type: "purchase",
      }, keys);
    }
  } catch (err) {
    console.error("  ❌ Error raising purchase invoice payment alerts:", err);
  }
  if (raised > 0) console.log(`  🔔 Payment alerts raised: ${raised}`);
  return { raised };
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
  /** Day offsets (days before due) that trigger an email — from admin settings. */
  scheduleDays: number[];
  /** Sales only: also email the customer directly (Reminder settings toggle). */
  sendToCustomer?: boolean;
  /** Sales only: what the customer still owes (net of advance + receipts). */
  balanceDue?: number;
}): Promise<boolean> {
  if (isPaidOrClosed(params.status)) return false;
  if (!params.dueDate) return false;

  const dud = daysUntilDue(params.dueDate);
  const isOverdue = dud < 0;

  // Automated schedule: 3 days before due (dud === 3), on due date (dud === 0), and 7 days overdue (dud === -7).
  // Also checks any admin-configured scheduleDays. Sends at most once per day.
  let shouldSend = false;

  if (params.lastReminderDate !== todayDate()) {
    if (isOverdue) {
      // 7 days overdue (or custom negative offsets in scheduleDays)
      shouldSend = dud === -7 || params.scheduleDays.includes(dud);
    } else {
      // 3 days before due date, on due date, or custom offsets in scheduleDays
      shouldSend = dud === 3 || dud === 0 || params.scheduleDays.includes(dud);
    }
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

  // Direct customer reminder (sales only, opt-in). Only invoices already
  // issued to the customer, with money still owed and an email on file.
  // Internal invoice notes are never included.
  let customerSent = false;
  const balance = params.balanceDue ?? params.amount;
  if (
    params.sendToCustomer &&
    params.type === "sales" &&
    !["draft", "pending"].includes(String(params.status).toLowerCase()) &&
    balance > 0.005 &&
    cp.email
  ) {
    customerSent = await sendDebtorReminder({
      invoiceNumber: params.invoiceNumber,
      amount: balance,
      dueDate: params.dueDate,
      issueDate: params.issueDate,
      counterpartyName: cp.name,
      counterpartyEmail: cp.email,
      daysUntilDue: dud,
      isOverdue,
      lineItems: params.lineItems,
      notes: null,
    });
    await ReminderLog.create({
      invoiceId: params.id,
      invoiceNumber: params.invoiceNumber,
      type: "sales",
      recipient: "debtor",
      recipientEmail: cp.email,
      daysUntilDue: dud,
      isOverdue,
      status: customerSent ? "sent" : "failed",
      counterpartyName: cp.name,
    }).catch((err) => console.error(`  ❌ Failed to create customer reminder log for ${params.invoiceNumber}:`, err));
  }

  // Record that we sent a reminder today (prevents duplicates — also stops the
  // hourly scheduler re-mailing the customer when only their copy went out).
  if (sent || customerSent) {
    try {
      const update = { lastOverdueReminderDate: todayDate() };
      if (params.type === "sales") {
        await Invoice.update(params.id, update);
      } else {
        await PurchaseInvoice.update(params.id, update);
      }
      // Create audit log entry
      if (sent) await ReminderLog.create({
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

  return sent || customerSent;
}

// ---------------------------------------------------------------------------
// Main reminder run — called once per day (or on demand)
// ---------------------------------------------------------------------------

export async function runDueDateReminders(): Promise<{ checked: number; sent: number; message?: string }> {
  // In-app alerts (payment due / overdue escalation) run even when email
  // is not configured or reminder emails are switched off.
  await runPaymentAlerts().catch((err) => console.error("  ❌ Payment alert run failed:", err));

  if (!isEmailConfigured()) {
    console.log("  ⚠ Invoice reminders skipped — SMTP not configured");
    return { checked: 0, sent: 0, message: "SMTP is not configured — cannot send reminders" };
  }

  const settings = await ReminderSettings.get();
  if (settings.enabled === false) {
    console.log("  ⚠ Invoice reminders skipped — automatic reminders are turned off");
    return { checked: 0, sent: 0, message: "Automatic reminders are turned off in Reminder settings" };
  }
  const scheduleDays = settings.scheduleDays?.length ? settings.scheduleDays : ReminderSettings.DEFAULT_SCHEDULE_DAYS;

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
        // Goods invoices keep their items in `lines`; legacy ones in `lineItems`.
        lineItems: inv.lineItems?.length
          ? inv.lineItems
          : (inv.lines ?? []).map((l) => ({
              description: l.name,
              quantity: Number(l.quantity) || 0,
              unitCost: Number(l.unitPrice) || 0,
              amount: Number(l.lineTotal) || 0,
            })),
        notes: inv.notes,
        type: "sales",
        scheduleDays,
        sendToCustomer: settings.sendToCustomer === true,
        balanceDue: Invoice.balanceOutstanding(inv),
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
        scheduleDays,
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
// Send a one-off reminder to customer (triggered by clicking the admin email link)
// ---------------------------------------------------------------------------

export async function sendReminderToDebtor(invoiceId: string, token: string): Promise<{ success: boolean; message: string }> {
  const inv = await Invoice.get(invoiceId);
  if (!inv) return { success: false, message: "Invoice not found" };
  if (inv.debtorReminderToken !== token) return { success: false, message: "Invalid or expired token" };
  if (isPaidOrClosed(inv.status)) return { success: false, message: "Invoice is already paid or closed" };

  const dud = daysUntilDue(inv.dueDate);
  const isOverdue = dud < 0;

  const cp = await resolveCounterparty(inv.debtorId, "debtor");
  if (!cp.email) return { success: false, message: `Customer ${cp.name} has no email address on file` };

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
    }).catch((err) => console.error(`  ❌ Failed to create customer reminder log:`, err));
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
