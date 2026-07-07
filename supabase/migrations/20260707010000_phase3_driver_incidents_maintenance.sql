-- =========================================================================
-- ZappOS - Phase 3 driver workflow, proof, incidents, and maintenance.
-- =========================================================================

-- ---------- Proof records ----------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  driver_id UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
  recipient_name TEXT NOT NULL,
  notes TEXT,
  photo_url TEXT,
  signature_url TEXT,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.job_proofs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS job_proofs_company_id_idx ON public.job_proofs(company_id);
CREATE INDEX IF NOT EXISTS job_proofs_job_id_idx ON public.job_proofs(job_id);

-- ---------- Driver helpers ---------------------------------------------
CREATE OR REPLACE FUNCTION public.current_driver_id(_company_id UUID)
RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT id
  FROM public.drivers
  WHERE company_id = _company_id AND user_id = auth.uid()
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.current_driver_id(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_driver_relevant_job(_job_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.jobs j
    JOIN public.drivers d ON d.id = j.driver_id AND d.company_id = j.company_id
    WHERE j.id = _job_id
      AND d.user_id = auth.uid()
      AND j.status IN ('assigned','accepted','in_progress','arrived','failed','completed')
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_driver_relevant_job(uuid) TO authenticated;

-- Keep the existing Phase 2 audit trigger, but allow workflow RPCs to suppress
-- generic status_changed rows when they write a more specific activity event.
CREATE OR REPLACE FUNCTION public.log_job_changes()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _skip_generic_status BOOLEAN := current_setting('app.skip_generic_status_log', true) = 'on';
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_job_event(
      NEW.company_id,
      NEW.id,
      'job_created',
      'Job created',
      jsonb_build_object('reference', NEW.reference, 'status', NEW.status, 'priority', NEW.priority)
    );
    RETURN NEW;
  END IF;

  IF NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
    PERFORM public.log_job_event(
      NEW.company_id,
      NEW.id,
      'driver_assigned',
      'Driver assignment changed',
      jsonb_build_object('old_driver_id', OLD.driver_id, 'new_driver_id', NEW.driver_id)
    );
  END IF;

  IF NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id THEN
    PERFORM public.log_job_event(
      NEW.company_id,
      NEW.id,
      'vehicle_assigned',
      'Vehicle assignment changed',
      jsonb_build_object('old_vehicle_id', OLD.vehicle_id, 'new_vehicle_id', NEW.vehicle_id)
    );
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT _skip_generic_status THEN
    PERFORM public.log_job_event(
      NEW.company_id,
      NEW.id,
      CASE WHEN NEW.status = 'cancelled' THEN 'cancelled' ELSE 'status_changed' END,
      'Status changed',
      jsonb_build_object('old_status', OLD.status, 'new_status', NEW.status)
    );
  END IF;

  IF NEW.priority IS DISTINCT FROM OLD.priority THEN
    PERFORM public.log_job_event(
      NEW.company_id,
      NEW.id,
      'priority_changed',
      'Priority changed',
      jsonb_build_object('old_priority', OLD.priority, 'new_priority', NEW.priority)
    );
  END IF;

  IF (to_jsonb(NEW) - ARRAY['updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['updated_at'])
     AND NEW.driver_id IS NOT DISTINCT FROM OLD.driver_id
     AND NEW.vehicle_id IS NOT DISTINCT FROM OLD.vehicle_id
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.priority IS NOT DISTINCT FROM OLD.priority THEN
    PERFORM public.log_job_event(NEW.company_id, NEW.id, 'edited', 'Job edited', NULL);
  END IF;

  RETURN NEW;
END;
$$;

-- ---------- Driver workflow RPCs ---------------------------------------
CREATE OR REPLACE FUNCTION public.driver_transition_job(_job_id UUID, _action TEXT)
RETURNS public.jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _job public.jobs%ROWTYPE;
  _driver_id UUID;
  _new_status public.job_status;
  _event_type TEXT;
  _message TEXT;
BEGIN
  SELECT * INTO _job FROM public.jobs WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found';
  END IF;

  _driver_id := public.current_driver_id(_job.company_id);
  IF _driver_id IS NULL OR _job.driver_id IS DISTINCT FROM _driver_id THEN
    RAISE EXCEPTION 'This job is not assigned to the current driver';
  END IF;

  IF _action = 'accept' AND _job.status = 'assigned' THEN
    _new_status := 'accepted';
    _event_type := 'driver_accepted';
    _message := 'Driver accepted job';
    PERFORM set_config('app.skip_generic_status_log', 'on', true);
    UPDATE public.jobs
    SET status = _new_status, accepted_at = now(), updated_at = now()
    WHERE id = _job_id
    RETURNING * INTO _job;
  ELSIF _action = 'start' AND _job.status = 'accepted' THEN
    _new_status := 'in_progress';
    _event_type := 'trip_started';
    _message := 'Trip started';
    PERFORM set_config('app.skip_generic_status_log', 'on', true);
    UPDATE public.jobs
    SET status = _new_status, started_at = now(), updated_at = now()
    WHERE id = _job_id
    RETURNING * INTO _job;

    UPDATE public.drivers SET status = 'on_trip', updated_at = now() WHERE id = _driver_id;
    IF _job.vehicle_id IS NOT NULL THEN
      UPDATE public.vehicles SET status = 'in_use', updated_at = now()
      WHERE id = _job.vehicle_id AND status = 'available';
    END IF;
  ELSIF _action = 'arrive' AND _job.status = 'in_progress' THEN
    _new_status := 'arrived';
    _event_type := 'arrived';
    _message := 'Driver marked arrived';
    PERFORM set_config('app.skip_generic_status_log', 'on', true);
    UPDATE public.jobs
    SET status = _new_status, arrived_at = now(), updated_at = now()
    WHERE id = _job_id
    RETURNING * INTO _job;
  ELSE
    RAISE EXCEPTION 'Invalid job transition from % using action %', _job.status, _action;
  END IF;

  PERFORM public.log_job_event(_job.company_id, _job.id, _event_type, _message, NULL);
  RETURN _job;
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_transition_job(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.driver_update_job_notes(_job_id UUID, _notes TEXT)
RETURNS public.jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _job public.jobs%ROWTYPE;
  _driver_id UUID;
BEGIN
  SELECT * INTO _job FROM public.jobs WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;

  _driver_id := public.current_driver_id(_job.company_id);
  IF _driver_id IS NULL OR _job.driver_id IS DISTINCT FROM _driver_id THEN
    RAISE EXCEPTION 'This job is not assigned to the current driver';
  END IF;

  UPDATE public.jobs
  SET notes = _notes, updated_at = now()
  WHERE id = _job_id
  RETURNING * INTO _job;

  RETURN _job;
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_update_job_notes(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.driver_fail_job(_job_id UUID, _reason TEXT, _notes TEXT DEFAULT NULL)
RETURNS public.jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _job public.jobs%ROWTYPE;
  _driver_id UUID;
BEGIN
  SELECT * INTO _job FROM public.jobs WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;

  _driver_id := public.current_driver_id(_job.company_id);
  IF _driver_id IS NULL OR _job.driver_id IS DISTINCT FROM _driver_id THEN
    RAISE EXCEPTION 'This job is not assigned to the current driver';
  END IF;

  IF _job.status NOT IN ('assigned','accepted','in_progress','arrived') THEN
    RAISE EXCEPTION 'Only active jobs can be failed';
  END IF;

  PERFORM set_config('app.skip_generic_status_log', 'on', true);
  UPDATE public.jobs
  SET status = 'failed',
      failed_at = now(),
      failure_reason = _reason,
      notes = COALESCE(NULLIF(_notes, ''), notes),
      updated_at = now()
  WHERE id = _job_id
  RETURNING * INTO _job;

  UPDATE public.drivers SET status = 'available', updated_at = now() WHERE id = _driver_id;
  IF _job.vehicle_id IS NOT NULL THEN
    UPDATE public.vehicles SET status = 'available', updated_at = now()
    WHERE id = _job.vehicle_id AND status = 'in_use';
  END IF;

  PERFORM public.log_job_event(
    _job.company_id,
    _job.id,
    'failed_delivery',
    'Driver reported failed delivery',
    jsonb_build_object('reason', _reason)
  );

  RETURN _job;
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_fail_job(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_job_proof(
  _job_id UUID,
  _recipient_name TEXT,
  _notes TEXT DEFAULT NULL,
  _photo_url TEXT DEFAULT NULL,
  _signature_url TEXT DEFAULT NULL
)
RETURNS public.jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _job public.jobs%ROWTYPE;
  _driver_id UUID;
BEGIN
  SELECT * INTO _job FROM public.jobs WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;

  _driver_id := public.current_driver_id(_job.company_id);
  IF _driver_id IS NULL OR _job.driver_id IS DISTINCT FROM _driver_id THEN
    RAISE EXCEPTION 'This job is not assigned to the current driver';
  END IF;

  IF _job.status <> 'arrived' THEN
    RAISE EXCEPTION 'Proof can only be submitted after arrival';
  END IF;

  IF trim(COALESCE(_recipient_name, '')) = '' THEN
    RAISE EXCEPTION 'Recipient name is required';
  END IF;

  IF _photo_url IS NOT NULL AND _photo_url NOT LIKE _job.company_id::text || '/jobs/' || _job.id::text || '/photos/%' THEN
    RAISE EXCEPTION 'Invalid proof photo path';
  END IF;

  IF _signature_url IS NOT NULL AND _signature_url NOT LIKE _job.company_id::text || '/jobs/' || _job.id::text || '/signatures/%' THEN
    RAISE EXCEPTION 'Invalid proof signature path';
  END IF;

  INSERT INTO public.job_proofs (
    company_id,
    job_id,
    driver_id,
    recipient_name,
    notes,
    photo_url,
    signature_url,
    created_by
  )
  VALUES (
    _job.company_id,
    _job.id,
    _driver_id,
    trim(_recipient_name),
    NULLIF(_notes, ''),
    NULLIF(_photo_url, ''),
    NULLIF(_signature_url, ''),
    auth.uid()
  );

  PERFORM set_config('app.skip_generic_status_log', 'on', true);
  UPDATE public.jobs
  SET status = 'completed',
      completed_at = now(),
      proof_recipient_name = trim(_recipient_name),
      proof_notes = NULLIF(_notes, ''),
      proof_photo_url = NULLIF(_photo_url, ''),
      proof_signature_url = NULLIF(_signature_url, ''),
      updated_at = now()
  WHERE id = _job_id
  RETURNING * INTO _job;

  UPDATE public.drivers SET status = 'available', updated_at = now() WHERE id = _driver_id;
  IF _job.vehicle_id IS NOT NULL THEN
    UPDATE public.vehicles SET status = 'available', updated_at = now()
    WHERE id = _job.vehicle_id AND status = 'in_use';
  END IF;

  PERFORM public.log_job_event(_job.company_id, _job.id, 'proof_uploaded', 'Proof of completion uploaded', NULL);
  PERFORM public.log_job_event(_job.company_id, _job.id, 'job_completed', 'Job completed', NULL);

  RETURN _job;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_job_proof(uuid, text, text, text, text) TO authenticated;

-- ---------- Activity triggers ------------------------------------------
CREATE OR REPLACE FUNCTION public.log_incident_created()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.job_id IS NOT NULL THEN
    PERFORM public.log_job_event(
      NEW.company_id,
      NEW.job_id,
      'incident_created',
      'Incident created',
      jsonb_build_object('incident_id', NEW.id, 'severity', NEW.severity, 'type', NEW.incident_type)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS incidents_log_created ON public.incidents;
CREATE TRIGGER incidents_log_created
  AFTER INSERT ON public.incidents
  FOR EACH ROW EXECUTE FUNCTION public.log_incident_created();

CREATE OR REPLACE FUNCTION public.sync_vehicle_maintenance_status()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _active_count INTEGER;
  _active_jobs INTEGER;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('reported','scheduled','in_progress') THEN
      UPDATE public.vehicles
      SET status = 'maintenance', updated_at = now()
      WHERE id = NEW.vehicle_id AND status <> 'out_of_service';
    ELSIF NEW.status = 'completed' THEN
      SELECT count(*) INTO _active_count
      FROM public.maintenance
      WHERE vehicle_id = NEW.vehicle_id
        AND id <> NEW.id
        AND status IN ('reported','scheduled','in_progress');

      SELECT count(*) INTO _active_jobs
      FROM public.jobs
      WHERE vehicle_id = NEW.vehicle_id
        AND status IN ('assigned','accepted','in_progress','arrived');

      IF _active_count = 0 AND _active_jobs = 0 THEN
        UPDATE public.vehicles
        SET status = 'available', updated_at = now()
        WHERE id = NEW.vehicle_id AND status = 'maintenance';
      ELSIF _active_jobs > 0 THEN
        UPDATE public.vehicles
        SET status = 'in_use', updated_at = now()
        WHERE id = NEW.vehicle_id AND status = 'maintenance';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.job_events (company_id, job_id, actor_id, event_type, message, metadata)
    SELECT j.company_id,
           j.id,
           auth.uid(),
           'maintenance_status_changed',
           'Maintenance status changed for assigned vehicle',
           jsonb_build_object('maintenance_id', NEW.id, 'old_status', OLD.status, 'new_status', NEW.status)
    FROM public.jobs j
    WHERE j.company_id = NEW.company_id
      AND j.vehicle_id = NEW.vehicle_id
      AND j.status IN ('assigned','accepted','in_progress','arrived');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS maintenance_sync_vehicle_status ON public.maintenance;
CREATE TRIGGER maintenance_sync_vehicle_status
  AFTER INSERT OR UPDATE OF status ON public.maintenance
  FOR EACH ROW EXECUTE FUNCTION public.sync_vehicle_maintenance_status();

-- ---------- RLS hardening ----------------------------------------------
DROP POLICY IF EXISTS "jobs tenant read" ON public.jobs;
DROP POLICY IF EXISTS "jobs assigned driver update" ON public.jobs;
DROP POLICY IF EXISTS "incidents tenant read" ON public.incidents;
DROP POLICY IF EXISTS "incidents ops insert" ON public.incidents;
DROP POLICY IF EXISTS "maintenance tenant read" ON public.maintenance;
DROP POLICY IF EXISTS "maintenance fleet insert" ON public.maintenance;

CREATE POLICY "jobs role scoped read" ON public.jobs FOR SELECT TO authenticated
  USING (
    public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[])
    OR EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = jobs.driver_id AND d.company_id = jobs.company_id AND d.user_id = auth.uid()
    )
  );

CREATE POLICY "job_proofs role scoped read" ON public.job_proofs FOR SELECT TO authenticated
  USING (
    public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[])
    OR EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = job_proofs.driver_id AND d.company_id = job_proofs.company_id AND d.user_id = auth.uid()
    )
  );

CREATE POLICY "job_proofs driver insert own job" ON public.job_proofs FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.jobs j
      JOIN public.drivers d ON d.id = j.driver_id AND d.company_id = j.company_id
      WHERE j.id = job_proofs.job_id
        AND j.company_id = job_proofs.company_id
        AND d.id = job_proofs.driver_id
        AND d.user_id = auth.uid()
    )
  );

CREATE POLICY "incidents role scoped read" ON public.incidents FOR SELECT TO authenticated
  USING (
    public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[])
    OR EXISTS (
      SELECT 1
      FROM public.jobs j
      JOIN public.drivers d ON d.id = j.driver_id AND d.company_id = j.company_id
      WHERE j.id = incidents.job_id
        AND j.company_id = incidents.company_id
        AND d.user_id = auth.uid()
    )
  );

CREATE POLICY "incidents scoped insert" ON public.incidents FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[])
    OR (
      public.has_role(company_id, 'driver')
      AND reported_by = auth.uid()
      AND job_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.jobs j
        JOIN public.drivers d ON d.id = j.driver_id AND d.company_id = j.company_id
        WHERE j.id = incidents.job_id
          AND j.company_id = incidents.company_id
          AND d.user_id = auth.uid()
          AND (incidents.driver_id IS NULL OR incidents.driver_id = d.id)
          AND (incidents.vehicle_id IS NULL OR incidents.vehicle_id = j.vehicle_id)
          AND j.status IN ('assigned','accepted','in_progress','arrived','failed','completed')
      )
    )
  );

CREATE POLICY "maintenance scoped insert" ON public.maintenance FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(company_id, ARRAY['admin','fleet_manager']::public.app_role[])
    OR (
      public.has_role(company_id, 'driver')
      AND created_by = auth.uid()
      AND EXISTS (
        SELECT 1
        FROM public.drivers d
        WHERE d.company_id = maintenance.company_id
          AND d.user_id = auth.uid()
          AND d.assigned_vehicle_id = maintenance.vehicle_id
      )
    )
  );

CREATE POLICY "maintenance role scoped read" ON public.maintenance FOR SELECT TO authenticated
  USING (
    public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[])
    OR EXISTS (
      SELECT 1
      FROM public.drivers d
      WHERE d.company_id = maintenance.company_id
        AND d.user_id = auth.uid()
        AND d.assigned_vehicle_id = maintenance.vehicle_id
    )
  );

-- ---------- Storage policy refinement ----------------------------------
DROP POLICY IF EXISTS "proof-of-completion_insert" ON storage.objects;
DROP POLICY IF EXISTS "proof-of-completion_update" ON storage.objects;
DROP POLICY IF EXISTS "proof-of-completion_delete" ON storage.objects;
DROP POLICY IF EXISTS "incident-photos_insert" ON storage.objects;
DROP POLICY IF EXISTS "incident-photos_update" ON storage.objects;
DROP POLICY IF EXISTS "incident-photos_delete" ON storage.objects;
DROP POLICY IF EXISTS "maintenance-invoices_insert" ON storage.objects;
DROP POLICY IF EXISTS "maintenance-invoices_update" ON storage.objects;
DROP POLICY IF EXISTS "maintenance-invoices_delete" ON storage.objects;

CREATE POLICY "proof-of-completion_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'proof-of-completion'
    AND (
      public.has_any_role(((storage.foldername(name))[1])::uuid, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[])
      OR public.current_driver_id(((storage.foldername(name))[1])::uuid) IS NOT NULL
    )
  );

CREATE POLICY "proof-of-completion_update" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'proof-of-completion'
    AND (
      public.has_any_role(((storage.foldername(name))[1])::uuid, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[])
      OR public.current_driver_id(((storage.foldername(name))[1])::uuid) IS NOT NULL
    )
  );

CREATE POLICY "proof-of-completion_delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'proof-of-completion'
    AND (
      public.has_any_role(((storage.foldername(name))[1])::uuid, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[])
      OR public.current_driver_id(((storage.foldername(name))[1])::uuid) IS NOT NULL
    )
  );

CREATE POLICY "incident-photos_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'incident-photos'
    AND (
      public.has_any_role(((storage.foldername(name))[1])::uuid, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[])
      OR public.current_driver_id(((storage.foldername(name))[1])::uuid) IS NOT NULL
    )
  );

CREATE POLICY "incident-photos_update" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'incident-photos'
    AND (
      public.has_any_role(((storage.foldername(name))[1])::uuid, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[])
      OR public.current_driver_id(((storage.foldername(name))[1])::uuid) IS NOT NULL
    )
  );

CREATE POLICY "incident-photos_delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'incident-photos'
    AND (
      public.has_any_role(((storage.foldername(name))[1])::uuid, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[])
      OR public.current_driver_id(((storage.foldername(name))[1])::uuid) IS NOT NULL
    )
  );

CREATE POLICY "maintenance-invoices_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'maintenance-invoices'
    AND public.has_any_role(((storage.foldername(name))[1])::uuid, ARRAY['admin','fleet_manager']::public.app_role[])
  );

CREATE POLICY "maintenance-invoices_update" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'maintenance-invoices'
    AND public.has_any_role(((storage.foldername(name))[1])::uuid, ARRAY['admin','fleet_manager']::public.app_role[])
  );

CREATE POLICY "maintenance-invoices_delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'maintenance-invoices'
    AND public.has_any_role(((storage.foldername(name))[1])::uuid, ARRAY['admin','fleet_manager']::public.app_role[])
  );
