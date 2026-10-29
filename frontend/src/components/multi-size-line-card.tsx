"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Minus,
  Plus,
  X,
  Check,
  AlertTriangle,
  Trash2,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { round2, splitGstInclusive, gstRateOf } from "@/lib/gst";
import { fmtMoney } from "@/components/ledger-ui";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ProductVariantPicker, fullItemName } from "@/components/product-variant-picker";
import { toast } from "sonner";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type SizeDraft = {
  id: string;
  childProductId: string;
  childSku: string | null;
  childName: string;
  size: string;
  color: string;
  quantity: string;
  unitPrice: string;
  discountPct: string;
  gstRate: string;
  unit: string;
  hsnCode: string;
  mrp: string;
  dispatchedQty?: number;
  receivedQty?: number;
};

export type MultiSizeLineDraft = {
  product_id: string;
  sku: string | null;
  name: string;
  unit: string;
  color: string;
  sizes: SizeDraft[];
  product_code: string;
  hsn_code: string;
  mrp: string;
  price_tier: string;
  dispatched_qty?: number;
  received_qty?: number;
  notes: string;
  fabric?: string;
};

export type LineDraft = MultiSizeLineDraft;

export type CatalogueProduct = {
  id: string;
  sku: string | null;
  name: string;
  unit_of_measure: string;
  parent_id?: string | null;
  color: string | null;
  size: string | null;
  category?: string | null;
  subcategory?: string | null;
  brand?: string | null;
  gender?: string | null;
  model?: string | null;
  hsn_code?: string | null;
  hsnCode?: string | null;
  gst_rate?: number | null;
  unit_price?: number | null;
  unit_cost?: number | null;
  mrp?: number | null;
  ecommerce_price?: number | null;
  retailer_price?: number | null;
  distributor_price?: number | null;
  flexible_price?: number | null;
  status?: string;
};

export type MultiSizeLineCardProps = {
  products: CatalogueProduct[];
  value: MultiSizeLineDraft;
  onChange: (value: MultiSizeLineDraft) => void;
  onRemove: () => void;
  disabled?: boolean;
  mode: "sales" | "purchase";
  stockBalance?: Map<string, number>;
  customerType?: string | null;
};

function clean(v: unknown): string {
  return typeof v === "string" ? v.trim() : v != null ? String(v).trim() : "";
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function round2Local(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function sizeSort(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function emptyMultiSizeLineDraft(
  defaults?: Partial<MultiSizeLineDraft>,
): MultiSizeLineDraft {
  return {
    product_id: "",
    sku: null,
    name: "",
    unit: "piece",
    color: "",
    sizes: [],
    product_code: "",
    hsn_code: "",
    mrp: "",
    price_tier: "",
    notes: "",
    fabric: "",
    ...defaults,
  };
}

/**
 * Group flat lines (from an existing SO, PO, or draft) by parent product + color
 * into an array of MultiSizeLineDrafts.
 */
export function groupLinesToMultiSizeDrafts(
  rawLines: any[],
  products: CatalogueProduct[],
): MultiSizeLineDraft[] {
  if (!rawLines || rawLines.length === 0) return [];

  const byId = new Map<string, CatalogueProduct>();
  for (const p of products) byId.set(p.id, p);

  // Walk up parents to find root product
  const rootOf = (p: CatalogueProduct | undefined): CatalogueProduct | undefined => {
    let cur = p;
    const seen = new Set<string>();
    while (cur?.parent_id && !seen.has(cur.id)) {
      seen.add(cur.id);
      const up = byId.get(cur.parent_id);
      if (!up) break;
      cur = up;
    }
    return cur;
  };

  const groups = new Map<string, { parent: CatalogueProduct | undefined; color: string; lines: any[] }>();

  for (const l of rawLines) {
    // If the line already has a sizes array (already multi-size draft format)
    if (Array.isArray(l.sizes) && l.sizes.length > 0) {
      const key = `${l.product_id}:::${clean(l.color)}`;
      if (!groups.has(key)) {
        groups.set(key, { parent: byId.get(l.product_id), color: clean(l.color), lines: [] });
      }
      groups.get(key)!.lines.push(...l.sizes);
      continue;
    }

    const prod = byId.get(l.product_id);
    const root = rootOf(prod) ?? prod;
    const rootId = root?.id ?? l.product_id;
    const color = clean(l.color || l.colour || prod?.color || "");
    const key = `${rootId}:::${color}`;

    if (!groups.has(key)) {
      groups.set(key, { parent: root, color, lines: [] });
    }
    groups.get(key)!.lines.push(l);
  }

  const result: MultiSizeLineDraft[] = [];

  for (const [key, g] of groups.entries()) {
    const root = g.parent;
    const firstLine = g.lines[0];
    const color = g.color;

    const sizeDrafts: SizeDraft[] = g.lines.map((l: any) => {
      const p = byId.get(l.product_id ?? l.childProductId);
      return {
        id: l.id || uid(),
        childProductId: l.product_id ?? l.childProductId ?? "",
        childSku: l.sku ?? l.childSku ?? p?.sku ?? null,
        childName: l.name ?? l.childName ?? (p ? fullItemName(p as any) : root ? fullItemName(root as any) : ""),
        size: clean(l.size ?? p?.size ?? "One Size"),
        color: clean(l.color ?? l.colour ?? p?.color ?? color),
        quantity: String(l.ordered_qty ?? l.quantity ?? "0"),
        unitPrice: String(l.unit_price ?? l.unitPrice ?? ""),
        discountPct: l.discount_pct != null ? String(l.discount_pct) : l.discountPct != null ? String(l.discountPct) : "",
        gstRate: l.gst_rate != null ? String(l.gst_rate) : l.gstRate != null ? String(l.gstRate) : p?.gst_rate != null ? String(p.gst_rate) : "",
        unit: l.unit ?? p?.unit_of_measure ?? root?.unit_of_measure ?? "piece",
        hsnCode: clean(l.hsn_code ?? l.hsnCode ?? p?.hsn_code ?? p?.hsnCode ?? root?.hsn_code ?? root?.hsnCode ?? ""),
        mrp: l.mrp != null ? String(l.mrp) : p?.mrp != null ? String(p.mrp) : root?.mrp != null ? String(root.mrp) : "",
        dispatchedQty: l.dispatched_qty ?? l.dispatchedQty ?? 0,
        receivedQty: l.received_qty ?? l.receivedQty ?? 0,
      };
    });

    const totalDispatched = sizeDrafts.reduce((sum, s) => sum + (s.dispatchedQty ?? 0), 0);
    const totalReceived = sizeDrafts.reduce((sum, s) => sum + (s.receivedQty ?? 0), 0);

    result.push({
      product_id: root ? root.id : firstLine?.product_id ?? "",
      sku: root?.sku ?? firstLine?.sku ?? null,
      name: root ? fullItemName(root as any) : firstLine?.name ?? "",
      unit: root?.unit_of_measure ?? firstLine?.unit ?? "piece",
      color: color,
      sizes: sizeDrafts,
      product_code: clean(root?.model ?? root?.sku ?? firstLine?.product_code),
      hsn_code: clean(root?.hsn_code ?? root?.hsnCode ?? firstLine?.hsn_code ?? firstLine?.hsnCode),
      mrp: root?.mrp != null ? String(root.mrp) : firstLine?.mrp != null ? String(firstLine.mrp) : "",
      price_tier: firstLine?.price_tier ?? "",
      dispatched_qty: totalDispatched,
      received_qty: totalReceived,
      notes: firstLine?.notes ?? "",
      fabric: firstLine?.fabric ?? "",
    });
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function MultiSizeLineCard({
  products,
  value,
  onChange,
  onRemove,
  disabled = false,
  mode,
  stockBalance,
  customerType,
}: MultiSizeLineCardProps) {
  const [draftCategory, setDraftCategory] = useState("");
  const [draftParentId, setDraftParentId] = useState(value.product_id ?? "");
  const [draftColor, setDraftColor] = useState(value.color ?? "");
  const [sizes, setSizes] = useState<SizeDraft[]>(value.sizes ?? []);
  const [confirmClearOnColorChange, setConfirmClearOnColorChange] = useState(false);

  const byId = useMemo(() => {
    const m = new Map<string, CatalogueProduct>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);

  const childrenByParent = useMemo(() => {
    const m = new Map<string, CatalogueProduct[]>();
    for (const p of products) {
      if (p.parent_id) {
        const list = m.get(p.parent_id) ?? [];
        list.push(p);
        m.set(p.parent_id, list);
      }
    }
    return m;
  }, [products]);

  const categoryList = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      const c = clean(p.category);
      if (c) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [products]);

  const parents = useMemo(() => {
    const cat = draftCategory || "";
    return products
      .filter((p) => !p.parent_id && (!cat || clean(p.category) === cat))
      .sort((a, b) =>
        fullItemName(a as any).localeCompare(fullItemName(b as any), undefined, { sensitivity: "base" }),
      );
  }, [products, draftCategory]);

  const parent = useMemo(() => (draftParentId ? byId.get(draftParentId) : undefined), [byId, draftParentId]);

  // All descendant leaf SKUs under the chosen parent, two levels deep
  const descendantPool = useMemo(() => {
    if (!draftParentId) return [];
    const direct = childrenByParent.get(draftParentId) ?? [];
    const out: CatalogueProduct[] = [];
    for (const d of direct) {
      const grand = childrenByParent.get(d.id);
      if (grand && grand.length > 0) {
        out.push(...grand);
      } else {
        out.push(d);
      }
    }
    // If the parent itself is standalone (has no child variants), include parent
    if (out.length === 0 && parent) {
      out.push(parent);
    }
    return out;
  }, [draftParentId, childrenByParent, parent]);

  const availableColors = useMemo(() => {
    const set = new Set<string>();
    const direct = draftParentId ? childrenByParent.get(draftParentId) ?? [] : [];
    for (const d of direct) {
      const c = clean(d.color);
      if (c) set.add(c);
    }
    for (const p of descendantPool) {
      const c = clean(p.color);
      if (c) set.add(c);
    }
    return Array.from(set).sort();
  }, [draftParentId, childrenByParent, descendantPool]);

  // Leaf products matching the selected color (or all if no colors exist)
  const sizeChildren = useMemo(() => {
    if (!draftParentId) return [];
    if (availableColors.length > 0 && draftColor) {
      return descendantPool.filter(
        (p) => clean(p.color).toLowerCase() === clean(draftColor).toLowerCase(),
      );
    }
    return descendantPool;
  }, [draftParentId, availableColors.length, draftColor, descendantPool]);

  const availableSizes = useMemo(() => {
    const set = new Set<string>();
    for (const p of sizeChildren) {
      const s = clean(p.size);
      if (s) set.add(s);
    }
    return Array.from(set).sort(sizeSort);
  }, [sizeChildren]);

  const hasSizedVariants = availableSizes.length > 0;

  const selectedSizeValues = useMemo(() => new Set(sizes.map((s) => s.size)), [sizes]);

  // Resync when external value changes (draft resume, edit load)
  useEffect(() => {
    if (value.product_id && value.product_id !== draftParentId) {
      setDraftParentId(value.product_id);
      const p = byId.get(value.product_id);
      if (p && clean(p.category) && !draftCategory) {
        setDraftCategory(clean(p.category));
      }
    }
    if (value.color && value.color !== draftColor) {
      setDraftColor(value.color);
    }
    setSizes(value.sizes ?? []);
  }, [value.product_id, value.color, value.sizes]);

  const selectedChildForSize = useCallback(
    (size: string): CatalogueProduct | undefined => {
      return sizeChildren.find(
        (c) => clean(c.size) === size || (!size && !clean(c.size)),
      ) ?? sizeChildren[0];
    },
    [sizeChildren],
  );

  const parentPrice = useMemo(() => {
    if (!parent) return "";
    const p = parent as any;
    if (mode === "sales") {
      const tier = value.price_tier || "";
      const resolved =
        tier === "mrp"
          ? p.mrp
          : tier === "ecommerce"
            ? p.ecommerce_price
            : tier === "retailer"
              ? p.retailer_price
              : tier === "distributor"
                ? p.distributor_price
                : tier === "flexible"
                  ? p.flexible_price
                  : p.unit_price;
      return resolved != null ? String(resolved) : "";
    }
    return p.unit_cost != null ? String(p.unit_cost) : p.unit_price != null ? String(p.unit_price) : "";
  }, [parent, mode, value.price_tier]);

  const parentGstRate = useMemo(() => {
    if (!parent) return "";
    return parent.gst_rate != null ? String(parent.gst_rate) : "";
  }, [parent]);

  const parentUnit = useMemo(() => parent?.unit_of_measure ?? "piece", [parent]);
  const parentHsn = useMemo(() => clean(parent?.hsn_code ?? parent?.hsnCode), [parent]);
  const parentMrp = useMemo(() => (parent?.mrp != null ? String(parent.mrp) : ""), [parent]);

  // ─── Actions ───

  const setValue = (patch: Partial<MultiSizeLineDraft>) => onChange({ ...value, ...patch });

  const setSizesState = (next: SizeDraft[]) => {
    setSizes(next);
    setValue({ sizes: next });
  };

  const handleCategoryChange = (next: string) => {
    setDraftCategory(next);
    setDraftParentId("");
    setDraftColor("");
    setSizesState([]);
    setValue({
      product_id: "",
      sku: null,
      name: "",
      color: "",
      sizes: [],
      unit: "",
      hsn_code: "",
      mrp: "",
      product_code: "",
      price_tier: value.price_tier,
      notes: value.notes,
    });
  };

  const handleParentChange = (parentId: string) => {
    const p = byId.get(parentId);
    if (!p) return;
    setDraftParentId(parentId);
    setDraftColor("");
    setSizesState([]);
    setValue({
      product_id: parentId,
      sku: p.sku ?? null,
      name: fullItemName(p as any),
      color: "",
      sizes: [],
      unit: p.unit_of_measure ?? "piece",
      hsn_code: clean(p.hsn_code ?? p.hsnCode),
      mrp: p.mrp != null ? String(p.mrp) : "",
      product_code: clean(p.model ?? p.sku),
      price_tier: value.price_tier,
      notes: value.notes,
    });
  };

  const handleColorChange = (color: string) => {
    if (sizes.length > 0) {
      // Find what sizes would exist in new colour
      const newColourChildren = descendantPool.filter(
        (p) => clean(p.color).toLowerCase() === clean(color).toLowerCase(),
      );
      const validSizes = new Set(newColourChildren.map((p) => clean(p.size)).filter(Boolean));
      const invalid = sizes.filter((s) => !validSizes.has(s.size));

      if (invalid.length > 0 && !confirmClearOnColorChange) {
        setDraftColor(color);
        setConfirmClearOnColorChange(true);
        toast.warning(
          `Changing colour will remove ${invalid.length} selected size(s) not available in "${color}". Confirm to proceed.`,
        );
        return;
      }
    }

    setDraftColor(color);
    setConfirmClearOnColorChange(false);
    setValue({ color });

    const next = sizes.map((s) => ({ ...s, color }));
    setSizesState(next);
  };

  const confirmClearInvalid = () => {
    setConfirmClearOnColorChange(false);
    const validSizes = new Set(availableSizes);
    const next = sizes.filter((s) => validSizes.has(s.size));
    setSizesState(next);
    toast.info(`Removed ${sizes.length - next.length} size(s) not available in "${draftColor}".`);
  };

  const toggleSize = (size: string) => {
    if (selectedSizeValues.has(size)) {
      setSizesState(sizes.filter((s) => s.size !== size));
      return;
    }
    const child = selectedChildForSize(size);
    if (!child) return;
    const newSize: SizeDraft = {
      id: uid(),
      childProductId: child.id,
      childSku: child.sku ?? null,
      childName: fullItemName(child as any),
      size: clean(child.size) || (hasSizedVariants ? size : "One Size"),
      color: draftColor || clean(child.color),
      quantity: "1",
      unitPrice: parentPrice || (child.unit_cost != null ? String(child.unit_cost) : child.unit_price != null ? String(child.unit_price) : ""),
      discountPct: "",
      gstRate: parentGstRate || (child.gst_rate != null ? String(child.gst_rate) : ""),
      unit: parentUnit || child.unit_of_measure || "piece",
      hsnCode: parentHsn || clean(child.hsn_code ?? child.hsnCode),
      mrp: parentMrp || (child.mrp != null ? String(child.mrp) : ""),
    };
    setSizesState([...sizes, newSize]);
  };

  const selectAllSizes = () => {
    const existing = new Set(sizes.map((s) => s.size));
    const toAdd = availableSizes.filter((s) => !existing.has(s));
    const added: SizeDraft[] = toAdd.map((size) => {
      const child = sizeChildren.find((c) => clean(c.size) === size);
      return {
        id: uid(),
        childProductId: child ? child.id : "",
        childSku: child ? child.sku ?? null : null,
        childName: child ? fullItemName(child as any) : "",
        size,
        color: draftColor,
        quantity: "1",
        unitPrice: parentPrice || (child?.unit_cost != null ? String(child.unit_cost) : child?.unit_price != null ? String(child.unit_price) : ""),
        discountPct: "",
        gstRate: parentGstRate || (child?.gst_rate != null ? String(child.gst_rate) : ""),
        unit: parentUnit || child?.unit_of_measure || "piece",
        hsnCode: parentHsn || clean(child?.hsn_code ?? child?.hsnCode),
        mrp: parentMrp || (child?.mrp != null ? String(child.mrp) : ""),
      };
    });
    setSizesState([...sizes, ...added]);
  };

  const clearAllSizes = () => setSizesState([]);

  const removeSize = (id: string) => setSizesState(sizes.filter((s) => s.id !== id));

  const setSizeField = (id: string, field: keyof SizeDraft, value: string | number) => {
    setSizesState(sizes.map((s) => (s.id === id ? { ...s, [field]: String(value) } : s)));
  };

  const bulkEdit = (field: keyof SizeDraft, value: string) => {
    if (!value.trim()) return;
    setSizesState(sizes.map((s) => ({ ...s, [field]: value })));
  };

  // ─── Computed per-size totals ───

  const sizeRows = useMemo(() => {
    return sizes.map((s) => {
      const qty = Number(s.quantity) || 0;
      const price = Number(s.unitPrice) || 0;
      const disc = Number(s.discountPct) || 0;
      const gross = round2Local(qty * price);
      const discountAmount = round2Local(gross * (disc / 100));
      const taxable = round2Local(gross - discountAmount);
      const gstRate = gstRateOf(s.gstRate);
      const split = splitGstInclusive(taxable, gstRate);
      const lineTotal = round2Local(split.total);
      const available = stockBalance?.get(s.childProductId);
      return {
        ...s,
        qty,
        price,
        disc,
        gross,
        discountAmount,
        taxable,
        gstRate,
        gstAmount: split.gstAmount,
        lineTotal,
        availableStock: available,
      };
    });
  }, [sizes, stockBalance]);

  const groupTotal = round2Local(sizeRows.reduce((sum, r) => sum + r.lineTotal, 0));
  const groupQty = sizeRows.reduce((sum, r) => sum + r.qty, 0);

  // ─── Render ───

  return (
    <div className="space-y-4 rounded-xl border border-border/70 bg-card/60 p-4 sm:p-5 shadow-sm transition-all">
      {/* Card Header */}
      <div className="flex items-center justify-between gap-3 border-b border-border/40 pb-3">
        <div className="min-w-0 flex items-center gap-2">
          {!value.product_id ? (
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold">
                <Layers className="h-3.5 w-3.5" />
              </span>
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Select product
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <span className="font-semibold text-sm sm:text-base text-foreground truncate">
                {value.name || "Product Group"}
              </span>
              {value.color && (
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                  {value.color}
                </span>
              )}
              {sizes.length > 0 && (
                <span className="inline-flex items-center rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground font-mono">
                  {sizes.length} size{sizes.length !== 1 ? "s" : ""} selected
                </span>
              )}
            </div>
          )}
        </div>
        {!disabled && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove product group"
            title="Remove product group"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-muted-foreground/70 transition-colors hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Product Selection Controls */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="min-w-0">
          <span className="mb-1 block text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Category
          </span>
          {categoryList.length > 0 ? (
            <SearchableSelect
              value={draftCategory}
              onChange={handleCategoryChange}
              disabled={disabled}
              placeholder="Select category…"
              searchPlaceholder="Search categories…"
              fullLabel
              options={categoryList.map((c) => ({ value: c, label: c }))}
            />
          ) : (
            <div className="h-10 w-full rounded-md border border-border bg-input px-3 text-sm text-muted-foreground flex items-center">
              No categories
            </div>
          )}
        </div>

        <div className="min-w-0">
          <span className="mb-1 block text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Product / Parent SKU
          </span>
          <ProductVariantPicker
            products={parents.map((p) => ({
              id: p.id,
              sku: p.sku,
              name: fullItemName(p as any),
              color: p.color,
              size: p.size,
              parent_id: p.parent_id,
              category: p.category,
              subcategory: p.subcategory,
              brand: p.brand,
              gender: p.gender,
              model: p.model,
            }))}
            value={draftParentId}
            onChange={handleParentChange}
            disabled={disabled || categoryList.length === 0}
            placeholder="Select product…"
            childPlaceholder="Select variant…"
            categoryPlaceholder="Select category…"
            categoryCompact
            layout="stacked"
            showLabels={false}
            showCategory={false}
            itemDisplay="sku"
          />
        </div>

        <div className="min-w-0">
          <span className="mb-1 block text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Colour
          </span>
          {draftParentId ? (
            availableColors.length > 0 ? (
              <SearchableSelect
                value={draftColor}
                onChange={handleColorChange}
                disabled={disabled || !draftParentId}
                placeholder="Select colour…"
                searchPlaceholder="Type colour…"
                fullLabel
                options={availableColors.map((c) => {
                  const cnt = descendantPool.filter(
                    (s) => clean(s.color).toLowerCase() === c.toLowerCase() && clean(s.size),
                  ).length;
                  return {
                    value: c,
                    label: c,
                    hint: cnt > 0 ? `${cnt} size${cnt === 1 ? "" : "s"}` : undefined,
                  };
                })}
              />
            ) : (
              <div className="h-10 w-full rounded-md border border-border bg-muted/30 px-3 text-xs text-muted-foreground flex items-center">
                No colour variants (Standard)
              </div>
            )
          ) : (
            <div className="h-10 w-full rounded-md border border-border bg-muted/20 px-3 text-sm text-muted-foreground flex items-center">
              Select product first
            </div>
          )}
        </div>
      </div>

      {/* Snapshot Information */}
      {value.product_id && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground font-mono">
          {value.unit ? <span>Unit: <strong className="text-foreground">{value.unit}</strong></span> : null}
          {value.hsn_code ? <span>HSN: <strong className="text-foreground">{value.hsn_code}</strong></span> : null}
          {value.mrp ? <span>MRP: <strong className="text-foreground">₹{value.mrp}</strong></span> : null}
        </div>
      )}

      {/* Size Chips Section */}
      {draftParentId && (availableColors.length === 0 || draftColor) ? (
        <section className="rounded-lg border border-border/70 bg-muted/20 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              {hasSizedVariants
                ? `Available sizes ${draftColor ? `for ${draftColor}` : ""}`
                : "Product variant item"}
            </span>
            {hasSizedVariants && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={selectAllSizes}
                  disabled={
                    disabled ||
                    availableSizes.length === 0 ||
                    selectedSizeValues.size >= availableSizes.length
                  }
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-40"
                >
                  <Check className="h-3 w-3" /> Select all
                </button>
                <button
                  type="button"
                  onClick={clearAllSizes}
                  disabled={disabled || sizes.length === 0}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:opacity-40"
                >
                  <X className="h-3 w-3" /> Clear
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {hasSizedVariants ? (
              availableSizes.map((size) => {
                const child = selectedChildForSize(size);
                const isSelected = selectedSizeValues.has(size);
                const isUnavailable = !child;
                const available = stockBalance?.get(child?.id ?? "");
                return (
                  <button
                    key={size}
                    type="button"
                    onClick={() => !disabled && !isUnavailable && toggleSize(size)}
                    disabled={disabled || isUnavailable}
                    aria-pressed={isSelected}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all shadow-sm",
                      isUnavailable
                        ? "border-border/40 bg-muted/30 text-muted-foreground/40 cursor-not-allowed"
                        : isSelected
                          ? "border-primary bg-primary text-primary-foreground shadow-sm hover:bg-primary/95"
                          : "border-border bg-card text-foreground hover:border-primary/50 hover:bg-primary/5",
                    )}
                    title={
                      isUnavailable
                        ? `${size} — not available`
                        : `${size} ${available != null ? `(Stock: ${available.toLocaleString()})` : ""}`
                    }
                  >
                    {isSelected && <Check className="h-3.5 w-3.5 shrink-0" />}
                    <span>{size}</span>
                    {available != null && (
                      <span
                        className={cn(
                          "ml-1 text-[10px] tabular-nums font-mono",
                          isSelected
                            ? "text-primary-foreground/80"
                            : available <= 0
                              ? "text-destructive"
                              : "text-muted-foreground",
                        )}
                      >
                        ({available})
                      </span>
                    )}
                  </button>
                );
              })
            ) : (
              // Standalone / Non-sized product button
              <button
                type="button"
                onClick={() => !disabled && toggleSize("One Size")}
                disabled={disabled}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
                  sizes.length > 0
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground hover:border-primary hover:bg-primary/5",
                )}
              >
                {sizes.length > 0 && <Check className="h-3.5 w-3.5 shrink-0" />}
                <span>Add Item ({clean(parent?.unit_of_measure) || "Unit"})</span>
              </button>
            )}
          </div>
        </section>
      ) : null}

      {/* Per-size Table */}
      {sizes.length > 0 ? (
        <section className="rounded-xl border border-border/70 bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="py-2.5 px-3">Size</th>
                  <th className="py-2.5 px-2">SKU</th>
                  <th className="py-2.5 px-2 w-24 text-right">Qty</th>
                  <th className="py-2.5 px-2 w-28 text-right">Unit Price (₹)</th>
                  <th className="py-2.5 px-2 w-20 text-right">GST %</th>
                  <th className="py-2.5 px-2 w-20 text-right">Stock</th>
                  <th className="py-2.5 px-3 w-28 text-right">Line Total (₹)</th>
                  <th className="py-2.5 px-2 w-10 text-center"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {sizeRows.map((r) => {
                  const stockText = r.availableStock == null ? "—" : `${r.availableStock.toLocaleString()}`;
                  const stockWarn = mode === "sales" && r.availableStock != null && r.qty > 0 && r.qty > r.availableStock;
                  return (
                    <tr key={r.id} className="transition-colors hover:bg-muted/10">
                      <td className="py-2 px-3 font-medium text-foreground">
                        {r.size}
                      </td>
                      <td className="py-2 px-2 font-mono text-[11px] text-muted-foreground">
                        {r.childSku ?? "—"}
                      </td>
                      <td className="py-2 px-2 text-right">
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          className={cn(
                            "h-8 w-full rounded-md border border-border bg-input px-2 text-right text-xs text-foreground font-mono tabular-nums focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-60",
                            stockWarn && "!border-destructive text-destructive font-bold",
                          )}
                          value={r.quantity}
                          onChange={(e) => setSizeField(r.id, "quantity", e.target.value)}
                          disabled={disabled}
                          placeholder="0"
                        />
                        {stockWarn && (
                          <div className="mt-0.5 text-[9px] text-destructive font-medium">
                            Short by {r.qty - (r.availableStock ?? 0)}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right">
                        <span className="font-mono text-xs tabular-nums text-foreground">
                          {r.unitPrice ? `₹${Number(r.unitPrice).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          className="h-8 w-full rounded-md border border-border bg-input px-2 text-right text-xs text-foreground font-mono tabular-nums focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-60"
                          value={r.gstRate}
                          onChange={(e) => setSizeField(r.id, "gstRate", e.target.value)}
                          disabled={disabled}
                          placeholder="0"
                        />
                      </td>
                      <td className="py-2 px-2 text-right">
                        <span
                          className={cn(
                            "font-mono text-xs tabular-nums",
                            stockWarn ? "text-destructive font-semibold" : "text-muted-foreground",
                          )}
                        >
                          {stockText}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right">
                        <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
                          {fmtMoney(r.lineTotal)}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-center">
                        {!disabled && (
                          <button
                            type="button"
                            onClick={() => removeSize(r.id)}
                            aria-label={`Remove size ${r.size}`}
                            title={`Remove size ${r.size}`}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-transparent text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Table Footer with Group Totals */}
          <div className="flex flex-wrap items-center justify-end gap-4 border-t border-border/60 bg-muted/20 px-4 py-3">

            <div className="flex items-center gap-6 text-right">
              <div>
                <span className="block text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Group Quantity
                </span>
                <span className="font-mono text-sm font-bold text-foreground tabular-nums">
                  {groupQty.toLocaleString()} unit{groupQty !== 1 ? "s" : ""}
                </span>
              </div>
              <div>
                <span className="block text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Group Total
                </span>
                <span className="font-mono text-base font-bold text-foreground tabular-nums">
                  {fmtMoney(groupTotal)}
                </span>
              </div>
            </div>
          </div>
        </section>
      ) : draftParentId && (availableColors.length === 0 || draftColor) ? (
        <div className="rounded-lg border border-dashed border-border/70 bg-muted/10 p-4 text-center">
          <p className="text-xs text-muted-foreground">
            No sizes selected. Click the size chips above to add sizes to this order group.
          </p>
        </div>
      ) : null}

      {/* Colour Change Invalidation Confirmation */}
      {confirmClearOnColorChange && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
            <div className="text-xs text-destructive">
              Some selected sizes are not available in colour "{draftColor}".
              <button
                type="button"
                onClick={confirmClearInvalid}
                className="ml-2 font-semibold underline hover:text-destructive/80"
              >
                Confirm and remove invalid sizes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
