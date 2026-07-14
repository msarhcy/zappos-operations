/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/session";
import { customerStatusLabel, mapJobStatusToCustomerStatus } from "@/lib/customer-portal";

export const Route = createFileRoute("/customer-portal/")({ component: CustomerDashboard });

function CustomerDashboard() {
  const { session } = useSession();
  const [jobs, setJobs] = useState<any[]>([]);
  useEffect(() => {
    if (!session?.user.id) return;
    void (async () => {
      const { data: member } = await supabase
        .from("customer_portal_memberships")
        .select("company_id,customer_id")
        .eq("user_id", session.user.id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      if (!member) return setJobs([]);
      const { data } = await supabase
        .from("jobs")
        .select("id,reference,status,scheduled_at,completed_at,updated_at")
        .eq("company_id", member.company_id)
        .eq("customer_id", member.customer_id)
        .order("updated_at", { ascending: false })
        .range(0, 19);
      setJobs(data ?? []);
    })();
  }, [session?.user.id]);
  const count = (statuses: string[]) => jobs.filter((job) => statuses.includes(job.status)).length;
  const cards = [
    ["Active shipments", count(["assigned", "accepted", "in_progress", "arrived"])],
    ["Scheduled shipments", count(["unassigned"])],
    ["Delivered shipments", count(["completed"])],
    ["Delayed shipments", count(["failed"])],
    ["Awaiting proof", jobs.filter((job) => job.status === "completed").length],
  ];
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-[.24em] text-slate-400">Overview</p>
        <h2 className="mt-2 text-2xl font-semibold">Shipment dashboard</h2>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map(([label, value]) => (
          <Card key={String(label)} className="border-white/10 bg-slate-900/70 p-4">
            <p className="text-sm text-slate-400">{label}</p>
            <p className="mt-2 text-2xl font-semibold">{value}</p>
          </Card>
        ))}
      </div>
      <Card className="border-white/10 bg-slate-900/70 p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Recent activity</h3>
          <Link className="text-sm text-emerald-300" to="/customer-portal/shipments">
            View shipments
          </Link>
        </div>
        <div className="mt-4 space-y-3">
          {jobs.slice(0, 5).map((job) => (
            <Link
              key={job.id}
              to="/customer-portal/shipments/$jobId"
              params={{ jobId: job.id }}
              className="block rounded-xl border border-white/10 p-3"
            >
              <span className="font-medium">{job.reference}</span>
              <span className="ml-2 text-sm text-slate-400">
                {customerStatusLabel(mapJobStatusToCustomerStatus(job.status))} · Last updated{" "}
                {new Date(job.updated_at).toLocaleString()}
              </span>
            </Link>
          ))}
          {jobs.length === 0 && (
            <p className="text-sm text-slate-400">No recent shipment activity.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
