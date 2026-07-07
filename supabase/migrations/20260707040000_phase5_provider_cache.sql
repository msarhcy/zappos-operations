-- =========================================================================
-- ZappOS - Phase 5 provider observation cache.
-- =========================================================================

DO $$ BEGIN
  CREATE TYPE public.provider_observation_type AS ENUM ('weather','traffic');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.provider_observation_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_type public.provider_observation_type NOT NULL,
  provider_name TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  geographic_cell TEXT NOT NULL,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  observed_at TIMESTAMPTZ,
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'medium',
  source TEXT NOT NULL,
  normalized_payload JSONB NOT NULL,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_type, provider_name, cache_key)
);

CREATE INDEX IF NOT EXISTS provider_cache_lookup_idx
  ON public.provider_observation_cache(provider_type, provider_name, cache_key, expires_at);
CREATE INDEX IF NOT EXISTS provider_cache_expires_idx
  ON public.provider_observation_cache(expires_at);

ALTER TABLE public.provider_observation_cache ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.provider_observation_cache TO authenticated;
GRANT ALL ON public.provider_observation_cache TO service_role;

DROP TRIGGER IF EXISTS provider_observation_cache_updated ON public.provider_observation_cache;
CREATE TRIGGER provider_observation_cache_updated
  BEFORE UPDATE ON public.provider_observation_cache
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "provider_cache tracking roles read" ON public.provider_observation_cache
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_roles cm
      WHERE cm.user_id = auth.uid()
        AND cm.role IN ('admin','fleet_manager','dispatcher','viewer')
    )
  );

CREATE POLICY "provider_cache tracking roles write" ON public.provider_observation_cache
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_roles cm
      WHERE cm.user_id = auth.uid()
        AND cm.role IN ('admin','fleet_manager','dispatcher','viewer')
    )
    AND company_id IS NULL
  );

CREATE POLICY "provider_cache tracking roles update" ON public.provider_observation_cache
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_roles cm
      WHERE cm.user_id = auth.uid()
        AND cm.role IN ('admin','fleet_manager','dispatcher','viewer')
    )
    AND company_id IS NULL
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_roles cm
      WHERE cm.user_id = auth.uid()
        AND cm.role IN ('admin','fleet_manager','dispatcher','viewer')
    )
    AND company_id IS NULL
  );

CREATE OR REPLACE FUNCTION public.purge_expired_provider_observation_cache(_before TIMESTAMPTZ DEFAULT now())
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _deleted INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles cm
    WHERE cm.user_id = auth.uid()
      AND cm.role IN ('admin','fleet_manager')
  ) THEN
    RAISE EXCEPTION 'Not authorized to purge provider cache';
  END IF;

  DELETE FROM public.provider_observation_cache
  WHERE expires_at < _before;

  GET DIAGNOSTICS _deleted = ROW_COUNT;
  RETURN _deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_provider_observation_cache(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_expired_provider_observation_cache(timestamptz) TO authenticated;
