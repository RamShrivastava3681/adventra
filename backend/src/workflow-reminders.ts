import * as db from "./dynamodb.js";
import * as WorkflowTask from "./models/workflow-task.js";
import * as WorkflowSettings from "./models/workflow-settings.js";
import * as NotificationLog from "./models/notification-log.js";
import * as User from "./models/user.js";

/**
 * Workflow reminder worker (PDF-3 §6 "Notification Settings").
 *
 * Every run:
 *  1. Reminds tasks due within the configured window (default 24 h before the
 *     due date) — once per task per day.
 *  2. Reminds every overdue open task — daily, per the "overdueReminder"
 *     setting ("daily" | "off").
 *  3. Escalates overdue tasks to the configured escalation recipient (falls
 *     back to admins) — at most once per task per day.
 *
 * Emails are logged to the NotificationLog so the audit trail can prove
 * notification. Never throws — designed to run on an interval.
 */

let running = false;

/** Resolve recipient emails for an owner role, falling back to admins. */
async function resolveRecipients(
  clientId: string,
  ownerRole: string,
  assignedUser: string | null,
): Promise<string[]> {
  const emails = new Set<string>();
  if (assignedUser && assignedUser.includes("@")) emails.add(assignedUser.toLowerCase());
  try {
    const users = (await db.scanByType("User", { limit: 2000 })) as any[];
    for (const u of users) {
      const email = String(u?.email || "").trim().toLowerCase();
      if (!email.includes("@")) continue;
      if (u.clientId && clientId && u.clientId !== clientId) continue;
      const roles: string[] = Array.isArray(u.roles) ? u.roles : [];
      if (roles.includes(ownerRole) || roles.includes("factor_admin") || roles.includes("super_admin")) {
        emails.add(email);
      }
    }
  } catch (e) {
    console.error("  ⚠ Reminder recipient resolution failed:", e);
  }
  return Array.from(emails);
}

/** Resolve escalation recipients: configured address first, then admins. */
async function resolveEscalationRecipients(
  settings: WorkflowSettings.WorkflowSettings,
  clientId: string,
): Promise<string[]> {
  const emails = new Set<string>();
  if (settings.escalationEmail && settings.escalationEmail.includes("@")) {
    emails.add(settings.escalationEmail.toLowerCase());
  }
  // Always include admins so an unconfigured escalation still lands somewhere.
  for (const e of await resolveRecipients(clientId, "factor_admin", null)) {
    emails.add(e);
  }
  return Array.from(emails);
}

async function sendTaskEmail(params: {
  clientId: string;
  task: WorkflowTask.WorkflowTask;
  kind: "overdue" | "reminder" | "escalation";
  recipients: string[];
}): Promise<void> {
  const { task } = params;
  const subject =
    params.kind === "escalation"
      ? `ESCALATION — Overdue Task — ${task.requiredAction} — ${task.docNumber ?? task.docId}`
      : `Reminder — Task Due Soon — ${task.requiredAction} — ${task.docNumber ?? task.docId}`;
  const rows = [
    ["Task", task.requiredAction],
    ["Document", task.docNumber ?? task.docId],
    task.counterparty ? ["Customer / Supplier", task.counterparty] : null,
    ["Owner", task.ownerRole],
    ["Due Date", task.dueDate ?? "—"],
    ["Current Status", task.docStatus ?? "—"],
  ].filter(Boolean) as Array<[string, string]>;
  const html = `<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="font-weight:600;padding-right:12px;">${k}</td><td>${v}</td></tr>`,
    )
    .join("")}</table>
    <p style="margin-top:16px;">Open the platform to act on this task — no document data is included in this email beyond the reference above.</p>`;

  let sent = false;
  let error: string | null = null;
  try {
    const { sendWorkflowReminderEmail } = await import("./email.js");
    const result = await sendWorkflowReminderEmail({
      to: params.recipients,
      subject,
      html,
    });
    sent = result.sent;
    error = result.sent ? null : "suppressed or failed";
  } catch (e: any) {
    error = e?.message ?? "send failed";
  }
  await NotificationLog.log({
    clientId: task.clientId,
    kind: "overdue",
    taskId: task.id,
    docType: task.docType,
    docId: task.docId,
    docNumber: task.docNumber,
    recipients: params.recipients,
    subject,
    sent,
    error,
  }).catch(() => undefined);
  console.log(
    `  ⏰ ${params.kind} ${sent ? "emailed" : "suppressed"}: ${task.docNumber ?? task.docId} (${task.ownerRole})`,
  );
}

/** Dedupe flag: same kind may only fire once per task per calendar day. */
function alreadySentToday(task: WorkflowTask.WorkflowTask, kind: "reminder" | "overdue" | "escalation", today: string): boolean {
  if (kind === "reminder") return task.lastReminderDate === today;
  if (kind === "escalation") return task.lastEscalationDate === today;
  return task.lastReminderDate === today;
}

/**
 * One pass of the reminder worker. Returns counts for observability.
 * Safe to call repeatedly; every send is deduped per task per day.
 */
export async function runWorkflowReminders(): Promise<{
  remindedBeforeDue: number;
  remindedOverdue: number;
  escalated: number;
}> {
  if (running) return { remindedBeforeDue: 0, remindedOverdue: 0, escalated: 0 };
  running = true;
  try {
    const tasks = await WorkflowTask.listOpen(); // all clients — worker is global
    if (tasks.length === 0) return { remindedBeforeDue: 0, remindedOverdue: 0, escalated: 0 };

    const today = db.todayDate();
    // Settings cache — one read per client per pass.
    const settingsCache = new Map<string, WorkflowSettings.WorkflowSettings>();
    const getSettings = async (clientId: string) => {
      if (!settingsCache.has(clientId)) {
        const s = await WorkflowSettings.get(clientId).catch(
          () => ({ ...({} as WorkflowSettings.WorkflowSettings), reminderHoursBefore: 24, overdueReminder: "daily" as const }),
        );
        settingsCache.set(clientId, s);
      }
      return settingsCache.get(clientId)!;
    };

    let remindedBeforeDue = 0;
    let remindedOverdue = 0;
    let escalated = 0;

    for (const task of tasks) {
      try {
        const settings = await getSettings(task.clientId);
        const due = task.dueDate ? String(task.dueDate).slice(0, 10) : null;
        if (!due) continue;

        // 1) Reminder before due date (default 24 h window, once per day).
        const windowDays = Math.max(1, Math.ceil((Number(settings.reminderHoursBefore) || 24) / 24));
        if (due > today && due <= addDays(today, windowDays) && !alreadySentToday(task, "reminder", today)) {
          const recipients = await resolveRecipients(task.clientId, task.ownerRole, task.assignedUser);
          if (recipients.length > 0) {
            await sendTaskEmail({ clientId: task.clientId, task, kind: "reminder", recipients });
            await WorkflowTask.markReminded(task.id, today).catch(() => undefined);
            remindedBeforeDue++;
          }
          continue; // a due-soon task doesn't also need the overdue branch
        }

        // 2) Overdue reminder (daily when configured).
        if (due < today && !alreadySentToday(task, "overdue", today)) {
          if (settings.overdueReminder !== "off") {
            const recipients = await resolveRecipients(task.clientId, task.ownerRole, task.assignedUser);
            if (recipients.length > 0) {
              await sendTaskEmail({ clientId: task.clientId, task, kind: "overdue", recipients });
              remindedOverdue++;
            }
            // Mark even when recipients were empty so we don't retry all pass long.
            await WorkflowTask.markReminded(task.id, today).catch(() => undefined);
          }
        }

        // 3) Escalation for overdue tasks (once per task per day).
        if (due < today && !alreadySentToday(task, "escalation", today)) {
          const recipients = await resolveEscalationRecipients(settings, task.clientId);
          if (recipients.length > 0) {
            await sendTaskEmail({ clientId: task.clientId, task, kind: "escalation", recipients });
            await WorkflowTask.markEscalated(task.id, today).catch(() => undefined);
            escalated++;
          }
        }
      } catch (e) {
        console.error("  ⚠ Reminder pass failed for task:", task.id, e);
      }
    }

    if (remindedBeforeDue || remindedOverdue || escalated) {
      console.log(
        `  ⏰ Workflow reminders: ${remindedBeforeDue} due-soon, ${remindedOverdue} overdue, ${escalated} escalated`,
      );
    }
    return { remindedBeforeDue, remindedOverdue, escalated };
  } finally {
    running = false;
  }
}

function addDays(dateStr: string, days: number): string {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Start the hourly interval (aligned with the invoice reminder scheduler). */
export function startWorkflowReminderScheduler(intervalMs: number = 60 * 60 * 1000): void {
  console.log(`  ⏰ Workflow reminder scheduler started (interval: ${intervalMs / 60000}min)`);
  runWorkflowReminders().catch((err) => console.error("  ❌ Workflow reminder pass failed:", err));
  setInterval(() => {
    runWorkflowReminders().catch((err) => console.error("  ❌ Workflow reminder pass failed:", err));
  }, intervalMs);
}
