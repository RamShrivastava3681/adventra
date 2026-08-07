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
export const requireChecker = requireRole("checker", "factor_admin");
export const requireTreasury = requireRole("treasury", "factor_admin");
export const requireCheckerOrTreasury = requireRole("checker", "treasury", "factor_admin");
