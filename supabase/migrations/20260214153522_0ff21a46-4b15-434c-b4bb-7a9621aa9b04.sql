
-- =============================================
-- SYSTEM 3: Deep Dive Engine
-- =============================================
CREATE TABLE IF NOT EXISTS public.atenia_deep_dives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  work_item_id uuid NOT NULL REFERENCES public.work_items(id),
  radicado text NOT NULL,
  trigger_criteria text NOT NULL,
  trigger_evidence jsonb DEFAULT '{}'::jsonb,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  diagnosis text NOT NULL DEFAULT '',
  root_cause text,
  severity text NOT NULL DEFAULT 'MEDIUM',
  recommended_actions jsonb DEFAULT '[]'::jsonb,
  remediation_applied boolean DEFAULT false,
  remediation_action_id uuid,
  gemini_analysis text,
  duration_ms int,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'RUNNING',
  conversation_id uuid,
  included_in_digest boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.atenia_deep_dives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can read all deep dives"
  ON public.atenia_deep_dives FOR SELECT
  USING (public.is_platform_admin());

CREATE POLICY "Org members can read own deep dives"
  ON public.atenia_deep_dives FOR SELECT
  USING (public.is_org_member(organization_id));

CREATE POLICY "Service role inserts deep dives"
  ON public.atenia_deep_dives FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role updates deep dives"
  ON public.atenia_deep_dives FOR UPDATE
  USING (true);

CREATE INDEX IF NOT EXISTS idx_deep_dives_recent
  ON public.atenia_deep_dives (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_deep_dives_item
  ON public.atenia_deep_dives (work_item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_deep_dives_status
  ON public.atenia_deep_dives (status, severity);
