// ===========================================================================
// Marketplace Integration Demo Store — Adventra PoC Fixtures & State
// Compliant with WhizUnik Marketplace Developer Guide (v1.0 - 6 Oct 2026)
// ===========================================================================

export interface ChannelStats {
  id: string;
  name: string;
  tag: string;
  orders: number;
  grossValue: number;
  returns: number;
  stockSync: string;
  lastSyncTime: string;
  isDemo: boolean;
  warehouseName: string;
  warehouseCode: string;
  commissionRate: number; // percentage
  status: "connected" | "syncing" | "error";
  allocatedStock: number;
  avgOrderValue: number;
  payoutPending: number;
}

export interface SkuMapping {
  id: string;
  channel: string;
  channelSku: string;
  listingId: string;
  whizunikSku: string;
  productName: string;
  variant: string;
  warehouse: string;
  mrp: number;
  sellingPrice: number;
  hsn: string;
  gstRate: number;
  status: "Mapped" | "Pending" | "Error" | "Active";
  safetyStock: number;
}

export interface InventoryLedgerRow {
  checkpoint: string;
  stepNumber: number;
  onHand: number;
  reserved: number;
  qcHold: number;
  available: number;
  actionNote: string;
  isCurrent: boolean;
  isPassed: boolean;
}

export interface ProductInventory {
  whizunikSku: string;
  productName?: string;
  variant: string;
  amazonSku: string;
  shopifyVariant: string;
  flipkartSku?: string;
  warehouse: string;
  onHand: number;
  reserved: number;
  qcHold: number;
  available: number;
  allocatedByWarehouse?: Record<string, number>;
}

export interface EcommerceOrder {
  id: string;
  channel: "amazon" | "flipkart" | "myntra" | "marketplace4" | "shopify" | "manual";
  channelName: string;
  externalOrderId: string;
  customerName: string;
  customerCity: string;
  sku: string;
  productName: string;
  variant: string;
  quantity: number;
  unitPrice: number;
  totalValue: number;
  paymentMethod: "Prepaid" | "COD";
  paymentStatus: "pending" | "collected_by_marketplace" | "collected";
  fulfillmentRef: string; // e.g. "FUL-AMZ-1001"
  debitMovementNumber: string; // e.g. "MOV-DR-1001"
  ecommerceWarehouse: string; // e.g. "WH-AMAZON-FBA"
  salesOrderId?: string;
  invoiceId?: string | null;
  status: "allocated_debited" | "reserved" | "picked_packed" | "dispatched" | "delivered" | "return_qc";
  trackingNumber?: string;
  carrier?: string;
  isManual?: boolean;
  notes?: string;
  createdAt: string;
}

export interface DemoWorkflowState {
  currentStep: number; // 0 to 8
  isAutoPlaying: boolean;
  orderId: string;
  externalOrderId: string;
  eventId: string;
  fulfillmentRef: string;
  debitMovementNumber: string;
  ecommerceWarehouse: string;
  soId: string;
  invoiceId: string;
  demoSoId: string | null;
  demoSoNumber: string | null;
  demoInvoiceId: string | null;
  demoInvoiceNumber: string | null;
  paymentStatus: "pending" | "collected_by_marketplace";
  trackingNumber: string;
  carrier: string;
  returnId: string;
  qcStatus: "Pending" | "Pass / Resalable" | "Damaged / Scrapped";
  qcApprover: string;
  outboundSyncStatus: "Idle" | "Queued" | "Failed (504 Timeout)" | "Simulated Acknowledged";
  outboundRetryCount: number;
  
  // Exception states
  unmappedErrorStatus: "unresolved" | "resolved";
  unmappedSkuAssigned: string;
  idempotencyReplayMessage: string | null;
  
  // Channels metrics
  channels: ChannelStats[];
  
  // Inventory
  inventory: ProductInventory[];
  
  // Orders collection (both scripted, incoming, and manual)
  orders: EcommerceOrder[];
  activeOrderId: string;

  // Active role filter
  selectedRole: "all" | "management" | "sales" | "warehouse" | "finance" | "checker" | "admin";
  
  // Active channel filter
  selectedChannel: "all" | "amazon" | "flipkart" | "myntra" | "marketplace4" | "shopify";
}

// Baseline fixtures defined in PDF 3 §5 & §6 with ecommerce warehouse & direct debit metadata
export const BASELINE_CHANNELS: ChannelStats[] = [
  {
    id: "amazon",
    name: "Amazon India",
    tag: "AMZ-IN",
    orders: 12,
    grossValue: 24000,
    returns: 1,
    stockSync: "Simulated OK",
    lastSyncTime: "2 mins ago",
    isDemo: true,
    warehouseName: "Amazon FBA Fulfillment Center",
    warehouseCode: "WH-AMAZON-FBA",
    commissionRate: 15,
    status: "connected",
    allocatedStock: 48,
    avgOrderValue: 2000,
    payoutPending: 19800,
  },
  {
    id: "flipkart",
    name: "Flipkart",
    tag: "FK-IN",
    orders: 8,
    grossValue: 16000,
    returns: 1,
    stockSync: "Simulated OK",
    lastSyncTime: "4 mins ago",
    isDemo: true,
    warehouseName: "Flipkart Fulfillment Hub",
    warehouseCode: "WH-FLIPKART-FC",
    commissionRate: 12,
    status: "connected",
    allocatedStock: 32,
    avgOrderValue: 2000,
    payoutPending: 13600,
  },
  {
    id: "myntra",
    name: "Myntra",
    tag: "MYN-IN",
    orders: 6,
    grossValue: 12000,
    returns: 0,
    stockSync: "Simulated OK",
    lastSyncTime: "8 mins ago",
    isDemo: true,
    warehouseName: "Myntra Omni / PPMP Center",
    warehouseCode: "WH-MYNTRA-PPMP",
    commissionRate: 18,
    status: "connected",
    allocatedStock: 24,
    avgOrderValue: 2000,
    payoutPending: 9480,
  },
  {
    id: "shopify",
    name: "Shopify Store",
    tag: "SH-DIRECT",
    orders: 3,
    grossValue: 6000,
    returns: 0,
    stockSync: "Simulated OK",
    lastSyncTime: "15 mins ago",
    isDemo: true,
    warehouseName: "Shopify Direct D2C Hub",
    warehouseCode: "WH-SHOPIFY-D2C",
    commissionRate: 2.5,
    status: "connected",
    allocatedStock: 20,
    avgOrderValue: 2000,
    payoutPending: 5700,
  },
  {
    id: "marketplace4",
    name: "Marketplace 4",
    tag: "MKT4",
    orders: 4,
    grossValue: 8000,
    returns: 0,
    stockSync: "Simulated OK",
    lastSyncTime: "12 mins ago",
    isDemo: true,
    warehouseName: "Partner Ecommerce Warehouse",
    warehouseCode: "WH-MKT4-HUB",
    commissionRate: 10,
    status: "connected",
    allocatedStock: 16,
    avgOrderValue: 2000,
    payoutPending: 7040,
  },
];

export const BASELINE_ORDERS: EcommerceOrder[] = [
  {
    id: "902-1845936-5435065",
    channel: "amazon",
    channelName: "Amazon India",
    externalOrderId: "902-1845936-5435065",
    customerName: "MFNIntegrationTestMerchant",
    customerCity: "Seattle, WA (US)",
    sku: "NABetaASINB00551Q3CS",
    productName: "B00551Q3CS [Card Book]",
    variant: "Standard",
    quantity: 1,
    unitPrice: 10,
    totalValue: 11.01,
    paymentMethod: "Prepaid",
    paymentStatus: "pending",
    fulfillmentRef: "FUL-AMZ-902",
    debitMovementNumber: "MOV-DR-902",
    ecommerceWarehouse: "WH-AMAZON-FBA",
    salesOrderId: "SO-AMZ-902",
    invoiceId: null,
    status: "allocated_debited",
    createdAt: "Today, 11:36 AM",
  },
  {
    id: "FK-ORD-8821",
    channel: "flipkart",
    channelName: "Flipkart",
    externalOrderId: "OD3091823901",
    customerName: "Ananya Sen",
    customerCity: "Kolkata, WB",
    sku: "AD-TS-WHT-M",
    productName: "Adventra Classic Tee",
    variant: "White / M",
    quantity: 1,
    unitPrice: 1000,
    totalValue: 1000,
    paymentMethod: "Prepaid",
    paymentStatus: "collected",
    fulfillmentRef: "FUL-FK-8821",
    debitMovementNumber: "MOV-DR-8821",
    ecommerceWarehouse: "WH-FLIPKART-FC",
    salesOrderId: "SO-FK-8821",
    invoiceId: "INV-FK-8821",
    status: "dispatched",
    carrier: "Delhivery Express",
    trackingNumber: "DLV99182310",
    createdAt: "Yesterday, 04:30 PM",
  },
  {
    id: "SH-ORD-4401",
    channel: "shopify",
    channelName: "Shopify Store",
    externalOrderId: "#SH-4401",
    customerName: "Rohan Verma",
    customerCity: "Bengaluru, KA",
    sku: "AD-PO-NVY-M",
    productName: "Adventra Pique Polo",
    variant: "Navy / M",
    quantity: 1,
    unitPrice: 1400,
    totalValue: 1400,
    paymentMethod: "COD",
    paymentStatus: "pending",
    fulfillmentRef: "FUL-SH-4401",
    debitMovementNumber: "MOV-DR-4401",
    ecommerceWarehouse: "WH-SHOPIFY-D2C",
    salesOrderId: "SO-SH-4401",
    invoiceId: null,
    status: "picked_packed",
    createdAt: "Yesterday, 02:15 PM",
  },
];

export const BASELINE_INVENTORY: ProductInventory[] = [
  {
    whizunikSku: "AD-TS-BLK-M",
    variant: "Black tee M",
    amazonSku: "AMZ-TS-BLK-M",
    shopifyVariant: "DEMO-SH-101",
    flipkartSku: "FK-TS-BLK-M",
    warehouse: "WH-DEMO",
    onHand: 20,
    reserved: 0,
    qcHold: 0,
    available: 20,
    allocatedByWarehouse: {
      "WH-AMAZON-FBA": 8,
      "WH-FLIPKART-FC": 6,
      "WH-SHOPIFY-D2C": 4,
      "WH-CENTRAL": 2,
    },
  },
  {
    whizunikSku: "AD-TS-BLK-L",
    variant: "Black tee L",
    amazonSku: "AMZ-TS-BLK-L",
    shopifyVariant: "DEMO-SH-102",
    warehouse: "WH-DEMO",
    onHand: 15,
    reserved: 0,
    qcHold: 0,
    available: 15,
    allocatedByWarehouse: {
      "WH-AMAZON-FBA": 6,
      "WH-FLIPKART-FC": 5,
      "WH-SHOPIFY-D2C": 2,
      "WH-CENTRAL": 2,
    },
  },
  {
    whizunikSku: "AD-TS-WHT-M",
    variant: "White tee M",
    amazonSku: "AMZ-TS-WHT-M",
    shopifyVariant: "DEMO-SH-103",
    warehouse: "WH-DEMO",
    onHand: 18,
    reserved: 0,
    qcHold: 0,
    available: 18,
    allocatedByWarehouse: {
      "WH-AMAZON-FBA": 6,
      "WH-FLIPKART-FC": 6,
      "WH-SHOPIFY-D2C": 4,
      "WH-CENTRAL": 2,
    },
  },
  {
    whizunikSku: "AD-TS-WHT-L",
    variant: "White tee L",
    amazonSku: "AMZ-TS-WHT-L",
    shopifyVariant: "DEMO-SH-104",
    warehouse: "WH-DEMO",
    onHand: 12,
    reserved: 0,
    qcHold: 0,
    available: 12,
    allocatedByWarehouse: {
      "WH-AMAZON-FBA": 4,
      "WH-FLIPKART-FC": 4,
      "WH-SHOPIFY-D2C": 2,
      "WH-CENTRAL": 2,
    },
  },
  {
    whizunikSku: "AD-PO-NVY-M",
    variant: "Navy polo M",
    amazonSku: "AMZ-PO-NVY-M",
    shopifyVariant: "DEMO-SH-105",
    warehouse: "WH-DEMO",
    onHand: 10,
    reserved: 0,
    qcHold: 0,
    available: 10,
    allocatedByWarehouse: {
      "WH-AMAZON-FBA": 4,
      "WH-FLIPKART-FC": 3,
      "WH-SHOPIFY-D2C": 2,
      "WH-CENTRAL": 1,
    },
  },
  {
    whizunikSku: "AD-PO-NVY-L",
    variant: "Navy polo L",
    amazonSku: "AMZ-PO-NVY-L",
    shopifyVariant: "DEMO-SH-106",
    warehouse: "WH-DEMO",
    onHand: 8,
    reserved: 0,
    qcHold: 0,
    available: 8,
    allocatedByWarehouse: {
      "WH-AMAZON-FBA": 3,
      "WH-FLIPKART-FC": 2,
      "WH-SHOPIFY-D2C": 2,
      "WH-CENTRAL": 1,
    },
  },
];

export const BASELINE_MAPPINGS: SkuMapping[] = [
  { id: "map-1", channel: "Amazon", channelSku: "AMZ-TS-BLK-M", listingId: "ASIN-B08123456", whizunikSku: "AD-TS-BLK-M", productName: "Adventra Classic Tee", variant: "Black / M", warehouse: "WH-DEMO", mrp: 1499, sellingPrice: 1000, hsn: "61091000", gstRate: 5, status: "Active", safetyStock: 2 },
  { id: "map-2", channel: "Shopify", channelSku: "DEMO-SH-101", listingId: "SH-VAR-99101", whizunikSku: "AD-TS-BLK-M", productName: "Adventra Classic Tee", variant: "Black / M", warehouse: "WH-DEMO", mrp: 1499, sellingPrice: 1000, hsn: "61091000", gstRate: 5, status: "Active", safetyStock: 0 },
  { id: "map-3", channel: "Flipkart", channelSku: "FK-TS-BLK-M", listingId: "FSN-TSH98721", whizunikSku: "AD-TS-BLK-M", productName: "Adventra Classic Tee", variant: "Black / M", warehouse: "WH-DEMO", mrp: 1499, sellingPrice: 1000, hsn: "61091000", gstRate: 5, status: "Active", safetyStock: 2 },
  { id: "map-4", channel: "Amazon", channelSku: "AMZ-TS-BLK-L", listingId: "ASIN-B08123457", whizunikSku: "AD-TS-BLK-L", productName: "Adventra Classic Tee", variant: "Black / L", warehouse: "WH-DEMO", mrp: 1499, sellingPrice: 1000, hsn: "61091000", gstRate: 5, status: "Active", safetyStock: 2 },
  { id: "map-5", channel: "Amazon", channelSku: "AMZ-TS-WHT-M", listingId: "ASIN-B08123458", whizunikSku: "AD-TS-WHT-M", productName: "Adventra Classic Tee", variant: "White / M", warehouse: "WH-DEMO", mrp: 1499, sellingPrice: 1000, hsn: "61091000", gstRate: 5, status: "Active", safetyStock: 2 },
  { id: "map-6", channel: "Amazon", channelSku: "AMZ-PO-NVY-M", listingId: "ASIN-B08123460", whizunikSku: "AD-PO-NVY-M", productName: "Adventra Pique Polo", variant: "Navy / M", warehouse: "WH-DEMO", mrp: 1999, sellingPrice: 1400, hsn: "61051000", gstRate: 5, status: "Active", safetyStock: 1 },
  { id: "map-7", channel: "Amazon", channelSku: "AMZ-UNKNOWN", listingId: "ASIN-UNMAPPED-99", whizunikSku: "UNMAPPED", productName: "Unmapped Listing Item", variant: "Unknown", warehouse: "WH-DEMO", mrp: 999, sellingPrice: 999, hsn: "61091000", gstRate: 5, status: "Error", safetyStock: 0 },
];

export const WORKFLOW_STEPS = [
  { step: 1, title: "Import Marketplace Order", subtitle: "Order arrives from platform API/webhook (DEMO-AMZ-1001, 2 units @ ₹1,000)", role: "Integration Engine" },
  { step: 2, title: "Match SKU & Live Inventory Check", subtitle: "AMZ-TS-BLK-M resolves to AD-TS-BLK-M; verifies stock availability", role: "Inventory System" },
  { step: 3, title: "Allocate to Channel WH & Debit Stock", subtitle: "Stock allocated to WH-AMAZON-FBA & instant debit entry MOV-DR-1001 recorded", role: "Automated Fulfillment" },
  { step: 4, title: "Warehouse Pick & Pack", subtitle: "Operator packs shipping carton with channel shipping label", role: "Warehouse Operator" },
  { step: 5, title: "Invoice & Dispatch Courier", subtitle: "Generate official INV-DEMO-1001, hand over package to BlueDart", role: "Finance & Logistics" },
  { step: 6, title: "Outbound Channel Sync", subtitle: "Sync tracking TRK-DEMO-1001 back to Amazon -> Simulated Acknowledged", role: "Integration Engine" },
  { step: 7, title: "Receive Customer Return", subtitle: "RET-DEMO-1001 for 1 unit received into QC hold quarantine ('Size issue')", role: "Warehouse QC Gate" },
  { step: 8, title: "QC Approval & Restock", subtitle: "QC approver signs 'Pass / Resalable'; releases 1 unit back to available", role: "Warehouse Approver" },
];

export const INITIAL_STATE: DemoWorkflowState = {
  currentStep: 0,
  isAutoPlaying: false,
  orderId: "DEMO-AMZ-1001",
  externalOrderId: "402-9812491-1029412",
  eventId: "EVT-1001",
  fulfillmentRef: "FUL-AMZ-1001",
  debitMovementNumber: "MOV-DR-1001",
  ecommerceWarehouse: "WH-AMAZON-FBA",
  soId: "SO-DEMO-1001",
  invoiceId: "INV-DEMO-1001",
  demoSoId: null,
  demoSoNumber: null,
  demoInvoiceId: null,
  demoInvoiceNumber: null,
  paymentStatus: "pending",
  trackingNumber: "TRK-DEMO-1001",
  carrier: "BlueDart Express",
  returnId: "RET-DEMO-1001",
  qcStatus: "Pending",
  qcApprover: "Sunil Verma (QC Lead)",
  outboundSyncStatus: "Idle",
  outboundRetryCount: 0,
  unmappedErrorStatus: "unresolved",
  unmappedSkuAssigned: "",
  idempotencyReplayMessage: null,
  channels: BASELINE_CHANNELS,
  inventory: BASELINE_INVENTORY,
  orders: BASELINE_ORDERS,
  activeOrderId: "902-1845936-5435065",
  selectedRole: "all",
  selectedChannel: "all",
};

const STORAGE_KEY = "adventra_marketplace_demo_state_v4";

export function loadDemoState(): DemoWorkflowState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: DemoWorkflowState = JSON.parse(raw);
      if (parsed.channels) {
        parsed.channels = parsed.channels.map((c) => ({
          ...c,
          name: c.name.replace(/\*/g, ""),
        }));
      }
      if (parsed.fulfillmentRef === undefined) parsed.fulfillmentRef = "FUL-AMZ-902";
      if (parsed.debitMovementNumber === undefined) parsed.debitMovementNumber = "MOV-DR-902";
      if (parsed.ecommerceWarehouse === undefined) parsed.ecommerceWarehouse = "WH-AMAZON-FBA";
      if (parsed.demoSoId === undefined) parsed.demoSoId = null;
      if (parsed.demoSoNumber === undefined) parsed.demoSoNumber = null;
      if (parsed.demoInvoiceId === undefined) parsed.demoInvoiceId = null;
      if (parsed.demoInvoiceNumber === undefined) parsed.demoInvoiceNumber = null;
      if (parsed.paymentStatus === undefined) parsed.paymentStatus = "pending";
      if (!parsed.orders || parsed.orders.length === 0) parsed.orders = BASELINE_ORDERS;
      if (!parsed.activeOrderId) parsed.activeOrderId = "902-1845936-5435065";
      return parsed;
    }
  } catch (err) {
    console.error("Failed to load demo state from localStorage", err);
  }
  return INITIAL_STATE;
}

export function saveDemoState(state: DemoWorkflowState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error("Failed to save demo state to localStorage", err);
  }
}

export function resetDemoState(): DemoWorkflowState {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
  return INITIAL_STATE;
}

// Compute the 6 Checkpoints ledger for the primary demonstration SKU (AD-TS-BLK-M)
// Flow: Check Inventory -> Allocate to Ecommerce WH -> Instant Debit Entry (drops on-hand immediately!)
export function getLedgerCheckpoints(currentStep: number): InventoryLedgerRow[] {
  return [
    {
      checkpoint: "Opening Baseline",
      stepNumber: 0,
      onHand: 20,
      reserved: 0,
      qcHold: 0,
      available: 20,
      actionNote: "Baseline day opening stock in Central Warehouse before order arrival",
      isCurrent: currentStep === 0,
      isPassed: currentStep >= 0,
    },
    {
      checkpoint: "Order Ingested & Stock Checked",
      stepNumber: 2,
      onHand: 20,
      reserved: 0,
      qcHold: 0,
      available: 20,
      actionNote: "DEMO-AMZ-1001 received. SKU matched (AD-TS-BLK-M), verified 20 units available.",
      isCurrent: currentStep === 1 || currentStep === 2,
      isPassed: currentStep >= 1,
    },
    {
      checkpoint: "Allocated to Channel & Debited",
      stepNumber: 3,
      onHand: currentStep >= 3 && currentStep < 7 ? 18 : currentStep >= 7 ? 19 : 20,
      reserved: 0,
      qcHold: 0,
      available: currentStep >= 3 ? 18 : 20,
      actionNote: "Allocated to WH-AMAZON-FBA. Debit entry MOV-DR-1001 logged. Physical On-Hand drops to 18!",
      isCurrent: currentStep === 3,
      isPassed: currentStep >= 3,
    },
    {
      checkpoint: "Picked & Packed",
      stepNumber: 4,
      onHand: currentStep >= 4 && currentStep < 7 ? 18 : currentStep >= 7 ? 19 : 20,
      reserved: 0,
      qcHold: 0,
      available: 18,
      actionNote: "Parcel packed with shipping label in Amazon bay. Stock already debited at allocation.",
      isCurrent: currentStep === 4,
      isPassed: currentStep >= 4,
    },
    {
      checkpoint: "Dispatched Courier",
      stepNumber: 5,
      onHand: currentStep >= 5 && currentStep < 7 ? 18 : currentStep >= 7 ? 19 : 20,
      reserved: 0,
      qcHold: 0,
      available: 18,
      actionNote: "INV-DEMO-1001 issued. Handed to BlueDart (TRK-DEMO-1001) and tracking synced to Amazon.",
      isCurrent: currentStep === 5 || currentStep === 6,
      isPassed: currentStep >= 5,
    },
    {
      checkpoint: "Return Received (QC Buffer)",
      stepNumber: 7,
      onHand: 19,
      reserved: 0,
      qcHold: currentStep === 7 ? 1 : 0,
      available: currentStep === 7 ? 18 : currentStep >= 8 ? 19 : 18,
      actionNote: "RET-DEMO-1001 received (1 unit). Physical stock is 19, held in QC quarantine buffer.",
      isCurrent: currentStep === 7,
      isPassed: currentStep >= 7,
    },
    {
      checkpoint: "QC Passed & Restocked",
      stepNumber: 8,
      onHand: 19,
      reserved: 0,
      qcHold: 0,
      available: 19,
      actionNote: "QC passed ('Pass / Resalable'). 1 unit restored to usable stock. Final Available = 19.",
      isCurrent: currentStep === 8,
      isPassed: currentStep >= 8,
    },
  ];
}
