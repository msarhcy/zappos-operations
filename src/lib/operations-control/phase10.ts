import type { TimelineEvent } from "@/lib/tracking-operations/phase9";

export type OperationalAlertStatus =
  "open" | "acknowledged" | "escalated" | "resolved" | "dismissed";
export type EscalationLevel = "normal" | "priority" | "urgent" | "critical";
export type OperationalAlertType =
  | "telemetry_degraded"
  | "vehicle_offline"
  | "critical_incident"
  | "overdue_maintenance"
  | "major_route_deviation"
  | "urgent_brain_insight"
  | "failed_trip"
  | "emergency_sos";

export interface OperationalAlert {
  id: string;
  company_id: string;
  alert_type: OperationalAlertType | string;
  source_entity_type: string;
  source_entity_id: string;
  status: OperationalAlertStatus;
  escalation_level: EscalationLevel;
  created_at: string;
  updated_at?: string | null;
}

export interface AlertTransitionInput {
  currentStatus: OperationalAlertStatus;
  action: "acknowledge" | "escalate" | "resolve" | "dismiss";
  escalationLevel?: EscalationLevel;
  note?: string | null;
}

export interface AlertTransitionResult {
  nextStatus: OperationalAlertStatus;
  nextEscalationLevel: EscalationLevel;
  eventType: "acknowledged" | "escalated" | "resolved" | "dismissed";
}

export interface HandoverSource {
  activeTrips: number;
  unacknowledgedAlerts: OperationalAlert[];
  escalatedAlerts: OperationalAlert[];
  staleVehicles: Array<{ id: string; label: string }>;
  failedJobs: Array<{ id: string; reference: string }>;
  urgentBrainInsights: Array<{ id: string; title: string }>;
  operationalNotes: Array<{ id: string; text: string; created_at: string }>;
}

export interface HandoverItem {
  itemType:
    | "active_trips"
    | "unacknowledged_alert"
    | "escalated_alert"
    | "stale_vehicle"
    | "failed_job"
    | "urgent_brain_insight"
    | "operational_note";
  sourceEntityType: string;
  sourceEntityId: string | null;
  label: string;
  severity: "info" | "warning" | "critical";
  sortKey: string;
}

export interface OperationsNotificationInput {
  companyId: string;
  type:
    | "critical_alert_opened"
    | "alert_escalated"
    | "incident_linked"
    | "stale_vehicle_detected"
    | "handover_ready"
    | "handover_accepted";
  sourceEntityType: string;
  sourceEntityId: string;
  title: string;
  createdAt: string;
}

export interface FleetListItem {
  vehicleId: string;
  incidentState?: string | null;
  maintenanceState?: string | null;
  routeDelayState?: string | null;
  acknowledgementState?: OperationalAlertStatus | null;
  telemetryAgeSeconds?: number | null;
  trackingQuality?: string | null;
  tripStatus?: string | null;
}

export type FleetFilter =
  | "all"
  | "stale_telemetry"
  | "incidents"
  | "delayed"
  | "active"
  | "offline"
  | "poor_gps"
  | "unacknowledged";

const terminalStatuses = new Set<OperationalAlertStatus>(["resolved", "dismissed"]);

export function isValidAlertTransition(input: AlertTransitionInput) {
  if (terminalStatuses.has(input.currentStatus)) return false;
  if (input.action === "acknowledge") return input.currentStatus === "open";
  if (input.action === "escalate")
    return ["open", "acknowledged", "escalated"].includes(input.currentStatus);
  return ["open", "acknowledged", "escalated"].includes(input.currentStatus);
}

export function transitionOperationalAlert(input: AlertTransitionInput): AlertTransitionResult {
  if (terminalStatuses.has(input.currentStatus)) {
    throw new Error("Terminal alerts cannot be changed");
  }

  if (!isValidAlertTransition(input)) {
    throw new Error(`Invalid alert transition from ${input.currentStatus} using ${input.action}`);
  }

  if (input.action === "acknowledge") {
    return {
      nextStatus: "acknowledged",
      nextEscalationLevel: input.escalationLevel ?? "normal",
      eventType: "acknowledged",
    };
  }

  if (input.action === "escalate") {
    const level = input.escalationLevel ?? "priority";
    if ((level === "urgent" || level === "critical") && !input.note?.trim()) {
      throw new Error("Urgent and critical escalations require a reason");
    }
    return { nextStatus: "escalated", nextEscalationLevel: level, eventType: "escalated" };
  }

  if (input.action === "resolve") {
    return {
      nextStatus: "resolved",
      nextEscalationLevel: input.escalationLevel ?? "normal",
      eventType: "resolved",
    };
  }

  return {
    nextStatus: "dismissed",
    nextEscalationLevel: input.escalationLevel ?? "normal",
    eventType: "dismissed",
  };
}

export function alertDedupeKey(input: {
  companyId: string;
  alertType: string;
  sourceEntityType: string;
  sourceEntityId: string;
}) {
  return [
    input.companyId.trim().toLowerCase(),
    input.alertType.trim().toLowerCase(),
    input.sourceEntityType.trim().toLowerCase(),
    input.sourceEntityId.trim().toLowerCase(),
  ].join(":");
}

export function shouldCreateNotification(
  existing: OperationsNotificationInput[],
  next: OperationsNotificationInput,
) {
  const nextKey = alertDedupeKey({
    companyId: next.companyId,
    alertType: next.type,
    sourceEntityType: next.sourceEntityType,
    sourceEntityId: next.sourceEntityId,
  });
  return !existing.some(
    (item) =>
      alertDedupeKey({
        companyId: item.companyId,
        alertType: item.type,
        sourceEntityType: item.sourceEntityType,
        sourceEntityId: item.sourceEntityId,
      }) === nextKey,
  );
}

export function buildDeterministicHandover(input: HandoverSource): HandoverItem[] {
  const items: HandoverItem[] = [];
  if (input.activeTrips > 0) {
    items.push({
      itemType: "active_trips",
      sourceEntityType: "tracking_sessions",
      sourceEntityId: null,
      label: `${input.activeTrips} active trips`,
      severity: "info",
      sortKey: "0:active_trips",
    });
  }

  for (const alert of input.unacknowledgedAlerts) {
    items.push({
      itemType: "unacknowledged_alert",
      sourceEntityType: alert.source_entity_type,
      sourceEntityId: alert.source_entity_id,
      label: `${alert.alert_type.replaceAll("_", " ")} open`,
      severity: alert.escalation_level === "critical" ? "critical" : "warning",
      sortKey: `1:${alert.created_at}:${alert.id}`,
    });
  }

  for (const alert of input.escalatedAlerts) {
    items.push({
      itemType: "escalated_alert",
      sourceEntityType: alert.source_entity_type,
      sourceEntityId: alert.source_entity_id,
      label: `${alert.alert_type.replaceAll("_", " ")} escalated`,
      severity: alert.escalation_level === "critical" ? "critical" : "warning",
      sortKey: `2:${alert.created_at}:${alert.id}`,
    });
  }

  for (const vehicle of input.staleVehicles) {
    items.push({
      itemType: "stale_vehicle",
      sourceEntityType: "vehicle",
      sourceEntityId: vehicle.id,
      label: `${vehicle.label} has stale telemetry`,
      severity: "warning",
      sortKey: `3:${vehicle.label}:${vehicle.id}`,
    });
  }

  for (const job of input.failedJobs) {
    items.push({
      itemType: "failed_job",
      sourceEntityType: "job",
      sourceEntityId: job.id,
      label: `${job.reference} failed`,
      severity: "critical",
      sortKey: `4:${job.reference}:${job.id}`,
    });
  }

  for (const insight of input.urgentBrainInsights) {
    items.push({
      itemType: "urgent_brain_insight",
      sourceEntityType: "brain_insight",
      sourceEntityId: insight.id,
      label: insight.title,
      severity: "critical",
      sortKey: `5:${insight.title}:${insight.id}`,
    });
  }

  for (const note of input.operationalNotes) {
    items.push({
      itemType: "operational_note",
      sourceEntityType: "operational_note",
      sourceEntityId: note.id,
      label: note.text,
      severity: "info",
      sortKey: `6:${note.created_at}:${note.id}`,
    });
  }

  return items.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

export type HandoverStatus = "draft" | "ready" | "acknowledged" | "completed";

export function isValidHandoverTransition(current: HandoverStatus, next: HandoverStatus) {
  if (current === "draft") return next === "ready";
  if (current === "ready") return next === "acknowledged";
  if (current === "acknowledged") return next === "completed";
  return false;
}

export function handoverItemDedupeKey(
  item: Pick<HandoverItem, "itemType" | "sourceEntityType" | "sourceEntityId">,
) {
  return [
    item.itemType.trim().toLowerCase(),
    item.sourceEntityType.trim().toLowerCase(),
    (item.sourceEntityId ?? "aggregate").trim().toLowerCase(),
  ].join(":");
}

export function hasDuplicateHandoverItems(items: HandoverItem[]) {
  const keys = new Set<string>();
  for (const item of items) {
    const key = handoverItemDedupeKey(item);
    if (keys.has(key)) return true;
    keys.add(key);
  }
  return false;
}

export function mergeOperationsTimeline(sources: TimelineEvent[][]) {
  const deduped = new Map<string, TimelineEvent>();
  for (const event of sources.flat()) deduped.set(event.id, event);
  return [...deduped.values()].sort((a, b) => {
    const timeDiff = Date.parse(a.occurredAt) - Date.parse(b.occurredAt);
    if (timeDiff !== 0) return timeDiff;
    return a.id.localeCompare(b.id);
  });
}

export function filterFleetItems<T extends FleetListItem>(items: T[], filter: FleetFilter): T[] {
  if (filter === "all") return items;
  return items.filter((item) => {
    if (filter === "stale_telemetry") return (item.telemetryAgeSeconds ?? 0) > 300;
    if (filter === "incidents") return Boolean(item.incidentState && item.incidentState !== "none");
    if (filter === "delayed") return item.routeDelayState === "delayed";
    if (filter === "active")
      return ["pending", "active", "paused", "degraded"].includes(item.tripStatus ?? "");
    if (filter === "offline")
      return item.acknowledgementState === "open" && (item.telemetryAgeSeconds ?? 0) > 600;
    if (filter === "poor_gps") return item.trackingQuality === "poor";
    return item.acknowledgementState === "open";
  });
}

export function createSelectionGuard() {
  let currentRequest = 0;
  return {
    next() {
      currentRequest += 1;
      return currentRequest;
    },
    isCurrent(requestId: number) {
      return requestId === currentRequest;
    },
  };
}
