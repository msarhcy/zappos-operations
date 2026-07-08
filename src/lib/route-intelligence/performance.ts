import { estimateStopCountFromTelemetry, type StopHeuristicPoint } from "./intelligence";

export type DelayEventType =
  | "late_start"
  | "long_stationary_period"
  | "slow_progress"
  | "delayed_completion"
  | "failed_trip"
  | "poor_telemetry_quality";

export type RoutePerformanceConfidence = "high" | "medium" | "low" | "insufficient_data";

export interface RouteGroupInput {
  customerId?: string | null;
  pickupLocation?: string | null;
  dropoffLocation?: string | null;
}

export interface RouteDelayInput {
  scheduledAt?: string | null;
  startedAt?: string | null;
  arrivedAt?: string | null;
  completedAt?: string | null;
  failedAt?: string | null;
  status?: string | null;
}

export interface RouteTelemetryQualityInput {
  observedPointCount: number;
  acceptedPointCount: number;
  rejectedPointCount: number;
  poorPointCount?: number;
}

export interface RoutePerformanceInput extends RouteDelayInput, RouteTelemetryQualityInput {
  observedDistanceMeters: number;
  observedDurationSeconds: number | null;
  stationaryDurationSeconds: number;
  averageObservedSpeedMps?: number | null;
  acceptedPoints?: StopHeuristicPoint[];
}

export interface RouteDelayMetrics {
  lateStartMinutes: number | null;
  arrivalDelayMinutes: number | null;
  completionDelayMinutes: number | null;
  delayMinutes: number | null;
}

export interface RoutePerformanceEvaluation {
  delayMetrics: RouteDelayMetrics;
  estimatedStopCount: number;
  delayEvents: DelayEventType[];
  dataQualityScore: number;
  confidence: {
    level: RoutePerformanceConfidence;
    reasons: string[];
  };
}

const LATE_START_THRESHOLD_MINUTES = 5;
const DELAYED_COMPLETION_THRESHOLD_MINUTES = 30;
const LONG_STATIONARY_THRESHOLD_SECONDS = 10 * 60;
const SLOW_PROGRESS_MAX_SPEED_MPS = 2;
const SLOW_PROGRESS_MIN_DISTANCE_METERS = 500;
const SLOW_PROGRESS_MIN_DURATION_SECONDS = 15 * 60;

export function normalizeRouteLocation(value: string | null | undefined) {
  const normalized = value?.trim().replace(/\s+/g, " ").toLowerCase() ?? "";
  return normalized || "unknown";
}

export function buildRouteGroupKey(input: RouteGroupInput) {
  const pickup = normalizeRouteLocation(input.pickupLocation);
  const dropoff = normalizeRouteLocation(input.dropoffLocation);
  const customer = input.customerId?.trim().toLowerCase() || "no_customer";
  return `customer:${customer}|pickup:${pickup}|dropoff:${dropoff}`;
}

export function minutesBetween(planned?: string | null, actual?: string | null) {
  if (!planned || !actual) return null;
  const plannedMs = Date.parse(planned);
  const actualMs = Date.parse(actual);
  if (!Number.isFinite(plannedMs) || !Number.isFinite(actualMs)) return null;
  return Math.round((actualMs - plannedMs) / 60_000);
}

export function calculateDelayMetrics(input: RouteDelayInput): RouteDelayMetrics {
  const lateStartMinutes = minutesBetween(input.scheduledAt, input.startedAt);
  const arrivalDelayMinutes = minutesBetween(input.scheduledAt, input.arrivedAt);
  const completionDelayMinutes = minutesBetween(input.scheduledAt, input.completedAt);
  const available = [lateStartMinutes, arrivalDelayMinutes, completionDelayMinutes].filter(
    (value): value is number => value !== null,
  );
  return {
    lateStartMinutes,
    arrivalDelayMinutes,
    completionDelayMinutes,
    delayMinutes: available.length ? Math.max(...available) : null,
  };
}

export function scoreRoutePerformanceDataQuality(input: RouteTelemetryQualityInput) {
  if (input.observedPointCount <= 0) return 0;
  const acceptedRatio = input.acceptedPointCount / input.observedPointCount;
  const rejectedRatio = input.rejectedPointCount / input.observedPointCount;
  const poorRatio = (input.poorPointCount ?? 0) / input.observedPointCount;
  const score = acceptedRatio * 70 + (1 - rejectedRatio) * 20 + (1 - poorRatio) * 10;
  return Math.round(Math.max(0, Math.min(100, score)));
}

export function confidenceFromRoutePerformance(input: RouteTelemetryQualityInput) {
  const reasons: string[] = [];
  const qualityScore = scoreRoutePerformanceDataQuality(input);
  if (input.acceptedPointCount < 2) {
    return {
      level: "insufficient_data" as const,
      reasons: ["Fewer than two accepted telemetry points"],
    };
  }
  if (input.acceptedPointCount < 5) reasons.push("Small accepted telemetry sample");
  if (qualityScore < 50) reasons.push("Telemetry quality is weak");
  if (input.rejectedPointCount > input.observedPointCount * 0.25) {
    reasons.push("Rejected telemetry percentage is elevated");
  }

  if (input.acceptedPointCount >= 12 && qualityScore >= 80 && reasons.length === 0) {
    return { level: "high" as const, reasons: ["Historical telemetry quality is strong"] };
  }
  if (qualityScore >= 50) {
    return {
      level: "medium" as const,
      reasons: reasons.length ? reasons : ["Historical telemetry quality is usable"],
    };
  }
  return { level: "low" as const, reasons };
}

export function evaluateRoutePerformance(input: RoutePerformanceInput): RoutePerformanceEvaluation {
  const delayMetrics = calculateDelayMetrics(input);
  const estimatedStopCount = input.acceptedPoints
    ? estimateStopCountFromTelemetry(input.acceptedPoints)
    : input.stationaryDurationSeconds >= LONG_STATIONARY_THRESHOLD_SECONDS &&
        input.acceptedPointCount >= 3
      ? Math.max(1, Math.round(input.stationaryDurationSeconds / LONG_STATIONARY_THRESHOLD_SECONDS))
      : 0;
  const dataQualityScore = scoreRoutePerformanceDataQuality(input);
  const confidence = confidenceFromRoutePerformance(input);
  const delayEvents: DelayEventType[] = [];

  if (
    delayMetrics.lateStartMinutes !== null &&
    delayMetrics.lateStartMinutes > LATE_START_THRESHOLD_MINUTES
  ) {
    delayEvents.push("late_start");
  }
  if (
    input.stationaryDurationSeconds >= LONG_STATIONARY_THRESHOLD_SECONDS ||
    estimatedStopCount > 0
  ) {
    delayEvents.push("long_stationary_period");
  }
  if (
    input.observedDistanceMeters >= SLOW_PROGRESS_MIN_DISTANCE_METERS &&
    (input.observedDurationSeconds ?? 0) >= SLOW_PROGRESS_MIN_DURATION_SECONDS &&
    input.averageObservedSpeedMps !== null &&
    input.averageObservedSpeedMps !== undefined &&
    input.averageObservedSpeedMps < SLOW_PROGRESS_MAX_SPEED_MPS
  ) {
    delayEvents.push("slow_progress");
  }
  if (
    delayMetrics.completionDelayMinutes !== null &&
    delayMetrics.completionDelayMinutes > DELAYED_COMPLETION_THRESHOLD_MINUTES
  ) {
    delayEvents.push("delayed_completion");
  }
  if (input.status === "failed" || input.failedAt) {
    delayEvents.push("failed_trip");
  }
  if (dataQualityScore < 50 || confidence.level === "insufficient_data") {
    delayEvents.push("poor_telemetry_quality");
  }

  return {
    delayMetrics,
    estimatedStopCount,
    delayEvents,
    dataQualityScore,
    confidence,
  };
}
