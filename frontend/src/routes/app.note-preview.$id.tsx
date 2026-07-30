import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api-client";
import { PrintShell, type PreviewLine } from "@/components/invoice-print";

export const Route = createFileRoute("/app/note-preview/$id")({
  component: NotePreviewPage,
});

function NotePreviewPage() {
  const { id } = Route.useParams();

  const noteQ = useQuery({
    queryKey: ["note-preview", id],
    queryFn: async () => {
      const data = await api.creditDebitNotes.list();
      return data.find((n: any) => n.id === id) ?? null;
    },
  });

  const tplQ = useQuery({
    queryKey: ["invoice-template-for-doc", noteQ.data?.clientId ?? noteQ.data?.client_id],
    enabled: !!(noteQ.data?.clientId ?? noteQ.data?.client_id),
    queryFn: async () => {
      const data = await api.invoiceTemplates.get();
      return data;
    },
  });

  if (noteQ.isLoading) return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Loading note…</div>;
  if (!noteQ.data) return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Note not found.</div>;

  const n = noteQ.data as Record<string, unknown> & { invoice?: { invoice_number?: string }; purchase?: { invoice_number?: string } };
  const tpl = (tplQ.data as Record<string, unknown> | null) ?? {};
  const lines: PreviewLine[] = Array.isArray(n.line_items) ? (n.line_items as PreviewLine[]) : [];
  const amount = Number(n.amount ?? 0);
  const taxRate = Number(n.tax_rate ?? 0);
  const taxAmount = Number(n.tax_amount ?? 0);
  const subtotal = Number(n.subtotal ?? Math.max(0, amount - taxAmount));

  const linkedRef = n.invoice?.invoice_number
    ? `Sales invoice ${n.invoice.invoice_number}`
    : n.purchase?.invoice_number
      ? `Purchase invoice ${n.purchase.invoice_number}`
      : null;

  return (
    <PrintShell
      backTo="/app/notes"
      template={{
        company_name: (tpl.company_name as string) || "Your company",
        company_address: (tpl.company_address as string) || "",
        company_email: (tpl.company_email as string) || "",
        company_phone: (tpl.company_phone as string) || "",
        tax_id: (tpl.tax_id as string) || "",
        logo_url: (tpl.logo_url as string) || "",
        primary_color: (tpl.primary_color as string) || "#0EA5E9",
        accent_color: (tpl.accent_color as string) || "#0F172A",
        currency: (tpl.currency as string) || "USD",
        currency_symbol: (tpl.currency_symbol as string) || "$",
        bank_details: (tpl.bank_details as string) || "",
        terms: (tpl.terms as string) || "",
        footer_text: (tpl.footer_text as string) || "",
        signature_label: (tpl.signature_label as string) || "Authorised signatory",
      }}
      doc={{
        kind: (n.kind as "credit" | "debit") || "credit",
        number: String(n.note_number ?? ""),
        date: String(n.note_date ?? ""),
        party_name: (n.counterparty as string) || "—",
        reference: linkedRef,
        line_items: lines,
        subtotal,
        tax_rate: taxRate,
        tax_amount: taxAmount,
        total: amount,
        notes: (n.reason as string) || (n.notes as string) || null,
      }}
    />
  );
}
