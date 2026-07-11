-- =========================================================================
-- ZappOS - Phase 10 Live Operations Control Centre.
-- Dispatcher command centre, operational alerts, notes, handovers, and
-- in-app operational notifications. No hardware control, no predictions.
-- =========================================================================

DO $$ BEGIN
  ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'operational_alert';
  ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'handover_ready';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.operational_alert_status AS ENUM ('open','acknowledged','escalated','resolved','dismissed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.operational_escalation_level AS ENUM ('normal','priority','urgent','critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.shift_handover_status AS ENUM ('draft','ready','acknowledged','completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.operational_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL CHECK (
    alert_type IN (
      'telemetry_degraded',
      'vehicle_offline',
      'critical_incident',
      'overdue_maintenance',
      'major_route_deviation',
      'urgent_brain_insight',
      'failed_trip',
      'emergency_sos'
    )
  ),
  source_entity_type TEXT NOT NULL CHECK (
    source_entity_type IN (
      'tracking_session',
      'vehicle',
      'driver',
      'job',
      'incident',
      'maintenance',
      'brain_insight',
      'route_intelligence',
      'telemetry',
      'route_deviation'
    )
  ),
  source_entity_id UUID NOT NULL,
  status public.operational_alert_status NOT NULL DEFAULT 'open',
  acknowledged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ,
  acknowledgement_note TEXT,
  escalation_level public.operational_escalation_level NOT NULL DEFAULT 'normal',
  escalation_reason TEXT,
  escalated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  escalated_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  dismissed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status <> 'acknowledged') OR (acknowledged_by IS NOT NULL AND acknowledged_at IS NOT NULL)),
  CHECK ((status <> 'escalated') OR (escalated_by IS NOT NULL AND escalated_at IS NOT NULL)),
  CHECK ((status <> 'resolved') OR (resolved_by IS NOT NULL AND resolved_at IS NOT NULL)),
  CHECK ((status <> 'dismissed') OR (dismissed_by IS NOT NULL AND dismissed_at IS NOT NULL)),
  CHECK ((escalation_level NOT IN ('urgent','critical')) OR length(trim(COALESCE(escalation_reason, ''))) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS operational_alerts_unresolved_dedupe_idx
  ON public.operational_alerts(company_id, alert_type, source_entity_type, source_entity_id)
  WHERE status IN ('open','acknowledged','escalated');
CREATE INDEX IF NOT EXISTS operational_alerts_company_status_idx
  ON public.operational_alerts(company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS operational_alerts_company_escalation_idx
  ON public.operational_alerts(company_id, escalation_level, created_at DESC);
CREATE INDEX IF NOT EXISTS operational_alerts_source_idx
  ON public.operational_alerts(company_id, source_entity_type, source_entity_id);
CREATE INDEX IF NOT EXISTS operational_alerts_unresolved_idx
  ON public.operational_alerts(company_id, created_at DESC)
  WHERE status IN ('open','acknowledged','escalated');

CREATE TABLE IF NOT EXISTS public.operational_alert_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  alert_id UUID NOT NULL REFERENCES public.operational_alerts(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role public.app_role,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('opened','acknowledged','escalated','resolved','dismissed','note_added','notification_created')
  ),
  old_status public.operational_alert_status,
  new_status public.operational_alert_status,
  old_escalation_level public.operational_escalation_level,
  new_escalation_level public.operational_escalation_level,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operational_alert_events_alert_time_idx
  ON public.operational_alert_events(alert_id, created_at DESC);
CREATE INDEX IF NOT EXISTS operational_alert_events_company_time_idx
  ON public.operational_alert_events(company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.operational_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  author_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  author_role public.app_role NOT NULL,
  linked_entity_type TEXT NOT NULL CHECK (
    linked_entity_type IN ('job','vehicle','driver','incident','tracking_session','alert')
  ),
  linked_entity_id UUID NOT NULL,
  visibility_level TEXT NOT NULL DEFAULT 'operations' CHECK (visibility_level IN ('operations','fleet','admin')),
  note_text TEXT NOT NULL CHECK (length(trim(note_text)) > 0 AND length(note_text) <= 4000),
  correction_of_note_id UUID REFERENCES public.operational_notes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operational_notes_entity_time_idx
  ON public.operational_notes(company_id, linked_entity_type, linked_entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS operational_notes_author_time_idx
  ON public.operational_notes(author_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.shift_handovers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_by_role public.app_role NOT NULL,
  acknowledged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ,
  completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  status public.shift_handover_status NOT NULL DEFAULT 'draft',
  title TEXT NOT NULL DEFAULT 'Shift handover',
  summary JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(summary) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shift_handovers_company_status_idx
  ON public.shift_handovers(company_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.shift_handover_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  handover_id UUID NOT NULL REFERENCES public.shift_handovers(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL,
  source_entity_type TEXT NOT NULL,
  source_entity_id UUID,
  label TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shift_handover_items_handover_order_idx
  ON public.shift_handover_items(handover_id, sort_order, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS shift_handover_items_dedupe_idx
  ON public.shift_handover_items(
    handover_id,
    item_type,
    source_entity_type,
    COALESCE(source_entity_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

ALTER TABLE public.operational_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operational_alert_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operational_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_handovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_handover_items ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE ON public.operational_alerts FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.operational_alert_events FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.operational_notes FROM authenticated;
REVOKE UPDATE, DELETE ON public.shift_handovers FROM authenticated;
REVOKE UPDATE, DELETE ON public.shift_handover_items FROM authenticated;
GRANT SELECT ON public.operational_alerts TO authenticated;
GRANT SELECT ON public.operational_alert_events TO authenticated;
GRANT SELECT ON public.operational_notes TO authenticated;
GRANT SELECT, INSERT ON public.shift_handovers TO authenticated;
GRANT SELECT, INSERT ON public.shift_handover_items TO authenticated;
GRANT INSERT ON public.notifications TO authenticated;
GRANT ALL ON public.operational_alerts TO service_role;
GRANT ALL ON public.operational_alert_events TO service_role;
GRANT ALL ON public.operational_notes TO service_role;
GRANT ALL ON public.shift_handovers TO service_role;
GRANT ALL ON public.shift_handover_items TO service_role;

DROP TRIGGER IF EXISTS operational_alerts_updated ON public.operational_alerts;
CREATE TRIGGER operational_alerts_updated
  BEFORE UPDATE ON public.operational_alerts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS shift_handovers_updated ON public.shift_handovers;
CREATE TRIGGER shift_handovers_updated
  BEFORE UPDATE ON public.shift_handovers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS operational_alert_events_immutable ON public.operational_alert_events;
CREATE TRIGGER operational_alert_events_immutable
  BEFORE UPDATE OR DELETE ON public.operational_alert_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_operations_history_change();

DROP TRIGGER IF EXISTS operational_notes_immutable ON public.operational_notes;
CREATE TRIGGER operational_notes_immutable
  BEFORE UPDATE OR DELETE ON public.operational_notes
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_operations_history_change();

DROP TRIGGER IF EXISTS shift_handover_items_immutable ON public.shift_handover_items;
CREATE TRIGGER shift_handover_items_immutable
  BEFORE UPDATE OR DELETE ON public.shift_handover_items
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_operations_history_change();

CREATE OR REPLACE FUNCTION public.protect_phase10_operational_alert_write()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF COALESCE(current_setting('app.phase10_alert_rpc', true), '') <> '1' THEN
    RAISE EXCEPTION 'Use Phase 10 operational alert RPCs';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_phase10_operational_alert_write() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_phase10_operational_alert_write() FROM anon;

DROP TRIGGER IF EXISTS operational_alerts_rpc_only ON public.operational_alerts;
CREATE TRIGGER operational_alerts_rpc_only
  BEFORE INSERT OR UPDATE ON public.operational_alerts
  FOR EACH ROW EXECUTE FUNCTION public.protect_phase10_operational_alert_write();

CREATE OR REPLACE FUNCTION public.protect_phase10_operational_note_write()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF COALESCE(current_setting('app.phase10_note_rpc', true), '') <> '1' THEN
    RAISE EXCEPTION 'Use Phase 10 operational note RPCs';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_phase10_operational_note_write() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_phase10_operational_note_write() FROM anon;

DROP TRIGGER IF EXISTS operational_notes_rpc_only ON public.operational_notes;
CREATE TRIGGER operational_notes_rpc_only
  BEFORE INSERT ON public.operational_notes
  FOR EACH ROW EXECUTE FUNCTION public.protect_phase10_operational_note_write();

CREATE OR REPLACE FUNCTION public.normalize_shift_handover_insert()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  _role public.app_role;
BEGIN
  _role := public.current_company_role(NEW.company_id);
  IF auth.uid() IS NULL OR _role NOT IN ('admin','fleet_manager','dispatcher') THEN
    RAISE EXCEPTION 'Not authorized to create handover';
  END IF;
  NEW.created_by := auth.uid();
  NEW.created_by_role := _role;
  NEW.acknowledged_by := NULL;
  NEW.acknowledged_at := NULL;
  NEW.completed_by := NULL;
  NEW.completed_at := NULL;
  NEW.status := 'draft';
  NEW.created_at := now();
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_shift_handover_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.normalize_shift_handover_insert() FROM anon;

DROP TRIGGER IF EXISTS shift_handovers_normalize_insert ON public.shift_handovers;
CREATE TRIGGER shift_handovers_normalize_insert
  BEFORE INSERT ON public.shift_handovers
  FOR EACH ROW EXECUTE FUNCTION public.normalize_shift_handover_insert();

CREATE OR REPLACE FUNCTION public.current_company_role(_company_id UUID)
RETURNS public.app_role
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT ur.role
  FROM public.user_roles ur
  WHERE ur.user_id = auth.uid()
    AND ur.company_id = _company_id
  ORDER BY CASE ur.role
    WHEN 'admin' THEN 1
    WHEN 'fleet_manager' THEN 2
    WHEN 'dispatcher' THEN 3
    WHEN 'viewer' THEN 4
    WHEN 'driver' THEN 5
    ELSE 9
  END
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_company_role(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_company_role(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.current_company_role(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_operations_source(
  _company_id UUID,
  _source_entity_type TEXT,
  _source_entity_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF _source_entity_type = 'tracking_session' THEN
    RETURN EXISTS (SELECT 1 FROM public.tracking_sessions WHERE id = _source_entity_id AND company_id = _company_id);
  ELSIF _source_entity_type = 'vehicle' THEN
    RETURN EXISTS (SELECT 1 FROM public.vehicles WHERE id = _source_entity_id AND company_id = _company_id);
  ELSIF _source_entity_type = 'driver' THEN
    RETURN EXISTS (SELECT 1 FROM public.drivers WHERE id = _source_entity_id AND company_id = _company_id);
  ELSIF _source_entity_type = 'job' THEN
    RETURN EXISTS (SELECT 1 FROM public.jobs WHERE id = _source_entity_id AND company_id = _company_id);
  ELSIF _source_entity_type = 'incident' THEN
    RETURN EXISTS (SELECT 1 FROM public.incidents WHERE id = _source_entity_id AND company_id = _company_id);
  ELSIF _source_entity_type = 'maintenance' THEN
    RETURN EXISTS (SELECT 1 FROM public.maintenance WHERE id = _source_entity_id AND company_id = _company_id);
  ELSIF _source_entity_type = 'brain_insight' THEN
    RETURN EXISTS (SELECT 1 FROM public.zapp_brain_insights WHERE id = _source_entity_id AND company_id = _company_id);
  ELSIF _source_entity_type = 'route_intelligence' THEN
    RETURN EXISTS (SELECT 1 FROM public.route_performance_records WHERE id = _source_entity_id AND company_id = _company_id)
      OR EXISTS (SELECT 1 FROM public.route_segment_baselines WHERE id = _source_entity_id AND company_id = _company_id);
  ELSIF _source_entity_type IN ('telemetry','route_deviation') THEN
    RETURN EXISTS (SELECT 1 FROM public.tracking_sessions WHERE id = _source_entity_id AND company_id = _company_id);
  END IF;
  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_operations_source(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_operations_source(uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.validate_operations_source(uuid, text, uuid) TO authenticated;

CREATE POLICY "operational alerts ops read" ON public.operational_alerts
  FOR SELECT TO authenticated
  USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[]));

CREATE POLICY "operational alerts ops insert" ON public.operational_alerts
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[])
    AND public.validate_operations_source(company_id, source_entity_type, source_entity_id)
  );

CREATE POLICY "operational alerts ops update" ON public.operational_alerts
  FOR UPDATE TO authenticated
  USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[]))
  WITH CHECK (
    public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[])
    AND public.validate_operations_source(company_id, source_entity_type, source_entity_id)
  );

CREATE POLICY "operational alert events ops read" ON public.operational_alert_events
  FOR SELECT TO authenticated
  USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[]));

CREATE POLICY "operational alert events ops insert" ON public.operational_alert_events
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[])
    AND EXISTS (
      SELECT 1 FROM public.operational_alerts a
      WHERE a.id = alert_id AND a.company_id = operational_alert_events.company_id
    )
  );

CREATE POLICY "operational notes ops read" ON public.operational_notes
  FOR SELECT TO authenticated
  USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[]));

CREATE POLICY "operational notes ops insert" ON public.operational_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    author_user_id = auth.uid()
    AND public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[])
    AND (
      (
        linked_entity_type = 'alert'
        AND EXISTS (
          SELECT 1 FROM public.operational_alerts a
          WHERE a.id = linked_entity_id
            AND a.company_id = operational_notes.company_id
        )
      )
      OR (
        linked_entity_type <> 'alert'
        AND public.validate_operations_source(company_id, linked_entity_type, linked_entity_id)
      )
    )
  );

CREATE POLICY "shift handovers ops read" ON public.shift_handovers
  FOR SELECT TO authenticated
  USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[]));

CREATE POLICY "shift handovers ops insert" ON public.shift_handovers
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND created_by_role = public.current_company_role(company_id)
    AND status = 'draft'
    AND acknowledged_by IS NULL
    AND acknowledged_at IS NULL
    AND completed_by IS NULL
    AND completed_at IS NULL
    AND public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[])
  );

CREATE POLICY "shift handovers ops update" ON public.shift_handovers
  FOR UPDATE TO authenticated
  USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[]))
  WITH CHECK (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[]));

CREATE POLICY "shift handover items ops read" ON public.shift_handover_items
  FOR SELECT TO authenticated
  USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[]));

CREATE POLICY "shift handover items ops insert" ON public.shift_handover_items
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[])
    AND EXISTS (
      SELECT 1 FROM public.shift_handovers h
      WHERE h.id = handover_id AND h.company_id = shift_handover_items.company_id
        AND h.status <> 'completed'
    )
    AND (
      source_entity_id IS NULL
      OR (
        source_entity_type = 'operational_note'
        AND EXISTS (
          SELECT 1 FROM public.operational_notes n
          WHERE n.id = source_entity_id AND n.company_id = shift_handover_items.company_id
        )
      )
      OR (
        source_entity_type IN ('alert','operational_alert')
        AND EXISTS (
          SELECT 1 FROM public.operational_alerts a
          WHERE a.id = source_entity_id AND a.company_id = shift_handover_items.company_id
        )
      )
      OR public.validate_operations_source(company_id, source_entity_type, source_entity_id)
    )
  );

CREATE POLICY "notifications ops insert" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[])
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = notifications.user_id
        AND ur.company_id = notifications.company_id
        AND ur.role IN ('admin','fleet_manager','dispatcher')
    )
  );

CREATE OR REPLACE FUNCTION public.log_operational_alert_event(
  _alert public.operational_alerts,
  _event_type TEXT,
  _old_status public.operational_alert_status DEFAULT NULL,
  _new_status public.operational_alert_status DEFAULT NULL,
  _old_escalation public.operational_escalation_level DEFAULT NULL,
  _new_escalation public.operational_escalation_level DEFAULT NULL,
  _reason TEXT DEFAULT NULL,
  _metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _event_id UUID;
  _role public.app_role;
BEGIN
  _role := public.current_company_role(_alert.company_id);
  INSERT INTO public.operational_alert_events (
    company_id, alert_id, actor_user_id, actor_role, event_type,
    old_status, new_status, old_escalation_level, new_escalation_level,
    reason, metadata
  )
  VALUES (
    _alert.company_id, _alert.id, auth.uid(), _role, _event_type,
    _old_status, _new_status, _old_escalation, _new_escalation,
    _reason, COALESCE(_metadata, '{}'::jsonb)
  )
  RETURNING id INTO _event_id;
  RETURN _event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_operational_alert_event(public.operational_alerts, text, public.operational_alert_status, public.operational_alert_status, public.operational_escalation_level, public.operational_escalation_level, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_operational_alert_event(public.operational_alerts, text, public.operational_alert_status, public.operational_alert_status, public.operational_escalation_level, public.operational_escalation_level, text, jsonb) FROM anon;

CREATE OR REPLACE FUNCTION public.notify_operations_users(
  _company_id UUID,
  _notification_type public.notification_type,
  _title TEXT,
  _body TEXT,
  _link_path TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _inserted INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(_company_id, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to create operational notifications';
  END IF;

  INSERT INTO public.notifications(company_id, user_id, notification_type, title, body, link_path)
  SELECT _company_id, ur.user_id, _notification_type, _title, _body, _link_path
  FROM public.user_roles ur
  WHERE ur.company_id = _company_id
    AND ur.role IN ('admin','fleet_manager','dispatcher')
    AND NOT EXISTS (
      SELECT 1
      FROM public.notifications n
      WHERE n.company_id = _company_id
        AND n.user_id = ur.user_id
        AND n.notification_type = _notification_type
        AND n.title = _title
        AND COALESCE(n.link_path, '') = COALESCE(_link_path, '')
        AND n.read_at IS NULL
    );

  GET DIAGNOSTICS _inserted = ROW_COUNT;
  RETURN _inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_operations_users(uuid, public.notification_type, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_operations_users(uuid, public.notification_type, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.notify_operations_users(uuid, public.notification_type, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_operational_alert(
  _company_id UUID,
  _alert_type TEXT,
  _source_entity_type TEXT,
  _source_entity_id UUID
)
RETURNS public.operational_alerts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _alert public.operational_alerts%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(_company_id, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to create operational alerts';
  END IF;
  IF NOT public.validate_operations_source(_company_id, _source_entity_type, _source_entity_id) THEN
    RAISE EXCEPTION 'Source entity does not belong to company';
  END IF;

  PERFORM set_config('app.phase10_alert_rpc', '1', true);
  INSERT INTO public.operational_alerts(company_id, alert_type, source_entity_type, source_entity_id)
  VALUES (_company_id, _alert_type, _source_entity_type, _source_entity_id)
  ON CONFLICT (company_id, alert_type, source_entity_type, source_entity_id)
    WHERE status IN ('open','acknowledged','escalated')
  DO UPDATE SET updated_at = now()
  RETURNING * INTO _alert;

  IF _alert.created_at = _alert.updated_at THEN
    PERFORM public.log_operational_alert_event(_alert, 'opened', NULL, _alert.status, NULL, _alert.escalation_level, NULL, '{}'::jsonb);
  END IF;
  RETURN _alert;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_operational_alert(uuid, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_operational_alert(uuid, text, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.upsert_operational_alert(uuid, text, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.transition_operational_alert(
  _alert_id UUID,
  _action TEXT,
  _escalation_level public.operational_escalation_level DEFAULT NULL,
  _note TEXT DEFAULT NULL
)
RETURNS public.operational_alerts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _alert public.operational_alerts%ROWTYPE;
  _old_status public.operational_alert_status;
  _old_level public.operational_escalation_level;
  _next_status public.operational_alert_status;
  _next_level public.operational_escalation_level;
  _event_type TEXT;
BEGIN
  SELECT * INTO _alert FROM public.operational_alerts WHERE id = _alert_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operational alert not found'; END IF;
  IF auth.uid() IS NULL OR NOT public.has_any_role(_alert.company_id, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to update operational alerts';
  END IF;
  IF _alert.status IN ('resolved','dismissed') THEN
    RAISE EXCEPTION 'Terminal alerts cannot be changed';
  END IF;

  _old_status := _alert.status;
  _old_level := _alert.escalation_level;
  _next_level := COALESCE(_escalation_level, _alert.escalation_level);

  IF _action = 'acknowledge' THEN
    IF _alert.status <> 'open' THEN
      RAISE EXCEPTION 'Only open alerts can be acknowledged';
    END IF;
    _next_status := 'acknowledged';
    _event_type := 'acknowledged';
  ELSIF _action = 'escalate' THEN
    _next_status := 'escalated';
    _next_level := COALESCE(_escalation_level, 'priority');
    _event_type := 'escalated';
    IF _next_level IN ('urgent','critical') AND length(trim(COALESCE(_note, ''))) = 0 THEN
      RAISE EXCEPTION 'Urgent and critical escalations require a reason';
    END IF;
  ELSIF _action = 'resolve' THEN
    _next_status := 'resolved';
    _event_type := 'resolved';
  ELSIF _action = 'dismiss' THEN
    _next_status := 'dismissed';
    _event_type := 'dismissed';
  ELSE
    RAISE EXCEPTION 'Unsupported alert transition';
  END IF;

  PERFORM set_config('app.phase10_alert_rpc', '1', true);
  UPDATE public.operational_alerts
  SET status = _next_status,
      escalation_level = _next_level,
      acknowledgement_note = CASE WHEN _action = 'acknowledge' THEN NULLIF(_note, '') ELSE acknowledgement_note END,
      acknowledged_by = CASE WHEN _action = 'acknowledge' THEN auth.uid() ELSE acknowledged_by END,
      acknowledged_at = CASE WHEN _action = 'acknowledge' THEN now() ELSE acknowledged_at END,
      escalation_reason = CASE WHEN _action = 'escalate' THEN NULLIF(_note, '') ELSE escalation_reason END,
      escalated_by = CASE WHEN _action = 'escalate' THEN auth.uid() ELSE escalated_by END,
      escalated_at = CASE WHEN _action = 'escalate' THEN now() ELSE escalated_at END,
      resolved_by = CASE WHEN _action = 'resolve' THEN auth.uid() ELSE resolved_by END,
      resolved_at = CASE WHEN _action = 'resolve' THEN now() ELSE resolved_at END,
      dismissed_by = CASE WHEN _action = 'dismiss' THEN auth.uid() ELSE dismissed_by END,
      dismissed_at = CASE WHEN _action = 'dismiss' THEN now() ELSE dismissed_at END
  WHERE id = _alert.id
  RETURNING * INTO _alert;

  PERFORM public.log_operational_alert_event(_alert, _event_type, _old_status, _next_status, _old_level, _next_level, _note, '{}'::jsonb);
  IF _event_type = 'escalated' THEN
    PERFORM public.notify_operations_users(
      _alert.company_id,
      'operational_alert',
      'Operational alert escalated',
      replace(_alert.alert_type, '_', ' ') || ' escalated to ' || _alert.escalation_level::text,
      '/operations-control?alert=' || _alert.id::text
    );
  END IF;
  RETURN _alert;
END;
$$;

REVOKE ALL ON FUNCTION public.transition_operational_alert(uuid, text, public.operational_escalation_level, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_operational_alert(uuid, text, public.operational_escalation_level, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.transition_operational_alert(uuid, text, public.operational_escalation_level, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_operational_note(
  _company_id UUID,
  _linked_entity_type TEXT,
  _linked_entity_id UUID,
  _note_text TEXT,
  _visibility_level TEXT DEFAULT 'operations',
  _correction_of_note_id UUID DEFAULT NULL
)
RETURNS public.operational_notes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _note public.operational_notes%ROWTYPE;
  _role public.app_role;
BEGIN
  _role := public.current_company_role(_company_id);
  IF auth.uid() IS NULL OR _role NOT IN ('admin','fleet_manager','dispatcher') THEN
    RAISE EXCEPTION 'Not authorized to create operational notes';
  END IF;
  IF _linked_entity_type = 'alert' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.operational_alerts
      WHERE id = _linked_entity_id AND company_id = _company_id
    ) THEN
      RAISE EXCEPTION 'Linked alert does not belong to company';
    END IF;
  ELSIF NOT public.validate_operations_source(_company_id, _linked_entity_type, _linked_entity_id) THEN
    RAISE EXCEPTION 'Linked entity does not belong to company';
  END IF;

  PERFORM set_config('app.phase10_note_rpc', '1', true);
  INSERT INTO public.operational_notes(
    company_id, author_user_id, author_role, linked_entity_type, linked_entity_id,
    visibility_level, note_text, correction_of_note_id
  )
  VALUES (
    _company_id, auth.uid(), _role, _linked_entity_type, _linked_entity_id,
    _visibility_level, _note_text, _correction_of_note_id
  )
  RETURNING * INTO _note;

  RETURN _note;
END;
$$;

REVOKE ALL ON FUNCTION public.create_operational_note(uuid, text, uuid, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_operational_note(uuid, text, uuid, text, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_operational_note(uuid, text, uuid, text, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.transition_shift_handover(
  _handover_id UUID,
  _next_status public.shift_handover_status
)
RETURNS public.shift_handovers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _handover public.shift_handovers%ROWTYPE;
BEGIN
  SELECT * INTO _handover FROM public.shift_handovers WHERE id = _handover_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shift handover not found'; END IF;
  IF auth.uid() IS NULL OR NOT public.has_any_role(_handover.company_id, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to update handover';
  END IF;
  IF _handover.status = 'completed' THEN
    RAISE EXCEPTION 'Completed handovers cannot be changed';
  END IF;
  IF _next_status = 'draft' OR (_handover.status = 'draft' AND _next_status NOT IN ('ready'))
    OR (_handover.status = 'ready' AND _next_status NOT IN ('acknowledged'))
    OR (_handover.status = 'acknowledged' AND _next_status NOT IN ('completed')) THEN
    RAISE EXCEPTION 'Invalid handover transition';
  END IF;

  UPDATE public.shift_handovers
  SET status = _next_status,
      acknowledged_by = CASE WHEN _next_status = 'acknowledged' THEN auth.uid() ELSE acknowledged_by END,
      acknowledged_at = CASE WHEN _next_status = 'acknowledged' THEN now() ELSE acknowledged_at END,
      completed_by = CASE WHEN _next_status = 'completed' THEN auth.uid() ELSE completed_by END,
      completed_at = CASE WHEN _next_status = 'completed' THEN now() ELSE completed_at END
  WHERE id = _handover_id
  RETURNING * INTO _handover;

  RETURN _handover;
END;
$$;

REVOKE ALL ON FUNCTION public.transition_shift_handover(uuid, public.shift_handover_status) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_shift_handover(uuid, public.shift_handover_status) FROM anon;
GRANT EXECUTE ON FUNCTION public.transition_shift_handover(uuid, public.shift_handover_status) TO authenticated;
