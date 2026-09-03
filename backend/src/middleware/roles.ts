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
// Roles that belong to the platform side (factor staff). Accounts holding any
// of these roles read across the whole portfolio, exactly like the shared
// dashboard (`scope=all`) already does. Accounts whose only role is "client"
// stay scoped to their own records.
const STAFF_ROLES = [
  "factor_admin",
  "super_admin",
  "checker",
  "treasury",
  "operations",
  "sales_rep",
  "reporting_manager",
];

/** True when the caller is platform staff rather than an end-client account. */
export function isStaffAccount(roles: string[] | undefined): boolean {
  return (roles ?? []).some((r) => STAFF_ROLES.includes(r));
}

/**
 * Effective client scope for GET list handlers. Returns `undefined` (read the
 * whole portfolio) for staff accounts and the caller's own user id for pure
 * "client" accounts, whose data must stay private to them.
 */
export function effectiveListScope(req: Request): string | undefined {
  const roles = req.user?.roles ?? [];
  return isStaffAccount(roles) ? undefined : req.user!.userId;
}
