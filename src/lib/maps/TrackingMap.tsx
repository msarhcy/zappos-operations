import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapLibreProvider } from "./maplibre-provider";
import type { ObservedTraceLine, VehicleMarker, ZappMapProvider } from "./types";

const DEFAULT_STYLE =
  import.meta.env.VITE_MAP_STYLE_URL || "https://demotiles.maplibre.org/style.json";

export function TrackingMap({
  markers,
  trace,
  onSelectMarker,
}: {
  markers: VehicleMarker[];
  trace: ObservedTraceLine | null;
  onSelectMarker: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const providerRef = useRef<ZappMapProvider | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!containerRef.current) return;
    const provider = new MapLibreProvider();
    providerRef.current = provider;
    provider
      .initialize(containerRef.current, {
        styleUrl: DEFAULT_STYLE,
        center: [-98.5795, 39.8283],
        zoom: 3,
      })
      .then(() => {
        if (cancelled) return;
        setReady(true);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Map could not initialize");
      });

    return () => {
      cancelled = true;
      provider.destroy();
      providerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    providerRef.current?.updateActiveVehicleMarkers(markers, onSelectMarker);
    if (markers.length > 0) providerRef.current?.fitBounds();
  }, [markers, onSelectMarker, ready]);

  useEffect(() => {
    if (!ready) return;
    providerRef.current?.renderObservedTrace(trace);
  }, [ready, trace]);

  return (
    <div className="relative h-[420px] min-h-[320px] overflow-hidden rounded-md border border-border bg-muted md:h-[560px]">
      <div ref={containerRef} className="h-full w-full" />
      {error ? (
        <div className="absolute inset-0 grid place-items-center bg-background/90 p-4 text-center text-sm">
          <div>
            <p className="font-medium">Map unavailable</p>
            <p className="mt-1 text-muted-foreground">{error}</p>
          </div>
        </div>
      ) : null}
      {!ready ? (
        <div className="absolute inset-0 grid place-items-center bg-background/70 text-sm text-muted-foreground">
          Loading live map
        </div>
      ) : null}
      <div className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] rounded bg-background/90 px-2 py-1 text-[11px] text-muted-foreground shadow">
        Development style uses public MapLibre demo tiles. Configure `VITE_MAP_STYLE_URL` for
        production.
      </div>
    </div>
  );
}
