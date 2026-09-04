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
};

/**
 * Two-step product picker used by document line editors (purchase orders,
 * purchase invoices, quotations, sales orders, sales invoices, proformas,
 * stock allocation …).
 *
 * Step 1 lists parent (top-level) SKUs. Step 2 appears only when the chosen
 * parent has colour/size child variants — the document line then references
 * the concrete variant SKU. Childless parents are selectable directly.
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
  placeholder = "Select product…",
  childPlaceholder = "Select colour / size…",
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
}) {
  // The parent the user is drilling into. Kept locally while they pick a
  // variant, because the document line doesn't change until the child lands.
  const [draftParentId, setDraftParentId] = useState("");

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

  const handleParentChange = (parentId: string) => {
    const kidList = childrenByParent.get(parentId) ?? [];
    // Switching parents invalidates the previously chosen product/variant —
    // clear the line so a stale SKU can never ride along.
    const rootOfCurrent = selected ? (selected.parent_id ?? selected.id) : "";
    if (selected && rootOfCurrent !== parentId) onChange("");
    if (kidList.length === 0) {
      // Childless parent — it IS the selectable SKU.
      onChange(parentId);
    } else {
      setDraftParentId(parentId);
    }
  };

  const variantLabel = (c: ProductVariantOption) => {
    const attrs = [c.color, c.size].filter((a): a is string => !!a && a.trim() !== "");
    return attrs.length > 0 ? attrs.join(" · ") : c.name;
  };

  const parents = products.filter((p) => !p.parent_id);

  return (
    <div className={cn("space-y-1.5", className)}>
      <SearchableSelect
        value={shownParentId}
        onChange={handleParentChange}
        disabled={disabled}
        placeholder={placeholder}
        options={parents.map((p) => {
          const count = (childrenByParent.get(p.id) ?? []).length;
          return {
            value: p.id,
            label: p.sku ? `${p.sku} · ${p.name}` : p.name,
            hint:
              count > 0
                ? `${count} variant${count > 1 ? "s" : ""} — pick colour/size below`
                : undefined,
          };
        })}
      />
      {kids.length > 0 && (
        <>
          <SearchableSelect
            value={activeChildId}
            onChange={(childId) => {
              onChange(childId);
              setDraftParentId("");
            }}
            disabled={disabled}
            placeholder={childPlaceholder}
            options={kids.map((c) => ({
              value: c.id,
              label: variantLabel(c),
              hint: c.sku ?? undefined,
            }))}
          />
          {!activeChildId && !disabled && (
            <p className="text-[10px] text-warning">
              Select a colour / size variant to add this product.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default ProductVariantPicker;
