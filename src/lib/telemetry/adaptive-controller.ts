import { haversineMeters } from "./distance";
import type { CapturedPosition, MovementState } from "./types";

export interface AdaptiveCadenceInput {
  current?: CapturedPosition | null;
  previous?: CapturedPosition | null;
  online: boolean;
}

export interface AdaptiveCadenceDecision {
  intervalMs: number;
  movementState: MovementState;
  reason: string;
}

// Initial assumptions:
// - Browser geolocation is noisy and battery-sensitive.
// - High speed means a moving vehicle; low/no speed with little coordinate delta is stationary.
// - Poor accuracy should not cause aggressive polling because it usually reflects device/environment limits.
export function decideNextCapture(input: AdaptiveCadenceInput): AdaptiveCadenceDecision {
  const accuracy = input.current?.horizontal_accuracy ?? null;
  const speed = input.current?.device_speed ?? null;

  if (accuracy !== null && accuracy > 100) {
    return { intervalMs: 60_000, movementState: "unknown", reason: "poor_accuracy" };
  }

  if (speed !== null) {
    if (speed >= 12) return { intervalMs: 12_000, movementState: "moving", reason: "high_speed" };
    if (speed >= 2) return { intervalMs: 20_000, movementState: "moving", reason: "normal_speed" };
    if (speed >= 0.5) return { intervalMs: 35_000, movementState: "moving", reason: "slow_speed" };
  }

  if (input.current && input.previous) {
    const currentTime = Date.parse(input.current.device_timestamp);
    const previousTime = Date.parse(input.previous.device_timestamp);
    const seconds = (currentTime - previousTime) / 1000;
    if (
      input.current.latitude !== null &&
      input.current.longitude !== null &&
      input.previous.latitude !== null &&
      input.previous.longitude !== null &&
      seconds > 0
    ) {
      const meters = haversineMeters(
        input.previous.latitude,
        input.previous.longitude,
        input.current.latitude,
        input.current.longitude,
      );
      const calculatedSpeed = meters / seconds;
      if (calculatedSpeed >= 12) {
        return { intervalMs: 12_000, movementState: "moving", reason: "calculated_high_speed" };
      }
      if (calculatedSpeed >= 2) {
        return { intervalMs: 22_000, movementState: "moving", reason: "calculated_normal_speed" };
      }
      if (calculatedSpeed >= 0.5) {
        return { intervalMs: 40_000, movementState: "moving", reason: "calculated_slow_speed" };
      }
    }
  }

  return {
    intervalMs: input.online ? 90_000 : 120_000,
    movementState: "stationary",
    reason: input.online ? "stationary" : "offline_stationary",
  };
}
