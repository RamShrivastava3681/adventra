import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRightLeft,
  Banknote,
  BarChart2,
  Calendar,
  CheckCircle,
  Clock,
  Download,
  FileText,
  Loader2,
  Package,
  PauseCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  Tag,
  Truck,
  Upload,
  Warehouse,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  KpiCard,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import api from "@/lib/api-client";

export const Route = createFileRoute("/app/myntra-dashboard")({
  component: MyntraDashboardPage,
});

// ─────────────────────────────────────────────────────────────────────────────
// Types (camelCase after camelizeResponse)
// ─────────────────────────────────────────────────────────────────────────────

interface OrderLine {
  orderLineId: string;
  sku: string;
  quantity: number;
  status?: string | null;
  mrp?: number | null;
  lineFinalAmount?: number | null;
}
interface MyntraOrder {
  sellerOrderId: string;
  orderId?: string | null;
  packetId?: string | null;
  warehouse?: string | null;
  status: string;
  onHold?: boolean;
  orderDate?: string | null;
  paymentMethod?: string | null;
  amountDue?: number | null;
  trackingNumber?: string | null;
  courierCode?: string | null;
  receiverCity?: string | null;
  receiverState?: string | null;
  receiverZipcode?: string | null;
  orderLines: OrderLine[];
  lastEvent?: string | null;
  createdAt: string;
  updatedAt: string;
}
interface MyntraReturn {
  returnKey: string;
  returnId?: string | null;
  returnReferenceId?: string | null;
  type?: string | null;
  status?: string | null;
  sellerOrderId?: string | null;
  trackingNumber?: string | null;
  reason?: string | null;
  returnWarehouseCode?: string | null;
  orderLineIds: string[];
  createdAt: string;
  updatedAt: string;
}
interface InventoryRow {
  sku: string;
  storeCode: string;
  quantity: number | null;
  processingSla: number | null;
  source: "pushed" | "myntra";
  pushStatus?: "SUCCESS" | "FAILED" | null;
  remarks?: string | null;
  updatedAt: string;
}
interface EventRow {
  id: string;
  event: string;
  method: string;
  path: string;
  authorized: boolean;
  responseStatus: number;
  receivedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Order stages — the order flow in Myntra's guide:
// New → Accepted → Ready to dispatch (packed) → Shipped → Delivered,
// with On hold / Cancelled / Rejected / Lost as exceptions.
// ─────────────────────────────────────────────────────────────────────────────

type Stage =
  | "New"
  | "Accepted"
  | "Ready to dispatch"
  | "Shipped"
  | "Delivered"
  | "On hold"
  | "Cancelled"
  | "Rejected"
  | "Lost";

const STAGE_COLOR: Record<Stage, string> = {
  New: "#f59e0b",
  Accepted: "#6366f1",
  "Ready to dispatch": "#0ea5e9",
  Shipped: "#2563eb",
  Delivered: "#10b981",
  "On hold": "#a855f7",
  Cancelled: "#94a3b8",
  Rejected: "#f43f5e",
  Lost: "#be123c",
};

function stageOf(o: MyntraOrder): Stage {
  const s = (o.status ?? "").toUpperCase();
  if (o.onHold) return "On hold";
  if (["CANCELLED", "C", "F", "IC"].includes(s)) return "Cancelled";
  if (["REJECTED", "R"].includes(s)) return "Rejected";
  if (["LOST", "L"].includes(s)) return "Lost";
  if (["DELIVERED", "DL", "D"].includes(s)) return "Delivered";
  if (["SHIPPED", "SH"].includes(s)) return "Shipped";
  if (["READY_TO_DISPATCH", "RTD", "PK", "PACKED"].includes(s)) return "Ready to dispatch";
  if (["ACCEPTED", "A", "WP"].includes(s)) return "Accepted";
  return "New";
}

function StagePill({ stage }: { stage: Stage }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{
        borderColor: `${STAGE_COLOR[stage]}55`,
        color: STAGE_COLOR[stage],
        background: `${STAGE_COLOR[stage]}12`,
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: STAGE_COLOR[stage] }} />
      {stage}
    </span>
  );
}

const activeLines = (o: MyntraOrder) =>
  o.orderLines.filter((l) => (l.status ?? "").toUpperCase() !== "CANCELLED");
const orderUnits = (o: MyntraOrder) =>
  activeLines(o).reduce((n, l) => n + (Number(l.quantity) || 0), 0);
const orderValue = (o: MyntraOrder) => {
  const lines = activeLines(o).reduce((n, l) => n + (Number(l.lineFinalAmount) || 0), 0);
  return lines > 0 ? lines : Number(o.amountDue) || 0;
};

/** Myntra dates come as "dd-MM-yyyy HH:mm:ss"; fall back to when we received the order. */
function orderDateOf(o: MyntraOrder): Date {
  const raw = o.orderDate ?? "";
  const m = raw.match(/^(\d{2})-(\d{2})-(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  const d = raw ? new Date(raw) : null;
  return d && !isNaN(d.getTime()) ? d : new Date(o.createdAt);
}

const inr = (n: number) =>
  n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const when = (iso?: string | null) => (iso ? format(new Date(iso), "d MMM, h:mm a") : "—");

const RANGES = [
  { label: "Today", days: 0 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "All time", days: -1 },
] as const;

function inRange(d: Date, label: string) {
  const r = RANGES.find((x) => x.label === label);
  if (!r || r.days < 0) return true;
  const from = r.days === 0 ? startOfDay(new Date()) : startOfDay(subDays(new Date(), r.days));
  return d >= from && d <= endOfDay(new Date());
}

const REJECT_REASONS: { id: number; label: string }[] = [
  { id: 1, label: "Backstore product" },
  { id: 2, label: "Barcode mismatch" },
  { id: 3, label: "Digital inventory mismatch" },
  { id: 4, label: "Last piece in the store" },
  { id: 5, label: "Mannequin display" },
  { id: 6, label: "Product defective" },
  { id: 7, label: "Product is with walk-in customer" },
  { id: 8, label: "Product physically not available" },
  { id: 9, label: "Size mismatch" },
  { id: 10, label: "Tag missing / wrong" },
  { id: 11, label: "Tech error" },
  { id: 12, label: "Uniform product" },
  { id: 13, label: "Missing – OSM stock" },
  { id: 14, label: "Others" },
];

const LOW_STOCK = 5;

interface ActionResponse {
  result?: { ok: boolean; message?: string; httpStatus?: number | null };
}

function resultToast(r: ActionResponse | undefined) {
  const res = r?.result;
  if (!res) return;
  if (res.ok) toast.success(res.message || "Done");
  else toast.error(`Myntra: ${res.message || `HTTP ${res.httpStatus ?? "no response"}`}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared bits
// ─────────────────────────────────────────────────────────────────────────────

const card =
  "rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900";
const tabClass =
  "inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors data-[state=active]:bg-slate-100 dark:data-[state=active]:bg-slate-800 data-[state=active]:font-semibold data-[state=active]:text-slate-900 dark:data-[state=active]:text-slate-100";

function EmptyState({
  title,
  subtitle,
  icon,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-[160px] flex-col items-center justify-center p-6 text-center">
      {icon}
      <h3 className="mt-3 font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      <p className="mt-1 max-w-sm text-xs text-slate-500">{subtitle}</p>
    </div>
  );
}

function PipelineTile({
  label,
  value,
  hint,
  tone,
  icon,
}: {
  label: string;
  value: number;
  hint: string;
  tone: "amber" | "indigo" | "sky" | "blue" | "emerald" | "rose" | "slate" | "violet";
  icon: ReactNode;
}) {
  const tones: Record<string, string> = {
    amber:
      "bg-amber-50/70 border-amber-200/60 text-amber-700 dark:bg-amber-950/20 dark:border-amber-900/40 dark:text-amber-400",
    indigo:
      "bg-indigo-50/70 border-indigo-200/60 text-indigo-700 dark:bg-indigo-950/20 dark:border-indigo-900/40 dark:text-indigo-400",
    sky: "bg-sky-50/70 border-sky-200/60 text-sky-700 dark:bg-sky-950/20 dark:border-sky-900/40 dark:text-sky-400",
    blue: "bg-blue-50/70 border-blue-200/60 text-blue-700 dark:bg-blue-950/20 dark:border-blue-900/40 dark:text-blue-400",
    emerald:
      "bg-emerald-50/70 border-emerald-200/60 text-emerald-700 dark:bg-emerald-950/20 dark:border-emerald-900/40 dark:text-emerald-400",
    rose: "bg-rose-50/70 border-rose-200/60 text-rose-700 dark:bg-rose-950/20 dark:border-rose-900/40 dark:text-rose-400",
    violet:
      "bg-violet-50/70 border-violet-200/60 text-violet-700 dark:bg-violet-950/20 dark:border-violet-900/40 dark:text-violet-400",
    slate:
      "bg-slate-50 border-slate-200 text-slate-600 dark:bg-slate-800/40 dark:border-slate-800 dark:text-slate-400",
  };
  return (
    <div className={cn("rounded-xl border p-3", tones[tone])}>
      <div className="flex items-center gap-1.5 text-xs font-medium">
        {icon} {label}
      </div>
      <div className="mt-1.5 text-2xl font-bold text-slate-900 dark:text-slate-100">
        {value.toLocaleString()}
      </div>
      <div className="mt-0.5 text-[11px] opacity-80">{hint}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

function MyntraDashboardPage() {
  const qc = useQueryClient();
  const [range, setRange] = useState<string>("Last 30 days");
  const [tab, setTab] = useState("overview");

  const status = useQuery({ queryKey: ["myntra", "status"], queryFn: api.myntra.status });
  const ordersQ = useQuery({ queryKey: ["myntra", "orders"], queryFn: api.myntra.orders });
  const returnsQ = useQuery({ queryKey: ["myntra", "returns"], queryFn: api.myntra.returns });
  const inventoryQ = useQuery({ queryKey: ["myntra", "inventory"], queryFn: api.myntra.inventory });
  const eventsQ = useQuery({
    queryKey: ["myntra", "events"],
    queryFn: api.myntra.events,
    enabled: tab === "api-health",
  });

  const allOrders = useMemo<MyntraOrder[]>(() => ordersQ.data?.orders ?? [], [ordersQ.data]);
  const allReturns = useMemo<MyntraReturn[]>(() => returnsQ.data?.returns ?? [], [returnsQ.data]);
  const inventory = useMemo<InventoryRow[]>(() => inventoryQ.data?.items ?? [], [inventoryQ.data]);
  const s = status.data;

  const orders = useMemo(
    () => allOrders.filter((o) => inRange(orderDateOf(o), range)),
    [allOrders, range],
  );
  const returns = useMemo(
    () => allReturns.filter((r) => inRange(new Date(r.createdAt), range)),
    [allReturns, range],
  );

  const refreshing =
    ordersQ.isFetching || returnsQ.isFetching || inventoryQ.isFetching || status.isFetching;
  const loading = ordersQ.isLoading || returnsQ.isLoading || inventoryQ.isLoading;

  const lastActivity = [s?.lastEventAt, s?.lastCallAt].filter(Boolean).sort().pop() as
    string | undefined;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 p-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Myntra Seller Panel
            </h1>
            <Button
              size="sm"
              className="h-8 px-3.5 text-xs"
              disabled={refreshing}
              onClick={() => qc.invalidateQueries({ queryKey: ["myntra"] })}
            >
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", refreshing && "animate-spin")} />
              {refreshing ? "Refreshing…" : "Refresh Data"}
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-2 dark:border-slate-800/80">
            <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
              <Calendar className="h-3.5 w-3.5 text-slate-400" />
              <Select value={range} onValueChange={setRange}>
                <SelectTrigger className="h-8 w-[140px] bg-slate-50 text-[12px] dark:bg-slate-800/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RANGES.map((r) => (
                    <SelectItem key={r.label} value={r.label}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
              <Clock className="h-3.5 w-3.5" />
              {lastActivity
                ? `Last activity: ${when(lastActivity)}`
                : "No activity with Myntra yet"}
            </div>
          </div>
        </div>
      </header>

      {s && !s.isConfigured && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs dark:border-amber-800/50 dark:bg-amber-900/20 sm:px-6 lg:px-8">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div>
              <p className="font-semibold text-amber-800 dark:text-amber-200">
                Myntra account not connected
              </p>
              <p className="mt-0.5 text-amber-700 dark:text-amber-300">
                Myntra shares the merchant ID and secret key after WhizUnik is onboarded as an OMS.
                Orders will appear here once connected.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="p-4 sm:p-6 lg:p-8">
        <Tabs value={tab} onValueChange={setTab} className="border-none">
          <TabsList className="mb-6 inline-flex h-auto flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            <TabsTrigger value="overview" className={tabClass}>
              <BarChart2 className="h-3.5 w-3.5" /> Overview
            </TabsTrigger>
            <TabsTrigger value="orders" className={tabClass}>
              <ShoppingBag className="h-3.5 w-3.5" /> Orders
            </TabsTrigger>
            <TabsTrigger value="inventory" className={tabClass}>
              <Warehouse className="h-3.5 w-3.5" /> Inventory
            </TabsTrigger>
            <TabsTrigger value="returns" className={tabClass}>
              <ArrowRightLeft className="h-3.5 w-3.5" /> Returns
            </TabsTrigger>
            <TabsTrigger value="analytics" className={tabClass}>
              <BarChart2 className="h-3.5 w-3.5" /> Analytics
            </TabsTrigger>
            <TabsTrigger value="api-health" className={tabClass}>
              <ShieldCheck className="h-3.5 w-3.5" /> API Health
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6 border-none p-0">
            <Overview
              orders={orders}
              returns={returns}
              inventory={inventory}
              loading={loading}
              onOpen={setTab}
            />
          </TabsContent>
          <TabsContent value="orders" className="border-none p-0">
            <OrdersSection orders={orders} loading={ordersQ.isLoading} />
          </TabsContent>
          <TabsContent value="inventory" className="border-none p-0">
            <InventorySection
              rows={inventory}
              loading={inventoryQ.isLoading}
              connected={Boolean(s?.isConfigured)}
            />
          </TabsContent>
          <TabsContent value="returns" className="border-none p-0">
            <ReturnsSection rows={returns} loading={returnsQ.isLoading} />
          </TabsContent>
          <TabsContent value="analytics" className="border-none p-0">
            <AnalyticsSection orders={orders} returns={returns} />
          </TabsContent>
          <TabsContent value="api-health" className="border-none p-0">
            <ApiHealthSection events={eventsQ.data?.events ?? []} loading={eventsQ.isLoading} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Overview
// ─────────────────────────────────────────────────────────────────────────────

function Overview({
  orders,
  returns,
  inventory,
  loading,
  onOpen,
}: {
  orders: MyntraOrder[];
  returns: MyntraReturn[];
  inventory: InventoryRow[];
  loading: boolean;
  onOpen: (tab: string) => void;
}) {
  const stages = useMemo(() => {
    const c: Record<Stage, number> = {
      New: 0,
      Accepted: 0,
      "Ready to dispatch": 0,
      Shipped: 0,
      Delivered: 0,
      "On hold": 0,
      Cancelled: 0,
      Rejected: 0,
      Lost: 0,
    };
    orders.forEach((o) => c[stageOf(o)]++);
    return c;
  }, [orders]);

  const counted = orders.filter((o) => !["Cancelled", "Rejected"].includes(stageOf(o)));
  const revenue = counted.reduce((n, o) => n + orderValue(o), 0);
  const units = counted.reduce((n, o) => n + orderUnits(o), 0);
  const today = counted.filter((o) => inRange(orderDateOf(o), "Today"));
  const totalUnits = inventory.reduce((n, r) => n + (r.quantity ?? 0), 0);
  const lowStock = inventory.filter(
    (r) => (r.quantity ?? 0) > 0 && (r.quantity ?? 0) <= LOW_STOCK,
  ).length;
  const outOfStock = inventory.filter((r) => (r.quantity ?? 0) <= 0).length;
  const returnRate = orders.length ? (returns.length / orders.length) * 100 : 0;

  const trend = useMemo(() => dailyTrend(counted), [counted]);
  const pie = (Object.keys(stages) as Stage[])
    .filter((k) => stages[k] > 0)
    .map((k) => ({ name: k, value: stages[k] }));

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Total Revenue"
          value={loading ? "…" : inr(revenue)}
          subtitle={
            today.length
              ? `Today: ${inr(today.reduce((n, o) => n + orderValue(o), 0))}`
              : "Order value in range"
          }
          icon={<Banknote className="h-4 w-4" />}
          color="#ec4899"
          onClick={() => onOpen("orders")}
        />
        <KpiCard
          title="Total Orders"
          value={loading ? "…" : orders.length.toLocaleString()}
          subtitle={
            today.length ? `${today.length} placed today` : `${stages.New} awaiting acceptance`
          }
          icon={<ShoppingBag className="h-4 w-4" />}
          color="#db2777"
          onClick={() => onOpen("orders")}
        />
        <KpiCard
          title="Units Sold"
          value={loading ? "…" : units.toLocaleString()}
          subtitle="Excluding cancelled & rejected"
          icon={<Package className="h-4 w-4" />}
          color="#0891b2"
          onClick={() => onOpen("orders")}
        />
        <KpiCard
          title="Returns"
          value={loading ? "…" : returns.length.toLocaleString()}
          subtitle={`${returnRate.toFixed(1)}% return rate`}
          icon={<ArrowRightLeft className="h-4 w-4" />}
          color="#8b5cf6"
          onClick={() => onOpen("returns")}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={cn(card, "p-5")}>
          <div className="mb-3.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-pink-600" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Order Fulfilment Pipeline
              </h3>
            </div>
            <span className="text-xs font-medium text-slate-500">{orders.length} orders</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <PipelineTile
              label="New"
              value={stages.New}
              hint="Accept or reject"
              tone="amber"
              icon={<Clock className="h-3.5 w-3.5" />}
            />
            <PipelineTile
              label="To pack"
              value={stages.Accepted + stages["Ready to dispatch"]}
              hint="Accepted / ready to dispatch"
              tone="sky"
              icon={<Package className="h-3.5 w-3.5" />}
            />
            <PipelineTile
              label="Shipped"
              value={stages.Shipped}
              hint="In transit"
              tone="blue"
              icon={<Truck className="h-3.5 w-3.5" />}
            />
            <PipelineTile
              label="Delivered"
              value={stages.Delivered}
              hint="Customer received"
              tone="emerald"
              icon={<CheckCircle className="h-3.5 w-3.5" />}
            />
          </div>
          <div className="mt-2.5 grid grid-cols-3 gap-2.5">
            <PipelineTile
              label="On hold"
              value={stages["On hold"]}
              hint="Held by Myntra"
              tone="violet"
              icon={<PauseCircle className="h-3.5 w-3.5" />}
            />
            <PipelineTile
              label="Cancelled"
              value={stages.Cancelled + stages.Rejected}
              hint="Cancelled / rejected"
              tone="slate"
              icon={<XCircle className="h-3.5 w-3.5" />}
            />
            <PipelineTile
              label="Lost"
              value={stages.Lost}
              hint="Lost in transit"
              tone="rose"
              icon={<AlertTriangle className="h-3.5 w-3.5" />}
            />
          </div>
        </div>

        <div className={cn(card, "p-5")}>
          <div className="mb-3.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Warehouse className="h-4 w-4 text-emerald-600" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Inventory & Returns Health
              </h3>
            </div>
            <span className="text-xs font-medium text-slate-500">
              {totalUnits.toLocaleString()} units
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <PipelineTile
              label="Stock"
              value={totalUnits}
              hint={`${inventory.length} SKU × store`}
              tone="slate"
              icon={<Warehouse className="h-3.5 w-3.5" />}
            />
            <PipelineTile
              label="Low Stock"
              value={lowStock}
              hint={`≤ ${LOW_STOCK} units`}
              tone="amber"
              icon={<AlertTriangle className="h-3.5 w-3.5" />}
            />
            <PipelineTile
              label="Out of Stock"
              value={outOfStock}
              hint="Not buyable"
              tone="rose"
              icon={<XCircle className="h-3.5 w-3.5" />}
            />
            <PipelineTile
              label="RTO"
              value={returns.filter((r) => /RTO|COURIER/i.test(r.type ?? "")).length}
              hint="Returned to origin"
              tone="violet"
              icon={<ArrowRightLeft className="h-3.5 w-3.5" />}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className={cn(card, "p-6 lg:col-span-2")}>
          <h2 className="font-bold text-slate-900 dark:text-slate-100">Revenue vs Orders Trend</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Daily order value and count in the selected range
          </p>
          <div className="mt-4 h-64 w-full">
            {trend.length === 0 ? (
              <EmptyState
                title="No order trend data"
                subtitle="Orders from Myntra will show here."
                icon={<ShoppingBag className="h-8 w-8 text-slate-300" />}
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    className="stroke-slate-200 dark:stroke-slate-800"
                  />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <YAxis
                    yAxisId="v"
                    tickFormatter={(v) => `₹${Math.round(v)}`}
                    tick={{ fontSize: 11 }}
                    width={60}
                  />
                  <YAxis
                    yAxisId="n"
                    orientation="right"
                    allowDecimals={false}
                    tick={{ fontSize: 11 }}
                    width={30}
                  />
                  <Tooltip />
                  <Legend />
                  <Line
                    yAxisId="v"
                    type="monotone"
                    dataKey="revenue"
                    stroke="#ec4899"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    name="Revenue (₹)"
                  />
                  <Line
                    yAxisId="n"
                    type="monotone"
                    dataKey="orders"
                    stroke="#6366f1"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    name="Orders"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
        <div className={cn(card, "p-6")}>
          <h2 className="font-bold text-slate-900 dark:text-slate-100">Orders by Status</h2>
          <p className="mt-0.5 text-xs text-slate-500">Where each order is in the Myntra flow</p>
          <div className="mt-4 h-64 w-full">
            {pie.length === 0 ? (
              <EmptyState
                title="No orders"
                subtitle="Status distribution appears once orders arrive."
                icon={<BarChart2 className="h-8 w-8 text-slate-300" />}
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pie}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    label
                  >
                    {pie.map((p) => (
                      <Cell key={p.name} fill={STAGE_COLOR[p.name as Stage]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function dailyTrend(orders: MyntraOrder[]) {
  const map = new Map<string, { key: number; date: string; revenue: number; orders: number }>();
  for (const o of orders) {
    const d = startOfDay(orderDateOf(o));
    const k = d.getTime();
    const row = map.get(String(k)) ?? { key: k, date: format(d, "d MMM"), revenue: 0, orders: 0 };
    row.revenue += orderValue(o);
    row.orders += 1;
    map.set(String(k), row);
  }
  return [...map.values()].sort((a, b) => a.key - b.key);
}

// ─────────────────────────────────────────────────────────────────────────────
// Orders
// ─────────────────────────────────────────────────────────────────────────────

function OrdersSection({ orders, loading }: { orders: MyntraOrder[]; loading: boolean }) {
  const qc = useQueryClient();
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<MyntraOrder | null>(null);
  const [rejecting, setRejecting] = useState<MyntraOrder | null>(null);
  const [reason, setReason] = useState("3");

  const done = (r: ActionResponse) => {
    resultToast(r);
    qc.invalidateQueries({ queryKey: ["myntra", "orders"] });
  };
  const fail = (e: Error) => toast.error(e.message);
  const accept = useMutation({
    mutationFn: (id: string) => api.myntra.acceptOrder(id),
    onSuccess: done,
    onError: fail,
  });
  const rtd = useMutation({
    mutationFn: (id: string) => api.myntra.readyToDispatch(id),
    onSuccess: done,
    onError: fail,
  });
  const refresh = useMutation({
    mutationFn: (id: string) => api.myntra.refreshOrder(id),
    onSuccess: done,
    onError: fail,
  });
  const reject = useMutation({
    mutationFn: ({ id, reasonId }: { id: string; reasonId: number }) =>
      api.myntra.rejectOrder(id, reasonId),
    onSuccess: (r) => {
      done(r);
      setRejecting(null);
    },
    onError: fail,
  });
  const doc = useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: "invoice" | "shipping-label" }) =>
      api.myntra.downloadDocument(id, kind),
    onError: fail,
  });

  const q = query.trim().toLowerCase();
  const shown = orders
    .filter((o) => stageFilter === "all" || stageOf(o) === stageFilter)
    .filter(
      (o) =>
        !q ||
        [
          o.sellerOrderId,
          o.orderId,
          o.packetId,
          o.trackingNumber,
          ...o.orderLines.map((l) => l.sku),
        ]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
    )
    .sort((a, b) => orderDateOf(b).getTime() - orderDateOf(a).getTime());

  return (
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 dark:border-slate-800">
        <div>
          <h2 className="font-bold text-slate-900 dark:text-slate-100">Orders</h2>
          <p className="text-xs text-slate-500">
            Accept or reject new orders, then mark them ready to dispatch
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={stageFilter} onValueChange={setStageFilter}>
            <SelectTrigger className="h-8 w-[160px] text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {(Object.keys(STAGE_COLOR) as Stage[]).map((st) => (
                <SelectItem key={st} value={st}>
                  {st}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-slate-400" />
            <Input
              className="h-8 w-56 pl-8 text-[12px]"
              placeholder="Order, packet, AWB or SKU"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
      </div>
      <TableContainer className="border-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Items</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Shipment</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-slate-500">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </TableCell>
              </TableRow>
            ) : shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <EmptyState
                    title="No orders"
                    subtitle={
                      orders.length
                        ? "No orders match your filters."
                        : "No Myntra orders in this period. New orders arrive automatically from Myntra."
                    }
                    icon={<ShoppingBag className="h-8 w-8 text-slate-300" />}
                  />
                </TableCell>
              </TableRow>
            ) : (
              shown.map((o) => {
                const stage = stageOf(o);
                return (
                  <TableRow
                    key={o.sellerOrderId}
                    className="cursor-pointer"
                    onClick={() => setView(o)}
                  >
                    <TableCell>
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {o.orderId ? `#${o.orderId}` : o.sellerOrderId.slice(0, 13)}
                      </div>
                      <div className="font-mono text-[11px] text-slate-400">
                        {o.sellerOrderId.slice(0, 18)}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {format(orderDateOf(o), "d MMM yyyy")}
                    </TableCell>
                    <TableCell className="text-xs">
                      {activeLines(o).length === 0 ? (
                        "—"
                      ) : (
                        <>
                          <div className="font-mono">{activeLines(o)[0].sku}</div>
                          {activeLines(o).length > 1 && (
                            <div className="text-slate-400">+{activeLines(o).length - 1} more</div>
                          )}
                        </>
                      )}
                    </TableCell>
                    <TableCell className="text-xs font-medium">{inr(orderValue(o))}</TableCell>
                    <TableCell>
                      <StagePill stage={stage} />
                    </TableCell>
                    <TableCell className="text-xs">
                      {o.trackingNumber ? (
                        <>
                          <div>{o.courierCode ?? "Courier"}</div>
                          <div className="font-mono text-slate-400">{o.trackingNumber}</div>
                        </>
                      ) : (
                        <span className="text-slate-400">
                          {o.warehouse ? `From ${o.warehouse}` : "—"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        {stage === "New" && (
                          <>
                            <Button
                              size="sm"
                              className="h-7 px-2.5 text-xs"
                              disabled={accept.isPending}
                              onClick={() => accept.mutate(o.sellerOrderId)}
                            >
                              Accept
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2.5 text-xs"
                              onClick={() => setRejecting(o)}
                            >
                              Reject
                            </Button>
                          </>
                        )}
                        {stage === "Accepted" && (
                          <Button
                            size="sm"
                            className="h-7 px-2.5 text-xs"
                            disabled={rtd.isPending}
                            onClick={() => rtd.mutate(o.sellerOrderId)}
                          >
                            Ready to dispatch
                          </Button>
                        )}
                        {o.packetId && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              title="Download invoice"
                              disabled={doc.isPending}
                              onClick={() => doc.mutate({ id: o.sellerOrderId, kind: "invoice" })}
                            >
                              <FileText className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              title="Download shipping label"
                              disabled={doc.isPending}
                              onClick={() =>
                                doc.mutate({ id: o.sellerOrderId, kind: "shipping-label" })
                              }
                            >
                              <Tag className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          title="Fetch latest from Myntra"
                          disabled={refresh.isPending}
                          onClick={() => refresh.mutate(o.sellerOrderId)}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={!!view} onOpenChange={(v) => !v && setView(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Order {view?.orderId ? `#${view.orderId}` : ""}{" "}
              {view && <StagePill stage={stageOf(view)} />}
            </DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {view?.sellerOrderId}
            </DialogDescription>
          </DialogHeader>
          {view && (
            <div className="space-y-4 text-sm">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                {(
                  [
                    ["Order date", format(orderDateOf(view), "d MMM yyyy, h:mm a")],
                    [
                      "Payment",
                      view.paymentMethod === "cod"
                        ? "Cash on delivery"
                        : view.paymentMethod
                          ? "Prepaid"
                          : "—",
                    ],
                    ["Warehouse", view.warehouse ?? "—"],
                    [
                      "Ship to",
                      [view.receiverCity, view.receiverState, view.receiverZipcode]
                        .filter(Boolean)
                        .join(", ") || "—",
                    ],
                    ["Packet", view.packetId ?? "—"],
                    [
                      "Tracking",
                      view.trackingNumber
                        ? `${view.courierCode ?? ""} ${view.trackingNumber}`.trim()
                        : "—",
                    ],
                    ["Last update", `${view.lastEvent ?? "—"} · ${when(view.updatedAt)}`],
                    ["On hold", view.onHold ? "Yes" : "No"],
                  ] as [string, string][]
                ).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-slate-500">{k}</dt>
                    <dd className="font-medium text-slate-900 dark:text-slate-100">{v}</dd>
                  </div>
                ))}
              </dl>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order line</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.orderLines.map((l) => (
                    <TableRow key={l.orderLineId}>
                      <TableCell className="font-mono text-xs">{l.orderLineId}</TableCell>
                      <TableCell className="font-mono text-xs">{l.sku || "—"}</TableCell>
                      <TableCell>{l.quantity}</TableCell>
                      <TableCell>
                        {l.lineFinalAmount != null ? inr(l.lineFinalAmount) : "—"}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-xs",
                          (l.status ?? "").toUpperCase() === "CANCELLED" && "text-rose-600",
                        )}
                      >
                        {l.status ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejecting} onOpenChange={(v) => !v && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject order</DialogTitle>
            <DialogDescription>
              Rejects all open items of order{" "}
              {rejecting?.orderId ? `#${rejecting.orderId}` : rejecting?.sellerOrderId} on Myntra.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REJECT_REASONS.map((r) => (
                <SelectItem key={r.id} value={String(r.id)}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={reject.isPending}
              onClick={() =>
                rejecting &&
                reject.mutate({ id: rejecting.sellerOrderId, reasonId: Number(reason) })
              }
            >
              {reject.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Reject order
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inventory
// ─────────────────────────────────────────────────────────────────────────────

function InventorySection({
  rows,
  loading,
  connected,
}: {
  rows: InventoryRow[];
  loading: boolean;
  connected: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [sku, setSku] = useState("");
  const [store, setStore] = useState("");
  const [qty, setQty] = useState("");
  const [sla, setSla] = useState("3");
  const [query, setQuery] = useState("");

  const after = (r: ActionResponse) => {
    resultToast(r);
    qc.invalidateQueries({ queryKey: ["myntra", "inventory"] });
  };
  const push = useMutation({
    mutationFn: () =>
      api.myntra.pushInventory([
        {
          sku: sku.trim(),
          storeCode: store.trim(),
          quantity: Number(qty),
          processingSla: Number(sla),
        },
      ]),
    onSuccess: (r) => {
      after(r);
      if (r?.result?.ok) setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const sync = useMutation({
    mutationFn: () => api.myntra.searchInventory([...new Set(rows.map((r) => r.sku))]),
    onSuccess: after,
    onError: (e: Error) => toast.error(e.message),
  });

  const total = rows.reduce((n, r) => n + (r.quantity ?? 0), 0);
  const low = rows.filter((r) => (r.quantity ?? 0) > 0 && (r.quantity ?? 0) <= LOW_STOCK).length;
  const out = rows.filter((r) => (r.quantity ?? 0) <= 0).length;
  const failed = rows.filter((r) => r.pushStatus === "FAILED").length;
  const q = query.trim().toLowerCase();
  const shown = rows.filter(
    (r) => !q || r.sku.toLowerCase().includes(q) || r.storeCode.toLowerCase().includes(q),
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Total Inventory Units"
          value={total.toLocaleString()}
          subtitle={`${rows.length} SKU × store`}
          icon={<Warehouse className="h-4 w-4" />}
          color="#0ea5e9"
        />
        <KpiCard
          title="Low Stock"
          value={low}
          subtitle={`≤ ${LOW_STOCK} units`}
          icon={<AlertTriangle className="h-4 w-4" />}
          color="#f59e0b"
        />
        <KpiCard
          title="Out of Stock"
          value={out}
          subtitle="Not buyable on Myntra"
          icon={<XCircle className="h-4 w-4" />}
          color="#f43f5e"
        />
        <KpiCard
          title="Failed Updates"
          value={failed}
          subtitle="Rejected by Myntra"
          icon={<AlertCircle className="h-4 w-4" />}
          color="#be123c"
        />
      </div>

      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 dark:border-slate-800">
          <div>
            <h2 className="font-bold text-slate-900 dark:text-slate-100">Stock on Myntra</h2>
            <p className="text-xs text-slate-500">Stock per seller SKU and Myntra store</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2 h-4 w-4 text-slate-400" />
              <Input
                className="h-8 w-48 pl-8 text-[12px]"
                placeholder="SKU or store"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              disabled={!connected || rows.length === 0 || sync.isPending}
              onClick={() => sync.mutate()}
            >
              <Download className={cn("mr-1.5 h-3.5 w-3.5", sync.isPending && "animate-pulse")} />{" "}
              Sync from Myntra
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={!connected}
              onClick={() => setOpen(true)}
            >
              <Upload className="mr-1.5 h-3.5 w-3.5" /> Update stock
            </Button>
          </div>
        </div>
        <TableContainer className="border-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Seller SKU</TableHead>
                <TableHead>Store</TableHead>
                <TableHead>Available</TableHead>
                <TableHead>Dispatch SLA</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" />
                  </TableCell>
                </TableRow>
              ) : shown.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <EmptyState
                      title="No inventory"
                      subtitle="Update stock to list quantities on Myntra."
                      icon={<Warehouse className="h-8 w-8 text-slate-300" />}
                    />
                  </TableCell>
                </TableRow>
              ) : (
                shown.map((r) => {
                  const qn = r.quantity ?? 0;
                  return (
                    <TableRow key={`${r.sku}#${r.storeCode}`}>
                      <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                      <TableCell className="text-xs">{r.storeCode}</TableCell>
                      <TableCell className="font-medium">{r.quantity ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        {r.processingSla != null
                          ? `${r.processingSla} day${r.processingSla === 1 ? "" : "s"}`
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {r.pushStatus === "FAILED" ? (
                          <span
                            className="text-xs font-medium text-rose-600"
                            title={r.remarks ?? undefined}
                          >
                            Update failed{r.remarks ? ` · ${r.remarks}` : ""}
                          </span>
                        ) : qn <= 0 ? (
                          <Badge variant="outline" className="border-rose-200 text-rose-700">
                            Out of stock
                          </Badge>
                        ) : qn <= LOW_STOCK ? (
                          <Badge variant="outline" className="border-amber-200 text-amber-700">
                            Low stock
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-emerald-200 text-emerald-700">
                            In stock
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-slate-500">
                        {when(r.updatedAt)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update stock on Myntra</DialogTitle>
            <DialogDescription>
              Sets the available quantity for a seller SKU at one Myntra store.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <label className="col-span-2">
              <span className="mb-1 block text-xs text-slate-500">Seller SKU</span>
              <Input value={sku} onChange={(e) => setSku(e.target.value)} />
            </label>
            <label>
              <span className="mb-1 block text-xs text-slate-500">Store code</span>
              <Input value={store} onChange={(e) => setStore(e.target.value)} />
            </label>
            <label>
              <span className="mb-1 block text-xs text-slate-500">Quantity</span>
              <Input type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} />
            </label>
            <label className="col-span-2">
              <span className="mb-1 block text-xs text-slate-500">Dispatch SLA (days)</span>
              <Input type="number" min={1} value={sla} onChange={(e) => setSla(e.target.value)} />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                !sku.trim() || !store.trim() || qty === "" || Number(qty) < 0 || push.isPending
              }
              onClick={() => push.mutate()}
            >
              {push.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Update
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Returns
// ─────────────────────────────────────────────────────────────────────────────

const isRto = (r: MyntraReturn) => /RTO|COURIER|CLOSED/i.test(r.type ?? "");
const isClosed = (r: MyntraReturn) =>
  /RECEIVED|COMPLETE|CLOSED|RESTOCK|QC_PASS|ACCEPT/i.test(r.status ?? "");

function ReturnsSection({ rows, loading }: { rows: MyntraReturn[]; loading: boolean }) {
  const rto = rows.filter(isRto).length;
  const closed = rows.filter(isClosed).length;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Total Returns"
          value={rows.length}
          subtitle="All return cases"
          icon={<ArrowRightLeft className="h-4 w-4" />}
          color="#8b5cf6"
        />
        <KpiCard
          title="Customer Returns"
          value={rows.length - rto}
          subtitle="Returned by customer"
          icon={<ShoppingBag className="h-4 w-4" />}
          color="#ec4899"
        />
        <KpiCard
          title="RTO"
          value={rto}
          subtitle="Returned to origin by courier"
          icon={<Truck className="h-4 w-4" />}
          color="#0ea5e9"
        />
        <KpiCard
          title="Open"
          value={rows.length - closed}
          subtitle={`${closed} received / closed`}
          icon={<Clock className="h-4 w-4" />}
          color="#f59e0b"
        />
      </div>
      <div className={card}>
        <div className="border-b border-slate-100 p-4 dark:border-slate-800">
          <h2 className="font-bold text-slate-900 dark:text-slate-100">Returns</h2>
          <p className="text-xs text-slate-500">Customer returns and RTOs pushed by Myntra</p>
        </div>
        <TableContainer className="border-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Return</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tracking</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <EmptyState
                      title="No returns"
                      subtitle="No Myntra returns in this period."
                      icon={<ArrowRightLeft className="h-8 w-8 text-slate-300" />}
                    />
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.returnKey}>
                    <TableCell className="font-mono text-xs">{r.returnId ?? r.returnKey}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          isRto(r) ? "border-sky-200 text-sky-700" : "border-pink-200 text-pink-700"
                        }
                      >
                        {isRto(r) ? "RTO" : "Customer"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.sellerOrderId?.slice(0, 18) ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">{r.reason ?? "—"}</TableCell>
                    <TableCell className="text-xs font-medium">{r.status ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.trackingNumber ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-slate-500">
                      {when(r.updatedAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics
// ─────────────────────────────────────────────────────────────────────────────

function AnalyticsSection({ orders, returns }: { orders: MyntraOrder[]; returns: MyntraReturn[] }) {
  const topSkus = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of orders) {
      if (["Cancelled", "Rejected"].includes(stageOf(o))) continue;
      for (const l of activeLines(o))
        m.set(l.sku || "?", (m.get(l.sku || "?") ?? 0) + (Number(l.quantity) || 0));
    }
    return [...m.entries()]
      .map(([sku, units]) => ({ sku, units }))
      .sort((a, b) => b.units - a.units)
      .slice(0, 10);
  }, [orders]);

  const byWarehouse = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of orders)
      m.set(o.warehouse ?? "Unknown", (m.get(o.warehouse ?? "Unknown") ?? 0) + 1);
    return [...m.entries()].map(([name, value]) => ({ name, value }));
  }, [orders]);

  const returnReasons = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of returns)
      m.set(r.reason ?? "Not given", (m.get(r.reason ?? "Not given") ?? 0) + 1);
    return [...m.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [returns]);

  const palette = [
    "#ec4899",
    "#6366f1",
    "#0ea5e9",
    "#10b981",
    "#f59e0b",
    "#8b5cf6",
    "#f43f5e",
    "#14b8a6",
  ];

  const chart = (title: string, sub: string, empty: boolean, body: ReactNode, wide = false) => (
    <div className={cn(card, "p-6", wide && "lg:col-span-2")}>
      <h2 className="font-bold text-slate-900 dark:text-slate-100">{title}</h2>
      <p className="mt-0.5 text-xs text-slate-500">{sub}</p>
      <div className="mt-4 h-64 w-full">
        {empty ? (
          <EmptyState
            title="No data yet"
            subtitle="Appears once Myntra orders arrive."
            icon={<BarChart2 className="h-8 w-8 text-slate-300" />}
          />
        ) : (
          body
        )}
      </div>
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {chart(
        "Top SKUs by Units",
        "Best sellers in the selected range",
        topSkus.length === 0,
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={topSkus} layout="vertical" margin={{ left: 20 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              horizontal={false}
              className="stroke-slate-200 dark:stroke-slate-800"
            />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="sku" tick={{ fontSize: 11 }} width={110} />
            <Tooltip />
            <Bar dataKey="units" name="Units" fill="#ec4899" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>,
        true,
      )}
      {chart(
        "Orders by Warehouse",
        "Which Myntra store each order was assigned to",
        byWarehouse.length === 0,
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={byWarehouse}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={85}
              label
            >
              {byWarehouse.map((_, i) => (
                <Cell key={i} fill={palette[i % palette.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>,
      )}
      {chart(
        "Returns by Reason",
        "Why items came back",
        returnReasons.length === 0,
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={returnReasons}>
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              className="stroke-slate-200 dark:stroke-slate-800"
            />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="value" name="Returns" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>,
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// API Health
// ─────────────────────────────────────────────────────────────────────────────

const EVENT_LABEL: Record<string, string> = {
  CREATE_ORDER: "New order received",
  UPDATE_ORDER: "Order update received",
  CREATE_RETURN: "Return created",
  UPDATE_RETURN: "Return updated",
  FAILURE_INVENTORY: "Stock update rejected",
  DOWNLOAD_INVOICE: "Invoice requested",
};

function ApiHealthSection({ events, loading }: { events: EventRow[]; loading: boolean }) {
  return (
    <div>
      <div className={card}>
        <div className="border-b border-slate-100 p-4 dark:border-slate-800">
          <h2 className="font-bold text-slate-900 dark:text-slate-100">
            Recent Updates from Myntra
          </h2>
          <p className="text-xs text-slate-500">
            Orders, order updates and returns Myntra sent to WhizUnik
          </p>
        </div>
        <TableContainer className="border-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Received</TableHead>
                <TableHead>Update</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" />
                  </TableCell>
                </TableRow>
              ) : events.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3}>
                    <EmptyState
                      title="No updates yet"
                      subtitle="Myntra has not sent any orders or returns yet."
                      icon={<ShieldCheck className="h-8 w-8 text-slate-300" />}
                    />
                  </TableCell>
                </TableRow>
              ) : (
                events.slice(0, 50).map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {when(e.receivedAt)}
                    </TableCell>
                    <TableCell className="text-sm">{EVENT_LABEL[e.event] ?? e.event}</TableCell>
                    <TableCell>
                      {e.responseStatus < 300 ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                          <CheckCircle className="h-3.5 w-3.5" /> Processed
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-rose-700">
                          <XCircle className="h-3.5 w-3.5" />{" "}
                          {e.authorized
                            ? `Failed (${e.responseStatus})`
                            : "Rejected – not authorised"}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </div>
    </div>
  );
}
