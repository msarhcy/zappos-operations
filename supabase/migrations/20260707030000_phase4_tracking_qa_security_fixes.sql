-- =========================================================================
-- ZappOS - Phase 4 tracking QA/security hardening.
-- =========================================================================

ALTER TABLE public.tracking_telemetry_points
  ADD COLUMN IF NOT EXISTS device_installation_id UUID;

DROP INDEX IF EXISTS public.tracking_points_session_installation_sequence_idx;
CREATE UNIQUE INDEX IF NOT EXISTS tracking_points_session_installation_sequence_idx
  ON public.tracking_telemetry_points(tracking_session_id, device_installation_id, sequence_number)
  WHERE device_installation_id IS NOT NULL;

ALTER TABLE public.tracking_telemetry_points
  DROP CONSTRAINT IF EXISTS tracking_telemetry_points_tracking_session_id_sequence_number_key;

REVOKE ALL ON FUNCTION public.close_tracking_session_for_job(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_tracking_session_for_job(uuid, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.refresh_tracking_summary(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_tracking_summary(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.close_tracking_on_terminal_job_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_driver_tracking_session(uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ingest_tracking_telemetry(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.driver_transition_job(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.driver_transition_job(uuid, text, uuid, text, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.ensure_driver_tracking_session(uuid, uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_tracking_telemetry(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_transition_job(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_transition_job(uuid, text, uuid, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.driver_transition_job(_job_id UUID, _action TEXT)
RETURNS public.jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN public.driver_transition_job(_job_id, _action, NULL, NULL, NULL, NULL);
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

  SELECT * INTO _session
  FROM public.tracking_sessions
  WHERE job_id = _job.id AND status IN ('pending','active','paused','degraded')
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.tracking_sessions
    SET status = CASE WHEN status = 'pending' THEN 'active' ELSE status END,
        device_installation_id = COALESCE(device_installation_id, _device_installation_id),
        app_version = COALESCE(NULLIF(_app_version, ''), app_version),
        device_platform = COALESCE(NULLIF(_device_platform, ''), device_platform),
        location_permission_state = COALESCE(NULLIF(_location_permission_state, ''), location_permission_state),
        updated_at = now()
    WHERE id = _session.id
    RETURNING * INTO _session;

    RETURN _session;
  END IF;

  INSERT INTO public.tracking_sessions (
    company_id, job_id, driver_id, vehicle_id, status, source, started_at,
    device_installation_id, app_version, device_platform, location_permission_state
  )
  VALUES (
    _job.company_id, _job.id, _driver_id, _job.vehicle_id, 'active', 'DRIVER_PHONE', COALESCE(_job.started_at, now()),
    _device_installation_id, NULLIF(_app_version, ''), NULLIF(_device_platform, ''), NULLIF(_location_permission_state, '')
  )
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

CREATE OR REPLACE FUNCTION public.ingest_tracking_telemetry(_batch JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _session public.tracking_sessions%ROWTYPE;
  _driver_id UUID;
  _batch_id UUID;
  _installation_id UUID;
  _point JSONB;
  _telemetry_point_id UUID;
  _device_timestamp TIMESTAMPTZ;
  _lat DOUBLE PRECISION;
  _lng DOUBLE PRECISION;
  _altitude DOUBLE PRECISION;
  _accuracy DOUBLE PRECISION;
  _vertical_accuracy DOUBLE PRECISION;
  _device_speed DOUBLE PRECISION;
  _heading DOUBLE PRECISION;
  _sequence BIGINT;
  _movement public.telemetry_movement_state;
  _flags TEXT[];
  _quality public.telemetry_quality_status;
  _prev public.tracking_telemetry_points%ROWTYPE;
  _existing public.tracking_telemetry_points%ROWTYPE;
  _calculated_speed DOUBLE PRECISION;
  _distance DOUBLE PRECISION;
  _seconds DOUBLE PRECISION;
  _inserted_count INTEGER := 0;
  _acked UUID[] := '{}';
  _conflicts UUID[] := '{}';
  _rejected UUID[] := '{}';
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
  IF COALESCE(_batch->>'encoder_version', 'json-v1') <> 'json-v1' THEN
    RAISE EXCEPTION 'Unsupported telemetry encoder';
  END IF;

  _batch_id := COALESCE((_batch->>'batch_id')::uuid, gen_random_uuid());
  _installation_id := NULLIF(_batch->>'installation_id', '')::uuid;

  IF COALESCE(jsonb_array_length(_batch->'points'), 0) = 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'batch_id', _batch_id,
      'acknowledged_point_ids', '[]'::jsonb,
      'conflict_point_ids', '[]'::jsonb,
      'rejected_point_ids', '[]'::jsonb,
      'inserted_count', 0
    );
  END IF;

  FOR _point IN SELECT * FROM jsonb_array_elements(_batch->'points')
  LOOP
    _telemetry_point_id := (_point->>'telemetry_point_id')::uuid;
    _device_timestamp := (_point->>'device_timestamp')::timestamptz;
    _lat := NULLIF(_point->>'latitude', '')::double precision;
    _lng := NULLIF(_point->>'longitude', '')::double precision;
    _altitude := NULLIF(_point->>'altitude', '')::double precision;
    _accuracy := NULLIF(_point->>'horizontal_accuracy', '')::double precision;
    _vertical_accuracy := NULLIF(_point->>'vertical_accuracy', '')::double precision;
    _device_speed := NULLIF(_point->>'device_speed', '')::double precision;
    _heading := NULLIF(_point->>'heading', '')::double precision;
    _sequence := (_point->>'sequence_number')::bigint;
    _movement := COALESCE(NULLIF(_point->>'movement_state', '')::public.telemetry_movement_state, 'unknown'::public.telemetry_movement_state);
    _flags := '{}';
    _quality := 'high';
    _calculated_speed := NULL;

    SELECT * INTO _existing
    FROM public.tracking_telemetry_points
    WHERE telemetry_point_id = _telemetry_point_id;

    IF FOUND THEN
      IF _existing.tracking_session_id = _session.id
        AND _existing.job_id = _session.job_id
        AND _existing.driver_id = _session.driver_id
        AND _existing.vehicle_id IS NOT DISTINCT FROM _session.vehicle_id
        AND (_existing.device_installation_id IS NULL OR _existing.device_installation_id IS NOT DISTINCT FROM _installation_id)
        AND _existing.sequence_number = _sequence
        AND _existing.device_timestamp = _device_timestamp
        AND _existing.latitude IS NOT DISTINCT FROM _lat
        AND _existing.longitude IS NOT DISTINCT FROM _lng
        AND _existing.altitude IS NOT DISTINCT FROM _altitude
        AND _existing.horizontal_accuracy IS NOT DISTINCT FROM _accuracy
        AND _existing.vertical_accuracy IS NOT DISTINCT FROM _vertical_accuracy
        AND _existing.device_speed IS NOT DISTINCT FROM _device_speed
        AND _existing.heading IS NOT DISTINCT FROM _heading
      THEN
        _acked := array_append(_acked, _telemetry_point_id);
      ELSE
        _conflicts := array_append(_conflicts, _telemetry_point_id);
      END IF;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.tracking_telemetry_points
      WHERE tracking_session_id = _session.id
        AND device_installation_id IS NOT DISTINCT FROM _installation_id
        AND sequence_number = _sequence
        AND telemetry_point_id <> _telemetry_point_id
    ) THEN
      _conflicts := array_append(_conflicts, _telemetry_point_id);
      CONTINUE;
    END IF;

    IF _lat IS NULL OR _lng IS NULL
      OR _lat::text IN ('NaN','Infinity','-Infinity')
      OR _lng::text IN ('NaN','Infinity','-Infinity')
      OR _lat < -90 OR _lat > 90 OR _lng < -180 OR _lng > 180 THEN
      _flags := array_append(_flags, 'INVALID_COORDINATE');
      _quality := 'rejected';
    END IF;
    IF _accuracy IS NOT NULL AND (_accuracy::text IN ('NaN','Infinity','-Infinity') OR _accuracy < 0 OR _accuracy > 100) THEN
      _flags := array_append(_flags, 'POOR_ACCURACY');
      IF _quality <> 'rejected' THEN _quality := 'poor'; END IF;
    ELSIF _accuracy IS NOT NULL AND _accuracy > 50 AND _quality = 'high' THEN
      _quality := 'acceptable';
    END IF;
    IF _device_speed IS NOT NULL AND (_device_speed::text IN ('NaN','Infinity','-Infinity') OR _device_speed < 0 OR _device_speed > 60) THEN
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
      telemetry_point_id, company_id, tracking_session_id, job_id, driver_id, vehicle_id,
      device_installation_id, source, latitude, longitude, altitude, horizontal_accuracy,
      vertical_accuracy, device_speed, calculated_speed, heading, device_timestamp,
      movement_state, upload_batch_id, sequence_number, quality_status, quality_flags,
      telemetry_schema_version, encoder_version
    )
    VALUES (
      _telemetry_point_id, _session.company_id, _session.id, _session.job_id, _session.driver_id,
      _session.vehicle_id, _installation_id, _session.source, _lat, _lng, _altitude, _accuracy,
      _vertical_accuracy, _device_speed, _calculated_speed, _heading, _device_timestamp,
      _movement, _batch_id, _sequence, _quality, _flags,
      COALESCE(NULLIF(_point->>'telemetry_schema_version', '')::integer, 1),
      COALESCE(NULLIF(_point->>'encoder_version', ''), 'json-v1')
    );

    _inserted_count := _inserted_count + 1;
    _acked := array_append(_acked, _telemetry_point_id);
    IF _quality = 'rejected' THEN
      _rejected := array_append(_rejected, _telemetry_point_id);
    END IF;

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
      WHERE EXCLUDED.device_timestamp > public.vehicle_latest_locations.device_timestamp;
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
    'conflict_point_ids', to_jsonb(_conflicts),
    'rejected_point_ids', to_jsonb(_rejected),
    'inserted_count', _inserted_count
  );
END;
$$;
