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
  const { user, isAdmin, refreshAuth } = useAuth();
  const [profile, setProfile] = useState({ company_name: "", contact_name: "", company_address: "" });
  const [bank, setBank] = useState({
    bank_holder: "",
    bank_name: "",
    bank_ac_no: "",
    bank_ifsc: "",
    bank_branch: "",
  });
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
            company_address: data.address ?? "",
          });
      })
      .catch(() => {});
    api.invoiceTemplates
      .get()
      .then((data: any) => {
        if (data)
          setBank({
            bank_holder: data.bank_holder ?? "",
            bank_name: data.bank_name ?? "",
            bank_ac_no: data.bank_ac_no ?? "",
            bank_ifsc: data.bank_ifsc ?? "",
            bank_branch: data.bank_branch ?? "",
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
        address: profile.company_address,
      });
      // Keep the invoice template in sync so the company details are used
      // everywhere (sales order PDFs read the profile first, invoice previews
      // read the template).
      try {
        await api.invoiceTemplates.update({
          company_name: profile.company_name,
          company_address: profile.company_address,
          bank_holder: bank.bank_holder || null,
          bank_name: bank.bank_name || null,
          bank_ac_no: bank.bank_ac_no || null,
          bank_ifsc: bank.bank_ifsc || null,
          bank_branch: bank.bank_branch || null,
        });
      } catch {
        toast.error("Profile saved, but template sync failed — open Invoice template and save again");
      }
      refreshAuth();
      toast.success("Profile saved");
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
            <L label="Company address (used on all documents)">
              <textarea
                rows={3}
                className="inp resize-y"
                value={profile.company_address}
                onChange={(e) => setProfile({ ...profile, company_address: e.target.value })}
                placeholder="209, 2nd Floor, Garg Tower, H-1, District Center Netaji Subhash Place, PITAMPURA, New Delhi-110034"
              />
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

        <Card title="Company bank details">
          <div className="space-y-3">
            <p className="-mt-1 text-xs text-muted-foreground">
              Printed as the bank table on sales order PDFs. Saved to the invoice template.
            </p>
            <L label="A/c holder's name">
              <input
                className="inp"
                value={bank.bank_holder}
                onChange={(e) => setBank({ ...bank, bank_holder: e.target.value })}
              />
            </L>
            <L label="Bank name">
              <input
                className="inp"
                value={bank.bank_name}
                onChange={(e) => setBank({ ...bank, bank_name: e.target.value })}
              />
            </L>
            <div className="grid gap-3 md:grid-cols-2">
              <L label="A/c no.">
                <input
                  className="inp"
                  value={bank.bank_ac_no}
                  onChange={(e) => setBank({ ...bank, bank_ac_no: e.target.value })}
                />
              </L>
              <L label="IFSC code">
                <input
                  className="inp"
                  value={bank.bank_ifsc}
                  onChange={(e) => setBank({ ...bank, bank_ifsc: e.target.value })}
                />
              </L>
            </div>
            <L label="Branch">
              <input
                className="inp"
                value={bank.bank_branch}
                onChange={(e) => setBank({ ...bank, bank_branch: e.target.value })}
              />
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
