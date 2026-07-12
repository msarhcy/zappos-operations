import { describe, expect, it } from "vitest";
import {
  auditEvent,
  hasBlockingCriticalTests,
  hasMandatoryChecklistGaps,
  labelFitmentSource,
  retainChecklistVersion,
  rolloutTruthLabel,
  supportDiagnosticCopy,
  validateCompletion,
  validateFitmentTransition,
  validateInventoryReservation,
  validateRoadTestTruthfulness,
  validateRolloutPlanDevice,
  validateSandboxMarker,
  type ChecklistStepInput,
  type FitmentTestInput,
} from "@/lib/field-deployment/phase12";
import {
  validateIccid,
  validateImei,
  type DeviceAssignment,
  type SimAssignment,
} from "@/lib/device-lab/phase11";

const passedChecklist: ChecklistStepInput[] = [{ mandatory: true, status: "passed" }];
const manager = { userId: "manager-1", roles: ["fleet_manager" as const] };
const technician = { userId: "tech-1", roles: ["viewer" as const] };

describe("phase 12 fitment lifecycle", () => {
  it("allows deterministic transitions and rejects skipped lifecycle states", () => {
    expect(
      validateFitmentTransition({
        job: { id: "job-1", status: "planned" },
        actor: manager,
        nextStatus: "assigned",
        checklist: [],
        tests: [],
      }).ok,
    ).toBe(true);

    expect(
      validateFitmentTransition({
        job: { id: "job-1", status: "planned" },
        actor: manager,
        nextStatus: "completed",
        checklist: [],
        tests: [],
      }).issues,
    ).toContain("Invalid fitment transition");
  });

  it("rejects technician self-approval and requires rejection or override reasons", () => {
    expect(
      validateFitmentTransition({
        job: {
          id: "job-1",
          status: "awaiting_supervisor",
          technicianUserId: "tech-1",
        },
        actor: technician,
        nextStatus: "approved",
        checklist: passedChecklist,
        tests: [],
      }).issues,
    ).toContain("Technician cannot approve own work");

    expect(
      validateFitmentTransition({
        job: { id: "job-1", status: "awaiting_supervisor" },
        actor: manager,
        nextStatus: "rejected",
        checklist: passedChecklist,
        tests: [],
      }).issues,
    ).toContain("Rejection reason is required");
  });

  it("enforces mandatory checklist and critical power or ignition blockers", () => {
    expect(hasMandatoryChecklistGaps([{ mandatory: true, status: "not_applicable" }])).toBe(true);
    expect(
      hasMandatoryChecklistGaps([
        { mandatory: true, status: "not_applicable", overrideReason: "Interface not present" },
      ]),
    ).toBe(false);

    const criticalFailures: FitmentTestInput[] = [
      { category: "power", result: "failed", source: "manual_measurement", critical: true },
      { category: "ignition", result: "failed", source: "manual", critical: true },
    ];
    expect(hasBlockingCriticalTests(criticalFailures)).toBe(true);
    expect(
      hasBlockingCriticalTests(
        criticalFailures.map((test) => ({ ...test, overrideReason: "Supervisor accepted retest" })),
      ),
    ).toBe(false);
  });
});

describe("phase 12 completion and assignment integrity", () => {
  const existingDeviceAssignment: DeviceAssignment = {
    deviceId: "device-1",
    vehicleId: "vehicle-1",
    assignmentType: "primary",
    status: "active",
  };
  const existingSimAssignment: SimAssignment = {
    simId: "sim-1",
    deviceId: "device-1",
    status: "active",
    primary: true,
  };

  it("blocks completion for simulator devices, active assignment conflicts, SIM conflicts, and simulated road passes", () => {
    const result = validateCompletion({
      approved: true,
      deviceSimulated: true,
      firmwareCompatible: true,
      checklist: passedChecklist,
      tests: [],
      roadTest: { result: "passed", source: "simulated_validation" },
      deviceAssignments: [existingDeviceAssignment],
      nextDeviceAssignment: { ...existingDeviceAssignment, vehicleId: "vehicle-2" },
      simAssignments: [existingSimAssignment],
      nextSimAssignment: { ...existingSimAssignment, deviceId: "device-2" },
    });

    expect(result.issues).toContain("Physical fitment cannot complete with simulator device");
    expect(result.issues).toContain("Device already has an active vehicle assignment");
    expect(result.issues).toContain("SIM already has an active device assignment");
    expect(result.issues).toContain("Simulated road test cannot prove physical fitment");
  });

  it("detects vehicle primary-device conflicts and firmware incompatibility", () => {
    const result = validateCompletion({
      approved: true,
      deviceSimulated: false,
      firmwareCompatible: false,
      checklist: passedChecklist,
      tests: [],
      deviceAssignments: [existingDeviceAssignment],
      nextDeviceAssignment: { ...existingDeviceAssignment, deviceId: "device-2" },
      simAssignments: [],
    });

    expect(result.issues).toContain("Firmware compatibility must be approved");
    expect(result.issues).toContain("Vehicle already has an active primary device");
  });

  it("prevents inventory assets from being reserved twice", () => {
    expect(
      validateInventoryReservation({
        assetId: "asset-1",
        activeJobAssetIds: ["asset-1"],
        currentState: "warehouse",
      }).issues,
    ).toContain("Asset is already reserved for an active fitment job");
    expect(
      validateInventoryReservation({
        assetId: "asset-2",
        activeJobAssetIds: [],
        currentState: "quarantined",
      }).issues,
    ).toContain("Asset state is not available for reservation");
  });
});

describe("phase 12 truthfulness and planning guards", () => {
  it("keeps checklist version fixed for the job", () => {
    expect(retainChecklistVersion({ templateVersion: 1, laterTemplateVersion: 2 })).toBe(1);
  });

  it("labels simulated and manual sources without claiming physical verification", () => {
    expect(labelFitmentSource("simulated")).toBe("SIMULATED");
    expect(labelFitmentSource("manual_measurement")).toBe("MANUAL FIELD");
    expect(
      validateRoadTestTruthfulness({ result: "passed", source: "simulated_validation" }).ok,
    ).toBe(false);
  });

  it("keeps OTA rollout planning from becoming a firmware command", () => {
    const result = validateRolloutPlanDevice({
      device: { hardwareModel: "ZAPP-BOX", hardwareRevision: "A1", bootloaderVersion: "1.2.0" },
      firmware: {
        version: "2.0.0",
        channel: "stable",
        hardwareModel: "ZAPP-BOX",
        minimumHardwareRevision: "A1",
        minimumBootloader: "1.0.0",
        status: "approved",
      },
      alreadyInPlan: true,
      inConflictingActivePlan: true,
      commandRequested: true,
    });
    expect(result.issues).toContain("Device is already included in this rollout plan");
    expect(result.issues).toContain("Device is already in another active rollout plan");
    expect(result.issues).toContain("Phase 12 rollout plans cannot send firmware commands");
    expect(rolloutTruthLabel("approved")).toContain("No firmware command sent");
  });

  it("preserves diagnostic wording and audit payload shape", () => {
    const copy = supportDiagnosticCopy({ evidenceCount: 0, simulatedOnly: true });
    expect(Object.values(copy)).not.toContain("Confirmed fault");
    expect(copy.evidenceHeading).toBe("Evidence available");
    expect(
      auditEvent({ action: "fitment_job_created", entityType: "fitment_job", entityId: "job-1" }),
    ).toEqual({
      action: "fitment_job_created",
      entity_type: "fitment_job",
      entity_id: "job-1",
      source: "manual",
    });
  });

  it("validates sandbox markers and identifiers", () => {
    expect(validateImei("490154203237518")).toBe(true);
    expect(validateIccid("8945001234567890123")).toBe(true);
    expect(validateSandboxMarker({ sandbox: false, simulated: true }).issues).toContain(
      "Simulated field records must be sandbox marked",
    );
    expect(
      validateSandboxMarker({ sandbox: true, identifier: "490154203237518" }).issues,
    ).toContain("Sandbox records must use fictional identifiers");
  });
});
