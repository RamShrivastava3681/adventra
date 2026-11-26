import * as Invoice from "../../models/invoice.js";
import * as PurchaseInvoice from "../../models/purchase-invoice.js";
import * as PaymentReceipt from "../../models/payment-receipt.js";
import * as BulkPayment from "../../models/bulk-payment.js";
import * as CreditDebitNote from "../../models/credit-debit-note.js";
import * as Debtor from "../../models/debtor.js";
import * as Supplier from "../../models/supplier.js";
import * as Vendor from "../../models/vendor.js";
import * as Product from "../../models/product.js";
import { round2 } from "../../lib/gst.js";
import { stateNameFromCode } from "./engine.js";

export interface StagedTallyLine {
  stockItem: string;
  quantity: number;
  unit: string;
  amount: number;
  unitPrice: number;
  gstRate: number | null;
  hsnCode: string | null;
}

export interface StagedTallyBill {
  name: string;
  amount: number;
  type: string | null;
}

export interface StagedTallyLedger {
  name: string;
  amount: number;
  deemedPositive: boolean;
  isParty: boolean;
  bills: StagedTallyBill[];
}

export interface StagedTallyVoucher {
  guid: string | null;
  voucherNumber: string | null;
  reference: string | null;
  date: string | null;
  voucherType: string;
  partyName: string | null;
  partyGstin: string | null;
  placeOfSupply: string | null;
  amount: number;
  narration: string | null;
  irn: string | null;
  ackNo: string | null;
  ackDate: string | null;
  ewayBillNo: string | null;
  ewayBillDate: string | null;
  ledgers: StagedTallyLedger[];
  lines: StagedTallyLine[];
  classification: "Matched" | "New" | "Changed" | "Duplicate" | "Missing Master" | "Unbalanced" | "Invalid";
  matchedId: string | null;
  matchedDocNumber: string | null;
  differences: string[];
}

export interface StagedTallyMaster {
  kind: "customer" | "supplier" | "stock-item" | "unit";
  name: string;
  parent: string | null;
  gstin: string | null;
  state: string | null;
  country: string | null;
  addressLines: string[];
  city: string | null;
  postalCode: string | null;
  unit: string | null;
  hsnCode: string | null;
  gstRate: number | null;
  openingBalance: number | null;
  sku: string | null;
  classification: "Matched" | "New" | "Changed";
  matchedId: string | null;
  differences: string[];
}

export interface TallyImportCounts {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}

export interface TallyImportReport {
  masters: Record<"customers" | "suppliers" | "stockItems" | "units", TallyImportCounts>;
  vouchers: Record<
    "sales" | "purchases" | "receipts" | "payments" | "creditNotes" | "debitNotes",
    TallyImportCounts
  >;
  errors: { section: string; docNumber: string | null; message: string }[];
  warnings: { section: string; docNumber: string | null; message: string }[];
}

export interface TallyImportOptions {
  clientId: string;
  createMissingMasters?: boolean;
  updatedBy?: string | null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${escapeRegExp(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeRegExp(tag)}>`, "i");
  const m = re.exec(xml);
  return m ? m[1].trim() : null;
}

function extractAllTags(xml: string, tag: string): string[] {
  const matches: string[] = [];
  const re = new RegExp(`<${escapeRegExp(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeRegExp(tag)}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    matches.push(m[1].trim());
  }
  return matches;
}

function extractAttr(xml: string, tag: string, attr: string): string | null {
  const re = new RegExp(
    `<${escapeRegExp(tag)}\\b[^>]*\\b${escapeRegExp(attr)}\\s*=\\s*["']([^"']*)["']`,
    "i",
  );
  const m = re.exec(xml);
  return m ? m[1].trim() : null;
}

function toNumber(value: unknown): number {
  const n = Number(String(value ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

const MONTHS: Record<string, string> = {
  jan: "01", january: "01",
  feb: "02", february: "02",
  mar: "03", march: "03",
  apr: "04", april: "04",
  may: "05",
  jun: "06", june: "06",
  jul: "07", july: "07",
  aug: "08", august: "08",
  sep: "09", sept: "09", september: "09",
  oct: "10", october: "10",
  nov: "11", november: "11",
  dec: "12", december: "12",
};

function normalizeDate(raw: string | null): string {
  const s = String(raw ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{2}[-/]\d{2}[-/]\d{4}$/.test(s)) {
    const [d, m, y] = s.split(/[-/]/);
    return `${y}-${m}-${d}`;
  }
  // Tally often prints dates as "19-Nov-2026" or "19 November 2026".
  const named = /^(\d{1,2})[\s-]([A-Za-z]+)[\s-](\d{4})$/.exec(s);
  if (named) {
    const month = MONTHS[named[2].toLowerCase()];
    if (month) return `${named[3]}-${month}-${named[1].padStart(2, "0")}`;
  }
  const digits = s.replace(/\D/g, "");
  if (digits.length === 8) {
    if (/^(19|20)\d{2}/.test(digits)) {
      return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
    }
    return `${digits.slice(4, 8)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`;
  }
  return new Date().toISOString().slice(0, 10);
}

function normalizeGstin(raw: string | null): string | null {
  const s = String(raw ?? "").replace(/\s+/g, "").toUpperCase();
  return /^[0-9]{2}[A-Z0-9]{13}$/.test(s) ? s : null;
}

function extractIrnFromText(text: string | null): string | null {
  if (!text) return null;
  const m = /\bIRN\s*[:\-]?\s*([0-9A-Fa-f]{64})\b/.exec(text);
  return m ? m[1] : null;
}

function extractAckFromText(text: string | null): string | null {
  if (!text) return null;
  const m = /\b(?:Acknowledgement|Ack)\s*(?:number|no\.?)?\s*[:\-]?\s*(\d{9,20})\b/i.exec(text);
  return m ? m[1] : null;
}

function extractEwayFromText(text: string | null): string | null {
  if (!text) return null;
  const m = /\b(?:e-?way\s*bill|ewb)\s*(?:no\.?|number)?\s*[:\-]?\s*(\d{8,20})\b/i.exec(text);
  return m ? m[1] : null;
}

function extractWhizunikRef(text: string | null): string | null {
  if (!text) return null;
  const m = /\bWhizUnik\s*Ref\s*[:\-]\s*([A-Za-z0-9][A-Za-z0-9/_.-]*)/i.exec(text);
  return m ? m[1] : null;
}

function resolveDocumentNumber(voucher: StagedTallyVoucher): string {
  // WhizUnik invoice numbers live in REFERENCE; VOUCHERNUMBER is Tally's
  // internal serial (e.g. 46). Prefer the reference so matching works.
  return (
    (voucher.reference && voucher.reference.trim()) ||
    (voucher.voucherNumber && voucher.voucherNumber.trim()) ||
    ""
  );
}

function parseQty(raw: string | null): { quantity: number; unit: string } {
  if (!raw) return { quantity: 0, unit: "" };
  const m = /^(-?[\d,.]+)\s*(.*)$/.exec(raw.trim());
  if (!m) return { quantity: 0, unit: raw.trim() };
  return { quantity: toNumber(m[1]), unit: (m[2] || "").trim() };
}

function parseRate(raw: string | null): number {
  if (!raw) return 0;
  const m = /^(-?[\d,.]+)/.exec(raw.trim());
  return m ? toNumber(m[1]) : 0;
}

function gstRateFromBlock(block: string): number | null {
  const details = extractAllTags(block, "RATEDETAILS.LIST");
  let igst = 0;
  let cgst = 0;
  let sgst = 0;
  for (const detail of details) {
    const head = (extractTag(detail, "GSTRATEDUTYHEAD") || "").toUpperCase();
    const rate = toNumber(extractTag(detail, "GSTRATE"));
    if (head.includes("IGST")) igst = Math.max(igst, rate);
    else if (head.includes("CGST")) cgst = Math.max(cgst, rate);
    else if (head.includes("SGST") || head.includes("UTGST")) sgst = Math.max(sgst, rate);
  }
  if (igst > 0) return round2(igst);
  if (cgst > 0 || sgst > 0) return round2(cgst + sgst);
  return null;
}

function parseInventoryLines(block: string): StagedTallyLine[] {
  const lines: StagedTallyLine[] = [];
  for (const entry of extractAllTags(block, "ALLINVENTORYENTRIES.LIST")) {
    const stockItem = extractTag(entry, "STOCKITEMNAME");
    if (!stockItem) continue;
    const amount = Math.abs(toNumber(extractTag(entry, "AMOUNT")));
    const qtyRaw = extractTag(entry, "BILLEDQTY") || extractTag(entry, "ACTUALQTY");
    const parsedQty = parseQty(qtyRaw);
    const inclRate = parseRate(extractTag(entry, "INCLVATRATE"));
    const baseRate = parseRate(extractTag(entry, "RATE"));
    const gstRate = gstRateFromBlock(entry);
    let unitPrice = inclRate;
    if (!(unitPrice > 0)) {
      const base = parsedQty.quantity > 0 ? amount / parsedQty.quantity : baseRate;
      unitPrice = round2(base * (1 + (gstRate ?? 0) / 100));
    }
    const quantity = parsedQty.quantity > 0 ? parsedQty.quantity : 0;
    const lineTotal = quantity > 0 ? round2(quantity * unitPrice) : amount;
    lines.push({
      stockItem,
      quantity,
      unit: parsedQty.unit,
      amount,
      unitPrice: quantity > 0 ? round2(lineTotal / quantity) : unitPrice,
      gstRate,
      hsnCode: extractTag(entry, "GSTHSNNAME") || extractTag(entry, "HSNITEMSOURCE") || extractTag(entry, "HSNCODE"),
    });
  }
  return lines;
}

function parseAddressParts(lines: string[]): {
  address: string;
  city: string | null;
  state: string | null;
  postalCode: string | null;
} {
  const cleaned = lines.map((l) => l.trim()).filter(Boolean);
  const address = cleaned.join(", ");
  const last = cleaned[cleaned.length - 1] || "";
  const parts = last.split(",").map((p) => p.trim()).filter(Boolean);
  const postalCode = parts.find((p) => /^\d{5,6}$/.test(p)) || null;
  const state =
    parts.find(
      (p) =>
        /^[A-Za-z .&-]+$/.test(p) &&
        p.length > 2 &&
        p.toLowerCase() !== "india" &&
        p.toLowerCase() !== address.toLowerCase(),
    ) || null;
  const city = parts.length > 1 ? parts[0] : null;
  return { address, city, state, postalCode };
}

export function parseTallyMasters(xmlContent: string): StagedTallyMaster[] {
  const masters: StagedTallyMaster[] = [];

  for (const block of extractAllTags(xmlContent, "LEDGER")) {
    const name = extractAttr(block, "LEDGER", "NAME") || extractTag(block, "NAME");
    if (!name) continue;
    const parent = extractTag(block, "PARENT");
    const parentLower = (parent || "").toLowerCase();
    const kind = parentLower.includes("debtor")
      ? "customer"
      : parentLower.includes("creditor")
      ? "supplier"
      : null;
    if (!kind) continue;
    const addressLines = extractAllTags(block, "ADDRESS");
    const parsedAddress = parseAddressParts(addressLines);
    const gstin = normalizeGstin(extractTag(block, "PARTYGSTIN") || extractTag(block, "GSTIN"));
    const state =
      extractTag(block, "LEDSTATENAME") ||
      extractTag(block, "LEDGERSTATENAME") ||
      extractTag(block, "STATENAME") ||
      extractTag(block, "STATE") ||
      parsedAddress.state;
    const country = extractTag(block, "COUNTRY");
    masters.push({
      kind,
      name,
      parent,
      gstin,
      state,
      country,
      addressLines,
      city: parsedAddress.city,
      postalCode: parsedAddress.postalCode,
      unit: null,
      hsnCode: null,
      gstRate: null,
      openingBalance: toNumber(extractTag(block, "OPENINGBALANCE")),
      sku: null,
      classification: "New",
      matchedId: null,
      differences: [],
    });
  }

  for (const block of extractAllTags(xmlContent, "STOCKITEM")) {
    const name = extractAttr(block, "STOCKITEM", "NAME") || extractTag(block, "NAME");
    if (!name) continue;
    masters.push({
      kind: "stock-item",
      name,
      parent: extractTag(block, "PARENT"),
      gstin: null,
      state: null,
      country: null,
      addressLines: [],
      city: null,
      postalCode: null,
      unit: extractTag(block, "BASEUNITS") || extractTag(block, "BASEUNIT"),
      hsnCode: extractTag(block, "HSNCODE") || extractTag(block, "GSTHSNNAME"),
      gstRate: gstRateFromBlock(block),
      openingBalance: toNumber(extractTag(block, "OPENINGBALANCE")),
      sku: extractTag(block, "SKU") || extractTag(block, "ALIAS"),
      classification: "New",
      matchedId: null,
      differences: [],
    });
  }

  for (const block of extractAllTags(xmlContent, "UNIT")) {
    const name = extractAttr(block, "UNIT", "NAME") || extractTag(block, "NAME");
    if (!name) continue;
    masters.push({
      kind: "unit",
      name,
      parent: null,
      gstin: null,
      state: null,
      country: null,
      addressLines: [],
      city: null,
      postalCode: null,
      unit: name,
      hsnCode: null,
      gstRate: null,
      openingBalance: null,
      sku: null,
      classification: "New",
      matchedId: null,
      differences: [],
    });
  }

  return masters;
}

export function parseTallyXml(xmlContent: string): StagedTallyVoucher[] {
  const vouchers: StagedTallyVoucher[] = [];
  const voucherBlocks = extractAllTags(xmlContent, "VOUCHER");

  for (const block of voucherBlocks) {
    const guid = extractTag(block, "GUID");
    const vchType = extractTag(block, "VOUCHERTYPENAME") || extractAttr(block, "VOUCHER", "VCHTYPE") || "Sales";
    const date = normalizeDate(extractTag(block, "DATE"));
    const voucherNumber =
      extractTag(block, "VOUCHERNUMBER") ||
      extractAttr(block, "VOUCHER", "VOUCHERNUMBER") ||
      extractAttr(block, "VOUCHER", "NUMBER");
    const narration = extractTag(block, "NARRATION");
    const reference =
      extractTag(block, "REFERENCE") || extractWhizunikRef(narration) || voucherNumber;
    const partyName = extractTag(block, "PARTYLEDGERNAME") || extractTag(block, "BASICBUYERNAME");
    const partyGstin = normalizeGstin(extractTag(block, "PARTYGSTIN"));
    const placeOfSupply = extractTag(block, "PLACEOFSUPPLY");

    const ewayBlock = extractAllTags(block, "EWAYBILLDETAILS.LIST")[0] || "";
    const irn =
      extractTag(block, "IRN") ||
      extractTag(block, "IRNACKNO") ||
      extractIrnFromText(narration);
    const ackNo =
      extractTag(block, "ACKNO") ||
      extractTag(block, "GSTINVOICEACKNO") ||
      extractAckFromText(narration);
    const ackDateRaw = extractTag(block, "ACKDATE");
    const ackDate = ackDateRaw ? normalizeDate(ackDateRaw) : null;
    const ewayBillNo =
      extractTag(block, "EWAYBILLNO") ||
      extractTag(block, "EWBNO") ||
      (ewayBlock ? extractTag(ewayBlock, "BILLNUMBER") : null) ||
      extractEwayFromText(narration);
    const ewayBillDateRaw =
      extractTag(block, "EWAYBILLDATE") ||
      (ewayBlock ? extractTag(ewayBlock, "BILLDATE") : null) ||
      (ewayBlock ? extractTag(ewayBlock, "VALIDUNTIL") : null);
    const ewayBillDate = ewayBillDateRaw ? normalizeDate(ewayBillDateRaw) : null;

    const ledgers: StagedTallyLedger[] = [];
    let voucherAmount = 0;

    for (const lBlock of extractAllTags(block, "LEDGERENTRIES.LIST")) {
      const name = extractTag(lBlock, "LEDGERNAME") || "";
      const amount = toNumber(extractTag(lBlock, "AMOUNT"));
      const isPositive = extractTag(lBlock, "ISDEEMEDPOSITIVE") === "Yes";
      const isParty =
        extractTag(lBlock, "ISPARTYLEDGER") === "Yes" ||
        (!!partyName && name.trim().toLowerCase() === partyName.trim().toLowerCase());
      const bills: StagedTallyBill[] = extractAllTags(lBlock, "BILLALLOCATIONS.LIST")
        .map((b) => ({
          name: extractTag(b, "NAME") || "",
          amount: toNumber(extractTag(b, "AMOUNT")),
          type: extractTag(b, "BILLTYPE"),
        }))
        .filter((b) => !!b.name);
      ledgers.push({ name, amount, deemedPositive: isPositive, isParty, bills });
      if (Math.abs(amount) > voucherAmount) voucherAmount = Math.abs(amount);
    }

    vouchers.push({
      guid,
      voucherNumber,
      reference,
      date,
      voucherType: vchType,
      partyName,
      partyGstin,
      placeOfSupply,
      amount: round2(voucherAmount),
      narration,
      irn,
      ackNo,
      ackDate,
      ewayBillNo,
      ewayBillDate,
      ledgers,
      lines: parseInventoryLines(block),
      classification: "New",
      matchedId: null,
      matchedDocNumber: null,
      differences: [],
    });
  }

  return vouchers;
}

export async function matchAndClassifyStaged(
  clientId: string,
  staged: StagedTallyVoucher[],
): Promise<StagedTallyVoucher[]> {
  const [invoices, purchases, debtors, suppliers] = await Promise.all([
    Invoice.list().catch(() => [] as any[]),
    PurchaseInvoice.list().catch(() => [] as any[]),
    Debtor.list().catch(() => [] as any[]),
    Supplier.list().catch(() => [] as any[]),
  ]);

  const invoicesByNum = new Map<string, any>();
  for (const inv of invoices as any[]) {
    if (inv.invoiceNumber) invoicesByNum.set(inv.invoiceNumber.trim().toLowerCase(), inv);
  }

  const purchasesByNum = new Map<string, any>();
  for (const pi of purchases as any[]) {
    if (pi.invoiceNumber) purchasesByNum.set(pi.invoiceNumber.trim().toLowerCase(), pi);
  }

  const debtorNames = new Set((debtors as any[]).map((d) => (d.name || "").trim().toLowerCase()));
  const supplierNames = new Set((suppliers as any[]).map((s) => (s.companyName || "").trim().toLowerCase()));

  for (const row of staged) {
    const refKey = resolveDocumentNumber(row).toLowerCase();
    const isSales = row.voucherType.toLowerCase().includes("sales");
    const isPurchase = row.voucherType.toLowerCase().includes("purchase");

    if (isSales && refKey) {
      const match = invoicesByNum.get(refKey);
      if (match) {
        row.matchedId = match.id;
        row.matchedDocNumber = match.invoiceNumber;
        const diffs: string[] = [];
        const whizTotal = round2(Number(match.grandTotal) || Number(match.amount) || 0);
        if (Math.abs(whizTotal - row.amount) > 0.05) {
          diffs.push(`Amount mismatch: Tally ${row.amount.toFixed(2)} vs WhizUnik ${whizTotal.toFixed(2)}`);
        }
        if (match.tallyVoucherRef && match.tallyVoucherRef !== row.voucherNumber) {
          diffs.push(`Tally voucher # already set: ${match.tallyVoucherRef}`);
        }
        row.differences = diffs;
        row.classification = diffs.length ? "Changed" : "Matched";
      } else {
        if (row.partyName && !debtorNames.has(row.partyName.trim().toLowerCase())) {
          row.classification = "Missing Master";
          row.differences.push(`Customer "${row.partyName}" does not exist in WhizUnik`);
        } else {
          row.classification = "New";
        }
      }
    } else if (isPurchase && refKey) {
      const match = purchasesByNum.get(refKey);
      if (match) {
        row.matchedId = match.id;
        row.matchedDocNumber = match.invoiceNumber;
        const diffs: string[] = [];
        const whizTotal = round2(Number(match.grandTotal) || Number(match.amount) || 0);
        if (Math.abs(whizTotal - row.amount) > 0.05) {
          diffs.push(`Amount mismatch: Tally ${row.amount.toFixed(2)} vs WhizUnik ${whizTotal.toFixed(2)}`);
        }
        row.differences = diffs;
        row.classification = diffs.length ? "Changed" : "Matched";
      } else {
        if (row.partyName && !supplierNames.has(row.partyName.trim().toLowerCase())) {
          row.classification = "Missing Master";
          row.differences.push(`Supplier "${row.partyName}" does not exist in WhizUnik`);
        } else {
          row.classification = "New";
        }
      }
    }
  }

  return staged;
}

export async function matchAndClassifyMasters(
  clientId: string,
  staged: StagedTallyMaster[],
): Promise<StagedTallyMaster[]> {
  const [debtors, suppliers, vendors, products] = await Promise.all([
    Debtor.list().catch(() => [] as any[]),
    Supplier.list().catch(() => [] as any[]),
    Vendor.list().catch(() => [] as any[]),
    Product.list().catch(() => [] as any[]),
  ]);

  const debtorByName = new Map<string, any>();
  const debtorByGstin = new Map<string, any>();
  for (const d of debtors as any[]) {
    if (d.name) debtorByName.set(d.name.trim().toLowerCase(), d);
    if (d.gstin) debtorByGstin.set(String(d.gstin).trim().toUpperCase(), d);
  }

  const supplierByName = new Map<string, any>();
  const supplierByGstin = new Map<string, any>();
  for (const s of suppliers as any[]) {
    if (s.companyName) supplierByName.set(s.companyName.trim().toLowerCase(), s);
    if (s.gstin) supplierByGstin.set(String(s.gstin).trim().toUpperCase(), s);
  }
  for (const v of vendors as any[]) {
    if (v.name && !supplierByName.has(v.name.trim().toLowerCase())) {
      supplierByName.set(v.name.trim().toLowerCase(), v);
    }
  }

  const productByName = new Map<string, any>();
  const productBySku = new Map<string, any>();
  for (const p of products as any[]) {
    if (p.name) productByName.set(p.name.trim().toLowerCase(), p);
    if (p.sku) productBySku.set(String(p.sku).trim().toUpperCase(), p);
  }

  for (const master of staged) {
    if (master.kind === "customer") {
      const match =
        (master.gstin && debtorByGstin.get(master.gstin.trim().toUpperCase())) ||
        debtorByName.get(master.name.trim().toLowerCase());
      if (match) {
        master.classification = "Matched";
        master.matchedId = match.id;
      }
    } else if (master.kind === "supplier") {
      const match =
        (master.gstin && supplierByGstin.get(master.gstin.trim().toUpperCase())) ||
        supplierByName.get(master.name.trim().toLowerCase());
      if (match) {
        master.classification = "Matched";
        master.matchedId = match.id;
      }
    } else if (master.kind === "stock-item") {
      const match =
        (master.sku && productBySku.get(master.sku.trim().toUpperCase())) ||
        productByName.get(master.name.trim().toLowerCase());
      if (match) {
        master.classification = "Matched";
        master.matchedId = match.id;
      }
    }
  }

  return staged;
}

function emptyCounts(): TallyImportCounts {
  return { created: 0, updated: 0, skipped: 0, failed: 0 };
}

function emptyReport(): TallyImportReport {
  return {
    masters: {
      customers: emptyCounts(),
      suppliers: emptyCounts(),
      stockItems: emptyCounts(),
      units: emptyCounts(),
    },
    vouchers: {
      sales: emptyCounts(),
      purchases: emptyCounts(),
      receipts: emptyCounts(),
      payments: emptyCounts(),
      creditNotes: emptyCounts(),
      debitNotes: emptyCounts(),
    },
    errors: [],
    warnings: [],
  };
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return date;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function slugSku(name: string): string {
  const base = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return `TALLY-${base || "ITEM"}`;
}

function uniqueSku(base: string, taken: Set<string>): string {
  let candidate = base;
  for (let n = 2; taken.has(candidate.toUpperCase()); n++) candidate = `${base}-${n}`;
  taken.add(candidate.toUpperCase());
  return candidate;
}

function candidateRefs(voucher: StagedTallyVoucher): string[] {
  const refs = new Set<string>();
  for (const ref of [voucher.reference, voucher.voucherNumber]) {
    if (ref) refs.add(ref.trim());
  }
  for (const ledger of voucher.ledgers) {
    for (const bill of ledger.bills) {
      if (bill.name) refs.add(bill.name.trim());
    }
  }
  const narration = voucher.narration || "";
  for (const match of narration.matchAll(/(?:against|for|ref(?:erence)?[:\s]+)\s*([A-Za-z0-9][A-Za-z0-9/_.-]*)/gi)) {
    refs.add(match[1].trim());
  }
  return [...refs];
}

function findDocByRefs(voucher: StagedTallyVoucher, docs: Map<string, any>): any | null {
  for (const ref of candidateRefs(voucher)) {
    const match = docs.get(ref.toLowerCase());
    if (match) return match;
  }
  return null;
}

function parseUtr(voucher: StagedTallyVoucher): string | null {
  const narration = voucher.narration || "";
  const m = /UTR[:\s]+([A-Za-z0-9]+)/i.exec(narration);
  return m ? m[1] : null;
}

async function resolveDebtor(
  voucher: StagedTallyVoucher,
  maps: {
    byName: Map<string, any>;
    byGstin: Map<string, any>;
    createMissing: boolean;
    clientId: string;
    report: TallyImportReport;
  },
): Promise<any> {
  const name = (voucher.partyName || "").trim();
  const gstin = (voucher.partyGstin || "").trim().toUpperCase();
  const match =
    (gstin && maps.byGstin.get(gstin)) || (name && maps.byName.get(name.toLowerCase())) || null;
  if (match) return match;
  if (!maps.createMissing || !name) return null;
  const state = voucher.placeOfSupply || (gstin ? stateNameFromCode(gstin.slice(0, 2)) : null);
  const created = await Debtor.create({
    name,
    gstin: gstin || null,
    state: state || null,
    stateCode: gstin ? gstin.slice(0, 2) : null,
    notes: "Auto-created during Tally XML import.",
  });
  maps.byName.set(name.toLowerCase(), created);
  if (gstin) maps.byGstin.set(gstin, created);
  maps.report.masters.customers.created++;
  return created;
}

async function resolveSupplier(
  voucher: StagedTallyVoucher,
  maps: {
    byName: Map<string, any>;
    byGstin: Map<string, any>;
    createMissing: boolean;
    report: TallyImportReport;
  },
): Promise<any> {
  const name = (voucher.partyName || "").trim();
  const gstin = (voucher.partyGstin || "").trim().toUpperCase();
  const match =
    (gstin && maps.byGstin.get(gstin)) || (name && maps.byName.get(name.toLowerCase())) || null;
  if (match) return match;
  if (!maps.createMissing || !name) return null;
  const stateCode = gstin ? gstin.slice(0, 2) : null;
  const created = await Supplier.create({
    companyName: name,
    gstin: gstin || null,
    stateCode,
    notes: "Auto-created during Tally XML import.",
  });
  maps.byName.set(name.toLowerCase(), created);
  if (gstin) maps.byGstin.set(gstin, created);
  maps.report.masters.suppliers.created++;
  return created;
}

async function resolveProduct(
  line: StagedTallyLine,
  maps: {
    byName: Map<string, any>;
    bySku: Map<string, any>;
    takenSkus: Set<string>;
    createMissing: boolean;
    clientId: string;
    report: TallyImportReport;
    forPurchase: boolean;
  },
): Promise<any> {
  const name = (line.stockItem || "").trim();
  const match = maps.byName.get(name.toLowerCase()) || null;
  if (match) return match;
  if (!maps.createMissing || !name) return null;
  const sku = uniqueSku(slugSku(name), maps.takenSkus);
  const price = line.unitPrice > 0 ? line.unitPrice : 0;
  const created = await Product.create({
    clientId: maps.clientId,
    sku,
    name,
    unitOfMeasure: line.unit || "piece",
    unitPrice: maps.forPurchase ? 0 : price,
    unitCost: maps.forPurchase ? price : 0,
    hsnCode: line.hsnCode || null,
    gstRate: line.gstRate ?? null,
    status: "active",
  });
  maps.byName.set(name.toLowerCase(), created);
  maps.bySku.set(sku.toUpperCase(), created);
  maps.report.masters.stockItems.created++;
  return created;
}

async function importMasters(
  clientId: string,
  masters: StagedTallyMaster[],
  options: TallyImportOptions,
  report: TallyImportReport,
): Promise<void> {
  const [debtors, suppliers, vendors, products] = await Promise.all([
    Debtor.list().catch(() => [] as any[]),
    Supplier.list().catch(() => [] as any[]),
    Vendor.list().catch(() => [] as any[]),
    Product.list().catch(() => [] as any[]),
  ]);

  const debtorByName = new Map<string, any>();
  const debtorByGstin = new Map<string, any>();
  for (const d of debtors as any[]) {
    if (d.name) debtorByName.set(d.name.trim().toLowerCase(), d);
    if (d.gstin) debtorByGstin.set(String(d.gstin).trim().toUpperCase(), d);
  }

  const supplierByName = new Map<string, any>();
  const supplierByGstin = new Map<string, any>();
  for (const s of suppliers as any[]) {
    if (s.companyName) supplierByName.set(s.companyName.trim().toLowerCase(), s);
    if (s.gstin) supplierByGstin.set(String(s.gstin).trim().toUpperCase(), s);
  }
  for (const v of vendors as any[]) {
    if (v.name && !supplierByName.has(v.name.trim().toLowerCase())) {
      supplierByName.set(v.name.trim().toLowerCase(), v);
    }
  }

  const productByName = new Map<string, any>();
  const productBySku = new Map<string, any>();
  for (const p of products as any[]) {
    if (p.name) productByName.set(p.name.trim().toLowerCase(), p);
    if (p.sku) productBySku.set(String(p.sku).trim().toUpperCase(), p);
  }
  const takenSkus = new Set((products as any[]).map((p) => String(p.sku || "").toUpperCase()));

  for (const master of masters) {
    if (master.kind === "customer") {
      const gstin = master.gstin ? master.gstin.trim().toUpperCase() : "";
      const existing =
        (gstin && debtorByGstin.get(gstin)) || debtorByName.get(master.name.trim().toLowerCase());
      if (existing) {
        const updates: any = {};
        if (!existing.gstin && gstin) updates.gstin = gstin;
        if (!existing.state && master.state) updates.state = master.state;
        if (!existing.country && master.country) updates.country = master.country;
        if (!existing.stateCode && gstin) updates.stateCode = gstin.slice(0, 2);
        if (!existing.city && master.city) updates.city = master.city;
        if (!existing.postalCode && master.postalCode) updates.postalCode = master.postalCode;
        if (!existing.billingAddress && master.addressLines.length) {
          updates.billingAddresses = [
            {
              label: null,
              address: master.addressLines.join(", "),
              city: master.city,
              state: master.state,
              postalCode: master.postalCode,
            },
          ];
        }
        if (Object.keys(updates).length) {
          await Debtor.update(existing.id, updates);
          report.masters.customers.updated++;
        } else {
          report.masters.customers.skipped++;
        }
      } else {
        const created = await Debtor.create({
          name: master.name,
          gstin: gstin || null,
          state: master.state || null,
          country: master.country || null,
          stateCode: gstin ? gstin.slice(0, 2) : null,
          city: master.city,
          postalCode: master.postalCode,
          billingAddresses: master.addressLines.length
            ? [
                {
                  label: null,
                  address: master.addressLines.join(", "),
                  city: master.city,
                  state: master.state,
                  postalCode: master.postalCode,
                },
              ]
            : undefined,
          notes: "Imported from Tally XML.",
        });
        debtorByName.set(master.name.trim().toLowerCase(), created);
        if (gstin) debtorByGstin.set(gstin, created);
        report.masters.customers.created++;
      }
    } else if (master.kind === "supplier") {
      const gstin = master.gstin ? master.gstin.trim().toUpperCase() : "";
      const existing =
        (gstin && supplierByGstin.get(gstin)) || supplierByName.get(master.name.trim().toLowerCase());
      if (existing) {
        if (existing.entityType === "Vendor") {
          report.masters.suppliers.skipped++;
          continue;
        }
        const updates: any = {};
        if (!existing.gstin && gstin) updates.gstin = gstin;
        if (!existing.stateCode && gstin) updates.stateCode = gstin.slice(0, 2);
        if (!existing.country && master.country) updates.country = master.country;
        if (!existing.addressLine && master.addressLines.length) {
          updates.addressLine = master.addressLines.join(", ");
        }
        if (!existing.city && master.city) updates.city = master.city;
        if (!existing.postalCode && master.postalCode) updates.postalCode = master.postalCode;
        if (Object.keys(updates).length) {
          await Supplier.update(existing.id, updates);
          report.masters.suppliers.updated++;
        } else {
          report.masters.suppliers.skipped++;
        }
      } else {
        const created = await Supplier.create({
          companyName: master.name,
          gstin: gstin || null,
          stateCode: gstin ? gstin.slice(0, 2) : null,
          country: master.country || null,
          addressLine: master.addressLines.length ? master.addressLines.join(", ") : null,
          city: master.city,
          postalCode: master.postalCode,
          status: "active",
          notes: "Imported from Tally XML.",
        });
        supplierByName.set(master.name.trim().toLowerCase(), created);
        if (gstin) supplierByGstin.set(gstin, created);
        report.masters.suppliers.created++;
      }
    } else if (master.kind === "stock-item") {
      const existing =
        (master.sku && productBySku.get(master.sku.trim().toUpperCase())) ||
        productByName.get(master.name.trim().toLowerCase());
      if (existing) {
        const updates: any = {};
        if (!existing.hsnCode && master.hsnCode) updates.hsnCode = master.hsnCode;
        if ((existing.gstRate === null || existing.gstRate === undefined) && master.gstRate !== null) {
          updates.gstRate = master.gstRate;
        }
        if (!existing.unitOfMeasure && master.unit) updates.unitOfMeasure = master.unit;
        if (Object.keys(updates).length) {
          await Product.update(existing.id, updates);
          report.masters.stockItems.updated++;
        } else {
          report.masters.stockItems.skipped++;
        }
      } else {
        const sku = uniqueSku(master.sku ? master.sku.trim().toUpperCase() : slugSku(master.name), takenSkus);
        const created = await Product.create({
          clientId,
          sku,
          name: master.name,
          unitOfMeasure: master.unit || "piece",
          unitPrice: 0,
          unitCost: 0,
          hsnCode: master.hsnCode || null,
          gstRate: master.gstRate ?? null,
          status: "active",
        });
        productByName.set(master.name.trim().toLowerCase(), created);
        productBySku.set(sku.toUpperCase(), created);
        report.masters.stockItems.created++;
      }
    } else {
      report.masters.units.skipped++;
    }
  }
}

async function importVouchers(
  clientId: string,
  vouchers: StagedTallyVoucher[],
  options: TallyImportOptions,
  report: TallyImportReport,
): Promise<void> {
  const [debtors, suppliers, vendors, products, invoices, purchases, receipts, notes] = await Promise.all([
    Debtor.list().catch(() => [] as any[]),
    Supplier.list().catch(() => [] as any[]),
    Vendor.list().catch(() => [] as any[]),
    Product.list().catch(() => [] as any[]),
    Invoice.list().catch(() => [] as any[]),
    PurchaseInvoice.list().catch(() => [] as any[]),
    PaymentReceipt.list().catch(() => [] as any[]),
    CreditDebitNote.list().catch(() => [] as any[]),
  ]);

  const debtorByName = new Map<string, any>();
  const debtorByGstin = new Map<string, any>();
  for (const d of debtors as any[]) {
    if (d.name) debtorByName.set(d.name.trim().toLowerCase(), d);
    if (d.gstin) debtorByGstin.set(String(d.gstin).trim().toUpperCase(), d);
  }

  const supplierByName = new Map<string, any>();
  const supplierByGstin = new Map<string, any>();
  for (const s of suppliers as any[]) {
    if (s.companyName) supplierByName.set(s.companyName.trim().toLowerCase(), s);
    if (s.gstin) supplierByGstin.set(String(s.gstin).trim().toUpperCase(), s);
  }
  for (const v of vendors as any[]) {
    if (v.name && !supplierByName.has(v.name.trim().toLowerCase())) {
      supplierByName.set(v.name.trim().toLowerCase(), v);
    }
  }

  const productByName = new Map<string, any>();
  const productBySku = new Map<string, any>();
  for (const p of products as any[]) {
    if (p.name) productByName.set(p.name.trim().toLowerCase(), p);
    if (p.sku) productBySku.set(String(p.sku).trim().toUpperCase(), p);
  }
  const takenSkus = new Set((products as any[]).map((p) => String(p.sku || "").toUpperCase()));

  const invoicesByNumber = new Map<string, any>();
  for (const inv of invoices as any[]) {
    if (inv.invoiceNumber) invoicesByNumber.set(String(inv.invoiceNumber).trim().toLowerCase(), inv);
  }

  const purchasesByKey = new Map<string, any>();
  for (const pi of purchases as any[]) {
    if (pi.invoiceNumber) {
      purchasesByKey.set(
        `${pi.vendorId || ""}|${String(pi.invoiceNumber).trim().toLowerCase()}`,
        pi,
      );
    }
  }

  const receiptKeys = new Set<string>();
  for (const receipt of receipts as any[]) {
    if (receipt.status === "verified" && receipt.invoiceId) {
      receiptKeys.add(
        `${receipt.invoiceId}|${round2(Number(receipt.amount) || 0)}|${receipt.receiptDate || ""}`,
      );
      if (receipt.utr) receiptKeys.add(`utr|${String(receipt.utr).toUpperCase()}`);
    }
  }

  const notesByNumber = new Map<string, any>();
  for (const note of notes as any[]) {
    if (note.noteNumber) notesByNumber.set(String(note.noteNumber).trim().toLowerCase(), note);
  }

  const createMissing = options.createMissingMasters !== false;
  const updatedBy = options.updatedBy || "tally-import";
  const debtorMaps = { byName: debtorByName, byGstin: debtorByGstin, createMissing, clientId, report };
  const supplierMaps = { byName: supplierByName, byGstin: supplierByGstin, createMissing, report };
  const productMaps = {
    byName: productByName,
    bySku: productBySku,
    takenSkus,
    createMissing,
    clientId,
    report,
    forPurchase: false,
  };

  for (const voucher of vouchers) {
    const type = voucher.voucherType.toLowerCase();
    const docNumber =
      resolveDocumentNumber(voucher) || `TALLY-${voucher.date || "UNKNOWN"}`;
    try {
      if (type.includes("sales")) {
        const debtor = await resolveDebtor(voucher, debtorMaps);
        if (!debtor) throw new Error(`Customer "${voucher.partyName || "unknown"}" not found.`);
        const invoiceNumber = resolveDocumentNumber(voucher) || `TALLY-SI-${Date.now()}`;
        const existing = invoicesByNumber.get(invoiceNumber.trim().toLowerCase());
        if (existing) {
          // Existing invoice: enrich missing Tally metadata instead of
          // overwriting operational fields.
          let changed = false;
          const patch: any = {};
          if (!existing.tallyVoucherRef && (voucher.voucherNumber || voucher.reference)) {
            patch.tallyVoucherRef = voucher.voucherNumber || voucher.reference;
          }
          if (!existing.tallyInvoiceNumber && (voucher.voucherNumber || voucher.reference)) {
            patch.tallyInvoiceNumber = voucher.voucherNumber || voucher.reference;
          }
          if (Object.keys(patch).length) {
            await Invoice.update(existing.id, patch);
            changed = true;
          }
          if (existing.irn && voucher.irn && existing.irn.toLowerCase() !== voucher.irn.toLowerCase()) {
            report.warnings.push({
              section: "sales",
              docNumber: invoiceNumber,
              message: `IRN in Tally differs from WhizUnik - kept the existing IRN.`,
            });
          }
          if (existing.ewbNumber && voucher.ewayBillNo && existing.ewbNumber !== voucher.ewayBillNo) {
            report.warnings.push({
              section: "sales",
              docNumber: invoiceNumber,
              message: `e-Way Bill number in Tally differs from WhizUnik - kept the existing number.`,
            });
          }
          const missingStatutory =
            (!existing.irn && voucher.irn) ||
            (!existing.ackNo && voucher.ackNo) ||
            (!existing.ewbNumber && voucher.ewayBillNo);
          if (missingStatutory) {
            try {
              await Invoice.applyTallyStatutory(existing.id, {
                irn: !existing.irn ? voucher.irn : null,
                ackNo: !existing.ackNo ? voucher.ackNo : null,
                ackDate: !existing.ackDate && voucher.ackDate ? normalizeDate(voucher.ackDate) : null,
                ewbNumber: !existing.ewbNumber ? voucher.ewayBillNo : null,
                ewbDate: !existing.ewbDate && voucher.ewayBillDate ? normalizeDate(voucher.ewayBillDate) : null,
                enteredBy: updatedBy,
              });
              changed = true;
            } catch (err: any) {
              report.warnings.push({
                section: "sales",
                docNumber: invoiceNumber,
                message: `Statutory details not applied: ${err?.message || err}`,
              });
            }
          }
          if (changed) report.vouchers.sales.updated++;
          else report.vouchers.sales.skipped++;
          continue;
        }
        const lines: any[] = [];
        for (const line of voucher.lines) {
          const product = await resolveProduct(line, { ...productMaps, forPurchase: false });
          if (!product) throw new Error(`Stock item "${line.stockItem}" not found.`);
          const quantity = line.quantity > 0 ? line.quantity : 1;
          const unitPrice = line.unitPrice > 0 ? line.unitPrice : line.amount / quantity;
          lines.push({
            productId: product.id,
            sku: product.sku,
            name: product.name,
            unit: line.unit || product.unitOfMeasure,
            quantity,
            unitPrice: round2(unitPrice),
            discountPct: 0,
            gstRate: line.gstRate ?? product.gstRate ?? 0,
            hsnCode: line.hsnCode || product.hsnCode || null,
            rateInclTax: round2(unitPrice),
            lineTotal: round2(quantity * unitPrice),
          });
        }
        const irn = voucher.irn ? Invoice.normalizeIrn(voucher.irn) : null;
        if (voucher.irn && !irn) {
          report.warnings.push({
            section: "sales",
            docNumber: invoiceNumber,
            message: `IRN "${voucher.irn}" is not a valid 64-character IRP reference - not saved.`,
          });
        }
        const created = await Invoice.create({
          clientId,
          debtorId: debtor.id,
          invoiceNumber,
          amount: voucher.amount,
          issueDate: voucher.date || new Date().toISOString().slice(0, 10),
          dueDate: addDays(voucher.date || new Date().toISOString().slice(0, 10), 30),
          status: "issued",
          lines,
          lineItems: lines,
          placeOfSupply: voucher.placeOfSupply || debtor.state || null,
          buyerGstin: voucher.partyGstin || debtor.gstin || null,
          buyerState: debtor.state || null,
          buyerStateCode: debtor.stateCode || null,
          tallyVoucherRef: voucher.voucherNumber || voucher.reference || null,
          tallyInvoiceNumber: voucher.voucherNumber || voucher.reference || null,
          irn,
          ackNo: voucher.ackNo || null,
          ackDate: voucher.ackDate ? normalizeDate(voucher.ackDate) : null,
          irnSource: irn ? "tally" : null,
          irnEnteredBy: irn ? updatedBy : null,
          irnEnteredAt: irn ? new Date().toISOString() : null,
          ewbNumber: voucher.ewayBillNo || null,
          ewbDate: voucher.ewayBillDate ? normalizeDate(voucher.ewayBillDate) : null,
          notes: voucher.narration || "Imported from Tally XML.",
        });
        invoicesByNumber.set(invoiceNumber.trim().toLowerCase(), created);
        report.vouchers.sales.created++;
        if (!lines.length) {
          report.warnings.push({
            section: "sales",
            docNumber: invoiceNumber,
            message: "Invoice has no inventory line items.",
          });
        }

      } else if (type.includes("purchase")) {
        const supplier = await resolveSupplier(voucher, supplierMaps);
        if (!supplier) throw new Error(`Supplier "${voucher.partyName || "unknown"}" not found.`);
        const invoiceNumber = resolveDocumentNumber(voucher) || `TALLY-PI-${Date.now()}`;
        const key = `${supplier.id}|${invoiceNumber.trim().toLowerCase()}`;
        const existing = purchasesByKey.get(key);
        if (existing) {
          const patch: any = {};
          if (!existing.tallyVoucherRef && (voucher.voucherNumber || voucher.reference)) {
            patch.tallyVoucherRef = voucher.voucherNumber || voucher.reference;
          }
          if (!existing.tallyInvoiceNumber && (voucher.voucherNumber || voucher.reference)) {
            patch.tallyInvoiceNumber = voucher.voucherNumber || voucher.reference;
          }
          if (!existing.ewayBillNo && voucher.ewayBillNo) patch.ewayBillNo = voucher.ewayBillNo;
          if (!existing.ewayBillDate && voucher.ewayBillDate) {
            patch.ewayBillDate = normalizeDate(voucher.ewayBillDate);
          }
          if (Object.keys(patch).length) {
            await PurchaseInvoice.update(existing.id, patch);
            report.vouchers.purchases.updated++;
          } else {
            report.vouchers.purchases.skipped++;
          }
          continue;
        }
        const lines: any[] = [];
        for (const line of voucher.lines) {
          const product = await resolveProduct(line, { ...productMaps, forPurchase: true });
          if (!product) throw new Error(`Stock item "${line.stockItem}" not found.`);
          const quantity = line.quantity > 0 ? line.quantity : 1;
          const unitPrice = line.unitPrice > 0 ? line.unitPrice : line.amount / quantity;
          lines.push({
            productId: product.id,
            sku: product.sku,
            name: product.name,
            unit: line.unit || product.unitOfMeasure,
            orderedQty: quantity,
            grnReceivedQty: quantity,
            invoiceQty: quantity,
            unitPrice: round2(unitPrice),
            poUnitPrice: round2(unitPrice),
            gstRate: line.gstRate ?? product.gstRate ?? 0,
            hsnCode: line.hsnCode || product.hsnCode || null,
            lineTotal: round2(quantity * unitPrice),
          });
        }
        const created = await PurchaseInvoice.create({
          clientId,
          vendorId: supplier.id,
          supplierName: supplier.companyName || supplier.name,
          invoiceNumber,
          issueDate: voucher.date || new Date().toISOString().slice(0, 10),
          dueDate: addDays(voucher.date || new Date().toISOString().slice(0, 10), 30),
          status: "draft",
          lines,
          tallyVoucherRef: voucher.voucherNumber || voucher.reference || null,
          tallyInvoiceNumber: voucher.voucherNumber || voucher.reference || null,
          ewayBillNo: voucher.ewayBillNo || null,
          ewayBillDate: voucher.ewayBillDate ? normalizeDate(voucher.ewayBillDate) : null,
          notes: voucher.narration || "Imported from Tally XML.",
        });
        purchasesByKey.set(key, created);
        report.vouchers.purchases.created++;
        if (!lines.length) {
          report.warnings.push({
            section: "purchases",
            docNumber: invoiceNumber,
            message: "Purchase invoice has no inventory line items.",
          });
        }
      } else if (type.includes("receipt")) {
        const invoice = findDocByRefs(voucher, invoicesByNumber);
        if (!invoice) throw new Error("Linked sales invoice not found for receipt.");
        const amount = round2(voucher.amount);
        if (!(amount > 0)) throw new Error("Receipt amount is zero.");
        const receiptDate = voucher.date || new Date().toISOString().slice(0, 10);
        const utr = parseUtr(voucher);
        const key = `${invoice.id}|${amount}|${receiptDate}`;
        if (receiptKeys.has(key) || (utr && receiptKeys.has(`utr|${utr.toUpperCase()}`))) {
          report.vouchers.receipts.skipped++;
          continue;
        }
        const submitted = await PaymentReceipt.submit({
          clientId,
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          amount,
          utr,
          paymentMode: "Tally XML",
          submittedBy: updatedBy,
        });
        await PaymentReceipt.verify(submitted.id, {
          receiptDate,
          collectionAccount: "Tally XML Import",
          paymentMode: "Tally XML",
          verifiedBy: updatedBy,
        });
        receiptKeys.add(key);
        if (utr) receiptKeys.add(`utr|${utr.toUpperCase()}`);
        report.vouchers.receipts.created++;
      } else if (type.includes("payment")) {
        const purchase = findDocByRefs(voucher, purchasesByKey);
        if (!purchase) throw new Error("Linked purchase invoice not found for payment.");
        const amount = round2(voucher.amount);
        if (!(amount > 0)) throw new Error("Payment amount is zero.");
        const reference = parseUtr(voucher) || voucher.reference || voucher.voucherNumber || "";
        if (reference && purchase.paymentReference === reference) {
          report.vouchers.payments.skipped++;
          continue;
        }
        const grandTotal = Number(purchase.grandTotal) || 0;
        const paid = round2(Math.min(grandTotal, (Number(purchase.amountPaid) || 0) + amount));
        const paymentDate = voucher.date || new Date().toISOString().slice(0, 10);
        await PurchaseInvoice.update(purchase.id, {
          amountPaid: paid,
          paidDate: paymentDate,
          status: grandTotal > 0 && paid >= grandTotal - 0.005 ? "paid" : "partially_paid",
          paymentReference: reference || purchase.paymentReference || null,
        });
        const fullyPaid = grandTotal > 0 && paid >= grandTotal - 0.005;
        await BulkPayment.create({
          clientId,
          debtorId: `supplier_${purchase.vendorId}`,
          amount,
          paymentDate,
          remaining: 0,
          invoicesClosed: fullyPaid ? 1 : 0,
          closedInvoices: fullyPaid
            ? [{ id: purchase.id, invoiceNumber: purchase.invoiceNumber, amount }]
            : [],
          partialInvoices: fullyPaid
            ? []
            : [{ id: purchase.id, invoiceNumber: purchase.invoiceNumber, amountPaid: amount }],
          creditNoteIds: [],
          mode: "manual",
          reference: reference || null,
          source: "tally",
          voucherNumber: voucher.voucherNumber || null,
          supplierName: purchase.supplierName || null,
        });
        purchase.amountPaid = paid;
        purchase.paymentReference = reference;
        report.vouchers.payments.created++;
      } else if (type.includes("credit note")) {
        const noteNumber = voucher.voucherNumber || voucher.reference || `TALLY-CN-${Date.now()}`;
        if (notesByNumber.has(noteNumber.trim().toLowerCase())) {
          report.vouchers.creditNotes.skipped++;
          continue;
        }
        const source = findDocByRefs(voucher, invoicesByNumber);
        const lines: any[] = [];
        for (const line of voucher.lines) {
          const product = await resolveProduct(line, { ...productMaps, forPurchase: false });
          const quantity = line.quantity > 0 ? line.quantity : 1;
          const unitPrice = line.unitPrice > 0 ? line.unitPrice : line.amount / quantity;
          lines.push({
            productId: product?.id || null,
            sku: product?.sku || null,
            name: product?.name || line.stockItem,
            unit: line.unit || product?.unitOfMeasure || "piece",
            quantity,
            unitPrice: round2(unitPrice),
            discountPct: 0,
            gstRate: line.gstRate ?? product?.gstRate ?? 0,
            hsnCode: line.hsnCode || product?.hsnCode || null,
            rateInclTax: round2(unitPrice),
            lineTotal: round2(quantity * unitPrice),
          });
        }
        const subtotal = round2(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice / (1 + (line.gstRate || 0) / 100), 0));
        const created = await CreditDebitNote.create({
          clientId,
          kind: "credit",
          noteNumber,
          noteDate: voucher.date || new Date().toISOString().slice(0, 10),
          amount: round2(voucher.amount),
          reason: voucher.narration || null,
          status: "approved",
          invoiceId: source?.id || null,
          appliedInvoiceId: source?.id || null,
          appliedInvoiceNumber: source?.invoiceNumber || null,
          counterparty: voucher.partyName || null,
          lineItems: lines,
          subtotal,
          taxRate: lines[0]?.gstRate ?? 0,
          taxAmount: round2(Math.max(0, round2(voucher.amount) - subtotal)),
          notes: "Imported from Tally XML.",
          source: "tally",
        });
        notesByNumber.set(noteNumber.trim().toLowerCase(), created);
        report.vouchers.creditNotes.created++;
      } else if (type.includes("debit note")) {
        const noteNumber = voucher.voucherNumber || voucher.reference || `TALLY-DN-${Date.now()}`;
        if (notesByNumber.has(noteNumber.trim().toLowerCase())) {
          report.vouchers.debitNotes.skipped++;
          continue;
        }
        const source = findDocByRefs(voucher, purchasesByKey);
        const supplier = await resolveSupplier(voucher, supplierMaps);
        const lines: any[] = [];
        for (const line of voucher.lines) {
          const product = await resolveProduct(line, { ...productMaps, forPurchase: true });
          const quantity = line.quantity > 0 ? line.quantity : 1;
          const unitPrice = line.unitPrice > 0 ? line.unitPrice : line.amount / quantity;
          lines.push({
            productId: product?.id || null,
            sku: product?.sku || null,
            name: product?.name || line.stockItem,
            unit: line.unit || product?.unitOfMeasure || "piece",
            quantity,
            unitPrice: round2(unitPrice),
            discountPct: 0,
            gstRate: line.gstRate ?? product?.gstRate ?? 0,
            hsnCode: line.hsnCode || product?.hsnCode || null,
            rateInclTax: round2(unitPrice),
            lineTotal: round2(quantity * unitPrice),
          });
        }
        const subtotal = round2(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice / (1 + (line.gstRate || 0) / 100), 0));
        const created = await CreditDebitNote.create({
          clientId,
          kind: "debit",
          noteNumber,
          noteDate: voucher.date || new Date().toISOString().slice(0, 10),
          amount: round2(voucher.amount),
          reason: voucher.narration || null,
          status: "approved",
          purchaseInvoiceId: source?.id || null,
          supplierId: supplier?.id || null,
          appliedInvoiceId: source?.id || null,
          appliedInvoiceNumber: source?.invoiceNumber || null,
          counterparty: voucher.partyName || supplier?.companyName || null,
          lineItems: lines,
          subtotal,
          taxRate: lines[0]?.gstRate ?? 0,
          taxAmount: round2(Math.max(0, round2(voucher.amount) - subtotal)),
          notes: "Imported from Tally XML.",
          source: "tally",
        });
        notesByNumber.set(noteNumber.trim().toLowerCase(), created);
        report.vouchers.debitNotes.created++;
      } else {
        report.warnings.push({
          section: "vouchers",
          docNumber,
          message: `Unsupported voucher type "${voucher.voucherType}" - skipped.`,
        });
      }
    } catch (err: any) {
      report.errors.push({
        section: type || "vouchers",
        docNumber,
        message: err?.message || String(err),
      });
      const key = type.includes("sales")
        ? "sales"
        : type.includes("purchase")
        ? "purchases"
        : type.includes("receipt")
        ? "receipts"
        : type.includes("payment")
        ? "payments"
        : type.includes("credit note")
        ? "creditNotes"
        : type.includes("debit note")
        ? "debitNotes"
        : null;
      if (key) report.vouchers[key].failed++;
    }
  }
}

export async function importTallyXml(
  xmlContent: string,
  options: TallyImportOptions,
): Promise<TallyImportReport> {
  const report = emptyReport();
  const masters = parseTallyMasters(xmlContent);
  const vouchers = parseTallyXml(xmlContent);

  await importMasters(options.clientId, masters, options, report);
  await importVouchers(options.clientId, vouchers, options, report);

  return report;
}

