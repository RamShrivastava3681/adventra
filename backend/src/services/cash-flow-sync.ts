import * as ExpectedInflow from "../models/expected-inflow.js";
import type { ExpectedInflow as InflowType, InflowStatus } from "../models/expected-inflow.js";
import * as ExpectedOutflow from "../models/expected-outflow.js";
import type { ExpectedOutflow as OutflowType, OutflowStatus } from "../models/expected-outflow.js";
import * as Debtor from "../models/debtor.js";
import * as Vendor from "../models/vendor.js";

// ---------------------------------------------------------------------------
// Sales Invoice → Expected Inflow sync
// ---------------------------------------------------------------------------

/**
 * When a sales invoice is created, create or update the linked expected inflow.
 * Uses deterministic linking via source="invoice" + sourceId=invoiceId.
 */
export async function syncInvoiceToInflow(invoice: any): Promise<void> {
  const clientId = invoice.clientId;
  const invoiceId = invoice.id;

  // Compute outstanding amount: grandTotal − advanceDeducted − amountReceived
  const grandTotal = Number(invoice.grandTotal) || Number(invoice.amount) || 0;
  const advanceDeducted = Number(invoice.advanceDeducted) || 0;
  const amountReceived = Number(invoice.amountReceived) || 0;
  const outstanding = Math.max(0, grandTotal - advanceDeducted - amountReceived);

  if (outstanding <= 0) return; // Fully paid or zero-value invoice

  // Determine expected date: use promisedPaymentDate if set, else dueDate
  const expectedDate =
    invoice.promisedPaymentDate || invoice.dueDate || invoice.issueDate;

  if (!expectedDate) return; // No date → can't forecast

  // Resolve customer name from debtor
  let customerName: string | null = null;
  if (invoice.debtorId) {
    try {
      const debtor = await Debtor.get(invoice.debtorId);
      customerName = debtor?.name || null;
    } catch {
      // Swallow — don't block invoice creation
    }
  }

  // Upsert: find existing inflow for this invoice, or create new
  const existing = await ExpectedInflow.findBySource(clientId, "invoice", invoiceId);

  if (existing) {
    // Update existing inflow if invoice details changed
    const updates: Partial<InflowType> = {};
    if (existing.amount !== outstanding) updates.amount = outstanding;
    if (existing.expectedDate !== expectedDate) updates.expectedDate = expectedDate;
    if (customerName && existing.customerName !== customerName) updates.customerName = customerName;

    // If invoice is now paid, mark inflow as received
    const invoiceStatus = invoice.status;
    if (invoiceStatus === "paid") {
      updates.status = "RECEIVED";
    } else if (invoiceStatus === "partially_paid") {
      updates.status = "PARTIALLY_RECEIVED";
    }

    if (Object.keys(updates).length > 0) {
      await ExpectedInflow.update(existing.id, updates);
    }
  } else {
    // Determine status from invoice status
    let status: InflowStatus = "EXPECTED";
    if (invoice.status === "paid") status = "RECEIVED";
    else if (invoice.status === "partially_paid") status = "PARTIALLY_RECEIVED";

    await ExpectedInflow.create({
      clientId,
      type: "CUSTOMER_COLLECTION",
      source: "invoice",
      sourceId: invoiceId,
      customerId: invoice.debtorId || null,
      customerName,
      amount: outstanding,
      expectedDate,
      confidence: invoice.collectionConfidence || 80,
      status,
      ownerId: invoice.followUpOwner || null,
      ownerName: null,
      notes: invoice.collectionNotes || `Invoice ${invoice.invoiceNumber}`,
    });
  }
}

/**
 * When a customer payment is recorded on an invoice, update the linked inflow.
 */
export async function syncInvoicePaymentToInflow(
  invoice: any,
  paymentAmount: number
): Promise<void> {
  const clientId = invoice.clientId;

  // Find the linked inflow
  const existing = await ExpectedInflow.findBySource(clientId, "invoice", invoice.id);
  if (!existing) {
    // No inflow exists yet — create one with the remaining balance
    await syncInvoiceToInflow(invoice);
    return;
  }

  // Recompute outstanding
  const grandTotal = Number(invoice.grandTotal) || Number(invoice.amount) || 0;
  const advanceDeducted = Number(invoice.advanceDeducted) || 0;
  // After the payment was recorded, amountReceived on the invoice is already updated
  const totalReceived = Number(invoice.amountReceived) || 0;
  const outstanding = Math.max(0, grandTotal - advanceDeducted - totalReceived);

  if (outstanding <= 0.01) {
    // Fully paid → mark inflow as received, remove from forecast
    await ExpectedInflow.update(existing.id, { status: "RECEIVED" });
  } else {
    // Partial payment → update amount
    await ExpectedInflow.update(existing.id, {
      amount: outstanding,
      status: "PARTIALLY_RECEIVED",
    });
  }
}

// ---------------------------------------------------------------------------
// Purchase Invoice → Expected Outflow sync
// ---------------------------------------------------------------------------

/**
 * When a purchase invoice is created, create or update the linked expected outflow.
 */
export async function syncPurchaseInvoiceToOutflow(pi: any): Promise<void> {
  const clientId = pi.clientId;
  const piId = pi.id;

  // Compute outstanding: grandTotal − advanceDeducted − amountPaid
  const grandTotal = Number(pi.grandTotal) || Number(pi.amount) || 0;
  const advanceDeducted = Number(pi.advanceDeducted) || 0;
  const amountPaid = Number(pi.amountPaid) || 0;
  const outstanding = Math.max(0, grandTotal - advanceDeducted - amountPaid);

  if (outstanding <= 0) return; // Fully paid

  const expectedDate = pi.dueDate || pi.issueDate;
  if (!expectedDate) return;

  // Resolve supplier name
  let supplierName: string | null = pi.supplierName || null;
  if (!supplierName && pi.vendorId) {
    try {
      const vendor = await Vendor.get(pi.vendorId);
      supplierName = vendor?.name || null;
    } catch {
      // Swallow
    }
  }

  const existing = await ExpectedOutflow.findBySource(clientId, "purchase_invoice", piId);

  if (existing) {
    const updates: Partial<OutflowType> = {};
    if (existing.amount !== outstanding) updates.amount = outstanding;
    if (existing.expectedDate !== expectedDate) updates.expectedDate = expectedDate;
    if (supplierName && existing.supplierName !== supplierName) updates.supplierName = supplierName;

    if (pi.status === "paid") {
      updates.status = "PAID";
    } else if (pi.status === "partially_paid") {
      updates.status = "PARTIALLY_PAID";
    }

    if (Object.keys(updates).length > 0) {
      await ExpectedOutflow.update(existing.id, updates);
    }
  } else {
    let status: OutflowStatus = "PLANNED";
    if (pi.status === "paid") status = "PAID";
    else if (pi.status === "partially_paid") status = "PARTIALLY_PAID";
    else if (pi.status === "approved_for_payment") status = "APPROVED";

    await ExpectedOutflow.create({
      clientId,
      type: "SUPPLIER_PAYMENT",
      source: "purchase_invoice",
      sourceId: piId,
      supplierId: pi.vendorId || null,
      supplierName,
      amount: outstanding,
      expectedDate,
      priority: "NORMAL",
      status,
      notes: `Purchase invoice ${pi.invoiceNumber}`,
    });
  }
}
