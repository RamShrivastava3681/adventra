import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import { ClipboardCheck, Check, X, Lock, FileMinus, FilePlus } from "lucide-react";
import { TableSkeleton } from "@/components/skeletons";
import { toast } from "sonner";

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
  client?: string;
  client_id?: string | null;
  noa_status?: string;
  noa_comments?: string | null;
};

function CheckerPage() {
  const { isAdmin, isChecker, user } = useAuth();
  const canReview = isAdmin || isChecker;
  const qc = useQueryClient();
  const [side, setSide] = useState<"all" | "sale" | "purchase">("all");

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
    mutationFn: async ({ id, decision }: { id: string; decision: "approved" | "rejected" }) => {
      await api.invoices.update(id, { status: decision });
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
        party: i.debtor?.name ?? "—",
        client: i.client?.company_name,
        client_id: i.client_id,
        noa_status: i.noa_status,
        noa_comments: i.noa_comments,
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
        party: p.supplier_name ?? p.vendor?.name ?? "—",
        client: "—",
        client_id: p.client_id,
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
        description={
          canReview
            ? "Newly submitted invoices and credit/debit notes wait here for your approval. Approving releases invoices into the funding queue and routes notes to Treasury for application."
            : "View-only. Only the checker (or admin) can approve invoices and notes."
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
            <TableSkeleton rows={4} cols={11} />
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
                    {isAdmin && <th className="px-5 py-2 text-left font-normal">Client</th>}
                    <th className="px-5 py-2 text-left font-normal">Party</th>
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
                      <td className="px-5 py-3 font-mono text-xs">{r.invoice_number}</td>
                      {isAdmin && (
                        <td className="px-5 py-3 text-muted-foreground">{r.client ?? "—"}</td>
                      )}
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
                                    ? reviewSale.mutate({ id: r.id, decision: "approved" })
                                    : reviewPurchase.mutate({ id: r.id, decision: "approved" })
                                }
                                className="inline-flex items-center gap-1 rounded-md border border-success/50 px-2.5 py-1 text-xs text-success hover:bg-success/10"
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
                        <td className="px-5 py-3 font-mono text-xs">{p.proforma_number ?? "—"}</td>
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

        <Card title="Credit / debit notes awaiting approval">
          {notesQ.isLoading ? (
            <TableSkeleton rows={3} cols={8} />
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
                    {isAdmin && <th className="px-5 py-2 text-left font-normal">Client</th>}
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
                            className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-widest ${n.kind === "credit" ? "border-rose-500/30 text-rose-400" : "border-emerald-500/30 text-emerald-400"}`}
                          >
                            <Icon className="h-3 w-3" />
                            {n.kind}
                          </span>
                        </td>
                        <td className="px-5 py-3 font-mono text-xs">{n.note_number}</td>
                        {isAdmin && (
                          <td className="px-5 py-3 text-muted-foreground">
                            {n.client?.company_name ?? "—"}
                          </td>
                        )}
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
