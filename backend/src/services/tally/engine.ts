import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import * as Invoice from "../../models/invoice.js";
import * as PurchaseInvoice from "../../models/purchase-invoice.js";
import * as Debtor from "../../models/debtor.js";
import * as Supplier from "../../models/supplier.js";
import * as Vendor from "../../models/vendor.js";
import * as Product from "../../models/product.js";
import * as PaymentReceipt from "../../models/payment-receipt.js";
import * as CreditDebitNote from "../../models/credit-debit-note.js";
import * as StockMovement from "../../models/stock-movement.js";
import * as Tally from "../../models/tally.js";
import * as db from "../../dynamodb.js";
import { isUnionTerritory, type TallyConfig, type TallyExportType, type TallyBatchRecord } from "../../models/tally.js";
import { splitGstInclusive, round2 } from "../../lib/gst.js";
import {
  envelope,
  ledgerEntry,
  inventoryEntry,
  message,
  tallyDate,
  validateXml1,
} from "./xml.js";
import {
  serializeCustomerMaster,
  serializeSupplierMaster,
  serializeStockItemMaster,
  serializeUnitMaster,
  serializeLedgerMaster,
} from "./serializers/masterSerializer.js";
import { serializeSalesVoucher } from "./serializers/salesSerializer.js";
import { serializePurchaseVoucher } from "./serializers/purchaseSerializer.js";
import { serializeReceiptVoucher } from "./serializers/receiptSerializer.js";
import { serializePaymentVoucher } from "./serializers/paymentSerializer.js";
import { serializeCreditNoteVoucher } from "./serializers/creditNoteSerializer.js";
import { serializeDebitNoteVoucher } from "./serializers/debitNoteSerializer.js";
import { generateManifestCsv } from "./manifestService.js";

export interface PreparedRecord {
  sourceId: string;
  sourceLabel: string;
  docNumber: string | null;
  date: string | null;
  party: string | null;
  voucherType: string;
  amount: number;
  contentHash: string;
  status: Tally.TallyRecordStatus;
  errors: string[];
  warnings: string[];
  totals: { taxable: number; gst: number; grandTotal: number };
  xml: string;
  exportedStatus?: Tally.TallyRecordStatus | null;
  lastBatchId?: string | null;
  exportedAt?: string | null;
}

export interface PreparedBatch {
  exportType: TallyExportType;
  reportName: "All Masters" | "Vouchers";
  records: PreparedRecord[];
  errors: string[];
  totals: { taxable: number; gst: number; grandTotal: number };
  xml: string;
  sha256: string;
  bytes: number;
}

export const STATE_CODES: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
};

export const UNIT_MAP: Record<string, string> = {
  piece: "pics",
  pieces: "pics",
  pcs: "pics",
  nos: "nos",
  number: "nos",
  numbers: "nos",
  pair: "pair",
  pairs: "pair",
  box: "box",
  boxes: "box",
  carton: "box",
  cartons: "box",
  dozen: "dozen",
  kg: "kg",
  kilogram: "kg",
  grams: "gm",
  gm: "gm",
  litre: "ltr",
  liter: "ltr",
  ltr: "ltr",
  metre: "mtr",
  meter: "mtr",
  mtr: "mtr",
};

export const STANDARD_UNITS: { name: string; originalName: string; decimalPlaces: number }[] = [
  { name: "pics", originalName: "Pieces", decimalPlaces: 0 },
  { name: "nos", originalName: "Numbers", decimalPlaces: 0 },
  { name: "pair", originalName: "Pairs", decimalPlaces: 0 },
  { name: "box", originalName: "Boxes", decimalPlaces: 0 },
  { name: "kg", originalName: "Kilograms", decimalPlaces: 2 },
  { name: "gm", originalName: "Grams", decimalPlaces: 2 },
  { name: "ltr", originalName: "Litres", decimalPlaces: 2 },
  { name: "mtr", originalName: "Metres", decimalPlaces: 2 },
  { name: "dozen", originalName: "Dozens", decimalPlaces: 0 },
];

// The application exposes a shared business portfolio to staff. Tally source
// lists must therefore use the shared entity scans; GSI client partitions can
// differ from the currently signed-in staff member.
//
// Every scan is memoized per request. A single export used to scan the same
// entity type several times (context loading, listing, validation, duplicate
// checks) and the dashboard scanned every type twice; each scan is billed per
// page, so the duplicates were pure cost.

export interface TallyRequestContext {
  clientId: string;
  config(): Promise<TallyConfig | null>;
  debtors(): Promise<any[]>;
  suppliers(): Promise<any[]>;
  vendors(): Promise<any[]>;
  products(): Promise<any[]>;
  movements(): Promise<any[]>;
  invoices(): Promise<any[]>;
  purchaseInvoices(): Promise<any[]>;
  receipts(): Promise<any[]>;
  notes(): Promise<any[]>;
  getDebtor(id: string): Promise<any | null>;
  getSupplier(id: string): Promise<any | null>;
  getVendor(id: string): Promise<any | null>;
  getProduct(id: string): Promise<any | null>;
  getInvoice(id: string): Promise<any | null>;
  getPurchaseInvoice(id: string): Promise<any | null>;
  getReceipt(id: string): Promise<any | null>;
  getNote(id: string): Promise<any | null>;
  getMovement(id: string): Promise<any | null>;
  exportRecords(): Promise<Tally.TallyExportRecord[]>;
  exportRecordMap(): Promise<Map<string, Tally.TallyExportRecord>>;
  batches(): Promise<Tally.TallyBatchSummary[]>;
}

function memoRead<T>(load: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | null = null;
  return () => (cached ??= load());
}

function memoReadById<T>(load: (id: string) => Promise<T | null>): (id: string) => Promise<T | null> {
  const cache = new Map<string, Promise<T | null>>();
  return (id: string) => {
    let p = cache.get(id);
    if (!p) {
      p = load(id).catch(() => null as T | null);
      cache.set(id, p);
    }
    return p;
  };
}

function allByType(entityType: string): Promise<any[]> {
  return db.listAllByType(entityType).catch(() => [] as any[]);
}

/**
 * Request-scoped read cache for Tally listing, validation, export generation
 * and the dashboard. Pass one instance per HTTP request (or per multi-step
 * operation); callers that do not pass one get an equivalent cache scoped to
 * that single call.
 */
export function createRequestContext(clientId: string): TallyRequestContext {
  const exportRecords = memoRead(() =>
    Tally.listExportRecords(clientId).catch(() => [] as Tally.TallyExportRecord[]),
  );
  return {
    clientId,
    config: memoRead(() => getTallyConfig(clientId)),
    debtors: memoRead(() => allByType("Debtor")),
    suppliers: memoRead(() => allByType("Supplier")),
    vendors: memoRead(() => allByType("Vendor")),
    products: memoRead(() => allByType("Product")),
    movements: memoRead(() => allByType("StockMovement")),
    invoices: memoRead(() => allByType("Invoice")),
    purchaseInvoices: memoRead(() => allByType("PurchaseInvoice")),
    receipts: memoRead(() => allByType("PaymentReceipt")),
    notes: memoRead(() => allByType("CreditDebitNote")),
    getDebtor: memoReadById((id) => Debtor.get(id)),
    getSupplier: memoReadById((id) => Supplier.get(id)),
    getVendor: memoReadById((id) => Vendor.get(id)),
    getProduct: memoReadById((id) => Product.get(id)),
    getInvoice: memoReadById((id) => Invoice.get(id)),
    getPurchaseInvoice: memoReadById((id) => PurchaseInvoice.get(id)),
    getReceipt: memoReadById((id) => PaymentReceipt.get(id)),
    getNote: memoReadById((id) => CreditDebitNote.get(id)),
    getMovement: memoReadById((id) => StockMovement.get(id)),
    exportRecords,
    exportRecordMap: memoRead(async () => {
      const map = new Map<string, Tally.TallyExportRecord>();
      for (const rec of await exportRecords()) {
        map.set(`${rec.exportType}|${rec.sourceId}`, rec);
      }
      return map;
    }),
    batches: memoRead(() =>
      Tally.listBatchSummaries(clientId).catch(() => [] as Tally.TallyBatchSummary[]),
    ),
  };
}

async function selectedInvoiceRows(
  ids: Set<string> | null,
  request: TallyRequestContext,
): Promise<any[]> {
  if (!ids) return request.invoices();
  const rows = await Promise.all([...ids].map((id) => Invoice.get(id)));
  return rows.filter((row): row is any => !!row);
}

async function selectedPurchaseInvoiceRows(
  ids: Set<string> | null,
  request: TallyRequestContext,
): Promise<any[]> {
  if (!ids) return request.purchaseInvoices();
  const rows = await Promise.all([...ids].map((id) => PurchaseInvoice.get(id)));
  return rows.filter((row): row is any => !!row);
}

function mergeReceiptRows(invoices: any[], receipts: any[]): any[] {
  const verified = (receipts as any[]).filter((r) => r.status === "verified" && r.invoiceId);
  const receivedByInvoice = new Map<string, number>();
  for (const receipt of verified) {
    receivedByInvoice.set(
      receipt.invoiceId,
      round2((receivedByInvoice.get(receipt.invoiceId) || 0) + (Number(receipt.amount) || 0)),
    );
  }

  const rows = [...verified];
  for (const invoice of invoices as any[]) {
    if (!invoice?.id) continue;
    const status = String(invoice.status || "").toLowerCase();
    if (status === "cancelled") continue;
    const booked = Number(invoice.amountReceived) || 0;
    const net = Number(invoice.amount) || Number(invoice.grandTotal) || 0;
    const expected = booked > 0 ? booked : status === "paid" ? net : 0;
    const already = receivedByInvoice.get(invoice.id) || 0;
    const missing = round2(expected - already);
    if (!(missing > 0.005)) continue;
    const date = invoice.receiptDate || invoice.paidDate || invoice.issueDate || new Date().toISOString().slice(0, 10);
    rows.push({
      id: `invoice-receipt:${invoice.id}`,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      amount: missing,
      utr: invoice.utr_reference || invoice.utrReference || null,
      receiptDate: date,
      submittedAt: date,
      status: "verified",
      paymentMode: null,
      collectionAccount: null,
      receiptNumber: invoice.invoiceNumber ? `RCT-${invoice.invoiceNumber}` : null,
      synthetic: true,
    });
  }
  return rows;
}

export function stateNameFromCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const digits = String(code).trim().slice(0, 2).padStart(2, "0");
  return STATE_CODES[digits] ?? null;
}

export function normState(s: string | null | undefined): string {
  return (s || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\s+/g, " ");
}

export function normalizeName(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/&#(?:x0*[0-8BbCcEeEfF]|0*4);?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isValidGstin(value: unknown): boolean {
  const gstin = normalizeName(value).toUpperCase();
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][Z][0-9A-Z]$/.test(gstin);
}

export function unitFor(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  const key = String(value).trim().toLowerCase();
  return UNIT_MAP[key] || String(value).trim() || fallback;
}

export function gstHeadNames(
  config: TallyConfig,
  intra: boolean,
  ut: boolean,
  direction: "output" | "input",
): { head: string; ledger: string }[] {
  const m = config.mappings;
  const prefix = direction === "output" ? "Output" : "Input";
  const pick = (k: "cgst" | "sgst" | "utgst" | "igst") =>
    (m[`${k}${prefix}Ledger` as keyof typeof m] as string) || "";
  if (!intra) return [{ head: "IGST", ledger: pick("igst") }];
  if (ut) {
    return [
      { head: "CGST", ledger: pick("cgst") },
      { head: "SGST/UTGST", ledger: pick("utgst") || pick("sgst") },
    ];
  }
  return [
    { head: "CGST", ledger: pick("cgst") },
    { head: "SGST/UTGST", ledger: pick("sgst") },
  ];
}

export function splitAcrossHeads(total: number, heads: { head: string; ledger: string }[]) {
  if (heads.length === 1) return [{ ...heads[0], amount: round2(total) }];
  const first = round2(total / 2);
  return [
    { ...heads[0], amount: first },
    { ...heads[1], amount: round2(total - first) },
  ];
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function invoiceLineAmount(line: any): number {
  if (Number(line.lineTotal) > 0) return round2(Number(line.lineTotal));
  const q = Number(line.quantity ?? line.invoiceQty ?? 0);
  const price = Number(line.unitPrice ?? 0);
  const disc = Number(line.discountPct ?? 0);
  return round2(q * price * (1 - disc / 100));
}

export function detectLineMode(
  lines: any[],
  doc: { taxable?: number | null; gst?: number | null; grandTotal?: number | null },
): "inclusive" | "exclusive" {
  const sumLine = round2(lines.reduce((s, l) => s + invoiceLineAmount(l), 0));
  const taxable = doc.taxable === null || doc.taxable === undefined ? null : round2(Number(doc.taxable));
  const gst = doc.gst === null || doc.gst === undefined ? null : round2(Number(doc.gst));
  const grand = doc.grandTotal === null || doc.grandTotal === undefined ? null : round2(Number(doc.grandTotal));
  if (taxable !== null && Math.abs(sumLine - taxable) <= 0.05) return "exclusive";
  if (grand !== null && Math.abs(sumLine - grand) <= 0.05) return "inclusive";
  if (taxable !== null && gst !== null && Math.abs(sumLine - (taxable + gst)) <= 0.05) return "inclusive";
  return "inclusive";
}

export function splitLine(lineAmount: number, rateValue: number, mode: "inclusive" | "exclusive") {
  if (mode === "exclusive") {
    const taxableValue = round2(lineAmount);
    return {
      taxableValue,
      gstAmount: round2(lineAmount * (rateValue / 100)),
      total: round2(lineAmount * (1 + rateValue / 100)),
    };
  }
  return splitGstInclusive(lineAmount, rateValue);
}

export class VoucherBuilder {
  entries: string[] = [];
  sumSigned = 0;

  add(opts: Parameters<typeof ledgerEntry>[0]) {
    this.entries.push(ledgerEntry(opts));
    this.sumSigned = round2(this.sumSigned + round2(opts.amount));
  }

  addInventory(opts: Parameters<typeof inventoryEntry>[0]) {
    this.entries.push(inventoryEntry(opts));
    const accounting = round2(opts.amount);
    this.sumSigned = round2(this.sumSigned + accounting);
  }

  finish(roundOffLedger: string, label: string, log: { errors: string[]; warnings: string[] }) {
    const diff = round2(-this.sumSigned);
    if (Math.abs(diff) > 0.01) {
      log.errors.push(
        `Voucher blocked: debit and credit do not match. Difference: ₹${diff.toFixed(2)}.`,
      );
    } else if (Math.abs(diff) > 0.005) {
      if (!roundOffLedger) {
        log.errors.push(
          `Voucher blocked: debit and credit do not match. Difference: ₹${diff.toFixed(2)}. Round-off ledger is not configured.`,
        );
      } else {
        this.entries.push(
          ledgerEntry({
            ledger: roundOffLedger,
            amount: diff,
            positive: diff < 0,
          }),
        );
        this.sumSigned = round2(this.sumSigned + diff);
      }
    }
    if (Math.abs(this.sumSigned) > 0.005) {
      log.errors.push(`${label}: voucher does not balance (difference ${this.sumSigned.toFixed(2)}).`);
    }
    return this.entries.join("");
  }
}

export interface BuildContext {
  config: TallyConfig;
  debtorsById: Map<string, any>;
  suppliersById: Map<string, any>;
  productsById: Map<string, any>;
  openingByProduct: Map<string, { qty: number; value: number }>;
}

export function partyStateForInvoice(inv: any, ctx: BuildContext): string | null {
  const debtor = ctx.debtorsById.get(inv.debtorId);
  return inv.placeOfSupply || inv.deliveryState || debtor?.state || null;
}

export function partyStateForPurchase(pi: any, ctx: BuildContext): string | null {
  const supplier = ctx.suppliersById.get(pi.vendorId) || ctx.suppliersById.get(pi.billToSupplierId);
  return (
    (pi as any).placeOfSupply ||
    stateNameFromCode(supplier?.stateCode) ||
    supplier?.state ||
    null
  );
}

export async function loadContext(
  clientId: string,
  config: TallyConfig,
  exportType?: TallyExportType,
  context?: TallyRequestContext,
  ids?: string[],
): Promise<BuildContext> {
  const request = context ?? createRequestContext(clientId);

  if (!ids || !ids.length) {
    throw Object.assign(new Error("Record IDs are required for Tally export."), { status: 400 });
  }
  return loadContextByIds(request, clientId, config, exportType, ids);
}

function collectProductIds(row: any, out: Set<string>) {
  const lines = row.items || row.lineItems || row.lines || [];
  for (const line of lines) {
    if (line?.productId) out.add(line.productId);
    if (line?.product) out.add(line.product);
  }
}

async function loadContextByIds(
  request: TallyRequestContext,
  clientId: string,
  config: TallyConfig,
  exportType: TallyExportType | undefined,
  ids: string[],
): Promise<BuildContext> {
  const needsDebtors = !exportType || ["customers", "sales", "receipts", "credit-notes"].includes(exportType);
  const needsSuppliers = !exportType || ["suppliers", "purchases", "payments", "debit-notes"].includes(exportType);
  const needsVendors = needsSuppliers;
  const needsProducts = !exportType || ["stock-items", "sales", "purchases", "credit-notes", "debit-notes"].includes(exportType);
  const needsMovements = !exportType || exportType === "stock-items";

  const debtorIds = new Set<string>();
  const supplierIds = new Set<string>();
  const vendorIds = new Set<string>();
  const productIds = new Set<string>();
  const invoiceIds = new Set<string>();
  const purchaseInvoiceIds = new Set<string>();

  // Phase 1: fetch primary records by ID
  const primaryRows: any[] = [];
  switch (exportType) {
    case "customers":
      primaryRows.push(...(await Promise.all(ids.map((id) => request.getDebtor(id)))).filter(Boolean));
      break;
    case "suppliers": {
      const [sups, vens] = await Promise.all([
        Promise.all(ids.map((id) => request.getSupplier(id))),
        Promise.all(ids.map((id) => request.getVendor(id))),
      ]);
      primaryRows.push(...sups.filter(Boolean), ...vens.filter(Boolean));
      break;
    }
    case "stock-items":
      primaryRows.push(...(await Promise.all(ids.map((id) => request.getProduct(id)))).filter(Boolean));
      break;
    case "sales":
      primaryRows.push(...(await Promise.all(ids.map((id) => request.getInvoice(id)))).filter(Boolean));
      break;
    case "purchases":
      primaryRows.push(...(await Promise.all(ids.map((id) => request.getPurchaseInvoice(id)))).filter(Boolean));
      break;
    case "receipts":
      primaryRows.push(...(await Promise.all(ids.map((id) => request.getReceipt(id)))).filter(Boolean));
      break;
    case "payments":
      primaryRows.push(...(await Promise.all(ids.map((id) => request.getPurchaseInvoice(id)))).filter(Boolean));
      break;
    case "credit-notes":
    case "debit-notes":
      primaryRows.push(...(await Promise.all(ids.map((id) => request.getNote(id)))).filter(Boolean));
      break;
  }

  // Phase 2: collect referenced IDs from primary records
  for (const row of primaryRows) {
    if (row.debtorId) debtorIds.add(row.debtorId);
    if (row.supplierId) supplierIds.add(row.supplierId);
    if (row.vendorId) vendorIds.add(row.vendorId);
    if (row.productId) productIds.add(row.productId);
    if (row.invoiceId) invoiceIds.add(row.invoiceId);
    if (row.purchaseInvoiceId) purchaseInvoiceIds.add(row.purchaseInvoiceId);
    collectProductIds(row, productIds);
  }

  // Phase 3: resolve invoice/purchase-invoice references to find more party refs
  if (invoiceIds.size > 0) {
    const invoices = await Promise.all([...invoiceIds].map((id) => request.getInvoice(id)));
    for (const inv of invoices.filter(Boolean)) {
      if (inv?.debtorId) debtorIds.add(inv.debtorId);
      if (inv?.supplierId) supplierIds.add(inv.supplierId);
      collectProductIds(inv, productIds);
    }
  }
  if (purchaseInvoiceIds.size > 0) {
    const purchases = await Promise.all([...purchaseInvoiceIds].map((id) => request.getPurchaseInvoice(id)));
    for (const pi of purchases.filter(Boolean)) {
      if (pi?.supplierId) supplierIds.add(pi.supplierId);
      if (pi?.vendorId) vendorIds.add(pi.vendorId);
      collectProductIds(pi, productIds);
    }
  }

  // Phase 4: fetch referenced parties and products by ID (no scans)
  const [debtors, suppliers, vendors, products] = await Promise.all([
    needsDebtors ? Promise.all([...debtorIds].map((id) => request.getDebtor(id))) : Promise.resolve([] as any[]),
    needsSuppliers ? Promise.all([...supplierIds].map((id) => request.getSupplier(id))) : Promise.resolve([] as any[]),
    needsVendors ? Promise.all([...vendorIds].map((id) => request.getVendor(id))) : Promise.resolve([] as any[]),
    needsProducts ? Promise.all([...productIds].map((id) => request.getProduct(id))) : Promise.resolve([] as any[]),
  ]);

  const debtorsById = new Map<string, any>();
  for (const d of debtors.filter(Boolean)) debtorsById.set(d.id, d);

  const suppliersById = new Map<string, any>();
  for (const s of suppliers.filter(Boolean)) suppliersById.set(s.id, s);
  for (const v of vendors.filter(Boolean)) {
    suppliersById.set(v.id, {
      ...v,
      companyName: v.companyName || v.name,
      stateCode: v.stateCode || null,
      state: v.state || null,
    });
  }

  const productsById = new Map<string, any>();
  for (const p of products.filter(Boolean)) productsById.set(p.id, p);

  // Phase 5: opening balances for referenced products (GSI1 queries, not scans)
  const openingByProduct = new Map<string, { qty: number; value: number }>();
  if (needsMovements && productIds.size > 0) {
    const movementLists = await Promise.all(
      [...productIds].map((pid) => StockMovement.getByProduct(clientId, pid).catch(() => [] as any[])),
    );
    for (const movements of movementLists) {
      for (const m of movements as any[]) {
        if (m.status !== "confirmed" || !m.productId) continue;
        const bucket = openingByProduct.get(m.productId) || { qty: 0, value: 0 };
        const q = Number(m.quantity) || 0;
        const delta = m.direction === "in" ? q : -q;
        bucket.qty = round2(bucket.qty + delta);
        bucket.value = round2(bucket.value + delta * (Number(m.unitCost) || 0));
        openingByProduct.set(m.productId, bucket);
      }
    }
  }

  return { config, debtorsById, suppliersById, productsById, openingByProduct };
}

export interface SelectableRecord {
  sourceId: string;
  label: string;
  docNumber: string | null;
  date: string | null;
  party: string | null;
  amount: number;
  taxAmount?: number;
  paymentStatus?: string;
  voucherType: string;
  detail?: string;
  exportedStatus?: Tally.TallyRecordStatus | null;
  lastBatchId?: string | null;
  lastExportedDate?: string | null;
  missingInfo?: string[];
}

const TYPE_LABEL: Record<TallyExportType, string> = {
  customers: "Customer",
  suppliers: "Supplier",
  "stock-items": "Stock Item",
  units: "Unit of Measure",
  ledgers: "Account Ledger",
  sales: "Sales Invoice",
  purchases: "Purchase Invoice",
  receipts: "Receipt",
  payments: "Payment",
  "credit-notes": "Credit Note",
  "debit-notes": "Debit Note",
};

export async function listSelectable(
  clientId: string,
  exportType: TallyExportType,
  context?: TallyRequestContext,
): Promise<SelectableRecord[]> {
  const out: SelectableRecord[] = [];
  const request = context ?? createRequestContext(clientId);
  const config = await request.config();

  if (exportType === "customers") {
    const rows = await request.debtors();
    for (const d of rows as any[]) {
      const missing: string[] = [];
      if (!d.gstin) missing.push("GSTIN missing");
      if (!d.state) missing.push("State missing");
      if (!d.billingAddress) missing.push("Address missing");
      out.push({
        sourceId: d.id,
        label: d.name,
        docNumber: d.id.slice(0, 8),
        date: null,
        party: d.name,
        amount: Number(d.openingBalance) || 0,
        voucherType: "Ledger",
        detail: [d.city, d.state, d.gstin].filter(Boolean).join(" | "),
        missingInfo: missing,
      });
    }
  } else if (exportType === "suppliers") {
    const [supplierRows, vendorRows] = await Promise.all([
      request.suppliers(),
      request.vendors(),
    ]);
    const rows = [
      ...supplierRows,
      ...vendorRows.map((v: any) => ({
        ...v,
        companyName: v.companyName || v.name,
        supplierCode: v.vendorCode || v.supplierCode,
      })),
    ];
    for (const s of rows as any[]) {
      const missing: string[] = [];
      if (!s.gstin) missing.push("GSTIN missing");
      if (!s.state && !s.stateCode) missing.push("State missing");
      out.push({
        sourceId: s.id,
        label: s.companyName,
        docNumber: s.supplierCode || s.id.slice(0, 8),
        date: null,
        party: s.companyName,
        amount: Number(s.openingBalance) || 0,
        voucherType: "Ledger",
        detail: [s.city, s.gstin].filter(Boolean).join(" | "),
        missingInfo: missing,
      });
    }
  } else if (exportType === "stock-items") {
    const rows = await request.products();
    for (const p of rows as any[]) {
      const missing: string[] = [];
      if (!p.hsnCode) missing.push("HSN missing");
      if (p.gstRate === undefined || p.gstRate === null) missing.push("GST rate missing");
      if (!p.unitOfMeasure) missing.push("Unit missing");
      out.push({
        sourceId: p.id,
        label: p.name,
        docNumber: p.sku,
        date: null,
        party: p.category || "",
        amount: Number(p.unitPrice) || 0,
        voucherType: "Stock Item",
        detail: [p.sku, p.hsnCode, p.unitOfMeasure].filter(Boolean).join(" | "),
        missingInfo: missing,
      });
    }
  } else if (exportType === "units") {
    for (const u of STANDARD_UNITS) {
      out.push({
        sourceId: `unit-${u.name}`,
        label: `${u.name} (${u.originalName})`,
        docNumber: u.name,
        date: null,
        party: u.originalName,
        amount: u.decimalPlaces,
        voucherType: "Unit",
        detail: `Decimal places: ${u.decimalPlaces}`,
        missingInfo: [],
      });
    }
  } else if (exportType === "ledgers") {
    const m = config?.mappings || Tally.EMPTY_MAPPING;
    const ledgerList = [
      { id: "ledger-sales", name: m.salesLedger || "Sales", group: m.salesGroup || "Sales Accounts" },
      { id: "ledger-purchase", name: m.purchaseLedger || "Purchase", group: m.purchaseGroup || "Purchase Accounts" },
      { id: "ledger-bank", name: m.bankLedger || "Bank Account", group: m.bankGroup || "Bank Accounts" },
      { id: "ledger-cash", name: m.cashLedger || "Cash", group: "Cash-in-hand" },
      { id: "ledger-roundoff", name: m.roundOffLedger || "Round Off", group: "Indirect Expenses" },
      { id: "ledger-freight", name: m.freightLedger || "Freight & Transport", group: "Direct Expenses" },
      { id: "ledger-cgst-out", name: m.cgstOutputLedger || "CGST Output", group: m.gstGroup || "Duties & Taxes" },
      { id: "ledger-sgst-out", name: m.sgstOutputLedger || "SGST Output", group: m.gstGroup || "Duties & Taxes" },
      { id: "ledger-utgst-out", name: m.utgstOutputLedger || "UTGST Output", group: m.gstGroup || "Duties & Taxes" },
      { id: "ledger-igst-out", name: m.igstOutputLedger || "IGST Output", group: m.gstGroup || "Duties & Taxes" },
      { id: "ledger-cgst-in", name: m.cgstInputLedger || "CGST Input", group: m.gstGroup || "Duties & Taxes" },
      { id: "ledger-sgst-in", name: m.sgstInputLedger || "SGST Input", group: m.gstGroup || "Duties & Taxes" },
      { id: "ledger-utgst-in", name: m.utgstInputLedger || "UTGST Input", group: m.gstGroup || "Duties & Taxes" },
      { id: "ledger-igst-in", name: m.igstInputLedger || "IGST Input", group: m.gstGroup || "Duties & Taxes" },
    ];
    for (const l of ledgerList) {
      out.push({
        sourceId: l.id,
        label: l.name,
        docNumber: l.id,
        date: null,
        party: l.group,
        amount: 0,
        voucherType: "Ledger",
        detail: `Parent Group: ${l.group}`,
        missingInfo: !l.name ? ["Ledger name not set"] : [],
      });
    }
  } else if (exportType === "sales") {
    const rows = await request.invoices();
    const debtors = await request.debtors();
    const debtorById = new Map<string, any>();
    for (const d of debtors as any[]) {
      debtorById.set(d.id, d);
    }
    for (const i of rows as any[]) {
      const debtor = debtorById.get(i.debtorId);
      const customerName = debtor?.name || i.customerName || i.customer_name || null;
      const missing: string[] = [];
      if (!customerName && !i.debtorId) missing.push("Customer missing");
      if (!i.invoiceNumber) missing.push("Invoice # missing");
      out.push({
        sourceId: i.id,
        label: i.invoiceNumber,
        docNumber: i.invoiceNumber,
        date: i.issueDate,
        party: customerName,
        amount: Number(i.grandTotal) || Number(i.amount) || 0,
        taxAmount: Number(i.gstTotal) || Number(i.taxAmount) || 0,
        paymentStatus: i.paymentStatus || i.status,
        voucherType: "Sales",
        detail: i.status,
        missingInfo: missing,
      });
    }
  } else if (exportType === "purchases") {
    const rows = await request.purchaseInvoices();
    const [supplierRows, vendorRows] = await Promise.all([
      request.suppliers(),
      request.vendors(),
    ]);
    const supplierById = new Map<string, any>();
    for (const s of supplierRows as any[]) supplierById.set(s.id, s);
    for (const v of vendorRows as any[]) supplierById.set(v.id, { ...v, companyName: v.companyName || v.name });
    for (const p of rows as any[]) {
      const supplier =
        supplierById.get(p.vendorId) ||
        supplierById.get(p.billToSupplierId);
      const supplierName = p.supplierName || supplier?.companyName || supplier?.name || p.billToName || null;
      const missing: string[] = [];
      if (!supplierName && !p.vendorId && !p.billToSupplierId) missing.push("Supplier missing");
      if (!p.invoiceNumber) missing.push("Invoice # missing");
      out.push({
        sourceId: p.id,
        label: p.invoiceNumber,
        docNumber: p.invoiceNumber,
        date: p.issueDate,
        party: supplierName,
        amount: Number(p.grandTotal) || Number(p.amount) || 0,
        taxAmount: Number(p.gstTotal) || 0,
        paymentStatus: p.paymentStatus || p.status,
        voucherType: "Purchase",
        detail: p.status,
        missingInfo: missing,
      });
    }
  } else if (exportType === "receipts") {
    const [receiptRows, invoices, debtors] = await Promise.all([
      request.receipts(),
      request.invoices(),
      request.debtors(),
    ]);
    const rows = mergeReceiptRows(invoices, receiptRows);
    const invoiceById = new Map<string, any>();
    for (const i of invoices as any[]) invoiceById.set(i.id, i);
    const debtorById = new Map<string, any>();
    for (const d of debtors as any[]) debtorById.set(d.id, d);
    for (const r of rows as any[]) {
      if (r.status !== "verified" || !r.invoiceId) continue;
      const invoice = invoiceById.get(r.invoiceId);
      const debtor = invoice ? debtorById.get(invoice.debtorId) : null;
      const customerName = debtor?.name || r.customerName || r.customer_name || invoice?.customerName || null;
      out.push({
        sourceId: r.id,
        label: r.utr || r.invoiceNumber || r.id.slice(0, 8),
        docNumber: r.invoiceNumber || r.id.slice(0, 8),
        date: r.receiptDate || r.submittedAt,
        party: customerName,
        amount: Number(r.amount) || 0,
        taxAmount: 0,
        paymentStatus: r.status,
        voucherType: "Receipt",
        detail: r.synthetic ? "verified from paid invoice" : r.status,
        missingInfo: [],
      });
    }
  } else if (exportType === "payments") {
    const rows = await request.purchaseInvoices();
    const [supplierRows, vendorRows] = await Promise.all([
      request.suppliers(),
      request.vendors(),
    ]);
    const supplierById = new Map<string, any>();
    for (const s of supplierRows as any[]) supplierById.set(s.id, s);
    for (const v of vendorRows as any[]) supplierById.set(v.id, { ...v, companyName: v.companyName || v.name });
    for (const p of rows as any[]) {
      if (!(Number(p.amountPaid) > 0)) continue;
      const supplier =
        supplierById.get(p.vendorId) ||
        supplierById.get(p.billToSupplierId);
      const supplierName = p.supplierName || supplier?.companyName || supplier?.name || p.billToName || null;
      out.push({
        sourceId: p.id,
        label: p.invoiceNumber,
        docNumber: p.invoiceNumber,
        date: p.paidDate || p.issueDate,
        party: supplierName,
        amount: Number(p.amountPaid) || 0,
        taxAmount: 0,
        paymentStatus: p.status,
        voucherType: "Payment",
        detail: `Paid ${Number(p.amountPaid).toFixed(2)}`,
        missingInfo: [],
      });
    }
  } else if (exportType === "credit-notes" || exportType === "debit-notes") {
    const rows = await request.notes();
    const want = exportType === "credit-notes" ? "credit" : "debit";
    const [invoices, purchases, debtors, suppliers, vendors] = await Promise.all([
      request.invoices(),
      request.purchaseInvoices(),
      request.debtors(),
      request.suppliers(),
      request.vendors(),
    ]);
    const invoiceById = new Map<string, any>();
    for (const i of invoices as any[]) invoiceById.set(i.id, i);
    const purchaseById = new Map<string, any>();
    for (const p of purchases as any[]) purchaseById.set(p.id, p);
    const debtorById = new Map<string, any>();
    for (const d of debtors as any[]) debtorById.set(d.id, d);
    const supplierById = new Map<string, any>();
    for (const s of suppliers as any[]) supplierById.set(s.id, s);
    for (const v of vendors as any[]) supplierById.set(v.id, { ...v, companyName: v.companyName || v.name });
    for (const n of rows as any[]) {
      if (n.kind !== want) continue;
      let party = n.counterparty || null;
      if (want === "credit") {
        const source = n.sourceInvoiceId ? invoiceById.get(n.sourceInvoiceId) : null;
        party = party || (source ? debtorById.get(source.debtorId)?.name : null) || source?.customerName || null;
      } else {
        const source = n.sourcePurchaseInvoiceId ? purchaseById.get(n.sourcePurchaseInvoiceId) : null;
        const supplier = source ? supplierById.get(source.vendorId) || supplierById.get(source.billToSupplierId) : null;
        party = party || supplier?.companyName || supplier?.name || source?.supplierName || null;
      }
      out.push({
        sourceId: n.id,
        label: n.noteNumber,
        docNumber: n.noteNumber,
        date: n.noteDate,
        party,
        amount: Number(n.amount) || 0,
        taxAmount: Number(n.taxAmount) || 0,
        paymentStatus: n.status,
        voucherType: want === "credit" ? "Credit Note" : "Debit Note",
        detail: n.status,
        missingInfo: [],
      });
    }
  }

  const exported = await request.exportRecords();
  const byKey = new Map<string, any>();
  for (const r of exported as any[]) byKey.set(`${r.exportType}|${r.sourceId}`, r);
  for (const row of out) {
    const rec = byKey.get(`${exportType}|${row.sourceId}`);
    row.exportedStatus = rec?.status ?? null;
    row.lastBatchId = rec?.lastBatchId ?? null;
    row.lastExportedDate = rec?.exportedAt ?? null;
  }
  return out;
}

export function typeLabel(type: TallyExportType): string {
  return TYPE_LABEL[type] || type;
}

export async function buildRecords(
  clientId: string,
  exportType: TallyExportType,
  config: TallyConfig,
  ids?: string[],
  context?: TallyRequestContext,
): Promise<{ reportName: "All Masters" | "Vouchers"; prepared: PreparedRecord[] }> {
  const request = context ?? createRequestContext(clientId);
  const ctx = await loadContext(clientId, config, exportType, request, ids);
  const idSet = ids && ids.length ? new Set(ids) : null;
  const prepared: PreparedRecord[] = [];

  // Masters
  if (exportType === "customers" || exportType === "suppliers") {
    let rows: any[];
    if (exportType === "customers") {
      rows = (await Promise.all([...idSet!].map((id) => request.getDebtor(id)))).filter(Boolean);
    } else {
      const [suppliers, vendors] = await Promise.all([
        Promise.all([...idSet!].map((id) => request.getSupplier(id))),
        Promise.all([...idSet!].map((id) => request.getVendor(id))),
      ]);
      rows = [
        ...suppliers.filter(Boolean),
        ...vendors.filter(Boolean).map((v: any) => ({
          ...v,
          companyName: v.companyName || v.name,
          supplierCode: v.vendorCode || v.supplierCode,
        })),
      ];
    }
    for (const row of rows as any[]) {
      if (idSet && !idSet.has(row.id)) continue;
      const errors: string[] = [];
      const warnings: string[] = [];
      const name = exportType === "customers" ? row.name : row.companyName;
      if (!name) errors.push("Ledger name is missing.");
      const gstin = exportType === "customers" ? row.gstin : row.gstin;
      if (gstin && !isValidGstin(gstin)) {
        errors.push(exportType === "customers"
          ? "Invalid customer GSTIN. Leave it blank for demo data or enter a valid 15-character GSTIN."
          : "Invalid supplier GSTIN. Leave it blank for demo data or enter a valid 15-character GSTIN.");
      }
      if (exportType === "customers") {
        if (!row.state && !row.stateCode) errors.push("Customer state or state code is missing.");
        if (!row.billingAddress) errors.push("Customer billing address is missing.");
      } else {
        if (!row.state && !row.stateCode) errors.push("Supplier state or state code is missing.");
        if (!row.addressLine && !row.address) errors.push("Supplier address is missing.");
      }
      if (!(exportType === "customers" ? config.mappings.debtorsGroup : config.mappings.creditorsGroup)) {
        errors.push("Ledger group is not configured.");
      }
      const masterXml =
        exportType === "customers"
          ? serializeCustomerMaster(row, config)
          : serializeSupplierMaster(row, config, stateNameFromCode);
      const xml = message(masterXml);
      prepared.push({
        sourceId: row.id,
        sourceLabel: name || row.id,
        docNumber: exportType === "customers" ? row.id.slice(0, 8) : row.supplierCode || row.id.slice(0, 8),
        date: null,
        party: name || null,
        voucherType: "Ledger",
        amount: Number(row.openingBalance) || 0,
        contentHash: sha256(xml + config.companyName),
        status: errors.length ? "Validation Failed" : "Ready",
        errors,
        warnings,
        totals: { taxable: 0, gst: 0, grandTotal: Number(row.openingBalance) || 0 },
        xml,
      });
    }
    return { reportName: "All Masters", prepared };
  }

  if (exportType === "stock-items") {
    const rows = (await Promise.all([...idSet!].map((id) => request.getProduct(id)))).filter(Boolean);
    // One bulk lookup instead of a GetItem per stock item.
    const exportRecords = await request.exportRecordMap();
    for (const row of rows as any[]) {
      if (idSet && !idSet.has(row.id)) continue;
      const errors: string[] = [];
      const warnings: string[] = [];
      if (!row.name) errors.push("Stock item name is missing.");
      if (!config.godownName) errors.push("Tally godown / warehouse is not configured.");
      if (!row.unitOfMeasure) errors.push("Unit of measure is missing.");
      if (!row.hsnCode) errors.push("HSN code is missing.");
      if (row.gstRate === undefined || row.gstRate === null || row.gstRate === "") {
        errors.push("GST rate is missing.");
      }
      const opening = ctx.openingByProduct.get(row.id) || { qty: 0, value: 0 };
      if (opening.qty > 0 && !(Math.abs(opening.value) > 0.005)) {
        warnings.push("Opening quantity exists, but opening value/rate is missing.");
      }
      if (row.skuLevel === "parent") warnings.push("Parent product exported as a stock item; variants export separately.");

      const existingExport = exportRecords.get(`stock-items|${row.id}`) ?? null;
      const action =
        existingExport && ["Exported", "Downloaded", "Imported"].includes(existingExport.status)
          ? "Alter"
          : "Create";
      const masterXml = serializeStockItemMaster(row, ctx, unitFor, action);
      const xml = message(masterXml);
      prepared.push({
        sourceId: row.id,
        sourceLabel: row.name || row.id,
        docNumber: row.sku || null,
        date: null,
        party: row.category || null,
        voucherType: "Stock Item",
        amount: Number(row.unitPrice) || 0,
        contentHash: sha256(xml + config.companyName),
        status: errors.length ? "Validation Failed" : "Ready",
        errors,
        warnings,
        totals: { taxable: 0, gst: 0, grandTotal: 0 },
        xml,
      });
    }
    return { reportName: "All Masters", prepared };
  }

  if (exportType === "units") {
    for (const u of STANDARD_UNITS) {
      const id = `unit-${u.name}`;
      if (idSet && !idSet.has(id)) continue;
      const unitXml = serializeUnitMaster(u.name, u.originalName, u.decimalPlaces);
      const xml = message(unitXml);
      prepared.push({
        sourceId: id,
        sourceLabel: `${u.name} (${u.originalName})`,
        docNumber: u.name,
        date: null,
        party: u.originalName,
        voucherType: "Unit",
        amount: 0,
        contentHash: sha256(xml + config.companyName),
        status: "Ready",
        errors: [],
        warnings: [],
        totals: { taxable: 0, gst: 0, grandTotal: 0 },
        xml,
      });
    }
    return { reportName: "All Masters", prepared };
  }

  if (exportType === "ledgers") {
    const m = config.mappings || Tally.EMPTY_MAPPING;
    const ledgerList = [
      { id: "ledger-sales", name: m.salesLedger || "Sales", group: m.salesGroup || "Sales Accounts" },
      { id: "ledger-purchase", name: m.purchaseLedger || "Purchase", group: m.purchaseGroup || "Purchase Accounts" },
      { id: "ledger-bank", name: m.bankLedger || "Bank Account", group: m.bankGroup || "Bank Accounts" },
      { id: "ledger-cash", name: m.cashLedger || "Cash", group: "Cash-in-hand" },
      { id: "ledger-roundoff", name: m.roundOffLedger || "Round Off", group: "Indirect Expenses" },
      { id: "ledger-freight", name: m.freightLedger || "Freight & Transport", group: "Direct Expenses" },
      { id: "ledger-cgst-out", name: m.cgstOutputLedger || "CGST Output", group: m.gstGroup || "Duties & Taxes", taxType: "GST", gstDutyHead: "CGST" },
      { id: "ledger-sgst-out", name: m.sgstOutputLedger || "SGST Output", group: m.gstGroup || "Duties & Taxes", taxType: "GST", gstDutyHead: "SGST/UTGST" },
      { id: "ledger-utgst-out", name: m.utgstOutputLedger || "UTGST Output", group: m.gstGroup || "Duties & Taxes", taxType: "GST", gstDutyHead: "SGST/UTGST" },
      { id: "ledger-igst-out", name: m.igstOutputLedger || "IGST Output", group: m.gstGroup || "Duties & Taxes", taxType: "GST", gstDutyHead: "IGST" },
      { id: "ledger-cgst-in", name: m.cgstInputLedger || "CGST Input", group: m.gstGroup || "Duties & Taxes", taxType: "GST", gstDutyHead: "CGST" },
      { id: "ledger-sgst-in", name: m.sgstInputLedger || "SGST Input", group: m.gstGroup || "Duties & Taxes", taxType: "GST", gstDutyHead: "SGST/UTGST" },
      { id: "ledger-utgst-in", name: m.utgstInputLedger || "UTGST Input", group: m.gstGroup || "Duties & Taxes", taxType: "GST", gstDutyHead: "SGST/UTGST" },
      { id: "ledger-igst-in", name: m.igstInputLedger || "IGST Input", group: m.gstGroup || "Duties & Taxes", taxType: "GST", gstDutyHead: "IGST" },
    ];
    for (const l of ledgerList) {
      if (idSet && !idSet.has(l.id)) continue;
      const lXml = serializeLedgerMaster(l.name, l.group, l.taxType, l.gstDutyHead);
      const xml = message(lXml);
      prepared.push({
        sourceId: l.id,
        sourceLabel: l.name,
        docNumber: l.id,
        date: null,
        party: l.group,
        voucherType: "Ledger",
        amount: 0,
        contentHash: sha256(xml + config.companyName),
        status: !l.name ? "Validation Failed" : "Ready",
        errors: !l.name ? ["Ledger name not set"] : [],
        warnings: [],
        totals: { taxable: 0, gst: 0, grandTotal: 0 },
        xml,
      });
    }
    return { reportName: "All Masters", prepared };
  }

  // Transactions
  const needsNotes = exportType === "credit-notes" || exportType === "debit-notes";
  let invoices: any[] = [];
  let purchases: any[] = [];
  let receipts: any[] = [];
  let notes: any[] = [];

  if (idSet) {
    // ID-based fetching: no scans, only GetItem per requested record
    switch (exportType) {
      case "sales":
        invoices = await selectedInvoiceRows(idSet, request);
        break;
      case "purchases":
        purchases = (await Promise.all([...idSet!].map((id) => request.getPurchaseInvoice(id)))).filter(Boolean);
        break;
      case "receipts": {
        receipts = (await Promise.all([...idSet!].map((id) => request.getReceipt(id)))).filter(Boolean);
        const refInvoiceIds = new Set<string>();
        for (const r of receipts) if (r.invoiceId) refInvoiceIds.add(r.invoiceId);
        invoices = (await Promise.all([...refInvoiceIds].map((id) => request.getInvoice(id)))).filter(Boolean);
        break;
      }
      case "payments":
        purchases = (await Promise.all([...idSet!].map((id) => request.getPurchaseInvoice(id)))).filter(Boolean);
        break;
      case "credit-notes":
      case "debit-notes": {
        notes = (await Promise.all([...idSet!].map((id) => request.getNote(id)))).filter(Boolean);
        const refInvoiceIds = new Set<string>();
        const refPurchaseIds = new Set<string>();
        for (const n of notes) {
          if (n.sourceInvoiceId) refInvoiceIds.add(n.sourceInvoiceId);
          if (n.sourcePurchaseInvoiceId) refPurchaseIds.add(n.sourcePurchaseInvoiceId);
        }
        invoices = (await Promise.all([...refInvoiceIds].map((id) => request.getInvoice(id)))).filter(Boolean);
        purchases = (await Promise.all([...refPurchaseIds].map((id) => request.getPurchaseInvoice(id)))).filter(Boolean);
        break;
      }
    }
  }
  const invoicesById = new Map<string, any>();
  for (const i of invoices) invoicesById.set(i.id, i);
  const purchasesById = new Map<string, any>();
  for (const p of purchases) purchasesById.set(p.id, p);

  const sharedVoucherCtx = {
    ...ctx,
    partyStateForInvoice: (inv: any) => partyStateForInvoice(inv, ctx),
    partyStateForPurchase: (pi: any) => partyStateForPurchase(pi, ctx),
    normState,
    isUnionTerritory,
    gstHeadNames,
    splitAcrossHeads,
    invoiceLineAmount,
    detectLineMode,
    splitLine,
    unitFor,
    VoucherBuilder,
  };

  if (exportType === "sales") {
    const rows = await selectedInvoiceRows(idSet, request);
    for (const row of rows as any[]) {
      if (idSet && !idSet.has(row.id)) continue;
      const res = serializeSalesVoucher(row, sharedVoucherCtx);
      if (!row.invoiceNumber) res.errors.push("Invoice number is missing.");
      prepared.push({
        sourceId: row.id,
        sourceLabel: `${row.invoiceNumber} - ${res.party || "Customer"}`,
        docNumber: row.invoiceNumber,
        date: row.issueDate,
        party: res.party,
        voucherType: "Sales",
        amount: res.grandTotal,
        contentHash: sha256(res.xml + config.companyName),
        status: res.errors.length ? "Validation Failed" : "Ready",
        errors: res.errors,
        warnings: res.warnings,
        totals: { taxable: res.taxableTotal, gst: res.gstTotal, grandTotal: res.grandTotal },
        xml: res.xml,
      });
    }
  } else if (exportType === "purchases") {
    const rows = purchases;
    for (const row of rows as any[]) {
      if (idSet && !idSet.has(row.id)) continue;
      const res = serializePurchaseVoucher(row, sharedVoucherCtx);
      if (!row.invoiceNumber) res.errors.push("Purchase invoice number is missing.");
      prepared.push({
        sourceId: row.id,
        sourceLabel: `${row.invoiceNumber} - ${res.party || "Supplier"}`,
        docNumber: row.invoiceNumber,
        date: row.issueDate,
        party: res.party,
        voucherType: "Purchase",
        amount: res.grandTotal,
        contentHash: sha256(res.xml + config.companyName),
        status: res.errors.length ? "Validation Failed" : "Ready",
        errors: res.errors,
        warnings: res.warnings,
        totals: { taxable: res.taxableTotal, gst: res.gstTotal, grandTotal: res.grandTotal },
        xml: res.xml,
      });
    }
  } else if (exportType === "receipts") {
    for (const row of mergeReceiptRows(invoices, receipts) as any[]) {
      if (row.status !== "verified") continue;
      if (idSet && !idSet.has(row.id)) continue;
      if (!row.invoiceId) continue;
      const res = serializeReceiptVoucher(row, { config, debtorsById: ctx.debtorsById, VoucherBuilder }, invoicesById);
      prepared.push({
        sourceId: row.id,
        sourceLabel: `${res.docNumber} - ${res.party || "Customer"}`,
        docNumber: res.docNumber,
        date: res.date,
        party: res.party,
        voucherType: "Receipt",
        amount: res.amount,
        contentHash: sha256(res.xml + config.companyName),
        status: res.errors.length ? "Validation Failed" : "Ready",
        errors: res.errors,
        warnings: res.warnings,
        totals: { taxable: 0, gst: 0, grandTotal: res.amount },
        xml: res.xml,
      });
    }
  } else if (exportType === "payments") {
    const rows = purchases;
    for (const row of rows as any[]) {
      if (!(Number(row.amountPaid) > 0)) continue;
      if (idSet && !idSet.has(row.id)) continue;
      const res = serializePaymentVoucher(row, { config, suppliersById: ctx.suppliersById, VoucherBuilder });
      prepared.push({
        sourceId: row.id,
        sourceLabel: `${res.docNumber} - ${res.party || "Supplier"}`,
        docNumber: res.docNumber,
        date: res.date,
        party: res.party,
        voucherType: "Payment",
        amount: res.amount,
        contentHash: sha256(res.xml + config.companyName),
        status: res.errors.length ? "Validation Failed" : "Ready",
        errors: res.errors,
        warnings: res.warnings,
        totals: { taxable: 0, gst: 0, grandTotal: res.amount },
        xml: res.xml,
      });
    }
  } else if (exportType === "credit-notes" || exportType === "debit-notes") {
    const want = exportType === "credit-notes" ? "credit" : "debit";
    for (const row of notes as any[]) {
      if (row.kind !== want) continue;
      if (idSet && !idSet.has(row.id)) continue;
      const res =
        want === "credit"
          ? serializeCreditNoteVoucher(row, sharedVoucherCtx, invoicesById)
          : serializeDebitNoteVoucher(row, sharedVoucherCtx, purchasesById);
      prepared.push({
        sourceId: row.id,
        sourceLabel: `${res.docNumber} - ${res.party || "Party"}`,
        docNumber: res.docNumber,
        date: res.date,
        party: res.party,
        voucherType: want === "credit" ? "Credit Note" : "Debit Note",
        amount: res.amount,
        contentHash: sha256(res.xml + config.companyName),
        status: res.errors.length ? "Validation Failed" : "Ready",
        errors: res.errors,
        warnings: res.warnings,
        totals: { taxable: 0, gst: 0, grandTotal: res.amount },
        xml: res.xml,
      });
    }
  }

  return { reportName: "Vouchers", prepared };
}

export async function validateRecords(
  clientId: string,
  exportType: TallyExportType,
  ids?: string[],
  context?: TallyRequestContext,
) {
  const request = context ?? createRequestContext(clientId);
  const config = await request.config();
  if (!config) return { configError: "Tally company name is not configured. Open Configuration & Mapping and enter the exact company name shown in Tally.", records: [] as PreparedRecord[] };
  const problems = configProblems(config, exportType);
  if (problems.length) return { configError: problems.join(" "), records: [] as PreparedRecord[] };
  if (!ids || !ids.length) return { configError: "Record IDs are required for Tally export.", records: [] as PreparedRecord[] };
  const { prepared } = await buildRecords(clientId, exportType, config, ids, request);
  if (!config.allowDuplicateReExport) {
    const existing = await request.exportRecords();
    const map = new Map(existing.map((r) => [`${r.exportType}|${r.sourceId}`, r]));
    for (const rec of prepared) {
      const prev = map.get(`${exportType}|${rec.sourceId}`);
      if (prev && ["Exported", "Downloaded", "Imported"].includes(prev.status) && prev.contentHash === rec.contentHash) {
        rec.warnings.push(`Already exported in batch ${prev.lastBatchId || "(unknown)"} - no changes since then. Re-exported on request.`);
        rec.exportedStatus = prev.status;
        rec.lastBatchId = prev.lastBatchId;
        rec.exportedAt = prev.exportedAt;
        rec.exportedStatus = prev.status;
        rec.lastBatchId = prev.lastBatchId;
        rec.exportedAt = prev.exportedAt;
      } else if (prev && ["Exported", "Downloaded", "Imported"].includes(prev.status) && prev.contentHash !== rec.contentHash) {
        rec.warnings.push(`Source record changed since last exported (batch ${prev.lastBatchId || "(unknown)"}).`);
        rec.status = rec.errors.length ? "Validation Failed" : "Needs Review";
      }
    }
  }
  return { configError: null, records: prepared };
}

export function configProblems(config: TallyConfig, exportType?: TallyExportType): string[] {
  const problems: string[] = [];
  if (!config.companyName) problems.push("Tally company name is not configured. Open Configuration & Mapping and enter the exact company name shown in Tally.");
  const m = config.mappings || Tally.EMPTY_MAPPING;
  const needsSales = !exportType || ["sales", "credit-notes"].includes(exportType);
  const needsPurchases = !exportType || ["purchases", "debit-notes"].includes(exportType);
  const needsOutputTax = needsSales;
  const needsInputTax = needsPurchases;
  if (needsSales && !config.homeState) problems.push("Home state is required for sales vouchers (used to decide CGST/SGST vs IGST).");
  if (needsSales && !m.salesLedger) problems.push("Sales ledger is not configured.");
  if (needsPurchases && !m.purchaseLedger) problems.push("Purchase ledger is not configured.");
  if ((exportType === "customers" || !exportType) && !m.debtorsGroup) problems.push("Customer ledger group is not configured.");
  if ((exportType === "suppliers" || !exportType) && !m.creditorsGroup) problems.push("Supplier ledger group is not configured.");
  if (needsOutputTax && (!m.cgstOutputLedger || !m.sgstOutputLedger || !m.igstOutputLedger)) {
    problems.push("GST output ledgers (CGST, SGST/UTGST, and IGST) are not fully configured.");
  }
  if (needsInputTax && (!m.cgstInputLedger || !m.sgstInputLedger || !m.igstInputLedger)) {
    problems.push("GST input ledgers (CGST, SGST/UTGST, and IGST) are not fully configured.");
  }
  if ((needsSales || needsPurchases) && !m.roundOffLedger) problems.push("Round-off ledger is not configured.");
  if ((exportType === "stock-items" || needsSales || needsPurchases) && !config.gstApplicableFrom) problems.push("GST applicable-from migration date is not configured.");
  // Godown is only needed for inventory / voucher exports, not for simple ledger or unit masters.
  const needsGodown = !exportType ||
    ["stock-items", "sales", "purchases", "credit-notes", "debit-notes"].includes(exportType);
  if (needsGodown && !config.godownName) problems.push("Godown / warehouse name is required for this export type.");
  return problems;
}

async function getTallyConfig(clientId: string): Promise<TallyConfig | null> {
  // Prefer per-user config for backward compatibility, then fall back to the
  // shared company config used by current installations.
  return (await Tally.getConfig(clientId)) || (await Tally.getConfig("shared"));
}

export interface GenerateOptions {
  clientId: string;
  exportType: TallyExportType;
  ids?: string[];
  generatedBy?: string | null;
  force?: boolean;
  /** Shared read cache; routes pass one per request. */
  context?: TallyRequestContext;
}

export async function generateBatch(opts: GenerateOptions) {
  const request = opts.context ?? createRequestContext(opts.clientId);
  const config = await request.config();
  if (!config) throw Object.assign(new Error("Tally configuration has not been set up yet."), { status: 400 });
  const problems = configProblems(config, opts.exportType);
  if (problems.length) throw Object.assign(new Error(problems.join(" ")), { status: 400 });
  if (!opts.ids || !opts.ids.length) throw Object.assign(new Error("Record IDs are required for Tally export."), { status: 400 });

  const { reportName, prepared } = await buildRecords(opts.clientId, opts.exportType, config, opts.ids, request);
  if (!prepared.length) throw Object.assign(new Error("No records selected for export."), { status: 400 });

  if (!opts.force && !config.allowDuplicateReExport) {
    const existing = await request.exportRecords();
    const map = new Map(existing.map((r) => [`${r.exportType}|${r.sourceId}`, r]));
    for (const rec of prepared) {
      const prev = map.get(`${opts.exportType}|${rec.sourceId}`);
      if (prev && ["Exported", "Downloaded", "Imported"].includes(prev.status) && prev.contentHash === rec.contentHash) {
        rec.warnings.push(`Already exported in batch ${prev.lastBatchId || "(unknown)"} - no changes since then. Re-exported on request.`);
        rec.exportedStatus = prev.status;
        rec.lastBatchId = prev.lastBatchId;
        rec.exportedAt = prev.exportedAt;
      } else if (prev && ["Exported", "Downloaded", "Imported"].includes(prev.status) && prev.contentHash !== rec.contentHash) {
        rec.warnings.push(`Source record changed since last exported (batch ${prev.lastBatchId || "(unknown)"}).`);
        rec.status = rec.errors.length ? "Validation Failed" : "Needs Review";
      }
    }
  }

  const transactionTypes = new Set(["Sales", "Purchase", "Receipt", "Payment", "Credit Note", "Debit Note"]);
  for (const rec of prepared) {
    if (transactionTypes.has(rec.voucherType)) {
      if (!rec.docNumber || !normalizeName(rec.docNumber)) {
        rec.errors.push("Invoice / reference number is missing.");
      }
      if (!rec.date || tallyDate(rec.date) === "00000000") {
        rec.errors.push("Document date is missing or invalid.");
      }
      if (rec.errors.length) rec.status = "Validation Failed";
    }
  }
  const seenRefs = new Map<string, string>();
  for (const rec of prepared) {
    if (!transactionTypes.has(rec.voucherType) || !rec.docNumber) continue;
    const ref = normalizeName(rec.docNumber).toUpperCase();
    const previous = seenRefs.get(ref);
    if (previous) {
      rec.errors.push(`Invoice / reference number is duplicated with ${previous}.`);
      rec.status = "Validation Failed";
    } else {
      seenRefs.set(ref, rec.sourceId);
    }
  }

  const invalid = prepared.filter((r) => r.errors.length);
  const valid = prepared.filter((r) => r.errors.length === 0);
  if (!valid.length) {
    return {
      validationFailed: true as const,
      records: prepared,
      errors: invalid.flatMap((r) => r.errors.map((e) => `${r.sourceLabel}: ${e}`)),
    };
  }
  const partialExport = invalid.length > 0;
  const exportPrepared = valid;

  // Each record is wrapped in its own TALLYMESSAGE block
  const messages = exportPrepared.map((r) => (reportName === "Vouchers" ? message(r.xml) : r.xml));
  const xml = envelope({
    reportName,
    companyName: config.companyName,
    messages,
  });
  const xmlErrors = validateXml1(xml);
  if (xmlErrors.length) {
    throw Object.assign(
      new Error(`Generated XML failed validation: ${xmlErrors.join(" ")}`),
      { status: 422 },
    );
  }

  const sha = sha256(xml);
  const bytes = Buffer.byteLength(xml, "utf8");
  const id = uuid();
  const dir = path.resolve(process.env.TALLY_EXPORT_DIR || path.join(process.cwd(), "tally-exports"));
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${id}.xml`);
  await fs.writeFile(file, xml, "utf8");

  const totals = exportPrepared.reduce(
    (acc, r) => ({
      taxable: round2(acc.taxable + r.totals.taxable),
      gst: round2(acc.gst + r.totals.gst),
      grandTotal: round2(acc.grandTotal + r.totals.grandTotal),
    }),
    { taxable: 0, gst: 0, grandTotal: 0 },
  );

  const batchRecords: TallyBatchRecord[] = [
    ...exportPrepared.map((r) => ({
    sourceId: r.sourceId,
    sourceLabel: r.sourceLabel,
    docNumber: r.docNumber,
    date: r.date,
    party: r.party,
    amount: r.amount,
    voucherType: r.voucherType,
    contentHash: r.contentHash,
    status: r.status,
    errors: r.errors,
    warnings: r.warnings,
    })),
    ...invalid.map((r) => ({
      sourceId: r.sourceId,
      sourceLabel: r.sourceLabel,
      docNumber: r.docNumber,
      date: r.date,
      party: r.party,
      amount: r.amount,
      voucherType: r.voucherType,
      contentHash: r.contentHash,
      status: r.status,
      errors: r.errors,
      warnings: r.warnings,
    })),
  ];

  const generatedAt = new Date().toISOString();
  const batch = await Tally.createBatch({
    clientId: opts.clientId,
    id,
    exportType: opts.exportType,
    reportName,
    companyName: config.companyName,
    status: "Generated",
    fileName: `Tally_${opts.exportType}_${generatedAt.slice(0, 10)}.xml`,
    xmlPath: file,
    xmlSha256: sha,
    xmlBytes: bytes,
    recordCount: exportPrepared.length,
    validCount: exportPrepared.length,
    errorCount: invalid.length,
    warningCount: exportPrepared.reduce((n, r) => n + r.warnings.length, 0),
    totals,
    generatedAt,
    generatedBy: opts.generatedBy ?? null,
    downloadedAt: null,
    downloadedBy: null,
    importedAt: null,
    importedBy: null,
    importResult: null,
    records: batchRecords,
  });

  // The duplicate-check above already loaded every export record; reuse that
  // map so each write skips its own GetItem.
  const knownExports = await request.exportRecordMap();
  for (const rec of exportPrepared) {
    await Tally.upsertExportRecord(
      opts.clientId,
      {
        exportType: opts.exportType,
        sourceId: rec.sourceId,
        sourceLabel: rec.sourceLabel,
        docNumber: rec.docNumber,
        voucherType: rec.voucherType,
        contentHash: rec.contentHash,
        status: rec.status === "Needs Review" ? "Needs Review" : "Exported",
        lastBatchId: batch.id,
        exportedAt: generatedAt,
        errorCount: rec.errors.length,
        errors: rec.errors,
      },
      knownExports.get(`${opts.exportType}|${rec.sourceId}`) ?? null,
    );
  }

  return {
    validationFailed: false as const,
    partialExport,
    blockedCount: invalid.length,
    blockedRecords: invalid,
    batch,
    xml,
  };
}

export async function markDownloaded(clientId: string, batchId: string, user: string | null) {
  const batch = await Tally.getBatch(clientId, batchId);
  if (!batch) return null;
  const updated = await Tally.updateBatch(clientId, batchId, {
    status: batch.status === "Imported" ? "Imported" : "Downloaded",
    downloadedAt: batch.downloadedAt || new Date().toISOString(),
    downloadedBy: user,
  });
  if (!updated) return null;
  const knownExports = new Map(
    (await Tally.listExportRecords(clientId).catch(() => [] as Tally.TallyExportRecord[])).map(
      (r) => [`${r.exportType}|${r.sourceId}`, r] as const,
    ),
  );
  for (const rec of updated.records) {
    const existing = knownExports.get(`${updated.exportType}|${rec.sourceId}`);
    if (existing && existing.lastBatchId === updated.id && existing.status === "Exported") {
      await Tally.upsertExportRecord(
        clientId,
        {
          ...existing,
          exportType: updated.exportType,
          sourceId: rec.sourceId,
          contentHash: rec.contentHash,
          voucherType: rec.voucherType,
          status: "Downloaded",
        },
        existing,
      );
    }
  }
  return updated;
}

export async function confirmImport(
  clientId: string,
  batchId: string,
  user: string | null,
  result: { created: number; altered: number; skipped: number; failed: number; notes?: string | null },
) {
  const batch = await Tally.getBatch(clientId, batchId);
  if (!batch) return null;
  const failed = Math.max(0, Number(result.failed) || 0);
  const created = Math.max(0, Number(result.created) || 0);
  const altered = Math.max(0, Number(result.altered) || 0);
  const skipped = Math.max(0, Number(result.skipped) || 0);
  const status = failed > 0 && created + altered === 0 ? "Failed" : "Imported";
  const now = new Date().toISOString();
  const updated = await Tally.updateBatch(clientId, batchId, {
    status,
    importedAt: now,
    importedBy: user,
    importResult: { created, altered, skipped, failed, notes: result.notes ?? null },
  });
  if (!updated) return null;
  const knownExports = new Map(
    (await Tally.listExportRecords(clientId).catch(() => [] as Tally.TallyExportRecord[])).map(
      (r) => [`${r.exportType}|${r.sourceId}`, r] as const,
    ),
  );
  for (const rec of updated.records) {
    const existing = knownExports.get(`${updated.exportType}|${rec.sourceId}`);
    if (!existing || existing.lastBatchId !== updated.id) continue;
    await Tally.upsertExportRecord(
      clientId,
      {
        ...existing,
        exportType: updated.exportType,
        sourceId: rec.sourceId,
        contentHash: rec.contentHash,
        voucherType: rec.voucherType,
        status: status === "Failed" ? "Failed" : "Imported",
        importedAt: now,
      },
      existing,
    );
  }
  return updated;
}

export async function retryFailedRecords(clientId: string, batchId: string, user: string | null) {
  const batch = await Tally.getBatch(clientId, batchId);
  if (!batch) throw Object.assign(new Error("Batch not found"), { status: 404 });
  const failedRecs = batch.records.filter((r) => r.status === "Failed" || r.errors.length > 0);
  if (!failedRecs.length) throw Object.assign(new Error("No failed records found in this batch"), { status: 400 });
  const ids = failedRecs.map((r) => r.sourceId);
  return generateBatch({
    clientId,
    exportType: batch.exportType,
    ids,
    generatedBy: user,
    force: true,
  });
}

export async function readBatchXml(batch: Tally.TallyBatch): Promise<Buffer> {
  if (!batch.xmlPath) throw Object.assign(new Error("This batch has no stored XML file."), { status: 404 });
  try {
    const content = await fs.readFile(batch.xmlPath);
    const xmlErrors = validateXml1(content.toString("utf8"));
    if (xmlErrors.length) {
      throw Object.assign(
        new Error(`XML validation failed: ${xmlErrors.join(" ")}`),
        { status: 422 },
      );
    }
    return content;
  } catch {
    throw Object.assign(
      new Error("The stored XML file is no longer available on this server. Regenerate the batch."),
      { status: 410 },
    );
  }
}

export function manifestCsv(batch: Tally.TallyBatch): string {
  return generateManifestCsv(batch);
}

export async function getDashboardOverview(
  clientId: string,
  context?: TallyRequestContext,
) {
  const request = context ?? createRequestContext(clientId);
  const config = await request.config();
  // One shared cache for all eleven export types: each entity type is scanned
  // once for the whole dashboard instead of once per type.
  const [batches, exportRecords] = await Promise.all([
    request.batches(),
    request.exportRecords(),
  ]);

  const allExportTypes: TallyExportType[] = [
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

  const entityStats: Record<string, { eligible: number; exported: number; awaiting: number; imported: number; value: number }> = {};
  let totalEligible = 0;
  let totalExportedValue = 0;

  for (const type of allExportTypes) {
    const rows = await listSelectable(clientId, type, request);
    const count = rows.length;
    totalEligible += count;
    const typeRecords = exportRecords.filter((r) => r.exportType === type);
    const exportedCount = typeRecords.filter((r) => ["Exported", "Downloaded", "Imported"].includes(r.status)).length;
    const importedCount = typeRecords.filter((r) => r.status === "Imported").length;
    const awaitingCount = Math.max(0, count - exportedCount);
    const typeValue = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

    entityStats[type] = {
      eligible: count,
      exported: exportedCount,
      awaiting: awaitingCount,
      imported: importedCount,
      value: typeValue,
    };
  }

  // Total value of exported batches
  for (const b of batches) {
    if (b.status !== "Failed") {
      totalExportedValue = round2(totalExportedValue + (b.totals?.grandTotal || 0));
    }
  }

  const byStatus = exportRecords.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  const totalExported = exportRecords.filter((r) => ["Exported", "Downloaded", "Imported"].includes(r.status)).length;
  const totalImported = exportRecords.filter((r) => r.status === "Imported").length;
  const totalFailed = (byStatus["Failed"] || 0) + (byStatus["Validation Failed"] || 0);
  const totalAwaiting = Math.max(0, totalEligible - totalExported);
  const needingReview = exportRecords.filter((r) => r.status === "Needs Review").length;
  const completedBatches = batches.filter((b) => ["Generated", "Downloaded", "Imported"].includes(b.status)).length;
  const lastExportDate = batches.length > 0 ? batches[0].generatedAt : null;

  const configMissing = !config
    ? ["companyName", "homeState", "godownName"]
    : [
        !config.companyName ? "companyName" : "",
        !config.homeState ? "homeState" : "",
        !config.godownName ? "godownName" : "",
        !config.mappings.salesLedger ? "salesLedger" : "",
        !config.mappings.purchaseLedger ? "purchaseLedger" : "",
        !config.mappings.bankLedger ? "bankLedger" : "",
      ].filter(Boolean);

  return {
    configured: !!config?.companyName,
    companyName: config?.companyName || null,
    homeState: config?.homeState || null,
    configMissing,
    kpis: {
      totalEligible,
      totalExported,
      totalAwaiting,
      totalImported,
      totalFailed,
      needingReview,
      totalExportedValue,
      completedBatches,
      lastExportDate,
    },
    entityStats,
    byStatus,
    recentBatches: batches.slice(0, 10).map((b) => ({
      id: b.id,
      batchNumber: b.batchNumber,
      exportType: b.exportType,
      status: b.status,
      recordCount: b.recordCount,
      errorCount: b.errorCount,
      warningCount: b.warningCount,
      generatedAt: b.generatedAt,
      generatedBy: b.generatedBy,
      totals: b.totals,
      xmlSha256: b.xmlSha256,
      fileName: b.fileName,
    })),
  };
}
