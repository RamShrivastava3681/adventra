import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
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
  X,
  Calendar,
  Filter,
  RefreshCw,
  Settings,
  Info,
  List as ListIcon,
  Loader2,
  ShieldCheck,
  Tag,
  Package,
  Search,
  Truck,
  RotateCcw,
  BarChart2,
  ExternalLink,
  Copy,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  Skeleton,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Input,
  Badge,
  KpiCard,
  TableContainer,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { format, subDays, startOfDay, endOfDay, isWithinInterval, parseISO } from "date-fns";

export const Route = createFileRoute("/app/flipkart-dashboard")({
  component: FlipkartDashboardPage,
});

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface FlipkartOrder {
  id: string;
  clientId: string;
  flipkartOrderId: string;
  orderItemId: string;
  orderDate: string;
  fsn: string;
  sku: string;
  title: string;
  quantity: number;
  sellingPrice: number;
  totalPrice: number;
  taxAmount: number;
  fulfilmentType: "FBF" | "Smart" | "Non-Smart" | "Express";
  orderStatus:
    | "APPROVED"
    | "PACKING"
    | "PACKED"
    | "READY_TO_DISPATCH"
    | "DISPATCHED"
    | "DELIVERED"
    | "CANCELLED"
    | "RETURNED";
  paymentType: "PREPAID" | "COD";
  deliveryAddress?: {
    name?: string;
    city?: string;
    state?: string;
    postalCode?: string;
  };
  trackingId?: string;
  invoiceNumber?: string;
}

interface FlipkartInventoryItem {
  id: string;
  fsn: string;
  sku: string;
  title: string;
  availableStock: number;
  reservedStock: number;
  fulfilmentCenter: string;
  status: "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";
  mrp: number;
  sellingPrice: number;
  updatedAt?: string;
}

interface FlipkartListingItem {
  id: string;
  fsn: string;
  sku: string;
  title: string;
  listingStatus: "ACTIVE" | "INACTIVE" | "BLOCKED";
  mrp: number;
  sellingPrice: number;
  stockCount: number;
  flipkartAssured: boolean;
  procurementType: string;
  rating?: number;
}

interface FlipkartReturnItem {
  id: string;
  returnId: string;
  flipkartOrderId: string;
  orderItemId: string;
  fsn: string;
  sku: string;
  title: string;
  returnType: "CUSTOMER_RETURN" | "COURIER_RETURN";
  reason: string;
  refundAmount: number;
  status: string;
  returnDate: string;
}

interface SyncStatusItem {
  module: string;
  status: string;
  lastSync: string | null;
  lastAttemptedAt: string | null;
  records: number;
  message?: string;
}

interface ApplicationHealth {
  isConfigured: boolean;
  appId: string | null;
  sellerId: string | null;
  apiEndpoint: string;
  sandbox: boolean;
  status: string;
  message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Colors & Status Helpers
// ─────────────────────────────────────────────────────────────────────────────

const COLORS = {
  blue: "#2874F0", // Flipkart Blue
  yellow: "#FFE500", // Flipkart Yellow
  emerald: "#10b981",
  rose: "#f43f5e",
  amber: "#f59e0b",
  purple: "#8b5cf6",
  slate: "#64748b",
};

const PIE_COLORS = ["#2874F0", "#10b981", "#f59e0b", "#8b5cf6", "#f43f5e", "#64748b"];

function formatInr(val: number): string {
  return "₹" + Number(val || 0).toLocaleString("en-IN");
}

function parseRange(range: string): { from: Date; to: Date } {
  const now = new Date();
  const to = endOfDay(now);
  switch (range) {
    case "today":
      return { from: startOfDay(now), to };
    case "7d":
      return { from: startOfDay(subDays(now, 7)), to };
    case "30d":
      return { from: startOfDay(subDays(now, 30)), to };
    case "90d":
      return { from: startOfDay(subDays(now, 90)), to };
    case "all":
    default:
      return { from: new Date(2020, 0, 1), to };
  }
}

function inRange(dateStr: string | undefined, { from, to }: { from: Date; to: Date }) {
  if (!dateStr) return false;
  try {
    const d = parseISO(dateStr);
    return isWithinInterval(d, { start: from, end: to });
  } catch {
    return false;
  }
}

function orderStatusBadge(status: string) {
  switch (status?.toUpperCase()) {
    case "APPROVED":
      return <Badge className="bg-blue-100 text-blue-800 border-blue-200">Approved</Badge>;
    case "PACKING":
    case "PACKED":
      return <Badge className="bg-purple-100 text-purple-800 border-purple-200">Packing</Badge>;
    case "READY_TO_DISPATCH":
      return <Badge className="bg-amber-100 text-amber-800 border-amber-200">Ready to Dispatch</Badge>;
    case "DISPATCHED":
      return <Badge className="bg-cyan-100 text-cyan-800 border-cyan-200">Dispatched</Badge>;
    case "DELIVERED":
      return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">Delivered</Badge>;
    case "RETURNED":
      return <Badge className="bg-rose-100 text-rose-800 border-rose-200">Returned</Badge>;
    case "CANCELLED":
      return <Badge className="bg-slate-100 text-slate-800 border-slate-200">Cancelled</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function fulfilmentBadge(type: string) {
  switch (type) {
    case "FBF":
      return <Badge className="bg-blue-600 text-white border-none font-semibold">Flipkart Assured (FBF)</Badge>;
    case "Smart":
      return <Badge className="bg-indigo-100 text-indigo-800 border-indigo-200">Smart Fulfilment</Badge>;
    default:
      return <Badge variant="outline" className="text-slate-600">{type || "Standard"}</Badge>;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function FlipkartDashboardPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const clientId = user?.id || "";

  // Filters
  const [dateRange, setDateRange] = useState<string>("30d");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [selectedFulfilment, setSelectedFulfilment] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [activeTab, setActiveTab] = useState<string>("overview");

  // UI state
  const [selectedOrder, setSelectedOrder] = useState<FlipkartOrder | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState<boolean>(false);
  const [setupGuideOpen, setSetupGuideOpen] = useState<boolean>(false);
  const [copiedEnv, setCopiedEnv] = useState<boolean>(false);

  // Queries
  const { data: ordersData, isLoading: loadingOrders, refetch: refetchOrders } = useQuery({
    queryKey: ["flipkart-orders", clientId],
    queryFn: () => api.flipkartOrders.list(clientId),
  });

  const { data: inventoryData, isLoading: loadingInventory, refetch: refetchInventory } = useQuery({
    queryKey: ["flipkart-inventory", clientId],
    queryFn: () => api.flipkartInventory.list(clientId),
  });

  const { data: listingsData, isLoading: loadingListings, refetch: refetchListings } = useQuery({
    queryKey: ["flipkart-listings", clientId],
    queryFn: () => api.flipkartListings.list(clientId),
  });

  const { data: returnsData, isLoading: loadingReturns, refetch: refetchReturns } = useQuery({
    queryKey: ["flipkart-returns", clientId],
    queryFn: () => api.flipkartReturns.list(clientId),
  });

  const { data: syncStatusData, refetch: refetchSync } = useQuery({
    queryKey: ["flipkart-sync-status", clientId],
    queryFn: () => api.flipkartSync.status(clientId),
  });

  const { data: appStatusData, refetch: refetchAppStatus } = useQuery({
    queryKey: ["flipkart-app-status", clientId],
    queryFn: () => api.flipkartSync.applicationStatus(clientId),
  });

  // Manual sync mutation
  const syncMutation = useMutation({
    mutationFn: () => api.flipkartSync.trigger(),
    onSuccess: (res: any) => {
      if (res?.synchronized) {
        toast.success("Flipkart data synchronized successfully");
      } else {
        toast.info(res?.message || "Sync triggered (credentials pending live connection)");
      }
      queryClient.invalidateQueries({ queryKey: ["flipkart-orders"] });
      queryClient.invalidateQueries({ queryKey: ["flipkart-inventory"] });
      queryClient.invalidateQueries({ queryKey: ["flipkart-listings"] });
      queryClient.invalidateQueries({ queryKey: ["flipkart-returns"] });
      queryClient.invalidateQueries({ queryKey: ["flipkart-sync-status"] });
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to trigger sync");
    },
  });

  const refreshAll = () => {
    refetchOrders();
    refetchInventory();
    refetchListings();
    refetchReturns();
    refetchSync();
    refetchAppStatus();
    toast.success("Refreshed Flipkart dashboard");
  };

  // Safe normalized arrays
  const orders: FlipkartOrder[] = useMemo(() => {
    if (Array.isArray(ordersData)) return ordersData;
    if (Array.isArray(ordersData?.orders)) return ordersData.orders;
    return [];
  }, [ordersData]);

  const inventory: FlipkartInventoryItem[] = useMemo(() => {
    if (Array.isArray(inventoryData)) return inventoryData;
    if (Array.isArray(inventoryData?.items)) return inventoryData.items;
    return [];
  }, [inventoryData]);

  const listings: FlipkartListingItem[] = useMemo(() => {
    if (Array.isArray(listingsData)) return listingsData;
    if (Array.isArray(listingsData?.items)) return listingsData.items;
    return [];
  }, [listingsData]);

  const returns: FlipkartReturnItem[] = useMemo(() => {
    if (Array.isArray(returnsData)) return returnsData;
    if (Array.isArray(returnsData?.returns)) return returnsData.returns;
    return [];
  }, [returnsData]);

  const syncModules: SyncStatusItem[] = useMemo(() => {
    if (Array.isArray(syncStatusData)) return syncStatusData;
    if (Array.isArray(syncStatusData?.syncStatus)) return syncStatusData.syncStatus;
    return [];
  }, [syncStatusData]);

  const appHealth: ApplicationHealth | null = useMemo(() => appStatusData || null, [appStatusData]);

  const isConfigured = appHealth?.isConfigured ?? false;

  // Filtered Orders
  const filteredOrders = useMemo(() => {
    const range = parseRange(dateRange);
    return orders.filter((o) => {
      if (!inRange(o.orderDate, range)) return false;
      if (selectedStatus !== "all" && o.orderStatus?.toUpperCase() !== selectedStatus.toUpperCase()) {
        return false;
      }
      if (selectedFulfilment !== "all" && o.fulfilmentType !== selectedFulfilment) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchId = o.flipkartOrderId?.toLowerCase().includes(q);
        const matchFsn = o.fsn?.toLowerCase().includes(q);
        const matchSku = o.sku?.toLowerCase().includes(q);
        const matchTitle = o.title?.toLowerCase().includes(q);
        if (!matchId && !matchFsn && !matchSku && !matchTitle) return false;
      }
      return true;
    });
  }, [orders, dateRange, selectedStatus, selectedFulfilment, searchQuery]);

  // Executive KPI Computations
  const kpis = useMemo(() => {
    const range = parseRange(dateRange);
    const rangeOrders = orders.filter((o) => inRange(o.orderDate, range));
    const nonCancelled = rangeOrders.filter((o) => o.orderStatus !== "CANCELLED");

    const totalRevenue = nonCancelled.reduce((sum, o) => sum + (o.totalPrice || 0), 0);
    const totalOrders = rangeOrders.length;
    const unitsSold = nonCancelled.reduce((sum, o) => sum + (o.quantity || 1), 0);
    const activeListings = listings.filter((l) => l.listingStatus === "ACTIVE").length;

    // Pipeline counts
    const approved = rangeOrders.filter((o) => o.orderStatus === "APPROVED").length;
    const packing = rangeOrders.filter((o) => o.orderStatus === "PACKING" || o.orderStatus === "PACKED").length;
    const readyDispatch = rangeOrders.filter((o) => o.orderStatus === "READY_TO_DISPATCH").length;
    const dispatched = rangeOrders.filter((o) => o.orderStatus === "DISPATCHED").length;
    const delivered = rangeOrders.filter((o) => o.orderStatus === "DELIVERED").length;

    // Stock & Returns
    const totalStock = inventory.reduce((sum, i) => sum + (i.availableStock || 0), 0);
    const lowStockCount = inventory.filter((i) => i.availableStock > 0 && i.availableStock < 15).length;
    const outOfStockCount = inventory.filter((i) => i.availableStock === 0).length;
    const totalReturnsCount = returns.length;
    const returnRate = totalOrders > 0 ? ((totalReturnsCount / totalOrders) * 100).toFixed(1) : "0.0";

    return {
      totalRevenue,
      totalOrders,
      unitsSold,
      activeListings,
      approved,
      packing,
      readyDispatch,
      dispatched,
      delivered,
      totalStock,
      lowStockCount,
      outOfStockCount,
      totalReturnsCount,
      returnRate,
    };
  }, [orders, listings, inventory, returns, dateRange]);

  // Charts data: Daily Orders & Revenue
  const dailyChartData = useMemo(() => {
    const map = new Map<string, { date: string; orders: number; revenue: number }>();
    const sorted = [...orders].sort((a, b) => (a.orderDate > b.orderDate ? 1 : -1));

    sorted.forEach((o) => {
      if (!o.orderDate) return;
      const key = o.orderDate;
      const current = map.get(key) || { date: key, orders: 0, revenue: 0 };
      current.orders += 1;
      if (o.orderStatus !== "CANCELLED") {
        current.revenue += o.totalPrice || 0;
      }
      map.set(key, current);
    });

    return Array.from(map.values()).slice(-14);
  }, [orders]);

  // Order status distribution
  const statusPieData = useMemo(() => {
    const counts: Record<string, number> = {};
    orders.forEach((o) => {
      const st = o.orderStatus || "UNKNOWN";
      counts[st] = (counts[st] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [orders]);

  const copyEnvSnippet = () => {
    const snippet = `FLIPKART_APP_ID=your_flipkart_app_id\nFLIPKART_APP_SECRET=your_flipkart_app_secret\nFLIPKART_SELLER_ID=your_seller_id\nFLIPKART_API_ENDPOINT=https://api.flipkart.net/sellers\nFLIPKART_SANDBOX=false`;
    navigator.clipboard.writeText(snippet);
    setCopiedEnv(true);
    toast.success("Configuration snippet copied to clipboard");
    setTimeout(() => setCopiedEnv(false), 2500);
  };

  return (
    <div className="flex-1 space-y-6 p-4 md:p-8 pt-6 max-w-[1600px] mx-auto min-w-0">
      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-[#2874F0] flex items-center justify-center text-white shadow-sm font-bold text-lg">
              F
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Flipkart Marketplace Hub
            </h1>
            {isConfigured ? (
              <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300">
                <CheckCircle className="w-3.5 h-3.5 mr-1 text-emerald-600" /> Connected
              </Badge>
            ) : (
              <Badge className="bg-amber-100 text-amber-800 border-amber-300">
                <AlertCircle className="w-3.5 h-3.5 mr-1 text-amber-600" /> Credentials Pending
              </Badge>
            )}
          </div>
          <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400">
            Flipkart Seller API integration · Adventra Sports (Flipkart India Marketplace)
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!isConfigured && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSetupGuideOpen(true)}
              className="text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800 hover:bg-amber-50 dark:hover:bg-amber-950/40"
            >
              <Settings className="w-4 h-4 mr-1.5" /> Setup API Keys
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={refreshAll}
            title="Refresh dashboard data"
          >
            <RefreshCw className="w-4 h-4 mr-1.5" /> Refresh
          </Button>

          <Button
            size="sm"
            className="bg-[#2874F0] hover:bg-[#1a5bc4] text-white"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            {syncMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Syncing...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-1.5" /> Sync with Flipkart
              </>
            )}
          </Button>
        </div>
      </div>

      {/* ── Pending Credentials Banner ── */}
      {!isConfigured && !bannerDismissed && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800/60 bg-gradient-to-r from-amber-50 via-yellow-50 to-amber-50 dark:from-amber-950/30 dark:to-yellow-950/20 p-4 transition-all">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-amber-200/80 dark:bg-amber-900/60 flex items-center justify-center shrink-0 text-amber-800 dark:text-amber-300">
                <Info className="w-4 h-4" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                  Flipkart Seller API Credentials Pending
                </h4>
                <p className="text-xs text-amber-800/90 dark:text-amber-300/80 leading-relaxed max-w-4xl">
                  You are currently previewing the Flipkart dashboard with simulated marketplace data. Once you receive
                  the <strong>App ID</strong> &amp; <strong>App Secret</strong> from your manager, add them to your{" "}
                  <code className="px-1.5 py-0.5 rounded bg-amber-200/60 dark:bg-amber-900/40 font-mono text-[11px]">
                    backend/.env
                  </code>{" "}
                  file to activate real-time Flipkart order polling and automatic inventory synchronization.
                </p>
                <div className="pt-1.5 flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs bg-white dark:bg-slate-900 border-amber-300 text-amber-900 hover:bg-amber-100"
                    onClick={() => setSetupGuideOpen(true)}
                  >
                    View Setup Instructions
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-amber-800 hover:text-amber-950"
                    onClick={copyEnvSnippet}
                  >
                    {copiedEnv ? (
                      <>
                        <Check className="w-3 h-3 mr-1 text-emerald-600" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3 mr-1" /> Copy .env Template
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
            <button
              onClick={() => setBannerDismissed(true)}
              className="text-amber-600 hover:text-amber-900 p-1 rounded-md transition-colors"
              title="Dismiss banner"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Filters & Controls Toolbar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 dark:bg-slate-900/50 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-2">
          {/* Date Range */}
          <div className="flex items-center gap-1.5">
            <Calendar className="w-4 h-4 text-slate-400" />
            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger className="w-[125px] h-8 text-xs bg-white dark:bg-slate-800">
                <SelectValue placeholder="Date range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="7d">Last 7 Days</SelectItem>
                <SelectItem value="30d">Last 30 Days</SelectItem>
                <SelectItem value="90d">Last 90 Days</SelectItem>
                <SelectItem value="all">All Time</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1.5">
            <Filter className="w-4 h-4 text-slate-400" />
            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger className="w-[140px] h-8 text-xs bg-white dark:bg-slate-800">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="APPROVED">Approved</SelectItem>
                <SelectItem value="PACKING">Packing</SelectItem>
                <SelectItem value="READY_TO_DISPATCH">Ready to Dispatch</SelectItem>
                <SelectItem value="DISPATCHED">Dispatched</SelectItem>
                <SelectItem value="DELIVERED">Delivered</SelectItem>
                <SelectItem value="RETURNED">Returned</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Fulfilment Filter */}
          <Select value={selectedFulfilment} onValueChange={setSelectedFulfilment}>
            <SelectTrigger className="w-[145px] h-8 text-xs bg-white dark:bg-slate-800">
              <SelectValue placeholder="Fulfilment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Fulfilment</SelectItem>
              <SelectItem value="FBF">Flipkart Assured (FBF)</SelectItem>
              <SelectItem value="Smart">Smart Fulfilment</SelectItem>
              <SelectItem value="Non-Smart">Non-Smart (Direct)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
          <Input
            placeholder="Search Order ID, FSN, SKU..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-xs bg-white dark:bg-slate-800"
          />
        </div>
      </div>

      {/* ── Navigation Tabs ── */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="bg-slate-100 dark:bg-slate-800 p-1 rounded-lg flex flex-wrap gap-1 h-auto">
          <TabsTrigger value="overview" className="text-xs px-3 py-1.5 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-900">
            <LayoutDashboard className="w-3.5 h-3.5 mr-1.5" /> Overview
          </TabsTrigger>
          <TabsTrigger value="orders" className="text-xs px-3 py-1.5 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-900">
            <ShoppingBag className="w-3.5 h-3.5 mr-1.5" /> Orders ({filteredOrders.length})
          </TabsTrigger>
          <TabsTrigger value="inventory" className="text-xs px-3 py-1.5 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-900">
            <Warehouse className="w-3.5 h-3.5 mr-1.5" /> Inventory ({inventory.length})
          </TabsTrigger>
          <TabsTrigger value="listings" className="text-xs px-3 py-1.5 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-900">
            <Tag className="w-3.5 h-3.5 mr-1.5" /> Listings ({listings.length})
          </TabsTrigger>
          <TabsTrigger value="returns" className="text-xs px-3 py-1.5 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-900">
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Returns &amp; RTO ({returns.length})
          </TabsTrigger>
          <TabsTrigger value="analytics" className="text-xs px-3 py-1.5 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-900">
            <BarChart2 className="w-3.5 h-3.5 mr-1.5" /> Analytics
          </TabsTrigger>
          <TabsTrigger value="api-health" className="text-xs px-3 py-1.5 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-900">
            <ShieldCheck className="w-3.5 h-3.5 mr-1.5" /> API Health
          </TabsTrigger>
        </TabsList>

        {/* ═════════════════════════════════════════════════════════════════════ */}
        {/* TAB 1: OVERVIEW                                                       */}
        {/* ═════════════════════════════════════════════════════════════════════ */}
        <TabsContent value="overview" className="space-y-6">
          {/* Tier 1: 4 Core Executive KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
              <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
                <span>Total Flipkart Revenue</span>
                <div className="p-2 bg-blue-50 dark:bg-blue-950/40 text-[#2874F0] rounded-lg">
                  <DollarSign className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                  {formatInr(kpis.totalRevenue)}
                </span>
                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  +14.8%
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                From {kpis.totalOrders} total orders in selected period
              </p>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
              <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
                <span>Total Orders</span>
                <div className="p-2 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 rounded-lg">
                  <ShoppingBag className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                  {kpis.totalOrders}
                </span>
                <span className="text-xs text-slate-500">
                  ({kpis.delivered} delivered)
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                {kpis.dispatched + kpis.readyDispatch} currently in transit / dispatch
              </p>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
              <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
                <span>Units Sold</span>
                <div className="p-2 bg-amber-50 dark:bg-amber-950/40 text-amber-600 rounded-lg">
                  <Package className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                  {kpis.unitsSold}
                </span>
                <span className="text-xs text-slate-500">units</span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                Avg. ticket size {kpis.unitsSold > 0 ? formatInr(Math.round(kpis.totalRevenue / kpis.unitsSold)) : "₹0"}
              </p>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
              <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
                <span>Active Listings</span>
                <div className="p-2 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 rounded-lg">
                  <Tag className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                  {kpis.activeListings}
                </span>
                <span className="text-xs text-slate-500">/ {listings.length} SKUs</span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                {listings.filter((l) => l.flipkartAssured).length} Flipkart Assured listings
              </p>
            </div>
          </div>

          {/* Tier 2: 2 Operational Panels */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Fulfilment Pipeline */}
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Truck className="w-4 h-4 text-[#2874F0]" /> Fulfilment Pipeline
                </h3>
                <span className="text-xs text-slate-500">{kpis.totalOrders} total</span>
              </div>
              <div className="grid grid-cols-5 gap-2 text-center">
                <div className="p-2.5 rounded-lg bg-blue-50/70 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/40">
                  <span className="text-xs text-blue-700 dark:text-blue-300 font-medium">Approved</span>
                  <p className="text-lg font-bold text-blue-900 dark:text-blue-100 mt-1">{kpis.approved}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-purple-50/70 dark:bg-purple-950/30 border border-purple-100 dark:border-purple-900/40">
                  <span className="text-xs text-purple-700 dark:text-purple-300 font-medium">Packing</span>
                  <p className="text-lg font-bold text-purple-900 dark:text-purple-100 mt-1">{kpis.packing}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-amber-50/70 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-900/40">
                  <span className="text-xs text-amber-700 dark:text-amber-300 font-medium">Ready</span>
                  <p className="text-lg font-bold text-amber-900 dark:text-amber-100 mt-1">{kpis.readyDispatch}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-cyan-50/70 dark:bg-cyan-950/30 border border-cyan-100 dark:border-cyan-900/40">
                  <span className="text-xs text-cyan-700 dark:text-cyan-300 font-medium">Dispatched</span>
                  <p className="text-lg font-bold text-cyan-900 dark:text-cyan-100 mt-1">{kpis.dispatched}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/40">
                  <span className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">Delivered</span>
                  <p className="text-lg font-bold text-emerald-900 dark:text-emerald-100 mt-1">{kpis.delivered}</p>
                </div>
              </div>
            </div>

            {/* Inventory & Returns Health */}
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Warehouse className="w-4 h-4 text-emerald-600" /> Stock &amp; Return Health
                </h3>
                <span className="text-xs text-slate-500">{kpis.totalStock} units in stock</span>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="p-2.5 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/40">
                  <span className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">In Stock</span>
                  <p className="text-lg font-bold text-emerald-900 dark:text-emerald-100 mt-1">
                    {inventory.filter((i) => i.availableStock >= 15).length}
                  </p>
                </div>
                <div className="p-2.5 rounded-lg bg-amber-50/70 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-900/40">
                  <span className="text-xs text-amber-700 dark:text-amber-300 font-medium">Low Stock</span>
                  <p className="text-lg font-bold text-amber-900 dark:text-amber-100 mt-1">{kpis.lowStockCount}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-rose-50/70 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900/40">
                  <span className="text-xs text-rose-700 dark:text-rose-300 font-medium">Out of Stock</span>
                  <p className="text-lg font-bold text-rose-900 dark:text-rose-100 mt-1">{kpis.outOfStockCount}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-purple-50/70 dark:bg-purple-950/30 border border-purple-100 dark:border-purple-900/40">
                  <span className="text-xs text-purple-700 dark:text-purple-300 font-medium">Return Rate</span>
                  <p className="text-lg font-bold text-purple-900 dark:text-purple-100 mt-1">{kpis.returnRate}%</p>
                </div>
              </div>
            </div>
          </div>

          {/* Tier 3: Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Daily Trend */}
            <div className="lg:col-span-2 p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Daily Orders &amp; Gross Sales Trend
                  </h3>
                  <p className="text-xs text-slate-500">Order volumes and gross revenue</p>
                </div>
                <Badge variant="outline" className="text-xs text-[#2874F0] border-blue-200">
                  Flipkart India
                </Badge>
              </div>
              <div className="h-64 w-full">
                {dailyChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dailyChartData}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                      <Tooltip
                        formatter={(val: any, name: string) => [
                          name === "revenue" ? formatInr(val) : val,
                          name === "revenue" ? "Gross Sales" : "Orders",
                        ]}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar yAxisId="left" dataKey="orders" fill="#2874F0" name="Orders" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-400 text-xs">
                    No trend data available for current range
                  </div>
                )}
              </div>
            </div>

            {/* Status Breakdown */}
            <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Order Status Breakdown
                  </h3>
                  <p className="text-xs text-slate-500">Distribution across stages</p>
                </div>
              </div>
              <div className="h-64 w-full">
                {statusPieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusPieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={75}
                        innerRadius={45}
                        paddingAngle={3}
                      >
                        {statusPieData.map((_entry, index) => (
                          <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-400 text-xs">
                    No status data available
                  </div>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ═════════════════════════════════════════════════════════════════════ */}
        {/* TAB 2: ORDERS                                                         */}
        {/* ═════════════════════════════════════════════════════════════════════ */}
        <TabsContent value="orders" className="space-y-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Flipkart Orders ({filteredOrders.length})
                </h3>
                <p className="text-xs text-slate-500">Click any order to view customer and dispatch details</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Order ID / Date</TableHead>
                    <TableHead className="text-xs">Product Details</TableHead>
                    <TableHead className="text-xs">FSN / SKU</TableHead>
                    <TableHead className="text-xs text-right">Qty</TableHead>
                    <TableHead className="text-xs text-right">Price</TableHead>
                    <TableHead className="text-xs text-right">Total</TableHead>
                    <TableHead className="text-xs">Fulfilment</TableHead>
                    <TableHead className="text-xs">Payment</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingOrders ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-400 mb-2" />
                        <span className="text-xs text-slate-500">Loading orders...</span>
                      </TableCell>
                    </TableRow>
                  ) : filteredOrders.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-10 text-slate-400 text-xs">
                        No Flipkart orders match the selected filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredOrders.map((o) => (
                      <TableRow
                        key={o.id}
                        className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
                        onClick={() => setSelectedOrder(o)}
                      >
                        <TableCell className="font-mono text-xs">
                          <span className="font-semibold text-slate-900 dark:text-slate-100 block">
                            {o.flipkartOrderId}
                          </span>
                          <span className="text-[11px] text-slate-400">{o.orderDate}</span>
                        </TableCell>
                        <TableCell className="text-xs max-w-xs truncate font-medium text-slate-800 dark:text-slate-200">
                          {o.title}
                        </TableCell>
                        <TableCell className="text-xs font-mono text-slate-500">
                          <span className="text-blue-600 dark:text-blue-400 block font-semibold">{o.fsn}</span>
                          <span className="text-[11px] text-slate-400">{o.sku}</span>
                        </TableCell>
                        <TableCell className="text-xs text-right font-medium">{o.quantity}</TableCell>
                        <TableCell className="text-xs text-right">{formatInr(o.sellingPrice)}</TableCell>
                        <TableCell className="text-xs text-right font-bold text-slate-900 dark:text-slate-100">
                          {formatInr(o.totalPrice)}
                        </TableCell>
                        <TableCell className="text-xs">{fulfilmentBadge(o.fulfilmentType)}</TableCell>
                        <TableCell className="text-xs">
                          <Badge variant="outline" className={o.paymentType === "COD" ? "border-amber-300 text-amber-700" : "border-slate-300"}>
                            {o.paymentType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{orderStatusBadge(o.orderStatus)}</TableCell>
                        <TableCell className="text-xs text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-[#2874F0]"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedOrder(o);
                            }}
                          >
                            Details
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* ═════════════════════════════════════════════════════════════════════ */}
        {/* TAB 3: INVENTORY                                                      */}
        {/* ═════════════════════════════════════════════════════════════════════ */}
        <TabsContent value="inventory" className="space-y-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Flipkart Inventory Levels ({inventory.length} SKUs)
                </h3>
                <p className="text-xs text-slate-500">Live stock counts across Flipkart fulfilment centres</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Product Details</TableHead>
                    <TableHead className="text-xs">FSN / SKU</TableHead>
                    <TableHead className="text-xs">FC Location</TableHead>
                    <TableHead className="text-xs text-right">Available Stock</TableHead>
                    <TableHead className="text-xs text-right">Reserved</TableHead>
                    <TableHead className="text-xs text-right">MRP</TableHead>
                    <TableHead className="text-xs text-right">Selling Price</TableHead>
                    <TableHead className="text-xs">Stock Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingInventory ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-400 mb-2" />
                        <span className="text-xs text-slate-500">Loading inventory...</span>
                      </TableCell>
                    </TableRow>
                  ) : inventory.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-slate-400 text-xs">
                        No inventory records found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    inventory.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="text-xs font-medium text-slate-800 dark:text-slate-200 max-w-sm truncate">
                          {item.title}
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          <span className="text-blue-600 dark:text-blue-400 block font-semibold">{item.fsn}</span>
                          <span className="text-[11px] text-slate-400">{item.sku}</span>
                        </TableCell>
                        <TableCell className="text-xs text-slate-600">{item.fulfilmentCenter}</TableCell>
                        <TableCell className="text-xs text-right font-bold text-slate-900 dark:text-slate-100">
                          {item.availableStock}
                        </TableCell>
                        <TableCell className="text-xs text-right text-slate-500">{item.reservedStock}</TableCell>
                        <TableCell className="text-xs text-right text-slate-400 line-through">
                          {formatInr(item.mrp)}
                        </TableCell>
                        <TableCell className="text-xs text-right font-semibold text-emerald-600 dark:text-emerald-400">
                          {formatInr(item.sellingPrice)}
                        </TableCell>
                        <TableCell className="text-xs">
                          {item.availableStock === 0 ? (
                            <Badge className="bg-rose-100 text-rose-800 border-rose-200">Out of Stock</Badge>
                          ) : item.availableStock < 15 ? (
                            <Badge className="bg-amber-100 text-amber-800 border-amber-200">Low Stock ({item.availableStock})</Badge>
                          ) : (
                            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">In Stock</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* ═════════════════════════════════════════════════════════════════════ */}
        {/* TAB 4: LISTINGS                                                       */}
        {/* ═════════════════════════════════════════════════════════════════════ */}
        <TabsContent value="listings" className="space-y-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Flipkart Catalog Listings ({listings.length})
                </h3>
                <p className="text-xs text-slate-500">Live Flipkart catalog SKUs and Assured badge status</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">FSN / Title</TableHead>
                    <TableHead className="text-xs">Merchant SKU</TableHead>
                    <TableHead className="text-xs">Rating</TableHead>
                    <TableHead className="text-xs text-right">MRP</TableHead>
                    <TableHead className="text-xs text-right">Selling Price</TableHead>
                    <TableHead className="text-xs">Flipkart Assured</TableHead>
                    <TableHead className="text-xs">Procurement</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingListings ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-400 mb-2" />
                        <span className="text-xs text-slate-500">Loading listings...</span>
                      </TableCell>
                    </TableRow>
                  ) : listings.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-slate-400 text-xs">
                        No catalog listings found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    listings.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="text-xs">
                          <span className="font-mono text-blue-600 dark:text-blue-400 font-semibold block">{item.fsn}</span>
                          <span className="text-slate-700 dark:text-slate-300 max-w-sm truncate block font-medium">
                            {item.title}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs font-mono text-slate-500">{item.sku}</TableCell>
                        <TableCell className="text-xs">
                          <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold text-[11px]">
                            ★ {item.rating || 4.5}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-right text-slate-400 line-through">
                          {formatInr(item.mrp)}
                        </TableCell>
                        <TableCell className="text-xs text-right font-bold text-slate-900 dark:text-slate-100">
                          {formatInr(item.sellingPrice)}
                        </TableCell>
                        <TableCell className="text-xs">
                          {item.flipkartAssured ? (
                            <Badge className="bg-[#2874F0] text-white border-none font-semibold">
                              ✓ Assured
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-slate-500">Standard</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600 font-medium">{item.procurementType}</TableCell>
                        <TableCell className="text-xs">
                          {item.listingStatus === "ACTIVE" ? (
                            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">Active</Badge>
                          ) : (
                            <Badge className="bg-slate-100 text-slate-800 border-slate-200">{item.listingStatus}</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* ═════════════════════════════════════════════════════════════════════ */}
        {/* TAB 5: RETURNS & RTO                                                  */}
        {/* ═════════════════════════════════════════════════════════════════════ */}
        <TabsContent value="returns" className="space-y-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Flipkart Returns &amp; RTO ({returns.length})
                </h3>
                <p className="text-xs text-slate-500">Customer returns and courier undelivered (RTO) tracking</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Return ID / Date</TableHead>
                    <TableHead className="text-xs">Order ID</TableHead>
                    <TableHead className="text-xs">Product Details</TableHead>
                    <TableHead className="text-xs">Return Type</TableHead>
                    <TableHead className="text-xs">Reason</TableHead>
                    <TableHead className="text-xs text-right">Refund Amount</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingReturns ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-400 mb-2" />
                        <span className="text-xs text-slate-500">Loading returns...</span>
                      </TableCell>
                    </TableRow>
                  ) : returns.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-slate-400 text-xs">
                        No returns or RTO records found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    returns.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs font-mono">
                          <span className="font-semibold text-slate-900 dark:text-slate-100 block">{r.returnId}</span>
                          <span className="text-[11px] text-slate-400">{r.returnDate}</span>
                        </TableCell>
                        <TableCell className="text-xs font-mono text-blue-600 dark:text-blue-400">{r.flipkartOrderId}</TableCell>
                        <TableCell className="text-xs max-w-sm truncate text-slate-700 dark:text-slate-300 font-medium">
                          {r.title}
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.returnType === "COURIER_RETURN" ? (
                            <Badge className="bg-amber-100 text-amber-800 border-amber-200">Courier RTO</Badge>
                          ) : (
                            <Badge className="bg-purple-100 text-purple-800 border-purple-200">Customer Return</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600">{r.reason}</TableCell>
                        <TableCell className="text-xs text-right font-bold text-rose-600 dark:text-rose-400">
                          {formatInr(r.refundAmount)}
                        </TableCell>
                        <TableCell className="text-xs">
                          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">{r.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* ═════════════════════════════════════════════════════════════════════ */}
        {/* TAB 6: ANALYTICS                                                      */}
        {/* ═════════════════════════════════════════════════════════════════════ */}
        <TabsContent value="analytics" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm space-y-3">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Payment Type Mix
              </h3>
              <p className="text-xs text-slate-500">Prepaid vs Cash on Delivery (COD) ratio</p>
              <div className="space-y-2 pt-2">
                {(() => {
                  const prepaid = orders.filter((o) => o.paymentType === "PREPAID").length;
                  const cod = orders.filter((o) => o.paymentType === "COD").length;
                  const total = prepaid + cod || 1;
                  const prepPct = Math.round((prepaid / total) * 100);
                  const codPct = 100 - prepPct;
                  return (
                    <>
                      <div className="flex justify-between text-xs font-medium">
                        <span>Prepaid: {prepaid} ({prepPct}%)</span>
                        <span>COD: {cod} ({codPct}%)</span>
                      </div>
                      <div className="w-full h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex">
                        <div style={{ width: `${prepPct}%` }} className="bg-[#2874F0]" />
                        <div style={{ width: `${codPct}%` }} className="bg-amber-500" />
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>

            <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm space-y-3">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Fulfilment Channel Share
              </h3>
              <p className="text-xs text-slate-500">Flipkart Assured (FBF) vs Direct Merchant fulfilment</p>
              <div className="space-y-2 pt-2">
                {(() => {
                  const fbf = orders.filter((o) => o.fulfilmentType === "FBF").length;
                  const other = orders.length - fbf;
                  const total = orders.length || 1;
                  const fbfPct = Math.round((fbf / total) * 100);
                  const otherPct = 100 - fbfPct;
                  return (
                    <>
                      <div className="flex justify-between text-xs font-medium">
                        <span>Flipkart Assured (FBF): {fbf} ({fbfPct}%)</span>
                        <span>Seller Direct: {other} ({otherPct}%)</span>
                      </div>
                      <div className="w-full h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex">
                        <div style={{ width: `${fbfPct}%` }} className="bg-indigo-600" />
                        <div style={{ width: `${otherPct}%` }} className="bg-slate-400" />
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ═════════════════════════════════════════════════════════════════════ */}
        {/* TAB 7: API HEALTH                                                     */}
        {/* ═════════════════════════════════════════════════════════════════════ */}
        <TabsContent value="api-health" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Status card */}
            <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#2874F0]" /> Flipkart Seller API Status
                </h3>
                {isConfigured ? (
                  <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300">Operational</Badge>
                ) : (
                  <Badge className="bg-amber-100 text-amber-800 border-amber-300">Credentials Pending</Badge>
                )}
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">API Endpoint</span>
                  <span className="font-mono text-slate-700 dark:text-slate-300">
                    {appHealth?.apiEndpoint || "https://api.flipkart.net/sellers"}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">Environment</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    {appHealth?.sandbox ? "Sandbox (Testing)" : "Production"}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">App ID</span>
                  <span className="font-mono text-slate-700 dark:text-slate-300">
                    {appHealth?.appId || "Not set (Waiting for manager)"}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">Seller ID</span>
                  <span className="font-mono text-slate-700 dark:text-slate-300">
                    {appHealth?.sellerId || "Not set"}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-500">Authentication Grant</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-300">OAuth 2.0 Client Credentials</span>
                </div>
              </div>

              <Button
                variant="outline"
                className="w-full text-xs"
                onClick={() => setSetupGuideOpen(true)}
              >
                <Settings className="w-3.5 h-3.5 mr-1.5" /> Open API Key Configuration Guide
              </Button>
            </div>

            {/* Per-module health */}
            <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm space-y-4">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Warehouse className="w-4 h-4 text-emerald-600" /> Module Sync Snapshot
              </h3>
              <div className="space-y-3">
                {syncModules.map((m) => (
                  <div
                    key={m.module}
                    className="p-3 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-semibold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                        {m.module}
                      </span>
                      <p className="text-[11px] text-slate-400 mt-0.5">{m.message || "Ready"}</p>
                    </div>
                    <div>
                      {isConfigured ? (
                        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">Synchronized</Badge>
                      ) : (
                        <Badge className="bg-amber-100 text-amber-800 border-amber-200">Pending Keys</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Order Detail Dialog ── */}
      <Dialog open={Boolean(selectedOrder)} onOpenChange={(open) => !open && setSelectedOrder(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>Order Details: {selectedOrder?.flipkartOrderId || "N/A"}</span>
              {selectedOrder && orderStatusBadge(selectedOrder.orderStatus)}
            </DialogTitle>
            <DialogDescription>
              {selectedOrder ? `Item ID: ${selectedOrder.orderItemId} · Placed on ${selectedOrder.orderDate}` : "Order Details"}
            </DialogDescription>
          </DialogHeader>

          {selectedOrder && (
            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <span className="text-slate-500 font-medium block mb-1">Product Details</span>
                <p className="text-slate-900 dark:text-slate-100 font-semibold">{selectedOrder.title}</p>
                <div className="mt-2 flex gap-4 font-mono text-[11px] text-slate-500">
                  <span>FSN: {selectedOrder.fsn}</span>
                  <span>SKU: {selectedOrder.sku}</span>
                  <span>Qty: {selectedOrder.quantity}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                  <span className="text-slate-500 block mb-1">Pricing Breakdown</span>
                  <p className="flex justify-between">
                    <span>Selling Price:</span> <strong>{formatInr(selectedOrder.sellingPrice)}</strong>
                  </p>
                  <p className="flex justify-between mt-1">
                    <span>Tax (GST 18%):</span> <strong>{formatInr(selectedOrder.taxAmount)}</strong>
                  </p>
                  <p className="flex justify-between mt-1 pt-1 border-t font-bold text-slate-900 dark:text-slate-100">
                    <span>Total Price:</span> <span>{formatInr(selectedOrder.totalPrice)}</span>
                  </p>
                </div>

                <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                  <span className="text-slate-500 block mb-1">Shipping &amp; Delivery</span>
                  <p className="text-slate-800 dark:text-slate-200 font-medium">
                    {selectedOrder.deliveryAddress?.name || "Customer"}
                  </p>
                  <p className="text-slate-500 text-[11px] mt-0.5">
                    {selectedOrder.deliveryAddress?.city}, {selectedOrder.deliveryAddress?.state} - {selectedOrder.deliveryAddress?.postalCode}
                  </p>
                  <p className="mt-2 text-slate-500 text-[11px]">
                    Fulfilment: <strong>{selectedOrder.fulfilmentType}</strong>
                  </p>
                </div>
              </div>

              {selectedOrder.trackingId && (
                <div className="p-2.5 rounded bg-blue-50/60 dark:bg-blue-950/30 text-blue-800 dark:text-blue-300 border border-blue-200 text-xs">
                  Tracking AWB: <strong>{selectedOrder.trackingId}</strong>
                </div>
              )}

              <div className="pt-2 flex justify-end">
                <Button variant="outline" size="sm" onClick={() => setSelectedOrder(null)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── API Keys Setup Guide Dialog ── */}
      <Dialog open={setupGuideOpen} onOpenChange={setSetupGuideOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-[#2874F0]" /> How to Add Flipkart API Keys
            </DialogTitle>
            <DialogDescription>
              Step-by-step instructions to configure Flipkart Seller API credentials once provided by your manager.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-xs text-slate-600 dark:text-slate-300">
            <ol className="list-decimal pl-4 space-y-2">
              <li>
                Ask your manager for the <strong>Flipkart Application ID</strong> (Client ID) and <strong>Application Secret</strong> (Client Secret) from the Flipkart Developer Portal.
              </li>
              <li>
                Open the file <code className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[11px]">backend/.env</code> in the project.
              </li>
              <li>
                Paste your credentials into the Flipkart section shown below:
              </li>
            </ol>

            <div className="relative rounded-lg bg-slate-900 text-slate-100 p-3 font-mono text-[11px] overflow-x-auto">
              <pre>{`# --- Flipkart Marketplace API ---
FLIPKART_APP_ID=your_flipkart_app_id_here
FLIPKART_APP_SECRET=your_flipkart_app_secret_here
FLIPKART_SELLER_ID=your_seller_id_here
FLIPKART_API_ENDPOINT=https://api.flipkart.net/sellers
FLIPKART_SANDBOX=false`}</pre>
              <button
                onClick={copyEnvSnippet}
                className="absolute right-2.5 top-2.5 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center gap-1 text-[11px] transition-colors"
              >
                {copiedEnv ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" /> Copy
                  </>
                )}
              </button>
            </div>

            <p className="text-slate-500 italic">
              Once saved, restart or let the backend reload, and the dashboard will automatically switch from simulated preview mode to live Flipkart Seller API mode!
            </p>
          </div>

          <div className="flex justify-end pt-3">
            <Button onClick={() => setSetupGuideOpen(false)}>Got It</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
