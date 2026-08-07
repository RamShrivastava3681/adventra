import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney, daysBetween } from "@/components/ledger-ui";
import { Zap, Shield, UserPlus, Eye, EyeOff, Users, ChevronDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";

export const Route = createFileRoute("/app/admin")({
  component: AdminPage,
});

// ─── Role display config ──────────────────────────────────────
const ROLE_OPTIONS = [
  { value: "sales_rep", label: "Salesman" },
  { value: "operations", label: "Operations" },
  { value: "checker", label: "Checker" },
  { value: "treasury", label: "Treasury" },
  { value: "reporting_manager", label: "Reporting Manager" },
  { value: "factor_admin", label: "Admin" },
] as const;

const ROLE_COLORS: Record<string, string> = {
  sales_rep: "bg-blue-100 text-blue-700",
  operations: "bg-purple-100 text-purple-700",
  checker: "bg-amber-100 text-amber-700",
  treasury: "bg-emerald-100 text-emerald-700",
  reporting_manager: "bg-rose-100 text-rose-700",
  factor_admin: "bg-red-100 text-red-700",
};

const ROLE_LABELS: Record<string, string> = {
  sales_rep: "Salesman",
  operations: "Operations",
  checker: "Checker",
  treasury: "Treasury",
  reporting_manager: "Reporting Mgr",
  factor_admin: "Admin",
};

function AdminPage() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // ── Create user form state ──
  const [form, setForm] = useState({
    contactName: "",
    email: "",
    password: "",
    role: "sales_rep",
    managerId: "",
  });

  const resetForm = () =>
    setForm({ contactName: "", email: "", password: "", role: "sales_rep", managerId: "" });

  const invoicesQ = useQuery({
    queryKey: ["invoices-admin"],
    queryFn: async () => {
      const data = await api.invoices.list();
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
      return data.flatMap((u: any) =>
        (u.roles ?? []).map((r: string) => ({ user_id: u.id, role: r })),
      );
    },
    enabled: isAdmin,
  });
  const managersQ = useQuery({
    queryKey: ["managers-admin"],
    queryFn: async () => {
      const data = await api.admin.listManagers();
      return data;
    },
    enabled: isAdmin,
  });
  const managerAssign = useMutation({
    mutationFn: async ({ userId, managerId }: { userId: string; managerId: string | null }) => {
      await api.admin.assignManager(userId, managerId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profiles-admin"] });
      qc.invalidateQueries({ queryKey: ["managers-admin"] });
      toast.success("Manager assigned");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const toggleRole = useMutation({
    mutationFn: async ({ user_id, role, add }: { user_id: string; role: string; add: boolean }) => {
      await api.admin.updateRole(user_id, role, add);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user_roles-admin"] });
      toast.success("Role updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const createUser = useMutation({
    mutationFn: async () => {
      if (!form.email || !form.password) throw new Error("Email and password are required");
      await api.admin.createUser({
        email: form.email,
        password: form.password,
        contactName: form.contactName || undefined,
        role: form.role,
        managerId: form.managerId || undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profiles-admin"] });
      qc.invalidateQueries({ queryKey: ["user_roles-admin"] });
      qc.invalidateQueries({ queryKey: ["managers-admin"] });
      toast.success("User created successfully");
      setCreateOpen(false);
      resetForm();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to create user"),
  });

  const generateAlerts = useMutation({
    mutationFn: async () => {
      const invoices = invoicesQ.data ?? [];
      const inserts: any[] = [];

      for (const i of invoices) {
        if (i.status === "paid" || i.status === "rejected") continue;
        const dpd = i.due_date ? daysBetween(i.due_date) : 0;
        if (dpd > 0) {
          inserts.push({
            client_id: i.client_id,
            invoice_id: i.id,
            debtor_id: i.debtor_id,
            type: "overdue",
            severity: dpd > 60 ? "critical" : dpd > 30 ? "warning" : "info",
            message: `Invoice ${i.invoice_number} overdue ${dpd} days — ${fmtMoney(i.amount)}`,
          });
        }
        if (Number(i.amount) >= 100000) {
          inserts.push({
            client_id: i.client_id,
            invoice_id: i.id,
            debtor_id: i.debtor_id,
            type: "large_invoice",
            severity: "info",
            message: `Large invoice received: ${fmtMoney(i.amount)} from ${(i as any).debtor?.name ?? "debtor"}`,
          });
        }
      }
      if (inserts.length === 0) return 0;
      await api.alerts.generate();
      return inserts.length;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ["alerts"] });
      toast.success(`Generated ${n} alerts`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (!isAdmin) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <div className="text-center">
          <div className="text-sm text-muted-foreground">Factor admin only.</div>
        </div>
      </div>
    );
  }

  const invoices = invoicesQ.data ?? [];
  const tot = (st: string[]) =>
    invoices.filter((i) => st.includes(i.status)).reduce((s, i) => s + Number(i.amount), 0);

  const profiles = profilesQ.data ?? [];
  const roles = rolesQ.data ?? [];
  const rolesByUser = new Map<string, string[]>();
  roles.forEach((r: any) => {
    const arr = rolesByUser.get(r.user_id) ?? [];
    arr.push(r.role);
    rolesByUser.set(r.user_id, arr);
  });

  // Build manager name lookup (user id → name/email)
  const managerLookup = new Map<string, string>();
  profiles.forEach((p: any) => {
    const name = p.contact_name || p.company_name || p.email;
    managerLookup.set(p.id, name);
  });

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="Risk & operations console"
        description="Generate alerts, manage team roles, and act on exceptions."
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => generateAlerts.mutate()}
              disabled={generateAlerts.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              <Zap className="h-4 w-4" /> Run monitoring scan
            </button>
          </div>
        }
      />
      <div className="grid gap-4 p-6 md:grid-cols-4 md:p-10">
        <Card title="Pending review">
          <div className="num text-3xl">
            {invoices.filter((i) => i.status === "pending").length}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{fmtMoney(tot(["pending"]))}</div>
        </Card>
        <Card title="Approved (to fund)">
          <div className="num text-3xl text-primary">
            {invoices.filter((i) => i.status === "approved").length}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{fmtMoney(tot(["approved"]))}</div>
        </Card>
        <Card title="Funded">
          <div className="num text-3xl text-success">
            {invoices.filter((i) => i.status === "advanced").length}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{fmtMoney(tot(["advanced"]))}</div>
        </Card>
        <Card title="Overdue / rejected">
          <div className="num text-3xl text-destructive">
            {invoices.filter((i) => i.status === "overdue" || i.status === "rejected").length}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {fmtMoney(tot(["overdue", "rejected"]))}
          </div>
        </Card>
      </div>

      {/* ── Team & Roles ───────────────────────────────────── */}
      <div className="px-6 pb-10 md:px-10">
        <Card
          title="Team & roles"
          action={
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <button className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                  <UserPlus className="h-3.5 w-3.5" /> Create user
                </button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[460px]">
                <DialogHeader>
                  <DialogTitle>Create user</DialogTitle>
                  <DialogDescription>
                    Add a new team member with an initial role. They'll receive no email — share
                    their credentials securely.
                  </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-3">
                  {/* Full name */}
                  <div className="grid gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Full name</label>
                    <input
                      value={form.contactName}
                      onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                      placeholder="e.g. Jane Doe"
                      className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  {/* Email */}
                  <div className="grid gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Email *</label>
                    <input
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      placeholder="e.g. jane@company.com"
                      type="email"
                      className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  {/* Password */}
                  <div className="grid gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Password *</label>
                    <div className="relative">
                      <input
                        value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                        placeholder="Minimum 6 characters"
                        type={showPassword ? "text" : "password"}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-9 text-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const gen =
                          Math.random().toString(36).slice(2, 10) +
                          Math.random().toString(36).toUpperCase().slice(2, 6);
                        setForm({ ...form, password: gen });
                        setShowPassword(true);
                      }}
                      className="mt-0.5 self-start text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    >
                      Generate secure password
                    </button>
                  </div>

                  {/* Role */}
                  <div className="grid gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Initial role *
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {ROLE_OPTIONS.map((opt) => {
                        const selected = form.role === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setForm({ ...form, role: opt.value })}
                            className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-all duration-150 ${
                              selected
                                ? "border-primary bg-primary/5 ring-1 ring-primary font-medium"
                                : "border-border hover:border-primary/50 hover:bg-muted/30"
                            }`}
                          >
                            <span className="text-xs">{opt.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Reporting Manager (only for non-admin, non-RM roles) */}
                  {form.role !== "factor_admin" && form.role !== "reporting_manager" && (
                    <div className="grid gap-1.5">
                      <label className="text-xs font-medium text-muted-foreground">
                        Reporting manager{" "}
                        <span className="text-[10px] text-muted-foreground/60">(optional)</span>
                      </label>
                      <select
                        value={form.managerId}
                        onChange={(e) => setForm({ ...form, managerId: e.target.value })}
                        className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
                      >
                        <option value="">— None —</option>
                        {(managersQ.data ?? []).map((m: any) => (
                          <option key={m.id} value={m.id}>
                            {m.contact_name || m.company_name || m.email}
                          </option>
                        ))}
                      </select>
                      {managersQ.data?.length === 0 && (
                        <p className="text-[10px] text-muted-foreground">
                          No reporting managers exist yet. Create one first.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <DialogFooter>
                  <button
                    onClick={() => {
                      setCreateOpen(false);
                      resetForm();
                    }}
                    className="rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => createUser.mutate()}
                    disabled={createUser.isPending || !form.email || !form.password}
                    className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    {createUser.isPending ? (
                      <>Creating…</>
                    ) : (
                      <>
                        <UserPlus className="h-4 w-4" /> Create user
                      </>
                    )}
                  </button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          }
        >
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
                    <th className="px-5 py-2 text-left font-normal">Roles</th>
                    <th className="px-5 py-2 text-left font-normal">Reporting Manager</th>
                    <th className="px-5 py-2 text-right font-normal">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((p: any) => {
                    const userRoles = rolesByUser.get(p.id) ?? [];
                    const mgrName = p.reportingManagerId
                      ? managerLookup.get(p.reportingManagerId)
                      : null;
                    return (
                      <tr key={p.id} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-3">
                          <div>{p.contact_name || p.company_name || "—"}</div>
                          <div className="text-xs text-muted-foreground">{p.company_name}</div>
                        </td>
                        <td className="px-5 py-3 text-muted-foreground">{p.email}</td>
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap gap-1">
                            {userRoles.length === 0 ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              userRoles.map((r: string) => (
                                <span
                                  key={r}
                                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${ROLE_COLORS[r] || "bg-muted text-muted-foreground"}`}
                                >
                                  {ROLE_LABELS[r] || r}
                                </span>
                              ))
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            {mgrName ? (
                              <span className="text-xs text-muted-foreground">{mgrName}</span>
                            ) : (
                              <span className="text-xs text-muted-foreground/50">—</span>
                            )}
                            <Popover>
                              <PopoverTrigger asChild>
                                <button className="rounded-md border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground">
                                  {mgrName ? "Change" : "Assign"}
                                </button>
                              </PopoverTrigger>
                              <PopoverContent className="w-56 p-2" align="start">
                                <div className="space-y-1">
                                  <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                    Select manager
                                  </p>
                                  {p.reporting_manager_id && (
                                    <button
                                      onClick={() => {
                                        managerAssign.mutate({ userId: p.id, managerId: null });
                                      }}
                                      className="w-full rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted"
                                    >
                                      — Clear assignment —
                                    </button>
                                  )}
                                  {managersQ.data
                                    ?.filter((m: any) => m.id !== p.id)
                                    .map((m: any) => (
                                      <button
                                        key={m.id}
                                        onClick={() => {
                                          managerAssign.mutate({ userId: p.id, managerId: m.id });
                                        }}
                                        className={`w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted ${
                                          p.reporting_manager_id === m.id
                                            ? "bg-primary/5 font-medium"
                                            : ""
                                        }`}
                                      >
                                        {m.contact_name || m.company_name || m.email}
                                      </button>
                                    ))}
                                </div>
                              </PopoverContent>
                            </Popover>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {/* Role toggle buttons */}
                            {ROLE_OPTIONS.map((opt) => {
                              const hasRole = userRoles.includes(opt.value);
                              return (
                                <button
                                  key={opt.value}
                                  onClick={() =>
                                    toggleRole.mutate({
                                      user_id: p.id,
                                      role: opt.value,
                                      add: !hasRole,
                                    })
                                  }
                                  disabled={toggleRole.isPending}
                                  className={`rounded-md border px-2 py-1 text-[10px] font-medium transition-all ${
                                    hasRole
                                      ? `${ROLE_COLORS[opt.value] || "bg-muted text-muted-foreground"} border-current/30`
                                      : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                                  }`}
                                  title={`${hasRole ? "Revoke" : "Grant"} ${opt.label}`}
                                >
                                  {opt.label}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-[10px] text-muted-foreground">
            Checkers approve newly submitted invoices into the funding queue (maker–checker).
            Treasury then pays supplier advances on approval, settles balances on the due date, and
            records debtor receipts. Marking an invoice paid closes it and removes it from the
            queue. New roles (Operations, Reporting Manager) are placeholders — working permissions
            can be configured later.
          </p>
        </Card>
      </div>
    </div>
  );
}
