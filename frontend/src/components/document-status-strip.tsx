import { Link } from "@tanstack/react-router";
import { StatusPill } from "@/components/ledger-ui";
import type { InventoryImpact, CashImpact } from "@/lib/doc-impact";

export type LinkedDoc = { type: string; id: string; number: string | null };

export interface DocumentStatusStripProps {
  docType: string;
  docNumber: string;
  status: string;
  statusLabel: string;
  owner: string;
  nextAction: string;
  inventoryImpact: InventoryImpact;
  cashImpact: CashImpact;
  linkedDocs?: LinkedDoc[];
  tone?: "amber" | "blue" | "green" | "red" | "grey";
}

const TONE_BG: Record<string, string> = {
  amber: "border-sem-attention/30 bg-sem-attention/5",
  blue: "border-sem-info/30 bg-sem-info/5",
  green: "border-sem-success/30 bg-sem-success/5",
  red: "border-destructive/30 bg-destructive/5",
  grey: "border-border bg-muted/40",
};

export function toneForStatus(status: string): "amber" | "blue" | "green" | "red" | "grey" {
  const s = String(status ?? "").toLowerCase();
  if (["rejected", "cancelled", "overdue", "dispute", "blocked"].some((k) => s.includes(k))) return "red";
  if (["paid", "approved", "accepted", "dispatched", "delivered", "completed", "credited", "debited"].some((k) => s.includes(k)))
    return "green";
  if (["review", "approval", "acceptance", "submitted", "sent", "issued", "confirmed"].some((k) => s.includes(k)))
    return "blue";
  if (["waiting", "pending", "record", "prepare", "required", "due", "attention"].some((k) => s.includes(k))) return "amber";
  return "grey";
}

/**
 * DocumentStatusStrip — shared read-only strip rendered directly below the
 * page title and above document fields (WHIZUNIK §1).
 * Pure presentational: colour is secondary, text label + next action always present.
 */
export function DocumentStatusStrip(props: DocumentStatusStripProps) {
  const tone = props.tone ?? toneForStatus(props.status);
  return (
    <div className={`rounded-xl border px-4 py-3 ${TONE_BG[tone]}`} data-testid="document-status-strip">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-sm font-semibold">
          {props.docType} {props.docNumber}
        </span>
        <StatusPill status={props.status} label={props.statusLabel} />
        <span className="text-xs text-muted-foreground">
          Owner: <span className="font-medium text-foreground">{props.owner}</span>
        </span>
        <span className="text-xs text-muted-foreground">
          Next: <span className="font-medium text-foreground">{props.nextAction}</span>
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          Stock: <span className="font-medium text-foreground">{props.inventoryImpact}</span>
        </span>
        <span>
          Cash: <span className="font-medium text-foreground">{props.cashImpact}</span>
        </span>
        {props.linkedDocs && props.linkedDocs.length > 0 && (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            Linked:
            {props.linkedDocs.slice(0, 6).map((d, i) => (
              <span key={`${d.type}-${d.id}-${i}`} className="inline-flex items-center gap-1">
                <span className="rounded border border-border bg-card px-1.5 py-0.5 font-medium text-foreground">
                  {d.type}: {d.number ?? d.id.slice(0, 8)}
                </span>
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

/** Compact strip for detail modals (same data, tighter layout). */
export function DocumentStatusStripCompact(props: DocumentStatusStripProps) {
  return (
    <div className="mb-3">
      <DocumentStatusStrip {...props} />
    </div>
  );
}

export { Link as StripLink };
