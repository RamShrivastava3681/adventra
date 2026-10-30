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

export const Route = createFileRoute("/app/amazon-returns-settlement")({
  component: AmazonReturnsSettlementPage,
});

interface AmazonReturn {
  id: string;
  amazonOrderId: string;
  whizunikSalesOrderId: string;
  amazonReturnId: string | null;
  returnStatus: string;
  quantityReturned: number;
  quantityAccepted: number;
  quantityDamaged: number;
  quantityMissing: number;
  returnReason: string | null;
  conditionDescription: string | null;
  goodsReceivedAt: string | null;
  warehouseInspectionNotes: string | null;
  checkerId: string | null;
  checkerName: string | null;
  checkerApprovedAt: string | null;
  creditNoteId: string | null;
  refundReference: string | null;
  refundStatus: string;
  createdAt: string;
  updatedAt: string;
}

interface SettlementSummary {
  grossSales: number;
  marketplaceFees: number;
  deductions: number;
  refundsReturns: number;
  netSettlementExpected: number;
  status: string;
}

interface ReturnAnalytics {
  totalReturned: number;
  acceptedAndResalable: number;
  damagedOrRejected: number;
  missing: number;
}

interface ReconciliationDetails {
  amazonOrderId: string;
  orderStatus: string;
  invoiceStatus: string;
  quantity: number;
  unitPrice: number;
  totalValue: number;
  mappingStatus: string;
  stockStatus: string;
  invoiceReceived: boolean;
  dispatchStatus: string;
}

export function AmazonReturnsSettlementPage() {
  const clientId = useQueryClient().getQueryData(["auth", "user"])?.[0] as string | undefined;
  const {
    data: returns,
    isLoading: returnsLoading,
  } = useQuery({
    queryKey: ["amazon-returns", clientId],
    queryFn: async () => {
      if (!clientId) return [];
      return api.get<any[]>(`/amazon/returns`);
    },
    enabled: !!clientId,
  });

  const {
    data: refunds,
    isLoading: refundsLoading,
  } = useQuery({
    queryKey: ["amazon-refunds", clientId],
    queryFn: async () => {
      if (!clientId) return [];
      return api.get<any[]>(`/amazon/refunds`);
    },
    enabled: !!clientId,
  });

  const {
    data: settlements,
    isLoading: settlementsLoading,
  } = useQuery({
    queryKey: ["amazon-settlements", clientId],
    queryFn: async () => {
      if (!clientId) return [];
      return api.get<any[]>(`/amazon/settlements/summary`);
    },
    enabled: !!clientId,
  });

  const [showReturnModal, setShowReturnModal] = useState(false);
  const [formMode, setFormMode] useState<"create" | "edit">("create");
  const [returnForm, setReturnForm] = useState<{
    amazonOrderId: string;
    whizunikSalesOrderId: string;
    amazonReturnId: string | null;
    returnStatus: string;
    quantityReturned: number;
    quantityAccepted: number;
    quantityDamaged: number;
    quantityMissing: number;
    returnReason: string | null;
    conditionDescription: string | null;
  }>({
    amazonOrderId: "",
    whizunikSalesOrderId: "",
    amazonReturnId: null,
    returnStatus: "ReturnInitiated",
    quantityReturned: 0,
    quantityAccepted: 0,
    quantityDamaged: 0,
    quantityMissing: 0,
    returnReason: "",
    conditionDescription: "",
  });
  const [editReturnId, setEditReturnId] = useState<string | null>(null);

  const [showSettlementModal, setShowSettlementModal] = useState(false);
  const [settlementId, setSettlementId] = useState<string | null>(null);

  const [showReconcileModal, setShowReconcileModal] = useState(false);
  const [selectedSettlementId, setSelectedSettlementId] = useState<string | null>(null);

  if (returnsLoading || refundsLoading || settlementsLoading) {
    return (
      <div className="min-h-screen p-8">
        <div className="animated-loader" />
        <p className="mt-4 text-slate-500">Loading returns, refunds, and settlements...</p>
      </div>
    );
  }

  // Calculate return analytics
  const totalReturned = returns.reduce((sum, r) => sum + r.quantityReturned, 0);
  const acceptedAndResalable = returns.reduce(
    (sum, r) => sum + (r.quantityAccepted || 0),
    0
  );
  const damagedOrRejected = returns.reduce(
    (sum, r) => sum + (r.quantityDamaged || 0),
    0
  );
  const missing = returns.reduce((sum, r) => sum + (r.quantityMissing || 0), 0);

  // Settlement totals
  const totalGrossSettlements = settlements.reduce(
    (sum, s) => sum + s.grossSales,
    0
  );
  const totalFeesSettlements = settlements.reduce(
    (sum, s) => sum + s.marketplaceFees,
    0
  );
  const totalDeductionsSettlements = settlements.reduce(
    (sum, s) => sum + s.deductions,
    0
  );
  const totalRefundsSettlements = settlements.reduce(
    (sum, s) => sum + s.refundsReturns,
    0
  );
  const totalNetSettlements = settlements.reduce(
    (sum, s) => sum + s.netSettlementExpected,
    0
  );

  // Handle create return
  const handleCreateReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returnForm.amazonOrderId) {
      toast.error("Amazon Order ID is required");
      return;
    }
    if (returnForm.quantityReturned <= 0) {
      toast.error("Quantity returned must be greater than zero");
      return;
    }

    try {
      await api.post("/amazon/returns", {
        clientId: clientId || "",
        amazonOrderId: returnForm.amazonOrderId,
        whizunikSalesOrderId: returnForm.whizunikSalesOrderId,
        amazonReturnId: returnForm.amazonReturnId,
        returnStatus: returnForm.returnStatus,
        quantityReturned: returnForm.quantityReturned,
        quantityAccepted: returnForm.quantityAccepted,
        quantityDamaged: returnForm.quantityDamaged,
        quantityMissing: returnForm.quantityMissing,
        returnReason: returnForm.returnReason,
        conditionDescription: returnForm.conditionDescription,
      });

      setShowReturnModal(false);
      setFormMode("create");
      setReturnForm({
        amazonOrderId: "",
        whizunikSalesOrderId: "",
        amazonReturnId: null,
        returnStatus: "ReturnInitiated",
        quantityReturned: 0,
        quantityAccepted: 0,
        quantityDamaged: 0,
        quantityMissing: 0,
        returnReason: "",
        conditionDescription: "",
      });
      toast.success("Amazon return created successfully");
      qc.invalidateQueries(["amazon-returns"]);
    } catch (err: any) {
      toast.error(err.message || "Failed to create return");
    }
  };

  // Handle reconcile settlement
  const handleReconcileSettlement = async (settlementId: string) => {
    try {
      await api.put(`/amazon/settlements/reconcile/${settlementId}`, {});
      toast.success("Settlement reconciled successfully");
      qc.invalidateQueries(["amazon-settlements"]);
    } catch (err: any) {
      toast.error(err.message || "Failed to reconcile settlement");
    }
  };

  // Handle finalize return
  const handleFinalizeReturn = async (returnId: string, data: any) => {
    try {
      await api.put("/amazon/returns/finalize", {
        returnId,
        quantityAccepted: data.quantityAccepted,
        quantityDamaged: data.quantityDamaged,
        refundReference: data.refundReference,
        checkerId: data.checkerId,
        checkerName: data.checkerName,
      });
      toast.success("Return finalized successfully");
      qc.invalidateQueries(["amazon-returns"]);
    } catch (err: any) {
      toast.error(err.message || "Failed to finalize return");
    }
  };

  if (
    returnsLoading ||
    refundsLoading ||
    settlementsLoading
  ) {
    return (
      <div className="min-h-screen p-8">
        <div className="animated-loader" />
        <p className="mt-4 text-slate-500">Loading returns, refunds, and settlements...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col sm:flex-row gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Returns & Settlement Reconciliation
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Manage Amazon returns, refunds, and settlement reconciliation
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowReturnModal(true)}
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" /> Create Return
          </Button>
        </div>
      </header>

      {/* Returns Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Return Analytics */}
        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <h2 className="font-bold text-slate-900 dark:text-slate-100 mb-4">
            Return Analytics
          </h2>

          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Total Returned
              </p>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                {totalReturned}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Accepted & Resalable
              </p>
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                {acceptedAndResalable}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Damaged / Rejected
              </p>
              <p className="text-2xl font-bold text-rose-600 dark:text-rose-400">
                {damagedOrRejected}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Missing
              </p>
              <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                {missing}
              </p>
            </div>
          </div>

          <p className="text-sm text-slate-500 dark:text-slate-400 mt-4">
            80% of returns are accepted and resalable. Damaged goods are quarantined
            and never automatically enter available inventory.
          </p>
        </div>

        {/* Returns Table */}
        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <h2 className="font-bold text-slate-900 dark:text-slate-100 mb-4">
            Return Cases
          </h2>

          {returns.length === 0 ? (
            <div className="py-8 text-center text-slate-500 dark:text-slate-400">
              <ShoppingBag className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>No return cases found. Create your first return to get started.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {returns.map((ret: any) => (
                <div
                  key={ret.id}
                  className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-850/60 hover:border-indigo-300 dark:hover:border-indigo-800 transition"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                      {ret.amazonOrderId}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${ret.returnStatus === "Accepted"
                        ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300"
                        : ret.returnStatus === "UnderInspection"
                          ? "bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300"
                          : ret.returnStatus === "ReturnInitiated"
                            ? "bg-amber-100 dark:bg-amber-950/70 dark:text-amber-300 border-amber-300 dark:border-amber-700"
                            : "bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300"}`
                    }>
                      {ret.returnStatus}
                    </span>
                  </div>

                  <div className="text-xs text-slate-600 dark:text-slate-300">
                    <div>
                      <span>Returned:</span> {ret.quantityReturned}
                      <span>│</span>
                      <span>Accepted:</span> {ret.quantityAccepted || 0}
                    </div>
                    <div>
                      <span>Damaged:</span> {ret.quantityDamaged || 0}
                      <span>│</span>
                      <span>Missing:</span> {ret.quantityMissing || 0}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mt-1">
                    <StatusBadge
                      severity="neutral"
                      text={`CRN: ${ret.creditNoteId || "—"}`}
                    />
                    <StatusBadge
                      severity="neutral"
                      text={`Ref: ${ret.refundReference || "—"}`}
                    />
                  </div>

                  <div className="flex items-center gap-2 mt-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Finalize return"
                      onClick={() => {
                        setShowReconcileModal(true);
                        setSelectedSettlementId(ret.id);
                      }}
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="View details"
                      onClick={() =>
                        toast.info(`View return ${ret.id} details`)
                      }
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Settlement Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Settlement Summary */}
        <div className="lg:col-span-2 p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <h2 className="font-bold text-slate-900 dark:text-slate-100 mb-4">
            Settlement Summary
          </h2>

          <div className="space-y-3">
            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
              <span className="text-slate-600 dark:text-slate-400">Gross Sales</span>
              <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                ₹{totalGrossSettlements.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
              <span className="text-slate-600 dark:text-slate-400">Marketplace Fees</span>
              <span className="font-mono font-semibold text-rose-600 dark:text-rose-400">
                -₹{totalFeesSettlements.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
              <span className="text-slate-600 dark:text-slate-400">Deductions / TCS</span>
              <span className="font-mono font-semibold text-rose-600 dark:text-rose-400">
                -₹{totalDeductionsSettlements.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
              <span className="text-slate-600 dark:text-slate-400">Refunds & Returns</span>
              <span className="font-mono font-semibold text-rose-600 dark:text-rose-400">
                -₹{totalRefundsSettlements.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between py-2 font-bold text-sm bg-emerald-50/70 dark:bg-emerald-950/40 p-2.5 rounded-lg border border-emerald-200 dark:border-emerald-800">
              <span className="text-emerald-900 dark:text-emerald-200">
                Net Settlement
              </span>
              <span className="font-mono text-emerald-700 dark:text-emerald-300">
                ₹{totalNetSettlements.toLocaleString()}
              </span>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSettlementModal(true)}
          >
            <RefreshCw className="w-3.5 h-3.5 me-2" /> View Details
          </Button>
        </div>

        {/* Reconciliation Status */}
        <div p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs>
          <h2 className="font-bold text-slate-900 dark:text-slate-100 mb-4">
            Reconciliation Status
          </h2>

          <div className="space-y-2">
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/70 border border-amber-200 dark:border-amber-800">
              <p className="text-xs font-medium text-amber-600 dark:text-amber-300">
                EXPECTED
              </p>
              <p className="text-[10px]"> {settlements.length > 0 ? settlements.filter((s: any) => s.status === "EXPECTED").length : 0} settlements</p>
            </div>
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800">
              <p className="text-xs font-medium text-emerald-600 dark:text-emerald-300">
                RECEIVED
              </p>
              <p className="text-[10px]"> {settlements.length > 0 ? settlements.filter((s: any) => s.status === "RECEIVED").length : 0} settlements</p>
            </div>
            <div className="p-3 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800">
              <p className="text-xs font-medium text-indigo-600 dark:text-indigo-300">
                PROCESSING
              </p>
              <p className="text-[10px]"> Reconciliation in progress</p>
            </div>
          </div>
        </div>
      </div>

      {/* Create Return Modal */}
      {showReturnModal && (
        <Dialog open={true} onOpenChange={({ removed }: any) => setShowReturnModal(!removed)} className="max-w-2xl">
          <DialogOverlay />
          <DialogContent className="p-6 sm:p-8">
            <DialogHeader>
              <DialogTitle>
                {formMode === "create" ? "Create Amazon Return" : "Edit Return"}
              </DialogTitle>
              <DialogDescription>
                Log an Amazon return case
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={formMode === "create" ? handleCreateReturn : undefined} className="mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="amazon-order-id">Amazon Order ID</Label>
                  <Input
                    id="amazon-order-id"
                    type="text"
                    placeholder="e.g. 902-1845936-5435065"
                    value={returnForm.amazonOrderId}
                    onChange={(e) =>
                      setReturnForm({ ...returnForm, amazonOrderId: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="sales-order-id">WhizUnik Sales Order ID</Label>
                  <Input
                    id="sales-order-id"
                    type="text"
                    placeholder="e.g. SO-AMZ-1001"
                    value={returnForm.whizunikSalesOrderId}
                    onChange={(e) =>
                      setReturnForm({ ...returnForm, whizunikSalesOrderId: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="return-status">Return Status</Label>
                  <Select
                    id="return-status"
                    onValueChange={(value: string) =>
                      setReturnForm({ ...returnForm, returnStatus: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ReturnInitiated">Return Initiated</SelectItem>
                      <SelectItem value="InTransit">In Transit</SelectItem>
                      <SelectItem value="Received">Received</SelectItem>
                      <SelectItem value="UnderInspection">Under Inspection</SelectItem>
                      <SelectItem value="Accepted">Accepted</SelectItem>
                      <SelectItem value="PartiallyAccepted">Partially Accepted</SelectItem>
                      <SelectItem value="Rejected">Rejected</SelectItem>
                      <SelectItem value="CreditNoteCreated">Credit Note Created</SelectItem>
                      <SelectItem value="RefundConfirmed">Refund Confirmed</SelectItem>
                      <SelectItem value="Closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="quantity-returned">Quantity Returned</Label>
                  <Input
                    type="number"
                    id="quantity-returned"
                    min="1"
                    value={returnForm.quantityReturned}
                    onChange={(e) =>
                      setReturnForm({ ...returnForm, quantityReturned: Number(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="quantity-accepted">Quantity Accepted</Label>
                  <Input
                    type="number"
                    id="quantity-accepted"
                    min="0"
                    value={returnForm.quantityAccepted}
                    onChange={(e) =>
                      setReturnForm({ ...returnForm, quantityAccepted: Number(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="quantity-damaged">Quantity Damaged</Label>
                  <Input
                    type="number"
                    id="quantity-damaged"
                    min="0"
                    value={returnForm.quantityDamaged}
                    onChange={(e) =>
                      setReturnForm({ ...returnForm, quantityDamaged: Number(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="quantity-missing">Quantity Missing</Label>
                  <Input
                    type="number"
                    id="quantity-missing"
                    min="0"
                    value={returnForm.quantityMissing}
                    onChange={(e) =>
                      setReturnForm({ ...returnForm, quantityMissing: Number(e.target.value) })
                    }
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="return-reason">Return Reason</Label>
                    <Input
                      id="return-reason"
                      type="text"
                      placeholder="e.g. Size issue, Wrong item, etc."
                      value={returnForm.returnReason}
                      onChange={(e) =>
                        setReturnForm({ ...returnForm, returnReason: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="condition-description">Condition Description</Label>
                    <Input
                      id="condition-description"
                      type="text"
                      placeholder="e.g. Slight stain, minor tear, etc."
                      value={returnForm.conditionDescription}
                      onChange={(e) =>
                        setReturnForm({ ...returnForm, conditionDescription: e.target.value })
                      }
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setShowReturnModal(false);
                    setFormMode("create");
                    setReturnForm({
                      amazonOrderId: "",
                      whizunikSalesOrderId: "",
                      amazonReturnId: null,
                      returnStatus: "ReturnInitiated",
                      quantityReturned: 0,
                      quantityAccepted: 0,
                      quantityDamaged: 0,
                      quantityMissing: 0,
                      returnReason: "",
                      conditionDescription: "",
                    });
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                >
                  {formMode === "create" ? "Create Return" : "Update Return"}
                </Button>
              </div>
            </form>
          </DialogClose>
        </Dialog>
      )}

      {/* Reconcile Settlement Modal */}
      {showReconcileModal && selectedSettlementId && (
        <Dialog open={true} onOpenChange={({ removed }: any) => setShowReconcileModal(!removed)} className="max-w-sm">
          <DialogOverlay />
          <DialogContent className="p-6">
            <DialogHeader>
              <DialogTitle>
                Reconcile Settlement
              </DialogTitle>
              <DialogDescription>
                Mark settlement as reconciled with actual bank receipt
              </DialogDescription>
            </DialogHeader>

            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
              This will update the settlement status to RECEIVED and recalculate
              net settlement values based on actual orders, invoices, returns, and refunds.
            </p>

            <form onSubmit={() => handleReconcileSettlement(selectedSettlementId!)}>
              <Button
                type="submit"
                variant="primary"
                size="sm"
              >
                Reconcile Settlement
              </Button>
            </form>
          </DialogClose>
        </Dialog>
      )}
    </div>
  );
}