import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  ResponsiveContainer,
  Tooltip,
  Legend,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import {
  LayoutDashboard,
  ShoppingBag,
  Warehouse,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  AlertCircle,
  CheckCircle,
  XCircle,
  Calendar,
  Filter,
  RefreshCw,
  Settings,
  Info,
  ChevronDown,
  ChevronUp,
  List as ListIcon,
  Loader2,
  Activity,
  ArrowDownToLine as ArrowDownTA,
  ArrowUpFromLine as ArrowUpTA,
  MapPin,
  ShieldCheck,
  BookOpen,
  Tag,
  Package,
  Users,
  ArrowRightLeft,
  Zap,
  Eye,
  FileCheck2,
  Search,
  RefreshCw as SyncIcon,
  Clock,
  Truck,
  Building2,
  BarChart2,
  Banknote,
} from "lucide-react";
import { toast } from "sonner";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationEllipsis,
  Skeleton,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
  DialogOverlay,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Input,
  Label,
  FormLabel,
  FormControl,
  Badge,
  KpiCard,
  StatusBadge,
  StatusPill,
  TableContainer,
  Drawer,
  DrawerContent,
  DrawerOverlay,
  DrawerClose,
  Separator,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { format, subDays, startOfDay, endOfDay, isWithinInterval, parseISO } from "date-fns";

export const Route = createFileRoute("/app/amazon-dashboard")({
  component: AmazonDashboardPage,
});

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface SyncStatusItem {
  module: string;
  status: string;
  lastSync: string | null;
  records: number;
  error: string | null;
  errorCode: string | null;
  retries: number;
}

interface AmazonOrder {
  id: string;
  amazonOrderId: string;
  orderDate: string;
  customerName?: string | null;
  customerCity?: string | null;
  amazonSku: string;
  asin?: string | null;
  productName: string;
  quantity: number;
  sellingPrice: number;
  discount: number;
  currency: string;
  fulfilmentType: string;
  amazonOrderStatus: string;
  invoiceStatus: string;
  taxInformation?: any;
  deliveryAddress?: any;
}

interface AmazonOrderItem {
  sellerSku: string;
  asin: string | null;
  productName: string | null;
  quantity: number;
  unitPrice: number;
  currency: string;
  productTax: number;
  shippingTax: number;
  promotionDiscount: number;
}

interface AmazonInventory {
  id: string;
  sellerSku: string;
  asin: string | null;
  fnsku: string | null;
  productName: string | null;
  productImage: string | null;
  fulfilmentChannel: string | null;
  availableQuantity: number;
  reservedQuantity: number;
  inboundQuantity: number;
  unfulfillableQuantity: number;
  totalQuantity: number;
  stockStatus: string;
  lastUpdated: string;
}

interface AmazonListing {
  id: string;
  sellerSku: string;
  asin: string | null;
  productTitle: string | null;
  productImage: string | null;
  productType: string | null;
  brand: string | null;
  listingStatus: string;
  fulfilmentChannel: string | null;
  price: number | null;
  currency: string;
  availableInventory: number | null;
  lastUpdated: string;
  listingIssues: string[] | null;
}

interface AmazonReturn {
  id: string;
  amazonOrderId: string;
  returnStatus: string;
  quantityReturned: number;
  quantityAccepted: number;
  quantityDamaged: number;
  returnReason: string | null;
  refundStatus: string;
  refundAmount?: number;
  createdAt: string;
}

interface KpiStat {
  title: string;
  value: number | string;
  subtitle: string;
  icon: ReactNode;
  color: string;
  trend?: { label: string; value: number; up: boolean };
}

// ─────────────────────────────────────────────────────────────────────────────
// Date helpers
// ─────────────────────────────────────────────────────────────────────────────

const RANGE_PRESETS: { label: string; days: number }[] = [
  { label: "Today", days: 0 },
  { label: "Yesterday", days: 1 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "This month", days: 0 },
  { label: "Last month", days: 0 },
  { label: "Custom range", days: -1 },
];

function parseRange(
  label: string,
  customFrom?: string,
  customTo?: string,
): { from: Date; to: Date } {
  const now = new Date();
  let from: Date;
  switch (label) {
    case "Today":
      from = startOfDay(now);
      break;
    case "Yesterday": {
      const y = subDays(now, 1);
      from = startOfDay(y);
      break;
    }
    case "Last 7 days":
      from = startOfDay(subDays(now, 6));
      break;
    case "Last 30 days":
      from = startOfDay(subDays(now, 29));
      break;
    case "Last 90 days":
      from = startOfDay(subDays(now, 89));
      break;
    case "This month":
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case "Last month": {
      const lm = subDays(now, 1);
      from = new Date(lm.getFullYear(), lm.getMonth(), 1);
      break;
    }
    default:
      from = customFrom ? parseISO(customFrom) : startOfDay(subDays(now, 29));
  }
  let to = endOfDay(now);
  if (customTo) to = endOfDay(parseISO(customTo));
  return { from, to };
}

function inRange(dateStr: string | undefined, { from, to }: { from: Date; to: Date }) {
  if (!dateStr) return false;
  const d = parseISO(dateStr);
  return isWithinInterval(d, { start: from, end: to });
}

// ─────────────────────────────────────────────────────────────────────────────
// Status badge helpers
// ─────────────────────────────────────────────────────────────────────────────

function statusColor(status: string) {
  const s = (status || "").toLowerCase();
  if (s.includes("delivered"))
    return "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800";
  if (s.includes("shipped"))
    return "bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800";
  if (s.includes("pending"))
    return "bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800";
  if (s.includes("cancel"))
    return "bg-gray-100 dark:bg-gray-950 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-800";
  if (s.includes("return"))
    return "bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800";
  return "bg-slate-100 dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-800";
}

function stockBadge(status: string) {
  const s = (status || "").toLowerCase();
  if (s === "outofstock") return "bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300";
  if (s === "lowstock") return "bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300";
  if (s === "overstocked")
    return "bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300";
  return "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300";
}

function listingStatusBadge(status: string) {
  const s = (status || "").toLowerCase();
  if (s === "active")
    return "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300";
  if (s === "inactive") return "bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-300";
  if (s === "suppressed") return "bg-rose-100 dark:bg-rose-900 text-rose-700 dark:text-rose-400";
  if (s === "incomplete")
    return "bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-400";
  if (s === "outofstock") return "bg-rose-100 dark:bg-rose-900 text-rose-700 dark:text-rose-400";
  return "bg-slate-100 dark:bg-slate-900 text-slate-500";
}

function syncStatusBadge(status: string) {
  const s = (status || "").toLowerCase();
  if (s === "synchronized")
    return "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300";
  if (s === "synchronizing")
    return "bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 animate-pulse";
  if (s === "failed") return "bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300";
  if (s === "authenticationerror" || s === "accessrestricted")
    return "bg-orange-100 dark:bg-orange-950 text-orange-800 dark:text-orange-300";
  if (s === "ratelimited")
    return "bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300";
  if (s === "notconfigured")
    return "bg-slate-100 dark:bg-slate-900 text-slate-500 dark:text-slate-400";
  if (s === "blocked")
    return "bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-400";
  return "bg-slate-100 dark:bg-slate-900 text-slate-500";
}

// ─────────────────────────────────────────────────────────────────────────────
// Skeletons
// ─────────────────────────────────────────────────────────────────────────────

function KpiSkeleton() {
  return (
    <KpiCard
      id="skeleton"
      title="—"
      subtitle="—"
      value={<span className="h-6 w-24 bg-muted/70 rounded" />}
      icon={null}
      color="#6366f1"
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export function AmazonDashboardPage() {
  const { user } = useAuth();
  const clientId = user?.id || "";
  const queryClient = useQueryClient();

  // ── Filters ──
  const [dateRangeLabel, setDateRangeLabel] = useState<
    | "Today"
    | "Yesterday"
    | "Last 7 days"
    | "Last 30 days"
    | "Last 90 days"
    | "This month"
    | "Last month"
    | "Custom range"
  >("Last 30 days");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [marketplace, setMarketplace] = useState("all");
  const [store, setStore] = useState("all");
  const [rangeFrom, setRangeFrom] = useState<Date | null>(null);
  const [rangeTo, setRangeTo] = useState<Date | null>(null);

  useEffect(() => {
    const r = parseRange(dateRangeLabel, customFrom, customTo);
    setRangeFrom(r.from);
    setRangeTo(r.to);
  }, [dateRangeLabel, customFrom, customTo]);

  const range = useMemo(() => ({ from: rangeFrom!, to: rangeTo! }), [rangeFrom, rangeTo]);

  // ── Data hooks ──
  const ordersQuery = useQuery({
    queryKey: ["amazon-orders", clientId],
    queryFn: async () => {
      const res = await api.amazonOrders.list(clientId);
      return (Array.isArray(res) ? res : []) as AmazonOrder[];
    },
    enabled: !!clientId,
  });

  const returnsQuery = useQuery({
    queryKey: ["amazon-returns", clientId],
    queryFn: async () => {
      const res = await api.amazonReturns.list(clientId);
      return (Array.isArray(res) ? res : []) as AmazonReturn[];
    },
    enabled: !!clientId,
  });

  const inventoryQuery = useQuery({
    queryKey: ["amazon-inventory", clientId],
    queryFn: async () => {
      const res = await api.amazonInventory.list(clientId, { limit: 10000 });
      return (Array.isArray(res?.items) ? res.items : []) as AmazonInventory[];
    },
    enabled: !!clientId,
  });

  const listingsQuery = useQuery({
    queryKey: ["amazon-listings", clientId],
    queryFn: async () => {
      const res = await api.amazonListings.list(clientId, { limit: 10000 });
      return (Array.isArray(res?.items) ? res.items : []) as AmazonListing[];
    },
    enabled: !!clientId,
  });

  const syncStatusQuery = useQuery({
    queryKey: ["amazon-sync-status", clientId],
    queryFn: async () => {
      const res = await api.amazonSync.status(clientId);
      return (Array.isArray(res?.syncStatus) ? res.syncStatus : []) as SyncStatusItem[];
    },
    enabled: !!clientId,
  });

  const inventoryAggQuery = useQuery({
    queryKey: ["amazon-inventory-agg", clientId],
    queryFn: async () => {
      const res = await api.amazonInventory.aggregate(clientId);
      return res;
    },
    enabled: !!clientId,
  });

  const listingsAggQuery = useQuery({
    queryKey: ["amazon-listings-agg", clientId],
    queryFn: async () => {
      const res = await api.amazonListings.aggregate(clientId);
      return res;
    },
    enabled: !!clientId,
  });

  // ── Derived data ──
  const orders = ordersQuery.data ?? [];
  const returns = returnsQuery.data ?? [];
  const inventory = inventoryQuery.data ?? [];
  const listings = listingsQuery.data ?? [];
  const syncStatuses = syncStatusQuery.data ?? [];
  const inventoryAgg = inventoryAggQuery.data ?? {};
  const listingsAgg = listingsAggQuery.data ?? {};

  const [syncing, setSyncing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setSyncing(false);
  }, []);

  const relatedReturnsForOrder = (amazonOrderId: string) =>
    returns.filter((r) => r.amazonOrderId === amazonOrderId);

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      const inMarketplace = marketplace === "all" || true; // single marketplace env
      const inRangeFlag = inRange(o.orderDate, range);
      return inRangeFlag;
    });
  }, [orders, marketplace, range]);

  const filteredInventory = useMemo(() => {
    return inventory.filter((i) => inRange(i.lastUpdated, range));
  }, [inventory, range]);

  const filteredListings = useMemo(() => listings, [listings]);

  // ── KPIs ──
  const today = startOfDay(new Date());
  const todayStart = today;
  const todayEnd = endOfDay(new Date());

  const totalOrders = filteredOrders.length;
  const todaysOrders = filteredOrders.filter((o) =>
    inRange(o.orderDate, { from: todayStart, to: todayEnd }),
  ).length;
  const pendingOrders = filteredOrders.filter(
    (o) => o.amazonOrderStatus === "Pending" || o.amazonOrderStatus === "Unshipped",
  ).length;
  const shippedOrders = filteredOrders.filter((o) => o.amazonOrderStatus === "Shipped").length;
  const deliveredOrders = filteredOrders.filter((o) => o.amazonOrderStatus === "Delivered").length;
  const cancelledOrders = filteredOrders.filter((o) => o.amazonOrderStatus === "Cancelled").length;

  const totalSales = filteredOrders.reduce((sum, o) => sum + o.sellingPrice * o.quantity, 0);
  const todaysRevenue = filteredOrders
    .filter((o) => inRange(o.orderDate, { from: todayStart, to: todayEnd }))
    .reduce((sum, o) => sum + o.sellingPrice * o.quantity, 0);
  const totalUnitsSold = filteredOrders.reduce((sum, o) => sum + o.quantity, 0);

  const totalListings = listingsAgg.totalListings ?? listings.length;
  const activeListings =
    listingsAgg.active ?? listings.filter((l) => l.listingStatus === "Active").length;
  const inactiveListings =
    listingsAgg.inactive ?? listings.filter((l) => l.listingStatus !== "Active").length;

  const totalInventoryUnits =
    inventoryAgg.totalUnits ?? inventory.reduce((s, i) => s + i.totalQuantity, 0);
  const lowStockProducts =
    inventoryAgg.lowStock ?? inventory.filter((i) => i.stockStatus === "LowStock").length;
  const outOfStockProducts =
    inventoryAgg.outOfStock ?? inventory.filter((i) => i.stockStatus === "OutOfStock").length;

  const pendingReturns = returns.filter((r) => r.returnStatus === "ReturnInitiated").length;
  const totalReturns = returns.length;
  const returnRate = totalOrders > 0 ? (totalReturns / totalOrders) * 100 : 0;

  const kpis: KpiStat[] = [
    {
      title: "Total Orders",
      value: totalOrders,
      subtitle: "Amazon orders in range",
      icon: <ShoppingBag className="w-4 h-4" />,
      color: "#0067c2",
    },
    {
      title: "Today's Orders",
      value: todaysOrders,
      subtitle: "Orders placed today",
      icon: <Calendar className="w-4 h-4" />,
      color: "#3b82f6",
    },
    {
      title: "Pending Orders",
      value: pendingOrders,
      subtitle: "Awaiting fulfilment",
      icon: <Clock className="w-4 h-4" />,
      color: "#f59e0b",
    },
    {
      title: "Shipped Orders",
      value: shippedOrders,
      subtitle: "Dispatched",
      icon: <Truck className="w-4 h-4" />,
      color: "#3b82f6",
    },
    {
      title: "Delivered Orders",
      value: deliveredOrders,
      subtitle: "Customer delivered",
      icon: <CheckCircle className="w-4 h-4" />,
      color: "#10b981",
    },
    {
      title: "Cancelled Orders",
      value: cancelledOrders,
      subtitle: "Cancelled by customer",
      icon: <XCircle className="w-4 h-4" />,
      color: "#6b7280",
    },
    {
      title: "Total Sales",
      value: totalSales.toLocaleString("en-IN", { style: "currency", currency: "INR" }),
      subtitle: "Gross order value",
      icon: <Banknote className="w-4 h-4" />,
      color: "#0067c2",
    },
    {
      title: "Today's Revenue",
      value: todaysRevenue.toLocaleString("en-IN", { style: "currency", currency: "INR" }),
      subtitle: "Revenue today",
      icon: <DollarSign className="w-4 h-4" />,
      color: "#10b981",
    },
    {
      title: "Total Units Sold",
      value: totalUnitsSold,
      subtitle: "Units across orders",
      icon: <Package className="w-4 h-4" />,
      color: "#3b82f6",
    },
    {
      title: "Total Active Listings",
      value: activeListings,
      subtitle: "Buyable listings",
      icon: <ShieldCheck className="w-4 h-4" />,
      color: "#10b981",
    },
    {
      title: "Inactive Listings",
      value: inactiveListings,
      subtitle: "Non-active listings",
      icon: <ArchiveIcon className="w-4 h-4" />,
      color: "#6b7280",
    },
    {
      title: "Total Inventory Units",
      value: totalInventoryUnits,
      subtitle: "On-hand + inbound",
      icon: <Warehouse className="w-4 h-4" />,
      color: "#3b82f6",
    },
    {
      title: "Low Stock Products",
      value: lowStockProducts,
      subtitle: "Needs replenishment",
      icon: <AlertTriangle className="w-4 h-4" />,
      color: "#f59e0b",
    },
    {
      title: "Out of Stock Products",
      value: outOfStockProducts,
      subtitle: "Not buyable",
      icon: <XCircle className="w-4 h-4" />,
      color: "#dc2626",
    },
    {
      title: "Pending Returns",
      value: pendingReturns,
      subtitle: "Return cases open",
      icon: <ArrowRightLeft className="w-4 h-4" />,
      color: "#f59e0b",
    },
    {
      title: "Return Rate",
      value: returnRate.toFixed(1) + "%",
      subtitle: "Returns / orders",
      icon: <AlertCircle className="w-4 h-4" />,
      color: "#dc2626",
    },
  ];

  // ── Sync mutation ──
  const syncMutation = useMutation({
    mutationFn: async (data: { module?: string }) => {
      const traceId = `fe-sync-${Date.now().toString(36)}`;
      if (import.meta.env.DEV || process.env.AMAZON_DEBUG === "true") {
        console.debug(`[Amazon-Debug] sync.trigger module=${data.module ?? "all"} traceId=${traceId}`);
      }
      const res = await api.amazonSync.trigger({ ...data, traceId });
      if (import.meta.env.DEV || process.env.AMAZON_DEBUG === "true") {
        console.debug(`[Amazon-Debug] sync.trigger accepted traceId=${res?.traceId ?? traceId}`);
      }
      return res;
    },
    onSuccess: (res: any) => {
      const traceId = res?.traceId;
      if (import.meta.env.DEV || process.env.AMAZON_DEBUG === "true") {
        console.debug(`[Amazon-Debug] sync.started traceId=${traceId}`);
      }
      setSyncing(true);
      pollRef.current = setInterval(async () => {
        await queryClient.refetchQueries({ queryKey: ["amazon-sync-status", clientId] });
        const latest = syncStatusQuery.data ?? [];
        const syncingMod = latest.some((s) => s.status === "Synchronizing");
        if (import.meta.env.DEV || process.env.AMAZON_DEBUG === "true") {
          console.debug(
            `[Amazon-Debug] sync.poll modules=${latest.length} syncing=${syncingMod} traceId=${traceId}`,
            latest.map((s: any) => ({ module: s.module, status: s.status, records: s.records })),
          );
        }
        if (!syncingMod || latest.length === 0) {
          stopPolling();
          queryClient.invalidateQueries({ queryKey: ["amazon-orders", clientId] });
          queryClient.invalidateQueries({ queryKey: ["amazon-inventory", clientId] });
          queryClient.invalidateQueries({ queryKey: ["amazon-listings", clientId] });
          queryClient.invalidateQueries({ queryKey: ["amazon-returns", clientId] });
          const failed = latest.some(
            (s: any) => s.status === "Failed" || s.status === "AuthenticationError" || s.status === "AccessRestricted",
          );
          const allDone = latest.length > 0 && !syncingMod;
          if (import.meta.env.DEV || process.env.AMAZON_DEBUG === "true") {
            console.debug(`[Amazon-Debug] sync.done traceId=${traceId} allDone=${allDone} failed=${failed}`, latest);
          }
          if (allDone && !failed) {
            toast.success("Amazon synchronization completed");
          } else if (allDone && failed) {
            toast.error("Sync completed with errors — see API Health for details");
          }
        }
      }, 2000);
    },
    onError: (err: any) => {
      stopPolling();
      if (import.meta.env.DEV || process.env.AMAZON_DEBUG === "true") {
        console.debug(`[Amazon-Debug] sync.error ${err?.message ?? "unknown error"}`);
      }
      toast.error(`Sync failed to start: ${err?.message || "unknown error"}`);
    },
  });

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [pollRef]);

  // ── Orders detail drawer ──
  const [openOrder, setOpenOrder] = useState<AmazonOrder | null>(null);
  const [orderItems, setOrderItems] = useState<AmazonOrderItem[]>([]);
  const [orderItemsLoading, setOrderItemsLoading] = useState(false);
  const [openListing, setOpenListing] = useState<AmazonListing | null>(null);
  const [openReturn, setOpenReturn] = useState<AmazonReturn | null>(null);

  const viewOrder = async (order: AmazonOrder) => {
    setOpenOrder(order);
    setOrderItems([]);
    setOrderItemsLoading(true);
    try {
      const res = await api.amazonOrderItems.byOrder(order.amazonOrderId);
      setOrderItems((Array.isArray(res?.items) ? res.items : []) as AmazonOrderItem[]);
    } catch (err: any) {
      toast.error(`Could not load order items: ${err?.message || "unknown"}`);
    } finally {
      setOrderItemsLoading(false);
    }
  };

  // ── Pagination for orders table ──
  const [ordersPage, setOrdersPage] = useState(1);
  const ORDERS_PAGE_SIZE = 20;

  const loading =
    ordersQuery.isLoading ||
    inventoryQuery.isLoading ||
    listingsQuery.isLoading ||
    syncStatusQuery.isLoading;
  const hasOrders = orders.length > 0;
  const hasInventory = inventory.length > 0;
  const hasListings = listings.length > 0;

  const anyFailed = syncStatuses.some(
    (s) =>
      s.status === "Failed" ||
      s.status === "AuthenticationError" ||
      s.status === "AccessRestricted",
  );
  const syncStatusText =
    syncStatuses.length === 0
      ? "Not Configured"
      : syncStatuses.every((s) => s.status === "Synchronized")
        ? "Synchronized"
        : "Syncing";

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Header */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-20">
        <div className="flex flex-col gap-3 p-4 sm:p-6 lg:p-8">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                Amazon Seller Central
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Production SP-API dashboard · {syncStatusText}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant={syncStatusText === "Synchronized" ? "default" : "destructive"}
                className="text-[11px] px-2 py-1.5"
              >
                {syncStatusText === "Synchronized" ? (
                  <CheckCircle className="w-3 h-3 mr-1" />
                ) : (
                  <AlertCircle className="w-3 h-3 mr-1" />
                )}
                {syncStatusText}
              </Badge>
              <Button
                size="sm"
                onClick={() => syncMutation.mutate({ module: "all" })}
                disabled={syncing}
                className="text-[12px] px-3"
              >
                <SyncIcon className="w-3 h-3 mr-2 animate-{syncing ? 'spin' : ''}" />
                {syncing ? "Syncing…" : "Refresh Data"}
              </Button>
            </div>
          </div>

          {/* Filters */}
          <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <Calendar className="w-3.5 h-3.5" />
                <Select value={dateRangeLabel} onValueChange={(v) => setDateRangeLabel(v as any)}>
                  <SelectTrigger className="text-[12px] h-8 w-full min-w-[140px]">
                    <SelectValue placeholder="Date range" />
                  </SelectTrigger>
                  <SelectContent>
                    {RANGE_PRESETS.map((p) => (
                      <SelectItem key={p.label} value={p.label as any}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {dateRangeLabel === "Custom range" && (
                  <div className="flex gap-1 mt-1">
                    <Input
                      type="date"
                      value={customFrom}
                      onChange={(e) => setCustomFrom(e.target.value)}
                      className="text-[12px] h-8 flex-1"
                    />
                    <Input
                      type="date"
                      value={customTo}
                      onChange={(e) => setCustomTo(e.target.value)}
                      className="text-[12px] h-8 flex-1"
                    />
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <MapPin className="w-3.5 h-3.5" />
                <Select value={marketplace} onValueChange={setMarketplace}>
                  <SelectTrigger className="text-[12px] h-8 w-full min-w-[140px]">
                    <SelectValue placeholder="Marketplace" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Marketplaces</SelectItem>
                    <SelectItem value="amazon.in">Amazon.in (A21TJRUUN4KGV)</SelectItem>
                    <SelectItem value="amazon.com">Amazon.com</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <Building2 className="w-3.5 h-3.5" />
                <Select value={store} onValueChange={setStore}>
                  <SelectTrigger className="text-[12px] h-8 w-full min-w-[140px]">
                    <SelectValue placeholder="Store / Account" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Accounts</SelectItem>
                    <SelectItem value="adventra">Adventra Sports (Amazon.in)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500 justify-end">
                <Clock className="w-3 h-3 mr-1" />
                <span id="last-sync-timestamp">
                  Last sync:{" "}
                  {syncStatuses.length
                    ? new Date(
                        Math.max(
                          0,
                          ...syncStatuses.map((s) =>
                            s.lastSync ? new Date(s.lastSync).getTime() : 0,
                          ),
                        ),
                      ).toISOString()
                    : "Never"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="p-4 sm:p-6 lg:p-8">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {[...Array(16)].map((_, i) => (
              <KpiSkeleton key={i} />
            ))}
          </div>
        ) : (
          <Tabs defaultValue="overview" className="border-none">
            <TabsList className="flex w-full flex-wrap gap-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-1 mb-6">
              <TabsTrigger
                value="overview"
                className="flex flex-col items-center gap-1 px-3 py-2.5 text-xs font-medium transition-colors data-[state=active]:bg-slate-100 dark:data-[state=active]:bg-slate-800/50 min-w-[60px]"
              >
                <BarChart2 className="w-4 h-4 mb-1" /> Overview
              </TabsTrigger>
              <TabsTrigger
                value="orders"
                className="flex flex-col items-center gap-1 px-3 py-2.5 text-xs font-medium transition-colors data-[state=active]:bg-slate-100 dark:data-[state=active]:bg-slate-800/50 min-w-[60px]"
              >
                <ShoppingBag className="w-4 h-4 mb-1" /> Orders
              </TabsTrigger>
              <TabsTrigger
                value="inventory"
                className="flex flex-col items-center gap-1 px-3 py-2.5 text-xs font-medium transition-colors data-[state=active]:bg-slate-100 dark:data-[state=active]:bg-slate-800/50 min-w-[60px]"
              >
                <Warehouse className="w-4 h-4 mb-1" /> Inventory
              </TabsTrigger>
              <TabsTrigger
                value="listings"
                className="flex flex-col items-center gap-1 px-3 py-2.5 text-xs font-medium transition-colors data-[state=active]:bg-slate-100 dark:data-[state=active]:bg-slate-800/50 min-w-[60px]"
              >
                <Package className="w-4 h-4 mb-1" /> Listings
              </TabsTrigger>
              <TabsTrigger
                value="returns"
                className="flex flex-col items-center gap-1 px-3 py-2.5 text-xs font-medium transition-colors data-[state=active]:bg-slate-100 dark:data-[state=active]:bg-slate-800/50 min-w-[60px]"
              >
                <ArrowRightLeft className="w-4 h-4 mb-1" /> Returns
              </TabsTrigger>
              <TabsTrigger
                value="analytics"
                className="flex flex-col items-center gap-1 px-3 py-2.5 text-xs font-medium transition-colors data-[state=active]:bg-slate-100 dark:data-[state=active]:bg-slate-800/50 min-w-[60px]"
              >
                <BarChart2 className="w-4 h-4 mb-1" /> Analytics
              </TabsTrigger>
              <TabsTrigger
                value="api-health"
                className="flex flex-col items-center gap-1 px-3 py-2.5 text-xs font-medium transition-colors data-[state=active]:bg-slate-100 dark:data-[state=active]:bg-slate-800/50 min-w-[60px]"
              >
                <ShieldCheck className="w-4 h-4 mb-1" /> API Health
              </TabsTrigger>
            </TabsList>

            {/* ── Overview Tab ── */}
            <TabsContent value="overview" className="border-none p-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 mb-6">
                {kpis.map((k) => (
                  <KpiCard
                    key={k.title}
                    id={`kpi-${k.title.toLowerCase().replace(/\s+/g, "-")}`}
                    title={k.title}
                    subtitle={k.subtitle}
                    value={k.value}
                    icon={k.icon}
                    color={k.color}
                  />
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-bold text-slate-900 dark:text-slate-100">
                      Revenue vs Orders
                    </h2>
                  </div>
                  <div className="h-64 w-full">
                    <LineChart data={aggregateDaily(filteredOrders)} height={300}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        className="stroke-slate-200 dark:stroke-slate-800"
                      />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                      <YAxis
                        tickFormatter={(v) => `₹${Math.round(v)}`}
                        tick={{ fontSize: 11 }}
                        width={50}
                      />
                      <Tooltip />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="revenue"
                        stroke="#0067c2"
                        strokeWidth={2}
                        dot={{ fill: "#0067c2" }}
                        name="Revenue"
                      />
                      <Bar
                        dataKey="orders"
                        stackId="a"
                        fill="#2563eb"
                        opacity={0.2}
                        name="Orders"
                      />
                    </LineChart>
                  </div>
                </div>
                <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-bold text-slate-900 dark:text-slate-100">
                      Orders by Status
                    </h2>
                  </div>
                  <div className="h-64 w-full">
                    <PieChart>
                      <Pie
                        data={orderStatusPie(filteredOrders)}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={90}
                        fill="#8884d8"
                        dataKey="value"
                        nameKey="name"
                        label
                      >
                        {orderStatusPie(filteredOrders).map((entry, idx) => (
                          <Cell key={`cell-${idx}`} fill={statusColor(entry.name)} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* ── Orders Tab ── */}
            <TabsContent value="orders" className="border-none p-0">
              <OrdersSection
                orders={filteredOrders}
                setOrdersPage={setOrdersPage}
                ordersPage={ordersPage}
                viewOrder={viewOrder}
                loading={ordersQuery.isLoading}
              />
            </TabsContent>

            {/* ── Inventory Tab ── */}
            <TabsContent value="inventory" className="border-none p-0">
              <InventorySection
                items={filteredInventory}
                agg={inventoryAgg}
                loading={inventoryQuery.isLoading}
              />
            </TabsContent>

            {/* ── Listings Tab ── */}
            <TabsContent value="listings" className="border-none p-0">
              <ListingsSection
                items={filteredListings}
                agg={listingsAgg}
                loading={listingsQuery.isLoading}
                onViewListing={setOpenListing}
              />
            </TabsContent>

            {/* ── Returns Tab ── */}
            <TabsContent value="returns" className="border-none p-0">
              <ReturnsSection
                returns={returns}
                loading={returnsQuery.isLoading}
                onViewReturn={setOpenReturn}
              />
            </TabsContent>

            {/* ── Analytics Tab ── */}
            <TabsContent value="analytics" className="border-none p-0">
              <AnalyticsSection
                orders={filteredOrders}
                inventory={inventory}
                listings={listings}
                returns={returns}
                range={range}
              />
            </TabsContent>

            {/* ── API Health Tab ── */}
            <TabsContent value="api-health" className="border-none p-0">
              <ApiHealthSection
                statuses={syncStatuses}
                onRetryAll={() => syncMutation.mutate({ module: "all" })}
              />
            </TabsContent>
          </Tabs>
        )}
      </div>

      {/* Order detail drawer */}
      {openOrder && (
        <Drawer
          modal
          open={!!openOrder}
          onOpenChange={(o) => {
            if (!o) setOpenOrder(null);
          }}
        >
          <DrawerOverlay />
          <DrawerContent className="h-[90vh]">
            <DrawerClose />
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-slate-900 dark:text-slate-100">
                  Order {openOrder.amazonOrderId}
                </h2>
                <Button variant="outline" size="sm" onClick={() => setOpenOrder(null)}>
                  Close
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div className="space-y-3">
                  <p className="text-xs font-medium text-slate-500">Order Date</p>
                  <p className="text-slate-900 dark:text-slate-100">{openOrder.orderDate}</p>
                  <p className="text-xs font-medium text-slate-500">Status</p>
                  <span
                    className={`inline-block px-2 py-1 rounded text-xs font-medium ${statusColor(openOrder.amazonOrderStatus)}`}
                  >
                    {openOrder.amazonOrderStatus}
                  </span>
                  <p className="text-xs font-medium text-slate-500">Fulfilment</p>
                  <p className="text-slate-900 dark:text-slate-100">{openOrder.fulfilmentType}</p>
                  <p className="text-xs font-medium text-slate-500">Customer</p>
                  <p className="text-slate-900 dark:text-slate-100">
                    {openOrder.customerName || "Amazon Customer"}
                  </p>
                  <p className="text-xs font-medium text-slate-500">City</p>
                  <p className="text-slate-900 dark:text-slate-100">
                    {openOrder.customerCity || "—"}
                  </p>
                </div>
                <div className="space-y-3">
                  <p className="text-xs font-medium text-slate-500">Order Amount</p>
                  <p className="text-slate-900 dark:text-slate-100 font-mono">
                    {openOrder.currency || "INR"} {openOrder.sellingPrice.toLocaleString()}
                  </p>
                  <p className="text-xs font-medium text-slate-500">Quantity</p>
                  <p className="text-slate-900 dark:text-slate-100">{openOrder.quantity}</p>
                  <p className="text-xs font-medium text-slate-500">SKU</p>
                  <p className="text-slate-900 dark:text-slate-100 font-mono">
                    {openOrder.amazonSku}
                  </p>
                  <p className="text-xs font-medium text-slate-500">Invoice Status</p>
                  <span
                    className={`inline-block px-2 py-1 rounded text-xs font-medium ${statusColor(openOrder.invoiceStatus)}`}
                  >
                    {openOrder.invoiceStatus}
                  </span>
                </div>
              </div>
              <Separator />
              <h3 className="font-bold text-slate-900 dark:text-slate-100 mb-2 mt-4">
                Order Items
              </h3>
              {orderItemsLoading ? (
                <div className="h-40 flex items-center justify-center">
                  <Loader2 className="w-6 h-6" />
                </div>
              ) : orderItems.length === 0 ? (
                <p className="text-slate-500 dark:text-slate-400">No order items available.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg">
                    <thead className="bg-slate-50 dark:bg-slate-800/50">
                      <tr>
                        <th className="p-3 text-left text-slate-500 font-medium">SKU</th>
                        <th className="p-3 text-left text-slate-500 font-medium">ASIN</th>
                        <th className="p-3 text-left text-slate-500 font-medium">Product</th>
                        <th className="p-3 text-left text-slate-500 font-medium">Qty</th>
                        <th className="p-3 text-left text-slate-500 font-medium">Unit Price</th>
                        <th className="p-3 text-left text-slate-500 font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderItems.map((item) => (
                        <tr
                          key={`${item.sellerSku}-${item.asin}`}
                          className="border-b border-slate-100 dark:border-slate-800 last:border-0"
                        >
                          <td className="p-3 font-mono text-sm">{item.sellerSku}</td>
                          <td className="p-3 font-mono text-sm">{item.asin || "—"}</td>
                          <td className="p-3 text-sm">{item.productName || "—"}</td>
                          <td className="p-3 text-sm">{item.quantity}</td>
                          <td className="p-3 text-sm">
                            {item.currency} {item.unitPrice}
                          </td>
                          <td className="p-3 text-sm font-medium">
                            {(item.unitPrice * item.quantity).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Related Returns */}
              <Separator className="my-4" />
              <h3 className="font-bold text-slate-900 dark:text-slate-100 mb-2">Related Returns</h3>
              {openOrder ? (
                <>
                  {relatedReturnsForOrder(openOrder.amazonOrderId).length === 0 ? (
                    <p className="text-slate-500 dark:text-slate-400 text-sm">
                      No returns associated with this order.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg">
                        <thead className="bg-slate-50 dark:bg-slate-800/50">
                          <tr>
                            <th className="p-3 text-left text-slate-500 font-medium">Return ID</th>
                            <th className="p-3 text-left text-slate-500 font-medium">Status</th>
                            <th className="p-3 text-left text-slate-500 font-medium">
                              Qty Returned
                            </th>
                            <th className="p-3 text-left text-slate-500 font-medium">
                              Refund Status
                            </th>
                            <th className="p-3 text-right text-slate-500 font-medium">Refund</th>
                          </tr>
                        </thead>
                        <tbody>
                          {relatedReturnsForOrder(openOrder.amazonOrderId).map((r) => (
                            <tr
                              key={r.id}
                              className="border-b border-slate-100 dark:border-slate-800 last:border-0"
                            >
                              <td className="p-3 font-mono text-sm">{r.amazonOrderId}</td>
                              <td className="p-3 text-sm">{r.returnStatus}</td>
                              <td className="p-3 text-sm">{r.quantityReturned}</td>
                              <td className="p-3 text-sm">{r.refundStatus}</td>
                              <td className="p-3 text-right text-sm">
                                {r.refundAmount != null ? r.refundAmount.toFixed(2) : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </DrawerContent>
        </Drawer>
      )}
      {/* Listing detail drawer */}
      {openListing && (
        <Drawer
          modal
          open={!!openListing}
          onOpenChange={(o) => {
            if (!o) setOpenListing(null);
          }}
        >
          <DrawerOverlay />
          <DrawerContent className="h-[90vh] w-[600px]">
            <DrawerClose />
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-slate-900 dark:text-slate-100">
                  Listing {openListing.sellerSku}
                </h2>
                <Button variant="outline" size="sm" onClick={() => setOpenListing(null)}>
                  Close
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div className="space-y-3">
                  <p className="text-xs font-medium text-slate-500">ASIN</p>
                  <p className="text-slate-900 dark:text-slate-100 font-mono">
                    {openListing.asin || "—"}
                  </p>
                  <p className="text-xs font-medium text-slate-500">Product Title</p>
                  <p className="text-slate-900 dark:text-slate-100">
                    {openListing.productTitle || "—"}
                  </p>
                  <p className="text-xs font-medium text-slate-500">Product Type</p>
                  <p className="text-slate-900 dark:text-slate-100">
                    {openListing.productType || "—"}
                  </p>
                  <p className="text-xs font-medium text-slate-500">Brand</p>
                  <p className="text-slate-900 dark:text-slate-100">{openListing.brand || "—"}</p>
                </div>
                <div className="space-y-3">
                  <p className="text-xs font-medium text-slate-500">Listing Status</p>
                  <span
                    className={`inline-block px-2 py-1 rounded text-xs font-bold ${listingStatusBadge(openListing.listingStatus)}`}
                  >
                    {openListing.listingStatus}
                  </span>
                  <p className="text-xs font-medium text-slate-500">Fulfilment Channel</p>
                  <p className="text-slate-900 dark:text-slate-100">
                    {openListing.fulfilmentChannel || "—"}
                  </p>
                  <p className="text-xs font-medium text-slate-500">Price</p>
                  <p className="text-slate-900 dark:text-slate-100 font-mono">
                    {openListing.currency || "INR"}{" "}
                    {openListing.price != null ? openListing.price.toFixed(2) : "—"}
                  </p>
                  <p className="text-xs font-medium text-slate-500">Available Inventory</p>
                  <p className="text-slate-900 dark:text-slate-100">
                    {openListing.availableInventory != null ? openListing.availableInventory : "—"}
                  </p>
                  <p className="text-xs font-medium text-slate-500">Last Updated</p>
                  <p className="text-slate-900 dark:text-slate-100">{openListing.lastUpdated}</p>
                </div>
              </div>
              {openListing.listingIssues && openListing.listingIssues.length > 0 && (
                <div className="mt-4 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800">
                  <h4 className="text-xs font-bold text-rose-800 dark:text-rose-400 mb-2">
                    Listing Issues
                  </h4>
                  <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1 list-disc list-inside">
                    {openListing.listingIssues.map((issue, i) => (
                      <li key={i}>{issue}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </DrawerContent>
        </Drawer>
      )}
      {/* Return detail drawer */}
      {openReturn && (
        <Drawer
          modal
          open={!!openReturn}
          onOpenChange={(o) => {
            if (!o) setOpenReturn(null);
          }}
        >
          <DrawerOverlay />
          <DrawerContent className="h-[90vh] w-[600px]">
            <DrawerClose />
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-slate-900 dark:text-slate-100">
                  Return {openReturn.amazonOrderId}
                </h2>
                <Button variant="outline" size="sm" onClick={() => setOpenReturn(null)}>
                  Close
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div className="space-y-3">
                  <p className="text-xs font-medium text-slate-500">Order ID</p>
                  <p className="text-slate-900 dark:text-slate-100 font-mono">
                    {openReturn.amazonOrderId}
                  </p>
                  <p className="text-xs font-medium text-slate-500">Return Date</p>
                  <p className="text-slate-900 dark:text-slate-100">{openReturn.createdAt}</p>
                  <p className="text-xs font-medium text-slate-500">Return Reason</p>
                  <p className="text-slate-900 dark:text-slate-100">
                    {openReturn.returnReason || "—"}
                  </p>
                  <p className="text-xs font-medium text-slate-500">Qty Returned</p>
                  <p className="text-slate-900 dark:text-slate-100">
                    {openReturn.quantityReturned}
                  </p>
                </div>
                <div className="space-y-3">
                  <p className="text-xs font-medium text-slate-500">Return Status</p>
                  <span
                    className={`inline-block px-2 py-1 rounded text-xs font-bold ${statusColor(openReturn.returnStatus)}`}
                  >
                    {openReturn.returnStatus}
                  </span>
                  <p className="text-xs font-medium text-slate-500">Refund Status</p>
                  <span
                    className={`inline-block px-2 py-1 rounded text-xs font-bold ${statusColor(openReturn.refundStatus)}`}
                  >
                    {openReturn.refundStatus}
                  </span>
                  <p className="text-xs font-medium text-slate-500">Qty Accepted</p>
                  <p className="text-slate-900 dark:text-slate-100">
                    {openReturn.quantityAccepted}
                  </p>
                  <p className="text-xs font-medium text-slate-500">Qty Damaged</p>
                  <p className="text-slate-900 dark:text-slate-100">{openReturn.quantityDamaged}</p>
                  <p className="text-xs font-medium text-slate-500">Refund Amount</p>
                  <p className="text-slate-900 dark:text-slate-100 font-mono">
                    {openReturn.refundAmount != null ? openReturn.refundAmount.toFixed(2) : "—"}
                  </p>
                </div>
              </div>
            </div>
          </DrawerContent>
        </Drawer>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function OrdersSection({
  orders,
  setOrdersPage,
  ordersPage,
  viewOrder,
  loading,
}: {
  orders: AmazonOrder[];
  setOrdersPage: (p: number) => void;
  ordersPage: number;
  viewOrder: (o: AmazonOrder) => void;
  loading: boolean;
}) {
  const PAGE = 20;
  const total = orders.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE));
  const page = Math.min(Math.max(ordersPage, 1), totalPages);
  const start = (page - 1) * PAGE;
  const pageOrders = orders.slice(start, start + PAGE);

  const statuses = [
    "Pending",
    "Unshipped",
    "PartiallyShipped",
    "Shipped",
    "Delivered",
    "Cancelled",
    "Unfulfillable",
  ];
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return pageOrders.filter((o) => {
      const matchStatus = statusFilter === "all" || o.amazonOrderStatus === statusFilter;
      const q = search.toLowerCase();
      const matchSearch =
        o.amazonOrderId.toLowerCase().includes(q) ||
        o.productName.toLowerCase().includes(q) ||
        o.amazonSku.toLowerCase().includes(q);
      return matchStatus && matchSearch;
    });
  }, [pageOrders, statusFilter, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Search className="w-4 h-4 text-slate-400" />
          <Input
            placeholder="Search order ID, SKU, product…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64 text-[12px] h-8"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="text-[12px] h-8 w-48">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {statuses.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="h-64 flex items-center justify-center">
          <Loader2 className="w-8 h-8" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<ShoppingBag className="w-8 h-8 mx-auto mb-3 opacity-40" />}
          title="No orders"
          subtitle="No Amazon orders match your filters. Sync orders to load data."
        />
      ) : (
        <TableContainer>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/50 sticky top-0 z-10">
              <tr>
                <th className="p-3 text-left text-slate-500 font-medium">Amazon Order ID</th>
                <th className="p-3 text-left text-slate-500 font-medium">Order Date</th>
                <th className="p-3 text-left text-slate-500 font-medium">Product / SKU</th>
                <th className="p-3 text-left text-slate-500 font-medium">ASIN</th>
                <th className="p-3 text-left text-slate-500 font-medium">Qty</th>
                <th className="p-3 text-right text-slate-500 font-medium">Amount</th>
                <th className="p-3 text-left text-slate-500 font-medium">Currency</th>
                <th className="p-3 text-left text-slate-500 font-medium">Fulfilment</th>
                <th className="p-3 text-left text-slate-500 font-medium">Status</th>
                <th className="p-3 text-left text-slate-500 font-medium">Marketplace</th>
                <th className="p-3 text-right text-slate-500 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
                <tr
                  key={o.id}
                  className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer group"
                  onClick={() => viewOrder(o)}
                >
                  <td className="p-3 font-mono text-sm font-medium">{o.amazonOrderId}</td>
                  <td className="p-3 text-sm">{o.orderDate}</td>
                  <td className="p-3 text-sm">{o.productName}</td>
                  <td className="p-3 font-mono text-sm">{o.asin || "—"}</td>
                  <td className="p-3 text-sm">{o.quantity}</td>
                  <td className="p-3 text-right text-sm font-medium">
                    {o.sellingPrice.toLocaleString()}
                  </td>
                  <td className="p-3 text-sm text-slate-500">{o.currency || "INR"}</td>
                  <td className="p-3 text-sm">{o.fulfilmentType}</td>
                  <td className="p-3 text-sm">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border ${statusColor(o.amazonOrderStatus)}`}
                    >
                      {o.amazonOrderStatus}
                    </span>
                  </td>
                  <td className="p-3 text-sm text-slate-500">Amazon.in</td>
                  <td className="p-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        viewOrder(o);
                      }}
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableContainer>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Showing {start + 1}-{Math.min(start + pageOrders.length, total)} of {total} orders
        </p>
        <Pagination className="flex w-auto justify-center mx-0">
          <PaginationContent>
            <PaginationPrevious onClick={() => setOrdersPage(Math.max(page - 1, 1))} />
            {[1, 2, 3].map((p) => (
              <PaginationItem key={p}>
                <PaginationLink
                  isActive={page === p}
                  onClick={() => setOrdersPage(p)}
                  aria-label={`Page ${p}`}
                >
                  {p}
                </PaginationLink>
              </PaginationItem>
            ))}
            {totalPages > 3 && <PaginationEllipsis />}
            {totalPages > 3 && (
              <PaginationItem>
                <PaginationLink
                  isActive={page === totalPages}
                  onClick={() => setOrdersPage(totalPages)}
                  aria-label={`Page ${totalPages}`}
                >
                  {totalPages}
                </PaginationLink>
              </PaginationItem>
            )}
            <PaginationNext onClick={() => setOrdersPage(Math.min(page + 1, totalPages))} />
          </PaginationContent>
        </Pagination>
      </div>
    </div>
  );
}

function InventorySection({
  items,
  agg,
  loading,
}: {
  items: AmazonInventory[];
  agg: any;
  loading: boolean;
}) {
  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");

  const filtered = useMemo(() => {
    return items.filter((i) => {
      const q = search.toLowerCase();
      const matchSearch =
        i.sellerSku.toLowerCase().includes(q) ||
        (i.productName || "").toLowerCase().includes(q) ||
        (i.asin || "").toLowerCase().includes(q);
      const matchStock = stockFilter === "all" || i.stockStatus === stockFilter;
      const matchChannel = channelFilter === "all" || i.fulfilmentChannel === channelFilter;
      return matchSearch && matchStock && matchChannel;
    });
  }, [items, search, stockFilter, channelFilter]);

  return (
    <div className="space-y-4">
      {/* Health overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-2">
        <KpiCard
          id="inv-total"
          title="Total Inventory Units"
          value={agg?.totalUnits ?? items.reduce((s, i) => s + i.totalQuantity, 0)}
          subtitle="Across all SKUs"
          icon={<Warehouse className="w-4 h-4" />}
          color="#0067c2"
        />
        <KpiCard
          id="inv-available"
          title="Available"
          value={agg?.availableUnits ?? items.reduce((s, i) => s + i.availableQuantity, 0)}
          subtitle="Sellable stock"
          icon={<ShieldCheck className="w-4 h-4" />}
          color="#10b981"
        />
        <KpiCard
          id="inv-low"
          title="Low Stock"
          value={agg?.lowStock ?? items.filter((i) => i.stockStatus === "LowStock").length}
          subtitle="Needs replenishment"
          icon={<AlertTriangle className="w-4 h-4" />}
          color="#f59e0b"
        />
        <KpiCard
          id="inv-oos"
          title="Out of Stock"
          value={agg?.outOfStock ?? items.filter((i) => i.stockStatus === "OutOfStock").length}
          subtitle="Not buyable"
          icon={<XCircle className="w-4 h-4" />}
          color="#dc2626"
        />
        <KpiCard
          id="inv-fba"
          title="FBA Units"
          value={
            agg?.fba ??
            items
              .filter((i) => i.fulfilmentChannel === "FBA")
              .reduce((s, i) => s + i.totalQuantity, 0)
          }
          subtitle="Fulfilled by Amazon"
          icon={<Building2 className="w-4 h-4" />}
          color="#3b82f6"
        />
        <KpiCard
          id="inv-fbm"
          title="FBM Units"
          value={
            agg?.fbm ??
            items
              .filter((i) => i.fulfilmentChannel === "FBM")
              .reduce((s, i) => s + i.totalQuantity, 0)
          }
          subtitle="Fulfilled by Merchant"
          icon={<Truck className="w-4 h-4" />}
          color="#3b82f6"
        />
      </div>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <Search className="w-4 h-4 text-slate-400" />
          <Input
            placeholder="Search SKU, ASIN, product name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-72 text-[12px] h-8"
          />
        </div>
        <div className="flex gap-2">
          <Select value={stockFilter} onValueChange={setStockFilter}>
            <SelectTrigger className="text-[12px] h-8 w-44">
              <SelectValue placeholder="Stock status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="InStock">In Stock</SelectItem>
              <SelectItem value="LowStock">Low Stock</SelectItem>
              <SelectItem value="OutOfStock">Out of Stock</SelectItem>
              <SelectItem value="Overstocked">Overstocked</SelectItem>
            </SelectContent>
          </Select>
          <Select value={channelFilter} onValueChange={setChannelFilter}>
            <SelectTrigger className="text-[12px] h-8 w-44">
              <SelectValue placeholder="Channel" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="FBA">FBA</SelectItem>
              <SelectItem value="FBM">FBM</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="h-64 flex items-center justify-center">
          <Loader2 className="w-8 h-8" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Package className="w-8 h-8 mx-auto mb-3 opacity-40" />}
          title="No inventory"
          subtitle="No inventory records found. Run an inventory sync."
        />
      ) : (
        <TableContainer>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/50 sticky top-0 z-10">
              <tr>
                <th className="p-3 text-left text-slate-500 font-medium">Image</th>
                <th className="p-3 text-left text-slate-500 font-medium">Product</th>
                <th className="p-3 text-left text-slate-500 font-medium">Seller SKU</th>
                <th className="p-3 text-left text-slate-500 font-medium">ASIN</th>
                <th className="p-3 text-left text-slate-500 font-medium">FNSKU</th>
                <th className="p-3 text-left text-slate-500 font-medium">Channel</th>
                <th className="p-3 text-right text-slate-500 font-medium">Available</th>
                <th className="p-3 text-right text-slate-500 font-medium">Reserved</th>
                <th className="p-3 text-right text-slate-500 font-medium">Inbound</th>
                <th className="p-3 text-right text-slate-500 font-medium">Total</th>
                <th className="p-3 text-left text-slate-500 font-medium">Status</th>
                <th className="p-3 text-left text-slate-500 font-medium">Last Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
                <tr key={i.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="p-3">
                    {i.productImage ? (
                      <img
                        src={i.productImage}
                        alt=""
                        className="w-8 h-8 rounded object-cover border border-slate-200 dark:border-slate-800"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-[10px] text-slate-500">
                        —
                      </div>
                    )}
                  </td>
                  <td className="p-3 text-sm">{i.productName || "—"}</td>
                  <td className="p-3 font-mono text-sm">{i.sellerSku}</td>
                  <td className="p-3 font-mono text-sm text-slate-500">{i.asin || "—"}</td>
                  <td className="p-3 font-mono text-xs text-slate-500">{i.fnsku || "—"}</td>
                  <td className="p-3 text-sm">{i.fulfilmentChannel || "—"}</td>
                  <td className="p-3 text-right text-sm">{i.availableQuantity}</td>
                  <td className="p-3 text-right text-sm">{i.reservedQuantity}</td>
                  <td className="p-3 text-right text-sm">{i.inboundQuantity}</td>
                  <td className="p-3 text-right text-sm font-medium">{i.totalQuantity}</td>
                  <td className="p-3 text-sm">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${stockBadge(i.stockStatus)}`}
                    >
                      {i.stockStatus}
                    </span>
                  </td>
                  <td className="p-3 text-sm text-slate-500">{i.lastUpdated}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableContainer>
      )}
    </div>
  );
}

function ListingsSection({
  items,
  agg,
  loading,
  onViewListing,
}: {
  items: AmazonListing[];
  agg: any;
  loading: boolean;
  onViewListing?: (l: AmazonListing) => void;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const filtered = useMemo(() => {
    return items.filter((l) => {
      const q = search.toLowerCase();
      const matchSearch =
        l.sellerSku.toLowerCase().includes(q) ||
        (l.productTitle || "").toLowerCase().includes(q) ||
        (l.asin || "").toLowerCase().includes(q);
      const matchStatus = statusFilter === "all" || l.listingStatus === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [items, search, statusFilter]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-2">
        <KpiCard
          id="list-total"
          title="Total Listings"
          value={agg?.totalListings ?? items.length}
          subtitle="All listings"
          icon={<Package className="w-4 h-4" />}
          color="#0067c2"
        />
        <KpiCard
          id="list-active"
          title="Active"
          value={agg?.active ?? items.filter((l) => l.listingStatus === "Active").length}
          subtitle="Buyable"
          icon={<ShieldCheck className="w-4 h-4" />}
          color="#10b981"
        />
        <KpiCard
          id="list-inactive"
          title="Inactive"
          value={agg?.inactive ?? items.filter((l) => l.listingStatus !== "Active").length}
          subtitle="Not buyable"
          icon={<ArchiveIcon className="w-4 h-4" />}
          color="#6b7280"
        />
        <KpiCard
          id="list-suppressed"
          title="Suppressed"
          value={agg?.suppressed ?? items.filter((l) => l.listingStatus === "Suppressed").length}
          subtitle="Suppressed by Amazon"
          icon={<AlertTriangle className="w-4 h-4" />}
          color="#f59e0b"
        />
      </div>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <Search className="w-4 h-4 text-slate-400" />
          <Input
            placeholder="Search SKU, ASIN, product title…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-72 text-[12px] h-8"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="text-[12px] h-8 w-48">
            <SelectValue placeholder="Listing status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="Active">Active</SelectItem>
            <SelectItem value="Inactive">Inactive</SelectItem>
            <SelectItem value="Suppressed">Suppressed</SelectItem>
            <SelectItem value="Incomplete">Incomplete</SelectItem>
            <SelectItem value="OutOfStock">Out of Stock</SelectItem>
            <SelectItem value="Error">Error</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="h-64 flex items-center justify-center">
          <Loader2 className="w-8 h-8" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="w-8 h-8 mx-auto mb-3 opacity-40" />}
          title="No listings"
          subtitle="No listings found. Run a listings sync."
        />
      ) : (
        <TableContainer>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/50 sticky top-0 z-10">
              <tr>
                <th className="p-3 text-left text-slate-500 font-medium">Image</th>
                <th className="p-3 text-left text-slate-500 font-medium">Product Title</th>
                <th className="p-3 text-left text-slate-500 font-medium">Seller SKU</th>
                <th className="p-3 text-left text-slate-500 font-medium">ASIN</th>
                <th className="p-3 text-left text-slate-500 font-medium">Product Type</th>
                <th className="p-3 text-left text-slate-500 font-medium">Brand</th>
                <th className="p-3 text-left text-slate-500 font-medium">Status</th>
                <th className="p-3 text-left text-slate-500 font-medium">Channel</th>
                <th className="p-3 text-right text-slate-500 font-medium">Price</th>
                <th className="p-3 text-right text-slate-500 font-medium">Available</th>
                <th className="p-3 text-left text-slate-500 font-medium">Last Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => (
                <tr
                  key={l.id}
                  className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer group"
                  onClick={() => onViewListing?.(l)}
                >
                  <td className="p-3">
                    {l.productImage ? (
                      <img
                        src={l.productImage}
                        alt=""
                        className="w-8 h-8 rounded object-cover border border-slate-200 dark:border-slate-800"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-[10px] text-slate-500">
                        —
                      </div>
                    )}
                  </td>
                  <td className="p-3 text-sm">{l.productTitle || "—"}</td>
                  <td className="p-3 font-mono text-sm">{l.sellerSku}</td>
                  <td className="p-3 font-mono text-sm text-slate-500">{l.asin || "—"}</td>
                  <td className="p-3 text-sm text-slate-500">{l.productType || "—"}</td>
                  <td className="p-3 text-sm text-slate-500">{l.brand || "—"}</td>
                  <td className="p-3 text-sm">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${listingStatusBadge(l.listingStatus)}`}
                    >
                      {l.listingStatus}
                    </span>
                  </td>
                  <td className="p-3 text-sm">{l.fulfilmentChannel || "—"}</td>
                  <td className="p-3 text-right text-sm">
                    {l.price != null ? l.price.toFixed(2) : "—"}
                  </td>
                  <td className="p-3 text-right text-sm">
                    {l.availableInventory != null ? l.availableInventory : "—"}
                  </td>
                  <td className="p-3 text-sm text-slate-500">{l.lastUpdated}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableContainer>
      )}
    </div>
  );
}

function ReturnsSection({
  returns,
  loading,
  onViewReturn,
}: {
  returns: AmazonReturn[];
  loading: boolean;
  onViewReturn?: (r: AmazonReturn) => void;
}) {
  const totalRefund = returns.reduce((s, r) => s + (r.refundAmount || 0), 0);
  const pending = returns.filter((r) => r.returnStatus === "ReturnInitiated").length;
  const approved = returns.filter(
    (r) => r.returnStatus === "Accepted" || r.returnStatus === "PartiallyAccepted",
  ).length;
  const completed = returns.filter(
    (r) => r.returnStatus === "RefundConfirmed" || r.returnStatus === "Completed",
  ).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-2">
        <KpiCard
          id="ret-total"
          title="Total Returns"
          value={returns.length}
          subtitle="All return cases"
          icon={<ArrowRightLeft className="w-4 h-4" />}
          color="#f59e0b"
        />
        <KpiCard
          id="ret-pending"
          title="Pending"
          value={pending}
          subtitle="Awaiting action"
          icon={<Clock className="w-4 h-4" />}
          color="#f59e0b"
        />
        <KpiCard
          id="ret-approved"
          title="Approved"
          value={approved}
          subtitle="Accepted for refund"
          icon={<CheckCircle className="w-4 h-4" />}
          color="#10b981"
        />
        <KpiCard
          id="ret-completed"
          title="Completed"
          value={completed}
          subtitle="Refund processed"
          icon={<FileCheck2 className="w-4 h-4" />}
          color="#10b981"
        />
        <KpiCard
          id="ret-refund"
          title="Total Refund"
          value={totalRefund.toLocaleString("en-IN", { style: "currency", currency: "INR" })}
          subtitle="Refunded amount"
          icon={<Banknote className="w-4 h-4" />}
          color="#dc2626"
        />
      </div>

      {loading ? (
        <div className="h-64 flex items-center justify-center">
          <Loader2 className="w-8 h-8" />
        </div>
      ) : returns.length === 0 ? (
        <EmptyState
          icon={<FileCheck2 className="w-8 h-8 mx-auto mb-3 opacity-40" />}
          title="No returns"
          subtitle="No return records found. Returns are derived from synced orders."
        />
      ) : (
        <TableContainer>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/50 sticky top-0 z-10">
              <tr>
                <th className="p-3 text-left text-slate-500 font-medium">Return / Order ID</th>
                <th className="p-3 text-left text-slate-500 font-medium">Order Date</th>
                <th className="p-3 text-left text-slate-500 font-medium">Return Date</th>
                <th className="p-3 text-left text-slate-500 font-medium">SKU</th>
                <th className="p-3 text-left text-slate-500 font-medium">Qty Returned</th>
                <th className="p-3 text-left text-slate-500 font-medium">Reason</th>
                <th className="p-3 text-left text-slate-500 font-medium">Status</th>
                <th className="p-3 text-right text-slate-500 font-medium">Refund</th>
              </tr>
            </thead>
            <tbody>
              {returns.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer group"
                  onClick={() => onViewReturn?.(r)}
                >
                  <td className="p-3 font-mono text-sm">{r.amazonOrderId}</td>
                  <td className="p-3 text-sm text-slate-500">{r.createdAt}</td>
                  <td className="p-3 text-sm text-slate-500">{r.createdAt}</td>
                  <td className="p-3 font-mono text-sm text-slate-500">—</td>
                  <td className="p-3 text-sm">{r.quantityReturned}</td>
                  <td className="p-3 text-sm">{r.returnReason || "—"}</td>
                  <td className="p-3 text-sm">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${statusColor(r.returnStatus)}`}
                    >
                      {r.returnStatus}
                    </span>
                  </td>
                  <td className="p-3 text-right text-sm font-medium">
                    {r.refundAmount != null ? r.refundAmount.toFixed(2) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableContainer>
      )}
    </div>
  );
}

function AnalyticsSection({
  orders,
  inventory,
  listings,
  returns,
  range,
}: {
  orders: AmazonOrder[];
  inventory: AmazonInventory[];
  listings: AmazonListing[];
  returns: AmazonReturn[];
  range: { from: Date; to: Date };
}) {
  // Revenue over time
  const daily = aggregateDaily(orders);
  const ordersSeries = daily.map((d) => ({ date: d.date, orders: d.count, revenue: d.revenue }));

  // Orders by status
  const statusCounts = orders.reduce(
    (acc, o) => {
      acc[o.amazonOrderStatus] = (acc[o.amazonOrderStatus] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  // Top products by units
  const productUnits = orders.reduce(
    (acc, o) => {
      acc[o.productName] = (acc[o.productName] || 0) + o.quantity;
      return acc;
    },
    {} as Record<string, number>,
  );
  const topProducts = Object.entries(productUnits)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // Inventory distribution by channel
  const fba = inventory
    .filter((i) => i.fulfilmentChannel === "FBA")
    .reduce((s, i) => s + i.totalQuantity, 0);
  const fbm = inventory
    .filter((i) => i.fulfilmentChannel === "FBM")
    .reduce((s, i) => s + i.totalQuantity, 0);

  // Returns by reason
  const reasonCounts = returns.reduce(
    (acc, r) => {
      acc[r.returnReason || "Unknown"] = (acc[r.returnReason || "Unknown"] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
        <h2 className="font-bold text-slate-900 dark:text-slate-100 mb-4">
          Revenue & Orders Over Time
        </h2>
        <div className="h-72 w-full">
          <LineChart data={ordersSeries}>
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              className="stroke-slate-200 dark:stroke-slate-800"
            />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#94a3b8" />
            <YAxis tickFormatter={(v) => `₹${Math.round(v)}`} tick={{ fontSize: 11 }} width={50} />
            <Tooltip />
            <Legend />
            <Line
              dataKey="revenue"
              stroke="#0067c2"
              strokeWidth={2}
              dot={{ fill: "#0067c2" }}
              name="Revenue"
            />
            <Line
              dataKey="orders"
              stroke="#10b981"
              strokeWidth={2}
              dot={{ fill: "#10b981" }}
              name="Orders"
            />
          </LineChart>
        </div>
      </div>

      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
        <h2 className="font-bold text-slate-900 dark:text-slate-100 mb-4">Orders by Status</h2>
        <div className="h-64 w-full">
          <PieChart>
            <Pie
              data={Object.entries(statusCounts).map(([name, value]) => ({ name, value }))}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={90}
              dataKey="value"
              nameKey="name"
              label
            >
              {Object.entries(statusCounts).map((_, idx) => (
                <Cell key={`s-${idx}`} fill={statusColor(Object.keys(statusCounts)[idx])} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </div>
      </div>

      <div className="lg:col-span-2 p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs mt-6 lg:mt-0">
        <h2 className="font-bold text-slate-900 dark:text-slate-100 mb-4">
          Top 10 Products by Units Sold
        </h2>
        <div className="h-72 w-full">
          <BarChart data={topProducts}>
            <CartesianGrid
              strokeDasharray="3 3"
              horizontal={false}
              className="stroke-slate-200 dark:stroke-slate-800"
            />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#94a3b8" angle={-45} />
            <YAxis tick={{ fontSize: 11 }} width={40} />
            <Tooltip />
            <Bar dataKey="value" fill="#0067c2" radius={[4, 4, 0, 0]} />
          </BarChart>
        </div>
      </div>

      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs mt-6 lg:mt-0">
        <h2 className="font-bold text-slate-900 dark:text-slate-100 mb-4">
          Inventory Distribution
        </h2>
        <div className="h-64 w-full">
          <PieChart>
            <Pie
              data={[
                { name: "FBA", value: fba },
                { name: "FBM", value: fbm },
              ]}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={90}
              dataKey="value"
              nameKey="name"
              label
            >
              <Cell key="fba" fill="#0067c2" />
              <Cell key="fbm" fill="#3b82f6" />
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </div>
      </div>

      <div className="lg:col-span-2 p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs mt-6 lg:mt-0">
        <h2 className="font-bold text-slate-900 dark:text-slate-100 mb-4">Returns by Reason</h2>
        <div className="h-64 w-full">
          <BarChart data={Object.entries(reasonCounts).map(([name, value]) => ({ name, value }))}>
            <CartesianGrid
              strokeDasharray="3 3"
              horizontal={false}
              className="stroke-slate-200 dark:stroke-slate-800"
            />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#94a3b8" angle={-45} />
            <YAxis tick={{ fontSize: 11 }} width={40} />
            <Tooltip />
            <Bar dataKey="value" fill="#dc2626" radius={[4, 4, 0, 0]} />
          </BarChart>
        </div>
      </div>

      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs mt-6 lg:mt-0">
        <h2 className="font-bold text-slate-900 dark:text-slate-100 mb-4">Return Rate Over Time</h2>
        <div className="text-center pt-16 text-slate-500 dark:text-slate-400">
          <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p>Return rate trend requires returns data synchronized from Amazon.</p>
        </div>
      </div>
    </div>
  );
}

function ApiHealthSection({
  statuses,
  onRetryAll,
}: {
  statuses: SyncStatusItem[];
  onRetryAll: () => void;
}) {
  const modules = ["orders", "order-items", "inventory", "listings", "returns"];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-slate-900 dark:text-slate-100">API Synchronization Health</h2>
        <Button size="sm" variant="outline" onClick={onRetryAll}>
          Retry All Modules
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg">
          <thead className="bg-slate-50 dark:bg-slate-800/50 sticky top-0 z-10">
            <tr>
              <th className="p-3 text-left text-slate-500 font-medium">Module</th>
              <th className="p-3 text-left text-slate-500 font-medium">Status</th>
              <th className="p-3 text-left text-slate-500 font-medium">Last Sync</th>
              <th className="p-3 text-right text-slate-500 font-medium">Records</th>
              <th className="p-3 text-left text-slate-500 font-medium">Error</th>
            </tr>
          </thead>
          <tbody>
            {modules.map((m) => {
              const s = statuses.find((x) => x.module === m) || {
                module: m,
                status: "NotConfigured",
                lastSync: null,
                records: 0,
                error: null,
                errorCode: null,
                retries: 0,
              };
              return (
                <tr
                  key={m}
                  className="border-b border-slate-100 dark:border-slate-800 last:border-0"
                >
                  <td className="p-3 font-mono text-sm">{m}</td>
                  <td className="p-3 text-sm">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold ${syncStatusBadge(s.status)}`}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: statusDotColor(s.status) }}
                      />
                      {s.status}
                    </span>
                  </td>
                  <td className="p-3 text-sm text-slate-500">{s.lastSync || "Never"}</td>
                  <td className="p-3 text-right text-sm font-mono">{s.records}</td>
                  <td className="p-3 text-sm text-rose-500 dark:text-rose-400">{s.error || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {icon}
      <h3 className="mt-3 font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
    </div>
  );
}

function AggregateIcon() {
  return (
    <svg
      className="w-4 h-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Chart series helpers
// ─────────────────────────────────────────────────────────────────────────────

function aggregateDaily(orders: AmazonOrder[]) {
  const map: Record<string, { count: number; revenue: number }> = {};
  const from = subDays(new Date(), 29);
  const to = new Date();
  for (let i = 29; i >= 0; i--) {
    const key = format(subDays(new Date(), i), "yyyy-MM-dd");
    map[key] = { count: 0, revenue: 0 };
  }
  for (const o of orders) {
    const d = parseISO(o.orderDate);
    if (!isWithinInterval(d, { start: from, end: to })) continue;
    const key = format(d, "yyyy-MM-dd");
    if (!map[key]) map[key] = { count: 0, revenue: 0 };
    map[key].count += 1;
    map[key].revenue += o.sellingPrice * o.quantity;
  }
  return Object.entries(map).map(([date, v]) => ({ date, ...v }));
}

function orderStatusPie(orders: AmazonOrder[]) {
  const counts = orders.reduce(
    (acc, o) => {
      acc[o.amazonOrderStatus] = (acc[o.amazonOrderStatus] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  return Object.entries(counts).map(([name, value]) => ({ name, value }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Small utils / icons
// ─────────────────────────────────────────────────────────────────────────────

function statusDotColor(status: string) {
  const s = (status || "").toLowerCase();
  if (s === "synchronized") return "#10b981";
  if (s === "synchronizing") return "#3b82f6";
  if (s === "failed" || s === "authenticationerror" || s === "accessrestricted") return "#dc2626";
  if (s === "ratelimited") return "#f59e0b";
  return "#94a3b8";
}

function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function ArchiveIcon({ className }: { className?: string }) {
  return (
    <svg
      className="w-4 h-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="21 8 21 21 3 21 3 8" />
      <rect x="3" y="3" width="18" height="12" rx="2" ry="2" />
      <path d="M7 3v4" />
      <path d="M21 3v4" />
    </svg>
  );
}
