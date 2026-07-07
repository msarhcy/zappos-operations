import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ClipboardList, History, Plus, Pencil, Trash2, Search } from "lucide-react";
import { useJobs } from "@/hooks/use-jobs";
import { useCustomers } from "@/hooks/use-customers";
import { useDrivers } from "@/hooks/use-drivers";
import { useVehicles } from "@/hooks/use-vehicles";
import { useCompany } from "@/lib/company-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/operational-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge-detailed";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { JobForm, type JobFormData } from "./_components/-job-form";
import type { Database } from "@/integrations/supabase/types";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/operations")({
  head: () => ({ meta: [{ title: "Operations — ZappOS" }] }),
  component: OperationsPage,
});

type Job = Database["public"]["Tables"]["jobs"]["Row"];
type JobEvent = Database["public"]["Tables"]["job_events"]["Row"];
type JobStatus = Database["public"]["Enums"]["job_status"];
type JobPriority = Database["public"]["Enums"]["job_priority"];

function OperationsPage() {
  const { activeCompany, hasRole, terminology } = useCompany();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<JobStatus | undefined>();
  const [priorityFilter, setPriorityFilter] = useState<JobPriority | undefined>();
  const [dialogMode, setDialogMode] = useState<"create" | "edit" | null>(null);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [profileJob, setProfileJob] = useState<Job | null>(null);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const {
    jobs,
    loading,
    error,
    create,
    update,
    delete: deleteJob,
    fetchEvents,
    fetch,
  } = useJobs({
    status: statusFilter,
    priority: priorityFilter,
    searchTerm,
  });

  const { customers } = useCustomers();
  const { drivers } = useDrivers();
  const { vehicles } = useVehicles();

  const canEdit = hasRole("admin") || hasRole("dispatcher");
  const canDelete = hasRole("admin");

  useEffect(() => {
    if (!profileJob) {
      setEvents([]);
      return;
    }
    fetchEvents(profileJob.id)
      .then(setEvents)
      .catch((err) => toast.error(err instanceof Error ? err.message : "Failed to load timeline"));
  }, [profileJob?.id]);

  const handleCreateClick = () => {
    setSelectedJob(null);
    setDialogMode("create");
  };

  const handleEditClick = (job: Job) => {
    setSelectedJob(job);
    setDialogMode("edit");
  };

  const handleDeleteClick = async (job: Job) => {
    if (!confirm(`Delete ${terminology.singular} ${job.reference}?`)) return;
    try {
      await deleteJob(job.id);
      toast.success(`${terminology.Singular} deleted`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const handleSubmit = async (data: JobFormData) => {
    setSubmitting(true);
    try {
      if (dialogMode === "create") {
        await create(data);
        toast.success(`${terminology.Singular} created`);
      } else if (selectedJob && dialogMode === "edit") {
        await update(selectedJob.id, data);
        toast.success(`${terminology.Singular} updated`);
      }
      setDialogMode(null);
      setSelectedJob(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  };

  const getCustomerName = (customerId: string | null) => {
    if (!customerId) return "—";
    return customers.find((c) => c.id === customerId)?.name || "Unknown";
  };

  const getDriverName = (driverId: string | null) => {
    if (!driverId) return "—";
    return drivers.find((d) => d.id === driverId)?.full_name || "Unknown";
  };

  const getVehicleReg = (vehicleId: string | null) => {
    if (!vehicleId) return "—";
    return vehicles.find((v) => v.id === vehicleId)?.registration || "Unknown";
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Operational work
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{terminology.Plural}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Create, assign and track {terminology.plural} with activity timelines.
            </p>
          </div>
          {canEdit && (
            <Button onClick={handleCreateClick} size="lg" className="gap-2">
              <Plus className="h-4 w-4" />
              New {terminology.singular}
            </Button>
          )}
        </div>
      </div>

      {/* Filters & Search */}
      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <div className="relative md:col-span-2">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by reference, location…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <select
          value={statusFilter || ""}
          onChange={(e) => setStatusFilter((e.target.value as JobStatus) || undefined)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          <option value="unassigned">Unassigned</option>
          <option value="assigned">Assigned</option>
          <option value="accepted">Accepted</option>
          <option value="in_progress">In Progress</option>
          <option value="arrived">Arrived</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select
          value={priorityFilter || ""}
          onChange={(e) => setPriorityFilter((e.target.value as JobPriority) || undefined)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">All priorities</option>
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        {loading ? (
          <LoadingState label={`Loading ${terminology.plural}`} />
        ) : error ? (
          <ErrorState
            title={`Could not load ${terminology.plural}`}
            description={error}
            onAction={() => void fetch()}
          />
        ) : jobs.length === 0 ? (
          <EmptyState
            title={`No ${terminology.plural} found`}
            description={`${terminology.Plural} you create for this company will appear here.`}
            actionLabel={canEdit ? `New ${terminology.singular}` : undefined}
            onAction={canEdit ? handleCreateClick : undefined}
            icon={ClipboardList}
          />
        ) : (
          <>
            <div className="space-y-3 p-3 md:hidden">
              {jobs.map((j) => (
                <Card key={j.id} className="p-4" onClick={() => setProfileJob(j)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{j.reference}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {getCustomerName(j.customer_id)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <StatusBadge status={j.priority} variant="small" />
                      <StatusBadge status={j.status} variant="small" />
                    </div>
                  </div>
                  <p className="mt-3 truncate text-xs text-muted-foreground">
                    {j.pickup_location || "-"} {"->"} {j.dropoff_location || "-"}
                  </p>
                  <p className="mt-2 truncate text-xs text-muted-foreground">
                    {getDriverName(j.driver_id)} / {getVehicleReg(j.vehicle_id)}
                  </p>
                  <div className="mt-3 flex gap-2">
                    {canEdit ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleEditClick(j);
                        }}
                      >
                        Edit
                      </Button>
                    ) : null}
                    {canDelete ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDeleteClick(j);
                        }}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </div>
                </Card>
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Pickup / Dropoff</TableHead>
                    <TableHead>Driver / Vehicle</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-20">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((j) => (
                    <TableRow
                      key={j.id}
                      className="cursor-pointer"
                      onClick={() => setProfileJob(j)}
                    >
                      <TableCell className="font-medium text-xs">{j.reference}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {getCustomerName(j.customer_id)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                        {j.pickup_location} → {j.dropoff_location}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {getDriverName(j.driver_id)} / {getVehicleReg(j.vehicle_id)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={j.priority} variant="small" />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={j.status} variant="small" />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {canEdit && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleEditClick(j);
                              }}
                              className="h-7 w-7 p-0"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleDeleteClick(j);
                              }}
                              className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </Card>

      {profileJob ? (
        <Card className="mt-6 p-5">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
            <div>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {terminology.Singular} profile
                  </p>
                  <h2 className="mt-1 text-lg font-semibold">{profileJob.reference}</h2>
                </div>
                <div className="flex gap-2">
                  <StatusBadge status={profileJob.priority} variant="small" />
                  <StatusBadge status={profileJob.status} variant="small" />
                </div>
              </div>
              <div className="grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">Customer</p>
                  <p className="mt-1">{getCustomerName(profileJob.customer_id)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Scheduled</p>
                  <p className="mt-1">
                    {profileJob.scheduled_at
                      ? new Date(profileJob.scheduled_at).toLocaleString()
                      : "-"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Pickup</p>
                  <p className="mt-1">{profileJob.pickup_location || "-"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Drop-off / destination</p>
                  <p className="mt-1">{profileJob.dropoff_location || "-"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Driver</p>
                  <p className="mt-1">{getDriverName(profileJob.driver_id)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Vehicle</p>
                  <p className="mt-1">{getVehicleReg(profileJob.vehicle_id)}</p>
                </div>
              </div>
              {profileJob.description || profileJob.notes ? (
                <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Description</p>
                    <p className="mt-1 whitespace-pre-wrap">{profileJob.description || "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Notes</p>
                    <p className="mt-1 whitespace-pre-wrap">{profileJob.notes || "-"}</p>
                  </div>
                </div>
              ) : null}
            </div>
            <div>
              <div className="mb-3 flex items-center gap-2">
                <History className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Activity timeline</h3>
              </div>
              {events.length === 0 ? (
                <div className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">
                  No activity logged yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {events.map((event) => (
                    <div key={event.id} className="rounded-md border border-border/70 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium capitalize">
                          {event.event_type.replace(/_/g, " ")}
                        </p>
                        <p className="shrink-0 text-xs text-muted-foreground">
                          {new Date(event.created_at).toLocaleString()}
                        </p>
                      </div>
                      {event.message ? (
                        <p className="mt-1 text-xs text-muted-foreground">{event.message}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Card>
      ) : null}

      {/* Dialog */}
      <Dialog open={dialogMode !== null} onOpenChange={(open) => !open && setDialogMode(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {dialogMode === "create"
                ? `New ${terminology.singular}`
                : `Edit ${terminology.singular}`}
            </DialogTitle>
            <DialogDescription>
              {dialogMode === "create"
                ? `Create a new ${terminology.singular} and assign to drivers and vehicles.`
                : `Update ${terminology.singular} details and assignments.`}
            </DialogDescription>
          </DialogHeader>
          {dialogMode && (
            <JobForm
              initialData={dialogMode === "edit" ? selectedJob : undefined}
              onSubmit={handleSubmit}
              loading={submitting}
              customers={customers}
              drivers={drivers}
              vehicles={vehicles}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
