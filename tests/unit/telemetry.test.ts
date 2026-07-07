import { describe, expect, it } from "vitest";
import { decideNextCapture } from "@/lib/telemetry/adaptive-controller";
import { haversineMeters } from "@/lib/telemetry/distance";
import { JSONTelemetryEncoderV1 } from "@/lib/telemetry/json-encoder-v1";
import { compareQueuedTelemetryPoints, isTelemetryPointRetryEligible } from "@/lib/telemetry/queue";
import { createTelemetryBatch } from "@/lib/telemetry/sync";
import {
  QUALITY_FLAGS,
  shouldApplyLatestLocation,
  validateTelemetryQuality,
} from "@/lib/telemetry/quality";
import type { CapturedPosition, QueuedTelemetryPoint, TelemetryPoint } from "@/lib/telemetry/types";

const basePosition: CapturedPosition = {
  latitude: 40.7128,
  longitude: -74.006,
  altitude: null,
  horizontal_accuracy: 12,
  vertical_accuracy: null,
  device_speed: null,
  heading: null,
  device_timestamp: "2026-07-07T10:00:00.000Z",
};

function point(overrides: Partial<TelemetryPoint>): TelemetryPoint {
  return {
    ...basePosition,
    telemetry_point_id: "00000000-0000-4000-8000-000000000001",
    tracking_session_id: "00000000-0000-4000-8000-000000000002",
    job_id: "00000000-0000-4000-8000-000000000003",
    driver_id: "00000000-0000-4000-8000-000000000004",
    vehicle_id: "00000000-0000-4000-8000-000000000005",
    source: "DRIVER_PHONE",
    sequence_number: 1,
    movement_state: "unknown",
    quality_status: "high",
    quality_flags: [],
    telemetry_schema_version: 1,
    encoder_version: "json-v1",
    ...overrides,
  };
}

describe("telemetry adaptive cadence", () => {
  it("uses high-movement cadence for fast device speed", () => {
    const decision = decideNextCapture({
      current: { ...basePosition, device_speed: 16 },
      online: true,
    });
    expect(decision.intervalMs).toBe(12_000);
    expect(decision.movementState).toBe("moving");
  });

  it("does not increase polling aggressively for poor accuracy", () => {
    const decision = decideNextCapture({
      current: { ...basePosition, horizontal_accuracy: 180, device_speed: 20 },
      online: true,
    });
    expect(decision.intervalMs).toBe(60_000);
    expect(decision.reason).toBe("poor_accuracy");
  });

  it("handles speed boundaries and invalid speed deterministically", () => {
    expect(
      decideNextCapture({ current: { ...basePosition, device_speed: 12 }, online: true }).reason,
    ).toBe("high_speed");
    expect(
      decideNextCapture({ current: { ...basePosition, device_speed: 2 }, online: true }).reason,
    ).toBe("normal_speed");
    expect(
      decideNextCapture({ current: { ...basePosition, device_speed: 0.5 }, online: true }).reason,
    ).toBe("slow_speed");
    expect(
      decideNextCapture({ current: { ...basePosition, device_speed: -1 }, online: false }).reason,
    ).toBe("offline_stationary");
  });
});

describe("telemetry distance", () => {
  it("returns zero for identical points", () => {
    expect(haversineMeters(40.7128, -74.006, 40.7128, -74.006)).toBe(0);
  });

  it("calculates approximate Haversine distance", () => {
    const meters = haversineMeters(40.7128, -74.006, 40.7138, -74.006);
    expect(meters).toBeGreaterThan(100);
    expect(meters).toBeLessThan(120);
  });
});

describe("telemetry quality", () => {
  it("rejects invalid coordinates", () => {
    const result = validateTelemetryQuality({
      current: { ...basePosition, latitude: 95 },
      serverNow: new Date("2026-07-07T10:01:00.000Z"),
    });
    expect(result.status).toBe("rejected");
    expect(result.flags).toContain(QUALITY_FLAGS.INVALID_COORDINATE);
  });

  it("accepts latitude and longitude boundary values", () => {
    const result = validateTelemetryQuality({
      current: { ...basePosition, latitude: 90, longitude: -180 },
      serverNow: new Date("2026-07-07T10:01:00.000Z"),
    });
    expect(result.status).toBe("high");
    expect(result.flags).not.toContain(QUALITY_FLAGS.INVALID_COORDINATE);
  });

  it("flags non-finite coordinates and negative accuracy", () => {
    const invalidCoordinate = validateTelemetryQuality({
      current: { ...basePosition, latitude: Number.NaN },
      serverNow: new Date("2026-07-07T10:01:00.000Z"),
    });
    const invalidAccuracy = validateTelemetryQuality({
      current: { ...basePosition, horizontal_accuracy: -1 },
      serverNow: new Date("2026-07-07T10:01:00.000Z"),
    });
    expect(invalidCoordinate.status).toBe("rejected");
    expect(invalidCoordinate.flags).toContain(QUALITY_FLAGS.INVALID_COORDINATE);
    expect(invalidAccuracy.status).toBe("poor");
    expect(invalidAccuracy.flags).toContain(QUALITY_FLAGS.POOR_ACCURACY);
  });

  it("flags poor accuracy", () => {
    const result = validateTelemetryQuality({
      current: { ...basePosition, horizontal_accuracy: 150 },
      serverNow: new Date("2026-07-07T10:01:00.000Z"),
    });
    expect(result.status).toBe("poor");
    expect(result.flags).toContain(QUALITY_FLAGS.POOR_ACCURACY);
  });

  it("flags suspicious speed", () => {
    const result = validateTelemetryQuality({
      current: { ...basePosition, device_speed: 90 },
      serverNow: new Date("2026-07-07T10:01:00.000Z"),
    });
    expect(result.status).toBe("poor");
    expect(result.flags).toContain(QUALITY_FLAGS.SUSPICIOUS_SPEED);
  });

  it("does not flag null speed as suspicious", () => {
    const result = validateTelemetryQuality({
      current: { ...basePosition, device_speed: null },
      serverNow: new Date("2026-07-07T10:01:00.000Z"),
    });
    expect(result.flags).not.toContain(QUALITY_FLAGS.SUSPICIOUS_SPEED);
  });

  it("flags short-window location jumps", () => {
    const result = validateTelemetryQuality({
      previous: basePosition,
      current: {
        ...basePosition,
        latitude: 41.7128,
        device_timestamp: "2026-07-07T10:01:00.000Z",
      },
      serverNow: new Date("2026-07-07T10:01:30.000Z"),
    });
    expect(result.status).toBe("poor");
    expect(result.flags).toContain(QUALITY_FLAGS.LOCATION_JUMP);
  });

  it("flags out-of-order timestamps", () => {
    const result = validateTelemetryQuality({
      previous: { ...basePosition, device_timestamp: "2026-07-07T10:02:00.000Z" },
      current: basePosition,
      serverNow: new Date("2026-07-07T10:03:00.000Z"),
    });
    expect(result.flags).toContain(QUALITY_FLAGS.OUT_OF_ORDER);
  });

  it("flags delayed uploads", () => {
    const result = validateTelemetryQuality({
      current: basePosition,
      serverNow: new Date("2026-07-07T18:01:00.000Z"),
    });
    expect(result.status).toBe("acceptable");
    expect(result.flags).toContain(QUALITY_FLAGS.DELAYED_UPLOAD);
  });
});

describe("telemetry encoder", () => {
  it("round trips JSON telemetry exactly", () => {
    const encoder = new JSONTelemetryEncoderV1();
    const original = [
      point({
        sequence_number: 7,
        altitude: null,
        vertical_accuracy: null,
        device_speed: null,
        heading: null,
      }),
    ];
    expect(encoder.decode(encoder.encode(original))).toEqual(original);
    expect(encoder.contentType).toBe("application/json");
    expect(encoder.version).toBe("json-v1");
  });
});

describe("latest location ordering", () => {
  it("does not let stale or rejected points replace newer locations", () => {
    expect(
      shouldApplyLatestLocation("2026-07-07T10:05:00.000Z", "2026-07-07T10:04:00.000Z", "high"),
    ).toBe(false);
    expect(
      shouldApplyLatestLocation("2026-07-07T10:05:00.000Z", "2026-07-07T10:06:00.000Z", "rejected"),
    ).toBe(false);
    expect(
      shouldApplyLatestLocation(
        "2026-07-07T10:05:00.000Z",
        "2026-07-07T10:06:00.000Z",
        "acceptable",
      ),
    ).toBe(true);
    expect(
      shouldApplyLatestLocation("2026-07-07T10:05:00.000Z", "2026-07-07T10:05:00.000Z", "high"),
    ).toBe(false);
  });
});

describe("telemetry queue retry semantics", () => {
  const queued = (overrides: Partial<QueuedTelemetryPoint>): QueuedTelemetryPoint => ({
    ...point({ sequence_number: 1 }),
    queue_state: "pending",
    attempts: 0,
    queued_at: "2026-07-07T10:00:00.000Z",
    last_attempt_at: null,
    last_error: null,
    ...overrides,
  });

  it("keeps failed points retryable and delays fresh batched retries", () => {
    const now = Date.parse("2026-07-07T10:05:00.000Z");
    expect(isTelemetryPointRetryEligible(queued({ queue_state: "failed" }), now)).toBe(true);
    expect(
      isTelemetryPointRetryEligible(
        queued({ queue_state: "batched", last_attempt_at: "2026-07-07T10:04:00.000Z" }),
        now,
      ),
    ).toBe(false);
    expect(
      isTelemetryPointRetryEligible(
        queued({ queue_state: "batched", last_attempt_at: "2026-07-07T10:02:00.000Z" }),
        now,
      ),
    ).toBe(true);
  });

  it("orders queued points by session, sequence, then device timestamp", () => {
    const first = queued({ tracking_session_id: "b", sequence_number: 2 });
    const second = queued({ tracking_session_id: "a", sequence_number: 2 });
    const third = queued({ tracking_session_id: "a", sequence_number: 1 });
    expect([first, second, third].sort(compareQueuedTelemetryPoints)).toEqual([
      third,
      second,
      first,
    ]);
  });
});

describe("telemetry batch idempotency shape", () => {
  it("preserves stable telemetry point ids in batch payloads", () => {
    const batch = createTelemetryBatch([
      point({ telemetry_point_id: "00000000-0000-4000-8000-000000000101", sequence_number: 2 }),
      point({ telemetry_point_id: "00000000-0000-4000-8000-000000000100", sequence_number: 1 }),
    ]);
    expect(batch.first_sequence).toBe(1);
    expect(batch.last_sequence).toBe(2);
    expect(batch.points.map((item) => item.telemetry_point_id)).toEqual([
      "00000000-0000-4000-8000-000000000100",
      "00000000-0000-4000-8000-000000000101",
    ]);
  });
});
