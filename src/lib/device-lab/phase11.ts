export type DeviceType = "ZAPP_BOX" | "P1" | "ROAD_NODE" | "SIMULATOR";
export type DeviceStatus =
  | "unprovisioned"
  | "provisioned"
  | "active"
  | "inactive"
  | "degraded"
  | "maintenance"
  | "retired"
  | "blocked";
export type SimStatus = "inventory" | "assigned" | "active" | "suspended" | "inactive" | "retired";
export type AssignmentType = "primary" | "backup" | "temporary" | "simulator";
export type AssignmentStatus = "planned" | "active" | "inactive" | "removed";
export type ProvisioningState =
  | "registered"
  | "identity_verified"
  | "sim_assigned"
  | "vehicle_assigned"
  | "configuration_ready"
  | "simulated_ready"
  | "active";
export type NetworkState =
  | "gps_healthy"
  | "poor_gps_accuracy"
  | "gps_unavailable"
  | "gsm_online"
  | "weak_network"
  | "offline"
  | "reconnecting"
  | "reconnected"
  | "delayed_upload"
  | "queued_telemetry"
  | "retry"
  | "acknowledgement";
export type PowerState =
  | "ignition_on"
  | "ignition_off"
  | "external_power_present"
  | "external_power_lost"
  | "backup_battery_active"
  | "low_backup_battery"
  | "power_restored";
export type DeviceHealth = "healthy" | "warning" | "degraded" | "critical" | "offline" | "unknown";
export type SensorType =
  | "imu"
  | "shock"
  | "tilt"
  | "vibration"
  | "tamper"
  | "temperature"
  | "door_open"
  | "panic"
  | "harsh_braking"
  | "harsh_acceleration";
export type SimulatedCommandType =
  | "request_status"
  | "request_gps_fix"
  | "reboot_simulator"
  | "clear_simulated_queue"
  | "switch_ignition"
  | "switch_power"
  | "simulate_network_loss"
  | "simulate_reconnect"
  | "set_firmware_version"
  | "trigger_sos"
  | "trigger_sensor_event";
export type SimulatorProfile = "ZAPP_BOX" | "P1";
export type BusEventType =
  | "engine_speed"
  | "coolant_temperature"
  | "fuel_level"
  | "engine_hours"
  | "battery_voltage"
  | "diagnostic_trouble_code"
  | "brake_state"
  | "vehicle_speed";

export interface DeviceIdentityInput {
  serialNumber: string;
  imei?: string | null;
  installationId?: string | null;
  hardwareModel: string;
  hardwareRevision?: string | null;
}

export interface DeviceAssignment {
  deviceId: string;
  vehicleId: string;
  assignmentType: AssignmentType;
  status: AssignmentStatus;
}

export interface SimAssignment {
  simId: string;
  deviceId: string;
  status: SimStatus;
  primary?: boolean;
}

export interface ProvisioningInput {
  identityValid: boolean;
  simAssigned: boolean;
  vehicleAssigned: boolean;
  companyOwnershipValid: boolean;
  vehicleOwnershipValid: boolean;
  firmwareCompatible: boolean;
  requiredConfigurationPresent: boolean;
  simulated: boolean;
  physicalDeviceVerified: boolean;
}

export interface DeviceHealthInput {
  now: Date;
  lastSeenAt?: string | null;
  gpsQuality?: "high" | "acceptable" | "poor" | "rejected" | "unknown" | null;
  networkState?: NetworkState | null;
  externalPower?: boolean | null;
  backupBatteryPercent?: number | null;
  firmwareCompatible?: boolean | null;
  telemetryRejectionRatio?: number | null;
  delayedUploadRatio?: number | null;
  simStatus?: SimStatus | null;
  repeatedReconnects?: number | null;
}

export interface DeviceHealthResult {
  status: DeviceHealth;
  reasons: string[];
  possibleCauses: string[];
  recommendedChecks: string[];
}

export interface FirmwareVersion {
  version: string;
  channel: "dev" | "beta" | "stable" | "lab";
  hardwareModel: string;
  minimumHardwareRevision?: string | null;
  minimumBootloader?: string | null;
  status: "draft" | "approved" | "deprecated" | "blocked";
}

export interface DeviceFirmwareInput {
  hardwareModel: string;
  hardwareRevision?: string | null;
  bootloaderVersion?: string | null;
  firmwareVersion?: string | null;
}

export interface SimulatedGpsPoint {
  telemetry_point_id: string;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  horizontal_accuracy: number | null;
  device_speed: number | null;
  heading: number | null;
  device_timestamp: string;
  movement_state: "moving" | "stationary" | "unknown";
  sequence_number: number;
  telemetry_schema_version: 1;
  encoder_version: "json-v1" | "zct-ready-json-v1";
  simulated: true;
  simulation_label: "SIMULATED GPS";
  source: "ZAPP_BOX" | "P1" | "SIMULATOR";
  ignition_state: "SIMULATED IGNITION ON" | "SIMULATED IGNITION OFF";
  external_power_state: "SIMULATED POWER PRESENT" | "SIMULATED POWER LOST";
  backup_battery_percent: number;
  network_state: NetworkState;
  device_health: DeviceHealth;
  firmware_version: string;
  profile: SimulatorProfile;
}

export interface SimulatedTelemetryBatch {
  batch_id: string;
  tracking_session_id: string;
  installation_id: string;
  first_sequence: number;
  last_sequence: number;
  encoder_version: "json-v1" | "zct-ready-json-v1";
  telemetry_schema_version: 1;
  simulated: true;
  simulation_label: "SIMULATED TELEMETRY BATCH";
  points: SimulatedGpsPoint[];
}

export interface SimulatedBusEvent {
  source: "SIMULATED_J1939" | "SIMULATED_CAN";
  event_type: BusEventType;
  spn: number | null;
  fmi: number | null;
  value: number | string | boolean | null;
  unit: string | null;
  severity: "info" | "warning" | "critical";
  simulated: true;
  simulation_label: "SIMULATED J1939/CAN";
}

export interface SimulatedSensorEvent {
  sensor_type: SensorType;
  value: number | boolean | string | Record<string, number | string | boolean>;
  unit: string | null;
  severity: "info" | "warning" | "critical";
  simulated: true;
  simulation_label: "SIMULATED SENSOR";
}

export function normalizeIdentifier(value: string) {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

export function normalizePhoneIdentifier(value: string) {
  return value.trim().replace(/[^\d+]/g, "");
}

export function maskIdentifier(value: string | null | undefined, visible = 4) {
  if (!value) return "not set";
  const normalized = normalizeIdentifier(value);
  if (normalized.length <= visible) return "*".repeat(normalized.length);
  return `${"*".repeat(Math.max(0, normalized.length - visible))}${normalized.slice(-visible)}`;
}

export function validateSerialNumber(value: string) {
  const normalized = normalizeIdentifier(value);
  return normalized.length >= 4 && normalized.length <= 64 && /^[A-Z0-9._-]+$/.test(normalized);
}

export function validateInstallationId(value: string) {
  const normalized = normalizeIdentifier(value);
  return normalized.length >= 4 && normalized.length <= 80 && /^[A-Z0-9._:-]+$/.test(normalized);
}

export function validateHardwareModel(value: string) {
  const normalized = normalizeIdentifier(value);
  return normalized.length >= 2 && normalized.length <= 64 && /^[A-Z0-9._-]+$/.test(normalized);
}

export function validateHardwareRevision(value: string | null | undefined) {
  if (!value) return true;
  const normalized = normalizeIdentifier(value);
  return normalized.length <= 32 && /^[A-Z0-9._-]+$/.test(normalized);
}

export function validateImei(value: string | null | undefined) {
  if (!value) return true;
  const digits = value.replace(/\D/g, "");
  if (!/^\d{15}$/.test(digits)) return false;
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

export function validateIccid(value: string | null | undefined) {
  if (!value) return true;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 18 && digits.length <= 22 && digits.startsWith("89");
}

export function validateDeviceIdentity(input: DeviceIdentityInput) {
  const issues: string[] = [];
  if (!validateSerialNumber(input.serialNumber)) issues.push("Invalid serial number");
  if (!validateImei(input.imei)) issues.push("Invalid IMEI");
  if (input.installationId && !validateInstallationId(input.installationId)) {
    issues.push("Invalid installation ID");
  }
  if (!validateHardwareModel(input.hardwareModel)) issues.push("Invalid hardware model");
  if (!validateHardwareRevision(input.hardwareRevision)) issues.push("Invalid hardware revision");
  return { ok: issues.length === 0, issues };
}

export function hasActiveDeviceVehicleConflict(
  assignments: DeviceAssignment[],
  next: DeviceAssignment,
) {
  if (next.status !== "active") return false;
  return assignments.some(
    (item) =>
      item.status === "active" &&
      item.deviceId === next.deviceId &&
      item.vehicleId !== next.vehicleId,
  );
}

export function hasActivePrimaryVehicleConflict(
  assignments: DeviceAssignment[],
  next: DeviceAssignment,
) {
  if (next.status !== "active" || next.assignmentType !== "primary") return false;
  return assignments.some(
    (item) =>
      item.status === "active" &&
      item.assignmentType === "primary" &&
      item.vehicleId === next.vehicleId &&
      item.deviceId !== next.deviceId,
  );
}

export function hasActiveSimConflict(assignments: SimAssignment[], next: SimAssignment) {
  if (!["assigned", "active"].includes(next.status)) return false;
  return assignments.some(
    (item) =>
      ["assigned", "active"].includes(item.status) &&
      item.simId === next.simId &&
      item.deviceId !== next.deviceId,
  );
}

export function hasPrimarySimConflict(assignments: SimAssignment[], next: SimAssignment) {
  if (!next.primary || !["assigned", "active"].includes(next.status)) return false;
  return assignments.some(
    (item) =>
      item.primary &&
      ["assigned", "active"].includes(item.status) &&
      item.deviceId === next.deviceId &&
      item.simId !== next.simId,
  );
}

const provisioningOrder: ProvisioningState[] = [
  "registered",
  "identity_verified",
  "sim_assigned",
  "vehicle_assigned",
  "configuration_ready",
  "simulated_ready",
  "active",
];

export function canTransitionProvisioning(current: ProvisioningState, next: ProvisioningState) {
  return provisioningOrder.indexOf(next) === provisioningOrder.indexOf(current) + 1;
}

export function evaluateProvisioningState(input: ProvisioningInput): {
  state: ProvisioningState;
  issues: string[];
} {
  const issues: string[] = [];
  if (!input.identityValid) issues.push("Device identity is not verified");
  if (!input.companyOwnershipValid) issues.push("Device or SIM company ownership is invalid");
  if (!input.vehicleOwnershipValid) issues.push("Vehicle company ownership is invalid");
  if (input.simulated && input.physicalDeviceVerified) {
    issues.push("Simulator cannot be marked as physical-device verified");
  }

  if (issues.length > 0 || !input.identityValid) return { state: "registered", issues };
  if (!input.simAssigned) return { state: "identity_verified", issues };
  if (!input.vehicleAssigned) return { state: "sim_assigned", issues };
  if (!input.requiredConfigurationPresent) return { state: "vehicle_assigned", issues };
  if (!input.firmwareCompatible) {
    return {
      state: "configuration_ready",
      issues: ["Firmware compatibility is not approved"],
    };
  }
  if (input.simulated) return { state: "simulated_ready", issues };
  if (!input.physicalDeviceVerified) {
    return {
      state: "configuration_ready",
      issues: ["Physical device verification is required for non-simulator activation"],
    };
  }
  return { state: "active", issues };
}

export function transitionPowerState(current: PowerState, event: PowerState): PowerState {
  const allowed: Record<PowerState, PowerState[]> = {
    ignition_off: ["ignition_on", "external_power_lost"],
    ignition_on: ["ignition_off", "external_power_lost"],
    external_power_present: ["external_power_lost", "ignition_on", "ignition_off"],
    external_power_lost: ["backup_battery_active", "power_restored"],
    backup_battery_active: ["low_backup_battery", "power_restored"],
    low_backup_battery: ["power_restored"],
    power_restored: ["external_power_present", "ignition_on", "ignition_off"],
  };
  if (!allowed[current].includes(event)) {
    throw new Error(`Invalid SIMULATED POWER transition from ${current} to ${event}`);
  }
  return event;
}

export function transitionNetworkState(current: NetworkState, event: NetworkState): NetworkState {
  const allowed: Record<NetworkState, NetworkState[]> = {
    gps_healthy: ["poor_gps_accuracy", "gps_unavailable", "gsm_online"],
    poor_gps_accuracy: ["gps_healthy", "gps_unavailable"],
    gps_unavailable: ["gps_healthy", "poor_gps_accuracy"],
    gsm_online: ["weak_network", "offline", "delayed_upload", "acknowledgement"],
    weak_network: ["gsm_online", "offline", "reconnecting", "queued_telemetry"],
    offline: ["reconnecting", "queued_telemetry"],
    reconnecting: ["reconnected", "offline", "retry"],
    reconnected: ["gsm_online", "acknowledgement"],
    delayed_upload: ["queued_telemetry", "retry", "acknowledgement"],
    queued_telemetry: ["retry", "reconnecting", "acknowledgement"],
    retry: ["queued_telemetry", "reconnected", "offline"],
    acknowledgement: ["gsm_online", "gps_healthy"],
  };
  if (!allowed[current].includes(event)) {
    throw new Error(`Invalid simulated network transition from ${current} to ${event}`);
  }
  return event;
}

export function scoreDeviceHealth(input: DeviceHealthInput): DeviceHealthResult {
  const reasons: string[] = [];
  const possibleCauses: string[] = [];
  const recommendedChecks: string[] = [];
  const lastSeenAgeSeconds = input.lastSeenAt
    ? Math.max(0, Math.floor((input.now.getTime() - Date.parse(input.lastSeenAt)) / 1000))
    : null;

  if (lastSeenAgeSeconds == null) {
    reasons.push("No telemetry seen");
    possibleCauses.push("Device has not reported simulated or live-readiness telemetry");
    recommendedChecks.push("Confirm provisioning state and simulator source");
    return { status: "unknown", reasons, possibleCauses, recommendedChecks };
  }
  if (lastSeenAgeSeconds > 900 || input.networkState === "offline") {
    reasons.push("Device offline or stale");
    possibleCauses.push("Network unavailable or simulator paused");
    recommendedChecks.push("Check SIM state and simulated network controls");
    return { status: "offline", reasons, possibleCauses, recommendedChecks };
  }
  if (
    input.gpsQuality === "rejected" ||
    (input.backupBatteryPercent !== null &&
      input.backupBatteryPercent !== undefined &&
      input.backupBatteryPercent < 10)
  ) {
    reasons.push("Critical GPS or backup battery condition");
    possibleCauses.push("GPS unavailable, invalid fix, or low backup battery");
    recommendedChecks.push("Review SIMULATED GPS and SIMULATED POWER events");
    return { status: "critical", reasons, possibleCauses, recommendedChecks };
  }
  if (
    input.gpsQuality === "poor" ||
    input.networkState === "weak_network" ||
    input.externalPower === false ||
    (input.telemetryRejectionRatio ?? 0) > 0.25 ||
    (input.delayedUploadRatio ?? 0) > 0.35 ||
    (input.repeatedReconnects ?? 0) >= 3
  ) {
    reasons.push("Degraded telemetry or power state");
    possibleCauses.push("Weak network, poor GPS, power loss, or repeated reconnects");
    recommendedChecks.push("Inspect recent bus, sensor, network, and power simulation events");
    return { status: "degraded", reasons, possibleCauses, recommendedChecks };
  }
  if (input.firmwareCompatible === false || input.simStatus === "suspended") {
    reasons.push("Firmware or SIM warning");
    possibleCauses.push("Firmware compatibility metadata or SIM state needs review");
    recommendedChecks.push("Check firmware registry and SIM assignment");
    return { status: "warning", reasons, possibleCauses, recommendedChecks };
  }
  reasons.push("Recent telemetry and readiness inputs are acceptable");
  recommendedChecks.push("Continue monitoring simulated readiness");
  return { status: "healthy", reasons, possibleCauses, recommendedChecks };
}

export function validateSpnFmi(spn: number | null | undefined, fmi: number | null | undefined) {
  const issues: string[] = [];
  if (spn != null && (!Number.isInteger(spn) || spn < 0 || spn > 524287)) {
    issues.push("SPN must be an integer between 0 and 524287");
  }
  if (fmi != null && (!Number.isInteger(fmi) || fmi < 0 || fmi > 31)) {
    issues.push("FMI must be an integer between 0 and 31");
  }
  return { ok: issues.length === 0, issues };
}

export function validateSensorEvent(input: {
  sensorType: string;
  value?: number | boolean | string | null;
  simulated?: boolean;
}) {
  const validTypes: SensorType[] = [
    "imu",
    "shock",
    "tilt",
    "vibration",
    "tamper",
    "temperature",
    "door_open",
    "panic",
    "harsh_braking",
    "harsh_acceleration",
  ];
  const issues: string[] = [];
  if (!validTypes.includes(input.sensorType as SensorType)) issues.push("Unsupported sensor type");
  if (input.simulated !== true) issues.push("Phase 11 sensor events must be simulated");
  if (typeof input.value === "number" && !Number.isFinite(input.value)) {
    issues.push("Sensor value must be finite");
  }
  return { ok: issues.length === 0, issues };
}

export function validateSimulatedCommand(input: {
  commandType: SimulatedCommandType;
  deviceType: DeviceType;
  deviceStatus: DeviceStatus;
  simulated: boolean;
  deviceSimulated?: boolean;
  payload?: Record<string, unknown>;
}) {
  const issues: string[] = [];
  if (!input.simulated) issues.push("Phase 11 commands must be explicitly simulated");
  if (input.deviceSimulated !== true || input.deviceType !== "SIMULATOR") {
    issues.push("Phase 11 commands can only target simulator devices");
  }
  if (["retired", "blocked"].includes(input.deviceStatus))
    issues.push("Device cannot accept simulator commands");
  if (
    input.commandType === "set_firmware_version" &&
    typeof input.payload?.firmware_version !== "string"
  ) {
    issues.push("Firmware command requires firmware_version");
  }
  return { ok: issues.length === 0, issues };
}

export function commandIdempotencyKey(input: {
  companyId: string;
  deviceId: string;
  commandType: SimulatedCommandType;
  payload?: Record<string, unknown>;
}) {
  return [
    input.companyId.trim().toLowerCase(),
    input.deviceId.trim().toLowerCase(),
    input.commandType,
    JSON.stringify(input.payload ?? {}, Object.keys(input.payload ?? {}).sort()),
  ].join(":");
}

function parseSemver(value: string | null | undefined) {
  if (!value) return null;
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])] as const;
}

function compareSemver(a: string | null | undefined, b: string | null | undefined) {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return null;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export function isFirmwareCompatible(device: DeviceFirmwareInput, firmware: FirmwareVersion) {
  if (firmware.status !== "approved") return false;
  if (normalizeIdentifier(device.hardwareModel) !== normalizeIdentifier(firmware.hardwareModel))
    return false;
  if (firmware.minimumBootloader) {
    const bootloaderComparison = compareSemver(
      device.bootloaderVersion,
      firmware.minimumBootloader,
    );
    if (bootloaderComparison === null || bootloaderComparison < 0) return false;
  }
  if (
    firmware.minimumHardwareRevision &&
    normalizeIdentifier(device.hardwareRevision ?? "") <
      normalizeIdentifier(firmware.minimumHardwareRevision)
  ) {
    return false;
  }
  return true;
}

export function buildSimulatedGpsPoint(input: {
  pointId: string;
  profile: SimulatorProfile;
  source?: "ZAPP_BOX" | "P1" | "SIMULATOR";
  latitude: number | null;
  longitude: number | null;
  timestamp: string;
  sequenceNumber: number;
  speed?: number | null;
  heading?: number | null;
  accuracy?: number | null;
  altitude?: number | null;
  encoderVersion?: "json-v1" | "zct-ready-json-v1";
  ignitionOn?: boolean;
  externalPower?: boolean;
  backupBatteryPercent?: number;
  networkState?: NetworkState;
  deviceHealth?: DeviceHealth;
  firmwareVersion?: string;
}): SimulatedGpsPoint {
  return {
    telemetry_point_id: input.pointId,
    latitude: input.latitude,
    longitude: input.longitude,
    altitude: input.altitude ?? null,
    horizontal_accuracy: input.accuracy ?? null,
    device_speed: input.speed ?? null,
    heading: input.heading ?? null,
    device_timestamp: input.timestamp,
    movement_state: input.speed && input.speed > 0 ? "moving" : "stationary",
    sequence_number: input.sequenceNumber,
    telemetry_schema_version: 1,
    encoder_version: input.encoderVersion ?? "json-v1",
    simulated: true,
    simulation_label: "SIMULATED GPS",
    source: input.source ?? input.profile,
    ignition_state: input.ignitionOn === false ? "SIMULATED IGNITION OFF" : "SIMULATED IGNITION ON",
    external_power_state:
      input.externalPower === false ? "SIMULATED POWER LOST" : "SIMULATED POWER PRESENT",
    backup_battery_percent: input.backupBatteryPercent ?? 80,
    network_state: input.networkState ?? "gsm_online",
    device_health: input.deviceHealth ?? "healthy",
    firmware_version: input.firmwareVersion ?? "0.0.0-lab",
    profile: input.profile,
  };
}

export function buildSimulatedTelemetryBatch(input: {
  batchId: string;
  trackingSessionId: string;
  installationId: string;
  points: SimulatedGpsPoint[];
  encoderVersion?: "json-v1" | "zct-ready-json-v1";
}): SimulatedTelemetryBatch {
  const sortedPoints = input.points.slice().sort((a, b) => a.sequence_number - b.sequence_number);
  return {
    batch_id: input.batchId,
    tracking_session_id: input.trackingSessionId,
    installation_id: normalizeIdentifier(input.installationId),
    first_sequence: sortedPoints[0]?.sequence_number ?? 0,
    last_sequence: sortedPoints.at(-1)?.sequence_number ?? 0,
    encoder_version: input.encoderVersion ?? sortedPoints[0]?.encoder_version ?? "json-v1",
    telemetry_schema_version: 1,
    simulated: true,
    simulation_label: "SIMULATED TELEMETRY BATCH",
    points: sortedPoints,
  };
}

export function buildZappBoxSimulatorPoint(
  input: Omit<Parameters<typeof buildSimulatedGpsPoint>[0], "profile">,
) {
  return buildSimulatedGpsPoint({
    ...input,
    profile: "ZAPP_BOX",
    source: input.source ?? "ZAPP_BOX",
  });
}

export function buildP1SimulatorPoint(
  input: Omit<Parameters<typeof buildSimulatedGpsPoint>[0], "profile">,
) {
  return buildSimulatedGpsPoint({ ...input, profile: "P1", source: input.source ?? "P1" });
}

export function buildSimulatedBusEvent(
  input: Omit<SimulatedBusEvent, "simulated" | "simulation_label">,
) {
  const validation = validateSpnFmi(input.spn, input.fmi);
  if (!validation.ok) throw new Error(validation.issues.join("; "));
  return {
    ...input,
    simulated: true,
    simulation_label: "SIMULATED J1939/CAN",
  } satisfies SimulatedBusEvent;
}

export function buildSimulatedSensorEvent(
  input: Omit<SimulatedSensorEvent, "simulated" | "simulation_label">,
) {
  const validation = validateSensorEvent({
    sensorType: input.sensor_type,
    value: typeof input.value === "object" ? null : input.value,
    simulated: true,
  });
  if (!validation.ok) throw new Error(validation.issues.join("; "));
  return {
    ...input,
    simulated: true,
    simulation_label: "SIMULATED SENSOR",
  } satisfies SimulatedSensorEvent;
}
