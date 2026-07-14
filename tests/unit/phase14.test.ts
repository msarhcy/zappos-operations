import { describe, expect, it } from "vitest";
import { filterCommandTimeline, fleetHealth, mergeCommandTimeline } from "@/lib/command-centre";

describe("phase 14 command centre", () => {
  it("calculates deterministic fleet health without prediction", () => {
    expect(
      fleetHealth({
        openIncidents: 0,
        criticalIncidents: 0,
        maintenanceDue: 0,
        poorTelemetry: 0,
        unavailableDrivers: 0,
        openAlerts: 0,
      }),
    ).toEqual({ score: 100, level: "healthy" });
    expect(
      fleetHealth({
        openIncidents: 1,
        criticalIncidents: 1,
        maintenanceDue: 2,
        poorTelemetry: 0,
        unavailableDrivers: 0,
        openAlerts: 1,
      }).level,
    ).toBe("critical");
  });
  it("merges a chronological timeline and filters without exposing other fields", () => {
    const items = mergeCommandTimeline(
      [
        {
          id: "a",
          source: "incident",
          title: "Incident",
          timestamp: "2026-01-01T10:00:00Z",
          priority: "high",
        },
      ],
      [
        {
          id: "b",
          source: "dispatch",
          title: "Assigned",
          timestamp: "2026-01-01T11:00:00Z",
          priority: "low",
        },
      ],
    );
    expect(items.map((item) => item.id)).toEqual(["b", "a"]);
    expect(filterCommandTimeline(items, "assign", "dispatch")).toHaveLength(1);
  });
});
