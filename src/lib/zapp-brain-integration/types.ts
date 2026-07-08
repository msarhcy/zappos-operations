export const ZAPP_BRAIN_CATEGORIES = [
  "operations",
  "dispatch",
  "route_intelligence",
  "tracking",
  "customer",
  "vehicle",
  "driver",
  "maintenance",
  "incident",
  "system",
] as const;

export const ZAPP_BRAIN_SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;

export const ZAPP_BRAIN_CONFIDENCE_LEVELS = ["high", "medium", "low", "insufficient_data"] as const;

export const ZAPP_BRAIN_INSIGHT_STATUSES = [
  "new",
  "reviewing",
  "resolved",
  "needs_follow_up",
  "dismissed",
] as const;

export const ZAPP_BRAIN_FEEDBACK_MARKS = [
  "useful",
  "not_useful",
  "correct",
  "false_alarm",
  "resolved",
  "needs_follow_up",
] as const;

export const ZAPP_BRAIN_REASON_LABELS = [
  "traffic",
  "customer_delay",
  "loading_delay",
  "unloading_delay",
  "vehicle_issue",
  "driver_issue",
  "wrong_route",
  "bad_data",
  "system_error",
  "unknown",
] as const;

export type ZappBrainCategory = (typeof ZAPP_BRAIN_CATEGORIES)[number];
export type ZappBrainSeverity = (typeof ZAPP_BRAIN_SEVERITIES)[number];
export type ZappBrainConfidence = (typeof ZAPP_BRAIN_CONFIDENCE_LEVELS)[number];
export type ZappBrainInsightStatus = (typeof ZAPP_BRAIN_INSIGHT_STATUSES)[number];
export type ZappBrainFeedbackMark = (typeof ZAPP_BRAIN_FEEDBACK_MARKS)[number];
export type ZappBrainReasonLabel = (typeof ZAPP_BRAIN_REASON_LABELS)[number];

export type JsonRecord = Record<string, unknown>;

export interface ZappBrainInsight {
  id: string;
  company_id: string;
  category: ZappBrainCategory;
  severity: ZappBrainSeverity;
  title: string;
  explanation: string | null;
  evidence: JsonRecord;
  recommendation: string | null;
  confidence: ZappBrainConfidence;
  affected_entities: JsonRecord;
  status: ZappBrainInsightStatus;
  source: string;
  created_at: string;
}

export interface ZappBrainInsightDraft {
  company_id: string;
  category: ZappBrainCategory;
  severity: ZappBrainSeverity;
  title: string;
  explanation?: string | null;
  evidence?: JsonRecord;
  recommendation?: string | null;
  confidence: ZappBrainConfidence;
  affected_entities?: JsonRecord;
  status?: ZappBrainInsightStatus;
  source?: string;
}

export interface ZappBrainInsightFilters {
  category?: ZappBrainCategory | "all";
  severity?: ZappBrainSeverity | "all";
  status?: ZappBrainInsightStatus | "all";
  confidence?: ZappBrainConfidence | "all";
}

export interface ZappBrainFeedbackInput {
  companyId: string;
  insightId: string;
  feedback: ZappBrainFeedbackMark;
  reasonLabel?: ZappBrainReasonLabel;
  note?: string | null;
}

export interface ZappBrainFeedbackInsert {
  company_id: string;
  insight_id: string;
  feedback: ZappBrainFeedbackMark;
  reason_label: ZappBrainReasonLabel;
  note: string | null;
}
