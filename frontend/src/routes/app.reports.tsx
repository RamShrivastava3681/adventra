import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/ledger-ui";
import {
  Users,
  Eye,
  Building2,
  Truck,
  FileText,
  ShoppingCart,
  FileSignature,
  Receipt,
  Wallet,
  ClipboardCheck,
  Banknote,
  Package,
  TrendingUp,
  Boxes,
  Shield,
  Settings,
  BellRing,
  Mail,
  Palette,
  BarChart3,
} from "lucide-react";

export const Route = createFileRoute("/app/reports")({
  component: ReportsPage,
});

// ─── Role icon mapping ──────────────────────────────────────────
const ROLE_ICONS: Record<string, any> = {
  sales_rep: Users,
  operations: FileText,
  checker: ClipboardCheck,
  treasury: Banknote,
  reporting_manager: Users,
  factor_admin: Shield,
};

const ROLE_COLORS: Record<string, string> = {
  sales_rep: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800/40",
  operations: "bg-primary-soft text-[#0a4a8a] border-primary/20 dark:text-[#63baff]",
  checker: "bg-warning/10 text-warning border-warning/20",
  treasury: "bg-primary/10 text-primary border-primary/20",
  reporting_manager: "bg-muted text-muted-foreground border-border",
  factor_admin: "bg-destructive/10 text-destructive border-destructive/20",
};

const ROLE_LABELS: Record<string, string> = {
  sales_rep: "Salesman",
  operations: "Operations",
  checker: "Checker",
  treasury: "Treasury",
  reporting_manager: "Reporting Manager",
  factor_admin: "Admin",
  client: "Client",
};

function ReportsPage() {
  const { user, isReportingManager } = useAuth();
  const navigate = useNavigate();

  const reportsQ = useQuery({
    queryKey: ["my-reports"],
    queryFn: async () => {
      if (!user?.id) return [];
      const data = await api.admin.getReports(user.id);
      return data;
    },
    enabled: !!user?.id && isReportingManager,
  });

  if (!isReportingManager) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <div className="text-center">
          <div className="text-sm text-muted-foreground">Reporting console access only.</div>
        </div>
      </div>
    );
  }

  const reports = reportsQ.data ?? [];

  return (
    <div>
      <PageHeader
        eyebrow="Reporting Manager"
        title="My Reports"
        icon={<BarChart3 className="h-5 w-5" />}
        description={`You have ${reports.length} team member${reports.length !== 1 ? "s" : ""} assigned to you.`}
      />

      <div className="p-6 md:p-10">
        {reportsQ.isLoading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Loading your team…</div>
        ) : reports.length === 0 ? (
          <div className="py-12 text-center">
            <Users className="mx-auto h-12 w-12 text-muted-foreground/30" />
            <div className="mt-4 text-sm font-medium text-muted-foreground">
              No team members assigned yet
            </div>
            <div className="mt-1 text-xs text-muted-foreground/60">
              An admin needs to assign users to you from the Operations page.
            </div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {reports.map((report: any) => {
              const primaryRole =
                (report.roles ?? []).find((r: string) => r !== "client") || "client";
              const RoleIcon = ROLE_ICONS[primaryRole] || Users;
              const roleColor =
                ROLE_COLORS[primaryRole] || "bg-muted text-muted-foreground border-border";
              const reportName = report.contact_name || report.company_name || report.email;

              return (
                <div
                  key={report.id}
                  className="group relative rounded-xl border border-border bg-card p-5 shadow-sm transition-all duration-200 hover:shadow-md hover:border-primary/20"
                >
                  {/* Role badge */}
                  <div
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${roleColor}`}
                  >
                    <RoleIcon className="h-3 w-3" />
                    {ROLE_LABELS[primaryRole] || primaryRole}
                  </div>

                  {/* User info */}
                  <div className="mt-3">
                    <div className="font-medium text-sm text-foreground">{reportName}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{report.email}</div>
                  </div>

                  {/* All roles */}
                  {(report.roles ?? []).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {(report.roles as string[]).map((r: string) => (
                        <span
                          key={r}
                          className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground"
                        >
                          {ROLE_LABELS[r] || r}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* View workspace button */}
                  <button
                    onClick={() => {
                      // Navigate to team member's workspace with view-as context
                      navigate({
                        to: "/app/workspace",
                        search: { viewAsUserId: report.id },
                      });
                    }}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground transition-all hover:bg-primary/5 hover:text-primary hover:border-primary/30 group-hover:border-primary/20"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    View workspace
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Info footer */}
        <div className="mt-8 rounded-lg border border-border/50 bg-muted/20 p-4">
          <div className="flex items-start gap-3">
            <Eye className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <div className="text-xs font-medium text-foreground">View-as mode</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">
                Clicking "View workspace" opens the team member's own workspace — you'll see their
                tabs (e.g. CRM / Leads for salespeople) in the sidebar along with the data they've
                entered, in read-only mode. A banner at the top lets you exit anytime.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
