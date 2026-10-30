// Seed Amazon demo orders and SKU mappings
// Run with: cd backend && npx tsx scripts/seed-amazon-demo-orders.ts --clientId=<userId>
// Idempotent: duplicate amazonOrderId and channelSku entries are skipped.

import * as DynamoDB from "../src/dynamodb.js";
import * as OrderModel from "../src/models/marketplace-amazon-order.ts";
import * as SkuMappingModel from "../src/models/marketplace-amazon-sku-mapping.ts";
import * as SkuMaster from "../src/models/sku-master.js";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), "true"];
  }),
);

const clientId = String(args.clientId ?? args.client ?? "").trim();
if (!clientId) {
  console.error("Usage: npx tsx scripts/seed-amazon-demo-orders.ts --clientId=<userId>");
  process.exit(1);
}

// Ensure required SKU masters exist for the client
const requiredMasters = [
  { masterType: "category", name: "T-Shirts", code: "TN" },
  { masterType: "category", name: "Shirts", code: "SH" },
  { masterType: "color", name: "Black", code: "BLK" },
  { masterType: "color", name: "White", code: "WHT" },
  { masterType: "color", name: "Navy Blue", code: "NVY" },
  { masterType: "size", name: "Small", code: "S", sizeSystem: "International" },
  { masterType: "size", name: "Medium", code: "M", sizeSystem: "International" },
  { masterType: "size", name: "Large", code: "L", sizeSystem: "International" },
  { masterType: "size", name: "XL", code: "XL", sizeSystem: "International" },
];

for (const s of requiredMasters) {
  try {
    await SkuMaster.create({ clientId, ...s });
    console.log(`+ SKU Master ${s.masterType} ${s.name} (${s.code})`);
  } catch (e: any) {
    if (/already exists/i.test(e?.message ?? "")) {
      console.log(`= skip SKU Master ${s.masterType} ${s.code} (exists)`);
    } else {
      console.error(`! SKU Master ${s.masterType} ${s.code} error:`, e.message);
    }
  }
}

// Define Amazon demo orders - each uses existing SKU mappings
const amazonOrders = [
  {
    amazonOrderId: "902-1845936-5435065",
    amazonSku: "AMZ-TS-BLK-M",
    productName: "Adventra Classic Tee",
    colour: "Black",
    size: "M",
    quantity: 2,
    sellingPrice: 1000,
    discount: 0,
    taxRate: 5,
    taxableAmount: 2000,
    taxAmount: 100,
    shippingMethod: "Standard",
    fulfilmentType: "FBA",
    deliveryAddress: {
      addressLine1: "123 Main Street",
      addressLine2: null,
      city: "Mumbai",
      state: "Maharashtra",
      postalCode: "400001",
      country: "India",
    },
    orderDate: new Date().toISOString().split("T")[0],
    amazonOrderStatus: "Pending",
    invoiceStatus: "Pending",
  },
  {
    amazonOrderId: "902-1845936-5435066",
    amazonSku: "AMZ-TS-BLK-L",
    productName: "Adventra Classic Tee",
    colour: "Black",
    size: "L",
    quantity: 1,
    sellingPrice: 1000,
    discount: 0,
    taxRate: 5,
    taxableAmount: 1000,
    taxAmount: 50,
    shippingMethod: "Express",
    fulfilmentType: "FBA",
    deliveryAddress: {
      addressLine1: "456 Park Avenue",
      addressLine2: null,
      city: "Delhi",
      state: "Delhi",
      postalCode: "110001",
      country: "India",
    },
    orderDate: new Date().toISOString().split("T")[0],
    amazonOrderStatus: "Pending",
    invoiceStatus: "Pending",
  },
  {
    amazonOrderId: "902-1845936-5435067",
    amazonSku: "AMZ-TS-WHT-M",
    productName: "Adventra Classic Tee",
    colour: "White",
    size: "M",
    quantity: 3,
    sellingPrice: 1000,
    discount: 0,
    taxRate: 5,
    taxableAmount: 3000,
    taxAmount: 150,
    shippingMethod: "Standard",
    fulfilmentType: "FBA",
    deliveryAddress: {
      addressLine1: "789 MG Road",
      addressLine2: null,
      city: "Bangalore",
      state: "Karnataka",
      postalCode: "560001",
      country: "India",
    },
    orderDate: new Date().toISOString().split("T")[0],
    amazonOrderStatus: "Pending",
    invoiceStatus: "Pending",
  },
  {
    amazonOrderId: "902-1845936-5435068",
    amazonSku: "AMZ-PO-NVY-M",
    productName: "Adventra Pique Polo",
    colour: "Navy",
    size: "M",
    quantity: 2,
    sellingPrice: 1400,
    discount: 100,
    taxRate: 5,
    taxableAmount: 2800,
    taxAmount: 140,
    shippingMethod: "Standard",
    fulfilmentType: "FBA",
    deliveryAddress: {
      addressLine1: "321 Race Course Road",
      addressLine2: null,
      city: "Chennai",
      state: "Tamil Nadu",
      postalCode: "600001",
      country: "India",
    },
    orderDate: new Date().toISOString().split("T")[0],
    amazonOrderStatus: "Pending",
    invoiceStatus: "Pending",
  },
  {
    amazonOrderId: "902-1845936-5435069",
    amazonSku: "AMZ-UNKNOWN",
    productName: "Unmapped Item",
    colour: "Unknown",
    size: "Unknown",
    quantity: 1,
    sellingPrice: 999,
    discount: 0,
    taxRate: 5,
    taxableAmount: 999,
    taxAmount: 50,
    shippingMethod: "Standard",
    fulfilmentType: "FBA",
    deliveryAddress: {
      addressLine1: "654 Airport Road",
      addressLine2: null,
      city: "Kolkata",
      state: "West Bengal",
      postalCode: "700001",
      country: "India",
    },
    orderDate: new Date().toISOString().split("T")[0],
    amazonOrderStatus: "Pending",
    invoiceStatus: "Pending",
  },
];

let createdOrders = 0;
let skippedOrders = 0;
let createdMappings = 0;
let skippedMappings = 0;

// First, ensure SKU mappings exist for the Amazon SKUs
console.log("--- Ensuring SKU mappings exist ---");

for (const order of amazonOrders) {
  // Check if mapping already exists
  const existingMapping = await SkuMappingModel.findByChannelSku(clientId, order.amazonSku);
  
  if (existingMapping) {
    console.log(`= skip mapping for ${order.amazonSku} (already exists)`);
    skippedMappings++;
    continue;
  }

  // Determine whizunikSku and variant based on the existing mappings pattern
  let whizunikSku: string;
  let variant: string;
  
  switch (order.amazonSku) {
    case "AMZ-TS-BLK-M":
      whizunikSku = "AD-TS-BLK-M";
      variant = "Black / M";
      break;
    case "AMZ-TS-BLK-L":
      whizunikSku = "AD-TS-BLK-L";
      variant = "Black / L";
      break;
    case "AMZ-TS-WHT-M":
      whizunikSku = "AD-TS-WHT-M";
      variant = "White / M";
      break;
    case "AMZ-PO-NVY-M":
      whizunikSku = "AD-PO-NVY-M";
      variant = "Navy / M";
      break;
    case "AMZ-UNKNOWN":
    default:
      whizunikSku = "UNMAPPED";
      variant = "Unknown";
      break;
  }

  // Create the SKU mapping
  try {
    await SkuMappingModel.create({
      clientId,
      channelSku: order.amazonSku,
      listingId: `ASIN-${order.amazonSku.replace("-", "")}`,
      whizunikSku,
      colour: order.colour,
      size: order.size,
      productName: order.productName,
      variant,
      warehouse: "WH-AMAZON-FBA",
      mrp: order.sellingPrice + 500,
      sellingPrice: order.sellingPrice,
      hsn: "61091000",
      gstRate: order.taxRate,
      status: "Active",
      safetyStock: 10,
    });
    console.log(`+ SKU mapping created for ${order.amazonSku} -> ${whizunikSku}`);
    createdMappings++;
  } catch (e: any) {
    console.error(`! Error creating mapping for ${order.amazonSku}:`, e.message);
  }
}

// Now create the Amazon orders
console.log("\n--- Creating Amazon orders ---");

for (const order of amazonOrders) {
  // Check if order already exists
  const existingOrder = await OrderModel.findByAmazonOrderId(clientId, order.amazonOrderId);
  
  if (existingOrder) {
    console.log(`= skip order ${order.amazonOrderId} (already exists)`);
    skippedOrders++;
    continue;
  }

  try {
    const created = await OrderModel.create({
      clientId,
      amazonOrderId: order.amazonOrderId,
      amazonSku: order.amazonSku,
      productName: order.productName,
      colour: order.colour,
      size: order.size,
      quantity: order.quantity,
      sellingPrice: order.sellingPrice,
      discount: order.discount,
      taxInformation: {
        taxableAmount: order.taxableAmount,
        taxAmount: order.taxAmount,
        taxRate: order.taxRate,
      },
      deliveryAddress: order.deliveryAddress,
      shippingMethod: order.shippingMethod,
      fulfilmentType: order.fulfilmentType,
      expectedDispatchDate: null,
      amazonOrderStatus: order.amazonOrderStatus,
      invoiceStatus: order.invoiceStatus,
    });
    console.log(`+ Order created: ${order.amazonOrderId} - ${order.productName} (${order.quantity}x ${order.amazonSku})`);
    createdOrders++;
  } catch (e: any) {
    console.error(`! Error creating order ${order.amazonOrderId}:`, e.message);
  }
}

console.log(`\nDone. createdOrders=${createdOrders} skippedOrders=${skippedOrders}`);
console.log(`createdMappings=${createdMappings} skippedMappings=${skippedMappings}`);
process.exit(0);