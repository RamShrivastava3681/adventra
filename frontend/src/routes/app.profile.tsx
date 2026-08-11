import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import api from "@/lib/api-client";
import { PageHeader, Card } from "@/components/ledger-ui";
import { User, Camera, Loader2, Save } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";

export const Route = createFileRoute("/app/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const { user, refreshAuth } = useAuth();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    contactName: "",
    companyName: "",
    email: "",
    phone: "",
    address: "",
    photoUrl: "",
  });

  useEffect(() => {
    if (!user) return;
    api.auth
      .me()
      .then((data: any) => {
        setForm({
          contactName: data.contactName ?? data.contact_name ?? "",
          companyName: data.companyName ?? data.company_name ?? "",
          email: data.email ?? "",
          phone: data.phone ?? "",
          address: data.address ?? "",
          photoUrl: data.photoUrl ?? data.photo_url ?? "",
        });
      })
      .catch(() => {});
  }, [user]);

  const save = async () => {
    setSaving(true);
    try {
      await api.auth.updateProfile({
        contactName: form.contactName,
        companyName: form.companyName,
        phone: form.phone,
        address: form.address,
        photoUrl: form.photoUrl,
      });
      toast.success("Profile saved");
      refreshAuth();
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    }
    setSaving(false);
  };

  return (
    <div>
      <PageHeader
        eyebrow="Account"
        title="Profile"
        description="Manage your personal information and photo."
        icon={<User className="h-5 w-5" />}
      />
      <div className="grid gap-6 p-6 md:grid-cols-3 md:p-10">
        {/* Photo card */}
        <Card title="Photo">
          <div className="flex flex-col items-center gap-4 py-4">
            <Avatar className="h-24 w-24">
              <AvatarImage src={form.photoUrl || undefined} />
              <AvatarFallback className="bg-primary/10 text-3xl text-primary">
                {(form.contactName || form.email || "U").charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-4 py-2 text-xs font-medium hover:border-primary hover:text-primary">
              <Camera className="h-4 w-4" /> Upload photo
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    setForm({ ...form, photoUrl: reader.result as string });
                  };
                  reader.readAsDataURL(file);
                }}
              />
            </label>
            {form.photoUrl && (
              <button
                onClick={() => setForm({ ...form, photoUrl: "" })}
                className="text-[10px] text-muted-foreground underline hover:text-destructive"
              >
                Remove photo
              </button>
            )}
          </div>
        </Card>

        {/* Info card */}
        <Card title="Personal information" className="md:col-span-2">
          <div className="space-y-4">
            <Field label="Full name">
              <input
                className="inp"
                value={form.contactName}
                onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                placeholder="Your name"
              />
            </Field>
            <Field label="Company">
              <input
                className="inp"
                value={form.companyName}
                onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                placeholder="Company name"
              />
            </Field>
            <Field label="Email">
              <input className="inp" value={form.email} disabled placeholder="email@company.com" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Phone">
                <input
                  className="inp"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+1 555-0000"
                />
              </Field>
              <Field label="Address">
                <input
                  className="inp"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  placeholder="123 Main St"
                />
              </Field>
            </div>
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save changes
            </button>
          </div>
        </Card>
      </div>
      <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}.inp:disabled{opacity:.6}`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
