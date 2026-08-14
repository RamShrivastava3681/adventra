import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import {
  Plus,
  X,
  Loader2,
  ScrollText,
  Send,
  CheckCircle2,
  Ban,
  Trash2,
  Pencil,
  Printer,
  Mail,
  ArrowRight,
  Clock4,
  CircleDollarSign,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { DocumentUploader, type DocMeta } from "@/components/document-uploader";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { TableSkeleton } from "@/components/skeletons";
import { TransactionFilters, type TxFiltersConfig } from "@/components/transaction-filters";

export const Route = createFileRoute("/app/quotations")({
  component: QuotationsPage,
});

// ─── Types (snake_case — the API transform middleware shapes responses) ───
type QLine = {
  product_id: string;
  sku: string | null;
  name: string;
  unit: string;
  quantity: number;
  unit_price: number;
  updated_unit_price: number | null;
  discount_type: "pct" | "amount" | null;
  discount_value: number | null;
  gst_rate: number | null;
  line_total: number;
  notes: string | null;
};

type Q = {
  id: string;
  quotation_number: string;
  created_at: string;
  quotation_date: string;
  valid_until: string | null;
  customer_id: string | null;
  customer_name: string | null;
  contact_person: string | null;
  billing_address: string | null;
  delivery_address: string | null;
  salesperson_id: string | null;
  salesperson_name: string | null;
  payment_terms: string | null;
  expected_delivery_date: string | null;
  notes: string | null;
  documents: DocMeta[];
  status: string;
  lines: QLine[];
  subtotal: number;
  total_discount: number;
  gst_total: number;
  freight: number;
  grand_total: number;
  linked_goods_so_id: string | null;
  approval_status: string | null;
  approval_requested_at: string | null;
  approval_reviewed_by: string | null;
  approval_reviewed_at: string | null;
  approval_comments: string | null;
  debtor_approval_status: "pending" | "approved" | "rejected" | null;
  debtor_approval_sent_at: string | null;
  debtor_approval_responded_at: string | null;
  debtor_approval_comments: string | null;
  debtor_approval_email: string | null;
};

type CatalogueProduct = {
  id: string;
  sku: string | null;
  name: string;
  unit_of_measure: string;
  gst_rate: number | null;
  unit_price: number | null;
  status: string;
};

type Customer = {
  id: string;
  name: string;
  contact_name: string | null;
  address_line: string | null;
  city: string | null;
  country: string | null;
  postal_code: string | null;
};

const Q_STATUSES = ["draft", "sent", "accepted", "rejected", "expired", "converted_to_so"] as const;

const Q_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  rejected: "Rejected",
  expired: "Expired",
  converted_to_so: "Converted to SO",
};

const Q_STATUS_TONES: Record<string, string> = {
  draft: "bg-muted/60 text-muted-foreground border-border",
  sent: "bg-blue-500/10 text-blue-600 border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-400 dark:border-blue-500/40",
  accepted: "bg-primary-soft text-[#0a4a8a] border-primary/20 dark:text-[#63baff]",
  rejected: "bg-destructive/10 text-destructive border-destructive/30",
  expired: "bg-warning/10 text-warning border-warning/30",
  converted_to_so: "bg-primary/10 text-primary border-primary/30",
};

// Maker–checker price approval (separate from the quotation lifecycle status).
const Q_APPROVAL_LABELS: Record<string, string> = {
  pending_review: "Awaiting checker",
  approved: "Checker approved",
  rejected: "Price revision needed",
};

const Q_APPROVAL_TONES: Record<string, string> = {
  pending_review: "bg-warning/10 text-warning border-warning/30",
  approved: "bg-primary-soft text-[#0a4a8a] border-primary/20 dark:text-[#63baff]",
  rejected: "bg-destructive/10 text-destructive border-destructive/30",
};

// Debtor approval (PDF sent by email — Approve/Reject from the email link).
const Q_DEBTOR_LABELS: Record<string, string> = {
  pending: "Awaiting debtor",
  approved: "Approved by debtor",
  rejected: "Rejected by debtor",
};

const Q_DEBTOR_TONES: Record<string, string> = {
  pending: "bg-primary/10 text-primary border-primary/30",
  approved: "bg-primary-soft text-[#0a4a8a] border-primary/20 dark:text-[#63baff]",
  rejected: "bg-destructive/10 text-destructive border-destructive/30",
};

const PAYMENT_TERMS = [
  "",
  "Net 15",
  "Net 30",
  "Net 60",
  "Advance payment",
  "Cash on delivery",
  "Letter of credit",
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function QuotationsPage() {
  const { user } = useAuth();
  const canWrite = !!user;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Q | null>(null);

  const qsQ = useQuery({
    queryKey: ["quotations"],
    queryFn: async () => {
      const data = (await api.quotations.list()) as Q[];
      return data.sort((a, b) => (b.quotation_date || "").localeCompare(a.quotation_date || ""));
    },
  });
  const productsQ = useQuery({
    queryKey: ["products-for-quotation"],
    queryFn: async () => {
      const data = (await api.products.list()) as CatalogueProduct[];
      return data.filter((p) => p.status === "active");
    },
  });
  const customersQ = useQuery({
    queryKey: ["customers-for-quotation"],
    queryFn: async () => {
      const data = (await api.debtors.list()) as any[];
      return data
        .map((d) => ({
          id: d.id,
          name: d.name ?? d.id,
          contact_name: d.contact_name ?? null,
          address_line: d.address_line ?? null,
          city: d.city ?? null,
          country: d.country ?? null,
          postal_code: d.postal_code ?? null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)) as Customer[];
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      await api.quotations.delete(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quotations"] });
      toast.success("Quotation deleted");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // Email the quotation PDF to the debtor for their approval.
  const sendToDebtor = useMutation({
    mutationFn: async (id: string) => {
      const res = (await api.quotations.sendToDebtor(id)) as any;
      return res?.sentTo ?? "the debtor";
    },
    onSuccess: (sentTo) => {
      qc.invalidateQueries({ queryKey: ["quotations"] });
      toast.success(`Quotation PDF sent to ${sentTo}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const qConfig: TxFiltersConfig<Q> = {
    searchPlaceholder: "Search by quotation number, customer, contact…",
    search: (q) => [
      q.quotation_number,
      q.customer_name ?? customerName(q.customer_id),
      q.contact_person,
    ],
    statusField: (q) => q.status,
    statusLabel: Q_STATUS_LABELS,
    statusOrder: [...Q_STATUSES],
    dateField: (q) => q.quotation_date,
    dateLabel: "Quotation date",
    sortFields: [
      { value: "created", label: "Created date", get: (q) => q.created_at },
      { value: "quotation", label: "Quotation date", get: (q) => q.quotation_date },
      { value: "valid", label: "Valid until", get: (q) => q.valid_until },
    ],
    defaultSort: "quotation-desc",
  };

  const stats = useMemo(() => {
    const qs = qsQ.data ?? [];
    return {
      drafts: qs.filter((q) => q.status === "draft").length,
      sent: qs.filter((q) => q.status === "sent").length,
      acceptedValue: qs
        .filter((q) => q.status === "accepted")
        .reduce((s, q) => s + Number(q.grand_total || 0), 0),
      converted: qs.filter((q) => q.status === "converted_to_so").length,
    };
  }, [qsQ.data]);

  const customerName = (id: string | null) =>
    (customersQ.data ?? []).find((c: Customer) => c.id === id)?.name ?? null;

  return (
    <div>
      <PageHeader
        eyebrow="Sales"
        title="Quotations"
        description="An offer to a customer or prospect. Quotations never affect inventory or accounting — stock moves only after a confirmed dispatch."
        icon={<ScrollText className="h-5 w-5" />}
        actions={
          canWrite ? (
            <button
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              <Plus className="h-4 w-4" /> New quotation
            </button>
          ) : (
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              Read-only
            </span>
          )
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Drafts" value={stats.drafts} icon={ScrollText} />
          <StatTile label="Sent" value={stats.sent} icon={Send} />
          <StatTile
            label="Accepted value"
            value={fmtMoney(stats.acceptedValue)}
            icon={CircleDollarSign}
          />
          <StatTile label="Converted" value={stats.converted} icon={ArrowRight} />
        </div>

        <TransactionFilters data={qsQ.data ?? []} config={qConfig}>
          {(filtered) => (
            <Card>
              {qsQ.isLoading ? (
                <TableSkeleton rows={6} cols={7} />
              ) : filtered.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  <ScrollText className="mx-auto mb-2 h-8 w-8 opacity-40" />
                  No quotations yet.
                </div>
              ) : (
                <div className="-mx-5 overflow-x-auto">
                  <table className="table-premium w-full text-sm">
                    <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="px-5 py-2 text-left font-normal">Quotation</th>
                        <th className="px-5 py-2 text-left font-normal">Customer / prospect</th>
                        <th className="px-5 py-2 text-left font-normal">Valid until</th>
                        <th className="px-5 py-2 text-right font-normal">Grand total</th>
                        <th className="px-5 py-2 text-left font-normal">Status</th>
                        <th className="px-5 py-2 text-right font-normal">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((q) => {
                        const expired =
                          q.valid_until &&
                          q.valid_until < todayStr() &&
                          ["draft", "sent"].includes(q.status);
                        return (
                          <tr key={q.id} className="border-b border-border/60 hover:bg-muted/30">
                            <td className="px-5 py-3 font-mono text-xs">
                              {q.quotation_number}
                              <div className="text-[10px] text-muted-foreground">
                                {fmtDate(q.quotation_date)}
                              </div>
                            </td>
                            <td className="px-5 py-3">
                              {q.customer_name ?? customerName(q.customer_id) ?? "—"}
                              {q.contact_person ? (
                                <div className="text-[10px] text-muted-foreground">
                                  {q.contact_person}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-5 py-3 text-xs text-muted-foreground">
                              {q.valid_until ? (
                                <span className="inline-flex items-center gap-1">
                                  <Clock4 className="h-3 w-3" />
                                  {fmtDate(q.valid_until)}
                                </span>
                              ) : (
                                "—"
                              )}
                              {expired && (
                                <span className="ml-2 rounded bg-warning/10 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-warning">
                                  Past validity
                                </span>
                              )}
                            </td>
                            <td className="px-5 py-3 text-right num font-medium">
                              {fmtMoney(q.grand_total)}
                            </td>
                            <td className="px-5 py-3">
                              <StatusPill
                                status={q.status}
                                label={Q_STATUS_LABELS[q.status] ?? q.status}
                                tone={Q_STATUS_TONES[q.status]}
                              />
                              {q.approval_status && (
                                <div className="mt-1">
                                  <StatusPill
                                    status={q.approval_status}
                                    label={
                                      Q_APPROVAL_LABELS[q.approval_status] ?? q.approval_status
                                    }
                                    tone={Q_APPROVAL_TONES[q.approval_status]}
                                  />
                                </div>
                              )}
                              {q.debtor_approval_status && (
                                <div className="mt-1">
                                  <StatusPill
                                    status={q.debtor_approval_status}
                                    label={
                                      Q_DEBTOR_LABELS[q.debtor_approval_status] ??
                                      q.debtor_approval_status
                                    }
                                    tone={Q_DEBTOR_TONES[q.debtor_approval_status]}
                                  />
                                </div>
                              )}
                            </td>
                            <td className="px-5 py-3 text-right">
                              <div className="flex justify-end gap-1">
                                <button
                                  onClick={() => {
                                    setEditing(q);
                                    setOpen(true);
                                  }}
                                  className="rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary"
                                >
                                  View
                                </button>
                                {canWrite && q.status === "draft" && (
                                  <button
                                    onClick={() => {
                                      setEditing(q);
                                      setOpen(true);
                                    }}
                                    className="rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary"
                                    title="Edit"
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </button>
                                )}
                                {canWrite && q.status === "draft" && (
                                  <button
                                    onClick={() => del.mutate(q.id)}
                                    className="rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:border-destructive hover:text-destructive"
                                    title="Delete"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                                {canWrite &&
                                  ["draft", "sent", "accepted", "rejected"].includes(q.status) && (
                                    <button
                                      onClick={() => sendToDebtor.mutate(q.id)}
                                      disabled={sendToDebtor.isPending}
                                      className="inline-flex items-center gap-1 rounded-md border border-primary/40 px-2 py-1 text-[10px] text-primary hover:bg-primary/10 disabled:opacity-50"
                                      title="Email the quotation PDF to the debtor for approval"
                                    >
                                      {sendToDebtor.isPending ? (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                      ) : (
                                        <Mail className="h-3 w-3" />
                                      )}
                                      Send to debtor
                                    </button>
                                  )}
                                <Link
                                  to="/app/quotation/$quotationId"
                                  params={{ quotationId: q.id }}
                                  className="rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary"
                                  title="Print quotation PDF"
                                >
                                  <Printer className="h-3 w-3" />
                                </Link>
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
          )}
        </TransactionFilters>
      </div>

      {open && user && (
        <QModal
          userId={user.id}
          q={editing}
          products={productsQ.data ?? []}
          customers={customersQ.data ?? []}
          canWrite={canWrite}
          onClose={() => setOpen(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["quotations"] });
          }}
          onConverted={(soNumber: string) => {
            qc.invalidateQueries({ queryKey: ["quotations"] });
            qc.invalidateQueries({ queryKey: ["goods-sos"] });
            toast.success(`Converted to sales order ${soNumber}`);
            setOpen(false);
            navigate({ to: "/app/sales-orders" });
          }}
        />
      )}
    </div>
  );
}

// ─── Quotation create/edit modal ─────────────────────────────────────────
type LineDraft = {
  product_id: string;
  sku: string | null;
  name: string;
  unit: string;
  quantity: string;
  unit_price: string;
  updated_unit_price: string;
  discount_type: "pct" | "amount" | null;
  discount_value: string;
  gst_rate: string;
  notes: string;
};

function QModal({
  userId,
  q,
  products,
  customers,
  canWrite,
  onClose,
  onSaved,
  onConverted,
}: {
  userId: string;
  q: Q | null;
  products: CatalogueProduct[];
  customers: Customer[];
  canWrite: boolean;
  onClose: () => void;
  onSaved: () => void;
  onConverted: (soNumber: string) => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!q;
  const status = q?.status ?? "draft";
  const approval = q?.approval_status ?? null;
  // Guards the status-change actions ("Send to customer" now also emails the
  // PDF, which takes a moment) against double-clicks sending duplicate emails.
  const [statusBusy, setStatusBusy] = useState(false);
  // Lines (and the updated prices) can be edited while the quotation is a
  // draft or sent but not yet submitted for approval, or after the checker has
  // rejected the prices and sent it back. Once an approval is in flight — or
  // after it is approved — lines are frozen.
  const editable =
    !isEdit ||
    approval === "rejected" ||
    (["draft", "sent"].includes(status) &&
      approval !== "pending_review" &&
      approval !== "approved");

  const [f, setF] = useState({
    quotation_date: (q?.quotation_date ?? todayStr()).slice(0, 10),
    valid_until: (q?.valid_until ?? "")?.slice(0, 10) ?? "",
    customer_id: q?.customer_id ?? "",
    prospect_name: "",
    contact_person: q?.contact_person ?? "",
    billing_address: q?.billing_address ?? "",
    delivery_address: q?.delivery_address ?? "",
    payment_terms: q?.payment_terms ?? "",
    expected_delivery_date: (q?.expected_delivery_date ?? "")?.slice(0, 10) ?? "",
    notes: q?.notes ?? "",
    freight: q?.freight != null ? String(q.freight) : "",
  });
  const [lines, setLines] = useState<LineDraft[]>(
    (q?.lines ?? []).map((l) => ({
      product_id: l.product_id,
      sku: l.sku,
      name: l.name,
      unit: l.unit,
      quantity: String(l.quantity),
      unit_price: String(l.unit_price),
      updated_unit_price: l.updated_unit_price != null ? String(l.updated_unit_price) : "",
      discount_type: l.discount_type,
      discount_value: l.discount_value != null ? String(l.discount_value) : "",
      gst_rate: l.gst_rate != null ? String(l.gst_rate) : "",
      notes: l.notes ?? "",
    })),
  );
  const [docs, setDocs] = useState<DocMeta[]>(q?.documents ?? []);

  const setLine = (i: number, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const customerNameValue =
    f.customer_id !== ""
      ? (customers.find((c) => c.id === f.customer_id)?.name ?? null)
      : f.prospect_name.trim() || null;

  const pickCustomer = (id: string) => {
    const c = customers.find((x) => x.id === id);
    setF((prev) => ({
      ...prev,
      customer_id: id,
      contact_person: c?.contact_name ?? prev.contact_person,
      billing_address: c
        ? [c.address_line, c.city, c.country, c.postal_code].filter(Boolean).join(", ")
        : prev.billing_address,
      delivery_address: c
        ? [c.address_line, c.city, c.country, c.postal_code].filter(Boolean).join(", ")
        : prev.delivery_address,
    }));
  };

  const pickProduct = (i: number, id: string) => {
    const p = products.find((x) => x.id === id);
    setLine(i, {
      product_id: id,
      name: p?.name ?? "",
      sku: p?.sku ?? null,
      unit: p?.unit_of_measure ?? "piece",
      unit_price: p?.unit_price != null ? String(p.unit_price) : "",
      updated_unit_price: "",
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
        updated_unit_price: "",
        discount_type: null,
        discount_value: "",
        gst_rate: "",
        notes: "",
      },
    ]);

  const removeLine = (i: number) => setLines((ls) => ls.filter((_, idx) => idx !== i));

  // The maker's revised price wins once set; otherwise the original unit price.
  const effPrice = (l: LineDraft): number => {
    const base = Number(l.unit_price) || 0;
    if (l.updated_unit_price === "") return base;
    const up = Number(l.updated_unit_price);
    return Number.isFinite(up) && up >= 0 ? up : base;
  };

  const lineDiscount = (l: LineDraft) => {
    const gross = (Number(l.quantity) || 0) * effPrice(l);
    const value = Number(l.discount_value) || 0;
    if (l.discount_type === "pct") return (gross * Math.min(100, value)) / 100;
    if (l.discount_type === "amount") return Math.min(value, gross);
    return 0;
  };

  const totals = useMemo(() => {
    const lineTotals = lines.map((l) =>
      round2((Number(l.quantity) || 0) * effPrice(l) - lineDiscount(l)),
    );
    const subtotal = round2(lineTotals.reduce((s, t) => s + t, 0));
    const totalDiscount = round2(lines.reduce((s, l) => s + lineDiscount(l), 0));
    const gstTotal = round2(
      lines.reduce((s, l, i) => s + lineTotals[i] * ((Number(l.gst_rate) || 0) / 100), 0),
    );
    const freight = Number(f.freight) || 0;
    return {
      subtotal,
      totalDiscount,
      gstTotal,
      freight,
      grandTotal: round2(subtotal + gstTotal + freight),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, f.freight]);

  const save = useMutation({
    mutationFn: async () => {
      if (lines.length === 0) throw new Error("Add at least one product line");
      const payloadLines = lines.map((l) => ({
        product_id: l.product_id,
        sku: l.sku,
        name: l.name,
        unit: l.unit || "piece",
        quantity: Number(l.quantity) || 0,
        unit_price: Number(l.unit_price) || 0,
        updated_unit_price: l.updated_unit_price === "" ? null : Number(l.updated_unit_price),
        discount_type: l.discount_type,
        discount_value: l.discount_value ? Number(l.discount_value) : null,
        gst_rate: l.gst_rate ? Number(l.gst_rate) : null,
        notes: l.notes.trim() || null,
      }));
      for (const l of payloadLines) {
        if (!l.product_id) throw new Error("Every line must select a product from the catalogue");
        if (!(l.quantity > 0)) throw new Error("Quantity must be greater than zero");
        if (l.unit_price < 0)
          throw new Error("Unit selling price must be greater than or equal to zero");
        if (
          l.updated_unit_price !== null &&
          (!Number.isFinite(l.updated_unit_price) || l.updated_unit_price < 0)
        ) {
          throw new Error("Updated unit price must be greater than or equal to zero");
        }
        if (l.discount_type === "pct" && (l.discount_value! < 0 || l.discount_value! > 100)) {
          throw new Error("Percentage discount must be between 0 and 100");
        }
        if (l.discount_type === "amount" && l.discount_value! < 0) {
          throw new Error("Discount amount must be greater than or equal to zero");
        }
      }
      const payload = {
        quotation_date: f.quotation_date,
        valid_until: f.valid_until || null,
        customer_id: f.customer_id || null,
        customer_name: customerNameValue,
        contact_person: f.contact_person.trim() || null,
        billing_address: f.billing_address.trim() || null,
        delivery_address: f.delivery_address.trim() || null,
        payment_terms: f.payment_terms || null,
        expected_delivery_date: f.expected_delivery_date || null,
        notes: f.notes.trim() || null,
        freight: Number(f.freight) || 0,
        documents: docs,
        lines: payloadLines,
      };
      if (isEdit && q) {
        await api.quotations.update(q.id, payload);
      } else {
        await api.quotations.create({ ...payload, client_id: userId });
      }
    },
    onSuccess: () => {
      onSaved();
      toast.success(isEdit ? "Quotation updated" : "Quotation saved as draft");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const changeStatus = async (next: string, label: string) => {
    if (!q || statusBusy) return;
    setStatusBusy(true);
    try {
      await api.quotations.update(q.id, { status: next });
      onSaved();
      // "Send to customer" must also email the quotation PDF to the customer
      // (the status change alone never sends anything). Best-effort: the
      // quotation is still marked as sent even if the email can't go out.
      if (next === "sent") {
        try {
          const res = (await api.quotations.sendToDebtor(q.id)) as { sentTo?: string };
          toast.success(`${label} — PDF emailed to ${res?.sentTo ?? "the customer"}`);
        } catch (e) {
          toast.warning(
            `${label}, but the email could not be sent: ${e instanceof Error ? e.message : "unknown error"} — you can retry with "Send to debtor"`,
          );
        }
      } else {
        toast.success(label);
      }
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setStatusBusy(false);
    }
  };

  // Maker submits the (revised) prices to the checker for approval.
  const submitForApproval = async () => {
    if (!q) return;
    if (lines.length === 0) {
      toast.error("Add at least one product line before submitting for approval");
      return;
    }
    try {
      await api.quotations.update(q.id, {
        status: "sent",
        approval_status: "pending_review",
      });
      onSaved();
      toast.success("Submitted for checker approval");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const convert = useMutation({
    mutationFn: async () => {
      if (!q) throw new Error("No quotation selected");
      const res = (await api.quotations.convert(q.id)) as any;
      return res?.salesOrder?.so_number ?? "SO";
    },
    onSuccess: (soNumber) => {
      onConverted(soNumber);
      qc.invalidateQueries({ queryKey: ["quotations"] });
      qc.invalidateQueries({ queryKey: ["goods-sos"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-border bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <div>
            <h3 className="font-display text-lg">
              {isEdit ? `Quotation ${q.quotation_number}` : "New quotation"}
            </h3>
            {isEdit && (
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                <StatusPill
                  status={status}
                  label={Q_STATUS_LABELS[status] ?? status}
                  tone={Q_STATUS_TONES[status]}
                />
                {approval && (
                  <StatusPill
                    status={approval}
                    label={Q_APPROVAL_LABELS[approval] ?? approval}
                    tone={Q_APPROVAL_TONES[approval]}
                  />
                )}
                {q?.debtor_approval_status && (
                  <StatusPill
                    status={q.debtor_approval_status}
                    label={Q_DEBTOR_LABELS[q.debtor_approval_status] ?? q.debtor_approval_status}
                    tone={Q_DEBTOR_TONES[q.debtor_approval_status]}
                  />
                )}
              </div>
            )}
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
          {/* Header */}
          <fieldset className="rounded-lg border border-border/60 p-4">
            <legend className="px-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Quotation header
            </legend>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <L label="Quotation number">
                <input
                  className="inp"
                  value={isEdit ? q.quotation_number : ""}
                  disabled
                  placeholder="System-generated"
                />
              </L>
              <L label="Quotation date">
                <input
                  type="date"
                  className="inp"
                  value={f.quotation_date}
                  onChange={(e) => setF({ ...f, quotation_date: e.target.value })}
                  disabled={!editable}
                />
              </L>
              <L label="Valid until">
                <input
                  type="date"
                  className="inp"
                  value={f.valid_until}
                  onChange={(e) => setF({ ...f, valid_until: e.target.value })}
                  disabled={!editable}
                />
              </L>
              <L label="Customer">
                <SearchableSelect
                  value={f.customer_id}
                  onChange={pickCustomer}
                  placeholder="Select customer…"
                  disabled={!editable}
                  options={customers.map((c) => ({ value: c.id, label: c.name }))}
                />
              </L>
              <L label="Or prospect name">
                <input
                  className="inp"
                  value={f.prospect_name}
                  onChange={(e) => setF({ ...f, prospect_name: e.target.value })}
                  placeholder="Free-text prospect (if no customer)"
                  disabled={!editable}
                />
              </L>
              <L label="Contact person">
                <input
                  className="inp"
                  value={f.contact_person}
                  onChange={(e) => setF({ ...f, contact_person: e.target.value })}
                  placeholder="Auto-filled from customer"
                  disabled={!editable}
                />
              </L>
              <L label="Billing address">
                <textarea
                  rows={2}
                  className="inp resize-y"
                  value={f.billing_address}
                  onChange={(e) => setF({ ...f, billing_address: e.target.value })}
                  placeholder="Optional"
                  disabled={!editable}
                />
              </L>
              <L label="Delivery address">
                <textarea
                  rows={2}
                  className="inp resize-y"
                  value={f.delivery_address}
                  onChange={(e) => setF({ ...f, delivery_address: e.target.value })}
                  placeholder="Optional"
                  disabled={!editable}
                />
              </L>
              <L label="Salesperson / owner">
                <input className="inp" value={q?.salesperson_name ?? "You"} disabled />
              </L>
              <L label="Payment terms">
                <input
                  list="payment-terms"
                  className="inp"
                  value={f.payment_terms}
                  onChange={(e) => setF({ ...f, payment_terms: e.target.value })}
                  placeholder="Net 30"
                  disabled={!editable}
                />
                <datalist id="payment-terms">
                  {PAYMENT_TERMS.filter(Boolean).map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </L>
              <L label="Expected delivery date">
                <input
                  type="date"
                  className="inp"
                  value={f.expected_delivery_date}
                  onChange={(e) => setF({ ...f, expected_delivery_date: e.target.value })}
                  disabled={!editable}
                />
              </L>
            </div>
            <div className="mt-3">
              <L label="Notes">
                <textarea
                  rows={2}
                  className="inp resize-y"
                  value={f.notes}
                  onChange={(e) => setF({ ...f, notes: e.target.value })}
                  placeholder="Terms, inclusions, exclusions…"
                  disabled={!editable}
                />
              </L>
            </div>
            <div className="mt-3">
              <DocumentUploader
                userId={userId}
                scope="quotations"
                docs={docs}
                onChange={setDocs}
                hint="Attach the customer requirement or product images."
              />
            </div>
          </fieldset>

          {/* Line items */}
          <fieldset className="rounded-lg border border-border/60 p-4">
            <legend className="px-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Quotation item lines
            </legend>
            {products.length === 0 ? (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
                No active products in the catalogue yet — add products in the Product catalogue tab
                first.
              </div>
            ) : (
              <div className="space-y-2">
                <div className="hidden grid-cols-12 gap-2 text-[9px] uppercase tracking-widest text-muted-foreground md:grid">
                  <div className="col-span-3">SKU / Product</div>
                  <div className="col-span-1">Qty</div>
                  <div className="col-span-2">Unit / updated price</div>
                  <div className="col-span-2">Discount</div>
                  <div className="col-span-1">GST %</div>
                  <div className="col-span-2 text-right">Line total</div>
                  <div className="col-span-1"></div>
                </div>
                {lines.map((l, i) => {
                  const gross = (Number(l.quantity) || 0) * effPrice(l);
                  const lineTotal = round2(gross - lineDiscount(l));
                  return (
                    <div key={i} className="space-y-2 rounded-md border border-border/50 p-2">
                      <div className="grid grid-cols-2 items-end gap-2 md:grid-cols-12">
                        <div className="col-span-2 md:col-span-3">
                          <L label="Product">
                            <SearchableSelect
                              value={l.product_id}
                              onChange={(v) => pickProduct(i, v)}
                              placeholder="Select product…"
                              disabled={!editable}
                              options={products.map((p) => ({
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
                          <L label="Qty">
                            <input
                              type="number"
                              min="1"
                              step="0.001"
                              className="inp"
                              value={l.quantity}
                              onChange={(e) => setLine(i, { quantity: e.target.value })}
                              disabled={!editable}
                            />
                          </L>
                        </div>
                        <div className="md:col-span-2 space-y-1.5">
                          <L
                            label={
                              l.updated_unit_price !== "" ? "Unit price (original)" : "Unit price"
                            }
                          >
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              className={`inp ${l.updated_unit_price !== "" ? "!text-muted-foreground line-through decoration-muted-foreground/40" : ""}`}
                              value={l.unit_price}
                              onChange={(e) => setLine(i, { unit_price: e.target.value })}
                              disabled={!editable}
                              placeholder="Selling price"
                            />
                          </L>
                          <L label="Updated price">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              className={`inp ${l.updated_unit_price !== "" ? "!border-primary/50 text-primary font-medium" : ""}`}
                              value={l.updated_unit_price}
                              onChange={(e) => setLine(i, { updated_unit_price: e.target.value })}
                              disabled={!editable}
                              placeholder="Same as unit price"
                            />
                          </L>
                          {l.updated_unit_price !== "" && editable && (
                            <div className="flex items-center justify-between text-[9px] text-muted-foreground">
                              <span className="font-medium text-primary">
                                Revision pending checker
                              </span>
                              <button
                                type="button"
                                onClick={() => setLine(i, { updated_unit_price: "" })}
                                className="hover:text-destructive"
                              >
                                Clear
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="md:col-span-2">
                          <L label="Discount">
                            <div className="flex gap-1.5">
                              <select
                                className="inp !w-20"
                                value={l.discount_type ?? ""}
                                onChange={(e) =>
                                  setLine(i, {
                                    discount_type:
                                      e.target.value === ""
                                        ? null
                                        : (e.target.value as "pct" | "amount"),
                                  })
                                }
                                disabled={!editable}
                              >
                                <option value="">None</option>
                                <option value="pct">%</option>
                                <option value="amount">₹</option>
                              </select>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                className="inp"
                                value={l.discount_value}
                                onChange={(e) => setLine(i, { discount_value: e.target.value })}
                                disabled={!editable || !l.discount_type}
                                placeholder={l.discount_type === "pct" ? "0–100" : "0.00"}
                              />
                            </div>
                          </L>
                        </div>
                        <div>
                          <L label="GST %">
                            <input
                              list="q-gst-rates"
                              type="number"
                              min="0"
                              step="0.01"
                              className="inp"
                              value={l.gst_rate}
                              onChange={(e) => setLine(i, { gst_rate: e.target.value })}
                              disabled={!editable}
                            />
                          </L>
                        </div>
                        <div className="text-right md:col-span-2">
                          <L label="Line total">
                            <div className="inp text-right font-mono tabular-nums">
                              {fmtMoney(lineTotal)}
                            </div>
                          </L>
                        </div>
                        <div className="flex items-end justify-end gap-1 pb-1">
                          {editable && (
                            <button
                              type="button"
                              onClick={() => removeLine(i)}
                              className="rounded p-1 text-muted-foreground hover:text-destructive"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                      {editable && (
                        <L label="Line notes">
                          <input
                            className="inp !py-1.5 text-xs"
                            value={l.notes}
                            onChange={(e) => setLine(i, { notes: e.target.value })}
                            placeholder="Optional line note…"
                          />
                        </L>
                      )}
                      {!editable && l.notes ? (
                        <div className="text-[10px] text-muted-foreground">Note: {l.notes}</div>
                      ) : null}
                    </div>
                  );
                })}
                {editable && (
                  <button
                    type="button"
                    onClick={addLine}
                    className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add line
                  </button>
                )}
              </div>
            )}
          </fieldset>

          {/* Totals */}
          <div className="ml-auto max-w-xs space-y-1 rounded-lg border border-border/60 bg-muted/20 p-4 text-sm">
            <Row
              label="Total quantity"
              value={lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0).toLocaleString()}
            />
            <Row label="Subtotal" value={fmtMoney(totals.subtotal)} />
            <Row label="Total discount" value={fmtMoney(totals.totalDiscount)} />
            <Row label="GST total" value={fmtMoney(totals.gstTotal)} />
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">
                Freight / charges
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                className="inp !w-28 !py-1 text-right"
                value={f.freight}
                onChange={(e) => setF({ ...f, freight: e.target.value })}
                disabled={!editable}
              />
            </div>
            <div className="flex items-center justify-between border-t border-border pt-1.5 font-medium">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">
                Grand total
              </span>
              <span className="num text-base">{fmtMoney(totals.grandTotal)}</span>
            </div>
          </div>

          {/* Status actions + save */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <div className="flex flex-wrap items-center gap-2">
              {isEdit &&
                canWrite &&
                status === "draft" &&
                approval !== "pending_review" &&
                approval !== "approved" && (
                  <button
                    type="button"
                    onClick={() => changeStatus("sent", "Quotation sent")}
                    disabled={statusBusy}
                    className="inline-flex items-center gap-1.5 rounded-md border border-primary/50 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
                  >
                    {statusBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    Send to customer
                  </button>
                )}
              {/* Maker → checker price approval. Available while the quote can
                  still change (draft / rejected / sent without a decision). */}
              {isEdit &&
                canWrite &&
                status !== "converted_to_so" &&
                !["pending_review", "approved"].includes(approval ?? "") && (
                  <button
                    type="button"
                    onClick={submitForApproval}
                    className="inline-flex items-center gap-1.5 rounded-md border border-primary/50 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
                    title="Send the updated prices to the checker for approval before converting to a sales order"
                  >
                    <Send className="h-3.5 w-3.5" /> Submit for approval
                  </button>
                )}
              {isEdit &&
                canWrite &&
                status === "sent" &&
                approval !== "pending_review" &&
                approval !== "approved" && (
                  <>
                    {/* Accept/reject is decided by the customer via the emailed
                        approval link — never from this panel. The response is
                        fetched back and shown as the debtor status pill. */}
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-primary">
                      <Mail className="h-3 w-3" /> The customer accepts or rejects via the emailed
                      link{q?.debtor_approval_email ? ` (sent to ${q.debtor_approval_email})` : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => changeStatus("expired", "Quotation marked expired")}
                      className="inline-flex items-center gap-1.5 rounded-md border border-warning/40 px-3 py-1.5 text-xs font-medium text-warning hover:bg-warning/10"
                    >
                      <Clock4 className="h-3.5 w-3.5" /> Mark expired
                    </button>
                  </>
                )}
              {/* Convert is only possible after the checker approved the prices. */}
              {isEdit && canWrite && approval === "approved" && status !== "converted_to_so" && (
                <button
                  type="button"
                  onClick={() => convert.mutate()}
                  disabled={convert.isPending}
                  className="inline-flex items-center gap-1.5 rounded-md border border-primary/50 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
                >
                  {convert.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ArrowRight className="h-3.5 w-3.5" />
                  )}
                  Convert to sales order
                </button>
              )}
              {approval === "pending_review" && (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-warning">
                  <Clock4 className="h-3 w-3" /> Waiting for the checker to review the updated
                  prices…
                </span>
              )}
              {approval === "approved" && status !== "converted_to_so" && (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-primary">
                  <CheckCircle2 className="h-3 w-3" /> Prices approved — you can now convert to a
                  sales order.
                </span>
              )}
              {approval === "rejected" && (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-destructive">
                  <Ban className="h-3 w-3" /> Checker requested price revisions — update the updated
                  prices and resubmit.
                </span>
              )}
              <p className="w-full text-[10px] text-muted-foreground md:w-auto md:self-center">
                Quotations never affect inventory or accounting — stock moves only after a confirmed
                dispatch.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-border px-4 py-2 text-sm"
              >
                Close
              </button>
              {editable && (
                <button
                  disabled={save.isPending}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
                >
                  {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isEdit ? "Save changes" : "Save as draft"}
                </button>
              )}
            </div>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:disabled{opacity:.55}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
        <datalist id="q-gst-rates">
          <option value="0" />
          <option value="5" />
          <option value="12" />
          <option value="18" />
          <option value="28" />
        </datalist>
      </div>
    </div>
  );
}

// ─── Small helpers (mirror app.purchase-orders.tsx) ─────────────────────
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}

function StatusPill({ status, label, tone }: { status: string; label: string; tone?: string }) {
  const cls = tone ?? Q_STATUS_TONES[status] ?? "bg-muted/60 text-muted-foreground border-border";
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${cls}`}
    >
      {label}
    </span>
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

function StatTile({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
        <Icon className="h-4 w-4 text-muted-foreground/60" />
      </div>
      <div className="mt-1 font-display text-2xl">{value}</div>
    </div>
  );
}
