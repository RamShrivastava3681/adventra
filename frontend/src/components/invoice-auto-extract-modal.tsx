import { useState, useRef } from "react";
import {
  Sparkles,
  UploadCloud,
  FileText,
  Loader2,
  CheckCircle2,
  AlertCircle,
  X,
  Building2,
  Calendar,
  Hash,
  Layers,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api-client";
import type { DocMeta } from "@/components/document-uploader";

/** Mirrors ExtractedLineItem in backend/src/services/document-extraction.ts. */
export type ExtractedItem = {
  name: string;
  productCode?: string | null;
  hsnCode?: string | null;
  quantity: number;
  unit?: string | null;
  unitPrice: number;
  gstRate: number | null;
  lineTotal: number;
  matchedProductId?: string | null;
  matchedProductName?: string | null;
  matchedProductSku?: string | null;
};

/** Mirrors ExtractedDocumentData in backend/src/services/document-extraction.ts. */
export type ExtractedData = {
  documentType: "purchase_invoice" | "purchase_proforma" | "unknown";
  documentNumber: string | null;
  documentDate: string | null;
  dueDate: string | null;
  supplierName: string | null;
  supplierGstin: string | null;
  supplierContact: string | null;
  supplierAddress: string | null;
  matchedSupplierId: string | null;
  matchedSupplierName: string | null;
  buyerName: string | null;
  buyerGstin: string | null;
  poNumber: string | null;
  currency: string;
  subtotal: number | null;
  gstTotal: number | null;
  freight: number | null;
  roundOff: number | null;
  grandTotal: number | null;
  lines: ExtractedItem[];
  confidence: "high" | "medium" | "low";
  /** "none" = nothing could be read from the file. */
  extractionMethod: "pdf_text" | "gemini_ai" | "none";
  warnings: string[];
  rawTextPreview?: string;
};

/** True when the document yielded something worth filling into a form. */
export function hasUsefulExtraction(d: ExtractedData | null | undefined): boolean {
  if (!d) return false;
  return !!(
    d.documentNumber ||
    d.supplierName ||
    d.supplierGstin ||
    d.matchedSupplierId ||
    (Array.isArray(d.lines) && d.lines.length > 0)
  );
}

/** Defensive copy: arrays always present, no undefined lines. */
function normalizeExtracted(raw: any): ExtractedData {
  const d = (raw ?? {}) as ExtractedData;
  return {
    ...d,
    lines: Array.isArray(d.lines) ? d.lines.filter(Boolean) : [],
    warnings: Array.isArray(d.warnings) ? d.warnings.filter(Boolean) : [],
  };
}

const money = (n: unknown) => `₹${Number(n ?? 0).toLocaleString("en-IN")}`;

const NOTHING_READ_HELP =
  "If this is a scanned PDF or a photo, AI extraction must be enabled on the server (GEMINI_API_KEY). You can still fill the form manually.";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  scope: "purchase_invoices" | "proformas";
  suppliers?: Array<{ id: string; name: string; gstin?: string | null }>;
  /** uploadedFile is null when the server could not store the attachment. */
  onApply: (data: ExtractedData, uploadedFile: DocMeta | null) => void;
};

export function InvoiceAutoExtractModal({
  isOpen,
  onClose,
  scope,
  suppliers = [],
  onApply,
}: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedData | null>(null);
  const [uploadedDoc, setUploadedDoc] = useState<DocMeta | null>(null);
  const [serverWarning, setServerWarning] = useState<string | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const reset = () => {
    setFile(null);
    setExtracted(null);
    setUploadedDoc(null);
    setServerWarning(null);
    setSelectedSupplierId("");
  };

  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const handleFile = async (f: File) => {
    if (f.size > 15 * 1024 * 1024) {
      toast.error("File exceeds 15 MB limit");
      return;
    }
    setFile(f);
    setBusy(true);
    setExtracted(null);
    setUploadedDoc(null);
    setServerWarning(null);

    try {
      const res = await api.documentExtraction.extract(f, scope);
      if (!res?.extracted) {
        toast.error("Could not extract details from this file");
        return;
      }
      const data = normalizeExtracted(res.extracted);
      setExtracted(data);
      setUploadedDoc(((res as any).file as DocMeta | null) ?? null);
      // Preselect only a supplier the dropdown can actually show.
      const matchedId = data.matchedSupplierId || "";
      setSelectedSupplierId(matchedId && suppliers.some((s) => s.id === matchedId) ? matchedId : "");

      const warning = (res as any).warning as string | null | undefined;
      if (warning) {
        setServerWarning(warning);
        toast.warning(warning);
      }
      if (!hasUsefulExtraction(data)) {
        toast.warning("Nothing could be read from this document", {
          description: NOTHING_READ_HELP,
          duration: 10000,
        });
      } else if (data.confidence === "low") {
        toast.warning("Only partial details could be read — please verify every field.");
      } else {
        toast.success("Document analyzed — review the details before applying.");
      }
    } catch (e: any) {
      toast.error(e?.message || "Document extraction failed");
    } finally {
      setBusy(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (busy) return;
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const useful = hasUsefulExtraction(extracted);

  const handleApply = () => {
    if (!extracted) return;
    const chosen = selectedSupplierId ? suppliers.find((s) => s.id === selectedSupplierId) : undefined;
    const finalData: ExtractedData = {
      ...extracted,
      // Only the supplier shown in the dropdown is applied; "Select supplier…"
      // means leave the form's supplier alone.
      matchedSupplierId: chosen ? chosen.id : null,
      matchedSupplierName: chosen ? chosen.name : null,
    };
    onApply(finalData, uploadedDoc);
    reset();
    onClose();
  };

  const lines = extracted?.lines ?? [];
  const warnings = [
    ...(serverWarning ? [serverWarning] : []),
    ...(extracted?.warnings ?? []),
  ];

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={close}
    >
      <div
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-vault"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-display text-base font-semibold text-foreground">
                Auto-fill from Document (OCR &amp; AI)
              </h3>
              <p className="text-xs text-muted-foreground">
                Upload supplier invoice or quotation PDF/image to automatically fetch details.
              </p>
            </div>
          </div>
          <button
            onClick={close}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          {/* Upload Dropzone */}
          {!extracted && (
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => !busy && inputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-all ${
                busy
                  ? "border-primary/50 bg-primary/5"
                  : "border-border hover:border-primary/60 hover:bg-muted/40"
              }`}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,image/png,image/jpeg,image/webp"
                className="hidden"
                disabled={busy}
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFile(e.target.files[0]);
                  }
                  e.target.value = "";
                }}
              />
              {busy ? (
                <div className="flex flex-col items-center space-y-3">
                  <Loader2 className="h-9 w-9 animate-spin text-primary" />
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">
                      Scanning document &amp; extracting details…
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Reading supplier, dates, line items, and GST calculations
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center space-y-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <UploadCloud className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Click to upload or drag &amp; drop
                    </p>
                    <p className="text-xs text-muted-foreground">
                      PDF, JPEG, PNG, or WebP (up to 15 MB)
                    </p>
                  </div>
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-muted/60 px-3 py-1 text-[11px] text-muted-foreground">
                    <Sparkles className="h-3 w-3 text-primary" />
                    Extracts invoice number, date, supplier, line items &amp; taxes
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Extracted Details Preview */}
          {extracted && (
            <div className="space-y-4">
              {/* File details banner */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/30 px-3.5 py-2.5 text-xs">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary shrink-0" />
                  <span className="font-medium text-foreground">{file?.name}</span>
                  <span className="text-[10px] text-muted-foreground">
                    ({file ? (file.size / 1024).toFixed(1) + " KB" : ""})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {useful ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-sem-success/15 px-2 py-0.5 text-[10px] font-semibold text-sem-success">
                      <CheckCircle2 className="h-3 w-3" />
                      {extracted.extractionMethod === "gemini_ai" ? "Gemini AI" : "PDF Text Parser"}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-sem-attention/15 px-2 py-0.5 text-[10px] font-semibold text-sem-attention">
                      <AlertCircle className="h-3 w-3" />
                      Nothing read
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={reset}
                    className="text-[11px] text-muted-foreground hover:text-foreground underline"
                  >
                    Change file
                  </button>
                </div>
              </div>

              {/* Warnings */}
              {(warnings.length > 0 || !useful) && (
                <div className="space-y-1 rounded-lg border border-sem-attention/40 bg-sem-attention/10 p-3 text-xs text-sem-attention">
                  {!useful && (
                    <div className="flex items-start gap-1.5 font-semibold">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        Nothing could be read from this document. {NOTHING_READ_HELP} Applying will
                        only attach the file — your form fields stay as they are.
                      </span>
                    </div>
                  )}
                  {warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-1.5">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Header Grid */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
                <div className="rounded-lg border border-border/60 bg-card p-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    <Hash className="h-3.5 w-3.5 text-primary" />
                    Document No.
                  </div>
                  <div className="mt-1 font-mono text-sm font-semibold text-foreground">
                    {extracted.documentNumber || "Not detected"}
                  </div>
                </div>

                <div className="rounded-lg border border-border/60 bg-card p-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5 text-primary" />
                    Document Date
                  </div>
                  <div className="mt-1 text-sm font-semibold text-foreground">
                    {extracted.documentDate || "Not detected"}
                  </div>
                </div>

                <div className="rounded-lg border border-border/60 bg-card p-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5 text-primary" />
                    {scope === "proformas" ? "Valid Until" : "Due Date"}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-foreground">
                    {extracted.dueDate || "—"}
                  </div>
                </div>
              </div>

              {/* Supplier Selection & Match */}
              <div className="rounded-lg border border-border/60 bg-card p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <Building2 className="h-4 w-4 text-primary" />
                    Supplier / Vendor
                  </div>
                  {extracted.supplierGstin && (
                    <span className="font-mono text-[11px] text-muted-foreground">
                      GSTIN: {extracted.supplierGstin}
                    </span>
                  )}
                </div>

                <div className="text-xs text-muted-foreground">
                  Detected in document:{" "}
                  <b className="text-foreground">{extracted.supplierName || "—"}</b>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                    Map to registered supplier:
                  </label>
                  <select
                    className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    value={selectedSupplierId}
                    onChange={(e) => setSelectedSupplierId(e.target.value)}
                  >
                    <option value="">Select supplier… (keep the form's supplier)</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} {s.gstin ? `(${s.gstin})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Extracted Lines Table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <Layers className="h-4 w-4 text-primary" />
                    Line Items ({lines.length})
                  </span>
                  {extracted.grandTotal != null && (
                    <span className="text-xs font-semibold text-foreground">
                      Total: {money(extracted.grandTotal)}
                    </span>
                  )}
                </div>

                {lines.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border/80 p-4 text-center text-xs text-muted-foreground">
                    No individual line items parsed — existing lines in the form are left unchanged.
                  </div>
                ) : (
                  <div className="max-h-60 overflow-y-auto rounded-lg border border-border/60">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-muted/50 text-[10px] uppercase tracking-wider text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2">Item Description</th>
                          <th className="px-3 py-2">HSN</th>
                          <th className="px-3 py-2 text-right">Qty</th>
                          <th className="px-3 py-2 text-right">Rate</th>
                          <th className="px-3 py-2 text-right">GST %</th>
                          <th className="px-3 py-2 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        {lines.map((l, i) => (
                          <tr key={i} className="hover:bg-muted/20">
                            <td className="px-3 py-2">
                              <div className="font-medium text-foreground">{l.name || "—"}</div>
                              {l.matchedProductId ? (
                                <div className="text-[10px] text-sem-success">
                                  ✓ Matched: {l.matchedProductName || "catalogue product"}
                                  {l.matchedProductSku ? ` (SKU ${l.matchedProductSku})` : ""}
                                </div>
                              ) : (
                                <div className="text-[10px] text-muted-foreground">
                                  Not matched to a catalogue product
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                              {l.hsnCode || "—"}
                            </td>
                            <td className="px-3 py-2 text-right font-medium">
                              {Number(l.quantity ?? 0)} {l.unit || ""}
                            </td>
                            <td className="px-3 py-2 text-right font-medium">
                              {money(l.unitPrice)}
                            </td>
                            <td className="px-3 py-2 text-right text-muted-foreground">
                              {l.gstRate != null ? `${Number(l.gstRate)}%` : "—"}
                            </td>
                            <td className="px-3 py-2 text-right font-semibold text-foreground">
                              {money(l.lineTotal)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Financial Summary */}
              {(extracted.subtotal != null ||
                extracted.gstTotal != null ||
                extracted.freight != null ||
                extracted.grandTotal != null) && (
                <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border/60 bg-muted/20 p-3 text-xs">
                  {extracted.subtotal != null && (
                    <div>
                      <span className="text-muted-foreground">Subtotal: </span>
                      <span className="font-semibold text-foreground">
                        {money(extracted.subtotal)}
                      </span>
                    </div>
                  )}
                  {extracted.gstTotal != null && (
                    <div>
                      <span className="text-muted-foreground">GST: </span>
                      <span className="font-semibold text-foreground">
                        {money(extracted.gstTotal)}
                      </span>
                    </div>
                  )}
                  {extracted.freight != null && Number(extracted.freight) > 0 && (
                    <div>
                      <span className="text-muted-foreground">Freight: </span>
                      <span className="font-semibold text-foreground">
                        {money(extracted.freight)}
                      </span>
                    </div>
                  )}
                  {extracted.grandTotal != null && (
                    <div>
                      <span className="text-muted-foreground">Grand Total: </span>
                      <span className="font-bold text-primary text-sm">
                        {money(extracted.grandTotal)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="sticky bottom-0 z-10 flex items-center justify-between border-t border-border bg-card px-5 py-3">
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </button>

          {extracted && (useful || uploadedDoc) && (
            <button
              type="button"
              onClick={handleApply}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow hover:bg-primary/90"
            >
              {useful ? "Apply to Form" : "Attach document only"}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
