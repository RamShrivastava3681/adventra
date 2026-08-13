import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import api from "@/lib/api-client";
import {
  PageHeader,
  Card,
  StatusPill,
  fmtMoney,
  fmtDate,
  daysBetween,
} from "@/components/ledger-ui";
import {
  BarChart3,
  FileText,
  ShoppingCart,
  Building2,
  FileDown,
} from "lucide-react";
import { TableSkeleton } from "@/components/skeletons";
import { toast } from "sonner";

export const Route = createFileRoute("/app/reporting")({
  component: ReportingPage,
});

type ReportTab = "sales" | "purchase" | "ageing";

const SALES_STATUSES: Array<[string, string]> = [
  ["all", "All"],
  ["draft", "Draft"],
  ["pending", "Issued"],
  ["approved", "Approved"],
  ["funded", "Funded"],
  ["advanced", "Advanced"],
  ["partially_paid", "Partially paid"],
  ["paid", "Paid"],
  ["overdue", "Overdue"],
  ["cancelled", "Cancelled"],
];

const PURCHASE_STATUSES: Array<[string, string]> = [
  ["all", "All"],
  ["draft", "Draft"],
  ["verified", "Verified"],
  ["approved_for_payment", "Approved for payment"],
  ["partially_paid", "Partially paid"],
  ["paid", "Paid"],
  ["cancelled", "Cancelled"],
];

// Ageing buckets measured from the invoice due date (past due days).
const AGEING_BUCKETS: Array<{ key: "current" | "d1_30" | "d31_60" | "d61_90" | "d90"; label: string }> = [
  { key: "current", label: "Current" },
  { key: "d1_30", label: "1–30 days" },
  { key: "d31_60", label: "31–60 days" },
  { key: "d61_90", label: "61–90 days" },
  { key: "d90", label: "90+ days" },
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Download a CSV file from column headers + row values. */
function downloadCsv(filename: string, header: string[], rows: Array<Array<string | number>>) {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function ReportingPage() {
  const [tab, setTab] = useState<ReportTab>("sales");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");

  // Reports run across the whole portfolio (scope=all), like the dashboard.
  const invoicesQ = useQuery({
    queryKey: ["report", "invoices"],
    queryFn: async () => {
      const data = await api.invoices.list("all");
      return (data ?? []).reverse();
    },
  });
  const purchasesQ = useQuery({
    queryKey: ["report", "purchases"],
    queryFn: async () => {
      const data = await api.purchaseInvoices.list("all");
      return (data ?? []).reverse();
    },
  });
  const debtorsQ = useQuery({
    queryKey: ["report", "debtors"],
    queryFn: async () => (await api.debtors.list()) ?? [],
  });

  // Backend list endpoints don't nest the debtor object — resolve names by id.
  const debtorName = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of debtorsQ.data ?? []) map.set(d.id, d.name ?? d.id);
    return (id?: string | null) => (id ? (map.get(id) ?? "—") : "—");
  }, [debtorsQ.data]);

  const inRange = (dateStr?: string | null) => {
    if (!dateStr) return true;
    const d = String(dateStr).slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  };
  const matchesSearch = (needle: string) => {
    if (!q) return true;
    return needle.toLowerCase().includes(q.toLowerCase());
  };

  // ── Sales invoices report ──────────────────────────────────────
  const salesRows = useMemo(() => {
    return (invoicesQ.data ?? [])
      .filter((i: any) => {
        if (status !== "all" && i.status !== status) return false;
        if (!inRange(i.issue_date)) return false;
        return matchesSearch(`${i.debtor?.name ?? debtorName(i.debtor_id)} ${i.invoice_number}`);
      })
      .map((i: any) => {
        const grandTotal = Number(i.grand_total ?? i.amount ?? 0);
        const advance = Number(i.advance_deducted ?? 0);
        // `amount` is the net receivable (grand total − advances); fall back to
        // computing it when the stored amount is missing.
        const net =
          i.amount != null && Number(i.amount) >= 0
            ? Number(i.amount)
            : Math.max(0, grandTotal - advance);
        const received = Number(i.amount_received ?? 0);
        return {
          ...i,
          debtor_label: i.debtor?.name ?? debtorName(i.debtor_id),
          gross: grandTotal,
          net,
          received,
          balance: Math.max(0, round2(net - received)),
        };
      });
  }, [invoicesQ.data, status, from, to, q, debtorName]);

  const salesTotals = useMemo(() => {
    const t = { gross: 0, net: 0, received: 0, balance: 0 };
    for (const r of salesRows) {
      if (["cancelled", "rejected"].includes(r.status)) continue;
      t.gross = round2(t.gross + r.gross);
      t.net = round2(t.net + r.net);
      t.received = round2(t.received + r.received);
      t.balance = round2(t.balance + r.balance);
    }
    return t;
  }, [salesRows]);

  // ── Purchase invoices report ───────────────────────────────────
  const purchaseRows = useMemo(() => {
    return (purchasesQ.data ?? [])
      .filter((i: any) => {
        if (status !== "all" && i.status !== status) return false;
        if (!inRange(i.issue_date)) return false;
        return matchesSearch(`${i.supplier_name ?? ""} ${i.invoice_number}`);
      })
      .map((i: any) => {
        const amount = Number(i.amount ?? i.grand_total ?? 0);
        const paid = Number(i.amount_paid ?? 0);
        return {
          ...i,
          supplier_label: i.supplier_name ?? "—",
          amount,
          amount_paid: paid,
          balance:
            i.balance_due != null && Number(i.balance_due) >= 0
              ? Number(i.balance_due)
              : Math.max(0, round2(amount - paid)),
        };
      });
  }, [purchasesQ.data, status, from, to, q]);

  const purchaseTotals = useMemo(() => {
    const t = { amount: 0, paid: 0, balance: 0 };
    for (const r of purchaseRows) {
      if (r.status === "cancelled") continue;
      t.amount = round2(t.amount + r.amount);
      t.paid = round2(t.paid + r.amount_paid);
      t.balance = round2(t.balance + r.balance);
    }
    return t;
  }, [purchaseRows]);

  // ── Debtor ageing report ───────────────────────────────────────
  const ageingRows = useMemo(() => {
    const map = new Map<string, any>();
    for (const i of invoicesQ.data ?? []) {
      if (["cancelled", "paid", "rejected"].includes(i.status)) continue;
      const grandTotal = Number(i.grand_total ?? i.amount ?? 0);
      const advance = Number(i.advance_deducted ?? 0);
      const net =
        i.amount != null && Number(i.amount) >= 0
          ? Number(i.amount)
          : Math.max(0, grandTotal - advance);
      const received = Number(i.amount_received ?? 0);
      const balance = Math.max(0, round2(net - received));
      if (balance <= 0.005) continue;
      const days = i.due_date ? daysBetween(i.due_date) : 0;
      const bucket =
        days <= 0 ? "current" : days <= 30 ? "d1_30" : days <= 60 ? "d31_60" : days <= 90 ? "d61_90" : "d90";
      const key = i.debtor_id || "unknown";
      let row = map.get(key);
      if (!row) {
        row = {
          debtor_id: key,
          name: i.debtor?.name ?? debtorName(key),
          invoices: 0,
          current: 0,
          d1_30: 0,
          d31_60: 0,
          d61_90: 0,
          d90: 0,
          total: 0,
        };
        map.set(key, row);
      }
      row.invoices += 1;
      row[bucket] = round2(row[bucket] + balance);
      row.total = round2(row.total + balance);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [invoicesQ.data, debtorName]);

  const ageingTotals = useMemo(() => {
    const t = { invoices: 0, current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0, total: 0 };
    for (const r of ageingRows) {
      t.invoices += r.invoices;
      for (const b of AGEING_BUCKETS) t[b.key] = round2(t[b.key] + r[b.key]);
      t.total = round2(t.total + r.total);
    }
    return t;
  }, [ageingRows]);

  // ── CSV export for the active tab ──────────────────────────────
  const exportCsv = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    if (tab === "sales") {
      downloadCsv(
        `sales-invoices-${stamp}.csv`,
        ["Invoice", "Date", "Debtor", "Status", "Gross", "Net receivable", "Received", "Balance", "Due date"],
        salesRows.map((r: any) => [
          r.invoice_number,
          (r.issue_date ?? "").slice(0, 10),
          r.debtor_label,
          r.status,
          r.gross,
          r.net,
          r.received,
          r.balance,
          (r.due_date ?? "").slice(0, 10),
        ]),
      );
    } else if (tab === "purchase") {
      downloadCsv(
        `purchase-invoices-${stamp}.csv`,
        ["Invoice", "Date", "Supplier", "Status", "Amount", "Paid", "Balance", "Due date"],
        purchaseRows.map((r: any) => [
          r.invoice_number,
          (r.issue_date ?? "").slice(0, 10),
          r.supplier_label,
          r.status,
          r.amount,
          r.amount_paid,
          r.balance,
          (r.due_date ?? "").slice(0, 10),
        ]),
      );
    } else {
      downloadCsv(
        `debtor-ageing-${stamp}.csv`,
        ["Debtor", "Invoices", "Current", "1-30 days", "31-60 days", "61-90 days", "90+ days", "Total outstanding"],
        [
          ...ageingRows.map((r: any) => [
            r.name,
            r.invoices,
            r.current,
            r.d1_30,
            r.d31_60,
            r.d61_90,
            r.d90,
            r.total,
          ]),
          [
            "TOTAL",
            ageingTotals.invoices,
            ageingTotals.current,
            ageingTotals.d1_30,
            ageingTotals.d31_60,
            ageingTotals.d61_90,
            ageingTotals.d90,
            ageingTotals.total,
          ],
        ],
      );
    }
    toast.success("Report exported as CSV");
  };

  const loading = invoicesQ.isLoading || purchasesQ.isLoading || debtorsQ.isLoading;

  return (
    <div>
      <PageHeader
        eyebrow="Reports"
        title="Reports"
        description="Sales invoices, purchase invoices and debtor ageing across the portfolio — filter by date, status or party, then export to CSV."
        icon={<BarChart3 className="h-5 w-5" />}
        actions={
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            <FileDown className="h-4 w-4" /> Export CSV
          </button>
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        {/* Report tabs */}
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["sales", "Sales invoices", FileText],
              ["purchase", "Purchase invoices", ShoppingCart],
              ["ageing", "Debtor ageing", Building2],
            ] as Array<[ReportTab, string, any]>
          ).map(([k, label, Icon]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs uppercase tracking-widest transition ${
                tab === k
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border/60 bg-muted/20 p-3">
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">
              From date
            </span>
            <input
              type="date"
              className="inp !w-40"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">
              To date
            </span>
            <input
              type="date"
              className="inp !w-40"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          {tab !== "ageing" && (
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">
                Status
              </span>
              <select
                className="inp !w-44"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {(tab === "sales" ? SALES_STATUSES : PURCHASE_STATUSES).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block min-w-[200px] flex-1">
            <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">
              Search
            </span>
            <input
              className="inp"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={
                tab === "purchase"
                  ? "Supplier or invoice number…"
                  : tab === "ageing"
                    ? "Debtor name…"
                    : "Debtor or invoice number…"
              }
            />
          </label>
        </div>

        {loading ? (
          <Card>
            <TableSkeleton rows={6} cols={8} />
          </Card>
        ) : tab === "sales" ? (
          <SalesReport rows={salesRows} totals={salesTotals} />
        ) : tab === "purchase" ? (
          <PurchaseReport rows={purchaseRows} totals={purchaseTotals} />
        ) : (
          <AgeingReport rows={ageingRows} totals={ageingTotals} />
        )}
      </div>
      <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:disabled{opacity:.55}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
    </div>
  );
}

// ─── Sales invoices report table ─────────────────────────────────────────
function SalesReport({ rows, totals }: { rows: any[]; totals: { gross: number; net: number; received: number; balance: number } }) {
  return (
    <Card>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <MiniStat label="Billed (gross)" value={fmtMoney(totals.gross)} />
        <MiniStat label="Net receivable" value={fmtMoney(totals.net)} />
        <MiniStat label="Received" value={fmtMoney(totals.received)} tone="text-success" />
        <MiniStat label="Outstanding" value={fmtMoney(totals.balance)} tone="text-warning" />
      </div>
      {rows.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          No sales invoices match the current filters.
        </div>
      ) : (
        <div className="-mx-6 overflow-x-auto px-6">
          <table className="table-premium w-full text-sm">
            <thead className="text-xs uppercase tracking-widest text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-left font-normal">Invoice</th>
                <th className="px-3 py-2 text-left font-normal">Date</th>
                <th className="px-3 py-2 text-left font-normal">Debtor</th>
                <th className="px-3 py-2 text-left font-normal">Status</th>
                <th className="px-3 py-2 text-right font-normal">Gross</th>
                <th className="px-3 py-2 text-right font-normal">Received</th>
                <th className="px-3 py-2 text-right font-normal">Balance</th>
                <th className="px-3 py-2 text-left font-normal">Due</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id} className="border-b border-border/60 hover:bg-muted/30">
                  <td className="px-3 py-3 font-mono text-xs">{r.invoice_number}</td>
                  <td className="px-3 py-3">{fmtDate(r.issue_date)}</td>
                  <td className="px-3 py-3">{r.debtor_label}</td>
                  <td className="px-3 py-3">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="px-3 py-3 text-right num">{fmtMoney(r.gross)}</td>
                  <td className="px-3 py-3 text-right num text-success">
                    {r.received > 0 ? fmtMoney(r.received) : "—"}
                  </td>
                  <td className={`px-3 py-3 text-right num ${r.balance > 0 ? "text-warning" : "text-muted-foreground"}`}>
                    {fmtMoney(r.balance)}
                  </td>
                  <td className="px-3 py-3">{fmtDate(r.due_date)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-medium">
                <td className="px-3 py-3" colSpan={4}>
                  {rows.length} invoice{rows.length === 1 ? "" : "s"}
                </td>
                <td className="px-3 py-3 text-right num">{fmtMoney(totals.gross)}</td>
                <td className="px-3 py-3 text-right num text-success">{fmtMoney(totals.received)}</td>
                <td className="px-3 py-3 text-right num text-warning">{fmtMoney(totals.balance)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}

// ─── Purchase invoices report table ──────────────────────────────────────
function PurchaseReport({ rows, totals }: { rows: any[]; totals: { amount: number; paid: number; balance: number } }) {
  return (
    <Card>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <MiniStat label="Invoiced (payable)" value={fmtMoney(totals.amount)} />
        <MiniStat label="Paid" value={fmtMoney(totals.paid)} tone="text-success" />
        <MiniStat label="Balance due" value={fmtMoney(totals.balance)} tone="text-warning" />
        <MiniStat label="Invoices" value={String(rows.length)} />
      </div>
      {rows.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          No purchase invoices match the current filters.
        </div>
      ) : (
        <div className="-mx-6 overflow-x-auto px-6">
          <table className="table-premium w-full text-sm">
            <thead className="text-xs uppercase tracking-widest text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-left font-normal">Invoice</th>
                <th className="px-3 py-2 text-left font-normal">Date</th>
                <th className="px-3 py-2 text-left font-normal">Supplier</th>
                <th className="px-3 py-2 text-left font-normal">Status</th>
                <th className="px-3 py-2 text-right font-normal">Amount</th>
                <th className="px-3 py-2 text-right font-normal">Paid</th>
                <th className="px-3 py-2 text-right font-normal">Balance</th>
                <th className="px-3 py-2 text-left font-normal">Due</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id} className="border-b border-border/60 hover:bg-muted/30">
                  <td className="px-3 py-3 font-mono text-xs">{r.invoice_number}</td>
                  <td className="px-3 py-3">{fmtDate(r.issue_date)}</td>
                  <td className="px-3 py-3">{r.supplier_label}</td>
                  <td className="px-3 py-3">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="px-3 py-3 text-right num">{fmtMoney(r.amount)}</td>
                  <td className="px-3 py-3 text-right num text-success">
                    {r.amount_paid > 0 ? fmtMoney(r.amount_paid) : "—"}
                  </td>
                  <td className={`px-3 py-3 text-right num ${r.balance > 0 ? "text-warning" : "text-muted-foreground"}`}>
                    {fmtMoney(r.balance)}
                  </td>
                  <td className="px-3 py-3">{fmtDate(r.due_date)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-medium">
                <td className="px-3 py-3" colSpan={4}>
                  {rows.length} invoice{rows.length === 1 ? "" : "s"}
                </td>
                <td className="px-3 py-3 text-right num">{fmtMoney(totals.amount)}</td>
                <td className="px-3 py-3 text-right num text-success">{fmtMoney(totals.paid)}</td>
                <td className="px-3 py-3 text-right num text-warning">{fmtMoney(totals.balance)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}

// ─── Debtor ageing report table ──────────────────────────────────────────
function AgeingReport({ rows, totals }: { rows: any[]; totals: any }) {
  return (
    <Card>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <MiniStat label="Debtors" value={String(rows.length)} />
        <MiniStat label="Invoices" value={String(totals.invoices)} />
        <MiniStat label="Total outstanding" value={fmtMoney(totals.total)} tone="text-warning" />
        <MiniStat label="Past due (90+)" value={fmtMoney(totals.d90)} tone="text-destructive" />
      </div>
      {rows.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          No outstanding balances — nothing ageing.
        </div>
      ) : (
        <div className="-mx-6 overflow-x-auto px-6">
          <table className="table-premium w-full text-sm">
            <thead className="text-xs uppercase tracking-widest text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-left font-normal">Debtor</th>
                <th className="px-3 py-2 text-right font-normal">Invoices</th>
                {AGEING_BUCKETS.map((b) => (
                  <th key={b.key} className="px-3 py-2 text-right font-normal">
                    {b.label}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-normal">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.debtor_id} className="border-b border-border/60 hover:bg-muted/30">
                  <td className="px-3 py-3 font-medium">{r.name}</td>
                  <td className="px-3 py-3 text-right num">{r.invoices}</td>
                  {AGEING_BUCKETS.map((b) => (
                    <td
                      key={b.key}
                      className={`px-3 py-3 text-right num ${
                        r[b.key] > 0 && b.key !== "current" ? "text-warning" : "text-muted-foreground"
                      }`}
                    >
                      {r[b.key] > 0 ? fmtMoney(r[b.key]) : "—"}
                    </td>
                  ))}
                  <td className="px-3 py-3 text-right num font-medium">{fmtMoney(r.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-medium">
                <td className="px-3 py-3">Total</td>
                <td className="px-3 py-3 text-right num">{totals.invoices}</td>
                {AGEING_BUCKETS.map((b) => (
                  <td key={b.key} className="px-3 py-3 text-right num">
                    {fmtMoney(totals[b.key])}
                  </td>
                ))}
                <td className="px-3 py-3 text-right num">{fmtMoney(totals.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-1 font-display text-lg ${tone ?? ""}`}>{value}</div>
    </div>
  );
}
