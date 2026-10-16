import * as db from "../dynamodb.js";

// ---------------------------------------------------------------------------
// ReminderSettings — global control for automatic invoice reminder emails
//
// Admins turn automatic reminders on/off and pick which due-date schedule the
// scheduler should mail on (e.g. 15 / 7 / 2 / 1 day(s) before the due date,
// and the due date itself). Manual sends ("Send Reminder") always work.
// ---------------------------------------------------------------------------

/** Day offsets (days before the due date) an admin may pick. 0 = due today, negative = days overdue. */
export const ALLOWED_REMINDER_DAYS = [-7, 0, 1, 2, 3, 7, 15, 30] as const;

/** Default schedule: 3 days before due, on due date, and 7 days overdue. */
export const DEFAULT_SCHEDULE_DAYS = [3, 0, -7];

export interface ReminderSettings {
  pk: string;
  sk: string;
  entityType: "ReminderSettings";
  id: "reminders";
  /** Master switch: when false no automatic reminder emails are sent. */
  enabled: boolean;
  /** Day offsets before the due date that trigger an email. */
  scheduleDays: number[];
  /**
   * Also email sales-invoice reminders straight to the customer's contact
   * email on the schedule days (admin still gets the usual copy). Off by
   * default — until enabled, customers are reminded only via the admin's
   * one-click forward link.
   */
  sendToCustomer?: boolean;
  updatedBy?: string | null;
  updatedAt: string;
}

const PK = "SETTINGS#REMINDERS";

export async function get(): Promise<ReminderSettings> {
  const item = await db.getItem(PK);
  if (item) {
    return item as ReminderSettings;
  }
  const now = db.nowISO();
  return {
    pk: PK,
    sk: PK,
    entityType: "ReminderSettings",
    id: "reminders",
    enabled: true,
    scheduleDays: [...DEFAULT_SCHEDULE_DAYS],
    sendToCustomer: false,
    updatedBy: null,
    updatedAt: now,
  };
}

/** True when automatic reminder emails may be sent (safe default: on). */
export async function isEnabled(): Promise<boolean> {
  try {
    const settings = await get();
    return settings.enabled !== false;
  } catch (err) {
    console.error("[reminders] Failed to read reminder settings:", err);
    return true;
  }
}

/** Normalize a raw schedule to valid, unique, sorted day offsets. */
export function normalizeScheduleDays(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const allowed: Set<number> = new Set(ALLOWED_REMINDER_DAYS);
  const days = [...new Set(raw.map(Number))].filter((d) => allowed.has(d));
  if (days.length === 0) return null;
  return days.sort((a, b) => a - b);
}

export async function update(data: {
  enabled?: boolean;
  scheduleDays?: number[];
  sendToCustomer?: boolean;
  updatedBy?: string | null;
}): Promise<ReminderSettings> {
  const current = await get();
  const next: ReminderSettings = {
    ...current,
    updatedAt: db.nowISO(),
  };
  if (data.enabled !== undefined) next.enabled = data.enabled === true;
  if (data.sendToCustomer !== undefined) next.sendToCustomer = data.sendToCustomer === true;
  if (data.scheduleDays !== undefined) {
    const normalized = normalizeScheduleDays(data.scheduleDays);
    if (!normalized) throw new Error("Choose at least one schedule day");
    next.scheduleDays = normalized;
  }
  if (data.updatedBy !== undefined) next.updatedBy = data.updatedBy ?? null;
  await db.putItem(next);
  return next;
}
