-- Create master_sync_runs audit table for tracking master sync operations
CREATE TABLE IF NOT EXISTS public.master_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Who triggered it
  triggered_by_user_id UUID NOT NULL REFERENCES auth.users(id),
  
  -- Who was synced
  target_user_id UUID NOT NULL REFERENCES auth.users(id),
  target_organization_id UUID NOT NULL REFERENCES public.organizations(id),
  
  -- Configuration
  include_cpnu BOOLEAN DEFAULT true,
  include_samai BOOLEAN DEFAULT true,
  include_publicaciones BOOLEAN DEFAULT true,
  include_tutelas BOOLEAN DEFAULT false,
  
  -- Results
  status TEXT CHECK (status IN ('running', 'completed', 'failed', 'cancelled')) DEFAULT 'running',
  work_items_total INTEGER,
  work_items_processed INTEGER DEFAULT 0,
  work_items_success INTEGER DEFAULT 0,
  work_items_error INTEGER DEFAULT 0,
  
  actuaciones_found INTEGER DEFAULT 0,
  actuaciones_inserted INTEGER DEFAULT 0,
  publicaciones_found INTEGER DEFAULT 0,
  publicaciones_inserted INTEGER DEFAULT 0,
  alerts_created INTEGER DEFAULT 0,
  
  -- Timing
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  
  -- Full results JSON
  results_json JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.master_sync_runs ENABLE ROW LEVEL SECURITY;

-- Platform admins can view all master sync runs
CREATE POLICY "Platform admins can manage master sync runs"
  ON public.master_sync_runs
  FOR ALL
  USING (public.is_platform_admin());

-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_master_sync_runs_target ON public.master_sync_runs(target_user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_master_sync_runs_status ON public.master_sync_runs(status, started_at DESC);

-- Add comment
COMMENT ON TABLE public.master_sync_runs IS 'Audit trail for super admin master sync operations that sync all work items for a user';