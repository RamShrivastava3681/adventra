import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card } from "@/components/ledger-ui";
import { Shield, Loader2, Settings } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { user, isAdmin, refreshRoles } = useAuth();
  const [profile, setProfile] = useState({ company_name: "", contact_name: "" });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    api.auth
      .me()
      .then((data: any) => {
        if (data)
          setProfile({
            company_name: data.companyName ?? data.company_name ?? "",
            contact_name: data.contactName ?? data.contact_name ?? "",
          });
      })
      .catch(() => {});
  }, [user]);

  const save = async () => {
    setLoading(true);
    try {
      await api.auth.updateProfile({
        company_name: profile.company_name,
        contact_name: profile.contact_name,
      });
      toast.success("Profile saved");
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    }
    setLoading(false);
  };

  const becomeAdmin = async () => {
    setLoading(true);
    try {
      await api.admin.updateRole(user!.id, "factor_admin", true);
      toast.success("You now have factor admin access. Reloading…");
      await refreshRoles();
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    }
    setLoading(false);
  };

  return (
    <div>
      <PageHeader eyebrow="Account" title="Settings" icon={<Settings className="h-5 w-5" />} />
      <div className="grid gap-6 p-6 md:grid-cols-2 md:p-10">
        <Card title="Company profile">
          <div className="space-y-3">
            <L label="Company name">
              <input
                className="inp"
                value={profile.company_name}
                onChange={(e) => setProfile({ ...profile, company_name: e.target.value })}
              />
            </L>
            <L label="Contact name">
              <input
                className="inp"
                value={profile.contact_name}
                onChange={(e) => setProfile({ ...profile, contact_name: e.target.value })}
              />
            </L>
            <L label="Email">
              <input className="inp" value={user?.email ?? ""} disabled />
            </L>
            <button
              onClick={save}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />} Save
            </button>
          </div>
        </Card>

        <Card title="Access level">
          <div className="flex items-start gap-3">
            <Shield className="mt-1 h-5 w-5 text-primary" />
            <div className="flex-1">
              <div className="font-medium">{isAdmin ? "Factor admin" : "Client"}</div>
              <p className="mt-1 text-sm text-muted-foreground">
                {isAdmin
                  ? "You can view every client's invoices, manage debtors, approve advances, and issue alerts."
                  : "You can submit invoices for your company and monitor their status."}
              </p>
              {!isAdmin && (
                <div className="mt-4 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
                  <div className="font-medium text-warning">Demo: enable factor admin</div>
                  <p className="mt-1 text-muted-foreground">
                    For demonstration purposes, you can grant yourself factor admin to explore the
                    operations console. In production, this would be granted out-of-band.
                  </p>
                  <button
                    onClick={becomeAdmin}
                    disabled={loading}
                    className="mt-3 rounded-md border border-warning/40 px-3 py-1.5 text-xs text-warning hover:bg-warning/10"
                  >
                    Promote to factor admin
                  </button>
                </div>
              )}
            </div>
          </div>
        </Card>
      </div>
      <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}.inp:disabled{opacity:.6}`}</style>
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
