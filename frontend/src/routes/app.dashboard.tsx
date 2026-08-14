import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import api from "@/lib/api-client";
import {
  PageHeader,
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
  LayoutDashboard,
  AlertTriangle,
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

function Dashboard() {
  const [viewingExpense, setViewingExpense] = useState<any | null>(null);

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
  const collectionRate = invoices.length
    ? Math.round((invoices.filter((i) => i.status === "paid").length / invoices.length) * 100)
    : 0;
  const paidInvoices = invoices.filter((i: any) => i.status === "paid");
  const totalShortPayment = paidInvoices.reduce(
    (s: number, i: any) => s + Number(i.short_payment ?? 0),
    0,
  );
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

  // Monthly trend
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
      month: m.slice(5),
      gross: Math.round(v.sales - v.purchases),
      net: Math.round(v.sales - v.purchases - v.expenses),
    }));

  // Aging buckets
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

  return (
    <div>
      <PageHeader
        eyebrow="Portfolio"
        title="Portfolio overview"
        description="Track receivables, advances, settlements and portfolio performance across your clients."
        icon={<LayoutDashboard className="h-5 w-5" />}
        actions={
          <Link to="/app/queue" className="btn-primary">
            Open funding queue
          </Link>
        }
      />

      {isDashboardLoading ? (
        <DashboardSkeleton />
      ) : (
        <div className="mx-auto max-w-[1440px] space-y-10 px-6 py-8 md:px-10">
          {/* ── Primary portfolio metrics ── */}
          <section>
            <SectionHeading>Portfolio value</SectionHeading>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
              <PrimaryMetric
                label="Gross sales"
                value={fmtMoney(salesTotal)}
                meta={`${invoices.length} invoices`}
              />
              <PrimaryMetric
                label="Outstanding AR"
                value={fmtMoney(totalOutstanding)}
                meta={`${invoices.filter((i) => i.status !== "paid" && i.status !== "rejected").length} open invoices`}
              />
              <PrimaryMetric
                label="Advanced"
                value={fmtMoney(totalAdvanced)}
                meta="Across funded invoices"
                accent
              />
              <PrimaryMetric
                label="Collection rate"
                value={`${collectionRate}%`}
                meta="Lifetime, by count"
                accent={collectionRate >= 90}
              />
            </div>
          </section>

          {/* ── Portfolio performance chart ── */}
          {incomeTrend.length > 0 && (
            <Card
              title="Portfolio performance"
              action={<span className="text-xs text-muted-foreground">Gross vs net · last 8 months</span>}
            >
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={incomeTrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="ig" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" style={{ stopColor: "var(--color-chart-1)" }} stopOpacity={0.14} />
                        <stop offset="100%" style={{ stopColor: "var(--color-chart-1)" }} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="ng" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" style={{ stopColor: "var(--color-chart-2)" }} stopOpacity={0.1} />
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
                      tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
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
                      formatter={(v: number) => fmtMoney(v)}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                    <Area
                      type="monotone"
                      dataKey="gross"
                      name="Gross"
                      stroke="var(--color-chart-1)"
                      strokeWidth={2}
                      fill="url(#ig)"
                    />
                    <Area
                      type="monotone"
                      dataKey="net"
                      name="Net"
                      stroke="var(--color-chart-2)"
                      strokeWidth={2}
                      fill="url(#ng)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          {/* ── Secondary performance band ── */}
          <section>
            <SectionHeading>Performance</SectionHeading>
            <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-border md:grid-cols-3 xl:grid-cols-6">
              <SecondaryMetric
                label="Cost of goods"
                value={fmtMoney(purchaseTotal)}
                meta={`${purchases.length} supplier invoices`}
              />
              <SecondaryMetric
                label="Gross income"
                value={fmtMoney(gross)}
                meta={`${marginPct.toFixed(1)}% margin`}
                tone={gross >= 0 ? "good" : "bad"}
              />
              <SecondaryMetric
                label="Net income"
                value={fmtMoney(net)}
                meta={`After ${fmtMoney(expenseTotal)} expenses`}
                tone={net >= 0 ? "good" : "bad"}
              />
              <SecondaryMetric
                label="Overdue"
                value={String(overdueCount)}
                meta={overdueCount > 0 ? "Action required" : "All clean"}
                tone={overdueCount > 0 ? "bad" : "good"}
              />
              <SecondaryMetric
                label="Short payments"
                value={fmtMoney(totalShortPayment)}
                meta={`${paidInvoices.filter((i: any) => Number(i.short_payment ?? 0) > 0).length} invoices short paid`}
                tone={totalShortPayment > 0 ? "bad" : "good"}
              />
              <SecondaryMetric
                label="Avg late days"
                value={String(avgLateDays)}
                meta={`${lateInvoices.length} late · ${paidInvoices.length - lateInvoices.length} on time`}
                tone={avgLateDays > 0 ? "warn" : "good"}
              />
            </div>
          </section>

          {/* ── Aging + Alerts ── */}
          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="Aging waterfall" className="lg:col-span-2">
              <div className="space-y-4">
                {[
                  { label: "Current", val: aging.current, bar: "bg-[var(--color-chart-4)]" },
                  { label: "1–30 days", val: aging.b1, bar: "bg-[var(--color-chart-2)]" },
                  { label: "31–60 days", val: aging.b2, bar: "bg-[var(--color-chart-1)]" },
                  { label: "61–90 days", val: aging.b3, bar: "bg-[var(--color-chart-3)]" },
                  { label: "90+ days", val: aging.b4, bar: "bg-[var(--color-chart-5)]" },
                ].map((b) => {
                  const total = (Object.values(aging) as number[]).reduce((a, x) => a + x, 0) || 1;
                  const pct = (b.val / total) * 100;
                  return (
                    <div key={b.label}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{b.label}</span>
                        <span className="num font-medium text-foreground">{fmtMoney(b.val)}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className={`h-full ${b.bar}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
                <div className="flex items-center gap-1.5 pt-1 text-[11px] text-muted-foreground">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Buckets beyond 60 days may need follow-up with the debtor.
                </div>
              </div>
            </Card>

            <Card
              title="Alerts"
              action={
                <Link to="/app/alerts" className="text-xs font-medium text-primary hover:underline">
                  View all
                </Link>
              }
            >
              {(alertsQ.data ?? []).length === 0 ? (
                <EmptyState
                  icon={<Activity className="h-5 w-5" />}
                  title="No alerts"
                  description="You're all caught up — new alerts will surface here."
                />
              ) : (
                <ul className="space-y-1.5">
                  {(alertsQ.data ?? []).map((a) => (
                    <li
                      key={a.id}
                      className="rounded-lg border border-border bg-background/40 px-3 py-2.5 transition-colors hover:border-border-strong"
                    >
                      <div className="flex items-start gap-2.5">
                        <span
                          className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                            a.severity === "critical"
                              ? "bg-destructive"
                              : a.severity === "warning"
                                ? "bg-warning"
                                : "bg-primary"
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] leading-snug">{a.message}</div>
                          <div className="mt-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                            {fmtDate(a.created_at)} · {a.type}
                          </div>
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
                        tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
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

/* ── Dashboard metric building blocks ────────────────────────────── */

function SectionHeading({ children }: { children: string }) {
  return (
    <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {children}
    </h2>
  );
}

function PrimaryMetric({
  label,
  value,
  meta,
  accent = false,
}: {
  label: string;
  value: string;
  meta?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
        {label}
      </div>
      <div
        className={`num mt-2 text-[30px] font-semibold leading-none tracking-tight ${
          accent ? "text-primary" : "text-foreground"
        }`}
      >
        {value}
      </div>
      {meta && <div className="mt-2 text-xs text-muted-foreground">{meta}</div>}
    </div>
  );
}

function SecondaryMetric({
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
    good: "text-primary",
    warn: "text-warning",
    bad: "text-destructive",
  }[tone];
  return (
    <div className="bg-card p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
        {label}
      </div>
      <div className={`num mt-1.5 text-lg font-semibold leading-none tracking-tight ${toneCls}`}>
        {value}
      </div>
      {meta && <div className="mt-1.5 truncate text-[11px] text-muted-foreground">{meta}</div>}
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
        className="w-full max-w-lg rounded-xl border border-border bg-card shadow-modal"
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
