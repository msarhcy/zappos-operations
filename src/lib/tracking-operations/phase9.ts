import { haversineMeters } from "@/lib/telemetry/distance";

export type TimelineSource =
  | "trip"
  | "job"
  | "gps"
  | "geofence"
  | "deviation"
  | "incident"
  | "maintenance"
  | "dispatcher"
  | "brain";

export type DeviationStatus = "within_corridor" | "minor_deviation" | "major_deviation";
export type TelemetryHealthStatus = "healthy" | "degraded" | "critical";

export interface OperationsPoint {
  latitude: number | null;
  longitude: number | null;
  device_timestamp: string;
  sequence_number: number;
  quality_status: string;
  quality_flags?: string[] | null;
  movement_state?: string | null;
  horizontal_accuracy?: number | null;
  server_received_at?: string | null;
}

export interface TimelineEvent {
  id: string;
  occurredAt: string;
  source: TimelineSource;
  type: string;
  label: string;
  severity: "info" | "warning" | "critical";
  metadata?: Record<string, unknown>;
}

export interface GeofenceDefinition {
  id: string;
  label: string;
  type: "depot" | "customer";
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export interface CorridorDefinition {
  points: Array<{ latitude: number; longitude: number }>;
  /** Observation distance above this value emits a deterministic minor deviation. */
  minorMeters: number;
  /** Observation distance above this value emits a deterministic major deviation. */
  majorMeters: number;
}

export interface TelemetryQualitySummary {
  status: TelemetryHealthStatus;
  poorGps: number;
  weakSignal: number;
  offline: boolean;
  delayedUpload: number;
  highRejectionRate: boolean;
  duplicateTelemetry: number;
  outOfOrderTelemetry: number;
  latestTelemetryAgeSeconds: number | null;
}

export interface ReplayFrame {
  index: number;
  timestamp: string;
  latitude: number;
  longitude: number;
  sequenceNumber: number;
}

export interface AuditActionInput {
  id: string;
  actorId: string;
  companyId: string;
  action: string;
  occurredAt: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}

function timestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function orderedEvents(events: TimelineEvent[]) {
  return events.slice().sort((a, b) => {
    const timeDiff = Date.parse(a.occurredAt) - Date.parse(b.occurredAt);
    if (timeDiff !== 0) return timeDiff;
    return a.id.localeCompare(b.id);
  });
}

function crediblePoint(point: OperationsPoint) {
  return point.quality_status === "high" || point.quality_status === "acceptable";
}

function validPoint(point: OperationsPoint): point is OperationsPoint & {
  latitude: number;
  longitude: number;
} {
  return (
    crediblePoint(point) &&
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    point.latitude !== null &&
    point.longitude !== null &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    point.longitude >= -180 &&
    point.longitude <= 180
  );
}

export function buildRouteReplay(points: OperationsPoint[]): ReplayFrame[] {
  return points
    .filter(validPoint)
    .sort((a, b) => {
      const timeDiff = Date.parse(a.device_timestamp) - Date.parse(b.device_timestamp);
      return timeDiff !== 0 ? timeDiff : a.sequence_number - b.sequence_number;
    })
    .map((point, index) => ({
      index,
      timestamp: point.device_timestamp,
      latitude: point.latitude,
      longitude: point.longitude,
      sequenceNumber: point.sequence_number,
    }));
}

export function buildTripTimeline(input: {
  sessionId: string;
  startedAt?: string | null;
  acceptedAt?: string | null;
  loadingStartedAt?: string | null;
  loadingCompletedAt?: string | null;
  arrivedAt?: string | null;
  completedAt?: string | null;
  points: OperationsPoint[];
}) {
  const events: TimelineEvent[] = [];
  const add = (type: string, label: string, occurredAt?: string | null) => {
    if (!occurredAt || !timestamp(occurredAt)) return;
    events.push({
      id: `${input.sessionId}:${type}:${occurredAt}`,
      occurredAt,
      source: type === "gps_online" || type === "moving" || type === "stopped" ? "gps" : "trip",
      type,
      label,
      severity: "info",
    });
  };

  add("trip_started", "Trip Started", input.startedAt);
  add("driver_accepted_job", "Driver accepted job", input.acceptedAt);
  add("loading_started", "Loading started", input.loadingStartedAt);
  add("loading_completed", "Loading completed", input.loadingCompletedAt);
  add("customer_arrived", "Customer arrived", input.arrivedAt);
  add("completed", "Completed", input.completedAt);

  const orderedPoints = buildRouteReplay(input.points);
  if (orderedPoints[0]) add("gps_online", "GPS online", orderedPoints[0].timestamp);

  let lastMovement: string | null = null;
  for (const point of input.points
    .filter(validPoint)
    .slice()
    .sort((a, b) => {
      const timeDiff = Date.parse(a.device_timestamp) - Date.parse(b.device_timestamp);
      return timeDiff !== 0 ? timeDiff : a.sequence_number - b.sequence_number;
    })) {
    const movement = point.movement_state;
    if ((movement === "moving" || movement === "stationary") && movement !== lastMovement) {
      events.push({
        id: `${input.sessionId}:movement:${movement}:${point.sequence_number}`,
        occurredAt: point.device_timestamp,
        source: "gps",
        type: movement,
        label: movement === "moving" ? "Moving" : "Stopped",
        severity: "info",
      });
      lastMovement = movement;
    }
  }

  return orderedEvents(events);
}

export function detectGeofenceEvents(input: {
  points: OperationsPoint[];
  geofences: GeofenceDefinition[];
  longStopSeconds?: number;
}) {
  const threshold = input.longStopSeconds ?? 600;
  const events: TimelineEvent[] = [];
  const inside = new Map<string, boolean>();
  let stopStart: OperationsPoint | null = null;
  let longStopEmitted = false;

  for (const point of buildRouteReplay(input.points)) {
    for (const fence of input.geofences) {
      const distance = haversineMeters(
        point.latitude,
        point.longitude,
        fence.latitude,
        fence.longitude,
      );
      const currentlyInside = distance <= fence.radiusMeters;
      const wasInside = inside.get(fence.id) ?? false;
      if (currentlyInside !== wasInside) {
        const entering = currentlyInside;
        const type =
          fence.type === "depot"
            ? entering
              ? "entered_depot"
              : "exited_depot"
            : entering
              ? "customer_arrival"
              : "customer_departure";
        events.push({
          id: `geofence:${fence.id}:${type}:${point.sequenceNumber}`,
          occurredAt: point.timestamp,
          source: "geofence",
          type,
          label:
            fence.type === "depot"
              ? entering
                ? "Entered depot"
                : "Exited depot"
              : entering
                ? "Customer arrival"
                : "Customer departure",
          severity: "info",
          metadata: { geofence_id: fence.id, geofence_label: fence.label },
        });
      }
      inside.set(fence.id, currentlyInside);
    }

    const rawPoint = input.points.find(
      (candidate) => candidate.sequence_number === point.sequenceNumber,
    );
    if (rawPoint?.movement_state === "stationary") {
      stopStart ??= rawPoint;
      const elapsed =
        (Date.parse(rawPoint.device_timestamp) - Date.parse(stopStart.device_timestamp)) / 1000;
      if (!longStopEmitted && elapsed >= threshold) {
        events.push({
          id: `geofence:long_stop:${rawPoint.sequence_number}`,
          occurredAt: rawPoint.device_timestamp,
          source: "geofence",
          type: "long_stop",
          label: "Long stop",
          severity: "warning",
        });
        longStopEmitted = true;
      }
    } else {
      stopStart = null;
      longStopEmitted = false;
    }
  }

  return orderedEvents(events);
}

function distanceToSegmentMeters(
  point: { latitude: number; longitude: number },
  start: { latitude: number; longitude: number },
  end: { latitude: number; longitude: number },
) {
  const meanLat = ((start.latitude + end.latitude + point.latitude) / 3) * (Math.PI / 180);
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = Math.cos(meanLat) * 111_320;
  const px = point.longitude * metersPerDegreeLon;
  const py = point.latitude * metersPerDegreeLat;
  const ax = start.longitude * metersPerDegreeLon;
  const ay = start.latitude * metersPerDegreeLat;
  const bx = end.longitude * metersPerDegreeLon;
  const by = end.latitude * metersPerDegreeLat;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function detectCorridorDeviation(points: OperationsPoint[], corridor: CorridorDefinition) {
  if (corridor.points.length < 2) return [];
  const events: TimelineEvent[] = [];
  let previous: DeviationStatus | null = null;

  for (const point of buildRouteReplay(points)) {
    let nearest = Number.POSITIVE_INFINITY;
    for (let index = 0; index < corridor.points.length - 1; index += 1) {
      nearest = Math.min(
        nearest,
        distanceToSegmentMeters(point, corridor.points[index], corridor.points[index + 1]),
      );
    }
    const status: DeviationStatus =
      nearest > corridor.majorMeters
        ? "major_deviation"
        : nearest > corridor.minorMeters
          ? "minor_deviation"
          : "within_corridor";
    if (status !== previous) {
      events.push({
        id: `corridor:${status}:${point.sequenceNumber}`,
        occurredAt: point.timestamp,
        source: "deviation",
        type: previous && status === "within_corridor" ? "returned_to_route" : status,
        label:
          previous && status === "within_corridor"
            ? "Returned to route"
            : status === "within_corridor"
              ? "Within corridor"
              : status === "minor_deviation"
                ? "Minor deviation"
                : "Major deviation",
        severity:
          status === "major_deviation"
            ? "critical"
            : status === "minor_deviation"
              ? "warning"
              : "info",
        metadata: { distance_meters: Math.round(nearest) },
      });
    }
    previous = status;
  }

  return events;
}

export function summarizeTelemetryQuality(input: {
  points: OperationsPoint[];
  now: Date;
  activeSessionCount: number;
  duplicateTelemetryCount?: number;
  offlineAfterSeconds?: number;
}) {
  const offlineAfterSeconds = input.offlineAfterSeconds ?? 300;
  const sorted = input.points
    .slice()
    .sort((a, b) => Date.parse(a.device_timestamp) - Date.parse(b.device_timestamp));
  const latest = sorted.at(-1);
  const latestTelemetryAgeSeconds = latest
    ? Math.max(0, Math.floor((input.now.getTime() - Date.parse(latest.device_timestamp)) / 1000))
    : null;
  const rejected = input.points.filter((point) => point.quality_status === "rejected").length;
  const poorGps = input.points.filter((point) => point.quality_status === "poor").length;
  const delayedUpload = input.points.filter((point) =>
    point.quality_flags?.includes("DELAYED_UPLOAD"),
  ).length;
  const outOfOrderTelemetry = input.points.filter((point) =>
    point.quality_flags?.includes("OUT_OF_ORDER"),
  ).length;
  const weakSignal = input.points.filter((point) =>
    point.quality_flags?.includes("WEAK_SIGNAL"),
  ).length;
  const highRejectionRate = input.points.length >= 5 && rejected / input.points.length >= 0.25;
  const offline =
    input.activeSessionCount > 0 &&
    (latestTelemetryAgeSeconds === null || latestTelemetryAgeSeconds > offlineAfterSeconds);
  const duplicateTelemetry = input.duplicateTelemetryCount ?? 0;
  const status: TelemetryHealthStatus =
    offline || highRejectionRate
      ? "critical"
      : poorGps || weakSignal || delayedUpload || duplicateTelemetry || outOfOrderTelemetry
        ? "degraded"
        : "healthy";

  return {
    status,
    poorGps,
    weakSignal,
    offline,
    delayedUpload,
    highRejectionRate,
    duplicateTelemetry,
    outOfOrderTelemetry,
    latestTelemetryAgeSeconds,
  } satisfies TelemetryQualitySummary;
}

export function mergeIncidentTimeline(sources: TimelineEvent[][]) {
  const deduped = new Map<string, TimelineEvent>();
  for (const event of sources.flat()) deduped.set(event.id, event);
  return orderedEvents([...deduped.values()]);
}

export function createAuditTrailEvent(input: AuditActionInput): TimelineEvent {
  return {
    id: input.id,
    occurredAt: input.occurredAt,
    source: "dispatcher",
    type: input.action,
    label: input.action
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" "),
    severity: "info",
    metadata: {
      actor_id: input.actorId,
      company_id: input.companyId,
      entity_type: input.entityType,
      entity_id: input.entityId,
      ...input.metadata,
    },
  };
}
