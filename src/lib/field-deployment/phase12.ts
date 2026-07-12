import {
  hasActiveDeviceVehicleConflict,
  hasActivePrimaryVehicleConflict,
  hasActiveSimConflict,
  isFirmwareCompatible,
  type DeviceAssignment,
  type DeviceFirmwareInput,
  type FirmwareVersion,
  type SimAssignment,
} from "@/lib/device-lab/phase11";

export type FitmentStatus =
  | "planned"
  | "assigned"
  | "in_progress"
  | "blocked"
  | "awaiting_supervisor"
  | "approved"
  | "rejected"
  | "completed"
  | "cancelled";

export type ChecklistStepStatus = "pending" | "passed" | "failed" | "not_applicable" | "blocked";
export type FitmentTestResult = "passed" | "failed" | "warning" | "not_run";
export type TestSource =
  | "manual_measurement"
  | "manual"
  | "simulated"
  | "future_device_reported"
  | "device_reported_future";
export type RoadTestSource =
  "simulated_validation" | "manual_field_test" | "future_device_reported_test";
export type InventoryState =
  | "warehouse"
  | "reserved"
  | "issued_to_technician"
  | "in_fitment"
  | "active"
  | "returned"
  | "faulty"
  | "quarantined"
  | "retired";
export type RolloutStatus =
  "draft" | "awaiting_approval" | "approved" | "scheduled" | "cancelled" | "completed_simulation";

export interface FitmentActor {
  userId: string;
  roles: Array<"admin" | "fleet_manager" | "dispatcher" | "driver" | "viewer">;
}

export interface FitmentJobSummary {
  id: string;
  status: FitmentStatus;
  technicianUserId?: string | null;
  supervisorUserId?: string | null;
}

export interface ChecklistStepInput {
  mandatory: boolean;
  critical?: boolean;
  status: ChecklistStepStatus;
  overrideReason?: string | null;
}

export interface FitmentTestInput {
  category: "power" | "ignition" | "gnss" | "gsm" | "can_j1939" | "road_test" | "connectivity";
  result: FitmentTestResult;
  source: TestSource;
  critical?: boolean;
  overrideReason?: string | null;
}

export interface RoadTestInput {
  result: FitmentTestResult;
  source: RoadTestSource;
}

export interface CompletionInput {
  deviceAssignments: DeviceAssignment[];
  simAssignments: SimAssignment[];
  nextDeviceAssignment: DeviceAssignment;
  nextSimAssignment?: SimAssignment;
  deviceSimulated: boolean;
  firmwareCompatible: boolean;
  approved: boolean;
  checklist: ChecklistStepInput[];
  tests: FitmentTestInput[];
  roadTest?: RoadTestInput | null;
}

const allowedTransitions: Record<FitmentStatus, FitmentStatus[]> = {
  planned: ["assigned", "cancelled"],
  assigned: ["in_progress", "cancelled"],
  in_progress: ["blocked", "awaiting_supervisor", "cancelled"],
  blocked: ["in_progress"],
  awaiting_supervisor: ["approved", "rejected"],
  rejected: ["in_progress"],
  approved: ["completed"],
  completed: [],
  cancelled: [],
};

export function canTransitionFitment(current: FitmentStatus, next: FitmentStatus) {
  return allowedTransitions[current].includes(next);
}

function isManager(actor: FitmentActor) {
  return actor.roles.includes("admin") || actor.roles.includes("fleet_manager");
}

export function validateFitmentTransition(input: {
  job: FitmentJobSummary;
  actor: FitmentActor;
  nextStatus: FitmentStatus;
  reason?: string | null;
  overrideReason?: string | null;
  checklist: ChecklistStepInput[];
  tests: FitmentTestInput[];
}) {
  const issues: string[] = [];
  if (!canTransitionFitment(input.job.status, input.nextStatus)) {
    issues.push("Invalid fitment transition");
  }
  if (
    ["assigned", "cancelled", "approved", "rejected"].includes(input.nextStatus) &&
    !isManager(input.actor)
  ) {
    issues.push("Manager or supervisor role required");
  }
  if (
    ["in_progress", "blocked", "awaiting_supervisor"].includes(input.nextStatus) &&
    !isManager(input.actor) &&
    input.job.technicianUserId !== input.actor.userId
  ) {
    issues.push("Assigned technician or manager required");
  }
  if (
    ["approved", "rejected"].includes(input.nextStatus) &&
    input.job.technicianUserId === input.actor.userId
  ) {
    issues.push("Technician cannot approve own work");
  }
  if (input.nextStatus === "blocked" && !input.reason) issues.push("Blocked reason is required");
  if (input.nextStatus === "rejected" && !input.reason) issues.push("Rejection reason is required");
  if (input.nextStatus === "awaiting_supervisor" && hasMandatoryChecklistGaps(input.checklist)) {
    issues.push("Mandatory checklist must pass before supervisor submission");
  }
  if (
    input.nextStatus === "approved" &&
    (hasMandatoryChecklistGaps(input.checklist) || hasBlockingCriticalTests(input.tests)) &&
    !input.overrideReason
  ) {
    issues.push("Supervisor override reason is required for unresolved critical blockers");
  }
  return { ok: issues.length === 0, issues };
}

export function hasMandatoryChecklistGaps(steps: ChecklistStepInput[]) {
  return steps.some(
    (step) =>
      step.mandatory &&
      (step.status === "pending" ||
        step.status === "failed" ||
        step.status === "blocked" ||
        (step.status === "not_applicable" && !step.overrideReason)),
  );
}

export function hasBlockingCriticalTests(tests: FitmentTestInput[]) {
  return tests.some((test) => test.critical && test.result === "failed" && !test.overrideReason);
}

export function isPhysicalVerificationSource(source: TestSource | RoadTestSource) {
  return source === "manual_measurement" || source === "manual" || source === "manual_field_test";
}

export function labelFitmentSource(source: TestSource | RoadTestSource) {
  if (source === "simulated" || source === "simulated_validation") return "SIMULATED";
  if (
    source === "future_device_reported" ||
    source === "device_reported_future" ||
    source === "future_device_reported_test"
  ) {
    return "FUTURE DEVICE-REPORTED";
  }
  return "MANUAL FIELD";
}

export function validateInventoryReservation(input: {
  assetId: string;
  activeJobAssetIds: string[];
  currentState: InventoryState;
}) {
  const issues: string[] = [];
  if (input.activeJobAssetIds.includes(input.assetId)) {
    issues.push("Asset is already reserved for an active fitment job");
  }
  if (["active", "retired", "quarantined"].includes(input.currentState)) {
    issues.push("Asset state is not available for reservation");
  }
  return { ok: issues.length === 0, issues };
}

export function validateCompletion(input: CompletionInput) {
  const issues: string[] = [];
  if (!input.approved) issues.push("Fitment must be supervisor approved");
  if (input.deviceSimulated) issues.push("Physical fitment cannot complete with simulator device");
  if (!input.firmwareCompatible) issues.push("Firmware compatibility must be approved");
  if (hasMandatoryChecklistGaps(input.checklist))
    issues.push("Mandatory checklist has unresolved gaps");
  if (hasBlockingCriticalTests(input.tests)) issues.push("Critical tests have unresolved failures");
  if (input.roadTest?.source === "simulated_validation" && input.roadTest.result === "passed") {
    issues.push("Simulated road test cannot prove physical fitment");
  }
  if (hasActiveDeviceVehicleConflict(input.deviceAssignments, input.nextDeviceAssignment)) {
    issues.push("Device already has an active vehicle assignment");
  }
  if (hasActivePrimaryVehicleConflict(input.deviceAssignments, input.nextDeviceAssignment)) {
    issues.push("Vehicle already has an active primary device");
  }
  if (
    input.nextSimAssignment &&
    hasActiveSimConflict(input.simAssignments, input.nextSimAssignment)
  ) {
    issues.push("SIM already has an active device assignment");
  }
  return { ok: issues.length === 0, issues };
}

export function validateRolloutPlanDevice(input: {
  device: DeviceFirmwareInput;
  firmware: FirmwareVersion;
  alreadyInPlan: boolean;
  inConflictingActivePlan: boolean;
  commandRequested?: boolean;
}) {
  const issues: string[] = [];
  if (input.alreadyInPlan) issues.push("Device is already included in this rollout plan");
  if (input.inConflictingActivePlan)
    issues.push("Device is already in another active rollout plan");
  if (input.commandRequested) issues.push("Phase 12 rollout plans cannot send firmware commands");
  if (!isFirmwareCompatible(input.device, input.firmware)) {
    issues.push("Device is not compatible with planned firmware");
  }
  return { ok: issues.length === 0, issues };
}

export function rolloutTruthLabel(status: RolloutStatus) {
  if (status === "completed_simulation")
    return "Simulated compatibility only. No firmware command sent.";
  if (status === "scheduled" || status === "approved")
    return "Planned rollout. No firmware command sent.";
  return "Planning metadata only. No firmware command sent.";
}

export function supportDiagnosticCopy(input: { evidenceCount: number; simulatedOnly: boolean }) {
  return {
    evidenceHeading: "Evidence available",
    possibleCausesHeading: "Possible causes",
    recommendedChecksHeading: "Recommended checks",
    priority:
      input.evidenceCount === 0 ? "unknown" : input.simulatedOnly ? "review" : "field_check",
  };
}

export function auditEvent(input: {
  action: string;
  entityType: string;
  entityId: string;
  source?: "manual" | "system" | "simulated" | "planned";
}) {
  return {
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId,
    source: input.source ?? "manual",
  };
}

export function retainChecklistVersion(input: {
  templateVersion: number;
  laterTemplateVersion: number;
}) {
  return input.templateVersion;
}

export function validateRoadTestTruthfulness(test: RoadTestInput) {
  const issues: string[] = [];
  if (test.source === "simulated_validation" && test.result === "passed") {
    issues.push("Simulated validation cannot pass a physical road test");
  }
  return { ok: issues.length === 0, issues, label: labelFitmentSource(test.source) };
}

export function validateSandboxMarker(input: {
  sandbox: boolean;
  simulated?: boolean;
  identifier?: string | null;
}) {
  const issues: string[] = [];
  if (!input.sandbox && input.simulated)
    issues.push("Simulated field records must be sandbox marked");
  if (
    input.sandbox &&
    input.identifier &&
    /(?:490154203237518|8945001234567890123)/.test(input.identifier)
  ) {
    issues.push("Sandbox records must use fictional identifiers");
  }
  return { ok: issues.length === 0, issues };
}
