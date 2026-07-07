import { describe, expect, it } from "vitest";
import { decideNextCapture } from "@/lib/telemetry/adaptive-controller";
import { haversineMeters } from "@/lib/telemetry/distance";
import { JSONTelemetryEncoderV1 } from "@/lib/telemetry/json-encoder-v1";
import { createTelemetryBatch } from "@/lib/telemetry/sync";
import {
  QUALITY_FLAGS,
  shouldApplyLatestLocation,
  validateTelemetryQuality,
} from "@/lib/telemetry/quality";
import type { CapturedPosition, TelemetryPoint } from "@/lib/telemetry/types";

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
});

describe("telemetry distance", () => {
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

  it("flags suspicious speed", () => {
    const result = validateTelemetryQuality({
      current: { ...basePosition, device_speed: 90 },
      serverNow: new Date("2026-07-07T10:01:00.000Z"),
    });
    expect(result.status).toBe("poor");
    expect(result.flags).toContain(QUALITY_FLAGS.SUSPICIOUS_SPEED);
  });

  it("flags out-of-order timestamps", () => {
    const result = validateTelemetryQuality({
      previous: { ...basePosition, device_timestamp: "2026-07-07T10:02:00.000Z" },
      current: basePosition,
      serverNow: new Date("2026-07-07T10:03:00.000Z"),
    });
    expect(result.flags).toContain(QUALITY_FLAGS.OUT_OF_ORDER);
  });
});

describe("telemetry encoder", () => {
  it("round trips JSON telemetry exactly", () => {
    const encoder = new JSONTelemetryEncoderV1();
    const original = [point({ sequence_number: 7 })];
    expect(encoder.decode(encoder.encode(original))).toEqual(original);
    expect(encoder.contentType).toBe("application/json");
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
