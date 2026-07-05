import { createFileRoute } from "@tanstack/react-router";
import { useCompany } from "@/lib/company-context";
import { Card } from "@/components/ui/card";
import { AlertTriangle, Clock, Radio, Truck, Users, Wrench, XCircle, Zap } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — ZappOS" }] }),
  component: DashboardPage,
});

function Stat({ icon: Icon, label, value, tone }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string | number; tone?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        <Icon className={`h-4 w-4 ${tone ?? "text-muted-foreground"}`} />
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
    </Card>
  );
}

function DashboardPage() {
  const { activeCompany, terminology } = useCompany();
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
      <div className="mb-6">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Operations dashboard</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{activeCompany?.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">What's happening in your operation right now, and what needs your attention.</p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat icon={Radio} label={`Active ${terminology.plural}`} value={0} tone="text-status-in-use" />
        <Stat icon={Clock} label="Waiting dispatch" value={0} tone="text-status-warning" />
        <Stat icon={AlertTriangle} label="Delayed" value={0} tone="text-status-warning" />
        <Stat icon={Truck} label="Vehicles in use" value={0} tone="text-status-in-use" />
        <Stat icon={Users} label="Active drivers" value={0} tone="text-status-available" />
        <Stat icon={Wrench} label="In maintenance" value={0} tone="text-status-neutral" />
      </div>

      <Card className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-status-warning/15 text-status-warning ring-1 ring-status-warning/30">
            <Zap className="h-4 w-4" />
          </div>
          <h2 className="text-lg font-semibold">Attention required</h2>
        </div>
        <div className="grid place-items-center rounded-md border border-dashed border-border/60 py-14 text-center">
          <XCircle className="mb-2 h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Nothing urgent right now.</p>
          <p className="mt-1 text-xs text-muted-foreground">Delays, failed {terminology.plural}, critical incidents, overdue maintenance and expiring documents will appear here.</p>
        </div>
      </Card>
    </div>
  );
}
