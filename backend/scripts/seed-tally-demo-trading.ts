import * as Debtor from "../src/models/debtor.js";
import * as Supplier from "../src/models/supplier.js";
import * as Product from "../src/models/product.js";
import * as Invoice from "../src/models/invoice.js";
import * as PurchaseInvoice from "../src/models/purchase-invoice.js";
import * as Tally from "../src/models/tally.js";
import * as db from "../src/dynamodb.js";
import { config } from "../src/config.js";
import { computeTotals as computeSalesTotals } from "../src/models/invoice.js";
import { computeTotals as computePurchaseTotals } from "../src/models/purchase-invoice.js";
import { buildRecords, generateBatch } from "../src/services/tally/engine.js";

type LineSpec = { sku: string; quantity: number };
type InvoiceSpec = { number: string; lines: LineSpec[]; issueOffset: number; dueOffset: number };

const CUSTOMER_NAME = "Adventra Demo Customer";
const SUPPLIER_NAME = "Adventra Demo Supplier";
const CUSTOMER_GSTIN = "09AAACR5055K1Z5";
const SUPPLIER_GSTIN = "27AABCT1332L1ZN";
const UPDATED_BY = "seed-tally-demo-trading";
const GENERATE = process.env.GENERATE === "1";

const SALES: InvoiceSpec[] = [
  {
    number: "ADV-TDS-001",
    issueOffset: -9,
    dueOffset: 21,
    lines: [
      { sku: "ADV-TALLY-001", quantity: 10 },
      { sku: "ADV-TALLY-002", quantity: 10 },
      { sku: "ADV-TALLY-003", quantity: 10 },
      { sku: "ADV-TALLY-004", quantity: 10 },
    ],
  },
  {
    number: "ADV-TDS-002",
    issueOffset: -4,
    dueOffset: 26,
    lines: [
      { sku: "ADV-TALLY-001", quantity: 12 },
      { sku: "ADV-TALLY-002", quantity: 12 },
      { sku: "ADV-TALLY-003", quantity: 12 },
      { sku: "ADV-TALLY-004", quantity: 12 },
    ],
  },
];

const PURCHASES: InvoiceSpec[] = [
  {
    number: "ADV-TDP-001",
    issueOffset: -14,
    dueOffset: 16,
    lines: [
      { sku: "ADV-TALLY-001", quantity: 15 },
      { sku: "ADV-TALLY-002", quantity: 15 },
      { sku: "ADV-TALLY-003", quantity: 15 },
      { sku: "ADV-TALLY-004", quantity: 15 },
    ],
  },
  {
    number: "ADV-TDP-002",
    issueOffset: -7,
    dueOffset: 23,
    lines: [
      { sku: "ADV-TALLY-001", quantity: 18 },
      { sku: "ADV-TALLY-002", quantity: 18 },
      { sku: "ADV-TALLY-003", quantity: 18 },
      { sku: "ADV-TALLY-004", quantity: 18 },
    ],
  },
];

const dateOffset = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

function salesLines(spec: InvoiceSpec, productsById: Map<string, any>) {
  return spec.lines.map((line) => {
    const p = productsById.get(line.sku);
    if (!p) throw new Error(`Product ${line.sku} not found. Run seed-tally-products.ts first.`);
    return {
      productId: p.id,
      sku: p.sku,
      name: p.name,
      unit: p.unitOfMeasure,
      quantity: line.quantity,
      unitPrice: Number(p.unitPrice),
      discountPct: 0,
      gstRate: Number(p.gstRate ?? 0),
      hsnCode: p.hsnCode,
      rateInclTax: Number(p.unitPrice),
      lineTotal: Math.round(line.quantity * Number(p.unitPrice) * 100) / 100,
    };
  });
}

function purchaseLines(spec: InvoiceSpec, productsById: Map<string, any>) {
  return spec.lines.map((line) => {
    const p = productsById.get(line.sku);
    if (!p) throw new Error(`Product ${line.sku} not found. Run seed-tally-products.ts first.`);
    return {
      productId: p.id,
      sku: p.sku,
      name: p.name,
      unit: p.unitOfMeasure,
      orderedQty: line.quantity,
      grnReceivedQty: line.quantity,
      invoiceQty: line.quantity,
      unitPrice: Number(p.unitCost),
      poUnitPrice: Number(p.unitCost),
      gstRate: Number(p.gstRate ?? 0),
      lineTotal: Math.round(line.quantity * Number(p.unitCost) * 100) / 100,
    };
  });
}

async function ensureCustomer(clientId: string) {
  const existing = (await Debtor.list()).find((d) => d.name === CUSTOMER_NAME);
  const addresses = [
    {
      label: "Primary",
      address: "12, MG Road",
      city: "Lucknow",
      state: "Uttar Pradesh",
      postalCode: "226001",
    },
  ];
  const data = {
    name: CUSTOMER_NAME,
    gstin: CUSTOMER_GSTIN,
    state: "Uttar Pradesh",
    stateCode: "09",
    city: "Lucknow",
    country: "India",
    postalCode: "226001",
    billingAddresses: addresses,
    shippingAddresses: addresses,
    billingAddress: "12, MG Road, Lucknow, Uttar Pradesh, 226001",
    shippingAddress: "12, MG Road, Lucknow, Uttar Pradesh, 226001",
    customerType: "Retailer",
    paymentTermsDays: 30,
    paymentTermsType: "credit",
    contactName: "Adventra Demo Contact",
    contactEmail: "demo.customer@example.com",
    contactPhone: "9876543210",
    notes: "Demo customer for Tally sales invoices.",
  };
  if (existing) {
    await Debtor.update(existing.id, data as any);
    console.log(`  Customer reused: ${CUSTOMER_NAME}`);
    return existing;
  }
  const created = await Debtor.create({ ...data, clientId } as any);
  console.log(`  Customer created: ${CUSTOMER_NAME}`);
  return created;
}

async function ensureSupplier(clientId: string) {
  const existing = (await Supplier.list()).find((s) => s.companyName === SUPPLIER_NAME);
  const data = {
    companyName: SUPPLIER_NAME,
    gstin: SUPPLIER_GSTIN,
    state: "Maharashtra",
    stateCode: "27",
    addressLine: "45, Linking Road",
    city: "Mumbai",
    country: "India",
    postalCode: "400050",
    status: "active",
    paymentTermsDays: 30,
    paymentTermsType: "credit",
    contactName: "Adventra Demo Supplier Contact",
    contactEmail: "demo.supplier@example.com",
    contactPhone: "9876543211",
    notes: "Demo supplier for Tally purchase invoices.",
  };
  if (existing) {
    await Supplier.update(existing.id, data as any);
    console.log(`  Supplier reused: ${SUPPLIER_NAME}`);
    return existing;
  }
  const created = await Supplier.create({ ...data, clientId } as any);
  console.log(`  Supplier created: ${SUPPLIER_NAME}`);
  return created;
}

async function ensureSalesInvoice(
  spec: InvoiceSpec,
  customerId: string,
  productsById: Map<string, any>,
  clientId: string,
) {
  const lines = salesLines(spec, productsById);
  const totals = computeSalesTotals(lines as any, 0);
  const issueDate = dateOffset(spec.issueOffset);
  const dueDate = dateOffset(spec.dueOffset);
  const data = {
    clientId,
    debtorId: customerId,
    invoiceNumber: spec.number,
    amount: totals.grandTotal,
    issueDate,
    dueDate,
    status: "issued",
    lines,
    lineItems: lines,
    subtotal: totals.subtotalGoods,
    subtotalGoods: totals.subtotalGoods,
    gstTotal: totals.gstTotal,
    taxRate: 0,
    taxAmount: totals.gstTotal,
    freight: 0,
    placeOfSupply: "Uttar Pradesh",
    buyerGstin: CUSTOMER_GSTIN,
    buyerState: "Uttar Pradesh",
    buyerStateCode: "09",
    poNumber: `PO-${spec.number}`,
    notes: "Demo sales invoice for Tally import.",
  } as any;

  const existing = (await Invoice.list()).find((i) => i.invoiceNumber === spec.number);
  let invoice: any;
  if (existing) {
    await Invoice.update(existing.id, data);
    invoice = await Invoice.get(existing.id);
    console.log(`  Sales invoice reused: ${spec.number} (${totals.grandTotal})`);
  } else {
    invoice = await Invoice.create(data);
    console.log(`  Sales invoice created: ${spec.number} (${totals.grandTotal})`);
  }
  const received = Number(invoice?.amountReceived) || 0;
  if (received < Number(invoice?.amount ?? totals.grandTotal) - 0.005) {
    await Invoice.recordPayment(invoice.id, Number(invoice.amount) - received, dateOffset(spec.issueOffset + 1));
    console.log(`  Payment recorded: ${spec.number} (paid)`);
  }
  return invoice.id;
}

async function ensurePurchaseInvoice(
  spec: InvoiceSpec,
  supplierId: string,
  supplierName: string,
  productsById: Map<string, any>,
  clientId: string,
) {
  const lines = purchaseLines(spec, productsById);
  const totals = computePurchaseTotals(lines as any, 0);
  const issueDate = dateOffset(spec.issueOffset);
  const dueDate = dateOffset(spec.dueOffset);
  const paidDate = dateOffset(spec.issueOffset + 2);
  const data = {
    clientId,
    vendorId: supplierId,
    supplierName,
    invoiceNumber: spec.number,
    issueDate,
    dueDate,
    receivedDate: issueDate,
    status: "paid",
    lines,
    amount: totals.grandTotal,
    amountPaid: totals.grandTotal,
    balanceDue: 0,
    subtotal: totals.subtotal,
    gstTotal: totals.gstTotal,
    freight: 0,
    paidDate,
    paymentReference: `UTR-${spec.number}`,
    notes: "Demo purchase invoice for Tally import.",
  } as any;

  const existing = (await PurchaseInvoice.list()).find((p) => p.invoiceNumber === spec.number);
  if (existing) {
    await PurchaseInvoice.update(existing.id, data);
    console.log(`  Purchase invoice reused: ${spec.number} (${totals.grandTotal})`);
    return existing.id;
  }
  const created = await PurchaseInvoice.create(data);
  console.log(`  Purchase invoice created: ${spec.number} (${totals.grandTotal})`);
  return created.id;
}

async function ensureMappings() {
  const existing = await Tally.getConfig("shared");
  if (!existing) throw new Error("Tally config missing. Run seed-tally-products.ts first.");
  const mappings = { ...existing.mappings } as Record<string, any>;
  let changed = false;
  for (const key of Object.keys(Tally.EMPTY_MAPPING)) {
    if (!String(mappings[key] ?? "").trim()) {
      mappings[key] = (Tally.SUGGESTED_MAPPING as unknown as Record<string, string>)[key] || "";
      changed = true;
    }
  }
  if (changed) {
    await Tally.saveConfig("shared", { mappings } as any, UPDATED_BY);
    console.log("  Tally ledger mappings filled from defaults.");
  }
  return (await Tally.getConfig("shared"))!;
}

async function verify(clientId: string, idsByType: Record<string, string[]>) {
  const tallyConfig = (await Tally.getConfig(clientId)) || (await Tally.getConfig("shared"));
  if (!tallyConfig) throw new Error("No Tally config found; cannot verify XML output.");
  console.log("\nTally XML verification:");
  for (const [type, ids] of Object.entries(idsByType)) {
    const { prepared } = await buildRecords(clientId, type as any, tallyConfig, ids);
    if (prepared.length !== ids.length) {
      throw new Error(`${type}: expected ${ids.length} record(s), got ${prepared.length}.`);
    }
    for (const rec of prepared) {
      if (rec.errors.length) throw new Error(`${type} ${rec.docNumber}: ${rec.errors.join("; ")}`);
      console.log(
        `  ${type}: ${rec.docNumber} | ${rec.party || "-"} | ${rec.amount} | totals ${rec.totals.grandTotal} | ${rec.status}`,
      );
    }
  }
}

async function generate(clientId: string, idsByType: Record<string, string[]>) {
  console.log("\nGenerating import-ready Tally XML batches:");
  for (const type of ["customers", "suppliers", "stock-items", "sales", "purchases"]) {
    const ids = idsByType[type];
    if (!ids?.length) continue;
    const result = await generateBatch({
      clientId,
      exportType: type as any,
      ids,
      generatedBy: UPDATED_BY,
      force: true,
    });
    if (result.validationFailed) {
      throw new Error(`${type}: ${result.errors.join("; ")}`);
    }
    console.log(`  ${type}: ${result.batch.id} | ${result.batch.xmlPath}`);
  }
}

async function main() {
  const isDryRun = process.argv.includes("--dry-run");
  const hasConfirmed = process.argv.includes("--yes");
  if (!isDryRun && !hasConfirmed) {
    console.log("Refusing to write without confirmation. Re-run with: --yes");
    console.log("To preview without writing anything, use: --dry-run");
    process.exit(1);
  }

  const adminEmail = config.admin.email;
  if (!adminEmail) throw new Error("No ADMIN_EMAIL set in backend/.env - cannot resolve the owner account.");
  const users = (await db.scanByType("User")) as any[];
  const owner = users.find((u) => u.email === adminEmail);
  if (!owner) throw new Error(`User "${adminEmail}" not found. Start the backend once to create it.`);
  const clientId = owner.id;

  const allProducts = (await Product.list()) as any[];
  const productsById = new Map<string, any>(allProducts.map((p) => [p.sku?.toUpperCase(), p]));
  for (const spec of [...SALES, ...PURCHASES]) {
    for (const line of spec.lines) {
      if (!productsById.has(line.sku)) {
        throw new Error(`Product ${line.sku} not found. Run: npx tsx scripts/seed-tally-products.ts --yes`);
      }
    }
  }

  console.log(
    `Seeding demo customer, supplier and ${SALES.length} sales + ${PURCHASES.length} purchase invoices ` +
      `(owner ${owner.email}).${isDryRun ? " (DRY RUN - nothing will be written)" : ""}\n`,
  );
  for (const spec of SALES) {
    const lines = salesLines(spec, productsById);
    const totals = computeSalesTotals(lines as any, 0);
    console.log(`  SALES ${spec.number}: ${dateOffset(spec.issueOffset)} | ${spec.lines.map((l) => `${l.quantity}x${l.sku}`).join(", ")} | ${totals.grandTotal}`);
  }
  for (const spec of PURCHASES) {
    const lines = purchaseLines(spec, productsById);
    const totals = computePurchaseTotals(lines as any, 0);
    console.log(`  PURCHASE ${spec.number}: ${dateOffset(spec.issueOffset)} | ${spec.lines.map((l) => `${l.quantity}x${l.sku}`).join(", ")} | ${totals.grandTotal}`);
  }
  console.log("");

  if (isDryRun) {
    console.log("End of dry run - nothing written.");
    process.exit(0);
  }

  const customer = await ensureCustomer(clientId);
  const supplier = await ensureSupplier(clientId);
  await ensureMappings();

  const salesIds: string[] = [];
  const purchaseIds: string[] = [];
  for (const spec of SALES) {
    salesIds.push(await ensureSalesInvoice(spec, customer.id, productsById, clientId));
  }
  for (const spec of PURCHASES) {
    purchaseIds.push(await ensurePurchaseInvoice(spec, supplier.id, supplier.companyName, productsById, clientId));
  }

  const stockIds = allProducts
    .filter((p) => p.sku?.startsWith("ADV-TALLY-"))
    .map((p) => p.id);
  const idsByType: Record<string, string[]> = {
    customers: [customer.id],
    suppliers: [supplier.id],
    "stock-items": stockIds,
    sales: salesIds,
    purchases: purchaseIds,
  };

  await verify(clientId, idsByType);
  if (GENERATE) await generate(clientId, idsByType);

  console.log("\nDone. Tally Connector -> Transactions -> Sales / Purchases shows all 4 invoices as Ready.");
  if (!GENERATE) console.log("Set GENERATE=1 to also create import-ready XML batches.");
  process.exit(0);
}

main().catch((err) => {
  console.error("SEED ERROR:", err);
  process.exit(1);
});
