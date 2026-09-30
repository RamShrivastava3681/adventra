import { Request, Response, NextFunction } from "express";
import { logSecurityEvent } from "./security.js";

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const hasRole = roles.some((r) => req.user!.roles.includes(r));
    if (!hasRole) {
      logSecurityEvent("access.denied", req, {
        requiredRoles: roles,
        hasRoles: req.user!.roles,
        route: req.originalUrl,
      });
      return res.status(403).json({ error: `Requires one of: ${roles.join(", ")}` });
    }
    next();
  };
}

export const requireAdmin = requireRole("factor_admin");
// User-management & monitoring endpoints — only the super admin passes.
export const requireSuperAdmin = requireRole("super_admin");
export const requireChecker = requireRole("checker", "factor_admin");
export const requireTreasury = requireRole("treasury", "factor_admin");
export const requireCheckerOrTreasury = requireRole("checker", "treasury", "factor_admin");

// ─── Data-visibility scoping ──────────────────────────────────────────────────
// SHARED-DATABASE MODE: every authenticated user reads and works on the same
// portfolio. List handlers receive an `undefined` scope (scan the whole
// table) and per-record ownership guards (`clientId !== userId && !isStaff`)
// pass for everyone, so no user is ever shown a partial dataset.
//
// Role checks (`requireRole(...)`) are untouched — they still gate WHO may
// perform each action (checker approvals, treasury payments, admin screens).
// Only the DATA each caller can see/act on is shared.
const STAFF_ROLES = [
  "factor_admin",
  "super_admin",
  "checker",
  "treasury",
  "operations",
  "sales_rep",
  "reporting_manager",
];

/**
 * True for every authenticated caller in shared-database mode, so ownership
 * guards treat all users like platform staff (full-portfolio access).
 * STAFF_ROLES is kept for documentation of the platform-side roles.
 */
export function isStaffAccount(_roles: string[] | undefined): boolean {
  void STAFF_ROLES;
  return true;
}

/**
 * Effective client scope for GET list handlers. Always `undefined` (read the
 * whole shared portfolio) so every user sees the same database.
 */
export function effectiveListScope(_req: Request): string | undefined {
  return undefined;
}
