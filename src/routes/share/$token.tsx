/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { customerStatusLabel, mapJobStatusToCustomerStatus } from "@/lib/customer-portal";

export const Route = createFileRoute("/share/$token")({ component: SharedShipment });
function SharedShipment() {
  const { token } = Route.useParams();
  const [result, setResult] = useState<any>();
  useEffect(() => {
    void (async () => {
      const { data } = await (supabase as any).rpc("open_shipment_share_link", { p_token: token });
      setResult(data);
    })();
  }, [token]);
  if (!result)
    return (
      <main className="grid min-h-screen place-items-center p-4">
        <Card className="p-6">Validating secure link…</Card>
      </main>
    );
  if (result.state !== "active")
    return (
      <main className="grid min-h-screen place-items-center p-4">
        <Card className="max-w-md p-6">
          <h1 className="text-xl font-semibold">
            {result.state === "expired"
              ? "This link has expired"
              : result.state === "revoked"
                ? "This link has been revoked"
                : "Invalid share link"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Ask the sender for a new secure shipment link.
          </p>
        </Card>
      </main>
    );
  const shipment = result.shipment;
  return (
    <main className="mx-auto min-h-screen max-w-2xl p-4 sm:p-8">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">Shared shipment</p>
      <Card className="mt-3 p-6">
        <h1 className="text-2xl font-semibold">{shipment.reference}</h1>
        <p className="mt-3">{customerStatusLabel(mapJobStatusToCustomerStatus(shipment.status))}</p>
        <dl className="mt-5 grid gap-4 text-sm">
          <div>
            <dt className="text-muted-foreground">Pickup</dt>
            <dd>{shipment.pickup ?? "Pending"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Destination</dt>
            <dd>{shipment.destination ?? "Pending"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Scheduled</dt>
            <dd>
              {shipment.scheduled_at ? new Date(shipment.scheduled_at).toLocaleString() : "Pending"}
            </dd>
          </div>
        </dl>
      </Card>
    </main>
  );
}
