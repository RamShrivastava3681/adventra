/**
 * doc-impact — pure display helpers for DocumentStatusStrip.
 * No storage, no workflow change. Maps internal codes to human labels
 * and derives inventory / cash impact text from fields the list
 * endpoints already return.
 */

export type InventoryImpact =
  | "No stock movement"
  | "Stock reserved"
  | "Stock credited"
  | "Stock debited"
  | "Location transfer only";

export type CashImpact =
  | "No cash impact"
  | "Expected receipt"
  | "Expected payment"
  | "Actual receipt recorded"
  | "Actual payment recorded";

const PRETTY: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  sent_for_approval: "Sent for approval",
  checker_pending: "Sent for approval",
  pending_approval: "Sent for approval",
  approved: "Approved",
  confirmed: "Customer Accepted",
  customer_accepted: "Customer Accepted",
  client_acceptance: "Customer acceptance pending",
  create_proforma: "Proforma required",
  create_invoice: "Final invoice required",
  record_irn: "Record IRN",
  prepare_dispatch: "Prepare dispatch details",
  details_submitted: "Dispatch details submitted",
  generate_ewb: "Record E-way Bill",
  ready_for_dispatch: "Ready to Dispatch",
  confirm_dispatch: "Confirm physical dispatch",
  dispatched: "Dispatched",
  partially_dispatched: "Partially dispatched",
  fully_dispatched: "Fully dispatched",
  delivered: "Delivered",
  paid: "Payment received",
  partially_paid: "Partially paid",
  payment_confirmation: "Payment confirmation pending",
  rejected: "Rejected",
  cancelled: "Cancelled",
  overdue: "Overdue",
  returned: "Returned",
};

export function statusLabel(_docType: string, code: string | null | undefined): string {
  if (!code) return "Draft";
  const key = String(code).toLowerCase();
  if (PRETTY[key]) return PRETTY[key];
  // Fallback: humanise snake_case, never show raw code with underscores.
  return String(code)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ownerLabel(ownerRole: string | null | undefined, assignedUser?: string | null): string {
  if (assignedUser) return assignedUser;
  if (!ownerRole) return "Unassigned";
  const map: Record<string, string> = {
    sales: "Sales",
    procurement: "Procurement",
    checker: "Checker",
    finance: "Finance",
    treasury: "Treasury (Finance)",
    warehouse: "Warehouse",
    admin: "Admin",
    factor_admin: "Admin",
  };
  const key = String(ownerRole).toLowerCase();
  return map[key] ?? String(ownerRole).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function inventoryImpact(docType: string, doc: any): InventoryImpact {
  const t = String(docType).toLowerCase();
  if (t === "dispatch" || t === "goods_dispatch") {
    if (doc?.stockDebited === true || doc?.stock_debited === true) return "Stock debited";
    if (doc?.dispatchType === "stock_transfer" || doc?.dispatch_type === "stock_transfer")
      return "Location transfer only";
    const st = String(doc?.status ?? "").toLowerCase();
    if (st === "details_submitted" || st === "ready_for_dispatch") return "Stock reserved";
    if (String(doc?.inventory_status ?? "").toLowerCase() === "reserved") return "Stock reserved";
    return "No stock movement";
  }
  if (t === "grn" || t === "goods_receipt") {
    if (doc?.stockCredited === true || doc?.stock_credited === true) return "Stock credited";
    return "No stock movement";
  }
  if (t === "sales_order" || t === "goods_sales_order") {
    const s = String(doc?.stockStatus ?? doc?.stock_status ?? "").toLowerCase();
    if (s === "reserved") return "Stock reserved";
    return "No stock movement";
  }
  return "No stock movement";
}

export function cashImpact(docType: string, doc: any): CashImpact {
  const t = String(docType).toLowerCase();
  if (t === "sales_order" || t === "goods_sales_order") return "No cash impact";
  if (t === "proforma") {
    const amt = Number(doc?.amountReceived ?? doc?.amount_received ?? 0);
    if (amt > 0) return "Actual receipt recorded";
    return "Expected receipt";
  }
  if (t === "sales_invoice" || t === "invoice") {
    const ps = String(doc?.paymentStatus ?? doc?.payment_status ?? doc?.status ?? "").toLowerCase();
    if (ps === "paid") return "Actual receipt recorded";
    if (Number(doc?.amountReceived ?? doc?.amount_received ?? 0) > 0) return "Actual receipt recorded";
    return "Expected receipt";
  }
  if (t === "purchase_invoice" || t === "purchase_order") {
    const ps = String(doc?.paymentStatus ?? doc?.payment_status ?? "").toLowerCase();
    if (ps === "paid") return "Actual payment recorded";
    if (Number(doc?.amountPaid ?? doc?.amount_paid ?? 0) > 0) return "Actual payment recorded";
    return "Expected payment";
  }
  if (t === "payment" || t === "payment_receipt") {
    const st = String(doc?.status ?? "").toLowerCase();
    if (st === "verified" || st === "paid" || st === "approved") return "Actual receipt recorded";
    return "Expected receipt";
  }
  return "No cash impact";
}

/** Warning-only invoice-qty check (does NOT block). Returns message or null. */
export function invoiceQtyWarning(
  invoiceLines: Array<{ productId?: string; quantity?: number }>,
  dispatchLines: Array<{ productId?: string; dispatchedQty?: number; quantity?: number }>,
): string | null {
  if (!invoiceLines?.length || !dispatchLines?.length) return null;
  const inv = new Map<string, number>();
  for (const l of invoiceLines) {
    const id = String((l as any).productId ?? (l as any).product_id ?? "");
    if (!id) continue;
    inv.set(id, (inv.get(id) ?? 0) + Number((l as any).quantity ?? 0));
  }
  for (const l of dispatchLines) {
    const id = String((l as any).productId ?? (l as any).product_id ?? "");
    if (!id || !inv.has(id)) continue;
    const qty = Number((l as any).dispatchedQty ?? (l as any).quantity ?? 0);
    if (qty > (inv.get(id) ?? 0)) {
      return `Dispatch qty (${qty}) exceeds invoice qty (${inv.get(id)}) for a line — please verify`;
    }
  }
  return null;
}
