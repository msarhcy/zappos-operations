import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle,
  ClipboardList,
  FileSignature,
  Loader2,
  MapPin,
  PenLine,
  Save,
  Truck,
  Wrench,
  XCircle,
} from "lucide-react";
import { useDriverWorkflow } from "@/hooks/use-driver-workflow";
import { useIncidents } from "@/hooks/use-incidents";
import { useMaintenance } from "@/hooks/use-maintenance";
import { useCompany } from "@/lib/company-context";
import { useDriverTripTracking, type DriverTrackingUiState } from "@/lib/telemetry/session";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/ui/status-badge-detailed";
import { EmptyState, ErrorState, LoadingState } from "@/components/operational-state";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];
type IncidentType = Database["public"]["Enums"]["incident_type"];
type IncidentSeverity = Database["public"]["Enums"]["incident_severity"];
type MaintenanceType = Database["public"]["Enums"]["maintenance_type"];

export const Route = createFileRoute("/_authenticated/driver")({
  head: () => ({ meta: [{ title: "Driver — ZappOS" }] }),
  component: DriverPage,
});

const actionConfig: Record<
  string,
  { label: string; action?: "accept" | "start" | "arrive"; icon: typeof CheckCircle }
> = {
  assigned: { label: "Accept Job", action: "accept", icon: CheckCircle },
  accepted: { label: "Start Trip", action: "start", icon: CheckCircle },
  in_progress: { label: "Mark Arrived", action: "arrive", icon: CheckCircle },
  arrived: { label: "Complete Job", icon: CheckCircle },
};

const trackingCopy: Record<DriverTrackingUiState, { title: string; detail: string }> = {
  inactive: {
    title: "Tracking inactive",
    detail: "ZappOS only records location during an authorized active trip.",
  },
  permission_required: {
    title: "Location permission required",
    detail: "Enable location for this trip. Tracking is visible and stops when the trip ends.",
  },
  active: {
    title: "Tracking active for current trip",
    detail: "Browser GPS points are queued locally first, then synced in batches when online.",
  },
  degraded: {
    title: "Tracking degraded",
    detail:
      "Location capture is limited or GPS quality is poor. Trip recording continues where supported.",
  },
  offline: {
    title: "Offline - trip recording continues where supported",
    detail: "Points stay on this device until the browser is online again.",
  },
  syncing: {
    title: "Syncing trip data",
    detail: "Queued telemetry is being uploaded through the secure ingestion boundary.",
  },
  completed: {
    title: "Tracking completed",
    detail: "Tracking stopped for the completed operational trip.",
  },
};

function formatWhen(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Not scheduled";
}

function JobCard({ job, label }: { job: Job; label: string }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <h2 className="mt-1 truncate text-xl font-semibold">{job.reference}</h2>
        </div>
        <StatusBadge status={job.status} variant="small" />
      </div>
      <div className="space-y-3 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Pickup</p>
          <p className="mt-1 font-medium">{job.pickup_location || "-"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Dropoff</p>
          <p className="mt-1 font-medium">{job.dropoff_location || "-"}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-muted-foreground">Scheduled</p>
            <p className="mt-1 text-xs">{formatWhen(job.scheduled_at)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Priority</p>
            <div className="mt-1">
              <StatusBadge status={job.priority} variant="small" />
            </div>
          </div>
        </div>
        {job.description ? (
          <p className="text-xs text-muted-foreground">{job.description}</p>
        ) : null}
      </div>
    </Card>
  );
}

function SignaturePad({ onChange }: { onChange: (file: File | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * scale);
    canvas.height = Math.floor(160 * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(scale, scale);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--foreground");
  }, []);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const exportSignature = (canvas: HTMLCanvasElement) => {
    canvas.toBlob((blob) => {
      if (!blob) return onChange(null);
      onChange(new File([blob], "signature.png", { type: "image/png" }));
    }, "image/png");
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    onChange(null);
  };

  return (
    <div className="space-y-2">
      <div className="rounded-md border border-border bg-background">
        <canvas
          ref={canvasRef}
          className="h-40 w-full touch-none"
          onPointerDown={(event) => {
            drawing.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            const ctx = event.currentTarget.getContext("2d");
            const p = point(event);
            ctx?.beginPath();
            ctx?.moveTo(p.x, p.y);
          }}
          onPointerMove={(event) => {
            if (!drawing.current) return;
            const ctx = event.currentTarget.getContext("2d");
            const p = point(event);
            ctx?.lineTo(p.x, p.y);
            ctx?.stroke();
          }}
          onPointerUp={(event) => {
            drawing.current = false;
            exportSignature(event.currentTarget);
          }}
        />
      </div>
      <Button type="button" variant="outline" size="sm" onClick={clear}>
        Clear signature
      </Button>
    </div>
  );
}

function DriverPage() {
  const { terminology } = useCompany();
  const {
    driver,
    currentJob,
    nextJob,
    loading,
    error,
    fetch,
    transition,
    saveNotes,
    failJob,
    submitProof,
  } = useDriverWorkflow();
  const { create: createIncident } = useIncidents();
  const { create: createMaintenance } = useMaintenance();
  const tracking = useDriverTripTracking({ driver, currentJob });

  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [failureReason, setFailureReason] = useState("");
  const [failureNotes, setFailureNotes] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [proofNotes, setProofNotes] = useState("");
  const [proofPhoto, setProofPhoto] = useState<File | null>(null);
  const [signature, setSignature] = useState<File | null>(null);
  const [incidentType, setIncidentType] = useState<IncidentType>("delivery_issue");
  const [incidentSeverity, setIncidentSeverity] = useState<IncidentSeverity>("medium");
  const [incidentDescription, setIncidentDescription] = useState("");
  const [incidentPhotos, setIncidentPhotos] = useState<File[]>([]);
  const [faultType, setFaultType] = useState<MaintenanceType>("repair");
  const [faultDescription, setFaultDescription] = useState("");

  useEffect(() => {
    setNotes(currentJob?.notes || "");
  }, [currentJob?.id, currentJob?.notes]);

  const primary = currentJob ? actionConfig[currentJob.status] : null;

  const runPrimary = async () => {
    if (!currentJob || !primary) return;
    if (!primary.action) {
      document.getElementById("proof-form")?.scrollIntoView({ behavior: "smooth" });
      return;
    }

    setBusy("primary");
    try {
      await transition(currentJob.id, primary.action);
      toast.success(primary.label);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Driver action failed");
    } finally {
      setBusy(null);
    }
  };

  const submitFailure = async () => {
    if (!currentJob || !failureReason.trim()) return;
    setBusy("fail");
    try {
      await failJob(currentJob.id, failureReason, failureNotes);
      setFailureReason("");
      setFailureNotes("");
      toast.success(`${terminology.Singular} marked failed`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to report failed job");
    } finally {
      setBusy(null);
    }
  };

  const submitCompletion = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentJob) return;
    setBusy("proof");
    try {
      await submitProof(currentJob.id, {
        recipientName,
        notes: proofNotes,
        photo: proofPhoto,
        signature,
      });
      setRecipientName("");
      setProofNotes("");
      setProofPhoto(null);
      setSignature(null);
      toast.success(`${terminology.Singular} completed`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Proof upload failed");
    } finally {
      setBusy(null);
    }
  };

  const submitIncident = async () => {
    if (!currentJob || !incidentDescription.trim()) return;
    setBusy("incident");
    try {
      await createIncident(
        {
          job_id: currentJob.id,
          vehicle_id: currentJob.vehicle_id,
          driver_id: currentJob.driver_id,
          incident_type: incidentType,
          severity: incidentSeverity,
          status: "open",
          description: incidentDescription,
          location: currentJob.dropoff_location || currentJob.pickup_location,
          occurred_at: new Date().toISOString(),
          photo_urls: null,
          resolution_notes: null,
          resolved_at: null,
        },
        incidentPhotos,
      );
      setIncidentDescription("");
      setIncidentPhotos([]);
      toast.success("Incident reported");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to report incident");
    } finally {
      setBusy(null);
    }
  };

  const submitFault = async () => {
    const vehicleId = currentJob?.vehicle_id || driver?.assigned_vehicle_id;
    if (!vehicleId || !faultDescription.trim()) return;
    setBusy("fault");
    try {
      await createMaintenance({
        vehicle_id: vehicleId,
        title: "Driver reported vehicle fault",
        maintenance_type: faultType,
        status: "reported",
        description: faultDescription,
        notes: null,
        scheduled_date: null,
        due_odometer: null,
        cost: null,
        invoice_url: null,
        completed_at: null,
        started_at: null,
      });
      setFaultDescription("");
      toast.success("Vehicle fault reported");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to report vehicle fault");
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-lg px-4 py-5">
        <LoadingState label="Loading driver workflow" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-lg px-4 py-5">
        <ErrorState title="Could not load driver workflow" description={error} onAction={fetch} />
      </div>
    );
  }

  if (!driver) {
    return (
      <div className="mx-auto max-w-lg px-4 py-5">
        <EmptyState
          title="No driver profile linked"
          description="Ask an admin or fleet manager to link your user account to a driver record."
          icon={Truck}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 py-5">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Driver workflow
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{driver.full_name}</h1>
      </div>

      {currentJob ? (
        <>
          <JobCard job={currentJob} label={`Current ${terminology.singular}`} />
          <Card className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-semibold">Trip tracking</h2>
            </div>
            <div className="space-y-3 text-sm">
              <div>
                <p className="font-medium">{trackingCopy[tracking.uiState].title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {trackingCopy[tracking.uiState].detail}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div>Permission: {tracking.permissionState}</div>
                <div>Network: {tracking.online ? "online" : "offline"}</div>
                <div>Queue: {tracking.queuePending} pending</div>
                <div>Movement: {tracking.movementState}</div>
              </div>
              {tracking.lastError ? (
                <p className="text-xs text-status-warning">{tracking.lastError}</p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Browser and PWA tracking can pause when the browser is closed, suspended, or killed.
              </p>
              {tracking.activeTrip ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button
                    type="button"
                    variant={tracking.enabled ? "outline" : "default"}
                    onClick={() => void tracking.enableTracking()}
                    disabled={tracking.enabled && tracking.uiState !== "permission_required"}
                  >
                    {tracking.enabled ? "Tracking enabled" : "Enable trip tracking"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void tracking.syncNow()}
                    disabled={!tracking.online || tracking.syncing || tracking.queuePending === 0}
                  >
                    {tracking.syncing ? "Syncing..." : "Sync now"}
                  </Button>
                </div>
              ) : null}
            </div>
          </Card>
          {primary ? (
            <Button
              className="h-14 w-full gap-2 text-base"
              size="lg"
              onClick={runPrimary}
              disabled={busy === "primary"}
            >
              {busy === "primary" ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <primary.icon className="h-5 w-5" />
              )}
              {primary.label}
            </Button>
          ) : null}

          {nextJob ? <JobCard job={nextJob} label={`Next ${terminology.singular}`} /> : null}

          <Card className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <PenLine className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-semibold">Job notes</h2>
            </div>
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} />
            <Button
              className="mt-3 w-full gap-2"
              variant="outline"
              onClick={async () => {
                setBusy("notes");
                try {
                  await saveNotes(currentJob.id, notes);
                  toast.success("Notes saved");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Could not save notes");
                } finally {
                  setBusy(null);
                }
              }}
              disabled={busy === "notes"}
            >
              <Save className="h-4 w-4" />
              Save notes
            </Button>
          </Card>

          {currentJob.status === "arrived" ? (
            <Card id="proof-form" className="p-4">
              <div className="mb-3 flex items-center gap-2">
                <FileSignature className="h-4 w-4 text-muted-foreground" />
                <h2 className="font-semibold">Proof of completion</h2>
              </div>
              <form className="space-y-4" onSubmit={submitCompletion}>
                <div className="space-y-1.5">
                  <Label htmlFor="recipient">Recipient/customer name</Label>
                  <Input
                    id="recipient"
                    value={recipientName}
                    onChange={(event) => setRecipientName(event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="proofPhoto">Photo</Label>
                  <Input
                    id="proofPhoto"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(event) => setProofPhoto(event.target.files?.[0] ?? null)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Signature</Label>
                  <SignaturePad onChange={setSignature} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="proofNotes">Completion notes</Label>
                  <Textarea
                    id="proofNotes"
                    value={proofNotes}
                    onChange={(event) => setProofNotes(event.target.value)}
                    rows={3}
                  />
                </div>
                <Button type="submit" className="h-12 w-full gap-2" disabled={busy === "proof"}>
                  {busy === "proof" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle className="h-4 w-4" />
                  )}
                  Submit proof and complete
                </Button>
              </form>
            </Card>
          ) : null}

          <Card className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <XCircle className="h-4 w-4 text-status-error" />
              <h2 className="font-semibold">Report failed job</h2>
            </div>
            <div className="space-y-3">
              <Input
                placeholder="Failure reason"
                value={failureReason}
                onChange={(event) => setFailureReason(event.target.value)}
              />
              <Textarea
                placeholder="Additional notes"
                value={failureNotes}
                onChange={(event) => setFailureNotes(event.target.value)}
                rows={3}
              />
              <Button
                className="w-full"
                variant="destructive"
                onClick={submitFailure}
                disabled={busy === "fail" || !failureReason.trim()}
              >
                Report failed job
              </Button>
            </div>
          </Card>

          <Card className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-status-warning" />
              <h2 className="font-semibold">Report incident</h2>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={incidentType}
                  onChange={(event) => setIncidentType(event.target.value as IncidentType)}
                >
                  {[
                    "accident",
                    "breakdown",
                    "vehicle_damage",
                    "delivery_issue",
                    "driver_issue",
                    "customer_issue",
                    "safety_issue",
                    "other",
                  ].map((type) => (
                    <option key={type} value={type}>
                      {type.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={incidentSeverity}
                  onChange={(event) => setIncidentSeverity(event.target.value as IncidentSeverity)}
                >
                  {["low", "medium", "high", "critical"].map((severity) => (
                    <option key={severity} value={severity}>
                      {severity}
                    </option>
                  ))}
                </select>
              </div>
              <Textarea
                placeholder="Describe the incident"
                value={incidentDescription}
                onChange={(event) => setIncidentDescription(event.target.value)}
                rows={4}
              />
              <div className="space-y-1.5">
                <Label htmlFor="incidentPhotos">Photos</Label>
                <Input
                  id="incidentPhotos"
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(event) => setIncidentPhotos(Array.from(event.target.files ?? []))}
                />
              </div>
              <Button
                className="w-full gap-2"
                variant="outline"
                onClick={submitIncident}
                disabled={busy === "incident" || !incidentDescription.trim()}
              >
                <Camera className="h-4 w-4" />
                Submit incident
              </Button>
            </div>
          </Card>
        </>
      ) : (
        <EmptyState
          title={`No assigned ${terminology.plural}`}
          description={`Your current and next assigned ${terminology.plural} will appear here.`}
          icon={ClipboardList}
        />
      )}

      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <Wrench className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold">Report vehicle fault</h2>
        </div>
        <div className="space-y-3">
          <select
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={faultType}
            onChange={(event) => setFaultType(event.target.value as MaintenanceType)}
          >
            {[
              "repair",
              "service",
              "inspection",
              "tyres",
              "brakes",
              "engine",
              "electrical",
              "other",
            ].map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <Textarea
            placeholder="Describe the vehicle fault"
            value={faultDescription}
            onChange={(event) => setFaultDescription(event.target.value)}
            rows={4}
          />
          <Button
            className="w-full"
            variant="outline"
            onClick={submitFault}
            disabled={busy === "fault" || !faultDescription.trim()}
          >
            Report fault
          </Button>
        </div>
      </Card>
    </div>
  );
}
