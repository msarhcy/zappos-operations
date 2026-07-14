import { useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  ClipboardList,
  Radio,
  Truck,
  Users,
  Wrench,
  AlertTriangle,
  FileText,
  Building2,
  Bell,
  Settings,
  LogOut,
  Menu,
  X,
  Smartphone,
  MapPinned,
  Route,
  BrainCircuit,
  Cpu,
  HardHat,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { useSession } from "@/lib/session";
import { Wordmark } from "@/components/brand/wordmark";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

type Role = Database["public"]["Enums"]["app_role"];

interface NavItem {
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: Role[]; // if omitted, all roles allowed
  mobile?: boolean; // show on mobile bottom nav
}

const ALL: NavItem[] = [
  { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard, mobile: true },
  {
    label: "Command centre",
    to: "/command-centre",
    icon: Radio,
    roles: ["admin", "fleet_manager", "dispatcher", "viewer"],
    mobile: true,
  },
  { label: "Driver", to: "/driver", icon: Smartphone, roles: ["driver"], mobile: true },
  {
    label: "Tracking",
    to: "/tracking",
    icon: MapPinned,
    roles: ["admin", "fleet_manager", "dispatcher", "viewer"],
    mobile: true,
  },
  {
    label: "Control centre",
    to: "/operations-control",
    icon: Radio,
    roles: ["admin", "fleet_manager", "dispatcher", "viewer"],
    mobile: true,
  },
  {
    label: "Route intelligence",
    to: "/route-intelligence",
    icon: Route,
    roles: ["admin", "fleet_manager", "dispatcher", "viewer"],
  },
  {
    label: "Zapp Brain",
    to: "/brain",
    icon: BrainCircuit,
    roles: ["admin", "fleet_manager", "dispatcher", "viewer"],
  },
  {
    label: "Hardware readiness",
    to: "/hardware-readiness",
    icon: Cpu,
    roles: ["admin", "fleet_manager", "dispatcher", "viewer"],
  },
  {
    label: "Field deployment",
    to: "/field-deployment",
    icon: HardHat,
    roles: ["admin", "fleet_manager", "dispatcher", "viewer"],
  },
  { label: "Operations", to: "/operations", icon: ClipboardList, mobile: true },
  { label: "Dispatch", to: "/dispatch", icon: Radio, roles: ["admin", "dispatcher"], mobile: true },
  {
    label: "Vehicles",
    to: "/vehicles",
    icon: Truck,
    roles: ["admin", "fleet_manager", "dispatcher", "viewer"],
  },
  {
    label: "Drivers",
    to: "/drivers",
    icon: Users,
    roles: ["admin", "fleet_manager", "dispatcher", "viewer"],
  },
  {
    label: "Maintenance",
    to: "/maintenance",
    icon: Wrench,
    roles: ["admin", "fleet_manager", "viewer"],
  },
  { label: "Incidents", to: "/incidents", icon: AlertTriangle, mobile: true },
  {
    label: "Documents",
    to: "/documents",
    icon: FileText,
    roles: ["admin", "fleet_manager", "viewer"],
  },
  {
    label: "Customers",
    to: "/customers",
    icon: Building2,
    roles: ["admin", "dispatcher", "viewer"],
  },
  { label: "Notifications", to: "/notifications", icon: Bell, mobile: true },
  { label: "Settings", to: "/settings", icon: Settings, roles: ["admin"] },
];

function filterFor(items: NavItem[], roles: Role[]): NavItem[] {
  return items.filter((i) => !i.roles || i.roles.some((r) => roles.includes(r)));
}

export function AppShell({ children }: { children: ReactNode }) {
  const { activeCompany, roles, terminology } = useCompany();
  const { user } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const hasElevatedAccess = roles.some((role) =>
    ["admin", "fleet_manager", "dispatcher"].includes(role),
  );
  const driverRestricted = roles.includes("driver") && !hasElevatedAccess;

  // Rename Operations label based on terminology
  const navItems = filterFor(ALL, roles)
    .filter((item) => !driverRestricted || ["/driver", "/notifications"].includes(item.to))
    .map((i) => (i.to === "/operations" ? { ...i, label: terminology.Plural } : i));
  const mobileNav = navItems.filter((i) => i.mobile).slice(0, 5);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex h-16 items-center border-b border-sidebar-border px-4">
          <Wordmark size="md" />
        </div>
        <div className="px-3 pt-4">
          <div className="rounded-md bg-sidebar-accent/60 px-3 py-2 text-xs">
            <div className="truncate font-semibold text-sidebar-accent-foreground">
              {activeCompany?.name}
            </div>
            <div className="mt-0.5 truncate text-[10px] uppercase tracking-wider text-muted-foreground">
              {roles.join(" · ") || "no role"}
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = location.pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-primary/15 text-sidebar-primary"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <div className="mb-2 truncate text-xs text-muted-foreground">{user?.email}</div>
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={signOut}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur lg:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <Wordmark size="sm" />
          </div>
          <Link to="/notifications" aria-label="Notifications">
            <Button variant="ghost" size="icon">
              <Bell className="h-5 w-5" />
            </Button>
          </Link>
        </header>

        {/* Content */}
        <main className="min-w-0 flex-1 pb-20 lg:pb-0">{children}</main>

        {/* Mobile bottom nav */}
        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-background/95 backdrop-blur lg:hidden">
          {mobileNav.map((item) => {
            const Icon = item.icon;
            const active = location.pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-sidebar-border bg-sidebar p-3">
            <div className="mb-3 flex items-center justify-between">
              <Wordmark size="md" />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileOpen(false)}
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="mb-3 rounded-md bg-sidebar-accent/60 px-3 py-2 text-xs">
              <div className="truncate font-semibold">{activeCompany?.name}</div>
              <div className="mt-0.5 truncate text-[10px] uppercase tracking-wider text-muted-foreground">
                {roles.join(" · ") || "no role"}
              </div>
            </div>
            <nav className="space-y-0.5">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = location.pathname.startsWith(item.to);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm",
                      active
                        ? "bg-sidebar-primary/15 text-sidebar-primary"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <div className="mt-4 border-t border-sidebar-border pt-3">
              <div className="mb-2 truncate px-1 text-xs text-muted-foreground">{user?.email}</div>
              <Button variant="ghost" size="sm" className="w-full justify-start" onClick={signOut}>
                <LogOut className="mr-2 h-4 w-4" /> Sign out
              </Button>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
