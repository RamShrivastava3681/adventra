import { Link } from "@tanstack/react-router";
import {
  Bell,
  Briefcase,
  Check,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Home,
  LogOut,
  Monitor,
  Moon,
  Search,
  Settings,
  Sun,
  User,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Theme } from "@/lib/theme";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ─── Appearance menu — Light / Dark / System ───
const THEME_OPTIONS: { value: Theme; label: string; icon: any }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function ThemeMenu({
  theme,
  setTheme,
}: {
  theme: Theme;
  setTheme: (t: Theme) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Appearance"
          title="Appearance"
          className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] text-[#334155] transition-colors duration-150 hover:bg-[#f1f5f9] hover:text-[#0e1b2c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-muted-foreground dark:hover:bg-sidebar-accent dark:hover:text-sidebar-foreground"
        >
          {theme === "light" ? (
            <Sun className="h-5 w-5" strokeWidth={1.8} />
          ) : theme === "dark" ? (
            <Moon className="h-5 w-5" strokeWidth={1.8} />
          ) : (
            <Monitor className="h-5 w-5" strokeWidth={1.8} />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel className="px-2 py-1.5 text-xs font-normal text-muted-foreground">
          Appearance
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {THEME_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const active = theme === opt.value;
          return (
            <DropdownMenuItem
              key={opt.value}
              onClick={() => setTheme(opt.value)}
              className={cn("cursor-pointer", active && "text-primary")}
            >
              <Icon className="mr-2 h-4 w-4" />
              <span className="flex-1">{opt.label}</span>
              {active && <Check className="h-4 w-4" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type Props = {
  currentPage: string;
  pageIcon?: LucideIcon;
  collapsed: boolean;
  onToggleSidebar: () => void;
  onSearch: () => void;
  alertsCount?: number;
  userEmail?: string | null;
  userPhotoUrl?: string | null;
  theme: Theme;
  setTheme: (t: Theme) => void;
  onNavigate: (to: string) => void;
  onSignOut: () => void;
};

function CountBadge({ count }: { count: number }) {
  if (!count || count <= 0) return null;
  return (
    <span
      aria-label={`${count} unread`}
      className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#e5484d] px-1 text-[10px] font-bold tabular-nums text-white shadow-sm ring-2 ring-white dark:ring-sidebar"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/**
 * Top Navigation Bar — Top Navigation Bar Design Prompt.
 * White 64px floating card: sidebar toggle, large global search,
 * current-page pill, search shortcut, notifications with unread badge,
 * appearance, avatar + name + dropdown. Matches the sidebar language.
 */
export function AppTopbar({
  currentPage,
  pageIcon,
  collapsed,
  onToggleSidebar,
  onSearch,
  alertsCount = 0,
  userEmail,
  userPhotoUrl,
  theme,
  setTheme,
  onNavigate,
  onSignOut,
}: Props) {
  const PageIcon = pageIcon ?? Home;
  const displayName = userEmail?.split("@")[0] || "User";
  const initial = (userEmail || "U").charAt(0).toUpperCase();

  return (
    <div className="sticky top-3 z-30 hidden px-4 md:block print:hidden">
      <header
        aria-label="Top navigation"
        className="flex h-16 items-center gap-3 rounded-2xl border border-[#e5ebf2] bg-white px-4 shadow-[0_8px_28px_-12px_rgba(10,34,57,0.18)] dark:border-sidebar-border dark:bg-sidebar dark:shadow-none"
      >
        {/* ── 2. Sidebar toggle ── */}
        <button
          onClick={onToggleSidebar}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-[#e5ebf2] text-[#334155] transition-colors duration-150 hover:bg-[#f1f5f9] hover:text-[#0e1b2c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-sidebar-border dark:text-muted-foreground dark:hover:bg-sidebar-accent dark:hover:text-sidebar-foreground"
        >
          {collapsed ? (
            <ChevronsRight className="h-5 w-5" strokeWidth={1.8} />
          ) : (
            <ChevronsLeft className="h-5 w-5" strokeWidth={1.8} />
          )}
        </button>

        <span aria-hidden className="h-8 w-px shrink-0 bg-[#e5ebf2] dark:bg-sidebar-border" />

        {/* ── 3. Search bar ── */}
        <button
          onClick={onSearch}
          aria-label="Search documents, inventory, or approvals (Ctrl+K)"
          className="group flex h-10 w-full max-w-xl min-w-0 items-center gap-2.5 rounded-xl border border-[#dce5ee] bg-white px-3.5 text-[13px] text-[#64748b] shadow-sm transition-colors duration-150 hover:border-[#c5d2df] hover:bg-[#f8fafc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-sidebar-border dark:bg-sidebar-accent/40 dark:text-muted-foreground dark:hover:text-sidebar-foreground"
        >
          <Search className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} />
          <span className="flex-1 truncate text-left font-normal">
            Search documents, inventory, or approvals…
          </span>
          <kbd className="hidden shrink-0 items-center gap-1 rounded-md border border-[#dce5ee] bg-[#f1f5f9] px-1.5 py-0.5 font-mono text-[10px] font-medium text-[#64748b] sm:inline-flex dark:border-sidebar-border dark:bg-sidebar">
            ⌘K
          </kbd>
        </button>

        {/* ── 4. Page / breadcrumb pill ── */}
        {currentPage && (
          <span className="hidden h-9 shrink-0 items-center gap-2 truncate rounded-[10px] bg-[#eef7ff] px-3 text-[13px] font-semibold text-[#0067c2] lg:inline-flex dark:bg-sidebar-accent dark:text-sidebar-primary">
            <PageIcon className="h-4 w-4 shrink-0" strokeWidth={2} />
            <span className="truncate">{currentPage}</span>
          </span>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {/* ── 5a. Search icon + shortcut ── */}
          <button
            onClick={onSearch}
            aria-label="Search (Ctrl+K)"
            title="Search (Ctrl+K)"
            className="hidden h-9 items-center gap-2 rounded-[10px] px-2.5 text-[#334155] transition-colors duration-150 hover:bg-[#f1f5f9] hover:text-[#0e1b2c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:inline-flex dark:text-muted-foreground dark:hover:bg-sidebar-accent dark:hover:text-sidebar-foreground"
          >
            <Search className="h-5 w-5" strokeWidth={1.8} />
            <kbd className="hidden rounded-md border border-[#dce5ee] bg-[#f1f5f9] px-1.5 py-0.5 font-mono text-[10px] font-medium text-[#64748b] xl:inline-flex dark:border-sidebar-border dark:bg-sidebar">
              ⌘K
            </kbd>
          </button>

          {/* ── 5b. Notifications ── */}
          <Link
            to="/app/alerts"
            aria-label={alertsCount > 0 ? `Alerts, ${alertsCount} unread` : "Alerts"}
            title="Alerts"
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-[10px] text-[#334155] transition-colors duration-150 hover:bg-[#f1f5f9] hover:text-[#0e1b2c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-muted-foreground dark:hover:bg-sidebar-accent dark:hover:text-sidebar-foreground"
          >
            <Bell className="h-5 w-5" strokeWidth={1.8} />
            <CountBadge count={alertsCount} />
          </Link>

          <ThemeMenu theme={theme} setTheme={setTheme} />

          <span aria-hidden className="mx-1.5 h-8 w-px bg-[#e5ebf2] dark:bg-sidebar-border" />

          {/* ── 5c. User avatar + name + dropdown ── */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label={`Account: ${userEmail ?? "user"}`}
                className="flex h-10 items-center gap-2 rounded-xl px-1.5 text-sm transition-colors duration-150 hover:bg-[#f1f5f9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-sidebar-accent"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#eef7ff] text-[15px] font-bold text-[#0067c2] dark:bg-sidebar-accent dark:text-sidebar-primary">
                  {initial}
                </span>
                <span className="hidden max-w-[110px] truncate text-[13px] font-semibold text-[#0e1b2c] xl:inline dark:text-sidebar-foreground">
                  {displayName}
                </span>
                <ChevronDown className="hidden h-4 w-4 text-[#64748b] sm:block" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="px-2 py-1.5 text-xs font-normal text-muted-foreground">
                <span className="flex items-center gap-2">
                  <Avatar className="h-6 w-6">
                    <AvatarImage src={userPhotoUrl || undefined} />
                    <AvatarFallback className="bg-primary-soft text-[10px] font-semibold text-primary">
                      {initial}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate">{userEmail}</span>
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onNavigate("/app/profile")} className="cursor-pointer">
                <User className="mr-2 h-4 w-4" /> Profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onNavigate("/app/workspace")} className="cursor-pointer">
                <Briefcase className="mr-2 h-4 w-4" /> My Workspace
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onNavigate("/app/settings")} className="cursor-pointer">
                <Settings className="mr-2 h-4 w-4" /> Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onSignOut}
                className="cursor-pointer text-destructive focus:text-destructive"
              >
                <LogOut className="mr-2 h-4 w-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
    </div>
  );
}
