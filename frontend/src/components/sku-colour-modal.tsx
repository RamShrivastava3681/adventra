import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api-client";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { fmtMoney } from "@/components/ledger-ui";
import {
  GeneratedCodeBox,
  INP_CSS,
  ImageField,
  SkuField,
  SkuModalShell,
  SkuParentCard,
  SkuSection,
  numOrNull,
  type SkuMaster,
  type SkuProduct,
} from "@/components/sku-shared";
// Fixed colour codes — single definition in app.products.tsx, unchanged.
import { STANDARD_COLOURS } from "@/routes/app.products";

/* ────────────────────────────────────────────────────────────────────────────
 * Add Colour Variant — compact enterprise dialog for a colour-coded SKU
 * directly under a Master SKU.
 * UI redesign only: colour selection, colour-SKU generation
 * ({parent}-{COLOUR.code}), validation and the save payload are unchanged
 * from the previous StagedSkuModal "color" flow.
 * ──────────────────────────────────────────────────────────────────────── */

export function ColourVariantModal({
  parent,
  colors,
  takenNames,
  userId,
  onClose,
  onSaved,
  onAddSize,
}: {
  parent: SkuProduct;
  colors: SkuMaster[];
  /** Colour names already used under this parent. */
  takenNames: string[];
  userId: string;
  onClose: () => void;
  onSaved: () => void;
  /** Continue to size creation under the newly created colour variant. */
  onAddSize?: (colour: SkuProduct) => void;
}) {
  const qc = useQueryClient();
  const [masterId, setMasterId] = useState("");
  const [sku, setSku] = useState("");
  const [imageUrl, setImageUrl] = useState(parent.image_url ?? "");
  const [showOverride, setShowOverride] = useState(false);
  const [created, setCreated] = useState<{ sku: string; product: SkuProduct | null } | null>(null);
  const [localColors, setLocalColors] = useState<SkuMaster[]>(colors);
  useEffect(() => setLocalColors(colors), [colors]);
  const str = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
  const [prices, setPrices] = useState({
    unit_cost: str(parent.unit_cost),
    unit_price: str(parent.unit_price),
    mrp: str(parent.mrp),
    ecommerce_price: str(parent.ecommerce_price),
    retailer_price: str(parent.retailer_price),
    distributor_price: str(parent.distributor_price),
    gst_rate: str(parent.gst_rate),
  });
  const setP = (k: keyof typeof prices) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setPrices({ ...prices, [k]: e.target.value });

  const selectedColour = STANDARD_COLOURS.find((c) => c.code === masterId);
  const preview = sku.trim() || (selectedColour ? `${parent.sku}-${selectedColour.code}` : "");
  const dupName =
    !!selectedColour &&
    takenNames.some((n) => !!n && n.toLowerCase() === selectedColour.name.toLowerCase());

  const checkQ = useQuery({
    queryKey: ["check-sku", preview],
    queryFn: () => api.products.checkSku(preview),
    enabled: preview.length > 5,
    staleTime: 15000,
  });
  const skuTaken = !!checkQ.data?.exists;

  const priceError = (() => {
    const entries: Array<[string, string]> = [
      ["Cost", prices.unit_cost],
      ["Selling price", prices.unit_price],
      ["MRP", prices.mrp],
      ["Retailer price", prices.retailer_price],
      ["Distributor price", prices.distributor_price],
      ["E-commerce price", prices.ecommerce_price],
    ];
    for (const [label, v] of entries) {
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

  const canSave = !!selectedColour && !dupName && !!preview && !skuTaken && !priceError;

  const save = useMutation({
    mutationFn: async () => {
      if (!selectedColour) throw new Error("Pick a colour");
      if (dupName) throw new Error(`This colour already exists under ${parent.sku}`);
      const pricePayload = {
        unit_cost: numOrNull(prices.unit_cost) ?? 0,
        unit_price: numOrNull(prices.unit_price) ?? 0,
        mrp: numOrNull(prices.mrp),
        ecommerce_price: numOrNull(prices.ecommerce_price),
        retailer_price: numOrNull(prices.retailer_price),
        distributor_price: numOrNull(prices.distributor_price),
        gst_rate: numOrNull(prices.gst_rate),
      };
      // Ensure a colour master exists for this standard code (auto-create on
      // first use so SKUs always carry the fixed code).
      let master = localColors.find((x) => x.code === selectedColour.code);
      if (!master) {
        const createdRes: Record<string, string> = await api.skuMasters.create("color", {
          name: selectedColour.name,
          code: selectedColour.code,
        });
        master = {
          id: createdRes.id ?? createdRes._id ?? String(Date.now()),
          name: createdRes.name ?? selectedColour.name,
          code: createdRes.code ?? selectedColour.code,
          active: true,
        } as SkuMaster;
        setLocalColors((prev) => [...prev, master!]);
        qc.invalidateQueries({ queryKey: ["sku-masters", "color"] });
      }
      const made = (await api.products.create({
        parent_id: parent.id,
        sku_level: "color",
        color: selectedColour.name,
        color_master_id: master!.id,
        sku: sku.trim() || undefined,
        image_url: imageUrl.trim() || null,
        imageUrl: imageUrl.trim() || null,
        ...pricePayload,
      })) as SkuProduct;
      return { sku: preview, product: made ?? null };
    },
    onSuccess: (made) => {
      onSaved();
      toast.success(`Colour SKU ${made.sku} created`);
      setCreated(made);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (created) {
    return (
      <SkuModalShell
        title="Colour Variant Created"
        subtitle="The colour-coded SKU is ready — add sizes under it next."
        onClose={onClose}
      >
        <div className="space-y-4 overflow-y-auto p-5 md:p-6">
          <div className="flex items-center gap-2 text-sm font-medium text-sem-success">
            <CheckCircle2 className="h-4 w-4" /> Colour variant created successfully
          </div>
          <SkuParentCard rows={[{ label: "Generated Colour SKU", value: created.sku }]} />
          <p className="text-sm text-muted-foreground">
            Next step: Add sizes under this colour variant.
          </p>
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm"
            >
              Done
            </button>
            {created.product && onAddSize && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onAddSize(created.product!);
                }}
                className="inline-flex items-center gap-2 rounded-[10px] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:-translate-y-px hover:shadow-md"
              >
                Add Size Variant
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
      title="Add Colour Variant"
      subtitle="Add a colour variant under the selected Master SKU."
      onClose={onClose}
    >
      <form
        className="space-y-5 overflow-y-auto p-5 md:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <SkuParentCard rows={[{ label: "Master SKU", value: `${parent.sku} · ${parent.name}` }]} />
        <p className="-mt-2 text-[11px] text-muted-foreground">
          Creating a colour variant under this Master SKU. The Master SKU cannot be changed here.
        </p>

        <SkuSection title="Colour">
          <SkuField label="Select Colour" required>
            <SearchableSelect
              value={masterId}
              onChange={setMasterId}
              placeholder="Search colour — e.g. Black, Navy, BLK…"
              searchPlaceholder="Type colour name or code…"
              emptyText="No colour matches — try another name or code"
              options={STANDARD_COLOURS.map((c) => ({
                value: c.code,
                label: `${c.name} (${c.code})`,
                hint: `Code: ${c.code}`,
              }))}
            />
          </SkuField>
          {dupName && selectedColour && (
            <p className="mt-2 text-xs font-medium text-destructive">
              {selectedColour.name} already exists under {parent.sku} — pick another.
            </p>
          )}
          <div className="mt-3">
            <SkuField label="Colour image (optional — defaults to Master image)">
              <ImageField userId={userId} value={imageUrl} onChange={setImageUrl} />
            </SkuField>
          </div>
        </SkuSection>

        <GeneratedCodeBox
          label="Generated Colour SKU"
          code={preview}
          note="Generated automatically. This field cannot be edited manually."
          checking={checkQ.isFetching}
          taken={skuTaken}
          takenHint="Already exists — pick another colour."
        />

        <SkuSection title="Inherited Pricing">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[13px] md:grid-cols-4">
            <span className="text-muted-foreground">Cost</span>
            <span className="text-right">{fmtMoney(parent.unit_cost)}</span>
            <span className="text-muted-foreground">Selling</span>
            <span className="text-right">{fmtMoney(parent.unit_price)}</span>
            <span className="text-muted-foreground">MRP</span>
            <span className="text-right">{parent.mrp ? fmtMoney(parent.mrp) : "—"}</span>
            <span className="text-muted-foreground">GST</span>
            <span className="text-right">
              {parent.gst_rate !== null && parent.gst_rate !== undefined
                ? `${parent.gst_rate}%`
                : "—"}
            </span>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">Inherited from Master SKU</p>
          <div className="mt-3 rounded-lg border border-border">
            <button
              type="button"
              onClick={() => setShowOverride((v) => !v)}
              aria-expanded={showOverride}
              className="flex w-full items-center justify-between px-3 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Override price for this colour
              <span className="text-[10px]">{showOverride ? "▲" : "▼"}</span>
            </button>
            {showOverride && (
              <div className="grid gap-4 border-t border-border p-3 md:grid-cols-3">
                <SkuField label="Selling Price Override (₹)">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="sku-inp"
                    value={prices.unit_price}
                    onChange={setP("unit_price")}
                  />
                </SkuField>
                <SkuField label="MRP Override (₹)">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="sku-inp"
                    value={prices.mrp}
                    onChange={setP("mrp")}
                  />
                </SkuField>
                <SkuField label="Reference Cost Override (₹)">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="sku-inp"
                    value={prices.unit_cost}
                    onChange={setP("unit_cost")}
                  />
                </SkuField>
                <SkuField label="Retailer Price Override (₹)">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="sku-inp"
                    value={prices.retailer_price}
                    onChange={setP("retailer_price")}
                  />
                </SkuField>
                <SkuField label="Distributor Price Override (₹)">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="sku-inp"
                    value={prices.distributor_price}
                    onChange={setP("distributor_price")}
                  />
                </SkuField>
                <SkuField label="E-commerce Price Override (₹)">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="sku-inp"
                    value={prices.ecommerce_price}
                    onChange={setP("ecommerce_price")}
                  />
                </SkuField>
                <SkuField label="GST Override (%)">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="sku-inp"
                    value={prices.gst_rate}
                    onChange={setP("gst_rate")}
                  />
                </SkuField>
              </div>
            )}
          </div>
          {priceError && <p className="mt-2 text-xs font-medium text-destructive">{priceError}</p>}
        </SkuSection>

        {selectedColour && (
          <div className="rounded-xl border border-border bg-muted/30 p-4 text-[13px]">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              <span className="text-muted-foreground">Master SKU</span>
              <span className="break-all text-right font-mono">{parent.sku}</span>
              <span className="text-muted-foreground">Colour</span>
              <span className="text-right font-medium">{selectedColour.name}</span>
              <span className="text-muted-foreground">Colour Code</span>
              <span className="text-right font-mono">{selectedColour.code}</span>
              <span className="text-muted-foreground">Generated Colour SKU</span>
              <span className="break-all text-right font-mono font-semibold text-primary">
                {preview || "—"}
              </span>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            disabled={save.isPending || !canSave}
            className="inline-flex items-center gap-2 rounded-[10px] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:-translate-y-px hover:shadow-md disabled:opacity-60"
          >
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {save.isPending ? "Creating…" : "Create Colour Variant"}
          </button>
        </div>
      </form>
      {INP_CSS}
    </SkuModalShell>
  );
}
