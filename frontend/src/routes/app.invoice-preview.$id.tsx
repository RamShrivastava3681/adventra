import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api-client";
import { ArrowLeft, Download, Loader2, Printer } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "/api";

export const Route = createFileRoute("/app/invoice-preview/$id")({
  component: PreviewPage,
});

/**
 * Invoice preview renders the server-generated Tally-style tax-invoice PDF
 * only (no HTML replica) — the same document the Download button produces.
 */
function PreviewPage() {
  const { id } = Route.useParams();
  const [downloading, setDownloading] = useState(false);
  const [failed, setFailed] = useState(false);

  const invQ = useQuery({
    queryKey: ["invoice-preview", id],
    queryFn: async () => api.invoices.get(id),
  });

  const number = (invQ.data as any)?.invoice_number ?? "invoice";

  const download = async () => {
    setDownloading(true);
    try {
      await api.invoices.downloadPdf(id, String(number));
    } catch (e) {
      // Surfaced via toast inside the caller flow; keep the frame as fallback.
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link
            to="/app/invoices"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            Tax invoice · {invQ.isLoading ? "loading…" : String(number)}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm"
            >
              <Printer className="h-4 w-4" /> Print
            </button>
            <button
              onClick={download}
              disabled={downloading}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {downloading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Download PDF
            </button>
          </div>
        </div>
      </div>

      {/* PDF frame */}
      <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {invQ.isLoading ? (
          <div className="grid min-h-[60vh] place-items-center text-sm text-muted-foreground">
            Loading invoice…
          </div>
        ) : !invQ.data ? (
          <div className="grid min-h-[60vh] place-items-center text-sm text-muted-foreground">
            Invoice not found.
          </div>
        ) : failed ? (
          <div className="grid min-h-[60vh] place-items-center text-sm text-muted-foreground">
            Could not load the PDF preview. Use Download PDF instead.
          </div>
        ) : (
          <iframe
            title={`Invoice ${String(number)}`}
            src={`${API_URL}/invoices/${id}/pdf`}
            className="h-[80vh] w-full rounded-lg border border-border bg-white shadow-2xl"
            onError={() => setFailed(true)}
          />
        )}
      </div>
    </div>
  );
}
