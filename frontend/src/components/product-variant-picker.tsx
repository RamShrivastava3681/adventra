import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { SearchableSelect } from "@/components/ui/searchable-select";

export type ProductVariantOption = {
  id: string;
  sku?: string | null;
  name: string;
  color?: string | null;
  size?: string | null;
  parent_id?: string | null;
  category?: string | null;
  subcategory?: string | null;
  brand?: string | null;
  gender?: string | null;
  model?: string | null;
};

function clean(v: unknown): string {
  return typeof v === "string" ? v.trim() : v != null ? String(v).trim() : "";
}

/**
 * Complete, human-readable item name. The catalogue `name` is the base; brand,
 * model, gender and subcategory are appended only when they add information
 * not already contained in the name, so long names stay fully visible without
 * duplicated fragments (e.g. "Nike AirMax Airmax-2024 Men Running").
 */
export function fullItemName(p: Pick<ProductVariantOption, "name" | "brand" | "model" | "gender" | "subcategory" | "color" | "size">): string {
  const base = clean(p.name) || "Unnamed item";
  const extras: string[] = [];
  const lower = ` ${base.toLowerCase()} `;
  for (const raw of [p.brand, p.model, p.gender, p.subcategory]) {
    const v = clean(raw);
    if (v && !lower.includes(` ${v.toLowerCase()} `)) extras.push(v);
  }
  const attrs = [clean(p.color), clean(p.size)].filter(Boolean);
  const head = extras.length > 0 ? `${base} — ${extras.join(" · ")}` : base;
  return attrs.length > 0 ? `${head} (${attrs.join(" / ")})` : head;
}

/**
 * Compact variant label — colour + size only (e.g. "Black / 42"). Used wherever
 * a sellable SKU is listed in the picker or a document line; brand, model,
 * gender, subcategory and the parent name stay on master rows and stored
 * document snapshots.
 */
export function variantShortLabel(
  c: Pick<ProductVariantOption, "color" | "size">,
): string {
  const attrs = [clean(c.color), clean(c.size)].filter(Boolean);
  return attrs.length > 0 ? attrs.join(" / ") : "Unnamed variant";
}

/**
 * Two-step product picker used by document line editors (purchase orders,
 * sales orders, invoices, proformas, stock allocation …).
 *
 * Step 1 — Category: an explicit, always-visible category dropdown narrows the
 * catalogue to one family (Footwear, Apparel, …). Step 2 — Item: the filtered
 * parents are listed with their COMPLETE names (brand + name + model + gender
 * + subcategory, never truncated) plus SKU. Step 3 appears only when the
 * chosen parent has colour/size child variants.
 *
 * The document line only changes once a concrete, sellable SKU is chosen
 * (a childless parent, or a child variant) — never mid-drill-down.
 */
export function ProductVariantPicker({
  products,
  value,
  onChange,
  disabled,
  className,
  placeholder = "Select item…",
  childPlaceholder = "Select colour / size…",
  category,
  onCategoryChange,
  showLabels = true,
  categoryPlaceholder = "Select category…",
  layout = "stacked",
  categoryCompact = false,
}: {
  products: ProductVariantOption[];
  /** The line's current product id (a variant's id, a childless parent's id, or ""). */
  value: string;
  /** Fired with the concrete SKU to snapshot into the line ("" when a stale selection is cleared). */
  onChange: (productId: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  childPlaceholder?: string;
  /** Optional controlled category filter — when set, only parents in this category are listed. */
  category?: string;
  onCategoryChange?: (category: string) => void;
  /** Show small "Category" / "Item" labels above each dropdown (default true). */
  showLabels?: boolean;
  categoryPlaceholder?: string;
  /** Use side-by-side category/item fields inside document line editors. */
  layout?: "stacked" | "inline";
  /**
   * Render the category dropdown as a compact single-line (h-9, truncated)
   * control instead of the wrapping full-label style, so it stays the same
   * height as the other boxes. Opt-in — other pages keep the current look.
   */
  categoryCompact?: boolean;
}) {
  // The parent the user is drilling into. Kept locally while they pick a
  // variant, because the document line doesn't change until the child lands.
  const [draftParentId, setDraftParentId] = useState("");
  const [draftColor, setDraftColor] = useState("");

  const byId = useMemo(() => {
    const m = new Map<string, ProductVariantOption>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);

  const childrenByParent = useMemo(() => {
    const m = new Map<string, ProductVariantOption[]>();
    for (const p of products) {
      if (p.parent_id) {
        const list = m.get(p.parent_id) ?? [];
        list.push(p);
        m.set(p.parent_id, list);
      }
    }
    return m;
  }, [products]);

  // Resolve the line's current product back to its root parent — a variant
  // resolves to its parent, a top-level SKU resolves to itself.
  const selected = value ? byId.get(value) : undefined;
  const derivedParentId = selected ? (selected.parent_id ?? selected.id) : "";
  const shownParentId = draftParentId || derivedParentId;

  const kids = (shownParentId ? childrenByParent.get(shownParentId) : undefined) ?? [];
  const activeChildId = value && byId.get(value)?.parent_id === shownParentId ? value : "";
  const activeKid = value ? byId.get(value) : undefined;
  const currentKidColor = activeKid && activeKid.parent_id === shownParentId ? clean(activeKid.color) : "";
  const effectiveColor = currentKidColor || draftColor;

  // When the line's value becomes a product that sits under a DIFFERENT parent
  // than the in-progress draft, the draft is resolved — drop it so the picker
  // mirrors the document line again. An empty value keeps the draft alive
  // (the user is still choosing a variant).
  useEffect(() => {
    if (!value) return;
    const sel = byId.get(value);
    const root = sel ? (sel.parent_id ?? sel.id) : "";
    setDraftParentId((d) => (d && root !== d ? "" : d));
  }, [value, byId]);

  const availableColors = useMemo(() => {
    const set = new Set<string>();
    for (const k of kids) {
      const c = clean(k.color);
      if (c) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [kids]);

  const availableSizes = useMemo(() => {
    const set = new Set<string>();
    for (const k of kids) {
      const s = clean(k.size);
      if (s) set.add(s);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [kids]);

  const hasBothColorAndSize = availableColors.length > 0 && availableSizes.length > 0;

  // Filter available variant options based on the chosen colour
  const kidsForColor = useMemo(() => {
    if (!effectiveColor) return kids;
    return kids.filter((k) => clean(k.color).toLowerCase() === effectiveColor.toLowerCase());
  }, [kids, effectiveColor]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      // Category lives on parents; fall back to any row carrying one so the
      // filter is never empty when only variants carry it.
      const c = clean(p.category);
      if (c) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [products]);

  // Count parents per category for the "Category (n)" affordance.
  const parentCountByCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products) {
      if (p.parent_id) continue;
      const c = clean(p.category);
      if (!c) continue;
      m.set(c, (m.get(c) ?? 0) + 1);
    }
    return m;
  }, [products]);

  const [innerCategory, setInnerCategory] = useState("");
  const activeCategory = category ?? innerCategory;
  const setActiveCategory = onCategoryChange ?? setInnerCategory;

  // If the active category disappears from the catalogue (or was set for a
  // different product list), clear it rather than showing an empty item list.
  useEffect(() => {
    if (activeCategory && !categories.includes(activeCategory)) setActiveCategory("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories.join("|")]);

  // Switching categories invalidates a parent from another category — clear
  // the in-progress draft and the line so a stale SKU can never ride along.
  const handleCategoryChange = (next: string) => {
    setActiveCategory(next);
    setDraftParentId("");
    setDraftColor("");
    if (selected && clean(selected.category) !== "" && clean(selected.category) !== next && next !== "") {
      // The selected parent's own category decides; variants inherit it.
      const root = selected.parent_id ? byId.get(selected.parent_id) : selected;
      const rootCat = clean(root?.category ?? selected.category);
      if (rootCat !== next) onChange("");
    } else if (next === "") {
      // "All categories" keeps the current pick — nothing to clear.
    }
  };

  const handleParentChange = (parentId: string) => {
    const kidList = childrenByParent.get(parentId) ?? [];
    // Switching parents invalidates the previously chosen product/variant —
    // clear the line so a stale SKU can never ride along.
    const rootOfCurrent = selected ? (selected.parent_id ?? selected.id) : "";
    if (selected && rootOfCurrent !== parentId) onChange("");
    setDraftColor("");
    if (kidList.length === 0) {
      // Childless parent — it IS the selectable SKU.
      onChange(parentId);
    } else {
      setDraftParentId(parentId);
    }
  };

  const parents = useMemo(() => {
    const list = products.filter(
      (p) => !p.parent_id && (!activeCategory || clean(p.category) === activeCategory),
    );
    return [...list].sort((a, b) =>
      fullItemName(a).localeCompare(fullItemName(b), undefined, { sensitivity: "base" }),
    );
  }, [products, activeCategory]);

  const labelCls = "mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground";
  const layoutClass =
    layout === "inline"
      ? cn(
          "grid w-full min-w-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.3fr)]",
          kids.length > 0 && !hasBothColorAndSize && "2xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_minmax(0,1fr)]",
          kids.length > 0 && hasBothColorAndSize && "2xl:grid-cols-[minmax(0,0.7fr)_minmax(0,1.1fr)_minmax(0,0.75fr)_minmax(0,0.75fr)]",
        )
      : "space-y-1.5";

  return (
    <div className={cn(layoutClass, className)}>
      {/* Step 1 — Category: always visible when the catalogue has categories so
          every line starts by narrowing to one family. */}
      {categories.length > 0 && (
        <div className="w-full min-w-0">
          {showLabels && <span className={labelCls}>Category</span>}
          <SearchableSelect
            value={activeCategory ?? ""}
            onChange={handleCategoryChange}
            disabled={disabled}
            placeholder={categoryPlaceholder}
            searchPlaceholder="Search categories…"
            fullLabel={!categoryCompact}
            triggerClassName={categoryCompact ? "h-9" : undefined}
            options={[
              { value: "", label: "All categories", hint: `${products.filter((p) => !p.parent_id).length} items` },
              ...categories.map((c) => ({
                value: c,
                label: c,
                hint:
                  parentCountByCategory.get(c) != null
                    ? `${parentCountByCategory.get(c)} item${parentCountByCategory.get(c) === 1 ? "" : "s"}`
                    : undefined,
              })),
            ]}
          />
        </div>
      )}
      {/* Step 2 — Item: filtered parents with COMPLETE names (never truncated)
          and SKU + category as the secondary line. */}
      <div className="w-full min-w-0">
        {showLabels && (
          <span className={labelCls}>
            Item
            {activeCategory ? <span className="normal-case text-muted-foreground/80"> · {activeCategory}</span> : null}
          </span>
        )}
        <SearchableSelect
          value={shownParentId}
          onChange={handleParentChange}
          disabled={disabled}
          placeholder={placeholder}
          searchPlaceholder="Type any word of the full item name, SKU or category…"
          fullLabel
          options={parents.map((p) => {
            const count = (childrenByParent.get(p.id) ?? []).length;
            const cat = clean(p.category);
            const sub = clean((p as ProductVariantOption).subcategory);
            return {
              value: p.id,
              // Complete name first so typing any word of it matches.
              label: fullItemName(p),
              hint: [
                p.sku ? `SKU ${p.sku}` : null,
                cat || null,
                sub && sub.toLowerCase() !== cat.toLowerCase() ? sub : null,
                count > 0 ? `${count} variant${count > 1 ? "s" : ""} — pick colour/size below` : null,
              ]
                .filter(Boolean)
                .join(" · ") || undefined,
            };
          })}
        />
      </div>
      {kids.length > 0 && hasBothColorAndSize ? (
        <>
          {/* Step 3a — Colour dropdown: filters available size variants */}
          <div className="w-full min-w-0">
            {showLabels && <span className={labelCls}>Colour</span>}
            <SearchableSelect
              value={effectiveColor}
              onChange={(color) => {
                setDraftColor(color);
                // If current selected product does not belong to this new colour, clear it
                if (activeKid && clean(activeKid.color).toLowerCase() !== color.toLowerCase()) {
                  onChange("");
                }
              }}
              disabled={disabled}
              placeholder="Select colour…"
              searchPlaceholder="Type colour…"
              fullLabel
              options={availableColors.map((col) => {
                const count = kids.filter((k) => clean(k.color).toLowerCase() === col.toLowerCase()).length;
                return {
                  value: col,
                  label: col,
                  hint: `${count} size${count === 1 ? "" : "s"} available`,
                };
              })}
            />
          </div>

          {/* Step 3b — Size dropdown: dynamically filtered by the selected colour */}
          <div className="w-full min-w-0">
            {showLabels && <span className={labelCls}>Size</span>}
            <SearchableSelect
              value={activeChildId}
              onChange={(childId) => {
                onChange(childId);
                setDraftParentId("");
              }}
              disabled={disabled || !effectiveColor}
              placeholder={!effectiveColor ? "Select colour first…" : "Select size…"}
              searchPlaceholder="Type size…"
              fullLabel
              options={kidsForColor
                .sort((a, b) => (clean(a.size) || "").localeCompare(clean(b.size) || "", undefined, { numeric: true, sensitivity: "base" }))
                .map((c) => ({
                  value: c.id,
                  label: clean(c.size) || variantShortLabel(c),
                  hint: [clean(c.color), c.sku ? `SKU ${c.sku}` : null].filter(Boolean).join(" · ") || undefined,
                }))}
            />
            {!activeChildId && !disabled && (
              <p className="mt-1 text-[10px] text-sem-attention">
                {!effectiveColor
                  ? "Item ✓ — select a colour first to see available sizes."
                  : "Colour ✓ — now select a size to add this product."}
              </p>
            )}
          </div>
        </>
      ) : kids.length > 0 ? (
        <div className="w-full min-w-0">
          {showLabels && (
            <span className={labelCls}>
              {availableColors.length > 0 ? "Colour" : availableSizes.length > 0 ? "Size" : "Variant"}
            </span>
          )}
          <SearchableSelect
            value={activeChildId}
            onChange={(childId) => {
              onChange(childId);
              setDraftParentId("");
            }}
            disabled={disabled}
            placeholder={childPlaceholder}
            searchPlaceholder="Type colour or size…"
            fullLabel
            options={[...kids]
              .sort((a, b) => variantShortLabel(a).localeCompare(variantShortLabel(b), undefined, { sensitivity: "base" }))
              .map((c) => ({
                value: c.id,
                label: variantShortLabel(c),
                hint: c.sku ? `SKU ${c.sku}` : undefined,
              }))}
          />
          {!activeChildId && !disabled && (
            <p className="mt-1 text-[10px] text-sem-attention">
              Category ✓ · Item ✓ — now select a variant to add this product.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default ProductVariantPicker;
