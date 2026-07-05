import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useSession } from "@/lib/session";
import { CompanyProvider, useCompany } from "@/lib/company-context";
import { AppShell } from "@/components/app-shell";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated")({
  component: AuthedLayout,
});

function AuthedLayout() {
  const { session, loading } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth", replace: true });
  }, [session, loading, navigate]);

  if (loading || !session) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <CompanyProvider>
      <CompanyGate>
        <AppShell>
          <Outlet />
        </AppShell>
      </CompanyGate>
    </CompanyProvider>
  );
}

function CompanyGate({ children }: { children: React.ReactNode }) {
  const { loading, companies } = useCompany();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && companies.length === 0) navigate({ to: "/onboarding", replace: true });
  }, [loading, companies.length, navigate]);

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (companies.length === 0) return null;
  return <>{children}</>;
}
