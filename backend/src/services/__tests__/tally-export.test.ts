import { describe, it, expect } from "vitest";
import { esc, tallyDate, envelope, message } from "../tally/xml.js";
import {
  serializeCustomerMaster,
  serializeSupplierMaster,
  serializeStockItemMaster,
  serializeUnitMaster,
  serializeLedgerMaster,
} from "../tally/serializers/masterSerializer.js";
import { serializeSalesVoucher } from "../tally/serializers/salesSerializer.js";
import { serializePurchaseVoucher } from "../tally/serializers/purchaseSerializer.js";
import { serializeReceiptVoucher } from "../tally/serializers/receiptSerializer.js";
import { serializePaymentVoucher } from "../tally/serializers/paymentSerializer.js";
import { serializeCreditNoteVoucher } from "../tally/serializers/creditNoteSerializer.js";
import { serializeDebitNoteVoucher } from "../tally/serializers/debitNoteSerializer.js";
import { calculateSha256, verifyChecksum, generateManifestCsv, generateValidationErrorReportCsv } from "../tally/manifestService.js";
import { parseTallyXml } from "../tally/reverseImport.js";
import {
  VoucherBuilder,
  gstHeadNames,
  splitAcrossHeads,
  invoiceLineAmount,
  detectLineMode,
  splitLine,
  unitFor,
  normState,
} from "../tally/engine.js";
import { isUnionTerritory, type TallyConfig, SUGGESTED_MAPPING } from "../../models/tally.js";

const mockConfig: TallyConfig = {
  pk: "TALLY_CONFIG#test",
  sk: "TALLY_CONFIG#test",
  entityType: "TallyConfig",
  clientId: "test-client",
  companyName: "Whizunik",
  homeState: "Uttar Pradesh",
  gstin: "09AABCU9603R1ZM",
  gstRegistrationType: "Regular",
  godownName: "Main Warehouse",
  defaultUnit: "pics",
  stockGroup: "Primary",
  batchName: "Primary Batch",
  gstApplicableFrom: "2026-04-01",
  mappings: {
    ...SUGGESTED_MAPPING,
    salesLedger: "Sales Account",
    purchaseLedger: "Purchase",
    bankLedger: "Bank - Demo",
    roundOffLedger: "Round Off",
    igstOutputLedger: "IGST Output",
    cgstOutputLedger: "CGST Output",
    sgstOutputLedger: "SGST Output",
    utgstOutputLedger: "UTGST Output",
    igstInputLedger: "IGST Input",
    cgstInputLedger: "CGST Input",
    sgstInputLedger: "SGST Input",
    utgstInputLedger: "UTGST Input",
  },
  allowDuplicateReExport: false,
  updatedAt: "2026-10-01T00:00:00.000Z",
  updatedBy: "tester@whizunik.com",
};

describe("Tally XML Primitives & Escaping", () => {
  it("escapes special characters correctly", () => {
    expect(esc("A & B <C> \"D's\"")).toBe("A &amp; B &lt;C&gt; &quot;D&apos;s&quot;");
  });

  it("converts dates to Tally YYYYMMDD format", () => {
    expect(tallyDate("2026-10-01")).toBe("20261001");
    expect(tallyDate("2026-11-18T10:30:00.000Z")).toBe("20261118");
  });
});

describe("Master Serializers", () => {
  it("exports customer master with required Tally structure", () => {
    const debtor = {
      id: "cust-001",
      name: "Sunrise Traders & Co.",
      billingAddress: "Shop 12, Commercial Market",
      city: "Noida",
      state: "Uttar Pradesh",
      postalCode: "201301",
      gstin: "09AAACS1429B1ZT",
    };
    const xml = serializeCustomerMaster(debtor, mockConfig);
    expect(xml).toContain('<LEDGER NAME="Sunrise Traders &amp; Co." ACTION="Create">');
    expect(xml).toContain("<NAME>Sunrise Traders &amp; Co.</NAME>");
    expect(xml).toContain("<PARENT>Sundry Debtors</PARENT>");
    expect(xml).toContain("<ISBILLWISEON>Yes</ISBILLWISEON>");
    expect(xml).toContain("<OPENINGBALANCE>0.00</OPENINGBALANCE>");
    expect(xml).toContain("<PARTYGSTIN>09AAACS1429B1ZT</PARTYGSTIN>");
    expect(xml).toContain("<STATE>Uttar Pradesh</STATE>");
  });

  it("exports supplier master with required Tally structure", () => {
    const supplier = {
      id: "supp-001",
      companyName: "DEVAGOND OUTDOOR PRIVATE LIMITED",
      addressLine: "Sector 62",
      city: "Noida",
      state: "Uttar Pradesh",
      postalCode: "201309",
      gstin: "09AAECD9988C1ZR",
    };
    const xml = serializeSupplierMaster(supplier, mockConfig);
    expect(xml).toContain('<LEDGER NAME="DEVAGOND OUTDOOR PRIVATE LIMITED" ACTION="Create">');
    expect(xml).toContain("<PARENT>Sundry Creditors</PARENT>");
    expect(xml).toContain("<ISBILLWISEON>Yes</ISBILLWISEON>");
    expect(xml).toContain("<PARTYGSTIN>09AAECD9988C1ZR</PARTYGSTIN>");
  });

  it("exports SKU master with GST rates, HSN and batch allocations", () => {
    const product = {
      id: "prod-001",
      name: "Demo Latex Gloves Blue",
      sku: "GLV-BLU-01",
      unitOfMeasure: "pair",
      unitPrice: 500,
      gstRate: 18,
      hsnCode: "40151900",
      category: "Medical",
    };
    const openingByProduct = new Map([["prod-001", { qty: 100, value: 50000 }]]);
    const xml = serializeStockItemMaster(product, { config: mockConfig, openingByProduct }, unitFor);

    expect(xml).toContain('<STOCKITEM NAME="Demo Latex Gloves Blue" ACTION="Alter">');
    expect(xml).toContain("<BASEUNITS>pair</BASEUNITS>");
    expect(xml).toContain("<OPENINGBALANCE>100.00 pair</OPENINGBALANCE>");
    expect(xml).toContain("<OPENINGVALUE>-50000.00</OPENINGVALUE>");
    expect(xml).toContain("<OPENINGRATE>500.0000/pair</OPENINGRATE>");
    expect(xml).toContain("<HSNCODE>40151900</HSNCODE>");
    // Check GST rates breakdown
    expect(xml).toContain("<GSTRATEDUTYHEAD>CGST</GSTRATEDUTYHEAD>");
    expect(xml).toContain("<GSTRATE>9</GSTRATE>");
    expect(xml).toContain("<GSTRATEDUTYHEAD>SGST/UTGST</GSTRATEDUTYHEAD>");
    expect(xml).toContain("<GSTRATE>9</GSTRATE>");
    expect(xml).toContain("<GSTRATEDUTYHEAD>IGST</GSTRATEDUTYHEAD>");
    expect(xml).toContain("<GSTRATE>18</GSTRATE>");
    expect(xml).toContain("<GODOWNNAME>Main Warehouse</GODOWNNAME>");
  });

  it("exports Unit master with decimal places", () => {
    const xml = serializeUnitMaster("nos", "Numbers", 0);
    expect(xml).toContain('<UNIT NAME="nos" ACTION="Create">');
    expect(xml).toContain("<NAME>nos</NAME>");
    expect(xml).toContain("<ORIGINALNAME>Numbers</ORIGINALNAME>");
    expect(xml).toContain("<DECIMALPLACES>0</DECIMALPLACES>");
  });

  it("exports Account Ledger master", () => {
    const xml = serializeLedgerMaster("CGST Output", "Duties & Taxes", "GST", "CGST");
    expect(xml).toContain('<LEDGER NAME="CGST Output" ACTION="Create">');
    expect(xml).toContain("<PARENT>Duties &amp; Taxes</PARENT>");
    expect(xml).toContain("<TAXTYPE>GST</TAXTYPE>");
    expect(xml).toContain("<GSTDUTYHEAD>CGST</GSTDUTYHEAD>");
  });
});

const sharedCtx = {
  config: mockConfig,
  debtorsById: new Map([
    ["d1", { id: "d1", name: "Ram Shrivastava3", state: "Delhi", gstin: "07AABCR1234D1Z5", billingAddress: "Noida, UP" }],
    ["d2", { id: "d2", name: "Sunrise Traders", state: "Uttar Pradesh", gstin: "09AAACS1429B1ZT" }],
    ["d3", { id: "d3", name: "Metro Retail", state: "Chandigarh", gstin: "04AAACM5555C1Z1" }],
  ]),
  suppliersById: new Map([
    ["s1", { id: "s1", companyName: "DEVAGOND OUTDOOR PRIVATE LIMITED", state: "Karnataka", gstin: "29AAECD9988C1ZR" }],
  ]),
  productsById: new Map([
    ["p1", { id: "p1", name: "Men Running Shoes Lightweight Navy Black 36", hsnCode: "64041900", unitOfMeasure: "pics", gstRate: 5 }],
    ["p2", { id: "p2", name: "Trekking Bag Black MT1000 Unisex", hsnCode: "4202", unitOfMeasure: "pics", gstRate: 18 }],
  ]),
  partyStateForInvoice: (inv: any) => inv.placeOfSupply || "Delhi",
  partyStateForPurchase: (pi: any) => pi.placeOfSupply || "Karnataka",
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

describe("Voucher Serializers", () => {

  it("exports Sales Invoice with IGST for inter-state customer", () => {
    const invoice = {
      id: "inv-001",
      invoiceNumber: "ADV-26/27-SI-005",
      issueDate: "2026-10-01",
      debtorId: "d1",
      customerName: "Ram Shrivastava3",
      placeOfSupply: "Delhi", // Inter-state from UP
      grandTotal: 9535.0,
      lines: [
        {
          productId: "p1",
          name: "Men Running Shoes Lightweight Navy Black 36",
          quantity: 4,
          unitPrice: 2383.75, // inclusive
          gstRate: 5,
          unit: "pics",
        },
      ],
    };

    const res = serializeSalesVoucher(invoice, sharedCtx);
    expect(res.errors).toHaveLength(0);
    expect(res.xml).toContain('<VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">');
    expect(res.xml).toContain("<REFERENCE>ADV-26/27-SI-005</REFERENCE>");
    expect(res.xml).toContain("<PARTYLEDGERNAME>Ram Shrivastava3</PARTYLEDGERNAME>");
    expect(res.xml).toContain("<LEDGERNAME>Ram Shrivastava3</LEDGERNAME>");
    expect(res.xml).toContain("<AMOUNT>-9535.00</AMOUNT>");
    expect(res.xml).toContain("<LEDGERNAME>IGST Output</LEDGERNAME>");
    expect(res.xml).toContain("<AMOUNT>454.05</AMOUNT>");
    expect(res.xml).toContain("<STOCKITEMNAME>Men Running Shoes Lightweight Navy Black 36</STOCKITEMNAME>");
    expect(res.xml).toContain("<AMOUNT>9080.95</AMOUNT>");
    expect(res.xml).toContain("<LEDGERNAME>Sales Account</LEDGERNAME>");
    expect(res.xml).toContain("<GSTRATEDUTYHEAD>IGST</GSTRATEDUTYHEAD>");
  });

  it("exports Sales Invoice with CGST + SGST for intra-state customer", () => {
    const ctxIntra = {
      ...sharedCtx,
      partyStateForInvoice: () => "Uttar Pradesh", // Same state as company
    };
    const invoice = {
      id: "inv-002",
      invoiceNumber: "ADV-TAX-CGST-001",
      issueDate: "2026-10-01",
      debtorId: "d2",
      customerName: "Sunrise Traders",
      placeOfSupply: "Uttar Pradesh",
      grandTotal: 2383.75,
      lines: [
        {
          productId: "p1",
          name: "Men Running Shoes Lightweight Navy Black 36",
          quantity: 1,
          unitPrice: 2383.75,
          gstRate: 5,
          unit: "pics",
        },
      ],
    };

    const res = serializeSalesVoucher(invoice, ctxIntra);
    expect(res.errors).toHaveLength(0);
    expect(res.xml).toContain("<LEDGERNAME>CGST Output</LEDGERNAME>");
    expect(res.xml).toContain("<AMOUNT>56.76</AMOUNT>");
    expect(res.xml).toContain("<LEDGERNAME>SGST Output</LEDGERNAME>");
    expect(res.xml).toContain("<AMOUNT>56.75</AMOUNT>");
    expect(res.xml).toContain("<GSTRATEDUTYHEAD>CGST</GSTRATEDUTYHEAD>");
    expect(res.xml).toContain("<GSTRATEDUTYHEAD>SGST/UTGST</GSTRATEDUTYHEAD>");
  });

  it("exports Sales Invoice with CGST + UTGST for Union Territory", () => {
    const utConfig: TallyConfig = {
      ...mockConfig,
      homeState: "Chandigarh", // Union Territory
    };
    const ctxUT = {
      ...sharedCtx,
      config: utConfig,
      partyStateForInvoice: () => "Chandigarh",
    };
    const invoice = {
      id: "inv-003",
      invoiceNumber: "ADV-TAX-UTGST-001",
      issueDate: "2026-10-01",
      debtorId: "d3",
      customerName: "Metro Retail",
      placeOfSupply: "Chandigarh",
      grandTotal: 2383.75,
      lines: [
        {
          productId: "p1",
          name: "Men Running Shoes Lightweight Navy Black 36",
          quantity: 1,
          unitPrice: 2383.75,
          gstRate: 5,
          unit: "pics",
        },
      ],
    };

    const res = serializeSalesVoucher(invoice, ctxUT);
    expect(res.errors).toHaveLength(0);
    expect(res.xml).toContain("<LEDGERNAME>CGST Output</LEDGERNAME>");
    expect(res.xml).toContain("<LEDGERNAME>UTGST Output</LEDGERNAME>");
  });

  it("exports Purchase Invoice with multiple items and item invoice view", () => {
    const pi = {
      id: "pi-001",
      invoiceNumber: "PI-test1",
      issueDate: "2026-10-01",
      vendorId: "s1",
      supplierName: "DEVAGOND OUTDOOR PRIVATE LIMITED",
      subtotal: 219750.0,
      gstTotal: 39555.0,
      grandTotal: 259305.0, // 150 * 1465 + 18% GST (39555)
      lines: [
        {
          productId: "p2",
          name: "Trekking Bag Black MT1000 Unisex",
          invoiceQty: 150,
          unitPrice: 1465.0, // exclusive
          gstRate: 18,
          unit: "pics",
        },
      ],
    };

    const res = serializePurchaseVoucher(pi, sharedCtx);
    expect(res.errors).toHaveLength(0);
    expect(res.xml).toContain('<VOUCHER VCHTYPE="Purchase" ACTION="Create" OBJVIEW="Invoice Voucher View">');
    expect(res.xml).toContain("<VCHENTRYMODE>Item Invoice</VCHENTRYMODE>");
    expect(res.xml).toContain("<REFERENCE>PI-test1</REFERENCE>");
    expect(res.xml).toContain("<LEDGERNAME>DEVAGOND OUTDOOR PRIVATE LIMITED</LEDGERNAME>");
    expect(res.xml).toContain("<AMOUNT>259305.00</AMOUNT>");
    expect(res.xml).toContain("<LEDGERNAME>IGST Input</LEDGERNAME>");
    expect(res.xml).toContain("<AMOUNT>-39555.00</AMOUNT>"); // 150*1465*0.18
  });

  it("exports Receipt voucher with invoice bill allocation (Agst Ref)", () => {
    const receipt = {
      id: "rct-001",
      invoiceId: "inv-001",
      amount: 9535.0,
      receiptDate: "2026-10-01",
      utr: "UTR-SALES-001",
    };
    const invoicesById = new Map([
      ["inv-001", { id: "inv-001", invoiceNumber: "ADV-DEMO-SI-001", debtorId: "d1" }],
    ]);

    const res = serializeReceiptVoucher(
      receipt,
      { config: mockConfig, debtorsById: sharedCtx.debtorsById, VoucherBuilder },
      invoicesById,
    );
    expect(res.errors).toHaveLength(0);
    expect(res.xml).toContain('<VOUCHER VCHTYPE="Receipt" ACTION="Create" OBJVIEW="Accounting Voucher View">');
    expect(res.xml).toContain("<LEDGERNAME>Bank - Demo</LEDGERNAME>");
    expect(res.xml).toContain("<AMOUNT>9535.00</AMOUNT>");
    expect(res.xml).toContain("<LEDGERNAME>Ram Shrivastava3</LEDGERNAME>");
    expect(res.xml).toContain("<AMOUNT>-9535.00</AMOUNT>");
    expect(res.xml).toContain("<BILLTYPE>Agst Ref</BILLTYPE>");
    expect(res.xml).toContain("<NAME>ADV-DEMO-SI-001</NAME>");
  });

  it("exports Payment voucher against purchase invoice", () => {
    const pi = {
      id: "pi-001",
      invoiceNumber: "PI-BATCH-001",
      paidDate: "2026-10-01",
      vendorId: "s1",
      supplierName: "DEVAGOND OUTDOOR PRIVATE LIMITED",
      amountPaid: 17287.0,
      grandTotal: 17287.0,
      utr: "UTR-DEMO-001",
    };

    const res = serializePaymentVoucher(pi, {
      config: mockConfig,
      suppliersById: sharedCtx.suppliersById,
      VoucherBuilder,
    });
    expect(res.errors).toHaveLength(0);
    expect(res.xml).toContain('<VOUCHER VCHTYPE="Payment" ACTION="Create" OBJVIEW="Accounting Voucher View">');
    expect(res.xml).toContain("<LEDGERNAME>DEVAGOND OUTDOOR PRIVATE LIMITED</LEDGERNAME>");
    expect(res.xml).toContain("<AMOUNT>-17287.00</AMOUNT>");
    expect(res.xml).toContain("<BILLTYPE>Agst Ref</BILLTYPE>");
    expect(res.xml).toContain("<LEDGERNAME>Bank - Demo</LEDGERNAME>");
    expect(res.xml).toContain("<AMOUNT>17287.00</AMOUNT>");
  });

  it("exports Credit Note voucher linked to original invoice", () => {
    const note = {
      id: "cn-001",
      kind: "credit",
      noteNumber: "CN-ADV-DEMO-SI-003",
      noteDate: "2026-10-01",
      invoiceId: "inv-001",
      amount: 2383.75,
      taxAmount: 113.51,
      subtotal: 2270.24,
      appliedInvoiceNumber: "ADV-DEMO-SI-003",
      reason: "Customer return",
      lineItems: [
        {
          productId: "p1",
          name: "Men Running Shoes Lightweight Navy Black 36",
          quantity: 1,
          unitPrice: 2383.75,
          gstRate: 5,
          unit: "pics",
        },
      ],
    };
    const invoicesById = new Map([
      ["inv-001", { id: "inv-001", invoiceNumber: "ADV-DEMO-SI-003", debtorId: "d1" }],
    ]);

    const res = serializeCreditNoteVoucher(note, sharedCtx, invoicesById);
    expect(res.errors).toHaveLength(0);
    expect(res.xml).toContain('<VOUCHER VCHTYPE="Credit Note" ACTION="Create" OBJVIEW="Invoice Voucher View">');
    expect(res.xml).toContain("<REFERENCE>CN-ADV-DEMO-SI-003</REFERENCE>");
    expect(res.xml).toContain("<BILLTYPE>Agst Ref</BILLTYPE>");
    expect(res.xml).toContain("<NAME>ADV-DEMO-SI-003</NAME>");
  });

  it("exports Debit Note voucher linked to original purchase invoice", () => {
    const note = {
      id: "dn-001",
      kind: "debit",
      noteNumber: "DN-PI-BATCH-001",
      noteDate: "2026-10-01",
      purchaseInvoiceId: "pi-001",
      supplierId: "s1",
      amount: 17287.0,
      taxAmount: 2637.0,
      subtotal: 14650.0,
      appliedInvoiceNumber: "PI-BATCH-001",
      reason: "Purchase return",
      lineItems: [
        {
          productId: "p2",
          name: "Trekking Bag Black MT1000 Unisex",
          quantity: 10,
          unitPrice: 1465.0,
          gstRate: 18,
          unit: "pics",
        },
      ],
    };
    const purchasesById = new Map([
      ["pi-001", { id: "pi-001", invoiceNumber: "PI-BATCH-001", vendorId: "s1" }],
    ]);

    const res = serializeDebitNoteVoucher(note, sharedCtx, purchasesById);
    expect(res.errors).toHaveLength(0);
    expect(res.xml).toContain('<VOUCHER VCHTYPE="Debit Note" ACTION="Create" OBJVIEW="Invoice Voucher View">');
    expect(res.xml).toContain("<REFERENCE>DN-PI-BATCH-001</REFERENCE>");
    expect(res.xml).toContain("<BILLTYPE>Agst Ref</BILLTYPE>");
    expect(res.xml).toContain("<NAME>PI-BATCH-001</NAME>");
  });
});

describe("Batch Manifest & Checksum", () => {
  it("calculates SHA-256 and verifies checksum accurately", () => {
    const content = '<?xml version="1.0" encoding="UTF-8"?><ENVELOPE>Test</ENVELOPE>';
    const sha = calculateSha256(content);
    expect(sha).toHaveLength(64);
    expect(verifyChecksum(content, sha)).toBe(true);
    expect(verifyChecksum(content + "change", sha)).toBe(false);
  });

  it("generates CSV manifest and validation error report", () => {
    const batch = {
      id: "batch-123",
      batchNumber: "TALLY-SALES-0001",
      exportType: "sales" as const,
      reportName: "Vouchers",
      companyName: "Whizunik",
      generatedAt: "2026-10-01T12:00:00.000Z",
      generatedBy: "admin@whizunik.com",
      status: "Generated" as const,
      fileName: "Tally_sales_2026-10-01.xml",
      xmlSha256: "abc123456789",
      xmlBytes: 4096,
      recordCount: 1,
      validCount: 1,
      errorCount: 0,
      warningCount: 0,
      totals: { taxable: 9000, gst: 500, grandTotal: 9500 },
      records: [
        {
          sourceId: "inv-1",
          docNumber: "ADV-001",
          date: "2026-10-01",
          party: "Sunrise Traders",
          voucherType: "Sales",
          amount: 9500,
          contentHash: "hash123",
          status: "Ready" as const,
          errors: [],
          warnings: [],
        },
      ],
      pk: "",
      sk: "",
      gsi1pk: "",
      gsi1sk: "",
      entityType: "TallyBatch" as const,
      clientId: "client-1",
      xmlPath: null,
      downloadedAt: null,
      downloadedBy: null,
      importedAt: null,
      importedBy: null,
      importResult: null,
    };

    const csv = generateManifestCsv(batch);
    expect(csv).toContain("TALLY-SALES-0001");
    expect(csv).toContain("Whizunik");
    expect(csv).toContain("ADV-001");
    expect(csv).toContain("9500.00");

    const errReport = generateValidationErrorReportCsv(batch.records);
    expect(errReport).toContain("ADV-001");
  });
});

describe("Batch XML Packaging (Multiple records in one XML)", () => {
  it("packages multiple records with individual TALLYMESSAGE envelopes", () => {
    const messages = [
      message('<LEDGER NAME="A" ACTION="Create"><NAME>A</NAME></LEDGER>'),
      message('<LEDGER NAME="B" ACTION="Create"><NAME>B</NAME></LEDGER>'),
    ];

    const xml = envelope({
      reportName: "All Masters",
      companyName: "Whizunik",
      messages,
    });

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("<REPORTNAME>All Masters</REPORTNAME>");
    expect(xml).toContain("<SVCURRENTCOMPANY>Whizunik</SVCURRENTCOMPANY>");
    expect(xml).toContain('<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="A" ACTION="Create">');
    expect(xml).toContain('<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="B" ACTION="Create">');
  });
});

describe("Validation and Edge Cases", () => {
  it("flags missing customer ledger / debtor", () => {
    const inv = {
      id: "inv-bad",
      invoiceNumber: "ADV-ERR-001",
      issueDate: "2026-10-01",
      debtorId: "nonexistent",
      customerName: null,
      grandTotal: 1000,
      lines: [{ productId: "p1", name: "Item", quantity: 1, unitPrice: 1000, gstRate: 0 }],
    };
    const res = serializeSalesVoucher(inv, {
      ...sharedCtx,
      debtorsById: new Map(),
    });
    expect(res.errors).toContain("Customer ledger name is missing (debtor not found).");
  });

  it("flags unbalanced vouchers when totals do not reconcile", () => {
    const inv = {
      id: "inv-unbalanced",
      invoiceNumber: "ADV-UNBAL-001",
      issueDate: "2026-10-01",
      debtorId: "d1",
      customerName: "Ram Shrivastava3",
      grandTotal: 50000, // Deliberately wrong total
      subtotalGoods: 1000,
      gstTotal: 50,
      lines: [{ productId: "p1", name: "Item", quantity: 1, unitPrice: 1050, gstRate: 5 }],
    };
    const res = serializeSalesVoucher(inv, sharedCtx);
    expect(res.errors.some((e) => e.includes("totals do not reconcile"))).toBe(true);
  });
});

describe("Reverse Import XML Parser", () => {
  it("parses Tally XML vouchers into staged records", () => {
    const tallyXml = `
      <ENVELOPE>
        <BODY>
          <IMPORTDATA>
            <REQUESTDATA>
              <TALLYMESSAGE>
                <VOUCHER VCHTYPE="Sales">
                  <VOUCHERNUMBER>ADV-26/27-SI-005</VOUCHERNUMBER>
                  <DATE>20261001</DATE>
                  <PARTYLEDGERNAME>Ram Shrivastava3</PARTYLEDGERNAME>
                  <LEDGERENTRIES.LIST>
                    <LEDGERNAME>Ram Shrivastava3</LEDGERNAME>
                    <AMOUNT>-9535.00</AMOUNT>
                    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
                  </LEDGERENTRIES.LIST>
                  <IRN>64charhexstring1234567890abcdef1234567890abcdef1234567890abcdef1234</IRN>
                  <EWAYBILLNO>123456789012</EWAYBILLNO>
                </VOUCHER>
              </TALLYMESSAGE>
            </REQUESTDATA>
          </IMPORTDATA>
        </BODY>
      </ENVELOPE>
    `;

    const staged = parseTallyXml(tallyXml);
    expect(staged).toHaveLength(1);
    expect(staged[0].voucherNumber).toBe("ADV-26/27-SI-005");
    expect(staged[0].amount).toBe(9535);
    expect(staged[0].irn).toBe("64charhexstring1234567890abcdef1234567890abcdef1234567890abcdef1234");
    expect(staged[0].ewayBillNo).toBe("123456789012");
  });
});
