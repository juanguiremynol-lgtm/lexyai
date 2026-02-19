
-- ============================================================
-- provider_coverage_overrides — DB-driven overlay on hardcoded coverage matrix
-- Allows new providers to be "attached" to workflow+dataKind combos
-- without code changes, via the wizard.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.provider_coverage_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_type text NOT NULL,
  data_kind text NOT NULL CHECK (data_kind IN ('ACTUACIONES', 'ESTADOS')),
  provider_key text NOT NULL,
  provider_role text NOT NULL DEFAULT 'PRIMARY' CHECK (provider_role IN ('PRIMARY', 'FALLBACK')),
  provider_type text NOT NULL DEFAULT 'EXTERNAL' CHECK (provider_type IN ('BUILTIN', 'EXTERNAL')),
  execution_mode text NOT NULL DEFAULT 'CHAIN' CHECK (execution_mode IN ('CHAIN', 'FANOUT')),
  priority int NOT NULL DEFAULT 100,
  override_builtin boolean NOT NULL DEFAULT false,
  connector_id uuid REFERENCES public.provider_connectors(id),
  timeout_ms int,
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_type, data_kind, provider_key)
);

CREATE INDEX IF NOT EXISTS idx_coverage_overrides_lookup
  ON public.provider_coverage_overrides (workflow_type, data_kind, enabled);

-- RLS: platform admins only
ALTER TABLE public.provider_coverage_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coverage_overrides_select"
  ON public.provider_coverage_overrides
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

CREATE POLICY "coverage_overrides_manage"
  ON public.provider_coverage_overrides
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- updated_at trigger
CREATE TRIGGER trg_coverage_overrides_updated_at
  BEFORE UPDATE ON public.provider_coverage_overrides
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- Also add scope column to provider_instances if missing
-- (needed for PLATFORM-scoped instances)
-- ============================================================
ALTER TABLE public.provider_instances
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'ORG';

-- Add index for PLATFORM instance lookups
CREATE INDEX IF NOT EXISTS idx_provider_instances_scope_connector
  ON public.provider_instances (scope, connector_id, is_enabled)
  WHERE scope = 'PLATFORM';
