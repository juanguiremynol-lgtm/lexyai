
-- =============================================
-- SYSTEM 1: Pre-Flight API Checks
-- =============================================
CREATE TABLE IF NOT EXISTS public.atenia_preflight_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id),
  trigger text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms int,
  overall_status text NOT NULL DEFAULT 'RUNNING',
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  providers_tested int DEFAULT 0,
  providers_passed int DEFAULT 0,
  providers_failed int DEFAULT 0,
  decision text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.atenia_preflight_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can read all preflight checks"
  ON public.atenia_preflight_checks FOR SELECT
  USING (public.is_platform_admin());

CREATE POLICY "Org members can read own preflight checks"
  ON public.atenia_preflight_checks FOR SELECT
  USING (public.is_org_member(organization_id));

CREATE POLICY "Service role inserts preflight checks"
  ON public.atenia_preflight_checks FOR INSERT
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_preflight_recent
  ON public.atenia_preflight_checks (organization_id, created_at DESC);

-- =============================================
-- SYSTEM 2: E2E Test Registry
-- =============================================
CREATE TABLE IF NOT EXISTS public.atenia_e2e_test_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  work_item_id uuid NOT NULL REFERENCES public.work_items(id),
  radicado text NOT NULL,
  workflow_type text NOT NULL,
  providers_to_test text[] NOT NULL,
  is_sentinel boolean DEFAULT false,
  expected_source_count jsonb DEFAULT '{}'::jsonb,
  last_tested_at timestamptz,
  last_test_result text,
  consecutive_failures int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.atenia_e2e_test_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can manage e2e registry"
  ON public.atenia_e2e_test_registry FOR ALL
  USING (public.is_platform_admin());

CREATE POLICY "Org members can read own e2e registry"
  ON public.atenia_e2e_test_registry FOR SELECT
  USING (public.is_org_member(organization_id));

CREATE POLICY "Service role inserts e2e registry"
  ON public.atenia_e2e_test_registry FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role updates e2e registry"
  ON public.atenia_e2e_test_registry FOR UPDATE
  USING (true);

CREATE INDEX IF NOT EXISTS idx_e2e_registry_org
  ON public.atenia_e2e_test_registry (organization_id, is_sentinel);

CREATE INDEX IF NOT EXISTS idx_e2e_registry_work_item
  ON public.atenia_e2e_test_registry (work_item_id);

-- =============================================
-- E2E Test Results Table (for historical tracking)
-- =============================================
CREATE TABLE IF NOT EXISTS public.atenia_e2e_test_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  registry_id uuid REFERENCES public.atenia_e2e_test_registry(id),
  work_item_id uuid NOT NULL REFERENCES public.work_items(id),
  radicado text NOT NULL,
  workflow_type text NOT NULL,
  trigger text NOT NULL,
  overall text NOT NULL,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  duration_ms int,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.atenia_e2e_test_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can read all e2e results"
  ON public.atenia_e2e_test_results FOR SELECT
  USING (public.is_platform_admin());

CREATE POLICY "Org members can read own e2e results"
  ON public.atenia_e2e_test_results FOR SELECT
  USING (public.is_org_member(organization_id));

CREATE POLICY "Service role inserts e2e results"
  ON public.atenia_e2e_test_results FOR INSERT
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_e2e_results_org_recent
  ON public.atenia_e2e_test_results (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_e2e_results_work_item
  ON public.atenia_e2e_test_results (work_item_id, created_at DESC);
