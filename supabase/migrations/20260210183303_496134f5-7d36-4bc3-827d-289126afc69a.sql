
-- ═══════════════════════════════════════════════════════════════
-- 1) Extend provider_connectors with visibility + organization_id
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.provider_connectors
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'GLOBAL',
  ADD COLUMN IF NOT EXISTS organization_id uuid NULL REFERENCES public.organizations(id);

ALTER TABLE public.provider_connectors
  ADD CONSTRAINT chk_connector_visibility CHECK (
    (visibility = 'GLOBAL' AND organization_id IS NULL) OR
    (visibility = 'ORG_PRIVATE' AND organization_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_provider_connectors_visibility_org
  ON public.provider_connectors (visibility, organization_id);

-- ═══════════════════════════════════════════════════════════════
-- 2) Create org override policy table
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.provider_category_policies_org_override (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  workflow text NOT NULL,
  scope text NOT NULL,
  strategy text NOT NULL DEFAULT 'SELECT',
  merge_mode text NOT NULL DEFAULT 'UNION_PREFER_PRIMARY',
  override_mode text NOT NULL DEFAULT 'PREPEND',
  merge_budget_max_providers int NOT NULL DEFAULT 2,
  merge_budget_max_ms int NOT NULL DEFAULT 15000,
  allow_merge_on_empty boolean NOT NULL DEFAULT false,
  max_provider_attempts_per_run int NOT NULL DEFAULT 2,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, workflow, scope)
);

ALTER TABLE public.provider_category_policies_org_override ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view own org override policies"
  ON public.provider_category_policies_org_override
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_memberships WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Org admins can manage own org override policies"
  ON public.provider_category_policies_org_override
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_memberships
      WHERE user_id = auth.uid() AND role IN ('admin', 'owner')
    )
    OR EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid())
  );

-- ═══════════════════════════════════════════════════════════════
-- 3) Create org override routes table
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.provider_category_routes_org_override (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  workflow text NOT NULL,
  scope text NOT NULL,
  route_kind text NOT NULL,
  priority int NOT NULL DEFAULT 0,
  provider_connector_id uuid NOT NULL REFERENCES public.provider_connectors(id),
  is_authoritative boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, workflow, scope, route_kind, priority)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_override_routes_authoritative
  ON public.provider_category_routes_org_override (organization_id, workflow, scope)
  WHERE is_authoritative = true;

ALTER TABLE public.provider_category_routes_org_override ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view own org override routes"
  ON public.provider_category_routes_org_override
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_memberships WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Org admins can manage own org override routes"
  ON public.provider_category_routes_org_override
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_memberships
      WHERE user_id = auth.uid() AND role IN ('admin', 'owner')
    )
    OR EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid())
  );

-- ═══════════════════════════════════════════════════════════════
-- 4) Update provider_connectors RLS for visibility
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Authenticated users can view connectors" ON public.provider_connectors;
DROP POLICY IF EXISTS "Platform admins can manage connectors" ON public.provider_connectors;

-- GLOBAL visible to all authenticated; ORG_PRIVATE only to same org or platform admins
CREATE POLICY "View connectors by visibility"
  ON public.provider_connectors
  FOR SELECT USING (
    visibility = 'GLOBAL'
    OR organization_id IN (
      SELECT organization_id FROM public.organization_memberships WHERE user_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid())
  );

-- GLOBAL: platform admins only. ORG_PRIVATE: org admin/owner or platform admins
CREATE POLICY "Manage connectors by visibility"
  ON public.provider_connectors
  FOR ALL USING (
    CASE
      WHEN visibility = 'GLOBAL' THEN
        EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid())
      WHEN visibility = 'ORG_PRIVATE' THEN
        organization_id IN (
          SELECT organization_id FROM public.organization_memberships
          WHERE user_id = auth.uid() AND role IN ('admin', 'owner')
        )
        OR EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid())
      ELSE false
    END
  );
