import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
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
  Banknote,
  Lock,
  ArrowDownToLine,
  ArrowUpFromLine,
  FileMinus,
  FilePlus,
  Sparkles,
  Eye,
} from "lucide-react";
import { TableSkeleton } from "@/components/skeletons";
import { toast } from "sonner";
import { InvoiceDetailModal, ProformaDetailModal } from "@/components/document-view";

export const Route = createFileRoute("/app/queue")({
  component: QueuePage,
});

function parseYMD(s?: string | null): Date | null {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) {
    const d = new Date(s);
    return isNaN(d.getTime())
      ? null
      : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

function diffDaysUTC(from?: string | null, to?: string | null): number {
  const a = parseYMD(from);
  const b = parseYMD(to);
  if (!a || !b) return 0;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}

type Row = {
  kind: "sale" | "purchase";
  id: string;
  invoice_number: string;
  amount: number;
  po_number: string | null;
  advance: number;
  balance: number;
  amount_paid: number;
  due_date: string | null;
  issue_date: string | null;
  status: string;
  party: string;
  /** Raw document from the list endpoint — powers the read-only View modal. */
  raw: any;
};

function QueuePage() {
  const { isAdmin, isTreasury: isTreasuryRole, user } = useAuth();
  const isTreasury = isTreasuryRole || isAdmin;
  const qc = useQueryClient();
  const [side, setSide] = useState<"all" | "sale" | "purchase">("all");

  const salesQ = useQuery({
    queryKey: ["queue-sales"],
    queryFn: async () => {
      const data = await api.invoices.list();
      return data
        .filter((i: any) => ["approved", "funded", "advanced", "overdue"].includes(i.status))
        .sort((a: any, b: any) =>
          (a.dueDate ?? a.due_date ?? "9999").localeCompare(b.dueDate ?? b.due_date ?? "9999"),
        );
    },
  });

  const purchasesQ = useQuery({
    queryKey: ["queue-purchases"],
    queryFn: async () => {
      const data = await api.purchaseInvoices.list();
      return data
        .filter((p: any) =>
          [
            "approved_for_payment",
            "partially_paid",
            "approved",
            "funded",
            "advanced",
            "overdue",
          ].includes(p.status),
        )
        .sort((a: any, b: any) =>
          (a.dueDate ?? a.due_date ?? "9999").localeCompare(b.dueDate ?? b.due_date ?? "9999"),
        );
    },
  });

  // Live advance lookup by PO number — DB is source of truth
  const salePos = Array.from(
    new Set(((salesQ.data ?? []) as any[]).map((i) => (i.po_number ?? "").trim()).filter(Boolean)),
  );
  const purPos = Array.from(
    new Set(
      ((purchasesQ.data ?? []) as any[]).map((p) => (p.po_number ?? "").trim()).filter(Boolean),
    ),
  );

  const advLookupQ = useQuery({
    queryKey: ["queue-advances", salePos, purPos],
    enabled: salePos.length > 0 || purPos.length > 0,
    queryFn: async () => {
      const map: Record<string, number> = {};
      const fetchSide = async (s: "sales" | "purchase", pos: string[]) => {
        if (!pos.length) return;
        const allOrders = await api.purchaseOrders.list();
        const poRows = allOrders.filter((o: any) => o.side === s && pos.includes(o.po_number));
        const ids = poRows.map((r: any) => r.id);
        const idToPo = new Map<string, string>(poRows.map((r: any) => [r.id, r.po_number]));
        if (!ids.length) return;
        const allAdvances = await api.advances.list();
        const advs = allAdvances.filter(
          (a: any) =>
            a.side === s &&
            ids.includes(a.purchaseOrderId ?? a.purchase_order_id) &&
            a.status !== "refunded",
        );
        for (const a of advs as any[]) {
          const po = idToPo.get(a.purchase_order_id);
          if (!po) continue;
          map[`${s}::${po}`] = (map[`${s}::${po}`] ?? 0) + Number(a.amount);
        }
      };
      await Promise.all([fetchSide("sales", salePos), fetchSide("purchase", purPos)]);
      return map;
    },
  });
  const advMap = advLookupQ.data ?? {};
  const advFor = (s: "sales" | "purchase", po?: string | null) =>
    po ? Number(advMap[`${s}::${po.trim()}`] ?? 0) : 0;

  const closeSale = useMutation({
    mutationFn: async ({
      id,
      amount_received,
      receipt_date,
      amount,
      due_date,
    }: {
      id: string;
      amount_received: number;
      receipt_date: string;
      amount: number;
      due_date: string | null;
    }) => {
      const short_payment = Math.max(0, +(amount - amount_received).toFixed(2));
      const late_days = diffDaysUTC(due_date, receipt_date);
      const patch: any = {
        status: "paid",
        paid_date: receipt_date,
        amount_received,
        receipt_date,
        short_payment,
        late_days,
      };
      await api.invoices.update(id, patch);
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["queue-sales"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      const ld = diffDaysUTC(vars.due_date, vars.receipt_date);
      const sp = Math.max(0, +(vars.amount - vars.amount_received).toFixed(2));
      toast.success(
        `Invoice closed · ${ld} late day${ld === 1 ? "" : "s"}${sp > 0 ? ` · short ${fmtMoney(sp)}` : ""}`,
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const payPurchase = useMutation({
    mutationFn: async ({
      id,
      amount_paid,
      paid_date,
    }: {
      id: string;
      amount_paid: number;
      paid_date: string;
    }) => {
      // Status is derived from amountPaid vs the payable: full → paid,
      // partial → partially_paid. The purchase invoice itself never creates
      // stock — it only records the supplier payable being settled.
      await api.purchaseInvoices.update(id, { amount_paid, paid_date });
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["queue-purchases"] });
      qc.invalidateQueries({ queryKey: ["purchase_invoices"] });
      toast.success(vars.amount_paid > 0 ? "Payment recorded" : "Payment cleared");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // Approved proforma advances awaiting funding (treasury marks paid/received → records advance)
  const proformasQ = useQuery({
    queryKey: ["queue-proformas"],
    queryFn: async () => {
      const data = await api.purchaseOrders.list();
      // Never surface closed proformas for funding (cancelled/expired/converted keep
      // the old proforma_status, but the document lifecycle has ended).
      return data.filter(
        (p: any) =>
          !["cancelled", "expired", "converted_to_po"].includes(p.status) &&
          p.proforma_status === "approved",
      );
    },
  });

  const fundProforma = useMutation({
    mutationFn: async (p: any) => {
      const today = new Date().toISOString().slice(0, 10);
      await api.purchaseOrders.update(p.id, {
        proforma_status: "funded",
        proforma_funded_by: user!.id,
        proforma_funded_at: new Date().toISOString(),
        proforma_funded_amount: Number(p.amount),
      });
      await api.advances.create({
        clientId: p.client_id,
        side: p.side,
        purchaseOrderId: p.id,
        amount: Number(p.amount),
        advanceDate: today,
        reference: p.proforma_number ?? p.po_number,
        status: "open",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["queue-proformas"] });
      qc.invalidateQueries({ queryKey: ["proformas"] });
      qc.invalidateQueries({ queryKey: ["advances"] });
      toast.success("Proforma funded — advance recorded");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // Resolve counterparty names for proformas (debtor for sales, supplier/vendor for purchase)
  const partiesQ = useQuery({
    queryKey: ["queue-parties"],
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
    queryKey: ["queue-notes"],
    queryFn: async () => {
      const data = await api.creditDebitNotes.list();
      return data.filter((n: any) => n.status === "approved");
    },
  });

  const applyNote = useMutation({
    mutationFn: async (note: any) => {
      const amount = Number(note.amount);
      const signed = note.kind === "debit" ? amount : -amount; // debit increases invoice, credit decreases
      if (note.invoiceId ?? note.invoice_id ?? note.invoice?.id) {
        const invId = note.invoiceId ?? note.invoice_id ?? note.invoice?.id;
        const currAmt = Number(note.invoice?.amount ?? 0);
        const newAmount = Math.max(0, currAmt + signed);
        await api.invoices.update(invId, { amount: newAmount });
      } else if (note.purchaseInvoiceId ?? note.purchase_invoice_id ?? note.purchase?.id) {
        const invId = note.purchaseInvoiceId ?? note.purchase_invoice_id ?? note.purchase?.id;
        const currAmt = Number(note.purchase?.amount ?? 0);
        const newAmount = Math.max(0, currAmt + signed);
        await api.purchaseInvoices.update(invId, { amount: newAmount });
      } else {
        throw new Error("Note has no linked invoice — cannot apply");
      }
      const noteId = note.id;
      await api.creditDebitNotes.update(noteId, { status: "applied" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["queue-notes"] });
      qc.invalidateQueries({ queryKey: ["queue-sales"] });
      qc.invalidateQueries({ queryKey: ["queue-purchases"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["purchase_invoices"] });
      qc.invalidateQueries({ queryKey: ["credit-debit-notes"] });
      toast.success("Note applied to invoice");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const [closeFor, setCloseFor] = useState<Row | null>(null);
  const [payFor, setPayFor] = useState<Row | null>(null);
  const [viewInv, setViewInv] = useState<{ kind: "sale" | "purchase"; raw: any } | null>(null);
  const [viewPf, setViewPf] = useState<any | null>(null);

  const rows: Row[] = [
    ...((salesQ.data ?? []) as Array<Record<string, any>>).map((i): Row => {
      // Goods invoices now store the net amount (grand total − advances) and
      // the deducted advance. Fall back to the legacy PO-number lookup for
      // invoices created before those fields existed.
      const storedAdv = Number(i.advance_deducted ?? 0);
      const advance = storedAdv > 0 ? storedAdv : advFor("sales", i.po_number);
      const amount = Number(i.amount ?? i.grand_total ?? 0);
      return {
        kind: "sale",
        id: i.id,
        invoice_number: i.invoice_number,
        amount,
        po_number: i.po_number ?? null,
        advance,
        balance: storedAdv > 0 ? Math.max(0, amount) : Math.max(0, amount - advance),
        amount_paid: 0,
        due_date: i.due_date,
        issue_date: i.issue_date,
        status: i.status,
        party: partyMap[i.debtor_id] ?? i.debtor?.name ?? "—",
        raw: i,
      };
    }),
    ...((purchasesQ.data ?? []) as Array<Record<string, any>>).map((p): Row => {
      // Purchase invoices now store the net payable (grand total − advances)
      // and the deducted advance. Fall back to the legacy PO-number lookup for
      // invoices created before those fields existed.
      const storedAdv = Number(p.advance_deducted ?? 0);
      const advance = storedAdv > 0 ? storedAdv : advFor("purchase", p.po_number);
      const amount = Number(p.amount ?? p.grand_total ?? 0);
      return {
        kind: "purchase",
        id: p.id,
        invoice_number: p.invoice_number,
        amount,
        po_number: p.goods_po_number ?? p.po_number ?? null,
        advance,
        // New-style invoices carry balance_due (net payable − amount paid).
        balance:
          p.balance_due != null
            ? Math.max(0, Number(p.balance_due))
            : Math.max(0, amount - advance),
        amount_paid: Number(p.amount_paid) || 0,
        due_date: p.due_date,
        issue_date: p.issue_date,
        status: p.status,
        party: p.supplier_name ?? partyMap[p.vendor_id] ?? p.vendor?.name ?? "—",
        raw: p,
      };
    }),
  ]
    .filter((r) => side === "all" || r.kind === side)
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));

  const balanceToPay = rows.filter((r) => r.kind === "purchase").reduce((s, r) => s + r.balance, 0);
  const balanceToReceive = rows.filter((r) => r.kind === "sale").reduce((s, r) => s + r.balance, 0);
  const advancesAppliedOut = rows
    .filter((r) => r.kind === "purchase")
    .reduce((s, r) => s + r.advance, 0);
  const advancesAppliedIn = rows
    .filter((r) => r.kind === "sale")
    .reduce((s, r) => s + r.advance, 0);

  return (
    <div>
      <PageHeader
        eyebrow={isTreasury ? "Treasury desk" : isAdmin ? "Operations" : "Approved queue"}
        title="Funding queue"
        icon={<Banknote className="h-5 w-5" />}
        description={
          isTreasury
            ? "Approved invoices awaiting settlement. Advances already paid against the same PO are deducted from the amount due."
            : "Approved invoices in the funding workflow. Cash actions are restricted to the treasury team."
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card title="Supplier balance due">
            <div className="num text-3xl text-warning">{fmtMoney(balanceToPay)}</div>
            <div className="mt-1 text-xs text-muted-foreground">Net of advances against PO</div>
          </Card>
          <Card title="Advances applied (AP)">
            <div className="num text-3xl text-primary">{fmtMoney(advancesAppliedOut)}</div>
            <div className="mt-1 text-xs text-muted-foreground">Already paid to suppliers</div>
          </Card>
          <Card title="Debtor balance expected">
            <div className="num text-3xl text-primary">{fmtMoney(balanceToReceive)}</div>
            <div className="mt-1 text-xs text-muted-foreground">Net of advances against PO</div>
          </Card>
          <Card title="Advances applied (AR)">
            <div className="num text-3xl text-success">{fmtMoney(advancesAppliedIn)}</div>
            <div className="mt-1 text-xs text-muted-foreground">Already received from debtors</div>
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
            <TableSkeleton rows={5} cols={10} />
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              <Banknote className="mx-auto mb-3 h-8 w-8 opacity-40" />
              No approved invoices in the queue.
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
                    <th className="px-5 py-2 text-right font-normal">Advance applied</th>
                    <th className="px-5 py-2 text-right font-normal">Balance</th>
                    <th className="px-5 py-2 text-left font-normal">Due</th>
                    <th className="px-5 py-2 text-right font-normal">Late days</th>
                    <th className="px-5 py-2 text-left font-normal">Status</th>
                    <th className="sticky right-0 hidden bg-card px-5 py-2 text-right font-normal md:table-cell">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const dpd = r.due_date && r.status !== "paid" ? daysBetween(r.due_date) : 0;
                    const lateDays = Math.max(0, dpd);
                    const action = (
                      <QueueAction
                        row={r}
                        isTreasury={isTreasury}
                        onCloseSale={setCloseFor}
                        onPayPurchase={setPayFor}
                      />
                    );
                    return (
                      <Fragment key={`${r.kind}-${r.id}`}>
                        <tr className="border-b border-border/60 hover:bg-muted/30">
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
                            {r.po_number && (
                              <div className="text-[10px] text-muted-foreground">
                                PO {r.po_number}
                              </div>
                            )}
                          </td>
                          <td className="px-5 py-3">{r.party}</td>
                          <td className="px-5 py-3 text-right num">{fmtMoney(r.amount)}</td>
                          <td className="px-5 py-3 text-right num text-primary">
                            {r.advance > 0 ? `− ${fmtMoney(r.advance)}` : "—"}
                          </td>
                          <td
                            className={`px-5 py-3 text-right num font-medium ${r.kind === "sale" ? "text-success" : "text-warning"}`}
                          >
                            {fmtMoney(r.balance)}
                          </td>
                          <td className="px-5 py-3 text-sm">{fmtDate(r.due_date)}</td>
                          <td
                            className={`px-5 py-3 text-right num ${lateDays > 0 ? "text-destructive" : "text-muted-foreground"}`}
                          >
                            {lateDays}
                          </td>
                          <td className="px-5 py-3">
                            <StatusPill status={r.status} />
                          </td>
                          <td className="sticky right-0 hidden bg-card px-5 py-3 text-right md:table-cell">
                            {action}
                          </td>
                        </tr>
                        <tr className="border-b border-border/60 md:hidden">
                          <td colSpan={10} className="px-5 pb-4 pt-0 text-left">
                            <div className="flex justify-start">{action}</div>
                          </td>
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Approved proforma advances — ready to fund">
          {proformasQ.isLoading ? (
            <TableSkeleton rows={3} cols={8} />
          ) : (proformasQ.data ?? []).length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No approved proformas waiting to be funded.
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
                    <th className="px-5 py-2 text-right font-normal">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(proformasQ.data ?? []).map((p: any) => (
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
                        {isTreasury ? (
                          <button
                            onClick={() => fundProforma.mutate(p)}
                            disabled={fundProforma.isPending}
                            className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-warning/50 px-2.5 py-1 text-xs text-warning hover:bg-warning/10 disabled:opacity-60"
                          >
                            {p.side === "sales" ? "Mark received" : "Mark paid"}
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                            <Lock className="h-3 w-3" /> Treasury only
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

        {viewInv && (
          <InvoiceDetailModal
            invoice={viewInv.raw}
            kind={viewInv.kind}
            onClose={() => setViewInv(null)}
          />
        )}
        {viewPf && <ProformaDetailModal pf={viewPf} onClose={() => setViewPf(null)} />}

        <Card title="Approved credit / debit notes — ready to apply">
          {notesQ.isLoading ? (
            <TableSkeleton rows={3} cols={8} />
          ) : (notesQ.data ?? []).length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No approved notes waiting to be applied.
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Type</th>
                    <th className="px-5 py-2 text-left font-normal">Number</th>
                    <th className="px-5 py-2 text-left font-normal">Linked invoice</th>
                    <th className="px-5 py-2 text-left font-normal">Counterparty</th>
                    <th className="px-5 py-2 text-right font-normal">Invoice now</th>
                    <th className="px-5 py-2 text-right font-normal">Adjustment</th>
                    <th className="px-5 py-2 text-right font-normal">After apply</th>
                    <th className="px-5 py-2 text-right font-normal">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(notesQ.data ?? []).map((n: any) => {
                    const Icon = n.kind === "credit" ? FileMinus : FilePlus;
                    const inv = n.invoice ?? n.purchase;
                    const linkLabel = n.invoice
                      ? `Sale · ${n.invoice.invoice_number}`
                      : n.purchase
                        ? `Purchase · ${n.purchase.invoice_number}`
                        : "Unlinked";
                    const amt = Number(n.amount);
                    const signed = n.kind === "debit" ? amt : -amt;
                    const current = inv ? Number(inv.amount) : 0;
                    const after = Math.max(0, current + signed);
                    const canApply = isTreasury && !!inv;
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
                        <td className="px-5 py-3 font-mono text-xs">{linkLabel}</td>
                        <td className="px-5 py-3 text-muted-foreground">{n.counterparty ?? "—"}</td>
                        <td className="px-5 py-3 text-right num">
                          {inv ? fmtMoney(current) : "—"}
                        </td>
                        <td
                          className={`px-5 py-3 text-right num ${signed < 0 ? "text-primary" : "text-warning"}`}
                        >
                          {signed < 0 ? `− ${fmtMoney(amt)}` : `+ ${fmtMoney(amt)}`}
                        </td>
                        <td className="px-5 py-3 text-right num font-medium">
                          {inv ? fmtMoney(after) : "—"}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {!inv ? (
                            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                              No linked invoice
                            </span>
                          ) : canApply ? (
                            <button
                              onClick={() => applyNote.mutate(n)}
                              disabled={applyNote.isPending}
                              className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-primary/50 px-2.5 py-1 text-xs text-primary hover:bg-primary/10 disabled:opacity-60"
                            >
                              <Sparkles className="h-3 w-3" /> Apply to invoice
                            </button>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                              <Lock className="h-3 w-3" /> Treasury only
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

      {closeFor && (
        <CloseSaleModal
          row={closeFor}
          onClose={() => setCloseFor(null)}
          onSubmit={(vals) => {
            closeSale.mutate(
              { id: closeFor.id, amount: closeFor.balance, due_date: closeFor.due_date, ...vals },
              { onSuccess: () => setCloseFor(null) },
            );
          }}
        />
      )}
      {payFor && (
        <PayPurchaseModal
          row={payFor}
          onClose={() => setPayFor(null)}
          onSubmit={(vals) => {
            payPurchase.mutate({ id: payFor.id, ...vals }, { onSuccess: () => setPayFor(null) });
          }}
        />
      )}
    </div>
  );
}

function QueueAction({
  row,
  isTreasury,
  onCloseSale,
  onPayPurchase,
}: {
  row: Row;
  isTreasury: boolean;
  onCloseSale: (row: Row) => void;
  onPayPurchase: (row: Row) => void;
}) {
  if (!isTreasury) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground">
        <Lock className="h-3 w-3" /> Treasury only
      </span>
    );
  }

  if (row.kind === "sale") {
    return (
      <button
        onClick={() => onCloseSale(row)}
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-success/50 px-2.5 py-1 text-xs text-success hover:bg-success/10"
      >
        <ArrowDownToLine className="h-3 w-3" /> Record receipt
      </button>
    );
  }

  return (
    <button
      onClick={() => onPayPurchase(row)}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-warning/50 px-2.5 py-1 text-xs text-warning hover:bg-warning/10"
    >
      <ArrowUpFromLine className="h-3 w-3" /> Record payment
    </button>
  );
}

function PayPurchaseModal({
  row,
  onClose,
  onSubmit,
}: {
  row: Row;
  onClose: () => void;
  onSubmit: (v: { amount_paid: number; paid_date: string }) => void;
}) {
  const [amt, setAmt] = useState(String(row.balance));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const alreadyPaid = row.amount_paid || 0;
  // amountPaid on the invoice is cumulative — this payment adds to what's paid.
  const payNow = Number(amt) || 0;
  const totalPaid = Math.round((alreadyPaid + payNow) * 100) / 100;
  const outstanding = Math.max(0, +(row.balance - payNow).toFixed(2));
  const full = totalPaid >= row.amount - 0.005;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-vault"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 font-display text-lg">Record payment · {row.invoice_number}</h3>
        <div className="space-y-3 text-sm">
          <div className="rounded-md border border-border bg-background/40 p-3 text-xs text-muted-foreground space-y-1">
            <div>
              Supplier payable: <span className="num text-foreground">{fmtMoney(row.amount)}</span>
            </div>
            <div>
              Already paid: <span className="num text-success">{fmtMoney(alreadyPaid)}</span>
            </div>
            <div>
              Balance due: <span className="num text-warning">{fmtMoney(row.balance)}</span> · Due{" "}
              {fmtDate(row.due_date)}
            </div>
            <div className="pt-1 text-[10px]">
              Paying the full balance flips the invoice to Paid; a partial amount marks it Partially
              Paid. The purchase invoice never touches stock — it only settles the supplier payable.
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">
              Amount to pay now
            </span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amt}
              onChange={(e) => setAmt(e.target.value)}
              className="w-full rounded-md border border-border bg-background p-2"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">
              Payment date
            </span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-md border border-border bg-background p-2"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-md border border-border bg-background/40 p-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Total paid after
              </div>
              <div className="num text-lg text-success">{fmtMoney(totalPaid)}</div>
            </div>
            <div className="rounded-md border border-border bg-background/40 p-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Remaining after
              </div>
              <div className={`num text-lg ${outstanding > 0 ? "text-warning" : "text-success"}`}>
                {fmtMoney(outstanding)}
              </div>
            </div>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">
            Cancel
          </button>
          <button
            onClick={() => onSubmit({ amount_paid: totalPaid, paid_date: date })}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            <ArrowUpFromLine className="h-3.5 w-3.5" />
            {full ? "Mark paid" : "Record partial payment"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CloseSaleModal({
  row,
  onClose,
  onSubmit,
}: {
  row: Row;
  onClose: () => void;
  onSubmit: (v: { amount_received: number; receipt_date: string }) => void;
}) {
  const [amt, setAmt] = useState(String(row.balance));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const short = Math.max(0, +(row.balance - Number(amt || 0)).toFixed(2));
  const late = diffDaysUTC(row.due_date, date);
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-vault"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 font-display text-lg">Close sales invoice {row.invoice_number}</h3>
        <div className="space-y-3 text-sm">
          <div className="rounded-md border border-border bg-background/40 p-3 text-xs text-muted-foreground space-y-1">
            <div>
              Gross: <span className="num text-foreground">{fmtMoney(row.amount)}</span>
            </div>
            {row.advance > 0 && (
              <div>
                Advance received:{" "}
                <span className="num text-primary">− {fmtMoney(row.advance)}</span>
              </div>
            )}
            <div>
              Balance expected: <span className="num text-success">{fmtMoney(row.balance)}</span> ·
              Due {fmtDate(row.due_date)}
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">
              Amount received
            </span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amt}
              onChange={(e) => setAmt(e.target.value)}
              className="w-full rounded-md border border-border bg-background p-2"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">
              Receipt date
            </span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-md border border-border bg-background p-2"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-md border border-border bg-background/40 p-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Short payment
              </div>
              <div className={`num text-lg ${short > 0 ? "text-destructive" : "text-success"}`}>
                {fmtMoney(short)}
              </div>
            </div>
            <div className="rounded-md border border-border bg-background/40 p-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Late days
              </div>
              <div className={`num text-lg ${late > 0 ? "text-warning" : "text-success"}`}>
                {late}
              </div>
            </div>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">
            Cancel
          </button>
          <button
            onClick={() => onSubmit({ amount_received: Number(amt), receipt_date: date })}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Close invoice
          </button>
        </div>
      </div>
    </div>
  );
}
