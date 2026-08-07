import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import { config } from "./config.js";
import routes from "./routes/index.js";
import * as db from "./dynamodb.js";
import { v4 as uuid } from "uuid";
import { startReminderScheduler } from "./invoice-reminder.js";
import { snakeCaseToCamelCase, camelCaseToSnakeCase } from "./middleware/transform.js";
import {
  requestLogger,
  sanitizeInput,
  noStore,
  apiErrorHandler,
  csrfOriginGuard,
} from "./middleware/security.js";
import { apiLimiter } from "./middleware/rate-limit.js";

// ─── Production startup guards ───────────────────────────────────────────────
// Refuse to boot with a guessable JWT secret or no secret at all.
if (config.isProduction) {
  const secret = process.env.JWT_SECRET || "";
  if (!secret || secret.length < 32 || secret === "dev-secret-change-in-production") {
    throw new Error(
      "Refusing to start in production: JWT_SECRET must be set to a random value of at least 32 characters."
    );
  }
}

const app = express();
app.disable("x-powered-by");

// Trust X-Forwarded-For only when the immediate peer is loopback (nginx in
// front, or dev on localhost). Direct clients can never spoof the header, so
// rate limiting sees the real client IP instead of one shared "127.0.0.1"
// bucket when deployed behind the bundled nginx config.
app.set("trust proxy", (ip: string) => ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1");

// ─── Security headers (Helmet) ───────────────────────────────────────────────
// HSTS is enabled only in production (the API is served over HTTP in dev).
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      "default-src": "'none'",
      "script-src": "'none'",
      "style-src": "'unsafe-inline'",
      "img-src": "'self' data:",
      "font-src": "'self'",
      "connect-src": "'self'",
      "object-src": "'none'",
      "base-uri": "'none'",
      "frame-ancestors": "'none'",
      "form-action": "'self'",
    },
  },
  strictTransportSecurity: config.isProduction
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
  referrerPolicy: { policy: "no-referrer" },
  crossOriginResourcePolicy: { policy: "same-site" },
}));

// Permissions-Policy (removed from helmet v7 — set explicitly).
app.use((_req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()"
  );
  next();
});

// ─── CORS ────────────────────────────────────────────────────────────────────
const allowedOrigins = config.corsOrigins;

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept", "Origin"],
  maxAge: 86400,
}));

// Parse the httpOnly session cookie so auth middleware can read it.
app.use(cookieParser());

// ─── Request limits ──────────────────────────────────────────────────────────
app.use(express.json({ limit: config.security.jsonBodyLimit }));
app.use(express.urlencoded({ extended: true, limit: config.security.urlencodedLimit }));

// ─── Access log + input sanitization ────────────────────────────────────────
app.use(requestLogger);
app.use(sanitizeInput);

// Field-name transformation: frontend sends snake_case, backend uses camelCase
app.use(snakeCaseToCamelCase);
app.use(camelCaseToSnakeCase);

// Health check (public, no cache)
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── API routes (CSRF origin guard + rate-limited backstop + no-cache) ───────
app.use("/api", csrfOriginGuard(allowedOrigins), apiLimiter, noStore, routes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Centralized error handler — generic to clients, detailed in server logs
app.use(apiErrorHandler);

// ---------------------------------------------------------------------------
// Admin seed — auto-create the admin user from .env credentials on startup
// ---------------------------------------------------------------------------
async function seedAdmin() {
  if (!config.admin.email || !config.admin.password) {
    console.log("  ⚠ No ADMIN_EMAIL / ADMIN_PASSWORD set — skipping admin seed");
    return;
  }

  try {
    const users = await db.scanByType("User");
    const existing = users.find((u: any) => u.email === config.admin.email);
    if (existing) {
      const roles: string[] = existing.roles || [];
      if (!roles.includes("factor_admin")) {
        roles.push("factor_admin");
        await db.updateItem(
          `USER#${existing.id}`,
          `USER#${existing.id}`,
          { roles, updatedAt: db.nowISO() }
        );
        console.log(`  ✅ Promoted ${config.admin.email} to factor_admin`);
      } else {
        console.log(`  ✅ Admin user ${config.admin.email} already exists`);
      }
      return;
    }

    const id = uuid();
    const now = db.nowISO();
    const passwordHash = await bcrypt.hash(config.admin.password, 12);

    const adminUser = {
      pk: `USER#${id}`,
      sk: `USER#${id}`,
      gsi1pk: `CLIENT#${id}`,
      gsi1sk: `User#${now}`,
      gsi2pk: "User",
      gsi2sk: `User#${id}`,
      entityType: "User",
      id,
      email: config.admin.email,
      passwordHash,
      companyName: "Insight Factor Admin",
      contactName: null,
      roles: ["factor_admin"],
      createdAt: now,
      updatedAt: now,
    };

    await db.putItem(adminUser);
    console.log(`  ✅ Admin user created: ${config.admin.email}`);
  } catch (err) {
    console.error("  ❌ Failed to seed admin user:", err);
  }
}

app.listen(config.port, async () => {
  console.log(`🚀 Insight Factor API running on port ${config.port}`);
  console.log(`   Environment: ${config.nodeEnv}`);
  await seedAdmin();
  
  // Start the invoice due-date reminder scheduler (checks every hour)
  startReminderScheduler().catch((err) =>
    console.error("  ❌ Failed to start reminder scheduler:", err)
  );

  // Recompute forecasts for all clients on startup so snapshots are always fresh
  recomputeAllForecastsOnStartup().catch((err) =>
    console.error("  ❌ Forecast recompute on startup failed:", err)
  );
});

// ---------------------------------------------------------------------------
// Forecast recompute on startup — runs async for every client that has data
// ---------------------------------------------------------------------------
async function recomputeAllForecastsOnStartup() {
  try {
    const { recomputeAll } = await import("./services/forecast-service.js");
    // Scan inventory entries (stock movements) instead of user accounts so we
    // only recompute forecasts for clients that actually have inventory data.
    const movements = await db.scanByType("StockMovement", { limit: 2000 });
    const clientIds = new Set<string>();
    for (const m of movements) {
      if (m.clientId) clientIds.add(m.clientId);
    }
    if (clientIds.size === 0) {
      console.log("  ⚠ No inventory entries found — skipping forecast recompute on startup");
      return;
    }
    console.log(`  🔄 Recomputing forecasts for ${clientIds.size} client(s) with inventory on startup…`);
    const results = await Promise.allSettled(
      Array.from(clientIds).map((clientId) => recomputeAll(clientId))
    );
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    const emoji = failed > 0 ? "⚠" : "✅";
    console.log(`  ${emoji} Forecast recompute complete: ${succeeded} succeeded, ${failed} failed`);
  } catch (err) {
    console.error("  ❌ Forecast recompute on startup error:", err);
  }
}

export default app;
