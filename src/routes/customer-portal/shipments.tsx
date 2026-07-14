/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Package2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { customerStatusLabel, mapJobStatusToCustomerStatus } from "@/lib/customer-portal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/customer-portal/shipments")({
  head: () => ({ meta: [{ title: "Shipments — Customer portal" }] }),
  component: CustomerShipmentsPage,
});

function CustomerShipmentsPage() {
  const { session } = useSession();
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(0);
  const pageSize = 25;

  useEffect(() => {
    if (!session?.user?.id) return;
    const load = async () => {
      setLoading(true);
      const { data: membership } = await supabase
        .from("customer_portal_memberships")
        .select("company_id, customer_id")
        .eq("user_id", session.user.id)
        .eq("status", "active")
        .maybeSingle();
      if (!membership) {
        setJobs([]);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("jobs")
        .select(
          "id, reference, pickup_location, dropoff_location, scheduled_at, status, completed_at, customer_id, company_id",
        )
        .eq("company_id", membership.company_id)
        .eq("customer_id", membership.customer_id)
        .order("updated_at", { ascending: false })
        .range(page * pageSize, page * pageSize + pageSize - 1);
      if (!error) {
        setJobs(data ?? []);
      }
      setLoading(false);
    };
    void load();
  }, [session?.user?.id, page]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const searched = !term
      ? jobs
      : jobs.filter((job) =>
          `${job.reference} ${job.pickup_location ?? ""} ${job.dropoff_location ?? ""}`
            .toLowerCase()
            .includes(term),
        );
    return status === "all"
      ? searched
      : searched.filter((job) => mapJobStatusToCustomerStatus(job.status) === status);
  }, [jobs, search, status]);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Your shipments</p>
        <h2 className="mt-2 text-2xl font-semibold">Shipments</h2>
        <p className="mt-2 text-sm text-slate-400">
          View your active and completed deliveries with privacy-safe updates.
        </p>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by reference or location"
          className="border-white/10 bg-slate-900/80 pl-10 text-slate-100"
        />
      </div>
      <Select value={status} onValueChange={setStatus}>
        <SelectTrigger className="max-w-xs border-white/10 bg-slate-900">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          <SelectItem value="scheduled">Scheduled</SelectItem>
          <SelectItem value="assigned">Assigned</SelectItem>
          <SelectItem value="collection_in_progress">Collection in progress</SelectItem>
          <SelectItem value="arrived">Arrived</SelectItem>
          <SelectItem value="delivered">Delivered</SelectItem>
          <SelectItem value="cancelled">Cancelled</SelectItem>
        </SelectContent>
      </Select>

      {loading ? (
        <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-400">
          Loading shipments...
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-white/10 bg-slate-900/70 p-8 text-center text-sm text-slate-400">
          <Package2 className="mx-auto mb-3 h-8 w-8 text-slate-500" />
          No shipments match the current filters.
        </Card>
      ) : (
        <div className="grid gap-4">
          {filtered.map((job) => (
            <Link key={job.id} to="/customer-portal/shipments/$jobId" params={{ jobId: job.id }}>
              <Card className="border-white/10 bg-slate-900/70 p-4 transition hover:border-slate-600">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">{job.reference}</p>
                    <p className="mt-1 text-sm text-slate-400">
                      {job.pickup_location ?? "Pickup pending"} →{" "}
                      {job.dropoff_location ?? "Destination pending"}
                    </p>
                  </div>
                  <div className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
                    {customerStatusLabel(mapJobStatusToCustomerStatus(job.status))}
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-400">
                  <span>
                    Scheduled:{" "}
                    {job.scheduled_at ? new Date(job.scheduled_at).toLocaleString() : "Pending"}
                  </span>
                  <span>Last updated: {new Date(job.updated_at).toLocaleString()}</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Button
          disabled={page === 0}
          variant="outline"
          onClick={() => setPage((value) => value - 1)}
        >
          Previous
        </Button>
        <Button
          disabled={jobs.length < pageSize}
          variant="outline"
          onClick={() => setPage((value) => value + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
