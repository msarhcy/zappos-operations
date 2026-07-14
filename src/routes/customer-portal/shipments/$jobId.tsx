/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  FileText,
  MapPin,
  PackageCheck,
  ShieldCheck,
  MessageSquare,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/session";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CustomerShipmentMap } from "@/lib/maps/CustomerShipmentMap";
import {
  buildCustomerTimeline,
  getCustomerVisibleDocuments,
  isProofAccessible,
  isTrackingVisible,
  mapJobStatusToCustomerStatus,
} from "@/lib/customer-portal";

export const Route = createFileRoute("/customer-portal/shipments/$jobId")({
  head: () => ({ meta: [{ title: "Shipment details — Customer portal" }] }),
  component: ShipmentDetailPage,
});

function ShipmentDetailPage() {
  const { session } = useSession();
  const { jobId } = Route.useParams();
  const [job, setJob] = useState<any>(null);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [proof, setProof] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [fileAction, setFileAction] = useState<string | null>(null);
  const [tracking, setTracking] = useState<any>(null);
  const [acknowledgements, setAcknowledgements] = useState<any[]>([]);

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
        setLoading(false);
        return;
      }

      const [
        { data: jobData },
        { data: setting },
        { data: location },
        { data: acks },
        { data: eventsData },
        { data: docsData },
        { data: proofData },
      ] = await Promise.all([
        supabase
          .from("jobs")
          .select(
            "id, reference, pickup_location, dropoff_location, scheduled_at, started_at, arrived_at, status, completed_at, company_id, customer_id",
          )
          .eq("company_id", membership.company_id)
          .eq("customer_id", membership.customer_id)
          .eq("id", jobId)
          .maybeSingle(),
        (supabase as any)
          .from("customer_shipment_settings")
          .select("tracking_visibility")
          .eq("job_id", jobId)
          .maybeSingle(),
        (supabase as any)
          .from("customer_shipment_locations")
          .select("latitude,longitude,recorded_at")
          .eq("job_id", jobId)
          .maybeSingle(),
        supabase
          .from("customer_acknowledgements")
          .select("id,acknowledgement_type,created_at")
          .eq("job_id", jobId)
          .eq("user_id", session.user.id)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("job_events")
          .select("event_type, created_at")
          .eq("job_id", jobId)
          .order("created_at", { ascending: true })
          .limit(50),
        supabase
          .from("documents")
          .select("id, name, document_type, visibility, file_url")
          .eq("company_id", membership.company_id)
          .order("created_at", { ascending: false })
          .limit(50),
        (supabase as any)
          .from("job_proofs")
          .select(
            "id, recipient_name, completed_at, notes, photo_url, signature_url, customer_visible, finalized_at",
          )
          .eq("job_id", jobId)
          .eq("company_id", membership.company_id)
          .maybeSingle(),
      ]);

      setJob(jobData);
      const safeTimeline = buildCustomerTimeline({
        jobStatus: jobData?.status ?? "scheduled",
        proofAvailable: Boolean(proofData),
        scheduledAt: jobData?.scheduled_at,
        startedAt: jobData?.started_at,
        arrivedAt: jobData?.arrived_at,
        completedAt: jobData?.completed_at,
        events: eventsData ?? [],
      });
      setTimeline(safeTimeline);
      setDocuments(getCustomerVisibleDocuments(docsData ?? []));
      setProof(proofData);
      setTracking({ visibility: setting?.tracking_visibility ?? "disabled", location });
      setAcknowledgements(acks ?? []);
      setLoading(false);
    };

    void load();
  }, [jobId, session?.user?.id]);

  const customerStatus = useMemo(
    () => (job ? mapJobStatusToCustomerStatus(job.status) : "scheduled"),
    [job],
  );
  const trackingAllowed = useMemo(() => {
    if (!job) return false;
    return isTrackingVisible({ jobStatus: job.status, visibility: tracking?.visibility });
  }, [job, tracking]);
  const proofAllowed = useMemo(() => {
    if (!job) return false;
    return isProofAccessible({
      jobStatus: job.status,
      proofVisible: proof?.customer_visible,
      proofFinalized: Boolean(proof?.finalized_at),
    });
  }, [job, proof]);

  const openSignedFile = async (path: string | null, label: string) => {
    if (!path) return;
    setFileAction(label);
    try {
      const { data, error } = await supabase.storage.from("documents").createSignedUrl(path, 60);
      if (error || !data?.signedUrl) throw error ?? new Error("Could not prepare secure file");
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
      if (session?.user.id && job)
        await supabase.from("customer_portal_audit_logs").insert({
          company_id: job.company_id,
          customer_id: job.customer_id,
          user_id: session.user.id,
          entity_type: "document",
          entity_id: label,
          event_type: "document_viewed",
        });
    } finally {
      setFileAction(null);
    }
  };

  const acknowledge = async (type: string) => {
    if (!session?.user.id || acknowledgements.some((ack) => ack.acknowledgement_type === type))
      return;
    const { data, error } = await supabase
      .from("customer_acknowledgements")
      .insert({
        company_id: job.company_id,
        customer_id: job.customer_id,
        user_id: session.user.id,
        job_id: job.id,
        acknowledgement_type: type,
      })
      .select("id,acknowledgement_type,created_at")
      .single();
    if (!error && data) {
      setAcknowledgements((current) => [data, ...current]);
      await supabase.from("customer_portal_audit_logs").insert({
        company_id: job.company_id,
        customer_id: job.customer_id,
        user_id: session.user.id,
        entity_type: "job",
        entity_id: job.id,
        event_type: "acknowledgement_created",
        detail: type,
      });
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-400">
        Loading shipment...
      </div>
    );
  }

  if (!job) {
    return (
      <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-400">
        This shipment is not available to your portal account.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Shipment details</p>
          <h2 className="mt-2 text-2xl font-semibold">{job.reference}</h2>
        </div>
        <Link to="/customer-portal/shipments">
          <Button variant="ghost" className="gap-2 text-slate-200">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        </Link>
      </div>

      <Card className="border-white/10 bg-slate-900/70 p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Current status</p>
            <p className="mt-2 text-lg font-semibold text-white">{customerStatus}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Scheduled</p>
            <p className="mt-2 text-sm text-slate-300">
              {job.scheduled_at ? new Date(job.scheduled_at).toLocaleString() : "Pending"}
            </p>
          </div>
          <div className="flex items-start gap-2">
            <MapPin className="mt-1 h-4 w-4 text-slate-400" />
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Pickup</p>
              <p className="mt-1 text-sm text-slate-300">{job.pickup_location ?? "Pending"}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <MapPin className="mt-1 h-4 w-4 text-slate-400" />
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Destination</p>
              <p className="mt-1 text-sm text-slate-300">{job.dropoff_location ?? "Pending"}</p>
            </div>
          </div>
        </div>
      </Card>

      <Card className="border-white/10 bg-slate-900/70 p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          <h3 className="font-semibold text-white">Secure tracking</h3>
        </div>
        <p className="mt-2 text-sm text-slate-400">
          {trackingAllowed
            ? "Location visibility is enabled for this active shipment. Last updated location is shown only when it is current."
            : "Tracking is not exposed for this shipment beyond the customer-safe status."}
        </p>
        {trackingAllowed && tracking?.location ? (
          <div className="mt-4">
            <p className="mb-2 text-xs text-slate-400">
              Last updated {new Date(tracking.location.recorded_at).toLocaleString()}
            </p>
            <CustomerShipmentMap
              reference={job.reference}
              latitude={
                tracking.visibility === "approximate"
                  ? Math.round(Number(tracking.location.latitude) * 100) / 100
                  : Number(tracking.location.latitude)
              }
              longitude={
                tracking.visibility === "approximate"
                  ? Math.round(Number(tracking.location.longitude) * 100) / 100
                  : Number(tracking.location.longitude)
              }
            />
          </div>
        ) : null}
      </Card>

      <Card className="border-white/10 bg-slate-900/70 p-5">
        <h3 className="font-semibold text-white">Acknowledgements</h3>
        <p className="mt-1 text-sm text-slate-400">
          Your acknowledgements are recorded for this shipment.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            ["proof_received", "Proof received"],
            ["delivery_confirmed", "Delivery confirmed"],
            ["issue_resolved", "Issue resolved"],
          ].map(([type, label]) => (
            <Button
              key={type}
              size="sm"
              variant="outline"
              disabled={acknowledgements.some((ack) => ack.acknowledgement_type === type)}
              onClick={() => void acknowledge(type)}
            >
              {acknowledgements.some((ack) => ack.acknowledgement_type === type)
                ? `${label} recorded`
                : label}
            </Button>
          ))}
        </div>
        {acknowledgements.map((ack) => (
          <p key={ack.id} className="mt-2 text-xs text-slate-400">
            {ack.acknowledgement_type.replaceAll("_", " ")} ·{" "}
            {new Date(ack.created_at).toLocaleString()}
          </p>
        ))}
      </Card>

      <Card className="border-white/10 bg-slate-900/70 p-5">
        <h3 className="font-semibold text-white">Status timeline</h3>
        <div className="mt-4 space-y-3">
          {timeline.map((entry) => (
            <div
              key={`${entry.title}-${entry.timestamp}`}
              className="rounded-xl border border-white/10 bg-slate-950/60 p-3"
            >
              <p className="text-sm font-medium text-white">{entry.title}</p>
              <p className="mt-1 text-sm text-slate-400">{entry.description}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="border-white/10 bg-slate-900/70 p-5">
        <div className="flex items-center gap-2">
          <PackageCheck className="h-4 w-4 text-emerald-400" />
          <h3 className="font-semibold text-white">Proof of delivery</h3>
        </div>
        <p className="mt-2 text-sm text-slate-400">
          {proofAllowed && proof
            ? `Delivered to ${proof.recipient_name ?? "the recipient"} on ${new Date(proof.completed_at).toLocaleString()}. ${proof.notes ?? ""}`
            : "Proof will appear here once the delivery is finalized and approved for customer access."}
          {proofAllowed && proof?.photo_url ? (
            <Button
              className="mt-3"
              size="sm"
              disabled={fileAction === "proof"}
              onClick={() => void openSignedFile(proof.photo_url, "proof")}
            >
              Download proof
            </Button>
          ) : null}
        </p>
      </Card>

      <Card className="border-white/10 bg-slate-900/70 p-5">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-slate-400" />
          <h3 className="font-semibold text-white">Customer-visible documents</h3>
        </div>
        <div className="mt-4 space-y-2">
          {documents.length === 0 ? (
            <p className="text-sm text-slate-400">
              No customer-visible documents are attached to this shipment yet.
            </p>
          ) : (
            documents.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/60 p-3 text-sm text-slate-300"
              >
                <span>
                  {doc.name} · {doc.document_type}
                </span>
                {doc.file_url ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={fileAction === doc.id}
                    onClick={() => void openSignedFile(doc.file_url, doc.id)}
                  >
                    Open
                  </Button>
                ) : null}
              </div>
            ))
          )}
        </div>
      </Card>
      <Card className="border-white/10 bg-slate-900/70 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-white">Need support?</h3>
            <p className="mt-1 text-sm text-slate-400">
              Create a request without changing this shipment.
            </p>
          </div>
          <Link to="/customer-portal/requests">
            <Button className="gap-2">
              <MessageSquare className="h-4 w-4" />
              Request support
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
