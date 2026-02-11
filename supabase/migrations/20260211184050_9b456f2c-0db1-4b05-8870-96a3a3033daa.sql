
-- Add scope and created_by_role to provider_instances
ALTER TABLE public.provider_instances
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'ORG',
  ADD COLUMN IF NOT EXISTS created_by_role TEXT NOT NULL DEFAULT 'ORG_ADMIN';

-- Make organization_id nullable for PLATFORM instances
ALTER TABLE public.provider_instances
  ALTER COLUMN organization_id DROP NOT NULL;

-- Add check constraint: PLATFORM => org NULL, ORG => org NOT NULL
ALTER TABLE public.provider_instances
  ADD CONSTRAINT chk_instance_scope CHECK (
    (scope = 'PLATFORM' AND organization_id IS NULL)
    OR (scope = 'ORG' AND organization_id IS NOT NULL)
  );

-- Only one active PLATFORM instance per connector
CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_instance_per_connector
  ON public.provider_instances (connector_id)
  WHERE scope = 'PLATFORM' AND is_enabled = true;

-- Add scope to provider_instance_secrets
ALTER TABLE public.provider_instance_secrets
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'ORG';

-- Make organization_id nullable for PLATFORM secrets
ALTER TABLE public.provider_instance_secrets
  ALTER COLUMN organization_id DROP NOT NULL;

-- RLS: PLATFORM instances/secrets only readable via service role (deny browser reads)
-- Drop existing select policies if they exist, then recreate
DO $$
BEGIN
  -- Add policy to deny browser SELECT on PLATFORM-scoped instances
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'provider_instances' AND policyname = 'Deny browser read of PLATFORM instances'
  ) THEN
    CREATE POLICY "Deny browser read of PLATFORM instances"
      ON public.provider_instances
      FOR SELECT
      USING (scope = 'ORG');
  END IF;
END $$;
