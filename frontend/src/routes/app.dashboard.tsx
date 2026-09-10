import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import api from "@/lib/api-client";
import {
  Card,
  StatusPill,
  EmptyState,
  fmtMoney,
  fmtDate,
  daysBetween,
} from "@/components/ledger-ui";
import {
  Activity,
  Paperclip,
  X,
  Link2,
  FileText,
  Receipt,
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  ShieldCheck,
  CircleAlert,
} from "lucide-react";
import { DocumentList, type DocMeta } from "@/components/document-uploader";
import { DashboardSkeleton } from "@/components/skeletons";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  Legend,
} from "recharts";

export const Route = createFileRoute("/app/dashboard")({
  component: Dashboard,
});

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function monthLabel(key: string): string {
  // key: "YYYY-MM"
  const mm = Number(key.slice(5, 7));
  if (mm >= 1 && mm <= 12) return MONTH_SHORT[mm - 1];
  return key.slice(5);
}

function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
  if (abs >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (abs >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return fmtMoney(n);
}

function timeAgo(iso?: string | null): string {
  if (!iso) return "—";
  const d = daysBetween(String(iso).slice(0, 10));
  if (d <= 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 30) return `${d}d ago`;
  return fmtDate(iso);
}

function Dashboard() {
  const [viewingExpense, setViewingExpense] = useState<any | null>(null);
  const [range, setRange] = useState<8 | 6 | 3 | 1>(8);

  // The dashboard is shared by every user — it always shows the whole
  // portfolio's real numbers (scope=all), not just the caller's own client.
  const invoicesQ = useQuery({
    queryKey: ["invoices", "all"],
    queryFn: async () => {
      const data = await api.invoices.list("all");
      return data.reverse();
    },
  });

  const purchasesQ = useQuery({
    queryKey: ["purchase_invoices", "all"],
    queryFn: async () => {
      const data = await api.purchaseInvoices.list("all");
      return data.reverse();
    },
  });

  const expensesQ = useQuery({
    queryKey: ["expenses", "all"],
    queryFn: async () => {
      const data = await api.expenses.list("all");
      return data.reverse();
    },
  });

  const alertsQ = useQuery({
    queryKey: ["alerts"],
    queryFn: async () => {
      const data = await api.alerts.list();
      return (data ?? []).reverse().slice(0, 8);
    },
  });

  const debtorsQ = useQuery({
    queryKey: ["debtors"],
    queryFn: async () => {
      const data = await api.debtors.list();
      return data;
    },
  });
  // Backend list endpoints don't nest the debtor object — resolve names by id.
  const debtorName = (id?: string | null) =>
    (debtorsQ.data ?? []).find((d: any) => d.id === id)?.name ?? "—";

  const isDashboardLoading =
    invoicesQ.isLoading ||
    purchasesQ.isLoading ||
    expensesQ.isLoading ||
    alertsQ.isLoading ||
    debtorsQ.isLoading;

  const invoices = invoicesQ.data ?? [];
  const purchases = purchasesQ.data ?? [];
  const expenses = expensesQ.data ?? [];

  // ── Core portfolio math (unchanged business logic) ──
  const totalOutstanding = invoices
    .filter((i) => i.status !== "paid" && i.status !== "rejected")
    .reduce((s, i) => s + Number(i.amount), 0);
  const totalAdvanced = invoices
    .filter((i) => i.status === "advanced" || i.status === "paid")
    .reduce((s, i) => s + (Number(i.amount) * Number(i.advance_rate)) / 100, 0);
  const overdueCount = invoices.filter(
    (i) =>
      i.status === "overdue" || (i.due_date && i.status !== "paid" && daysBetween(i.due_date) > 0),
  ).length;
  const overdueAmount = invoices
    .filter(
      (i) =>
        i.status === "overdue" ||
        (i.due_date && i.status !== "paid" && i.status !== "rejected" && daysBetween(i.due_date) > 0),
    )
    .reduce((s, i) => s + Number(i.amount), 0);
  const collectionRate = invoices.length
    ? Math.round((invoices.filter((i) => i.status === "paid").length / invoices.length) * 100)
    : 0;
  const paidInvoices = invoices.filter((i: any) => i.status === "paid");
  const totalShortPayment = paidInvoices.reduce(
    (s: number, i: any) => s + Number(i.short_payment ?? 0),
    0,
  );
  const shortPaidInvoices = paidInvoices.filter((i: any) => Number(i.short_payment ?? 0) > 0);
  const lateInvoices = paidInvoices.filter((i: any) => Number(i.late_days ?? 0) > 0);
  const avgLateDays = lateInvoices.length
    ? Math.round(
        lateInvoices.reduce((s: number, i: any) => s + Number(i.late_days), 0) /
          lateInvoices.length,
      )
    : 0;

  // Income model (trading): gross = sales - purchases; net = gross - expenses
  const salesTotal = invoices.reduce((s, i) => s + Number(i.amount), 0);
  const purchaseTotal = purchases.reduce((s: number, p: any) => s + Number(p.amount), 0);
  const expenseTotal = expenses.reduce((s: number, e: any) => s + Number(e.amount), 0);
  const gross = salesTotal - purchaseTotal;
  const net = gross - expenseTotal;
  const marginPct = salesTotal > 0 ? (gross / salesTotal) * 100 : 0;

  // Monthly trend (unchanged source data, labelled for readability)
  const monthMap = new Map<string, { sales: number; purchases: number; expenses: number }>();
  const bump = (key: string, field: "sales" | "purchases" | "expenses", val: number) => {
    if (!key) return;
    const k = key.slice(0, 7);
    const cur = monthMap.get(k) ?? { sales: 0, purchases: 0, expenses: 0 };
    cur[field] += val;
    monthMap.set(k, cur);
  };
  invoices.forEach((i) => bump(i.issue_date ?? "", "sales", Number(i.amount)));
  purchases.forEach((p: any) => bump(p.issue_date ?? "", "purchases", Number(p.amount)));
  expenses.forEach((e: any) => bump(e.expense_date ?? "", "expenses", Number(e.amount)));
  const incomeTrend = Array.from(monthMap.entries())
    .sort()
    .slice(-8)
    .map(([m, v]) => ({
      key: m,
      month: monthLabel(m),
      gross: Math.round(v.sales - v.purchases),
      net: Math.round(v.sales - v.purchases - v.expenses),
    }));

  // Month-over-month sales momentum (real data only)
  const sortedMonths = useMemo(
    () => Array.from(monthMap.entries()).sort().slice(-8),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [invoicesQ.data, purchasesQ.data, expensesQ.data],
  );
  const momPct = useMemo(() => {
    if (sortedMonths.length < 2) return null;
    const prev = sortedMonths[sortedMonths.length - 2][1].sales;
    const last = sortedMonths[sortedMonths.length - 1][1].sales;
    if (!prev) return null;
    return ((last - prev) / prev) * 100;
  }, [sortedMonths]);

  // Sparklines derived from the same monthly buckets (no new data)
  const sparks = useMemo(() => {
    const sales = sortedMonths.map(([, v]) => v.sales);
    const openByMonth = sortedMonths.map(([m]) =>
      invoices
        .filter((i) => (i.issue_date ?? "").slice(0, 7) === m && i.status !== "paid" && i.status !== "rejected")
        .reduce((s, i) => s + Number(i.amount), 0),
    );
    const advByMonth = sortedMonths.map(([m]) =>
      invoices
        .filter(
          (i) =>
            (i.issue_date ?? "").slice(0, 7) === m &&
            (i.status === "advanced" || i.status === "paid"),
        )
        .reduce((s, i) => s + (Number(i.amount) * Number(i.advance_rate)) / 100, 0),
    );
    const rateByMonth = sortedMonths.map(([m]) => {
      const bucket = invoices.filter((i) => (i.issue_date ?? "").slice(0, 7) === m);
      if (!bucket.length) return 0;
      return (bucket.filter((i) => i.status === "paid").length / bucket.length) * 100;
    });
    return { sales, openByMonth, advByMonth, rateByMonth };
  }, [sortedMonths, invoicesQ.data]);

  // Ranged chart window
  const rangedTrend = incomeTrend.slice(-range);
  const rangeGross = rangedTrend.reduce((s, p) => s + p.gross, 0);
  const rangeNet = rangedTrend.reduce((s, p) => s + p.net, 0);
  const rangeMargin = rangeGross !== 0 ? (rangeNet / rangeGross) * 100 : 0;

  // Aging buckets (unchanged logic)
  const aging = invoices.reduce(
    (acc, i) => {
      if (i.status === "paid" || i.status === "rejected") return acc;
      const dpd = i.due_date ? daysBetween(i.due_date) : 0;
      const amt = Number(i.amount);
      if (dpd <= 0) acc.current += amt;
      else if (dpd <= 30) acc.b1 += amt;
      else if (dpd <= 60) acc.b2 += amt;
      else if (dpd <= 90) acc.b3 += amt;
      else acc.b4 += amt;
      return acc;
    },
    { current: 0, b1: 0, b2: 0, b3: 0, b4: 0 },
  );
  const agingTotal = (Object.values(aging) as number[]).reduce((a, x) => a + x, 0) || 1;
  const attentionTotal = aging.b1 + aging.b2 + aging.b3 + aging.b4;

  // ── Action Required rows (all derived from live portfolio data) ──
  const actionRows = useMemo(() => {
    const rows: {
      issue: string;
      party: string;
      amount: number;
      age: string;
      to: string;
      tone: "bad" | "warn" | "info";
    }[] = [];
    const overdue = invoices
      .filter(
        (i) =>
          (i.status === "overdue" ||
            (i.due_date && i.status !== "paid" && i.status !== "rejected" && daysBetween(i.due_date) > 0)),
      )
      .sort((a, b) => daysBetween(b.due_date) - daysBetween(a.due_date))
      .slice(0, 4);
    for (const i of overdue) {
      const dpd = i.due_date ? daysBetween(i.due_date) : 0;
      rows.push({
        issue: "Overdue invoice",
        party: debtorName(i.debtor_id),
        amount: Number(i.amount),
        age: `${dpd}d overdue`,
        to: "/app/invoices",
        tone: "bad",
      });
    }
    for (const i of shortPaidInvoices.slice(0, 2)) {
      rows.push({
        issue: "Short payment",
        party: debtorName(i.debtor_id),
        amount: Number((i as any).short_payment ?? 0),
        age: timeAgo((i as any).receipt_date ?? (i as any).paid_date ?? i.due_date),
        to: "/app/invoices",
        tone: "warn",
      });
    }
    const dueSoon = invoices
      .filter((i) => {
        if (!i.due_date || i.status === "paid" || i.status === "rejected") return false;
        const d = daysBetween(i.due_date);
        return d <= 0 && d >= -7;
      })
      .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))
      .slice(0, 3);
    for (const i of dueSoon) {
      const toGo = Math.abs(daysBetween(i.due_date));
      rows.push({
        issue: "Payment follow-up",
        party: debtorName(i.debtor_id),
        amount: Number(i.amount),
        age: toGo === 0 ? "Due today" : `Due in ${toGo}d`,
        to: "/app/invoices",
        tone: "info",
      });
    }
    const pendingFunding = invoices.filter((i) =>
      ["submitted", "pending_review", "under_review", "in_review", "processing"].includes(
        String(i.status),
      ),
    );
    if (pendingFunding.length > 0) {
      rows.push({
        issue: "Funding approval pending",
        party: `${pendingFunding.length} invoice${pendingFunding.length > 1 ? "s" : ""}`,
        amount: pendingFunding.reduce((s, i) => s + Number(i.amount), 0),
        age: "Awaiting checker",
        to: "/app/queue",
        tone: "warn",
      });
    }
    const pendingSupplier = (purchases as any[]).filter((p) =>
      ["submitted", "pending_review", "under_review", "in_review", "draft"].includes(
        String(p.status),
      ),
    );
    if (pendingSupplier.length > 0) {
      rows.push({
        issue: "Supplier invoices pending verification",
        party: `${pendingSupplier.length} invoice${pendingSupplier.length > 1 ? "s" : ""}`,
        amount: pendingSupplier.reduce((s, p) => s + Number(p.amount), 0),
        age: "Awaiting review",
        to: "/app/purchases",
        tone: "info",
      });
    }
    return rows.slice(0, 7);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoicesQ.data, purchasesQ.data, debtorsQ.data]);

  // ── Portfolio health (rule-based on live data, never fabricated) ──
  const health = useMemo(() => {
    if (overdueCount === 0 && collectionRate >= 50)
      return { label: "Healthy", cls: "text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500" };
    if (overdueCount <= 2)
      return { label: "Needs attention", cls: "text-amber-600 dark:text-amber-400", dot: "bg-amber-500" };
    return { label: "At risk", cls: "text-red-600 dark:text-red-400", dot: "bg-red-500" };
  }, [overdueCount, collectionRate]);

  const avgCollectionDays = useMemo(() => {
    const settled = paidInvoices.filter(
      (i: any) => i.issue_date && (i.receipt_date || i.paid_date),
    );
    if (!settled.length) return null;
    const total = settled.reduce(
      (s: number, i: any) =>
        s + Math.max(0, daysBetween(i.issue_date, i.receipt_date ?? i.paid_date)),
      0,
    );
    return Math.round(total / settled.length);
  }, [invoicesQ.data]);

  // ── Recent activity timeline (derived from existing records only) ──
  const activityFeed = useMemo(() => {
    const feed: { ts: string; title: string; detail: string }[] = [];
    for (const i of invoices as any[]) {
      if (i.status === "paid" && (i.receipt_date || i.paid_date)) {
        feed.push({
          ts: i.receipt_date ?? i.paid_date,
          title: `Payment received from ${debtorName(i.debtor_id)}`,
          detail: fmtMoney(i.amount),
        });
      } else if (i.created_at ?? i.issue_date) {
        feed.push({
          ts: i.created_at ?? i.issue_date,
          title: `Invoice ${i.invoice_number} issued to ${debtorName(i.debtor_id)}`,
          detail: fmtMoney(i.amount),
        });
      }
    }
    for (const e of expenses as any[]) {
      feed.push({
        ts: e.created_at ?? e.expense_date,
        title: `Expense logged — ${String(e.category ?? "general").replace(/_/g, " ")}`,
        detail: fmtMoney(e.amount),
      });
    }
    for (const a of (alertsQ.data ?? []) as any[]) {
      feed.push({ ts: a.created_at ?? "", title: a.message, detail: String(a.type ?? "").replace(/_/g, " ") });
    }
    return feed
      .filter((f) => f.ts)
      .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))
      .slice(0, 7);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoicesQ.data, expensesQ.data, alertsQ.data, debtorsQ.data]);

  const openInvoices = invoices.filter((i) => i.status !== "paid" && i.status !== "rejected");
  const portfolioHealthy = overdueCount === 0;

  return (
    <div>
      {/* ── Command-center header ── */}
      <div className="border-b border-border bg-background px-6 py-5 md:px-10">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-semibold tracking-tight text-foreground">
                Portfolio Overview
              </h1>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                  portfolioHealthy
                    ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${portfolioHealthy ? "bg-emerald-500" : "bg-amber-500"}`} />
                {portfolioHealthy ? "Portfolio healthy" : `${overdueCount} overdue need attention`}
              </span>
            </div>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Track receivables, advances, settlements and portfolio performance across your clients.
            </p>
          </div>
          <Link to="/app/queue" className="btn-primary">
            Open Funding Queue
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {isDashboardLoading ? (
        <DashboardSkeleton />
      ) : (
        <div className="mx-auto max-w-[1440px] space-y-6 px-6 py-6 md:px-10 md:py-8">
          {/* ── Executive KPI strip ── */}
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Gross Sales"
              value={fmtMoney(salesTotal)}
              context={`${invoices.length} invoices`}
              trend={momPct != null ? { value: momPct, caption: "vs last month" } : undefined}
              spark={sparks.sales}
              sparkTone="blue"
            />
            <KpiCard
              label="Outstanding AR"
              value={fmtMoney(totalOutstanding)}
              context={`${openInvoices.length} open invoices`}
              spark={sparks.openByMonth}
              sparkTone={overdueCount > 0 ? "amber" : "blue"}
            />
            <KpiCard
              label="Advanced"
              value={fmtMoney(totalAdvanced)}
              context="Across funded invoices"
              spark={sparks.advByMonth}
              sparkTone="blue"
            />
            <KpiCard
              label="Collection Rate"
              value={`${collectionRate}%`}
              context="Lifetime, by count"
              spark={sparks.rateByMonth}
              sparkTone={collectionRate >= 90 ? "green" : "blue"}
              healthy={collectionRate >= 90}
            />
          </section>

          {/* ── Portfolio performance chart ── */}
          {incomeTrend.length > 0 && (
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
                <div>
                  <h3 className="text-[15px] font-semibold tracking-tight text-foreground">
                    Portfolio Performance
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">Gross vs Net · Last 8 months</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="hidden items-center gap-3 text-[11px] text-muted-foreground sm:flex">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-[var(--color-chart-1)]" /> Gross
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-[var(--color-chart-2)]" /> Net
                    </span>
                  </div>
                  <div className="inline-flex overflow-hidden rounded-lg border border-border text-[11px] font-semibold">
                    {([8, 6, 3, 1] as const).map((r) => (
                      <button
                        key={r}
                        onClick={() => setRange(r)}
                        className={`px-2.5 py-1.5 transition-colors ${
                          range === r
                            ? "bg-primary-soft text-primary"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                      >
                        {r}M
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-5 pb-1 pt-3">
                <span className="num text-sm font-semibold text-foreground">
                  {fmtCompact(rangeGross)}{" "}
                  <span className="text-[11px] font-medium text-muted-foreground">Gross</span>
                </span>
                <span className="num text-sm font-semibold text-foreground">
                  {fmtCompact(rangeNet)}{" "}
                  <span className="text-[11px] font-medium text-muted-foreground">Net</span>
                </span>
                <span className="num text-sm font-semibold text-primary">
                  {rangeMargin.toFixed(1)}%{" "}
                  <span className="text-[11px] font-medium text-muted-foreground">Margin</span>
                </span>
              </div>
              <div className="h-72 px-2 pb-2 pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={rangedTrend} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="ig" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" style={{ stopColor: "var(--color-chart-1)" }} stopOpacity={0.18} />
                        <stop offset="100%" style={{ stopColor: "var(--color-chart-1)" }} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="ng" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" style={{ stopColor: "var(--color-chart-2)" }} stopOpacity={0.14} />
                        <stop offset="100%" style={{ stopColor: "var(--color-chart-2)" }} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="month"
                      stroke="var(--color-muted-foreground)"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                    />
                    <YAxis
                      stroke="var(--color-muted-foreground)"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      width={56}
                      domain={["auto", "auto"]}
                      tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      cursor={{ stroke: "var(--color-border-strong)" }}
                      contentStyle={{
                        background: "var(--color-popover)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 10,
                        fontSize: 12,
                        boxShadow: "0 8px 24px rgba(17,24,39,0.1)",
                      }}
                      formatter={(v: number, name: string) => [fmtMoney(v), name === "gross" ? "Gross" : "Net"]}
                      labelFormatter={(_, payload) => {
                        const p: any = payload?.[0]?.payload;
                        if (!p) return "";
                        const [y, m] = String(p.key ?? "").split("-");
                        return m ? `${MONTH_SHORT[Number(m) - 1] ?? m} ${y}` : p.month;
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                    <Area
                      type="monotone"
                      dataKey="gross"
                      name="Gross"
                      stroke="var(--color-chart-1)"
                      strokeWidth={2.25}
                      fill="url(#ig)"
                      dot={false}
                      activeDot={{ r: 3.5 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="net"
                      name="Net"
                      stroke="var(--color-chart-2)"
                      strokeWidth={2.25}
                      fill="url(#ng)"
                      dot={false}
                      activeDot={{ r: 3.5 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          {/* ── Performance overview ── */}
          <section>
            <SectionHeading>Performance Overview</SectionHeading>
            <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-border md:grid-cols-3 xl:grid-cols-6">
              <PerfCell
                label="Cost of Goods"
                value={fmtMoney(purchaseTotal)}
                meta={`${purchases.length} supplier invoices`}
                tone="neutral"
              />
              <PerfCell
                label="Gross Income"
                value={fmtMoney(gross)}
                meta={`${marginPct.toFixed(1)}% margin`}
                tone={gross >= 0 ? "good" : "bad"}
              />
              <PerfCell
                label="Net Income"
                value={fmtMoney(net)}
                meta={`After ${fmtMoney(expenseTotal)} expenses`}
                tone={net >= 0 ? "good" : "bad"}
              />
              <PerfCell
                label="Overdue"
                value={String(overdueCount)}
                meta={overdueCount > 0 ? "Action required" : "All clean"}
                tone={overdueCount > 0 ? "bad" : "good"}
              />
              <PerfCell
                label="Short Payments"
                value={fmtMoney(totalShortPayment)}
                meta={`${shortPaidInvoices.length} invoices short paid`}
                tone={totalShortPayment > 0 ? "warn" : "good"}
              />
              <PerfCell
                label="Avg Late Days"
                value={String(avgLateDays)}
                meta={`${lateInvoices.length} late · ${paidInvoices.length - lateInvoices.length} on time`}
                tone={avgLateDays > 0 ? "warn" : "good"}
              />
            </div>
          </section>

          {/* ── Aging + Alerts ── */}
          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="Aging Waterfall" className="lg:col-span-2">
              <div className="space-y-4">
                {[
                  { label: "Current", val: aging.current, bar: "bg-emerald-500" },
                  { label: "1–30 days", val: aging.b1, bar: "bg-[var(--color-chart-2)]" },
                  { label: "31–60 days", val: aging.b2, bar: "bg-amber-400" },
                  { label: "61–90 days", val: aging.b3, bar: "bg-orange-500" },
                  { label: "90+ days", val: aging.b4, bar: "bg-red-500" },
                ].map((b) => {
                  const pct = (b.val / agingTotal) * 100;
                  return (
                    <div key={b.label} title={`${b.label}: ${fmtMoney(b.val)} (${pct.toFixed(1)}% of AR)`}>
                      <div className="flex items-baseline justify-between text-xs">
                        <span className="font-medium text-foreground">{b.label}</span>
                        <span className="num text-muted-foreground">
                          {fmtCompact(b.val)} · {pct.toFixed(0)}%
                        </span>
                      </div>
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                        <div className={`h-full rounded-full ${b.bar}`} style={{ width: `${Math.max(pct, b.val > 0 ? 2 : 0)}%` }} />
                      </div>
                    </div>
                  );
                })}
                <div className="flex items-center gap-1.5 border-t border-border pt-3 text-xs">
                  <CircleAlert className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  {attentionTotal > 0 ? (
                    <span className="text-muted-foreground">
                      <span className="num font-semibold text-foreground">{fmtMoney(attentionTotal)}</span>{" "}
                      requires collection attention
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      Nothing overdue — receivables are current.
                    </span>
                  )}
                </div>
              </div>
            </Card>

            <Card
              title="Alerts"
              action={
                <Link to="/app/alerts" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  View all <ArrowRight className="h-3 w-3" />
                </Link>
              }
            >
              {(alertsQ.data ?? []).length === 0 ? (
                <div className="flex flex-col items-center px-6 py-10 text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                  <h3 className="mt-3 text-sm font-semibold text-foreground">You&apos;re all caught up</h3>
                  <p className="mt-1 text-xs text-muted-foreground">No action required right now.</p>
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {(alertsQ.data ?? []).slice(0, 5).map((a) => (
                    <li
                      key={a.id}
                      className="group rounded-lg border border-border bg-background/40 px-3 py-2.5 transition-colors hover:border-border-strong"
                    >
                      <div className="flex items-start gap-2.5">
                        <span
                          className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                            a.severity === "critical"
                              ? "bg-red-500"
                              : a.severity === "warning"
                                ? "bg-amber-500"
                                : "bg-primary"
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] leading-snug text-foreground">{a.message}</div>
                          <div className="mt-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                            {fmtDate(a.created_at)} · {String(a.type ?? "").replace(/_/g, " ")}
                          </div>
                        </div>
                        <Link
                          to="/app/alerts"
                          className="mt-0.5 shrink-0 text-[11px] font-semibold text-primary opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          Review →
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* ── Action required ── */}
          <Card
            title="Action Required"
            action={
              <Link to="/app/invoices" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            }
          >
            {actionRows.length === 0 ? (
              <EmptyState
                icon={<CheckCircle2 className="h-5 w-5" />}
                title="Nothing needs attention"
                description="Overdue invoices, short payments and pending approvals will surface here."
              />
            ) : (
              <div className="-mx-5 overflow-x-auto">
                <table className="table-premium w-full">
                  <thead>
                    <tr>
                      <th>Issue</th>
                      <th>Customer / Supplier</th>
                      <th className="text-right">Amount</th>
                      <th>Age</th>
                      <th className="text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {actionRows.map((r, idx) => (
                      <tr key={idx}>
                        <td>
                          <span
                            className={`inline-flex items-center gap-1.5 text-[13px] font-medium ${
                              r.tone === "bad"
                                ? "text-red-600 dark:text-red-400"
                                : r.tone === "warn"
                                  ? "text-amber-600 dark:text-amber-400"
                                  : "text-foreground"
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                r.tone === "bad" ? "bg-red-500" : r.tone === "warn" ? "bg-amber-500" : "bg-primary"
                              }`}
                            />
                            {r.issue}
                          </span>
                        </td>
                        <td className="text-foreground">{r.party}</td>
                        <td className="num text-right font-medium">{fmtMoney(r.amount)}</td>
                        <td className="whitespace-nowrap text-muted-foreground">{r.age}</td>
                        <td className="text-right">
                          <Link
                            to={r.to as any}
                            className="rounded-md border border-border px-2.5 py-1 text-[11px] font-semibold text-primary transition-colors hover:border-primary hover:bg-primary-soft"
                          >
                            Review
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* ── Portfolio health + Recent activity ── */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Portfolio Health">
              <div className="flex items-center gap-2.5">
                <span className={`h-2.5 w-2.5 rounded-full ${health.dot}`} />
                <span className={`text-lg font-semibold tracking-tight ${health.cls}`}>{health.label}</span>
              </div>
              <dl className="mt-4 space-y-3">
                <HealthRow label="Collection Rate" value={`${collectionRate}%`} />
                <HealthRow label="Outstanding AR" value={fmtMoney(totalOutstanding)} mono />
                <HealthRow
                  label="Overdue"
                  value={`${fmtMoney(overdueAmount)} / ${overdueCount} invoice${overdueCount === 1 ? "" : "s"}`}
                  mono
                  alert={overdueCount > 0}
                />
                <HealthRow
                  label="Average Collection Time"
                  value={avgCollectionDays != null ? `${avgCollectionDays} days` : "—"}
                  mono
                  hint={avgCollectionDays == null ? "No settled invoices yet" : undefined}
                />
              </dl>
            </Card>

            <Card
              title="Recent Activity"
              action={
                <Link to="/app/alerts" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  View all <ArrowRight className="h-3 w-3" />
                </Link>
              }
            >
              {activityFeed.length === 0 ? (
                <EmptyState
                  icon={<Activity className="h-5 w-5" />}
                  title="No activity yet"
                  description="Payments, invoices and expenses will appear here."
                />
              ) : (
                <ul className="relative space-y-0.5 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-border">
                  {activityFeed.map((e, idx) => (
                    <li key={idx} className="relative flex items-start gap-3 py-2 pl-0">
                      <span className="relative z-10 mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full border-2 border-card bg-primary" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] text-foreground">{e.title}</div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span>{timeAgo(e.ts)}</span>
                          <span aria-hidden>·</span>
                          <span className="num">{e.detail}</span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* ── Recent invoices ── */}
          <Card
            title="Recent invoices"
            action={
              <Link to="/app/invoices" className="text-xs font-medium text-primary hover:underline">
                View all
              </Link>
            }
          >
            {invoices.length === 0 ? (
              <EmptyState
                icon={<FileText className="h-5 w-5" />}
                title="No invoices yet"
                description="Create your first invoice to start building the portfolio."
              />
            ) : (
              <div className="-mx-5 overflow-x-auto">
                <table className="table-premium w-full">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Debtor</th>
                      <th className="text-right">Amount</th>
                      <th>Due</th>
                      <th className="text-right">Short pay</th>
                      <th className="text-right">Late days</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.slice(0, 6).map((i: any) => (
                      <tr key={i.id}>
                        <td className="font-mono text-xs">{i.invoice_number}</td>
                        <td className="text-foreground">{debtorName(i.debtor_id)}</td>
                        <td className="num text-right font-medium">{fmtMoney(i.amount)}</td>
                        <td className="text-muted-foreground">{fmtDate(i.due_date)}</td>
                        <td
                          className={`num text-right ${Number(i.short_payment) > 0 ? "text-destructive" : "text-muted-foreground"}`}
                        >
                          {i.short_payment != null ? fmtMoney(Number(i.short_payment)) : "—"}
                        </td>
                        <td
                          className={`num text-right ${Number(i.late_days) > 0 ? "text-warning" : "text-muted-foreground"}`}
                        >
                          {i.late_days != null ? i.late_days : "—"}
                        </td>
                        <td>
                          <StatusPill status={i.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* ── Recent expenses + concentration ── */}
          <div className="grid gap-6 lg:grid-cols-5">
            <Card
              title="Recent expenses"
              className="lg:col-span-3"
              action={
                <Link to="/app/expenses" className="text-xs font-medium text-primary hover:underline">
                  View all
                </Link>
              }
            >
              {expenses.length === 0 ? (
                <EmptyState
                  icon={<Receipt className="h-5 w-5" />}
                  title="No expenses logged"
                  description="Recorded expenses will appear here."
                />
              ) : (
                <div className="-mx-5 overflow-x-auto">
                  <table className="table-premium w-full">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Category</th>
                        <th>Linked transaction</th>
                        <th>Description</th>
                        <th className="text-right">Docs</th>
                        <th className="text-right">Amount</th>
                        <th className="text-right" />
                      </tr>
                    </thead>
                    <tbody>
                      {expenses.slice(0, 5).map((e: any) => {
                        const link = e.invoice?.invoice_number
                          ? { kind: "Sale", num: e.invoice.invoice_number }
                          : e.purchase?.invoice_number
                            ? { kind: "Purchase", num: e.purchase.invoice_number }
                            : null;
                        const docCount = Array.isArray(e.documents) ? e.documents.length : 0;
                        return (
                          <tr key={e.id}>
                            <td>{fmtDate(e.expense_date)}</td>
                            <td className="capitalize">{e.category}</td>
                            <td>
                              {link ? (
                                <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background/40 px-2 py-0.5 text-xs">
                                  <Link2 className="h-3 w-3 text-primary" />
                                  <span className="text-muted-foreground">{link.kind}</span>
                                  <span className="font-mono">{link.num}</span>
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">Unlinked</span>
                              )}
                            </td>
                            <td className="text-muted-foreground">{e.description ?? "—"}</td>
                            <td className="text-right">
                              {docCount > 0 ? (
                                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                  <Paperclip className="h-3 w-3" />
                                  {docCount}
                                </span>
                              ) : (
                                <span className="text-[10px] text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="num text-right font-medium">{fmtMoney(e.amount)}</td>
                            <td className="text-right">
                              <button
                                onClick={() => setViewingExpense(e)}
                                className="rounded-md border border-border px-2 py-1 text-[10px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                              >
                                Details
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {(debtorsQ.data ?? []).length > 0 && (
              <Card
                title="Debtor concentration"
                className="lg:col-span-2"
                action={
                  <Link to="/app/debtors" className="text-xs font-medium text-primary hover:underline">
                    Manage
                  </Link>
                }
              >
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={(debtorsQ.data ?? []).slice(0, 8).map((d) => {
                        const exposure = invoices
                          .filter((i) => i.debtor_id === d.id && i.status !== "paid")
                          .reduce((s, i) => s + Number(i.amount), 0);
                        return { name: d.name.slice(0, 14), exposure };
                      })}
                      margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="name"
                        stroke="var(--color-muted-foreground)"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                      />
                      <YAxis
                        stroke="var(--color-muted-foreground)"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                      width={48}
                      tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
                      />
                      <Tooltip
                        cursor={{ fill: "var(--color-muted)" }}
                        contentStyle={{
                          background: "var(--color-popover)",
                          border: "1px solid var(--color-border)",
                          borderRadius: 10,
                          fontSize: 12,
                          boxShadow: "0 8px 24px rgba(17,24,39,0.1)",
                        }}
                        formatter={(v: number) => fmtMoney(v)}
                      />
                      <Bar dataKey="exposure" fill="var(--color-chart-1)" radius={[3, 3, 0, 0]} maxBarSize={32} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            )}
          </div>
        </div>
      )}

      {viewingExpense && (
        <ExpenseDetailModal expense={viewingExpense} onClose={() => setViewingExpense(null)} />
      )}
    </div>
  );
}

/* ── Dashboard building blocks ────────────────────────────── */

function SectionHeading({ children }: { children: string }) {
  return (
    <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {children}
    </h2>
  );
}

function KpiCard({
  label,
  value,
  context,
  trend,
  spark,
  sparkTone = "blue",
  healthy = false,
}: {
  label: string;
  value: string;
  context?: string;
  trend?: { value: number; caption: string };
  spark?: number[];
  sparkTone?: "blue" | "green" | "amber";
  healthy?: boolean;
}) {
  const up = (trend?.value ?? 0) >= 0;
  return (
    <div className="group rounded-xl border border-border bg-card p-5 transition-all duration-150 hover:-translate-y-px hover:border-border-strong hover:shadow-card-hover">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
          {label}
        </div>
        {healthy && <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />}
      </div>
      <div className="num mt-2 text-[28px] font-semibold leading-none tracking-tight text-foreground">
        {value}
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div>
          {trend && (
            <div
              className={`inline-flex items-center gap-1 text-xs font-semibold ${
                up ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
              }`}
            >
              {up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
              {Math.abs(trend.value).toFixed(1)}%
              <span className="font-normal text-muted-foreground">{trend.caption}</span>
            </div>
          )}
          {context && <div className="mt-1 text-xs text-muted-foreground">{context}</div>}
        </div>
        {spark && spark.length > 1 && <Sparkline data={spark} tone={sparkTone} />}
      </div>
    </div>
  );
}

function Sparkline({ data, tone }: { data: number[]; tone: "blue" | "green" | "amber" }) {
  const w = 72;
  const h = 26;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data
    .map((v, i) => `${((i / (data.length - 1)) * w).toFixed(1)},${(h - 3 - ((v - min) / span) * (h - 6)).toFixed(1)}`)
    .join(" ");
  const stroke =
    tone === "green" ? "#10b981" : tone === "amber" ? "#f59e0b" : "var(--color-chart-1)";
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0 opacity-80" aria-hidden>
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PerfCell({
  label,
  value,
  meta,
  tone = "neutral",
}: {
  label: string;
  value: string;
  meta?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const toneCls = {
    neutral: "text-foreground",
    good: "text-emerald-600 dark:text-emerald-400",
    warn: "text-amber-600 dark:text-amber-400",
    bad: "text-red-600 dark:text-red-400",
  }[tone];
  const barCls = {
    neutral: "bg-primary",
    good: "bg-emerald-500",
    warn: "bg-amber-500",
    bad: "bg-red-500",
  }[tone];
  return (
    <div className="relative bg-card p-4">
      <span className={`absolute left-0 top-3 h-6 w-[2.5px] rounded-r-full ${barCls} opacity-70`} />
      <div className="pl-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
          {label}
        </div>
        <div className={`num mt-1.5 text-lg font-semibold leading-none tracking-tight ${toneCls}`}>
          {value}
        </div>
        {meta && <div className="mt-1.5 truncate text-[11px] text-muted-foreground">{meta}</div>}
      </div>
    </div>
  );
}

function HealthRow({
  label,
  value,
  mono = false,
  alert = false,
  hint,
}: {
  label: string;
  value: string;
  mono?: boolean;
  alert?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-3 last:border-0 last:pb-0">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="text-right">
        <span
          className={`text-sm font-semibold ${mono ? "num" : ""} ${
            alert ? "text-red-600 dark:text-red-400" : "text-foreground"
          }`}
        >
          {value}
        </span>
        {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
      </dd>
    </div>
  );
}

function ExpenseDetailModal({ expense, onClose }: { expense: any; onClose: () => void }) {
  const link = expense.invoice?.invoice_number
    ? { kind: "Sales invoice", num: expense.invoice.invoice_number, to: "/app/invoices" as const }
    : expense.purchase?.invoice_number
      ? {
          kind: "Purchase invoice",
          num: expense.purchase.invoice_number,
          to: "/app/purchases" as const,
        }
      : null;
  const docs: DocMeta[] = Array.isArray(expense.documents) ? expense.documents : [];
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3.5">
          <h3 className="text-base font-semibold tracking-tight">Expense detail</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 p-5 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" value={fmtDate(expense.expense_date)} />
            <Field label="Category" value={String(expense.category)} />
            <Field label="Amount" value={fmtMoney(expense.amount)} />
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground">
                Linked transaction
              </div>
              <div className="mt-0.5">
                {link ? (
                  <Link
                    to={link.to}
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <Link2 className="h-3 w-3" />
                    <span className="text-muted-foreground">{link.kind}</span>
                    <span className="font-mono">{link.num}</span>
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Unlinked</span>
                )}
              </div>
            </div>
          </div>
          {expense.description && (
            <div>
              <div className="mb-1 text-xs uppercase tracking-widest text-muted-foreground">
                Description
              </div>
              <p className="text-muted-foreground">{expense.description}</p>
            </div>
          )}
          <div>
            <div className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
              Attachments
            </div>
            <DocumentList docs={docs} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5 capitalize">{value}</div>
    </div>
  );
}


