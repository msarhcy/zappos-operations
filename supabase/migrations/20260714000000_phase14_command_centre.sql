-- =========================================================================
-- ZappOS - Phase 14 Fleet Command Centre.
-- Per-user layouts, watchlists and notification inboxes. All records remain
-- scoped to the signed-in user's operational company membership.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.command_centre_layouts (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  widget_order JSONB NOT NULL DEFAULT '[]'::jsonb,
  collapsed_widgets JSONB NOT NULL DEFAULT '[]'::jsonb,
  widget_sizes JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, company_id)
);

CREATE TABLE IF NOT EXISTS public.command_centre_watchlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('vehicle','driver','customer','route','device','job')),
  entity_id UUID NOT NULL,
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, company_id, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS public.command_centre_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('operations','maintenance','incident','customer','field','hardware','brain')),
  title TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  status TEXT NOT NULL DEFAULT 'unread' CHECK(status IN ('unread','read','acknowledged','dismissed')),
  entity_type TEXT,
  entity_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS command_centre_watchlists_user_position_idx
  ON public.command_centre_watchlists(user_id, company_id, position);
CREATE INDEX IF NOT EXISTS command_centre_notifications_user_created_idx
  ON public.command_centre_notifications(user_id, company_id, created_at DESC);

ALTER TABLE public.command_centre_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.command_centre_watchlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.command_centre_notifications ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.command_centre_layouts, public.command_centre_watchlists, public.command_centre_notifications TO authenticated;
GRANT ALL ON public.command_centre_layouts, public.command_centre_watchlists, public.command_centre_notifications TO service_role;

DROP POLICY IF EXISTS "command centre layout self" ON public.command_centre_layouts;
DROP POLICY IF EXISTS "command centre watchlist self" ON public.command_centre_watchlists;
DROP POLICY IF EXISTS "command centre notification self" ON public.command_centre_notifications;

CREATE POLICY "command centre layout self" ON public.command_centre_layouts FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[]))
  WITH CHECK (user_id = auth.uid() AND public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[]));

CREATE POLICY "command centre watchlist self" ON public.command_centre_watchlists FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[]))
  WITH CHECK (user_id = auth.uid() AND public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer']::public.app_role[]));

CREATE POLICY "command centre notification self" ON public.command_centre_notifications FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer','driver']::public.app_role[]))
  WITH CHECK (user_id = auth.uid() AND public.has_any_role(company_id, ARRAY['admin','fleet_manager','dispatcher','viewer','driver']::public.app_role[]));

DROP TRIGGER IF EXISTS command_centre_layouts_updated ON public.command_centre_layouts;
CREATE TRIGGER command_centre_layouts_updated BEFORE UPDATE ON public.command_centre_layouts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS command_centre_notifications_updated ON public.command_centre_notifications;
CREATE TRIGGER command_centre_notifications_updated BEFORE UPDATE ON public.command_centre_notifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
