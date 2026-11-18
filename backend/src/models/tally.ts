import * as db from "../dynamodb.js";
import { v4 as uuid } from "uuid";

/**
 * TallyPrime XML Export / Import integration.
 *
 * Everything here is per-client. The config holds the Tally company name,
 * home state and the ledger / godown names that the XML must reference.
 * Nothing is hardcoded: a client must configure its Tally mapping before
 * exports can validate.
 */

export type TallyExportType =
  | "customers"
  | "suppliers"
  | "stock-items"
  | "units"
  | "ledgers"
  | "sales"
  | "purchases"
  | "receipts"
  | "payments"
  | "credit-notes"
  | "debit-notes";

export type TallyRecordStatus =
  | "Ready"
  | "Validation Failed"
  | "Exported"
  | "Downloaded"
  | "Imported"
  | "Failed"
  | "Needs Review";

export interface TallyLedgerMapping {
  salesLedger: string;
  purchaseLedger: string;
  bankLedger: string;
  cashLedger: string;
  freightLedger: string;
  roundOffLedger: string;
  cgstOutputLedger: string;
  sgstOutputLedger: string;
  utgstOutputLedger: string;
  igstOutputLedger: string;
  cgstInputLedger: string;
  sgstInputLedger: string;
  utgstInputLedger: string;
  igstInputLedger: string;
  advanceReceivedLedger: string;
  advancePaidLedger: string;
  debtorsGroup: string;
  creditorsGroup: string;
  salesGroup: string;
  purchaseGroup: string;
  bankGroup: string;
  gstGroup: string;
}

export const EMPTY_MAPPING: TallyLedgerMapping = {
  salesLedger: "",
  purchaseLedger: "",
  bankLedger: "",
  cashLedger: "",
  freightLedger: "",
  roundOffLedger: "",
  cgstOutputLedger: "",
  sgstOutputLedger: "",
  utgstOutputLedger: "",
  igstOutputLedger: "",
  cgstInputLedger: "",
  sgstInputLedger: "",
  utgstInputLedger: "",
  igstInputLedger: "",
  advanceReceivedLedger: "",
  advancePaidLedger: "",
  debtorsGroup: "Sundry Debtors",
  creditorsGroup: "Sundry Creditors",
  salesGroup: "Sales Accounts",
  purchaseGroup: "Purchase Accounts",
  bankGroup: "Bank Accounts",
  gstGroup: "Duties & Taxes",
};

/**
 * Suggested names shown to the user by "Load standard Tally names". It is
 * only a starting point that the user must review and save explicitly; the
 * integration never applies these silently.
 */
export const SUGGESTED_MAPPING: TallyLedgerMapping = {
  ...EMPTY_MAPPING,
  salesLedger: "Sales",
  purchaseLedger: "Purchase",
  bankLedger: "Bank Account",
  cashLedger: "Cash",
  freightLedger: "Freight & Transport",
  roundOffLedger: "Round Off",
  cgstOutputLedger: "CGST Output",
  sgstOutputLedger: "SGST Output",
  utgstOutputLedger: "UTGST Output",
  igstOutputLedger: "IGST Output",
  cgstInputLedger: "CGST Input",
  sgstInputLedger: "SGST Input",
  utgstInputLedger: "UTGST Input",
  igstInputLedger: "IGST Input",
  advanceReceivedLedger: "Advance Received",
  advancePaidLedger: "Advance Paid",
};

export interface TallyConfig {
  pk: string;
  sk: string;
  entityType: "TallyConfig";
  clientId: string;
  companyName: string;
  homeState: string;
  gstin: string;
  gstRegistrationType: string;
  godownName: string;
  defaultUnit: string;
  stockGroup: string;
  batchName: string;
  /** GST rate / HSN effective-from date (YYYY-MM-DD). */
  gstApplicableFrom: string;
  mappings: TallyLedgerMapping;
  /** Explicitly allow exporting the same source record again. */
  allowDuplicateReExport: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

const UT_STATES = [
  "andaman and nicobar islands",
  "chandigarh",
  "dadra and nagar haveli and daman and diu",
  "delhi",
  "jammu and kashmir",
  "ladakh",
  "lakshadweep",
  "puducherry",
];

export function isUnionTerritory(state: string | null | undefined): boolean {
  return !!state && UT_STATES.includes(state.trim().toLowerCase());
}

function configKey(clientId: string) {
  return { pk: `TALLY_CONFIG#${clientId}`, sk: `TALLY_CONFIG#${clientId}` };
}

export async function getConfig(clientId: string): Promise<TallyConfig | null> {
  const { pk, sk } = configKey(clientId);
  return (await db.getItem(pk, sk)) as TallyConfig | null;
}

export async function saveConfig(
  clientId: string,
  data: Partial<TallyConfig>,
  updatedBy?: string | null,
): Promise<TallyConfig> {
  const { pk, sk } = configKey(clientId);
  const existing = await getConfig(clientId);
  const now = db.nowISO();
  const normalize = (value: unknown) =>
    String(value ?? "").replace(/\s+/g, " ").trim();
  const mappings = {
    ...EMPTY_MAPPING,
    ...(existing?.mappings ?? {}),
    ...(data.mappings ?? {}),
  };
  Object.keys(mappings).forEach((key) => {
    mappings[key as keyof TallyLedgerMapping] =
      normalize(mappings[key as keyof TallyLedgerMapping]) as never;
  });
  const item: TallyConfig = {
    pk,
    sk,
    entityType: "TallyConfig",
    clientId,
    companyName: normalize(data.companyName ?? existing?.companyName),
    homeState: normalize(data.homeState ?? existing?.homeState),
    gstin: normalize(data.gstin ?? existing?.gstin).toUpperCase(),
    gstRegistrationType:
      data.gstRegistrationType ?? existing?.gstRegistrationType ?? "Regular",
    godownName: normalize(data.godownName ?? existing?.godownName),
    defaultUnit: (data.defaultUnit ?? existing?.defaultUnit ?? "pics").trim() || "pics",
    stockGroup: (data.stockGroup ?? existing?.stockGroup ?? "").trim(),
    batchName: (data.batchName ?? existing?.batchName ?? "Primary Batch").trim() || "Primary Batch",
    gstApplicableFrom:
      (data.gstApplicableFrom ?? existing?.gstApplicableFrom ?? "").trim() ||
      "2026-10-01",
    mappings,
    allowDuplicateReExport:
      data.allowDuplicateReExport ?? existing?.allowDuplicateReExport ?? false,
    updatedAt: now,
    updatedBy: updatedBy ?? null,
  };
  await db.putItem(item);
  return item;
}

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

export interface TallyBatchRecord {
  sourceId: string;
  sourceLabel?: string;
  docNumber: string | null;
  date: string | null;
  party: string | null;
  amount: number;
  voucherType: string;
  contentHash: string;
  status: TallyRecordStatus;
  errors: string[];
  warnings: string[];
}

export interface TallyBatch {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "TallyBatch";
  id: string;
  clientId: string;
  batchNumber: string;
  exportType: TallyExportType;
  reportName: string;
  companyName: string;
  status: "Generated" | "Validation Failed" | "Downloaded" | "Imported" | "Failed";
  fileName: string;
  xmlPath: string | null;
  xmlSha256: string;
  xmlBytes: number;
  recordCount: number;
  validCount: number;
  errorCount: number;
  warningCount: number;
  totals: { taxable: number; gst: number; grandTotal: number };
  generatedAt: string;
  generatedBy: string | null;
  downloadedAt: string | null;
  downloadedBy: string | null;
  importedAt: string | null;
  importedBy: string | null;
  importResult: {
    created: number;
    altered: number;
    skipped: number;
    failed: number;
    notes: string | null;
  } | null;
  records: TallyBatchRecord[];
}

function batchPk(clientId: string) {
  return `TALLY_BATCH#${clientId}`;
}

export async function listBatches(clientId: string): Promise<TallyBatch[]> {
  const { items } = await db.queryByPk(batchPk(clientId), { limit: 200, reverse: true });
  return items as TallyBatch[];
}

export async function getBatch(clientId: string, id: string): Promise<TallyBatch | null> {
  const batches = await listBatches(clientId);
  return batches.find((b) => b.id === id) ?? null;
}

export async function countBatches(clientId: string): Promise<number> {
  return (await listBatches(clientId)).length;
}

export async function createBatch(
  data: Omit<TallyBatch, "pk" | "sk" | "gsi1pk" | "gsi1sk" | "entityType" | "id" | "batchNumber"> & {
    id?: string;
    batchNumber?: string;
  },
): Promise<TallyBatch> {
  const id = data.id ?? uuid();
  const now = data.generatedAt || db.nowISO();
  const seq = (await countBatches(data.clientId)) + 1;
  const item: TallyBatch = {
    pk: batchPk(data.clientId),
    sk: `${now}#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`,
    gsi1sk: `TallyBatch#${now}`,
    entityType: "TallyBatch",
    id,
    batchNumber:
      data.batchNumber || `TALLY-${data.exportType.toUpperCase()}-${String(seq).padStart(4, "0")}`,
    ...data,
  };
  await db.putItem(item);
  return item;
}

export async function updateBatch(
  clientId: string,
  id: string,
  updates: Partial<TallyBatch>,
): Promise<TallyBatch | null> {
  const existing = await getBatch(clientId, id);
  if (!existing) return null;
  const next = { ...existing, ...updates, id: existing.id, clientId };
  await db.putItem(next);
  return next;
}

// ---------------------------------------------------------------------------
// Per-source export tracking (idempotency + change detection)
// ---------------------------------------------------------------------------

export interface TallyExportRecord {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "TallyExportRecord";
  id: string;
  clientId: string;
  exportType: TallyExportType;
  sourceId: string;
  sourceLabel: string;
  docNumber: string | null;
  voucherType: string;
  contentHash: string;
  status: TallyRecordStatus;
  lastBatchId: string | null;
  exportedAt: string | null;
  importedAt: string | null;
  errorCount: number;
  errors: string[];
  updatedAt: string;
}

function recordPk(clientId: string) {
  return `TALLY_RECORD#${clientId}`;
}

export async function listExportRecords(clientId: string): Promise<TallyExportRecord[]> {
  const { items } = await db.queryByPk(recordPk(clientId), { limit: 500 });
  return items as TallyExportRecord[];
}

export async function findExportRecord(
  clientId: string,
  exportType: TallyExportType,
  sourceId: string,
): Promise<TallyExportRecord | null> {
  return (await db.getItem(recordPk(clientId), `${exportType}#${sourceId}`)) as TallyExportRecord | null;
}

export async function upsertExportRecord(
  clientId: string,
  data: Partial<TallyExportRecord> & {
    exportType: TallyExportType;
    sourceId: string;
    contentHash: string;
    voucherType: string;
    status: TallyRecordStatus;
  },
): Promise<TallyExportRecord> {
  const sk = `${data.exportType}#${data.sourceId}`;
  const pk = recordPk(clientId);
  const existing = (await db.getItem(pk, sk)) as TallyExportRecord | null;
  const now = db.nowISO();
  const item: TallyExportRecord = {
    pk,
    sk,
    gsi1pk: `CLIENT#${clientId}`,
    gsi1sk: `TallyExportRecord#${now}`,
    entityType: "TallyExportRecord",
    id: existing?.id ?? uuid(),
    clientId,
    exportType: data.exportType,
    sourceId: data.sourceId,
    sourceLabel: data.sourceLabel ?? existing?.sourceLabel ?? "",
    docNumber: data.docNumber ?? existing?.docNumber ?? null,
    voucherType: data.voucherType,
    contentHash: data.contentHash,
    status: data.status,
    lastBatchId: data.lastBatchId ?? existing?.lastBatchId ?? null,
    exportedAt: data.exportedAt ?? existing?.exportedAt ?? null,
    importedAt: data.importedAt ?? existing?.importedAt ?? null,
    errorCount: data.errorCount ?? 0,
    errors: data.errors ?? [],
    updatedAt: now,
  };
  await db.putItem(item);
  return item;
}
