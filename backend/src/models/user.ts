import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuid } from "uuid";
import { config } from "../config.js";
import * as db from "../dynamodb.js";

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
}

// ---- Auth Routes ----

export async function signup(req: Request, res: Response) {
  try {
    const { email, password, companyName, contactName } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    // Check if exists
    const existing = await db.scanByType("User");
    const found = existing.find((u: any) => u.email === email);
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
      email,
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

    const token = jwt.sign(
      { userId: id, email, roles: user.roles },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn as any }
    );

    return res.status(201).json({
      token,
      user: {
        id,
        email,
        companyName: user.companyName,
        contactName: user.contactName,
        roles: user.roles,
      },
    });
  } catch (err: any) {
    console.error("[Auth] Signup error:", err);
    return res.status(500).json({ error: err.message || "Signup failed" });
  }
}

export async function login(req: Request, res: Response) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const users = await db.scanByType("User");
    const user = users.find((u: any) => u.email === email) as UserProfile | undefined;
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, roles: user.roles },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn as any }
    );

    return res.json({
      token,
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
    return res.status(500).json({ error: err.message || "Login failed" });
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
    const allowed = ["companyName", "contactName", "email", "photoUrl", "address", "phone"];
    const updates: Record<string, any> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    updates.updatedAt = db.nowISO();
    // Accept snake_case from frontend too
    if (req.body.photo_url !== undefined) updates.photoUrl = req.body.photo_url;
    const result = await db.updateItem(`USER#${req.user!.userId}`, `USER#${req.user!.userId}`, updates);
    const { passwordHash, ...safe } = result as any;
    return res.json(safe);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---- Admin: Role Management ----

export async function adminCreateUser(req: Request, res: Response) {
  try {
    const { email, password, contactName, role } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    // Check if exists
    const existing = await db.scanByType("User");
    const found = existing.find((u: any) => u.email === email);
    if (found) {
      return res.status(409).json({ error: "Email already registered" });
    }

    // Validate role
    const validRoles = ["sales_rep", "operations", "checker", "treasury", "reporting_manager", "factor_admin"];
    const assignedRole = validRoles.includes(role) ? role : "client";

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
      email,
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
    const safe = users.map((u: any) => {
      const { passwordHash, ...rest } = u;
      return rest;
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
        const { passwordHash, ...rest } = u;
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
        const { passwordHash, ...rest } = u;
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
    const item = await db.getItem(`USER#${userId}`);
    if (!item) return res.status(404).json({ error: "User not found" });

    let roles: string[] = (item as any).roles || [];
    if (add) {
      if (!roles.includes(role)) roles.push(role);
    } else {
      roles = roles.filter((r: string) => r !== role);
    }

    const result = await db.updateItem(`USER#${userId}`, `USER#${userId}`, { roles, updatedAt: db.nowISO() });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
