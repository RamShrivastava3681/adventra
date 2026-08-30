import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card } from "@/components/ledger-ui";
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
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/stock-locations")({
  component: StockLocationsPage,
});

const LOCATION_TYPES: { value: string; label: string; icon: LucideIcon }[] = [
  { value: "central_warehouse", label: "Central Warehouse", icon: Warehouse },
  { value: "marketplace_warehouse", label: "Marketplace Warehouse", icon: Building2 },
  { value: "own_store", label: "Own Store", icon: Store },
  { value: "transit", label: "Transit", icon: Truck },
  { value: "other_warehouse", label: "Other Warehouse", icon: Boxes },
];

type StockLocation = {
  id: string;
  name: string;
  location_type: string;
  channel: string | null;
  address: string | null;
  status: "active" | "inactive";
  created_at: string;
};

function StockLocationsPage() {
  const { user, isSalesRep, isReportingManager } = useAuth();
  const canWrite = !!user && !isSalesRep && !isReportingManager;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<StockLocation | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const locationsQ = useQuery({
    queryKey: ["stock-locations"],
    queryFn: async () => {
      const data = (await api.stockLocations.list()) as StockLocation[];
      return data.sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  // Fetch stock summary to show per-location totals
  const stockSummaryQ = useQuery({
    queryKey: ["stock-summary-for-locations"],
    queryFn: async () => api.stockSummary.list(),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["stock-locations"] });
    qc.invalidateQueries({ queryKey: ["stock-summary-for-locations"] });
    qc.invalidateQueries({ queryKey: ["stock-summary"] });
    qc.invalidateQueries({ queryKey: ["inventory"] });
    qc.invalidateQueries({ queryKey: ["stock_movements"] });
    qc.invalidateQueries({ queryKey: ["stock_movements_all"] });
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
    for (const summary of (stockSummaryQ.data ?? []) as any[]) {
      for (const lb of summary.location_breakdown ?? []) {
        const cur = totals.get(lb.location_id) ?? 0;
        totals.set(lb.location_id, cur + (lb.quantity || 0));
      }
    }
    return totals;
  }, [stockSummaryQ.data]);

  const totalCompanyStock = useMemo(() => {
    return (stockSummaryQ.data ?? []).reduce(
      (sum: number, s: any) => sum + (s.total_company_stock || 0),
      0
    );
  }, [stockSummaryQ.data]);

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

  return (
    <div>
      <PageHeader
        eyebrow="Inventory"
        title="Stock Locations"
        description="Manage physical and logical locations where inventory is stored. Every stock movement has a source and destination location. Total Company Stock = sum of all location stocks."
        icon={<MapPin className="h-5 w-5" />}
        actions={
          canWrite ? (
            <button
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              <Plus className="h-4 w-4" /> New Location
            </button>
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
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            Total Company Stock
          </div>
          <div className="mt-1 text-2xl font-bold num">
            {totalCompanyStock.toLocaleString()}
          </div>
          <div className="text-[10px] text-muted-foreground">
            Sum of all active locations
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Total locations" value={stats.total} icon={MapPin} />
          <StatTile label="Active" value={stats.active} icon={CheckCircle2} />
          <StatTile label="Warehouses" value={stats.warehouses} icon={Warehouse} />
          <StatTile label="Marketplaces" value={stats.marketplaces} icon={Building2} />
        </div>

        <Card>
          {locationsQ.isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Loading...
            </div>
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
                                  setEditing(loc);
                                  setOpen(true);
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

        <Card title="How stock locations work">
          <ol className="ml-4 list-decimal space-y-1 text-xs text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">GRN</span> adds stock
              to a receiving location and increases Total Company Stock.
            </li>
            <li>
              <span className="font-medium text-foreground">Stock Transfer</span>{" "}
              moves stock between locations — Total Company Stock stays unchanged.
            </li>
            <li>
              <span className="font-medium text-foreground">Customer / Marketplace Sale</span>{" "}
              reduces stock at the source location and decreases Total Company Stock.
              This counts as demand.
            </li>
            <li>
              <span className="font-medium text-foreground">Total Company Stock</span>{" "}
              = sum of all location stocks. Never double-count.
            </li>
          </ol>
        </Card>
      </div>

      {open && (
        <LocationModal
          location={editing}
          onClose={() => setOpen(false)}
          onSaved={invalidate}
        />
      )}
    </div>
  );
}

// ─── Location create/edit modal ──────────────────────────────────────────
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
              {isEdit ? "Save changes" : "Create location"}
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:disabled{opacity:.55}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

// ─── Shared bits ─────────────────────────────────────────────────────────
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
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
  icon: LucideIcon;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 text-lg font-bold num">{value}</div>
    </div>
  );
}
