
-- =============================================
-- Analytics & Observability Settings Schema
-- =============================================

-- 1) Add analytics columns to platform_settings (singleton)
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS analytics_enabled_global boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS posthog_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sentry_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS session_replay_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS analytics_allowed_properties jsonb NOT NULL DEFAULT '["event_name","timestamp","tenant_id_hash","user_id_hash","matter_id_hash","route","feature","action","count","latency_ms","duration_ms","file_type_category","size_bucket","from_stage","to_stage","source_type","rule_type","days_offset","export_type","matter_type","status_code"]'::jsonb,
  ADD COLUMN IF NOT EXISTS analytics_hash_secret_configured boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS analytics_last_event_at timestamptz,
  ADD COLUMN IF NOT EXISTS analytics_posthog_host text DEFAULT 'https://us.i.posthog.com';

-- 2) Create per-org analytics overrides table
CREATE TABLE IF NOT EXISTS public.org_analytics_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  analytics_enabled boolean, -- NULL = inherit global
  session_replay_enabled boolean, -- NULL = inherit global
  allowed_properties_override jsonb, -- NULL = inherit global allowlist
  notes text,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id)
);

-- 3) Enable RLS
ALTER TABLE public.org_analytics_overrides ENABLE ROW LEVEL SECURITY;

-- 4) RLS policies
-- Platform admins can manage all overrides
CREATE POLICY "Platform admins can manage org analytics overrides"
  ON public.org_analytics_overrides
  FOR ALL
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- Org admins can view and update their own org's overrides
CREATE POLICY "Org admins can view own analytics overrides"
  ON public.org_analytics_overrides
  FOR SELECT
  USING (public.is_org_admin(organization_id));

CREATE POLICY "Org admins can update own analytics overrides"
  ON public.org_analytics_overrides
  FOR UPDATE
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

CREATE POLICY "Org admins can insert own analytics overrides"
  ON public.org_analytics_overrides
  FOR INSERT
  WITH CHECK (public.is_org_admin(organization_id));

-- 5) Auto-update timestamp trigger
CREATE TRIGGER set_org_analytics_overrides_updated_at
  BEFORE UPDATE ON public.org_analytics_overrides
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
