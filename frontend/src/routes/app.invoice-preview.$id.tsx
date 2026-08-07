import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api-client";
import { PrintShell, type PreviewLine } from "@/components/invoice-print";

export const Route = createFileRoute("/app/invoice-preview/$id")({
  component: PreviewPage,
});

function PreviewPage() {
  const { id } = Route.useParams();

  const invQ = useQuery({
    queryKey: ["invoice-preview", id],
    queryFn: async () => {
      const data = await api.invoices.get(id);
      return data;
    },
  });

  const tplQ = useQuery({
    queryKey: ["invoice-template-for-doc", invQ.data?.clientId ?? invQ.data?.client_id],
    enabled: !!(invQ.data?.clientId ?? invQ.data?.client_id),
    queryFn: async () => {
      const data = await api.invoiceTemplates.get();
      return data;
    },
  });

  if (invQ.isLoading)
    return (
      <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">
        Loading invoice…
      </div>
    );
  if (!invQ.data)
    return (
      <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">
        Invoice not found.
      </div>
    );

  const i = invQ.data as Record<string, unknown> & { debtor?: Record<string, unknown> };
  const tpl = (tplQ.data as Record<string, unknown> | null) ?? {};

  // Goods-invoice lines (catalogue-backed) — fall back to legacy line_items.
  const goodsLines = Array.isArray(i.lines) ? (i.lines as any[]) : [];
  const legacyLines = Array.isArray(i.line_items) ? (i.line_items as any[]) : [];
  const lines: PreviewLine[] = (goodsLines.length ? goodsLines : legacyLines).map((l) => ({
    description: l.name ?? l.description ?? "Item",
    quantity: Number(l.quantity ?? l.qty ?? 0),
    unit_price: Number(l.unit_price ?? 0),
    line_total: Number(l.line_total ?? 0),
    sku: l.sku ?? null,
    discount_pct: l.discount_pct ?? null,
    gst_rate: l.gst_rate ?? null,
  }));

  const grandTotal = Number(i.grand_total ?? i.amount ?? 0);
  const advanceDeducted = Number(i.advance_deducted ?? 0);
  // `amount` is the net receivable (grand total − advances) — the document
  // total that prints stays the full value with the advance shown separately.
  const netAmount = Number(i.amount ?? Math.max(0, grandTotal - advanceDeducted));
  const subtotal = Number(
    i.subtotal_goods ?? i.subtotal ?? Math.max(0, grandTotal - Number(i.tax_amount ?? 0)),
  );
  const totalDiscount = Number(i.total_discount ?? 0);
  const gstTotal = Number(i.gst_total ?? i.tax_amount ?? 0);
  const freight = Number(i.freight ?? 0);
  const amountReceived = Number(i.amount_received ?? 0);
  const balanceOutstanding = Math.max(0, netAmount - amountReceived);

  const debtor = i.debtor ?? {};
  const partyAddress = [debtor.address_line, debtor.city, debtor.country]
    .filter(Boolean)
    .join(", ");

  return (
    <PrintShell
      backTo="/app/invoices"
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
        kind: "invoice",
        number: String(i.invoice_number ?? ""),
        date: String(i.issue_date ?? ""),
        due_date: i.due_date ? String(i.due_date) : null,
        party_name: (debtor.name as string) || "—",
        party_address: partyAddress,
        party_email: (debtor.contact_email as string) || "",
        party_phone: (debtor.contact_phone as string) || "",
        po_number: i.po_number ? String(i.po_number) : null,
        po_date: i.po_date ? String(i.po_date) : null,
        so_number: i.goods_sales_order_number ? String(i.goods_sales_order_number) : null,
        billing_address: i.billing_address ? String(i.billing_address) : null,
        delivery_address: i.delivery_address ? String(i.delivery_address) : null,
        line_items: lines,
        subtotal,
        tax_rate: Number(i.tax_rate ?? 0),
        tax_amount: gstTotal,
        total: grandTotal,
        total_discount: totalDiscount,
        gst_total: gstTotal,
        freight,
        advance_deducted: advanceDeducted,
        amount_received: amountReceived,
        balance_outstanding: balanceOutstanding,
        notes: (i.notes as string) || null,
      }}
    />
  );
}
