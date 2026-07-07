import { confidenceFromTelemetry, type TelemetryConfidenceInput } from "@/lib/providers/confidence";

export interface RouteIntelligenceInput extends TelemetryConfidenceInput {
  observedDistanceMeters: number;
  totalDurationSeconds: number;
  movingDurationSeconds: number;
  stationaryDurationSeconds: number;
  averageObservedSpeedMps: number | null;
  maximumCredibleSpeedMps: number | null;
  delayedUploadCount: number;
  stationarySegmentCount?: number;
}

export interface RouteIntelligenceBaseline {
  observedDistanceMeters: number;
  totalDurationSeconds: number;
  movingDurationSeconds: number;
  stationaryDurationSeconds: number;
  stationaryRatio: number;
  averageObservedSpeedMps: number | null;
  maximumCredibleSpeedMps: number | null;
  estimatedStopCount: number;
  poorTelemetryPercentage: number;
  rejectedTelemetryPercentage: number;
  delayedUploadPercentage: number;
  routeQualityScore: number;
  dataConfidence: ReturnType<typeof confidenceFromTelemetry>;
}

function percentage(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return Math.max(0, Math.min(100, (numerator / denominator) * 100));
}

export function calculateRouteQualityScore(input: RouteIntelligenceInput) {
  if (input.observedPointCount <= 0) return 0;
  const acceptedRatio = input.acceptedPointCount / input.observedPointCount;
  const rejectedRatio = input.rejectedPointCount / input.observedPointCount;
  const poorRatio = (input.poorPointCount ?? 0) / input.observedPointCount;
  const delayedRatio = input.delayedUploadCount / input.observedPointCount;
  const densityScore =
    input.totalDurationSeconds > 0
      ? Math.min(1, input.acceptedPointCount / Math.max(1, input.totalDurationSeconds / 60))
      : input.acceptedPointCount >= 2
        ? 0.7
        : 0;

  const score =
    acceptedRatio * 45 +
    (1 - rejectedRatio) * 20 +
    (1 - poorRatio) * 15 +
    (1 - delayedRatio) * 10 +
    densityScore * 10;
  return Math.round(Math.max(0, Math.min(100, score)));
}

export function calculateRouteIntelligence(
  input: RouteIntelligenceInput,
): RouteIntelligenceBaseline {
  const stationaryRatio =
    input.totalDurationSeconds > 0
      ? Math.max(0, Math.min(1, input.stationaryDurationSeconds / input.totalDurationSeconds))
      : 0;
  const estimatedStopCount =
    input.stationaryDurationSeconds >= 120 && input.acceptedPointCount >= 3
      ? Math.max(
          1,
          input.stationarySegmentCount ?? Math.round(input.stationaryDurationSeconds / 300),
        )
      : 0;

  return {
    observedDistanceMeters: input.observedDistanceMeters,
    totalDurationSeconds: input.totalDurationSeconds,
    movingDurationSeconds: input.movingDurationSeconds,
    stationaryDurationSeconds: input.stationaryDurationSeconds,
    stationaryRatio,
    averageObservedSpeedMps: input.averageObservedSpeedMps,
    maximumCredibleSpeedMps: input.maximumCredibleSpeedMps,
    estimatedStopCount,
    poorTelemetryPercentage: percentage(input.poorPointCount ?? 0, input.observedPointCount),
    rejectedTelemetryPercentage: percentage(input.rejectedPointCount, input.observedPointCount),
    delayedUploadPercentage: percentage(input.delayedUploadCount, input.observedPointCount),
    routeQualityScore: calculateRouteQualityScore(input),
    dataConfidence: confidenceFromTelemetry(input),
  };
}
