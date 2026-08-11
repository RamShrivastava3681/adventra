import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import {
  Plus,
  X,
  Loader2,
  Trash2,
  Link2,
  PackageOpen,
  Ban,
  CheckCircle2,
  Send,
  FileSignature,
} from "lucide-react";
import { TableSkeleton } from "@/components/skeletons";
import { toast } from "sonner";
import { DocumentUploader, type DocMeta } from "@/components/document-uploader";
import { SearchableSelect } from "@/components/ui/searchable-select";

export const Route = createFileRoute("/app/proformas")({
  component: ProformasPage,
});

type PFLine = {
  product_id: string;
  sku: string | null;
  name: string;
  unit: string;
  quantity: number;
  unit_price: number;
  gst_rate: number | null;
  line_total: number;
};

type PF = {
  id: string;
  client_id: string;
  side: "sales" | "purchase";
  debtor_id: string | null;
  vendor_id: string | null;
  debtor?: { name?: string } | null;
  vendor?: { name?: string } | null;
  po_number: string;
  proforma_number: string | null;
  proforma_date: string | null;
  amount: number;
  po_amount: number | null;
  currency: string;
  issue_date: string;
  status: string;
  proforma_status: string;
  proforma_review_comments: string | null;
  proforma_funded_amount: number | null;
  notes: string | null;
  // ── Supplier-proforma fields (purchase side) ──
  supplier_contact: string | null;
  supplier_gstin: string | null;
  valid_until: string | null;
  payment_terms: string | null;
  expected_delivery_date: string | null;
  advance_pct: number | null;
  documents: DocMeta[];
  lines: PFLine[];
  subtotal: number;
  gst_total: number;
  freight: number;
  grand_total: number;
  linked_goods_po_id: string | null;
  linked_goods_so_id: string | null;
  // ── Sales-side (customer proforma) fields ──
  debtor_contact: string | null;
  debtor_gstin: string | null;
};

// Document statuses for proformas — purchase (supplier quotations) and
// sales (customer proformas entered/uploaded into the system).
const PF_DOC_STATUSES = [
  "received",
  "reviewed",
  "converted_to_po",
  "converted_to_so",
  "expired",
  "cancelled",
];
const PF_DOC_LABELS: Record<string, string> = {
  received: "Received",
  reviewed: "Reviewed",
  converted_to_po: "Converted to PO",
  converted_to_so: "Converted to Sales Order",
  expired: "Expired",
  cancelled: "Cancelled",
};
const PF_DOC_TONES: Record<string, string> = {
  received: "bg-sky-500/10 text-sky-600 border-sky-500/30",
  reviewed: "bg-blue-500/10 text-blue-600 border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-400 dark:border-blue-500/40",
  converted_to_po: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  expired: "bg-muted/60 text-muted-foreground border-border",
  cancelled: "bg-destructive/10 text-destructive border-destructive/30",
};
const FUNDING_TONES: Record<string, string> = {
  pending_review: "border-warning/50 text-warning",
  approved: "border-primary/50 text-primary",
  funded: "border-success/50 text-success",
  rejected: "border-destructive/50 text-destructive",
};

// Document lifecycle is over for these statuses — they never sit in a workflow
// stage and their funding dimension is closed.
const DOC_CLOSED = ["cancelled", "expired", "converted_to_po", "converted_to_so"];

const CURRENCIES = ["USD", "INR", "EUR", "GBP", "AED"];
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

type CatalogueProduct = {
  id: string;
  sku: string | null;
  name: string;
  unit_of_measure: string;
  gst_rate: number | null;
  unit_cost: number | null;
  unit_price: number | null;
  status: string;
};

type GoodsPOForConvert = {
  id: string;
  po_number?: string;
  supplier_name?: string | null;
  grand_total?: number | null;
  status?: string;
};

function ProformasPage() {
  const { user, isAdmin, isClient, isChecker, isTreasury } = useAuth();
  const canCreate = isAdmin || (isClient && !isChecker && !isTreasury);
  const qc = useQueryClient();
  const [open, setOpen] = useState<null | "sales" | "purchase">(null);
  const [tab, setTab] = useState<"all" | "sales" | "purchase">("all");
  const [queue, setQueue] = useState<"all" | "pending_review" | "approved" | "funded" | "rejected">(
    "all",
  );
  const [reviewFor, setReviewFor] = useState<PF | null>(null);
  const [fundFor, setFundFor] = useState<PF | null>(null);
  const [convertFor, setConvertFor] = useState<PF | null>(null);
  const [editingPf, setEditingPf] = useState<PF | null>(null);
  const [viewingPf, setViewingPf] = useState<PF | null>(null);

  const listQ = useQuery({
    queryKey: ["proformas"],
    queryFn: async () => {
      const data = (await api.purchaseOrders.list()) as PF[];
      return data.reverse().map((p) => ({
        ...p,
        // Rescue proformas created before proformaStatus was persisted by the
        // backend — they were stored as "draft" but are actually pending review.
        proforma_status:
          p.proforma_status === "draft" && p.status === "proforma"
            ? "pending_review"
            : p.proforma_status,
      }));
    },
  });

  // Catalogue + suppliers for the purchase (supplier quotation) proforma form.
  const productsQ = useQuery({
    queryKey: ["products-for-pf"],
    queryFn: async () => {
      const data = (await api.products.list()) as CatalogueProduct[];
      return data.filter((p) => p.status === "active");
    },
  });
  const suppliersQ = useQuery({
    queryKey: ["suppliers-for-pf"],
    queryFn: async () => {
      const [suppliers, vendors] = await Promise.all([api.suppliers.list(), api.vendors.list()]);
      return [
        ...suppliers.map(
          (s: {
            id: string;
            company_name?: string;
            companyName?: string;
            name?: string;
            contact_name?: string;
            contactName?: string;
            contact_email?: string;
            contactEmail?: string;
            contact_phone?: string;
            contactPhone?: string;
          }) => ({
            id: s.id,
            name: s.company_name ?? s.companyName ?? s.name ?? s.id,
            contact: [
              s.contact_name ?? s.contactName,
              s.contact_email ?? s.contactEmail,
              s.contact_phone ?? s.contactPhone,
            ]
              .filter(Boolean)
              .join(" · "),
          }),
        ),
        ...vendors.map((v: { id: string; name?: string }) => ({
          id: v.id,
          name: v.name ?? v.id,
          contact: "",
        })),
      ].sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  // Goods POs available to link when converting a proforma.
  const goodsPosQ = useQuery({
    queryKey: ["goods-pos-for-convert"],
    queryFn: async () => api.goodsPurchaseOrders.list(),
    enabled: !!convertFor,
  });

  const rows = ((listQ.data ?? []) as PF[])
    .filter((p) => tab === "all" || p.side === tab)
    .filter((p) => {
      if (queue === "all") return true;
      // Closed proformas never sit in a workflow stage
      if (DOC_CLOSED.includes(p.status)) return false;
      if (queue === "approved") return p.proforma_status === "approved";
      return p.proforma_status === queue;
    });

  const counts = useMemo(() => {
    const arr = ((listQ.data ?? []) as PF[]).filter((p) => !DOC_CLOSED.includes(p.status));
    return {
      pending_review: arr.filter((p) => p.proforma_status === "pending_review").length,
      approved: arr.filter((p) => p.proforma_status === "approved").length,
      funded: arr.filter((p) => p.proforma_status === "funded").length,
      rejected: arr.filter((p) => p.proforma_status === "rejected").length,
    };
  }, [listQ.data]);

  const cancel = useMutation({
    mutationFn: async (id: string) => {
      await api.purchaseOrders.update(id, { status: "cancelled" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["proformas"] });
      toast.success("Cancelled");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // After a checker rejection the maker can fix the proforma and send it back
  // into the approval pipeline (backend allows pending_review from rejected).
  const resubmit = useMutation({
    mutationFn: async (id: string) => {
      await api.purchaseOrders.update(id, { proforma_status: "pending_review" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["proformas"] });
      toast.success("Submitted for checker approval again");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const setDocStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await api.purchaseOrders.update(id, { status });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["proformas"] });
      toast.success("Status updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      await api.purchaseOrders.delete(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["proformas"] });
      toast.success("Removed");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // Sales proforma → auto-create a DRAFT sales order and link it.
  const convertSo = useMutation({
    mutationFn: async (id: string) => api.purchaseOrders.convertToSO(id),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["proformas"] });
      qc.invalidateQueries({ queryKey: ["sales-orders"] });
      toast.success(`Draft sales order ${(res as any)?.salesOrder?.soNumber ?? ""} created`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div>
      <PageHeader
        eyebrow="Proforma invoices"
        title="Proformas & advances"
        description="Purchase proformas are supplier quotations with catalogue lines that can be converted into a purchase order. Sales proformas are customer proforma invoices entered into the system — catalogue lines, totals and an optional advance request, convertible into a sales order. Proformas never create inventory entries."
        icon={<FileSignature className="h-5 w-5" />}
        actions={
          canCreate ? (
            <div className="flex gap-2">
              <button
                onClick={() => setOpen("sales")}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                <Plus className="h-4 w-4" /> Sales proforma
              </button>
              <button
                onClick={() => setOpen("purchase")}
                className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm"
              >
                <Plus className="h-4 w-4" /> Purchase proforma
              </button>
            </div>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
              Read-only
            </span>
          )
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        <div className="flex flex-wrap gap-2">
          {(["all", "sales", "purchase"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setTab(s)}
              className={`rounded-full border px-3 py-1 text-xs uppercase tracking-widest transition ${
                tab === s
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {s === "all" ? "All" : s === "sales" ? "Sales" : "Purchase"}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {(
            [
              ["all", "All stages", null],
              ["pending_review", "Pending review", counts.pending_review],
              ["approved", "Funding queue", counts.approved],
              ["funded", "Funded", counts.funded],
              ["rejected", "Rejected", counts.rejected],
            ] as const
          ).map(([k, label, n]) => (
            <button
              key={k}
              onClick={() => setQueue(k as typeof queue)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1 text-[11px] transition ${
                queue === k
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
          {listQ.isLoading ? (
            <TableSkeleton rows={5} cols={8} />
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No proformas yet.</div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Proforma</th>
                    <th className="px-5 py-2 text-left font-normal">PO #</th>
                    <th className="px-5 py-2 text-left font-normal">Counterparty</th>
                    <th className="px-5 py-2 text-left font-normal">Side</th>
                    <th className="px-5 py-2 text-right font-normal">Invoice amount</th>
                    <th className="px-5 py-2 text-right font-normal">Advance</th>
                    <th className="px-5 py-2 text-left font-normal">Status</th>
                    <th className="px-5 py-2 text-right font-normal"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const cp = p.side === "sales" ? p.debtor?.name : p.vendor?.name;
                    // Doc lifecycle: received → reviewed → converted (PO/SO) → expired/cancelled.
                    // Applies to BOTH sides — sales proformas are customer proformas entered
                    // into the system, purchase proformas are supplier quotations.
                    const docStatus = PF_DOC_LABELS[p.status] ? p.status : null;
                    // Doc lifecycle is over — the funding dimension closes with it.
                    const docClosed = DOC_CLOSED.includes(p.status);
                    const poLink = docStatus === "converted_to_po" ? p.linked_goods_po_id : null;
                    const soLink = docStatus === "converted_to_so" ? p.linked_goods_so_id : null;
                    const editableDoc =
                      p.side === "purchase"
                        ? ["received", "reviewed"].includes(p.status)
                        : ["received", "reviewed", "proforma"].includes(p.status);
                    // Once submitted for review (or approved) the maker can no
                    // longer change the proforma — the checker/treasury own it.
                    const underReview = ["pending_review", "approved"].includes(p.proforma_status);
                    // The proforma invoice amount (total) and the advance due on
                    // it: PO-created purchase proformas carry advance_pct (×
                    // po_amount); manually entered proformas use `amount` as the
                    // advance requested.
                    const pfTotal =
                      p.grand_total != null && p.grand_total > 0 ? p.grand_total : p.amount;
                    const pfAdvance = proformaAdvanceForDisplay(p);
                    return (
                      <tr key={p.id} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-3">
                          <div className="font-mono text-xs">{p.proforma_number ?? "—"}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {p.proforma_date ? fmtDate(p.proforma_date) : fmtDate(p.issue_date)}
                          </div>
                          {p.grand_total != null && p.grand_total > 0 && (
                            <div className="text-[10px] text-muted-foreground">
                              Total {fmtMoney(p.grand_total)}
                            </div>
                          )}
                          {p.po_amount != null && p.po_amount > 0 && (
                            <div className="text-[10px] text-muted-foreground">
                              PO {fmtMoney(p.po_amount)}
                            </div>
                          )}
                          {p.proforma_review_comments && (
                            <div
                              className="text-[10px] text-warning mt-0.5"
                              title={p.proforma_review_comments}
                            >
                              “{p.proforma_review_comments}”
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3 font-mono text-xs">{p.po_number}</td>
                        <td className="px-5 py-3">{cp ?? "—"}</td>
                        <td className="px-5 py-3 text-[10px] uppercase tracking-widest text-muted-foreground">
                          {p.side}
                        </td>
                        <td className="px-5 py-3 text-right num">
                          <div>{fmtMoney(pfTotal)}</div>
                          {p.advance_pct != null && p.advance_pct > 0 && (
                            <div className="text-[10px] text-muted-foreground">
                              {p.advance_pct}% of proforma
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right num">
                          <div>{fmtMoney(pfAdvance)}</div>
                          {p.proforma_funded_amount != null && p.proforma_funded_amount > 0 && (
                            <div className="text-[10px] text-success">
                              Paid {fmtMoney(p.proforma_funded_amount)}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex flex-col items-start gap-1">
                            {docStatus && (
                              <StatusPill
                                label={PF_DOC_LABELS[docStatus] ?? docStatus}
                                tone={PF_DOC_TONES[docStatus]}
                              />
                            )}
                            {p.proforma_status && p.proforma_status !== "none" ? (
                              <StatusPill
                                label={p.proforma_status.replace("_", " ")}
                                tone={FUNDING_TONES[p.proforma_status]}
                              />
                            ) : !docStatus ? (
                              <StatusPill
                                label={p.status}
                                tone="border-border text-muted-foreground"
                              />
                            ) : null}
                            {poLink && (
                              <span className="inline-flex items-center gap-1 text-[9px] text-primary">
                                <Link2 className="h-2.5 w-2.5" /> Linked PO
                              </span>
                            )}
                            {soLink && (
                              <span className="inline-flex items-center gap-1 text-[9px] text-primary">
                                <Link2 className="h-2.5 w-2.5" /> Linked SO
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="inline-flex flex-wrap items-center justify-end gap-1">
                            <button
                              onClick={() => setViewingPf(p)}
                              className="rounded-md border border-border px-2 py-0.5 text-[10px] hover:border-primary hover:text-primary"
                            >
                              View
                            </button>
                            {canCreate &&
                              !underReview &&
                              p.proforma_status !== "funded" &&
                              p.status !== "invoiced" &&
                              p.status !== "cancelled" &&
                              editableDoc && (
                                <button
                                  onClick={() => setEditingPf(p)}
                                  className="rounded-md border border-border px-2 py-0.5 text-[10px] hover:border-primary hover:text-primary"
                                >
                                  Edit
                                </button>
                              )}
                            {/* Conversion to a PO/SO only unlocks after the checker
                                approves the proforma (enforced server-side too). */}
                            {canCreate &&
                              p.side === "purchase" &&
                              ["received", "reviewed"].includes(p.status) &&
                              p.proforma_status === "approved" && (
                                <button
                                  onClick={() => setConvertFor(p)}
                                  className="inline-flex items-center gap-1 rounded-md border border-primary/50 px-2 py-0.5 text-[10px] text-primary hover:bg-primary/10"
                                >
                                  <PackageOpen className="h-3 w-3" /> Convert to PO
                                </button>
                              )}
                            {canCreate &&
                              p.side === "purchase" &&
                              ["received", "reviewed"].includes(p.status) &&
                              p.proforma_status === "pending_review" && (
                                <span
                                  className="rounded-md border border-border px-2 py-0.5 text-[10px] text-muted-foreground"
                                  title="Conversion unlocks after the checker approves this proforma"
                                >
                                  Awaiting approval
                                </span>
                              )}
                            {canCreate &&
                              p.side === "sales" &&
                              ["received", "reviewed"].includes(p.status) &&
                              p.proforma_status === "approved" && (
                                <button
                                  onClick={() => convertSo.mutate(p.id)}
                                  disabled={convertSo.isPending}
                                  className="inline-flex items-center gap-1 rounded-md border border-primary/50 px-2 py-0.5 text-[10px] text-primary hover:bg-primary/10 disabled:opacity-60"
                                >
                                  <PackageOpen className="h-3 w-3" /> Convert to SO
                                </button>
                              )}
                            {canCreate &&
                              p.side === "sales" &&
                              ["received", "reviewed"].includes(p.status) &&
                              p.proforma_status === "pending_review" && (
                                <span
                                  className="rounded-md border border-border px-2 py-0.5 text-[10px] text-muted-foreground"
                                  title="Conversion unlocks after the checker approves this proforma"
                                >
                                  Awaiting approval
                                </span>
                              )}
                            {canCreate && p.status === "received" && (
                              <button
                                onClick={() =>
                                  setDocStatus.mutate({ id: p.id, status: "reviewed" })
                                }
                                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[10px] hover:border-primary hover:text-primary"
                              >
                                <CheckCircle2 className="h-3 w-3" /> Reviewed
                              </button>
                            )}
                            {canCreate && ["received", "reviewed"].includes(p.status) && (
                              <button
                                onClick={() => setDocStatus.mutate({ id: p.id, status: "expired" })}
                                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:border-warning hover:text-warning"
                              >
                                <Ban className="h-3 w-3" /> Expire
                              </button>
                            )}
                            {(isChecker || isAdmin) &&
                              !docClosed &&
                              p.proforma_status === "pending_review" &&
                              (isAdmin || p.client_id !== user?.id) && (
                                <button
                                  onClick={() => setReviewFor(p)}
                                  className="rounded-md border border-warning/50 px-2 py-0.5 text-[10px] text-warning hover:bg-warning/10"
                                >
                                  Review
                                </button>
                              )}
                            {canCreate && !docClosed && p.proforma_status === "rejected" && (
                              <button
                                onClick={() => resubmit.mutate(p.id)}
                                disabled={resubmit.isPending}
                                className="inline-flex items-center gap-1 rounded-md border border-primary/50 px-2 py-0.5 text-[10px] text-primary hover:bg-primary/10 disabled:opacity-60"
                              >
                                <Send className="h-3 w-3" /> Resubmit for approval
                              </button>
                            )}
                            {(isTreasury || isAdmin) &&
                              !docClosed &&
                              p.proforma_status === "approved" && (
                                <button
                                  onClick={() => setFundFor(p)}
                                  className="rounded-md border border-success/50 px-2 py-0.5 text-[10px] text-success hover:bg-success/10"
                                >
                                  {p.side === "sales" ? "Mark received" : "Mark paid"}
                                </button>
                              )}
                            {canCreate &&
                              p.status !== "invoiced" &&
                              p.status !== "cancelled" &&
                              p.proforma_status !== "funded" && (
                                <button
                                  onClick={() => cancel.mutate(p.id)}
                                  className="rounded-md border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
                                >
                                  Cancel
                                </button>
                              )}
                            {canCreate &&
                              (p.status === "cancelled" ||
                                p.status === "expired" ||
                                p.proforma_status === "rejected") && (
                                <button
                                  onClick={() => del.mutate(p.id)}
                                  className="text-muted-foreground hover:text-destructive"
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

        <Card title="How this works">
          <ol className="ml-4 list-decimal space-y-1 text-xs text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Purchase proforma</span> — record a
              supplier quotation (catalogue lines, totals, attachment) as Received, review it, and
              convert it to a Purchase order.
            </li>
            <li>
              <span className="font-medium text-foreground">Sales proforma</span> — record the
              customer's proforma invoice (catalogue lines, totals, attachment) as Received, review
              it, and convert it to a Sales order (a draft SO is auto-created, never stock). An
              optional advance request flows through the checker/treasury pipeline and is applied to
              the final invoice with the same PO number.
            </li>
            <li>
              Advances recorded against a PO are auto-deducted when the final invoice is raised —
              the balance shows as due or outstanding.
            </li>
          </ol>
        </Card>
      </div>

      {open && user && open === "sales" && (
        <SalesProformaModal
          userId={user.id}
          products={(productsQ.data ?? []) as CatalogueProduct[]}
          onClose={() => setOpen(null)}
        />
      )}
      {open && user && open === "purchase" && (
        <PurchaseProformaModal
          userId={user.id}
          products={(productsQ.data ?? []) as CatalogueProduct[]}
          suppliers={
            (suppliersQ.data ?? []) as Array<{ id: string; name: string; contact: string }>
          }
          onClose={() => setOpen(null)}
        />
      )}
      {editingPf && user && editingPf.side === "sales" && (
        <SalesProformaModal
          userId={user.id}
          pf={editingPf}
          products={(productsQ.data ?? []) as CatalogueProduct[]}
          onClose={() => setEditingPf(null)}
        />
      )}
      {editingPf && user && editingPf.side === "purchase" && (
        <PurchaseProformaModal
          userId={user.id}
          pf={editingPf}
          products={(productsQ.data ?? []) as CatalogueProduct[]}
          suppliers={
            (suppliersQ.data ?? []) as Array<{ id: string; name: string; contact: string }>
          }
          onClose={() => setEditingPf(null)}
        />
      )}
      {reviewFor && user && (
        <ReviewModal pf={reviewFor} userId={user.id} onClose={() => setReviewFor(null)} />
      )}
      {fundFor && user && (
        <FundModal pf={fundFor} userId={user.id} onClose={() => setFundFor(null)} />
      )}
      {convertFor && (
        <ConvertModal
          pf={convertFor}
          goodsPos={goodsPosQ.data ?? []}
          loading={goodsPosQ.isLoading}
          onClose={() => setConvertFor(null)}
          onConverted={() => {
            qc.invalidateQueries({ queryKey: ["proformas"] });
            setConvertFor(null);
          }}
        />
      )}
      {viewingPf && <ProformaDetailModal pf={viewingPf} onClose={() => setViewingPf(null)} />}
    </div>
  );
}

// ─── Status pill ──────────────────────────────────────────────────────────
function StatusPill({ label, tone }: { label: string; tone?: string }) {
  const cls = tone ?? "border-warning/50 text-warning";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${cls}`}
    >
      {label}
    </span>
  );
}

// ─── Sales proforma (customer proforma with catalogue lines) ─────────────
// A customer proforma invoice is given to the debtor and entered/uploaded into
// the system. It NEVER creates inventory entries — only a confirmed dispatch
// debits stock. Lines come from the catalogue; the advance payment requested
// (optional) feeds the existing funding pipeline.
function SalesProformaModal({
  userId,
  pf,
  products,
  onClose,
}: {
  userId: string;
  pf?: PF;
  products: CatalogueProduct[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!pf;
  const [f, setF] = useState({
    proforma_number: pf?.proforma_number ?? "",
    proforma_date:
      (pf?.proforma_date ?? new Date().toISOString().slice(0, 10))?.slice(0, 10) ??
      new Date().toISOString().slice(0, 10),
    party_id: pf?.debtor_id ?? "",
    debtor_contact: pf?.debtor_contact ?? "",
    debtor_gstin: pf?.debtor_gstin ?? "",
    valid_until: (pf?.valid_until ?? "")?.slice(0, 10) ?? "",
    currency: pf?.currency ?? "USD",
    payment_terms: pf?.payment_terms ?? "",
    expected_delivery_date: (pf?.expected_delivery_date ?? "")?.slice(0, 10) ?? "",
    notes: pf?.notes ?? "",
    linked_so_id: pf?.linked_goods_so_id ?? "",
    po_number: pf?.po_number ?? "",
    amount: pf?.amount != null && pf.amount > 0 ? String(pf.amount) : "",
    freight: pf?.freight != null ? String(pf.freight) : "",
  });
  const [lines, setLines] = useState<LineDraft[]>(
    (pf?.lines ?? []).map((l) => ({
      product_id: l.product_id,
      sku: l.sku,
      name: l.name,
      unit: l.unit,
      quantity: String(l.quantity),
      unit_price: String(l.unit_price),
      gst_rate: l.gst_rate != null ? String(l.gst_rate) : "",
    })),
  );
  const [docs, setDocs] = useState<DocMeta[]>(pf?.documents ?? []);

  const setLine = (i: number, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const pickProduct = (i: number, id: string) => {
    const p = products.find((x) => x.id === id);
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
        gst_rate: "",
      },
    ]);

  const totals = useMemo(() => {
    const subtotal = round2(
      lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0),
    );
    const gstTotal = round2(
      lines.reduce(
        (s, l) =>
          s +
          ((Number(l.quantity) || 0) * (Number(l.unit_price) || 0) * (Number(l.gst_rate) || 0)) /
            100,
        0,
      ),
    );
    const freight = Number(f.freight) || 0;
    return { subtotal, gstTotal, freight, grandTotal: round2(subtotal + gstTotal + freight) };
  }, [lines, f.freight]);

  const partiesQ = useQuery({
    queryKey: ["pf-debtors"],
    queryFn: async () => {
      const data = await api.debtors.list();
      return data
        .map(
          (d: {
            id: string;
            name?: string;
            contact_name?: string;
            contact_email?: string;
            contact_phone?: string;
          }) => ({
            id: d.id,
            name: d.name ?? d.id,
            contact: [d.contact_name, d.contact_email, d.contact_phone].filter(Boolean).join(" · "),
          }),
        )
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  // Existing sales orders to optionally link this proforma to.
  const sosQ = useQuery({
    queryKey: ["pf-sales-orders"],
    queryFn: async () => api.goodsSalesOrders.list(),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!f.proforma_number.trim()) throw new Error("Proforma invoice number is required");
      if (!f.party_id) throw new Error("Pick a debtor");
      const payloadLines = lines.map((l) => ({
        product_id: l.product_id,
        sku: l.sku,
        name: l.name,
        unit: l.unit || "piece",
        quantity: Number(l.quantity) || 0,
        unit_price: Number(l.unit_price) || 0,
        gst_rate: l.gst_rate ? Number(l.gst_rate) : null,
      }));
      for (const l of payloadLines) {
        if (!l.product_id) throw new Error("Every line must select a product from the catalogue");
        if (!(l.quantity > 0)) throw new Error("Quantity must be greater than zero");
        if (l.unit_price < 0) throw new Error("Unit price must be greater than or equal to zero");
      }
      if (payloadLines.length === 0) {
        throw new Error("Add at least one product line");
      }
      const payload = {
        proformaNumber: f.proforma_number.trim(),
        proformaDate: f.proforma_date,
        debtorId: f.party_id,
        vendorId: null,
        debtorContact: f.debtor_contact.trim() || null,
        debtorGstin: f.debtor_gstin.trim() || null,
        validUntil: f.valid_until || null,
        currency: f.currency,
        paymentTerms: f.payment_terms || null,
        expectedDeliveryDate: f.expected_delivery_date || null,
        notes: f.notes.trim() || null,
        linkedGoodsSoId: f.linked_so_id || null,
        poNumber: f.po_number.trim() || null,
        amount: Number(f.amount) || 0,
        poAmount: null,
        issueDate: f.proforma_date,
        freight: Number(f.freight) || 0,
        documents: docs,
        lines: payloadLines,
      };
      if (isEdit && pf) {
        await api.purchaseOrders.update(pf.id, payload);
      } else {
        await api.purchaseOrders.create({
          ...payload,
          clientId: userId,
          side: "sales",
          status: "received",
          proformaStatus: "pending_review",
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["proformas"] });
      toast.success(isEdit ? "Proforma updated" : "Proforma recorded — submitted for review");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Modal title={`${isEdit ? "Edit" : "New"} sales proforma`} onClose={onClose} wide>
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
            Customer proforma
          </legend>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <L label="Proforma invoice number *">
              <input
                required
                className="inp"
                value={f.proforma_number}
                onChange={(e) => setF({ ...f, proforma_number: e.target.value })}
                placeholder="PF-2026-001"
              />
            </L>
            <L label="Proforma invoice date">
              <input
                type="date"
                className="inp"
                value={f.proforma_date}
                onChange={(e) => setF({ ...f, proforma_date: e.target.value })}
              />
            </L>
            <L label="Debtor *">
              <SearchableSelect
                value={f.party_id}
                onChange={(v) => {
                  const d = (partiesQ.data ?? []).find((x) => x.id === v);
                  setF({
                    ...f,
                    party_id: v,
                    debtor_contact: d?.contact ?? f.debtor_contact,
                  });
                }}
                placeholder="Select debtor…"
                options={(partiesQ.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
              />
            </L>
            <L label="Debtor contact">
              <input
                className="inp"
                value={f.debtor_contact}
                onChange={(e) => setF({ ...f, debtor_contact: e.target.value })}
                placeholder="Name · email · phone"
              />
            </L>
            <L label="Debtor GSTIN (optional)">
              <input
                className="inp"
                value={f.debtor_gstin}
                onChange={(e) => setF({ ...f, debtor_gstin: e.target.value })}
                placeholder="e.g. 27ABCDE1234F1Z5"
              />
            </L>
            <L label="Valid until">
              <input
                type="date"
                className="inp"
                value={f.valid_until}
                onChange={(e) => setF({ ...f, valid_until: e.target.value })}
              />
            </L>
            <L label="Currency">
              <select
                className="inp"
                value={f.currency}
                onChange={(e) => setF({ ...f, currency: e.target.value })}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </L>
            <L label="Payment terms">
              <input
                list="pf-sales-payment-terms"
                className="inp"
                value={f.payment_terms}
                onChange={(e) => setF({ ...f, payment_terms: e.target.value })}
                placeholder="Net 30"
              />
              <datalist id="pf-sales-payment-terms">
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
              />
            </L>
            <L label="Linked sales order (optional)">
              <SearchableSelect
                value={f.linked_so_id}
                onChange={(v) => setF({ ...f, linked_so_id: v })}
                placeholder="None"
                options={[
                  { value: "", label: "None" },
                  ...(sosQ.data ?? []).map((so: any) => ({
                    value: so.id,
                    label: so.so_number ?? so.id,
                    hint: so.customer_name ?? undefined,
                  })),
                ]}
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
                placeholder="Order remarks, delivery instructions…"
              />
            </L>
          </div>
          <div className="mt-3">
            <DocumentUploader
              userId={userId}
              scope="proformas"
              docs={docs}
              onChange={setDocs}
              hint="Attach the customer proforma invoice (PDF or image)."
            />
          </div>
        </fieldset>

        {/* Lines */}
        <fieldset className="rounded-lg border border-border/60 p-4">
          <legend className="px-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Product lines
          </legend>
          {products.length === 0 ? (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
              No active products in the catalogue yet — add products in the Product catalogue tab
              first.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="hidden grid-cols-12 gap-2 text-[9px] uppercase tracking-widest text-muted-foreground md:grid">
                <div className="col-span-4">SKU / Product</div>
                <div className="col-span-1">Unit</div>
                <div className="col-span-2">Qty</div>
                <div className="col-span-2">Unit price</div>
                <div className="col-span-1">GST %</div>
                <div className="col-span-1 text-right">Line total</div>
                <div className="col-span-1"></div>
              </div>
              {lines.map((l, i) => {
                const lineTotal = round2((Number(l.quantity) || 0) * (Number(l.unit_price) || 0));
                return (
                  <div
                    key={i}
                    className="grid grid-cols-2 items-end gap-2 rounded-md border border-border/50 p-2 md:grid-cols-12"
                  >
                    <div className="col-span-2 md:col-span-4">
                      <L label="Product">
                        <SearchableSelect
                          value={l.product_id}
                          onChange={(v) => pickProduct(i, v)}
                          placeholder="Select product…"
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
                      <L label="Unit">
                        <input
                          className="inp"
                          value={l.unit}
                          onChange={(e) => setLine(i, { unit: e.target.value })}
                        />
                      </L>
                    </div>
                    <div className="md:col-span-2">
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
          )}
        </fieldset>

        {/* Totals */}
        <div className="ml-auto max-w-xs space-y-1 rounded-lg border border-border/60 bg-muted/20 p-4 text-sm">
          <Row label="Subtotal" value={fmtMoney(totals.subtotal)} />
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
            />
          </div>
          <div className="flex items-center justify-between border-t border-border pt-1.5 font-medium">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              Grand total
            </span>
            <span className="num text-base">{fmtMoney(totals.grandTotal)}</span>
          </div>
        </div>

        {/* Advance & funding (checker/treasury flow) */}
        <fieldset className="rounded-lg border border-border/60 p-4">
          <legend className="px-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Advance & funding
          </legend>
          <div className="grid grid-cols-2 gap-3">
            <L label={`Advance payment requested (${f.currency}) — optional`}>
              <input
                type="number"
                step="0.01"
                min="0"
                className="inp"
                value={f.amount}
                onChange={(e) => setF({ ...f, amount: e.target.value })}
                placeholder="Optional"
              />
            </L>
            <L label="PO number (funding reference)">
              <input
                className="inp"
                value={f.po_number ?? ""}
                onChange={(e) => setF({ ...f, po_number: e.target.value })}
                placeholder="Optional — used to match advances"
              />
            </L>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            A proforma never creates inventory — stock only reduces after a confirmed dispatch. If
            an advance is requested it is submitted for checker review, then received by treasury.
            Convert the proforma to a Sales order from the list to hand it to the sales workflow.
          </p>
        </fieldset>

        <Actions
          onClose={onClose}
          pending={save.isPending}
          label={isEdit ? "Save changes" : "Record proforma"}
        />
      </form>
      <datalist id="pf-gst-rates">
        <option value="0" />
        <option value="5" />
        <option value="12" />
        <option value="18" />
        <option value="28" />
      </datalist>
    </Modal>
  );
}

// ─── Purchase proforma (supplier quotation) ──────────────────────────────
type LineDraft = {
  product_id: string;
  sku: string | null;
  name: string;
  unit: string;
  quantity: string;
  unit_price: string;
  gst_rate: string;
};

function PurchaseProformaModal({
  userId,
  pf,
  products,
  suppliers,
  onClose,
}: {
  userId: string;
  pf?: PF;
  products: CatalogueProduct[];
  suppliers: Array<{ id: string; name: string; contact: string }>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!pf;
  const [f, setF] = useState({
    proforma_number: pf?.proforma_number ?? "",
    proforma_date:
      (pf?.proforma_date ?? new Date().toISOString().slice(0, 10))?.slice(0, 10) ??
      new Date().toISOString().slice(0, 10),
    supplier_id: pf?.vendor_id ?? "",
    supplier_contact: pf?.supplier_contact ?? "",
    supplier_gstin: pf?.supplier_gstin ?? "",
    valid_until: (pf?.valid_until ?? "")?.slice(0, 10) ?? "",
    currency: pf?.currency ?? "USD",
    payment_terms: pf?.payment_terms ?? "",
    expected_delivery_date: (pf?.expected_delivery_date ?? "")?.slice(0, 10) ?? "",
    notes: pf?.notes ?? "",
    po_number: pf?.po_number ?? "",
    amount: pf?.amount != null && pf.amount > 0 ? String(pf.amount) : "",
    freight: pf?.freight != null ? String(pf.freight) : "",
  });
  const [lines, setLines] = useState<LineDraft[]>(
    (pf?.lines ?? []).map((l) => ({
      product_id: l.product_id,
      sku: l.sku,
      name: l.name,
      unit: l.unit,
      quantity: String(l.quantity),
      unit_price: String(l.unit_price),
      gst_rate: l.gst_rate != null ? String(l.gst_rate) : "",
    })),
  );
  const [docs, setDocs] = useState<DocMeta[]>(pf?.documents ?? []);

  const setLine = (i: number, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const pickProduct = (i: number, id: string) => {
    const p = products.find((x) => x.id === id);
    setLine(i, {
      product_id: id,
      name: p?.name ?? "",
      sku: p?.sku ?? null,
      unit: p?.unit_of_measure ?? "piece",
      unit_price: p?.unit_cost != null ? String(p.unit_cost) : "",
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
        gst_rate: "",
      },
    ]);

  const totals = useMemo(() => {
    const subtotal = round2(
      lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0),
    );
    const gstTotal = round2(
      lines.reduce(
        (s, l) =>
          s +
          ((Number(l.quantity) || 0) * (Number(l.unit_price) || 0) * (Number(l.gst_rate) || 0)) /
            100,
        0,
      ),
    );
    const freight = Number(f.freight) || 0;
    return { subtotal, gstTotal, freight, grandTotal: round2(subtotal + gstTotal + freight) };
  }, [lines, f.freight]);

  const save = useMutation({
    mutationFn: async () => {
      if (!f.proforma_number.trim()) throw new Error("Proforma invoice number is required");
      if (!f.supplier_id) throw new Error("Pick a supplier");
      const payloadLines = lines.map((l) => ({
        product_id: l.product_id,
        sku: l.sku,
        name: l.name,
        unit: l.unit || "piece",
        quantity: Number(l.quantity) || 0,
        unit_price: Number(l.unit_price) || 0,
        gst_rate: l.gst_rate ? Number(l.gst_rate) : null,
      }));
      for (const l of payloadLines) {
        if (!l.product_id) throw new Error("Every line must select a product from the catalogue");
        if (!(l.quantity > 0)) throw new Error("Quantity must be greater than zero");
        if (l.unit_price < 0) throw new Error("Unit price must be greater than or equal to zero");
      }
      const payload = {
        proformaNumber: f.proforma_number.trim(),
        proformaDate: f.proforma_date,
        vendorId: f.supplier_id,
        supplierContact: f.supplier_contact.trim() || null,
        supplierGstin: f.supplier_gstin.trim() || null,
        validUntil: f.valid_until || null,
        currency: f.currency,
        paymentTerms: f.payment_terms || null,
        expectedDeliveryDate: f.expected_delivery_date || null,
        notes: f.notes.trim() || null,
        poNumber: (() => {
          const manual = f.po_number.trim();
          if (manual) return manual;
          const stripped = f.proforma_number.trim().replace(/^PF-+/i, "");
          return stripped ? `PF-${stripped}` : undefined;
        })(),
        amount: Number(f.amount) || 0,
        poAmount: null,
        issueDate: f.proforma_date,
        freight: Number(f.freight) || 0,
        documents: docs,
        lines: payloadLines,
      };
      if (isEdit && pf) {
        await api.purchaseOrders.update(pf.id, payload);
      } else {
        await api.purchaseOrders.create({
          ...payload,
          clientId: userId,
          side: "purchase",
          status: "received",
          proformaStatus: "pending_review",
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["proformas"] });
      toast.success(isEdit ? "Proforma updated" : "Proforma recorded — submitted for review");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Modal title={`${isEdit ? "Edit" : "New"} purchase proforma`} onClose={onClose} wide>
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
            Supplier proforma
          </legend>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <L label="Proforma invoice number *">
              <input
                required
                className="inp"
                value={f.proforma_number}
                onChange={(e) => setF({ ...f, proforma_number: e.target.value })}
                placeholder="PF-2026-001"
              />
            </L>
            <L label="Proforma invoice date">
              <input
                type="date"
                className="inp"
                value={f.proforma_date}
                onChange={(e) => setF({ ...f, proforma_date: e.target.value })}
              />
            </L>
            <L label="Supplier *">
              <SearchableSelect
                value={f.supplier_id}
                onChange={(v) => {
                  const s = suppliers.find((x) => x.id === v);
                  setF({
                    ...f,
                    supplier_id: v,
                    supplier_contact: s?.contact ?? f.supplier_contact,
                  });
                }}
                placeholder="Select supplier…"
                options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
              />
            </L>
            <L label="Supplier contact">
              <input
                className="inp"
                value={f.supplier_contact}
                onChange={(e) => setF({ ...f, supplier_contact: e.target.value })}
                placeholder="Name · email · phone"
              />
            </L>
            <L label="Supplier GSTIN (optional)">
              <input
                className="inp"
                value={f.supplier_gstin}
                onChange={(e) => setF({ ...f, supplier_gstin: e.target.value })}
                placeholder="e.g. 27ABCDE1234F1Z5"
              />
            </L>
            <L label="Valid until">
              <input
                type="date"
                className="inp"
                value={f.valid_until}
                onChange={(e) => setF({ ...f, valid_until: e.target.value })}
              />
            </L>
            <L label="Currency">
              <select
                className="inp"
                value={f.currency}
                onChange={(e) => setF({ ...f, currency: e.target.value })}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </L>
            <L label="Payment terms">
              <input
                list="pf-payment-terms"
                className="inp"
                value={f.payment_terms}
                onChange={(e) => setF({ ...f, payment_terms: e.target.value })}
                placeholder="Net 30"
              />
              <datalist id="pf-payment-terms">
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
                placeholder="Quotation remarks, delivery instructions…"
              />
            </L>
          </div>
          <div className="mt-3">
            <DocumentUploader
              userId={userId}
              scope="proformas"
              docs={docs}
              onChange={setDocs}
              hint="Attach the supplier proforma / quotation (PDF or image)."
            />
          </div>
        </fieldset>

        {/* Lines */}
        <fieldset className="rounded-lg border border-border/60 p-4">
          <legend className="px-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Product lines
          </legend>
          {products.length === 0 ? (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
              No active products in the catalogue yet — add products in the Product catalogue tab
              first.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="hidden grid-cols-12 gap-2 text-[9px] uppercase tracking-widest text-muted-foreground md:grid">
                <div className="col-span-4">SKU / Product</div>
                <div className="col-span-1">Unit</div>
                <div className="col-span-2">Qty</div>
                <div className="col-span-2">Unit price</div>
                <div className="col-span-1">GST %</div>
                <div className="col-span-1 text-right">Line total</div>
                <div className="col-span-1"></div>
              </div>
              {lines.map((l, i) => {
                const lineTotal = round2((Number(l.quantity) || 0) * (Number(l.unit_price) || 0));
                return (
                  <div
                    key={i}
                    className="grid grid-cols-2 items-end gap-2 rounded-md border border-border/50 p-2 md:grid-cols-12"
                  >
                    <div className="col-span-2 md:col-span-4">
                      <L label="Product">
                        <SearchableSelect
                          value={l.product_id}
                          onChange={(v) => pickProduct(i, v)}
                          placeholder="Select product…"
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
                      <L label="Unit">
                        <input
                          className="inp"
                          value={l.unit}
                          onChange={(e) => setLine(i, { unit: e.target.value })}
                        />
                      </L>
                    </div>
                    <div className="md:col-span-2">
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
          )}
        </fieldset>

        {/* Totals */}
        <div className="ml-auto max-w-xs space-y-1 rounded-lg border border-border/60 bg-muted/20 p-4 text-sm">
          <Row label="Subtotal" value={fmtMoney(totals.subtotal)} />
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
            />
          </div>
          <div className="flex items-center justify-between border-t border-border pt-1.5 font-medium">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              Grand total
            </span>
            <span className="num text-base">{fmtMoney(totals.grandTotal)}</span>
          </div>
        </div>

        {/* Advance & funding (checker/treasury flow) */}
        <fieldset className="rounded-lg border border-border/60 p-4">
          <legend className="px-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Advance & funding
          </legend>
          <div className="grid grid-cols-2 gap-3">
            <L label={`Advance payment requested (${f.currency})`}>
              <input
                type="number"
                step="0.01"
                min="0"
                className="inp"
                value={f.amount}
                onChange={(e) => setF({ ...f, amount: e.target.value })}
                placeholder="Optional"
              />
            </L>
            <L label="PO number (funding reference)">
              <input
                className="inp"
                value={f.po_number}
                onChange={(e) => setF({ ...f, po_number: e.target.value })}
                placeholder="Optional — used to match advances"
              />
            </L>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            If an advance is requested it is submitted for checker review, then paid by treasury —
            the recorded advance is later applied to the invoice using this PO number. Convert the
            proforma to a Purchase order from the list once the quotation is accepted.
          </p>
        </fieldset>

        <Actions
          onClose={onClose}
          pending={save.isPending}
          label={isEdit ? "Save changes" : "Record proforma"}
        />
      </form>
      <datalist id="pf-gst-rates">
        <option value="0" />
        <option value="5" />
        <option value="12" />
        <option value="18" />
        <option value="28" />
      </datalist>
    </Modal>
  );
}

// ─── Convert to PO modal ──────────────────────────────────────────────────
function ConvertModal({
  pf,
  goodsPos,
  loading,
  onClose,
  onConverted,
}: {
  pf: PF;
  goodsPos: GoodsPOForConvert[];
  loading: boolean;
  onClose: () => void;
  onConverted: () => void;
}) {
  const convert = useMutation({
    mutationFn: async (linkedId: string | null) => {
      await api.purchaseOrders.update(pf.id, {
        status: "converted_to_po",
        linked_goods_po_id: linkedId,
      });
    },
    onSuccess: () => {
      toast.success("Proforma converted to PO");
      onConverted();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Modal
      title={`Convert ${pf.proforma_number ?? "proforma"} to a Purchase order`}
      onClose={onClose}
    >
      <div className="space-y-3 p-5 text-sm">
        <p className="text-xs text-muted-foreground">
          Link this proforma to an existing Purchase order, or convert without a link (you'll create
          the PO later).
        </p>
        {loading ? (
          <div className="py-4 text-center text-xs text-muted-foreground">
            Loading purchase orders…
          </div>
        ) : (
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {goodsPos.length === 0 && (
              <div className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                No purchase orders yet — convert without a link, then create one in the Purchase
                orders tab.
              </div>
            )}
            {goodsPos.map((po) => {
              const mismatch =
                !!pf.vendor?.name?.trim() &&
                !!po.supplier_name?.trim() &&
                pf.vendor.name.trim().toLowerCase() !== po.supplier_name.trim().toLowerCase();
              return (
                <button
                  key={po.id}
                  onClick={() => convert.mutate(po.id)}
                  disabled={convert.isPending}
                  className="flex w-full items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-left hover:border-primary hover:bg-primary/5 disabled:opacity-50"
                >
                  <div>
                    <div className="font-mono text-xs font-medium">{po.po_number}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {po.supplier_name ?? "—"}
                    </div>
                    {mismatch && (
                      <div className="mt-0.5 text-[9px] text-warning">
                        Different supplier — this PO is from {po.supplier_name}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="num text-xs">{fmtMoney(po.grand_total)}</div>
                    <div className="text-[9px] uppercase tracking-widest text-muted-foreground">
                      {po.status?.replace("_", " ")}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">
            Cancel
          </button>
          <button
            onClick={() => convert.mutate(null)}
            disabled={convert.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {convert.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Link2 className="h-4 w-4" />
            )}
            Convert without link
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Review / Fund (checker & treasury — unchanged) ──────────────────────
function ReviewModal({ pf, userId, onClose }: { pf: PF; userId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [comments, setComments] = useState("");
  const decide = useMutation({
    mutationFn: async (decision: "approved" | "rejected") => {
      if (decision === "rejected" && !comments.trim())
        throw new Error("Comments required to reject");
      await api.purchaseOrders.update(pf.id, {
        proforma_status: decision,
        proforma_reviewed_by: userId,
        proforma_reviewed_at: new Date().toISOString(),
        proforma_review_comments: comments.trim() || null,
      });
    },
    onSuccess: (_d, decision) => {
      qc.invalidateQueries({ queryKey: ["proformas"] });
      toast.success(decision === "approved" ? "Approved — sent to treasury" : "Rejected");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Modal title={`Review · ${pf.proforma_number ?? pf.po_number}`} onClose={onClose}>
      <div className="space-y-3 p-5 text-sm">
        <Summary pf={pf} />
        <L label="Comments (required to reject)">
          <textarea
            rows={3}
            className="inp"
            value={comments}
            onChange={(e) => setComments(e.target.value)}
          />
        </L>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">
            Cancel
          </button>
          <button
            disabled={decide.isPending}
            onClick={() => decide.mutate("rejected")}
            className="rounded-md border border-destructive/50 px-4 py-2 text-sm text-destructive hover:bg-destructive/10"
          >
            Reject
          </button>
          <button
            disabled={decide.isPending}
            onClick={() => decide.mutate("approved")}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {decide.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Approve
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Advance amount for a proforma that carries an advance % (purchase side):
 * proforma total × advance %. Returns null when no % is set.
 */
function proformaAdvanceAmount(
  pf: Pick<PF, "advance_pct" | "po_amount" | "amount">,
): number | null {
  if (pf.advance_pct == null || pf.advance_pct <= 0) return null;
  return Math.round((((pf.po_amount ?? pf.amount ?? 0) * pf.advance_pct) / 100) * 100) / 100;
}

/**
 * The advance to display / pre-fill for any proforma: PO-created purchase
 * proformas carry advance_pct (× po_amount); manually entered proformas use
 * `amount` as the advance requested. Never null.
 */
function proformaAdvanceForDisplay(pf: Pick<PF, "advance_pct" | "po_amount" | "amount">): number {
  return proformaAdvanceAmount(pf) ?? (pf.po_amount == null ? pf.amount : 0);
}

function FundModal({ pf, userId, onClose }: { pf: PF; userId: string; onClose: () => void }) {
  const qc = useQueryClient();
  // When the proforma carries an advance % (e.g. created from a purchase
  // order), pre-fill the funding amount with the calculated advance.
  const suggestedAdvance = proformaAdvanceAmount(pf);
  const [form, setForm] = useState({
    amount: String(proformaAdvanceForDisplay(pf) || ""),
    reference: "",
    advance_date: new Date().toISOString().slice(0, 10),
  });
  const fund = useMutation({
    mutationFn: async () => {
      const amt = Number(form.amount);
      if (!amt || amt <= 0) throw new Error("Amount must be > 0");
      await api.purchaseOrders.update(pf.id, {
        proforma_status: "funded",
        proforma_funded_by: userId,
        proforma_funded_at: new Date().toISOString(),
        proforma_funded_amount: amt,
        proforma_funding_reference: form.reference || null,
      });
      await api.advances.create({
        clientId: pf.client_id,
        side: pf.side,
        purchaseOrderId: pf.id,
        amount: amt,
        advanceDate: form.advance_date,
        reference: form.reference || `${pf.proforma_number ?? pf.po_number}`,
        status: "open",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["proformas"] });
      qc.invalidateQueries({ queryKey: ["advances"] });
      toast.success(
        pf.side === "sales" ? "Advance received & recorded" : "Advance paid & recorded",
      );
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Modal
      title={`${pf.side === "sales" ? "Mark advance received" : "Mark advance paid"} · ${pf.proforma_number ?? pf.po_number}`}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          fund.mutate();
        }}
        className="space-y-4 p-5"
      >
        <Summary pf={pf} />
        <L label={`Amount (${pf.currency}) *`}>
          <input
            required
            type="number"
            step="0.01"
            min="0"
            className="inp"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
          />
        </L>
        {suggestedAdvance != null && (
          <p className="text-[10px] text-muted-foreground">
            Advance {pf.advance_pct}% of {fmtMoney(pf.po_amount ?? pf.amount ?? 0)} — amount
            pre-filled from the proforma.
          </p>
        )}
        <L label="Date *">
          <input
            required
            type="date"
            className="inp"
            value={form.advance_date}
            onChange={(e) => setForm({ ...form, advance_date: e.target.value })}
          />
        </L>
        <L label="Reference">
          <input
            className="inp"
            value={form.reference}
            onChange={(e) => setForm({ ...form, reference: e.target.value })}
            placeholder="Wire ref / transaction id"
          />
        </L>
        <Actions onClose={onClose} pending={fund.isPending} label="Confirm" />
      </form>
    </Modal>
  );
}

// ─── Detail modal ─────────────────────────────────────────────────────────
function ProformaDetailModal({ pf, onClose }: { pf: PF; onClose: () => void }) {
  const cp = pf.side === "sales" ? pf.debtor?.name : pf.vendor?.name;
  const docLabel = PF_DOC_LABELS[pf.status] ? PF_DOC_LABELS[pf.status] : pf.status;
  return (
    <Modal title={`Proforma · ${pf.proforma_number ?? pf.po_number}`} onClose={onClose} wide>
      <div className="space-y-4 p-5 text-sm">
        <Summary pf={pf} />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <D label="Counterparty" value={cp ?? "—"} />
          <D label="Currency" value={pf.currency} />
          <D label="Side" value={pf.side} />
          <D label="Proforma date" value={pf.proforma_date ? fmtDate(pf.proforma_date) : "—"} />
          <D label="Document status" value={docLabel} />
          {pf.payment_terms && <D label="Payment terms" value={pf.payment_terms} />}
          {pf.side === "purchase" && pf.supplier_gstin && (
            <D label="GSTIN" value={pf.supplier_gstin} />
          )}
          {pf.side === "sales" && pf.debtor_gstin && (
            <D label="Debtor GSTIN" value={pf.debtor_gstin} />
          )}
          {pf.side === "sales" && pf.debtor_contact && (
            <D label="Debtor contact" value={pf.debtor_contact} />
          )}
          {pf.valid_until && <D label="Valid until" value={fmtDate(pf.valid_until)} />}
          {pf.expected_delivery_date && (
            <D label="Expected delivery" value={fmtDate(pf.expected_delivery_date)} />
          )}
          {pf.side === "purchase" && pf.linked_goods_po_id && (
            <D label="Linked purchase order" value={pf.linked_goods_po_id} />
          )}
          {pf.side === "sales" && pf.linked_goods_so_id && (
            <D label="Linked sales order" value={pf.linked_goods_so_id} />
          )}
          {pf.proforma_status && pf.proforma_status !== "none" && (
            <D label="Funding stage" value={pf.proforma_status} />
          )}
          {pf.advance_pct != null && pf.advance_pct > 0 ? (
            <D
              label="Advance"
              value={`${pf.advance_pct}% — ${fmtMoney(proformaAdvanceForDisplay(pf))}`}
            />
          ) : proformaAdvanceForDisplay(pf) > 0 ? (
            <D label="Advance" value={fmtMoney(proformaAdvanceForDisplay(pf))} />
          ) : null}
          <div className="col-span-2">
            <D label="Notes" value={pf.notes ?? "—"} />
          </div>
        </div>

        {(pf.lines ?? []).length > 0 && (
          <div className="overflow-x-auto rounded-md border border-border/60">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-normal">Product</th>
                  <th className="px-3 py-2 text-right font-normal">Qty</th>
                  <th className="px-3 py-2 text-right font-normal">Unit price</th>
                  <th className="px-3 py-2 text-right font-normal">GST %</th>
                  <th className="px-3 py-2 text-right font-normal">Line total</th>
                </tr>
              </thead>
              <tbody>
                {(pf.lines ?? []).map((l) => (
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
                      {l.gst_rate != null ? `${l.gst_rate}%` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right num">{fmtMoney(l.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="ml-auto max-w-[220px] space-y-0.5 p-3 text-xs">
              <Row label="Subtotal" value={fmtMoney(pf.subtotal ?? 0)} />
              <Row label="GST total" value={fmtMoney(pf.gst_total ?? 0)} />
              <Row label="Freight" value={fmtMoney(pf.freight ?? 0)} />
              <div className="flex justify-between border-t border-border pt-1 font-medium">
                <span className="text-xs uppercase tracking-widest text-muted-foreground">
                  Grand total
                </span>
                <span className="num">{fmtMoney(pf.grand_total ?? 0)}</span>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end border-t border-border pt-3">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Small shared bits ────────────────────────────────────────────────────
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}

function D({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5 capitalize">{value}</div>
    </div>
  );
}

function Summary({ pf }: { pf: PF }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs space-y-1">
      <div className="flex justify-between">
        <span className="text-muted-foreground">PO #</span>
        <span className="font-mono">{pf.po_number}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Proforma #</span>
        <span className="font-mono">{pf.proforma_number ?? "—"}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Side</span>
        <span>{pf.side}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Amount</span>
        <span className="num">{fmtMoney(pf.amount)}</span>
      </div>
      {pf.po_amount != null && pf.po_amount > 0 && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">PO amount</span>
          <span className="num">{fmtMoney(pf.po_amount)}</span>
        </div>
      )}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`max-h-[92vh] w-full overflow-y-auto rounded-xl border border-border bg-card ${wide ? "max-w-3xl" : "max-w-md"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-base">{title}</h3>
          <button onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

function Actions({
  onClose,
  pending,
  label,
}: {
  onClose: () => void;
  pending: boolean;
  label: string;
}) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button
        type="button"
        onClick={onClose}
        className="rounded-md border border-border px-4 py-2 text-sm"
      >
        Cancel
      </button>
      <button
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />} {label}
      </button>
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
