-- ================================================
-- org_integration_settings: Persist per-org adapter configuration
-- ================================================

CREATE TABLE IF NOT EXISTS public.org_integration_settings (
  organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  adapter_priority_order TEXT[] NOT NULL DEFAULT ARRAY['external-rama-judicial-api', 'default-rama-judicial', 'noop-stub'],
  feature_flags JSONB NOT NULL DEFAULT '{
    "enableExternalApi": true,
    "enableLegacyCpnu": false,
    "enableGoogleIntegration": false,
    "enableAwsIntegration": false
  }'::jsonb,
  workflow_overrides JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.org_integration_settings ENABLE ROW LEVEL SECURITY;

-- Org members can SELECT their org's settings
CREATE POLICY "Org members can view integration settings"
  ON public.org_integration_settings
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

-- Only org admins or platform admins can INSERT/UPDATE
CREATE POLICY "Org admins can insert integration settings"
  ON public.org_integration_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_org_admin(organization_id) OR public.is_platform_admin()
  );

CREATE POLICY "Org admins can update integration settings"
  ON public.org_integration_settings
  FOR UPDATE
  TO authenticated
  USING (
    public.is_org_admin(organization_id) OR public.is_platform_admin()
  )
  WITH CHECK (
    public.is_org_admin(organization_id) OR public.is_platform_admin()
  );

-- Only platform admins can DELETE (for cleanup)
CREATE POLICY "Platform admins can delete integration settings"
  ON public.org_integration_settings
  FOR DELETE
  TO authenticated
  USING (public.is_platform_admin());

-- Trigger to update updated_at
CREATE TRIGGER org_integration_settings_updated_at
  BEFORE UPDATE ON public.org_integration_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_org_integration_settings_org 
  ON public.org_integration_settings(organization_id);

-- Add work_item_id column to cgp_milestones if not exists (for terms engine update)
-- Note: This may already exist from previous migrations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'cgp_milestones' 
    AND column_name = 'work_item_id'
  ) THEN
    ALTER TABLE public.cgp_milestones 
    ADD COLUMN work_item_id UUID REFERENCES public.work_items(id) ON DELETE CASCADE;
    
    CREATE INDEX IF NOT EXISTS idx_cgp_milestones_work_item 
      ON public.cgp_milestones(work_item_id, milestone_type, created_at);
  END IF;
END $$;

-- Add work_item_id column to cgp_term_instances if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'cgp_term_instances' 
    AND column_name = 'work_item_id'
  ) THEN
    ALTER TABLE public.cgp_term_instances 
    ADD COLUMN work_item_id UUID REFERENCES public.work_items(id) ON DELETE CASCADE;
    
    CREATE INDEX IF NOT EXISTS idx_cgp_term_instances_work_item 
      ON public.cgp_term_instances(work_item_id, status, due_date);
  END IF;
END $$;

-- Add work_item_id column to cgp_inactivity_tracker if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'cgp_inactivity_tracker' 
    AND column_name = 'work_item_id'
  ) THEN
    ALTER TABLE public.cgp_inactivity_tracker 
    ADD COLUMN work_item_id UUID REFERENCES public.work_items(id) ON DELETE CASCADE;
    
    CREATE INDEX IF NOT EXISTS idx_cgp_inactivity_tracker_work_item 
      ON public.cgp_inactivity_tracker(work_item_id);
  END IF;
END $$;

-- Comment for documentation
COMMENT ON TABLE public.org_integration_settings IS 
  'Per-organization adapter/integration configuration. Controls which scraping adapters are used and feature flags for external integrations.';

COMMENT ON COLUMN public.org_integration_settings.adapter_priority_order IS 
  'Ordered list of adapter IDs to try when scraping. First available adapter is used.';

COMMENT ON COLUMN public.org_integration_settings.feature_flags IS 
  'Feature flags controlling external integrations (Google, AWS, etc). All disabled by default.';

COMMENT ON COLUMN public.org_integration_settings.workflow_overrides IS 
  'Per-workflow adapter overrides, e.g., {"CGP": "external-rama-judicial-api", "PENAL_906": "noop-stub"}';