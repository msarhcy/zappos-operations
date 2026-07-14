/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCompany } from "@/lib/company-context";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/customer-portal")({
  component: PortalManagement,
});

function PortalManagement() {
  const { activeCompany, hasRole } = useCompany();
  const [memberships, setMemberships] = useState<any[]>([]);
  const [audits, setAudits] = useState<any[]>([]);
  const [links, setLinks] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [share, setShare] = useState({
    jobId: "",
    expiresAt: "",
    maxViews: "1",
    proof: false,
    documents: false,
    tracking: "disabled",
  });
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [invite, setInvite] = useState({ customerId: "", email: "" });
  const [tracking, setTracking] = useState({ jobId: "", customerId: "", visibility: "disabled" });
  const allowed = hasRole("admin") || hasRole("dispatcher") || hasRole("fleet_manager");
  const load = async () => {
    if (!activeCompany || !allowed) return;
    const [members, shareLinks, shipmentRows, logs] = await Promise.all([
      supabase
        .from("customer_portal_memberships")
        .select("id,customer_id,user_id,role,status,created_at,revoked_at")
        .eq("company_id", activeCompany.id)
        .order("created_at", { ascending: false })
        .limit(100),
      (supabase as any)
        .from("shipment_share_links")
        .select(
          "id,job_id,status,created_by,created_at,expires_at,max_views,view_count,permissions",
        )
        .eq("company_id", activeCompany.id)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("jobs")
        .select("id,reference,customer_id")
        .eq("company_id", activeCompany.id)
        .order("scheduled_at", { ascending: false })
        .limit(100),
      supabase
        .from("customer_portal_audit_logs")
        .select("id,event_type,detail,customer_id,created_at")
        .eq("company_id", activeCompany.id)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    setMemberships(members.data ?? []);
    setAudits(logs.data ?? []);
    setLinks(shareLinks.data ?? []);
    setJobs(shipmentRows.data ?? []);
  };
  useEffect(() => {
    void load();
  }, [activeCompany?.id, allowed]);
  const revoke = async (id: string) => {
    await supabase
      .from("customer_portal_memberships")
      .update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("id", id);
    await load();
  };
  const setMembershipStatus = async (id: string, status: "active" | "revoked") => {
    await supabase
      .from("customer_portal_memberships")
      .update({ status, revoked_at: status === "revoked" ? new Date().toISOString() : null })
      .eq("id", id);
    await load();
  };
  const createInvitation = async () => {
    if (!activeCompany || !invite.customerId || !invite.email) return;
    await (supabase as any).rpc("create_customer_portal_invitation", {
      p_customer_id: invite.customerId,
      p_email: invite.email,
    });
    setInvite({ customerId: "", email: "" });
    await load();
  };
  const saveTracking = async () => {
    if (!activeCompany || !tracking.jobId || !tracking.customerId) return;
    await (supabase as any).from("customer_shipment_settings").upsert({
      job_id: tracking.jobId,
      company_id: activeCompany.id,
      customer_id: tracking.customerId,
      tracking_visibility: tracking.visibility,
    });
  };
  const createShareLink = async () => {
    if (!share.jobId || !share.expiresAt || Number(share.maxViews) < 1) return;
    const { data, error } = await (supabase as any).rpc("create_shipment_share_link", {
      p_job_id: share.jobId,
      p_expires_at: new Date(share.expiresAt).toISOString(),
      p_max_views: Number(share.maxViews),
      p_permissions: {
        status: true,
        proof: share.proof,
        documents: share.documents,
        tracking: share.tracking,
      },
    });
    if (!error && data?.token) setCreatedLink(`${window.location.origin}/share/${data.token}`);
    await load();
  };
  const revokeShareLink = async (id: string) => {
    await (supabase as any).rpc("revoke_shipment_share_link", { p_link_id: id });
    await load();
  };
  if (!allowed)
    return (
      <div className="mx-auto max-w-4xl p-6">
        <Card className="p-6">
          Customer portal management is restricted to administrators, dispatchers, and fleet
          managers.
        </Card>
      </div>
    );
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 lg:p-8">
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Customer portal</p>
        <h1 className="text-2xl font-semibold">Portal management</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage customer membership access and review append-only portal activity. Drivers cannot
          access this screen.
        </p>
      </div>
      <Card className="p-5">
        <h2 className="font-semibold">Memberships</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Input
            placeholder="Customer ID"
            value={invite.customerId}
            onChange={(event) => setInvite({ ...invite, customerId: event.target.value })}
          />
          <Input
            placeholder="Invite email"
            value={invite.email}
            onChange={(event) => setInvite({ ...invite, email: event.target.value })}
          />
          <Button onClick={() => void createInvitation()}>Create invitation</Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Invitations expire after seven days. Email delivery is not configured; this records
          invitation metadata only.
        </p>
        <div className="mt-4 space-y-2">
          {memberships.map((member) => (
            <div
              key={member.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded border p-3 text-sm"
            >
              <span>
                {member.customer_id} · {member.role} · {member.status}
              </span>
              {member.status === "active" ? (
                <Button size="sm" variant="outline" onClick={() => void revoke(member.id)}>
                  Revoke access
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void setMembershipStatus(member.id, "active")}
                >
                  Reactivate
                </Button>
              )}
            </div>
          ))}
          {memberships.length === 0 && (
            <p className="text-sm text-muted-foreground">No portal memberships.</p>
          )}
        </div>
      </Card>
      <Card className="p-5">
        <h2 className="font-semibold">Shipment tracking visibility</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Only authorized customers can read this safe location projection. Delivered, cancelled,
          and failed shipments never show a map.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-4">
          <Input
            placeholder="Job ID"
            value={tracking.jobId}
            onChange={(event) => setTracking({ ...tracking, jobId: event.target.value })}
          />
          <Input
            placeholder="Customer ID"
            value={tracking.customerId}
            onChange={(event) => setTracking({ ...tracking, customerId: event.target.value })}
          />
          <Select
            value={tracking.visibility}
            onValueChange={(visibility) => setTracking({ ...tracking, visibility })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="disabled">Disabled</SelectItem>
              <SelectItem value="status">Status only</SelectItem>
              <SelectItem value="approximate">Approximate location</SelectItem>
              <SelectItem value="exact">Exact location</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => void saveTracking()}>Save visibility</Button>
        </div>
      </Card>
      <Card className="p-5">
        <h2 className="font-semibold">Secure share links</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Create a scoped, expiring shipment link. The token is shown once, immediately after
          creation.
        </p>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <Select value={share.jobId} onValueChange={(jobId) => setShare({ ...share, jobId })}>
            <SelectTrigger>
              <SelectValue placeholder="Select shipment" />
            </SelectTrigger>
            <SelectContent>
              {jobs.map((job) => (
                <SelectItem key={job.id} value={job.id}>
                  {job.reference}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="datetime-local"
            value={share.expiresAt}
            onChange={(event) => setShare({ ...share, expiresAt: event.target.value })}
          />
          <Input
            type="number"
            min="1"
            value={share.maxViews}
            onChange={(event) => setShare({ ...share, maxViews: event.target.value })}
            placeholder="Max views"
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <label>
            <input
              type="checkbox"
              checked={share.proof}
              onChange={(event) => setShare({ ...share, proof: event.target.checked })}
            />{" "}
            Proof
          </label>
          <label>
            <input
              type="checkbox"
              checked={share.documents}
              onChange={(event) => setShare({ ...share, documents: event.target.checked })}
            />{" "}
            Documents
          </label>
          <Select
            value={share.tracking}
            onValueChange={(tracking) => setShare({ ...share, tracking })}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="disabled">No tracking</SelectItem>
              <SelectItem value="status">Status only</SelectItem>
              <SelectItem value="approximate">Approximate tracking</SelectItem>
              <SelectItem value="exact">Exact tracking</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => void createShareLink()}>Create share link</Button>
        </div>
        {createdLink ? (
          <p className="mt-3 break-all rounded border p-3 text-sm">Copy now: {createdLink}</p>
        ) : null}
        <div className="mt-4 space-y-2">
          {links.map((link) => (
            <div
              key={link.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded border p-3 text-sm"
            >
              <span>
                {link.status} · created {new Date(link.created_at).toLocaleString()} · expires{" "}
                {link.expires_at ? new Date(link.expires_at).toLocaleString() : "never"} · views{" "}
                {link.view_count}/{link.max_views ?? "∞"} · {JSON.stringify(link.permissions)}
              </span>
              {link.status === "active" ? (
                <Button size="sm" variant="outline" onClick={() => void revokeShareLink(link.id)}>
                  Revoke
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      </Card>
      <Card className="p-5">
        <h2 className="font-semibold">Portal audit</h2>
        <div className="mt-4 space-y-2">
          {audits.map((audit) => (
            <div key={audit.id} className="rounded border p-3 text-sm">
              <span className="font-medium">{audit.event_type}</span>
              {audit.detail ? <span> · {audit.detail}</span> : null}
              <span className="ml-2 text-muted-foreground">
                {new Date(audit.created_at).toLocaleString()}
              </span>
            </div>
          ))}
          {audits.length === 0 && (
            <p className="text-sm text-muted-foreground">No portal activity recorded.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
