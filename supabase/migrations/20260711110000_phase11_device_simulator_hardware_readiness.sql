-- =========================================================================
-- ZappOS - Phase 11 Zapp Box / P1 Device Simulator and Hardware Readiness.
-- Simulation-only hardware readiness domain. No real hardware commands,
-- firmware deployment, ZCT production integration, AI, or autonomous control.
-- =========================================================================

DO $$ BEGIN
  ALTER TYPE public.telemetry_source ADD VALUE IF NOT EXISTS 'SIMULATOR';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.device_type AS ENUM ('ZAPP_BOX','P1','ROAD_NODE','SIMULATOR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.device_status AS ENUM ('unprovisioned','provisioned','active','inactive','degraded','maintenance','retired','blocked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.device_sim_status AS ENUM ('inventory','assigned','active','suspended','inactive','retired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.device_assignment_type AS ENUM ('primary','backup','temporary','simulator');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.device_assignment_status AS ENUM ('planned','active','inactive','removed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.device_command_status AS ENUM ('accepted','completed','rejected','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.firmware_release_status AS ENUM ('draft','approved','deprecated','blocked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.normalize_device_identifier(_value TEXT)
RETURNS TEXT
LANGUAGE SQL IMMUTABLE SET search_path = public
AS $$
  SELECT NULLIF(upper(regexp_replace(trim(COALESCE(_value, '')), '\s+', '', 'g')), '');
$$;

REVOKE ALL ON FUNCTION public.normalize_device_identifier(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.normalize_device_identifier(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.normalize_device_identifier(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.digits_only(_value TEXT)
RETURNS TEXT
LANGUAGE SQL IMMUTABLE SET search_path = public
AS $$
  SELECT NULLIF(regexp_replace(trim(COALESCE(_value, '')), '\D', '', 'g'), '');
$$;

REVOKE ALL ON FUNCTION public.digits_only(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.digits_only(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.digits_only(text) TO authenticated;

CREATE TABLE IF NOT EXISTS public.devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  device_type public.device_type NOT NULL,
  serial_number TEXT NOT NULL,
  serial_number_normalized TEXT GENERATED ALWAYS AS (public.normalize_device_identifier(serial_number)) STORED,
  hardware_model TEXT NOT NULL,
  hardware_model_normalized TEXT GENERATED ALWAYS AS (public.normalize_device_identifier(hardware_model)) STORED,
  hardware_revision TEXT,
  hardware_revision_normalized TEXT GENERATED ALWAYS AS (public.normalize_device_identifier(hardware_revision)) STORED,
  imei TEXT,
  imei_normalized TEXT GENERATED ALWAYS AS (public.digits_only(imei)) STORED,
  installation_id TEXT,
  installation_id_normalized TEXT GENERATED ALWAYS AS (public.normalize_device_identifier(installation_id)) STORED,
  status public.device_status NOT NULL DEFAULT 'unprovisioned',
  provisioned_at TIMESTAMPTZ,
  provisioned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  activated_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  firmware_version TEXT,
  bootloader_version TEXT,
  telemetry_source public.telemetry_source NOT NULL DEFAULT 'ZAPP_BOX',
  simulated BOOLEAN NOT NULL DEFAULT false,
  simulation_label TEXT,
  provisioning_state TEXT NOT NULL DEFAULT 'registered' CHECK (
    provisioning_state IN (
      'registered','identity_verified','sim_assigned','vehicle_assigned',
      'configuration_ready','simulated_ready','active'
    )
  ),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (length(serial_number_normalized) BETWEEN 4 AND 64),
  CHECK (hardware_model_normalized IS NOT NULL AND length(hardware_model_normalized) BETWEEN 2 AND 64),
  CHECK (imei_normalized IS NULL OR length(imei_normalized) = 15),
  CHECK (installation_id_normalized IS NULL OR length(installation_id_normalized) BETWEEN 4 AND 80),
  CHECK ((device_type <> 'SIMULATOR' AND simulated = false) OR (device_type = 'SIMULATOR' AND simulated = true AND simulation_label IS NOT NULL)),
  CHECK (device_type <> 'SIMULATOR' OR telemetry_source IN ('ZAPP_BOX','P1','ROAD_NODE','SIMULATOR'))
);

CREATE UNIQUE INDEX IF NOT EXISTS devices_company_serial_unique_idx
  ON public.devices(company_id, serial_number_normalized);
CREATE UNIQUE INDEX IF NOT EXISTS devices_company_imei_unique_idx
  ON public.devices(company_id, imei_normalized)
  WHERE imei_normalized IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS devices_company_installation_unique_idx
  ON public.devices(company_id, installation_id_normalized)
  WHERE installation_id_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS devices_company_status_idx
  ON public.devices(company_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.device_sims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  iccid TEXT NOT NULL,
  iccid_normalized TEXT GENERATED ALWAYS AS (public.digits_only(iccid)) STORED,
  msisdn TEXT,
  msisdn_normalized TEXT GENERATED ALWAYS AS (public.digits_only(msisdn)) STORED,
  provider TEXT,
  country_code TEXT,
  apn TEXT,
  status public.device_sim_status NOT NULL DEFAULT 'inventory',
  assigned_device_id UUID REFERENCES public.devices(id) ON DELETE SET NULL,
  primary_sim BOOLEAN NOT NULL DEFAULT true,
  activated_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ,
  last_network_seen_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (iccid_normalized IS NOT NULL AND length(iccid_normalized) BETWEEN 18 AND 22 AND left(iccid_normalized, 2) = '89'),
  CHECK (msisdn_normalized IS NULL OR length(msisdn_normalized) BETWEEN 7 AND 15)
);

CREATE UNIQUE INDEX IF NOT EXISTS device_sims_company_iccid_unique_idx
  ON public.device_sims(company_id, iccid_normalized);
CREATE UNIQUE INDEX IF NOT EXISTS device_sims_company_msisdn_unique_idx
  ON public.device_sims(company_id, msisdn_normalized)
  WHERE msisdn_normalized IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS device_sims_one_active_assignment_idx
  ON public.device_sims(company_id, assigned_device_id, primary_sim)
  WHERE assigned_device_id IS NOT NULL AND primary_sim = true AND status IN ('assigned','active');
CREATE UNIQUE INDEX IF NOT EXISTS device_sims_one_sim_active_idx
  ON public.device_sims(company_id, iccid_normalized)
  WHERE status IN ('assigned','active');

CREATE TABLE IF NOT EXISTS public.device_vehicle_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE RESTRICT,
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  assignment_type public.device_assignment_type NOT NULL,
  status public.device_assignment_status NOT NULL DEFAULT 'planned',
  assigned_at TIMESTAMPTZ,
  assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  unassigned_at TIMESTAMPTZ,
  unassigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reason TEXT,
  simulated BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((assignment_type = 'simulator' AND simulated = true) OR (assignment_type <> 'simulator' AND simulated = false)),
  CHECK ((status <> 'active') OR (assigned_at IS NOT NULL AND assigned_by IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS device_assignments_one_active_device_idx
  ON public.device_vehicle_assignments(company_id, device_id)
  WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS device_assignments_one_active_primary_vehicle_idx
  ON public.device_vehicle_assignments(company_id, vehicle_id)
  WHERE status = 'active' AND assignment_type = 'primary';
CREATE INDEX IF NOT EXISTS device_assignments_company_vehicle_idx
  ON public.device_vehicle_assignments(company_id, vehicle_id, status);

CREATE TABLE IF NOT EXISTS public.device_bus_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE RESTRICT,
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
  tracking_session_id UUID REFERENCES public.tracking_sessions(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('SIMULATED_J1939','SIMULATED_CAN')),
  event_type TEXT NOT NULL CHECK (
    event_type IN ('engine_speed','coolant_temperature','fuel_level','engine_hours','battery_voltage','diagnostic_trouble_code','brake_state','vehicle_speed')
  ),
  spn INTEGER CHECK (spn IS NULL OR (spn BETWEEN 0 AND 524287)),
  fmi INTEGER CHECK (fmi IS NULL OR (fmi BETWEEN 0 AND 31)),
  value DOUBLE PRECISION CHECK (value IS NULL OR value = value),
  unit TEXT,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  simulated BOOLEAN NOT NULL DEFAULT true CHECK (simulated = true),
  observed_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS device_bus_events_company_device_time_idx
  ON public.device_bus_events(company_id, device_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS public.device_sensor_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE RESTRICT,
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
  tracking_session_id UUID REFERENCES public.tracking_sessions(id) ON DELETE SET NULL,
  sensor_type TEXT NOT NULL CHECK (
    sensor_type IN ('imu','shock','tilt','vibration','tamper','temperature','door_open','panic','harsh_braking','harsh_acceleration')
  ),
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  unit TEXT,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  simulated BOOLEAN NOT NULL DEFAULT true CHECK (simulated = true),
  observed_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS device_sensor_events_company_device_time_idx
  ON public.device_sensor_events(company_id, device_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS public.device_firmware_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('dev','beta','stable','lab')),
  hardware_model TEXT NOT NULL,
  hardware_model_normalized TEXT GENERATED ALWAYS AS (public.normalize_device_identifier(hardware_model)) STORED,
  minimum_hardware_revision TEXT,
  minimum_bootloader TEXT,
  status public.firmware_release_status NOT NULL DEFAULT 'draft',
  checksum_metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(checksum_metadata) = 'object'),
  release_notes TEXT,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (version ~ '^v?[0-9]+\.[0-9]+\.[0-9]+([+-].*)?$'),
  CHECK ((status <> 'approved') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS device_firmware_versions_unique_idx
  ON public.device_firmware_versions(company_id, version, channel, hardware_model_normalized);

CREATE TABLE IF NOT EXISTS public.device_command_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role public.app_role,
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE RESTRICT,
  command_type TEXT NOT NULL CHECK (
    command_type IN (
      'request_status','request_gps_fix','reboot_simulator','clear_simulated_queue',
      'switch_ignition','switch_power','simulate_network_loss','simulate_reconnect',
      'set_firmware_version','trigger_sos','trigger_sensor_event'
    )
  ),
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request_payload) = 'object'),
  result_status public.device_command_status NOT NULL DEFAULT 'accepted',
  result_payload JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result_payload) = 'object'),
  idempotency_key TEXT NOT NULL,
  simulated BOOLEAN NOT NULL DEFAULT true CHECK (simulated = true),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS device_command_audit_idempotency_idx
  ON public.device_command_audit(company_id, device_id, command_type, idempotency_key);
CREATE INDEX IF NOT EXISTS device_command_audit_device_time_idx
  ON public.device_command_audit(company_id, device_id, requested_at DESC);

ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_sims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_vehicle_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_bus_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_sensor_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_firmware_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_command_audit ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.devices TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.device_sims TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.device_vehicle_assignments TO authenticated;
GRANT SELECT, INSERT ON public.device_bus_events TO authenticated;
GRANT SELECT, INSERT ON public.device_sensor_events TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.device_firmware_versions TO authenticated;
GRANT SELECT ON public.device_command_audit TO authenticated;
GRANT ALL ON public.devices TO service_role;
GRANT ALL ON public.device_sims TO service_role;
GRANT ALL ON public.device_vehicle_assignments TO service_role;
GRANT ALL ON public.device_bus_events TO service_role;
GRANT ALL ON public.device_sensor_events TO service_role;
GRANT ALL ON public.device_firmware_versions TO service_role;
GRANT ALL ON public.device_command_audit TO service_role;

DROP TRIGGER IF EXISTS devices_updated ON public.devices;
CREATE TRIGGER devices_updated BEFORE UPDATE ON public.devices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS device_sims_updated ON public.device_sims;
CREATE TRIGGER device_sims_updated BEFORE UPDATE ON public.device_sims
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS device_vehicle_assignments_updated ON public.device_vehicle_assignments;
CREATE TRIGGER device_vehicle_assignments_updated BEFORE UPDATE ON public.device_vehicle_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS device_firmware_versions_updated ON public.device_firmware_versions;
CREATE TRIGGER device_firmware_versions_updated BEFORE UPDATE ON public.device_firmware_versions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS device_command_audit_immutable ON public.device_command_audit;
CREATE TRIGGER device_command_audit_immutable
  BEFORE UPDATE OR DELETE ON public.device_command_audit
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_operations_history_change();

CREATE OR REPLACE FUNCTION public.validate_device_company(_company_id UUID, _device_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.devices WHERE id = _device_id AND company_id = _company_id);
$$;

REVOKE ALL ON FUNCTION public.validate_device_company(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_device_company(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.validate_device_company(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_device_assignment_company()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _device public.devices%ROWTYPE;
BEGIN
  SELECT * INTO _device FROM public.devices WHERE id = NEW.device_id;
  IF NOT FOUND OR _device.company_id <> NEW.company_id THEN
    RAISE EXCEPTION 'Device does not belong to company';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vehicles WHERE id = NEW.vehicle_id AND company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'Vehicle does not belong to company';
  END IF;
  IF NEW.assignment_type = 'simulator' AND (_device.device_type <> 'SIMULATOR' OR _device.simulated IS NOT TRUE) THEN
    RAISE EXCEPTION 'Simulator assignment requires simulator device';
  END IF;
  IF NEW.assignment_type <> 'simulator' AND _device.device_type = 'SIMULATOR' THEN
    RAISE EXCEPTION 'Simulator device must use simulator assignment';
  END IF;
  IF NEW.status = 'active' THEN
    NEW.assigned_at := COALESCE(NEW.assigned_at, now());
    NEW.assigned_by := COALESCE(NEW.assigned_by, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_device_assignment_company() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_device_assignment_company() FROM anon;

DROP TRIGGER IF EXISTS device_vehicle_assignments_validate ON public.device_vehicle_assignments;
CREATE TRIGGER device_vehicle_assignments_validate
  BEFORE INSERT OR UPDATE ON public.device_vehicle_assignments
  FOR EACH ROW EXECUTE FUNCTION public.validate_device_assignment_company();

CREATE OR REPLACE FUNCTION public.validate_device_sim_company()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.assigned_device_id IS NOT NULL AND NOT public.validate_device_company(NEW.company_id, NEW.assigned_device_id) THEN
    RAISE EXCEPTION 'Assigned device does not belong to company';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_device_sim_company() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_device_sim_company() FROM anon;

DROP TRIGGER IF EXISTS device_sims_validate ON public.device_sims;
CREATE TRIGGER device_sims_validate
  BEFORE INSERT OR UPDATE ON public.device_sims
  FOR EACH ROW EXECUTE FUNCTION public.validate_device_sim_company();

CREATE OR REPLACE FUNCTION public.validate_device_event_company()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.validate_device_company(NEW.company_id, NEW.device_id) THEN
    RAISE EXCEPTION 'Device does not belong to company';
  END IF;
  IF NEW.vehicle_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.vehicles WHERE id = NEW.vehicle_id AND company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'Vehicle does not belong to company';
  END IF;
  IF NEW.tracking_session_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tracking_sessions WHERE id = NEW.tracking_session_id AND company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'Tracking session does not belong to company';
  END IF;
  NEW.simulated := true;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_device_event_company() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_device_event_company() FROM anon;

DROP TRIGGER IF EXISTS device_bus_events_validate ON public.device_bus_events;
CREATE TRIGGER device_bus_events_validate
  BEFORE INSERT ON public.device_bus_events
  FOR EACH ROW EXECUTE FUNCTION public.validate_device_event_company();
DROP TRIGGER IF EXISTS device_sensor_events_validate ON public.device_sensor_events;
CREATE TRIGGER device_sensor_events_validate
  BEFORE INSERT ON public.device_sensor_events
  FOR EACH ROW EXECUTE FUNCTION public.validate_device_event_company();

CREATE POLICY "devices hardware roles read" ON public.devices FOR SELECT TO authenticated
  USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[]));
CREATE POLICY "devices hardware write" ON public.devices FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(company_id, ARRAY['admin','fleet_manager']::public.app_role[]));
CREATE POLICY "devices hardware update" ON public.devices FOR UPDATE TO authenticated
  USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager']::public.app_role[]))
  WITH CHECK (public.has_any_role(company_id, ARRAY['admin','fleet_manager']::public.app_role[]));

CREATE POLICY "device_sims hardware roles read" ON public.device_sims FOR SELECT TO authenticated
  USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[]));
CREATE POLICY "device_sims hardware write" ON public.device_sims FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(company_id, ARRAY['admin','fleet_manager']::public.app_role[]));
CREATE POLICY "device_sims hardware update" ON public.device_sims FOR UPDATE TO authenticated
  USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager']::public.app_role[]))
  WITH CHECK (public.has_any_role(company_id, ARRAY['admin','fleet_manager']::public.app_role[]));

CREATE POLICY "device_assignments hardware roles read" ON public.device_vehicle_assignments FOR SELECT TO authenticated
  USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[]));
CREATE POLICY "device_assignments hardware write" ON public.device_vehicle_assignments FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(company_id, ARRAY['admin','fleet_manager']::public.app_role[]));
CREATE POLICY "device_assignments hardware update" ON public.device_vehicle_assignments FOR UPDATE TO authenticated
  USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager']::public.app_role[]))
  WITH CHECK (public.has_any_role(company_id, ARRAY['admin','fleet_manager']::public.app_role[]));

CREATE POLICY "device_bus_events read" ON public.device_bus_events FOR SELECT TO authenticated
  USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[]));
CREATE POLICY "device_bus_events simulator insert" ON public.device_bus_events FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[]) AND simulated = true);

CREATE POLICY "device_sensor_events read" ON public.device_sensor_events FOR SELECT TO authenticated
  USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[]));
CREATE POLICY "device_sensor_events simulator insert" ON public.device_sensor_events FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[]) AND simulated = true);

CREATE POLICY "device_firmware read" ON public.device_firmware_versions FOR SELECT TO authenticated
  USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[]));
CREATE POLICY "device_firmware write" ON public.device_firmware_versions FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(company_id, ARRAY['admin','fleet_manager']::public.app_role[]));
CREATE POLICY "device_firmware update" ON public.device_firmware_versions FOR UPDATE TO authenticated
  USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager']::public.app_role[]))
  WITH CHECK (public.has_any_role(company_id, ARRAY['admin','fleet_manager']::public.app_role[]));

CREATE POLICY "device_command_audit read" ON public.device_command_audit FOR SELECT TO authenticated
  USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[]));

CREATE OR REPLACE FUNCTION public.execute_simulated_device_command(
  _company_id UUID,
  _device_id UUID,
  _command_type TEXT,
  _request_payload JSONB DEFAULT '{}'::jsonb,
  _idempotency_key TEXT DEFAULT NULL
)
RETURNS public.device_command_audit
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _device public.devices%ROWTYPE;
  _role public.app_role;
  _audit public.device_command_audit%ROWTYPE;
  _idem TEXT;
BEGIN
  _role := public.current_company_role(_company_id);
  IF auth.uid() IS NULL OR _role NOT IN ('admin','fleet_manager','dispatcher') THEN
    RAISE EXCEPTION 'Not authorized to run simulated device commands';
  END IF;
  SELECT * INTO _device FROM public.devices WHERE id = _device_id AND company_id = _company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Device not found for company'; END IF;
  IF _device.status IN ('retired','blocked') THEN
    RAISE EXCEPTION 'Device cannot accept simulator commands';
  END IF;
  IF _command_type = 'reboot_simulator' AND _device.device_type <> 'SIMULATOR' THEN
    RAISE EXCEPTION 'Reboot simulator only applies to simulator devices';
  END IF;
  IF _command_type = 'set_firmware_version' AND COALESCE(_request_payload->>'firmware_version', '') = '' THEN
    RAISE EXCEPTION 'Firmware command requires firmware_version';
  END IF;
  _idem := COALESCE(NULLIF(_idempotency_key, ''), md5(_company_id::text || ':' || _device_id::text || ':' || _command_type || ':' || COALESCE(_request_payload::text, '{}')));

  SELECT * INTO _audit
  FROM public.device_command_audit
  WHERE company_id = _company_id
    AND device_id = _device_id
    AND command_type = _command_type
    AND idempotency_key = _idem;
  IF FOUND THEN
    RETURN _audit;
  END IF;

  INSERT INTO public.device_command_audit (
    company_id, actor_user_id, actor_role, device_id, command_type,
    request_payload, result_status, result_payload, idempotency_key, simulated, requested_at, completed_at
  )
  VALUES (
    _company_id, auth.uid(), _role, _device_id, _command_type,
    COALESCE(_request_payload, '{}'::jsonb), 'completed',
    jsonb_build_object('simulated', true, 'message', 'SIMULATED COMMAND completed; no hardware command was sent'),
    _idem, true, now(), now()
  )
  RETURNING * INTO _audit;

  IF _command_type = 'set_firmware_version' THEN
    UPDATE public.devices
    SET firmware_version = _request_payload->>'firmware_version', updated_at = now()
    WHERE id = _device_id;
  ELSIF _command_type IN ('request_status','request_gps_fix','simulate_reconnect','trigger_sos','trigger_sensor_event') THEN
    UPDATE public.devices SET last_seen_at = now(), updated_at = now() WHERE id = _device_id;
  END IF;

  RETURN _audit;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_simulated_device_command(uuid, uuid, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execute_simulated_device_command(uuid, uuid, text, jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.execute_simulated_device_command(uuid, uuid, text, jsonb, text) TO authenticated;
