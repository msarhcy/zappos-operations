-- =========================================================================
-- ZappOS - Phase 13 Customer Portal, Secure Shipment Tracking, and
-- Proof-of-Delivery Sharing.
-- Scope is intentionally limited to customer-safe visibility and sharing.
-- No raw telemtry, internal notes, hardware diagnostics, or AI features.
-- =========================================================================

DO $$ BEGIN
  CREATE TYPE public.customer_portal_role AS ENUM ('viewer','manager');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.customer_portal_invitation_status AS ENUM ('pending','accepted','expired','revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.customer_portal_share_status AS ENUM ('active','revoked','expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.customer_service_request_status AS ENUM ('open','in_progress','resolved','closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.customer_service_request_priority AS ENUM ('low','medium','high','urgent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.customer_portal_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.customer_portal_role NOT NULL DEFAULT 'viewer',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','pending')),
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, customer_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.customer_portal_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL,
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  role public.customer_portal_role NOT NULL DEFAULT 'viewer',
  status public.customer_portal_invitation_status NOT NULL DEFAULT 'pending',
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customer_portal_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_notifications BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, customer_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.customer_service_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  created_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  category TEXT NOT NULL,
  priority public.customer_service_request_priority NOT NULL DEFAULT 'medium',
  status public.customer_service_request_status NOT NULL DEFAULT 'open',
  message TEXT,
  internal_notes TEXT,
  customer_visible_response TEXT,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customer_acknowledgements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  entity_type TEXT,
  entity_id UUID,
  acknowledgement_type TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customer_portal_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.customers(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  entity_type TEXT,
  entity_id UUID,
  event_type TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.shipment_share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  token_hash TEXT NOT NULL,
  status public.customer_portal_share_status NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ,
  max_views INTEGER,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, token_hash)
);

CREATE INDEX IF NOT EXISTS customer_portal_memberships_user_idx
  ON public.customer_portal_memberships(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS customer_portal_memberships_customer_idx
  ON public.customer_portal_memberships(customer_id, company_id, status);
CREATE INDEX IF NOT EXISTS customer_service_requests_customer_idx
  ON public.customer_service_requests(customer_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS shipment_share_links_job_idx
  ON public.shipment_share_links(job_id, status, expires_at);

ALTER TABLE public.customer_portal_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_portal_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_portal_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_service_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_portal_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_share_links ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_portal_memberships TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_portal_invitations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_portal_preferences TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_service_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.customer_acknowledgements TO authenticated;
GRANT SELECT, INSERT ON public.customer_portal_audit_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shipment_share_links TO authenticated;
GRANT ALL ON public.customer_portal_memberships TO service_role;
GRANT ALL ON public.customer_portal_invitations TO service_role;
GRANT ALL ON public.customer_portal_preferences TO service_role;
GRANT ALL ON public.customer_service_requests TO service_role;
GRANT ALL ON public.customer_acknowledgements TO service_role;
GRANT ALL ON public.customer_portal_audit_logs TO service_role;
GRANT ALL ON public.shipment_share_links TO service_role;

DROP TRIGGER IF EXISTS customer_portal_memberships_updated ON public.customer_portal_memberships;
CREATE TRIGGER customer_portal_memberships_updated
  BEFORE UPDATE ON public.customer_portal_memberships
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS customer_portal_invitations_updated ON public.customer_portal_invitations;
CREATE TRIGGER customer_portal_invitations_updated
  BEFORE UPDATE ON public.customer_portal_invitations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS customer_portal_preferences_updated ON public.customer_portal_preferences;
CREATE TRIGGER customer_portal_preferences_updated
  BEFORE UPDATE ON public.customer_portal_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS customer_service_requests_updated ON public.customer_service_requests;
CREATE TRIGGER customer_service_requests_updated
  BEFORE UPDATE ON public.customer_service_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS shipment_share_links_updated ON public.shipment_share_links;
CREATE TRIGGER shipment_share_links_updated
  BEFORE UPDATE ON public.shipment_share_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "customer_portal_memberships self read" ON public.customer_portal_memberships
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "customer_portal_memberships member manage" ON public.customer_portal_memberships
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "customer_portal_preferences self read" ON public.customer_portal_preferences
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "customer_portal_preferences self upsert" ON public.customer_portal_preferences
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "customer_portal_preferences self update" ON public.customer_portal_preferences
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "customer_service_requests self read" ON public.customer_service_requests
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.customer_portal_memberships cpm
      WHERE cpm.user_id = auth.uid()
        AND cpm.company_id = customer_service_requests.company_id
        AND cpm.customer_id = customer_service_requests.customer_id
        AND cpm.status = 'active'
    )
  );

CREATE POLICY "customer_service_requests tenant insert" ON public.customer_service_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(company_id, ARRAY['admin','dispatcher','fleet_manager']::public.app_role[]) OR
    EXISTS (
      SELECT 1
      FROM public.customer_portal_memberships cpm
      WHERE cpm.user_id = auth.uid()
        AND cpm.company_id = customer_service_requests.company_id
        AND cpm.customer_id = customer_service_requests.customer_id
        AND cpm.status = 'active'
    )
  );

CREATE POLICY "customer_portal_audit_logs tenant read" ON public.customer_portal_audit_logs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.customer_portal_memberships cpm
      WHERE cpm.user_id = auth.uid()
        AND cpm.company_id = customer_portal_audit_logs.company_id
        AND cpm.customer_id = customer_portal_audit_logs.customer_id
        AND cpm.status = 'active'
    )
  );

CREATE POLICY "shipment_share_links self read" ON public.shipment_share_links
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.customer_portal_memberships cpm
      WHERE cpm.user_id = auth.uid()
        AND cpm.company_id = shipment_share_links.company_id
        AND cpm.customer_id = shipment_share_links.customer_id
        AND cpm.status = 'active'
    )
  );

CREATE POLICY "customer_portal_memberships tenant read" ON public.customer_portal_memberships
  FOR SELECT TO authenticated
  USING (
    public.has_any_role(company_id, ARRAY['admin','dispatcher','fleet_manager']::public.app_role[]) OR
    user_id = auth.uid()
  );

CREATE POLICY "customer_portal_invitations tenant manage" ON public.customer_portal_invitations
  FOR ALL TO authenticated
  USING (
    public.has_any_role(company_id, ARRAY['admin','dispatcher','fleet_manager']::public.app_role[]) OR
    user_id = auth.uid()
  )
  WITH CHECK (
    public.has_any_role(company_id, ARRAY['admin','dispatcher','fleet_manager']::public.app_role[]) OR
    user_id = auth.uid()
  );

CREATE POLICY "customer_acknowledgements self read" ON public.customer_acknowledgements
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.customer_portal_memberships cpm
      WHERE cpm.user_id = auth.uid()
        AND cpm.company_id = customer_acknowledgements.company_id
        AND cpm.customer_id = customer_acknowledgements.customer_id
        AND cpm.status = 'active'
    )
  );

CREATE POLICY "customer_acknowledgements tenant insert" ON public.customer_acknowledgements
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(company_id, ARRAY['admin','dispatcher','fleet_manager']::public.app_role[]) OR
    EXISTS (
      SELECT 1
      FROM public.customer_portal_memberships cpm
      WHERE cpm.user_id = auth.uid()
        AND cpm.company_id = customer_acknowledgements.company_id
        AND cpm.customer_id = customer_acknowledgements.customer_id
        AND cpm.status = 'active'
    )
  );

CREATE POLICY "shipment_share_links tenant insert" ON public.shipment_share_links
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(company_id, ARRAY['admin','dispatcher','fleet_manager']::public.app_role[]) OR
    EXISTS (
      SELECT 1
      FROM public.customer_portal_memberships cpm
      WHERE cpm.user_id = auth.uid()
        AND cpm.company_id = shipment_share_links.company_id
        AND cpm.customer_id = shipment_share_links.customer_id
        AND cpm.status = 'active'
    )
  );

CREATE POLICY "shipment_share_links tenant update" ON public.shipment_share_links
  FOR UPDATE TO authenticated
  USING (
    public.has_any_role(company_id, ARRAY['admin','dispatcher','fleet_manager']::public.app_role[]) OR
    EXISTS (
      SELECT 1
      FROM public.customer_portal_memberships cpm
      WHERE cpm.user_id = auth.uid()
        AND cpm.company_id = shipment_share_links.company_id
        AND cpm.customer_id = shipment_share_links.customer_id
        AND cpm.status = 'active'
    )
  )
  WITH CHECK (
    public.has_any_role(company_id, ARRAY['admin','dispatcher','fleet_manager']::public.app_role[]) OR
    EXISTS (
      SELECT 1
      FROM public.customer_portal_memberships cpm
      WHERE cpm.user_id = auth.uid()
        AND cpm.company_id = shipment_share_links.company_id
        AND cpm.customer_id = shipment_share_links.customer_id
        AND cpm.status = 'active'
    )
  );

-- Customer-safe projections.  These tables deliberately do not contain a vehicle
-- identifier, raw telemetry, route history, or device fields.
ALTER TABLE public.customer_portal_preferences
  ADD COLUMN IF NOT EXISTS shipment_updates BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS delivery_updates BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS delay_updates BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS proof_updates BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.job_proofs
  ADD COLUMN IF NOT EXISTS customer_visible BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;
ALTER TABLE public.shipment_share_links
  ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{"status":true,"proof":false,"documents":false}'::jsonb;

CREATE TABLE IF NOT EXISTS public.customer_shipment_settings (
  job_id UUID PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  tracking_visibility TEXT NOT NULL DEFAULT 'disabled' CHECK (tracking_visibility IN ('disabled','approximate','exact')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.customer_shipment_locations (
  job_id UUID PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  latitude NUMERIC NOT NULL, longitude NUMERIC NOT NULL, recorded_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.customer_document_links (
  document_id UUID PRIMARY KEY REFERENCES public.documents(id) ON DELETE CASCADE,
  job_id UUID REFERENCES public.jobs(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_shipment_locations_customer_idx ON public.customer_shipment_locations(customer_id, job_id);
CREATE INDEX IF NOT EXISTS customer_document_links_customer_idx ON public.customer_document_links(customer_id, document_id);

ALTER TABLE public.customer_shipment_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_shipment_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_document_links ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.customer_shipment_settings, public.customer_shipment_locations, public.customer_document_links TO authenticated;
GRANT ALL ON public.customer_shipment_settings, public.customer_shipment_locations, public.customer_document_links TO service_role;

CREATE POLICY "portal shipment settings read" ON public.customer_shipment_settings FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.customer_portal_memberships m WHERE m.user_id = auth.uid() AND m.status = 'active' AND m.company_id = customer_shipment_settings.company_id AND m.customer_id = customer_shipment_settings.customer_id)
);
CREATE POLICY "portal location read" ON public.customer_shipment_locations FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.customer_portal_memberships m WHERE m.user_id = auth.uid() AND m.status = 'active' AND m.company_id = customer_shipment_locations.company_id AND m.customer_id = customer_shipment_locations.customer_id)
);
CREATE POLICY "portal document link read" ON public.customer_document_links FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.customer_portal_memberships m WHERE m.user_id = auth.uid() AND m.status = 'active' AND m.company_id = customer_document_links.company_id AND m.customer_id = customer_document_links.customer_id)
);
CREATE POLICY "internal portal settings manage" ON public.customer_shipment_settings FOR ALL TO authenticated USING (public.has_any_role(company_id, ARRAY['admin','dispatcher','fleet_manager']::public.app_role[])) WITH CHECK (public.has_any_role(company_id, ARRAY['admin','dispatcher','fleet_manager']::public.app_role[]));
CREATE POLICY "internal portal document links manage" ON public.customer_document_links FOR ALL TO authenticated USING (public.has_any_role(company_id, ARRAY['admin','dispatcher','fleet_manager']::public.app_role[])) WITH CHECK (public.has_any_role(company_id, ARRAY['admin','dispatcher','fleet_manager']::public.app_role[]));

-- Jobs and proof are read only when the authenticated user has an active
-- membership for the same company/customer.  No broad customer query is allowed.
CREATE POLICY "portal jobs customer read" ON public.jobs FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.customer_portal_memberships m WHERE m.user_id = auth.uid() AND m.status = 'active' AND m.company_id = jobs.company_id AND m.customer_id = jobs.customer_id)
);
CREATE POLICY "portal job events customer read" ON public.job_events FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.jobs j JOIN public.customer_portal_memberships m ON m.company_id = j.company_id AND m.customer_id = j.customer_id WHERE j.id = job_events.job_id AND m.user_id = auth.uid() AND m.status = 'active')
);
CREATE POLICY "portal proof customer read" ON public.job_proofs FOR SELECT TO authenticated USING (
  customer_visible AND finalized_at IS NOT NULL AND EXISTS (SELECT 1 FROM public.jobs j JOIN public.customer_portal_memberships m ON m.company_id = j.company_id AND m.customer_id = j.customer_id WHERE j.id = job_proofs.job_id AND m.user_id = auth.uid() AND m.status = 'active')
);
CREATE POLICY "portal documents customer read" ON public.documents FOR SELECT TO authenticated USING (
  visibility = 'customer_visible' AND EXISTS (SELECT 1 FROM public.customer_document_links l JOIN public.customer_portal_memberships m ON m.company_id = l.company_id AND m.customer_id = l.customer_id WHERE l.document_id = documents.id AND m.user_id = auth.uid() AND m.status = 'active')
);

CREATE POLICY "internal portal membership manage" ON public.customer_portal_memberships FOR ALL TO authenticated USING (public.has_any_role(company_id, ARRAY['admin','dispatcher','fleet_manager']::public.app_role[])) WITH CHECK (public.has_any_role(company_id, ARRAY['admin','dispatcher','fleet_manager']::public.app_role[]));
CREATE POLICY "internal portal audit read" ON public.customer_portal_audit_logs FOR SELECT TO authenticated USING (public.has_any_role(company_id, ARRAY['admin','dispatcher','fleet_manager']::public.app_role[]));
CREATE POLICY "portal audit append" ON public.customer_portal_audit_logs FOR INSERT TO authenticated WITH CHECK (
  user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.customer_portal_memberships m WHERE m.user_id = auth.uid() AND m.status = 'active' AND m.company_id = customer_portal_audit_logs.company_id AND m.customer_id = customer_portal_audit_logs.customer_id)
);

ALTER TABLE public.customer_shipment_settings DROP CONSTRAINT IF EXISTS customer_shipment_settings_tracking_visibility_check;
ALTER TABLE public.customer_shipment_settings ADD CONSTRAINT customer_shipment_settings_tracking_visibility_check CHECK (tracking_visibility IN ('disabled','status','approximate','exact'));
CREATE UNIQUE INDEX IF NOT EXISTS customer_acknowledgements_once_per_user_idx ON public.customer_acknowledgements(company_id, customer_id, user_id, job_id, acknowledgement_type) WHERE job_id IS NOT NULL;

-- Token lookup, expiry and counting execute atomically.  The public function returns
-- only a narrow customer DTO; it never returns customer, driver, telemetry or storage data.
CREATE OR REPLACE FUNCTION public.open_shipment_share_link(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.shipment_share_links%ROWTYPE; j public.jobs%ROWTYPE;
BEGIN
  SELECT * INTO l FROM public.shipment_share_links WHERE token_hash = encode(digest(p_token, 'sha256'), 'hex') FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('state','invalid'); END IF;
  IF l.status = 'revoked' THEN RETURN jsonb_build_object('state','revoked'); END IF;
  IF l.expires_at IS NOT NULL AND l.expires_at <= now() THEN RETURN jsonb_build_object('state','expired'); END IF;
  IF l.max_views IS NOT NULL AND l.view_count >= l.max_views THEN RETURN jsonb_build_object('state','expired'); END IF;
  UPDATE public.shipment_share_links SET view_count = view_count + 1 WHERE id = l.id;
  INSERT INTO public.customer_portal_audit_logs(company_id, customer_id, entity_type, entity_id, event_type, detail) VALUES(l.company_id,l.customer_id,'share_link',l.id,'share_link_viewed',NULL);
  SELECT * INTO j FROM public.jobs WHERE id = l.job_id AND company_id = l.company_id AND customer_id = l.customer_id;
  RETURN jsonb_build_object('state','active','permissions',l.permissions,'shipment',jsonb_build_object('reference',j.reference,'status',j.status,'pickup',j.pickup_location,'destination',j.dropoff_location,'scheduled_at',j.scheduled_at,'completed_at',j.completed_at));
END $$;
GRANT EXECUTE ON FUNCTION public.open_shipment_share_link(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_shipment_share_link(p_job_id UUID, p_expires_at TIMESTAMPTZ, p_max_views INTEGER, p_permissions JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j public.jobs%ROWTYPE; token TEXT := encode(gen_random_bytes(32), 'hex'); link_id UUID;
BEGIN
  SELECT * INTO j FROM public.jobs WHERE id = p_job_id;
  IF NOT FOUND OR NOT public.has_any_role(j.company_id, ARRAY['admin','dispatcher','fleet_manager']::public.app_role[]) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF p_expires_at <= now() OR p_max_views < 1 OR NOT (p_permissions ? 'status') OR COALESCE((p_permissions->>'status')::boolean,false) = false THEN RAISE EXCEPTION 'invalid share-link configuration'; END IF;
  IF EXISTS (SELECT 1 FROM public.shipment_share_links l WHERE l.job_id=p_job_id AND l.status='active' AND (l.expires_at IS NULL OR l.expires_at>now()) AND (l.max_views IS NULL OR l.view_count<l.max_views) AND l.permissions=p_permissions) THEN RAISE EXCEPTION 'matching active share link already exists'; END IF;
  INSERT INTO public.shipment_share_links(company_id,customer_id,job_id,created_by,token_hash,expires_at,max_views,permissions) VALUES(j.company_id,j.customer_id,j.id,auth.uid(),encode(digest(token,'sha256'),'hex'),p_expires_at,p_max_views,p_permissions) RETURNING id INTO link_id;
  INSERT INTO public.customer_portal_audit_logs(company_id,customer_id,user_id,entity_type,entity_id,event_type,detail) VALUES(j.company_id,j.customer_id,auth.uid(),'share_link',link_id,'share_link_created',NULL);
  RETURN jsonb_build_object('id',link_id,'token',token,'expires_at',p_expires_at);
END $$;
CREATE OR REPLACE FUNCTION public.revoke_shipment_share_link(p_link_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.shipment_share_links%ROWTYPE;
BEGIN
  SELECT * INTO l FROM public.shipment_share_links WHERE id=p_link_id FOR UPDATE;
  IF NOT FOUND OR NOT public.has_any_role(l.company_id, ARRAY['admin','dispatcher','fleet_manager']::public.app_role[]) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF l.status='active' THEN UPDATE public.shipment_share_links SET status='revoked' WHERE id=l.id; INSERT INTO public.customer_portal_audit_logs(company_id,customer_id,user_id,entity_type,entity_id,event_type) VALUES(l.company_id,l.customer_id,auth.uid(),'share_link',l.id,'share_link_revoked'); END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.create_shipment_share_link(UUID,TIMESTAMPTZ,INTEGER,JSONB), public.revoke_shipment_share_link(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_customer_portal_invitation(p_customer_id UUID, p_email TEXT, p_role public.customer_portal_role DEFAULT 'viewer')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE token TEXT := encode(gen_random_bytes(32), 'hex'); c UUID;
BEGIN
  SELECT company_id INTO c FROM public.customers WHERE id = p_customer_id;
  IF c IS NULL OR NOT public.has_any_role(c, ARRAY['admin','dispatcher','fleet_manager']::public.app_role[]) THEN RAISE EXCEPTION 'not authorized'; END IF;
  INSERT INTO public.customer_portal_invitations(company_id,customer_id,invited_email,invited_by,role,token_hash,expires_at) VALUES(c,p_customer_id,lower(p_email),auth.uid(),p_role,encode(digest(token,'sha256'),'hex'),now()+interval '7 days');
  INSERT INTO public.customer_portal_audit_logs(company_id,customer_id,user_id,event_type,detail) VALUES(c,p_customer_id,auth.uid(),'invitation_created',lower(p_email));
  RETURN jsonb_build_object('token',token,'expires_at',now()+interval '7 days');
END $$;
GRANT EXECUTE ON FUNCTION public.create_customer_portal_invitation(UUID,TEXT,public.customer_portal_role) TO authenticated;

-- Audit rows are append-only for portal users.  Internal systems may append via
-- service_role; neither customers nor drivers can update or delete them.
