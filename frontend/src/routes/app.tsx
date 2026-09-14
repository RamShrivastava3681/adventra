import { createFileRoute, Outlet, useNavigate, Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import api from "@/lib/api-client";
import { useViewAsUserId } from "@/lib/view-as";
import { ViewAsBanner } from "@/components/view-as-banner";
import {
  LayoutDashboard,
  BellRing,
  Settings,
  Shield,
  Building2,
  Truck,
  ShoppingCart,
  ClipboardCheck,
  Wallet,
  Palette,
  Package,
  Users,
  Search,
  Menu,
  Mail,
  ShoppingBag,
  Briefcase,
  PackageCheck,
  BarChart3,
  AlertTriangle,
  Warehouse,
  ListTodo,
} from "lucide-react";
import { useTheme } from "@/lib/theme";
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
import { AppSidebar } from "@/components/app-sidebar";
import { AppTopbar, ThemeMenu } from "@/components/app-topbar";

export const Route = createFileRoute("/app")({
  component: AppLayout,
});

// ─── Navigation section types ──────────────────────────────────
type NavItem = { to: string; label: string; icon: any };
type NavSection =
  | { type: "single"; label: string; icon: any; to: string }
  | { type: "group"; label: string; icon: any; items: NavItem[] };

// ─── Procurement — a single Workbench entry. The workbench page hosts the
// procurement navigation (Suppliers, Purchase Orders, Purchase Invoices,
// GRNs, Supplier Payments, Activity History) as in-page tabs, so the sidebar
// collapses to one link. All document routes below stay registered and
// reachable via the workbench tabs and deep links.

// ─── (admin) quick-action item buckets ──
export const QUICK_SUPPLIER_ITEMS: NavItem[] = [
  { to: "/app/suppliers", label: "Suppliers", icon: Truck },
];
export const QUICK_DEBTOR_ITEMS: NavItem[] = [
  { to: "/app/debtors", label: "Customers", icon: Building2 },
];

// ─── Naughty list nav item constants ──
const NAUGHTY_LIST_ITEMS: NavItem[] = [
  { to: "/app/naughty-list", label: "Naughty List", icon: AlertTriangle },
];

// ─── Debtors list nav item constants ──
const DEBTORS_ITEMS: NavItem[] = [
  { to: "/app/debtors", label: "Customers", icon: Building2 },
];

// ─── Warehouse — a single Control entry. The workbench page hosts the
// warehouse navigation (Warehouse, Forecast, GRN, Dispatch, Stock
// Allocation, Samples, Activity History) as in-page tabs, so the sidebar
// collapses to one link. All document routes below stay registered and
// reachable via the workbench tabs and deep links.

// ─── Build navigation sections per role ──────────────────────
// Priority: Checker → Treasury → Operations → Salesman → Admin → fallback
function buildNavSections(roles: string[]): NavSection[] {
  const isAdmin = roles.includes("factor_admin") || roles.includes("super_admin");
  const isChecker = roles.includes("checker");
  const isTreasury = roles.includes("treasury");
  const isOperations = roles.includes("operations");
  const isSalesRep = roles.includes("sales_rep");
  const isReportingManager = roles.includes("reporting_manager");

  // ── Build each of the 7 tabs, only including items the role can see ──

  // Dashboard — single link, always present
  const dashboardSection: NavSection = {
    type: "single",
    label: "Dashboard",
    icon: LayoutDashboard,
    to: "/app/dashboard",
  };

  // My Queue — the unified workflow queue (PDF-3 §7); every staff role has one
  const myQueueSection: NavSection = {
    type: "single",
    label: "My Queue",
    icon: ListTodo,
    to: "/app/tasks",
  };

  // Checker — visible to checker + admin
  const checkerSection: NavSection | null =
    (isChecker || isAdmin)
      ? { type: "single", label: "Checker", icon: ClipboardCheck, to: "/app/checker" }
      : null;

  // Finance — a single Workbench entry, same format as Sales / Procurement /
  // Warehouse. The workbench page hosts the finance navigation (Cash
  // Command, Treasury, Bulk Payments, Sales Orders, Sales Invoices, Sales
  // Proforma, Purchase Invoices, Activity History) as in-page tabs, so the
  // sidebar collapses to one link. All document routes below stay registered
  // and reachable via the workbench tabs and deep links.
  const financeSection: NavSection | null =
    (isTreasury || isOperations || isAdmin)
      ? {
          type: "single",
          label: "Finance",
          icon: Wallet,
          to: "/app/finance-workbench",
        }
      : null;

  // Procurement — visible to operations + admin (single Workbench link)
  const procurementSection: NavSection | null =
    (isOperations || isAdmin)
      ? {
          type: "single",
          label: "Procurement",
          icon: ShoppingCart,
          to: "/app/procurement-workbench",
        }
      : null;

  // Sales — a single Workbench entry. The workbench page hosts the sales
  // navigation (Customers, Sales Orders, Proforma, Invoices, Credit Notes,
  // Activity History) as in-page tabs, so the sidebar collapses to one link.
  const salesSection: NavSection | null =
    (isSalesRep || isOperations || isAdmin)
      ? {
          type: "single",
          label: "Sales Workbench",
          icon: ShoppingBag,
          to: "/app/sales-workbench",
        }
      : null;

  // Sales reps keep their standalone CRM / Naughty List entries — the
  // workbench replaces the document tabs, not their own tools.
  const salesRepExtras: NavSection[] = isSalesRep
    ? [
        { type: "single", label: "Leads", icon: Users, to: "/app/crm" },
        { type: "single", label: "Naughty List", icon: AlertTriangle, to: "/app/naughty-list" },
      ]
    : [];

  // Reports — visible to everyone (reporting manager gets extra "My Reports")
  const reportsSections: NavSection[] = [
    { type: "single" as const, label: "Reports", icon: BarChart3, to: "/app/reporting" },
    ...(isReportingManager
      ? [{ type: "single" as const, label: "My Reports", icon: Users, to: "/app/reports" }]
      : []),
  ];

  // Product Catalogue — standalone tab (master data), visible to operations + admin
  const catalogueSection: NavSection | null =
    (isOperations || isAdmin)
      ? {
          type: "single",
          label: "Product Catalogue",
          icon: Package,
          to: "/app/products",
        }
      : null;

  // Warehouse Control — visible to operations + admin (single Workbench link)
  const warehouseControlSection: NavSection | null =
    (isOperations || isAdmin)
      ? {
          type: "single",
          label: "Warehouse Control",
          icon: Warehouse,
          to: "/app/warehouse-workbench",
        }
      : null;

  // System — visible to reporting manager + admin
  const systemSection: NavSection | null =
    (isReportingManager || isAdmin)
      ? {
          type: "group",
          label: "System",
          icon: Settings,
          items: isAdmin
            ? [
                { to: "/app/alerts", label: "Alerts", icon: BellRing },
                { to: "/app/reminders", label: "Reminders", icon: Mail },
                { to: "/app/admin", label: "Operations", icon: Shield },
                { to: "/app/template", label: "Invoice template", icon: Palette },
                { to: "/app/settings", label: "Settings", icon: Settings },
              ]
            : [{ to: "/app/settings", label: "Settings", icon: Settings }],
        }
      : null;

  // My Workspace — present for checker, treasury, operations, sales rep
  const workspaceSection: NavSection | null =
    (isChecker || isTreasury || isOperations || isSalesRep)
      ? { type: "single", label: "My Workspace", icon: Briefcase, to: "/app/workspace" }
      : null;

  // Assemble in the desired order: Dashboard, My Queue, Checker, Finance,
  // Procurement, Sales, Product Catalogue, Warehouse Control, Reports, System
  const sections = [
    dashboardSection,
    myQueueSection,
    workspaceSection,
    checkerSection,
    financeSection,
    procurementSection,
    salesSection,
    ...salesRepExtras,
    catalogueSection,
    warehouseControlSection,
    ...reportsSections,
    systemSection,
  ].filter((s: any): s is NavSection => s != null) as NavSection[];

  // Fallback for unknown roles — just dashboard + queue
  if (sections.length === 2 && sections[0] === dashboardSection && sections[1] === myQueueSection) {
    return sections;
  }

  return sections;
}

function AppLayout() {
  const {
    user,
    loading,
    signOut,
    isAdmin,
    isSuperAdmin,
    isTreasury,
    isChecker,
    isSalesRep,
    isOperations,
    isReportingManager,
  } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { theme, setTheme } = useTheme();

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
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem("whizunik-sidebar-collapsed") === "1";
    } catch {
      return false;
    }
  });
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem("whizunik-sidebar-collapsed", c ? "0" : "1");
      } catch {
        // Storage unavailable — collapse still applies for this session.
      }
      return !c;
    });
  };

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

    // Hidden for now: Inventory Movements page is out of nav.
    // Redirect old bookmarks / deep links to Warehouse until it returns.
    if (pathname === "/app/inventory" || pathname.startsWith("/app/inventory/")) {
      navigate({ to: "/app/warehouse", replace: true });
      return;
    }

    // In view-as mode the manager is browsing the team member's workspace —
    // the sidebar is already built from the team member's roles, so skip the wall.
    if (viewAsUserId) return;

    // Allowed pages per role
    // Shared routes accessible to all logged-in users
    const SHARED_ROUTES = ["/app/profile", "/app/workspace", "/app/settings"];

    // Sales routes
    const salesRoutes: string[] = [
      "/app/debtors",
      "/app/sales-orders",
      "/app/invoices",
      "/app/proformas",
      "/app/advances",
      "/app/notes",
      "/app/naughty-list",
    ];
    // Finance duplicate tabs (same data/process as the Sales and Procurement
    // tabs, just surfaced under the Finance section for treasury/ops/admin).
    // The Finance Workbench hosts them as same-page tabs (same format as the
    // Sales / Procurement / Warehouse workbenches); the routes below stay
    // registered for deep links.
    const financeRoutes: string[] = [
      "/app/finance-workbench",
      "/app/finance-sales-orders",
      "/app/finance-invoices",
      "/app/finance-proformas",
      "/app/finance-purchases",
    ];

    // Procurement routes (purchase side)
    const procurementRoutes: string[] = [
      "/app/procurement-workbench",
      "/app/suppliers",
      "/app/purchases",
      "/app/proformas",
      "/app/purchase-orders",
      "/app/grn",
      "/app/advances",
      "/app/notes",
    ];
    // Supplier list routes
    const supplierListRoutes: string[] = [
      "/app/suppliers",
    ];
    // Debtor list routes
    const debtorListRoutes: string[] = [
      "/app/debtors",
    ];
    // Naughty list routes
    const naughtyListRoutes: string[] = [
      "/app/naughty-list",
    ];
    // Product Catalogue routes (standalone sidebar tab)
    const catalogueRoutes: string[] = [
      "/app/products",
    ];
    // Warehouse Control routes (hidden: /app/inventory kept out of nav for now)
    const warehouseControlRoutes: string[] = [
      "/app/warehouse-workbench",
      "/app/warehouse",
      "/app/forecast",
      "/app/grn",
      "/app/dispatches",
      "/app/challan",
      "/app/stock-allocation",
      "/app/sample-distribution",
    ];

    // Include all warehouse-control routes for admin (they have full access)
    const adminAllowedRoutes = [
      "/app/dashboard",
      "/app/reporting",
      "/app/cash-flow",
      "/app/queue",
      "/app/bulk-payments",
      "/app/admin",
      "/app/alerts",
      "/app/reminders",
      "/app/template",
      "/app/settings",
      ...procurementRoutes,
      ...supplierListRoutes,
      ...salesRoutes,
      ...financeRoutes,
      ...naughtyListRoutes,
      ...catalogueRoutes,
      ...warehouseControlRoutes,
    ];

    const operationsAllowed: string[] = [
      "/app/dashboard",
      "/app/reporting",
      "/app/cash-flow",
      "/app/queue",
      "/app/bulk-payments",
      "/app/sales-workbench",
      ...procurementRoutes,
      ...supplierListRoutes,
      ...salesRoutes,
      ...financeRoutes,
      ...naughtyListRoutes,
      ...catalogueRoutes,
      ...warehouseControlRoutes,
    ];

    // Quick admin allowed routes (for admin quick items)
    const adminQuickAllowed: string[] = [
      ...debtorListRoutes,
      ...supplierListRoutes,
    ];

    // Sales rep allowed routes
    const salesmanAllowed: string[] = [
      "/app/dashboard",
      "/app/sales-workbench",
      "/app/crm",
      "/app/debtors",
      "/app/suppliers",
      "/app/naughty-list",
    ];

    // Seller allowed routes (for view-as)
    const sellerAllowed: string[] = [
      "/app/sales-orders",
      "/app/invoices",
      "/app/proformas",
      "/app/advances",
      "/app/notes",
      "/app/debtors",
      "/app/suppliers",
      "/app/naughty-list",
    ];

    // Admin goes anywhere — no route wall needed
    if (isAdmin || isSuperAdmin) return;

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
    isSuperAdmin,
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

  // ─── Build navigation sections per role ──────────────────────
  // NOTE: all hooks must run unconditionally on every render (Rules of Hooks).
  // Nothing may early-return above the queries below, otherwise the hook
  // count changes between the loading=true and loading=false renders and
  // React throws #310 ("Rendered more hooks than during the previous render").
  // In view-as mode the sidebar mirrors the team member's own tabs (e.g. a
  // salesperson sees CRM / Leads, Debtors, Suppliers + their Workspace);
  // otherwise it reflects the signed-in user's roles.
  const navSections = buildNavSections(effectiveRoles);

  // Current page label, shown in the top bar for orientation.
  const currentPage = (() => {
    // Detail / preview routes that don't share a nav-item prefix.
    const DETAIL_LABELS: [string, string][] = [
      ["/app/challan/", "Challan"],
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

  // When in view-as mode every navigation keeps the viewAsUserId search param
  // so the reporting manager keeps browsing the team member's data.
  const viewSearch = viewAsActive ? { viewAsUserId } : {};

  // ─── Notification badges (only show when there are actual items) ──
  // Single lightweight query: open workflow tasks drive the My Queue count,
  // and the checker-owned slice drives the Checker badge.
  const showBadges = navSections.some((s) =>
    s.type === "single"
      ? s.label === "Checker" || s.label === "My Queue"
      : false,
  );
  const openTasksQ = useQuery({
    queryKey: ["sidebar-open-tasks"],
    queryFn: () => api.workflowTasks.list({ status: "open" }),
    enabled: showBadges && !!user,
    staleTime: 60_000,
    retry: false,
  });
  const openTasks: any[] = Array.isArray(openTasksQ.data) ? openTasksQ.data : [];
  const queueCount = openTasks.length > 0 ? openTasks.length : undefined;
  const checkerCount = (() => {
    if (openTasks.length === 0) return undefined;
    const n = openTasks.filter((t: any) =>
      ["checker", "checker_pending", "pending_review", "pending_checker"].some((k) =>
        `${t?.owner_role ?? ""} ${t?.stage ?? ""} ${t?.doc_status ?? ""} ${t?.status ?? ""}`
          .toLowerCase()
          .includes(k),
      ),
    ).length;
    return n > 0 ? n : undefined;
  })();

  // ─── Alerts unread count for the topbar bell (§5: red badge) ──
  const alertsQ = useQuery({
    queryKey: ["topbar-alerts"],
    queryFn: () => api.alerts.list(),
    enabled: !!user,
    staleTime: 60_000,
    retry: false,
  });
  const alertsCount = Array.isArray(alertsQ.data)
    ? alertsQ.data.filter((a: any) => !a?.is_read).length
    : 0;

  // Icon for the current page pill (active nav item's icon, Home fallback).
  const pageIcon = (() => {
    for (const s of navSections) {
      if (s.type === "single" && (pathname === s.to || pathname.startsWith(s.to + "/")))
        return s.icon;
      if (s.type === "group") {
        const item = s.items.find((n) => pathname === n.to || pathname.startsWith(n.to + "/"));
        if (item) return item.icon;
      }
    }
    return undefined;
  })();

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
          <SheetContent side="left" className="w-[280px] bg-white p-0 dark:bg-sidebar">
            <AppSidebar
              navSections={navSections}
              pathname={pathname}
              onSearch={() => {
                setMobileOpen(false);
                setCmdOpen(true);
              }}
              viewSearch={viewSearch}
              badges={{ checker: checkerCount, queue: queueCount }}
              hideCollapse
              onNavigate={() => setMobileOpen(false)}
            />
          </SheetContent>
        </Sheet>
        <div className="flex items-center gap-2">
          <span className="font-display text-sm tracking-tight">Whizunik Command</span>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Link
            to="/app/alerts"
            aria-label={alertsCount > 0 ? `Alerts, ${alertsCount} unread` : "Alerts"}
            title="Alerts"
            className="relative rounded-md border border-border p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <BellRing className="h-4 w-4" />
            {alertsCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#e5484d] px-1 text-[9px] font-bold text-white ring-2 ring-background">
                {alertsCount > 99 ? "99+" : alertsCount}
              </span>
            )}
          </Link>
          <button
            onClick={() => setCmdOpen(true)}
            aria-label="Quick navigate"
            className="rounded-md border border-border p-2 text-muted-foreground"
          >
            <Search className="h-4 w-4" />
          </button>
          <ThemeMenu theme={theme} setTheme={setTheme} />
        </div>
      </div>

      {/* Desktop sidebar — premium light theme (§11) */}
      <aside className="sticky top-0 hidden h-screen shrink-0 flex-col border-r border-[#e5ebf2] bg-white shadow-[4px_0_24px_-12px_rgba(10,34,57,0.18)] md:flex dark:border-sidebar-border dark:bg-sidebar print:hidden">
        <AppSidebar
          navSections={navSections}
          pathname={pathname}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
          onSearch={() => setCmdOpen(true)}
          viewSearch={viewSearch}
          badges={{ checker: checkerCount, queue: queueCount }}
        />
      </aside>

      {/* Main content area */}
      <main className="app-surface whiz-shell whiz-page flex-1 min-w-0 pt-14 md:pt-0">
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
        <AppTopbar
          currentPage={currentPage}
          pageIcon={pageIcon}
          onSearch={() => setCmdOpen(true)}
          alertsCount={alertsCount}
          userEmail={user?.email}
          userPhotoUrl={user?.photoUrl}
          theme={theme}
          setTheme={setTheme}
          onNavigate={(to) => navigate({ to, search: viewSearch })}
          onSignOut={handleSignOut}
        />
        <div key={pathname.split("/").slice(0, 3).join("/")} className="page-enter px-4 pt-4 md:px-6">
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
