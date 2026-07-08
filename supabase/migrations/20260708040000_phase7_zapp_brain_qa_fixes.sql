-- =========================================================================
-- ZappOS - Phase 7 Zapp Brain Integration Shell QA fixes.
-- Add tenant-integrity constraints and JSON shape checks for stored review data.
-- No AI execution, no predictions, no external AI API calls.
-- =========================================================================

ALTER TABLE public.zapp_brain_runs
  ADD CONSTRAINT zapp_brain_runs_company_id_id_unique UNIQUE (company_id, id);

ALTER TABLE public.zapp_brain_insights
  ADD CONSTRAINT zapp_brain_insights_company_id_id_unique UNIQUE (company_id, id);

ALTER TABLE public.zapp_brain_feedback
  ADD CONSTRAINT zapp_brain_feedback_company_id_id_unique UNIQUE (company_id, id);

ALTER TABLE public.zapp_brain_runs
  ADD CONSTRAINT zapp_brain_runs_source_not_blank
  CHECK (length(trim(source)) > 0)
  NOT VALID;

ALTER TABLE public.zapp_brain_insights
  ADD CONSTRAINT zapp_brain_insights_source_not_blank
  CHECK (length(trim(source)) > 0)
  NOT VALID;

ALTER TABLE public.zapp_brain_runs
  ADD CONSTRAINT zapp_brain_runs_input_summary_object
  CHECK (jsonb_typeof(input_summary) = 'object')
  NOT VALID;

ALTER TABLE public.zapp_brain_runs
  ADD CONSTRAINT zapp_brain_runs_output_summary_object
  CHECK (jsonb_typeof(output_summary) = 'object')
  NOT VALID;

ALTER TABLE public.zapp_brain_insights
  ADD CONSTRAINT zapp_brain_insights_evidence_object
  CHECK (jsonb_typeof(evidence) = 'object')
  NOT VALID;

ALTER TABLE public.zapp_brain_insights
  ADD CONSTRAINT zapp_brain_insights_affected_entities_object
  CHECK (jsonb_typeof(affected_entities) = 'object')
  NOT VALID;

ALTER TABLE public.zapp_brain_learning_records
  ADD CONSTRAINT zapp_brain_learning_records_payload_object
  CHECK (jsonb_typeof(payload) = 'object')
  NOT VALID;

ALTER TABLE public.zapp_brain_insights
  ADD CONSTRAINT zapp_brain_insights_company_run_fkey
  FOREIGN KEY (company_id, run_id)
  REFERENCES public.zapp_brain_runs(company_id, id)
  NOT VALID;

ALTER TABLE public.zapp_brain_learning_records
  ADD CONSTRAINT zapp_brain_learning_records_company_insight_fkey
  FOREIGN KEY (company_id, insight_id)
  REFERENCES public.zapp_brain_insights(company_id, id)
  NOT VALID;

ALTER TABLE public.zapp_brain_feedback
  ADD CONSTRAINT zapp_brain_feedback_company_insight_fkey
  FOREIGN KEY (company_id, insight_id)
  REFERENCES public.zapp_brain_insights(company_id, id)
  NOT VALID;

ALTER TABLE public.zapp_brain_learning_records
  ADD CONSTRAINT zapp_brain_learning_records_company_feedback_fkey
  FOREIGN KEY (company_id, feedback_id)
  REFERENCES public.zapp_brain_feedback(company_id, id)
  NOT VALID;

ALTER TABLE public.zapp_brain_runs
  ALTER COLUMN created_by SET DEFAULT auth.uid();

ALTER TABLE public.zapp_brain_learning_records
  ALTER COLUMN created_by SET DEFAULT auth.uid();

DROP POLICY IF EXISTS "zapp_brain_learning_records ops insert" ON public.zapp_brain_learning_records;
CREATE POLICY "zapp_brain_learning_records ops insert" ON public.zapp_brain_learning_records
  FOR INSERT TO authenticated
  WITH CHECK (
    (created_by IS NULL OR created_by = auth.uid())
    AND public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[])
    AND (
      insight_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.zapp_brain_insights i
        WHERE i.id = insight_id
          AND i.company_id = company_id
      )
    )
    AND (
      feedback_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.zapp_brain_feedback f
        WHERE f.id = feedback_id
          AND f.company_id = company_id
      )
    )
  );
