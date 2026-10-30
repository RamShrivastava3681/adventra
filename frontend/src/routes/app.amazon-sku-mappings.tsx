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

export const Route = createFileRoute("/app/amazon-sku-mappings")({
  component: AmazonSkuMappingsPage,
});

interface SkuMapping {
  id: string;
  channelSku: string;
  listingId: string;
  whizunikSku: string;
  colour: string | null;
  size: string | null;
  productName: string;
  variant: string;
  warehouse: string;
  mrp: number;
  sellingPrice: number;
  hsn: string;
  gstRate: number;
  status: "Mapped" | "Pending" | "Error" | "Active";
  safetyStock: number;
}

interface SkuMappingFormValues {
  channelSku: string;
  listingId: string;
  whizunikSku: string;
  colour: string | null;
  size: string | null;
  productName: string;
  variant: string;
  warehouse: string;
  mrp: number;
  sellingPrice: number;
  hsn: string;
  gstRate: number;
  status: "Mapped" | "Pending" | "Error" | "Active";
  safetyStock: number;
}

interface SkuMappingRow {
  id: string;
  channelSku: string;
  listingId: string;
  whizunikSku: string;
  productName: string;
  variant: string;
  warehouse: string;
  mrp: number;
  sellingPrice: number;
  hsn: string;
  gstRate: number;
  status: string;
  actions: React.ReactNode;
}

export function AmazonSkuMappingsPage() {
  const clientId = useQueryClient().getQueryData(["auth", "user"])?.[0] as string | undefined;
  const { data: mappings, isLoading } = useQuery({
    queryKey: ["amazon-sku-mappings-list", clientId],
    queryFn: async () => {
      if (!clientId) return [];
      return api.get<any[]>(`/amazon/sku-mappings`);
    },
    enabled: !!clientId,
  });

  const [showMapModal, setShowMapModal] = useState(false);
  const [formMode, setFormMode] useState<"create" | "edit">("create");
  const [formValues, setFormValues] = useState<SkuMappingFormValues>({
    channelSku: "",
    listingId: "",
    whizunikSku: "",
    colour: null,
    size: null,
    productName: "",
    variant: "",
    warehouse: "WH-AMAZON-FBA",
    mrp: 0,
    sellingPrice: 0,
    hsn: "",
    gstRate: 5,
    status: "Pending",
    safetyStock: 0,
  });
  const [editMappingId, setEditMappingId] = useState<string | null>(null);

  const columns = useMemo<SkuMappingRow[]>(() => {
    if (!mappings) return [];
    return mappings.map((m) => ({
      id: m.id,
      channelSku: m.channelSku,
      listingId: m.listingId,
      whizunikSku: m.whizunikSku,
      productName: m.productName,
      variant: m.variant,
      warehouse: m.warehouse,
      mrp: m.mrp,
      sellingPrice: m.sellingPrice,
      hsn: m.hsn,
      gstRate: m.gstRate,
      status: m.status,
      actions: (
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Edit mapping"
            onClick={() => {
              setFormMode("edit");
              setEditMappingId(m.id);
              setFormValues({
                channelSku: m.channelSku,
                listingId: m.listingId,
                whizunikSku: m.whizunikSku,
                colour: m.colour,
                size: m.size,
                productName: m.productName,
                variant: m.variant,
                warehouse: m.warehouse,
                mrp: m.mrp,
                sellingPrice: m.sellingPrice,
                hsn: m.hsn,
                gstRate: m.gstRate,
                status: m.status,
                safetyStock: m.safetyStock,
              });
              setShowMapModal(true);
            }}
          >
            <Eye className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="destructive"
            size="icon"
            aria-label="Delete mapping"
            onClick={() => {
              // Delete mapping
              setShowMapModal(false);
              toast.success("Mapping deleted");
            }}
          >
            <XCircle className="w-3.5 h-3.5" />
          </Button>
        </div>
      ),
    }));
  }, [mappings]);

  const handleCreateMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formValues.channelSku) {
      toast.error("Amazon SKU is required");
      return;
    }
    if (!formValues.whizunikSku) {
      toast.error("WhizUnik SKU is required");
      return;
    }

    await api.post("/amazon/sku-mappings", {
      clientId: clientId || "",
      channelSku: formValues.channelSku,
      listingId: formValues.listingId,
      whizunikSku: formValues.whizunikSku,
      colour: formValues.colour,
      size: formValues.size,
      productName: formValues.productName,
      variant: formValues.variant,
      warehouse: formValues.warehouse,
      mrp: formValues.mrp,
      sellingPrice: formValues.sellingPrice,
      hsn: formValues.hsn,
      gstRate: formValues.gstRate,
      status: formValues.status,
      safetyStock: formValues.safetyStock,
    });

    setShowMapModal(false);
    setFormMode("create");
    setFormValues({
      channelSku: "",
      listingId: "",
      whizunikSku: "",
      colour: null,
      size: null,
      productName: "",
      variant: "",
      warehouse: "WH-AMAZON-FBA",
      mrp: 0,
      sellingPrice: 0,
      hsn: "",
      gstRate: 5,
      status: "Pending",
      safetyStock: 0,
    });
    toast.success("SKU mapping created successfully");
    qc.invalidateQueries(["amazon-sku-mappings-list"]);
  };

  const handleUpdateMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editMappingId || !formValues.channelSku) {
      return;
    }

    await api.put(`/amazon/sku-mappings/${editMappingId}`, {
      clientId: clientId || "",
      channelSku: formValues.channelSku,
      listingId: formValues.listingId,
      whizunikSku: formValues.whizunikSku,
      colour: formValues.colour,
      size: formValues.size,
      productName: formValues.productName,
      variant: formValues.variant,
      warehouse: formValues.warehouse,
      mrp: formValues.mrp,
      sellingPrice: formValues.sellingPrice,
      hsn: formValues.hsn,
      gstRate: formValues.gstRate,
      status: formValues.status,
      safetyStock: formValues.safetyStock,
    });

    setShowMapModal(false);
    setFormMode("create");
    setEditMappingId(null);
    setFormValues({
      channelSku: "",
      listingId: "",
      whizunikSku: "",
      colour: null,
      size: null,
      productName: "",
      variant: "",
      warehouse: "WH-AMAZON-FBA",
      mrp: 0,
      sellingPrice: 0,
      hsn: "",
      gstRate: 5,
      status: "Pending",
      safetyStock: 0,
    });
    toast.success("SKU mapping updated successfully");
    qc.invalidateQueries(["amazon-sku-mappings-list"]);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen p-8">
        <div className="animated-loader" />
        <p className="mt-4 text-slate-500">Loading SKU mappings...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col sm:flex-row gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Amazon SKU Mappings
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Manage Amazon SKU to WhizUnik Master SKU mappings
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setFormMode("create");
              setEditMappingId(null);
              setFormValues({
                channelSku: "",
                listingId: "",
                whizunikSku: "",
                colour: null,
                size: null,
                productName: "",
                variant: "",
                warehouse: "WH-AMAZON-FBA",
                mrp: 0,
                sellingPrice: 0,
                hsn: "",
                gstRate: 5,
                status: "Pending",
                safetyStock: 0,
              });
              setShowMapModal(true);
            }}
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" /> Add Mapping
          </Button>
        </div>
      </header>

      <div className="space-y-4">
        {/* Mapping Table */}
        {mappings && mappings.length > 0 ? (
          <div className="overflow-x-auto rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            <TableContainer>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Amazon SKU</TableHead>
                    <TableHead>WhizUnik SKU</TableHead>
                    <TableHead>Product Name</TableHead>
                    <TableHead>Variant</TableHead>
                    <TableHead>Warehouse</TableHead>
                    <TableHead>HSN</TableHead>
                    <TableHead>GST %</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {columns.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium text-slate-800 dark:text-slate-200">
                        {row.channelSku}
                      </TableCell>
                      <TableCell className="font-medium text-indigo-600 dark:text-indigo-300">
                        {row.whizunikSku}
                      </TableCell>
                      <TableCell>{row.productName}</TableCell>
                      <TableCell>{row.variant}</TableCell>
                      <TableCell>{row.warehouse}</TableCell>
                      <TableCell>{row.hsn}</TableCell>
                      <TableCell>
                        <span className="text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 rounded px-2 py-0.5">
                          {row.gstRate}%
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusPill
                          severity={row.status === "Error" ? "critical" : "neutral"}
                        >
                          {row.status}
                        </StatusPill>
                      </TableCell>
                      <TableCell>
                        {row.actions}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </div>
        ) : (
          <div className="py-8 text-center text-slate-500 dark:text-slate-400">
            <ShoppingBag className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p>No SKU mappings found. Add your first Amazon SKU mapping to get started.</p>
          </div>
        )}

        {/* Mapping Form Modal */}
        {showMapModal && (
          <Dialog open={true} onOpenChange=(setShowMapModal) className="max-w-2xl">
            <DialogOverlay />
            <DialogContent className="p-6 sm:p-8">
              <DialogHeader>
                <DialogTitle>
                  {formMode === "create" ? "Add Amazon SKU Mapping" : "Edit SKU Mapping"}
                </DialogTitle>
                <DialogDescription>
                  Map an Amazon SKU/ASIN to a WhizUnik Master SKU
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={formMode === "create" ? handleCreateMapping : handleUpdateMapping} className="mt-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormLabel htmlFor="channel-sku">Amazon SKU / ASIN</FormLabel>
                  <FormControl
                    id="channel-sku"
                    type="text"
                    placeholder="e.g. AMZ-TS-BLK-M"
                    value={formValues.channelSku}
                    onChange={(e) =>
                      setFormValues({ ...formValues, channelSku: e.target.value })
                    }
                    disabled={formMode === "edit"}
                  />
                  <FormLabel htmlFor="listing-id">Amazon Listing ID (ASIN)</FormLabel>
                  <FormControl
                    id="listing-id"
                    type="text"
                    placeholder="e.g. ASIN-B08123456"
                    value={formValues.listingId}
                    onChange={(e) =>
                      setFormValues({ ...formValues, listingId: e.target.value })
                    }
                  />
                  <FormLabel htmlFor="whizunik-sku">WhizUnik Master SKU</FormLabel>
                  <FormControl
                    id="whizunik-sku"
                    type="text"
                    placeholder="e.g. AD-TS-BLK-M"
                    value={formValues.whizunikSku}
                    onChange={(e) =>
                      setFormValues({ ...formValues, whizunikSku: e.target.value })
                    }
                    disabled={formMode === "create"}
                  />
                  <FormLabel htmlFor="product-name">Product Name</FormLabel>
                  <FormControl
                    id="product-name"
                    type="text"
                    placeholder="e.g. Adventra Classic Tee"
                    value={formValues.productName}
                    onChange={(e) =>
                      setFormValues({ ...formValues, productName: e.target.value })
                    }
                  />
                  <FormLabel htmlFor="variant">Variant</FormLabel>
                  <FormControl
                    id="variant"
                    type="text"
                    placeholder="e.g. Black / M"
                    value={formValues.variant}
                    onChange={(e) =>
                      setFormValues({ ...formValues, variant: e.target.value })
                    }
                  />
                  <FormLabel htmlFor="warehouse">Warehouse</FormLabel>
                  <FormControl
                    id="warehouse"
                    type="text"
                    value={formValues.warehouse}
                    onChange={(e) =>
                      setFormValues({ ...formValues, warehouse: e.target.value })
                    }
                  />
                  <FormLabel htmlFor="mrp">MRP</FormLabel>
                  <FormControl
                    id="mrp"
                    type="number"
                    value={formValues.mrp}
                    onChange={(e) =>
                      setFormValues({ ...formValues, mrp: Number(e.target.value) || 0 })
                    }
                  />
                  <FormLabel htmlFor="selling-price">Selling Price</FormLabel>
                  <FormControl
                    id="selling-price"
                    type="number"
                    value={formValues.sellingPrice}
                    onChange={(e) =>
                      setFormValues({ ...formValues, sellingPrice: Number(e.target.value) || 0 })
                    }
                  />
                  <FormLabel htmlFor="hsn">HSN Code</FormLabel>
                  <FormControl
                    id="hsn"
                    type="text"
                    value={formValues.hsn}
                    onChange={(e) =>
                      setFormValues({ ...formValues, hsn: e.target.value })
                    }
                  />
                  <FormLabel htmlFor="gst-rate">GST Rate %</FormLabel>
                  <FormControl
                    id="gst-rate"
                    type="number"
                    value={formValues.gstRate}
                    onChange={(e) =>
                      setFormValues({ ...formValues, gstRate: Number(e.target.value) || 5 })
                    }
                  />
                </div>

                <div>
                  <FormLabel htmlFor="status">Status</FormLabel>
                  <Select
                    id="status"
                    onValueChange={(value) =>
                      setFormValues({ ...formValues, status: value as any })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Mapped">Mapped</SelectItem>
                      <SelectItem value="Pending">Pending</SelectItem>
                      <SelectItem value="Error">Error</SelectItem>
                      <SelectItem value="Active">Active</SelectItem>
                    </SelectContent>
                  </Select>

                  <FormLabel htmlFor="safety-stock">Safety Stock</FormLabel>
                  <FormControl
                    id="safety-stock"
                    type="number"
                    value={formValues.safetyStock}
                    onChange={(e) =>
                      setFormValues({ ...formValues, safetyStock: Number(e.target.value) || 0 })
                    }
                  />
                </div>

                <div className="flex gap-3 mt-6">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setShowMapModal(false);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                  >
                    {formMode === "create" ? "Create Mapping" : "Update Mapping"}
                  </Button>
                </div>
              </form>
            </DialogClose>
          </Dialog>
        )}
      </div>
    </div>
  );
}