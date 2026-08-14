import { Skeleton } from "@/components/ui/skeleton";

/* ------------------------------------------------------------------ */
/*  Stat / Metric card skeleton                                        */
/* ------------------------------------------------------------------ */
export function StatSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-2.5 h-7 w-28" />
      <Skeleton className="mt-2 h-3 w-20" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Chart / Area skeleton                                              */
/* ------------------------------------------------------------------ */
export function ChartSkeleton({ height = "h-64" }: { height?: string }) {
  return (
    <div className={`${height} flex items-end gap-1 px-2`}>
      {Array.from({ length: 12 }).map((_, i) => (
        <Skeleton
          key={i}
          className="flex-1 rounded-t"
          style={{ height: `${30 + Math.random() * 60}%` }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Table skeleton                                                      */
/* ------------------------------------------------------------------ */
export function TableSkeleton({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="table-premium w-full">
        <thead>
          <tr>
            {Array.from({ length: cols }).map((_, i) => (
              <th key={i}>
                <Skeleton className="h-3 w-16" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c}>
                  <Skeleton className="h-4" style={{ width: `${50 + Math.random() * 40}%` }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Composed dashboard skeleton — mirrors the new dashboard layout     */
/* ------------------------------------------------------------------ */
export function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-[1440px] space-y-10 px-6 py-8 md:px-10">
      {/* Primary portfolio metrics */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatSkeleton />
        <StatSkeleton />
        <StatSkeleton />
        <StatSkeleton />
      </div>

      {/* Performance chart */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-28" />
        </div>
        <ChartSkeleton />
      </div>

      {/* Secondary performance band */}
      <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-border md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-card p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-5 w-24" />
            <Skeleton className="mt-2 h-3 w-16" />
          </div>
        ))}
      </div>

      {/* Aging + Alerts */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
          <Skeleton className="mb-4 h-5 w-36" />
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i}>
                <div className="flex justify-between text-xs">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <Skeleton className="mt-1.5 h-1.5 w-full rounded-full" />
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-3 w-10" />
          </div>
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-border p-3">
                <div className="flex items-start gap-2">
                  <Skeleton className="mt-1.5 h-1.5 w-1.5 rounded-full" />
                  <div className="flex-1 space-y-1">
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-2 w-32" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent invoices table */}
      <div className="rounded-xl border border-border bg-card p-5">
        <Skeleton className="mb-4 h-5 w-32" />
        <TableSkeleton rows={4} cols={7} />
      </div>

      {/* Recent expenses table */}
      <div className="rounded-xl border border-border bg-card p-5">
        <Skeleton className="mb-4 h-5 w-32" />
        <TableSkeleton rows={3} cols={7} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page header skeleton                                                */
/* ------------------------------------------------------------------ */
export function PageHeaderSkeleton() {
  return (
    <div className="border-b border-border bg-background px-6 py-6 md:px-10">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-2 h-6 w-48" />
      <Skeleton className="mt-2 h-3 w-72" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Full table page skeleton (header + stats + filters + table)         */
/* ------------------------------------------------------------------ */
export function TablePageSkeleton({
  rows = 6,
  cols = 6,
  statCards = 0,
}: {
  rows?: number;
  cols?: number;
  statCards?: number;
}) {
  return (
    <div>
      <PageHeaderSkeleton />
      <div className="space-y-6 p-6 md:p-10">
        {statCards > 0 && (
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: `repeat(${Math.min(statCards, 4)}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: statCards }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="mt-2 h-7 w-20" />
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-20 rounded-full" />
          ))}
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <TableSkeleton rows={rows} cols={cols} />
        </div>
      </div>
    </div>
  );
}
