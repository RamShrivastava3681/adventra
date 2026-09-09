import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import { ClipboardCheck, Check, X, Lock, FileMinus, FilePlus, Eye } from "lucide-react";
import { TableSkeleton } from "@/components/skeletons";
import { toast } from "sonner";
import {
  InvoiceDetailModal,
  ProformaDetailModal,
  PurchaseOrderDetailModal,
  SalesOrderDetailModal,
} from "@/components/document-view";

export const Route = createFileRoute("/app/checker")({
  component: CheckerPage,
});

type Row = {
  kind: "sale" | "purchase";
  id: string;
  invoice_number: string;
  amount: number;
  po_number?: string | null;
  advance: number;
  net: number;
  issue_date: string | null;
  due_date: string | null;
  party: string;
  client_id?: string | null;
  noa_status?: string;
  noa_comments?: string | null;
  /** Raw document from the list endpoint — powers the read-only View modal. */
  raw: any;
};

function CheckerPage() {
  const { isAdmin, isChecker, user } = useAuth();
  const canReview = isAdmin || isChecker;
  const qc = useQueryClient();
  const [side, setSide] = useState<"all" | "sale" | "purchase">("all");
  const [viewInv, setViewInv] = useState<{ kind: "sale" | "purchase"; raw: any } | null>(null);
  const [approveFor, setApproveFor] = useState<{ row: Row; utr: string; amount: string } | null>(null);
  const [viewPf, setViewPf] = useState<any | null>(null);
  const [viewPo, setViewPo] = useState<any | null>(null);
  const [viewSo, setViewSo] = useState<any | null>(null);

  const salesQ = useQuery({
    queryKey: ["checker-sales"],
    queryFn: async () => {
      const data = await api.invoices.list();
      return data.filter((i: any) => i.status === "pending");
    },
  });

  const purchasesQ = useQuery({
    queryKey: ["checker-purchases"],
    queryFn: async () => {
      const data = await api.purchaseInvoices.list();
      // New lifecycle: creator marks the invoice Verified; the checker approves
      // it for payment. Legacy "pending" invoices still surface here too.
      return data.filter((p: any) => ["verified", "pending"].includes(p.status));
    },
  });

  const reviewSale = useMutation({
    mutationFn: async ({
      id,
      decision,
      utr_reference,
      payment_amount,
    }: {
      id: string;
      decision: "approved" | "rejected";
      utr_reference?: string;
      payment_amount?: number;
    }) => {
      await api.invoices.update(id, {
        status: decision,
        utr_reference: utr_reference || null,
        payment_amount: payment_amount || null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["checker-sales"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["queue-sales"] });
      toast.success("Decision recorded");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const reviewPurchase = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: "approved" | "disputed" }) => {
      // Approve → Approved for Payment (enters the AP queue). Dispute → back
      // to draft so the creator can fix it.
      await api.purchaseInvoices.update(id, {
        status: decision === "approved" ? "approved_for_payment" : "draft",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["checker-purchases"] });
      qc.invalidateQueries({ queryKey: ["purchase_invoices"] });
      qc.invalidateQueries({ queryKey: ["queue-purchases"] });
      toast.success("Decision recorded");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // Proforma advances awaiting checker approval
  const proformasQ = useQuery({
    queryKey: ["checker-proformas"],
    queryFn: async () => {
      const data = await api.purchaseOrders.list();
      // Never surface closed proformas for review (expired/cancelled/converted keep
      // the old proforma_status, but the document lifecycle has ended).
      return data.filter(
        (p: any) =>
          !["cancelled", "expired", "converted_to_po"].includes(p.status) &&
          (p.proforma_status === "pending_review" ||
            (p.status === "proforma" && p.proforma_status === "draft")),
      );
    },
  });

  const reviewProforma = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: "approved" | "rejected" }) => {
      await api.purchaseOrders.update(id, {
        proforma_status: decision,
        proforma_reviewed_by: user!.id,
        proforma_reviewed_at: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["checker-proformas"] });
      qc.invalidateQueries({ queryKey: ["proformas"] });
      qc.invalidateQueries({ queryKey: ["queue-proformas"] });
      toast.success("Proforma decision recorded");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // Resolve counterparty names for proformas (debtor for sales, supplier/vendor for purchase)
  const partiesQ = useQuery({
    queryKey: ["checker-parties"],
    queryFn: async () => {
      const [debtors, suppliers, vendors] = await Promise.all([
        api.debtors.list(),
        api.suppliers.list(),
        api.vendors.list(),
      ]);
      const map: Record<string, string> = {};
      for (const d of debtors) map[d.id] = d.name;
      for (const s of suppliers) map[s.id] = s.company_name ?? s.companyName ?? s.name;
      for (const v of vendors) map[v.id] = v.name;
      return map;
    },
  });
  const partyMap = partiesQ.data ?? {};
  const pfParty = (p: any) =>
    (p.side === "sales" ? partyMap[p.debtor_id] : partyMap[p.vendor_id]) ?? "—";

  const notesQ = useQuery({
    queryKey: ["checker-notes"],
    queryFn: async () => {
      const data = await api.creditDebitNotes.list();
      return data.filter((n: any) => n.status === "pending" || n.status === "issued");
    },
  });

  const reviewNote = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: "approved" | "rejected" }) => {
      await api.creditDebitNotes.update(id, { status: decision });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["checker-notes"] });
      qc.invalidateQueries({ queryKey: ["credit-debit-notes"] });
      qc.invalidateQueries({ queryKey: ["queue-notes"] });
      toast.success("Note decision recorded");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // Goods purchase orders awaiting the checker's approval.
  const posQ = useQuery({
    queryKey: ["checker-pos"],
    queryFn: async () => {
      const data = await api.goodsPurchaseOrders.list();
      return data.filter((p: any) => p.status === "pending_review");
    },
  });

  const reviewPO = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: "approved" | "draft" }) => {
      // Approve → Approved (can then be sent to the supplier). Reject → back
      // to draft so the maker can fix and resubmit.
      await api.goodsPurchaseOrders.update(id, {
        status: decision,
        reviewed_by: user!.id,
        reviewed_at: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["checker-pos"] });
      qc.invalidateQueries({ queryKey: ["goods-pos"] });
      qc.invalidateQueries({ queryKey: ["goods-pos-for-pi"] });
      qc.invalidateQueries({ queryKey: ["goods-pos-for-convert"] });
      toast.success("Purchase order decision recorded");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // ── Past review history for the current checker ──
  const historyQ = useQuery({
    queryKey: ["checker-history", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const [sales, purchases, proformas, pos, sos, notes] = await Promise.all([
        api.invoices.list(),
        api.purchaseInvoices.list(),
        api.purchaseOrders.list(),
        api.goodsPurchaseOrders.list(),
        api.goodsSalesOrders.list(),
        api.creditDebitNotes.list(),
      ]);
      const uid = user!.id;
      const rows: Array<{
        kind: string;
        doc_number: string;
        party: string;
        action: string;
        detail: string | null;
        reviewed_at: string;
        side: "sale" | "purchase" | "proforma" | "po" | "so" | "note";
      }> = [];
      for (const i of sales) {
        const s = i as any;
        if (s.reviewed_by === uid && s.reviewed_at) {
          rows.push({
            kind: "Invoice",
            doc_number: s.invoice_number,
            party: partyMap[s.debtor_id] ?? "—",
            action: s.status === "approved" ? "Approved" : "Rejected",
            detail: (s.utr_reference || s.payment_amount) ? `UTR: ${s.utr_reference || "—"}${s.payment_amount != null ? ` · ${fmtMoney(s.payment_amount)}` : ""}` : null,
            reviewed_at: s.reviewed_at,
            side: "sale",
          });
        }
      }
      for (const p of purchases) {
        if ((p as any).reviewed_by === uid && (p as any).reviewed_at) {
          rows.push({
            kind: "Purchase Invoice",
            doc_number: p.invoice_number,
            party: p.supplier_name ?? "—",
            action: (p as any).status === "approved_for_payment" ? "Approved" : "Disputed",
            detail: null,
            reviewed_at: (p as any).reviewed_at,
            side: "purchase",
          });
        }
      }
      for (const pf of proformas) {
        if ((pf as any).proforma_reviewed_by === uid && (pf as any).proforma_reviewed_at) {
          rows.push({
            kind: "Proforma",
            doc_number: pf.proforma_number ?? "—",
            party: pfParty(pf),
            action: (pf as any).proforma_status === "approved" ? "Approved" : "Rejected",
            detail: null,
            reviewed_at: (pf as any).proforma_reviewed_at,
            side: "proforma",
          });
        }
      }
      for (const po of pos) {
        if ((po as any).reviewed_by === uid && (po as any).reviewed_at) {
          rows.push({
            kind: "Purchase Order",
            doc_number: po.po_number,
            party: po.supplier_name ?? "—",
            action: (po as any).status === "approved" ? "Approved" : "Rejected",
            detail: null,
            reviewed_at: (po as any).reviewed_at,
            side: "po",
          });
        }
      }
      for (const so of sos) {
        if ((so as any).reviewed_by === uid && (so as any).reviewed_at) {
          rows.push({
            kind: "Sales Order",
            doc_number: so.so_number,
            party: so.customer_name ?? "—",
            action: (so as any).status === "confirmed" ? "Approved" : "Rejected",
            detail: null,
            reviewed_at: (so as any).reviewed_at,
            side: "so",
          });
        }
      }
      for (const n of notes) {
        if ((n as any).reviewed_by === uid && (n as any).reviewed_at) {
          rows.push({
            kind: n.kind === "credit" ? "Credit Note" : "Debit Note",
            doc_number: n.note_number,
            party: n.counterparty ?? "—",
            action: (n as any).status === "approved" ? "Approved" : "Rejected",
            detail: null,
            reviewed_at: (n as any).reviewed_at,
            side: n.kind === "credit" ? "sale" : "purchase",
          });
        }
      }
      rows.sort(
        (a, b) =>
          new Date(b.reviewed_at).getTime() - new Date(a.reviewed_at).getTime(),
      );
      return rows;
    },
  });

  // Goods sales orders awaiting the checker's approval.
  const sosQ = useQuery({
    queryKey: ["checker-sos"],
    queryFn: async () => {
      const data = await api.goodsSalesOrders.list();
      return data.filter((s: any) => s.status === "pending_review");
    },
  });

  const reviewSO = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: "confirmed" | "draft" }) => {
      // Approve → Confirmed (can then be dispatched). Reject → back to draft.
      await api.goodsSalesOrders.update(id, {
        status: decision,
        reviewed_by: user!.id,
        reviewed_at: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["checker-sos"] });
      qc.invalidateQueries({ queryKey: ["goods-sos"] });
      qc.invalidateQueries({ queryKey: ["pf-sales-orders"] });
      qc.invalidateQueries({ queryKey: ["invoices-by-so"] });
      toast.success("Sales order decision recorded");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // Build PO -> open advance total lookup per side (DB is source of truth)
  const saleIds = (salesQ.data ?? []).map((i: any) => i.id);
  const purIds = (purchasesQ.data ?? []).map((p: any) => p.id);
  const salePos = Array.from(
    new Set(((salesQ.data ?? []) as any[]).map((i) => (i.po_number ?? "").trim()).filter(Boolean)),
  );
  const purPos = Array.from(
    new Set(
      ((purchasesQ.data ?? []) as any[]).map((p) => (p.po_number ?? "").trim()).filter(Boolean),
    ),
  );

  const advLookupQ = useQuery({
    queryKey: ["checker-advances", salePos, purPos],
    enabled: salePos.length > 0 || purPos.length > 0,
    queryFn: async () => {
      const map: Record<string, number> = {}; // key: `${side}::${po}`
      const fetchSide = async (side: "sales" | "purchase", pos: string[]) => {
        if (!pos.length) return;
        const allOrders = await api.purchaseOrders.list();
        const poRows = allOrders.filter((o: any) => o.side === side && pos.includes(o.po_number));
        const ids = poRows.map((r: any) => r.id);
        const idToPo = new Map<string, string>(poRows.map((r: any) => [r.id, r.po_number]));
        if (!ids.length) return;
        const allAdvances = await api.advances.list();
        const advs = allAdvances.filter(
          (a: any) =>
            a.side === side &&
            ids.includes(a.purchaseOrderId ?? a.purchase_order_id) &&
            a.status !== "refunded",
        );
        for (const a of advs as any[]) {
          const po = idToPo.get(a.purchase_order_id);
          if (!po) continue;
          map[`${side}::${po}`] = (map[`${side}::${po}`] ?? 0) + Number(a.amount);
        }
      };
      await Promise.all([fetchSide("sales", salePos), fetchSide("purchase", purPos)]);
      return map;
    },
  });
  const advMap = advLookupQ.data ?? {};

  const advFor = (side: "sales" | "purchase", po?: string | null) => {
    const k = po ? `${side}::${po.trim()}` : "";
    return k ? Number(advMap[k] ?? 0) : 0;
  };

  const rows: Row[] = [
    ...((salesQ.data ?? []) as Array<Record<string, any>>).map((i): Row => {
      // Goods invoices now store the net amount (grand total − advances) and
      // the deducted advance. Fall back to the legacy PO-number lookup for
      // invoices created before those fields existed.
      const storedAdv = Number(i.advance_deducted ?? 0);
      const adv = storedAdv > 0 ? storedAdv : advFor("sales", i.po_number);
      const amt = Number(i.amount ?? i.grand_total ?? 0);
      const net = storedAdv > 0 ? amt : Math.max(0, amt - adv);
      return {
        kind: "sale",
        id: i.id,
        invoice_number: i.invoice_number,
        amount: amt,
        po_number: i.po_number,
        advance: adv,
        net,
        issue_date: i.issue_date,
        due_date: i.due_date,
        party: partyMap[i.debtor_id] ?? i.debtor?.name ?? "—",
        client_id: i.client_id,
        noa_status: i.noa_status,
        noa_comments: i.noa_comments,
        raw: i,
      };
    }),
    ...((purchasesQ.data ?? []) as Array<Record<string, any>>).map((p): Row => {
      // Purchase invoices now store the net payable (grand total − advances)
      // and the deducted advance. Fall back to the legacy PO-number lookup for
      // invoices created before those fields existed.
      const storedAdv = Number(p.advance_deducted ?? 0);
      const adv = storedAdv > 0 ? storedAdv : advFor("purchase", p.po_number);
      const amt = Number(p.amount ?? p.grand_total ?? 0);
      const net = storedAdv > 0 ? amt : Math.max(0, amt - adv);
      return {
        kind: "purchase",
        id: p.id,
        invoice_number: p.invoice_number,
        amount: amt,
        po_number: p.goods_po_number ?? p.po_number,
        advance: adv,
        net,
        issue_date: p.issue_date,
        due_date: p.due_date,
        party: p.supplier_name ?? partyMap[p.vendor_id] ?? p.vendor?.name ?? "—",
        client_id: p.client_id,
        raw: p,
      };
    }),
  ].filter((r) => side === "all" || r.kind === side);
  void saleIds;
  void purIds;

  const pendingSales = (salesQ.data ?? []).length;
  const pendingPurchases = (purchasesQ.data ?? []).length;

  return (
    <div>
      <PageHeader
        eyebrow="Checker desk"
        title="Maker–checker review"
        icon={<ClipboardCheck className="h-5 w-5" />}
        description={
          canReview
            ? "Newly submitted invoices, proformas, purchase orders and sales orders wait here for your approval. Approving releases invoices into the funding queue, routes notes to Treasury for application, and lets POs/SOs move to the next step."
            : "View-only. Only the checker (or admin) can approve documents."
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        <div className="grid gap-4 md:grid-cols-3">
          <Card title="Pending sales invoices">
            <div className="num text-3xl text-primary">{pendingSales}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Awaiting approval to enter AR queue
            </div>
          </Card>
          <Card title="Pending purchase invoices">
            <div className="num text-3xl text-warning">{pendingPurchases}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Awaiting approval to enter AP queue
            </div>
          </Card>
          <Card title="Pending proforma advances">
            <div className="num text-3xl text-primary">{(proformasQ.data ?? []).length}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Awaiting approval before funding
            </div>
          </Card>
          <Card title="Pending purchase orders">
            <div className="num text-3xl text-primary">{(posQ.data ?? []).length}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Awaiting approval before sending to supplier
            </div>
          </Card>
          <Card title="Pending sales orders">
            <div className="num text-3xl text-primary">{(sosQ.data ?? []).length}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Awaiting approval before dispatch
            </div>
          </Card>
        </div>

        <div className="flex flex-wrap gap-2">
          {(["all", "sale", "purchase"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSide(s)}
              className={`rounded-full border px-3 py-1 text-xs uppercase tracking-widest transition ${
                side === s
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {s === "all" ? "All" : s === "sale" ? "Sales (AR)" : "Purchases (AP)"}
            </button>
          ))}
        </div>

        <Card>
          {salesQ.isLoading || purchasesQ.isLoading ? (
            <TableSkeleton rows={4} cols={10} />
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              <ClipboardCheck className="mx-auto mb-3 h-8 w-8 opacity-40" />
              No invoices awaiting review.
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Type</th>
                    <th className="px-5 py-2 text-left font-normal">Invoice</th>
                    <th className="px-5 py-2 text-left font-normal">Counterparty</th>
                    <th className="px-5 py-2 text-right font-normal">Gross</th>
                    <th className="px-5 py-2 text-right font-normal">Advance</th>
                    <th className="px-5 py-2 text-right font-normal">
                      Net to{" "}
                      {side === "purchase" ? "pay" : side === "sale" ? "receive" : "transfer"}
                    </th>
                    <th className="px-5 py-2 text-left font-normal">Issued</th>
                    <th className="px-5 py-2 text-left font-normal">Due</th>
                    <th className="px-5 py-2 text-left font-normal">NOA</th>
                    <th className="px-5 py-2 text-right font-normal">Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={`${r.kind}-${r.id}`}
                      className="border-b border-border/60 hover:bg-muted/30"
                    >
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest ${
                            r.kind === "sale"
                              ? "bg-primary/15 text-primary"
                              : "bg-warning/15 text-warning"
                          }`}
                        >
                          {r.kind === "sale" ? "Sale (AR)" : "Purchase (AP)"}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-mono text-xs">{r.invoice_number}</span>
                          <button
                            onClick={() => setViewInv({ kind: r.kind, raw: r.raw })}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[10px] font-sans text-muted-foreground hover:border-primary hover:text-primary"
                            title="View invoice details"
                          >
                            <Eye className="h-3 w-3" /> View
                          </button>
                        </div>
                      </td>
                      <td className="px-5 py-3">{r.party}</td>
                      <td className="px-5 py-3 text-right num">
                        {fmtMoney(r.amount)}
                        {r.po_number && (
                          <div className="text-[10px] font-mono text-muted-foreground">
                            PO {r.po_number}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right num text-primary">
                        {r.advance > 0 ? `− ${fmtMoney(r.advance)}` : "—"}
                      </td>
                      <td
                        className={`px-5 py-3 text-right num font-medium ${r.kind === "sale" ? "text-success" : "text-warning"}`}
                      >
                        {fmtMoney(r.net)}
                      </td>
                      <td className="px-5 py-3 text-sm">{fmtDate(r.issue_date)}</td>
                      <td className="px-5 py-3 text-sm">{fmtDate(r.due_date)}</td>
                      <td className="px-5 py-3">
                        {r.kind === "sale" ? (
                          <div>
                            <NoaPill status={r.noa_status ?? "not_sent"} />
                            {r.noa_comments && (
                              <div
                                className="mt-1 max-w-[180px] truncate text-[10px] text-muted-foreground"
                                title={r.noa_comments}
                              >
                                “{r.noa_comments}”
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {r.kind === "sale" &&
                          (r.noa_status === "rejected" || r.noa_status === "not_sent") && (
                            <div className="mb-1 text-[10px] uppercase tracking-widest text-warning">
                              {r.noa_status === "not_sent" ? "NOA not sent" : "NOA rejected"}
                            </div>
                          )}
                        {canReview ? (
                          r.client_id && r.client_id === user?.id && !isAdmin ? (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground"
                              title="Segregation of duties: you cannot review an invoice you created"
                            >
                              <Lock className="h-3 w-3" /> Self-created
                            </span>
                          ) : (
                            <div className="inline-flex gap-1">
                              <button
                                onClick={() =>
                                  r.kind === "sale"
                                    ? setApproveFor({ row: r, utr: "", amount: String(r.amount) })
                                    : reviewPurchase.mutate({ id: r.id, decision: "approved" })
                                }
                                disabled={r.kind === "sale"}
                                className="inline-flex items-center gap-1 rounded-md border border-success/50 px-2.5 py-1 text-xs text-success hover:bg-success/10 disabled:opacity-60"
                                title="Enter UTR and payment amount"
                              >
                                <Check className="h-3 w-3" /> Approve
                              </button>
                              <button
                                onClick={() =>
                                  r.kind === "sale"
                                    ? reviewSale.mutate({ id: r.id, decision: "rejected" })
                                    : reviewPurchase.mutate({ id: r.id, decision: "disputed" })
                                }
                                className="inline-flex items-center gap-1 rounded-md border border-destructive/50 px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10"
                              >
                                <X className="h-3 w-3" /> {r.kind === "sale" ? "Reject" : "Dispute"}
                              </button>
                            </div>
                          )
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                            <Lock className="h-3 w-3" /> Checker only
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Proforma advances awaiting approval">
          {proformasQ.isLoading ? (
            <TableSkeleton rows={3} cols={9} />
          ) : (proformasQ.data ?? []).length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No proformas awaiting approval.
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Proforma</th>
                    <th className="px-5 py-2 text-left font-normal">PO #</th>
                    <th className="px-5 py-2 text-left font-normal">Side</th>
                    <th className="px-5 py-2 text-left font-normal">Counterparty</th>
                    <th className="px-5 py-2 text-right font-normal">Advance amount</th>
                    <th className="px-5 py-2 text-left font-normal">Issued</th>
                    <th className="px-5 py-2 text-right font-normal">Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {(proformasQ.data ?? []).map((p: any) => {
                    const selfCreated = p.client_id === user?.id && !isAdmin;
                    return (
                      <tr key={p.id} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="font-mono text-xs">{p.proforma_number ?? "—"}</span>
                            <button
                              onClick={() => setViewPf(p)}
                              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[10px] font-sans text-muted-foreground hover:border-primary hover:text-primary"
                              title="View proforma details"
                            >
                              <Eye className="h-3 w-3" /> View
                            </button>
                          </div>
                        </td>
                        <td className="px-5 py-3 font-mono text-xs">{p.po_number}</td>
                        <td className="px-5 py-3 text-[10px] uppercase tracking-widest text-muted-foreground">
                          {p.side}
                        </td>
                        <td className="px-5 py-3">{pfParty(p)}</td>
                        <td className="px-5 py-3 text-right num">{fmtMoney(p.amount)}</td>
                        <td className="px-5 py-3 text-sm">
                          {fmtDate(p.proforma_date ?? p.issue_date)}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {canReview ? (
                            selfCreated ? (
                              <span
                                className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground"
                                title="Segregation of duties: you cannot review a proforma you created"
                              >
                                <Lock className="h-3 w-3" /> Self-created
                              </span>
                            ) : (
                              <div className="inline-flex gap-1">
                                <button
                                  onClick={() =>
                                    reviewProforma.mutate({ id: p.id, decision: "approved" })
                                  }
                                  className="inline-flex items-center gap-1 rounded-md border border-success/50 px-2.5 py-1 text-xs text-success hover:bg-success/10"
                                >
                                  <Check className="h-3 w-3" /> Approve
                                </button>
                                <button
                                  onClick={() =>
                                    reviewProforma.mutate({ id: p.id, decision: "rejected" })
                                  }
                                  className="inline-flex items-center gap-1 rounded-md border border-destructive/50 px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10"
                                >
                                  <X className="h-3 w-3" /> Reject
                                </button>
                              </div>
                            )
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                              <Lock className="h-3 w-3" /> Checker only
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Purchase orders awaiting approval">
          {posQ.isLoading ? (
            <TableSkeleton rows={3} cols={6} />
          ) : (posQ.data ?? []).length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No purchase orders awaiting approval.
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">PO</th>
                    <th className="px-5 py-2 text-left font-normal">Supplier</th>
                    <th className="px-5 py-2 text-left font-normal">Delivery</th>
                    <th className="px-5 py-2 text-right font-normal">Qty</th>
                    <th className="px-5 py-2 text-right font-normal">Grand total</th>
                    <th className="px-5 py-2 text-left font-normal">Issued</th>
                    <th className="px-5 py-2 text-right font-normal">Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {(posQ.data ?? []).map((p: any) => {
                    const selfCreated = p.client_id === user?.id && !isAdmin;
                    const totalQty = (p.lines ?? []).reduce(
                      (s: number, l: any) => s + (Number(l.ordered_qty) || 0),
                      0,
                    );
                    return (
                      <tr key={p.id} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="font-mono text-xs">{p.po_number}</span>
                            <button
                              onClick={() => setViewPo(p)}
                              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[10px] font-sans text-muted-foreground hover:border-primary hover:text-primary"
                              title="View purchase order details"
                            >
                              <Eye className="h-3 w-3" /> View
                            </button>
                          </div>
                        </td>
                        <td className="px-5 py-3">{p.supplier_name ?? "—"}</td>
                        <td className="px-5 py-3 text-xs text-muted-foreground">
                          {p.warehouse || "—"}
                          {p.expected_delivery_date ? (
                            <div className="text-[10px]">
                              by {fmtDate(p.expected_delivery_date)}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-5 py-3 text-right num">{totalQty.toLocaleString()}</td>
                        <td className="px-5 py-3 text-right num font-medium">
                          {fmtMoney(p.grand_total)}
                        </td>
                        <td className="px-5 py-3 text-sm">{fmtDate(p.po_date)}</td>
                        <td className="px-5 py-3 text-right">
                          {canReview ? (
                            selfCreated ? (
                              <span
                                className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground"
                                title="Segregation of duties: you cannot review a purchase order you created"
                              >
                                <Lock className="h-3 w-3" /> Self-created
                              </span>
                            ) : (
                              <div className="inline-flex gap-1">
                                <button
                                  onClick={() =>
                                    reviewPO.mutate({ id: p.id, decision: "approved" })
                                  }
                                  className="inline-flex items-center gap-1 rounded-md border border-success/50 px-2.5 py-1 text-xs text-success hover:bg-success/10"
                                >
                                  <Check className="h-3 w-3" /> Approve
                                </button>
                                <button
                                  onClick={() => reviewPO.mutate({ id: p.id, decision: "draft" })}
                                  className="inline-flex items-center gap-1 rounded-md border border-destructive/50 px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10"
                                >
                                  <X className="h-3 w-3" /> Reject
                                </button>
                              </div>
                            )
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                              <Lock className="h-3 w-3" /> Checker only
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Sales orders awaiting approval">
          {sosQ.isLoading ? (
            <TableSkeleton rows={3} cols={6} />
          ) : (sosQ.data ?? []).length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No sales orders awaiting approval.
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">SO</th>
                    <th className="px-5 py-2 text-left font-normal">Customer</th>
                    <th className="px-5 py-2 text-left font-normal">Dispatch</th>
                    <th className="px-5 py-2 text-right font-normal">Qty</th>
                    <th className="px-5 py-2 text-right font-normal">Grand total</th>
                    <th className="px-5 py-2 text-left font-normal">Ordered</th>
                    <th className="px-5 py-2 text-right font-normal">Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {(sosQ.data ?? []).map((s: any) => {
                    const selfCreated = s.client_id === user?.id && !isAdmin;
                    const totalQty = (s.lines ?? []).reduce(
                      (sum: number, l: any) => sum + (Number(l.ordered_qty) || 0),
                      0,
                    );
                    return (
                      <tr key={s.id} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="font-mono text-xs">{s.so_number}</span>
                            <button
                              onClick={() => setViewSo(s)}
                              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[10px] font-sans text-muted-foreground hover:border-primary hover:text-primary"
                              title="View sales order details"
                            >
                              <Eye className="h-3 w-3" /> View
                            </button>
                          </div>
                        </td>
                        <td className="px-5 py-3">{s.customer_name ?? "—"}</td>
                        <td className="px-5 py-3 text-xs text-muted-foreground">
                          {s.expected_dispatch_date ? (
                            <>
                              from {fmtDate(s.expected_dispatch_date)}
                              {s.expected_delivery_date ? (
                                <div className="text-[10px]">
                                  to {fmtDate(s.expected_delivery_date)}
                                </div>
                              ) : null}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-5 py-3 text-right num">{totalQty.toLocaleString()}</td>
                        <td className="px-5 py-3 text-right num font-medium">
                          {fmtMoney(s.grand_total)}
                        </td>
                        <td className="px-5 py-3 text-sm">{fmtDate(s.order_date)}</td>
                        <td className="px-5 py-3 text-right">
                          {canReview ? (
                            selfCreated ? (
                              <span
                                className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground"
                                title="Segregation of duties: you cannot review a sales order you created"
                              >
                                <Lock className="h-3 w-3" /> Self-created
                              </span>
                            ) : (
                              <div className="inline-flex gap-1">
                                <button
                                  onClick={() =>
                                    reviewSO.mutate({ id: s.id, decision: "confirmed" })
                                  }
                                  className="inline-flex items-center gap-1 rounded-md border border-success/50 px-2.5 py-1 text-xs text-success hover:bg-success/10"
                                >
                                  <Check className="h-3 w-3" /> Approve
                                </button>
                                <button
                                  onClick={() => reviewSO.mutate({ id: s.id, decision: "draft" })}
                                  className="inline-flex items-center gap-1 rounded-md border border-destructive/50 px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10"
                                >
                                  <X className="h-3 w-3" /> Reject
                                </button>
                              </div>
                            )
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                              <Lock className="h-3 w-3" /> Checker only
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {viewInv && (
          <InvoiceDetailModal
            invoice={viewInv.raw}
            kind={viewInv.kind}
            onClose={() => setViewInv(null)}
          />
        )}
        {viewPf && <ProformaDetailModal pf={viewPf} onClose={() => setViewPf(null)} />}
        {viewPo && <PurchaseOrderDetailModal po={viewPo} onClose={() => setViewPo(null)} />}
        {viewSo && <SalesOrderDetailModal so={viewSo} onClose={() => setViewSo(null)} />}

        <Card title="Credit / debit notes awaiting approval">
          {notesQ.isLoading ? (
            <TableSkeleton rows={3} cols={7} />
          ) : (notesQ.data ?? []).length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No notes awaiting approval.
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Type</th>
                    <th className="px-5 py-2 text-left font-normal">Number</th>
                    <th className="px-5 py-2 text-left font-normal">Counterparty</th>
                    <th className="px-5 py-2 text-left font-normal">Linked invoice</th>
                    <th className="px-5 py-2 text-left font-normal">Reason</th>
                    <th className="px-5 py-2 text-right font-normal">Amount</th>
                    <th className="px-5 py-2 text-right font-normal">Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {(notesQ.data ?? []).map((n: any) => {
                    const Icon = n.kind === "credit" ? FileMinus : FilePlus;
                    const link = n.invoice?.invoice_number
                      ? `Sale · ${n.invoice.invoice_number}`
                      : n.purchase?.invoice_number
                        ? `Purchase · ${n.purchase.invoice_number}`
                        : "—";
                    const selfCreated = n.client_id === user?.id && !isAdmin;
                    return (
                      <tr key={n.id} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-3">
                          <span
                            className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-widest ${n.kind === "credit" ? "border-primary/30 text-primary" : "border-border-strong text-muted-foreground"}`}
                          >
                            <Icon className="h-3 w-3" />
                            {n.kind}
                          </span>
                        </td>
                        <td className="px-5 py-3 font-mono text-xs">{n.note_number}</td>
                        <td className="px-5 py-3 text-muted-foreground">{n.counterparty ?? "—"}</td>
                        <td className="px-5 py-3 font-mono text-xs">{link}</td>
                        <td
                          className="px-5 py-3 text-muted-foreground max-w-[220px] truncate"
                          title={n.reason ?? ""}
                        >
                          {n.reason ?? "—"}
                        </td>
                        <td className="px-5 py-3 text-right num">{fmtMoney(Number(n.amount))}</td>
                        <td className="px-5 py-3 text-right">
                          {canReview ? (
                            selfCreated ? (
                              <span
                                className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground"
                                title="Segregation of duties"
                              >
                                <Lock className="h-3 w-3" /> Self-created
                              </span>
                            ) : (
                              <div className="inline-flex gap-1">
                                <button
                                  onClick={() =>
                                    reviewNote.mutate({ id: n.id, decision: "approved" })
                                  }
                                  className="inline-flex items-center gap-1 rounded-md border border-success/50 px-2.5 py-1 text-xs text-success hover:bg-success/10"
                                >
                                  <Check className="h-3 w-3" /> Approve
                                </button>
                                <button
                                  onClick={() =>
                                    reviewNote.mutate({ id: n.id, decision: "rejected" })
                                  }
                                  className="inline-flex items-center gap-1 rounded-md border border-destructive/50 px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10"
                                >
                                  <X className="h-3 w-3" /> Reject
                                </button>
                              </div>
                            )
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                              <Lock className="h-3 w-3" /> Checker only
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {approveFor && (
          <ApproveSaleModal
            row={approveFor.row}
            onClose={() => setApproveFor(null)}
            onSubmit={(vals) => {
              reviewSale.mutate(
                {
                  id: approveFor.row.id,
                  decision: "approved",
                  utr_reference: vals.utr_reference,
                  payment_amount: vals.payment_amount,
                },
                { onSuccess: () => setApproveFor(null) },
              );
            }}
          />
        )}

        <Card title="Your review history">
          {historyQ.isLoading ? (
            <TableSkeleton rows={4} cols={6} />
          ) : historyQ.data?.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No past approvals yet.
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Document</th>
                    <th className="px-5 py-2 text-left font-normal">Type</th>
                    <th className="px-5 py-2 text-left font-normal">Counterparty</th>
                    <th className="px-5 py-2 text-left font-normal">Decision</th>
                    <th className="px-5 py-2 text-left font-normal hidden md:table-cell">Details</th>
                    <th className="px-5 py-2 text-left font-normal">Reviewed</th>
                  </tr>
                </thead>
                <tbody>
                  {(historyQ.data ?? []).map((h: any, idx: number) => (
                    <tr key={idx} className="border-b border-border/60 hover:bg-muted/30">
                      <td className="px-5 py-3 font-mono text-xs">{h.doc_number}</td>
                      <td className="px-5 py-3">
                        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                          {h.kind}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{h.party}</td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest ${
                            h.action === "Approved" || h.action === "Confirmed" || h.action === "Mark received" || h.action === "Mark paid"
                              ? "bg-success/15 text-success"
                              : "bg-destructive/15 text-destructive"
                          }`}
                        >
                          {h.action}
                        </span>
                      </td>
                      {h.detail && (
                        <td className="px-5 py-3 text-xs text-muted-foreground hidden md:table-cell">
                          {h.detail}
                        </td>
                      )}
                      <td className="px-5 py-3 text-sm text-muted-foreground">
                        {fmtDate(h.reviewed_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function ApproveSaleModal({
  row,
  onClose,
  onSubmit,
}: {
  row: Row;
  onClose: () => void;
  onSubmit: (v: { utr_reference: string; payment_amount?: number }) => void;
}) {
  const [utr, setUtr] = useState(row.raw?.utr_reference ?? "");
  const [amount, setAmount] = useState(
    String(row.raw?.payment_amount ?? row.amount),
  );
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-vault"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 font-display text-lg">
          Approve & record payment · {row.invoice_number}
        </h3>
        <div className="space-y-3 text-sm">
          <div className="rounded-md border border-border bg-background/40 p-3 text-xs text-muted-foreground space-y-1">
            <div>Counterparty: <span className="text-foreground">{row.party}</span></div>
            <div>Gross amount: <span className="num text-foreground">{fmtMoney(row.amount)}</span></div>
            <div>Due date: <span className="text-muted-foreground">{fmtDate(row.due_date)}</span></div>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">
              UTR / payment reference (optional)
            </span>
            <input
              maxLength={60}
              value={utr}
              onChange={(e) => setUtr(e.target.value)}
              className="w-full rounded-md border border-border bg-background p-2"
              placeholder="Bank transfer reference…"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">
              Payment amount (optional)
            </span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-md border border-border bg-background p-2"
              placeholder="Full or partial amount received…"
            />
          </label>
          {amount && Number(amount) > 0 && (
            <div className="text-[10px] text-muted-foreground">
              {Number(amount) >= row.amount
                ? "Full payment recorded"
                : `Partial · ${fmtMoney(row.amount - Number(amount))} still outstanding`}
            </div>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">
            Cancel
          </button>
          <button
            onClick={() =>
              onSubmit({
                utr_reference: utr.trim() || undefined,
                payment_amount: amount ? Number(amount) : undefined,
              })
            }
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            <Check className="h-3.5 w-3.5" />
            Approve & record
          </button>
        </div>
      </div>
    </div>
  );
}

function NoaPill({ status }: { status: string }) {
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
