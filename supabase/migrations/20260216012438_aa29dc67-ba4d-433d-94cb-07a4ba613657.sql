
-- =============================================
-- P0: Support bundles + sync watches tables
-- =============================================

-- 1. Support bundles: read-only diagnostic packages
CREATE TABLE public.support_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  work_item_id UUID REFERENCES public.work_items(id) ON DELETE SET NULL,
  bundle_type TEXT NOT NULL DEFAULT 'DIAGNOSTIC',
  txt_content TEXT NOT NULL,
  json_content JSONB NOT NULL DEFAULT '{}'::jsonb,
  route_context TEXT,
  consent_shared BOOLEAN NOT NULL DEFAULT false,
  shared_via_grant_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.support_bundles ENABLE ROW LEVEL SECURITY;

-- Users can only see their own bundles
CREATE POLICY "Users can view own bundles"
  ON public.support_bundles FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own bundles"
  ON public.support_bundles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can update consent on their own bundles
CREATE POLICY "Users can update own bundles"
  ON public.support_bundles FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- 2. Sync watches: "notify me after next run"
CREATE TABLE public.sync_watches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  work_item_id UUID REFERENCES public.work_items(id) ON DELETE SET NULL,
  condition_type TEXT NOT NULL, -- 'ZERO_ESTADOS', 'NO_NEW_ACTUACIONES', 'STILL_FAILING', 'STILL_DEAD_LETTERED'
  condition_params JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, TRIGGERED, EXPIRED, CANCELLED
  notified_at TIMESTAMPTZ,
  notification_result JSONB,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '72 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  evaluated_at TIMESTAMPTZ
);

ALTER TABLE public.sync_watches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own watches"
  ON public.sync_watches FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own watches"
  ON public.sync_watches FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own watches"
  ON public.sync_watches FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own watches"
  ON public.sync_watches FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Index for efficient watch evaluation during post-sync audits
CREATE INDEX idx_sync_watches_active ON public.sync_watches (status, expires_at) WHERE status = 'ACTIVE';
CREATE INDEX idx_sync_watches_user ON public.sync_watches (user_id, status);
