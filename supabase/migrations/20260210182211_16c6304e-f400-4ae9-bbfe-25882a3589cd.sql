
-- 1) Global merge policies (platform-wide, one row per workflow+scope)
CREATE TABLE public.provider_category_policies_global (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workflow text NOT NULL,
  scope text NOT NULL DEFAULT 'BOTH',
  strategy text NOT NULL DEFAULT 'SELECT',
  merge_mode text NOT NULL DEFAULT 'UNION_PREFER_PRIMARY',
  override_mode text NOT NULL DEFAULT 'PREPEND',
  merge_budget_max_providers integer NOT NULL DEFAULT 2,
  merge_budget_max_ms integer NOT NULL DEFAULT 15000,
  allow_merge_on_empty boolean NOT NULL DEFAULT false,
  max_provider_attempts_per_run integer NOT NULL DEFAULT 2,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_global_strategy CHECK (strategy IN ('SELECT', 'MERGE')),
  CONSTRAINT chk_global_merge_mode CHECK (merge_mode IN ('UNION', 'UNION_PREFER_PRIMARY', 'VERIFY_ONLY')),
  CONSTRAINT chk_global_scope CHECK (scope IN ('ACTS', 'PUBS', 'BOTH')),
  CONSTRAINT chk_global_override_mode CHECK (override_mode IN ('PREPEND', 'REPLACE', 'DISABLE_BUILTIN'))
);

CREATE UNIQUE INDEX idx_global_policies_unique ON public.provider_category_policies_global (workflow, scope);

ALTER TABLE public.provider_category_policies_global ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read (for UI preview)
CREATE POLICY "Authenticated can read global policies"
  ON public.provider_category_policies_global FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Platform admins can manage
CREATE POLICY "Platform admins manage global policies"
  ON public.provider_category_policies_global FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid())
  );

-- 2) Global routes (reference provider_connectors, NOT instances)
CREATE TABLE public.provider_category_routes_global (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workflow text NOT NULL,
  scope text NOT NULL DEFAULT 'BOTH',
  route_kind text NOT NULL DEFAULT 'PRIMARY',
  priority integer NOT NULL DEFAULT 0,
  provider_connector_id uuid NOT NULL REFERENCES public.provider_connectors(id) ON DELETE CASCADE,
  is_authoritative boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_global_route_scope CHECK (scope IN ('ACTS', 'PUBS', 'BOTH')),
  CONSTRAINT chk_global_route_kind CHECK (route_kind IN ('PRIMARY', 'FALLBACK'))
);

CREATE UNIQUE INDEX idx_global_routes_unique ON public.provider_category_routes_global (workflow, scope, route_kind, priority);
CREATE UNIQUE INDEX idx_global_routes_authoritative ON public.provider_category_routes_global (workflow, scope) WHERE is_authoritative = true;

ALTER TABLE public.provider_category_routes_global ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read global routes"
  ON public.provider_category_routes_global FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Platform admins manage global routes"
  ON public.provider_category_routes_global FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid())
  );
