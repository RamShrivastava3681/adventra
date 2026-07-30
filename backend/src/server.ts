import express from "express";
import cors from "cors";
import helmet from "helmet";
import bcrypt from "bcryptjs";
import { config } from "./config.js";
import routes from "./routes/index.js";
import * as db from "./dynamodb.js";
import { v4 as uuid } from "uuid";
import { startReminderScheduler } from "./invoice-reminder.js";
import { snakeCaseToCamelCase, camelCaseToSnakeCase } from "./middleware/transform.js";

const app = express();

// Middleware
app.use(helmet());
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",")
  : ["http://localhost:3000", "http://localhost:8080"];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));
app.use(express.json({ limit: "10mb" }));

// Field-name transformation: frontend sends snake_case, backend uses camelCase
app.use(snakeCaseToCamelCase);
app.use(camelCaseToSnakeCase);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// API routes
app.use("/api", routes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

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
});

export default app;
