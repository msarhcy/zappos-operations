import { supabase } from "@/integrations/supabase/client";
import type { ProviderCacheRow } from "./types";

export const PROVIDER_TTLS = {
  weatherMs: 20 * 60 * 1000,
  trafficMs: 2 * 60 * 1000,
} as const;

const inFlight = new Map<string, Promise<unknown>>();

type ProviderCacheQuery<TPayload> = PromiseLike<{
  data: ProviderCacheRow<TPayload> | null;
  error: { message: string } | null;
}> & {
  select: (columns?: string) => ProviderCacheQuery<TPayload>;
  eq: (column: string, value: unknown) => ProviderCacheQuery<TPayload>;
  gt: (column: string, value: unknown) => ProviderCacheQuery<TPayload>;
  maybeSingle: () => PromiseLike<{
    data: ProviderCacheRow<TPayload> | null;
    error: { message: string } | null;
  }>;
  upsert: (
    row: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => {
    select: (columns?: string) => {
      single: () => PromiseLike<{
        data: ProviderCacheRow<TPayload> | null;
        error: { message: string } | null;
      }>;
    };
  };
};

function providerCacheFrom<TPayload>() {
  return (supabase as unknown as { from: (table: string) => ProviderCacheQuery<TPayload> }).from(
    "provider_observation_cache",
  );
}

interface CacheRequest<TPayload> {
  providerType: "weather" | "traffic";
  providerName: string;
  cacheKey: string;
  geographicCell: string;
  ttlMs: number;
  fetcher: () => Promise<{
    payload: TPayload;
    observedAt: string | null;
    retrievedAt: string;
    confidence: string;
    source: string;
  }>;
}

export async function getCachedProviderObservation<TPayload>({
  providerType,
  providerName,
  cacheKey,
  geographicCell,
  ttlMs,
  fetcher,
}: CacheRequest<TPayload>): Promise<ProviderCacheRow<TPayload> | null> {
  const { data: cached, error: cacheError } = await providerCacheFrom<TPayload>()
    .select("*")
    .eq("provider_type", providerType)
    .eq("provider_name", providerName)
    .eq("cache_key", cacheKey)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (!cacheError && cached) {
    return cached as ProviderCacheRow<TPayload>;
  }

  const flightKey = `${providerType}:${providerName}:${cacheKey}`;
  const existing = inFlight.get(flightKey) as
    Promise<ProviderCacheRow<TPayload> | null> | undefined;
  if (existing) return existing;

  const request = (async () => {
    const next = await fetcher();
    const expiresAt = new Date(Date.parse(next.retrievedAt) + ttlMs).toISOString();
    const row = {
      provider_type: providerType,
      provider_name: providerName,
      cache_key: cacheKey,
      geographic_cell: geographicCell,
      company_id: null,
      observed_at: next.observedAt,
      retrieved_at: next.retrievedAt,
      expires_at: expiresAt,
      confidence: next.confidence,
      source: next.source,
      normalized_payload: next.payload,
      raw_payload: null,
    };
    const { data, error } = await providerCacheFrom<TPayload>()
      .upsert(row, { onConflict: "provider_type,provider_name,cache_key" })
      .select("*")
      .single();
    if (error) {
      return {
        id: crypto.randomUUID(),
        ...row,
        created_at: next.retrievedAt,
        updated_at: next.retrievedAt,
      } as ProviderCacheRow<TPayload>;
    }
    return data as ProviderCacheRow<TPayload>;
  })().finally(() => {
    inFlight.delete(flightKey);
  });

  inFlight.set(flightKey, request);
  return request;
}
