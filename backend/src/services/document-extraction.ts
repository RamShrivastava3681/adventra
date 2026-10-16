import { PDFParse } from "pdf-parse";
import * as Supplier from "../models/supplier.js";
import * as Vendor from "../models/vendor.js";
import * as Product from "../models/product.js";

export interface ExtractedLineItem {
  name: string;
  productCode?: string | null;
  hsnCode?: string | null;
  quantity: number;
  unit?: string | null;
  unitPrice: number;
  gstRate: number | null;
  lineTotal: number;
  matchedProductId?: string | null;
  matchedProductName?: string | null;
  matchedProductSku?: string | null;
}

export interface ExtractedDocumentData {
  documentType: "purchase_invoice" | "purchase_proforma" | "unknown";
  documentNumber: string | null;
  documentDate: string | null; // YYYY-MM-DD
  dueDate: string | null;      // YYYY-MM-DD
  supplierName: string | null;
  supplierGstin: string | null;
  supplierContact: string | null;
  supplierAddress: string | null;
  matchedSupplierId: string | null;
  matchedSupplierName: string | null;
  buyerName: string | null;
  buyerGstin: string | null;
  poNumber: string | null;
  currency: string;
  subtotal: number | null;
  gstTotal: number | null;
  freight: number | null;
  roundOff: number | null;
  grandTotal: number | null;
  lines: ExtractedLineItem[];
  confidence: "high" | "medium" | "low";
  /** "none" = nothing could be read from the file at all. */
  extractionMethod: "pdf_text" | "gemini_ai" | "none";
  /** Human-readable notes for the UI (why little/nothing could be read, …). */
  warnings: string[];
  rawTextPreview?: string;
}

// ─── Date / number helpers ───────────────────────────────────────────────

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** "Oct" / "October" / "Sept" → 10 / 10 / 9; anything else → null. */
function monthFromName(raw: string): number | null {
  const key = raw.toLowerCase().replace(/\.$/, "");
  if (key.length < 3) return null;
  if (key === "sept") return 9;
  const idx = MONTH_NAMES.findIndex((m) => m.startsWith(key));
  return idx >= 0 ? idx + 1 : null;
}

/** Validated YYYY-MM-DD, or null for impossible dates (31 Feb, month 13…). */
function buildDate(year: number, month: number, day: number): string | null {
  let y = year;
  if (y < 100) y += 2000;
  if (!(y >= 1990 && y <= 2100) || !(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) {
    return null;
  }
  const dt = new Date(Date.UTC(y, month - 1, day));
  if (dt.getUTCMonth() !== month - 1) return null;
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Normalise a printed date to YYYY-MM-DD. Supports 2026-10-12, 12/10/2026,
 * 12-10-26, 12-Oct-26, 12-Oct-2026, 12 October 2026, Oct 12, 2026.
 * Numeric dates are read day-first (Indian convention).
 */
export function normalizeDate(str?: string | null): string | null {
  if (!str) return null;
  const s = String(str).trim();
  let m = s.match(/\b(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);
  if (m) return buildDate(+m[1], +m[2], +m[3]);
  m = s.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4}|\d{2})\b/);
  if (m) return buildDate(+m[3], +m[2], +m[1]);
  m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?[-\s\/.,]*([A-Za-z]{3,9})\.?[-\s\/.,]*(\d{4}|\d{2})\b/);
  if (m) {
    const mon = monthFromName(m[2]);
    return mon ? buildDate(+m[3], mon, +m[1]) : null;
  }
  m = s.match(/\b([A-Za-z]{3,9})\.?[-\s\/.]*(\d{1,2})(?:st|nd|rd|th)?,?[-\s\/.]*(\d{4})\b/);
  if (m) {
    const mon = monthFromName(m[1]);
    return mon ? buildDate(+m[3], mon, +m[2]) : null;
  }
  return null;
}

/** Clean numeric strings: "1,45,200.50" → 145200.5, "Rs. 1,200.00" → 1200, "₹ 99/-" → 99. */
export function parseNumber(val: unknown): number | null {
  if (typeof val === "number") return Number.isFinite(val) ? val : null;
  if (val === null || val === undefined || val === "") return null;
  const s = String(val)
    .replace(/₹|INR|Rs\.?/gi, "")
    .replace(/[,\s]/g, "");
  const negative = /^\(.*\)$/.test(s) || s.startsWith("-");
  const m = s.match(/\d+(?:\.\d+)?|\.\d+/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

// ─── Rule-based text parser (digital PDFs) ───────────────────────────────

/** A printed date value in any of the supported formats (capture group). */
const DATE_VALUE =
  String.raw`(\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2}|\d{1,2}[-\/.]\d{1,2}[-\/.](?:\d{4}|\d{2})|\d{1,2}(?:st|nd|rd|th)?[-\s\/.]*[A-Za-z]{3,9}\.?[-\s\/.,]*(?:\d{4}|\d{2})|[A-Za-z]{3,9}\.?\s*\d{1,2}(?:st|nd|rd|th)?,?\s*\d{4})(?!\d)`;

/** A document / order reference value (capture group). */
const REF_VALUE = String.raw`([A-Za-z0-9][A-Za-z0-9\/\-_.]*)`;

/** "No" / "No." / "Number" / "#" — word-bounded so "Billing", "Note" never match. */
const NO_LABEL = String.raw`\s*(?:(?:no|number|num)\b\.?|#)(?:\s*(?:&|and)\s*date\b)?\s*[:\-#.]*\s*`;

const DOC_NO_RE = new RegExp(
  String.raw`\b(?:tax\s+invoice|invoice|inv|bill|proforma(?:\s+invoice)?|pi|quotation|quote|estimate)\b\.?` +
    NO_LABEL +
    REF_VALUE,
  "gi",
);
const REF_NO_RE = new RegExp(
  String.raw`\b(?:ref(?:erence)?|voucher|document|doc)\b\.?` + NO_LABEL + REF_VALUE,
  "gi",
);
const PO_RE = new RegExp(
  String.raw`\b(?:p\.?\s?o|purchase\s+order|buyer'?s?\s+order|order)\b\.?` + NO_LABEL + REF_VALUE,
  "gi",
);
/** "<word> Date : value" — the preceding word decides issue vs other dates. */
const LABELLED_DATE_RE = new RegExp(
  String.raw`(?:\b([A-Za-z][A-Za-z.]*)\s*)?\b(?:dated|date|dt)\b\.?(?:\s+of\s+(?:invoice|issue|quotation|proforma|bill))?\s*[:.\-#]*\s*` +
    DATE_VALUE,
  "gi",
);
const DUE_DATE_RE = new RegExp(
  String.raw`\b(?:due\s*date|payment\s*due(?:\s*date)?|due\s*(?:on|by)|valid\s*(?:until|till|upto|up\s*to|to)|validity(?:\s*date)?|expiry\s*date)\b\.?\s*[:.\-#]*\s*` +
    DATE_VALUE,
  "gi",
);

/** Words before "Date" that make it the document's issue date. */
const ISSUE_DATE_PREFIXES = new Set([
  "invoice", "inv", "bill", "proforma", "pi", "quotation", "quote", "estimate",
  "document", "doc", "issue", "voucher",
]);
/** Words before "Date" that make it some OTHER date (never the issue date). */
const OTHER_DATE_PREFIXES = new Set([
  "due", "delivery", "expiry", "exp", "valid", "validity", "order", "po", "p.o",
  "dispatch", "despatch", "shipping", "shipment", "ack", "challan", "lr", "grn",
  "receipt", "payment", "supply", "way", "transport",
]);

const STOP_VALUES = /^(date|dated|to|of|for|no|number|and)$/i;

function cleanRef(v: string | undefined): string | null {
  if (!v) return null;
  const s = v.trim().replace(/[.\-\/_]+$/, "");
  if (!s || s.length > 40 || STOP_VALUES.test(s) || !/\d/.test(s)) return null;
  return s;
}

/**
 * Run `re` over every line, and over each line joined with the next one (so a
 * label whose value is printed on the following line still matches). Returns
 * the first value `accept` keeps.
 */
function scanLines(
  lines: string[],
  re: RegExp,
  accept: (m: RegExpExecArray) => string | null,
): string | null {
  for (let i = 0; i < lines.length; i++) {
    const candidates = [lines[i]];
    if (i + 1 < lines.length) candidates.push(`${lines[i]} ${lines[i + 1]}`);
    for (const text of candidates) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const v = accept(m);
        if (v) return v;
        if (m[0].length === 0) re.lastIndex++;
      }
    }
  }
  return null;
}

/** Amount printed after a total label: "Grand Total : Rs. 1,200.00". */
const AMOUNT = String.raw`[\s:.\-#]*(?:\(?\s*(?:Rs\.?|INR|₹)\s*\)?\s*)?[:\-]?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)(?![0-9])`;

const GSTIN_RE = /\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1})\b/g;

function computeConfidence(d: {
  documentNumber: string | null;
  documentDate: string | null;
  supplierName: string | null;
  supplierGstin: string | null;
  grandTotal: number | null;
  lines: unknown[];
}): "high" | "medium" | "low" {
  if (d.documentNumber && d.lines.length > 0) return "high";
  const signals =
    (d.documentNumber ? 1 : 0) +
    (d.documentDate ? 1 : 0) +
    (d.supplierName || d.supplierGstin ? 1 : 0) +
    (d.grandTotal != null ? 1 : 0) +
    (d.lines.length > 0 ? 1 : 0);
  return signals >= 2 ? "medium" : "low";
}

/** Rule-based parser for text extracted from digital PDFs */
export function parseTextDocument(rawText: string, docScope?: string): ExtractedDocumentData {
  const text = rawText || "";
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // 1. Document number — invoice/bill/PI/quotation labels first, then generic refs.
  const documentNumber =
    scanLines(lines, DOC_NO_RE, (m) => cleanRef(m[1])) ??
    scanLines(lines, REF_NO_RE, (m) => cleanRef(m[1]));

  // 2. Dates — issue date from "Invoice Date"/"Date", never from "Due Date".
  const notEwayLine = (m: RegExpExecArray) => !/\be-?\s*way\b|\back\b|acknowledg/i.test(m.input);
  const prefixOf = (m: RegExpExecArray) => (m[1] || "").toLowerCase().replace(/\.+$/, "");
  const documentDate =
    scanLines(lines, LABELLED_DATE_RE, (m) =>
      notEwayLine(m) && ISSUE_DATE_PREFIXES.has(prefixOf(m)) ? normalizeDate(m[2]) : null,
    ) ??
    scanLines(lines, LABELLED_DATE_RE, (m) =>
      notEwayLine(m) && !OTHER_DATE_PREFIXES.has(prefixOf(m)) && !ISSUE_DATE_PREFIXES.has(prefixOf(m))
        ? normalizeDate(m[2])
        : null,
    );
  const dueDate = scanLines(lines, DUE_DATE_RE, (m) => normalizeDate(m[1]));

  // 3. GSTINs (15 characters: 2 state + 5 pan + 4 entity + 1 checksum)
  const gstinsFound = Array.from(new Set(text.match(GSTIN_RE) || []));
  const supplierGstin = gstinsFound[0] || null;
  const buyerGstin = gstinsFound[1] || null;

  // 4. PO Number
  const poNumber = scanLines(lines, PO_RE, (m) => cleanRef(m[1]));

  // 5. Totals
  const firstAmount = (label: string): number | null => {
    const re = new RegExp(label + AMOUNT, "i");
    for (const l of lines) {
      const m = l.match(re);
      if (m) {
        const n = parseNumber(m[1]);
        if (n != null) return n;
      }
    }
    return null;
  };
  const grandTotal = firstAmount(
    String.raw`\b(?:grand\s*total|invoice\s*total|total\s*invoice\s*(?:value|amount)|total\s*amount|total\s*value|net\s*amount|net\s*payable|final\s*total|amount\s*payable)\b`,
  );
  const subtotal = firstAmount(
    String.raw`\b(?:sub\s*-?\s*total|taxable\s*value|taxable\s*amount|total\s*taxable(?:\s*value)?|assessable\s*value)\b`,
  );
  const gstTotal = firstAmount(
    String.raw`\b(?:total\s*(?:tax|gst)(?:\s*amount)?|gst\s*amount|igst\s*amount|cgst\s*\+\s*sgst)\b`,
  );
  const freight = firstAmount(
    String.raw`\b(?:freight(?:\s*charges?)?|shipping\s*charges?|courier\s*charges?|transport(?:ation)?\s*charges?|cartage)\b`,
  );

  // 6. Supplier name heuristic — the first plausible header line.
  const headerSkip =
    /^(tax\s*invoice|invoice|proforma|quotation|quote|estimate|original|duplicate|triplicate|gst|bill\s*of\s*supply|retail\s*invoice|e-?invoice|page\b|irn\b|ack\b)/i;
  const testRe = (re: RegExp, s: string) => {
    re.lastIndex = 0;
    const hit = re.test(s);
    re.lastIndex = 0;
    return hit;
  };
  let supplierName: string | null = null;
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const l = lines[i];
    if (
      !headerSkip.test(l) &&
      !testRe(DOC_NO_RE, l) &&
      !testRe(LABELLED_DATE_RE, l) &&
      !testRe(GSTIN_RE, l) &&
      !/[:@]/.test(l) &&
      /[A-Za-z]{3,}/.test(l) &&
      l.length > 3 &&
      l.length < 60
    ) {
      supplierName = l;
      break;
    }
  }

  // 7. Line Items extraction (heuristic table parser)
  const lineItems: ExtractedLineItem[] = [];
  const linePattern = /(?:(\d+)\s+)?([A-Za-z0-9\s\-_/().&]+?)\s+(?:(\d{4,8})\s+)?([0-9]+(?:\.[0-9]+)?)\s*(pcs|nos|pairs?|box|kgs?|mtrs?|units?)?\s+([0-9,]+(?:\.[0-9]{2})?)(?:\s+([0-9]+(?:\.[0-9]+)?%?))?\s+([0-9,]+(?:\.[0-9]{2})?)$/i;

  for (const l of lines) {
    const m = l.match(linePattern);
    if (m) {
      const name = m[2]?.trim();
      const hsn = m[3] || null;
      const qty = parseNumber(m[4]) || 1;
      const unit = m[5] || "piece";
      const unitPrice = parseNumber(m[6]) || 0;
      const gstRaw = parseNumber(m[7]);
      const lineTotal = parseNumber(m[8]) || qty * unitPrice;

      if (name && unitPrice > 0 && !/^(total|subtotal|sub\s*total|grand\s*total|discount|cgst|sgst|igst)$/i.test(name)) {
        lineItems.push({
          name,
          hsnCode: hsn,
          quantity: qty,
          unit,
          unitPrice,
          gstRate: gstRaw != null ? gstRaw : null,
          lineTotal,
        });
      }
    }
  }

  const result: ExtractedDocumentData = {
    documentType: docScope === "proformas" ? "purchase_proforma" : "purchase_invoice",
    documentNumber,
    documentDate,
    dueDate,
    supplierName,
    supplierGstin,
    supplierContact: null,
    supplierAddress: null,
    matchedSupplierId: null,
    matchedSupplierName: null,
    buyerName: null,
    buyerGstin,
    poNumber,
    currency: "INR",
    subtotal,
    gstTotal,
    freight,
    roundOff: null,
    grandTotal,
    lines: lineItems,
    confidence: "low",
    extractionMethod: "pdf_text",
    warnings: [],
    rawTextPreview: text.slice(0, 1000),
  };
  result.confidence = computeConfidence(result);
  return result;
}

// ─── Gemini AI extraction (scans, photos, complex layouts) ───────────────

/** Gemini model used for extraction — override with GEMINI_MODEL in .env. */
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

/** File types Gemini accepts as inline document/image input. */
const GEMINI_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
]);

/** Inline requests are capped at ~20 MB; base64 adds a third, so keep raw files under 14 MB. */
const GEMINI_MAX_INLINE_BYTES = 14 * 1024 * 1024;

/**
 * Call the Gemini REST API (generateContent) with one inline document and a
 * prompt, asking for a JSON response. Returns the response text or null.
 * The API key only ever lives on the server (GEMINI_API_KEY in backend/.env).
 */
async function geminiGenerateJson(apiKey: string, prompt: string, buffer: Buffer, mimeType: string): Promise<string | null> {
  const model = (process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim();
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { inline_data: { mime_type: mimeType, data: buffer.toString("base64") } },
              { text: prompt },
            ],
          },
        ],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
      signal: AbortSignal.timeout(90_000),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Never log the key; the error body only carries Google's message.
    throw new Error(`Gemini API ${res.status} (model ${model}): ${body.slice(0, 300)}`);
  }
  const json: any = await res.json();
  const text = (json?.candidates?.[0]?.content?.parts ?? [])
    .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
    .join("")
    .trim();
  return text || null;
}

/** Gemini AI powered extraction for scanned images, PDFs, and rich invoice documents */
export async function extractWithGemini(
  buffer: Buffer,
  mimeType: string,
  docScope?: string,
): Promise<ExtractedDocumentData | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const mime = (mimeType || "application/pdf").split(";")[0].trim().toLowerCase();
  if (!GEMINI_MIME_TYPES.has(mime)) {
    console.warn(`[document-extraction] Gemini skipped — unsupported file type ${mime}`);
    return null;
  }
  if (buffer.length > GEMINI_MAX_INLINE_BYTES) {
    console.warn(`[document-extraction] Gemini skipped — file is ${(buffer.length / 1048576).toFixed(1)} MB (max 14 MB)`);
    return null;
  }

  try {
    const prompt = `You are an expert Indian B2B accounting document parser (Invoices, Proforma Invoices, Quotations).
Analyze this document and extract structured JSON strictly following this schema:
{
  "documentType": "${docScope === "proformas" ? "purchase_proforma" : "purchase_invoice"}",
  "documentNumber": "invoice or quotation number as string or null",
  "documentDate": "YYYY-MM-DD or null",
  "dueDate": "YYYY-MM-DD or null",
  "supplierName": "supplier / seller company name as string or null",
  "supplierGstin": "15-character GSTIN of supplier or null",
  "supplierContact": "supplier phone or email or null",
  "supplierAddress": "supplier address as string or null",
  "buyerName": "buyer company name or null",
  "buyerGstin": "15-character GSTIN of buyer or null",
  "poNumber": "buyer PO number / order reference number or null",
  "currency": "INR",
  "subtotal": number or null,
  "gstTotal": number or null,
  "freight": number or null,
  "roundOff": number or null,
  "grandTotal": number or null,
  "lines": [
    {
      "name": "full item description/name",
      "productCode": "item model/code or null",
      "hsnCode": "HSN/SAC code as string or null",
      "quantity": number,
      "unit": "unit of measure like piece, kg, box, pair",
      "unitPrice": number,
      "gstRate": number (e.g. 18 for 18%, 12 for 12%, 5 for 5%, 0 for exempt),
      "lineTotal": number
    }
  ]
}
Extract all line items accurately. Ensure numbers are numbers, not strings. All dates must be in YYYY-MM-DD format.
The document date is the invoice/issue date, never the due date. Use null for anything not printed on the document — never guess.`;

    const responseText = await geminiGenerateJson(apiKey, prompt, buffer, mime);
    if (!responseText) return null;

    // Models occasionally wrap JSON in a ```json fence despite the JSON mime type.
    const cleaned = responseText.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    const parsedRaw = JSON.parse(cleaned);
    const parsed = (Array.isArray(parsedRaw) ? parsedRaw[0] : parsedRaw) || {};
    const str = (v: unknown): string | null => {
      if (v === null || v === undefined) return null;
      const s = String(v).trim();
      return s && s.toLowerCase() !== "null" ? s : null;
    };
    const rawLines: any[] = Array.isArray(parsed.lines) ? parsed.lines : [];
    const data: ExtractedDocumentData = {
      documentType: parsed.documentType || (docScope === "proformas" ? "purchase_proforma" : "purchase_invoice"),
      documentNumber: str(parsed.documentNumber),
      documentDate: normalizeDate(str(parsed.documentDate)),
      dueDate: normalizeDate(str(parsed.dueDate)),
      supplierName: str(parsed.supplierName),
      supplierGstin: str(parsed.supplierGstin)?.toUpperCase() ?? null,
      supplierContact: str(parsed.supplierContact),
      supplierAddress: str(parsed.supplierAddress),
      matchedSupplierId: null,
      matchedSupplierName: null,
      buyerName: str(parsed.buyerName),
      buyerGstin: str(parsed.buyerGstin)?.toUpperCase() ?? null,
      poNumber: str(parsed.poNumber),
      currency: str(parsed.currency) || "INR",
      subtotal: parseNumber(parsed.subtotal),
      gstTotal: parseNumber(parsed.gstTotal),
      freight: parseNumber(parsed.freight),
      roundOff: parseNumber(parsed.roundOff),
      grandTotal: parseNumber(parsed.grandTotal),
      lines: rawLines
        .filter((l) => l && typeof l === "object")
        .map((l: any) => {
          const quantity = parseNumber(l.quantity) || 1;
          const unitPrice = parseNumber(l.unitPrice) || 0;
          return {
            name: str(l.name) || "Item",
            productCode: str(l.productCode),
            hsnCode: str(l.hsnCode),
            quantity,
            unit: str(l.unit)?.toLowerCase() || "piece",
            unitPrice,
            gstRate: parseNumber(l.gstRate),
            lineTotal: parseNumber(l.lineTotal) || quantity * unitPrice,
          };
        }),
      confidence: "low",
      extractionMethod: "gemini_ai",
      warnings: [],
    };
    data.confidence = computeConfidence(data);
    return data;
  } catch (err: any) {
    console.error("Gemini invoice extraction failed, falling back to PDF text parser:", err?.message);
    return null;
  }
}

// ─── Database matching ───────────────────────────────────────────────────

const lc = (v: unknown) => String(v ?? "").trim().toLowerCase();
const normName = (v: unknown) => lc(v).replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
/** Drop legal suffixes so "ABC Footwear Pvt Ltd" ≈ "ABC Footwear". */
const coreName = (v: unknown) =>
  normName(v).replace(/(privatelimited|pvtltd|pvt|limited|ltd|llp)+$/g, "");

/** The single item in `arr`, preferring sellable SKUs over parent shells. */
function pickUnique<T extends { skuLevel?: string | null }>(arr: T[]): T | null {
  if (arr.length === 1) return arr[0];
  if (arr.length === 0) return null;
  const nonParent = arr.filter((p) => p.skuLevel !== "parent");
  return nonParent.length === 1 ? nonParent[0] : null;
}

/**
 * Match extracted supplier and products against the database. Shared-database
 * mode: the whole company's suppliers, vendors and catalogue are searched (no
 * per-user scoping), so every uploader gets the same matches.
 */
export async function matchWithDatabase(data: ExtractedDocumentData): Promise<ExtractedDocumentData> {
  // 1. Supplier / Vendor
  try {
    const [suppliers, vendors] = await Promise.all([
      Supplier.list().catch(() => []),
      Vendor.list().catch(() => []),
    ]);

    type Cand = { id: string; name: string; gstin: string };
    const all: Cand[] = [
      ...(suppliers as any[]).map((s) => ({
        id: String(s?.id ?? ""),
        name: String(s?.companyName ?? s?.name ?? "").trim(),
        gstin: lc(s?.gstin).toUpperCase(),
      })),
      ...(vendors as any[]).map((v) => ({
        id: String(v?.id ?? ""),
        name: String(v?.name ?? v?.companyName ?? "").trim(),
        gstin: lc(v?.gstin).toUpperCase(),
      })),
    ].filter((c) => c.id && c.name);

    const byGstin = (g: string | null) => {
      const clean = lc(g).toUpperCase();
      return clean ? all.find((c) => c.gstin && c.gstin === clean) ?? null : null;
    };

    // GSTIN exact match first. The text parser takes the first GSTIN printed
    // as the supplier's; when only the second one is a known supplier, the
    // two were the other way round.
    let match = byGstin(data.supplierGstin);
    if (!match && data.extractionMethod === "pdf_text" && data.buyerGstin) {
      const swapped = byGstin(data.buyerGstin);
      if (swapped) {
        match = swapped;
        [data.supplierGstin, data.buyerGstin] = [data.buyerGstin, data.supplierGstin];
      }
    }

    if (!match && data.supplierName) {
      const target = normName(data.supplierName);
      const targetCore = coreName(data.supplierName);
      if (target.length >= 3) {
        const exact = all.filter((c) => normName(c.name) === target);
        const exactCore = targetCore.length >= 3 ? all.filter((c) => coreName(c.name) === targetCore) : [];
        if (exact.length === 1) match = exact[0];
        else if (exact.length === 0 && exactCore.length === 1) match = exactCore[0];
        else if (exact.length === 0 && exactCore.length === 0 && targetCore.length >= 5) {
          // Conservative contains match — only when exactly one supplier fits.
          const contains = all.filter((c) => {
            const cn = coreName(c.name);
            return cn.length >= 5 && (cn.includes(targetCore) || targetCore.includes(cn));
          });
          const ids = new Set(contains.map((c) => c.id));
          if (ids.size === 1) match = contains[0];
        }
      }
    }

    if (match) {
      data.matchedSupplierId = match.id;
      data.matchedSupplierName = match.name;
    }
  } catch (err: any) {
    console.error("Supplier matching error:", err?.message);
  }

  // 2. Line items → product catalogue
  try {
    if (data.lines.length > 0) {
      const products = ((await Product.list().catch(() => [])) as any[]).filter((p) => p && p.id);
      if (products.length > 0) {
        // HSN → products, for the "only one product carries this HSN" rule.
        const byHsn = new Map<string, any[]>();
        for (const p of products) {
          const h = String(p.hsnCode ?? p.hsn_code ?? "").replace(/\s+/g, "");
          if (!h) continue;
          const arr = byHsn.get(h) ?? [];
          arr.push(p);
          byHsn.set(h, arr);
        }

        for (const line of data.lines) {
          const code = lc(line.productCode);
          const name = lc(line.name).replace(/\s+/g, " ");
          const hsn = String(line.hsnCode ?? "").replace(/\s+/g, "");
          let match: any = null;

          // a. Exact SKU / product code (supplier code, model, barcode).
          if (code) {
            match = pickUnique(
              products.filter((p) =>
                [p.sku, p.supplierProductCode, p.model, p.barcode].some((v) => v && lc(v) === code),
              ),
            );
          }
          // b. A catalogue SKU printed as a whole token in the description.
          if (!match && name) {
            const tokens = new Set(name.split(/[\s,()\[\]|]+/).filter(Boolean));
            match = pickUnique(
              products.filter((p) => {
                const sku = lc(p.sku);
                return sku.length >= 4 && tokens.has(sku);
              }),
            );
          }
          // c. Exact (case-insensitive, trimmed) name.
          if (!match && name) {
            match = pickUnique(products.filter((p) => lc(p.name).replace(/\s+/g, " ") === name));
          }
          // d. Conservative contains — only when exactly one product fits.
          if (!match && name.length >= 4) {
            const hits = products.filter((p) => {
              const pn = lc(p.name).replace(/\s+/g, " ");
              return pn.length >= 4 && (pn.includes(name) || name.includes(pn));
            });
            if (hits.length === 1) match = hits[0];
          }
          // e. HSN alone — only when exactly ONE catalogue product has it.
          if (!match && hsn) {
            const hits = byHsn.get(hsn) ?? [];
            if (hits.length === 1) match = hits[0];
          }

          if (match) {
            line.matchedProductId = match.id;
            line.matchedProductName = match.name ?? null;
            line.matchedProductSku = match.sku ?? null;
          } else {
            line.matchedProductId = null;
            line.matchedProductName = null;
            line.matchedProductSku = null;
          }
        }
      }
    }
  } catch (err: any) {
    console.error("Product matching error:", err?.message);
  }

  return data;
}

// ─── Entry point ─────────────────────────────────────────────────────────

let warnedMissingGeminiKey = false;

/** Main entry point for document extraction */
export async function extractDocumentDetails(
  buffer: Buffer,
  mimeType: string,
  docScope?: string,
): Promise<ExtractedDocumentData> {
  let extracted: ExtractedDocumentData | null = null;
  const warnings: string[] = [];
  const hasGeminiKey = !!process.env.GEMINI_API_KEY;
  const isPdf = mimeType === "application/pdf" || buffer.subarray(0, 5).toString() === "%PDF-";

  if (!hasGeminiKey && !warnedMissingGeminiKey) {
    warnedMissingGeminiKey = true;
    console.warn(
      "[document-extraction] GEMINI_API_KEY is not set — AI extraction is disabled. " +
        "Only digital (text-based) PDFs can be read; scanned PDFs and photos will return no details.",
    );
  }

  // 1. Try Gemini AI first (ideal for scanned invoices, photos, or complex layouts)
  if (hasGeminiKey) {
    extracted = await extractWithGemini(buffer, mimeType, docScope);
    if (!extracted) {
      warnings.push(
        isPdf
          ? "AI extraction failed for this file; used the basic PDF text reader instead."
          : "AI extraction failed for this file, so no details could be read.",
      );
    }
  }

  // 2. If Gemini didn't run or failed, and the file is a PDF, use the built-in text parser.
  let pdfHadText = false;
  if (!extracted && isPdf) {
    let parser: PDFParse | null = null;
    try {
      parser = new PDFParse({ data: buffer });
      const textRes = await parser.getText();
      const rawText = textRes?.text || "";
      if (rawText.trim().length > 20) {
        pdfHadText = true;
        extracted = parseTextDocument(rawText, docScope);
      }
    } catch (e: any) {
      console.error("PDFParse error:", e?.message);
    } finally {
      if (parser) {
        try {
          await parser.destroy();
        } catch {
          /* ignore cleanup failures */
        }
      }
    }
  }

  if (!hasGeminiKey && (!isPdf || !pdfHadText)) {
    warnings.push(
      isPdf
        ? "This PDF has no selectable text (it looks like a scan). Scanned PDFs and photos can only be read with AI extraction, which needs GEMINI_API_KEY configured on the server."
        : "Images and scanned documents can only be read with AI extraction, which needs GEMINI_API_KEY configured on the server.",
    );
  }

  // Nothing readable — return an empty result. Never invent values (no
  // "today" date), so applying it can't overwrite the user's form.
  if (!extracted) {
    extracted = {
      documentType: docScope === "proformas" ? "purchase_proforma" : "purchase_invoice",
      documentNumber: null,
      documentDate: null,
      dueDate: null,
      supplierName: null,
      supplierGstin: null,
      supplierContact: null,
      supplierAddress: null,
      matchedSupplierId: null,
      matchedSupplierName: null,
      buyerName: null,
      buyerGstin: null,
      poNumber: null,
      currency: "INR",
      subtotal: null,
      gstTotal: null,
      freight: null,
      roundOff: null,
      grandTotal: null,
      lines: [],
      confidence: "low",
      extractionMethod: "none",
      warnings: [],
      rawTextPreview: "No text could be extracted automatically.",
    };
  }

  // Enrich with database matches (existing suppliers and products)
  const matched = await matchWithDatabase(extracted);
  if (matched.confidence === "low" && matched.extractionMethod !== "none") {
    warnings.push("Very little could be read from this document — please check every field.");
  }
  matched.warnings = [...warnings, ...(matched.warnings ?? [])];
  return matched;
}
