import { createFileRoute, Outlet, useNavigate, Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import api from "@/lib/api-client";
import {
  LayoutDashboard, FileText, BellRing, LogOut, Settings, Shield, Building2, Truck, ShoppingCart,
  Receipt, Banknote, ClipboardCheck, Boxes, Wallet, FileSignature, FileMinus, Palette, BookOpen,
  BarChart3, Scale, Package, TrendingUp, Users, Search, Menu, Command, Mail,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

export const Route = createFileRoute("/app")({
  component: AppLayout,
});

// ─── Navigation sections ───────────────────────────────────────
type NavItem = { to: string; label: string; icon: any };
type NavSection = { label: string; items: NavItem[] };

function AppLayout() {
  const { user, loading, isAdmin, isTreasury, isChecker, isSalesRep } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [cmdOpen, setCmdOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Cmd+K / Ctrl+K keyboard shortcut
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  // Role-based route wall
  useEffect(() => {
    if (loading || !user) return;
    const treasuryBlocked = ["/app/invoices", "/app/purchases", "/app/expenses", "/app/checker", "/app/debtors", "/app/vendors", "/app/inventory", "/app/proformas"];
    const checkerOnlyBlocked = ["/app/expenses", "/app/queue", "/app/inventory", "/app/advances", "/app/proformas"];
    const salesRepAllowed = ["/app/dashboard", "/app/crm", "/app/products", "/app/forecast", "/app/settings"];
    if (isTreasury && !isAdmin && !isChecker && treasuryBlocked.some((p) => pathname.startsWith(p))) {
      navigate({ to: "/app/queue" });
    }
    if (isChecker && !isAdmin && !isTreasury && checkerOnlyBlocked.some((p) => pathname.startsWith(p))) {
      navigate({ to: "/app/checker" });
    }
    if (isSalesRep && !isAdmin && !isChecker && !isTreasury && pathname.startsWith("/app/") && !salesRepAllowed.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
      navigate({ to: "/app/crm" });
    }
  }, [loading, user, isTreasury, isChecker, isAdmin, isSalesRep, pathname, navigate]);

  if (loading || !user) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="text-sm text-muted-foreground">Opening vault…</div>
      </div>
    );
  }

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    api.auth.clearToken();
    navigate({ to: "/auth", replace: true });
  };

  // Build nav sections per role
  const navSections: NavSection[] = (() => {
    if (isSalesRep && !isAdmin && !isChecker && !isTreasury) {
      return [
        {
          label: "Main", items: [
            { to: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
            { to: "/app/crm", label: "CRM / Leads", icon: Users },
          ],
        },
        {
          label: "Inventory", items: [
            { to: "/app/products", label: "Product catalog", icon: Package },
            { to: "/app/forecast", label: "Demand forecast", icon: TrendingUp },
          ],
        },
        {
          label: "System", items: [
            { to: "/app/settings", label: "Settings", icon: Settings },
          ],
        },
      ];
    }

    if (isTreasury && !isAdmin && !isChecker) {
      return [
        {
          label: "Overview", items: [
            { to: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
          ],
        },
        {
          label: "Funding", items: [
            { to: "/app/queue", label: "Funding queue", icon: Banknote },
            { to: "/app/advances", label: "Advances", icon: Wallet },
          ],
        },
        {
          label: "System", items: [
            { to: "/app/alerts", label: "Alerts", icon: BellRing },
            { to: "/app/settings", label: "Settings", icon: Settings },
          ],
        },
      ];
    }

    if (isChecker && !isAdmin) {
      return [
        {
          label: "Overview", items: [
            { to: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
            { to: "/app/checker", label: "Checker desk", icon: ClipboardCheck },
          ],
        },
        {
          label: "Transactions", items: [
            { to: "/app/invoices", label: "Sales invoices", icon: FileText },
            { to: "/app/purchases", label: "Purchases", icon: ShoppingCart },
          ],
        },
        {
          label: "System", items: [
            { to: "/app/alerts", label: "Alerts", icon: BellRing },
            { to: "/app/settings", label: "Settings", icon: Settings },
          ],
        },
      ];
    }

    // Full admin / power user navigation
    const sections: NavSection[] = [
      {
        label: "Overview", items: [
          { to: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
          ...(isAdmin || isChecker ? [{ to: "/app/checker", label: "Checker desk", icon: ClipboardCheck }] : []),
          { to: "/app/queue", label: "Funding queue", icon: Banknote },
        ],
      },
      {
        label: "Transactions", items: [
          { to: "/app/proformas", label: "Proforma invoices", icon: FileSignature },
          { to: "/app/invoices", label: "Sales invoices", icon: FileText },
          { to: "/app/purchases", label: "Purchases", icon: ShoppingCart },
          { to: "/app/expenses", label: "Expenses", icon: Receipt },
          { to: "/app/notes", label: "Credit / debit notes", icon: FileMinus },
          { to: "/app/advances", label: "Advances", icon: Wallet },
        ],
      },
      {
        label: "Catalog & Inventory", items: [
          { to: "/app/products", label: "Product catalog", icon: Package },
          { to: "/app/forecast", label: "Demand forecast", icon: TrendingUp },
          { to: "/app/inventory", label: "Inventory", icon: Boxes },
        ],
      },
      {
        label: "Relationships", items: [
          { to: "/app/crm", label: "CRM / Leads", icon: Users },
          { to: "/app/debtors", label: "Debtors", icon: Building2 },
          { to: "/app/vendors", label: "Suppliers", icon: Truck },
        ],
      },
      {
        label: "Finance", items: [
          { to: "/app/accounting", label: "Accounting", icon: BookOpen },
          { to: "/app/reports", label: "Reports", icon: BarChart3 },
          { to: "/app/balance-sheet", label: "Balance sheet", icon: Scale },
        ],
      },
      {
        label: "System", items: [
          { to: "/app/alerts", label: "Alerts", icon: BellRing },
          { to: "/app/reminders", label: "Reminders", icon: Mail },
          ...(isAdmin ? [{ to: "/app/admin", label: "Operations", icon: Shield }] : []),
          { to: "/app/template", label: "Invoice template", icon: Palette },
          { to: "/app/settings", label: "Settings", icon: Settings },
        ],
      },
    ];
    return sections;
  })();

  // Flatten for command palette search
  const allNavItems = navSections.flatMap((s) => s.items);

  const consoleLabel = isAdmin ? "Factor console" : isTreasury ? "Treasury desk" : isChecker ? "Checker desk" : isSalesRep ? "Sales workspace" : "Trader portal";

  // ─── Sidebar content (reused in desktop + mobile) ──────────
  const sidebarContent = (
    <>
      {/* Brand header */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border shrink-0">
        <img src="/logo.png" alt="Adventra" className="h-9 w-auto rounded-[12px] object-contain" />
        <div>
          <div className="font-display text-lg leading-tight tracking-tight text-sidebar-foreground">Adventra</div>
          <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">{consoleLabel}</div>
        </div>
      </div>

      {/* Quick search button */}
      <div className="px-3 pt-3">
        <button
          onClick={() => setCmdOpen(true)}
          className="flex w-full items-center gap-2 rounded-[10px] border border-sidebar-border bg-sidebar-accent/50 px-3 py-2.5 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">Quick navigate...</span>
          <kbd className="hidden rounded-md border border-sidebar-border bg-white px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-muted-foreground md:inline-flex">
            <Command className="h-2.5 w-2.5" />K
          </kbd>
        </button>
      </div>

      {/* Navigation sections */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-5 [&::-webkit-scrollbar]:hidden">
        {navSections.map((section) => (
          <div key={section.label}>
            <div className="px-3 pb-1.5 text-[9px] uppercase tracking-[0.2em] text-muted-foreground font-medium">
              {section.label}
            </div>
            <div className="space-y-0.5">
              {section.items.map((n) => {
                const active = pathname === n.to || pathname.startsWith(n.to + "/");
                const Icon = n.icon;
                return (
                  <Link
                    key={n.to}
                    to={n.to}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                      active
                        ? "bg-blue-50 text-accent"
                        : "text-slate-500 hover:bg-blue-50/50 hover:text-slate-700"
                    }`}
                  >
                    <Icon className={`h-4 w-4 shrink-0 ${active ? "text-accent" : "text-slate-400"}`} />
                    <span className="truncate">{n.label}</span>
                    {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent" />}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User footer */}
      <div className="border-t border-sidebar-border p-3 shrink-0">
        <div className="rounded-[12px] bg-slate-50/80 p-3 transition-colors hover:bg-slate-100/80 border border-sidebar-border/50">
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Signed in as</div>
          <div className="mt-0.5 truncate text-sm font-medium text-sidebar-foreground">{user?.email}</div>
          <button onClick={signOut} className="mt-2.5 inline-flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground">
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen w-full">
      {/* Mobile navbar */}
      <div className="fixed inset-x-0 top-0 z-40 flex items-center gap-3 border-b border-border bg-background px-4 py-3 md:hidden print:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <button className="rounded-md border border-border p-2 text-foreground">
              <Menu className="h-5 w-5" />
            </button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[280px] p-0 bg-sidebar">
            {sidebarContent}
          </SheetContent>
        </Sheet>
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="Adventra" className="h-7 w-auto rounded-[8px] object-contain" />
          <span className="font-display text-sm tracking-tight">Adventra</span>
        </div>
        <button
          onClick={() => setCmdOpen(true)}
          className="ml-auto rounded-md border border-border p-2 text-muted-foreground"
        >
          <Search className="h-4 w-4" />
        </button>
      </div>

      {/* Desktop sidebar */}
      <aside className="hidden w-64 flex-col border-r border-sidebar-border bg-sidebar md:flex print:hidden">
        {sidebarContent}
      </aside>

      {/* Main content area */}
      <main className="flex-1 min-w-0 bg-background pt-14 md:pt-0">
        <Outlet />
      </main>

      {/* ─── Command palette ─────────────────────────────── */}
      <CommandDialog open={cmdOpen} onOpenChange={setCmdOpen}>
        <CommandInput placeholder="Search pages…" />
        <CommandList>
          <CommandEmpty>No pages found.</CommandEmpty>
          {navSections.map((section) => (
            <CommandGroup key={section.label} heading={section.label}>
              {section.items.map((n) => {
                const Icon = n.icon;
                return (
                  <CommandItem
                    key={n.to}
                    value={`${section.label} ${n.label}`}
                    onSelect={() => {
                      setCmdOpen(false);
                      navigate({ to: n.to });
                    }}
                    className="cursor-pointer"
                  >
                    <Icon className="mr-2 h-4 w-4" />
                    <span>{n.label}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">{n.to.replace("/app/", "")}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </div>
  );
}
