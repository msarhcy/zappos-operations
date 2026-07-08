import { describe, expect, it } from "vitest";
import {
  compareInsightsBySeverity,
  confidenceLabel,
  createFeedbackInsert,
  filterInsights,
  normalizeFutureZappBrainInsight,
  statusAfterFeedback,
  type ZappBrainInsight,
} from "@/lib/zapp-brain-integration";

function insight(overrides: Partial<ZappBrainInsight>): ZappBrainInsight {
  return {
    id: "insight-1",
    company_id: "company-1",
    category: "operations",
    severity: "medium",
    title: "Test insight",
    explanation: null,
    evidence: {},
    recommendation: null,
    confidence: "medium",
    affected_entities: {},
    status: "new",
    source: "zapp_brain",
    created_at: "2026-07-08T10:00:00.000Z",
    ...overrides,
  };
}

describe("phase 7 insight status handling", () => {
  it("maps feedback actions to review statuses without prediction logic", () => {
    expect(statusAfterFeedback("resolved")).toBe("resolved");
    expect(statusAfterFeedback("needs_follow_up")).toBe("needs_follow_up");
    expect(statusAfterFeedback("false_alarm")).toBe("dismissed");
    expect(statusAfterFeedback("useful")).toBeNull();
  });
});

describe("phase 7 severity sorting", () => {
  it("sorts critical insights ahead of lower severity insights", () => {
    const sorted = [
      insight({ id: "low", severity: "low" }),
      insight({ id: "critical", severity: "critical" }),
      insight({ id: "high", severity: "high" }),
    ].sort(compareInsightsBySeverity);

    expect(sorted.map((item) => item.id)).toEqual(["critical", "high", "low"]);
  });

  it("uses newest insight first when severity matches", () => {
    const sorted = [
      insight({ id: "old", severity: "high", created_at: "2026-07-08T09:00:00.000Z" }),
      insight({ id: "new", severity: "high", created_at: "2026-07-08T11:00:00.000Z" }),
    ].sort(compareInsightsBySeverity);

    expect(sorted[0].id).toBe("new");
  });
});

describe("phase 7 feedback creation", () => {
  it("creates scoped feedback insert payloads with default reason label", () => {
    expect(
      createFeedbackInsert({
        companyId: "company-1",
        insightId: "insight-1",
        feedback: "useful",
        note: "  useful context ",
      }),
    ).toEqual({
      company_id: "company-1",
      insight_id: "insight-1",
      feedback: "useful",
      reason_label: "unknown",
      note: "useful context",
    });
  });
});

describe("phase 7 confidence labels", () => {
  it("labels insufficient data separately from low confidence", () => {
    expect(confidenceLabel("insufficient_data")).toBe("Insufficient data");
    expect(confidenceLabel("low")).toBe("Low confidence");
  });
});

describe("phase 7 category filters", () => {
  it("filters by category, severity, status, and confidence", () => {
    const insights = [
      insight({ id: "traffic", category: "route_intelligence", severity: "high" }),
      insight({ id: "driver", category: "driver", severity: "high" }),
      insight({ id: "resolved", category: "route_intelligence", status: "resolved" }),
    ];

    expect(
      filterInsights(insights, {
        category: "route_intelligence",
        severity: "high",
        status: "new",
        confidence: "medium",
      }).map((item) => item.id),
    ).toEqual(["traffic"]);
  });
});

describe("phase 7 future adapter boundary", () => {
  it("normalizes future output into the storage contract without calling AI", () => {
    const normalized = normalizeFutureZappBrainInsight(
      {
        category: "unknown_category",
        severity: "critical",
        title: "  Late customer route ",
        evidence: { route: "A" },
      },
      "company-1",
    );

    expect(normalized).toMatchObject({
      company_id: "company-1",
      category: "operations",
      severity: "critical",
      title: "Late customer route",
      confidence: "insufficient_data",
      evidence: { route: "A" },
    });
  });
});
