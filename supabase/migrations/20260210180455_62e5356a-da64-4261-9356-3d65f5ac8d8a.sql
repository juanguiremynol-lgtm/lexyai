
-- Table: provider_category_routes
-- Maps workflow categories to provider instances with priority/role routing
CREATE TABLE public.provider_category_routes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workflow TEXT NOT NULL, -- 'CGP','CPACA','TUTELA','PENAL_906','LABORAL','PETICION','GOV_PROCEDURE','ADMIN'
  route_kind TEXT NOT NULL CHECK (route_kind IN ('PRIMARY', 'FALLBACK')),
  scope TEXT NOT NULL DEFAULT 'BOTH' CHECK (scope IN ('ACTS', 'PUBS', 'BOTH')),
  priority INT NOT NULL DEFAULT 0, -- lower = higher priority within same route_kind/scope
  provider_instance_id UUID NOT NULL REFERENCES public.provider_instances(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- No duplicate priority within same org/workflow/scope/route_kind
  CONSTRAINT uq_route_priority UNIQUE (organization_id, workflow, scope, route_kind, priority)
);

-- Performance index for runtime lookups
CREATE INDEX idx_category_routes_lookup
  ON public.provider_category_routes (organization_id, workflow, scope, route_kind, enabled, priority);

-- Enable RLS
ALTER TABLE public.provider_category_routes ENABLE ROW LEVEL SECURITY;

-- RLS: org members can read their own org's routes
CREATE POLICY "Org members can view their routes"
  ON public.provider_category_routes
  FOR SELECT
  USING (
    organization_id IN (
      SELECT om.organization_id FROM public.organization_memberships om
      WHERE om.user_id = auth.uid()
    )
  );

-- RLS: org admins can manage routes
CREATE POLICY "Org admins can insert routes"
  ON public.provider_category_routes
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT om.organization_id FROM public.organization_memberships om
      WHERE om.user_id = auth.uid() AND om.role IN ('OWNER', 'ADMIN')
    )
  );

CREATE POLICY "Org admins can update routes"
  ON public.provider_category_routes
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT om.organization_id FROM public.organization_memberships om
      WHERE om.user_id = auth.uid() AND om.role IN ('OWNER', 'ADMIN')
    )
  );

CREATE POLICY "Org admins can delete routes"
  ON public.provider_category_routes
  FOR DELETE
  USING (
    organization_id IN (
      SELECT om.organization_id FROM public.organization_memberships om
      WHERE om.user_id = auth.uid() AND om.role IN ('OWNER', 'ADMIN')
    )
  );

-- Timestamp trigger
CREATE TRIGGER update_provider_category_routes_updated_at
  BEFORE UPDATE ON public.provider_category_routes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add routing config columns to atenia_ai_config
ALTER TABLE public.atenia_ai_config
  ADD COLUMN IF NOT EXISTS allow_fallback_on_empty BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_provider_attempts_per_run INT DEFAULT 3;
