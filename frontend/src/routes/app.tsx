import { createFileRoute, Outlet, useNavigate, Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import api from "@/lib/api-client";
import { useViewAsUserId } from "@/lib/view-as";
import { ViewAsBanner } from "@/components/view-as-banner";
import {
  LayoutDashboard,
  FileText,
  BellRing,
  LogOut,
  Settings,
  Shield,
  Building2,
  Truck,
  ShoppingCart,
  Receipt,
  Banknote,
  ClipboardCheck,
  Boxes,
  Wallet,
  FileSignature,
  FileMinus,
  Palette,
  Package,
  TrendingUp,
  Users,
  Search,
  Menu,
  Command,
  Mail,
  ChevronRight,
  ChevronDown,
  User,
  Briefcase,
  ClipboardList,
  PackageCheck,
  ShoppingBag,
  ScrollText,
  Sun,
  Moon,
  BarChart3,
} from "lucide-react";
import { useTheme, type Theme } from "@/lib/theme";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export const Route = createFileRoute("/app")({
  component: AppLayout,
});

// ─── Navigation section types ──────────────────────────────────
type NavItem = { to: string; label: string; icon: any };
type NavSection =
  | { type: "single"; label: string; icon: any; to: string }
  | { type: "group"; label: string; icon: any; items: NavItem[] };

// ─── Shared Transactions items (used by operations, treasury, checker, admin) ──
const TRANSACTIONS_ITEMS: NavItem[] = [
  { to: "/app/purchases", label: "Purchase invoices", icon: ShoppingCart },
  { to: "/app/purchase-orders", label: "Purchase orders", icon: ClipboardList },
  { to: "/app/grn", label: "Goods received (GRN)", icon: PackageCheck },
  { to: "/app/quotations", label: "Quotations", icon: ScrollText },
  { to: "/app/sales-orders", label: "Sales orders", icon: ShoppingBag },
  { to: "/app/dispatches", label: "Dispatch", icon: Truck },
  { to: "/app/invoices", label: "Sales invoices", icon: FileText },
  { to: "/app/proformas", label: "Proforma invoices", icon: FileSignature },
  { to: "/app/debtors", label: "Debtors", icon: Building2 },
  { to: "/app/suppliers", label: "Suppliers", icon: Truck },
  { to: "/app/notes", label: "Credit / Debit notes", icon: FileMinus },
  { to: "/app/expenses", label: "Expenses", icon: Receipt },
  { to: "/app/advances", label: "Advances", icon: Wallet },
];

// ─── Build navigation sections per role ──────────────────────
// Priority: Checker → Treasury → Operations → Salesman → Admin → fallback
function buildNavSections(roles: string[]): NavSection[] {
  const isAdmin = roles.includes("factor_admin");
  const isChecker = roles.includes("checker");
  const isTreasury = roles.includes("treasury");
  const isOperations = roles.includes("operations");
  const isSalesRep = roles.includes("sales_rep");
  const isReportingManager = roles.includes("reporting_manager");

  // Checker — operations items + checker desk + Workspace
  if (isChecker && !isAdmin) {
    return [
      { type: "single", label: "Dashboard", icon: LayoutDashboard, to: "/app/dashboard" },
      { type: "single", label: "My Workspace", icon: Briefcase, to: "/app/workspace" },
      { type: "single", label: "Checker", icon: ClipboardCheck, to: "/app/checker" },
      { type: "single", label: "Reports", icon: BarChart3, to: "/app/reporting" },
      {
        type: "group",
        label: "Transactions",
        icon: Receipt,
        items: TRANSACTIONS_ITEMS,
      },
    ];
  }

  // Treasury — operations items + funding queue + Workspace
  if (isTreasury && !isAdmin && !isChecker) {
    return [
      { type: "single", label: "Dashboard", icon: LayoutDashboard, to: "/app/dashboard" },
      { type: "single", label: "My Workspace", icon: Briefcase, to: "/app/workspace" },
      { type: "single", label: "Funding queue", icon: Banknote, to: "/app/queue" },
      { type: "single", label: "Reports", icon: BarChart3, to: "/app/reporting" },
      {
        type: "group",
        label: "Transactions",
        icon: Receipt,
        items: TRANSACTIONS_ITEMS,
      },
    ];
  }

  // Operations — all transaction items + Workspace
  if (isOperations && !isAdmin && !isChecker && !isTreasury) {
    return [
      { type: "single", label: "Dashboard", icon: LayoutDashboard, to: "/app/dashboard" },
      { type: "single", label: "My Workspace", icon: Briefcase, to: "/app/workspace" },
      { type: "single", label: "Reports", icon: BarChart3, to: "/app/reporting" },
      {
        type: "group",
        label: "Transactions",
        icon: Receipt,
        items: TRANSACTIONS_ITEMS,
      },
    ];
  }

  // Salesman — CRM / leads, debtors, suppliers + Workspace
  if (isSalesRep && !isAdmin && !isChecker && !isTreasury && !isOperations) {
    return [
      { type: "single", label: "Dashboard", icon: LayoutDashboard, to: "/app/dashboard" },
      { type: "single", label: "My Workspace", icon: Briefcase, to: "/app/workspace" },
      {
        type: "group",
        label: "Sales",
        icon: Users,
        items: [
          { to: "/app/crm", label: "Leads", icon: Users },
          { to: "/app/quotations", label: "Quotations", icon: ScrollText },
          { to: "/app/debtors", label: "Debtors", icon: Building2 },
          { to: "/app/suppliers", label: "Suppliers", icon: Truck },
        ],
      },
    ];
  }

  // Reporting Manager — My Reports + Requests + Dashboard + Settings
  if (isReportingManager && !isAdmin && !isChecker && !isTreasury && !isOperations && !isSalesRep) {
    return [
      { type: "single", label: "Dashboard", icon: LayoutDashboard, to: "/app/dashboard" },
      { type: "single", label: "My Reports", icon: Users, to: "/app/reports" },
      { type: "single", label: "Reports", icon: BarChart3, to: "/app/reporting" },
      { type: "single", label: "Requests", icon: ClipboardList, to: "/app/requests" },
      {
        type: "group",
        label: "System",
        icon: Settings,
        items: [{ to: "/app/settings", label: "Settings", icon: Settings }],
      },
    ];
  }

  // ── Admin — full access ──
  if (isAdmin) {
    return [
      { type: "single", label: "Dashboard", icon: LayoutDashboard, to: "/app/dashboard" },
      { type: "single", label: "Checker", icon: ClipboardCheck, to: "/app/checker" },
      { type: "single", label: "Funding queue", icon: Banknote, to: "/app/queue" },
      { type: "single", label: "Reports", icon: BarChart3, to: "/app/reporting" },
      {
        type: "group",
        label: "Transactions",
        icon: Receipt,
        items: TRANSACTIONS_ITEMS,
      },
      {
        type: "group",
        label: "Catalog & Inventory",
        icon: Boxes,
        items: [
          { to: "/app/products", label: "Product catalog", icon: Package },
          { to: "/app/forecast", label: "Demand forecasting", icon: TrendingUp },
          { to: "/app/inventory", label: "Inventory", icon: Boxes },
        ],
      },
      {
        type: "group",
        label: "Sales",
        icon: Users,
        items: [
          { to: "/app/crm", label: "Leads", icon: Users },
          { to: "/app/quotations", label: "Quotations", icon: ScrollText },
          { to: "/app/debtors", label: "Debtors", icon: Building2 },
          { to: "/app/suppliers", label: "Suppliers", icon: Truck },
        ],
      },
      {
        type: "group",
        label: "System",
        icon: Settings,
        items: [
          { to: "/app/alerts", label: "Alerts", icon: BellRing },
          { to: "/app/reminders", label: "Reminders", icon: Mail },
          { to: "/app/admin", label: "Operations", icon: Shield },
          { to: "/app/template", label: "Invoice template", icon: Palette },
          { to: "/app/settings", label: "Settings", icon: Settings },
        ],
      },
    ];
  }

  // ── Fallback for unknown / unreporting_manager roles ──
  return [{ type: "single", label: "Dashboard", icon: LayoutDashboard, to: "/app/dashboard" }];
}

function AppLayout() {
  const {
    user,
    loading,
    signOut,
    isAdmin,
    isTreasury,
    isChecker,
    isSalesRep,
    isOperations,
    isReportingManager,
  } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { theme, toggleTheme } = useTheme();

  // ── View-as (reporting manager impersonation) ──
  // When a viewAsUserId is in the URL, the sidebar mirrors the team member's
  // own tabs and every data fetch is scoped to them via the api-client.
  const viewAsUserId = useViewAsUserId();
  const viewAsTargetQ = useQuery({
    queryKey: ["view-as-target", viewAsUserId ?? "none"],
    queryFn: () => api.admin.getUser(viewAsUserId as string),
    enabled: !!viewAsUserId,
    staleTime: 60_000,
  });
  const viewAsTarget = viewAsTargetQ.data;
  const viewAsActive = !!viewAsUserId;
  const effectiveRoles = viewAsActive ? (viewAsTarget?.roles ?? []) : (user?.roles ?? []);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeFlyout, setActiveFlyout] = useState<string | null>(null);
  const [mobileExpanded, setMobileExpanded] = useState<string | null>(null);

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

  // Close flyout on Escape
  useEffect(() => {
    if (!activeFlyout) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActiveFlyout(null);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [activeFlyout]);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  // Role-based route wall
  useEffect(() => {
    if (loading || !user) return;

    // In view-as mode the manager is browsing the team member's workspace —
    // the sidebar is already built from the team member's roles, so skip the wall.
    if (viewAsUserId) return;

    // Allowed pages per role
    // Shared routes accessible to all logged-in users
    const SHARED_ROUTES = ["/app/profile", "/app/workspace", "/app/settings"];
    const operationsAllowed = [
      "/app/dashboard",
      "/app/debtors",
      "/app/suppliers",
      "/app/invoices",
      "/app/purchases",
      "/app/purchase-orders",
      "/app/quotations",
      "/app/quotation",
      "/app/sales-orders",
      "/app/dispatches",
      "/app/challan",
      "/app/grn",
      "/app/proformas",
      "/app/advances",
      "/app/expenses",
      "/app/notes",
      "/app/reporting",
    ];
    const salesmanAllowed = [
      "/app/dashboard",
      "/app/crm",
      "/app/quotations",
      "/app/quotation",
      "/app/debtors",
      "/app/suppliers",
    ];

    if (isAdmin) return; // admin goes anywhere

    if (
      isChecker &&
      pathname.startsWith("/app/") &&
      ![...operationsAllowed, ...SHARED_ROUTES, "/app/checker"].some(
        (p) => pathname === p || pathname.startsWith(p + "/"),
      )
    ) {
      navigate({ to: "/app/checker" });
    } else if (
      isTreasury &&
      pathname.startsWith("/app/") &&
      ![...operationsAllowed, ...SHARED_ROUTES, "/app/queue"].some(
        (p) => pathname === p || pathname.startsWith(p + "/"),
      )
    ) {
      navigate({ to: "/app/queue" });
    } else if (
      isOperations &&
      pathname.startsWith("/app/") &&
      ![...operationsAllowed, ...SHARED_ROUTES].some(
        (p) => pathname === p || pathname.startsWith(p + "/"),
      )
    ) {
      navigate({ to: "/app/dashboard" });
    } else if (
      isSalesRep &&
      pathname.startsWith("/app/") &&
      ![...salesmanAllowed, ...SHARED_ROUTES].some(
        (p) => pathname === p || pathname.startsWith(p + "/"),
      )
    ) {
      navigate({ to: "/app/crm" });
    } else if (
      isReportingManager &&
      pathname.startsWith("/app/") &&
      !["/app/dashboard", "/app/reports", "/app/reporting", "/app/requests", ...SHARED_ROUTES].some(
        (p) => pathname === p || pathname.startsWith(p + "/"),
      )
    ) {
      navigate({ to: "/app/dashboard" });
    }
  }, [
    loading,
    user,
    isTreasury,
    isChecker,
    isAdmin,
    isSalesRep,
    isOperations,
    isReportingManager,
    viewAsUserId,
    pathname,
    navigate,
  ]);

  // When entering/exiting view-as, refetch cached queries so data reflects the
  // right user (e.g. after switching between two team members).
  const prevViewAs = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (prevViewAs.current !== viewAsUserId) {
      prevViewAs.current = viewAsUserId;
      qc.invalidateQueries();
    }
  }, [viewAsUserId, qc]);

  if (loading || !user) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="text-sm text-muted-foreground">Opening vault…</div>
      </div>
    );
  }

  const handleSignOut = () => {
    signOut();
    navigate({ to: "/auth", replace: true });
  };

  // ─── Build navigation sections per role ──────────────────────
  // In view-as mode the sidebar mirrors the team member's own tabs (e.g. a
  // salesperson sees CRM / Leads, Debtors, Suppliers + their Workspace);
  // otherwise it reflects the signed-in user's roles.
  const navSections = buildNavSections(effectiveRoles);

  // Current page label, shown in the top bar for orientation.
  const currentPage = (() => {
    // Detail / preview routes that don't share a nav-item prefix.
    const DETAIL_LABELS: [string, string][] = [
      ["/app/quotation/", "Quotation"],
      ["/app/challan/", "Dispatch"],
      ["/app/invoice-preview/", "Invoice"],
      ["/app/note-preview/", "Credit / Debit note"],
    ];
    for (const [prefix, label] of DETAIL_LABELS) if (pathname.startsWith(prefix)) return label;
    for (const s of navSections) {
      if (s.type === "single" && (pathname === s.to || pathname.startsWith(s.to + "/")))
        return s.label;
      if (s.type === "group") {
        const item = s.items.find((n) => pathname === n.to || pathname.startsWith(n.to + "/"));
        if (item) return item.label;
      }
    }
    return "";
  })();

  // Resolve the currently active flyout section data
  const activeFlyoutSection = activeFlyout
    ? (navSections.find(
        (s): s is Extract<NavSection, { type: "group" }> =>
          s.type === "group" && s.label === activeFlyout,
      ) ?? null)
    : null;

  const closeAll = () => {
    setActiveFlyout(null);
    setMobileExpanded(null);
  };

  // When in view-as mode every navigation keeps the viewAsUserId search param
  // so the reporting manager keeps browsing the team member's data.
  const viewSearch = viewAsActive ? { viewAsUserId } : {};

  const consoleLabel = effectiveRoles.includes("factor_admin")
    ? "Factor console"
    : effectiveRoles.includes("treasury")
      ? "Treasury desk"
      : effectiveRoles.includes("checker")
        ? "Checker desk"
        : effectiveRoles.includes("operations")
          ? "Operations desk"
          : effectiveRoles.includes("sales_rep")
            ? "Sales workspace"
            : effectiveRoles.includes("reporting_manager")
              ? "Reporting console"
              : "Trader portal";

  // ─── Render a single nav link ─────────────────────────────────
  const renderNavLink = (n: NavItem, closeSidebar: () => void) => {
    const active = pathname === n.to || pathname.startsWith(n.to + "/");
    const Icon = n.icon;
    return (
      <Link
        key={n.to}
        to={n.to}
        search={viewSearch}
        onClick={() => {
          closeSidebar();
          closeAll();
        }}
        className={`group flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
          active
            ? "bg-primary/10 text-primary shadow-sm"
            : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
        }`}
      >
        <Icon
          className={`h-4 w-4 shrink-0 transition-colors duration-200 ${
            active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
          }`}
        />
        <span className="truncate">{n.label}</span>
        {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent" />}
      </Link>
    );
  };

  // ─── Sidebar content ─────────────────────────────────────────
  // `mobile` = true → renders inside the Sheet (inline accordion for groups)
  // `mobile` = false → renders in the desktop sidebar (flyout for groups)
  const renderSidebarContent = (mobile: boolean) => (
    <>
      {/* Brand header */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border shrink-0">
        <div className="min-w-0">
          <div className="font-display text-lg leading-tight tracking-tight text-sidebar-foreground">
            Whizunik
          </div>
          <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
            {consoleLabel}
          </div>
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
          <kbd className="hidden rounded-md border border-sidebar-border bg-card px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-muted-foreground md:inline-flex">
            <Command className="h-2.5 w-2.5" />K
          </kbd>
        </button>
      </div>

      {/* Navigation sections */}
      <nav className="relative flex-1 overflow-y-auto px-3 py-3 space-y-0.5 [&::-webkit-scrollbar]:hidden">
        {navSections.map((section) => {
          // ── Single item ──
          if (section.type === "single") {
            const active = pathname === section.to || pathname.startsWith(section.to + "/");
            const Icon = section.icon;
            return (
              <Link
                key={section.to}
                to={section.to}
                search={viewSearch}
                onClick={() => {
                  if (mobile) setMobileOpen(false);
                }}
                className={`group flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                  active
                    ? "bg-primary/10 text-primary shadow-sm"
                    : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                }`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 transition-colors duration-200 ${
                    active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                  }`}
                />
                <span className="truncate">{section.label}</span>
                {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent" />}
              </Link>
            );
          }

          // ── Group / expandable section ──
          const Icon = section.icon;
          const hasActiveChild = section.items.some(
            (n) => pathname === n.to || pathname.startsWith(n.to + "/"),
          );
          const isOpen = activeFlyout === section.label;

          return (
            <div key={section.label}>
              {mobile ? (
                // ── Mobile: inline accordion ──
                <>
                  <button
                    onClick={() =>
                      setMobileExpanded(mobileExpanded === section.label ? null : section.label)
                    }
                    className={`flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                      hasActiveChild
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 shrink-0 ${hasActiveChild ? "text-primary" : "text-muted-foreground"}`}
                    />
                    <span className="flex-1 truncate text-left">{section.label}</span>
                    <ChevronDown
                      className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${
                        mobileExpanded === section.label ? "rotate-180" : ""
                      } ${hasActiveChild ? "text-primary" : "text-muted-foreground"}`}
                    />
                  </button>
                  {mobileExpanded === section.label && (
                    <div className="ml-3 mt-0.5 space-y-0.5 border-l-2 border-primary/20 pl-2 animate-in slide-in-from-top-1 fade-in duration-150">
                      {section.items.map((n) => renderNavLink(n, () => setMobileOpen(false)))}
                    </div>
                  )}
                </>
              ) : (
                // ── Desktop: horizontal flyout ──
                <button
                  onClick={() => setActiveFlyout(isOpen ? null : section.label)}
                  className={`flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                    hasActiveChild || isOpen
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                  } ${isOpen ? "ring-1 ring-primary/30" : ""}`}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 ${hasActiveChild ? "text-primary" : "text-muted-foreground"}`}
                  />
                  <span className="flex-1 truncate text-left">{section.label}</span>
                  <ChevronRight
                    className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${
                      isOpen ? "translate-x-0.5 text-primary" : ""
                    } ${hasActiveChild ? "text-primary" : "text-muted-foreground"}`}
                  />
                </button>
              )}
            </div>
          );
        })}
      </nav>

      {/* User footer */}
      <div className="border-t border-sidebar-border p-3 shrink-0">
        <div className="rounded-[12px] bg-muted/50 p-3 transition-colors hover:bg-muted/70 border border-sidebar-border/50">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
              {(user?.email || "U").charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-sidebar-foreground">
                {user?.email}
              </div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Signed in as
              </div>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="mt-2.5 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border/60 px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/5 hover:text-destructive"
          >
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
            {renderSidebarContent(true)}
          </SheetContent>
        </Sheet>
        <div className="flex items-center gap-2">
          <span className="font-display text-sm tracking-tight">Whizunik</span>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Link
            to="/app/alerts"
            aria-label="Alerts"
            title="Alerts"
            className="rounded-md border border-border p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <BellRing className="h-4 w-4" />
          </Link>
          <button
            onClick={() => setCmdOpen(true)}
            aria-label="Quick navigate"
            className="rounded-md border border-border p-2 text-muted-foreground"
          >
            <Search className="h-4 w-4" />
          </button>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      </div>

      {/* Desktop sidebar */}
      <aside className="relative hidden w-64 flex-col border-r border-sidebar-border bg-sidebar md:flex print:hidden">
        {renderSidebarContent(false)}

        {/* ── Horizontal flyout panel ── */}
        {activeFlyoutSection && (
          <>
            {/* Backdrop */}
            <div className="fixed inset-0 z-40" onClick={() => setActiveFlyout(null)} />
            {/* Flyout panel */}
            <div className="fixed left-64 top-0 z-50 flex h-full w-60 flex-col border-r border-border bg-popover shadow-2xl animate-in slide-in-from-left-2 fade-in duration-200">
              {/* Flyout header */}
              <div className="flex items-center gap-3 px-4 h-14 shrink-0 border-b border-border">
                <button
                  onClick={() => setActiveFlyout(null)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <ChevronRight className="h-4 w-4 rotate-180" />
                </button>
                <div className="h-4 w-px bg-border" />
                <span className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                  {activeFlyoutSection.label}
                </span>
              </div>
              {/* Flyout items */}
              <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                {activeFlyoutSection.items.map((n) => {
                  const active = pathname === n.to || pathname.startsWith(n.to + "/");
                  const ItemIcon = n.icon;
                  return (
                    <button
                      key={n.to}
                      onClick={() => {
                        setActiveFlyout(null);
                        navigate({ to: n.to, search: viewSearch });
                      }}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                        active
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                      }`}
                    >
                      <ItemIcon
                        className={`h-4 w-4 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`}
                      />
                      <span className="truncate">{n.label}</span>
                      {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </aside>

      {/* Main content area */}
      <main className="app-surface flex-1 min-w-0 pt-14 md:pt-0">
        {/* View-as banner — shown on every page while impersonating a team member */}
        {viewAsActive && (
          <ViewAsBanner
            userName={
              viewAsTarget?.contact_name ||
              viewAsTarget?.contactName ||
              viewAsTarget?.company_name ||
              viewAsTarget?.companyName ||
              viewAsTarget?.email ||
              "team member"
            }
            onExit={() => navigate({ to: "/app/reports", search: {} })}
          />
        )}
        {/* Top bar with page title, notifications, theme toggle & profile */}
        <div className="hidden md:flex items-center justify-between gap-2 border-b border-border bg-background px-6 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            {currentPage ? (
              <>
                <span className="truncate font-display text-base tracking-tight text-foreground">
                  {currentPage}
                </span>
                <span className="hidden h-1 w-1 shrink-0 rounded-full bg-border lg:block" />
                <span className="hidden truncate text-xs text-muted-foreground lg:block">
                  {consoleLabel}
                </span>
              </>
            ) : (
              <span className="truncate text-xs text-muted-foreground">{consoleLabel}</span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              to="/app/alerts"
              aria-label="Alerts"
              title="Alerts"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <BellRing className="h-4 w-4" />
            </Link>
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
            <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-muted/50">
                <Avatar className="h-7 w-7">
                  <AvatarImage src={user?.photoUrl || undefined} />
                  <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
                    {(user?.email || "U").charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium text-foreground max-w-[140px] truncate">
                  {user?.email?.split("@")[0] || "User"}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                {user?.email}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => navigate({ to: "/app/profile", search: viewSearch })}
                className="cursor-pointer"
              >
                <User className="mr-2 h-4 w-4" /> Profile
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => navigate({ to: "/app/workspace", search: viewSearch })}
                className="cursor-pointer"
              >
                <Briefcase className="mr-2 h-4 w-4" /> My Workspace
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => navigate({ to: "/app/settings", search: viewSearch })}
                className="cursor-pointer"
              >
                <Settings className="mr-2 h-4 w-4" /> Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleSignOut}
                className="cursor-pointer text-destructive focus:text-destructive"
              >
                <LogOut className="mr-2 h-4 w-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div key={pathname.split("/").slice(0, 3).join("/")} className="page-enter">
          <Outlet />
        </div>
      </main>

      {/* ─── Command palette ─────────────────────────────── */}
      <CommandDialog open={cmdOpen} onOpenChange={setCmdOpen}>
        <CommandInput placeholder="Search pages…" />
        <CommandList>
          <CommandEmpty>No pages found.</CommandEmpty>
          {navSections.map((section) => {
            if (section.type === "single") {
              const Icon = section.icon;
              return (
                <CommandGroup key={section.to} heading={section.label}>
                  <CommandItem
                    value={section.label}
                    onSelect={() => {
                      setCmdOpen(false);
                      navigate({ to: section.to, search: viewSearch });
                    }}
                    className="cursor-pointer"
                  >
                    <Icon className="mr-2 h-4 w-4" />
                    <span>{section.label}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {section.to.replace("/app/", "")}
                    </span>
                  </CommandItem>
                </CommandGroup>
              );
            }
            return (
              <CommandGroup key={section.label} heading={section.label}>
                {section.items.map((n) => {
                  const Icon = n.icon;
                  return (
                    <CommandItem
                      key={n.to}
                      value={`${section.label} ${n.label}`}
                      onSelect={() => {
                        setCmdOpen(false);
                        navigate({ to: n.to, search: viewSearch });
                      }}
                      className="cursor-pointer"
                    >
                      <Icon className="mr-2 h-4 w-4" />
                      <span>{n.label}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {n.to.replace("/app/", "")}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            );
          })}
        </CommandList>
      </CommandDialog>
    </div>
  );
}

// ─── Light / dark theme toggle ──────────────────────────────────
function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const dark = theme === "dark";
  return (
    <button
      onClick={onToggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Switch to light theme" : "Switch to dark theme"}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground shadow-sm transition-all duration-200 hover:border-primary/40 hover:text-primary"
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
