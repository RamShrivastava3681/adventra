import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api-client";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { fmtMoney } from "@/components/ledger-ui";
import {
  GeneratedCodeBox,
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
 * Add Size Variant — the final sellable SKU under a colour variant.
 * A size is ALWAYS created under a colour variant; Master → Size is not a
 * valid path (enforced by the entry points and the backend — this dialog
 * only ever receives a colour-variant parent).
 * UI redesign only: size selection, sellable-SKU generation
 * ({colourSku}-{SIZE.code}), validation and the save payload are unchanged
 * from the previous StagedSkuModal "size" flow.
 * ──────────────────────────────────────────────────────────────────────── */

export function SellableSkuModal({
  parent,
  masterSku,
  sizes,
  takenNames,
  onClose,
  onSaved,
  onViewSku,
}: {
  /** The colour variant this sellable SKU is created under (read-only). */
  parent: SkuProduct;
  /** Grandparent Master SKU code for the hierarchy card. */
  masterSku?: string;
  sizes: SkuMaster[];
  /** Size names already used under this parent. */
  takenNames: string[];
  onClose: () => void;
  onSaved: () => void;
  /** Open the existing SKU view after creation (optional). */
  onViewSku?: () => void;
}) {
  const qc = useQueryClient();
  const [masterId, setMasterId] = useState("");
  const [sku, setSku] = useState("");
  // Size is the code — single box, no sizing system.
  const [quickSize, setQuickSize] = useState("");
  const [showOverride, setShowOverride] = useState(false);
  const [created, setCreated] = useState<{ sku: string; product: SkuProduct | null } | null>(null);
  // Bulk mode: tick many sizes and create all their SKUs in one submit.
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkIds, setBulkIds] = useState<string[]>([]);
  const [addInitialStock, setAddInitialStock] = useState(false);
  const [stockQty, setStockQty] = useState("");
  const [stockWarehouse, setStockWarehouse] = useState("");
  const [stockNotes, setStockNotes] = useState("");
  const [createdBulk, setCreatedBulk] = useState<{
    created: SkuProduct[];
    skipped: Array<{ size: string; reason: string }>;
  } | null>(null);
  const [localSizes, setLocalSizes] = useState<SkuMaster[]>(sizes);
  useEffect(() => setLocalSizes(sizes), [sizes]);
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

  const selectedSize = localSizes.find((x) => x.id === masterId);
  const preview = sku.trim() || (selectedSize ? `${parent.sku}-${selectedSize.code}` : "");
  const sizeTaken = (name: string) =>
    takenNames.some((n) => !!n && n.toLowerCase() === name.toLowerCase());
  const dupName = !!selectedSize && sizeTaken(selectedSize.name);
  // Sizes ticked in bulk mode that aren't already present under this colour.
  const bulkChosen = localSizes.filter(
    (x) => bulkIds.includes(x.id) && !sizeTaken(x.name),
  );

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

  const canSave = !!selectedSize && !dupName && !!preview && !skuTaken && !priceError && (!addInitialStock || (Number(stockQty) > 0 && !!stockNotes.trim()));

  const save = useMutation({
    mutationFn: async () => {
      if (!selectedSize) throw new Error("Pick a size");
      if (dupName) throw new Error(`This size already exists under ${parent.sku}`);
      if (addInitialStock) {
        if (!stockQty || !(Number(stockQty) > 0)) throw new Error("Enter a valid stock quantity greater than zero");
        if (!stockNotes.trim()) throw new Error("Stock source / notes are required for manual stock addition");
      }
      const pricePayload = {
        unit_cost: numOrNull(prices.unit_cost) ?? 0,
        unit_price: numOrNull(prices.unit_price) ?? 0,
        mrp: numOrNull(prices.mrp),
        ecommerce_price: numOrNull(prices.ecommerce_price),
        retailer_price: numOrNull(prices.retailer_price),
        distributor_price: numOrNull(prices.distributor_price),
        gst_rate: numOrNull(prices.gst_rate),
      };
      const made = (await api.products.create({
        parent_id: parent.id,
        sku_level: "variant",
        size: selectedSize.name,
        size_master_id: selectedSize.id,
        color: parent.color,
        color_master_id: parent.color_master_id ?? parent.colorMasterId ?? null,
        sku: sku.trim() || undefined,
        ...pricePayload,
      })) as SkuProduct;

      if (addInitialStock && Number(stockQty) > 0 && made?.id) {
        try {
          await api.stockMovements.manual({
            productId: made.id,
            quantity: Number(stockQty),
            direction: "in",
            reason: "Manual addition",
            notes: stockNotes.trim(),
            warehouse: stockWarehouse.trim() || undefined,
            status: "confirmed",
          });
          qc.invalidateQueries({ queryKey: ["stock-movements"] });
          qc.invalidateQueries({ queryKey: ["inventory"] });
        } catch (stockErr: any) {
          toast.error("SKU created, but initial stock addition failed: " + (stockErr?.message || "Error"));
        }
      }

      return { sku: preview, product: made ?? null };
    },
    onSuccess: (made) => {
      onSaved();
      toast.success(`Size SKU ${made.sku} created${addInitialStock && Number(stockQty) > 0 ? ` with ${stockQty} initial stock` : ""}`);
      setCreated(made);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const quickCreate = useMutation({
    mutationFn: async () => {
      // Size = code — single box. Code is derived from the typed size.
      const name = quickSize.trim();
      if (!name) throw new Error("Enter a size");
      const code =
        name
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "")
          .slice(0, 10) || name.toUpperCase().slice(0, 10);
      const createdRes: Record<string, string> = await api.skuMasters.create("size", {
        name,
        code,
      });
      const entry = {
        id: createdRes.id ?? String(Date.now()),
        name: createdRes.name ?? name,
        code: createdRes.code ?? code,
        active: true,
      } as SkuMaster;
      setLocalSizes((prev) => [...prev, entry]);
      setMasterId(entry.id);
      setBulkIds((prev) => (prev.includes(entry.id) ? prev : [...prev, entry.id]));
      setQuickSize("");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sku-masters", "size"] });
      toast.success("Master created & selected");
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Could not create master — code may exist"),
  });

  const saveBulk = useMutation({
    mutationFn: async () => {
      if (bulkChosen.length === 0) throw new Error("Tick at least one size");
      return api.products.bulkVariants({
        colourProductId: parent.id,
        sizes: bulkChosen.map((x) => x.name),
        sizeMasterIds: bulkChosen.map((x) => x.id),
      });
    },
    onSuccess: (res) => {
      onSaved();
      const n = res.created?.length ?? 0;
      const s = res.skipped?.length ?? 0;
      toast.success(
        `${n} size SKU${n === 1 ? "" : "s"} created${s ? ` · ${s} skipped` : ""}`,
      );
      setCreatedBulk({ created: res.created ?? [], skipped: res.skipped ?? [] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const colourCode =
    STANDARD_COLOURS.find((c) => c.name.toLowerCase() === (parent.color ?? "").toLowerCase())
      ?.code ?? "—";

  if (created) {
    return (
      <SkuModalShell
        title="Sellable SKU Created"
        subtitle="The final operational SKU is ready."
        onClose={onClose}
      >
        <div className="space-y-4 overflow-y-auto p-5 md:p-6">
          <div className="flex items-center gap-2 text-sm font-medium text-sem-success">
            <CheckCircle2 className="h-4 w-4" /> Sellable SKU created successfully
          </div>
          <SkuParentCard rows={[{ label: "Generated Sellable SKU", value: created.sku }]} />
          <p className="text-sm text-muted-foreground">
            Ready for inventory, sales, dispatch and forecasting.
          </p>
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm"
            >
              Done
            </button>
            {onViewSku && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onViewSku();
                }}
                className="inline-flex items-center gap-2 rounded-[10px] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:-translate-y-px hover:shadow-md"
              >
                View SKU
              </button>
            )}
          </div>
        </div>
      </SkuModalShell>
    );
  }

  if (createdBulk) {
    return (
      <SkuModalShell
        title="Size SKUs Created"
        subtitle="Bulk size creation finished."
        onClose={onClose}
      >
        <div className="space-y-4 overflow-y-auto p-5 md:p-6">
          <div className="flex items-center gap-2 text-sm font-medium text-sem-success">
            <CheckCircle2 className="h-4 w-4" /> {createdBulk.created.length} size SKU
            {createdBulk.created.length === 1 ? "" : "s"} created
          </div>
          {createdBulk.created.length > 0 && (
            <SkuParentCard
              rows={createdBulk.created.map((p) => ({
                label: `${p.color ?? ""}${p.size ? ` / ${p.size}` : ""}`.trim() || p.sku,
                value: p.sku,
              }))}
            />
          )}
          {createdBulk.skipped.length > 0 && (
            <div className="rounded-lg border border-sem-attention/40 bg-sem-attention/10 p-3">
              <p className="mb-1 text-xs font-medium text-sem-attention">
                Skipped ({createdBulk.skipped.length})
              </p>
              <ul className="space-y-0.5 text-[11px] text-sem-attention">
                {createdBulk.skipped.map((s) => (
                  <li key={s.size}>
                    {s.size} — {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm"
            >
              Done
            </button>
            {onViewSku && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onViewSku();
                }}
                className="inline-flex items-center gap-2 rounded-[10px] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:-translate-y-px hover:shadow-md"
              >
                View SKUs
              </button>
            )}
          </div>
        </div>
      </SkuModalShell>
    );
  }

  return (
    <SkuModalShell
      title="Add Size Variant"
      subtitle="Create a sellable SKU under the selected colour variant."
      onClose={onClose}
    >
      <form
        className="space-y-5 overflow-y-auto p-5 md:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (bulkMode) saveBulk.mutate();
          else save.mutate();
        }}
      >
        <SkuParentCard
          rows={[
            { label: "Master SKU", value: masterSku ?? parent.sku },
            {
              label: "Colour Variant",
              value: `${parent.sku}${parent.color ? ` · ${parent.color}` : ""}`,
            },
            { label: "New Sellable SKU", value: preview || "Select a size below" },
          ]}
        />
        <p className="-mt-2 text-[11px] text-muted-foreground">
          Master SKU → Colour Variant → Sellable SKU. The parents cannot be changed here, and no
          further SKU can be created beneath a Sellable SKU.
        </p>

        <SkuSection title="Size">
          <div className="mb-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setBulkMode(false)}
              className={`rounded-md border px-2.5 py-1 text-xs ${
                !bulkMode ? "border-primary text-primary" : "border-border text-muted-foreground"
              }`}
            >
              Single size
            </button>
            <button
              type="button"
              onClick={() => setBulkMode(true)}
              className={`rounded-md border px-2.5 py-1 text-xs ${
                bulkMode ? "border-primary text-primary" : "border-border text-muted-foreground"
              }`}
            >
              Add multiple sizes
            </button>
          </div>

          {bulkMode ? (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">
                  Tick every size to create under {parent.color ?? "this colour"}. Sizes already
                  present are disabled.
                </p>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setBulkIds(localSizes.filter((x) => !sizeTaken(x.name)).map((x) => x.id))
                    }
                    className="text-[11px] font-medium text-primary hover:underline"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() => setBulkIds([])}
                    className="text-[11px] font-medium text-muted-foreground hover:underline"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Size systems (EU / UK / US) are shown with the size name.
              </p>
              <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-border p-2">
                {localSizes.length === 0 ? (
                  <p className="p-2 text-xs text-muted-foreground">
                    No active size masters yet — add one below.
                  </p>
                ) : (
                  localSizes.map((x) => {
                    const taken = sizeTaken(x.name);
                    return (
                      <label
                        key={x.id}
                        className={`flex items-center gap-2 rounded-md px-2 py-1 text-sm ${
                          taken ? "opacity-50" : "cursor-pointer hover:bg-muted/40"
                        }`}
                      >
                        <input
                          type="checkbox"
                          disabled={taken}
                          checked={bulkIds.includes(x.id)}
                          onChange={(e) =>
                            setBulkIds((prev) =>
                              e.target.checked ? [...prev, x.id] : prev.filter((id) => id !== x.id),
                            )
                          }
                        />
                        <span>{x.name === x.code ? x.name : `${x.name} (${x.code})`}</span>
                        {taken && (
                          <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
                            already exists
                          </span>
                        )}
                      </label>
                    );
                  })
                )}
              </div>
              <div className="grid gap-2 rounded-lg border border-dashed border-border p-3 md:grid-cols-[1fr_auto]">
                <input
                  className="sku-inp !py-1.5 font-mono uppercase"
                  value={quickSize}
                  onChange={(e) => setQuickSize(e.target.value.toUpperCase().slice(0, 10))}
                  placeholder="New size — e.g. M, XL, 42"
                />
                <button
                  type="button"
                  disabled={quickCreate.isPending || !quickSize.trim()}
                  onClick={() => quickCreate.mutate()}
                  className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary hover:text-primary disabled:opacity-50"
                >
                  + Add & tick
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {bulkChosen.length} size{bulkChosen.length === 1 ? "" : "s"} selected
              </p>
            </div>
          ) : (
            <>
              <SkuField label="Select Size" required>
                <SearchableSelect
                  value={masterId}
                  onChange={setMasterId}
                  placeholder="Search size — e.g. S, M, L, 42…"
                  searchPlaceholder="Type size…"
                  emptyText="No size matches — add it below"
                  options={localSizes.map((x) => ({
                    value: x.id,
                    label: x.name === x.code ? x.name : `${x.name} (${x.code})`,
                    hint: `Code: ${x.code}`,
                  }))}
                />
              </SkuField>
              <div className="mt-3 grid gap-2 rounded-lg border border-dashed border-border p-3 md:grid-cols-[1fr_auto]">
                <input
                  className="sku-inp !py-1.5 font-mono uppercase"
                  value={quickSize}
                  onChange={(e) => setQuickSize(e.target.value.toUpperCase().slice(0, 10))}
                  placeholder="New size — e.g. M, XL, 42"
                />
                <button
                  type="button"
                  disabled={quickCreate.isPending || !quickSize.trim()}
                  onClick={() => quickCreate.mutate()}
                  className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary hover:text-primary disabled:opacity-50"
                >
                  + Add & select
                </button>
              </div>
              {dupName && selectedSize && (
                <p className="mt-2 text-xs font-medium text-destructive">
                  {selectedSize.name} already exists under {parent.sku} — pick another.
                </p>
              )}
            </>
          )}
        </SkuSection>

        {!bulkMode && (
          <GeneratedCodeBox
            label="Generated Sellable SKU"
            code={preview}
            note="This final SKU is used for inventory, sales, dispatch and forecasting."
            checking={checkQ.isFetching}
            taken={skuTaken}
            takenHint="This Sellable SKU already exists."
            large
          />
        )}

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
          <p className="mt-2 text-[11px] text-muted-foreground">
            Inherited from Colour Variant / Master SKU
          </p>
          <div className="mt-3 rounded-lg border border-border">
            <button
              type="button"
              onClick={() => setShowOverride((v) => !v)}
              aria-expanded={showOverride}
              className="flex w-full items-center justify-between px-3 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Override price for this sellable SKU
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

        {!bulkMode && (
          <SkuSection title="Manual Stock Addition (Optional)">
            <label className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={addInitialStock}
                onChange={(e) => setAddInitialStock(e.target.checked)}
                className="rounded border-border text-primary focus:ring-primary"
              />
              <span>Manually add opening / non-procurement stock for this SKU</span>
            </label>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Add initial inventory when stock does not arrive via the Procurement cycle. Maintains full stock source and audit history.
            </p>
            {addInitialStock && (
              <div className="mt-3 grid gap-3 rounded-lg border border-border bg-card p-3 md:grid-cols-2">
                <SkuField label="Quantity to Add *" required>
                  <input
                    type="number"
                    min="1"
                    required
                    placeholder="e.g. 50"
                    className="sku-inp font-mono"
                    value={stockQty}
                    onChange={(e) => setStockQty(e.target.value)}
                  />
                </SkuField>
                <SkuField label="Warehouse / Location (Optional)">
                  <input
                    type="text"
                    placeholder="e.g. Central Warehouse"
                    className="sku-inp"
                    value={stockWarehouse}
                    onChange={(e) => setStockWarehouse(e.target.value)}
                  />
                </SkuField>
                <div className="md:col-span-2">
                  <SkuField label="Stock Source / Notes *" required>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Opening balance / Sample stock / Direct factory intake"
                      className="sku-inp"
                      value={stockNotes}
                      onChange={(e) => setStockNotes(e.target.value)}
                    />
                  </SkuField>
                </div>
              </div>
            )}
          </SkuSection>
        )}

        {!bulkMode && selectedSize && (
          <div className="rounded-xl border border-border bg-muted/30 p-4 text-[13px]">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              <span className="text-muted-foreground">Master SKU</span>
              <span className="break-all text-right font-mono">{masterSku ?? "—"}</span>
              <span className="text-muted-foreground">Colour</span>
              <span className="text-right font-medium">{parent.color ?? "—"}</span>
              <span className="text-muted-foreground">Colour Code</span>
              <span className="text-right font-mono">{colourCode}</span>
              <span className="text-muted-foreground">Size</span>
              <span className="text-right font-medium">{selectedSize.name}</span>
              <span className="text-muted-foreground">Sellable SKU</span>
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
            disabled={bulkMode ? saveBulk.isPending || bulkChosen.length === 0 : save.isPending || !canSave}
            className="inline-flex items-center gap-2 rounded-[10px] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:-translate-y-px hover:shadow-md disabled:opacity-60"
          >
            {(bulkMode ? saveBulk.isPending : save.isPending) && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            {bulkMode
              ? saveBulk.isPending
                ? "Creating…"
                : `Create ${bulkChosen.length || ""} Size SKU${bulkChosen.length === 1 ? "" : "s"}`
              : save.isPending
                ? "Creating…"
                : "Create Sellable SKU"}
          </button>
        </div>
      </form>
    </SkuModalShell>
  );
}
