import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/ledger-ui";
import {
  AlertTriangle,
  Banknote,
  Calendar,
  ChevronDown,
  ChevronRight,
  Clock,
  CreditCard,
  DollarSign,
  Download,
  Eye,
  Filter,
  Landmark,
  LayoutDashboard,
  Link2,
  Loader2,
  Minus,
  Package,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
  Zap,
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
  BarChart,
  Bar,
  Legend,
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
  if (status === "GREEN") return "text-emerald-600 bg-emerald-50";
  if (status === "AMBER") return "text-amber-600 bg-amber-50";
  return "text-red-600 bg-red-50";
}

function statusDot(status: string): string {
  if (status === "GREEN") return "bg-emerald-500";
  if (status === "AMBER") return "bg-amber-500";
  return "bg-red-500";
}

// ── Page ───────────────────────────────────────────────────────────────────

function CashFlowPage() {
  const { user, isAdmin, isTreasury } = useAuth();
  const canWrite = isAdmin || isTreasury;
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [expandedPeriod, setExpandedPeriod] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [showAddInflow, setShowAddInflow] = useState(false);
  const [showAddOutflow, setShowAddOutflow] = useState(false);
  const [showAddRecurring, setShowAddRecurring] = useState(false);
  const [showAddCommitment, setShowAddCommitment] = useState(false);
  const [showAddSettlement, setShowAddSettlement] = useState(false);

  // Fetch forecast
  const forecastQ = useQuery({
    queryKey: ["cash-flow-forecast", mode],
    queryFn: () => api.cashFlow.forecast.get(mode),
    refetchInterval: 60_000,
  });

  // Fetch summary
  const summaryQ = useQuery({
    queryKey: ["cash-flow-summary"],
    queryFn: () => api.cashFlow.summary(),
    refetchInterval: 60_000,
  });

  // Fetch cash accounts
  const accountsQ = useQuery({
    queryKey: ["cash-accounts"],
    queryFn: () => api.cashFlow.accounts.list(),
  });

  // Fetch settings
  const settingsQ = useQuery({
    queryKey: ["cash-flow-settings"],
    queryFn: () => api.cashFlow.settings.get(),
  });

  // Fetch inflows for breakdown
  const inflowsQ = useQuery({
    queryKey: ["cash-flow-inflows"],
    queryFn: () => api.cashFlow.inflows.list(),
  });

  // Fetch outflows for breakdown
  const outflowsQ = useQuery({
    queryKey: ["cash-flow-outflows"],
    queryFn: () => api.cashFlow.outflows.list(),
  });

  // Fetch recurring expenses
  const recurringQ = useQuery({
    queryKey: ["cash-flow-recurring"],
    queryFn: () => api.cashFlow.recurring.list(),
  });

  const forecast = forecastQ.data;
  const summary = summaryQ.data;
  const loading = forecastQ.isLoading || summaryQ.isLoading;

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

  const hasWrite = canWrite;

  return (
    <div className="min-h-screen">
      <PageHeader
        eyebrow="Treasury"
        title="Cash Command Centre"
        description="13-week cash-flow forecast, shortage detection & financial planning."
        icon={<Wallet className="h-5 w-5" />}
        actions={
          hasWrite ? (
            <div className="flex gap-2">
              <button
                onClick={() => setShowSettings(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
              >
                <Settings className="h-3.5 w-3.5" />
                Settings
              </button>
              <button
                onClick={() => setShowAddAccount(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Account
              </button>
            </div>
          ) : undefined
        }
      />

      <div className="mx-auto w-full max-w-[1440px] space-y-5 px-4 py-6 md:px-8 md:py-8">
        {loading ? (
          <DashboardSkeleton />
        ) : (
          <>
            {/* ── Quick Add Dropdown ──────────────────────── */}
            {hasWrite && (
              <div className="flex justify-start">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
                      <Plus className="h-4 w-4" />
                      Quick Add
                      <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    <DropdownMenuItem onClick={() => setShowAddInflow(true)}>
                      <TrendingUp className="h-4 w-4 text-emerald-600" />
                      Add Expected Inflow
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setShowAddOutflow(true)}>
                      <TrendingDown className="h-4 w-4 text-red-600" />
                      Add Expected Outflow
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setShowAddRecurring(true)}>
                      <RefreshCw className="h-4 w-4 text-blue-600" />
                      Add Recurring Expense
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setShowAddCommitment(true)}>
                      <ShoppingCart className="h-4 w-4 text-amber-600" />
                      Add Purchase Commitment
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setShowAddSettlement(true)}>
                      <Landmark className="h-4 w-4 text-violet-600" />
                      Add Marketplace Settlement
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}

            {/* ── Status Bar ─────────────────────────────── */}
            {forecast && (
              <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${statusColor(forecast.cashStatus)}`}>
                <div className={`h-3 w-3 rounded-full ${statusDot(forecast.cashStatus)}`} />
                <span className="text-sm font-medium">
                  Cash Status: {forecast.cashStatus === "GREEN" ? "Healthy" : forecast.cashStatus === "AMBER" ? "Warning" : "At Risk"}
                </span>
                {forecast.shortageRisk && (
                  <span className="text-xs">
                    — Shortfall of {fmt(forecast.shortageAmount)} projected by {forecast.shortageDate}
                  </span>
                )}
              </div>
            )}

            {/* ── Summary Cards ──────────────────────────── */}
            {summary && (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                <SummaryCard
                  icon={<Landmark className="h-4 w-4" />}
                  iconClass="bg-primary/10 text-primary"
                  value={fmt(summary.currentAvailableCash)}
                  label="Available Cash"
                />
                <SummaryCard
                  icon={<TrendingUp className="h-4 w-4" />}
                  iconClass="bg-emerald-500/10 text-emerald-600"
                  value={fmt(summary.expectedInflowsNext7Days)}
                  label="Inflows (7d)"
                />
                <SummaryCard
                  icon={<TrendingDown className="h-4 w-4" />}
                  iconClass="bg-red-500/10 text-red-600"
                  value={fmt(summary.expectedOutflowsNext7Days)}
                  label="Outflows (7d)"
                />
                <SummaryCard
                  icon={<Calendar className="h-4 w-4" />}
                  iconClass="bg-blue-500/10 text-blue-600"
                  value={fmt(summary.projectedClosingCashNext7Days)}
                  label="Projected (7d)"
                />
                <SummaryCard
                  icon={<Clock className="h-4 w-4" />}
                  iconClass="bg-amber-500/10 text-amber-600"
                  value={fmt(summary.projectedClosingCashNext30Days)}
                  label="Projected (30d)"
                />
                <SummaryCard
                  icon={<AlertTriangle className="h-4 w-4" />}
                  iconClass={summary.lowestProjectedCash < (settingsQ.data?.minimumCashBuffer ?? 0) ? "bg-red-500/10 text-red-600" : "bg-emerald-500/10 text-emerald-600"}
                  value={fmt(summary.lowestProjectedCash)}
                  label={`Lowest (${summary.lowestProjectedCashDate})`}
                />
              </div>
            )}

            {/* ── Quick Stats Row ────────────────────────── */}
            {summary && (
              <div className="grid grid-cols-3 gap-3">
                <QuickStat
                  label="Overdue Collections"
                  value={fmt(summary.totalOverdueCollections)}
                  color={summary.totalOverdueCollections > 0 ? "text-red-600" : "text-emerald-600"}
                  icon={<AlertTriangle className="h-3.5 w-3.5" />}
                />
                <QuickStat
                  label="Supplier Payments Due (7d)"
                  value={fmt(summary.totalSupplierPaymentsDue)}
                  color={summary.totalSupplierPaymentsDue > 0 ? "text-amber-600" : "text-emerald-600"}
                  icon={<CreditCard className="h-3.5 w-3.5" />}
                />
                <QuickStat
                  label="Marketplace Pending"
                  value={fmt(summary.totalMarketplaceSettlementsPending)}
                  color="text-blue-600"
                  icon={<ShoppingCart className="h-3.5 w-3.5" />}
                />
              </div>
            )}

            {/* ── Forecast Chart ─────────────────────────── */}
            {chartData.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">
                    Cash Balance Projection
                  </h3>
                  <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
                    <TabsList className="h-8">
                      <TabsTrigger value="daily" className="text-xs">Daily</TabsTrigger>
                      <TabsTrigger value="weekly" className="text-xs">Weekly</TabsTrigger>
                      <TabsTrigger value="monthly" className="text-xs">Monthly</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="closingGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
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
                            <div className="rounded-lg border border-border bg-card p-3 shadow-lg">
                              <div className="text-xs font-semibold text-foreground">{label}</div>
                              <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                                <div>Opening: {fmtFull(d.opening)}</div>
                                <div className="text-emerald-600">Inflows: +{fmtFull(d.inflows)}</div>
                                <div className="text-red-600">Outflows: −{fmtFull(d.outflows)}</div>
                                <div className="font-medium text-foreground">Closing: {fmtFull(d.closing)}</div>
                              </div>
                            </div>
                          );
                        }}
                      />
                      <ReferenceLine
                        y={forecast?.minimumCashBuffer ?? 0}
                        stroke="#ef4444"
                        strokeDasharray="5 5"
                        strokeWidth={1.5}
                        label={{ value: "Min Buffer", position: "right", fontSize: 10, fill: "#ef4444" }}
                      />
                      <Area
                        type="monotone"
                        dataKey="closing"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        fill="url(#closingGrad)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* ── Weekly Cash Table ──────────────────────── */}
            {forecast?.periods && (
              <div className="rounded-xl border border-border bg-card shadow-sm">
                <div className="flex items-center justify-between border-b border-border px-5 py-4">
                  <h3 className="text-sm font-semibold text-foreground">
                    {mode === "weekly" ? "13-Week" : mode === "monthly" ? "6-Month" : "30-Day"} Cash Forecast
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        <th className="px-5 py-3">Period</th>
                        <th className="px-5 py-3 text-right">Opening Cash</th>
                        <th className="px-5 py-3 text-right">Expected Inflows</th>
                        <th className="px-5 py-3 text-right">Expected Outflows</th>
                        <th className="px-5 py-3 text-right">Projected Closing</th>
                        <th className="px-5 py-3 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody>
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
                            index={i}
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

            {/* ── Alerts Panel ───────────────────────────── */}
            {forecast?.alerts && forecast.alerts.length > 0 && (
              <div className="rounded-xl border border-border bg-card shadow-sm">
                <div className="flex items-center gap-2 border-b border-border px-5 py-4">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  <h3 className="text-sm font-semibold text-foreground">Cash Flow Alerts</h3>
                  <span className="ml-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600">
                    {forecast.alerts.length}
                  </span>
                </div>
                <div className="divide-y divide-border">
                  {forecast.alerts.map((alert: any) => (
                    <div key={alert.id} className="flex items-start gap-3 px-5 py-3">
                      <div
                        className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                          alert.severity === "critical" ? "bg-red-500" : "bg-amber-500"
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-foreground">{alert.message}</div>
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



            {/* ── Inflow / Outflow Breakdown ─────────────── */}
            <div className="grid gap-5 md:grid-cols-2">
              <BreakdownCard
                title="Expected Inflows"
                items={inflowsQ.data ?? []}
                direction="INFLOW"
                loading={inflowsQ.isLoading}
              />
              <BreakdownCard
                title="Expected Outflows"
                items={outflowsQ.data ?? []}
                direction="OUTFLOW"
                loading={outflowsQ.isLoading}
              />
            </div>
          </>
        )}
      </div>

      {/* ── Dialogs ────────────────────────────────────────── */}
      {showSettings && (
        <SettingsDialog
          settings={settingsQ.data}
          onClose={() => setShowSettings(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["cash-flow-settings"] });
            queryClient.invalidateQueries({ queryKey: ["cash-flow-forecast"] });
            setShowSettings(false);
          }}
        />
      )}
      {showAddAccount && (
        <AddAccountDialog
          onClose={() => setShowAddAccount(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["cash-accounts"] });
            queryClient.invalidateQueries({ queryKey: ["cash-flow-forecast"] });
            queryClient.invalidateQueries({ queryKey: ["cash-flow-summary"] });
            setShowAddAccount(false);
          }}
        />
      )}
      {showAddInflow && (
        <AddInflowDialog
          onClose={() => setShowAddInflow(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["cash-flow-inflows"] });
            queryClient.invalidateQueries({ queryKey: ["cash-flow-forecast"] });
            queryClient.invalidateQueries({ queryKey: ["cash-flow-summary"] });
            setShowAddInflow(false);
          }}
        />
      )}
      {showAddOutflow && (
        <AddOutflowDialog
          onClose={() => setShowAddOutflow(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["cash-flow-outflows"] });
            queryClient.invalidateQueries({ queryKey: ["cash-flow-forecast"] });
            queryClient.invalidateQueries({ queryKey: ["cash-flow-summary"] });
            setShowAddOutflow(false);
          }}
        />
      )}
      {showAddRecurring && (
        <AddRecurringDialog
          onClose={() => setShowAddRecurring(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["cash-flow-recurring"] });
            queryClient.invalidateQueries({ queryKey: ["cash-flow-forecast"] });
            setShowAddRecurring(false);
          }}
        />
      )}
      {showAddCommitment && (
        <AddCommitmentDialog
          onClose={() => setShowAddCommitment(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["cash-flow-forecast"] });
            setShowAddCommitment(false);
          }}
        />
      )}
      {showAddSettlement && (
        <AddSettlementDialog
          onClose={() => setShowAddSettlement(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["cash-flow-forecast"] });
            queryClient.invalidateQueries({ queryKey: ["cash-flow-summary"] });
            setShowAddSettlement(false);
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
}: {
  icon: React.ReactNode;
  iconClass: string;
  value: string;
  label: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
      <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${iconClass}`}>
        {icon}
      </div>
      <div className="mt-2 text-lg font-bold tabular-nums leading-none text-foreground">
        {value}
      </div>
      <div className="mt-1 text-[11px] font-medium text-muted-foreground">{label}</div>
    </div>
  );
}

function QuickStat({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: string;
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
      <div className={`${color}`}>{icon}</div>
      <div>
        <div className={`text-sm font-bold tabular-nums ${color}`}>{value}</div>
        <div className="text-[11px] text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function PeriodRow({
  period,
  index,
  isExpanded,
  closingStatus,
  onToggle,
}: {
  period: any;
  index: number;
  isExpanded: boolean;
  closingStatus: string;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="cursor-pointer border-b border-border/50 transition-colors hover:bg-muted/30"
        onClick={onToggle}
      >
        <td className="px-5 py-3 font-medium text-foreground">
          <div className="flex items-center gap-2">
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            {period.label}
          </div>
        </td>
        <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
          {fmtFull(period.openingCash)}
        </td>
        <td className="px-5 py-3 text-right tabular-nums text-emerald-600">
          +{fmtFull(period.expectedInflows)}
        </td>
        <td className="px-5 py-3 text-right tabular-nums text-red-600">
          −{fmtFull(period.expectedOutflows)}
        </td>
        <td className={`px-5 py-3 text-right font-medium tabular-nums ${
          closingStatus === "RED" ? "text-red-600" : closingStatus === "AMBER" ? "text-amber-600" : "text-foreground"
        }`}>
          {fmtFull(period.closingCash)}
        </td>
        <td className="px-5 py-3 text-center">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${
            closingStatus === "RED" ? "bg-red-500" : closingStatus === "AMBER" ? "bg-amber-500" : "bg-emerald-500"
          }`} />
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={6} className="bg-muted/20 px-8 py-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Inflows ({period.inflowEvents.length})
                </h4>
                {period.inflowEvents.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No inflows in this period</p>
                ) : (
                  <div className="space-y-1">
                    {period.inflowEvents.map((e: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground truncate max-w-[200px]">{e.description || e.type}</span>
                        <span className="font-medium text-emerald-600 tabular-nums">+{fmtFull(e.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Outflows ({period.outflowEvents.length})
                </h4>
                {period.outflowEvents.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No outflows in this period</p>
                ) : (
                  <div className="space-y-1">
                    {period.outflowEvents.map((e: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground truncate max-w-[200px]">{e.description || e.type}</span>
                        <span className="font-medium text-red-600 tabular-nums">−{fmtFull(e.amount)}</span>
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

  // Group by type
  const grouped = new Map<string, number>();
  for (const item of active) {
    const key = item.type || item.category || "Other";
    grouped.set(key, (grouped.get(key) || 0) + (Number(item.amount) || 0));
  }
  const sorted = Array.from(grouped.entries()).sort((a, b) => b[1] - a[1]);

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <span className="text-sm font-bold tabular-nums text-muted-foreground">
          {fmtFull(total)}
        </span>
      </div>
      <div className="p-5">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-4">No {direction === "INFLOW" ? "expected inflows" : "expected outflows"}</p>
        ) : (
          <div className="space-y-2">
            {sorted.map(([type, amount]) => (
              <div key={type} className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2">
                <span className="text-xs font-medium text-foreground">
                  {type.replace(/_/g, " ")}
                </span>
                <span className={`text-xs font-bold tabular-nums ${
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

// ── Dialogs ────────────────────────────────────────────────────────────────

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
      toast.success("Settings updated");
      onSuccess();
    },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cash Flow Settings</DialogTitle>
          <DialogDescription>Configure minimum cash buffer and currency.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Minimum Cash Buffer</Label>
            <Input
              type="number"
              value={buffer}
              onChange={(e) => setBuffer(e.target.value)}
              className="mt-1"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Alerts fire when projected cash falls below this amount.
            </p>
          </div>
          <div>
            <Label>Base Currency</Label>
            <Input
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="mt-1"
              placeholder="INR"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddAccountDialog({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState("BANK");
  const [balance, setBalance] = useState("");
  const [restricted, setRestricted] = useState("0");
  const mutation = useMutation({
    mutationFn: () =>
      api.cashFlow.accounts.create({
        accountName: name,
        accountType: type,
        currentBalance: Number(balance),
        restrictedBalance: Number(restricted),
      }),
    onSuccess: () => {
      toast.success("Cash account created");
      onSuccess();
    },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Cash Account</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Account Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" placeholder="e.g. HDFC Current Account" />
          </div>
          <div>
            <Label>Account Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="BANK">Bank</SelectItem>
                <SelectItem value="CASH">Cash in Hand</SelectItem>
                <SelectItem value="MARKETPLACE">Marketplace</SelectItem>
                <SelectItem value="FIXED_DEPOSIT">Fixed Deposit</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Current Balance</Label>
            <Input type="number" value={balance} onChange={(e) => setBalance(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Restricted Balance</Label>
            <Input type="number" value={restricted} onChange={(e) => setRestricted(e.target.value)} className="mt-1" />
            <p className="mt-1 text-xs text-muted-foreground">Amount not available for operations.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!name || !balance || mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddInflowDialog({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [type, setType] = useState("OTHER");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [confidence, setConfidence] = useState("80");
  const mutation = useMutation({
    mutationFn: () =>
      api.cashFlow.inflows.create({
        type,
        amount: Number(amount),
        expectedDate: date,
        notes,
        customerName: customerName || undefined,
        confidence: Number(confidence),
      }),
    onSuccess: () => {
      toast.success("Expected inflow created");
      onSuccess();
    },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Expected Inflow</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="CUSTOMER_COLLECTION">Customer Collection</SelectItem>
                <SelectItem value="LOAN_DISBURSEMENT">Loan Disbursement</SelectItem>
                <SelectItem value="PROMOTER_CAPITAL">Promoter Capital</SelectItem>
                <SelectItem value="TAX_REFUND">Tax Refund</SelectItem>
                <SelectItem value="INSURANCE_CLAIM">Insurance Claim</SelectItem>
                <SelectItem value="ADVANCE_RECEIPT">Advance Receipt</SelectItem>
                <SelectItem value="DEPOSIT_REFUND">Deposit Refund</SelectItem>
                <SelectItem value="INTEREST_RECEIPT">Interest Receipt</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Amount</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Expected Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
            </div>
          </div>
          <div>
            <Label>Customer / Source Name</Label>
            <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Confidence (%)</Label>
            <Input type="number" value={confidence} onChange={(e) => setConfidence(e.target.value)} className="mt-1" min="0" max="100" />
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
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddOutflowDialog({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [type, setType] = useState("OTHER");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [priority, setPriority] = useState("NORMAL");
  const mutation = useMutation({
    mutationFn: () =>
      api.cashFlow.outflows.create({
        type,
        amount: Number(amount),
        expectedDate: date,
        notes,
        supplierName: supplierName || undefined,
        priority,
      }),
    onSuccess: () => {
      toast.success("Expected outflow created");
      onSuccess();
    },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Expected Outflow</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="SUPPLIER_PAYMENT">Supplier Payment</SelectItem>
                <SelectItem value="SALARY">Salary</SelectItem>
                <SelectItem value="TAX">Tax</SelectItem>
                <SelectItem value="EMI">EMI / Loan</SelectItem>
                <SelectItem value="RENT">Rent</SelectItem>
                <SelectItem value="UTILITY">Utility</SelectItem>
                <SelectItem value="SOFTWARE">Software</SelectItem>
                <SelectItem value="WAREHOUSE">Warehouse</SelectItem>
                <SelectItem value="TRANSPORT">Transport</SelectItem>
                <SelectItem value="MARKETING">Marketing</SelectItem>
                <SelectItem value="INSURANCE">Insurance</SelectItem>
                <SelectItem value="PROFESSIONAL_FEE">Professional Fee</SelectItem>
                <SelectItem value="CAPEX">Capital Expenditure</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Amount</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Expected Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
            </div>
          </div>
          <div>
            <Label>Supplier / Payee</Label>
            <Input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} className="mt-1" />
          </div>
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
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!amount || !date || mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddRecurringDialog({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState("MONTHLY");
  const [paymentDay, setPaymentDay] = useState("1");
  const [startDate, setStartDate] = useState("");
  const [description, setDescription] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      api.cashFlow.recurring.create({
        category,
        amount: Number(amount),
        frequency,
        paymentDay: Number(paymentDay),
        startDate: startDate || undefined,
        description: description || undefined,
      }),
    onSuccess: () => {
      toast.success("Recurring expense created");
      onSuccess();
    },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Recurring Expense</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Category</Label>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1" placeholder="e.g. Salary, Rent, EMI" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Amount</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1" />
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
              <Label>Payment Day</Label>
              <Input type="number" value={paymentDay} onChange={(e) => setPaymentDay(e.target.value)} className="mt-1" min="1" max="31" />
            </div>
            <div>
              <Label>Start Date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1" />
            </div>
          </div>
          <div>
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!category || !amount || mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddCommitmentDialog({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [critical, setCritical] = useState(false);
  const [notes, setNotes] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      api.cashFlow.commitments.create({
        expectedPaymentAmount: Number(amount),
        expectedPaymentDate: date,
        supplierName: supplierName || undefined,
        criticalStockDependency: critical,
        notes: notes || undefined,
      }),
    onSuccess: () => {
      toast.success("Purchase commitment created");
      onSuccess();
    },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Purchase Commitment</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Amount</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Expected Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
            </div>
          </div>
          <div>
            <Label>Supplier</Label>
            <Input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} className="mt-1" />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="critical"
              checked={critical}
              onChange={(e) => setCritical(e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            <Label htmlFor="critical" className="cursor-pointer">Critical stock dependency</Label>
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
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddSettlementDialog({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [marketplace, setMarketplace] = useState("");
  const [gross, setGross] = useState("");
  const [fees, setFees] = useState("0");
  const [deductions, setDeductions] = useState("0");
  const [refunds, setRefunds] = useState("0");
  const [date, setDate] = useState("");
  const [period, setPeriod] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      api.cashFlow.settlements.create({
        marketplaceName: marketplace,
        grossSales: Number(gross),
        marketplaceFees: Number(fees),
        deductions: Number(deductions),
        refundsReturns: Number(refunds),
        expectedSettlementDate: date,
        settlementPeriod: period || undefined,
      }),
    onSuccess: () => {
      toast.success("Marketplace settlement created");
      onSuccess();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const net = Math.max(0, Number(gross || 0) - Number(fees || 0) - Number(deductions || 0) - Number(refunds || 0));

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Marketplace Settlement</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Marketplace</Label>
            <Input value={marketplace} onChange={(e) => setMarketplace(e.target.value)} className="mt-1" placeholder="e.g. Amazon, Flipkart" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Gross Sales</Label>
              <Input type="number" value={gross} onChange={(e) => setGross(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Marketplace Fees</Label>
              <Input type="number" value={fees} onChange={(e) => setFees(e.target.value)} className="mt-1" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Deductions</Label>
              <Input type="number" value={deductions} onChange={(e) => setDeductions(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Refunds / Returns</Label>
              <Input type="number" value={refunds} onChange={(e) => setRefunds(e.target.value)} className="mt-1" />
            </div>
          </div>
          <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Net Expected: </span>
            <span className="font-bold text-emerald-600">{fmtFull(net)}</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Settlement Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Period</Label>
              <Input value={period} onChange={(e) => setPeriod(e.target.value)} className="mt-1" placeholder="e.g. Aug 1-15" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!marketplace || !gross || !date || mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Loading skeleton ───────────────────────────────────────────────────────

function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-[300px] rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}
