import { Router, Request, Response } from "express";
import { authMiddleware, AuthPayload } from "../middleware/auth.js";
import * as ewayBillService from "../services/eway-bill-service.js";
import * as EwayBill from "../models/eway-bill.js";
import * as EwbCredentials from "../services/eway-bill-credentials.js";
import { getDirectClient, EwbClientError } from "../services/eway-bill-direct-client.js";
import { ewayBillConfig } from "../config/eway-bill.js";

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// ── EWB Credential Management ────────────────────────────────────────────────

// GET /eway-bill-credentials — List EWB API configurations for this client
router.get("/eway-bill-credentials", async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).userId as string;
    const credentials = await EwbCredentials.list(clientId);

    // Strip sensitive fields from response — never expose secrets to frontend
    const safe = credentials.map((c) => ({
      id: c.id,
      gstin: c.gstin,
      apiClientId: c.apiClientId,
      apiUsername: c.apiUsername,
      environment: c.environment,
      onboardingStatus: c.onboardingStatus,
      lastAuthAt: c.lastAuthAt,
      lastAuthError: c.lastAuthError,
      lastTestedAt: c.lastTestedAt,
      isActive: c.isActive,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      // Mask sensitive fields
      clientSecret: c.encryptedClientSecret ? "••••••••" : "",
      apiPassword: c.encryptedApiPassword ? "••••••••" : "",
    }));

    res.json(safe);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /eway-bill-credentials/:id — Get single EWB API configuration
router.get("/eway-bill-credentials/:id", async (req: Request, res: Response) => {
  try {
    const cred = await EwbCredentials.get(req.params.id);
    if (!cred) return res.status(404).json({ error: "Configuration not found" });

    // Verify ownership
    const clientId = (req as any).userId as string;
    if (cred.clientId !== clientId) {
      return res.status(403).json({ error: "Access denied" });
    }

    // Strip sensitive fields
    res.json({
      id: cred.id,
      gstin: cred.gstin,
      apiClientId: cred.apiClientId,
      apiUsername: cred.apiUsername,
      environment: cred.environment,
      onboardingStatus: cred.onboardingStatus,
      lastAuthAt: cred.lastAuthAt,
      lastAuthError: cred.lastAuthError,
      lastTestedAt: cred.lastTestedAt,
      isActive: cred.isActive,
      createdAt: cred.createdAt,
      updatedAt: cred.updatedAt,
      clientSecret: cred.encryptedClientSecret ? "••••••••" : "",
      apiPassword: cred.encryptedApiPassword ? "••••••••" : "",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /eway-bill-credentials — Create new EWB API configuration
router.post("/eway-bill-credentials", async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).userId as string;
    const { gstin, apiClientId, clientSecret, apiUsername, apiPassword, environment } = req.body;

    // Validate required fields
    if (!gstin || !apiClientId || !clientSecret || !apiUsername || !apiPassword) {
      return res.status(400).json({
        error: "All fields are required: gstin, apiClientId, clientSecret, apiUsername, apiPassword",
      });
    }

    // Validate GSTIN format (15 characters)
    if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin)) {
      return res.status(400).json({ error: "Invalid GSTIN format" });
    }

    // Check if credential already exists for this GSTIN
    const existing = await EwbCredentials.getByClientIdAndGstin(clientId, gstin);
    if (existing) {
      return res.status(409).json({
        error: `E-Way Bill configuration already exists for GSTIN ${gstin}`,
      });
    }

    const credential = await EwbCredentials.create({
      clientId,
      gstin,
      apiClientId,
      clientSecret,
      apiUsername,
      apiPassword,
      environment: environment || "sandbox",
    });

    // Return safe response
    res.status(201).json({
      id: credential.id,
      gstin: credential.gstin,
      apiClientId: credential.apiClientId,
      apiUsername: credential.apiUsername,
      environment: credential.environment,
      onboardingStatus: credential.onboardingStatus,
      isActive: credential.isActive,
      createdAt: credential.createdAt,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /eway-bill-credentials/:id — Update EWB API configuration
router.put("/eway-bill-credentials/:id", async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).userId as string;
    const existing = await EwbCredentials.get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Configuration not found" });
    if (existing.clientId !== clientId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const { gstin, apiClientId, clientSecret, apiUsername, apiPassword, environment } = req.body;

    const updates: Partial<EwbCredentials.EwbCredential> = {};

    if (gstin !== undefined) {
      if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin)) {
        return res.status(400).json({ error: "Invalid GSTIN format" });
      }
      updates.gstin = gstin;
    }
    if (apiClientId !== undefined) updates.apiClientId = apiClientId;
    if (clientSecret !== undefined && clientSecret !== "••••••••") {
      updates.encryptedClientSecret = EwbCredentials.encryptAtRest(clientSecret);
    }
    if (apiUsername !== undefined) updates.apiUsername = apiUsername;
    if (apiPassword !== undefined && apiPassword !== "••••••••") {
      updates.encryptedApiPassword = EwbCredentials.encryptAtRest(apiPassword);
    }
    if (environment !== undefined) updates.environment = environment;

    const updated = await EwbCredentials.update(req.params.id, updates);

    res.json({
      id: updated?.id,
      gstin: updated?.gstin,
      apiClientId: updated?.apiClientId,
      apiUsername: updated?.apiUsername,
      environment: updated?.environment,
      onboardingStatus: updated?.onboardingStatus,
      isActive: updated?.isActive,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /eway-bill-credentials/:id — Delete EWB API configuration
router.delete("/eway-bill-credentials/:id", async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).userId as string;
    const existing = await EwbCredentials.get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Configuration not found" });
    if (existing.clientId !== clientId) {
      return res.status(403).json({ error: "Access denied" });
    }

    await EwbCredentials.remove(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /eway-bill-credentials/:id/test — Test connection to NIC API
router.post("/eway-bill-credentials/:id/test", async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).userId as string;
    const existing = await EwbCredentials.get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Configuration not found" });
    if (existing.clientId !== clientId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const client = getDirectClient();
    const result = await client.testConnection(existing.id);

    // Update last tested timestamp
    await EwbCredentials.update(existing.id, {
      lastTestedAt: new Date().toISOString(),
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /eway-bill-config — Get current EWB system configuration (public info)
router.get("/eway-bill-config", async (req: Request, res: Response) => {
  res.json({
    environment: ewayBillConfig.environment,
    threshold: ewayBillConfig.threshold,
    validityBands: ewayBillConfig.validityBands,
    productionPrerequisites: ewayBillConfig.productionPrerequisites,
  });
});

// ── E-Way Bill Lifecycle Endpoints ────────────────────────────────────────────

// GET /eway-bills — List E-Way Bills
router.get("/eway-bills", async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).userId as string;
    const status = req.query.status as string | undefined;
    const ewbs = await ewayBillService.listEwbs(clientId, status);
    res.json(ewbs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /eway-bills/:id — Get single E-Way Bill
router.get("/eway-bills/:id", async (req: Request, res: Response) => {
  try {
    const ewb = await EwayBill.get(req.params.id);
    if (!ewb) return res.status(404).json({ error: "E-Way Bill not found" });
    res.json(ewb);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /eway-bills — Generate E-Way Bill
router.post("/eway-bills", async (req: Request, res: Response) => {
  try {
    const {
      dispatchId,
      supplierGstin,
      recipientGstin,
      distance,
      transportMode,
      vehicleNumber,
      transporterGstin,
      transporterName,
    } = req.body;

    if (!dispatchId) {
      return res.status(400).json({ error: "dispatchId is required" });
    }

    const userId = (req as any).userId as string;
    const clientId = (req as any).userId as string;

    const result = await ewayBillService.generateEwb(
      {
        dispatchId,
        supplierGstin,
        recipientGstin,
        distance,
        transportMode,
        vehicleNumber,
        transporterGstin,
        transporterName,
        clientId,
      },
      userId,
    );

    res.status(201).json(result);
  } catch (err: any) {
    const message = err.message || "Failed to generate E-Way Bill";
    const status = message.includes("not found")
      ? 404
      : message.includes("already")
        ? 409
        : message.includes("below the") || message.includes("required")
          ? 400
          : 500;
    res.status(status).json({ error: message });
  }
});

// POST /eway-bills/:id/vehicle — Update Part-B (vehicle assignment)
router.post("/eway-bills/:id/vehicle", async (req: Request, res: Response) => {
  try {
    const { vehicleNumber, fromPlace, fromState, transportMode, reasonCode, reasonRemarks } =
      req.body;

    if (!vehicleNumber) {
      return res.status(400).json({ error: "vehicleNumber is required" });
    }

    const result = await ewayBillService.updatePartB({
      ewayBillId: req.params.id,
      vehicleNumber,
      fromPlace,
      fromState,
      transportMode,
      reasonCode,
      reasonRemarks,
    });

    res.json(result);
  } catch (err: any) {
    const message = err.message || "Failed to update vehicle";
    const status = message.includes("not found") ? 404 : 500;
    res.status(status).json({ error: message });
  }
});

// POST /eway-bills/:id/cancel — Cancel E-Way Bill
router.post("/eway-bills/:id/cancel", async (req: Request, res: Response) => {
  try {
    const { reason, remarks } = req.body;

    if (!reason || !remarks) {
      return res
        .status(400)
        .json({ error: "Both reason and remarks are required for cancellation" });
    }

    const result = await ewayBillService.cancelEwb({
      ewayBillId: req.params.id,
      reason,
      remarks,
    });

    res.json(result);
  } catch (err: any) {
    const message = err.message || "Failed to cancel E-Way Bill";
    const status = message.includes("not found") ? 404 : 500;
    res.status(status).json({ error: message });
  }
});

// POST /eway-bills/:id/extend — Extend Validity
router.post("/eway-bills/:id/extend", async (req: Request, res: Response) => {
  try {
    const { remainingDistance, reason, remarks } = req.body;

    const result = await ewayBillService.extendEwb({
      ewayBillId: req.params.id,
      remainingDistance,
      reason,
      remarks,
    });

    res.json(result);
  } catch (err: any) {
    const message = err.message || "Failed to extend E-Way Bill";
    const status = message.includes("not found") ? 404 : 500;
    res.status(status).json({ error: message });
  }
});

// POST /eway-bills/:id/sync — Sync status from NIC portal
router.post("/eway-bills/:id/sync", async (req: Request, res: Response) => {
  try {
    const updated = await ewayBillService.syncEwbStatus(req.params.id);
    res.json(updated);
  } catch (err: any) {
    const message = err.message || "Failed to sync E-Way Bill status";
    const status = message.includes("not found") ? 404 : 500;
    res.status(status).json({ error: message });
  }
});

// GET /eway-bills/dispatch/:dispatchId — Get EWB by dispatch ID
router.get(
  "/eway-bills/dispatch/:dispatchId",
  async (req: Request, res: Response) => {
    try {
      const ewb = await EwayBill.getByDispatchId(req.params.dispatchId);
      if (!ewb)
        return res
          .status(404)
          .json({ error: "No E-Way Bill found for this dispatch" });
      res.json(ewb);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

export default router;
