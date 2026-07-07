import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { useDrivers } from "@/hooks/use-drivers";
import { useVehicles } from "@/hooks/use-vehicles";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/status-badge-detailed";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorState, LoadingState } from "@/components/operational-state";
import type { Database } from "@/integrations/supabase/types";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/documents")({
  head: () => ({ meta: [{ title: "Documents — ZappOS" }] }),
  component: DocumentsPage,
});

type DocumentRow = Database["public"]["Tables"]["documents"]["Row"];
type DocumentInsert = Database["public"]["Tables"]["documents"]["Insert"];
type OwnerType = Database["public"]["Enums"]["document_owner_type"];

type DocumentStatus = "valid" | "expiring_soon" | "expired";

function classify(expiryDate: string | null, warningDays: number): DocumentStatus {
  if (!expiryDate) return "valid";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(`${expiryDate}T00:00:00`);
  if (expiry < today) return "expired";
  const warning = new Date(today);
  warning.setDate(warning.getDate() + warningDays);
  return expiry <= warning ? "expiring_soon" : "valid";
}

function DocumentsPage() {
  const { activeCompany, hasRole } = useCompany();
  const { vehicles } = useVehicles();
  const { drivers } = useDrivers();
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<DocumentRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [signingAction, setSigningAction] = useState<string | null>(null);

  const canEdit = hasRole("admin") || hasRole("fleet_manager");
  const canDelete = hasRole("admin");
  const warningDays = activeCompany?.document_expiry_warning_days || 30;

  const load = async () => {
    if (!activeCompany) {
      setDocuments([]);
      setLoadError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase
      .from("documents")
      .select("*")
      .eq("company_id", activeCompany.id)
      .order("expiry_date", { ascending: true, nullsFirst: false });
    if (error) {
      setDocuments([]);
      setLoadError(error.message);
    } else {
      setDocuments(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [activeCompany?.id]);

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return documents;
    return documents.filter(
      (doc) =>
        doc.name.toLowerCase().includes(term) ||
        doc.document_type.toLowerCase().includes(term) ||
        ownerLabel(doc).toLowerCase().includes(term),
    );
  }, [documents, searchTerm, vehicles, drivers]);

  function ownerLabel(doc: Pick<DocumentRow, "owner_type" | "owner_id">) {
    if (doc.owner_type === "company") return activeCompany?.name || "Company";
    if (doc.owner_type === "vehicle") {
      return vehicles.find((vehicle) => vehicle.id === doc.owner_id)?.registration || "Vehicle";
    }
    return drivers.find((driver) => driver.id === doc.owner_id)?.full_name || "Driver";
  }

  const openCreate = () => {
    setSelectedDocument(null);
    setDialogOpen(true);
  };

  const openEdit = (document: DocumentRow) => {
    setSelectedDocument(document);
    setDialogOpen(true);
  };

  const remove = async (document: DocumentRow) => {
    if (!confirm(`Delete document ${document.name}?`)) return;
    const { error } = await supabase.from("documents").delete().eq("id", document.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Document deleted");
    await load();
  };

  const createSignedFileUrl = async (document: DocumentRow) => {
    if (!activeCompany) throw new Error("No active company");
    if (!document.file_url) throw new Error("Missing file");

    const [companySegment] = document.file_url.split("/");
    if (companySegment !== activeCompany.id) {
      throw new Error("This file does not belong to the active company");
    }

    const { data, error } = await supabase.storage
      .from("documents")
      .createSignedUrl(document.file_url, 60);
    if (error) throw error;
    if (!data?.signedUrl) throw new Error("Could not create a secure file link");
    return data.signedUrl;
  };

  const openSignedFile = async (document: DocumentRow, mode: "view" | "download") => {
    const actionKey = `${mode}:${document.id}`;
    setSigningAction(actionKey);
    try {
      const signedUrl = await createSignedFileUrl(document);
      if (mode === "view") {
        window.open(signedUrl, "_blank", "noopener,noreferrer");
      } else {
        const anchor = window.document.createElement("a");
        anchor.href = signedUrl;
        anchor.download = document.file_url?.split("/").pop() || document.name;
        anchor.rel = "noopener noreferrer";
        window.document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "File action failed");
    } finally {
      setSigningAction(null);
    }
  };

  const save = async (formData: DocumentFormData) => {
    if (!activeCompany) return;
    setSubmitting(true);
    try {
      let fileUrl = selectedDocument?.file_url ?? null;
      if (formData.file) {
        const safeName = formData.file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
        const path = `${activeCompany.id}/${formData.owner_type}/${formData.owner_id}/${Date.now()}-${safeName}`;
        const { error: uploadError } = await supabase.storage
          .from("documents")
          .upload(path, formData.file, { upsert: false });
        if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
        fileUrl = path;
      }

      const payload: DocumentInsert = {
        company_id: activeCompany.id,
        owner_type: formData.owner_type,
        owner_id: formData.owner_id,
        document_type: formData.document_type,
        name: formData.name,
        file_url: fileUrl,
        issue_date: formData.issue_date || null,
        expiry_date: formData.expiry_date || null,
        notes: formData.notes || null,
      };

      const request = selectedDocument
        ? supabase.from("documents").update(payload).eq("id", selectedDocument.id)
        : supabase.from("documents").insert(payload);
      const { error } = await request;
      if (error) throw error;

      toast.success(selectedDocument ? "Document updated" : "Document uploaded");
      setDialogOpen(false);
      setSelectedDocument(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save document");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Compliance
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Documents</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Company, vehicle and driver documents with expiry tracking.
          </p>
        </div>
        {canEdit ? (
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" />
            Add document
          </Button>
        ) : null}
      </div>

      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search by document, type, vehicle or driver..."
            className="pl-10"
          />
        </div>
      </div>

      {loading ? (
        <LoadingState label="Loading documents" />
      ) : loadError ? (
        <ErrorState
          title="Could not load documents"
          description={loadError}
          onAction={() => void load()}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No documents found"
          description="Company, vehicle and driver documents will appear here."
          actionLabel={canEdit ? "Add document" : undefined}
          onAction={canEdit ? openCreate : undefined}
          icon={FileText}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((document) => {
            const status = classify(document.expiry_date, warningDays);
            return (
              <Card key={document.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{document.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {document.document_type} · {ownerLabel(document)}
                    </p>
                  </div>
                  <StatusBadge status={status} variant="small" />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-muted-foreground">Issue date</p>
                    <p className="mt-1">{document.issue_date || "-"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Expiry date</p>
                    <p className="mt-1">{document.expiry_date || "-"}</p>
                  </div>
                </div>
                {document.notes ? (
                  <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">
                    {document.notes}
                  </p>
                ) : null}
                <div className="mt-4 space-y-3">
                  {document.file_url ? (
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() => void openSignedFile(document, "view")}
                        disabled={signingAction === `view:${document.id}`}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        View
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() => void openSignedFile(document, "download")}
                        disabled={signingAction === `download:${document.id}`}
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download
                      </Button>
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                      Missing file
                    </div>
                  )}
                  <div className="flex justify-end gap-1">
                    {canEdit ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => openEdit(document)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                    {canDelete ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10"
                        onClick={() => remove(document)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedDocument ? "Edit document" : "Add document"}</DialogTitle>
          </DialogHeader>
          <DocumentForm
            companyId={activeCompany?.id || ""}
            initialData={selectedDocument}
            vehicles={vehicles}
            drivers={drivers}
            loading={submitting}
            onSubmit={save}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface DocumentFormData {
  owner_type: OwnerType;
  owner_id: string;
  document_type: string;
  name: string;
  file: File | null;
  issue_date: string;
  expiry_date: string;
  notes: string;
}

function DocumentForm({
  companyId,
  initialData,
  vehicles,
  drivers,
  loading,
  onSubmit,
}: {
  companyId: string;
  initialData: DocumentRow | null;
  vehicles: Database["public"]["Tables"]["vehicles"]["Row"][];
  drivers: Database["public"]["Tables"]["drivers"]["Row"][];
  loading: boolean;
  onSubmit: (data: DocumentFormData) => Promise<void>;
}) {
  const [ownerType, setOwnerType] = useState<OwnerType>(initialData?.owner_type || "company");
  const [ownerId, setOwnerId] = useState(initialData?.owner_id || companyId);
  const [data, setData] = useState({
    document_type: initialData?.document_type || "",
    name: initialData?.name || "",
    issue_date: initialData?.issue_date || "",
    expiry_date: initialData?.expiry_date || "",
    notes: initialData?.notes || "",
  });
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    if (ownerType === "company") setOwnerId(companyId);
    if (ownerType === "vehicle" && !vehicles.some((vehicle) => vehicle.id === ownerId)) {
      setOwnerId(vehicles[0]?.id || "");
    }
    if (ownerType === "driver" && !drivers.some((driver) => driver.id === ownerId)) {
      setOwnerId(drivers[0]?.id || "");
    }
  }, [ownerType, companyId, ownerId, vehicles, drivers]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await onSubmit({ owner_type: ownerType, owner_id: ownerId, file, ...data });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="owner_type">Related to</Label>
          <select
            id="owner_type"
            value={ownerType}
            onChange={(event) => setOwnerType(event.target.value as OwnerType)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="company">Company</option>
            <option value="vehicle">Vehicle</option>
            <option value="driver">Driver</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="owner_id">Entity</Label>
          <select
            id="owner_id"
            value={ownerId}
            onChange={(event) => setOwnerId(event.target.value)}
            disabled={ownerType === "company"}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"
          >
            {ownerType === "company" ? <option value={companyId}>Company</option> : null}
            {ownerType === "vehicle"
              ? vehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.registration}
                  </option>
                ))
              : null}
            {ownerType === "driver"
              ? drivers.map((driver) => (
                  <option key={driver.id} value={driver.id}>
                    {driver.full_name}
                  </option>
                ))
              : null}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="document_type">Document type *</Label>
          <Input
            id="document_type"
            value={data.document_type}
            onChange={(event) => setData({ ...data, document_type: event.target.value })}
            placeholder="Licence, insurance, permit..."
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="name">Document name *</Label>
          <Input
            id="name"
            value={data.name}
            onChange={(event) => setData({ ...data, name: event.target.value })}
            placeholder="Registration certificate"
            required
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="issue_date">Issue date</Label>
          <Input
            id="issue_date"
            type="date"
            value={data.issue_date}
            onChange={(event) => setData({ ...data, issue_date: event.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="expiry_date">Expiry date</Label>
          <Input
            id="expiry_date"
            type="date"
            value={data.expiry_date}
            onChange={(event) => setData({ ...data, expiry_date: event.target.value })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="file">File upload</Label>
        <label className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground hover:bg-muted/40">
          <Upload className="h-4 w-4" />
          <span className="truncate">{file?.name || initialData?.file_url || "Choose a file"}</span>
          <input
            id="file"
            type="file"
            className="sr-only"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
          />
        </label>
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          value={data.notes}
          onChange={(event) => setData({ ...data, notes: event.target.value })}
          className="min-h-20"
        />
      </div>

      <Button
        type="submit"
        className="w-full"
        disabled={loading || !ownerId || !data.document_type || !data.name}
      >
        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Save document
      </Button>
    </form>
  );
}
