// Repro / verification for the goods-PO Tally PDF blank-page issue.
// Run with: cd backend && npx tsx scripts/po-pdf-repro.ts
//
// Builds a small (1-line) and a large (many-line) purchase order, renders each
// with buildGoodsPOTallyPdf, then reports the page count and, for every page,
// the number of text tokens drawn plus which key labels appear. This makes a
// near-empty trailing page (only sign-off filler) visible.
import zlib from "node:zlib";
import { goodsPOToPdfData, buildGoodsPOTallyPdf } from "../src/lib/document-pdf.js";

function makePo(lineCount: number) {
  const sizes = ["38", "40", "42", "44"];
  const lines = Array.from({ length: lineCount }, (_, i) => {
    const size = sizes[i % sizes.length];
    const qty = (i % 5) + 1;
    const unitPrice = 100 + i;
    return {
      sku: `SKU-${String(i + 1).padStart(3, "0")}`,
      name: `Test item ${i + 1} with a somewhat long description to force wrapping in the goods table`,
      fabric: "Cotton",
      hsnCode: "6109",
      size,
      color: i % 2 ? "Black" : "Navy",
      orderedQty: qty,
      unitPrice,
      gstRate: 12,
      lineTotal: qty * unitPrice,
    };
  });
  return {
    poNumber: `PO-TEST-${lineCount}`,
    poDate: "2026-10-07",
    supplierName: "Acme Supplies Pvt Ltd",
    vendorAddress: "12 Industrial Estate, Pune, Maharashtra",
    vendorGstin: "27ABCDE1234F1Z5",
    vendorPan: "ABCDE1234F",
    vendorState: "Maharashtra",
    shipToAddress: "Warehouse 4, Bhiwandi",
    totalQty: lines.reduce((s, l) => s + l.orderedQty, 0),
    notes: "Deliver before month end. Penalty for delay applies.",
    lines,
  };
}

interface PageInfo {
  index: number;
  textTokens: number;
  text: string;
}

function inspect(buf: Buffer): { pages: number; pageInfo: PageInfo[] } {
  const raw = buf.toString("latin1");
  // Page dictionaries are uncompressed; content streams usually are not.
  const pages = (raw.match(/\/Type\s*\/Page[^s]/g) || []).length;
  const streams: string[] = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    let data = Buffer.from(m[1], "latin1");
    try {
      data = zlib.inflateSync(data);
    } catch {
      /* stream may be uncompressed */
    }
    streams.push(data.toString("latin1"));
  }
  // Keep only content streams that actually draw text, in page order.
  const contentStreams = streams.filter((s) => /\bTj\b|\bTJ\b/.test(s));
  const pageInfo: PageInfo[] = contentStreams.map((s, index) => {
    // PDFKit writes text as hex strings inside TJ arrays: [<hex> kern <hex>] TJ.
    const strings: string[] = [];
    const hexRe = /<([0-9A-Fa-f\s]+)>/g;
    let sm: RegExpExecArray | null;
    while ((sm = hexRe.exec(s))) {
      const hex = sm[1].replace(/\s+/g, "");
      if (hex.length % 2 !== 0) continue;
      strings.push(Buffer.from(hex, "hex").toString("latin1"));
    }
    const text = strings.join(" ");
    return {
      index,
      // Count text-showing operators (each TJ/Tj call = one drawn string run).
      textTokens: (s.match(/\bTj\b|\bTJ\b/g) || []).length,
      text,
    };
  });
  return { pages, pageInfo };
}

async function report(label: string, lineCount: number, quiet = false) {
  const data = goodsPOToPdfData(makePo(lineCount), {
    seller: { name: "Whizunik Pvt Ltd", gstin: "27WHIZU0000Z1", stateName: "Maharashtra" } as any,
    bank: { holder: "Whizunik", bank: "HDFC", acNo: "1234567890", ifsc: "HDFC0001", branch: "Pune" } as any,
    declarationRaw: "Goods once sold are not returnable.\nSubject to Pune jurisdiction.",
  });
  const buf = await buildGoodsPOTallyPdf(data);
  const { pages, pageInfo } = inspect(buf);
  if (!quiet) {
    console.log(`\n=== ${label} (${lineCount} line(s)) ===`);
    console.log(`PDF /Type /Page count: ${pages}`);
  }
  pageInfo.forEach((p) => {
    if (quiet) return;
    const norm = p.text.replace(/\s+/g, "");
    const hasTotal = /Total/i.test(norm);
    const hasSign = /AuthorisedSignatory/i.test(norm);
    const hasDecl = /Declaration/i.test(norm);
    console.log(
      `  page ${p.index + 1}: textTokens=${p.textTokens}` +
        `${hasTotal ? " [Total]" : ""}${hasDecl ? " [Declaration]" : ""}${hasSign ? " [Signatory]" : ""}`,
    );

  });
  return { pages, pageInfo };
}

const small = await report("small PO", 1);
await report("three-line PO", 3);
const large = await report("large PO", 45);


// Scan line counts: flag any render whose LAST page looks like a stranded
// sign-off-only tail (few tokens and no totals row).
console.log("\n=== scan: pages / last-page tokens / last page has Total? ===");
let stranded = 0;
for (let n = 1; n <= 60; n++) {
  const set = await report(`scan ${n}`, n, true);
  const last = set.pageInfo[set.pageInfo.length - 1];
  const hasTotal = last && /Total/i.test(last.text.replace(/\s+/g, ""));
  // A stranded tail = a trailing page with sign-off but no totals row.
  const strandedTail = set.pageInfo.length > 1 && last && !hasTotal;
  if (strandedTail) stranded++;
  console.log(
    `  lines=${n} pages=${set.pages} lastTokens=${last?.textTokens ?? 0} lastHasTotal=${hasTotal}` +
      (strandedTail ? "  <-- STRANDED TAIL" : ""),
  );
}

// Assertions: a 1-line PO must fit on one page; no page may be text-empty.
if (small.pages !== 1) {
  console.error(`\nFAIL: 1-line PO rendered ${small.pages} pages (expected 1)`);
  process.exit(1);
}
for (const set of [small, large]) {
  const empty = set.pageInfo.filter((p) => p.textTokens === 0);
  if (empty.length) {
    console.error(`\nFAIL: ${empty.length} text-empty page(s)`);
    process.exit(1);
  }
}
console.log(
  `\nSummary: stranded-tail renders in scan = ${stranded}.` +
    (stranded ? " (bug present)" : " (none)"),
);
process.exit(0);
