import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney, daysBetween } from "@/components/ledger-ui";
import { Zap, Shield } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/admin")({
  component: AdminPage,
});

function AdminPage() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();

  const invoicesQ = useQuery({
    queryKey: ["invoices-admin"],
    queryFn: async () => {
      const data = await api.invoices.list();
      return data;
    },
    enabled: isAdmin,
  });
  const debtorsQ = useQuery({
    queryKey: ["debtors-admin"],
    queryFn: async () => {
      const data = await api.debtors.list();
      return data;
    },
    enabled: isAdmin,
  });

  // Team & roles
  const profilesQ = useQuery({
    queryKey: ["profiles-admin"],
    queryFn: async () => {
      const data = await api.admin.users();
      return data;
    },
    enabled: isAdmin,
  });
  const rolesQ = useQuery({
    queryKey: ["user_roles-admin"],
    queryFn: async () => {
      const data = await api.admin.users();
      // Extract roles from users
      return data.flatMap((u: any) => (u.roles ?? []).map((r: string) => ({ user_id: u.id, role: r })));
    },
    enabled: isAdmin,
  });

  const toggleRole = useMutation({
    mutationFn: async ({ user_id, role, add }: { user_id: string; role: string; add: boolean }) => {
      await api.admin.updateRole(user_id, role, add);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["user_roles-admin"] }); toast.success("Role updated"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const generateAlerts = useMutation({
    mutationFn: async () => {
      const invoices = invoicesQ.data ?? [];
      const debtors = debtorsQ.data ?? [];
      const inserts: any[] = [];

      for (const i of invoices) {
        if (i.status === "paid" || i.status === "rejected") continue;
        const dpd = i.due_date ? daysBetween(i.due_date) : 0;
        if (dpd > 0) {
          inserts.push({
            client_id: i.client_id, invoice_id: i.id, debtor_id: i.debtor_id,
            type: "overdue",
            severity: dpd > 60 ? "critical" : dpd > 30 ? "warning" : "info",
            message: `Invoice ${i.invoice_number} overdue ${dpd} days — ${fmtMoney(i.amount)}`,
          });
        }
        if (Number(i.amount) >= 100000) {
          inserts.push({
            client_id: i.client_id, invoice_id: i.id, debtor_id: i.debtor_id,
            type: "large_invoice", severity: "info",
            message: `Large invoice received: ${fmtMoney(i.amount)} from ${(i as any).debtor?.name ?? "debtor"}`,
          });
        }
      }
      for (const d of debtors) {
        const exposure = invoices.filter((i) => i.debtor_id === d.id && i.status !== "paid" && i.status !== "rejected").reduce((s, i) => s + Number(i.amount), 0);
        const util = Number(d.credit_limit) > 0 ? exposure / Number(d.credit_limit) : 0;
        if (util > 0.85) {
          inserts.push({
            client_id: null, debtor_id: d.id,
            type: "credit_limit",
            severity: util > 1 ? "critical" : "warning",
            message: `${d.name} at ${(util * 100).toFixed(0)}% of credit limit (${fmtMoney(exposure)} / ${fmtMoney(d.credit_limit)})`,
          });
        }
        if (d.risk_score < 40) {
          inserts.push({
            client_id: null, debtor_id: d.id,
            type: "risk_change", severity: "warning",
            message: `${d.name} risk score is low (${d.risk_score})`,
          });
        }
      }
      if (inserts.length === 0) return 0;
      await api.alerts.generate();
      return inserts.length;
    },
    onSuccess: (n) => { qc.invalidateQueries({ queryKey: ["alerts"] }); toast.success(`Generated ${n} alerts`); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (!isAdmin) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <div className="text-center"><div className="text-sm text-muted-foreground">Factor admin only.</div></div>
      </div>
    );
  }

  const invoices = invoicesQ.data ?? [];
  const tot = (st: string[]) => invoices.filter((i) => st.includes(i.status)).reduce((s, i) => s + Number(i.amount), 0);

  const profiles = profilesQ.data ?? [];
  const roles = rolesQ.data ?? [];
  const rolesByUser = new Map<string, string[]>();
  roles.forEach((r: any) => {
    const arr = rolesByUser.get(r.user_id) ?? [];
    arr.push(r.role);
    rolesByUser.set(r.user_id, arr);
  });

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="Risk & operations console"
        description="Generate alerts, manage team roles, and act on exceptions."
        actions={
          <button onClick={() => generateAlerts.mutate()} disabled={generateAlerts.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            <Zap className="h-4 w-4" /> Run monitoring scan
          </button>
        }
      />
      <div className="grid gap-4 p-6 md:grid-cols-4 md:p-10">
        <Card title="Pending review">
          <div className="num text-3xl">{invoices.filter((i) => i.status === "pending").length}</div>
          <div className="mt-1 text-xs text-muted-foreground">{fmtMoney(tot(["pending"]))}</div>
        </Card>
        <Card title="Approved (to fund)">
          <div className="num text-3xl text-primary">{invoices.filter((i) => i.status === "approved").length}</div>
          <div className="mt-1 text-xs text-muted-foreground">{fmtMoney(tot(["approved"]))}</div>
        </Card>
        <Card title="Funded">
          <div className="num text-3xl text-success">{invoices.filter((i) => i.status === "advanced").length}</div>
          <div className="mt-1 text-xs text-muted-foreground">{fmtMoney(tot(["advanced"]))}</div>
        </Card>
        <Card title="Overdue / rejected">
          <div className="num text-3xl text-destructive">{invoices.filter((i) => i.status === "overdue" || i.status === "rejected").length}</div>
          <div className="mt-1 text-xs text-muted-foreground">{fmtMoney(tot(["overdue", "rejected"]))}</div>
        </Card>
      </div>

      <div className="px-6 pb-10 md:px-10">
        <Card title="Team & roles" action={<span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Shield className="h-3 w-3" /> assign access</span>}>
          {profilesQ.isLoading ? (
            <div className="py-6 text-center text-sm text-muted-foreground">Loading…</div>
          ) : profiles.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">No users yet.</div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">User</th>
                    <th className="px-5 py-2 text-left font-normal">Email</th>
                    <th className="px-5 py-2 text-left font-normal">Current roles</th>
                    <th className="px-5 py-2 text-right font-normal">Checker</th>
                    <th className="px-5 py-2 text-right font-normal">Treasury</th>
                    <th className="px-5 py-2 text-right font-normal">Factor admin</th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((p: any) => {
                    const userRoles = rolesByUser.get(p.id) ?? [];
                    const hasChecker = userRoles.includes("checker");
                    const hasTreasury = userRoles.includes("treasury");
                    const hasAdmin = userRoles.includes("factor_admin");
                    return (
                      <tr key={p.id} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-3">
                          <div>{p.contact_name || p.company_name || "—"}</div>
                          <div className="text-xs text-muted-foreground">{p.company_name}</div>
                        </td>
                        <td className="px-5 py-3 text-muted-foreground">{p.email}</td>
                        <td className="px-5 py-3">
                          {userRoles.length === 0 ? <span className="text-xs text-muted-foreground">—</span> : userRoles.map((r) => (
                            <span key={r} className="mr-1 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-widest">{r}</span>
                          ))}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button onClick={() => toggleRole.mutate({ user_id: p.id, role: "checker", add: !hasChecker })}
                            className={`rounded-md border px-2.5 py-1 text-xs ${hasChecker ? "border-warning/50 bg-warning/10 text-warning" : "border-border text-muted-foreground hover:text-foreground"}`}>
                            {hasChecker ? "Revoke" : "Grant"}
                          </button>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button onClick={() => toggleRole.mutate({ user_id: p.id, role: "treasury", add: !hasTreasury })}
                            className={`rounded-md border px-2.5 py-1 text-xs ${hasTreasury ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
                            {hasTreasury ? "Revoke" : "Grant"}
                          </button>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button onClick={() => toggleRole.mutate({ user_id: p.id, role: "factor_admin", add: !hasAdmin })}
                            className={`rounded-md border px-2.5 py-1 text-xs ${hasAdmin ? "border-destructive/50 bg-destructive/10 text-destructive" : "border-border text-muted-foreground hover:text-foreground"}`}>
                            {hasAdmin ? "Revoke" : "Grant"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-[10px] text-muted-foreground">Checkers approve newly submitted invoices into the funding queue (maker–checker). Treasury then pays supplier advances on approval, settles balances on the due date, and records debtor receipts. Marking an invoice paid closes it and removes it from the queue.</p>
        </Card>
      </div>
    </div>
  );
}
