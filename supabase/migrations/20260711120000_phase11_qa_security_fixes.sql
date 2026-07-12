-- =========================================================================
-- ZappOS - Phase 11 QA security, lifecycle, and simulation-integrity fixes.
-- No real hardware commands, firmware deployment, AI, ZCT production use,
-- installer workflows, or autonomous control.
-- =========================================================================

ALTER TABLE public.device_sims
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unassigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unassigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.phase11_provisioning_rank(_state TEXT)
RETURNS INTEGER
LANGUAGE SQL IMMUTABLE SET search_path = public
AS $$
  SELECT CASE _state
    WHEN 'registered' THEN 1
    WHEN 'identity_verified' THEN 2
    WHEN 'sim_assigned' THEN 3
    WHEN 'vehicle_assigned' THEN 4
    WHEN 'configuration_ready' THEN 5
    WHEN 'simulated_ready' THEN 6
    WHEN 'active' THEN 7
    ELSE 0
  END;
$$;

REVOKE ALL ON FUNCTION public.phase11_provisioning_rank(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.phase11_provisioning_rank(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.phase11_provisioning_rank(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_phase11_device_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _old_rank INTEGER;
  _new_rank INTEGER;
BEGIN
  IF NEW.device_type = 'SIMULATOR' THEN
    NEW.simulated := true;
    NEW.simulation_label := COALESCE(NULLIF(NEW.simulation_label, ''), 'SIMULATED DEVICE');
  ELSE
    NEW.simulated := false;
    IF NEW.telemetry_source = 'SIMULATOR' THEN
      RAISE EXCEPTION 'Physical device records cannot use SIMULATOR telemetry source';
    END IF;
  END IF;

  IF NEW.simulated AND COALESCE((NEW.metadata->>'physical_device_verified')::boolean, false) THEN
    RAISE EXCEPTION 'Simulator cannot be marked physically verified';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'unprovisioned' THEN
      RAISE EXCEPTION 'Devices must start unprovisioned';
    END IF;
    IF NEW.provisioning_state <> 'registered' THEN
      RAISE EXCEPTION 'Devices must start at registered provisioning state';
    END IF;
  ELSE
    IF OLD.status IN ('retired','blocked') AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Retired or blocked devices cannot change lifecycle status';
    END IF;

    _old_rank := public.phase11_provisioning_rank(OLD.provisioning_state);
    _new_rank := public.phase11_provisioning_rank(NEW.provisioning_state);
    IF _new_rank > _old_rank + 1 THEN
      RAISE EXCEPTION 'Provisioning stages cannot be skipped';
    END IF;

    IF NEW.status = 'active' AND NEW.provisioning_state NOT IN ('simulated_ready','active') THEN
      RAISE EXCEPTION 'Active devices require readiness provisioning state';
    END IF;

    IF NEW.status = 'provisioned' AND OLD.status IS DISTINCT FROM 'provisioned' THEN
      NEW.provisioned_at := COALESCE(NEW.provisioned_at, now());
      NEW.provisioned_by := COALESCE(NEW.provisioned_by, auth.uid());
    END IF;

    IF NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active' THEN
      NEW.activated_at := COALESCE(NEW.activated_at, now());
    END IF;

    IF NEW.status IN ('inactive','retired','blocked') AND OLD.status NOT IN ('inactive','retired','blocked') THEN
      NEW.deactivated_at := COALESCE(NEW.deactivated_at, now());
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_phase11_device_lifecycle() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_phase11_device_lifecycle() FROM anon;

DROP TRIGGER IF EXISTS phase11_devices_lifecycle_validate ON public.devices;
CREATE TRIGGER phase11_devices_lifecycle_validate
  BEFORE INSERT OR UPDATE ON public.devices
  FOR EACH ROW EXECUTE FUNCTION public.validate_phase11_device_lifecycle();

CREATE OR REPLACE FUNCTION public.validate_phase11_sim_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('assigned','active') AND NEW.assigned_device_id IS NULL THEN
    RAISE EXCEPTION 'Assigned or active SIM requires an assigned device';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IN ('suspended','inactive','retired') AND NEW.status = 'active' THEN
    RAISE EXCEPTION 'Suspended, inactive, or retired SIMs cannot be directly activated';
  END IF;

  IF NEW.assigned_device_id IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.assigned_device_id IS DISTINCT FROM NEW.assigned_device_id) THEN
    NEW.assigned_at := COALESCE(NEW.assigned_at, now());
    NEW.assigned_by := COALESCE(NEW.assigned_by, auth.uid());
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.assigned_device_id IS NOT NULL AND NEW.assigned_device_id IS NULL THEN
    NEW.unassigned_at := COALESCE(NEW.unassigned_at, now());
    NEW.unassigned_by := COALESCE(NEW.unassigned_by, auth.uid());
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_phase11_sim_lifecycle() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_phase11_sim_lifecycle() FROM anon;

DROP TRIGGER IF EXISTS phase11_device_sims_lifecycle_validate ON public.device_sims;
CREATE TRIGGER phase11_device_sims_lifecycle_validate
  BEFORE INSERT OR UPDATE ON public.device_sims
  FOR EACH ROW EXECUTE FUNCTION public.validate_phase11_sim_lifecycle();

CREATE OR REPLACE FUNCTION public.validate_phase11_firmware_approval()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _role public.app_role;
BEGIN
  IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved') THEN
    _role := public.current_company_role(NEW.company_id);
    IF auth.uid() IS NULL OR _role NOT IN ('admin','fleet_manager') THEN
      RAISE EXCEPTION 'Not authorized to approve firmware metadata';
    END IF;
    NEW.approved_by := auth.uid();
    NEW.approved_at := now();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_phase11_firmware_approval() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_phase11_firmware_approval() FROM anon;

DROP TRIGGER IF EXISTS phase11_firmware_approval_validate ON public.device_firmware_versions;
CREATE TRIGGER phase11_firmware_approval_validate
  BEFORE INSERT OR UPDATE ON public.device_firmware_versions
  FOR EACH ROW EXECUTE FUNCTION public.validate_phase11_firmware_approval();

DROP TRIGGER IF EXISTS device_bus_events_immutable ON public.device_bus_events;
CREATE TRIGGER device_bus_events_immutable
  BEFORE UPDATE OR DELETE ON public.device_bus_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_operations_history_change();

DROP TRIGGER IF EXISTS device_sensor_events_immutable ON public.device_sensor_events;
CREATE TRIGGER device_sensor_events_immutable
  BEFORE UPDATE OR DELETE ON public.device_sensor_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_operations_history_change();

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
  IF COALESCE(jsonb_typeof(_request_payload), 'object') <> 'object' THEN
    RAISE EXCEPTION 'Command payload must be a JSON object';
  END IF;

  SELECT * INTO _device FROM public.devices WHERE id = _device_id AND company_id = _company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Device not found for company'; END IF;
  IF _device.device_type <> 'SIMULATOR' OR _device.simulated IS NOT TRUE THEN
    RAISE EXCEPTION 'Simulated commands can only target simulator devices';
  END IF;
  IF _device.status IN ('retired','blocked','inactive') THEN
    RAISE EXCEPTION 'Device cannot accept simulator commands';
  END IF;
  IF _command_type NOT IN (
    'request_status','request_gps_fix','reboot_simulator','clear_simulated_queue',
    'switch_ignition','switch_power','simulate_network_loss','simulate_reconnect',
    'set_firmware_version','trigger_sos','trigger_sensor_event'
  ) THEN
    RAISE EXCEPTION 'Unsupported simulated command';
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
