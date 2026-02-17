
-- ============================================================
-- Unified Notifications table with role-based audience scoping
-- ============================================================

-- Audience scope enum
CREATE TYPE public.notification_audience AS ENUM ('USER', 'ORG_ADMIN', 'SUPER_ADMIN');

-- Category enum
CREATE TYPE public.notification_category AS ENUM (
  'TERMS',
  'WORK_ITEM_ALERTS',
  'ORG_ACTIVITY',
  'OPS_SYNC',
  'OPS_INCIDENTS',
  'OPS_E2E',
  'OPS_WATCHDOG',
  'OPS_REMEDIATION',
  'SYSTEM'
);

-- Main table
CREATE TABLE public.notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  audience_scope public.notification_audience NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  category public.notification_category NOT NULL,
  type TEXT NOT NULL DEFAULT 'GENERAL',
  title TEXT NOT NULL,
  body TEXT,
  severity TEXT NOT NULL DEFAULT 'INFO',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  dedupe_key TEXT,
  deep_link TEXT,
  work_item_id UUID,
  CONSTRAINT valid_user_scope CHECK (
    (audience_scope = 'USER' AND user_id IS NOT NULL)
    OR (audience_scope = 'ORG_ADMIN' AND org_id IS NOT NULL)
    OR (audience_scope = 'SUPER_ADMIN')
  )
);

-- Indexes for efficient querying
CREATE INDEX idx_notifications_user_active 
  ON public.notifications (user_id, created_at DESC) 
  WHERE read_at IS NULL AND dismissed_at IS NULL;

CREATE INDEX idx_notifications_org_active 
  ON public.notifications (org_id, created_at DESC) 
  WHERE read_at IS NULL AND dismissed_at IS NULL;

CREATE INDEX idx_notifications_scope_created 
  ON public.notifications (audience_scope, created_at DESC);

CREATE INDEX idx_notifications_user_scope 
  ON public.notifications (user_id, audience_scope, dismissed_at, read_at);

CREATE UNIQUE INDEX idx_notifications_dedupe 
  ON public.notifications (dedupe_key) 
  WHERE dedupe_key IS NOT NULL AND dismissed_at IS NULL;

-- Enable RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- ============================================================
-- RLS Policies: Server-enforced role-based visibility
-- ============================================================

-- 1) Regular users can only see their own USER-scoped notifications
CREATE POLICY "Users see own USER notifications"
  ON public.notifications FOR SELECT
  USING (
    audience_scope = 'USER'
    AND user_id = auth.uid()
  );

-- 2) Org admins can see their own USER notifications + ORG_ADMIN notifications for their org
CREATE POLICY "Org admins see org notifications"
  ON public.notifications FOR SELECT
  USING (
    audience_scope = 'ORG_ADMIN'
    AND org_id IS NOT NULL
    AND public.is_org_admin(org_id)
  );

-- 3) Super admins see SUPER_ADMIN notifications
CREATE POLICY "Super admins see ops notifications"
  ON public.notifications FOR SELECT
  USING (
    audience_scope = 'SUPER_ADMIN'
    AND public.is_platform_admin()
  );

-- 4) Users can update (mark read/dismiss) their own USER notifications
CREATE POLICY "Users update own notifications"
  ON public.notifications FOR UPDATE
  USING (
    audience_scope = 'USER'
    AND user_id = auth.uid()
  )
  WITH CHECK (
    audience_scope = 'USER'
    AND user_id = auth.uid()
  );

-- 5) Org admins can update ORG_ADMIN notifications for their org
CREATE POLICY "Org admins update org notifications"
  ON public.notifications FOR UPDATE
  USING (
    audience_scope = 'ORG_ADMIN'
    AND org_id IS NOT NULL
    AND public.is_org_admin(org_id)
  )
  WITH CHECK (
    audience_scope = 'ORG_ADMIN'
    AND org_id IS NOT NULL
    AND public.is_org_admin(org_id)
  );

-- 6) Super admins can update SUPER_ADMIN notifications
CREATE POLICY "Super admins update ops notifications"
  ON public.notifications FOR UPDATE
  USING (
    audience_scope = 'SUPER_ADMIN'
    AND public.is_platform_admin()
  )
  WITH CHECK (
    audience_scope = 'SUPER_ADMIN'
    AND public.is_platform_admin()
  );

-- 7) Service role can insert (edge functions / triggers create notifications)
CREATE POLICY "Service role inserts notifications"
  ON public.notifications FOR INSERT
  WITH CHECK (true);

-- 8) No one deletes notifications (they dismiss instead)
-- (No DELETE policy = no client-side deletes)
