/**
 * Stock availability — on-hand, reserved and available stock per product, derived
 * from the confirmed stock-movement ledger and live sales orders. Shared by the
 * Sales / Warehouse routes and the marketplace fulfilment pipeline.
 */
import * as StockMovement from "../models/stock-movement.js";
import * as StockLocation from "../models/stock-location.js";
import * as GoodsSO from "../models/goods-sales-order.js";

/** Available stock per product at a location (confirmed credits − confirmed debits). */
export async function stockBalanceByProduct(
  clientId: string,
  locationId: string,
): Promise<Map<string, number>> {
  const movements = await StockMovement.list(clientId);
  // Legacy movements created before location tracking (no source/destination)
  // count toward the Central Warehouse so old credit entries remain
  // dispatchable after the location model was introduced.
  let locationIsCentral = false;
  try {
    const loc = await StockLocation.get(locationId);
    locationIsCentral = !!loc && (loc as any).locationType === "central_warehouse";
  } catch {
    locationIsCentral = false;
  }
  const balance = new Map<string, number>();
  for (const m of movements) {
    if (!m.productId || m.status !== "confirmed") continue;
    const isLegacy = !m.sourceLocationId && !m.destinationLocationId;
    if (isLegacy) {
      if (!locationIsCentral) continue;
    } else {
      if (m.direction === "in" && m.destinationLocationId !== locationId) continue;
      if (m.direction === "out" && m.sourceLocationId !== locationId) continue;
    }
    balance.set(
      m.productId,
      (balance.get(m.productId) ?? 0) +
        (m.direction === "in" ? m.quantity : -m.quantity),
    );
  }
  return balance;
}

/**
 * Compute the total reserved quantity per product across all live sales orders
 * (warehouse-signed-off through partially dispatched) for a client, optionally
 * limited to one dispatch location. Excludes cancelled SOs and fully dispatched SOs.
 * For partially dispatched orders, only the remaining un-dispatched portion
 * (orderedQty - dispatchedQty) counts as reserved.
 * Optionally excludes a specific SO ID (e.g. when checking that SO's own lines).
 */
export async function reservedStockByProduct(
  clientId: string,
  excludeSoId?: string,
  locationId?: string,
): Promise<Map<string, number>> {
  const sos = await GoodsSO.list(clientId);
  const reservedMap = new Map<string, number>();

  for (const so of sos) {
    if (!so || so.id === excludeSoId || so.status === "cancelled") continue;
    // Stock is held from warehouse sign-off until dispatch. The status decides,
    // not stockStatus: an order rejected back to draft / warehouse_pending
    // keeps stockStatus "reserved" but must release its stock.
    const isReserved = ["checker_pending", "warehouse_approved", "confirmed", "partially_dispatched"].includes(so.status);
    if (!isReserved) continue;
    // Orders shipping from another warehouse don't hold this location's stock.
    if (locationId && so.dispatchLocation && so.dispatchLocation !== locationId) continue;

    for (const l of so.lines ?? []) {
      const pid = String(l.productId || (l as any).product_id || "");
      if (!pid) continue;
      const ordered = Number(l.orderedQty ?? (l as any).ordered_qty ?? 0);
      const dispatched = Number(l.dispatchedQty ?? (l as any).dispatched_qty ?? 0);
      const remainingReserved = Math.max(0, ordered - dispatched);
      if (remainingReserved > 0) {
        reservedMap.set(pid, (reservedMap.get(pid) ?? 0) + remainingReserved);
      }
    }
  }

  return reservedMap;
}

/**
 * Available sellable stock per product (On-hand physical stock − Reserved stock).
 * Prevents overselling by ensuring confirmed orders lock their stock.
 */
export async function availableStockByProduct(
  clientId: string,
  locationId?: string,
  excludeSoId?: string,
): Promise<{
  onHand: Map<string, number>;
  reserved: Map<string, number>;
  available: Map<string, number>;
}> {
  let locId = locationId;
  if (!locId) {
    try {
      const def = await StockLocation.getDefaultLocation(clientId);
      locId = def?.id;
    } catch {
      /* ignore */
    }
  }

  let onHand = new Map<string, number>();
  if (locId) {
    onHand = await stockBalanceByProduct(clientId, locId);
  } else {
    const movements = await StockMovement.list(clientId);
    for (const m of movements) {
      if (!m.productId || m.status !== "confirmed") continue;
      onHand.set(
        m.productId,
        (onHand.get(m.productId) ?? 0) + (m.direction === "in" ? m.quantity : -m.quantity),
      );
    }
  }

  const reserved = await reservedStockByProduct(clientId, excludeSoId, locId);
  const available = new Map<string, number>();

  for (const [pid, oh] of onHand.entries()) {
    const res = reserved.get(pid) ?? 0;
    available.set(pid, Math.max(0, oh - res));
  }

  return { onHand, reserved, available };
}

/**
 * Auto-check stock availability on a Sales Order.
 * Validates whether sufficient unreserved stock is available for every line item.
 */
export async function assertSOStockAvailable(
  clientId: string,
  so: any,
  locationId?: string,
): Promise<{
  sufficient: boolean;
  shortLines: Array<{
    productId: string;
    name: string;
    required: number;
    available: number;
    onHand: number;
    reservedByOthers: number;
  }>;
}> {
  const { onHand, reserved, available } = await availableStockByProduct(
    clientId,
    locationId || so.dispatchLocation,
    so.id,
  );

  const shortLines: Array<{
    productId: string;
    name: string;
    required: number;
    available: number;
    onHand: number;
    reservedByOthers: number;
  }> = [];

  for (const l of so.lines ?? []) {
    const pid = String(l.productId || (l as any).product_id || "");
    if (!pid) continue;
    const ordered = Number(l.orderedQty ?? (l as any).ordered_qty ?? 0);
    const dispatched = Number(l.dispatchedQty ?? (l as any).dispatched_qty ?? 0);
    const needed = Math.max(0, ordered - dispatched);
    if (needed <= 0) continue;

    const avail = available.get(pid) ?? 0;
    const oh = onHand.get(pid) ?? 0;
    const res = reserved.get(pid) ?? 0;

    if (avail < needed) {
      shortLines.push({
        productId: pid,
        name: l.name || "Product",
        required: needed,
        available: avail,
        onHand: oh,
        reservedByOthers: res,
      });
    }
  }

  return {
    sufficient: shortLines.length === 0,
    shortLines,
  };
}

/**
 * Company-wide stock per product for low-stock alerts (shared-database mode:
 * every location and user): confirmed on-hand movements, minus what live
 * sales orders still hold.
 */
export async function companyStockByProduct(): Promise<{ onHand: Map<string, number>; available: Map<string, number> }> {
  const [movements, sos] = await Promise.all([StockMovement.list(), GoodsSO.list()]);
  const onHand = new Map<string, number>();
  for (const m of movements) {
    if (!m.productId || m.status !== "confirmed") continue;
    onHand.set(m.productId, (onHand.get(m.productId) ?? 0) + (m.direction === "in" ? m.quantity : -m.quantity));
  }
  const reserved = new Map<string, number>();
  for (const so of sos as any[]) {
    if (!["checker_pending", "warehouse_approved", "confirmed", "partially_dispatched"].includes(so?.status)) continue;
    for (const l of so.lines ?? []) {
      if (!l.productId) continue;
      const remaining = Math.max(0, (Number(l.orderedQty) || 0) - (Number(l.dispatchedQty) || 0));
      if (remaining > 0) reserved.set(l.productId, (reserved.get(l.productId) ?? 0) + remaining);
    }
  }
  const available = new Map<string, number>();
  for (const [pid, oh] of onHand) available.set(pid, Math.max(0, oh - (reserved.get(pid) ?? 0)));
  return { onHand, available };
}
