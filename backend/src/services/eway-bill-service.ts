// ---------------------------------------------------------------------------
// E-Way Bill Service — Business Logic Layer
// ---------------------------------------------------------------------------
// Maps GoodsDispatch data to NIC E-Way Bill API payload and orchestrates
// the full EWB lifecycle (generate → part-b → extend → cancel).
//
// Now uses the direct NIC API client instead of the WhiteBooks GSP connector.
// The business logic is preserved — only the transport layer changed.
// ---------------------------------------------------------------------------

import * as EwayBill from "../models/eway-bill.js";
import * as GoodsDispatch from "../models/goods-dispatch.js";
import { ewayBillConfig, validityDaysForDistance } from "../config/eway-bill.js";
import {
  getDirectClient,
  EwbClientError,
  type GenerateEwbResult,
  type UpdatePartBResult,
  type CancelEwbResult,
  type ExtendEwbResult,
  type EwbDetailsResult,
} from "./eway-bill-direct-client.js";
import {
  getByClientIdAndGstin,
  isTokenExpired,
  type EwbCredential,
} from "./eway-bill-credentials.js";
import * as db from "../dynamodb.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface GenerateEwbInput {
  /** Goods Dispatch ID to generate EWB for. */
  dispatchId: string;
  /** Seller's GSTIN (from credential store or override). */
  supplierGstin?: string;
  /** Buyer's / recipient's GSTIN (required if not on debtor). */
  recipientGstin?: string;
  /** Approximate distance in km (for validity calculation). */
  distance?: number;
  /** Override transport mode (default: road). */
  transportMode?: string;
  /** Override vehicle number. */
  vehicleNumber?: string;
  /** Transporter GSTIN or TRANSIN. */
  transporterGstin?: string;
  /** Transporter name. */
  transporterName?: string;
  /** Client ID for credential resolution. */
  clientId?: string;
}

export interface UpdatePartBInput {
  /** E-Way Bill ID (our internal ID, not the NIC number). */
  ewayBillId: string;
  vehicleNumber: string;
  fromPlace?: string;
  fromState?: number;
  transportMode?: string;
  reasonCode?: string;
  reasonRemarks?: string;
}

export interface CancelEwbInput {
  ewayBillId: string;
  reason: string;
  remarks: string;
}

export interface ExtendEwbInput {
  ewayBillId: string;
  remainingDistance?: number;
  reason?: string;
  remarks?: string;
}

// ── Credential Resolution ────────────────────────────────────────────────────

/**
 * Resolve the EWB credential for a given GSTIN and client.
 * Multi-tenant: only returns credentials belonging to the specified client.
 */
async function resolveCredential(
  clientId: string,
  gstin: string,
): Promise<EwbCredential> {
  const cred = await getByClientIdAndGstin(clientId, gstin);
  if (!cred) {
    throw new Error(
      `No E-Way Bill credentials found for GSTIN ${gstin}. ` +
      `Configure API credentials in Settings → E-Way Bill Configuration.`,
    );
  }
  if (cred.onboardingStatus === "DISABLED") {
    throw new Error(
      `E-Way Bill credentials for GSTIN ${gstin} are disabled.`,
    );
  }
  return cred;
}

/**
 * Get a valid access token for API calls, re-authenticating if needed.
 */
async function ensureAuthenticated(credentialId: string): Promise<void> {
  const client = getDirectClient();
  try {
    await client.getValidToken(credentialId);
  } catch (err: any) {
    // Token expired or invalid — re-authenticate
    if (err.code === "AUTH_FAILED" || err.message?.includes("expired")) {
      await client.authenticate(credentialId);
    } else {
      throw err;
    }
  }
}

// ── Main Service ─────────────────────────────────────────────────────────────

/**
 * Generate an E-Way Bill for a confirmed Goods Dispatch.
 *
 * Steps:
 *   1. Load the dispatch and validate it's in a state that allows EWB generation
 *   2. Compute taxable value from dispatch lines
 *   3. Resolve credentials for the supplier GSTIN
 *   4. Build the NIC API payload
 *   5. Call the direct NIC API client
 *   6. Persist the EWB record and link it to the dispatch
 */
export async function generateEwb(
  input: GenerateEwbInput,
  userId?: string,
): Promise<{ ewayBill: EwayBill.EwayBill; gspResult: GenerateEwbResult }> {
  // 1. Load dispatch
  const dispatch = await GoodsDispatch.get(input.dispatchId);
  if (!dispatch) throw new Error("Goods Dispatch not found");
  if (dispatch.status === "draft")
    throw new Error("Confirm the dispatch before generating an E-Way Bill");
  if (dispatch.status === "cancelled")
    throw new Error("Cannot generate EWB for a cancelled dispatch");

  // Check if EWB already exists for this dispatch (idempotency)
  const existing = await EwayBill.getByDispatchId(input.dispatchId);
  if (existing && existing.status !== "failed")
    throw new Error(`E-Way Bill already exists for this dispatch (EWB #${existing.ewbNumber || existing.id})`);

  // 2. Compute taxable value from dispatch lines
  const taxableValue = dispatch.lines.reduce((sum, line) => {
    return sum + (line.lineValue || 0);
  }, 0);

  if (!EwayBill.requiresEwb(taxableValue)) {
    throw new Error(
      `Taxable value (₹${taxableValue.toFixed(2)}) is below the ₹${ewayBillConfig.threshold.toLocaleString()} E-Way Bill threshold`,
    );
  }

  // 3. GSTIN resolution
  const supplierGstin = input.supplierGstin || "";
  if (!supplierGstin) {
    throw new Error(
      "Supplier GSTIN is required. Pass supplierGstin or configure E-Way Bill credentials.",
    );
  }

  const recipientGstin = input.recipientGstin || "";
  if (!recipientGstin) {
    throw new Error(
      "Recipient GSTIN is required. Add a GSTIN field to the debtor or pass recipientGstin.",
    );
  }

  // 4. Resolve credentials (multi-tenant check)
  const clientId = input.clientId || dispatch.clientId;
  const credential = await resolveCredential(clientId, supplierGstin);

  // 5. Compute GST amounts (simplified — 18% default)
  const fromState = parseInt(supplierGstin.slice(0, 2), 10) || 0;
  const toState = parseInt(recipientGstin.slice(0, 2), 10) || 0;
  const isSameState = fromState === toState;

  const gstRate = 0.18;
  const totalGst = taxableValue * gstRate;
  const cgstValue = isSameState ? totalGst / 2 : 0;
  const sgstValue = isSameState ? totalGst / 2 : 0;
  const igstValue = isSameState ? 0 : totalGst;
  const totalValue = taxableValue + totalGst;

  // 6. Build HSN details from dispatch lines
  const itemList = dispatch.lines.map((line) => ({
    productName: line.name || "Goods",
    productDesc: line.name || "",
    hsnCode: parseInt(line.sku || "0", 10) || 0,
    quantity: line.dispatchedQty || line.orderedQty || 1,
    qtyUnit: (line.unit || "NOS").slice(0, 3).toUpperCase(),
    taxableAmount: line.lineValue || 0,
    sgstRate: isSameState ? gstRate * 50 : 0,
    cgstRate: isSameState ? gstRate * 50 : 0,
    igstRate: isSameState ? 0 : gstRate * 100,
    cessRate: 0,
  }));

  // 7. Distance & validity
  const distance = input.distance || 100;
  const validDays = validityDaysForDistance(distance);
  const validFrom = db.todayDate();
  const validUntil = new Date(
    Date.now() + validDays * 24 * 60 * 60 * 1000,
  )
    .toISOString()
    .slice(0, 10);

  // 8. Create EWB record (pending)
  let ewayBill: EwayBill.EwayBill;
  if (existing) {
    // Reuse failed record
    ewayBill = (await EwayBill.update(existing.id, {
      status: "pending",
      lastError: null,
      lastErrorAt: null,
      taxableValue,
      cgstAmount: cgstValue,
      sgstAmount: sgstValue,
      igstAmount: igstValue,
      totalValue,
      hsnDetails: itemList,
    })) as EwayBill.EwayBill;
  } else {
    ewayBill = await EwayBill.create({
      clientId,
      goodsDispatchId: dispatch.id,
      dispatchNumber: dispatch.dispatchNumber || undefined,
      supplierGstin,
      recipientGstin,
      documentNumber: dispatch.dispatchNumber || "",
      documentDate: dispatch.dispatchDate || db.todayDate(),
      taxableValue,
      cgstAmount: cgstValue,
      sgstAmount: sgstValue,
      igstAmount: igstValue,
      totalValue,
      hsnDetails: itemList,
      transportMode: (input.transportMode as any) || "road",
      transporterGstin: input.transporterGstin || null,
      transporterName: input.transporterName || dispatch.transporterName || null,
      approxDistance: distance,
      vehicleNumber: input.vehicleNumber || null,
      validFrom,
      validUntil,
      generationMode: "automatic",
    });
  }

  // 9. Call NIC API directly
  try {
    const client = getDirectClient();
    const nicResult = await client.generateEwb(credential.id, {
      supplyType: "O", // Outward (sales dispatch)
      subSupplyType: "1", // Job Work
      docType: "INV",
      docNo: dispatch.dispatchNumber || dispatch.id.slice(0, 12),
      docDate: toNicDate(dispatch.dispatchDate || db.todayDate()),
      fromGstin: supplierGstin,
      fromTrdName: undefined, // TODO: resolve from company profile
      fromPincode: 100000, // TODO: get from address
      actFromStateCode: fromState,
      fromStateCode: fromState,
      toGstin: recipientGstin,
      toPincode: 100000, // TODO: get from address
      actToStateCode: toState,
      toStateCode: toState,
      transactionType: isSameState ? 1 : 4,
      totalValue: taxableValue,
      cgstValue,
      sgstValue,
      igstValue,
      cessValue: 0,
      totInvValue: totalValue,
      transMode: mapTransportMode(input.transportMode || "road") as "1" | "2" | "3" | "4",
      transDistance: String(distance),
      transporterName: input.transporterName || dispatch.transporterName || undefined,
      transporterId: input.transporterGstin || undefined,
      vehicleNo: input.vehicleNumber || undefined,
      itemList,
    });

    // 10. Update EWB record with success
    const updated = await EwayBill.markGenerated(
      ewayBill.id,
      String(nicResult.ewbNo),
      fromNicDate(nicResult.validUpto),
      nicResult.ewayBillRequestId || undefined,
    );
    if (!updated) throw new Error("Failed to update EWB record");

    // 11. Link EWB to dispatch
    await GoodsDispatch.update(dispatch.id, {
      ewayBillId: updated.id,
      ewayBillNumber: updated.ewbNumber,
      ewayBillStatus: updated.status,
    });

    return { ewayBill: updated as EwayBill.EwayBill, gspResult: nicResult };
  } catch (err: any) {
    // Mark as failed
    await EwayBill.markFailed(
      ewayBill.id,
      err instanceof EwbClientError ? err.message : String(err),
    );
    throw err;
  }
}

/**
 * Update Part-B (vehicle assignment) on an existing EWB.
 */
export async function updatePartB(
  input: UpdatePartBInput,
): Promise<{ ewayBill: EwayBill.EwayBill; gspResult: UpdatePartBResult }> {
  const ewayBill = await EwayBill.get(input.ewayBillId);
  if (!ewayBill) throw new Error("E-Way Bill not found");
  if (!ewayBill.ewbNumber)
    throw new Error("E-Way Bill has not been generated yet");
  if (ewayBill.status === "cancelled")
    throw new Error("Cannot update a cancelled E-Way Bill");

  // Resolve credentials
  const credential = await resolveCredential(ewayBill.clientId, ewayBill.supplierGstin);

  const dispatch = await GoodsDispatch.get(ewayBill.goodsDispatchId);
  const client = getDirectClient();

  const nicResult = await client.updatePartB(credential.id, {
    ewbNo: parseInt(ewayBill.ewbNumber, 10),
    vehicleNo: input.vehicleNumber,
    fromPlace: input.fromPlace || dispatch?.warehouse || "Unknown",
    fromState: input.fromState || parseInt(ewayBill.supplierGstin.slice(0, 2), 10) || 0,
    transMode: mapTransportMode(input.transportMode || ewayBill.transportMode),
    reasonCode: input.reasonCode || "1",
    reasonRem: input.reasonRemarks || "Vehicle assigned at dispatch",
  });

  const updated = await EwayBill.updatePartB(
    ewayBill.id,
    input.vehicleNumber,
    (input.transportMode as any) || undefined,
  );
  if (!updated) throw new Error("Failed to update EWB Part-B");

  // Sync back to dispatch
  if (dispatch) {
    await GoodsDispatch.update(dispatch.id, {
      ewayBillStatus: updated.status,
    });
  }

  return { ewayBill: updated as EwayBill.EwayBill, gspResult: nicResult };
}

/**
 * Cancel an E-Way Bill.
 */
export async function cancelEwb(
  input: CancelEwbInput,
): Promise<{ ewayBill: EwayBill.EwayBill; gspResult: CancelEwbResult }> {
  const ewayBill = await EwayBill.get(input.ewayBillId);
  if (!ewayBill) throw new Error("E-Way Bill not found");
  if (!ewayBill.ewbNumber)
    throw new Error("E-Way Bill has not been generated yet");
  if (ewayBill.status === "cancelled")
    throw new Error("E-Way Bill is already cancelled");

  // Resolve credentials
  const credential = await resolveCredential(ewayBill.clientId, ewayBill.supplierGstin);

  const client = getDirectClient();
  const nicResult = await client.cancelEwb(credential.id, {
    ewbNo: parseInt(ewayBill.ewbNumber, 10),
    cancelReason: input.reason,
    cancelRemarks: input.remarks,
  });

  const updated = await EwayBill.markCancelled(ewayBill.id, "user");
  if (!updated) throw new Error("Failed to cancel EWB");

  // Sync back to dispatch
  const dispatch = await GoodsDispatch.get(ewayBill.goodsDispatchId);
  if (dispatch) {
    await GoodsDispatch.update(dispatch.id, {
      ewayBillStatus: updated.status,
    });
  }

  return { ewayBill: updated as EwayBill.EwayBill, gspResult: nicResult };
}

/**
 * Extend the validity of an E-Way Bill.
 */
export async function extendEwb(
  input: ExtendEwbInput,
): Promise<{ ewayBill: EwayBill.EwayBill; gspResult: ExtendEwbResult }> {
  const ewayBill = await EwayBill.get(input.ewayBillId);
  if (!ewayBill) throw new Error("E-Way Bill not found");
  if (!ewayBill.ewbNumber)
    throw new Error("E-Way Bill has not been generated yet");
  if (ewayBill.status === "cancelled")
    throw new Error("Cannot extend a cancelled E-Way Bill");

  // Resolve credentials
  const credential = await resolveCredential(ewayBill.clientId, ewayBill.supplierGstin);

  const dispatch = await GoodsDispatch.get(ewayBill.goodsDispatchId);
  const client = getDirectClient();

  const remainingDistance = input.remainingDistance || ewayBill.approxDistance || 100;
  const additionalDays = validityDaysForDistance(remainingDistance);
  const newValidUntil = new Date(
    Date.now() + additionalDays * 24 * 60 * 60 * 1000,
  )
    .toISOString()
    .slice(0, 10);

  const nicResult = await client.extendValidity(credential.id, {
    ewbNo: parseInt(ewayBill.ewbNumber, 10),
    fromPlace: dispatch?.warehouse || "Unknown",
    fromState: parseInt(ewayBill.supplierGstin.slice(0, 2), 10) || 0,
    remainingDistance,
    transMode: mapTransportMode(ewayBill.transportMode),
    reasonCode: "1",
    reasonRem: input.remarks || "Natural calamity / delay",
  });

  const updated = await EwayBill.extendValidity(
    ewayBill.id,
    fromNicDate(nicResult.newValidUpto) || newValidUntil,
  );
  if (!updated) throw new Error("Failed to extend EWB validity");

  return { ewayBill: updated as EwayBill.EwayBill, gspResult: nicResult };
}

/**
 * Refresh EWB details from the NIC portal.
 */
export async function syncEwbStatus(
  ewayBillId: string,
): Promise<EwayBill.EwayBill> {
  const ewayBill = await EwayBill.get(ewayBillId);
  if (!ewayBill) throw new Error("E-Way Bill not found");
  if (!ewayBill.ewbNumber)
    throw new Error("E-Way Bill has not been generated yet");

  // Resolve credentials
  const credential = await resolveCredential(ewayBill.clientId, ewayBill.supplierGstin);

  const client = getDirectClient();
  const details = await client.getEwbDetails(credential.id, parseInt(ewayBill.ewbNumber, 10));

  // Map NIC status to our status
  const statusMap: Record<string, string> = {
    ACT: "generated",
    CNL: "cancelled",
    EXP: "expired",
    ED1: "extended",
    ED2: "extended",
  };

  const updates: Partial<EwayBill.EwayBill> = {
    lastSyncedAt: db.nowISO(),
    vehicleNumber: details.vehicleNo || ewayBill.vehicleNumber,
    transporterName: details.transporterName || ewayBill.transporterName,
  };

  if (details.status && statusMap[details.status]) {
    updates.status = statusMap[details.status] as EwayBill.EwbStatus;
  }

  return (await EwayBill.update(ewayBillId, updates)) as EwayBill.EwayBill;
}

/**
 * Check if a dispatch should auto-generate an EWB.
 */
export function shouldAutoGenerate(
  dispatch: GoodsDispatch.GoodsDispatch,
): boolean {
  const taxableValue = dispatch.lines.reduce(
    (sum, line) => sum + (line.lineValue || 0),
    0,
  );
  return EwayBill.requiresEwb(taxableValue);
}

/**
 * List all EWBs for a client, optionally filtered by status.
 */
export async function listEwbs(
  clientId: string,
  status?: string,
): Promise<EwayBill.EwayBill[]> {
  const all = await EwayBill.list(clientId);
  if (status) return all.filter((e) => e.status === status);
  return all;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Map our transport mode string to NIC numeric code. */
function mapTransportMode(mode: string): "1" | "2" | "3" | "4" {
  const map: Record<string, "1" | "2" | "3" | "4"> = {
    road: "1",
    rail: "2",
    air: "3",
    ship: "4",
  };
  return map[mode?.toLowerCase()] || "1";
}

/** Convert YYYY-MM-DD to DD/MM/YYYY (NIC format). */
function toNicDate(isoDate: string): string {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

/** Convert DD/MM/YYYY (NIC format) to YYYY-MM-DD. */
function fromNicDate(nicDate: string): string {
  if (!nicDate) return "";
  const [d, m, y] = nicDate.split("/");
  return `${y}-${m}-${d}`;
}
