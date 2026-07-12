import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  Activity,
  Cpu,
  HardDrive,
  KeyRound,
  Radio,
  Router,
  Satellite,
  ShieldCheck,
  Smartphone,
  Zap,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/operational-state";
import { StatusBadge } from "@/components/ui/status-badge-detailed";
import { useCompany } from "@/lib/company-context";
import {
  maskIdentifier,
  scoreDeviceHealth,
  validateSimulatedCommand,
  type DeviceHealth,
  type DeviceStatus,
  type DeviceType,
} from "@/lib/device-lab/phase11";

export const Route = createFileRoute("/_authenticated/hardware-readiness")({
  head: () => ({ meta: [{ title: "Hardware Readiness — ZappOS" }] }),
  component: HardwareReadinessPage,
});

interface DeviceRow {
  id: string;
  company_id: string;
  device_type: DeviceType;
  serial_number: string;
  hardware_model: string;
  hardware_revision: string | null;
  imei: string | null;
  installation_id: string | null;
  status: DeviceStatus;
  firmware_version: string | null;
  bootloader_version: string | null;
  telemetry_source: string;
  simulated: boolean;
  simulation_label: string | null;
  provisioning_state: string;
  last_seen_at: string | null;
  updated_at: string;
}

interface SimRow {
  id: string;
  iccid: string;
  msisdn: string | null;
  provider: string | null;
  status: string;
  assigned_device_id: string | null;
  primary_sim: boolean;
  last_network_seen_at: string | null;
}

interface AssignmentRow {
  id: string;
  device_id: string;
  vehicle_id: string;
  assignment_type: string;
  status: string;
  simulated: boolean;
  assigned_at: string | null;
}

interface BusEventRow {
  id: string;
  device_id: string;
  event_type: string;
  spn: number | null;
  fmi: number | null;
  value: number | null;
  unit: string | null;
  severity: string;
  simulated: boolean;
  observed_at: string;
}

interface SensorEventRow {
  id: string;
  device_id: string;
  sensor_type: string;
  severity: string;
  simulated: boolean;
  observed_at: string;
}

interface FirmwareRow {
  id: string;
  version: string;
  channel: string;
  hardware_model: string;
  status: string;
}

interface CommandAuditRow {
  id: string;
  device_id: string;
  command_type: string;
  result_status: string;
  simulated: boolean;
  requested_at: string;
}

function secondsSince(value: string | null | undefined) {
  if (!value) return null;
  return Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
}

function relativeAge(value: string | null | undefined) {
  const seconds = secondsSince(value);
  if (seconds == null) return "never";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

function HardwareReadinessPage() {
  const { activeCompany, hasAnyRole } = useCompany();
  const activeCompanyId = activeCompany?.id;
  const canRead = hasAnyRole(["admin", "fleet_manager", "dispatcher", "viewer"]);
  const canRunSimulation = hasAnyRole(["admin", "fleet_manager", "dispatcher"]);
  const requestRef = useRef(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [sims, setSims] = useState<SimRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [busEvents, setBusEvents] = useState<BusEventRow[]>([]);
  const [sensorEvents, setSensorEvents] = useState<SensorEventRow[]>([]);
  const [firmware, setFirmware] = useState<FirmwareRow[]>([]);
  const [commands, setCommands] = useState<CommandAuditRow[]>([]);
  const [commandBusy, setCommandBusy] = useState(false);

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
        deviceResult,
        simResult,
        assignmentResult,
        busResult,
        sensorResult,
        firmwareResult,
        commandResult,
      ] = await Promise.all([
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
          .from("device_vehicle_assignments" as never)
          .select("*")
          .eq("company_id", activeCompanyId)
          .order("updated_at", { ascending: false })
          .limit(200),
        supabase
          .from("device_bus_events" as never)
          .select("*")
          .eq("company_id", activeCompanyId)
          .order("observed_at", { ascending: false })
          .limit(80),
        supabase
          .from("device_sensor_events" as never)
          .select("*")
          .eq("company_id", activeCompanyId)
          .order("observed_at", { ascending: false })
          .limit(80),
        supabase
          .from("device_firmware_versions" as never)
          .select("*")
          .eq("company_id", activeCompanyId)
          .order("created_at", { ascending: false })
          .limit(80),
        supabase
          .from("device_command_audit" as never)
          .select("*")
          .eq("company_id", activeCompanyId)
          .order("requested_at", { ascending: false })
          .limit(80),
      ]);

      if (requestId !== requestRef.current) return;
      for (const result of [
        deviceResult,
        simResult,
        assignmentResult,
        busResult,
        sensorResult,
        firmwareResult,
        commandResult,
      ]) {
        if (result.error) throw result.error;
      }

      const nextDevices = (deviceResult.data ?? []) as unknown as DeviceRow[];
      setDevices(nextDevices);
      setSims((simResult.data ?? []) as unknown as SimRow[]);
      setAssignments((assignmentResult.data ?? []) as unknown as AssignmentRow[]);
      setBusEvents((busResult.data ?? []) as unknown as BusEventRow[]);
      setSensorEvents((sensorResult.data ?? []) as unknown as SensorEventRow[]);
      setFirmware((firmwareResult.data ?? []) as unknown as FirmwareRow[]);
      setCommands((commandResult.data ?? []) as unknown as CommandAuditRow[]);
      setSelectedDeviceId((current) =>
        current && nextDevices.some((item) => item.id === current)
          ? current
          : (nextDevices[0]?.id ?? null),
      );
    } catch (err) {
      if (requestId === requestRef.current) {
        setError(err instanceof Error ? err.message : "Could not load hardware readiness");
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [activeCompanyId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 45_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    requestRef.current += 1;
    setSelectedDeviceId(null);
    setDevices([]);
    setSims([]);
    setAssignments([]);
    setBusEvents([]);
    setSensorEvents([]);
    setFirmware([]);
    setCommands([]);
    setError(null);
  }, [activeCompanyId]);

  const selectedDevice = selectedDeviceId
    ? (devices.find((device) => device.id === selectedDeviceId) ?? null)
    : null;
  const selectedSim = selectedDevice
    ? (sims.find((sim) => sim.assigned_device_id === selectedDevice.id) ?? null)
    : null;
  const selectedAssignment = selectedDevice
    ? (assignments.find(
        (assignment) =>
          assignment.device_id === selectedDevice.id && assignment.status === "active",
      ) ?? null)
    : null;
  const selectedTelemetryQuality =
    selectedDevice?.status === "degraded"
      ? "poor simulated GPS/network"
      : "acceptable simulated input";
  const selectedGpsState =
    selectedDevice?.status === "degraded" ? "SIMULATED GPS degraded" : "SIMULATED GPS ready";
  const selectedNetworkState =
    selectedSim?.status === "active" ? "SIMULATED GSM online" : "SIMULATED GSM weak or unavailable";
  const selectedPowerState =
    selectedDevice?.status === "inactive" ? "SIMULATED POWER lost" : "SIMULATED POWER present";
  const selectedIgnitionState =
    selectedDevice?.status === "inactive" ? "SIMULATED IGNITION off" : "SIMULATED IGNITION on";
  const selectedBackupBattery =
    selectedDevice?.status === "maintenance" ? "18% simulated" : "80% simulated";

  const diagnostics = useMemo(() => {
    if (!selectedDevice) return null;
    return scoreDeviceHealth({
      now: new Date(),
      lastSeenAt: selectedDevice.last_seen_at,
      gpsQuality: selectedDevice.status === "degraded" ? "poor" : "acceptable",
      networkState: selectedSim?.status === "active" ? "gsm_online" : "weak_network",
      externalPower: selectedDevice.status !== "inactive",
      backupBatteryPercent: selectedDevice.status === "maintenance" ? 18 : 80,
      firmwareCompatible: firmware.some(
        (item) =>
          item.hardware_model === selectedDevice.hardware_model &&
          item.version === selectedDevice.firmware_version &&
          item.status === "approved",
      ),
      telemetryRejectionRatio: selectedDevice.status === "degraded" ? 0.3 : 0.02,
      delayedUploadRatio: selectedSim?.status === "suspended" ? 0.5 : 0.02,
      simStatus: selectedSim?.status as never,
      repeatedReconnects: selectedDevice.status === "degraded" ? 3 : 0,
    });
  }, [firmware, selectedDevice, selectedSim]);

  const runCommand = async (commandType: string, payload: Record<string, unknown> = {}) => {
    if (!activeCompanyId || !selectedDevice || commandBusy) return;
    const validation = validateSimulatedCommand({
      commandType: commandType as never,
      deviceType: selectedDevice.device_type,
      deviceStatus: selectedDevice.status,
      simulated: true,
      payload,
    });
    if (!validation.ok) {
      setError(validation.issues.join("; "));
      return;
    }
    setCommandBusy(true);
    try {
      const { error: commandError } = await (
        supabase as unknown as {
          rpc: (
            name: string,
            args: Record<string, unknown>,
          ) => Promise<{ error: { message: string } | null }>;
        }
      ).rpc("execute_simulated_device_command", {
        _company_id: activeCompanyId,
        _device_id: selectedDevice.id,
        _command_type: commandType,
        _request_payload: payload,
        _idempotency_key: `${selectedDevice.id}:${commandType}:${JSON.stringify(payload)}`,
      });
      if (commandError) setError(commandError.message);
      await load();
    } finally {
      setCommandBusy(false);
    }
  };

  if (!canRead) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
        <ErrorState
          title="Hardware readiness is restricted"
          description="Drivers cannot access the fleet hardware lab."
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
        <LoadingState label="Loading hardware readiness" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-4 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Phase 11
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Hardware readiness lab</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Simulation-only Zapp Box and P1 readiness. No physical device command is sent.
          </p>
        </div>
        <StatusBadge status="SIMULATED ONLY" variant="small" />
      </div>

      {error ? <ErrorState title="Hardware readiness notice" description={error} /> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric icon={HardDrive} label="Devices" value={devices.length} />
        <Metric icon={Smartphone} label="SIM / eSIM" value={sims.length} />
        <Metric
          icon={Router}
          label="Active assignments"
          value={assignments.filter((item) => item.status === "active").length}
        />
        <Metric icon={Activity} label="Simulated bus events" value={busEvents.length} />
        <Metric icon={ShieldCheck} label="Command audit" value={commands.length} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-4">
          <DeviceRegistry
            devices={devices}
            selectedDeviceId={selectedDeviceId}
            onSelect={setSelectedDeviceId}
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <CompactPanel
              title="SIM registry"
              empty="No SIM records yet."
              items={sims.slice(0, 8).map((sim) => ({
                id: sim.id,
                label: `${maskIdentifier(sim.iccid)} · ${sim.status}`,
                detail: sim.provider ?? "provider not set",
              }))}
            />
            <CompactPanel
              title="Firmware compatibility"
              empty="No firmware metadata yet."
              items={firmware.slice(0, 8).map((item) => ({
                id: item.id,
                label: `${item.version} · ${item.channel}`,
                detail: `${item.hardware_model} · ${item.status}`,
              }))}
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <EventPanel
              title="Recent simulated J1939 / CAN"
              icon={Cpu}
              empty="No simulated bus events."
              events={busEvents.map((event) => ({
                id: event.id,
                label: `${event.event_type.replaceAll("_", " ")} · ${event.value ?? "-"} ${event.unit ?? ""}`,
                detail: `SIMULATED · SPN ${event.spn ?? "-"} · FMI ${event.fmi ?? "-"} · ${relativeAge(event.observed_at)} ago`,
                severity: event.severity,
              }))}
            />
            <EventPanel
              title="Recent simulated sensors"
              icon={Satellite}
              empty="No simulated sensor events."
              events={sensorEvents.map((event) => ({
                id: event.id,
                label: event.sensor_type.replaceAll("_", " "),
                detail: `SIMULATED · ${relativeAge(event.observed_at)} ago`,
                severity: event.severity,
              }))}
            />
          </div>
        </div>

        <div className="space-y-4">
          <DiagnosticsPanel
            device={selectedDevice}
            sim={selectedSim}
            assignment={selectedAssignment}
            health={diagnostics}
            gpsState={selectedGpsState}
            networkState={selectedNetworkState}
            powerState={selectedPowerState}
            ignitionState={selectedIgnitionState}
            backupBattery={selectedBackupBattery}
            telemetryQuality={selectedTelemetryQuality}
          />
          <CommandPanel
            canRun={canRunSimulation}
            busy={commandBusy}
            device={selectedDevice}
            onCommand={runCommand}
          />
          <EventPanel
            title="Command audit"
            icon={KeyRound}
            empty="No simulated commands."
            events={commands.map((command) => ({
              id: command.id,
              label: command.command_type.replaceAll("_", " "),
              detail: `SIMULATED · ${command.result_status} · ${relativeAge(command.requested_at)} ago`,
              severity: command.result_status === "failed" ? "critical" : "info",
            }))}
          />
        </div>
      </div>
    </div>
  );
}

function DeviceRegistry({
  devices,
  selectedDeviceId,
  onSelect,
}: {
  devices: DeviceRow[];
  selectedDeviceId: string | null;
  onSelect: (deviceId: string) => void;
}) {
  if (devices.length === 0) {
    return (
      <Card className="p-4">
        <EmptyState
          title="No hardware readiness devices"
          description="Register simulated Zapp Box or P1 devices after applying Phase 11 data."
          icon={HardDrive}
        />
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border p-4">
        <p className="font-semibold">Device registry</p>
      </div>
      <div className="max-h-[560px] divide-y divide-border overflow-auto">
        {devices.map((device) => (
          <button
            key={device.id}
            type="button"
            onClick={() => onSelect(device.id)}
            className={`grid w-full gap-3 p-4 text-left text-sm md:grid-cols-[1.2fr_1fr_1fr_auto] ${
              selectedDeviceId === device.id ? "bg-muted" : ""
            }`}
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{maskIdentifier(device.serial_number)}</p>
              <p className="truncate text-xs text-muted-foreground">
                {device.device_type} ·{" "}
                {device.simulated ? "SIMULATED DEVICE" : "future hardware record"}
              </p>
            </div>
            <Field
              label="Model"
              value={`${device.hardware_model} ${device.hardware_revision ?? ""}`}
            />
            <Field label="Last seen" value={relativeAge(device.last_seen_at)} />
            <StatusBadge status={device.status} variant="small" />
          </button>
        ))}
      </div>
    </Card>
  );
}

function DiagnosticsPanel({
  device,
  sim,
  assignment,
  health,
  gpsState,
  networkState,
  powerState,
  ignitionState,
  backupBattery,
  telemetryQuality,
}: {
  device: DeviceRow | null;
  sim: SimRow | null;
  assignment: AssignmentRow | null;
  health: {
    status: DeviceHealth;
    reasons: string[];
    possibleCauses: string[];
    recommendedChecks: string[];
  } | null;
  gpsState: string;
  networkState: string;
  powerState: string;
  ignitionState: string;
  backupBattery: string;
  telemetryQuality: string;
}) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <Zap className="h-4 w-4 text-muted-foreground" />
        <p className="font-semibold">Device diagnostics</p>
      </div>
      {device ? (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Device" value={maskIdentifier(device.serial_number)} />
            <Field label="IMEI" value={maskIdentifier(device.imei)} />
            <Field label="SIM ICCID" value={maskIdentifier(sim?.iccid)} />
            <Field label="Assignment" value={assignment?.assignment_type ?? "none"} />
            <Field label="Provisioning" value={device.provisioning_state} />
            <Field label="Firmware" value={device.firmware_version ?? "not set"} />
            <Field label="Bootloader" value={device.bootloader_version ?? "not set"} />
            <Field label="GPS state" value={gpsState} />
            <Field label="Network state" value={networkState} />
            <Field label="Power state" value={powerState} />
            <Field label="Ignition state" value={ignitionState} />
            <Field label="Backup battery" value={backupBattery} />
            <Field label="Telemetry quality" value={telemetryQuality} />
          </div>
          <div className="rounded-md border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">Health</span>
              <StatusBadge status={health?.status ?? "unknown"} variant="small" />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Possible causes</p>
            <p className="text-sm">
              {health?.possibleCauses.join("; ") || "No confirmed fault. Simulation evidence only."}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">Recommended checks</p>
            <p className="text-sm">
              {health?.recommendedChecks.join("; ") || "Continue monitoring simulated readiness."}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Select a device to inspect diagnostics.</p>
      )}
    </Card>
  );
}

function CommandPanel({
  canRun,
  busy,
  device,
  onCommand,
}: {
  canRun: boolean;
  busy: boolean;
  device: DeviceRow | null;
  onCommand: (commandType: string, payload?: Record<string, unknown>) => void;
}) {
  const disabled = !canRun || !device || busy;
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <Radio className="h-4 w-4 text-muted-foreground" />
        <p className="font-semibold">Simulated command boundary</p>
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        Commands are audited simulation records only. No MQTT, SMS, USSD, HTTP hardware call, or
        firmware deployment.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button disabled={disabled} onClick={() => onCommand("request_status")}>
          Status
        </Button>
        <Button disabled={disabled} variant="outline" onClick={() => onCommand("request_gps_fix")}>
          GPS fix
        </Button>
        <Button
          disabled={disabled}
          variant="outline"
          onClick={() => onCommand("simulate_network_loss")}
        >
          Network loss
        </Button>
        <Button
          disabled={disabled}
          variant="outline"
          onClick={() => onCommand("simulate_reconnect")}
        >
          Reconnect
        </Button>
        <Button
          disabled={disabled}
          variant="outline"
          onClick={() => onCommand("switch_ignition", { state: "SIMULATED IGNITION ON" })}
        >
          Ignition
        </Button>
        <Button
          disabled={disabled}
          variant="outline"
          onClick={() => onCommand("trigger_sos", { source: "SIMULATED SOS" })}
        >
          SOS
        </Button>
      </div>
    </Card>
  );
}

function CompactPanel({
  title,
  items,
  empty,
}: {
  title: string;
  items: Array<{ id: string; label: string; detail: string }>;
  empty: string;
}) {
  return (
    <Card className="p-4">
      <p className="font-semibold">{title}</p>
      <div className="mt-3 max-h-72 space-y-2 overflow-auto text-sm">
        {items.length === 0 ? <p className="text-muted-foreground">{empty}</p> : null}
        {items.map((item) => (
          <div key={item.id} className="rounded-md border border-border p-2">
            <p className="font-medium">{item.label}</p>
            <p className="text-xs text-muted-foreground">{item.detail}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function EventPanel({
  title,
  icon: Icon,
  events,
  empty,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  events: Array<{ id: string; label: string; detail: string; severity: string }>;
  empty: string;
}) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <p className="font-semibold">{title}</p>
      </div>
      <div className="max-h-80 space-y-2 overflow-auto text-sm">
        {events.length === 0 ? <p className="text-muted-foreground">{empty}</p> : null}
        {events.slice(0, 20).map((event) => (
          <div key={event.id} className="rounded-md border border-border p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{event.label}</span>
              <StatusBadge status={event.severity} variant="small" />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{event.detail}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate">{value}</p>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </Card>
  );
}
