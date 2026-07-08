import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useCompany } from "@/lib/company-context";
import { useJobs } from "@/hooks/use-jobs";
import { useVehicles } from "@/hooks/use-vehicles";
import { useDrivers } from "@/hooks/use-drivers";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/operational-state";
import {
  AlertTriangle,
  Clock,
  Radio,
  ShieldAlert,
  Truck,
  Users,
  Wrench,
  XCircle,
  Zap,
  BrainCircuit,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — ZappOS" }] }),
  component: DashboardPage,
});

interface Stat {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  tone?: string;
}

interface UrgentBrainInsight {
  id: string;
  title: string;
  severity: string;
  status: string;
  confidence: string;
}

type BrainDashboardQuery = {
  from: (table: string) => {
    select: (columns?: string) => {
      eq: (
        column: string,
        value: unknown,
      ) => {
        order: (
          column: string,
          options?: { ascending?: boolean; nullsFirst?: boolean },
        ) => {
          limit: (count: number) => PromiseLike<{ data: unknown[] | null; error: Error | null }>;
        };
      };
    };
  };
};

function brainDashboardDb() {
  return supabase as unknown as BrainDashboardQuery;
}

function StatCard({ icon: Icon, label, value, tone }: Stat) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <Icon className={`h-4 w-4 ${tone ?? "text-muted-foreground"}`} />
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
    </Card>
  );
}

function DashboardPage() {
  const { activeCompany, terminology, hasAnyRole } = useCompany();
  const [expiringDocs, setExpiringDocs] = useState(0);
  const [expiredDocs, setExpiredDocs] = useState(0);
  const [failedJobs, setFailedJobs] = useState(0);
  const [openIncidents, setOpenIncidents] = useState(0);
  const [criticalIncidents, setCriticalIncidents] = useState(0);
  const [overdueMaintenance, setOverdueMaintenance] = useState(0);
  const [activeMaintenance, setActiveMaintenance] = useState(0);
  const [urgentBrainInsights, setUrgentBrainInsights] = useState<UrgentBrainInsight[]>([]);
  const canReadBrain = hasAnyRole(["admin", "fleet_manager", "dispatcher", "viewer"]);

  const { jobs, loading: jobsLoading, error: jobsError, fetch: fetchJobs } = useJobs();
  const {
    vehicles,
    loading: vehiclesLoading,
    error: vehiclesError,
    fetch: fetchVehicles,
  } = useVehicles();
  const {
    drivers,
    loading: driversLoading,
    error: driversError,
    fetch: fetchDrivers,
  } = useDrivers();

  // Calculate metrics
  const activeJobsCount = jobs.filter((j) =>
    ["assigned", "accepted", "in_progress", "arrived"].includes(j.status),
  ).length;

  const waitingDispatchCount = jobs.filter((j) => j.status === "unassigned").length;
  const activeStatuses = ["assigned", "accepted", "in_progress", "arrived"];
  const delayedCount = jobs.filter(
    (j) =>
      j.scheduled_at &&
      new Date(j.scheduled_at) < new Date() &&
      ["unassigned", ...activeStatuses].includes(j.status),
  ).length;
  const vehiclesInUseCount = vehicles.filter((v) => v.status === "in_use").length;
  const availableVehiclesCount = vehicles.filter((v) => v.status === "available").length;
  const vehiclesInMaintenanceCount = vehicles.filter((v) => v.status === "maintenance").length;
  const vehicleIssuesCount = vehicles.filter((v) =>
    ["maintenance", "out_of_service"].includes(v.status),
  ).length;
  const activeDriversCount = drivers.filter((d) => d.status === "available").length;
  const assignedProblemDriversCount = jobs.filter((job) => {
    if (!job.driver_id || !activeStatuses.includes(job.status)) return false;
    const driver = drivers.find((candidate) => candidate.id === job.driver_id);
    return driver?.status === "suspended" || driver?.status === "off_duty";
  }).length;

  // Load additional data
  useEffect(() => {
    const load = async () => {
      if (!activeCompany) return;

      // Fetch expiring documents
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + (activeCompany.document_expiry_warning_days || 30));

      const today = new Date().toISOString().split("T")[0];

      const { data: docs } = await supabase
        .from("documents")
        .select("id, expiry_date")
        .eq("company_id", activeCompany.id)
        .not("expiry_date", "is", null);

      setExpiredDocs(docs?.filter((doc) => doc.expiry_date && doc.expiry_date < today).length || 0);
      setExpiringDocs(
        docs?.filter(
          (doc) =>
            doc.expiry_date &&
            doc.expiry_date >= today &&
            doc.expiry_date <= expiryDate.toISOString().split("T")[0],
        ).length || 0,
      );

      // Fetch failed jobs
      const { data: failed } = await supabase
        .from("jobs")
        .select("id")
        .eq("company_id", activeCompany.id)
        .eq("status", "failed");

      setFailedJobs(failed?.length || 0);

      const { data: incidents } = await supabase
        .from("incidents")
        .select("id, severity, status")
        .eq("company_id", activeCompany.id);

      setOpenIncidents(incidents?.filter((incident) => incident.status === "open").length || 0);
      setCriticalIncidents(
        incidents?.filter(
          (incident) => incident.status !== "resolved" && incident.severity === "critical",
        ).length || 0,
      );

      const { data: maintenance } = await supabase
        .from("maintenance")
        .select("id, scheduled_date, status")
        .eq("company_id", activeCompany.id);

      setActiveMaintenance(maintenance?.filter((item) => item.status !== "completed").length || 0);
      setOverdueMaintenance(
        maintenance?.filter(
          (item) =>
            item.status !== "completed" && item.scheduled_date && item.scheduled_date < today,
        ).length || 0,
      );

      if (canReadBrain) {
        const { data: brainInsights } = await brainDashboardDb()
          .from("zapp_brain_insights")
          .select("id,title,severity,status,confidence,created_at")
          .eq("company_id", activeCompany.id)
          .order("created_at", { ascending: false })
          .limit(20);

        setUrgentBrainInsights(
          ((brainInsights ?? []) as UrgentBrainInsight[])
            .filter(
              (insight) =>
                ["critical", "high"].includes(insight.severity) &&
                ["new", "reviewing", "needs_follow_up"].includes(insight.status),
            )
            .slice(0, 3),
        );
      } else {
        setUrgentBrainInsights([]);
      }
    };

    load();
  }, [activeCompany, canReadBrain]);

  const attentionItems: string[] = [];
  if (expiredDocs > 0) attentionItems.push(`${expiredDocs} documents expired`);
  if (expiringDocs > 0) attentionItems.push(`${expiringDocs} documents expiring soon`);
  if (waitingDispatchCount > 0)
    attentionItems.push(`${waitingDispatchCount} ${terminology.plural} waiting for dispatch`);
  if (failedJobs > 0) attentionItems.push(`${failedJobs} failed ${terminology.plural}`);
  if (criticalIncidents > 0) attentionItems.push(`${criticalIncidents} critical incidents open`);
  if (openIncidents > 0) attentionItems.push(`${openIncidents} open incidents`);
  if (overdueMaintenance > 0)
    attentionItems.push(`${overdueMaintenance} overdue maintenance tasks`);
  if (activeMaintenance > 0) attentionItems.push(`${activeMaintenance} active maintenance tasks`);
  if (vehicleIssuesCount > 0) attentionItems.push(`${vehicleIssuesCount} vehicles need attention`);
  if (assignedProblemDriversCount > 0)
    attentionItems.push(
      `${assignedProblemDriversCount} active ${terminology.plural} have suspended or off-duty drivers`,
    );
  urgentBrainInsights.forEach((insight) => {
    attentionItems.push(`Zapp Brain ${insight.severity}: ${insight.title}`);
  });

  if (jobsLoading || vehiclesLoading || driversLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
        <LoadingState label="Loading dashboard" />
      </div>
    );
  }

  const loadError = jobsError || vehiclesError || driversError;
  if (loadError) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
        <ErrorState
          title="Could not load dashboard"
          description={loadError}
          onAction={() => {
            void fetchJobs();
            void fetchVehicles();
            void fetchDrivers();
          }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
      <div className="mb-6">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Operations dashboard
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{activeCompany?.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What's happening in your operation right now, and what needs your attention.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-10">
        <StatCard
          icon={Radio}
          label={`Active ${terminology.plural}`}
          value={activeJobsCount}
          tone="text-status-in-use"
        />
        <StatCard
          icon={Clock}
          label="Waiting dispatch"
          value={waitingDispatchCount}
          tone="text-status-warning"
        />
        <StatCard
          icon={AlertTriangle}
          label="Delayed"
          value={delayedCount}
          tone="text-status-warning"
        />
        <StatCard
          icon={Truck}
          label="Vehicles in use"
          value={vehiclesInUseCount}
          tone="text-status-in-use"
        />
        <StatCard
          icon={Truck}
          label="Available vehicles"
          value={availableVehiclesCount}
          tone="text-status-available"
        />
        <StatCard
          icon={Users}
          label="Active drivers"
          value={activeDriversCount}
          tone="text-status-available"
        />
        <StatCard
          icon={Wrench}
          label="In maintenance"
          value={vehiclesInMaintenanceCount}
          tone="text-status-neutral"
        />
        <StatCard
          icon={AlertTriangle}
          label="Open incidents"
          value={openIncidents}
          tone="text-status-error"
        />
        <StatCard
          icon={Wrench}
          label="Overdue maint."
          value={overdueMaintenance}
          tone="text-status-error"
        />
        <StatCard
          icon={ShieldAlert}
          label={`Failed ${terminology.plural}`}
          value={failedJobs}
          tone="text-status-error"
        />
      </div>

      <Card className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-status-warning/15 text-status-warning ring-1 ring-status-warning/30">
            <Zap className="h-4 w-4" />
          </div>
          <h2 className="text-lg font-semibold">Attention required</h2>
        </div>
        {attentionItems.length === 0 ? (
          <div className="grid place-items-center rounded-md border border-dashed border-border/60 py-14 text-center">
            <XCircle className="mb-2 h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Nothing urgent right now.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Delays, failed {terminology.plural}, critical incidents, overdue maintenance and
              expiring documents will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {attentionItems.map((item, i) => (
              <div
                key={i}
                className="flex items-start gap-3 rounded-md border border-status-warning/30 bg-status-warning/5 p-3"
              >
                {item.startsWith("Zapp Brain") ? (
                  <BrainCircuit className="mt-0.5 h-4 w-4 flex-shrink-0 text-status-warning" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-status-warning" />
                )}
                <p className="text-sm text-foreground">{item}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
