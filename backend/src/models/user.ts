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
  roles: string[];
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
      roles: ["client"],
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
    const allowed = ["companyName", "contactName", "email"];
    const updates: Record<string, any> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    updates.updatedAt = db.nowISO();
    const result = await db.updateItem(`USER#${req.user!.userId}`, `USER#${req.user!.userId}`, updates);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---- Admin: Role Management ----

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
