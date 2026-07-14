/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/session";
import { Card } from "@/components/ui/card";
import { getCustomerVisibleDocuments } from "@/lib/customer-portal";

export const Route = createFileRoute("/customer-portal/documents")({
  head: () => ({ meta: [{ title: "Documents — Customer portal" }] }),
  component: CustomerDocumentsPage,
});

function CustomerDocumentsPage() {
  const { session } = useSession();
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

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
        setDocuments([]);
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from("documents")
        .select("id, name, document_type, visibility")
        .eq("company_id", membership.company_id)
        .order("created_at", { ascending: false });
      setDocuments(getCustomerVisibleDocuments(data ?? []));
      setLoading(false);
    };
    void load();
  }, [session?.user?.id]);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Documents</p>
        <h2 className="mt-2 text-2xl font-semibold">Customer documents</h2>
        <p className="mt-2 text-sm text-slate-400">
          Only approved customer-visible documents are shown here.
        </p>
      </div>

      {loading ? (
        <Card className="border-white/10 bg-slate-900/70 p-6 text-sm text-slate-400">
          Loading documents...
        </Card>
      ) : documents.length === 0 ? (
        <Card className="border-white/10 bg-slate-900/70 p-8 text-center text-sm text-slate-400">
          <FileText className="mx-auto mb-3 h-8 w-8 text-slate-500" />
          No customer-visible documents are available yet.
        </Card>
      ) : (
        <div className="grid gap-3">
          {documents.map((document) => (
            <Card key={document.id} className="border-white/10 bg-slate-900/70 p-4">
              <p className="font-medium text-white">{document.name}</p>
              <p className="mt-1 text-sm text-slate-400">{document.document_type}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
