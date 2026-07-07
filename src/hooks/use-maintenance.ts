import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { useSession } from "@/lib/session";
import type { Database } from "@/integrations/supabase/types";

type Maintenance = Database["public"]["Tables"]["maintenance"]["Row"];
type MaintenanceInsert = Database["public"]["Tables"]["maintenance"]["Insert"];

function filePath(companyId: string, file: File) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  return `${companyId}/maintenance/${crypto.randomUUID()}-${safeName}`;
}

export function useMaintenance() {
  const { activeCompany } = useCompany();
  const { user } = useSession();
  const [maintenance, setMaintenance] = useState<Maintenance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = async () => {
    if (!activeCompany) {
      setMaintenance([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const { data, error: err } = await supabase
        .from("maintenance")
        .select("*")
        .eq("company_id", activeCompany.id)
        .order("scheduled_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (err) throw err;
      setMaintenance(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load maintenance");
      setMaintenance([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetch();
  }, [activeCompany?.id]);

  const uploadInvoice = async (invoice: File) => {
    if (!activeCompany) throw new Error("No active company");
    const path = filePath(activeCompany.id, invoice);
    const { error: uploadError } = await supabase.storage
      .from("maintenance-invoices")
      .upload(path, invoice, { upsert: false });
    if (uploadError) throw uploadError;
    return path;
  };

  const create = async (
    data: Omit<MaintenanceInsert, "id" | "company_id" | "created_at" | "updated_at" | "created_by">,
    invoice?: File | null,
  ) => {
    if (!activeCompany) throw new Error("No active company");
    const uploadedPaths: string[] = [];
    try {
      const invoiceUrl = invoice ? await uploadInvoice(invoice) : data.invoice_url;
      if (invoice && invoiceUrl) uploadedPaths.push(invoiceUrl);
      const { data: row, error: err } = await supabase
        .from("maintenance")
        .insert([
          {
            ...data,
            company_id: activeCompany.id,
            created_by: user?.id ?? null,
            invoice_url: invoiceUrl ?? null,
          },
        ])
        .select()
        .single();
      if (err) throw err;
      await fetch();
      return row;
    } catch (error) {
      if (uploadedPaths.length > 0) {
        await supabase.storage
          .from("maintenance-invoices")
          .remove(uploadedPaths.filter(Boolean))
          .catch(() => undefined);
      }
      throw error;
    }
  };

  const update = async (id: string, updates: Partial<Maintenance>, invoice?: File | null) => {
    const uploadedPaths: string[] = [];
    try {
      const invoiceUrl = invoice ? await uploadInvoice(invoice) : updates.invoice_url;
      if (invoice && invoiceUrl) uploadedPaths.push(invoiceUrl);
      const { error: err } = await supabase
        .from("maintenance")
        .update({ ...updates, invoice_url: invoiceUrl })
        .eq("id", id);
      if (err) throw err;
      await fetch();
    } catch (error) {
      if (uploadedPaths.length > 0) {
        await supabase.storage
          .from("maintenance-invoices")
          .remove(uploadedPaths.filter(Boolean))
          .catch(() => undefined);
      }
      throw error;
    }
  };

  const delete_ = async (id: string) => {
    const { error: err } = await supabase.from("maintenance").delete().eq("id", id);
    if (err) throw err;
    await fetch();
  };

  return { maintenance, loading, error, fetch, create, update, delete: delete_ };
}
