import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  AlertTriangle,
  Bell,
  ClipboardList,
  Cpu,
  FileText,
  ListFilter,
  Map as MapIcon,
  NotebookPen,
  Radio,
  Route as RouteIcon,
  Truck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/operational-state";
import { StatusBadge } from "@/components/ui/status-badge-detailed";
import { useCompany } from "@/lib/company-context";
import { telemetryFrom } from "@/lib/telemetry/supabase-boundary";
import { TrackingMap } from "@/lib/maps/TrackingMap";
import type { VehicleMarker } from "@/lib/maps/types";
import {
  buildDeterministicHandover,
  filterFleetItems,
  mergeOperationsTimeline,
  transitionOperationalAlert,
  type EscalationLevel,
  type FleetFilter,
  type FleetListItem,
  type OperationalAlertStatus,
} from "@/lib/operations-control/phase10";
import type { TimelineEvent } from "@/lib/tracking-operations/phase9";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/operations-control")({
  head: () => ({ meta: [{ title: "Operations Control — ZappOS" }] }),
  component: OperationsControlPage,
});

type Vehicle = Database["public"]["Tables"]["vehicles"]["Row"];
type Driver = Database["public"]["Tables"]["drivers"]["Row"];
type Job = Database["public"]["Tables"]["jobs"]["Row"];

interface SessionRow {
  id: string;
  company_id: string;
  job_id: string;
  driver_id: string;
  vehicle_id: string | null;
  status: string;
  tracking_quality_status: string;
  last_telemetry_at: string | null;
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
  accuracy: number | null;
  server_received_at: string;
  quality_status: string;
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

interface OperationalAlertRow {
  id: string;
  company_id: string;
  alert_type: string;
  source_entity_type: string;
  source_entity_id: string;
  status: OperationalAlertStatus;
  acknowledgement_note: string | null;
  escalation_level: EscalationLevel;
  escalation_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface OperationalNoteRow {
  id: string;
  linked_entity_type: string;
  linked_entity_id: string;
  note_text: string;
  created_at: string;
}

interface JobEventRow {
  id: string;
  job_id: string;
  event_type: string;
  message: string | null;
  created_at: string;
}

interface HandoverRow {
  id: string;
  title: string;
  status: string;
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

interface SelectionState {
  vehicleId: string | null;
  driverId: string | null;
  jobId: string | null;
  sessionId: string | null;
  incidentId: string | null;
  insightId: string | null;
  alertId: string | null;
}

function age(value: string | null) {
  if (!value) return "never";
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

function secondsSince(value: string | null | undefined) {
  if (!value) return null;
  return Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
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

function isUuid(value: string | null) {
  return Boolean(
    value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  );
}

function selectedFromUrl(): Partial<SelectionState> {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const vehicleId = params.get("vehicle");
  const sessionId = params.get("session");
  const alertId = params.get("alert");
  return {
    vehicleId: isUuid(vehicleId) ? vehicleId : null,
    sessionId: isUuid(sessionId) ? sessionId : null,
    alertId: isUuid(alertId) ? alertId : null,
  };
}

function OperationsControlPage() {
  const { activeCompany, hasAnyRole } = useCompany();
  const activeCompanyId = activeCompany?.id;
  const canRead = hasAnyRole(["admin", "fleet_manager", "dispatcher", "viewer"]);
  const canAct = hasAnyRole(["admin", "fleet_manager", "dispatcher"]);
  const requestRef = useRef(0);
  const companyResetRef = useRef<{ initialized: boolean; companyId: string | undefined }>({
    initialized: false,
    companyId: activeCompanyId,
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"map" | "list">("list");
  const [filter, setFilter] = useState<FleetFilter>("all");
  const [selection, setSelection] = useState<SelectionState>(() => ({
    vehicleId: selectedFromUrl().vehicleId ?? null,
    driverId: null,
    jobId: null,
    sessionId: selectedFromUrl().sessionId ?? null,
    incidentId: null,
    insightId: null,
    alertId: selectedFromUrl().alertId ?? null,
  }));
  const [actionNote, setActionNote] = useState("");
  const [noteText, setNoteText] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [locations, setLocations] = useState<LatestLocationRow[]>([]);
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceRow[]>([]);
  const [brainInsights, setBrainInsights] = useState<BrainInsightRow[]>([]);
  const [alerts, setAlerts] = useState<OperationalAlertRow[]>([]);
  const [notes, setNotes] = useState<OperationalNoteRow[]>([]);
  const [jobEvents, setJobEvents] = useState<JobEventRow[]>([]);
  const [handovers, setHandovers] = useState<HandoverRow[]>([]);
  const [simulatedDevices, setSimulatedDevices] = useState<SimulatedDeviceRow[]>([]);

  useEffect(() => {
    if (!companyResetRef.current.initialized) {
      companyResetRef.current = { initialized: true, companyId: activeCompanyId };
      return;
    }
    if (companyResetRef.current.companyId === activeCompanyId) return;
    companyResetRef.current.companyId = activeCompanyId;
    requestRef.current += 1;
    setSelection({
      vehicleId: null,
      driverId: null,
      jobId: null,
      sessionId: null,
      incidentId: null,
      insightId: null,
      alertId: null,
    });
    setVehicles([]);
    setDrivers([]);
    setJobs([]);
    setSessions([]);
    setLocations([]);
    setIncidents([]);
    setMaintenance([]);
    setBrainInsights([]);
    setAlerts([]);
    setNotes([]);
    setJobEvents([]);
    setHandovers([]);
    setSimulatedDevices([]);
    setActionNote("");
    setNoteText("");
    setError(null);
  }, [activeCompanyId]);

  const load = useCallback(async () => {
    if (!activeCompanyId) {
      setLoading(false);
      return;
    }
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const [
        vehicleResult,
        driverResult,
        jobResult,
        sessionResult,
        locationResult,
        incidentResult,
        maintenanceResult,
        brainResult,
        alertResult,
        noteResult,
        jobEventResult,
        handoverResult,
        simulatedDevicesResult,
      ] = await Promise.all([
        supabase.from("vehicles").select("*").eq("company_id", activeCompanyId).limit(500),
        supabase.from("drivers").select("*").eq("company_id", activeCompanyId).limit(500),
        supabase.from("jobs").select("*").eq("company_id", activeCompanyId).limit(500),
        telemetryFrom<SessionRow>("tracking_sessions")
          .select("*")
          .eq("company_id", activeCompanyId)
          .in("status", ["pending", "active", "paused", "degraded"])
          .order("updated_at", { ascending: false })
          .limit(250),
        telemetryFrom<LatestLocationRow>("vehicle_latest_locations")
          .select("*")
          .eq("company_id", activeCompanyId)
          .limit(500),
        telemetryFrom<IncidentRow>("incidents")
          .select("id, vehicle_id, driver_id, job_id, severity, status, description, created_at")
          .eq("company_id", activeCompanyId)
          .order("created_at", { ascending: false })
          .limit(100),
        telemetryFrom<MaintenanceRow>("maintenance")
          .select("id, vehicle_id, title, status, scheduled_date, created_at")
          .eq("company_id", activeCompanyId)
          .order("created_at", { ascending: false })
          .limit(100),
        telemetryFrom<BrainInsightRow>("zapp_brain_insights")
          .select(
            "id, title, category, severity, confidence, status, affected_entities, created_at",
          )
          .eq("company_id", activeCompanyId)
          .order("created_at", { ascending: false })
          .limit(100),
        telemetryFrom<OperationalAlertRow>("operational_alerts")
          .select("*")
          .eq("company_id", activeCompanyId)
          .order("created_at", { ascending: false })
          .limit(200),
        telemetryFrom<OperationalNoteRow>("operational_notes")
          .select("id, linked_entity_type, linked_entity_id, note_text, created_at")
          .eq("company_id", activeCompanyId)
          .order("created_at", { ascending: false })
          .limit(100),
        telemetryFrom<JobEventRow>("job_events")
          .select("id, job_id, event_type, message, created_at")
          .eq("company_id", activeCompanyId)
          .order("created_at", { ascending: false })
          .limit(200),
        telemetryFrom<HandoverRow>("shift_handovers")
          .select("id, title, status, created_at")
          .eq("company_id", activeCompanyId)
          .order("created_at", { ascending: false })
          .limit(20),
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
      ]);

      if (requestId !== requestRef.current) return;
      for (const result of [
        vehicleResult,
        driverResult,
        jobResult,
        sessionResult,
        locationResult,
        incidentResult,
        maintenanceResult,
        brainResult,
        alertResult,
        noteResult,
        jobEventResult,
        handoverResult,
        simulatedDevicesResult,
      ]) {
        if (result.error) throw result.error;
      }

      setVehicles(vehicleResult.data ?? []);
      setDrivers(driverResult.data ?? []);
      setJobs(jobResult.data ?? []);
      setSessions((sessionResult.data ?? []) as SessionRow[]);
      setLocations(((locationResult.data ?? []) as LatestLocationRow[]).filter(isValidLocation));
      setIncidents((incidentResult.data ?? []) as IncidentRow[]);
      setMaintenance((maintenanceResult.data ?? []) as MaintenanceRow[]);
      setBrainInsights((brainResult.data ?? []) as BrainInsightRow[]);
      setAlerts((alertResult.data ?? []) as OperationalAlertRow[]);
      setNotes((noteResult.data ?? []) as OperationalNoteRow[]);
      setJobEvents((jobEventResult.data ?? []) as JobEventRow[]);
      setHandovers((handoverResult.data ?? []) as HandoverRow[]);
      setSimulatedDevices(simulatedDevicesResult.data ?? []);
    } catch (err) {
      if (requestId === requestRef.current) {
        setError(err instanceof Error ? err.message : "Could not load operations control centre");
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [activeCompanyId]);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const lookups = useMemo(
    () => ({
      vehicle: new Map(vehicles.map((item) => [item.id, item])),
      driver: new Map(drivers.map((item) => [item.id, item])),
      job: new Map(jobs.map((item) => [item.id, item])),
      sessionByVehicle: new Map(
        sessions.filter((item) => item.vehicle_id).map((item) => [item.vehicle_id as string, item]),
      ),
      locationByVehicle: new Map(locations.map((item) => [item.vehicle_id, item])),
      alertBySource: new Map(
        alerts.map((item) => [`${item.source_entity_type}:${item.source_entity_id}`, item]),
      ),
    }),
    [alerts, drivers, jobs, locations, sessions, vehicles],
  );

  const fleetItems = useMemo(() => {
    const items: Array<
      FleetListItem & { label: string; driver: string; job: string; speed: string }
    > = [];
    for (const vehicle of vehicles) {
      const session = lookups.sessionByVehicle.get(vehicle.id) ?? null;
      const location = lookups.locationByVehicle.get(vehicle.id) ?? null;
      const driver = session?.driver_id ? lookups.driver.get(session.driver_id) : null;
      const job = session?.job_id ? lookups.job.get(session.job_id) : null;
      const incident = incidents.find(
        (item) => item.vehicle_id === vehicle.id && item.status !== "resolved",
      );
      const maint = maintenance.find(
        (item) => item.vehicle_id === vehicle.id && item.status !== "completed",
      );
      const alert =
        lookups.alertBySource.get(`vehicle:${vehicle.id}`) ??
        (session ? lookups.alertBySource.get(`tracking_session:${session.id}`) : undefined);
      items.push({
        vehicleId: vehicle.id,
        label: vehicle.registration,
        driver: driver?.full_name ?? "No driver",
        job: job?.reference ?? "No active job",
        tripStatus: session?.status ?? "offline",
        telemetryAgeSeconds: secondsSince(
          location?.server_received_at ?? session?.last_telemetry_at,
        ),
        trackingQuality: location?.quality_status ?? session?.tracking_quality_status ?? "unknown",
        incidentState: incident?.severity ?? "none",
        maintenanceState: maint?.status ?? "none",
        routeDelayState: alerts.some(
          (item) =>
            item.source_entity_type === "vehicle" &&
            item.source_entity_id === vehicle.id &&
            item.alert_type === "major_route_deviation",
        )
          ? "delayed"
          : "normal",
        acknowledgementState: alert?.status ?? null,
        speed: location?.speed == null ? "-" : `${Math.round(location.speed * 3.6)} km/h`,
      });
    }
    return items;
  }, [alerts, incidents, lookups, maintenance, vehicles]);

  const filteredFleetItems = useMemo(
    () => filterFleetItems(fleetItems, filter),
    [fleetItems, filter],
  );

  const selectedVehicle = selection.vehicleId
    ? (lookups.vehicle.get(selection.vehicleId) ?? null)
    : null;
  const selectedSession = selection.sessionId
    ? (sessions.find((item) => item.id === selection.sessionId) ?? null)
    : selectedVehicle
      ? (lookups.sessionByVehicle.get(selectedVehicle.id) ?? null)
      : null;
  const selectedAlert = selection.alertId
    ? (alerts.find((item) => item.id === selection.alertId) ?? null)
    : null;

  const markers = useMemo<VehicleMarker[]>(
    () =>
      locations.map((location) => {
        const vehicle = lookups.vehicle.get(location.vehicle_id);
        const driver = location.driver_id ? lookups.driver.get(location.driver_id) : null;
        const job = location.job_id ? lookups.job.get(location.job_id) : null;
        const session = location.tracking_session_id
          ? sessions.find((item) => item.id === location.tracking_session_id)
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
    [locations, lookups, sessions],
  );

  const timeline = useMemo(() => {
    const alertEvents: TimelineEvent[] = alerts.slice(0, 50).map((item) => ({
      id: `alert:${item.id}`,
      occurredAt: item.created_at,
      source: "dispatcher",
      type: item.alert_type,
      label: `${item.alert_type.replaceAll("_", " ")} ${item.status}`,
      severity:
        item.escalation_level === "critical"
          ? "critical"
          : item.escalation_level === "urgent"
            ? "warning"
            : "info",
    }));
    const noteEvents: TimelineEvent[] = notes.slice(0, 50).map((item) => ({
      id: `note:${item.id}`,
      occurredAt: item.created_at,
      source: "dispatcher",
      type: "operational_note",
      label: "Operational note",
      severity: "info",
    }));
    const jobTimeline: TimelineEvent[] = jobEvents.slice(0, 50).map((item) => ({
      id: `job:${item.id}`,
      occurredAt: item.created_at,
      source: "job",
      type: item.event_type,
      label: item.message ?? item.event_type.replaceAll("_", " "),
      severity: "info",
    }));
    return mergeOperationsTimeline([alertEvents, noteEvents, jobTimeline]);
  }, [alerts, jobEvents, notes]);

  const handoverItems = useMemo(
    () =>
      buildDeterministicHandover({
        activeTrips: sessions.length,
        unacknowledgedAlerts: alerts.filter((item) => item.status === "open"),
        escalatedAlerts: alerts.filter((item) => item.status === "escalated"),
        staleVehicles: fleetItems
          .filter((item) => (item.telemetryAgeSeconds ?? 0) > 300)
          .map((item) => ({ id: item.vehicleId, label: item.label })),
        failedJobs: jobs
          .filter((job) => job.status === "failed")
          .map((job) => ({ id: job.id, reference: job.reference })),
        urgentBrainInsights: brainInsights
          .filter((item) => item.severity === "critical" || item.severity === "high")
          .map((item) => ({ id: item.id, title: item.title })),
        operationalNotes: notes.map((note) => ({
          id: note.id,
          text: note.note_text,
          created_at: note.created_at,
        })),
      }),
    [alerts, brainInsights, fleetItems, jobs, notes, sessions.length],
  );

  const selectVehicle = (vehicleId: string) => {
    const session = lookups.sessionByVehicle.get(vehicleId) ?? null;
    const alert =
      lookups.alertBySource.get(`vehicle:${vehicleId}`) ??
      (session ? lookups.alertBySource.get(`tracking_session:${session.id}`) : undefined);
    setSelection({
      vehicleId,
      driverId: session?.driver_id ?? null,
      jobId: session?.job_id ?? null,
      sessionId: session?.id ?? null,
      incidentId: incidents.find((item) => item.vehicle_id === vehicleId)?.id ?? null,
      insightId: null,
      alertId: alert?.id ?? null,
    });
    if (typeof window !== "undefined") {
      const params = new URLSearchParams();
      params.set("vehicle", vehicleId);
      if (session) params.set("session", session.id);
      if (alert) params.set("alert", alert.id);
      window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
    }
  };

  const transitionAlert = async (
    action: "acknowledge" | "escalate" | "resolve" | "dismiss",
    level?: EscalationLevel,
  ) => {
    if (!selectedAlert || actionBusy) return;
    try {
      setActionBusy(true);
      transitionOperationalAlert({
        currentStatus: selectedAlert.status,
        action,
        escalationLevel: level,
        note: actionNote,
      });
      const { error: rpcError } = await (
        supabase as unknown as {
          rpc: (
            name: string,
            args: Record<string, unknown>,
          ) => Promise<{ error: { message: string } | null }>;
        }
      ).rpc("transition_operational_alert", {
        _alert_id: selectedAlert.id,
        _action: action,
        _escalation_level: level ?? null,
        _note: actionNote || null,
      });
      if (rpcError) setError(rpcError.message);
      setActionNote("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update operational alert");
    } finally {
      setActionBusy(false);
    }
  };

  const createNote = async () => {
    if (!activeCompanyId || !selectedVehicle || !noteText.trim() || actionBusy) return;
    try {
      setActionBusy(true);
      const { error: rpcError } = await (
        supabase as unknown as {
          rpc: (
            name: string,
            args: Record<string, unknown>,
          ) => Promise<{ error: { message: string } | null }>;
        }
      ).rpc("create_operational_note", {
        _company_id: activeCompanyId,
        _linked_entity_type: "vehicle",
        _linked_entity_id: selectedVehicle.id,
        _note_text: noteText,
        _visibility_level: "operations",
        _correction_of_note_id: null,
      });
      if (rpcError) setError(rpcError.message);
      setNoteText("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create operational note");
    } finally {
      setActionBusy(false);
    }
  };

  if (!canRead) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
        <ErrorState
          title="Operations control is restricted"
          description="Drivers cannot access the fleet command centre."
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
        <LoadingState label="Loading operations control centre" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-4 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Phase 10
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Live operations control centre</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Dispatcher command centre for observed active fleet operations. No autonomous dispatch.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={view === "list" ? "default" : "outline"}
            onClick={() => setView("list")}
            className="gap-2"
          >
            <ListFilter className="h-4 w-4" /> List
          </Button>
          <Button
            variant={view === "map" ? "default" : "outline"}
            onClick={() => setView("map")}
            className="gap-2"
          >
            <MapIcon className="h-4 w-4" /> Map
          </Button>
        </div>
      </div>

      {error ? <ErrorState title="Operations control notice" description={error} /> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric icon={Truck} label="Active fleet" value={fleetItems.length} />
        <Metric icon={Radio} label="Active trips" value={sessions.length} />
        <Metric
          icon={AlertTriangle}
          label="Open alerts"
          value={alerts.filter((item) => item.status === "open").length}
        />
        <Metric
          icon={Bell}
          label="Escalated"
          value={alerts.filter((item) => item.status === "escalated").length}
        />
        <Metric icon={ClipboardList} label="Handover items" value={handoverItems.length} />
        <Metric
          icon={Cpu}
          label="Simulated devices"
          value={`${simulatedDevices.filter((item) => item.status === "active").length}/${simulatedDevices.length}`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-4">
          <Card className="p-3">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  "all",
                  "stale_telemetry",
                  "incidents",
                  "delayed",
                  "active",
                  "offline",
                  "poor_gps",
                  "unacknowledged",
                ] as FleetFilter[]
              ).map((item) => (
                <Button
                  key={item}
                  size="sm"
                  variant={filter === item ? "default" : "outline"}
                  onClick={() => setFilter(item)}
                >
                  {item.replaceAll("_", " ")}
                </Button>
              ))}
            </div>
          </Card>

          {view === "map" ? (
            markers.length === 0 ? (
              <Card className="p-4">
                <EmptyState
                  title="No live map markers"
                  description="Map markers appear when latest vehicle locations are available."
                  icon={Truck}
                />
              </Card>
            ) : (
              <TrackingMap markers={markers} trace={null} onSelectMarker={selectVehicle} />
            )
          ) : (
            <FleetList
              items={filteredFleetItems}
              selectedVehicleId={selection.vehicleId}
              onSelect={selectVehicle}
            />
          )}

          <TimelinePanel events={timeline} />
        </div>

        <div className="space-y-4">
          <DetailPanel
            vehicle={selectedVehicle}
            session={selectedSession}
            alert={selectedAlert}
            canAct={canAct}
            actionBusy={actionBusy}
            actionNote={actionNote}
            noteText={noteText}
            onActionNoteChange={setActionNote}
            onNoteTextChange={setNoteText}
            onTransition={transitionAlert}
            onCreateNote={createNote}
          />
          <AlertPanel
            alerts={alerts}
            selectedAlertId={selection.alertId}
            onSelect={(alertId) => setSelection((current) => ({ ...current, alertId }))}
          />
          <HandoverPanel items={handoverItems} handovers={handovers} />
          <ContextPanel incidents={incidents} maintenance={maintenance} insights={brainInsights} />
        </div>
      </div>
    </div>
  );
}

function FleetList({
  items,
  selectedVehicleId,
  onSelect,
}: {
  items: Array<FleetListItem & { label: string; driver: string; job: string; speed: string }>;
  selectedVehicleId: string | null;
  onSelect: (vehicleId: string) => void;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="No fleet items match this filter"
        description="Adjust filters or wait for telemetry and active trips."
        icon={Truck}
      />
    );
  }
  return (
    <Card className="overflow-hidden">
      <div className="max-h-[620px] divide-y divide-border overflow-auto">
        {items.map((item) => (
          <button
            key={item.vehicleId}
            type="button"
            onClick={() => onSelect(item.vehicleId)}
            className={`grid w-full gap-3 p-4 text-left text-sm md:grid-cols-[1.2fr_1fr_1fr_1fr_auto] ${selectedVehicleId === item.vehicleId ? "bg-muted" : ""}`}
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{item.label}</p>
              <p className="truncate text-xs text-muted-foreground">{item.driver}</p>
            </div>
            <Field label="Job" value={item.job} />
            <Field
              label="Telemetry age"
              value={item.telemetryAgeSeconds == null ? "never" : `${item.telemetryAgeSeconds}s`}
            />
            <Field label="Speed" value={item.speed} />
            <StatusBadge
              status={item.acknowledgementState ?? item.tripStatus ?? "unknown"}
              variant="small"
            />
          </button>
        ))}
      </div>
    </Card>
  );
}

function DetailPanel({
  vehicle,
  session,
  alert,
  canAct,
  actionBusy,
  actionNote,
  noteText,
  onActionNoteChange,
  onNoteTextChange,
  onTransition,
  onCreateNote,
}: {
  vehicle: Vehicle | null;
  session: SessionRow | null;
  alert: OperationalAlertRow | null;
  canAct: boolean;
  actionBusy: boolean;
  actionNote: string;
  noteText: string;
  onActionNoteChange: (value: string) => void;
  onNoteTextChange: (value: string) => void;
  onTransition: (
    action: "acknowledge" | "escalate" | "resolve" | "dismiss",
    level?: EscalationLevel,
  ) => void;
  onCreateNote: () => void;
}) {
  const terminal = alert?.status === "resolved" || alert?.status === "dismissed";
  const canAcknowledge = canAct && Boolean(alert) && alert?.status === "open" && !actionBusy;
  const canTransition = canAct && Boolean(alert) && !terminal && !actionBusy;
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <RouteIcon className="h-4 w-4 text-muted-foreground" />
        <p className="font-semibold">Dispatcher action panel</p>
      </div>
      {vehicle ? (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Field label="Vehicle" value={vehicle.registration} />
          <Field label="Session" value={session?.status ?? "none"} />
          <Field label="Alert" value={alert?.alert_type ?? "none"} />
          <Field label="Acknowledgement" value={alert?.status ?? "none"} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Select a vehicle or alert to inspect operational context.
        </p>
      )}
      <div className="mt-4 space-y-2">
        <textarea
          value={actionNote}
          onChange={(event) => onActionNoteChange(event.target.value)}
          className="min-h-20 w-full rounded-md border border-border bg-background p-2 text-sm"
          placeholder="Acknowledgement or escalation reason"
          disabled={!canAct || actionBusy}
        />
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={!canAcknowledge} onClick={() => onTransition("acknowledge")}>
            Acknowledge
          </Button>
          <Button
            disabled={!canTransition}
            variant="outline"
            onClick={() => onTransition("escalate", "urgent")}
          >
            Escalate urgent
          </Button>
          <Button
            disabled={!canTransition}
            variant="outline"
            onClick={() => onTransition("resolve")}
          >
            Mark resolved
          </Button>
          <Button
            disabled={!canTransition}
            variant="outline"
            onClick={() => onTransition("dismiss")}
          >
            Dismiss
          </Button>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <textarea
          value={noteText}
          onChange={(event) => onNoteTextChange(event.target.value)}
          className="min-h-20 w-full rounded-md border border-border bg-background p-2 text-sm"
          placeholder="Create operational note"
          disabled={!canAct || !vehicle || actionBusy}
        />
        <Button
          disabled={!canAct || !vehicle || !noteText.trim() || actionBusy}
          onClick={onCreateNote}
          className="w-full gap-2"
        >
          <NotebookPen className="h-4 w-4" /> Add note
        </Button>
      </div>
    </Card>
  );
}

function AlertPanel({
  alerts,
  selectedAlertId,
  onSelect,
}: {
  alerts: OperationalAlertRow[];
  selectedAlertId: string | null;
  onSelect: (alertId: string) => void;
}) {
  return (
    <Card className="p-4">
      <p className="font-semibold">Operational alerts</p>
      <div className="mt-3 max-h-72 space-y-2 overflow-auto">
        {alerts.slice(0, 20).map((alert) => (
          <button
            key={alert.id}
            type="button"
            onClick={() => onSelect(alert.id)}
            className={`w-full rounded-md border border-border p-3 text-left text-sm ${selectedAlertId === alert.id ? "bg-muted" : ""}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{alert.alert_type.replaceAll("_", " ")}</span>
              <StatusBadge status={alert.status} variant="small" />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {alert.escalation_level} · {age(alert.created_at)} ago
            </p>
          </button>
        ))}
        {alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No operational alerts.</p>
        ) : null}
      </div>
    </Card>
  );
}

function HandoverPanel({
  items,
  handovers,
}: {
  items: ReturnType<typeof buildDeterministicHandover>;
  handovers: HandoverRow[];
}) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <FileText className="h-4 w-4 text-muted-foreground" />
        <p className="font-semibold">Shift handover</p>
      </div>
      <div className="space-y-2 text-sm">
        {items.slice(0, 8).map((item) => (
          <div
            key={`${item.itemType}:${item.sourceEntityId}:${item.sortKey}`}
            className="rounded-md border border-border p-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span>{item.label}</span>
              <StatusBadge status={item.severity} variant="small" />
            </div>
          </div>
        ))}
        {items.length === 0 ? (
          <p className="text-muted-foreground">No deterministic handover items.</p>
        ) : null}
      </div>
      <div className="mt-3 text-xs text-muted-foreground">
        Latest handover: {handovers[0] ? `${handovers[0].title} · ${handovers[0].status}` : "none"}
      </div>
    </Card>
  );
}

function TimelinePanel({ events }: { events: TimelineEvent[] }) {
  return (
    <Card className="p-4">
      <p className="font-semibold">Operational timeline</p>
      <div className="mt-3 max-h-80 divide-y divide-border overflow-auto">
        {events.slice(0, 100).map((event) => (
          <div key={event.id} className="grid gap-2 py-2 text-sm sm:grid-cols-[140px_1fr_auto]">
            <span className="text-xs text-muted-foreground">
              {new Date(event.occurredAt).toLocaleString()}
            </span>
            <span>{event.label}</span>
            <StatusBadge status={event.source} variant="small" />
          </div>
        ))}
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No operational events yet.</p>
        ) : null}
      </div>
    </Card>
  );
}

function ContextPanel({
  incidents,
  maintenance,
  insights,
}: {
  incidents: IncidentRow[];
  maintenance: MaintenanceRow[];
  insights: BrainInsightRow[];
}) {
  return (
    <Card className="p-4">
      <div className="grid gap-3 text-sm">
        <Field
          label="Active incidents"
          value={String(incidents.filter((item) => item.status !== "resolved").length)}
        />
        <Field
          label="Maintenance warnings"
          value={String(maintenance.filter((item) => item.status !== "completed").length)}
        />
        <Field
          label="Brain insights"
          value={String(insights.filter((item) => item.status !== "resolved").length)}
        />
        <Field label="Weather / traffic" value="Available in selected tracking detail" />
        <Field label="Route intelligence" value="Observed deterministic records only" />
        <Field label="Replay" value="Use tracking workspace replay for selected trip" />
      </div>
    </Card>
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
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </Card>
  );
}
