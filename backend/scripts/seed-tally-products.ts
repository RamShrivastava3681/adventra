import * as Product from "../src/models/product.js";
import * as StockMovement from "../src/models/stock-movement.js";
import * as Tally from "../src/models/tally.js";
import * as db from "../src/dynamodb.js";
import { config } from "../src/config.js";
import { buildRecords } from "../src/services/tally/engine.js";

type SeedProduct = {
  sku: string;
  name: string;
  description: string;
  category: string;
  subcategory: string;
  gender: string;
  brand: string;
  size: string;
  color: string;
  model: string;
  unitOfMeasure: string;
  barcode: string;
  barcodeType: string;
  unitsPerCarton: number;
  unitCost: number;
  unitPrice: number;
  mrp: number;
  ecommercePrice: number;
  retailerPrice: number;
  distributorPrice: number;
  flexiblePrice: number;
  minimumGrossMarginPercentage: number;
  reorderLevel: number;
  maxStock: number;
  leadTimeDays: number;
  safetyStockDays: number;
  minimumOrderQuantity: number;
  orderMultiple: number;
  hsnCode: string;
  gstRate: number;
};

const SEED_PRODUCTS: SeedProduct[] = [
  {
    sku: "ADV-TALLY-001",
    name: "Adventra Ridgeback 35L Trekking Backpack",
    description: "35 litre waterproof trekking backpack with padded harness and rain cover.",
    category: "Backpacks",
    subcategory: "Trekking",
    gender: "Unisex",
    brand: "Adventra",
    size: "35L",
    color: "Slate Grey",
    model: "Ridgeback-35",
    unitOfMeasure: "pics",
    barcode: "8901234500017",
    barcodeType: "EAN-13",
    unitsPerCarton: 10,
    unitCost: 1400,
    unitPrice: 2450,
    mrp: 3299,
    ecommercePrice: 2699,
    retailerPrice: 2450,
    distributorPrice: 2100,
    flexiblePrice: 2350,
    minimumGrossMarginPercentage: 0.18,
    reorderLevel: 20,
    maxStock: 300,
    leadTimeDays: 15,
    safetyStockDays: 30,
    minimumOrderQuantity: 10,
    orderMultiple: 5,
    hsnCode: "42029200",
    gstRate: 18,
  },
  {
    sku: "ADV-TALLY-002",
    name: "Adventra Stormproof Shell Jacket",
    description: "Three-layer waterproof breathable shell jacket for high-altitude trekking.",
    category: "Apparel",
    subcategory: "Outerwear",
    gender: "Unisex",
    brand: "Adventra",
    size: "M",
    color: "Navy",
    model: "StormShell-2026",
    unitOfMeasure: "pics",
    barcode: "8901234500024",
    barcodeType: "EAN-13",
    unitsPerCarton: 20,
    unitCost: 2200,
    unitPrice: 3899,
    mrp: 4999,
    ecommercePrice: 4199,
    retailerPrice: 3899,
    distributorPrice: 3400,
    flexiblePrice: 3699,
    minimumGrossMarginPercentage: 0.2,
    reorderLevel: 15,
    maxStock: 200,
    leadTimeDays: 20,
    safetyStockDays: 30,
    minimumOrderQuantity: 10,
    orderMultiple: 1,
    hsnCode: "62014090",
    gstRate: 18,
  },
  {
    sku: "ADV-TALLY-003",
    name: "Adventra Quick-Dry Trekking Shirt",
    description: "Lightweight moisture-wicking trekking shirt with UV protection.",
    category: "Apparel",
    subcategory: "T-Shirts",
    gender: "Unisex",
    brand: "Adventra",
    size: "L",
    color: "Olive",
    model: "QuickDry-TS",
    unitOfMeasure: "pics",
    barcode: "8901234500031",
    barcodeType: "EAN-13",
    unitsPerCarton: 25,
    unitCost: 450,
    unitPrice: 899,
    mrp: 1199,
    ecommercePrice: 949,
    retailerPrice: 899,
    distributorPrice: 760,
    flexiblePrice: 849,
    minimumGrossMarginPercentage: 0.25,
    reorderLevel: 40,
    maxStock: 500,
    leadTimeDays: 10,
    safetyStockDays: 30,
    minimumOrderQuantity: 20,
    orderMultiple: 5,
    hsnCode: "61099090",
    gstRate: 5,
  },
  {
    sku: "ADV-TALLY-004",
    name: "Adventra Insulated Steel Bottle 750ml",
    description: "Double-wall vacuum-insulated stainless steel bottle, 750 ml capacity.",
    category: "Accessories",
    subcategory: "Hydration",
    gender: "Unisex",
    brand: "Adventra",
    size: "750ml",
    color: "Steel",
    model: "AquaSteel-750",
    unitOfMeasure: "pics",
    barcode: "8901234500048",
    barcodeType: "EAN-13",
    unitsPerCarton: 30,
    unitCost: 320,
    unitPrice: 649,
    mrp: 899,
    ecommercePrice: 699,
    retailerPrice: 649,
    distributorPrice: 540,
    flexiblePrice: 599,
    minimumGrossMarginPercentage: 0.22,
    reorderLevel: 50,
    maxStock: 600,
    leadTimeDays: 12,
    safetyStockDays: 30,
    minimumOrderQuantity: 30,
    orderMultiple: 10,
    hsnCode: "73239390",
    gstRate: 18,
  },
];

const OPENING_QTY = 100;
const UPDATED_BY = "seed-tally-products";
const WAREHOUSE = "Main Warehouse";
const SHOULD_VERIFY = process.env.VERIFY === "1";

function productData(p: SeedProduct, clientId: string) {
  return {
    clientId,
    sku: p.sku,
    name: p.name,
    description: p.description,
    category: p.category,
    subcategory: p.subcategory,
    gender: p.gender,
    brand: p.brand,
    size: p.size,
    color: p.color,
    model: p.model,
    unitOfMeasure: p.unitOfMeasure,
    barcode: p.barcode,
    barcodeType: p.barcodeType,
    unitsPerCarton: p.unitsPerCarton,
    unitPrice: p.unitPrice,
    unitCost: p.unitCost,
    mrp: p.mrp,
    ecommercePrice: p.ecommercePrice,
    retailerPrice: p.retailerPrice,
    distributorPrice: p.distributorPrice,
    flexiblePrice: p.flexiblePrice,
    minimumGrossMarginPercentage: p.minimumGrossMarginPercentage,
    reorderLevel: p.reorderLevel,
    maxStock: p.maxStock,
    leadTimeDays: p.leadTimeDays,
    safetyStockDays: p.safetyStockDays,
    minimumOrderQuantity: p.minimumOrderQuantity,
    orderMultiple: p.orderMultiple,
    hsnCode: p.hsnCode,
    gstRate: p.gstRate,
    status: "active",
  };
}

function openingReference(p: SeedProduct): string {
  return `OPEN-${p.sku}`;
}

async function ensureConfig() {
  const existing = await Tally.getConfig("shared");
  if (existing) {
    console.log(`Tally config reused: ${existing.companyName} | ${existing.homeState} | godown ${existing.godownName}`);
    return existing;
  }
  const mappingKeys = Object.keys(Tally.EMPTY_MAPPING) as (keyof Tally.TallyLedgerMapping)[];
  const mappings = {} as Tally.TallyLedgerMapping;
  for (const key of mappingKeys) {
    mappings[key] = Tally.SUGGESTED_MAPPING[key] || Tally.EMPTY_MAPPING[key];
  }
  const created = await Tally.saveConfig(
    "shared",
    {
      companyName: "Adventra Demo Pvt Ltd",
      homeState: "Uttar Pradesh",
      gstin: "09AABCU9603R1ZM",
      gstRegistrationType: "Regular",
      godownName: WAREHOUSE,
      defaultUnit: "pics",
      stockGroup: "Primary",
      batchName: "Primary Batch",
      gstApplicableFrom: "2026-04-01",
      mappings,
      allowDuplicateReExport: false,
    },
    UPDATED_BY,
  );
  console.log(`Tally config created: ${created.companyName} | ${created.homeState} | godown ${created.godownName}`);
  return created;
}

async function ensureProduct(p: SeedProduct, clientId: string) {
  const all = (await Product.list()) as Product.Product[];
  const existing = all.find((item) => item.sku?.toUpperCase() === p.sku);
  if (existing) {
    await Product.update(existing.id, productData(p, clientId));
    console.log(`  Product updated: ${p.sku} - ${p.name}`);
    return existing;
  }
  const created = await Product.create(productData(p, clientId));
  console.log(`  Product created: ${p.sku} - ${p.name}`);
  return created;
}

async function ensureOpeningStock(p: SeedProduct, productId: string, clientId: string, actor: { id: string; name: string }) {
  const movements = (await StockMovement.list(clientId)).filter((m) => m.productId === productId);
  const reference = openingReference(p);
  const existing = movements.find(
    (m) => m.linkedDocumentNumber === reference && m.reason === "Opening stock" && m.status === "confirmed",
  );

  if (existing) {
    const patch: Record<string, any> = { status: "confirmed" };
    if (existing.quantity !== OPENING_QTY) patch.quantity = OPENING_QTY;
    if (existing.direction !== "in") patch.direction = "in";
    if (Number(existing.unitCost) !== p.unitCost) patch.unitCost = p.unitCost;
    if (Object.keys(patch).length > 1) {
      await StockMovement.update(existing.id, patch);
      console.log(`  Opening stock corrected: ${p.sku} - ${OPENING_QTY} ${p.unitOfMeasure}`);
    } else {
      console.log(`  Opening stock reused: ${p.sku} - ${OPENING_QTY} ${p.unitOfMeasure}`);
    }
    return existing;
  }

  const created = await StockMovement.create({
    clientId,
    productId,
    direction: "in",
    itemName: p.name,
    sku: p.sku,
    quantity: OPENING_QTY,
    unit: p.unitOfMeasure,
    unitCost: p.unitCost,
    warehouse: WAREHOUSE,
    reason: "Opening stock",
    linkedDocumentNumber: reference,
    status: "confirmed",
    notes: "Opening stock for Tally stock item export.",
    movementDate: db.todayDate(),
    createdById: actor.id,
    createdByName: actor.name,
    confirmedById: actor.id,
    confirmedByName: actor.name,
    confirmedAt: db.nowISO(),
  });
  console.log(`  Opening stock created: ${p.sku} - ${OPENING_QTY} ${p.unitOfMeasure} (${created.movementNumber})`);
  return created;
}

async function verifyTallyXml(clientId: string, ids: string[]) {
  const tallyConfig = (await Tally.getConfig(clientId)) || (await Tally.getConfig("shared"));
  if (!tallyConfig) throw new Error("No Tally config found; cannot verify XML output.");

  const { prepared } = await buildRecords(clientId, "stock-items", tallyConfig, ids);
  const byId = new Map(prepared.map((r) => [r.sourceId, r]));
  console.log("\nTally stock-item XML verification:");
  for (const seed of SEED_PRODUCTS) {
    const record = ids
      .map((id) => ({ id, rec: byId.get(id) }))
      .find(({ rec }) => rec && rec.docNumber === seed.sku);
    if (!record?.rec) throw new Error(`${seed.sku}: no prepared Tally record found.`);
    const { rec } = record;
    if (rec.errors.length) throw new Error(`${seed.sku}: ${rec.errors.join("; ")}`);
    const balance = rec.xml.match(/<OPENINGBALANCE>([\d.]+)\s+([^<]+)<\/OPENINGBALANCE>/);
    if (!balance) throw new Error(`${seed.sku}: OPENINGBALANCE missing from Tally XML.`);
    if (Number(balance[1]) !== OPENING_QTY || balance[2] !== seed.unitOfMeasure) {
      throw new Error(`${seed.sku}: unexpected opening balance ${balance[0]}.`);
    }
    if (!/<OPENINGVALUE>-/.test(rec.xml) || !/<OPENINGRATE>[\d.]+\/[^<]+<\/OPENINGRATE>/.test(rec.xml)) {
      throw new Error(`${seed.sku}: opening value/rate missing from Tally XML.`);
    }
    console.log(`  ${seed.sku}: ${balance[0]} | OPENINGVALUE/OPENINGRATE present | HSN ${seed.hsnCode} | GST ${seed.gstRate}%`);
  }
  if (prepared.length !== SEED_PRODUCTS.length) {
    console.log(`  Note: ${prepared.length} stock items in this batch (${SEED_PRODUCTS.length} seeded products requested).`);
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
  if (!owner) throw new Error(`User "${adminEmail}" not found. Start the backend once to create it, or fix ADMIN_EMAIL.`);
  const clientId = owner.id;

  console.log(`Seeding ${SEED_PRODUCTS.length} Tally-ready products (owner ${owner.email}, client ${clientId}).`);
  console.log(`Table: ${config.dynamodb.tableName}${isDryRun ? " (DRY RUN - nothing will be written)" : ""}\n`);

  const allProducts = (await Product.list()) as Product.Product[];
  const allMovements = (await StockMovement.list(clientId)) as StockMovement.StockMovement[];
  const tallyConfig = await Tally.getConfig("shared");

  for (const p of SEED_PRODUCTS) {
    const product = allProducts.find((item) => item.sku?.toUpperCase() === p.sku);
    const existingOpening = product
      ? allMovements.find(
          (m) =>
            m.productId === product.id &&
            m.linkedDocumentNumber === openingReference(p) &&
            m.reason === "Opening stock" &&
            m.status === "confirmed",
        )
      : undefined;
    console.log(
      `  ${p.sku}: product ${product ? "exists" : "new"}, opening ${existingOpening ? "exists" : "new"} ` +
        `(${OPENING_QTY} ${p.unitOfMeasure} @ ${p.unitCost}/- , HSN ${p.hsnCode}, GST ${p.gstRate}%, MRP ${p.mrp})`,
    );
  }
  console.log(`  Tally config: ${tallyConfig ? `${tallyConfig.companyName} (godown ${tallyConfig.godownName})` : "missing - will be created"}\n`);

  if (isDryRun) {
    console.log("End of dry run - nothing written.");
    process.exit(0);
  }

  await ensureConfig();
  const ids: string[] = [];
  for (const p of SEED_PRODUCTS) {
    const product = await ensureProduct(p, clientId);
    await ensureOpeningStock(p, product.id, clientId, { id: owner.id, name: owner.email });
    ids.push(product.id);
  }

  await verifyTallyXml(clientId, ids);

  console.log("\nDone. In the app open Tally Connector -> Masters -> Stock Items, select these SKUs and export.");
  for (const p of SEED_PRODUCTS) {
    console.log(`  ${p.sku} | ${p.name} | opening ${OPENING_QTY} ${p.unitOfMeasure} | rate ${p.unitPrice} | cost ${p.unitCost}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("SEED ERROR:", err);
  process.exit(1);
});
