
-- =========================================================================
-- ZappOS — Phase 1 schema
-- Multi-tenant transport & fleet operations SaaS
-- =========================================================================

-- ---------- ENUMS -------------------------------------------------------
CREATE TYPE public.app_role AS ENUM ('admin', 'fleet_manager', 'dispatcher', 'driver', 'viewer');
CREATE TYPE public.business_type AS ENUM ('logistics','trucking','courier','food_delivery','last_mile','fuel_petroleum','passenger_transport','other');
CREATE TYPE public.terminology AS ENUM ('trips','jobs','deliveries','loads','orders');
CREATE TYPE public.fleet_size AS ENUM ('1-5','6-20','21-50','51-100','100+');
CREATE TYPE public.vehicle_type AS ENUM ('truck','van','car','motorcycle','bus','tanker','other');
CREATE TYPE public.vehicle_status AS ENUM ('available','in_use','maintenance','out_of_service');
CREATE TYPE public.driver_status AS ENUM ('available','on_trip','off_duty','suspended');
CREATE TYPE public.job_priority AS ENUM ('low','normal','high','critical');
CREATE TYPE public.job_status AS ENUM ('unassigned','assigned','accepted','in_progress','arrived','completed','failed','cancelled');
CREATE TYPE public.maintenance_type AS ENUM ('service','repair','inspection','tyres','brakes','engine','electrical','other');
CREATE TYPE public.maintenance_status AS ENUM ('reported','scheduled','in_progress','completed');
CREATE TYPE public.incident_type AS ENUM ('accident','breakdown','vehicle_damage','delivery_issue','driver_issue','customer_issue','safety_issue','other');
CREATE TYPE public.incident_severity AS ENUM ('low','medium','high','critical');
CREATE TYPE public.incident_status AS ENUM ('open','investigating','resolved');
CREATE TYPE public.document_owner_type AS ENUM ('company','vehicle','driver');
CREATE TYPE public.notification_type AS ENUM (
  'job_assigned','job_accepted','job_started','job_delayed','job_completed','job_failed',
  'incident_reported','incident_critical','maintenance_overdue',
  'document_expiring','document_expired'
);

-- ---------- updated_at helper ------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ---------- profiles ---------------------------------------------------
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  phone TEXT,
  avatar_url TEXT,
  active_company_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles self select" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "profiles self update" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "profiles self insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE TRIGGER profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------- companies --------------------------------------------------
CREATE TABLE public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  business_type public.business_type NOT NULL DEFAULT 'logistics',
  country TEXT,
  fleet_size public.fleet_size,
  terminology public.terminology NOT NULL DEFAULT 'jobs',
  document_expiry_warning_days INT NOT NULL DEFAULT 30,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER companies_updated BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- company_members (multi-tenant membership) ------------------
CREATE TABLE public.company_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id)
);
CREATE INDEX company_members_user_idx ON public.company_members(user_id);
CREATE INDEX company_members_company_idx ON public.company_members(company_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_members TO authenticated;
GRANT ALL ON public.company_members TO service_role;
ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;

-- ---------- user_roles (per company) -----------------------------------
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, company_id, role)
);
CREATE INDEX user_roles_user_company_idx ON public.user_roles(user_id, company_id);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- ---------- Security-definer helpers -----------------------------------
CREATE OR REPLACE FUNCTION public.is_company_member(_company_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_members
    WHERE company_id = _company_id AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.has_role(_company_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND company_id = _company_id AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_company_id UUID, _roles public.app_role[])
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND company_id = _company_id AND role = ANY(_roles)
  );
$$;

-- companies RLS (uses helpers)
CREATE POLICY "companies member select" ON public.companies FOR SELECT TO authenticated
  USING (public.is_company_member(id));
CREATE POLICY "companies authed insert" ON public.companies FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());
CREATE POLICY "companies admin update" ON public.companies FOR UPDATE TO authenticated
  USING (public.has_role(id, 'admin')) WITH CHECK (public.has_role(id, 'admin'));
CREATE POLICY "companies admin delete" ON public.companies FOR DELETE TO authenticated
  USING (public.has_role(id, 'admin'));

-- company_members RLS
CREATE POLICY "members self select" ON public.company_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_company_member(company_id));
CREATE POLICY "members self insert on new company" ON public.company_members FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "members admin insert" ON public.company_members FOR INSERT TO authenticated
  WITH CHECK (public.has_role(company_id, 'admin'));
CREATE POLICY "members admin delete" ON public.company_members FOR DELETE TO authenticated
  USING (public.has_role(company_id, 'admin'));

-- user_roles RLS
CREATE POLICY "roles member read" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_company_member(company_id));
CREATE POLICY "roles admin insert" ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.has_role(company_id, 'admin'));
CREATE POLICY "roles self-bootstrap admin" ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND role = 'admin'
    AND EXISTS (SELECT 1 FROM public.companies c WHERE c.id = company_id AND c.created_by = auth.uid())
  );
CREATE POLICY "roles admin delete" ON public.user_roles FOR DELETE TO authenticated
  USING (public.has_role(company_id, 'admin'));

-- ---------- Reusable tenant policy pattern ------------------------------
-- Every tenant table uses: is_company_member(company_id) for read/write
-- plus role checks for destructive ops where appropriate.

-- ---------- customers --------------------------------------------------
CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX customers_company_idx ON public.customers(company_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "customers tenant rw" ON public.customers FOR ALL TO authenticated
  USING (public.is_company_member(company_id)) WITH CHECK (public.is_company_member(company_id));
CREATE TRIGGER customers_updated BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- drivers ----------------------------------------------------
CREATE TABLE public.drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  employee_ref TEXT,
  licence_number TEXT,
  licence_class TEXT,
  licence_expiry DATE,
  status public.driver_status NOT NULL DEFAULT 'available',
  assigned_vehicle_id UUID,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX drivers_company_idx ON public.drivers(company_id);
CREATE INDEX drivers_user_idx ON public.drivers(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.drivers TO authenticated;
GRANT ALL ON public.drivers TO service_role;
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drivers tenant rw" ON public.drivers FOR ALL TO authenticated
  USING (public.is_company_member(company_id)) WITH CHECK (public.is_company_member(company_id));
CREATE TRIGGER drivers_updated BEFORE UPDATE ON public.drivers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- vehicles ---------------------------------------------------
CREATE TABLE public.vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  registration TEXT NOT NULL,
  vehicle_type public.vehicle_type NOT NULL DEFAULT 'truck',
  make TEXT,
  model TEXT,
  year INT,
  vin TEXT,
  odometer INT,
  status public.vehicle_status NOT NULL DEFAULT 'available',
  assigned_driver_id UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
  licence_expiry DATE,
  insurance_expiry DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX vehicles_company_idx ON public.vehicles(company_id);
CREATE UNIQUE INDEX vehicles_company_reg_idx ON public.vehicles(company_id, lower(registration));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicles TO authenticated;
GRANT ALL ON public.vehicles TO service_role;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vehicles tenant rw" ON public.vehicles FOR ALL TO authenticated
  USING (public.is_company_member(company_id)) WITH CHECK (public.is_company_member(company_id));
CREATE TRIGGER vehicles_updated BEFORE UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Add FK from drivers.assigned_vehicle_id now that vehicles exists
ALTER TABLE public.drivers
  ADD CONSTRAINT drivers_assigned_vehicle_fk
  FOREIGN KEY (assigned_vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL;

-- ---------- job reference sequence per company -------------------------
CREATE SEQUENCE public.jobs_ref_seq;

-- ---------- jobs -------------------------------------------------------
CREATE TABLE public.jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  reference TEXT NOT NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  pickup_location TEXT,
  dropoff_location TEXT,
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
  driver_id UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
  scheduled_at TIMESTAMPTZ,
  description TEXT,
  notes TEXT,
  priority public.job_priority NOT NULL DEFAULT 'normal',
  status public.job_status NOT NULL DEFAULT 'unassigned',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  arrived_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  failure_reason TEXT,
  proof_photo_url TEXT,
  proof_signature_url TIMESTAMPTZ, -- fixed below
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, reference)
);
-- Fix proof_signature_url type (was mistyped)
ALTER TABLE public.jobs DROP COLUMN proof_signature_url;
ALTER TABLE public.jobs ADD COLUMN proof_signature_url TEXT;
ALTER TABLE public.jobs ADD COLUMN proof_recipient_name TEXT;
ALTER TABLE public.jobs ADD COLUMN proof_notes TEXT;
ALTER TABLE public.jobs ADD COLUMN proof_lat DOUBLE PRECISION;
ALTER TABLE public.jobs ADD COLUMN proof_lng DOUBLE PRECISION;

CREATE INDEX jobs_company_idx ON public.jobs(company_id);
CREATE INDEX jobs_driver_idx ON public.jobs(driver_id);
CREATE INDEX jobs_vehicle_idx ON public.jobs(vehicle_id);
CREATE INDEX jobs_status_idx ON public.jobs(company_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jobs TO authenticated;
GRANT ALL ON public.jobs TO service_role;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "jobs tenant rw" ON public.jobs FOR ALL TO authenticated
  USING (public.is_company_member(company_id)) WITH CHECK (public.is_company_member(company_id));
CREATE TRIGGER jobs_updated BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- job_events (activity timeline) -----------------------------
CREATE TABLE public.job_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX job_events_job_idx ON public.job_events(job_id, created_at DESC);
GRANT SELECT, INSERT ON public.job_events TO authenticated;
GRANT ALL ON public.job_events TO service_role;
ALTER TABLE public.job_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "job_events tenant read" ON public.job_events FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));
CREATE POLICY "job_events tenant insert" ON public.job_events FOR INSERT TO authenticated
  WITH CHECK (public.is_company_member(company_id));

-- ---------- maintenance ------------------------------------------------
CREATE TABLE public.maintenance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  maintenance_type public.maintenance_type NOT NULL DEFAULT 'service',
  status public.maintenance_status NOT NULL DEFAULT 'reported',
  title TEXT NOT NULL,
  description TEXT,
  scheduled_date DATE,
  due_odometer INT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cost NUMERIC(12,2),
  invoice_url TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX maintenance_company_idx ON public.maintenance(company_id);
CREATE INDEX maintenance_vehicle_idx ON public.maintenance(vehicle_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.maintenance TO authenticated;
GRANT ALL ON public.maintenance TO service_role;
ALTER TABLE public.maintenance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "maintenance tenant rw" ON public.maintenance FOR ALL TO authenticated
  USING (public.is_company_member(company_id)) WITH CHECK (public.is_company_member(company_id));
CREATE TRIGGER maintenance_updated BEFORE UPDATE ON public.maintenance FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- incidents --------------------------------------------------
CREATE TABLE public.incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  incident_type public.incident_type NOT NULL DEFAULT 'other',
  severity public.incident_severity NOT NULL DEFAULT 'medium',
  status public.incident_status NOT NULL DEFAULT 'open',
  job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
  driver_id UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
  location TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  description TEXT NOT NULL,
  photo_urls TEXT[],
  reported_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX incidents_company_idx ON public.incidents(company_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.incidents TO authenticated;
GRANT ALL ON public.incidents TO service_role;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "incidents tenant rw" ON public.incidents FOR ALL TO authenticated
  USING (public.is_company_member(company_id)) WITH CHECK (public.is_company_member(company_id));
CREATE TRIGGER incidents_updated BEFORE UPDATE ON public.incidents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- documents (polymorphic owner) ------------------------------
CREATE TABLE public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  owner_type public.document_owner_type NOT NULL,
  owner_id UUID NOT NULL,
  document_type TEXT NOT NULL,
  name TEXT NOT NULL,
  file_url TEXT,
  issue_date DATE,
  expiry_date DATE,
  notes TEXT,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX documents_company_idx ON public.documents(company_id);
CREATE INDEX documents_owner_idx ON public.documents(owner_type, owner_id);
CREATE INDEX documents_expiry_idx ON public.documents(company_id, expiry_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;
GRANT ALL ON public.documents TO service_role;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "documents tenant rw" ON public.documents FOR ALL TO authenticated
  USING (public.is_company_member(company_id)) WITH CHECK (public.is_company_member(company_id));
CREATE TRIGGER documents_updated BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- notifications ----------------------------------------------
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_type public.notification_type NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link_path TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON public.notifications(user_id, read_at, created_at DESC);
GRANT SELECT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notifications self read" ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "notifications self update" ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "notifications self delete" ON public.notifications FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ---------- Job reference generator ------------------------------------
CREATE OR REPLACE FUNCTION public.assign_job_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.reference IS NULL OR NEW.reference = '' THEN
    NEW.reference := 'J-' || to_char(now(), 'YYMMDD') || '-' || lpad(nextval('public.jobs_ref_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER jobs_assign_reference BEFORE INSERT ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.assign_job_reference();

-- ---------- Storage buckets --------------------------------------------
-- (Buckets created via tool afterwards)
