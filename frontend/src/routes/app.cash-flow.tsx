import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/ledger-ui";
import {
  AlertTriangle,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  CreditCard,
  Edit2,
  Landmark,
  LayoutDashboard,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Settings,
  ShoppingCart,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/app/cash-flow")({
  component: CashFlowPage,
});

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(n: number | undefined | null): string {
  if (n == null) n = 0;
  if (Math.abs(n) >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
  if (Math.abs(n) >= 100000) return `₹${(n / 100000).toFixed(2)}L`;
  if (Math.abs(n) >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n.toLocaleString("en-IN")}`;
}

function fmtFull(n: number | undefined | null): string {
  if (n == null) n = 0;
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function statusColor(status: string): string {
  if (status === "GREEN") return "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800";
  if (status === "AMBER") return "text-amber-600 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800";
  return "text-red-600 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800";
}

function statusDot(status: string): string {
  if (status === "GREEN") return "bg-emerald-500";
  if (status === "AMBER") return "bg-amber-500";
  return "bg-red-500";
}

// ── Page Component ─────────────────────────────────────────────────────────

function CashFlowPage() {
  const { isAdmin, isTreasury } = useAuth();
  const canWrite = isAdmin || isTreasury;
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<string>("overview");
  const [mode, setMode] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [expandedPeriod, setExpandedPeriod] = useState<number | null>(null);

  // Dialog States
  const [showSettings, setShowSettings] = useState(false);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [editingAccount, setEditingAccount] = useState<any | null>(null);
  const [deletingAccount, setDeletingAccount] = useState<any | null>(null);

  const [showAddInflow, setShowAddInflow] = useState(false);
  const [editingInflow, setEditingInflow] = useState<any | null>(null);
  const [deletingInflow, setDeletingInflow] = useState<any | null>(null);

  const [showAddOutflow, setShowAddOutflow] = useState(false);
  const [editingOutflow, setEditingOutflow] = useState<any | null>(null);
  const [deletingOutflow, setDeletingOutflow] = useState<any | null>(null);

  const [showAddRecurring, setShowAddRecurring] = useState(false);
  const [editingRecurring, setEditingRecurring] = useState<any | null>(null);
  const [deletingRecurring, setDeletingRecurring] = useState<any | null>(null);

  const [showAddCommitment, setShowAddCommitment] = useState(false);
  const [editingCommitment, setEditingCommitment] = useState<any | null>(null);
  const [deletingCommitment, setDeletingCommitment] = useState<any | null>(null);

  const [showAddSettlement, setShowAddSettlement] = useState(false);
  const [editingSettlement, setEditingSettlement] = useState<any | null>(null);
  const [deletingSettlement, setDeletingSettlement] = useState<any | null>(null);

  // Queries
  const forecastQ = useQuery({
    queryKey: ["cash-flow-forecast", mode],
    queryFn: () => api.cashFlow.forecast.get(mode),
    refetchInterval: 30_000,
  });

  const summaryQ = useQuery({
    queryKey: ["cash-flow-summary"],
    queryFn: () => api.cashFlow.summary(),
    refetchInterval: 30_000,
  });

  const accountsQ = useQuery({
    queryKey: ["cash-accounts"],
    queryFn: () => api.cashFlow.accounts.list(),
  });

  const settingsQ = useQuery({
    queryKey: ["cash-flow-settings"],
    queryFn: () => api.cashFlow.settings.get(),
  });

  const inflowsQ = useQuery({
    queryKey: ["cash-flow-inflows"],
    queryFn: () => api.cashFlow.inflows.list(),
  });

  const outflowsQ = useQuery({
    queryKey: ["cash-flow-outflows"],
    queryFn: () => api.cashFlow.outflows.list(),
  });

  const recurringQ = useQuery({
    queryKey: ["cash-flow-recurring"],
    queryFn: () => api.cashFlow.recurring.list(),
  });

  const commitmentsQ = useQuery({
    queryKey: ["cash-flow-commitments"],
    queryFn: () => api.cashFlow.commitments.list(),
  });

  const settlementsQ = useQuery({
    queryKey: ["cash-flow-settlements"],
    queryFn: () => api.cashFlow.settlements.list(),
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["cash-accounts"] });
    queryClient.invalidateQueries({ queryKey: ["cash-flow-forecast"] });
    queryClient.invalidateQueries({ queryKey: ["cash-flow-summary"] });
    queryClient.invalidateQueries({ queryKey: ["cash-flow-inflows"] });
    queryClient.invalidateQueries({ queryKey: ["cash-flow-outflows"] });
    queryClient.invalidateQueries({ queryKey: ["cash-flow-recurring"] });
    queryClient.invalidateQueries({ queryKey: ["cash-flow-commitments"] });
    queryClient.invalidateQueries({ queryKey: ["cash-flow-settlements"] });
    queryClient.invalidateQueries({ queryKey: ["cash-flow-settings"] });
  };

  const forecast = forecastQ.data;
  const summary = summaryQ.data;
  const loading = forecastQ.isLoading && summaryQ.isLoading && accountsQ.isLoading;

  // Real-time computed Available Cash directly from live accounts
  const totalAvailableCash = useMemo(() => {
    if (accountsQ.data && accountsQ.data.length > 0) {
      return accountsQ.data
        .filter((a: any) => {
          if (a.status && a.status.toLowerCase() !== "active") return false;
          const t = (a.accountType ?? a.account_type ?? a.type ?? "BANK").toUpperCase();
          return t === "BANK" || t === "CASH";
        })
        .reduce((sum: number, a: any) => {
          const currentBal = Number(a.currentBalance ?? a.balance ?? a.current_balance ?? a.amount ?? 0) || 0;
          const restricted = Number(a.restrictedBalance ?? a.restricted ?? a.restricted_balance ?? 0) || 0;
          const availRaw = a.availableForOperations ?? a.available_for_operations;
          const avail = availRaw !== undefined && !isNaN(Number(availRaw))
            ? Number(availRaw)
            : (currentBal - restricted);
          return sum + avail;
        }, 0);
    }
    return summary?.currentAvailableCash ?? 0;
  }, [accountsQ.data, summary?.currentAvailableCash]);

  const activeAccountsCount = useMemo(() => {
    if (!accountsQ.data) return 0;
    return accountsQ.data.filter((a: any) => !a.status || a.status.toLowerCase() === "active").length;
  }, [accountsQ.data]);

  const totalMarketplaceBalance = useMemo(() => {
    if (accountsQ.data && accountsQ.data.length > 0) {
      return accountsQ.data
        .filter((a: any) =>          (!a.status || a.status.toLowerCase() === "active") && (a.accountType === "MARKETPLACE" || a.account_type === "MARKETPLACE" || a.type === "MARKETPLACE"))
        .reduce((sum: number, a: any) => {
          const currentBal = Number(a.currentBalance ?? a.balance ?? a.current_balance ?? a.amount ?? 0) || 0;
          const restricted = Number(a.restrictedBalance ?? a.restricted ?? a.restricted_balance ?? 0) || 0;
          const availRaw = a.availableForOperations ?? a.available_for_operations;
          const avail = availRaw !== undefined && !isNaN(Number(availRaw))
            ? Number(availRaw)
            : (currentBal - restricted);
          return sum + avail;
        }, 0);
    }
    return summary?.marketplace_value ?? summary?.marketplaceValue ?? 0;
  }, [accountsQ.data, summary?.marketplaceValue, summary?.marketplace_value]);

  const projected7d = useMemo(() => {
    if (summary?.projectedClosingCashNext7Days != null && summary.projectedClosingCashNext7Days !== 0) {
      return summary.projectedClosingCashNext7Days;
    }
    const in7 = summary?.expectedInflowsNext7Days ?? 0;
    const out7 = summary?.expectedOutflowsNext7Days ?? 0;
    return totalAvailableCash + in7 - out7;
  }, [summary?.projectedClosingCashNext7Days, summary?.expectedInflowsNext7Days, summary?.expectedOutflowsNext7Days, totalAvailableCash]);

  const projected30d = useMemo(() => {
    if (summary?.projectedClosingCashNext30Days != null && summary.projectedClosingCashNext30Days !== 0) {
      return summary.projectedClosingCashNext30Days;
    }
    return totalAvailableCash;
  }, [summary?.projectedClosingCashNext30Days, totalAvailableCash]);

  const chartData = useMemo(() => {
    if (!forecast?.periods) return [];
    return forecast.periods.map((p: any) => ({
      name: mode === "daily" ? format(parseISO(p.startDate), "MMM d") : p.label.split(" (")[0],
      opening: p.openingCash,
      inflows: p.expectedInflows,
      outflows: p.expectedOutflows,
      closing: p.closingCash,
      buffer: forecast.minimumCashBuffer,
    }));
  }, [forecast, mode]);

  // Combined Inflow items for breakdown
  const combinedInflows = useMemo(() => {
    const list: any[] = [];
    if (inflowsQ.data) {
      for (const i of inflowsQ.data) {
        list.push({ ...i, displayCategory: i.type });
      }
    }
    if (settlementsQ.data) {
      for (const s of settlementsQ.data) {
        if (s.status !== "RECEIVED" && s.status !== "DISPUTED") {
          list.push({
            id: s.id,
            type: "MARKETPLACE_SETTLEMENT",
            amount: s.net_settlement_expected ?? s.netSettlementExpected,
            status: s.status,
            expectedDate: s.expected_settlement_date ?? s.expectedSettlementDate,
            customerName: s.marketplace_name ?? s.marketplaceName,
            displayCategory: "Marketplace Settlement",
          });
        }
      }
    }
    return list;
  }, [inflowsQ.data, settlementsQ.data]);

  // Combined Outflow items for breakdown
  const combinedOutflows = useMemo(() => {
    const list: any[] = [];
    if (outflowsQ.data) {
      for (const o of outflowsQ.data) {
        list.push({ ...o, displayCategory: o.type });
      }
    }
    if (commitmentsQ.data) {
      for (const c of commitmentsQ.data) {
        if (c.status !== "CANCELLED") {
          list.push({
            id: c.id,
            type: "PURCHASE_COMMITMENT",
            amount: c.expectedPaymentAmount,
            status: c.status,
            expectedDate: c.expectedPaymentDate,
            supplierName: c.supplierName,
            displayCategory: "PO Commitment",
          });
        }
      }
    }
    if (recurringQ.data) {
      for (const r of recurringQ.data) {
        if (r.status === "active") {
          list.push({
            id: r.id,
            type: "RECURRING_EXPENSE",
            amount: r.amount,
            status: "PLANNED",
            displayCategory: `Recurring: ${r.category}`,
          });
        }
      }
    }
    return list;
  }, [outflowsQ.data, commitmentsQ.data, recurringQ.data]);

  const hasWrite = canWrite;

  return (
    <div className="min-h-screen pb-12">
      <PageHeader
        eyebrow="Treasury & Liquidity"
        title="Cash Command Centre"
        description="Real-time available cash, 13-week forecast, marketplace settlements & financial runway."
        icon={<Wallet className="h-5 w-5" />}
        actions={
          hasWrite ? (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSettings(true)}
                className="h-8 gap-1.5 text-xs font-medium"
              >
                <Settings className="h-3.5 w-3.5" />
                Settings
              </Button>
              <Button
                size="sm"
                onClick={() => setShowAddAccount(true)}
                className="h-8 gap-1.5 text-xs font-medium"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Account
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="mx-auto w-full max-w-[1440px] space-y-6 px-4 py-6 md:px-8 md:py-8">
        {loading ? (
          <DashboardSkeleton />
        ) : (
          <>
            {/* ── Top Bar: Quick Add & Cash Status Banner ──────────────────────── */}
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              {forecast ? (
                <div className={`flex flex-1 items-center gap-3 rounded-xl border px-4 py-3 shadow-xs ${statusColor(forecast.cashStatus)}`}>
                  <div className={`h-3 w-3 rounded-full ${statusDot(forecast.cashStatus)} ring-4 ring-current/20`} />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">
                      Cash Health: {forecast.cashStatus === "GREEN" ? "Healthy (Above Buffer)" : forecast.cashStatus === "AMBER" ? "Attention Required" : "At Risk (Projected Shortfall)"}
                    </span>
                    {forecast.shortageRisk && (
                      <span className="text-xs font-medium bg-red-100 dark:bg-red-900/60 text-red-800 dark:text-red-200 px-2 py-0.5 rounded-md">
                        Deficit of {fmt(forecast.shortageAmount)} by {forecast.shortageDate}
                      </span>
                    )}
                  </div>
                </div>
              ) : <div />}

              {hasWrite && (
                <div className="flex items-center gap-2 shrink-0">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button className="h-10 gap-2 px-4 shadow-sm">
                        <Plus className="h-4 w-4" />
                        Quick Add
                        <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem onClick={() => setShowAddAccount(true)}>
                        <Landmark className="h-4 w-4 text-blue-600 mr-2" />
                        Add Cash / Bank Account
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setShowAddInflow(true)}>
                        <TrendingUp className="h-4 w-4 text-emerald-600 mr-2" />
                        Add Expected Inflow
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setShowAddSettlement(true)}>
                        <ShoppingCart className="h-4 w-4 text-violet-600 mr-2" />
                        Add Marketplace Settlement
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setShowAddOutflow(true)}>
                        <TrendingDown className="h-4 w-4 text-red-600 mr-2" />
                        Add Expected Outflow
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setShowAddRecurring(true)}>
                        <RefreshCw className="h-4 w-4 text-blue-600 mr-2" />
                        Add Recurring Expense
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setShowAddCommitment(true)}>
                        <CreditCard className="h-4 w-4 text-amber-600 mr-2" />
                        Add PO Commitment
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </div>

            {/* ── Summary Cards ──────────────────────────── */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              <SummaryCard
                icon={<Landmark className="h-4 w-4" />}
                iconClass="bg-blue-500/10 text-blue-600 dark:text-blue-400"
                value={fmt(totalAvailableCash)}
                label="Available Cash"
                sublabel={`${activeAccountsCount} active accounts`}
              />
              <SummaryCard
                icon={<TrendingUp className="h-4 w-4" />}
                iconClass="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                value={fmt(summary?.expectedInflowsNext7Days ?? 0)}
                label="Inflows (7d)"
                sublabel="Direct + Marketplace"
              />
              <SummaryCard
                icon={<TrendingDown className="h-4 w-4" />}
                iconClass="bg-red-500/10 text-red-600 dark:text-red-400"
                value={fmt(summary?.expectedOutflowsNext7Days ?? 0)}
                label="Outflows (7d)"
                sublabel="Bills + POs + Recurring"
              />
              <SummaryCard
                icon={<Calendar className="h-4 w-4" />}
                iconClass="bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
                value={fmt(projected7d)}
                label="Projected (7d)"
                sublabel="Net closing next week"
              />
              <SummaryCard
                icon={<Clock className="h-4 w-4" />}
                iconClass="bg-amber-500/10 text-amber-600 dark:text-amber-400"
                value={fmt(projected30d)}
                label="Projected (30d)"
                sublabel="Monthly closing runway"
              />
              <SummaryCard
                icon={<AlertTriangle className="h-4 w-4" />}
                iconClass={(summary?.lowestProjectedCash ?? totalAvailableCash) < (settingsQ.data?.minimumCashBuffer ?? 0) ? "bg-red-500/10 text-red-600" : "bg-emerald-500/10 text-emerald-600"}
                value={fmt(summary?.lowestProjectedCash ?? totalAvailableCash)}
                label={`Lowest (${summary?.lowestProjectedCashDate || "Horizon"})`}
                sublabel={`Min buffer: ${fmt(settingsQ.data?.minimumCashBuffer ?? 0)}`}
              />
            </div>

            {/* ── Quick Stats Row ────────────────────────── */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <QuickStat
                label="Overdue Collections"
                value={fmt(summary?.totalOverdueCollections ?? 0)}
                color={(summary?.totalOverdueCollections ?? 0) > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600"}
                icon={<AlertTriangle className="h-4 w-4" />}
                description="Receivables requiring follow-up"
              />
              <QuickStat
                label="Supplier Payments (7d)"
                value={fmt(summary?.totalSupplierPaymentsDue ?? 0)}
                color={(summary?.totalSupplierPaymentsDue ?? 0) > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600"}
                icon={<CreditCard className="h-4 w-4" />}
                description="Immediate vendor liabilities"
              />
              <QuickStat
                label="Marketplace Balances"
                value={fmt(totalMarketplaceBalance)}
                color="text-blue-600 dark:text-blue-400"
                icon={<Landmark className="h-4 w-4" />}
                description="In Amazon / Flipkart wallets"
              />
              <QuickStat
                label="Marketplace Pending"
                value={fmt(summary?.total_marketplace_settlements_pending ?? summary?.totalMarketplaceSettlementsPending ?? 0)}
                color="text-violet-600 dark:text-violet-400"
                icon={<ShoppingCart className="h-4 w-4" />}
                description="Expected payout disbursements"
              />
            </div>

            {/* ── Main Navigation Tabs ───────────────────── */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-5">
              <TabsList className="h-10 p-1 bg-muted/60 border border-border/80 rounded-xl overflow-x-auto w-full justify-start md:w-auto">
                <TabsTrigger value="overview" className="text-xs font-medium gap-1.5 px-3">
                  <LayoutDashboard className="h-3.5 w-3.5" />
                  Overview & Forecast
                </TabsTrigger>
                <TabsTrigger value="accounts" className="text-xs font-medium gap-1.5 px-3">
                  <Landmark className="h-3.5 w-3.5" />
                  Cash & Bank Accounts ({accountsQ.data?.length || 0})
                </TabsTrigger>
                <TabsTrigger value="settlements" className="text-xs font-medium gap-1.5 px-3">
                  <ShoppingCart className="h-3.5 w-3.5" />
                  Marketplace Settlements ({settlementsQ.data?.length || 0})
                </TabsTrigger>
                <TabsTrigger value="recurring" className="text-xs font-medium gap-1.5 px-3">
                  <RefreshCw className="h-3.5 w-3.5" />
                  Recurring Expenses ({recurringQ.data?.length || 0})
                </TabsTrigger>
                <TabsTrigger value="commitments" className="text-xs font-medium gap-1.5 px-3">
                  <CreditCard className="h-3.5 w-3.5" />
                  PO Commitments ({commitmentsQ.data?.length || 0})
                </TabsTrigger>
                <TabsTrigger value="inflows" className="text-xs font-medium gap-1.5 px-3">
                  <TrendingUp className="h-3.5 w-3.5" />
                  All Inflows ({inflowsQ.data?.length || 0})
                </TabsTrigger>
                <TabsTrigger value="outflows" className="text-xs font-medium gap-1.5 px-3">
                  <TrendingDown className="h-3.5 w-3.5" />
                  All Outflows ({outflowsQ.data?.length || 0})
                </TabsTrigger>
              </TabsList>

              {/* ── Tab 1: Overview & Forecast ─────────────── */}
              <TabsContent value="overview" className="space-y-6">
                {/* Forecast Chart */}
                {chartData.length > 0 && (
                  <div className="rounded-2xl border border-border bg-card p-5 shadow-xs">
                    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="text-base font-semibold text-foreground">
                          Cash Balance Projection
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          Dynamic trajectory comparing projected closing balance against minimum buffer.
                        </p>
                      </div>
                      <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
                        <TabsList className="h-8">
                          <TabsTrigger value="daily" className="text-xs px-2.5">Daily (30d)</TabsTrigger>
                          <TabsTrigger value="weekly" className="text-xs px-2.5">Weekly (13w)</TabsTrigger>
                          <TabsTrigger value="monthly" className="text-xs px-2.5">Monthly (6m)</TabsTrigger>
                        </TabsList>
                      </Tabs>
                    </div>
                    <div className="h-[320px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="closingGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
                              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.6} />
                          <XAxis
                            dataKey="name"
                            tick={{ fontSize: 11, fill: "#6b7280" }}
                            tickLine={false}
                            axisLine={false}
                          />
                          <YAxis
                            tick={{ fontSize: 11, fill: "#6b7280" }}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(v) => fmt(v)}
                          />
                          <Tooltip
                            content={({ active, payload, label }) => {
                              if (!active || !payload?.length) return null;
                              const d = payload[0]?.payload;
                              return (
                                <div className="rounded-xl border border-border bg-card p-3 shadow-lg text-xs space-y-1">
                                  <div className="font-semibold text-foreground border-b pb-1 mb-1">{label}</div>
                                  <div className="text-muted-foreground flex justify-between gap-4">
                                    <span>Opening Cash:</span>
                                    <span className="font-mono">{fmtFull(d.opening)}</span>
                                  </div>
                                  <div className="text-emerald-600 flex justify-between gap-4 font-medium">
                                    <span>Expected Inflows:</span>
                                    <span className="font-mono">+{fmtFull(d.inflows)}</span>
                                  </div>
                                  <div className="text-red-600 flex justify-between gap-4 font-medium">
                                    <span>Expected Outflows:</span>
                                    <span className="font-mono">−{fmtFull(d.outflows)}</span>
                                  </div>
                                  <div className="border-t pt-1 font-bold text-foreground flex justify-between gap-4">
                                    <span>Projected Closing:</span>
                                    <span className="font-mono">{fmtFull(d.closing)}</span>
                                  </div>
                                </div>
                              );
                            }}
                          />
                          <ReferenceLine
                            y={forecast?.minimumCashBuffer ?? 0}
                            stroke="#ef4444"
                            strokeDasharray="4 4"
                            strokeWidth={1.5}
                            label={{ value: `Buffer: ${fmt(forecast?.minimumCashBuffer ?? 0)}`, position: "insideTopRight", fontSize: 10, fill: "#ef4444" }}
                          />
                          <Area
                            type="monotone"
                            dataKey="closing"
                            stroke="#3b82f6"
                            strokeWidth={2.5}
                            fill="url(#closingGrad)"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* Forecast Table */}
                {forecast?.periods && (
                  <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
                    <div className="flex items-center justify-between border-b border-border px-5 py-4 bg-muted/20">
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">
                          {mode === "weekly" ? "13-Week Cash Forecast" : mode === "monthly" ? "6-Month Cash Plan" : "30-Day Daily Cash Forecast"}
                        </h3>
                        <p className="text-xs text-muted-foreground">Click any row to drill down into period event details.</p>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border bg-muted/40 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            <th className="px-5 py-3.5">Period</th>
                            <th className="px-5 py-3.5 text-right">Opening Cash</th>
                            <th className="px-5 py-3.5 text-right">Inflows</th>
                            <th className="px-5 py-3.5 text-right">Outflows</th>
                            <th className="px-5 py-3.5 text-right">Projected Closing</th>
                            <th className="px-5 py-3.5 text-center">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                          {forecast.periods.map((p: any, i: number) => {
                            const isExpanded = expandedPeriod === i;
                            const closingStatus =
                              p.closingCash < (forecast.minimumCashBuffer ?? 0)
                                ? "RED"
                                : p.closingCash < (forecast.minimumCashBuffer ?? 0) * 1.2
                                  ? "AMBER"
                                  : "GREEN";
                            return (
                              <PeriodRow
                                key={i}
                                period={p}
                                isExpanded={isExpanded}
                                closingStatus={closingStatus}
                                onToggle={() => setExpandedPeriod(isExpanded ? null : i)}
                              />
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Alerts */}
                {forecast?.alerts && forecast.alerts.length > 0 && (
                  <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
                    <div className="flex items-center gap-2 border-b border-border px-5 py-4 bg-amber-50/50 dark:bg-amber-950/20">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      <h3 className="text-sm font-semibold text-foreground">Treasury & Liquidity Alerts</h3>
                      <span className="ml-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600">
                        {forecast.alerts.length}
                      </span>
                    </div>
                    <div className="divide-y divide-border">
                      {forecast.alerts.map((alert: any) => (
                        <div key={alert.id} className="flex items-start gap-3 px-5 py-3.5 hover:bg-muted/20 transition-colors">
                          <div
                            className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                              alert.severity === "critical" ? "bg-red-500 ring-2 ring-red-300" : "bg-amber-500 ring-2 ring-amber-300"
                            }`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-foreground">{alert.message}</div>
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {alert.type.replace(/_/g, " ")}
                              {alert.amount ? ` • ${fmtFull(alert.amount)}` : ""}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Inflows & Outflows Breakdowns */}
                <div className="grid gap-6 md:grid-cols-2">
                  <BreakdownCard
                    title="Expected Inflows Breakdown"
                    items={combinedInflows}
                    direction="INFLOW"
                    loading={inflowsQ.isLoading || settlementsQ.isLoading}
                  />
                  <BreakdownCard
                    title="Expected Outflows Breakdown"
                    items={combinedOutflows}
                    direction="OUTFLOW"
                    loading={outflowsQ.isLoading || commitmentsQ.isLoading || recurringQ.isLoading}
                  />
                </div>
              </TabsContent>

              {/* ── Tab 2: Cash Accounts ───────────────────── */}
              <TabsContent value="accounts" className="space-y-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border bg-card p-5 shadow-xs">
                  <div>
                    <h3 className="text-base font-semibold text-foreground">Cash & Bank Accounts</h3>
                    <p className="text-xs text-muted-foreground">
                      All operational bank accounts, cash wallets, fixed deposits and marketplace accounts contributing to Available Cash.
                    </p>
                  </div>
                  {hasWrite && (
                    <Button onClick={() => setShowAddAccount(true)} size="sm" className="gap-1.5 self-start sm:self-auto">
                      <Plus className="h-4 w-4" />
                      Add Account
                    </Button>
                  )}
                </div>

                <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/40 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          <th className="px-5 py-3.5">Account Name</th>
                          <th className="px-5 py-3.5">Type</th>
                          <th className="px-5 py-3.5 text-right">Current Balance</th>
                          <th className="px-5 py-3.5 text-right">Restricted</th>
                          <th className="px-5 py-3.5 text-right">Available for Ops</th>
                          <th className="px-5 py-3.5 text-center">Status</th>
                          {hasWrite && <th className="px-5 py-3.5 text-right">Actions</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {accountsQ.data?.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="text-center py-8 text-sm text-muted-foreground">
                              No cash accounts found. Click "Add Account" to configure your bank and cash accounts.
                            </td>
                          </tr>
                        ) : (
                          accountsQ.data?.map((acc: any) => {
                            const accName = acc.accountName || acc.name || acc.account_name || "Cash Account";
                            const accType = acc.accountType || acc.type || acc.account_type || "BANK";
                            const currentBal = Number(acc.currentBalance ?? acc.balance ?? acc.current_balance ?? acc.amount ?? 0) || 0;
                            const restricted = Number(acc.restrictedBalance ?? acc.restricted ?? acc.restricted_balance ?? 0) || 0;
                            const avail = acc.availableForOperations !== undefined && !isNaN(Number(acc.availableForOperations))
                              ? Number(acc.availableForOperations)
                              : (currentBal - restricted);

                            return (
                              <tr key={acc.id} className="hover:bg-muted/20 transition-colors">
                                <td className="px-5 py-3.5 font-medium text-foreground">
                                  <div className="flex items-center gap-2">
                                    <Landmark className="h-4 w-4 text-primary" />
                                    <span>{accName}</span>
                                  </div>
                                </td>
                                <td className="px-5 py-3.5">
                                  <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
                                    {accType}
                                  </span>
                                </td>
                                <td className="px-5 py-3.5 text-right font-mono text-foreground font-medium">
                                  {fmtFull(currentBal)}
                                </td>
                                <td className="px-5 py-3.5 text-right font-mono text-muted-foreground">
                                  {fmtFull(restricted)}
                                </td>
                                <td className="px-5 py-3.5 text-right font-mono text-emerald-600 font-bold">
                                  {fmtFull(avail)}
                                </td>
                                <td className="px-5 py-3.5 text-center">
                                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                    (!acc.status || acc.status.toLowerCase() === "active")
                                      ? "bg-emerald-500/10 text-emerald-600"
                                      : "bg-red-500/10 text-red-600"
                                  }`}>
                                    {acc.status || "active"}
                                  </span>
                                </td>
                                {hasWrite && (
                                  <td className="px-5 py-3.5 text-right">
                                    <div className="flex items-center justify-end gap-1.5">
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                        onClick={() => setEditingAccount(acc)}
                                      >
                                        <Edit2 className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                                        onClick={() => setDeletingAccount(acc)}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </div>
                                  </td>
                                )}
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </TabsContent>

              {/* ── Tab 3: Marketplace Settlements ────────── */}
              <TabsContent value="settlements" className="space-y-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border bg-card p-5 shadow-xs">
                  <div>
                    <h3 className="text-base font-semibold text-foreground">Marketplace Settlements</h3>
                    <p className="text-xs text-muted-foreground">
                      Track gross marketplace sales, platform commissions, deductions, and net payouts from Amazon, Flipkart, etc.
                    </p>
                  </div>
                  {hasWrite && (
                    <Button onClick={() => setShowAddSettlement(true)} size="sm" className="gap-1.5 self-start sm:self-auto">
                      <Plus className="h-4 w-4" />
                      Add Settlement
                    </Button>
                  )}
                </div>

                <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/40 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          <th className="px-5 py-3.5">Marketplace</th>
                          <th className="px-5 py-3.5">Period / Reference</th>
                          <th className="px-5 py-3.5 text-right">Gross Sales</th>
                          <th className="px-5 py-3.5 text-right">Fees & Deductions</th>
                          <th className="px-5 py-3.5 text-right">Net Expected</th>
                          <th className="px-5 py-3.5">Expected Date</th>
                          <th className="px-5 py-3.5 text-center">Status</th>
                          {hasWrite && <th className="px-5 py-3.5 text-right">Actions</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {settlementsQ.data?.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="text-center py-8 text-sm text-muted-foreground">
                              No marketplace settlements found.
                            </td>
                          </tr>
                        ) : (
                          settlementsQ.data?.map((s: any) => {
                            const totalFees = (Number(s.marketplace_fees ?? s.marketplaceFees) || 0) + (Number(s.deductions) || 0) + (Number(s.refunds_returns ?? s.refundsReturns) || 0);
                            return (
                              <tr key={s.id} className="hover:bg-muted/20 transition-colors">
                                <td className="px-5 py-3.5 font-medium text-foreground">
                                  <div className="flex items-center gap-2">
                                    <ShoppingCart className="h-4 w-4 text-violet-600" />
                                    {s.marketplace_name ?? s.marketplaceName}
                                  </div>
                                </td>
                                <td className="px-5 py-3.5 text-xs text-muted-foreground">
                                  {(s.settlement_period ?? s.settlementPeriod) || (s.settlement_reference ?? s.settlementReference) || "—"}
                                </td>
                                <td className="px-5 py-3.5 text-right font-mono font-medium text-foreground">
                                  {fmtFull(s.gross_sales ?? s.grossSales)}
                                </td>
                                <td className="px-5 py-3.5 text-right font-mono text-red-500">
                                  −{fmtFull(totalFees)}
                                </td>
                                <td className="px-5 py-3.5 text-right font-mono font-bold text-emerald-600">
                                  +{fmtFull(s.net_settlement_expected ?? s.netSettlementExpected)}
                                </td>
                                <td className="px-5 py-3.5 text-xs font-mono text-muted-foreground">
                                  {s.expected_settlement_date ?? s.expectedSettlementDate}
                                </td>
                                <td className="px-5 py-3.5 text-center">
                                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                                    s.status === "RECEIVED"
                                      ? "bg-emerald-500/10 text-emerald-600"
                                      : s.status === "DELAYED"
                                        ? "bg-amber-500/10 text-amber-600"
                                        : s.status === "DISPUTED"
                                          ? "bg-red-500/10 text-red-600"
                                          : "bg-blue-500/10 text-blue-600"
                                  }`}>
                                    {s.status}
                                  </span>
                                </td>
                                {hasWrite && (
                                  <td className="px-5 py-3.5 text-right">
                                    <div className="flex items-center justify-end gap-1.5">
                                      {s.status !== "RECEIVED" && (
                                        <Button
                                          variant="outline"
                                          size="xs"
                                          className="h-7 text-xs text-emerald-600 border-emerald-300 hover:bg-emerald-50"
                                          onClick={async () => {
                                            try {
                                              await api.cashFlow.settlements.update(s.id, {
                                                status: "RECEIVED",
                                                actualSettlementDate: new Date().toISOString().slice(0, 10),
                                              });
                                              toast.success("Settlement marked as RECEIVED");
                                              invalidateAll();
                                            } catch (err: any) {
                                              toast.error(err.message);
                                            }
                                          }}
                                        >
                                          <CheckCircle2 className="h-3 w-3 mr-1" />
                                          Received
                                        </Button>
                                      )}
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                        onClick={() => setEditingSettlement(s)}
                                      >
                                        <Edit2 className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                                        onClick={() => setDeletingSettlement(s)}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </div>
                                  </td>
                                )}
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </TabsContent>

              {/* ── Tab 4: Recurring Expenses ─────────────── */}
              <TabsContent value="recurring" className="space-y-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border bg-card p-5 shadow-xs">
                  <div>
                    <h3 className="text-base font-semibold text-foreground">Recurring Expenses</h3>
                    <p className="text-xs text-muted-foreground">
                      Overhead and fixed costs automatically projected forward across all daily, weekly, and monthly periods.
                    </p>
                  </div>
                  {hasWrite && (
                    <Button onClick={() => setShowAddRecurring(true)} size="sm" className="gap-1.5 self-start sm:self-auto">
                      <Plus className="h-4 w-4" />
                      Add Recurring Expense
                    </Button>
                  )}
                </div>

                <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/40 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          <th className="px-5 py-3.5">Category</th>
                          <th className="px-5 py-3.5">Description</th>
                          <th className="px-5 py-3.5">Frequency</th>
                          <th className="px-5 py-3.5">Payment Day</th>
                          <th className="px-5 py-3.5 text-right">Amount</th>
                          <th className="px-5 py-3.5 text-center">Status</th>
                          {hasWrite && <th className="px-5 py-3.5 text-right">Actions</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y border-border/60">
                        {recurringQ.data?.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="text-center py-8 text-sm text-muted-foreground">
                              No recurring expenses configured. Add rent, payroll, subscriptions, or debt payments.
                            </td>
                          </tr>
                        ) : (
                          recurringQ.data?.map((r: any) => (
                            <tr key={r.id} className="hover:bg-muted/20 transition-colors">
                              <td className="px-5 py-3.5 font-medium text-foreground">
                                <div className="flex items-center gap-2">
                                  <RefreshCw className="h-4 w-4 text-blue-600" />
                                  {r.category}
                                </div>
                              </td>
                              <td className="px-5 py-3.5 text-xs text-muted-foreground">
                                {r.description || "—"}
                              </td>
                              <td className="px-5 py-3.5">
                                <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
                                  {r.frequency}
                                </span>
                              </td>
                              <td className="px-5 py-3.5 text-xs font-mono text-muted-foreground">
                                Day {r.paymentDay || 1}
                              </td>
                              <td className="px-5 py-3.5 text-right font-mono font-bold text-red-600">
                                −{fmtFull(r.amount)}
                              </td>
                              <td className="px-5 py-3.5 text-center">
                                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                  r.status === "active"
                                    ? "bg-emerald-500/10 text-emerald-600"
                                    : "bg-muted text-muted-foreground"
                                }`}>
                                  {r.status || "active"}
                                </span>
                              </td>
                              {hasWrite && (
                                <td className="px-5 py-3.5 text-right">
                                  <div className="flex items-center justify-end gap-1.5">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                      title={r.status === "active" ? "Pause" : "Resume"}
                                      onClick={async () => {
                                        try {
                                          await api.cashFlow.recurring.update(r.id, {
                                            status: r.status === "active" ? "paused" : "active",
                                          });
                                          toast.success(r.status === "active" ? "Expense paused" : "Expense activated");
                                          invalidateAll();
                                        } catch (err: any) {
                                          toast.error(err.message);
                                        }
                                      }}
                                    >
                                      {r.status === "active" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                      onClick={() => setEditingRecurring(r)}
                                    >
                                      <Edit2 className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                                      onClick={() => setDeletingRecurring(r)}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </td>
                              )}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </TabsContent>

              {/* ── Tab 5: PO Commitments ──────────────────── */}
              <TabsContent value="commitments" className="space-y-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border bg-card p-5 shadow-xs">
                  <div>
                    <h3 className="text-base font-semibold text-foreground">Purchase Commitments</h3>
                    <p className="text-xs text-muted-foreground">
                      Committed PO outflows before supplier invoice arrival, with critical stock dependency alerts.
                    </p>
                  </div>
                  {hasWrite && (
                    <Button onClick={() => setShowAddCommitment(true)} size="sm" className="gap-1.5 self-start sm:self-auto">
                      <Plus className="h-4 w-4" />
                      Add Commitment
                    </Button>
                  )}
                </div>

                <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/40 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          <th className="px-5 py-3.5">Supplier</th>
                          <th className="px-5 py-3.5">Linked PO / Notes</th>
                          <th className="px-5 py-3.5">Payment Date</th>
                          <th className="px-5 py-3.5 text-center">Critical Stock</th>
                          <th className="px-5 py-3.5 text-right">Amount</th>
                          <th className="px-5 py-3.5 text-center">Status</th>
                          {hasWrite && <th className="px-5 py-3.5 text-right">Actions</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {commitmentsQ.data?.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="text-center py-8 text-sm text-muted-foreground">
                              No purchase commitments recorded.
                            </td>
                          </tr>
                        ) : (
                          commitmentsQ.data?.map((c: any) => (
                            <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                              <td className="px-5 py-3.5 font-medium text-foreground">
                                <div className="flex items-center gap-2">
                                  <Building2 className="h-4 w-4 text-amber-600" />
                                  {c.supplierName || "Supplier"}
                                </div>
                              </td>
                              <td className="px-5 py-3.5 text-xs text-muted-foreground">
                                {c.linkedPO ? `PO #${c.linkedPO}` : c.notes || "—"}
                              </td>
                              <td className="px-5 py-3.5 text-xs font-mono text-muted-foreground">
                                {c.expectedPaymentDate}
                              </td>
                              <td className="px-5 py-3.5 text-center">
                                {c.criticalStockDependency ? (
                                  <span className="rounded-full bg-red-500/10 text-red-600 px-2 py-0.5 text-[10px] font-bold">
                                    CRITICAL
                                  </span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">Standard</span>
                                )}
                              </td>
                              <td className="px-5 py-3.5 text-right font-mono font-bold text-red-600">
                                −{fmtFull(c.expectedPaymentAmount)}
                              </td>
                              <td className="px-5 py-3.5 text-center">
                                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                                  {c.status || "COMMITTED"}
                                </span>
                              </td>
                              {hasWrite && (
                                <td className="px-5 py-3.5 text-right">
                                  <div className="flex items-center justify-end gap-1.5">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                      onClick={() => setEditingCommitment(c)}
                                    >
                                      <Edit2 className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                                      onClick={() => setDeletingCommitment(c)}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </td>
                              )}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </TabsContent>

              {/* ── Tab 6: All Inflows ─────────────────────── */}
              <TabsContent value="inflows" className="space-y-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border bg-card p-5 shadow-xs">
                  <div>
                    <h3 className="text-base font-semibold text-foreground">Expected Cash Inflows</h3>
                    <p className="text-xs text-muted-foreground">
                      Customer collections, advance receipts, loan disbursements, promoter capital and tax refunds.
                    </p>
                  </div>
                  {hasWrite && (
                    <Button onClick={() => setShowAddInflow(true)} size="sm" className="gap-1.5 self-start sm:self-auto">
                      <Plus className="h-4 w-4" />
                      Add Inflow
                    </Button>
                  )}
                </div>

                <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/40 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          <th className="px-5 py-3.5">Type</th>
                          <th className="px-5 py-3.5">Customer / Source</th>
                          <th className="px-5 py-3.5">Expected Date</th>
                          <th className="px-5 py-3.5 text-center">Confidence</th>
                          <th className="px-5 py-3.5 text-right">Amount</th>
                          <th className="px-5 py-3.5 text-center">Status</th>
                          {hasWrite && <th className="px-5 py-3.5 text-right">Actions</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {inflowsQ.data?.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="text-center py-8 text-sm text-muted-foreground">
                              No expected inflows recorded.
                            </td>
                          </tr>
                        ) : (
                          inflowsQ.data?.map((i: any) => (
                            <tr key={i.id} className="hover:bg-muted/20 transition-colors">
                              <td className="px-5 py-3.5 font-medium text-foreground">
                                <span className="rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 text-xs font-medium">
                                  {i.type.replace(/_/g, " ")}
                                </span>
                              </td>
                              <td className="px-5 py-3.5 text-xs font-medium text-foreground">
                                {i.customerName || i.marketplaceName || i.notes || "—"}
                              </td>
                              <td className="px-5 py-3.5 text-xs font-mono text-muted-foreground">
                                {i.expectedDate}
                              </td>
                              <td className="px-5 py-3.5 text-center text-xs font-mono">
                                {i.confidence || 80}%
                              </td>
                              <td className="px-5 py-3.5 text-right font-mono font-bold text-emerald-600">
                                +{fmtFull(i.amount)}
                              </td>
                              <td className="px-5 py-3.5 text-center">
                                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                  i.status === "RECEIVED"
                                    ? "bg-emerald-500/10 text-emerald-600"
                                    : i.status === "OVERDUE"
                                      ? "bg-red-500/10 text-red-600"
                                      : "bg-blue-500/10 text-blue-600"
                                }`}>
                                  {i.status || "EXPECTED"}
                                </span>
                              </td>
                              {hasWrite && (
                                <td className="px-5 py-3.5 text-right">
                                  <div className="flex items-center justify-end gap-1.5">
                                    {i.status !== "RECEIVED" && (
                                      <Button
                                        variant="outline"
                                        size="xs"
                                        className="h-7 text-xs text-emerald-600 border-emerald-300 hover:bg-emerald-50"
                                        onClick={async () => {
                                          try {
                                            await api.cashFlow.inflows.update(i.id, {
                                              status: "RECEIVED",
                                            });
                                            toast.success("Inflow marked as RECEIVED");
                                            invalidateAll();
                                          } catch (err: any) {
                                            toast.error(err.message);
                                          }
                                        }}
                                      >
                                        <CheckCircle2 className="h-3 w-3 mr-1" />
                                        Received
                                      </Button>
                                    )}
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                      onClick={() => setEditingInflow(i)}
                                    >
                                      <Edit2 className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                                      onClick={() => setDeletingInflow(i)}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </td>
                              )}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </TabsContent>

              {/* ── Tab 7: All Outflows ────────────────────── */}
              <TabsContent value="outflows" className="space-y-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border bg-card p-5 shadow-xs">
                  <div>
                    <h3 className="text-base font-semibold text-foreground">Expected Cash Outflows</h3>
                    <p className="text-xs text-muted-foreground">
                      Supplier invoices, tax settlements, salary obligations, rent and other discretionary or fixed payments.
                    </p>
                  </div>
                  {hasWrite && (
                    <Button onClick={() => setShowAddOutflow(true)} size="sm" className="gap-1.5 self-start sm:self-auto">
                      <Plus className="h-4 w-4" />
                      Add Outflow
                    </Button>
                  )}
                </div>

                <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/40 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          <th className="px-5 py-3.5">Type</th>
                          <th className="px-5 py-3.5">Supplier / Payee</th>
                          <th className="px-5 py-3.5">Expected Date</th>
                          <th className="px-5 py-3.5 text-center">Priority</th>
                          <th className="px-5 py-3.5 text-right">Amount</th>
                          <th className="px-5 py-3.5 text-center">Status</th>
                          {hasWrite && <th className="px-5 py-3.5 text-right">Actions</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {outflowsQ.data?.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="text-center py-8 text-sm text-muted-foreground">
                              No expected outflows recorded.
                            </td>
                          </tr>
                        ) : (
                          outflowsQ.data?.map((o: any) => (
                            <tr key={o.id} className="hover:bg-muted/20 transition-colors">
                              <td className="px-5 py-3.5 font-medium text-foreground">
                                <span className="rounded-md bg-red-500/10 text-red-700 dark:text-red-300 px-2 py-0.5 text-xs font-medium">
                                  {o.type.replace(/_/g, " ")}
                                </span>
                              </td>
                              <td className="px-5 py-3.5 text-xs font-medium text-foreground">
                                {o.supplierName || o.notes || "—"}
                              </td>
                              <td className="px-5 py-3.5 text-xs font-mono text-muted-foreground">
                                {o.expectedDate}
                              </td>
                              <td className="px-5 py-3.5 text-center">
                                <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                                  o.priority === "CRITICAL"
                                    ? "bg-red-500/10 text-red-600"
                                    : o.priority === "HIGH"
                                      ? "bg-amber-500/10 text-amber-600"
                                      : "bg-muted text-muted-foreground"
                                }`}>
                                  {o.priority || "NORMAL"}
                                </span>
                              </td>
                              <td className="px-5 py-3.5 text-right font-mono font-bold text-red-600">
                                −{fmtFull(o.amount)}
                              </td>
                              <td className="px-5 py-3.5 text-center">
                                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                  o.status === "PAID"
                                    ? "bg-emerald-500/10 text-emerald-600"
                                    : "bg-muted text-muted-foreground"
                                }`}>
                                  {o.status || "PLANNED"}
                                </span>
                              </td>
                              {hasWrite && (
                                <td className="px-5 py-3.5 text-right">
                                  <div className="flex items-center justify-end gap-1.5">
                                    {o.status !== "PAID" && (
                                      <Button
                                        variant="outline"
                                        size="xs"
                                        className="h-7 text-xs text-emerald-600 border-emerald-300 hover:bg-emerald-50"
                                        onClick={async () => {
                                          try {
                                            await api.cashFlow.outflows.update(o.id, {
                                              status: "PAID",
                                            });
                                            toast.success("Outflow marked as PAID");
                                            invalidateAll();
                                          } catch (err: any) {
                                            toast.error(err.message);
                                          }
                                        }}
                                      >
                                        <CheckCircle2 className="h-3 w-3 mr-1" />
                                        Paid
                                      </Button>
                                    )}
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                      onClick={() => setEditingOutflow(o)}
                                    >
                                      <Edit2 className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                                      onClick={() => setDeletingOutflow(o)}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </td>
                              )}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>

      {/* ── Dialogs ────────────────────────────────────────── */}
      {showSettings && (
        <SettingsDialog
          settings={settingsQ.data}
          onClose={() => setShowSettings(false)}
          onSuccess={() => {
            invalidateAll();
            setShowSettings(false);
          }}
        />
      )}

      {showAddAccount && (
        <AccountFormDialog
          onClose={() => setShowAddAccount(false)}
          onSuccess={() => {
            invalidateAll();
            setShowAddAccount(false);
          }}
        />
      )}

      {editingAccount && (
        <AccountFormDialog
          account={editingAccount}
          onClose={() => setEditingAccount(null)}
          onSuccess={() => {
            invalidateAll();
            setEditingAccount(null);
          }}
        />
      )}

      {deletingAccount && (
        <DeleteConfirmDialog
          title="Delete Cash Account"
          description={`Are you sure you want to delete account "${deletingAccount.accountName || deletingAccount.name || 'this account'}"? This will remove its balance from total Available Cash.`}
          onClose={() => setDeletingAccount(null)}
          onConfirm={async () => {
            try {
              await api.cashFlow.accounts.delete(deletingAccount.id);
              toast.success("Account deleted");
              invalidateAll();
              setDeletingAccount(null);
            } catch (err: any) {
              toast.error(err.message);
            }
          }}
        />
      )}

      {showAddInflow && (
        <InflowFormDialog
          onClose={() => setShowAddInflow(false)}
          onSuccess={() => {
            invalidateAll();
            setShowAddInflow(false);
          }}
        />
      )}

      {editingInflow && (
        <InflowFormDialog
          inflow={editingInflow}
          onClose={() => setEditingInflow(null)}
          onSuccess={() => {
            invalidateAll();
            setEditingInflow(null);
          }}
        />
      )}

      {deletingInflow && (
        <DeleteConfirmDialog
          title="Delete Expected Inflow"
          description="Are you sure you want to delete this expected inflow?"
          onClose={() => setDeletingInflow(null)}
          onConfirm={async () => {
            try {
              await api.cashFlow.inflows.delete(deletingInflow.id);
              toast.success("Expected inflow deleted");
              invalidateAll();
              setDeletingInflow(null);
            } catch (err: any) {
              toast.error(err.message);
            }
          }}
        />
      )}

      {showAddOutflow && (
        <OutflowFormDialog
          onClose={() => setShowAddOutflow(false)}
          onSuccess={() => {
            invalidateAll();
            setShowAddOutflow(false);
          }}
        />
      )}

      {editingOutflow && (
        <OutflowFormDialog
          outflow={editingOutflow}
          onClose={() => setEditingOutflow(null)}
          onSuccess={() => {
            invalidateAll();
            setEditingOutflow(null);
          }}
        />
      )}

      {deletingOutflow && (
        <DeleteConfirmDialog
          title="Delete Expected Outflow"
          description="Are you sure you want to delete this expected outflow?"
          onClose={() => setDeletingOutflow(null)}
          onConfirm={async () => {
            try {
              await api.cashFlow.outflows.delete(deletingOutflow.id);
              toast.success("Expected outflow deleted");
              invalidateAll();
              setDeletingOutflow(null);
            } catch (err: any) {
              toast.error(err.message);
            }
          }}
        />
      )}

      {showAddRecurring && (
        <RecurringFormDialog
          onClose={() => setShowAddRecurring(false)}
          onSuccess={() => {
            invalidateAll();
            setShowAddRecurring(false);
          }}
        />
      )}

      {editingRecurring && (
        <RecurringFormDialog
          recurring={editingRecurring}
          onClose={() => setEditingRecurring(null)}
          onSuccess={() => {
            invalidateAll();
            setEditingRecurring(null);
          }}
        />
      )}

      {deletingRecurring && (
        <DeleteConfirmDialog
          title="Delete Recurring Expense"
          description={`Are you sure you want to delete recurring expense "${deletingRecurring.category}"? It will no longer be projected into future cash flows.`}
          onClose={() => setDeletingRecurring(null)}
          onConfirm={async () => {
            try {
              await api.cashFlow.recurring.delete(deletingRecurring.id);
              toast.success("Recurring expense deleted");
              invalidateAll();
              setDeletingRecurring(null);
            } catch (err: any) {
              toast.error(err.message);
            }
          }}
        />
      )}

      {showAddCommitment && (
        <CommitmentFormDialog
          onClose={() => setShowAddCommitment(false)}
          onSuccess={() => {
            invalidateAll();
            setShowAddCommitment(false);
          }}
        />
      )}

      {editingCommitment && (
        <CommitmentFormDialog
          commitment={editingCommitment}
          onClose={() => setEditingCommitment(null)}
          onSuccess={() => {
            invalidateAll();
            setEditingCommitment(null);
          }}
        />
      )}

      {deletingCommitment && (
        <DeleteConfirmDialog
          title="Delete Purchase Commitment"
          description="Are you sure you want to delete this purchase commitment?"
          onClose={() => setDeletingCommitment(null)}
          onConfirm={async () => {
            try {
              await api.cashFlow.commitments.delete(deletingCommitment.id);
              toast.success("Commitment deleted");
              invalidateAll();
              setDeletingCommitment(null);
            } catch (err: any) {
              toast.error(err.message);
            }
          }}
        />
      )}

      {showAddSettlement && (
        <SettlementFormDialog
          onClose={() => setShowAddSettlement(false)}
          onSuccess={() => {
            invalidateAll();
            setShowAddSettlement(false);
          }}
        />
      )}

      {editingSettlement && (
        <SettlementFormDialog
          settlement={editingSettlement}
          onClose={() => setEditingSettlement(null)}
          onSuccess={() => {
            invalidateAll();
            setEditingSettlement(null);
          }}
        />
      )}

      {deletingSettlement && (
        <DeleteConfirmDialog
          title="Delete Marketplace Settlement"
          description={`Are you sure you want to delete settlement for "${deletingSettlement.marketplaceName}"?`}
          onClose={() => setDeletingSettlement(null)}
          onConfirm={async () => {
            try {
              await api.cashFlow.settlements.delete(deletingSettlement.id);
              toast.success("Settlement deleted");
              invalidateAll();
              setDeletingSettlement(null);
            } catch (err: any) {
              toast.error(err.message);
            }
          }}
        />
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function SummaryCard({
  icon,
  iconClass,
  value,
  label,
  sublabel,
}: {
  icon: React.ReactNode;
  iconClass: string;
  value: string;
  label: string;
  sublabel?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-xs hover:border-primary/40 transition-all">
      <div className="flex items-center justify-between">
        <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${iconClass}`}>
          {icon}
        </div>
      </div>
      <div className="mt-3 text-xl font-bold font-mono tracking-tight text-foreground">
        {value}
      </div>
      <div className="mt-0.5 text-xs font-semibold text-foreground/80">{label}</div>
      {sublabel && (
        <div className="mt-0.5 text-[10px] text-muted-foreground truncate">{sublabel}</div>
      )}
    </div>
  );
}

function QuickStat({
  label,
  value,
  color,
  icon,
  description,
}: {
  label: string;
  value: string;
  color: string;
  icon: React.ReactNode;
  description?: string;
}) {
  return (
    <div className="flex items-center gap-3.5 rounded-2xl border border-border bg-card p-4 shadow-xs hover:border-primary/30 transition-all">
      <div className={`p-2.5 rounded-xl bg-muted/60 ${color}`}>{icon}</div>
      <div className="min-w-0 flex-1">
        <div className={`text-base font-bold font-mono ${color}`}>{value}</div>
        <div className="text-xs font-semibold text-foreground/90">{label}</div>
        {description && <div className="text-[10px] text-muted-foreground truncate">{description}</div>}
      </div>
    </div>
  );
}

function PeriodRow({
  period,
  isExpanded,
  closingStatus,
  onToggle,
}: {
  period: any;
  isExpanded: boolean;
  closingStatus: string;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="cursor-pointer border-b border-border/50 transition-colors hover:bg-muted/40"
        onClick={onToggle}
      >
        <td className="px-5 py-3.5 font-medium text-foreground">
          <div className="flex items-center gap-2">
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-primary" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            {period.label}
          </div>
        </td>
        <td className="px-5 py-3.5 text-right font-mono text-muted-foreground">
          {fmtFull(period.openingCash)}
        </td>
        <td className="px-5 py-3.5 text-right font-mono text-emerald-600 font-medium">
          +{fmtFull(period.expectedInflows)}
        </td>
        <td className="px-5 py-3.5 text-right font-mono text-red-600 font-medium">
          −{fmtFull(period.expectedOutflows)}
        </td>
        <td className={`px-5 py-3.5 text-right font-mono font-bold ${
          closingStatus === "RED" ? "text-red-600" : closingStatus === "AMBER" ? "text-amber-600" : "text-foreground"
        }`}>
          {fmtFull(period.closingCash)}
        </td>
        <td className="px-5 py-3.5 text-center">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${
            closingStatus === "RED" ? "bg-red-500" : closingStatus === "AMBER" ? "bg-amber-500" : "bg-emerald-500"
          }`} />
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={6} className="bg-muted/30 px-8 py-4">
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5" />
                  Inflows ({period.inflowEvents?.length || 0})
                </h4>
                {!period.inflowEvents || period.inflowEvents.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No inflows scheduled for this period</p>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-2">
                    {period.inflowEvents.map((e: any, i: number) => (
                      <div key={i} className="flex items-center justify-between rounded-lg bg-card p-2 text-xs border border-border/60">
                        <div className="min-w-0 pr-2">
                          <span className="font-medium text-foreground block truncate">{e.description || e.type}</span>
                          <span className="text-[10px] text-muted-foreground">{e.date} · {e.category || e.source}</span>
                        </div>
                        <span className="font-mono font-bold text-emerald-600 shrink-0">+{fmtFull(e.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-red-700 dark:text-red-400 flex items-center gap-1.5">
                  <TrendingDown className="h-3.5 w-3.5" />
                  Outflows ({period.outflowEvents?.length || 0})
                </h4>
                {!period.outflowEvents || period.outflowEvents.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No outflows scheduled for this period</p>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-2">
                    {period.outflowEvents.map((e: any, i: number) => (
                      <div key={i} className="flex items-center justify-between rounded-lg bg-card p-2 text-xs border border-border/60">
                        <div className="min-w-0 pr-2">
                          <span className="font-medium text-foreground block truncate">{e.description || e.type}</span>
                          <span className="text-[10px] text-muted-foreground">{e.date} · {e.category || e.source}</span>
                        </div>
                        <span className="font-mono font-bold text-red-600 shrink-0">−{fmtFull(e.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function BreakdownCard({
  title,
  items,
  direction,
  loading,
}: {
  title: string;
  items: any[];
  direction: "INFLOW" | "OUTFLOW";
  loading: boolean;
}) {
  const active = items.filter(
    (i) =>
      i.status !== "RECEIVED" &&
      i.status !== "CANCELLED" &&
      i.status !== "PAID"
  );
  const total = active.reduce((s, i) => s + (Number(i.amount) || 0), 0);

  const grouped = new Map<string, number>();
  for (const item of active) {
    const key = item.displayCategory || item.type || item.category || "Other";
    grouped.set(key, (grouped.get(key) || 0) + (Number(item.amount) || 0));
  }
  const sorted = Array.from(grouped.entries()).sort((a, b) => b[1] - a[1]);

  return (
    <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-5 py-4 bg-muted/20">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <span className="text-sm font-bold font-mono text-foreground">
          {fmtFull(total)}
        </span>
      </div>
      <div className="p-5">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-9 w-full rounded-xl" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground py-6">
            No active {direction === "INFLOW" ? "expected inflows" : "expected outflows"}
          </p>
        ) : (
          <div className="space-y-2">
            {sorted.map(([type, amount]) => (
              <div key={type} className="flex items-center justify-between rounded-xl bg-muted/30 px-3.5 py-2.5 border border-border/40">
                <span className="text-xs font-medium text-foreground">
                  {type.replace(/_/g, " ")}
                </span>
                <span className={`text-xs font-bold font-mono ${
                  direction === "INFLOW" ? "text-emerald-600" : "text-red-600"
                }`}>
                  {direction === "INFLOW" ? "+" : "−"}{fmtFull(amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Modals & Dialogs ───────────────────────────────────────────────────────

function AccountFormDialog({
  account,
  onClose,
  onSuccess,
}: {
  account?: any;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState(account?.accountName || account?.name || account?.account_name || "");
  const [type, setType] = useState(account?.accountType || account?.type || account?.account_type || "BANK");
  const [balance, setBalance] = useState(
    account != null ? String(account.currentBalance ?? account.balance ?? account.current_balance ?? account.amount ?? "0") : ""
  );
  const [restricted, setRestricted] = useState(
    account != null ? String(account.restrictedBalance ?? account.restricted ?? account.restricted_balance ?? "0") : "0"
  );
  const [status, setStatus] = useState(account?.status || "active");

  const isEdit = !!account;

  const mutation = useMutation({
    mutationFn: () => {
      const numBal = Number(balance) || 0;
      const numRest = Number(restricted) || 0;
      const payload = {
        accountName: name.trim(),
        name: name.trim(),
        accountType: type,
        type: type,
        currentBalance: numBal,
        balance: numBal,
        restrictedBalance: numRest,
        restricted: numRest,
        availableForOperations: numBal - numRest,
        status,
      };
      return isEdit
        ? api.cashFlow.accounts.update(account.id, payload)
        : api.cashFlow.accounts.create(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? "Cash account updated" : "Cash account created");
      onSuccess();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const numBal = Number(balance) || 0;
  const numRest = Number(restricted) || 0;
  const avail = numBal - numRest;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Cash Account" : "Add Cash Account"}</DialogTitle>
          <DialogDescription>
            Configure your bank, cash wallet, or marketplace account balance.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Account Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1"
              placeholder="e.g. HDFC Current Account, Amazon Wallet, Petty Cash"
            />
          </div>
          <div>
            <Label>Account Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="BANK">Bank Account</SelectItem>
                <SelectItem value="CASH">Cash in Hand / Petty Cash</SelectItem>
                <SelectItem value="MARKETPLACE">Marketplace Wallet (Amazon/Flipkart)</SelectItem>
                <SelectItem value="FIXED_DEPOSIT">Fixed Deposit (FD)</SelectItem>
                <SelectItem value="OTHER">Other Liquidity Account</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Current Balance</Label>
              <Input
                type="number"
                value={balance}
                onChange={(e) => setBalance(e.target.value)}
                className="mt-1 font-mono"
                placeholder="0.00"
              />
            </div>
            <div>
              <Label>Restricted Balance</Label>
              <Input
                type="number"
                value={restricted}
                onChange={(e) => setRestricted(e.target.value)}
                className="mt-1 font-mono"
                placeholder="0.00"
              />
            </div>
          </div>
          <div className="rounded-xl bg-muted/60 p-3 flex justify-between items-center text-xs">
            <span className="text-muted-foreground font-medium">Available for Operations:</span>
            <span className="font-mono font-bold text-sm text-emerald-600">{fmtFull(avail)}</span>
          </div>
          {isEdit && (
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="closed">Closed / Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!name.trim() || balance === "" || mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {isEdit ? "Update Account" : "Create Account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InflowFormDialog({
  inflow,
  onClose,
  onSuccess,
}: {
  inflow?: any;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isEdit = !!inflow;
  const [type, setType] = useState(inflow?.type || "CUSTOMER_COLLECTION");
  const [amount, setAmount] = useState(String(inflow?.amount ?? ""));
  const [date, setDate] = useState(inflow?.expectedDate || "");
  const [customerName, setCustomerName] = useState(inflow?.customerName || "");
  const [confidence, setConfidence] = useState(String(inflow?.confidence ?? "80"));
  const [status, setStatus] = useState(inflow?.status || "EXPECTED");
  const [notes, setNotes] = useState(inflow?.notes || "");

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        type,
        amount: Number(amount),
        expectedDate: date,
        customerName: customerName || undefined,
        confidence: Number(confidence),
        status,
        notes: notes || undefined,
      };
      return isEdit
        ? api.cashFlow.inflows.update(inflow.id, payload)
        : api.cashFlow.inflows.create(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? "Expected inflow updated" : "Expected inflow created");
      onSuccess();
    },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Expected Inflow" : "Add Expected Inflow"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Inflow Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="CUSTOMER_COLLECTION">Customer Collection</SelectItem>
                <SelectItem value="MARKETPLACE_SETTLEMENT">Marketplace Settlement</SelectItem>
                <SelectItem value="ADVANCE_RECEIPT">Advance Receipt</SelectItem>
                <SelectItem value="LOAN_DISBURSEMENT">Loan Disbursement</SelectItem>
                <SelectItem value="PROMOTER_CAPITAL">Promoter Capital</SelectItem>
                <SelectItem value="TAX_REFUND">Tax Refund</SelectItem>
                <SelectItem value="INSURANCE_CLAIM">Insurance Claim</SelectItem>
                <SelectItem value="DEPOSIT_REFUND">Deposit Refund</SelectItem>
                <SelectItem value="INTEREST_RECEIPT">Interest Receipt</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Amount</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 font-mono" />
            </div>
            <div>
              <Label>Expected Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 font-mono" />
            </div>
          </div>
          <div>
            <Label>Customer / Source</Label>
            <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="mt-1" placeholder="e.g. Acme Corp" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Confidence (%)</Label>
              <Input type="number" value={confidence} onChange={(e) => setConfidence(e.target.value)} className="mt-1 font-mono" min="0" max="100" />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="EXPECTED">Expected</SelectItem>
                  <SelectItem value="PROMISED">Promised</SelectItem>
                  <SelectItem value="PARTIALLY_RECEIVED">Partially Received</SelectItem>
                  <SelectItem value="RECEIVED">Received</SelectItem>
                  <SelectItem value="OVERDUE">Overdue</SelectItem>
                  <SelectItem value="DELAYED">Delayed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!amount || !date || mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {isEdit ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OutflowFormDialog({
  outflow,
  onClose,
  onSuccess,
}: {
  outflow?: any;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isEdit = !!outflow;
  const [type, setType] = useState(outflow?.type || "SUPPLIER_PAYMENT");
  const [amount, setAmount] = useState(String(outflow?.amount ?? ""));
  const [date, setDate] = useState(outflow?.expectedDate || "");
  const [supplierName, setSupplierName] = useState(outflow?.supplierName || "");
  const [priority, setPriority] = useState(outflow?.priority || "NORMAL");
  const [status, setStatus] = useState(outflow?.status || "PLANNED");
  const [notes, setNotes] = useState(outflow?.notes || "");

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        type,
        amount: Number(amount),
        expectedDate: date,
        supplierName: supplierName || undefined,
        priority,
        status,
        notes: notes || undefined,
      };
      return isEdit
        ? api.cashFlow.outflows.update(outflow.id, payload)
        : api.cashFlow.outflows.create(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? "Expected outflow updated" : "Expected outflow created");
      onSuccess();
    },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Expected Outflow" : "Add Expected Outflow"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Outflow Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="SUPPLIER_PAYMENT">Supplier Payment</SelectItem>
                <SelectItem value="SALARY">Salary / Payroll</SelectItem>
                <SelectItem value="TAX">GST / TDS / Corporate Tax</SelectItem>
                <SelectItem value="EMI">Loan / EMI Repayment</SelectItem>
                <SelectItem value="RENT">Office / Warehouse Rent</SelectItem>
                <SelectItem value="UTILITY">Utility Bills</SelectItem>
                <SelectItem value="SOFTWARE">Software & Subscriptions</SelectItem>
                <SelectItem value="WAREHOUSE">Warehouse Logistics</SelectItem>
                <SelectItem value="TRANSPORT">Freight & Transport</SelectItem>
                <SelectItem value="MARKETING">Marketing & Ads</SelectItem>
                <SelectItem value="INSURANCE">Insurance Premium</SelectItem>
                <SelectItem value="PROFESSIONAL_FEE">Audit & Legal Fees</SelectItem>
                <SelectItem value="CAPEX">Capital Expenditure</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Amount</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 font-mono" />
            </div>
            <div>
              <Label>Expected Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 font-mono" />
            </div>
          </div>
          <div>
            <Label>Supplier / Payee</Label>
            <Input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} className="mt-1" placeholder="e.g. Tata Power, Vendor X" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CRITICAL">Critical</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="NORMAL">Normal</SelectItem>
                  <SelectItem value="CAN_DEFER">Can Defer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PLANNED">Planned</SelectItem>
                  <SelectItem value="APPROVED">Approved for Payment</SelectItem>
                  <SelectItem value="DUE">Due</SelectItem>
                  <SelectItem value="PAID">Paid</SelectItem>
                  <SelectItem value="DEFERRED">Deferred</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!amount || !date || mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {isEdit ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecurringFormDialog({
  recurring,
  onClose,
  onSuccess,
}: {
  recurring?: any;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isEdit = !!recurring;
  const [category, setCategory] = useState(recurring?.category || "");
  const [amount, setAmount] = useState(String(recurring?.amount ?? ""));
  const [frequency, setFrequency] = useState(recurring?.frequency || "MONTHLY");
  const [paymentDay, setPaymentDay] = useState(String(recurring?.paymentDay ?? "1"));
  const [startDate, setStartDate] = useState(recurring?.startDate || "");
  const [description, setDescription] = useState(recurring?.description || "");
  const [status, setStatus] = useState(recurring?.status || "active");

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        category,
        amount: Number(amount),
        frequency,
        paymentDay: Number(paymentDay),
        startDate: startDate || undefined,
        description: description || undefined,
        status,
      };
      return isEdit
        ? api.cashFlow.recurring.update(recurring.id, payload)
        : api.cashFlow.recurring.create(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? "Recurring expense updated" : "Recurring expense created");
      onSuccess();
    },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Recurring Expense" : "Add Recurring Expense"}</DialogTitle>
          <DialogDescription>
            Scheduled cost automatically computed in 7d/30d and 13-week projections.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Category</Label>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1" placeholder="e.g. Office Rent, Payroll, AWS, Loan EMI" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Amount</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 font-mono" />
            </div>
            <div>
              <Label>Frequency</Label>
              <Select value={frequency} onValueChange={setFrequency}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="WEEKLY">Weekly</SelectItem>
                  <SelectItem value="MONTHLY">Monthly</SelectItem>
                  <SelectItem value="QUARTERLY">Quarterly</SelectItem>
                  <SelectItem value="ANNUAL">Annual</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Payment Day (1-31)</Label>
              <Input type="number" value={paymentDay} onChange={(e) => setPaymentDay(e.target.value)} className="mt-1 font-mono" min="1" max="31" />
            </div>
            <div>
              <Label>Start Date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1 font-mono" />
            </div>
          </div>
          <div>
            <Label>Description / Notes</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1" />
          </div>
          {isEdit && (
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!category || !amount || mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {isEdit ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CommitmentFormDialog({
  commitment,
  onClose,
  onSuccess,
}: {
  commitment?: any;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isEdit = !!commitment;
  const [amount, setAmount] = useState(String(commitment?.expectedPaymentAmount ?? ""));
  const [date, setDate] = useState(commitment?.expectedPaymentDate || "");
  const [supplierName, setSupplierName] = useState(commitment?.supplierName || "");
  const [linkedPO, setLinkedPO] = useState(commitment?.linkedPO || "");
  const [critical, setCritical] = useState(commitment?.criticalStockDependency ?? false);
  const [notes, setNotes] = useState(commitment?.notes || "");

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        expectedPaymentAmount: Number(amount),
        expectedPaymentDate: date,
        supplierName: supplierName || undefined,
        linkedPO: linkedPO || undefined,
        criticalStockDependency: critical,
        notes: notes || undefined,
      };
      return isEdit
        ? api.cashFlow.commitments.update(commitment.id, payload)
        : api.cashFlow.commitments.create(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? "Purchase commitment updated" : "Purchase commitment created");
      onSuccess();
    },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Purchase Commitment" : "Add Purchase Commitment"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Amount</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 font-mono" />
            </div>
            <div>
              <Label>Expected Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 font-mono" />
            </div>
          </div>
          <div>
            <Label>Supplier</Label>
            <Input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} className="mt-1" placeholder="e.g. Raw Material Supplier" />
          </div>
          <div>
            <Label>Linked PO Reference</Label>
            <Input value={linkedPO} onChange={(e) => setLinkedPO(e.target.value)} className="mt-1" placeholder="e.g. PO-2026-089" />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="critical"
              checked={critical}
              onChange={(e) => setCritical(e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            <Label htmlFor="critical" className="cursor-pointer text-xs font-medium">Critical stock dependency (High Alert if delayed)</Label>
          </div>
          <div>
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!amount || !date || mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {isEdit ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettlementFormDialog({
  settlement,
  onClose,
  onSuccess,
}: {
  settlement?: any;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isEdit = !!settlement;
  const [marketplace, setMarketplace] = useState((settlement?.marketplace_name ?? settlement?.marketplaceName) || "");
  const [gross, setGross] = useState(String(settlement?.gross_sales ?? settlement?.grossSales ?? ""));
  const [fees, setFees] = useState(String(settlement?.marketplace_fees ?? settlement?.marketplaceFees ?? "0"));
  const [deductions, setDeductions] = useState(String(settlement?.deductions ?? "0"));
  const [refunds, setRefunds] = useState(String(settlement?.refunds_returns ?? settlement?.refundsReturns ?? "0"));
  const [date, setDate] = useState((settlement?.expected_settlement_date ?? settlement?.expectedSettlementDate) || "");
  const [period, setPeriod] = useState((settlement?.settlement_period ?? settlement?.settlementPeriod) || "");
  const [status, setStatus] = useState(settlement?.status || "EXPECTED");

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        marketplaceName: marketplace,
        grossSales: Number(gross),
        marketplaceFees: Number(fees),
        deductions: Number(deductions),
        refundsReturns: Number(refunds),
        expectedSettlementDate: date,
        settlementPeriod: period || undefined,
        status,
      };
      return isEdit
        ? api.cashFlow.settlements.update(settlement.id, payload)
        : api.cashFlow.settlements.create(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? "Marketplace settlement updated" : "Marketplace settlement created");
      onSuccess();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const net = Math.max(0, Number(gross || 0) - Number(fees || 0) - Number(deductions || 0) - Number(refunds || 0));

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Marketplace Settlement" : "Add Marketplace Settlement"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Marketplace Platform</Label>
            <Input value={marketplace} onChange={(e) => setMarketplace(e.target.value)} className="mt-1" placeholder="e.g. Amazon India, Flipkart, Myntra, Blinkit" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Gross Sales</Label>
              <Input type="number" value={gross} onChange={(e) => setGross(e.target.value)} className="mt-1 font-mono" />
            </div>
            <div>
              <Label>Marketplace Fees</Label>
              <Input type="number" value={fees} onChange={(e) => setFees(e.target.value)} className="mt-1 font-mono" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Deductions & Penalties</Label>
              <Input type="number" value={deductions} onChange={(e) => setDeductions(e.target.value)} className="mt-1 font-mono" />
            </div>
            <div>
              <Label>Refunds / Returns</Label>
              <Input type="number" value={refunds} onChange={(e) => setRefunds(e.target.value)} className="mt-1 font-mono" />
            </div>
          </div>
          <div className="rounded-xl bg-muted/60 p-3 flex justify-between items-center text-xs">
            <span className="text-muted-foreground font-medium">Net Payout Expected:</span>
            <span className="font-mono font-bold text-sm text-emerald-600">{fmtFull(net)}</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Expected Settlement Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 font-mono" />
            </div>
            <div>
              <Label>Settlement Period</Label>
              <Input value={period} onChange={(e) => setPeriod(e.target.value)} className="mt-1" placeholder="e.g. Sep 1 - Sep 15" />
            </div>
          </div>
          {isEdit && (
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="EXPECTED">Expected</SelectItem>
                  <SelectItem value="RECEIVED">Received</SelectItem>
                  <SelectItem value="DELAYED">Delayed</SelectItem>
                  <SelectItem value="DISPUTED">Disputed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!marketplace || !gross || !date || mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {isEdit ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettingsDialog({
  settings,
  onClose,
  onSuccess,
}: {
  settings: any;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [buffer, setBuffer] = useState(String(settings?.minimumCashBuffer ?? 100000));
  const [currency, setCurrency] = useState(settings?.baseCurrency ?? "INR");
  const mutation = useMutation({
    mutationFn: () =>
      api.cashFlow.settings.update({
        minimumCashBuffer: Number(buffer),
        baseCurrency: currency,
      }),
    onSuccess: () => {
      toast.success("Cash flow settings updated");
      onSuccess();
    },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cash Flow & Treasury Settings</DialogTitle>
          <DialogDescription>Configure safety cash buffer and currency.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Minimum Cash Safety Buffer</Label>
            <Input
              type="number"
              value={buffer}
              onChange={(e) => setBuffer(e.target.value)}
              className="mt-1 font-mono"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Shortfall warnings trigger when projected closing cash drops below this limit.
            </p>
          </div>
          <div>
            <Label>Base Currency</Label>
            <Input
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="mt-1 font-mono"
              placeholder="INR"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Save Settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteConfirmDialog({
  title,
  description,
  onClose,
  onConfirm,
}: {
  title: string;
  description: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [isPending, setIsPending] = useState(false);
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={isPending}
            onClick={async () => {
              setIsPending(true);
              try {
                await onConfirm();
              } finally {
                setIsPending(false);
              }
            }}
          >
            {isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-14 w-full rounded-2xl" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-[320px] rounded-2xl" />
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  );
}
