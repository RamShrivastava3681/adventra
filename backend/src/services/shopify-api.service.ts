/**
 * Shopify Admin API (GraphQL) client and sync for the Shopify dashboard.
 *
 * Auth: custom-app Admin API access token in the X-Shopify-Access-Token header.
 * Endpoint: https://{store}.myshopify.com/admin/api/{version}/graphql.json
 *
 * Sync pulls orders (last SHOPIFY_SYNC_LOOKBACK_DAYS days), product variant
 * stock, and refunds / returns, and stores them as channel records.
 */
import { config } from "../config.js";
import * as Channel from "../models/marketplace-channel.js";

type Json = any;

const TIMEOUT_MS = 30_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ShopifyError extends Error {}

/** One GraphQL request, with a wait-and-retry when Shopify throttles us. */
export async function graphql(query: string, variables: Record<string, unknown> = {}): Promise<Json> {
  const { storeDomain, accessToken, apiVersion } = config.shopify;
  if (!storeDomain || !accessToken) {
    throw new ShopifyError("Shopify is not connected: set SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN.");
  }
  const url = `https://${storeDomain}/admin/api/${apiVersion}/graphql.json`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 429) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    const text = await res.text();
    let body: Json = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    if (res.status === 401 || res.status === 403) {
      throw new ShopifyError(`Shopify refused the access token (HTTP ${res.status}). Check the token and app scopes.`);
    }
    if (!res.ok) throw new ShopifyError(`Shopify API error HTTP ${res.status}: ${text.slice(0, 300)}`);
    const errors: Json[] = body?.errors ?? [];
    if (errors.some((e) => e?.extensions?.code === "THROTTLED")) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (errors.length) throw new ShopifyError(errors.map((e) => e?.message ?? String(e)).join("; "));
    return body?.data;
  }
  throw new ShopifyError("Shopify kept throttling the request; try the sync again in a minute.");
}

// ── Queries ──────────────────────────────────────────────────────────────────
// Page sizes keep each query under Shopify's 1,000-point cost limit.

const ORDERS_QUERY = /* GraphQL */ `
  query Orders($after: String, $query: String) {
    orders(first: 20, after: $after, sortKey: CREATED_AT, reverse: true, query: $query) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        createdAt
        cancelledAt
        displayFinancialStatus
        displayFulfillmentStatus
        paymentGatewayNames
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        totalRefundedSet { shopMoney { amount } }
        shippingAddress { city province }
        lineItems(first: 15) { nodes { sku name quantity currentQuantity originalTotalSet { shopMoney { amount } } } }
        fulfillments(first: 3) { displayStatus trackingInfo(first: 1) { number company } }
        refunds(first: 5) { id createdAt note totalRefundedSet { shopMoney { amount } } }
      }
    }
  }
`;

const RETURNS_QUERY = /* GraphQL */ `
  query OrderReturns($after: String, $query: String) {
    orders(first: 25, after: $after, sortKey: CREATED_AT, reverse: true, query: $query) {
      pageInfo { hasNextPage endCursor }
      nodes { id name createdAt returns(first: 5) { nodes { id name status } } }
    }
  }
`;

const VARIANTS_QUERY = /* GraphQL */ `
  query Variants($after: String) {
    productVariants(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id sku title displayName price inventoryQuantity product { title status } }
    }
  }
`;

// ── Normalisation ────────────────────────────────────────────────────────────

const money = (set: Json): number => Number(set?.shopMoney?.amount ?? 0) || 0;

/** Where a Shopify order is in the flow. */
export function shopifyStage(o: Json): Channel.ChannelStage {
  const financial = String(o.displayFinancialStatus ?? "").toUpperCase();
  const fulfilment = String(o.displayFulfillmentStatus ?? "").toUpperCase();
  const fulfilments: Json[] = o.fulfillments ?? [];
  if (o.cancelledAt) return "Cancelled";
  if (financial === "REFUNDED") return "Returned";
  if (fulfilments.some((f) => String(f.displayStatus).toUpperCase() === "DELIVERED")) return "Delivered";
  if (fulfilment === "FULFILLED") return "Shipped";
  if (["PARTIALLY_FULFILLED", "IN_PROGRESS", "SCHEDULED", "ON_HOLD", "REQUEST_DECLINED"].includes(fulfilment)) return "Processing";
  return "New";
}

const numericId = (gid: string) => String(gid).split("/").pop() ?? String(gid);

export function toChannelOrder(o: Json) {
  const tracking = (o.fulfillments ?? []).flatMap((f: Json) => f.trackingInfo ?? [])[0];
  return {
    orderId: numericId(o.id),
    orderNumber: String(o.name ?? numericId(o.id)),
    orderDate: String(o.createdAt),
    stage: shopifyStage(o),
    rawStatus: [o.displayFinancialStatus, o.displayFulfillmentStatus, o.cancelledAt ? "CANCELLED" : null]
      .filter(Boolean)
      .join(" · "),
    paymentStatus: o.displayFinancialStatus ?? null,
    paymentMethod: (o.paymentGatewayNames ?? []).join(", ") || null,
    currency: o.currentTotalPriceSet?.shopMoney?.currencyCode ?? "INR",
    value: money(o.currentTotalPriceSet),
    refundedAmount: money(o.totalRefundedSet),
    items: (o.lineItems?.nodes ?? []).map((l: Json) => ({
      sku: String(l.sku ?? ""),
      title: String(l.name ?? ""),
      quantity: Number(l.currentQuantity ?? l.quantity ?? 0),
      amount: money(l.originalTotalSet),
    })),
    city: o.shippingAddress?.city ?? null,
    state: o.shippingAddress?.province ?? null,
    courier: tracking?.company ?? null,
    trackingNumber: tracking?.number ?? null,
  };
}

// ── Sync ─────────────────────────────────────────────────────────────────────

const MAX_ORDER_PAGES = 100; // 2,000 orders per sync
const MAX_VARIANT_PAGES = 50; // 5,000 variants per sync

export async function syncShopify(): Promise<Channel.ChannelSyncState> {
  const since = new Date(Date.now() - config.shopify.syncLookbackDays * 86400000).toISOString().slice(0, 10);
  const query = `created_at:>=${since}`;
  const counts = { orders: 0, inventory: 0, returns: 0 };
  const orderNames = new Map<string, string>();
  const notes: string[] = [];

  try {
    // Orders + refunds
    let after: string | null = null;
    for (let page = 0; page < MAX_ORDER_PAGES; page++) {
      const data = await graphql(ORDERS_QUERY, { after, query });
      for (const o of data.orders.nodes as Json[]) {
        const order = toChannelOrder(o);
        orderNames.set(order.orderId, order.orderNumber);
        await Channel.saveOrder("shopify", order);
        counts.orders++;
        for (const r of (o.refunds ?? []) as Json[]) {
          await Channel.saveReturn("shopify", {
            returnId: `refund-${numericId(r.id)}`,
            orderId: order.orderId,
            orderNumber: order.orderNumber,
            type: "Refund",
            status: "Refunded",
            reason: r.note ?? null,
            amount: money(r.totalRefundedSet),
            createdAt: String(r.createdAt),
          });
          counts.returns++;
        }
      }
      if (!data.orders.pageInfo.hasNextPage) break;
      after = data.orders.pageInfo.endCursor;
    }

    // Returns (needs the read_returns scope; skipped with a note if missing)
    try {
      after = null;
      for (let page = 0; page < MAX_ORDER_PAGES; page++) {
        const data = await graphql(RETURNS_QUERY, { after, query });
        for (const o of data.orders.nodes as Json[]) {
          for (const r of (o.returns?.nodes ?? []) as Json[]) {
            await Channel.saveReturn("shopify", {
              returnId: `return-${numericId(r.id)}`,
              orderId: numericId(o.id),
              orderNumber: String(o.name),
              type: "Return",
              status: String(r.status ?? "OPEN"),
              reason: null,
              amount: 0,
              // Shopify's Return has no creation date here; the order date keeps it stable across syncs.
              createdAt: String(o.createdAt),
            });
            counts.returns++;
          }
        }
        if (!data.orders.pageInfo.hasNextPage) break;
        after = data.orders.pageInfo.endCursor;
      }
    } catch (err: any) {
      notes.push(`Returns not synced (${err.message}). Add the read_returns scope to the Shopify app to include them.`);
    }

    // Stock per variant
    after = null;
    for (let page = 0; page < MAX_VARIANT_PAGES; page++) {
      const data = await graphql(VARIANTS_QUERY, { after });
      for (const v of data.productVariants.nodes as Json[]) {
        await Channel.saveInventory("shopify", {
          itemId: numericId(v.id),
          sku: String(v.sku ?? ""),
          title: String(v.displayName ?? v.product?.title ?? v.title ?? ""),
          location: "All locations",
          quantity: v.inventoryQuantity ?? null,
          price: v.price != null ? Number(v.price) : null,
          active: String(v.product?.status ?? "ACTIVE").toUpperCase() === "ACTIVE",
        });
        counts.inventory++;
      }
      if (!data.productVariants.pageInfo.hasNextPage) break;
      after = data.productVariants.pageInfo.endCursor;
    }

    const state: Channel.ChannelSyncState = {
      lastSyncAt: new Date().toISOString(),
      lastSyncOk: true,
      lastSyncMessage:
        `Synced ${counts.orders} orders, ${counts.inventory} variants and ${counts.returns} refunds/returns.` +
        (notes.length ? ` ${notes.join(" ")}` : ""),
      counts,
    };
    await Channel.saveSyncState("shopify", state);
    return state;
  } catch (err: any) {
    const state: Channel.ChannelSyncState = {
      lastSyncAt: new Date().toISOString(),
      lastSyncOk: false,
      lastSyncMessage: String(err?.message ?? err),
      counts,
    };
    await Channel.saveSyncState("shopify", state);
    return state;
  }
}
