import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import {
  Dialog,
  DialogWithStickyFooter,
  Field,
  inputBase,
  textareaBase,
  selectBase,
  TwoFieldGrid,
  InfoPanel,
} from "@/components/dialog";
import { LineHeaders, AddLineButton } from "@/components/dialog/LineRow";
import { ProductThumb } from "@/components/product-thumb";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { SearchSkeleton, TableSkeleton, SkeletonRow } from "@/components/skeletons";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Plus, X, Loader2, ArrowDownToLine, ArrowUpFromLine, Trash2, Check, Ban, Package, Pencil, Boxes, Upload, FileSpreadsheet, AlertTriangle, RefreshCw, Settings, Search, ArrowDownAZ, ArrowUpAZ, LayoutGrid, List, ArrowRightLeft, Filter } from "lucide-react";

export const Route = createFileRoute("/app/inventory")({
  component: InventoryPage,
});

type Movement = {
  id: string;
  movement_number: string;
  movementNumber?: string;
  product_id: string | null;
  productId?: string | null;
  direction: "in" | "out";
  item_name: string;
  itemName?: string;
  sku: string | null;
  quantity: number;
  unit: string;
  unit_cost: number | null;
  warehouse: string | null;
  reason: string | null;
  linked_document_type: string | null;
  linked_document_number: string | null;
  status: "draft" | "confirmed" | "cancelled";
  created_by_id: string | null;
  created_by_name: string | null;
  confirmed_by_id: string | null;
  confirmed_by_name: string | null;
  confirmed_at: string | null;
  notes: string | null;
  movement_date: string;
  movementDate?: string;
  invoice_id: string | null;
  purchase_invoice_id: string | null;
  goods_receipt_id: string | null;
  goods_dispatch_id: string | null;
  purchase_order_id: string | null;
  created_at: string;
};

// Reasons a user may pick on a MANUAL entry. Goods receipt & Dispatch are
// system-generated (confirmed GRNs / dispatched invoices).
const MANUAL_REASONS: { label: string; direction: "in" | "out"; docType: string }[] = [
  { label: "Opening stock", direction: "in", docType: "Adjustment" },
  { label: "Stock adjustment", direction: "in", docType: "Adjustment" },
  { label: "Damage", direction: "out", docType: "Adjustment" },
  { label: "Samples / internal use", direction: "out", docType: "Adjustment" },
  { label: "Customer return", direction: "in", docType: "Return" },
  { label: "Supplier return", direction: "out", docType: "Return" },
];

const LINKED_DOC_TYPES = [
  "GRN",
  "Dispatch",
  "PO",
  "Purchase Invoice",
  "Sales Invoice",
  "Return",
  "Adjustment",
];

function invalidateStock(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["stock_movements"] });
  qc.invalidateQueries({ queryKey: ["stock_movements_all"] });
  qc.invalidateQueries({ queryKey: ["movements-forecast"] });
  qc.invalidateQueries({ queryKey: ["forecast-variables"] });
  qc.invalidateQueries({ queryKey: ["products-forecast"] });
}

// ── Standard colour codes (used as suffixes in SKU) ──────────────────────────
const STANDARD_COLOUR_CODES: Record<string, string> = {
  BLK: "Black",
  WHT: "White",
  GRY: "Grey",
  CHR: "Charcoal",
  SLV: "Silver",
  BLU: "Blue",
  NVY: "Navy Blue",
  RYL: "Royal Blue",
  SKY: "Sky Blue",
  IBL: "Ice Blue",
  TEL: "Teal",
  TRQ: "Turquoise",
  GRN: "Green",
  OLV: "Olive Green",
  FGR: "Forest Green",
  KHK: "Khaki",
  RED: "Red",
  MAR: "Maroon",
  BRG: "Burgundy",
  ORG: "Orange",
  YLW: "Yellow",
  PUR: "Purple",
  PNK: "Pink",
  BRN: "Brown",
  CYB: "Coyote Brown",
  TAN: "Tan",
  BEI: "Beige",
  SND: "Sand",
  STN: "Stone",
  GLD: "Gold",
  CPR: "Copper",
  CAM: "Camouflage",
  MLT: "Multi Colour",
  AST: "Assorted",
  CLR: "Transparent",
};

// ── Standard gender codes ───────────────────────────────────────────────────
const STANDARD_GENDER_CODES: Record<string, string> = {
  MEN: "Men",
  WOM: "Women",
  UNI: "Unisex",
  KID: "Kids",
  BOY: "Boys",
  GRL: "Girls",
};

// ── Direction badges ────────────────────────────────────────────────────────
function DirBadge({ direction }: { direction: "in" | "out" }) {
  return direction === "in" ? (
    <span className="inline-flex items-center gap-1 text-sem-success">
      <ArrowDownToLine className="h-3.5 w-3.5" /> Credit
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-sem-attention">
      <ArrowUpFromLine className="h-3.5 w-3.5" /> Debit
    </span>
  );
}

// ── Stock state pill ──────────────────────────────────────────────────────
function StockStatePill({ state }: { state: "in" | "low" | "out" }) {
  if (state === "out")
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-destructive">
        <span className="h-1.5 w-1.5 rounded-full bg-destructive" /> Out of Stock
      </span>
    );
  if (state === "low")
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-sem-attention">
        <span className="h-1.5 w-1.5 rounded-full bg-sem-attention" /> Low Stock
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-sem-success">
      <span className="h-1.5 w-1.5 rounded-full bg-sem-success" /> In Stock
    </span>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────
function KpiCard({
  title,
  value,
  subtitle,
  Icon,
  className,
}: {
  title: string;
  value: string | number;
  subtitle: string;
  Icon: React.ElementType;
  className: string;
}) {
  return (
    <Card className={className} shadow-sm>
      <div className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{title}</p>
            <p className="mt-1 font-display text-lg font-semibold text-primary">{String(value)}</p>
            <p className="text-[10px] text-muted-foreground">{subtitle}</p>
          </div>
          <Icon className="h-6 w-6 text-primary" />
        </div>
      </div>
    </Card>
  );
}

// ── Inventory hierarchical data ────────────────────────────────────────────
function useInventoryData() {
  const productsQ = useQuery({
    queryKey: ["products-inventory"],
    queryFn: async () => {
      const data = await api.products.list();
      return (Array.isArray(data) ? data : []).map((p: any) => ({
        id: String(p.id ?? ""),
        name: String(p.name ?? ""),
        sku: String(p.sku ?? ""),
        model: p.model ?? null,
        category: p.category,
        gender: p.gender,
        image_url: p.imageUrl ?? p.image_url ?? null,
        unit_of_measure: p.unit_of_measure ?? p.unitOfMeasure ?? "unit",
        parent_id: p.parent_id ?? p.parentId ?? null,
        // Colour variants have parent_id set to master; size variants have parent_id set to colour
        color: p.color,
        size: p.size,
      }));
    },
    refetchInterval: 5000,
  });

  const movementsQ = useQuery({
    queryKey: ["stock_movements"],
    queryFn: async () => {
      const data = await api.stockMovements.list();
      return (Array.isArray(data) ? data : []).slice().reverse();
    },
    refetchInterval: 5000,
  });

  // Build hierarchy: Master → Colour → Size
  const masterProducts = useMemo(() => {
    const masters: any[] = [];
    const colourMap = new Map<string, any[]>();
    const sizeMap = new Map<string, any[]>();

    for (const p of productsQ.data ?? []) {
      if (p.parent_id === null || !p.parent_id) {
        // Master product
        masters.push(p);
        if (!colourMap.has(p.id)) colourMap.set(p.id, []);
      } else {
        // Colour or size variant
        const parentId = p.parent_id;
        if (!colourMap.has(parentId)) colourMap.set(parentId, []);
        colourMap.get(parentId)!.push(p);

        // If this variant has its own children (sizes), track them
        if (!sizeMap.has(parentId)) sizeMap.set(parentId, []);
        sizeMap.get(parentId)!.push(p);
      }
    }

    return { masters, colourMap, sizeMap };
  }, [productsQ.data]);

  // Calculate confirmed stock per product/SKU
  const confirmedMovements = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of (movementsQ.data ?? []) as Movement[]) {
      if (r.status !== "confirmed") continue;
      const key = r.sku ?? r.product_id ?? r.productId ?? `${r.item_name ?? r.itemName}|${r.unit}`;
      const sign = r.direction === "in" ? 1 : -1;
      m.set(key, (m.get(key) ?? 0) + sign * Number(r.quantity));
    }
    return m;
  }, [movementsQ.data]);

  // Calculate stock state per product family
  const stockByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const [key, qty] of confirmedMovements) {
      m.set(key, (m.get(key) ?? 0) + qty);
    }
    return m;
  }, [confirmedMovements]);

  // Calculate KPIs
  const totalProducts = masterProducts.masters.length;
  const totalVariants = useMemo(() => {
    let count = 0;
    for (const colourList of masterProducts.colourMap.values()) {
      count += colourList.length;
    }
    return count;
  }, [masterProducts.colourMap]);
  const totalStockUnits = useMemo(() => {
    let total = 0;
    for (const [, qty] of stockByProduct) {
      total += Math.max(0, qty);
    }
    return total;
  }, [stockByProduct]);
  const lowOutStockCount = useMemo(() => {
    let count = 0;
    for (const [, qty] of stockByProduct) {
      if (qty > 0 && qty <= 5) count++; // low stock threshold
      if (qty <= 0) count++; // out of stock
    }
    return count;
  }, [stockByProduct]);

  // Build product → colour → size hierarchy with stock
  const productHierarchy = useMemo(() => {
    const hierarchy: any[] = [];

    for (const master of masterProducts.masters) {
      const colours = masterProducts.colourMap.get(master.id) ?? [];
      const colourEntries = (colours.length > 0 ? colours : [master]).map((colour: any) => {
        const sizes = masterProducts.sizeMap.get(colour.id) ?? [];
        const sizeData = sizes.map((size: any) => {
          const sku = size.sku ?? "";
          const stock = stockByProduct.get(sku) ?? stockByProduct.get(size.id) ?? 0;
          return {
            id: size.id,
            sku: sku,
            name: size.name || "",
            size: size.size || "",
            color: colour.color || "",
            stock,
            stockState: stock <= 0 ? "out" : stock <= 5 ? "low" : "in",
          };
        });

        const leafRows = sizeData.length > 0
          ? sizeData
          : [{
              id: colour.id,
              sku: colour.sku ?? "",
              name: colour.name || "",
              size: colour.size || "",
              color: colour.color || "",
              sizes: [],
              stock: stockByProduct.get(colour.sku ?? "") ?? stockByProduct.get(colour.id) ?? 0,
              stockState: "in",
            }];
        const colourStock = leafRows.reduce((sum: number, s: any) => sum + (s.stock ?? 0), 0);
        const totalColoursStock = colourStock;

        return {
          id: colour.id,
          sku: colour.sku ?? "",
          name: colour.name || "",
          color: colour.color || "",
          sizes: leafRows,
          colourStock,
          totalColoursStock,
        };
      });

      hierarchy.push({
        id: master.id,
        sku: master.sku,
        name: master.name,
        image_url: master.image_url,
        model: master.model,
        category: master.category,
        gender: master.gender,
        colours: colourEntries,
        totalColours: colours.length,
        totalVariants: colourEntries.reduce((sum: number, c: any) => sum + c.sizes.length, 0),
        stockState: masterProducts.masters.length > 0 ? "ok" : "out",
      });
    }

    return hierarchy;
  }, [masterProducts, stockByProduct, masterProducts.sizeMap]);

  return {
    productsQ,
    movementsQ,
    masterProducts,
    confirmedMovements,
    stockByProduct,
    totalProducts,
    totalVariants,
    totalStockUnits,
    lowOutStockCount,
    productHierarchy,
  };
}

// ── Movement mutation helpers ──────────────────────────────────────────────
function useMovementMutations(qc: ReturnType<typeof useQueryClient>) {
  const confirmMut = useMutation({
    mutationFn: async (id: string) => api.stockMovements.confirm(id),
    onSuccess: () => {
      invalidateStock(qc);
      toast.success("Movement confirmed — stock updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const actMut = useMutation({
    mutationFn: async ({ kind, id }: { kind: "cancel" | "delete"; id: string }) => {
      if (kind === "cancel") await api.stockMovements.cancel(id);
      else await api.stockMovements.delete(id);
    },
    onSuccess: (_d, vars) => {
      invalidateStock(qc);
      toast.success(vars.kind === "cancel" ? "Movement cancelled" : "Movement deleted");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const bulkCreateMut = useMutation({
    mutationFn: async (data: {
      productId: string;
      reason: string;
      warehouse: string | undefined;
      notes: string | undefined;
      status: "draft" | "confirmed";
      movements: Array<{
        date: string;
        direction: "in" | "out";
        quantity: number;
        reason?: string;
      }>;
    }) => {
      return api.stockMovements.bulkCreate(data);
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["stock_movements"] });
      qc.invalidateQueries({ queryKey: ["stock_movements_all"] });
      qc.invalidateQueries({ queryKey: ["movements-forecast"] });
      qc.invalidateQueries({ queryKey: ["forecast-variables"] });
      qc.invalidateQueries({ queryKey: ["products-forecast"] });
      toast.success(`Imported ${data.created} movement(s) successfully`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Import failed"),
  });

  return { confirmMut, actMut, bulkCreateMut };
}

// ── Filter state ──────────────────────────────────────────────────────────
function useFilterState() {
  const [search, setSearch] = useState("");

  const resetFilters = () => {
    setSearch("");
  };

  return { search, setSearch, resetFilters };
}

// ── Inventory Page ────────────────────────────────────────────────────────
export function InventoryPage({
  initialViewMode = "overview",
}: {
  initialViewMode?: "overview" | "detailed";
}) {
  const { user, isAdmin, isClient, isChecker, isTreasury } = useAuth();
  const canWrite = isAdmin || (isClient && !isChecker && !isTreasury);
  const qc = useQueryClient();
  const {
    productsQ,
    movementsQ,
    masterProducts,
    confirmedMovements,
    stockByProduct,
    totalProducts,
    totalVariants,
    totalStockUnits,
    lowOutStockCount,
    productHierarchy,
  } = useInventoryData();

  const { search, setSearch, resetFilters } = useFilterState();

  const { confirmMut, actMut, bulkCreateMut } = useMovementMutations(qc);

  // ── KPI calculation ────────────────────────────────────────────────────
  const kpiCards = useMemo(() => [
    <KpiCard
      title="Total Products"
      value={totalProducts}
      subtitle="Unique master products"
      Icon={Package}
      className="col-span-1"
    />,
    <KpiCard
      title="Total Variants"
      value={totalVariants}
      subtitle="Colour-size combinations"
      Icon={Boxes}
      className="col-span-1"
    />,
    <KpiCard
      title="Total Stock Units"
      value={totalStockUnits.toLocaleString()}
      subtitle="Sum of all confirmed available stock"
      Icon={ArrowRightLeft}
      className="col-span-1"
    />,
    <KpiCard
      title="Low / Out of Stock"
      value={lowOutStockCount}
      subtitle="Variants requiring replenishment"
      Icon={AlertTriangle}
      className="col-span-1"
    />,
  ], [totalProducts, totalVariants, totalStockUnits, lowOutStockCount]);

  // ── Filtered hierarchy ───────────────────────────────────────────────────
  const filteredHierarchy = useMemo(() => {
    const lower = search.toLowerCase();
    return productHierarchy.filter((p) =>
      p.name.toLowerCase().includes(lower) ||
      p.sku.toLowerCase().includes(lower) ||
      p.colours.some((c: any) =>
        c.color.toLowerCase().includes(lower) ||
        c.sizes.some((s: any) => s.size.toLowerCase().includes(lower) || s.sku.toLowerCase().includes(lower)),
      ),
    );
  }, [productHierarchy, search]);

  // ── Inventory Views state ──────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<"overview" | "detailed">(initialViewMode);

  // ── Render Overview Table ───────────────────────────────────────────────
  function renderOverviewTable() {
    const rows = filteredHierarchy;

    if (rows.length === 0) {
      return (
        <div className="py-8 text-center text-sm text-muted-foreground">
          No products match your filters.
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-sm caption-bottom">
          <caption className="py-3 text-[10px] uppercase tracking-wider text-muted-foreground">
            Inventory Overview
          </caption>
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr className="border-b border-border bg-muted/40">
              <th className="w-24 px-3 py-2 text-left font-medium">Product</th>
              <th className="w-32 px-3 py-2 text-left font-medium">Master SKU</th>
              <th className="w-24 px-3 py-2 text-left font-medium">Total Stock</th>
              <th className="w-20 px-3 py-2 text-left font-medium">Variants</th>
              <th className="w-24 px-3 py-2 text-left font-medium">Expand</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((product) => (
              <tr
                key={product.id}
                className="border-b border-border/60 hover:bg-muted/30"
              >
                <td className="px-3 py-2">
                  <div className="flex items-center gap-3">
                    {product.image_url ? (
                      <ProductThumb
                        imageUrl={product.image_url}
                        name={product.name}
                        size="sm"
                        rounded="md"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-md bg-muted/30 flex items-center justify-center text-[10px] text-muted-foreground">
                        —
                      </div>
                    )}
                    <div>
                      <div className="truncate text-[13px] font-medium text-foreground">{product.name}</div>
                      <div className="text-[10px] text-muted-foreground">{product.model ?? "—"}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{product.sku ?? "—"}</td>
                <td className="px-3 py-2 text-right font-medium text-primary">
                  {(product.totalVariants > 0
                    ? product.colours.reduce((sum: number, c: any) => sum + c.colourStock, 0)
                    : 0
                  ).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-[10px] font-medium text-muted-foreground">
                  {product.totalVariants}
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => setViewMode("detailed")}
                    className="text-[10px] underline text-primary hover:text-primary cursor-pointer"
                  >
                    View details
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // ── Render Detailed Variant Table ───────────────────────────────────────
  function renderDetailedTable() {
    // Flatten all colour-size combinations
    const flatVariants: any[] = [];

    filteredHierarchy.forEach((product) => {
      product.colours.forEach((colour: any) => {
        colour.sizes.forEach((size: any) => {
          flatVariants.push({
            ...size,
            productId: product.id,
            productSku: product.sku,
            productName: product.name,
            colourName: colour.color || "—",
            colourStock: colour.colourStock,
            sku: size.sku ?? `${product.sku}-${colour.color ?? "—"}-${size.size ?? "—"}`,
          });
        });
      });
    });

    // Sort variants by name
    flatVariants.sort((a: any, b: any) => {
      const aName = (a.productName + " " + (a.colourName || "") + " " + (a.size || "")).toLowerCase();
      const bName = (b.productName + " " + (b.colourName || "") + " " + (b.size || "")).toLowerCase();
      if (aName < bName) return -1;
      if (aName > bName) return 1;
      return 0;
    });

    if (flatVariants.length === 0) {
      return (
        <div className="py-8 text-center text-sm text-muted-foreground">
          No variants match your filters.
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1020px] text-sm caption-bottom">
          <caption className="py-3 text-[10px] uppercase tracking-wider text-muted-foreground">
            Detailed Variant View
          </caption>
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr className="border-b border-border bg-muted/40">
              <th className="w-24 px-3 py-2 text-left font-medium">Product</th>
              <th className="w-32 px-3 py-2 text-left font-medium">Master SKU</th>
              <th className="w-16 px-3 py-2 text-left font-medium">Colour</th>
              <th className="w-16 px-3 py-2 text-left font-medium">Size</th>
              <th className="w-16 px-3 py-2 text-right font-medium">Quantity</th>
              <th className="w-16 px-3 py-2 text-left font-medium">Status</th>
              <th className="w-24 px-3 py-2 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {flatVariants.map((variant) => (
              <tr
                key={variant.id}
                className="border-b border-border/60 hover:bg-muted/30"
              >
                <td className="px-3 py-2">
                  <ProductThumb
                    imageUrl={variant.image_url ?? undefined}
                    name={variant.productName}
                    size="sm"
                    rounded="md"
                  />
                  <div className="ml-2 truncate text-[11px] text-muted-foreground">
                    {variant.productSku}
                  </div>
                </td>
                <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">
                  {variant.productSku}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${variant.colourName === "Black" ? "bg-black/20 text-black" : variant.colourName === "White" ? "bg-white/10 text-white" : "bg-gray-200 text-gray-700"}`}
                  >
                    {variant.colourName}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono text-[10px]">
                  {variant.size ?? "—"}
                </td>
                <td className="px-3 py-2 text-right font-medium text-[10px]">
                  <span
                    className={variant.stock <= 0 ? "text-destructive" : variant.stock <= 5 ? "text-sem-attention" : "text-sem-success"}
                  >
                    {(variant.stock ?? 0).toLocaleString()}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <StockStatePill state={variant.stock <= 0 ? "out" : variant.stock <= 5 ? "low" : "in"} />
                </td>
                <td className="px-3 py-2 text-right">
                  {canWrite ? (
                    <button
                      onClick={() => toast.info("Edit movement for variant")}
                      className="rounded-md px-2 py-1 text-[9px] text-muted-foreground hover:bg-muted"
                      title="Adjust"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // ── Render KPI Section ──────────────────────────────────────────────────
  function renderKpiSection() {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {kpiCards}
      </div>
    );
  }

  // ── Render Filter Toolbar ───────────────────────────────────────────────
  function renderFilterToolbar() {
    return (
      <Card className="p-4 mb-4">
        <div className="flex items-center gap-3">
          <label className="text-xs uppercase tracking-wider text-muted-foreground flex-shrink-0">
            Search products…
          </label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input input-bordered w-full max-w-md"
            placeholder="Search by product name, SKU, colour, size…"
          />
          <button
            onClick={resetFilters}
            className="rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:bg-muted/40 transition"
          >
            Reset
          </button>
          <button
            onClick={() => setViewMode((m) => (m === "overview" ? "detailed" : "overview"))}
            className="rounded-md border border-primary px-3 py-1.5 text-[10px] uppercase tracking-wider text-primary-foreground hover:bg-primary/10 transition"
          >
            {viewMode === "overview" ? "Detailed view" : "Overview"}
          </button>
        </div>
      </Card>
    );
  }

  // ── Render Movement Forms ───────────────────────────────────────────────
  const [openMovement, setOpenMovement] = useState(false);
  const [editingMovement, setEditingMovement] = useState<Movement | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [adjusting, setAdjusting] = useState<{ productId: string; reason: string } | null>(null);

  function openNewMovement() {
    setOpenMovement(true);
  }

  function openEditMovement(movement: Movement) {
    setEditingMovement(movement);
    setOpenMovement(true);
  }

  function deleteMovement(id: string) {
    actMut.mutate({ kind: "delete", id });
  }

  function confirmMovement(id: string) {
    confirmMut.mutate(id);
  }

  // ── Render Movement Section ─────────────────────────────────────────────
  function renderMovementSection() {
    return (
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-display text-sm font-medium">Inventory Movements</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={openNewMovement}
              className="inline-flex items-center gap-1 rounded-md border border-primary px-3 py-1.5 text-[10px] font-medium text-primary-foreground hover:bg-primary/90 transition"
            >
              <Plus className="h-3.5 w-3.5" /> New movement
            </button>
            {editingMovement && (
              <button
                onClick={() => openEditMovement(editingMovement)}
                className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-[10px] text-muted-foreground hover:bg-muted/40 transition"
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </button>
            )}
          </div>
        </div>
        {openMovement && <MovementModal userId={user!.id} onClose={() => setOpenMovement(false)} />}
        {editingMovement && (
          <MovementModal userId={user!.id} movement={editingMovement} onClose={() => setOpenMovement(false)} />
        )}
      </Card>
    );
  }

  // ── Render Bulk Import Section ──────────────────────────────────────────
  function renderBulkImportSection() {
    return (
      <Card className="p-4">
        <h3 className="font-display text-sm font-medium mb-3">Bulk Import</h3>
        {bulkOpen && <BulkImportModal userId={user!.id} onClose={() => setBulkOpen(false)} />}
        <button
          onClick={() => setBulkOpen(true)}
          className="inline-flex items-center gap-1 rounded-md border border-primary px-3 py-1.5 text-[10px] font-medium text-primary-foreground hover:bg-primary/90 transition"
        >
          <FileSpreadsheet className="h-3.5 w-3.5" /> Bulk import
        </button>
      </Card>
    );
  }

  // ── Header Section ──────────────────────────────────────────────────────
  function renderHeader() {
    return (
      <PageHeader
        eyebrow="Inventory"
        title="Inventory"
        description="Monitor stock levels, manage product variants, and track inventory movements across your business."
        icon={<Package className="h-5 w-5" />}
        actions={
          canWrite ? (
            <div className="flex items-center gap-2">
              <button
                onClick={openNewMovement}
                className="inline-flex items-center gap-2 rounded-[10px] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:-translate-y-px hover:shadow-md"
              >
                <Plus className="h-4 w-4" /> New movement
              </button>
              <button
                onClick={() => setBulkOpen(true)}
                className="inline-flex items-center gap-2 rounded-[10px] border border-border px-4 py-2 text-sm font-medium transition hover:bg-muted/40"
              >
                <FileSpreadsheet className="h-4 w-4" /> Bulk import
              </button>
            </div>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
              Read-only
            </span>
          )}
      />
    );
  }

  // ── Render Main Content ─────────────────────────────────────────────────
  function renderMainContent() {
    return (
      <div className="mx-auto w-full max-w-[1440px] space-y-6 px-4 py-6 md:px-8 md:py-8">
        {renderKpiSection()}
        {renderFilterToolbar()}
        {renderMovementSection()}
        {renderBulkImportSection()}
        {viewMode === "overview" ? renderOverviewTable() : renderDetailedTable()}
      </div>
    );
  }

  return (
    <div>
      {renderHeader()}
      {renderMainContent()}
    </div>
  );
}// ── Stock Movement Modal ────────────────────────────────────────────────
function MovementModal({
  userId,
  movement,
  onClose,
}: {
  userId: string;
  movement?: Movement;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [productId, setProductId] = useState(movement?.product_id ?? "");
  const [direction, setDirection] = useState<"in" | "out">(movement?.direction ?? "in");
  const [quantity, setQuantity] = useState(String(movement?.quantity ?? 1));
  const [reason, setReason] = useState("");

  const save = useMutation({
    mutationFn: async () =>
      api.stockMovements.manual({
        productId,
        quantity: Number(quantity) || 0,
        direction,
        reason,
        notes: "Recorded by " + userId,
        status: "confirmed",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stock-movements"] });
      qc.invalidateQueries({ queryKey: ["stock-summary"] });
      toast.success(movement ? "Stock movement updated" : "Stock movement recorded");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to save movement"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-border bg-card p-5 shadow-xl">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <h3 className="text-sm font-semibold">
            {movement ? "Edit stock movement" : "New stock movement"}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="space-y-3 text-xs">
          <label className="block space-y-1">
            <span className="text-muted-foreground">Product / SKU</span>
            <input
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className={inputBase}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-muted-foreground">Direction</span>
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value as "in" | "out")}
                className={selectBase}
              >
                <option value="in">Stock in</option>
                <option value="out">Stock out</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-muted-foreground">Quantity</span>
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className={inputBase}
              />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-muted-foreground">Reason</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={textareaBase}
              rows={2}
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-xs">
            Cancel
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending || !productId}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {save.isPending ? "Saving…" : "Save movement"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Bulk Import Modal ───────────────────────────────────────────────────
function BulkImportModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [csv, setCsv] = useState("");

  const run = useMutation({
    mutationFn: async () => {
      const rows = csv
        .split(/\r?\n/)
        .map((line) => line.split(/[,\t]/).map((part) => part.trim()))
        .filter((parts) => parts.length >= 2 && parts[0]);
      for (const row of rows) {
        await api.stockMovements.manual({
          productId: row[0],
          quantity: Number(row[1]) || 0,
          direction: "in",
          reason: "Bulk import",
          notes: "Bulk imported by " + userId,
          status: "confirmed",
        });
      }
      return rows.length;
    },
    onSuccess: (count: number) => {
      qc.invalidateQueries({ queryKey: ["stock-movements"] });
      qc.invalidateQueries({ queryKey: ["stock-summary"] });
      toast.success(count + " stock movements imported");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Bulk import failed"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg space-y-4 rounded-xl border border-border bg-card p-5 shadow-xl">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <h3 className="text-sm font-semibold">Bulk import stock</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            ✕
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Paste one row per line as <span className="font-mono">SKU,QUANTITY</span>. Each row is posted as a
          confirmed stock-in movement.
        </p>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={8}
          placeholder={"AD-TS-BLK-M,10\nAD-TS-WHT-M,5"}
          className={textareaBase}
        />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-xs">
            Cancel
          </button>
          <button
            onClick={() => run.mutate()}
            disabled={run.isPending || !csv.trim()}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {run.isPending ? "Importing…" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
