import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api-client";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  GeneratedCodeBox,
  INP_CSS,
  ImageField,
  SkuField,
  SkuModalShell,
  SkuParentCard,
  SkuSection,
  sanitizeModel,
  type SkuMaster,
  type SkuProduct,
} from "@/components/sku-shared";
// Fixed gender codes — single definition in app.products.tsx, unchanged.
import { STANDARD_GENDERS } from "@/routes/app.products";

/* ────────────────────────────────────────────────────────────────────────────
 * Create Master SKU — premium single-page enterprise form.
 * UI redesign only: fields, Master SKU generation (AD-GENDER-CATEGORY-MODEL),
 * validation and the createHierarchy save payload are unchanged from the
 * previous SkuBuilderModal wizard.
 * ──────────────────────────────────────────────────────────────────────── */

export function MasterSkuModal({
  categories,
  genders,
  userId,
  onClose,
  onSaved,
  onAddColour,
}: {
  categories: SkuMaster[];
  genders: SkuMaster[];
  userId: string;
  onClose: () => void;
  onSaved: () => void;
  /** Continue to colour-variant creation for the newly created master. */
  onAddColour?: (master: SkuProduct) => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: "",
    categoryMasterId: "",
    genderMasterId: "",
    model: "",
    hsnCode: "",
    unitCost: "",
    unitPrice: "",
    mrp: "",
    retailerPrice: "",
    distributorPrice: "",
    ecommercePrice: "",
    gstRate: "",
    unitOfMeasure: "piece",
    image_url: "",
  });
  const [showOverrides, setShowOverrides] = useState(false);
  const [created, setCreated] = useState<{ sku: string; product: SkuProduct | null } | null>(null);
  // Category stays on the Master SKU — pick an existing one or create a new
  // name + code inline.
  const [localCategories, setLocalCategories] = useState<SkuMaster[]>(categories);
  useEffect(() => setLocalCategories(categories), [categories]);
  const [quickCat, setQuickCat] = useState({ name: "", code: "" });
  const category = localCategories.find((x) => x.id === f.categoryMasterId);
  // Gender uses fixed STANDARD_GENDERS (stored value = code, e.g. MEN).
  // Resolved to a master id at save time (auto-created on first use).
  const gender = STANDARD_GENDERS.find((x) => x.code === f.genderMasterId);
  const model = sanitizeModel(f.model);
  const parentSku =
    category && gender && model ? `AD-${gender.code}-${category.code}-${model}` : "";
  const skuCheckQ = useQuery({
    queryKey: ["check-sku", parentSku],
    queryFn: () => api.products.checkSku(parentSku),
    enabled: parentSku.length > 5,
    staleTime: 15000,
  });
  const skuTaken = !!skuCheckQ.data?.exists;
  const priceError = (() => {
    const entries: Array<[string, string]> = [
      ["Unit price", f.unitCost],
      ["Selling price", f.unitPrice],
      ["MRP", f.mrp],
      ["Retailer price", f.retailerPrice],
      ["Distributor price", f.distributorPrice],
      ["E-commerce price", f.ecommercePrice],
    ];
    for (const [label, v] of entries) {
      if (v !== "" && !(Number(v) >= 0)) return `${label} cannot be negative`;
    }
    if (f.mrp !== "" && f.unitPrice !== "" && Number(f.mrp) < Number(f.unitPrice))
      return "MRP should not be lower than Selling price";
    if (f.gstRate !== "" && !(Number(f.gstRate) >= 0)) return "GST rate cannot be negative";
    return null;
  })();
  const canCreate =
    !!f.name.trim() && !!category && !!gender && !!model && !!parentSku && !skuTaken && !priceError;

  const quickCreateCategory = useMutation({
    mutationFn: async () => {
      const createdRes: Record<string, string> = await api.skuMasters.create("category", {
        name: quickCat.name.trim(),
        code: quickCat.code,
      });
      const entry = {
        id: createdRes.id ?? createdRes._id ?? String(Date.now()),
        name: createdRes.name ?? quickCat.name.trim(),
        code: createdRes.code ?? quickCat.code,
        active: true,
      } as SkuMaster;
      setLocalCategories((prev) => [...prev, entry]);
      setF((prev) => ({ ...prev, categoryMasterId: entry.id }));
      setQuickCat({ name: "", code: "" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sku-masters", "category"] });
      toast.success("Category created & selected");
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Could not create category — code may exist"),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!gender) throw new Error("Pick a gender");
      // Ensure a gender master exists for this standard code (auto-create on
      // first use so Master SKUs always carry the fixed code).
      let genderMaster = genders.find((x) => x.code === gender.code);
      if (!genderMaster) {
        const createdRes: Record<string, string> = await api.skuMasters.create("gender", {
          name: gender.name,
          code: gender.code,
        });
        genderMaster = {
          id: createdRes.id ?? createdRes._id ?? String(Date.now()),
          name: createdRes.name ?? gender.name,
          code: createdRes.code ?? gender.code,
          active: true,
        } as SkuMaster;
        qc.invalidateQueries({ queryKey: ["sku-masters", "gender"] });
      }
      const res = (await api.products.createHierarchy({
        ...f,
        genderMasterId: genderMaster!.id,
        model,
        hsnCode: f.hsnCode.trim() || null,
        unitCost: Number(f.unitCost || 0),
        unitPrice: Number(f.unitPrice || 0),
        mrp: f.mrp === "" ? "" : Number(f.mrp),
        ecommercePrice: f.ecommercePrice === "" ? "" : Number(f.ecommercePrice),
        retailerPrice: f.retailerPrice === "" ? "" : Number(f.retailerPrice),
        distributorPrice: f.distributorPrice === "" ? "" : Number(f.distributorPrice),
        gstRate: f.gstRate === "" ? "" : Number(f.gstRate),
        image_url: f.image_url.trim() || null,
        imageUrl: f.image_url.trim() || null,
        // Master-only creation: variants are added later from the Master SKU
        // detail view ("Add colour" / size), never in this dialog.
        colorMasterIds: [],
        sizeMasterIds: [],
        disabledKeys: [],
      })) as { parent?: SkuProduct };
      return { sku: parentSku, product: res?.parent ?? null };
    },
    onSuccess: (made) => {
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.success(`Master SKU ${made.sku} created — add colours & sizes from its detail view`);
      onSaved();
      setCreated(made);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not create Master SKU"),
  });

  if (created) {
    return (
      <SkuModalShell
        title="Master SKU Created"
        subtitle="The base product SKU is ready — colours and sizes come next."
        onClose={onClose}
      >
        <div className="space-y-4 overflow-y-auto p-5 md:p-6">
          <div className="flex items-center gap-2 text-sm font-medium text-sem-success">
            <CheckCircle2 className="h-4 w-4" /> Master SKU created successfully
          </div>
          <SkuParentCard rows={[{ label: "Generated Master SKU", value: created.sku }]} />
          <p className="text-sm text-muted-foreground">Next step: Add colour and size variants.</p>
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm"
            >
              Done
            </button>
            {created.product && onAddColour && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onAddColour(created.product!);
                }}
                className="inline-flex items-center gap-2 rounded-[10px] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:-translate-y-px hover:shadow-md"
              >
                Add Colour Variant
              </button>
            )}
          </div>
        </div>
        {INP_CSS}
      </SkuModalShell>
    );
  }

  return (
    <SkuModalShell
      title="Create Master SKU"
      subtitle="Create the base product SKU before adding colour and size variants."
      onClose={onClose}
      wide
    >
      <div className="grid flex-1 gap-6 overflow-y-auto p-5 md:p-6 lg:grid-cols-[1fr_300px]">
        <form
          className="min-w-0 space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <SkuSection title="Product Information">
            <div className="grid gap-4 md:grid-cols-2">
              <SkuField label="Product Name" required>
                <input
                  className="sku-inp"
                  value={f.name}
                  onChange={(e) => setF({ ...f, name: e.target.value })}
                  placeholder="e.g. Essential T-Shirt"
                />
              </SkuField>
              <SkuField
                label="Model Number"
                required
                hint="Letters + digits only · becomes the MODEL part of the Master SKU"
              >
                <input
                  className="sku-inp font-mono uppercase"
                  value={f.model}
                  onChange={(e) => setF({ ...f, model: e.target.value.toUpperCase() })}
                  placeholder="ET1100"
                />
              </SkuField>
              <SkuField label="Category" required>
                <SearchableSelect
                  value={f.categoryMasterId}
                  onChange={(v) => setF({ ...f, categoryMasterId: v })}
                  placeholder="Select category…"
                  searchPlaceholder="Search categories…"
                  emptyText="No category matches"
                  options={localCategories.map((x) => ({
                    value: x.id,
                    label: `${x.name} (${x.code})`,
                    hint: x.code,
                  }))}
                />
                <div className="mt-2 grid grid-cols-[1fr_90px_auto] gap-1.5">
                  <input
                    className="sku-inp !py-1.5 text-xs"
                    value={quickCat.name}
                    onChange={(e) => setQuickCat({ ...quickCat, name: e.target.value })}
                    placeholder="New category — Hoodies"
                  />
                  <input
                    className="sku-inp !py-1.5 font-mono text-xs uppercase"
                    value={quickCat.code}
                    onChange={(e) =>
                      setQuickCat({
                        ...quickCat,
                        code: e.target.value
                          .toUpperCase()
                          .replace(/[^A-Z0-9]/g, "")
                          .slice(0, 6),
                      })
                    }
                    placeholder="HD"
                  />
                  <button
                    type="button"
                    disabled={
                      quickCreateCategory.isPending ||
                      !quickCat.name.trim() ||
                      !quickCat.code.trim()
                    }
                    onClick={() => quickCreateCategory.mutate()}
                    className="rounded-md border border-border px-2 py-1.5 text-[11px] hover:border-primary hover:text-primary disabled:opacity-50"
                  >
                    + Add
                  </button>
                </div>
              </SkuField>
              <SkuField label="Gender" required>
                <SearchableSelect
                  value={f.genderMasterId}
                  onChange={(v) => setF({ ...f, genderMasterId: v })}
                  placeholder="Search gender — e.g. Men, Women, MEN…"
                  searchPlaceholder="Type gender name or code…"
                  emptyText="No gender matches"
                  options={STANDARD_GENDERS.map((x) => ({
                    value: x.code,
                    label: `${x.name} (${x.code})`,
                    hint: `Code: ${x.code}`,
                  }))}
                />
              </SkuField>
              <SkuField
                label="HSN Code"
                hint="Printed on tax invoices · inherited by every variant"
              >
                <input
                  className="sku-inp font-mono"
                  value={f.hsnCode}
                  onChange={(e) =>
                    setF({ ...f, hsnCode: e.target.value.replace(/[^0-9]/g, "").slice(0, 8) })
                  }
                  placeholder="e.g. 64041990"
                  inputMode="numeric"
                />
              </SkuField>
              <SkuField label="Product image (optional)">
                <ImageField
                  userId={userId}
                  value={f.image_url}
                  onChange={(url) => setF({ ...f, image_url: url })}
                />
              </SkuField>
            </div>
          </SkuSection>

          <GeneratedCodeBox
            label="Generated Master SKU"
            code={parentSku}
            note="Generated automatically from the product details. Colours and sizes are added after the Master SKU is created."
            checking={skuCheckQ.isFetching}
            taken={skuTaken}
            takenHint={`Master SKU already exists: ${parentSku} — change model / category / gender.`}
          />

          <SkuSection title="Pricing">
            <div className="grid gap-4 md:grid-cols-2">
              <SkuField label="Reference Cost (₹)">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="sku-inp"
                  value={f.unitCost}
                  onChange={(e) => setF({ ...f, unitCost: e.target.value })}
                  placeholder="0.00"
                />
              </SkuField>
              <SkuField label="Selling Price (₹)">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="sku-inp"
                  value={f.unitPrice}
                  onChange={(e) => setF({ ...f, unitPrice: e.target.value })}
                  placeholder="0.00"
                />
              </SkuField>
              <SkuField label="MRP (₹)">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="sku-inp"
                  value={f.mrp}
                  onChange={(e) => setF({ ...f, mrp: e.target.value })}
                  placeholder="0.00"
                />
              </SkuField>
              <SkuField label="GST rate (%)">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="sku-inp"
                  value={f.gstRate}
                  onChange={(e) => setF({ ...f, gstRate: e.target.value })}
                  placeholder="e.g. 5"
                  list="gst-rates"
                />
                <datalist id="gst-rates">
                  <option value="0" />
                  <option value="5" />
                  <option value="12" />
                  <option value="18" />
                  <option value="28" />
                </datalist>
              </SkuField>
            </div>
            <div className="mt-3 rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setShowOverrides((v) => !v)}
                aria-expanded={showOverrides}
                className="flex w-full items-center justify-between px-3 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Channel Price Overrides
                <span className="text-[10px]">{showOverrides ? "▲" : "▼"}</span>
              </button>
              {showOverrides && (
                <div className="grid gap-4 border-t border-border p-3 md:grid-cols-3">
                  <SkuField label="Retailer Price (₹)">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="sku-inp"
                      value={f.retailerPrice}
                      onChange={(e) => setF({ ...f, retailerPrice: e.target.value })}
                      placeholder="0.00"
                    />
                  </SkuField>
                  <SkuField label="Distributor Price (₹)">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="sku-inp"
                      value={f.distributorPrice}
                      onChange={(e) => setF({ ...f, distributorPrice: e.target.value })}
                      placeholder="0.00"
                    />
                  </SkuField>
                  <SkuField label="E-commerce Price (₹)">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="sku-inp"
                      value={f.ecommercePrice}
                      onChange={(e) => setF({ ...f, ecommercePrice: e.target.value })}
                      placeholder="0.00"
                    />
                  </SkuField>
                </div>
              )}
            </div>
            {priceError ? (
              <p className="mt-3 text-xs font-medium text-destructive">{priceError}</p>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">
                Prices are stored at product level and inherited by every variant.
              </p>
            )}
          </SkuSection>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              disabled={save.isPending || !canCreate}
              className="inline-flex items-center gap-2 rounded-[10px] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:-translate-y-px hover:shadow-md disabled:opacity-60"
            >
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {save.isPending ? "Creating…" : "Create Master SKU"}
            </button>
          </div>
        </form>

        <aside className="h-fit rounded-xl border border-primary/25 bg-primary/5 p-5 lg:sticky lg:top-0">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">SKU Preview</p>
          <div className="mt-3 space-y-1.5 text-sm">
            {[
              ["Category", category ? `${category.name} (${category.code})` : "—"],
              ["Gender", gender ? `${gender.name} (${gender.code})` : "—"],
              ["Model Number", model || "—"],
            ].map(([k, v]) => (
              <p key={k} className="flex items-center justify-between gap-2 text-muted-foreground">
                {k}
                <span className="truncate font-mono font-medium text-foreground">{v}</span>
              </p>
            ))}
          </div>
          <p className="mt-3 text-[10px] uppercase tracking-widest text-muted-foreground">
            Generated Master SKU
          </p>
          <p className="mt-1 break-all font-mono text-base font-semibold text-primary">
            {parentSku || "AD-…"}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            This is what the system will generate.
          </p>
        </aside>
      </div>
      {INP_CSS}
    </SkuModalShell>
  );
}
