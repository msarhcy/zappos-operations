import type { ConfidenceResult } from "./types";

export interface TelemetryConfidenceInput {
  acceptedPointCount: number;
  observedPointCount: number;
  rejectedPointCount: number;
  poorPointCount?: number;
  delayedUploadCount?: number;
  latestTelemetryAt?: string | null;
}

export interface ProviderConfidenceInput {
  observedAt?: string | null;
  retrievedAt: string;
  expiresAt?: string | null;
  now?: Date;
}

export function confidenceFromTelemetry(input: TelemetryConfidenceInput): ConfidenceResult {
  const reasons: string[] = [];
  if (input.acceptedPointCount < 2) {
    return { level: "insufficient_data", reasons: ["Fewer than two accepted telemetry points"] };
  }

  const observed = Math.max(input.observedPointCount, 1);
  const rejectedRatio = input.rejectedPointCount / observed;
  const poorRatio = (input.poorPointCount ?? 0) / observed;
  const delayedRatio = (input.delayedUploadCount ?? 0) / observed;
  if (rejectedRatio > 0.25) reasons.push("Rejected telemetry percentage is elevated");
  if (poorRatio > 0.25) reasons.push("Poor quality telemetry percentage is elevated");
  if (delayedRatio > 0.25) reasons.push("Delayed uploads reduce freshness");
  if (
    input.latestTelemetryAt &&
    Date.now() - Date.parse(input.latestTelemetryAt) > 10 * 60 * 1000
  ) {
    reasons.push("Latest telemetry is stale");
  }

  if (rejectedRatio <= 0.05 && poorRatio <= 0.1 && delayedRatio <= 0.1 && reasons.length === 0) {
    return { level: "high", reasons: ["Telemetry density and quality are strong"] };
  }
  if (rejectedRatio <= 0.2 && poorRatio <= 0.25) {
    return { level: "medium", reasons: reasons.length ? reasons : ["Telemetry quality is usable"] };
  }
  return { level: "low", reasons: reasons.length ? reasons : ["Telemetry quality is weak"] };
}

export function confidenceFromProviderFreshness(input: ProviderConfidenceInput): ConfidenceResult {
  const now = input.now ?? new Date();
  const retrievedAgeMs = now.getTime() - Date.parse(input.retrievedAt);
  if (!Number.isFinite(retrievedAgeMs)) {
    return { level: "insufficient_data", reasons: ["Provider timestamp is unavailable"] };
  }
  if (input.expiresAt && Date.parse(input.expiresAt) < now.getTime()) {
    return { level: "low", reasons: ["Provider observation has expired"] };
  }
  if (retrievedAgeMs <= 5 * 60 * 1000) {
    return { level: "high", reasons: ["Provider observation is fresh"] };
  }
  if (retrievedAgeMs <= 30 * 60 * 1000) {
    return { level: "medium", reasons: ["Provider observation is recent"] };
  }
  return { level: "low", reasons: ["Provider observation is stale"] };
}
