/**
 * Dispatch stock debit — the single place a dispatch turns reserved stock into a
 * stock OUT movement and records the dispatched quantity on its sales order.
 */
import * as db from "../dynamodb.js";
import * as Product from "../models/product.js";
import * as StockMovement from "../models/stock-movement.js";
import * as GoodsSO from "../models/goods-sales-order.js";
import * as Alert from "../models/alert.js";
import { exGstPrice } from "../lib/gst.js";
import { companyStockByProduct } from "./stock-availability.js";

/** Quantity that was debited for a line — the dispatched quantity. */
export function debitedQty(l: any): number {
  return Number(l.dispatchedQty) || 0;
}

/**
 * Low stock alerts: raise an alert when any SKU's stock is at or below its
 * minimum level (reorderLevel). At most one unread alert per SKU per day.
 * Returns how many alerts were raised.
 */
export async function checkAndAlertLowStock(clientId: string, productIds: string | string[]): Promise<number> {
  try {
    const ids = [...new Set((Array.isArray(productIds) ? productIds : [productIds]).filter(Boolean))];
    if (ids.length === 0) return 0;
    const products = (await Promise.all(ids.map((id) => Product.get(id).catch(() => null)))).filter(
      (p: any) => p && (Number(p.reorderLevel) || 0) > 0,
    ) as any[];
    if (products.length === 0) return 0;

    const [{ onHand, available }, existing] = await Promise.all([companyStockByProduct(), Alert.list()]);
    const today = db.todayDate();
    let raised = 0;
    for (const prod of products) {
      const reorderLevel = Number(prod.reorderLevel) || 0;
      const avail = available.get(prod.id) ?? 0;
      const oh = onHand.get(prod.id) ?? 0;
      if (avail > reorderLevel && oh > reorderLevel) continue;
      const alreadySentToday = existing.some(
        (a: any) =>
          a.type === "low_stock" &&
          a.productId === prod.id &&
          !a.isRead &&
          String(a.createdAt ?? "").slice(0, 10) === today,
      );
      if (alreadySentToday) continue;
      await Alert.create({
        clientId: prod.clientId ?? clientId,
        productId: prod.id,
        type: "low_stock",
        severity: avail <= 0 ? "critical" : "warning",
        message: `Low Stock Alert: ${prod.name} (SKU: ${prod.sku || "—"}) is at ${avail} units available (${oh} on-hand), which is at or below the minimum reorder level of ${reorderLevel}. Replenishment recommended.`,
      });
      raised++;
    }
    return raised;
  } catch (err) {
    console.error("  ⚠ checkAndAlertLowStock failed:", err);
    return 0;
  }
}

/** Debit inventory for every dispatch line and fold dispatched qty into the SO. */
export async function debitSalesOrder(clientId: string, dispatch: any, so: any) {
  const unitByProduct = new Map<string, string>(
    (so.lines ?? []).map(
      (l: any) =>
        [String(l.productId), String(l.unit ?? "unit")] as [string, string],
    ),
  );
  for (const ln of dispatch.lines ?? []) {
    const qty = debitedQty(ln);
    if (!(qty > 0)) continue;
    // Catalogue prices include GST; stock moves at the ex-GST cost.
    let unitCost = exGstPrice(ln.unitPrice, ln.gstRate);
    try {
      const prod = await Product.get(ln.productId);
      if (prod && prod.unitCost != null)
        unitCost = exGstPrice(prod.unitCost, prod.gstRate ?? ln.gstRate);
    } catch {
      /* keep the dispatch snapshot */
    }
    await StockMovement.create({
      clientId,
      productId: ln.productId,
      direction: "out",
      itemName: ln.name,
      sku: ln.sku,
      quantity: qty,
      unit: unitByProduct.get(ln.productId) || ln.unit || "unit",
      unitCost,
      warehouse: dispatch.warehouse || null,
      reason: "Dispatch",
      linkedDocumentType: "Dispatch",
      linkedDocumentNumber: dispatch.dispatchNumber,
      status: "confirmed",
      notes:
        `Dispatch ${dispatch.dispatchNumber} for SO ${dispatch.soNumber ?? ""}`.trim(),
      movementDate: dispatch.dispatchDate,
      goodsDispatchId: dispatch.id,
      salesOrderId: dispatch.goodsSalesOrderId,
      createdById: dispatch.dispatchedById,
      createdByName: dispatch.dispatchedBy,
      confirmedById: dispatch.debitedBy,
      confirmedByName: dispatch.debitedBy,
      confirmedAt: dispatch.debitedAt,
      sourceLocationId: dispatch.sourceLocationId || null,
      destinationLocationId: dispatch.destinationLocationId || null,
      dispatchType: dispatch.dispatchType || null,
      channel: dispatch.channel || null,
    });
  }
  await GoodsSO.recordDispatch(
    dispatch.goodsSalesOrderId,
    (dispatch.lines ?? []).map((l: any) => ({
      productId: l.productId,
      dispatchedQty: debitedQty(l),
    })),
  );
  // One low-stock pass for the whole dispatch (fire-and-forget).
  void checkAndAlertLowStock(clientId, (dispatch.lines ?? []).map((ln: any) => ln.productId));
}
