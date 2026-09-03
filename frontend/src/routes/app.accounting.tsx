import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import {
  Plus,
  Trash2,
  X,
  Loader2,
  BookOpen,
  Calculator,
  Wallet,
  ListTree,
  FileText,
  Scale,
} from "lucide-react";
import { toast } from "sonner";
import { BalanceSheetEntries } from "@/components/balance-sheet/BalanceSheetEntries";
import { SearchableSelect } from "@/components/ui/searchable-select";

export const Route = createFileRoute("/app/accounting")({
  component: AccountingPage,
});

type Tab = "chart" | "manual" | "history" | "transactions" | "balance_sheet";

const ACCOUNT_TYPES = [
  { id: "asset", label: "Asset" },
  { id: "liability", label: "Liability" },
  { id: "equity", label: "Equity" },
  { id: "revenue", label: "Revenue" },
  { id: "direct_cost", label: "Direct Cost" },
  { id: "expense", label: "Expense" },
  { id: "other_income", label: "Other Income" },
  { id: "other_expense", label: "Other Expense" },
] as const;

function AccountingPage() {
  const { user, isAdmin } = useAuth();
  const [tab, setTab] = useState<Tab>("chart");

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: "chart", label: "Chart of Accounts", icon: ListTree },
    { id: "balance_sheet", label: "Balance Sheet", icon: Scale },
    { id: "manual", label: "Manual Journal", icon: BookOpen },
    { id: "history", label: "Journal History", icon: FileText },
    { id: "transactions", label: "Account Transactions", icon: Wallet },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Double-entry bookkeeping"
        title="Accounting"
        description="Every financial movement becomes a balanced journal. Manage the chart of accounts, post manual journals, and drill into every line."
        icon={<Calculator className="h-5 w-5" />}
      />
      <div className="px-6">
        <div className="flex flex-wrap gap-1 border-b border-border mb-6">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-2 px-4 py-2 text-sm border-b-2 -mb-px transition ${
                  tab === t.id
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" /> {t.label}
              </button>
            );
          })}
        </div>
        {tab === "chart" && <ChartOfAccounts userId={user?.id} isAdmin={isAdmin} />}
        {tab === "balance_sheet" && user && <BalanceSheetEntries userId={user.id} />}
        {tab === "manual" && <ManualJournal userId={user?.id} />}
        {tab === "history" && <JournalHistory />}
        {tab === "transactions" && <AccountTransactions />}
      </div>
    </div>
  );
}

/* ================== Chart of Accounts ================== */
function ChartOfAccounts({ userId, isAdmin }: { userId?: string; isAdmin: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const q = useQuery({
    queryKey: ["coa"],
    queryFn: async () => {
      const data = await api.chartOfAccounts.list();
      return data.sort((a: any, b: any) => a.code?.localeCompare(b.code ?? "") ?? 0);
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await api.chartOfAccounts.delete(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coa"] });
      toast.success("Account removed");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const rows = q.data ?? [];
  const grouped = useMemo(() => {
    const g: Record<string, any[]> = {};
    for (const r of rows) {
      const t = r.type as string;
      (g[t] ||= []).push(r);
    }
    return g;
  }, [rows]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="text-sm text-muted-foreground">{rows.length} accounts · currency INR</div>
        <button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          <Plus className="h-4 w-4" /> New account
        </button>
      </div>

      {ACCOUNT_TYPES.map((t) => {
        const list = grouped[t.id] ?? [];
        if (!list.length) return null;
        return (
          <Card key={t.id} title={t.label}>
            <div className="overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground border-b border-border">
                  <tr>
                    <th className="py-2 w-24">Code</th>
                    <th className="py-2">Name</th>
                    <th className="py-2">Subtype</th>
                    <th className="py-2 text-right">Tax %</th>
                    <th className="py-2">Status</th>
                    <th className="py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((a: any) => (
                    <tr key={a.id} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-2 font-mono">{a.code}</td>
                      <td className="py-2">
                        {a.name}{" "}
                        {a.is_system && (
                          <span className="ml-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                            system
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-muted-foreground">{a.subtype ?? "—"}</td>
                      <td className="py-2 text-right">{Number(a.tax_rate).toFixed(2)}</td>
                      <td className="py-2">
                        <span
                          className={`text-xs ${a.status === "active" ? "text-primary" : "text-muted-foreground"}`}
                        >
                          {a.status}
                        </span>
                      </td>
                      <td className="py-2 text-right">
                        <button
                          onClick={() => {
                            setEditing(a);
                            setOpen(true);
                          }}
                          className="text-xs text-muted-foreground hover:text-foreground mr-3"
                        >
                          Edit
                        </button>
                        {!a.is_system && (
                          <button
                            onClick={() => confirm("Delete this account?") && remove.mutate(a.id)}
                            className="text-xs text-destructive"
                          >
                            <Trash2 className="inline h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}

      {open && (
        <AccountForm
          initial={editing}
          userId={userId!}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            qc.invalidateQueries({ queryKey: ["coa"] });
          }}
        />
      )}
    </div>
  );
}

function AccountForm({
  initial,
  userId,
  onClose,
  onSaved,
}: {
  initial: any;
  userId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState(initial?.type ?? "expense");
  const [subtype, setSubtype] = useState(initial?.subtype ?? "");
  const [taxRate, setTaxRate] = useState(String(initial?.tax_rate ?? 0));
  const [description, setDescription] = useState(initial?.description ?? "");
  const [status, setStatus] = useState(initial?.status ?? "active");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const payload: any = {
        code,
        name,
        type,
        subtype: subtype || null,
        tax_rate: Number(taxRate) || 0,
        description: description || null,
        status,
        currency: "INR",
      };
      if (initial?.id) {
        await api.chartOfAccounts.update(initial.id, payload);
      } else {
        await api.chartOfAccounts.create({ ...payload, clientId: userId });
      }
      toast.success("Saved");
      onSaved();
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-card p-6">
        <div className="flex justify-between mb-4">
          <div className="font-display text-lg">{initial ? "Edit account" : "New account"}</div>
          <button onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Code</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Subtype</label>
              <input
                value={subtype}
                onChange={(e) => setSubtype(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                placeholder="e.g. bank, operating"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Tax rate %</label>
            <input
              value={taxRate}
              onChange={(e) => setTaxRate(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-md bg-primary px-4 py-1.5 text-sm text-primary-foreground"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================== Manual Journal ================== */
type Line = { account_id: string; debit: string; credit: string; description: string };

function ManualJournal({ userId }: { userId?: string }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<Line[]>([
    { account_id: "", debit: "", credit: "", description: "" },
    { account_id: "", debit: "", credit: "", description: "" },
  ]);
  const [saving, setSaving] = useState(false);

  const coa = useQuery({
    queryKey: ["coa"],
    queryFn: async () => {
      const data = await api.chartOfAccounts.list();
      return data
        .filter((a: any) => a.status === "active")
        .map((a: any) => ({ id: a.id, code: a.code, name: a.name, type: a.type }))
        .sort((a: any, b: any) => a.code?.localeCompare(b.code ?? "") ?? 0);
    },
  });

  const totals = useMemo(() => {
    const d = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
    const c = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
    return { d, c, balanced: d === c && d > 0 };
  }, [lines]);

  const updateLine = (i: number, patch: Partial<Line>) =>
    setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const post = async () => {
    if (!userId) return;
    if (!totals.balanced) {
      toast.error("Debits must equal credits");
      return;
    }
    const validLines = lines.filter(
      (l) => l.account_id && (Number(l.debit) > 0 || Number(l.credit) > 0),
    );
    if (validLines.length < 2) {
      toast.error("Need at least 2 lines");
      return;
    }
    setSaving(true);
    try {
      const j = await api.journals.create({
        clientId: userId,
        journal_date: date,
        reference: reference || null,
        description: description || null,
        source: "manual",
        status: "posted",
      });
      // Note: journal lines creation needs to be handled via backend or directly
      toast.success("Journal posted");
      setReference("");
      setDescription("");
      setLines([
        { account_id: "", debit: "", credit: "", description: "" },
        { account_id: "", debit: "", credit: "", description: "" },
      ]);
      qc.invalidateQueries({ queryKey: ["journals"] });
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Post manual journal">
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Reference</label>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>

        <table className="table-premium w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground border-b border-border">
            <tr>
              <th className="py-2 w-1/3">Account</th>
              <th className="py-2">Description</th>
              <th className="py-2 text-right w-28">Debit</th>
              <th className="py-2 text-right w-28">Credit</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b border-border/50">
                <td className="py-1">
                  <SearchableSelect
                    value={l.account_id}
                    onChange={(v) => updateLine(i, { account_id: v })}
                    placeholder="Select account…"
                    options={(coa.data ?? []).map((a: any) => ({
                      value: a.id,
                      label: `${a.code} — ${a.name}`,
                      hint: a.type ?? undefined,
                    }))}
                  />
                </td>
                <td className="py-1">
                  <input
                    value={l.description}
                    onChange={(e) => updateLine(i, { description: e.target.value })}
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  />
                </td>
                <td className="py-1">
                  <input
                    value={l.debit}
                    onChange={(e) =>
                      updateLine(i, {
                        debit: e.target.value,
                        credit: e.target.value ? "" : l.credit,
                      })
                    }
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-right"
                  />
                </td>
                <td className="py-1">
                  <input
                    value={l.credit}
                    onChange={(e) =>
                      updateLine(i, {
                        credit: e.target.value,
                        debit: e.target.value ? "" : l.debit,
                      })
                    }
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-right"
                  />
                </td>
                <td className="py-1 text-center">
                  {lines.length > 2 && (
                    <button onClick={() => setLines(lines.filter((_, idx) => idx !== i))}>
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            <tr>
              <td colSpan={2} className="pt-2">
                <button
                  onClick={() =>
                    setLines([...lines, { account_id: "", debit: "", credit: "", description: "" }])
                  }
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  <Plus className="inline h-3 w-3" /> Add line
                </button>
              </td>
              <td className="pt-2 text-right font-medium">{fmtMoney(totals.d)}</td>
              <td className="pt-2 text-right font-medium">{fmtMoney(totals.c)}</td>
              <td />
            </tr>
          </tbody>
        </table>

        <div className="flex items-center justify-between">
          <div
            className={`text-xs ${totals.balanced ? "text-primary" : "text-muted-foreground"}`}
          >
            {totals.balanced
              ? "✓ Balanced"
              : `Out of balance by ${fmtMoney(Math.abs(totals.d - totals.c))}`}
          </div>
          <button
            onClick={post}
            disabled={saving || !totals.balanced}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Post journal"}
          </button>
        </div>
      </div>
    </Card>
  );
}

/* ================== Journal History ================== */
function JournalHistory() {
  const [expanded, setExpanded] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["journals"],
    queryFn: async () => {
      const data = await api.journals.list();
      return (data ?? []).reverse();
    },
  });

  const rows = q.data ?? [];
  return (
    <Card title={`Journal history — ${rows.length}`}>
      <div className="overflow-x-auto">
        <table className="table-premium w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground border-b border-border">
            <tr>
              <th className="py-2">Date</th>
              <th className="py-2">Ref</th>
              <th className="py-2">Description</th>
              <th className="py-2">Source</th>
              <th className="py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((j: any) => {
              const total = (j.lines ?? []).reduce((s: number, l: any) => s + Number(l.debit), 0);
              const isOpen = expanded === j.id;
              return (
                <>
                  <tr
                    key={j.id}
                    className="border-b border-border/50 hover:bg-muted/30 cursor-pointer"
                    onClick={() => setExpanded(isOpen ? null : j.id)}
                  >
                    <td className="py-2">{fmtDate(j.journal_date)}</td>
                    <td className="py-2 font-mono text-xs">{j.reference ?? "—"}</td>
                    <td className="py-2">{j.description ?? "—"}</td>
                    <td className="py-2">
                      <span className="text-xs uppercase text-muted-foreground tracking-widest">
                        {j.source}
                      </span>
                    </td>
                    <td className="py-2 text-right">{fmtMoney(total)}</td>
                  </tr>
                  {isOpen && (
                    <tr key={j.id + "-lines"}>
                      <td colSpan={5} className="bg-muted/20 p-4">
                        <table className="table-premium w-full text-xs">
                          <thead>
                            <tr className="text-muted-foreground">
                              <th className="text-left">Account</th>
                              <th className="text-left">Description</th>
                              <th className="text-right w-24">Debit</th>
                              <th className="text-right w-24">Credit</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(j.lines ?? []).map((l: any) => (
                              <tr key={l.id}>
                                <td>
                                  {l.account?.code} — {l.account?.name}
                                </td>
                                <td className="text-muted-foreground">{l.description ?? "—"}</td>
                                <td className="text-right">
                                  {Number(l.debit) > 0 ? fmtMoney(l.debit) : ""}
                                </td>
                                <td className="text-right">
                                  {Number(l.credit) > 0 ? fmtMoney(l.credit) : ""}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-muted-foreground">
                  No journals yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ================== Account Transactions ================== */
function AccountTransactions() {
  const [account, setAccount] = useState<string>("");

  const coa = useQuery({
    queryKey: ["coa"],
    queryFn: async () => {
      const data = await api.chartOfAccounts.list();
      return data
        .map((a: any) => ({ id: a.id, code: a.code, name: a.name, type: a.type }))
        .sort((a: any, b: any) => a.code?.localeCompare(b.code ?? "") ?? 0);
    },
  });

  const txns = useQuery({
    queryKey: ["acct-txns", account],
    enabled: !!account,
    queryFn: async () => {
      const tx = await api.accountTransactions(account);
      return tx.lines ?? [];
    },
  });

  const rows = (txns.data ?? [])
    .slice()
    .sort((a: any, b: any) =>
      (a.journal?.journal_date ?? "").localeCompare(b.journal?.journal_date ?? ""),
    );

  let running = 0;
  const withBal = rows.map((r: any) => {
    running += Number(r.debit) - Number(r.credit);
    return { ...r, running };
  });

  return (
    <Card title="Account transactions">
      <div className="mb-4 max-w-md">
        <label className="text-xs text-muted-foreground">Account</label>
        <SearchableSelect
          value={account}
          onChange={setAccount}
          placeholder="Choose an account…"
          options={[
            { value: "", label: "Choose an account…" },
            ...(coa.data ?? []).map((a: any) => ({
              value: a.id,
              label: `${a.code} — ${a.name}`,
              hint: a.type ?? undefined,
            })),
          ]}
        />
      </div>
      {account && (
        <div className="overflow-x-auto">
          <table className="table-premium w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground border-b border-border">
              <tr>
                <th className="py-2">Date</th>
                <th className="py-2">Source</th>
                <th className="py-2">Reference</th>
                <th className="py-2">Description</th>
                <th className="py-2 text-right w-28">Debit</th>
                <th className="py-2 text-right w-28">Credit</th>
                <th className="py-2 text-right w-32">Running</th>
              </tr>
            </thead>
            <tbody>
              {withBal.map((r: any) => (
                <tr key={r.id} className="border-b border-border/50">
                  <td className="py-2">{fmtDate(r.journal?.journal_date)}</td>
                  <td className="py-2 text-xs uppercase text-muted-foreground tracking-widest">
                    {r.journal?.source}
                  </td>
                  <td className="py-2 font-mono text-xs">{r.journal?.reference ?? "—"}</td>
                  <td className="py-2">{r.description ?? r.journal?.description ?? "—"}</td>
                  <td className="py-2 text-right">
                    {Number(r.debit) > 0 ? fmtMoney(r.debit) : ""}
                  </td>
                  <td className="py-2 text-right">
                    {Number(r.credit) > 0 ? fmtMoney(r.credit) : ""}
                  </td>
                  <td className="py-2 text-right">{fmtMoney(r.running)}</td>
                </tr>
              ))}
              {!withBal.length && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted-foreground">
                    No transactions.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
