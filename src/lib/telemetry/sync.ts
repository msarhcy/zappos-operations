import { telemetryRpc } from "./supabase-boundary";
import type { Json } from "@/integrations/supabase/types";
import { getInstallationId } from "./installation";
import { JSONTelemetryEncoderV1 } from "./json-encoder-v1";
import {
  JSON_ENCODER_VERSION,
  TELEMETRY_SCHEMA_VERSION,
  type TelemetryBatchEnvelope,
  type TelemetryIngestAck,
  type TelemetryPoint,
} from "./types";
import {
  acknowledgeTelemetryPoints,
  getPendingTelemetryPoints,
  updateTelemetryQueueState,
} from "./queue";

const encoder = new JSONTelemetryEncoderV1();
const inFlightSessions = new Set<string>();

export interface SyncResult {
  uploaded: number;
  acknowledged: number;
  conflicts: number;
  error: string | null;
}

export function createTelemetryBatch(points: TelemetryPoint[]): TelemetryBatchEnvelope {
  if (points.length === 0) {
    throw new Error("Cannot create an empty telemetry batch");
  }
  const sorted = [...points].sort((a, b) => a.sequence_number - b.sequence_number);
  return {
    batch_id: crypto.randomUUID(),
    tracking_session_id: sorted[0].tracking_session_id,
    installation_id: getInstallationId(),
    first_sequence: sorted[0].sequence_number,
    last_sequence: sorted[sorted.length - 1].sequence_number,
    encoder_version: JSON_ENCODER_VERSION,
    telemetry_schema_version: TELEMETRY_SCHEMA_VERSION,
    points: encoder.encode(sorted),
  };
}

export async function syncTelemetryQueue(
  trackingSessionId?: string,
  limit = 30,
): Promise<SyncResult> {
  const inFlightKey = trackingSessionId ?? "__all__";
  if (inFlightSessions.has(inFlightKey)) {
    return { uploaded: 0, acknowledged: 0, conflicts: 0, error: null };
  }
  inFlightSessions.add(inFlightKey);
  try {
    const pending = await getPendingTelemetryPoints(trackingSessionId, limit);
    if (pending.length === 0) return { uploaded: 0, acknowledged: 0, conflicts: 0, error: null };

    const ids = pending.map((point) => point.telemetry_point_id);
    const batch = createTelemetryBatch(pending);

    await updateTelemetryQueueState(ids, "batched");
    const { data, error } = await telemetryRpc().rpc("ingest_tracking_telemetry", {
      _batch: batch as unknown as Json,
    });

    if (error) {
      await updateTelemetryQueueState(ids, "failed", error.message);
      return { uploaded: pending.length, acknowledged: 0, conflicts: 0, error: error.message };
    }

    const ack = data as unknown as TelemetryIngestAck;
    const acknowledged = Array.isArray(ack?.acknowledged_point_ids)
      ? ack.acknowledged_point_ids
      : [];
    const conflicts = Array.isArray(ack?.conflict_point_ids) ? ack.conflict_point_ids : [];
    await acknowledgeTelemetryPoints(acknowledged);

    if (conflicts.length > 0) {
      await updateTelemetryQueueState(conflicts, "failed", "Server reported telemetry conflict");
    }

    const missing = ids.filter((id) => !acknowledged.includes(id) && !conflicts.includes(id));
    if (missing.length > 0) {
      await updateTelemetryQueueState(missing, "failed", "Server did not acknowledge point");
    }

    return {
      uploaded: pending.length,
      acknowledged: acknowledged.length,
      conflicts: conflicts.length,
      error: conflicts.length > 0 ? "Server reported telemetry conflict" : null,
    };
  } finally {
    inFlightSessions.delete(inFlightKey);
  }
}
