import * as Tally from "../src/models/tally.js";
import * as Debtor from "../src/models/debtor.js";
import * as Supplier from "../src/models/supplier.js";
import * as Product from "../src/models/product.js";
import * as Invoice from "../src/models/invoice.js";
import * as PurchaseInvoice from "../src/models/purchase-invoice.js";
import * as PaymentReceipt from "../src/models/payment-receipt.js";
import * as CreditDebitNote from "../src/models/credit-debit-note.js";
import { validateRecords } from "../src/services/tally/engine.js";

const CLIENT_ID = "tally-demo";
const UPDATED_BY = "seed-tally-export-demo";
const SHOULD_VERIFY = process.env.VERIFY === "1";

const DEMO = {
  customerName: "Tally Demo Customer",
  customerGstin: "09AAACR5055K1Z5",
  supplierName: "Tally Demo Supplier",
  supplierGstin: "27AABCT1332L1ZN",
  productName: "Tally Demo Cotton T-Shirt",
  sku: "TD-TSHIRT-001",
  hsnCode: "61091000",
  gstRate: 18,
  unit: "piece",
  salesInvoiceNumber: "TD-SI-001",
  purchaseInvoiceNumber: "TD-PI-001",
  creditNoteNumber: "TD-CN-001",
  debitNoteNumber: "TD-DN-001",
  receiptUtr: "TDUTR0001",
};

const today = new Date().toISOString().slice(0, 10);
const dateOffset = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

function nonEmpty(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function pick(current: unknown, fallback: string): string {
  return nonEmpty(current) || fallback;
}

async function ensureConfig(): Promise<Tally.TallyConfig> {
  const existing = await Tally.getConfig("shared");
  const mappingKeys = Object.keys(Tally.EMPTY_MAPPING) as (keyof Tally.TallyLedgerMapping)[];
  const mappings = {} as Tally.TallyLedgerMapping;
  for (const key of mappingKeys) {
    mappings[key] = pick(existing?.mappings?.[key], Tally.SUGGESTED_MAPPING[key] || Tally.EMPTY_MAPPING[key]);
  }

  const config = await Tally.saveConfig(
    "shared",
    {
      companyName: pick(existing?.companyName, "Adventra Demo Pvt Ltd"),
      homeState: pick(existing?.homeState, "Uttar Pradesh"),
      gstin: pick(existing?.gstin, "09AABCU9603R1ZM"),
      gstRegistrationType: pick(existing?.gstRegistrationType, "Regular"),
      godownName: pick(existing?.godownName, "Main Warehouse"),
      defaultUnit: pick(existing?.defaultUnit, "pics"),
      stockGroup: pick(existing?.stockGroup, "Primary"),
      batchName: pick(existing?.batchName, "Primary Batch"),
      gstApplicableFrom: pick(existing?.gstApplicableFrom, "2026-04-01"),
      mappings,
      allowDuplicateReExport: existing?.allowDuplicateReExport ?? false,
    },
    UPDATED_BY,
  );

  console.log(`Tally config ready: ${config.companyName} | ${config.homeState} | godown ${config.godownName}`);
  return config;
}

async function ensureCustomer() {
  const existing = (await Debtor.list()).find((d) => d.name === DEMO.customerName);
  const billingAddresses = [
    {
      label: "Primary",
      address: "12, MG Road",
      city: "Lucknow",
      state: "Uttar Pradesh",
      postalCode: "226001",
    },
  ];

  if (existing) {
    await Debtor.update(existing.id, {
      gstin: DEMO.customerGstin,
      state: "Uttar Pradesh",
      stateCode: "09",
      city: "Lucknow",
      country: "India",
      postalCode: "226001",
      billingAddresses,
      billingAddress: "12, MG Road, Lucknow, Uttar Pradesh, 226001",
      shippingAddresses: billingAddresses,
      shippingAddress: "12, MG Road, Lucknow, Uttar Pradesh, 226001",
      customerType: "Retailer",
      paymentTermsDays: 30,
      paymentTermsType: "credit",
    });
    console.log(`Customer reused: ${existing.name}`);
    return existing;
  }

  const created = await Debtor.create({
    name: DEMO.customerName,
    gstin: DEMO.customerGstin,
    state: "Uttar Pradesh",
    stateCode: "09",
    city: "Lucknow",
    country: "India",
    postalCode: "226001",
    billingAddresses,
    shippingAddresses: billingAddresses,
    customerType: "Retailer",
    paymentTermsDays: 30,
    paymentTermsType: "credit",
    contactName: "Demo Contact",
    contactEmail: "demo.customer@example.com",
    contactPhone: "9876543210",
    notes: "Seed data for Tally XML export validation.",
  });
  console.log(`Customer created: ${created.name}`);
  return created;
}

async function ensureSupplier() {
  const existing = (await Supplier.list()).find((s) => s.companyName === DEMO.supplierName);

  if (existing) {
    await Supplier.update(existing.id, {
      gstin: DEMO.supplierGstin,
      stateCode: "27",
      addressLine: "45, Linking Road",
      city: "Mumbai",
      country: "India",
      postalCode: "400050",
      status: "active",
      paymentTermsDays: 30,
      paymentTermsType: "credit",
    });
    console.log(`Supplier reused: ${existing.companyName}`);
    return existing;
  }

  const created = await Supplier.create({
    companyName: DEMO.supplierName,
    gstin: DEMO.supplierGstin,
    stateCode: "27",
    addressLine: "45, Linking Road",
    city: "Mumbai",
    country: "India",
    postalCode: "400050",
    status: "active",
    paymentTermsDays: 30,
    paymentTermsType: "credit",
    contactName: "Demo Supplier Contact",
    contactEmail: "demo.supplier@example.com",
    contactPhone: "9876543211",
    notes: "Seed data for Tally XML export validation.",
  });
  console.log(`Supplier created: ${created.companyName}`);
  return created;
}

async function ensureProduct() {
  const existing = (await Product.list()).find((p) => p.sku.toUpperCase() === DEMO.sku);

  if (existing) {
    await Product.update(existing.id, {
      name: DEMO.productName,
      unitOfMeasure: DEMO.unit,
      hsnCode: DEMO.hsnCode,
      gstRate: DEMO.gstRate,
      unitPrice: 1180,
      unitCost: 590,
      mrp: 1499,
      category: "Apparel",
      brand: "Tally Demo",
      status: "active",
    });
    console.log(`Stock item reused: ${existing.sku} - ${existing.name}`);
    return existing;
  }

  const created = await Product.create({
    clientId: CLIENT_ID,
    sku: DEMO.sku,
    name: DEMO.productName,
    description: "Seed data for Tally XML export validation.",
    category: "Apparel",
    brand: "Tally Demo",
    unitOfMeasure: DEMO.unit,
    unitPrice: 1180,
    unitCost: 590,
    mrp: 1499,
    hsnCode: DEMO.hsnCode,
    gstRate: DEMO.gstRate,
    status: "active",
  });
  console.log(`Stock item created: ${created.sku} - ${created.name}`);
  return created;
}

function salesLine(product: any) {
  return {
    productId: product.id,
    sku: product.sku,
    name: product.name,
    unit: DEMO.unit,
    quantity: 10,
    unitPrice: 1180,
    discountPct: 0,
    gstRate: DEMO.gstRate,
    hsnCode: DEMO.hsnCode,
    rateInclTax: 1180,
    lineTotal: 11800,
  };
}

function purchaseLine(product: any) {
  return {
    productId: product.id,
    sku: product.sku,
    name: product.name,
    unit: DEMO.unit,
    orderedQty: 5,
    grnReceivedQty: 5,
    invoiceQty: 5,
    unitPrice: 590,
    poUnitPrice: 590,
    gstRate: DEMO.gstRate,
    hsnCode: DEMO.hsnCode,
    lineTotal: 2950,
  };
}

async function ensureSalesInvoice(customer: any, product: any) {
  const existing = (await Invoice.list()).find((i) => i.invoiceNumber === DEMO.salesInvoiceNumber);
  const line = salesLine(product);

  if (existing) {
    await Invoice.update(existing.id, {
      debtorId: customer.id,
      issueDate: dateOffset(-9),
      dueDate: dateOffset(21),
      placeOfSupply: "Uttar Pradesh",
      buyerGstin: DEMO.customerGstin,
      buyerState: "Uttar Pradesh",
      buyerStateCode: "09",
      lines: [line],
      lineItems: [line],
      subtotal: 10000,
      subtotalGoods: 10000,
      gstTotal: 1800,
      taxRate: DEMO.gstRate,
      taxAmount: 1800,
      grandTotal: 11800,
      freight: 0,
      status: "issued",
    } as any);
    console.log(`Sales invoice reused: ${existing.invoiceNumber}`);
    return existing;
  }

  const created = await Invoice.create({
    clientId: CLIENT_ID,
    debtorId: customer.id,
    invoiceNumber: DEMO.salesInvoiceNumber,
    amount: 11800,
    issueDate: dateOffset(-9),
    dueDate: dateOffset(21),
    status: "issued",
    lines: [line],
    lineItems: [line],
    subtotal: 10000,
    taxRate: DEMO.gstRate,
    taxAmount: 1800,
    freight: 0,
    placeOfSupply: "Uttar Pradesh",
    buyerGstin: DEMO.customerGstin,
    buyerState: "Uttar Pradesh",
    buyerStateCode: "09",
    poNumber: "TD-PO-001",
    notes: "Seed data for Tally XML export validation.",
  });
  console.log(`Sales invoice created: ${created.invoiceNumber} (${created.grandTotal})`);
  return created;
}

async function ensurePurchaseInvoice(supplier: any, product: any) {
  const existing = (await PurchaseInvoice.list()).find((p) => p.invoiceNumber === DEMO.purchaseInvoiceNumber);
  const line = purchaseLine(product);

  if (existing) {
    await PurchaseInvoice.update(existing.id, {
      vendorId: supplier.id,
      supplierName: supplier.companyName,
      issueDate: dateOffset(-14),
      dueDate: dateOffset(16),
      lines: [line],
      amountPaid: 2950,
      paidDate: dateOffset(-4),
      status: "paid",
      paymentReference: "TDUTR-PAY-001",
    } as any);
    console.log(`Purchase invoice reused: ${existing.invoiceNumber}`);
    return existing;
  }

  const created = await PurchaseInvoice.create({
    clientId: CLIENT_ID,
    vendorId: supplier.id,
    supplierName: supplier.companyName,
    invoiceNumber: DEMO.purchaseInvoiceNumber,
    issueDate: dateOffset(-14),
    dueDate: dateOffset(16),
    status: "paid",
    lines: [line],
    amountPaid: 2950,
    paidDate: dateOffset(-4),
    paymentReference: "TDUTR-PAY-001",
    notes: "Seed data for Tally XML export validation.",
  });
  console.log(`Purchase invoice created: ${created.invoiceNumber} (${created.grandTotal})`);
  return created;
}

async function ensureReceipt(invoice: any) {
  const existing = (await PaymentReceipt.list()).find((r) => r.utr === DEMO.receiptUtr);

  if (existing) {
    if (existing.status === "submitted") {
      await PaymentReceipt.verify(existing.id, {
        receiptDate: dateOffset(-1),
        collectionAccount: "Bank Account",
        paymentMode: "NEFT",
        verifiedBy: UPDATED_BY,
      });
      console.log(`Receipt verified: ${existing.utr}`);
    } else {
      console.log(`Receipt reused: ${existing.utr} (${existing.status})`);
    }
    return existing;
  }

  const submitted = await PaymentReceipt.submit({
    clientId: CLIENT_ID,
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    amount: 11800,
    utr: DEMO.receiptUtr,
    paymentMode: "NEFT",
    proofName: "tally-demo-receipt.pdf",
    submittedBy: UPDATED_BY,
  });
  const verified = await PaymentReceipt.verify(submitted.id, {
    receiptDate: dateOffset(-1),
    collectionAccount: "Bank Account",
    paymentMode: "NEFT",
    verifiedBy: UPDATED_BY,
  });
  console.log(`Receipt created and verified: ${verified.utr}`);
  return verified;
}

async function ensureCreditNote(invoice: any, customer: any, product: any) {
  const existing = (await CreditDebitNote.list()).find((n) => n.noteNumber === DEMO.creditNoteNumber);
  const line = {
    ...salesLine(product),
    quantity: 1,
    lineTotal: 1180,
  };

  const data = {
    clientId: CLIENT_ID,
    kind: "credit" as const,
    noteNumber: DEMO.creditNoteNumber,
    noteDate: dateOffset(-1),
    amount: 1180,
    reason: "Damaged item returned",
    status: "approved",
    invoiceId: invoice.id,
    appliedInvoiceId: invoice.id,
    appliedInvoiceNumber: invoice.invoiceNumber,
    counterparty: customer.name,
    lineItems: [line],
    subtotal: 1000,
    taxRate: DEMO.gstRate,
    taxAmount: 180,
    notes: "Seed data for Tally XML export validation.",
  };

  if (existing) {
    await CreditDebitNote.update(existing.id, data);
    console.log(`Credit note reused: ${existing.noteNumber}`);
    return existing;
  }

  const created = await CreditDebitNote.create(data);
  console.log(`Credit note created: ${created.noteNumber} (${created.amount})`);
  return created;
}

async function ensureDebitNote(purchase: any, supplier: any, product: any) {
  const existing = (await CreditDebitNote.list()).find((n) => n.noteNumber === DEMO.debitNoteNumber);
  const line = {
    ...purchaseLine(product),
    quantity: 1,
    invoiceQty: 1,
    orderedQty: 1,
    grnReceivedQty: 1,
    lineTotal: 590,
  };

  const data = {
    clientId: CLIENT_ID,
    kind: "debit" as const,
    noteNumber: DEMO.debitNoteNumber,
    noteDate: dateOffset(-1),
    amount: 590,
    reason: "Price difference on purchase",
    status: "approved",
    purchaseInvoiceId: purchase.id,
    supplierId: supplier.id,
    appliedInvoiceId: purchase.id,
    appliedInvoiceNumber: purchase.invoiceNumber,
    counterparty: supplier.companyName,
    lineItems: [line],
    subtotal: 500,
    taxRate: DEMO.gstRate,
    taxAmount: 90,
    notes: "Seed data for Tally XML export validation.",
  };

  if (existing) {
    await CreditDebitNote.update(existing.id, data);
    console.log(`Debit note reused: ${existing.noteNumber}`);
    return existing;
  }

  const created = await CreditDebitNote.create(data);
  console.log(`Debit note created: ${created.noteNumber} (${created.amount})`);
  return created;
}

async function verify(exportType: any, ids: string[]) {
  const result = await validateRecords(CLIENT_ID, exportType, ids);
  if (result.configError) {
    throw new Error(`${exportType}: ${result.configError}`);
  }
  const failed = result.records.filter((r) => r.errors.length > 0);
  if (failed.length) {
    for (const record of failed) {
      console.error(`  ${record.sourceLabel}: ${record.errors.join("; ")}`);
    }
    throw new Error(`${exportType}: ${failed.length} record(s) failed validation`);
  }
  console.log(`  ${exportType}: ${result.records.length} record(s) passed validation`);
}

async function main() {
  console.log(`Seeding Tally export demo data (${today})...`);
  await ensureConfig();
  const customer = await ensureCustomer();
  const supplier = await ensureSupplier();
  const product = await ensureProduct();
  const sales = await ensureSalesInvoice(customer, product);
  const purchase = await ensurePurchaseInvoice(supplier, product);
  const receipt = await ensureReceipt(sales);
  const credit = await ensureCreditNote(sales, customer, product);
  const debit = await ensureDebitNote(purchase, supplier, product);

  if (SHOULD_VERIFY) {
    console.log("\nValidating records against Tally serializers...");
    await verify("customers", [customer.id]);
    await verify("suppliers", [supplier.id]);
    await verify("stock-items", [product.id]);
    await verify("sales", [sales.id]);
    await verify("purchases", [purchase.id]);
    await verify("receipts", [receipt.id]);
    await verify("credit-notes", [credit.id]);
    await verify("debit-notes", [debit.id]);
  } else {
    console.log("\nSkipped validation (set VERIFY=1 to validate after seeding).");
  }

  console.log("\nDone. Open Tally Connector and export any of these record types.");
  console.log(`  Customer:  ${DEMO.customerName}`);
  console.log(`  Supplier:  ${DEMO.supplierName}`);
  console.log(`  Stock item: ${DEMO.sku} - ${DEMO.productName}`);
  console.log(`  Sales:     ${DEMO.salesInvoiceNumber}`);
  console.log(`  Purchase:  ${DEMO.purchaseInvoiceNumber}`);
  console.log(`  Receipt:   ${DEMO.receiptUtr}`);
  console.log(`  Credit:    ${DEMO.creditNoteNumber}`);
  console.log(`  Debit:     ${DEMO.debitNoteNumber}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("SEED ERROR:", err);
  process.exit(1);
});
