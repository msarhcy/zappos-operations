export interface GeographicCacheKey {
  providerType: "weather" | "traffic";
  precision: number;
  latitudeCell: number;
  longitudeCell: number;
  geographicCell: string;
  cacheKey: string;
}

export const WEATHER_CELL_PRECISION = 2;
export const TRAFFIC_CELL_PRECISION = 3;

function roundToCell(value: number, precision: number) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export function createGeographicCacheKey(
  providerType: "weather" | "traffic",
  latitude: number,
  longitude: number,
  precision = providerType === "weather" ? WEATHER_CELL_PRECISION : TRAFFIC_CELL_PRECISION,
): GeographicCacheKey {
  const latitudeCell = roundToCell(latitude, precision);
  const longitudeCell = roundToCell(longitude, precision);
  const geographicCell = `${latitudeCell.toFixed(precision)},${longitudeCell.toFixed(precision)}`;
  return {
    providerType,
    precision,
    latitudeCell,
    longitudeCell,
    geographicCell,
    cacheKey: `${providerType}:${precision}:${geographicCell}`,
  };
}
