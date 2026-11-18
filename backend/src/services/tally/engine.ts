import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import * as Invoice from "../../models/invoice.js";
import * as PurchaseInvoice from "../../models/purchase-invoice.js";
import * as Debtor from "../../models/debtor.js";
import * as Supplier from "../../models/supplier.js";
import * as Product from "../../models/product.js";
import * as PaymentReceipt from "../../models/payment-receipt.js";
import * as CreditDebitNote from "../../models/credit-debit-note.js";
import * as StockMovement from "../../models/stock-movement.js";
import * as Tally from "../../models/tally.js";
import { isUnionTerritory, type TallyConfig, type TallyExportType, type TallyBatchRecord } from "../../models/tally.js";
import { splitGstInclusive, round2 } from "../../lib/gst.js";
import {
  envelope,
  ledgerEntry,
  inventoryEntry,
  message,
  tallyDate,
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
    if (Math.abs(diff) > 0.005) {
      if (!roundOffLedger) {
        log.warnings.push(
          `${label}: voucher needs a round-off of ${diff.toFixed(2)} but no round-off ledger is configured.`,
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

export async function loadContext(clientId: string, config: TallyConfig): Promise<BuildContext> {
  const [debtors, suppliers, products, movements] = await Promise.all([
    Debtor.list().catch(() => [] as any[]),
    Supplier.list().catch(() => [] as any[]),
    Product.list(clientId).catch(() => [] as any[]),
    StockMovement.list(clientId).catch(() => [] as any[]),
  ]);
  const debtorsById = new Map<string, any>();
  for (const d of debtors as any[]) {
    if (d.clientId && d.clientId !== clientId) continue;
    debtorsById.set(d.id, d);
  }
  const suppliersById = new Map<string, any>();
  for (const s of suppliers as any[]) suppliersById.set(s.id, s);
  const productsById = new Map<string, any>();
  for (const p of products as any[]) productsById.set(p.id, p);
  const openingByProduct = new Map<string, { qty: number; value: number }>();
  for (const m of movements as any[]) {
    if (m.status !== "confirmed" || !m.productId) continue;
    const bucket = openingByProduct.get(m.productId) || { qty: 0, value: 0 };
    const q = Number(m.quantity) || 0;
    const delta = m.direction === "in" ? q : -q;
    bucket.qty = round2(bucket.qty + delta);
    bucket.value = round2(bucket.value + delta * (Number(m.unitCost) || 0));
    openingByProduct.set(m.productId, bucket);
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

export async function listSelectable(clientId: string, exportType: TallyExportType): Promise<SelectableRecord[]> {
  const out: SelectableRecord[] = [];
  const config = await Tally.getConfig(clientId);

  if (exportType === "customers") {
    const rows = await Debtor.list().catch(() => [] as any[]);
    for (const d of rows as any[]) {
      if (d.clientId && d.clientId !== clientId) continue;
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
    const rows = await Supplier.list().catch(() => [] as any[]);
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
    const rows = await Product.list(clientId).catch(() => [] as any[]);
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
    const rows = await Invoice.list(clientId).catch(() => [] as any[]);
    for (const i of rows as any[]) {
      const missing: string[] = [];
      if (!i.customerName && !i.debtorId) missing.push("Customer missing");
      if (!i.invoiceNumber) missing.push("Invoice # missing");
      out.push({
        sourceId: i.id,
        label: i.invoiceNumber,
        docNumber: i.invoiceNumber,
        date: i.issueDate,
        party: i.customerName || null,
        amount: Number(i.grandTotal) || Number(i.amount) || 0,
        taxAmount: Number(i.gstTotal) || Number(i.taxAmount) || 0,
        paymentStatus: i.paymentStatus || i.status,
        voucherType: "Sales",
        detail: i.status,
        missingInfo: missing,
      });
    }
  } else if (exportType === "purchases") {
    const rows = await PurchaseInvoice.list(clientId).catch(() => [] as any[]);
    for (const p of rows as any[]) {
      const missing: string[] = [];
      if (!p.supplierName && !p.vendorId && !p.billToSupplierId) missing.push("Supplier missing");
      if (!p.invoiceNumber) missing.push("Invoice # missing");
      out.push({
        sourceId: p.id,
        label: p.invoiceNumber,
        docNumber: p.invoiceNumber,
        date: p.issueDate,
        party: p.supplierName || null,
        amount: Number(p.grandTotal) || Number(p.amount) || 0,
        taxAmount: Number(p.gstTotal) || 0,
        paymentStatus: p.paymentStatus || p.status,
        voucherType: "Purchase",
        detail: p.status,
        missingInfo: missing,
      });
    }
  } else if (exportType === "receipts") {
    const rows = await PaymentReceipt.list(clientId).catch(() => [] as any[]);
    for (const r of rows as any[]) {
      if (r.status !== "verified" || !r.invoiceId) continue;
      out.push({
        sourceId: r.id,
        label: r.utr || r.id.slice(0, 8),
        docNumber: r.invoiceNumber || r.id.slice(0, 8),
        date: r.receiptDate || r.submittedAt,
        party: r.customerName || null,
        amount: Number(r.amount) || 0,
        taxAmount: 0,
        paymentStatus: r.status,
        voucherType: "Receipt",
        detail: r.status,
        missingInfo: [],
      });
    }
  } else if (exportType === "payments") {
    const rows = await PurchaseInvoice.list(clientId).catch(() => [] as any[]);
    for (const p of rows as any[]) {
      if (!(Number(p.amountPaid) > 0)) continue;
      out.push({
        sourceId: p.id,
        label: p.invoiceNumber,
        docNumber: p.invoiceNumber,
        date: p.paidDate || p.issueDate,
        party: p.supplierName || null,
        amount: Number(p.amountPaid) || 0,
        taxAmount: 0,
        paymentStatus: p.status,
        voucherType: "Payment",
        detail: `Paid ${Number(p.amountPaid).toFixed(2)}`,
        missingInfo: [],
      });
    }
  } else if (exportType === "credit-notes" || exportType === "debit-notes") {
    const rows = await CreditDebitNote.list(clientId).catch(() => [] as any[]);
    const want = exportType === "credit-notes" ? "credit" : "debit";
    for (const n of rows as any[]) {
      if (n.kind !== want) continue;
      out.push({
        sourceId: n.id,
        label: n.noteNumber,
        docNumber: n.noteNumber,
        date: n.noteDate,
        party: n.counterparty || null,
        amount: Number(n.amount) || 0,
        taxAmount: Number(n.taxAmount) || 0,
        paymentStatus: n.status,
        voucherType: want === "credit" ? "Credit Note" : "Debit Note",
        detail: n.status,
        missingInfo: [],
      });
    }
  }

  const exported = await Tally.listExportRecords(clientId).catch(() => [] as any[]);
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
): Promise<{ reportName: "All Masters" | "Vouchers"; prepared: PreparedRecord[] }> {
  const ctx = await loadContext(clientId, config);
  const idSet = ids && ids.length ? new Set(ids) : null;
  const prepared: PreparedRecord[] = [];

  // Masters
  if (exportType === "customers" || exportType === "suppliers") {
    const rows = exportType === "customers" ? await Debtor.list() : await Supplier.list();
    for (const row of rows as any[]) {
      if (row.clientId && row.clientId !== clientId) continue;
      if (idSet && !idSet.has(row.id)) continue;
      const errors: string[] = [];
      const warnings: string[] = [];
      const name = exportType === "customers" ? row.name : row.companyName;
      if (!name) errors.push("Ledger name is missing.");
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
    const rows = await Product.list(clientId);
    for (const row of rows as any[]) {
      if (idSet && !idSet.has(row.id)) continue;
      const errors: string[] = [];
      const warnings: string[] = [];
      if (!row.name) errors.push("Stock item name is missing.");
      if (!config.godownName) errors.push("Tally godown / warehouse is not configured.");
      if (row.skuLevel === "parent") warnings.push("Parent product exported as a stock item; variants export separately.");
      if (!row.hsnCode) warnings.push("HSN code is missing on this SKU.");

      const masterXml = serializeStockItemMaster(row, ctx, unitFor);
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
  const [invoices, purchases, receipts, notes] = await Promise.all([
    exportType === "receipts" || needsNotes ? Invoice.list(clientId) : Promise.resolve([] as any[]),
    needsNotes ? PurchaseInvoice.list(clientId) : Promise.resolve([] as any[]),
    exportType === "receipts" ? PaymentReceipt.list(clientId) : Promise.resolve([] as any[]),
    needsNotes ? CreditDebitNote.list(clientId) : Promise.resolve([] as any[]),
  ]);
  const invoicesById = new Map<string, any>();
  for (const i of invoices as any[]) invoicesById.set(i.id, i);
  const purchasesById = new Map<string, any>();
  for (const p of purchases as any[]) purchasesById.set(p.id, p);

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
    const rows = await Invoice.list(clientId);
    for (const row of rows as any[]) {
      if (idSet && !idSet.has(row.id)) continue;
      const res = serializeSalesVoucher(row, sharedVoucherCtx);
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
    const rows = await PurchaseInvoice.list(clientId);
    for (const row of rows as any[]) {
      if (idSet && !idSet.has(row.id)) continue;
      const res = serializePurchaseVoucher(row, sharedVoucherCtx);
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
    for (const row of receipts as any[]) {
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
    const rows = await PurchaseInvoice.list(clientId);
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

export async function validateRecords(clientId: string, exportType: TallyExportType, ids?: string[]) {
  const config = await Tally.getConfig(clientId);
  if (!config) return { configError: "Tally configuration has not been set up yet.", records: [] as PreparedRecord[] };
  const { prepared } = await buildRecords(clientId, exportType, config, ids);
  return { configError: null, records: prepared };
}

export function configProblems(config: TallyConfig): string[] {
  const problems: string[] = [];
  if (!config.companyName) problems.push("Tally company name is required.");
  if (!config.homeState) problems.push("Home state is required (used to decide CGST/SGST vs IGST).");
  if (!config.godownName) problems.push("Godown / warehouse name is required.");
  return problems;
}

export interface GenerateOptions {
  clientId: string;
  exportType: TallyExportType;
  ids?: string[];
  generatedBy?: string | null;
  force?: boolean;
}

export async function generateBatch(opts: GenerateOptions) {
  const config = await Tally.getConfig(opts.clientId);
  if (!config) throw Object.assign(new Error("Tally configuration has not been set up yet."), { status: 400 });
  const problems = configProblems(config);
  if (problems.length) throw Object.assign(new Error(problems.join(" ")), { status: 400 });

  const { reportName, prepared } = await buildRecords(opts.clientId, opts.exportType, config, opts.ids);
  if (!prepared.length) throw Object.assign(new Error("No records selected for export."), { status: 400 });

  if (!opts.force && !config.allowDuplicateReExport) {
    const existing = await Tally.listExportRecords(opts.clientId);
    const map = new Map(existing.map((r) => [`${r.exportType}|${r.sourceId}`, r]));
    for (const rec of prepared) {
      const prev = map.get(`${opts.exportType}|${rec.sourceId}`);
      if (prev && ["Exported", "Downloaded", "Imported"].includes(prev.status) && prev.contentHash === rec.contentHash) {
        rec.errors.push(`Already exported in batch ${prev.lastBatchId || "(unknown)"} - no changes since then.`);
        rec.status = "Validation Failed";
      } else if (prev && ["Exported", "Downloaded", "Imported"].includes(prev.status) && prev.contentHash !== rec.contentHash) {
        rec.warnings.push(`Source record changed since last exported (batch ${prev.lastBatchId || "(unknown)"}).`);
        rec.status = rec.errors.length ? "Validation Failed" : "Needs Review";
      }
    }
  }

  const invalid = prepared.filter((r) => r.errors.length);
  if (invalid.length) {
    return {
      validationFailed: true as const,
      records: prepared,
      errors: invalid.flatMap((r) => r.errors.map((e) => `${r.sourceLabel}: ${e}`)),
    };
  }

  // Each record is wrapped in its own TALLYMESSAGE block
  const messages = prepared.map((r) => (reportName === "Vouchers" ? message(r.xml) : r.xml));
  const xml = envelope({
    reportName,
    companyName: config.companyName,
    messages,
  });

  const sha = sha256(xml);
  const bytes = Buffer.byteLength(xml, "utf8");
  const id = uuid();
  const dir = path.resolve(process.env.TALLY_EXPORT_DIR || path.join(process.cwd(), "tally-exports"));
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${id}.xml`);
  await fs.writeFile(file, xml, "utf8");

  const totals = prepared.reduce(
    (acc, r) => ({
      taxable: round2(acc.taxable + r.totals.taxable),
      gst: round2(acc.gst + r.totals.gst),
      grandTotal: round2(acc.grandTotal + r.totals.grandTotal),
    }),
    { taxable: 0, gst: 0, grandTotal: 0 },
  );

  const batchRecords: TallyBatchRecord[] = prepared.map((r) => ({
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
  }));

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
    recordCount: prepared.length,
    validCount: prepared.length,
    errorCount: 0,
    warningCount: prepared.reduce((n, r) => n + r.warnings.length, 0),
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

  for (const rec of prepared) {
    await Tally.upsertExportRecord(opts.clientId, {
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
    });
  }

  return { validationFailed: false as const, batch, xml };
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
  for (const rec of updated.records) {
    const existing = await Tally.findExportRecord(clientId, updated.exportType, rec.sourceId);
    if (existing && existing.lastBatchId === updated.id && existing.status === "Exported") {
      await Tally.upsertExportRecord(clientId, {
        ...existing,
        exportType: updated.exportType,
        sourceId: rec.sourceId,
        contentHash: rec.contentHash,
        voucherType: rec.voucherType,
        status: "Downloaded",
      });
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
  for (const rec of updated.records) {
    const existing = await Tally.findExportRecord(clientId, updated.exportType, rec.sourceId);
    if (!existing || existing.lastBatchId !== updated.id) continue;
    await Tally.upsertExportRecord(clientId, {
      ...existing,
      exportType: updated.exportType,
      sourceId: rec.sourceId,
      contentHash: rec.contentHash,
      voucherType: rec.voucherType,
      status: status === "Failed" ? "Failed" : "Imported",
      importedAt: now,
    });
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
    return await fs.readFile(batch.xmlPath);
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

export async function getDashboardOverview(clientId: string) {
  const config = await Tally.getConfig(clientId);
  const [batches, exportRecords] = await Promise.all([
    Tally.listBatches(clientId).catch(() => []),
    Tally.listExportRecords(clientId).catch(() => []),
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
    const rows = await listSelectable(clientId, type);
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
