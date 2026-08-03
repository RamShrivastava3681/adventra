import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

export interface AuthPayload {
  userId: string;
  email: string;
  roles: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
      viewAsUserId?: string;
      originalUserId?: string;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }

  const token = header.replace("Bearer ", "");
  try {
    const payload = jwt.verify(token, config.jwt.secret) as AuthPayload & { iat: number; exp: number };
    // If the view-as middleware already impersonated a target user (it runs
    // before this per-route middleware), keep that identity intact — we only
    // validate the token here.
    if (req.viewAsUserId && req.user) {
      return next();
    }
    req.user = {
      userId: payload.userId,
      email: payload.email,
      roles: payload.roles || [],
    };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    try {
      const payload = jwt.verify(header.replace("Bearer ", ""), config.jwt.secret) as any;
      req.user = {
        userId: payload.userId,
        email: payload.email,
        roles: payload.roles || [],
      };
    } catch {
      // ignore invalid token for optional auth
    }
  }
  next();
}
