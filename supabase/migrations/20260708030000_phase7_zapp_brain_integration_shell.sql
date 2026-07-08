-- =========================================================================
-- ZappOS - Phase 7 Zapp Brain Integration Shell.
-- Storage and review workflow for future imported Zapp Brain output only.
-- No AI execution, no predictions, no external AI API calls, no dispatch control.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.zapp_brain_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'zapp_brain',
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','processed','failed','archived')),
  input_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.zapp_brain_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  run_id UUID REFERENCES public.zapp_brain_runs(id) ON DELETE SET NULL,
  category TEXT NOT NULL
    CHECK (category IN (
      'operations',
      'dispatch',
      'route_intelligence',
      'tracking',
      'customer',
      'vehicle',
      'driver',
      'maintenance',
      'incident',
      'system'
    )),
  severity TEXT NOT NULL
    CHECK (severity IN ('critical','high','medium','low','info')),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  explanation TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  recommendation TEXT,
  confidence TEXT NOT NULL DEFAULT 'insufficient_data'
    CHECK (confidence IN ('high','medium','low','insufficient_data')),
  affected_entities JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','reviewing','resolved','needs_follow_up','dismissed')),
  source TEXT NOT NULL DEFAULT 'zapp_brain',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.zapp_brain_learning_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  insight_id UUID REFERENCES public.zapp_brain_insights(id) ON DELETE CASCADE,
  feedback_id UUID,
  learning_type TEXT NOT NULL DEFAULT 'human_feedback'
    CHECK (learning_type IN ('human_feedback','status_change','review_note')),
  label TEXT NOT NULL DEFAULT 'unknown',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.zapp_brain_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  insight_id UUID NOT NULL REFERENCES public.zapp_brain_insights(id) ON DELETE CASCADE,
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  feedback TEXT NOT NULL
    CHECK (feedback IN ('useful','not_useful','correct','false_alarm','resolved','needs_follow_up')),
  reason_label TEXT NOT NULL DEFAULT 'unknown'
    CHECK (reason_label IN (
      'traffic',
      'customer_delay',
      'loading_delay',
      'unloading_delay',
      'vehicle_issue',
      'driver_issue',
      'wrong_route',
      'bad_data',
      'system_error',
      'unknown'
    )),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.zapp_brain_learning_records
  DROP CONSTRAINT IF EXISTS zapp_brain_learning_records_feedback_id_fkey;
ALTER TABLE public.zapp_brain_learning_records
  ADD CONSTRAINT zapp_brain_learning_records_feedback_id_fkey
  FOREIGN KEY (feedback_id) REFERENCES public.zapp_brain_feedback(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS zapp_brain_runs_company_created_idx
  ON public.zapp_brain_runs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS zapp_brain_insights_company_review_idx
  ON public.zapp_brain_insights(company_id, status, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS zapp_brain_insights_company_category_idx
  ON public.zapp_brain_insights(company_id, category, confidence);
CREATE INDEX IF NOT EXISTS zapp_brain_insights_evidence_idx
  ON public.zapp_brain_insights USING GIN(evidence);
CREATE INDEX IF NOT EXISTS zapp_brain_feedback_insight_idx
  ON public.zapp_brain_feedback(company_id, insight_id, created_at DESC);
CREATE INDEX IF NOT EXISTS zapp_brain_learning_records_insight_idx
  ON public.zapp_brain_learning_records(company_id, insight_id, created_at DESC);

ALTER TABLE public.zapp_brain_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zapp_brain_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zapp_brain_learning_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zapp_brain_feedback ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.zapp_brain_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.zapp_brain_insights TO authenticated;
GRANT SELECT, INSERT ON public.zapp_brain_learning_records TO authenticated;
GRANT SELECT, INSERT ON public.zapp_brain_feedback TO authenticated;
GRANT ALL ON public.zapp_brain_runs TO service_role;
GRANT ALL ON public.zapp_brain_insights TO service_role;
GRANT ALL ON public.zapp_brain_learning_records TO service_role;
GRANT ALL ON public.zapp_brain_feedback TO service_role;

DROP TRIGGER IF EXISTS zapp_brain_runs_updated ON public.zapp_brain_runs;
CREATE TRIGGER zapp_brain_runs_updated
  BEFORE UPDATE ON public.zapp_brain_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS zapp_brain_insights_updated ON public.zapp_brain_insights;
CREATE TRIGGER zapp_brain_insights_updated
  BEFORE UPDATE ON public.zapp_brain_insights
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "zapp_brain_runs ops read" ON public.zapp_brain_runs
  FOR SELECT TO authenticated
  USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[]));

CREATE POLICY "zapp_brain_runs ops write" ON public.zapp_brain_runs
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[]));

CREATE POLICY "zapp_brain_runs ops update" ON public.zapp_brain_runs
  FOR UPDATE TO authenticated
  USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[]))
  WITH CHECK (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[]));

CREATE POLICY "zapp_brain_insights ops read" ON public.zapp_brain_insights
  FOR SELECT TO authenticated
  USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[]));

CREATE POLICY "zapp_brain_insights ops write" ON public.zapp_brain_insights
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[]));

CREATE POLICY "zapp_brain_insights ops update" ON public.zapp_brain_insights
  FOR UPDATE TO authenticated
  USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[]))
  WITH CHECK (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[]));

CREATE POLICY "zapp_brain_learning_records ops read" ON public.zapp_brain_learning_records
  FOR SELECT TO authenticated
  USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[]));

CREATE POLICY "zapp_brain_learning_records ops insert" ON public.zapp_brain_learning_records
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[]));

CREATE POLICY "zapp_brain_feedback ops read" ON public.zapp_brain_feedback
  FOR SELECT TO authenticated
  USING (public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[]));

CREATE POLICY "zapp_brain_feedback ops insert" ON public.zapp_brain_feedback
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher']::public.app_role[])
    AND EXISTS (
      SELECT 1
      FROM public.zapp_brain_insights i
      WHERE i.id = insight_id
        AND i.company_id = company_id
    )
  );
