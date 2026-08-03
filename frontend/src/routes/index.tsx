import { createFileRoute, Link } from "@tanstack/react-router";

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
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <Link to="/" className="flex items-center gap-2">
            <img src="/logo.png" alt="Adventra" className="h-8 w-auto rounded-md object-contain" />
            <span className="font-display text-xl tracking-tight">Adventra</span>
          </Link>
          <Link
            to="/auth"
            className="rounded-lg border border-border bg-card/60 px-4 py-2 text-sm font-medium text-foreground transition hover:border-primary/40 hover:bg-card"
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative flex flex-1 items-center justify-center overflow-hidden">
        <div className="absolute inset-0 grid-lines opacity-30" aria-hidden />
        <div className="absolute -right-40 top-20 h-[420px] w-[420px] rounded-full bg-primary/10 blur-3xl" aria-hidden />
        <div className="relative mx-auto max-w-3xl px-6 py-24 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            Receivables factoring & monitoring
          </div>
          <h1 className="mt-6 font-display text-5xl leading-[1.05] tracking-tight text-balance md:text-6xl">
            Adventra is the platform for <em className="not-italic text-primary">receivables factoring</em> and debtor monitoring.
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
            Submit invoices, advance capital, and monitor debtor risk — all in one place.
          </p>
          <p className="mt-8 text-sm text-muted-foreground/80">Built by Whizunik</p>
        </div>
      </section>

      <footer className="border-t border-border/60 py-8 text-center text-xs text-muted-foreground">
        © Adventra
      </footer>
    </div>
  );
}
