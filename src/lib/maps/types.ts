export interface VehicleMarker {
  id: string;
  latitude: number;
  longitude: number;
  registration: string;
  driverName: string;
  jobReference: string;
  latestLocationAge: string;
  speedKph: number | null;
  qualityStatus: string;
  trackingState: string;
}

export interface ObservedTraceLine {
  id: string;
  points: Array<{ latitude: number; longitude: number }>;
}

export interface ZappMapProviderCapabilities {
  markers: boolean;
  observedTrace: boolean;
  fitBounds: boolean;
}

export interface ZappMapProvider {
  providerId: string;
  capabilities: ZappMapProviderCapabilities;
  initialize(
    container: HTMLElement,
    options: { styleUrl: string; center: [number, number]; zoom: number },
  ): Promise<void>;
  destroy(): void;
  updateActiveVehicleMarkers(markers: VehicleMarker[], onSelect: (id: string) => void): void;
  renderObservedTrace(trace: ObservedTraceLine | null): void;
  fitBounds(): void;
  clearTrace(): void;
}
