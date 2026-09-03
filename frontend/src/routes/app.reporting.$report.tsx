import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import api from "@/lib/api-client";
import { EmptyState, fmtDate } from "@/components/ledger-ui";
import {
  EMPTY_FILTERS,
  Pagination,
  QuickTabs,
  ReportFilterBar,
  ReportHeader,
  ReportTable,
  TableToolbar,
  collectRowsForExport,
  runTabularExport,
  useColumnVisibility,
  useExportHeading,
  useReportData,
  type ReportFilters,
} from "@/components/reports-shell";
import {
  BalanceSheetView,
  PlPeriodBar,
  PortfolioSummaryTable,
  PortfolioView,
  ProfitLossView,
  defaultPlPeriod,
  exportBalanceSheetExcel,
  exportBalanceSheetPdf,
  exportPlExcel,
  exportPlPdf,
  exportPortfolioExcel,
  exportPortfolioPdf,
  type PlFx,
  type PlPeriod,
} from "@/components/reports-views";
import { getReport, type ReportDef } from "@/lib/reports-registry";
import { toast } from "sonner";

export const Route = createFileRoute("/app/reporting/$report")({
  component: ReportDetailPage,
});

const PAGE_SIZE = 25;

function ReportDetailPage() {
  const { report } = Route.useParams();
  const def = getReport(report);
  if (!def) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<AlertTriangle className="h-5 w-5" />}
          title="Unknown report"
          description={`“${report}” is not one of the twelve reports. Pick one from the dashboard.`}
          action={
            <Link
              to="/app/reporting"
              className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Back to Reports Dashboard
            </Link>
          }
        />
      </div>
    );
  }
  return <ReportBody key={def.id} def={def} />;
}

function ReportBody({ def }: { def: ReportDef }) {
  return (
    <div>
      <ReportDetailInner def={def} />
    </div>
  );
}

function ReportDetailInner({ def }: { def: ReportDef }) {
  const [filters, setFilters] = useState<ReportFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const { visible, setVisible } = useColumnVisibility(def);
  const [busy, setBusy] = useState<"excel" | "pdf" | null>(null);

  const buyersQ = useQuery({
    queryKey: ["report-buyers"],
    queryFn: () => api.reports.buyers(),
    enabled: def.filters.buyer,
  });
  const buyers = buyersQ.data ?? [];

  const patch = (p: Partial<ReportFilters>) => {
    setFilters((f) => ({ ...f, ...p }));
    setPage(1);
  };

  const { rows, total, totalPages, isLoading, isError, error } = useReportData(
    def,
    filters,
    page,
    PAGE_SIZE,
  );

  const heading = useExportHeading(def.title);
  const activeFilterNotes = useMemo(
    () => buildFilterNotes(def, filters, buyers),
    [def, filters, buyers],
  );
  const period =
    filters.from || filters.to
      ? `${fmtDate(filters.from || undefined)} – ${fmtDate(filters.to || undefined)}`
      : "All periods";
  const exportHeading = { ...heading, period, notes: activeFilterNotes };

  const runExport = async (kind: "excel" | "pdf") => {
    setBusy(kind);
    try {
      const allRows = await collectRowsForExport(def, filters);
      await runTabularExport(kind, def, exportHeading, allRows, visible);
      toast.success(
        kind === "excel" ? "Excel report exported" : "PDF ready — save from the print dialog",
      );
    } catch (err: any) {
      toast.error(err?.message || "Export failed");
    } finally {
      setBusy(null);
    }
  };

  if (def.id === "balance-sheet") return <BalanceSheetReport def={def} />;
  if (def.id === "portfolio") return <PortfolioReport def={def} />;
  if (def.id === "profit-loss") return <ProfitLossReport def={def} />;

  return (
    <div>
      <ReportHeader
        def={def}
        onExcel={() => runExport("excel")}
        onPdf={() => runExport("pdf")}
        busy={busy}
      />
      <QuickTabs activeId={def.id} />
      <div className="space-y-4 px-6 py-5 md:px-10">
        <ReportFilterBar def={def} filters={filters} onChange={patch} buyers={buyers} />
        {isError && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{(error as any)?.message || "Failed to load this report."}</span>
          </div>
        )}
        <TableToolbar
          def={def}
          total={def.serverPaginated ? total : rows.length}
          visible={visible}
          setVisible={setVisible}
        />
        <ReportTable def={def} rows={rows} visible={visible} loading={isLoading} />
        {def.serverPaginated && (
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            onPage={setPage}
          />
        )}
      </div>
    </div>
  );
}

function buildFilterNotes(
  def: ReportDef,
  filters: ReportFilters,
  buyers: Array<{ id: string; name: string }>,
): string[] {
  const notes: string[] = [];
  if (filters.status !== "all") {
    const label =
      def.filters.statuses?.find((s) => s.value === filters.status)?.label ?? filters.status;
    notes.push(`Status: ${label}`);
  }
  if (filters.buyerId) {
    const name = buyers.find((b) => b.id === filters.buyerId)?.name ?? filters.buyerId;
    notes.push(`Buyer: ${name}`);
  }
  if (filters.payment) {
    notes.push(`Payment: ${filters.payment === "bulk_pay" ? "Bulk Pay" : "Treasury Pay"}`);
  }
  if (filters.from || filters.to) {
    notes.push(
      `${def.filters.dateLabel ?? "Date"}: ${fmtDate(filters.from || undefined)} – ${fmtDate(filters.to || undefined)}`,
    );
  }
  return notes;
}

// ─── Balance sheet ─────────────────────────────────────────────────────────

function BalanceSheetReport({ def }: { def: ReportDef }) {
  const [busy, setBusy] = useState<"excel" | "pdf" | null>(null);
  const q = useQuery({
    queryKey: ["report", "balance-sheet"],
    queryFn: () => api.reports.balanceSheet(),
  });
  const data = q.data;
  const heading = useExportHeading(def.title, `As of ${data ? fmtDate(data.as_of) : ""}`);

  const run = async (kind: "excel" | "pdf") => {
    setBusy(kind);
    try {
      if (!data) throw new Error("The statement is still loading — try again in a moment");
      if (kind === "excel") exportBalanceSheetExcel(heading, data);
      else await exportBalanceSheetPdf(heading, data);
      toast.success(
        kind === "excel" ? "Excel report exported" : "PDF ready — save from the print dialog",
      );
    } catch (err: any) {
      toast.error(err?.message || "Export failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <ReportHeader def={def} onExcel={() => run("excel")} onPdf={() => run("pdf")} busy={busy} />
      <QuickTabs activeId={def.id} />
      <div className="px-6 py-5 md:px-10">
        {q.isLoading ? (
          <div className="rounded-xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
            Loading statement…
          </div>
        ) : q.isError ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{(q.error as any)?.message || "Failed to load the balance sheet."}</span>
          </div>
        ) : (
          <BalanceSheetView data={data} />
        )}
      </div>
    </div>
  );
}

// ─── Portfolio summary ─────────────────────────────────────────────────────

function PortfolioReport({ def }: { def: ReportDef }) {
  const [busy, setBusy] = useState<"excel" | "pdf" | null>(null);
  const q = useQuery({ queryKey: ["report", "portfolio"], queryFn: () => api.reports.portfolio() });
  const data = q.data;
  const heading = useExportHeading(
    def.title,
    data?.metrics?.as_of ? `As of ${fmtDate(data.metrics.as_of)}` : "Portfolio to date",
  );

  const run = async (kind: "excel" | "pdf") => {
    setBusy(kind);
    try {
      if (!data) throw new Error("The portfolio is still loading — try again in a moment");
      if (kind === "excel") exportPortfolioExcel(heading, data);
      else await exportPortfolioPdf(heading, data);
      toast.success(
        kind === "excel" ? "Excel report exported" : "PDF ready — save from the print dialog",
      );
    } catch (err: any) {
      toast.error(err?.message || "Export failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <ReportHeader def={def} onExcel={() => run("excel")} onPdf={() => run("pdf")} busy={busy} />
      <QuickTabs activeId={def.id} />
      <div className="px-6 py-5 md:px-10">
        {q.isLoading ? (
          <div className="rounded-xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
            Loading portfolio…
          </div>
        ) : q.isError ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{(q.error as any)?.message || "Failed to load the portfolio summary."}</span>
          </div>
        ) : (
          <>
            <PortfolioView data={data} />
            <PortfolioSummaryTable rows={data?.rows ?? []} />
          </>
        )}
      </div>
    </div>
  );
}

// ─── Profit & loss ─────────────────────────────────────────────────────────

function ProfitLossReport({ def }: { def: ReportDef }) {
  const [period, setPeriod] = useState<PlPeriod>(() => defaultPlPeriod());
  const [fx, setFx] = useState<PlFx>({ turnover: 0, costOfSales: 0 });
  const [busy, setBusy] = useState<"excel" | "pdf" | null>(null);
  const [savedFx, setSavedFx] = useState<Record<string, PlFx>>({});

  const q = useQuery({
    queryKey: ["report", "profit-loss", period.from, period.to],
    queryFn: () => api.reports.profitLoss(period.from, period.to),
  });
  const data = q.data;
  const heading = useExportHeading(def.title, `${fmtDate(period.from)} – ${fmtDate(period.to)}`);

  // Manual FX adjustments stay visible when the period changes.
  const fxKey = `${period.from}|${period.to}`;

  const updateFx = (f: PlFx) => {
    setFx(f);
    setSavedFx((m) => ({ ...m, [fxKey]: f }));
  };

  const run = async (kind: "excel" | "pdf") => {
    setBusy(kind);
    try {
      if (!data) throw new Error("The statement is still loading — try again in a moment");
      if (kind === "excel") exportPlExcel(heading, data, fx);
      else await exportPlPdf(heading, data, fx);
      toast.success(
        kind === "excel" ? "Excel report exported" : "PDF ready — save from the print dialog",
      );
    } catch (err: any) {
      toast.error(err?.message || "Export failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <ReportHeader def={def} onExcel={() => run("excel")} onPdf={() => run("pdf")} busy={busy} />
      <QuickTabs activeId={def.id} />
      <div className="space-y-4 px-6 py-5 md:px-10">
        <PlPeriodBar
          period={period}
          onChange={(p) => {
            setPeriod(p);
            const f = savedFx[`${p.from}|${p.to}`];
            if (f) setFx(f);
            else setFx({ turnover: 0, costOfSales: 0 });
          }}
        />
        {q.isLoading ? (
          <div className="rounded-xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
            Loading statement…
          </div>
        ) : q.isError ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{(q.error as any)?.message || "Failed to load the profit & loss."}</span>
          </div>
        ) : (
          <ProfitLossView data={data} fx={fx} onFx={updateFx} />
        )}
      </div>
    </div>
  );
}
