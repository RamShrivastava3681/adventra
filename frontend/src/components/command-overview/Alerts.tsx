import { Link } from "@tanstack/react-router";
import { CheckCircle2, PackageCheck } from "lucide-react";
import { EmptyState } from "@/components/ledger-ui";
import type { InventoryAlert, OpAlert } from "./useCommandData";
import { AreaBadge, TargetDate } from "./cards";

const INV_TONE: Record<InventoryAlert["severity"], { pill: string; dot: string }> = {
  critical: {
    pill: "bg-sem-critical/10 text-sem-critical border-sem-critical/25",
    dot: "bg-sem-critical",
  },
  attention: {
    pill: "bg-sem-attention/10 text-sem-attention border-sem-attention/25",
    dot: "bg-sem-attention",
  },
  warn: {
    pill: "bg-sem-caution/10 text-sem-caution border-sem-caution/25",
    dot: "bg-sem-caution",
  },
};

export function InventoryAlerts({
  alerts,
  loading,
  limit = 6,
}: {
  alerts: InventoryAlert[];
  loading?: boolean;
  limit?: number;
}) {
  if (loading) {
    return (
      <div className="space-y-2" aria-label="Loading inventory alerts">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-muted/50" />
        ))}
      </div>
    );
  }
  const visible = alerts.slice(0, limit);
  if (visible.length === 0) {
    return (
      <EmptyState
        icon={<PackageCheck className="h-5 w-5" />}
        title="Inventory is healthy"
        description="No inventory alerts require attention."
      />
    );
  }
  return (
    <ul className="space-y-2">
      {visible.map((a) => {
        const tone = INV_TONE[a.severity];
        return (
          <li
            key={a.id}
            className="rounded-lg border border-border bg-background/40 px-3 py-2.5 transition-colors hover:border-border-strong"
          >
            <div className="flex items-start justify-between gap-2">
              <Link
                to="/app/products"
                className="font-mono text-xs font-semibold text-primary hover:underline"
                title={a.name}
              >
                {a.sku}
              </Link>
              <span
                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${tone.pill}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                {a.status}
              </span>
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate text-muted-foreground">{a.name || "—"}</span>
              <span className="num shrink-0 font-semibold text-foreground">{a.stock} units</span>
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {a.reorderLevel !== null
                ? `Reorder level: ${a.reorderLevel} · ${a.forecastNote}`
                : a.forecastNote}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const PRI_TONE: Record<OpAlert["priority"], string> = {
  Critical: "bg-sem-critical/10 text-sem-critical border-sem-critical/25",
  High: "bg-sem-attention/10 text-sem-attention border-sem-attention/25",
  Medium: "bg-sem-info/10 text-sem-info border-sem-info/25",
  Info: "bg-muted/60 text-muted-foreground border-border",
};

export function OperationalAlertsList({
  alerts,
  loading,
  limit,
}: {
  alerts: OpAlert[];
  loading?: boolean;
  limit?: number;
}) {
  if (loading) {
    return (
      <div className="space-y-2" aria-label="Loading operational alerts">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/50" />
        ))}
      </div>
    );
  }
  const visible = limit ? alerts.slice(0, limit) : alerts;
  if (visible.length === 0) {
    return (
      <EmptyState
        icon={<CheckCircle2 className="h-5 w-5" />}
        title="No operational alerts"
        description="Everything is currently on track."
      />
    );
  }
  return (
    <ul className="space-y-2">
      {visible.map((a) => (
        <li
          key={a.id}
          className="flex items-start gap-3 rounded-lg border border-border bg-background/40 px-3 py-2.5 transition-colors hover:border-border-strong"
        >
          <span
            className={`mt-1 h-2 w-2 shrink-0 rounded-full ${a.overdue ? "bg-sem-critical" : a.priority === "High" ? "bg-sem-attention" : "bg-sem-info"}`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <AreaBadge area={a.area} />
              <span
                className={`rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${PRI_TONE[a.priority]}`}
              >
                {a.priority}
              </span>
            </div>
            <div className="mt-1 text-[13px] font-medium leading-snug text-foreground">
              {a.issue}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
              <span>Owner: {a.owner}</span>
              {a.targetDate && (
                <>
                  <span aria-hidden>·</span>
                  <TargetDate date={a.targetDate} overdue={a.overdue} />
                </>
              )}
              {a.detail && (
                <>
                  <span aria-hidden>·</span>
                  <span className="num">{a.detail}</span>
                </>
              )}
            </div>
          </div>
          <Link
            to={a.to as any}
            className="mt-0.5 shrink-0 rounded-md border border-border px-2.5 py-1 text-[11px] font-semibold text-primary hover:border-primary hover:bg-primary-soft"
          >
            View
          </Link>
        </li>
      ))}
    </ul>
  );
}
