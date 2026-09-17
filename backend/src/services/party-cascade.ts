import * as db from "../dynamodb.js";
import * as Debtor from "../models/debtor.js";
import * as Supplier from "../models/supplier.js";
import * as Vendor from "../models/vendor.js";
import * as GoodsSO from "../models/goods-sales-order.js";
import * as Invoice from "../models/invoice.js";
import * as PurchaseOrder from "../models/purchase-order.js";
import * as GoodsDispatch from "../models/goods-dispatch.js";
import * as GoodsPO from "../models/goods-purchase-order.js";
import * as GoodsReceipt from "../models/goods-receipt.js";
import * as PurchaseInvoice from "../models/purchase-invoice.js";
import * as Advance from "../models/advance.js";
import * as CDNote from "../models/credit-debit-note.js";
import * as PaymentReceipt from "../models/payment-receipt.js";
import * as BulkPayment from "../models/bulk-payment.js";
import * as ExpectedInflow from "../models/expected-inflow.js";
import * as ExpectedOutflow from "../models/expected-outflow.js";
import * as PurchaseCommitment from "../models/purchase-commitment.js";
import * as StockMovement from "../models/stock-movement.js";
import * as Alert from "../models/alert.js";
import * as EwayBill from "../models/eway-bill.js";
import * as DebtorTerm from "../models/debtor-payment-term.js";

// ─── Party cascade deletes ───────────────────────────────────────────────────
// Deleting a customer / supplier / vendor removes every document linked to
// that party (leaves first, master last) and returns per-collection counts
// so the route can report what was removed in the audit trail + response.
//
// Identity matching is by party FK only (debtors/suppliers are global
// masters without a clientId). When clientScope is provided, document lists
// are additionally filtered to that client so one client's delete can never
// touch another client's documents.

export interface CustomerCascadeCounts {
  salesOrders: number;
  invoices: number;
  proformas: number;
  dispatches: number;
  advances: number;
  notes: number;
  receipts: number;
  bulkPayments: number;
  inflows: number;
  tasks: number;
  timelines: number;
  events: number;
  notifications: number;
  stockMovements: number;
  ewayBills: number;
  terms: number;
  alerts: number;
}

export interface SupplierCascadeCounts {
  purchaseOrders: number;
  grns: number;
  purchaseInvoices: number;
  supplierProformas: number;
  commitments: number;
  outflows: number;
  advances: number;
  notes: number;
  bulkPayments: number;
  tasks: number;
  timelines: number;
  events: number;
  notifications: number;
  stockMovements: number;
}

function emptyCustomerCounts(): CustomerCascadeCounts {
  return {
    salesOrders: 0, invoices: 0, proformas: 0, dispatches: 0, advances: 0,
    notes: 0, receipts: 0, bulkPayments: 0, inflows: 0, tasks: 0,
    timelines: 0, events: 0, notifications: 0, stockMovements: 0,
    ewayBills: 0, terms: 0, alerts: 0,
  };
}

function emptySupplierCounts(): SupplierCascadeCounts {
  return {
    purchaseOrders: 0, grns: 0, purchaseInvoices: 0, supplierProformas: 0,
    commitments: 0, outflows: 0, advances: 0, notes: 0, bulkPayments: 0,
    tasks: 0, timelines: 0, events: 0, notifications: 0, stockMovements: 0,
  };
}

function inScope(item: any, clientScope?: string): boolean {
  if (!clientScope) return true;
  if (!item?.clientId) return true;
  return item.clientId === clientScope;
}

/** Delete per-document workflow sidecars (tasks, timeline, events, notifications). */
async function deleteDocSidecars(
  docIds: Set<string>,
  counts: { tasks: number; timelines: number; events: number; notifications: number },
): Promise<void> {
  if (docIds.size === 0) return;
  const [tasks, timelines, events, notifs] = await Promise.all([
    db.scanByType("WorkflowTask", { limit: 2000 }),
    db.scanByType("DocTimeline", { limit: 2000 }),
    db.scanByType("DomainEvent", { limit: 2000 }),
    db.scanByType("NotificationLog", { limit: 2000 }),
  ]);
  for (const t of tasks as any[]) {
    if (t?.docId && docIds.has(String(t.docId))) {
      await db.deleteItem(t.pk, t.sk);
      counts.tasks += 1;
    }
  }
  for (const e of timelines as any[]) {
    if (e?.docId && docIds.has(String(e.docId))) {
      await db.deleteItem(e.pk, e.sk);
      counts.timelines += 1;
    }
  }
  for (const e of events as any[]) {
    if (e?.docId && docIds.has(String(e.docId))) {
      await db.deleteItem(e.pk, e.sk);
      counts.events += 1;
    }
  }
  for (const n of notifs as any[]) {
    if (n?.docId && docIds.has(String(n.docId))) {
      await db.deleteItem(n.pk, n.sk);
      counts.notifications += 1;
    }
  }
}

/** Delete stock movements whose source document is in the collected set. */
async function deleteMovementsForDocs(docIds: Set<string>): Promise<number> {
  if (docIds.size === 0) return 0;
  const all = await StockMovement.listAll();
  const targets = all.filter(
    (m: any) =>
      (m.salesOrderId && docIds.has(String(m.salesOrderId))) ||
      (m.goodsDispatchId && docIds.has(String(m.goodsDispatchId))) ||
      (m.invoiceId && docIds.has(String(m.invoiceId))) ||
      (m.purchaseInvoiceId && docIds.has(String(m.purchaseInvoiceId))) ||
      (m.goodsReceiptId && docIds.has(String(m.goodsReceiptId))) ||
      (m.purchaseOrderId && docIds.has(String(m.purchaseOrderId))),
  );
  for (const m of targets) await StockMovement.remove((m as any).id);
  return targets.length;
}

// ─── Customer cascade ────────────────────────────────────────────────────────

export async function cascadeDeleteCustomer(
  debtorId: string,
  clientScope?: string,
): Promise<CustomerCascadeCounts> {
  const counts = emptyCustomerCounts();

  const [sos, invoices, proformas, dispatches, advances, notes, receipts, bulks, inflows, alerts, ewbs, movements] =
    await Promise.all([
      GoodsSO.list(),
      Invoice.list(),
      PurchaseOrder.list(),
      GoodsDispatch.list(),
      Advance.list(),
      CDNote.list(),
      PaymentReceipt.list(),
      BulkPayment.list(),
      ExpectedInflow.list(),
      Alert.list(),
      EwayBill.list(),
      StockMovement.listAll(),
    ]);

  const partySos = (sos as any[]).filter(
    (s) =>
      inScope(s, clientScope) &&
      (String(s.customerId ?? "") === debtorId || String(s.shipCustomerId ?? "") === debtorId),
  );
  const soIds = new Set(partySos.map((s) => String(s.id)));

  const partyInvoices = (invoices as any[]).filter(
    (i) => inScope(i, clientScope) && String(i.debtorId ?? "") === debtorId,
  );
  const invoiceIds = new Set(partyInvoices.map((i) => String(i.id)));

  const partyProformas = (proformas as any[]).filter(
    (p) =>
      inScope(p, clientScope) && p.side === "sales" && String(p.debtorId ?? "") === debtorId,
  );
  const proformaIds = new Set(partyProformas.map((p) => String(p.id)));

  const partyDispatches = (dispatches as any[]).filter(
    (d) =>
      inScope(d, clientScope) &&
      (String(d.customerId ?? "") === debtorId ||
        (d.goodsSalesOrderId && soIds.has(String(d.goodsSalesOrderId)))),
  );
  const dispatchIds = new Set(partyDispatches.map((d) => String(d.id)));

  const partyAdvances = (advances as any[]).filter(
    (a) =>
      inScope(a, clientScope) &&
      ((a.invoiceId && invoiceIds.has(String(a.invoiceId))) ||
        (a.purchaseOrderId && proformaIds.has(String(a.purchaseOrderId)))),
  );
  const partyNotes = (notes as any[]).filter(
    (n) => inScope(n, clientScope) && n.invoiceId && invoiceIds.has(String(n.invoiceId)),
  );
  const partyReceipts = (receipts as any[]).filter(
    (r: any) =>
      inScope(r, clientScope) &&
      ((r.salesOrderId && soIds.has(String(r.salesOrderId))) ||
        (r.proformaId && proformaIds.has(String(r.proformaId))) ||
        (r.invoiceId && invoiceIds.has(String(r.invoiceId)))),
  );
  const partyBulks = (bulks as any[]).filter(
    (b: any) => inScope(b, clientScope) && String(b.debtorId ?? "") === debtorId,
  );
  const partyInflows = (inflows as any[]).filter(
    (i: any) =>
      inScope(i, clientScope) &&
      (String(i.customerId ?? "") === debtorId ||
        (i.sourceId &&
          (invoiceIds.has(String(i.sourceId)) ||
            soIds.has(String(i.sourceId)) ||
            proformaIds.has(String(i.sourceId))))),
  );
  const partyAlerts = (alerts as any[]).filter((a: any) => String(a.debtorId ?? "") === debtorId);
  const partyEwbs = (ewbs as any[]).filter(
    (e: any) =>
      inScope(e, clientScope) &&
      ((e.goodsDispatchId && dispatchIds.has(String(e.goodsDispatchId))) ||
        (e.salesInvoiceId && invoiceIds.has(String(e.salesInvoiceId)))),
  );
  const partyMovements = (movements as any[]).filter(
    (m: any) =>
      inScope(m, clientScope) &&
      ((m.salesOrderId && soIds.has(String(m.salesOrderId))) ||
        (m.goodsDispatchId && dispatchIds.has(String(m.goodsDispatchId))) ||
        (m.invoiceId && invoiceIds.has(String(m.invoiceId)))),
  );

  // All document ids whose sidecars must go too.
  const docIds = new Set<string>([
    ...soIds, ...invoiceIds, ...proformaIds, ...dispatchIds,
    ...partyAdvances.map((a: any) => String(a.id)),
    ...partyNotes.map((n: any) => String(n.id)),
    ...partyReceipts.map((r: any) => String(r.id)),
    ...partyBulks.map((b: any) => String(b.id)),
    ...partyInflows.map((i: any) => String(i.id)),
  ]);
  await deleteDocSidecars(docIds, counts);

  // Leaves first: receipts, advances, notes, bulks, inflows, ewb, movements.
  for (const r of partyReceipts) {
    await db.deleteItem(`PAYRECEIPT#${(r as any).id}`);
    counts.receipts += 1;
  }
  for (const a of partyAdvances) {
    await Advance.remove((a as any).id);
    counts.advances += 1;
  }
  for (const n of partyNotes) {
    await CDNote.remove((n as any).id);
    counts.notes += 1;
  }
  for (const b of partyBulks) {
    await BulkPayment.remove((b as any).id);
    counts.bulkPayments += 1;
  }
  for (const i of partyInflows) {
    await ExpectedInflow.remove((i as any).id);
    counts.inflows += 1;
  }
  for (const e of partyEwbs) {
    await EwayBill.remove((e as any).id);
    counts.ewayBills += 1;
  }
  for (const m of partyMovements) {
    await StockMovement.remove((m as any).id);
    counts.stockMovements += 1;
  }
  for (const a of partyAlerts) {
    await Alert.remove((a as any).id);
    counts.alerts += 1;
  }

  // Then dispatches, invoices, proformas, SOs.
  for (const d of partyDispatches) {
    await GoodsDispatch.remove((d as any).id);
    counts.dispatches += 1;
  }
  for (const i of partyInvoices) {
    await Invoice.remove((i as any).id);
    counts.invoices += 1;
  }
  for (const p of partyProformas) {
    await PurchaseOrder.remove((p as any).id);
    counts.proformas += 1;
  }
  for (const s of partySos) {
    await GoodsSO.remove((s as any).id);
    counts.salesOrders += 1;
  }

  // Debtor payment terms live under the DEBTOR# pk — delete directly to
  // bypass the default-term reassignment guard (the master is going away).
  const terms = await DebtorTerm.listByDebtor(debtorId, { activeOnly: false });
  for (const t of terms) {
    await db.deleteItem(`DEBTOR#${debtorId}`, `TERM#${t.id}`);
    counts.terms += 1;
  }

  await Debtor.remove(debtorId);
  return counts;
}

// ─── Supplier cascade (goods POs, GRNs, commitments, outflows) ───────────────

export async function cascadeDeleteSupplier(
  supplierId: string,
  clientScope?: string,
): Promise<SupplierCascadeCounts> {
  const counts = emptySupplierCounts();

  const [gpos, grns, commitments, outflows, advances, proformas, receipts] =
    await Promise.all([
      GoodsPO.list(),
      GoodsReceipt.list(),
      PurchaseCommitment.list(),
      ExpectedOutflow.list(),
      Advance.list(),
      PurchaseOrder.list(),
      PaymentReceipt.list(),
    ]);

  const partyGpos = (gpos as any[]).filter(
    (p) => inScope(p, clientScope) && String(p.supplierId ?? "") === supplierId,
  );
  const gpoIds = new Set(partyGpos.map((p) => String(p.id)));

  const partyGrns = (grns as any[]).filter(
    (g: any) =>
      inScope(g, clientScope) &&
      (String(g.supplierId ?? "") === supplierId ||
        (g.goodsPurchaseOrderId && gpoIds.has(String(g.goodsPurchaseOrderId)))),
  );
  const grnIds = new Set(partyGrns.map((g: any) => String(g.id)));

  // Supplier proformas are purchase-side PurchaseOrder rows converted into
  // this supplier's goods POs (linkedGoodsPoId FK). There is no supplierId
  // FK on PurchaseOrder — the goods-PO link is the join.
  const partyProformas = (proformas as any[]).filter(
    (p: any) =>
      inScope(p, clientScope) &&
      p.side === "purchase" &&
      p.linkedGoodsPoId &&
      gpoIds.has(String(p.linkedGoodsPoId)),
  );
  const proformaIds = new Set(partyProformas.map((p: any) => String(p.id)));

  const partyCommitments = (commitments as any[]).filter(
    (c: any) =>
      inScope(c, clientScope) &&
      (String(c.supplierId ?? "") === supplierId ||
        (c.linkedPO && gpoIds.has(String(c.linkedPO))) ||
        (c.linkedSupplierProforma && proformaIds.has(String(c.linkedSupplierProforma)))),
  );
  const partyOutflows = (outflows as any[]).filter(
    (o: any) =>
      inScope(o, clientScope) &&
      (String(o.supplierId ?? "") === supplierId ||
        (o.sourceId &&
          (gpoIds.has(String(o.sourceId)) ||
            grnIds.has(String(o.sourceId)) ||
            proformaIds.has(String(o.sourceId))))),
  );
  const partyAdvances = (advances as any[]).filter(
    (a: any) =>
      inScope(a, clientScope) &&
      ((a.purchaseOrderId &&
        (gpoIds.has(String(a.purchaseOrderId)) || proformaIds.has(String(a.purchaseOrderId)))) ||
        (a.purchaseInvoiceId && proformaIds.has(String(a.purchaseInvoiceId)))),
  );
  // Credit/debit notes carry only invoiceId/purchaseInvoiceId FKs — a goods
  // supplier has neither, so there is nothing to collect here (vendor notes
  // are handled in the vendor cascade via purchaseInvoiceId).
  const supplierNotes: any[] = [];
  const partyReceipts = (receipts as any[]).filter(
    (r: any) =>
      inScope(r, clientScope) &&
      ((r.proformaId && proformaIds.has(String(r.proformaId))) ||
        (r.salesOrderId && gpoIds.has(String(r.salesOrderId)))),
  );

  const docIds = new Set<string>([
    ...gpoIds, ...grnIds, ...proformaIds,
    ...partyCommitments.map((c: any) => String(c.id)),
    ...partyOutflows.map((o: any) => String(o.id)),
    ...partyAdvances.map((a: any) => String(a.id)),
    ...partyReceipts.map((r: any) => String(r.id)),
  ]);
  await deleteDocSidecars(docIds, counts);

  for (const r of partyReceipts) {
    await db.deleteItem(`PAYRECEIPT#${(r as any).id}`);
  }
  for (const a of partyAdvances) {
    await Advance.remove((a as any).id);
    counts.advances += 1;
  }
  for (const n of supplierNotes) {
    await CDNote.remove((n as any).id);
    counts.notes += 1;
  }
  for (const o of partyOutflows) {
    await ExpectedOutflow.remove((o as any).id);
    counts.outflows += 1;
  }
  for (const c of partyCommitments) {
    await PurchaseCommitment.remove((c as any).id);
    counts.commitments += 1;
  }
  for (const p of partyProformas) {
    await PurchaseOrder.remove((p as any).id);
    counts.supplierProformas += 1;
  }
  for (const g of partyGrns) {
    await GoodsReceipt.remove((g as any).id);
    counts.grns += 1;
  }
  for (const p of partyGpos) {
    await GoodsPO.remove((p as any).id);
    counts.purchaseOrders += 1;
  }

  // Stock movements tied to this supplier's POs/GRNs.
  const movementIds = new Set<string>([...gpoIds, ...grnIds]);
  counts.stockMovements += await deleteMovementsForDocs(movementIds);

  await Supplier.remove(supplierId);
  return counts;
}

// ─── Vendor cascade (purchase invoices, purchase proformas, AP payments) ─────

export async function cascadeDeleteVendor(
  vendorId: string,
  clientScope?: string,
): Promise<SupplierCascadeCounts> {
  const counts = emptySupplierCounts();

  const [pis, proformas, bulks, advances, notes, outflows, commitments] =
    await Promise.all([
      PurchaseInvoice.list(),
      PurchaseOrder.list(),
      BulkPayment.list(),
      Advance.list(),
      CDNote.list(),
      ExpectedOutflow.list(),
      PurchaseCommitment.list(),
    ]);

  const partyPis = (pis as any[]).filter(
    (p: any) => inScope(p, clientScope) && String(p.vendorId ?? "") === vendorId,
  );
  const piIds = new Set(partyPis.map((p: any) => String(p.id)));

  const partyProformas = (proformas as any[]).filter(
    (p: any) =>
      inScope(p, clientScope) &&
      p.side === "purchase" &&
      String(p.vendorId ?? "") === vendorId,
  );
  const proformaIds = new Set(partyProformas.map((p: any) => String(p.id)));

  const partyBulks = (bulks as any[]).filter(
    (b: any) => inScope(b, clientScope) && String(b.debtorId ?? "") === `vendor_${vendorId}`,
  );
  const partyAdvances = (advances as any[]).filter(
    (a: any) =>
      inScope(a, clientScope) &&
      ((a.purchaseInvoiceId && piIds.has(String(a.purchaseInvoiceId))) ||
        (a.purchaseOrderId && proformaIds.has(String(a.purchaseOrderId)))),
  );
  const partyNotes = (notes as any[]).filter(
    (n: any) => inScope(n, clientScope) && n.purchaseInvoiceId && piIds.has(String(n.purchaseInvoiceId)),
  );
  const partyOutflows = (outflows as any[]).filter(
    (o: any) =>
      inScope(o, clientScope) &&
      (String(o.supplierId ?? "") === vendorId ||
        (o.sourceId &&
          (piIds.has(String(o.sourceId)) || proformaIds.has(String(o.sourceId))))),
  );
  const partyCommitments = (commitments as any[]).filter(
    (c: any) =>
      inScope(c, clientScope) &&
      (String(c.supplierId ?? "") === vendorId ||
        (c.linkedSupplierProforma && proformaIds.has(String(c.linkedSupplierProforma)))),
  );

  const docIds = new Set<string>([
    ...piIds, ...proformaIds,
    ...partyBulks.map((b: any) => String(b.id)),
    ...partyAdvances.map((a: any) => String(a.id)),
    ...partyNotes.map((n: any) => String(n.id)),
    ...partyOutflows.map((o: any) => String(o.id)),
    ...partyCommitments.map((c: any) => String(c.id)),
  ]);
  await deleteDocSidecars(docIds, counts);

  for (const b of partyBulks) {
    await BulkPayment.remove((b as any).id);
    counts.bulkPayments += 1;
  }
  for (const a of partyAdvances) {
    await Advance.remove((a as any).id);
    counts.advances += 1;
  }
  for (const n of partyNotes) {
    await CDNote.remove((n as any).id);
    counts.notes += 1;
  }
  for (const o of partyOutflows) {
    await ExpectedOutflow.remove((o as any).id);
    counts.outflows += 1;
  }
  for (const c of partyCommitments) {
    await PurchaseCommitment.remove((c as any).id);
    counts.commitments += 1;
  }
  for (const p of partyPis) {
    await PurchaseInvoice.remove((p as any).id);
    counts.purchaseInvoices += 1;
  }
  for (const p of partyProformas) {
    await PurchaseOrder.remove((p as any).id);
    counts.supplierProformas += 1;
  }

  const movementIds = new Set<string>([...piIds, ...proformaIds]);
  counts.stockMovements += await deleteMovementsForDocs(movementIds);

  await Vendor.remove(vendorId);
  return counts;
}
