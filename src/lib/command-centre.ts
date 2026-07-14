export type HealthLevel = "healthy" | "warning" | "critical";
export interface FleetHealthInput {
  openIncidents: number;
  criticalIncidents: number;
  maintenanceDue: number;
  poorTelemetry: number;
  unavailableDrivers: number;
  openAlerts: number;
}
export function fleetHealth(input: FleetHealthInput): { score: number; level: HealthLevel } {
  const score = Math.max(
    0,
    100 -
      input.criticalIncidents * 30 -
      input.openIncidents * 8 -
      input.maintenanceDue * 5 -
      input.poorTelemetry * 4 -
      input.unavailableDrivers * 3 -
      input.openAlerts * 4,
  );
  return {
    score,
    level:
      score < 55 || input.criticalIncidents > 0 ? "critical" : score < 80 ? "warning" : "healthy",
  };
}
export interface CommandTimelineItem {
  id: string;
  source: string;
  title: string;
  timestamp: string;
  priority: "low" | "medium" | "high" | "critical";
}
export function mergeCommandTimeline(...groups: CommandTimelineItem[][]) {
  return groups.flat().sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
export function filterCommandTimeline(
  items: CommandTimelineItem[],
  search: string,
  source: string,
) {
  const needle = search.trim().toLowerCase();
  return items.filter(
    (item) =>
      (source === "all" || item.source === source) &&
      (!needle || `${item.title} ${item.source}`.toLowerCase().includes(needle)),
  );
}
