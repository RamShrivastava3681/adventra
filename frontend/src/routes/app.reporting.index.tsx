import { createFileRoute, Link } from "@tanstack/react-router";
import { BarChart3, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/ledger-ui";
import { reportsByCategory } from "@/lib/reports-registry";

export const Route = createFileRoute("/app/reporting/")({
  component: ReportsDashboardPage,
});

function ReportsDashboardPage() {
  const groups = reportsByCategory();

  return (
    <div>
      <PageHeader
        eyebrow="Reports"
        title="Reports Dashboard"
        description="Twelve reports across financial, invoice, customer and other categories — each opens a dedicated report page you can filter, drill into and export."
        icon={<BarChart3 className="h-5 w-5" />}
      />

      <div className="space-y-10 p-6 md:p-10">
        {groups.map((group) => (
          <section key={group.id}>
            <div className="mb-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-foreground">
                {group.label}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{group.description}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {group.reports.map((r) => {
                const Icon = r.icon;
                return (
                  <Link
                    key={r.id}
                    to="/app/reporting/$report"
                    params={{ report: r.id }}
                    className="group relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-md"
                  >
                    {/* Colored accent bar */}
                    <div className={`absolute inset-x-0 top-0 h-1 ${r.accent.bar}`} />

                    <div className="flex items-start justify-between gap-3">
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${r.accent.chip}`}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-primary" />
                    </div>

                    <h3 className="mt-3 text-[15px] font-semibold tracking-tight text-foreground">
                      {r.cardTitle}
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {r.description}
                    </p>

                    <div
                      className={`mt-4 inline-flex items-center gap-1 text-[11px] font-medium ${r.accent.text}`}
                    >
                      Open report
                      <ChevronRight className="h-3 w-3" />
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}

        {/* Static footer note — keeps the dashboard self-explanatory. */}
        <div className="rounded-lg border border-border/60 bg-muted/20 p-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <BarChart3 className="h-4 w-4 text-primary" /> How this dashboard works
          </div>
          <p className="mt-1.5 leading-relaxed">
            Every card opens a report page backed by the reports API. Sales invoices, purchase
            invoices and the aging report are server-paginated; the remaining reports load fully and
            filter in the browser. Use the filter bar to narrow rows and the Excel / PDF buttons to
            export exactly what you see — including the P&amp;L statement with your manual FX
            adjustments.
          </p>
        </div>
      </div>
    </div>
  );
}
