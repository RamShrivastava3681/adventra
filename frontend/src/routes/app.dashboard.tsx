import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Stat, Card, StatusPill, fmtMoney, fmtDate, daysBetween } from "@/components/ledger-ui";
import { Activity, Paperclip, X, Link2 } from "lucide-react";
import { DocumentList, type DocMeta } from "@/components/document-uploader";
import { DashboardSkeleton } from "@/components/skeletons";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Legend,
} from "recharts";

export const Route = createFileRoute("/app/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { isAdmin, isTreasury, user } = useAuth();
  const [viewingExpense, setViewingExpense] = useState<any | null>(null);

  const invoicesQ = useQuery({
    queryKey: ["invoices", isAdmin ? "all" : user?.id],
    queryFn: async () => {
      const data = await api.invoices.list();
      return data.reverse();
    },
  });

  const purchasesQ = useQuery({
    queryKey: ["purchase_invoices", isAdmin ? "all" : user?.id],
    queryFn: async () => {
      const data = await api.purchaseInvoices.list();
      return data.reverse();
    },
  });

  const expensesQ = useQuery({
    queryKey: ["expenses", isAdmin ? "all" : user?.id],
    queryFn: async () => {
      const data = await api.expenses.list();
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

  const isDashboardLoading = invoicesQ.isLoading || purchasesQ.isLoading || expensesQ.isLoading || alertsQ.isLoading || debtorsQ.isLoading;

  const invoices = invoicesQ.data ?? [];
  const purchases = purchasesQ.data ?? [];
  const expenses = expensesQ.data ?? [];

  const totalOutstanding = invoices
    .filter((i) => i.status !== "paid" && i.status !== "rejected")
    .reduce((s, i) => s + Number(i.amount), 0);
  const totalAdvanced = invoices
    .filter((i) => i.status === "advanced" || i.status === "paid")
    .reduce((s, i) => s + (Number(i.amount) * Number(i.advance_rate)) / 100, 0);
  const overdueCount = invoices.filter((i) => i.status === "overdue" || (i.due_date && i.status !== "paid" && daysBetween(i.due_date) > 0)).length;
  const collectionRate = invoices.length ? Math.round((invoices.filter((i) => i.status === "paid").length / invoices.length) * 100) : 0;
  const paidInvoices = invoices.filter((i: any) => i.status === "paid");
  const totalShortPayment = paidInvoices.reduce((s: number, i: any) => s + Number(i.short_payment ?? 0), 0);
  const lateInvoices = paidInvoices.filter((i: any) => Number(i.late_days ?? 0) > 0);
  const avgLateDays = lateInvoices.length
    ? Math.round(lateInvoices.reduce((s: number, i: any) => s + Number(i.late_days), 0) / lateInvoices.length)
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
    { current: 0, b1: 0, b2: 0, b3: 0, b4: 0 }
  );

  const eyebrow = isAdmin ? "Factor console" : isTreasury ? "Treasury desk" : "Trader portal";
  const titleText = isAdmin ? "Portfolio command" : isTreasury ? "Funding overview" : "Trading ledger";

  return (
    <div>
      <PageHeader
        eyebrow={eyebrow}
        title={titleText}
        description={
          isAdmin
            ? "Live receivables, advances, and risk across every client."
            : isTreasury
              ? "Approved invoices and outstanding advances."
              : "Sales, purchases, and income from your trading book."
        }
        actions={
          <Link to={isTreasury ? "/app/queue" : "/app/invoices"} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            {isTreasury ? "Open funding queue" : isAdmin ? "Open invoice queue" : "New sales invoice"}
          </Link>
        }
      />

      {isDashboardLoading ? (
        <DashboardSkeleton />
      ) : (
      <div className="space-y-8 p-6 md:p-10">
        {/* Income stats — hidden for treasury (focused on funding) */}
        {!isTreasury && (
          <div className="grid gap-4 md:grid-cols-4">
            <Stat label="Sales (gross)" value={fmtMoney(salesTotal)} delta={`${invoices.length} invoices`} />
            <Stat label="Cost of goods (purchases)" value={fmtMoney(purchaseTotal)} delta={`${purchases.length} supplier invoices`} />
            <Stat label="Gross income" value={fmtMoney(gross)} delta={`${marginPct.toFixed(1)}% margin`} tone={gross >= 0 ? "good" : "bad"} />
            <Stat label="Net income" value={fmtMoney(net)} delta={`After ${fmtMoney(expenseTotal)} expenses`} tone={net >= 0 ? "good" : "bad"} />
          </div>
        )}

        {/* Operational stats */}
        <div className="grid gap-4 md:grid-cols-4">
          <Stat label="Outstanding (AR)" value={fmtMoney(totalOutstanding)} delta={`${invoices.length} invoices`} />
          <Stat label="Advanced" value={fmtMoney(totalAdvanced)} delta="Across funded invoices" tone="good" />
          <Stat label="Overdue" value={String(overdueCount)} delta={overdueCount > 0 ? "Action required" : "All clean"} tone={overdueCount ? "bad" : "good"} />
          <Stat label="Collection rate" value={`${collectionRate}%`} delta="Lifetime" tone={collectionRate >= 90 ? "good" : "warn"} />
        </div>

        {/* Settlement quality */}
        <div className="grid gap-4 md:grid-cols-3">
          <Stat label="Short payments" value={fmtMoney(totalShortPayment)} delta={`${paidInvoices.filter((i: any) => Number(i.short_payment ?? 0) > 0).length} invoices short paid`} tone={totalShortPayment > 0 ? "bad" : "good"} />
          <Stat label="Avg late days" value={String(avgLateDays)} delta={`${lateInvoices.length} late settlements`} tone={avgLateDays > 0 ? "warn" : "good"} />
          <Stat label="On-time settlements" value={String(paidInvoices.length - lateInvoices.length)} delta={`of ${paidInvoices.length} closed`} tone="good" />
        </div>

        {/* Income trend */}
        {!isTreasury && incomeTrend.length > 0 && (
          <Card title="Gross vs net income" action={<span className="text-xs text-muted-foreground">Last 8 months</span>}>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={incomeTrend}>
                  <defs>
                    <linearGradient id="ig" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#00B8FF" stopOpacity={0.15} />
                      <stop offset="100%" stopColor="#00B8FF" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="ng" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#0066FF" stopOpacity={0.12} />
                      <stop offset="100%" stopColor="#0066FF" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month" stroke="#94A3B8" fontSize={11} tickLine={false} />
                  <YAxis stroke="#94A3B8" fontSize={11} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 12, fontSize: 12, boxShadow: "0 4px 20px rgba(15,23,42,0.06)" }} formatter={(v: number) => fmtMoney(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="gross" name="Gross" stroke="#00B8FF" strokeWidth={2} fill="url(#ig)" />
                  <Area type="monotone" dataKey="net" name="Net" stroke="#0066FF" strokeWidth={2} fill="url(#ng)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}

        {/* Aging */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Aging waterfall" className="lg:col-span-2">
            <div className="space-y-3">
              {[
                { label: "Current", val: aging.current, tone: "bg-success" },
                { label: "1–30 days", val: aging.b1, tone: "bg-primary" },
                { label: "31–60 days", val: aging.b2, tone: "bg-warning" },
                { label: "61–90 days", val: aging.b3, tone: "bg-warning" },
                { label: "90+ days", val: aging.b4, tone: "bg-destructive" },
              ].map((b) => {
                const total = Object.values(aging).reduce((a, x) => a + x, 0) || 1;
                const pct = (b.val / total) * 100;
                return (
                  <div key={b.label}>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{b.label}</span>
                      <span className="num">{fmtMoney(b.val)}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className={`h-full ${b.tone}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card title="Alerts" action={<Link to="/app/alerts" className="text-xs text-primary">All →</Link>}>
            {(alertsQ.data ?? []).length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground"><Activity className="mx-auto mb-2 h-5 w-5" />No alerts</div>
            ) : (
              <ul className="space-y-2">
                {(alertsQ.data ?? []).map((a) => (
                  <li key={a.id} className="rounded-md border border-border bg-background/40 p-3">
                    <div className="flex items-start gap-2">
                      <span className={`mt-1.5 h-2 w-2 rounded-full ${
                        a.severity === "critical" ? "bg-destructive" : a.severity === "warning" ? "bg-warning" : "bg-primary"
                      }`} />
                      <div className="flex-1">
                        <div className="text-sm">{a.message}</div>
                        <div className="mt-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">{fmtDate(a.created_at)} · {a.type}</div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Recent invoices */}
        <Card title="Recent invoices" action={<Link to="/app/invoices" className="text-xs text-primary">View all →</Link>}>
          {invoices.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No invoices yet.</div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Invoice</th>
                    <th className="px-5 py-2 text-left font-normal">Debtor</th>
                    <th className="px-5 py-2 text-right font-normal">Amount</th>
                    <th className="px-5 py-2 text-left font-normal">Due</th>
                    <th className="px-5 py-2 text-right font-normal">Short pay</th>
                    <th className="px-5 py-2 text-right font-normal">Late days</th>
                    <th className="px-5 py-2 text-left font-normal">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.slice(0, 6).map((i: any) => (
                    <tr key={i.id} className="border-b border-border/60 hover:bg-muted/30">
                      <td className="px-5 py-3 font-mono text-xs">{i.invoice_number}</td>
                      <td className="px-5 py-3">{i.debtor?.name ?? "—"}</td>
                      <td className="px-5 py-3 text-right num">{fmtMoney(i.amount)}</td>
                      <td className="px-5 py-3 text-muted-foreground">{fmtDate(i.due_date)}</td>
                      <td className={`px-5 py-3 text-right num ${Number(i.short_payment) > 0 ? "text-destructive" : "text-muted-foreground"}`}>{i.short_payment != null ? fmtMoney(Number(i.short_payment)) : "—"}</td>
                      <td className={`px-5 py-3 text-right num ${Number(i.late_days) > 0 ? "text-warning" : "text-muted-foreground"}`}>{i.late_days != null ? i.late_days : "—"}</td>
                      <td className="px-5 py-3"><StatusPill status={i.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Recent expenses */}
        {!isTreasury && (
          <Card title="Recent expenses" action={<Link to="/app/expenses" className="text-xs text-primary">View all →</Link>}>
            {expenses.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">No expenses logged.</div>
            ) : (
              <div className="-mx-5 overflow-x-auto">
                <table className="table-premium w-full text-sm">
                  <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-5 py-2 text-left font-normal">Date</th>
                      <th className="px-5 py-2 text-left font-normal">Category</th>
                      <th className="px-5 py-2 text-left font-normal">Linked transaction</th>
                      <th className="px-5 py-2 text-left font-normal">Description</th>
                      <th className="px-5 py-2 text-right font-normal">Docs</th>
                      <th className="px-5 py-2 text-right font-normal">Amount</th>
                      <th className="px-5 py-2 text-right font-normal" />
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.slice(0, 6).map((e: any) => {
                      const link = e.invoice?.invoice_number
                        ? { kind: "Sale", num: e.invoice.invoice_number }
                        : e.purchase?.invoice_number
                          ? { kind: "Purchase", num: e.purchase.invoice_number }
                          : null;
                      const docCount = Array.isArray(e.documents) ? e.documents.length : 0;
                      return (
                        <tr key={e.id} className="border-b border-border/60 hover:bg-muted/30">
                          <td className="px-5 py-3">{fmtDate(e.expense_date)}</td>
                          <td className="px-5 py-3 capitalize">{e.category}</td>
                          <td className="px-5 py-3">
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
                          <td className="px-5 py-3 text-muted-foreground">{e.description ?? "—"}</td>
                          <td className="px-5 py-3 text-right">
                            {docCount > 0 ? (
                              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                <Paperclip className="h-3 w-3" />{docCount}
                              </span>
                            ) : <span className="text-[10px] text-muted-foreground">—</span>}
                          </td>
                          <td className="px-5 py-3 text-right num">{fmtMoney(e.amount)}</td>
                          <td className="px-5 py-3 text-right">
                            <button
                              onClick={() => setViewingExpense(e)}
                              className="rounded-md border border-border px-2 py-1 text-[10px] uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary"
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
        )}


        {/* Debtor concentration for admin */}
        {isAdmin && (debtorsQ.data ?? []).length > 0 && (
          <Card title="Debtor concentration" action={<Link to="/app/debtors" className="text-xs text-primary">Manage →</Link>}>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={(debtorsQ.data ?? []).slice(0, 8).map((d) => {
                  const exposure = invoices.filter((i) => i.debtor_id === d.id && i.status !== "paid").reduce((s, i) => s + Number(i.amount), 0);
                  return { name: d.name.slice(0, 14), exposure, limit: Number(d.credit_limit) };
                })}>
                  <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" stroke="#94A3B8" fontSize={11} tickLine={false} />
                  <YAxis stroke="#94A3B8" fontSize={11} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 12, fontSize: 12, boxShadow: "0 4px 20px rgba(15,23,42,0.06)" }} formatter={(v: number) => fmtMoney(v)} />
                  <Bar dataKey="exposure" fill="#00B8FF" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="limit" fill="#94A3B8" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}
      </div>
      )}

      {viewingExpense && (
        <ExpenseDetailModal expense={viewingExpense} onClose={() => setViewingExpense(null)} />
      )}
    </div>
  );
}

function ExpenseDetailModal({ expense, onClose }: { expense: any; onClose: () => void }) {
  const link = expense.invoice?.invoice_number
    ? { kind: "Sales invoice", num: expense.invoice.invoice_number, to: "/app/invoices" as const }
    : expense.purchase?.invoice_number
      ? { kind: "Purchase invoice", num: expense.purchase.invoice_number, to: "/app/purchases" as const }
      : null;
  const docs: DocMeta[] = Array.isArray(expense.documents) ? expense.documents : [];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="font-display text-lg">Expense detail</h3>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 p-5 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" value={fmtDate(expense.expense_date)} />
            <Field label="Category" value={String(expense.category)} />
            <Field label="Amount" value={fmtMoney(expense.amount)} />
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Linked transaction</div>
              <div className="mt-0.5">
                {link ? (
                  <Link to={link.to} className="inline-flex items-center gap-1 text-primary hover:underline">
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
              <div className="mb-1 text-xs uppercase tracking-widest text-muted-foreground">Description</div>
              <p className="text-muted-foreground">{expense.description}</p>
            </div>
          )}
          <div>
            <div className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Attachments</div>
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
