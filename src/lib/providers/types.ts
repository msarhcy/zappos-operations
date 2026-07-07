export type ConfidenceLevel = "high" | "medium" | "low" | "insufficient_data";

export interface ConfidenceResult {
  level: ConfidenceLevel;
  reasons: string[];
}

export interface ProviderFreshness {
  observedAt: string | null;
  retrievedAt: string;
  expiresAt?: string | null;
}

export interface ProviderMetadata {
  providerType: "weather" | "traffic";
  providerName: string;
  source: string;
  confidence: ConfidenceResult;
  freshness: ProviderFreshness;
  fromCache: boolean;
}

export interface WeatherObservation {
  temperatureC: number | null;
  precipitationMm: number | null;
  weatherCode: number | null;
  condition: string | null;
  windSpeedKph: number | null;
  windDirectionDegrees: number | null;
  visibilityMeters: number | null;
  metadata: ProviderMetadata;
}

export type CongestionState = "free_flow" | "light" | "moderate" | "heavy" | "severe" | "unknown";

export interface TrafficObservation {
  currentFlowSpeedKph: number | null;
  freeFlowSpeedKph: number | null;
  congestionRatio: number | null;
  congestionState: CongestionState;
  metadata: ProviderMetadata;
}

export interface ProviderResult<TObservation> {
  observation: TObservation | null;
  unavailableReason: string | null;
}

export interface WeatherProvider {
  providerName: string;
  getWeatherNearLocation(input: {
    latitude: number;
    longitude: number;
  }): Promise<ProviderResult<WeatherObservation>>;
}

export interface TrafficProvider {
  providerName: string;
  getTrafficNearLocation(input: {
    latitude: number;
    longitude: number;
  }): Promise<ProviderResult<TrafficObservation>>;
}

export interface ProviderCacheRow<TPayload> {
  id: string;
  provider_type: "weather" | "traffic";
  provider_name: string;
  cache_key: string;
  geographic_cell: string;
  observed_at: string | null;
  retrieved_at: string;
  expires_at: string;
  confidence: ConfidenceLevel;
  source: string;
  normalized_payload: TPayload;
}
