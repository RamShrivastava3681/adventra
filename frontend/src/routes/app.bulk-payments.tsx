import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useCallback } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney } from "@/components/ledger-ui";
import {
  ArrowRightLeft, Loader2, CheckCircle2, Wallet, AlertTriangle,
  Building2, CalendarDays, DollarSign, CreditCard, SkipForward, History,
  ScrollText, ChevronDown, Undo2, AlertCircle, Users, Truck, Lock,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/app/bulk-payments")({
  component: BulkPaymentsPage,
});

// ── Types ──

type CounterpartyType = "debtor" | "supplier";

interface DebtorInfo {
  id: string;
  name: string;
  industry?: string | null;
}

interface SupplierInfo {
  id: string;
  name: string;
  industry?: string | null;
}

interface InvoiceInfo {
  id: string;
  invoice_number: string;
  amount: number;
  amount_received: number | null;
  issue_date: string;
  due_date: string | null;
  status: string;
  debtor?: { name: string } | null;
  vendor?: { name: string } | null;
}

interface PurchaseInvoiceInfo {
  id: string;
  invoice_number: string;
  amount: number;
  amount_paid: number | null;
  issue_date: string;
  due_date: string | null;
  status: string;
  vendor?: { name: string } | null;
}

interface CreditNoteInfo {
  id: string;
  note_number: string;
  amount: number;
  date: string;
  status: string;
}

interface PaymentHistoryRecord {
  id: string;
  debtor_id: string;
  debtor_name: string;
  amount: number;
  payment_date: string;
  remaining: number;
  invoices_closed: number;
  credit_note_ids: string[];
  mode: "manual" | "fifo" | "two_pass_fifo";
  created_at: string;
}

interface PaymentResult {
  payment_id: string;
  amount: number;
  remaining: number;
  supplier_name?: string;
  closed: Array<{ id: string; invoice_number: string; amount: number; late_payment_days: number }>;
  partially_paid: Array<{ id: string; invoice_number: string; amount_paid: number; remaining: number }>;
  skipped: Array<{ id: string; invoice_number: string; reason: string }>;
  settled_credits: string[];
  credit_errors: Array<{ id: string; error: string }>;
}

// Invoices the funding queue treats as payable — mirrors app.queue.tsx.
const AR_CLOSED_STATUSES = new Set(["paid", "rejected", "disputed", "cancelled", "draft"]);
const AP_CLOSED_STATUSES = new Set(["paid", "rejected", "disputed", "cancelled", "draft", "submitted"]);

// ── Helpers ──

function isOverdue(dueDate: string | null, anchorDate: string): boolean {
  if (!dueDate) return false;
  return dueDate < anchorDate;
}

function daysLateCalc(dueDate: string | null, anchorDate: string): number {
  if (!dueDate) return 0;
  return Math.max(0, Math.round((new Date(anchorDate).getTime() - new Date(dueDate).getTime()) / 86400000));
}

function fmtDateShort(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function outstanding(inv: InvoiceInfo): number {
  return inv.amount_received != null ? Math.max(0, inv.amount - inv.amount_received) : inv.amount;
}

function outstandingPurchase(inv: PurchaseInvoiceInfo): number {
  return inv.amount_paid != null ? Math.max(0, inv.amount - inv.amount_paid) : inv.amount;
}

// ── FIFO Preview (strict — no partials) ──
function computeFifoPreview<T extends { id: string; due_date: string | null }>(
  invoices: T[],
  amount: number,
  isTwoPass: boolean,
  paymentDate: string,
  outstandingFn: (inv: T) => number,
): {
  closed: Array<{ inv: T; amount: number; lateDays: number; isFuture: boolean }>;
  skipped: T[];
  remaining: number;
} {
  let remaining = amount;
  const closed: Array<{ inv: T; amount: number; lateDays: number; isFuture: boolean }> = [];
  const skipped: T[] = [];

  const sorted = [...invoices].sort((a, b) =>
    (a.due_date ?? "9999-12-31").localeCompare(b.due_date ?? "9999-12-31")
  );

  if (isTwoPass) {
    const overdue = sorted.filter((inv) => inv.due_date != null && inv.due_date <= paymentDate);
    const future = sorted.filter((inv) => inv.due_date == null || inv.due_date > paymentDate);

    for (const inv of overdue) {
      if (remaining <= 0) { skipped.push(inv); continue; }
      const bal = outstandingFn(inv);
      if (remaining >= bal) {
        closed.push({ inv, amount: bal, lateDays: daysLateCalc(inv.due_date, paymentDate), isFuture: false });
        remaining -= bal;
      } else {
        skipped.push(inv);
      }
    }

    for (const inv of future) {
      if (remaining <= 0) { skipped.push(inv); continue; }
      const bal = outstandingFn(inv);
      if (remaining >= bal) {
        closed.push({ inv, amount: bal, lateDays: 0, isFuture: true });
        remaining -= bal;
      } else {
        skipped.push(inv);
      }
    }
  } else {
    for (const inv of sorted) {
      if (remaining <= 0) { skipped.push(inv); continue; }
      const bal = outstandingFn(inv);
      if (remaining >= bal) {
        closed.push({ inv, amount: bal, lateDays: daysLateCalc(inv.due_date, paymentDate), isFuture: false });
        remaining -= bal;
      } else {
        skipped.push(inv);
      }
    }
  }

  return { closed, skipped, remaining };
}

// ── Manual Preview (process in due_date order, allow partials) ──
function computeManualPreview<T extends { id: string; due_date: string | null }>(
  invoices: T[],
  selectedIds: Set<string>,
  amount: number,
  paymentDate: string,
  outstandingFn: (inv: T) => number,
): {
  closed: Array<{ inv: T; amount: number; lateDays: number }>;
  partiallyPaid: Array<{ inv: T; amountPaid: number; remainingBalance: number }>;
  untouched: T[];
  remaining: number;
} {
  const sorted = [...invoices]
    .filter((inv) => selectedIds.has(inv.id))
    .sort((a, b) =>
      (a.due_date ?? "9999-12-31").localeCompare(b.due_date ?? "9999-12-31")
    );

  let remaining = amount;
  const closed: Array<{ inv: T; amount: number; lateDays: number }> = [];
  const partiallyPaid: Array<{ inv: T; amountPaid: number; remainingBalance: number }> = [];

  for (const inv of sorted) {
    if (remaining <= 0) break;
    const bal = outstandingFn(inv);

    if (remaining >= bal) {
      closed.push({ inv, amount: bal, lateDays: daysLateCalc(inv.due_date, paymentDate) });
      remaining -= bal;
    } else {
      partiallyPaid.push({ inv, amountPaid: remaining, remainingBalance: bal - remaining });
      remaining = 0;
    }
  }

  const untouched = invoices.filter((inv) => !selectedIds.has(inv.id));

  return { closed, partiallyPaid, untouched, remaining };
}

// ── Page Component ──

function BulkPaymentsPage() {
  const { isAdmin, isTreasury } = useAuth();
  const canWrite = isAdmin || isTreasury;
  const qc = useQueryClient();

  // ── Core state ──
  const [counterpartyType, setCounterpartyType] = useState<CounterpartyType>("debtor");
  const [selectedDebtorId, setSelectedDebtorId] = useState<string>("");
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>("");
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [inputAmount, setInputAmount] = useState("");
  const [useBalance, setUseBalance] = useState(false);
  const [applyCredit, setApplyCredit] = useState(false);
  const [mode, setMode] = useState<"fifo" | "two_pass_fifo" | "manual">("fifo");
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<string>>(new Set());

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<PaymentResult | null>(null);
  const [historyFilterDebtorId, setHistoryFilterDebtorId] = useState<string>("");
  const [historyOpen, setHistoryOpen] = useState(false);

  const isSupplier = counterpartyType === "supplier";

  // ── Queries ──

  const debtorsQ = useQuery({
    queryKey: ["debtors"],
    queryFn: async () => (await api.debtors.list()) ?? [],
  });

  const suppliersQ = useQuery({
    queryKey: ["vendors"],
    queryFn: async () => (await api.vendors.list()) ?? [],
  });

  // ── Payment history (lazy-loaded when card is opened) ──
  const historyQ = useQuery({
    queryKey: ["bulk-payment-history", historyFilterDebtorId],
    enabled: historyOpen,
    queryFn: async (): Promise<{ payments: PaymentHistoryRecord[]; totals: { total_payments: number; total_amount: number; total_remaining: number } }> => {
      const params = historyFilterDebtorId ? `?debtor_id=${historyFilterDebtorId}` : "";
      return (await api.get<any>(`/bulk-payments/history${params}`)) ?? { payments: [], totals: { total_payments: 0, total_amount: 0, total_remaining: 0 } };
    },
  });

  // ── Fetch previous remaining balance (debtor) ──
  const balanceQ = useQuery({
    queryKey: ["bulk-payment-balance", selectedDebtorId],
    enabled: !!selectedDebtorId && useBalance && !isSupplier,
    queryFn: async (): Promise<number> => {
      const res = await api.get<{ total_remaining: number }>(`/bulk-payments/balance/${selectedDebtorId}`);
      return res?.total_remaining ?? 0;
    },
  });

  // ── Fetch previous remaining balance (supplier) ──
  const supplierBalanceQ = useQuery({
    queryKey: ["bulk-payment-purchase-balance", selectedSupplierId],
    enabled: !!selectedSupplierId && useBalance && isSupplier,
    queryFn: async (): Promise<number> => {
      const res = await api.get<{ total_remaining: number }>(`/bulk-payments/purchase-balance/${selectedSupplierId}`);
      return res?.total_remaining ?? 0;
    },
  });

  const previousRemaining = isSupplier ? (supplierBalanceQ.data ?? 0) : (balanceQ.data ?? 0);

  // ── Fetch invoices (sales) ──
  const invoicesQ = useQuery({
    queryKey: ["bulk-payment-invoices", selectedDebtorId],
    enabled: !!selectedDebtorId && !isSupplier,
    queryFn: async (): Promise<InvoiceInfo[]> => {
      const all = await api.invoices.list() ?? [];
      return all
        .filter((i: any) => i.debtor_id === selectedDebtorId && !AR_CLOSED_STATUSES.has(i.status))
        .map((i: any) => ({
          id: i.id,
          invoice_number: i.invoice_number,
          amount: Number(i.amount),
          amount_received: i.amount_received != null ? Number(i.amount_received) : null,
          issue_date: i.issue_date,
          due_date: i.due_date,
          status: i.status,
          debtor: i.debtor ? { name: i.debtor.name } : null,
        }));
    },
  });

  // ── Fetch purchase invoices ──
  const purchaseInvoicesQ = useQuery({
    queryKey: ["bulk-payment-purchase-invoices", selectedSupplierId],
    enabled: !!selectedSupplierId && isSupplier,
    queryFn: async (): Promise<PurchaseInvoiceInfo[]> => {
      const all = await api.purchaseInvoices.list() ?? [];
      // Match purchase invoices by vendor_id (direct match, no cross-table lookup needed)
      return all
        .filter((i: any) => i.vendor_id === selectedSupplierId && !AP_CLOSED_STATUSES.has(i.status))
        .map((i: any) => ({
          id: i.id,
          invoice_number: i.invoice_number,
          amount: Number(i.amount),
          amount_paid: i.amount_paid != null ? Number(i.amount_paid) : null,
          issue_date: i.issue_date,
          due_date: i.due_date,
          status: i.status,
          vendor: i.vendor ? { name: i.vendor.name } : null,
        }));
    },
  });

  const openInvoices: (InvoiceInfo | PurchaseInvoiceInfo)[] = isSupplier
    ? (purchaseInvoicesQ.data ?? [])
    : (invoicesQ.data ?? []);

  // Sort invoices by due date ascending (earliest first), null due dates last
  const sortedInvoices = useMemo(() => {
    return [...openInvoices].sort((a, b) =>
      (a.due_date ?? "9999-12-31").localeCompare(b.due_date ?? "9999-12-31")
    );
  }, [openInvoices]);

  // ── Fetch credit notes ──
  const creditNotesQ = useQuery({
    queryKey: ["bulk-payment-credits", isSupplier ? selectedSupplierId : selectedDebtorId, isSupplier],
    enabled: isSupplier ? !!selectedSupplierId : !!selectedDebtorId,
    queryFn: async (): Promise<{ total: number; notes: CreditNoteInfo[] }> => {
      let partyName: string | undefined;
      if (isSupplier) {
        const supplier = (suppliersQ.data ?? []).find((s) => s.id === selectedSupplierId);
        partyName = supplier?.name;
      } else {
        const debtor = (debtorsQ.data ?? []).find((d) => d.id === selectedDebtorId);
        partyName = debtor?.name;
      }
      if (!partyName) return { total: 0, notes: [] };

      const allNotes = await api.creditDebitNotes.list() ?? [];
      const matching = allNotes
        .filter((n: any) =>
          n.kind === "credit"
          && n.status === "approved"
          && n.counterparty?.toLowerCase() === partyName.toLowerCase()
        )
        .map((n: any) => ({ id: n.id, note_number: n.note_number, amount: Number(n.amount), date: n.note_date, status: n.status }));
      return { total: matching.reduce((s: number, n: CreditNoteInfo) => s + n.amount, 0), notes: matching };
    },
  });

  const unappliedCredit = creditNotesQ.data?.total ?? 0;
  const creditNotes = creditNotesQ.data?.notes ?? [];

  // ── Derived calculations ──
  const numericAmount = Number(inputAmount) || 0;
  const balanceBoost = useBalance ? previousRemaining : 0;
  const creditBoost = applyCredit ? unappliedCredit : 0;
  const availableAmount = numericAmount + balanceBoost + creditBoost;

  // Outstanding function based on type
  const outstandingFn = useCallback(
    (inv: any): number => isSupplier ? outstandingPurchase(inv) : outstanding(inv),
    [isSupplier]
  );

  // FIFO / Two-Pass FIFO preview
  const fifoPreview = useMemo(() => {
    if (mode === "manual" || availableAmount <= 0 || openInvoices.length === 0) return null;
    return computeFifoPreview(openInvoices as any[], availableAmount, mode === "two_pass_fifo", paymentDate, outstandingFn);
  }, [mode, availableAmount, openInvoices, paymentDate, outstandingFn]);

  // Manual preview
  const manualPreview = useMemo(() => {
    if (mode !== "manual" || availableAmount <= 0 || selectedInvoiceIds.size === 0) return null;
    return computeManualPreview(openInvoices as any[], selectedInvoiceIds, availableAmount, paymentDate, outstandingFn);
  }, [mode, availableAmount, selectedInvoiceIds, openInvoices, paymentDate, outstandingFn]);

  const selectedDebtor = (debtorsQ.data ?? []).find((d) => d.id === selectedDebtorId);
  const selectedSupplier = (suppliersQ.data ?? []).find((s) => s.id === selectedSupplierId);
  const selectedPartyName = isSupplier ? selectedSupplier?.name : selectedDebtor?.name;

  // ── Handlers ──
  const resetSelections = () => {
    setSelectedInvoiceIds(new Set());
    setInputAmount("");
    setUseBalance(false);
    setApplyCredit(false);
    setResult(null);
  };

  const handleCounterpartyTypeChange = (type: CounterpartyType) => {
    setCounterpartyType(type);
    setSelectedDebtorId("");
    setSelectedSupplierId("");
    resetSelections();
  };

  const handleDebtorChange = (id: string) => {
    setSelectedDebtorId(id);
    resetSelections();
  };

  const handleSupplierChange = (id: string) => {
    setSelectedSupplierId(id);
    resetSelections();
  };

  const handleDateChange = (date: string) => {
    setPaymentDate(date);
    setSelectedInvoiceIds(new Set());
    setResult(null);
  };

  const toggleInvoice = (id: string) => {
    setSelectedInvoiceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Submit ──
  const submitPayment = useCallback(async () => {
    if ((!selectedDebtorId && !selectedSupplierId) || availableAmount <= 0) return;
    if (mode === "manual" && selectedInvoiceIds.size === 0) return;

    setSubmitting(true);
    setResult(null);

    try {
      const creditNoteIds = applyCredit ? creditNotes.map((n) => n.id) : [];

      if (isSupplier) {
        const res = await api.post<PaymentResult>("/bulk-payments/process-purchase", {
          vendor_id: selectedSupplierId,
          payment_date: paymentDate,
          amount: numericAmount,
          use_balance: useBalance,
          mode,
          selected_invoice_ids: mode === "manual" ? [...selectedInvoiceIds] : [],
          settle_credit_note_ids: creditNoteIds,
        });

        setResult(res);

        if (res.closed.length > 0) {
          toast.success(`${res.closed.length} purchase invoice${res.closed.length !== 1 ? "s" : ""} closed`);
        }
        if (res.partially_paid.length > 0) {
          toast.info(`${res.partially_paid.length} purchase invoice${res.partially_paid.length !== 1 ? "s" : ""} partially paid`);
        }
        if (res.remaining > 0) {
          toast.info(`Remaining balance: ${fmtMoney(res.remaining)} — saved for future use`);
        }

        qc.setQueryData(["bulk-payment-purchase-balance", selectedSupplierId], res.remaining);
        qc.invalidateQueries({ queryKey: ["purchase_invoices"] });
        qc.invalidateQueries({ queryKey: ["bulk-payment-purchase-invoices"] });
        qc.invalidateQueries({ queryKey: ["bulk-payment-purchase-balance"] });
      } else {
        const res = await api.post<PaymentResult>("/bulk-payments/process", {
          debtor_id: selectedDebtorId,
          payment_date: paymentDate,
          amount: numericAmount,
          use_balance: useBalance,
          mode,
          selected_invoice_ids: mode === "manual" ? [...selectedInvoiceIds] : [],
          settle_credit_note_ids: creditNoteIds,
        });

        setResult(res);

        if (res.closed.length > 0) {
          toast.success(`${res.closed.length} invoice${res.closed.length !== 1 ? "s" : ""} closed`);
        }
        if (res.partially_paid.length > 0) {
          toast.info(`${res.partially_paid.length} invoice${res.partially_paid.length !== 1 ? "s" : ""} partially paid`);
        }
        if (res.remaining > 0) {
          toast.info(`Remaining balance: ${fmtMoney(res.remaining)} — saved for future use`);
        }

        qc.setQueryData(["bulk-payment-balance", selectedDebtorId], res.remaining);
        qc.invalidateQueries({ queryKey: ["invoices"] });
        qc.invalidateQueries({ queryKey: ["bulk-payment-invoices"] });
        qc.invalidateQueries({ queryKey: ["bulk-payment-balance"] });
      }

      qc.invalidateQueries({ queryKey: ["credit-debit-notes"] });
      qc.invalidateQueries({ queryKey: ["bulk-payment-credits"] });
      qc.invalidateQueries({ queryKey: ["bulk-payment-history"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Payment failed");
    } finally {
      setSubmitting(false);
    }
  }, [selectedDebtorId, selectedSupplierId, isSupplier, availableAmount, numericAmount, mode, selectedInvoiceIds, applyCredit, creditNotes, paymentDate, useBalance, qc]);

  // ── Validation ──
  const hasSelectedParty = isSupplier ? !!selectedSupplierId : !!selectedDebtorId;
  const canSubmit = canWrite && hasSelectedParty
    && availableAmount > 0
    && (mode !== "manual" || selectedInvoiceIds.size > 0)
    && !submitting;

  return (
    <div>
      <PageHeader
        eyebrow="Treasury"
        title="Bulk payments"
        description="Process customer payments with optional FIFO auto-allocation (strict, no partials), Two-Pass FIFO (future invoice pre-closing), or manual selection with partial payment support."
        actions={
          !canWrite ? (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
              <Lock className="h-3 w-3" /> Read-only
            </span>
          ) : undefined
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        {/* ── Counterparty Type Toggle ── */}
        <Card title="Payment type" className={!hasSelectedParty ? "ring-1 ring-primary/30" : ""}>
          <div className="flex gap-3">
            <button
              onClick={() => handleCounterpartyTypeChange("debtor")}
              className={`flex-1 rounded-lg border-2 p-4 text-left transition-all ${
                counterpartyType === "debtor"
                  ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                  : "border-border hover:border-primary/30 hover:bg-muted/20"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`rounded-full p-2 ${
                  counterpartyType === "debtor" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                }`}>
                  <Users className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-semibold text-sm">Customer (AR)</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Receive payments from customers</div>
                </div>
              </div>
            </button>
            <button
              onClick={() => handleCounterpartyTypeChange("supplier")}
              className={`flex-1 rounded-lg border-2 p-4 text-left transition-all ${
                counterpartyType === "supplier"
                  ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                  : "border-border hover:border-primary/30 hover:bg-muted/20"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`rounded-full p-2 ${
                  counterpartyType === "supplier" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                }`}>
                  <Truck className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-semibold text-sm">Supplier (AP)</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Pay purchase invoices to suppliers</div>
                </div>
              </div>
            </button>
          </div>
        </Card>

        {/* ── Step 1: Party Selection ── */}
        <Card title={`1. Select ${counterpartyType === "debtor" ? "customer" : "supplier"}`} className={!hasSelectedParty ? "ring-1 ring-primary/30" : ""}>
          <div className="space-y-4">
            <div className="relative">
              <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              {counterpartyType === "debtor" ? (
                <select
                  value={selectedDebtorId}
                  onChange={(e) => handleDebtorChange(e.target.value)}
                  className="h-11 w-full rounded-lg border border-border bg-background pl-10 pr-4 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all appearance-none cursor-pointer"
                >
                  <option value="" disabled>Select a customer…</option>
                  {(debtorsQ.data ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}{d.industry ? ` — ${d.industry}` : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  value={selectedSupplierId}
                  onChange={(e) => handleSupplierChange(e.target.value)}
                  className="h-11 w-full rounded-lg border border-border bg-background pl-10 pr-4 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all appearance-none cursor-pointer"
                >
                  <option value="" disabled>Select a supplier…</option>
                  {(suppliersQ.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}{s.industry ? ` — ${s.industry}` : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {selectedPartyName && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
                <div className="flex items-center gap-2 text-primary">
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="font-medium">{selectedPartyName}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {sortedInvoices.length} open invoice{sortedInvoices.length !== 1 ? "s" : ""}
                  {" · "}
                  {unappliedCredit > 0 ? `${fmtMoney(unappliedCredit)} in unapplied credit` : "No unapplied credit"}
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* ── Step 2: Payment Details ── */}
        {hasSelectedParty && (
          <Card title="2. Payment details">
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-xs uppercase tracking-widest text-muted-foreground">
                  <DollarSign className="h-3.5 w-3.5" /> Payment amount
                </label>
                <input
                  type="text" inputMode="decimal"
                  placeholder="0.00" value={inputAmount}
                  onChange={(e) => { setInputAmount(e.target.value.replace(/[^0-9.]/g, "")); setResult(null); }}
                  className="h-11 w-full rounded-lg border border-border bg-background px-4 text-sm text-foreground placeholder:text-muted-foreground/30 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all font-mono"
                />
              </div>

              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-xs uppercase tracking-widest text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5" /> Payment date
                </label>
                <input
                  type="date" value={paymentDate}
                  onChange={(e) => handleDateChange(e.target.value)}
                  className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
                />
              </div>

              <div className="flex flex-col justify-end">
                <label className="mb-1.5 flex items-center gap-1.5 text-xs uppercase tracking-widest text-muted-foreground">
                  <Wallet className="h-3.5 w-3.5" /> Available amount
                </label>
                <div className={`flex h-11 items-center rounded-lg border px-4 text-lg font-semibold font-mono transition-colors ${
                  availableAmount > 0
                    ? "border-primary/30 bg-primary/5 text-primary"
                    : "border-border bg-background/40 text-muted-foreground"
                }`}>
                  {fmtMoney(availableAmount)}
                </div>
              </div>

              <div className="flex flex-col justify-end">
                <label className="mb-1.5 flex items-center gap-1.5 text-xs uppercase tracking-widest text-muted-foreground">
                  <History className="h-3.5 w-3.5" /> Remaining after
                </label>
                <div className={`flex h-11 items-center rounded-lg border px-4 text-lg font-semibold font-mono transition-colors ${
                  result && result.remaining > 0
                    ? "border-sem-success/30 bg-sem-success/5 text-sem-success"
                    : "border-border bg-background/40 text-muted-foreground"
                }`}>
                  {result && result.remaining > 0 ? fmtMoney(result.remaining) : "—"}
                </div>
              </div>
            </div>

            {/* Previous remaining balance section */}
            <div className="mt-4 rounded-lg border border-sem-attention/20 bg-sem-attention/5 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium text-sem-attention">
                  <History className="h-4 w-4" />
                  Previous unapplied balance
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <span className="text-xs text-muted-foreground">{useBalance ? "Included" : "Use"}</span>
                  <input
                    type="checkbox" checked={useBalance}
                    onChange={(e) => { setUseBalance(e.target.checked); setResult(null); }}
                    className="h-5 w-5 rounded border-border accent-sem-attention"
                  />
                </label>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {(isSupplier ? supplierBalanceQ.isLoading : balanceQ.isLoading)
                  ? "Checking previous balances…"
                  : previousRemaining > 0
                    ? `${fmtMoney(previousRemaining)} available from previous payments`
                    : "No unapplied balance from previous payments"}
              </p>
            </div>

            {/* Credit notes section */}
            {creditNotes.length > 0 && (
              <div className="mt-3 rounded-lg border border-sem-success/20 bg-sem-success/5 p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium text-sem-success">
                    <CreditCard className="h-4 w-4" />
                    Unapplied past credit
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <span className="text-xs text-muted-foreground">{applyCredit ? "Applied" : "Apply"}</span>
                    <input
                      type="checkbox" checked={applyCredit}
                      onChange={(e) => { setApplyCredit(e.target.checked); setResult(null); }}
                      className="h-5 w-5 rounded border-border accent-sem-success"
                    />
                  </label>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {creditNotes.length} approved credit note{creditNotes.length !== 1 ? "s" : ""} totaling {fmtMoney(unappliedCredit)}
                </p>
              </div>
            )}
          </Card>
        )}

        {/* ── Step 3: Mode Selection ── */}
        {hasSelectedParty && sortedInvoices.length > 0 && (
          <Card title="3. Payment mode">
            <div className="mb-4 flex flex-wrap gap-2">
              {([
                { key: "fifo" as const, label: "FIFO (strict)", desc: "No partials — skip if funds insufficient" },
                { key: "two_pass_fifo" as const, label: "Two-Pass FIFO", desc: "Overdue first, then future (pre-close)" },
                { key: "manual" as const, label: "Manual", desc: "Pick invoices, partials allowed" },
              ]).map((m) => (
                <button
                  key={m.key}
                  onClick={() => { setMode(m.key); setSelectedInvoiceIds(new Set()); setResult(null); }}
                  className={`rounded-lg border px-4 py-2 text-left text-xs transition-all ${
                    mode === m.key
                      ? "border-primary bg-primary/10 text-primary ring-1 ring-primary/20"
                      : "border-border text-muted-foreground hover:text-foreground hover:border-primary/30"
                  }`}
                >
                  <div className="font-medium text-sm">{m.label}</div>
                  <div className="mt-0.5 opacity-70">{m.desc}</div>
                </button>
              ))}
            </div>

            {/* Mode-specific previews */}
            {mode !== "manual" && fifoPreview && (
              <div className="mb-4 space-y-2">
                <div className="rounded-md border border-primary/20 bg-primary/5 px-4 py-2.5 text-xs text-muted-foreground">
                  <span className="font-semibold text-primary">{fifoPreview.closed.length}</span> invoice{fifoPreview.closed.length !== 1 ? "s" : ""} will be closed{" "}
                  for <span className="font-semibold text-primary">{fmtMoney(fifoPreview.closed.reduce((s, c) => s + c.amount, 0))}</span>
                  {fifoPreview.skipped.length > 0 && (
                    <span className="ml-1">
                      · <span className="font-semibold text-sem-attention">{fifoPreview.skipped.length}</span> skipped (insufficient funds)
                    </span>
                  )}
                  {fifoPreview.remaining > 0 && (
                    <span className="ml-1">
                      · Remaining: <span className="font-semibold text-sem-attention">{fmtMoney(fifoPreview.remaining)}</span>
                    </span>
                  )}
                </div>
                {mode === "two_pass_fifo" && fifoPreview.closed.filter((c) => c.isFuture).length > 0 && (
                  <div className="rounded-md border border-purple-500/20 bg-purple-500/5 px-4 py-2 text-xs text-muted-foreground">
                    <span className="font-semibold text-purple-500">{fifoPreview.closed.filter((c) => c.isFuture).length}</span> future invoice{fifoPreview.closed.filter((c) => c.isFuture).length !== 1 ? "s" : ""}{" "}
                    will be pre-closed with <span className="font-semibold text-purple-500">late_payment_days = 0</span> (closed_date = due_date)
                  </div>
                )}
              </div>
            )}

            {mode === "manual" && manualPreview && (
              <div className="mb-4 rounded-md border border-primary/20 bg-primary/5 px-4 py-2.5 text-xs text-muted-foreground">
                <span className="font-semibold text-primary">{manualPreview.closed.length}</span> will close{" "}
                · <span className="font-semibold text-sem-attention">{manualPreview.partiallyPaid.length}</span> partially paid
                · Remaining: <span className="font-semibold">{fmtMoney(manualPreview.remaining)}</span>
              </div>
            )}
          </Card>
        )}

        {/* ── Invoice Table ── */}
        {hasSelectedParty && sortedInvoices.length > 0 && (
          <Card title={isSupplier ? "Purchase invoices" : "Invoices"}>
            {(isSupplier ? purchaseInvoicesQ.isLoading : invoicesQ.isLoading) ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading invoices…
              </div>
            ) : (
              <div className="-mx-5 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                    <tr className="border-b border-border">
                      {mode === "manual" && <th className="px-4 py-2 text-left font-normal w-10"></th>}
                      <th className="px-4 py-2 text-left font-normal">Invoice</th>
                      <th className="px-4 py-2 text-left font-normal">Issue</th>
                      <th className="px-4 py-2 text-left font-normal">Due</th>
                      <th className="px-4 py-2 text-right font-normal">Amount</th>
                      <th className="px-4 py-2 text-right font-normal">Outstanding</th>
                      <th className="px-4 py-2 text-center font-normal">Age</th>
                      <th className="px-4 py-2 text-center font-normal">Status</th>
                      <th className="px-4 py-2 text-center font-normal">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedInvoices.map((inv: any) => {
                      const overdue = isOverdue(inv.due_date, paymentDate);
                      const late = daysLateCalc(inv.due_date, paymentDate);
                      const isSelected = selectedInvoiceIds.has(inv.id);
                      const bal = outstandingFn(inv);

                      // Determine what happens to this invoice
                      let resultLabel = "";
                      let resultCls = "";

                      if (mode !== "manual" && fifoPreview) {
                        const isClosed = fifoPreview.closed.find((c: any) => c.inv.id === inv.id);
                        const isSkipped = fifoPreview.skipped.find((s: any) => s.id === inv.id);
                        if (isClosed) {
                          resultLabel = isClosed.isFuture ? "Pre-close" : fmtMoney(isClosed.amount);
                          resultCls = isClosed.isFuture ? "text-purple-500 bg-purple-500/15" : "text-sem-success bg-sem-success/15";
                        } else if (isSkipped) {
                          resultLabel = "Skip";
                          resultCls = "text-muted-foreground bg-muted/30";
                        }
                      }

                      if (mode === "manual" && manualPreview) {
                        const isClosed = manualPreview.closed.find((c: any) => c.inv.id === inv.id);
                        const isPartial = manualPreview.partiallyPaid.find((p: any) => p.inv.id === inv.id);
                        if (isClosed) {
                          resultLabel = fmtMoney(isClosed.amount);
                          resultCls = "text-sem-success bg-sem-success/15";
                        } else if (isPartial) {
                          resultLabel = `Partial ${fmtMoney(isPartial.amountPaid)}`;
                          resultCls = "text-sem-attention bg-sem-attention/15";
                        }
                      }

                      const isFutureInvoice = mode !== "manual" && inv.due_date != null && inv.due_date > paymentDate;

                      return (
                        <tr
                          key={inv.id}
                          className={`border-b border-border/60 transition-colors ${
                            resultLabel && resultCls.includes("success")
                              ? "bg-sem-success/5 hover:bg-sem-success/10"
                              : resultLabel && resultCls.includes("warning")
                              ? "bg-sem-attention/5 hover:bg-sem-attention/10"
                              : resultLabel === "Skip"
                              ? "opacity-50"
                              : overdue
                              ? "bg-destructive/5 hover:bg-destructive/10"
                              : isFutureInvoice
                              ? "bg-purple-500/5 hover:bg-purple-500/10"
                              : "hover:bg-muted/30"
                          }`}
                        >
                          {mode === "manual" && (
                            <td className="px-4 py-3">
                              <input type="checkbox" checked={isSelected} onChange={() => toggleInvoice(inv.id)}
                                className="h-4 w-4 rounded border-border accent-primary" />
                            </td>
                          )}
                          <td className="px-4 py-3">
                            <div className="font-mono text-xs font-medium">{inv.invoice_number}</div>
                            {isFutureInvoice && <div className="text-[9px] text-purple-500 uppercase tracking-wider">Future</div>}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDateShort(inv.issue_date)}</td>
                          <td className={`px-4 py-3 text-xs ${overdue ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                            {fmtDateShort(inv.due_date)}
                            {overdue && <AlertTriangle className="ml-1 inline h-3 w-3 text-destructive" />}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs">{fmtMoney(inv.amount)}</td>
                          <td className="px-4 py-3 text-right font-mono text-xs font-medium">{fmtMoney(bal)}</td>
                          <td className="px-4 py-3 text-center text-xs">
                            {late > 0 ? (
                              <span className="inline-flex items-center rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
                                {late}d overdue
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest ${
                              inv.status === "overdue" ? "bg-destructive/15 text-destructive"
                              : inv.status === "approved" ? "bg-primary/15 text-primary"
                              : inv.status === "advanced" || inv.status === "funded" ? "bg-sem-attention/15 text-sem-attention"
                              : inv.status === "draft" ? "bg-muted text-muted-foreground"
                              : inv.status === "submitted" ? "bg-sem-info/15 text-sem-info"
                              : "bg-muted text-muted-foreground"
                            }`}>{inv.status}</span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {resultLabel ? (
                              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-medium ${resultCls}`}>
                                {resultLabel.includes("Partial") || resultLabel === "Skip" ? (
                                  <SkipForward className="h-3 w-3" />
                                ) : resultLabel.includes("Pre-close") ? (
                                  <CalendarDays className="h-3 w-3" />
                                ) : (
                                  <CheckCircle2 className="h-3 w-3" />
                                )}
                                {resultLabel}
                              </span>
                            ) : mode === "manual" && isSelected ? (
                              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">Awaiting</span>
                            ) : (
                              <span className="text-[10px] text-muted-foreground">—</span>
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
        )}

        {/* ── Submit Button ── */}
        {hasSelectedParty && sortedInvoices.length > 0 && (
          <div className="sticky bottom-6 z-10">
            <Card className="border-primary/20 shadow-lg">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-0.5 text-sm">
                  {mode !== "manual" && fifoPreview && fifoPreview.closed.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Closing</span>
                      <span className="font-semibold">{fifoPreview.closed.length}</span>
                      <span className="text-muted-foreground">for</span>
                      <span className="font-semibold text-primary">{fmtMoney(fifoPreview.closed.reduce((s, c) => s + c.amount, 0))}</span>
                      {fifoPreview.remaining > 0 && (
                        <>
                          <span className="text-muted-foreground">·</span>
                          <span className="text-muted-foreground">Remaining</span>
                          <span className="font-semibold text-sem-attention">{fmtMoney(fifoPreview.remaining)}</span>
                        </>
                      )}
                    </div>
                  )}
                  {mode === "manual" && (
                    <>
                      {selectedInvoiceIds.size === 0 && (
                        <div className="text-xs text-sem-attention">Select at least one invoice to pay.</div>
                      )}
                      {manualPreview && (
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">Closing</span>
                          <span className="font-semibold">{manualPreview.closed.length}</span>
                          {manualPreview.partiallyPaid.length > 0 && (
                            <>
                              <span className="text-muted-foreground">· Partial</span>
                              <span className="font-semibold text-sem-attention">{manualPreview.partiallyPaid.length}</span>
                            </>
                          )}
                          <span className="text-muted-foreground">· Remaining</span>
                          <span className="font-semibold text-sem-success">{fmtMoney(manualPreview.remaining)}</span>
                        </div>
                      )}
                    </>
                  )}
                  {!inputAmount && (
                    <div className="text-xs text-muted-foreground">Enter a payment amount to calculate allocations.</div>
                  )}
                  {!canWrite && (
                    <div className="flex items-center gap-1.5 text-xs text-sem-attention">
                      <Lock className="h-3 w-3" /> Only treasury/admin can process payments.
                    </div>
                  )}
                </div>

                <button
                  disabled={!canSubmit}
                  onClick={submitPayment}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Processing…</>
                  ) : (
                    <><ArrowRightLeft className="h-4 w-4" /> Process payment</>
                  )}
                </button>
              </div>
            </Card>
          </div>
        )}

        {/* ── No invoices ── */}
        {hasSelectedParty && !(isSupplier ? purchaseInvoicesQ.isLoading : invoicesQ.isLoading) && sortedInvoices.length === 0 && (
          <Card>
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CheckCircle2 className="mb-3 h-10 w-10 text-sem-success/60" />
              <h3 className="text-lg font-medium">All caught up</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {selectedPartyName ?? "This party"} has no open {isSupplier ? "purchase " : ""}invoices.
              </p>
            </div>
          </Card>
        )}

        {/* ── Empty state ── */}
        {!hasSelectedParty && (
          <Card>
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ArrowRightLeft className="mb-4 h-12 w-12 text-muted-foreground/40" />
              <h3 className="text-lg font-medium">Select a party to begin</h3>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Choose <strong>Customer (AR)</strong> to receive payments from customers, or{" "}
                <strong>Supplier (AP)</strong> to pay purchase invoices to suppliers.
                Then enter the payment amount, optionally apply past balance or credit,
                then choose FIFO (strict), Two-Pass FIFO (future pre-closing), or manual selection.
              </p>
            </div>
          </Card>
        )}

        {/* ── Results ── */}
        {result && (
          <Card title={`Payment result${result.supplier_name ? ` — ${result.supplier_name}` : ""}`}>
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-4">
                <div className="rounded-lg border border-sem-success/30 bg-sem-success/5 p-4 text-center">
                  <div className="text-2xl font-display text-sem-success">{result.closed.length}</div>
                  <div className="text-xs text-muted-foreground mt-1">Closed</div>
                </div>
                <div className={`rounded-lg border p-4 text-center ${
                  result.partially_paid.length > 0 ? "border-sem-attention/30 bg-sem-attention/5" : "border-border bg-background/40"
                }`}>
                  <div className={`text-2xl font-display ${result.partially_paid.length > 0 ? "text-sem-attention" : "text-muted-foreground"}`}>
                    {result.partially_paid.length}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Partially paid</div>
                </div>
                <div className={`rounded-lg border p-4 text-center ${
                  result.remaining > 0 ? "border-sem-attention/30 bg-sem-attention/5" : "border-border bg-background/40"
                }`}>
                  <div className={`text-2xl font-display ${result.remaining > 0 ? "text-sem-attention" : "text-muted-foreground"}`}>
                    {fmtMoney(result.remaining)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Remaining balance</div>
                </div>
                <div className={`rounded-lg border p-4 text-center ${
                  result.skipped.length > 0 ? "border-destructive/30 bg-destructive/5" : "border-border bg-background/40"
                }`}>
                  <div className={`text-2xl font-display ${result.skipped.length > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                    {result.skipped.length}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Skipped</div>
                </div>
              </div>

              {result.closed.length > 0 && (
                <div className="rounded-md border border-border p-3">
                  <p className="mb-2 text-xs font-medium text-sem-success">Closed invoices:</p>
                  <div className="space-y-1">
                    {result.closed.map((c) => (
                      <div key={c.id} className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="font-mono">{c.invoice_number}</span>
                        <span>{fmtMoney(c.amount)} · {c.late_payment_days > 0 ? `${c.late_payment_days}d late` : "On time"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.partially_paid.length > 0 && (
                <div className="rounded-md border border-sem-attention/20 bg-sem-attention/5 p-3">
                  <p className="mb-2 text-xs font-medium text-sem-attention">Partially paid:</p>
                  <div className="space-y-1">
                    {result.partially_paid.map((p) => (
                      <div key={p.id} className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="font-mono">{p.invoice_number}</span>
                        <span>Paid {fmtMoney(p.amount_paid)} · Remaining {fmtMoney(p.remaining)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => {
                  setResult(null);
                  setInputAmount("");
                  setSelectedInvoiceIds(new Set());
                  setApplyCredit(false);
                }}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                  New payment
                </button>
              </div>
            </div>
          </Card>
        )}

        {/* ── Payment History ── */}
        <Card
          title="Payment history"
          action={
            <button
              onClick={() => setHistoryOpen(!historyOpen)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <ScrollText className="h-4 w-4" />
              {historyOpen ? "Hide" : "Show"}
              <ChevronDown className={`h-4 w-4 transition-transform ${historyOpen ? "rotate-180" : ""}`} />
            </button>
          }
        >
          {historyOpen && (
            <div className="space-y-4">
              {/* Filter by customer */}
              <div className="flex items-center gap-3">
                <select
                  value={historyFilterDebtorId}
                  onChange={(e) => setHistoryFilterDebtorId(e.target.value)}
                  className="h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
                >
                  <option value="">All parties</option>
                  {(debtorsQ.data ?? []).map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                  {(suppliersQ.data ?? []).map((s) => (
                    <option key={s.id} value={`vendor_${s.id}`}>{s.name}</option>
                  ))}
                </select>
                <div className="text-xs text-muted-foreground">
                  {historyQ.data?.totals.total_payments ?? 0} payment{(historyQ.data?.totals.total_payments ?? 0) !== 1 ? "s" : ""}
                  {historyQ.data && historyQ.data.totals.total_remaining > 0 && (
                    <> · <span className="text-sem-attention font-medium">{fmtMoney(historyQ.data.totals.total_remaining)}</span> total carried forward</>
                  )}
                </div>
              </div>

              {historyQ.isLoading ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" /> Loading history…
                </div>
              ) : (historyQ.data?.payments ?? []).length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  No payment records yet.
                </div>
              ) : (
                <div className="-mx-5 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="px-5 py-2 text-left font-normal">Date</th>
                        <th className="px-5 py-2 text-left font-normal">Party</th>
                        <th className="px-5 py-2 text-right font-normal">Amount</th>
                        <th className="px-5 py-2 text-right font-normal">Remaining</th>
                        <th className="px-5 py-2 text-center font-normal">Mode</th>
                        <th className="px-5 py-2 text-right font-normal">Closed</th>
                        <th className="px-5 py-2 text-right font-normal">Credits</th>
                        <th className="px-5 py-2 text-center font-normal">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(historyQ.data?.payments ?? []).map((p) => (
                        <HistoryRow
                          key={p.id}
                          payment={p}
                          canWrite={canWrite}
                          onReversed={() => {
                            qc.invalidateQueries({ queryKey: ["bulk-payment-history"] });
                            qc.invalidateQueries({ queryKey: ["bulk-payment-balance"] });
                            qc.invalidateQueries({ queryKey: ["bulk-payment-purchase-balance"] });
                            qc.invalidateQueries({ queryKey: ["bulk-payment-invoices"] });
                            qc.invalidateQueries({ queryKey: ["bulk-payment-purchase-invoices"] });
                            qc.invalidateQueries({ queryKey: ["invoices"] });
                            qc.invalidateQueries({ queryKey: ["purchase_invoices"] });
                            qc.invalidateQueries({ queryKey: ["credit-debit-notes"] });
                          }}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          {!historyOpen && (
            <div className="text-xs text-muted-foreground">
              {historyQ.data
                ? `${historyQ.data.totals.total_payments} records · ${fmtMoney(historyQ.data.totals.total_amount)} processed · ${historyQ.data.totals.total_remaining > 0 ? `${fmtMoney(historyQ.data.totals.total_remaining)} carried forward` : "No outstanding balances"}`
                : "Click to load payment history"}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ── History Row Sub-Component ──

function HistoryRow({ payment, canWrite, onReversed }: { payment: PaymentHistoryRecord; canWrite: boolean; onReversed: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reversing, setReversing] = useState(false);

  const handleReverse = async () => {
    setReversing(true);
    try {
      await api.post(`/bulk-payments/reverse/${payment.id}`, {});
      toast.success(`Payment of ${fmtMoney(payment.amount)} reversed — invoices reopened`);
      setConfirmOpen(false);
      onReversed();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reverse failed");
    } finally {
      setReversing(false);
    }
  };

  const isSupplierPayment = payment.debtor_id?.startsWith("supplier_") || payment.debtor_id?.startsWith("vendor_");

  return (
    <>
      <tr className="border-b border-border/60 hover:bg-muted/30">
        <td className="px-5 py-3 text-xs">{fmtDateShort(payment.payment_date)}</td>
        <td className="px-5 py-3">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            {isSupplierPayment ? (
              <Truck className="h-3 w-3 text-muted-foreground" />
            ) : (
              <Users className="h-3 w-3 text-muted-foreground" />
            )}
            {payment.debtor_name}
          </div>
        </td>
        <td className="px-5 py-3 text-right font-mono text-xs">{fmtMoney(payment.amount)}</td>
        <td className={`px-5 py-3 text-right font-mono text-xs ${payment.remaining > 0 ? "text-sem-attention font-medium" : "text-muted-foreground"}`}>
          {payment.remaining > 0 ? fmtMoney(payment.remaining) : "—"}
        </td>
        <td className="px-5 py-3 text-center">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest ${
            payment.mode === "manual" ? "bg-primary/15 text-primary"
            : payment.mode === "two_pass_fifo" ? "bg-purple-500/15 text-purple-500"
            : "bg-sem-attention/15 text-sem-attention"
          }`}>
            {payment.mode === "two_pass_fifo" ? "2-pass" : payment.mode}
          </span>
        </td>
        <td className="px-5 py-3 text-right font-mono text-xs text-muted-foreground">{payment.invoices_closed}</td>
        <td className="px-5 py-3 text-right font-mono text-xs text-muted-foreground">{payment.credit_note_ids.length || "—"}</td>
        <td className="px-5 py-3 text-center">
          {canWrite ? (
            <button
              onClick={() => setConfirmOpen(true)}
              className="inline-flex items-center gap-1 rounded-md border border-destructive/30 px-2.5 py-1 text-[10px] font-medium text-destructive transition-all hover:bg-destructive/10 hover:border-destructive/50"
              title="Reverse this payment — reopen invoices and restore credit notes"
            >
              <Undo2 className="h-3 w-3" />
              Reverse
            </button>
          ) : (
            <span className="text-[10px] text-muted-foreground">—</span>
          )}
        </td>
      </tr>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              Reverse payment?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                This will reverse the bulk payment of <strong>{fmtMoney(payment.amount)}</strong> for{" "}
                <strong>{payment.debtor_name}</strong>.
              </p>
              <ul className="list-disc pl-4 text-xs text-muted-foreground space-y-1">
                <li>{payment.invoices_closed} invoice{payment.invoices_closed !== 1 ? "s" : ""} will be reopened</li>
                {payment.credit_note_ids.length > 0 && (
                  <li>{payment.credit_note_ids.length} credit note{payment.credit_note_ids.length !== 1 ? "s" : ""} will be restored to approved</li>
                )}
                {payment.remaining > 0 && (
                  <li>Remaining balance of {fmtMoney(payment.remaining)} will be removed</li>
                )}
                <li>The payment record will be permanently deleted</li>
              </ul>
              <p className="text-xs font-medium text-destructive">This action cannot be undone.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reversing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={reversing}
              onClick={(e) => {
                e.preventDefault();
                handleReverse();
              }}
              className="inline-flex items-center gap-2 bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {reversing ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Reversing…</>
              ) : (
                <><Undo2 className="h-4 w-4" /> Reverse payment</>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
