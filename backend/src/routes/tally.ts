import { Router, Request, Response } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import * as Tally from "../models/tally.js";
import * as engine from "../services/tally/engine.js";
import { generateValidationErrorReportCsv } from "../services/tally/manifestService.js";
import { parseTallyXml, matchAndClassifyStaged } from "../services/tally/reverseImport.js";

const router = Router();
const EXPORT_TYPES: Tally.TallyExportType[] = [
  "customers",
  "suppliers",
  "stock-items",
  "units",
  "ledgers",
  "sales",
  "purchases",
  "receipts",
  "payments",
  "credit-notes",
  "debit-notes",
];

const CAN_EXPORT = requireRole("factor_admin", "super_admin", "operations", "treasury", "checker");

function clientId(req: Request): string {
  return req.user!.userId;
}

function configClientId(_req: Request): string {
  // Tally setup is shared across staff; business records remain user scoped.
  return "shared";
}

function isExportType(value: unknown): value is Tally.TallyExportType {
  return typeof value === "string" && EXPORT_TYPES.includes(value as Tally.TallyExportType);
}

function handleError(res: Response, err: any, fallback: string) {
  const status = Number(err?.status) || 500;
  if (status >= 500) console.error(`[tally] ${fallback}`, err);
  res.status(status).json({ error: err?.message || fallback });
}

function publicRecord(rec: engine.PreparedRecord) {
  return {
    sourceId: rec.sourceId,
    sourceLabel: rec.sourceLabel,
    docNumber: rec.docNumber,
    date: rec.date,
    party: rec.party,
    voucherType: rec.voucherType,
    amount: rec.amount,
    status: rec.status,
    errors: rec.errors,
    warnings: rec.warnings,
    totals: rec.totals,
    contentHash: rec.contentHash,
    exportedStatus: rec.exportedStatus ?? null,
    lastBatchId: rec.lastBatchId ?? null,
    exportedAt: rec.exportedAt ?? null,
  };
}

// ─── Configuration ──────────────────────────────────────────────────────────

router.get("/tally/config", authMiddleware, async (req, res) => {
  try {
    const config = await Tally.getConfig(configClientId(req));
    res.json({
      configured: !!config?.companyName,
      config: config ?? null,
      suggested: Tally.SUGGESTED_MAPPING,
      emptyMapping: Tally.EMPTY_MAPPING,
    });
  } catch (err) {
    handleError(res, err, "Failed to load Tally configuration");
  }
});

router.put("/tally/config", authMiddleware, CAN_EXPORT, async (req, res) => {
  try {
    const body = req.body ?? {};
    const config = await Tally.saveConfig(configClientId(req), body, req.user?.email ?? null);
    res.json({ config });
  } catch (err) {
    handleError(res, err, "Failed to save Tally configuration");
  }
});

// ─── Overview & Dashboard ───────────────────────────────────────────────────

router.get(["/tally/overview", "/tally/dashboard"], authMiddleware, async (req, res) => {
  try {
    const data = await engine.getDashboardOverview(clientId(req));
    res.json(data);
  } catch (err) {
    handleError(res, err, "Failed to load Tally overview");
  }
});

// ─── Explicit Master Export APIs ────────────────────────────────────────────

router.get("/tally/masters/customers", authMiddleware, async (req, res) => {
  try {
    const records = await engine.listSelectable(clientId(req), "customers");
    res.json({ exportType: "customers", label: "Customers", records });
  } catch (err) {
    handleError(res, err, "Failed to list customer masters");
  }
});

router.get("/tally/masters/suppliers", authMiddleware, async (req, res) => {
  try {
    const records = await engine.listSelectable(clientId(req), "suppliers");
    res.json({ exportType: "suppliers", label: "Suppliers", records });
  } catch (err) {
    handleError(res, err, "Failed to list supplier masters");
  }
});

router.get("/tally/masters/stock-items", authMiddleware, async (req, res) => {
  try {
    const records = await engine.listSelectable(clientId(req), "stock-items");
    res.json({ exportType: "stock-items", label: "Stock Items", records });
  } catch (err) {
    handleError(res, err, "Failed to list stock item masters");
  }
});

router.get("/tally/masters/units", authMiddleware, async (req, res) => {
  try {
    const records = await engine.listSelectable(clientId(req), "units");
    res.json({ exportType: "units", label: "Units of Measure", records });
  } catch (err) {
    handleError(res, err, "Failed to list unit masters");
  }
});

router.get("/tally/masters/ledgers", authMiddleware, async (req, res) => {
  try {
    const records = await engine.listSelectable(clientId(req), "ledgers");
    res.json({ exportType: "ledgers", label: "Account Ledgers", records });
  } catch (err) {
    handleError(res, err, "Failed to list account ledgers");
  }
});

router.post("/tally/masters/export", authMiddleware, CAN_EXPORT, async (req, res) => {
  try {
    const { masterType, ids, force } = req.body ?? {};
    const exportType = (masterType || req.body.exportType) as Tally.TallyExportType;
    if (!["customers", "suppliers", "stock-items", "units", "ledgers"].includes(exportType)) {
      return res.status(400).json({ error: "Invalid master export type" });
    }
    const result = await engine.generateBatch({
      clientId: clientId(req),
      exportType,
      ids: Array.isArray(ids) ? ids : undefined,
      force: !!force,
      generatedBy: req.user?.email ?? null,
    });
    if (result.validationFailed) {
      return res.status(422).json({
        error: "Validation failed - fix the highlighted masters before exporting.",
        records: result.records.map(publicRecord),
        errors: result.errors,
      });
    }
    res.status(201).json({
      batch: result.batch,
      preview: result.xml.slice(0, 15000),
      partialExport: result.partialExport,
      blockedCount: result.blockedCount,
      blockedRecords: result.blockedRecords.map(publicRecord),
    });
  } catch (err) {
    handleError(res, err, "Failed to export masters");
  }
});

// ─── Explicit Transaction Export APIs ───────────────────────────────────────

router.get("/tally/transactions/sales", authMiddleware, async (req, res) => {
  try {
    const records = await engine.listSelectable(clientId(req), "sales");
    res.json({ exportType: "sales", label: "Sales Invoices", records });
  } catch (err) {
    handleError(res, err, "Failed to list sales invoices");
  }
});

router.get("/tally/transactions/purchases", authMiddleware, async (req, res) => {
  try {
    const records = await engine.listSelectable(clientId(req), "purchases");
    res.json({ exportType: "purchases", label: "Purchase Invoices", records });
  } catch (err) {
    handleError(res, err, "Failed to list purchase invoices");
  }
});

router.get("/tally/transactions/receipts", authMiddleware, async (req, res) => {
  try {
    const records = await engine.listSelectable(clientId(req), "receipts");
    res.json({ exportType: "receipts", label: "Receipts", records });
  } catch (err) {
    handleError(res, err, "Failed to list receipts");
  }
});

router.get("/tally/transactions/payments", authMiddleware, async (req, res) => {
  try {
    const records = await engine.listSelectable(clientId(req), "payments");
    res.json({ exportType: "payments", label: "Payments", records });
  } catch (err) {
    handleError(res, err, "Failed to list payments");
  }
});

router.get("/tally/transactions/credit-notes", authMiddleware, async (req, res) => {
  try {
    const records = await engine.listSelectable(clientId(req), "credit-notes");
    res.json({ exportType: "credit-notes", label: "Credit Notes", records });
  } catch (err) {
    handleError(res, err, "Failed to list credit notes");
  }
});

router.get("/tally/transactions/debit-notes", authMiddleware, async (req, res) => {
  try {
    const records = await engine.listSelectable(clientId(req), "debit-notes");
    res.json({ exportType: "debit-notes", label: "Debit Notes", records });
  } catch (err) {
    handleError(res, err, "Failed to list debit notes");
  }
});

router.post("/tally/transactions/export", authMiddleware, CAN_EXPORT, async (req, res) => {
  try {
    const { transactionType, ids, force } = req.body ?? {};
    const exportType = (transactionType || req.body.exportType) as Tally.TallyExportType;
    if (!["sales", "purchases", "receipts", "payments", "credit-notes", "debit-notes"].includes(exportType)) {
      return res.status(400).json({ error: "Invalid transaction export type" });
    }
    const result = await engine.generateBatch({
      clientId: clientId(req),
      exportType,
      ids: Array.isArray(ids) ? ids : undefined,
      force: !!force,
      generatedBy: req.user?.email ?? null,
    });
    if (result.validationFailed) {
      return res.status(422).json({
        error: "Validation failed - fix the highlighted transactions before exporting.",
        records: result.records.map(publicRecord),
        errors: result.errors,
      });
    }
    res.status(201).json({
      batch: result.batch,
      preview: result.xml.slice(0, 15000),
    });
  } catch (err) {
    handleError(res, err, "Failed to export transactions");
  }
});

// ─── General Selection / Validation / Export ────────────────────────────────

router.get("/tally/records/:exportType", authMiddleware, async (req, res) => {
  try {
    const type = req.params.exportType;
    if (!isExportType(type)) return res.status(400).json({ error: "Unknown export type" });
    const rows = await engine.listSelectable(clientId(req), type);
    res.json({ exportType: type, label: engine.typeLabel(type), records: rows });
  } catch (err) {
    handleError(res, err, "Failed to list Tally source records");
  }
});

router.post("/tally/validate", authMiddleware, CAN_EXPORT, async (req, res) => {
  try {
    const { exportType, ids } = req.body ?? {};
    if (!isExportType(exportType)) return res.status(400).json({ error: "Unknown export type" });
    const result = await engine.validateRecords(clientId(req), exportType, Array.isArray(ids) ? ids : undefined);
    const records = result.records.map(publicRecord);
    const errors = records.flatMap((r) => r.errors.map((e) => `${r.sourceLabel}: ${e}`));
    if (result.configError) {
      const selectedIds = Array.isArray(ids) && ids.length ? ids : [];
      const configRecords =
        selectedIds.length > 0
          ? selectedIds.map((sourceId) => ({
              sourceId,
              sourceLabel: sourceId,
              docNumber: null,
              date: null,
              party: null,
              voucherType: exportType,
              amount: 0,
              status: "Validation Failed",
              errors: [result.configError],
              warnings: [],
              totals: { taxable: 0, gst: 0, grandTotal: 0 },
              contentHash: "",
            }))
          : [];
      const configErrorRecords = configRecords.map((r) => ({
        sourceId: r.sourceId,
        sourceLabel: r.sourceLabel,
        docNumber: r.docNumber,
        date: r.date,
        party: r.party,
        voucherType: r.voucherType,
        amount: r.amount,
        status: r.status,
        errors: r.errors,
        warnings: r.warnings,
        totals: r.totals,
        contentHash: r.contentHash,
        exportedStatus: null,
        lastBatchId: null,
        exportedAt: null,
      }));
      const configErrors = configErrorRecords.flatMap((r) =>
        r.errors.map((e) => `${r.sourceLabel}: ${e}`),
      );
      return res.json({
        exportType,
        totalRecords: configRecords.length,
        validRecords: 0,
        valid: false,
        canGenerate: false,
        configError: result.configError,
        totalCount: configRecords.length,
        validCount: 0,
        errorCount: configRecords.length,
        warningCount: 0,
        totalValue: 0,
        errors: configErrors,
        records: configErrorRecords,
      });
    }
    res.json({
      exportType,
      totalRecords: records.length,
      validRecords: records.filter((r) => r.errors.length === 0).length,
      valid: errors.length === 0,
      canGenerate: records.some((r) => r.errors.length === 0),
      configError: null,
      totalCount: records.length,
      validCount: records.filter((r) => r.errors.length === 0).length,
      errorCount: records.filter((r) => r.errors.length > 0).length,
      warningCount: records.reduce((n, r) => n + r.warnings.length, 0),
      totalValue: records.reduce((sum, r) => sum + (r.amount || 0), 0),
      errors,
      records,
    });
  } catch (err) {
    handleError(res, err, "Failed to validate Tally export");
  }
});

router.post("/tally/export", authMiddleware, CAN_EXPORT, async (req, res) => {
  try {
    const { exportType, ids, force } = req.body ?? {};
    if (!isExportType(exportType)) return res.status(400).json({ error: "Unknown export type" });
    const result = await engine.generateBatch({
      clientId: clientId(req),
      exportType,
      ids: Array.isArray(ids) ? ids : undefined,
      force: !!force,
      generatedBy: req.user?.email ?? null,
    });
    if (result.validationFailed) {
      return res.status(422).json({
        error: "Validation failed - fix the highlighted records before generating XML.",
        records: result.records.map(publicRecord),
        errors: result.errors,
      });
    }
    res.status(201).json({
      batch: result.batch,
      preview: result.xml.slice(0, 15000),
    });
  } catch (err) {
    handleError(res, err, "Failed to generate Tally XML");
  }
});

// ─── Batches ────────────────────────────────────────────────────────────────

router.get("/tally/batches", authMiddleware, async (req, res) => {
  try {
    const batches = await Tally.listBatches(clientId(req));
    res.json({
      batches: batches.map((b) => ({
        id: b.id,
        batchNumber: b.batchNumber,
        exportType: b.exportType,
        status: b.status,
        recordCount: b.recordCount,
        validCount: b.validCount,
        errorCount: b.errorCount,
        warningCount: b.warningCount,
        xmlBytes: b.xmlBytes,
        xmlSha256: b.xmlSha256,
        totals: b.totals,
        generatedAt: b.generatedAt,
        generatedBy: b.generatedBy,
        downloadedAt: b.downloadedAt,
        downloadedBy: b.downloadedBy,
        importedAt: b.importedAt,
        importedBy: b.importedBy,
        importResult: b.importResult,
        companyName: b.companyName,
        fileName: b.fileName,
      })),
    });
  } catch (err) {
    handleError(res, err, "Failed to list Tally batches");
  }
});

router.get("/tally/batches/:id", authMiddleware, async (req, res) => {
  try {
    const batch = await Tally.getBatch(clientId(req), req.params.id);
    if (!batch) return res.status(404).json({ error: "Batch not found" });
    res.json({ batch });
  } catch (err) {
    handleError(res, err, "Failed to load Tally batch");
  }
});

router.get("/tally/batches/:id/xml", authMiddleware, async (req, res) => {
  try {
    const batch = await Tally.getBatch(clientId(req), req.params.id);
    if (!batch) return res.status(404).json({ error: "Batch not found" });
    const xml = await engine.readBatchXml(batch);
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="${batch.fileName}"`);
    res.send(xml);
  } catch (err) {
    handleError(res, err, "Failed to read Tally XML");
  }
});

router.get("/tally/batches/:id/download", authMiddleware, async (req, res) => {
  try {
    const cid = clientId(req);
    const batch = await Tally.getBatch(cid, req.params.id);
    if (!batch) return res.status(404).json({ error: "Batch not found" });
    const xml = await engine.readBatchXml(batch);
    await engine.markDownloaded(cid, batch.id, req.user?.email ?? null);
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${batch.fileName}"`);
    res.send(xml);
  } catch (err) {
    handleError(res, err, "Failed to download Tally XML");
  }
});

router.get("/tally/batches/:id/manifest", authMiddleware, async (req, res) => {
  try {
    const batch = await Tally.getBatch(clientId(req), req.params.id);
    if (!batch) return res.status(404).json({ error: "Batch not found" });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${batch.batchNumber}-manifest.csv"`);
    res.send(engine.manifestCsv(batch));
  } catch (err) {
    handleError(res, err, "Failed to build Tally manifest");
  }
});

router.get("/tally/batches/:id/errors", authMiddleware, async (req, res) => {
  try {
    const batch = await Tally.getBatch(clientId(req), req.params.id);
    if (!batch) return res.status(404).json({ error: "Batch not found" });
    const failed = batch.records.filter((r) => r.errors.length > 0 || r.status === "Failed" || r.status === "Validation Failed");
    const csv = generateValidationErrorReportCsv(failed.length > 0 ? failed : batch.records);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${batch.batchNumber}-errors.csv"`);
    res.send(csv);
  } catch (err) {
    handleError(res, err, "Failed to generate error report");
  }
});

router.post("/tally/batches/:id/confirm-import", authMiddleware, CAN_EXPORT, async (req, res) => {
  try {
    const { created, altered, skipped, failed, notes } = req.body ?? {};
    const nums = [created, altered, skipped, failed].map((n) => Number(n) || 0);
    if (nums.some((n) => n < 0)) return res.status(400).json({ error: "Counts cannot be negative" });
    if (nums.every((n) => n === 0)) {
      return res.status(400).json({ error: "Enter the counts Tally reported after the import." });
    }
    const batch = await engine.confirmImport(clientId(req), req.params.id, req.user?.email ?? null, {
      created: nums[0],
      altered: nums[1],
      skipped: nums[2],
      failed: nums[3],
      notes: notes || null,
    });
    if (!batch) return res.status(404).json({ error: "Batch not found" });
    res.json({ batch });
  } catch (err) {
    handleError(res, err, "Failed to confirm Tally import");
  }
});

router.post("/tally/batches/:id/retry", authMiddleware, CAN_EXPORT, async (req, res) => {
  try {
    const result = await engine.retryFailedRecords(clientId(req), req.params.id, req.user?.email ?? null);
    res.json(result);
  } catch (err) {
    handleError(res, err, "Failed to retry batch");
  }
});

// ─── Reverse Import from Tally XML ──────────────────────────────────────────

router.post("/tally/reverse-import/parse", authMiddleware, async (req, res) => {
  try {
    const { xml } = req.body ?? {};
    if (!xml || typeof xml !== "string") {
      return res.status(400).json({ error: "XML content string is required" });
    }
    const staged = parseTallyXml(xml);
    const classified = await matchAndClassifyStaged(clientId(req), staged);
    res.json({
      totalCount: classified.length,
      matchedCount: classified.filter((r) => r.classification === "Matched").length,
      changedCount: classified.filter((r) => r.classification === "Changed").length,
      newCount: classified.filter((r) => r.classification === "New").length,
      missingMasterCount: classified.filter((r) => r.classification === "Missing Master").length,
      vouchers: classified,
    });
  } catch (err) {
    handleError(res, err, "Failed to parse Tally XML");
  }
});

// ─── Import instructions ────────────────────────────────────────────────────

router.get("/tally/instructions", authMiddleware, (_req, res) => {
  res.json({
    steps: [
      "Log in to the client's hosted TallyPrime environment.",
      "Open the correct company and verify the company name matches the configuration.",
      "Take a complete backup of the Tally company before executing any import.",
      "Navigate to Gateway of Tally > Import Data > Masters (or Data > Import Data > XML).",
      "Always import masters first (Customers, Suppliers, Stock Items, Units) if transactions depend on them.",
      "Select the XML file downloaded from WhizUnik and execute the import.",
      "Navigate to Gateway of Tally > Import Data > Vouchers to import transactions (Sales, Purchases, Receipts, Payments, Credit/Debit Notes).",
      "Check Tally Import Exceptions under Display More Reports > Exception Reports.",
      "Open sample vouchers in Tally and verify ledger allocations, GST heads, HSN codes, and balances.",
      "Return to WhizUnik and submit the Import Confirmation with created, altered, skipped, and failed counts.",
    ],
  });
});

export default router;
