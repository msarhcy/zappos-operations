import { createGeographicCacheKey } from "./cache-key";
import { getCachedProviderObservation, PROVIDER_TTLS } from "./cache";
import { confidenceFromProviderFreshness } from "./confidence";
import type { ProviderResult, WeatherObservation, WeatherProvider } from "./types";

interface OpenMeteoCurrent {
  time?: string;
  temperature_2m?: number;
  precipitation?: number;
  weather_code?: number;
  wind_speed_10m?: number;
  wind_direction_10m?: number;
}

interface OpenMeteoResponse {
  current?: OpenMeteoCurrent;
}

export function conditionFromOpenMeteoCode(code: number | null) {
  if (code === null) return null;
  if (code === 0) return "Clear";
  if ([1, 2, 3].includes(code)) return "Cloud cover";
  if ([45, 48].includes(code)) return "Fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if ([95, 96, 99].includes(code)) return "Thunderstorm";
  return `Weather code ${code}`;
}

export function normalizeOpenMeteoWeather(
  payload: OpenMeteoResponse,
  retrievedAt = new Date().toISOString(),
): Omit<WeatherObservation, "metadata"> {
  const current = payload.current ?? {};
  const weatherCode = current.weather_code ?? null;
  return {
    temperatureC: current.temperature_2m ?? null,
    precipitationMm: current.precipitation ?? null,
    weatherCode,
    condition: conditionFromOpenMeteoCode(weatherCode),
    windSpeedKph: current.wind_speed_10m ?? null,
    windDirectionDegrees: current.wind_direction_10m ?? null,
    visibilityMeters: null,
  };
}

export class DisabledWeatherProvider implements WeatherProvider {
  providerName = "disabled";

  async getWeatherNearLocation(): Promise<ProviderResult<WeatherObservation>> {
    return { observation: null, unavailableReason: "Weather provider unavailable" };
  }
}

export class OpenMeteoProvider implements WeatherProvider {
  providerName = "open-meteo";

  async getWeatherNearLocation(input: {
    latitude: number;
    longitude: number;
  }): Promise<ProviderResult<WeatherObservation>> {
    const key = createGeographicCacheKey("weather", input.latitude, input.longitude);
    try {
      const cached = await getCachedProviderObservation({
        providerType: "weather",
        providerName: this.providerName,
        cacheKey: key.cacheKey,
        geographicCell: key.geographicCell,
        ttlMs: PROVIDER_TTLS.weatherMs,
        fetcher: async () => {
          const retrievedAt = new Date().toISOString();
          const url = new URL("https://api.open-meteo.com/v1/forecast");
          url.searchParams.set("latitude", String(input.latitude));
          url.searchParams.set("longitude", String(input.longitude));
          url.searchParams.set(
            "current",
            "temperature_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m",
          );
          url.searchParams.set("wind_speed_unit", "kmh");
          const response = await fetch(url);
          if (!response.ok) throw new Error(`Open-Meteo returned ${response.status}`);
          const data = (await response.json()) as OpenMeteoResponse;
          return {
            payload: normalizeOpenMeteoWeather(data, retrievedAt),
            observedAt: data.current?.time ? new Date(data.current.time).toISOString() : null,
            retrievedAt,
            confidence: "medium",
            source: "Open-Meteo public forecast API",
          };
        },
      });
      if (!cached) return { observation: null, unavailableReason: "Weather unavailable" };
      const confidence = confidenceFromProviderFreshness({
        observedAt: cached.observed_at,
        retrievedAt: cached.retrieved_at,
        expiresAt: cached.expires_at,
      });
      return {
        observation: {
          ...cached.normalized_payload,
          metadata: {
            providerType: "weather",
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
        unavailableReason: error instanceof Error ? error.message : "Weather unavailable",
      };
    }
  }
}
