
-- =====================================================
-- Per-item consecutive failure tracking for daily sync dead-letter
-- =====================================================

-- Table to track consecutive sync failures per work item
CREATE TABLE IF NOT EXISTS public.sync_item_failure_tracker (
  work_item_id UUID NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  consecutive_failures INT NOT NULL DEFAULT 0,
  last_failure_at TIMESTAMPTZ,
  last_failure_reason TEXT,
  dead_lettered BOOLEAN NOT NULL DEFAULT false,
  dead_lettered_at TIMESTAMPTZ,
  dead_lettered_run_id TEXT,
  reset_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (work_item_id)
);

-- Index for eligibility queries (exclude dead-lettered items)
CREATE INDEX IF NOT EXISTS idx_sync_failure_tracker_org_dead
  ON public.sync_item_failure_tracker (organization_id, dead_lettered)
  WHERE dead_lettered = true;

-- Enable RLS
ALTER TABLE public.sync_item_failure_tracker ENABLE ROW LEVEL SECURITY;

-- Service role only (edge functions use service_role key)
CREATE POLICY "Service role full access on sync_item_failure_tracker"
  ON public.sync_item_failure_tracker
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Platform admins can read
CREATE POLICY "Platform admins can read sync_item_failure_tracker"
  ON public.sync_item_failure_tracker
  FOR SELECT
  USING (public.is_platform_admin());

-- Trigger to update updated_at
CREATE TRIGGER set_updated_at_sync_item_failure_tracker
  BEFORE UPDATE ON public.sync_item_failure_tracker
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- =====================================================
-- Add run_cutoff_time to auto_sync_daily_ledger metadata
-- (metadata is already JSONB, no schema change needed — 
--  but add a dedicated column for queryability)
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'auto_sync_daily_ledger' AND column_name = 'run_cutoff_time'
  ) THEN
    ALTER TABLE public.auto_sync_daily_ledger ADD COLUMN run_cutoff_time TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'auto_sync_daily_ledger' AND column_name = 'dead_letter_count'
  ) THEN
    ALTER TABLE public.auto_sync_daily_ledger ADD COLUMN dead_letter_count INT DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'auto_sync_daily_ledger' AND column_name = 'timeout_count'
  ) THEN
    ALTER TABLE public.auto_sync_daily_ledger ADD COLUMN timeout_count INT DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'auto_sync_daily_ledger' AND column_name = 'chain_id'
  ) THEN
    ALTER TABLE public.auto_sync_daily_ledger ADD COLUMN chain_id TEXT;
  END IF;
END $$;
