export const TELEMETRY_SCHEMA_VERSION = 1;
export const JSON_ENCODER_VERSION = "json-v1";
export const DRIVER_PHONE_SOURCE = "DRIVER_PHONE";

export type TelemetrySource =
  "DRIVER_PHONE" | "ZAPP_BOX" | "P1" | "ROAD_NODE" | "THIRD_PARTY_TELEMATICS" | "SIMULATOR";

export type MovementState = "moving" | "stationary" | "unknown";
export type QualityStatus = "high" | "acceptable" | "poor" | "rejected";
export type TrackingStatus =
  "pending" | "active" | "paused" | "degraded" | "completed" | "terminated";
export type QueueState = "pending" | "batched" | "acknowledged" | "failed";

export interface CapturedPosition {
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  horizontal_accuracy: number | null;
  vertical_accuracy: number | null;
  device_speed: number | null;
  heading: number | null;
  device_timestamp: string;
}

export interface TelemetryPoint extends CapturedPosition {
  telemetry_point_id: string;
  tracking_session_id: string;
  job_id: string;
  driver_id: string;
  vehicle_id: string | null;
  source: TelemetrySource;
  sequence_number: number;
  movement_state: MovementState;
  quality_status: QualityStatus;
  quality_flags: string[];
  telemetry_schema_version: number;
  encoder_version: string;
}

export interface QueuedTelemetryPoint extends TelemetryPoint {
  queue_state: QueueState;
  attempts: number;
  queued_at: string;
  last_attempt_at: string | null;
  last_error: string | null;
}

export interface TelemetryBatchEnvelope<TPoint = TelemetryPoint> {
  batch_id: string;
  tracking_session_id: string;
  installation_id: string;
  first_sequence: number;
  last_sequence: number;
  encoder_version: string;
  telemetry_schema_version: number;
  points: TPoint[];
}

export interface TelemetryIngestAck {
  ok: boolean;
  batch_id: string;
  acknowledged_point_ids: string[];
  conflict_point_ids?: string[];
  rejected_point_ids?: string[];
  inserted_count: number;
}

export interface TrackingSession {
  id: string;
  company_id: string;
  job_id: string;
  driver_id: string;
  vehicle_id: string | null;
  status: TrackingStatus;
  source: TelemetrySource;
  started_at: string | null;
  ended_at: string | null;
  tracking_quality_status: QualityStatus;
  last_telemetry_at: string | null;
}
