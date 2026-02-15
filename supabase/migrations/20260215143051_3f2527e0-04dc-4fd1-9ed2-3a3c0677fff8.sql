
-- ============================================
-- 1. Control Radicados Library (admin-managed)
-- ============================================
CREATE TABLE IF NOT EXISTS public.control_radicados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL CHECK (category IN ('CGP', 'LABORAL', 'PENAL_906', 'CPACA', 'TUTELA')),
  radicado TEXT NOT NULL,
  dane_code TEXT,
  city TEXT,
  jurisdiction_hint TEXT,
  last_verified_at TIMESTAMPTZ,
  last_verified_status TEXT, -- FOUND_COMPLETE, FOUND_PARTIAL, NOT_FOUND, ERROR
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(category, radicado)
);

ALTER TABLE public.control_radicados ENABLE ROW LEVEL SECURITY;

-- Only platform admins can read and manage
CREATE POLICY "Platform admins read control_radicados"
  ON public.control_radicados FOR SELECT
  USING (public.is_platform_admin());

CREATE POLICY "Platform admins insert control_radicados"
  ON public.control_radicados FOR INSERT
  WITH CHECK (public.is_platform_admin());

CREATE POLICY "Platform admins update control_radicados"
  ON public.control_radicados FOR UPDATE
  USING (public.is_platform_admin());

CREATE POLICY "Platform admins delete control_radicados"
  ON public.control_radicados FOR DELETE
  USING (public.is_platform_admin());

-- Service role (edge functions) can read for control runs
CREATE POLICY "Service role reads control_radicados"
  ON public.control_radicados FOR SELECT
  TO service_role
  USING (true);

CREATE TRIGGER set_control_radicados_updated_at
  BEFORE UPDATE ON public.control_radicados
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================
-- 2. Ghost Verification Runs table
-- ============================================
CREATE TABLE IF NOT EXISTS public.ghost_verification_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id UUID NOT NULL REFERENCES public.work_items(id),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  
  -- Trigger info
  trigger_reason TEXT NOT NULL, -- 'CONSECUTIVE_FAILURES', 'STALE_NO_UPDATES', 'MANUAL'
  consecutive_failures INT NOT NULL DEFAULT 0,
  
  -- Work item recheck results
  recheck_status TEXT, -- 'FOUND_COMPLETE', 'FOUND_PARTIAL', 'NOT_FOUND', 'ERROR'
  recheck_providers_attempted TEXT[],
  recheck_providers_succeeded TEXT[],
  recheck_trace_id TEXT,
  
  -- Control run results
  control_radicado_id UUID REFERENCES public.control_radicados(id),
  control_radicado TEXT,
  control_category TEXT,
  control_run_status TEXT, -- 'FOUND_COMPLETE', 'FOUND_PARTIAL', 'NOT_FOUND', 'ERROR'
  control_providers_attempted TEXT[],
  control_providers_succeeded TEXT[],
  control_trace_id TEXT,
  
  -- Decision
  classification TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'SYSTEM_ISSUE', 'ITEM_SPECIFIC', 'INCONCLUSIVE'
  classification_reason TEXT,
  
  -- Outcomes
  action_taken TEXT, -- 'PARKED', 'INCIDENT_CREATED', 'NO_ACTION', 'RECHECK_SCHEDULED'
  incident_id UUID, -- reference to atenia_ai_conversations if system issue
  
  -- Timestamps
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ghost_verification_runs ENABLE ROW LEVEL SECURITY;

-- Platform admins can read all
CREATE POLICY "Platform admins read ghost_verification_runs"
  ON public.ghost_verification_runs FOR SELECT
  USING (public.is_platform_admin());

-- Org admins can read their org's
CREATE POLICY "Org admins read ghost_verification_runs"
  ON public.ghost_verification_runs FOR SELECT
  USING (public.is_org_admin(organization_id));

-- Org members can read their org's (limited view)
CREATE POLICY "Org members read ghost_verification_runs"
  ON public.ghost_verification_runs FOR SELECT
  USING (public.is_org_member(organization_id));

-- Service role full access
CREATE POLICY "Service role manages ghost_verification_runs"
  ON public.ghost_verification_runs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_ghost_verification_work_item ON public.ghost_verification_runs(work_item_id);
CREATE INDEX idx_ghost_verification_org ON public.ghost_verification_runs(organization_id);
CREATE INDEX idx_ghost_verification_classification ON public.ghost_verification_runs(classification);

-- ============================================
-- 3. Add ghost verification fields to work_items
-- ============================================
ALTER TABLE public.work_items
  ADD COLUMN IF NOT EXISTS ghost_candidate_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ghost_verification_status TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ghost_verification_run_id UUID,
  ADD COLUMN IF NOT EXISTS monitoring_mode TEXT DEFAULT 'AUTO_SYNC',
  ADD COLUMN IF NOT EXISTS monitoring_disabled_reason TEXT,
  ADD COLUMN IF NOT EXISTS monitoring_disabled_by TEXT,
  ADD COLUMN IF NOT EXISTS monitoring_disabled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS monitoring_disabled_meta JSONB;
