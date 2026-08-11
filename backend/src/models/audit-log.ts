import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

// ---------------------------------------------------------------------------
// Audit log (entityType: "AuditLog")
//
// Immutable append-only trail of privileged actions (admin changes, role
// grants, reminder dispatches, failed logins) and business/workflow actions
// (invoice created, checker approval, treasury funding…). Written
// fire-and-forget so a logging failure can never take down an API request.
// ---------------------------------------------------------------------------

export interface AuditLogEntry {
  actorId: string | null;
  actorEmail: string | null;
  action: string; // e.g. "user.role_change", "auth.login_failed", "invoice.approved"
  target: string | null;
  detail?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  statusCode?: number;
}

export interface StoredAuditLogEntry extends AuditLogEntry {
  id: string;
  createdAt: string;
}

/** Persist an audit event. Never throws — failures are logged and swallowed. */
export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    const id = uuid();
    const now = db.nowISO();
    await db.putItem({
      pk: `AUDIT#${id}`,
      sk: `AUDIT#${id}`,
      gsi1pk: `AUDIT#${entry.action}`,
      gsi1sk: `Audit#${now}`,
      gsi2pk: "AuditLog",
      gsi2sk: `Audit#${now}`,
      entityType: "AuditLog",
      id,
      ...entry,
      createdAt: now,
    });
  } catch (err) {
    console.error("[audit] Failed to persist audit log entry:", err);
  }
}

export interface WorkflowActor {
  userId?: string | null;
  email?: string | null;
  roles?: string[];
}

/**
 * Record a business/workflow action (invoice approved, treasury payment,
 * GRN confirmed…). Same immutable trail as privileged actions, tagged with
 * the acting user's roles so the UI can badge the event (checker / treasury /
 * admin).
 */
export async function writeWorkflowAction(
  actor: WorkflowActor | null,
  action: string,
  target: string | null,
  detail?: Record<string, unknown>,
  meta?: { ip?: string; userAgent?: string }
): Promise<void> {
  return writeAuditLog({
    actorId: actor?.userId ?? null,
    actorEmail: actor?.email ?? null,
    action,
    target,
    detail: { ...(detail ?? {}), actorRoles: actor?.roles ?? [] },
    ip: meta?.ip,
    userAgent: meta?.userAgent,
  });
}

/** List audit entries, newest first (bounded via GSI2 — never a full scan). */
export async function list(options?: { limit?: number }): Promise<StoredAuditLogEntry[]> {
  return (await db.queryByGSI2("AuditLog", {
    limit: options?.limit || 200,
    reverse: true,
  })) as StoredAuditLogEntry[];
}
