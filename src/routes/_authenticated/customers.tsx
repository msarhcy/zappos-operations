import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Building2, Plus, Pencil, Trash2, Search } from "lucide-react";
import { useCustomers } from "@/hooks/use-customers";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CustomerForm, type CustomerFormData } from "./_components/-customer-form";
import type { Database } from "@/integrations/supabase/types";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/customers")({
  head: () => ({ meta: [{ title: "Customers — ZappOS" }] }),
  component: CustomersPage,
});

type Customer = Database["public"]["Tables"]["customers"]["Row"];

function CustomersPage() {
  const { hasRole } = useCompany();
  const [searchTerm, setSearchTerm] = useState("");
  const [dialogMode, setDialogMode] = useState<"create" | "edit" | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [profileCustomer, setProfileCustomer] = useState<Customer | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    customers,
    loading,
    error,
    create,
    update,
    delete: deleteCustomer,
    fetch,
  } = useCustomers({
    searchTerm,
  });

  const canEdit = hasRole("admin") || hasRole("dispatcher");
  const canDelete = hasRole("admin");

  const handleCreateClick = () => {
    setSelectedCustomer(null);
    setDialogMode("create");
  };

  const handleEditClick = (customer: Customer) => {
    setSelectedCustomer(customer);
    setDialogMode("edit");
  };

  const handleDeleteClick = async (customer: Customer) => {
    if (!confirm(`Delete customer ${customer.name}?`)) return;
    try {
      await deleteCustomer(customer.id);
      toast.success("Customer deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const handleSubmit = async (data: CustomerFormData) => {
    setSubmitting(true);
    try {
      if (dialogMode === "create") {
        await create(data);
        toast.success("Customer created");
      } else if (selectedCustomer && dialogMode === "edit") {
        await update(selectedCustomer.id, data);
        toast.success("Customer updated");
      }
      setDialogMode(null);
      setSelectedCustomer(null);
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
              Contacts
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Customers</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage your customer and client list.
            </p>
          </div>
          {canEdit && (
            <Button onClick={handleCreateClick} size="lg" className="gap-2">
              <Plus className="h-4 w-4" />
              Add customer
            </Button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name, contact person, email, or phone…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        {loading ? (
          <LoadingState label="Loading customers" />
        ) : error ? (
          <ErrorState
            title="Could not load customers"
            description={error}
            onAction={() => void fetch()}
          />
        ) : customers.length === 0 ? (
          <EmptyState
            title="No customers found"
            description="Customers you add to this company will appear here."
            actionLabel={canEdit ? "Add customer" : undefined}
            onAction={canEdit ? handleCreateClick : undefined}
            icon={Building2}
          />
        ) : (
          <>
            <div className="space-y-3 p-3 md:hidden">
              {customers.map((c) => (
                <Card key={c.id} className="p-4" onClick={() => setProfileCustomer(c)}>
                  <p className="truncate text-sm font-semibold">{c.name}</p>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-muted-foreground">Contact</p>
                      <p className="mt-1 truncate">{c.contact_person || "-"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Phone</p>
                      <p className="mt-1 truncate">{c.phone || "-"}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-muted-foreground">Email</p>
                      <p className="mt-1 truncate">{c.email || "-"}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    {canEdit ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleEditClick(c);
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
                          handleDeleteClick(c);
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
                    <TableHead>Company</TableHead>
                    <TableHead>Contact person</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="w-20">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.map((c) => (
                    <TableRow
                      key={c.id}
                      className="cursor-pointer"
                      onClick={() => setProfileCustomer(c)}
                    >
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.contact_person || "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.phone || "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.email || "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {canEdit && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleEditClick(c);
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
                                handleDeleteClick(c);
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

      {profileCustomer ? (
        <Card className="mt-6 p-5">
          <div className="mb-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Customer profile
            </p>
            <h2 className="mt-1 text-lg font-semibold">{profileCustomer.name}</h2>
          </div>
          <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Contact person</p>
              <p className="mt-1">{profileCustomer.contact_person || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Phone</p>
              <p className="mt-1">{profileCustomer.phone || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Email</p>
              <p className="mt-1">{profileCustomer.email || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Address</p>
              <p className="mt-1">{profileCustomer.address || "-"}</p>
            </div>
          </div>
          {profileCustomer.notes ? (
            <div className="mt-4 text-sm">
              <p className="text-xs text-muted-foreground">Notes</p>
              <p className="mt-1 whitespace-pre-wrap">{profileCustomer.notes}</p>
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* Dialog */}
      <Dialog open={dialogMode !== null} onOpenChange={(open) => !open && setDialogMode(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dialogMode === "create" ? "Add customer" : "Edit customer"}</DialogTitle>
            <DialogDescription>
              {dialogMode === "create"
                ? "Add a new customer to your contacts."
                : "Update customer details."}
            </DialogDescription>
          </DialogHeader>
          {dialogMode && (
            <CustomerForm
              initialData={dialogMode === "edit" ? selectedCustomer : undefined}
              onSubmit={handleSubmit}
              loading={submitting}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
