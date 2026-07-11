-- =========================================================================
-- ZappOS - Phase 9 Live Telemetry Operations, timeline events, and audit log.
-- Deterministic operations only. No AI, no prediction, no route optimization.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.operational_timeline_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  tracking_session_id UUID REFERENCES public.tracking_sessions(id) ON DELETE CASCADE,
  job_id UUID REFERENCES public.jobs(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
  driver_id UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (
    source IN ('trip','job','gps','geofence','deviation','incident','maintenance','dispatcher','brain')
  ),
  event_type TEXT NOT NULL,
  label TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  occurred_at TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operational_timeline_company_time_idx
  ON public.operational_timeline_events(company_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS operational_timeline_session_time_idx
  ON public.operational_timeline_events(tracking_session_id, occurred_at);
CREATE INDEX IF NOT EXISTS operational_timeline_metadata_idx
  ON public.operational_timeline_events USING GIN(metadata);
CREATE UNIQUE INDEX IF NOT EXISTS operational_timeline_dedupe_idx
  ON public.operational_timeline_events(
    company_id,
    source,
    event_type,
    occurred_at,
    COALESCE(tracking_session_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(job_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(vehicle_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(driver_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE TABLE IF NOT EXISTS public.dispatcher_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (
    action IN (
      'dispatcher_assigned_job',
      'dispatcher_cancelled',
      'dispatcher_acknowledged_incident',
      'dispatcher_dismissed_insight',
      'dispatcher_reran_brain',
      'dispatcher_replayed_trip'
    )
  ),
  entity_type TEXT NOT NULL,
  entity_id UUID,
  tracking_session_id UUID REFERENCES public.tracking_sessions(id) ON DELETE SET NULL,
  job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dispatcher_audit_company_time_idx
  ON public.dispatcher_audit_log(company_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS dispatcher_audit_actor_time_idx
  ON public.dispatcher_audit_log(actor_user_id, occurred_at DESC);

ALTER TABLE public.operational_timeline_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispatcher_audit_log ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.operational_timeline_events TO authenticated;
GRANT SELECT, INSERT ON public.dispatcher_audit_log TO authenticated;
GRANT ALL ON public.operational_timeline_events TO service_role;
GRANT ALL ON public.dispatcher_audit_log TO service_role;

CREATE OR REPLACE FUNCTION public.prevent_immutable_operations_history_change()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Operational history is immutable';
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_immutable_operations_history_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_immutable_operations_history_change() FROM anon;

DROP TRIGGER IF EXISTS operational_timeline_events_immutable ON public.operational_timeline_events;
CREATE TRIGGER operational_timeline_events_immutable
  BEFORE UPDATE OR DELETE ON public.operational_timeline_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_operations_history_change();

DROP TRIGGER IF EXISTS dispatcher_audit_log_immutable ON public.dispatcher_audit_log;
CREATE TRIGGER dispatcher_audit_log_immutable
  BEFORE UPDATE OR DELETE ON public.dispatcher_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_operations_history_change();

CREATE POLICY "operational timeline role scoped read" ON public.operational_timeline_events
  FOR SELECT TO authenticated
  USING (
    public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[])
    OR EXISTS (
      SELECT 1
      FROM public.tracking_sessions ts
      JOIN public.drivers d ON d.id = ts.driver_id AND d.company_id = ts.company_id
      WHERE ts.id = operational_timeline_events.tracking_session_id
        AND ts.company_id = operational_timeline_events.company_id
        AND d.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.jobs j
      JOIN public.drivers d ON d.id = j.driver_id AND d.company_id = j.company_id
      WHERE j.id = operational_timeline_events.job_id
        AND j.company_id = operational_timeline_events.company_id
        AND d.user_id = auth.uid()
    )
  );

CREATE POLICY "operational timeline ops insert" ON public.operational_timeline_events
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[])
    AND (tracking_session_id IS NULL OR EXISTS (
      SELECT 1 FROM public.tracking_sessions ts
      WHERE ts.id = tracking_session_id
        AND ts.company_id = operational_timeline_events.company_id
    ))
    AND (job_id IS NULL OR EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = job_id
        AND j.company_id = operational_timeline_events.company_id
    ))
    AND (vehicle_id IS NULL OR EXISTS (
      SELECT 1 FROM public.vehicles v
      WHERE v.id = vehicle_id
        AND v.company_id = operational_timeline_events.company_id
    ))
    AND (driver_id IS NULL OR EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = driver_id
        AND d.company_id = operational_timeline_events.company_id
    ))
  );

CREATE POLICY "dispatcher audit role scoped read" ON public.dispatcher_audit_log
  FOR SELECT TO authenticated
  USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[]));

CREATE POLICY "dispatcher audit ops insert" ON public.dispatcher_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (
    actor_user_id = auth.uid()
    AND public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[])
    AND (tracking_session_id IS NULL OR EXISTS (
      SELECT 1 FROM public.tracking_sessions ts
      WHERE ts.id = tracking_session_id
        AND ts.company_id = dispatcher_audit_log.company_id
    ))
    AND (job_id IS NULL OR EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = job_id
        AND j.company_id = dispatcher_audit_log.company_id
    ))
  );

CREATE OR REPLACE FUNCTION public.log_dispatcher_audit(
  _company_id UUID,
  _action TEXT,
  _entity_type TEXT,
  _entity_id UUID DEFAULT NULL,
  _tracking_session_id UUID DEFAULT NULL,
  _job_id UUID DEFAULT NULL,
  _metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS public.dispatcher_audit_log
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _row public.dispatcher_audit_log%ROWTYPE;
  _session public.tracking_sessions%ROWTYPE;
  _job public.jobs%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(_company_id, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to write dispatcher audit history';
  END IF;

  IF NULLIF(trim(_action), '') IS NULL OR NULLIF(trim(_entity_type), '') IS NULL THEN
    RAISE EXCEPTION 'Audit action and entity type are required';
  END IF;

  IF COALESCE(jsonb_typeof(_metadata), 'object') <> 'object' THEN
    RAISE EXCEPTION 'Audit metadata must be a JSON object';
  END IF;

  IF _tracking_session_id IS NOT NULL THEN
    SELECT * INTO _session
    FROM public.tracking_sessions
    WHERE id = _tracking_session_id AND company_id = _company_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Tracking session does not belong to company';
    END IF;
  END IF;

  IF _job_id IS NOT NULL THEN
    SELECT * INTO _job
    FROM public.jobs
    WHERE id = _job_id AND company_id = _company_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Job does not belong to company';
    END IF;
  END IF;

  IF _tracking_session_id IS NOT NULL AND _job_id IS NOT NULL AND _session.job_id IS DISTINCT FROM _job_id THEN
    RAISE EXCEPTION 'Tracking session and job do not match';
  END IF;

  INSERT INTO public.dispatcher_audit_log (
    company_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    tracking_session_id,
    job_id,
    metadata
  )
  VALUES (
    _company_id,
    auth.uid(),
    _action,
    _entity_type,
    _entity_id,
    _tracking_session_id,
    _job_id,
    COALESCE(_metadata, '{}'::jsonb)
  )
  RETURNING * INTO _row;

  INSERT INTO public.operational_timeline_events (
    company_id,
    tracking_session_id,
    job_id,
    source,
    event_type,
    label,
    severity,
    occurred_at,
    metadata
  )
  VALUES (
    _company_id,
    _tracking_session_id,
    _job_id,
    'dispatcher',
    _action,
    initcap(replace(_action, '_', ' ')),
    'info',
    _row.occurred_at,
    jsonb_build_object('audit_log_id', _row.id, 'actor_user_id', auth.uid()) || COALESCE(_metadata, '{}'::jsonb)
  )
  ON CONFLICT DO NOTHING;

  RETURN _row;
END;
$$;

REVOKE ALL ON FUNCTION public.log_dispatcher_audit(uuid, text, text, uuid, uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_dispatcher_audit(uuid, text, text, uuid, uuid, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.log_dispatcher_audit(uuid, text, text, uuid, uuid, uuid, jsonb) TO authenticated;
