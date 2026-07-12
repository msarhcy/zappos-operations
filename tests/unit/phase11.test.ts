import { describe, expect, it } from "vitest";
import {
  buildP1SimulatorPoint,
  buildSimulatedBusEvent,
  buildSimulatedSensorEvent,
  buildSimulatedTelemetryBatch,
  buildSimulatedGpsPoint,
  buildZappBoxSimulatorPoint,
  canTransitionProvisioning,
  commandIdempotencyKey,
  evaluateProvisioningState,
  hasActiveDeviceVehicleConflict,
  hasActivePrimaryVehicleConflict,
  hasActiveSimConflict,
  hasPrimarySimConflict,
  isFirmwareCompatible,
  maskIdentifier,
  normalizeIdentifier,
  scoreDeviceHealth,
  transitionNetworkState,
  transitionPowerState,
  validateDeviceIdentity,
  validateIccid,
  validateImei,
  validateSensorEvent,
  validateSimulatedCommand,
  validateSpnFmi,
  type DeviceAssignment,
  type SimAssignment,
} from "@/lib/device-lab/phase11";

describe("phase 11 device identity", () => {
  it("normalizes identifiers and masks sensitive values", () => {
    expect(normalizeIdentifier(" zb 001 a ")).toBe("ZB001A");
    expect(maskIdentifier("123456789012345")).toBe("***********2345");
  });

  it("validates IMEI, ICCID, serial, model, revision, and installation identity", () => {
    expect(validateImei("490154203237518")).toBe(true);
    expect(validateImei("490154203237519")).toBe(false);
    expect(validateIccid("8945001234567890123")).toBe(true);
    expect(validateIccid("123456")).toBe(false);

    expect(
      validateDeviceIdentity({
        serialNumber: " ZB-001 ",
        imei: "490154203237518",
        installationId: "install-01",
        hardwareModel: "ZAPP-BOX",
        hardwareRevision: "A1",
      }),
    ).toEqual({ ok: true, issues: [] });
  });
});

describe("phase 11 assignment integrity", () => {
  const activePrimary: DeviceAssignment = {
    deviceId: "device-1",
    vehicleId: "vehicle-1",
    assignmentType: "primary",
    status: "active",
  };

  it("detects one active device assigned to multiple vehicles", () => {
    expect(
      hasActiveDeviceVehicleConflict([activePrimary], {
        ...activePrimary,
        vehicleId: "vehicle-2",
      }),
    ).toBe(true);
  });

  it("detects one vehicle with conflicting active primary devices", () => {
    expect(
      hasActivePrimaryVehicleConflict([activePrimary], {
        ...activePrimary,
        deviceId: "device-2",
      }),
    ).toBe(true);
  });

  it("detects active SIM and primary SIM conflicts", () => {
    const activeSim: SimAssignment = {
      simId: "sim-1",
      deviceId: "device-1",
      status: "active",
      primary: true,
    };
    expect(hasActiveSimConflict([activeSim], { ...activeSim, deviceId: "device-2" })).toBe(true);
    expect(
      hasPrimarySimConflict([activeSim], {
        simId: "sim-2",
        deviceId: "device-1",
        status: "assigned",
        primary: true,
      }),
    ).toBe(true);
  });
});

describe("phase 11 provisioning and simulation states", () => {
  it("allows only deterministic provisioning transitions", () => {
    expect(canTransitionProvisioning("registered", "identity_verified")).toBe(true);
    expect(canTransitionProvisioning("registered", "active")).toBe(false);
  });

  it("evaluates provisioning without physical verification for simulators", () => {
    expect(
      evaluateProvisioningState({
        identityValid: true,
        simAssigned: true,
        vehicleAssigned: true,
        companyOwnershipValid: true,
        vehicleOwnershipValid: true,
        firmwareCompatible: true,
        requiredConfigurationPresent: true,
        simulated: true,
        physicalDeviceVerified: false,
      }),
    ).toEqual({ state: "simulated_ready", issues: [] });

    expect(
      evaluateProvisioningState({
        identityValid: true,
        simAssigned: true,
        vehicleAssigned: true,
        companyOwnershipValid: true,
        vehicleOwnershipValid: true,
        firmwareCompatible: true,
        requiredConfigurationPresent: true,
        simulated: true,
        physicalDeviceVerified: true,
      }).issues,
    ).toContain("Simulator cannot be marked as physical-device verified");
  });

  it("transitions simulated power and ignition safely", () => {
    expect(transitionPowerState("ignition_off", "ignition_on")).toBe("ignition_on");
    expect(() => transitionPowerState("low_backup_battery", "ignition_on")).toThrow(
      "SIMULATED POWER",
    );
  });

  it("transitions simulated GPS/GSM/network states safely", () => {
    expect(transitionNetworkState("gsm_online", "weak_network")).toBe("weak_network");
    expect(transitionNetworkState("offline", "reconnecting")).toBe("reconnecting");
    expect(() => transitionNetworkState("offline", "gps_healthy")).toThrow("simulated network");
  });
});

describe("phase 11 device health and event validation", () => {
  it("scores stale devices as offline and weak simulated devices as degraded", () => {
    expect(
      scoreDeviceHealth({
        now: new Date("2026-07-11T12:00:00.000Z"),
        lastSeenAt: "2026-07-11T11:30:00.000Z",
        networkState: "gsm_online",
      }).status,
    ).toBe("offline");

    expect(
      scoreDeviceHealth({
        now: new Date("2026-07-11T12:00:00.000Z"),
        lastSeenAt: "2026-07-11T11:59:00.000Z",
        gpsQuality: "poor",
        networkState: "weak_network",
        repeatedReconnects: 3,
      }).status,
    ).toBe("degraded");
  });

  it("validates SPN/FMI ranges and simulated sensor events", () => {
    expect(validateSpnFmi(190, 5)).toEqual({ ok: true, issues: [] });
    expect(validateSpnFmi(600000, 40).ok).toBe(false);
    expect(validateSensorEvent({ sensorType: "panic", value: true, simulated: true }).ok).toBe(
      true,
    );
    expect(validateSensorEvent({ sensorType: "camera", simulated: true }).ok).toBe(false);
    expect(validateSensorEvent({ sensorType: "panic", simulated: false }).ok).toBe(false);
  });
});

describe("phase 11 command and firmware safety", () => {
  it("validates simulated command boundary and idempotency", () => {
    expect(
      validateSimulatedCommand({
        commandType: "request_status",
        deviceType: "ZAPP_BOX",
        deviceStatus: "active",
        simulated: true,
      }).ok,
    ).toBe(true);
    expect(
      validateSimulatedCommand({
        commandType: "reboot_simulator",
        deviceType: "ZAPP_BOX",
        deviceStatus: "active",
        simulated: true,
      }).ok,
    ).toBe(false);
    expect(
      commandIdempotencyKey({
        companyId: "Company-1",
        deviceId: "Device-1",
        commandType: "request_status",
        payload: { b: 2, a: 1 },
      }),
    ).toBe(
      commandIdempotencyKey({
        companyId: "company-1",
        deviceId: "device-1",
        commandType: "request_status",
        payload: { a: 1, b: 2 },
      }),
    );
  });

  it("checks firmware compatibility without deploying firmware", () => {
    expect(
      isFirmwareCompatible(
        {
          hardwareModel: "ZAPP-BOX",
          hardwareRevision: "B1",
          bootloaderVersion: "1.2.0",
          firmwareVersion: "2.0.0",
        },
        {
          version: "2.0.0",
          channel: "stable",
          hardwareModel: "zapp-box",
          minimumHardwareRevision: "A1",
          minimumBootloader: "1.0.0",
          status: "approved",
        },
      ),
    ).toBe(true);
  });
});

describe("phase 11 simulator source labels", () => {
  it("builds simulated GPS points with explicit source and label", () => {
    const point = buildSimulatedGpsPoint({
      pointId: "point-1",
      profile: "ZAPP_BOX",
      latitude: -1.2921,
      longitude: 36.8219,
      timestamp: "2026-07-11T12:00:00.000Z",
      sequenceNumber: 1,
      speed: 12,
      encoderVersion: "zct-ready-json-v1",
      ignitionOn: true,
      externalPower: false,
    });

    expect(point).toMatchObject({
      simulated: true,
      simulation_label: "SIMULATED GPS",
      source: "ZAPP_BOX",
      encoder_version: "zct-ready-json-v1",
      movement_state: "moving",
      ignition_state: "SIMULATED IGNITION ON",
      external_power_state: "SIMULATED POWER LOST",
    });
  });

  it("builds separate Zapp Box and P1 simulator profiles and telemetry batches", () => {
    const zappBoxPoint = buildZappBoxSimulatorPoint({
      pointId: "point-1",
      latitude: -1.2921,
      longitude: 36.8219,
      timestamp: "2026-07-11T12:00:00.000Z",
      sequenceNumber: 2,
    });
    const p1Point = buildP1SimulatorPoint({
      pointId: "point-2",
      latitude: -1.2922,
      longitude: 36.822,
      timestamp: "2026-07-11T12:00:05.000Z",
      sequenceNumber: 3,
      encoderVersion: "zct-ready-json-v1",
    });
    const batch = buildSimulatedTelemetryBatch({
      batchId: "batch-1",
      trackingSessionId: "session-1",
      installationId: " sim install ",
      points: [p1Point, zappBoxPoint],
    });

    expect(zappBoxPoint.profile).toBe("ZAPP_BOX");
    expect(p1Point.profile).toBe("P1");
    expect(batch).toMatchObject({
      simulated: true,
      simulation_label: "SIMULATED TELEMETRY BATCH",
      first_sequence: 2,
      last_sequence: 3,
      installation_id: "SIMINSTALL",
    });
  });

  it("builds labelled simulated bus and sensor events", () => {
    expect(
      buildSimulatedBusEvent({
        source: "SIMULATED_J1939",
        event_type: "engine_speed",
        spn: 190,
        fmi: null,
        value: 1250,
        unit: "rpm",
        severity: "info",
      }),
    ).toMatchObject({ simulated: true, simulation_label: "SIMULATED J1939/CAN" });

    expect(
      buildSimulatedSensorEvent({
        sensor_type: "imu",
        value: { x: 0.1, y: 0, z: 9.8 },
        unit: "m/s2",
        severity: "info",
      }),
    ).toMatchObject({ simulated: true, simulation_label: "SIMULATED SENSOR" });
  });
});
