import PDFDocument from "pdfkit";
import { formatPaymentTerms } from "./payment-terms.js";

/**
 * document-pdf.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Clean, professional A4 PDF generator for customer-facing documents
 * (Sales Orders).
 *
 * Pricing rule: the ONLY price column shown is "Unit Price", which uses the
 * EFFECTIVE unit price — the maker's updated price when set, otherwise the
 * quoted price. Internal costs (catalogue unit cost, original/actual price)
 * never appear. Grand total is computed from those effective prices.
 */

export type PdfDocKind = "sales_order" | "purchase_order";

export interface DocumentPdfLine {
  sku: string | null;
  name: string;
  unit: string;
  /** Colour / size of a variant SKU — shown under the item name when set. */
  color?: string | null;
  size?: string | null;
  quantity: number;
  /** Effective unit price — the updated price when set, else the quoted price. */
  unitPrice: number;
  /** Pre-formatted discount label: "10%", "₹50.00" or "—". */
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
  if (!Number.isFinite(v)) return "₹0.00";
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "INR",
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
  const kindLabel =
    data.kind === "purchase_order" ? "PURCHASE ORDER" : "SALES ORDER";
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
    `    ${
      data.kind === "purchase_order" ? "PO date" : "Order date"
    }: ${fmtDate(data.date)}`,
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

  // BILL TO (or SUPPLIER on a purchase order)
  doc.font("Helvetica-Bold").fontSize(8).fillColor(INK.slate500);
  doc.text(data.kind === "purchase_order" ? "SUPPLIER" : "BILL TO", PAGE.margin, y, {
    width: colWidth,
  });
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
    const variantLine = variantLabel(l);
    const nameH = doc.heightOfString(l.name || "", { width: itemW - 4 });
    const variantH = variantLine ? 11 : 0;
    const skuH = skuLine ? 11 : 0;
    const rowH = Math.max(26, nameH + variantH + skuH + rowPad * 2 + 2);

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

    // Item name + colour/size variant label + SKU
    doc.font("Helvetica-Bold").fontSize(9).fillColor(INK.slate900);
    doc.text(l.name || "—", COLS.item.x, y + rowPad, { width: itemW - 4 });
    let subY = y + rowPad + nameH + 1;
    if (variantLine) {
      doc
        .font("Helvetica")
        .fontSize(7.5)
        .fillColor(INK.teal)
        .text(variantLine, COLS.item.x, subY, { width: itemW - 4 });
      subY += 11;
    }
    if (skuLine) {
      doc
        .font("Helvetica")
        .fontSize(7.5)
        .fillColor(INK.slate500)
        .text(skuLine, COLS.item.x, subY, { width: itemW - 4 });
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
        Title: `${docTypeLabel(data.kind)} ${data.number}`,
        Author: data.companyName || "Adventra",
        Subject: `${docTypeLabel(data.kind)} for ${data.customerName || "customer"}`,
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

/** Pre-formatted discount label for the PDF ("10%", "₹50.00", "—"). */
function discountLabel(l: any): string {
  const type = l.discountType ?? l.discount_type;
  const value = Number(l.discountValue ?? l.discount_value) || 0;
  if (!type || value <= 0) return "—";
  if (type === "pct") return `${value}%`;
  return money(value);
}

/** Compact variant label from a line's colour/size snapshots ("Black · 42"). */
function variantLabel(l: { color?: string | null; size?: string | null }): string {
  const parts = [l.color ?? "", l.size ?? ""]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean);
  return parts.join(" · ");
}

/** Human label for a document kind (used for PDF titles/metadata). */
function docTypeLabel(kind: PdfDocKind): string {
  if (kind === "purchase_order") return "Purchase Order";
  return "Sales Order";
}

export function purchaseOrderToPdfData(
  po: any,
  companyName: string,
  companyContact?: string | null,
): DocumentPdfData {
  const lines: DocumentPdfLine[] = (po.lines ?? []).map((l: any) => ({
    sku: l.sku ?? null,
    name: l.name || "Item",
    unit: l.unit || "unit",
    color: l.color ?? l.colour ?? null,
    size: l.size ?? null,
    quantity: Number(l.orderedQty ?? l.ordered_qty) || 0,
    unitPrice: Number(l.unitPrice ?? l.unit_price) || 0,
    discountLabel: "—",
    gstRate: l.gstRate ?? l.gst_rate ?? null,
    amount: Number(l.lineTotal ?? l.line_total) || 0,
  }));
  return {
    kind: "purchase_order",
    number: po.poNumber || po.po_number || "—",
    date: po.poDate || po.po_date || "",
    validUntil: po.expectedDeliveryDate ?? po.expected_delivery_date ?? null,
    customerName: po.supplierName ?? po.supplier_name ?? null,
    contactPerson: null,
    billingAddress: null,
    deliveryAddress: po.warehouse ?? null,
    paymentTerms: (formatPaymentTerms(po) || po.paymentTerms) ?? po.payment_terms ?? null,
    expectedDeliveryDate: po.expectedDeliveryDate ?? po.expected_delivery_date ?? null,
    salespersonName: po.buyerName ?? po.buyer_name ?? null,
    notes: po.notes ?? null,
    lines,
    subtotal: Number(po.subtotal) || 0,
    totalDiscount: 0,
    gstTotal: Number(po.gstTotal) || 0,
    freight: Number(po.freight) || 0,
    grandTotal: Number(po.grandTotal) || 0,
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
      color: l.color ?? l.colour ?? null,
      size: l.size ?? null,
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
    paymentTerms: (formatPaymentTerms(so) || so.paymentTerms) ?? so.payment_terms ?? null,
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

// ═════════════════════════════════════════════════════════════════════════════
// INVOICE PDF (attached to the NOA email sent to the buyer)
// ── White background · company name · debtor details, matching the on-screen
//    invoice print layout.
// ═════════════════════════════════════════════════════════════════════════════

export interface InvoicePdfLine {
  sku: string | null;
  name: string;
  unit: string;
  /** Colour / size of a variant SKU — shown under the item name when set. */
  color?: string | null;
  size?: string | null;
  quantity: number;
  unitPrice: number;
  discountPct: number | null;
  gstRate: number | null;
  amount: number;
}

export interface InvoicePdfData {
  number: string;
  date: string;
  dueDate: string | null;
  customerName: string | null;
  customerContact: string | null;
  billingAddress: string | null;
  deliveryAddress: string | null;
  partyAddress: string | null;
  partyEmail: string | null;
  partyPhone: string | null;
  poNumber: string | null;
  soNumber: string | null;
  lines: InvoicePdfLine[];
  subtotal: number;
  totalDiscount: number;
  gstTotal: number;
  freight: number;
  grandTotal: number;
  advanceDeducted: number;
  amountReceived: number;
  balanceOutstanding: number;
  notes: string | null;
  companyName: string;
  companyContact?: string | null;
}

const INV_INK = {
  slate900: "#0f172a",
  slate700: "#334155",
  slate600: "#475569",
  slate500: "#64748b",
  slate400: "#94a3b8",
  border: "#e2e8f0",
  headBg: "#f1f5f9",
  white: "#ffffff",
};

/** White-background invoice PDF (used as the NOA email attachment). */
export function buildInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: PAGE.margin,
      bufferPages: true,
      info: {
        Title: `Invoice ${data.number}`,
        Author: data.companyName || "Adventra",
        Subject: `Invoice ${data.number} for ${data.customerName || "customer"}`,
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Header: company block (left) + document label (right) ──
    doc.font("Helvetica-Bold").fontSize(18).fillColor(INV_INK.slate900);
    doc.text(truncate(data.companyName || "Adventra", 42), PAGE.margin, PAGE.margin, {
      width: CONTENT_WIDTH * 0.55,
    });
    let y = PAGE.margin + 22;
    if (data.companyContact) {
      doc.font("Helvetica").fontSize(9).fillColor(INV_INK.slate600);
      doc.text(truncate(data.companyContact, 70), PAGE.margin, y, {
        width: CONTENT_WIDTH * 0.55,
      });
      y += 12;
    }

    doc
      .font("Helvetica-Bold")
      .fontSize(20)
      .fillColor(INV_INK.slate900)
      .text("TAX INVOICE", PAGE.margin, PAGE.margin, { width: CONTENT_WIDTH, align: "right" });
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(INV_INK.slate500)
      .text(
        `No. ${data.number}`,
        PAGE.margin,
        PAGE.margin + 24,
        { width: CONTENT_WIDTH, align: "right" },
      );

    // Accent underline
    doc.save();
    doc.rect(PAGE.margin, y + 10, CONTENT_WIDTH, 2.5).fill("#0f766e");
    doc.restore();
    y += 26;

    // ── Meta row: dates + references (right) ──
    doc.font("Helvetica").fontSize(9).fillColor(INV_INK.slate600);
    const meta: Array<[string, string]> = [
      ["Date", fmtDate(data.date)],
      ["Due", data.dueDate ? fmtDate(data.dueDate) : "—"],
    ];
    if (data.soNumber) meta.push(["SO", data.soNumber]);
    if (data.poNumber) meta.push(["PO", data.poNumber]);
    for (const [k, v] of meta) {
      doc.text(`${k}: `, PAGE.margin + CONTENT_WIDTH - 210, y, { width: 48 });
      doc
        .font("Helvetica-Bold")
        .fillColor(INV_INK.slate900)
        .text(v, PAGE.margin + CONTENT_WIDTH - 162, y, { width: 162, align: "right" });
      doc.font("Helvetica").fillColor(INV_INK.slate600);
      y += 13;
    }
    y += 10;

    // ── Bill to (debtor details) ──
    const colW = CONTENT_WIDTH * 0.55;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(INV_INK.slate500);
    doc.text("BILL TO", PAGE.margin, y);
    y += 14;
    doc.font("Helvetica-Bold").fontSize(11).fillColor(INV_INK.slate900);
    doc.text(truncate(data.customerName || "—", 40), PAGE.margin, y, { width: colW });
    y += 15;
    doc.font("Helvetica").fontSize(9).fillColor(INV_INK.slate600);
    const debtorLines: Array<[string, string | null]> = [
      ["Billing", data.billingAddress],
      ["Delivery", data.deliveryAddress],
      ["Address", data.partyAddress],
      ["Contact", data.customerContact],
      ["Email", data.partyEmail],
      ["Phone", data.partyPhone],
    ];
    for (const [label, value] of debtorLines) {
      if (!value) continue;
      doc.font("Helvetica-Bold").fontSize(8).fillColor(INV_INK.slate500).text(label, PAGE.margin, y, {
        width: 62,
      });
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor(INV_INK.slate700)
        .text(truncate(value, 60), PAGE.margin + 66, y, { width: colW - 66 });
      y += 13;
    }
    y += 12;

    // ── Line items table ──
    const LCOLS = {
      item: { x: PAGE.margin, w: 210 },
      qty: { x: PAGE.margin + 210, w: 52 },
      rate: { x: PAGE.margin + 262, w: 84 },
      amount: { x: PAGE.margin + 346, w: 152 },
    };

    doc.font("Helvetica-Bold").fontSize(8).fillColor(INV_INK.slate500).text("LINE ITEMS", PAGE.margin, y);
    y += 15;

    const drawInvoiceTableHeader = (ty: number) => {
      doc.save();
      doc.rect(PAGE.margin, ty, CONTENT_WIDTH, 20).fill(INV_INK.headBg);
      doc.font("Helvetica-Bold").fontSize(8).fillColor(INV_INK.slate700);
      doc.text("DESCRIPTION", LCOLS.item.x, ty + 6, { width: LCOLS.item.w });
      doc.text("QTY", LCOLS.qty.x, ty + 6, { width: LCOLS.qty.w, align: "right" });
      doc.text("RATE", LCOLS.rate.x, ty + 6, { width: LCOLS.rate.w, align: "right" });
      doc.text("AMOUNT", LCOLS.amount.x, ty + 6, { width: LCOLS.amount.w, align: "right" });
      doc.restore();
    };
    drawInvoiceTableHeader(y);
    y += 20;

    const rows = data.lines.length
      ? data.lines
      : [{ name: data.notes || "Goods/services supplied", sku: null, unit: "unit", quantity: 1, unitPrice: data.subtotal, discountPct: null, gstRate: null, amount: data.subtotal }];
    for (const l of rows) {
      const itemW = LCOLS.item.w;
      const variantLine = variantLabel(l);
      const nameH = doc.heightOfString(l.name || "Item", { width: itemW - 4 });
      const variantH = variantLine ? 11 : 0;
      const skuH = l.sku ? 11 : 0;
      const rowH = Math.max(24, nameH + variantH + skuH + 10);
      if (y + rowH > PAGE.height - PAGE.margin) {
        doc.addPage();
        drawInvoiceTableHeader(PAGE.margin);
        y = PAGE.margin + 20 + 4;
      }
      doc.font("Helvetica-Bold").fontSize(9).fillColor(INV_INK.slate900);
      doc.text(l.name || "Item", LCOLS.item.x, y + 5, { width: itemW - 4 });
      let subY = y + 5 + nameH + 1;
      if (variantLine) {
        doc.font("Helvetica").fontSize(7.5).fillColor("#0f766e");
        doc.text(variantLine, LCOLS.item.x, subY, { width: itemW - 4 });
        subY += 11;
      }
      if (l.sku) {
        doc.font("Helvetica").fontSize(7.5).fillColor(INV_INK.slate500);
        doc.text(l.sku, LCOLS.item.x, subY, { width: itemW - 4 });
      }
      const cell = (value: string, col: { x: number; w: number }, bold = false) => {
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor(INV_INK.slate700);
        doc.text(value, col.x, y + rowH / 2 - 5, { width: col.w, align: "right" });
      };
      cell(String(Number(l.quantity) || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ","), LCOLS.qty);
      cell(money(l.unitPrice), LCOLS.rate);
      cell(money(l.amount), LCOLS.amount, true);
      doc
        .moveTo(PAGE.margin, y + rowH)
        .lineTo(PAGE.margin + CONTENT_WIDTH, y + rowH)
        .strokeColor(INV_INK.border)
        .lineWidth(0.5)
        .stroke();
      y += rowH;
    }
    y += 8;

    // ── Totals ──
    if (y > PAGE.height - 160) {
      doc.addPage();
      y = PAGE.margin;
    }
    const boxW = 200;
    const boxX = PAGE.width - PAGE.margin - boxW;
    const totalRows: Array<[string, string, boolean]> = [
      ["Subtotal", money(data.subtotal), false],
    ];
    if (data.totalDiscount > 0) totalRows.push(["Total discount", `-${money(data.totalDiscount)}`, false]);
    if (data.gstTotal > 0) totalRows.push(["GST", money(data.gstTotal), false]);
    if (data.freight > 0) totalRows.push(["Freight / charges", money(data.freight), false]);
    if (data.advanceDeducted > 0) totalRows.push(["Less: advance received", `-${money(data.advanceDeducted)}`, false]);
    let ry = y;
    for (const [label, value] of totalRows) {
      doc.font("Helvetica").fontSize(9).fillColor(INV_INK.slate600);
      doc.text(label, boxX, ry, { width: boxW * 0.55 });
      doc.font("Helvetica").fontSize(9).fillColor(INV_INK.slate900);
      doc.text(value, boxX + boxW * 0.45, ry, { width: boxW * 0.55, align: "right" });
      ry += 14;
    }
    doc.save();
    doc.rect(boxX - 8, ry - 2, boxW + 16, 26).fill(INV_INK.slate900);
    doc.font("Helvetica-Bold").fontSize(10).fillColor(INV_INK.white);
    doc.text("TOTAL", boxX, ry + 4, { width: boxW * 0.55 });
    doc.text(money(data.grandTotal), boxX + boxW * 0.45, ry + 4, {
      width: boxW * 0.55,
      align: "right",
    });
    doc.restore();
    ry += 30;
    if (data.amountReceived > 0 || data.balanceOutstanding > 0) {
      doc.font("Helvetica").fontSize(9).fillColor(INV_INK.slate600);
      doc.text("Amount received", boxX, ry, { width: boxW * 0.55 });
      doc.text(money(data.amountReceived), boxX + boxW * 0.45, ry, {
        width: boxW * 0.55,
        align: "right",
      });
      ry += 14;
      doc.font("Helvetica-Bold").fontSize(9).fillColor(INV_INK.slate900);
      doc.text("Balance outstanding", boxX, ry, { width: boxW * 0.55 });
      doc.text(money(data.balanceOutstanding), boxX + boxW * 0.45, ry, {
        width: boxW * 0.55,
        align: "right",
      });
    }

    // ── Notes ──
    let ny = Math.max(ry + 24, PAGE.margin + 24);
    if (data.notes) {
      if (ny > PAGE.height - 120) {
        doc.addPage();
        ny = PAGE.margin;
      }
      doc.font("Helvetica-Bold").fontSize(8).fillColor(INV_INK.slate500).text("NOTES", PAGE.margin, ny);
      const h = doc.heightOfString(data.notes, { width: CONTENT_WIDTH });
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor(INV_INK.slate600)
        .text(data.notes, PAGE.margin, ny + 13, { width: CONTENT_WIDTH });
      ny += 13 + h + 14;
    }

    // ── Signature ──
    const sigY = Math.max(ny, PAGE.height - 130);
    const lineW = 190;
    doc
      .moveTo(PAGE.width - PAGE.margin - lineW, sigY)
      .lineTo(PAGE.width - PAGE.margin, sigY)
      .strokeColor(INV_INK.border)
      .lineWidth(1)
      .stroke();
    doc.font("Helvetica").fontSize(8).fillColor(INV_INK.slate500);
    doc.text("Authorised signatory", PAGE.width - PAGE.margin - lineW, sigY + 6, {
      width: lineW,
      align: "center",
    });
    doc.font("Helvetica-Bold").fontSize(9).fillColor(INV_INK.slate700);
    doc.text(data.companyName || "Adventra", PAGE.width - PAGE.margin - lineW, sigY + 20, {
      width: lineW,
      align: "center",
    });

    // ── Footer (every page) ──
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.save();
      doc.font("Helvetica").fontSize(7.5).fillColor(INV_INK.slate400);
      doc.text(
        "This is a computer-generated invoice from " + (data.companyName || "Adventra") + ".",
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

    doc.end();
  });
}

/** Map a sales invoice + its debtor onto the invoice PDF data shape. */
export function invoiceToPdfData(
  inv: any,
  debtor: any,
  companyName: string,
  companyContact?: string | null,
): InvoicePdfData {
  const lines: InvoicePdfLine[] = (inv.lines ?? inv.lineItems ?? []).map((l: any) => ({
    sku: l.sku ?? null,
    name: l.name ?? l.description ?? "Item",
    unit: l.unit ?? "unit",
    color: l.color ?? l.colour ?? null,
    size: l.size ?? null,
    quantity: Number(l.quantity ?? l.qty ?? 0),
    unitPrice: Number(l.unitPrice ?? l.unit_price ?? 0),
    discountPct: l.discountPct ?? l.discount_pct ?? null,
    gstRate: l.gstRate ?? l.gst_rate ?? null,
    amount: Number(l.lineTotal ?? l.line_total ?? 0),
  }));
  const grandTotal = Number(inv.grandTotal ?? inv.grand_total ?? 0);
  const advanceDeducted = Number(inv.advanceDeducted ?? inv.advance_deducted ?? 0);
  const net = Number(inv.amount ?? inv.net_receivable ?? Math.max(0, grandTotal - advanceDeducted));
  const amountReceived = Number(inv.amountReceived ?? inv.amount_received ?? 0);
  const subtotal = Number(inv.subtotalGoods ?? inv.subtotal_goods ?? inv.subtotal ?? 0);
  const partyAddress = [
    debtor?.billingAddress,
    debtor?.shippingAddress,
    debtor?.city,
    debtor?.country,
  ]
    .filter(Boolean)
    .join(", ");
  return {
    number: inv.invoiceNumber || inv.invoice_number || "—",
    date: inv.issueDate || inv.issue_date || "",
    dueDate: inv.dueDate || inv.due_date || null,
    customerName: debtor?.name ?? null,
    customerContact: inv.customerContact ?? inv.customer_contact ?? null,
    billingAddress: inv.billingAddress ?? inv.billing_address ?? null,
    deliveryAddress: inv.deliveryAddress ?? inv.delivery_address ?? null,
    partyAddress: partyAddress || null,
    partyEmail: debtor?.contactEmail ?? debtor?.contact_email ?? null,
    partyPhone: debtor?.contactPhone ?? debtor?.contact_phone ?? null,
    poNumber: inv.poNumber ?? inv.po_number ?? null,
    soNumber: inv.goodsSalesOrderNumber ?? inv.goods_sales_order_number ?? null,
    lines,
    subtotal,
    totalDiscount: Number(inv.totalDiscount ?? inv.total_discount ?? 0),
    gstTotal: Number(inv.gstTotal ?? inv.gst_total ?? inv.taxAmount ?? 0),
    freight: Number(inv.freight ?? 0),
    grandTotal,
    advanceDeducted,
    amountReceived,
    balanceOutstanding: Math.max(0, net - amountReceived),
    notes: inv.notes ?? null,
    companyName,
    companyContact,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// TALLY-STYLE SALES ORDER PDF (bordered grid, classic GST-invoice look)
// ── Cream title bar · seller + ship-to + bill-to blocks · meta grid ·
//    item table (SNO/Particulars/Color/Code/Size/MRP/Selling/Qty/Offer/Total) ·
//    amount-in-words · remarks + bank details · declaration · signatory.
// ═════════════════════════════════════════════════════════════════════════════

export interface TallySOLine {
  sno: number;
  particulars: string;
  color: string;
  productCode: string;
  size: string;
  mrp: number | null;
  sellingPrice: number;
  quantity: number;
  offerPrice: number;
  amount: number;
}

export interface TallySOSeller {
  name: string;
  address: string;
  gstin: string;
  stateName: string;
  stateCode: string;
  email: string;
}

export interface TallySOBank {
  holder: string;
  bank: string;
  acNo: string;
  ifsc: string;
  branch: string;
}

export interface SalesOrderTallyData {
  number: string;
  /** Already formatted, e.g. "5/Sep/2026". */
  date: string;
  deliveryNote: string | null;
  paymentTerms: string | null;
  referenceNo: string | null;
  buyerOrderNo: string | null;
  dispatchDocNo: string | null;
  dispatchedThrough: string | null;
  seller: TallySOSeller;
  shipAddress: string;
  /** De-duplicated "Name, address" line for the shipping block. */
  shipText: string;
  shipGstin: string | null;
  shipPan: string | null;
  billName: string;
  billAddress: string;
  /** De-duplicated "Name, address" line for the BILL TO block. */
  billText: string;
  billGstin: string | null;
  billPan: string | null;
  lines: TallySOLine[];
  totalQty: number;
  grandTotal: number;
  amountWords: string;
  bank: TallySOBank | null;
  /** Free-text bank block fallback when structured bank rows aren't set. */
  bankRaw: string | null;
  /** Remarks printed above the bank-details block (null = blank). */
  remarks: string | null;
  /** Declaration lines printed under remarks (empty = omitted, never defaulted). */
  declaration: string[];
  jurisdiction: string;
  logoImage: Buffer | null;
}

const TALLY = {
  cream: "#FFF3D4",
  headGray: "#D9D9D9",
  altRow: "#FFFBEB",
  white: "#FFFFFF",
  ink: "#000000",
};

function r2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Compact international-grouped number like the reference print (24,990 / 161,367). */
function tallyNum(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "0";
  return Number.isInteger(v)
    ? v.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "2026-09-05" → "5/Sep/2026" (the Tally-style stamp). */
function fmtTallyDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return String(iso);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${dt.getDate()}/${mon[dt.getMonth()]}/${dt.getFullYear()}`;
}

// ── Amount in words (Indian numbering) ──────────────────────────────────────
const WORD_ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const WORD_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function wordsTwoDigits(n: number): string {
  if (n < 20) return WORD_ONES[n];
  return `${WORD_TENS[Math.floor(n / 10)]}${n % 10 ? `-${WORD_ONES[n % 10]}` : ""}`;
}

function wordsThreeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return `${h ? `${WORD_ONES[h]} Hundred${rest ? " " : ""}` : ""}${rest ? wordsTwoDigits(rest) : ""}`;
}

function intWordsIN(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${wordsThreeDigits(crore)} Crore`);
  if (lakh) parts.push(`${wordsTwoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${wordsTwoDigits(thousand)} Thousand`);
  if (rest) parts.push(wordsThreeDigits(rest));
  return parts.join(" ");
}

/** 161367 → "Rupees One Lakh Sixty-One Thousand Three Hundred Sixty-Seven Only". */
export function amountInWordsINR(value: number | null | undefined): string {
  const v = Math.round((Number(value) || 0) * 100) / 100;
  const rupees = Math.floor(Math.abs(v));
  const paise = Math.round((Math.abs(v) - rupees) * 100);
  let s = `Rupees ${intWordsIN(rupees)}`;
  if (paise > 0) s += ` and Paise ${wordsTwoDigits(paise)}`;
  return `${s} Only`;
}

/** Map a sales order (+ seller/bank inputs) onto the Tally print shape.
 *  Nothing is defaulted: missing values render blank on the PDF. */
export function salesOrderToTallyData(
  so: any,
  opts?: {
    seller?: Partial<TallySOSeller> | null;
    bank?: Partial<TallySOBank> | null;
    bankRaw?: string | null;
    /** Raw declaration text (newline-separated) from settings — never hardcoded. */
    declarationRaw?: string | null;
    logoImage?: Buffer | null;
  },
): SalesOrderTallyData {
  const s = opts?.seller ?? {};
  const lines: TallySOLine[] = (so.lines ?? []).map((l: any, i: number) => {
    const sellingPrice = Number(l.unitPrice ?? l.unit_price ?? 0) || 0;
    const quantity = Number(l.orderedQty ?? l.ordered_qty ?? 0) || 0;
    const discountPct = Number(l.discountPct ?? l.discount_pct ?? 0) || 0;
    const offerPrice = r2(sellingPrice * (1 - Math.min(100, Math.max(0, discountPct)) / 100));
    return {
      sno: i + 1,
      particulars: l.name || "Item",
      color: l.color ?? l.colour ?? "",
      productCode: l.productCode ?? l.product_code ?? l.model ?? l.sku ?? "",
      size: l.size ? String(l.size) : "",
      mrp: l.mrp ?? null,
      sellingPrice,
      quantity,
      offerPrice,
      amount: r2(Number(l.lineTotal ?? l.line_total ?? quantity * offerPrice) || 0),
    };
  });
  const totalQty = Number(so.totalQty ?? so.total_qty ?? lines.reduce((x, l) => x + l.quantity, 0)) || 0;
  const grandTotal = r2(Number(so.grandTotal ?? so.grand_total ?? lines.reduce((x, l) => x + l.amount, 0)) || 0);
  const b = opts?.bank ?? {};
  const bank: TallySOBank | null =
    b.holder || b.bank || b.acNo || b.ifsc || b.branch
      ? {
          holder: b.holder || "",
          bank: b.bank || "",
          acNo: b.acNo || "",
          ifsc: b.ifsc || "",
          branch: b.branch || "",
        }
      : null;
  const stateName = s.stateName || "";
  const declaration = String(opts?.declarationRaw ?? "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  const billName = so.customerName ?? so.customer_name ?? "";
  const billAddress = so.billingAddress ?? so.billing_address ?? "";
  const shipAddress = so.deliveryAddress ?? so.delivery_address ?? "";
  // Avoid "Name, Name, address" when a stored address already starts with the buyer name.
  const startsWithName = (addr: string) =>
    !!billName && addr.toLowerCase().startsWith(billName.toLowerCase());
  const shipText = startsWithName(shipAddress)
    ? shipAddress
    : [billName, shipAddress].filter(Boolean).join(", ");
  const billText = startsWithName(billAddress)
    ? billAddress
    : [billName, billAddress].filter(Boolean).join(", ");
  return {
    number: so.soNumber || so.so_number || "—",
    date: fmtTallyDate(so.orderDate || so.order_date || ""),
    deliveryNote: so.deliveryNote ?? so.delivery_note ?? null,
    paymentTerms: formatPaymentTerms(so) || so.paymentTerms || so.payment_terms || null,
    referenceNo: so.referenceNo ?? so.reference_no ?? null,
    buyerOrderNo: so.buyerOrderNo ?? so.buyer_order_no ?? null,
    dispatchDocNo: so.dispatchDocNo ?? so.dispatch_doc_no ?? null,
    dispatchedThrough: so.dispatchedThrough ?? so.dispatched_through ?? null,
    seller: {
      name: s.name || "",
      address: s.address || "",
      gstin: s.gstin || "",
      stateName,
      stateCode: s.stateCode || "",
      email: s.email || "",
    },
    shipAddress: so.deliveryAddress ?? so.delivery_address ?? "",
    shipText,
    shipGstin: so.shipGstin ?? so.ship_gstin ?? null,
    shipPan: so.shipPan ?? so.ship_pan ?? null,
    billName,
    billAddress,
    billText,
    billGstin: so.billGstin ?? so.bill_gstin ?? null,
    billPan: so.billPan ?? so.bill_pan ?? null,
    lines,
    totalQty,
    grandTotal,
    amountWords: amountInWordsINR(grandTotal),
    bank,
    bankRaw: opts?.bankRaw ?? null,
    remarks: (so.remarks ?? null) as string | null,
    declaration,
    jurisdiction: stateName.toUpperCase(),
    logoImage: opts?.logoImage ?? null,
  };
}

/** Render the Tally-style sales-order PDF. */
export function buildSalesOrderTallyPdf(data: SalesOrderTallyData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const M = 24;
      const PW = 595.28;
      const PH = 841.89;
      const CW = PW - M * 2;
      const BOT = PH - M;
      const doc = new PDFDocument({ size: "A4", margins: { top: M, bottom: M, left: M, right: M } });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const F = "Helvetica";
      const FB = "Helvetica-Bold";
      const PAD = 3;
      let y = M;

      const need = (h: number) => {
        if (y + h > BOT) {
          doc.addPage();
          y = M;
        }
      };

      /** Stroked cell with optional fill + text. Returns nothing; advances nothing. */
      const cell = (
        x: number, yy: number, w: number, h: number,
        text: string,
        o?: { font?: string; size?: number; align?: "left" | "center" | "right"; fill?: string },
      ) => {
        if (o?.fill) doc.rect(x, yy, w, h).fill(o.fill);
        doc.rect(x, yy, w, h).strokeColor(TALLY.ink).lineWidth(0.5).stroke();
        if (text) {
          doc
            .font(o?.font ?? F)
            .fontSize(o?.size ?? 7.5)
            .fillColor(TALLY.ink)
            .text(text, x + PAD, yy + 2, {
              width: Math.max(1, w - PAD * 2),
              align: o?.align ?? "left",
            });
        }
      };

      const wrapH = (text: string, w: number, size: number, font?: string): number => {
        if (!text) return 0;
        doc.font(font ?? F).fontSize(size);
        return doc.heightOfString(text, { width: Math.max(1, w - PAD * 2) });
      };

      // ── Title bar ──────────────────────────────────────────────────────────
      cell(M, y, CW, 18, "SALES ORDER", { font: FB, size: 11, align: "center", fill: TALLY.cream });
      y += 18;

      // ── Header block: seller/buyer (left) + meta grid + logo (right) ───────
      const LW = Math.round(CW * 0.605);
      const RW = CW - LW;
      const y0 = y;
      const leftDivs: number[] = [];
      let ly = y0;

      const leftRow = (text: string, o?: { font?: string; size?: number; h?: number; fill?: string }) => {
        const size = o?.size ?? 7.5;
        const h = o?.h ?? Math.max(11, Math.ceil(wrapH(text, LW, size, o?.font) + 5));
        cell(M, ly, LW, h, text, { font: o?.font, size, fill: o?.fill });
        ly += h;
        leftDivs.push(ly);
      };

      const sel = data.seller;
      leftRow(sel.name, { font: FB, size: 8.5, h: 13 });
      if (sel.address) leftRow(sel.address, { h: Math.max(22, Math.ceil(wrapH(sel.address, LW, 7.5) + 5)) });
      leftRow(`GSTIN/UIN : ${sel.gstin}`);
      leftRow(`State Name : ${sel.stateName}, Code : ${sel.stateCode}`);
      leftRow(`E-Mail : ${sel.email}`);
      leftRow("Shipping Address :", { size: 7 });
      if (data.shipText) leftRow(data.shipText, { h: Math.max(22, Math.ceil(wrapH(data.shipText, LW, 7.5) + 5)) });
      leftRow(`GSTIN/UIN : ${data.shipGstin ?? ""}`);
      leftRow(`PAN/IT No : ${data.shipPan ?? ""}`);
      leftRow("BILL TO -", { size: 7 });
      leftRow(data.billText || "—", {
        h: Math.max(22, Math.ceil(wrapH(data.billText || "—", LW, 7.5) + 5)),
      });
      leftRow(`GSTIN/UIN : ${data.billGstin ?? ""}`);
      leftRow(`PAN/IT No : ${data.billPan ?? ""}`);
      const leftH = ly - y0;

      // Right meta grid
      const rightDivs: number[] = [];
      let ry = y0;
      const metaRow = (label: string, value: string | null, h = 13) => {
        const lw = Math.round(RW * 0.52);
        cell(M + LW, ry, lw, h, label, { size: 6.5, align: "center" });
        cell(M + LW + lw, ry, RW - lw, h, value ?? "", { size: 7.5, align: "center" });
        ry += h;
        rightDivs.push(ry);
      };
      metaRow("No.", data.number);
      metaRow("Dated", data.date);
      metaRow("Delivery Note", data.deliveryNote);
      metaRow("Mode/Terms of Payment", data.paymentTerms);
      metaRow("Reference No. & Date.", data.referenceNo);
      metaRow("Buyer's Order No.", data.buyerOrderNo);
      metaRow("Dispatch Doc No.", data.dispatchDocNo);
      metaRow("Dispatched through", data.dispatchedThrough);
      const rightRowsH = ry - y0;

      // Logo cell fills the remaining right-column height (min 64).
      // White background: the Adventra logo asset is a dark mark on
      // transparency, so it needs a light cell to stay visible.
      const logoH = Math.max(64, leftH - rightRowsH);
      const lx = M + LW;
      doc.rect(lx, ry, RW, logoH).fill(TALLY.white);
      doc.rect(lx, ry, RW, logoH).strokeColor(TALLY.ink).lineWidth(0.5).stroke();
      if (data.logoImage) {
        try {
          doc.image(data.logoImage, lx + 6, ry + 6, {
            fit: [RW - 12, logoH - 12],
            align: "center",
            valign: "center",
          });
        } catch {
          doc.font(FB).fontSize(10).fillColor(TALLY.ink).text(sel.name || " ", lx + 6, ry + logoH / 2 - 8, { width: RW - 12, align: "center" });
        }
      } else {
        doc.font(FB).fontSize(10).fillColor(TALLY.ink).text(sel.name || " ", lx + 6, ry + logoH / 2 - 8, { width: RW - 12, align: "center" });
      }
      ry += logoH;
      rightDivs.push(ry);

      const blockH = Math.max(leftH, ry - y0);
      // Outer frame + column divider (row dividers already drawn by cell()).
      doc.rect(M, y0, CW, blockH).strokeColor(TALLY.ink).lineWidth(0.75).stroke();
      doc.moveTo(M + LW, y0).lineTo(M + LW, y0 + blockH).strokeColor(TALLY.ink).lineWidth(0.5).stroke();
      y = y0 + blockH;

      // ── Item table ─────────────────────────────────────────────────────────
      const C = { sno: 30, color: 56, code: 56, size: 34, mrp: 52, sell: 56, qty: 42, offer: 56, amt: 66 };
      const partW = CW - (C.sno + C.color + C.code + C.size + C.mrp + C.sell + C.qty + C.offer + C.amt);
      const colX = (key: keyof typeof C | "part"): number => {
        let x = M;
        const order: Array<keyof typeof C | "part"> = ["sno", "part", "color", "code", "size", "mrp", "sell", "qty", "offer", "amt"];
        const widths: Record<string, number> = { ...C, part: partW };
        for (const k of order) {
          if (k === key) return x;
          x += widths[k];
        }
        return x;
      };
      const colW = (key: keyof typeof C | "part"): number =>
        key === "part" ? partW : C[key as keyof typeof C];

      const HEAD_H = 26;
      const drawTableHead = () => {
        need(HEAD_H);
        const heads: Array<[keyof typeof C | "part", string]> = [
          ["sno", "SNO"], ["part", "Particulars"], ["color", "Product Color"],
          ["code", "Product Cod"], ["size", "Size"], ["mrp", "MRP"],
          ["sell", "Selling Price"], ["qty", "Quantity"], ["offer", "Offer Price"],
          ["amt", "Total Amount"],
        ];
        for (const [k, t] of heads) {
          cell(colX(k), y, colW(k), HEAD_H, t, { font: FB, size: 7, align: "center", fill: TALLY.headGray });
        }
        y += HEAD_H;
      };

      drawTableHead();
      data.lines.forEach((l, idx) => {
        const rowH = Math.max(
          14,
          Math.ceil(wrapH(l.particulars, partW, 7.5) + 6),
        );
        if (y + rowH > BOT) {
          doc.addPage();
          y = M;
          drawTableHead();
        }
        const fill = idx % 2 === 1 ? TALLY.altRow : TALLY.white;
        type TallyAlign = "left" | "center" | "right";
        const row: Array<[keyof typeof C | "part", string, TallyAlign]> = [
          ["sno", String(l.sno), "center"],
          ["part", l.particulars, "left"],
          ["color", l.color, "center"],
          ["code", l.productCode, "center"],
          ["size", l.size, "center"],
          ["mrp", l.mrp != null ? tallyNum(l.mrp) : "", "right"],
          ["sell", tallyNum(l.sellingPrice), "right"],
          ["qty", tallyNum(l.quantity), "right"],
          ["offer", tallyNum(l.offerPrice), "right"],
          ["amt", tallyNum(l.amount), "right"],
        ];
        for (const [k, t, a] of row) {
          cell(colX(k), y, colW(k), rowH, t, { size: 7.5, align: a ?? "left", fill });
        }
        y += rowH;
      });

      // Totals row: "Total" spans sno..sell, qty sum, offer blank, amount.
      const TOT_H = 15;
      need(TOT_H);
      const spanW = C.sno + partW + C.color + C.code + C.size + C.mrp + C.sell;
      cell(M, y, spanW, TOT_H, "Total", { font: FB, size: 8, align: "center", fill: TALLY.headGray });
      cell(M + spanW, y, C.qty, TOT_H, tallyNum(data.totalQty), { font: FB, size: 8, align: "right", fill: TALLY.headGray });
      cell(M + spanW + C.qty, y, C.offer, TOT_H, "", { fill: TALLY.headGray });
      cell(M + spanW + C.qty + C.offer, y, C.amt, TOT_H, tallyNum(data.grandTotal), { font: FB, size: 8, align: "right", fill: TALLY.headGray });
      y += TOT_H;

      // ── Amount in words + E&OE ─────────────────────────────────────────────
      const wordsW = Math.round(CW * 0.65);
      const wordsH = Math.max(32, Math.ceil(wrapH(data.amountWords, wordsW, 7.5) + 20));
      need(wordsH);
      cell(M, y, wordsW, wordsH, "", {});
      doc.font(FB).fontSize(7).fillColor(TALLY.ink).text("Amount Chargeable (in words) :", M + PAD, y + 2, { width: wordsW - PAD * 2 });
      doc.font(F).fontSize(7.5).fillColor(TALLY.ink).text(data.amountWords, M + PAD, y + 13, { width: wordsW - PAD * 2 });
      cell(M + wordsW, y, CW - wordsW, wordsH, "E. & O.E", { font: FB, size: 7.5, align: "center" });
      y += wordsH;

      // ── Remarks/Declaration (left) + Bank details (right) ──────────────────
      const bankW = Math.round(CW * 0.45);
      const remW = CW - bankW;
      const remarkText = data.remarks ? `Remarks: ${data.remarks}` : "";
      const declText = (data.declaration ?? []).join("\n");
      const leftTextH =
        (remarkText ? wrapH(remarkText, remW, 7) + 6 : 0) +
        (declText ? wrapH(`Declaration:\n${declText}`, remW, 7) : 0);
      const bankRowsH = data.bank ? 12 + 5 * 12 : data.bankRaw ? Math.max(36, Math.ceil(wrapH(data.bankRaw, bankW, 7) + 20)) : 24;
      const rbH = Math.max(24, Math.ceil(leftTextH + 12), bankRowsH + 4);
      need(rbH);
      const ry0 = y;
      cell(M, y, remW, rbH, "", {});
      let ty = y + 2;
      if (remarkText) {
        doc.font(FB).fontSize(7).fillColor(TALLY.ink).text(remarkText, M + PAD, ty, { width: remW - PAD * 2 });
        ty += Math.ceil(wrapH(remarkText, remW, 7)) + 5;
      }
      if (declText) {
        doc.font(FB).fontSize(7).fillColor(TALLY.ink).text("Declaration:", M + PAD, ty, { width: remW - PAD * 2 });
        ty += 10;
        doc.font(F).fontSize(7).fillColor(TALLY.ink).text(declText, M + PAD, ty, { width: remW - PAD * 2 });
      }
      // Bank block
      cell(M + remW, y, bankW, rbH, "", {});
      let by = y;
      cell(M + remW, by, bankW, 12, "Company's Bank Details:", { font: FB, size: 7, align: "center" });
      by += 12;
      if (data.bank) {
        const rows: Array<[string, string]> = [
          ["A/c Holder's Name:", data.bank.holder],
          ["Bank Name:", data.bank.bank],
          ["A/c No.:", data.bank.acNo],
          ["IFSC Code:", data.bank.ifsc],
          ["Branch :", data.bank.branch],
        ];
        for (const [k, v] of rows) {
          const klw = Math.round(bankW * 0.38);
          cell(M + remW, by, klw, 12, k, { font: FB, size: 7, align: "center" });
          cell(M + remW + klw, by, bankW - klw, 12, v, { size: 7.5, align: "center" });
          by += 12;
        }
      } else if (data.bankRaw) {
        doc.font(F).fontSize(7).fillColor(TALLY.ink).text(data.bankRaw, M + remW + PAD, by + 2, { width: bankW - PAD * 2 });
      }
      y = ry0 + rbH;

      // ── Sign-off lines ─────────────────────────────────────────────────────
      const signRow = (text: string, o?: { font?: string; size?: number; h?: number }) => {
        const h = o?.h ?? 12;
        need(h);
        cell(M, y, CW, h, text, { font: o?.font ?? F, size: o?.size ?? 7.5, align: "center" });
        y += h;
      };
      if (data.seller.name) signRow(`ONLY ${data.seller.name}`, { font: FB, h: 13 });
      signRow("Authorised Signatory");
      if (data.jurisdiction) signRow(`SUBJECT TO ${data.jurisdiction} JURISDICTION`);
      signRow("This is a Computer Generated Sales Order");

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}



