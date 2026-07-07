import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { useSession } from "@/lib/session";
import { getDevicePlatform, getInstallationId } from "@/lib/telemetry/installation";
import { queryLocationPermission } from "@/lib/telemetry/capture";
import type { Database } from "@/integrations/supabase/types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];
type Driver = Database["public"]["Tables"]["drivers"]["Row"];

function filePath(companyId: string, folder: string, file: File) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  return `${companyId}/${folder}/${crypto.randomUUID()}-${safeName}`;
}

export function useDriverWorkflow() {
  const { activeCompany } = useCompany();
  const { user } = useSession();
  const [driver, setDriver] = useState<Driver | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = async () => {
    if (!activeCompany || !user) {
      setDriver(null);
      setJobs([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data: driverData, error: driverError } = await supabase
        .from("drivers")
        .select("*")
        .eq("company_id", activeCompany.id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (driverError) throw driverError;
      setDriver(driverData);

      if (!driverData) {
        setJobs([]);
        return;
      }

      const { data: jobData, error: jobsError } = await supabase
        .from("jobs")
        .select("*")
        .eq("company_id", activeCompany.id)
        .eq("driver_id", driverData.id)
        .in("status", ["assigned", "accepted", "in_progress", "arrived"])
        .order("scheduled_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true });
      if (jobsError) throw jobsError;
      setJobs(jobData || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load driver workflow");
      setDriver(null);
      setJobs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetch();
  }, [activeCompany?.id, user?.id]);

  const currentJob = useMemo(
    () =>
      jobs.find((job) => ["accepted", "in_progress", "arrived"].includes(job.status)) ??
      jobs.find((job) => job.status === "assigned") ??
      null,
    [jobs],
  );
  const nextJob = useMemo(
    () => jobs.find((job) => job.id !== currentJob?.id && job.status === "assigned") ?? null,
    [currentJob?.id, jobs],
  );

  const transition = async (jobId: string, action: "accept" | "start" | "arrive") => {
    const permission =
      action === "start"
        ? await queryLocationPermission().catch(() => "unsupported" as const)
        : null;
    const { error: err } = await supabase.rpc("driver_transition_job", {
      _job_id: jobId,
      _action: action,
      _device_installation_id: action === "start" ? getInstallationId() : null,
      _app_version: action === "start" ? "phase4-web" : null,
      _device_platform: action === "start" ? getDevicePlatform() : null,
      _location_permission_state: permission,
    });
    if (err) throw err;
    await fetch();
  };

  const saveNotes = async (jobId: string, notes: string) => {
    const { error: err } = await supabase.rpc("driver_update_job_notes", {
      _job_id: jobId,
      _notes: notes,
    });
    if (err) throw err;
    await fetch();
  };

  const failJob = async (jobId: string, reason: string, notes?: string) => {
    const { error: err } = await supabase.rpc("driver_fail_job", {
      _job_id: jobId,
      _reason: reason,
      _notes: notes || null,
    });
    if (err) throw err;
    await fetch();
  };

  const submitProof = async (
    jobId: string,
    proof: {
      recipientName: string;
      notes?: string;
      photo?: File | null;
      signature?: File | null;
    },
  ) => {
    if (!activeCompany) throw new Error("No active company");
    let photoUrl: string | null = null;
    let signatureUrl: string | null = null;
    const uploadedPaths: Array<{ bucket: string; path: string }> = [];

    try {
      if (proof.photo) {
        photoUrl = filePath(activeCompany.id, `jobs/${jobId}/photos`, proof.photo);
        const { error: uploadError } = await supabase.storage
          .from("proof-of-completion")
          .upload(photoUrl, proof.photo, { upsert: false });
        if (uploadError) throw uploadError;
        uploadedPaths.push({ bucket: "proof-of-completion", path: photoUrl });
      }

      if (proof.signature) {
        signatureUrl = filePath(activeCompany.id, `jobs/${jobId}/signatures`, proof.signature);
        const { error: uploadError } = await supabase.storage
          .from("proof-of-completion")
          .upload(signatureUrl, proof.signature, {
            upsert: false,
            contentType: "image/png",
          });
        if (uploadError) throw uploadError;
        uploadedPaths.push({ bucket: "proof-of-completion", path: signatureUrl });
      }

      const { error: err } = await supabase.rpc("submit_job_proof", {
        _job_id: jobId,
        _recipient_name: proof.recipientName,
        _notes: proof.notes || null,
        _photo_url: photoUrl,
        _signature_url: signatureUrl,
      });
      if (err) throw err;
      await fetch();
    } catch (error) {
      await Promise.all(
        uploadedPaths.map(async ({ bucket, path }) => {
          await supabase.storage
            .from(bucket)
            .remove([path])
            .catch(() => undefined);
        }),
      );
      throw error;
    }
  };

  return {
    driver,
    jobs,
    currentJob,
    nextJob,
    loading,
    error,
    fetch,
    transition,
    saveNotes,
    failJob,
    submitProof,
  };
}
