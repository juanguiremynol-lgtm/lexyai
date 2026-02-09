
-- 1. atenia_ai_actions — Audit log for all AI decisions
CREATE TABLE IF NOT EXISTS public.atenia_ai_actions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  action_type TEXT NOT NULL,
  autonomy_tier TEXT NOT NULL CHECK (autonomy_tier IN ('OBSERVE', 'SUGGEST', 'ACT')),
  target_entity_type TEXT,
  target_entity_id UUID,
  reasoning TEXT NOT NULL,
  evidence JSONB,
  action_taken TEXT,
  action_result TEXT,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX idx_atenia_actions_org ON public.atenia_ai_actions(organization_id, created_at DESC);
CREATE INDEX idx_atenia_actions_target ON public.atenia_ai_actions(target_entity_id) WHERE target_entity_id IS NOT NULL;
CREATE INDEX idx_atenia_actions_pending ON public.atenia_ai_actions(action_result) WHERE action_result = 'pending_approval';

ALTER TABLE public.atenia_ai_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view atenia actions"
  ON public.atenia_ai_actions
  FOR SELECT
  USING (organization_id IN (
    SELECT om.organization_id FROM public.organization_memberships om WHERE om.user_id = auth.uid()
  ));

CREATE POLICY "Org members can insert atenia actions"
  ON public.atenia_ai_actions
  FOR INSERT
  WITH CHECK (organization_id IN (
    SELECT om.organization_id FROM public.organization_memberships om WHERE om.user_id = auth.uid()
  ));

CREATE POLICY "Org members can update atenia actions"
  ON public.atenia_ai_actions
  FOR UPDATE
  USING (organization_id IN (
    SELECT om.organization_id FROM public.organization_memberships om WHERE om.user_id = auth.uid()
  ));

-- 2. atenia_ai_config — Per-org AI configuration
CREATE TABLE IF NOT EXISTS public.atenia_ai_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL UNIQUE REFERENCES public.organizations(id),
  auto_demonitor_after_404s INT DEFAULT 5,
  stage_inference_mode TEXT DEFAULT 'suggest' CHECK (stage_inference_mode IN ('off', 'suggest', 'auto_with_confirm')),
  alert_ai_enrichment BOOLEAN DEFAULT true,
  gemini_enabled BOOLEAN DEFAULT true,
  email_alerts_enabled BOOLEAN DEFAULT false,
  email_alert_min_severity TEXT DEFAULT 'CRITICAL',
  provider_slow_threshold_ms INT DEFAULT 5000,
  provider_error_rate_threshold NUMERIC(3,2) DEFAULT 0.30,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.atenia_ai_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view atenia config"
  ON public.atenia_ai_config
  FOR SELECT
  USING (organization_id IN (
    SELECT om.organization_id FROM public.organization_memberships om WHERE om.user_id = auth.uid()
  ));

CREATE POLICY "Org admins can manage atenia config"
  ON public.atenia_ai_config
  FOR ALL
  USING (organization_id IN (
    SELECT om.organization_id FROM public.organization_memberships om WHERE om.user_id = auth.uid() AND om.role IN ('OWNER', 'ADMIN')
  ));

-- 3. New columns on work_items for Atenia AI monitoring intelligence
ALTER TABLE public.work_items ADD COLUMN IF NOT EXISTS consecutive_404_count INT DEFAULT 0;
ALTER TABLE public.work_items ADD COLUMN IF NOT EXISTS demonitor_reason TEXT;
ALTER TABLE public.work_items ADD COLUMN IF NOT EXISTS demonitor_at TIMESTAMPTZ;
ALTER TABLE public.work_items ADD COLUMN IF NOT EXISTS atenia_health_score NUMERIC(3,2);
ALTER TABLE public.work_items ADD COLUMN IF NOT EXISTS last_stage_suggestion_at TIMESTAMPTZ;
ALTER TABLE public.work_items ADD COLUMN IF NOT EXISTS provider_reachable BOOLEAN DEFAULT true;
