import { X } from "lucide-react";
import type { ReactNode } from "react";
import { fmtMoney, fmtDate } from "@/components/ledger-ui";
import { DocumentList, type DocMeta } from "@/components/document-uploader";

/**
 * Read-only detail modals used by the checker desk and funding queue so
 * reviewers can inspect the full document (lines, totals, parties, addresses,
 * attachments, references) before making a decision. All modals are pure
 * presentational views over data the list endpoints already return (snake_case
 * fields) — every available field is rendered so reviewers never need to look
 * elsewhere.
 */

function DocModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-vault"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-base">{title}</h3>
          <button onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function D({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="num text-right">{value}</span>
    </div>
  );
}

function Summary({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <div className="space-y-1 rounded-md border border-border/60 bg-muted/30 p-3 text-xs">
      {rows.map(([label, value]) => (
        <Row key={label} label={label} value={value} />
      ))}
    </div>
  );
}

function LinesTable({
  columns,
  rows,
  totals,
}: {
  columns: Array<{ key: string; label: string; right?: boolean }>;
  rows: Array<Record<string, ReactNode>>;
  totals?: Array<[string, ReactNode]>;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-md border border-border/60">
      <table className="w-full text-sm">
        <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
          <tr className="border-b border-border">
            {columns.map((c) => (
              <th
                key={c.key}
                className={`px-3 py-2 font-normal ${c.right ? "text-right" : "text-left"}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={idx} className="border-b border-border/40">
              {columns.map((c) => (
                <td key={c.key} className={`px-3 py-2 ${c.right ? "text-right num" : ""}`}>
                  {r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {totals && totals.length > 0 && (
        <div className="ml-auto max-w-[240px] space-y-0.5 p-3 text-xs">
          {totals.map(([label, value]) => (
            <Row key={label} label={label} value={value} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Clickable attachment list — renders only when documents exist. */
function Docs({ docs }: { docs?: DocMeta[] | null }) {
  const list = Array.isArray(docs) ? (docs as DocMeta[]) : [];
  if (list.length === 0) return null;
  return (
    <div className="col-span-2">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">
        Attachments ({list.length})
      </div>
      <div className="mt-1">
        <DocumentList docs={list} />
      </div>
    </div>
  );
}

/** Multi-line text (addresses etc.) rendered without wrapping/truncation. */
function Multiline({ value }: { value?: string | null }) {
  if (!value) return null;
  return <span className="whitespace-pre-line">{value}</span>;
}

const NOA_LABELS: Record<string, string> = {
  not_sent: "Not sent",
  sent: "Awaiting reply",
  accepted: "Accepted",
  rejected: "Rejected",
  commented: "Commented",
};

/** Full read-only view of a sales (AR) or purchase (AP) invoice. */
export function InvoiceDetailModal({
  invoice,
  kind,
  onClose,
}: {
  invoice: any;
  kind: "sale" | "purchase";
  onClose: () => void;
}) {
  const i = invoice ?? {};
  const isSale = kind === "sale";
  const party = isSale ? (i.debtor?.name ?? "—") : (i.supplier_name ?? i.vendor?.name ?? "—");
  const poNumber = i.goods_po_number ?? i.po_number ?? null;
  const gross = Number(i.grand_total ?? i.amount ?? 0);
  const advance = Number(i.advance_deducted ?? 0);
  const net = Number(i.amount ?? Math.max(0, gross - advance));
  const amountReceived = Number(i.amount_received ?? i.amount_paid ?? 0);
  const balance = isSale
    ? Math.max(0, net - amountReceived)
    : i.balance_due != null
      ? Math.max(0, Number(i.balance_due))
      : Math.max(0, net - amountReceived);

  // Goods-invoice lines (catalogue-backed) — fall back to legacy line_items.
  const goodsLines = Array.isArray(i.lines) ? i.lines : [];
  const legacyLines = Array.isArray(i.line_items) ? i.line_items : [];
  const lines = (goodsLines.length ? goodsLines : legacyLines).map((l: any) => ({
    name: l.name ?? l.description ?? "Item",
    sku: l.sku ?? null,
    qty: Number(l.quantity ?? l.qty ?? 0),
    unit_price: Number(l.unit_price ?? 0),
    discount:
      l.discount_pct != null
        ? `${l.discount_pct}%`
        : l.discount_type
          ? l.discount_type === "pct"
            ? `${l.discount_value}%`
            : fmtMoney(l.discount_value)
          : null,
    gst_rate: l.gst_rate != null ? `${l.gst_rate}%` : "—",
    line_total: Number(l.line_total ?? 0),
    // Purchase-invoice extras
    ordered_qty: Number(l.ordered_qty ?? 0),
    grn_qty: Number(l.grn_received_qty ?? 0),
    po_unit_price: l.po_unit_price != null ? Number(l.po_unit_price) : null,
  }));

  const advanceRate = i.advance_rate != null ? Math.round(Number(i.advance_rate) * 100) : null;
  const feeRate = i.fee_rate != null ? Math.round(Number(i.fee_rate) * 100) : null;

  return (
    <DocModal
      title={`${isSale ? "Sales invoice" : "Purchase invoice"} · ${i.invoice_number ?? ""}`}
      onClose={onClose}
    >
      <div className="space-y-4 p-5 text-sm">
        <Summary
          rows={[
            ["Status", i.status ?? "—"],
            ["Counterparty", party],
            ["Gross total", fmtMoney(gross)],
            ["Advance deducted", advance > 0 ? `− ${fmtMoney(advance)}` : "—"],
            [isSale ? "Net receivable" : "Net payable", fmtMoney(net)],
            [
              isSale ? "Amount received" : "Amount paid",
              amountReceived > 0 ? fmtMoney(amountReceived) : "—",
            ],
            ["Balance", fmtMoney(balance)],
          ]}
        />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <D label={isSale ? "Debtor" : "Supplier"} value={party} />
          {poNumber && <D label="PO #" value={<span className="font-mono">{poNumber}</span>} />}
          {i.po_date && <D label="PO date" value={fmtDate(i.po_date)} />}
          {i.po_amount != null && Number(i.po_amount) > 0 && (
            <D label="PO amount" value={fmtMoney(i.po_amount)} />
          )}
          <D label="Issued" value={fmtDate(i.issue_date)} />
          <D label="Due" value={fmtDate(i.due_date)} />
          {i.received_date && <D label="Received" value={fmtDate(i.received_date)} />}
          {i.paid_date && <D label="Paid on" value={fmtDate(i.paid_date)} />}
          {i.created_at && <D label="Created" value={fmtDate(i.created_at)} />}
          {isSale && i.payment_terms && <D label="Payment terms" value={i.payment_terms} />}
          {isSale && i.goods_sales_order_number && (
            <D label="Sales order" value={i.goods_sales_order_number} />
          )}
          {!isSale && i.linked_goods_receipt_number && (
            <D label="GRN" value={i.linked_goods_receipt_number} />
          )}
          {isSale && i.linked_customer_proforma_number && (
            <D label="Proforma" value={i.linked_customer_proforma_number} />
          )}
          {!isSale && i.linked_supplier_proforma_number && (
            <D label="Proforma" value={i.linked_supplier_proforma_number} />
          )}
          {isSale && i.customer_contact && (
            <div className="col-span-2">
              <D label="Customer contact" value={i.customer_contact} />
            </div>
          )}
          {i.billing_address && (
            <div className="col-span-2">
              <D label="Billing address" value={<Multiline value={i.billing_address} />} />
            </div>
          )}
          {i.delivery_address && (
            <div className="col-span-2">
              <D label="Delivery address" value={<Multiline value={i.delivery_address} />} />
            </div>
          )}
          {isSale && (advanceRate != null || feeRate != null) && (
            <>
              {advanceRate != null && <D label="Advance rate" value={`${advanceRate}%`} />}
              {feeRate != null && <D label="Fee rate" value={`${feeRate}%`} />}
            </>
          )}
          {isSale && i.noa_status && (
            <D
              label="NOA"
              value={
                <span>
                  {NOA_LABELS[i.noa_status] ?? i.noa_status}
                  {i.noa_comments && (
                    <div
                      className="mt-0.5 max-w-[200px] truncate text-[10px] text-warning"
                      title={i.noa_comments}
                    >
                      “{i.noa_comments}”
                    </div>
                  )}
                </span>
              }
            />
          )}
          {!isSale && i.difference_notes && (
            <D label="Difference notes" value={i.difference_notes} />
          )}
          {i.notes && (
            <div className="col-span-2">
              <D label="Notes" value={i.notes} />
            </div>
          )}
          <Docs docs={i.documents} />
        </div>

        <LinesTable
          columns={[
            { key: "name", label: isSale ? "Product / service" : "Product" },
            ...(isSale
              ? []
              : [
                  { key: "ordered_qty", label: "Ordered", right: true },
                  { key: "grn_qty", label: "GRN", right: true },
                ]),
            { key: "qty", label: isSale ? "Qty" : "Billed", right: true },
            { key: "unit_price", label: "Unit price", right: true },
            ...(isSale ? [{ key: "discount", label: "Discount", right: true }] : []),
            { key: "gst_rate", label: "GST %", right: true },
            { key: "line_total", label: "Line total", right: true },
          ]}
          rows={lines.map((l: any) => ({
            name: (
              <span>
                {l.name}
                {l.sku && (
                  <span className="ml-1 font-mono text-[10px] text-muted-foreground">{l.sku}</span>
                )}
              </span>
            ),
            ordered_qty: l.ordered_qty ? l.ordered_qty.toLocaleString() : "—",
            grn_qty: l.grn_qty ? l.grn_qty.toLocaleString() : "—",
            qty: l.qty.toLocaleString(),
            unit_price: fmtMoney(l.unit_price),
            discount: l.discount ?? "—",
            gst_rate: l.gst_rate,
            line_total: fmtMoney(l.line_total),
          }))}
          totals={[
            ["Subtotal", fmtMoney(Number(i.subtotal_goods ?? i.subtotal ?? 0))],
            ...(Number(i.total_discount ?? 0) > 0
              ? [["Discount", `− ${fmtMoney(i.total_discount)}`] as [string, string]]
              : []),
            ["GST total", fmtMoney(Number(i.gst_total ?? i.tax_amount ?? 0))],
            ...(Number(i.freight ?? 0) > 0
              ? [["Freight", fmtMoney(i.freight)] as [string, string]]
              : []),
            ["Grand total", fmtMoney(gross)],
          ]}
        />

        <div className="flex justify-end border-t border-border pt-3">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">
            Close
          </button>
        </div>
      </div>
    </DocModal>
  );
}

const PF_DOC_LABELS: Record<string, string> = {
  received: "Received",
  reviewed: "Reviewed",
  converted_to_po: "Converted to PO",
  converted_to_so: "Converted to Sales Order",
  expired: "Expired",
  cancelled: "Cancelled",
};

/** Full read-only view of a proforma (sales or purchase side). */
export function ProformaDetailModal({ pf, onClose }: { pf: any; onClose: () => void }) {
  const p = pf ?? {};
  const cp = p.side === "sales" ? p.debtor?.name : p.vendor?.name;
  const docLabel = PF_DOC_LABELS[p.status] ?? p.status;
  const advance =
    p.advance_pct != null && p.advance_pct > 0
      ? Math.round((((p.po_amount ?? p.amount ?? 0) * p.advance_pct) / 100) * 100) / 100
      : p.po_amount == null
        ? p.amount
        : 0;

  return (
    <DocModal title={`Proforma · ${p.proforma_number ?? p.po_number}`} onClose={onClose}>
      <div className="space-y-4 p-5 text-sm">
        <Summary
          rows={[
            [
              "PO #",
              <span className="font-mono" key="po">
                {p.po_number}
              </span>,
            ],
            [
              "Proforma #",
              <span className="font-mono" key="pf">
                {p.proforma_number ?? "—"}
              </span>,
            ],
            ["Side", p.side],
            ["Document status", docLabel],
            ["Funding stage", p.proforma_status ?? "—"],
            ["Amount", fmtMoney(p.amount)],
            ...(p.po_amount != null && p.po_amount > 0
              ? ([["PO amount", fmtMoney(p.po_amount)]] as Array<[string, ReactNode]>)
              : []),
            ["Advance", advance > 0 ? fmtMoney(advance) : "—"],
            ...(p.proforma_funded_amount != null && p.proforma_funded_amount > 0
              ? ([["Funded", fmtMoney(p.proforma_funded_amount)]] as Array<[string, ReactNode]>)
              : []),
          ]}
        />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <D label="Counterparty" value={cp ?? "—"} />
          <D label="Currency" value={p.currency ?? "—"} />
          <D label="Proforma date" value={p.proforma_date ? fmtDate(p.proforma_date) : "—"} />
          {p.issue_date && <D label="Issue date" value={fmtDate(p.issue_date)} />}
          {p.created_at && <D label="Created" value={fmtDate(p.created_at)} />}
          {p.payment_terms && <D label="Payment terms" value={p.payment_terms} />}
          {p.valid_until && <D label="Valid until" value={fmtDate(p.valid_until)} />}
          {p.expected_delivery_date && (
            <D label="Expected delivery" value={fmtDate(p.expected_delivery_date)} />
          )}
          {p.side === "purchase" && p.supplier_contact && (
            <div className="col-span-2">
              <D label="Supplier contact" value={p.supplier_contact} />
            </div>
          )}
          {p.side === "purchase" && p.supplier_gstin && (
            <D label="Supplier GSTIN" value={p.supplier_gstin} />
          )}
          {p.side === "sales" && p.debtor_gstin && (
            <D label="Debtor GSTIN" value={p.debtor_gstin} />
          )}
          {p.side === "sales" && p.debtor_contact && (
            <div className="col-span-2">
              <D label="Debtor contact" value={p.debtor_contact} />
            </div>
          )}
          {p.proforma_review_comments && (
            <D label="Review comments" value={p.proforma_review_comments} />
          )}
          {p.notes && (
            <div className="col-span-2">
              <D label="Notes" value={p.notes} />
            </div>
          )}
          <Docs docs={p.documents} />
        </div>

        <LinesTable
          columns={[
            { key: "name", label: "Product" },
            { key: "qty", label: "Qty", right: true },
            { key: "unit_price", label: "Unit price", right: true },
            { key: "gst_rate", label: "GST %", right: true },
            { key: "line_total", label: "Line total", right: true },
          ]}
          rows={(p.lines ?? []).map((l: any) => ({
            name: (
              <span>
                {l.name}
                {l.sku && (
                  <span className="ml-1 font-mono text-[10px] text-muted-foreground">{l.sku}</span>
                )}
              </span>
            ),
            qty: (Number(l.quantity) || 0).toLocaleString(),
            unit_price: fmtMoney(l.unit_price),
            gst_rate: l.gst_rate != null ? `${l.gst_rate}%` : "—",
            line_total: fmtMoney(l.line_total),
          }))}
          totals={[
            ["Subtotal", fmtMoney(p.subtotal ?? 0)],
            ["GST total", fmtMoney(p.gst_total ?? 0)],
            ["Freight", fmtMoney(p.freight ?? 0)],
            ["Grand total", fmtMoney(p.grand_total ?? 0)],
          ]}
        />

        <div className="flex justify-end border-t border-border pt-3">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">
            Close
          </button>
        </div>
      </div>
    </DocModal>
  );
}

const PO_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_review: "Awaiting checker",
  approved: "Approved",
  sent: "Sent",
  partially_received: "Partially received",
  fully_received: "Fully received",
  cancelled: "Cancelled",
};

const SO_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_review: "Awaiting checker",
  confirmed: "Confirmed",
  partially_dispatched: "Partially dispatched",
  fully_dispatched: "Fully dispatched",
  cancelled: "Cancelled",
};

const APPROVAL_LABELS: Record<string, string> = {
  pending: "Awaiting response",
  approved: "Approved",
  rejected: "Rejected",
};

/** Full read-only view of a goods purchase order (PO). */
export function PurchaseOrderDetailModal({ po, onClose }: { po: any; onClose: () => void }) {
  const p = po ?? {};
  const supplierApproval = p.supplier_approval_status;
  return (
    <DocModal title={`Purchase order · ${p.po_number ?? ""}`} onClose={onClose}>
      <div className="space-y-4 p-5 text-sm">
        <Summary
          rows={[
            ["Status", PO_STATUS_LABELS[p.status] ?? p.status ?? "—"],
            ["Supplier", p.supplier_name ?? "—"],
            ["PO date", p.po_date ? fmtDate(p.po_date) : "—"],
            ["Grand total", fmtMoney(p.grand_total ?? 0)],
            ...(supplierApproval
              ? ([
                  ["Supplier approval", `${APPROVAL_LABELS[supplierApproval] ?? supplierApproval}`],
                ] as Array<[string, ReactNode]>)
              : []),
          ]}
        />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {p.warehouse && <D label="Warehouse / store" value={p.warehouse} />}
          {p.expected_delivery_date && (
            <D label="Expected delivery" value={fmtDate(p.expected_delivery_date)} />
          )}
          {p.payment_terms && <D label="Payment terms" value={p.payment_terms} />}
          {p.buyer_name && <D label="Buyer / created by" value={p.buyer_name} />}
          {p.created_at && <D label="Created" value={fmtDate(p.created_at)} />}
          {supplierApproval && (
            <>
              {p.supplier_approval_sent_at && (
                <D label="Sent to supplier" value={fmtDate(p.supplier_approval_sent_at)} />
              )}
              {p.supplier_approval_responded_at && (
                <D label="Supplier responded" value={fmtDate(p.supplier_approval_responded_at)} />
              )}
              {p.supplier_approval_email && (
                <D label="Supplier email" value={p.supplier_approval_email} />
              )}
              {p.supplier_approval_comments && (
                <D label="Supplier comments" value={p.supplier_approval_comments} />
              )}
            </>
          )}
          {p.notes && (
            <div className="col-span-2">
              <D label="Notes" value={p.notes} />
            </div>
          )}
          <Docs docs={p.documents} />
        </div>

        <LinesTable
          columns={[
            { key: "name", label: "Product" },
            { key: "ordered_qty", label: "Ordered", right: true },
            { key: "received_qty", label: "Received", right: true },
            { key: "unit_price", label: "Unit price", right: true },
            { key: "gst_rate", label: "GST %", right: true },
            { key: "line_total", label: "Line total", right: true },
          ]}
          rows={(p.lines ?? []).map((l: any) => ({
            name: (
              <span>
                {l.name}
                {l.sku && (
                  <span className="ml-1 font-mono text-[10px] text-muted-foreground">{l.sku}</span>
                )}
              </span>
            ),
            ordered_qty: (Number(l.ordered_qty) || 0).toLocaleString(),
            received_qty: (Number(l.received_qty) || 0).toLocaleString(),
            unit_price: fmtMoney(l.unit_price),
            gst_rate: l.gst_rate != null ? `${l.gst_rate}%` : "—",
            line_total: fmtMoney(l.line_total),
          }))}
          totals={[
            ["Total quantity", (p.total_qty ?? 0).toLocaleString()],
            ["Subtotal", fmtMoney(p.subtotal ?? 0)],
            ["GST total", fmtMoney(p.gst_total ?? 0)],
            ...(Number(p.freight ?? 0) > 0
              ? [["Freight", fmtMoney(p.freight)] as [string, string]]
              : []),
            ["Grand total", fmtMoney(p.grand_total ?? 0)],
          ]}
        />

        <div className="flex justify-end border-t border-border pt-3">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">
            Close
          </button>
        </div>
      </div>
    </DocModal>
  );
}

/** Full read-only view of a goods sales order (SO). */
export function SalesOrderDetailModal({ so, onClose }: { so: any; onClose: () => void }) {
  const s = so ?? {};
  const debtorApproval = s.debtor_approval_status;
  return (
    <DocModal title={`Sales order · ${s.so_number ?? ""}`} onClose={onClose}>
      <div className="space-y-4 p-5 text-sm">
        <Summary
          rows={[
            ["Status", SO_STATUS_LABELS[s.status] ?? s.status ?? "—"],
            ["Customer", s.customer_name ?? "—"],
            ["Order date", s.order_date ? fmtDate(s.order_date) : "—"],
            ["Grand total", fmtMoney(s.grand_total ?? 0)],
            ...(debtorApproval
              ? ([
                  ["Customer approval", `${APPROVAL_LABELS[debtorApproval] ?? debtorApproval}`],
                ] as Array<[string, ReactNode]>)
              : []),
          ]}
        />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {s.contact_person && <D label="Contact" value={s.contact_person} />}
          {s.billing_address && (
            <div className="col-span-2">
              <D label="Billing address" value={<Multiline value={s.billing_address} />} />
            </div>
          )}
          {s.delivery_address && (
            <div className="col-span-2">
              <D label="Delivery address" value={<Multiline value={s.delivery_address} />} />
            </div>
          )}
          {s.salesperson_name && <D label="Salesperson" value={s.salesperson_name} />}
          {s.linked_quotation_number && (
            <D label="Linked quotation" value={s.linked_quotation_number} />
          )}
          {s.payment_terms && <D label="Payment terms" value={s.payment_terms} />}
          {s.expected_dispatch_date && (
            <D label="Expected dispatch" value={fmtDate(s.expected_dispatch_date)} />
          )}
          {s.expected_delivery_date && (
            <D label="Expected delivery" value={fmtDate(s.expected_delivery_date)} />
          )}
          {s.created_at && <D label="Created" value={fmtDate(s.created_at)} />}
          {debtorApproval && (
            <>
              {s.debtor_approval_sent_at && (
                <D label="Sent to customer" value={fmtDate(s.debtor_approval_sent_at)} />
              )}
              {s.debtor_approval_responded_at && (
                <D label="Customer responded" value={fmtDate(s.debtor_approval_responded_at)} />
              )}
              {s.debtor_approval_email && (
                <D label="Customer email" value={s.debtor_approval_email} />
              )}
              {s.debtor_approval_comments && (
                <D label="Customer comments" value={s.debtor_approval_comments} />
              )}
            </>
          )}
          {s.notes && (
            <div className="col-span-2">
              <D label="Notes" value={s.notes} />
            </div>
          )}
          <Docs docs={s.documents} />
        </div>

        <LinesTable
          columns={[
            { key: "name", label: "Product" },
            { key: "ordered_qty", label: "Ordered", right: true },
            { key: "dispatched_qty", label: "Dispatched", right: true },
            { key: "unit_price", label: "Unit price", right: true },
            { key: "discount", label: "Disc %", right: true },
            { key: "gst_rate", label: "GST %", right: true },
            { key: "line_total", label: "Line total", right: true },
          ]}
          rows={(s.lines ?? []).map((l: any) => ({
            name: (
              <span>
                {l.name}
                {l.sku && (
                  <span className="ml-1 font-mono text-[10px] text-muted-foreground">{l.sku}</span>
                )}
              </span>
            ),
            ordered_qty: (Number(l.ordered_qty) || 0).toLocaleString(),
            dispatched_qty: (Number(l.dispatched_qty) || 0).toLocaleString(),
            unit_price: fmtMoney(l.unit_price),
            discount: l.discount_pct != null ? `${l.discount_pct}%` : "—",
            gst_rate: l.gst_rate != null ? `${l.gst_rate}%` : "—",
            line_total: fmtMoney(l.line_total),
          }))}
          totals={[
            ["Total quantity", (s.total_qty ?? 0).toLocaleString()],
            ["Subtotal", fmtMoney(s.subtotal ?? 0)],
            ...(Number(s.total_discount ?? 0) > 0
              ? [["Total discount", `− ${fmtMoney(s.total_discount)}`] as [string, string]]
              : []),
            ["GST total", fmtMoney(s.gst_total ?? 0)],
            ...(Number(s.freight ?? 0) > 0
              ? [["Freight", fmtMoney(s.freight)] as [string, string]]
              : []),
            ["Grand total", fmtMoney(s.grand_total ?? 0)],
          ]}
        />

        <div className="flex justify-end border-t border-border pt-3">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">
            Close
          </button>
        </div>
      </div>
    </DocModal>
  );
}

/** Full read-only view of a quotation (with original vs updated prices). */
export function QuotationDetailModal({ q, onClose }: { q: any; onClose: () => void }) {
  const d = q ?? {};
  return (
    <DocModal title={`Quotation · ${d.quotation_number ?? ""}`} onClose={onClose}>
      <div className="space-y-4 p-5 text-sm">
        <Summary
          rows={[
            ["Status", d.approval_status ?? d.status ?? "—"],
            ["Customer", d.customer_name ?? "—"],
            ["Quotation date", d.quotation_date ? fmtDate(d.quotation_date) : "—"],
            ["Requested", d.approval_requested_at ? fmtDate(d.approval_requested_at) : "—"],
            ["Grand total", fmtMoney(d.grand_total ?? 0)],
            ...(d.debtor_approval_status
              ? ([
                  [
                    "Customer decision",
                    `${APPROVAL_LABELS[d.debtor_approval_status] ?? d.debtor_approval_status}`,
                  ],
                ] as Array<[string, ReactNode]>)
              : []),
          ]}
        />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {d.contact_person && <D label="Contact" value={d.contact_person} />}
          {d.billing_address && (
            <div className="col-span-2">
              <D label="Billing address" value={<Multiline value={d.billing_address} />} />
            </div>
          )}
          {d.delivery_address && (
            <div className="col-span-2">
              <D label="Delivery address" value={<Multiline value={d.delivery_address} />} />
            </div>
          )}
          {d.payment_terms && <D label="Payment terms" value={d.payment_terms} />}
          {d.valid_until && <D label="Valid until" value={fmtDate(d.valid_until)} />}
          {d.expected_delivery_date && (
            <D label="Expected delivery" value={fmtDate(d.expected_delivery_date)} />
          )}
          {d.salesperson_name && <D label="Salesperson" value={d.salesperson_name} />}
          {d.created_at && <D label="Created" value={fmtDate(d.created_at)} />}
          {d.approval_reviewed_by && <D label="Reviewed by" value={d.approval_reviewed_by} />}
          {d.approval_reviewed_at && (
            <D label="Reviewed at" value={fmtDate(d.approval_reviewed_at)} />
          )}
          {d.approval_comments && <D label="Approval comments" value={d.approval_comments} />}
          {d.debtor_approval_status && (
            <>
              {d.debtor_approval_sent_at && (
                <D label="Sent to customer" value={fmtDate(d.debtor_approval_sent_at)} />
              )}
              {d.debtor_approval_responded_at && (
                <D label="Customer responded" value={fmtDate(d.debtor_approval_responded_at)} />
              )}
              {d.debtor_approval_email && (
                <D label="Customer email" value={d.debtor_approval_email} />
              )}
              {d.debtor_approval_comments && (
                <D label="Customer comments" value={d.debtor_approval_comments} />
              )}
            </>
          )}
          {d.notes && (
            <div className="col-span-2">
              <D label="Notes" value={d.notes} />
            </div>
          )}
          <Docs docs={d.documents} />
        </div>

        <LinesTable
          columns={[
            { key: "name", label: "Product" },
            { key: "qty", label: "Qty", right: true },
            { key: "unit_price", label: "Unit price", right: true },
            { key: "discount", label: "Discount", right: true },
            { key: "gst_rate", label: "GST %", right: true },
            { key: "line_total", label: "Line total", right: true },
          ]}
          rows={(d.lines ?? []).map((l: any) => {
            const updated = l.updated_unit_price != null;
            return {
              name: (
                <span>
                  {l.name}
                  {l.sku && (
                    <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                      {l.sku}
                    </span>
                  )}
                  {updated && (
                    <span className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-primary">
                      revised
                    </span>
                  )}
                </span>
              ),
              qty: (Number(l.quantity) || 0).toLocaleString(),
              unit_price: (
                <span>
                  {updated ? (
                    <>
                      <span className="text-muted-foreground line-through">
                        {fmtMoney(l.unit_price)}
                      </span>{" "}
                      <span className="font-medium text-primary">
                        {fmtMoney(l.updated_unit_price)}
                      </span>
                    </>
                  ) : (
                    fmtMoney(l.unit_price)
                  )}
                </span>
              ),
              discount:
                l.discount_type === "pct"
                  ? `${l.discount_value}%`
                  : l.discount_type === "amount"
                    ? fmtMoney(l.discount_value)
                    : "—",
              gst_rate: l.gst_rate != null ? `${l.gst_rate}%` : "—",
              line_total: fmtMoney(l.line_total),
            };
          })}
          totals={[
            ["Subtotal", fmtMoney(d.subtotal ?? 0)],
            ["Total discount", `− ${fmtMoney(d.total_discount ?? 0)}`],
            ["GST total", fmtMoney(d.gst_total ?? 0)],
            ["Freight", fmtMoney(d.freight ?? 0)],
            ["Grand total", fmtMoney(d.grand_total ?? 0)],
          ]}
        />

        <div className="flex justify-end border-t border-border pt-3">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">
            Close
          </button>
        </div>
      </div>
    </DocModal>
  );
}
