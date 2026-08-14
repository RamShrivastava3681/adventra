import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/ledger-ui";
import { MapPin, Plane, Receipt, CalendarDays, CheckCircle, XCircle, Loader2, Inbox } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/requests")({
  component: RequestsPage,
});

const TYPE_CONFIG = {
  visit: { icon: MapPin, label: "Visit", color: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300" },
  travel: { icon: Plane, label: "Travel", color: "bg-primary-soft text-[#0a4a8a] dark:text-[#63baff]" },
  expense: { icon: Receipt, label: "Expense", color: "bg-warning/10 text-warning" },
  leave: { icon: CalendarDays, label: "Leave", color: "bg-muted text-muted-foreground" },
} as const;

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-warning/10 text-warning",
  approved: "bg-primary/10 text-primary",
  rejected: "bg-red-100 text-red-700",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

function RequestsPage() {
  const { isReportingManager } = useAuth();
  const qc = useQueryClient();
  const [typeFilter, setTypeFilter] = useState<string>("");

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["team-requests", typeFilter],
    queryFn: () => api.requests.list(typeFilter || undefined),
    enabled: isReportingManager,
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.requests.updateStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-requests"] });
      toast.success("Status updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (!isReportingManager) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <div className="text-sm text-muted-foreground">Reporting manager access only.</div>
      </div>
    );
  }

  const pendingCount = requests.filter((r: any) => r.status === "pending").length;

  return (
    <div>
      <PageHeader
        eyebrow="Requests"
        title="Team requests"
        icon={<Inbox className="h-5 w-5" />}
        description={
          pendingCount > 0
            ? `${pendingCount} pending request${pendingCount > 1 ? "s" : ""} awaiting review`
            : "No pending requests"
        }
      />
      <div className="p-6 md:p-10">
        {/* Filter tabs */}
        <div className="flex gap-2">
          <button
            onClick={() => setTypeFilter("")}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
              !typeFilter
                ? "border-primary bg-primary/5 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            All
          </button>
          {Object.entries(TYPE_CONFIG).map(([key, cfg]) => {
            const Icon = cfg.icon;
            return (
              <button
                key={key}
                onClick={() => setTypeFilter(key)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                  typeFilter === key
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" /> {cfg.label}
              </button>
            );
          })}
        </div>

        {/* Loading state */}
        {isLoading ? (
          <div className="mt-8 flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading requests…
          </div>
        ) : requests.length === 0 ? (
          <div className="mt-8 py-12 text-center text-sm text-muted-foreground">
            No requests from your team members yet.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {requests.map((req: any) => {
              const typeCfg =
                TYPE_CONFIG[req.type as keyof typeof TYPE_CONFIG] || TYPE_CONFIG.visit;
              const TypeIcon = typeCfg.icon;
              const userName = req.user?.contactName || req.user?.email || "Unknown";

              return (
                <div
                  key={req.id}
                  className="rounded-xl border border-border bg-card p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {/* Header */}
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${typeCfg.color}`}
                        >
                          <TypeIcon className="h-3 w-3" /> {typeCfg.label}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[req.status] || "bg-muted text-muted-foreground"}`}
                        >
                          {STATUS_LABELS[req.status] || req.status}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(req.submittedAt).toLocaleDateString()}
                        </span>
                      </div>

                      {/* User info */}
                      <div className="mt-2 text-xs text-muted-foreground">
                        From: <span className="font-medium text-foreground">{userName}</span>
                        {req.user?.roles && (
                          <span className="ml-2 inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wider">
                            {req.user.roles[0]}
                          </span>
                        )}
                      </div>

                      {/* Data preview */}
                      <div className="mt-1.5 text-sm font-medium">
                        {req.data?.purpose ||
                          req.data?.reason ||
                          req.data?.description ||
                          req.data?.location ||
                          `${typeCfg.label} request`}
                      </div>

                      {/* Additional details */}
                      {(req.data?.location || req.data?.fromLocation) && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {req.data.location && `📍 ${req.data.location}`}
                          {req.data.fromLocation &&
                            `📍 ${req.data.fromLocation} → ${req.data.toLocation || ""}`}
                          {req.data.contactPerson && ` | 👤 ${req.data.contactPerson}`}
                        </div>
                      )}
                      {req.data?.amount && (
                        <div className="mt-0.5 text-xs font-medium text-foreground">
                          Amount: ${Number(req.data.amount).toLocaleString()}
                        </div>
                      )}
                      {(req.data?.fromDate || req.data?.date) && (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {req.data.fromDate
                            ? `${req.data.fromDate} → ${req.data.toDate || ""}`
                            : req.data.date}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    {req.status === "pending" && (
                      <div className="flex shrink-0 gap-1">
                        <button
                          onClick={() => updateStatus.mutate({ id: req.id, status: "approved" })}
                          disabled={updateStatus.isPending}
                          className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary-soft px-2.5 py-1.5 text-[10px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
                        >
                          <CheckCircle className="h-3.5 w-3.5" /> Approve
                        </button>
                        <button
                          onClick={() => updateStatus.mutate({ id: req.id, status: "rejected" })}
                          disabled={updateStatus.isPending}
                          className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[10px] font-medium text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50"
                        >
                          <XCircle className="h-3.5 w-3.5" /> Reject
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
