/**
 * Shared dashboard API for marketplace channels (Shopify, AJIO).
 *
 *   GET  /channels/:channel/dashboard  status + orders + inventory + returns
 *   POST /channels/:channel/sync       start a sync in the background
 *
 * Data comes only from the channel's own API; until a channel is connected
 * the dashboard is empty and says what is missing.
 */
import { Router, Request, Response } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { config } from "../config.js";
import * as ChannelModel from "../models/marketplace-channel.js";
import { syncShopify } from "../services/shopify-api.service.js";

const router = Router();

const CHANNELS: ChannelModel.Channel[] = ["shopify", "ajio"];
const running = new Set<ChannelModel.Channel>();

function channelOf(req: Request, res: Response): ChannelModel.Channel | null {
  const ch = String(req.params.channel).toLowerCase() as ChannelModel.Channel;
  if (!CHANNELS.includes(ch)) {
    res.status(404).json({ success: false, error: "Unknown channel" });
    return null;
  }
  return ch;
}

function connection(channel: ChannelModel.Channel) {
  if (channel === "shopify") {
    const s = config.shopify;
    return {
      connected: s.isConfigured,
      account: s.storeDomain || null,
      canSync: s.isConfigured,
      notConnectedMessage:
        "Connect the Shopify store: create a custom app in Shopify admin (Settings → Apps → Develop apps) with read_orders, read_products, read_inventory and read_returns, then set SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN on the server.",
    };
  }
  const a = config.ajio;
  return {
    connected: a.isConfigured,
    account: a.sellerId || null,
    // No AJIO API client yet: AJIO shares API access and docs only after OMS approval.
    canSync: false,
    notConnectedMessage:
      "AJIO does not offer a public seller API. Access is given to approved OMS partners; orders, stock and returns will appear here once AJIO shares API access for WhizUnik.",
  };
}

router.get("/channels/:channel/dashboard", authMiddleware, async (req: Request, res: Response) => {
  try {
    const channel = channelOf(req, res);
    if (!channel) return;
    const [orders, inventory, returns, sync] = await Promise.all([
      ChannelModel.listOrders(channel),
      ChannelModel.listInventory(channel),
      ChannelModel.listReturns(channel),
      ChannelModel.getSyncState(channel),
    ]);
    const strip = <T extends Record<string, any>>({ pk, sk, gsi1pk, gsi1sk, entityType, ...rest }: T) => rest;
    res.json({
      success: true,
      status: { ...connection(channel), syncing: running.has(channel), ...sync },
      orders: orders.map(strip),
      inventory: inventory.map(strip),
      returns: returns.map(strip),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/channels/:channel/sync", authMiddleware, async (req: Request, res: Response) => {
  const channel = channelOf(req, res);
  if (!channel) return;
  const conn = connection(channel);
  if (!conn.canSync) return res.status(400).json({ success: false, error: conn.notConnectedMessage });
  if (running.has(channel)) return res.json({ success: true, started: false, message: "A sync is already running" });

  running.add(channel);
  const job = channel === "shopify" ? syncShopify() : Promise.reject(new Error("No sync for this channel"));
  job
    .catch((err) => console.error(`[${channel}] sync failed:`, err?.message))
    .finally(() => running.delete(channel));
  res.status(202).json({ success: true, started: true });
});

export default router;
