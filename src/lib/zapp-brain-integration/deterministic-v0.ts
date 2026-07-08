import type {
  JsonRecord,
  ZappBrainCategory,
  ZappBrainConfidence,
  ZappBrainInsightDraft,
  ZappBrainSeverity,
} from "./types";

export interface BrainDocumentInput {
  id: string;
  company_id: string;
  owner_type: string;
  owner_id: string;
  document_type: string;
  name: string;
  expiry_date: string | null;
}

export interface BrainRouteBaselineInput {
  id: string;
  company_id: string;
  route_key: string;
  customer_id: string | null;
  pickup_location: string | null;
  dropoff_location: string | null;
  completed_trip_count: number;
  average_delay_minutes: number | null;
  delayed_trip_count: number;
  confidence: ZappBrainConfidence;
  data_quality_score: number;
}

export interface BrainRouteRecordInput {
  id: string;
  company_id: string;
  job_id: string;
  customer_id: string | null;
  vehicle_id?: string | null;
  route_key: string;
  delay_minutes: number | null;
  delay_events: string[];
  observed_point_count?: number | null;
  accepted_point_count?: number | null;
  rejected_point_count?: number | null;
  data_quality_score: number;
  confidence: ZappBrainConfidence;
}

export interface BrainIncidentInput {
  id: string;
  company_id: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "investigating" | "resolved";
  vehicle_id: string | null;
  driver_id: string | null;
  description: string;
}

export interface BrainMaintenanceInput {
  id: string;
  company_id: string;
  vehicle_id: string;
  status: "reported" | "scheduled" | "in_progress" | "completed";
  title: string;
  scheduled_date: string | null;
}

export interface BrainJobInput {
  id: string;
  company_id: string;
  reference: string;
  customer_id: string | null;
  vehicle_id: string | null;
  driver_id: string | null;
  status: string;
  scheduled_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
}

export interface BrainJobEventInput {
  id: string;
  company_id: string;
  job_id: string;
  event_type: string;
  message: string | null;
  metadata: JsonRecord | null;
  created_at: string;
}

export interface BrainTrackingSummaryInput {
  tracking_session_id: string;
  company_id: string;
  observed_point_count: number;
  accepted_point_count: number;
  rejected_point_count: number;
  telemetry_quality_score: number | null;
}

export interface DeterministicBrainInput {
  companyId: string;
  now: Date;
  documentExpiryWarningDays: number;
  documents: BrainDocumentInput[];
  routeBaselines: BrainRouteBaselineInput[];
  routeRecords: BrainRouteRecordInput[];
  incidents: BrainIncidentInput[];
  maintenance: BrainMaintenanceInput[];
  jobs: BrainJobInput[];
  jobEvents: BrainJobEventInput[];
  trackingSummaries: BrainTrackingSummaryInput[];
  existingDedupeKeys?: Set<string>;
}

export interface DeterministicInsightCandidate extends ZappBrainInsightDraft {
  dedupeKey: string;
}

const SOURCE = "deterministic_v0";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MIN_REPEATED_DELAY_TRIPS = 2;
const MIN_REPEATED_ROUTE_SAMPLE = 2;
const MIN_DELAY_MINUTES = 5;
const HIGH_DELAY_MINUTES = 30;
const POOR_TELEMETRY_QUALITY_SCORE = 50;
const HIGH_REJECTED_POINT_RATIO = 0.25;
const MIN_TRACKING_POINTS_FOR_QUALITY_INSIGHT = 2;
const VEHICLE_RELIABILITY_SIGNAL_THRESHOLD = 2;
const HIGH_SIGNAL_COUNT = 4;

function parseDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function daysUntil(date: string, now: Date) {
  const timestamp = parseDateOnly(date);
  if (timestamp == null) return null;
  return Math.ceil(
    (timestamp - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / MS_PER_DAY,
  );
}

function candidate(input: {
  companyId: string;
  dedupeKey: string;
  category: ZappBrainCategory;
  severity: ZappBrainSeverity;
  title: string;
  explanation: string;
  recommendation: string;
  confidence: ZappBrainConfidence;
  evidence: JsonRecord;
  affected_entities: JsonRecord;
}): DeterministicInsightCandidate {
  return {
    company_id: input.companyId,
    category: input.category,
    severity: input.severity,
    title: input.title,
    explanation: input.explanation,
    evidence: {
      ...input.evidence,
      dedupe_key: input.dedupeKey,
      generated_by: SOURCE,
    },
    recommendation: `${input.recommendation} Recommendations require human review before action.`,
    confidence: input.confidence,
    affected_entities: input.affected_entities,
    status: "new",
    source: SOURCE,
    dedupeKey: input.dedupeKey,
  };
}

function countBy<T>(items: T[], key: (item: T) => string | null | undefined) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = key(item);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function addIfNew(
  insights: DeterministicInsightCandidate[],
  seen: Set<string>,
  item: DeterministicInsightCandidate,
) {
  if (seen.has(item.dedupeKey)) return;
  seen.add(item.dedupeKey);
  insights.push(item);
}

export function generateDeterministicBrainInsights(
  input: DeterministicBrainInput,
): DeterministicInsightCandidate[] {
  const insights: DeterministicInsightCandidate[] = [];
  const seen = new Set(input.existingDedupeKeys ?? []);
  const today = input.now.toISOString().slice(0, 10);

  for (const doc of input.documents) {
    if (!doc.expiry_date) continue;
    const days = daysUntil(doc.expiry_date, input.now);
    if (days == null) continue;
    if (days > input.documentExpiryWarningDays) continue;
    const expired = doc.expiry_date < today;
    addIfNew(
      insights,
      seen,
      candidate({
        companyId: input.companyId,
        dedupeKey: `document:${expired ? "expired" : "expiring"}:${doc.id}`,
        category: "system",
        severity: expired ? "high" : "medium",
        title: expired ? `Expired document: ${doc.name}` : `Document expiring soon: ${doc.name}`,
        explanation: expired
          ? `${doc.name} expired on ${doc.expiry_date}.`
          : `${doc.name} expires in ${days} day${days === 1 ? "" : "s"}.`,
        recommendation: "Review the document and update compliance records if required.",
        confidence: "high",
        evidence: {
          document_id: doc.id,
          owner_type: doc.owner_type,
          owner_id: doc.owner_id,
          expiry_date: doc.expiry_date,
          days_until_expiry: days,
        },
        affected_entities: { documents: [doc.id], [doc.owner_type]: [doc.owner_id] },
      }),
    );
  }

  for (const baseline of input.routeBaselines) {
    if (
      baseline.completed_trip_count < MIN_REPEATED_ROUTE_SAMPLE ||
      baseline.delayed_trip_count < MIN_REPEATED_DELAY_TRIPS ||
      (baseline.average_delay_minutes ?? 0) <= MIN_DELAY_MINUTES
    ) {
      continue;
    }
    addIfNew(
      insights,
      seen,
      candidate({
        companyId: input.companyId,
        dedupeKey: `route-delay:${baseline.route_key}`,
        category: "route_intelligence",
        severity: (baseline.average_delay_minutes ?? 0) >= HIGH_DELAY_MINUTES ? "high" : "medium",
        title: "Repeated route delay pattern",
        explanation: `Route has ${baseline.delayed_trip_count} delayed trips across ${baseline.completed_trip_count} completed trips.`,
        recommendation: "Review route history, customer timing, and dispatch assumptions.",
        confidence: baseline.confidence,
        evidence: {
          route_key: baseline.route_key,
          completed_trip_count: baseline.completed_trip_count,
          delayed_trip_count: baseline.delayed_trip_count,
          average_delay_minutes: baseline.average_delay_minutes,
          data_quality_score: baseline.data_quality_score,
        },
        affected_entities: {
          route_baselines: [baseline.id],
          customers: baseline.customer_id ? [baseline.customer_id] : [],
        },
      }),
    );
  }

  for (const record of input.routeRecords) {
    const observedPointCount = record.observed_point_count ?? null;
    const hasTinyTelemetrySample =
      observedPointCount != null && observedPointCount < MIN_TRACKING_POINTS_FOR_QUALITY_INSIGHT;
    if (
      record.data_quality_score >= POOR_TELEMETRY_QUALITY_SCORE &&
      record.confidence !== "insufficient_data"
    ) {
      continue;
    }
    if (hasTinyTelemetrySample && record.confidence !== "insufficient_data") continue;
    addIfNew(
      insights,
      seen,
      candidate({
        companyId: input.companyId,
        dedupeKey: `poor-telemetry:route-record:${record.id}`,
        category: "tracking",
        severity: "medium",
        title: "Poor telemetry quality on route record",
        explanation: `Route performance record has ${Math.round(record.data_quality_score)}% data quality.`,
        recommendation: "Review tracking coverage before relying on route performance metrics.",
        confidence:
          record.confidence === "insufficient_data" || hasTinyTelemetrySample ? "low" : "medium",
        evidence: {
          route_performance_record_id: record.id,
          job_id: record.job_id,
          data_quality_score: record.data_quality_score,
          confidence: record.confidence,
          observed_point_count: record.observed_point_count ?? null,
          accepted_point_count: record.accepted_point_count ?? null,
          rejected_point_count: record.rejected_point_count ?? null,
        },
        affected_entities: { jobs: [record.job_id], route_performance_records: [record.id] },
      }),
    );
  }

  for (const summary of input.trackingSummaries) {
    const rejectedRatio =
      summary.observed_point_count > 0
        ? summary.rejected_point_count / summary.observed_point_count
        : 0;
    if (summary.observed_point_count < MIN_TRACKING_POINTS_FOR_QUALITY_INSIGHT) continue;
    if (
      (summary.telemetry_quality_score ?? 100) >= POOR_TELEMETRY_QUALITY_SCORE &&
      rejectedRatio <= HIGH_REJECTED_POINT_RATIO
    ) {
      continue;
    }
    addIfNew(
      insights,
      seen,
      candidate({
        companyId: input.companyId,
        dedupeKey: `poor-telemetry:summary:${summary.tracking_session_id}`,
        category: "tracking",
        severity: "medium",
        title: "Poor telemetry quality on tracking session",
        explanation: `Tracking session has weak telemetry quality or elevated rejected points.`,
        recommendation:
          "Review GPS capture conditions and tracking data before operational conclusions.",
        confidence: "medium",
        evidence: {
          tracking_session_id: summary.tracking_session_id,
          observed_point_count: summary.observed_point_count,
          accepted_point_count: summary.accepted_point_count,
          rejected_point_count: summary.rejected_point_count,
          telemetry_quality_score: summary.telemetry_quality_score,
        },
        affected_entities: { tracking_sessions: [summary.tracking_session_id] },
      }),
    );
  }

  for (const incident of input.incidents) {
    if (incident.status === "resolved" || !["critical", "high"].includes(incident.severity)) {
      continue;
    }
    addIfNew(
      insights,
      seen,
      candidate({
        companyId: input.companyId,
        dedupeKey: `incident:${incident.id}`,
        category: "incident",
        severity: incident.severity,
        title: `${incident.severity === "critical" ? "Critical" : "High severity"} incident open`,
        explanation: incident.description,
        recommendation: "Review the incident and confirm the operational response.",
        confidence: "high",
        evidence: {
          incident_id: incident.id,
          status: incident.status,
          severity: incident.severity,
        },
        affected_entities: {
          incidents: [incident.id],
          vehicles: incident.vehicle_id ? [incident.vehicle_id] : [],
          drivers: incident.driver_id ? [incident.driver_id] : [],
        },
      }),
    );
  }

  for (const item of input.maintenance) {
    if (item.status === "completed") continue;
    const overdue = !!item.scheduled_date && item.scheduled_date < today;
    if (!overdue && !["reported", "in_progress"].includes(item.status)) continue;
    addIfNew(
      insights,
      seen,
      candidate({
        companyId: input.companyId,
        dedupeKey: `maintenance:${overdue ? "overdue" : "active"}:${item.id}`,
        category: "maintenance",
        severity: overdue ? "high" : "medium",
        title: overdue ? `Overdue maintenance: ${item.title}` : `Active maintenance: ${item.title}`,
        explanation: overdue
          ? `Maintenance was scheduled for ${item.scheduled_date}.`
          : `Maintenance is currently ${item.status}.`,
        recommendation: "Review vehicle availability and maintenance completion plan.",
        confidence: "high",
        evidence: {
          maintenance_id: item.id,
          status: item.status,
          scheduled_date: item.scheduled_date,
        },
        affected_entities: { maintenance: [item.id], vehicles: [item.vehicle_id] },
      }),
    );
  }

  for (const job of input.jobs) {
    if (job.status !== "failed") continue;
    const eventCount = input.jobEvents.filter((event) => event.job_id === job.id).length;
    addIfNew(
      insights,
      seen,
      candidate({
        companyId: input.companyId,
        dedupeKey: `failed-job:${job.id}`,
        category: "operations",
        severity: "high",
        title: `Failed job: ${job.reference}`,
        explanation: job.failure_reason || "Job is marked failed.",
        recommendation: "Review failure details and follow-up requirements.",
        confidence: "high",
        evidence: {
          job_id: job.id,
          reference: job.reference,
          failed_at: job.failed_at,
          failure_reason: job.failure_reason,
          job_event_count: eventCount,
        },
        affected_entities: {
          jobs: [job.id],
          customers: job.customer_id ? [job.customer_id] : [],
          vehicles: job.vehicle_id ? [job.vehicle_id] : [],
          drivers: job.driver_id ? [job.driver_id] : [],
        },
      }),
    );
  }

  const delayedByCustomer = countBy(
    input.routeRecords.filter((record) => (record.delay_minutes ?? 0) > MIN_DELAY_MINUTES),
    (record) => record.customer_id,
  );
  for (const [customerId, count] of delayedByCustomer) {
    if (count < MIN_REPEATED_DELAY_TRIPS) continue;
    addIfNew(
      insights,
      seen,
      candidate({
        companyId: input.companyId,
        dedupeKey: `customer-delay:${customerId}`,
        category: "customer",
        severity: count >= HIGH_SIGNAL_COUNT ? "high" : "medium",
        title: "Repeated delays associated with customer",
        explanation: `${count} delayed route performance records are associated with this customer.`,
        recommendation:
          "Review historical customer-associated timing, dispatch notes, and operational context.",
        confidence: "medium",
        evidence: { customer_id: customerId, delayed_record_count: count },
        affected_entities: { customers: [customerId] },
      }),
    );
  }

  const vehicleIds = new Set<string>();
  input.jobs.forEach((job) => {
    if (job.status === "failed" && job.vehicle_id) vehicleIds.add(job.vehicle_id);
  });
  input.maintenance.forEach((item) => {
    if (item.status !== "completed" && item.vehicle_id) vehicleIds.add(item.vehicle_id);
  });
  input.incidents.forEach((incident) => {
    if (incident.status !== "resolved" && incident.vehicle_id) vehicleIds.add(incident.vehicle_id);
  });
  for (const vehicleId of vehicleIds) {
    const failedJobCount = input.jobs.filter(
      (job) => job.status === "failed" && job.vehicle_id === vehicleId,
    ).length;
    const activeMaintenanceCount = input.maintenance.filter(
      (item) => item.status !== "completed" && item.vehicle_id === vehicleId,
    ).length;
    const openIncidentCount = input.incidents.filter(
      (incident) => incident.status !== "resolved" && incident.vehicle_id === vehicleId,
    ).length;
    const count = failedJobCount + activeMaintenanceCount + openIncidentCount;
    if (count < VEHICLE_RELIABILITY_SIGNAL_THRESHOLD) continue;
    addIfNew(
      insights,
      seen,
      candidate({
        companyId: input.companyId,
        dedupeKey: `vehicle-reliability:${vehicleId}`,
        category: "vehicle",
        severity: count >= HIGH_SIGNAL_COUNT ? "high" : "medium",
        title: "Repeated operational issues associated with vehicle",
        explanation: `${count} failed jobs, active maintenance items, or open incidents are associated with this vehicle.`,
        recommendation:
          "Review vehicle history and current operational context before making assignment decisions.",
        confidence: "medium",
        evidence: {
          vehicle_id: vehicleId,
          reliability_signal_count: count,
          failed_job_count: failedJobCount,
          active_maintenance_count: activeMaintenanceCount,
          open_incident_count: openIncidentCount,
          analysis_window: "current_open_records",
        },
        affected_entities: { vehicles: [vehicleId] },
      }),
    );
  }

  return insights;
}
