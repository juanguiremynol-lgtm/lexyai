
-- Add governance columns to provider_mapping_specs
ALTER TABLE public.provider_mapping_specs 
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- Add partial unique index: only one ACTIVE per (connector, scope, visibility, org)
CREATE UNIQUE INDEX IF NOT EXISTS idx_mapping_specs_one_active_global
  ON public.provider_mapping_specs (provider_connector_id, scope)
  WHERE status = 'ACTIVE' AND visibility = 'GLOBAL';

CREATE UNIQUE INDEX IF NOT EXISTS idx_mapping_specs_one_active_org
  ON public.provider_mapping_specs (provider_connector_id, scope, organization_id)
  WHERE status = 'ACTIVE' AND visibility = 'ORG_PRIVATE' AND organization_id IS NOT NULL;

-- Add http_status and latency_ms to provider_raw_snapshots
ALTER TABLE public.provider_raw_snapshots
  ADD COLUMN IF NOT EXISTS http_status integer,
  ADD COLUMN IF NOT EXISTS latency_ms integer;

-- Add connector_id to provider_raw_snapshots for direct lookup
ALTER TABLE public.provider_raw_snapshots
  ADD COLUMN IF NOT EXISTS connector_id uuid;
