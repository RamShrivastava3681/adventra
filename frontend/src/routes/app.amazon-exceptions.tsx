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

export const Route = createFileRoute("/app/amazon-exceptions")({
  component: AmazonExceptionsPage,
});

interface ExceptionItem {
  id: string;
  affectedOrder: string;
  errorReason: string;
  errorMessage: string;
  affectedItem?: string;
  lastAttempt: string | null;
  retryCount: number;
  maxRetries: number;
  responsibleUser: string | null;
  currentStatus: "Open" | "InProgress" | "Resolved" | "Closed";
  resolutionNotes: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

interface ExceptionFilter {
  status: "Open" | "Resolved" | "All";
  reason: string | null;
}

export function AmazonExceptionsPage() {
  const clientId = useQueryClient().getQueryData(["auth", "user"])?.[0] as string | undefined;
  const { data: exceptions, isLoading } = useQuery({
    queryKey: ["amazon-exceptions-list", clientId],
    queryFn: async () => {
      if (!clientId) return [];
      return api.get<any[]>(`/amazon/exceptions`);
    },
    enabled: !!clientId,
  });

  const [filter, setFilter] = useState<ExceptionFilter>({
    status: "Open",
    reason: null,
  });

  const filteredExceptions = useMemo(() => {
    if (!exceptions) return [];
    let filtered = exceptions;

    if (filter.status !== "All") {
      filtered = filtered.filter((e: any) => e.currentStatus === filter.status);
    }

    if (filter.reason) {
      filtered = filtered.filter((e: any) => e.errorReason === filter.reason);
    }

    return filtered;
  }, [exceptions, filter]);

  const [showResolveModal, setShowResolveModal] = useState(false);
  const [selectedExceptionId, setSelectedExceptionId] = useState<string | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState("");

  const handleResolveException = async () => {
    if (!selectedExceptionId) return;

    try {
      await api.put(`/amazon/exceptions/${selectedExceptionId}/resolve`, {
        resolutionNotes: resolutionNotes || "Resolved via dashboard",
        responsibleUser: "admin",
      });

      setShowResolveModal(false);
      setSelectedExceptionId(null);
      setResolutionNotes("");
      toast.exception("Exception resolved successfully");
      qc.invalidateQueries(["amazon-exceptions-list"]);
    } catch (err: any) {
      toast.error(err.message || "Failed to resolve exception");
    }
  };

  const handleRetryException = async () => {
    if (!selectedExceptionId) return;

    try {
      await api.put(`/amazon/exceptions/${selectedExceptionId}/retry`, {});

      toast.success("Retry incremented - will re-attempt failed operation");
      qc.invalidateQueries(["amazon-exceptions-list"]);
    } catch (err: any) {
      toast.error(err.message || "Failed to increment retry");
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen p-8">
        <div className="animated-loader" />
        <p className="mt-4 text-slate-500">Loading exceptions...</p>
      </div>
    );
  }

  const openCount = filteredExceptions.filter(
    (e: any) => e.currentStatus === "Open"
  ).length;
  const resolvedCount = filteredExceptions.filter(
    (e: any) => e.currentStatus === "Resolved"
  ).length;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col sm:flex-row gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Exception Management
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Centralized exception management for Amazon integration
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFilter((f) => ({ ...f, status: "All }))}
          >
            All ({filteredExceptions.length})
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFilter((f) => ({ ...f, status: "Open }))}
          >
            Open ({openCount})
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFilter((f) => ({ ...f, status: "Resolved }))}
          >
            Resolved ({resolvedCount})
          </Button>
        </div>
      </header>

      {/* Filter Section */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <Label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
            Status Filter
          </Label>
          <Select
            onValueChange={(value: string) =>
              setFilter((f) => ({ ...f, status: value as any }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Open">Open</SelectItem>
              <SelectItem value="Resolved">Resolved</SelectItem>
              <SelectItem value="All">All</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
            Error Reason Filter
          </Label>
          <Select
            onValueChange={(value: string) =>
              setFilter((f) => ({ ...f, reason: value || null }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Select reason" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Reasons</SelectItem>
              <SelectItem value="UnmappedSKU">Unmapped SKU</SelectItem>
              <SelectItem value="StockShortage">Stock Shortage</SelectItem>
              <SelectItem value="MissingColour">Missing Colour</SelectItem>
              <SelectItem value="MissingSize">Missing Size</SelectItem>
              <SelectItem value="MissingAmazonInvoice">Missing Amazon Invoice</SelectItem>
              <SelectItem value="ShipmentConfirmationFailure">Shipment Confirmation Failure</SelectItem>
              <SelectItem value="IncompleteReturnInformation">Incomplete Return Information</SelectItem>
              <SelectItem value="SettlementDiscrepancy">Settlement Discrepancy</SelectItem>
              <SelectItem value="APIAuthenticationFailure">API Authentication Failure</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Exceptions Table */}
      <div className="overflow-x-auto rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Error Reason</TableHead>
                <TableHead>Affected Item</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Retry Count</TableHead>
                <TableHead>Last Attempt</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredExceptions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-slate-500 dark:text-slate-400">
                    <CheckCircle className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p>No exceptions found matching your filters.</p>
                  </TableCell>
                </TableRow>
              ) : filteredExceptions.map((exc: any) => (
                <TableRow key={exc.id}>
                  <TableCell className="font-medium text-slate-800 dark:text-slate-200">
                    {exc.affectedOrder}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      severity={
                        exc.errorReason === "UnmappedSKU" ||
                        exc.errorReason === "StockShortage"
                          ? "critical"
                          : "attention"
                    }
                    >
                      {exc.errorReason}
                    </StatusBadge>
                  </TableCell>
                  <TableCell>{exc.affectedItem || "—"}</TableCell>
                  <TableCell>
                    <StatusPill
                      className={`inline-flex items-center gap-2 px-2.5 py-1 rounded text-[10px] font-medium ${
                        exc.currentStatus === "Open"
                          ? "bg-amber-100 dark:bg-amber-950/70 dark:text-amber-300 border-amber-300 dark:border-amber-700"
                          : exc.currentStatus === "Resolved"
                            ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300"
                            : "bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300"
                      }`}
                    >
                      {exc.currentStatus}
                    </StatusPill>
                  </TableCell>
                  <TableCell className="font-mono text-[10px]">
                    {exc.retryCount}/{exc.maxRetries}
                  </TableCell>
                  <TableCell className="text-[10px] text-slate-500 dark:text-slate-400">
                    {exc.lastAttempt || "Never"}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Resolve exception"
                        onClick={() => {
                          setSelectedExceptionId(exc.id);
                          setResolutionNotes("");
                          setShowResolveModal(true);
                        }}
                      >
                        <CheckCircle className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Retry exception"
                        onClick={() => handleRetryException()}
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </div>

      {/* Resolve Exception Modal */}
      {showResolveModal && (
        <Dialog open={true} onOpenChange={({ removed }: any) => setShowResolveModal(!removed)} className="max-w-2xl">
          <DialogOverlay />
          <DialogContent className="p-6 sm:p-8">
            <DialogHeader>
              <DialogTitle>
                Resolve Exception
              </DialogTitle>
              <DialogDescription>
                Resolve the selected exception with notes
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleResolveException} className="mt-4">
              <div className="space-y-3">
                <textarea
                  id="resolution-notes"
                  rows={3}
                  placeholder="Enter resolution notes..."
                  value={resolutionNotes}
                  onChange={(e) =>
                    setResolutionNotes(e.target.value)
                  }
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex gap-3 mt-6">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setShowResolveModal(false);
                    setSelectedExceptionId(null);
                    setResolutionNotes("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                >
                  Resolve Exception
                </Button>
              </div>
            </form>
          </DialogClose>
        </Dialog>
      )}
    </div>
  );
}