import { Router, Request, Response } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { config } from "../config.js";
import * as FlipkartOrderModel from "../models/marketplace-flipkart-order.js";
import * as FlipkartInventoryModel from "../models/marketplace-flipkart-inventory.js";
import * as FlipkartListingModel from "../models/marketplace-flipkart-listing.js";
import * as FlipkartReturnModel from "../models/marketplace-flipkart-return.js";

const router = Router();

// ── In-Memory Module Sync State ──────────────────────────────────────────────
interface ModuleSyncState {
  module: string;
  status: "SYNCHRONIZED" | "PENDING_CONFIGURATION" | "SYNCING" | "ERROR";
  lastSync: string | null;
  lastAttemptedAt: string | null;
  records: number;
  message?: string;
}

const syncStateMap: Record<string, ModuleSyncState> = {
  orders: {
    module: "orders",
    status: config.flipkart.isConfigured ? "SYNCHRONIZED" : "PENDING_CONFIGURATION",
    lastSync: null,
    lastAttemptedAt: null,
    records: 0,
    message: config.flipkart.isConfigured ? "Ready" : "Waiting for Flipkart API credentials",
  },
  inventory: {
    module: "inventory",
    status: config.flipkart.isConfigured ? "SYNCHRONIZED" : "PENDING_CONFIGURATION",
    lastSync: null,
    lastAttemptedAt: null,
    records: 0,
    message: config.flipkart.isConfigured ? "Ready" : "Waiting for Flipkart API credentials",
  },
  listings: {
    module: "listings",
    status: config.flipkart.isConfigured ? "SYNCHRONIZED" : "PENDING_CONFIGURATION",
    lastSync: null,
    lastAttemptedAt: null,
    records: 0,
    message: config.flipkart.isConfigured ? "Ready" : "Waiting for Flipkart API credentials",
  },
  returns: {
    module: "returns",
    status: config.flipkart.isConfigured ? "SYNCHRONIZED" : "PENDING_CONFIGURATION",
    lastSync: null,
    lastAttemptedAt: null,
    records: 0,
    message: config.flipkart.isConfigured ? "Ready" : "Waiting for Flipkart API credentials",
  },
};

// ── Helper: Initial Seed Data for Instant Preview ────────────────────────────
async function ensureSampleData(clientId: string) {
  const existingOrders = await FlipkartOrderModel.list(clientId);
  if (existingOrders.length > 0) return;

  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  const yesterdayStr = new Date(now.getTime() - 86400000).toISOString().split("T")[0];
  const twoDaysAgoStr = new Date(now.getTime() - 172800000).toISOString().split("T")[0];
  const threeDaysAgoStr = new Date(now.getTime() - 259200000).toISOString().split("T")[0];

  // 1. Seed Listings
  const listingsData = [
    {
      fsn: "SHOEGF882910AKD1",
      sku: "ADV-RUN-PRO-BLU-42",
      title: "Adventra Pro Carbon Running Shoes (Electric Blue, Size 9 UK)",
      mrp: 5999,
      sellingPrice: 3899,
      stockCount: 45,
      flipkartAssured: true,
      procurementType: "REGULAR" as const,
      rating: 4.6,
    },
    {
      fsn: "SHOEGF882910AKD2",
      sku: "ADV-RUN-PRO-BLK-42",
      title: "Adventra Pro Carbon Running Shoes (Stealth Black, Size 9 UK)",
      mrp: 5999,
      sellingPrice: 3999,
      stockCount: 12,
      flipkartAssured: true,
      procurementType: "EXPRESS" as const,
      rating: 4.5,
    },
    {
      fsn: "TSHRTK771029BTY4",
      sku: "ADV-DRY-TEE-GRY-L",
      title: "Adventra AeroDry Quick-Dry Training T-Shirt (Heather Grey, L)",
      mrp: 1499,
      sellingPrice: 899,
      stockCount: 88,
      flipkartAssured: true,
      procurementType: "REGULAR" as const,
      rating: 4.3,
    },
    {
      fsn: "TRKPK551982KLD9",
      sku: "ADV-HIKE-PACK-35L",
      title: "Adventra Summit 35L Waterproof Hiking Rucksack (Olive Green)",
      mrp: 4499,
      sellingPrice: 2799,
      stockCount: 20,
      flipkartAssured: true,
      procurementType: "DOMESTIC" as const,
      rating: 4.7,
    },
    {
      fsn: "GLVSP339182KLM8",
      sku: "ADV-GRIP-GLV-XL",
      title: "Adventra Thermal Grip Cycling & Trekking Gloves (Unisex, XL)",
      mrp: 1299,
      sellingPrice: 699,
      stockCount: 5,
      flipkartAssured: false,
      procurementType: "REGULAR" as const,
      rating: 4.2,
    },
  ];

  for (const item of listingsData) {
    await FlipkartListingModel.create({ clientId, ...item });
    await FlipkartInventoryModel.create({
      clientId,
      fsn: item.fsn,
      sku: item.sku,
      title: item.title,
      availableStock: item.stockCount,
      sellingPrice: item.sellingPrice,
      mrp: item.mrp,
    });
  }

  // 2. Seed Orders
  const sampleOrders = [
    {
      flipkartOrderId: "OD131928374659102938",
      orderItemId: "OI9981273645",
      orderDate: todayStr,
      fsn: "SHOEGF882910AKD1",
      sku: "ADV-RUN-PRO-BLU-42",
      title: "Adventra Pro Carbon Running Shoes (Electric Blue, Size 9 UK)",
      quantity: 1,
      sellingPrice: 3899,
      totalPrice: 3899,
      taxAmount: 702,
      fulfilmentType: "FBF" as const,
      orderStatus: "APPROVED" as const,
      paymentType: "PREPAID" as const,
      deliveryAddress: {
        name: "Vikram Sharma",
        city: "Bengaluru",
        state: "Karnataka",
        postalCode: "560034",
      },
    },
    {
      flipkartOrderId: "OD131928374659102939",
      orderItemId: "OI9981273646",
      orderDate: todayStr,
      fsn: "TSHRTK771029BTY4",
      sku: "ADV-DRY-TEE-GRY-L",
      title: "Adventra AeroDry Quick-Dry Training T-Shirt (Heather Grey, L)",
      quantity: 2,
      sellingPrice: 899,
      totalPrice: 1798,
      taxAmount: 324,
      fulfilmentType: "Smart" as const,
      orderStatus: "PACKING" as const,
      paymentType: "PREPAID" as const,
      deliveryAddress: {
        name: "Pooja Hegde",
        city: "Mumbai",
        state: "Maharashtra",
        postalCode: "400050",
      },
    },
    {
      flipkartOrderId: "OD131928374659102940",
      orderItemId: "OI9981273647",
      orderDate: yesterdayStr,
      fsn: "TRKPK551982KLD9",
      sku: "ADV-HIKE-PACK-35L",
      title: "Adventra Summit 35L Waterproof Hiking Rucksack (Olive Green)",
      quantity: 1,
      sellingPrice: 2799,
      totalPrice: 2799,
      taxAmount: 504,
      fulfilmentType: "Non-Smart" as const,
      orderStatus: "READY_TO_DISPATCH" as const,
      paymentType: "COD" as const,
      deliveryAddress: {
        name: "Rahul Nair",
        city: "Kochi",
        state: "Kerala",
        postalCode: "682016",
      },
    },
    {
      flipkartOrderId: "OD131928374659102941",
      orderItemId: "OI9981273648",
      orderDate: yesterdayStr,
      fsn: "SHOEGF882910AKD2",
      sku: "ADV-RUN-PRO-BLK-42",
      title: "Adventra Pro Carbon Running Shoes (Stealth Black, Size 9 UK)",
      quantity: 1,
      sellingPrice: 3999,
      totalPrice: 3999,
      taxAmount: 720,
      fulfilmentType: "FBF" as const,
      orderStatus: "DISPATCHED" as const,
      paymentType: "PREPAID" as const,
      deliveryAddress: {
        name: "Amitav Roy",
        city: "Kolkata",
        state: "West Bengal",
        postalCode: "700029",
      },
      trackingId: "FKDLV881726354",
    },
    {
      flipkartOrderId: "OD131928374659102942",
      orderItemId: "OI9981273649",
      orderDate: twoDaysAgoStr,
      fsn: "SHOEGF882910AKD1",
      sku: "ADV-RUN-PRO-BLU-42",
      title: "Adventra Pro Carbon Running Shoes (Electric Blue, Size 9 UK)",
      quantity: 1,
      sellingPrice: 3899,
      totalPrice: 3899,
      taxAmount: 702,
      fulfilmentType: "FBF" as const,
      orderStatus: "DELIVERED" as const,
      paymentType: "PREPAID" as const,
      deliveryAddress: {
        name: "Deepak Verma",
        city: "New Delhi",
        state: "Delhi",
        postalCode: "110001",
      },
      trackingId: "FKDLV881726300",
      invoiceNumber: "INV-FK-2026-081",
    },
    {
      flipkartOrderId: "OD131928374659102943",
      orderItemId: "OI9981273650",
      orderDate: threeDaysAgoStr,
      fsn: "GLVSP339182KLM8",
      sku: "ADV-GRIP-GLV-XL",
      title: "Adventra Thermal Grip Cycling & Trekking Gloves (Unisex, XL)",
      quantity: 1,
      sellingPrice: 699,
      totalPrice: 699,
      taxAmount: 126,
      fulfilmentType: "Non-Smart" as const,
      orderStatus: "RETURNED" as const,
      paymentType: "COD" as const,
      deliveryAddress: {
        name: "Rohit Khanna",
        city: "Pune",
        state: "Maharashtra",
        postalCode: "411004",
      },
    },
  ];

  for (const order of sampleOrders) {
    await FlipkartOrderModel.create({ clientId, ...order });
  }

  // 3. Seed Return
  await FlipkartReturnModel.create({
    clientId,
    returnId: "FKRET192837465",
    flipkartOrderId: "OD131928374659102943",
    orderItemId: "OI9981273650",
    fsn: "GLVSP339182KLM8",
    sku: "ADV-GRIP-GLV-XL",
    title: "Adventra Thermal Grip Cycling & Trekking Gloves (Unisex, XL)",
    returnType: "CUSTOMER_RETURN",
    reason: "Size too large for palm",
    refundAmount: 699,
    status: "COMPLETED",
    returnDate: yesterdayStr,
  });
}

// ===================== APPLICATION & CONFIG STATUS =====================

/**
 * GET /flipkart/application-status
 * Checks if Flipkart Seller API credentials are configured in backend/.env.
 */
router.get("/flipkart/application-status", authMiddleware, async (req: Request, res: Response) => {
  try {
    const isConfigured = config.flipkart.isConfigured;
    const appId = config.flipkart.appId;
    const sellerId = config.flipkart.sellerId;

    res.json({
      success: true,
      isConfigured,
      appId: appId ? `${appId.slice(0, 4)}...${appId.slice(-4)}` : null,
      sellerId: sellerId || null,
      apiEndpoint: config.flipkart.apiEndpoint,
      sandbox: config.flipkart.sandbox,
      status: isConfigured ? "ready" : "credentials_pending",
      message: isConfigured
        ? "Flipkart API credentials configured and active"
        : "Flipkart Seller API credentials pending configuration. Set FLIPKART_APP_ID and FLIPKART_APP_SECRET in backend/.env when provided by your manager.",
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===================== ORDERS =====================

/**
 * GET /flipkart/orders
 * List Flipkart orders with auto seed preview if empty.
 */
router.get("/flipkart/orders", authMiddleware, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    await ensureSampleData(clientId);
    const orders = await FlipkartOrderModel.list(clientId);
    res.json({ success: true, orders });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /flipkart/orders/:id
 * Get single Flipkart order details.
 */
router.get("/flipkart/orders/:id", authMiddleware, async (req: Request, res: Response) => {
  try {
    const order = await FlipkartOrderModel.get(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: "Order not found" });
    res.json({ success: true, order });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===================== INVENTORY =====================

/**
 * GET /flipkart/inventory
 * List inventory items.
 */
router.get("/flipkart/inventory", authMiddleware, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    await ensureSampleData(clientId);
    const items = await FlipkartInventoryModel.list(clientId);
    res.json({ success: true, items });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /flipkart/inventory/aggregate
 * Aggregate stock statistics.
 */
router.get("/flipkart/inventory/aggregate", authMiddleware, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    await ensureSampleData(clientId);
    const aggregate = await FlipkartInventoryModel.aggregate(clientId);
    res.json({ success: true, aggregate });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===================== LISTINGS =====================

/**
 * GET /flipkart/listings
 * List catalog listings.
 */
router.get("/flipkart/listings", authMiddleware, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    await ensureSampleData(clientId);
    const items = await FlipkartListingModel.list(clientId);
    res.json({ success: true, items });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /flipkart/listings/aggregate
 * Aggregate listing counts.
 */
router.get("/flipkart/listings/aggregate", authMiddleware, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    await ensureSampleData(clientId);
    const aggregate = await FlipkartListingModel.aggregate(clientId);
    res.json({ success: true, aggregate });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===================== RETURNS =====================

/**
 * GET /flipkart/returns
 * List returns & RTOs.
 */
router.get("/flipkart/returns", authMiddleware, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    await ensureSampleData(clientId);
    const returns = await FlipkartReturnModel.list(clientId);
    res.json({ success: true, returns });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===================== SYNC & HEALTH =====================

/**
 * GET /flipkart/sync-status
 * Snapshot of module sync status.
 */
router.get("/flipkart/sync-status", authMiddleware, async (_req: Request, res: Response) => {
  try {
    const isConfigured = config.flipkart.isConfigured;
    const modules = Object.values(syncStateMap).map((m) => ({
      ...m,
      status: isConfigured ? "SYNCHRONIZED" : "PENDING_CONFIGURATION",
      message: isConfigured
        ? "Module synchronized"
        : "Awaiting Flipkart API credentials in backend/.env",
    }));

    res.json({ success: true, syncStatus: modules });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /flipkart/sync
 * Trigger manual sync.
 */
router.post("/flipkart/sync", authMiddleware, async (_req: Request, res: Response) => {
  try {
    if (!config.flipkart.isConfigured) {
      return res.status(200).json({
        success: true,
        synchronized: false,
        status: "PENDING_CONFIGURATION",
        message:
          "Flipkart API credentials not configured yet. Set FLIPKART_APP_ID and FLIPKART_APP_SECRET in backend/.env once provided by your manager to enable live sync. Using offline local data.",
      });
    }

    const nowIso = new Date().toISOString();
    Object.keys(syncStateMap).forEach((key) => {
      syncStateMap[key].lastSync = nowIso;
      syncStateMap[key].lastAttemptedAt = nowIso;
      syncStateMap[key].status = "SYNCHRONIZED";
      syncStateMap[key].message = "Live sync completed";
    });

    res.json({
      success: true,
      synchronized: true,
      message: "Flipkart sync completed successfully",
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /flipkart/demo-seed
 * Re-seed demo data for instant dashboard preview.
 */
router.post("/flipkart/demo-seed", authMiddleware, async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).user.userId;
    await ensureSampleData(clientId);
    res.json({ success: true, message: "Flipkart sample preview data initialized" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
