import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney } from "@/components/ledger-ui";

import { SearchableSelect } from "@/components/ui/searchable-select";
import { MasterSkuModal } from "@/components/sku-master-modal";
import { ColourVariantModal } from "@/components/sku-colour-modal";
import { SellableSkuModal } from "@/components/sku-sellable-modal";
import { numOrNull, ImageField, ColourSwatch } from "@/components/sku-shared";
import {
  CatalogueToolbar,
  ProductsTable,
  Pager,
  stockStateOf,
  type MasterRow,
} from "@/components/catalogue-tables";
import { exportExcelReport } from "@/lib/reports-export";
import type { ReportColumn } from "@/lib/reports-registry";
import { Plus, X, Loader2, Package, RefreshCw, Layers, Copy, Download, TrendingUp } from "lucide-react";
import { toast } from "sonner";

const API_URL = import.meta.env.VITE_API_URL || "/api";

export const Route = createFileRoute("/app/products")({
  component: ProductsPage,
});

export type Product = {
  id: string;
  /** Id of the parent product when this SKU is a colour/size variant. */
  parent_id: string | null;
  sku: string;
  name: string;
  description: string | null;
  category: string | null;
  subcategory: string | null;
  gender: string | null;
  brand: string | null;
  size: string | null;
  color: string | null;
  model: string | null;
  unit_of_measure: string;
  season: string;
  barcode: string | null;
  barcode_type: string | null;
  units_per_carton: number | null;
  unit_price: number;
  unit_cost: number;
  mrp: number | null;
  ecommerce_price: number | null;
  retailer_price: number | null;
  distributor_price: number | null;
  flexible_price: number | null;
  minimum_gross_margin_percentage: number | null;
  reorder_level: number;
  max_stock: number;
  lead_time_days: number;
  safety_stock_days: number;
  supplier_id: string | null;
  supplier_product_code: string | null;
  minimum_order_quantity: number | null;
  order_multiple: number | null;
  hsn_code: string | null;
  gst_rate: number | null;
  image_url: string | null;
  status: string;
};
type SkuMaster = {
  id: string;
  name: string;
  code: string;
  active: boolean;
  size_system?: string | null;
};

// Standard colour palette — fixed codes flow into SKUs as MASTER-COLOUR.
// Users pick from this searchable list; no manual code entry.
export const STANDARD_COLOURS: Array<{ name: string; code: string }> = [
  { name: "Black", code: "BLK" },
  { name: "White", code: "WHT" },
  { name: "Grey", code: "GRY" },
  { name: "Charcoal", code: "CHR" },
  { name: "Silver", code: "SLV" },
  { name: "Blue", code: "BLU" },
  { name: "Navy Blue", code: "NVY" },
  { name: "Royal Blue", code: "RYL" },
  { name: "Sky Blue", code: "SKY" },
  { name: "Ice Blue", code: "IBL" },
  { name: "Teal", code: "TEL" },
  { name: "Turquoise", code: "TRQ" },
  { name: "Green", code: "GRN" },
  { name: "Olive Green", code: "OLV" },
  { name: "Forest Green", code: "FGR" },
  { name: "Khaki", code: "KHK" },
  { name: "Red", code: "RED" },
  { name: "Maroon", code: "MAR" },
  { name: "Burgundy", code: "BRG" },
  { name: "Orange", code: "ORG" },
  { name: "Yellow", code: "YLW" },
  { name: "Purple", code: "PUR" },
  { name: "Pink", code: "PNK" },
  { name: "Brown", code: "BRN" },
  { name: "Coyote Brown", code: "CYB" },
  { name: "Tan", code: "TAN" },
  { name: "Beige", code: "BEI" },
  { name: "Sand", code: "SND" },
  { name: "Stone", code: "STN" },
  { name: "Desert Sand", code: "DST" },
  { name: "Gold", code: "GLD" },
  { name: "Copper", code: "CPR" },
  { name: "Camouflage", code: "CAM" },
  { name: "Multi Colour", code: "MLT" },
  { name: "Assorted", code: "AST" },
  { name: "Transparent", code: "CLR" },
];

// Standard gender palette — fixed codes flow into Master SKUs as AD-GENDER-….
// Users pick from this searchable list; no manual code entry.
export const STANDARD_GENDERS: Array<{ name: string; code: string }> = [
  { name: "Men", code: "MEN" },
  { name: "Women", code: "WOM" },
  { name: "Unisex", code: "UNI" },
  { name: "Kids", code: "KID" },
  { name: "Boys", code: "BOY" },
  { name: "Girls", code: "GRL" },
];

const GENDERS = ["Men", "Women", "Unisex", "Kids", "Boys", "Girls"];
const SEASONS = ["all", "spring", "summer", "fall", "winter"];
const CATEGORIES = ["Footwear", "Apparel", "Accessories", "Equipment", "Nutrition"];
const UNITS_OF_MEASURE = [
  "piece",
  "pair",
  "carton",
  "box",
  "dozen",
  "set",
  "kg",
  "g",
  "litre",
  "ml",
  "metre",
  "bottle",
  "pack",
];
const BARCODE_TYPES = ["", "EAN-13", "UPC-A", "EAN-8", "Code 128", "QR", "ITF-14"];
const GST_RATES = ["", "0", "5", "12", "18", "28"];

function ProductsPage() {
  const { user, isSalesRep } = useAuth();
  const canWrite = !isSalesRep && !!user;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [skuWizard, setSkuWizard] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [variantFor, setVariantFor] = useState<{ parent: Product; child?: Product } | null>(null);
  // Price-only edit — the only edit allowed on SKUs (master + variants).
  const [priceFor, setPriceFor] = useState<Product | null>(null);
  const [detailFor, setDetailFor] = useState<Product | null>(null);
  // Staged child-SKU creation from the Master SKU drawer: "color" adds a
  // colour-coded SKU under a master, "size" a size-coded SKU under a colour.
  const [stageFor, setStageFor] = useState<{ parent: Product; level: "color" | "size" } | null>(
    null,
  );
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [deleting, setDeleting] = useState<Product | null>(null);
  // Catalogue filters (all client-side over the loaded catalogue).
  const [genderF, setGenderF] = useState("all");
  const [colorF, setColorF] = useState("all");
  const [sizeF, setSizeF] = useState("all");
  const [statusF, setStatusF] = useState("all");
  const [sort, setSort] = useState("sku");
  const [page, setPage] = useState(1);

  const productsQ = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const data = (await api.products.list()) as Product[];
      return data.sort((a, b) => a.sku?.localeCompare(b.sku ?? "") ?? 0);
    },
  });
  const categoriesQ = useQuery({
    queryKey: ["sku-masters", "category"],
    queryFn: () => api.skuMasters.list("category"),
  });
  const gendersQ = useQuery({
    queryKey: ["sku-masters", "gender"],
    queryFn: () => api.skuMasters.list("gender"),
  });
  const colorsQ = useQuery({
    queryKey: ["sku-masters", "color"],
    queryFn: () => api.skuMasters.list("color"),
  });
  const sizesQ = useQuery({
    queryKey: ["sku-masters", "size"],
    queryFn: () => api.skuMasters.list("size"),
  });

  // Preferred-supplier picker for the catalogue form's Buying details section.
  const suppliersQ = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => api.suppliers.list(),
  });

  // Catalogue-wide default minimum margin — used by products without their own.
  const catalogueSettingsQ = useQuery({
    queryKey: ["catalogue-settings"],
    queryFn: async () => api.catalogueSettings.get(),
  });
  const defaultMargin = catalogueSettingsQ.data?.default_minimum_margin ?? 0.4;

  const [marginInput, setMarginInput] = useState("");
  const marginDirtyRef = useRef(false);
  useEffect(() => {
    // Don't clobber what the user is typing while settings are still loading.
    if (marginDirtyRef.current) return;
    setMarginInput(String(Math.round(defaultMargin * 100)));
  }, [defaultMargin]);

  const saveMargin = useMutation({
    mutationFn: async () => {
      await api.catalogueSettings.update({
        default_minimum_margin: (Number(marginInput) || 40) / 100,
      });
    },
    onSuccess: () => {
      // Margin affects every product's floor price — refresh the catalogue and
      // the forecast page (which recomputes pricing strategy per SKU).
      qc.invalidateQueries({ queryKey: ["catalogue-settings"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["products-forecast"] });
      toast.success("Default margin saved");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to save default margin"),
  });

  // Stock lookup per product (display only — stock itself lives in Inventory,
  // never in the catalogue definition).
  const movementsQ = useQuery({
    queryKey: ["stock_movements_all"],
    queryFn: async () => {
      const data = await api.stockMovements.list();
      // Live stock counts CONFIRMED movements only (drafts/cancelled don't move stock)
      return data
        .filter((m: any) => (m.status ?? "confirmed") === "confirmed")
        .map(
          (m: {
            productId?: string;
            product_id?: string;
            direction?: string;
            quantity?: number;
          }) => ({
            product_id: m.productId ?? m.product_id ?? null,
            direction: m.direction ?? "",
            quantity: m.quantity ?? 0,
          }),
        );
    },
  });

  const stockByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of movementsQ.data ?? []) {
      if (!r.product_id) continue;
      const sign = r.direction === "in" ? 1 : -1;
      m.set(r.product_id, (m.get(r.product_id) ?? 0) + sign * Number(r.quantity));
    }
    return m;
  }, [movementsQ.data]);

  // ── Parent / colour-size variant grouping ─────────────────────────────────
  // Products with a parent_id are variants of the parent SKU. The catalogue
  // renders each parent as a row followed by its variant rows beneath it.
  const childrenByParent = useMemo(() => {
    const m = new Map<string, Product[]>();
    for (const p of productsQ.data ?? []) {
      if (p.parent_id) {
        const list = m.get(p.parent_id) ?? [];
        list.push(p);
        m.set(p.parent_id, list);
      }
    }
    return m;
  }, [productsQ.data]);

  const byId = useMemo(
    () => new Map((productsQ.data ?? []).map((p) => [p.id, p] as const)),
    [productsQ.data],
  );

  // Live stock for a row — variants carry their own stock (stock hangs off the
  // concrete SKU), while a parent row aggregates its own plus all variants.
  const stockFor = useCallback(
    (p: Product) => {
      let s = stockByProduct.get(p.id) ?? 0;
      if (!p.parent_id) {
        const addDescendants = (parentId: string) => {
          for (const k of childrenByParent.get(parentId) ?? []) {
            s += stockByProduct.get(k.id) ?? 0;
            addDescendants(k.id);
          }
        };
        addDescendants(p.id);
      }
      return s;
    },
    [stockByProduct, childrenByParent],
  );

  // Text match across SKU, name and existing attributes (brand/model/colour/
  // size/barcode preserved from the previous catalogue search).
  const matchesQuery = (p: Product) => {
    if (!q) return true;
    const needle = q.toLowerCase();
    return [
      p.sku,
      p.name,
      p.brand ?? "",
      p.model ?? "",
      p.color ?? "",
      p.size ?? "",
      p.barcode ?? "",
    ].some((v) => v.toLowerCase().includes(needle));
  };

  const genderMatches = (g: string | null, code: string) => {
    const found = STANDARD_GENDERS.find((x) => x.code === code);
    if (!found) return false;
    const v = (g ?? "").toLowerCase();
    return v === found.name.toLowerCase() || v === found.code.toLowerCase();
  };

  const colourNameFor = (code: string) =>
    STANDARD_COLOURS.find((c) => c.code === code)?.name.toLowerCase() ?? code.toLowerCase();

  // All descendant colours / sizes under a master (lowercase names).
  const descendantValues = (masterId: string, key: "color" | "size"): Set<string> => {
    const out = new Set<string>();
    const walk = (pid: string) => {
      for (const k of childrenByParent.get(pid) ?? []) {
        const v = k[key];
        if (v) out.add(v.toLowerCase());
        walk(k.id);
      }
    };
    walk(masterId);
    return out;
  };

  // Leaf SKUs under a node — the operational sellable SKUs. A childless
  // master is itself the sellable SKU (same rule the variant picker uses).
  const leavesUnder = (id: string): Product[] => {
    const kids = childrenByParent.get(id) ?? [];
    if (kids.length === 0) {
      const self = byId.get(id);
      return self ? [self] : [];
    }
    return kids.flatMap((k) => leavesUnder(k.id));
  };

  // ── Products tab rows: one per Master SKU ──────────────────────────────
  const masterRows: MasterRow[] = useMemo(() => {
    const matchesDeep = (m: Product): boolean => {
      if (matchesQuery(m)) return true;
      const walk = (pid: string): boolean =>
        (childrenByParent.get(pid) ?? []).some((k) => matchesQuery(k) || walk(k.id));
      return walk(m.id);
    };
    const list = (productsQ.data ?? [])
      .filter((p) => !p.parent_id)
      .filter((m) => {
        if (cat !== "all" && m.category !== cat) return false;
        if (genderF !== "all" && !genderMatches(m.gender, genderF)) return false;
        if (statusF === "active" && m.status !== "active") return false;
        if (statusF === "inactive" && m.status === "active") return false;
        if (colorF !== "all") {
          const want = new Set([colorF.toLowerCase(), colourNameFor(colorF)]);
          const have = descendantValues(m.id, "color");
          if (![...want].some((n) => have.has(n))) return false;
        }
        if (sizeF !== "all") {
          const have = descendantValues(m.id, "size");
          if (!have.has(sizeF.toLowerCase())) return false;
        }
        return matchesDeep(m);
      })
      .map((m) => {
        const colours = ((childrenByParent.get(m.id) ?? []) as Product[])
          .slice()
          .sort((a, b) => a.sku.localeCompare(b.sku))
          .map((c) => ({
            colour: c,
            sizes: ((childrenByParent.get(c.id) ?? []) as Product[])
              .slice()
              .sort((a, b) => a.sku.localeCompare(b.sku)),
          }));
        const sellables = leavesUnder(m.id)
          .slice()
          .sort((a, b) => a.sku.localeCompare(b.sku));
        let inStock = 0,
          lowStock = 0,
          outStock = 0;
        for (const s of sellables) {
          const st = stockStateOf(stockByProduct.get(s.id) ?? 0, s.reorder_level);
          if (st === "ok") inStock++;
          else if (st === "low") lowStock++;
          else outStock++;
        }
        const familyStock = stockFor(m);
        return {
          master: m,
          colours,
          sellables,
          inStock,
          lowStock,
          outStock,
          familyStock,
          familyState: stockStateOf(familyStock, m.reorder_level),
        };
      });
    const rank: Record<string, number> = { out: 0, low: 1, ok: 2 };
    if (sort === "name") list.sort((a, b) => a.master.name.localeCompare(b.master.name));
    else if (sort === "stock")
      list.sort(
        (a, b) =>
          rank[a.familyState] - rank[b.familyState] ||
          a.familyStock - b.familyStock ||
          a.master.sku.localeCompare(b.master.sku),
      );
    else list.sort((a, b) => a.master.sku.localeCompare(b.master.sku));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    productsQ.data,
    childrenByParent,
    stockByProduct,
    q,
    cat,
    genderF,
    colorF,
    sizeF,
    statusF,
    sort,
  ]);

  const filtersActive =
    q.trim() !== "" ||
    cat !== "all" ||
    genderF !== "all" ||
    colorF !== "all" ||
    sizeF !== "all" ||
    statusF !== "all";

  const clearFilters = () => {
    setQ("");
    setCat("all");
    setGenderF("all");
    setColorF("all");
    setSizeF("all");
    setStatusF("all");
    setSort("sku");
  };

  // Client-side pagination over the loaded catalogue (the backend has no
  // paged products endpoint — the fetch itself is unchanged).
  const PAGE_SIZE = 25;
  useEffect(() => {
    setPage(1);
  }, [q, cat, genderF, colorF, sizeF, statusF, sort]);
  const paginate = <T,>(list: T[]) => {
    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    const safe = Math.min(page, totalPages);
    return {
      pageItems: list.slice((safe - 1) * PAGE_SIZE, safe * PAGE_SIZE),
      pager: (
        <Pager
          page={safe}
          totalPages={totalPages}
          from={list.length === 0 ? 0 : (safe - 1) * PAGE_SIZE + 1}
          to={Math.min(safe * PAGE_SIZE, list.length)}
          total={list.length}
          onPage={setPage}
        />
      ),
    };
  };
  const masterPage = paginate(masterRows);

  // Excel export of the currently filtered view (existing reports infra).
  const doExport = () => {
    const notes: string[] = [];
    if (q.trim()) notes.push(`Search: ${q.trim()}`);
    if (cat !== "all") notes.push(`Category: ${cat}`);
    if (genderF !== "all") notes.push(`Gender: ${genderF}`);
    if (colorF !== "all") notes.push(`Colour: ${colorF}`);
    if (sizeF !== "all") notes.push(`Size: ${sizeF}`);
    if (statusF !== "all") notes.push(`Status: ${statusF}`);
    const columns: ReportColumn[] = [
      { key: "product", label: "Product", kind: "text" },
      { key: "model", label: "Model", kind: "text" },
      { key: "masterSku", label: "Master SKU", kind: "mono" },
      { key: "category", label: "Category", kind: "text" },
      { key: "gender", label: "Gender", kind: "text" },
      { key: "sellables", label: "Sellable variants", kind: "int" },
      { key: "inStock", label: "In stock", kind: "int" },
      { key: "lowStock", label: "Low stock", kind: "int" },
      { key: "outStock", label: "Out of stock", kind: "int" },
      { key: "onHand", label: "On hand (family)", kind: "int" },
      { key: "status", label: "Status", kind: "text" },
    ];
    exportExcelReport(
      "Products catalogue",
      { title: "Products catalogue", notes },
      columns,
      masterRows.map((r) => ({
        product: r.master.name,
        model: r.master.model ?? "",
        masterSku: r.master.sku,
        category: r.master.category ?? "",
        gender: r.master.gender ?? "",
        sellables: r.sellables.length,
        inStock: r.inStock,
        lowStock: r.lowStock,
        outStock: r.outStock,
        onHand: r.familyStock,
        status: r.master.status === "active" ? "Active" : "Inactive",
      })),
    );
    toast.success("Export downloaded");
  };

  const del = useMutation({
    mutationFn: async (p: Product) => {
      await api.products.delete(p.id);
    },
    onSuccess: () => {
      // The product's stock movements, forecasts and catalogue record are gone
      // too — refresh every surface that shows them.
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["products-forecast"] });
      qc.invalidateQueries({ queryKey: ["products-inventory"] });
      qc.invalidateQueries({ queryKey: ["stock_movements"] });
      qc.invalidateQueries({ queryKey: ["stock_movements_all"] });
      qc.invalidateQueries({ queryKey: ["movements-forecast"] });
      qc.invalidateQueries({ queryKey: ["forecast-variables"] });
      toast.success("Product and its inventory entries deleted");
      setDeleting(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div>
      <PageHeader
        eyebrow="Catalogue"
        title="Products & SKUs"
        description="Manage products, variants and sellable SKUs."
        icon={<Package className="h-5 w-5" />}
        breadcrumbs={[{ label: "Dashboard", href: "/app/dashboard" }, { label: "Catalog" }]}
        actions={
          <div className="flex gap-2">
            <button
              onClick={() => navigate({ to: "/app/forecast" })}
              title="Open demand forecasting for the catalogue"
              className="inline-flex items-center gap-2 rounded-[10px] border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground shadow-sm transition-all hover:-translate-y-px hover:text-foreground hover:shadow-md"
            >
              <TrendingUp className="h-4 w-4" /> View Forecasting
            </button>
            <button
              onClick={doExport}
              title="Export the current view to Excel"
              className="inline-flex items-center gap-2 rounded-[10px] border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground shadow-sm transition-all hover:-translate-y-px hover:text-foreground hover:shadow-md"
            >
              <Download className="h-4 w-4" /> Export
            </button>
            {canWrite ? (
              <button
                onClick={() => {
                  setSkuWizard(true);
                }}
                className="inline-flex items-center gap-2 rounded-[10px] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:-translate-y-px hover:shadow-md"
              >
                <Plus className="h-4 w-4" /> Create Master SKU
              </button>
            ) : (
              <span className="text-xs uppercase tracking-widest text-muted-foreground">
                Read-only
              </span>
            )}
          </div>
        }
      />

      <div className="mx-auto w-full max-w-[1440px] space-y-6 px-4 py-6 md:px-8 md:py-8">
        <Card>
          <div className="space-y-4">
            <CatalogueToolbar
              f={{
                q,
                cat,
                gender: genderF,
                colour: colorF,
                size: sizeF,
                status: statusF,
                sort,
              }}
              set={(patch) => {
                if (patch.q !== undefined) setQ(patch.q);
                if (patch.cat !== undefined) setCat(patch.cat);
                if (patch.gender !== undefined) setGenderF(patch.gender);
                if (patch.colour !== undefined) setColorF(patch.colour);
                if (patch.size !== undefined) setSizeF(patch.size);
                if (patch.status !== undefined) setStatusF(patch.status);
                if (patch.sort !== undefined) setSort(patch.sort);
              }}
              categories={CATEGORIES}
              genders={STANDARD_GENDERS}
              colours={STANDARD_COLOURS}
              sizes={(sizesQ.data ?? [])
                .filter((x: SkuMaster) => x.active)
                .map((x: SkuMaster) => ({ id: x.id, name: x.name }))}
              resultCount={masterRows.length}
              onClear={clearFilters}
              filtersActive={filtersActive}
              canWrite={canWrite}
              marginInput={marginInput}
              onMarginInput={(v) => {
                marginDirtyRef.current = true;
                setMarginInput(v);
              }}
              onSaveMargin={() => saveMargin.mutate()}
              marginPending={saveMargin.isPending}
              defaultMargin={defaultMargin}
            />
            <ProductsTable
              rows={masterRows}
              pageItems={masterPage.pageItems}
              loading={productsQ.isLoading || movementsQ.isLoading}
              canWrite={canWrite}
              emptyFiltered={filtersActive}
              stockOf={(id) => stockByProduct.get(id) ?? 0}
              onClearFilters={clearFilters}
              onCreate={() => setSkuWizard(true)}
              onView={(m) => setDetailFor(m)}
              onAddColour={(m) => setStageFor({ parent: m, level: "color" })}
              onAddSize={(c) => setStageFor({ parent: c, level: "size" })}
              onEditPrices={(p) => setPriceFor(p)}
              onDelete={(p) => setDeleting(p)}
              pager={masterPage.pager}
            />
          </div>
        </Card>
      </div>

      {priceFor && (
        <PriceEditModal
          product={(productsQ.data ?? []).find((p) => p.id === priceFor.id) ?? priceFor}
          onClose={() => setPriceFor(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["products"] });
            qc.invalidateQueries({ queryKey: ["products-forecast"] });
            qc.invalidateQueries({ queryKey: ["products-inventory"] });
            setPriceFor(null);
          }}
        />
      )}
      {skuWizard && user && (
        <MasterSkuModal
          categories={(categoriesQ.data ?? []).filter((x: SkuMaster) => x.active)}
          genders={(gendersQ.data ?? []).filter((x: SkuMaster) => x.active)}
          userId={user.id}
          onClose={() => setSkuWizard(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["products"] });
          }}
          onAddColour={(m) => setStageFor({ parent: m as unknown as Product, level: "color" })}
        />
      )}
      {detailFor && (
        <ProductDetailDrawer
          product={(productsQ.data ?? []).find((p) => p.id === detailFor.id) ?? detailFor}
          all={(productsQ.data ?? []) as Product[]}
          childrenByParent={childrenByParent}
          canWrite={canWrite}
          onAddChild={(parent, level) => setStageFor({ parent, level })}
          onClose={() => setDetailFor(null)}
        />
      )}
      {stageFor && user && stageFor.level === "color" && (
        <ColourVariantModal
          parent={stageFor.parent}
          colors={(colorsQ.data ?? []).filter((x: SkuMaster) => x.active)}
          takenNames={(childrenByParent.get(stageFor.parent.id) ?? []).map((p) => p.color ?? "")}
          userId={user.id}
          onClose={() => setStageFor(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["products"] });
            qc.invalidateQueries({ queryKey: ["products-forecast"] });
            qc.invalidateQueries({ queryKey: ["products-inventory"] });
          }}
          onAddSize={(c) => setStageFor({ parent: c as unknown as Product, level: "size" })}
        />
      )}
      {stageFor && user && stageFor.level === "size" && (
        <SellableSkuModal
          parent={stageFor.parent}
          masterSku={(productsQ.data ?? []).find((p) => p.id === stageFor.parent.parent_id)?.sku}
          sizes={(sizesQ.data ?? []).filter((x: SkuMaster) => x.active)}
          takenNames={(childrenByParent.get(stageFor.parent.id) ?? []).map((p) => p.size ?? "")}
          onClose={() => setStageFor(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["products"] });
            qc.invalidateQueries({ queryKey: ["products-forecast"] });
            qc.invalidateQueries({ queryKey: ["products-inventory"] });
          }}
          onViewSku={() => {
            const master = (productsQ.data ?? []).find((p) => p.id === stageFor.parent.parent_id);
            if (master) setDetailFor(master);
          }}
        />
      )}
      {deleting && (
        <ConfirmProductDelete
          product={deleting}
          variantCount={(childrenByParent.get(deleting.id) ?? []).length}
          movementCount={
            (movementsQ.data ?? []).filter(
              (m: any) =>
                m.product_id === deleting.id ||
                (childrenByParent.get(deleting.id) ?? []).some((k) => k.id === m.product_id),
            ).length
          }
          onClose={() => setDeleting(null)}
          onConfirm={() => del.mutate(deleting)}
          pending={del.isPending}
        />
      )}
    </div>
  );
}

function ProductDetailDrawer({
  product,
  all,
  childrenByParent,
  canWrite,
  onAddChild,
  onClose,
}: {
  product: Product;
  all: Product[];
  childrenByParent: Map<string, Product[]>;
  canWrite: boolean;
  onAddChild: (parent: Product, level: "color" | "size") => void;
  onClose: () => void;
}) {
  const byId = new Map(all.map((p) => [p.id, p]));
  // Hierarchy is Master SKU → Colour Variant → Sellable SKU (two levels).
  const colourNodes = (childrenByParent.get(product.id) ?? [])
    .slice()
    .sort((a, b) => a.sku.localeCompare(b.sku));
  void byId;
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-screen w-full max-w-xl flex-col overflow-hidden border-l border-border bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-border p-5">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-primary">Master SKU detail</p>
            <h3 className="mt-1 font-display text-lg">{product.name}</h3>
            <p className="mt-1 font-mono text-sm font-semibold text-primary">{product.sku}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {[product.category, product.gender, product.model].filter(Boolean).join(" · ")}
            </p>
          </div>
          <button onClick={onClose} className="rounded-md p-2 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <section className="rounded-xl border border-border bg-muted/30 p-4">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Product Information
            </h4>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
              <span className="text-muted-foreground">Product Name</span>
              <span className="text-right font-medium text-foreground">{product.name}</span>
              <span className="text-muted-foreground">Model Number</span>
              <span className="text-right font-mono text-foreground">{product.model ?? "—"}</span>
              <span className="text-muted-foreground">Category</span>
              <span className="text-right text-foreground">{product.category ?? "—"}</span>
              <span className="text-muted-foreground">Gender</span>
              <span className="text-right text-foreground">{product.gender ?? "—"}</span>
              <span className="text-muted-foreground">HSN Code</span>
              <span className="text-right font-mono text-foreground">
                {product.hsn_code ?? "—"}
              </span>
              <span className="text-muted-foreground">Status</span>
              <span className="text-right font-medium text-foreground">
                {product.status === "active" ? "Active" : "Inactive"}
              </span>
            </div>
          </section>
          <section className="rounded-xl border border-border/70 p-4 text-xs">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Pricing
            </p>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono">
              <span className="text-muted-foreground">Reference Cost</span>
              <span className="text-right">{fmtMoney(product.unit_cost)}</span>
              <span className="text-muted-foreground">Selling Price</span>
              <span className="text-right">{fmtMoney(product.unit_price)}</span>
              <span className="text-muted-foreground">MRP</span>
              <span className="text-right">{product.mrp ? fmtMoney(product.mrp) : "—"}</span>
              <span className="text-muted-foreground">GST</span>
              <span className="text-right">
                {product.gst_rate !== null && product.gst_rate !== undefined
                  ? `${product.gst_rate}%`
                  : "—"}
              </span>
            </div>
            <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Channel Price Overrides
            </p>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono">
              <span className="text-muted-foreground">Retailer</span>
              <span className="text-right">
                {product.retailer_price ? fmtMoney(product.retailer_price) : "—"}
              </span>
              <span className="text-muted-foreground">Distributor</span>
              <span className="text-right">
                {product.distributor_price ? fmtMoney(product.distributor_price) : "—"}
              </span>
              <span className="text-muted-foreground">E-commerce</span>
              <span className="text-right">
                {product.ecommerce_price ? fmtMoney(product.ecommerce_price) : "—"}
              </span>
            </div>
          </section>
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Variant Hierarchy — Master SKU → Colour Variant → Sellable SKU
              </p>
              {canWrite && (
                <button
                  onClick={() => onAddChild(product, "color")}
                  title="Add a colour-coded SKU under this Master SKU"
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:border-primary hover:text-primary"
                >
                  <Plus className="h-3 w-3" /> Add colour
                </button>
              )}
            </div>
            <div className="mt-2 rounded-lg border border-primary/25 bg-primary/5 p-3">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Master SKU
              </p>
              <p className="mt-0.5 flex items-center justify-between font-mono text-sm font-semibold text-primary">
                {product.sku}
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(product.sku);
                    toast.success("Master SKU copied");
                  }}
                  className="rounded p-1 hover:bg-primary/10"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </p>
            </div>
            <div className="mt-3 space-y-3">
              {colourNodes.length === 0 && (
                <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  No colour SKUs yet — use “＋ Add colour” above.
                </p>
              )}
              {colourNodes.map((c) => {
                const sizes = (childrenByParent.get(c.id) ?? [])
                  .slice()
                  .sort((a, b) => a.sku.localeCompare(b.sku));
                return (
                  <div key={c.id} className="rounded-lg border border-border/70">
                    <div className="flex items-center justify-between border-b border-border/60 bg-muted/20 px-3 py-2">
                      <div>
                        <span className="inline-flex items-center gap-1.5 font-medium">
                          <ColourSwatch colour={c.color ?? c.name} />
                          {c.color ?? c.name}
                        </span>
                        <p className="font-mono text-xs text-primary">{c.sku}</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          Sell {c.unit_price ? fmtMoney(c.unit_price) : "—"}
                          {c.mrp ? ` · MRP ${fmtMoney(c.mrp)}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        {canWrite && (
                          <button
                            onClick={() => onAddChild(c, "size")}
                            title={`Add a size-coded SKU under ${c.sku}`}
                            className="rounded p-1.5 text-muted-foreground hover:text-primary"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(c.sku);
                            toast.success("Colour SKU copied");
                          }}
                          className="rounded p-1.5 text-muted-foreground hover:text-primary"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="p-2">
                      {sizes.length === 0 ? (
                        <p className="px-2 py-1 text-xs text-muted-foreground">
                          Colour SKU only — no sizes yet. Use ＋ above to add one.
                        </p>
                      ) : (
                        sizes.map((s) => (
                          <div
                            key={s.id}
                            className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm"
                          >
                            <span className="text-muted-foreground">
                              → {s.size ?? s.sku.split("-").slice(-1)}
                            </span>
                            <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                              {s.unit_price ? fmtMoney(s.unit_price) : "—"}
                            </span>
                            <span className="flex items-center gap-2 font-mono text-xs">
                              {s.sku}
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(s.sku);
                                  toast.success("Final SKU copied");
                                }}
                                className="rounded p-1 text-muted-foreground hover:text-primary"
                              >
                                <Copy className="h-3 w-3" />
                              </button>
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfirmProductDelete({
  product,
  variantCount = 0,
  movementCount,
  onClose,
  onConfirm,
  pending,
}: {
  product: Product;
  variantCount?: number;
  movementCount: number;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-xl border border-border bg-card p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-lg">Delete {product.name}?</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          This permanently removes{" "}
          <span className="font-medium text-foreground">{product.sku}</span>
          {variantCount > 0 ? (
            <>
              {" "}
              plus its{" "}
              <span className="font-medium text-foreground">
                {variantCount} colour/size variant{variantCount === 1 ? "" : "s"}
              </span>
            </>
          ) : null}{" "}
          from the catalogue, along with its{" "}
          <span className="font-medium text-foreground">
            {movementCount} stock movement{movementCount === 1 ? "" : "s"}
          </span>{" "}
          and forecast entries. Invoices, orders and receipts keep their records.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-border px-4 py-2 text-sm transition hover:bg-muted/40"
          >
            Keep
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-white transition hover:bg-destructive/90 disabled:opacity-60"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Delete product
          </button>
        </div>
      </div>
    </div>
  );
}

// Price-only edit — the sole edit allowed on SKUs (master + colour + size).
// Name, SKU, colour, size, category, gender, image etc. are read-only here;
// only commercial prices can be changed.
function PriceEditModal({
  product,
  onClose,
  onSaved,
}: {
  product: Product;
  onClose: () => void;
  onSaved: () => void;
}) {
  const str = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
  const [prices, setPrices] = useState({
    unit_cost: str(product.unit_cost),
    unit_price: str(product.unit_price),
    mrp: str(product.mrp),
    ecommerce_price: str(product.ecommerce_price),
    retailer_price: str(product.retailer_price),
    distributor_price: str(product.distributor_price),
    gst_rate: str(product.gst_rate),
  });
  useEffect(() => {
    setPrices({
      unit_cost: str(product.unit_cost),
      unit_price: str(product.unit_price),
      mrp: str(product.mrp),
      ecommerce_price: str(product.ecommerce_price),
      retailer_price: str(product.retailer_price),
      distributor_price: str(product.distributor_price),
      gst_rate: str(product.gst_rate),
    });
  }, [product.id]);
  const setP = (k: keyof typeof prices) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setPrices({ ...prices, [k]: e.target.value });
  const priceError = (() => {
    for (const [label, v] of [
      ["Cost", prices.unit_cost],
      ["Selling price", prices.unit_price],
      ["MRP", prices.mrp],
      ["Retailer price", prices.retailer_price],
      ["Distributor price", prices.distributor_price],
      ["E-commerce price", prices.ecommerce_price],
    ] as Array<[string, string]>) {
      if (v !== "" && !(Number(v) >= 0)) return `${label} cannot be negative`;
    }
    if (prices.gst_rate !== "" && !(Number(prices.gst_rate) >= 0))
      return "GST rate cannot be negative";
    if (
      prices.mrp !== "" &&
      prices.unit_price !== "" &&
      Number(prices.mrp) < Number(prices.unit_price)
    )
      return "MRP should not be lower than Selling price";
    return null;
  })();
  const save = useMutation({
    mutationFn: async () => {
      await api.products.update(product.id, {
        unit_cost: numOrNull(prices.unit_cost) ?? 0,
        unit_price: numOrNull(prices.unit_price) ?? 0,
        mrp: numOrNull(prices.mrp),
        ecommerce_price: numOrNull(prices.ecommerce_price),
        retailer_price: numOrNull(prices.retailer_price),
        distributor_price: numOrNull(prices.distributor_price),
        gst_rate: numOrNull(prices.gst_rate),
      });
    },
    onSuccess: () => {
      toast.success(`Prices updated for ${product.sku}`);
      onSaved();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to update prices"),
  });
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div>
            <h3 className="font-display text-lg">Edit prices — {product.sku}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {product.name} · only prices can be changed here
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="mt-4 space-y-4"
        >
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
            <p className="font-mono font-semibold text-foreground">{product.sku}</p>
            <p className="mt-0.5">
              {[product.category, product.gender, product.color, product.size]
                .filter(Boolean)
                .join(" · ") || "—"}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <L label="Cost">
              <input
                type="number"
                min="0"
                step="0.01"
                className="inp"
                value={prices.unit_cost}
                onChange={setP("unit_cost")}
              />
            </L>
            <L label="Selling price">
              <input
                type="number"
                min="0"
                step="0.01"
                className="inp"
                value={prices.unit_price}
                onChange={setP("unit_price")}
              />
            </L>
            <L label="MRP">
              <input
                type="number"
                min="0"
                step="0.01"
                className="inp"
                value={prices.mrp}
                onChange={setP("mrp")}
              />
            </L>
            <L label="Retailer price">
              <input
                type="number"
                min="0"
                step="0.01"
                className="inp"
                value={prices.retailer_price}
                onChange={setP("retailer_price")}
              />
            </L>
            <L label="Distributor price">
              <input
                type="number"
                min="0"
                step="0.01"
                className="inp"
                value={prices.distributor_price}
                onChange={setP("distributor_price")}
              />
            </L>
            <L label="E-commerce price">
              <input
                type="number"
                min="0"
                step="0.01"
                className="inp"
                value={prices.ecommerce_price}
                onChange={setP("ecommerce_price")}
              />
            </L>
            <L label="GST %">
              <input
                type="number"
                min="0"
                step="0.01"
                className="inp"
                value={prices.gst_rate}
                onChange={setP("gst_rate")}
              />
            </L>
          </div>
          {priceError && <p className="text-xs font-medium text-destructive">{priceError}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              disabled={save.isPending || !!priceError}
              className="inline-flex items-center gap-2 rounded-[10px] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:-translate-y-px hover:shadow-md disabled:opacity-60"
            >
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {save.isPending ? "Saving…" : "Save prices"}
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

// Variant-name builder — mirrors the backend rule so an edited variant keeps
// the same readable name ("Parent name — BLACK / 42").
function variantDisplayName(
  parentName: string,
  color?: string | null,
  size?: string | null,
): string {
  const attrs = [color, size]
    .map((a) => (a ?? "").toString().trim())
    .filter(Boolean)
    .map((a) => a.toUpperCase())
    .join(" / ");
  return attrs ? `${parentName} — ${attrs}` : parentName;
}

// ─── Staged child-SKU creation ─────────────────────────────────────────────
// Master → colour (level "color"): pick a colour master → colour-coded SKU
//   MASTER-COLOUR, e.g. AD-U-TN-ET1100-AQB.
// Colour → size (level "size"): pick a size master → size-coded SKU
//   COLOUR-SKU-SIZE, e.g. …-AQB-3P.
// Pricing is prefilled from the parent (snapshot model): save as-is to keep
// the parent's prices, or edit any field to set this SKU's own price. Later
// changes to the parent price never rewrite the child.
// Staged colour/size creation now lives in @/components/sku-colour-modal and
// @/components/sku-sellable-modal (rendered above). What follows is the
// variant edit form for an existing child SKU.

// Colour/size edit form for an existing child SKU (pencil on a variant row).
// Pricing is this SKU's own snapshot — editable here, never rewritten by the
// parent. Supplier and image stay inherited from the parent record.
function VariantModal({
  parent,
  child,
  onClose,
}: {
  parent: Product;
  child?: Product;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!child;
  // Price source: the record itself when editing, the parent when creating.
  const priced = child ?? parent;
  const str = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
  const [f, setF] = useState({
    color: child?.color ?? "",
    size: child?.size ?? "",
    sku: child?.sku ?? "",
    unit_cost: str(priced.unit_cost),
    unit_price: str(priced.unit_price),
    mrp: str(priced.mrp),
    ecommerce_price: str(priced.ecommerce_price),
    retailer_price: str(priced.retailer_price),
    distributor_price: str(priced.distributor_price),
    gst_rate: str(priced.gst_rate),
  });
  const setP = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.value });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["products-forecast"] });
    qc.invalidateQueries({ queryKey: ["products-inventory"] });
  };

  const save = useMutation({
    mutationFn: async () => {
      const color = f.color.trim() || null;
      const size = f.size.trim() || null;
      const sku = f.sku.trim() || undefined;
      const name = variantDisplayName(parent.name, color, size);
      if (!color && !size) throw new Error("Enter a colour or a size for this variant");
      const pricePayload = {
        unit_cost: numOrNull(f.unit_cost) ?? 0,
        unit_price: numOrNull(f.unit_price) ?? 0,
        mrp: numOrNull(f.mrp),
        ecommerce_price: numOrNull(f.ecommerce_price),
        retailer_price: numOrNull(f.retailer_price),
        distributor_price: numOrNull(f.distributor_price),
        gst_rate: numOrNull(f.gst_rate),
      };
      if (isEdit && child) {
        await api.products.update(child.id, { color, size, sku, name, ...pricePayload });
      } else {
        await api.products.create({ parent_id: parent.id, color, size, sku, ...pricePayload });
      }
    },
    onSuccess: () => {
      refresh();
      toast.success(isEdit ? "Variant updated" : "Variant created");
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
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div>
            <h3 className="font-display text-lg">
              {isEdit ? "Edit variant" : "Add colour/size variant"}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Parent <span className="font-mono font-medium text-foreground">{parent.sku}</span> ·{" "}
              {parent.name}
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="mt-4 space-y-3"
        >
          <div className="grid grid-cols-2 gap-3">
            <L label="Colour">
              <SearchableSelect
                value={f.color}
                onChange={(v) => setF({ ...f, color: v })}
                placeholder="Search colour…"
                searchPlaceholder="Type colour name or code…"
                emptyText="No colour matches"
                options={[
                  ...STANDARD_COLOURS.map((c) => ({
                    value: c.name,
                    label: `${c.name} (${c.code})`,
                    hint: `Code: ${c.code}`,
                  })),
                  ...(f.color && !STANDARD_COLOURS.some((c) => c.name === f.color)
                    ? [{ value: f.color, label: f.color, hint: "Custom" }]
                    : []),
                ]}
              />
            </L>
            <L label="Size">
              <input
                className="inp"
                value={f.size}
                onChange={(e) => setF({ ...f, size: e.target.value })}
                placeholder="e.g. M, 42, XL"
              />
            </L>
          </div>
          <L label="SKU (optional — auto-generated from parent, colour & size)">
            <input
              className="inp"
              value={f.sku}
              onChange={(e) => setF({ ...f, sku: e.target.value })}
              placeholder={`e.g. ${parent.sku}-BLACK-42`}
            />
          </L>
          <div>
            <p className="mb-1.5 text-xs uppercase tracking-widest text-muted-foreground">
              Pricing (₹){isEdit ? " — this SKU's own prices" : ` — prefilled from ${parent.sku}`}
            </p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <L label="Cost">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="inp"
                  value={f.unit_cost}
                  onChange={setP("unit_cost")}
                />
              </L>
              <L label="Selling price">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="inp"
                  value={f.unit_price}
                  onChange={setP("unit_price")}
                />
              </L>
              <L label="MRP">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="inp"
                  value={f.mrp}
                  onChange={setP("mrp")}
                />
              </L>
              <L label="Retailer price">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="inp"
                  value={f.retailer_price}
                  onChange={setP("retailer_price")}
                />
              </L>
              <L label="Distributor price">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="inp"
                  value={f.distributor_price}
                  onChange={setP("distributor_price")}
                />
              </L>
              <L label="E-commerce price">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="inp"
                  value={f.ecommerce_price}
                  onChange={setP("ecommerce_price")}
                />
              </L>
              <L label="GST %">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="inp"
                  value={f.gst_rate}
                  onChange={setP("gst_rate")}
                />
              </L>
            </div>
          </div>
          <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
            <Layers className="mb-1 h-3.5 w-3.5 text-primary" />
            Supplier and image stay inherited from <span className="font-mono">{parent.sku}</span> —
            prices above are this SKU's own (snapshot, not linked to the parent). Leave the SKU
            blank to auto-generate it.
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              disabled={save.isPending}
              className="inline-flex items-center gap-2 rounded-[10px] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:-translate-y-px hover:shadow-md disabled:opacity-60"
            >
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? "Save variant" : "Create variant"}
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

// Margin is stored as a decimal (0.4 = 40%) but edited as a percent (40).
// Legacy records may hold a raw percent (e.g. 40) — normalize those too.
function marginStoredToPercent(v: number | null | undefined): string {
  const n = Number(v ?? 0.4) || 0.4;
  const pct = n > 1 ? n : n * 100;
  return String(Math.round(pct * 100) / 100);
}

// numOrNull lives in @/components/sku-shared (imported above).

function ProductModal({
  userId,
  product,
  defaultMargin,
  suppliers,
  onClose,
}: {
  userId: string;
  product: Product | null;
  defaultMargin: number;
  suppliers: Array<{ id: string; company_name?: string; companyName?: string }>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!product;
  const legacyStatus =
    product?.status === "discontinued" ? "inactive" : (product?.status ?? "active");
  const [f, setF] = useState({
    sku: product?.sku ?? "",
    name: product?.name ?? "",
    description: product?.description ?? "",
    category: product?.category ?? "",
    subcategory: product?.subcategory ?? "",
    gender: (() => {
      const g = String(product?.gender ?? "Unisex")
        .trim()
        .toLowerCase();
      if (g === "mens" || g === "men") return "Men";
      if (g === "womens" || g === "women") return "Women";
      if (g === "unisex") return "Unisex";
      if (g === "kids" || g === "kid") return "Kids";
      if (g === "boys" || g === "boy") return "Boys";
      if (g === "girls" || g === "girl") return "Girls";
      return product?.gender ?? "Unisex";
    })(),
    brand: product?.brand ?? "",
    size: product?.size ?? "",
    color: product?.color ?? "",
    model: product?.model ?? "",
    unit_of_measure: product?.unit_of_measure ?? "piece",
    season: product?.season ?? "all",
    barcode: product?.barcode ?? "",
    barcode_type: product?.barcode_type ?? "",
    units_per_carton: product?.units_per_carton != null ? String(product.units_per_carton) : "",
    unit_price: String(product?.unit_price ?? ""),
    unit_cost: String(product?.unit_cost ?? ""),
    mrp: product?.mrp != null ? String(product.mrp) : "",
    ecommerce_price: product?.ecommerce_price != null ? String(product.ecommerce_price) : "",
    retailer_price: product?.retailer_price != null ? String(product.retailer_price) : "",
    distributor_price: product?.distributor_price != null ? String(product.distributor_price) : "",
    flexible_price: product?.flexible_price != null ? String(product.flexible_price) : "",
    minimum_gross_margin_percentage: marginStoredToPercent(
      product?.minimum_gross_margin_percentage ?? defaultMargin,
    ),
    lead_time_days: String(product?.lead_time_days ?? "30"),
    safety_stock_days: String(product?.safety_stock_days ?? "30"),
    supplier_id: product?.supplier_id ?? "",
    supplier_product_code: product?.supplier_product_code ?? "",
    minimum_order_quantity:
      product?.minimum_order_quantity != null ? String(product.minimum_order_quantity) : "",
    order_multiple: product?.order_multiple != null ? String(product.order_multiple) : "",
    hsn_code: product?.hsn_code ?? "",
    gst_rate: product?.gst_rate != null ? String(product.gst_rate) : "",
    image_url: product?.image_url ?? "",
    status: legacyStatus,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!f.name.trim()) throw new Error("Name required");
      const payload = {
        client_id: userId,
        sku: f.sku || undefined,
        name: f.name.trim(),
        description: f.description.trim() || null,
        category: f.category || null,
        subcategory: f.subcategory || null,
        gender: f.gender || null,
        brand: f.brand.trim() || null,
        size: f.size || null,
        color: f.color || null,
        model: f.model.trim() || null,
        unit_of_measure: f.unit_of_measure || "piece",
        season: f.season,
        barcode: f.barcode.trim() || null,
        barcode_type: f.barcode_type || null,
        units_per_carton: numOrNull(f.units_per_carton),
        unit_price: Number(f.unit_price) || 0,
        unit_cost: Number(f.unit_cost) || 0,
        mrp: numOrNull(f.mrp),
        ecommerce_price: numOrNull(f.ecommerce_price),
        retailer_price: numOrNull(f.retailer_price),
        distributor_price: numOrNull(f.distributor_price),
        flexible_price: numOrNull(f.flexible_price),
        minimum_gross_margin_percentage: Math.min(
          0.99,
          Math.max(0.01, (Number(f.minimum_gross_margin_percentage) || 40) / 100),
        ),
        // Hidden infra field (not part of the catalogue form) — preserved on
        // edit so low-stock indicators keep working without being clobbered.
        reorder_level: product?.reorder_level ?? 10,
        lead_time_days: Number(f.lead_time_days) || 30,
        safety_stock_days: Number(f.safety_stock_days) || 30,
        supplier_id: f.supplier_id || null,
        supplier_product_code: f.supplier_product_code.trim() || null,
        minimum_order_quantity: numOrNull(f.minimum_order_quantity),
        order_multiple: numOrNull(f.order_multiple),
        hsn_code: f.hsn_code.trim() || null,
        gst_rate: numOrNull(f.gst_rate),
        image_url: f.image_url || null,
        status: f.status,
      };
      if (isEdit && product) {
        await api.products.update(product.id, payload);
      } else {
        await api.products.create(payload);
      }
    },
    onSuccess: () => {
      // Invalidate both keys so the Products page AND the forecast page
      // (which recomputes pricing strategy from unit cost / margin) stay in sync.
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["products-forecast"] });
      // Inventory shows product thumbnails — keep those fresh too.
      qc.invalidateQueries({ queryKey: ["products-inventory"] });
      toast.success(isEdit ? "Updated" : "Created");
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
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">{isEdit ? "Edit Master SKU" : "New Master SKU"}</h3>
          <button onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-5 p-5"
        >
          <Section title="Basic Master SKU details" step="1">
            <div className="grid grid-cols-2 gap-3">
              <L label="SKU (auto if blank)">
                <input
                  className="inp"
                  value={f.sku}
                  onChange={(e) => setF({ ...f, sku: e.target.value })}
                  placeholder="Auto-generated if left blank"
                />
              </L>
              <L label="Product name *">
                <input
                  required
                  className="inp"
                  value={f.name}
                  onChange={(e) => setF({ ...f, name: e.target.value })}
                />
              </L>
              <L label="Category">
                <select
                  className="inp"
                  value={f.category}
                  onChange={(e) => setF({ ...f, category: e.target.value })}
                >
                  <option value="">—</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </L>
              <L label="Brand">
                <input
                  className="inp"
                  value={f.brand}
                  onChange={(e) => setF({ ...f, brand: e.target.value })}
                  placeholder="e.g. Nike"
                />
              </L>
              <L label="Status">
                <select
                  className="inp"
                  value={f.status}
                  onChange={(e) => setF({ ...f, status: e.target.value })}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </L>
            </div>
            <L label="Product description">
              <textarea
                rows={2}
                className="inp resize-y"
                value={f.description}
                onChange={(e) => setF({ ...f, description: e.target.value })}
                placeholder="Short description of the product…"
              />
            </L>
            <L label="Product image">
              <ImageField
                userId={userId}
                value={f.image_url}
                onChange={(url) => setF({ ...f, image_url: url })}
              />
            </L>
          </Section>

          <Section title="Variant details" step="2">
            <div className="grid grid-cols-2 gap-3">
              <L label="Size">
                <input
                  className="inp"
                  value={f.size}
                  onChange={(e) => setF({ ...f, size: e.target.value })}
                  placeholder="e.g. M, 42, XL"
                />
              </L>
              <L label="Colour">
                <input
                  className="inp"
                  value={f.color}
                  onChange={(e) => setF({ ...f, color: e.target.value })}
                  placeholder="e.g. Black"
                />
              </L>
              <L label="Model / variant">
                <input
                  className="inp"
                  value={f.model}
                  onChange={(e) => setF({ ...f, model: e.target.value })}
                  placeholder="e.g. Airmax-2024"
                />
              </L>
              <L label="Unit of measure">
                <select
                  className="inp"
                  value={f.unit_of_measure}
                  onChange={(e) => setF({ ...f, unit_of_measure: e.target.value })}
                >
                  {UNITS_OF_MEASURE.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </L>
              <L label="Subcategory">
                <input
                  className="inp"
                  value={f.subcategory}
                  onChange={(e) => setF({ ...f, subcategory: e.target.value })}
                  placeholder="e.g. Running shoes"
                />
              </L>
              <L label="Gender">
                <select
                  className="inp"
                  value={f.gender}
                  onChange={(e) => setF({ ...f, gender: e.target.value })}
                >
                  {GENDERS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                  {!GENDERS.includes(f.gender) && <option value={f.gender}>{f.gender}</option>}
                </select>
              </L>
              <L label="Season">
                <select
                  className="inp"
                  value={f.season}
                  onChange={(e) => setF({ ...f, season: e.target.value })}
                >
                  {SEASONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </L>
            </div>
          </Section>

          <Section title="Barcode details" step="3">
            <div className="grid grid-cols-2 gap-3">
              <L label="Barcode number">
                <input
                  className="inp"
                  value={f.barcode}
                  onChange={(e) => setF({ ...f, barcode: e.target.value })}
                  placeholder="EAN / UPC number"
                />
              </L>
              <L label="Barcode type (optional)">
                <select
                  className="inp"
                  value={f.barcode_type}
                  onChange={(e) => setF({ ...f, barcode_type: e.target.value })}
                >
                  {BARCODE_TYPES.map((b) => (
                    <option key={b || "none"} value={b}>
                      {b || "—"}
                    </option>
                  ))}
                </select>
              </L>
              <L label="Units per carton (optional)">
                <input
                  type="number"
                  min="1"
                  className="inp"
                  value={f.units_per_carton}
                  onChange={(e) => setF({ ...f, units_per_carton: e.target.value })}
                  placeholder="e.g. 24"
                />
              </L>
            </div>
          </Section>

          <Section title="Buying details" step="4">
            <div className="grid grid-cols-2 gap-3">
              <L label="Standard unit cost">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="inp"
                  value={f.unit_cost}
                  onChange={(e) => setF({ ...f, unit_cost: e.target.value })}
                />
              </L>
              <L label="Preferred supplier">
                <SearchableSelect
                  value={f.supplier_id}
                  onChange={(v) => setF({ ...f, supplier_id: v })}
                  placeholder="—"
                  options={suppliers.map((s: any) => ({
                    value: s.id,
                    label: s.company_name ?? s.companyName ?? s.id,
                  }))}
                />
              </L>
              <L label="Supplier product code (optional)">
                <input
                  className="inp"
                  value={f.supplier_product_code}
                  onChange={(e) => setF({ ...f, supplier_product_code: e.target.value })}
                  placeholder="Supplier's reference for this SKU"
                />
              </L>
              <L label="Lead time (days)">
                <input
                  type="number"
                  min="0"
                  className="inp"
                  value={f.lead_time_days}
                  onChange={(e) => setF({ ...f, lead_time_days: e.target.value })}
                />
              </L>
              <L label="Minimum order quantity">
                <input
                  type="number"
                  min="1"
                  className="inp"
                  value={f.minimum_order_quantity}
                  onChange={(e) => setF({ ...f, minimum_order_quantity: e.target.value })}
                  placeholder="e.g. 12"
                />
              </L>
              <L label="Order multiple">
                <input
                  type="number"
                  min="1"
                  className="inp"
                  value={f.order_multiple}
                  onChange={(e) => setF({ ...f, order_multiple: e.target.value })}
                  placeholder="e.g. 6"
                />
              </L>
            </div>
          </Section>

          <Section title="Selling details" step="5">
            <div className="grid grid-cols-2 gap-3">
              <L label="MRP">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="inp"
                  value={f.mrp}
                  onChange={(e) => setF({ ...f, mrp: e.target.value })}
                  placeholder="Max retail price"
                />
              </L>
              <L label="E-commerce selling price">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="inp"
                  value={f.ecommerce_price}
                  onChange={(e) => setF({ ...f, ecommerce_price: e.target.value })}
                  placeholder="Online / e-commerce price"
                />
              </L>
              <L label="Retailer price">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="inp"
                  value={f.retailer_price}
                  onChange={(e) => setF({ ...f, retailer_price: e.target.value })}
                  placeholder="Price for retailers"
                />
              </L>
              <L label="Distributor price">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="inp"
                  value={f.distributor_price}
                  onChange={(e) => setF({ ...f, distributor_price: e.target.value })}
                  placeholder="Price for distributors"
                />
              </L>
              <L label="Flexible price">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="inp"
                  value={f.flexible_price}
                  onChange={(e) => setF({ ...f, flexible_price: e.target.value })}
                  placeholder="Negotiable / flexible price"
                />
              </L>
              <L label="Minimum gross margin (%)">
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  max="99"
                  className="inp"
                  value={f.minimum_gross_margin_percentage}
                  onChange={(e) => setF({ ...f, minimum_gross_margin_percentage: e.target.value })}
                />
              </L>
            </div>
            <PricingPreview f={f} />
          </Section>

          <Section title="Tax details" step="6">
            <div className="grid grid-cols-2 gap-3">
              <L label="HSN code">
                <input
                  className="inp"
                  value={f.hsn_code}
                  onChange={(e) => setF({ ...f, hsn_code: e.target.value })}
                  placeholder="e.g. 6402"
                />
              </L>
              <L label="GST rate (%)">
                <input
                  list="gst-rates"
                  type="number"
                  step="0.01"
                  min="0"
                  max="99"
                  className="inp"
                  value={f.gst_rate}
                  onChange={(e) => setF({ ...f, gst_rate: e.target.value })}
                  placeholder="0, 5, 12, 18, 28…"
                />
                <datalist id="gst-rates">
                  {GST_RATES.filter(Boolean).map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              </L>
            </div>
          </Section>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              disabled={save.isPending}
              className="inline-flex items-center gap-2 rounded-[10px] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:-translate-y-px hover:shadow-md disabled:opacity-60"
            >
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

function Section({
  title,
  step,
  children,
}: {
  title: string;
  step?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="rounded-lg border border-border/60 p-4">
      <legend className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {step && (
          <span className="grid h-4 w-4 place-items-center rounded-full bg-primary/10 text-[9px] font-bold text-primary">
            {step}
          </span>
        )}
        {title}
      </legend>
      <div className="space-y-3">{children}</div>
    </fieldset>
  );
}

// Product image — uploads to S3 via the backend /upload endpoint and stores the
// returned public URL in image_url. Falls back to a plain URL paste.
// ImageField lives in @/components/sku-shared (imported above).

// Minimum selling price is SYSTEM-CALCULATED from the buying + margin data:
//   Min Selling Price = Standard Unit Cost ÷ (1 − Minimum Gross Margin)
function PricingPreview({
  f,
}: {
  f: {
    unit_cost: string;
    unit_price: string;
    mrp: string;
    ecommerce_price: string;
    retailer_price: string;
    distributor_price: string;
    flexible_price: string;
    minimum_gross_margin_percentage: string;
  };
}) {
  const unitCost = Number(f.unit_cost) || 0;
  const mrp = Number(f.mrp) || 0;
  const ecommercePrice = Number(f.ecommerce_price) || 0;
  const retailerPrice = Number(f.retailer_price) || 0;
  const distributorPrice = Number(f.distributor_price) || 0;
  const flexiblePrice = Number(f.flexible_price) || 0;
  // Margin is entered as a percentage (e.g. 40 = 40%) and stored as a decimal (0.4).
  const margin = Math.min(
    0.99,
    Math.max(0.01, (Number(f.minimum_gross_margin_percentage) || 40) / 100),
  );
  // Cost-based floor — the price that preserves the configured gross margin.
  const minSellingPrice = unitCost > 0 ? unitCost / (1 - margin) : 0;

  const prices = [
    { label: "E-commerce", value: ecommercePrice },
    { label: "Retailer", value: retailerPrice },
    { label: "Distributor", value: distributorPrice },
    { label: "Flexible", value: flexiblePrice },
  ];
  const hasAnyPrice = prices.some((p) => p.value > 0);
  const belowFloor =
    hasAnyPrice &&
    minSellingPrice > 0 &&
    prices.some((p) => p.value > 0 && p.value < minSellingPrice);
  const aboveMrp = mrp > 0 && prices.some((p) => p.value > 0 && p.value > mrp);
  const warn = belowFloor || aboveMrp;

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs">
      <div className="mb-1 flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-muted-foreground">
        <RefreshCw className="h-3 w-3" /> Pricing preview — min selling price is system-calculated
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <span className="text-muted-foreground">Standard unit cost</span>
        <span className="text-right font-mono tabular-nums">{fmtMoney(unitCost)}</span>
        <span className="text-muted-foreground">Min gross margin</span>
        <span className="text-right font-mono tabular-nums">{Math.round(margin * 100)}%</span>
        <span className="text-muted-foreground">Min selling price (cost ÷ (1 − margin))</span>
        <span className="text-right font-mono tabular-nums font-semibold">
          {fmtMoney(minSellingPrice)}
        </span>
        {mrp > 0 && (
          <>
            <span className="text-muted-foreground">MRP</span>
            <span className="text-right font-mono tabular-nums">{fmtMoney(mrp)}</span>
          </>
        )}
        {prices.map((p) =>
          p.value > 0 ? (
            <span key={p.label} className="contents">
              <span className="text-muted-foreground">{p.label} price</span>
              <span className="text-right font-mono tabular-nums">{fmtMoney(p.value)}</span>
            </span>
          ) : null,
        )}
        <span className="text-muted-foreground">Status</span>
        <span className={`text-right font-medium ${warn ? "text-sem-attention" : "text-primary"}`}>
          {!hasAnyPrice
            ? "No selling price set"
            : belowFloor
              ? "Below min — margin at risk"
              : aboveMrp
                ? "Above MRP"
                : "Within margin"}
        </span>
      </div>
      {belowFloor && (
        <div className="mt-1 text-[10px] text-sem-attention">
          One or more selling prices are below the minimum selling price of{" "}
          {fmtMoney(minSellingPrice)} — margin may be at risk.
        </div>
      )}
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

// Master SKU creation now lives in @/components/sku-master-modal
// (rendered above). Nothing follows — end of module.
