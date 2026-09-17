import { AlertTriangle, Loader2, X } from "lucide-react";

export type CascadePartyKind = "customer" | "supplier" | "vendor";

const CASCADE_SCOPE: Record<CascadePartyKind, string[]> = {
  customer: [
    "Sales orders",
    "Sales invoices",
    "Customer proformas",
    "Dispatch notes",
    "Advances",
    "Credit / debit notes",
    "Payment receipts",
    "Bulk payments",
    "Expected inflows",
    "Workflow tasks & timelines",
    "Stock movements",
    "Payment terms & alerts",
  ],
  supplier: [
    "Goods purchase orders",
    "GRNs (goods receipts)",
    "Supplier proformas",
    "Purchase commitments",
    "Expected outflows",
    "Advances",
    "Payment receipts",
    "Workflow tasks & timelines",
    "Stock movements",
  ],
  vendor: [
    "Purchase orders",
    "Purchase invoices",
    "Supplier proformas",
    "Purchase commitments",
    "Expected outflows",
    "Advances",
    "Credit / debit notes",
    "Bulk (AP) payments",
    "Workflow tasks & timelines",
    "Stock movements",
  ],
};

const KIND_LABEL: Record<CascadePartyKind, string> = {
  customer: "customer",
  supplier: "supplier",
  vendor: "supplier",
};

/** Summarize a backend `deleted` counts object into "3 sales orders, 1 invoice". */
export function summarizeDeleted(deleted: Record<string, number> | undefined): string {
  if (!deleted) return "";
  const parts = Object.entries(deleted)
    .filter(([, n]) => Number(n) > 0)
    .map(([k, n]) => `${n} ${k.replace(/([A-Z])/g, " $1").toLowerCase()}`);
  return parts.join(", ");
}

export function CascadeDeleteDialog({
  kind,
  name,
  pending,
  onConfirm,
  onClose,
}: {
  kind: CascadePartyKind;
  name: string;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-y-auto rounded-xl border border-destructive/40 bg-card shadow-vault"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="font-display text-lg">Delete {KIND_LABEL[kind]}?</h3>
          <button onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 p-5 text-sm">
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Deleting <strong>{name}</strong> permanently removes the {KIND_LABEL[kind]} record{" "}
              <strong>and every linked document below</strong>. This cannot be undone.
            </span>
          </div>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {CASCADE_SCOPE[kind].map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={onConfirm}
              className="inline-flex items-center gap-2 rounded-[10px] bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground shadow-sm transition-all hover:-translate-y-px hover:shadow-md disabled:opacity-60"
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete permanently
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
