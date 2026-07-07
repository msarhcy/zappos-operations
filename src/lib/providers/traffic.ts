import { createGeographicCacheKey } from "./cache-key";
import { getCachedProviderObservation, PROVIDER_TTLS } from "./cache";
import { confidenceFromProviderFreshness } from "./confidence";
import type { CongestionState, ProviderResult, TrafficObservation, TrafficProvider } from "./types";

interface TomTomFlowPayload {
  flowSegmentData?: {
    currentSpeed?: number;
    freeFlowSpeed?: number;
    currentTravelTime?: number;
    freeFlowTravelTime?: number;
    confidence?: number;
  };
  retrievedAt?: string;
  unavailableReason?: string;
}

export function congestionStateFromRatio(ratio: number | null): CongestionState {
  if (ratio === null || !Number.isFinite(ratio)) return "unknown";
  if (ratio >= 0.85) return "free_flow";
  if (ratio >= 0.7) return "light";
  if (ratio >= 0.5) return "moderate";
  if (ratio >= 0.3) return "heavy";
  return "severe";
}

export function normalizeTomTomTraffic(
  payload: TomTomFlowPayload,
): Omit<TrafficObservation, "metadata"> {
  const current = payload.flowSegmentData?.currentSpeed ?? null;
  const free = payload.flowSegmentData?.freeFlowSpeed ?? null;
  const ratio = current !== null && free !== null && free > 0 ? current / free : null;
  return {
    currentFlowSpeedKph: current,
    freeFlowSpeedKph: free,
    congestionRatio: ratio,
    congestionState: congestionStateFromRatio(ratio),
  };
}

export class DisabledTrafficProvider implements TrafficProvider {
  providerName = "disabled";

  async getTrafficNearLocation(): Promise<ProviderResult<TrafficObservation>> {
    return { observation: null, unavailableReason: "Traffic provider unavailable" };
  }
}

export class TomTomTrafficProvider implements TrafficProvider {
  providerName = "tomtom";

  async getTrafficNearLocation(input: {
    latitude: number;
    longitude: number;
  }): Promise<ProviderResult<TrafficObservation>> {
    const key = createGeographicCacheKey("traffic", input.latitude, input.longitude);
    try {
      const cached = await getCachedProviderObservation({
        providerType: "traffic",
        providerName: this.providerName,
        cacheKey: key.cacheKey,
        geographicCell: key.geographicCell,
        ttlMs: PROVIDER_TTLS.trafficMs,
        fetcher: async () => {
          const retrievedAt = new Date().toISOString();
          const response = await fetch(
            `/api/providers/tomtom-flow?lat=${encodeURIComponent(input.latitude)}&lng=${encodeURIComponent(input.longitude)}`,
          );
          if (!response.ok) throw new Error(`TomTom proxy returned ${response.status}`);
          const data = (await response.json()) as TomTomFlowPayload;
          if (data.unavailableReason) throw new Error(data.unavailableReason);
          return {
            payload: normalizeTomTomTraffic(data),
            observedAt: null,
            retrievedAt: data.retrievedAt ?? retrievedAt,
            confidence: "medium",
            source: "TomTom Traffic Flow API",
          };
        },
      });
      if (!cached) return { observation: null, unavailableReason: "Traffic unavailable" };
      const confidence = confidenceFromProviderFreshness({
        observedAt: cached.observed_at,
        retrievedAt: cached.retrieved_at,
        expiresAt: cached.expires_at,
      });
      return {
        observation: {
          ...cached.normalized_payload,
          metadata: {
            providerType: "traffic",
            providerName: this.providerName,
            source: cached.source,
            confidence,
            freshness: {
              observedAt: cached.observed_at,
              retrievedAt: cached.retrieved_at,
              expiresAt: cached.expires_at,
            },
            fromCache: true,
          },
        },
        unavailableReason: null,
      };
    } catch (error) {
      return {
        observation: null,
        unavailableReason: error instanceof Error ? error.message : "Traffic unavailable",
      };
    }
  }
}
