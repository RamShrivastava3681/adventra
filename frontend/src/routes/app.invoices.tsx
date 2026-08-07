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
import {
  Plus,
  X,
  Loader2,
  Send,
  Copy,
  Eye,
  Mail,
  Banknote,
  FileCheck,
  Ban,
  Trash2,
} from "lucide-react";
import { TableSkeleton } from "@/components/skeletons";
import { toast } from "sonner";
import { DocumentUploader, type DocMeta } from "@/components/document-uploader";
import { SearchableSelect } from "@/components/ui/searchable-select";

export const Route = createFileRoute("/app/invoices")({
  component: InvoicesPage,
});

type InvLine = {
  product_id: string;
  sku: string | null;
  name: string;
  unit: string;
  quantity: number;
  unit_price: number;
  discount_pct: number | null;
  gst_rate: number | null;
  line_total: number;
};

type Inv = {
  id: string;
  client_id: string;
  debtor_id: string | null;
  debtor?: {
    name?: string;
    contact_email?: string;
    contact_phone?: string;
    address_line?: string;
    city?: string;
    country?: string;
  } | null;
  invoice_number: string;
  amount: number;
  issue_date: string;
  due_date: string;
  status: string;
  advance_rate: number | null;
  paid_date: string | null;
  amount_received: number | null;
  receipt_date: string | null;
  short_payment: number | null;
  late_days: number | null;
  po_number: string | null;
  po_date: string | null;
  po_amount: number | null;
  customer_contact: string | null;
  billing_address: string | null;
  delivery_address: string | null;
  goods_sales_order_id: string | null;
  goods_sales_order_number: string | null;
  payment_terms: string | null;
  lines: InvLine[];
  subtotal_goods: number;
  total_discount: number;
  gst_total: number;
  freight: number;
  grand_total: number;
  notes: string | null;
  documents: DocMeta[];
  noa_status: string;
  noa_token: string | null;
  noa_comments: string | null;
  linked_customer_proforma_id: string | null;
  linked_customer_proforma_number: string | null;
  advance_deducted: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const DOC_LABELS: Record<string, string> = {
  draft: "Draft",
  pending: "Issued",
  approved: "Approved",
  funded: "Funded",
  advanced: "Advanced",
  paid: "Paid",
  partially_paid: "Partially Paid",
  overdue: "Overdue",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

function InvoicesPage() {
  const { isAdmin, isChecker, isClient, isTreasury, user } = useAuth();
  const canReview = isAdmin || isChecker;
  const canCreate = isAdmin || (isClient && !isChecker && !isTreasury);
  const canRecordPayment = isAdmin || isTreasury;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Inv | null>(null);
  const [viewing, setViewing] = useState<Inv | null>(null);
  const [paying, setPaying] = useState<Inv | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const invoicesQ = useQuery({
    queryKey: ["invoices", "list"],
    queryFn: async () => {
      const data = await api.invoices.list();
      return data.reverse();
    },
  });

  const debtorsQ = useQuery({
    queryKey: ["debtors"],
    queryFn: async () => {
      const data = await api.debtors.list();
      return data.map((d: any) => ({
        id: d.id,
        name: d.name,
        payment_terms_days: d.paymentTermsDays ?? d.payment_terms_days,
      }));
    },
  });

  const sendNoa = useMutation({
    mutationFn: async (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const patch: any = { noa_status: "sent", noa_sent_at: new Date().toISOString() };
      await api.invoices.update(id, patch);
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      const inv = (invoicesQ.data ?? []).find((x: any) => x.id === id);
      const link = `${window.location.origin}/noa/${inv?.noa_token}`;
      navigator.clipboard?.writeText(link).catch(() => {});
      toast.success(`NOA link copied — share with ${inv?.debtor?.contact_email || "debtor"}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const copyNoa = (i: any) => {
    const link = `${window.location.origin}/noa/${i.noa_token}`;
    navigator.clipboard?.writeText(link).catch(() => {});
    toast.success("NOA link copied");
  };

  const sendReminder = useMutation({
    mutationFn: async (invoiceId: string) => {
      return api.reminders.send(invoiceId);
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["reminder-logs"] });
      toast.success(data.message || "Reminder sent successfully");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to send reminder"),
  });

  const issue = useMutation({
    mutationFn: async (id: string) => api.invoices.issue(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Invoice issued — submitted for review");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const cancel = useMutation({
    mutationFn: async (id: string) => api.invoices.update(id, { status: "cancelled" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Invoice cancelled");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const del = useMutation({
    mutationFn: async (id: string) => api.invoices.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Draft removed");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const filtered = (invoicesQ.data ?? []).filter((i) => filter === "all" || i.status === filter);

  const counts = useMemo(() => {
    const arr = invoicesQ.data ?? [];
    return {
      draft: arr.filter((i) => i.status === "draft").length,
      pending: arr.filter((i) => i.status === "pending").length,
      approved: arr.filter((i) => ["approved", "funded", "advanced"].includes(i.status)).length,
      paid: arr.filter((i) => i.status === "paid" || i.status === "partially_paid").length,
    };
  }, [invoicesQ.data]);

  return (
    <div>
      <PageHeader
        eyebrow="Invoices"
        title={isAdmin ? "Invoice queue" : "Your invoices"}
        description="Sales invoices bill the customer after goods are dispatched. Creating an invoice never reduces stock — only a confirmed dispatch debits inventory. Drafts are issued into the checker review, then the funding queue."
        breadcrumbs={[{ label: "Dashboard", href: "/app/dashboard" }, { label: "Invoices" }]}
        actions={
          canCreate ? (
            <button
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              <Plus className="h-4 w-4" /> New invoice
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
              Read-only · {isChecker ? "Checker" : isTreasury ? "Treasury" : "View"}
            </span>
          )
        }
      />

      <div className="p-6 md:p-10 space-y-6">
        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["all", "All", null],
              ["draft", "Drafts", counts.draft],
              ["pending", "Issued", counts.pending],
              ["approved", "Funding queue", counts.approved],
              ["paid", "Paid", counts.paid],
              ["overdue", "Overdue", null],
              ["cancelled", "Cancelled", null],
            ] as const
          ).map(([k, label, n]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs uppercase tracking-widest transition ${
                filter === k
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
              {n != null && n > 0 && (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground">
                  {n}
                </span>
              )}
            </button>
          ))}
        </div>

        <Card>
          {invoicesQ.isLoading ? (
            <TableSkeleton rows={7} cols={9} />
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No invoices.</div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Invoice</th>
                    {isAdmin && <th className="px-5 py-2 text-left font-normal">Client</th>}
                    <th className="px-5 py-2 text-left font-normal">Customer</th>
                    <th className="px-5 py-2 text-right font-normal">Grand total</th>
                    <th className="px-5 py-2 text-right font-normal">Received</th>
                    <th className="px-5 py-2 text-right font-normal">Balance</th>
                    <th className="px-5 py-2 text-left font-normal">Due</th>
                    <th className="px-5 py-2 text-left font-normal">Status</th>
                    <th className="px-5 py-2 text-left font-normal">NOA</th>
                    <th className="px-5 py-2 text-right font-normal">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((i: any) => {
                    const grandTotal = Number(i.grand_total ?? i.amount ?? 0);
                    const advance = Number(i.advance_deducted ?? 0);
                    const netAmount = Number(i.amount ?? Math.max(0, grandTotal - advance));
                    const received = Number(i.amount_received ?? 0);
                    const balance = Math.max(0, netAmount - received);
                    const dpd = i.due_date && i.status !== "paid" ? daysBetween(i.due_date) : 0;
                    const lateDays =
                      i.status === "paid"
                        ? i.late_days != null
                          ? Number(i.late_days)
                          : 0
                        : Math.max(0, dpd);
                    return (
                      <tr key={i.id} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-3">
                          <div className="font-mono text-xs">{i.invoice_number}</div>
                          {i.goods_sales_order_number && (
                            <div className="text-[10px] text-muted-foreground">
                              SO {i.goods_sales_order_number}
                            </div>
                          )}
                          {i.linked_customer_proforma_number && (
                            <div className="text-[10px] text-muted-foreground">
                              PF {i.linked_customer_proforma_number}
                            </div>
                          )}
                          {advance > 0 && (
                            <div className="text-[10px] text-muted-foreground">
                              Less advance {fmtMoney(advance)}
                            </div>
                          )}
                          {i.po_number && (
                            <div className="text-[10px] text-muted-foreground">
                              PO {i.po_number}
                              {i.po_date ? ` · ${fmtDate(i.po_date)}` : ""}
                              {i.po_amount ? ` · ${fmtMoney(i.po_amount)}` : ""}
                            </div>
                          )}
                        </td>
                        {isAdmin && (
                          <td className="px-5 py-3 text-muted-foreground">
                            {i.client?.company_name ?? "—"}
                          </td>
                        )}
                        <td className="px-5 py-3">{i.debtor?.name ?? "—"}</td>
                        <td className="px-5 py-3 text-right num">{fmtMoney(grandTotal)}</td>
                        <td className="px-5 py-3 text-right num text-success">
                          {received > 0 ? fmtMoney(received) : "—"}
                        </td>
                        <td
                          className={`px-5 py-3 text-right num ${balance > 0 ? "text-warning" : "text-muted-foreground"}`}
                        >
                          {fmtMoney(balance)}
                        </td>
                        <td className="px-5 py-3 text-sm">{fmtDate(i.due_date)}</td>
                        <td className="px-5 py-3">
                          <div className="flex flex-col items-start gap-1">
                            <StatusPill status={i.status} label={DOC_LABELS[i.status]} />
                            {i.status === "pending" && i.noa_status === "not_sent" && (
                              <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
                                NOA before review
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <NoaBadge status={i.noa_status} />
                          {i.noa_comments && (
                            <div
                              className="mt-1 max-w-[160px] truncate text-[10px] text-muted-foreground"
                              title={i.noa_comments}
                            >
                              “{i.noa_comments}”
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="inline-flex flex-wrap justify-end gap-1">
                            <button
                              onClick={() => setViewing(i)}
                              className="rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary"
                            >
                              View
                            </button>
                            {canCreate &&
                              ["draft", "pending"].includes(i.status) &&
                              i.status !== "cancelled" && (
                                <button
                                  onClick={() => setEditing(i)}
                                  className="rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary"
                                >
                                  Edit
                                </button>
                              )}
                            {canCreate && i.status === "draft" && (
                              <button
                                onClick={() => issue.mutate(i.id)}
                                disabled={issue.isPending}
                                className="inline-flex items-center gap-1 rounded-md border border-primary/50 px-2 py-1 text-[10px] text-primary hover:bg-primary/10 disabled:opacity-50"
                              >
                                <FileCheck className="h-3 w-3" /> Issue
                              </button>
                            )}
                            <Link
                              to="/app/invoice-preview/$id"
                              params={{ id: i.id }}
                              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary"
                              title="Preview & download PDF"
                            >
                              <Eye className="h-3 w-3" /> Preview
                            </Link>
                            {canRecordPayment &&
                              !["paid", "cancelled", "rejected"].includes(i.status) && (
                                <button
                                  onClick={() => setPaying(i)}
                                  className="inline-flex items-center gap-1 rounded-md border border-success/50 px-2 py-1 text-[10px] text-success hover:bg-success/10"
                                >
                                  <Banknote className="h-3 w-3" /> Record payment
                                </button>
                              )}
                            {isAdmin &&
                              i.status !== "paid" &&
                              i.status !== "rejected" &&
                              i.status !== "cancelled" &&
                              i.due_date && (
                                <button
                                  onClick={() => sendReminder.mutate(i.id)}
                                  disabled={sendReminder.isPending}
                                  className="inline-flex items-center gap-1 rounded-md border border-amber-400/50 px-2 py-1 text-[10px] text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/20 disabled:opacity-50"
                                  title="Send reminder email for this invoice"
                                >
                                  <Mail className="h-3 w-3" /> Remind
                                </button>
                              )}
                            {i.noa_status === "not_sent" && (
                              <button
                                onClick={() => sendNoa.mutate(i.id)}
                                className="inline-flex items-center gap-1 rounded-md border border-primary/50 px-2 py-1 text-[10px] text-primary hover:bg-primary/10"
                              >
                                <Send className="h-3 w-3" /> Send NOA
                              </button>
                            )}
                            {i.noa_status !== "not_sent" && (
                              <button
                                onClick={() => copyNoa(i)}
                                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] hover:bg-muted"
                              >
                                <Copy className="h-3 w-3" /> Copy NOA link
                              </button>
                            )}
                            {isAdmin &&
                              i.status === "pending" &&
                              (canReview ? (
                                <Link
                                  to="/app/checker"
                                  className="text-[10px] uppercase tracking-widest text-primary hover:underline"
                                >
                                  Review →
                                </Link>
                              ) : (
                                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                                  Awaiting checker
                                </span>
                              ))}
                            {isAdmin &&
                              (i.status === "approved" ||
                                i.status === "advanced" ||
                                i.status === "funded") && (
                                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                                  In funding queue
                                </span>
                              )}
                            {canCreate &&
                              ["draft", "pending"].includes(i.status) &&
                              i.status !== "cancelled" && (
                                <button
                                  onClick={() => cancel.mutate(i.id)}
                                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:border-destructive hover:text-destructive"
                                >
                                  <Ban className="h-3 w-3" /> Cancel
                                </button>
                              )}
                            {canCreate && i.status === "draft" && (
                              <button
                                onClick={() => del.mutate(i.id)}
                                className="text-muted-foreground hover:text-destructive"
                                title="Delete draft"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
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

      {open && (
        <NewInvoiceModal
          onClose={() => setOpen(false)}
          debtors={debtorsQ.data ?? []}
          userId={user!.id}
        />
      )}
      {editing && (
        <NewInvoiceModal
          invoice={editing}
          onClose={() => setEditing(null)}
          debtors={debtorsQ.data ?? []}
          userId={user!.id}
        />
      )}
      {viewing && <InvoiceDetailModal invoice={viewing} onClose={() => setViewing(null)} />}
      {paying && <PaymentModal invoice={paying} onClose={() => setPaying(null)} />}
    </div>
  );
}

function NoaBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    not_sent: { label: "Not sent", cls: "border-border text-muted-foreground" },
    sent: { label: "Awaiting reply", cls: "border-warning/50 text-warning" },
    accepted: { label: "Accepted", cls: "border-success/50 text-success" },
    rejected: { label: "Rejected", cls: "border-destructive/50 text-destructive" },
    commented: { label: "Commented", cls: "border-primary/50 text-primary" },
  };
  const v = map[status] ?? map.not_sent;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${v.cls}`}
    >
      {v.label}
    </span>
  );
}

// ─── New / Edit invoice modal (catalogue-backed goods invoice) ───────────
type LineDraft = {
  product_id: string;
  sku: string | null;
  name: string;
  unit: string;
  quantity: string;
  unit_price: string;
  discount_pct: string;
  gst_rate: string;
};

function NewInvoiceModal({
  invoice,
  onClose,
  debtors,
  userId,
}: {
  invoice?: Inv;
  onClose: () => void;
  debtors: any[];
  userId: string;
}) {
  const qc = useQueryClient();
  const isEdit = !!invoice;
  const [form, setForm] = useState({
    invoice_number: invoice?.invoice_number ?? "",
    debtor_id: invoice?.debtor_id ?? debtors[0]?.id ?? "",
    issue_date:
      (invoice?.issue_date ?? new Date().toISOString().slice(0, 10))?.slice(0, 10) ??
      new Date().toISOString().slice(0, 10),
    due_date: (invoice?.due_date ?? "")?.slice(0, 10) ?? "",
    customer_contact: invoice?.customer_contact ?? "",
    billing_address: invoice?.billing_address ?? "",
    delivery_address: invoice?.delivery_address ?? "",
    goods_sales_order_id: invoice?.goods_sales_order_id ?? "",
    payment_terms: invoice?.payment_terms ?? "",
    po_number: invoice?.po_number ?? "",
    po_date: (invoice?.po_date ?? "")?.slice(0, 10) ?? "",
    po_amount: invoice?.po_amount != null ? String(invoice.po_amount) : "",
    linked_customer_proforma_id: invoice?.linked_customer_proforma_id ?? "",
    linked_customer_proforma_number: invoice?.linked_customer_proforma_number ?? "",
    freight: invoice?.freight != null ? String(invoice.freight) : "",
    notes: invoice?.notes ?? "",
  });
  const [lines, setLines] = useState<LineDraft[]>(
    (invoice?.lines ?? []).map((l) => ({
      product_id: l.product_id,
      sku: l.sku,
      name: l.name,
      unit: l.unit,
      quantity: String(l.quantity),
      unit_price: String(l.unit_price),
      discount_pct: l.discount_pct != null ? String(l.discount_pct) : "",
      gst_rate: l.gst_rate != null ? String(l.gst_rate) : "",
    })),
  );
  const [docs, setDocs] = useState<DocMeta[]>(invoice?.documents ?? []);
  const [soSource, setSoSource] = useState(invoice?.goods_sales_order_id ?? "");

  const setLine = (i: number, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  // Product catalogue for the line editor.
  const productsQ = useQuery({
    queryKey: ["products-for-invoice-lines"],
    queryFn: async () => {
      const data = await api.products.list();
      return (data ?? []).filter((p: any) => p.status === "active");
    },
  });

  // Sales orders available to create the invoice from.
  const sosQ = useQuery({
    queryKey: ["sos-for-invoice"],
    queryFn: async () => api.goodsSalesOrders.list(),
  });

  // Only open (confirmed+) sales orders can be invoiced. Keep the currently
  // linked order visible when editing an invoice tied to a draft/cancelled one.
  const soOptions = useMemo(() => {
    const open = (sosQ.data ?? []).filter((s: any) => !["draft", "cancelled"].includes(s.status));
    if (soSource && !open.some((s: any) => s.id === soSource)) {
      const cur = (sosQ.data ?? []).find((s: any) => s.id === soSource);
      if (cur) return [...open, cur];
    }
    return open;
  }, [sosQ.data, soSource]);

  // Sales proformas available to formally link (drives the advance deduction).
  const proformasQ = useQuery({
    queryKey: ["sales-proformas-for-invoice"],
    queryFn: async () => {
      const data = await api.purchaseOrders.list();
      return (data ?? []).filter((p: any) => p.side === "sales");
    },
  });

  // Lookup proformas/advances by PO number (sales side) once user enters a PO #.
  const poLookupQ = useQuery({
    queryKey: ["po-lookup-sales", form.po_number],
    enabled: !!form.po_number.trim(),
    queryFn: async () => {
      const po = form.po_number.trim();
      const orders = await api.purchaseOrders.list();
      const pfs = orders.filter(
        (o: any) => o.side === "sales" && (o.po_number === po || o.proforma_number === po),
      );
      const pfIds = pfs.map((p: any) => p.id);
      let advances: any[] = [];
      if (pfIds.length) {
        const allAdvances = await api.advances.list();
        advances = allAdvances.filter(
          (a: any) =>
            a.side === "sales" &&
            pfIds.includes(a.purchaseOrderId ?? a.purchase_order_id) &&
            a.status !== "refunded",
        );
      }
      return { proformas: pfs, advances };
    },
  });

  const advancesTotal = ((poLookupQ.data?.advances ?? []) as any[])
    .filter((a) => a.status !== "refunded")
    .reduce((s, a) => s + Number(a.amount), 0);

  // Pick a linked proforma → set the formal link, PO reference and amount.
  const pickProforma = (id: string) => {
    const pf = (proformasQ.data ?? []).find((p: any) => p.id === id) as any;
    setForm((f) => ({
      ...f,
      linked_customer_proforma_id: id,
      linked_customer_proforma_number: id ? (pf?.proforma_number ?? pf?.po_number ?? "") : "",
      po_number: id ? (pf?.proforma_number ?? pf?.po_number ?? f.po_number) : f.po_number,
      po_amount:
        id && pf?.po_amount != null && Number(pf.po_amount) > 0
          ? String(pf.po_amount)
          : id === ""
            ? ""
            : f.po_amount,
    }));
  };

  // When a typed PO number uniquely matches one sales proforma, formalize the
  // link automatically so the deduction is applied to the stored amount.
  const autoLinkedPf = useRef<string>("");
  useEffect(() => {
    const pfs = (poLookupQ.data?.proformas ?? []) as any[];
    if (pfs.length !== 1) return;
    const pf = pfs[0];
    if (form.linked_customer_proforma_id && form.linked_customer_proforma_id !== pf.id) return;
    if (autoLinkedPf.current === pf.id) return;
    autoLinkedPf.current = pf.id;
    setForm((f) => ({
      ...f,
      linked_customer_proforma_id: pf.id,
      linked_customer_proforma_number: pf.proforma_number ?? pf.po_number ?? "",
    }));
  }, [poLookupQ.data, form.linked_customer_proforma_id]);

  // Pick a sales order → auto-fill lines + customer + addresses + terms.
  const pickSo = (id: string) => {
    setSoSource(id);
    if (!id) {
      setForm((f) => ({ ...f, goods_sales_order_id: "" }));
      return;
    }
    const so = (sosQ.data ?? []).find((x: any) => x.id === id);
    if (!so) return;
    setForm((f) => ({
      ...f,
      debtor_id: so.customer_id ?? f.debtor_id,
      customer_contact: so.contact_person ?? f.customer_contact,
      billing_address: so.billing_address ?? f.billing_address,
      delivery_address: so.delivery_address ?? f.delivery_address,
      payment_terms: so.payment_terms ?? f.payment_terms,
      due_date: (so.expected_delivery_date ?? "").slice(0, 10) || f.due_date,
      goods_sales_order_id: so.id,
    }));
    setLines(
      (so.lines ?? [])
        .filter((l: any) => Number(l.ordered_qty) > 0)
        .map((l: any) => ({
          product_id: l.product_id,
          sku: l.sku,
          name: l.name,
          unit: l.unit || "piece",
          quantity: String(l.ordered_qty),
          unit_price: String(l.unit_price ?? ""),
          discount_pct: l.discount_pct != null ? String(l.discount_pct) : "",
          gst_rate: l.gst_rate != null ? String(l.gst_rate) : "",
        })),
    );
  };

  const totals = useMemo(() => {
    const subtotal = round2(
      lines.reduce(
        (s, l) =>
          s +
          (Number(l.quantity) || 0) *
            (Number(l.unit_price) || 0) *
            (1 - (Number(l.discount_pct) || 0) / 100),
        0,
      ),
    );
    const grossTotal = round2(
      lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0),
    );
    const totalDiscount = round2(grossTotal - subtotal);
    const gstTotal = round2(
      lines.reduce(
        (s, l) =>
          s +
          ((Number(l.quantity) || 0) *
            (Number(l.unit_price) || 0) *
            (1 - (Number(l.discount_pct) || 0) / 100) *
            (Number(l.gst_rate) || 0)) /
            100,
        0,
      ),
    );
    const freight = Number(form.freight) || 0;
    const grandTotal = round2(subtotal + gstTotal + freight);
    const balanceDue = Math.max(0, grandTotal - advancesTotal);
    return { subtotal, totalDiscount, gstTotal, freight, grandTotal, balanceDue };
  }, [lines, form.freight, advancesTotal]);

  // Auto-fill the PO amount from the matched proforma once per PO number entry.
  const lastFetchedPo = useRef<string>("");
  useEffect(() => {
    if (!form.po_number.trim()) {
      lastFetchedPo.current = "";
      return;
    }
    const pfs = (poLookupQ.data?.proformas ?? []) as any[];
    const withAmount = pfs.find((p: any) => p.po_amount != null && Number(p.po_amount) > 0);
    if (withAmount && form.po_number.trim() !== lastFetchedPo.current) {
      lastFetchedPo.current = form.po_number.trim();
      setForm((f) => ({ ...f, po_amount: String(withAmount.po_amount) }));
    }
  }, [poLookupQ.data, form.po_number]);

  // Auto-derive due date from the debtor's payment terms.
  const selectedDebtor = debtors.find((d: any) => d.id === form.debtor_id);
  const termsDays = Number(selectedDebtor?.payment_terms_days ?? 30) || 30;
  const computedDue = (() => {
    if (!form.issue_date) return "";
    const d = new Date(form.issue_date);
    d.setDate(d.getDate() + termsDays);
    return d.toISOString().slice(0, 10);
  })();
  const effectiveDue = form.due_date || computedDue;

  const save = useMutation({
    // `issueNow` only applies when CREATING — an edit preserves the current
    // status (never sends status back, so an issued invoice can't be reset).
    mutationFn: async ({ issueNow }: { issueNow: boolean }) => {
      if (!form.debtor_id) throw new Error("Please add a debtor first.");
      if (lines.length === 0) throw new Error("Add at least one product line");
      const payloadLines = lines.map((l) => ({
        product_id: l.product_id,
        sku: l.sku,
        name: l.name,
        unit: l.unit || "piece",
        quantity: Number(l.quantity) || 0,
        unit_price: Number(l.unit_price) || 0,
        discount_pct: l.discount_pct ? Number(l.discount_pct) : null,
        gst_rate: l.gst_rate ? Number(l.gst_rate) : null,
      }));
      for (const l of payloadLines) {
        if (!l.product_id) throw new Error("Every line must select a product from the catalogue");
        if (!(l.quantity > 0)) throw new Error("Quantity must be greater than zero");
        if (l.unit_price < 0)
          throw new Error("Unit selling price must be greater than or equal to zero");
        if (l.discount_pct != null && (l.discount_pct < 0 || l.discount_pct > 100))
          throw new Error("Discount must be between 0 and 100%");
      }

      // The sales order link is mandatory and the invoice must match it.
      const soId = soSource || form.goods_sales_order_id;
      if (!soId) throw new Error("Select a sales order — every invoice must be linked to one");
      const linkedSo = (sosQ.data ?? []).find((x: any) => x.id === soId);
      if (!linkedSo) throw new Error("Linked sales order not found");
      if (["draft", "cancelled"].includes(linkedSo.status)) {
        throw new Error("Confirm the sales order before invoicing");
      }
      if (form.debtor_id && linkedSo.customer_id && form.debtor_id !== linkedSo.customer_id) {
        throw new Error("The invoice customer must match the linked sales order's customer");
      }
      for (const l of payloadLines) {
        const soLine = (linkedSo.lines ?? []).find((x: any) => x.product_id === l.product_id);
        if (!soLine) throw new Error(`"${l.name}" is not on the linked sales order`);
        if (l.quantity > Number(soLine.ordered_qty)) {
          throw new Error(
            `Quantity ${l.quantity} for ${soLine.name} exceeds the ordered quantity (${Number(soLine.ordered_qty)}) on the sales order`,
          );
        }
      }

      const payload: Record<string, unknown> = {
        debtor_id: form.debtor_id,
        invoice_number: form.invoice_number.trim() || undefined,
        issue_date: form.issue_date,
        due_date: effectiveDue,
        source: "goods",
        customer_contact: form.customer_contact.trim() || null,
        billing_address: form.billing_address.trim() || null,
        delivery_address: form.delivery_address.trim() || null,
        goods_sales_order_id: soId,
        payment_terms: form.payment_terms.trim() || null,
        po_number: form.po_number || null,
        po_date: form.po_date || null,
        po_amount: form.po_amount ? Number(form.po_amount) : null,
        linked_customer_proforma_id: form.linked_customer_proforma_id || null,
        linked_customer_proforma_number: form.linked_customer_proforma_number || null,
        freight: Number(form.freight) || 0,
        notes: form.notes.trim() || null,
        documents: docs,
        lines: payloadLines,
      };

      if (isEdit && invoice) {
        await api.invoices.update(invoice.id, payload);
      } else {
        payload.status = issueNow ? "pending" : "draft";
        await api.invoices.create({ ...payload, clientId: userId });
        // Mark advances linked to matching proformas as applied (sales side).
        const advs = (poLookupQ.data?.advances ?? []) as any[];
        if (form.po_number.trim() && advs.length) {
          for (const a of advs) {
            try {
              await api.advances.update(a.id, { status: "applied" });
            } catch {}
          }
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["purchase_orders"] });
      qc.invalidateQueries({ queryKey: ["advances"] });
      qc.invalidateQueries({ queryKey: ["proformas"] });
      toast.success(isEdit ? "Invoice updated" : "Invoice created");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const pickProduct = (i: number, id: string) => {
    const p = (productsQ.data ?? []).find((x: any) => x.id === id);
    setLine(i, {
      product_id: id,
      name: p?.name ?? "",
      sku: p?.sku ?? null,
      unit: p?.unit_of_measure ?? "piece",
      unit_price: p?.unit_price != null ? String(p.unit_price) : "",
      gst_rate: p?.gst_rate != null ? String(p.gst_rate) : "",
    });
  };

  const addLine = () =>
    setLines((ls) => [
      ...ls,
      {
        product_id: "",
        sku: null,
        name: "",
        unit: "piece",
        quantity: "",
        unit_price: "",
        discount_pct: "",
        gst_rate: "",
      },
    ]);

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
          <h3 className="font-display text-lg">{isEdit ? "Edit invoice" : "New invoice"}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ issueNow: true });
          }}
          className="space-y-5 p-5"
        >
          {debtors.length === 0 && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
              No debtors exist yet. Ask your factor admin to add one in the Debtors tab.
            </div>
          )}

          {/* Create from Sales Order */}
          <fieldset className="rounded-lg border border-border/60 p-4">
            <legend className="px-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Create from Sales Order
            </legend>
            <L label="Linked sales order * (mandatory — auto-fills lines, customer, terms)">
              <SearchableSelect
                value={soSource}
                onChange={pickSo}
                placeholder="Select a confirmed sales order…"
                options={[
                  { value: "", label: "Select a confirmed sales order…" },
                  ...soOptions.map((so: any) => ({
                    value: so.id,
                    label: so.so_number,
                    hint: `${so.customer_name ?? "—"} · ${so.status}`,
                  })),
                ]}
              />
            </L>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Every invoice must be linked to a confirmed sales order — its customer and lines are
              checked against it. An invoice never reduces stock; only a confirmed dispatch debits
              inventory.
            </p>
          </fieldset>

          {/* Header */}
          <fieldset className="rounded-lg border border-border/60 p-4">
            <legend className="px-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Invoice header
            </legend>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <L label="Invoice number (auto if blank)">
                <input
                  className="inp"
                  value={form.invoice_number}
                  onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
                  placeholder="INV-XXXXXXXX"
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
              <L label="Customer *">
                <SearchableSelect
                  value={form.debtor_id}
                  onChange={(v) => setForm({ ...form, debtor_id: v })}
                  placeholder="Select debtor"
                  options={debtors.map((d: any) => ({ value: d.id, label: d.name }))}
                />
              </L>
              <L label="Customer contact">
                <input
                  className="inp"
                  value={form.customer_contact}
                  onChange={(e) => setForm({ ...form, customer_contact: e.target.value })}
                  placeholder="Name · email · phone"
                />
              </L>
              <L label="Billing address">
                <input
                  className="inp"
                  value={form.billing_address}
                  onChange={(e) => setForm({ ...form, billing_address: e.target.value })}
                />
              </L>
              <L label="Delivery address">
                <input
                  className="inp"
                  value={form.delivery_address}
                  onChange={(e) => setForm({ ...form, delivery_address: e.target.value })}
                />
              </L>
              <L label="Payment terms">
                <input
                  className="inp"
                  value={form.payment_terms}
                  onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}
                  placeholder="Net 30"
                />
              </L>
              <L label={`Due date${selectedDebtor ? ` (auto: ${termsDays}d net)` : ""}`}>
                <input
                  type="date"
                  className="inp"
                  value={effectiveDue}
                  onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                />
              </L>
            </div>
            <div className="mt-3">
              <L label="Notes (shown on the printed invoice)">
                <textarea
                  rows={2}
                  className="inp resize-y"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </L>
            </div>
            <div className="mt-3">
              <DocumentUploader
                userId={userId}
                scope="invoices"
                docs={docs}
                onChange={setDocs}
                hint="Attach the final invoice PDF and any supporting paperwork."
              />
            </div>
          </fieldset>

          {/* Lines */}
          <fieldset className="rounded-lg border border-border/60 p-4">
            <legend className="px-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Product lines
            </legend>
            <div className="space-y-2">
              <div className="hidden grid-cols-12 gap-2 text-[9px] uppercase tracking-widest text-muted-foreground md:grid">
                <div className="col-span-3">SKU / Product</div>
                <div className="col-span-1">Unit</div>
                <div className="col-span-1">Qty</div>
                <div className="col-span-2">Unit price</div>
                <div className="col-span-1">Disc %</div>
                <div className="col-span-1">GST %</div>
                <div className="col-span-2 text-right">Line total</div>
                <div className="col-span-1"></div>
              </div>
              {lines.map((l, i) => {
                const lineTotal = round2(
                  (Number(l.quantity) || 0) *
                    (Number(l.unit_price) || 0) *
                    (1 - (Number(l.discount_pct) || 0) / 100),
                );
                return (
                  <div
                    key={i}
                    className="grid grid-cols-2 items-end gap-2 rounded-md border border-border/50 p-2 md:grid-cols-12"
                  >
                    <div className="col-span-2 md:col-span-3">
                      <L label="Product">
                        <SearchableSelect
                          value={l.product_id}
                          onChange={(v) => pickProduct(i, v)}
                          placeholder="Select product…"
                          options={(productsQ.data ?? []).map((p: any) => ({
                            value: p.id,
                            label: p.sku ? `${p.sku} · ${p.name}` : p.name,
                          }))}
                        />
                      </L>
                      {l.name && (
                        <div className="mt-0.5 text-[10px] text-muted-foreground">{l.name}</div>
                      )}
                    </div>
                    <div>
                      <L label="Unit">
                        <input
                          className="inp"
                          value={l.unit}
                          onChange={(e) => setLine(i, { unit: e.target.value })}
                        />
                      </L>
                    </div>
                    <div>
                      <L label="Qty">
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          className="inp"
                          value={l.quantity}
                          onChange={(e) => setLine(i, { quantity: e.target.value })}
                        />
                      </L>
                    </div>
                    <div className="md:col-span-2">
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
                      <L label="Disc %">
                        <input
                          list="inv-disc-rates"
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          className="inp"
                          value={l.discount_pct}
                          onChange={(e) => setLine(i, { discount_pct: e.target.value })}
                        />
                      </L>
                    </div>
                    <div>
                      <L label="GST %">
                        <input
                          list="pf-gst-rates"
                          type="number"
                          min="0"
                          step="0.01"
                          className="inp"
                          value={l.gst_rate}
                          onChange={(e) => setLine(i, { gst_rate: e.target.value })}
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
              <button
                type="button"
                onClick={addLine}
                className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary"
              >
                <Plus className="h-3.5 w-3.5" /> Add line
              </button>
            </div>
          </fieldset>

          {/* Totals */}
          <div className="ml-auto max-w-xs space-y-1 rounded-lg border border-border/60 bg-muted/20 p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">
                Subtotal
              </span>
              <span className="num">{fmtMoney(totals.subtotal)}</span>
            </div>
            {totals.totalDiscount > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-widest text-muted-foreground">
                  Total discount
                </span>
                <span className="num text-destructive">−{fmtMoney(totals.totalDiscount)}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">GST</span>
              <span className="num">{fmtMoney(totals.gstTotal)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">
                Freight / charges
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                className="inp !w-28 !py-1 text-right"
                value={form.freight}
                onChange={(e) => setForm({ ...form, freight: e.target.value })}
              />
            </div>
            <div className="flex items-center justify-between border-t border-border pt-1.5 font-medium">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">
                Grand total
              </span>
              <span className="num text-base">{fmtMoney(totals.grandTotal)}</span>
            </div>
          </div>

          {/* Advance deduction */}
          <fieldset className="rounded-lg border border-border/60 p-4">
            <legend className="px-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Advance deduction
            </legend>
            <div className="space-y-3">
              <L label="Linked customer proforma (optional — deducts received advances)">
                <SearchableSelect
                  value={form.linked_customer_proforma_id}
                  onChange={pickProforma}
                  placeholder="None — manual PO entry"
                  options={[
                    { value: "", label: "None — manual PO entry" },
                    ...(proformasQ.data ?? []).map((p: any) => ({
                      value: p.id,
                      label: p.proforma_number ?? p.po_number ?? p.id,
                      hint: p.debtor?.name ?? undefined,
                    })),
                  ]}
                />
              </L>
              <div className="grid grid-cols-3 gap-3">
                <L label="PO / proforma number">
                  <input
                    className="inp"
                    value={form.po_number}
                    onChange={(e) => setForm({ ...form, po_number: e.target.value })}
                    placeholder="PO-2026-001"
                  />
                </L>
                <L label="PO date">
                  <input
                    type="date"
                    className="inp"
                    value={form.po_date}
                    onChange={(e) => setForm({ ...form, po_date: e.target.value })}
                  />
                </L>
                <L label="PO amount">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="inp"
                    value={form.po_amount}
                    onChange={(e) => setForm({ ...form, po_amount: e.target.value })}
                  />
                </L>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Advances received against the linked proforma are deducted from the invoice total —
                the net amount is what the customer owes. If no proforma, the full amount applies.
              </p>
              {form.po_number.trim() && (
                <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
                  <div className="mb-1 uppercase tracking-widest text-primary">
                    Advances received against {form.po_number}
                  </div>
                  {poLookupQ.isFetching ? (
                    <div className="text-muted-foreground">Looking up…</div>
                  ) : (poLookupQ.data?.advances ?? []).length === 0 ? (
                    <div className="text-muted-foreground">
                      No advances recorded for this PO number on the sales side — full amount
                      applies.
                    </div>
                  ) : (
                    <ul className="space-y-0.5">
                      {((poLookupQ.data?.advances ?? []) as any[]).map((a) => (
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
                    <span className="num">{fmtMoney(totals.balanceDue)}</span>
                  </div>
                </div>
              )}
            </div>
          </fieldset>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => save.mutate({ issueNow: false })}
              disabled={save.isPending}
              className="rounded-md border border-border px-4 py-2 text-sm"
            >
              {isEdit ? "Save changes" : "Save draft"}
            </button>
            <button
              type="submit"
              disabled={save.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {save.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileCheck className="h-4 w-4" />
              )}
              {isEdit ? "Save & issue" : "Create & issue"}
            </button>
          </div>
        </form>
        <datalist id="pf-gst-rates">
          <option value="0" />
          <option value="5" />
          <option value="12" />
          <option value="18" />
          <option value="28" />
        </datalist>
        <datalist id="inv-disc-rates">
          <option value="0" />
          <option value="5" />
          <option value="10" />
          <option value="15" />
          <option value="20" />
        </datalist>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

// ─── Record payment modal ────────────────────────────────────────────────
function PaymentModal({ invoice, onClose }: { invoice: Inv; onClose: () => void }) {
  const qc = useQueryClient();
  const grandTotal = Number(invoice.grand_total ?? invoice.amount ?? 0);
  const advance = Number(invoice.advance_deducted ?? 0);
  const netAmount = Number(invoice.amount ?? Math.max(0, grandTotal - advance));
  const received = Number(invoice.amount_received ?? 0);
  const balance = Math.max(0, round2(netAmount - received));
  const [amount, setAmount] = useState(balance > 0 ? String(balance) : "");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const pay = useMutation({
    mutationFn: async () => {
      const amt = Number(amount);
      if (!amt || amt <= 0) throw new Error("Amount must be greater than zero");
      if (amt > balance + 0.005)
        throw new Error(`Cannot exceed the outstanding balance of ${fmtMoney(balance)}`);
      await api.invoices.recordPayment(invoice.id, { amountReceived: amt, receiptDate: date });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Payment recorded");
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
        className="w-full max-w-md rounded-xl border border-border bg-card shadow-vault"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">Record payment · {invoice.invoice_number}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            pay.mutate();
          }}
          className="space-y-4 p-5 text-sm"
        >
          <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Grand total</span>
              <span className="num">{fmtMoney(grandTotal)}</span>
            </div>
            {advance > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Less advance</span>
                <span className="num text-destructive">−{fmtMoney(advance)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Net amount</span>
              <span className="num">{fmtMoney(netAmount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Already received</span>
              <span className="num text-success">{fmtMoney(received)}</span>
            </div>
            <div className="flex justify-between border-t border-border pt-1 font-medium">
              <span>Balance outstanding</span>
              <span className="num text-warning">{fmtMoney(balance)}</span>
            </div>
          </div>
          <L label="Amount received (USD)">
            <input
              required
              type="number"
              step="0.01"
              min="0"
              className="inp"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </L>
          <L label="Receipt date">
            <input
              required
              type="date"
              className="inp"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </L>
          <p className="text-[10px] text-muted-foreground">
            Paying the full balance flips the invoice to Paid; a partial amount marks it Partially
            Paid.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              disabled={pay.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-success px-4 py-2 text-sm font-medium text-success-foreground disabled:opacity-60"
            >
              {pay.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              <Banknote className="h-4 w-4" /> Record payment
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Detail modal ────────────────────────────────────────────────────────
function InvoiceDetailModal({ invoice, onClose }: { invoice: Inv; onClose: () => void }) {
  const grandTotal = Number(invoice.grand_total ?? invoice.amount ?? 0);
  const advance = Number(invoice.advance_deducted ?? 0);
  const netAmount = Number(invoice.amount ?? Math.max(0, grandTotal - advance));
  const received = Number(invoice.amount_received ?? 0);
  const balance = Math.max(0, netAmount - received);
  const address = [invoice.debtor?.address_line, invoice.debtor?.city, invoice.debtor?.country]
    .filter(Boolean)
    .join(", ");
  const lines = invoice.lines ?? [];
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card shadow-vault"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">Invoice {invoice.invoice_number}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 p-5 text-sm">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <D label="Customer" value={invoice.debtor?.name ?? "—"} />
            <D
              label="Status"
              value={<StatusPill status={invoice.status} label={DOC_LABELS[invoice.status]} />}
            />
            <D label="Grand total" value={<span className="num">{fmtMoney(grandTotal)}</span>} />
            {advance > 0 && (
              <D
                label="Advance deducted"
                value={<span className="num text-destructive">−{fmtMoney(advance)}</span>}
              />
            )}
            <D label="Net amount" value={<span className="num">{fmtMoney(netAmount)}</span>} />
            <D
              label="Amount received"
              value={<span className="num text-success">{fmtMoney(received)}</span>}
            />
            <D
              label="Balance outstanding"
              value={<span className="num text-warning">{fmtMoney(balance)}</span>}
            />
            <D label="Issue date" value={invoice.issue_date ? fmtDate(invoice.issue_date) : "—"} />
            <D label="Due date" value={invoice.due_date ? fmtDate(invoice.due_date) : "—"} />
            {invoice.goods_sales_order_number && (
              <D label="Linked sales order" value={invoice.goods_sales_order_number} />
            )}
            {invoice.linked_customer_proforma_number && (
              <D label="Linked proforma" value={invoice.linked_customer_proforma_number} />
            )}
            {invoice.customer_contact && (
              <D label="Customer contact" value={invoice.customer_contact} />
            )}
            {invoice.payment_terms && <D label="Payment terms" value={invoice.payment_terms} />}
            {invoice.po_number && <D label="PO number" value={invoice.po_number} />}
            {invoice.po_amount != null && invoice.po_amount > 0 && (
              <D
                label="PO amount"
                value={<span className="num">{fmtMoney(invoice.po_amount)}</span>}
              />
            )}
            <D label="NOA" value={<NoaBadge status={invoice.noa_status} />} />
            {invoice.billing_address && (
              <D label="Billing address" value={invoice.billing_address} />
            )}
            {invoice.delivery_address && (
              <D label="Delivery address" value={invoice.delivery_address} />
            )}
            {address && <D label="Debtor address" value={address} />}
            <div className="col-span-2 md:col-span-3">
              <D label="Notes" value={invoice.notes ?? "—"} />
            </div>
          </div>

          {lines.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-border/60">
              <table className="w-full text-sm">
                <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-3 py-2 text-left font-normal">Product</th>
                    <th className="px-3 py-2 text-right font-normal">Qty</th>
                    <th className="px-3 py-2 text-right font-normal">Unit price</th>
                    <th className="px-3 py-2 text-right font-normal">Disc %</th>
                    <th className="px-3 py-2 text-right font-normal">GST %</th>
                    <th className="px-3 py-2 text-right font-normal">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.product_id + l.name} className="border-b border-border/40">
                      <td className="px-3 py-2">
                        {l.name}
                        {l.sku && (
                          <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                            {l.sku}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right num">{l.quantity.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right num text-muted-foreground">
                        {fmtMoney(l.unit_price)}
                      </td>
                      <td className="px-3 py-2 text-right num text-muted-foreground">
                        {l.discount_pct != null ? `${l.discount_pct}%` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right num text-muted-foreground">
                        {l.gst_rate != null ? `${l.gst_rate}%` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right num">{fmtMoney(l.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="ml-auto max-w-[240px] space-y-0.5 p-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="num">{fmtMoney(invoice.subtotal_goods ?? 0)}</span>
                </div>
                {Number(invoice.total_discount ?? 0) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total discount</span>
                    <span className="num text-destructive">
                      −{fmtMoney(invoice.total_discount ?? 0)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">GST</span>
                  <span className="num">{fmtMoney(invoice.gst_total ?? 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Freight</span>
                  <span className="num">{fmtMoney(invoice.freight ?? 0)}</span>
                </div>
                <div className="flex justify-between border-t border-border pt-1 font-medium">
                  <span>Grand total</span>
                  <span className="num">{fmtMoney(grandTotal)}</span>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Link
              to="/app/invoice-preview/$id"
              params={{ id: invoice.id }}
              className="inline-flex items-center gap-1 rounded-md border border-primary/50 px-3 py-1.5 text-xs text-primary hover:bg-primary/10"
            >
              <Eye className="h-3.5 w-3.5" /> Preview PDF
            </Link>
            <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">
              Close
            </button>
          </div>
        </div>
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

function D({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}
