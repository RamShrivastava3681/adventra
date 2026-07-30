import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, Bell, ChartLine, ShieldCheck, Wallet, Zap } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Adventra — Receivables factoring & monitoring" },
      { name: "description", content: "Submit invoices, advance capital in hours, and monitor debtor risk in real time." },
      { property: "og:title", content: "Adventra — Receivables factoring & monitoring" },
      { property: "og:description", content: "Institutional-grade factoring and live receivables monitoring." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <Link to="/" className="flex items-center gap-2">
            <img src="/logo.png" alt="Adventra" className="h-8 w-auto rounded-md object-contain" />
            <span className="font-display text-xl tracking-tight">Adventra</span>
          </Link>
          <nav className="hidden gap-8 text-sm text-muted-foreground md:flex">
            <a href="#capabilities" className="hover:text-foreground">Capabilities</a>
            <a href="#monitoring" className="hover:text-foreground">Monitoring</a>
            <a href="#workflow" className="hover:text-foreground">Workflow</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link to="/auth" className="text-sm text-muted-foreground hover:text-foreground">Sign in</Link>
            <Link to="/auth" search={{ mode: "signup" }} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90">
              Get started
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border/60">
        <div className="absolute inset-0 grid-lines opacity-30" aria-hidden />
        <div className="absolute -right-40 top-20 h-[420px] w-[420px] rounded-full bg-primary/10 blur-3xl" aria-hidden />
        <div className="relative mx-auto max-w-7xl px-6 py-24 md:py-32">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            Live receivables monitoring · v2.4
          </div>
          <h1 className="mt-6 max-w-4xl font-display text-5xl leading-[1.05] tracking-tight text-balance md:text-7xl">
            Turn outstanding invoices into <em className="not-italic text-primary">working capital</em> — without losing sight of risk.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
            Adventra combines invoice factoring with institutional-grade debtor monitoring.
            Submit, advance, collect — and watch aging, concentration, and credit risk move in real time.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link to="/auth" search={{ mode: "signup" }} className="btn-primary group px-5 py-3 text-sm">
              Open a free account <ArrowUpRight className="h-4 w-4 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
            <Link to="/auth" className="btn-secondary px-5 py-3 text-sm">
              Sign in to console
            </Link>
          </div>

          {/* Stat strip */}
          <div className="mt-20 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border/60 md:grid-cols-4">
            {[
              { k: "$2.4B", v: "advanced in 2025" },
              { k: "11 hrs", v: "median time to fund" },
              { k: "0.42%", v: "loss rate, trailing 12mo" },
              { k: "98.7%", v: "collection rate" },
            ].map((s) => (
              <div key={s.k} className="bg-card p-6">
                <div className="num text-3xl font-semibold tracking-tight">{s.k}</div>
                <div className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">{s.v}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section id="capabilities" className="border-b border-border/60">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <div className="flex items-end justify-between gap-8">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-primary">Capabilities</p>
              <h2 className="mt-3 max-w-2xl font-display text-4xl tracking-tight md:text-5xl">A factor's command surface, built for the people writing the checks.</h2>
            </div>
          </div>

          <div className="mt-14 grid gap-px overflow-hidden rounded-xl border border-border bg-border/60 md:grid-cols-3">
            <Feature
              icon={<Wallet className="h-5 w-5" />}
              title="Advance ledger"
              body="Submit invoices, set advance & fee rates, and track reserves and disbursements across every funding event."
            />
            <Feature
              icon={<ChartLine className="h-5 w-5" />}
              title="Aging & DSO"
              body="Live 0/30/60/90+ buckets per debtor and client. DSO trendlines surface stress before it bites."
            />
            <Feature
              icon={<ShieldCheck className="h-5 w-5" />}
              title="Debtor credit"
              body="Score, limit, and concentration in a single view. Trip a limit and you'll know before the wire moves."
            />
            <Feature
              icon={<Bell className="h-5 w-5" />}
              title="Real-time alerts"
              body="Overdue triggers, credit-limit breaches, risk-grade migrations — pushed the moment they happen."
            />
            <Feature
              icon={<Zap className="h-5 w-5" />}
              title="Same-day funding"
              body="Approved invoices clear to client accounts in hours, not days. Reserves released on collection."
            />
            <Feature
              icon={<ArrowUpRight className="h-5 w-5" />}
              title="Portfolio analytics"
              body="Concentration, vintage curves, recovery rates — exportable to your investor committee."
            />
          </div>
        </div>
      </section>

      {/* Monitoring */}
      <section id="monitoring" className="border-b border-border/60 bg-vault">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <p className="text-xs uppercase tracking-[0.2em] text-primary">Monitoring</p>
          <h2 className="mt-3 max-w-3xl font-display text-4xl tracking-tight md:text-5xl">The console doesn't sleep. Neither does your risk.</h2>

          <div className="mt-12 grid gap-6 md:grid-cols-2">
            <Panel title="Aging waterfall" tag="Live">
              <div className="space-y-3">
                {[
                  { label: "Current", pct: 62, val: "$8.42M", tone: "bg-success" },
                  { label: "1–30 days", pct: 22, val: "$2.98M", tone: "bg-primary" },
                  { label: "31–60 days", pct: 10, val: "$1.36M", tone: "bg-warning" },
                  { label: "61–90 days", pct: 4, val: "$540K", tone: "bg-warning" },
                  { label: "90+ days", pct: 2, val: "$272K", tone: "bg-destructive" },
                ].map((b) => (
                  <div key={b.label}>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{b.label}</span><span className="num text-foreground">{b.val}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className={`h-full ${b.tone}`} style={{ width: `${b.pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="Active alerts" tag="3 critical">
              <ul className="space-y-3 text-sm">
                {[
                  { t: "Apex Holdings — credit limit at 94%", s: "warning" },
                  { t: "Invoice #INV-30421 overdue 47 days", s: "destructive" },
                  { t: "Northwind risk grade B → C", s: "warning" },
                  { t: "Vega Logistics payment received — $128K", s: "success" },
                ].map((a, i) => (
                  <li key={i} className="flex items-center gap-3 rounded-md border border-border bg-card/60 px-3 py-2">
                    <span className={`h-2 w-2 rounded-full bg-${a.s}`} />
                    <span className="flex-1">{a.t}</span>
                    <span className="text-xs text-muted-foreground">just now</span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section id="workflow" className="border-b border-border/60">
        <div className="mx-auto max-w-7xl px-6 py-24 text-center">
          <h2 className="mx-auto max-w-3xl font-display text-4xl tracking-tight md:text-6xl text-balance">
            Open an account. Fund tomorrow's payroll today.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-muted-foreground">
            Spin up a client portal or factor console in seconds. No card required.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Link to="/auth" search={{ mode: "signup" }} className="btn-primary px-6 py-3 text-sm">Create account</Link>
            <Link to="/auth" className="btn-secondary px-6 py-3 text-sm">Sign in</Link>
          </div>
        </div>
      </section>

      <footer className="mx-auto max-w-7xl px-6 py-10 text-xs text-muted-foreground flex items-center justify-between">
        <span>© Adventra. For demonstration purposes.</span>
        <span className="font-mono">v2.4.0</span>
      </footer>
    </div>
  );
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="group bg-card p-7 transition hover:bg-card/80">
      <div className="grid h-9 w-9 place-items-center rounded-md border border-border bg-background text-primary">{icon}</div>
      <h3 className="mt-5 font-display text-xl">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function Panel({ title, tag, children }: { title: string; tag: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-vault">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg">{title}</h3>
        <span className="rounded-full border border-border px-2.5 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">{tag}</span>
      </div>
      <div className="mt-5">{children}</div>
    </div>
  );
}
