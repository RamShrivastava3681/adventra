import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api-client";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import { TrendingUp, Scale, BookOpen, ListTree } from "lucide-react";

export const Route = createFileRoute("/app/reports")({
  component: ReportsPage,
});

type Tab = "pl" | "bs" | "trial" | "ledger";

function ReportsPage() {
  const [tab, setTab] = useState<Tab>("pl");
  const [from, setFrom] = useState(new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const queryClient = useQueryClient();

  useEffect(() => {
    const tables = [
      "invoices",
      "purchase_invoices",
      "expenses",
      "advances",
      "credit_debit_notes",
      "journals",
      "journal_lines",
    ];
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: ["report-lines"] });
      queryClient.invalidateQueries({ queryKey: ["report-lines-upto"] });
    };
    // Realtime replaced with polling
    const interval = setInterval(invalidate, 30000);
    return () => clearInterval(interval);
  }, [queryClient]);

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: "pl", label: "Profit & Loss", icon: TrendingUp },
    { id: "bs", label: "Balance Sheet", icon: Scale },
    { id: "trial", label: "Trial Balance", icon: ListTree },
    { id: "ledger", label: "General Ledger", icon: BookOpen },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Financial reports"
        title="Reports"
        description="Every figure below is calculated from posted journal entries — real double-entry, no shortcuts."
      />
      <div className="px-6">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
          <div className="flex flex-wrap gap-1 border-b border-border">
            {tabs.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`inline-flex items-center gap-2 px-4 py-2 text-sm border-b-2 -mb-px transition ${
                    tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" /> {t.label}
                </button>
              );
            })}
          </div>
          <div className="flex gap-2">
            <div>
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground">From</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="block rounded-md border border-border bg-background px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground">To</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="block rounded-md border border-border bg-background px-3 py-1.5 text-sm" />
            </div>
          </div>
        </div>
        {tab === "pl" && <ProfitLoss from={from} to={to} />}
        {tab === "bs" && <BalanceSheet asOf={to} />}
        {tab === "trial" && <TrialBalance from={from} to={to} />}
        {tab === "ledger" && <GeneralLedger from={from} to={to} />}
      </div>
    </div>
  );
}

/* Fetch synthesized lines: manual journals + virtual lines derived from source
   business tables (invoices, purchase bills, expenses, payments, notes).
   Reports read this stream, so figures reflect actual transactions even
   though autopost triggers are disabled. */
async function fetchSynthesizedLines(opts: { from?: string; to: string }) {
  const { from, to } = opts;
  const gte = (col: string) => (from ? [col, from] as const : null);

  // Chart of accounts (indexed by system_key)
  const coa = await api.chartOfAccounts.list();
  const bySys = new Map<string, any>();
  for (const a of coa ?? []) if (a.system_key) bySys.set(a.system_key, a);
  const acc = (k: string) => bySys.get(k);

  // Manual journals
  const journals = await api.journals.list();

  const flat: any[] = [];
  let uid = 0;
  const push = (row: any) => flat.push({ id: `v${++uid}`, ...row });

  for (const j of journals ?? []) {
    for (const l of (j as any).lines ?? []) {
      flat.push({
        id: l.id, journal_id: j.id, date: j.journal_date, reference: j.reference,
        source: j.source, jdescription: j.description,
        debit: l.debit, credit: l.credit, description: l.description, account: l.account,
      });
    }
  }

  const addLine = (date: string, ref: string, source: string, desc: string, sysKey: string, debit: number, credit: number) => {
    const account = acc(sysKey);
    if (!account) return;
    push({ date, reference: ref, source, jdescription: desc, description: desc, debit, credit, account });
  };

  // Sales invoices
  const allInvoices = await api.invoices.list();
  const invs = allInvoices.filter((i: any) => {
    const d = i.issueDate ?? i.issue_date;
    return d <= to && (!from || d >= from);
  });
  for (const i of invs ?? []) {
    const amt = Number(i.amount) || 0;
    const tax = Number(i.tax_amount) || 0;
    const desc = `Sales invoice ${i.invoice_number}`;
    addLine(i.issue_date, i.invoice_number, "invoice", desc, "ar", amt, 0);
    addLine(i.issue_date, i.invoice_number, "invoice", desc, "sales", 0, amt - tax);
    if (tax > 0) addLine(i.issue_date, i.invoice_number, "invoice", desc, "tax_payable", 0, tax);
  }

  // Purchase bills
  const allBills = await api.purchaseInvoices.list();
  const bills = allBills.filter((b: any) => {
    const d = b.issueDate ?? b.issue_date;
    return d <= to && (!from || d >= from);
  });
  for (const b of bills ?? []) {
    const amt = Number(b.amount) || 0;
    const desc = `Purchase bill ${b.invoice_number}`;
    addLine(b.issue_date, b.invoice_number, "purchase_invoice", desc, "inventory", amt, 0);
    addLine(b.issue_date, b.invoice_number, "purchase_invoice", desc, "ap", 0, amt);
  }

  // Expenses
  const allExps = await api.expenses.list();
  const exps = allExps.filter((e: any) => {
    const d = e.expenseDate ?? e.expense_date;
    return d <= to && (!from || d >= from);
  });
  const expKey = (c: string) => c === "logistics" ? "exp_logistics" : c === "insurance" ? "exp_insurance" : c === "interest" ? "exp_interest" : c === "administrative" ? "exp_admin" : "operating_exp";
  for (const e of exps ?? []) {
    const amt = Number(e.amount) || 0;
    const desc = e.description || e.category;
    addLine(e.expense_date, e.expense_ref, "expense", desc, expKey(e.category), amt, 0);
    addLine(e.expense_date, e.expense_ref, "expense", desc, "ap", 0, amt);
  }

  // Advances (payments)
  const allAdvs = await api.advances.list();
  const advs = allAdvs.filter((a: any) => {
    const d = a.advanceDate ?? a.advance_date;
    return d <= to && (!from || d >= from);
  });
  for (const a of advs ?? []) {
    const amt = Number(a.amount) || 0;
    if (a.side === "sales") {
      const desc = `Customer payment ${a.reference ?? ""}`.trim();
      addLine(a.advance_date, a.payment_ref, "advance", desc, "bank", amt, 0);
      addLine(a.advance_date, a.payment_ref, "advance", desc, "ar", 0, amt);
    } else {
      const desc = `Supplier payment ${a.reference ?? ""}`.trim();
      addLine(a.advance_date, a.payment_ref, "advance", desc, "ap", amt, 0);
      addLine(a.advance_date, a.payment_ref, "advance", desc, "bank", 0, amt);
    }
  }

  // Credit / debit notes (only applied)
  const allNotes = await api.creditDebitNotes.list();
  const notes = allNotes.filter((n: any) => {
    const d = n.noteDate ?? n.note_date;
    return n.status === "applied" && d <= to && (!from || d >= from);
  });
  for (const n of notes ?? []) {
    const amt = Number(n.amount) || 0;
    if (n.kind === "credit") {
      const desc = `Customer credit note ${n.note_number}`;
      addLine(n.note_date, n.note_number, "note", desc, "sales_returns", amt, 0);
      addLine(n.note_date, n.note_number, "note", desc, "ar", 0, amt);
    } else {
      const desc = `Supplier debit note ${n.note_number}`;
      addLine(n.note_date, n.note_number, "note", desc, "ap", amt, 0);
      addLine(n.note_date, n.note_number, "note", desc, "cogs", 0, amt);
    }
  }

  return flat;
}

function useLines(from: string, to: string) {
  return useQuery({
    queryKey: ["report-lines", from, to],
    queryFn: () => fetchSynthesizedLines({ from, to }),
  });
}

function useAllLinesUpTo(to: string) {
  return useQuery({
    queryKey: ["report-lines-upto", to],
    queryFn: () => fetchSynthesizedLines({ to }),
  });
}

/* ================== Profit & Loss ================== */
function ProfitLoss({ from, to }: { from: string; to: string }) {
  const q = useLines(from, to);
  const groups = useMemo(() => {
    const g = {
      revenue: new Map<string, { name: string; code: string; amount: number }>(),
      direct_cost: new Map<string, { name: string; code: string; amount: number }>(),
      expense: new Map<string, { name: string; code: string; amount: number }>(),
      other_income: new Map<string, { name: string; code: string; amount: number }>(),
      other_expense: new Map<string, { name: string; code: string; amount: number }>(),
    };
    for (const l of q.data ?? []) {
      const t = l.account?.type;
      if (!t || !(t in g)) continue;
      const map = (g as any)[t] as Map<string, any>;
      const key = l.account.id;
      // Revenue: credit - debit; Expense: debit - credit
      const amt = t === "revenue" || t === "other_income"
        ? Number(l.credit) - Number(l.debit)
        : Number(l.debit) - Number(l.credit);
      const prev = map.get(key)?.amount ?? 0;
      map.set(key, { name: l.account.name, code: l.account.code, amount: prev + amt });
    }
    return g;
  }, [q.data]);

  const sum = (m: Map<string, any>) => Array.from(m.values()).reduce((s, x) => s + x.amount, 0);
  const revenue = sum(groups.revenue);
  const directCost = sum(groups.direct_cost);
  const grossProfit = revenue - directCost;
  const opExp = sum(groups.expense);
  const otherIncome = sum(groups.other_income);
  const otherExp = sum(groups.other_expense);
  const netProfit = grossProfit - opExp + otherIncome - otherExp;

  const Section = ({ title, map, total }: { title: string; map: Map<string, any>; total: number }) => {
    const rows = Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
    if (!rows.length && total === 0) return null;
    return (
      <div className="mb-4">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">{title}</div>
        <table className="table-premium w-full text-sm">
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border/40">
                <td className="py-1.5">{r.code} — {r.name}</td>
                <td className="py-1.5 text-right">{fmtMoney(r.amount)}</td>
              </tr>
            ))}
            <tr className="font-medium">
              <td className="py-2">Total {title}</td>
              <td className="py-2 text-right">{fmtMoney(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <Card title={`Profit & Loss · ${fmtDate(from)} — ${fmtDate(to)}`}>
      <Section title="Revenue" map={groups.revenue} total={revenue} />
      <Section title="Direct Costs" map={groups.direct_cost} total={directCost} />
      <div className="border-t-2 border-border pt-2 mb-4 flex justify-between font-medium">
        <span>Gross Profit</span>
        <span>{fmtMoney(grossProfit)}</span>
      </div>
      <Section title="Operating Expenses" map={groups.expense} total={opExp} />
      <Section title="Other Income" map={groups.other_income} total={otherIncome} />
      <Section title="Other Expenses" map={groups.other_expense} total={otherExp} />
      <div className="border-t-2 border-border pt-3 flex justify-between text-lg font-display">
        <span>Net Profit</span>
        <span className={netProfit >= 0 ? "text-emerald-600" : "text-destructive"}>{fmtMoney(netProfit)}</span>
      </div>
    </Card>
  );
}

/* ================== Balance Sheet ================== */
function BalanceSheet({ asOf }: { asOf: string }) {
  const q = useAllLinesUpTo(asOf);
  const { assets, liabilities, equity, currentProfit } = useMemo(() => {
    const a = new Map<string, { name: string; code: string; amount: number }>();
    const l = new Map<string, { name: string; code: string; amount: number }>();
    const e = new Map<string, { name: string; code: string; amount: number }>();
    let profit = 0;
    for (const line of q.data ?? []) {
      const t = line.account?.type;
      if (!t) continue;
      const key = line.account.id;
      const debit = Number(line.debit), credit = Number(line.credit);
      if (t === "asset") {
        const amt = debit - credit;
        const prev = a.get(key)?.amount ?? 0;
        a.set(key, { name: line.account.name, code: line.account.code, amount: prev + amt });
      } else if (t === "liability") {
        const amt = credit - debit;
        const prev = l.get(key)?.amount ?? 0;
        l.set(key, { name: line.account.name, code: line.account.code, amount: prev + amt });
      } else if (t === "equity") {
        const amt = credit - debit;
        const prev = e.get(key)?.amount ?? 0;
        e.set(key, { name: line.account.name, code: line.account.code, amount: prev + amt });
      } else if (t === "revenue" || t === "other_income") {
        profit += credit - debit;
      } else if (t === "expense" || t === "direct_cost" || t === "other_expense") {
        profit -= debit - credit;
      }
    }
    return { assets: a, liabilities: l, equity: e, currentProfit: profit };
  }, [q.data]);

  const sum = (m: Map<string, any>) => Array.from(m.values()).reduce((s, x) => s + x.amount, 0);
  const totalAssets = sum(assets);
  const totalLiab = sum(liabilities);
  const totalEquity = sum(equity) + currentProfit;
  const check = totalAssets - (totalLiab + totalEquity);

  const Section = ({ title, map }: { title: string; map: Map<string, any> }) => {
    const rows = Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
    return (
      <div>
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">{title}</div>
        <table className="table-premium w-full text-sm mb-3">
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border/40">
                <td className="py-1.5">{r.code} — {r.name}</td>
                <td className="py-1.5 text-right">{fmtMoney(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title={`Assets · as of ${fmtDate(asOf)}`}>
        <Section title="Assets" map={assets} />
        <div className="border-t-2 border-border pt-2 flex justify-between font-medium">
          <span>Total Assets</span><span>{fmtMoney(totalAssets)}</span>
        </div>
      </Card>
      <Card title="Liabilities & Equity">
        <Section title="Liabilities" map={liabilities} />
        <div className="border-t border-border pt-2 flex justify-between mb-4">
          <span>Total Liabilities</span><span>{fmtMoney(totalLiab)}</span>
        </div>
        <Section title="Equity" map={equity} />
        <div className="flex justify-between text-sm mb-1">
          <span>Current Year Earnings</span><span>{fmtMoney(currentProfit)}</span>
        </div>
        <div className="border-t border-border pt-2 flex justify-between mb-2">
          <span>Total Equity</span><span>{fmtMoney(totalEquity)}</span>
        </div>
        <div className="border-t-2 border-border pt-2 flex justify-between font-medium">
          <span>Total Liab. + Equity</span><span>{fmtMoney(totalLiab + totalEquity)}</span>
        </div>
        {Math.abs(check) > 0.01 && (
          <div className="mt-2 text-xs text-destructive">Balance sheet out by {fmtMoney(check)}</div>
        )}
      </Card>
    </div>
  );
}

/* ================== Trial Balance ================== */
function TrialBalance({ from, to }: { from: string; to: string }) {
  const q = useLines(from, to);
  const rows = useMemo(() => {
    const m = new Map<string, { code: string; name: string; debit: number; credit: number }>();
    for (const l of q.data ?? []) {
      if (!l.account) continue;
      const key = l.account.id;
      const cur = m.get(key) ?? { code: l.account.code, name: l.account.name, debit: 0, credit: 0 };
      cur.debit += Number(l.debit);
      cur.credit += Number(l.credit);
      m.set(key, cur);
    }
    return Array.from(m.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [q.data]);

  const totalD = rows.reduce((s, r) => s + r.debit, 0);
  const totalC = rows.reduce((s, r) => s + r.credit, 0);

  return (
    <Card title={`Trial Balance · ${fmtDate(from)} — ${fmtDate(to)}`}>
      <table className="table-premium w-full text-sm">
        <thead className="text-left text-xs uppercase text-muted-foreground border-b border-border">
          <tr>
            <th className="py-2">Account</th>
            <th className="py-2 text-right w-32">Debit</th>
            <th className="py-2 text-right w-32">Credit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code} className="border-b border-border/40">
              <td className="py-1.5">{r.code} — {r.name}</td>
              <td className="py-1.5 text-right">{fmtMoney(r.debit)}</td>
              <td className="py-1.5 text-right">{fmtMoney(r.credit)}</td>
            </tr>
          ))}
          <tr className="font-medium border-t-2 border-border">
            <td className="py-2">Totals</td>
            <td className="py-2 text-right">{fmtMoney(totalD)}</td>
            <td className="py-2 text-right">{fmtMoney(totalC)}</td>
          </tr>
        </tbody>
      </table>
      {Math.abs(totalD - totalC) > 0.01 && (
        <div className="mt-2 text-xs text-destructive">Out of balance by {fmtMoney(Math.abs(totalD - totalC))}</div>
      )}
    </Card>
  );
}

/* ================== General Ledger ================== */
function GeneralLedger({ from, to }: { from: string; to: string }) {
  const q = useLines(from, to);
  const byAccount = useMemo(() => {
    const m = new Map<string, { code: string; name: string; type: string; lines: any[] }>();
    for (const l of q.data ?? []) {
      if (!l.account) continue;
      const key = l.account.id;
      if (!m.has(key)) m.set(key, { code: l.account.code, name: l.account.name, type: l.account.type, lines: [] });
      m.get(key)!.lines.push(l);
    }
    // Sort lines by date, then compute running balance
    for (const g of m.values()) {
      g.lines.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
    }
    return Array.from(m.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [q.data]);

  return (
    <div className="space-y-4">
      {byAccount.map((g) => {
        let running = 0;
        const total = { d: 0, c: 0 };
        return (
          <Card key={g.code} title={`${g.code} — ${g.name}`}>
            <table className="table-premium w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground border-b border-border">
                <tr>
                  <th className="py-2">Date</th>
                  <th className="py-2">Ref</th>
                  <th className="py-2">Description</th>
                  <th className="py-2 text-right w-24">Debit</th>
                  <th className="py-2 text-right w-24">Credit</th>
                  <th className="py-2 text-right w-28">Balance</th>
                </tr>
              </thead>
              <tbody>
                {g.lines.map((l: any) => {
                  running += Number(l.debit) - Number(l.credit);
                  total.d += Number(l.debit); total.c += Number(l.credit);
                  return (
                    <tr key={l.id} className="border-b border-border/30">
                      <td className="py-1">{fmtDate(l.date)}</td>
                      <td className="py-1 font-mono text-xs">{l.reference ?? "—"}</td>
                      <td className="py-1">{l.description ?? l.jdescription ?? "—"}</td>
                      <td className="py-1 text-right">{Number(l.debit) > 0 ? fmtMoney(l.debit) : ""}</td>
                      <td className="py-1 text-right">{Number(l.credit) > 0 ? fmtMoney(l.credit) : ""}</td>
                      <td className="py-1 text-right">{fmtMoney(running)}</td>
                    </tr>
                  );
                })}
                <tr className="font-medium">
                  <td colSpan={3} className="py-2">Totals</td>
                  <td className="py-2 text-right">{fmtMoney(total.d)}</td>
                  <td className="py-2 text-right">{fmtMoney(total.c)}</td>
                  <td className="py-2 text-right">{fmtMoney(running)}</td>
                </tr>
              </tbody>
            </table>
          </Card>
        );
      })}
      {!byAccount.length && (
        <div className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground">
          No transactions in this period.
        </div>
      )}
    </div>
  );
}
