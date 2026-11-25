/**
 * Parser and normalizer for Amazon SP-API Invoice / GST Tax Reports.
 *
 * Supports:
 * - India GST Merchant Tax Reports: GET_GST_MTR_B2C_CUSTOM, GET_GST_MTR_B2B_CUSTOM
 * - Invoicing Order Reports: GET_FLAT_FILE_ORDER_REPORT_DATA_INVOICING
 * - VAT / Fulfilled Shipments Invoicing Reports: GET_FLAT_FILE_VAT_INVOICE_DATA_REPORT,
 *   GET_AMAZON_FULFILLED_SHIPMENTS_DATA_INVOICING
 */

export interface ParsedAmazonInvoice {
  amazonOrderId: string;
  invoiceNumber: string | null;
  invoiceIssueDate: string | null;
  transactionType: string; // Shipment | Refund | Cancel | etc.
  shipmentId: string | null;
  sku: string | null;
  asin: string | null;
  hsnCode: string | null;
  quantity: number;
  taxableAmount: number;
  taxAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  utgstAmount: number;
  grandTotal: number;
  taxRate: number;
  currency: string;
  buyerGstin: string | null;
  sellerGstin: string | null;
  placeOfSupply: string | null;
  irnNumber: string | null;
  isB2B: boolean;
  reportType: string;
}

/** Parse CSV or TSV text into an array of lowercase-normalized header -> value maps. */
export function parseAmazonReportTable(text: string): Array<Record<string, string>> {
  const clean = String(text || "").replace(/^\uFEFF/, "");
  const lines = splitCsvLines(clean);
  if (lines.length < 2) return [];

  const headerLine = lines[0];
  const tabCount = (headerLine.match(/\t/g) || []).length;
  const commaCount = (headerLine.match(/,/g) || []).length;
  const delimiter = tabCount >= commaCount && tabCount > 0 ? "\t" : ",";

  const rawHeaders = parseDelimitedRow(headerLine, delimiter);
  const headers = rawHeaders.map(normalizeHeaderKey);

  const out: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cells = parseDelimitedRow(line, delimiter);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const h = headers[j];
      if (!h) continue;
      row[h] = (cells[j] ?? "").trim();
    }
    out.push(row);
  }
  return out;
}

function normalizeHeaderKey(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[\s_/-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function splitCsvLines(text: string): string[] {
  const lines: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '""';
        i += 1;
      } else {
        inQuotes = !inQuotes;
        cur += ch;
      }
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      lines.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0) lines.push(cur);
  return lines;
}

function parseDelimitedRow(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

function pick(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== "") return v;
  }
  return "";
}

function num(row: Record<string, string>, keys: string[]): number {
  const raw = pick(row, keys).replace(/[₹,\s]/g, "");
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function normalizeDateString(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  // Already ISO or YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // DD-MM-YYYY or DD/MM/YYYY
  const dmy = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return s;
}

/**
 * Convert parsed report rows into grouped, aggregated invoice records.
 * Rows sharing the same (amazonOrderId + invoiceNumber) are rolled up into one invoice record
 * with summed amounts, tax breakups, and combined SKU list.
 */
export function normalizeInvoiceReportRows(
  rows: Array<Record<string, string>>,
  reportType: string,
): ParsedAmazonInvoice[] {
  const grouped = new Map<string, ParsedAmazonInvoice & { _skus: Set<string>; _hsns: Set<string> }>();

  for (const row of rows) {
    const orderId = pick(row, ["order_id", "amazon_order_id", "orderid"]);
    if (!orderId) continue;

    const invoiceNumber =
      pick(row, ["invoice_number", "invoicenumber", "vat_invoice_number", "credit_note_no"]) || null;
    const transactionType =
      pick(row, ["transaction_type", "transactiontype", "event_type"]) || "Shipment";
    const shipmentId = pick(row, ["shipment_id", "shipmentid"]) || null;

    // Skip rows with neither an invoice number nor a financial invoice value unless it's a shipment row
    const invoiceAmount = num(row, ["invoice_amount", "invoiceamount", "total_invoice_amount"]);
    const taxableGross = num(row, [
      "tax_exclusive_gross",
      "taxable_value",
      "taxable_amount",
      "principal",
      "item_price",
    ]);

    if (!invoiceNumber && invoiceAmount === 0 && taxableGross === 0) {
      continue;
    }

    const invoiceDate = normalizeDateString(
      pick(row, ["invoice_date", "invoicedate", "shipment_date", "order_date", "purchase_date"]),
    );
    const sku = pick(row, ["sku", "seller_sku", "sellersku"]) || null;
    const asin = pick(row, ["asin"]) || null;
    const hsnCode = pick(row, ["hsn_sac", "hsnsac", "hsn", "hsn_code", "sac"]) || null;
    const qty = num(row, ["quantity", "quantity_shipped", "qty", "quantity_purchased"]) || 0;

    const cgst = num(row, ["cgst_tax", "cgst_amount", "cgst"]);
    const sgst = num(row, ["sgst_tax", "sgst_amount", "sgst"]);
    const igst = num(row, ["igst_tax", "igst_amount", "igst"]);
    const utgst = num(row, ["utgst_tax", "utgst_amount", "utgst"]);
    const explicitTax = num(row, ["total_tax_amount", "totaltaxamount", "tax_amount", "item_tax"]);
    const rowTax = explicitTax !== 0 ? explicitTax : round2(cgst + sgst + igst + utgst);

    const rowTaxable = taxableGross !== 0 ? taxableGross : round2(invoiceAmount - rowTax);
    const rowTotal = invoiceAmount !== 0 ? invoiceAmount : round2(rowTaxable + rowTax);

    const buyerGstin =
      pick(row, [
        "customer_bill_to_gstid",
        "buyer_gstin",
        "buyer_tax_registration_id",
        "customer_gstin",
        "gstin_of_receiver",
      ]) || null;
    const sellerGstin = pick(row, ["seller_gstin", "sellergstin", "merchant_gstin"]) || null;
    const placeOfSupply =
      pick(row, ["ship_to_state", "place_of_supply", "bill_to_state", "ship_state"]) || null;
    const irnNumber = pick(row, ["irn_number", "irn", "einvoice_irn"]) || null;
    const currency = pick(row, ["currency", "currency_code"]) || "INR";

    const isB2B =
      reportType.includes("B2B") || Boolean(buyerGstin && buyerGstin.trim().length > 0);

    const cgstRate = num(row, ["cgst_rate"]);
    const sgstRate = num(row, ["sgst_rate"]);
    const igstRate = num(row, ["igst_rate"]);
    const utgstRate = num(row, ["utgst_rate"]);
    const explicitRate = round2(cgstRate + sgstRate + igstRate + utgstRate);

    const groupKey = `${orderId}::${invoiceNumber ?? shipmentId ?? transactionType}`;
    const existing = grouped.get(groupKey);
    if (existing) {
      existing.quantity += qty;
      existing.taxableAmount = round2(existing.taxableAmount + rowTaxable);
      existing.taxAmount = round2(existing.taxAmount + rowTax);
      existing.cgstAmount = round2(existing.cgstAmount + cgst);
      existing.sgstAmount = round2(existing.sgstAmount + sgst);
      existing.igstAmount = round2(existing.igstAmount + igst);
      existing.utgstAmount = round2(existing.utgstAmount + utgst);
      existing.grandTotal = round2(existing.grandTotal + rowTotal);
      if (sku) existing._skus.add(sku);
      if (hsnCode) existing._hsns.add(hsnCode);
      if (!existing.buyerGstin && buyerGstin) existing.buyerGstin = buyerGstin;
      if (!existing.irnNumber && irnNumber) existing.irnNumber = irnNumber;
    } else {
      const skus = new Set<string>();
      if (sku) skus.add(sku);
      const hsns = new Set<string>();
      if (hsnCode) hsns.add(hsnCode);
      grouped.set(groupKey, {
        amazonOrderId: orderId,
        invoiceNumber,
        invoiceIssueDate: invoiceDate,
        transactionType,
        shipmentId,
        sku,
        asin,
        hsnCode,
        quantity: qty || 1,
        taxableAmount: round2(rowTaxable),
        taxAmount: round2(rowTax),
        cgstAmount: round2(cgst),
        sgstAmount: round2(sgst),
        igstAmount: round2(igst),
        utgstAmount: round2(utgst),
        grandTotal: round2(rowTotal),
        taxRate:
          explicitRate > 0
            ? explicitRate
            : rowTaxable > 0
              ? round2((Math.abs(rowTax) / Math.abs(rowTaxable)) * 100)
              : 0,
        currency,
        buyerGstin,
        sellerGstin,
        placeOfSupply,
        irnNumber,
        isB2B,
        reportType,
        _skus: skus,
        _hsns: hsns,
      });
    }
  }

  return Array.from(grouped.values()).map(({ _skus, _hsns, ...inv }) => {
    const skuList = Array.from(_skus);
    const hsnList = Array.from(_hsns);
    const computedRate =
      inv.taxRate > 0
        ? inv.taxRate
        : Math.abs(inv.taxableAmount) > 0
          ? round2((Math.abs(inv.taxAmount) / Math.abs(inv.taxableAmount)) * 100)
          : 0;
    return {
      ...inv,
      sku: skuList.length > 0 ? skuList.join(", ") : inv.sku,
      hsnCode: hsnList.length > 0 ? hsnList.join(", ") : inv.hsnCode,
      taxRate: computedRate,
    };
  });
}
