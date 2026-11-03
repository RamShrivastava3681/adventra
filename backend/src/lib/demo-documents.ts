/**
 * Simulated marketplace documents for the Amazon Demo Simulator: the Amazon invoice
 * (issued by Amazon — not a WhizUnik tax invoice) and the settlement report. Every
 * page carries a "DEMO DOCUMENT" banner so they can never pass for real documents.
 */
import PDFDocument from "pdfkit";

const A4_WIDTH = 595.28;
const MARGIN = 40;
const WIDTH = A4_WIDTH - MARGIN * 2;

function rupees(n: number | null | undefined): string {
  return `Rs. ${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function render(title: string, banner: string[], draw: (doc: PDFKit.PDFDocument, y: number) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: MARGIN, info: { Title: title, Subject: banner.join(" · ") } });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      doc.rect(MARGIN, MARGIN, WIDTH, 26 + banner.length * 14).fill("#fef3c7");
      banner.forEach((line, i) => {
        doc
          .font("Helvetica-Bold")
          .fontSize(i === 0 ? 13 : 9)
          .fillColor("#92400e")
          .text(line, MARGIN, MARGIN + 10 + i * 15, { width: WIDTH, align: "center" });
      });
      // Diagonal watermark so a printed copy is unmistakable.
      doc.save();
      doc.rotate(-35, { origin: [A4_WIDTH / 2, 420] });
      doc.font("Helvetica-Bold").fontSize(64).fillColor("#f59e0b").opacity(0.12).text("DEMO", 0, 380, { width: A4_WIDTH, align: "center" });
      doc.restore();
      doc.opacity(1);

      draw(doc, MARGIN + 40 + banner.length * 14);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function rows(doc: PDFKit.PDFDocument, y: number, pairs: Array<[string, string]>): number {
  for (const [k, v] of pairs) {
    doc.font("Helvetica").fontSize(9).fillColor("#64748b").text(k, MARGIN, y, { width: 170 });
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#0f172a").text(v, MARGIN + 175, y, { width: WIDTH - 175 });
    y += 16;
  }
  return y;
}

export interface SimulatedInvoicePdfData {
  invoiceNumber: string;
  invoiceDate: string;
  amazonOrderId: string;
  salesOrderNumber: string | null;
  issuer: string;
  status: string;
  productName: string;
  sku: string | null;
  amazonSku: string;
  colour: string | null;
  size: string | null;
  quantity: number;
  sellingPrice: number;
  discount: number;
  taxRate: number;
  taxableAmount: number;
  taxAmount: number;
  total: number;
  deliveryAddress: string;
}

export function buildSimulatedInvoicePdf(d: SimulatedInvoicePdfData): Promise<Buffer> {
  return render(
    `Simulated Amazon Invoice ${d.invoiceNumber}`,
    ["SIMULATED AMAZON INVOICE", "DEMO DOCUMENT · NOT A TAX INVOICE · tenant MARKETPLACE-DEMO"],
    (doc, y) => {
      y = rows(doc, y, [
        ["Amazon invoice number", d.invoiceNumber],
        ["Invoice date", d.invoiceDate],
        ["Invoice issuer", d.issuer],
        ["Invoice status", d.status],
        ["Amazon order number", d.amazonOrderId],
        ["WhizUnik Sales Order", d.salesOrderNumber ?? "—"],
        ["Deliver to", d.deliveryAddress || "—"],
      ]);
      y += 10;
      const cols = [
        { h: "Product / variant", w: 190 },
        { h: "SKU", w: 85 },
        { h: "Qty", w: 35 },
        { h: "Price", w: 70 },
        { h: "Tax", w: 65 },
        { h: "Total", w: WIDTH - 445 },
      ];
      doc.rect(MARGIN, y, WIDTH, 18).fill("#1e293b");
      let x = MARGIN + 4;
      for (const c of cols) {
        doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#ffffff").text(c.h, x, y + 5, { width: c.w - 6 });
        x += c.w;
      }
      y += 22;
      const variant = [d.colour, d.size].filter(Boolean).join(" / ");
      const cells = [
        `${d.productName}${variant ? ` (${variant})` : ""}`,
        `${d.sku ?? "—"}\n${d.amazonSku}`,
        String(d.quantity),
        rupees(d.sellingPrice),
        `${d.taxRate}% · ${rupees(d.taxAmount)}`,
        rupees(d.total),
      ];
      x = MARGIN + 4;
      cells.forEach((v, i) => {
        doc.font("Helvetica").fontSize(8.5).fillColor("#0f172a").text(v, x, y, { width: cols[i].w - 6 });
        x += cols[i].w;
      });
      y += 34;
      doc.moveTo(MARGIN, y).lineTo(MARGIN + WIDTH, y).strokeColor("#e2e8f0").stroke();
      y += 8;
      rows(doc, y, [
        ["Gross (qty × price)", rupees(d.quantity * d.sellingPrice)],
        ["Discount", rupees(d.discount)],
        ["Taxable value", rupees(d.taxableAmount)],
        [`GST @ ${d.taxRate}% (included)`, rupees(d.taxAmount)],
        ["Invoice total", rupees(d.total)],
      ]);
      doc
        .font("Helvetica-Oblique")
        .fontSize(8)
        .fillColor("#64748b")
        .text(
          "Simulated for the WhizUnik marketplace demo. Amazon is the invoice issuer; WhizUnik raises no sales invoice for this order.",
          MARGIN,
          760,
          { width: WIDTH, align: "center" },
        );
    },
  );
}

export interface SimulatedSettlementPdfData {
  settlementReference: string;
  settlementPeriod: string | null;
  amazonOrderId: string;
  status: string;
  orderValue: number;
  commission: number;
  shippingFee: number;
  refundAmount: number;
  otherDeductions: number;
  netSettlement: number;
  bankReceipt: { amount: number; receivedOn: string; bankReference: string | null } | null;
  reconciliation: { reconciled: boolean; checks: Array<{ step: string; ok: boolean; detail: string }> } | null;
}

export function buildSimulatedSettlementPdf(d: SimulatedSettlementPdfData): Promise<Buffer> {
  return render(
    `Simulated Amazon Settlement ${d.settlementReference}`,
    ["SIMULATED AMAZON SETTLEMENT", "DEMO DOCUMENT · tenant MARKETPLACE-DEMO"],
    (doc, y) => {
      y = rows(doc, y, [
        ["Settlement reference", d.settlementReference],
        ["Settlement period", d.settlementPeriod ?? "—"],
        ["Amazon order", d.amazonOrderId],
        ["Status", d.status],
      ]);
      y += 8;
      y = rows(doc, y, [
        ["Order value", rupees(d.orderValue)],
        ["Amazon commission", `- ${rupees(d.commission)}`],
        ["Shipping fee", `- ${rupees(d.shippingFee)}`],
        ["Refund", `- ${rupees(d.refundAmount)}`],
        ["Other deductions", `- ${rupees(d.otherDeductions)}`],
        ["Net settlement", rupees(d.netSettlement)],
        [
          "Bank receipt",
          d.bankReceipt
            ? `${rupees(d.bankReceipt.amount)} on ${d.bankReceipt.receivedOn}${d.bankReceipt.bankReference ? ` (${d.bankReceipt.bankReference})` : ""}`
            : "Not received yet",
        ],
      ]);
      if (d.reconciliation) {
        y += 12;
        doc
          .font("Helvetica-Bold")
          .fontSize(10)
          .fillColor(d.reconciliation.reconciled ? "#15803d" : "#b91c1c")
          .text(`Reconciliation: ${d.reconciliation.reconciled ? "MATCHED" : "MISMATCH"}`, MARGIN, y);
        y += 18;
        for (const c of d.reconciliation.checks) {
          doc.font("Helvetica-Bold").fontSize(8.5).fillColor(c.ok ? "#15803d" : "#b91c1c").text(c.ok ? "OK" : "X", MARGIN, y, { width: 20 });
          doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#0f172a").text(c.step, MARGIN + 22, y, { width: 130 });
          // Helvetica has no ₹ glyph.
          doc.font("Helvetica").fontSize(8.5).fillColor("#334155").text(c.detail.replace(/₹/g, "Rs. "), MARGIN + 155, y, { width: WIDTH - 155 });
          y += 15;
        }
      }
    },
  );
}
