import * as db from "../dynamodb.js";

/**
 * WorkflowSettings — notification preferences (PDF-3 §6 "Notification Settings").
 * One record per client; all-on defaults (v1 = immediate email on every
 * assignment, approval, rejection and overdue item).
 */

export interface WorkflowSettings {
  pk: string;
  sk: string;
  entityType: "WorkflowSettings";
  id: string;
  clientId: string;
  emailOnAssignment: boolean;
  emailOnApproval: boolean;
  emailOnRejection: boolean;
  reminderHoursBefore: number;
  overdueReminder: "daily" | "off";
  escalationEmail: string | null;
  dailySummary: boolean;
  updatedAt: string;
}

const DEFAULTS = {
  emailOnAssignment: true,
  emailOnApproval: true,
  emailOnRejection: true,
  reminderHoursBefore: 24,
  overdueReminder: "daily" as const,
  escalationEmail: null,
  dailySummary: false,
};

export async function get(clientId: string): Promise<WorkflowSettings> {
  const item = (await db.getItem(`WFSETTINGS#${clientId}`, `WFSETTINGS#${clientId}`)) as WorkflowSettings | null;
  if (item) return item;
  return {
    pk: `WFSETTINGS#${clientId}`,
    sk: `WFSETTINGS#${clientId}`,
    entityType: "WorkflowSettings",
    id: clientId,
    clientId,
    ...DEFAULTS,
    updatedAt: db.nowISO(),
  };
}

export async function update(clientId: string, updates: Partial<WorkflowSettings>): Promise<WorkflowSettings> {
  const allowed = ["emailOnAssignment", "emailOnApproval", "emailOnRejection", "reminderHoursBefore", "overdueReminder", "escalationEmail", "dailySummary"];
  const current = await get(clientId);
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  for (const k of allowed) {
    if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k];
  }
  if (current.pk) {
    await db.updateItem(current.pk, current.sk, patch);
    return get(clientId);
  }
  const item: WorkflowSettings = {
    pk: `WFSETTINGS#${clientId}`,
    sk: `WFSETTINGS#${clientId}`,
    entityType: "WorkflowSettings",
    id: clientId,
    clientId,
    ...DEFAULTS,
    ...patch,
  } as WorkflowSettings;
  await db.putItem(item);
  return item;
}
