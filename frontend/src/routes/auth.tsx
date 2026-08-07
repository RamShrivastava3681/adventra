import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/auth")({
  validateSearch: z.object({ mode: z.enum(["signin", "signup"]).optional() }),
  component: AuthPage,
});

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
        const result = await api.auth.login(email, password);
        api.auth.setToken(result.token);
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
    <div className="min-h-screen grid md:grid-cols-2">
      {/* Left brand */}
      <div className="relative hidden border-r border-border bg-vault p-12 md:flex md:flex-col md:justify-between">
        <div className="absolute inset-0 grid-lines opacity-20" aria-hidden />
        <Link to="/" className="relative flex items-center gap-2">
          <img src="/logo.png" alt="Adventra" className="h-8 w-auto rounded-md object-contain" />
          <span className="font-display text-xl">Adventra</span>
        </Link>
        <div className="relative">
          <p className="text-xs uppercase tracking-[0.2em] text-primary">Vault access</p>
          <h2 className="mt-3 font-display text-4xl leading-tight text-balance">
            Capital moves at the speed of conviction.
          </h2>
          <p className="mt-4 max-w-md text-sm text-muted-foreground">
            Submit invoices, advance against them, and monitor the entire receivables book in one
            room.
          </p>
        </div>
        <div className="relative text-xs text-muted-foreground">
          SOC 2 · ISO 27001 · 256-bit at rest
        </div>
      </div>

      {/* Right form */}
      <div className="flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-md">
          <h1 className="font-display text-3xl">
            {mode === "signup" ? "Create your account" : "Sign in"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === "signup"
              ? "Create an account to submit invoices and request advances."
              : "Resume monitoring your receivables."}
          </p>

          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            {mode === "signup" && (
              <Field label="Company name">
                <input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  required
                  className="input"
                  placeholder="Acme Manufacturing"
                />
              </Field>
            )}
            <Field label="Email">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="input"
                placeholder="you@company.com"
              />
            </Field>
            <Field label="Password">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="input"
                placeholder="••••••••"
              />
            </Field>

            <button disabled={loading} type="submit" className="btn-primary mt-2 w-full px-4 py-3">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === "signup" ? "Create account" : "Sign in"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "signup" ? "Already have an account?" : "New here?"}{" "}
            <button
              onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
              className="text-primary underline-offset-4 hover:underline"
            >
              {mode === "signup" ? "Sign in" : "Create account"}
            </button>
          </p>
        </div>
      </div>

      <style>{`
        .input {
          width: 100%;
          background: #F8FAFC;
          border: 1px solid #E2E8F0;
          color: #0F172A;
          border-radius: 10px;
          padding: 0.65rem 0.85rem;
          font-size: 0.875rem;
          outline: none;
          transition: all 200ms ease;
        }
        .input::placeholder { color: #94A3B8; }
        .input:focus { border-color: #00B8FF; box-shadow: 0 0 0 3px rgba(0,184,255,0.1); }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
