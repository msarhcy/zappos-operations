import { haversineMeters } from "./distance";
import type { CapturedPosition, QualityStatus } from "./types";

export const QUALITY_FLAGS = {
  INVALID_COORDINATE: "INVALID_COORDINATE",
  POOR_ACCURACY: "POOR_ACCURACY",
  SUSPICIOUS_SPEED: "SUSPICIOUS_SPEED",
  LOCATION_JUMP: "LOCATION_JUMP",
  OUT_OF_ORDER: "OUT_OF_ORDER",
  DELAYED_UPLOAD: "DELAYED_UPLOAD",
} as const;

export interface QualityInput {
  current: CapturedPosition;
  previous?: CapturedPosition | null;
  serverNow?: Date;
}

export interface QualityResult {
  status: QualityStatus;
  flags: string[];
}

function isFiniteNumber(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

export function validateTelemetryQuality(input: QualityInput): QualityResult {
  const flags: string[] = [];
  const { current, previous } = input;
  let status: QualityStatus = "high";

  if (
    !isFiniteNumber(current.latitude) ||
    !isFiniteNumber(current.longitude) ||
    current.latitude < -90 ||
    current.latitude > 90 ||
    current.longitude < -180 ||
    current.longitude > 180
  ) {
    flags.push(QUALITY_FLAGS.INVALID_COORDINATE);
    status = "rejected";
  }

  if (
    current.horizontal_accuracy !== null &&
    (!Number.isFinite(current.horizontal_accuracy) ||
      current.horizontal_accuracy < 0 ||
      current.horizontal_accuracy > 100)
  ) {
    flags.push(QUALITY_FLAGS.POOR_ACCURACY);
    if (status !== "rejected") status = "poor";
  } else if (
    current.horizontal_accuracy !== null &&
    current.horizontal_accuracy > 50 &&
    status === "high"
  ) {
    status = "acceptable";
  }

  if (
    current.device_speed !== null &&
    (!Number.isFinite(current.device_speed) ||
      current.device_speed < 0 ||
      current.device_speed > 60)
  ) {
    flags.push(QUALITY_FLAGS.SUSPICIOUS_SPEED);
    if (status !== "rejected") status = "poor";
  }

  if (previous) {
    const currentMs = Date.parse(current.device_timestamp);
    const previousMs = Date.parse(previous.device_timestamp);
    if (currentMs < previousMs) {
      flags.push(QUALITY_FLAGS.OUT_OF_ORDER);
      if (status === "high") status = "acceptable";
    }

    if (
      status !== "rejected" &&
      isFiniteNumber(current.latitude) &&
      isFiniteNumber(current.longitude) &&
      isFiniteNumber(previous.latitude) &&
      isFiniteNumber(previous.longitude) &&
      currentMs > previousMs
    ) {
      const speed =
        haversineMeters(
          previous.latitude,
          previous.longitude,
          current.latitude,
          current.longitude,
        ) /
        ((currentMs - previousMs) / 1000);
      if (speed > 60) {
        flags.push(QUALITY_FLAGS.LOCATION_JUMP);
        status = "poor";
      }
    }
  }

  const now = input.serverNow ?? new Date();
  if (now.getTime() - Date.parse(current.device_timestamp) > 6 * 60 * 60 * 1000) {
    flags.push(QUALITY_FLAGS.DELAYED_UPLOAD);
    if (status === "high") status = "acceptable";
  }

  return { status, flags };
}

export function shouldApplyLatestLocation(
  existingDeviceTimestamp: string | null | undefined,
  incomingDeviceTimestamp: string,
  incomingStatus: QualityStatus,
) {
  if (incomingStatus === "rejected") return false;
  if (!existingDeviceTimestamp) return true;
  return Date.parse(incomingDeviceTimestamp) > Date.parse(existingDeviceTimestamp);
}
