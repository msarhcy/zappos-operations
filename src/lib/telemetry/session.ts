import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { telemetryFrom } from "./supabase-boundary";
import { capturePosition, queryLocationPermission, type CaptureErrorCode } from "./capture";
import { decideNextCapture } from "./adaptive-controller";
import { enqueueTelemetryPoint, getTelemetryQueueStats } from "./queue";
import { getDevicePlatform, getInstallationId, nextTelemetrySequence } from "./installation";
import { syncTelemetryQueue } from "./sync";
import { validateTelemetryQuality } from "./quality";
import {
  DRIVER_PHONE_SOURCE,
  JSON_ENCODER_VERSION,
  TELEMETRY_SCHEMA_VERSION,
  type CapturedPosition,
  type MovementState,
  type TelemetryPoint,
  type TrackingSession,
} from "./types";

interface DriverLike {
  id: string;
}

interface JobLike {
  id: string;
  driver_id: string | null;
  vehicle_id: string | null;
  status: string;
}

interface UseDriverTripTrackingArgs {
  driver: DriverLike | null;
  currentJob: JobLike | null;
}

export type DriverTrackingUiState =
  "inactive" | "permission_required" | "active" | "degraded" | "offline" | "syncing" | "completed";

export function useDriverTripTracking({ driver, currentJob }: UseDriverTripTrackingArgs) {
  const [session, setSession] = useState<TrackingSession | null>(null);
  const [permissionState, setPermissionState] = useState<PermissionState | "unsupported">("prompt");
  const [enabled, setEnabled] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [queuePending, setQueuePending] = useState(0);
  const [queueFailed, setQueueFailed] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [captureErrorCode, setCaptureErrorCode] = useState<CaptureErrorCode | null>(null);
  const [lastCapturedAt, setLastCapturedAt] = useState<string | null>(null);
  const [movementState, setMovementState] = useState<MovementState>("unknown");
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const previousPosition = useRef<CapturedPosition | null>(null);
  const timer = useRef<number | null>(null);
  const activeTrip =
    Boolean(driver && currentJob && currentJob.driver_id === driver.id) &&
    ["in_progress", "arrived"].includes(currentJob?.status ?? "");

  const refreshQueueStats = useCallback(async () => {
    try {
      const stats = await getTelemetryQueueStats();
      setQueuePending(stats.pending);
      setQueueFailed(stats.failed);
    } catch (error) {
      setQueuePending(0);
      setQueueFailed(1);
      setLastError(error instanceof Error ? error.message : "Local telemetry queue unavailable");
    }
  }, []);

  const refreshSession = useCallback(async () => {
    if (!activeTrip || !currentJob) {
      setSession(null);
      return;
    }
    const { data, error } = await telemetryFrom<TrackingSession>("tracking_sessions")
      .select("*")
      .eq("job_id", currentJob.id)
      .in("status", ["pending", "active", "paused", "degraded"])
      .maybeSingle();
    if (error) {
      setLastError(error.message);
      return;
    }
    setSession((data as TrackingSession | null) ?? null);
  }, [activeTrip, currentJob]);

  const syncNow = useCallback(async () => {
    if (!online || !session) return;
    setSyncing(true);
    try {
      const result = await syncTelemetryQueue(session.id);
      setLastError(result.error);
      if (!result.error) setLastSyncAt(new Date().toISOString());
    } finally {
      setSyncing(false);
      await refreshQueueStats();
    }
  }, [online, refreshQueueStats, session]);

  const captureOnce = useCallback(async () => {
    if (!session || !currentJob || !driver || !enabled || !activeTrip) return;
    try {
      const captured = await capturePosition();
      const decision = decideNextCapture({
        current: captured,
        previous: previousPosition.current,
        online,
      });
      const quality = validateTelemetryQuality({
        current: captured,
        previous: previousPosition.current,
      });
      const point: TelemetryPoint = {
        ...captured,
        telemetry_point_id: crypto.randomUUID(),
        tracking_session_id: session.id,
        job_id: currentJob.id,
        driver_id: driver.id,
        vehicle_id: currentJob.vehicle_id,
        source: DRIVER_PHONE_SOURCE,
        sequence_number: nextTelemetrySequence(session.id),
        movement_state: decision.movementState,
        quality_status: quality.status,
        quality_flags: quality.flags,
        telemetry_schema_version: TELEMETRY_SCHEMA_VERSION,
        encoder_version: JSON_ENCODER_VERSION,
      };
      await enqueueTelemetryPoint(point);
      previousPosition.current = captured;
      setMovementState(decision.movementState);
      setLastCapturedAt(captured.device_timestamp);
      setCaptureErrorCode(null);
      setLastError(null);
      await refreshQueueStats();
      if (online) void syncNow();
      timer.current = window.setTimeout(() => void captureOnce(), decision.intervalMs);
    } catch (error) {
      const code =
        error instanceof Error && "code" in error
          ? (error as { code: CaptureErrorCode }).code
          : null;
      setCaptureErrorCode(code);
      setLastError(error instanceof Error ? error.message : "Location capture failed");
      timer.current = window.setTimeout(() => void captureOnce(), 60_000);
    }
  }, [activeTrip, currentJob, driver, enabled, online, refreshQueueStats, session, syncNow]);

  const enableTracking = useCallback(async () => {
    setEnabled(true);
    const permission = await queryLocationPermission();
    setPermissionState(permission);
    void captureOnce();
  }, [captureOnce]);

  useEffect(() => {
    void queryLocationPermission().then(setPermissionState);
    void refreshQueueStats();
  }, [refreshQueueStats]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      void syncNow();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [syncNow]);

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    if (enabled && activeTrip && session) {
      timer.current = window.setTimeout(() => void captureOnce(), 500);
    }
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [activeTrip, captureOnce, enabled, session]);

  useEffect(() => {
    if (!activeTrip) setEnabled(false);
  }, [activeTrip]);

  useEffect(() => {
    if (!online || !session) return;
    const interval = window.setInterval(() => void syncNow(), 30_000);
    return () => window.clearInterval(interval);
  }, [online, session, syncNow]);

  const uiState = useMemo<DriverTrackingUiState>(() => {
    if (!activeTrip) return "inactive";
    if (!session) return "permission_required";
    if (syncing) return "syncing";
    if (!online) return "offline";
    if (
      captureErrorCode ||
      session.tracking_quality_status === "poor" ||
      session.status === "degraded"
    ) {
      return "degraded";
    }
    if (!enabled || permissionState === "prompt" || permissionState === "denied")
      return "permission_required";
    return "active";
  }, [activeTrip, captureErrorCode, enabled, online, permissionState, session, syncing]);

  return {
    session,
    activeTrip,
    uiState,
    permissionState,
    enabled,
    online,
    syncing,
    queuePending,
    queueFailed,
    lastError,
    captureErrorCode,
    lastCapturedAt,
    lastSyncAt,
    movementState,
    installationId: typeof window === "undefined" ? null : getInstallationId(),
    enableTracking,
    refreshSession,
    syncNow,
  };
}
