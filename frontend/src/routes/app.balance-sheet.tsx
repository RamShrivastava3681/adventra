import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api-client";
import { PageHeader, Card, fmtAccounting, fmtDate } from "@/components/ledger-ui";
import { useAuth } from "@/lib/auth-context";
import { AlertTriangle, Download, FileSpreadsheet, Plus, Printer, Trash2, X, Scale } from "lucide-react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { toast } from "sonner";

export const Route = createFileRoute("/app/balance-sheet")({
  component: BalanceSheetPage,
});

type Section =
  | "tangible_asset"
  | "cash_bank"
  | "accounts_receivable"
  | "other_current_asset"
  | "accounts_payable"
  | "customer_advance"
  | "corporation_tax_payable"
  | "rounding"
  | "other_current_liability"
  | "share_capital"
  | "retained_earnings"
  | "other_equity";

type ManualEntry = {
  id: string;
  section: Section;
  name: string;
  description: string | null;
  amount: number;
  entry_date: string;
  account_id: string | null;
  notes: string | null;
};

type DrillRow = { date: string | null; ref: string; description: string; amount: number };
type Drill = { title: string; rows: DrillRow[] } | null;
type LineItem = { key: string; label: string; amount: number; rows: DrillRow[] };

/* =========================================================
   Data fetch
   ========================================================= */
async function fetchBalanceSheetData(asOf: string) {
  const [coa, invs, bills, advs, stock, manual, journals, expenses] = await Promise.all([
    api.chartOfAccounts.list(),
    api.invoices.list(),
    api.purchaseInvoices.list(),
    api.advances.list(),
    api.stockMovements.list(),
    api.balanceEntries.list(),
    api.journals.list(),
    api.expenses.list(),
  ]);
  return {
    coa: coa ?? [],
    invoices: (invs ?? []).filter((i: any) => (i.issueDate ?? i.issue_date) <= asOf),
    bills: (bills ?? []).filter((b: any) => (b.issueDate ?? b.issue_date) <= asOf),
    advances: (advs ?? []).filter((a: any) => (a.advanceDate ?? a.advance_date) <= asOf),
    stock: (stock ?? []).filter(
      (s: any) =>
        (s.createdAt ?? s.created_at ?? "").slice(0, 10) <= asOf &&
        (s.status ?? "confirmed") === "confirmed",
    ),
    manual: (manual ?? []) as ManualEntry[],
    journals: (journals ?? []).filter(
      (j: any) => j.status === "posted" && (j.journalDate ?? j.journal_date) <= asOf,
    ),
    expenses: (expenses ?? []).filter((e: any) => (e.expenseDate ?? e.expense_date) <= asOf),
  };
}

const APPROVED = new Set(["approved", "advanced", "paid", "overdue", "disputed"]);

/* =========================================================
   Compute Balance Sheet — exact layout
   ========================================================= */
function computeBS(asOf: string, data: Awaited<ReturnType<typeof fetchBalanceSheetData>>) {
  const { coa, invoices, bills, advances, stock, manual, journals, expenses } = data;

  // Manual journal balances by account
  const journalByAcc = new Map<string, { debit: number; credit: number }>();
  const journalDrillByAcc = new Map<string, DrillRow[]>();
  for (const j of journals as any[]) {
    for (const l of j.lines ?? []) {
      const cur = journalByAcc.get(l.account_id) ?? { debit: 0, credit: 0 };
      cur.debit += Number(l.debit) || 0;
      cur.credit += Number(l.credit) || 0;
      journalByAcc.set(l.account_id, cur);
      const arr = journalDrillByAcc.get(l.account_id) ?? [];
      const amt = (Number(l.debit) || 0) - (Number(l.credit) || 0);
      arr.push({
        date: j.journal_date,
        ref: j.reference || "JRN",
        description: l.description || j.description || "Journal entry",
        amount: amt,
      });
      journalDrillByAcc.set(l.account_id, arr);
    }
  }
  const acctBalance = (id: string, debitNormal: boolean) => {
    const b = journalByAcc.get(id) ?? { debit: 0, credit: 0 };
    return debitNormal ? b.debit - b.credit : b.credit - b.debit;
  };
  const acctDrill = (id: string, debitNormal: boolean): DrillRow[] => {
    const rows = journalDrillByAcc.get(id) ?? [];
    return debitNormal ? rows : rows.map((r) => ({ ...r, amount: -r.amount }));
  };

  // Manual entries for a section as line items
  const manualLines = (s: Section): LineItem[] =>
    manual
      .filter((m) => m.section === s)
      .map((m) => ({
        key: `manual-${m.id}`,
        label: m.name,
        amount: Number(m.amount || 0),
        rows: [
          {
            date: m.entry_date,
            ref: m.name,
            description: m.description || "Manual entry",
            amount: Number(m.amount || 0),
          },
        ],
      }));

  // ---------- Fixed Assets (Tangible) ----------
  const tangibleAccts: LineItem[] = coa
    .filter((a) => a.type === "asset" && a.subtype === "fixed")
    .map((a) => ({
      key: a.id,
      label: a.name,
      amount: acctBalance(a.id, true),
      rows: acctDrill(a.id, true),
    }));
  const tangible: LineItem[] = [...tangibleAccts, ...manualLines("tangible_asset")];
  const totalTangible = tangible.reduce((s, r) => s + r.amount, 0);
  const totalFixed = totalTangible;

  // ---------- Cash at bank and in hand ----------
  const cashAccts: LineItem[] = coa
    .filter((a) => a.type === "asset" && ["bank", "cash", "petty_cash"].includes(a.subtype || ""))
    .map((a) => {
      let amt = acctBalance(a.id, true);
      const rows = acctDrill(a.id, true);
      // For the default bank account, include net advances flow
      if (a.system_key === "bank") {
        let flow = 0;
        for (const adv of advances) {
          const v = adv.side === "sales" ? Number(adv.amount || 0) : -Number(adv.amount || 0);
          flow += v;
          rows.push({
            date: adv.advance_date,
            ref: adv.payment_ref,
            description:
              adv.reference || (adv.side === "sales" ? "Customer receipt" : "Supplier payment"),
            amount: v,
          });
        }
        amt += flow;
      }
      return { key: a.id, label: a.name, amount: amt, rows };
    });
  const cash: LineItem[] = [...cashAccts, ...manualLines("cash_bank")];
  const totalCash = cash.reduce((s, r) => s + r.amount, 0);

  // ---------- Accounts Receivable (approved invoices outstanding + manual) ----------
  const paidByInv = new Map<string, number>();
  for (const a of advances)
    if (a.side === "sales" && a.invoice_id)
      paidByInv.set(a.invoice_id, (paidByInv.get(a.invoice_id) ?? 0) + Number(a.amount || 0));
  const arRows: DrillRow[] = [];
  let arTotal = 0;
  for (const i of invoices as any[]) {
    if (!APPROVED.has(String(i.status))) continue;
    const outstanding = Number(i.amount || 0) - (paidByInv.get(i.id) ?? 0);
    if (outstanding <= 0.005) continue;
    arRows.push({
      date: i.issue_date,
      ref: i.invoice_number,
      description: `Invoice ${i.invoice_number}`,
      amount: outstanding,
    });
    arTotal += outstanding;
  }
  for (const m of manualLines("accounts_receivable")) {
    arTotal += m.amount;
    arRows.push(...m.rows);
  }

  // ---------- Other Current Assets: Inventory + other asset accounts + manual ----------
  // Inventory computed from stock movements
  const invByKey = new Map<
    string,
    { item: string; qty: number; totalCost: number; unitAvg: number }
  >();
  const sorted = [...stock].sort((x: any, y: any) =>
    (x.created_at || "").localeCompare(y.created_at || ""),
  );
  for (const m of sorted as any[]) {
    const key = m.sku || m.item_name || m.id;
    const cur = invByKey.get(key) ?? { item: m.item_name || key, qty: 0, totalCost: 0, unitAvg: 0 };
    const q = Number(m.quantity || 0);
    const uc = Number(m.unit_cost || 0);
    // Inventory value = Σ(in qty × unit cost) − Σ(out qty × unit cost).
    // Both directions use the movement's own unit cost (the sale price is irrelevant).
    if (m.direction === "in") {
      cur.qty += q;
      cur.totalCost += q * uc;
    } else {
      cur.qty -= q;
      cur.totalCost = Math.max(0, cur.totalCost - uc * q);
    }
    cur.unitAvg = cur.qty > 0 ? cur.totalCost / cur.qty : 0;
    invByKey.set(key, cur);
  }
  const invRows: DrillRow[] = [];
  let invTotal = 0;
  for (const v of invByKey.values()) {
    if (v.qty <= 0.0001) continue;
    const val = v.qty * v.unitAvg;
    invRows.push({
      date: null,
      ref: v.item,
      description: `${v.qty.toFixed(2)} × ${v.unitAvg.toFixed(2)}`,
      amount: val,
    });
    invTotal += val;
  }

  // Exclude fixed / cash / AR / inventory accounts — the rest are "other current assets"
  const otherAssetAccts = coa.filter(
    (a) =>
      a.type === "asset" &&
      !["fixed"].includes(a.subtype || "") &&
      !["bank", "cash", "petty_cash"].includes(a.subtype || "") &&
      a.system_key !== "ar" &&
      a.system_key !== "inventory",
  );
  const otherCA: LineItem[] = [
    // Inventory line always listed if we have movements or an inventory account exists
    ...(invTotal > 0.005
      ? [{ key: "inventory", label: "Inventory", amount: invTotal, rows: invRows }]
      : []),
    ...otherAssetAccts.map((a) => ({
      key: a.id,
      label: a.name,
      amount: acctBalance(a.id, true),
      rows: acctDrill(a.id, true),
    })),
    ...manualLines("other_current_asset"),
  ];
  const otherCATotal = otherCA.reduce((s, r) => s + r.amount, 0);

  const totalCurrentAssets = totalCash + arTotal + otherCATotal;
  const totalAssets = totalFixed + totalCurrentAssets;

  // ---------- Creditors ----------
  // AP outstanding + manual
  const paidByBill = new Map<string, number>();
  for (const a of advances)
    if (a.side !== "sales" && a.purchase_invoice_id)
      paidByBill.set(
        a.purchase_invoice_id,
        (paidByBill.get(a.purchase_invoice_id) ?? 0) + Number(a.amount || 0),
      );
  const apRows: DrillRow[] = [];
  let apTotal = 0;
  for (const b of bills as any[]) {
    const outstanding = Number(b.amount || 0) - (paidByBill.get(b.id) ?? 0);
    if (outstanding <= 0.005) continue;
    apRows.push({
      date: b.issue_date,
      ref: b.invoice_number,
      description: `Bill ${b.invoice_number}`,
      amount: outstanding,
    });
    apTotal += outstanding;
  }
  for (const m of manualLines("accounts_payable")) {
    apTotal += m.amount;
    apRows.push(...m.rows);
  }

  // Customer advances (unapplied) + manual
  const custAdvRows: DrillRow[] = [];
  let custAdvTotal = 0;
  for (const a of advances) {
    if (a.side === "sales" && !a.invoice_id) {
      custAdvRows.push({
        date: a.advance_date,
        ref: a.payment_ref,
        description: a.reference || "Customer advance",
        amount: Number(a.amount || 0),
      });
      custAdvTotal += Number(a.amount || 0);
    }
  }
  for (const m of manualLines("customer_advance")) {
    custAdvTotal += m.amount;
    custAdvRows.push(...m.rows);
  }

  // Corporation Tax Payable — CoA account + manual
  const corpTaxAcct = coa.find(
    (a) =>
      a.type === "liability" && (a.system_key === "corp_tax" || /corporation\s*tax/i.test(a.name)),
  );
  let corpTaxTotal = corpTaxAcct ? acctBalance(corpTaxAcct.id, false) : 0;
  const corpTaxRows = corpTaxAcct ? acctDrill(corpTaxAcct.id, false) : [];
  for (const m of manualLines("corporation_tax_payable")) {
    corpTaxTotal += m.amount;
    corpTaxRows.push(...m.rows);
  }

  // Rounding — CoA account + manual
  const roundingAcct = coa.find(
    (a) => a.type === "liability" && (a.system_key === "rounding" || /rounding/i.test(a.name)),
  );
  let roundingTotal = roundingAcct ? acctBalance(roundingAcct.id, false) : 0;
  const roundingRows = roundingAcct ? acctDrill(roundingAcct.id, false) : [];
  for (const m of manualLines("rounding")) {
    roundingTotal += m.amount;
    roundingRows.push(...m.rows);
  }

  // Other Current Liabilities — remaining liability accounts + manual
  const excludedLiabIds = new Set(
    [
      ...coa
        .filter((a) => a.type === "liability" && a.subtype === "accounts_payable")
        .map((a) => a.id),
      corpTaxAcct?.id,
      roundingAcct?.id,
    ].filter(Boolean) as string[],
  );
  const otherLiabAccts = coa.filter((a) => a.type === "liability" && !excludedLiabIds.has(a.id));
  const otherCL: LineItem[] = [
    ...otherLiabAccts.map((a) => ({
      key: a.id,
      label: a.name,
      amount: acctBalance(a.id, false),
      rows: acctDrill(a.id, false),
    })),
    ...manualLines("other_current_liability"),
  ];
  const otherCLTotal = otherCL.reduce((s, r) => s + r.amount, 0);

  const totalCreditors = apTotal + custAdvTotal + corpTaxTotal + roundingTotal + otherCLTotal;
  const netCurrentAssets = totalCurrentAssets - totalCreditors;
  const totalAssetsLessCL = totalFixed + netCurrentAssets;
  const netAssets = totalAssetsLessCL;

  // ---------- Capital and Reserves ----------
  // Current Year Earnings = Sales (approved) − COGS proxy (bills as purchases) − expenses within FY up to asOf
  const fyStart = new Date(new Date(asOf).getFullYear(), 0, 1).toISOString().slice(0, 10);
  const cyeRows: DrillRow[] = [];
  let revenue = 0,
    cogs = 0,
    expenseSum = 0;
  for (const i of invoices as any[]) {
    if (!APPROVED.has(String(i.status))) continue;
    if (i.issue_date >= fyStart) {
      revenue += Number(i.amount || 0);
      cyeRows.push({
        date: i.issue_date,
        ref: i.invoice_number,
        description: `Sales — ${i.invoice_number}`,
        amount: Number(i.amount || 0),
      });
    }
  }
  for (const b of bills as any[]) {
    if (b.issue_date >= fyStart) {
      cogs += Number(b.amount || 0);
      cyeRows.push({
        date: b.issue_date,
        ref: b.invoice_number,
        description: `Purchase — ${b.invoice_number}`,
        amount: -Number(b.amount || 0),
      });
    }
  }
  for (const e of expenses as any[]) {
    if (e.expense_date >= fyStart) {
      expenseSum += Number(e.amount || 0);
      cyeRows.push({
        date: e.expense_date,
        ref: e.expense_ref,
        description: e.description || e.category || "Expense",
        amount: -Number(e.amount || 0),
      });
    }
  }
  const cye = revenue - cogs - expenseSum;

  // Retained Earnings — account + manual
  const retainedAcct = coa.find((a) => a.system_key === "retained");
  let retainedTotal = retainedAcct ? acctBalance(retainedAcct.id, false) : 0;
  const retainedRows = retainedAcct ? acctDrill(retainedAcct.id, false) : [];
  for (const m of manualLines("retained_earnings")) {
    retainedTotal += m.amount;
    retainedRows.push(...m.rows);
  }

  // Share Capital: subtype 'capital' or 'share_capital' + manual
  const shareAccts = coa.filter(
    (a) => a.type === "equity" && (a.subtype === "capital" || a.subtype === "share_capital"),
  );
  const share: LineItem[] = [
    ...shareAccts.map((a) => ({
      key: a.id,
      label: a.name,
      amount: acctBalance(a.id, false),
      rows: acctDrill(a.id, false),
    })),
    ...manualLines("share_capital"),
  ];
  const totalShare = share.reduce((s, r) => s + r.amount, 0);

  // Other Equity: remaining equity accounts (not share, not retained) + manual entries
  const otherEquityAccts = coa.filter(
    (a) =>
      a.type === "equity" &&
      a.system_key !== "retained" &&
      a.subtype !== "capital" &&
      a.subtype !== "share_capital",
  );
  const otherEquity: LineItem[] = [
    ...otherEquityAccts.map((a) => ({
      key: a.id,
      label: a.name,
      amount: acctBalance(a.id, false),
      rows: acctDrill(a.id, false),
    })),
    ...manualLines("other_equity"),
  ];
  const otherEquityTotal = otherEquity.reduce((s, r) => s + r.amount, 0);

  const totalCapitalReserves = cye + retainedTotal + totalShare + otherEquityTotal;

  return {
    tangible,
    totalTangible,
    totalFixed,
    cash,
    totalCash,
    ar: { total: arTotal, rows: arRows },
    otherCA,
    otherCATotal,
    totalCurrentAssets,
    totalAssets,
    ap: { total: apTotal, rows: apRows },
    custAdv: { total: custAdvTotal, rows: custAdvRows },
    corpTax: {
      total: corpTaxTotal,
      rows: corpTaxRows,
      name: corpTaxAcct?.name ?? "Corporation Tax Payable",
    },
    rounding: { total: roundingTotal, rows: roundingRows, name: roundingAcct?.name ?? "Rounding" },
    otherCL,
    otherCLTotal,
    totalCreditors,
    netCurrentAssets,
    totalAssetsLessCL,
    netAssets,
    cye: { total: cye, rows: cyeRows },
    retained: { total: retainedTotal, rows: retainedRows },
    share,
    totalShare,
    otherEquity,
    otherEquityTotal,
    totalCapitalReserves,
  };
}

type BS = ReturnType<typeof computeBS>;

/* =========================================================
   Page
   ========================================================= */
function BalanceSheetPage() {
  const { user } = useAuth();
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [compareOn, setCompareOn] = useState(false);
  const compareAsOf = useMemo(() => {
    const d = new Date(asOf);
    d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().slice(0, 10);
  }, [asOf]);
  const [drill, setDrill] = useState<Drill>(null);
  const [manualOpen, setManualOpen] = useState<Section | null>(null);
  const [editEntry, setEditEntry] = useState<ManualEntry | null>(null);
  const qc = useQueryClient();

  const primary = useQuery({ queryKey: ["bs", asOf], queryFn: () => fetchBalanceSheetData(asOf) });
  const compare = useQuery({
    queryKey: ["bs", compareAsOf],
    queryFn: () => fetchBalanceSheetData(compareAsOf),
    enabled: compareOn,
  });

  useEffect(() => {
    const tables = [
      "invoices",
      "purchase_invoices",
      "advances",
      "stock_movements",
      "chart_of_accounts",
      "journals",
      "journal_lines",
      "manual_balance_entries",
      "expenses",
    ];
    const invalidate = () => qc.invalidateQueries({ queryKey: ["bs"] });
    // Realtime replaced with polling
    const interval = setInterval(invalidate, 30000);
    return () => clearInterval(interval);
  }, [qc]);

  const bs = useMemo(
    () => (primary.data ? computeBS(asOf, primary.data) : null),
    [primary.data, asOf],
  );
  const bsCmp = useMemo(
    () => (compare.data ? computeBS(compareAsOf, compare.data) : null),
    [compare.data, compareAsOf],
  );

  const openDrill = (title: string, rows: DrillRow[]) => setDrill({ title, rows });

  const totalLiabPlusEquity = bs ? bs.totalCreditors + bs.totalCapitalReserves : 0;
  const diff = bs ? bs.totalAssets - totalLiabPlusEquity : 0;
  const isBalanced = Math.abs(diff) < 0.01;

  const doExport = (kind: "csv" | "xls" | "pdf") => {
    if (!bs) return;
    if (!isBalanced && kind !== "pdf") {
      if (!confirm(`Balance Sheet is out of balance by ${fmtAccounting(diff)}. Export anyway?`))
        return;
    }
    if (kind === "pdf") {
      window.print();
      return;
    }
    const rows = flattenForExport(bs, asOf, compareOn ? bsCmp : null, compareAsOf);
    if (kind === "csv") downloadFile(`balance-sheet-${asOf}.csv`, "text/csv", toCSV(rows));
    else downloadFile(`balance-sheet-${asOf}.xls`, "application/vnd.ms-excel", toXLS(rows));
  };

  // Match line items in compare period by key for side-by-side display
  const cmpAmount = (section: keyof BS, key: string): number | undefined => {
    if (!bsCmp) return undefined;
    const arr = (bsCmp as any)[section] as LineItem[] | undefined;
    if (!Array.isArray(arr)) return undefined;
    return arr.find((r) => r.key === key)?.amount;
  };

  return (
    <div>
      <PageHeader
        eyebrow="Financial statements"
        title="Balance Sheet"
        description="As of the selected date. Auto-updates from invoices, purchases, inventory, advances, accounts and manual entries."
        icon={<Scale className="h-5 w-5" />}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <button
              onClick={() => doExport("csv")}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm hover:bg-muted"
            >
              <Download className="h-4 w-4" /> CSV
            </button>
            <button
              onClick={() => doExport("xls")}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm hover:bg-muted"
            >
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </button>
            <button
              onClick={() => doExport("pdf")}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm hover:bg-muted"
            >
              <Printer className="h-4 w-4" /> PDF
            </button>
          </div>
        }
      />

      <div className="px-6 py-4">
        <div className="mb-4 flex flex-wrap items-end gap-4 print:hidden">
          <div>
            <label className="text-[10px] uppercase tracking-widest text-muted-foreground">
              As of
            </label>
            <input
              type="date"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              className="block rounded-md border border-border bg-background px-3 py-1.5 text-sm"
            />
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={compareOn}
              onChange={(e) => setCompareOn(e.target.checked)}
            />
            Compare to {fmtDate(compareAsOf)}
          </label>
        </div>

        {!isBalanced && bs && (
          <div className="mb-4 flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-medium">Out of Balance</div>
              <div>
                Total Assets − (Total Liabilities + Total Capital and Reserves) ={" "}
                <span className="font-mono">{fmtAccounting(diff)}</span>.
              </div>
            </div>
          </div>
        )}

        {primary.isLoading || !bs ? (
          <div className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : (
          <div id="bs-print" className="max-w-4xl">
            <Card>
              {/* Column headers */}
              <div className="mb-2 flex items-end justify-between border-b border-border pb-2">
                <div className="text-sm font-medium">Balance Sheet — as of {fmtDate(asOf)}</div>
                <div className="flex items-center gap-8 text-[10px] uppercase tracking-widest text-muted-foreground">
                  {compareOn && <span className="w-28 text-right">{fmtDate(compareAsOf)}</span>}
                  <span className="w-32 text-right">{fmtDate(asOf)}</span>
                </div>
              </div>

              {/* ===== Fixed Assets ===== */}
              <Group title="Fixed Assets" />
              <SubGroup title="Tangible Assets" />
              {bs.tangible.length === 0 && <EmptyLine />}
              {bs.tangible.map((li) => (
                <Line
                  key={li.key}
                  label={li.label}
                  value={li.amount}
                  compare={cmpAmount("tangible", li.key)}
                  onClick={() => openDrill(li.label, li.rows)}
                  indent={2}
                />
              ))}
              <Total
                label="Total Tangible Assets"
                value={bs.totalTangible}
                compare={bsCmp?.totalTangible}
                indent={1}
              />
              <Total label="Total Fixed Assets" value={bs.totalFixed} compare={bsCmp?.totalFixed} />

              {/* ===== Current Assets ===== */}
              <Group title="Current Assets" />
              <SubGroup title="Cash at bank and in hand" />
              {bs.cash.length === 0 && <EmptyLine />}
              {bs.cash.map((li) => (
                <Line
                  key={li.key}
                  label={li.label}
                  value={li.amount}
                  compare={cmpAmount("cash", li.key)}
                  onClick={() => openDrill(li.label, li.rows)}
                  indent={2}
                />
              ))}
              <Total
                label="Total Cash at bank and in hand"
                value={bs.totalCash}
                compare={bsCmp?.totalCash}
                indent={1}
              />

              <SubGroup title="Accounts Receivable" />
              <Line
                label="Accounts Receivable"
                value={bs.ar.total}
                compare={bsCmp?.ar.total}
                onClick={() => openDrill("Accounts Receivable", bs.ar.rows)}
                indent={2}
              />

              <SubGroup title="Other Current Assets">
                <button
                  onClick={() => {
                    setEditEntry(null);
                    setManualOpen("other_current_asset");
                  }}
                  title="Add manual current asset"
                  className="print:hidden inline-flex items-center rounded border border-border bg-background p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </SubGroup>
              {bs.otherCA.length === 0 && <EmptyLine />}
              {bs.otherCA.map((li) => (
                <Line
                  key={li.key}
                  label={li.label}
                  value={li.amount}
                  compare={cmpAmount("otherCA", li.key)}
                  onClick={() => openDrill(li.label, li.rows)}
                  indent={2}
                />
              ))}
              <Total
                label="Total Current Assets"
                value={bs.totalCurrentAssets}
                compare={bsCmp?.totalCurrentAssets}
              />

              {/* ===== Creditors ===== */}
              <Group title="Creditors: amounts falling due within one year" />
              <Line
                label="Accounts Payable"
                value={bs.ap.total}
                compare={bsCmp?.ap.total}
                onClick={() => openDrill("Accounts Payable", bs.ap.rows)}
                indent={1}
              />
              <Line
                label="Advance received from Customers"
                value={bs.custAdv.total}
                compare={bsCmp?.custAdv.total}
                onClick={() => openDrill("Advance from Customers", bs.custAdv.rows)}
                indent={1}
              />
              <Line
                label={bs.corpTax.name}
                value={bs.corpTax.total}
                compare={bsCmp?.corpTax.total}
                onClick={() => openDrill(bs.corpTax.name, bs.corpTax.rows)}
                indent={1}
              />
              <Line
                label={bs.rounding.name}
                value={bs.rounding.total}
                compare={bsCmp?.rounding.total}
                onClick={() => openDrill(bs.rounding.name, bs.rounding.rows)}
                indent={1}
              />

              <SubGroup title="Other Current Liabilities">
                <button
                  onClick={() => {
                    setEditEntry(null);
                    setManualOpen("other_current_liability");
                  }}
                  title="Add manual current liability"
                  className="print:hidden inline-flex items-center rounded border border-border bg-background p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </SubGroup>
              {bs.otherCL.length === 0 && <EmptyLine />}
              {bs.otherCL.map((li) => (
                <Line
                  key={li.key}
                  label={li.label}
                  value={li.amount}
                  compare={cmpAmount("otherCL", li.key)}
                  onClick={() => openDrill(li.label, li.rows)}
                  indent={2}
                />
              ))}
              <Total
                label="Total Creditors: amounts falling due within one year"
                value={bs.totalCreditors}
                compare={bsCmp?.totalCreditors}
              />

              {/* ===== Net Current Assets ===== */}
              <Total
                label="Net Current Assets (Liabilities)"
                value={bs.netCurrentAssets}
                compare={bsCmp?.netCurrentAssets}
                spaced
              />

              {/* ===== Total Assets Less Current Liabilities ===== */}
              <Total
                label="Total Assets less Current Liabilities"
                value={bs.totalAssetsLessCL}
                compare={bsCmp?.totalAssetsLessCL}
                spaced
              />

              {/* ===== Net Assets ===== */}
              <Total
                label="Net Assets"
                value={bs.netAssets}
                compare={bsCmp?.netAssets}
                strong
                spaced
              />

              {/* ===== Capital and Reserves ===== */}
              <Group title="Capital and Reserves" />
              <Line
                label="Current Year Earnings"
                value={bs.cye.total}
                compare={bsCmp?.cye.total}
                onClick={() => openDrill("Current Year Earnings", bs.cye.rows)}
                indent={1}
              />
              <Line
                label="Retained Earnings"
                value={bs.retained.total}
                compare={bsCmp?.retained.total}
                onClick={() => openDrill("Retained Earnings", bs.retained.rows)}
                indent={1}
              />

              <SubGroup title="Share Capital" />
              {bs.share.length === 0 && <EmptyLine />}
              {bs.share.map((li) => (
                <Line
                  key={li.key}
                  label={li.label}
                  value={li.amount}
                  compare={cmpAmount("share", li.key)}
                  onClick={() => openDrill(li.label, li.rows)}
                  indent={2}
                />
              ))}

              <SubGroup title="Other Equity">
                <button
                  onClick={() => {
                    setEditEntry(null);
                    setManualOpen("other_equity");
                  }}
                  title="Add manual equity"
                  className="print:hidden inline-flex items-center rounded border border-border bg-background p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </SubGroup>
              {bs.otherEquity.length === 0 && <EmptyLine />}
              {bs.otherEquity.map((li) => (
                <Line
                  key={li.key}
                  label={li.label}
                  value={li.amount}
                  compare={cmpAmount("otherEquity", li.key)}
                  onClick={() => openDrill(li.label, li.rows)}
                  indent={2}
                />
              ))}

              <Total
                label="Total Capital and Reserves"
                value={bs.totalCapitalReserves}
                compare={bsCmp?.totalCapitalReserves}
                strong
                spaced
              />
            </Card>
          </div>
        )}
      </div>

      {drill && <DrillDrawer drill={drill} onClose={() => setDrill(null)} />}
      {manualOpen && user && (
        <ManualEntryModal
          section={manualOpen}
          entry={editEntry}
          clientId={user.id}
          onClose={() => {
            setManualOpen(null);
            setEditEntry(null);
          }}
          onEdit={(e) => setEditEntry(e)}
        />
      )}
    </div>
  );
}

/* ========== Layout primitives ========== */
function Group({ title }: { title: string }) {
  return (
    <div className="mt-5 mb-1 border-b border-border pb-1 text-sm font-semibold uppercase tracking-wider">
      {title}
    </div>
  );
}
function SubGroup({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mt-3 mb-1 flex items-center gap-2 pl-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
      <span>{title}</span>
      {children}
    </div>
  );
}
function EmptyLine() {
  return <div className="pl-8 py-1 text-xs italic text-muted-foreground">No accounts</div>;
}
function Line({
  label,
  value,
  compare,
  onClick,
  indent = 0,
}: {
  label: string;
  value: number;
  compare?: number;
  onClick?: () => void;
  indent?: number;
}) {
  const pad = { 0: "", 1: "pl-4", 2: "pl-8", 3: "pl-12" }[indent] ?? "";
  return (
    <div
      className={`flex items-center justify-between border-b border-border/30 py-1 text-sm ${pad}`}
    >
      <button
        onClick={onClick}
        className="text-left hover:text-primary underline-offset-2 hover:underline"
      >
        {label}
      </button>
      <div className="flex items-center gap-8 font-mono">
        {compare !== undefined && (
          <span className="w-28 text-right text-muted-foreground">{fmtAccounting(compare)}</span>
        )}
        <span className="w-32 text-right">{fmtAccounting(value)}</span>
      </div>
    </div>
  );
}
function Total({
  label,
  value,
  compare,
  strong,
  spaced,
  indent = 0,
}: {
  label: string;
  value: number;
  compare?: number;
  strong?: boolean;
  spaced?: boolean;
  indent?: number;
}) {
  const pad = { 0: "", 1: "pl-4", 2: "pl-8" }[indent] ?? "";
  return (
    <div
      className={`flex items-center justify-between border-t ${strong ? "border-t-2 border-foreground" : "border-border"} ${spaced ? "mt-3" : "mt-1"} pt-1.5 text-sm font-semibold ${pad}`}
    >
      <span>{label}</span>
      <div className="flex items-center gap-8 font-mono">
        {compare !== undefined && (
          <span className="w-28 text-right text-muted-foreground">{fmtAccounting(compare)}</span>
        )}
        <span className={`w-32 text-right ${strong ? "text-base" : ""}`}>
          {fmtAccounting(value)}
        </span>
      </div>
    </div>
  );
}

/* ========== Drill-down ========== */
function DrillDrawer({ drill, onClose }: { drill: NonNullable<Drill>; onClose: () => void }) {
  const total = drill.rows.reduce((s, r) => s + r.amount, 0);
  return (
    <div className="fixed inset-0 z-50 print:hidden">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-xl overflow-auto border-l border-border bg-background p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="font-display text-xl">{drill.title}</h3>
            <p className="text-xs text-muted-foreground">Underlying transactions</p>
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        {drill.rows.length ? (
          <table className="table-premium w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground border-b border-border">
              <tr>
                <th className="py-2">Date</th>
                <th className="py-2">Reference</th>
                <th className="py-2">Description</th>
                <th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {drill.rows.map((r, i) => (
                <tr key={i} className="border-b border-border/30">
                  <td className="py-1.5">{fmtDate(r.date)}</td>
                  <td className="py-1.5 font-mono text-xs">{r.ref}</td>
                  <td className="py-1.5">{r.description}</td>
                  <td className="py-1.5 text-right font-mono">{fmtAccounting(r.amount)}</td>
                </tr>
              ))}
              <tr className="font-medium">
                <td className="py-2" colSpan={3}>
                  Total
                </td>
                <td className="py-2 text-right font-mono">{fmtAccounting(total)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <div className="rounded-md border border-border p-6 text-center text-sm text-muted-foreground">
            No transactions.
          </div>
        )}
      </div>
    </div>
  );
}

/* ========== Manual entry modal ========== */
const SECTION_LABEL: Record<Section, string> = {
  tangible_asset: "Tangible Assets",
  cash_bank: "Cash at bank and in hand",
  accounts_receivable: "Accounts Receivable",
  other_current_asset: "Other Current Assets",
  accounts_payable: "Accounts Payable",
  customer_advance: "Advance received from Customers",
  corporation_tax_payable: "Corporation Tax Payable",
  rounding: "Rounding",
  other_current_liability: "Other Current Liabilities",
  share_capital: "Share Capital",
  retained_earnings: "Retained Earnings",
  other_equity: "Other Equity",
};

function ManualEntryModal({
  section,
  entry,
  clientId,
  onClose,
  onEdit,
}: {
  section: Section;
  entry: ManualEntry | null;
  clientId: string;
  onClose: () => void;
  onEdit: (e: ManualEntry | null) => void;
}) {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["manual-entries", section],
    queryFn: async () => {
      const data = await api.balanceEntries.list();
      return ((data ?? []) as ManualEntry[]).filter((e: any) => e.section === section).reverse();
    },
  });
  const coa = useQuery({
    queryKey: ["coa-list"],
    queryFn: async () => {
      const data = await api.chartOfAccounts.list();
      return data
        .map((a: any) => ({ id: a.id, code: a.code, name: a.name }))
        .sort((a: any, b: any) => a.code?.localeCompare(b.code ?? "") ?? 0);
    },
  });

  const [name, setName] = useState(entry?.name ?? "");
  const [description, setDescription] = useState(entry?.description ?? "");
  const [amount, setAmount] = useState<string>(entry?.amount != null ? String(entry.amount) : "");
  const [entryDate, setEntryDate] = useState(
    entry?.entry_date ?? new Date().toISOString().slice(0, 10),
  );
  const [accountId, setAccountId] = useState<string>(entry?.account_id ?? "");
  const [notes, setNotes] = useState(entry?.notes ?? "");

  useEffect(() => {
    setName(entry?.name ?? "");
    setDescription(entry?.description ?? "");
    setAmount(entry?.amount != null ? String(entry.amount) : "");
    setEntryDate(entry?.entry_date ?? new Date().toISOString().slice(0, 10));
    setAccountId(entry?.account_id ?? "");
    setNotes(entry?.notes ?? "");
  }, [entry]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        client_id: clientId,
        section,
        name,
        description: description || null,
        amount: Number(amount || 0),
        entry_date: entryDate,
        account_id: accountId || null,
        notes: notes || null,
      };
      if (entry) {
        await api.balanceEntries.update(entry.id, payload);
      } else {
        await api.balanceEntries.create(payload);
      }
    },
    onSuccess: () => {
      toast.success(entry ? "Entry updated" : "Entry added");
      qc.invalidateQueries({ queryKey: ["manual-entries", section] });
      qc.invalidateQueries({ queryKey: ["bs"] });
      onEdit(null);
      setName("");
      setDescription("");
      setAmount("");
      setAccountId("");
      setNotes("");
    },
    onError: (e: any) => toast.error(e.message || "Failed to save"),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      await api.balanceEntries.delete(id);
    },
    onSuccess: () => {
      toast.success("Entry deleted");
      qc.invalidateQueries({ queryKey: ["manual-entries", section] });
      qc.invalidateQueries({ queryKey: ["bs"] });
    },
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center print:hidden">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative m-4 w-full max-w-3xl rounded-xl border border-border bg-background p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="font-display text-xl">{SECTION_LABEL[section]}</h3>
            <p className="text-xs text-muted-foreground">Add, edit or remove manual entries.</p>
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-6 rounded-lg border border-border p-4">
          <div className="mb-3 text-xs uppercase tracking-widest text-muted-foreground">
            {entry ? "Edit entry" : "New entry"}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Name *">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
              />
            </Field>
            <Field label="Amount *">
              <input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-right font-mono"
              />
            </Field>
            <Field label="Date">
              <input
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
              />
            </Field>
            <Field label="Account (optional)">
              <SearchableSelect
                value={accountId}
                onChange={setAccountId}
                placeholder="— None —"
                options={[
                  { value: "", label: "— None —" },
                  ...(coa.data ?? []).map((a: any) => ({
                    value: a.id,
                    label: `${a.code} — ${a.name}`,
                  })),
                ]}
              />
            </Field>
            <Field label="Description" className="md:col-span-2">
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
              />
            </Field>
            <Field label="Notes" className="md:col-span-2">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                rows={2}
              />
            </Field>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            {entry && (
              <button
                onClick={() => onEdit(null)}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
              >
                Cancel edit
              </button>
            )}
            <button
              disabled={!name || !amount || save.isPending}
              onClick={() => save.mutate()}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> {entry ? "Update" : "Add"}
            </button>
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
            Existing entries
          </div>
          <table className="table-premium w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground border-b border-border">
              <tr>
                <th className="py-2">Date</th>
                <th className="py-2">Name</th>
                <th className="py-2">Description</th>
                <th className="py-2 text-right">Amount</th>
                <th className="py-2 w-24 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(list.data ?? []).map((m) => (
                <tr key={m.id} className="border-b border-border/30">
                  <td className="py-1.5">{fmtDate(m.entry_date)}</td>
                  <td className="py-1.5">{m.name}</td>
                  <td className="py-1.5 text-muted-foreground">{m.description ?? "—"}</td>
                  <td className="py-1.5 text-right font-mono">{fmtAccounting(m.amount)}</td>
                  <td className="py-1.5 text-right">
                    <button
                      onClick={() => onEdit(m)}
                      className="mr-2 text-xs text-primary hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => del.mutate(m.id)}
                      className="text-xs text-destructive hover:underline"
                    >
                      <Trash2 className="inline h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {!list.data?.length && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                    No entries yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      {children}
    </label>
  );
}

/* ========== Export helpers ========== */
type ExportRow = {
  label: string;
  value: number;
  compare?: number;
  kind?: "header" | "sub" | "total" | "grand";
};
function flattenForExport(
  bs: BS,
  asOf: string,
  cmp: BS | null | undefined,
  cmpDate: string,
): ExportRow[] {
  const rows: ExportRow[] = [];
  const at = (arr: LineItem[] | undefined, key: string) => arr?.find((r) => r.key === key)?.amount;
  rows.push({
    label: `Balance Sheet as of ${asOf}${cmp ? ` (vs ${cmpDate})` : ""}`,
    value: 0,
    kind: "header",
  });

  rows.push({ label: "Fixed Assets", value: 0, kind: "header" });
  rows.push({ label: "  Tangible Assets", value: 0, kind: "sub" });
  bs.tangible.forEach((li) =>
    rows.push({ label: `    ${li.label}`, value: li.amount, compare: at(cmp?.tangible, li.key) }),
  );
  rows.push({
    label: "  Total Tangible Assets",
    value: bs.totalTangible,
    compare: cmp?.totalTangible,
    kind: "total",
  });
  rows.push({
    label: "Total Fixed Assets",
    value: bs.totalFixed,
    compare: cmp?.totalFixed,
    kind: "total",
  });

  rows.push({ label: "Current Assets", value: 0, kind: "header" });
  rows.push({ label: "  Cash at bank and in hand", value: 0, kind: "sub" });
  bs.cash.forEach((li) =>
    rows.push({ label: `    ${li.label}`, value: li.amount, compare: at(cmp?.cash, li.key) }),
  );
  rows.push({
    label: "  Total Cash at bank and in hand",
    value: bs.totalCash,
    compare: cmp?.totalCash,
    kind: "total",
  });
  rows.push({ label: "  Accounts Receivable", value: bs.ar.total, compare: cmp?.ar.total });
  rows.push({ label: "  Other Current Assets", value: 0, kind: "sub" });
  bs.otherCA.forEach((li) =>
    rows.push({ label: `    ${li.label}`, value: li.amount, compare: at(cmp?.otherCA, li.key) }),
  );
  rows.push({
    label: "Total Current Assets",
    value: bs.totalCurrentAssets,
    compare: cmp?.totalCurrentAssets,
    kind: "total",
  });

  rows.push({ label: "Creditors: amounts falling due within one year", value: 0, kind: "header" });
  rows.push({ label: "  Accounts Payable", value: bs.ap.total, compare: cmp?.ap.total });
  rows.push({
    label: "  Advance received from Customers",
    value: bs.custAdv.total,
    compare: cmp?.custAdv.total,
  });
  rows.push({
    label: `  ${bs.corpTax.name}`,
    value: bs.corpTax.total,
    compare: cmp?.corpTax.total,
  });
  rows.push({
    label: `  ${bs.rounding.name}`,
    value: bs.rounding.total,
    compare: cmp?.rounding.total,
  });
  bs.otherCL.forEach((li) =>
    rows.push({ label: `  ${li.label}`, value: li.amount, compare: at(cmp?.otherCL, li.key) }),
  );
  rows.push({
    label: "Total Creditors: amounts falling due within one year",
    value: bs.totalCreditors,
    compare: cmp?.totalCreditors,
    kind: "total",
  });

  rows.push({
    label: "Net Current Assets (Liabilities)",
    value: bs.netCurrentAssets,
    compare: cmp?.netCurrentAssets,
    kind: "total",
  });
  rows.push({
    label: "Total Assets less Current Liabilities",
    value: bs.totalAssetsLessCL,
    compare: cmp?.totalAssetsLessCL,
    kind: "total",
  });
  rows.push({ label: "Net Assets", value: bs.netAssets, compare: cmp?.netAssets, kind: "grand" });

  rows.push({ label: "Capital and Reserves", value: 0, kind: "header" });
  rows.push({ label: "  Current Year Earnings", value: bs.cye.total, compare: cmp?.cye.total });
  rows.push({
    label: "  Retained Earnings",
    value: bs.retained.total,
    compare: cmp?.retained.total,
  });
  rows.push({ label: "  Share Capital", value: 0, kind: "sub" });
  bs.share.forEach((li) =>
    rows.push({ label: `    ${li.label}`, value: li.amount, compare: at(cmp?.share, li.key) }),
  );
  rows.push({ label: "  Other Equity", value: 0, kind: "sub" });
  bs.otherEquity.forEach((li) =>
    rows.push({
      label: `    ${li.label}`,
      value: li.amount,
      compare: at(cmp?.otherEquity, li.key),
    }),
  );
  rows.push({
    label: "Total Capital and Reserves",
    value: bs.totalCapitalReserves,
    compare: cmp?.totalCapitalReserves,
    kind: "grand",
  });
  return rows;
}

function toCSV(rows: ExportRow[]) {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const hasCompare = rows.some((r) => r.compare !== undefined);
  const header = hasCompare ? "Line,Current,Comparative" : "Line,Amount";
  const body = rows
    .map((r) =>
      r.kind === "header" || r.kind === "sub"
        ? esc(r.label)
        : hasCompare
          ? `${esc(r.label)},${r.value.toFixed(2)},${r.compare != null ? r.compare.toFixed(2) : ""}`
          : `${esc(r.label)},${r.value.toFixed(2)}`,
    )
    .join("\n");
  return header + "\n" + body;
}

function toXLS(rows: ExportRow[]) {
  const hasCompare = rows.some((r) => r.compare !== undefined);
  const cells = rows
    .map((r) => {
      if (r.kind === "header" || r.kind === "sub")
        return `<tr><td colspan="${hasCompare ? 3 : 2}" style="font-weight:bold;background:#eef">${escapeHtml(r.label)}</td></tr>`;
      const weight =
        r.kind === "grand"
          ? "font-weight:bold;border-top:2px solid #000"
          : r.kind === "total"
            ? "font-weight:bold;border-top:1px solid #999"
            : "";
      const compare = hasCompare
        ? `<td style="text-align:right;${weight}">${r.compare != null ? r.compare.toFixed(2) : ""}</td>`
        : "";
      return `<tr><td style="${weight}">${escapeHtml(r.label)}</td><td style="text-align:right;${weight}">${r.value.toFixed(2)}</td>${compare}</tr>`;
    })
    .join("");
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"></head><body><table>${cells}</table></body></html>`;
}

function escapeHtml(s: string) {
  return s.replace(
    /[&<>"]/g,
    (c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }) as any)[c],
  );
}

function downloadFile(name: string, mime: string, contents: string) {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
