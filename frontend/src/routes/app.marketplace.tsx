import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import {
  Store,
  RotateCcw,
  Play,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Package,
  Truck,
  FileText,
  ShieldCheck,
  RefreshCw,
  ExternalLink,
  Layers,
  Search,
  Check,
  XCircle,
  HelpCircle,
  Clock,
  DollarSign,
  Boxes,
  UserCheck,
  Eye,
  FileCheck2,
  BarChart3,
  ShoppingBag,
  Warehouse,
  Settings,
} from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api-client";
import {
  loadDemoState,
  saveDemoState,
  resetDemoState,
  getLedgerCheckpoints,
  BASELINE_MAPPINGS,
  WORKFLOW_STEPS,
  DemoWorkflowState,
  SkuMapping,
} from "@/lib/marketplace-demo-store";

export const Route = createFileRoute("/app/marketplace")({
  component: MarketplaceHubPage,
});

const ROLE_CONFIG: Record<
  string,
  {
    title: string;
    subtitle: string;
    tab: "workflow" | "inventory" | "mappings" | "exceptions" | "finance" | "architecture";
    highlight: string;
    icon: any;
  }
> = {
  all: {
    title: "All Roles (Full Access View)",
    subtitle: "Complete operational visibility: orders, stock ledger, mappings, fulfillment, finance, and system settings.",
    tab: "workflow",
    highlight: "All operational modules and technical queues are currently visible.",
    icon: UserCheck,
  },
  management: {
    title: "Management View",
    subtitle: "Combined sales performance, channel GMV distribution, return rate & settlement pipeline across all 5 channels.",
    tab: "workflow",
    highlight: "Executive overview: channel revenue split, return rate analytics, and combined portfolio health.",
    icon: BarChart3,
  },
  sales: {
    title: "Sales & Operations View",
    subtitle: "Customer order ingestion, promised delivery dates, cancellations, and real-time fulfillment status.",
    tab: "workflow",
    highlight: "Central order processing: orders, customer addresses, and dispatch pipeline without logging into Amazon/Flipkart.",
    icon: ShoppingBag,
  },
  warehouse: {
    title: "Warehouse Fulfillment View",
    subtitle: "Single unified pick/pack queue, dispatch confirmation with carrier tracking, and return receipt into QC hold.",
    tab: "inventory",
    highlight: "Warehouse operations: pick & pack tasks, dispatch confirmation, and return receipt into QC buffer.",
    icon: Warehouse,
  },
  finance: {
    title: "Finance & Accounts View",
    subtitle: "Customer invoices (DEMO watermark), marketplace referral commissions, TCS (1%), logistics fees, and net settlement receivables.",
    tab: "finance",
    highlight: "Finance ledger: verifies invoices, tracks deductions (commission, shipping, TCS), and reconciles net receivables.",
    icon: DollarSign,
  },
  checker: {
    title: "Checker & Approvals View",
    subtitle: "Exception review queue: verify unmapped SKU bindings, QC restock approvals, and settlement reconciliation mismatches.",
    tab: "exceptions",
    highlight: "Exception gatekeeper: review unmapped SKU mappings, approval of return restocks, and sync retry authorization.",
    icon: ShieldCheck,
  },
  admin: {
    title: "System Administrator View",
    subtitle: "Marketplace credentials, listing mappings, sync frequencies, connector framework, and baseline fixtures reset.",
    tab: "mappings",
    highlight: "Admin control: multi-channel SKU mappings, API connectors, and integration framework settings.",
    icon: Settings,
  },
};

export default function MarketplaceHubPage() {
  const [state, setState] = useState<DemoWorkflowState>(loadDemoState);
  const [activeTab, setActiveTab] = useState<
    "workflow" | "inventory" | "mappings" | "exceptions" | "finance" | "architecture"
  >("workflow");
  const [mappings, setMappings] = useState<SkuMapping[]>(BASELINE_MAPPINGS);
  const [selectedMappingFilter, setSelectedMappingFilter] = useState("all");
  const [mappingSearch, setMappingSearch] = useState("");
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [showMapModal, setShowMapModal] = useState(false);
  const [mapTargetSku, setMapTargetSku] = useState("AD-TS-WHT-M");

  const handleSelectRole = (roleId: string) => {
    setState((prev) => ({ ...prev, selectedRole: roleId as any }));
    const conf = ROLE_CONFIG[roleId];
    if (conf && roleId !== "all") {
      setActiveTab(conf.tab);
      toast.info(`Switched to ${conf.title}`, {
        description: conf.highlight,
      });
    } else {
      toast.info("Showing Full Access View (All Roles)");
    }
  };

  // Sync state changes to storage
  useEffect(() => {
    saveDemoState(state);
  }, [state]);

  // Derived current metrics based on state step
  const hasScriptedOrder = state.currentStep >= 1;
  const hasScriptedReturn = state.currentStep >= 7;

  // Filtered channels
  const activeChannelData = state.channels.map((ch) => {
    if (ch.id === "amazon") {
      return {
        ...ch,
        orders: 12 + (hasScriptedOrder ? 1 : 0),
        grossValue: 24000 + (hasScriptedOrder ? 2000 : 0),
        returns: 1 + (hasScriptedReturn ? 1 : 0),
      };
    }
    return ch;
  });

  const totalOrders = activeChannelData.reduce((acc, c) => acc + c.orders, 0);
  const totalGmv = activeChannelData.reduce((acc, c) => acc + c.grossValue, 0);
  const totalReturns = activeChannelData.reduce((acc, c) => acc + c.returns, 0);

  // Filtered for current selected channel
  const currentChannelView =
    state.selectedChannel === "all"
      ? null
      : activeChannelData.find((c) => c.id === state.selectedChannel);

  const displayOrders = currentChannelView ? currentChannelView.orders : totalOrders;
  const displayGmv = currentChannelView ? currentChannelView.grossValue : totalGmv;
  const displayReturns = currentChannelView ? currentChannelView.returns : totalReturns;

  // Real-time checkpoints for Main SKU (AD-TS-BLK-M)
  const ledgerCheckpoints = getLedgerCheckpoints(state.currentStep);

  // Workflow Handlers
  const handleReset = () => {
    const fresh = resetDemoState();
    setState(fresh);
    setMappings(BASELINE_MAPPINGS);
    toast.success("Demo state successfully reset to Baseline fixtures!");
  };

  const handleNextStep = async () => {
    if (state.currentStep >= 8) {
      toast.info("Demonstration journey complete! Use 'Reset Baseline' to restart.");
      return;
    }
    const next = state.currentStep + 1;

    // Step 3: e-commerce order -> creates demo sales order (idempotent).
    if (next === 3 && !state.demoSoId) {
      try {
        const res = await api.cashFlow.marketplaceDemo.createOrder({
          marketplace: "amazon",
          externalOrderId: state.externalOrderId,
          eventId: state.eventId,
          channelSku: "AMZ-TS-BLK-M",
          whizunikSku: "AD-TS-BLK-M",
          quantity: 2,
          unitPrice: 1000,
        });
        const order = (res as any)?.order ?? res;
        setState((prev) => ({
          ...prev,
          currentStep: next,
          demoSoId: order?.id ?? prev.demoSoId,
          demoSoNumber: order?.soNumber ?? prev.demoSoNumber,
        }));
        toast.success(
          (res as any)?.duplicate
            ? `Step 3: Reused demo sales order ${order?.soNumber} (duplicate blocked)`
            : `Step 3: Created demo sales order ${order?.soNumber ?? state.soId}`
        );
        return;
      } catch (err: any) {
        // Backend unreachable or mapping error — fall back to mock IDs so the
        // visual 8-step demo still runs.
        toast.warning(
          `Demo SO API unavailable, using mock ${state.soId}: ${err?.message ?? err}`
        );
      }
    }

    // Step 5: payment collected -> creates demo invoice (one SO -> one invoice).
    if (next === 5 && state.demoSoId && !state.demoInvoiceId) {
      try {
        const res = await api.cashFlow.marketplaceDemo.recordPayment(state.demoSoId);
        const invoice = (res as any)?.invoice ?? res;
        const order = (res as any)?.order;
        setState((prev) => ({
          ...prev,
          currentStep: next,
          outboundSyncStatus: "Queued",
          demoInvoiceId: invoice?.id ?? prev.demoInvoiceId,
          demoInvoiceNumber: invoice?.invoiceNumber ?? prev.demoInvoiceNumber,
          paymentStatus: "collected_by_marketplace",
          demoSoNumber: order?.soNumber ?? prev.demoSoNumber,
        }));
        toast.success(
          (res as any)?.duplicate
            ? `Step 5: Reused demo invoice ${invoice?.invoiceNumber} (one SO -> one invoice)`
            : `Step 5: Payment collected -> invoice ${invoice?.invoiceNumber ?? state.invoiceId}`
        );
        return;
      } catch (err: any) {
        toast.warning(
          `Demo invoice API unavailable, using mock ${state.invoiceId}: ${err?.message ?? err}`
        );
      }
    }

    setState((prev) => ({
      ...prev,
      currentStep: next,
      outboundSyncStatus:
        next === 5 ? "Queued" : next === 6 ? "Simulated Acknowledged" : prev.outboundSyncStatus,
    }));
    toast.success(`Executed Step ${next}: ${WORKFLOW_STEPS[next - 1]?.title}`);
  };

  const handleJumpToStep = (stepNumber: number) => {
    setState((prev) => ({
      ...prev,
      currentStep: stepNumber,
      outboundSyncStatus:
        stepNumber >= 6
          ? "Simulated Acknowledged"
          : stepNumber === 5
          ? "Queued"
          : "Idle",
    }));
    toast.info(`Jumped to Step ${stepNumber}`);
  };

  const handleAutoPlay = () => {
    toast.promise(
      new Promise<void>((resolve) => {
        let cur = 0;
        const interval = setInterval(() => {
          cur += 1;
          setState((prev) => ({
            ...prev,
            currentStep: cur,
            outboundSyncStatus: cur >= 6 ? "Simulated Acknowledged" : cur === 5 ? "Queued" : "Idle",
          }));
          if (cur >= 8) {
            clearInterval(interval);
            resolve();
          }
        }, 1200);
      }),
      {
        loading: "Running Path Demonstration...",
        success: "Path Demonstration completed (All 8 steps verified)!",
        error: "Simulation interrupted",
      }
    );
  };

  // Exception Handlers
  const handleResolveUnmappedSku = () => {
    setMappings((prev) =>
      prev.map((m) =>
        m.channelSku === "AMZ-UNKNOWN"
          ? {
              ...m,
              whizunikSku: mapTargetSku,
              status: "Mapped",
              productName: "Adventra Classic Tee",
              variant: "White / M",
            }
          : m
      )
    );
    setState((prev) => ({
      ...prev,
      unmappedErrorStatus: "resolved",
      unmappedSkuAssigned: mapTargetSku,
    }));
    setShowMapModal(false);
    toast.success(
      `Resolved AMZ-UNKNOWN -> mapped to ${mapTargetSku}. Re-processed event created SO-ERR-01 cleanly!`
    );
  };

  const handleForceSyncFailure = () => {
    setState((prev) => ({
      ...prev,
      outboundSyncStatus: "Failed (504 Timeout)",
    }));
    toast.error("Simulated outbound failure: HTTP 504 Gateway Timeout from channel endpoint.");
  };

  const handleRetryOutboundSync = () => {
    setState((prev) => ({
      ...prev,
      outboundSyncStatus: "Simulated Acknowledged",
      outboundRetryCount: prev.outboundRetryCount + 1,
    }));
    toast.success(
      "Outbound sync retry succeeded! Acknowledgement updated without re-dispatching or duplicating stock."
    );
  };

  const handleTestIdempotency = () => {
    toast.info(
      "Replayed Event EVT-1001: Idempotency Key Matched. System recognized duplicate and returned existing sales order. Zero extra reservations created!"
    );
    setState((prev) => ({
      ...prev,
      idempotencyReplayMessage:
        "EVT-1001 previously processed. No duplicate sales order or inventory deduction permitted.",
    }));
  };

  return (
    <div className="min-h-screen bg-slate-50/60 dark:bg-slate-950/60 p-4 sm:p-6 lg:p-8 space-y-6">
      {/* ─── MANDATORY SIMULATION BANNER (PDF 3 §4) ────────────────────── */}
      <div className="relative overflow-hidden rounded-xl border border-amber-300 dark:border-amber-700/60 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent p-4 shadow-sm backdrop-blur">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold tracking-wider uppercase bg-amber-500 text-white shadow-sm animate-pulse">
              <AlertTriangle className="w-3.5 h-3.5" />
              DEMO • SIMULATED DATA • NO LIVE CONNECTIONS
            </span>
            <span className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 font-medium">
              WhizUnik Marketplace Integration Flow Demonstration for <strong>Adventra</strong>
            </span>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <button
              onClick={handleReset}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition shadow-sm"
              title="Restore Baseline Fixtures"
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              Reset Demo Baseline
            </button>
            <button
              onClick={handleAutoPlay}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition shadow-sm"
              title="Run 8-Step Path Demonstration Automatically"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              Auto-Play Journey
            </button>
          </div>
        </div>
      </div>

      {/* ─── PAGE HEADER & ROLE SELECTOR ────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
              <Store className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                Marketplace Integration Hub
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                Centralized channel synchronization, stock reservation ledger, fulfillment & exception queues
              </p>
            </div>
          </div>
        </div>

        {/* Role View Filter (PDF 3 §4 & §9) */}
        <div className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-1.5 shadow-sm text-xs">
          <span className="text-slate-400 font-medium px-2 flex items-center gap-1">
            <UserCheck className="w-3.5 h-3.5" />
            Role View:
          </span>
          {(
            [
              { id: "all", label: "All Roles" },
              { id: "management", label: "Management" },
              { id: "sales", label: "Sales" },
              { id: "warehouse", label: "Warehouse" },
              { id: "finance", label: "Finance" },
              { id: "checker", label: "Checker" },
              { id: "admin", label: "Admin" },
            ] as const
          ).map((r) => (
            <button
              key={r.id}
              onClick={() => handleSelectRole(r.id)}
              className={`px-2.5 py-1 rounded-md font-medium transition cursor-pointer ${
                state.selectedRole === r.id
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* ─── ROLE PERSONA SPOTLIGHT BANNER (PDF 3 §4 & §9) ───────────────── */}
      {state.selectedRole !== "all" && ROLE_CONFIG[state.selectedRole] && (
        <div className="p-4 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-950/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-xs transition-all animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-indigo-600 text-white shadow-xs">
              {(() => {
                const IconComponent = ROLE_CONFIG[state.selectedRole].icon;
                return <IconComponent className="w-5 h-5" />;
              })()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                  {ROLE_CONFIG[state.selectedRole].title}
                </h4>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/80 text-indigo-700 dark:text-indigo-300 font-bold uppercase tracking-wider">
                  Active Department Filter
                </span>
              </div>
              <p className="text-slate-600 dark:text-slate-300 mt-0.5">
                {ROLE_CONFIG[state.selectedRole].highlight}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <span className="text-[11px] text-slate-500 hidden md:inline">
              Focused Tab: <strong className="text-indigo-600 dark:text-indigo-400 capitalize">{ROLE_CONFIG[state.selectedRole].tab}</strong>
            </span>
            <button
              onClick={() => handleSelectRole("all")}
              className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold transition whitespace-nowrap shadow-xs text-xs cursor-pointer"
            >
              Reset to All Roles
            </button>
          </div>
        </div>
      )}

      {/* ─── CHANNEL SELECTOR TABS & SUMMARY ROW (PDF 3 §5) ────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => setState((prev) => ({ ...prev, selectedChannel: "all" }))}
            className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition border ${
              state.selectedChannel === "all"
                ? "bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-950 dark:border-white shadow-sm"
                : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850"
            }`}
          >
            All Channels ({totalOrders} orders • ₹{totalGmv.toLocaleString("en-IN")})
          </button>

          {activeChannelData.map((ch) => (
            <button
              key={ch.id}
              onClick={() => setState((prev) => ({ ...prev, selectedChannel: ch.id as any }))}
              className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition border flex items-center gap-2 ${
                state.selectedChannel === ch.id
                  ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                  : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850"
              }`}
            >
              <span>{ch.name}</span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                  state.selectedChannel === ch.id
                    ? "bg-white/20 text-white"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                }`}
              >
                {ch.orders}
              </span>
            </button>
          ))}
        </div>

        {/* 4 Metric Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center justify-between">
              Total Orders
              <Package className="w-4 h-4 text-slate-400" />
            </p>
            <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">
              {displayOrders}
            </p>
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 font-medium flex items-center gap-1">
              <Check className="w-3 h-3" />
              {hasScriptedOrder ? "+1 Scripted DEMO-AMZ-1001" : "Baseline day count"}
            </p>
          </div>

          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center justify-between">
              Gross Order Value
              <DollarSign className="w-4 h-4 text-slate-400" />
            </p>
            <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">
              ₹{displayGmv.toLocaleString("en-IN")}
            </p>
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 font-medium">
              {hasScriptedOrder ? "+₹2,000 scripted order" : "Before tax and fees"}
            </p>
          </div>

          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center justify-between">
              Return Cases
              <RotateCcw className="w-4 h-4 text-slate-400" />
            </p>
            <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">
              {displayReturns}
            </p>
            <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 font-medium">
              {hasScriptedReturn ? "+1 Return (RET-DEMO-1001)" : "Cases, not units"}
            </p>
          </div>

          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center justify-between">
              Stock Sync State
              <RefreshCw className="w-4 h-4 text-emerald-500 animate-spin-slow" />
            </p>
            <div className="flex items-center gap-2 mt-1">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              <p className="text-lg font-bold text-slate-900 dark:text-slate-100">Simulated OK</p>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              All 5 channels in demo mode
            </p>
          </div>
        </div>
      </div>

      {/* ─── IN-PAGE TAB BAR ─────────────────────────────────────────────── */}
      <div className="border-b border-slate-200 dark:border-slate-800 flex items-center gap-1 overflow-x-auto">
        {[
          { id: "workflow", label: "Interactive Workflow (8 Steps)", icon: Play },
          { id: "inventory", label: "Inventory Ledger (6 Checkpoints)", icon: Boxes },
          { id: "mappings", label: "SKU Mappings & Listings", icon: Layers },
          { id: "exceptions", label: "Exception & Error Queues", icon: AlertTriangle },
          { id: "finance", label: "Settlement & Finance", icon: DollarSign },
          { id: "architecture", label: "Connector Architecture", icon: ExternalLink },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2.5 text-xs sm:text-sm font-medium border-b-2 whitespace-nowrap transition flex items-center gap-2 ${
                isActive
                  ? "border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400 font-semibold"
                  : "border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:border-slate-300"
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB 1: INTERACTIVE WORKFLOW (HAPPY PATH DEMO - PDF 3 §7 & §11)       */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === "workflow" && (
        <div className="space-y-6">
          {/* Workflow Header & Target Information */}
          <div className="rounded-xl p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                Scripted Demonstration Order
              </span>
              <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                Order: <span className="font-mono text-indigo-600 dark:text-indigo-400">{state.orderId}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-normal">
                  Amazon Channel (AMZ-IN)
                </span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Target SKU: <strong className="font-mono text-slate-700 dark:text-slate-200">AD-TS-BLK-M</strong> (Black Tee M) • Quantity: <strong>2 Units</strong> @ ₹1,000 = ₹2,000
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleJumpToStep(0)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
              >
                Reset to Step 0
              </button>
              <button
                onClick={handleNextStep}
                disabled={state.currentStep >= 8}
                className={`px-4 py-1.5 text-xs font-semibold rounded-lg text-white shadow-xs flex items-center gap-1.5 transition ${
                  state.currentStep >= 8
                    ? "bg-slate-400 cursor-not-allowed"
                    : "bg-indigo-600 hover:bg-indigo-700"
                }`}
              >
                Advance to Next Step
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 8-Step Progress Stepper */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            {WORKFLOW_STEPS.map((ws) => {
              const isPassed = state.currentStep >= ws.step;
              const isCurrent = state.currentStep === ws.step;
              return (
                <button
                  key={ws.step}
                  onClick={() => handleJumpToStep(ws.step)}
                  className={`p-3 rounded-xl border text-left transition relative flex flex-col justify-between ${
                    isCurrent
                      ? "border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/40 dark:border-indigo-500 shadow-xs ring-1 ring-indigo-500"
                      : isPassed
                      ? "border-emerald-300 dark:border-emerald-800/60 bg-emerald-50/30 dark:bg-emerald-950/20"
                      : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 opacity-70"
                  }`}
                >
                  <div className="flex items-center justify-between w-full mb-1">
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                        isCurrent
                          ? "bg-indigo-600 text-white"
                          : isPassed
                          ? "bg-emerald-600 text-white"
                          : "bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                      }`}
                    >
                      Step {ws.step}
                    </span>
                    {isPassed && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />}
                  </div>
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-200 line-clamp-2">
                    {ws.title}
                  </p>
                  <span className="text-[10px] text-slate-400 mt-2 block">
                    {ws.role.split("&")[0]}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Current Step Active Card Spotlight */}
          <div className="rounded-xl border border-indigo-200 dark:border-indigo-800/80 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold text-base shadow-sm">
                  {state.currentStep === 0 ? "0" : state.currentStep}
                </div>
                <div>
                  <h4 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    {state.currentStep === 0
                      ? "Step 0: Baseline Initialized (Opening Stock = 20)"
                      : WORKFLOW_STEPS[state.currentStep - 1]?.title}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {state.currentStep === 0
                      ? "Click 'Advance to Next Step' to simulate order import event from Amazon."
                      : WORKFLOW_STEPS[state.currentStep - 1]?.subtitle}
                  </p>
                </div>
              </div>

              {/* Action buttons inside spotlight */}
              <div className="flex items-center gap-2">
                {state.currentStep >= 5 && (
                  <button
                    onClick={() => setShowInvoiceModal(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Preview Demo Invoice ({state.demoInvoiceNumber ?? state.invoiceId})
                  </button>
                )}
                {state.currentStep < 8 ? (
                  <button
                    onClick={handleNextStep}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition shadow-xs"
                  >
                    Run Step {state.currentStep + 1}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    Workflow Complete
                  </span>
                )}
              </div>
            </div>

            {/* Step Specific Details Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-850/60 border border-slate-200/80 dark:border-slate-800">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  Order & Identifiers
                </span>
                <div className="mt-2 space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Marketplace:</span>
                    <strong className="text-slate-800 dark:text-slate-200">Amazon India</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Internal Order:</span>
                    <span className="font-mono text-indigo-600 dark:text-indigo-400 font-semibold">{state.orderId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">External ID:</span>
                    <span className="font-mono text-slate-700 dark:text-slate-300">{state.externalOrderId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Event Ingestion:</span>
                    <span className="font-mono text-slate-700 dark:text-slate-300">{state.eventId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Sales Order:</span>
                    <span className="font-mono text-slate-700 dark:text-slate-300">
                      {state.currentStep >= 3
                        ? state.demoSoNumber ?? state.soId
                        : "Pending Step 3"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Payment:</span>
                    <span className="font-mono text-slate-700 dark:text-slate-300">
                      {state.paymentStatus === "collected_by_marketplace"
                        ? "Collected by Amazon"
                        : "Pending"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Invoice:</span>
                    <span className="font-mono text-slate-700 dark:text-slate-300">
                      {state.currentStep >= 5
                        ? state.demoInvoiceNumber ?? state.invoiceId
                        : "Pending Step 5"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-850/60 border border-slate-200/80 dark:border-slate-800">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  Fulfillment & Dispatch
                </span>
                <div className="mt-2 space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Warehouse:</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">WH-DEMO</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Pick / Pack Task:</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {state.currentStep >= 4 ? "2 Picked • 2 Packed" : "Not started"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Carrier:</span>
                    <span className="text-slate-800 dark:text-slate-200">
                      {state.currentStep >= 5 ? state.carrier : "Awaiting dispatch"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Tracking No:</span>
                    <span className="font-mono text-slate-700 dark:text-slate-300">
                      {state.currentStep >= 5 ? state.trackingNumber : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Channel Sync Ack:</span>
                    <span
                      className={`font-semibold ${
                        state.currentStep >= 6
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-slate-400"
                      }`}
                    >
                      {state.currentStep >= 6 ? "Simulated Acknowledged" : "Pending"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-850/60 border border-slate-200/80 dark:border-slate-800">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  Return & QC Buffer
                </span>
                <div className="mt-2 space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Return Docket:</span>
                    <span className="font-mono text-slate-700 dark:text-slate-300">
                      {state.currentStep >= 7 ? state.returnId : "None"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Return Quantity:</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {state.currentStep >= 7 ? "1 Unit (Reason: Size issue)" : "0"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">QC Status:</span>
                    <span
                      className={`font-semibold ${
                        state.currentStep >= 8
                          ? "text-emerald-600 dark:text-emerald-400"
                          : state.currentStep === 7
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-slate-400"
                      }`}
                    >
                      {state.currentStep >= 8
                        ? "Pass / Resalable"
                        : state.currentStep === 7
                        ? "QC Hold (1 unit held)"
                        : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Restock Disposition:</span>
                    <span className="text-slate-800 dark:text-slate-200">
                      {state.currentStep >= 8 ? "Released to Available (Stock = 19)" : "—"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB 2: INVENTORY & 6-CHECKPOINT LEDGER (PDF 3 §4, §6, §7)            */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === "inventory" && (
        <div className="space-y-6">
          {/* Section 1: Target SKU Checkpoint Ledger Table */}
          <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                  Verification Table (Section 7 in Guide)
                </span>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Target SKU Stock Ledger Checkpoints:{" "}
                  <span className="font-mono text-indigo-600 dark:text-indigo-400">AD-TS-BLK-M</span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Available = On-hand − Reserved − QC hold. Evaluated in real time from workflow actions.
                </p>
              </div>
              <div className="text-xs text-right text-slate-500">
                Current Workflow Step: <strong>Step {state.currentStep}</strong>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/50 text-slate-600 dark:text-slate-300 font-semibold">
                    <th className="py-2.5 px-3">Checkpoint</th>
                    <th className="py-2.5 px-3 text-right">On-Hand</th>
                    <th className="py-2.5 px-3 text-right">Reserved</th>
                    <th className="py-2.5 px-3 text-right">QC Hold</th>
                    <th className="py-2.5 px-3 text-right font-bold text-indigo-600 dark:text-indigo-400">
                      Available
                    </th>
                    <th className="py-2.5 px-4">Audit Note & State</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {ledgerCheckpoints.map((row, idx) => (
                    <tr
                      key={idx}
                      className={`transition ${
                        row.isCurrent
                          ? "bg-indigo-50/70 dark:bg-indigo-950/40 font-semibold"
                          : row.isPassed
                          ? "hover:bg-slate-50/50 dark:hover:bg-slate-850/40"
                          : "opacity-40"
                      }`}
                    >
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2">
                          {row.isCurrent ? (
                            <span className="w-2 h-2 rounded-full bg-indigo-600 animate-ping"></span>
                          ) : row.isPassed ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                          ) : (
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                          )}
                          <span className={row.isCurrent ? "text-indigo-600 dark:text-indigo-400 font-bold" : ""}>
                            {row.checkpoint}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono">{row.onHand}</td>
                      <td className="py-3 px-3 text-right font-mono text-amber-600 dark:text-amber-400">
                        {row.reserved}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-rose-600 dark:text-rose-400">
                        {row.qcHold}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-sm font-bold text-indigo-600 dark:text-indigo-400">
                        {row.available}
                      </td>
                      <td className="py-3 px-4 text-slate-500 dark:text-slate-400">
                        {row.actionNote}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 2: All 6 Seeded Adventra SKUs Inventory Table */}
          <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-4">
            <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Seeded Adventra Catalogue & Stock (Warehouse: WH-DEMO)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                All channel SKUs point to one central WhizUnik inventory record. No duplicates created.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/50 text-slate-600 dark:text-slate-300 font-semibold">
                    <th className="py-2.5 px-3">WhizUnik SKU</th>
                    <th className="py-2.5 px-3">Variant Description</th>
                    <th className="py-2.5 px-3">Amazon SKU</th>
                    <th className="py-2.5 px-3">Shopify Variant</th>
                    <th className="py-2.5 px-3 text-right">On-Hand</th>
                    <th className="py-2.5 px-3 text-right">Reserved</th>
                    <th className="py-2.5 px-3 text-right">QC Hold</th>
                    <th className="py-2.5 px-3 text-right font-bold text-indigo-600 dark:text-indigo-400">
                      Available Stock
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {state.inventory.map((inv) => {
                    const isMainSku = inv.whizunikSku === "AD-TS-BLK-M";
                    // compute active stock based on workflow step
                    const onHand = isMainSku
                      ? state.currentStep >= 7
                        ? 19
                        : state.currentStep >= 5
                        ? 18
                        : 20
                      : inv.onHand;
                    const reserved = isMainSku && state.currentStep >= 3 && state.currentStep < 5 ? 2 : 0;
                    const qcHold = isMainSku && state.currentStep === 7 ? 1 : 0;
                    const available = onHand - reserved - qcHold;

                    return (
                      <tr
                        key={inv.whizunikSku}
                        className={`hover:bg-slate-50/50 dark:hover:bg-slate-850/40 transition ${
                          isMainSku ? "bg-indigo-50/30 dark:bg-indigo-950/20" : ""
                        }`}
                      >
                        <td className="py-3 px-3 font-mono font-semibold text-slate-900 dark:text-slate-100">
                          {inv.whizunikSku}
                          {isMainSku && (
                            <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-sans">
                              Active Demo SKU
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-slate-700 dark:text-slate-300">{inv.variant}</td>
                        <td className="py-3 px-3 font-mono text-slate-500">{inv.amazonSku}</td>
                        <td className="py-3 px-3 font-mono text-slate-500">{inv.shopifyVariant}</td>
                        <td className="py-3 px-3 text-right font-mono font-medium">{onHand}</td>
                        <td className="py-3 px-3 text-right font-mono text-amber-600 dark:text-amber-400">
                          {reserved}
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-rose-600 dark:text-rose-400">
                          {qcHold}
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-bold text-sm text-indigo-600 dark:text-indigo-400">
                          {available}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB 3: SKU MAPPING & CHANNEL LINKS (PDF 1 §1, PDF 3 §6)              */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === "mappings" && (
        <div className="space-y-6">
          <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Cross-Channel SKU Mapping Table
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Multiple channel listings map to single WhizUnik child SKUs. Prevents inventory fragmentation.
                </p>
              </div>

              {/* Filters */}
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search SKU or Title..."
                    value={mappingSearch}
                    onChange={(e) => setMappingSearch(e.target.value)}
                    className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 text-xs w-48 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <select
                  value={selectedMappingFilter}
                  onChange={(e) => setSelectedMappingFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 text-xs font-medium focus:outline-hidden"
                >
                  <option value="all">All Channels</option>
                  <option value="Amazon">Amazon</option>
                  <option value="Shopify">Shopify</option>
                  <option value="Flipkart">Flipkart</option>
                </select>
              </div>
            </div>

            {/* Unmapped Exception Callout if unresolved */}
            {state.unmappedErrorStatus === "unresolved" && (
              <div className="p-3.5 rounded-xl border border-rose-300 dark:border-rose-800/60 bg-rose-50/50 dark:bg-rose-950/30 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-rose-600 text-white">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <div>
                    <h5 className="text-xs font-bold text-rose-900 dark:text-rose-200">
                      Unmapped Listing Exception: AMZ-UNKNOWN (Amazon India)
                    </h5>
                    <p className="text-[11px] text-rose-700 dark:text-rose-300">
                      Order DEMO-AMZ-ERR-01 is paused. Auto-creation of inventory is blocked per Section 6 policy.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowMapModal(true)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition shadow-xs whitespace-nowrap"
                >
                  Map to WhizUnik SKU
                </button>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/50 text-slate-600 dark:text-slate-300 font-semibold">
                    <th className="py-2.5 px-3">Channel</th>
                    <th className="py-2.5 px-3">Channel SKU / Listing ID</th>
                    <th className="py-2.5 px-3">WhizUnik Child SKU</th>
                    <th className="py-2.5 px-3">Product Title & Variant</th>
                    <th className="py-2.5 px-3">Warehouse</th>
                    <th className="py-2.5 px-3 text-right">MRP / Selling</th>
                    <th className="py-2.5 px-3">HSN / GST</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {mappings
                    .filter((m) =>
                      selectedMappingFilter === "all" ? true : m.channel === selectedMappingFilter
                    )
                    .filter((m) =>
                      mappingSearch
                        ? m.channelSku.toLowerCase().includes(mappingSearch.toLowerCase()) ||
                          m.whizunikSku.toLowerCase().includes(mappingSearch.toLowerCase()) ||
                          m.productName.toLowerCase().includes(mappingSearch.toLowerCase())
                        : true
                    )
                    .map((mapItem) => (
                      <tr
                        key={mapItem.id}
                        className={`hover:bg-slate-50/50 dark:hover:bg-slate-850/40 transition ${
                          mapItem.status === "Error"
                            ? "bg-rose-50/30 dark:bg-rose-950/20"
                            : ""
                        }`}
                      >
                        <td className="py-3 px-3 font-semibold text-slate-800 dark:text-slate-200">
                          {mapItem.channel}
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                            {mapItem.channelSku}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            {mapItem.listingId}
                          </div>
                        </td>
                        <td className="py-3 px-3 font-mono font-bold text-indigo-600 dark:text-indigo-400">
                          {mapItem.whizunikSku}
                        </td>
                        <td className="py-3 px-3">
                          <div className="text-slate-800 dark:text-slate-200 font-medium">
                            {mapItem.productName}
                          </div>
                          <div className="text-[10px] text-slate-400">{mapItem.variant}</div>
                        </td>
                        <td className="py-3 px-3 text-slate-600 dark:text-slate-400">
                          {mapItem.warehouse}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <span className="text-slate-400 line-through mr-1">₹{mapItem.mrp}</span>
                          <strong className="text-slate-900 dark:text-slate-100">
                            ₹{mapItem.sellingPrice}
                          </strong>
                        </td>
                        <td className="py-3 px-3 text-slate-600 dark:text-slate-400">
                          {mapItem.hsn} ({mapItem.gstRate}%)
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              mapItem.status === "Active" || mapItem.status === "Mapped"
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                                : "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 animate-pulse"
                            }`}
                          >
                            {mapItem.status}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-center">
                          {mapItem.status === "Error" ? (
                            <button
                              onClick={() => setShowMapModal(true)}
                              className="px-2.5 py-1 text-[11px] font-semibold rounded bg-rose-600 text-white hover:bg-rose-700 transition"
                            >
                              Resolve
                            </button>
                          ) : (
                            <span className="text-[11px] text-slate-400">Synced</span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB 4: EXCEPTIONS & RECOVERY QUEUES (PDF 1 §9, PDF 3 §8)            */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === "exceptions" && (
        <div className="space-y-6">
          <div className="border-b border-slate-200 dark:border-slate-800 pb-3">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Exception & Sync Recovery Center
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Simulate and verify the 3 required exception patterns from PDF 3 §8 (Unmapped SKU, Outbound Retry, Idempotency).
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Exception 1: Unmapped SKU */}
            <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 uppercase">
                    Exception Scenario 1
                  </span>
                  <span
                    className={`text-xs font-semibold ${
                      state.unmappedErrorStatus === "resolved" ? "text-emerald-600" : "text-rose-600"
                    }`}
                  >
                    {state.unmappedErrorStatus === "resolved" ? "Resolved" : "Active Error"}
                  </span>
                </div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-2">
                  Unmapped SKU Recovery
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Incoming order with fixture <code>AMZ-UNKNOWN</code> is paused. No sales order or reservation is created until mapped.
                </p>
                <div className="mt-3 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-850 text-xs font-mono text-slate-700 dark:text-slate-300">
                  <div>Event: DEMO-AMZ-ERR-01</div>
                  <div>Channel SKU: AMZ-UNKNOWN</div>
                  <div>
                    Status:{" "}
                    {state.unmappedErrorStatus === "resolved"
                      ? `Mapped -> ${state.unmappedSkuAssigned}`
                      : "Mapping Required"}
                  </div>
                </div>
              </div>

              <div className="pt-2">
                {state.unmappedErrorStatus === "resolved" ? (
                  <button
                    onClick={() => {
                      setState((prev) => ({ ...prev, unmappedErrorStatus: "unresolved" }));
                      setMappings(BASELINE_MAPPINGS);
                      toast.info("Reset unmapped SKU exception scenario.");
                    }}
                    className="w-full py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                  >
                    Reset to Unmapped State
                  </button>
                ) : (
                  <button
                    onClick={() => setShowMapModal(true)}
                    className="w-full py-2 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-700 text-white transition shadow-xs"
                  >
                    Resolve & Reprocess
                  </button>
                )}
              </div>
            </div>

            {/* Exception 2: Outbound Sync Fail & Retry */}
            <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 uppercase">
                    Exception Scenario 2
                  </span>
                  <span
                    className={`text-xs font-semibold ${
                      state.outboundSyncStatus.includes("Failed")
                        ? "text-rose-600"
                        : state.outboundSyncStatus.includes("Acknowledged")
                        ? "text-emerald-600"
                        : "text-slate-500"
                    }`}
                  >
                    {state.outboundSyncStatus}
                  </span>
                </div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-2">
                  Failed Outbound Sync & Safe Retry
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Dispatched order tracking push fails. WhizUnik order stays Dispatched. Retry must not duplicate invoice or alter stock.
                </p>
                <div className="mt-3 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-850 text-xs font-mono text-slate-700 dark:text-slate-300">
                  <div>Order: DEMO-AMZ-1001</div>
                  <div>Tracking: TRK-DEMO-1001</div>
                  <div>Retry Count: {state.outboundRetryCount}</div>
                </div>
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  onClick={handleForceSyncFailure}
                  className="flex-1 py-2 text-xs font-semibold rounded-lg border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition"
                >
                  Force 504 Timeout
                </button>
                <button
                  onClick={handleRetryOutboundSync}
                  className="flex-1 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition shadow-xs"
                >
                  Safe Retry
                </button>
              </div>
            </div>

            {/* Exception 3: Idempotency Protection */}
            <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 uppercase">
                    Exception Scenario 3
                  </span>
                  <span className="text-xs font-semibold text-emerald-600">Active Guard</span>
                </div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-2">
                  Duplicate Event & Stock Protection
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Replays <code>EVT-1001</code> to prove that duplicate webhook delivery is safely ignored without extra reservation.
                </p>
                <div className="mt-3 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-850 text-xs font-mono text-slate-700 dark:text-slate-300">
                  <div>Idempotency Key: EVT-1001:AMZ:L1</div>
                  <div>Duplicate Protection: ENABLED</div>
                  <div>Guard Result: ZERO duplicate stock debit</div>
                </div>
              </div>

              <div className="pt-2">
                <button
                  onClick={handleTestIdempotency}
                  className="w-full py-2 text-xs font-semibold rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-100 transition shadow-xs"
                >
                  Replay Event EVT-1001
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB 5: SETTLEMENT & FINANCE (PDF 1 §7, PDF 2 §6)                    */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === "finance" && (
        <div className="space-y-6">
          <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-4">
            <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
              <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                Finance & Accounting Rule (Section 7 in Developer Brief)
              </span>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Customer Payment vs Marketplace Settlement Ledger
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                A customer payment marked "Collected by Marketplace" is NOT automatically marked as money received in WhizUnik Treasury.
              </p>
            </div>

            {/* Reconciliation Card for DEMO-AMZ-1001 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850/50 space-y-3">
                <h4 className="text-xs font-bold uppercase text-slate-500 tracking-wider">
                  Order Invoicing & Collection Status
                </h4>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-slate-200/60 dark:border-slate-800">
                    <span className="text-slate-500">Order Reference:</span>
                    <span className="font-mono font-bold text-slate-800 dark:text-slate-200">DEMO-AMZ-1001</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-200/60 dark:border-slate-800">
                    <span className="text-slate-500">Invoice Issued:</span>
                    <span className="font-mono text-slate-800 dark:text-slate-200">
                      {state.currentStep >= 5 ? "INV-DEMO-1001" : "Pending Dispatch"}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-200/60 dark:border-slate-800">
                    <span className="text-slate-500">Gross Invoice Value:</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">₹2,000.00</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-200/60 dark:border-slate-800">
                    <span className="text-slate-500">Customer Payment State:</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                      Collected by Amazon India
                    </span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-500">WhizUnik Treasury Status:</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      Awaiting Marketplace Settlement
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-indigo-200 dark:border-indigo-800/80 bg-indigo-50/20 dark:bg-indigo-950/20 space-y-3">
                <h4 className="text-xs font-bold uppercase text-indigo-700 dark:text-indigo-400 tracking-wider">
                  Settlement Deductions Breakdown (Estimated)
                </h4>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-indigo-100 dark:border-indigo-900/50">
                    <span className="text-slate-600 dark:text-slate-400">Gross Sale Amount:</span>
                    <strong className="text-slate-900 dark:text-slate-100">₹2,000.00</strong>
                  </div>
                  <div className="flex justify-between py-1 border-b border-indigo-100 dark:border-indigo-900/50 text-rose-600 dark:text-rose-400">
                    <span>Marketplace Referral Commission (12%):</span>
                    <span>−₹240.00</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-indigo-100 dark:border-indigo-900/50 text-rose-600 dark:text-rose-400">
                    <span>Pick & Pack / EasyShip Fee:</span>
                    <span>−₹90.00</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-indigo-100 dark:border-indigo-900/50 text-rose-600 dark:text-rose-400">
                    <span>TCS (Tax Collected at Source - 1%):</span>
                    <span>−₹20.00</span>
                  </div>
                  <div className="flex justify-between py-1.5 pt-2 text-sm font-bold border-t-2 border-indigo-200 dark:border-indigo-800">
                    <span className="text-slate-900 dark:text-slate-100">Net Expected Receivable:</span>
                    <span className="text-emerald-600 dark:text-emerald-400">₹1,650.00</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB 6: CONNECTOR ARCHITECTURE (PDF 1 §8, PDF 3 §3)                  */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === "architecture" && (
        <div className="space-y-6">
          <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-4">
            <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
              <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                Enterprise Interface Architecture
              </span>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Common Marketplace Framework & Connector Abstraction
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Marketplace-specific APIs never communicate directly with internal inventory tables. All traffic flows through the normalized common contract.
              </p>
            </div>

            {/* Architecture Pipeline Visual */}
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-850/60 border border-slate-200 dark:border-slate-800">
              <div className="flex flex-col lg:flex-row items-center justify-between gap-3 text-center text-xs font-semibold">
                <div className="p-3 rounded-lg bg-amber-100 dark:bg-amber-950/80 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700 w-full lg:w-44">
                  <div className="text-[10px] text-amber-600 uppercase">Input Layer</div>
                  Mock Channel Event (Amazon / Shopify)
                </div>
                <ArrowRight className="w-4 h-4 text-slate-400 hidden lg:block" />
                <div className="p-3 rounded-lg bg-blue-100 dark:bg-blue-950/80 text-blue-900 dark:text-blue-200 border border-blue-300 dark:border-blue-700 w-full lg:w-44">
                  <div className="text-[10px] text-blue-600 uppercase">Adapter Layer</div>
                  Channel Adapter (Normalizer)
                </div>
                <ArrowRight className="w-4 h-4 text-slate-400 hidden lg:block" />
                <div className="p-3 rounded-lg bg-indigo-100 dark:bg-indigo-950/80 text-indigo-900 dark:text-indigo-200 border border-indigo-300 dark:border-indigo-700 w-full lg:w-48">
                  <div className="text-[10px] text-indigo-600 uppercase">Framework</div>
                  Common Integration Interface
                </div>
                <ArrowRight className="w-4 h-4 text-slate-400 hidden lg:block" />
                <div className="p-3 rounded-lg bg-emerald-100 dark:bg-emerald-950/80 text-emerald-900 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700 w-full lg:w-48">
                  <div className="text-[10px] text-emerald-600 uppercase">Core Master</div>
                  WhizUnik Sales & Inventory Ledger
                </div>
              </div>
            </div>

            {/* Interface Methods Breakdown */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
              {[
                { name: "authenticate()", desc: "Token handshake & credentials validation" },
                { name: "sync_products()", desc: "Catalogue & variant schema mapping" },
                { name: "sync_inventory()", desc: "Available stock push (Oversell prevention)" },
                { name: "import_orders()", desc: "Webhook / polling ingestion with idempotency" },
                { name: "update_order_status()", desc: "Pick / Pack milestone progression" },
                { name: "update_shipment()", desc: "Transporter & tracking code push" },
                { name: "import_returns()", desc: "Return request sync into QC Hold" },
                { name: "import_settlements()", desc: "TCS, fees & net remittance ingestion" },
              ].map((fn, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                >
                  <p className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">
                    {fn.name}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{fn.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL 1: WATERMARKED DEMO INVOICE PREVIEW ──────────────────── */}
      {showInvoiceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl relative overflow-hidden space-y-4">
            {/* Watermark Diagonal Banner */}
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-10">
              <span className="text-4xl sm:text-5xl font-black text-rose-600 -rotate-45 select-none uppercase">
                DEMO / NOT A TAX INVOICE
              </span>
            </div>

            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <FileCheck2 className="w-5 h-5 text-indigo-600" />
                <h4 className="font-bold text-slate-900 dark:text-slate-100">
                  Demo Invoice Preview: {state.demoInvoiceNumber ?? state.invoiceId}
                </h4>
              </div>
              <button
                onClick={() => setShowInvoiceModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200">
                <strong>Demonstration Watermark Notice:</strong> This document represents an illustrative customer invoice. No statutory tax document has been submitted to GSTN / NIC portals.
              </div>

              <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-850">
                <div>
                  <span className="text-slate-400 block text-[10px]">Seller</span>
                  <strong className="text-slate-800 dark:text-slate-200">WhizUnik / Adventra Lifestyle Pvt Ltd</strong>
                  <p className="text-[11px] text-slate-500">GSTIN: 29AAAAA0000A1Z5</p>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Buyer (Marketplace Customer)</span>
                  <strong className="text-slate-800 dark:text-slate-200">Rohan Sharma</strong>
                  <p className="text-[11px] text-slate-500">Order Ref: DEMO-AMZ-1001</p>
                </div>
              </div>

              <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                    <tr>
                      <th className="p-2">Item Description</th>
                      <th className="p-2">HSN</th>
                      <th className="p-2 text-right">Qty</th>
                      <th className="p-2 text-right">Rate</th>
                      <th className="p-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-slate-100 dark:border-slate-800">
                      <td className="p-2">Adventra Classic Tee (Black - M) [AD-TS-BLK-M]</td>
                      <td className="p-2 font-mono">61091000</td>
                      <td className="p-2 text-right font-mono">2</td>
                      <td className="p-2 text-right font-mono">₹1,000.00</td>
                      <td className="p-2 text-right font-mono font-bold">₹2,000.00</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-850 space-y-1 text-[11px] font-mono text-slate-600 dark:text-slate-400">
                <div className="flex justify-between">
                  <span>Taxable Value:</span>
                  <span>₹1,904.76</span>
                </div>
                <div className="flex justify-between">
                  <span>Integrated GST (5%):</span>
                  <span>₹95.24</span>
                </div>
                <div className="flex justify-between font-bold text-slate-900 dark:text-slate-100 text-xs pt-1 border-t border-slate-200 dark:border-slate-700">
                  <span>Grand Total:</span>
                  <span>₹2,000.00</span>
                </div>
                <div className="flex justify-between text-[10px] text-slate-400 pt-1">
                  <span>Mock IRN Token:</span>
                  <span>4b8f9e...demo-mock-irn</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowInvoiceModal(false)}
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL 2: MAP UNMAPPED SKU MODAL ────────────────────────────── */}
      {showMapModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-indigo-600" />
                <h4 className="font-bold text-slate-900 dark:text-slate-100">
                  Resolve Unmapped SKU: AMZ-UNKNOWN
                </h4>
              </div>
              <button
                onClick={() => setShowMapModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-slate-600 dark:text-slate-300">
                Select the destination WhizUnik child SKU to bind <code>AMZ-UNKNOWN</code>. Per Section 8 exception script, map to <strong>AD-TS-WHT-M</strong>:
              </p>

              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase mb-1">
                  Target WhizUnik SKU
                </label>
                <select
                  value={mapTargetSku}
                  onChange={(e) => setMapTargetSku(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-850 font-mono text-xs font-semibold focus:outline-hidden"
                >
                  <option value="AD-TS-WHT-M">AD-TS-WHT-M (White Tee M - 18 On-hand)</option>
                  <option value="AD-TS-BLK-L">AD-TS-BLK-L (Black Tee L - 15 On-hand)</option>
                  <option value="AD-PO-NVY-M">AD-PO-NVY-M (Navy Polo M - 10 On-hand)</option>
                </select>
              </div>

              <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-[11px]">
                Upon mapping, the pending error event <strong>DEMO-AMZ-ERR-01</strong> will reprocess automatically, creating 1 sales order and reserving 1 unit cleanly.
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowMapModal(false)}
                className="px-3.5 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleResolveUnmappedSku}
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition shadow-xs"
              >
                Confirm Mapping & Reprocess
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
