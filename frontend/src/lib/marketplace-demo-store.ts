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
  variant: string;
  amazonSku: string;
  shopifyVariant: string;
  flipkartSku?: string;
  warehouse: string;
  onHand: number;
  reserved: number;
  qcHold: number;
  available: number;
}

export interface DemoWorkflowState {
  currentStep: number; // 0 to 8
  isAutoPlaying: boolean;
  orderId: string;
  externalOrderId: string;
  eventId: string;
  soId: string;
  invoiceId: string;
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
  
  // Active role filter
  selectedRole: "all" | "management" | "sales" | "warehouse" | "finance" | "checker" | "admin";
  
  // Active channel filter
  selectedChannel: "all" | "amazon" | "flipkart" | "myntra" | "marketplace4" | "shopify";
}

// Baseline fixtures defined in PDF 3 §5 & §6
export const BASELINE_CHANNELS: ChannelStats[] = [
  { id: "amazon", name: "Amazon", tag: "AMZ-IN", orders: 12, grossValue: 24000, returns: 1, stockSync: "Simulated OK", lastSyncTime: "2 mins ago", isDemo: true },
  { id: "flipkart", name: "Flipkart", tag: "FK-IN", orders: 8, grossValue: 16000, returns: 1, stockSync: "Simulated OK", lastSyncTime: "4 mins ago", isDemo: true },
  { id: "myntra", name: "Myntra", tag: "MYN-IN", orders: 6, grossValue: 12000, returns: 0, stockSync: "Simulated OK", lastSyncTime: "8 mins ago", isDemo: true },
  { id: "marketplace4", name: "Marketplace 4", tag: "MKT4", orders: 4, grossValue: 8000, returns: 0, stockSync: "Simulated OK", lastSyncTime: "12 mins ago", isDemo: true },
  { id: "shopify", name: "Shopify Store", tag: "SH-DIRECT", orders: 3, grossValue: 6000, returns: 0, stockSync: "Simulated OK", lastSyncTime: "15 mins ago", isDemo: true },
];

export const BASELINE_INVENTORY: ProductInventory[] = [
  { whizunikSku: "AD-TS-BLK-M", variant: "Black tee M", amazonSku: "AMZ-TS-BLK-M", shopifyVariant: "DEMO-SH-101", flipkartSku: "FK-TS-BLK-M", warehouse: "WH-DEMO", onHand: 20, reserved: 0, qcHold: 0, available: 20 },
  { whizunikSku: "AD-TS-BLK-L", variant: "Black tee L", amazonSku: "AMZ-TS-BLK-L", shopifyVariant: "DEMO-SH-102", warehouse: "WH-DEMO", onHand: 15, reserved: 0, qcHold: 0, available: 15 },
  { whizunikSku: "AD-TS-WHT-M", variant: "White tee M", amazonSku: "AMZ-TS-WHT-M", shopifyVariant: "DEMO-SH-103", warehouse: "WH-DEMO", onHand: 18, reserved: 0, qcHold: 0, available: 18 },
  { whizunikSku: "AD-TS-WHT-L", variant: "White tee L", amazonSku: "AMZ-TS-WHT-L", shopifyVariant: "DEMO-SH-104", warehouse: "WH-DEMO", onHand: 12, reserved: 0, qcHold: 0, available: 12 },
  { whizunikSku: "AD-PO-NVY-M", variant: "Navy polo M", amazonSku: "AMZ-PO-NVY-M", shopifyVariant: "DEMO-SH-105", warehouse: "WH-DEMO", onHand: 10, reserved: 0, qcHold: 0, available: 10 },
  { whizunikSku: "AD-PO-NVY-L", variant: "Navy polo L", amazonSku: "AMZ-PO-NVY-L", shopifyVariant: "DEMO-SH-106", warehouse: "WH-DEMO", onHand: 8, reserved: 0, qcHold: 0, available: 8 },
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
  { step: 1, title: "Import Marketplace Order", subtitle: "Load mock event EVT-1001 (DEMO-AMZ-1001, 2 units @ ₹1,000)", role: "Sales & Integration" },
  { step: 2, title: "Match SKU & Validate", subtitle: "AMZ-TS-BLK-M resolves to AD-TS-BLK-M in WH-DEMO", role: "Integration Engine" },
  { step: 3, title: "Reserve Stock & Create SO", subtitle: "Reserve 2 units; create sales order SO-DEMO-1001", role: "Inventory & Sales" },
  { step: 4, title: "Warehouse Pick & Pack", subtitle: "Open warehouse task; confirm 2 picked, 2 packed", role: "Warehouse Operator" },
  { step: 5, title: "Invoice & Dispatch", subtitle: "Generate INV-DEMO-1001 (DEMO WATERMARK), dispatch via BlueDart", role: "Warehouse & Finance" },
  { step: 6, title: "Outbound Channel Sync", subtitle: "Queue tracking TRK-DEMO-1001 to Amazon -> Simulated Acknowledged", role: "Integration Engine" },
  { step: 7, title: "Receive Customer Return", subtitle: "RET-DEMO-1001 for 1 unit received into QC hold ('Size issue')", role: "Warehouse QC Gate" },
  { step: 8, title: "QC Approval & Restock", subtitle: "QC approver signs 'Pass / Resalable'; releases 1 unit back to available", role: "Warehouse Approver" },
];

export const INITIAL_STATE: DemoWorkflowState = {
  currentStep: 0,
  isAutoPlaying: false,
  orderId: "DEMO-AMZ-1001",
  externalOrderId: "402-9812491-1029412",
  eventId: "EVT-1001",
  soId: "SO-DEMO-1001",
  invoiceId: "INV-DEMO-1001",
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
  selectedRole: "all",
  selectedChannel: "all",
};

const STORAGE_KEY = "adventra_marketplace_demo_state_v1";

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
export function getLedgerCheckpoints(currentStep: number): InventoryLedgerRow[] {
  return [
    {
      checkpoint: "Opening Baseline",
      stepNumber: 0,
      onHand: 20,
      reserved: 0,
      qcHold: 0,
      available: 20,
      actionNote: "Baseline day opening stock in WH-DEMO before transaction",
      isCurrent: currentStep === 0,
      isPassed: currentStep >= 0,
    },
    {
      checkpoint: "Order Reserved",
      stepNumber: 3,
      onHand: 20,
      reserved: currentStep >= 3 && currentStep < 5 ? 2 : 0,
      qcHold: 0,
      available: currentStep >= 3 && currentStep < 5 ? 18 : currentStep < 3 ? 20 : 18,
      actionNote: "Order DEMO-AMZ-1001 reserved 2 units. On-hand intact, Available = 18",
      isCurrent: currentStep === 3,
      isPassed: currentStep >= 3,
    },
    {
      checkpoint: "Picked & Packed",
      stepNumber: 4,
      onHand: 20,
      reserved: currentStep >= 4 && currentStep < 5 ? 2 : 0,
      qcHold: 0,
      available: 18,
      actionNote: "Warehouse task verified (2 picked, 2 packed). Stock deduction deferred",
      isCurrent: currentStep === 4,
      isPassed: currentStep >= 4,
    },
    {
      checkpoint: "Dispatched",
      stepNumber: 5,
      onHand: currentStep >= 5 && currentStep < 7 ? 18 : currentStep >= 7 ? 19 : 20,
      reserved: 0,
      qcHold: 0,
      available: 18,
      actionNote: "INV-DEMO-1001 issued. Physical debit applied: On-hand drops to 18",
      isCurrent: currentStep === 5 || currentStep === 6,
      isPassed: currentStep >= 5,
    },
    {
      checkpoint: "Return Received",
      stepNumber: 7,
      onHand: 19,
      reserved: 0,
      qcHold: currentStep === 7 ? 1 : 0,
      available: currentStep === 7 ? 18 : currentStep >= 8 ? 19 : 18,
      actionNote: "RET-DEMO-1001 received (1 unit). Physical stock is 19, held in QC buffer",
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
      actionNote: "QC passed ('Pass / Resalable'). 1 unit restored to usable stock. Final Available = 19",
      isCurrent: currentStep === 8,
      isPassed: currentStep >= 8,
    },
  ];
}
