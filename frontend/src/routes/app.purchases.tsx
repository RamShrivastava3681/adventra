import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import {
  PageHeader,
  Card,
  StatusPill,
  fmtMoney,
  fmtDate,
  daysBetween,
} from "@/components/ledger-ui";
import { Plus, X, Loader2, Link2, Mail, AlertTriangle, CheckCircle2, ShoppingCart } from "lucide-react";
import { TableSkeleton } from "@/components/skeletons";
import { toast } from "sonner";
import { DocumentUploader, type DocMeta } from "@/components/document-uploader";
import { SearchableSelect } from "@/components/ui/searchable-select";

export const Route = createFileRoute("/app/purchases")({
  component: PurchasesPage,
});

const PI_STATUSES = [
  "draft",
  "verified",
  "approved_for_payment",
  "partially_paid",
  "paid",
  "cancelled",
];

const PI_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  verified: "Verified",
  approved_for_payment: "Approved for Payment",
  partially_paid: "Partially Paid",
  paid: "Paid",
  cancelled: "Cancelled",
  // legacy statuses still displayed gracefully
  pending: "Pending",
  approved: "Approved",
  overdue: "Overdue",
  disputed: "Disputed",
  rejected: "Rejected",
  advanced: "Advanced",
  funded: "Funded",
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Line draft (snake_case — the API transform handles the rest) ─────────
type LineDraft = {
  product_id: string;
  sku: string | null;
  name: string;
  unit: string;
  ordered_qty: number;
  grn_received_qty: number;
  invoice_qty: string;
  unit_price: string;
  po_unit_price: number | null;
  gst_rate: string;
};

type POFragment = {
  id: string;
  po_number: string;
  supplier_id: string | null;
  supplier_name: string | null;
  status: string;
  lines: Array<{
    product_id: string;
    sku: string | null;
    name: string;
    unit: string;
    ordered_qty: number;
    unit_price: number;
    gst_rate: number | null;
  }>;
};

type GRNFragment = {
  id: string;
  receipt_number: string;
  status: string;
  lines: Array<{
    product_id: string;
    accepted_qty: number;
    received_qty: number;
  }>;
};

function PurchasesPage() {
  const { user, isAdmin, isChecker, isClient, isTreasury } = useAuth();
  const canCreate = isAdmin || (isClient && !isChecker && !isTreasury);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [viewing, setViewing] = useState<any | null>(null);
  const [filter, setFilter] = useState("all");

  const piQ = useQuery({
    queryKey: ["purchase_invoices"],
    queryFn: async () => {
      const data = await api.purchaseInvoices.list();
      return data.reverse();
    },
  });

  const vendorsQ = useQuery({
    queryKey: ["vendors-min"],
    queryFn: async () => {
      // Suppliers live in two places: the visible "Suppliers" page (Supplier
      // model) and legacy procurement vendors (Vendor model). Merge both so
      // the supplier dropdown is never empty when suppliers exist in the platform.
      const [suppliers, vendors] = await Promise.all([api.suppliers.list(), api.vendors.list()]);
      return [
        ...suppliers.map((s: any) => ({
          id: s.id,
          name: s.company_name ?? s.companyName ?? s.name,
          payment_terms_days: s.paymentTermsDays ?? s.payment_terms_days ?? 30,
        })),
        ...vendors.map((v: any) => ({
          id: v.id,
          name: v.name,
          payment_terms_days: v.paymentTermsDays ?? v.payment_terms_days ?? 30,
        })),
      ].sort((a: any, b: any) => a.name?.localeCompare(b.name ?? "") ?? 0);
    },
  });

  // Goods POs — the linked purchase order that supplies the invoice lines.
  const posQ = useQuery({
    queryKey: ["goods-pos-for-pi"],
    queryFn: async () => api.goodsPurchaseOrders.list(),
  });

  // GRNs — created AFTER the invoice; linked back to show received quantities.
  const grnsQ = useQuery({
    queryKey: ["goods-receipts-for-pi"],
    queryFn: async () => api.goodsReceipts.list(),
  });

  // Linked sales invoices (the trail)
  const salesQ = useQuery({
    queryKey: ["invoices-by-pi"],
    queryFn: async () => {
      const data = await api.invoices.list();
      return data.map((s: any) => ({
        id: s.id,
        invoice_number: s.invoiceNumber ?? s.invoice_number,
        amount: s.amount,
        status: s.status,
        purchase_invoice_id: s.purchaseInvoiceId ?? s.purchase_invoice_id,
      }));
    },
  });

  const linkedSales = (piId: string) =>
    (salesQ.data ?? []).filter((s: any) => s.purchase_invoice_id === piId);

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await api.purchaseInvoices.update(id, { status });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase_invoices"] });
      toast.success("Updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // Send reminder mutation for purchase invoices
  const sendReminder = useMutation({
    mutationFn: async (invoiceId: string) => {
      return api.reminders.sendPurchase(invoiceId);
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["reminder-logs"] });
      toast.success(data.message || "Reminder sent successfully");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to send reminder"),
  });

  const filtered = (piQ.data ?? []).filter((p: any) => filter === "all" || p.status === filter);

  const totals = (piQ.data ?? []).reduce(
    (a: any, p: any) => {
      const amt = Number(p.grand_total ?? p.amount) || 0;
      a.all += amt;
      if (!["paid", "cancelled"].includes(p.status))
        a.open += Math.max(0, Number(p.balance_due ?? p.amount) || 0);
      return a;
    },
    { all: 0, open: 0 },
  );

  const grnById = useMemo(() => {
    const m = new Map<string, GRNFragment>();
    for (const g of (grnsQ.data ?? []) as GRNFragment[]) m.set(g.id, g);
    return m;
  }, [grnsQ.data]);

  return (
    <div>
      <PageHeader
        eyebrow="Procurement"
        title="Purchase invoices"
        description="Invoices you receive from suppliers, linked to the purchase order they bill. A purchase invoice records the supplier payable — it never touches stock. Only a confirmed GRN credits inventory."
        icon={<ShoppingCart className="h-5 w-5" />}
        actions={
          canCreate ? (
            <button
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              <Plus className="h-4 w-4" /> New purchase invoice
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
              Read-only · {isChecker ? "Checker" : isTreasury ? "Treasury" : "View"}
            </span>
          )
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        <div className="grid gap-4 md:grid-cols-3">
          <Card title="Total purchases">
            <div className="num text-3xl">{fmtMoney(totals.all)}</div>
          </Card>
          <Card title="Open payables">
            <div className="num text-3xl text-warning">{fmtMoney(totals.open)}</div>
          </Card>
          <Card title="Suppliers used">
            <div className="num text-3xl">
              {new Set((piQ.data ?? []).map((p: any) => p.vendor_id)).size}
            </div>
          </Card>
        </div>

        <div className="flex flex-wrap gap-2">
          {["all", ...PI_STATUSES].map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`rounded-full border px-3 py-1 text-xs uppercase tracking-widest transition ${
                filter === s
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {s === "all" ? "All" : (PI_STATUS_LABELS[s] ?? s)}
            </button>
          ))}
        </div>

        <Card>
          {piQ.isLoading ? (
            <TableSkeleton rows={6} cols={9} />
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No purchase invoices.
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Invoice</th>
                    <th className="px-5 py-2 text-left font-normal">Supplier</th>
                    <th className="px-5 py-2 text-left font-normal">PO</th>
                    <th className="px-5 py-2 text-left font-normal">GRN</th>
                    <th className="px-5 py-2 text-right font-normal">Grand total</th>
                    <th className="px-5 py-2 text-left font-normal">Due</th>
                    <th className="px-5 py-2 text-left font-normal">Status</th>
                    <th className="px-5 py-2 text-left font-normal">Linked sales</th>
                    <th className="px-5 py-2 text-right font-normal">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p: any) => {
                    const dpd =
                      p.due_date && !["paid", "cancelled"].includes(p.status)
                        ? daysBetween(p.due_date)
                        : 0;
                    let lateDays = Math.max(0, dpd);
                    if (p.status === "paid" && p.due_date && p.paid_date) {
                      const ms = new Date(p.paid_date).getTime() - new Date(p.due_date).getTime();
                      lateDays = Math.max(0, Math.round(ms / 86400000));
                    }
                    const links = linkedSales(p.id);
                    const canEdit = canCreate && ["draft", "verified"].includes(p.status);
                    const grn = grnById.get(p.linked_goods_receipt_id ?? "");
                    return (
                      <tr key={p.id} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-3">
                          <div className="font-mono text-xs">{p.invoice_number}</div>
                          {Number(p.advance_deducted ?? 0) > 0 && (
                            <div className="text-[10px] text-muted-foreground">
                              Less advance {fmtMoney(p.advance_deducted)}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3">{p.supplier_name ?? p.vendor?.name ?? "—"}</td>
                        <td className="px-5 py-3">
                          {(p.goods_po_number ?? p.po_number) ? (
                            <div>
                              <div className="font-mono text-xs">
                                {p.goods_po_number ?? p.po_number}
                              </div>
                              {p.po_date ? (
                                <div className="text-[10px] text-muted-foreground">
                                  {fmtDate(p.po_date)}
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {p.linked_goods_receipt_number ? (
                            <div>
                              <div className="font-mono text-xs">
                                {p.linked_goods_receipt_number}
                              </div>
                              {grn && grn.status === "confirmed" ? (
                                <div className="text-[10px] text-success">Stock credited</div>
                              ) : (
                                <div className="text-[10px] text-muted-foreground">
                                  {grn?.status ?? ""}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right num">
                          {fmtMoney(p.grand_total ?? p.amount)}
                        </td>
                        <td className="px-5 py-3 text-sm">{fmtDate(p.due_date)}</td>
                        <td className="px-5 py-3">
                          <StatusPill
                            status={p.status}
                            label={PI_STATUS_LABELS[p.status] ?? p.status}
                          />
                        </td>
                        <td className="px-5 py-3">
                          {links.length === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <div className="space-y-0.5">
                              {links.map((s: any) => (
                                <Link
                                  key={s.id}
                                  to="/app/invoices"
                                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                                >
                                  <Link2 className="h-3 w-3" />
                                  {s.invoice_number}
                                  <span className="text-muted-foreground">
                                    → {s.debtor?.name ?? "?"}
                                  </span>
                                </Link>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="inline-flex flex-wrap justify-end gap-1">
                            <button
                              onClick={() => setViewing(p)}
                              className="rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary"
                            >
                              View
                            </button>
                            {canEdit && (
                              <button
                                onClick={() => setEditing(p)}
                                className="rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary"
                              >
                                Edit
                              </button>
                            )}
                            {canCreate && p.status === "draft" && (
                              <button
                                onClick={() => setStatus.mutate({ id: p.id, status: "verified" })}
                                disabled={setStatus.isPending}
                                className="inline-flex items-center gap-1 rounded-md border border-primary/50 px-2 py-1 text-[10px] text-primary hover:bg-primary/10 disabled:opacity-60"
                                title="Review the invoice and send it to the checker"
                              >
                                <CheckCircle2 className="h-3 w-3" /> Review
                              </button>
                            )}
                            {canCreate && p.status === "verified" && (
                              <button
                                onClick={() => setStatus.mutate({ id: p.id, status: "draft" })}
                                disabled={setStatus.isPending}
                                className="rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary"
                                title="Send back to draft"
                              >
                                Reopen
                              </button>
                            )}
                            {(canCreate || isAdmin) && ["draft", "verified"].includes(p.status) && (
                              <button
                                onClick={() => setStatus.mutate({ id: p.id, status: "cancelled" })}
                                disabled={setStatus.isPending}
                                className="rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:border-destructive hover:text-destructive"
                              >
                                Cancel
                              </button>
                            )}
                            {isAdmin &&
                              !["paid", "rejected", "cancelled"].includes(p.status) &&
                              p.due_date && (
                                <button
                                  onClick={() => sendReminder.mutate(p.id)}
                                  disabled={sendReminder.isPending}
                                  className="inline-flex items-center gap-1 rounded-md border border-amber-400/50 px-2 py-1 text-[10px] text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/20 disabled:opacity-50"
                                  title="Send reminder email for this purchase invoice"
                                >
                                  <Mail className="h-3 w-3" /> Remind
                                </button>
                              )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {open && user && (
        <NewPurchaseModal
          userId={user.id}
          vendors={vendorsQ.data ?? []}
          pos={(posQ.data ?? []).filter((p: any) => !["cancelled"].includes(p.status))}
          grns={grnsQ.data ?? []}
          isAdmin={isAdmin}
          isTreasury={isTreasury}
          onClose={() => setOpen(false)}
          onCreated={() => qc.invalidateQueries({ queryKey: ["purchase_invoices"] })}
        />
      )}
      {editing && user && (
        <NewPurchaseModal
          invoice={editing}
          userId={user.id}
          vendors={vendorsQ.data ?? []}
          pos={(posQ.data ?? []).filter((p: any) => !["cancelled"].includes(p.status))}
          grns={grnsQ.data ?? []}
          isAdmin={isAdmin}
          isTreasury={isTreasury}
          onClose={() => setEditing(null)}
          onCreated={() => qc.invalidateQueries({ queryKey: ["purchase_invoices"] })}
        />
      )}
      {viewing && (
        <PurchaseDetailModal
          invoice={viewing}
          grn={grnById.get(viewing.linked_goods_receipt_id ?? "") ?? null}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

function NewPurchaseModal({
  invoice,
  userId,
  vendors,
  pos,
  grns,
  isAdmin,
  isTreasury,
  onClose,
  onCreated,
}: {
  invoice?: any;
  userId: string;
  vendors: any[];
  pos: POFragment[];
  grns: GRNFragment[];
  isAdmin: boolean;
  isTreasury: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!invoice;

  const [form, setForm] = useState({
    vendor_id: invoice?.vendor_id ?? "",
    invoice_number: invoice?.invoice_number ?? "",
    issue_date:
      (invoice?.issue_date ?? new Date().toISOString().slice(0, 10))?.slice(0, 10) ??
      new Date().toISOString().slice(0, 10),
    received_date:
      (invoice?.received_date ?? new Date().toISOString().slice(0, 10))?.slice(0, 10) ?? "",
    due_date: (invoice?.due_date ?? "")?.slice(0, 10) ?? "",
    goods_po_id: invoice?.goods_purchase_order_id ?? "",
    goods_po_number: invoice?.goods_po_number ?? "",
    po_number: invoice?.po_number ?? "",
    linked_supplier_proforma_id: invoice?.linked_supplier_proforma_id ?? "",
    linked_supplier_proforma_number: invoice?.linked_supplier_proforma_number ?? "",
    freight: invoice?.freight != null ? String(invoice.freight) : "0",
    notes: invoice?.notes ?? "",
    difference_notes: invoice?.difference_notes ?? "",
  });

  const [lines, setLines] = useState<LineDraft[]>(
    (invoice?.lines ?? []).map((l: any) => ({
      product_id: l.product_id,
      sku: l.sku ?? null,
      name: l.name ?? "",
      unit: l.unit ?? "unit",
      ordered_qty: Number(l.ordered_qty) || 0,
      grn_received_qty: Number(l.grn_received_qty) || 0,
      invoice_qty: l.invoice_qty != null ? String(l.invoice_qty) : "",
      unit_price: l.unit_price != null ? String(l.unit_price) : "",
      po_unit_price: l.po_unit_price != null ? Number(l.po_unit_price) : null,
      gst_rate: l.gst_rate != null ? String(l.gst_rate) : "",
    })),
  );
  const [docs, setDocs] = useState<DocMeta[]>(invoice?.documents ?? []);

  // GRN received quantities — from the linked GRN (created after this invoice).
  const linkedGrn = useMemo(() => {
    if (!isEdit || !invoice?.linked_goods_receipt_id) return null;
    return grns.find((g) => g.id === invoice.linked_goods_receipt_id) ?? null;
  }, [grns, invoice, isEdit]);

  useEffect(() => {
    if (!linkedGrn) return;
    const qtyByProduct = new Map<string, number>();
    for (const l of linkedGrn.lines ?? [])
      qtyByProduct.set(l.product_id, Number(l.accepted_qty ?? l.received_qty) || 0);
    setLines((ls) =>
      ls.map((l) => ({
        ...l,
        grn_received_qty: qtyByProduct.get(l.product_id) ?? l.grn_received_qty ?? 0,
      })),
    );
  }, [linkedGrn]);

  const selectedVendor = vendors.find((v: any) => v.id === form.vendor_id);
  const termsDays = Number(selectedVendor?.payment_terms_days ?? 30) || 30;
  const computedDue = (() => {
    if (!form.issue_date) return "";
    const d = new Date(form.issue_date);
    d.setDate(d.getDate() + termsDays);
    return d.toISOString().slice(0, 10);
  })();
  const effectiveDue = form.due_date || computedDue;

  const eligiblePos = useMemo(() => {
    // Only POs that can actually be billed (sent / partially received) are
    // selectable — but the invoice's own linked PO is always kept so an
    // existing invoice remains viewable/editable even after it's fully received.
    const open = pos.filter((p) => ["approved", "sent", "partially_received"].includes(p.status));
    const bySupplier = form.vendor_id ? open.filter((p) => p.supplier_id === form.vendor_id) : open;
    const linked = pos.find((p) => p.id === form.goods_po_id);
    return linked && !bySupplier.some((p) => p.id === linked.id)
      ? [linked, ...bySupplier]
      : bySupplier;
  }, [pos, form.vendor_id, form.goods_po_id]);

  // Purchase proformas available to formally link (drives the advance deduction).
  const proformasQ = useQuery({
    queryKey: ["purchase-proformas-for-pi"],
    queryFn: async () => {
      const data = await api.purchaseOrders.list();
      return (data ?? []).filter((p: any) => p.side === "purchase");
    },
  });

  const pickPo = (id: string) => {
    const po = pos.find((p) => p.id === id);
    if (!po) {
      setForm((f) => ({
        ...f,
        goods_po_id: id,
        goods_po_number: "",
        po_number: "",
        linked_supplier_proforma_id: "",
        linked_supplier_proforma_number: "",
      }));
      setLines([]);
      return;
    }
    setLines(
      (po.lines ?? []).map((l) => ({
        product_id: l.product_id,
        sku: l.sku ?? null,
        name: l.name,
        unit: l.unit ?? "unit",
        ordered_qty: Number(l.ordered_qty) || 0,
        grn_received_qty: 0,
        invoice_qty: String(Number(l.ordered_qty) || 0),
        unit_price: String(Number(l.unit_price) || 0),
        po_unit_price: Number(l.unit_price) || 0,
        gst_rate: l.gst_rate != null ? String(l.gst_rate) : "",
      })),
    );
    // When this PO was turned into a purchase proforma, link that proforma
    // automatically — its advance % drives the deduction and its details
    // (supplier contact, GSTIN, terms…) are fetched into the section below.
    // Only auto-link when the PO number maps to exactly one proforma (the
    // backend refuses ambiguous number matches too).
    const pfMatches = (proformasQ.data ?? []).filter(
      (p: any) =>
        p.side === "purchase" &&
        (p.po_number === po.po_number || p.proforma_number === po.po_number),
    );
    const pf = pfMatches.length === 1 ? pfMatches[0] : null;
    setForm((f) => ({
      ...f,
      goods_po_id: id,
      goods_po_number: po.po_number,
      po_number: pf ? (pf.po_number ?? pf.proforma_number ?? po.po_number) : po.po_number,
      linked_supplier_proforma_id: pf?.id ?? "",
      linked_supplier_proforma_number: pf ? (pf.proforma_number ?? pf.po_number ?? "") : "",
    }));
  };

  const setLine = (i: number, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const totals = useMemo(() => {
    let subtotal = 0;
    let gst = 0;
    for (const l of lines) {
      const qty = Number(l.invoice_qty) || 0;
      const price = Number(l.unit_price) || 0;
      const rate = Number(l.gst_rate) || 0;
      const lt = round2(qty * price);
      subtotal += lt;
      gst += round2((lt * rate) / 100);
    }
    const freight = Number(form.freight) || 0;
    return {
      subtotal: round2(subtotal),
      gst: round2(gst),
      freight: round2(freight),
      grand: round2(subtotal + gst + freight),
    };
  }, [lines, form.freight]);

  // Quantity vs GRN + price vs PO differences — shown clearly (warn-only).
  const differences = useMemo(() => {
    const diffs: Array<{
      name: string;
      type: "qty" | "price";
      invoiceValue: number;
      referenceValue: number;
    }> = [];
    for (const l of lines) {
      const qty = Number(l.invoice_qty) || 0;
      const grn = Number(l.grn_received_qty) || 0;
      if (grn > 0 && Math.abs(qty - grn) > 1e-9) {
        diffs.push({ name: l.name, type: "qty", invoiceValue: qty, referenceValue: grn });
      }
      const price = Number(l.unit_price) || 0;
      const poPrice = Number(l.po_unit_price);
      if (Number.isFinite(poPrice) && poPrice >= 0 && Math.abs(price - poPrice) > 1e-9) {
        diffs.push({ name: l.name, type: "price", invoiceValue: price, referenceValue: poPrice });
      }
    }
    return diffs;
  }, [lines]);

  // Lookup advances paid against the linked purchase proforma by PO number.
  const advLookupQ = useQuery({
    queryKey: ["pi-adv-lookup", form.po_number],
    enabled: !!form.po_number.trim(),
    queryFn: async () => {
      const po = form.po_number.trim();
      const orders = await api.purchaseOrders.list();
      const pfs = orders.filter(
        (o: any) => o.side === "purchase" && (o.po_number === po || o.proforma_number === po),
      );
      const pfIds = pfs.map((p: any) => p.id);
      let advances: any[] = [];
      if (pfIds.length) {
        const allAdvances = await api.advances.list();
        advances = allAdvances.filter(
          (a: any) =>
            a.side === "purchase" &&
            pfIds.includes(a.purchaseOrderId ?? a.purchase_order_id) &&
            a.status !== "refunded",
        );
      }
      return { proformas: pfs, advances };
    },
  });

  const advancesTotal = ((advLookupQ.data?.advances ?? []) as any[]).reduce(
    (s, a) => s + Number(a.amount),
    0,
  );

  // The proforma linked to the PO carries the agreed advance % — its advance
  // (proforma total × %) is deducted even before treasury has funded it.
  // Whichever is larger (agreed % vs actually paid) is what's deducted — this
  // mirrors the backend resolveProformaForInvoice logic.
  const linkedPf = (proformasQ.data ?? []).find(
    (p: any) => p.id === form.linked_supplier_proforma_id,
  );
  const pctAdvance =
    linkedPf?.advance_pct != null && Number(linkedPf.advance_pct) > 0
      ? round2(
          ((Number(linkedPf.po_amount ?? linkedPf.amount) || 0) * Number(linkedPf.advance_pct)) /
            100,
        )
      : 0;
  const advanceToDeduct = round2(Math.max(advancesTotal, pctAdvance));

  // Pick a linked proforma → set the formal link and PO reference.
  const pickProforma = (id: string) => {
    const pf = (proformasQ.data ?? []).find((p: any) => p.id === id) as any;
    setForm((f) => ({
      ...f,
      linked_supplier_proforma_id: id,
      linked_supplier_proforma_number: id ? (pf?.proforma_number ?? pf?.po_number ?? "") : "",
      po_number: id ? (pf?.proforma_number ?? pf?.po_number ?? f.po_number) : f.po_number,
    }));
  };

  // When a typed PO number uniquely matches one purchase proforma, formalize
  // the link automatically so the deduction is applied to the stored amount.
  const autoLinkedPf = useRef<string>("");
  useEffect(() => {
    const pfs = (advLookupQ.data?.proformas ?? []) as any[];
    if (pfs.length !== 1) return;
    const pf = pfs[0];
    if (form.linked_supplier_proforma_id && form.linked_supplier_proforma_id !== pf.id) return;
    if (autoLinkedPf.current === pf.id) return;
    autoLinkedPf.current = pf.id;
    setForm((f) => ({
      ...f,
      linked_supplier_proforma_id: pf.id,
      linked_supplier_proforma_number: pf.proforma_number ?? pf.po_number ?? "",
    }));
  }, [advLookupQ.data, form.linked_supplier_proforma_id]);

  const amountPaid = Number(invoice?.amount_paid) || 0;
  const netPayable = round2(Math.max(0, totals.grand - advanceToDeduct));
  const balanceDue = round2(Math.max(0, netPayable - amountPaid));

  const save = useMutation({
    mutationFn: async () => {
      if (!form.vendor_id) throw new Error("Add a supplier first.");
      if (!form.invoice_number.trim()) throw new Error("Supplier invoice number required");
      if (!form.goods_po_id)
        throw new Error("Link a purchase order — it supplies the invoice lines");
      if (lines.length === 0)
        throw new Error("Add at least one line from the linked purchase order");
      const payloadLines = lines.map((l) => ({
        product_id: l.product_id,
        invoice_qty: Number(l.invoice_qty) || 0,
        unit_price: Number(l.unit_price) || 0,
        gst_rate: l.gst_rate === "" ? null : Number(l.gst_rate),
        grn_received_qty: Number(l.grn_received_qty) || 0,
      }));
      const supplierName = selectedVendor?.name ?? null;
      const payload: any = {
        vendor_id: form.vendor_id,
        supplier_name: supplierName,
        invoice_number: form.invoice_number.trim(),
        issue_date: form.issue_date,
        received_date: form.received_date || null,
        due_date: effectiveDue || null,
        goods_purchase_order_id: form.goods_po_id || null,
        goods_po_number: form.goods_po_number || null,
        po_number: form.po_number || null,
        linked_supplier_proforma_id: form.linked_supplier_proforma_id || null,
        linked_supplier_proforma_number: form.linked_supplier_proforma_number || null,
        freight: Number(form.freight) || 0,
        notes: form.notes || null,
        difference_notes: differences.length > 0 ? form.difference_notes.trim() || null : null,
        documents: docs,
      };
      // Lines are mandatory (every invoice links to a PO that supplies them).
      payload.lines = payloadLines;
      if (isEdit && invoice) {
        await api.purchaseInvoices.update(invoice.id, payload);
      } else {
        await api.purchaseInvoices.create({ ...payload, clientId: userId, status: "draft" });
      }
    },
    onSuccess: () => {
      onCreated();
      qc.invalidateQueries({ queryKey: ["proformas"] });
      toast.success(isEdit ? "Purchase invoice updated" : "Purchase invoice recorded");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-border bg-card shadow-vault"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <div>
            <h3 className="font-display text-lg">
              {isEdit ? "Edit purchase invoice" : "New purchase invoice"}
            </h3>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Records the supplier payable — it never creates stock. The GRN (created later) credits
              inventory.
            </div>
          </div>
          <button onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-5 p-5"
        >
          {vendors.length === 0 && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
              Add a supplier first in the Suppliers tab.
            </div>
          )}

          {/* ── Header ── */}
          <fieldset className="rounded-lg border border-border/60 p-4">
            <legend className="px-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Invoice header
            </legend>
            <div className="grid gap-3 md:grid-cols-3">
              <L label="Supplier *">
                <SearchableSelect
                  value={form.vendor_id}
                  onChange={(v) => {
                    const po = pos.find((p) => p.id === form.goods_po_id);
                    if (po && po.supplier_id !== v) {
                      // The linked PO belongs to a different supplier — clear it
                      // so invoice lines can't come from the wrong PO.
                      setForm((f) => ({
                        ...f,
                        vendor_id: v,
                        goods_po_id: "",
                        goods_po_number: "",
                      }));
                      setLines([]);
                    } else {
                      setForm((f) => ({ ...f, vendor_id: v }));
                    }
                  }}
                  placeholder="Select supplier"
                  options={vendors.map((v: any) => ({ value: v.id, label: v.name }))}
                />
              </L>
              <L label="Supplier invoice number *">
                <input
                  required
                  maxLength={80}
                  className="inp"
                  value={form.invoice_number}
                  onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
                  placeholder="INV-2026-0142"
                />
              </L>
              <L label="Payment due date">
                <input
                  type="date"
                  className="inp"
                  value={effectiveDue}
                  onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                />
              </L>
              <L label="Invoice date">
                <input
                  required
                  type="date"
                  className="inp"
                  value={form.issue_date}
                  onChange={(e) => setForm({ ...form, issue_date: e.target.value })}
                />
              </L>
              <L label="Invoice received date">
                <input
                  type="date"
                  className="inp"
                  value={form.received_date}
                  onChange={(e) => setForm({ ...form, received_date: e.target.value })}
                />
              </L>
            </div>
          </fieldset>

          {/* ── Linked PO + lines ── */}
          <fieldset className="rounded-lg border border-border/60 p-4">
            <legend className="px-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Linked purchase order & item lines
            </legend>
            <L label="Linked purchase order *">
              <SearchableSelect
                value={form.goods_po_id}
                onChange={pickPo}
                placeholder="Select purchase order…"
                disabled={isEdit && !!invoice?.linked_goods_receipt_id}
                options={[
                  { value: "", label: "Select purchase order…" },
                  ...eligiblePos.map((p: any) => ({
                    value: p.id,
                    label: p.po_number,
                    hint: `${p.supplier_name ?? "—"} · ${p.status.replace(/_/g, " ")}`,
                  })),
                ]}
              />
            </L>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Every purchase invoice must link to a purchase order — picking it auto-fills the
              product lines, units and PO prices. Edit the billed quantity and price from the
              supplier invoice.
            </p>
            {isEdit && invoice?.linked_goods_receipt_number && (
              <div className="mt-2 rounded-md border border-success/30 bg-success/5 p-2 text-xs text-success">
                Linked GRN {invoice.linked_goods_receipt_number} — GRN received quantities are shown
                per line below.
              </div>
            )}{" "}
            {lines.length === 0 ? (
              <div className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
                Select a linked purchase order above — its product lines are required and
                auto-filled here.
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                <div className="hidden grid-cols-12 gap-2 text-[9px] uppercase tracking-widest text-muted-foreground md:grid">
                  <div className="col-span-3">SKU / Product</div>
                  <div className="col-span-1">Unit</div>
                  <div className="col-span-1">Ordered</div>
                  <div className="col-span-1">GRN recv</div>
                  <div className="col-span-1">Invoice qty</div>
                  <div className="col-span-1">Unit price</div>
                  <div className="col-span-1">GST %</div>
                  <div className="col-span-2 text-right">Line total</div>
                  <div className="col-span-1"></div>
                </div>
                {lines.map((l, i) => {
                  const qty = Number(l.invoice_qty) || 0;
                  const price = Number(l.unit_price) || 0;
                  const lineTotal = round2(qty * price);
                  const qtyDiff =
                    Number(l.grn_received_qty) > 0 &&
                    Math.abs(qty - Number(l.grn_received_qty)) > 1e-9;
                  const priceDiff =
                    l.po_unit_price != null &&
                    Number.isFinite(l.po_unit_price) &&
                    l.po_unit_price >= 0 &&
                    Math.abs(price - l.po_unit_price) > 1e-9;
                  return (
                    <div
                      key={i}
                      className="grid grid-cols-2 items-end gap-2 rounded-md border border-border/50 p-2 md:grid-cols-12"
                    >
                      <div className="col-span-2 md:col-span-3">
                        <div className="text-xs font-medium">{l.name}</div>
                        {l.sku && (
                          <div className="font-mono text-[10px] text-muted-foreground">{l.sku}</div>
                        )}
                        {(qtyDiff || priceDiff) && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {qtyDiff && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[9px] text-warning">
                                <AlertTriangle className="h-2.5 w-2.5" /> qty vs GRN
                              </span>
                            )}
                            {priceDiff && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[9px] text-warning">
                                <AlertTriangle className="h-2.5 w-2.5" /> price vs PO
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div>
                        <L label="Unit">
                          <input className="inp" value={l.unit} disabled />
                        </L>
                      </div>
                      <div>
                        <L label="Ordered">
                          <input className="inp" value={String(l.ordered_qty)} disabled />
                        </L>
                      </div>
                      <div>
                        <L label="GRN recv">
                          <input className="inp" value={String(l.grn_received_qty)} disabled />
                        </L>
                      </div>
                      <div>
                        <L label="Invoice qty">
                          <input
                            type="number"
                            min="0"
                            step="0.001"
                            className="inp"
                            value={l.invoice_qty}
                            onChange={(e) => setLine(i, { invoice_qty: e.target.value })}
                          />
                        </L>
                      </div>
                      <div>
                        <L label="Unit price">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="inp"
                            value={l.unit_price}
                            onChange={(e) => setLine(i, { unit_price: e.target.value })}
                          />
                        </L>
                      </div>
                      <div>
                        <L label="GST %">
                          <input
                            type="number"
                            min="0"
                            max="99"
                            step="0.01"
                            className="inp"
                            value={l.gst_rate}
                            onChange={(e) => setLine(i, { gst_rate: e.target.value })}
                            placeholder="0"
                          />
                        </L>
                      </div>
                      <div className="text-right">
                        <L label="Line total">
                          <div className="inp text-right font-mono tabular-nums">
                            {fmtMoney(lineTotal)}
                          </div>
                        </L>
                      </div>
                      <div className="flex items-end justify-end pb-1">
                        <button
                          type="button"
                          onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                          className="rounded p-1 text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </fieldset>

          {/* ── Advance deduction (optional purchase-proforma link) ── */}
          <fieldset className="rounded-lg border border-border/60 p-4">
            <legend className="px-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Advance deduction
            </legend>
            <div className="space-y-3">
              <L label="Linked supplier proforma (optional — deducts advances already paid)">
                <SearchableSelect
                  value={form.linked_supplier_proforma_id}
                  onChange={pickProforma}
                  placeholder="None — manual PO reference"
                  options={[
                    { value: "", label: "None — manual PO reference" },
                    ...(proformasQ.data ?? []).map((p: any) => ({
                      value: p.id,
                      label: p.proforma_number ?? p.po_number ?? p.id,
                      hint: p.debtor?.name ?? undefined,
                    })),
                  ]}
                />
              </L>
              {linkedPf && (
                <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
                  <div className="mb-1 font-medium uppercase tracking-widest text-primary">
                    Proforma {linkedPf.proforma_number ?? linkedPf.po_number ?? ""}
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
                    {linkedPf.proforma_date && <div>Date · {fmtDate(linkedPf.proforma_date)}</div>}
                    <div>Total · {fmtMoney(linkedPf.amount)}</div>
                    {pctAdvance > 0 && (
                      <div>
                        Advance · {linkedPf.advance_pct}% ={" "}
                        <span className="font-medium text-primary">{fmtMoney(pctAdvance)}</span>
                      </div>
                    )}
                    {linkedPf.supplier_contact && <div>Contact · {linkedPf.supplier_contact}</div>}
                    {linkedPf.supplier_gstin && <div>GSTIN · {linkedPf.supplier_gstin}</div>}
                    {linkedPf.payment_terms && <div>Terms · {linkedPf.payment_terms}</div>}
                    {linkedPf.valid_until && (
                      <div>Valid until · {fmtDate(linkedPf.valid_until)}</div>
                    )}
                    {linkedPf.expected_delivery_date && (
                      <div>Expected delivery · {fmtDate(linkedPf.expected_delivery_date)}</div>
                    )}
                  </div>
                </div>
              )}
              <L label="PO / proforma number (optional)">
                <input
                  className="inp"
                  value={form.po_number}
                  onChange={(e) => setForm({ ...form, po_number: e.target.value })}
                  placeholder="e.g. PF-2026-004"
                />
              </L>
              <p className="text-[10px] text-muted-foreground">
                Advances already paid to the supplier against the linked proforma are deducted from
                the invoice total — the net amount is what you owe. If no proforma, the full amount
                applies.
              </p>
              {form.po_number.trim() && (
                <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
                  <div className="mb-1 uppercase tracking-widest text-primary">
                    Advances paid against {form.po_number}
                  </div>
                  {advLookupQ.isFetching ? (
                    <div className="text-muted-foreground">Looking up…</div>
                  ) : (advLookupQ.data?.advances ?? []).length === 0 ? (
                    <div className="text-muted-foreground">
                      {pctAdvance > 0
                        ? `No cash advances recorded yet — deducting the agreed advance (${linkedPf?.advance_pct}% of the proforma).`
                        : "No advances recorded for this PO number on the purchase side — full amount applies."}
                    </div>
                  ) : (
                    <ul className="space-y-0.5">
                      {((advLookupQ.data?.advances ?? []) as any[]).map((a) => (
                        <li key={a.id} className="flex justify-between">
                          <span className="text-muted-foreground">
                            {fmtDate(a.advance_date)} {a.reference ? `· ${a.reference}` : ""}
                          </span>
                          <span className="num text-primary">{fmtMoney(a.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-2 flex justify-between border-t border-border pt-2 font-medium">
                    <span>Balance outstanding</span>
                    <span className="num">{fmtMoney(netPayable)}</span>
                  </div>
                </div>
              )}
            </div>
          </fieldset>

          {/* ── Totals ── */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1 rounded-lg border border-border/60 bg-muted/20 p-4 text-sm">
              <Row label="Subtotal" value={fmtMoney(totals.subtotal)} />
              <Row label="GST total" value={fmtMoney(totals.gst)} />
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-widest text-muted-foreground">
                  Freight / other
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="w-28 rounded-md border border-border bg-background px-2 py-1 text-right text-sm"
                  value={form.freight}
                  onChange={(e) => setForm({ ...form, freight: e.target.value })}
                />
              </div>
              <div className="flex items-center justify-between border-t border-border pt-1.5 font-medium">
                <span className="text-xs uppercase tracking-widest text-muted-foreground">
                  Grand total
                </span>
                <span className="num text-base">{fmtMoney(totals.grand)}</span>
              </div>
              {advanceToDeduct > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-widest text-muted-foreground">
                    {pctAdvance > 0
                      ? `Less advance (${linkedPf?.advance_pct}% of proforma)`
                      : "Less advance paid"}
                  </span>
                  <span className="num text-destructive">−{fmtMoney(advanceToDeduct)}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-widest text-muted-foreground">
                  Net payable
                </span>
                <span className="num">{fmtMoney(netPayable)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-widest text-muted-foreground">
                  Amount paid
                </span>
                <span className="num text-success">{fmtMoney(amountPaid)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-widest text-muted-foreground">
                  Balance due
                </span>
                <span
                  className={`num font-medium ${balanceDue > 0 ? "text-warning" : "text-success"}`}
                >
                  {fmtMoney(balanceDue)}
                </span>
              </div>
            </div>

            <div className="space-y-3">
              <L label="Notes">
                <textarea
                  rows={3}
                  className="inp resize-y"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Payment terms, delivery remarks…"
                />
              </L>
              <DocumentUploader
                userId={userId}
                scope="purchase_invoices"
                docs={docs}
                onChange={setDocs}
                hint="Attach the supplier invoice PDF/image or other supporting paperwork."
              />
            </div>
          </div>

          {/* ── Difference checks ── */}
          {differences.length > 0 && (
            <div className="rounded-lg border border-warning/40 bg-warning/5 p-4">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-warning">
                <AlertTriangle className="h-4 w-4" /> {differences.length} difference
                {differences.length === 1 ? "" : "s"} vs PO / GRN
              </div>
              <ul className="mt-2 space-y-1 text-xs">
                {differences.map((d, i) => (
                  <li
                    key={i}
                    className="flex flex-wrap justify-between gap-2 rounded-md border border-border/50 bg-card/60 px-3 py-1.5"
                  >
                    <span>{d.name}</span>
                    <span className="text-muted-foreground">
                      {d.type === "qty" ? (
                        <>
                          Invoice qty <b className="num text-foreground">{d.invoiceValue}</b> vs GRN
                          received <b className="num text-warning">{d.referenceValue}</b>
                        </>
                      ) : (
                        <>
                          Invoice price{" "}
                          <b className="num text-foreground">{fmtMoney(d.invoiceValue)}</b> vs PO
                          price <b className="num text-warning">{fmtMoney(d.referenceValue)}</b>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-2">
                <L label="Explanation note (recommended before approval)">
                  <textarea
                    rows={2}
                    className="inp resize-y"
                    value={form.difference_notes}
                    onChange={(e) => setForm({ ...form, difference_notes: e.target.value })}
                    placeholder="e.g. Price negotiated at invoicing; quantity adjusted for partial delivery…"
                  />
                </L>
              </div>
              {form.difference_notes.trim().length === 0 && (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Not required to save — but the checker will see these differences, so an
                  explanation speeds up approval.
                </p>
              )}
            </div>
          )}

          {isEdit && invoice?.status === "approved_for_payment" && !isAdmin && !isTreasury && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
              This invoice is approved for payment. Only treasury/admin can record payments — use
              the funding queue.
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <p className="text-[10px] text-muted-foreground">
              Saving never touches inventory — the confirmed GRN is the only stock-crediting
              document.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-border px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                disabled={save.isPending}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{" "}
                {isEdit ? "Save changes" : "Save draft"}
              </button>
            </div>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:disabled{opacity:.55}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}

function PurchaseDetailModal({
  invoice,
  grn,
  onClose,
}: {
  invoice: any;
  grn: GRNFragment | null;
  onClose: () => void;
}) {
  const lines = invoice?.lines ?? [];
  const subtotal = Number(invoice?.subtotal) || 0;
  const gstTotal = Number(invoice?.gst_total) || 0;
  const freight = Number(invoice?.freight) || 0;
  const grandTotal = Number(invoice?.grand_total) || Number(invoice?.amount) || 0;
  const advance = Number(invoice?.advance_deducted ?? 0);
  const netAmount = Number(invoice?.amount ?? Math.max(0, grandTotal - advance));
  const amountPaid = Number(invoice?.amount_paid) || 0;
  const balanceDue =
    invoice?.balance_due != null
      ? Number(invoice.balance_due)
      : Math.max(0, netAmount - amountPaid);

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
          <div>
            <h3 className="font-display text-lg">Purchase invoice {invoice.invoice_number}</h3>
            <div className="mt-1">
              <StatusPill
                status={invoice.status}
                label={PI_STATUS_LABELS[invoice.status] ?? invoice.status}
              />
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-5 p-5 text-sm">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <D label="Supplier" value={invoice.supplier_name ?? invoice.vendor?.name ?? "—"} />
            <D
              label="Invoice date"
              value={invoice.issue_date ? fmtDate(invoice.issue_date) : "—"}
            />
            <D
              label="Received date"
              value={invoice.received_date ? fmtDate(invoice.received_date) : "—"}
            />
            <D label="Due date" value={invoice.due_date ? fmtDate(invoice.due_date) : "—"} />
            <D label="Linked PO" value={invoice.goods_po_number ?? invoice.po_number ?? "—"} />
            {invoice.linked_supplier_proforma_number && (
              <D label="Linked proforma" value={invoice.linked_supplier_proforma_number} />
            )}
            <D label="Linked GRN" value={invoice.linked_goods_receipt_number ?? "—"} />
            {invoice.paid_date && <D label="Paid date" value={fmtDate(invoice.paid_date)} />}
            {invoice.po_amount != null && invoice.po_amount > 0 && (
              <D
                label="PO amount"
                value={<span className="num">{fmtMoney(invoice.po_amount)}</span>}
              />
            )}
          </div>

          {lines.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-border/60">
              <table className="w-full text-sm">
                <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-3 py-2 text-left font-normal">Product</th>
                    <th className="px-3 py-2 text-right font-normal">Ordered</th>
                    <th className="px-3 py-2 text-right font-normal">GRN recv</th>
                    <th className="px-3 py-2 text-right font-normal">Invoice qty</th>
                    <th className="px-3 py-2 text-right font-normal">Unit price</th>
                    <th className="px-3 py-2 text-right font-normal">GST %</th>
                    <th className="px-3 py-2 text-right font-normal">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l: any) => {
                    const qty = Number(l.invoice_qty) || 0;
                    const grnQty = Number(l.grn_received_qty) || 0;
                    const price = Number(l.unit_price) || 0;
                    const qtyDiff = grnQty > 0 && Math.abs(qty - grnQty) > 1e-9;
                    const priceDiff =
                      l.po_unit_price != null &&
                      Number.isFinite(l.po_unit_price) &&
                      l.po_unit_price >= 0 &&
                      Math.abs(price - l.po_unit_price) > 1e-9;
                    return (
                      <tr key={l.product_id} className="border-b border-border/40">
                        <td className="px-3 py-2">
                          <div className="font-medium">{l.name}</div>
                          {l.sku && (
                            <div className="text-[10px] font-mono text-muted-foreground">
                              {l.sku}
                            </div>
                          )}
                          {(qtyDiff || priceDiff) && (
                            <div className="mt-0.5 flex gap-1">
                              {qtyDiff && (
                                <span className="text-[9px] font-medium text-warning">
                                  qty ≠ GRN
                                </span>
                              )}
                              {priceDiff && (
                                <span className="text-[9px] font-medium text-warning">
                                  price ≠ PO
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right num">{Number(l.ordered_qty) || 0}</td>
                        <td className="px-3 py-2 text-right num">{grnQty}</td>
                        <td className="px-3 py-2 text-right num">{qty}</td>
                        <td className="px-3 py-2 text-right num">{fmtMoney(price)}</td>
                        <td className="px-3 py-2 text-right num">{l.gst_rate ?? 0}%</td>
                        <td className="px-3 py-2 text-right num">
                          {fmtMoney(Number(l.line_total) || 0)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="ml-auto max-w-xs space-y-1 rounded-lg border border-border/60 bg-muted/20 p-4">
            <Row label="Subtotal" value={fmtMoney(subtotal)} />
            <Row label="GST total" value={fmtMoney(gstTotal)} />
            <Row label="Freight / other" value={fmtMoney(freight)} />
            <div className="flex items-center justify-between border-t border-border pt-1.5 font-medium">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">
                Grand total
              </span>
              <span className="num text-base">{fmtMoney(grandTotal)}</span>
            </div>
            {advance > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-widest text-muted-foreground">
                  Less advance paid
                </span>
                <span className="num text-destructive">−{fmtMoney(advance)}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">
                Net payable
              </span>
              <span className="num">{fmtMoney(netAmount)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">
                Amount paid
              </span>
              <span className="num text-success">{fmtMoney(amountPaid)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">
                Balance due
              </span>
              <span
                className={`num font-medium ${balanceDue > 0 ? "text-warning" : "text-success"}`}
              >
                {fmtMoney(balanceDue)}
              </span>
            </div>
          </div>

          {invoice.difference_notes && (
            <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-warning">
              <span className="font-medium uppercase tracking-widest">Difference note: </span>
              {invoice.difference_notes}
            </div>
          )}

          {grn && (
            <div className="rounded-md border border-success/30 bg-success/5 p-3 text-xs text-success">
              Linked GRN {grn.receipt_number} ·{" "}
              {grn.status === "confirmed" ? "stock credited" : grn.status}
            </div>
          )}

          {invoice.notes && (
            <div className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Notes: </span>
              {invoice.notes}
            </div>
          )}

          {(invoice.documents ?? []).length > 0 && (
            <div>
              <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">
                Attachments
              </span>
              <div className="flex flex-wrap gap-2">
                {(invoice.documents ?? []).map((d: any, i: number) => (
                  <a
                    key={i}
                    href={d.url ?? d.public_url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border border-border px-2.5 py-1 text-xs text-primary hover:bg-primary/5"
                  >
                    {d.name ?? `Attachment ${i + 1}`}
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end border-t border-border pt-3">
            <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function D({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}
