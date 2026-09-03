import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export const MOVEMENT_STATUSES = ["draft", "confirmed", "cancelled"] as const;

/**
 * Inventory movement — the atomic record of stock moving into (credit / "in")
 * or out of (debit / "out") a warehouse.
 *
 * Lifecycle:
 *   draft     → manual entries start here; NO stock impact.
 *   confirmed → only confirmed movements affect live stock (live stock =
 *               Σ confirmed credits − Σ confirmed debits). System actions
 *               (confirmed GRN, dispatched sales invoice) create movements
 *               already confirmed.
 *   cancelled → cancelled before/after confirm. Live stock only counts
 *               CONFIRMED movements, so a cancelled entry simply drops out
 *               of the balance — no reversal entry is created (cancelling a
 *               confirmed +100 credit leaves the balance at 0).
 *
 * Legacy records created before the status field existed are normalized to
 * "confirmed" by list/get (they already affected stock).
 */
export interface StockMovement {
  pk: string; sk: string; gsi1pk: string; gsi1sk: string; gsi2pk: string; gsi2sk: string;
  entityType: "StockMovement";
  id: string; clientId: string; productId: string | null;
  /** System-generated movement number (MOV-XXXXXXXX). */
  movementNumber: string;
  /** "in" (Credit) or "out" (Debit). */
  direction: "in" | "out"; itemName: string; sku: string | null;
  quantity: number; unit: string; unitCost: number | null;
  /** Delivery warehouse / store (legacy text field). */
  warehouse: string | null;
  /** Movement reason: Goods receipt / Dispatch / Customer return / Supplier return / Damage / Opening stock / Stock adjustment / Samples · internal use. */
  reason: string | null;
  /** Linked document type — GRN / Dispatch / PO / Purchase Invoice / Sales Invoice / Return / Adjustment. */
  linkedDocumentType: string | null;
  /** Linked document number (e.g. GRN-XXXX, PO-XXXX, invoice number). */
  linkedDocumentNumber: string | null;
  status: "draft" | "confirmed" | "cancelled";
  /** Attribution — system or the signing-in user. */
  createdById: string | null;
  createdByName: string | null;
  confirmedById: string | null;
  confirmedByName: string | null;
  confirmedAt: string | null;
  cancelledById: string | null;
  cancelledByName: string | null;
  cancelledAt: string | null;
  notes: string | null; movementDate: string;
  invoiceId: string | null; purchaseInvoiceId: string | null;
  /** GRN that created this stock-in movement (goods receipts). */
  goodsReceiptId: string | null;
  /** Goods PO this movement belongs to (GRN-created movements). */
  purchaseOrderId: string | null;
  /** Dispatch note that created this stock-out movement (sales orders). */
  goodsDispatchId: string | null;
  /** Goods sales order this movement belongs to (dispatch-created movements). */
  salesOrderId: string | null;

  // ── Location-based inventory fields ──
  /** Source location ID for stock-out movements (dispatch, transfer out, etc.). */
  sourceLocationId: string | null;
  /** Destination location ID for stock-in movements (GRN, transfer in, return, etc.). */
  destinationLocationId: string | null;
  /** Dispatch type: customer_sale, marketplace_sale, pos_sale, stock_transfer, customer_return, return_to_supplier, damage_sample_adjustment */
  dispatchType: string | null;
  /** For stock transfers: links the source movement to the destination movement. */
  transferId: string | null;
  /** Channel: Amazon, Flipkart, etc. For marketplace sales. */
  channel: string | null;
  /** For customer returns: customer name or ID. */
  customerName: string | null;

  createdAt: string; updatedAt: string;
}

/** Legacy records (pre-status) already moved stock → treat them as confirmed. */
function normalize(m: any): StockMovement {
  return {
    ...m,
    status: (MOVEMENT_STATUSES as readonly string[]).includes(m.status) ? m.status : "confirmed",
  };
}

export async function list(clientId?: string) {
  // Whole-portfolio read (staff accounts) — falls back to the full scan.
  if (!clientId) return listAll();
  const allItems: any[] = [];
  let lastKey: Record<string, any> | undefined;
  do {
    const { items, lastKey: nextKey } = await db.queryByGSI1(clientId, {
      entityType: "StockMovement",
      limit: 1000,
      reverse: true,
      exclusiveStartKey: lastKey,
    });
    allItems.push(...items);
    lastKey = nextKey;
  } while (lastKey);
  return allItems.map(normalize) as StockMovement[];
}

export async function listAll() {
  const items = await db.scanByType("StockMovement", { limit: 2000 });
  return (items as any[]).map(normalize) as StockMovement[];
}

export async function get(id: string) {
  const item = await db.getItem(`STOCK_MOVEMENT#${id}`);
  return item ? normalize(item) : null;
}

export async function create(data: Partial<StockMovement> & { clientId: string; direction: "in" | "out"; itemName: string; quantity: number }) {
  const id = uuid(); const now = db.nowISO();
  const item: StockMovement = {
    pk: `STOCK_MOVEMENT#${id}`, sk: `STOCK_MOVEMENT#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`, gsi1sk: `StockMovement#${now}`,
    gsi2pk: "StockMovement", gsi2sk: `STOCK_MOVEMENT#${id}`,
    entityType: "StockMovement", id, clientId: data.clientId,
    movementNumber: data.movementNumber || `MOV-${id.slice(0, 8).toUpperCase()}`,
    productId: data.productId || null, direction: data.direction,
    itemName: data.itemName, sku: data.sku || null,
    quantity: data.quantity, unit: data.unit || "unit",
    unitCost: data.unitCost != null ? data.unitCost : null,
    warehouse: data.warehouse || null,
    reason: data.reason || null,
    linkedDocumentType: data.linkedDocumentType || null,
    linkedDocumentNumber: data.linkedDocumentNumber || null,
    status: (MOVEMENT_STATUSES as readonly string[]).includes(data.status as string) ? data.status as StockMovement["status"] : "confirmed",
    createdById: data.createdById || null,
    createdByName: data.createdByName || null,
    confirmedById: data.confirmedById || null,
    confirmedByName: data.confirmedByName || null,
    confirmedAt: data.confirmedAt || null,
    cancelledById: data.cancelledById || null,
    cancelledByName: data.cancelledByName || null,
    cancelledAt: data.cancelledAt || null,
    notes: data.notes || null, movementDate: data.movementDate || db.todayDate(),
    invoiceId: data.invoiceId || null, purchaseInvoiceId: data.purchaseInvoiceId || null,
    goodsReceiptId: data.goodsReceiptId || null,
    purchaseOrderId: data.purchaseOrderId || null,
    goodsDispatchId: data.goodsDispatchId || null,
    salesOrderId: data.salesOrderId || null,
    // Location-based fields
    sourceLocationId: data.sourceLocationId || null,
    destinationLocationId: data.destinationLocationId || null,
    dispatchType: data.dispatchType || null,
    transferId: data.transferId || null,
    channel: data.channel || null,
    customerName: data.customerName || null,
    createdAt: now, updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

/**
 * Atomic draft → confirmed flip. Returns the updated item, or null if it was
 * already confirmed/cancelled — callers must only treat the movement as
 * confirmed when this returns a value (concurrent confirms can't double-count).
 */
export async function confirm(id: string, confirmedById: string, confirmedByName: string) {
  return db.updateItemIf(
    `STOCK_MOVEMENT#${id}`,
    `STOCK_MOVEMENT#${id}`,
    {
      status: "confirmed",
      confirmedById,
      confirmedByName,
      confirmedAt: db.nowISO(),
      updatedAt: db.nowISO(),
    },
    "#status = :draft",
    { ":draft": "draft" },
    true,
    { "#status": "status" },
  ) as Promise<StockMovement | null>;
}

/**
 * Atomic → cancelled flip. Returns the updated item, or null if already
 * cancelled. Callers decide whether a reversal entry is needed based on the
 * prior status (confirmed = already affected stock).
 *
 * NOTE: the condition only checks the status — the old
 * `attribute_not_exists(cancelledAt)` guard never passed because create()
 * stores `cancelledAt: null` (a NULL DynamoDB attribute still exists),
 * silently breaking every cancel.
 */
export async function cancel(id: string, cancelledById: string, cancelledByName: string) {
  return db.updateItemIf(
    `STOCK_MOVEMENT#${id}`,
    `STOCK_MOVEMENT#${id}`,
    {
      status: "cancelled",
      cancelledById,
      cancelledByName,
      cancelledAt: db.nowISO(),
      updatedAt: db.nowISO(),
    },
    "#status <> :cancelled",
    { ":cancelled": "cancelled" },
    true,
    { "#status": "status" },
  ) as Promise<StockMovement | null>;
}

export async function remove(id: string) {
  return db.deleteItem(`STOCK_MOVEMENT#${id}`);
}

/**
 * Edit a manual movement (drafts or confirmed). System-created movements are
 * rejected by the route — callers here only ever touch user-editable fields.
 * When the product changes the caller re-snapshots itemName/sku/unit from the
 * catalogue before calling update().
 */
export async function update(id: string, updates: Partial<StockMovement>) {
  const allowed = [
    "productId", "itemName", "sku", "unit", "direction", "quantity", "unitCost",
    "warehouse", "reason", "linkedDocumentType", "linkedDocumentNumber",
    "notes", "movementDate",
    // Location fields
    "sourceLocationId", "destinationLocationId", "dispatchType", "transferId", "channel", "customerName",
  ];
  const patch: Record<string, any> = {};
  for (const key of allowed) {
    if ((updates as any)[key] !== undefined) patch[key] = (updates as any)[key];
  }
  patch.updatedAt = db.nowISO();
  return db.updateItem(`STOCK_MOVEMENT#${id}`, `STOCK_MOVEMENT#${id}`, patch);
}

export async function getByProduct(clientId: string, productId: string) {
  const all = await list(clientId);
  return all.filter((m) => m.productId === productId);
}

/**
 * Delete every movement that belongs to a product (used when the catalogue
 * product is removed, so inventory entries don't linger as orphans). Scoped to
 * the client — other accounts' records are never touched.
 */
export async function removeByProduct(clientId: string, productId: string) {
  const all = await listAll();
  const targets = all.filter((m) => m.clientId === clientId && m.productId === productId);
  for (const m of targets) {
    await db.deleteItem(`STOCK_MOVEMENT#${m.id}`);
  }
  return targets.length;
}

/** Live stock for a product = confirmed credits − confirmed debits. */
export async function getBalance(productId: string, allMovements: StockMovement[]) {
  return allMovements
    .filter((m) => m.productId === productId && m.status === "confirmed")
    .reduce((sum, m) => sum + (m.direction === "in" ? m.quantity : -m.quantity), 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Location-aware stock balance functions
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get stock balance for a specific product at a specific location.
 * Stock at location = Σ confirmed IN to location − Σ confirmed OUT from location.
 */
export function getBalanceAtLocation(
  productId: string,
  locationId: string,
  movements: StockMovement[]
): number {
  return movements
    .filter(
      (m) =>
        m.productId === productId &&
        m.status === "confirmed" &&
        ((m.direction === "in" && m.destinationLocationId === locationId) ||
         (m.direction === "out" && m.sourceLocationId === locationId))
    )
    .reduce(
      (sum, m) => sum + (m.direction === "in" ? m.quantity : -m.quantity),
      0
    );
}

/**
 * Get stock breakdown by location for a specific product.
 * Returns Map<locationId, {locationName, quantity}>.
 */
export function getStockBreakdownByLocation(
  productId: string,
  movements: StockMovement[],
  locations: Array<{ id: string; name: string }>
): Map<string, { locationName: string; quantity: number }> {
  const locMap = new Map(locations.map((l) => [l.id, l.name]));
  const result = new Map<string, { locationName: string; quantity: number }>();

  for (const loc of locations) {
    const qty = getBalanceAtLocation(productId, loc.id, movements);
    result.set(loc.id, { locationName: loc.name, quantity: qty });
  }

  return result;
}

/**
 * Get total company stock for a product across all locations.
 * Total = Σ confirmed IN − Σ confirmed OUT (ignoring transfers between locations).
 *
 * NOTE: For transfers, the OUT from source cancels the IN to destination in total.
 * But we want Total Company Stock to NOT change on transfers.
 * The simplest way: just compute confirmed IN − confirmed OUT across ALL locations.
 * Since a transfer creates both IN (to dest) and OUT (from source), they cancel out.
 */
export function getTotalCompanyStock(
  productId: string,
  movements: StockMovement[]
): number {
  return movements
    .filter((m) => m.productId === productId && m.status === "confirmed")
    .reduce(
      (sum, m) => sum + (m.direction === "in" ? m.quantity : -m.quantity),
      0
    );
}

/**
 * Validate that a location has sufficient stock before a stock-out transaction.
 */
export function validateLocationStock(
  productId: string,
  locationId: string,
  requestedQty: number,
  movements: StockMovement[]
): { valid: boolean; available: number; error?: string } {
  const available = getBalanceAtLocation(productId, locationId, movements);
  if (available < requestedQty) {
    return {
      valid: false,
      available,
      error: `Insufficient stock at this location. Available: ${available}, Requested: ${requestedQty}.`,
    };
  }
  return { valid: true, available };
}

/**
 * Get all movements for a specific transfer (source + destination pair).
 */
export function getTransferMovements(
  transferId: string,
  movements: StockMovement[]
): StockMovement[] {
  return movements.filter((m) => m.transferId === transferId && m.status === "confirmed");
}

/**
 * Compute forecast demand movements only.
 * Demand = customer_sale + marketplace_sale + pos_sale - accepted_customer_returns.
 * Explicitly excludes: GRN, transfers, return_to_supplier, damage, sample, adjustment, transit.
 *
 * Legacy movements without dispatchType: only count outbound as demand
 * (matches the engine's isDemandMovement in forecast-engine.ts).
 */
export function isDemandMovement(m: StockMovement): boolean {
  if (m.status !== "confirmed") return false;

  if (m.dispatchType) {
    if (m.dispatchType === "customer_sale" || m.dispatchType === "marketplace_sale" || m.dispatchType === "pos_sale") {
      return m.direction === "out";
    }
    if (m.dispatchType === "customer_return") {
      return m.direction === "in";
    }
    return false;
  }

  const reason = String(m.reason ?? "").trim().toLowerCase();

  if (m.direction === "out") return true;
  if (m.direction === "in" && reason.includes("customer return")) return true;

  return false;
}
