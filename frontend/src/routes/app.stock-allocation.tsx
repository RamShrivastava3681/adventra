import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import {
  Plus,
  X,
  Loader2,
  MapPin,
  Trash2,
  Pencil,
  CheckCircle2,
  Building2,
  Warehouse,
  Store,
  Truck,
  Boxes,
  ArrowRightLeft,
  Package,
  ArrowDownToLine,
  ArrowUpFromLine,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { TableSkeleton } from "@/components/skeletons";
import { TransactionFilters, type TxFiltersConfig } from "@/components/transaction-filters";

export const Route = createFileRoute("/app/stock-allocation")({
  component: StockAllocationPage,
});

// ─── Types ──────────────────────────────────────────────────────────────────
type StockLocation = {
  id: string;
  name: string;
  location_type: string;
  channel: string | null;
  address: string | null;
  status: "active" | "inactive";
  created_at: string;
};

type CatalogueProduct = {
  id: string;
  sku: string | null;
  name: string;
  unit_of_measure: string;
  unit_cost: number | null;
  image_url: string | null;
  status?: string;
};

type StockSummaryItem = {
  productId: string;
  sku: string;
  name: string;
  totalCompanyStock: number;
  locationBreakdown: Array<{
    locationId: string;
    locationName: string;
    locationType: string;
    quantity: number;
  }>;
};

type TransferRecord = {
  id: string;
  movement_number: string;
  product_id: string | null;
  direction: "in" | "out";
  item_name: string;
  sku: string | null;
  quantity: number;
  unit: string;
  unit_cost: number | null;
  warehouse: string | null;
  reason: string | null;
  linked_document_type: string | null;
  linked_document_number: string | null;
  status: string;
  source_location_id: string | null;
  destination_location_id: string | null;
  dispatch_type: string | null;
  transfer_id: string | null;
  movement_date: string;
  created_at: string;
};

const LOCATION_TYPES: { value: string; label: string; icon: LucideIcon }[] = [
  { value: "central_warehouse", label: "Central Warehouse", icon: Warehouse },
  { value: "marketplace_warehouse", label: "Marketplace Warehouse", icon: Building2 },
  { value: "own_store", label: "Own Store", icon: Store },
  { value: "transit", label: "Transit", icon: Truck },
  { value: "other_warehouse", label: "Other Warehouse", icon: Boxes },
];

// ─── Main Page ──────────────────────────────────────────────────────────────
function StockAllocationPage() {
  const { user, isSalesRep, isReportingManager, isAdmin, isChecker } = useAuth();
  const canWrite = !!user && !isSalesRep && !isReportingManager;
  const qc = useQueryClient();
  const [openLocationModal, setOpenLocationModal] = useState(false);
  const [editingLocation, setEditingLocation] = useState<StockLocation | null>(null);
  const [openAllocateModal, setOpenAllocateModal] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "transfers">("overview");

  const locationsQ = useQuery({
    queryKey: ["stock-locations"],
    queryFn: async () => {
      const data = (await api.stockLocations.list()) as StockLocation[];
      return data.sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  const stockSummaryQ = useQuery({
    queryKey: ["stock-summary-for-allocation"],
    queryFn: async () => api.stockSummary.list(),
  });

  const productsQ = useQuery({
    queryKey: ["products-for-allocation"],
    queryFn: async () => {
      const data = (await api.products.list()) as CatalogueProduct[];
      return data.filter((p) => p.status === "active");
    },
  });

  // Transfer history: filter movements with linkedDocumentType === "Transfer"
  const movementsQ = useQuery({
    queryKey: ["stock_movements_for_transfers"],
    queryFn: async () => {
      const data = await api.stockMovements.list();
      return data.filter(
        (m: any) => m.linked_document_type === "Transfer" && m.status === "confirmed"
      );
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["stock-locations"] });
    qc.invalidateQueries({ queryKey: ["stock-summary-for-allocation"] });
    qc.invalidateQueries({ queryKey: ["stock-summary"] });
    qc.invalidateQueries({ queryKey: ["stock-summary-for-locations"] });
    qc.invalidateQueries({ queryKey: ["inventory"] });
    qc.invalidateQueries({ queryKey: ["stock_movements"] });
    qc.invalidateQueries({ queryKey: ["stock_movements_all"] });
    qc.invalidateQueries({ queryKey: ["stock_movements_for_transfers"] });
    qc.invalidateQueries({ queryKey: ["products-for-allocation"] });
  };

  const del = useMutation({
    mutationFn: async (id: string) => {
      await api.stockLocations.delete(id);
    },
    onSuccess: () => {
      invalidate();
      toast.success("Location deleted");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // Compute total stock per location across all products
  const locationStockTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const summary of (stockSummaryQ.data ?? []) as StockSummaryItem[]) {
      for (const lb of summary.locationBreakdown ?? []) {
        const cur = totals.get(lb.locationId) ?? 0;
        totals.set(lb.locationId, cur + (lb.quantity || 0));
      }
    }
    return totals;
  }, [stockSummaryQ.data]);

  // Total stock across all locations (from stock summary)
  const totalCompanyStock = useMemo(() => {
    return (stockSummaryQ.data ?? []).reduce(
      (sum: number, s: StockSummaryItem) => sum + (s.totalCompanyStock || 0),
      0
    );
  }, [stockSummaryQ.data]);

  // Stock value across all locations
  const totalStockValue = useMemo(() => {
    let value = 0;
    for (const summary of (stockSummaryQ.data ?? []) as StockSummaryItem[]) {
      const product = (productsQ.data ?? []).find((p: any) => p.id === summary.productId);
      const unitCost = (product as any)?.unit_cost ?? (product as any)?.unitCost ?? 0;
      value += summary.totalCompanyStock * unitCost;
    }
    return value;
  }, [stockSummaryQ.data, productsQ.data]);

  const stats = useMemo(() => {
    const locs = locationsQ.data ?? [];
    return {
      total: locs.length,
      active: locs.filter((l) => l.status === "active").length,
      warehouses: locs.filter((l) => l.location_type === "central_warehouse").length,
      marketplaces: locs.filter((l) => l.location_type === "marketplace_warehouse").length,
    };
  }, [locationsQ.data]);

  const getLocationIcon = (type: string): LucideIcon => {
    return LOCATION_TYPES.find((t) => t.value === type)?.icon ?? MapPin;
  };

  // Transfer records grouped by transfer_id for history
  const transferGroups = useMemo(() => {
    const movements = (movementsQ.data ?? []) as TransferRecord[];
    const groups = new Map<string, TransferRecord[]>();
    for (const m of movements) {
      const tid = m.transfer_id ?? m.id;
      if (!groups.has(tid)) groups.set(tid, []);
      groups.get(tid)!.push(m);
    }
    // Sort by most recent first
    return Array.from(groups.entries()).sort((a, b) => {
      const aDate = a[1][0]?.movement_date ?? "";
      const bDate = b[1][0]?.movement_date ?? "";
      return bDate.localeCompare(aDate);
    });
  }, [movementsQ.data]);

  return (
    <div>
      <PageHeader
        eyebrow="Inventory"
        title="Stock Allocation"
        description="View stock across locations and allocate (transfer) stock between locations. GRN credits stock to the receiving location, then allocate it to other locations as needed for dispatch."
        icon={<ArrowRightLeft className="h-5 w-5" />}
        actions={
          canWrite ? (
            <div className="flex gap-2">
              <button
                onClick={() => setOpenAllocateModal(true)}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                <ArrowRightLeft className="h-4 w-4" /> Allocate stock
              </button>
              <button
                onClick={() => {
                  setEditingLocation(null);
                  setOpenLocationModal(true);
                }}
                className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium"
              >
                <Plus className="h-4 w-4" /> New location
              </button>
            </div>
          ) : (
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              Read-only
            </span>
          )
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        {/* Total Company Stock */}
        <div className="rounded-lg border border-border bg-muted/20 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground">
                Total Company Stock
              </div>
              <div className="mt-1 text-2xl font-bold num">
                {totalCompanyStock.toLocaleString()}
              </div>
              <div className="text-[10px] text-muted-foreground">
                Sum of all {stats.active} active locations
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">
                Stock Value
              </div>
              <div className="mt-1 text-xl font-bold num">{fmtMoney(totalStockValue)}</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Locations" value={stats.total} icon={MapPin} />
          <StatTile label="Active" value={stats.active} icon={CheckCircle2} />
          <StatTile label="Warehouses" value={stats.warehouses} icon={Warehouse} />
          <StatTile label="Marketplaces" value={stats.marketplaces} icon={Building2} />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 rounded-lg border border-border bg-muted/20 p-1">
          <button
            onClick={() => setActiveTab("overview")}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "overview"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <MapPin className="mr-1 inline h-3.5 w-3.5" /> Location stock
          </button>
          <button
            onClick={() => setActiveTab("transfers")}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "transfers"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <ArrowRightLeft className="mr-1 inline h-3.5 w-3.5" /> Allocation history
          </button>
        </div>

        {/* Tab: Location Stock Overview */}
        {activeTab === "overview" && (
          <Card>
            {locationsQ.isLoading ? (
              <TableSkeleton rows={5} cols={6} />
            ) : (locationsQ.data ?? []).length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                <MapPin className="mx-auto mb-2 h-8 w-8 opacity-40" />
                No stock locations yet. Create your first location to start tracking inventory.
              </div>
            ) : (
              <div className="-mx-5 overflow-x-auto">
                <table className="table-premium w-full text-sm">
                  <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-5 py-2 text-left font-normal">Location</th>
                      <th className="px-5 py-2 text-left font-normal">Type</th>
                      <th className="px-5 py-2 text-left font-normal">Channel</th>
                      <th className="px-5 py-2 text-right font-normal">Current Stock</th>
                      <th className="px-5 py-2 text-left font-normal">Status</th>
                      {canWrite && (
                        <th className="px-5 py-2 text-right font-normal">Actions</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {(locationsQ.data ?? []).map((loc) => {
                      const Icon = getLocationIcon(loc.location_type);
                      const stock = locationStockTotals.get(loc.id) ?? 0;
                      return (
                        <tr key={loc.id} className="border-b border-border/60 hover:bg-muted/30">
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              <Icon className="h-4 w-4 text-muted-foreground" />
                              <div>
                                <div className="font-medium">{loc.name}</div>
                                {loc.address && (
                                  <div className="text-[10px] text-muted-foreground">
                                    {loc.address}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3 text-xs text-muted-foreground">
                            {LOCATION_TYPES.find((t) => t.value === loc.location_type)?.label ?? loc.location_type}
                          </td>
                          <td className="px-5 py-3 text-xs text-muted-foreground">
                            {loc.channel ?? "—"}
                          </td>
                          <td className="px-5 py-3 text-right num font-medium">
                            {stock.toLocaleString()}
                          </td>
                          <td className="px-5 py-3">
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                                loc.status === "active"
                                  ? "border-success/40 bg-success/10 text-success"
                                  : "border-border bg-muted/40 text-muted-foreground"
                              }`}
                            >
                              {loc.status}
                            </span>
                          </td>
                          {canWrite && (
                            <td className="px-5 py-3 text-right">
                              <div className="flex justify-end gap-1">
                                <button
                                  onClick={() => {
                                    setEditingLocation(loc);
                                    setOpenLocationModal(true);
                                  }}
                                  className="rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary"
                                  title="Edit"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                                <button
                                  onClick={() =>
                                    pendingDelete === loc.id
                                      ? del.mutate(loc.id)
                                      : setPendingDelete(loc.id)
                                  }
                                  disabled={del.isPending}
                                  className={`rounded-md border px-2 py-1 text-[10px] ${
                                    pendingDelete === loc.id
                                      ? "border-destructive/50 text-destructive hover:bg-destructive/10"
                                      : "border-border text-muted-foreground hover:border-destructive hover:text-destructive"
                                  }`}
                                >
                                  {pendingDelete === loc.id ? "Delete?" : <Trash2 className="h-3.5 w-3.5" />}
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        {/* Tab: Transfer / Allocation History */}
        {activeTab === "transfers" && (
          <Card>
            {movementsQ.isLoading ? (
              <TableSkeleton rows={5} cols={6} />
            ) : transferGroups.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                <ArrowRightLeft className="mx-auto mb-2 h-8 w-8 opacity-40" />
                No stock allocations yet. Use "Allocate stock" to transfer between locations.
              </div>
            ) : (
              <div className="-mx-5 overflow-x-auto">
                <table className="table-premium w-full text-sm">
                  <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-5 py-2 text-left font-normal">Transfer #</th>
                      <th className="px-5 py-2 text-left font-normal">Product</th>
                      <th className="px-5 py-2 text-left font-normal">From</th>
                      <th className="px-5 py-2 text-left font-normal">To</th>
                      <th className="px-5 py-2 text-right font-normal">Quantity</th>
                      <th className="px-5 py-2 text-left font-normal">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transferGroups.map(([tid, movements]) => {
                      const sourceMov = movements.find((m) => m.direction === "out");
                      const destMov = movements.find((m) => m.direction === "in");
                      if (!sourceMov) return null;
                      return (
                        <tr key={tid} className="border-b border-border/60 hover:bg-muted/30">
                          <td className="px-5 py-3 font-mono text-xs">
                            {sourceMov.linked_document_number ?? tid.slice(0, 12)}
                          </td>
                          <td className="px-5 py-3">
                            <div className="font-medium">{sourceMov.item_name}</div>
                            {sourceMov.sku && (
                              <div className="text-[10px] font-mono text-muted-foreground">
                                {sourceMov.sku}
                              </div>
                            )}
                          </td>
                          <td className="px-5 py-3 text-xs text-muted-foreground">
                            {getLocName(locationsQ.data ?? [], sourceMov.source_location_id) ?? "—"}
                          </td>
                          <td className="px-5 py-3 text-xs text-muted-foreground">
                            {destMov
                              ? (getLocName(locationsQ.data ?? [], destMov.destination_location_id) ?? "—")
                              : "In transit"}
                          </td>
                          <td className="px-5 py-3 text-right num font-medium">
                            {sourceMov.quantity.toLocaleString()}
                          </td>
                          <td className="px-5 py-3 text-xs text-muted-foreground">
                            {fmtDate(sourceMov.movement_date)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        <Card title="How stock allocation works">
          <ol className="ml-4 list-decimal space-y-1 text-xs text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">GRN confirms</span> — stock is
              credited to the receiving location (e.g. Central Warehouse). Total Company Stock
              increases.
            </li>
            <li>
              <span className="font-medium text-foreground">Allocate stock</span> — move stock from
              one location to another (e.g. Central Warehouse → Amazon FBA). Total Company Stock
              stays unchanged — this is an internal transfer.
            </li>
            <li>
              <span className="font-medium text-foreground">Dispatch</span> — when a dispatch is
              confirmed, stock is debited from the source location. Total Company Stock decreases.
            </li>
            <li>
              <span className="font-medium text-foreground">Total Company Stock</span> = sum of all
              location stocks. Transfers never change the total.
            </li>
          </ol>
        </Card>
      </div>

      {/* Modals */}
      {openLocationModal && (
        <LocationModal
          location={editingLocation}
          onClose={() => setOpenLocationModal(false)}
          onSaved={invalidate}
        />
      )}
      {openAllocateModal && (
        <AllocateModal
          locations={(locationsQ.data ?? []).filter((l) => l.status === "active")}
          products={(productsQ.data ?? []) as CatalogueProduct[]}
          onClose={() => setOpenAllocateModal(false)}
          onDone={() => {
            invalidate();
            setOpenAllocateModal(false);
          }}
        />
      )}
    </div>
  );
}

// ─── Allocate (Transfer) Modal ──────────────────────────────────────────────
function AllocateModal({
  locations,
  products,
  onClose,
  onDone,
}: {
  locations: StockLocation[];
  products: CatalogueProduct[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [f, setF] = useState({
    product_id: "",
    sku_search: "",
    source_location_id: "",
    destination_location_id: "",
    quantity: "",
    notes: "",
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!f.product_id) throw new Error("Select a product to allocate");
      if (!f.source_location_id) throw new Error("Select a source location");
      if (!f.destination_location_id) throw new Error("Select a destination location");
      if (f.source_location_id === f.destination_location_id) throw new Error("Source and destination must be different");
      if (!(Number(f.quantity) > 0)) throw new Error("Quantity must be greater than zero");

      await api.stockTransfers.create({
        product_id: f.product_id,
        source_location_id: f.source_location_id,
        destination_location_id: f.destination_location_id,
        quantity: Number(f.quantity),
        notes: f.notes.trim() || null,
      });
    },
    onSuccess: () => {
      toast.success("Stock allocated successfully");
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const selectedProduct = products.find((p) => p.id === f.product_id);

  // SKU search: find product by SKU or name
  const handleSkuSearch = (value: string) => {
    setF({ ...f, sku_search: value });
    if (!value.trim()) return;
    const q = value.trim().toLowerCase();
    const match = products.find(
      (p) =>
        (p.sku ?? "").toLowerCase() === q ||
        (p.sku ?? "").toLowerCase().startsWith(q) ||
        (p.name ?? "").toLowerCase().includes(q)
    );
    if (match) {
      setF((prev) => ({ ...prev, product_id: match.id, sku_search: match.sku ?? "" }));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <div>
            <h3 className="font-display text-lg">Allocate stock</h3>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Transfer stock between locations
            </div>
          </div>
          <button onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-4 p-5"
        >
          {/* SKU search field */}
          <L label="SKU / Product search">
            <div className="flex items-center gap-2">
              <input
                className="inp"
                value={f.sku_search}
                onChange={(e) => handleSkuSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSkuSearch(f.sku_search);
                  }
                }}
                placeholder="Type a SKU or product name and press Enter…"
              />
              {f.product_id && (
                <button
                  type="button"
                  onClick={() => setF({ ...f, product_id: "", sku_search: "" })}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </L>

          <L label="Product *">
            <SearchableSelect
              value={f.product_id}
              onChange={(v) => {
                const p = products.find((x) => x.id === v);
                setF({ ...f, product_id: v, sku_search: p?.sku ?? f.sku_search });
              }}
              placeholder="Select product…"
              options={products.map((p) => ({
                value: p.id,
                label: p.sku ? `${p.sku} · ${p.name}` : p.name,
              }))}
            />
          </L>

          {/* SKU + Unit display when product is selected */}
          {selectedProduct && (
            <div className="grid grid-cols-2 gap-3">
              <L label="SKU">
                <input
                  className="inp"
                  value={selectedProduct.sku ?? "—"}
                  disabled
                />
              </L>
              <L label="Unit">
                <input
                  className="inp"
                  value={selectedProduct.unit_of_measure ?? "unit"}
                  disabled
                />
              </L>
            </div>
          )}

          <L label="From location *">
            <select
              className="inp"
              value={f.source_location_id}
              onChange={(e) => setF({ ...f, source_location_id: e.target.value })}
            >
              <option value="">Select source…</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}{loc.channel ? ` (${loc.channel})` : ""}
                </option>
              ))}
            </select>
          </L>

          <L label="To location *">
            <select
              className="inp"
              value={f.destination_location_id}
              onChange={(e) => setF({ ...f, destination_location_id: e.target.value })}
            >
              <option value="">Select destination…</option>
              {locations
                .filter((l) => l.id !== f.source_location_id)
                .map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}{loc.channel ? ` (${loc.channel})` : ""}
                  </option>
                ))}
            </select>
          </L>

          <div className="grid grid-cols-2 gap-3">
            <L label="Quantity *">
              <input
                type="number"
                min="1"
                step="0.001"
                className="inp"
                value={f.quantity}
                onChange={(e) => setF({ ...f, quantity: e.target.value })}
                placeholder="Units to transfer"
              />
            </L>
            {selectedProduct && (
              <L label="Unit">
                <input
                  className="inp"
                  value={selectedProduct.unit_of_measure ?? "unit"}
                  disabled
                />
              </L>
            )}
          </div>

          <L label="Notes (optional)">
            <textarea
              rows={2}
              className="inp resize-y"
              value={f.notes}
              onChange={(e) => setF({ ...f, notes: e.target.value })}
              placeholder="Reason for allocation…"
            />
          </L>

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={save.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Allocate stock
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:disabled{opacity:.55}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

// ─── Location Create/Edit Modal ─────────────────────────────────────────────
function LocationModal({
  location,
  onClose,
  onSaved,
}: {
  location: StockLocation | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!location;
  const [f, setF] = useState({
    name: location?.name ?? "",
    location_type: location?.location_type ?? "central_warehouse",
    channel: location?.channel ?? "",
    address: location?.address ?? "",
    status: location?.status ?? "active",
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!f.name.trim()) throw new Error("Location name is required");
      const payload = {
        name: f.name.trim(),
        location_type: f.location_type,
        channel: f.channel.trim() || null,
        address: f.address.trim() || null,
        status: f.status,
      };
      if (isEdit && location) {
        await api.stockLocations.update(location.id, payload);
      } else {
        await api.stockLocations.create(payload);
      }
    },
    onSuccess: () => {
      onSaved();
      toast.success(isEdit ? "Location updated" : "Location created");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">
            {isEdit ? `Edit ${location.name}` : "New stock location"}
          </h3>
          <button onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-4 p-5"
        >
          <L label="Location name *">
            <input
              className="inp"
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              placeholder="e.g. Central Warehouse, Amazon FBA"
            />
          </L>
          <L label="Location type">
            <select
              className="inp"
              value={f.location_type}
              onChange={(e) => setF({ ...f, location_type: e.target.value })}
            >
              {LOCATION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </L>
          <L label="Channel (optional)">
            <input
              className="inp"
              value={f.channel}
              onChange={(e) => setF({ ...f, channel: e.target.value })}
              placeholder="e.g. Amazon, Flipkart"
            />
          </L>
          <L label="Address (optional)">
            <textarea
              rows={2}
              className="inp resize-y"
              value={f.address}
              onChange={(e) => setF({ ...f, address: e.target.value })}
              placeholder="Physical address"
            />
          </L>
          <L label="Status">
            <select
              className="inp"
              value={f.status}
              onChange={(e) => setF({ ...f, status: e.target.value as "active" | "inactive" })}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </L>

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={save.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? "Update location" : "Create location"}
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:disabled{opacity:.55}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function getLocName(locations: StockLocation[], id: string | null): string | null {
  if (!id) return null;
  return locations.find((l) => l.id === id)?.name ?? null;
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function StatTile({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon?: LucideIcon;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className="mt-1 text-xl font-bold num">{typeof value === "number" ? value.toLocaleString() : value}</div>
    </div>
  );
}
