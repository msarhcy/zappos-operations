import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Pencil, Trash2, Search, Truck } from "lucide-react";
import { useVehicles } from "@/hooks/use-vehicles";
import { useDrivers } from "@/hooks/use-drivers";
import { useCompany } from "@/lib/company-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge-detailed";
import { EmptyState, ErrorState, LoadingState } from "@/components/operational-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { VehicleForm, type VehicleFormData } from "./_components/-vehicle-form";
import type { Database } from "@/integrations/supabase/types";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/vehicles")({
  head: () => ({ meta: [{ title: "Vehicles — ZappOS" }] }),
  component: VehiclesPage,
});

type Vehicle = Database["public"]["Tables"]["vehicles"]["Row"];
type VehicleStatus = Database["public"]["Enums"]["vehicle_status"];

function VehiclesPage() {
  const { hasRole } = useCompany();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<VehicleStatus | undefined>();
  const [dialogMode, setDialogMode] = useState<"create" | "edit" | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [profileVehicle, setProfileVehicle] = useState<Vehicle | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    vehicles,
    loading,
    error,
    create,
    update,
    delete: deleteVehicle,
    fetch,
  } = useVehicles({
    status: statusFilter,
    searchTerm,
  });
  const { drivers } = useDrivers();

  const canEdit = hasRole("admin") || hasRole("fleet_manager") || hasRole("dispatcher");
  const canDelete = hasRole("admin");

  const handleCreateClick = () => {
    setSelectedVehicle(null);
    setDialogMode("create");
  };

  const handleEditClick = (vehicle: Vehicle) => {
    setSelectedVehicle(vehicle);
    setDialogMode("edit");
  };

  const handleDeleteClick = async (vehicle: Vehicle) => {
    if (!confirm(`Delete vehicle ${vehicle.registration}?`)) return;
    try {
      await deleteVehicle(vehicle.id);
      toast.success("Vehicle deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const handleSubmit = async (data: VehicleFormData) => {
    setSubmitting(true);
    try {
      if (dialogMode === "create") {
        await create(data);
        toast.success("Vehicle created");
      } else if (selectedVehicle && dialogMode === "edit") {
        await update(selectedVehicle.id, data);
        toast.success("Vehicle updated");
      }
      setDialogMode(null);
      setSelectedVehicle(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Fleet Management
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Vehicles</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Register, manage and monitor your fleet vehicles.
            </p>
          </div>
          {canEdit && (
            <Button onClick={handleCreateClick} size="lg" className="gap-2">
              <Plus className="h-4 w-4" />
              Add vehicle
            </Button>
          )}
        </div>
      </div>

      {/* Filters & Search */}
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="relative md:col-span-2">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by registration, make, or model…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <select
          value={statusFilter || ""}
          onChange={(e) => setStatusFilter((e.target.value as VehicleStatus) || undefined)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          <option value="available">Available</option>
          <option value="in_use">In Use</option>
          <option value="maintenance">Maintenance</option>
          <option value="out_of_service">Out of Service</option>
        </select>
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        {loading ? (
          <LoadingState label="Loading vehicles" />
        ) : error ? (
          <ErrorState
            title="Could not load vehicles"
            description={error}
            onAction={() => void fetch()}
          />
        ) : vehicles.length === 0 ? (
          <EmptyState
            title="No vehicles found"
            description="Vehicles you add to this company will appear here."
            actionLabel={canEdit ? "Add vehicle" : undefined}
            onAction={canEdit ? handleCreateClick : undefined}
            icon={Truck}
          />
        ) : (
          <>
            <div className="space-y-3 p-3 md:hidden">
              {vehicles.map((v) => (
                <Card key={v.id} className="p-4" onClick={() => setProfileVehicle(v)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{v.registration}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {v.year ? `${v.year} ` : ""}
                        {v.make || "-"} {v.model || ""}
                      </p>
                    </div>
                    <StatusBadge status={v.status} variant="small" />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-muted-foreground">Type</p>
                      <p className="mt-1 capitalize">{v.vehicle_type}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Driver</p>
                      <p className="mt-1 truncate">
                        {v.assigned_driver_id
                          ? drivers.find((driver) => driver.id === v.assigned_driver_id)
                              ?.full_name || "Assigned"
                          : "Unassigned"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    {canEdit ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleEditClick(v);
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
                          handleDeleteClick(v);
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
                    <TableHead>Registration</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Assigned Driver</TableHead>
                    <TableHead className="w-20">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vehicles.map((v) => (
                    <TableRow
                      key={v.id}
                      className="cursor-pointer"
                      onClick={() => setProfileVehicle(v)}
                    >
                      <TableCell className="font-medium">{v.registration}</TableCell>
                      <TableCell>
                        {v.year ? `${v.year} ` : ""}
                        {v.make} {v.model}
                      </TableCell>
                      <TableCell className="capitalize">{v.vehicle_type}</TableCell>
                      <TableCell>
                        <StatusBadge status={v.status} variant="small" />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {v.assigned_driver_id
                          ? drivers.find((driver) => driver.id === v.assigned_driver_id)
                              ?.full_name || "Assigned"
                          : "Unassigned"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {canEdit && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleEditClick(v);
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
                                handleDeleteClick(v);
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

      {profileVehicle ? (
        <Card className="mt-6 p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Vehicle profile
              </p>
              <h2 className="mt-1 text-lg font-semibold">{profileVehicle.registration}</h2>
            </div>
            <StatusBadge status={profileVehicle.status} variant="small" />
          </div>
          <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Vehicle</p>
              <p className="mt-1">
                {profileVehicle.year ? `${profileVehicle.year} ` : ""}
                {profileVehicle.make || "-"} {profileVehicle.model || ""}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">VIN</p>
              <p className="mt-1">{profileVehicle.vin || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Current odometer</p>
              <p className="mt-1">{profileVehicle.odometer?.toLocaleString() || "0"} km</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Assigned driver</p>
              <p className="mt-1">
                {profileVehicle.assigned_driver_id
                  ? drivers.find((driver) => driver.id === profileVehicle.assigned_driver_id)
                      ?.full_name || "Assigned"
                  : "Unassigned"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Licence expiry</p>
              <p className="mt-1">{profileVehicle.licence_expiry || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Insurance expiry</p>
              <p className="mt-1">{profileVehicle.insurance_expiry || "-"}</p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-xs text-muted-foreground">Document links</p>
              <p className="mt-1 text-muted-foreground">Document links appear in Documents.</p>
            </div>
          </div>
          {profileVehicle.notes ? (
            <div className="mt-4 text-sm">
              <p className="text-xs text-muted-foreground">Notes</p>
              <p className="mt-1 whitespace-pre-wrap">{profileVehicle.notes}</p>
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* Dialog */}
      <Dialog open={dialogMode !== null} onOpenChange={(open) => !open && setDialogMode(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dialogMode === "create" ? "Add vehicle" : "Edit vehicle"}</DialogTitle>
            <DialogDescription>
              {dialogMode === "create"
                ? "Add a new vehicle to your fleet."
                : "Update vehicle details and status."}
            </DialogDescription>
          </DialogHeader>
          {dialogMode && (
            <VehicleForm
              initialData={dialogMode === "edit" ? selectedVehicle : undefined}
              onSubmit={handleSubmit}
              loading={submitting}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
