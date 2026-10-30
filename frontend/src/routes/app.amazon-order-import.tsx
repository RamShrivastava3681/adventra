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

export const Route = createFileRoute("/app/amazon-order-import")({
  component: AmazonOrderImportPage,
});

interface ImportedAmazonOrder {
  id: string;
  amazonOrderId: string;
  orderDate: string;
  amazonSku: string;
  productName: string;
  colour: string | null;
  size: string | null;
  quantity: number;
  sellingPrice: number;
  discount: number;
  taxInformation: {
    taxableAmount: number;
    taxAmount: number;
    taxRate: number;
  };
  deliveryAddress: {
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  shippingMethod: string;
  fulfilmentType: string;
  expectedDispatchDate: string | null;
  amazonOrderStatus: string;
  invoiceStatus: string;
  mappingStatus: "Mapped" | "Unmapped" | "Pending";
  stockStatus: "Available" | "Insufficient" | "Reserved";
}

interface ImportOrderForm {
  amazonOrderId: string;
  orderDate: string;
  amazonSku: string;
  productName: string;
  colour: string;
  size: string;
  quantity: number;
  sellingPrice: number;
  discount: number;
  taxInformation: {
    taxableAmount: number;
    taxAmount: number;
    taxRate: number;
  };
  deliveryAddress: {
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  shippingMethod: string;
  fulfilmentType: string;
  expectedDispatchDate: string | null;
}

export function AmazonOrderImportPage() {
  const clientId = useQueryClient().getQueryData(["auth", "user"])?.[0] as string | undefined;
  const { data: existingMappings, isLoading: mappingsLoading } = useQuery({
    queryKey: ["amazon-sku-mappings", clientId],
    queryFn: async () => {
      if (!clientId) return [];
      return api.get<any[]>(`/amazon/sku-mappings`);
    },
    enabled: !!clientId,
  });

  const [showImportModal, setShowImportModal] = useState(false);
  const [form, setForm] = useState<ImportOrderForm>({
    amazonOrderId: "",
    orderDate: new Date().toISOString().split("T")[0],
    amazonSku: "",
    productName: "",
    colour: "",
    size: "",
    quantity: 1,
    sellingPrice: 0,
    discount: 0,
    taxInformation: {
      taxableAmount: 0,
      taxAmount: 0,
      taxRate: 5,
    },
    deliveryAddress: {
      addressLine1: "",
      addressLine2: null,
      city: "",
      state: "",
      postalCode: "",
      country: "",
    },
    shippingMethod: "Standard",
    fulfilmentType: "FBA",
    expectedDispatchDate: "",
  });
  const [importResult, setImportResult] = useState<{
    success: boolean;
    order: ImportedAmazonOrder | null;
    message: string;
  } | null>(null);

  const handleImportOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.amazonOrderId) {
      toast.error("Amazon Order ID is required");
      return;
    }
    if (!form.amazonSku) {
      toast.error("Amazon SKU is required");
      return;
    }
    if (form.quantity <= 0) {
      toast.error("Quantity must be greater than zero");
      return;
    }

    // Check SKU mapping
    const mapping = existingMappings?.find(
      (m: any) => m.channelSku === form.amazonSku
    );

    if (!mapping) {
      // No mapping found - mark as unmapped
      setImportResult({
        success: false,
        message: `Amazon SKU "${form.amazonSku}" is not mapped. Please map it first.`,
      });
      toast.error("SKU not mapped - manual mapping required");
      return;
    }

    // Import the order
    setImportResult(null);
    try {
      const result = await api.post("/amazon/orders/import", {
        clientId: clientId || "",
        amazonOrderId: form.amazonOrderId,
        orderDate: form.orderDate,
        amazonSku: form.amazonSku,
        productName: form.productName,
        colour: form.colour,
        size: form.size,
        quantity: form.quantity,
        sellingPrice: form.sellingPrice,
        discount: form.discount,
        taxInformation: form.taxInformation,
        deliveryAddress: form.deliveryAddress,
        shippingMethod: form.shippingMethod,
        fulfilmentType: form.fulfilmentType,
        expectedDispatchDate: form.expectedDispatchDate,
        amazonOrderStatus: "Pending",
        invoiceStatus: "Pending",
      });

      const order: ImportedAmazonOrder = {
        id: result.order.id,
        amazonOrderId: form.amazonOrderId,
        orderDate: form.orderDate,
        amazonSku: form.amazonSku,
        productName: form.productName,
        colour: form.colour,
        size: form.size,
        quantity: form.quantity,
        sellingPrice: form.sellingPrice,
        discount: form.discount,
        taxInformation: form.taxInformation,
        deliveryAddress: form.deliveryAddress,
        shippingMethod: form.shippingMethod,
        fulfilmentType: form.fulfilmentType,
        expectedDispatchDate: form.expectedDispatchDate,
        amazonOrderStatus: "Pending",
        invoiceStatus: "Pending",
        mappingStatus: "Mapped",
        stockStatus: "Available",
      };

      setImportResult({
        success: true,
        order,
        message: "Amazon order imported successfully",
      });
      toast.success("Amazon order imported successfully");
    } catch (err: any) {
      setImportResult({
        success: false,
        message: err.message || "Failed to import order",
      });
      toast.error(err.message || "Failed to import order");
    }
  };

  if (mappingsLoading) {
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
            Amazon Order Import
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Import Amazon orders into WhizUnik system
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowImportModal(true)}
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" /> Import Order
          </Button>
        </div>
      </header>

      {/* Import Result */}
      {importResult && (
        <div className="p-6 rounded-2xl mb-6 {importResult.success ? "bg-emerald-50 dark:bg-emerald-950" : "bg-rose-50 dark:bg-rose-950"} border border-{importResult.success ? "emerald-200" : "rose-200"} dark:border-{importResult.success ? "emerald-800" : "rose-800"}">
          <div className="flex items-start gap-3">
            {importResult.success ? (
              <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0 mt-1" />
            : (
              <XCircle className="w-5 h-5 text-rose-600 shrink-0 mt-1" />
            )}
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-slate-900 dark:text-slate-100">
              {importResult.message}
            </h3>
            {importResult.order && (
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Order {importResult.order.amazonOrderId} - {importResult.order.productName}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Import Form */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <form onSubmit={handleImportOrder} className="p-6 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                  Amazon Order ID
                </Label>
                <Input
                  id="amazon-order-id"
                  type="text"
                  placeholder="e.g. 902-1845936-5435065"
                  value={form.amazonOrderId}
                  onChange={(e) =>
                    setForm({ ...form, amazonOrderId: e.target.value })
                  }
                  disabled={importResult?.success || mappingsLoading}
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Required for duplicate prevention
                </p>
              </div>
              <div>
                <Label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                  Order Date
                </Label>
                <Input
                  type="date"
                  id="order-date"
                  value={form.orderDate}
                  onChange={(e) =>
                    setForm({ ...form, orderDate: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                  Amazon SKU / ASIN
                </Label>
                <Input
                  id="amazon-sku"
                  type="text"
                  placeholder="e.g. AMZ-TS-BLK-M"
                  value={form.amazonSku}
                  onChange={(e) =>
                    setForm({ ...form, amazonSku: e.target.value })
                  }
                />
              </div>
              <div>
                <Label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                  Quantity
                </Label>
                <Input
                  type="number"
                  id="quantity"
                  min="1"
                  value={form.quantity}
                  onChange={(e) =>
                    setForm({ ...form, quantity: Number(e.target.value) })
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                  Product Name
                </Label>
                <Input
                  id="product-name"
                  type="text"
                  placeholder="e.g. Adventra Classic Tee"
                  value={form.productName}
                  onChange={(e) =>
                    setForm({ ...form, productName: e.target.value })
                  }
                />
              </div>
              <div>
                <Label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                  Selling Price (₹)
                </Label>
                <Input
                  type="number"
                  id="selling-price"
                  min="0"
                  value={form.sellingPrice}
                  onChange={(e) =>
                    setForm({ ...form, sellingPrice: Number(e.target.value) })
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                  Discount (%)
                </Label>
                <Input
                  type="number"
                  id="discount"
                  min="0"
                  max="100"
                  value={form.discount}
                  onChange={(e) =>
                    setForm({ ...form, discount: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <Label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                  Tax Rate (%)
                </Label>
                <Input
                  type="number"
                  id="tax-rate"
                  min="0"
                  max="99"
                  value={form.taxInformation.taxRate}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      taxInformation: {
                        ...form.taxInformation,
                        taxRate: Number(e.target.value),
                      },
                    })
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                  Taxable Amount (₹)
                </Label>
                <Input
                  type="number"
                  id="taxable-amount"
                  min="0"
                  value={form.taxInformation.taxableAmount}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      taxInformation: {
                        ...form.taxInformation,
                        taxableAmount: Number(e.target.value),
                      },
                    })
                  }
                />
              </div>
              <div>
                <Label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                  Tax Amount (₹)
                </Label>
                <Input
                  type="number"
                  id="tax-amount"
                  min="0"
                  value={form.taxInformation.taxAmount}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      taxInformation: {
                        ...form.taxInformation,
                        taxAmount: Number(e.target.value),
                      },
                    })
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                  Address Line 1
                </Label>
                <Input
                  id="address-line1"
                  type="text"
                  placeholder="e.g. 123 Main Street"
                  value={form.deliveryAddress.addressLine1}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      deliveryAddress: {
                        ...form.deliveryAddress,
                        addressLine1: e.target.value,
                      },
                    })
                  }
                />
              </div>
              <div>
                <Label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                  City
                </Label>
                <Input
                  id="city"
                  type="text"
                  placeholder="e.g. Seattle, WA"
                  value={form.deliveryAddress.city}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      deliveryAddress: {
                        ...form.deliveryAddress,
                        city: e.target.value,
                      },
                    })
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                  State
                </Label>
                <Input
                  id="state"
                  type="text"
                  placeholder="e.g. Karnataka"
                  value={form.deliveryAddress.state}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      deliveryAddress: {
                        ...form.deliveryAddress,
                        state: e.target.value,
                      },
                    })
                  }
                />
              </div>
              <div>
                <Label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                  Postal Code
                </Label>
                <Input
                  id="postal-code"
                  type="text"
                  placeholder="e.g. 560001"
                  value={form.deliveryAddress.postalCode}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      deliveryAddress: {
                        ...form.deliveryAddress,
                        postalCode: e.target.value,
                      },
                    })
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                  Country
                </Label>
                <Input
                  id="country"
                  type="text"
                  placeholder="e.g. India"
                  value={form.deliveryAddress.country}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      deliveryAddress: {
                        ...form.deliveryAddress,
                        country: e.target.value,
                      },
                    })
                  }
                />
              </div>
              <div>
                <Label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                  Shipping Method
                </Label>
                <Input
                  id="shipping-method"
                  type="text"
                  placeholder="e.g. Standard"
                  value={form.shippingMethod}
                  onChange={(e) =>
                    setForm({ ...form, shippingMethod: e.target.value })
                  }
                />
              </div>
            </div>

            <div>
              <Label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                Fulfilment Type
                <div className="mt-1 text-xs text-slate-500">
                  FBA = Amazon warehousing, SellerFlex = MFN, MCF = Multi-channel fulfilment
                </div>
              </Label>
              <Input
                id="fulfilment-type"
                type="text"
                value={form.fulfilmentType}
                onChange={(e) =>
                  setForm({ ...form, fulfilmentType: e.target.value })
                }
              />
            </div>

            <div>
              <Label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                Expected Dispatch Date
              </Label>
              <Input
                type="date"
                id="expected-dispatch-date"
                value={form.expectedDispatchDate}
                onChange={(e) =>
                  setForm({ ...form, expectedDispatchDate: e.target.value })
                }
              />
            </div>

            <div className="flex gap-3 mt-6">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setShowImportModal(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
              >
                {importResult?.success ? "Order Imported" : "Import Order"}
              </Button>
            </div>
          </form>
        </div>

        {/* Mapping Status Info */}
        <div className="lg:col-span-2 pt-6 space-y-4">
          {existingMappings && existingMappings.length > 0 ? (
            <div>
              <h3 className="font-bold text-slate-900 dark:text-slate-100">
                Mapped SKUs ({existingMappings.length})
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {existingMappings.slice(0, 3).map((m: any) => (
                  <span key={m.channelSku} className="inline-block mr-2">
                    {m.channelSku} → {m.whizunikSku}
                  </span>
                ))}
                {existingMappings.length > 3 && (
                  <span className="text-[10px]">
                    +{existingMappings.length - 3} more
                  </span>
                )}
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No SKU mappings found. <a href="/app/amazon-sku-mappings">Add mappings</a> first.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}