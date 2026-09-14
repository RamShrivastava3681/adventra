import { Link } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";
import { EmptyState } from "@/components/ledger-ui";
import type { PriorityRow } from "./useCommandData";
import { AreaBadge, TargetDate } from "./cards";

export function PriorityTable({
  rows,
  loading,
  limit,
}: {
  rows: PriorityRow[];
  loading?: boolean;
  limit?: number;
}) {
  if (loading) {
    return (
      <div className="space-y-2" aria-label="Loading priorities">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-11 animate-pulse rounded-lg bg-muted/50" />
        ))}
      </div>
    );
  }
  const visible = limit ? rows.slice(0, limit) : rows;
  if (visible.length === 0) {
    return (
      <EmptyState
        icon={<CheckCircle2 className="h-5 w-5" />}
        title="You're all caught up"
        description="No cross-functional priorities require attention."
      />
    );
  }
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="table-premium w-full min-w-[760px]">
        <thead>
          <tr>
            <th>Area</th>
            <th>Item</th>
            <th>Owner</th>
            <th>Next Step</th>
            <th>Target Date</th>
            <th className="text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={r.id}>
              <td>
                <AreaBadge area={r.area} />
              </td>
              <td>
                <div className="text-[13px] font-medium text-foreground">{r.item}</div>
                {r.itemSub && (
                  <div className="max-w-[260px] truncate text-xs text-muted-foreground">
                    {r.itemSub}
                  </div>
                )}
              </td>
              <td className="whitespace-nowrap text-[13px] text-foreground">{r.owner}</td>
              <td className="max-w-[220px] text-[13px] text-muted-foreground">{r.nextStep}</td>
              <td>
                <TargetDate date={r.targetDate} overdue={r.overdue} approaching={r.approaching} />
              </td>
              <td className="text-right">
                <Link
                  to={r.to as any}
                  className="rounded-md border border-border px-2.5 py-1 text-[11px] font-semibold text-primary transition-colors hover:border-primary hover:bg-primary-soft"
                >
                  View
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
