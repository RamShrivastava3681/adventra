import PDFDocument from "pdfkit";

/**
 * document-pdf.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Clean, professional A4 PDF generator for customer-facing documents
 * (Quotations and Sales Orders).
 *
 * Pricing rule: the ONLY price column shown is "Unit Price", which uses the
 * EFFECTIVE unit price — the maker's updated price when set, otherwise the
 * quoted price. Internal costs (catalogue unit cost, original/actual price)
 * never appear. Grand total is computed from those effective prices.
 */

export type PdfDocKind = "quotation" | "sales_order";

export interface DocumentPdfLine {
  sku: string | null;
  name: string;
  unit: string;
  quantity: number;
  /** Effective unit price — the updated price when set, else the quoted price. */
  unitPrice: number;
  /** Pre-formatted discount label: "10%", "$50.00" or "—". */
  discountLabel: string;
  gstRate: number | null;
  /** Line total after discount, before GST. */
  amount: number;
}

export interface DocumentPdfData {
  kind: PdfDocKind;
  number: string;
  date: string;
  validUntil: string | null;
  customerName: string | null;
  contactPerson: string | null;
  billingAddress: string | null;
  deliveryAddress: string | null;
  paymentTerms: string | null;
  expectedDeliveryDate: string | null;
  salespersonName: string | null;
  notes: string | null;
  lines: DocumentPdfLine[];
  subtotal: number;
  totalDiscount: number;
  gstTotal: number;
  freight: number;
  grandTotal: number;
  companyName: string;
  companyContact?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout constants
// ─────────────────────────────────────────────────────────────────────────────

const PAGE = { width: 595.28, height: 841.89, margin: 48 };
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;

const INK = {
  band: "#1e293b", // header band (slate-800)
  slate900: "#0f172a",
  slate700: "#334155",
  slate600: "#475569",
  slate500: "#64748b",
  slate400: "#94a3b8",
  border: "#e2e8f0",
  teal: "#0f766e",
  rowAlt: "#f8fafc",
  white: "#ffffff",
};

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

function money(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "$0.00";
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// ─────────────────────────────────────────────────────────────────────────────
// Drawing
// ─────────────────────────────────────────────────────────────────────────────

function drawHeaderBand(doc: PDFKit.PDFDocument, data: DocumentPdfData) {
  const bandTop = 0;
  const bandHeight = 96;

  doc.save();
  doc.rect(0, bandTop, PAGE.width, bandHeight).fill(INK.band);

  // Company block (left)
  doc
    .font("Helvetica-Bold")
    .fontSize(17)
    .fillColor(INK.white)
    .text(truncate(data.companyName || "Our Company", 42), PAGE.margin, bandTop + 24, {
      width: CONTENT_WIDTH * 0.55,
      lineBreak: true,
    });
  if (data.companyContact) {
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#cbd5e1")
      .text(truncate(data.companyContact, 70), PAGE.margin, bandTop + 46, {
        width: CONTENT_WIDTH * 0.55,
      });
  }

  // Document type (right)
  const kindLabel = data.kind === "quotation" ? "QUOTATION" : "SALES ORDER";
  doc
    .font("Helvetica-Bold")
    .fontSize(22)
    .fillColor(INK.white)
    .text(kindLabel, PAGE.margin, bandTop + 24, {
      width: CONTENT_WIDTH,
      align: "right",
    });
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#94a3b8")
    .text("Please review and approve", PAGE.margin, bandTop + 52, {
      width: CONTENT_WIDTH,
      align: "right",
    });

  doc.restore();

  // Underline accent
  doc.save();
  doc.rect(0, bandTop + bandHeight - 3, PAGE.width, 3).fill(INK.teal);
  doc.restore();
}

function drawMetaRow(doc: PDFKit.PDFDocument, data: DocumentPdfData, startY: number): number {
  let y = startY;

  // Document number + dates (right-aligned block)
  const rightX = PAGE.margin;
  const rightW = CONTENT_WIDTH;

  doc.font("Helvetica-Bold").fontSize(12).fillColor(INK.slate900);
  doc.text(data.number, rightX, y, { width: rightW, align: "right" });
  y += 16;

  doc.font("Helvetica").fontSize(9).fillColor(INK.slate600);
  doc.text(
    `${data.kind === "quotation" ? "Quotation date" : "Order date"}: ${fmtDate(data.date)}`,
    rightX,
    y,
    { width: rightW, align: "right" },
  );
  y += 13;
  if (data.validUntil) {
    doc.text(`Valid until: ${fmtDate(data.validUntil)}`, rightX, y, {
      width: rightW,
      align: "right",
    });
    y += 13;
  }

  return y + 6;
}

function drawParties(doc: PDFKit.PDFDocument, data: DocumentPdfData, startY: number): number {
  let y = startY;

  const colWidth = (CONTENT_WIDTH - 24) / 2;

  // BILL TO
  doc.font("Helvetica-Bold").fontSize(8).fillColor(INK.slate500);
  doc.text("BILL TO", PAGE.margin, y, { width: colWidth });
  y += 14;
  doc.font("Helvetica-Bold").fontSize(11).fillColor(INK.slate900);
  doc.text(truncate(data.customerName || "—", 40), PAGE.margin, y, { width: colWidth });
  y += 15;
  doc.font("Helvetica").fontSize(9).fillColor(INK.slate600);
  if (data.contactPerson) {
    doc.text(data.contactPerson, PAGE.margin, y, { width: colWidth });
    y += 12;
  }
  if (data.billingAddress) {
    doc.text(data.billingAddress, PAGE.margin, y, { width: colWidth, lineBreak: true });
    y += doc.heightOfString(data.billingAddress, { width: colWidth }) + 4;
  }

  // TERMS (right column)
  const termsX = PAGE.margin + colWidth + 24;
  const terms: Array<[string, string]> = [];
  terms.push(["Payment terms", data.paymentTerms || "—"]);
  if (data.expectedDeliveryDate) {
    terms.push(["Expected delivery", fmtDate(data.expectedDeliveryDate)]);
  }
  if (data.salespersonName) {
    terms.push(["Salesperson", data.salespersonName]);
  }
  let ty = startY;
  doc.font("Helvetica-Bold").fontSize(8).fillColor(INK.slate500);
  doc.text("DETAILS", termsX, ty, { width: colWidth });
  ty += 14;
  for (const [k, v] of terms) {
    doc.font("Helvetica-Bold").fontSize(8).fillColor(INK.slate500).text(k, termsX, ty, {
      width: colWidth,
    });
    ty += 10;
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(INK.slate900)
      .text(truncate(String(v), 44), termsX, ty, { width: colWidth });
    ty += 16;
  }

  return Math.max(y, ty) + 8;
}

// Column layout for the line-items table.
const COLS = {
  item: { x: PAGE.margin, w: 176 },
  qty: { x: PAGE.margin + 176, w: 46 },
  unit: { x: PAGE.margin + 222, w: 40 },
  unitPrice: { x: PAGE.margin + 262, w: 70 },
  disc: { x: PAGE.margin + 332, w: 48 },
  gst: { x: PAGE.margin + 380, w: 34 },
  amount: { x: PAGE.margin + 414, w: 86 },
};

function drawTableHeader(doc: PDFKit.PDFDocument, y: number): void {
  doc.save();
  doc.rect(PAGE.margin, y, CONTENT_WIDTH, 22).fill(INK.band);
  const cells: Array<[string, keyof typeof COLS, "left" | "right"]> = [
    ["ITEM", "item", "left"],
    ["QTY", "qty", "right"],
    ["UNIT", "unit", "right"],
    ["UNIT PRICE", "unitPrice", "right"],
    ["DISCOUNT", "disc", "right"],
    ["GST %", "gst", "right"],
    ["AMOUNT", "amount", "right"],
  ];
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(INK.white);
  for (const [label, key, align] of cells) {
    doc.text(label, COLS[key].x, y + 7, { width: COLS[key].w, align });
  }
  doc.restore();
}

function drawLineRows(
  doc: PDFKit.PDFDocument,
  lines: DocumentPdfLine[],
  startY: number,
): number {
  let y = startY;
  const rowPad = 5;

  lines.forEach((l, i) => {
    const itemW = COLS.item.w;
    const skuLine = l.sku ? `${l.sku}` : "";
    const nameH = doc.heightOfString(l.name || "", { width: itemW - 4 });
    const skuH = skuLine ? 11 : 0;
    const rowH = Math.max(26, nameH + skuH + rowPad * 2 + 2);

    // Page break — start a fresh page (with a repeated table header) when the
    // row would run past the printable area.
    if (y + rowH > PAGE.height - PAGE.margin) {
      doc.addPage();
      drawTableHeader(doc, PAGE.margin);
      y = PAGE.margin + 22 + 4;
    }

    // Row background (zebra)
    if (i % 2 === 1) {
      doc.save();
      doc.rect(PAGE.margin, y, CONTENT_WIDTH, rowH).fill(INK.rowAlt);
      doc.restore();
    }

    // Item name + SKU
    doc.font("Helvetica-Bold").fontSize(9).fillColor(INK.slate900);
    doc.text(l.name || "—", COLS.item.x, y + rowPad, { width: itemW - 4 });
    if (skuLine) {
      doc
        .font("Helvetica")
        .fontSize(7.5)
        .fillColor(INK.slate500)
        .text(skuLine, COLS.item.x, y + rowPad + nameH + 1, { width: itemW - 4 });
    }

    // Numeric cells (right-aligned, single line)
    const cell = (
      value: string,
      col: { x: number; w: number },
      bold = false,
      color = INK.slate600,
    ) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor(color);
      doc.text(value, col.x, y + rowH / 2 - 5, { width: col.w, align: "right" });
    };

    cell(String(Number(l.quantity) || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ","), COLS.qty);
    cell(l.unit || "unit", COLS.unit);
    cell(money(l.unitPrice), COLS.unitPrice, true, INK.slate900);
    cell(l.discountLabel || "—", COLS.disc);
    cell(l.gstRate != null ? `${l.gstRate}%` : "—", COLS.gst);
    cell(money(l.amount), COLS.amount, true, INK.slate900);

    y += rowH;
  });

  return y;
}

function drawTotals(doc: PDFKit.PDFDocument, data: DocumentPdfData, y: number): number {
  if (y > PAGE.height - 150) {
    doc.addPage();
    y = PAGE.margin;
  }
  const boxW = 200;
  const boxX = PAGE.width - PAGE.margin - boxW;

  const rows: Array<[string, string, boolean]> = [
    ["Subtotal", money(data.subtotal), false],
    ["Total discount", `-${money(data.totalDiscount)}`, false],
    ["GST total", money(data.gstTotal), false],
    ["Freight / charges", money(data.freight), false],
  ];

  let ry = y + 6;
  for (const [label, value, bold] of rows) {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor(INK.slate600);
    doc.text(label, boxX, ry, { width: boxW * 0.55 });
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor(INK.slate900);
    doc.text(value, boxX + boxW * 0.45, ry, { width: boxW * 0.55, align: "right" });
    ry += 15;
  }

  // Grand total — banded
  doc.save();
  doc.rect(boxX - 8, ry - 2, boxW + 16, 26).fill(INK.band);
  doc.font("Helvetica-Bold").fontSize(10).fillColor(INK.white);
  doc.text("GRAND TOTAL", boxX, ry + 4, { width: boxW * 0.55 });
  doc.text(money(data.grandTotal), boxX + boxW * 0.45, ry + 4, {
    width: boxW * 0.55,
    align: "right",
  });
  doc.restore();

  return ry + 30;
}

function drawNotes(doc: PDFKit.PDFDocument, data: DocumentPdfData, y: number): number {
  if (!data.notes) return y;
  if (y > PAGE.height - 120) {
    doc.addPage();
    y = PAGE.margin;
  }
  doc.font("Helvetica-Bold").fontSize(8).fillColor(INK.slate500).text("NOTES", PAGE.margin, y);
  const h = doc.heightOfString(data.notes, { width: CONTENT_WIDTH });
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(INK.slate600)
    .text(data.notes, PAGE.margin, y + 13, { width: CONTENT_WIDTH });
  return y + 13 + h + 14;
}

function drawSignatures(doc: PDFKit.PDFDocument, y: number): void {
  const colW = (CONTENT_WIDTH - 40) / 2;
  const lineY = y + 40;
  doc.font("Helvetica").fontSize(9).fillColor(INK.slate500);

  doc.moveTo(PAGE.margin, lineY).lineTo(PAGE.margin + colW, lineY).strokeColor(INK.border).lineWidth(1).stroke();
  doc.text("Prepared by", PAGE.margin, lineY + 6, { width: colW });

  const x2 = PAGE.margin + colW + 40;
  doc.moveTo(x2, lineY).lineTo(x2 + colW, lineY).strokeColor(INK.border).lineWidth(1).stroke();
  doc.text("Customer acceptance (signature)", x2, lineY + 6, { width: colW });
}

function drawFooters(doc: PDFKit.PDFDocument): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.save();
    doc
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor(INK.slate400)
      .text(
        "This is a computer-generated document. Prices include GST where shown; the grand total is the amount payable.",
        PAGE.margin,
        PAGE.height - 40,
        { width: CONTENT_WIDTH * 0.7 },
      );
    doc.text(
      `Page ${i + 1} of ${range.count}`,
      PAGE.margin,
      PAGE.height - 40,
      { width: CONTENT_WIDTH, align: "right" },
    );
    doc.restore();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main builder
// ─────────────────────────────────────────────────────────────────────────────

export function buildDocumentPdf(data: DocumentPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: PAGE.margin,
      bufferPages: true,
      info: {
        Title: `${data.kind === "quotation" ? "Quotation" : "Sales Order"} ${data.number}`,
        Author: data.companyName || "Adventra",
        Subject: `${data.kind === "quotation" ? "Quotation" : "Sales Order"} for ${data.customerName || "customer"}`,
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    drawHeaderBand(doc, data);
    let y = 96 + 16;
    y = drawMetaRow(doc, data, y);
    y = drawParties(doc, data, y);

    // Line items table
    doc.font("Helvetica-Bold").fontSize(8).fillColor(INK.slate500).text("LINE ITEMS", PAGE.margin, y);
    y += 16;
    drawTableHeader(doc, y);
    y += 22;
    y = drawLineRows(doc, data.lines, y) + 4;
    y = drawTotals(doc, data, y);
    y = drawNotes(doc, data, y);

    if (y > PAGE.height - 150) {
      doc.addPage();
      y = PAGE.margin;
    }
    drawSignatures(doc, Math.max(y, PAGE.height - 150));

    drawFooters(doc);
    doc.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Mappers from model records (keeps routes thin)
// ─────────────────────────────────────────────────────────────────────────────

/** Effective unit price — the updated price wins once the maker sets it. */
function effectiveUnitPrice(l: any): number {
  const n = Number(l.updatedUnitPrice ?? l.updated_unit_price);
  if (Number.isFinite(n) && n >= 0) return n;
  return Number(l.unitPrice ?? l.unit_price) || 0;
}

/** Pre-formatted discount label for the PDF ("10%", "$50.00", "—"). */
function discountLabel(l: any): string {
  const type = l.discountType ?? l.discount_type;
  const value = Number(l.discountValue ?? l.discount_value) || 0;
  if (!type || value <= 0) return "—";
  if (type === "pct") return `${value}%`;
  return money(value);
}

export function quotationToPdfData(q: any, companyName: string, companyContact?: string | null): DocumentPdfData {
  const lines: DocumentPdfLine[] = (q.lines ?? []).map((l: any) => {
    const unitPrice = effectiveUnitPrice(l);
    const quantity = Number(l.quantity) || 0;
    return {
      sku: l.sku ?? null,
      name: l.name || "Item",
      unit: l.unit || "unit",
      quantity,
      unitPrice,
      discountLabel: discountLabel(l),
      gstRate: l.gstRate ?? l.gst_rate ?? null,
      amount: Number(l.lineTotal ?? l.line_total) || 0,
    };
  });
  return {
    kind: "quotation",
    number: q.quotationNumber || q.quotation_number || "—",
    date: q.quotationDate || q.quotation_date || "",
    validUntil: q.validUntil ?? q.valid_until ?? null,
    customerName: q.customerName ?? q.customer_name ?? null,
    contactPerson: q.contactPerson ?? q.contact_person ?? null,
    billingAddress: q.billingAddress ?? q.billing_address ?? null,
    deliveryAddress: q.deliveryAddress ?? q.delivery_address ?? null,
    paymentTerms: q.paymentTerms ?? q.payment_terms ?? null,
    expectedDeliveryDate: q.expectedDeliveryDate ?? q.expected_delivery_date ?? null,
    salespersonName: q.salespersonName ?? q.salesperson_name ?? null,
    notes: q.notes ?? null,
    lines,
    subtotal: Number(q.subtotal) || 0,
    totalDiscount: Number(q.totalDiscount) || 0,
    gstTotal: Number(q.gstTotal) || 0,
    freight: Number(q.freight) || 0,
    grandTotal: Number(q.grandTotal) || 0,
    companyName,
    companyContact,
  };
}

export function salesOrderToPdfData(so: any, companyName: string, companyContact?: string | null): DocumentPdfData {
  const lines: DocumentPdfLine[] = (so.lines ?? []).map((l: any) => {
    const unitPrice = Number(l.unitPrice ?? l.unit_price) || 0;
    const quantity = Number(l.orderedQty ?? l.ordered_qty) || 0;
    const discountPct = Number(l.discountPct ?? l.discount_pct) || 0;
    const discountLabelText = discountPct > 0 ? `${discountPct}%` : "—";
    return {
      sku: l.sku ?? null,
      name: l.name || "Item",
      unit: l.unit || "unit",
      quantity,
      unitPrice,
      discountLabel: discountLabelText,
      gstRate: l.gstRate ?? l.gst_rate ?? null,
      amount: Number(l.lineTotal ?? l.line_total) || 0,
    };
  });
  return {
    kind: "sales_order",
    number: so.soNumber || so.so_number || "—",
    date: so.orderDate || so.order_date || "",
    validUntil: so.expectedDeliveryDate ?? so.expected_delivery_date ?? null,
    customerName: so.customerName ?? so.customer_name ?? null,
    contactPerson: so.contactPerson ?? so.contact_person ?? null,
    billingAddress: so.billingAddress ?? so.billing_address ?? null,
    deliveryAddress: so.deliveryAddress ?? so.delivery_address ?? null,
    paymentTerms: so.paymentTerms ?? so.payment_terms ?? null,
    expectedDeliveryDate: so.expectedDeliveryDate ?? so.expected_delivery_date ?? null,
    salespersonName: so.salespersonName ?? so.salesperson_name ?? null,
    notes: so.notes ?? null,
    lines,
    subtotal: Number(so.subtotal) || 0,
    totalDiscount: Number(so.totalDiscount) || 0,
    gstTotal: Number(so.gstTotal) || 0,
    freight: Number(so.freight) || 0,
    grandTotal: Number(so.grandTotal) || 0,
    companyName,
    companyContact,
  };
}


