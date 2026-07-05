import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "./session";
import type { Database } from "@/integrations/supabase/types";
import { getTerminology, type Terminology } from "./terminology";

type Company = Database["public"]["Tables"]["companies"]["Row"];
type Role = Database["public"]["Enums"]["app_role"];

interface CompanyContextValue {
  loading: boolean;
  companies: Company[];
  activeCompany: Company | null;
  setActiveCompany: (companyId: string) => Promise<void>;
  roles: Role[];
  hasRole: (role: Role) => boolean;
  hasAnyRole: (roles: Role[]) => boolean;
  refresh: () => Promise<void>;
  terminology: ReturnType<typeof getTerminology>;
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [activeCompanyId, setActiveId] = useState<string | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);

  const load = async () => {
    if (!user) {
      setCompanies([]);
      setActiveId(null);
      setRoles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [{ data: members }, { data: profile }] = await Promise.all([
      supabase.from("company_members").select("company_id, companies:company_id(*)").eq("user_id", user.id),
      supabase.from("profiles").select("active_company_id").eq("id", user.id).maybeSingle(),
    ]);
    const list: Company[] =
      (members ?? [])
        .map((m) => (m as unknown as { companies: Company | null }).companies)
        .filter((c): c is Company => !!c);
    setCompanies(list);
    let activeId = profile?.active_company_id ?? null;
    if (!activeId || !list.find((c) => c.id === activeId)) {
      activeId = list[0]?.id ?? null;
    }
    setActiveId(activeId);

    if (activeId) {
      const { data: rolesData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("company_id", activeId);
      setRoles((rolesData ?? []).map((r) => r.role as Role));
    } else {
      setRoles([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const setActiveCompany = async (companyId: string) => {
    if (!user) return;
    await supabase.from("profiles").update({ active_company_id: companyId }).eq("id", user.id);
    await load();
  };

  const activeCompany = companies.find((c) => c.id === activeCompanyId) ?? null;
  const value = useMemo<CompanyContextValue>(
    () => ({
      loading,
      companies,
      activeCompany,
      setActiveCompany,
      roles,
      hasRole: (r) => roles.includes(r),
      hasAnyRole: (rs) => rs.some((r) => roles.includes(r)),
      refresh: load,
      terminology: getTerminology(activeCompany?.terminology as Terminology | undefined),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loading, companies, activeCompanyId, roles],
  );

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompany() {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error("useCompany must be used inside CompanyProvider");
  return ctx;
}
