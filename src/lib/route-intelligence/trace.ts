import type { QualityStatus } from "@/lib/telemetry/types";

export interface TracePoint {
  latitude: number | null;
  longitude: number | null;
  device_timestamp: string;
  sequence_number: number;
  quality_status: QualityStatus | string;
}

export interface ObservedTrace {
  points: Array<{
    latitude: number;
    longitude: number;
    device_timestamp: string;
    sequence_number: number;
  }>;
  hasRenderableTrace: boolean;
}

export function isRenderableTracePoint(point: TracePoint) {
  return (
    point.quality_status !== "rejected" &&
    point.latitude !== null &&
    point.longitude !== null &&
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    point.longitude >= -180 &&
    point.longitude <= 180
  );
}

export function buildObservedTrace(points: TracePoint[]): ObservedTrace {
  const ordered = points
    .filter(isRenderableTracePoint)
    .map((point) => ({
      latitude: point.latitude as number,
      longitude: point.longitude as number,
      device_timestamp: point.device_timestamp,
      sequence_number: point.sequence_number,
    }))
    .sort((a, b) => {
      const timeDiff = Date.parse(a.device_timestamp) - Date.parse(b.device_timestamp);
      return timeDiff !== 0 ? timeDiff : a.sequence_number - b.sequence_number;
    });
  return { points: ordered, hasRenderableTrace: ordered.length >= 2 };
}
