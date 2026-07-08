import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  ClipboardCheck,
  MessageSquare,
  PlayCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/operational-state";
import { StatusBadge } from "@/components/ui/status-badge-detailed";
import {
  ZAPP_BRAIN_CATEGORIES,
  ZAPP_BRAIN_CONFIDENCE_LEVELS,
  ZAPP_BRAIN_FEEDBACK_MARKS,
  ZAPP_BRAIN_INSIGHT_STATUSES,
  ZAPP_BRAIN_REASON_LABELS,
  compareInsightsBySeverity,
  confidenceLabel,
  createFeedbackInsert,
  filterInsights,
  generateDeterministicBrainInsights,
  statusAfterFeedback,
  type BrainDocumentInput,
  type BrainIncidentInput,
  type BrainJobEventInput,
  type BrainJobInput,
  type BrainMaintenanceInput,
  type BrainRouteBaselineInput,
  type BrainRouteRecordInput,
  type BrainTrackingSummaryInput,
  type ZappBrainCategory,
  type ZappBrainConfidence,
  type ZappBrainFeedbackMark,
  type ZappBrainInsight,
  type ZappBrainInsightFilters,
  type ZappBrainInsightStatus,
  type ZappBrainReasonLabel,
} from "@/lib/zapp-brain-integration";

export const Route = createFileRoute("/_authenticated/brain")({
  head: () => ({ meta: [{ title: "Zapp Brain — ZappOS" }] }),
  component: BrainPage,
});

type QueryResult = PromiseLike<{ data: unknown[] | null; error: Error | null }>;

type FilterBuilder = QueryResult & {
  eq: (column: string, value: unknown) => FilterBuilder;
  order: (column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => FilterBuilder;
  limit: (count: number) => QueryResult;
};

type UpdateBuilder = QueryResult & {
  eq: (column: string, value: unknown) => UpdateBuilder;
};

type BrainSupabase = {
  from: (table: string) => {
    select: (columns?: string) => FilterBuilder;
    insert: (values: object | object[]) => QueryResult;
    update: (values: object) => UpdateBuilder;
  };
};

interface BrainRunRow {
  id: string;
  company_id: string;
  source: string;
  status: string;
  output_summary: Record<string, unknown>;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  generated_insight_count: number | null;
  stale_insight_count: number | null;
  created_at: string;
}

interface ExistingDeterministicInsightRow {
  id: string;
  evidence?: Record<string, unknown>;
  status: ZappBrainInsightStatus;
}

const ACTIVE_DEDUPE_STATUSES: ZappBrainInsightStatus[] = ["new", "reviewing", "needs_follow_up"];
const AUTO_STALE_STATUSES: ZappBrainInsightStatus[] = ["new", "reviewing"];

function brainDb() {
  return supabase as unknown as BrainSupabase;
}

function label(value: string) {
  return value.replaceAll("_", " ");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function safeJsonText(value: unknown) {
  try {
    return JSON.stringify(value ?? {}, null, 2) ?? "{}";
  } catch {
    return "{}";
  }
}

function dedupeKeyFromInsight(row: ExistingDeterministicInsightRow) {
  return typeof row.evidence?.dedupe_key === "string" ? row.evidence.dedupe_key : null;
}

function JsonViewer({ value }: { value: unknown }) {
  return (
    <pre className="max-h-64 overflow-auto rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed">
      {safeJsonText(value)}
    </pre>
  );
}

function BrainPage() {
  const { activeCompany, hasAnyRole } = useCompany();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runningAnalysis, setRunningAnalysis] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insights, setInsights] = useState<ZappBrainInsight[]>([]);
  const [lastRun, setLastRun] = useState<BrainRunRow | null>(null);
  const [lastGeneratedCount, setLastGeneratedCount] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState<ZappBrainInsightFilters>({
    category: "all",
    severity: "all",
    status: "all",
    confidence: "all",
  });
  const [reasonLabel, setReasonLabel] = useState<ZappBrainReasonLabel>("unknown");

  const activeCompanyId = activeCompany?.id;
  const canRead = hasAnyRole(["admin", "fleet_manager", "dispatcher", "viewer"]);
  const canReview = hasAnyRole(["admin", "fleet_manager", "dispatcher"]);

  const load = useCallback(async () => {
    if (!activeCompanyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [insightResult, runResult] = await Promise.all([
        brainDb()
          .from("zapp_brain_insights")
          .select("*")
          .eq("company_id", activeCompanyId)
          .order("created_at", { ascending: false })
          .limit(100),
        brainDb()
          .from("zapp_brain_runs")
          .select("*")
          .eq("company_id", activeCompanyId)
          .order("created_at", { ascending: false })
          .limit(1),
      ]);
      if (insightResult.error) throw insightResult.error;
      if (runResult.error) throw runResult.error;
      const rows = (insightResult.data ?? []) as ZappBrainInsight[];
      setInsights(rows);
      setLastRun(((runResult.data ?? []) as BrainRunRow[])[0] ?? null);
      setSelectedId((current) => current ?? rows[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Zapp Brain insights");
    } finally {
      setLoading(false);
    }
  }, [activeCompanyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredInsights = useMemo(
    () => [...filterInsights(insights, filters)].sort(compareInsightsBySeverity),
    [filters, insights],
  );

  const selected =
    filteredInsights.find((insight) => insight.id === selectedId) ?? filteredInsights[0] ?? null;

  const openUrgentCount = insights.filter(
    (insight) =>
      ["critical", "high"].includes(insight.severity) &&
      ["new", "reviewing", "needs_follow_up"].includes(insight.status),
  ).length;

  const submitFeedback = async (feedback: ZappBrainFeedbackMark) => {
    if (!selected || !activeCompanyId || !canReview) return;
    setSaving(true);
    setError(null);
    try {
      const insertPayload = createFeedbackInsert({
        companyId: activeCompanyId,
        insightId: selected.id,
        feedback,
        reasonLabel,
      });
      const feedbackResult = await brainDb().from("zapp_brain_feedback").insert(insertPayload);
      if (feedbackResult.error) throw feedbackResult.error;

      const nextStatus = statusAfterFeedback(feedback);
      if (nextStatus) {
        const updateResult = await brainDb()
          .from("zapp_brain_insights")
          .update({ status: nextStatus })
          .eq("id", selected.id)
          .eq("company_id", activeCompanyId);
        if (updateResult.error) throw updateResult.error;
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save feedback");
    } finally {
      setSaving(false);
    }
  };

  const runAnalysis = async () => {
    if (!activeCompanyId || !activeCompany || !canReview) return;
    const runId = crypto.randomUUID();
    setRunningAnalysis(true);
    setLastGeneratedCount(null);
    setError(null);
    try {
      const runInsert = await brainDb()
        .from("zapp_brain_runs")
        .insert({
          id: runId,
          company_id: activeCompanyId,
          source: "deterministic_v0",
          status: "running",
          started_at: new Date().toISOString(),
          input_summary: { mode: "deterministic_v0" },
        });
      if (runInsert.error) throw runInsert.error;

      const [
        documentResult,
        routeBaselineResult,
        routeRecordResult,
        incidentResult,
        maintenanceResult,
        jobResult,
        jobEventResult,
        trackingSummaryResult,
        existingInsightResult,
      ] = await Promise.all([
        brainDb().from("documents").select("*").eq("company_id", activeCompanyId).limit(500),
        brainDb()
          .from("route_segment_baselines")
          .select("*")
          .eq("company_id", activeCompanyId)
          .limit(500),
        brainDb()
          .from("route_performance_records")
          .select("*")
          .eq("company_id", activeCompanyId)
          .limit(1000),
        brainDb().from("incidents").select("*").eq("company_id", activeCompanyId).limit(500),
        brainDb().from("maintenance").select("*").eq("company_id", activeCompanyId).limit(500),
        brainDb().from("jobs").select("*").eq("company_id", activeCompanyId).limit(1000),
        brainDb().from("job_events").select("*").eq("company_id", activeCompanyId).limit(1000),
        brainDb()
          .from("tracking_summaries")
          .select("*")
          .eq("company_id", activeCompanyId)
          .limit(1000),
        brainDb()
          .from("zapp_brain_insights")
          .select("id,evidence,status,source")
          .eq("company_id", activeCompanyId)
          .eq("source", "deterministic_v0")
          .limit(1000),
      ]);

      for (const result of [
        documentResult,
        routeBaselineResult,
        routeRecordResult,
        incidentResult,
        maintenanceResult,
        jobResult,
        jobEventResult,
        trackingSummaryResult,
        existingInsightResult,
      ]) {
        if (result.error) throw result.error;
      }

      const existingRows = (existingInsightResult.data ?? []) as ExistingDeterministicInsightRow[];
      const activeDedupeKeys = new Set(
        existingRows
          .filter((row) => ACTIVE_DEDUPE_STATUSES.includes(row.status))
          .map(dedupeKeyFromInsight)
          .filter((value): value is string => typeof value === "string"),
      );

      const input = {
        companyId: activeCompanyId,
        now: new Date(),
        documentExpiryWarningDays: activeCompany.document_expiry_warning_days ?? 30,
        documents: (documentResult.data ?? []) as BrainDocumentInput[],
        routeBaselines: (routeBaselineResult.data ?? []) as BrainRouteBaselineInput[],
        routeRecords: (routeRecordResult.data ?? []) as BrainRouteRecordInput[],
        incidents: (incidentResult.data ?? []) as BrainIncidentInput[],
        maintenance: (maintenanceResult.data ?? []) as BrainMaintenanceInput[],
        jobs: (jobResult.data ?? []) as BrainJobInput[],
        jobEvents: (jobEventResult.data ?? []) as BrainJobEventInput[],
        trackingSummaries: (trackingSummaryResult.data ?? []) as BrainTrackingSummaryInput[],
      };
      const currentCandidates = generateDeterministicBrainInsights(input);
      const currentDedupeKeys = new Set(currentCandidates.map((item) => item.dedupeKey));
      const generated = generateDeterministicBrainInsights({
        ...input,
        existingDedupeKeys: activeDedupeKeys,
      });

      const staleRows = existingRows.filter((row) => {
        const key = dedupeKeyFromInsight(row);
        return (
          key != null && AUTO_STALE_STATUSES.includes(row.status) && !currentDedupeKeys.has(key)
        );
      });

      if (generated.length > 0) {
        const insightInsert = await brainDb()
          .from("zapp_brain_insights")
          .insert(
            generated.map(({ dedupeKey: _dedupeKey, ...insight }) => ({
              ...insight,
              run_id: runId,
            })),
          );
        if (insightInsert.error) throw insightInsert.error;
      }

      for (const staleRow of staleRows) {
        const staleUpdate = await brainDb()
          .from("zapp_brain_insights")
          .update({ status: "dismissed" })
          .eq("id", staleRow.id)
          .eq("company_id", activeCompanyId);
        if (staleUpdate.error) throw staleUpdate.error;
      }

      const learningInsert = await brainDb()
        .from("zapp_brain_learning_records")
        .insert({
          company_id: activeCompanyId,
          learning_type: "review_note",
          label: "deterministic_v0_run",
          payload: {
            generated_count: generated.length,
            skipped_active_existing_count: activeDedupeKeys.size,
            stale_dismissed_count: staleRows.length,
            advisory_only: true,
          },
        });
      if (learningInsert.error) throw learningInsert.error;

      const runUpdate = await brainDb()
        .from("zapp_brain_runs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          generated_insight_count: generated.length,
          stale_insight_count: staleRows.length,
          output_summary: {
            generated_count: generated.length,
            stale_dismissed_count: staleRows.length,
            advisory_only: true,
            source: "deterministic_v0",
          },
        })
        .eq("id", runId)
        .eq("company_id", activeCompanyId);
      if (runUpdate.error) throw runUpdate.error;
      setLastGeneratedCount(generated.length);
      await load();
    } catch (err) {
      await brainDb()
        .from("zapp_brain_runs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: "Deterministic analysis failed",
        })
        .eq("id", runId)
        .eq("company_id", activeCompanyId);
      setError(err instanceof Error ? err.message : "Could not run deterministic analysis");
    } finally {
      setRunningAnalysis(false);
    }
  };

  if (!canRead) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
        <ErrorState
          title="Zapp Brain is restricted"
          description="Your current role cannot view fleet-wide insight review."
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
        <LoadingState label="Loading Zapp Brain insights" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Integration shell
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Zapp Brain</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Review advisory insights from stored ZappOS data. Deterministic v0 analysis does not run
            AI, predict outcomes, control dispatch, edit jobs, or automate driver discipline.
            Recommendations require human review before action.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {canReview ? (
            <Button onClick={() => void runAnalysis()} disabled={runningAnalysis} className="gap-2">
              <PlayCircle className="h-4 w-4" />
              {runningAnalysis ? "Running analysis" : "Run Brain Analysis"}
            </Button>
          ) : null}
          <Card className="min-w-44 p-4">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Urgent open
            </div>
            <div className="mt-1 text-3xl font-semibold">{openUrgentCount}</div>
          </Card>
        </div>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <Field
            label="Last run"
            value={
              lastRun
                ? formatDate(lastRun.completed_at ?? lastRun.started_at ?? lastRun.created_at)
                : "-"
            }
          />
          <Field label="Run status" value={lastRun?.status ? label(lastRun.status) : "-"} />
          <Field
            label="Generated insights"
            value={
              lastGeneratedCount != null
                ? String(lastGeneratedCount)
                : typeof lastRun?.generated_insight_count === "number"
                  ? String(lastRun.generated_insight_count)
                  : typeof lastRun?.output_summary?.generated_count === "number"
                    ? String(lastRun.output_summary.generated_count)
                    : "-"
            }
          />
        </div>
      </Card>

      {error ? <ErrorState title="Zapp Brain unavailable" description={error} /> : null}

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FilterSelect
            label="Category"
            value={filters.category ?? "all"}
            values={["all", ...ZAPP_BRAIN_CATEGORIES]}
            onChange={(value) =>
              setFilters((current) => ({
                ...current,
                category: value as ZappBrainCategory | "all",
              }))
            }
          />
          <FilterSelect
            label="Severity"
            value={filters.severity ?? "all"}
            values={["all", "critical", "high", "medium", "low", "info"]}
            onChange={(value) =>
              setFilters((current) => ({
                ...current,
                severity: value as "all" | ZappBrainInsight["severity"],
              }))
            }
          />
          <FilterSelect
            label="Status"
            value={filters.status ?? "all"}
            values={["all", ...ZAPP_BRAIN_INSIGHT_STATUSES]}
            onChange={(value) =>
              setFilters((current) => ({
                ...current,
                status: value as ZappBrainInsightStatus | "all",
              }))
            }
          />
          <FilterSelect
            label="Confidence"
            value={filters.confidence ?? "all"}
            values={["all", ...ZAPP_BRAIN_CONFIDENCE_LEVELS]}
            onChange={(value) =>
              setFilters((current) => ({
                ...current,
                confidence: value as ZappBrainConfidence | "all",
              }))
            }
          />
        </div>
      </Card>

      {insights.length === 0 ? (
        <Card className="p-4">
          <EmptyState
            title="No Zapp Brain insights yet"
            description="Future imported insights will appear here for human review and feedback."
            icon={BrainCircuit}
          />
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <Card className="overflow-hidden">
            <div className="border-b border-border p-4">
              <h2 className="text-lg font-semibold">Insight inbox</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {filteredInsights.length} visible of {insights.length} stored insights.
              </p>
            </div>
            <div className="max-h-[680px] divide-y divide-border overflow-auto">
              {filteredInsights.map((insight) => (
                <button
                  key={insight.id}
                  type="button"
                  onClick={() => setSelectedId(insight.id)}
                  className={`block w-full px-4 py-3 text-left transition-colors ${
                    selected?.id === insight.id ? "bg-primary/10" : "hover:bg-muted/50"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{insight.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {label(insight.category)} · {formatDate(insight.created_at)}
                      </p>
                    </div>
                    <StatusBadge status={insight.severity} variant="small" />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <StatusBadge status={insight.status} variant="small" />
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      {confidenceLabel(insight.confidence)}
                    </span>
                  </div>
                </button>
              ))}
              {filteredInsights.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">
                  No insights match the selected filters.
                </div>
              ) : null}
            </div>
          </Card>

          <Card className="p-4">
            {selected ? (
              <div className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge status={selected.severity} variant="small" />
                      <StatusBadge status={selected.status} variant="small" />
                    </div>
                    <h2 className="mt-3 text-xl font-semibold">{selected.title}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {label(selected.category)} · {confidenceLabel(selected.confidence)} ·{" "}
                      {selected.source}
                    </p>
                  </div>
                  <BrainCircuit className="h-6 w-6 text-muted-foreground" />
                </div>

                <DetailSection icon={AlertTriangle} title="Explanation">
                  <p className="text-sm text-foreground">
                    {selected.explanation || "No explanation supplied."}
                  </p>
                </DetailSection>

                <DetailSection icon={ClipboardCheck} title="Recommendation">
                  <p className="text-sm text-foreground">
                    {selected.recommendation || "No recommendation supplied."}
                  </p>
                </DetailSection>

                <DetailSection icon={MessageSquare} title="Evidence">
                  <JsonViewer value={selected.evidence} />
                </DetailSection>

                <DetailSection icon={CheckCircle2} title="Affected entities">
                  <JsonViewer value={selected.affected_entities} />
                </DetailSection>

                {canReview ? (
                  <div className="rounded-md border border-border p-3">
                    <div className="mb-3 grid gap-3 sm:grid-cols-[180px_1fr]">
                      <FilterSelect
                        label="Reason"
                        value={reasonLabel}
                        values={ZAPP_BRAIN_REASON_LABELS}
                        onChange={(value) => setReasonLabel(value as ZappBrainReasonLabel)}
                      />
                      <div>
                        <p className="text-xs text-muted-foreground">Review actions</p>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {ZAPP_BRAIN_FEEDBACK_MARKS.map((feedback) => (
                            <Button
                              key={feedback}
                              type="button"
                              size="sm"
                              variant={feedback === "false_alarm" ? "outline" : "secondary"}
                              disabled={saving}
                              onClick={() => void submitFeedback(feedback)}
                            >
                              {label(feedback)}
                            </Button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                    Viewer access is read-only. Admin, fleet manager, and dispatcher roles can
                    submit feedback or change review status.
                  </div>
                )}
              </div>
            ) : (
              <EmptyState
                title="Select an insight"
                description="Insight details, evidence, recommendations, and feedback controls appear here."
                icon={BrainCircuit}
              />
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function FilterSelect({
  label: selectLabel,
  value,
  values,
  onChange,
}: {
  label: string;
  value: string;
  values: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block min-w-0 text-sm">
      <span className="text-xs text-muted-foreground">{selectLabel}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
      >
        {values.map((item) => (
          <option key={item} value={item}>
            {label(item)}
          </option>
        ))}
      </select>
    </label>
  );
}

function DetailSection({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {title}
      </div>
      {children}
    </section>
  );
}

function Field({ label: fieldLabel, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{fieldLabel}</p>
      <p className="mt-0.5 truncate font-medium">{value}</p>
    </div>
  );
}
