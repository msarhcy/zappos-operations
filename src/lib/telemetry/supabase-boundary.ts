import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export interface SupabaseBoundaryError {
  message: string;
}

export interface SupabaseBoundaryResult<T> {
  data: T | null;
  error: SupabaseBoundaryError | null;
}

export type TelemetryQuery<T> = PromiseLike<SupabaseBoundaryResult<T[]>> & {
  select: (columns?: string) => TelemetryQuery<T>;
  eq: (column: string, value: unknown) => TelemetryQuery<T>;
  gte: (column: string, value: unknown) => TelemetryQuery<T>;
  in: (column: string, values: unknown[]) => TelemetryQuery<T>;
  order: (column: string, options?: Record<string, unknown>) => TelemetryQuery<T>;
  limit: (count: number) => TelemetryQuery<T>;
  maybeSingle: () => PromiseLike<SupabaseBoundaryResult<T | null>>;
};

interface TelemetryRpcClient {
  rpc: (
    name: "ingest_tracking_telemetry",
    args: { _batch: Json },
  ) => PromiseLike<SupabaseBoundaryResult<Json>>;
}

interface TelemetryFromClient {
  from: <T>(table: string) => TelemetryQuery<T>;
}

export function telemetryRpc() {
  return supabase as unknown as TelemetryRpcClient;
}

export function telemetryFrom<T>(table: string) {
  return (supabase as unknown as TelemetryFromClient).from<T>(table);
}
