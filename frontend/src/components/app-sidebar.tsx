import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Command,
  Search,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ─── Shared nav types (mirrors app.tsx, no logic change) ──
export type NavItem = { to: string; label: string; icon: any };
export type NavSection =
  | { type: "single"; label: string; icon: any; to: string }
  | { type: "group"; label: string; icon: any; items: NavItem[] };

// Display buckets from the Sidebar Design Prompt (§3)
const SECTION_ORDER = [
  "MAIN",
  "SALES & CUSTOMERS",
  "PROCUREMENT & SUPPLIERS",
  "PRODUCTS & INVENTORY",
  "FINANCE",
  "REPORTS & SYSTEM",
] as const;

function bucketFor(label: string, type: string): (typeof SECTION_ORDER)[number] {
  switch (label) {
    case "Dashboard":
    case "My Queue":
    case "Checker":
    case "My Workspace":
      return "MAIN";
    case "Sales Workbench":
    case "Leads":
    case "Naughty List":
    case "Customers":
      return "SALES & CUSTOMERS";
    case "Procurement":
    case "Suppliers":
      return "PROCUREMENT & SUPPLIERS";
    case "Product Catalogue":
    case "Warehouse Control":
      return "PRODUCTS & INVENTORY";
    case "Finance":
      return "FINANCE";
    case "Reports":
    case "My Reports":
    case "System":
      return "REPORTS & SYSTEM";
    default:
      return type === "group" ? "REPORTS & SYSTEM" : "MAIN";
  }
}

export type SidebarBadges = { checker?: number; queue?: number };

type Props = {
  navSections: NavSection[];
  pathname: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onSearch: () => void;
  viewSearch?: Record<string, unknown>;
  badges?: SidebarBadges;
  hideCollapse?: boolean;
  onNavigate?: () => void;
};

function badgeFor(label: string, badges?: SidebarBadges): number | undefined {
  if (!badges) return undefined;
  if (label === "Checker") return badges.checker;
  if (label === "My Queue") return badges.queue;
  return undefined;
}

function Badge({ count }: { count: number }) {
  if (!count || count <= 0) return null;
  const text = count > 99 ? "99+" : String(count);
  return (
    <span
      aria-label={`${count} pending`}
      className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#e5484d] px-1.5 text-[11px] font-bold tabular-nums text-white shadow-sm"
    >
      {text}
    </span>
  );
}

function ItemTooltip({
  enabled,
  label,
  children,
}: {
  enabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" align="center">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function AppSidebar({
  navSections,
  pathname,
  collapsed = false,
  onToggleCollapse,
  onSearch,
  viewSearch = {},
  badges,
  hideCollapse = false,
  onNavigate,
}: Props) {
  const isActive = (to: string) => pathname === to || pathname.startsWith(to + "/");

  // Group nav into the six spec sections, preserving role-filtered order.
  const grouped = useMemo(() => {
    const buckets = new Map<string, NavSection[]>();
    for (const s of navSections) {
      const key = bucketFor(s.label, s.type);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(s);
    }
    return SECTION_ORDER.filter((k) => (buckets.get(k)?.length ?? 0) > 0).map((k) => ({
      title: k as string,
      sections: buckets.get(k)!,
    }));
  }, [navSections]);

  // Accordion state: auto-open the group containing the active child.
  const activeGroup = useMemo(
    () =>
      navSections.find(
        (s): s is Extract<NavSection, { type: "group" }> =>
          s.type === "group" && s.items.some((n) => isActive(n.to)),
      )?.label ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navSections, pathname],
  );
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    if (activeGroup) setExpanded(activeGroup);
  }, [activeGroup]);
  // When collapsed, close the accordion (tooltips take over instead).
  useEffect(() => {
    if (collapsed) setExpanded(null);
  }, [collapsed]);

  const singleLink = (label: string, icon: any, to: string) => {
    const active = isActive(to);
    const Icon = icon;
    const count = badgeFor(label, badges);
    const link = (
      <Link
        to={to}
        search={viewSearch}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex h-10 w-full items-center gap-3 rounded-[10px] px-3 text-[13.5px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active
            ? "bg-[#e9f3fe] text-[#0067c2] dark:bg-sidebar-accent dark:text-sidebar-accent-foreground"
            : "text-[#334155] hover:bg-[#f1f5f9] hover:text-[#0e1b2c] dark:text-muted-foreground dark:hover:bg-sidebar-accent/60 dark:hover:text-sidebar-accent-foreground",
        )}
      >
        {active && (
          <span
            aria-hidden
            className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[#0067c2] dark:bg-sidebar-primary"
          />
        )}
        <Icon
          className={cn(
            "h-5 w-5 shrink-0 transition-colors duration-150",
            active ? "text-[#0067c2] dark:text-sidebar-primary" : "text-[#64748b] group-hover:text-[#0e1b2c] dark:text-muted-foreground",
          )}
          strokeWidth={1.8}
        />
        {!collapsed && <span className="truncate">{label}</span>}
        {!collapsed && count != null && count > 0 && <Badge count={count} />}
        {collapsed && count != null && count > 0 && (
          <span
            aria-hidden
            className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[#e5484d] ring-2 ring-white dark:ring-sidebar"
          />
        )}
      </Link>
    );
    return (
      <ItemTooltip key={to} enabled={collapsed} label={label}>
        {link}
      </ItemTooltip>
    );
  };

  return (
    <TooltipProvider delayDuration={0}>
      <div
        className={cn(
          "flex h-full min-h-0 flex-col bg-white text-[#0e1b2c] transition-[width] duration-200 ease-linear dark:bg-sidebar dark:text-sidebar-foreground",
          collapsed ? "w-[68px]" : "w-[260px]",
        )}
      >
        {/* ── 1. Brand / logo ── */}
        <div className="flex shrink-0 items-center gap-2 px-4 pb-3 pt-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0067c2] text-[17px] font-bold text-white shadow-sm">
            W
          </span>
          {!collapsed && (
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[16px] font-bold tracking-tight text-[#0e1b2c] dark:text-sidebar-foreground">
                Whizunik
              </span>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.24em] text-[#64748b]">
                Command
              </span>
            </span>
          )}
          {!hideCollapse && !collapsed && onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#64748b] transition-colors hover:bg-[#f1f5f9] hover:text-[#0e1b2c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-sidebar-accent"
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>
          )}
        </div>
        {!hideCollapse && collapsed && onToggleCollapse && (
          <div className="flex shrink-0 justify-center pb-1">
            <button
              onClick={onToggleCollapse}
              aria-label="Expand sidebar"
              title="Expand sidebar"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[#64748b] transition-colors hover:bg-[#f1f5f9] hover:text-[#0e1b2c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-sidebar-accent"
            >
              <ChevronsRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* ── 2. Search ── */}
        <div className={cn("shrink-0 px-3 pb-1 pt-1")}>
          <ItemTooltip enabled={collapsed} label="Search anything… (Ctrl+K)">
            <button
              onClick={onSearch}
              className={cn(
                "group flex h-10 w-full items-center gap-2.5 rounded-[10px] border border-[#dce5ee] bg-white px-3 text-[13px] text-[#64748b] shadow-sm transition-colors duration-150 hover:border-[#c5d2df] hover:bg-[#f8fafc] hover:text-[#0e1b2c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-sidebar-border dark:bg-sidebar-accent/40 dark:text-muted-foreground dark:hover:text-sidebar-foreground",
                collapsed && "justify-center px-0",
              )}
            >
              <Search className="h-4 w-4 shrink-0" />
              {!collapsed && (
                <>
                  <span className="flex-1 truncate text-left font-normal">Search anything…</span>
                  <kbd className="hidden items-center gap-0.5 rounded-md border border-[#dce5ee] bg-[#f1f5f9] px-1.5 py-0.5 font-mono text-[10px] font-medium text-[#64748b] md:inline-flex dark:border-sidebar-border dark:bg-sidebar">
                    <Command className="h-2.5 w-2.5" />K
                  </kbd>
                </>
              )}
            </button>
          </ItemTooltip>
        </div>

        {/* ── 3. Navigation sections ── */}
        <nav aria-label="Primary" className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {grouped.map((g) => (
            <div key={g.title} className="mb-1">
              {!collapsed && (
                <div className="flex items-center gap-2 px-3 pb-1.5 pt-4 text-[10px] font-bold uppercase tracking-[0.16em] text-[#64748b]">
                  <span className="shrink-0">{g.title}</span>
                  <span aria-hidden className="h-px flex-1 bg-[#e5ebf2] dark:bg-sidebar-border" />
                </div>
              )}
              {collapsed && <div aria-hidden className="mx-2 my-2 h-px bg-[#e5ebf2] dark:bg-sidebar-border" />}
              <ul className="flex flex-col gap-[2px]">
                {g.sections.map((section) => {
                  if (section.type === "single") {
                    return <li key={section.to}>{singleLink(section.label, section.icon, section.to)}</li>;
                  }
                  const Icon = section.icon;
                  const hasActiveChild = section.items.some((n) => isActive(n.to));
                  const open = expanded === section.label && !collapsed;
                  const parentBtn = (
                    <button
                      onClick={() => setExpanded(open ? null : section.label)}
                      aria-expanded={open}
                      className={cn(
                        "group relative flex h-10 w-full items-center gap-3 rounded-[10px] px-3 text-[13.5px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        hasActiveChild || open
                          ? "bg-[#e9f3fe] text-[#0067c2] dark:bg-sidebar-accent dark:text-sidebar-accent-foreground"
                          : "text-[#334155] hover:bg-[#f1f5f9] hover:text-[#0e1b2c] dark:text-muted-foreground dark:hover:bg-sidebar-accent/60 dark:hover:text-sidebar-accent-foreground",
                        collapsed && "justify-center px-0",
                      )}
                    >
                      {(hasActiveChild || open) && !collapsed && (
                        <span
                          aria-hidden
                          className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[#0067c2] dark:bg-sidebar-primary"
                        />
                      )}
                      <Icon
                        className={cn(
                          "h-5 w-5 shrink-0",
                          hasActiveChild || open
                            ? "text-[#0067c2] dark:text-sidebar-primary"
                            : "text-[#64748b] group-hover:text-[#0e1b2c]",
                        )}
                        strokeWidth={1.8}
                      />
                      {!collapsed && (
                        <>
                          <span className="flex-1 truncate text-left">{section.label}</span>
                          <ChevronRight
                            className={cn(
                              "h-4 w-4 shrink-0 transition-transform duration-150",
                              open && "rotate-90",
                            )}
                          />
                        </>
                      )}
                    </button>
                  );
                  return (
                    <li key={section.label}>
                      <ItemTooltip enabled={collapsed} label={section.label}>
                        {parentBtn}
                      </ItemTooltip>
                      {open && (
                        <ul className="mb-1 ml-4 mt-1 space-y-[2px] border-l border-[#e5ebf2] pl-3 dark:border-sidebar-border">
                          {section.items.map((n) => {
                            const active = isActive(n.to);
                            const ItemIcon = n.icon;
                            return (
                              <li key={n.to}>
                                <Link
                                  to={n.to}
                                  search={viewSearch}
                                  onClick={onNavigate}
                                  aria-current={active ? "page" : undefined}
                                  className={cn(
                                    "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                    active
                                      ? "bg-[#e9f3fe] text-[#0067c2] dark:bg-sidebar-accent dark:text-sidebar-accent-foreground"
                                      : "text-[#475569] hover:bg-[#f1f5f9] hover:text-[#0e1b2c] dark:text-muted-foreground dark:hover:text-sidebar-foreground",
                                  )}
                                >
                                  <ItemIcon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                                  <span className="truncate">{n.label}</span>
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* ── 10. Bottom brand message ── */}
        <div className="shrink-0 border-t border-[#eef2f7] p-3 dark:border-sidebar-border">
          {collapsed ? (
            <div className="flex justify-center">
              <ItemTooltip enabled label="Build today. Stronger tomorrow.">
                <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#eef7ff] text-[#0067c2] dark:bg-sidebar-accent dark:text-sidebar-primary">
                  <TrendingUp className="h-4 w-4" />
                </span>
              </ItemTooltip>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 rounded-[10px] bg-[#eef7ff] px-3 py-2.5 dark:bg-sidebar-accent">
              <TrendingUp className="h-4 w-4 shrink-0 text-[#0067c2] dark:text-sidebar-primary" />
              <p className="text-[12.5px] leading-snug text-[#334155] dark:text-sidebar-accent-foreground">
                Build today.
                <span className="block font-bold text-[#0a4a8a] dark:text-sidebar-accent-foreground">
                  Stronger tomorrow.
                </span>
              </p>
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
