import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  Loader2,
  Package,
  RefreshCw,
  Search,
  ShoppingBag,
  Truck,
  Warehouse,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { endOfDay, format, startOfDay, subDays } from "date-fns";
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

// ─────────────────────────────────────────────────────────────────────────────
// Types (camelCase after camelizeResponse)
// ─────────────────────────────────────────────────────────────────────────────

export type ChannelKey = "shopify" | "ajio";
type Stage = "New" | "Processing" | "Shipped" | "Delivered" | "Cancelled" | "Returned";

interface OrderItem {
  sku: string;
  title: string;
  quantity: number;
  amount: number;
}
interface ChannelOrder {
  orderId: string;
  orderNumber: string;
  orderDate: string;
  stage: Stage;
  rawStatus: string;
  paymentStatus?: string | null;
  paymentMethod?: string | null;
  currency: string;
  value: number;
  refundedAmount: number;
  items: OrderItem[];
  city?: string | null;
  state?: string | null;
  courier?: string | null;
  trackingNumber?: string | null;
}
interface ChannelInventory {
  itemId: string;
  sku: string;
  title: string;
  location: string;
  quantity: number | null;
  price?: number | null;
  active: boolean;
  updatedAt: string;
}
interface ChannelReturn {
  returnId: string;
  orderId: string;
  orderNumber: string;
  type: string;
  status: string;
  reason?: string | null;
  amount: number;
  createdAt: string;
}
interface ChannelStatus {
  connected: boolean;
  account: string | null;
  canSync: boolean;
  notConnectedMessage: string;
  syncing: boolean;
  lastSyncAt: string | null;
  lastSyncOk: boolean | null;
  lastSyncMessage: string | null;
}
interface DashboardData {
  status: ChannelStatus;
  orders: ChannelOrder[];
  inventory: ChannelInventory[];
  returns: ChannelReturn[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const STAGES: Stage[] = ["New", "Processing", "Shipped", "Delivered", "Cancelled", "Returned"];
const STAGE_COLOR: Record<Stage, string> = {
  New: "#f59e0b",
  Processing: "#0ea5e9",
  Shipped: "#2563eb",
  Delivered: "#10b981",
  Cancelled: "#94a3b8",
  Returned: "#8b5cf6",
};
const LOW_STOCK = 5;
const PALETTE = [
  "#6366f1",
  "#ec4899",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#f43f5e",
  "#14b8a6",
];

const RANGES = [
  { label: "Today", days: 0 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "All time", days: -1 },
] as const;

function inRange(iso: string, label: string) {
  const r = RANGES.find((x) => x.label === label);
  if (!r || r.days < 0) return true;
  const d = new Date(iso);
  const from = r.days === 0 ? startOfDay(new Date()) : startOfDay(subDays(new Date(), r.days));
  return d >= from && d <= endOfDay(new Date());
}

const money = (n: number, currency = "INR") =>
  n.toLocaleString("en-IN", { style: "currency", currency, maximumFractionDigits: 0 });
const when = (iso?: string | null) => (iso ? format(new Date(iso), "d MMM, h:mm a") : "—");
const units = (o: ChannelOrder) => o.items.reduce((n, i) => n + (Number(i.quantity) || 0), 0);
const counted = (o: ChannelOrder) => o.stage !== "Cancelled";

const card =
  "rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900";
const tabClass =
  "inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors data-[state=active]:bg-slate-100 dark:data-[state=active]:bg-slate-800 data-[state=active]:font-semibold data-[state=active]:text-slate-900 dark:data-[state=active]:text-slate-100";

function StagePill({ stage }: { stage: Stage }) {
  const c = STAGE_COLOR[stage];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{ borderColor: `${c}55`, color: c, background: `${c}12` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
      {stage}
    </span>
  );
}

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

type Tone = "amber" | "sky" | "blue" | "emerald" | "slate" | "violet" | "rose";
const TONES: Record<Tone, string> = {
  amber:
    "bg-amber-50/70 border-amber-200/60 text-amber-700 dark:bg-amber-950/20 dark:border-amber-900/40 dark:text-amber-400",
  sky: "bg-sky-50/70 border-sky-200/60 text-sky-700 dark:bg-sky-950/20 dark:border-sky-900/40 dark:text-sky-400",
  blue: "bg-blue-50/70 border-blue-200/60 text-blue-700 dark:bg-blue-950/20 dark:border-blue-900/40 dark:text-blue-400",
  emerald:
    "bg-emerald-50/70 border-emerald-200/60 text-emerald-700 dark:bg-emerald-950/20 dark:border-emerald-900/40 dark:text-emerald-400",
  slate:
    "bg-slate-50 border-slate-200 text-slate-600 dark:bg-slate-800/40 dark:border-slate-800 dark:text-slate-400",
  violet:
    "bg-violet-50/70 border-violet-200/60 text-violet-700 dark:bg-violet-950/20 dark:border-violet-900/40 dark:text-violet-400",
  rose: "bg-rose-50/70 border-rose-200/60 text-rose-700 dark:bg-rose-950/20 dark:border-rose-900/40 dark:text-rose-400",
};

function Tile({
  label,
  value,
  hint,
  tone,
  icon,
}: {
  label: string;
  value: number;
  hint: string;
  tone: Tone;
  icon: ReactNode;
}) {
  return (
    <div className={cn("rounded-xl border p-3", TONES[tone])}>
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

function ChartCard({
  title,
  sub,
  empty,
  children,
  wide,
}: {
  title: string;
  sub: string;
  empty: boolean;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={cn(card, "p-6", wide && "lg:col-span-2")}>
      <h2 className="font-bold text-slate-900 dark:text-slate-100">{title}</h2>
      <p className="mt-0.5 text-xs text-slate-500">{sub}</p>
      <div className="mt-4 h-64 w-full">
        {empty ? (
          <EmptyState
            title="No data yet"
            subtitle="Appears once orders arrive."
            icon={<BarChart2 className="h-8 w-8 text-slate-300" />}
          />
        ) : (
          children
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────────────────────

export function ChannelDashboard({
  channel,
  title,
  accent,
}: {
  channel: ChannelKey;
  title: string;
  accent: string;
}) {
  const qc = useQueryClient();
  const [range, setRange] = useState<string>("Last 30 days");
  const [tab, setTab] = useState("overview");

  const q = useQuery<DashboardData>({
    queryKey: ["channel", channel],
    queryFn: () => api.channels.dashboard(channel),
    refetchInterval: (query) => (query.state.data?.status?.syncing ? 3000 : false),
  });
  const sync = useMutation({
    mutationFn: () => api.channels.sync(channel),
    onSuccess: () => {
      toast.success("Sync started");
      qc.invalidateQueries({ queryKey: ["channel", channel] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const status = q.data?.status;
  const orders = useMemo(
    () => (q.data?.orders ?? []).filter((o) => inRange(o.orderDate, range)),
    [q.data, range],
  );
  const returns = useMemo(
    () => (q.data?.returns ?? []).filter((r) => inRange(r.createdAt, range)),
    [q.data, range],
  );
  const inventory = useMemo(() => q.data?.inventory ?? [], [q.data]);
  const syncing = Boolean(status?.syncing) || sync.isPending;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 p-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              {title}
            </h1>
            {status?.canSync ? (
              <Button
                size="sm"
                className="h-8 px-3.5 text-xs"
                disabled={syncing}
                onClick={() => sync.mutate()}
                style={{ background: accent }}
              >
                <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", syncing && "animate-spin")} />
                {syncing ? "Syncing…" : "Sync Now"}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-3.5 text-xs"
                disabled={q.isFetching}
                onClick={() => qc.invalidateQueries({ queryKey: ["channel", channel] })}
              >
                <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", q.isFetching && "animate-spin")} />
                Refresh Data
              </Button>
            )}
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
              {status?.lastSyncAt ? `Last synced: ${when(status.lastSyncAt)}` : "Not synced yet"}
            </div>
          </div>
        </div>
      </header>

      {status?.connected && status.lastSyncOk === false && (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-3 text-xs dark:border-rose-800/50 dark:bg-rose-900/20 sm:px-6 lg:px-8">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            <div>
              <p className="font-semibold text-rose-800 dark:text-rose-200">Last sync failed</p>
              <p className="mt-0.5 text-rose-700 dark:text-rose-300">{status.lastSyncMessage}</p>
            </div>
          </div>
        </div>
      )}

      <div className="p-4 sm:p-6 lg:p-8">
        {q.isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : q.isError ? (
          <div className={cn(card, "p-6 text-sm text-rose-700")}>
            Could not load the dashboard: {(q.error as Error).message}
          </div>
        ) : (
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
            </TabsList>
            <TabsContent value="overview" className="space-y-6 border-none p-0">
              <Overview
                orders={orders}
                returns={returns}
                inventory={inventory}
                accent={accent}
                onOpen={setTab}
              />
            </TabsContent>
            <TabsContent value="orders" className="border-none p-0">
              <OrdersSection orders={orders} connected={Boolean(status?.connected)} />
            </TabsContent>
            <TabsContent value="inventory" className="border-none p-0">
              <InventorySection rows={inventory} />
            </TabsContent>
            <TabsContent value="returns" className="border-none p-0">
              <ReturnsSection rows={returns} />
            </TabsContent>
            <TabsContent value="analytics" className="border-none p-0">
              <AnalyticsSection orders={orders} returns={returns} accent={accent} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────

function Overview({
  orders,
  returns,
  inventory,
  accent,
  onOpen,
}: {
  orders: ChannelOrder[];
  returns: ChannelReturn[];
  inventory: ChannelInventory[];
  accent: string;
  onOpen: (tab: string) => void;
}) {
  const stages = useMemo(() => {
    const c = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
    orders.forEach((o) => c[o.stage]++);
    return c;
  }, [orders]);
  const live = orders.filter(counted);
  const currency = orders[0]?.currency ?? "INR";
  const revenue = live.reduce((n, o) => n + o.value, 0);
  const unitsSold = live.reduce((n, o) => n + units(o), 0);
  const today = live.filter((o) => inRange(o.orderDate, "Today"));
  const totalStock = inventory.reduce((n, r) => n + Math.max(0, r.quantity ?? 0), 0);
  const low = inventory.filter(
    (r) => (r.quantity ?? 0) > 0 && (r.quantity ?? 0) <= LOW_STOCK,
  ).length;
  const out = inventory.filter((r) => (r.quantity ?? 0) <= 0).length;
  const refunded = returns.reduce((n, r) => n + r.amount, 0);

  const trend = useMemo(() => {
    const m = new Map<number, { key: number; date: string; revenue: number; orders: number }>();
    for (const o of live) {
      const d = startOfDay(new Date(o.orderDate));
      const row = m.get(d.getTime()) ?? {
        key: d.getTime(),
        date: format(d, "d MMM"),
        revenue: 0,
        orders: 0,
      };
      row.revenue += o.value;
      row.orders += 1;
      m.set(d.getTime(), row);
    }
    return [...m.values()].sort((a, b) => a.key - b.key);
  }, [live]);
  const pie = STAGES.filter((s) => stages[s] > 0).map((s) => ({ name: s, value: stages[s] }));

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Total Revenue"
          value={money(revenue, currency)}
          subtitle={
            today.length
              ? `Today: ${money(
                  today.reduce((n, o) => n + o.value, 0),
                  currency,
                )}`
              : "Order value in range"
          }
          icon={<Banknote className="h-4 w-4" />}
          color={accent}
          onClick={() => onOpen("orders")}
        />
        <KpiCard
          title="Total Orders"
          value={orders.length.toLocaleString()}
          subtitle={today.length ? `${today.length} placed today` : `${stages.New} new`}
          icon={<ShoppingBag className="h-4 w-4" />}
          color="#2563eb"
          onClick={() => onOpen("orders")}
        />
        <KpiCard
          title="Units Sold"
          value={unitsSold.toLocaleString()}
          subtitle="Excluding cancelled orders"
          icon={<Package className="h-4 w-4" />}
          color="#0891b2"
          onClick={() => onOpen("orders")}
        />
        <KpiCard
          title="Returns & Refunds"
          value={returns.length.toLocaleString()}
          subtitle={refunded ? `${money(refunded, currency)} refunded` : "In range"}
          icon={<ArrowRightLeft className="h-4 w-4" />}
          color="#8b5cf6"
          onClick={() => onOpen("returns")}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={cn(card, "p-5")}>
          <div className="mb-3.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4" style={{ color: accent }} />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Order Fulfilment Pipeline
              </h3>
            </div>
            <span className="text-xs font-medium text-slate-500">{orders.length} orders</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Tile
              label="New"
              value={stages.New}
              hint="Not yet fulfilled"
              tone="amber"
              icon={<Clock className="h-3.5 w-3.5" />}
            />
            <Tile
              label="Processing"
              value={stages.Processing}
              hint="Partly fulfilled"
              tone="sky"
              icon={<Package className="h-3.5 w-3.5" />}
            />
            <Tile
              label="Shipped"
              value={stages.Shipped}
              hint="In transit"
              tone="blue"
              icon={<Truck className="h-3.5 w-3.5" />}
            />
            <Tile
              label="Delivered"
              value={stages.Delivered}
              hint="Customer received"
              tone="emerald"
              icon={<CheckCircle className="h-3.5 w-3.5" />}
            />
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-2.5">
            <Tile
              label="Cancelled"
              value={stages.Cancelled}
              hint="Cancelled orders"
              tone="slate"
              icon={<XCircle className="h-3.5 w-3.5" />}
            />
            <Tile
              label="Returned"
              value={stages.Returned}
              hint="Fully refunded"
              tone="violet"
              icon={<ArrowRightLeft className="h-3.5 w-3.5" />}
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
              {totalStock.toLocaleString()} units
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Tile
              label="Stock"
              value={totalStock}
              hint={`${inventory.length} SKUs`}
              tone="slate"
              icon={<Warehouse className="h-3.5 w-3.5" />}
            />
            <Tile
              label="Low Stock"
              value={low}
              hint={`≤ ${LOW_STOCK} units`}
              tone="amber"
              icon={<AlertTriangle className="h-3.5 w-3.5" />}
            />
            <Tile
              label="Out of Stock"
              value={out}
              hint="Not buyable"
              tone="rose"
              icon={<XCircle className="h-3.5 w-3.5" />}
            />
            <Tile
              label="Return Rate"
              value={orders.length ? Math.round((returns.length / orders.length) * 1000) / 10 : 0}
              hint="% of orders"
              tone="violet"
              icon={<ArrowRightLeft className="h-3.5 w-3.5" />}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <ChartCard
          title="Revenue vs Orders Trend"
          sub="Daily order value and count in the selected range"
          empty={trend.length === 0}
          wide
        >
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
                stroke={accent}
                strokeWidth={2}
                dot={{ r: 3 }}
                name="Revenue"
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
        </ChartCard>
        <ChartCard
          title="Orders by Status"
          sub="Where each order is in the flow"
          empty={pie.length === 0}
        >
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
                  <Cell key={p.name} fill={STAGE_COLOR[p.name]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </>
  );
}

// ── Orders ───────────────────────────────────────────────────────────────────

function OrdersSection({ orders, connected }: { orders: ChannelOrder[]; connected: boolean }) {
  const [stage, setStage] = useState("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ChannelOrder | null>(null);
  const q = query.trim().toLowerCase();
  const shown = orders
    .filter((o) => stage === "all" || o.stage === stage)
    .filter(
      (o) =>
        !q ||
        [
          o.orderNumber,
          o.orderId,
          o.trackingNumber,
          ...o.items.map((i) => i.sku),
          ...o.items.map((i) => i.title),
        ]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
    )
    .sort((a, b) => b.orderDate.localeCompare(a.orderDate));

  return (
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 dark:border-slate-800">
        <div>
          <h2 className="font-bold text-slate-900 dark:text-slate-100">Orders</h2>
          <p className="text-xs text-slate-500">{shown.length} orders</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={stage} onValueChange={setStage}>
            <SelectTrigger className="h-8 w-[150px] text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STAGES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-slate-400" />
            <Input
              className="h-8 w-56 pl-8 text-[12px]"
              placeholder="Order, AWB, SKU or product"
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
              <TableHead>Payment</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Shipment</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <EmptyState
                    title="No orders"
                    subtitle={
                      orders.length
                        ? "No orders match your filters."
                        : connected
                          ? "No orders in this period. Use Sync Now to fetch the latest."
                          : "Orders appear here once the account is connected."
                    }
                    icon={<ShoppingBag className="h-8 w-8 text-slate-300" />}
                  />
                </TableCell>
              </TableRow>
            ) : (
              shown.map((o) => (
                <TableRow key={o.orderId} className="cursor-pointer" onClick={() => setView(o)}>
                  <TableCell className="font-medium">{o.orderNumber}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {format(new Date(o.orderDate), "d MMM yyyy")}
                  </TableCell>
                  <TableCell className="max-w-[240px] text-xs">
                    {o.items.length === 0 ? (
                      "—"
                    ) : (
                      <>
                        <div className="truncate">{o.items[0].title || o.items[0].sku}</div>
                        {o.items.length > 1 && (
                          <div className="text-slate-400">+{o.items.length - 1} more</div>
                        )}
                      </>
                    )}
                  </TableCell>
                  <TableCell className="text-xs font-medium">
                    {money(o.value, o.currency)}
                  </TableCell>
                  <TableCell className="text-xs">
                    {o.paymentStatus ? o.paymentStatus.replace(/_/g, " ").toLowerCase() : "—"}
                  </TableCell>
                  <TableCell>
                    <StagePill stage={o.stage} />
                  </TableCell>
                  <TableCell className="text-xs">
                    {o.trackingNumber ? (
                      <>
                        <div>{o.courier ?? "Courier"}</div>
                        <div className="font-mono text-slate-400">{o.trackingNumber}</div>
                      </>
                    ) : (
                      <span className="text-slate-400">
                        {[o.city, o.state].filter(Boolean).join(", ") || "—"}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={!!view} onOpenChange={(v) => !v && setView(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Order {view?.orderNumber} {view && <StagePill stage={view.stage} />}
            </DialogTitle>
            <DialogDescription className="text-xs">{view?.rawStatus}</DialogDescription>
          </DialogHeader>
          {view && (
            <div className="space-y-4 text-sm">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                {(
                  [
                    ["Order date", format(new Date(view.orderDate), "d MMM yyyy, h:mm a")],
                    [
                      "Payment",
                      [view.paymentStatus, view.paymentMethod].filter(Boolean).join(" · ") || "—",
                    ],
                    ["Ship to", [view.city, view.state].filter(Boolean).join(", ") || "—"],
                    [
                      "Tracking",
                      view.trackingNumber
                        ? `${view.courier ?? ""} ${view.trackingNumber}`.trim()
                        : "—",
                    ],
                    ["Order value", money(view.value, view.currency)],
                    [
                      "Refunded",
                      view.refundedAmount ? money(view.refundedAmount, view.currency) : "—",
                    ],
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
                    <TableHead>Product</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.items.map((i, idx) => (
                    <TableRow key={`${i.sku}-${idx}`}>
                      <TableCell className="text-xs">{i.title || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{i.sku || "—"}</TableCell>
                      <TableCell>{i.quantity}</TableCell>
                      <TableCell>{money(i.amount, view.currency)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Inventory ────────────────────────────────────────────────────────────────

function InventorySection({ rows }: { rows: ChannelInventory[] }) {
  const [query, setQuery] = useState("");
  const total = rows.reduce((n, r) => n + Math.max(0, r.quantity ?? 0), 0);
  const low = rows.filter((r) => (r.quantity ?? 0) > 0 && (r.quantity ?? 0) <= LOW_STOCK).length;
  const out = rows.filter((r) => (r.quantity ?? 0) <= 0).length;
  const active = rows.filter((r) => r.active).length;
  const q = query.trim().toLowerCase();
  const shown = rows.filter(
    (r) => !q || r.sku.toLowerCase().includes(q) || r.title.toLowerCase().includes(q),
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Total Inventory Units"
          value={total.toLocaleString()}
          subtitle={`${rows.length} SKUs`}
          icon={<Warehouse className="h-4 w-4" />}
          color="#0ea5e9"
        />
        <KpiCard
          title="Active Listings"
          value={active}
          subtitle={`${rows.length - active} inactive`}
          icon={<CheckCircle className="h-4 w-4" />}
          color="#10b981"
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
          subtitle="Not buyable"
          icon={<XCircle className="h-4 w-4" />}
          color="#f43f5e"
        />
      </div>
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 dark:border-slate-800">
          <h2 className="font-bold text-slate-900 dark:text-slate-100">Stock</h2>
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-slate-400" />
            <Input
              className="h-8 w-56 pl-8 text-[12px]"
              placeholder="SKU or product"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <TableContainer className="border-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Available</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <EmptyState
                      title="No inventory"
                      subtitle="Stock appears here after a sync."
                      icon={<Warehouse className="h-8 w-8 text-slate-300" />}
                    />
                  </TableCell>
                </TableRow>
              ) : (
                shown.map((r) => {
                  const qn = r.quantity ?? 0;
                  return (
                    <TableRow key={`${r.itemId}-${r.location}`}>
                      <TableCell className="max-w-[320px] truncate text-xs">{r.title}</TableCell>
                      <TableCell className="font-mono text-xs">{r.sku || "—"}</TableCell>
                      <TableCell className="text-xs">{r.location}</TableCell>
                      <TableCell className="font-medium">{r.quantity ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        {r.price != null ? money(r.price) : "—"}
                      </TableCell>
                      <TableCell>
                        {!r.active ? (
                          <Badge variant="outline" className="border-slate-200 text-slate-500">
                            Inactive
                          </Badge>
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
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </div>
    </div>
  );
}

// ── Returns ──────────────────────────────────────────────────────────────────

function ReturnsSection({ rows }: { rows: ChannelReturn[] }) {
  const refunds = rows.filter((r) => r.type === "Refund");
  const total = refunds.reduce((n, r) => n + r.amount, 0);
  const open = rows.filter(
    (r) => !/REFUNDED|CLOSED|DECLINED|CANCELED|CANCELLED/i.test(r.status),
  ).length;
  const sorted = [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Total Cases"
          value={rows.length}
          subtitle="Returns and refunds"
          icon={<ArrowRightLeft className="h-4 w-4" />}
          color="#8b5cf6"
        />
        <KpiCard
          title="Returns"
          value={rows.length - refunds.length}
          subtitle="Return requests"
          icon={<Package className="h-4 w-4" />}
          color="#0ea5e9"
        />
        <KpiCard
          title="Refunds"
          value={refunds.length}
          subtitle={`${money(total)} refunded`}
          icon={<Banknote className="h-4 w-4" />}
          color="#ec4899"
        />
        <KpiCard
          title="Open"
          value={open}
          subtitle="Awaiting action"
          icon={<Clock className="h-4 w-4" />}
          color="#f59e0b"
        />
      </div>
      <div className={card}>
        <div className="border-b border-slate-100 p-4 dark:border-slate-800">
          <h2 className="font-bold text-slate-900 dark:text-slate-100">Returns & Refunds</h2>
        </div>
        <TableContainer className="border-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <EmptyState
                      title="No returns"
                      subtitle="No returns or refunds in this period."
                      icon={<ArrowRightLeft className="h-8 w-8 text-slate-300" />}
                    />
                  </TableCell>
                </TableRow>
              ) : (
                sorted.map((r) => (
                  <TableRow key={r.returnId}>
                    <TableCell className="font-medium">{r.orderNumber}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.type}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.status.replace(/_/g, " ").toLowerCase()}
                    </TableCell>
                    <TableCell className="max-w-[260px] truncate text-xs">
                      {r.reason ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">{r.amount ? money(r.amount) : "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-slate-500">
                      {format(new Date(r.createdAt), "d MMM yyyy")}
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

// ── Analytics ────────────────────────────────────────────────────────────────

function AnalyticsSection({
  orders,
  returns,
  accent,
}: {
  orders: ChannelOrder[];
  returns: ChannelReturn[];
  accent: string;
}) {
  const topProducts = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of orders.filter(counted))
      for (const i of o.items) {
        const k = i.sku || i.title || "?";
        m.set(k, (m.get(k) ?? 0) + (Number(i.quantity) || 0));
      }
    return [...m.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [orders]);
  const byState = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of orders) m.set(o.state || "Unknown", (m.get(o.state || "Unknown") ?? 0) + 1);
    return [...m.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [orders]);
  const byType = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of returns) m.set(r.type, (m.get(r.type) ?? 0) + 1);
    return [...m.entries()].map(([name, value]) => ({ name, value }));
  }, [returns]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <ChartCard
        title="Top Products by Units"
        sub="Best sellers in the selected range"
        empty={topProducts.length === 0}
        wide
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={topProducts} layout="vertical" margin={{ left: 20 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              horizontal={false}
              className="stroke-slate-200 dark:stroke-slate-800"
            />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={130} />
            <Tooltip />
            <Bar dataKey="value" name="Units" fill={accent} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard
        title="Orders by State"
        sub="Where orders are shipped"
        empty={byState.length === 0}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={byState}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={85}
              label
            >
              {byState.map((_, i) => (
                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Returns by Type" sub="Returns versus refunds" empty={byType.length === 0}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={byType}>
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              className="stroke-slate-200 dark:stroke-slate-800"
            />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="value" name="Cases" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
