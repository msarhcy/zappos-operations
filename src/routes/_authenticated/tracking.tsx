import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import {
  Activity,
  AlertTriangle,
  CloudSun,
  Clock,
  Cpu,
  Gauge,
  List,
  Map as MapIcon,
  Pause,
  Play,
  Radio,
  Route as RouteIcon,
  ShieldCheck,
  Truck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { getTelemetryQueueStats } from "@/lib/telemetry/queue";
import { telemetryFrom } from "@/lib/telemetry/supabase-boundary";
import { TrackingMap } from "@/lib/maps/TrackingMap";
import type { ObservedTraceLine, VehicleMarker } from "@/lib/maps/types";
import { buildObservedTrace } from "@/lib/route-intelligence/trace";
import {
  calculateRouteIntelligence,
  estimateStopCountFromTelemetry,
} from "@/lib/route-intelligence/intelligence";
import {
  buildRouteReplay,
  buildTripTimeline,
  createAuditTrailEvent,
  detectCorridorDeviation,
  detectGeofenceEvents,
  mergeIncidentTimeline,
  summarizeTelemetryQuality,
  type TimelineEvent,
} from "@/lib/tracking-operations/phase9";
import { OpenMeteoProvider } from "@/lib/providers/weather";
import { TomTomTrafficProvider } from "@/lib/providers/traffic";
import type { TrafficObservation, WeatherObservation } from "@/lib/providers/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  source: string;
  tracking_quality_status: string;
  last_telemetry_at: string | null;
  started_at: string | null;
  ended_at: string | null;
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

interface SummaryRow {
  tracking_session_id: string;
  observed_point_count: number;
  accepted_point_count: number;
  rejected_point_count: number;
  observed_distance: number;
  total_duration: string | null;
  moving_duration: string | null;
  stationary_duration: string | null;
  average_observed_speed: number | null;
  maximum_credible_speed: number | null;
  first_point_at: string | null;
  last_point_at: string | null;
  gps_coverage_score: number | null;
  telemetry_quality_score: number | null;
}

interface PointRow {
  latitude: number | null;
  longitude: number | null;
  device_timestamp: string;
  server_received_at: string | null;
  sequence_number: number;
  quality_status: string;
  quality_flags: string[] | null;
  movement_state: string;
  horizontal_accuracy: number | null;
}

interface HealthMetrics {
  pointsToday: number;
  acceptedToday: number;
  rejectedToday: number;
  poorToday: number;
  delayedUploads: number;
  latestTelemetryAt: string | null;
}

interface IncidentRow {
  id: string;
  vehicle_id: string | null;
  driver_id: string | null;
  job_id: string | null;
  severity: string;
  status: string;
  description: string;
  created_at: string;
}

interface MaintenanceRow {
  id: string;
  vehicle_id: string;
  title: string;
  status: string;
  scheduled_date: string | null;
  created_at: string;
}

interface BrainInsightRow {
  id: string;
  title: string;
  category: string;
  severity: string;
  confidence: string;
  status: string;
  affected_entities: unknown;
  created_at: string;
}

interface AuditRow {
  id: string;
  actor_user_id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  tracking_session_id: string | null;
  job_id: string | null;
  occurred_at: string;
}

interface JobEventRow {
  id: string;
  job_id: string;
  event_type: string;
  message: string | null;
  created_at: string;
}

interface SimulatedDeviceRow {
  id: string;
  status: string;
  simulated: boolean;
}

interface QueryResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

function age(value: string | null) {
  if (!value) return "never";
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function formatNumber(value: number | null | undefined, suffix = "") {
  return value == null || !Number.isFinite(value) ? "-" : `${Math.round(value)}${suffix}`;
}

function intervalSeconds(value: string | null | undefined) {
  if (!value) return 0;
  const simple = value.match(/(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)/);
  if (simple) {
    const [, hours = "0", minutes, seconds] = simple;
    return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
  }
  const hours = Number(value.match(/(\d+(?:\.\d+)?)\s+hours?/)?.[1] ?? 0);
  const minutes = Number(value.match(/(\d+(?:\.\d+)?)\s+mins?/)?.[1] ?? 0);
  const seconds = Number(value.match(/(\d+(?:\.\d+)?)\s+secs?/)?.[1] ?? 0);
  return hours * 3600 + minutes * 60 + seconds;
}

function isValidLocation(location: LatestLocationRow) {
  return (
    Number.isFinite(location.latitude) &&
    Number.isFinite(location.longitude) &&
    location.latitude >= -90 &&
    location.latitude <= 90 &&
    location.longitude >= -180 &&
    location.longitude <= 180
  );
}

function affectedEntityIncludes(
  affectedEntities: unknown,
  key: "jobs" | "tracking_sessions" | "vehicles" | "drivers",
  id: string | null | undefined,
) {
  if (!id || !affectedEntities || typeof affectedEntities !== "object") return false;
  const value = (affectedEntities as Record<string, unknown>)[key];
  return Array.isArray(value) && value.includes(id);
}

function TrackingPage() {
  const { activeCompany, hasAnyRole } = useCompany();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"map" | "list">("map");
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<TrackingSessionRow[]>([]);
  const [latestLocations, setLatestLocations] = useState<LatestLocationRow[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [summary, setSummary] = useState<SummaryRow | null>(null);
  const [tracePoints, setTracePoints] = useState<PointRow[]>([]);
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceRow[]>([]);
  const [brainInsights, setBrainInsights] = useState<BrainInsightRow[]>([]);
  const [auditLog, setAuditLog] = useState<AuditRow[]>([]);
  const [jobEvents, setJobEvents] = useState<JobEventRow[]>([]);
  const [simulatedDevices, setSimulatedDevices] = useState<SimulatedDeviceRow[]>([]);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState<1 | 2 | 5>(1);
  const [replayIndex, setReplayIndex] = useState(0);
  const [weather, setWeather] = useState<WeatherObservation | null>(null);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [traffic, setTraffic] = useState<TrafficObservation | null>(null);
  const [trafficError, setTrafficError] = useState<string | null>(null);
  const [queue, setQueue] = useState({ pending: 0, failed: 0, total: 0 });
  const [metrics, setMetrics] = useState<HealthMetrics>({
    pointsToday: 0,
    acceptedToday: 0,
    rejectedToday: 0,
    poorToday: 0,
    delayedUploads: 0,
    latestTelemetryAt: null,
  });

  const canReadHealth = hasAnyRole(["admin", "fleet_manager", "dispatcher", "viewer"]);
  const activeCompanyId = activeCompany?.id;

  const logDispatcherAction = useCallback(
    async (action: string, session: TrackingSessionRow | null) => {
      if (!activeCompanyId || !session) return;
      await (
        supabase as unknown as {
          rpc: (
            name: string,
            args: Record<string, unknown>,
          ) => PromiseLike<{ error: { message: string } | null }>;
        }
      ).rpc("log_dispatcher_audit", {
        _company_id: activeCompanyId,
        _action: action,
        _entity_type: "tracking_session",
        _entity_id: session.id,
        _tracking_session_id: session.id,
        _job_id: session.job_id,
        _metadata: { source: "tracking_workspace" },
      });
    },
    [activeCompanyId],
  );

  const load = useCallback(async () => {
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
        incidentsResult,
        maintenanceResult,
        brainResult,
        auditResult,
        jobEventsResult,
        simulatedDevicesResult,
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
        telemetryFrom<IncidentRow>("incidents")
          .select("id, vehicle_id, driver_id, job_id, severity, status, description, created_at")
          .eq("company_id", activeCompanyId)
          .order("created_at", { ascending: false })
          .limit(25),
        telemetryFrom<MaintenanceRow>("maintenance")
          .select("id, vehicle_id, title, status, scheduled_date, created_at")
          .eq("company_id", activeCompanyId)
          .order("created_at", { ascending: false })
          .limit(25),
        telemetryFrom<BrainInsightRow>("zapp_brain_insights")
          .select(
            "id, title, category, severity, confidence, status, affected_entities, created_at",
          )
          .eq("company_id", activeCompanyId)
          .order("created_at", { ascending: false })
          .limit(25),
        telemetryFrom<AuditRow>("dispatcher_audit_log")
          .select(
            "id, actor_user_id, action, entity_type, entity_id, tracking_session_id, job_id, occurred_at",
          )
          .eq("company_id", activeCompanyId)
          .order("occurred_at", { ascending: false })
          .limit(25),
        telemetryFrom<JobEventRow>("job_events")
          .select("id, job_id, event_type, message, created_at")
          .eq("company_id", activeCompanyId)
          .order("created_at", { ascending: false })
          .limit(100),
        (
          supabase as unknown as {
            from: (table: string) => {
              select: (columns: string) => {
                eq: (
                  column: string,
                  value: unknown,
                ) => {
                  eq: (
                    column: string,
                    value: unknown,
                  ) => { limit: (count: number) => Promise<QueryResult<SimulatedDeviceRow>> };
                };
              };
            };
          }
        )
          .from("devices")
          .select("id, status, simulated")
          .eq("company_id", activeCompanyId)
          .eq("simulated", true)
          .limit(50),
        getTelemetryQueueStats().catch(() => ({ pending: 0, failed: 1, total: 0 })),
      ]);

      if (sessionsResult.error) throw sessionsResult.error;
      if (latestResult.error) throw latestResult.error;
      if (vehiclesResult.error) throw vehiclesResult.error;
      if (driversResult.error) throw driversResult.error;
      if (jobsResult.error) throw jobsResult.error;
      if (pointsResult.error) throw pointsResult.error;
      if (incidentsResult.error) throw incidentsResult.error;
      if (maintenanceResult.error) throw maintenanceResult.error;
      if (brainResult.error) throw brainResult.error;
      if (auditResult.error) throw auditResult.error;
      if (jobEventsResult.error) throw jobEventsResult.error;
      if (simulatedDevicesResult.error) throw simulatedDevicesResult.error;

      const pointMetrics = (pointsResult.data ?? []) as Array<{
        quality_status: string;
        quality_flags: string[] | null;
        server_received_at: string;
      }>;
      const nextLocations = ((latestResult.data ?? []) as LatestLocationRow[]).filter(
        isValidLocation,
      );
      setSessions((sessionsResult.data ?? []) as TrackingSessionRow[]);
      setLatestLocations(nextLocations);
      setVehicles(vehiclesResult.data ?? []);
      setDrivers(driversResult.data ?? []);
      setJobs(jobsResult.data ?? []);
      setIncidents((incidentsResult.data ?? []) as IncidentRow[]);
      setMaintenance((maintenanceResult.data ?? []) as MaintenanceRow[]);
      setBrainInsights((brainResult.data ?? []) as BrainInsightRow[]);
      setAuditLog((auditResult.data ?? []) as AuditRow[]);
      setJobEvents((jobEventsResult.data ?? []) as JobEventRow[]);
      setSimulatedDevices((simulatedDevicesResult.data ?? []) as unknown as SimulatedDeviceRow[]);
      setQueue(queueStats);
      setMetrics({
        pointsToday: pointMetrics.length,
        acceptedToday: pointMetrics.filter((point) => point.quality_status !== "rejected").length,
        rejectedToday: pointMetrics.filter((point) => point.quality_status === "rejected").length,
        poorToday: pointMetrics.filter((point) => point.quality_status === "poor").length,
        delayedUploads: pointMetrics.filter((point) =>
          point.quality_flags?.includes("DELAYED_UPLOAD"),
        ).length,
        latestTelemetryAt:
          pointMetrics
            .map((point) => point.server_received_at)
            .sort()
            .at(-1) ?? null,
      });
      if (!selectedVehicleId && nextLocations[0]) setSelectedVehicleId(nextLocations[0].vehicle_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load tracking health");
    } finally {
      setLoading(false);
    }
  }, [activeCompanyId, selectedVehicleId]);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const lookups = useMemo(
    () => ({
      vehicle: new globalThis.Map(vehicles.map((vehicle) => [vehicle.id, vehicle])),
      driver: new globalThis.Map(drivers.map((driver) => [driver.id, driver])),
      job: new globalThis.Map(jobs.map((job) => [job.id, job])),
      session: new globalThis.Map(sessions.map((session) => [session.id, session])),
    }),
    [drivers, jobs, sessions, vehicles],
  );

  const selectedLocation =
    latestLocations.find((location) => location.vehicle_id === selectedVehicleId) ??
    latestLocations[0] ??
    null;
  const selectedSession = selectedLocation?.tracking_session_id
    ? (lookups.session.get(selectedLocation.tracking_session_id) ?? null)
    : null;

  useEffect(() => {
    if (!selectedSession) {
      setSummary(null);
      setTracePoints([]);
      return;
    }
    let cancelled = false;
    const sessionId = selectedSession.id;
    setSummary(null);
    setTracePoints([]);
    const run = async () => {
      const [summaryResult, traceResult] = await Promise.all([
        telemetryFrom<SummaryRow>("tracking_summaries")
          .select("*")
          .eq("tracking_session_id", sessionId)
          .maybeSingle(),
        telemetryFrom<PointRow>("tracking_telemetry_points")
          .select(
            "latitude, longitude, device_timestamp, server_received_at, sequence_number, quality_status, quality_flags, movement_state, horizontal_accuracy",
          )
          .eq("tracking_session_id", sessionId)
          .in("quality_status", ["high", "acceptable", "poor"])
          .order("device_timestamp", { ascending: true })
          .limit(1000),
      ]);
      if (cancelled) return;
      if (!summaryResult.error) setSummary((summaryResult.data as SummaryRow | null) ?? null);
      if (!traceResult.error) setTracePoints((traceResult.data ?? []) as PointRow[]);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [selectedSession]);

  useEffect(() => {
    if (!selectedLocation) {
      setWeather(null);
      setTraffic(null);
      setWeatherError(null);
      setTrafficError(null);
      return;
    }
    let cancelled = false;
    const location = selectedLocation;
    setWeather(null);
    setTraffic(null);
    setWeatherError(null);
    setTrafficError(null);
    const run = async () => {
      const weatherProvider = new OpenMeteoProvider();
      const trafficProvider = new TomTomTrafficProvider();
      const [weatherResult, trafficResult] = await Promise.all([
        weatherProvider.getWeatherNearLocation(location),
        trafficProvider.getTrafficNearLocation({ ...location, companyId: activeCompanyId }),
      ]);
      if (cancelled) return;
      setWeather(weatherResult.observation);
      setWeatherError(weatherResult.unavailableReason);
      setTraffic(trafficResult.observation);
      setTrafficError(trafficResult.unavailableReason);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [activeCompanyId, selectedLocation]);

  const activeSessions = sessions.filter((session) =>
    ["pending", "active", "paused", "degraded"].includes(session.status),
  );
  const staleSessions = activeSessions.filter(
    (session) =>
      !session.last_telemetry_at ||
      Date.now() - Date.parse(session.last_telemetry_at) > 5 * 60 * 1000,
  );

  const markers = useMemo<VehicleMarker[]>(
    () =>
      latestLocations.map((location) => {
        const vehicle = lookups.vehicle.get(location.vehicle_id);
        const driver = location.driver_id ? lookups.driver.get(location.driver_id) : null;
        const job = location.job_id ? lookups.job.get(location.job_id) : null;
        const session = location.tracking_session_id
          ? lookups.session.get(location.tracking_session_id)
          : null;
        return {
          id: location.vehicle_id,
          latitude: location.latitude,
          longitude: location.longitude,
          registration: vehicle?.registration ?? "Unknown vehicle",
          driverName: driver?.full_name ?? "No driver",
          jobReference: job?.reference ?? "No active job",
          latestLocationAge: age(location.server_received_at),
          speedKph: location.speed == null ? null : location.speed * 3.6,
          qualityStatus: location.quality_status,
          trackingState: session?.status ?? "unknown",
        };
      }),
    [latestLocations, lookups],
  );

  const observedTrace = useMemo(() => buildObservedTrace(tracePoints), [tracePoints]);
  const mapTrace = useMemo<ObservedTraceLine | null>(
    () =>
      observedTrace.hasRenderableTrace
        ? {
            id: selectedSession?.id ?? "selected-trace",
            points: observedTrace.points.map((point) => ({
              latitude: point.latitude,
              longitude: point.longitude,
            })),
          }
        : null,
    [observedTrace, selectedSession?.id],
  );

  const intelligence = useMemo(() => {
    if (!summary) return null;
    const observed = summary.observed_point_count;
    return calculateRouteIntelligence({
      observedDistanceMeters: summary.observed_distance,
      totalDurationSeconds: intervalSeconds(summary.total_duration),
      movingDurationSeconds: intervalSeconds(summary.moving_duration),
      stationaryDurationSeconds: intervalSeconds(summary.stationary_duration),
      averageObservedSpeedMps: summary.average_observed_speed,
      maximumCredibleSpeedMps: summary.maximum_credible_speed,
      observedPointCount: observed,
      acceptedPointCount: summary.accepted_point_count,
      rejectedPointCount: summary.rejected_point_count,
      poorPointCount: tracePoints.filter((point) => point.quality_status === "poor").length,
      delayedUploadCount: tracePoints.filter((point) =>
        point.quality_flags?.includes("DELAYED_UPLOAD"),
      ).length,
      latestTelemetryAt: selectedSession?.last_telemetry_at,
      stationarySegmentCount: estimateStopCountFromTelemetry(tracePoints),
    });
  }, [selectedSession?.last_telemetry_at, summary, tracePoints]);

  const operationsHealth = useMemo(
    () =>
      summarizeTelemetryQuality({
        points: tracePoints,
        now: new Date(),
        activeSessionCount: activeSessions.length,
      }),
    [activeSessions.length, tracePoints],
  );

  const replayFrames = useMemo(() => buildRouteReplay(tracePoints), [tracePoints]);
  const replayFrame = replayFrames[replayIndex] ?? replayFrames[0] ?? null;

  useEffect(() => {
    setReplayIndex(0);
    setReplayPlaying(false);
  }, [selectedSession?.id]);

  useEffect(() => {
    if (!replayPlaying || replayFrames.length <= 1) return;
    const interval = window.setInterval(() => {
      setReplayIndex((current) => {
        if (current >= replayFrames.length - 1) {
          setReplayPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 1000 / replaySpeed);
    return () => window.clearInterval(interval);
  }, [replayFrames.length, replayPlaying, replaySpeed]);

  const tripTimeline = useMemo(() => {
    if (!selectedSession) return [];
    return buildTripTimeline({
      sessionId: selectedSession.id,
      startedAt: selectedSession.started_at,
      acceptedAt: selectedSession.job_id
        ? lookups.job.get(selectedSession.job_id)?.accepted_at
        : null,
      arrivedAt: selectedSession.job_id
        ? lookups.job.get(selectedSession.job_id)?.arrived_at
        : null,
      completedAt: selectedSession.job_id
        ? lookups.job.get(selectedSession.job_id)?.completed_at
        : selectedSession.ended_at,
      points: tracePoints,
    });
  }, [lookups.job, selectedSession, tracePoints]);

  const routeEvents = useMemo(() => {
    if (replayFrames.length < 2) return [];
    const first = replayFrames[0];
    const last = replayFrames.at(-1);
    if (!first || !last) return [];
    const geofenceEvents = detectGeofenceEvents({
      points: tracePoints,
      geofences: [
        {
          id: "observed-start",
          label: "Observed start",
          type: "depot",
          latitude: first.latitude,
          longitude: first.longitude,
          radiusMeters: 120,
        },
        {
          id: "observed-end",
          label: "Observed end",
          type: "customer",
          latitude: last.latitude,
          longitude: last.longitude,
          radiusMeters: 120,
        },
      ],
    });
    const deviationEvents = detectCorridorDeviation(tracePoints, {
      points: [
        { latitude: first.latitude, longitude: first.longitude },
        { latitude: last.latitude, longitude: last.longitude },
      ],
      minorMeters: 250,
      majorMeters: 750,
    });
    return [...geofenceEvents, ...deviationEvents];
  }, [replayFrames, tracePoints]);

  const selectedIncidentEvents = useMemo<TimelineEvent[]>(
    () =>
      incidents
        .filter(
          (incident) =>
            incident.job_id === selectedSession?.job_id ||
            incident.vehicle_id === selectedSession?.vehicle_id ||
            incident.driver_id === selectedSession?.driver_id,
        )
        .map((incident) => ({
          id: `incident:${incident.id}`,
          occurredAt: incident.created_at,
          source: "incident",
          type: "incident_reported",
          label: "Incident reported",
          severity: incident.severity === "critical" ? "critical" : "warning",
          metadata: { status: incident.status, description: incident.description },
        })),
    [incidents, selectedSession],
  );

  const selectedMaintenanceEvents = useMemo<TimelineEvent[]>(
    () =>
      maintenance
        .filter((item) => item.vehicle_id === selectedSession?.vehicle_id)
        .map((item) => ({
          id: `maintenance:${item.id}`,
          occurredAt: item.scheduled_date ?? item.created_at,
          source: "maintenance",
          type: "maintenance_warning",
          label: "Maintenance warning",
          severity: item.status === "overdue" ? "critical" : "warning",
          metadata: { title: item.title, status: item.status },
        })),
    [maintenance, selectedSession?.vehicle_id],
  );

  const dispatcherEvents = useMemo<TimelineEvent[]>(
    () =>
      auditLog
        .filter(
          (item) =>
            item.tracking_session_id === selectedSession?.id ||
            item.job_id === selectedSession?.job_id,
        )
        .map((item) =>
          createAuditTrailEvent({
            id: `audit:${item.id}`,
            actorId: item.actor_user_id,
            companyId: activeCompanyId ?? "",
            action: item.action,
            occurredAt: item.occurred_at,
            entityType: item.entity_type,
            entityId: item.entity_id ?? item.job_id ?? item.tracking_session_id ?? "",
          }),
        ),
    [activeCompanyId, auditLog, selectedSession],
  );

  const selectedJobEvents = useMemo<TimelineEvent[]>(
    () =>
      jobEvents
        .filter((item) => item.job_id === selectedSession?.job_id)
        .map((item) => ({
          id: `job:${item.id}`,
          occurredAt: item.created_at,
          source: "job",
          type: item.event_type,
          label: item.message ?? item.event_type.replaceAll("_", " "),
          severity: "info",
        })),
    [jobEvents, selectedSession?.job_id],
  );

  const selectedBrainEvents = useMemo<TimelineEvent[]>(
    () =>
      brainInsights
        .filter(
          (item) =>
            affectedEntityIncludes(item.affected_entities, "jobs", selectedSession?.job_id) ||
            affectedEntityIncludes(
              item.affected_entities,
              "tracking_sessions",
              selectedSession?.id,
            ) ||
            affectedEntityIncludes(
              item.affected_entities,
              "vehicles",
              selectedSession?.vehicle_id,
            ) ||
            affectedEntityIncludes(item.affected_entities, "drivers", selectedSession?.driver_id),
        )
        .map((item) => ({
          id: `brain:${item.id}`,
          occurredAt: item.created_at,
          source: "brain",
          type: "brain_insight",
          label: item.title,
          severity:
            item.severity === "critical" || item.severity === "high"
              ? "critical"
              : item.severity === "medium"
                ? "warning"
                : "info",
          metadata: { category: item.category, confidence: item.confidence, status: item.status },
        })),
    [brainInsights, selectedSession],
  );

  const unifiedTimeline = useMemo(
    () =>
      mergeIncidentTimeline([
        tripTimeline,
        selectedJobEvents,
        routeEvents,
        selectedIncidentEvents,
        selectedMaintenanceEvents,
        dispatcherEvents,
        selectedBrainEvents,
      ]),
    [
      dispatcherEvents,
      routeEvents,
      selectedBrainEvents,
      selectedJobEvents,
      selectedIncidentEvents,
      selectedMaintenanceEvents,
      tripTimeline,
    ],
  );

  const onlineVehicleIds = new Set(latestLocations.map((location) => location.vehicle_id));
  const activeDriverIds = new Set(activeSessions.map((session) => session.driver_id));
  const gpsQuality =
    metrics.pointsToday > 0
      ? Math.round((metrics.acceptedToday / Math.max(1, metrics.pointsToday)) * 100)
      : 0;

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
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 lg:px-8">
      <div>
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          First-party telemetry
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Tracking workspace</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Live MapLibre view, observed GPS traces, and deterministic route intelligence. No
          predictions.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric icon={Radio} label="Active trips" value={activeSessions.length} />
        <Metric icon={Activity} label="Active drivers" value={activeDriverIds.size} />
        <Metric icon={Truck} label="Vehicles online" value={onlineVehicleIds.size} />
        <Metric
          icon={Truck}
          label="Vehicles offline"
          value={Math.max(0, vehicles.length - onlineVehicleIds.size)}
        />
        <Metric icon={Gauge} label="GPS quality" value={`${gpsQuality}%`} />
        <Metric icon={Clock} label="Last telemetry age" value={age(metrics.latestTelemetryAt)} />
        <Metric icon={List} label="Upload queue" value={`${queue.pending}/${queue.total}`} />
        <Metric icon={ShieldCheck} label="Telemetry health" value={operationsHealth.status} />
        <Metric
          icon={Cpu}
          label="Simulated devices"
          value={`${simulatedDevices.filter((item) => item.status === "active").length}/${simulatedDevices.length}`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
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

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={viewMode === "map" ? "default" : "outline"}
          onClick={() => setViewMode("map")}
          className="gap-2"
        >
          <MapIcon className="h-4 w-4" /> Map view
        </Button>
        <Button
          variant={viewMode === "list" ? "default" : "outline"}
          onClick={() => setViewMode("list")}
          className="gap-2"
        >
          <List className="h-4 w-4" /> List view
        </Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          {viewMode === "map" ? (
            markers.length === 0 ? (
              <Card className="p-4">
                <EmptyState
                  title="No valid latest locations"
                  description="The map appears after real vehicle_latest_locations rows with valid coordinates are available."
                  icon={Truck}
                />
              </Card>
            ) : (
              <TrackingMap
                markers={markers}
                trace={mapTrace}
                onSelectMarker={setSelectedVehicleId}
              />
            )
          ) : (
            <VehicleList
              markers={markers}
              selectedVehicleId={selectedVehicleId}
              onSelect={setSelectedVehicleId}
            />
          )}
          <Card className="p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Observed trace</p>
            <p className="mt-1">
              Based on ZappOS GPS observations. Not road-matched. Not a planned route.
            </p>
          </Card>
          <RouteReplayPanel
            frames={replayFrames.length}
            currentIndex={replayIndex}
            currentFrame={replayFrame}
            playing={replayPlaying}
            speed={replaySpeed}
            onPlayingChange={(playing) => {
              setReplayPlaying(playing);
              if (playing) void logDispatcherAction("dispatcher_replayed_trip", selectedSession);
            }}
            onSpeedChange={setReplaySpeed}
          />
          <UnifiedTimelinePanel events={unifiedTimeline} />
        </div>

        <div className="space-y-4">
          <TelemetryQualityPanel summary={operationsHealth} />
          <SessionDetail
            location={selectedLocation}
            session={selectedSession}
            summary={summary}
            vehicle={
              selectedLocation ? (lookups.vehicle.get(selectedLocation.vehicle_id) ?? null) : null
            }
            driver={
              selectedLocation?.driver_id
                ? (lookups.driver.get(selectedLocation.driver_id) ?? null)
                : null
            }
            job={
              selectedLocation?.job_id ? (lookups.job.get(selectedLocation.job_id) ?? null) : null
            }
            intelligence={intelligence}
          />
          <IncidentPanel incidents={incidents} />
          <BrainInsightPanel insights={brainInsights} />
          <ExternalContext
            weather={weather}
            weatherError={weatherError}
            traffic={traffic}
            trafficError={trafficError}
          />
        </div>
      </div>
    </div>
  );
}

function VehicleList({
  markers,
  selectedVehicleId,
  onSelect,
}: {
  markers: VehicleMarker[];
  selectedVehicleId: string | null;
  onSelect: (id: string) => void;
}) {
  if (markers.length === 0)
    return (
      <EmptyState
        title="No vehicle locations"
        description="No real latest locations are available yet."
        icon={Truck}
      />
    );
  return (
    <Card className="overflow-hidden">
      <div className="divide-y divide-border">
        {markers.map((marker) => (
          <button
            key={marker.id}
            type="button"
            onClick={() => onSelect(marker.id)}
            className={`grid w-full gap-3 p-4 text-left text-sm md:grid-cols-[1.2fr_1fr_1fr_auto] ${selectedVehicleId === marker.id ? "bg-muted" : ""}`}
          >
            <div>
              <p className="font-medium">{marker.registration}</p>
              <p className="text-xs text-muted-foreground">
                {marker.driverName} · {marker.jobReference}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Location age</p>
              <p>{marker.latestLocationAge}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Speed</p>
              <p>{marker.speedKph == null ? "-" : `${Math.round(marker.speedKph)} km/h`}</p>
            </div>
            <StatusBadge status={marker.trackingState} variant="small" />
          </button>
        ))}
      </div>
    </Card>
  );
}

function RouteReplayPanel({
  frames,
  currentIndex,
  currentFrame,
  playing,
  speed,
  onPlayingChange,
  onSpeedChange,
}: {
  frames: number;
  currentIndex: number;
  currentFrame: { timestamp: string; latitude: number; longitude: number } | null;
  playing: boolean;
  speed: 1 | 2 | 5;
  onPlayingChange: (playing: boolean) => void;
  onSpeedChange: (speed: 1 | 2 | 5) => void;
}) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">Route replay</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Accepted GPS observations only. {frames} frames available.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={playing ? "outline" : "default"}
            size="sm"
            onClick={() => onPlayingChange(!playing)}
            className="gap-2"
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {playing ? "Pause" : "Play"}
          </Button>
          {[1, 2, 5].map((value) => (
            <Button
              key={value}
              variant={speed === value ? "default" : "outline"}
              size="sm"
              onClick={() => onSpeedChange(value as 1 | 2 | 5)}
            >
              {value}x
            </Button>
          ))}
        </div>
      </div>
      <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
        <Field label="Replay state" value={playing ? "playing" : "paused"} />
        <Field label="Frame" value={frames > 0 ? `${currentIndex + 1} / ${frames}` : "-"} />
        <Field
          label="Observed"
          value={
            currentFrame
              ? `${currentFrame.latitude.toFixed(5)}, ${currentFrame.longitude.toFixed(5)}`
              : "-"
          }
        />
      </div>
    </Card>
  );
}

function UnifiedTimelinePanel({ events }: { events: TimelineEvent[] }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="font-medium">Unified incident timeline</p>
        <span className="text-xs text-muted-foreground">{events.length} events</span>
      </div>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No timeline events for the selected trip.</p>
      ) : (
        <div className="max-h-[420px] divide-y divide-border overflow-auto">
          {events.map((event) => (
            <div key={event.id} className="grid gap-2 py-3 text-sm sm:grid-cols-[150px_1fr_auto]">
              <span className="text-xs text-muted-foreground">
                {new Date(event.occurredAt).toLocaleString()}
              </span>
              <span className="font-medium">{event.label}</span>
              <StatusBadge status={event.source} variant="small" />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function TelemetryQualityPanel({
  summary,
}: {
  summary: ReturnType<typeof summarizeTelemetryQuality>;
}) {
  const checks = [
    ["Poor GPS", summary.poorGps],
    ["Weak signal", summary.weakSignal],
    ["Offline", summary.offline ? 1 : 0],
    ["Delayed upload", summary.delayedUpload],
    ["High rejection rate", summary.highRejectionRate ? 1 : 0],
    ["Duplicate telemetry", summary.duplicateTelemetry],
    ["Out-of-order telemetry", summary.outOfOrderTelemetry],
  ] as const;

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Telemetry quality monitor
          </p>
          <h2 className="mt-1 font-semibold">Signal health</h2>
        </div>
        <StatusBadge status={summary.status} variant="small" />
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        {checks.map(([label, value]) => (
          <Field key={label} label={label} value={String(value)} />
        ))}
      </div>
    </Card>
  );
}

function IncidentPanel({ incidents }: { incidents: IncidentRow[] }) {
  return (
    <Card className="p-4">
      <p className="font-semibold">Incident panel</p>
      <div className="mt-3 space-y-3">
        {incidents.slice(0, 4).map((incident) => (
          <div key={incident.id} className="rounded-md border border-border p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{incident.description}</span>
              <StatusBadge status={incident.severity} variant="small" />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{age(incident.created_at)}</p>
          </div>
        ))}
        {incidents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent incidents.</p>
        ) : null}
      </div>
    </Card>
  );
}

function BrainInsightPanel({ insights }: { insights: BrainInsightRow[] }) {
  return (
    <Card className="p-4">
      <p className="font-semibold">Brain insight panel</p>
      <div className="mt-3 space-y-3">
        {insights.slice(0, 4).map((insight) => (
          <div key={insight.id} className="rounded-md border border-border p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{insight.title}</span>
              <StatusBadge status={insight.severity} variant="small" />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {insight.category} · {insight.confidence}
            </p>
          </div>
        ))}
        {insights.length === 0 ? (
          <p className="text-sm text-muted-foreground">No deterministic insights.</p>
        ) : null}
      </div>
    </Card>
  );
}

function SessionDetail({
  location,
  session,
  summary,
  vehicle,
  driver,
  job,
  intelligence,
}: {
  location: LatestLocationRow | null;
  session: TrackingSessionRow | null;
  summary: SummaryRow | null;
  vehicle: Vehicle | null;
  driver: Driver | null;
  job: Job | null;
  intelligence: ReturnType<typeof calculateRouteIntelligence> | null;
}) {
  if (!location || !session) {
    return (
      <Card className="p-4">
        <EmptyState
          title="No selected tracking session"
          description="Select a vehicle with an active latest location to inspect its session."
          icon={RouteIcon}
        />
      </Card>
    );
  }
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Selected session
          </p>
          <h2 className="mt-1 font-semibold">{vehicle?.registration ?? "Unknown vehicle"}</h2>
        </div>
        <StatusBadge status={session.status} variant="small" />
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <Field label="Job" value={job?.reference ?? "-"} />
        <Field label="Driver" value={driver?.full_name ?? "-"} />
        <Field label="Source" value={session.source} />
        <Field label="Latest telemetry" value={age(session.last_telemetry_at)} />
        <Field
          label="Started"
          value={session.started_at ? new Date(session.started_at).toLocaleString() : "-"}
        />
        <Field
          label="Ended"
          value={session.ended_at ? new Date(session.ended_at).toLocaleString() : "-"}
        />
        <Field label="Observed points" value={String(summary?.observed_point_count ?? 0)} />
        <Field
          label="Accepted / rejected"
          value={`${summary?.accepted_point_count ?? 0} / ${summary?.rejected_point_count ?? 0}`}
        />
        <Field
          label="Observed distance"
          value={`${formatNumber((summary?.observed_distance ?? 0) / 1000)} km`}
        />
        <Field
          label="Average speed"
          value={
            summary?.average_observed_speed == null
              ? "-"
              : `${Math.round(summary.average_observed_speed * 3.6)} km/h`
          }
        />
        <Field
          label="Max credible speed"
          value={
            summary?.maximum_credible_speed == null
              ? "-"
              : `${Math.round(summary.maximum_credible_speed * 3.6)} km/h`
          }
        />
        <Field
          label="GPS coverage"
          value={
            summary?.gps_coverage_score == null ? "-" : `${Math.round(summary.gps_coverage_score)}%`
          }
        />
        <Field
          label="Quality score"
          value={
            summary?.telemetry_quality_score == null
              ? "-"
              : `${Math.round(summary.telemetry_quality_score)}%`
          }
        />
        <Field
          label="Confidence"
          value={intelligence?.dataConfidence.level ?? "insufficient_data"}
        />
      </div>
      {intelligence ? (
        <div className="mt-4 rounded-md border border-border p-3 text-sm">
          <p className="font-medium">Route intelligence overlay</p>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <span>Observed: {formatNumber(intelligence.observedDistanceMeters / 1000)} km</span>
            <span>
              Average route:{" "}
              {intelligence.averageObservedSpeedMps == null
                ? "-"
                : `${Math.round(intelligence.averageObservedSpeedMps * 3.6)} km/h`}
            </span>
            <span>Historical delay: deterministic record only</span>
            <span>Confidence: {intelligence.dataConfidence.level}</span>
            <span>Stop count: {intelligence.estimatedStopCount}</span>
            <span>Quality: {intelligence.routeQualityScore}/100</span>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function ExternalContext({
  weather,
  weatherError,
  traffic,
  trafficError,
}: {
  weather: WeatherObservation | null;
  weatherError: string | null;
  traffic: TrafficObservation | null;
  trafficError: string | null;
}) {
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <CloudSun className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold">External weather observation</h2>
        </div>
        {weather ? (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Provider" value={weather.metadata.providerName} />
            <Field label="Freshness" value={age(weather.metadata.freshness.retrievedAt)} />
            <Field
              label="Temperature"
              value={weather.temperatureC == null ? "-" : `${Math.round(weather.temperatureC)}°C`}
            />
            <Field
              label="Precipitation"
              value={weather.precipitationMm == null ? "-" : `${weather.precipitationMm} mm`}
            />
            <Field label="Condition" value={weather.condition ?? "-"} />
            <Field
              label="Wind"
              value={
                weather.windSpeedKph == null ? "-" : `${Math.round(weather.windSpeedKph)} km/h`
              }
            />
            <Field
              label="Visibility"
              value={weather.visibilityMeters == null ? "-" : `${weather.visibilityMeters} m`}
            />
            <Field label="Confidence" value={weather.metadata.confidence.level} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{weatherError ?? "Weather unavailable"}</p>
        )}
      </Card>

      <Card className="p-4">
        <p className="font-semibold">External traffic observation</p>
        {traffic ? (
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <Field label="Provider" value={traffic.metadata.providerName} />
            <Field label="Freshness" value={age(traffic.metadata.freshness.retrievedAt)} />
            <Field
              label="Current flow"
              value={
                traffic.currentFlowSpeedKph == null
                  ? "-"
                  : `${Math.round(traffic.currentFlowSpeedKph)} km/h`
              }
            />
            <Field
              label="Free flow"
              value={
                traffic.freeFlowSpeedKph == null
                  ? "-"
                  : `${Math.round(traffic.freeFlowSpeedKph)} km/h`
              }
            />
            <Field label="Congestion" value={traffic.congestionState} />
            <Field label="Confidence" value={traffic.metadata.confidence.level} />
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            {trafficError ?? "Traffic unavailable"}
          </p>
        )}
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate">{value}</p>
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
