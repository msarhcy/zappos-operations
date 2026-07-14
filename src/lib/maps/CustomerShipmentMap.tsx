import { lazy, Suspense } from "react";
import type { VehicleMarker } from "./types";

const TrackingMap = lazy(() =>
  import("./TrackingMap").then((module) => ({ default: module.TrackingMap })),
);

/** One authorized shipment marker only; never a fleet feed or trace. */
export function CustomerShipmentMap({
  latitude,
  longitude,
  reference,
}: {
  latitude: number;
  longitude: number;
  reference: string;
}) {
  const marker: VehicleMarker = {
    id: reference,
    latitude,
    longitude,
    registration: "Shipment location",
    driverName: "",
    jobReference: reference,
    latestLocationAge: "",
    speedKph: null,
    qualityStatus: "customer",
    trackingState: "active",
  };
  return (
    <Suspense
      fallback={
        <div className="grid h-80 place-items-center text-sm text-slate-400">Loading map…</div>
      }
    >
      <TrackingMap markers={[marker]} trace={null} onSelectMarker={() => undefined} />
    </Suspense>
  );
}
