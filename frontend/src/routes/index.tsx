import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  FileText,
  Wallet,
  BellRing,
  TrendingUp,
  ShieldCheck,
  BookOpenCheck,
  Sparkles,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Whizunik — Receivables factoring & monitoring" },
      {
        name: "description",
        content: "Submit invoices, advance capital in hours, and monitor debtor risk in real time.",
      },
      { property: "og:title", content: "Whizunik — Receivables factoring & monitoring" },
      {
        property: "og:description",
        content: "Institutional-grade factoring and live receivables monitoring.",
      },
    ],
  }),
  component: Landing,
});

const FEATURES = [
  {
    icon: FileText,
    title: "Invoice factoring",
    body: "Submit invoices, verify them against limits, and get funded in hours — not weeks.",
  },
  {
    icon: Wallet,
    title: "Advances & funding",
    body: "Advance against receivables with full visibility into the ledger, fees and recoveries.",
  },
  {
    icon: BellRing,
    title: "Alerts & checkpoints",
    body: "Automated approvals, expiry reminders and exception flags keep risk in front of you.",
  },
  {
    icon: TrendingUp,
    title: "Demand forecasting",
    body: "SKU-level forecasts and reorder intelligence turn stock history into buying decisions.",
  },
  {
    icon: BookOpenCheck,
    title: "Audit-ready accounting",
    body: "Balance sheets, journals and reports that reconcile themselves — and stay examiner-proof.",
  },
  {
    icon: ShieldCheck,
    title: "Bank-grade security",
    body: "SOC 2, ISO 27001, 256-bit encryption at rest. Your book stays your book.",
  },
];

function Landing() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="border-b border-border/60 bg-background/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/logo.png" alt="Whizunik" className="h-8 w-auto rounded-md object-contain" />
            <span className="font-display text-xl tracking-tight">Whizunik</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              to="/auth"
              className="hidden rounded-lg border border-border bg-card/60 px-4 py-2 text-sm font-medium text-foreground transition hover:border-primary/40 hover:bg-card sm:inline-flex"
            >
              Sign in
            </Link>
            <Link
              to="/auth"
              search={{ mode: "signup" }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary/90"
            >
              Get started <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 grid-lines opacity-30" aria-hidden />
        <div
          className="absolute -right-40 -top-24 h-[480px] w-[480px] rounded-full bg-primary/10 blur-3xl"
          aria-hidden
        />
        <div
          className="absolute -left-32 bottom-0 h-[360px] w-[360px] rounded-full bg-primary/5 blur-3xl"
          aria-hidden
        />

        <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-6 py-20 lg:grid-cols-2 lg:py-28">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
              </span>
              Receivables factoring & monitoring
            </div>
            <h1 className="mt-6 font-display text-5xl leading-[1.04] tracking-tight text-balance md:text-6xl">
              Capital moves at the speed of{" "}
              <em className="not-italic text-primary">conviction</em>.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted-foreground">
              Whizunik is the platform for receivables factoring and debtor monitoring — submit
              invoices, advance capital, and watch risk in real time.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/auth"
                search={{ mode: "signup" }}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-md shadow-primary/20 transition-all hover:bg-primary/90 hover:shadow-lg"
              >
                Open a free account <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/auth"
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-card/60 px-5 py-2.5 text-sm font-medium text-foreground transition hover:border-primary/40 hover:bg-card"
              >
                Sign in
              </Link>
            </div>
            <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4 text-sm">
              {[
                ["$2B+", "Invoices funded"],
                ["48h", "Average advance"],
                ["SOC 2", "Certified platform"],
              ].map(([v, l]) => (
                <div key={l}>
                  <div className="font-mono text-xl font-bold text-foreground">{v}</div>
                  <div className="text-xs text-muted-foreground">{l}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Product preview */}
          <div className="relative">
            <div className="pointer-events-none absolute -inset-6 rounded-3xl bg-primary/5 blur-2xl" aria-hidden />
            <div className="relative rounded-2xl border border-border bg-card p-5 shadow-xl">
              <div className="flex items-center justify-between border-b border-border pb-4">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                    Portfolio
                  </div>
                  <div className="font-display text-lg font-semibold tracking-tight text-foreground">
                    Receivables dashboard
                  </div>
                </div>
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Sparkles className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                {[
                  { label: "Outstanding", value: "$1.24M", tone: "text-foreground" },
                  { label: "Advanced", value: "$612k", tone: "text-foreground" },
                  { label: "Overdue", value: "3", tone: "text-destructive" },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg border border-border bg-background/40 p-3">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      {s.label}
                    </div>
                    <div className={`mt-1 font-mono text-base font-bold tabular-nums ${s.tone}`}>
                      {s.value}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 space-y-2.5">
                {[
                  { label: "Current", pct: 62, tone: "bg-success" },
                  { label: "1–30 days", pct: 24, tone: "bg-primary" },
                  { label: "31–60 days", pct: 9, tone: "bg-warning" },
                  { label: "60+ days", pct: 5, tone: "bg-destructive" },
                ].map((b) => (
                  <div key={b.label}>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{b.label}</span>
                      <span className="font-mono text-foreground">{b.pct}%</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${b.tone} transition-all duration-700`}
                        style={{ width: `${b.pct}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-border/60 bg-background/40">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-[10px] uppercase tracking-[0.2em] text-primary font-semibold">
              One platform, every workflow
            </p>
            <h2 className="mt-3 font-display text-3xl tracking-tight text-balance md:text-4xl">
              Everything a factoring desk touches — in one room.
            </h2>
            <p className="mt-4 text-muted-foreground">
              From first invoice to final recovery, Whizunik keeps the whole lifecycle monitored,
              approved and accounted for.
            </p>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group rounded-2xl border border-border bg-card p-6 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-card-hover"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors duration-200 group-hover:bg-primary group-hover:text-primary-foreground">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-display text-base font-semibold text-foreground">
                  {f.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden border-t border-border/60">
        <div
          className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-primary/5"
          aria-hidden
        />
        <div className="relative mx-auto max-w-3xl px-6 py-20 text-center">
          <h2 className="font-display text-3xl tracking-tight text-balance md:text-4xl">
            Put your receivables to work.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Create your workspace in minutes — import your debtors, submit your first invoice, and
            watch the funding pipeline move.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/auth"
              search={{ mode: "signup" }}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow-md shadow-primary/20 transition-all hover:bg-primary/90 hover:shadow-lg"
            >
              Create your account <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-border/60 py-8 text-center text-xs text-muted-foreground">
        © Whizunik · SOC 2 · ISO 27001 · 256-bit at rest
      </footer>
    </div>
  );
}
