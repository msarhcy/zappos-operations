import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import { Activity, AlertTriangle, Clock, MapPin, Radio, Truck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { getTelemetryQueueStats } from "@/lib/telemetry/queue";
import { telemetryFrom } from "@/lib/telemetry/supabase-boundary";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/operational-state";
import { StatusBadge } from "@/components/ui/status-badge-detailed";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/tracking")({
  head: () => ({ meta: [{ title: "Tracking — ZappOS" }] }),
  component: TrackingPage,
});

type Vehicle = Database["public"]["Tables"]["vehicles"]["Row"];
type Driver = Database["public"]["Tables"]["drivers"]["Row"];
type Job = Database["public"]["Tables"]["jobs"]["Row"];

interface TrackingSessionRow {
  id: string;
  company_id: string;
  job_id: string;
  driver_id: string;
  vehicle_id: string | null;
  status: string;
  tracking_quality_status: string;
  last_telemetry_at: string | null;
  started_at: string | null;
}

interface LatestLocationRow {
  company_id: string;
  vehicle_id: string;
  driver_id: string | null;
  job_id: string | null;
  tracking_session_id: string | null;
  latitude: number;
  longitude: number;
  speed: number | null;
  heading: number | null;
  accuracy: number | null;
  device_timestamp: string;
  server_received_at: string;
  quality_status: string;
}

interface HealthMetrics {
  pointsToday: number;
  acceptedToday: number;
  rejectedToday: number;
  poorToday: number;
  delayedUploads: number;
  latestTelemetryAt: string | null;
}

function age(value: string | null) {
  if (!value) return "never";
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function TrackingPage() {
  const { activeCompany, hasAnyRole } = useCompany();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<TrackingSessionRow[]>([]);
  const [latestLocations, setLatestLocations] = useState<LatestLocationRow[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [metrics, setMetrics] = useState<HealthMetrics>({
    pointsToday: 0,
    acceptedToday: 0,
    rejectedToday: 0,
    poorToday: 0,
    delayedUploads: 0,
    latestTelemetryAt: null,
  });
  const [queue, setQueue] = useState({ pending: 0, failed: 0, total: 0 });

  const canReadHealth = hasAnyRole(["admin", "fleet_manager", "dispatcher", "viewer"]);
  const activeCompanyId = activeCompany?.id;

  useEffect(() => {
    const load = async () => {
      if (!activeCompanyId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const [
          sessionsResult,
          latestResult,
          vehiclesResult,
          driversResult,
          jobsResult,
          pointsResult,
          queueStats,
        ] = await Promise.all([
          telemetryFrom<TrackingSessionRow>("tracking_sessions")
            .select("*")
            .eq("company_id", activeCompanyId)
            .order("updated_at", { ascending: false })
            .limit(50),
          telemetryFrom<LatestLocationRow>("vehicle_latest_locations")
            .select("*")
            .eq("company_id", activeCompanyId),
          supabase.from("vehicles").select("*").eq("company_id", activeCompanyId),
          supabase.from("drivers").select("*").eq("company_id", activeCompanyId),
          supabase.from("jobs").select("*").eq("company_id", activeCompanyId),
          telemetryFrom<{
            quality_status: string;
            quality_flags: string[] | null;
            server_received_at: string;
          }>("tracking_telemetry_points")
            .select("quality_status, quality_flags, server_received_at")
            .eq("company_id", activeCompanyId)
            .gte("server_received_at", today.toISOString()),
          getTelemetryQueueStats(),
        ]);

        if (sessionsResult.error) throw sessionsResult.error;
        if (latestResult.error) throw latestResult.error;
        if (vehiclesResult.error) throw vehiclesResult.error;
        if (driversResult.error) throw driversResult.error;
        if (jobsResult.error) throw jobsResult.error;
        if (pointsResult.error) throw pointsResult.error;

        const points = (pointsResult.data ?? []) as Array<{
          quality_status: string;
          quality_flags: string[] | null;
          server_received_at: string;
        }>;
        setSessions((sessionsResult.data ?? []) as TrackingSessionRow[]);
        setLatestLocations((latestResult.data ?? []) as LatestLocationRow[]);
        setVehicles(vehiclesResult.data ?? []);
        setDrivers(driversResult.data ?? []);
        setJobs(jobsResult.data ?? []);
        setQueue(queueStats);
        setMetrics({
          pointsToday: points.length,
          acceptedToday: points.filter((point) => point.quality_status !== "rejected").length,
          rejectedToday: points.filter((point) => point.quality_status === "rejected").length,
          poorToday: points.filter((point) => point.quality_status === "poor").length,
          delayedUploads: points.filter((point) => point.quality_flags?.includes("DELAYED_UPLOAD"))
            .length,
          latestTelemetryAt:
            points
              .map((point) => point.server_received_at)
              .sort()
              .at(-1) ?? null,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load tracking health");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [activeCompanyId]);

  const activeSessions = sessions.filter((session) =>
    ["pending", "active", "paused", "degraded"].includes(session.status),
  );
  const staleSessions = activeSessions.filter((session) => {
    if (!session.last_telemetry_at) return true;
    return Date.now() - Date.parse(session.last_telemetry_at) > 5 * 60 * 1000;
  });
  const poorPercentage =
    metrics.pointsToday > 0 ? Math.round((metrics.poorToday / metrics.pointsToday) * 100) : 0;

  const lookups = useMemo(
    () => ({
      vehicle: new Map(vehicles.map((vehicle) => [vehicle.id, vehicle])),
      driver: new Map(drivers.map((driver) => [driver.id, driver])),
      job: new Map(jobs.map((job) => [job.id, job])),
    }),
    [drivers, jobs, vehicles],
  );

  if (!canReadHealth) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
        <ErrorState
          title="Tracking is restricted"
          description="Your current role cannot view operational telemetry health."
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
        <LoadingState label="Loading telemetry health" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
        <ErrorState title="Could not load telemetry health" description={error} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
      <div className="mb-6">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          First-party telemetry
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Tracking health</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Internal GPS telemetry status without maps, traffic, weather, or predictions.
        </p>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric icon={Radio} label="Active sessions" value={activeSessions.length} />
        <Metric icon={Activity} label="Points today" value={metrics.pointsToday} />
        <Metric icon={AlertTriangle} label="Poor quality" value={`${poorPercentage}%`} />
        <Metric icon={Clock} label="Latest telemetry" value={age(metrics.latestTelemetryAt)} />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Accepted / rejected today
          </p>
          <p className="mt-2 text-2xl font-semibold">
            {metrics.acceptedToday} / {metrics.rejectedToday}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Sessions with no recent telemetry
          </p>
          <p className="mt-2 text-2xl font-semibold">{staleSessions.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Local queue on this device
          </p>
          <p className="mt-2 text-2xl font-semibold">
            {queue.pending} pending {queue.failed ? ` / ${queue.failed} failed` : ""}
          </p>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-border p-4">
          <h2 className="font-semibold">Active vehicle locations</h2>
        </div>
        {latestLocations.length === 0 ? (
          <EmptyState
            title="No latest vehicle locations yet"
            description="Locations appear after real driver phone telemetry is ingested."
            icon={MapPin}
          />
        ) : (
          <div className="divide-y divide-border">
            {latestLocations.map((location) => {
              const vehicle = lookups.vehicle.get(location.vehicle_id);
              const driver = location.driver_id ? lookups.driver.get(location.driver_id) : null;
              const job = location.job_id ? lookups.job.get(location.job_id) : null;
              const stale = Date.now() - Date.parse(location.server_received_at) > 5 * 60 * 1000;
              return (
                <div
                  key={`${location.company_id}-${location.vehicle_id}`}
                  className="grid gap-3 p-4 text-sm md:grid-cols-[1.2fr_1fr_1fr_1fr_auto]"
                >
                  <div>
                    <p className="font-medium">{vehicle?.registration ?? "Unknown vehicle"}</p>
                    <p className="text-xs text-muted-foreground">
                      {driver?.full_name ?? "No driver"} · {job?.reference ?? "No active job"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Location age</p>
                    <p>{age(location.server_received_at)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Speed</p>
                    <p>
                      {location.speed == null ? "-" : `${Math.round(location.speed * 3.6)} km/h`}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Accuracy</p>
                    <p>{location.accuracy == null ? "-" : `${Math.round(location.accuracy)} m`}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge
                      status={stale ? "stale" : location.quality_status}
                      variant="small"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold">{value}</div>
    </Card>
  );
}
