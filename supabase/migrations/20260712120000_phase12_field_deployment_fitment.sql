-- =========================================================================
-- ZappOS - Phase 12 Field Deployment, Installer Workflow, and Device Fitment.
-- Operational field layer only. No live hardware commands, firmware deployment,
-- AI, Gemini, production ZCT, cameras, drones, billing, or autonomous control.
-- =========================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('fitment-evidence', 'fitment-evidence', false)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  CREATE TYPE public.fitment_job_status AS ENUM (
    'planned','assigned','in_progress','blocked','awaiting_supervisor',
    'approved','rejected','completed','cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.fitment_step_status AS ENUM ('pending','passed','failed','not_applicable','blocked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.fitment_test_result AS ENUM ('passed','failed','warning','not_run');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.fitment_test_source AS ENUM ('manual_measurement','manual','simulated','future_device_reported','device_reported_future');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.field_inventory_state AS ENUM (
    'warehouse','reserved','issued_to_technician','in_fitment','active',
    'returned','faulty','quarantined','retired'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.firmware_rollout_plan_status AS ENUM (
    'draft','awaiting_approval','approved','scheduled','cancelled','completed_simulation'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.field_support_case_status AS ENUM (
    'open','investigating','awaiting_field_visit','awaiting_parts','resolved','closed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE public.document_owner_type ADD VALUE IF NOT EXISTS 'fitment_job';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS inventory_state public.field_inventory_state NOT NULL DEFAULT 'warehouse',
  ADD COLUMN IF NOT EXISTS issued_to_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reserved_for_fitment_job_id UUID;

ALTER TABLE public.device_sims
  ADD COLUMN IF NOT EXISTS inventory_state public.field_inventory_state NOT NULL DEFAULT 'warehouse',
  ADD COLUMN IF NOT EXISTS issued_to_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reserved_for_fitment_job_id UUID;

CREATE TABLE IF NOT EXISTS public.device_fitment_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  reference TEXT NOT NULL,
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE RESTRICT,
  sim_id UUID REFERENCES public.device_sims(id) ON DELETE SET NULL,
  technician_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  supervisor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status public.fitment_job_status NOT NULL DEFAULT 'planned',
  checklist_template_id UUID,
  checklist_template_version INTEGER NOT NULL DEFAULT 1,
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  installation_location TEXT,
  odometer_at_fitment NUMERIC CHECK (odometer_at_fitment IS NULL OR odometer_at_fitment >= 0),
  notes TEXT,
  blocked_reason TEXT,
  supervisor_review_notes TEXT,
  override_reason TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  UNIQUE(company_id, reference)
);

CREATE INDEX IF NOT EXISTS device_fitment_jobs_company_status_idx
  ON public.device_fitment_jobs(company_id, status, scheduled_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS device_fitment_jobs_technician_idx
  ON public.device_fitment_jobs(company_id, technician_user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS device_fitment_jobs_active_device_idx
  ON public.device_fitment_jobs(company_id, device_id)
  WHERE status IN ('planned','assigned','in_progress','blocked','awaiting_supervisor','approved');
CREATE UNIQUE INDEX IF NOT EXISTS device_fitment_jobs_active_sim_idx
  ON public.device_fitment_jobs(company_id, sim_id)
  WHERE sim_id IS NOT NULL AND status IN ('planned','assigned','in_progress','blocked','awaiting_supervisor','approved');

CREATE TABLE IF NOT EXISTS public.fitment_checklist_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','retired')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, name, version)
);

CREATE TABLE IF NOT EXISTS public.fitment_checklist_template_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES public.fitment_checklist_templates(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL CHECK (step_number BETWEEN 1 AND 50),
  title TEXT NOT NULL,
  instructions TEXT NOT NULL,
  mandatory BOOLEAN NOT NULL DEFAULT true,
  critical BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(template_id, step_number)
);

CREATE TABLE IF NOT EXISTS public.fitment_job_checklist_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  fitment_job_id UUID NOT NULL REFERENCES public.device_fitment_jobs(id) ON DELETE CASCADE,
  template_step_id UUID REFERENCES public.fitment_checklist_template_steps(id) ON DELETE SET NULL,
  checklist_version INTEGER NOT NULL,
  step_number INTEGER NOT NULL CHECK (step_number BETWEEN 1 AND 50),
  title TEXT NOT NULL,
  instructions TEXT NOT NULL,
  mandatory BOOLEAN NOT NULL DEFAULT true,
  critical BOOLEAN NOT NULL DEFAULT false,
  status public.fitment_step_status NOT NULL DEFAULT 'pending',
  technician_notes TEXT,
  evidence_references JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_references) = 'array'),
  completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  failure_reason TEXT,
  supervisor_comment TEXT,
  override_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(fitment_job_id, step_number)
);

CREATE TABLE IF NOT EXISTS public.fitment_test_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  fitment_job_id UUID NOT NULL REFERENCES public.device_fitment_jobs(id) ON DELETE CASCADE,
  test_category TEXT NOT NULL CHECK (test_category IN ('power','ignition','gnss','gsm','can_j1939','road_test','connectivity')),
  test_type TEXT NOT NULL,
  expected_range TEXT,
  measured_value NUMERIC,
  unit TEXT,
  result public.fitment_test_result NOT NULL DEFAULT 'not_run',
  source public.fitment_test_source NOT NULL DEFAULT 'manual_measurement',
  critical BOOLEAN NOT NULL DEFAULT false,
  override_reason TEXT,
  technician_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fitment_test_results_job_idx
  ON public.fitment_test_results(company_id, fitment_job_id, test_category, created_at DESC);

CREATE TABLE IF NOT EXISTS public.fitment_road_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  fitment_job_id UUID NOT NULL REFERENCES public.device_fitment_jobs(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  distance_meters NUMERIC CHECK (distance_meters IS NULL OR distance_meters >= 0),
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  accepted_telemetry_count INTEGER NOT NULL DEFAULT 0 CHECK (accepted_telemetry_count >= 0),
  gps_quality TEXT CHECK (gps_quality IS NULL OR gps_quality IN ('high','acceptable','poor','rejected','unknown')),
  network_drop_count INTEGER NOT NULL DEFAULT 0 CHECK (network_drop_count >= 0),
  reconnect_count INTEGER NOT NULL DEFAULT 0 CHECK (reconnect_count >= 0),
  sos_simulation_result TEXT CHECK (sos_simulation_result IS NULL OR sos_simulation_result IN ('not_run','simulated_passed','simulated_failed','not_authorized')),
  technician_conclusion TEXT,
  result public.fitment_test_result NOT NULL DEFAULT 'not_run',
  source TEXT NOT NULL CHECK (source IN ('simulated_validation','manual_field_test','future_device_reported_test')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (source <> 'simulated_validation' OR result <> 'passed')
);

CREATE TABLE IF NOT EXISTS public.fitment_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  fitment_job_id UUID NOT NULL REFERENCES public.device_fitment_jobs(id) ON DELETE CASCADE,
  evidence_type TEXT NOT NULL CHECK (
    evidence_type IN ('device_serial_photo','mounting_photo','wiring_fuse_photo','antenna_photo','vehicle_photo','voltage_meter_photo','road_test_evidence','technician_declaration','supervisor_comment')
  ),
  storage_bucket TEXT NOT NULL DEFAULT 'fitment-evidence',
  storage_path TEXT NOT NULL,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  UNIQUE(company_id, storage_path),
  CHECK (storage_path LIKE company_id::text || '/' || fitment_job_id::text || '/%')
);

CREATE TABLE IF NOT EXISTS public.field_inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('device','sim')),
  asset_id UUID NOT NULL,
  fitment_job_id UUID REFERENCES public.device_fitment_jobs(id) ON DELETE SET NULL,
  from_state public.field_inventory_state,
  to_state public.field_inventory_state NOT NULL,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role public.app_role,
  reason TEXT,
  source TEXT NOT NULL DEFAULT 'manual_inventory_operation' CHECK (source IN ('manual_inventory_operation','fitment_completion','simulated_reconciliation')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.firmware_rollout_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  firmware_version_id UUID NOT NULL REFERENCES public.device_firmware_versions(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  status public.firmware_rollout_plan_status NOT NULL DEFAULT 'draft',
  rollout_stage TEXT NOT NULL DEFAULT 'planned_rollout' CHECK (rollout_stage IN ('planned_rollout','simulated_compatibility','manual_review')),
  target_count INTEGER NOT NULL DEFAULT 0 CHECK (target_count >= 0),
  planned_start TIMESTAMPTZ,
  rollback_version_id UUID REFERENCES public.device_firmware_versions(id) ON DELETE SET NULL,
  approval_required BOOLEAN NOT NULL DEFAULT true,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT jsonb_build_object('truth_label','No firmware command sent') CHECK (jsonb_typeof(metadata) = 'object'),
  UNIQUE(company_id, name)
);

CREATE TABLE IF NOT EXISTS public.firmware_rollout_plan_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  rollout_plan_id UUID NOT NULL REFERENCES public.firmware_rollout_plans(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE RESTRICT,
  compatibility_status TEXT NOT NULL DEFAULT 'pending' CHECK (compatibility_status IN ('pending','compatible','incompatible','simulated_compatible')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(rollout_plan_id, device_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS firmware_rollout_plan_devices_active_device_idx
  ON public.firmware_rollout_plan_devices(company_id, device_id)
  WHERE compatibility_status IN ('pending','compatible','simulated_compatible');

CREATE TABLE IF NOT EXISTS public.field_support_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  device_id UUID REFERENCES public.devices(id) ON DELETE SET NULL,
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
  fitment_job_id UUID REFERENCES public.device_fitment_jobs(id) ON DELETE SET NULL,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  status public.field_support_case_status NOT NULL DEFAULT 'open',
  reported_issue TEXT NOT NULL,
  diagnostic_summary TEXT,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolution TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.field_audit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role public.app_role,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  old_state JSONB,
  new_state JSONB,
  reason TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','system','simulated','planned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS field_audit_ledger_company_time_idx
  ON public.field_audit_ledger(company_id, created_at DESC);

ALTER TABLE public.device_fitment_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fitment_checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fitment_checklist_template_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fitment_job_checklist_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fitment_test_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fitment_road_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fitment_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firmware_rollout_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firmware_rollout_plan_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_support_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_audit_ledger ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.device_fitment_jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.fitment_checklist_templates TO authenticated;
GRANT SELECT, INSERT ON public.fitment_checklist_template_steps TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.fitment_job_checklist_steps TO authenticated;
GRANT SELECT, INSERT ON public.fitment_test_results TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.fitment_road_tests TO authenticated;
GRANT SELECT, INSERT ON public.fitment_evidence TO authenticated;
GRANT SELECT, INSERT ON public.field_inventory_movements TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.firmware_rollout_plans TO authenticated;
GRANT SELECT, INSERT ON public.firmware_rollout_plan_devices TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.field_support_cases TO authenticated;
GRANT SELECT ON public.field_audit_ledger TO authenticated;

CREATE OR REPLACE FUNCTION public.log_field_audit(
  _company_id UUID,
  _action TEXT,
  _entity_type TEXT,
  _entity_id UUID,
  _old_state JSONB DEFAULT NULL,
  _new_state JSONB DEFAULT NULL,
  _reason TEXT DEFAULT NULL,
  _source TEXT DEFAULT 'manual'
)
RETURNS public.field_audit_ledger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _row public.field_audit_ledger%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_company_member(_company_id) THEN
    RAISE EXCEPTION 'Not authorized to write field audit history';
  END IF;
  INSERT INTO public.field_audit_ledger(company_id, actor_user_id, actor_role, action, entity_type, entity_id, old_state, new_state, reason, source)
  VALUES (_company_id, auth.uid(), public.current_company_role(_company_id), _action, _entity_type, _entity_id, _old_state, _new_state, _reason, _source)
  RETURNING * INTO _row;
  RETURN _row;
END;
$$;

REVOKE ALL ON FUNCTION public.log_field_audit(uuid, text, text, uuid, jsonb, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_field_audit(uuid, text, text, uuid, jsonb, jsonb, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.log_field_audit(uuid, text, text, uuid, jsonb, jsonb, text, text) FROM authenticated;

CREATE OR REPLACE FUNCTION public.validate_fitment_job_entities()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _device public.devices%ROWTYPE;
  _template public.fitment_checklist_templates%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.vehicles WHERE id = NEW.vehicle_id AND company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'Vehicle does not belong to company';
  END IF;
  SELECT * INTO _device FROM public.devices WHERE id = NEW.device_id AND company_id = NEW.company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Device does not belong to company'; END IF;
  IF _device.device_type = 'SIMULATOR' OR _device.simulated THEN
    RAISE EXCEPTION 'Fitment jobs require a physical device record';
  END IF;
  IF _device.status IN ('retired','blocked') THEN
    RAISE EXCEPTION 'Device is not eligible for fitment';
  END IF;
  IF NEW.sim_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.device_sims WHERE id = NEW.sim_id AND company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'SIM does not belong to company';
  END IF;
  IF NEW.created_by IS NULL THEN NEW.created_by := auth.uid(); END IF;
  IF NEW.checklist_template_id IS NULL THEN
    SELECT * INTO _template
    FROM public.fitment_checklist_templates
    WHERE (company_id = NEW.company_id OR company_id IS NULL) AND status = 'active'
    ORDER BY company_id NULLS LAST, version DESC
    LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'No active fitment checklist template'; END IF;
    NEW.checklist_template_id := _template.id;
    NEW.checklist_template_version := _template.version;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS device_fitment_jobs_validate_entities ON public.device_fitment_jobs;
CREATE TRIGGER device_fitment_jobs_validate_entities
  BEFORE INSERT OR UPDATE OF vehicle_id, device_id, sim_id, checklist_template_id ON public.device_fitment_jobs
  FOR EACH ROW EXECUTE FUNCTION public.validate_fitment_job_entities();

CREATE OR REPLACE FUNCTION public.prevent_direct_fitment_status_update()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND COALESCE(current_setting('app.phase12_transition', true), '') <> 'true' THEN
    RAISE EXCEPTION 'Use transition_device_fitment_job for fitment status changes';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS device_fitment_jobs_status_guard ON public.device_fitment_jobs;
CREATE TRIGGER device_fitment_jobs_status_guard
  BEFORE UPDATE OF status ON public.device_fitment_jobs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_direct_fitment_status_update();

CREATE OR REPLACE FUNCTION public.instantiate_fitment_checklist()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.fitment_job_checklist_steps(
    company_id, fitment_job_id, template_step_id, checklist_version, step_number,
    title, instructions, mandatory, critical
  )
  SELECT NEW.company_id, NEW.id, s.id, NEW.checklist_template_version, s.step_number,
         s.title, s.instructions, s.mandatory, s.critical
  FROM public.fitment_checklist_template_steps s
  WHERE s.template_id = NEW.checklist_template_id
  ORDER BY s.step_number;

  PERFORM public.log_field_audit(
    NEW.company_id, 'fitment_job_created', 'device_fitment_job', NEW.id,
    NULL, to_jsonb(NEW), 'Checklist instantiated', 'system'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS device_fitment_jobs_instantiate_checklist ON public.device_fitment_jobs;
CREATE TRIGGER device_fitment_jobs_instantiate_checklist
  AFTER INSERT ON public.device_fitment_jobs
  FOR EACH ROW EXECUTE FUNCTION public.instantiate_fitment_checklist();

CREATE OR REPLACE FUNCTION public.validate_fitment_step_update()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _job public.device_fitment_jobs%ROWTYPE;
BEGIN
  SELECT * INTO _job FROM public.device_fitment_jobs WHERE id = NEW.fitment_job_id AND company_id = NEW.company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fitment job not found'; END IF;
  IF auth.uid() IS NULL OR NOT (
    public.has_any_role(NEW.company_id, ARRAY['admin','fleet_manager']::public.app_role[])
    OR _job.technician_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized to update checklist step';
  END IF;
  IF _job.status IN ('awaiting_supervisor','approved','completed','cancelled') THEN
    RAISE EXCEPTION 'Checklist cannot be silently changed after submission or terminal status';
  END IF;
  IF NEW.mandatory AND NEW.status = 'not_applicable' AND NULLIF(NEW.override_reason, '') IS NULL THEN
    RAISE EXCEPTION 'Mandatory step requires authorized not-applicable reason';
  END IF;
  IF NEW.status IN ('passed','failed','not_applicable','blocked') THEN
    NEW.completed_at := COALESCE(NEW.completed_at, now());
    NEW.completed_by := COALESCE(NEW.completed_by, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fitment_job_checklist_steps_validate ON public.fitment_job_checklist_steps;
CREATE TRIGGER fitment_job_checklist_steps_validate
  BEFORE UPDATE ON public.fitment_job_checklist_steps
  FOR EACH ROW EXECUTE FUNCTION public.validate_fitment_step_update();

CREATE OR REPLACE FUNCTION public.validate_fitment_test_result()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _job public.device_fitment_jobs%ROWTYPE;
BEGIN
  SELECT * INTO _job FROM public.device_fitment_jobs WHERE id = NEW.fitment_job_id AND company_id = NEW.company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fitment job not found'; END IF;
  IF auth.uid() IS NULL OR NOT (
    public.has_any_role(NEW.company_id, ARRAY['admin','fleet_manager']::public.app_role[])
    OR _job.technician_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized to record fitment test';
  END IF;
  IF NEW.source IN ('simulated','future_device_reported','device_reported_future') AND NEW.result = 'passed' THEN
    NEW.metadata := NEW.metadata || jsonb_build_object('truth_label', 'SIMULATED or future-reported validation is not physical field verification');
  END IF;
  NEW.technician_user_id := COALESCE(NEW.technician_user_id, auth.uid());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fitment_test_results_validate ON public.fitment_test_results;
CREATE TRIGGER fitment_test_results_validate
  BEFORE INSERT ON public.fitment_test_results
  FOR EACH ROW EXECUTE FUNCTION public.validate_fitment_test_result();

CREATE OR REPLACE FUNCTION public.complete_device_fitment_job(_company_id UUID, _fitment_job_id UUID)
RETURNS public.device_fitment_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'complete_device_fitment_job is not initialized';
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_device_fitment_job(
  _company_id UUID,
  _fitment_job_id UUID,
  _next_status public.fitment_job_status,
  _reason TEXT DEFAULT NULL,
  _override_reason TEXT DEFAULT NULL
)
RETURNS public.device_fitment_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _job public.device_fitment_jobs%ROWTYPE;
  _role public.app_role;
  _allowed BOOLEAN := false;
  _has_failed_mandatory BOOLEAN;
  _has_unresolved_critical BOOLEAN;
  _updated public.device_fitment_jobs%ROWTYPE;
BEGIN
  _role := public.current_company_role(_company_id);
  SELECT * INTO _job FROM public.device_fitment_jobs WHERE id = _fitment_job_id AND company_id = _company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fitment job not found'; END IF;
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  _allowed := (
    (_job.status = 'planned' AND _next_status = 'assigned')
    OR (_job.status = 'assigned' AND _next_status = 'in_progress')
    OR (_job.status = 'in_progress' AND _next_status IN ('blocked','awaiting_supervisor'))
    OR (_job.status = 'blocked' AND _next_status = 'in_progress')
    OR (_job.status = 'awaiting_supervisor' AND _next_status IN ('approved','rejected'))
    OR (_job.status = 'rejected' AND _next_status = 'in_progress')
    OR (_job.status = 'approved' AND _next_status = 'completed')
    OR (_job.status IN ('planned','assigned','in_progress') AND _next_status = 'cancelled')
  );
  IF NOT _allowed THEN RAISE EXCEPTION 'Invalid fitment transition'; END IF;

  IF _next_status IN ('assigned','cancelled') AND _role NOT IN ('admin','fleet_manager') THEN
    RAISE EXCEPTION 'Not authorized for management transition';
  END IF;
  IF _next_status IN ('in_progress','blocked','awaiting_supervisor') AND NOT (
    _role IN ('admin','fleet_manager') OR _job.technician_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized for technician transition';
  END IF;
  IF _next_status IN ('approved','rejected') THEN
    IF _role NOT IN ('admin','fleet_manager') THEN RAISE EXCEPTION 'Not authorized for supervisor review'; END IF;
    IF _job.technician_user_id = auth.uid() THEN RAISE EXCEPTION 'Technician cannot approve own fitment'; END IF;
    IF _next_status = 'rejected' AND NULLIF(_reason, '') IS NULL THEN RAISE EXCEPTION 'Rejection reason is required'; END IF;
  END IF;
  IF _next_status = 'blocked' AND NULLIF(_reason, '') IS NULL THEN RAISE EXCEPTION 'Blocked reason is required'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.fitment_job_checklist_steps
    WHERE fitment_job_id = _job.id
      AND mandatory
      AND status IN ('pending','failed','blocked')
  ) INTO _has_failed_mandatory;

  SELECT EXISTS (
    SELECT 1 FROM public.fitment_test_results
    WHERE fitment_job_id = _job.id
      AND critical
      AND result = 'failed'
      AND NULLIF(override_reason, '') IS NULL
  ) INTO _has_unresolved_critical;

  IF _next_status = 'awaiting_supervisor' AND _has_failed_mandatory THEN
    RAISE EXCEPTION 'Cannot submit with mandatory checklist gaps or failures';
  END IF;
  IF _next_status = 'approved' AND (_has_failed_mandatory OR _has_unresolved_critical) THEN
    IF NULLIF(_override_reason, '') IS NULL THEN
      RAISE EXCEPTION 'Approval requires resolved mandatory checklist and critical tests or documented override';
    END IF;
  END IF;

  PERFORM set_config('app.phase12_transition', 'true', true);
  UPDATE public.device_fitment_jobs
  SET status = _next_status,
      started_at = CASE WHEN _next_status = 'in_progress' THEN COALESCE(started_at, now()) ELSE started_at END,
      submitted_at = CASE WHEN _next_status = 'awaiting_supervisor' THEN now() ELSE submitted_at END,
      approved_at = CASE WHEN _next_status = 'approved' THEN now() ELSE approved_at END,
      rejected_at = CASE WHEN _next_status = 'rejected' THEN now() ELSE rejected_at END,
      completed_at = CASE WHEN _next_status = 'completed' THEN now() ELSE completed_at END,
      cancelled_at = CASE WHEN _next_status = 'cancelled' THEN now() ELSE cancelled_at END,
      blocked_reason = CASE WHEN _next_status = 'blocked' THEN _reason ELSE blocked_reason END,
      supervisor_review_notes = CASE WHEN _next_status IN ('approved','rejected') THEN _reason ELSE supervisor_review_notes END,
      override_reason = COALESCE(NULLIF(_override_reason, ''), override_reason),
      updated_at = now()
  WHERE id = _job.id
  RETURNING * INTO _updated;

  IF _next_status = 'completed' THEN
    PERFORM public.complete_device_fitment_job(_company_id, _fitment_job_id);
    SELECT * INTO _updated FROM public.device_fitment_jobs WHERE id = _fitment_job_id;
  END IF;

  PERFORM public.log_field_audit(
    _company_id, 'fitment_status_changed', 'device_fitment_job', _fitment_job_id,
    jsonb_build_object('status', _job.status),
    jsonb_build_object('status', _updated.status),
    _reason, 'manual'
  );

  RETURN _updated;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_device_fitment_job(_company_id UUID, _fitment_job_id UUID)
RETURNS public.device_vehicle_assignments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _job public.device_fitment_jobs%ROWTYPE;
  _assignment public.device_vehicle_assignments%ROWTYPE;
BEGIN
  SELECT * INTO _job FROM public.device_fitment_jobs WHERE id = _fitment_job_id AND company_id = _company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fitment job not found'; END IF;
  IF _job.status <> 'completed' THEN RAISE EXCEPTION 'Fitment must be completed through approved transition'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.fitment_road_tests
    WHERE fitment_job_id = _job.id AND result = 'passed' AND source = 'simulated_validation'
  ) THEN
    RAISE EXCEPTION 'Simulated road test cannot complete physical fitment';
  END IF;

  UPDATE public.device_vehicle_assignments
  SET status = 'inactive', unassigned_at = now(), unassigned_by = auth.uid(), reason = 'Closed by Phase 12 physical fitment completion'
  WHERE company_id = _company_id
    AND status = 'active'
    AND (device_id = _job.device_id OR (vehicle_id = _job.vehicle_id AND assignment_type = 'primary'));

  INSERT INTO public.device_vehicle_assignments(
    company_id, device_id, vehicle_id, assignment_type, status, assigned_at, assigned_by, reason, simulated
  )
  VALUES (_company_id, _job.device_id, _job.vehicle_id, 'primary', 'active', now(), auth.uid(), 'Phase 12 approved physical fitment', false)
  RETURNING * INTO _assignment;

  UPDATE public.devices SET status = 'active', inventory_state = 'active', updated_at = now() WHERE id = _job.device_id;
  IF _job.sim_id IS NOT NULL THEN
    UPDATE public.device_sims SET status = 'active', inventory_state = 'active', assigned_device_id = _job.device_id, updated_at = now() WHERE id = _job.sim_id;
  END IF;

  INSERT INTO public.field_inventory_movements(company_id, asset_type, asset_id, fitment_job_id, to_state, actor_user_id, actor_role, reason, source)
  VALUES (_company_id, 'device', _job.device_id, _job.id, 'active', auth.uid(), public.current_company_role(_company_id), 'Physical fitment completed', 'fitment_completion');

  PERFORM public.log_field_audit(_company_id, 'device_assignment_activated', 'device_vehicle_assignment', _assignment.id, NULL, to_jsonb(_assignment), 'Physical fitment completed', 'system');
  RETURN _assignment;
END;
$$;

REVOKE ALL ON FUNCTION public.transition_device_fitment_job(uuid, uuid, public.fitment_job_status, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_device_fitment_job(uuid, uuid, public.fitment_job_status, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.transition_device_fitment_job(uuid, uuid, public.fitment_job_status, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.complete_device_fitment_job(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_device_fitment_job(uuid, uuid) FROM anon;

DROP TRIGGER IF EXISTS field_audit_ledger_immutable ON public.field_audit_ledger;
CREATE TRIGGER field_audit_ledger_immutable
  BEFORE UPDATE OR DELETE ON public.field_audit_ledger
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_operations_history_change();
DROP TRIGGER IF EXISTS field_inventory_movements_immutable ON public.field_inventory_movements;
CREATE TRIGGER field_inventory_movements_immutable
  BEFORE UPDATE OR DELETE ON public.field_inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_operations_history_change();
DROP TRIGGER IF EXISTS fitment_test_results_immutable ON public.fitment_test_results;
CREATE TRIGGER fitment_test_results_immutable
  BEFORE UPDATE OR DELETE ON public.fitment_test_results
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_operations_history_change();

DROP TRIGGER IF EXISTS device_fitment_jobs_updated ON public.device_fitment_jobs;
CREATE TRIGGER device_fitment_jobs_updated BEFORE UPDATE ON public.device_fitment_jobs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS fitment_checklist_templates_updated ON public.fitment_checklist_templates;
CREATE TRIGGER fitment_checklist_templates_updated BEFORE UPDATE ON public.fitment_checklist_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS fitment_job_checklist_steps_updated ON public.fitment_job_checklist_steps;
CREATE TRIGGER fitment_job_checklist_steps_updated BEFORE UPDATE ON public.fitment_job_checklist_steps FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS fitment_road_tests_updated ON public.fitment_road_tests;
CREATE TRIGGER fitment_road_tests_updated BEFORE UPDATE ON public.fitment_road_tests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS firmware_rollout_plans_updated ON public.firmware_rollout_plans;
CREATE TRIGGER firmware_rollout_plans_updated BEFORE UPDATE ON public.firmware_rollout_plans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS field_support_cases_updated ON public.field_support_cases;
CREATE TRIGGER field_support_cases_updated BEFORE UPDATE ON public.field_support_cases FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "fitment jobs field read" ON public.device_fitment_jobs FOR SELECT TO authenticated
  USING (
    public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[])
    OR technician_user_id = auth.uid()
    OR supervisor_user_id = auth.uid()
  );
CREATE POLICY "fitment jobs manager insert" ON public.device_fitment_jobs FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(company_id, ARRAY['admin','fleet_manager']::public.app_role[]));
CREATE POLICY "fitment jobs manager update" ON public.device_fitment_jobs FOR UPDATE TO authenticated
  USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager']::public.app_role[]))
  WITH CHECK (public.has_any_role(company_id, ARRAY['admin','fleet_manager']::public.app_role[]));

CREATE POLICY "field templates read" ON public.fitment_checklist_templates FOR SELECT TO authenticated
  USING (company_id IS NULL OR public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[]));
CREATE POLICY "field template steps read" ON public.fitment_checklist_template_steps FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.fitment_checklist_templates t WHERE t.id = template_id AND (t.company_id IS NULL OR public.has_any_role(t.company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[]))));
CREATE POLICY "field templates write" ON public.fitment_checklist_templates FOR INSERT TO authenticated
  WITH CHECK (company_id IS NOT NULL AND public.has_any_role(company_id, ARRAY['admin','fleet_manager']::public.app_role[]));
CREATE POLICY "field templates update" ON public.fitment_checklist_templates FOR UPDATE TO authenticated
  USING (company_id IS NOT NULL AND public.has_any_role(company_id, ARRAY['admin','fleet_manager']::public.app_role[]))
  WITH CHECK (company_id IS NOT NULL AND public.has_any_role(company_id, ARRAY['admin','fleet_manager']::public.app_role[]));

CREATE POLICY "job checklist read" ON public.fitment_job_checklist_steps FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.device_fitment_jobs j WHERE j.id = fitment_job_id AND (public.has_any_role(j.company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[]) OR j.technician_user_id = auth.uid() OR j.supervisor_user_id = auth.uid())));
CREATE POLICY "job checklist technician update" ON public.fitment_job_checklist_steps FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.device_fitment_jobs j WHERE j.id = fitment_job_id AND (public.has_any_role(j.company_id, ARRAY['admin','fleet_manager']::public.app_role[]) OR j.technician_user_id = auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.device_fitment_jobs j WHERE j.id = fitment_job_id AND (public.has_any_role(j.company_id, ARRAY['admin','fleet_manager']::public.app_role[]) OR j.technician_user_id = auth.uid())));

CREATE POLICY "fitment child read" ON public.fitment_test_results FOR SELECT TO authenticated USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[]) OR EXISTS (SELECT 1 FROM public.device_fitment_jobs j WHERE j.id = fitment_job_id AND (j.technician_user_id = auth.uid() OR j.supervisor_user_id = auth.uid())));
CREATE POLICY "fitment tests insert" ON public.fitment_test_results FOR INSERT TO authenticated WITH CHECK (public.has_any_role(company_id, ARRAY['admin','fleet_manager']::public.app_role[]) OR EXISTS (SELECT 1 FROM public.device_fitment_jobs j WHERE j.id = fitment_job_id AND j.technician_user_id = auth.uid()));
CREATE POLICY "road tests read" ON public.fitment_road_tests FOR SELECT TO authenticated USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[]) OR EXISTS (SELECT 1 FROM public.device_fitment_jobs j WHERE j.id = fitment_job_id AND (j.technician_user_id = auth.uid() OR j.supervisor_user_id = auth.uid())));
CREATE POLICY "road tests write" ON public.fitment_road_tests FOR INSERT TO authenticated WITH CHECK (public.has_any_role(company_id, ARRAY['admin','fleet_manager']::public.app_role[]) OR EXISTS (SELECT 1 FROM public.device_fitment_jobs j WHERE j.id = fitment_job_id AND j.technician_user_id = auth.uid()));
CREATE POLICY "road tests update" ON public.fitment_road_tests FOR UPDATE TO authenticated USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager']::public.app_role[])) WITH CHECK (public.has_any_role(company_id, ARRAY['admin','fleet_manager']::public.app_role[]));

CREATE POLICY "fitment evidence read" ON public.fitment_evidence FOR SELECT TO authenticated USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[]) OR EXISTS (SELECT 1 FROM public.device_fitment_jobs j WHERE j.id = fitment_job_id AND (j.technician_user_id = auth.uid() OR j.supervisor_user_id = auth.uid())));
CREATE POLICY "fitment evidence insert" ON public.fitment_evidence FOR INSERT TO authenticated WITH CHECK (public.has_any_role(company_id, ARRAY['admin','fleet_manager']::public.app_role[]) OR EXISTS (SELECT 1 FROM public.device_fitment_jobs j WHERE j.id = fitment_job_id AND j.technician_user_id = auth.uid()));
CREATE POLICY "inventory movements read" ON public.field_inventory_movements FOR SELECT TO authenticated USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[]));
CREATE POLICY "inventory movements insert" ON public.field_inventory_movements FOR INSERT TO authenticated WITH CHECK (public.has_any_role(company_id, ARRAY['admin','fleet_manager']::public.app_role[]));
CREATE POLICY "rollout plans read" ON public.firmware_rollout_plans FOR SELECT TO authenticated USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[]));
CREATE POLICY "rollout plans write" ON public.firmware_rollout_plans FOR INSERT TO authenticated WITH CHECK (public.has_any_role(company_id, ARRAY['admin','fleet_manager']::public.app_role[]));
CREATE POLICY "rollout plans update" ON public.firmware_rollout_plans FOR UPDATE TO authenticated USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager']::public.app_role[])) WITH CHECK (public.has_any_role(company_id, ARRAY['admin','fleet_manager']::public.app_role[]));
CREATE POLICY "rollout devices read" ON public.firmware_rollout_plan_devices FOR SELECT TO authenticated USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[]));
CREATE POLICY "rollout devices write" ON public.firmware_rollout_plan_devices FOR INSERT TO authenticated WITH CHECK (public.has_any_role(company_id, ARRAY['admin','fleet_manager']::public.app_role[]));
CREATE POLICY "support cases read" ON public.field_support_cases FOR SELECT TO authenticated USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[]) OR assigned_to = auth.uid());
CREATE POLICY "support cases write" ON public.field_support_cases FOR INSERT TO authenticated WITH CHECK (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[]));
CREATE POLICY "support cases update" ON public.field_support_cases FOR UPDATE TO authenticated USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager']::public.app_role[]) OR assigned_to = auth.uid()) WITH CHECK (public.has_any_role(company_id, ARRAY['admin','fleet_manager']::public.app_role[]) OR assigned_to = auth.uid());
CREATE POLICY "field audit read" ON public.field_audit_ledger FOR SELECT TO authenticated USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[]));

DROP POLICY IF EXISTS "fitment-evidence_select" ON storage.objects;
DROP POLICY IF EXISTS "fitment-evidence_insert" ON storage.objects;
CREATE POLICY "fitment-evidence_select" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'fitment-evidence'
    AND (
      public.has_any_role(((storage.foldername(name))[1])::uuid, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[])
      OR EXISTS (
        SELECT 1 FROM public.device_fitment_jobs j
        WHERE j.company_id = ((storage.foldername(name))[1])::uuid
          AND j.id = ((storage.foldername(name))[2])::uuid
          AND (j.technician_user_id = auth.uid() OR j.supervisor_user_id = auth.uid())
      )
    )
  );
CREATE POLICY "fitment-evidence_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'fitment-evidence'
    AND (
      public.has_any_role(((storage.foldername(name))[1])::uuid, ARRAY['admin','fleet_manager']::public.app_role[])
      OR EXISTS (
        SELECT 1 FROM public.device_fitment_jobs j
        WHERE j.company_id = ((storage.foldername(name))[1])::uuid
          AND j.id = ((storage.foldername(name))[2])::uuid
          AND j.technician_user_id = auth.uid()
      )
    )
  );

WITH template AS (
  INSERT INTO public.fitment_checklist_templates(company_id, name, version, status)
  VALUES (NULL, 'Zapp Box / P1 standard fitment checklist', 1, 'active')
  ON CONFLICT (company_id, name, version) DO UPDATE SET status = EXCLUDED.status
  RETURNING id
)
INSERT INTO public.fitment_checklist_template_steps(template_id, step_number, title, instructions, mandatory, critical)
SELECT template.id, step_number, title, instructions, true, critical
FROM template
CROSS JOIN (VALUES
  (1, 'Confirm assigned vehicle and fitment reference', 'Verify vehicle registration/VIN and fitment job reference before work starts.', false),
  (2, 'Confirm device serial/IMEI and company ownership', 'Match device serial and IMEI against the company device registry.', true),
  (3, 'Confirm SIM/ICCID assignment', 'Confirm SIM ICCID and APN metadata match the fitment job.', true),
  (4, 'Inspect device and wiring harness condition', 'Inspect enclosure, loom, connector pins, fuse holder, and tamper materials.', false),
  (5, 'Isolate vehicle power safely', 'Follow workshop safety procedure before permanent power wiring.', true),
  (6, 'Confirm mounting position', 'Confirm stable mounting position that does not obstruct controls or airbags.', false),
  (7, 'Connect permanent power', 'Connect protected permanent power and record manual voltage evidence.', true),
  (8, 'Connect ignition sense', 'Connect ignition sense and record off/on transition result.', true),
  (9, 'Connect ground', 'Confirm ground continuity and secure termination.', true),
  (10, 'Install GNSS/GSM antennas', 'Confirm placement, cable path, and strain relief.', true),
  (11, 'Connect CAN/J1939 interface where applicable', 'Validate harness and mark not applicable only with reason.', false),
  (12, 'Secure wiring and tamper protection', 'Secure loom, cable ties, tamper labels, and fuse accessibility.', false),
  (13, 'Perform static electrical/connectivity tests', 'Record power, ignition, GNSS/GSM and connectivity test results.', true),
  (14, 'Perform road test and submit evidence', 'Complete manual field road test or record why it is blocked.', true)
) AS steps(step_number, title, instructions, critical)
ON CONFLICT (template_id, step_number) DO UPDATE SET
  title = EXCLUDED.title,
  instructions = EXCLUDED.instructions,
  critical = EXCLUDED.critical;
