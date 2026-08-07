import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

// ---------------------------------------------------------------------------
// Audit log (entityType: "AuditLog")
//
// Immutable append-only trail of privileged actions (admin changes, role
// grants, reminder dispatches, failed logins). Written fire-and-forget so a
// logging failure can never take down an API request.
// ---------------------------------------------------------------------------

export interface AuditLogEntry {
  actorId: string | null;
  actorEmail: string | null;
  action: string; // e.g. "user.role_change", "auth.login_failed"
  target: string | null;
  detail?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  statusCode?: number;
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
