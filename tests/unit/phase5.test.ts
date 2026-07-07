import { describe, expect, it } from "vitest";
import { createGeographicCacheKey } from "@/lib/providers/cache-key";
import {
  confidenceFromProviderFreshness,
  confidenceFromTelemetry,
} from "@/lib/providers/confidence";
import { DisabledWeatherProvider, normalizeOpenMeteoWeather } from "@/lib/providers/weather";
import {
  DisabledTrafficProvider,
  congestionStateFromRatio,
  normalizeTomTomTraffic,
} from "@/lib/providers/traffic";
import {
  calculateRouteIntelligence,
  calculateRouteQualityScore,
} from "@/lib/route-intelligence/intelligence";
import { buildObservedTrace } from "@/lib/route-intelligence/trace";

describe("provider geographic cache keys", () => {
  it("reuses a weather cell for nearby coordinates", () => {
    const a = createGeographicCacheKey("weather", 40.71281, -74.00601);
    const b = createGeographicCacheKey("weather", 40.713, -74.0058);
    expect(a.cacheKey).toBe(b.cacheKey);
  });

  it("uses different keys outside a traffic cell", () => {
    const a = createGeographicCacheKey("traffic", 40.7121, -74.0061);
    const b = createGeographicCacheKey("traffic", 40.7141, -74.0061);
    expect(a.cacheKey).not.toBe(b.cacheKey);
  });
});

describe("weather providers", () => {
  it("normalizes available Open-Meteo values and preserves missing values", () => {
    const result = normalizeOpenMeteoWeather({
      current: {
        temperature_2m: 20.4,
        precipitation: 0,
        weather_code: 61,
        wind_speed_10m: 11,
      },
    });
    expect(result.temperatureC).toBe(20.4);
    expect(result.condition).toBe("Rain");
    expect(result.visibilityMeters).toBeNull();
    expect(result.windDirectionDegrees).toBeNull();
  });

  it("disabled weather provider fails closed", async () => {
    const result = await new DisabledWeatherProvider().getWeatherNearLocation();
    expect(result.observation).toBeNull();
    expect(result.unavailableReason).toMatch(/unavailable/i);
  });
});

describe("traffic providers", () => {
  it("normalizes TomTom flow and congestion state", () => {
    const result = normalizeTomTomTraffic({
      flowSegmentData: { currentSpeed: 30, freeFlowSpeed: 60 },
    });
    expect(result.congestionRatio).toBe(0.5);
    expect(result.congestionState).toBe("moderate");
  });

  it("calculates congestion state boundaries", () => {
    expect(congestionStateFromRatio(0.9)).toBe("free_flow");
    expect(congestionStateFromRatio(0.75)).toBe("light");
    expect(congestionStateFromRatio(0.6)).toBe("moderate");
    expect(congestionStateFromRatio(0.4)).toBe("heavy");
    expect(congestionStateFromRatio(0.1)).toBe("severe");
    expect(congestionStateFromRatio(null)).toBe("unknown");
  });

  it("disabled traffic provider fails closed", async () => {
    const result = await new DisabledTrafficProvider().getTrafficNearLocation();
    expect(result.observation).toBeNull();
    expect(result.unavailableReason).toMatch(/unavailable/i);
  });
});

describe("route intelligence", () => {
  it("handles a zero-point session", () => {
    const result = calculateRouteIntelligence({
      observedDistanceMeters: 0,
      totalDurationSeconds: 0,
      movingDurationSeconds: 0,
      stationaryDurationSeconds: 0,
      averageObservedSpeedMps: null,
      maximumCredibleSpeedMps: null,
      observedPointCount: 0,
      acceptedPointCount: 0,
      rejectedPointCount: 0,
      delayedUploadCount: 0,
    });
    expect(result.routeQualityScore).toBe(0);
    expect(result.dataConfidence.level).toBe("insufficient_data");
  });

  it("calculates stationary ratio, stop count, delayed percentage, and bounded quality", () => {
    const result = calculateRouteIntelligence({
      observedDistanceMeters: 1200,
      totalDurationSeconds: 600,
      movingDurationSeconds: 300,
      stationaryDurationSeconds: 300,
      averageObservedSpeedMps: 2,
      maximumCredibleSpeedMps: 12,
      observedPointCount: 10,
      acceptedPointCount: 9,
      rejectedPointCount: 1,
      poorPointCount: 1,
      delayedUploadCount: 2,
      stationarySegmentCount: 2,
    });
    expect(result.stationaryRatio).toBe(0.5);
    expect(result.estimatedStopCount).toBe(2);
    expect(result.delayedUploadPercentage).toBe(20);
    expect(result.routeQualityScore).toBeGreaterThanOrEqual(0);
    expect(result.routeQualityScore).toBeLessThanOrEqual(100);
  });

  it("bounds route quality score", () => {
    expect(
      calculateRouteQualityScore({
        observedDistanceMeters: 0,
        totalDurationSeconds: 3600,
        movingDurationSeconds: 0,
        stationaryDurationSeconds: 0,
        averageObservedSpeedMps: null,
        maximumCredibleSpeedMps: null,
        observedPointCount: 1,
        acceptedPointCount: 0,
        rejectedPointCount: 1,
        delayedUploadCount: 1,
      }),
    ).toBeGreaterThanOrEqual(0);
  });
});

describe("confidence model", () => {
  it("does not report high confidence from insufficient data", () => {
    expect(
      confidenceFromTelemetry({
        acceptedPointCount: 1,
        observedPointCount: 1,
        rejectedPointCount: 0,
      }).level,
    ).toBe("insufficient_data");
  });

  it("reports high confidence for high-quality telemetry", () => {
    expect(
      confidenceFromTelemetry({
        acceptedPointCount: 20,
        observedPointCount: 20,
        rejectedPointCount: 0,
        poorPointCount: 0,
        delayedUploadCount: 0,
      }).level,
    ).toBe("high");
  });

  it("uses provider freshness", () => {
    const result = confidenceFromProviderFreshness({
      retrievedAt: "2026-07-07T10:00:00.000Z",
      now: new Date("2026-07-07T10:02:00.000Z"),
    });
    expect(result.level).toBe("high");
  });
});

describe("observed trace", () => {
  it("sorts and filters renderable trace points", () => {
    const trace = buildObservedTrace([
      {
        latitude: 95,
        longitude: 0,
        device_timestamp: "2026-07-07T10:02:00.000Z",
        sequence_number: 3,
        quality_status: "high",
      },
      {
        latitude: 40.2,
        longitude: -74,
        device_timestamp: "2026-07-07T10:02:00.000Z",
        sequence_number: 2,
        quality_status: "acceptable",
      },
      {
        latitude: 40.1,
        longitude: -74,
        device_timestamp: "2026-07-07T10:01:00.000Z",
        sequence_number: 1,
        quality_status: "high",
      },
    ]);
    expect(trace.points.map((point) => point.latitude)).toEqual([40.1, 40.2]);
    expect(trace.hasRenderableTrace).toBe(true);
  });

  it("handles an empty trace", () => {
    expect(buildObservedTrace([]).hasRenderableTrace).toBe(false);
  });
});
