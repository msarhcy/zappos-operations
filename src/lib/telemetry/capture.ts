import type { CapturedPosition } from "./types";

export type CaptureErrorCode =
  "GEOLOCATION_UNSUPPORTED" | "PERMISSION_DENIED" | "POSITION_UNAVAILABLE" | "TIMEOUT" | "UNKNOWN";

export class TelemetryCaptureError extends Error {
  constructor(
    message: string,
    public code: CaptureErrorCode,
  ) {
    super(message);
  }
}

export async function queryLocationPermission(): Promise<PermissionState | "unsupported"> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unsupported";
  try {
    const status = await navigator.permissions.query({ name: "geolocation" });
    return status.state;
  } catch {
    return "unsupported";
  }
}

export function capturePosition(timeout = 12_000): Promise<CapturedPosition> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.reject(
      new TelemetryCaptureError(
        "Geolocation is not supported by this browser.",
        "GEOLOCATION_UNSUPPORTED",
      ),
    );
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          altitude: position.coords.altitude,
          horizontal_accuracy: position.coords.accuracy,
          vertical_accuracy: position.coords.altitudeAccuracy,
          device_speed: position.coords.speed,
          heading: position.coords.heading,
          device_timestamp: new Date(position.timestamp).toISOString(),
        });
      },
      (error) => {
        const code =
          error.code === error.PERMISSION_DENIED
            ? "PERMISSION_DENIED"
            : error.code === error.POSITION_UNAVAILABLE
              ? "POSITION_UNAVAILABLE"
              : error.code === error.TIMEOUT
                ? "TIMEOUT"
                : "UNKNOWN";
        reject(new TelemetryCaptureError(error.message || "Could not capture location.", code));
      },
      {
        enableHighAccuracy: true,
        timeout,
        maximumAge: 5_000,
      },
    );
  });
}
