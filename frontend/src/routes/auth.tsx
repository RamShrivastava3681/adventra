import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
} from "lucide-react";

export const Route = createFileRoute("/auth")({
  validateSearch: z.object({ mode: z.enum(["signin", "signup"]).optional() }),
  component: AuthPage,
});

const PERKS = [
  "Advance against approved invoices in hours",
  "Live debtor risk, aging and alerts in real time",
  "Audit-ready accounting built in",
];

const STATS: [string, string][] = [
  ["₹2B+", "Invoices funded"],
  ["48h", "Average advance"],
  ["SOC 2", "Certified platform"],
];

const INPUT_CLS =
  "h-11 w-full rounded-lg border border-border bg-input pl-10 pr-3.5 text-sm text-foreground placeholder:text-muted-foreground shadow-sm outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/15";

function AuthPage() {
  const { mode: initialMode } = Route.useSearch();
  const [mode, setMode] = useState<"signin" | "signup">(initialMode ?? "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [loading, setLoading] = useState(false);
  const { user, refreshAuth } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) navigate({ to: "/app/dashboard", replace: true });
  }, [user, navigate]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        await api.auth.signup({ email, password, companyName });
        toast.success("Account created. You can now sign in.");
        setMode("signin");
      } else {
        // The server sets the session as an httpOnly cookie on success —
        // nothing to store client-side.
        await api.auth.login(email, password);
        toast.success("Welcome back.");
        // Re-check auth context so AppLayout sees the user immediately
        await refreshAuth();
        navigate({ to: "/app/dashboard", replace: true });
      }
    } catch (err) {
      console.error("[Auth] Login error:", err);
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden grid md:grid-cols-2">
      {/* ── Left brand panel ── */}
      <div className="relative hidden overflow-hidden border-r border-border bg-vault p-12 md:flex md:flex-col md:justify-between">
        <div className="absolute inset-0 grid-lines opacity-15" aria-hidden />

        <Link to="/" className="relative flex items-center gap-2.5">
          <img src="/logo.png" alt="Whizunik Command" className="h-8 w-auto rounded-md object-contain" />
          <span className="text-lg font-semibold tracking-tight">Whizunik Command</span>
        </Link>

        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
            </span>
            Vault access
          </div>
          <h2 className="mt-5 text-[34px] font-semibold leading-[1.15] tracking-tight text-balance">
            Capital moves at the speed of conviction.
          </h2>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
            Submit invoices, advance against them, and monitor the entire receivables book in one
            room.
          </p>
          <ul className="mt-8 space-y-3">
            {PERKS.map((perk) => (
              <li key={perk} className="flex items-center gap-2.5 text-sm text-foreground/80">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Check className="h-3 w-3" />
                </span>
                {perk}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            {STATS.map(([value, label]) => (
              <div key={label}>
                <div className="font-mono text-lg font-bold text-foreground">{value}</div>
                <div className="text-[11px] text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
          <div className="mt-6 text-xs text-muted-foreground">
            SOC 2 · ISO 27001 · 256-bit at rest
          </div>
        </div>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-md">
          <Link
            to="/"
            className="mb-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to site
          </Link>

          <div className="rounded-xl border border-border bg-card p-6 shadow-modal md:p-8">
            {/* Mobile brand */}
            <div className="mb-6 flex items-center gap-2 md:hidden">
              <img
                src="/logo.png"
                alt="Whizunik Command"
                className="h-7 w-auto rounded-md object-contain"
              />
              <span className="text-lg font-semibold tracking-tight">Whizunik Command</span>
            </div>

            <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
              {mode === "signup" ? "Create your account" : "Welcome back"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {mode === "signup"
                ? "Create an account to submit invoices and request advances."
                : "Resume monitoring your receivables."}
            </p>

            <form onSubmit={onSubmit} className="mt-7 space-y-4">
              {mode === "signup" && (
                <Field label="Company name" icon={<Building2 className="h-4 w-4" />}>
                  <input
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    required
                    className={INPUT_CLS}
                    placeholder="Acme Manufacturing"
                  />
                </Field>
              )}
              <Field label="Email" icon={<Mail className="h-4 w-4" />}>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className={INPUT_CLS}
                  placeholder="you@company.com"
                />
              </Field>
              <Field label="Password" icon={<Lock className="h-4 w-4" />}>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className={INPUT_CLS}
                  placeholder="••••••••"
                />
              </Field>

              <button
                disabled={loading}
                type="submit"
                className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {mode === "signup" ? "Create account" : "Sign in"}
                {!loading && <ArrowRight className="h-4 w-4" />}
              </button>
            </form>

            <div className="mt-6 border-t border-border pt-5 text-center text-sm text-muted-foreground">
              {mode === "signup" ? "Already have an account?" : "New here?"}{" "}
              <button
                onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {mode === "signup" ? "Sign in" : "Create account"}
              </button>
            </div>

            <p className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" /> Protected with 256-bit encryption
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <div className="relative">
        {icon && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            {icon}
          </span>
        )}
        {children}
      </div>
    </label>
  );
}
