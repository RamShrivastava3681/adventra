import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuid } from "uuid";
import { config } from "../config.js";
import * as db from "../dynamodb.js";
import { TOKEN_ISSUER, TOKEN_AUDIENCE, setAuthCookie } from "../middleware/auth.js";
import { logSecurityEvent } from "../middleware/security.js";
import { recordLogin } from "../services/presence.js";

// ---- Input validation helpers ----

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL = 254;
const MAX_PASSWORD = 128;
const MIN_PASSWORD = 6;
const KNOWN_ROLES = [
  "client",
  "sales_rep",
  "operations",
  "checker",
  "treasury",
  "reporting_manager",
  "factor_admin",
  "super_admin",
];

// Roles an admin may assign when creating a user. super_admin is never
// assignable — the super admin account is designated via SUPER_ADMIN_EMAIL
// (defaults to ADMIN_EMAIL) and seeded at startup.
const ASSIGNABLE_ROLES = KNOWN_ROLES.filter((r) => r !== "super_admin");

function validateEmail(value: unknown): string | null {
  if (typeof value !== "string") return "Email is required";
  const email = value.trim();
  if (!email || email.length > MAX_EMAIL || !EMAIL_RE.test(email)) {
    return "A valid email address is required";
  }
  return null;
}

function validatePassword(value: unknown): string | null {
  if (typeof value !== "string") return "Password is required";
  if (value.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters`;
  if (value.length > MAX_PASSWORD) return `Password must be at most ${MAX_PASSWORD} characters`;
  return null;
}

function clampString(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return "Must be a string";
  if (value.length > max) return `Must be at most ${max} characters`;
  return null;
}

function issueToken(user: { id: string; email: string; roles: string[] }): string {
  return jwt.sign(
    { userId: user.id, email: user.email, roles: user.roles },
    config.jwt.secret,
    {
      expiresIn: config.jwt.expiresIn as any,
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
      jwtid: uuid(),
    }
  );
}

// ---- Types ----

export interface UserProfile {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  gsi2pk: string;
  gsi2sk: string;
  entityType: "User";
  id: string;
  email: string;
  passwordHash: string;
  companyName: string;
  contactName: string | null;
  photoUrl: string | null;
  address: string | null;
  phone: string | null;
  roles: string[];
  reportingManagerId: string | null;
  createdAt: string;
  updatedAt: string;
  // Presence tracking (super-admin view): last activity + IP geolocation.
  lastSeenAt?: string | null;
  lastSeenIp?: string | null;
  lastSeenGeo?: { country: string; region: string; city: string } | null;
}

// ---- Auth Routes ----

export async function signup(req: Request, res: Response) {
  try {
    const { email, password, companyName, contactName } = req.body || {};

    // Strict input validation (types, formats, lengths) before any work.
    const emailErr = validateEmail(email);
    if (emailErr) return res.status(400).json({ error: emailErr });
    const passwordErr = validatePassword(password);
    if (passwordErr) return res.status(400).json({ error: passwordErr });
    const companyErr = clampString(companyName, 200);
    if (companyErr) return res.status(400).json({ error: `companyName ${companyErr}` });
    const contactErr = clampString(contactName, 200);
    if (contactErr) return res.status(400).json({ error: `contactName ${contactErr}` });

    const normalizedEmail = email.trim().toLowerCase();

    // Check if exists
    const existing = await db.scanByType("User");
    const found = existing.find((u: any) => String(u.email || "").toLowerCase() === normalizedEmail);
    if (found) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const id = uuid();
    const now = db.nowISO();
    const passwordHash = await bcrypt.hash(password, 12);

    const user: UserProfile = {
      pk: `USER#${id}`,
      sk: `USER#${id}`,
      gsi1pk: `CLIENT#${id}`,
      gsi1sk: `User#${now}`,
      gsi2pk: "User",
      gsi2sk: `User#${id}`,
      entityType: "User",
      id,
      email: normalizedEmail,
      passwordHash,
      companyName: companyName || "",
      contactName: contactName || null,
      photoUrl: null,
      address: null,
      phone: null,
      roles: ["client"],
      reportingManagerId: null,
      createdAt: now,
      updatedAt: now,
    };

    await db.putItem(user);

    // Signup does NOT create a session — the user signs in explicitly, so no
    // token and no cookie is issued here (matches the current UI flow).
    return res.status(201).json({
      user: {
        id,
        email: normalizedEmail,
        companyName: user.companyName,
        contactName: user.contactName,
        roles: user.roles,
      },
    });
  } catch (err: any) {
    console.error("[Auth] Signup error:", err);
    return res.status(500).json({ error: "Signup failed" });
  }
}

export async function login(req: Request, res: Response) {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ error: "Email and password required" });
    }
    if (email.length > MAX_EMAIL || password.length > MAX_PASSWORD) {
      // Opaque response — never reveal why a login was rejected.
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const users = await db.scanByType("User");
    const user = users.find((u: any) => String(u.email || "").toLowerCase() === email.trim().toLowerCase()) as UserProfile | undefined;
    if (!user) {
      logSecurityEvent("auth.login_failed", req, { reason: "user_not_found" });
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      logSecurityEvent("auth.login_failed", req, { reason: "wrong_password" });
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = issueToken(user);
    // The JWT lives in an httpOnly, SameSite=Strict cookie — client JS can
    // never read it, so XSS cannot exfiltrate the session.
    setAuthCookie(res, token);

    // Record last-seen + IP presence (fire-and-forget, never blocks login).
    recordLogin(user.id, req.ip);

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        companyName: user.companyName,
        contactName: user.contactName,
        roles: user.roles,
      },
    });
  } catch (err: any) {
    console.error("[Auth] Login error:", err);
    return res.status(500).json({ error: "Login failed" });
  }
}

export async function getProfile(req: Request, res: Response) {
  try {
    const item = await db.getItem(`USER#${req.user!.userId}`);
    if (!item) return res.status(404).json({ error: "User not found" });
    const { passwordHash, ...profile } = item as any;
    return res.json(profile);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function updateProfile(req: Request, res: Response) {
  try {
    const body = req.body || {};
    const allowed = ["companyName", "contactName", "email", "photoUrl", "address", "phone"];
    const updates: Record<string, any> = {};
    for (const key of allowed) {
      if (body[key] !== undefined) updates[key] = body[key];
    }
    // Accept snake_case from frontend too
    if (body.photo_url !== undefined) updates.photoUrl = body.photo_url;

    // Validate anything that is actually changing.
    if (updates.email !== undefined) {
      const errMsg = validateEmail(updates.email);
      if (errMsg) return res.status(400).json({ error: errMsg });
      updates.email = String(updates.email).trim().toLowerCase();
      // NOTE: JWTs are stateless, so previously issued tokens remain valid after
      // an email change. Full revocation requires a token-version/denylist check
      // (see SECURITY-AUDIT.md); this event is recorded for manual review.
      logSecurityEvent("auth.email_changed", req, { userId: req.user!.userId });
    }
    for (const key of ["companyName", "contactName", "address", "phone", "photoUrl"] as const) {
      if (updates[key] !== undefined) {
        const errMsg = clampString(updates[key], 500);
        if (errMsg) return res.status(400).json({ error: `${key} ${errMsg}` });
      }
    }

    updates.updatedAt = db.nowISO();
    const result = await db.updateItem(`USER#${req.user!.userId}`, `USER#${req.user!.userId}`, updates);
    const { passwordHash, ...safe } = result as any;
    return res.json(safe);
  } catch (err: any) {
    return res.status(500).json({ error: "Failed to update profile" });
  }
}

// ---- Admin: Role Management ----

export async function adminCreateUser(req: Request, res: Response) {
  try {
    const { email, password, contactName, role } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }
    const emailErr = validateEmail(email);
    if (emailErr) return res.status(400).json({ error: emailErr });
    const passwordErr = validatePassword(password);
    if (passwordErr) return res.status(400).json({ error: passwordErr });

    const normalizedEmail = email.trim().toLowerCase();

    // Check if exists
    const existing = await db.scanByType("User");
    const found = existing.find((u: any) => String(u.email || "").toLowerCase() === normalizedEmail);
    if (found) {
      return res.status(409).json({ error: "Email already registered" });
    }

    // Validate role — super_admin can never be granted through user creation.
    const assignedRole = ASSIGNABLE_ROLES.includes(role) ? role : "client";

    // Validate managerId if provided
    if (req.body.managerId) {
      const manager = await db.getItem(`USER#${req.body.managerId}`);
      if (!manager) {
        return res.status(404).json({ error: "Reporting manager not found" });
      }
      const mgrRoles: string[] = (manager as any).roles || [];
      if (!mgrRoles.includes("reporting_manager")) {
        return res.status(400).json({ error: "Selected user is not a reporting manager" });
      }
    }

    const id = uuid();
    const now = db.nowISO();
    const passwordHash = await bcrypt.hash(password, 12);

    const user: UserProfile = {
      pk: `USER#${id}`,
      sk: `USER#${id}`,
      gsi1pk: `CLIENT#${id}`,
      gsi1sk: `User#${now}`,
      gsi2pk: "User",
      gsi2sk: `User#${id}`,
      entityType: "User",
      id,
      email: normalizedEmail,
      passwordHash,
      companyName: contactName || "",
      contactName: contactName || null,
      photoUrl: null,
      address: null,
      phone: null,
      roles: [assignedRole],
      reportingManagerId: req.body.managerId || null,
      createdAt: now,
      updatedAt: now,
    };

    await db.putItem(user);

    const { passwordHash: _, ...safe } = user;
    return res.status(201).json(safe);
  } catch (err: any) {
    console.error("[Admin] Create user error:", err);
    return res.status(500).json({ error: err.message || "Failed to create user" });
  }
}

export async function getUsers(req: Request, res: Response) {
  try {
    const users = await db.scanByType("User");
    // Presence/location fields (last-seen time, IP, geo) are private — only the
    // super admin may see them for other users.
    const isSuperAdmin = (req.user?.roles ?? []).includes("super_admin");
    const safe = users.map((u: any) => {
      const { passwordHash, ...rest } = u;
      if (isSuperAdmin) return rest;
      const { lastSeenAt, lastSeenIp, lastSeenGeo, ...noPresence } = rest;
      return noPresence;
    });
    return res.json(safe);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---- Admin: Reporting Manager ----

export async function assignManager(req: Request, res: Response) {
  try {
    const { userId } = req.params;
    const { managerId } = req.body;

    const item = await db.getItem(`USER#${userId}`);
    if (!item) return res.status(404).json({ error: "User not found" });

    // If setting a manager, verify the manager exists and has reporting_manager role
    if (managerId) {
      const manager = await db.getItem(`USER#${managerId}`);
      if (!manager) return res.status(404).json({ error: "Reporting manager not found" });
      const managerRoles: string[] = (manager as any).roles || [];
      if (!managerRoles.includes("reporting_manager")) {
        return res.status(400).json({ error: "Selected user is not a reporting manager" });
      }
    }

    const result = await db.updateItem(`USER#${userId}`, `USER#${userId}`, {
      reportingManagerId: managerId || null,
      updatedAt: db.nowISO(),
    });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function listManagers(req: Request, res: Response) {
  try {
    const users = await db.scanByType("User");
    const managers = users
      .filter((u: any) => (u.roles || []).includes("reporting_manager"))
      .map((u: any) => {
        const { passwordHash, lastSeenAt, lastSeenIp, lastSeenGeo, ...rest } = u;
        return rest;
      });
    return res.json(managers);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getReports(req: Request, res: Response) {
  try {
    const { managerId } = req.params;
    const users = await db.scanByType("User");
    const reports = users
      .filter((u: any) => u.reportingManagerId === managerId)
      .map((u: any) => {
        const { passwordHash, lastSeenAt, lastSeenIp, lastSeenGeo, ...rest } = u;
        return rest;
      });
    return res.json(reports);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---- View-As middleware helper ----
export async function getViewAsTarget(managerUserId: string, targetUserId: string): Promise<any | null> {
  const target = await db.getItem(`USER#${targetUserId}`);
  if (!target) return null;
  if ((target as any).reportingManagerId !== managerUserId) return null;
  const { passwordHash, ...safe } = target as any;
  return safe;
}

export async function updateUserRole(req: Request, res: Response) {
  try {
    const { userId, role, add } = req.body;
    if (!KNOWN_ROLES.includes(role)) {
      return res.status(400).json({ error: `Unknown role: ${role}` });
    }
    const item = await db.getItem(`USER#${userId}`);
    if (!item) return res.status(404).json({ error: "User not found" });

    // super_admin is reserved for the account designated by SUPER_ADMIN_EMAIL
    // (defaults to ADMIN_EMAIL) — it can't be granted to anyone else, and it
    // can't be revoked from the primary super admin (prevents lock-out).
    const canonicalEmail = (config.superAdmin.email ?? "").toLowerCase();
    const targetEmail = String((item as any).email ?? "").toLowerCase();
    if (role === "super_admin") {
      if (add && targetEmail !== canonicalEmail) {
        return res
          .status(400)
          .json({ error: "The super_admin role can only be granted to the designated super admin" });
      }
      if (!add && canonicalEmail && targetEmail === canonicalEmail) {
        return res
          .status(400)
          .json({ error: "The primary super admin role cannot be revoked" });
      }
    }

    let roles: string[] = (item as any).roles || [];
    if (add) {
      if (!roles.includes(role)) roles.push(role);
    } else {
      roles = roles.filter((r: string) => r !== role);
    }

    const result = await db.updateItem(`USER#${userId}`, `USER#${userId}`, { roles, updatedAt: db.nowISO() });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: "Failed to update user role" });
  }
}

// ---- Admin: Delete user (super admin only) ----

export async function adminDeleteUser(req: Request, res: Response) {
  try {
    const { userId } = req.params;
    const item = await db.getItem(`USER#${userId}`);
    if (!item) return res.status(404).json({ error: "User not found" });
    const target = item as any;

    // Guard rails: never allow deleting yourself or the designated super admin
    // (otherwise the platform could be left without any account manager).
    if (target.id === req.user!.userId) {
      return res.status(400).json({ error: "You cannot delete your own account" });
    }
    const canonicalEmail = (config.superAdmin.email ?? "").toLowerCase();
    if (canonicalEmail && String(target.email ?? "").toLowerCase() === canonicalEmail) {
      return res
        .status(400)
        .json({ error: "The designated super admin account cannot be deleted" });
    }

    await db.deleteItem(`USER#${userId}`);
    logSecurityEvent("user.deleted", req, {
      targetUserId: userId,
      targetEmail: target.email ?? null,
    });
    return res.json({ success: true, id: userId });
  } catch (err: any) {
    console.error("[Admin] Delete user error:", err);
    return res.status(500).json({ error: err.message || "Failed to delete user" });
  }
}
