export type CustomerPortalStatus =
  | "scheduled"
  | "assigned"
  | "collection_in_progress"
  | "in_transit"
  | "arrived"
  | "delivered"
  | "delayed"
  | "exception"
  | "cancelled";
export type CustomerTrackingVisibility = "disabled" | "status" | "approximate" | "exact";

export interface CustomerTimelineEntry {
  timestamp: string;
  title: string;
  description: string;
  source: string;
  visibility: "customer";
}
export interface CustomerTimelineInput {
  jobStatus: string;
  proofAvailable: boolean;
  scheduledAt?: string | null;
  startedAt?: string | null;
  arrivedAt?: string | null;
  completedAt?: string | null;
  events?: Array<{ event_type: string; message?: string | null; created_at?: string | null }>;
}

const visibleEvents: Record<string, { title: string; description: string }> = {
  job_scheduled: { title: "Scheduled", description: "Your shipment has been scheduled." },
  job_assigned: { title: "Assigned", description: "Your shipment has been assigned." },
  collection_started: { title: "Collection started", description: "Collection has started." },
  collected: { title: "Collected", description: "Your shipment has been collected." },
  in_transit: { title: "In transit", description: "Your shipment is on its way." },
  arrived: { title: "Arrived", description: "Your shipment has arrived at its destination." },
  delivered: { title: "Delivered", description: "Your shipment has been delivered." },
  cancelled: { title: "Cancelled", description: "This shipment has been cancelled." },
  delay_update: {
    title: "Delay update",
    description: "There is an update to your shipment schedule.",
  },
};

export function mapJobStatusToCustomerStatus(status: string): CustomerPortalStatus {
  if (["unassigned", "assigned", "accepted"].includes(status)) return "assigned";
  if (status === "in_progress") return "collection_in_progress";
  if (status === "arrived") return "arrived";
  if (status === "completed") return "delivered";
  if (status === "failed") return "exception";
  if (status === "cancelled") return "cancelled";
  return "scheduled";
}

/** Maps only an allow-list of operational events; no internal event text is reused. */
export function buildCustomerTimeline(input: CustomerTimelineInput): CustomerTimelineEntry[] {
  const entries: CustomerTimelineEntry[] = [];
  const add = (
    timestamp: string | null | undefined,
    title: string,
    description: string,
    source: string,
  ) => {
    if (timestamp) entries.push({ timestamp, title, description, source, visibility: "customer" });
  };
  add(input.scheduledAt, "Scheduled", "Your shipment has been scheduled.", "job");
  if (["assigned", "accepted"].includes(input.jobStatus))
    add(input.scheduledAt, "Assigned", "Your shipment has been assigned.", "job");
  if (["in_progress", "arrived", "completed"].includes(input.jobStatus))
    add(
      input.startedAt ?? input.scheduledAt,
      "Collection started",
      "Collection has started.",
      "job",
    );
  if (["arrived", "completed"].includes(input.jobStatus))
    add(input.arrivedAt, "Arrived", "Your shipment has arrived at its destination.", "job");
  if (input.jobStatus === "completed")
    add(input.completedAt, "Delivered", "Your shipment has been delivered.", "job");
  if (input.jobStatus === "cancelled")
    add(
      input.completedAt ?? input.scheduledAt,
      "Cancelled",
      "This shipment has been cancelled.",
      "job",
    );
  for (const event of input.events ?? []) {
    const mapped = visibleEvents[event.event_type];
    if (mapped && event.created_at)
      add(event.created_at, mapped.title, mapped.description, event.event_type);
  }
  if (input.proofAvailable)
    add(
      input.completedAt,
      "Proof available",
      "Proof of delivery is available for review.",
      "proof",
    );
  return entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function getCustomerVisibleDocuments<T extends { visibility?: string | null }>(
  documents: T[],
) {
  return documents.filter((document) => document.visibility === "customer_visible");
}
export function isTrackingVisible({
  jobStatus,
  visibility,
}: {
  jobStatus: string;
  visibility?: CustomerTrackingVisibility | null;
}) {
  return (
    !["completed", "failed", "cancelled"].includes(jobStatus) &&
    (visibility === "approximate" || visibility === "exact")
  );
}
export function isProofAccessible({
  jobStatus,
  proofVisible,
  proofFinalized,
}: {
  jobStatus: string;
  proofVisible?: boolean | null;
  proofFinalized?: boolean | null;
}) {
  return jobStatus === "completed" && Boolean(proofVisible) && Boolean(proofFinalized);
}
export function isShipmentShareLinkActive({
  status,
  expiresAt,
  maxViews,
  viewCount,
  now = Date.now(),
}: {
  status?: string | null;
  expiresAt?: string | null;
  maxViews?: number | null;
  viewCount?: number | null;
  now?: number;
}) {
  return (
    status === "active" &&
    (!expiresAt || new Date(expiresAt).getTime() > now) &&
    !(maxViews != null && (viewCount ?? 0) >= maxViews)
  );
}
export function customerStatusLabel(status: CustomerPortalStatus) {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
