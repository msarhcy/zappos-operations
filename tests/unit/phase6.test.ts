import { describe, expect, it } from "vitest";
import {
  buildRouteGroupKey,
  calculateDelayMetrics,
  confidenceFromRoutePerformance,
  evaluateRoutePerformance,
  scoreRoutePerformanceDataQuality,
} from "@/lib/route-intelligence/performance";

describe("phase 6 route grouping", () => {
  it("normalizes route grouping by customer, pickup, and destination", () => {
    expect(
      buildRouteGroupKey({
        customerId: "customer-1",
        pickupLocation: "  10 Main   Street ",
        dropoffLocation: "Dock 7",
      }),
    ).toBe("customer:customer-1|pickup:10 main street|dropoff:dock 7");
  });

  it("keeps customer-specific route groups separate", () => {
    const a = buildRouteGroupKey({
      customerId: "customer-a",
      pickupLocation: "Depot",
      dropoffLocation: "Store",
    });
    const b = buildRouteGroupKey({
      customerId: "customer-b",
      pickupLocation: "Depot",
      dropoffLocation: "Store",
    });
    expect(a).not.toBe(b);
  });

  it("normalizes customer id case and empty locations deterministically", () => {
    expect(
      buildRouteGroupKey({
        customerId: "  CUSTOMER-A ",
        pickupLocation: "",
        dropoffLocation: null,
      }),
    ).toBe("customer:customer-a|pickup:unknown|dropoff:unknown");
  });

  it("changes route key when pickup or destination changes", () => {
    const base = buildRouteGroupKey({
      customerId: "customer-a",
      pickupLocation: "Depot",
      dropoffLocation: "Store",
    });
    expect(
      buildRouteGroupKey({
        customerId: "customer-a",
        pickupLocation: "Depot 2",
        dropoffLocation: "Store",
      }),
    ).not.toBe(base);
    expect(
      buildRouteGroupKey({
        customerId: "customer-a",
        pickupLocation: "Depot",
        dropoffLocation: "Store 2",
      }),
    ).not.toBe(base);
  });
});

describe("phase 6 delay calculation", () => {
  it("calculates scheduled versus actual delay minutes", () => {
    const result = calculateDelayMetrics({
      scheduledAt: "2026-07-08T10:00:00.000Z",
      startedAt: "2026-07-08T10:12:00.000Z",
      arrivedAt: "2026-07-08T10:45:00.000Z",
      completedAt: "2026-07-08T11:10:00.000Z",
    });
    expect(result.lateStartMinutes).toBe(12);
    expect(result.arrivalDelayMinutes).toBe(45);
    expect(result.completionDelayMinutes).toBe(70);
    expect(result.delayMinutes).toBe(70);
  });

  it("preserves early operation as negative observed delay", () => {
    const result = calculateDelayMetrics({
      scheduledAt: "2026-07-08T10:00:00.000Z",
      startedAt: "2026-07-08T09:55:00.000Z",
    });
    expect(result.lateStartMinutes).toBe(-5);
    expect(result.delayMinutes).toBe(-5);
  });
});

describe("phase 6 stop and event detection", () => {
  it("detects grouped deterministic stops from accepted telemetry points", () => {
    const result = evaluateRoutePerformance({
      scheduledAt: "2026-07-08T10:00:00.000Z",
      startedAt: "2026-07-08T10:00:00.000Z",
      completedAt: "2026-07-08T10:20:00.000Z",
      observedDistanceMeters: 1200,
      observedDurationSeconds: 1200,
      stationaryDurationSeconds: 180,
      averageObservedSpeedMps: 3,
      observedPointCount: 5,
      acceptedPointCount: 5,
      rejectedPointCount: 0,
      acceptedPoints: [
        {
          device_timestamp: "2026-07-08T10:05:00.000Z",
          sequence_number: 1,
          movement_state: "stationary",
          quality_status: "high",
        },
        {
          device_timestamp: "2026-07-08T10:08:00.000Z",
          sequence_number: 2,
          movement_state: "stationary",
          quality_status: "high",
        },
      ],
    });

    expect(result.estimatedStopCount).toBe(1);
    expect(result.delayEvents).toContain("long_stationary_period");
  });

  it("detects late start, slow progress, delayed completion, and failed trips", () => {
    const result = evaluateRoutePerformance({
      scheduledAt: "2026-07-08T10:00:00.000Z",
      startedAt: "2026-07-08T10:20:00.000Z",
      completedAt: "2026-07-08T11:00:00.000Z",
      failedAt: "2026-07-08T11:05:00.000Z",
      status: "failed",
      observedDistanceMeters: 1000,
      observedDurationSeconds: 1800,
      stationaryDurationSeconds: 0,
      averageObservedSpeedMps: 1.5,
      observedPointCount: 20,
      acceptedPointCount: 20,
      rejectedPointCount: 0,
    });

    expect(result.delayEvents).toEqual(
      expect.arrayContaining(["late_start", "slow_progress", "delayed_completion", "failed_trip"]),
    );
  });

  it("does not label early cancelled jobs as delayed or failed trips", () => {
    const result = evaluateRoutePerformance({
      scheduledAt: "2026-07-08T10:00:00.000Z",
      startedAt: "2026-07-08T09:55:00.000Z",
      completedAt: null,
      failedAt: null,
      status: "cancelled",
      observedDistanceMeters: 0,
      observedDurationSeconds: null,
      stationaryDurationSeconds: 0,
      averageObservedSpeedMps: null,
      observedPointCount: 10,
      acceptedPointCount: 10,
      rejectedPointCount: 0,
    });

    expect(result.delayMetrics.delayMinutes).toBe(-5);
    expect(result.delayEvents).not.toContain("late_start");
    expect(result.delayEvents).not.toContain("failed_trip");
  });
});

describe("phase 6 poor data handling and confidence", () => {
  it("scores no telemetry as poor quality", () => {
    expect(
      scoreRoutePerformanceDataQuality({
        observedPointCount: 0,
        acceptedPointCount: 0,
        rejectedPointCount: 0,
      }),
    ).toBe(0);
  });

  it("marks tiny samples as insufficient data", () => {
    const confidence = confidenceFromRoutePerformance({
      observedPointCount: 1,
      acceptedPointCount: 1,
      rejectedPointCount: 0,
    });
    expect(confidence.level).toBe("insufficient_data");
  });

  it("reports high confidence for strong historical telemetry", () => {
    const confidence = confidenceFromRoutePerformance({
      observedPointCount: 20,
      acceptedPointCount: 20,
      rejectedPointCount: 0,
      poorPointCount: 0,
    });
    expect(confidence.level).toBe("high");
  });

  it("adds poor telemetry quality delay event for weak data", () => {
    const result = evaluateRoutePerformance({
      observedDistanceMeters: 0,
      observedDurationSeconds: null,
      stationaryDurationSeconds: 0,
      averageObservedSpeedMps: null,
      observedPointCount: 4,
      acceptedPointCount: 1,
      rejectedPointCount: 3,
    });
    expect(result.delayEvents).toContain("poor_telemetry_quality");
    expect(result.confidence.level).toBe("insufficient_data");
  });
});
