import { describe, expect, it } from "vitest";
import {
  alertDedupeKey,
  buildDeterministicHandover,
  createSelectionGuard,
  filterFleetItems,
  handoverItemDedupeKey,
  hasDuplicateHandoverItems,
  isValidAlertTransition,
  isValidHandoverTransition,
  mergeOperationsTimeline,
  shouldCreateNotification,
  transitionOperationalAlert,
  type FleetListItem,
  type OperationalAlert,
  type OperationsNotificationInput,
} from "@/lib/operations-control/phase10";
import type { TimelineEvent } from "@/lib/tracking-operations/phase9";

const openAlert: OperationalAlert = {
  id: "alert-1",
  company_id: "company-1",
  alert_type: "vehicle_offline",
  source_entity_type: "vehicle",
  source_entity_id: "vehicle-1",
  status: "open",
  escalation_level: "normal",
  created_at: "2026-07-11T10:00:00.000Z",
};

describe("phase 10 alert lifecycle", () => {
  it("acknowledges, escalates, and resolves operational alerts deterministically", () => {
    expect(
      transitionOperationalAlert({
        currentStatus: "open",
        action: "acknowledge",
        note: "Dispatcher has seen this",
      }),
    ).toEqual({
      nextStatus: "acknowledged",
      nextEscalationLevel: "normal",
      eventType: "acknowledged",
    });

    expect(
      transitionOperationalAlert({
        currentStatus: "acknowledged",
        action: "escalate",
        escalationLevel: "priority",
      }),
    ).toEqual({
      nextStatus: "escalated",
      nextEscalationLevel: "priority",
      eventType: "escalated",
    });

    expect(
      transitionOperationalAlert({
        currentStatus: "escalated",
        action: "resolve",
      }).nextStatus,
    ).toBe("resolved");
  });

  it("requires a reason for urgent and critical escalation", () => {
    expect(() =>
      transitionOperationalAlert({
        currentStatus: "open",
        action: "escalate",
        escalationLevel: "urgent",
      }),
    ).toThrow("require a reason");

    expect(
      transitionOperationalAlert({
        currentStatus: "open",
        action: "escalate",
        escalationLevel: "critical",
        note: "Customer escalation on active incident",
      }).nextEscalationLevel,
    ).toBe("critical");
  });

  it("blocks changes to terminal alerts", () => {
    expect(() =>
      transitionOperationalAlert({
        currentStatus: "resolved",
        action: "acknowledge",
      }),
    ).toThrow("Terminal alerts");
  });

  it("blocks repeated acknowledgement and allows distinct resolution or dismissal", () => {
    expect(
      isValidAlertTransition({
        currentStatus: "acknowledged",
        action: "acknowledge",
      }),
    ).toBe(false);

    expect(() =>
      transitionOperationalAlert({
        currentStatus: "acknowledged",
        action: "acknowledge",
      }),
    ).toThrow("Invalid alert transition");

    expect(
      transitionOperationalAlert({
        currentStatus: "acknowledged",
        action: "dismiss",
      }),
    ).toMatchObject({ nextStatus: "dismissed", eventType: "dismissed" });

    expect(
      transitionOperationalAlert({
        currentStatus: "open",
        action: "resolve",
      }),
    ).toMatchObject({ nextStatus: "resolved", eventType: "resolved" });
  });
});

describe("phase 10 duplicate prevention and tenant keys", () => {
  it("normalizes duplicate alert keys without crossing company boundaries", () => {
    expect(
      alertDedupeKey({
        companyId: " Company-1 ",
        alertType: " Vehicle_Offline ",
        sourceEntityType: " Vehicle ",
        sourceEntityId: " Vehicle-1 ",
      }),
    ).toBe("company-1:vehicle_offline:vehicle:vehicle-1");

    expect(
      alertDedupeKey({
        companyId: "company-2",
        alertType: "vehicle_offline",
        sourceEntityType: "vehicle",
        sourceEntityId: "vehicle-1",
      }),
    ).not.toBe(
      alertDedupeKey({
        companyId: "company-1",
        alertType: "vehicle_offline",
        sourceEntityType: "vehicle",
        sourceEntityId: "vehicle-1",
      }),
    );
  });

  it("deduplicates operational notifications by company, type, and source entity", () => {
    const existing: OperationsNotificationInput[] = [
      {
        companyId: "company-1",
        type: "alert_escalated",
        sourceEntityType: "alert",
        sourceEntityId: "alert-1",
        title: "Alert escalated",
        createdAt: "2026-07-11T10:00:00.000Z",
      },
    ];

    expect(
      shouldCreateNotification(existing, {
        ...existing[0],
        title: "Repeated title does not matter",
        createdAt: "2026-07-11T10:01:00.000Z",
      }),
    ).toBe(false);

    expect(shouldCreateNotification(existing, { ...existing[0], sourceEntityId: "alert-2" })).toBe(
      true,
    );
  });
});

describe("phase 10 deterministic handover and timeline", () => {
  it("aggregates handover items in a stable deterministic order", () => {
    const items = buildDeterministicHandover({
      activeTrips: 2,
      unacknowledgedAlerts: [
        { ...openAlert, id: "alert-b", created_at: "2026-07-11T10:02:00.000Z" },
      ],
      escalatedAlerts: [
        {
          ...openAlert,
          id: "alert-a",
          status: "escalated",
          escalation_level: "critical",
          created_at: "2026-07-11T10:01:00.000Z",
        },
      ],
      staleVehicles: [{ id: "vehicle-1", label: "KDA 101A" }],
      failedJobs: [{ id: "job-1", reference: "JOB-001" }],
      urgentBrainInsights: [{ id: "insight-1", title: "Urgent deterministic insight" }],
      operationalNotes: [
        { id: "note-1", text: "Night shift note", created_at: "2026-07-11T10:03:00.000Z" },
      ],
    });

    expect(items.map((item) => item.itemType)).toEqual([
      "active_trips",
      "unacknowledged_alert",
      "escalated_alert",
      "stale_vehicle",
      "failed_job",
      "urgent_brain_insight",
      "operational_note",
    ]);
    expect(items.find((item) => item.itemType === "escalated_alert")?.severity).toBe("critical");
  });

  it("validates handover lifecycle transitions and duplicate item keys", () => {
    expect(isValidHandoverTransition("draft", "ready")).toBe(true);
    expect(isValidHandoverTransition("draft", "completed")).toBe(false);
    expect(isValidHandoverTransition("ready", "acknowledged")).toBe(true);
    expect(isValidHandoverTransition("acknowledged", "completed")).toBe(true);
    expect(isValidHandoverTransition("completed", "ready")).toBe(false);

    const first = {
      itemType: "stale_vehicle" as const,
      sourceEntityType: "vehicle",
      sourceEntityId: "vehicle-1",
      label: "KDA 101A has stale telemetry",
      severity: "warning" as const,
      sortKey: "3:KDA 101A:vehicle-1",
    };
    expect(handoverItemDedupeKey(first)).toBe("stale_vehicle:vehicle:vehicle-1");
    expect(hasDuplicateHandoverItems([first, { ...first, label: "Duplicate label" }])).toBe(true);
    expect(hasDuplicateHandoverItems([first, { ...first, sourceEntityId: "vehicle-2" }])).toBe(
      false,
    );
  });

  it("only includes unresolved alerts in deterministic handover inputs supplied by caller", () => {
    const items = buildDeterministicHandover({
      activeTrips: 0,
      unacknowledgedAlerts: [{ ...openAlert, status: "open" }],
      escalatedAlerts: [{ ...openAlert, id: "alert-2", status: "escalated" }],
      staleVehicles: [],
      failedJobs: [],
      urgentBrainInsights: [],
      operationalNotes: [],
    });

    expect(items.map((item) => item.itemType)).toEqual(["unacknowledged_alert", "escalated_alert"]);
  });

  it("orders operational timeline events by timestamp with id tie-breaking and duplicate prevention", () => {
    const events: TimelineEvent[] = mergeOperationsTimeline([
      [
        {
          id: "note:2",
          occurredAt: "2026-07-11T10:00:00.000Z",
          source: "dispatcher",
          type: "note",
          label: "Second",
          severity: "info",
        },
        {
          id: "alert:1",
          occurredAt: "2026-07-11T10:00:00.000Z",
          source: "dispatcher",
          type: "alert",
          label: "First",
          severity: "warning",
        },
      ],
      [
        {
          id: "alert:1",
          occurredAt: "2026-07-11T10:00:00.000Z",
          source: "dispatcher",
          type: "alert",
          label: "Duplicate",
          severity: "warning",
        },
      ],
    ]);

    expect(events.map((event) => event.id)).toEqual(["alert:1", "note:2"]);
    expect(events).toHaveLength(2);
  });
});

describe("phase 10 fleet filters and stale selection guard", () => {
  const fleet: FleetListItem[] = [
    {
      vehicleId: "stale",
      telemetryAgeSeconds: 601,
      acknowledgementState: "open",
      trackingQuality: "high",
    },
    { vehicleId: "poor", telemetryAgeSeconds: 30, trackingQuality: "poor" },
    { vehicleId: "incident", incidentState: "critical", trackingQuality: "high" },
    { vehicleId: "active", tripStatus: "active", trackingQuality: "high" },
  ];

  it("filters active fleet command states without inventing status", () => {
    expect(filterFleetItems(fleet, "offline").map((item) => item.vehicleId)).toEqual(["stale"]);
    expect(filterFleetItems(fleet, "poor_gps").map((item) => item.vehicleId)).toEqual(["poor"]);
    expect(filterFleetItems(fleet, "incidents").map((item) => item.vehicleId)).toEqual([
      "incident",
    ]);
    expect(filterFleetItems(fleet, "active").map((item) => item.vehicleId)).toEqual(["active"]);
  });

  it("prevents stale asynchronous selection responses from becoming current", () => {
    const guard = createSelectionGuard();
    const first = guard.next();
    const second = guard.next();

    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });
});
