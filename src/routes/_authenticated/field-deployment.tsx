import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ClipboardCheck,
  FileCheck2,
  HardHat,
  History,
  PackageCheck,
  Radio,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  TestTube2,
  Truck,
  Upload,
  Wrench,
  Zap,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/operational-state";
import { StatusBadge } from "@/components/ui/status-badge-detailed";
import { useCompany } from "@/lib/company-context";
import {
  labelFitmentSource,
  rolloutTruthLabel,
  supportDiagnosticCopy,
  validateFitmentTransition,
  type ChecklistStepStatus,
  type FitmentStatus,
  type FitmentTestResult,
  type RoadTestSource,
  type RolloutStatus,
  type TestSource,
} from "@/lib/field-deployment/phase12";

export const Route = createFileRoute("/_authenticated/field-deployment")({
  head: () => ({ meta: [{ title: "Field Deployment - ZappOS" }] }),
  component: FieldDeploymentPage,
});

interface FitmentJobRow {
  id: string;
  company_id: string;
  reference: string;
  vehicle_id: string;
  device_id: string;
  sim_id: string | null;
  technician_user_id: string | null;
  supervisor_user_id: string | null;
  status: FitmentStatus;
  scheduled_at: string | null;
  started_at: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  completed_at: string | null;
  installation_location: string | null;
  odometer_at_fitment: number | null;
  notes: string | null;
  blocked_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface DeviceRow {
  id: string;
  device_type: string;
  serial_number: string;
  status: string;
  simulated: boolean;
  firmware_version: string | null;
  hardware_model: string;
  hardware_revision: string | null;
  inventory_state: string | null;
  issued_to_user_id: string | null;
  reserved_for_fitment_job_id: string | null;
}

interface SimRow {
  id: string;
  iccid: string;
  status: string;
  provider: string | null;
  assigned_device_id: string | null;
  inventory_state: string | null;
  issued_to_user_id: string | null;
  reserved_for_fitment_job_id: string | null;
}

interface ChecklistRow {
  id: string;
  fitment_job_id: string;
  step_number: number;
  title: string;
  mandatory: boolean;
  critical: boolean;
  status: ChecklistStepStatus;
  technician_notes: string | null;
  failure_reason: string | null;
  supervisor_comment: string | null;
}

interface TestRow {
  id: string;
  fitment_job_id: string;
  test_category: string;
  test_type: string;
  expected_range: string | null;
  measured_value: number | null;
  unit: string | null;
  result: FitmentTestResult;
  source: TestSource;
  critical: boolean;
  notes: string | null;
  override_reason: string | null;
  recorded_at: string;
}

interface RoadTestRow {
  id: string;
  fitment_job_id: string;
  result: FitmentTestResult;
  source: RoadTestSource;
  distance_meters: number | null;
  duration_seconds: number | null;
  accepted_telemetry_count: number;
  gps_quality: string | null;
  network_drop_count: number;
  reconnect_count: number;
  technician_conclusion: string | null;
}

interface EvidenceRow {
  id: string;
  fitment_job_id: string;
  evidence_type: string;
  storage_bucket: string;
  uploaded_at: string;
  notes: string | null;
}

interface RolloutRow {
  id: string;
  name: string;
  status: RolloutStatus;
  rollout_stage: string;
  target_count: number;
  planned_start: string | null;
  approved_at: string | null;
}

interface SupportCaseRow {
  id: string;
  device_id: string | null;
  vehicle_id: string | null;
  fitment_job_id: string | null;
  priority: string;
  status: string;
  reported_issue: string;
  diagnostic_summary: string | null;
}

interface AuditRow {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  reason: string | null;
  source: string;
  created_at: string;
}

type TabId =
  | "jobs"
  | "technician"
  | "inventory"
  | "checklist"
  | "tests"
  | "review"
  | "firmware"
  | "diagnostics"
  | "audit";

const tabs: Array<{ id: TabId; label: string; icon: typeof ClipboardCheck }> = [
  { id: "jobs", label: "Fitment jobs", icon: ClipboardCheck },
  { id: "technician", label: "Technician work", icon: Smartphone },
  { id: "inventory", label: "Inventory", icon: PackageCheck },
  { id: "checklist", label: "Checklist", icon: FileCheck2 },
  { id: "tests", label: "Tests", icon: TestTube2 },
  { id: "review", label: "Supervisor", icon: ShieldCheck },
  { id: "firmware", label: "Firmware plans", icon: RotateCcw },
  { id: "diagnostics", label: "Remote diagnostics", icon: Radio },
  { id: "audit", label: "Audit", icon: History },
];

function maskIdentifier(value: string | null | undefined) {
  if (!value) return "not set";
  const compact = value.replace(/\s+/g, "");
  if (compact.length <= 4) return "****";
  return `${"*".repeat(Math.max(4, compact.length - 4))}${compact.slice(-4)}`;
}

function relativeTime(value: string | null | undefined) {
  if (!value) return "not recorded";
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return new Date(value).toLocaleDateString();
}

function FieldDeploymentPage() {
  const { activeCompany, hasAnyRole, roles } = useCompany();
  const activeCompanyId = activeCompany?.id;
  const canRead = hasAnyRole(["admin", "fleet_manager", "dispatcher", "viewer"]);
  const canManage = hasAnyRole(["admin", "fleet_manager"]);
  const canTransition = hasAnyRole(["admin", "fleet_manager", "viewer"]);
  const requestRef = useRef(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("jobs");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [jobs, setJobs] = useState<FitmentJobRow[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [sims, setSims] = useState<SimRow[]>([]);
  const [checklist, setChecklist] = useState<ChecklistRow[]>([]);
  const [tests, setTests] = useState<TestRow[]>([]);
  const [roadTests, setRoadTests] = useState<RoadTestRow[]>([]);
  const [evidence, setEvidence] = useState<EvidenceRow[]>([]);
  const [rollouts, setRollouts] = useState<RolloutRow[]>([]);
  const [supportCases, setSupportCases] = useState<SupportCaseRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);

  const load = useCallback(async () => {
    if (!activeCompanyId) {
      setLoading(false);
      return;
    }
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const [
        jobResult,
        deviceResult,
        simResult,
        checklistResult,
        testResult,
        roadResult,
        evidenceResult,
        rolloutResult,
        supportResult,
        auditResult,
      ] = await Promise.all([
        supabase
          .from("device_fitment_jobs" as never)
          .select("*")
          .eq("company_id", activeCompanyId)
          .order("updated_at", { ascending: false })
          .limit(120),
        supabase
          .from("devices" as never)
          .select("*")
          .eq("company_id", activeCompanyId)
          .order("updated_at", { ascending: false })
          .limit(200),
        supabase
          .from("device_sims" as never)
          .select("*")
          .eq("company_id", activeCompanyId)
          .order("updated_at", { ascending: false })
          .limit(200),
        supabase
          .from("fitment_job_checklist_steps" as never)
          .select("*")
          .eq("company_id", activeCompanyId)
          .order("step_number", { ascending: true })
          .limit(300),
        supabase
          .from("fitment_test_results" as never)
          .select("*")
          .eq("company_id", activeCompanyId)
          .order("recorded_at", { ascending: false })
          .limit(160),
        supabase
          .from("fitment_road_tests" as never)
          .select("*")
          .eq("company_id", activeCompanyId)
          .order("updated_at", { ascending: false })
          .limit(80),
        supabase
          .from("fitment_evidence" as never)
          .select("id,fitment_job_id,evidence_type,storage_bucket,uploaded_at,notes")
          .eq("company_id", activeCompanyId)
          .order("uploaded_at", { ascending: false })
          .limit(80),
        supabase
          .from("firmware_rollout_plans" as never)
          .select("*")
          .eq("company_id", activeCompanyId)
          .order("created_at", { ascending: false })
          .limit(80),
        supabase
          .from("field_support_cases" as never)
          .select("*")
          .eq("company_id", activeCompanyId)
          .order("opened_at", { ascending: false })
          .limit(80),
        supabase
          .from("field_audit_ledger" as never)
          .select("id,action,entity_type,entity_id,reason,source,created_at")
          .eq("company_id", activeCompanyId)
          .order("created_at", { ascending: false })
          .limit(120),
      ]);

      if (requestId !== requestRef.current) return;
      for (const result of [
        jobResult,
        deviceResult,
        simResult,
        checklistResult,
        testResult,
        roadResult,
        evidenceResult,
        rolloutResult,
        supportResult,
        auditResult,
      ]) {
        if (result.error) throw result.error;
      }

      const nextJobs = (jobResult.data ?? []) as unknown as FitmentJobRow[];
      setJobs(nextJobs);
      setDevices((deviceResult.data ?? []) as unknown as DeviceRow[]);
      setSims((simResult.data ?? []) as unknown as SimRow[]);
      setChecklist((checklistResult.data ?? []) as unknown as ChecklistRow[]);
      setTests((testResult.data ?? []) as unknown as TestRow[]);
      setRoadTests((roadResult.data ?? []) as unknown as RoadTestRow[]);
      setEvidence((evidenceResult.data ?? []) as unknown as EvidenceRow[]);
      setRollouts((rolloutResult.data ?? []) as unknown as RolloutRow[]);
      setSupportCases((supportResult.data ?? []) as unknown as SupportCaseRow[]);
      setAudit((auditResult.data ?? []) as unknown as AuditRow[]);
      setSelectedJobId((current) =>
        current && nextJobs.some((job) => job.id === current) ? current : (nextJobs[0]?.id ?? null),
      );
    } catch (err) {
      if (requestId === requestRef.current)
        setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [activeCompanyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) ?? jobs[0] ?? null,
    [jobs, selectedJobId],
  );
  const selectedDevice = useMemo(
    () => devices.find((device) => device.id === selectedJob?.device_id) ?? null,
    [devices, selectedJob],
  );
  const selectedSim = useMemo(
    () => sims.find((sim) => sim.id === selectedJob?.sim_id) ?? null,
    [sims, selectedJob],
  );
  const selectedChecklist = useMemo(
    () => checklist.filter((step) => step.fitment_job_id === selectedJob?.id),
    [checklist, selectedJob],
  );
  const selectedTests = useMemo(
    () => tests.filter((test) => test.fitment_job_id === selectedJob?.id),
    [tests, selectedJob],
  );
  const selectedRoadTest = useMemo(
    () => roadTests.find((test) => test.fitment_job_id === selectedJob?.id) ?? null,
    [roadTests, selectedJob],
  );
  const selectedEvidence = useMemo(
    () => evidence.filter((item) => item.fitment_job_id === selectedJob?.id),
    [evidence, selectedJob],
  );
  const selectedSupport = useMemo(
    () => supportCases.filter((item) => item.fitment_job_id === selectedJob?.id),
    [supportCases, selectedJob],
  );

  const checklistPassed = selectedChecklist.filter((step) => step.status === "passed").length;
  const criticalFailures = selectedTests.filter(
    (test) => test.critical && test.result === "failed" && !test.override_reason,
  );
  const diagnosticCopy = supportDiagnosticCopy({
    evidenceCount: selectedEvidence.length + selectedTests.length,
    simulatedOnly:
      selectedTests.length > 0 && selectedTests.every((test) => test.source === "simulated"),
  });

  const transitionJob = async (nextStatus: FitmentStatus) => {
    if (!activeCompanyId || !selectedJob || !canTransition) return;
    const validation = validateFitmentTransition({
      job: {
        id: selectedJob.id,
        status: selectedJob.status,
        technicianUserId: selectedJob.technician_user_id,
        supervisorUserId: selectedJob.supervisor_user_id,
      },
      actor: { userId: "current-user", roles: roles as never },
      nextStatus,
      reason:
        nextStatus === "blocked" || nextStatus === "rejected"
          ? "Recorded from field workspace"
          : null,
      overrideReason: criticalFailures.length ? "Documented supervisor override" : null,
      checklist: selectedChecklist.map((step) => ({
        mandatory: step.mandatory,
        critical: step.critical,
        status: step.status,
        overrideReason: step.supervisor_comment ?? step.failure_reason,
      })),
      tests: selectedTests.map((test) => ({
        category: test.test_category as never,
        result: test.result,
        source: test.source,
        critical: test.critical,
        overrideReason: test.override_reason,
      })),
    });
    if (!validation.ok) {
      setError(validation.issues.join("; "));
      return;
    }
    setSaving("saving");
    try {
      const { error: transitionError } = await (
        supabase as unknown as {
          rpc: (
            name: string,
            args: Record<string, unknown>,
          ) => Promise<{ error: { message: string } | null }>;
        }
      ).rpc("transition_device_fitment_job", {
        _company_id: activeCompanyId,
        _fitment_job_id: selectedJob.id,
        _next_status: nextStatus,
        _reason:
          nextStatus === "blocked" || nextStatus === "rejected"
            ? "Recorded from field workspace"
            : null,
        _override_reason: criticalFailures.length ? "Documented supervisor override" : null,
      });
      if (transitionError) throw transitionError;
      setSaving("saved");
      await load();
    } catch (err) {
      setSaving("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!canRead) {
    return (
      <main className="p-4 md:p-6">
        <EmptyState
          title="Field deployment access is restricted"
          description="Drivers do not have field-deployment administration access."
          icon={HardHat}
        />
      </main>
    );
  }

  if (loading) {
    return (
      <main className="p-4 md:p-6">
        <LoadingState label="Loading field deployment workspace" />
      </main>
    );
  }

  if (error) {
    return (
      <main className="p-4 md:p-6">
        <ErrorState
          title="Could not load field deployment"
          description={error}
          onAction={() => void load()}
        />
      </main>
    );
  }

  return (
    <main className="space-y-4 p-4 md:p-6">
      <section className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
            <HardHat className="h-4 w-4" />
            Phase 12 field deployment
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal md:text-3xl">
            Fitment operations
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Manual field workflow for device issue, installation checks, supervisor review, planned
            OTA metadata, and support diagnostics. No live hardware command is sent from this page.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <TruthChip
            tone={saving === "error" ? "error" : saving === "saving" ? "warning" : "success"}
          >
            {saving === "saving" ? "Saving" : saving === "error" ? "Retryable error" : "Saved"}
          </TruthChip>
          <TruthChip tone="info">Manual + simulated only</TruthChip>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <SummaryCard
          label="Open jobs"
          value={jobs.filter((job) => !["completed", "cancelled"].includes(job.status)).length}
        />
        <SummaryCard
          label="Awaiting supervisor"
          value={jobs.filter((job) => job.status === "awaiting_supervisor").length}
        />
        <SummaryCard
          label="Issued assets"
          value={
            devices.filter((device) => device.inventory_state === "issued_to_technician").length +
            sims.filter((sim) => sim.inventory_state === "issued").length
          }
        />
        <SummaryCard
          label="Critical blockers"
          value={criticalFailures.length}
          tone={criticalFailures.length ? "error" : "success"}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(260px,360px)_1fr]">
        <Card className="p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Fitment jobs</h2>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Refresh
            </Button>
          </div>
          {jobs.length ? (
            <div className="space-y-2">
              {jobs.map((job) => (
                <button
                  key={job.id}
                  type="button"
                  onClick={() => setSelectedJobId(job.id)}
                  className={`w-full rounded-md border p-3 text-left text-sm transition ${
                    selectedJob?.id === job.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-medium">{job.reference}</span>
                    <StatusBadge status={job.status} />
                  </div>
                  <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                    <span className="truncate">Vehicle {job.vehicle_id.slice(0, 8)}</span>
                    <span>{job.installation_location ?? "Location not set"}</span>
                    <span>Updated {relativeTime(job.updated_at)}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No fitment jobs"
              description="Create jobs through the Phase 12 fitment job model. Production tenants are not auto-seeded."
              icon={ClipboardCheck}
            />
          )}
        </Card>

        <div className="min-w-0 space-y-4">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {tabs.map((item) => {
              const Icon = item.icon;
              return (
                <Button
                  key={item.id}
                  variant={tab === item.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTab(item.id)}
                  className="shrink-0"
                >
                  <Icon className="mr-2 h-4 w-4" />
                  {item.label}
                </Button>
              );
            })}
          </div>

          {!selectedJob ? (
            <EmptyState
              title="Select a fitment job"
              description="The workspace keeps job details separate from Phase 11 hardware readiness."
              icon={HardHat}
            />
          ) : (
            <TabPanel
              tab={tab}
              job={selectedJob}
              device={selectedDevice}
              sim={selectedSim}
              checklist={selectedChecklist}
              tests={selectedTests}
              roadTest={selectedRoadTest}
              evidence={selectedEvidence}
              rollouts={rollouts}
              supportCases={selectedSupport}
              audit={audit}
              canManage={canManage}
              criticalFailures={criticalFailures.length}
              checklistPassed={checklistPassed}
              diagnosticCopy={diagnosticCopy}
              onTransition={transitionJob}
            />
          )}
        </div>
      </section>
    </main>
  );
}

function SummaryCard({
  label,
  value,
  tone = "info",
}: {
  label: string;
  value: number;
  tone?: "info" | "success" | "error";
}) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
      <div
        className={
          tone === "error"
            ? "mt-2 text-2xl font-semibold text-status-error"
            : "mt-2 text-2xl font-semibold"
        }
      >
        {value}
      </div>
    </Card>
  );
}

function TruthChip({
  children,
  tone,
}: {
  children: string;
  tone: "info" | "success" | "warning" | "error";
}) {
  const toneClass = {
    info: "bg-status-info/15 text-status-info",
    success: "bg-status-success/15 text-status-success",
    warning: "bg-status-warning/15 text-status-warning",
    error: "bg-status-error/15 text-status-error",
  }[tone];
  return (
    <span className={`rounded-md px-2.5 py-1 text-sm font-medium ${toneClass}`}>{children}</span>
  );
}

function TabPanel(props: {
  tab: TabId;
  job: FitmentJobRow;
  device: DeviceRow | null;
  sim: SimRow | null;
  checklist: ChecklistRow[];
  tests: TestRow[];
  roadTest: RoadTestRow | null;
  evidence: EvidenceRow[];
  rollouts: RolloutRow[];
  supportCases: SupportCaseRow[];
  audit: AuditRow[];
  canManage: boolean;
  criticalFailures: number;
  checklistPassed: number;
  diagnosticCopy: ReturnType<typeof supportDiagnosticCopy>;
  onTransition: (nextStatus: FitmentStatus) => void;
}) {
  const {
    tab,
    job,
    device,
    sim,
    checklist,
    tests,
    roadTest,
    evidence,
    rollouts,
    supportCases,
    audit,
    canManage,
    criticalFailures,
    checklistPassed,
    diagnosticCopy,
    onTransition,
  } = props;

  if (tab === "jobs") {
    return (
      <Card className="p-4">
        <SectionTitle icon={Truck} title={job.reference} />
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Fact label="Status" value={job.status.replaceAll("_", " ")} />
          <Fact
            label="Scheduled"
            value={job.scheduled_at ? new Date(job.scheduled_at).toLocaleString() : "not scheduled"}
          />
          <Fact label="Location" value={job.installation_location ?? "not recorded"} />
          <Fact
            label="Odometer"
            value={job.odometer_at_fitment ? `${job.odometer_at_fitment} km` : "not recorded"}
          />
          <Fact
            label="Device"
            value={
              device
                ? `${device.device_type} ${maskIdentifier(device.serial_number)}`
                : "not assigned"
            }
          />
          <Fact
            label="SIM"
            value={sim ? `${sim.provider ?? "SIM"} ${maskIdentifier(sim.iccid)}` : "not assigned"}
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {job.status === "planned" && canManage ? (
            <Button size="sm" onClick={() => onTransition("assigned")}>
              Assign
            </Button>
          ) : null}
          {job.status === "assigned" ? (
            <Button size="sm" onClick={() => onTransition("in_progress")}>
              Start
            </Button>
          ) : null}
          {job.status === "in_progress" ? (
            <Button size="sm" variant="outline" onClick={() => onTransition("blocked")}>
              Block
            </Button>
          ) : null}
          {job.status === "in_progress" ? (
            <Button size="sm" onClick={() => onTransition("awaiting_supervisor")}>
              Submit
            </Button>
          ) : null}
          {job.status === "awaiting_supervisor" && canManage ? (
            <Button size="sm" onClick={() => onTransition("approved")}>
              Approve
            </Button>
          ) : null}
          {job.status === "awaiting_supervisor" && canManage ? (
            <Button size="sm" variant="outline" onClick={() => onTransition("rejected")}>
              Reject
            </Button>
          ) : null}
          {job.status === "approved" && canManage ? (
            <Button size="sm" onClick={() => onTransition("completed")}>
              Complete physical fitment
            </Button>
          ) : null}
        </div>
      </Card>
    );
  }

  if (tab === "technician") {
    return (
      <Card className="p-4">
        <SectionTitle icon={Smartphone} title="Assigned technician work" />
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Fact
            label="Checklist progress"
            value={`${checklistPassed}/${checklist.length || 14} passed`}
          />
          <Fact label="Critical blockers" value={String(criticalFailures)} />
          <Fact label="Draft state" value="Saved locally until Supabase confirms changes" />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Weak-connectivity UX preserves normal form state during refreshes and surfaces retryable
          errors. Full offline queueing is not claimed in Phase 12.
        </p>
      </Card>
    );
  }

  if (tab === "inventory") {
    return (
      <Card className="p-4">
        <SectionTitle icon={PackageCheck} title="Device and SIM inventory" />
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <InventoryCard
            title="Device"
            lines={[
              device?.inventory_state ?? "not assigned",
              device?.simulated ? "SIMULATOR - not physical" : "Physical device candidate",
              `Firmware ${device?.firmware_version ?? "not set"}`,
            ]}
          />
          <InventoryCard
            title="SIM"
            lines={[
              sim?.inventory_state ?? "not assigned",
              sim?.status ?? "not assigned",
              sim ? `ICCID ${maskIdentifier(sim.iccid)}` : "No SIM",
            ]}
          />
        </div>
      </Card>
    );
  }

  if (tab === "checklist") {
    return (
      <Card className="p-4">
        <SectionTitle icon={FileCheck2} title="Versioned 14-step checklist" />
        <div className="mt-4 space-y-2">
          {checklist.length ? (
            checklist.map((step) => (
              <div key={step.id} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">
                      {step.step_number}. {step.title}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {step.mandatory ? "Mandatory" : "Optional"}
                      {step.critical ? " - critical" : ""}
                    </div>
                  </div>
                  <StatusBadge status={step.status} />
                </div>
                {step.failure_reason ? (
                  <p className="mt-2 text-xs text-status-error">{step.failure_reason}</p>
                ) : null}
                {step.supervisor_comment ? (
                  <p className="mt-2 text-xs text-muted-foreground">{step.supervisor_comment}</p>
                ) : null}
              </div>
            ))
          ) : (
            <EmptyState
              title="Checklist not instantiated"
              description="A job receives the template version at creation."
              icon={FileCheck2}
            />
          )}
        </div>
      </Card>
    );
  }

  if (tab === "tests") {
    return (
      <Card className="p-4">
        <SectionTitle icon={Zap} title="Power, ignition, GNSS, GSM, CAN/J1939, and road test" />
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {tests.map((test) => (
            <div key={test.id} className="rounded-md border p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">
                    {test.test_category.replaceAll("_", " ")} -{" "}
                    {test.test_type.replaceAll("_", " ")}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {labelFitmentSource(test.source)} measurement
                  </div>
                </div>
                <StatusBadge status={test.result} />
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {test.measured_value == null
                  ? "No measured value"
                  : `${test.measured_value} ${test.unit ?? ""}`}
                {test.expected_range ? `, expected ${test.expected_range}` : ""}
              </div>
            </div>
          ))}
          {roadTest ? (
            <div className="rounded-md border p-3">
              <div className="text-sm font-medium">Road test</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {labelFitmentSource(roadTest.source)}
              </div>
              <div className="mt-2 text-xs">
                {roadTest.result.replaceAll("_", " ")} - {roadTest.accepted_telemetry_count}{" "}
                accepted points, {roadTest.network_drop_count} drops, {roadTest.reconnect_count}{" "}
                reconnects
              </div>
            </div>
          ) : null}
        </div>
      </Card>
    );
  }

  if (tab === "review") {
    return (
      <Card className="p-4">
        <SectionTitle icon={ShieldCheck} title="Supervisor review" />
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Fact label="Checklist" value={`${checklistPassed}/${checklist.length || 14} passed`} />
          <Fact label="Critical failures" value={String(criticalFailures)} />
          <Fact label="Evidence files" value={String(evidence.length)} />
        </div>
        <div className="mt-4 space-y-2">
          {evidence.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between rounded-md border p-3 text-sm"
            >
              <span>{item.evidence_type.replaceAll("_", " ")}</span>
              <span className="text-xs text-muted-foreground">
                {relativeTime(item.uploaded_at)}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Evidence uses private company-scoped storage metadata. Raw storage paths are not shown in
          this list.
        </p>
      </Card>
    );
  }

  if (tab === "firmware") {
    return (
      <Card className="p-4">
        <SectionTitle icon={RotateCcw} title="Firmware compatibility and planned OTA batches" />
        <div className="mt-4 space-y-3">
          {rollouts.length ? (
            rollouts.map((plan) => (
              <div key={plan.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium">{plan.name}</div>
                  <StatusBadge status={plan.status} />
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Stage {plan.rollout_stage}. Target {plan.target_count}.{" "}
                  {rolloutTruthLabel(plan.status)}
                </div>
              </div>
            ))
          ) : (
            <EmptyState
              title="No rollout plans"
              description="Planned rollout metadata only. No firmware command sent."
              icon={RotateCcw}
            />
          )}
        </div>
      </Card>
    );
  }

  if (tab === "diagnostics") {
    return (
      <Card className="p-4">
        <SectionTitle icon={Wrench} title="Remote support diagnostics" />
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Fact
            label="Evidence available"
            value={`${selectedEvidenceLabel(evidence.length, tests.length)}`}
          />
          <Fact label="Priority" value={diagnosticCopy.priority} />
          <Fact label="Device status" value={device?.status ?? "not assigned"} />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <InventoryCard
            title={diagnosticCopy.possibleCausesHeading}
            lines={[
              "Installation test failure",
              "Weak GSM/GNSS evidence",
              "Power or ignition measurement requires field check",
            ]}
          />
          <InventoryCard
            title={diagnosticCopy.recommendedChecksHeading}
            lines={[
              "Review manual measurements",
              "Confirm antenna and SIM state",
              "Do not treat simulated validation as physical verification",
            ]}
          />
        </div>
        {supportCases.length ? (
          <div className="mt-4 space-y-2">
            {supportCases.map((item) => (
              <div key={item.id} className="rounded-md border p-3 text-sm">
                <div className="font-medium">{item.reported_issue}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {item.status} - {item.priority}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <SectionTitle icon={History} title="Field audit ledger" />
      <div className="mt-4 space-y-2">
        {audit
          .filter((item) => item.entity_id === job.id || item.entity_type !== "fitment_job")
          .slice(0, 40)
          .map((item) => (
            <div key={item.id} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{item.action.replaceAll("_", " ")}</span>
                <span className="text-xs text-muted-foreground">
                  {relativeTime(item.created_at)}
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {item.entity_type} - {item.source}
                {item.reason ? ` - ${item.reason}` : ""}
              </div>
            </div>
          ))}
      </div>
    </Card>
  );
}

function SectionTitle({ icon: Icon, title }: { icon: typeof HardHat; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-5 w-5 text-primary" />
      <h2 className="text-base font-semibold">{title}</h2>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm font-medium">{value}</div>
    </div>
  );
}

function InventoryCard({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
        {lines.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
    </div>
  );
}

function selectedEvidenceLabel(evidenceCount: number, testCount: number) {
  if (!evidenceCount && !testCount) return "none";
  return `${evidenceCount} evidence files, ${testCount} tests`;
}
