import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

// ---------------------------------------------------------------------------
// E-Way Bill (EWB) — tracks electronic waybills for goods movement under GST.
// Generated automatically when a GoodsDispatch is confirmed and the taxable
// value exceeds ₹50,000. Linked 1:1 to a GoodsDispatch.
// ---------------------------------------------------------------------------

/** Transport modes recognised by the NIC e-Way Bill system. */
export type TransportMode = "road" | "rail" | "air" | "ship";

/** Lifecycle status of an E-Way Bill. */
export type EwbStatus =
  | "pending"       // Dispatch confirmed, EWB generation queued/in-progress
  | "generated"     // EWB successfully generated — valid for transit
  | "vehicle_updated" // Part-B (vehicle details) updated
  | "extended"      // Validity extended
  | "cancelled"     // EWB cancelled before/during transit
  | "expired"       // Validity lapsed without extension
  | "consolidated"  // Merged into a consolidated EWB
  | "failed";       // Generation failed (error stored in lastError)

export interface EwayBill {
  // ── DynamoDB keys ──
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "EwayBill";

  id: string;
  clientId: string;

  /** The EWB number returned by the NIC portal (numeric, 12-digit). */
  ewbNumber: string | null;

  /** Unique IRN-like reference from the GSP, if applicable. */
  ewbReplyId: string | null;

  // ── Linked documents ──
  /** Goods Dispatch this EWB was generated for. */
  goodsDispatchId: string;
  dispatchNumber: string | null;

  /** Linked sales invoice (optional — populated after invoice creation). */
  salesInvoiceId: string | null;
  salesInvoiceNumber: string | null;

  // ── Supplier (sender) details ──
  supplierGstin: string;
  supplierTradeName: string | null;
  supplierAddress: string | null;
  supplierStateCode: string;

  // ── Recipient (receiver) details ──
  recipientGstin: string;
  recipientTradeName: string | null;
  recipientAddress: string | null;
  recipientStateCode: string;

  // ── Document details ──
  /** Invoice / bill number for the shipment. */
  documentNumber: string;
  /** Document date (YYYY-MM-DD). */
  documentDate: string;

  // ── Value & GST ──
  /** Total taxable value of goods (₹). Must be > 50,000 to require EWB. */
  taxableValue: number;
  /** Total CGST amount. */
  cgstAmount: number;
  /** Total SGST amount. */
  sgstAmount: number;
  /** Total IGST amount. */
  igstAmount: number;
  /** Cess amount, if applicable. */
  cessAmount: number;
  /** Total value including tax. */
  totalValue: number;

  // ── HSN / item details ──
  /** HSN code summary — stored as a JSON array of { hsnCode, uqc, qty, taxableValue }. */
  hsnDetails: any[];

  // ── Transport details ──
  transportMode: TransportMode;
  /** Transporter GSTIN (if transporter is registered). */
  transporterGstin: string | null;
  /** Transporter ID (if not GSTIN-registered). */
  transporterId: string | null;
  /** Transporter name. */
  transporterName: string | null;
  /** Approximate distance (km) from dispatch to delivery. */
  approxDistance: number | null;

  // ── Part-B: Vehicle / transport assignment ──
  /** Vehicle number (e.g. MH12AB1234). Filled after dispatch. */
  vehicleNumber: string | null;
  /** Date when Part-B was updated. */
  vehicleUpdateDate: string | null;
  /** Mode of transport for Part-B (may differ from initial). */
  partBMode: TransportMode | null;
  /** Vehicle type: regular or over-dimensional cargo. */
  vehicleType: string | null;

  // ── Validity ──
  /** EWB valid-from date (YYYY-MM-DD). */
  validFrom: string;
  /** EWB valid-until date (YYYY-MM-DD). */
  validUntil: string;
  /** Number of times validity has been extended (0 = never). */
  extensionCount: number;

  // ── Status & lifecycle ──
  status: EwbStatus;
  /** Generation mode: automatic (on dispatch confirm) or manual. */
  generationMode: "automatic" | "manual";

  // ── Consolidated EWB ──
  /** If merged into a consolidated EWB, its ID. */
  consolidatedEwbId: string | null;
  consolidatedEwbNumber: string | null;

  // ── Error tracking ──
  /** Last error message from the GSP / NIC portal. */
  lastError: string | null;
  /** Timestamp of last failed attempt. */
  lastErrorAt: string | null;

  // ── PDF / document storage ──
  /** S3 key or URL for the downloaded EWB PDF. */
  pdfUrl: string | null;

  // ── Audit ──
  generatedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  extendedAt: string | null;
  lastSyncedAt: string | null;

  createdAt: string;
  updatedAt: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Threshold (₹) above which an E-Way Bill is mandatory. */
export const EWB_THRESHOLD = 50_000;

/** Returns true if the taxable value requires an E-Way Bill. */
export function requiresEwb(taxableValue: number): boolean {
  return round2(taxableValue) > EWB_THRESHOLD;
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function list(clientId?: string) {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, {
      entityType: "EwayBill",
      limit: 500,
      reverse: true,
    });
    return items as EwayBill[];
  }
  return db.scanByType("EwayBill", { limit: 1000 }) as Promise<EwayBill[]>;
}

export async function get(id: string) {
  return db.getItem(`EWB#${id}`) as Promise<EwayBill | null>;
}

/** Get the EWB linked to a specific Goods Dispatch. */
export async function getByDispatchId(dispatchId: string) {
  const items = await db.scanByType("EwayBill", { limit: 500 });
  return (items as EwayBill[]).find((e) => e.goodsDispatchId === dispatchId) ?? null;
}

export async function create(
  data: Partial<EwayBill> & {
    clientId: string;
    goodsDispatchId: string;
    supplierGstin: string;
    recipientGstin: string;
    taxableValue: number;
  },
) {
  const id = uuid();
  const now = db.nowISO();
  const taxableValue = round2(Number(data.taxableValue) || 0);

  const item: EwayBill = {
    pk: `EWB#${id}`,
    sk: `EWB#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`,
    gsi1sk: `EwayBill#${now}`,
    entityType: "EwayBill",
    id,
    clientId: data.clientId,

    ewbNumber: null,
    ewbReplyId: null,

    goodsDispatchId: data.goodsDispatchId,
    dispatchNumber: data.dispatchNumber || null,
    salesInvoiceId: data.salesInvoiceId || null,
    salesInvoiceNumber: data.salesInvoiceNumber || null,

    supplierGstin: data.supplierGstin,
    supplierTradeName: data.supplierTradeName || null,
    supplierAddress: data.supplierAddress || null,
    supplierStateCode: data.supplierStateCode || data.supplierGstin.slice(0, 2),

    recipientGstin: data.recipientGstin,
    recipientTradeName: data.recipientTradeName || null,
    recipientAddress: data.recipientAddress || null,
    recipientStateCode: data.recipientStateCode || data.recipientGstin.slice(0, 2),

    documentNumber: data.documentNumber || "",
    documentDate: data.documentDate || db.todayDate(),

    taxableValue,
    cgstAmount: round2(Number(data.cgstAmount) || 0),
    sgstAmount: round2(Number(data.sgstAmount) || 0),
    igstAmount: round2(Number(data.igstAmount) || 0),
    cessAmount: round2(Number(data.cessAmount) || 0),
    totalValue:
      round2(Number(data.totalValue) || 0) ||
      round2(
        taxableValue +
          (Number(data.cgstAmount) || 0) +
          (Number(data.sgstAmount) || 0) +
          (Number(data.igstAmount) || 0) +
          (Number(data.cessAmount) || 0),
      ),

    hsnDetails: data.hsnDetails || [],

    transportMode: data.transportMode || "road",
    transporterGstin: data.transporterGstin || null,
    transporterId: data.transporterId || null,
    transporterName: data.transporterName || null,
    approxDistance: data.approxDistance ?? null,

    vehicleNumber: data.vehicleNumber || null,
    vehicleUpdateDate: null,
    partBMode: null,
    vehicleType: data.vehicleType || null,

    validFrom: data.validFrom || db.todayDate(),
    validUntil: data.validUntil || "",   // computed by GSP response
    extensionCount: 0,

    status: "pending",
    generationMode: data.generationMode || "automatic",

    consolidatedEwbId: null,
    consolidatedEwbNumber: null,

    lastError: null,
    lastErrorAt: null,
    pdfUrl: null,

    generatedAt: null,
    cancelledAt: null,
    cancelledBy: null,
    extendedAt: null,
    lastSyncedAt: null,

    createdAt: now,
    updatedAt: now,
  };

  await db.putItem(item);
  return item;
}

export async function update(id: string, updates: Partial<EwayBill>) {
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  const allowed = [
    "ewbNumber", "ewbReplyId",
    "dispatchNumber", "salesInvoiceId", "salesInvoiceNumber",
    "supplierTradeName", "supplierAddress", "supplierStateCode",
    "recipientTradeName", "recipientAddress", "recipientStateCode",
    "documentNumber", "documentDate",
    "taxableValue", "cgstAmount", "sgstAmount", "igstAmount", "cessAmount", "totalValue",
    "hsnDetails",
    "transportMode", "transporterGstin", "transporterId", "transporterName", "approxDistance",
    "vehicleNumber", "vehicleUpdateDate", "partBMode", "vehicleType",
    "validFrom", "validUntil", "extensionCount",
    "status", "generationMode",
    "consolidatedEwbId", "consolidatedEwbNumber",
    "lastError", "lastErrorAt",
    "pdfUrl",
    "generatedAt", "cancelledAt", "cancelledBy", "extendedAt", "lastSyncedAt",
  ];
  for (const k of allowed) {
    if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k];
  }
  return db.updateItem(`EWB#${id}`, `EWB#${id}`, patch);
}

export async function remove(id: string) {
  return db.deleteItem(`EWB#${id}`);
}

/** Mark EWB as successfully generated with NIC-assigned number. */
export async function markGenerated(
  id: string,
  ewbNumber: string,
  validUntil: string,
  ewbReplyId?: string,
) {
  return update(id, {
    ewbNumber,
    ewbReplyId: ewbReplyId || null,
    validUntil,
    status: "generated",
    generatedAt: db.nowISO(),
    lastError: null,
    lastErrorAt: null,
  });
}

/** Mark EWB generation as failed. */
export async function markFailed(id: string, errorMessage: string) {
  return update(id, {
    status: "failed",
    lastError: errorMessage,
    lastErrorAt: db.nowISO(),
  });
}

/** Cancel an EWB. */
export async function markCancelled(id: string, cancelledBy: string) {
  return update(id, {
    status: "cancelled",
    cancelledAt: db.nowISO(),
    cancelledBy,
  });
}

/** Update Part-B (vehicle assignment). */
export async function updatePartB(
  id: string,
  vehicleNumber: string,
  partBMode?: TransportMode,
  vehicleType?: string,
) {
  return update(id, {
    vehicleNumber,
    vehicleUpdateDate: db.todayDate(),
    partBMode: partBMode || null,
    vehicleType: vehicleType || null,
    status: "vehicle_updated",
  });
}

/** Extend validity. */
export async function extendValidity(id: string, newValidUntil: string) {
  const current = await get(id);
  return update(id, {
    validUntil: newValidUntil,
    extensionCount: ((current?.extensionCount ?? 0) + 1),
    status: "extended",
    extendedAt: db.nowISO(),
  });
}
