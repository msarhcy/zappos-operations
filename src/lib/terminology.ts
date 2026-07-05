export type Terminology = "trips" | "jobs" | "deliveries" | "loads" | "orders";

interface TerminologyLabels {
  singular: string;
  plural: string;
  Singular: string;
  Plural: string;
  verb: string;
}

const map: Record<Terminology, TerminologyLabels> = {
  trips: { singular: "trip", plural: "trips", Singular: "Trip", Plural: "Trips", verb: "Trip" },
  jobs: { singular: "job", plural: "jobs", Singular: "Job", Plural: "Jobs", verb: "Job" },
  deliveries: { singular: "delivery", plural: "deliveries", Singular: "Delivery", Plural: "Deliveries", verb: "Delivery" },
  loads: { singular: "load", plural: "loads", Singular: "Load", Plural: "Loads", verb: "Load" },
  orders: { singular: "order", plural: "orders", Singular: "Order", Plural: "Orders", verb: "Order" },
};

export function getTerminology(t: Terminology | null | undefined): TerminologyLabels {
  return map[t ?? "jobs"] ?? map.jobs;
}
