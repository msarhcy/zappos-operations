export * from "./types";

import {
  ZAPP_BRAIN_CATEGORIES,
  ZAPP_BRAIN_CONFIDENCE_LEVELS,
  ZAPP_BRAIN_FEEDBACK_MARKS,
  ZAPP_BRAIN_INSIGHT_STATUSES,
  ZAPP_BRAIN_REASON_LABELS,
  ZAPP_BRAIN_SEVERITIES,
  type JsonRecord,
  type ZappBrainCategory,
  type ZappBrainConfidence,
  type ZappBrainFeedbackInput,
  type ZappBrainFeedbackInsert,
  type ZappBrainFeedbackMark,
  type ZappBrainInsight,
  type ZappBrainInsightDraft,
  type ZappBrainInsightFilters,
  type ZappBrainInsightStatus,
  type ZappBrainReasonLabel,
  type ZappBrainSeverity,
} from "./types";

const SEVERITY_WEIGHT: Record<ZappBrainSeverity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

const STATUS_AFTER_FEEDBACK: Partial<Record<ZappBrainFeedbackMark, ZappBrainInsightStatus>> = {
  resolved: "resolved",
  needs_follow_up: "needs_follow_up",
  false_alarm: "dismissed",
};

function includesValue<const T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

export function confidenceLabel(confidence: ZappBrainConfidence) {
  switch (confidence) {
    case "high":
      return "High confidence";
    case "medium":
      return "Medium confidence";
    case "low":
      return "Low confidence";
    case "insufficient_data":
      return "Insufficient data";
  }
}

export function compareInsightsBySeverity(a: ZappBrainInsight, b: ZappBrainInsight) {
  const severityDelta = SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity];
  if (severityDelta !== 0) return severityDelta;
  return Date.parse(b.created_at) - Date.parse(a.created_at);
}

export function filterInsights(insights: ZappBrainInsight[], filters: ZappBrainInsightFilters) {
  return insights.filter((insight) => {
    if (filters.category && filters.category !== "all" && insight.category !== filters.category) {
      return false;
    }
    if (filters.severity && filters.severity !== "all" && insight.severity !== filters.severity) {
      return false;
    }
    if (filters.status && filters.status !== "all" && insight.status !== filters.status) {
      return false;
    }
    if (
      filters.confidence &&
      filters.confidence !== "all" &&
      insight.confidence !== filters.confidence
    ) {
      return false;
    }
    return true;
  });
}

export function createFeedbackInsert(input: ZappBrainFeedbackInput): ZappBrainFeedbackInsert {
  return {
    company_id: input.companyId,
    insight_id: input.insightId,
    feedback: input.feedback,
    reason_label: input.reasonLabel ?? "unknown",
    note: input.note?.trim() || null,
  };
}

export function statusAfterFeedback(feedback: ZappBrainFeedbackMark) {
  return STATUS_AFTER_FEEDBACK[feedback] ?? null;
}

export function normalizeFutureZappBrainInsight(
  input: Record<string, unknown>,
  companyId: string,
): ZappBrainInsightDraft {
  const category = includesValue(ZAPP_BRAIN_CATEGORIES, input.category)
    ? input.category
    : "operations";
  const severity = includesValue(ZAPP_BRAIN_SEVERITIES, input.severity) ? input.severity : "info";
  const confidence = includesValue(ZAPP_BRAIN_CONFIDENCE_LEVELS, input.confidence)
    ? input.confidence
    : "insufficient_data";
  const status = includesValue(ZAPP_BRAIN_INSIGHT_STATUSES, input.status) ? input.status : "new";
  const source =
    typeof input.source === "string" && input.source.trim() ? input.source.trim() : "zapp_brain";

  return {
    company_id: companyId,
    category,
    severity,
    title:
      typeof input.title === "string" && input.title.trim()
        ? input.title.trim()
        : "Untitled insight",
    explanation: typeof input.explanation === "string" ? input.explanation : null,
    evidence: asRecord(input.evidence),
    recommendation: typeof input.recommendation === "string" ? input.recommendation : null,
    confidence,
    affected_entities: asRecord(input.affected_entities),
    status,
    source,
  };
}

export function isFeedbackMark(value: unknown): value is ZappBrainFeedbackMark {
  return includesValue(ZAPP_BRAIN_FEEDBACK_MARKS, value);
}

export function isReasonLabel(value: unknown): value is ZappBrainReasonLabel {
  return includesValue(ZAPP_BRAIN_REASON_LABELS, value);
}
