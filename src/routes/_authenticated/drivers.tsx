import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Pencil, Trash2, Search, Users } from "lucide-react";
import { useDrivers } from "@/hooks/use-drivers";
import { useVehicles } from "@/hooks/use-vehicles";
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
import { DriverForm, type DriverFormData } from "./_components/-driver-form";
import type { Database } from "@/integrations/supabase/types";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/drivers")({
  head: () => ({ meta: [{ title: "Drivers — ZappOS" }] }),
  component: DriversPage,
});

type Driver = Database["public"]["Tables"]["drivers"]["Row"];
type DriverStatus = Database["public"]["Enums"]["driver_status"];

function DriversPage() {
  const { activeCompany, hasRole } = useCompany();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<DriverStatus | undefined>();
  const [dialogMode, setDialogMode] = useState<"create" | "edit" | null>(null);
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);
  const [profileDriver, setProfileDriver] = useState<Driver | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    drivers,
    loading,
    error,
    create,
    update,
    delete: deleteDriver,
    fetch,
  } = useDrivers({
    status: statusFilter,
    searchTerm,
  });
  const { vehicles } = useVehicles();

  const canEdit = hasRole("admin") || hasRole("fleet_manager") || hasRole("dispatcher");
  const canDelete = hasRole("admin");

  const handleCreateClick = () => {
    setSelectedDriver(null);
    setDialogMode("create");
  };

  const handleEditClick = (driver: Driver) => {
    setSelectedDriver(driver);
    setDialogMode("edit");
  };

  const handleDeleteClick = async (driver: Driver) => {
    if (!confirm(`Delete driver ${driver.full_name}?`)) return;
    try {
      await deleteDriver(driver.id);
      toast.success("Driver deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const handleSubmit = async (data: DriverFormData) => {
    setSubmitting(true);
    try {
      if (dialogMode === "create") {
        await create(data);
        toast.success("Driver created");
      } else if (selectedDriver && dialogMode === "edit") {
        await update(selectedDriver.id, data);
        toast.success("Driver updated");
      }
      setDialogMode(null);
      setSelectedDriver(null);
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
              Personnel Management
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Drivers</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Register and manage your driver roster with licence tracking.
            </p>
          </div>
          {canEdit && (
            <Button onClick={handleCreateClick} size="lg" className="gap-2">
              <Plus className="h-4 w-4" />
              Add driver
            </Button>
          )}
        </div>
      </div>

      {/* Filters & Search */}
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="relative md:col-span-2">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name, phone, or licence…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <select
          value={statusFilter || ""}
          onChange={(e) => setStatusFilter((e.target.value as DriverStatus) || undefined)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          <option value="available">Available</option>
          <option value="on_trip">On Trip</option>
          <option value="off_duty">Off Duty</option>
          <option value="suspended">Suspended</option>
        </select>
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        {loading ? (
          <LoadingState label="Loading drivers" />
        ) : error ? (
          <ErrorState
            title="Could not load drivers"
            description={error}
            onAction={() => void fetch()}
          />
        ) : drivers.length === 0 ? (
          <EmptyState
            title="No drivers found"
            description="Drivers you add to this company will appear here."
            actionLabel={canEdit ? "Add driver" : undefined}
            onAction={canEdit ? handleCreateClick : undefined}
            icon={Users}
          />
        ) : (
          <>
            <div className="space-y-3 p-3 md:hidden">
              {drivers.map((d) => {
                const licenceExpired = d.licence_expiry && new Date(d.licence_expiry) < new Date();
                return (
                  <Card key={d.id} className="p-4" onClick={() => setProfileDriver(d)}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{d.full_name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{d.phone || "-"}</p>
                      </div>
                      <StatusBadge status={d.status} variant="small" />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <p className="text-muted-foreground">Licence</p>
                        <p className="mt-1 truncate">{d.licence_number || "-"}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Expiry</p>
                        <p className={licenceExpired ? "mt-1 text-status-error" : "mt-1"}>
                          {d.licence_expiry || "-"}
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
                            handleEditClick(d);
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
                            handleDeleteClick(d);
                          }}
                        >
                          Delete
                        </Button>
                      ) : null}
                    </div>
                  </Card>
                );
              })}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Licence number</TableHead>
                    <TableHead>Licence expiry</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-20">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {drivers.map((d) => {
                    const licenceExpired =
                      d.licence_expiry && new Date(d.licence_expiry) < new Date();
                    return (
                      <TableRow
                        key={d.id}
                        className="cursor-pointer"
                        onClick={() => setProfileDriver(d)}
                      >
                        <TableCell className="font-medium">{d.full_name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {d.phone || "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {d.licence_number || "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {d.licence_expiry ? (
                            <span className={licenceExpired ? "text-status-error" : ""}>
                              {new Date(d.licence_expiry).toLocaleDateString()}
                            </span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={d.status} variant="small" />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {canEdit && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleEditClick(d);
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
                                  handleDeleteClick(d);
                                }}
                                className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </Card>

      {profileDriver ? (
        <Card className="mt-6 p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Driver profile
              </p>
              <h2 className="mt-1 text-lg font-semibold">{profileDriver.full_name}</h2>
            </div>
            <StatusBadge status={profileDriver.status} variant="small" />
          </div>
          <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Phone</p>
              <p className="mt-1">{profileDriver.phone || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Employee/reference number</p>
              <p className="mt-1">{profileDriver.employee_ref || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Licence number</p>
              <p className="mt-1">{profileDriver.licence_number || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Licence class/code</p>
              <p className="mt-1">{profileDriver.licence_class || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Licence expiry</p>
              <p className="mt-1">{profileDriver.licence_expiry || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Assigned vehicle</p>
              <p className="mt-1">
                {profileDriver.assigned_vehicle_id
                  ? vehicles.find((vehicle) => vehicle.id === profileDriver.assigned_vehicle_id)
                      ?.registration || "Assigned"
                  : "Unassigned"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Emergency contact</p>
              <p className="mt-1">{profileDriver.emergency_contact_name || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Emergency number</p>
              <p className="mt-1">{profileDriver.emergency_contact_phone || "-"}</p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-xs text-muted-foreground">Document links</p>
              <p className="mt-1 text-muted-foreground">Document links appear in Documents.</p>
            </div>
          </div>
          {profileDriver.notes ? (
            <div className="mt-4 text-sm">
              <p className="text-xs text-muted-foreground">Notes</p>
              <p className="mt-1 whitespace-pre-wrap">{profileDriver.notes}</p>
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* Dialog */}
      <Dialog open={dialogMode !== null} onOpenChange={(open) => !open && setDialogMode(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dialogMode === "create" ? "Add driver" : "Edit driver"}</DialogTitle>
            <DialogDescription>
              {dialogMode === "create"
                ? "Register a new driver in your fleet."
                : "Update driver details and status."}
            </DialogDescription>
          </DialogHeader>
          {dialogMode && (
            <DriverForm
              initialData={dialogMode === "edit" ? selectedDriver : undefined}
              onSubmit={handleSubmit}
              loading={submitting}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
