import { describe, expect, it } from "vitest";
import {
  buildRouteReplay,
  buildTripTimeline,
  createAuditTrailEvent,
  detectCorridorDeviation,
  detectGeofenceEvents,
  mergeIncidentTimeline,
  summarizeTelemetryQuality,
  type OperationsPoint,
  type TimelineEvent,
} from "@/lib/tracking-operations/phase9";

const points: OperationsPoint[] = [
  {
    latitude: 36.1,
    longitude: -115.1,
    device_timestamp: "2026-07-11T10:00:00.000Z",
    sequence_number: 1,
    quality_status: "high",
    movement_state: "stationary",
  },
  {
    latitude: 36.11,
    longitude: -115.1,
    device_timestamp: "2026-07-11T10:05:00.000Z",
    sequence_number: 2,
    quality_status: "rejected",
    movement_state: "moving",
  },
  {
    latitude: 36.12,
    longitude: -115.1,
    device_timestamp: "2026-07-11T10:10:00.000Z",
    sequence_number: 3,
    quality_status: "acceptable",
    movement_state: "moving",
  },
];

describe("phase 9 route replay", () => {
  it("uses accepted GPS observations only and orders frames deterministically", () => {
    const replay = buildRouteReplay([points[2], points[1], points[0]]);

    expect(replay).toEqual([
      expect.objectContaining({ index: 0, sequenceNumber: 1 }),
      expect.objectContaining({ index: 1, sequenceNumber: 3 }),
    ]);
  });

  it("excludes poor and invalid observations from replay frames", () => {
    const replay = buildRouteReplay([
      { ...points[0], quality_status: "poor", sequence_number: 1 },
      { ...points[0], latitude: 91, quality_status: "high", sequence_number: 2 },
      { ...points[2], quality_status: "acceptable", sequence_number: 3 },
    ]);

    expect(replay.map((frame) => frame.sequenceNumber)).toEqual([3]);
  });
});

describe("phase 9 timeline ordering", () => {
  it("orders trip and GPS events by timestamp with stable tie breaking", () => {
    const timeline = buildTripTimeline({
      sessionId: "session-1",
      startedAt: "2026-07-11T10:00:00.000Z",
      acceptedAt: "2026-07-11T09:55:00.000Z",
      completedAt: "2026-07-11T11:00:00.000Z",
      points,
    });

    expect(timeline.map((event) => event.type).slice(0, 3)).toEqual([
      "driver_accepted_job",
      "gps_online",
      "stationary",
    ]);
    expect(timeline.at(-1)?.type).toBe("completed");
  });
});

describe("phase 9 geofence events", () => {
  it("generates depot/customer arrival, departure, and long stop events from GPS", () => {
    const events = detectGeofenceEvents({
      longStopSeconds: 120,
      geofences: [
        {
          id: "depot-1",
          label: "Depot",
          type: "depot",
          latitude: 36.1,
          longitude: -115.1,
          radiusMeters: 80,
        },
        {
          id: "customer-1",
          label: "Customer",
          type: "customer",
          latitude: 36.12,
          longitude: -115.1,
          radiusMeters: 80,
        },
      ],
      points: [
        points[0],
        {
          ...points[0],
          device_timestamp: "2026-07-11T10:03:00.000Z",
          sequence_number: 2,
        },
        { ...points[2], sequence_number: 3 },
      ],
    });

    expect(events.map((event) => event.type)).toEqual([
      "entered_depot",
      "long_stop",
      "customer_arrival",
      "exited_depot",
    ]);
  });

  it("does not emit repeated enter or exit events while state is unchanged", () => {
    const events = detectGeofenceEvents({
      geofences: [
        {
          id: "depot-1",
          label: "Depot",
          type: "depot",
          latitude: 36.1,
          longitude: -115.1,
          radiusMeters: 100,
        },
      ],
      points: [
        points[0],
        { ...points[0], sequence_number: 2, device_timestamp: "2026-07-11T10:01:00.000Z" },
        {
          ...points[0],
          latitude: 36.12,
          sequence_number: 3,
          device_timestamp: "2026-07-11T10:02:00.000Z",
        },
        {
          ...points[0],
          latitude: 36.13,
          sequence_number: 4,
          device_timestamp: "2026-07-11T10:03:00.000Z",
        },
      ],
    });

    expect(events.map((event) => event.type)).toEqual(["entered_depot", "exited_depot"]);
  });

  it("ignores poor and rejected telemetry for geofence state", () => {
    const events = detectGeofenceEvents({
      geofences: [
        {
          id: "customer-1",
          label: "Customer",
          type: "customer",
          latitude: 36.12,
          longitude: -115.1,
          radiusMeters: 100,
        },
      ],
      points: [
        { ...points[2], quality_status: "poor", sequence_number: 1 },
        { ...points[1], quality_status: "rejected", sequence_number: 2 },
        { ...points[2], quality_status: "acceptable", sequence_number: 3 },
      ],
    });

    expect(events.map((event) => event.type)).toEqual(["customer_arrival"]);
  });
});

describe("phase 9 deviation detection", () => {
  it("emits within, minor, major, and returned-to-route events without map matching", () => {
    const events = detectCorridorDeviation(
      [
        { ...points[0], latitude: 36.1, longitude: -115.1, sequence_number: 1 },
        {
          ...points[0],
          latitude: 36.1,
          longitude: -115.098,
          sequence_number: 2,
          device_timestamp: "2026-07-11T10:01:00.000Z",
        },
        {
          ...points[0],
          latitude: 36.1,
          longitude: -115.09,
          sequence_number: 3,
          device_timestamp: "2026-07-11T10:02:00.000Z",
        },
        {
          ...points[0],
          latitude: 36.11,
          longitude: -115.1,
          sequence_number: 4,
          device_timestamp: "2026-07-11T10:03:00.000Z",
        },
      ],
      {
        points: [
          { latitude: 36.1, longitude: -115.1 },
          { latitude: 36.12, longitude: -115.1 },
        ],
        minorMeters: 50,
        majorMeters: 500,
      },
    );

    expect(events.map((event) => event.type)).toEqual([
      "within_corridor",
      "minor_deviation",
      "major_deviation",
      "returned_to_route",
    ]);
  });

  it("excludes poor telemetry from deviation state changes", () => {
    const events = detectCorridorDeviation(
      [
        { ...points[0], latitude: 36.1, longitude: -115.1, sequence_number: 1 },
        {
          ...points[0],
          latitude: 36.1,
          longitude: -115.09,
          quality_status: "poor",
          sequence_number: 2,
          device_timestamp: "2026-07-11T10:01:00.000Z",
        },
        {
          ...points[0],
          latitude: 36.11,
          longitude: -115.1,
          sequence_number: 3,
          device_timestamp: "2026-07-11T10:02:00.000Z",
        },
      ],
      {
        points: [
          { latitude: 36.1, longitude: -115.1 },
          { latitude: 36.12, longitude: -115.1 },
        ],
        minorMeters: 50,
        majorMeters: 500,
      },
    );

    expect(events.map((event) => event.type)).toEqual(["within_corridor"]);
  });
});

describe("phase 9 telemetry quality monitor", () => {
  it("reports poor GPS, weak signal, delayed upload, rejections, duplicates, and out-of-order telemetry", () => {
    const summary = summarizeTelemetryQuality({
      now: new Date("2026-07-11T12:00:00.000Z"),
      activeSessionCount: 1,
      duplicateTelemetryCount: 2,
      points: [
        {
          ...points[0],
          quality_status: "poor",
          horizontal_accuracy: 75,
          quality_flags: ["POOR_ACCURACY", "WEAK_SIGNAL", "DELAYED_UPLOAD"],
        },
        { ...points[1], quality_status: "rejected" },
        {
          ...points[1],
          sequence_number: 4,
          quality_status: "rejected",
          quality_flags: ["OUT_OF_ORDER"],
        },
        { ...points[2], quality_status: "rejected" },
        { ...points[2], sequence_number: 5, quality_status: "high" },
      ],
    });

    expect(summary).toMatchObject({
      status: "critical",
      poorGps: 1,
      weakSignal: 1,
      delayedUpload: 1,
      highRejectionRate: true,
      duplicateTelemetry: 2,
      outOfOrderTelemetry: 1,
      offline: true,
    });
  });

  it("does not report weak signal from poor accuracy alone", () => {
    const summary = summarizeTelemetryQuality({
      now: new Date("2026-07-11T10:01:00.000Z"),
      activeSessionCount: 1,
      points: [
        {
          ...points[0],
          quality_status: "poor",
          horizontal_accuracy: 90,
          quality_flags: ["POOR_ACCURACY"],
        },
      ],
    });

    expect(summary.poorGps).toBe(1);
    expect(summary.weakSignal).toBe(0);
  });
});

describe("phase 9 unified incident timeline and audit trail", () => {
  it("merges timeline sources chronologically and deduplicates ids", () => {
    const incident: TimelineEvent = {
      id: "incident-1",
      occurredAt: "2026-07-11T10:10:00.000Z",
      source: "incident",
      type: "incident_reported",
      label: "Incident reported",
      severity: "critical",
    };
    const maintenance: TimelineEvent = {
      id: "maintenance-1",
      occurredAt: "2026-07-11T10:05:00.000Z",
      source: "maintenance",
      type: "maintenance_warning",
      label: "Maintenance warning",
      severity: "warning",
    };

    expect(
      mergeIncidentTimeline([[incident], [maintenance], [incident]]).map((event) => event.id),
    ).toEqual(["maintenance-1", "incident-1"]);
  });

  it("converts dispatcher audit actions into immutable timeline events", () => {
    const event = createAuditTrailEvent({
      id: "audit-1",
      actorId: "user-1",
      companyId: "company-1",
      action: "dispatcher_acknowledged_incident",
      occurredAt: "2026-07-11T10:00:00.000Z",
      entityType: "incident",
      entityId: "incident-1",
    });

    expect(event).toMatchObject({
      source: "dispatcher",
      label: "Dispatcher Acknowledged Incident",
      metadata: { actor_id: "user-1", entity_id: "incident-1" },
    });
  });
});
