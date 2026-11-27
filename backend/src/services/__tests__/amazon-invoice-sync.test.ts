import { describe, it, expect } from "vitest";
import { gzipSync } from "zlib";
import {
  parseAmazonReportTable,
  normalizeInvoiceReportRows,
} from "../../lib/amazon-report-parser.js";
import { amazonSpApi } from "../amazon-spapi.service.js";

describe("Amazon invoice report parser & GZIP downloader", () => {
  it("parses GST B2C CSV and groups multi-line orders sharing an invoice number", () => {
    const csv = [
      'Seller Gstin,Invoice Number,Invoice Date,Transaction Type,Order Id,Shipment Id,Sku,Hsn/sac,Quantity,Invoice Amount,Tax Exclusive Gross,Total Tax Amount,Cgst Tax,Sgst Tax,Igst Tax,Ship To State',
      '29ABCDE1234F1Z5,IN-DEL4-1001,15-11-2026,Shipment,404-1111111-2222222,SHP-1,"GLV-BLK-M",6216,1,590.00,500.00,90.00,45.00,45.00,0.00,Karnataka',
      '29ABCDE1234F1Z5,IN-DEL4-1001,15-11-2026,Shipment,404-1111111-2222222,SHP-1,"GLV-RED-L",6216,2,1180.00,1000.00,180.00,90.00,90.00,0.00,Karnataka',
    ].join("\n");

    const rows = parseAmazonReportTable(csv);
    expect(rows).toHaveLength(2);

    const invoices = normalizeInvoiceReportRows(rows, "GET_GST_MTR_B2C_CUSTOM");
    expect(invoices).toHaveLength(1);
    const inv = invoices[0];
    expect(inv.amazonOrderId).toBe("404-1111111-2222222");
    expect(inv.invoiceNumber).toBe("IN-DEL4-1001");
    expect(inv.invoiceIssueDate).toBe("2026-11-15");
    expect(inv.quantity).toBe(3);
    expect(inv.taxableAmount).toBe(1500);
    expect(inv.taxAmount).toBe(270);
    expect(inv.cgstAmount).toBe(135);
    expect(inv.sgstAmount).toBe(135);
    expect(inv.grandTotal).toBe(1770);
    expect(inv.taxRate).toBe(18);
    expect(inv.isB2B).toBe(false);
    expect(inv.sku).toBe("GLV-BLK-M, GLV-RED-L");
  });

  it("parses GST B2B CSV with Customer Bill To Gstid and IRN", () => {
    const csv = [
      "Seller Gstin,Customer Bill To Gstid,Invoice Number,Invoice Date,Transaction Type,Order Id,Sku,Quantity,Invoice Amount,Tax Exclusive Gross,Igst Tax,Irn Number,Ship To State",
      "29ABCDE1234F1Z5,07AAACW1234B1Z2,IN-B2B-9001,2026-11-20,Shipment,404-9999999-1111111,JK-NVY-XL,5,5900,5000,900,irn-hash-12345,Delhi",
    ].join("\n");

    const invoices = normalizeInvoiceReportRows(
      parseAmazonReportTable(csv),
      "GET_GST_MTR_B2B_CUSTOM",
    );
    expect(invoices).toHaveLength(1);
    expect(invoices[0].isB2B).toBe(true);
    expect(invoices[0].buyerGstin).toBe("07AAACW1234B1Z2");
    expect(invoices[0].igstAmount).toBe(900);
    expect(invoices[0].irnNumber).toBe("irn-hash-12345");
    expect(invoices[0].placeOfSupply).toBe("Delhi");
  });

  it("parses TSV GET_FLAT_FILE_ORDER_REPORT_DATA_INVOICING format", () => {
    const tsv = [
      "order-id\tinvoice-number\tsku\tquantity-purchased\titem-price\titem-tax\tbuyer-tax-registration-id",
      "404-5555555-6666666\tINV-TSV-77\tCAP-GRY\t1\t400\t72\t",
    ].join("\n");

    const invoices = normalizeInvoiceReportRows(
      parseAmazonReportTable(tsv),
      "GET_FLAT_FILE_ORDER_REPORT_DATA_INVOICING",
    );
    expect(invoices).toHaveLength(1);
    expect(invoices[0].invoiceNumber).toBe("INV-TSV-77");
    expect(invoices[0].taxableAmount).toBe(400);
    expect(invoices[0].taxAmount).toBe(72);
    expect(invoices[0].grandTotal).toBe(472);
  });

  it("decompresses GZIP report contents cleanly", async () => {
    const sample = "Order Id,Invoice Number\n404-1,INV-1\n";
    const gz = gzipSync(Buffer.from(sample, "utf8"));
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(gz, { status: 200 })) as typeof fetch;
    try {
      const text = await amazonSpApi.getReportDocumentContents({
        url: "https://example.com/report.gz",
        compressionAlgorithm: "GZIP",
      });
      expect(text).toBe(sample);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
