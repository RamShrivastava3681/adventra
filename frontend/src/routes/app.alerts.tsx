import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api-client";
import { PageHeader, Card, fmtDate } from "@/components/ledger-ui";
import { BellRing, Check } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/alerts")({
  component: AlertsPage,
});

function AlertsPage() {
  const qc = useQueryClient();
  const alertsQ = useQuery({
    queryKey: ["alerts", "all"],
    queryFn: async () => {
      const data = await api.alerts.list();
      return (data ?? []).reverse();
    },
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await api.alerts.markRead(id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const items = alertsQ.data ?? [];
  const unread = items.filter((a) => !a.is_read).length;

  return (
    <div>
      <PageHeader
        eyebrow="Surveillance"
        title="Alerts"
        description="Real-time signals across overdue invoices, credit-limit breaches, and risk migrations."
        actions={
          <span className="rounded-full border border-border px-3 py-1 text-xs">
            <span className="num text-primary">{unread}</span> unread
          </span>
        }
      />
      <div className="p-6 md:p-10">
        <Card>
          {items.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <BellRing className="mx-auto mb-3 h-6 w-6" />
              No alerts. The vault is quiet.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((a) => (
                <li
                  key={a.id}
                  className={`flex items-start gap-4 p-4 ${a.is_read ? "opacity-60" : ""}`}
                >
                  <span
                    className={`mt-1.5 h-2.5 w-2.5 rounded-full ${
                      a.severity === "critical"
                        ? "bg-destructive"
                        : a.severity === "warning"
                          ? "bg-warning"
                          : "bg-primary"
                    }`}
                  />
                  <div className="flex-1">
                    <div className="text-sm">{a.message}</div>
                    <div className="mt-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                      {a.type} · {a.severity} · {fmtDate(a.created_at)}
                    </div>
                  </div>
                  {!a.is_read && (
                    <button
                      onClick={() => markRead.mutate(a.id)}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted"
                    >
                      <Check className="h-3 w-3" /> Mark read
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
