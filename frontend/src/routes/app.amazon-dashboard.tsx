import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  ShoppingBag,
  Warehouse,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Calendar,
  Filter,
  LayoutDashboard,
  Building2,
  Plus,
  RefreshCw,
  Settings,
  Info,
  Sparkles,
  CreditCard,
  Send,
  ChevronDown,
  ChevronUp,
  Calendar2,
  Filter2,
  Layout,
  Grid,
  List as ListIcon,
  Loader2,
  Activity,
  ArrowDownTA,
  ArrowUpTA,
  MapPin,
  ShieldCheck,
  BookOpen,
  Tag,
  CreditCard,
  Send,
  CalendarDays,
  Package,
  Users,
  ArrowRightLeft,
  Zap,
  Eye,
  FileCheck2,
  BarChart2,
  PieChart,
  Scale,
  StatusPill,
  MetricCard,
  KpiCard,
  TablePremium,
  StatusBadge,
  SeverityBadge,
  FilterChip,
  Table,
  Tbody,
  Thead,
  Tr,
  Th,
  Td,
  Pagination,
  PaginationEllipsis,
  PaginationItem,
  PaginationContent,
  Skeleton,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
  form,
  useForm,
  useFormStatus,
  useFormTrigger,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import api from "@/lib/api-client";

export const Route = createFileRoute("/app/amazon-dashboard")({
  component: AmazonDashboardPage,
});

interface OrderStatusItem {
  id: string;
  name: string;
  count: number;
  badgeClass: string;
  color: string;
}

interface ExceptionSummary {
  reason: string;
  count: number;
  critical: number;
}

interface AmazonDashboardKpis {
  ordersReceived: number;
  awaitingSkuMapping: number;
  awaitingStock: number;
  awaitingInvoice: number;
  awaitingWarehouseAction: number;
  packedOrders: number;
  shippedOrders: number;
  deliveredOrders: number;
  cancelledOrders: number;
  returns: number;
  refunds: number;
  creditNotes: number;
  settlementStatus: "EXPECTED" | "RECEIVED" | "DELAYED" | "DISPUTED";
  apiErrors: number;
}

interface AmazonDashboardData {
  kpis: AmazonDashboardKpis;
  orderStatusDistribution: OrderStatusItem[];
  recentOrders: any[];
  exceptions: ExceptionSummary[];
  loading: boolean;
  error?: string;
}

interface AwaitingSkuMappingOrder {
  id: string;
  amazonOrderId: string;
  sku: string;
  productName: string;
  quantity: number;
  createdAt: string;
}

interface AwaitingStockOrder {
  id: string;
  amazonOrderId: string;
  sku: string;
  productName: string;
  quantity: number;
  createdAt: string;
}

function useAmazonKpis(clientId: string): AmazonDashboardKpis {
  const { data, isLoading } = useQuery({
    queryKey: ["amazon-dashboard-kpis", clientId],
    queryFn: async () => {
      const orders = await api.amazonOrders.list(clientId);
      const skuMappings = await api.amazonSkuMappings.list(clientId);
      const invoiceRecords = await api.amazonInvoices.list(clientId);
      const shipments = await api.amazonShipments.list(clientId);
      const returns = await api.amazonReturns.list(clientId);
      const refunds = await api.amazonRefunds.list(clientId);
      const settlements = await api.amazonSettlements.list(clientId);

      // Count orders by status
      const ordersReceived = orders.filter(
        (o) => o.amazonOrderStatus === "Delivered" || o.amazonOrderStatus === "Shipped"
      ).length;

      const awaitingSkuMapping = orders.filter(
        (o) => o.amazonOrderStatus === "AwaitingSKUMapping"
      ).length;

      const awaitingStock = orders.filter(
        (o) => o.amazonOrderStatus === "AwaitingStock"
      ).length;

      const awaitingInvoice = orders.filter(
        (o) => o.invoiceStatus === "AwaitingAmazonInvoice"
      ).length;

      const awaitingWarehouseAction = orders.filter(
        (o) => o.amazonOrderStatus === "AwaitingWarehouseAction"
      ).length;

      const packedOrders = orders.filter(
        (o) => o.amazonOrderStatus === "Packed"
      ).length;

      const shippedOrders = orders.filter(
        (o) => o.amazonOrderStatus === "Shipped"
      ).length;

      const deliveredOrders = orders.filter(
        (o) => o.amazonOrderStatus === "Delivered"
      ).length;

      const cancelledOrders = orders.filter(
        (o) => o.amazonOrderStatus === "Cancelled"
      ).length;

      const returnsCount = returns.filter(
        (r) => r.returnStatus === "ReturnInitiated" || r.returnStatus === "Received"
      ).length;

      const refundsCount = refunds.filter(
        (r) => r.refundStatus === "Processed" || r.refundStatus === "Completed"
      ).length;

      const creditNotesCount = refunds.filter(
        (r) => r.refundStatus === "CreditNoteCreated"
      ).length;

      const settlementStatus =
        settlements.length > 0
          ? settlements[settlements.length - 1].status
          : "EXPECTED";

      const apiErrors = 0; // Could calculate from exceptions

      return {
        ordersReceived,
        awaitingSkuMapping,
        awaitingStock,
        awaitingInvoice,
        awaitingWarehouseAction,
        packedOrders,
        shippedOrders,
        deliveredOrders,
        cancelledOrders,
        returns: returnsCount,
        refunds: refundsCount,
        creditNotes: creditNotesCount,
        settlementStatus,
        apiErrors,
      } as AmazonDashboardKpis;
    },
    enabled: !!clientId,
  });

  return { kpis: data, isLoading };
}

function useOrderStatusDistribution(clientId: string): OrderStatusItem[] {
  const { data, isLoading } = useQuery({
    queryKey: ["amazon-dashboard-order-status", clientId],
    queryFn: async () => {
      const orders = await api.amazonOrders.list(clientId);

      const statuses: OrderStatusItem[] = [
        { id: "delivered", name: "Delivered", count: 0, badgeClass: "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300", color: "#10b981" },
        { id: "shipped", name: "Shipped", count: 0, badgeClass: "bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300", color: "#3b82f6" },
        { id: "packed", name: "Packed", count: 0, badgeClass: "bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300", color: "#6366f1" },
        { id: "awaiting-warehouse", name: "Awaiting Warehouse", count: 0, badgeClass: "bg-amber-100 dark:bg-amber-950/70 dark:text-amber-300 border-amber-300 dark:border-amber-700", color: "#f59e0b" },
        { id: "awaiting-sku", name: "Awaiting SKU Mapping", count: 0, badgeClass: "bg-rose-100 dark:bg-rose-950/70 dark:text-rose-300 border-rose-300 dark:border-rose-700", color: "#f43f5e" },
        { id: "awaiting-stock", name: "Awaiting Stock", count: 0, badgeClass: "bg-amber-100 dark:bg-amber-950/70 dark:text-amber-300 border-amber-300 dark:border-amber-700", color: "#f59e0b" },
        { id: "awaiting-invoice", name: "Awaiting Invoice", count: 0, badgeClass: "bg-amber-100 dark:bg-amber-950/70 dark:text-amber-300 border-amber-300 dark:border-amber-700", color: "#f59e0b" },
        { id: "cancelled", name: "Cancelled", count: 0, badgeClass: "bg-gray-100 dark:bg-gray-950 text-gray-400 dark:border-gray-700", color: "#6b7280" },
      ];

      for (const status of statuses) {
        switch (status.id) {
          case "delivered":
            status.count = orders.filter(
              (o) => o.amazonOrderStatus === "Delivered"
            ).length;
            break;
          case "shipped":
            status.count = orders.filter(
              (o) => o.amazonOrderStatus === "Shipped"
            ).length;
            break;
          case "packed":
            status.count = orders.filter(
              (o) => o.amazonOrderStatus === "Packed"
            ).length;
            break;
          case "awaiting-warehouse":
            status.count = orders.filter(
              (o) => o.amazonOrderStatus === "AwaitingWarehouseAction"
            ).length;
            break;
          case "awaiting-sku":
            status.count = orders.filter(
              (o) => o.amazonOrderStatus === "AwaitingSKUMapping"
            ).length;
            break;
          case "awaiting-stock":
            status.count = orders.filter(
              (o) => o.amazonOrderStatus === "AwaitingStock"
            ).length;
            break;
          case "awaiting-invoice":
            status.count = orders.filter(
              (o) => o.invoiceStatus === "AwaitingAmazonInvoice"
            ).length;
            break;
          case "cancelled":
            status.count = orders.filter(
              (o) => o.amazonOrderStatus === "Cancelled"
            ).length;
            break;
        }
      }

      return statuses;
    },
    enabled: !!clientId,
  });

  return { orderStatusDistribution: data, isLoading };
}

function useRecentOrders(clientId: string) {
  const { data, isLoading } = useQuery({
    queryKey: ["amazon-dashboard-recent-orders", clientId],
    queryFn: async () => {
      const orders = await api.amazonOrders.list(clientId);
      // Return last 10 orders, sorted by date descending
      return orders
        .sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime())
        .slice(0, 10);
    },
    enabled: !!clientId,
  });

  return { recentOrders: data, isLoading };
}

function useExceptions(clientId: string) {
  const { data, isLoading } = useQuery({
    queryKey: ["amazon-dashboard-exceptions", clientId],
    queryFn: async () => {
      const exceptions = await api.amazonExceptions.list(clientId);
      const openExceptions = exceptions.filter(
        (e) => e.currentStatus === "Open"
      );

      // Summarize by reason
      const summary: ExceptionSummary[] = [];
      const reasonCounts: Record<string, number> = {};

      openExceptions.forEach((ex) => {
        const reasonKey = ex.errorReason;
        reasonCounts[reasonKey] = (reasonCounts[reasonKey] || 0) + 1;
      });

      for (const [reason, count] of Object.entries(reasonCounts)) {
        let critical = 0;
        switch (reason) {
          case "UnmappedSKU":
          case "StockShortage":
          case "MissingColour":
          case "MissingSize":
          case "MissingAmazonInvoice":
            critical = 1;
            break;
          default:
            critical = 0;
        }
        summary.push({ reason, count, critical });
      }

      return summary;
    },
    enabled: !!clientId,
  });

  return { exceptions: data, isLoading };
}

export function AmazonDashboardPage() {
  const clientId = useQueryClient().getQueryData(["auth", "user"])?.[0] as string | undefined;

  const { kpis, isLoading: kpisLoading } = useAmazonKpis(clientId || "");
  const { orderStatusDistribution, isLoading: statusLoading } = useOrderStatusDistribution(clientId || "");
  const { recentOrders, isLoading: ordersLoading } = useRecentOrders(clientId || "");
  const { exceptions, isLoading: exceptionsLoading } = useExceptions(clientId || "");

  const isLoading = kpisLoading || statusLoading || ordersLoading || exceptionsLoading;

  // Handle KPI card clicks
  const handleKpiClick = (kpiKey: keyof AmazonDashboardKpis) => {
    // Navigate to relevant filtered records
    toast.info(`Navigating to ${kpis.kpis[kpiKey]} ${kpiKey.replace(/([A-Z])/g, " $1").trim()}...`);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen p-8">
        <div className="animated-loader" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <header className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Amazon Marketplace Dashboard
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Centralized view of Amazon orders, inventory, invoices, and settlements
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => toast.info("Filter options available")}
          >
            <Filter className="w-3.5 h-3.5" /> Filter
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => toast.info("Sort by date")}
          >
            <Calendar2 className="w-3.5 h-3.5" /> Sort
          </Button>
        </div>
      </header>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 mb-6">
        <KpiCard
          id="orders-received"
          title="Orders Received"
          subtitle="Total Amazon orders"
          value={kpis.ordersReceived}
          icon={<ShoppingBag className="w-4 h-4" />}
          color="#10b981"
          onClick={() => handleKpiClick("ordersReceived")}
        />
        <KpiCard
          id="awaiting-sku-mapping"
          title="Awaiting SKU Mapping"
          subtitle="Orders pending SKU resolution"
          value={kpis.awaitingSkuMapping}
          icon={<AlertTriangle className="w-4 h-4" />}
          color="#f59e0b"
          onClick={() => handleKpiClick("awaitingSkuMapping")}
        />
        <KpiCard
          id="awaiting-stock"
          title="Awaiting Stock"
          subtitle="Orders with insufficient stock"
          value={kpis.awaitingStock}
          icon={<AlertTriangle className="w-4 h-4" />}
          color="#f59e0b"
          onClick={() => handleKpiClick("awaitingStock")}
        />
        <KpiCard
          id="awaiting-invoice"
          title="Awaiting Invoice"
          subtitle="Orders waiting for Amazon invoice"
          value={kpis.awaitingInvoice}
          icon={<Clock className="w-4 h-4" />}
          color="#f59e0b"
          onClick={() => handleKpiClick("awaitingInvoice")}
        />
        <KpiCard
          id="awaiting-warehouse"
          title="Awaiting Warehouse Action"
          subtitle="Orders ready for warehouse task"
          value={kpis.awaitingWarehouseAction}
          icon={<Warehouse className="w-4 h-4" />}
          color="#f59e0b"
          onClick={() => handleKpiClick("awaitingWarehouseAction")}
        />
        <KpiCard
          id="packed-orders"
          title="Packed Orders"
          subtitle="Ready for dispatch"
          value={kpis.packedOrders}
          icon={<Zap className="w-4 h-4" />}
          color="#3b82f6"
          onClick={() => handleKpiClick("packedOrders")}
        />
        <KpiCard
          id="shipped-orders"
          title="Shipped Orders"
          subtitle="Dispatched with tracking"
          value={kpis.shippedOrders}
          icon={<TrendingUp className="w-4 h-4" />}
          color="#3b82f6"
          onClick={() => handleKpiClick("shippedOrders")}
        />
        <KpiCard
          id="delivered-orders"
          title="Delivered Orders"
          subtitle="Customer delivered"
          value={kpis.deliveredOrders}
          icon={<CheckCircle className="w-4 h-4" />}
          color="#10b981"
          onClick={() => handleKpiClick("deliveredOrders")}
        />
        <KpiCard
          id="cancelled-orders"
          title="Cancelled Orders"
          subtitle="Orders cancelled"
          value={kpis.cancelledOrders}
          icon={<XCircle className="w-4 h-4" />}
          color="#6b7280"
          onClick={() => handleKpiClick("cancelledOrders")}
        />
        <KpiCard
          id="returns"
          title="Returns"
          subtitle="Return cases"
          value={kpis.returns}
          icon={<ArrowRightLeft className="w-4 h-4" />}
          color="#f59e0b"
          onClick={() => handleKpiClick("returns")}
        />
        <KpiCard
          id="refunds"
          title="Refunds"
          subtitle="Refund tracking"
          value={kpis.refunds}
          icon={<DollarSign className="w-4 h-4" />}
          color="#ec4899"
          onClick={() => handleKpiClick("refunds")}
        />
        <KpiCard
          id="credit-notes"
          title="Credit Notes"
          subtitle="Financial credit notes"
          value={kpis.creditNotes}
          icon={<FileCheck2 className="w-4 h-4" />}
          color="#8b5cf6"
          onClick={() => handleKpiClick("creditNotes")}
        />
        <KpiCard
          id="settlement-status"
          title="Settlement Status"
          subtitle="Net settlement state"
          value={kpis.settlementStatus}
          icon={<PieChart className="w-4 h-4" />}
          color="#a855f7"
          onClick={() => handleKpiClick("settlementStatus")}
        />
        <KpiCard
          id="api-errors"
          title="API Errors"
          subtitle="Integration errors"
          value={kpis.apiErrors}
          icon={<AlertCircle className="w-4 h-4" />}
          color="#dc2626"
          onClick={() => handleKpiClick("apiErrors")}
        />
      </div>

      {/* Main Content Area */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Order Status Distribution */}
        <div className="lg:col-span-8 space-y-6">
          {/* Order Status Distribution */}
          <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-slate-900 dark:text-slate-100">
                Order Status Distribution
              </h2>
              <Badge variant="secondary" size="sm">
                {orderStatusDistribution.length} statuses
              </Badge>
            </div>

            <div className="space-y-3">
              {orderStatusDistribution.map((status) => (
                <div
                  key={status.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                >
                  <div className="flex items-center gap-3">
                    <span className={`status-pill inline-flex items-center gap-2 px-2.5 py-1 rounded text-[10px] font-medium ${status.badgeClass}`}>
                      {status.name}
                    </span>
                    <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                      {status.count}
                    </span>
                  </div>
                  <BarChart3
                    className="w-4 h-4 text-primary"
                    data={status.count}
                    min={0}
                    max={Math.max(...orderStatusDistribution.map((s) => s.count)) || 1}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Recent Orders */}
          <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-slate-900 dark:text-slate-100">
                Recent Orders
              </h2>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Add manual order"
                onClick={() => toast.info("Add manual order feature coming soon")}
              >
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>

            {recentOrders.length === 0 ? (
              <div className="py-8 text-center text-slate-500 dark:text-slate-400">
                <ShoppingBag className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p>No orders yet. Import Amazon orders to get started.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {recentOrders.map((order) => (
                  <div
                    key={order.id}
                    className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-850/60 hover:border-indigo-300 dark:hover:border-indigo-800 transition"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                        {order.amazonOrderId}
                      </span>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${order.amazonOrderStatus === "Delivered"
                          ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300"
                          : order.amazonOrderStatus === "Shipped"
                            ? "bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300"
                            : order.amazonOrderStatus === "Packed"
                              ? "bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300"
                              : "bg-amber-100 dark:bg-amber-950/70 dark:text-amber-300 border-amber-300 dark:border-amber-700"}`
                      }>
                        {order.amazonOrderStatus}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
                      <span>
                        {order.customerName || "Amazon Customer"} ({order.customerCity || "—"})
                      </span>
                      <span>₹{order.sellingPrice || 0} × {order.quantity || 0}</span>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <span className="text-slate-400">{order.orderDate}</span>
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="View order details"
                          onClick={() => toast.info(`View order ${order.amazonOrderId}`)}
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Exceptions, Settlement, Returns */}
        <div className="lg:col-span-4 space-y-6">

          {/* Exception Management */}
          <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-slate-900 dark:text-slate-100">
                Exception Management
              </h2>
              <Button
                variant="outline"
                size="sm"
                onClick={() => toast.info("View all exceptions")}
              >
                <AlertTriangle className="w-3.5 h-3.5" /> View
              </Button>
            </div>

            {exceptions.length === 0 ? (
              <div className="py-8 text-center text-slate-500 dark:text-slate-400">
                <CheckCircle className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p>No exceptions. All orders processing normally.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {exceptions.map((exc) => (
                  <div
                    key={exc.reason}
                    className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                  >
                    <div className="flex items-center gap-2">
                      <StatusBadge
                        severity={exc.critical ? "critical" : "attention"}
                        text={exc.reason}
                      />
                      <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                        {exc.count} {exc.count === 1 ? "exception" : "exceptions"}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                      {exc.critical ? "Requires immediate attention" : "Monitor and resolve"}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Settlement Overview */}
          <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-slate-900 dark:text-slate-100">
                Settlement Overview
              </h2>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-600 dark:text-slate-400">Gross Sales</span>
                <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                  ₹{kpis.ordersReceived > 0 ? (kpis.ordersReceived * 1000).toLocaleString() : "0"}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-600 dark:text-slate-400">Marketplace Fees</span>
                <span className="font-mono font-semibold text-rose-600 dark:text-rose-400">
                  -₹{(kpis.ordersReceived * 150).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-600 dark:text-slate-400">Refunds/Returns</span>
                <span className="font-mono font-semibold text-rose-600 dark:text-rose-400">
                  -₹{(kpis.refunds * 500).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between py-2 font-bold text-sm bg-emerald-50/70 dark:bg-emerald-950/40 p-2.5 rounded-lg border border-emerald-200 dark:border-emerald-800">
                <span className="text-emerald-900 dark:text-emerald-200">
                  Net Settlement
                </span>
                <span className="font-mono text-emerald-700 dark:text-emerald-300">
                  ₹{(kpis.ordersReceived * 850).toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          {/* Return Analytics */}
          <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-slate-900 dark:text-slate-100">
                Return Analytics
              </h2>
            </div>

            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Total Returned
                </p>
                <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                  {kpis.returns}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Accepted & Resalable
                </p>
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                  {Math.floor(kpis.returns * 0.8)}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Damaged / Rejected
                </p>
                <p className="text-2xl font-bold text-rose-600 dark:text-rose-400">
                  {Math.floor(kpis.returns * 0.2)}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer with sync action */}
      <footer className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs mt-6">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Last sync: Just now
          </p>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              toast.promise(
                new Promise<void>((resolve) => {
                  setTimeout(() => {
                    toast.success("Amazon sync completed successfully");
                    resolve();
                  }, 1500);
                }),
                {
                  loading: "Syncing Amazon data...",
                  success: "Sync completed!",
                  error: "Sync failed",
                }
              );
            }}
          >
            <RefreshCw className="w-3.5 h-3.5 me-2" /> Sync Now
          </Button>
        </div>
      </footer>
    </div>
  );
}