import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api-client";
import { Card, fmtAccounting, fmtDate } from "@/components/ledger-ui";
import { Plus, Trash2, Pencil, X, Sparkles, HistoryIcon, Info } from "lucide-react";
import { toast } from "sonner";

/* ---------- Section catalog ---------- */
export type Section =
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

type Group = "assets" | "liabilities" | "equity";

type SectionMeta = {
  id: Section;
  label: string;
  group: Group;
  parent: string;
  autoLabel?: string;
  autoDescription?: string;
};

const SECTIONS: SectionMeta[] = [
  {
    id: "tangible_asset",
    label: "Tangible Assets",
    group: "assets",
    parent: "Fixed Assets",
    autoLabel: "From accounts (fixed subtype)",
    autoDescription: "Sum of Chart of Accounts of type=asset, subtype=fixed",
  },
  {
    id: "cash_bank",
    label: "Cash at bank and in hand",
    group: "assets",
    parent: "Current Assets",
    autoLabel: "From bank accounts + advances flow",
    autoDescription: "Bank/cash accounts + net customer/supplier advances",
  },
  {
    id: "accounts_receivable",
    label: "Accounts Receivable",
    group: "assets",
    parent: "Current Assets",
    autoLabel: "From approved invoices outstanding",
    autoDescription: "Approved invoices minus applied customer advances",
  },
  {
    id: "other_current_asset",
    label: "Other Current Assets",
    group: "assets",
    parent: "Current Assets",
    autoLabel: "Inventory + other asset accounts",
    autoDescription: "Stock valuation + non-bank / non-AR / non-fixed asset accounts",
  },
  {
    id: "accounts_payable",
    label: "Accounts Payable",
    group: "liabilities",
    parent: "Creditors ≤ 1yr",
    autoLabel: "From purchase bills outstanding",
    autoDescription: "Supplier bills minus supplier payments applied",
  },
  {
    id: "customer_advance",
    label: "Advance received from Customers",
    group: "liabilities",
    parent: "Creditors ≤ 1yr",
    autoLabel: "From unapplied customer advances",
    autoDescription: "Customer receipts not yet applied to an invoice",
  },
  {
    id: "corporation_tax_payable",
    label: "Corporation Tax Payable",
    group: "liabilities",
    parent: "Creditors ≤ 1yr",
    autoLabel: "From matching liability account",
  },
  {
    id: "rounding",
    label: "Rounding",
    group: "liabilities",
    parent: "Creditors ≤ 1yr",
    autoLabel: "From matching liability account",
  },
  {
    id: "other_current_liability",
    label: "Other Current Liabilities",
    group: "liabilities",
    parent: "Creditors ≤ 1yr",
    autoLabel: "From remaining liability accounts",
  },
  {
    id: "share_capital",
    label: "Share Capital",
    group: "equity",
    parent: "Capital and Reserves",
    autoLabel: "From equity accounts (capital subtype)",
  },
  {
    id: "retained_earnings",
    label: "Retained Earnings",
    group: "equity",
    parent: "Capital and Reserves",
    autoLabel: "From retained earnings account",
  },
  {
    id: "other_equity",
    label: "Other Equity",
    group: "equity",
    parent: "Capital and Reserves",
    autoLabel: "From remaining equity accounts",
  },
];

const GROUP_LABEL: Record<Group, string> = {
  assets: "Assets",
  liabilities: "Liabilities",
  equity: "Capital and Reserves",
};

/* ---------- Types ---------- */
type ManualEntry = {
  id: string;
  section: Section;
  name: string;
  description: string | null;
  amount: number;
  entry_date: string;
  account_id: string | null;
  notes: string | null;
  is_opening_balance: boolean;
};

/* ---------- Data fetchers ---------- */
async function fetchAuto(asOf: string) {
  const [coa, invs, bills, advs, stock] = await Promise.all([
    api.chartOfAccounts.list(),
    api.invoices.list(),
    api.purchaseInvoices.list(),
    api.advances.list(),
    api.stockMovements.list(),
  ]);
  return {
    coa: coa ?? [],
    invs: (invs ?? []).filter((i: any) => (i.issueDate ?? i.issue_date) <= asOf),
    bills: (bills ?? []).filter((b: any) => (b.issueDate ?? b.issue_date) <= asOf),
    advs: (advs ?? []).filter((a: any) => (a.advanceDate ?? a.advance_date) <= asOf),
    stock: (stock ?? []).filter(
      (s: any) =>
        (s.createdAt ?? s.created_at ?? "").slice(0, 10) <= asOf &&
        (s.status ?? "confirmed") === "confirmed",
    ),
  };
}

const APPROVED = new Set(["approved", "advanced", "paid", "overdue", "disputed"]);

function computeAuto(d: Awaited<ReturnType<typeof fetchAuto>>): Partial<Record<Section, number>> {
  const out: Partial<Record<Section, number>> = {};

  // Cash: bank/cash accounts (skip journal-based amounts, we don't compute here) + advances net flow
  let advFlow = 0;
  for (const a of d.advs) advFlow += (a.side === "sales" ? 1 : -1) * Number(a.amount || 0);
  out.cash_bank = advFlow;

  // AR: approved invoices outstanding
  const paidByInv = new Map<string, number>();
  for (const a of d.advs)
    if (a.side === "sales" && a.invoice_id)
      paidByInv.set(a.invoice_id, (paidByInv.get(a.invoice_id) ?? 0) + Number(a.amount || 0));
  let ar = 0;
  for (const i of d.invs as any[]) {
    if (!APPROVED.has(String(i.status))) continue;
    const out2 = Number(i.amount || 0) - (paidByInv.get(i.id) ?? 0);
    if (out2 > 0.005) ar += out2;
  }
  out.accounts_receivable = ar;

  // AP: bills outstanding
  const paidByBill = new Map<string, number>();
  for (const a of d.advs)
    if (a.side !== "sales" && a.purchase_invoice_id)
      paidByBill.set(
        a.purchase_invoice_id,
        (paidByBill.get(a.purchase_invoice_id) ?? 0) + Number(a.amount || 0),
      );
  let ap = 0;
  for (const b of d.bills as any[]) {
    const out2 = Number(b.amount || 0) - (paidByBill.get(b.id) ?? 0);
    if (out2 > 0.005) ap += out2;
  }
  out.accounts_payable = ap;

  // Customer advances (unapplied)
  let custAdv = 0;
  for (const a of d.advs) if (a.side === "sales" && !a.invoice_id) custAdv += Number(a.amount || 0);
  out.customer_advance = custAdv;

  // Inventory (in other_current_asset auto)
  const map = new Map<string, { qty: number; totalCost: number; unitAvg: number }>();
  const sorted = [...d.stock].sort((x: any, y: any) =>
    (x.created_at || "").localeCompare(y.created_at || ""),
  );
  for (const m of sorted as any[]) {
    const k = m.sku || m.item_name || m.id;
    const cur = map.get(k) ?? { qty: 0, totalCost: 0, unitAvg: 0 };
    const q = Number(m.quantity || 0),
      uc = Number(m.unit_cost || 0);
    // Inventory value = Σ(in qty × unit cost) − Σ(out qty × unit cost)
    if (m.direction === "in") {
      cur.qty += q;
      cur.totalCost += q * uc;
    } else {
      cur.qty -= q;
      cur.totalCost = Math.max(0, cur.totalCost - uc * q);
    }
    cur.unitAvg = cur.qty > 0 ? cur.totalCost / cur.qty : 0;
    map.set(k, cur);
  }
  let inv = 0;
  for (const v of map.values()) if (v.qty > 0.0001) inv += v.qty * v.unitAvg;
  out.other_current_asset = inv;

  // Tangible assets, share capital, retained, other equity — hint from accounts only (informational, not balances)
  return out;
}

/* =============================================
   Component
============================================= */
export function BalanceSheetEntries({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [openMode, setOpenMode] = useState<"add" | "opening">("add");
  const [editing, setEditing] = useState<{ section: Section; entry: ManualEntry | null } | null>(
    null,
  );

  const auto = useQuery({ queryKey: ["bs-entries-auto", asOf], queryFn: () => fetchAuto(asOf) });
  const autoTotals = useMemo(() => (auto.data ? computeAuto(auto.data) : {}), [auto.data]);

  const entriesQ = useQuery({
    queryKey: ["bs-entries", asOf],
    queryFn: async () => {
      const data = await api.balanceEntries.list();
      return ((data ?? []) as ManualEntry[])
        .filter((e: any) => (e.entryDate ?? e.entry_date) <= asOf)
        .reverse();
    },
  });

  useEffect(() => {
    const interval = setInterval(() => {
      qc.invalidateQueries({ queryKey: ["bs-entries"] });
      qc.invalidateQueries({ queryKey: ["bs-entries-auto"] });
      qc.invalidateQueries({ queryKey: ["bs"] });
    }, 30000);
    return () => clearInterval(interval);
  }, [qc]);

  const entriesBySection = useMemo(() => {
    const map = new Map<Section, ManualEntry[]>();
    for (const e of entriesQ.data ?? []) {
      const arr = map.get(e.section) ?? [];
      arr.push(e);
      map.set(e.section, arr);
    }
    return map;
  }, [entriesQ.data]);

  const sectionSubtotal = (s: Section) =>
    (entriesBySection.get(s) ?? []).reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const autoOf = (s: Section) => autoTotals[s] ?? 0;
  const totalOf = (s: Section) => autoOf(s) + sectionSubtotal(s);

  const groupTotal = (g: Group) =>
    SECTIONS.filter((s) => s.group === g).reduce((sum, s) => sum + totalOf(s.id), 0);

  const totalAssets = groupTotal("assets");
  const totalLiab = groupTotal("liabilities");
  const totalEquity = groupTotal("equity");
  const diff = totalAssets - (totalLiab + totalEquity);

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs uppercase tracking-widest text-muted-foreground">As of</label>
          <input
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          />
          <div className="ml-2 inline-flex rounded-md border border-border">
            <button
              onClick={() => setOpenMode("add")}
              className={`px-3 py-1.5 text-xs ${openMode === "add" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            >
              <Sparkles className="mr-1 inline h-3.5 w-3.5" /> New entries
            </button>
            <button
              onClick={() => setOpenMode("opening")}
              className={`px-3 py-1.5 text-xs ${openMode === "opening" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            >
              <HistoryIcon className="mr-1 inline h-3.5 w-3.5" /> Opening balances
            </button>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          Balance check:{" "}
          <span className={Math.abs(diff) < 0.01 ? "text-emerald-600" : "text-destructive"}>
            {Math.abs(diff) < 0.01 ? "Balanced" : `Off by ${fmtAccounting(diff)}`}
          </span>
        </div>
      </div>

      {/* Section groups */}
      {(["assets", "liabilities", "equity"] as Group[]).map((group) => {
        const sections = SECTIONS.filter((s) => s.group === group);
        return (
          <Card key={group} title={`${GROUP_LABEL[group]} — ${fmtAccounting(groupTotal(group))}`}>
            <div className="space-y-6">
              {sections.map((meta) => {
                const rows = entriesBySection.get(meta.id) ?? [];
                const autoVal = autoOf(meta.id);
                const manVal = sectionSubtotal(meta.id);
                const total = autoVal + manVal;
                return (
                  <div key={meta.id} className="border border-border rounded-lg">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-2">
                      <div>
                        <div className="text-xs uppercase tracking-widest text-muted-foreground">
                          {meta.parent}
                        </div>
                        <div className="font-medium">{meta.label}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                            Section total
                          </div>
                          <div className="font-mono text-base">{fmtAccounting(total)}</div>
                        </div>
                        <button
                          onClick={() => setEditing({ section: meta.id, entry: null })}
                          className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
                        >
                          <Plus className="h-3.5 w-3.5" /> Add
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-border">
                      {/* Automatic */}
                      <div className="p-4">
                        <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                          <Sparkles className="h-3 w-3" /> Auto from platform
                        </div>
                        <div className="flex items-baseline justify-between">
                          <div>
                            <div className="text-sm">{meta.autoLabel ?? "—"}</div>
                            {meta.autoDescription && (
                              <div className="mt-1 flex items-start gap-1 text-[11px] text-muted-foreground">
                                <Info className="mt-0.5 h-3 w-3 shrink-0" /> {meta.autoDescription}
                              </div>
                            )}
                          </div>
                          <div className="font-mono text-sm">{fmtAccounting(autoVal)}</div>
                        </div>
                      </div>

                      {/* Manual */}
                      <div className="p-4">
                        <div className="mb-2 flex items-center justify-between">
                          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                            Manual entries · {rows.length}
                          </div>
                          <div className="font-mono text-sm">{fmtAccounting(manVal)}</div>
                        </div>
                        {rows.length === 0 ? (
                          <div className="text-xs italic text-muted-foreground">
                            No manual entries — use "Add" above.
                          </div>
                        ) : (
                          <ul className="space-y-1.5">
                            {rows.map((r) => (
                              <li
                                key={r.id}
                                className="group flex items-center justify-between gap-2 rounded border border-transparent px-2 py-1 text-xs hover:border-border hover:bg-muted/40"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="truncate">{r.name}</span>
                                    {r.is_opening_balance && (
                                      <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-primary">
                                        Opening
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-muted-foreground">
                                    {fmtDate(r.entry_date)}
                                    {r.description ? ` · ${r.description}` : ""}
                                  </div>
                                </div>
                                <div className="font-mono">{fmtAccounting(r.amount)}</div>
                                <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                                  <button
                                    onClick={() => setEditing({ section: meta.id, entry: r })}
                                    title="Edit"
                                  >
                                    <Pencil className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                                  </button>
                                  <button
                                    onClick={async () => {
                                      if (!confirm("Delete this entry?")) return;
                                      await api.balanceEntries.delete(r.id);
                                      toast.success("Deleted");
                                      qc.invalidateQueries({ queryKey: ["bs-entries"] });
                                      qc.invalidateQueries({ queryKey: ["bs"] });
                                    }}
                                    title="Delete"
                                  >
                                    <Trash2 className="h-3 w-3 text-destructive" />
                                  </button>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}

      {/* Summary strip */}
      <Card title="Balance Sheet totals">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <SumTile label="Total Assets" value={totalAssets} />
          <SumTile label="Total Liabilities" value={totalLiab} />
          <SumTile label="Total Equity" value={totalEquity} />
        </div>
        <div className="mt-3 text-center text-xs">
          Assets − (Liabilities + Equity) ={" "}
          <span className={Math.abs(diff) < 0.01 ? "text-emerald-600" : "text-destructive"}>
            {fmtAccounting(diff)}
          </span>
        </div>
      </Card>

      {editing && (
        <EntryModal
          userId={userId}
          asOf={asOf}
          defaultOpening={openMode === "opening"}
          section={editing.section}
          entry={editing.entry}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ["bs-entries"] });
            qc.invalidateQueries({ queryKey: ["bs"] });
          }}
        />
      )}
    </div>
  );
}

function SumTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-2xl">{fmtAccounting(value)}</div>
    </div>
  );
}

/* ---------- Entry modal ---------- */
function EntryModal({
  userId,
  asOf,
  defaultOpening,
  section,
  entry,
  onClose,
  onSaved,
}: {
  userId: string;
  asOf: string;
  defaultOpening: boolean;
  section: Section;
  entry: ManualEntry | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(entry?.name ?? "");
  const [description, setDescription] = useState(entry?.description ?? "");
  const [amount, setAmount] = useState<string>(entry?.amount != null ? String(entry.amount) : "");
  const [entryDate, setEntryDate] = useState(entry?.entry_date ?? asOf);
  const [accountId, setAccountId] = useState<string>(entry?.account_id ?? "");
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [isOpening, setIsOpening] = useState(entry?.is_opening_balance ?? defaultOpening);

  const coa = useQuery({
    queryKey: ["coa-list"],
    queryFn: async () => {
      const data = await api.chartOfAccounts.list();
      return data
        .map((a: any) => ({ id: a.id, code: a.code, name: a.name }))
        .sort((a: any, b: any) => a.code?.localeCompare(b.code ?? "") ?? 0);
    },
  });

  const meta = SECTIONS.find((s) => s.id === section)!;

  const save = useMutation({
    mutationFn: async () => {
      const payload: any = {
        client_id: userId,
        section,
        name,
        description: description || null,
        amount: Number(amount || 0),
        entry_date: entryDate,
        account_id: accountId || null,
        notes: notes || null,
        is_opening_balance: isOpening,
      };
      if (entry) {
        await api.balanceEntries.update(entry.id, payload);
      } else {
        await api.balanceEntries.create(payload);
      }
    },
    onSuccess: () => {
      toast.success(entry ? "Entry updated" : "Entry added");
      onSaved();
    },
    onError: (e: any) => toast.error(e.message || "Failed"),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-xl rounded-xl border border-border bg-background p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              {meta.group === "assets"
                ? "Assets"
                : meta.group === "liabilities"
                  ? "Liabilities"
                  : "Capital and Reserves"}{" "}
              · {meta.parent}
            </div>
            <h3 className="font-display text-xl">{meta.label}</h3>
            <p className="text-xs text-muted-foreground">
              {entry
                ? "Edit entry"
                : isOpening
                  ? "Add opening balance (carry-forward)"
                  : "Add manual entry"}
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-xs text-muted-foreground">Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Amount *</label>
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-right font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Date</label>
            <input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
            />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-muted-foreground">Account (optional)</label>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
            >
              <option value="">— None —</option>
              {(coa.data ?? []).map((a: any) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="text-xs text-muted-foreground">Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
            />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-muted-foreground">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
            />
          </div>
          <label className="col-span-2 mt-1 inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isOpening}
              onChange={(e) => setIsOpening(e.target.checked)}
            />
            <span>
              This is an <strong>opening balance</strong> (carry-forward from previous period)
            </span>
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
          <button
            disabled={!name || !amount || save.isPending}
            onClick={() => save.mutate()}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
          >
            {entry ? "Update" : "Add entry"}
          </button>
        </div>
      </div>
    </div>
  );
}
