import { describe, expect, it } from "vitest";
import {
  generateDeterministicBrainInsights,
  type DeterministicBrainInput,
} from "@/lib/zapp-brain-integration";

const baseInput: DeterministicBrainInput = {
  companyId: "company-1",
  now: new Date("2026-07-08T12:00:00.000Z"),
  documentExpiryWarningDays: 30,
  documents: [],
  routeBaselines: [],
  routeRecords: [],
  incidents: [],
  maintenance: [],
  jobs: [],
  jobEvents: [],
  trackingSummaries: [],
};

describe("phase 8 deterministic brain v0", () => {
  it("generates an expired document insight", () => {
    const insights = generateDeterministicBrainInsights({
      ...baseInput,
      documents: [
        {
          id: "doc-1",
          company_id: "company-1",
          owner_type: "vehicle",
          owner_id: "vehicle-1",
          document_type: "registration",
          name: "Vehicle registration",
          expiry_date: "2026-07-01",
        },
      ],
    });

    expect(insights).toHaveLength(1);
    expect(insights[0]).toMatchObject({
      category: "system",
      severity: "high",
      source: "deterministic_v0",
      title: "Expired document: Vehicle registration",
    });
  });

  it("handles document expiry boundaries without timezone drift", () => {
    const insights = generateDeterministicBrainInsights({
      ...baseInput,
      documents: [
        {
          id: "today",
          company_id: "company-1",
          owner_type: "vehicle",
          owner_id: "vehicle-1",
          document_type: "registration",
          name: "Today document",
          expiry_date: "2026-07-08",
        },
        {
          id: "boundary",
          company_id: "company-1",
          owner_type: "vehicle",
          owner_id: "vehicle-1",
          document_type: "registration",
          name: "Boundary document",
          expiry_date: "2026-08-07",
        },
        {
          id: "outside",
          company_id: "company-1",
          owner_type: "vehicle",
          owner_id: "vehicle-1",
          document_type: "registration",
          name: "Outside document",
          expiry_date: "2026-08-08",
        },
        {
          id: "missing",
          company_id: "company-1",
          owner_type: "vehicle",
          owner_id: "vehicle-1",
          document_type: "registration",
          name: "Missing expiry",
          expiry_date: null,
        },
        {
          id: "bad",
          company_id: "company-1",
          owner_type: "vehicle",
          owner_id: "vehicle-1",
          document_type: "registration",
          name: "Bad expiry",
          expiry_date: "not-a-date",
        },
      ],
    });

    expect(insights.map((item) => item.dedupeKey)).toEqual([
      "document:expiring:today",
      "document:expiring:boundary",
    ]);
    expect(insights[0].evidence.days_until_expiry).toBe(0);
    expect(insights[1].evidence.days_until_expiry).toBe(30);
  });

  it("generates a repeated route delay insight", () => {
    const insights = generateDeterministicBrainInsights({
      ...baseInput,
      routeBaselines: [
        {
          id: "baseline-1",
          company_id: "company-1",
          route_key: "route-a",
          customer_id: "customer-1",
          pickup_location: "Depot",
          dropoff_location: "Store",
          completed_trip_count: 4,
          delayed_trip_count: 3,
          average_delay_minutes: 28,
          confidence: "medium",
          data_quality_score: 75,
        },
      ],
    });

    expect(insights[0].dedupeKey).toBe("route-delay:route-a");
    expect(insights[0].category).toBe("route_intelligence");
  });

  it("requires a repeated route delay sample before generating a route insight", () => {
    const insights = generateDeterministicBrainInsights({
      ...baseInput,
      routeBaselines: [
        {
          id: "baseline-1",
          company_id: "company-1",
          route_key: "route-a",
          customer_id: "customer-1",
          pickup_location: "Depot",
          dropoff_location: "Store",
          completed_trip_count: 1,
          delayed_trip_count: 1,
          average_delay_minutes: 45,
          confidence: "high",
          data_quality_score: 90,
        },
      ],
    });

    expect(insights).toHaveLength(0);
  });

  it("generates a poor telemetry insight", () => {
    const insights = generateDeterministicBrainInsights({
      ...baseInput,
      routeRecords: [
        {
          id: "record-1",
          company_id: "company-1",
          job_id: "job-1",
          customer_id: null,
          route_key: "route-a",
          delay_minutes: null,
          delay_events: [],
          data_quality_score: 35,
          confidence: "low",
        },
      ],
    });

    expect(insights[0]).toMatchObject({
      category: "tracking",
      severity: "medium",
      dedupeKey: "poor-telemetry:route-record:record-1",
      confidence: "medium",
    });
  });

  it("does not generate poor telemetry from a tiny non-insufficient sample", () => {
    const insights = generateDeterministicBrainInsights({
      ...baseInput,
      routeRecords: [
        {
          id: "record-1",
          company_id: "company-1",
          job_id: "job-1",
          customer_id: null,
          route_key: "route-a",
          delay_minutes: null,
          delay_events: [],
          observed_point_count: 1,
          accepted_point_count: 1,
          rejected_point_count: 0,
          data_quality_score: 35,
          confidence: "low",
        },
      ],
      trackingSummaries: [
        {
          tracking_session_id: "session-1",
          company_id: "company-1",
          observed_point_count: 1,
          accepted_point_count: 0,
          rejected_point_count: 1,
          telemetry_quality_score: 10,
        },
      ],
    });

    expect(insights).toHaveLength(0);
  });

  it("treats the poor telemetry threshold boundary deterministically", () => {
    const insights = generateDeterministicBrainInsights({
      ...baseInput,
      trackingSummaries: [
        {
          tracking_session_id: "strong-enough",
          company_id: "company-1",
          observed_point_count: 8,
          accepted_point_count: 6,
          rejected_point_count: 2,
          telemetry_quality_score: 50,
        },
        {
          tracking_session_id: "poor",
          company_id: "company-1",
          observed_point_count: 8,
          accepted_point_count: 5,
          rejected_point_count: 3,
          telemetry_quality_score: 49,
        },
      ],
    });

    expect(insights.map((item) => item.dedupeKey)).toEqual(["poor-telemetry:summary:poor"]);
  });

  it("generates an open critical incident insight", () => {
    const insights = generateDeterministicBrainInsights({
      ...baseInput,
      incidents: [
        {
          id: "incident-1",
          company_id: "company-1",
          severity: "critical",
          status: "open",
          vehicle_id: "vehicle-1",
          driver_id: null,
          description: "Breakdown on active delivery",
        },
      ],
    });

    expect(insights[0]).toMatchObject({
      category: "incident",
      severity: "critical",
      dedupeKey: "incident:incident-1",
    });
  });

  it("ignores resolved incidents", () => {
    const insights = generateDeterministicBrainInsights({
      ...baseInput,
      incidents: [
        {
          id: "incident-1",
          company_id: "company-1",
          severity: "critical",
          status: "resolved",
          vehicle_id: "vehicle-1",
          driver_id: null,
          description: "Resolved breakdown",
        },
      ],
    });

    expect(insights).toHaveLength(0);
  });

  it("generates an overdue maintenance insight", () => {
    const insights = generateDeterministicBrainInsights({
      ...baseInput,
      maintenance: [
        {
          id: "maintenance-1",
          company_id: "company-1",
          vehicle_id: "vehicle-1",
          status: "scheduled",
          title: "Brake inspection",
          scheduled_date: "2026-07-01",
        },
      ],
    });

    expect(insights[0]).toMatchObject({
      category: "maintenance",
      severity: "high",
      dedupeKey: "maintenance:overdue:maintenance-1",
    });
  });

  it("ignores completed maintenance and scheduled maintenance with no due date", () => {
    const insights = generateDeterministicBrainInsights({
      ...baseInput,
      maintenance: [
        {
          id: "completed",
          company_id: "company-1",
          vehicle_id: "vehicle-1",
          status: "completed",
          title: "Brake inspection",
          scheduled_date: "2026-07-01",
        },
        {
          id: "missing-date",
          company_id: "company-1",
          vehicle_id: "vehicle-1",
          status: "scheduled",
          title: "Tyres",
          scheduled_date: null,
        },
      ],
    });

    expect(insights).toHaveLength(0);
  });

  it("generates failed job insights but not cancelled job insights", () => {
    const insights = generateDeterministicBrainInsights({
      ...baseInput,
      jobs: [
        {
          id: "job-1",
          company_id: "company-1",
          reference: "JOB-1",
          customer_id: null,
          vehicle_id: null,
          driver_id: null,
          status: "cancelled",
          scheduled_at: null,
          failed_at: null,
          failure_reason: null,
        },
        {
          id: "job-2",
          company_id: "company-1",
          reference: "JOB-2",
          customer_id: null,
          vehicle_id: null,
          driver_id: null,
          status: "failed",
          scheduled_at: null,
          failed_at: "2026-07-08T10:00:00.000Z",
          failure_reason: "Customer unavailable",
        },
      ],
    });

    expect(insights.map((item) => item.dedupeKey)).toEqual(["failed-job:job-2"]);
  });

  it("uses association wording for repeated customer delays", () => {
    const insights = generateDeterministicBrainInsights({
      ...baseInput,
      routeRecords: [
        {
          id: "record-1",
          company_id: "company-1",
          job_id: "job-1",
          customer_id: "customer-1",
          route_key: "route-a",
          delay_minutes: 12,
          delay_events: [],
          data_quality_score: 90,
          confidence: "high",
        },
        {
          id: "record-2",
          company_id: "company-1",
          job_id: "job-2",
          customer_id: "customer-1",
          route_key: "route-a",
          delay_minutes: 16,
          delay_events: [],
          data_quality_score: 90,
          confidence: "high",
        },
      ],
    });

    const customerInsight = insights.find((item) => item.dedupeKey === "customer-delay:customer-1");
    expect(customerInsight?.title).toBe("Repeated delays associated with customer");
    expect(customerInsight?.explanation).toContain("associated with this customer");
    expect(customerInsight?.recommendation).not.toContain("caused");
  });

  it("requires multiple vehicle-associated signals before vehicle attention insight", () => {
    const oneSignal = generateDeterministicBrainInsights({
      ...baseInput,
      jobs: [
        {
          id: "job-1",
          company_id: "company-1",
          reference: "JOB-1",
          customer_id: null,
          vehicle_id: "vehicle-1",
          driver_id: null,
          status: "failed",
          scheduled_at: null,
          failed_at: "2026-07-08T10:00:00.000Z",
          failure_reason: null,
        },
      ],
    });
    const twoSignals = generateDeterministicBrainInsights({
      ...baseInput,
      jobs: [
        {
          id: "job-1",
          company_id: "company-1",
          reference: "JOB-1",
          customer_id: null,
          vehicle_id: "vehicle-1",
          driver_id: null,
          status: "failed",
          scheduled_at: null,
          failed_at: "2026-07-08T10:00:00.000Z",
          failure_reason: null,
        },
      ],
      maintenance: [
        {
          id: "maintenance-1",
          company_id: "company-1",
          vehicle_id: "vehicle-1",
          status: "reported",
          title: "Reported issue",
          scheduled_date: null,
        },
      ],
    });

    expect(
      oneSignal.find((item) => item.dedupeKey === "vehicle-reliability:vehicle-1"),
    ).toBeUndefined();
    expect(
      twoSignals.find((item) => item.dedupeKey === "vehicle-reliability:vehicle-1"),
    ).toMatchObject({
      title: "Repeated operational issues associated with vehicle",
      evidence: {
        failed_job_count: 1,
        active_maintenance_count: 1,
        open_incident_count: 0,
        analysis_window: "current_open_records",
      },
    });
  });

  it("prevents duplicate insights by existing dedupe key", () => {
    const insights = generateDeterministicBrainInsights({
      ...baseInput,
      existingDedupeKeys: new Set(["failed-job:job-1"]),
      jobs: [
        {
          id: "job-1",
          company_id: "company-1",
          reference: "JOB-1",
          customer_id: null,
          vehicle_id: null,
          driver_id: null,
          status: "failed",
          scheduled_at: null,
          failed_at: "2026-07-08T10:00:00.000Z",
          failure_reason: "Customer unavailable",
        },
      ],
    });

    expect(insights).toHaveLength(0);
  });

  it("allows a condition to be generated again when the caller does not supply an active duplicate key", () => {
    const job = {
      id: "job-1",
      company_id: "company-1",
      reference: "JOB-1",
      customer_id: null,
      vehicle_id: null,
      driver_id: null,
      status: "failed",
      scheduled_at: null,
      failed_at: "2026-07-08T10:00:00.000Z",
      failure_reason: "Customer unavailable",
    };

    expect(
      generateDeterministicBrainInsights({
        ...baseInput,
        existingDedupeKeys: new Set(["failed-job:job-1"]),
        jobs: [job],
      }),
    ).toHaveLength(0);
    expect(generateDeterministicBrainInsights({ ...baseInput, jobs: [job] })).toHaveLength(1);
  });
});
