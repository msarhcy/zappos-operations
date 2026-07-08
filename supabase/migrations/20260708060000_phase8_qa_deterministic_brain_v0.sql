-- =========================================================================
-- ZappOS - Phase 8 QA fixes for deterministic Zapp Brain v0.
-- Adds honest run lifecycle fields and serializes per-company deterministic runs.
-- No AI execution, no predictions, no external AI API calls.
-- =========================================================================

ALTER TABLE public.zapp_brain_runs
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS generated_insight_count INTEGER NOT NULL DEFAULT 0
    CHECK (generated_insight_count >= 0),
  ADD COLUMN IF NOT EXISTS stale_insight_count INTEGER NOT NULL DEFAULT 0
    CHECK (stale_insight_count >= 0);

ALTER TABLE public.zapp_brain_runs
  DROP CONSTRAINT IF EXISTS zapp_brain_runs_status_check;

ALTER TABLE public.zapp_brain_runs
  ADD CONSTRAINT zapp_brain_runs_status_check
  CHECK (status IN ('received','running','completed','processed','failed','archived'));

ALTER TABLE public.zapp_brain_runs
  ADD CONSTRAINT zapp_brain_runs_lifecycle_timestamps
  CHECK (
    (status <> 'running' OR started_at IS NOT NULL)
    AND (status NOT IN ('completed','processed','failed') OR completed_at IS NOT NULL)
  )
  NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS zapp_brain_runs_deterministic_running_company_idx
  ON public.zapp_brain_runs(company_id)
  WHERE source = 'deterministic_v0'
    AND status = 'running';
