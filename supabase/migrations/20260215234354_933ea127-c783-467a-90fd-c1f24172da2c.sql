
-- Fix: Drop the unique constraint on (organization_id, run_date) to allow
-- multiple ledger rows per org per day (initial run + continuations).
-- Replace with a non-unique index for efficient lookups.
ALTER TABLE public.auto_sync_daily_ledger 
  DROP CONSTRAINT IF EXISTS auto_sync_daily_ledger_organization_id_run_date_key;

-- Create a non-unique index for lookups
CREATE INDEX IF NOT EXISTS idx_daily_ledger_org_date 
  ON public.auto_sync_daily_ledger (organization_id, run_date);

-- Create a unique partial index: only ONE non-continuation row per org per day
-- This ensures acquire_daily_sync_lock still works correctly (INSERT ON CONFLICT DO NOTHING)
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_ledger_org_date_initial
  ON public.auto_sync_daily_ledger (organization_id, run_date)
  WHERE is_continuation IS NOT TRUE;
