import { useRef, useState } from "react";
import { Copy, Image as ImageIcon, ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { useSignedImageUrl, s3KeyFromUrl } from "@/lib/s3-image";

/* ────────────────────────────────────────────────────────────────────────────
 * Shared building blocks for the three SKU creation dialogs:
 *   MasterSkuModal → ColourVariantModal → SellableSkuModal
 * SKU generation, validation, payloads and hierarchy rules live in the
 * existing product flow — this file only holds shared presentation, the
 * fixed palettes and the pure helpers the modals need.
 * ──────────────────────────────────────────────────────────────────────── */

export type SkuMaster = {
  id: string;
  name: string;
  code: string;
  active: boolean;
  size_system?: string | null;
};

/** Structural shape of a product row as used by the SKU modals. */
export type SkuProduct = {
  id: string;
  parent_id: string | null;
  sku: string;
  name: string;
  category: string | null;
  gender: string | null;
  color: string | null;
  color_master_id?: string | null;
  colorMasterId?: string | null;
  size: string | null;
  model: string | null;
  unit_cost: number;
  unit_price: number;
  mrp: number | null;
  ecommerce_price: number | null;
  retailer_price: number | null;
  distributor_price: number | null;
  gst_rate: number | null;
  image_url: string | null;
};

/** Fixed colour/gender codes live in app.products.tsx (STANDARD_COLOURS /
 * STANDARD_GENDERS) and are imported by the SKU modals from there. */

/** Model numbers are uppercase alphanumeric only (existing rule). */
export function sanitizeModel(v: string): string {
  return v
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

export function numOrNull(s: string): number | null {
  if (s === "" || s === null || s === undefined) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function copySku(sku: string, label = "SKU copied"): void {
  if (!sku) return;
  navigator.clipboard.writeText(sku);
  toast.success(label);
}

/** Literal swatch for each standard colour name (case-insensitive).
 *  Multi/assorted entries use gradients; unknown names fall back to grey. */
const COLOUR_HEX: Record<string, string> = {
  black: "#191919",
  white: "#FFFFFF",
  grey: "#9AA0A6",
  charcoal: "#36454F",
  silver: "#C7CDD4",
  blue: "#2563EB",
  "navy blue": "#1E2A5A",
  "royal blue": "#4169E1",
  "sky blue": "#7EC8E3",
  "ice blue": "#D8EAF7",
  teal: "#0E7C7B",
  turquoise: "#3ED3C5",
  green: "#22994F",
  "olive green": "#7A7A1E",
  "forest green": "#1F7A38",
  khaki: "#C3B091",
  red: "#DC2626",
  maroon: "#7F1D1D",
  burgundy: "#7A0C2E",
  orange: "#F97316",
  yellow: "#FACC15",
  purple: "#8B5CF6",
  pink: "#F4A7C3",
  brown: "#8B5A2B",
  "coyote brown": "#81613C",
  tan: "#D2B48C",
  beige: "#EFEAD2",
  sand: "#E3D3AC",
  stone: "#8D8D8D",
  "desert sand": "#EDC9AF",
  gold: "#C9A227",
  copper: "#B87333",
  camouflage: "#78866B",
  "multi colour": "linear-gradient(135deg,#DC2626,#FACC15,#22994F,#2563EB,#8B5CF6)",
  assorted: "linear-gradient(135deg,#9AA0A6,#36454F)",
  transparent: "transparent",
};

export function colourHex(name?: string | null): string {
  if (!name) return "#9AA0A6";
  return COLOUR_HEX[name.trim().toLowerCase()] ?? "#9AA0A6";
}

/** Literal colour dot shown beside a colour name. */
export function ColourSwatch({
  colour,
  className = "",
}: {
  colour?: string | null;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      title={colour ?? undefined}
      style={{ background: colourHex(colour) }}
      className={`inline-block h-4 w-4 shrink-0 rounded-full border border-black/20 dark:border-white/25 ${className}`}
    />
  );
}

/** Form field with enterprise label + optional required indicator. */
export function SkuField({
  label,
  required = false,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-foreground">
        {label} {required && <span className="text-destructive">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** Section card with strong heading. */
export function SkuSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-muted/30 p-4 md:p-5">
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h4>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Read-only parent context card — makes the hierarchy unmistakable. */
export function SkuParentCard({ rows }: { rows: Array<{ label: string; value: string }> }) {
  return (
    <div className="rounded-xl border border-primary/25 bg-primary/5 p-4">
      {rows.map((r, i) => (
        <div key={r.label} className={i > 0 ? "mt-2 border-t border-primary/15 pt-2" : ""}>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {r.label}
          </p>
          <p className="mt-0.5 flex items-center justify-between gap-2 font-mono text-sm font-semibold text-primary">
            <span className="break-all">{r.value}</span>
            <button
              type="button"
              onClick={() => copySku(r.value, `${r.label} copied`)}
              className="shrink-0 rounded p-1 hover:bg-primary/10"
              title={`Copy ${r.label}`}
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </p>
        </div>
      ))}
    </div>
  );
}

/**
 * Prominent read-only generated-code display. Never editable —
 * the code is always produced by the existing generation logic.
 */
export function GeneratedCodeBox({
  label,
  code,
  note,
  checking = false,
  taken = false,
  takenHint = "Already exists — adjust the selection.",
  large = false,
}: {
  label: string;
  code: string;
  note?: string;
  checking?: boolean;
  taken?: boolean;
  takenHint?: string;
  large?: boolean;
}) {
  return (
    <div className="rounded-xl border border-primary/25 bg-muted/60 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </p>
        {code && (
          <button
            type="button"
            onClick={() => copySku(code)}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium text-muted-foreground hover:border-primary hover:text-primary"
          >
            <Copy className="h-3 w-3" /> Copy
          </button>
        )}
      </div>
      <p
        className={`mt-1 break-all font-mono font-semibold text-foreground ${large ? "text-xl" : "text-lg"}`}
      >
        {code || "—"}
      </p>
      {checking ? (
        <p className="mt-1 text-xs text-muted-foreground">Checking uniqueness…</p>
      ) : taken ? (
        <p className="mt-1 text-xs font-medium text-destructive">{takenHint}</p>
      ) : (
        code && <p className="mt-1 text-xs text-sem-success">Available ✓</p>
      )}
      {note && <p className="mt-1.5 text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

/** Product image upload (existing S3 flow — unchanged). */
export function ImageField({
  userId,
  value,
  onChange,
}: {
  userId: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const API_URL = import.meta.env.VITE_API_URL || "/api";
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const signed = useSignedImageUrl(value);

  const upload = async (files: FileList | null) => {
    if (!files || !files[0]) return;
    const file = files[0];
    if (!file.type.startsWith("image/")) {
      toast.error("Only image files are allowed");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5 MB");
      return;
    }
    setBusy(true);
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
      // S3 keys must live under the user's own folder — the backend rejects any
      // path that doesn't start with the user id — so scope goes INSIDE it.
      const path = `${userId}/products/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
      const formData = new FormData();
      formData.append("file", file);
      formData.append("path", path);
      formData.append("scope", "products");
      // Session auth rides on the httpOnly cookie.
      const res = await fetch(`${API_URL}/upload`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Upload failed");
      }
      const data = await res.json();
      onChange(data.url);
      toast.success("Image uploaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    // Best-effort delete of the S3 object (only when it came from our uploader).
    const key = s3KeyFromUrl(value);
    if (key) {
      try {
        await fetch(`${API_URL}/upload/${encodeURIComponent(key)}`, {
          method: "DELETE",
          credentials: "include",
        });
      } catch {
        /* ignore */
      }
    }
    onChange("");
  };

  return (
    <div className="flex items-start gap-3">
      {value && signed ? (
        <div className="relative">
          <img
            src={signed}
            alt="Product"
            className="h-20 w-20 rounded-lg border border-border object-cover"
          />
          <button
            type="button"
            onClick={remove}
            title="Remove image"
            className="absolute -right-2 -top-2 grid h-5 w-5 place-items-center rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <div className="grid h-20 w-20 place-items-center rounded-lg border border-dashed border-border bg-muted/20 text-muted-foreground">
          <ImageIcon className="h-6 w-6 opacity-50" />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            upload(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:border-primary hover:text-primary disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ImagePlus className="h-3.5 w-3.5" />
          )}
          {busy ? "Uploading…" : value ? "Replace image" : "Upload image"}
        </button>
        <SkuField label="…or paste an image URL">
          <input
            className="sku-inp !py-1.5 text-xs"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://…"
          />
        </SkuField>
      </div>
    </div>
  );
}

/** Modal shell: white card, pale blue-grey header, close button top-right. */
export function SkuModalShell({
  title,
  subtitle,
  onClose,
  wide = false,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`my-auto max-h-[92vh] w-full ${wide ? "max-w-5xl" : "max-w-2xl"} flex flex-col overflow-hidden rounded-xl border border-border bg-card`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border bg-muted/40 px-5 py-4 md:px-6">
          <div>
            <h3 className="font-display text-lg text-foreground">{title}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
