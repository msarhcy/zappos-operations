-- =========================================================================
-- ZappOS - Phase 4 lightweight live tracking and first-party route telemetry.
-- =========================================================================

-- ---------- Enums -------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.tracking_session_status AS ENUM ('pending','active','paused','degraded','completed','terminated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.telemetry_source AS ENUM ('DRIVER_PHONE','ZAPP_BOX','P1','ROAD_NODE','THIRD_PARTY_TELEMATICS');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.telemetry_movement_state AS ENUM ('moving','stationary','unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.telemetry_quality_status AS ENUM ('high','acceptable','poor','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- Tables ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tracking_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES public.drivers(id) ON DELETE RESTRICT,
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
  status public.tracking_session_status NOT NULL DEFAULT 'pending',
  source public.telemetry_source NOT NULL DEFAULT 'DRIVER_PHONE',
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  device_installation_id UUID,
  app_version TEXT,
  device_platform TEXT,
  location_permission_state TEXT,
  tracking_quality_status public.telemetry_quality_status NOT NULL DEFAULT 'acceptable',
  last_telemetry_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tracking_sessions_job_company_unique UNIQUE (id, company_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS tracking_sessions_one_open_job_idx
  ON public.tracking_sessions(job_id)
  WHERE status IN ('pending','active','paused','degraded');
CREATE INDEX IF NOT EXISTS tracking_sessions_company_status_idx ON public.tracking_sessions(company_id, status);
CREATE INDEX IF NOT EXISTS tracking_sessions_driver_idx ON public.tracking_sessions(driver_id);
CREATE INDEX IF NOT EXISTS tracking_sessions_vehicle_idx ON public.tracking_sessions(vehicle_id);

CREATE TABLE IF NOT EXISTS public.tracking_telemetry_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telemetry_point_id UUID NOT NULL,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  tracking_session_id UUID NOT NULL REFERENCES public.tracking_sessions(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES public.drivers(id) ON DELETE RESTRICT,
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
  source public.telemetry_source NOT NULL DEFAULT 'DRIVER_PHONE',
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  altitude DOUBLE PRECISION,
  horizontal_accuracy DOUBLE PRECISION,
  vertical_accuracy DOUBLE PRECISION,
  device_speed DOUBLE PRECISION,
  calculated_speed DOUBLE PRECISION,
  heading DOUBLE PRECISION,
  device_timestamp TIMESTAMPTZ NOT NULL,
  server_received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  movement_state public.telemetry_movement_state NOT NULL DEFAULT 'unknown',
  upload_batch_id UUID NOT NULL,
  sequence_number BIGINT NOT NULL,
  quality_status public.telemetry_quality_status NOT NULL,
  quality_flags TEXT[] NOT NULL DEFAULT '{}',
  telemetry_schema_version INTEGER NOT NULL DEFAULT 1,
  encoder_version TEXT NOT NULL DEFAULT 'json-v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (telemetry_point_id),
  UNIQUE (tracking_session_id, sequence_number)
);

CREATE INDEX IF NOT EXISTS tracking_points_company_received_idx ON public.tracking_telemetry_points(company_id, server_received_at DESC);
CREATE INDEX IF NOT EXISTS tracking_points_session_device_idx ON public.tracking_telemetry_points(tracking_session_id, device_timestamp);
CREATE INDEX IF NOT EXISTS tracking_points_quality_idx ON public.tracking_telemetry_points(company_id, quality_status);

CREATE TABLE IF NOT EXISTS public.vehicle_latest_locations (
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  driver_id UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
  job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  tracking_session_id UUID REFERENCES public.tracking_sessions(id) ON DELETE SET NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  speed DOUBLE PRECISION,
  heading DOUBLE PRECISION,
  accuracy DOUBLE PRECISION,
  device_timestamp TIMESTAMPTZ NOT NULL,
  server_received_at TIMESTAMPTZ NOT NULL,
  source public.telemetry_source NOT NULL,
  quality_status public.telemetry_quality_status NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, vehicle_id)
);

CREATE TABLE IF NOT EXISTS public.tracking_summaries (
  tracking_session_id UUID PRIMARY KEY REFERENCES public.tracking_sessions(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  observed_point_count INTEGER NOT NULL DEFAULT 0,
  accepted_point_count INTEGER NOT NULL DEFAULT 0,
  rejected_point_count INTEGER NOT NULL DEFAULT 0,
  observed_distance DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_duration INTERVAL,
  moving_duration INTERVAL,
  stationary_duration INTERVAL,
  average_observed_speed DOUBLE PRECISION,
  maximum_credible_speed DOUBLE PRECISION,
  first_point_at TIMESTAMPTZ,
  last_point_at TIMESTAMPTZ,
  gps_coverage_score DOUBLE PRECISION,
  telemetry_quality_score DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tracking_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_telemetry_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_latest_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_summaries ENABLE ROW LEVEL SECURITY;

GRANT SELECT, UPDATE ON public.tracking_sessions TO authenticated;
GRANT SELECT ON public.tracking_telemetry_points TO authenticated;
GRANT SELECT ON public.vehicle_latest_locations TO authenticated;
GRANT SELECT ON public.tracking_summaries TO authenticated;
GRANT ALL ON public.tracking_sessions TO service_role;
GRANT ALL ON public.tracking_telemetry_points TO service_role;
GRANT ALL ON public.vehicle_latest_locations TO service_role;
GRANT ALL ON public.tracking_summaries TO service_role;

DROP TRIGGER IF EXISTS tracking_sessions_updated ON public.tracking_sessions;
CREATE TRIGGER tracking_sessions_updated
  BEFORE UPDATE ON public.tracking_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- RLS ---------------------------------------------------------
CREATE POLICY "tracking_sessions role scoped read" ON public.tracking_sessions FOR SELECT TO authenticated
  USING (
    public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[])
    OR EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = tracking_sessions.driver_id
        AND d.company_id = tracking_sessions.company_id
        AND d.user_id = auth.uid()
    )
  );

CREATE POLICY "tracking_sessions ops update" ON public.tracking_sessions FOR UPDATE TO authenticated
  USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[]))
  WITH CHECK (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[]));

CREATE POLICY "tracking_points ops read" ON public.tracking_telemetry_points FOR SELECT TO authenticated
  USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[]));

CREATE POLICY "latest_locations role scoped read" ON public.vehicle_latest_locations FOR SELECT TO authenticated
  USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[]));

CREATE POLICY "tracking_summaries role scoped read" ON public.tracking_summaries FOR SELECT TO authenticated
  USING (
    public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[])
    OR EXISTS (
      SELECT 1
      FROM public.tracking_sessions ts
      JOIN public.drivers d ON d.id = ts.driver_id AND d.company_id = ts.company_id
      WHERE ts.id = tracking_summaries.tracking_session_id
        AND d.user_id = auth.uid()
    )
  );

-- ---------- Helpers -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.haversine_meters(
  lat1 DOUBLE PRECISION,
  lon1 DOUBLE PRECISION,
  lat2 DOUBLE PRECISION,
  lon2 DOUBLE PRECISION
)
RETURNS DOUBLE PRECISION
LANGUAGE SQL IMMUTABLE SET search_path = public
AS $$
  SELECT CASE
    WHEN lat1 IS NULL OR lon1 IS NULL OR lat2 IS NULL OR lon2 IS NULL THEN NULL
    ELSE 6371000.0 * 2.0 * asin(
      least(1.0, sqrt(
        power(sin(radians((lat2 - lat1) / 2.0)), 2.0) +
        cos(radians(lat1)) * cos(radians(lat2)) *
        power(sin(radians((lon2 - lon1) / 2.0)), 2.0)
      ))
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_driver_tracking_session(
  _job_id UUID,
  _device_installation_id UUID DEFAULT NULL,
  _app_version TEXT DEFAULT NULL,
  _device_platform TEXT DEFAULT NULL,
  _location_permission_state TEXT DEFAULT NULL
)
RETURNS public.tracking_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _job public.jobs%ROWTYPE;
  _driver_id UUID;
  _session public.tracking_sessions%ROWTYPE;
BEGIN
  SELECT * INTO _job FROM public.jobs WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;

  _driver_id := public.current_driver_id(_job.company_id);
  IF _driver_id IS NULL OR _job.driver_id IS DISTINCT FROM _driver_id THEN
    RAISE EXCEPTION 'This job is not assigned to the current driver';
  END IF;
  IF _job.status NOT IN ('in_progress','arrived') THEN
    RAISE EXCEPTION 'Tracking can only start for an active trip';
  END IF;
  IF _job.vehicle_id IS NULL THEN
    RAISE EXCEPTION 'Tracking requires an assigned vehicle';
  END IF;

  INSERT INTO public.tracking_sessions (
    company_id, job_id, driver_id, vehicle_id, status, source, started_at,
    device_installation_id, app_version, device_platform, location_permission_state
  )
  VALUES (
    _job.company_id, _job.id, _driver_id, _job.vehicle_id, 'active', 'DRIVER_PHONE', COALESCE(_job.started_at, now()),
    _device_installation_id, NULLIF(_app_version, ''), NULLIF(_device_platform, ''), NULLIF(_location_permission_state, '')
  )
  ON CONFLICT (job_id) WHERE status IN ('pending','active','paused','degraded')
  DO UPDATE SET
    status = CASE WHEN tracking_sessions.status = 'pending' THEN 'active' ELSE tracking_sessions.status END,
    device_installation_id = COALESCE(tracking_sessions.device_installation_id, EXCLUDED.device_installation_id),
    app_version = COALESCE(EXCLUDED.app_version, tracking_sessions.app_version),
    device_platform = COALESCE(EXCLUDED.device_platform, tracking_sessions.device_platform),
    location_permission_state = COALESCE(EXCLUDED.location_permission_state, tracking_sessions.location_permission_state),
    updated_at = now()
  RETURNING * INTO _session;

  PERFORM public.log_job_event(
    _session.company_id,
    _session.job_id,
    'tracking_started',
    'Trip tracking started',
    jsonb_build_object('tracking_session_id', _session.id, 'source', _session.source)
  );

  RETURN _session;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_driver_tracking_session(uuid, uuid, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.close_tracking_session_for_job(_job_id UUID, _reason TEXT DEFAULT 'completed')
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _session public.tracking_sessions%ROWTYPE;
BEGIN
  FOR _session IN
    SELECT * FROM public.tracking_sessions
    WHERE job_id = _job_id AND status IN ('pending','active','paused','degraded')
    FOR UPDATE
  LOOP
    UPDATE public.tracking_sessions
    SET status = CASE WHEN _reason = 'terminated' THEN 'terminated' ELSE 'completed' END,
        ended_at = now(),
        updated_at = now()
    WHERE id = _session.id;

    PERFORM public.refresh_tracking_summary(_session.id);
    PERFORM public.log_job_event(
      _session.company_id,
      _session.job_id,
      'tracking_completed',
      'Trip tracking completed',
      jsonb_build_object('tracking_session_id', _session.id, 'reason', _reason)
    );
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_tracking_session_for_job(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.refresh_tracking_summary(_tracking_session_id UUID)
RETURNS public.tracking_summaries
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _session public.tracking_sessions%ROWTYPE;
  _summary public.tracking_summaries%ROWTYPE;
BEGIN
  SELECT * INTO _session FROM public.tracking_sessions WHERE id = _tracking_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tracking session not found'; END IF;

  WITH accepted AS (
    SELECT *,
      public.haversine_meters(
        lag(latitude) OVER (ORDER BY device_timestamp, sequence_number),
        lag(longitude) OVER (ORDER BY device_timestamp, sequence_number),
        latitude,
        longitude
      ) AS segment_meters,
      extract(epoch FROM (device_timestamp - lag(device_timestamp) OVER (ORDER BY device_timestamp, sequence_number))) AS segment_seconds
    FROM public.tracking_telemetry_points
    WHERE tracking_session_id = _tracking_session_id
      AND quality_status <> 'rejected'
      AND latitude IS NOT NULL
      AND longitude IS NOT NULL
  ),
  all_points AS (
    SELECT
      count(*)::int AS observed_count,
      count(*) FILTER (WHERE quality_status <> 'rejected')::int AS accepted_count,
      count(*) FILTER (WHERE quality_status = 'rejected')::int AS rejected_count,
      min(device_timestamp) AS first_at,
      max(device_timestamp) AS last_at,
      count(*) FILTER (WHERE quality_status IN ('high','acceptable'))::double precision AS usable_count
    FROM public.tracking_telemetry_points
    WHERE tracking_session_id = _tracking_session_id
  ),
  rollup AS (
    SELECT
      COALESCE(sum(segment_meters) FILTER (WHERE segment_meters IS NOT NULL AND segment_meters >= 0 AND segment_meters < 50000), 0) AS distance_m,
      COALESCE(sum(make_interval(secs => segment_seconds)) FILTER (WHERE movement_state = 'moving' AND segment_seconds BETWEEN 0 AND 600), '0 seconds'::interval) AS moving_time,
      COALESCE(sum(make_interval(secs => segment_seconds)) FILTER (WHERE movement_state = 'stationary' AND segment_seconds BETWEEN 0 AND 600), '0 seconds'::interval) AS stationary_time,
      max(COALESCE(calculated_speed, device_speed)) FILTER (WHERE COALESCE(calculated_speed, device_speed) BETWEEN 0 AND 60) AS max_speed
    FROM accepted
  )
  INSERT INTO public.tracking_summaries (
    tracking_session_id, company_id, observed_point_count, accepted_point_count, rejected_point_count,
    observed_distance, total_duration, moving_duration, stationary_duration,
    average_observed_speed, maximum_credible_speed, first_point_at, last_point_at,
    gps_coverage_score, telemetry_quality_score, updated_at
  )
  SELECT
    _tracking_session_id,
    _session.company_id,
    ap.observed_count,
    ap.accepted_count,
    ap.rejected_count,
    r.distance_m,
    CASE WHEN ap.first_at IS NOT NULL AND ap.last_at IS NOT NULL THEN ap.last_at - ap.first_at ELSE NULL END,
    r.moving_time,
    r.stationary_time,
    CASE
      WHEN ap.first_at IS NOT NULL AND ap.last_at > ap.first_at THEN r.distance_m / extract(epoch FROM (ap.last_at - ap.first_at))
      ELSE NULL
    END,
    r.max_speed,
    ap.first_at,
    ap.last_at,
    CASE WHEN ap.observed_count > 0 THEN round((ap.accepted_count::numeric / ap.observed_count::numeric) * 100, 2)::double precision ELSE NULL END,
    CASE WHEN ap.observed_count > 0 THEN round((ap.usable_count::numeric / ap.observed_count::numeric) * 100, 2)::double precision ELSE NULL END,
    now()
  FROM all_points ap CROSS JOIN rollup r
  ON CONFLICT (tracking_session_id) DO UPDATE SET
    company_id = EXCLUDED.company_id,
    observed_point_count = EXCLUDED.observed_point_count,
    accepted_point_count = EXCLUDED.accepted_point_count,
    rejected_point_count = EXCLUDED.rejected_point_count,
    observed_distance = EXCLUDED.observed_distance,
    total_duration = EXCLUDED.total_duration,
    moving_duration = EXCLUDED.moving_duration,
    stationary_duration = EXCLUDED.stationary_duration,
    average_observed_speed = EXCLUDED.average_observed_speed,
    maximum_credible_speed = EXCLUDED.maximum_credible_speed,
    first_point_at = EXCLUDED.first_point_at,
    last_point_at = EXCLUDED.last_point_at,
    gps_coverage_score = EXCLUDED.gps_coverage_score,
    telemetry_quality_score = EXCLUDED.telemetry_quality_score,
    updated_at = now()
  RETURNING * INTO _summary;

  RETURN _summary;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_tracking_summary(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.ingest_tracking_telemetry(_batch JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _session public.tracking_sessions%ROWTYPE;
  _driver_id UUID;
  _batch_id UUID;
  _point JSONB;
  _telemetry_point_id UUID;
  _device_timestamp TIMESTAMPTZ;
  _lat DOUBLE PRECISION;
  _lng DOUBLE PRECISION;
  _accuracy DOUBLE PRECISION;
  _device_speed DOUBLE PRECISION;
  _heading DOUBLE PRECISION;
  _sequence BIGINT;
  _flags TEXT[];
  _quality public.telemetry_quality_status;
  _prev public.tracking_telemetry_points%ROWTYPE;
  _calculated_speed DOUBLE PRECISION;
  _distance DOUBLE PRECISION;
  _seconds DOUBLE PRECISION;
  _inserted_count INTEGER := 0;
  _row_count INTEGER := 0;
  _acked UUID[] := '{}';
BEGIN
  IF _batch IS NULL OR jsonb_typeof(_batch) <> 'object' THEN
    RAISE EXCEPTION 'Invalid telemetry batch';
  END IF;

  SELECT * INTO _session
  FROM public.tracking_sessions
  WHERE id = (_batch->>'tracking_session_id')::uuid
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tracking session not found'; END IF;

  _driver_id := public.current_driver_id(_session.company_id);
  IF _driver_id IS NULL OR _session.driver_id IS DISTINCT FROM _driver_id THEN
    RAISE EXCEPTION 'This tracking session is not assigned to the current driver';
  END IF;
  IF _session.status NOT IN ('active','degraded','paused') THEN
    RAISE EXCEPTION 'Tracking session is not active';
  END IF;

  _batch_id := COALESCE((_batch->>'batch_id')::uuid, gen_random_uuid());

  IF COALESCE(jsonb_array_length(_batch->'points'), 0) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'batch_id', _batch_id, 'acknowledged_point_ids', '[]'::jsonb, 'inserted_count', 0);
  END IF;

  FOR _point IN SELECT * FROM jsonb_array_elements(_batch->'points')
  LOOP
    _telemetry_point_id := (_point->>'telemetry_point_id')::uuid;
    _device_timestamp := (_point->>'device_timestamp')::timestamptz;
    _lat := NULLIF(_point->>'latitude', '')::double precision;
    _lng := NULLIF(_point->>'longitude', '')::double precision;
    _accuracy := NULLIF(_point->>'horizontal_accuracy', '')::double precision;
    _device_speed := NULLIF(_point->>'device_speed', '')::double precision;
    _heading := NULLIF(_point->>'heading', '')::double precision;
    _sequence := (_point->>'sequence_number')::bigint;
    _flags := '{}';
    _quality := 'high';
    _calculated_speed := NULL;

    IF _lat IS NULL OR _lng IS NULL OR _lat < -90 OR _lat > 90 OR _lng < -180 OR _lng > 180 THEN
      _flags := array_append(_flags, 'INVALID_COORDINATE');
      _quality := 'rejected';
    END IF;
    IF _accuracy IS NOT NULL AND _accuracy > 100 THEN
      _flags := array_append(_flags, 'POOR_ACCURACY');
      IF _quality <> 'rejected' THEN _quality := 'poor'; END IF;
    ELSIF _accuracy IS NOT NULL AND _accuracy > 50 AND _quality = 'high' THEN
      _quality := 'acceptable';
    END IF;
    IF _device_speed IS NOT NULL AND (_device_speed < 0 OR _device_speed > 60) THEN
      _flags := array_append(_flags, 'SUSPICIOUS_SPEED');
      IF _quality <> 'rejected' THEN _quality := 'poor'; END IF;
    END IF;
    IF now() - _device_timestamp > interval '6 hours' THEN
      _flags := array_append(_flags, 'DELAYED_UPLOAD');
      IF _quality = 'high' THEN _quality := 'acceptable'; END IF;
    END IF;

    SELECT * INTO _prev
    FROM public.tracking_telemetry_points
    WHERE tracking_session_id = _session.id
      AND quality_status <> 'rejected'
      AND latitude IS NOT NULL
      AND longitude IS NOT NULL
    ORDER BY device_timestamp DESC, sequence_number DESC
    LIMIT 1;

    IF FOUND THEN
      IF _device_timestamp < _prev.device_timestamp THEN
        _flags := array_append(_flags, 'OUT_OF_ORDER');
        IF _quality = 'high' THEN _quality := 'acceptable'; END IF;
      END IF;
      IF _quality <> 'rejected' THEN
        _distance := public.haversine_meters(_prev.latitude, _prev.longitude, _lat, _lng);
        _seconds := extract(epoch FROM (_device_timestamp - _prev.device_timestamp));
        IF _distance IS NOT NULL AND _seconds > 0 THEN
          _calculated_speed := _distance / _seconds;
          IF _calculated_speed > 60 THEN
            _flags := array_append(_flags, 'LOCATION_JUMP');
            _quality := 'poor';
          END IF;
        END IF;
      END IF;
    END IF;

    INSERT INTO public.tracking_telemetry_points (
      telemetry_point_id, company_id, tracking_session_id, job_id, driver_id, vehicle_id, source,
      latitude, longitude, altitude, horizontal_accuracy, vertical_accuracy, device_speed,
      calculated_speed, heading, device_timestamp, movement_state, upload_batch_id,
      sequence_number, quality_status, quality_flags, telemetry_schema_version, encoder_version
    )
    VALUES (
      _telemetry_point_id, _session.company_id, _session.id, _session.job_id, _session.driver_id, _session.vehicle_id, _session.source,
      _lat, _lng, NULLIF(_point->>'altitude', '')::double precision, _accuracy, NULLIF(_point->>'vertical_accuracy', '')::double precision, _device_speed,
      _calculated_speed, _heading, _device_timestamp,
      COALESCE(NULLIF(_point->>'movement_state', '')::public.telemetry_movement_state, 'unknown'::public.telemetry_movement_state),
      _batch_id, _sequence, _quality, _flags,
      COALESCE(NULLIF(_point->>'telemetry_schema_version', '')::integer, 1),
      COALESCE(NULLIF(_point->>'encoder_version', ''), 'json-v1')
    )
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS _row_count = ROW_COUNT;
    _inserted_count := _inserted_count + _row_count;
    _acked := array_append(_acked, _telemetry_point_id);

    IF _quality <> 'rejected' AND _lat IS NOT NULL AND _lng IS NOT NULL AND _session.vehicle_id IS NOT NULL THEN
      INSERT INTO public.vehicle_latest_locations (
        company_id, vehicle_id, driver_id, job_id, tracking_session_id, latitude, longitude,
        speed, heading, accuracy, device_timestamp, server_received_at, source, quality_status, updated_at
      )
      VALUES (
        _session.company_id, _session.vehicle_id, _session.driver_id, _session.job_id, _session.id, _lat, _lng,
        COALESCE(_calculated_speed, _device_speed), _heading, _accuracy, _device_timestamp, now(), _session.source, _quality, now()
      )
      ON CONFLICT (company_id, vehicle_id) DO UPDATE SET
        driver_id = EXCLUDED.driver_id,
        job_id = EXCLUDED.job_id,
        tracking_session_id = EXCLUDED.tracking_session_id,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        speed = EXCLUDED.speed,
        heading = EXCLUDED.heading,
        accuracy = EXCLUDED.accuracy,
        device_timestamp = EXCLUDED.device_timestamp,
        server_received_at = EXCLUDED.server_received_at,
        source = EXCLUDED.source,
        quality_status = EXCLUDED.quality_status,
        updated_at = now()
      WHERE EXCLUDED.device_timestamp >= public.vehicle_latest_locations.device_timestamp;
    END IF;

    UPDATE public.tracking_sessions
    SET last_telemetry_at = greatest(COALESCE(last_telemetry_at, _device_timestamp), _device_timestamp),
        tracking_quality_status = CASE
          WHEN _quality = 'rejected' THEN tracking_quality_status
          ELSE _quality
        END,
        updated_at = now()
    WHERE id = _session.id;
  END LOOP;

  PERFORM public.refresh_tracking_summary(_session.id);

  RETURN jsonb_build_object(
    'ok', true,
    'batch_id', _batch_id,
    'acknowledged_point_ids', to_jsonb(_acked),
    'inserted_count', _inserted_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ingest_tracking_telemetry(jsonb) TO authenticated;

-- ---------- Lifecycle integration --------------------------------------
CREATE OR REPLACE FUNCTION public.driver_transition_job(
  _job_id UUID,
  _action TEXT,
  _device_installation_id UUID DEFAULT NULL,
  _app_version TEXT DEFAULT NULL,
  _device_platform TEXT DEFAULT NULL,
  _location_permission_state TEXT DEFAULT NULL
)
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
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;

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
    PERFORM public.ensure_driver_tracking_session(
      _job.id,
      _device_installation_id,
      _app_version,
      _device_platform,
      _location_permission_state
    );
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

GRANT EXECUTE ON FUNCTION public.driver_transition_job(uuid, text, uuid, text, text, text) TO authenticated;

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

  PERFORM public.close_tracking_session_for_job(_job.id, 'failed');

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
    company_id, job_id, driver_id, recipient_name, notes, photo_url, signature_url, created_by
  )
  VALUES (
    _job.company_id, _job.id, _driver_id, trim(_recipient_name), NULLIF(_notes, ''), NULLIF(_photo_url, ''), NULLIF(_signature_url, ''), auth.uid()
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

  PERFORM public.close_tracking_session_for_job(_job.id, 'completed');
  PERFORM public.log_job_event(_job.company_id, _job.id, 'proof_uploaded', 'Proof of completion uploaded', NULL);
  PERFORM public.log_job_event(_job.company_id, _job.id, 'job_completed', 'Job completed', NULL);

  RETURN _job;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_job_proof(uuid, text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.close_tracking_on_terminal_job_status()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('completed','failed','cancelled') THEN
    PERFORM public.close_tracking_session_for_job(
      NEW.id,
      CASE WHEN NEW.status = 'cancelled' THEN 'terminated' ELSE NEW.status::text END
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS jobs_close_tracking_terminal_status ON public.jobs;
CREATE TRIGGER jobs_close_tracking_terminal_status
  AFTER UPDATE OF status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.close_tracking_on_terminal_job_status();
