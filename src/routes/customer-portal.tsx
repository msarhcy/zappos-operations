/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Loader2,
  LayoutDashboard,
  Package2,
  FileText,
  MessageSquare,
  Settings,
  ArrowLeft,
} from "lucide-react";
import { useSession } from "@/lib/session";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/customer-portal")({
  head: () => ({ meta: [{ title: "Customer portal — ZappOS" }] }),
  component: CustomerPortalLayout,
});

function CustomerPortalLayout() {
  const { session, loading } = useSession();
  const navigate = useNavigate();
  const [membership, setMembership] = useState<any>(null);
  const [loadingMembership, setLoadingMembership] = useState(true);

  useEffect(() => {
    if (!loading && !session) {
      navigate({ to: "/auth", replace: true });
      return;
    }

    if (!session) return;

    const load = async () => {
      setLoadingMembership(true);
      const { data, error } = await supabase
        .from("customer_portal_memberships")
        .select("*, customers:customer_id(id, name), companies:company_id(id, name)")
        .eq("user_id", session.user.id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      if (!error) {
        setMembership(data);
      }
      setLoadingMembership(false);
    };

    void load();
  }, [loading, session, navigate]);

  if (loading || loadingMembership) {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-4">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading customer portal...
        </div>
      </div>
    );
  }

  if (!membership) {
    return (
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-4 py-12">
        <Card className="p-6">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Access restricted
          </p>
          <h1 className="mt-2 text-2xl font-semibold">No active customer portal access</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Your account is not currently linked to an approved customer portal membership.
          </p>
          <Button className="mt-5" onClick={() => navigate({ to: "/auth" })}>
            Return to sign in
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="border-b border-white/10 bg-slate-900/70">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Customer portal</p>
            <h1 className="text-lg font-semibold">
              {membership.customers?.name ?? "Customer portal"}
            </h1>
          </div>
          <Button
            variant="ghost"
            className="gap-2 text-slate-200"
            onClick={() => navigate({ to: "/auth" })}
          >
            <ArrowLeft className="h-4 w-4" />
            Exit
          </Button>
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="space-y-3 rounded-2xl border border-white/10 bg-slate-900/80 p-3">
          <NavLink to="/customer-portal" label="Dashboard" icon={LayoutDashboard} />
          <NavLink to="/customer-portal/shipments" label="Shipments" icon={Package2} />
          <NavLink to="/customer-portal/documents" label="Documents" icon={FileText} />
          <NavLink to="/customer-portal/requests" label="Requests" icon={MessageSquare} />
          <NavLink to="/customer-portal/settings" label="Settings" icon={Settings} />
        </aside>
        <main className="min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function NavLink({ to, label, icon: Icon }: { to: string; label: string; icon: any }) {
  const location = useLocation();
  const active = location.pathname.startsWith(to);

  return (
    <Link
      to={to}
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors",
        active
          ? "bg-slate-800 text-white"
          : "text-slate-400 hover:bg-slate-800/70 hover:text-white",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );
}
